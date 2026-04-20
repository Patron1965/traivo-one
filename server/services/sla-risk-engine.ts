import { db } from "../db";
import { and, eq, gte, isNull, isNotNull, inArray, sql, desc } from "drizzle-orm";
import {
  workOrders,
  clusters,
  resources,
  planningParameters,
  slaRiskSnapshots,
  slaRiskSettings,
  userTenantRoles,
  type SlaRiskLevel,
  type SlaRiskSettings,
} from "@shared/schema";
import { storage } from "../storage";
import { notificationService } from "../notifications";

const DAY_MS = 24 * 60 * 60 * 1000;
const COMPLETED_STATUSES = new Set(["utford", "avslutad", "completed", "cancelled", "avbruten"]);
const SLA_LEVEL_DEFAULT_DAYS: Record<string, number> = {
  express: 1,
  premium: 3,
  enterprise: 3,
  standard: 14,
};

export const DEFAULT_SLA_SETTINGS: Omit<SlaRiskSettings, "tenantId" | "updatedAt"> = {
  warningDaysToBreach: 3,
  criticalDaysToBreach: 1,
  backlogOverloadFactor: 1.0,
  defaultMaxDaysToComplete: 14,
  notifyOnWarningToCritical: true,
};

export async function getSlaRiskSettings(tenantId: string): Promise<SlaRiskSettings> {
  const [row] = await db.select().from(slaRiskSettings).where(eq(slaRiskSettings.tenantId, tenantId));
  if (row) return row;
  return {
    tenantId,
    ...DEFAULT_SLA_SETTINGS,
    updatedAt: new Date(),
  };
}

export async function upsertSlaRiskSettings(
  tenantId: string,
  patch: Partial<Omit<SlaRiskSettings, "tenantId" | "updatedAt">>,
): Promise<SlaRiskSettings> {
  const existing = await getSlaRiskSettings(tenantId);
  const merged = { ...existing, ...patch, tenantId, updatedAt: new Date() };
  await db
    .insert(slaRiskSettings)
    .values(merged)
    .onConflictDoUpdate({
      target: slaRiskSettings.tenantId,
      set: {
        warningDaysToBreach: merged.warningDaysToBreach,
        criticalDaysToBreach: merged.criticalDaysToBreach,
        backlogOverloadFactor: merged.backlogOverloadFactor,
        defaultMaxDaysToComplete: merged.defaultMaxDaysToComplete,
        notifyOnWarningToCritical: merged.notifyOnWarningToCritical,
        updatedAt: merged.updatedAt,
      },
    });
  return merged;
}

interface RiskComputation {
  workOrderId: string;
  clusterId: string | null;
  predictedCompletionDate: Date;
  deadlineAt: Date;
  riskLevel: SlaRiskLevel;
  daysToBreach: number;
  reason: string;
}

