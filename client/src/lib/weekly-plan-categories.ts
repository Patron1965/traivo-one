/**
 * Veckoplane-vy (168h per team) — stabil mappning av `time_category` till
 * tema-tokens och svenska etiketter. Alla klassträngar är LITERAL (ingen
 * dynamisk konkatenering) så att Tailwinds JIT plockar upp dem.
 *
 * Endast tema-tokens används (chart-*, warning, primary, muted) — inga
 * råa färger (bg-red-500/bg-amber-* etc).
 */

export type TimeCategoryKey =
  | "production"
  | "travel_between_jobs"
  | "travel_commute"
  | "break_meal"
  | "personal_time"
  | "rest_night"
  | "rest_weekend"
  | "overtime";

export interface TimeCategoryStyle {
  /** Svensk etikett. */
  label: string;
  /** Klasser för själva tidsblocket (bakgrund + vänsterkant + text). */
  block: string;
  /** Liten färgprick för legend/summering. */
  dot: string;
  /** Fyllnadsfärg för 168h-staplar (solid token). */
  bar: string;
}

export const TIME_CATEGORY_STYLES: Record<TimeCategoryKey, TimeCategoryStyle> = {
  production: {
    label: "Produktion",
    block: "bg-chart-2/15 border-l-4 border-l-chart-2 text-chart-2",
    dot: "bg-chart-2",
    bar: "bg-chart-2",
  },
  travel_between_jobs: {
    label: "Restid",
    block: "bg-chart-3/15 border-l-4 border-l-chart-3 text-chart-3",
    dot: "bg-chart-3",
    bar: "bg-chart-3",
  },
  travel_commute: {
    label: "Inställelse/återresa",
    block: "bg-chart-4/15 border-l-4 border-l-chart-4 text-chart-4",
    dot: "bg-chart-4",
    bar: "bg-chart-4",
  },
  break_meal: {
    label: "Matrast",
    block: "bg-chart-1/15 border-l-4 border-l-chart-1 text-chart-1",
    dot: "bg-chart-1",
    bar: "bg-chart-1",
  },
  personal_time: {
    label: "Egentid",
    block: "bg-muted border-l-4 border-l-muted-foreground/40 text-muted-foreground",
    dot: "bg-muted-foreground/60",
    bar: "bg-muted-foreground/50",
  },
  rest_night: {
    label: "Nattvila",
    block: "bg-chart-5/15 border-l-4 border-l-chart-5 text-chart-5",
    dot: "bg-chart-5",
    bar: "bg-chart-5",
  },
  rest_weekend: {
    label: "Helgvila",
    block: "bg-primary/15 border-l-4 border-l-primary text-primary",
    dot: "bg-primary",
    bar: "bg-primary",
  },
  overtime: {
    label: "Övertid",
    block: "bg-warning/15 border-l-4 border-l-warning text-warning",
    dot: "bg-warning",
    bar: "bg-warning",
  },
};

const FALLBACK_STYLE: TimeCategoryStyle = {
  label: "Övrigt",
  block: "bg-muted border-l-4 border-l-border text-muted-foreground",
  dot: "bg-muted-foreground/60",
  bar: "bg-muted-foreground/50",
};

export function getTimeCategoryStyle(category: string | null | undefined): TimeCategoryStyle {
  if (!category) return FALLBACK_STYLE;
  return TIME_CATEGORY_STYLES[category as TimeCategoryKey] ?? FALLBACK_STYLE;
}

/** Ordnad lista för legend och summeringsstaplar. */
export const TIME_CATEGORY_ORDER: TimeCategoryKey[] = [
  "production",
  "travel_between_jobs",
  "travel_commute",
  "break_meal",
  "personal_time",
  "rest_night",
  "rest_weekend",
  "overtime",
];

export type WarningSeverity = "error" | "warning" | "info" | "ok";

export const WARNING_SEVERITY_STYLES: Record<WarningSeverity, { label: string; className: string; dot: string }> = {
  error: { label: "Fel", className: "border-destructive/40 bg-destructive/10 text-destructive", dot: "bg-destructive" },
  warning: { label: "Varning", className: "border-warning/40 bg-warning/10 text-warning", dot: "bg-warning" },
  info: { label: "Info", className: "border-chart-1/40 bg-chart-1/10 text-chart-1", dot: "bg-chart-1" },
  ok: { label: "OK", className: "border-chart-2/40 bg-chart-2/10 text-chart-2", dot: "bg-chart-2" },
};

export function getWarningSeverityStyle(severity: string | null | undefined) {
  return WARNING_SEVERITY_STYLES[(severity as WarningSeverity)] ?? WARNING_SEVERITY_STYLES.warning;
}
