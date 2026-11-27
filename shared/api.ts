export type ProductionStage = "Cutting" | "Polishing" | "Pairing" | "DGU" | "Lamination" | "Finished" | "Dispatched";
export type WorkstationAssignment = ProductionStage | "Packing IGU" | "Auto Clave";
export type ProcessRoute = "Route A (Cut -> Finish)" | "Route B (Cut -> Pairing -> DGU -> Finish)" | "Route C (Cut -> Lam -> Finish)" | "Route D (Cut -> Pairing -> Lam -> Pairing -> DGU -> Finish)" | "Route E (Cut -> Polish -> Pairing -> DGU -> Finish)";
export type GlassStatus = "Pending" | "In Production" | "Completed" | "Rejected" | "Reworking";
export type UserRole = "Admin" | "Operator" | "Supervisor";

export interface GlassItem {
  id: string;
  piId: string;
  piNumber: string;
  serialNumber: string; // e.g. S001 or 1012627013490002
  barcode: string;      // e.g. 1012627013490002
  qrId: string;         // e.g. QR-1012627013490002
  orderNo?: string;     // e.g. 01707 / SFO/SG/262700384
  obNo?: string;        // e.g. 03084 / OB/SG/262700755
  sfoNo?: string;       // e.g. 1348 / SFO No 00384
  batchNo?: string;     // e.g. 1466
  posNo?: string;       // e.g. 1 / POS 1
  customerName?: string;// e.g. ASHBILIA ALUMINIUM / MERAKI FACADE
  projectName?: string; // e.g. DISTRICT_O / HAVEN_BY_A
  srNo?: number;
  itemCode: string;     // e.g. CW-88G1/FACTORY / 4B-AL06-GL01
  glassCode?: string;   // e.g. CW-88G1/FACTORY
  glassType: string;    // e.g. 8MM STOPRAY VISION 40 T CLEAR / 6MM SYP YBE 0140N CLEAR
  width: number;        // mm
  height: number;       // mm
  thickness?: string;   // mm
  qty: number;
  lineQty?: number;     // e.g. 5, 27 (Total position quantity from top header)
  rackNo?: string;      // e.g. "1", "2", "3" (Rack/Stillage lot number from sticker bottom right)
  sqm: number;
  taper?: string;
  holesCutout?: string;
  shape?: string;
  layer?: string;       // e.g. LAYER1 / LAYER2
  sectionName?: string; // e.g. Curtain Wall,Sliding Door,Hung Window & Sliding Window / Fix & Fix with Top Hung Glass
  category?: string;    // e.g. Clear Glass / Coloured Glass
  glassCategory?: "DGU" | "Lamination" | "DLGU"; // Process product category (DGU, Lamination, or DLGU)
  dlguPhase?: "LamPairing" | "DguPairing"; // Active pairing phase for DLGU items
  colorOrClear?: "Clear" | "Colour"; // Glass sticker finish/type
  finish?: "Clear" | "Colour";
  glassColor?: string;  // e.g. Euro Grey, Bronze, Blue, Green, Clear Float, etc.
  delLocation: string;  // FACTORY / SITE
  sketch?: string;      // SKETCH-01
  remarks?: string;     // Ground & 1st Floor-Sliding Glass...
  stickerRoute?: string;// e.g. CUT/POLISH ALL SIDES/HOLE/TMP/HST or CUT/EDGE/TMP
  hasPolish?: boolean;  // true if route requires Polishing workstation
  processRoute: ProductionStage[]; // array of stages e.g. ["Cutting", "Pairing", "DGU", "Finished"]
  currentStage: ProductionStage;
  status: GlassStatus;
  completedStages: ProductionStage[];
  isDispatched?: boolean;
  dispatchedAt?: string;
  dispatchNoteNo?: string;
  vehicleNo?: string;
  driverName?: string;
  delDate?: string;     // e.g. 07/08/2026 (Sticker delivery date)
  optDate?: string;     // e.g. 08/08/2026 (Sticker optimization date)
  makeup?: string;      // e.g. 8MM SYP YBE 0140N / 16MM BLACK SPACER / 13.52MM CLEAR LAMINATED
  packingRackNo?: string;  // e.g. "RACK A" or "RACK B" assigned at Finished Glass stage
  packingShift?: "Day" | "Night" | "A" | "B"; // Day or Night shift
  packedAt?: string;       // ISO timestamp when packed on rack
  packedBy?: string;       // Operator who packed onto rack
  packingStatus?: "Pending" | "Packed" | "Dispatched";
  sentToFinished?: boolean; // Set when unit on rack is advanced/sent to Finished stage
  sentToFinishedAt?: string;
  sentToFinishedBy?: string;
  createdAt?: string;
  updatedAt: string;
}

