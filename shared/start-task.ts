// ============================================================================
// Startuppgifter (Task #1216, Etapp 4)
// ----------------------------------------------------------------------------
// En startuppgift är en RIKTIG arbetsorder/tidspost med geografisk position som
// ersätter team-/teamledar-/klusterposition som planeringsgrund. Ruttberäkning
// i veckoplanen och VRP utgår från startuppgiftens position → föregående
// uppgift → nästa uppgift, aldrig från teamfält eller GPS.
//
// Konvention (expand-contract, inga nya kolumner):
//   - work_orders.order_type    = "startpunkt"
//   - work_orders.task_category = "start"  (→ locationRequirement "ingen":
//     startuppgiften är inte ett rutt-JOBB, den är kedjans startpunkt)
//   - work_orders.task_latitude/task_longitude = positionen
//   - work_orders.metadata.startType = en av START_TASK_TYPES
// ============================================================================

/** orderType-värdet som identifierar en startuppgift. */
export const START_TASK_ORDER_TYPE = "startpunkt";

/** taskCategory-värdet för startuppgifter (ej rutt-jobb, ingen platskravs-gate). */
export const START_TASK_CATEGORY = "start";

/** Tillåtna startuppgifts-typer med svenska etiketter. */
export const START_TASK_TYPES = [
  { value: "hem", label: "Hem" },
  { value: "hotell", label: "Hotell" },
  { value: "depa", label: "Depå" },
  { value: "lager", label: "Lager" },
  { value: "nattvila", label: "Nattvila" },
  { value: "helgvila", label: "Helgvila" },
] as const;

export type StartTaskType = (typeof START_TASK_TYPES)[number]["value"];

export function startTaskTypeLabel(value: string | null | undefined): string {
  const found = START_TASK_TYPES.find((t) => t.value === value);
  return found ? found.label : "Startpunkt";
}

/** True om arbetsordern är en startuppgift. */
export function isStartTask(wo: { orderType?: string | null }): boolean {
  return wo.orderType === START_TASK_ORDER_TYPE;
}

/**
 * Bygger en karta rad-id (teamId eller resourceId) → startpunkt (lat/lng) ur en
 * lista arbetsordrar. Endast startuppgifter med giltig position räknas. Vid
 * flera startuppgifter för samma rad vinner den med tidigast starttid.
 */
export function buildStartTaskPointMap(
  workOrders: Array<{
    orderType?: string | null;
    teamId?: string | null;
    resourceId?: string | null;
    taskLatitude?: number | null;
    taskLongitude?: number | null;
    scheduledStartTime?: string | null;
  }>,
): Map<string, { lat: number; lng: number }> {
  const best = new Map<string, { lat: number; lng: number; time: string }>();
  for (const wo of workOrders) {
    if (!isStartTask(wo)) continue;
    if (wo.taskLatitude == null || wo.taskLongitude == null) continue;
    const time = wo.scheduledStartTime ?? "99:99";
    const keys: string[] = [];
    if (wo.teamId) keys.push(wo.teamId);
    if (wo.resourceId) keys.push(wo.resourceId);
    for (const key of keys) {
      const existing = best.get(key);
      if (!existing || time < existing.time) {
        best.set(key, { lat: wo.taskLatitude, lng: wo.taskLongitude, time });
      }
    }
  }
  const out = new Map<string, { lat: number; lng: number }>();
  best.forEach((v, k) => out.set(k, { lat: v.lat, lng: v.lng }));
  return out;
}
