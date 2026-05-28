// Bakgrundsjob för metadata-ändringar — task #552 krav (D).
// När metadata uppdateras på ett objekt kan det påverka:
//  1. Priser/totaler på aktiva arbetsordrar (om metadata används i prisregler)
//  2. Dynamisk kluster-tillhörighet
//
// Designval: fire-and-forget, debounced per tenant. Vi blockerar inte
// metadata-skrivningen, men loggar misslyckanden. Större batchar (CSV-import)
// kan kalla `enqueueMetadataChange` med `force: true` för att alltid köra
// kluster-utvärdering efteråt.
import { db } from "../db";
import { workOrders } from "@shared/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { storage } from "../storage";
import { evaluateAllDynamicClusters } from "./dynamic-clusters";

const ACTIVE_STATUSES = ["draft", "planned", "scheduled", "pending"];

type Pending = { tenantId: string; objectIds: Set<string>; timer: NodeJS.Timeout | null };
const pendingByTenant = new Map<string, Pending>();
const DEBOUNCE_MS = 4000;

export function enqueueMetadataChange(
  tenantId: string,
  objectId: string,
  opts: { force?: boolean } = {},
): void {
  let p = pendingByTenant.get(tenantId);
  if (!p) {
    p = { tenantId, objectIds: new Set(), timer: null };
    pendingByTenant.set(tenantId, p);
  }
  p.objectIds.add(objectId);
  if (p.timer) clearTimeout(p.timer);
  const delay = opts.force ? 0 : DEBOUNCE_MS;
  p.timer = setTimeout(() => {
    const objectIds = Array.from(p!.objectIds);
    pendingByTenant.delete(tenantId);
    runMetadataChangeJob(tenantId, objectIds).catch(err => {
      console.error(`[metadata-change-jobs] failed for tenant ${tenantId}:`, err);
    });
  }, delay);
}

async function runMetadataChangeJob(tenantId: string, objectIds: string[]): Promise<void> {
  const start = Date.now();

  // 1. Räkna om totaler på påverkade aktiva arbetsordrar
  let recalcCount = 0;
  try {
    const rows = await db
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        inArray(workOrders.objectId, objectIds),
        isNull(workOrders.deletedAt),
        inArray(workOrders.status, ACTIVE_STATUSES),
      ));
    const ids = rows.map(r => r.id);
    if (ids.length > 0 && typeof (storage as any).recalculateWorkOrderTotalsBulk === "function") {
      const r = await (storage as any).recalculateWorkOrderTotalsBulk(ids);
      recalcCount = r?.recalculated ?? ids.length;
    }
  } catch (err) {
    console.error(`[metadata-change-jobs] recalc failed:`, err);
  }

  // 2. Re-evaluera dynamiska kluster
  let clusterAssigned = 0;
  try {
    const r = await evaluateAllDynamicClusters(tenantId);
    clusterAssigned = r.totalAssigned + r.totalRemoved;
  } catch (err) {
    console.error(`[metadata-change-jobs] dynamic-cluster eval failed:`, err);
  }

  const ms = Date.now() - start;
  console.log(`[metadata-change-jobs] tenant=${tenantId} objects=${objectIds.length} recalc=${recalcCount} clusterDelta=${clusterAssigned} ms=${ms}`);
}

// Test-helper för synkron körning (används endast i utveckling).
export async function runMetadataChangeJobNow(tenantId: string, objectIds: string[]): Promise<void> {
  return runMetadataChangeJob(tenantId, objectIds);
}
