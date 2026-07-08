export const objectStatusBadge: Record<string, string> = {
  active: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  inactive: "bg-muted text-muted-foreground border border-border",
  pending: "bg-chart-3/15 text-chart-3 border border-chart-3/30",
};

export const workOrderStatusBadge: Record<string, string> = {
  unassigned: "bg-muted text-muted-foreground border border-border",
  scheduled: "bg-chart-1/15 text-chart-1 border border-chart-1/30",
  in_progress: "bg-chart-3/15 text-chart-3 border border-chart-3/30",
  completed: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  cancelled: "bg-destructive/15 text-destructive border border-destructive/30",
};

export const customerStatusBadge: Record<string, string> = {
  active: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  inactive: "bg-muted text-muted-foreground border border-border",
  prospect: "bg-chart-1/15 text-chart-1 border border-chart-1/30",
  archived: "bg-muted text-muted-foreground border border-border",
};

export const deliveryStatusBadge: Record<string, string> = {
  pending: "bg-chart-3/15 text-chart-3 border border-chart-3/30",
  in_transit: "bg-chart-1/15 text-chart-1 border border-chart-1/30",
  delivered: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  failed: "bg-destructive/15 text-destructive border border-destructive/30",
  cancelled: "bg-muted text-muted-foreground border border-border",
};

export const invoiceStatusBadge: Record<string, string> = {
  pending: "bg-chart-3/15 text-chart-3 border border-chart-3/30",
  processing: "bg-chart-1/15 text-chart-1 border border-chart-1/30",
  exported: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  failed: "bg-destructive/15 text-destructive border border-destructive/30",
  credited: "bg-chart-5/15 text-chart-5 border border-chart-5/30",
};

export const priorityBadgeClasses: Record<string, string> = {
  urgent: "bg-background text-destructive border border-destructive/60 dark:border-destructive/70",
  high: "bg-background text-warning border border-warning/60 dark:border-warning/70",
  normal: "bg-background text-chart-1 border border-chart-1/50 dark:border-chart-1/70",
  low: "bg-muted text-muted-foreground border border-border",
};

export const priorityDotColors: Record<string, string> = {
  urgent: "bg-destructive",
  high: "bg-warning",
  normal: "bg-chart-1",
  low: "bg-muted-foreground/60",
};

export const priorityLabels: Record<string, string> = {
  urgent: "Akut",
  high: "Hög",
  normal: "Normal",
  low: "Låg",
};

export const hierarchyLevelBadge: Record<string, string> = {
  koncern: "bg-chart-5/15 text-chart-5 border border-chart-5/30",
  brf: "bg-chart-1/15 text-chart-1 border border-chart-1/30",
  fastighet: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  rum: "bg-chart-3/15 text-chart-3 border border-chart-3/30",
  karl: "bg-chart-4/15 text-chart-4 border border-chart-4/30",
  objekt: "bg-muted text-muted-foreground border border-border",
};

export function getObjectStatusBadge(status: string | null | undefined): string {
  if (!status) return objectStatusBadge.inactive;
  return objectStatusBadge[status] ?? objectStatusBadge.inactive;
}

export function getWorkOrderStatusBadge(status: string | null | undefined): string {
  if (!status) return workOrderStatusBadge.unassigned;
  return workOrderStatusBadge[status] ?? workOrderStatusBadge.unassigned;
}

// Execution-status (orderns utförande-tillstånd) — ENDA källan för etikett + färg
// i hela UI:t (badge, tracker, WO-detalj, AssignmentsPage). DB-enumen (se
// EXECUTION_STATUSES i shared/schema.ts) byter INTE namn — vi mappar bara svenska
// 8-stegs-etiketter och tema-tokens här (användargodkänd lösning 2026-06-12).
// `step` är livscykelns ordningsnummer (0 = avvikande/sidospår).
// Färgspråk: Orderlagd = grön kontur (ej startad), planerad = warning,
// pågående/avslutad/kontrollerad = chart-4 (neutralt slutfört), fakturerad = muted,
// avviker = destructive.
// `tone` är färgfamiljen (tema-token) som ALLA execution-status-ytor delar —
// badge härleder sin klass av den, och trackern (ExecutionStatusTracker) bygger
// sina fyllda/outline-varianter ur samma tone. Så slipper vi att t.ex. "Avslutad"
// blir grön på ett ställe och teal på ett annat.
export type ExecutionStatusTone = "chart-2" | "warning" | "chart-4" | "muted" | "destructive";

export interface ExecutionStatusMeta {
  step: number;
  label: string;
  tone: ExecutionStatusTone;
  badge: string;
}

