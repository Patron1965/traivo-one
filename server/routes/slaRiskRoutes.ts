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
  SLA_RISK_LEVELS,
} from "@shared/schema";
import {
  computeTenantSlaRisk,
  getSlaRiskSettings,
  upsertSlaRiskSettings,
} from "../services/sla-risk-engine";
import { dashboardCache, DASHBOARD_CACHE_TTL } from "../services/dashboardCache";

export function registerSlaRiskRoutes(app: Express) {
  // GET aggregated risk summary (counts + cluster breakdown for next 7 days)
  app.get("/api/sla-risk/summary", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const payload = await dashboardCache.getOrCompute(
      tenantId,
      "sla:summary",
      DASHBOARD_CACHE_TTL.SLA_SUMMARY_MS,
      async () => {
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

        return {
          summary,
          calculatedAt: lastRow[0]?.calculatedAt || null,
        };
      },
    );
    res.json(payload);
  }));

  // GET detailed risky jobs
  app.get("/api/sla-risk/jobs", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const querySchema = z.object({
      riskLevel: z.string().optional(),
      limit: z.coerce.number().min(1).max(200).default(50),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError("Ogiltiga parametrar");
    const { limit, riskLevel } = parsed.data;

    const wheres = [eq(slaRiskSnapshots.tenantId, tenantId)];
    if (riskLevel) {
      const levels = riskLevel.split(",").filter(l => SLA_RISK_LEVELS.includes(l as any));
      if (levels.length > 0) wheres.push(inArray(slaRiskSnapshots.riskLevel, levels));
    }

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

    const jobs = snapshots.map(s => {
      const o = orderById.get(s.workOrderId);
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
    dashboardCache.invalidateTenant(tenantId, "sla:");
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