export interface PIMaster {
  id: string;
  piNumber: string;      // PI-20260725-001 or PI/SG/262700468
  customerName: string;  // e.g. SEJAL GLASS & GLASS MANUFACTURING PRODUCTS LLC
  batchNo?: string;      // e.g. 5846 / 5826
  jobOrderNumber: string;// e.g. SFO/SG/262700384
  projectName: string;   // e.g. ASTRA TWIN TOWER
  issueDate: string;     // e.g. 2026-07-25
  sfoNo?: string;        // e.g. 00384 / SFO/SG/262700384
  sfoDate?: string;      // e.g. 25-04-2026
  deliveryDate?: string; // e.g. 25-Apr-2026
  proformaInvNo?: string;// e.g. PI/SG/262700468
  fileName?: string;     // e.g. Glass1.pdf
  soNoDate?: string;     // e.g. SO22-10901 / 25-Apr-2026
  refContact?: string;   // e.g. JEET GADA
  dispatchType?: string; // e.g. FACTORY
  invoiceTo?: string;    // e.g. SEJAL GLASS LLC
  dispatchTo?: string;   // e.g. SEJAL GLASS LLC
  obNo?: string;         // e.g. 03084 / OB/SG/262700755
  purchaseOrderNo?: string; // e.g. PO-98765
  version?: string;      // e.g. 1.00
  refGlassWo?: string;   // e.g. GL-009
  refAlumWo?: string;    // e.g. AL-020
  totalQty?: number;
  totalSqm?: number;
  glassDescription?: string;
  glassCategory?: "DGU" | "Lamination" | "DLGU";
  colorOrClear?: "Clear" | "Colour";
  finish?: "Clear" | "Colour";
  glassColor?: string;
  status?: string;
  itemsCount?: number;
  completedItemsCount?: number;
  createdAt?: string;
}

export interface ProductionHistory {
  id: string;
  itemId?: string;
  serialNumber: string;
  barcode?: string;
  piNumber?: string;
  stage: ProductionStage | string;
  action?: string;
  prevStatus?: string;
  newStatus?: string;
  status?: "Completed" | "Rejected" | "Reworking" | string;
  operator: string;
  user?: string;
  itemOrBatch?: string;
  timestamp: string;
  durationMinutes?: number;
  notes?: string;
  remarks?: string;
  scannedBarcode?: string;
}

export interface RejectRecord {
  id: string;
  itemId?: string;
  serialNumber: string;
  barcode?: string;
  piNumber?: string;
  batchNo?: string;
  orderNo?: string;
  stage: ProductionStage;
  defectStation?: string;
  reason: string;
  defectType?: string;
  defectivePane?: "OP" | "IP" | "LAMI_INNER" | "BOTH_CLEAR" | "ASSEMBLY" | "SINGLE" | string;
  defectiveSerialNumber?: string;
  partnerSerialNumber?: string;
  notes?: string;
  date: string;
  operator: string;
  cost?: number;
  resolved?: boolean;
  resolvedAt?: string;
  status?: "Pending" | "Resolved" | string;
}

export interface ReworkRecord {
  id: string;
  itemId?: string;
  serialNumber: string;
  barcode?: string;
  piNumber?: string;
  batchNo?: string;
  orderNo?: string;
  fromStage: ProductionStage;
  toStage?: ProductionStage;
  targetStage?: ProductionStage;
  defectStation?: string;
  reason: string;
  defectivePane?: "OP" | "IP" | "LAMI_INNER" | "BOTH_CLEAR" | "ASSEMBLY" | "SINGLE" | string;
  defectiveSerialNumber?: string;
  partnerSerialNumber?: string;
  date: string;
  operator: string;
  resolved?: boolean;
  resolvedAt?: string;
  status?: "Pending" | "Completed" | string;
}

export interface DashboardStats {
  totalPI: number;
  stickerUploadCount?: number;
  pendingPI: number;
  completedPI: number;
  pendingCutting: number;
  pendingPolishing?: number;
  pendingPairing?: number;
  pendingLamination: number;
  pendingDGU: number;
  pendingPackingIGU?: number;
  pendingPackingLami?: number;
  finishedItems: number;
  dispatchedItems?: number;
  rejectItems: number;
  reworkItems: number;
  rejects?: RejectRecord[];
  reworks?: ReworkRecord[];
  userThroughputByStage?: Record<string, Record<string, { stickers: number; sqm: number; name?: string; username?: string }>>;
}

export interface ReportsResponse {
  pis: PIMaster[];
  items: GlassItem[];
  history: ProductionHistory[];
  rejects: RejectRecord[];
  reworks: ReworkRecord[];
}

export interface StageAnalytics {
  stage: ProductionStage;
  pendingCount: number;
  pendingSqm: number;
  completedCount: number;
  completedSqm: number;
  throughputRate: number; // units per day
  avgCycleTimeMinutes: number;
  capacityUtilization: number; // percentage 0-100
  rejectedCount?: number;
  qualityYield?: number; // percentage 0-100
  unitLabel?: "Pcs" | "Units";
}

export interface DefectAnalytics {
  reason: string;
  count: number;
  percentage: number;
  stage: ProductionStage | "General";
}

export interface OperatorStageMetric {
  completedCount: number;
  completedSqm: number;
  rejectCount: number;
  qualityRate: number;
  unitLabel?: "Pcs" | "Units";
}

export interface OperatorAnalytics {
  operator: string;
  name?: string;
  username?: string;
  role?: string;
  assignedStages?: string[];
  operationsCount: number;
  completedCount: number;
  completedSqm?: number;
  rejectCount: number;
  qualityRate: number; // percentage 0-100
  stageBreakdown?: Record<string, OperatorStageMetric>;
}

