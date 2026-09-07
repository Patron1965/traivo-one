/**
 * Task #1236 — Proportionell fördelning av verklig tid över en klumps uppgifter.
 *
 * En "klump" (flera uppgifter utförda i samma fältbesök) registreras ofta med
 * EN total verklig tid för hela besöket. Den totala tiden ska fördelas över
 * uppgifterna proportionerligt mot deras beräknade/planerade andel
 * (estimatedDuration), inte delas lika. Störst-rest-metoden används så att
 * summan av fördelade minuter alltid blir exakt lika med totalen (samma
 * mönster som computeConceptSubscriptionFee för öresfördelning).
 *
 * Behöriga användare (planner/admin/owner) kan justera fördelningen manuellt
 * i efterhand; en manuellt satt rad låses (actualDurationManual=true) mot att
 * skrivas över av en framtida auto-fördelning tills gruppen fördelas om.
 */
import { db } from "../db";
import { workOrders, taskEvents, type WorkOrder } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { TaskEventActor } from "./task-event-log";

export class ActualTimeDistributionError extends Error {}

function largestRemainderSplit(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0 || weights.length === 0) {
    // Ingen giltig vikt (t.ex. alla estimatedDuration=0) — dela lika.
    const n = weights.length || 1;
    const base = Math.floor(total / n);
    const remainder = total - base * n;
    return weights.map((_, i) => base + (i < remainder ? 1 : 0));
  }
  const raw = weights.map((w) => (total * w) / weightSum);
  const floors = raw.map((r) => Math.floor(r));
  let allocated = floors.reduce((s, f) => s + f, 0);
  let remaining = total - allocated;
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (let k = 0; k < order.length && remaining > 0; k++) {
    result[order[k].i] += 1;
    remaining--;
  }
  return result;
}

/**
 * Fördela `totalActualMinutes` proportionerligt över `workOrderIds` (en klump)
 * baserat på varje uppgifts estimatedDuration. Skriver actualDuration +
 * actualTimeGroupKey; hoppar ALDRIG över auto-fördelning för rader som är
 * manuellt låsta (actualDurationManual=true) — deras andel behålls fast och
 * återstoden fördelas proportionerligt över de icke-låsta raderna.
 */
export async function distributeActualTime(params: {
  tenantId: string;
  workOrderIds: string[];
  totalActualMinutes: number;
  groupKey?: string;
  actor: TaskEventActor;
}): Promise<Array<{ id: string; actualDuration: number }>> {
  const { tenantId, workOrderIds, totalActualMinutes, actor } = params;
  if (!Array.isArray(workOrderIds) || workOrderIds.length === 0) {
    throw new ActualTimeDistributionError("Minst en uppgift krävs för fördelning");
  }
  if (!Number.isFinite(totalActualMinutes) || totalActualMinutes < 0) {
    throw new ActualTimeDistributionError("Ogiltig total tid");
  }

  const groupKey = params.groupKey || `klump-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  const ids = [...new Set(workOrderIds)].sort();
  if (ids.length !== workOrderIds.length) {
    throw new ActualTimeDistributionError("Samma uppgift får inte anges flera gånger");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM work_orders WHERE tenant_id = ${tenantId} AND id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) ORDER BY id FOR UPDATE`);
    const rows = await tx.select().from(workOrders)
      .where(and(eq(workOrders.tenantId, tenantId), inArray(workOrders.id, ids)));
    if (rows.length !== ids.length) {
      throw new ActualTimeDistributionError("En eller flera uppgifter hittades inte i denna tenant");
    }
    if (rows.some((row) => row.frozenAt != null || row.invoiceQueueState != null)) {
      throw new ActualTimeDistributionError("Verklig tid kan inte ändras efter frysning eller fakturakö");
    }
    const locked = rows.filter((r) => r.actualDurationManual);
    const free = rows.filter((r) => !r.actualDurationManual);
    const lockedMinutes = locked.reduce((s, r) => s + (r.actualDuration ?? 0), 0);
    const remainingMinutes = Math.max(0, totalActualMinutes - lockedMinutes);
    const splits = largestRemainderSplit(
      remainingMinutes,
      free.map((r) => Math.max(0, r.estimatedDuration ?? 0)),
    );
    const result: Array<{ id: string; actualDuration: number }> = [];
    for (const r of locked) {
      result.push({ id: r.id, actualDuration: r.actualDuration ?? 0 });
      await tx.update(workOrders).set({ actualTimeGroupKey: groupKey }).where(eq(workOrders.id, r.id));
    }
    for (let i = 0; i < free.length; i++) {
      const actualDuration = splits[i];
      await tx.update(workOrders)
        .set({ actualDuration, actualTimeGroupKey: groupKey, actualDurationManual: false })
        .where(eq(workOrders.id, free[i].id));
      result.push({ id: free[i].id, actualDuration });
    }
    await tx.insert(taskEvents).values(
      rows.map((r) => ({
        tenantId,
        workOrderId: r.id,
        eventType: "actual_time_distributed" as const,
        timeKind: "verklig" as const,
        actorType: actor.type,
        actorId: actor.id ?? null,
        occurredAt: now,
        detail: {
          groupKey,
          totalActualMinutes,
          allocated: result.find((x) => x.id === r.id)?.actualDuration ?? null,
        },
      })),
    );
    return result;
  });
}

/**
 * Manuell justering av fördelningen (behöriga användare, se requirePlanner).
 * Skriver allocations exakt som angivet och låser raderna (actualDurationManual
 * = true) mot framtida auto-fördelning inom samma grupp.
 */
export async function adjustActualTimeDistribution(params: {
  tenantId: string;
  allocations: Array<{ workOrderId: string; actualDuration: number }>;
  actor: TaskEventActor;
}): Promise<void> {
  const { tenantId, allocations, actor } = params;
  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new ActualTimeDistributionError("Minst en rad krävs");
  }
  const ids = [...new Set(allocations.map((a) => a.workOrderId))].sort();
  if (ids.length !== allocations.length) throw new ActualTimeDistributionError("Samma uppgift får inte anges flera gånger");
  for (const a of allocations) {
    if (!Number.isFinite(a.actualDuration) || a.actualDuration < 0) {
      throw new ActualTimeDistributionError(`Ogiltig tid för uppgift ${a.workOrderId}`);
    }
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM work_orders WHERE tenant_id = ${tenantId} AND id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) ORDER BY id FOR UPDATE`);
    const rows = await tx.select().from(workOrders)
      .where(and(eq(workOrders.tenantId, tenantId), inArray(workOrders.id, ids)));
    if (rows.length !== ids.length) throw new ActualTimeDistributionError("En eller flera uppgifter hittades inte i denna tenant");
    if (rows.some((row) => row.frozenAt != null || row.invoiceQueueState != null)) {
      throw new ActualTimeDistributionError("Verklig tid kan inte ändras efter frysning eller fakturakö");
    }
    for (const a of allocations) {
      await tx.update(workOrders)
        .set({ actualDuration: a.actualDuration, actualDurationManual: true })
        .where(eq(workOrders.id, a.workOrderId));
    }
    await tx.insert(taskEvents).values(
      allocations.map((a) => ({
        tenantId,
        workOrderId: a.workOrderId,
        eventType: "actual_time_adjusted" as const,
        timeKind: "verklig" as const,
        actorType: actor.type,
        actorId: actor.id ?? null,
        occurredAt: now,
        detail: { actualDuration: a.actualDuration },
      })),
    );
  });
}
