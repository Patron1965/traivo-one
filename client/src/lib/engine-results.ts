/**
 * Tids- & geografimotorns resultat — delade klient-typer + format-hjälpare
 * (Task #1039). Speglar svaret från GET /api/rough-planning/engine-results
 * (server/services/engine-results.ts).
 */
import { getISOWeek, getISOWeekYear } from "date-fns";

export type SlotType = "onskad" | "kravd" | "fordelaktig";

export type PlannerDecision = "accepterad" | "avvisad";

export interface EngineSlotCandidate {
  windowStart: string;
  windowEnd: string;
  slotType: SlotType;
  status: "vald" | "forslag";
  rank: number;
  score: number | null;
  reason: string | null;
}

export interface EngineTaskResult {
  assignmentId: string;
  title: string | null;
  objectId: string | null;
  objectName: string | null;
  customerId: string | null;
  customerName: string | null;
  address: string | null;
  executionCode: string;
  valueOre: number;
  costOre: number;
  durationMinutes: number;
  groupKey: string | null;
  chosen: EngineSlotCandidate | null;
  alternative: EngineSlotCandidate | null;
  candidates: EngineSlotCandidate[];
  decision: PlannerDecision | null;
  decidedAt: string | null;
}

export interface EngineClumpResult {
  groupKey: string;
  executionCode: string;
  groupingBasis: "address" | "geo" | "standalone";
  address: string | null;
  memberCount: number;
  summedValueOre: number;
  summedCostOre: number;
  summedDurationMinutes: number;
  windowStart: string;
  windowEnd: string;
  slotType: SlotType;
  members: EngineTaskResult[];
  decision: PlannerDecision | null;
  decidedAt: string | null;
}

export interface EngineResultsSummary {
  taskCount: number;
  clumpCount: number;
  standaloneCount: number;
  valueOre: number;
  costOre: number;
  durationMinutes: number;
}

export interface EngineResultsResponse {
  hasResults: boolean;
  lastRunAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  summary: EngineResultsSummary;
  clumps: EngineClumpResult[];
  standalone: EngineTaskResult[];
}

// ---------------------------------------------------------------------------
// Slot-typ-meta (förklaring + badge-tokens, tema-tokens only)
// ---------------------------------------------------------------------------
export const SLOT_TYPE_META: Record<
  SlotType,
  { label: string; description: string; badge: string }
> = {
  onskad: {
    label: "Kundönskad",
    description: "Kundens önskade tid — väger tyngst.",
    badge: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  },
  kravd: {
    label: "Krävd",
    description: "Hård tidsregel (krav) som måste hållas.",
    badge: "bg-warning/15 text-warning border border-warning/30",
  },
  fordelaktig: {
    label: "Fördelaktig",
    description: "Mjuk tidsregel — fördelaktig men inte tvingande.",
    badge: "bg-chart-4/15 text-chart-4 border border-chart-4/30",
  },
};

// ---------------------------------------------------------------------------
// Beslut-meta (acceptera/avvisa) — tema-tokens only
// ---------------------------------------------------------------------------
export const DECISION_META: Record<
  PlannerDecision,
  { label: string; badge: string }
> = {
  accepterad: {
    label: "Accepterad",
    badge: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  },
  avvisad: {
    label: "Avvisad",
    badge: "bg-destructive/15 text-destructive border border-destructive/30",
  },
};

// ---------------------------------------------------------------------------
// Format-hjälpare
// ---------------------------------------------------------------------------

const WEEKDAYS_SHORT = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"];

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

function weekdayShort(d: Date): string {
  return WEEKDAYS_SHORT[d.getDay()];
}

/** ISO-veckonummer som "v.30". */
export function weekNumberLabel(iso: string | null | undefined): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  return `v.${getISOWeek(d)}`;
}

/**
 * Föreslagen tid som "v.30 tors" eller, för spann över flera dagar i samma vecka,
 * "v.30 tors+fre". Spann över flera veckor: "v.30 tors–v.31 mån".
 */
export function formatSuggestedTime(
  startIso: string | null | undefined,
  endIso?: string | null | undefined,
): string {
  const start = parseDate(startIso);
  if (!start) return "–";
  const end = parseDate(endIso) ?? start;

  const startWeek = getISOWeek(start);
  const endWeek = getISOWeek(end);
  const sameDay = start.toDateString() === end.toDateString();

  if (sameDay || (startWeek === endWeek && weekdayShort(start) === weekdayShort(end))) {
    return `v.${startWeek} ${weekdayShort(start)}`;
  }

  if (startWeek === endWeek) {
    // Samma vecka, olika dagar → lista veckodagarna i spannet (cap 3 etiketter).
    const days: string[] = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    const last = new Date(end);
    last.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= last.getTime() && days.length < 4) {
      days.push(weekdayShort(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return `v.${startWeek} ${days.join("+")}`;
  }

  return `v.${startWeek} ${weekdayShort(start)}–v.${endWeek} ${weekdayShort(end)}`;
}

/** Flexibilitet/deadline ur näst bästa förslag, t.ex. "v.35". Saknas → "–". */
export function formatFlexibility(task: EngineTaskResult): string {
  const alt = task.alternative;
  if (!alt) return "–";
  return weekNumberLabel(alt.windowStart) ?? "–";
}

export function formatHoursFromMinutes(minutes: number | null | undefined): string {
  const m = minutes ?? 0;
  const hours = m / 60;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded.toLocaleString("sv-SE")} h`;
}

export function formatCount(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("sv-SE");
}

export function formatDateTimeShort(iso: string | null | undefined): string {
  const d = parseDate(iso);
  if (!d) return "–";
  return d.toLocaleString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const GROUPING_BASIS_LABEL: Record<EngineClumpResult["groupingBasis"], string> = {
  address: "Samma adress",
  geo: "Geografiskt närliggande",
  standalone: "Fristående",
};

// ---------------------------------------------------------------------------
// Horisont-val (run control)
// ---------------------------------------------------------------------------
export interface HorizonOption {
  key: string;
  label: string;
  days: number;
}

export const HORIZON_OPTIONS: HorizonOption[] = [
  { key: "2w", label: "2 veckor", days: 14 },
  { key: "1m", label: "1 månad", days: 30 },
  { key: "6w", label: "6 veckor", days: 42 },
  { key: "3m", label: "3 månader", days: 90 },
];

export const DEFAULT_HORIZON_KEY = "1m";

/** ISO-vecka för en starttidpunkt (för "kör för specifik period"-ankare). */
export function isoWeekStringFromDate(date: Date): string {
  return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, "0")}`;
}
