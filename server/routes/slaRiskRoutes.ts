import type { Express } from "express";
import { db } from "../db";
import { and, eq, inArray, desc, asc, sql, gte, lte, isNull } from "drizzle-orm";
import { z } from "zod";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { ValidationError } from "../errors";
import {
  slaRiskSnapshots,
  workOrders,
  customers,
  objects,
  clusters,
  SLA_RISK_LEVELS,
} from "@shared/schema";
import {
  computeTenantSlaRisk,
  getSlaRiskSettings,
  upsertSlaRiskSettings,
} from "../services/sla-risk-engine";

export function registerSlaRiskRoutes(app: Express) {
  // GET aggregated risk summary (counts + cluster breakdown for next 7 days)
  app.get("/api/sla-risk/summary", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const counts = await db
      .select({
        riskLevel: slaRiskSnapshots.riskLevel,
        count: sql<number>`count(*)::int`,
      })
      .from(slaRiskSnapshots)
      .where(eq(slaRiskSnapshots.tenantId, tenantId))
      .groupBy(slaRiskSnapshots.riskLevel);

    const summary = { ok: 0, warning: 0, critical: 0, total: 0 };
    for (const c of counts) {
      const lvl = c.riskLevel as "ok" | "warning" | "critical";
      summary[lvl] = c.count;
      summary.total += c.count;
    }

    const lastRow = await db
      .select({ calculatedAt: slaRiskSnapshots.calculatedAt })
      .from(slaRiskSnapshots)
      .where(eq(slaRiskSnapshots.tenantId, tenantId))
      .orderBy(desc(slaRiskSnapshots.calculatedAt))
      .limit(1);

    res.json({
      summary,
      calculatedAt: lastRow[0]?.calculatedAt || null,
    });
  }));

  // GET cluster-level risk aggregate for next 7 days
  app.get("/api/sla-risk/clusters", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 30);
    const horizon = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        clusterId: slaRiskSnapshots.clusterId,
        riskLevel: slaRiskSnapshots.riskLevel,
        count: sql<number>`count(*)::int`,
      })
      .from(slaRiskSnapshots)
      .where(
        and(
          eq(slaRiskSnapshots.tenantId, tenantId),
          lte(slaRiskSnapshots.deadlineAt, horizon),
        ),
      )
      .groupBy(slaRiskSnapshots.clusterId, slaRiskSnapshots.riskLevel);

    const tenantClusters = await db
      .select({ id: clusters.id, name: clusters.name, color: clusters.color, slaLevel: clusters.slaLevel })
      .from(clusters)
      .where(eq(clusters.tenantId, tenantId));

    type ClusterAgg = {
      clusterId: string | null;
      name: string;
      color: string | null;
      slaLevel: string | null;
      ok: number;
      warning: number;
      critical: number;
      total: number;
      worst: "ok" | "warning" | "critical";
    };

    const map = new Map<string, ClusterAgg>();
    for (const c of tenantClusters) {
      map.set(c.id, {
        clusterId: c.id,
        name: c.name,
        color: c.color,
        slaLevel: c.slaLevel,
        ok: 0, warning: 0, critical: 0, total: 0, worst: "ok",
      });
    }
    map.set("_none", {
      clusterId: null, name: "Utan kluster", color: null, slaLevel: null,
      ok: 0, warning: 0, critical: 0, total: 0, worst: "ok",
    });

    for (const r of rows) {
      const key = r.clusterId || "_none";
      const agg = map.get(key);
      if (!agg) continue;
      const lvl = r.riskLevel as "ok" | "warning" | "critical";
      agg[lvl] += r.count;
      agg.total += r.count;
      if (r.riskLevel === "critical") agg.worst = "critical";
      else if (r.riskLevel === "warning" && agg.worst !== "critical") agg.worst = "warning";
    }

    const result = Array.from(map.values()).filter(c => c.total > 0).sort((a, b) => {
      const order = { critical: 0, warning: 1, ok: 2 };
      if (order[a.worst] !== order[b.worst]) return order[a.worst] - order[b.worst];
      return b.critical - a.critical || b.warning - a.warning;
    });

    res.json({ clusters: result, days, horizon: horizon.toISOString() });
  }));

  // GET detailed risky jobs
  app.get("/api/sla-risk/jobs", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const querySchema = z.object({
      riskLevel: z.string().optional(),
      clusterId: z.string().optional(),
      limit: z.coerce.number().min(1).max(200).default(50),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError("Ogiltiga parametrar");
    const { limit, clusterId, riskLevel } = parsed.data;

    const wheres = [eq(slaRiskSnapshots.tenantId, tenantId)];
    if (riskLevel) {
      const levels = riskLevel.split(",").filter(l => SLA_RISK_LEVELS.includes(l as any));
      if (levels.length > 0) wheres.push(inArray(slaRiskSnapshots.riskLevel, levels));
    }
    if (clusterId) wheres.push(eq(slaRiskSnapshots.clusterId, clusterId));

    const snapshots = await db
      .select()
      .from(slaRiskSnapshots)
      .where(and(...wheres))
      .orderBy(asc(slaRiskSnapshots.daysToBreach))
      .limit(limit);

    if (snapshots.length === 0) return res.json({ jobs: [] });

    const orderIds = snapshots.map(s => s.workOrderId);
    const orders = await db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        objectId: workOrders.objectId,
        customerId: workOrders.customerId,
        clusterId: workOrders.clusterId,
        scheduledDate: workOrders.scheduledDate,
        plannedWindowEnd: workOrders.plannedWindowEnd,
        estimatedDuration: workOrders.estimatedDuration,
        orderStatus: workOrders.orderStatus,
        resourceId: workOrders.resourceId,
      })
      .from(workOrders)
      .where(inArray(workOrders.id, orderIds));
    const orderById = new Map(orders.map(o => [o.id, o]));

    const customerIds = Array.from(new Set(orders.map(o => o.customerId).filter(Boolean) as string[]));
    const customerRows = customerIds.length > 0
      ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, customerIds))
      : [];
    const customerById = new Map(customerRows.map(c => [c.id, c.name]));

    const objectIds = Array.from(new Set(orders.map(o => o.objectId).filter(Boolean) as string[]));
    const objectRows = objectIds.length > 0
      ? await db.select({ id: objects.id, name: objects.name }).from(objects).where(inArray(objects.id, objectIds))
      : [];
    const objectById = new Map(objectRows.map(o => [o.id, o.name]));

    const clusterIds = Array.from(new Set(snapshots.map(s => s.clusterId).filter(Boolean) as string[]));
    const clusterRows = clusterIds.length > 0
      ? await db.select({ id: clusters.id, name: clusters.name, color: clusters.color }).from(clusters).where(inArray(clusters.id, clusterIds))
      : [];
    const clusterById = new Map(clusterRows.map(c => [c.id, c]));

    const jobs = snapshots.map(s => {
      const o = orderById.get(s.workOrderId);
      const cluster = s.clusterId ? clusterById.get(s.clusterId) : null;
      return {
        workOrderId: s.workOrderId,
        title: o?.title || `WO-${s.workOrderId.slice(0, 8)}`,
        riskLevel: s.riskLevel,
        daysToBreach: s.daysToBreach,
        deadlineAt: s.deadlineAt,
        predictedCompletionDate: s.predictedCompletionDate,
        reason: s.reason,
        scheduledDate: o?.scheduledDate || null,
        estimatedDuration: o?.estimatedDuration || null,
        orderStatus: o?.orderStatus || null,
        assigned: !!o?.resourceId,
        customerName: o?.customerId ? customerById.get(o.customerId) || null : null,
        objectName: o?.objectId ? objectById.get(o.objectId) || null : null,
        cluster: cluster ? { id: cluster.id, name: cluster.name, color: cluster.color } : null,
      };
    });

    res.json({ jobs });
  }));

  // GET / PUT settings
  app.get("/api/sla-risk/settings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    res.json(await getSlaRiskSettings(tenantId));
  }));

  app.put("/api/sla-risk/settings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      warningDaysToBreach: z.number().min(0).max(60).optional(),
      criticalDaysToBreach: z.number().min(0).max(60).optional(),
      backlogOverloadFactor: z.number().min(0.1).max(10).optional(),
      defaultMaxDaysToComplete: z.number().min(1).max(365).optional(),
      notifyOnWarningToCritical: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Ogiltiga inställningar");
    const updated = await upsertSlaRiskSettings(tenantId, parsed.data);
    res.json(updated);
  }));

  // POST manual recompute
  app.post("/api/sla-risk/recompute", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const result = await computeTenantSlaRisk(tenantId);
    res.json({
      computed: result.snapshots.length,
      transitions: result.transitions.length,
      counts: {
        ok: result.snapshots.filter(s => s.riskLevel === "ok").length,
        warning: result.snapshots.filter(s => s.riskLevel === "warning").length,
        critical: result.snapshots.filter(s => s.riskLevel === "critical").length,
      },
    });
  }));
}
