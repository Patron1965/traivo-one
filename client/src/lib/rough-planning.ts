/**
 * Grovplanering — delade klient-typer, status-meta och period-hjälpare (Task #921).
 * Speglar svaret från GET /api/rough-planning/grid (server/grovplanering-grid.ts).
 */
import {
  startOfISOWeek,
  endOfISOWeek,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  getISOWeek,
  getISOWeekYear,
} from "date-fns";

export type RoughStatus =
  | "otilldelad"
  | "tilldelad"
  | "delvis"
  | "utford"
  | "avviker";

export type GroupBy = "objekt" | "kund" | "orderkoncept" | "ingen";
export type PeriodMode = "manad" | "vecka" | "intervall";

export interface GridKpis {
  productionMinutes: number;
  value: number; // öre
  cost: number; // öre
  taskCount: number;
  objectCount: number;
}

export interface GridTaskRow {
  id: string;
  status: RoughStatus;
  customerId: string | null;
  customerName: string | null;
  objectId: string | null;
  objectName: string | null;
  title: string | null;
  taskType: string;
  taskTypeLabel: string;
  executionCode: string | null;
  desiredDeliveryStart: string | null;
  desiredDeliveryEnd: string | null;
  productionMinutes: number;
  teamId: string | null;
  teamName: string | null;
  teamColor: string | null;
  roughPlannedWeek: string | null;
  lastServiceDate: string | null;
  value: number; // öre
  cost: number; // öre
  source: string | null; // creation_method-nyckel (manual/import/external_report/performer/automatic)
  stopClusterId: string | null;
  stopClusterName: string | null;
  routeClusterId: string | null;
  routeClusterName: string | null;
}

export interface GridGroup {
  key: string;
  label: string;
  groupType: GroupBy;
  objectCount: number;
  earliestDesired: string | null;
  summary: GridKpis;
  tasks: GridTaskRow[];
}

export interface GridResponse {
  summary: GridKpis;
  groups: GridGroup[];
  pagination: { offset: number; limit: number; total: number };
  grouping: GroupBy;
  truncated: boolean;
}

// Uppgiftskälla (work_orders.creation_method) → svensk etikett. Visar VARIFRÅN en
// uppgift kommer: manuellt inlagd, importerad, från felanmälan, skapad av utförare,
// eller automatiskt av systemet (t.ex. orderkoncept-expansion).
export const CREATION_SOURCE_LABELS: Record<string, string> = {
  manual: "Manuell",
  import: "Import",
  external_report: "Felanmälan",
  performer: "Utförare",
  automatic: "Automatisk",
};

export function creationSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return CREATION_SOURCE_LABELS[source] ?? source;
}

// Legend-ordning (matchar referensbilden): Utförd, Tilldelad, Otilldelad, Delvis, Avviker.
export const ROUGH_STATUS_ORDER: RoughStatus[] = [
  "utford",
  "tilldelad",
  "otilldelad",
  "delvis",
  "avviker",
];

export const ROUGH_STATUS_META: Record<
  RoughStatus,
  { label: string; dot: string; badge: string }
> = {
  utford: {
    label: "Utförd",
    dot: "bg-chart-2",
    badge: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  },
  tilldelad: {
    label: "Tilldelad",
    dot: "bg-warning",
    badge: "bg-warning/15 text-warning border border-warning/30",
  },
  delvis: {
    label: "Delvis utförd",
    dot: "bg-chart-3",
    badge: "bg-chart-3/15 text-chart-3 border border-chart-3/30",
  },
  avviker: {
    label: "Avviker",
    dot: "bg-destructive",
    badge: "bg-destructive/15 text-destructive border border-destructive/30",
  },
  otilldelad: {
    label: "Otilldelad",
    dot: "border-2 border-muted-foreground/50 bg-transparent",
    badge: "bg-muted text-muted-foreground border border-border",
  },
};

// ---------------------------------------------------------------------------
// Format-hjälpare
// ---------------------------------------------------------------------------
export function formatHours(minutes: number | null | undefined): string {
  const m = minutes ?? 0;
  return `${Math.round(m / 60).toLocaleString("sv-SE")} h`;
}

export function formatCount(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("sv-SE");
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "–";
  return d.toLocaleDateString("sv-SE");
}

// "YYYY-Www" (versalt W) — formatet bulk-rough-plan kräver.
export function isoWeekString(date: Date): string {
  return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, "0")}`;
}

// "2026 - V26" för stepper-etiketter.
export function weekLabel(date: Date): string {
  return `${getISOWeekYear(date)} - V${String(getISOWeek(date)).padStart(2, "0")}`;
}

export function monthLabel(date: Date): string {
  return date.toLocaleDateString("sv-SE", { year: "numeric", month: "long" });
}

// "2026-W26" → "V26" för veckochip i tabellen.
export function weekChip(week: string | null | undefined): string | null {
  if (!week) return null;
  const m = week.match(/-W(\d{2})$/);
  return m ? `V${m[1]}` : week;
}

// Löser ut [from, to] (ISO) från periodläget. Tomt = ingen tidsbegränsning.
export function resolvePeriodRange(
  mode: PeriodMode,
  anchor: Date,
  rangeFrom: string,
  rangeTo: string,
): { from?: string; to?: string } {
  if (mode === "vecka") {
    return {
      from: startOfISOWeek(anchor).toISOString(),
      to: endOfISOWeek(anchor).toISOString(),
    };
  }
  if (mode === "manad") {
    return {
      from: startOfMonth(anchor).toISOString(),
      to: endOfMonth(anchor).toISOString(),
    };
  }
  const from = rangeFrom ? startOfDay(new Date(rangeFrom)).toISOString() : undefined;
  const to = rangeTo ? endOfDay(new Date(rangeTo)).toISOString() : undefined;
  return { from, to };
}
