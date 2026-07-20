// Klumpningsmotorernas trigger-konstanter (ADR Klumpning v1).
//
// CLUSTERING_TRIGGERS definierar vilka fält på work_orders/assignments som,
// när de ändras, ska trigga en inkrementell omräkning av klumptillhörighet.
//
// Fyra dimensioner:
//   När   – tidsstyrda fält (leveransfönster, planerad vecka)
//   Var   – geografiska fält (adress, koordinater)
//   Hur   – utförandetyp (utförandekod)
//   Status – statusförändringar som påverkar planerbarhet
//
// Alla callers (PATCH /api/work-orders, PATCH /api/assignments, etc.) använder
// shouldRecluster() för att avgöra om en klumpanalys ska köas. Kön är asynkron
// och dedupliceras — flera ändringar på samma uppgift ger EN analys.

export const CLUSTERING_TRIGGERS = [
  // === När ===
  'scheduledDate',
  'deliveryWindowStart',
  'deliveryWindowEnd',
  'plannedWindowStart',
  'plannedWindowEnd',
  'roughPlannedWeek',
  'preferredWeek',
  'desiredDeliveryStart',
  'desiredDeliveryEnd',
  // === Var ===
  'address',
  'latitude',
  'longitude',
  'centroidLat',
  'centroidLng',
  'taskLatitude',
  'taskLongitude',
  // === Hur ===
  'executionCode',
  // === Status ===
  'status',
  'orderStatus',
  'executionStatus',
  'impossibleReason',
] as const;

export type ClusteringTriggerField = (typeof CLUSTERING_TRIGGERS)[number];

/**
 * Avgör om ett set av ändrade fält ska trigga en klumpomräkning.
 * Callers (PATCH-routes) extraherar fältnamnen från req.body och anropar detta.
 *
 * @example
 *   const changed = Object.keys(req.body);
 *   if (shouldRecluster(changed)) {
 *     clusteringQueue.enqueue({ taskId: id, taskTable: 'work_orders', tenantId });
 *   }
 */
export function shouldRecluster(changedFields: string[]): boolean {
  const triggerSet = new Set<string>(CLUSTERING_TRIGGERS);
  return changedFields.some(f => triggerSet.has(f));
}

/**
 * Returnerar vilka av de ändrade fälten som är klumptriggers.
 * Användbart för loggning och debug.
 */
export function getClusteringTriggers(changedFields: string[]): string[] {
  const triggerSet = new Set<string>(CLUSTERING_TRIGGERS);
  return changedFields.filter(f => triggerSet.has(f));
}

/**
 * Precision-nivå baserat på hur långt fram i tid en uppgift/klump ligger.
 *   high   ≤ 30 dagar  → tät inkrementell omräkning vid varje trigger
 *   medium  30–90 dagar → schemalagd daglig körning
 *   low    > 90 dagar  → schemalagd veckovis körning
 */
export function deriveClusterPrecision(
  targetDate: Date | null | undefined,
  now: Date = new Date()
): 'high' | 'medium' | 'low' {
  if (!targetDate) return 'high';
  const daysAhead = (targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysAhead <= 30) return 'high';
  if (daysAhead <= 90) return 'medium';
  return 'low';
}
