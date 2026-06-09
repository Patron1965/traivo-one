// Task #836 (Artikel Fas 3): Varningssystem för tidskonflikter.
//
// Rena beräkningsfunktioner (inga DB-anrop) som upptäcker fyra varningstyper:
//   1. overlap     — överlappande tidsfönster för samma resurs.
//   2. travel      — otillräcklig res-/föregående-jobb-tid mellan på varandra
//                    följande uppgifter för samma resurs.
//   3. leadtime    — leveranstid (ledtid) som passerar leveransdatumet, dvs
//                    beställningsdatumet ligger redan i det förflutna.
//   4. dependency  — beroendeartikel vars tillgänglighet inte kvitterats före
//                    huvuduppgiften.
//
// Trösklarna är konfigurerbara per tenant via `tenants.settings.timeWarnings`;
// saknas värden används DEFAULT_TIME_WARNING_THRESHOLDS.

export type TimeWarningCategory = "overlap" | "travel" | "leadtime" | "dependency";
export type TimeWarningSeverity = "error" | "warning" | "info";

export interface TimeWarning {
  code: string;
  category: TimeWarningCategory;
  severity: TimeWarningSeverity;
  message: string;
  relatedTaskId?: string;
}

export interface TimeWarningThresholds {
  // Minsta restid (minuter) mellan slutet på en uppgift och starten på nästa
  // för samma resurs. Mindre lucka ⇒ travel-varning.
  minTravelMinutes: number;
  // Tillåten överlapp (minuter) innan en overlap-varning utlöses. 0 = ingen
  // tolerans.
  overlapGraceMinutes: number;
  // Marginal (dagar) som läggs till ledtiden när beställningsdatumet beräknas;
  // höjer känsligheten för leadtime-varningar.
  leadTimeBufferDays: number;
}

export const DEFAULT_TIME_WARNING_THRESHOLDS: TimeWarningThresholds = {
  minTravelMinutes: 15,
  overlapGraceMinutes: 0,
  leadTimeBufferDays: 0,
};

function numOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Läs ut tröskelvärden ur tenantens `settings`-jsonb. Förväntat format:
 *   { timeWarnings: { minTravelMinutes, overlapGraceMinutes, leadTimeBufferDays } }
 * Okända/ogiltiga värden faller tillbaka till DEFAULT_TIME_WARNING_THRESHOLDS.
 */
export function resolveTimeWarningThresholds(
  tenantSettings: unknown,
): TimeWarningThresholds {
  const tw =
    tenantSettings && typeof tenantSettings === "object"
      ? (tenantSettings as Record<string, any>).timeWarnings
      : undefined;
  return {
    minTravelMinutes: numOr(tw?.minTravelMinutes, DEFAULT_TIME_WARNING_THRESHOLDS.minTravelMinutes),
    overlapGraceMinutes: numOr(tw?.overlapGraceMinutes, DEFAULT_TIME_WARNING_THRESHOLDS.overlapGraceMinutes),
    leadTimeBufferDays: numOr(tw?.leadTimeBufferDays, DEFAULT_TIME_WARNING_THRESHOLDS.leadTimeBufferDays),
  };
}

export interface ScheduledTask {
  id: string;
  title?: string | null;
  scheduledDate?: Date | string | null;
  estimatedDuration?: number | null; // minuter
  resourceId?: string | null;
}

export interface DependencyTask {
  id: string;
  title?: string | null;
  requiresAcknowledgment?: boolean | null;
  dependencyAcknowledgedAt?: Date | string | null;
  dependencyCriticality?: string | null;
}

export interface LeadTimeItem {
  articleName: string;
  leadTimeDays?: number | null;
  deliveryDate?: Date | string | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;

/** Sortera + gruppera uppgifter per resurs (endast de med resurs, datum och längd). */
function bucketByResource(tasks: ScheduledTask[]): Map<string, Array<{ task: ScheduledTask; start: Date; end: Date }>> {
  const buckets = new Map<string, Array<{ task: ScheduledTask; start: Date; end: Date }>>();
  for (const task of tasks) {
    if (!task.resourceId) continue;
    const start = toDate(task.scheduledDate);
    if (!start) continue;
    const duration = task.estimatedDuration && task.estimatedDuration > 0 ? task.estimatedDuration : 0;
    const end = new Date(start.getTime() + duration * MS_PER_MIN);
    const arr = buckets.get(task.resourceId) ?? [];
    arr.push({ task, start, end });
    buckets.set(task.resourceId, arr);
  }
  for (const arr of buckets.values()) {
    arr.sort((a, b) => a.start.getTime() - b.start.getTime());
  }
  return buckets;
}

/** 1) Överlappande tidsfönster för samma resurs. */
export function computeOverlapWarnings(
  tasks: ScheduledTask[],
  thresholds: TimeWarningThresholds = DEFAULT_TIME_WARNING_THRESHOLDS,
): TimeWarning[] {
  const warnings: TimeWarning[] = [];
  const graceMs = thresholds.overlapGraceMinutes * MS_PER_MIN;
  for (const arr of bucketByResource(tasks).values()) {
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1];
      const cur = arr[i];
      const overlapMs = prev.end.getTime() - cur.start.getTime();
      if (overlapMs > graceMs) {
        const overlapMin = Math.round(overlapMs / MS_PER_MIN);
        warnings.push({
          code: "OVERLAPPING_WINDOW",
          category: "overlap",
          severity: "warning",
          message: `Överlappande tidsfönster: "${cur.task.title ?? cur.task.id}" startar ${overlapMin} min innan "${prev.task.title ?? prev.task.id}" är klar.`,
          relatedTaskId: cur.task.id,
        });
      }
    }
  }
  return warnings;
}