export interface ProductionTrendPoint {
  date: string;
  itemsCompleted: number;
  sqmCompleted: number;
}

export interface PIFulfillmentAnalytics {
  piNumber: string;
  customerName: string;
  projectName: string;
  totalItems: number;
  completedItems: number;
  totalSqm: number;
  completedSqm: number;
  completionPercentage: number;
  status: string;
  projectedFinishDate: string;
}

export interface BottleneckInfo {
  stage: ProductionStage | string;
  pendingUnits: number;
  pendingSqm: number;
  riskLevel: "Low" | "Medium" | "High";
  avgWaitHours: number;
  bottleneckReason: string;
  unitLabel?: "Pcs" | "Units";
}

export interface ProductTypeBreakdown {
  type: string;
  count: number;
  sqm: number;
  completedCount: number;
  pendingCount: number;
}

export interface PerformanceAnalyticsData {
  summary: {
    oee: number; // Overall Equipment Effectiveness %
    availability: number; // %
    performance: number; // %
    qualityRate: number; // %
    totalVolumeSqm: number;
    totalGlassItems: number;
    completedGlassItems: number;
    inProgressGlassItems: number;
    totalUnits?: number;
    completedUnits?: number;
    inProgressUnits?: number;
    completedSqm: number;
    inProgressSqm: number;
    rejectRate: number; // %
    reworkRate: number; // %
    onTimeDeliveryRate: number; // %
    activePIs: number;
    totalPIs: number;
    avgTurnaroundHours: number;
    dispatchedCount: number;
    dispatchedSqm: number;
    bottleneckStage: string;
  };
  stages: StageAnalytics[];
  defects: DefectAnalytics[];
  operators: OperatorAnalytics[];
  dailyTrends: ProductionTrendPoint[];
  piFulfillment: PIFulfillmentAnalytics[];
  productTypeBreakdown: ProductTypeBreakdown[];
  bottlenecks: BottleneckInfo[];
}

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  category?: "STAGE_ADVANCE" | "REJECTION" | "REWORK" | "BATCH_UPLOAD" | "PI_CREATED" | "PI_RELEASED" | "SYSTEM";
  type: "info" | "success" | "warning" | "destructive";
  stage?: string;
  serialNumber?: string;
  batchNumber?: string;
  piNumber?: string;
  operator?: string;
  timestamp: string;
  rawDate?: number;
  read: boolean;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  name: string;
  role: UserRole;
  assignedStages?: WorkstationAssignment[];
  customPermissions?: Partial<RolePermissions>;
  plainPassword?: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface UserSession {
  sessionId: string;
  userId: string;
  username: string;
  name: string;
  role: UserRole;
  assignedStages?: WorkstationAssignment[];
  ip: string;
  userAgent?: string;
  loginTime: string;
  lastHeartbeat: string;
  status: "Active" | "Idle";
}

export interface RolePermissions {
  role: UserRole;
  description: string;
  allowedModules: string[];
  canUploadPI: boolean;
  canDeletePI: boolean;
  canDispatch: boolean;
  canRejectRework: boolean;
  canViewReports: boolean;
  canViewAnalytics: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
  canClearData: boolean;
  // Granular floor tools & actions
  canCameraScan?: boolean;
  canPrintStickers?: boolean;
  canScanLookup?: boolean;
  canUndoStageAdvance?: boolean;
  // Granular order & batch tools
  canCreateManualPI?: boolean;
  canViewPIDocuments?: boolean;
  // Granular intelligence & export tools
  canExportReports?: boolean;
}

// ==========================================
// Barcode Configuration & Prefix Management
// ==========================================

export const BARCODE_PREFIX: string =
  (typeof process !== "undefined" && process?.env?.BARCODE_PREFIX) || "10126270";

export const KNOWN_BARCODE_PREFIXES: string[] = Array.from(
  new Set([
    BARCODE_PREFIX,
    "10126270",
    "10126",
    "101",
    ...(typeof process !== "undefined" && process?.env?.EXTRA_BARCODE_PREFIXES
      ? String(process.env.EXTRA_BARCODE_PREFIXES).split(",").map((p) => p.trim())
      : []),
  ].filter(Boolean))
);

export function formatGenericBarcode(
  sfoNo?: string,
  seqNo?: number | string,
  prefix: string = BARCODE_PREFIX
): string {
  const cleanSfo = String(sfoNo || "1344").replace(/[^0-9]/g, "");
  const sfoPad = (cleanSfo || "1344").padStart(5, "0").slice(-5);
  const seqPad = String(seqNo || "16").padStart(4, "0").slice(-4);
  return `${prefix}${sfoPad}${seqPad}`;
}

export const formatSejalBarcode = formatGenericBarcode;

