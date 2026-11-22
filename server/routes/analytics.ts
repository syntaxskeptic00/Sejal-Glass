import { RequestHandler } from "express";
import {
  ProductionStage,
  PerformanceAnalyticsData,
  StageAnalytics,
  DefectAnalytics,
  OperatorAnalytics,
  ProductionTrendPoint,
  PIFulfillmentAnalytics,
  ProductTypeBreakdown,
  BottleneckInfo,
  GlassItem,
  isDlguGlass,
  isDguGlass,
  isLaminatedGlass,
  isBatchUploadHistory,
} from "../../shared/api";
import {
  piDatabase,
  glassItemsDatabase,
  productionHistoryDatabase,
  rejectDatabase,
  reworkDatabase,
} from "./pi";
import { logger } from "../lib/logger";
import { getAllUserRecords } from "../lib/users";

function getDguEffectiveQtyAndSqm(item: GlassItem) {
  const isDgu = isDguGlass(item);
  const isDlgu = isDlguGlass(item);
  const isLami =
    isLaminatedGlass(item) ||
    item.glassCategory === "Lamination" ||
    (Array.isArray(item.processRoute) && item.processRoute.includes("Lamination"));
  if (isDlgu) {
    return {
      qty: 1,
      unitLabel: "DLGU Unit",
      sqm: item.sqm || parseFloat(((item.width * item.height) / 1000000).toFixed(2)),
    };
  }
  if (isDgu) {
    const unitQty = (item as any).isDguReduced ? item.qty : Math.ceil((item.qty || 1) / 2);
    const unitSqm = parseFloat(((item.width * item.height * unitQty) / 1000000).toFixed(2));
    return {
      qty: unitQty,
      unitLabel: "DGU Unit",
      sqm: unitSqm,
    };
  }
  if (isLami) {
    const unitQty = Math.ceil((item.qty || 1) / 2);
    const unitSqm = parseFloat(((item.width * item.height * unitQty) / 1000000).toFixed(2));
    return {
      qty: unitQty,
      unitLabel: "Laminated Unit",
      sqm: unitSqm,
    };
  }
  return {
    qty: item.qty || 1,
    unitLabel: "Pcs",
    sqm: item.sqm || parseFloat(((item.width * item.height * (item.qty || 1)) / 1000000).toFixed(2)),
  };
}

function computeUnits(list: GlassItem[]): number {
  const isColour = (i: any) =>
    (i.glassFinish || i.glassType || "").toLowerCase().includes("colour") ||
    (i.glassDescription || "").toLowerCase().includes("colour");
  const isLam = (i: any) =>
    isLaminatedGlass(i) ||
    i.glassCategory === "Lamination" ||
    (Array.isArray(i.processRoute) && i.processRoute.includes("Lamination"));
  const isDlgu = (i: any) => isDlguGlass(i);
  const isDgu = (i: any) => isDguGlass(i);

  const dlguList = list.filter(isDlgu);
  const pureDguList = list.filter((i) => isDgu(i) && !isDlgu(i));
  const nonDguList = list.filter((i) => !isDgu(i));

  const dlguColour = dlguList.filter(isColour).reduce((a, b) => a + (b.qty || 1), 0);
  const dlguClear = dlguList.filter((i) => !isColour(i)).reduce((a, b) => a + (b.qty || 1), 0);
  const dlguUnits =
    dlguColour > 0 && dlguClear > 0
      ? Math.min(dlguColour, Math.floor(dlguClear / 2))
      : Math.floor((dlguColour + dlguClear) / 3);

  const finDguColourPanes = pureDguList.filter(isColour).reduce((a, b) => a + (b.qty || 1), 0);
  const finDguClearPanes = pureDguList.filter((i) => !isColour(i)).reduce((a, b) => a + (b.qty || 1), 0);
  const pureDguUnits =
    finDguColourPanes > 0 && finDguClearPanes > 0
      ? Math.min(finDguColourPanes, finDguClearPanes)
      : finDguColourPanes > 0
      ? finDguColourPanes
      : Math.ceil(pureDguList.reduce((a, b) => a + (b.qty || 1), 0) / 2);

  const lamList = nonDguList.filter(isLam);
  const monoList = nonDguList.filter((i) => !isLam(i));
  const lamUnits = Math.ceil(lamList.reduce((a, b) => a + (b.qty || 1), 0) / 2);
  const monoUnits = monoList.reduce((a, b) => a + (b.qty || 1), 0);

  return dlguUnits + pureDguUnits + lamUnits + monoUnits;
}

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

