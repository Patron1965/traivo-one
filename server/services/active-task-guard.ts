/**
 * Task #1236 — En aktiv uppgift åt gången.
 *
 * En resurs kan bara ha EN aktiv "verklig tid"-post samtidigt, oavsett
 * uppgiftstyp: produktion (work_orders med onSiteAt satt, completedAt null)
 * eller restid/ställtid/rast/egen tid (work_entries med endTime null).
 *
 * Denna guard körs precis INNAN en ny post blir aktiv (WO→paborjad,
 * work-entry startas utan endTime) och stänger alla ANDRA aktiva poster för
 * samma resurs — verklig tid räknas fram till "nu" precis som om användaren
 * själv klarmarkerat/stoppat föregående uppgift. Best-effort ur anroparens
 * perspektiv får den ALDRIG blockera den nya starten, men fel loggas.
 */
import { db } from "../db";
import { workOrders, workEntries, taskEvents, type WorkOrder } from "@shared/schema";
import { and, eq, isNull, isNotNull, ne } from "drizzle-orm";
import { logWorkOrderTransition, type TaskEventActor } from "./task-event-log";

export type ClosedActiveTask =
  | { kind: "work_order"; id: string; actualDuration: number }
  | { kind: "work_entry"; id: string; durationMinutes: number };

/**
 * Stänger alla andra aktiva "verklig tid"-poster för en resurs.
 * Anropas innan en ny post blir aktiv (exkludera dess id/typ via `except`).
 */
export async function closeOtherActiveWork(
  tenantId: string,
  resourceId: string,
  opts: {
    exceptWorkOrderId?: string;
    exceptWorkEntryId?: string;
    actor: TaskEventActor;
    reason?: string;
  },
): Promise<ClosedActiveTask[]> {
  if (!tenantId || !resourceId) return [];
  const now = new Date();
  const closed: ClosedActiveTask[] = [];

  try {
    // 1) Andra work_orders som är "på plats" men inte klarmarkerade.
    const activeConds = [
      eq(workOrders.tenantId, tenantId),
      eq(workOrders.resourceId, resourceId),
      isNotNull(workOrders.onSiteAt),
      isNull(workOrders.completedAt),
      isNull(workOrders.impossibleAt),
    ];
    if (opts.exceptWorkOrderId) activeConds.push(ne(workOrders.id, opts.exceptWorkOrderId));
    const activeOrders = await db.select().from(workOrders).where(and(...activeConds));

    for (const order of activeOrders) {
      const actualDuration = order.onSiteAt
        ? Math.max(0, Math.round((now.getTime() - new Date(order.onSiteAt).getTime()) / 60000))
        : 0;
      const updateData: Partial<WorkOrder> = {
        orderStatus: "utford" as WorkOrder["orderStatus"],
        executionStatus: "completed",
        completedAt: now,
        actualDuration,
      } as Partial<WorkOrder>;
      const [updated] = await db
        .update(workOrders)
        .set(updateData as Record<string, unknown>)
        .where(eq(workOrders.id, order.id))
        .returning();

      try {
        await logWorkOrderTransition({
          tenantId,
          before: order as unknown as Record<string, unknown>,
          after: (updated ?? { ...order, ...updateData }) as unknown as Record<string, unknown>,
          actor: opts.actor,
        });
        await db.insert(taskEvents).values({
          tenantId,
          workOrderId: order.id,
          eventType: "auto_completed",
          timeKind: "verklig",
          actorType: opts.actor.type,
          actorId: opts.actor.id ?? null,
          occurredAt: now,
          detail: { reason: opts.reason || "new_task_started", replacedBy: opts.exceptWorkOrderId ?? null },
        });
      } catch (logErr) {
        console.error("[active-task-guard] failed to log auto-complete for", order.id, logErr);
      }

      closed.push({ kind: "work_order", id: order.id, actualDuration });
    }

    // 2) Andra öppna work_entries (restid/ställtid/rast/egen tid/produktion).
    const entryConds = [
      eq(workEntries.tenantId, tenantId),
      eq(workEntries.resourceId, resourceId),
      isNull(workEntries.endTime),
    ];
    if (opts.exceptWorkEntryId) entryConds.push(ne(workEntries.id, opts.exceptWorkEntryId));
    const openEntries = await db.select().from(workEntries).where(and(...entryConds));

    for (const entry of openEntries) {
      const durationMinutes = Math.max(0, Math.round((now.getTime() - new Date(entry.startTime).getTime()) / 60000));
      await db
        .update(workEntries)
        .set({ endTime: now, durationMinutes })
        .where(eq(workEntries.id, entry.id));
      closed.push({ kind: "work_entry", id: entry.id, durationMinutes });
    }
  } catch (err) {
    console.error("[active-task-guard] closeOtherActiveWork failed:", err);
  }

  return closed;
}