/** 2) Otillräcklig res-/föregående-jobb-tid mellan på varandra följande uppgifter. */
export function computeTravelGapWarnings(
  tasks: ScheduledTask[],
  thresholds: TimeWarningThresholds = DEFAULT_TIME_WARNING_THRESHOLDS,
): TimeWarning[] {
  const warnings: TimeWarning[] = [];
  for (const arr of bucketByResource(tasks).values()) {
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1];
      const cur = arr[i];
      const gapMin = (cur.start.getTime() - prev.end.getTime()) / MS_PER_MIN;
      // Endast positiva luckor (negativa = overlap, hanteras separat).
      if (gapMin >= 0 && gapMin < thresholds.minTravelMinutes) {
        warnings.push({
          code: "INSUFFICIENT_TRAVEL_TIME",
          category: "travel",
          severity: "warning",
          message: `Otillräcklig res-/marginaltid: endast ${Math.round(gapMin)} min mellan "${prev.task.title ?? prev.task.id}" och "${cur.task.title ?? cur.task.id}" (kräver ${thresholds.minTravelMinutes} min).`,
          relatedTaskId: cur.task.id,
        });
      }
    }
  }
  return warnings;
}

/** 3) Leveranstid (ledtid) som passerar leveransdatumet. */
export function computeLeadTimeWarnings(
  items: LeadTimeItem[],
  thresholds: TimeWarningThresholds = DEFAULT_TIME_WARNING_THRESHOLDS,
  now: Date = new Date(),
): TimeWarning[] {
  const warnings: TimeWarning[] = [];
  for (const item of items) {
    const leadDays = item.leadTimeDays && item.leadTimeDays > 0 ? item.leadTimeDays : 0;
    if (leadDays <= 0) continue;
    const delivery = toDate(item.deliveryDate);
    if (!delivery) continue;
    const orderBy = new Date(
      delivery.getTime() - (leadDays + thresholds.leadTimeBufferDays) * MS_PER_DAY,
    );
    if (orderBy.getTime() < now.getTime()) {
      warnings.push({
        code: "LEADTIME_PAST_DELIVERY",
        category: "leadtime",
        severity: "warning",
        message: `Ledtid passerar leveransdatum: "${item.articleName}" har ${leadDays} dagars ledtid; beställning måste vara lagd senast ${orderBy.toLocaleDateString("sv-SE")} men det datumet har redan passerat.`,
      });
    }
  }
  return warnings;
}

/** 4) Beroendeartikel som inte kvitterats före huvuduppgiften. */
export function computeUnacknowledgedDependencyWarnings(
  dependencies: DependencyTask[],
): TimeWarning[] {
  const warnings: TimeWarning[] = [];
  for (const dep of dependencies) {
    if (!dep.requiresAcknowledgment) continue;
    if (toDate(dep.dependencyAcknowledgedAt)) continue; // redan kvitterad
    const critical = (dep.dependencyCriticality ?? "critical") === "critical";
    warnings.push({
      code: "UNACKNOWLEDGED_DEPENDENCY",
      category: "dependency",
      severity: critical ? "error" : "warning",
      message: critical
        ? `Kritisk beroendeuppgift "${dep.title ?? dep.id}" är inte kvitterad — huvuduppgiften bör inte utföras förrän tillgängligheten bekräftats.`
        : `Beroendeuppgift "${dep.title ?? dep.id}" är inte kvitterad (kan strykas vid behov).`,
      relatedTaskId: dep.id,
    });
  }
  return warnings;
}

/** Kör samtliga schemaläggningsvarningar (overlap + travel + dependency) över en uppgiftslista. */
export function computeScheduleWarnings(
  tasks: Array<ScheduledTask & DependencyTask>,
  thresholds: TimeWarningThresholds = DEFAULT_TIME_WARNING_THRESHOLDS,
): TimeWarning[] {
  return [
    ...computeOverlapWarnings(tasks, thresholds),
    ...computeTravelGapWarnings(tasks, thresholds),
    ...computeUnacknowledgedDependencyWarnings(tasks),
  ];
}