export function isItemCompleted(item: any): boolean {
  if (!item || item.status === "Rejected" || (item as any).isRejected) return false;
  if (isItemInPackingStage(item)) return false;
  if (item.isDispatched || item.currentStage === "Dispatched") return true;
  if (Boolean(item.sentToFinished)) return true;
  if (item.packingRackNo && String(item.packingRackNo).toUpperCase().includes("DIRECT FINISH")) return true;
  if (item.currentStage === "Finished" && !isDguGlass(item) && !isDlguGlass(item) && !isLaminatedGlass(item)) return true;
  return false;
}

const ALL_STAGES: ProductionStage[] = ["Cutting", "Polishing", "Pairing", "DGU", "Lamination", "Finished"];

export const handleGetPerformanceAnalytics: RequestHandler = (req, res) => {
  try {
    const range = (req.query.range as string) || "all"; // "all" | "today" | "7days" | "30days"
    const projectFilter = (req.query.project as string || "").toLowerCase().trim();
    const batchFilter = (req.query.batch as string || "").toLowerCase().trim();
    const productTypeFilter = (req.query.productType as string || "all").toLowerCase().trim();
    const stageFilter = (req.query.stage as string || "all").toLowerCase().trim();
    const operatorFilter = (req.query.operator as string || "all").toLowerCase().trim();
    const statusFilter = (req.query.status as string || "all").toLowerCase().trim();

    const now = new Date();

    let cutoffDate: Date | null = null;
    if (range === "today") {
      cutoffDate = new Date();
      cutoffDate.setHours(0, 0, 0, 0);
    } else if (range === "7days") {
      cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);
    } else if (range === "30days") {
      cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
    }

    const filterByDate = (dateStr?: string) => {
      if (!cutoffDate || !dateStr) return true;
      const d = new Date(dateStr);
      return !isNaN(d.getTime()) && d >= cutoffDate;
    };

    // 1. Filter Glass Items
    const filteredItems = glassItemsDatabase.filter((item) => {
      // Date filter
      if (!filterByDate(item.updatedAt || item.createdAt)) return false;

      // Project filter
      if (projectFilter) {
        const pi = piDatabase.find((p) => p.id === item.piId || p.piNumber === item.piNumber);
        const custName = (pi?.customerName || "").toLowerCase();
        const projName = (pi?.projectName || "").toLowerCase();
        if (!custName.includes(projectFilter) && !projName.includes(projectFilter)) return false;
      }

      // Batch filter
      if (batchFilter) {
        const piNum = (item.piNumber || item.batchNo || "").toLowerCase();
        if (!piNum.includes(batchFilter)) return false;
      }

      // Product Type filter
      if (productTypeFilter !== "all") {
        if (productTypeFilter === "dlgu" && !isDlguGlass(item)) return false;
        if (productTypeFilter === "dgu" && (!isDguGlass(item) || isDlguGlass(item))) return false;
        if (productTypeFilter === "lamination" && (!isLaminatedGlass(item) || isDlguGlass(item))) return false;
        if (productTypeFilter === "single" && (isDguGlass(item) || isLaminatedGlass(item) || isDlguGlass(item))) return false;
      }

      // Stage filter
      if (stageFilter !== "all" && item.currentStage.toLowerCase() !== stageFilter) return false;

      // Status filter
      if (statusFilter !== "all" && (item.status || "Pending").toLowerCase() !== statusFilter) return false;

      return true;
    });

    // 2. Filter Production History Logs (Exclude batch upload audit logs from processed unit counts)
    const filteredHistory = productionHistoryDatabase.filter((h) => {
      if (isBatchUploadHistory(h)) return false;
      if (!filterByDate(h.timestamp)) return false;
      if (operatorFilter !== "all" && (h.operator || h.user || "").toLowerCase() !== operatorFilter) return false;
      if (stageFilter !== "all" && (h.stage || "").toLowerCase() !== stageFilter) return false;
      if (batchFilter && !(h.piNumber || "").toLowerCase().includes(batchFilter)) return false;
      return true;
    });

    // 3. Filter Rejects & Reworks
    const filteredRejects = rejectDatabase.filter((r) => {
      if (!filterByDate(r.date)) return false;
      if (operatorFilter !== "all" && (r.operator || "").toLowerCase() !== operatorFilter) return false;
      if (stageFilter !== "all" && (r.stage || "").toLowerCase() !== stageFilter) return false;
      if (batchFilter && !(r.piNumber || "").toLowerCase().includes(batchFilter)) return false;
      return true;
    });

    const filteredReworks = reworkDatabase.filter((rw) => {
      if (!filterByDate(rw.date)) return false;
      if (operatorFilter !== "all" && (rw.operator || "").toLowerCase() !== operatorFilter) return false;
      if (stageFilter !== "all" && (rw.targetStage || rw.fromStage || "").toLowerCase() !== stageFilter) return false;
      if (batchFilter && !(rw.piNumber || "").toLowerCase().includes(batchFilter)) return false;
      return true;
    });

    // 4. Executive Summary Calculations
    const totalGlassItems = filteredItems.reduce((acc, curr) => acc + (curr.qty || 1), 0);
    let totalVolumeSqm = 0;
    let completedSqm = 0;
    let inProgressSqm = 0;

    const completedItems = filteredItems.filter(isItemCompleted);
    const completedGlassItems = completedItems.reduce((acc, curr) => acc + (curr.qty || 1), 0);
    const rejectedGlassItems = filteredItems.filter((i) => i.status === "Rejected").reduce((acc, curr) => acc + (curr.qty || 1), 0);
    const inProgressGlassItems = Math.max(0, totalGlassItems - completedGlassItems - rejectedGlassItems);

    const totalUnits = computeUnits(filteredItems);
    const completedUnits = computeUnits(completedItems);
    const inProgressUnits = Math.max(0, totalUnits - completedUnits);

    filteredItems.forEach((item) => {
      const eff = getDguEffectiveQtyAndSqm(item);
      totalVolumeSqm += eff.sqm;
      if (isItemCompleted(item)) {
        completedSqm += eff.sqm;
      } else if (item.status !== "Rejected") {
        inProgressSqm += eff.sqm;
      }
    });

    const totalRejects = filteredRejects.length;
    const totalReworks = filteredReworks.length;
    const totalProcessedLogs = filteredHistory.length;

    const rejectRate =
      totalProcessedLogs + totalRejects > 0
        ? parseFloat(((totalRejects / (totalProcessedLogs + totalRejects)) * 100).toFixed(1))
        : 0;

    const reworkRate =
      totalProcessedLogs > 0
        ? parseFloat(((totalReworks / totalProcessedLogs) * 100).toFixed(1))
        : 0;

    const qualityRate = Math.max(0, parseFloat((100 - rejectRate).toFixed(1)));

    const performance =
      totalGlassItems > 0
        ? parseFloat(((completedGlassItems / totalGlassItems) * 100).toFixed(1))
        : 100;

    const activeItems = filteredItems.filter(
      (i) => i.currentStage !== "Cutting" || (i.completedStages && i.completedStages.length > 0)
    );
    const availability =
      totalGlassItems > 0
        ? parseFloat(((activeItems.length / totalGlassItems) * 100).toFixed(1))
        : 100;

    const oee = parseFloat(((availability * performance * qualityRate) / 10000).toFixed(1));

    const totalPIs = piDatabase.length;
    const completedPIs = piDatabase.filter((pi) => pi.status === "Completed").length;
    const activePIs = totalPIs - completedPIs;
    const onTimeDeliveryRate = totalPIs > 0 ? parseFloat(((completedPIs / totalPIs) * 100).toFixed(1)) : 100;

    // Average turnaround time calculation in hours
    let avgTurnaroundHours = 4.2;
    if (completedItems.length > 0) {
      let totalDurationMs = 0;
      let counted = 0;
      completedItems.forEach((item) => {
        if (item.createdAt && item.updatedAt) {
          const start = new Date(item.createdAt).getTime();
          const end = new Date(item.updatedAt).getTime();
          if (!isNaN(start) && !isNaN(end) && end >= start) {
            totalDurationMs += end - start;
            counted++;
          }
        }
      });
      if (counted > 0) {
        avgTurnaroundHours = parseFloat((totalDurationMs / (counted * 3600000)).toFixed(1)) || 3.5;
      }
    }

    // 5. Stage Analytics
    const benchmarkCycleTime: Record<string, number> = {
      Cutting: 15,
      Pairing: 10,
      Lamination: 45,
      DGU: 30,
      Finished: 10,
    };

    const stagesToAnalyze = stageFilter !== "all"
      ? ALL_STAGES.filter((s) => s.toLowerCase() === stageFilter)
      : ALL_STAGES;

    const stageAnalyticsMap: StageAnalytics[] = stagesToAnalyze.map((stage) => {
      if (stage === "Finished") {
        const finishedItemsList = filteredItems.filter(
          (i) => isItemCompleted(i)
        );
        const finishedUnits = computeUnits(finishedItemsList);
        const finishedSqm = finishedItemsList.reduce((acc, item) => acc + (item.sqm || 0), 0);
        const utilization =
          totalGlassItems > 0
            ? parseFloat(((finishedItemsList.length / totalGlassItems) * 100).toFixed(1))
            : 0;

        const stageRejects = filteredRejects.filter((r) => r.stage === "Finished" || r.stage === "Dispatched").length;
        const totalOps = finishedUnits + stageRejects;
        const qualityYield = totalOps > 0 ? parseFloat(((finishedUnits / totalOps) * 100).toFixed(1)) : 100;

        return {
          stage,
          pendingCount: 0,
          pendingSqm: 0,
          completedCount: finishedUnits,
          completedSqm: parseFloat(finishedSqm.toFixed(2)),
          throughputRate: finishedUnits,
          avgCycleTimeMinutes: 12,
          capacityUtilization: utilization,
          rejectedCount: stageRejects,
          qualityYield,
          unitLabel: "Units",
        };
      }

      const pending = filteredItems.filter(
        (i) => i.currentStage === stage && i.status !== "Completed" && i.status !== "Rejected"
      );
      const completedStageItems = filteredItems.filter((i) => i.completedStages?.includes(stage));

      const isPairedStage = stage === "DGU" || stage === "Lamination";
      const isSingleStage = stage === "Cutting" || stage === "Polishing" || stage === "Pairing";
      const unitLabel: "Pcs" | "Units" = isSingleStage ? "Pcs" : "Units";

      const pendingCount = isPairedStage ? Math.ceil(pending.length / 2) : pending.length;
      const completedCount = isPairedStage ? Math.ceil(completedStageItems.length / 2) : completedStageItems.length;

      const pendingSqm = isPairedStage
        ? pending.reduce((acc, item) => acc + (item.sqm || 0), 0) / 2
        : pending.reduce((acc, item) => acc + (item.sqm || 0), 0);
      const stageCompletedSqm = isPairedStage
        ? completedStageItems.reduce((acc, item) => acc + (item.sqm || 0), 0) / 2
        : completedStageItems.reduce((acc, item) => acc + (item.sqm || 0), 0);

      const totalStageUnits = pendingCount + completedCount;
      const utilization =
        totalStageUnits > 0 ? parseFloat(((completedCount / totalStageUnits) * 100).toFixed(1)) : 0;

      const stageRejects = filteredRejects.filter((r) => r.stage === stage).length;
      const totalOps = completedCount + stageRejects;
      const qualityYield = totalOps > 0 ? parseFloat(((completedCount / totalOps) * 100).toFixed(1)) : 100;

      return {
        stage,
        pendingCount,
        pendingSqm: parseFloat(pendingSqm.toFixed(2)),
        completedCount,
        completedSqm: parseFloat(stageCompletedSqm.toFixed(2)),
        throughputRate: completedCount,
        avgCycleTimeMinutes: benchmarkCycleTime[stage] || 20,
        capacityUtilization: utilization,
        rejectedCount: stageRejects,
        qualityYield,
        unitLabel,
      };
    });

    // 6. Bottleneck Identification
    let maxPendingUnits = 0;
    let bottleneckStageName = "None (Optimal)";

    const bottlenecks: BottleneckInfo[] = ALL_STAGES.filter((s) => s !== "Finished").map((stg) => {
      const pendingInStage = filteredItems.filter(
        (i) => i.currentStage === stg && i.status !== "Completed" && i.status !== "Rejected"
      );
      const isSingleStage = stg === "Cutting" || stg === "Polishing" || stg === "Pairing";
      const unitLabel: "Pcs" | "Units" = isSingleStage ? "Pcs" : "Units";
      const isPairedStage = stg === "DGU" || stg === "Lamination";
      const pendingUnits = isPairedStage ? Math.ceil(pendingInStage.length / 2) : pendingInStage.length;
      const pendingSqm = parseFloat(
        (isPairedStage
          ? pendingInStage.reduce((acc, i) => acc + (i.sqm || 0), 0) / 2
          : pendingInStage.reduce((acc, i) => acc + (i.sqm || 0), 0)
        ).toFixed(2)
      );

      let riskLevel: "Low" | "Medium" | "High" = "Low";
      let avgWaitHours = 1.2;
      let bottleneckReason = "Queue load normal; smooth operational flow";

      if (pendingUnits > 40) {
        riskLevel = "High";
        avgWaitHours = 6.8;
        bottleneckReason = `Heavy backlog (${pendingUnits} ${unitLabel} waiting). Machine or pairing queue threshold exceeded.`;
      } else if (pendingUnits > 15) {
        riskLevel = "Medium";
        avgWaitHours = 3.4;
        bottleneckReason = `Moderate queue build-up (${pendingUnits} ${unitLabel}). Advise increasing workstation pacing.`;
      }

      if (pendingUnits > maxPendingUnits && pendingUnits > 0) {
        maxPendingUnits = pendingUnits;
        bottleneckStageName = stg;
      }

      return {
        stage: stg,
        pendingUnits,
        pendingSqm,
        riskLevel,
        avgWaitHours,
        bottleneckReason,
        unitLabel,
      };
    });

    // 7. Product Type Breakdown (DLGU, DGU, Lamination) - Excludes Single Monolithic
    const isDlgu = (i: GlassItem) => isDlguGlass(i);
    const isDgu = (i: GlassItem) => isDguGlass(i) && !isDlguGlass(i);
    const isLam = (i: GlassItem) =>
      !isDguGlass(i) &&
      !isDlguGlass(i) &&
      (isLaminatedGlass(i) ||
        i.glassCategory === "Lamination" ||
        (Array.isArray(i.processRoute) && i.processRoute.includes("Lamination")));

    const dlguItems = filteredItems.filter(isDlgu);
    const dguItems = filteredItems.filter(isDgu);
    const lamItems = filteredItems.filter(isLam);

    const calcCategoryBreakdown = (itemsList: GlassItem[], label: string) => {
      const completedList = itemsList.filter(isItemCompleted);
      const totalUnits = computeUnits(itemsList);
      const completedUnits = computeUnits(completedList);
      const pendingUnits = Math.max(0, totalUnits - completedUnits);

      let unitSqm = 0;
      if (label === "DLGU Units") {
        unitSqm =
          itemsList.filter((i: any) => (i.glassFinish || i.glassType || "").toLowerCase().includes("colour")).reduce((a, b) => a + (b.sqm || 0), 0) ||
          (itemsList.reduce((a, b) => a + (b.sqm || 0), 0) / 3);
      } else if (label === "DGU / IGU Units") {
        unitSqm = itemsList.reduce((a, b) => a + (b.sqm || 0), 0) / 2;
      } else {
        unitSqm = itemsList.reduce((a, b) => a + (b.sqm || 0), 0) / 2;
      }

      return {
        type: label,
        count: totalUnits,
        sqm: parseFloat(unitSqm.toFixed(2)),
        completedCount: completedUnits,
        pendingCount: pendingUnits,
      };
    };

    const productTypeBreakdown: ProductTypeBreakdown[] = [
      calcCategoryBreakdown(dlguItems, "DLGU Units"),
      calcCategoryBreakdown(dguItems, "DGU / IGU Units"),
      calcCategoryBreakdown(lamItems, "Laminated Glass"),
    ];

    // 8. Quality Defect Analysis (Pareto Distribution)
    const defectMap: Record<string, { count: number; stage: ProductionStage | "General" }> = {};

    filteredRejects.forEach((r) => {
      const reason = r.reason || "General Quality Rejection";
      if (!defectMap[reason]) {
        defectMap[reason] = { count: 0, stage: r.stage || "General" };
      }
      defectMap[reason].count += 1;
    });

    filteredReworks.forEach((rw) => {
      const reason = rw.reason ? `Rework: ${rw.reason}` : "Rework Required";
      if (!defectMap[reason]) {
        defectMap[reason] = { count: 0, stage: rw.fromStage || "General" };
      }
      defectMap[reason].count += 1;
    });

    const totalDefectCount = Object.values(defectMap).reduce((acc, curr) => acc + curr.count, 0);
    const defectList: DefectAnalytics[] = Object.entries(defectMap)
      .map(([reason, data]) => ({
        reason,
        count: data.count,
        percentage: totalDefectCount > 0 ? parseFloat(((data.count / totalDefectCount) * 100).toFixed(1)) : 0,
        stage: data.stage,
      }))
      .sort((a, b) => b.count - a.count);

    // 9. Operator Performance Leaderboard with Workstation Stage Attribution & SQM
    const itemSqmLookup = new Map<string, number>();
    glassItemsDatabase.forEach((g) => {
      if (g.serialNumber) itemSqmLookup.set(g.serialNumber, g.sqm || 0);
      if (g.barcode) itemSqmLookup.set(g.barcode, g.sqm || 0);
    });

    const userRecords = getAllUserRecords();
    const userLookup = new Map<string, { name: string; username: string; role?: string; assignedStages?: string[] }>();
    userRecords.forEach((u) => {
      const uData = { name: u.name, username: u.username, role: u.role, assignedStages: u.assignedStages };
      userLookup.set(u.username.toLowerCase(), uData);
      userLookup.set(u.name.toLowerCase(), uData);
    });

    const opMap: Record<
      string,
      {
        name: string;
        username?: string;
        role?: string;
        assignedStages?: string[];
        operationsCount: number;
        completedCount: number;
        completedSqm: number;
        rejectCount: number;
        stageBreakdown: Record<string, { completedCount: number; completedSqm: number; rejectCount: number; qualityRate: number }>;
      }
    > = {};

    // Pre-seed all registered active floor operators so they always show in the leaderboard and stage filters even with 0 scans
    userRecords.forEach((u) => {
      if (u.isActive && u.role === "Operator") {
        opMap[u.name] = {
          name: u.name,
          username: u.username,
          role: u.role,
          assignedStages: u.assignedStages || [],
          operationsCount: 0,
          completedCount: 0,
          completedSqm: 0,
          rejectCount: 0,
          stageBreakdown: {},
        };
        (u.assignedStages || []).forEach((stg) => {
          const normStg = stg === "Finished" ? "Dispatched" : stg;
          opMap[u.name].stageBreakdown[normStg] = { completedCount: 0, completedSqm: 0, rejectCount: 0, qualityRate: 100 };
        });
      }
    });

    filteredHistory.forEach((h) => {
      const rawOp = h.user || h.operator || "Production Line";
      const matchedUser = userLookup.get(rawOp.toLowerCase());
      const resolvedName = matchedUser?.name || rawOp;
      const resolvedUsername = matchedUser?.username;
      const opKey = resolvedName;
      const rawStage = String(h.stage || "General");
      // Normalize stage name if needed
      const stg = rawStage === "Finished" ? "Dispatched" : rawStage;

      if (!opMap[opKey]) {
        opMap[opKey] = {
          name: resolvedName,
          username: resolvedUsername,
          role: matchedUser?.role,
          assignedStages: matchedUser?.assignedStages,
          operationsCount: 0,
          completedCount: 0,
          completedSqm: 0,
          rejectCount: 0,
          stageBreakdown: {},
        };
      }
      if (!opMap[opKey].stageBreakdown[stg]) {
        opMap[opKey].stageBreakdown[stg] = { completedCount: 0, completedSqm: 0, rejectCount: 0, qualityRate: 100 };
      }

      opMap[opKey].operationsCount += 1;

      const itemSqm = itemSqmLookup.get(h.serialNumber) || (h.barcode ? itemSqmLookup.get(h.barcode) : 0) || 0;

      if (h.status === "Completed") {
        opMap[opKey].completedCount += 1;
        opMap[opKey].completedSqm += itemSqm;
        opMap[opKey].stageBreakdown[stg].completedCount += 1;
        opMap[opKey].stageBreakdown[stg].completedSqm += itemSqm;
      }
      if (h.status === "Rejected") {
        opMap[opKey].rejectCount += 1;
        opMap[opKey].stageBreakdown[stg].rejectCount += 1;
      }
    });

    filteredRejects.forEach((r) => {
      const rawOp = r.operator || "Production Line";
      const matchedUser = userLookup.get(rawOp.toLowerCase());
      const resolvedName = matchedUser?.name || rawOp;
      const resolvedUsername = matchedUser?.username;
      const opKey = resolvedName;
      const rawStage = String(r.stage || "General");
      const stg = rawStage === "Finished" ? "Dispatched" : rawStage;

      if (!opMap[opKey]) {
        opMap[opKey] = {
          name: resolvedName,
          username: resolvedUsername,
          role: matchedUser?.role,
          assignedStages: matchedUser?.assignedStages,
          operationsCount: 0,
          completedCount: 0,
          completedSqm: 0,
          rejectCount: 0,
          stageBreakdown: {},
        };
      }
      if (!opMap[opKey].stageBreakdown[stg]) {
        opMap[opKey].stageBreakdown[stg] = { completedCount: 0, completedSqm: 0, rejectCount: 0, qualityRate: 100 };
      }
      opMap[opKey].rejectCount += 1;
      opMap[opKey].stageBreakdown[stg].rejectCount += 1;
    });

    const operatorList: OperatorAnalytics[] = Object.entries(opMap)
      .map(([operator, data]) => {
        const total = data.operationsCount + data.rejectCount;
        const opQualityRate = total > 0 ? parseFloat(((data.completedCount / total) * 100).toFixed(1)) : 100;

        // Calculate quality rate for each stage in the breakdown
        const formattedStageBreakdown: Record<string, { completedCount: number; completedSqm: number; rejectCount: number; qualityRate: number }> = {};
        Object.entries(data.stageBreakdown).forEach(([stageName, sData]) => {
          const sTotal = sData.completedCount + sData.rejectCount;
          const sYield = sTotal > 0 ? parseFloat(((sData.completedCount / sTotal) * 100).toFixed(1)) : 100;
          formattedStageBreakdown[stageName] = {
            completedCount: sData.completedCount,
            completedSqm: parseFloat(sData.completedSqm.toFixed(2)),
            rejectCount: sData.rejectCount,
            qualityRate: sYield,
          };
        });

        return {
          operator,
          name: data.name,
          username: data.username,
          role: data.role,
          assignedStages: data.assignedStages,
          operationsCount: data.operationsCount,
          completedCount: data.completedCount,
          completedSqm: parseFloat(data.completedSqm.toFixed(2)),
          rejectCount: data.rejectCount,
          qualityRate: opQualityRate,
          stageBreakdown: formattedStageBreakdown,
        };
      })
      .sort((a, b) => b.completedCount - a.completedCount || a.operator.localeCompare(b.operator));

    // 10. Daily / Timeline Production Trends
    const daysToShow = range === "today" ? 1 : range === "7days" ? 7 : range === "30days" ? 30 : 14;
    const trendMap: Record<string, { items: number; sqm: number }> = {};

    for (let i = daysToShow - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split("T")[0];
      trendMap[dateKey] = { items: 0, sqm: 0 };
    }

    filteredHistory.forEach((h) => {
      const dateKey = h.timestamp ? h.timestamp.split("T")[0] : new Date().toISOString().split("T")[0];
      if (!trendMap[dateKey]) {
        trendMap[dateKey] = { items: 0, sqm: 0 };
      }
      trendMap[dateKey].items += 1;

      const item = glassItemsDatabase.find((g) => g.serialNumber === h.serialNumber || g.barcode === h.barcode);
      if (item) {
        trendMap[dateKey].sqm += item.sqm || 0;
      }
    });

    const dailyTrends: ProductionTrendPoint[] = Object.entries(trendMap).map(([date, data]) => ({
      date,
      itemsCompleted: data.items,
      sqmCompleted: parseFloat(data.sqm.toFixed(2)),
    }));

    // 11. PI / Batch Fulfillment Analytics
    const piFulfillment: PIFulfillmentAnalytics[] = piDatabase.map((pi) => {
      const piItems = glassItemsDatabase.filter((i) => i.piId === pi.id || i.piNumber === pi.piNumber);
      const totalItems = piItems.length > 0 ? piItems.length : pi.itemsCount || 1;
      const completedItemsInPI = piItems.filter(isItemCompleted).length;
      const totalSqm = piItems.length > 0 ? piItems.reduce((a, b) => a + (b.sqm || 0), 0) : pi.totalSqm || 0;
      const compSqm = piItems
        .filter(isItemCompleted)
        .reduce((a, b) => a + (b.sqm || 0), 0);

      const percentage = totalItems > 0 ? parseFloat(((completedItemsInPI / totalItems) * 100).toFixed(1)) : 0;

      const projDate = new Date();
      if (percentage < 100) {
        const daysLeft = Math.ceil((100 - percentage) / 20);
        projDate.setDate(projDate.getDate() + daysLeft);
      }

      return {
        piNumber: pi.piNumber,
        customerName: pi.customerName || "Customer LLC",
        projectName: pi.projectName || "General Project",
        totalItems,
        completedItems: completedItemsInPI,
        totalSqm: parseFloat(totalSqm.toFixed(2)),
        completedSqm: parseFloat(compSqm.toFixed(2)),
        completionPercentage: percentage,
        status: pi.status || "In Production",
        projectedFinishDate: projDate.toISOString().split("T")[0],
      };
    });

    const responseData: PerformanceAnalyticsData = {
      summary: {
        oee,
        availability,
        performance,
        qualityRate,
        totalVolumeSqm: parseFloat(totalVolumeSqm.toFixed(2)),
        totalGlassItems,
        completedGlassItems,
        inProgressGlassItems,
        totalUnits,
        completedUnits,
        inProgressUnits,
        completedSqm: parseFloat(completedSqm.toFixed(2)),
        inProgressSqm: parseFloat(inProgressSqm.toFixed(2)),
        rejectRate,
        reworkRate,
        onTimeDeliveryRate,
        activePIs,
        totalPIs,
        avgTurnaroundHours,
        dispatchedCount: completedGlassItems,
        dispatchedSqm: parseFloat(completedSqm.toFixed(2)),
        bottleneckStage: bottleneckStageName,
      },
      stages: stageAnalyticsMap,
      defects: defectList,
      operators: operatorList,
      dailyTrends,
      piFulfillment,
      productTypeBreakdown,
      bottlenecks,
    };

    res.json(responseData);
  } catch (error: any) {
    logger.error("Error generating Performance Analytics", { error: error?.message || String(error) });
    res.status(500).json({ error: "Failed to generate Performance Analytics report" });
  }
};
