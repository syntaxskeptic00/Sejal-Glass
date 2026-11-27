import { RequestHandler } from "express";
import { GlassItem, PIMaster, ProductionHistory, RejectRecord, ReworkRecord, ProductionStage, SystemNotification, BARCODE_PREFIX, formatGenericBarcode, COLOURED_COATED_GLASS_REGEX, isDlguGlass, isDguGlass, isLaminatedGlass } from "../../shared/api";
import { broadcastUpdate } from "./production";
import { logger } from "../lib/logger";
import { loadProductionFromPostgres, saveProductionToPostgres } from "../lib/postgres";


// Persistence store initialized from disk
export const piDatabase: PIMaster[] = [];
export const glassItemsDatabase: GlassItem[] = [];
export const productionHistoryDatabase: ProductionHistory[] = [];
export const rejectDatabase: RejectRecord[] = [];
export const reworkDatabase: ReworkRecord[] = [];
export const notificationsDatabase: SystemNotification[] = [];

export function isItemInPackingStage(i: any): boolean {
  if (!i || i.isDispatched || i.currentStage === "Dispatched" || i.status === "Rejected") return false;
  const isIgu = isDguGlass(i) || isDlguGlass(i) || i.glassCategory === "DGU" || i.glassCategory === "DLGU" || Boolean(i.dguPairId);
  const isLami = !isIgu && (isLaminatedGlass(i) || i.glassCategory === "Laminated" || i.glassCategory === "Lamination");
  if (!isIgu && !isLami) return false;
  if (i.sentToFinished) return false;
  if (i.packingRackNo && String(i.packingRackNo).toUpperCase().includes("DIRECT FINISH")) return false;
  if (i.packingRackNo) return true;
  const sentFromUpstream =
    i.currentStage === "Finished" ||
    (Array.isArray(i.completedStages) && (i.completedStages.includes("DGU") || i.completedStages.includes("Lamination") || i.completedStages.includes("Finished")));
  return Boolean(sentFromUpstream);
}

export function isItemCompleted(i: any): boolean {
  if (!i || i.status === "Rejected" || (i as any).isRejected) return false;
  if (isItemInPackingStage(i)) return false;
  if (i.isDispatched || i.currentStage === "Dispatched") return true;
  if (Boolean(i.sentToFinished)) return true;
  if (i.packingRackNo && String(i.packingRackNo).toUpperCase().includes("DIRECT FINISH")) return true;
  if (i.currentStage === "Finished" && !isDguGlass(i) && !isDlguGlass(i) && !isLaminatedGlass(i)) return true;
  return false;
}

interface PersistedData {
  piDatabase: PIMaster[];
  glassItemsDatabase: GlassItem[];
  productionHistoryDatabase: ProductionHistory[];
  rejectDatabase: RejectRecord[];
  reworkDatabase: ReworkRecord[];
  notificationsDatabase: SystemNotification[];
}

let isDbLoaded = false;
let initDbPromise: Promise<void> | null = null;
let saveDebounceTimer: NodeJS.Timeout | null = null;

/** Build an O(N) lookup from PI key variants to matching glass items. */
function buildPiItemsLookup(): (pi: PIMaster) => GlassItem[] {
  const byPiId = new Map<string, GlassItem[]>();
  const byPiNum = new Map<string, GlassItem[]>();
  const byBatchNo = new Map<string, GlassItem[]>();
  const bySfoNo = new Map<string, GlassItem[]>();

  const pushToMap = (map: Map<string, GlassItem[]>, key: string | undefined, item: GlassItem) => {
    if (!key) return;
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(item);
  };

  for (const item of glassItemsDatabase) {
    pushToMap(byPiId, item.piId, item);
    pushToMap(byPiNum, item.piNumber, item);
    pushToMap(byBatchNo, item.batchNo, item);
    pushToMap(bySfoNo, item.sfoNo, item);
  }

  return (pi: PIMaster) => {
    const cleanId = (pi.id || "").replace(/^STK-/i, "");
    const cleanPiNo = (pi.piNumber || "").replace(/^STK-/i, "");
    const seen = new Set<string>();
    const result: GlassItem[] = [];

    const addAll = (list?: GlassItem[]) => {
      if (!list) return;
      for (const item of list) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          result.push(item);
        }
      }
    };

    addAll(byPiId.get(pi.id));
    if (cleanId) addAll(byPiId.get(cleanId));
    addAll(byPiNum.get(pi.piNumber));
    if (cleanPiNo) addAll(byPiNum.get(cleanPiNo));
    if (cleanPiNo) addAll(byBatchNo.get(cleanPiNo));
    addAll(byBatchNo.get(pi.piNumber));
    addAll(bySfoNo.get(pi.piNumber));
    if (cleanPiNo) addAll(bySfoNo.get(cleanPiNo));

    return result;
  };
}