export async function computeTenantSlaRisk(tenantId: string): Promise<{
  snapshots: RiskComputation[];
  transitions: { workOrderId: string; from: SlaRiskLevel; to: SlaRiskLevel; clusterId: string | null; reason: string }[];
}> {
  const settings = await getSlaRiskSettings(tenantId);
  const now = new Date();

  // 1. Open work orders for tenant
  const openOrders = await db
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.tenantId, tenantId),
        isNull(workOrders.deletedAt),
        isNull(workOrders.completedAt),
      ),
    );

  const openIds = openOrders.map(o => o.id).filter(Boolean);
  if (openIds.length === 0) {
    return { snapshots: [], transitions: [] };
  }

  // 2. Planning parameters (per object/customer/generic)
  const params = await db
    .select()
    .from(planningParameters)
    .where(eq(planningParameters.tenantId, tenantId));

  const paramByObject = new Map<string, typeof params[number]>();
  const paramByCustomer = new Map<string, typeof params[number]>();
  let genericParam: (typeof params)[number] | null = null;
  for (const p of params) {
    if (p.objectId) paramByObject.set(p.objectId, p);
    else if (p.customerId) paramByCustomer.set(p.customerId, p);
    else genericParam = p;
  }

  // 3. Clusters
  const tenantClusters = await db
    .select({ id: clusters.id, slaLevel: clusters.slaLevel, name: clusters.name })
    .from(clusters)
    .where(eq(clusters.tenantId, tenantId));
  const clusterById = new Map(tenantClusters.map(c => [c.id, c]));

  // 4. Resources for capacity
  const tenantResources = await db
    .select({ id: resources.id, weeklyHours: resources.weeklyHours, status: resources.status, deletedAt: resources.deletedAt })
    .from(resources)
    .where(and(eq(resources.tenantId, tenantId), isNull(resources.deletedAt)));
  const activeResources = tenantResources.filter(r => r.status === "active");
  const totalWeeklyMinutes = activeResources.reduce((s, r) => s + (r.weeklyHours || 40) * 60, 0);
  const totalDailyMinutes = totalWeeklyMinutes / 5;

  // 5. Historical actual/estimated ratio per cluster (R5 feedback) — last 90d completed orders
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS);
  const completed = await db
    .select({
      clusterId: workOrders.clusterId,
      estimatedDuration: workOrders.estimatedDuration,
      actualDuration: workOrders.actualDuration,
    })
    .from(workOrders)
    .where(
      and(
        eq(workOrders.tenantId, tenantId),
        isNotNull(workOrders.completedAt),
        gte(workOrders.completedAt, ninetyDaysAgo),
        isNotNull(workOrders.actualDuration),
      ),
    );

  const ratioByCluster = new Map<string, number>();
  const ratioCount = new Map<string, { sum: number; n: number }>();
  for (const c of completed) {
    const est = c.estimatedDuration || 0;
    const act = c.actualDuration || 0;
    if (est <= 0 || act <= 0) continue;
    const ratio = act / est;
    const key = c.clusterId || "_none";
    const cur = ratioCount.get(key) || { sum: 0, n: 0 };
    cur.sum += ratio;
    cur.n += 1;
    ratioCount.set(key, cur);
  }
  ratioCount.forEach((v, k) => ratioByCluster.set(k, v.n > 0 ? v.sum / v.n : 1));

  // Per-cluster backlog minutes (open jobs)
  const backlogByCluster = new Map<string, number>();
  const orderCountByCluster = new Map<string, number>();
  for (const o of openOrders) {
    const key = o.clusterId || "_none";
    const ratio = ratioByCluster.get(key) || 1;
    backlogByCluster.set(key, (backlogByCluster.get(key) || 0) + (o.estimatedDuration || 60) * ratio);
    orderCountByCluster.set(key, (orderCountByCluster.get(key) || 0) + 1);
  }

  // Cluster share of capacity = orderShare. If no clusters, use full capacity.
  const totalOpen = openOrders.length || 1;
  const capacityByCluster = new Map<string, number>();
  orderCountByCluster.forEach((count, key) => {
    const share = count / totalOpen;
    capacityByCluster.set(key, totalDailyMinutes * Math.max(share, 0.05));
  });

  // 6. Previous snapshot risk levels for transitions
  const prevSnapshots = await db
    .select({ workOrderId: slaRiskSnapshots.workOrderId, riskLevel: slaRiskSnapshots.riskLevel })
    .from(slaRiskSnapshots)
    .where(eq(slaRiskSnapshots.tenantId, tenantId));
  const prevByOrder = new Map<string, SlaRiskLevel>();
  for (const s of prevSnapshots) prevByOrder.set(s.workOrderId, s.riskLevel as SlaRiskLevel);

  // 7. Per-job calculation
  const computations: RiskComputation[] = [];
  const transitions: { workOrderId: string; from: SlaRiskLevel; to: SlaRiskLevel; clusterId: string | null; reason: string }[] = [];

  // Sort backlog FIFO by createdAt within each cluster, accumulate days-in-queue
  const ordersByCluster = new Map<string, typeof openOrders>();
  for (const o of openOrders) {
    const key = o.clusterId || "_none";
    if (!ordersByCluster.has(key)) ordersByCluster.set(key, []);
    ordersByCluster.get(key)!.push(o);
  }
  Array.from(ordersByCluster.values()).forEach(arr => {
    arr.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  });

  for (const [clusterKey, arr] of Array.from(ordersByCluster.entries())) {
    const ratio = ratioByCluster.get(clusterKey) || 1;
    const dailyCap = capacityByCluster.get(clusterKey) || totalDailyMinutes || 480;
    let cumulativeMinutes = 0;
    for (const o of arr) {
      // Resolve maxDays
      const param = (o.objectId && paramByObject.get(o.objectId))
        || (o.customerId && paramByCustomer.get(o.customerId))
        || genericParam;
      let maxDays = param?.maxDaysToComplete ?? settings.defaultMaxDaysToComplete;
      const cluster = o.clusterId ? clusterById.get(o.clusterId) : null;
      if (!param && cluster?.slaLevel) {
        maxDays = SLA_LEVEL_DEFAULT_DAYS[cluster.slaLevel] ?? maxDays;
      }

      const baseDate = o.createdAt || now;
      const deadlineAt = new Date(baseDate.getTime() + maxDays * DAY_MS);

      // Predicted completion
      let predictedCompletionDate: Date;
      if (o.scheduledDate) {
        predictedCompletionDate = new Date(o.scheduledDate);
      } else {
        const jobMinutes = (o.estimatedDuration || 60) * ratio;
        cumulativeMinutes += jobMinutes;
        const daysOut = dailyCap > 0 ? cumulativeMinutes / dailyCap : maxDays;
        predictedCompletionDate = new Date(now.getTime() + daysOut * DAY_MS);
      }

      const daysToBreach = (deadlineAt.getTime() - now.getTime()) / DAY_MS;
      const overdue = predictedCompletionDate.getTime() > deadlineAt.getTime();

      let riskLevel: SlaRiskLevel = "ok";
      let reason = "";
      if (daysToBreach <= 0 || overdue) {
        riskLevel = "critical";
        reason = daysToBreach <= 0
          ? `Deadline överskriden med ${Math.abs(daysToBreach).toFixed(1)} dagar`
          : `Prognos överskrider deadline (${predictedCompletionDate.toISOString().slice(0, 10)} vs ${deadlineAt.toISOString().slice(0, 10)})`;
      } else if (daysToBreach <= settings.criticalDaysToBreach) {
        riskLevel = "critical";
        reason = `Endast ${daysToBreach.toFixed(1)} dagar kvar till deadline`;
      } else if (daysToBreach <= settings.warningDaysToBreach) {
        const backlogMin = backlogByCluster.get(clusterKey) || 0;
        const weeklyCap = dailyCap * 5;
        const overload = weeklyCap > 0 ? backlogMin / weeklyCap : 0;
        if (overload >= settings.backlogOverloadFactor) {
          riskLevel = "warning";
          reason = `${daysToBreach.toFixed(1)} dagar kvar, klusterbacklog ${(overload * 100).toFixed(0)}% av kapacitet`;
        } else {
          riskLevel = "warning";
          reason = `${daysToBreach.toFixed(1)} dagar kvar till deadline`;
        }
      } else {
        reason = `${daysToBreach.toFixed(1)} dagar kvar`;
      }

      computations.push({
        workOrderId: o.id,
        clusterId: o.clusterId || null,
        predictedCompletionDate,
        deadlineAt,
        riskLevel,
        daysToBreach,
        reason,
      });

      const prev = prevByOrder.get(o.id) || "ok";
      if (prev !== riskLevel) {
        transitions.push({ workOrderId: o.id, from: prev, to: riskLevel, clusterId: o.clusterId || null, reason });
      }
    }
  }

  // 8. Persist snapshots — replace previous set
  await db.delete(slaRiskSnapshots).where(eq(slaRiskSnapshots.tenantId, tenantId));
  if (computations.length > 0) {
    const rows = computations.map(c => ({
      tenantId,
      workOrderId: c.workOrderId,
      clusterId: c.clusterId,
      predictedCompletionDate: c.predictedCompletionDate,
      deadlineAt: c.deadlineAt,
      riskLevel: c.riskLevel,
      daysToBreach: c.daysToBreach,
      reason: c.reason,
      previousRiskLevel: prevByOrder.get(c.workOrderId) || "ok",
    }));
    // Insert in chunks of 500
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(slaRiskSnapshots).values(rows.slice(i, i + 500));
    }
  }

  // 9. Notify on warning -> critical transitions
  if (settings.notifyOnWarningToCritical) {
    const newCritical = transitions.filter(t => t.to === "critical" && t.from !== "critical");
    if (newCritical.length > 0) {
      const planners = await db
        .select({ userId: userTenantRoles.userId })
        .from(userTenantRoles)
        .where(
          and(
            eq(userTenantRoles.tenantId, tenantId),
            eq(userTenantRoles.isActive, true),
            inArray(userTenantRoles.role, ["owner", "admin"]),
          ),
        );
      for (const t of newCritical.slice(0, 25)) {
        for (const p of planners) {
          try {
            const created = await storage.createUserNotification({
              tenantId,
              userId: p.userId,
              type: "sla_risk_critical",
              title: "SLA-risk: kritisk",
              message: `Order ${t.workOrderId.slice(0, 8)} har blivit kritisk: ${t.reason}`,
              link: `/orders/${t.workOrderId}`,
              data: { workOrderId: t.workOrderId, from: t.from, to: t.to, clusterId: t.clusterId },
            });
            notificationService.sendUserNotification(p.userId, {
              notificationId: created.id,
              type: created.type,
              title: created.title,
              message: created.message,
              link: created.link,
              data: created.data as Record<string, unknown>,
              createdAt: created.createdAt.toISOString(),
            });
          } catch (err) {
            console.error("[sla-risk] notification failed", err);
          }
        }
      }
    }
  }

  return { snapshots: computations, transitions };
}
