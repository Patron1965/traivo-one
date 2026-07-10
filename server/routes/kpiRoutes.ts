import type { Express } from "express";
import { primaryPayerCustomerIdSql } from "../services/object-customer";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from "../errors";
import { validateParentMetadataLink, softDeleteMetadataType, getObjectWithAllMetadata, getDisplayValue, getMetadataKatalogUsage, getMetadataDefinitionsCompat, getMetadataDefinitionCompat, katalogToDefinitionCompat, mapEnglishDataTypeToDatatyp, createMetadata, updateMetadata, deleteMetadata, ensurePackageMetadataKatalog, findMetadataTypeByIdentity, setMetadataInheritanceFlags } from "../metadata-queries";
import { requireAdmin, requirePlanner } from "../tenant-middleware";
import { isReasoningModel } from "../ai-model-capabilities";
import { objects, workOrders, metadataVarden, apiUsageLogs, apiBudgets, invitations, metadataKatalog, insertMetadataKatalogSchema, workOrderLines, articles, weeklyReportNotes, weeklyReportActionItemSchema, type WeeklyReportActionItem } from "@shared/schema";
import { getISOWeek, getStartOfISOWeek } from "./helpers";
import { sendEmail } from "../replit_integrations/resend";
import { issueMagicLink } from "../replit_integrations/auth/magicLinkAuth";
import { dashboardCache, DASHBOARD_CACHE_TTL } from "../services/dashboardCache";
import { mapTileLimiter, TILE_HOURLY_ALERT_THRESHOLD } from "../middleware/rate-limit";

export async function registerKPIRoutes(app: Express) {
// ============================================
// KPI / ANALYTICS ENDPOINTS
// ============================================

app.get("/api/kpis/daily", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const dateParam = req.query.date as string;
    const date = dateParam ? new Date(dateParam) : new Date();
    const dateKey = date.toISOString().split("T")[0];
    const todayKey = new Date().toISOString().split("T")[0];
    const ttl = dateKey === todayKey
      ? DASHBOARD_CACHE_TTL.KPI_TODAY_MS
      : DASHBOARD_CACHE_TTL.KPI_HISTORICAL_MS;

    const payload = await dashboardCache.getOrCompute(
      tenantId,
      `kpi:daily:${dateKey}`,
      ttl,
      async () => {
        const orders = await storage.getWorkOrdersByDate(tenantId, date);
          const resources = await storage.getResources(tenantId);

          // Tenant-default planning parameter (customerId=null, objectId=null) —
          // ger dagsmål/stopp-per-timme för break-even-beräkning i Produktionsledare.
          const allParams = await storage.getPlanningParameters(tenantId);
          const tenantParam = allParams.find(p => !p.customerId && !p.objectId) ?? null;
          const tenantDefaults = tenantParam ? {
            dailyStopTarget: tenantParam.dailyStopTarget ?? null,
            stopsPerHour: tenantParam.stopsPerHour ?? null,
          } : null;

          const objectIds = Array.from(new Set(orders.map(o => o.objectId).filter(Boolean) as string[]));
          const containerByObject = new Map<string, number>();
          if (objectIds.length > 0) {
            // Etapp 5: kärl-antal läses ur metadata ('Antal kärl'), ej objektkolumner.
            const { getObjectsMetadataValueByKatalogNamn } = await import("../metadata-queries");
            const karlValues = await getObjectsMetadataValueByKatalogNamn(tenantId, objectIds, "Antal kärl");
            for (const [objectId, value] of Object.entries(karlValues)) {
              const n = parseInt(value, 10);
              if (Number.isFinite(n)) containerByObject.set(objectId, n);
            }
          }
          const isDeviation = (o: typeof orders[number]) =>
            o.orderStatus === "omojlig" || o.orderStatus === "avbruten";

          const completed = orders.filter(o =>
            o.completedAt || o.orderStatus === "utford" || o.executionStatus === "completed"
          );
          const remaining = orders.filter(o =>
            !o.completedAt && o.orderStatus !== "utford" && o.executionStatus !== "completed"
          );

          const durationsMinutes = completed
            .map(o => o.actualDuration || o.estimatedDuration || 0)
            .filter(d => d > 0);
          const avgTimePerTask = durationsMinutes.length > 0
            ? Math.round(durationsMinutes.reduce((a, b) => a + b, 0) / durationsMinutes.length)
            : 0;

          const activeResources = resources.filter(r =>
            orders.some(o => o.resourceId === r.id)
          );

          const resourceKpis = activeResources.map(r => {
            const resourceOrders = orders.filter(o => o.resourceId === r.id);
            const resourceCompleted = resourceOrders.filter(o =>
              o.completedAt || o.orderStatus === "utford" || o.executionStatus === "completed"
            );
            const resourceDurations = resourceCompleted
              .map(o => o.actualDuration || o.estimatedDuration || 0)
              .filter(d => d > 0);
            const plannedContainers = resourceOrders.reduce(
              (s, o) => s + (o.objectId ? (containerByObject.get(o.objectId) || 0) : 0),
              0,
            );
            const completedContainers = resourceCompleted.reduce(
              (s, o) => s + (o.objectId ? (containerByObject.get(o.objectId) || 0) : 0),
              0,
            );
            const deviationCount = resourceOrders.filter(isDeviation).length;
            const plannedMinutes = resourceOrders.reduce(
              (s, o) => s + (o.estimatedDuration || 0),
              0,
            );
            const actualMinutes = resourceCompleted.reduce(
              (s, o) => s + (o.actualDuration || o.estimatedDuration || 0),
              0,
            );
            return {
              plannedMinutes,
              actualMinutes,
              resourceId: r.id,
              resourceName: r.name,
              totalTasks: resourceOrders.length,
              completedTasks: resourceCompleted.length,
              remainingTasks: resourceOrders.length - resourceCompleted.length,
              avgTimeMinutes: resourceDurations.length > 0
                ? Math.round(resourceDurations.reduce((a, b) => a + b, 0) / resourceDurations.length)
                : 0,
              plannedContainers,
              completedContainers,
              deviationCount,
              weeklyHours: r.weeklyHours ?? null,
              efficiencyFactor: r.efficiencyFactor ?? null,
            };
          });

          return {
            date: dateKey,
            totalTasks: orders.length,
            completedTasks: completed.length,
            remainingTasks: remaining.length,
            completionRate: orders.length > 0 ? Math.round((completed.length / orders.length) * 100) : 0,
            avgTimePerTaskMinutes: avgTimePerTask,
            activeResources: activeResources.length,
            totalDeviations: orders.filter(isDeviation).length,
            totalContainersPlanned: orders.reduce(
              (s, o) => s + (o.objectId ? (containerByObject.get(o.objectId) || 0) : 0),
              0,
            ),
            totalContainersCompleted: completed.reduce(
              (s, o) => s + (o.objectId ? (containerByObject.get(o.objectId) || 0) : 0),
              0,
            ),
            tenantDefaults,
            resourceKpis,
          };
      },
    );
    res.json(payload);
}));

app.get("/api/kpis/weekly", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const weekParam = req.query.week as string;

    let startOfWeek: Date;
    if (weekParam) {
      startOfWeek = new Date(weekParam);
    } else {
      startOfWeek = new Date();
      const day = startOfWeek.getDay();
      const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
      startOfWeek.setDate(diff);
    }
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const weekKey = startOfWeek.toISOString().split("T")[0];
    const now = new Date();
    const isCurrentWeek = now >= startOfWeek && now <= endOfWeek;
    const ttl = isCurrentWeek
      ? DASHBOARD_CACHE_TTL.KPI_TODAY_MS
      : DASHBOARD_CACHE_TTL.KPI_HISTORICAL_MS;

    const payload = await dashboardCache.getOrCompute(
      tenantId,
      `kpi:weekly:${weekKey}`,
      ttl,
      async () => {
        const prevStart = new Date(startOfWeek);
        prevStart.setDate(prevStart.getDate() - 7);
        const prevEnd = new Date(startOfWeek);
        prevEnd.setMilliseconds(-1);

        const [thisWeek, prevWeek] = await Promise.all([
          storage.getWorkOrders(tenantId, startOfWeek, endOfWeek, true),
          storage.getWorkOrders(tenantId, prevStart, prevEnd, true),
        ]);

        const calcStats = (orders: typeof thisWeek) => {
          const completed = orders.filter(o => o.completedAt || o.orderStatus === "utford" || o.executionStatus === "completed");
          const durations = completed.map(o => o.actualDuration || o.estimatedDuration || 0).filter(d => d > 0);
          return {
            totalTasks: orders.length,
            completedTasks: completed.length,
            completionRate: orders.length > 0 ? Math.round((completed.length / orders.length) * 100) : 0,
            avgTimeMinutes: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
          };
        };

        const current = calcStats(thisWeek);
        const previous = calcStats(prevWeek);

        return {
          weekStart: weekKey,
          weekEnd: endOfWeek.toISOString().split("T")[0],
          current,
          previous,
          trends: {
            tasksDelta: current.totalTasks - previous.totalTasks,
            completionRateDelta: current.completionRate - previous.completionRate,
            avgTimeDelta: current.avgTimeMinutes - previous.avgTimeMinutes,
          },
        };
      },
    );
    res.json(payload);
}));

// Marginal per artikel: aggregerar work_order_lines × articles
// Endast admin/owner — innehåller intern kostnadsdata
app.get("/api/kpis/article-margins", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawLimit = parseInt(String(req.query.limit || "50"), 10) || 50;
    const limit = Math.min(Math.max(1, rawLimit), 200);

    const rows = await db
      .select({
        articleId: workOrderLines.articleId,
        articleNumber: articles.articleNumber,
        name: articles.name,
        // Självkostnad (inköp + frakt + lager) när någon komponent satts, annars legacy internkostnad. GAP-104 / Task #938.
        unitCost: sql<number>`CASE WHEN ${articles.purchasePrice} IS NOT NULL OR ${articles.freightCost} IS NOT NULL OR ${articles.warehouseCost} IS NOT NULL THEN COALESCE(${articles.purchasePrice}, 0) + COALESCE(${articles.freightCost}, 0) + COALESCE(${articles.warehouseCost}, 0) ELSE ${articles.cost} END`,
        listPrice: articles.listPrice,
        totalRevenue: sql<string>`COALESCE(SUM(${workOrderLines.quantity} * COALESCE(${workOrderLines.resolvedPrice}, 0)), 0)::bigint`,
        totalCost: sql<string>`COALESCE(SUM(${workOrderLines.quantity} * COALESCE(${workOrderLines.resolvedCost}, 0)), 0)::bigint`,
        totalQuantity: sql<number>`COALESCE(SUM(${workOrderLines.quantity}), 0)::numeric`,
        lineCount: sql<number>`COUNT(*)::int`,
      })
      .from(workOrderLines)
      .innerJoin(workOrders, eq(workOrderLines.workOrderId, workOrders.id))
      .leftJoin(articles, eq(workOrderLines.articleId, articles.id))
      .where(and(
        eq(workOrderLines.tenantId, tenantId),
        sql`${workOrders.deletedAt} IS NULL`,
        sql`${workOrderLines.isOptional} IS NOT TRUE`,
      ))
      .groupBy(workOrderLines.articleId, articles.articleNumber, articles.name, articles.cost, articles.purchasePrice, articles.freightCost, articles.warehouseCost, articles.listPrice)
      .orderBy(desc(sql`SUM(${workOrderLines.quantity} * COALESCE(${workOrderLines.resolvedPrice}, 0))`))
      .limit(limit);

    const result = rows.map(r => {
      const revenue = Number(r.totalRevenue) || 0;
      const cost = Number(r.totalCost) || 0;
      const margin = revenue - cost;
      return {
        articleId: r.articleId,
        articleNumber: r.articleNumber,
        name: r.name,
        unitCost: r.unitCost,
        listPrice: r.listPrice,
        totalRevenue: revenue,
        totalCost: cost,
        totalMargin: margin,
        marginPercent: revenue > 0 ? Math.round((margin / revenue) * 100) : 0,
        totalQuantity: Number(r.totalQuantity) || 0,
        lineCount: r.lineCount,
      };
    });

    res.json(result);
}));

app.post("/api/system/weekly-report/trigger", requireAdmin, asyncHandler(async (req, res) => {
    const result = await generateAndSendWeeklyReports();
    res.json(result);
}));

// ============================================
// TASK #522: VECKOMÖTES-RAPPORT
// ============================================

