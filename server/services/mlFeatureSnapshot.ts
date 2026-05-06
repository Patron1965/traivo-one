/**
 * ML Feature Snapshot Writer (Fas 0)
 *
 * Skriver frusna feature-rader till `ml_feature_snapshots` vid två tillfällen:
 *  - 'pre_optimization': när ett VRP-jobb skickas till OR-Tools (input-features
 *    kända just då, oberoende av faktisk utfall).
 *  - 'post_completion': när en order markeras utförd och `actualDuration` finns.
 *
 * Designprinciper:
 *  - Helt fail-safe. Alla fel sväljs och loggas — får ALDRIG bryta planering eller
 *    avslutsflödet. Snapshot-skrivning är observability, inte kritisk path.
 *  - Idempotent på (workOrderId, snapshotKind, snapshotAt) genom att caller
 *    väljer tidpunkt; vid duplicerade pre-snapshots inom samma jobb får vi
 *    flera rader (det är OK — träningen dedupar på senast per WO).
 *  - Tenant-isolation: tenantId krävs alltid.
 */
import { db } from "../db";
import { mlFeatureSnapshots, type WorkOrder, type Resource, type ServiceObject } from "@shared/schema";

export interface SnapshotInput {
  tenantId: string;
  workOrder: WorkOrder;
  resource?: Resource | null;
  object?: ServiceObject | null;
  snapshotKind: "pre_optimization" | "post_completion";
}

function safeWeekday(d: Date | null | undefined): number | null {
  if (!d) return null;
  const day = d.getDay();
  return day === 0 ? 6 : day - 1;
}

export async function writeMlFeatureSnapshot(input: SnapshotInput): Promise<void> {
  try {
    const { workOrder, resource, object, tenantId, snapshotKind } = input;
    const scheduledDate = workOrder.scheduledDate
      ? (workOrder.scheduledDate instanceof Date ? workOrder.scheduledDate : new Date(workOrder.scheduledDate))
      : null;

    await db.insert(mlFeatureSnapshots).values({
      tenantId,
      workOrderId: workOrder.id,
      resourceId: resource?.id ?? null,
      objectId: object?.id ?? workOrder.objectId ?? null,
      snapshotKind,
      estimatedDurationMin: workOrder.estimatedDuration ?? null,
      actualDurationMin: workOrder.actualDuration ?? null,
      setupMinutes: workOrder.setupTime ?? null,
      executionCode: workOrder.executionCode ?? null,
      taskCategory: workOrder.taskCategory ?? null,
      weekday: safeWeekday(scheduledDate),
      hourOfDay: scheduledDate ? scheduledDate.getHours() : null,
      month: scheduledDate ? scheduledDate.getMonth() + 1 : null,
      isWeekend: scheduledDate ? scheduledDate.getDay() === 0 || scheduledDate.getDay() === 6 : null,
      objectPostalCode: (object as unknown as { postalCode?: string | null })?.postalCode ?? null,
      objectLat: (object as unknown as { latitude?: number | null })?.latitude ?? null,
      objectLng: (object as unknown as { longitude?: number | null })?.longitude ?? null,
      resourceExperienceDays: null,
      rawFeatures: {
        priority: (workOrder as unknown as { priority?: number }).priority ?? null,
        clusterId: workOrder.clusterId ?? null,
        creationMethod: workOrder.creationMethod ?? null,
      },
    });
  } catch (err) {
    console.warn(
      "[ml-snapshot] write failed (non-blocking):",
      err instanceof Error ? err.message : err
    );
  }
}

export async function writeBatchSnapshots(inputs: SnapshotInput[]): Promise<{ written: number; failed: number }> {
  let written = 0;
  let failed = 0;
  for (const inp of inputs) {
    try {
      await writeMlFeatureSnapshot(inp);
      written++;
    } catch {
      failed++;
    }
  }
  return { written, failed };
}
