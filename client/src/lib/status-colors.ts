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

export function getObjectStatusBadge(status: string | null | undefined): string {
  if (!status) return objectStatusBadge.inactive;
  return objectStatusBadge[status] ?? objectStatusBadge.inactive;
}

export function getWorkOrderStatusBadge(status: string | null | undefined): string {
  if (!status) return workOrderStatusBadge.unassigned;
  return workOrderStatusBadge[status] ?? workOrderStatusBadge.unassigned;
}