// Hjälpare: ISO-vecka + start (måndag 00:00 lokal)
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
function isoYearFor(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}
function startOfMondayWeek(input?: string | Date): Date {
  const base = input ? new Date(input) : new Date();
  const day = base.getDay();
  const diff = base.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(base);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

app.get("/api/reports/weekly", requirePlanner, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const weekStart = startOfMondayWeek(req.query.week as string | undefined);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const teamFilter = (req.query.teamId as string | undefined) || null;
  const clusterFilter = (req.query.clusterId as string | undefined) || null;

  const isoYear = isoYearFor(weekStart);
  const isoWeek = isoWeekNumber(weekStart);

  // 4-veckorshistorik (denna vecka + 3 föregående)
  const fourWeekRanges: { start: Date; end: Date; isoWeek: number; isoYear: number }[] = [];
  for (let i = 3; i >= 0; i--) {
    const s = new Date(weekStart);
    s.setDate(s.getDate() - i * 7);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    fourWeekRanges.push({ start: s, end: e, isoWeek: isoWeekNumber(s), isoYear: isoYearFor(s) });
  }
  const trendFetchStart = fourWeekRanges[0].start;
  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const nextWeekEnd = new Date(nextWeekStart);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);
  nextWeekEnd.setHours(23, 59, 59, 999);

  const [allTrendOrders, nextWeekOrders, resources, deviationsAll, teams, notesRow, feedbackSummary] = await Promise.all([
    storage.getWorkOrders(tenantId, trendFetchStart, weekEnd, true),
    storage.getWorkOrders(tenantId, nextWeekStart, nextWeekEnd, true),
    storage.getResources(tenantId),
    storage.getDeviationReports(tenantId, {}),
    storage.getTeams(tenantId),
    db.select().from(weeklyReportNotes).where(and(
      eq(weeklyReportNotes.tenantId, tenantId),
      eq(weeklyReportNotes.isoYear, isoYear),
      eq(weeklyReportNotes.isoWeek, isoWeek),
    )).limit(1),
    storage.getRouteFeedbackSummary(tenantId, {
      startDate: weekStart.toISOString().split("T")[0],
      endDate: weekEnd.toISOString().split("T")[0],
    }).catch(() => null),
  ]);

  const matchesFilter = (wo: any) => {
    if (teamFilter && wo.teamId !== teamFilter) return false;
    if (clusterFilter && wo.clusterId !== clusterFilter) return false;
    return true;
  };
  const filteredTrend = allTrendOrders.filter(matchesFilter);
  const filteredNext = nextWeekOrders.filter(matchesFilter);

  // Etapp 5: kärl-antal per objekt läses ur metadata ('Antal kärl'), ej objektkolumner.
  const containersByObjectId = new Map<string, number>();
  {
    const trendObjectIds = Array.from(new Set(
      [...filteredTrend, ...filteredNext].map((o: any) => o.objectId).filter(Boolean) as string[]
    ));
    if (trendObjectIds.length > 0) {
      const { getObjectsMetadataValueByKatalogNamn } = await import("../metadata-queries");
      const karlValues = await getObjectsMetadataValueByKatalogNamn(tenantId, trendObjectIds, "Antal kärl");
      for (const [objectId, value] of Object.entries(karlValues)) {
        const n = parseInt(value, 10);
        if (Number.isFinite(n)) containersByObjectId.set(objectId, n);
      }
    }
  }

  // Bygg per-vecka KPI:er
  function periodStats(orders: any[]) {
    const completed = orders.filter(o => o.completedAt || o.orderStatus === "utford" || o.executionStatus === "completed");
    const containers = completed.reduce((s, o) => {
      const c = o.objectId ? (containersByObjectId.get(o.objectId) || 0) : 0;
      return s + c;
    }, 0);
    const revenue = completed.reduce((s, o) => s + (o.cachedValue || 0), 0);
    const durations = completed.map(o => o.actualDuration || o.estimatedDuration || 0).filter(d => d > 0);
    const avgLeadMinutes = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const totalEstimated = orders.reduce((s, o) => s + (o.estimatedDuration || 0), 0);
    const slaCandidates = orders.filter(o => o.plannedWindowStart || o.desiredDeliveryStart);
    const slaBreaches = slaCandidates.filter(o => o.outsidePreferredWindow === true).length;
    const slaRate = slaCandidates.length > 0
      ? Math.round(((slaCandidates.length - slaBreaches) / slaCandidates.length) * 100)
      : (orders.length > 0 ? 100 : 0);
    return {
      totalOrders: orders.length,
      completedOrders: completed.length,
      completionRate: orders.length > 0 ? Math.round((completed.length / orders.length) * 100) : 0,
      containers,
      revenue,
      avgLeadMinutes,
      totalEstimatedMinutes: totalEstimated,
      slaRate,
      slaBreaches,
    };
  }

  const trendByWeek = fourWeekRanges.map((range) => {
    const ordersInWeek = filteredTrend.filter(o => {
      const d = o.scheduledDate ? new Date(o.scheduledDate) : null;
      return d && d >= range.start && d <= range.end;
    });
    return {
      isoYear: range.isoYear,
      isoWeek: range.isoWeek,
      weekStart: range.start.toISOString().split("T")[0],
      ...periodStats(ordersInWeek),
    };
  });
  const currentWeekStats = trendByWeek[trendByWeek.length - 1];
  const previousWeekStats = trendByWeek[trendByWeek.length - 2];

  // Resursproduktivitet (denna vecka)
  const currentOrders = filteredTrend.filter(o => {
    const d = o.scheduledDate ? new Date(o.scheduledDate) : null;
    return d && d >= weekStart && d <= weekEnd;
  });
  const resourceById = new Map(resources.map(r => [r.id, r]));
  const perResource = new Map<string, { name: string; total: number; completed: number; minutes: number }>();
  for (const o of currentOrders) {
    if (!o.resourceId) continue;
    const r = resourceById.get(o.resourceId);
    const key = o.resourceId;
    if (!perResource.has(key)) perResource.set(key, { name: r?.name || "Okänd", total: 0, completed: 0, minutes: 0 });
    const entry = perResource.get(key)!;
    entry.total++;
    if (o.completedAt || o.orderStatus === "utford" || o.executionStatus === "completed") {
      entry.completed++;
      entry.minutes += o.actualDuration || o.estimatedDuration || 0;
    }
  }
  const resourcePerformance = Array.from(perResource.entries())
    .map(([resourceId, v]) => ({ resourceId, ...v, efficiency: v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0 }))
    .sort((a, b) => b.completed - a.completed);

  // Avvikelser denna vecka
  const weekDeviations = deviationsAll.filter((d: any) => {
    const created = d.reportedAt ? new Date(d.reportedAt) : d.createdAt ? new Date(d.createdAt) : null;
    return created && created >= weekStart && created <= weekEnd;
  });
  const openDeviations = deviationsAll.filter((d: any) => d.status === "open" || d.status === "pending");
  const categoryMap = new Map<string, number>();
  const rootCauseMap = new Map<string, number>();
  for (const d of weekDeviations) {
    const cat = d.category || "ovrigt";
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    const root = d.rootCause || d.cause || d.reason || null;
    if (root) rootCauseMap.set(String(root), (rootCauseMap.get(String(root)) || 0) + 1);
  }
  const deviationSummary = {
    weekTotal: weekDeviations.length,
    openTotal: openDeviations.length,
    critical: weekDeviations.filter((d: any) => d.severityLevel === "critical" || d.requiresImmediateAction).length,
    resolved: weekDeviations.filter((d: any) => d.status === "resolved" || d.status === "closed").length,
    byCategory: Array.from(categoryMap.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    rootCauses: Array.from(rootCauseMap.entries()).map(([cause, count]) => ({ cause, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    topOpen: openDeviations.slice(0, 10).map((d: any) => ({
      id: d.id,
      title: d.description || d.title || "Avvikelse",
      category: d.category || null,
      severity: d.severityLevel || null,
      reportedAt: d.reportedAt || d.createdAt || null,
    })),
  };

  // Nästa vecka — plan + kapacitet
  const nextPlannedMinutes = filteredNext.reduce((s, o) => s + (o.estimatedDuration || 0), 0);
  const activeResources = resources.filter(r => r.status === "active" || !r.status);
  const capacityMinutes = activeResources.reduce((s, r) => s + ((r.weeklyHours ?? 40) * 60), 0);
  const nextPlan = {
    totalOrders: filteredNext.length,
    plannedMinutes: nextPlannedMinutes,
    capacityMinutes,
    utilizationRate: capacityMinutes > 0 ? Math.round((nextPlannedMinutes / capacityMinutes) * 100) : 0,
    activeResourceCount: activeResources.length,
    perPriority: ["urgent", "high", "normal", "low"].map(p => ({
      priority: p,
      count: filteredNext.filter(o => (o.priority || "normal") === p).length,
    })).filter(x => x.count > 0),
  };

  // Kvalitet
  const quality = {
    routeFeedback: feedbackSummary ? {
      avgRating: feedbackSummary.avgRating || 0,
      totalCount: feedbackSummary.totalCount || 0,
      ratingDistribution: feedbackSummary.ratingDistribution || {},
    } : null,
    anomalies: {
      impossibleOrders: currentOrders.filter(o => o.orderStatus === "omojlig").length,
      cancelledOrders: currentOrders.filter(o => o.orderStatus === "avbruten").length,
    },
  };

  // Manuella bestämpunkter
  const notes = notesRow[0] ?? null;
  const decisionsPayload = {
    decisions: notes?.decisions ?? "",
    actionItems: (notes?.actionItems as WeeklyReportActionItem[] | null) ?? [],
    updatedAt: notes?.updatedAt ?? null,
    updatedBy: notes?.updatedBy ?? null,
  };

  res.json({
    isoYear,
    isoWeek,
    weekStart: weekStart.toISOString().split("T")[0],
    weekEnd: weekEnd.toISOString().split("T")[0],
    filters: { teamId: teamFilter, clusterId: clusterFilter },
    teams: teams.map(t => ({ id: t.id, name: t.name })),
    current: currentWeekStats,
    previous: previousWeekStats,
    trend: trendByWeek,
    resourcePerformance,
    deviations: deviationSummary,
    nextPlan,
    quality,
    notes: decisionsPayload,
  });
}));

const upsertNotesSchema = z.object({
  isoYear: z.number().int().min(2020).max(2100),
  isoWeek: z.number().int().min(1).max(53),
  decisions: z.string().default(""),
  actionItems: z.array(weeklyReportActionItemSchema).default([]),
});

app.put("/api/reports/weekly/notes", requirePlanner, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const parsed = upsertNotesSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
  const { isoYear, isoWeek, decisions, actionItems } = parsed.data;
  const userId = (req as any).user?.claims?.sub || (req as any).user?.id || null;

  const [row] = await db
    .insert(weeklyReportNotes)
    .values({ tenantId, isoYear, isoWeek, decisions, actionItems, updatedBy: userId })
    .onConflictDoUpdate({
      target: [weeklyReportNotes.tenantId, weeklyReportNotes.isoYear, weeklyReportNotes.isoWeek],
      set: { decisions, actionItems, updatedBy: userId, updatedAt: sql`now()` },
    })
    .returning();
  res.json(row);
}));

// ============================================
// ANOMALY MONITORING API ENDPOINTS
// ============================================

// Manually trigger anomaly check and get results (admin/owner only — tenant-scoped)
app.get("/api/system/anomalies/check", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const alerts = await anomalyMonitor.runManualCheck(tenantId);
    res.json({
      timestamp: new Date().toISOString(),
      alertCount: alerts.length,
      alerts: alerts
    });
}));

// ============================================
// SYSTEM DASHBOARD API ENDPOINTS
// ============================================

// Branding Templates - List all
app.get("/api/system/branding-templates", asyncHandler(async (req, res) => {
    const templates = await storage.getBrandingTemplates();
    res.json(templates);
}));

// Branding Templates - Get by ID
app.get("/api/system/branding-templates/:id", asyncHandler(async (req, res) => {
    const template = await storage.getBrandingTemplate(req.params.id);
    if (!template) throw new NotFoundError("Mall hittades inte");
    res.json(template);
}));

// Branding Templates - Get by slug
app.get("/api/system/branding-templates/slug/:slug", asyncHandler(async (req, res) => {
    const template = await storage.getBrandingTemplateBySlug(req.params.slug);
    if (!template) throw new NotFoundError("Mall hittades inte");
    res.json(template);
}));

// Tenant Branding - Get current tenant branding
app.get("/api/system/map-config", async (_req, res) => {
  // Använd aktiv MapProvider så att MAP_PROVIDER=google ger Google-tiles
  // (via server-proxy nedan), annars Geoapify/OSM via routing.ts.
  const { getMapProvider } = await import("../services/mapProvider");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(getMapProvider().getTileConfig());
});

// =============================================================================
// Google Map Tiles proxy (Task #478)
// =============================================================================
// Leaflet kan inte göra Googles createSession-flöde själv, så vi proxar
// tile-anropen genom servern. Session-token cachas/förnyas i
// `googleTileSession.ts`. API-nyckeln läcker aldrig till klienten.
// Tile-volym/timme för enkel anomaly-alarmning. Återställs varje hel timme.
const tileVolumeWindow = { startedAt: Date.now(), count: 0, alerted: false };
function trackTileVolumeAndMaybeAlert() {
  const now = Date.now();
  if (now - tileVolumeWindow.startedAt >= 60 * 60 * 1000) {
    tileVolumeWindow.startedAt = now;
    tileVolumeWindow.count = 0;
    tileVolumeWindow.alerted = false;
  }
  tileVolumeWindow.count += 1;
  if (!tileVolumeWindow.alerted && tileVolumeWindow.count >= TILE_HOURLY_ALERT_THRESHOLD) {
    tileVolumeWindow.alerted = true;
    console.warn(
      `[map-tiles-proxy] HÖG VOLYM: ${tileVolumeWindow.count} tile-anrop senaste timmen ` +
      `(tröskel ${TILE_HOURLY_ALERT_THRESHOLD}). Möjligt missbruk eller bot-trafik.`,
    );
  }
}

function getAllowedTileHosts(): string[] {
  // Vi litar inte på Host-headern (klient-kontrollerbar). Allowlistan måste
  // konfigureras explicit via env. Replit sätter ofta REPLIT_DOMAINS för
  // den publicerade domänen, så vi använder den som ytterligare källa.
  const fromEnv = (process.env.MAP_TILE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  const fromReplit = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...fromEnv, ...fromReplit]));
}

function isAllowedTileOrigin(req: import("express").Request): boolean {
  // I dev/test släpps allt igenom (inkl. curl utan Origin/Referer).
  if (process.env.NODE_ENV !== "production") return true;
  const allowed = getAllowedTileHosts();
  // Om ingen allowlist är konfigurerad faller vi tillbaka till att enbart
  // skydda via rate-limit (origin-check är "fail-open" här, eftersom annars
  // skulle alla tiles 403:a vid felkonfig).
  if (allowed.length === 0) return true;
  const candidates = [req.get("origin") ?? "", req.get("referer") ?? ""].filter(Boolean);
  if (candidates.length === 0) return false;
  for (const candidate of candidates) {
    try {
      const host = new URL(candidate).host.toLowerCase();
      if (allowed.some(a => host === a || host.endsWith("." + a))) return true;
    } catch {
      // Ignorera ogiltiga headers.
    }
  }
  return false;
}

app.get("/api/system/map-tiles/:z/:x/:y", mapTileLimiter, async (req, res, next) => {
  if (!isAllowedTileOrigin(req)) {
    return next(new ForbiddenError("Tile-proxyn serverar bara våra egna domäner"));
  }
  trackTileVolumeAndMaybeAlert();
  const z = Number.parseInt(req.params.z, 10);
  const x = Number.parseInt(req.params.x, 10);
  const y = Number.parseInt(req.params.y, 10);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return next(new ValidationError("Ogiltiga tile-koordinater"));
  }
  // Begränsa zoom-spannet (Google stödjer 0–22).
  if (z < 0 || z > 22 || x < 0 || y < 0) {
    return next(new ValidationError("Tile-koordinater utanför intervall"));
  }

  const { getActiveTileSession, buildGoogleTileUrl, isGoogleTileSessionAvailable } =
    await import("../services/googleTileSession");

  if (!isGoogleTileSessionAvailable()) {
    return res.status(503).json({ error: "Google Map Tiles ej konfigurerat" });
  }

  const session = await getActiveTileSession();
  if (!session) {
    return res.status(502).json({ error: "Kunde inte skapa Google tile-session" });
  }

  const url = buildGoogleTileUrl(session.session, z, x, y);
  if (!url) {
    return res.status(503).json({ error: "Google Map Tiles ej konfigurerat" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let upstream: Response;
  try {
    upstream = await fetch(url, { signal: controller.signal });
  } catch (err) {
    console.warn(
      "[map-tiles-proxy] tile fetch failed:",
      err instanceof Error ? err.message : err,
    );
    return res.status(502).json({ error: "Tile-fetch misslyckades" });
  } finally {
    clearTimeout(timer);
  }

  if (!upstream.ok) {
    return res.status(upstream.status).end();
  }

  const contentType = upstream.headers.get("content-type") ?? `image/${session.imageFormat}`;
  res.setHeader("Content-Type", contentType);
  // Cache i klient/CDN — tiles är statiska under sessionens livstid.
  res.setHeader("Cache-Control", "public, max-age=86400, immutable");

  const buf = Buffer.from(await upstream.arrayBuffer());
  return res.status(200).send(buf);
});

app.get("/api/system/tenant-branding", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const branding = await storage.getTenantBranding(tenantId);
    // Branding är mutable per-tenant config. Tidigare max-age=300 gjorde att
    // webbläsaren serverade stale data i 5 min efter en PUT, vilket fick det
    // att se ut som att Spara inte fungerade. Tvinga revalidering varje gång
    // (ETag-baserade 304:or fungerar fortfarande och håller payload låg).
    res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
    res.setHeader("Vary", "Cookie, Accept-Encoding");
    res.json(branding || null);
}));

