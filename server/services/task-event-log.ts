/**
 * Task #1188 — Uppgiftens tidslogg (händelselogg).
 *
 * Append-only logg per uppgift (work_order). Varje statusövergång och tidsstämpel
 * skrivs som en NY rad; ingen rad skrivs någonsin över. Loggen är fristående från
 * audit_logs (generisk fält-diff) och additiv/expand-contract — den läser bara
 * work_orders och det låsta status-kontraktet (deriveUppgiftStatus), aldrig
 * omdefinierar det.
 *
 * `logWorkOrderTransition()` diffar en före/efter-ögonblicksbild av en work_order
 * och appenderar de händelser som verkligen skett. Best-effort: anroparen ska
 * fånga eventuella fel så att en loggmiss aldrig blockerar affärsoperationen.
 */
import { db } from "../db";
import { taskEvents, type WorkOrder, type InsertTaskEvent } from "@shared/schema";
import { deriveUppgiftStatus, type UppgiftStatus, type UppgiftStatusInput } from "@shared/uppgift-contract";
import { and, asc, eq } from "drizzle-orm";

export type TaskEventActor = {
  type: "user" | "resource" | "system";
  id?: string | null;
};

type WoSnapshot = Partial<WorkOrder> & Record<string, unknown>;

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

function dayPart(v: unknown): string | null {
  const iso = toIso(v);
  return iso ? iso.slice(0, 10) : null;
}

function uppgiftStatusOf(wo: WoSnapshot): UppgiftStatus {
  const input: UppgiftStatusInput = {
    orderStatus: (wo.orderStatus as UppgiftStatusInput["orderStatus"]) ?? null,
    executionStatus: (wo.executionStatus as UppgiftStatusInput["executionStatus"]) ?? null,
    invoiceQueueState: (wo.invoiceQueueState as UppgiftStatusInput["invoiceQueueState"]) ?? null,
    impossible: Boolean(wo.impossibleReason),
  };
  return deriveUppgiftStatus(input);
}

/**
 * Diffa en work_order-övergång och appendera händelser till tidsloggen.
 * Skriver 0..N rader i EN insert. Idempotent i den meningen att bara faktiska
 * förändringar loggas (ingen no-op-rad).
 */