export const executionStatusMeta: Record<string, ExecutionStatusMeta> = {
  not_planned: { step: 1, label: "Orderlagd", tone: "chart-2", badge: "bg-background text-chart-2 border-2 border-chart-2/60" },
  planned_rough: { step: 2, label: "Grovplanerad", tone: "warning", badge: "bg-warning/15 text-warning border border-warning/30" },
  planned_fine: { step: 3, label: "Finplanerad", tone: "warning", badge: "bg-warning/15 text-warning border border-warning/30" },
  dispatched: { step: 3, label: "Skickad", tone: "warning", badge: "bg-warning/15 text-warning border border-warning/30" },
  on_way: { step: 4, label: "På väg", tone: "chart-4", badge: "bg-chart-4/15 text-chart-4 border border-chart-4/30" },
  on_site: { step: 5, label: "På plats", tone: "chart-4", badge: "bg-chart-4/15 text-chart-4 border border-chart-4/30" },
  completed: { step: 6, label: "Avslutad", tone: "chart-4", badge: "bg-chart-4/15 text-chart-4 border border-chart-4/30" },
  inspected: { step: 7, label: "Kontrollerad", tone: "chart-4", badge: "bg-chart-4/15 text-chart-4 border border-chart-4/30" },
  invoiced: { step: 8, label: "Fakturerad", tone: "muted", badge: "bg-muted text-muted-foreground border border-border" },
  impossible: { step: 0, label: "Avviker", tone: "destructive", badge: "bg-destructive/15 text-destructive border border-destructive/30" },
  avviker: { step: 0, label: "Avviker", tone: "destructive", badge: "bg-destructive/15 text-destructive border border-destructive/30" },
};

// Back-compat: behåll det platta badge-objektet (härlett ur meta) för befintliga importer.
export const executionStatusBadge: Record<string, string> = Object.fromEntries(
  Object.entries(executionStatusMeta).map(([key, meta]) => [key, meta.badge]),
);

export function getExecutionStatusBadge(status: string | null | undefined): string {
  if (!status) return executionStatusMeta.not_planned.badge;
  return executionStatusMeta[status]?.badge ?? executionStatusMeta.not_planned.badge;
}

export function getExecutionStatusLabel(status: string | null | undefined): string {
  if (!status) return executionStatusMeta.not_planned.label;
  return executionStatusMeta[status]?.label ?? status;
}

export function getExecutionStatusTone(status: string | null | undefined): ExecutionStatusTone {
  if (!status) return executionStatusMeta.not_planned.tone;
  return executionStatusMeta[status]?.tone ?? "muted";
}

// Kund-rapport-status (issue reports/portal field reports).
export const customerReportStatusBadge: Record<string, { className: string; label: string }> = {
  new: { className: "bg-chart-1 text-white", label: "Ny" },
  reviewed: { className: "bg-chart-4 text-white", label: "Granskas" },
  resolved: { className: "bg-chart-2 text-white", label: "Löst" },
  rejected: { className: "bg-muted text-muted-foreground", label: "Avvisad" },
};

export function getCustomerReportStatusBadge(status: string): { className: string; label: string } {
  return customerReportStatusBadge[status] ?? { className: "bg-muted text-muted-foreground", label: status };
}

// Inspection-status (data-quality / verification).
export const inspectionStatusBadge: Record<string, string> = {
  ok: "bg-chart-2/15 text-chart-2 border border-chart-2/30",
  warning: "bg-warning/15 text-warning border border-warning/30",
  error: "bg-destructive/15 text-destructive border border-destructive/30",
};

export function getInspectionStatusBadge(status: string | null | undefined): string {
  if (!status) return inspectionStatusBadge.ok;
  return inspectionStatusBadge[status] ?? inspectionStatusBadge.ok;
}

// Task #1205 (88): persistent per-resource-day overbooking (bokad tid > kapacitet).
// Överbokning = varning (SLA-risk), inte blockerande → warning-token. Aldrig bg-red-*.
export function getOverbookingWarning(
  bookedHours: number,
  capacityHours: number,
): { isOverbooked: boolean; overBy: number; textClass: string; cellClass: string; badgeClass: string } {
  const overBy = Math.round((bookedHours - capacityHours) * 10) / 10;
  const isOverbooked = overBy > 0.05;
  return {
    isOverbooked,
    overBy: Math.max(0, overBy),
    textClass: "text-warning font-semibold",
    cellClass: "bg-warning/10 dark:bg-warning/15 ring-1 ring-inset ring-warning/40",
    badgeClass: "bg-warning/15 text-warning border border-warning/30",
  };
}