app.post("/api/system/scrape-branding", requireAdmin, asyncHandler(async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      throw new ValidationError("URL krävs");
    }

    let targetUrl = url.trim();
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = "https://" + targetUrl;
    }

    try {
      const parsedUrl = new URL(targetUrl);
      const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TraivoBrandBot/1.0)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Kunde inte hämta sidan (HTTP ${response.status})`);
      }

      const rawHtml = await response.text();
      // Strip HTML comments so commented-out <img> tags don't pollute logo detection
      const html = rawHtml.replace(/<!--[\s\S]*?-->/g, "");

      const logos: string[] = [];
      const colors: string[] = [];
      let companyName = "";

      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) {
        let t = titleMatch[1].trim();
        t = t.split(/\s*[-–—|•·]\s*/)[0].trim();
        if (t.length > 0 && t.length < 80) {
          companyName = t;
        }
      }

      const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
      if (ogTitleMatch && ogTitleMatch[1].length < 80) {
        companyName = ogTitleMatch[1].split(/\s*[-–—|•·]\s*/)[0].trim();
      }

      const resolveUrl = (src: string) => {
        if (!src) return "";
        if (src.startsWith("//")) return parsedUrl.protocol + src;
        if (src.startsWith("http")) return src;
        if (src.startsWith("/")) return baseUrl + src;
        return baseUrl + "/" + src;
      };

      // Filter: only keep URLs from the same host (or relative paths that resolved to same host)
      const sameHost = (absUrl: string) => {
        try {
          const u = new URL(absUrl);
          const host = u.host.replace(/^www\./, "");
          const target = parsedUrl.host.replace(/^www\./, "");
          return host === target;
        } catch {
          return false;
        }
      };

      // Bad-context indicators: parent class/id values that mean "not our logo"
      const BAD_CONTEXT_RE = /partner|customer|sponsor|client|kund-?logo|logo-?slider|logo-?carousel|customer-?logo|partners?|kunder/i;

      // Build site/brand tokens from hostname + companyName so we can reject
      // images whose alt/title clearly point at OTHER brands (Willys, ICA, ...).
      const siteTokens = new Set<string>();
      const addToken = (t: string) => {
        const norm = t.toLowerCase().replace(/[^a-z0-9åäö]/g, "");
        if (norm.length >= 2) siteTokens.add(norm);
      };
      const hostNoTld = parsedUrl.host.replace(/^www\./, "").split(".")[0];
      addToken(hostNoTld);
      if (companyName) {
        for (const w of companyName.split(/\s+/)) addToken(w);
      }
      const altMentionsOtherBrand = (alt: string, title: string) => {
        const text = `${alt} ${title}`.toLowerCase();
        if (!text.trim()) return false;
        // Words 3+ chars that look like a brand-name token
        const words = text.match(/[a-zåäö0-9]{3,}/gi) || [];
        if (words.length === 0) return false;
        // Common generic words that should NOT trigger rejection
        const GENERIC = new Set(["logo","logotyp","logotype","brand","image","img","picture","header","site","main","company","företag","foretag","aktiebolag","group"]);
        const meaningful = words.filter(w => !GENERIC.has(w.toLowerCase()));
        if (meaningful.length === 0) return false;
        // Reject if NONE of the meaningful tokens overlap with our site tokens
        const anyMatch = meaningful.some(w => {
          const lw = w.toLowerCase();
          for (const t of siteTokens) {
            if (lw === t || lw.includes(t) || t.includes(lw)) return true;
          }
          return false;
        });
        return !anyMatch;
      };
      // Good-context indicators: parent class/id values that suggest the brand logo
      const GOOD_CONTEXT_RE = /(?:^|[^a-z])(?:logo(?:-?box|-?wrap|-?container|-?image|-?img)?|brand(?:ing)?|navbar-?brand|site-?logo|header-?logo|main-?logo)(?:[^a-z]|$)/i;

      type Candidate = { url: string; score: number };
      const candidates: Candidate[] = [];
      const seenUrls = new Set<string>();
      const addCandidate = (rawSrc: string, score: number) => {
        if (!rawSrc || rawSrc.startsWith("data:image/svg+xml")) return;
        if (rawSrc.length > 500) return;
        const absolute = resolveUrl(rawSrc);
        if (!absolute || !sameHost(absolute)) return;
        if (seenUrls.has(absolute)) return;
        seenUrls.add(absolute);
        candidates.push({ url: absolute, score });
      };

      // Walk through "good-context" containers: <a|div|header|nav|span> ... </same-tag>
      const containerTags = ["a", "div", "header", "nav", "span", "section"];
      for (const tag of containerTags) {
        const openRe = new RegExp(`<${tag}\\b[^>]*\\b(?:class|id)\\s*=\\s*["']([^"']*)["'][^>]*>`, "gi");
        let m: RegExpExecArray | null;
        while ((m = openRe.exec(html)) !== null) {
          const attr = m[1];
          if (!GOOD_CONTEXT_RE.test(attr)) continue;
          if (BAD_CONTEXT_RE.test(attr)) continue;

          // Extract the inner content up to the matching close tag (best-effort, allows nesting one level)
          const startIdx = openRe.lastIndex;
          const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
          closeRe.lastIndex = startIdx;
          const closeMatch = closeRe.exec(html);
          const endIdx = closeMatch ? closeMatch.index : Math.min(startIdx + 4000, html.length);
          const inner = html.slice(startIdx, endIdx);

          // Find <img src=...> inside
          const imgMatches = [...inner.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
          for (const im of imgMatches) {
            // Check if this img has bad alt/class
            const imgTag = im[0];
            const altMatch = imgTag.match(/\balt=["']([^"']*)["']/i);
            const titleMatch = imgTag.match(/\btitle=["']([^"']*)["']/i);
            const classMatch = imgTag.match(/\bclass=["']([^"']*)["']/i);
            const alt = altMatch?.[1] || "";
            const title = titleMatch?.[1] || "";
            const altOrClass = `${alt} ${classMatch?.[1] || ""}`;
            if (BAD_CONTEXT_RE.test(altOrClass)) continue;
            if (altMentionsOtherBrand(alt, title)) continue;
            addCandidate(im[1], 100);
          }

          // Inline SVGs as data URLs
          const svgInside = inner.match(/<svg\b[\s\S]*?<\/svg>/i);
          if (svgInside) {
            const svgData = "data:image/svg+xml;base64," + Buffer.from(svgInside[0]).toString("base64");
            if (!seenUrls.has(svgData)) {
              seenUrls.add(svgData);
              candidates.push({ url: svgData, score: 90 });
            }
          }
        }
      }

      // Fallback: imgs whose own class/id/alt explicitly say "logo" but parent context unknown — only if no good candidates yet
      if (candidates.length === 0) {
        const imgLogoRe = /<img\b[^>]*\b(?:class|id|alt)=["'][^"']*logo[^"']*["'][^>]*>/gi;
        const imgs = [...html.matchAll(imgLogoRe)];
        for (const im of imgs) {
          const tag = im[0];
          const attrs = tag.toLowerCase();
          if (BAD_CONTEXT_RE.test(attrs)) continue;
          const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
          if (srcMatch) addCandidate(srcMatch[1], 60);
        }
      }

      // OG image (often a generic share image, lower priority)
      const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      if (ogImageMatch) {
        addCandidate(ogImageMatch[1], 40);
      }

      // Favicons — only included as a fallback when no real logo candidates were found
      if (candidates.length === 0) {
        const linkIconMatches = [...html.matchAll(/<link[^>]+rel=["'](?:icon|apple-touch-icon|shortcut icon)["'][^>]*href=["']([^"']+)["'][^>]*>/gi)];
        for (const m of linkIconMatches) {
          if (m[1]) addCandidate(m[1], 10);
        }
      }

      // Score adjustments based on URL hints
      for (const c of candidates) {
        const lower = c.url.toLowerCase();
        if (/favicon|apple-touch/.test(lower)) c.score = Math.min(c.score, 15);
        if (/sprite|icon-/.test(lower)) c.score -= 20;
        // Larger images implied by filename hints
        const sizeMatch = lower.match(/(\d{2,4})(?:px|x\d+)?\.(?:png|jpg|jpeg|svg|webp)/);
        if (sizeMatch) {
          const n = parseInt(sizeMatch[1], 10);
          if (n >= 200) c.score += 10;
          if (n >= 500) c.score += 5;
        }
        if (/\.svg(?:$|\?)/.test(lower)) c.score += 5;
      }

      // Sort by score desc, push into logos
      candidates.sort((a, b) => b.score - a.score);
      for (const c of candidates) logos.push(c.url);

      const hexColors = new Set<string>();
      const colorPatterns = [
        /(?:background-color|background|color|border-color)\s*:\s*(#[0-9a-fA-F]{6})\b/g,
        /(?:background-color|background|color|border-color)\s*:\s*(#[0-9a-fA-F]{3})\b/g,
      ];
      for (const pattern of colorPatterns) {
        const matches = [...html.matchAll(pattern)];
        for (const m of matches) {
          let hex = m[1];
          if (hex.length === 4) {
            hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
          }
          hex = hex.toUpperCase();
          if (hex !== "#FFFFFF" && hex !== "#000000" && hex !== "#F5F5F5" && hex !== "#EEEEEE" && hex !== "#333333" && hex !== "#666666" && hex !== "#999999" && hex !== "#CCCCCC") {
            hexColors.add(hex);
          }
        }
      }

      const themeColorMatch = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i);
      if (themeColorMatch && /^#[0-9a-fA-F]{3,6}$/.test(themeColorMatch[1])) {
        let tc = themeColorMatch[1].toUpperCase();
        if (tc.length === 4) tc = "#" + tc[1] + tc[1] + tc[2] + tc[2] + tc[3] + tc[3];
        hexColors.add(tc);
        colors.unshift(tc);
      }

      colors.push(...[...hexColors].filter(c => !colors.includes(c)).slice(0, 10));

      const uniqueLogos = [...new Set(logos)].slice(0, 5);

      res.json({
        companyName,
        logos: uniqueLogos,
        colors,
        sourceUrl: targetUrl,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new ValidationError("Timeout: Sidan svarade inte inom 10 sekunder");
      }
      throw new ValidationError(err instanceof Error ? err.message : "Kunde inte analysera webbplatsen");
    }
}));

app.post("/api/system/tenant-branding/upload-logo", requireAdmin, asyncHandler(async (req, res) => {
    const { ObjectStorageService, ALLOWED_UPLOAD_MIME_TYPES } = await import("../replit_integrations/object_storage/objectStorage");
    const { MAX_LOGO_SIZE_BYTES, MAX_LOGO_SIZE_MB } = await import("@shared/upload-limits");
    const { contentType, size } = req.body;
    if (!contentType || !ALLOWED_UPLOAD_MIME_TYPES.has(contentType)) {
      throw new ValidationError("File type not allowed. Only images and PDFs are permitted.");
    }
    if (size !== undefined && size !== null && Number(size) > MAX_LOGO_SIZE_BYTES) {
      return res.status(413).json({ error: `Logotypen är för stor. Maxgräns är ${MAX_LOGO_SIZE_MB} MB.` });
    }
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json({ uploadURL, objectPath });
}));

app.post("/api/system/tenant-branding/confirm-logo", requireAdmin, asyncHandler(async (req, res) => {
    const { objectPath } = req.body;
    if (!objectPath || typeof objectPath !== "string") {
      throw new ValidationError("objectPath krävs");
    }

    const tenantId = getTenantIdWithFallback(req);
    const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
    const { MAX_LOGO_SIZE_BYTES } = await import("@shared/upload-limits");
    const objectStorageService = new ObjectStorageService();
    // Logos use visibility:"public" so they can render on unauthenticated branding pages.
    await objectStorageService.validateUploadedFileAndSetAcl(objectPath, `tenant:${tenantId}`, "public", MAX_LOGO_SIZE_BYTES);

    const serveUrl = `/api/storage/serve${objectPath}`;
    res.json({ url: serveUrl, objectPath });
}));

// Mirror an external logo URL into our object storage so the asset survives
// even if the remote site goes down or changes its layout.
app.post("/api/system/tenant-branding/mirror-logo", requireAdmin, asyncHandler(async (req, res) => {
    const { mirrorExternalLogo } = await import("../services/mirrorLogo");
    const tenantId = getTenantIdWithFallback(req);
    const { sourceUrl } = req.body;
    const result = await mirrorExternalLogo(sourceUrl, `tenant:${tenantId}`);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    res.json({ url: result.url, objectPath: result.objectPath });
}));

// Backfill: mirror all existing external tenant logos into object storage.
// Idempotent — rows whose logoUrl is already served via /api/storage/serve are skipped.
app.post("/api/system/tenant-branding/mirror-existing-logos", requireAdmin, asyncHandler(async (req, res) => {
    const { mirrorAllExternalTenantLogos } = await import("../services/mirrorLogo.backfill");
    const summary = await mirrorAllExternalTenantLogos();
    res.json(summary);
}));

app.get("/api/storage/serve/objects/*", asyncHandler(async (req, res) => {
    const objectPath = `/objects/${(req.params as any)[0]}`;
    const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
    const objectStorageService = new ObjectStorageService();
    const file = await objectStorageService.getObjectEntityFile(objectPath);

    // Strictly enforce ACL: deny if canAccessObjectEntity returns false.
    // Files without an ACL policy are inaccessible — the confirm-upload step
    // must be completed after each upload to set the policy.
    const canAccess = await objectStorageService.canAccessObjectEntity({
      userId: (req as any).user?.claims?.sub,
      tenantId: getTenantIdWithFallback(req),
      objectFile: file,
    });
    if (!canAccess) {
      throw new ForbiddenError("Access denied");
    }

    await objectStorageService.downloadObject(file, res, 86400);
}));

// Tenant Branding - Update or create branding
app.put("/api/system/tenant-branding", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { templateId, ...brandingData } = req.body;
    
    let existing = await storage.getTenantBranding(tenantId);
    
    // If using a template, fetch and merge template colors
    if (templateId) {
      const template = await storage.getBrandingTemplate(templateId);
      if (template) {
        brandingData.templateId = templateId;
        brandingData.primaryColor = brandingData.primaryColor || template.primaryColor;
        brandingData.primaryLight = brandingData.primaryLight || template.primaryLight;
        brandingData.primaryDark = brandingData.primaryDark || template.primaryDark;
        brandingData.secondaryColor = brandingData.secondaryColor || template.secondaryColor;
        brandingData.accentColor = brandingData.accentColor || template.accentColor;
        brandingData.successColor = brandingData.successColor || template.successColor;
        brandingData.errorColor = brandingData.errorColor || template.errorColor;
        
        // Increment template usage
        await storage.incrementTemplateUsage(templateId);
      }
    }
    
    let result;
    if (existing) {
      result = await storage.updateTenantBranding(tenantId, brandingData);
    } else {
      result = await storage.createTenantBranding({ 
        tenantId, 
        ...brandingData 
      });
    }
    
    // Create audit log
    await storage.createAuditLog({
      tenantId,
      action: existing ? "update_branding" : "create_branding",
      resourceType: "tenant_branding",
      resourceId: result?.id,
      changes: brandingData,
    });
    
    res.json(result);
}));

// Tenant Branding - Publish branding (admin only)
app.post("/api/system/tenant-branding/publish", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const result = await storage.publishTenantBranding(tenantId);
    
    if (!result) {
      throw new NotFoundError("Varumärke hittades inte");
    }
    
    await storage.createAuditLog({
      tenantId,
      action: "publish_branding",
      resourceType: "tenant_branding",
      resourceId: result.id,
    });
    
    res.json(result);
}));

// Dashboard cache stats — used during rollout to verify hit/miss behaviour
app.get("/api/system/dashboard-cache/stats", requireAdmin, asyncHandler(async (req, res) => {
    const { dashboardCache } = await import("../services/dashboardCache");
    res.json(dashboardCache.getStats());
}));

// SMS Configuration - Get current SMS settings (admin only)
app.get("/api/system/sms-config", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    
    if (!tenant) {
      throw new NotFoundError("Företag hittades inte");
    }
    
    res.json({
      smsEnabled: tenant.smsEnabled ?? false,
      smsProvider: tenant.smsProvider ?? "none",
      smsFromName: tenant.smsFromName ?? tenant.name ?? "",
    });
}));

// SMS Configuration - Update SMS settings (admin only)
const smsConfigSchema = z.object({
  smsEnabled: z.boolean().optional(),
  smsProvider: z.enum(["twilio", "46elks", "none"]).optional(),
  smsFromName: z.string().max(100).optional(),
});

app.put("/api/system/sms-config", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const parseResult = smsConfigSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError("Ogiltig förfrågan", { details: parseResult.error.flatten() });
    }
    
    const tenant = await storage.updateTenantSmsSettings(tenantId, parseResult.data);
    
    if (!tenant) {
      throw new NotFoundError("Företag hittades inte");
    }
    
    await storage.createAuditLog({
      tenantId,
      action: "update_sms_config",
      resourceType: "tenant",
      resourceId: tenantId,
      data: parseResult.data,
    });
    
    res.json({
      smsEnabled: tenant.smsEnabled ?? false,
      smsProvider: tenant.smsProvider ?? "none",
      smsFromName: tenant.smsFromName ?? "",
    });
}));

// SMS Configuration - Test SMS sending (admin only)
app.post("/api/system/sms-config/test", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      throw new ValidationError("Telefonnummer krävs");
    }
    
    const tenant = await storage.getTenant(tenantId);
    if (!tenant?.smsEnabled) {
      throw new ValidationError("SMS är inte aktiverat för detta företag");
    }
    
    const { sendNotification } = await import("../unified-notifications");
    const result = await sendNotification({
      tenantId,
      recipients: [{ phone: phoneNumber, name: "Test" }],
      notificationType: "reminder",
      channel: "sms",
      data: {
        objectAddress: "Testadress 123",
        scheduledDate: "idag",
        scheduledTime: "10:00",
      },
    });
    
    if (result.success && result.smsSent > 0) {
      res.json({ success: true, message: "Test-SMS skickat!" });
    } else {
      res.status(500).json({ success: false, error: result.errors.join(", ") || "Kunde inte skicka test-SMS" });
    }
}));

// User Tenant Roles - List all users with roles for current tenant (admin only)
app.get("/api/system/user-roles", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const roles = await storage.getUserTenantRoles(tenantId);
    res.json(roles);
}));

// User Tenant Roles - Create new user role (admin only)
app.post("/api/system/user-roles", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { userId, name, role, permissions, password } = req.body;
    
    if (!userId || !role) {
      throw new ValidationError("userId och roll krävs");
    }
    
    // Check if user already has a role
    const existing = await storage.getUserTenantRole(userId, tenantId);
    if (existing) {
      throw new ValidationError("Användaren har redan en roll i detta företag");
    }
    
    // Create or update user record with password if provided
    const email = userId.startsWith("email:") ? userId.replace("email:", "") : null;
    if (email) {
      const passwordHash = password ? hashPassword(password) : undefined;
      const [firstName, ...lastNameParts] = (name || "").split(" ");
      await storage.upsertUser({
        id: userId,
        email,
        firstName: firstName || null,
        lastName: lastNameParts.join(" ") || null,
        passwordHash,
      });
    }
    
    const result = await storage.createUserTenantRole({
      userId,
      tenantId,
      role,
      permissions: permissions || [],
      isActive: true,
    });
    
    await storage.createAuditLog({
      tenantId,
      action: "create_user_role",
      resourceType: "user_tenant_roles",
      resourceId: result.id,
      changes: { userId, role, permissions, hasPassword: !!password },
    });
    
    res.status(201).json(result);
}));

// User Tenant Roles - Update role (admin only)
app.patch("/api/system/user-roles/:id", requireAdmin, asyncHandler(async (req, res) => {
    const { role, permissions, isActive, password } = req.body;
    
    const result = await storage.updateUserTenantRole(req.params.id, {
      role,
      permissions,
      isActive,
    });
    
    if (!result) {
      throw new NotFoundError("Användarroll hittades inte");
    }
    
    // Update password if provided
    if (password && result.userId) {
      const email = result.userId.startsWith("email:") ? result.userId.replace("email:", "") : null;
      if (email) {
        const passwordHash = hashPassword(password);
        await storage.upsertUser({
          id: result.userId,
          email,
          passwordHash,
        });
      }
    }
    
    const tenantId = getTenantIdWithFallback(req);
    await storage.createAuditLog({
      tenantId,
      action: "update_user_role",
      resourceType: "user_tenant_roles",
      resourceId: result.id,
      changes: { role, permissions, isActive, passwordChanged: !!password },
    });
    
    res.json(result);
}));

// User Tenant Roles - Import users from CSV data
app.post("/api/system/user-roles/import", requireAdmin, asyncHandler(async (req, res) => {
    const { users } = req.body;
    
    if (!Array.isArray(users) || users.length === 0) {
      throw new ValidationError("Inga användare angivna");
    }
    
    let imported = 0;
    let skipped = 0;
    
    for (const user of users) {
      if (!user.email) {
        skipped++;
        continue;
      }
      
      const userId = `email:${user.email}`;
      const tenantId = getTenantIdWithFallback(req);
      
      // Check if user already has a role
      const existing = await storage.getUserTenantRole(userId, tenantId);
      if (existing) {
        skipped++;
        continue;
      }
      
      // Map role names (Swedish to English) - handle whitespace and case variations
      let role = user.role?.toLowerCase().trim() || "viewer";
      const roleMap: Record<string, string> = {
        "ägare": "owner",
        "owner": "owner",
        "administratör": "admin",
        "administrator": "admin",
        "admin": "admin",
        "planerare": "planner",
        "planner": "planner",
        "tekniker": "technician",
        "technician": "technician",
        "läsare": "viewer",
        "viewer": "viewer",
        "user": "viewer",
        "användare": "viewer",
      };
      role = roleMap[role] || "viewer";
      
      await storage.createUserTenantRole({
        userId,
        tenantId,
        role,
        permissions: [],
        isActive: true,
      });
      imported++;
    }
    
    const tenantIdForLog = getTenantIdWithFallback(req);
    await storage.createAuditLog({
      tenantId: tenantIdForLog,
      action: "import_users",
      resourceType: "user_tenant_roles",
      changes: { imported, skipped, total: users.length },
    });
    
    res.json({ imported, skipped, total: users.length });
}));

// User Tenant Roles - Delete role
app.delete("/api/system/user-roles/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.createAuditLog({
      tenantId,
      action: "delete_user_role",
      resourceType: "user_tenant_roles",
      resourceId: req.params.id,
    });
    
    await storage.deleteUserTenantRole(req.params.id);
    res.status(204).send();
}));

// ============================================
// INDUSTRY PACKAGES API ENDPOINTS
// ============================================

// Industry Packages - List all available packages
app.get("/api/system/industry-packages", asyncHandler(async (req, res) => {
    const packages = await storage.getIndustryPackages();
    res.json(packages);
}));

// Industry Packages - Get by ID with full data
app.get("/api/system/industry-packages/:id", asyncHandler(async (req, res) => {
    const pkg = await storage.getIndustryPackage(req.params.id);
    if (!pkg) throw new NotFoundError("Paket hittades inte");
    
    const packageData = await storage.getIndustryPackageData(req.params.id);
    res.json({ ...pkg, data: packageData });
}));

// Industry Packages - Get tenant installation history
app.get("/api/system/industry-packages/installations", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const installations = await storage.getTenantPackageInstallations(tenantId);
    res.json(installations);
}));

// Industry Packages - Install package for tenant
app.post("/api/system/industry-packages/:id/install", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const packageId = req.params.id;
    const userId = req.user?.claims?.sub;
    
    const pkg = await storage.getIndustryPackage(packageId);
    if (!pkg) throw new NotFoundError("Paket hittades inte");
    
    const packageData = await storage.getIndustryPackageData(packageId);
    
    let articlesInstalled = 0;
    let metadataInstalled = 0;
    let structuralArticlesInstalled = 0;
    
    const articlesData = packageData.find(d => d.dataType === "articles");
    if (articlesData && Array.isArray(articlesData.data)) {
      for (const article of articlesData.data as any[]) {
        try {
          await storage.createArticle({
            tenantId,
            articleNumber: article.articleNumber,
            name: article.name,
            description: article.description,
            articleType: article.articleType,
            unitPrice: article.unitPrice?.toString(),
            unit: article.unit,
            objectTypes: article.objectTypes,
          });
          articlesInstalled++;
        } catch (err) {
          console.warn(`Skipping duplicate article ${article.articleNumber}:`, err);
        }
      }
    }
    
    const metadataData = packageData.find(d => d.dataType === "metadataDefinitions");
    if (metadataData && Array.isArray(metadataData.data)) {
      for (const meta of metadataData.data as any[]) {
        try {
          // Task #992: installera till kanonisk svensk katalog (idempotent).
          const { created } = await ensurePackageMetadataKatalog(tenantId, meta);
          if (created) metadataInstalled++;
        } catch (err) {
          console.warn(`Skipping duplicate metadata ${meta.fieldKey}:`, err);
        }
      }
    }
    
    const structuralData = packageData.find(d => d.dataType === "structuralArticles");
    if (structuralData && Array.isArray(structuralData.data)) {
      const tenantArticles = await storage.getArticles(tenantId);
      const articleMap = new Map(tenantArticles.map(a => [a.articleNumber, a.id]));
      
      for (const sa of structuralData.data as any[]) {
        try {
          const parentId = articleMap.get(sa.parentArticleNumber);
          const childId = articleMap.get(sa.childArticleNumber);
          
          if (parentId && childId) {
            await storage.createStructuralArticle({
              tenantId,
              parentArticleId: parentId,
              childArticleId: childId,
              sequenceOrder: sa.sequenceOrder || 1,
              quantity: sa.quantity?.toString() || "1",
              isConditional: sa.isConditional || false,
              conditionType: sa.conditionType,
              conditionValue: sa.conditionValue,
            });
            structuralArticlesInstalled++;
          } else {
            console.warn(`Skipping structural article: parent=${sa.parentArticleNumber} child=${sa.childArticleNumber} - articles not found`);
          }
        } catch (err) {
          console.warn(`Skipping structural article:`, err);
        }
      }
    }
    
    const installation = await storage.createTenantPackageInstallation({
      tenantId,
      packageId,
      installedBy: userId,
      articlesInstalled,
      metadataInstalled,
      structuralArticlesInstalled,
      status: "completed",
    });
    
    await storage.createAuditLog({
      tenantId,
      userId,
      action: "install_industry_package",
      resourceType: "industry_package",
      resourceId: packageId,
      changes: { 
        packageName: pkg.name, 
        articlesInstalled, 
        metadataInstalled,
        structuralArticlesInstalled
      },
    });
    
    res.json({
      success: true,
      installation,
      summary: {
        articlesInstalled,
        metadataInstalled,
        structuralArticlesInstalled,
      },
    });
}));

// Tenant Onboarding - Create new tenant with package and admin user
app.post("/api/system/onboard-tenant", requireAdmin, asyncHandler(async (req, res) => {
    const { company, industryPackageId, adminUser } = req.body;
    const currentUserId = req.user?.claims?.sub;

    if (!company?.name) {
      throw new ValidationError("Företagsnamn krävs");
    }
    if (!adminUser?.email || !adminUser?.password) {
      throw new ValidationError("E-post och lösenord krävs för admin-användaren");
    }

    const existingUser = await storage.getUserByUsername(adminUser.email);
    if (existingUser) {
      throw new ConflictError("En användare med den e-postadressen finns redan");
    }

    const tenantId = `tenant-${Date.now()}`;
    const tenant = await storage.createTenant({
      id: tenantId,
      name: company.name,
      orgNumber: company.orgNumber || null,
      contactEmail: company.contactEmail || null,
      contactPhone: company.contactPhone || null,
      industry: company.industry || null,
    });

    let packageSummary = null;
    if (industryPackageId) {
      const pkg = await storage.getIndustryPackage(industryPackageId);
      if (pkg) {
        const packageData = await storage.getIndustryPackageData(industryPackageId);
        let articlesInstalled = 0;
        let metadataInstalled = 0;
        let structuralArticlesInstalled = 0;

        const articlesData = packageData.find(d => d.dataType === "articles");
        if (articlesData && Array.isArray(articlesData.data)) {
          for (const article of articlesData.data as any[]) {
            try {
              await storage.createArticle({
                tenantId,
                articleNumber: article.articleNumber,
                name: article.name,
                description: article.description,
                articleType: article.articleType,
                unitPrice: article.unitPrice?.toString(),
                unit: article.unit,
                objectTypes: article.objectTypes,
              });
              articlesInstalled++;
            } catch (err) {
              console.warn(`Skipping duplicate article ${article.articleNumber}:`, err);
            }
          }
        }

        const metadataData = packageData.find(d => d.dataType === "metadataDefinitions");
        if (metadataData && Array.isArray(metadataData.data)) {
          for (const meta of metadataData.data as any[]) {
            try {
              // Task #992: installera till kanonisk svensk katalog (idempotent).
              const { created } = await ensurePackageMetadataKatalog(tenantId, meta);
              if (created) metadataInstalled++;
            } catch (err) {
              console.warn(`Skipping duplicate metadata ${meta.fieldKey}:`, err);
            }
          }
        }

        const structuralData = packageData.find(d => d.dataType === "structuralArticles");
        if (structuralData && Array.isArray(structuralData.data)) {
          const tenantArticles = await storage.getArticles(tenantId);
          const articleMap = new Map(tenantArticles.map(a => [a.articleNumber, a.id]));
          for (const sa of structuralData.data as any[]) {
            try {
              const parentId = articleMap.get(sa.parentArticleNumber);
              const childId = articleMap.get(sa.childArticleNumber);
              if (parentId && childId) {
                await storage.createStructuralArticle({
                  tenantId,
                  parentArticleId: parentId,
                  childArticleId: childId,
                  sequenceOrder: sa.sequenceOrder || 1,
                  quantity: sa.quantity?.toString() || "1",
                  isConditional: sa.isConditional || false,
                  conditionType: sa.conditionType,
                  conditionValue: sa.conditionValue,
                });
                structuralArticlesInstalled++;
              }
            } catch (err) {
              console.warn(`Skipping structural article:`, err);
            }
          }
        }

        await storage.createTenantPackageInstallation({
          tenantId,
          packageId: industryPackageId,
          installedBy: currentUserId,
          articlesInstalled,
          metadataInstalled,
          structuralArticlesInstalled,
          status: "completed",
        });

        packageSummary = {
          packageName: pkg.name,
          articlesInstalled,
          metadataInstalled,
          structuralArticlesInstalled,
        };
      }
    }

    const hashedPassword = hashPassword(adminUser.password);
    const user = await storage.createUser({
      email: adminUser.email,
      firstName: adminUser.firstName || null,
      lastName: adminUser.lastName || null,
      passwordHash: hashedPassword,
      role: "admin",
      isActive: true,
    });

    await storage.createUserTenantRole({
      userId: user.id,
      tenantId,
      role: "owner",
      assignedBy: currentUserId,
    });

    await storage.createAuditLog({
      tenantId,
      userId: currentUserId,
      action: "onboard_tenant",
      resourceType: "tenant",
      resourceId: tenantId,
      changes: {
        companyName: company.name,
        adminEmail: adminUser.email,
        packageInstalled: packageSummary?.packageName || null,
      },
    });

    console.log(`[onboarding] New tenant "${company.name}" (${tenantId}) created with admin "${adminUser.email}"`);

    res.status(201).json({
      success: true,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        orgNumber: tenant.orgNumber,
        industry: tenant.industry,
      },
      adminUser: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      packageSummary,
    });
}));

// Industry Packages - Seed default packages (admin only, one-time setup)
app.post("/api/system/industry-packages/seed", requireAdmin, asyncHandler(async (req, res) => {
    const { allPackages, getPackageData } = await import("../data/industryPackages");
    
    const results = [];
    for (const pkgData of allPackages) {
      const existing = await storage.getIndustryPackageBySlug(pkgData.slug);
      if (existing) {
        results.push({ slug: pkgData.slug, status: "skipped", message: "Already exists" });
        continue;
      }
      
      const pkg = await storage.createIndustryPackage(pkgData);
      
      const data = getPackageData(pkgData.slug);
      
      if (data.articles.length > 0) {
        await storage.createIndustryPackageData({
          packageId: pkg.id,
          dataType: "articles",
          data: data.articles,
        });
      }
      
      if (data.metadata.length > 0) {
        await storage.createIndustryPackageData({
          packageId: pkg.id,
          dataType: "metadataDefinitions",
          data: data.metadata,
        });
      }
      
      if (data.structuralArticles.length > 0) {
        await storage.createIndustryPackageData({
          packageId: pkg.id,
          dataType: "structuralArticles",
          data: data.structuralArticles,
        });
      }
      
      results.push({ 
        slug: pkgData.slug, 
        status: "created", 
        articles: data.articles.length,
        metadata: data.metadata.length,
        structuralArticles: data.structuralArticles.length,
      });
    }
    
    res.json({ success: true, results });
}));

// Audit Logs - Get logs for current tenant (admin/owner only — sensitive operational history)
app.get("/api/system/audit-logs", requireAdmin, asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const action = req.query.action as string;
    const userId = req.query.userId as string;
    
    const tenantId = getTenantIdWithFallback(req);
    const logs = await storage.getAuditLogs(tenantId, { limit, offset, action, userId });
    res.json(logs);
}));

// Project Statistics API - Returns code statistics for PDF generation
app.get("/api/system/project-stats", asyncHandler(async (req, res) => {
    // Project code statistics (based on actual code count)
    const stats = {
      projectName: "Traivo - AI-Driven Field Service Planning Platform",
      generatedDate: new Date().toISOString(),
      codeStats: {
        totalLines: 43628,
        frontend: { lines: 31253, files: 120, description: "React/TypeScript frontend" },
        backend: { lines: 11304, files: 45, description: "Express.js/Node.js backend" },
        shared: { lines: 1071, files: 15, description: "Delad typning och schema" },
        totalFiles: 180,
      },
      features: [
        "Drag-and-drop veckoplanering",
        "AI-driven ruttoptimering (Geoapify Route Planner)",
        "GPS-spårning i realtid med breadcrumb-trails",
        "Automatisk anomali-övervakning",
        "Mobil fältapp med digitala signaturer",
        "Flerföretagsstöd-arkitektur",
        "WebSocket push-notifikationer",
        "MCP-integration för externa AI-assistenter",
        "Modus 2.0 CSV-import",
        "Väderoptimerad schemaläggning",
      ],
      techStack: [
        "React 18 + TypeScript",
        "Express.js + Node.js",
        "PostgreSQL + Drizzle ORM",
        "TanStack Query",
        "Tailwind CSS + Shadcn/UI",
        "Leaflet kartor",
        "OpenAI GPT-4",
        "WebSocket realtidskommunikation",
      ],
      costComparison: {
        // Swedish development costs
        hourlyRate: { min: 800, max: 1500, currency: "SEK" },
        // Estimate: 10-20 lines of production code per hour for complex systems
        estimatedHours: { min: 2181, max: 4363 }, // 43628 / 20 and 43628 / 10
        // Total cost range
        totalCost: {
          min: 2181 * 800, // 1 744 800 SEK
          max: 4363 * 1500, // 6 544 500 SEK
          currency: "SEK",
        },
        // Additional costs for a typical project
        additionalCosts: {
          projectManagement: "15-20% av utvecklingskostnad",
          uxDesign: "10-15% av utvecklingskostnad",
          testing: "20-30% av utvecklingskostnad",
          infrastructure: "Löpande månadskostnad",
        },
        // Timeline estimate
        timeline: {
          team: "3-5 utvecklare",
          duration: "6-12 månader",
        },
        notes: [
          "Uppskattningen baseras på 10-20 rader produktionskod per timme",
          "Timkostnaden för svenska konsulter varierar mellan 800-1500 kr/tim",
          "Inkluderar inte projektledning, UX-design eller infrastruktur",
          "Ett erfaret team kan leverera snabbare men till högre timkostnad",
        ],
      },
    };
    
    res.json(stats);
}));

// Send project report via email
app.post("/api/system/send-project-report", requireAdmin, asyncHandler(async (req, res) => {
    const { to, pdfBase64 } = req.body;
    
    if (!to || !pdfBase64) {
      throw new ValidationError("Missing required fields: to, pdfBase64");
    }

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    
    const result = await sendEmail({
      to,
      subject: "Traivo Projektrapport - Kodstatistik och Kostnadsjämförelse",
      html: `
        <h1>Traivo Projektrapport</h1>
        <p>Bifogat finner du projektrapporten med kodstatistik och kostnadsjämförelse för Traivo-plattformen.</p>
        <h2>Sammanfattning</h2>
        <ul>
          <li><strong>Totalt antal kodrader:</strong> ~43 600</li>
          <li><strong>Uppskattad utvecklingskostnad:</strong> 1,7 - 6,5 miljoner SEK</li>
          <li><strong>Uppskattad utvecklingstid:</strong> 6-12 månader med 3-5 utvecklare</li>
        </ul>
        <p>Se bifogad PDF för detaljerad information.</p>
        <hr>
        <p><em>Genererad av Traivo - AI-Driven Field Service Planning Platform</em></p>
      `,
      attachments: [
        {
          filename: "Traivo_Projektrapport_Kostnadsjamforelse.pdf",
          content: pdfBuffer,
        }
      ],
    });
    
    console.log("Email sent successfully:", result);
    res.json({ success: true, result });
}));

// ============== METADATA DEFINITIONS ==============
// ADR v3 §2.4 — soft-delete + referensräkning. Definitioner får aldrig
// hard-deleteas via API; ändringar av "låsta" fält (fieldKey, dataType,
// propagationType, applicableLevels) blockeras när definitionen används.
// Task #992: /api/metadata-definitions serveras nu som en VY över den svenska
// metadata_katalog (id === katalog.id). De engelska metadata_definitions-
// tabellerna är read-only audit/rollback — inga nya engelska definitioner
// skapas här. fieldKey speglar villkorsmotorns nyckel (deriveMetadataDotKey ??
// namn) så att concept_filters.metadata_key fortsätter resolva.
app.get("/api/metadata-definitions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const includeDeleted = req.query.includeDeleted === "true";
    const definitions = await getMetadataDefinitionsCompat(tenantId, { includeDeleted });
    res.json(definitions);
}));

app.get("/api/metadata-definitions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const definition = await getMetadataDefinitionCompat(tenantId, req.params.id);
    if (!definition) throw new NotFoundError("Definition hittades inte");
    res.json(definition);
}));

app.get("/api/metadata-definitions/:id/usage", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const definition = await getMetadataDefinitionCompat(tenantId, req.params.id);
    if (!definition) throw new NotFoundError("Definition hittades inte");
    // Mappa svensk katalog-usage → den engelska MetadataDefinitionUsage-formen
    // som frontend förväntar sig (objektvärden + koncept-filter).
    const usage = await getMetadataKatalogUsage(req.params.id, tenantId);
    res.json({
      definitionId: req.params.id,
      fieldKey: definition.fieldKey,
      objectValueCount: usage.valueCount,
      activeConceptCount: usage.conceptFilterCount,
      futureWorkOrderCount: 0,
      conceptSnapshotCount: 0,
      total: usage.total,
      blockers: { concepts: [] },
    });
}));

app.post("/api/metadata-definitions", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    // Skapa en svensk katalogpost (aldrig en ny engelsk definition). namn
    // härleds från fieldKey (identiteten) i första hand, annars fieldLabel.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fieldKey = typeof body.fieldKey === "string" ? body.fieldKey.trim() : "";
    const fieldLabel = typeof body.fieldLabel === "string" ? body.fieldLabel.trim() : "";
    const namn = fieldKey || fieldLabel;
    if (!namn) throw new ValidationError("fieldKey eller fieldLabel krävs");
    const beskrivning = fieldLabel && fieldLabel !== namn ? fieldLabel : null;
    const data = insertMetadataKatalogSchema.parse({
      tenantId,
      namn,
      beskrivning,
      datatyp: mapEnglishDataTypeToDatatyp(typeof body.dataType === "string" ? body.dataType : undefined),
      standardArvs: (typeof body.propagationType === "string" ? body.propagationType : "falling") !== "fixed",
      isRequired: body.isRequired === true,
      isSystem: false,
      area: "annat",
    });
    data.kategori = (data.area as string | null | undefined) || "annat";
    const [label] = await db.insert(metadataKatalog).values(data).returning();
    const byId = new Map([[label.id, label]]);
    res.status(201).json(katalogToDefinitionCompat(label, byId));
}));

app.patch("/api/metadata-definitions/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    // Task #992: redigera den svenska katalograden direkt (id === katalog.id).
    const [existing] = await db.select().from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.id, req.params.id),
        eq(metadataKatalog.tenantId, tenantId),
      ));
    if (!existing) throw new NotFoundError("Definition hittades inte");
    if (existing.deletedAt) {
      throw new ConflictError("Definitionen är arkiverad. Återställ den först innan du redigerar.");
    }
    // fieldKey är immutable (identitet) — ignoreras. Endast en delmängd av de
    // engelska fälten kan översättas till katalogen (legacy-only fält no-op:as).
    const updateSchema = z.object({
      fieldLabel: z.string().optional(),
      dataType: z.string().optional(),
      isRequired: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      propagationType: z.string().optional(),
      applicableLevels: z.array(z.string()).optional(),
      defaultValue: z.string().nullable().optional(),
      validationRules: z.record(z.unknown()).optional(),
      replacedByDefinitionId: z.string().nullable().optional(),
    });
    const parsed = updateSchema.parse(req.body);

    const nextNamn = parsed.fieldLabel?.trim();
    const nextDatatyp = parsed.dataType !== undefined ? mapEnglishDataTypeToDatatyp(parsed.dataType) : undefined;
    const nextStandardArvs = parsed.propagationType !== undefined ? parsed.propagationType !== "fixed" : undefined;
    const renamesNamn = nextNamn !== undefined && nextNamn.length > 0 && nextNamn !== existing.namn;
    const changesDatatyp = nextDatatyp !== undefined && nextDatatyp !== existing.datatyp;

    // Universalnyckel-skydd: namn (=fieldLabel) och datatyp får INTE ändras när
    // fältet används (concept_filters.metadata_key + import-headers + snapshots
    // skulle annars tolkas fel). Samma invariant som /api/metadata/types PUT.
    if (renamesNamn || changesDatatyp) {
      const usage = await getMetadataKatalogUsage(req.params.id, tenantId);
      if (usage.total > 0) {
        const fields = [renamesNamn ? "fieldLabel" : null, changesDatatyp ? "dataType" : null].filter(Boolean).join(", ");
        throw new ConflictError(
          `Kan inte ändra ${fields} — fältet används (${usage.total} referenser: ${usage.valueCount} värden, ${usage.conceptFilterCount} koncept-filter). ` +
          `Skapa ett nytt fält och migrera värden istället.`,
        );
      }
    }

    if (existing.isSystem && (renamesNamn || changesDatatyp || parsed.isRequired !== undefined)) {
      throw new ForbiddenError("Systemmetadata: skyddade fält kan inte ändras (namn, datatyp, isRequired)");
    }

    // Systemlåst STRUKTUR (≠ isSystem): definitionen är kanonisk och låst
    // (namn/datatyp/ordning/arv/obligatorisk), men VÄRDEN redigeras fritt per objekt.
    if (existing.systemlast && (renamesNamn || changesDatatyp || parsed.sortOrder !== undefined || parsed.isRequired !== undefined || nextStandardArvs !== undefined)) {
      throw new ForbiddenError("Systemlåst metadata: strukturen är låst (namn, datatyp, ordning, arv, obligatorisk kan ej ändras). Värden kan redigeras fritt per objekt.");
    }

    const updateData: Record<string, string | number | boolean | null> = {};
    if (nextNamn !== undefined && nextNamn.length > 0) updateData.namn = nextNamn;
    if (nextDatatyp !== undefined) updateData.datatyp = nextDatatyp;
    if (parsed.isRequired !== undefined) updateData.isRequired = parsed.isRequired;
    if (parsed.sortOrder !== undefined) updateData.sortOrder = parsed.sortOrder;
    if (nextStandardArvs !== undefined) updateData.standardArvs = nextStandardArvs;

    if (Object.keys(updateData).length > 0) {
      await db.update(metadataKatalog)
        .set(updateData)
        .where(and(
          eq(metadataKatalog.id, req.params.id),
          eq(metadataKatalog.tenantId, tenantId),
        ));
    }
    // Returnera alltid compat-vyn (hämtar förälder för punktnotationsnyckel).
    const definition = await getMetadataDefinitionCompat(tenantId, req.params.id);
    res.json(definition);
}));

app.delete("/api/metadata-definitions/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    // Task #992: soft-delete (arkivera) den svenska katalograden.
    const [existing] = await db.select().from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.id, req.params.id),
        eq(metadataKatalog.tenantId, tenantId),
      ));
    if (!existing) throw new NotFoundError("Definition hittades inte");
    if (existing.deletedAt) {
      return res.status(204).send();
    }
    if (existing.isSystem) {
      throw new ForbiddenError("Systemmetadata kan inte raderas");
    }
    if (existing.systemlast) {
      throw new ForbiddenError("Systemlåst metadata kan inte raderas — strukturen är kanonisk. Värden kan tömmas per objekt.");
    }

    // Gruppfält med underfält blockeras (FK skulle annars ge ett rått DB-fel).
    // Endast aktiva (icke-arkiverade) underfält räknas — arkiverade barn ska inte
    // blockera radering av föräldern.
    const children = await db.select({ id: metadataKatalog.id })
      .from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.tenantId, tenantId),
        eq(metadataKatalog.parentMetadataId, req.params.id),
        isNull(metadataKatalog.deletedAt),
      ));
    if (children.length > 0) {
      throw new ConflictError(
        `Kan inte radera — fältet är ett gruppfält med ${children.length} underfält. ` +
        `Ta bort eller flytta underfälten först.`,
      );
    }

    const usage = await getMetadataKatalogUsage(req.params.id, tenantId);
    const confirmUsageRaw = req.query.confirmUsage;
    const confirmUsage = typeof confirmUsageRaw === "string" ? Number(confirmUsageRaw) : NaN;
    const forced = Number.isFinite(confirmUsage);

    if (usage.total > 0 && !forced) {
      // 409 + strukturerad payload — UI kan visa exakt vad som blockerar.
      throw new ConflictError("metadata_definition_in_use", {
        message: `Definitionen används på ${usage.total} ställen. Bekräfta med ?confirmUsage=${usage.total} för att arkivera ändå.`,
        usage: {
          definitionId: req.params.id,
          fieldKey: existing.namn,
          objectValueCount: usage.valueCount,
          activeConceptCount: usage.conceptFilterCount,
          futureWorkOrderCount: 0,
          conceptSnapshotCount: 0,
          total: usage.total,
          blockers: { concepts: [] },
        },
      });
    }

    if (usage.total > 0 && forced && confirmUsage !== usage.total) {
      throw new ConflictError(
        `confirmUsage=${confirmUsage} matchar inte aktuell usage_count (${usage.total}). ` +
        `Ladda om och bekräfta med rätt värde — undviker race-condition vid samtidiga ändringar.`
      );
    }

    const archivedBy = (req as any).session?.user?.id ?? null;
    await softDeleteMetadataType(tenantId, req.params.id, { archivedBy });
    res.status(204).send();
}));

// ============== METADATA LABELS (ETIKETTER / KATALOG) ==============

app.get("/api/metadata-labels", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { kategori, beteckning, isSystem } = req.query;
    
    const results = await db.select().from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.tenantId, tenantId),
        isNull(metadataKatalog.deletedAt),
      ))
      .orderBy(metadataKatalog.area, metadataKatalog.sortOrder, metadataKatalog.namn);
    
    let filtered = results;
    if (kategori) {
      filtered = filtered.filter(r => r.kategori === kategori);
    }
    if (beteckning) {
      filtered = filtered.filter(r => r.beteckning === beteckning);
    }
    if (isSystem === 'true') {
      filtered = filtered.filter(r => r.isSystem);
    }
    
    res.json(filtered);
}));

app.get("/api/metadata-labels/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const [label] = await db.select().from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.id, req.params.id),
        eq(metadataKatalog.tenantId, tenantId),
        isNull(metadataKatalog.deletedAt),
      ));
    if (!label) throw new NotFoundError("Etikett hittades inte");
    res.json(label);
}));

app.post("/api/metadata-labels", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertMetadataKatalogSchema.parse({ ...req.body, tenantId, isSystem: false, systemlast: false });
    // Task #674: Område är grupperingsfältet — håll legacy `kategori` i synk.
    data.kategori = (data.area as string | null | undefined) || 'annat';
    // Namn/beteckning är per-tenant unika universella nycklar (samma metadata_katalog-
    // tabell som /api/metadata/types). Matcha SKIFTLÄGESOKÄNSLIGT och kontrollera även
    // ARKIVERADE typer så att denna skriv-yta inte kan kringgå unikhets-/arkivinvarianten
    // och återskapa den osynliga dubblett-återvändsgränden.
    const dupNamn = await findMetadataTypeByIdentity(tenantId, "namn", data.namn, { archived: false });
    if (dupNamn) {
      throw new ConflictError(`Metadatatyp med kod '${data.namn}' finns redan`);
    }
    const archivedNamn = await findMetadataTypeByIdentity(tenantId, "namn", data.namn, { archived: true });
    if (archivedNamn) {
      throw new ConflictError(
        `En arkiverad metadatatyp "${archivedNamn.namn}" finns redan. Återställ den från arkivet eller välj ett annat namn.`,
        { code: "ARCHIVED_METADATA_TYPE_EXISTS", field: "namn", archivedTypeId: archivedNamn.id },
      );
    }
    if (data.beteckning) {
      const dupBet = await findMetadataTypeByIdentity(tenantId, "beteckning", data.beteckning, { archived: false });
      if (dupBet) {
        throw new ConflictError(`Metadatatyp med beteckning '${data.beteckning}' finns redan`);
      }
      const archivedBet = await findMetadataTypeByIdentity(tenantId, "beteckning", data.beteckning, { archived: true });
      if (archivedBet) {
        throw new ConflictError(
          `En arkiverad metadatatyp med beteckning "${archivedBet.beteckning}" finns redan. Återställ den från arkivet eller välj en annan beteckning.`,
          { code: "ARCHIVED_METADATA_TYPE_EXISTS", field: "beteckning", archivedTypeId: archivedBet.id },
        );
      }
    }
    // Task #662: validera överordnat metadata-fält även på denna skriv-yta så att
    // en-nivå-invarianten och tenant-isoleringen inte kan kringgås här.
    if (data.parentMetadataId) {
      const parentError = await validateParentMetadataLink(tenantId, data.parentMetadataId, null);
      if (parentError) throw new ValidationError(parentError);
      // Smart standard: ärv förälderns område när inget eget område angetts (samma
      // härledning som POST /api/metadata/types — gäller även denna skriv-yta så att
      // server-sidan är enhetlig och inte kan kringgås via importer/skript).
      if (!data.area || String(data.area).trim() === '') {
        const [parent] = await db
          .select({ area: metadataKatalog.area })
          .from(metadataKatalog)
          .where(and(
            eq(metadataKatalog.id, data.parentMetadataId),
            eq(metadataKatalog.tenantId, tenantId),
          ))
          .limit(1);
        if (parent?.area) {
          data.area = parent.area;
          data.kategori = parent.area;
        }
      }
    }
    const [label] = await db.insert(metadataKatalog).values(data).returning();
    res.status(201).json(label);
}));

app.patch("/api/metadata-labels/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const [existing] = await db.select().from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.id, req.params.id),
        eq(metadataKatalog.tenantId, tenantId)
      ));
    if (!existing) throw new NotFoundError("Etikett hittades inte");
    
    const updateSchema = z.object({
      namn: z.string().optional(),
      beskrivning: z.string().nullable().optional(),
      datatyp: z.string().optional(),
      beteckning: z.string().nullable().optional(),
      sortOrder: z.number().optional(),
      icon: z.string().nullable().optional(),
      isRequired: z.boolean().optional(),
      allowedValues: z.array(z.string()).nullable().optional(),
      editableByLevel: z.string().nullable().optional(),
      standardArvs: z.boolean().optional(),
      arLogisk: z.boolean().optional(),
      area: z.string().nullable().optional(),
      displayNumber: z.number().int().nullable().optional(),
      allowDuplicates: z.boolean().optional(),
      kronologiskVisning: z.boolean().optional(),
      // Task #1218: styr om fältet visas i metadata-karusellen på objekt-ytor.
      visasIKarusell: z.boolean().optional(),
    });
    const parsed = updateSchema.parse(req.body);
    
    // Task #674: Grupperingsfältet är nu `area` (Område) — skydda det (inte den
    // utfasade `kategori`) på systemmetadata. Migrering sker direkt i DB, förbi
    // detta API-skydd.
    const protectedFields = ['namn', 'beteckning', 'datatyp', 'area', 'isRequired'] as const;
    let updateData: Record<string, string | number | boolean | string[] | null | undefined> = { ...parsed };
    
    if (existing.isSystem) {
      for (const field of protectedFields) {
        delete updateData[field];
      }
      if (Object.keys(updateData).length === 0) {
        throw new ForbiddenError("Systemmetadata: skyddade fält kan inte ändras (namn, beteckning, datatyp, område, isRequired)");
      }
    }
    // Systemlåst STRUKTUR (≠ isSystem): definitionen är kanonisk och låst; endast
    // rent kosmetiska fält (beskrivning, ikon) får ändras. VÄRDEN redigeras fritt per objekt.
    if (existing.systemlast) {
      const systemlastProtected = ['namn', 'beteckning', 'datatyp', 'area', 'isRequired', 'sortOrder', 'standardArvs', 'displayNumber', 'allowedValues', 'allowDuplicates', 'kronologiskVisning', 'arLogisk'] as const;
      for (const field of systemlastProtected) {
        delete updateData[field];
      }
      if (Object.keys(updateData).length === 0) {
        throw new ForbiddenError("Systemlåst metadata: strukturen är låst (endast beskrivning/ikon kan ändras). Värden redigeras fritt per objekt.");
      }
    }
    // Task #674: Område är grupperingsfältet — håll legacy `kategori` i synk när
    // området ändras (efter system-skyddet, så systemfält aldrig driftar).
    if (updateData.area !== undefined) {
      updateData.kategori = (updateData.area as string | null) || 'annat';
    }

    // Skiftlägesokänslig unikhets-/arkivkontroll vid omdöpning (samma invariant som
    // /api/metadata/types PUT). excludeId hindrar självkollision; arkiverade träffar
    // blockeras så denna yta inte kan återskapa "aktiv + arkiverad samma nyckel".
    if (typeof updateData.namn === "string" && updateData.namn) {
      const dupNamn = await findMetadataTypeByIdentity(tenantId, "namn", updateData.namn, { archived: false, excludeId: req.params.id });
      if (dupNamn) {
        throw new ConflictError(`Metadatatyp med kod '${updateData.namn}' finns redan`);
      }
      const archivedNamn = await findMetadataTypeByIdentity(tenantId, "namn", updateData.namn, { archived: true, excludeId: req.params.id });
      if (archivedNamn) {
        throw new ConflictError(
          `En arkiverad metadatatyp "${archivedNamn.namn}" finns redan. Återställ den från arkivet eller välj ett annat namn.`,
          { code: "ARCHIVED_METADATA_TYPE_EXISTS", field: "namn", archivedTypeId: archivedNamn.id },
        );
      }
    }
    if (typeof updateData.beteckning === "string" && updateData.beteckning) {
      const dupBet = await findMetadataTypeByIdentity(tenantId, "beteckning", updateData.beteckning, { archived: false, excludeId: req.params.id });
      if (dupBet) {
        throw new ConflictError(`Metadatatyp med beteckning '${updateData.beteckning}' finns redan`);
      }
      const archivedBet = await findMetadataTypeByIdentity(tenantId, "beteckning", updateData.beteckning, { archived: true, excludeId: req.params.id });
      if (archivedBet) {
        throw new ConflictError(
          `En arkiverad metadatatyp med beteckning "${archivedBet.beteckning}" finns redan. Återställ den från arkivet eller välj en annan beteckning.`,
          { code: "ARCHIVED_METADATA_TYPE_EXISTS", field: "beteckning", archivedTypeId: archivedBet.id },
        );
      }
    }

    const [updated] = await db.update(metadataKatalog)
      .set(updateData)
      .where(and(
        eq(metadataKatalog.id, req.params.id),
        eq(metadataKatalog.tenantId, tenantId)
      ))
      .returning();
    res.json(updated);
}));

app.delete("/api/metadata-labels/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const [existing] = await db.select().from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.id, req.params.id),
        eq(metadataKatalog.tenantId, tenantId)
      ));
    if (!existing) throw new NotFoundError("Etikett hittades inte");
    
    if (existing.isSystem) {
      throw new ForbiddenError("Systemmetadata kan inte raderas");
    }
    if (existing.systemlast) {
      throw new ForbiddenError("Systemlåst metadata kan inte raderas — strukturen är kanonisk. Värden kan tömmas per objekt.");
    }

    // Task #662: blockera radering av ett gruppfält som har underfält (FK skulle
    // annars ge ett rått DB-fel). Samma invariant som /api/metadata/types DELETE.
    // Endast aktiva (icke-arkiverade) underfält räknas — arkiverade barn blockerar ej.
    const children = await db.select({ id: metadataKatalog.id })
      .from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.tenantId, tenantId),
        eq(metadataKatalog.parentMetadataId, req.params.id),
        isNull(metadataKatalog.deletedAt),
      ));
    if (children.length > 0) {
      throw new ConflictError(
        `Kan inte radera — fältet är ett gruppfält med ${children.length} underfält. ` +
        `Ta bort eller flytta underfälten först.`,
      );
    }

    // Task #716: arkivering (soft-delete) istället för permanent radering — samma
    // beteende som DELETE /api/metadata/types/:id. Historiska snapshot/värden förblir
    // läsbara; arkiverade poster döljs från katalog/objektvyer och kan återställas
    // via admin-arkivet.
    const archivedBy = (req as any).session?.user?.id ?? null;
    const archived = await softDeleteMetadataType(tenantId, req.params.id, { archivedBy });
    if (!archived) throw new NotFoundError("Etikett hittades inte");
    res.status(204).send();
}));

// ============== OBJECT METADATA ==============
// Helper to verify object belongs to current tenant
async function verifyObjectTenant(objectId: string, tenantId: string): Promise<boolean> {
  const obj = await storage.getObject(objectId);
  return obj?.tenantId === tenantId;
}

app.get("/api/objects/:objectId/metadata", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    // Task #992: kanonisk källa = svenska modellen. Returnera kompatibel form
    // (id/objectId/value/valueJson/breaksInheritance + key=namn) härledd ur
    // getObjectWithAllMetadata (löser arv + beräknade fält + kundlås).
    const owm = await getObjectWithAllMetadata(req.params.objectId, tenantId);
    const metadata = (owm?.metadata ?? []).map((m) => ({
      id: m.id,
      objectId: req.params.objectId,
      tenantId,
      definitionId: m.metadataKatalogId,
      key: m.katalog.namn,
      value: getDisplayValue(m),
      valueJson: m.vardeJson ?? null,
      breaksInheritance: m.stoppaVidareArvning ?? false,
      inheritedFromObjectId: m.source === "inherited" ? (m.fromObject?.id ?? null) : null,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));
    res.json(metadata);
}));

app.post("/api/objects/:objectId/metadata", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    // Task #992: skriv till kanonisk svensk modell. definitionId === katalog.id
    // (compat-API:t) → lös upp katalog-namn och skapa via createMetadata (guards
    // för beräknade/system/dropdown/nivå-lås + historik körs där).
    const bodySchema = z.object({
      definitionId: z.string(),
      value: z.string().nullable().optional(),
      breaksInheritance: z.boolean().optional(),
    });
    const { definitionId, value, breaksInheritance } = bodySchema.parse(req.body);
    const [katalog] = await db.select({ namn: metadataKatalog.namn })
      .from(metadataKatalog)
      .where(and(eq(metadataKatalog.id, definitionId), eq(metadataKatalog.tenantId, tenantId)));
    if (!katalog) throw new NotFoundError("Metadatatyp hittades inte");
    const userId = req.user?.claims?.sub;
    let created = await createMetadata({
      tenantId,
      objektId: req.params.objectId,
      metadataTypNamn: katalog.namn,
      varde: value ?? null,
      skapadAv: userId,
    });
    if (breaksInheritance !== undefined) {
      // Task #1213: flagg-skrivning via centrala skrivlagret.
      const row = await setMetadataInheritanceFlags(created.id, tenantId, { stoppaVidareArvning: breaksInheritance });
      if (row) created = row;
    }
    res.status(201).json({
      id: created.id,
      objectId: req.params.objectId,
      tenantId,
      definitionId,
      key: katalog.namn,
      value: getDisplayValue(created),
      valueJson: created.vardeJson ?? null,
      breaksInheritance: created.stoppaVidareArvning ?? false,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
}));

app.patch("/api/objects/:objectId/metadata/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const updateSchema = z.object({
      value: z.string().optional(),
      breaksInheritance: z.boolean().optional(),
    });
    const { value, breaksInheritance } = updateSchema.parse(req.body);
    // Task #992: :id === metadata_varden.id. Verifiera ägarskap (objekt + tenant)
    // INNAN mutation — updateMetadata kollar bara tenant, inte objektbindning.
    const [existing] = await db.select().from(metadataVarden)
      .where(and(
        eq(metadataVarden.id, req.params.id),
        eq(metadataVarden.objektId, req.params.objectId),
        eq(metadataVarden.tenantId, tenantId),
      ));
    if (!existing) throw new NotFoundError("Metadata not found or does not belong to this object");
    const userId = req.user?.claims?.sub;
    if (value !== undefined) {
      await updateMetadata(req.params.id, value, tenantId, userId);
    }
    if (breaksInheritance !== undefined) {
      // Task #1213: flagg-skrivning via centrala skrivlagret (ägarskap mot
      // objektet är redan verifierat ovan).
      await setMetadataInheritanceFlags(req.params.id, tenantId, { stoppaVidareArvning: breaksInheritance }, userId ?? undefined);
    }
    const [updated] = await db.select().from(metadataVarden)
      .where(and(eq(metadataVarden.id, req.params.id), eq(metadataVarden.tenantId, tenantId)));
    res.json({
      id: updated.id,
      objectId: req.params.objectId,
      tenantId,
      definitionId: updated.metadataKatalogId,
      value: getDisplayValue(updated),
      valueJson: updated.vardeJson ?? null,
      breaksInheritance: updated.stoppaVidareArvning ?? false,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
}));

app.delete("/api/objects/:objectId/metadata/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    // Task #992: :id === metadata_varden.id. Verifiera ägarskap (objekt + tenant)
    // innan radering — deleteMetadata kollar bara tenant. Hård radering men loggar
    // metadata_historik (X → ∅) så tidslinjen bevaras.
    const [existing] = await db.select({ id: metadataVarden.id }).from(metadataVarden)
      .where(and(
        eq(metadataVarden.id, req.params.id),
        eq(metadataVarden.objektId, req.params.objectId),
        eq(metadataVarden.tenantId, tenantId),
      ));
    if (!existing) throw new NotFoundError("Metadata not found or does not belong to this object");
    const userId = req.user?.claims?.sub;
    await deleteMetadata(req.params.id, tenantId, userId);
    res.status(204).send();
}));

// ============== OBJECT PAYERS ==============
// Hjälpare: överlappskontroll mellan giltighetsperioder (open-ended NULL = ±oändlighet).
// Speglar logik i server/routes/importPayersRoutes.ts så enkelraderna får samma garanti
// som CSV-importen: två primary-betalare per objekt får inte överlappa i tiden.
// ============== BILLING CUSTOMER SELECTION ==============
// Etapp 5: en (1) kund per objekt, härledd ur Ekonomi-metadatat 'Kund'
// (arvs-medvetet). Multi-payer-split är borttagen med object_payers.
app.get("/api/objects/:objectId/billing-customers", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const { getObjectPrimaryCustomerId } = await import("../services/object-customer");
    const customerId = await getObjectPrimaryCustomerId(req.params.objectId);
    res.json({ multiPayer: false, defaultCustomerId: customerId ?? null, payers: [] });
}));

// ============== POLYLINE DATA ==============
app.get("/api/objects/:objectId/polyline", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const obj = await storage.getObject(req.params.objectId);
    if (!obj) throw new NotFoundError("Objekt hittades inte");
    res.json({ polylineData: obj.polylineData || null });
}));

app.put("/api/objects/:objectId/polyline", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const schema = z.object({
      polylineData: z.any().nullable(),
    });
    const { polylineData } = schema.parse(req.body);
    const updated = await storage.updateObject(req.params.objectId, { polylineData });
    res.json({ polylineData: updated?.polylineData || null });
}));

app.post("/api/objects/find-in-polygon", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      polygon: z.array(z.tuple([z.number(), z.number()])),
      coordinateFormat: z.enum(["lnglat", "latlng"]).default("lnglat"),
    });
    const { polygon, coordinateFormat } = schema.parse(req.body);

    const normalizedPolygon: [number, number][] = coordinateFormat === "lnglat"
      ? polygon.map(([lng, lat]) => [lat, lng])
      : polygon;

    const allObjects = await storage.getObjects(tenantId);
    const insideObjects = allObjects.filter((obj) => {
      if (!obj.latitude || !obj.longitude) return false;
      return pointInPolygon([obj.latitude, obj.longitude], normalizedPolygon);
    });
    res.json(insideObjects);
}));

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ============================================
// ROUTE FEEDBACK ENDPOINTS
// ============================================
app.get("/api/route-feedback", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { resourceId, startDate, endDate, limit: limitStr } = req.query as Record<string, string>;
    const parsedLimit = limitStr ? Math.min(Math.max(parseInt(limitStr) || 50, 1), 200) : undefined;

    const feedback = await storage.getRouteFeedback(tenantId, {
      resourceId: resourceId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit: parsedLimit,
    });

    const resources = await storage.getResources(tenantId);
    const resourceMap = new Map(resources.map(r => [r.id, r.name]));
    const enriched = feedback.map(f => ({
      ...f,
      resourceName: resourceMap.get(f.resourceId) || f.resourceId,
    }));
    res.json(enriched);
}));

app.get("/api/route-feedback/summary", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { startDate, endDate } = req.query as Record<string, string>;

    const summary = await storage.getRouteFeedbackSummary(tenantId, {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });

    const resources = await storage.getResources(tenantId);
    const resourceMap = new Map(resources.map(r => [r.id, r.name]));
    const enrichedByResource = summary.byResource.map(r => ({
      ...r,
      resourceName: resourceMap.get(r.resourceId) || r.resourceId,
    }));
    res.json({ ...summary, byResource: enrichedByResource });
}));

// ============================================
// INVITATIONS - User invitation management
// ============================================

app.get("/api/invitations", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const result = await db
      .select()
      .from(invitations)
      .where(eq(invitations.tenantId, tenantId))
      .orderBy(desc(invitations.createdAt));
    res.json(result);
}));

app.post("/api/invitations", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const user = req.user;
    const userId = user?.claims?.sub;

    const { email, role } = req.body;
    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw new ValidationError("Giltig e-postadress krävs");
    }

    const validRoles = ["owner", "admin", "planner", "technician", "user", "viewer"];
    if (role && !validRoles.includes(role)) {
      throw new ValidationError("Ogiltig roll");
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const existing = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.email, email.toLowerCase()),
          eq(invitations.tenantId, tenantId),
          eq(invitations.status, "pending")
        )
      );

    let invitation;
    if (existing.length > 0) {
      [invitation] = await db
        .update(invitations)
        .set({
          role: role || existing[0].role || "user",
          invitedBy: userId,
          createdAt: new Date(),
          expiresAt,
        })
        .where(eq(invitations.id, existing[0].id))
        .returning();
      console.log(`[invitation] Re-sending pending invitation for ${email.toLowerCase()}`);
    } else {
      [invitation] = await db
        .insert(invitations)
        .values({
          email: email.toLowerCase(),
          tenantId,
          role: role || "user",
          invitedBy: userId,
          status: "pending",
          expiresAt,
        })
        .returning();
    }

    const sendResult = await sendInvitationEmail(req, invitation);
    res.json({ ...sendResult.invitation, emailDelivered: sendResult.emailDelivered, emailError: sendResult.emailError });
}));

app.post("/api/invitations/:id/resend", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { id } = req.params;

    const [existing] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, id));

    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundError("Inbjudan hittades inte");
    }
    if (existing.status === "used") {
      throw new ValidationError("Inbjudan är redan accepterad");
    }

    // Förläng giltighetstiden + återställ till "pending" så magic-link-flödet
    // ser raden som "eligible" (gäller även utgångna/återkallade inbjudningar).
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [refreshed] = await db
      .update(invitations)
      .set({ expiresAt: newExpiry, status: "pending" })
      .where(eq(invitations.id, existing.id))
      .returning();

    console.log(`[invitation] Manual resend triggered for ${existing.email}`);
    const sendResult = await sendInvitationEmail(req, refreshed ?? existing);
    res.json({ ...sendResult.invitation, emailDelivered: sendResult.emailDelivered, emailError: sendResult.emailError });
}));

/**
 * Skickar inbjudningsmejl via magic-link-flödet (Task #515) — så att
 * mottagaren kan logga in direkt utan att behöva ett Replit-konto.
 * Tidigare skickades bara en ren app-URL vilket gjorde att inbjudna
 * användare fastnade på Replits samtyckesskärm.
 */
async function sendInvitationEmail(req: any, invitation: any): Promise<{ invitation: any; emailDelivered: boolean; emailError: string | null }> {
    const forwardedProto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim();
    const forwardedHost = (req.headers["x-forwarded-host"] as string)?.split(",")[0]?.trim();
    const host = forwardedHost || req.get("host");
    const proto = forwardedProto || (host && host.includes("localhost") ? "http" : "https");
    const baseUrl = host
      ? `${proto}://${host}`
      : process.env.PUBLIC_APP_URL || "https://traivo.replit.app";

    const result = await issueMagicLink({
      invitationId: invitation.id,
      baseUrl,
      req,
    });

    // issueMagicLink uppdaterar redan invitations.deliveryStatus/resendMessageId.
    const [updated] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitation.id));

    if (result.ok) {
      console.log(`[invitation] Magic-link sent for ${invitation.email}`);
      return { invitation: updated ?? invitation, emailDelivered: true, emailError: null };
    }

    const reason = result.reason === "send_failed"
      ? "E-postleverans misslyckades (kontrollera Resend-domänen)"
      : "Inbjudan är inte längre giltig (utgången eller redan använd)";
    console.error(`[invitation] Magic-link send failed for ${invitation.email}: ${result.reason}`);
    return { invitation: updated ?? invitation, emailDelivered: false, emailError: reason };
}