export async function logWorkOrderTransition(params: {
  tenantId: string;
  before: WoSnapshot;
  after: WoSnapshot;
  actor: TaskEventActor;
}): Promise<void> {
  const { tenantId, before, after, actor } = params;
  const workOrderId = (after.id as string) || (before.id as string);
  if (!tenantId || !workOrderId) return;

  const now = new Date();
  const rows: InsertTaskEvent[] = [];
  const base = {
    tenantId,
    workOrderId,
    actorType: actor.type,
    actorId: actor.id ?? null,
  } as const;

  // 1) Kanonisk uppgiftsstatus (deriveUppgiftStatus) — endast vid verklig ändring.
  const fromStatus = uppgiftStatusOf(before);
  const toStatus = uppgiftStatusOf(after);
  if (fromStatus !== toStatus) {
    rows.push({
      ...base,
      eventType: "status_changed",
      fromStatus,
      toStatus,
      occurredAt: now,
      detail: {},
    });
  }

  // 2) Studs grov↔fin (planned_rough ↔ planned_fine) — båda mappar till "planerad"
  //    i kontraktet, så detta fångar rörelsen som status_changed inte ser.
  const beforeExec = before.executionStatus as string | null | undefined;
  const afterExec = after.executionStatus as string | null | undefined;
  const isRoughFine = (s: string | null | undefined) => s === "planned_rough" || s === "planned_fine";
  if (beforeExec !== afterExec && isRoughFine(beforeExec) && isRoughFine(afterExec)) {
    rows.push({
      ...base,
      eventType: "bounce",
      timeKind: "planerad",
      occurredAt: now,
      detail: { from: beforeExec, to: afterExec },
    });
  }

  // 3) Ombokning: schemalagt datum eller starttid ändrad.
  const beforeDay = dayPart(before.scheduledDate);
  const afterDay = dayPart(after.scheduledDate);
  const beforeStart = (before.scheduledStartTime as string | null) ?? null;
  const afterStart = (after.scheduledStartTime as string | null) ?? null;
  if (beforeDay !== afterDay || beforeStart !== afterStart) {
    rows.push({
      ...base,
      eventType: "rescheduled",
      timeKind: "planerad",
      occurredAt: now,
      detail: { fromDate: beforeDay, toDate: afterDay, fromTime: beforeStart, toTime: afterStart },
    });
  }

  // 4) Resurs ombokad.
  const beforeRes = (before.resourceId as string | null) ?? null;
  const afterRes = (after.resourceId as string | null) ?? null;
  if (beforeRes !== afterRes) {
    rows.push({
      ...base,
      eventType: "resource_reassigned",
      occurredAt: now,
      detail: { from: beforeRes, to: afterRes },
    });
  }

  // 5) Önskad leveranstid satt/ändrad.
  const desiredChanged =
    toIso(before.desiredDeliveryStart) !== toIso(after.desiredDeliveryStart) ||
    toIso(before.desiredDeliveryEnd) !== toIso(after.desiredDeliveryEnd);
  if (desiredChanged) {
    rows.push({
      ...base,
      eventType: "desired_window_set",
      timeKind: "onskad",
      occurredAt: now,
      detail: {
        from: { start: toIso(before.desiredDeliveryStart), end: toIso(before.desiredDeliveryEnd) },
        to: { start: toIso(after.desiredDeliveryStart), end: toIso(after.desiredDeliveryEnd) },
      },
    });
  }

  // 6) Planerad tid (tidsfönster) satt/ändrad.
  const plannedChanged =
    toIso(before.plannedWindowStart) !== toIso(after.plannedWindowStart) ||
    toIso(before.plannedWindowEnd) !== toIso(after.plannedWindowEnd);
  if (plannedChanged) {
    rows.push({
      ...base,
      eventType: "planned_window_set",
      timeKind: "planerad",
      occurredAt: now,
      detail: {
        from: { start: toIso(before.plannedWindowStart), end: toIso(before.plannedWindowEnd) },
        to: { start: toIso(after.plannedWindowStart), end: toIso(after.plannedWindowEnd) },
      },
    });
  }

  // 7) Verkliga tidsstämplar som nyss sattes (null → satt). occurredAt = den
  //    faktiska tidsstämpeln så att tidslinjen blir korrekt.
  const actualStamps: Array<{ field: keyof WorkOrder; eventType: string; reasonField?: keyof WorkOrder }> = [
    { field: "onWayAt" as keyof WorkOrder, eventType: "en_route" },
    { field: "onSiteAt" as keyof WorkOrder, eventType: "arrived" },
    { field: "completedAt" as keyof WorkOrder, eventType: "completed" },
    { field: "impossibleAt" as keyof WorkOrder, eventType: "impossible", reasonField: "impossibleReason" as keyof WorkOrder },
  ];
  for (const stamp of actualStamps) {
    const beforeVal = toDate((before as Record<string, unknown>)[stamp.field as string]);
    const afterVal = toDate((after as Record<string, unknown>)[stamp.field as string]);
    if (!beforeVal && afterVal) {
      const detail: Record<string, unknown> = {};
      if (stamp.reasonField) {
        const reason = (after as Record<string, unknown>)[stamp.reasonField as string];
        if (reason) detail.reason = String(reason);
      }
      rows.push({
        ...base,
        eventType: stamp.eventType,
        timeKind: "verklig",
        occurredAt: afterVal,
        detail,
      });
    }
  }

  if (rows.length === 0) return;
  await db.insert(taskEvents).values(rows);
}

/** Läs uppgiftens tidslogg (kronologiskt, äldst först). Tenant-scopad. */
export async function getTaskEvents(tenantId: string, workOrderId: string) {
  return db
    .select()
    .from(taskEvents)
    .where(and(eq(taskEvents.tenantId, tenantId), eq(taskEvents.workOrderId, workOrderId)))
    .orderBy(asc(taskEvents.occurredAt), asc(taskEvents.createdAt));
}
