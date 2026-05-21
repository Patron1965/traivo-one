export const ROUTE_SEGMENT_COLORS = {
  start: "#22c55e",
  end: "#ef4444",
  middle: "#3b82f6",
} as const;

export const RESOURCE_STATUS_COLORS: Record<string, string> = {
  on_job: "#22c55e",
  traveling: "#3b82f6",
  break: "#f59e0b",
  idle: "#6b7280",
};

export const ACCESS_TYPE_COLORS: Record<string, string> = {
  open: "#22c55e",
  code: "#3b82f6",
  key: "#f97316",
  meeting: "#a855f7",
};

export function getAccessColor(accessType: string | null | undefined): string {
  if (!accessType) return "#6b7280";
  return ACCESS_TYPE_COLORS[accessType] ?? "#6b7280";
}

export function getResourceStatusColor(status: string | null | undefined, isStale = false): string {
  if (isStale) return "#6b7280";
  if (!status) return "#6b7280";
  return RESOURCE_STATUS_COLORS[status] ?? "#6b7280";
}

export function getRouteSegmentColor(index: number, total: number): string {
  if (index === 0) return ROUTE_SEGMENT_COLORS.start;
  if (index === total - 1) return ROUTE_SEGMENT_COLORS.end;
  return ROUTE_SEGMENT_COLORS.middle;
}

export const CLUSTER_COLOR_PALETTE = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
] as const;

export function getClusterColor(index: number): string {
  return CLUSTER_COLOR_PALETTE[index % CLUSTER_COLOR_PALETTE.length];
}