function normalizeLoadedProductionData(): boolean {
  let dataChanged = false;
  // Ensure laminated glass items include Pairing in their processRoute before Lamination
  glassItemsDatabase.forEach((item) => {
    if (!Array.isArray(item.processRoute)) return;
    const descLower = `${item.glassType || ""} ${item.glassCode || ""}`.toLowerCase();
    const isLaminated = item.processRoute.includes("Lamination") || descLower.includes("lam") || descLower.includes("pvb") || descLower.includes("sgp");
    if (isLaminated && !item.processRoute.includes("Pairing")) {
      const lamIdx = item.processRoute.indexOf("Lamination");
      if (lamIdx >= 0) {
        item.processRoute.splice(lamIdx, 0, "Pairing");
      } else {
        item.processRoute.unshift("Pairing");
      }
      if (item.currentStage === "Lamination" && !item.completedStages?.includes("Pairing")) {
        item.currentStage = "Pairing";
      }
    }
  });

  // Auto-heal unpaired DGU/Lamination items that jumped to DGU or Finished without a partner pane
  const advancedPairingCandidates = glassItemsDatabase.filter(
    (other) => other.status !== "Rejected" && (other.currentStage === "DGU" || other.currentStage === "Finished" || other.status === "Completed")
  );
  glassItemsDatabase.forEach((item) => {
    if (!Array.isArray(item.processRoute) || !item.processRoute.includes("Pairing")) return;
    if (item.currentStage === "Cutting") return;

    if (item.currentStage === "DGU" || item.currentStage === "Finished" || item.status === "Completed") {
      const isDgu = item.glassCategory === "DGU" || item.processRoute.includes("DGU");
      const isCol = item.colorOrClear === "Colour" || String(item.category || "").toLowerCase().includes("colour");

      const hasPartner = advancedPairingCandidates.some((other) => {
        if (other.id === item.id) return false;
        if ((item as any).dguPairId && (other as any).dguPairId === (item as any).dguPairId) return true;
        const isOtherCol = other.colorOrClear === "Colour" || String(other.category || "").toLowerCase().includes("colour");
        if (isDgu && isOtherCol === isCol) return false;
        if (other.posNo && item.posNo && String(other.posNo).trim() !== String(item.posNo).trim()) return false;
        if (Math.abs((other.width || 0) - (item.width || 0)) >= 2) return false;
        if (Math.abs((other.height || 0) - (item.height || 0)) >= 2) return false;
        return true;
      });

      if (!hasPartner) {
        logger.warn(`[Auto-Heal] Resetting unpaired glass pane ${item.serialNumber} (${item.barcode}) from ${item.currentStage} back to Pairing Buffer.`);
        item.currentStage = "Pairing";
        item.status = "Pending";
        item.completedStages = ["Cutting"];
        delete (item as any).isDguReduced;
        delete (item as any).dguPairId;
        delete (item as any).lamPairId;
        dataChanged = true;
      }
    }
  });

  const colourRegex = COLOURED_COATED_GLASS_REGEX;

  // Auto-heal invalid barcodes (e.g. "WIDTHHEIGHT" or non-digit header artifacts)
  const repairedBarcodeMap = new Map<string, string>();
  glassItemsDatabase.forEach((item, idx) => {
    const b = String(item.barcode || "").trim();
    if (!b || /width|height|order|customer|project|batch|glass/i.test(b) || /^[A-Z]+$/i.test(b) || !/\d/.test(b)) {
      const cleanSfo = String(item.sfoNo || item.piNumber || "1344").replace(/[^0-9]/g, "");
      const numPart = item.serialNumber ? String(item.serialNumber).replace(/\D/g, "") : "";
      const seqPad = (numPart || String(idx + 1)).padStart(4, "0").slice(-4);
      const fixedBarcode = formatGenericBarcode(cleanSfo, seqPad, BARCODE_PREFIX);
      item.barcode = fixedBarcode;
      item.qrId = `QR-${fixedBarcode}`;
      if (item.serialNumber) {
        repairedBarcodeMap.set(item.serialNumber, fixedBarcode);
      }
      dataChanged = true;
    }
  });

  const getPiItems = buildPiItemsLookup();

  piDatabase.forEach((pi) => {
    const batchItems = glassItemsDatabase.filter(
      (item) => item.piId === pi.id || (item.piNumber && item.piNumber === pi.piNumber)
    );

    const batchFullText = (
      (pi.fileName || "") + " " +
      (pi.glassDescription || "") + " " +
      ((pi as any).remarks || "") + " " +
      batchItems.map((i) => `${i.glassType || ""} ${i.glassCode || ""} ${i.category || ""} ${i.glassColor || ""} ${i.remarks || ""}`).join(" ")
    ).toLowerCase();

    const hasBatchColourKeyword = colourRegex.test(batchFullText);
    const hasBatchClearKeyword = /clear/i.test(batchFullText);

    let batchFinish: "Colour" | "Clear" = "Clear";
    if (hasBatchColourKeyword) {
      batchFinish = "Colour";
    } else if (pi.colorOrClear === "Colour" || (pi.colorOrClear as any) === "Color" || pi.finish === "Colour") {
      batchFinish = "Colour";
    } else if (pi.colorOrClear === "Clear" || pi.finish === "Clear") {
      batchFinish = "Clear";
    } else if (hasBatchClearKeyword) {
      batchFinish = "Clear";
    } else {
      const clearCount = batchItems.filter((item) => item.colorOrClear === "Clear" || /clear/i.test(item.glassColor || "")).length;
      const colourCount = batchItems.filter((item) => item.colorOrClear === "Colour" || (item.colorOrClear as any) === "Color" || (colourRegex.test(item.glassColor || "") && !/clear/i.test(item.glassColor || ""))).length;
      batchFinish = colourCount > clearCount ? "Colour" : "Clear";
    }

    if (pi.colorOrClear !== batchFinish || pi.finish !== batchFinish) {
      pi.colorOrClear = batchFinish;
      pi.finish = batchFinish;
      dataChanged = true;
    }

    batchItems.forEach((item) => {
      if (item.colorOrClear !== batchFinish || item.finish !== batchFinish) {
        item.colorOrClear = batchFinish;
        item.finish = batchFinish;
        dataChanged = true;
      }
      if (batchFinish === "Colour" && (!item.glassColor || item.glassColor === "Clear Glass" || item.glassColor === "Clear Float")) {
        item.glassColor = pi.glassColor || "Coloured Glass";
        dataChanged = true;
      } else if (batchFinish === "Clear" && (!item.glassColor || item.glassColor === "Coloured Glass")) {
        item.glassColor = "Clear Glass";
        dataChanged = true;
      }
    });

    const distinctOrder = batchItems.find(
      (i) => i.orderNo && i.orderNo !== pi.batchNo && i.orderNo !== pi.piNumber
    )?.orderNo;
    if (distinctOrder && (!pi.proformaInvNo || pi.proformaInvNo === pi.piNumber || pi.proformaInvNo === pi.batchNo)) {
      pi.proformaInvNo = distinctOrder;
      dataChanged = true;
    }

    const batchText = (
      (pi.fileName || "") + " " +
      (pi.glassDescription || "") + " " +
      ((pi as any).remarks || "") + " " +
      batchItems.map((i) => `${i.glassType || ""} ${i.glassCode || ""} ${i.category || ""} ${i.remarks || ""} ${i.makeup || ""}`).join(" ")
    ).toLowerCase();

    const isKnownLamBatch =
      pi.piNumber === "5301" ||
      pi.piNumber === "1620" ||
      (pi as any).batchNo === "5301" ||
      (pi as any).batchNo === "1620" ||
      (pi.fileName || "").toLowerCase().includes("10 mm clear") ||
      (pi.fileName || "").toLowerCase().includes("12 mm clear");
    const hasInterlayer = isKnownLamBatch || /\b(pvb|sgp|eva|lamination|laminated|lami|lam)\b/i.test(batchText);
    const hasSpacer = !isKnownLamBatch && /spacer|dgu|igu/i.test(batchText);

    let batchCat: "DGU" | "Lamination" | "DLGU" = pi.glassCategory === "DLGU" ? "DLGU" : (pi.glassCategory === "Lamination" ? "Lamination" : "DGU");
    if (pi.glassCategory === "DLGU" || (hasInterlayer && hasSpacer)) {
      batchCat = "DLGU";
    } else if (hasInterlayer && !hasSpacer) {
      batchCat = "Lamination";
    } else if (hasSpacer) {
      batchCat = "DGU";
    }

    if (pi.glassCategory !== batchCat) {
      pi.glassCategory = batchCat;
      dataChanged = true;
    }

    batchItems.forEach((item) => {
      const itemText = `${item.glassType || ""} ${item.glassCode || ""} ${item.remarks || ""} ${item.makeup || ""} ${(item as any).stickerRoute || ""}`.toLowerCase();
      const isItemDlgu = item.glassCategory === "DLGU" || batchCat === "DLGU" || (/spacer|dgu|igu/i.test(itemText) && /\b(pvb|sgp|eva|lamination|laminated|lami|lam)\b/i.test(itemText));
      const isItemLam = !isItemDlgu && (item.glassCategory === "Lamination" || (/\b(pvb|sgp|eva|lamination|laminated|lami|lam)\b/i.test(itemText) && !/spacer|dgu|igu/i.test(itemText)));
      const isItemDgu = !isItemDlgu && (item.glassCategory === "DGU" || /spacer|dgu|igu/i.test(itemText));
      const resolvedCat: "DGU" | "Lamination" | "DLGU" = isItemDlgu ? "DLGU" : (isItemLam && !isItemDgu ? "Lamination" : (isItemDgu ? "DGU" : batchCat));

      if (item.glassCategory !== resolvedCat) {
        item.glassCategory = resolvedCat;
        dataChanged = true;
      }

      const hasPolish = (item as any).hasPolish === true || /\bpolish\b/i.test(itemText) || /\bpolished\b/i.test(itemText) || (item.currentStage === "Polishing");

      let expectedRoute: ProductionStage[];
      if (resolvedCat === "DLGU") {
        const isLamPane = item.colorOrClear === "Clear" || /lam|laminated|6mm clear/i.test(itemText);
        expectedRoute = isLamPane
          ? (hasPolish
            ? ["Cutting", "Polishing", "Pairing", "Lamination", "Pairing", "DGU", "Finished"]
            : ["Cutting", "Pairing", "Lamination", "Pairing", "DGU", "Finished"])
          : (hasPolish
            ? ["Cutting", "Polishing", "Pairing", "DGU", "Finished"]
            : ["Cutting", "Pairing", "DGU", "Finished"]);
        if (!item.dlguPhase) {
          item.dlguPhase = isLamPane ? "LamPairing" : "DguPairing";
          dataChanged = true;
        }
      } else if (resolvedCat === "Lamination") {
        expectedRoute = hasPolish
          ? ["Cutting", "Polishing", "Pairing", "Lamination", "Finished"]
          : ["Cutting", "Pairing", "Lamination", "Finished"];
        if (item.dlguPhase) {
          delete item.dlguPhase;
          dataChanged = true;
        }
      } else if (resolvedCat === "DGU") {
        expectedRoute = hasPolish
          ? ["Cutting", "Polishing", "Pairing", "DGU", "Finished"]
          : ["Cutting", "Pairing", "DGU", "Finished"];
        if (item.dlguPhase) {
          delete item.dlguPhase;
          dataChanged = true;
        }
      } else {
        expectedRoute = hasPolish
          ? ["Cutting", "Polishing", "Finished"]
          : ["Cutting", "Finished"];
        if (item.dlguPhase) {
          delete item.dlguPhase;
          dataChanged = true;
        }
      }

      const isAdvancedNonPolish = item.currentStage && item.currentStage !== "Cutting" && item.currentStage !== "Polishing";
      if (!isAdvancedNonPolish && JSON.stringify(item.processRoute) !== JSON.stringify(expectedRoute)) {
        item.processRoute = expectedRoute;
        dataChanged = true;
      }
    });
  });

  // Synchronize paired DGU / DLGU partner panes that were assembled and finished together
  const finishedItems = glassItemsDatabase.filter((i) => i.currentStage === "Finished" && i.status !== "Rejected");
  const dguStageItems = glassItemsDatabase.filter((i) => i.currentStage === "DGU");
  finishedItems.forEach((fin) => {
    if (fin.glassCategory === "DLGU" || fin.glassCategory === "DGU") {
      const finPairId = (fin as any).lamPairId;
      dguStageItems.forEach((other) => {
        if (other.id !== fin.id && other.currentStage === "DGU") {
          const samePair = (finPairId && (other as any).lamPairId === finPairId) ||
            (other.posNo === fin.posNo && other.width === fin.width && other.height === fin.height && (other.piId === fin.piId || other.piNumber === fin.piNumber || other.orderNo === fin.orderNo));
          if (samePair) {
            other.currentStage = "Finished";
            other.status = "Completed";
            if (!other.completedStages.includes("DGU")) other.completedStages.push("DGU");
            other.updatedAt = new Date().toISOString();
            dataChanged = true;
          }
        }
      });
    }
  });

  // Update completed counts on PI masters
  piDatabase.forEach((pi) => {
    const piItems = getPiItems(pi);
    if (piItems.length > 0) {
      const comp = piItems.filter(isItemCompleted).length;
      if (pi.completedItemsCount !== comp) {
        pi.completedItemsCount = comp;
        dataChanged = true;
      }
      if (comp >= piItems.length && comp > 0 && pi.status !== "Completed") {
        pi.status = "Completed";
        dataChanged = true;
      } else if (comp < piItems.length && pi.status === "Completed") {
        pi.status = "In Production";
        dataChanged = true;
      }
    }
  });

  if (repairedBarcodeMap.size > 0) {
    productionHistoryDatabase.forEach((h) => {
      if (h.serialNumber && repairedBarcodeMap.has(h.serialNumber)) {
        h.barcode = repairedBarcodeMap.get(h.serialNumber)!;
        if (h.remarks && /WIDTHHEIGHT/i.test(h.remarks)) {
          h.remarks = h.remarks.replace(/WIDTHHEIGHT/gi, h.barcode);
        }
      }
    });
    rejectDatabase.forEach((r) => {
      if (r.serialNumber && repairedBarcodeMap.has(r.serialNumber)) {
        r.barcode = repairedBarcodeMap.get(r.serialNumber)!;
      }
    });
    reworkDatabase.forEach((rw) => {
      if (rw.serialNumber && repairedBarcodeMap.has(rw.serialNumber)) {
        rw.barcode = repairedBarcodeMap.get(rw.serialNumber)!;
      }
    });
    dataChanged = true;
  }

  // Auto-sync: Ensure all rejected glass items automatically exist in reworkDatabase with remake tickets to Cutting
  const existingReworkSerials = new Set(reworkDatabase.map((rw) => rw.serialNumber));
  const itemBySerial = new Map<string, GlassItem>();
  for (const g of glassItemsDatabase) {
    if (g.serialNumber) itemBySerial.set(g.serialNumber, g);
  }

  rejectDatabase.forEach((rej) => {
    if (rej.serialNumber && !existingReworkSerials.has(rej.serialNumber)) {
      existingReworkSerials.add(rej.serialNumber);
      reworkDatabase.push({
        id: `rew-${rej.id || Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        serialNumber: rej.serialNumber,
        barcode: rej.barcode,
        piNumber: rej.piNumber,
        fromStage: rej.stage || "Cutting",
        targetStage: "Cutting",
        reason: `[Auto-Remake after Rejection] ${rej.reason}`,
        defectivePane: rej.defectivePane,
        defectiveSerialNumber: rej.defectiveSerialNumber,
        partnerSerialNumber: rej.partnerSerialNumber,
        date: rej.date || new Date().toISOString(),
        operator: rej.operator || "Operator",
      });
      dataChanged = true;

      const item = itemBySerial.get(rej.serialNumber);
      if (item && item.status !== "Completed") {
        item.status = "Reworking";
        item.currentStage = "Cutting";
      }
    }
  });

  // If no persisted notifications yet, seed from real historical production actions
  if (notificationsDatabase.length === 0 && productionHistoryDatabase.length > 0) {
    productionHistoryDatabase.slice(0, 15).forEach((h, idx) => {
      const rawDate = h.timestamp ? new Date(h.timestamp).getTime() : Date.now() - idx * 1000;
      const isReject = h.action?.toLowerCase().includes("reject") || h.status === "Rejected";
      const isRework = h.action?.toLowerCase().includes("rework") || h.status === "Reworking";
      const isUpload = h.action?.toLowerCase().includes("upload") || h.action?.toLowerCase().includes("batch");

      let type: "info" | "success" | "warning" | "destructive" = "success";
      let category: any = "STAGE_ADVANCE";
      if (isReject) { type = "destructive"; category = "REJECTION"; }
      else if (isRework) { type = "warning"; category = "REWORK"; }
      else if (isUpload) { type = "info"; category = "BATCH_UPLOAD"; }

      notificationsDatabase.push({
        id: `notif-${h.id || idx}-${rawDate}`,
        title: h.action || `${h.stage} Stage Advanced`,
        message: h.remarks || `Item ${h.serialNumber} processed at ${h.stage} by ${h.operator || "Operator"}.`,
        category,
        type,
        stage: String(h.stage || ""),
        serialNumber: h.serialNumber,
        operator: h.operator,
        timestamp: h.timestamp || new Date(rawDate).toISOString(),
        rawDate,
        read: false,
        createdAt: h.timestamp || new Date(rawDate).toISOString(),
      });
    });
    dataChanged = true;
  }

  return dataChanged;
}

export async function initProductionDatabase(force = false): Promise<void> {
  if (isDbLoaded && !force) return;
  if (initDbPromise && !force) return initDbPromise;

  initDbPromise = (async () => {
    try {
      const pgData = await loadProductionFromPostgres();
      if (!pgData) {
        initDbPromise = null;
        return;
      }

      piDatabase.splice(0, piDatabase.length, ...pgData.piDatabase);
      glassItemsDatabase.splice(0, glassItemsDatabase.length, ...pgData.glassItemsDatabase);
      productionHistoryDatabase.splice(0, productionHistoryDatabase.length, ...pgData.productionHistoryDatabase);
      rejectDatabase.splice(0, rejectDatabase.length, ...pgData.rejectDatabase);
      reworkDatabase.splice(0, reworkDatabase.length, ...pgData.reworkDatabase);
      notificationsDatabase.splice(0, notificationsDatabase.length, ...pgData.notificationsDatabase);

      const changed = normalizeLoadedProductionData();
      if (changed) {
        saveDatabase(true);
      }
      logger.info(`[PostgreSQL] Loaded ${piDatabase.length} batches and ${glassItemsDatabase.length} items from local PostgreSQL.`);
      isDbLoaded = true;
    } catch (err: any) {
      initDbPromise = null;
      logger.error("[PostgreSQL] Failed to initialize production database", { error: err?.message || String(err) });
    }
  })();

  await initDbPromise;
}

export function saveDatabase(immediate = false): void {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
  const executeSave = () => {
    const data: PersistedData = {
      piDatabase,
      glassItemsDatabase,
      productionHistoryDatabase,
      rejectDatabase,
      reworkDatabase,
      notificationsDatabase,
    };
    saveProductionToPostgres(data).catch((err) => {
      logger.error("[PostgreSQL] Failed to async save production state", { error: err?.message || String(err) });
    });
  };

  if (immediate) {
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }
    executeSave();
  } else {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(executeSave, 150);
  }
}

export function createAndBroadcastNotification(params: {
  title: string;
  message: string;
  category?: "STAGE_ADVANCE" | "REJECTION" | "REWORK" | "BATCH_UPLOAD" | "PI_CREATED" | "PI_RELEASED" | "SYSTEM";
  type?: "info" | "success" | "warning" | "destructive";
  stage?: string;
  serialNumber?: string;
  batchNumber?: string;
  piNumber?: string;
  operator?: string;
}): SystemNotification {
  const now = new Date();
  const notif: SystemNotification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    title: params.title,
    message: params.message,
    category: params.category || "SYSTEM",
    type: params.type || "info",
    stage: params.stage,
    serialNumber: params.serialNumber,
    batchNumber: params.batchNumber,
    piNumber: params.piNumber,
    operator: params.operator || "System",
    timestamp: now.toISOString(),
    rawDate: now.getTime(),
    read: false,
    createdAt: now.toISOString(),
  };

  notificationsDatabase.unshift(notif);
  if (notificationsDatabase.length > 100) {
    notificationsDatabase.splice(100);
  }

  saveDatabase();
  broadcastUpdate("system_notification", notif);
  return notif;
}

export const handleGetPIs: RequestHandler = (req, res) => {
  // Sync real-time completion status for all batches in one O(N) pass
  let statusChanged = false;
  const getPiItems = buildPiItemsLookup();
  piDatabase.forEach((pi) => {
    const piItems = getPiItems(pi);
    if (piItems.length > 0) {
      const completedCount = piItems.filter(isItemCompleted).length;
      if (pi.completedItemsCount !== completedCount) {
        pi.completedItemsCount = completedCount;
        statusChanged = true;
      }
      const newStatus = completedCount >= piItems.length && piItems.length > 0 ? "Completed" : (completedCount > 0 || piItems.some((i) => i.currentStage !== "Cutting" || i.completedStages?.length || isItemInPackingStage(i)) ? "In Production" : (pi.status || "Pending"));
      if (pi.status !== newStatus) {
        pi.status = newStatus;
        statusChanged = true;
      }
    }
  });

  if (statusChanged) {
    saveDatabase();
  }

  const page = parseInt(req.query.page as string, 10);
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const statusFilter = req.query.status as string | undefined;

  let filtered = piDatabase;
  if (statusFilter) {
    filtered = filtered.filter((p) => p.status === statusFilter);
  }

  // If no page param, return all (backward compatible)
  if (isNaN(page) || page < 1) {
    res.json(filtered);
    return;
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const data = filtered.slice(start, start + limit);

  res.json({
    data,
    pagination: { page, limit, total, totalPages },
  });
};

export const handleGetPIDetails: RequestHandler = (req, res) => {
  const idStr = String(req.params.id || "");
  const cleanId = idStr.replace(/^STK-/i, "");
  const pi = piDatabase.find((p) => p.id === idStr || p.piNumber === idStr || p.id === cleanId || p.piNumber === cleanId);
  if (!pi) {
    res.status(404).json({ message: "PI not found" });
    return;
  }
  const cleanPiId = (pi.id || "").replace(/^STK-/i, "");
  const cleanPiNo = (pi.piNumber || "").replace(/^STK-/i, "");
  const items = glassItemsDatabase.filter(
    (item) =>
      item.piId === pi.id ||
      item.piNumber === pi.piNumber ||
      item.piId === cleanPiId ||
      item.piNumber === cleanPiNo ||
      item.batchNo === cleanPiNo ||
      item.batchNo === pi.piNumber ||
      (item.sfoNo && (item.sfoNo === pi.piNumber || item.sfoNo === cleanPiNo))
  );
  res.json({ pi, items });
};

export const handleDeletePI: RequestHandler = (req, res) => {
  const { id } = req.params;
  const piIndex = piDatabase.findIndex((p) => p.id === id || p.piNumber === id);

  if (piIndex === -1) {
    res.status(404).json({ message: "PI document not found" });
    return;
  }

  const deletedPI = piDatabase[piIndex];
  piDatabase.splice(piIndex, 1);

  // Remove associated glass items and collect their serials/barcodes
  const deletedIdentifiers = new Set<string>();
  if (deletedPI.piNumber) deletedIdentifiers.add(deletedPI.piNumber);

  const cleanPiId = (deletedPI.id || "").replace(/^STK-/i, "");
  const cleanPiNo = (deletedPI.piNumber || "").replace(/^STK-/i, "");

  for (let i = glassItemsDatabase.length - 1; i >= 0; i--) {
    const item = glassItemsDatabase[i];
    const isMatch =
      item.piId === deletedPI.id ||
      item.piNumber === deletedPI.piNumber ||
      (cleanPiId && item.piId === cleanPiId) ||
      (cleanPiNo && item.piNumber === cleanPiNo);
    if (isMatch) {
      if (item.serialNumber) deletedIdentifiers.add(item.serialNumber);
      if (item.barcode) deletedIdentifiers.add(item.barcode);
      glassItemsDatabase.splice(i, 1);
    }
  }

  // Clean up associated history records
  for (let i = productionHistoryDatabase.length - 1; i >= 0; i--) {
    const h = productionHistoryDatabase[i];
    if (deletedIdentifiers.has(h.piNumber) || deletedIdentifiers.has(h.serialNumber) || deletedIdentifiers.has(h.barcode)) {
      productionHistoryDatabase.splice(i, 1);
    }
  }

  // Clean up associated reject records
  for (let i = rejectDatabase.length - 1; i >= 0; i--) {
    const r = rejectDatabase[i];
    if (deletedIdentifiers.has(r.piNumber) || deletedIdentifiers.has(r.serialNumber) || deletedIdentifiers.has(r.barcode)) {
      rejectDatabase.splice(i, 1);
    }
  }

  // Clean up associated rework records
  for (let i = reworkDatabase.length - 1; i >= 0; i--) {
    const rw = reworkDatabase[i];
    if (deletedIdentifiers.has(rw.piNumber) || deletedIdentifiers.has(rw.serialNumber) || deletedIdentifiers.has(rw.barcode)) {
      reworkDatabase.splice(i, 1);
    }
  }

  saveDatabase();
  broadcastUpdate("pi_deleted", { piId: deletedPI.id });
  const cleanBatchNo = (deletedPI.piNumber || "").replace(/^B(?=\d)/i, "");
  createAndBroadcastNotification({
    title: `Batch #${cleanBatchNo} Deleted`,
    message: `Batch ${cleanBatchNo} (${deletedPI.customerName || "Customer"}) removed from system`,
    category: "SYSTEM",
    type: "warning",
    piNumber: deletedPI.piNumber,
    operator: (req as any).user?.username || "Admin",
  });
  res.json({ message: `Batch ${cleanBatchNo} deleted successfully`, deletedPI });
};

export const handleReleasePI: RequestHandler = (req, res) => {
  const { id } = req.params;
  const pi = piDatabase.find((p) => p.id === id || p.piNumber === id);

  if (!pi) {
    res.status(404).json({ message: "PI document not found" });
    return;
  }

  pi.status = "In Production";

  const items = glassItemsDatabase.filter(
    (item) => item.piId === pi.id || item.piNumber === pi.piNumber
  );

  items.forEach((item) => {
    if (item.status === "Pending") {
      item.status = "In Production";
    }
  });

  saveDatabase();
  broadcastUpdate("pi_released", { piId: pi.id });
  createAndBroadcastNotification({
    title: `PI #${pi.piNumber} Released`,
    message: `Order for ${pi.customerName || "Customer"} (${items.length} items) released to shop floor workstations`,
    category: "PI_RELEASED",
    type: "success",
    piNumber: pi.piNumber,
    operator: (req as any).user?.username || "Supervisor",
  });
  res.json({ message: `PI ${pi.piNumber} released to production successfully`, pi, items });
};

