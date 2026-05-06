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