app.delete("/api/invitations/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { id } = req.params;

    const [invitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, id));

    if (!invitation || invitation.tenantId !== tenantId) {
      throw new NotFoundError("Inbjudan hittades inte");
    }

    if (invitation.status === "used") {
      throw new ValidationError("Kan inte ta bort en accepterad inbjudan");
    }

    await db.delete(invitations).where(eq(invitations.id, id));
    res.json({ success: true });
}));

// ============================================
// AI SALES INTELLIGENCE REPORT
// ============================================
interface SalesOpportunity {
  rank: number;
  customerName: string;
  type: string;
  description: string;
  estimatedValue: string;
  priority: string;
}

interface SalesIntelReport {
  summary: string;
  totalPotentialRevenue: string;
  opportunities: SalesOpportunity[];
  insights: string[];
  recommendations: string[];
}

interface CustomerSummary {
  name: string;
  customerNumber: string | null;
  lastOrderDate: string | null;
  totalHistoricOrders: number;
}

interface InactiveCustomer {
  name: string;
  customerNumber: string | null;
  lastOrderDate: string;
  daysSinceLastOrder: number;
}

interface SingleServiceCustomer {
  name: string;
  customerNumber: string | null;
  serviceType: string;
  orderCount: number;
}

interface HighVolumeCustomer {
  name: string;
  customerNumber: string | null;
  orderCount: number;
  avgValue: number;
  totalValue: number;
}

