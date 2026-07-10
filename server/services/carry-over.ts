import { storage } from "../storage";
import type { WorkOrder, Resource, PlanningParameter } from "@shared/schema";

export type CarryOverStatus = "green" | "yellow" | "red";

export interface CarryOverSummary {
  tenantId: string;
  today: string;          // YYYY-MM-DD (tenant-lokalt)
  tomorrow: string;       // YYYY-MM-DD
  remainingTodayOrders: number;
  remainingTodayContainers: number;
  plannedTomorrowOrders: number;
  plannedTomorrowContainers: number;
  totalContainers: number;
  capacityTomorrow: number;     // dailyTarget * antal aktiva resurser
  dailyTarget: number;          // per resurs/dag
  activeResourceCount: number;
  loadPercent: number;          // round(total/capacity * 100)
  status: CarryOverStatus;
  thresholdPercent: number;     // röd-tröskel (default 110)
}

// Håller "kvar idag"-räkningen i synk med KPI-dashboard (kpiRoutes.ts) som
// endast räknar bort utförda/fakturerade ordrar; avbrutna/omojliga räknas också
// bort (de tar inte resurser imorgon).
const COMPLETED_STATUSES = new Set(["utford", "fakturerad"]);
const CANCELLED_STATUSES = new Set(["avbruten", "omojlig"]);

function isRemaining(o: WorkOrder): boolean {
  if (o.completedAt) return false;
  if (o.orderStatus && COMPLETED_STATUSES.has(o.orderStatus)) return false;
  if (o.orderStatus && CANCELLED_STATUSES.has(o.orderStatus)) return false;
  if (o.executionStatus === "completed") return false;
  return true;
}

function resourceDailyCapacity(resource: Resource, tenantParam: PlanningParameter | null, defaultTarget: number): number {
  if (tenantParam?.dailyStopTarget && tenantParam.dailyStopTarget > 0) return tenantParam.dailyStopTarget;
  // Fallback: weeklyHours * stopsPerHour / 5 arbetsdagar.
  const weeklyHours = resource.weeklyHours ?? 0;
  const stopsPerHour = tenantParam?.stopsPerHour ?? 0;
  if (weeklyHours > 0 && stopsPerHour > 0) {
    return Math.max(1, Math.round((weeklyHours * stopsPerHour) / 5));
  }
  return defaultTarget;
}

function classifyStatus(loadPercent: number, thresholdPercent: number): CarryOverStatus {
  if (loadPercent > thresholdPercent) return "red";
  if (loadPercent > 100) return "yellow";
  return "green";
}

/**
 * Returnerar carry-over-sammanfattning för en tenant.
 *
 * `today` och `tomorrow` ska vara konstruerade i tenant-lokal tidszon (kallaren
 * ansvarar). Default-tröskel: 110% röd (>100% gul). Default per-resurs-dagsmål
 * (kärl/dag): 90 (Kinab-break-even). Båda kan justeras via planning_parameters.
 */
export async function computeTenantCarryOver(
  tenantId: string,
  today: Date,
  tomorrow: Date,
): Promise<CarryOverSummary> {
  const [todayOrders, tomorrowOrders, resources, params] = await Promise.all([
    storage.getWorkOrdersByDate(tenantId, today),
    storage.getWorkOrdersByDate(tenantId, tomorrow),
    storage.getResources(tenantId),
    storage.getPlanningParameters(tenantId),
  ]);

  const tenantParam = params.find(p => !p.customerId && !p.objectId) ?? null;
  const thresholdPercent = tenantParam?.carryOverThresholdPercent ?? 110;
  const defaultTarget = parseInt(process.env.CARRY_OVER_DEFAULT_DAILY_TARGET ?? "90", 10) || 90;

  const objectIds = Array.from(new Set(
    [...todayOrders, ...tomorrowOrders].map(o => o.objectId).filter((id): id is string => !!id),
  ));
  // Etapp 5: kärl-antal läses ur metadata ('Antal kärl'), ej objektkolumner.
  const containerByObject = new Map<string, number>();
  if (objectIds.length > 0) {
    const { getObjectsMetadataValueByKatalogNamn } = await import("../metadata-queries");
    const karlValues = await getObjectsMetadataValueByKatalogNamn(tenantId, objectIds, "Antal kärl");
    for (const [objectId, value] of Object.entries(karlValues)) {
      const n = parseInt(value, 10);
      if (Number.isFinite(n)) containerByObject.set(objectId, n);
    }
  }

  const remainingToday = todayOrders.filter(isRemaining);
  const remainingTodayContainers = remainingToday.reduce(
    (s, o) => s + (o.objectId ? (containerByObject.get(o.objectId) || 0) : 0),
    0,
  );
  const plannedTomorrowContainers = tomorrowOrders.reduce(
    (s, o) => s + (o.objectId ? (containerByObject.get(o.objectId) || 0) : 0),
    0,
  );
  const totalContainers = remainingTodayContainers + plannedTomorrowContainers;

  const activeResources = resources.filter(r => r.status === "active" && !r.deletedAt);
  const capacityTomorrow = activeResources.reduce(
    (s, r) => s + resourceDailyCapacity(r, tenantParam, defaultTarget),
    0,
  );

  const loadPercent = capacityTomorrow > 0
    ? Math.round((totalContainers / capacityTomorrow) * 100)
    : (totalContainers > 0 ? 999 : 0);
  const status = classifyStatus(loadPercent, thresholdPercent);

  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return {
    tenantId,
    today: fmt(today),
    tomorrow: fmt(tomorrow),
    remainingTodayOrders: remainingToday.length,
    remainingTodayContainers,
    plannedTomorrowOrders: tomorrowOrders.length,
    plannedTomorrowContainers,
    totalContainers,
    capacityTomorrow,
    dailyTarget: tenantParam?.dailyStopTarget ?? defaultTarget,
    activeResourceCount: activeResources.length,
    loadPercent,
    status,
    thresholdPercent,
  };
}

export function carryOverNotificationCopy(summary: CarryOverSummary): { title: string; message: string } {
  const statusLabel = summary.status === "red" ? "Hög risk" : summary.status === "yellow" ? "Hög belastning" : "Inom plan";
  const title = `${statusLabel} imorgon (${summary.loadPercent}%)`;
  const message =
    `Kärl kvar idag: ${summary.remainingTodayContainers} (${summary.remainingTodayOrders} order). ` +
    `Planerat imorgon: ${summary.plannedTomorrowContainers} kärl (${summary.plannedTomorrowOrders} order). ` +
    `Total belastning: ${summary.totalContainers}/${summary.capacityTomorrow} ` +
    `(${summary.activeResourceCount} resurser, ${summary.dailyTarget} kärl/dag).`;
  return { title, message };
}