export function cleanScannedBarcode(rawCode: string): string {
  if (!rawCode) return "";
  return String(rawCode)
    .trim()
    .replace(/^\][a-zA-Z0-9]{2}/, "") // Strip AIM symbology prefix (e.g. ]C1 for Code 128, ]Q1 for QR)
    .replace(/^QR[-_:]?/i, "")        // Strip QR- prefix
    .replace(/^BAR[-_:]?/i, "")       // Strip BAR- prefix
    .replace(/^#/, "")                // Strip leading #
    .replace(/[\x00-\x1F\x7F]/g, "")  // Strip non-printable control characters (STX, ETX, CR, LF, etc.)
    .trim();
}

/**
 * Checks whether a scanned code directly matches an item's explicit identity (id, serialNumber, barcode, qrId).
 */
export function isDirectIdentifierMatch(item: any, rawCode: string): boolean {
  if (!item || !rawCode) return false;
  const clean = cleanScannedBarcode(rawCode);
  if (!clean) return false;

  const cleanLower = clean.toLowerCase();
  const digitsOnly = clean.replace(/\D/g, "");
  const isPureNumeric = /^\d+$/.test(clean);

  if (item.id && String(item.id).toLowerCase() === cleanLower) return true;

  if (item.serialNumber) {
    const s = String(item.serialNumber).toLowerCase();
    if (s === cleanLower || s.replace(/^#/, "") === cleanLower) return true;
    const sDigits = s.replace(/\D/g, "");
    // Only match serial digits when the serial itself is numeric or the scanned code is barcode-length (>= 6 digits),
    // so short POS inputs like "4" never collide with "S004".
    if (
      isPureNumeric &&
      digitsOnly &&
      sDigits &&
      (/^\d+$/.test(s) || digitsOnly.length >= 6) &&
      (sDigits === digitsOnly || sDigits.replace(/^0+/, "") === digitsOnly.replace(/^0+/, ""))
    ) {
      return true;
    }
  }

  if (item.barcode) {
    const b = cleanScannedBarcode(String(item.barcode)).toLowerCase();
    if (b === cleanLower) return true;
    const bDigits = b.replace(/\D/g, "");
    if ((isPureNumeric || digitsOnly.length >= 10) && digitsOnly.length >= 6 && bDigits === digitsOnly) {
      return true;
    }
  }

  if (item.qrId) {
    const q = String(item.qrId).toLowerCase();
    if (q === cleanLower || q.replace(/^qr[-_:]?/i, "") === cleanLower) return true;
  }

  return false;
}

/**
 * Checks if a glass item matches a scanned code across barcode, QR, serial, POS, Order, and SFO formats.
 */
export function isItemMatchingCode(item: any, rawCode: string): boolean {
  if (!item || !rawCode) return false;
  const clean = cleanScannedBarcode(rawCode);
  if (!clean) return false;

  if (isDirectIdentifierMatch(item, clean)) return true;

  const cleanLower = clean.toLowerCase();
  const digitsOnly = clean.replace(/\D/g, "");
  const cleanNormalized = clean.replace(/[\s\-_/.]/g, "").toLowerCase();

  // If the scanned code is a full numeric sticker barcode (>= 10 digits) and this item already
  // carries a different explicit sticker barcode, do not fall back to SFO/POS/Order heuristics.
  if (/^\d+$/.test(clean) && digitsOnly.length >= 10 && item.barcode) {
    const itemBarcodeClean = cleanScannedBarcode(String(item.barcode));
    const itemBarcodeDigits = itemBarcodeClean.replace(/\D/g, "");
    if ((itemBarcodeDigits.length >= 10 && itemBarcodeDigits !== digitsOnly) || itemBarcodeClean.length >= 6) {
      return false;
    }
  }

  // 3. Formatted Generic & Sejal Barcode permutations (SFO / PI / Order / Batch with POS / Serial / srNo)
  const sfoSources = [item.sfoNo, item.orderNo, item.piNumber, item.batchNo].filter(Boolean) as string[];
  const seqSources = (
    item.posNo
      ? [item.posNo]
      : [item.srNo, item.serialNumber ? String(item.serialNumber).replace(/\D/g, "") : ""]
  ).filter(Boolean) as (string | number)[];

  const candidatePrefixes = Array.from(new Set([BARCODE_PREFIX, ...KNOWN_BARCODE_PREFIXES, ""]));
  for (const prefix of candidatePrefixes) {
    for (const sfo of sfoSources) {
      for (const seq of seqSources) {
        const generated = formatGenericBarcode(sfo, seq, prefix);
        if (generated === clean || generated === digitsOnly) return true;
      }
    }
  }

  // 4. Breakdown of numeric barcodes (Generic prefix + SFO + SEQ)
  if (digitsOnly.length >= 12) {
    for (const prefix of candidatePrefixes) {
      if (prefix && digitsOnly.startsWith(prefix)) {
        const remainder = digitsOnly.slice(prefix.length);
        if (remainder.length >= 6) {
          const seqPart4 = remainder.slice(-4).replace(/^0+/, "");
          const seqPart3 = remainder.slice(-3).replace(/^0+/, "");
          const sfoPart4 = remainder.slice(0, -4).replace(/^0+/, "");
          const sfoPart3 = remainder.slice(0, -3).replace(/^0+/, "");

          const matchesSeq = (seqP: string) =>
            seqSources.some((seq) => {
              const cleanSeq = String(seq).replace(/\D/g, "").replace(/^0+/, "");
              return cleanSeq && cleanSeq === seqP;
            });

          const matchesSfo = (sfoP: string) =>
            sfoSources.some((s) => {
              const cleanS = String(s).replace(/\D/g, "").replace(/^0+/, "");
              return cleanS && (cleanS === sfoP || cleanS === sfoP.replace(/^0+/, "") || sfoP === cleanS.replace(/^0+/, ""));
            });

          if ((matchesSeq(seqPart4) && matchesSfo(sfoPart4)) || (matchesSeq(seqPart3) && matchesSfo(sfoPart3))) {
            return true;
          }
        }
      }
    }
  }

  // 5. Position (POS) match (e.g. scanned "POS 1", "POS #1", "POS-1", "P1", "#1", or pure numeric "1", "3", "22")
  if (item.posNo) {
    const posStr = String(item.posNo).trim().toLowerCase();
    const posDigits = posStr.replace(/\D/g, "");
    if (
      cleanLower === posStr ||
      cleanLower === `pos ${posStr}` ||
      cleanLower === `pos #${posStr}` ||
      cleanLower === `pos-${posStr}` ||
      cleanLower === `pos${posStr}` ||
      cleanLower === `#${posStr}` ||
      cleanLower === `p${posStr}` ||
      cleanLower === `p-${posStr}` ||
      cleanLower === `pos.${posStr}` ||
      cleanLower === `pos. ${posStr}`
    ) {
      return true;
    }
    if (/^\d+$/.test(clean) && digitsOnly && posDigits && (digitsOnly === posDigits || digitsOnly.replace(/^0+/, "") === posDigits.replace(/^0+/, ""))) {
      if (digitsOnly.length <= 4) {
        return true;
      }
    }
  }

  // 6. Glass Code or Item Code match (exact or normalized without spaces)
  if (item.itemCode) {
    const ic = String(item.itemCode).trim().toLowerCase();
    if (ic === cleanLower || ic.replace(/[\s\-_/.]/g, "") === cleanNormalized) return true;
  }
  if (item.glassCode) {
    const gc = String(item.glassCode).trim().toLowerCase();
    if (gc === cleanLower || gc.replace(/[\s\-_/.]/g, "") === cleanNormalized) return true;
  }

  // 7. SFO / Order / OB / Batch number match (allows scanning Order/SFO/OB/Batch numbers on stickers)
  const orderIdentifiers = [
    item.sfoNo ? { val: item.sfoNo, label: "sfo" } : null,
    item.orderNo ? { val: item.orderNo, label: "order" } : null,
    item.obNo ? { val: item.obNo, label: "ob" } : null,
    item.batchNo ? { val: item.batchNo, label: "batch" } : null,
    item.piNumber ? { val: item.piNumber, label: "pi" } : null,
  ].filter(Boolean) as { val: string; label: string }[];
  for (const ident of orderIdentifiers) {
    const v = String(ident.val).trim().toLowerCase();
    if (v === cleanLower || `${ident.label} ${v}` === cleanLower) {
      return true;
    }
    const vDigits = v.replace(/\D/g, "").replace(/^0+/, "");
    const inputDigits = digitsOnly.replace(/^0+/, "");
    if (/^\d+$/.test(clean) && vDigits && inputDigits && vDigits === inputDigits && vDigits.length >= 3) {
      return true;
    }
  }

  return false;
}

/**
 * Returns matching items, strictly preferring direct identifier matches (id, serialNumber, barcode, qrId)
 * over secondary heuristic matches so exact barcode scans never collide with other POS items.
 */
export function findMatchingItemsByCode<T>(items: T[], rawCode: string): T[] {
  const clean = cleanScannedBarcode(rawCode);
  if (!clean) return [];
  const directMatches = items.filter((item) => isDirectIdentifierMatch(item, clean));
  if (directMatches.length > 0) return directMatches;
  return items.filter((item) => isItemMatchingCode(item, clean));
}

// ==========================================
// Glass Finish & Coated / Colour Detection
// ==========================================

export const COLOURED_COATED_GLASS_REGEX = /emicool|sunguard|stopray|syp|ykn|ybr|ybe|cardinal|low[- ]?e\b|lowe\b|c340|c-340|cg366|c272|c180|i89|guardian|\bsn\b|\bsn\s*\d+|skn|xtreme|sunergy|cool[- ]lite|solar|reflective|antelio|planibel|optitherm|planitherm|climaguard|climagard|suncool|eclipse|tint|coated|coat\b|frosted|ceramic|frit|colour|color|grey|gray|bronze|bronz|blue|green/i;

export function isGlassTypeColour(glassType?: string, glassColor?: string, category?: string): boolean {
  const combined = `${glassType || ""} ${glassColor || ""} ${category || ""}`.toLowerCase();
  return COLOURED_COATED_GLASS_REGEX.test(combined);
}

// ==========================================
// Product Classification Helpers
// ==========================================

export function isDlguGlass(item: { processRoute?: string[]; glassType?: string; glassCode?: string; itemCode?: string; glassCategory?: string; remarks?: string } | null | undefined): boolean {
  if (!item) return false;
  if (item.glassCategory === "DLGU") return true;
  if (item.glassCategory === "Lamination" || item.glassCategory === "Laminated") return false;
  if (Array.isArray(item.processRoute)) {
    if (item.processRoute.includes("Lamination") && item.processRoute.includes("DGU")) return true;
    if (item.processRoute.includes("Lamination") && !item.processRoute.includes("DGU")) return false;
  }
  const str = `${item.glassType || ""} ${item.glassCode || ""} ${item.itemCode || ""} ${item.remarks || ""}`.toLowerCase();
  const hasSpacer = /\b(spacer|dgu|igu|double|dlgu)\b/i.test(str);
  const hasLam = /\b(lam|lamination|laminated|pvb|sgp|eva|dlgu)\b/i.test(str);
  return (hasSpacer && hasLam) || str.includes("dlgu");
}

export function isDguGlass(item: { processRoute?: string[]; glassType?: string; glassCode?: string; glassCategory?: string; remarks?: string } | null | undefined): boolean {
  if (!item) return false;
  if (item.glassCategory === "DLGU") return false;
  if (item.glassCategory === "DGU") return true;
  if (item.glassCategory === "Lamination") return false;
  if (Array.isArray(item.processRoute)) {
    if (item.processRoute.includes("DGU") && !item.processRoute.includes("Lamination")) return true;
    if (item.processRoute.includes("Lamination")) return false;
  }
  const str = `${item.glassType || ""} ${item.glassCode || ""} ${item.remarks || ""}`.toLowerCase();
  const hasSpacer = /\b(spacer|dgu|igu|double)\b/i.test(str);
  const hasLam = /\b(lam|lamination|laminated|pvb|sgp|eva)\b/i.test(str);
  return hasSpacer && !hasLam;
}

export function isLaminatedGlass(item: { processRoute?: string[]; glassType?: string; glassCode?: string; itemCode?: string; glassCategory?: string; remarks?: string } | null | undefined): boolean {
  if (!item) return false;
  if (item.glassCategory === "DLGU") return false;
  if (item.glassCategory === "Lamination") return true;
  if (item.glassCategory === "DGU") return false;
  if (Array.isArray(item.processRoute)) {
    if (item.processRoute.includes("Lamination") && !item.processRoute.includes("DGU")) return true;
    if (item.processRoute.includes("DGU")) return false;
  }
  const str = `${item.glassType || ""} ${item.glassCode || ""} ${item.itemCode || ""} ${item.remarks || ""}`.toLowerCase();
  return /\b(lam|lamination|laminated|pvb|sgp|eva)\b/i.test(str);
}

/**
 * Counts active items in Pairing Buffer, treating post-lamination DLGU Clear panes
 * (2 panes fused together into 1 laminated piece) as 1 unit per pair.
 */
export function countPairingBufferUnits(
  items: Array<{
    qty?: number;
    glassCategory?: string;
    processRoute?: string[];
    glassType?: string;
    glassCode?: string;
    itemCode?: string;
    remarks?: string;
    colorOrClear?: string;
    finish?: string;
    category?: string;
    glassColor?: string;
    dlguPhase?: string;
    completedStages?: string[];
  }>
): number {
  const isPostLamDlguClear = (i: any) => {
    if (!isDlguGlass(i)) return false;
    const isCol =
      i.colorOrClear === "Colour" ||
      i.colorOrClear === "Color" ||
      i.finish === "Colour" ||
      String(i.category || "").toLowerCase().includes("colour") ||
      isGlassTypeColour(i.glassType, i.glassColor, i.category);
    if (isCol) return false;
    return Boolean(i.completedStages?.includes("Lamination") || i.dlguPhase === "DguPairing");
  };

  const postLamClearRaw = items
    .filter(isPostLamDlguClear)
    .reduce((acc, curr) => acc + (curr.qty || 1), 0);
  const otherRaw = items
    .filter((i) => !isPostLamDlguClear(i))
    .reduce((acc, curr) => acc + (curr.qty || 1), 0);

  return Math.ceil(postLamClearRaw / 2) + otherRaw;
}

export function isBatchUploadHistory(h: { serialNumber?: string; action?: string } | null | undefined): boolean {
  if (!h) return false;
  const sn = (h.serialNumber || "").toUpperCase();
  const act = (h.action || "").toLowerCase();
  return sn.startsWith("BATCH-") || act.includes("batch upload") || act.includes("batch uploaded");
}

export function isDlguStickerPairMatch(paneA: any, paneB: any): boolean {
  if (!paneA || !paneB) return false;
  if ((paneA.serialNumber && paneB.serialNumber && paneA.serialNumber === paneB.serialNumber) || (paneA.id && paneB.id && paneA.id === paneB.id)) return false;

  const isALamDone = Array.isArray(paneA.completedStages) && paneA.completedStages.includes("Lamination");
  const isBLamDone = Array.isArray(paneB.completedStages) && paneB.completedStages.includes("Lamination");

  const isAColour = paneA.colorOrClear === "Colour" || String(paneA.category || "").toLowerCase().includes("colour");
  const isBColour = paneB.colorOrClear === "Colour" || String(paneB.category || "").toLowerCase().includes("colour");

  // If one is Colour and one is Clear: Phase 2 (DGU Pairing)
  if (isAColour !== isBColour) {
    const clrPane = isAColour ? paneB : paneA;
    const isClrReady =
      clrPane.dlguPhase === "DguPairing" ||
      isALamDone ||
      isBLamDone ||
      (Array.isArray(clrPane.completedStages) && clrPane.completedStages.includes("Lamination"));
    if (!isClrReady) return false;
  }

  // 1. Order No / PI # must match
  if (paneA.orderNo && paneB.orderNo) {
    if (String(paneA.orderNo).trim().toLowerCase() !== String(paneB.orderNo).trim().toLowerCase()) return false;
  } else if (paneA.obNo && paneB.obNo) {
    if (String(paneA.obNo).trim().toLowerCase() !== String(paneB.obNo).trim().toLowerCase()) return false;
  } else {
    const colOrder = String(paneA.piNumber || paneA.piId || "").replace(/^STK-/i, "").trim().toLowerCase();
    const clrOrder = String(paneB.piNumber || paneB.piId || "").replace(/^STK-/i, "").trim().toLowerCase();
    if (colOrder && clrOrder && colOrder !== clrOrder) return false;
  }

  // 2. POS # (Position Number) must match
  const colPos = String(paneA.posNo || "").trim();
  const clrPos = String(paneB.posNo || "").trim();
  if (colPos && clrPos && colPos !== clrPos) return false;

  // 3. Exact Dimensions (Width & Height in mm) must match
  const colW = Number(paneA.width);
  const clrW = Number(paneB.width);
  const colH = Number(paneA.height);
  const clrH = Number(paneB.height);
  if (isNaN(colW) || isNaN(clrW) || colW !== clrW) return false;
  if (isNaN(colH) || isNaN(clrH) || colH !== clrH) return false;

  // 4. OB # must match (when present on both)
  const colOb = String(paneA.obNo || "").trim().toLowerCase();
  const clrOb = String(paneB.obNo || "").trim().toLowerCase();
  if (colOb && clrOb && colOb !== clrOb) return false;

  // 5. Line QTY / Order Qty must match (when present on both)
  const colQty = paneA.lineQty || paneA.totalQty;
  const clrQty = paneB.lineQty || paneB.totalQty;
  if (colQty && clrQty && colQty !== clrQty) return false;

  return true;
}

export function isStickerPairMatch(col: any, clr: any): boolean {
  if (!col || !clr) return false;
  if ((col.serialNumber && clr.serialNumber && col.serialNumber === clr.serialNumber) || (col.id && clr.id && col.id === clr.id)) return false;

  if (isDlguGlass(col) && isDlguGlass(clr)) {
    return isDlguStickerPairMatch(col, clr);
  }

  // STRICT RULE: Both panes must strictly be DGU glass and NEVER Lamination glass
  if (!isDguGlass(col) || !isDguGlass(clr)) return false;
  if (isLaminatedGlass(col) || isLaminatedGlass(clr)) return false;
  if (col.glassCategory === "Lamination" || clr.glassCategory === "Lamination") return false;

  // STRICT RULE: DGU requires 1 Colour outer lite + 1 Clear inner lite
  const isColFinishColour = (col.colorOrClear === "Colour" || col.colorOrClear === "Color" || String(col.category || "").toLowerCase().includes("colour"));
  const isClrFinishColour = (clr.colorOrClear === "Colour" || clr.colorOrClear === "Color" || String(clr.category || "").toLowerCase().includes("colour"));
  if (isColFinishColour === isClrFinishColour) return false;

  // 1. Order No / PI # must match
  if (col.orderNo && clr.orderNo) {
    if (String(col.orderNo).trim().toLowerCase() !== String(clr.orderNo).trim().toLowerCase()) return false;
  } else if (col.obNo && clr.obNo) {
    if (String(col.obNo).trim().toLowerCase() !== String(clr.obNo).trim().toLowerCase()) return false;
  } else {
    const colOrder = String(col.piNumber || col.piId || "").replace(/^STK-/i, "").trim().toLowerCase();
    const clrOrder = String(clr.piNumber || clr.piId || "").replace(/^STK-/i, "").trim().toLowerCase();
    if (colOrder && clrOrder && colOrder !== clrOrder) return false;
  }

  // 2. POS # (Position Number) must match
  const colPos = String(col.posNo || "").trim();
  const clrPos = String(clr.posNo || "").trim();
  if (colPos && clrPos && colPos !== clrPos) return false;

  // 3. Exact Dimensions (Width & Height in mm) must match
  const colW = Number(col.width);
  const clrW = Number(clr.width);
  const colH = Number(col.height);
  const clrH = Number(clr.height);
  if (isNaN(colW) || isNaN(clrW) || colW !== clrW) return false;
  if (isNaN(colH) || isNaN(clrH) || colH !== clrH) return false;

  // 4. OB # must match (when present on both)
  const colOb = String(col.obNo || "").trim().toLowerCase();
  const clrOb = String(clr.obNo || "").trim().toLowerCase();
  if (colOb && clrOb && colOb !== clrOb) return false;

  // 5. Line QTY / Order Qty must match (when present on both)
  const colQty = col.lineQty || col.totalQty;
  const clrQty = clr.lineQty || clr.totalQty;
  if (colQty && clrQty && colQty !== clrQty) return false;

  // 6. Glass Code must match (when present on both)
  const colCode = String(col.glassCode || col.itemCode || "").trim().toLowerCase();
  const clrCode = String(clr.glassCode || clr.itemCode || "").trim().toLowerCase();
  if (colCode && clrCode && colCode !== clrCode) return false;

  // 7. Client Name must match (when present on both)
  const colCust = String(col.customerName || "").trim().toLowerCase();
  const clrCust = String(clr.customerName || "").trim().toLowerCase();
  if (colCust && clrCust && colCust !== clrCust) return false;

  // 8. Project Name must match (when present on both)
  const colProj = String(col.projectName || "").trim().toLowerCase();
  const clrProj = String(clr.projectName || "").trim().toLowerCase();
  if (colProj && clrProj && colProj !== clrProj) return false;

  return true;
}

export const isDguStickerPairMatch = isStickerPairMatch;

export function isLaminationStickerPairMatch(paneA: any, paneB: any): boolean {
  if (!paneA || !paneB) return false;
  if (
    (paneA.serialNumber && paneB.serialNumber && paneA.serialNumber === paneB.serialNumber) ||
    (paneA.id && paneB.id && paneA.id === paneB.id)
  ) {
    return false;
  }

  // 0. If already stamped with matching lamPairId, they are definitely a pair
  const lamA = (paneA as any).lamPairId;
  const lamB = (paneB as any).lamPairId;
  if (lamA && lamB && lamA === lamB) return true;

  // STRICT RULE: Both panes must strictly be Lamination glass and NEVER DGU glass
  if (!isLaminatedGlass(paneA) || !isLaminatedGlass(paneB)) return false;
  if (isDguGlass(paneA) || isDguGlass(paneB)) return false;
  if (paneA.glassCategory === "DGU" || paneB.glassCategory === "DGU") return false;

  // STRICT RULE: Two identical panes of the SAME lite/batch cannot pair with each other!
  const barcodeA = String(paneA.barcode || "");
  const barcodeB = String(paneB.barcode || "");
  if (barcodeA && barcodeB && barcodeA === barcodeB) return false;

  const piA = String(paneA.piId || paneA.piNumber || "");
  const piB = String(paneB.piId || paneB.piNumber || "");
  const thickA = (paneA.thickness || paneA.glassType?.match(/^\d+(\.\d+)?\s*MM/i)?.[0] || "").toUpperCase().replace(/\s+/g, "");
  const thickB = (paneB.thickness || paneB.glassType?.match(/^\d+(\.\d+)?\s*MM/i)?.[0] || "").toUpperCase().replace(/\s+/g, "");

  // If from the same PI/Batch with the same thickness and same glassType, they are the same single lite and cannot pair!
  if (piA && piB && piA === piB && thickA && thickB && thickA === thickB && paneA.glassType === paneB.glassType) {
    return false;
  }

  // Must have a distinguishing lite characteristic (different thickness, different batch/PI, or different glassType)
  const isDifferentLite = (thickA && thickB && thickA !== thickB) || (piA && piB && piA !== piB) || (paneA.glassType !== paneB.glassType);
  if (!isDifferentLite) return false;

  // 1. Order No / PI # must match
  if (paneA.orderNo && paneB.orderNo) {
    if (String(paneA.orderNo).trim().toLowerCase() !== String(paneB.orderNo).trim().toLowerCase()) return false;
  } else if (paneA.obNo && paneB.obNo) {
    if (String(paneA.obNo).trim().toLowerCase() !== String(paneB.obNo).trim().toLowerCase()) return false;
  } else {
    const orderA = String(paneA.piNumber || paneA.piId || "").replace(/^STK-/i, "").trim().toLowerCase();
    const orderB = String(paneB.piNumber || paneB.piId || "").replace(/^STK-/i, "").trim().toLowerCase();
    if (orderA && orderB && orderA !== orderB) return false;
  }

  // 2. POS # (Position Number) must match
  const posA = String(paneA.posNo || "").trim();
  const posB = String(paneB.posNo || "").trim();
  if (posA && posB && posA !== posB) return false;

  // 3. Exact Dimensions (Width & Height in mm) must match
  const wA = Number(paneA.width);
  const wB = Number(paneB.width);
  const hA = Number(paneA.height);
  const hB = Number(paneB.height);
  if (isNaN(wA) || isNaN(wB) || Math.abs(wA - wB) > 1) return false;
  if (isNaN(hA) || isNaN(hB) || Math.abs(hA - hB) > 1) return false;

  // 4. OB # must match (when present on both)
  const obA = String(paneA.obNo || "").trim().toLowerCase();
  const obB = String(paneB.obNo || "").trim().toLowerCase();
  if (obA && obB && obA !== obB) return false;

  // 5. Line QTY / Order Qty must match (when present on both)
  const qtyA = paneA.lineQty || paneA.totalQty;
  const qtyB = paneB.lineQty || paneB.totalQty;
  if (qtyA && qtyB && qtyA !== qtyB) return false;

  return true;
}