interface ObjectMetadataGap {
  objectName: string;
  objectNumber: string | null;
  customerName: string;
  metadataCount: number;
  hasOrders: boolean;
}

const salesIntelRequestSchema = z.object({
  recipientEmail: z.string().trim().email("Ogiltig e-postadress"),
  scope: z.enum(["all", "active_customers"]).default("all"),
});

app.post("/api/reports/sales-intelligence", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);

    const parsed = salesIntelRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || "Ogiltig förfrågan");
    }
    const { recipientEmail: validEmail, scope } = parsed.data;

    const { enforceBudgetAndRateLimit, withRetry } = await import("../ai-budget-service");
    const enforcement = await enforceBudgetAndRateLimit(tenantId, "analysis");
    if (!enforcement.allowed) {
      return res.status(429).json({
        error: enforcement.errorType === "ratelimit" ? "AI-anropsgräns nådd" : "AI-budget överskriden",
        message: enforcement.errorMessage,
      });
    }

    const customers = await storage.getCustomers(tenantId);
    const allOrders = await storage.getWorkOrders(tenantId, undefined, undefined, true, 50000);
    const articles = await storage.getArticles(tenantId);
    const tenant = await storage.getTenant(tenantId);
    const companyName = tenant?.name || "Företaget";

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const activeStatuses = ["skapad", "planerad_pre", "planerad_resurs", "planerad_las"];
    const completedStatuses = ["utford", "fakturerad"];

    const customerOrderMap = new Map<string, typeof allOrders>();
    for (const order of allOrders) {
      if (!customerOrderMap.has(order.customerId)) {
        customerOrderMap.set(order.customerId, []);
      }
      customerOrderMap.get(order.customerId)!.push(order);
    }

    const customersWithoutActiveOrders: CustomerSummary[] = [];
    const inactiveCustomers: InactiveCustomer[] = [];
    const singleServiceCustomers: SingleServiceCustomer[] = [];
    const highVolumeCustomers: HighVolumeCustomer[] = [];

    const scopeCustomers = scope === "active_customers"
      ? customers.filter(c => {
          const orders = customerOrderMap.get(c.id) || [];
          return orders.some(o => activeStatuses.includes(o.orderStatus || ""));
        })
      : customers;

    for (const customer of scopeCustomers) {
      const orders = customerOrderMap.get(customer.id) || [];
      const activeOrders = orders.filter(o => activeStatuses.includes(o.orderStatus || ""));
      const completedOrders = orders.filter(o => completedStatuses.includes(o.orderStatus || ""));
      const allCompleted = orders.filter(o => o.completedAt);

      if (activeOrders.length === 0) {
        const lastDate = allCompleted.length > 0
          ? allCompleted.sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())[0].completedAt
          : null;
        customersWithoutActiveOrders.push({
          name: customer.name,
          customerNumber: customer.customerNumber,
          lastOrderDate: lastDate ? new Date(lastDate).toLocaleDateString("sv-SE") : null,
          totalHistoricOrders: orders.length,
        });
      }

      if (allCompleted.length > 0) {
        const latestDate = allCompleted.sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())[0].completedAt!;
        if (new Date(latestDate) < sixMonthsAgo) {
          const daysSince = Math.floor((Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24));
          inactiveCustomers.push({
            name: customer.name,
            customerNumber: customer.customerNumber,
            lastOrderDate: new Date(latestDate).toLocaleDateString("sv-SE"),
            daysSinceLastOrder: daysSince,
          });
        }
      }

      const orderTypes = new Set(orders.map(o => o.orderType).filter(Boolean));
      if (orderTypes.size === 1 && orders.length >= 3) {
        singleServiceCustomers.push({
          name: customer.name,
          customerNumber: customer.customerNumber,
          serviceType: [...orderTypes][0]!,
          orderCount: orders.length,
        });
      }

      if (completedOrders.length >= 10) {
        const totalVal = completedOrders.reduce((sum, o) => sum + (o.cachedValue || 0), 0);
        const avgVal = Math.round(totalVal / completedOrders.length);
        highVolumeCustomers.push({
          name: customer.name,
          customerNumber: customer.customerNumber,
          orderCount: completedOrders.length,
          avgValue: avgVal,
          totalValue: totalVal,
        });
      }
    }

    highVolumeCustomers.sort((a, b) => a.avgValue - b.avgValue);
    inactiveCustomers.sort((a, b) => b.daysSinceLastOrder - a.daysSinceLastOrder);

    // Task #992: räkna objekt med metadata via kanoniska metadata_varden (ej
    // mjuk-raderade) i stället för engelska object_metadata.
    const objectsWithMetadata = await db.select({
      objectId: metadataVarden.objektId,
      count: sql<number>`count(*)::int`,
    }).from(metadataVarden)
      .where(and(
        eq(metadataVarden.tenantId, tenantId),
        eq(metadataVarden.raderad, false),
        eq(metadataVarden.status, "aktiv"),
        sql`${metadataVarden.objektId} IS NOT NULL`,
      ))
      .groupBy(metadataVarden.objektId);

    const objectIdsWithMetadata = new Set(objectsWithMetadata.map(r => r.objectId));
    const orderObjectIds = new Set(allOrders.map(o => o.objectId));

    const metadataNoOrderIds = [...objectIdsWithMetadata].filter(id => !orderObjectIds.has(id));
    const objectMetadataGaps: ObjectMetadataGap[] = [];
    if (metadataNoOrderIds.length > 0) {
      const gapObjectRows = await db.select({
          id: objects.id,
          name: objects.name,
          objectNumber: objects.objectNumber,
          customerId: primaryPayerCustomerIdSql(),
        })
        .from(objects)
        .where(and(eq(objects.tenantId, tenantId), inArray(objects.id, metadataNoOrderIds.slice(0, 50))));
      const customerNameMap = new Map(customers.map(c => [c.id, c.name]));
      const metaCountMap = new Map(objectsWithMetadata.map(r => [r.objectId, r.count]));
      for (const obj of gapObjectRows) {
        objectMetadataGaps.push({
          objectName: obj.name,
          objectNumber: obj.objectNumber,
          customerName: (obj.customerId ? customerNameMap.get(obj.customerId) : undefined) || "Okänd",
          metadataCount: metaCountMap.get(obj.id) || 0,
          hasOrders: false,
        });
      }
    }

    const articleTypes = articles.map(a => `${a.articleNumber} ${a.name}`).slice(0, 30).join(", ");

    const scopeCustomerIds = new Set(scopeCustomers.map(c => c.id));
    const scopeOrders = scope === "active_customers"
      ? allOrders.filter(o => scopeCustomerIds.has(o.customerId))
      : allOrders;

    const dataForAI = {
      companyName,
      scope,
      totalCustomers: scopeCustomers.length,
      totalOrders: scopeOrders.length,
      activeOrders: scopeOrders.filter(o => activeStatuses.includes(o.orderStatus || "")).length,
      completedOrders: scopeOrders.filter(o => completedStatuses.includes(o.orderStatus || "")).length,
      customersWithoutActiveOrders: customersWithoutActiveOrders.slice(0, 20),
      inactiveCustomers: inactiveCustomers.slice(0, 20),
      singleServiceCustomers: singleServiceCustomers.slice(0, 20),
      highVolumeCustomers: highVolumeCustomers.slice(0, 15),
      objectsWithMetadataButNoOrders: objectMetadataGaps.slice(0, 20),
      availableServices: articleTypes,
    };

    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    const prompt = `Du är en försäljningsanalytiker för ${companyName}, ett nordiskt fältserviceföretag.
Analysera följande kunddata och generera en strukturerad försäljningsrapport på svenska.

DATA:
${JSON.stringify(dataForAI, null, 2)}

Generera en JSON-rapport med exakt denna struktur:
{
  "summary": "Kort sammanfattning av analysresultatet (2-3 meningar)",
  "totalPotentialRevenue": "Uppskattat potentiellt intäktsvärde i SEK",
  "opportunities": [
    {
      "rank": 1,
      "customerName": "Kundnamn",
      "type": "upsell|cross-sell|reactivation|volume-increase",
      "description": "Konkret förslag på åtgärd",
      "estimatedValue": "Uppskattat värde i SEK",
      "priority": "high|medium|low"
    }
  ],
  "insights": [
    "Övergripande insikt 1",
    "Övergripande insikt 2"
  ],
  "recommendations": [
    "Rekommendation för att öka försäljning 1",
    "Rekommendation 2"
  ]
}

Fokusera på:
1. Top 10 konkreta försäljningsmöjligheter med kundnamn
2. Kunder som kan korsförsäljas fler tjänster
3. Inaktiva kunder som bör återaktiveras
4. Kunder med hög volym men lågt genomsnittsvärde (potential för premium-tjänster)
5. Objekt med metadata men inga beställningar (outnyttjad potential)
6. Uppskatta potentiellt intäktvärde i SEK

Svara ENBART med valid JSON, ingen annan text.`;

    const completion = await withRetry(
      () => openai.chat.completions.create({
        model: enforcement.model,
        messages: [{ role: "user", content: prompt }],
        ...(isReasoningModel(enforcement.model) ? {} : { temperature: 0.4 }),
        max_completion_tokens: 3000,
      }),
      { totalAttempts: 2, label: "sales-intelligence" }
    );

    const { trackOpenAIResponse } = await import("../api-usage-tracker");
    trackOpenAIResponse(completion, tenantId, "sales-intelligence");

    const aiResponseText = completion.choices[0]?.message?.content || "{}";

    const escHtml = (s: string | number | null | undefined): string =>
      String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    let aiReport: SalesIntelReport;
    try {
      const cleaned = aiResponseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const raw = JSON.parse(cleaned);
      aiReport = {
        summary: typeof raw.summary === "string" ? raw.summary : "AI-analysen genererades utan sammanfattning.",
        totalPotentialRevenue: typeof raw.totalPotentialRevenue === "string" ? raw.totalPotentialRevenue : "0 SEK",
        opportunities: Array.isArray(raw.opportunities)
          ? raw.opportunities.filter((o: unknown): o is SalesOpportunity =>
              typeof o === "object" && o !== null && "customerName" in o)
          : [],
        insights: Array.isArray(raw.insights)
          ? raw.insights.filter((i: unknown): i is string => typeof i === "string")
          : [],
        recommendations: Array.isArray(raw.recommendations)
          ? raw.recommendations.filter((r: unknown): r is string => typeof r === "string")
          : [],
      };
    } catch {
      aiReport = {
        summary: "AI-analysen kunde inte tolkas korrekt.",
        totalPotentialRevenue: "0 SEK",
        opportunities: [],
        insights: [aiResponseText.slice(0, 500)],
        recommendations: [],
      };
    }

    const typeLabels: Record<string, string> = {
      upsell: "Uppförsäljning",
      "cross-sell": "Korsförsäljning",
      reactivation: "Återaktivering",
      "volume-increase": "Volymökning",
    };

    const opportunitiesHtml = aiReport.opportunities.map((opp) => {
      const priorityColor = opp.priority === "high" ? "#dc2626" : opp.priority === "medium" ? "#f59e0b" : "#22c55e";
      return `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 12px 8px; font-weight: 600; color: #1B4B6B;">#${escHtml(opp.rank)}</td>
          <td style="padding: 12px 8px;">
            <div style="font-weight: 600;">${escHtml(opp.customerName)}</div>
            <div style="font-size: 13px; color: #6B7C8C;">${escHtml(opp.description)}</div>
          </td>
          <td style="padding: 12px 8px;">
            <span style="background: ${priorityColor}15; color: ${priorityColor}; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">
              ${escHtml(typeLabels[opp.type] || opp.type)}
            </span>
          </td>
          <td style="padding: 12px 8px; text-align: right; font-weight: 600; color: #4A9B9B;">${escHtml(opp.estimatedValue)}</td>
        </tr>
      `;
    }).join("");

    const insightsHtml = aiReport.insights.map((insight) =>
      `<li style="padding: 6px 0; color: #374151;">${escHtml(insight)}</li>`
    ).join("");

    const recommendationsHtml = aiReport.recommendations.map((rec) =>
      `<li style="padding: 6px 0; color: #374151;">${escHtml(rec)}</li>`
    ).join("");

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
      <body style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; background: #f3f4f6;">
        <div style="background: linear-gradient(135deg, #1B4B6B 0%, #2C3E50 100%); border-radius: 12px 12px 0 0; padding: 32px 24px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">📊 AI Försäljningsanalys</h1>
          <p style="color: #E8F4F8; margin: 8px 0 0 0; font-size: 14px;">${companyName} — ${new Date().toLocaleDateString("sv-SE")}</p>
        </div>

        <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <div style="background: #E8F4F8; border-left: 4px solid #4A9B9B; padding: 16px; margin-bottom: 24px; border-radius: 0 8px 8px 0;">
            <p style="margin: 0; color: #1B4B6B; font-size: 15px;">${escHtml(aiReport.summary)}</p>
            <p style="margin: 12px 0 0 0; font-size: 20px; font-weight: 700; color: #4A9B9B;">
              Uppskattat potentiellt värde: ${escHtml(aiReport.totalPotentialRevenue)}
            </p>
          </div>

          <div style="margin-bottom: 24px; background: #f9fafb; padding: 16px; border-radius: 8px;">
            <h3 style="color: #1B4B6B; margin: 0 0 4px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Dataunderlag</h3>
            <p style="margin: 0; color: #6B7C8C; font-size: 13px;">
              ${scopeCustomers.length} kunder · ${scopeOrders.length} ordrar · ${customersWithoutActiveOrders.length} kunder utan aktiva ordrar · ${inactiveCustomers.length} inaktiva (>6 mån)${scope === "active_customers" ? " · Filtrerat: enbart aktiva kunder" : ""}
            </p>
          </div>

          ${opportunitiesHtml ? `
          <h2 style="color: #1B4B6B; font-size: 18px; margin: 24px 0 12px 0; border-bottom: 2px solid #E8F4F8; padding-bottom: 8px;">
            🎯 Top försäljningsmöjligheter
          </h2>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 2px solid #e5e7eb;">
                <th style="padding: 8px; text-align: left; font-size: 12px; color: #6B7C8C; text-transform: uppercase;">#</th>
                <th style="padding: 8px; text-align: left; font-size: 12px; color: #6B7C8C; text-transform: uppercase;">Kund & åtgärd</th>
                <th style="padding: 8px; text-align: left; font-size: 12px; color: #6B7C8C; text-transform: uppercase;">Typ</th>
                <th style="padding: 8px; text-align: right; font-size: 12px; color: #6B7C8C; text-transform: uppercase;">Värde</th>
              </tr>
            </thead>
            <tbody>${opportunitiesHtml}</tbody>
          </table>
          ` : ""}

          ${insightsHtml ? `
          <h2 style="color: #1B4B6B; font-size: 18px; margin: 24px 0 12px 0; border-bottom: 2px solid #E8F4F8; padding-bottom: 8px;">
            💡 Övergripande insikter
          </h2>
          <ul style="padding-left: 20px; margin: 0;">${insightsHtml}</ul>
          ` : ""}

          ${recommendationsHtml ? `
          <h2 style="color: #1B4B6B; font-size: 18px; margin: 24px 0 12px 0; border-bottom: 2px solid #E8F4F8; padding-bottom: 8px;">
            ✅ Rekommendationer
          </h2>
          <ul style="padding-left: 20px; margin: 0;">${recommendationsHtml}</ul>
          ` : ""}
        </div>

        <p style="text-align: center; color: #9ca3af; font-size: 11px; margin-top: 16px;">
          Genererad av Traivo AI · ${new Date().toLocaleString("sv-SE")}
        </p>
      </body>
      </html>
    `;

    const emailResult = await sendEmail({
      to: validEmail,
      subject: `📊 AI Försäljningsanalys — ${companyName} — ${new Date().toLocaleDateString("sv-SE")}`,
      html: emailHtml,
    });

    if (emailResult.error) {
      throw new ValidationError(`Kunde inte skicka e-post: ${emailResult.error.message}`);
    }

    res.json({
      success: true,
      messageId: emailResult.data?.id,
      recipientEmail: validEmail,
      report: aiReport,
    });
}));

}
