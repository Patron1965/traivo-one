import { cn } from "@/lib/utils";

interface RouteClusterBadgeProps {
  name: string;
  period?: string | null;
  status?: string | null;
  onClick?: () => void;
  className?: string;
}

const STATUS_CLASS: Record<string, string> = {
  locked: "border-chart-1/40 bg-chart-1/15 text-chart-1",
  confirmed: "border-chart-2/40 bg-chart-2/15 text-chart-2",
  active: "border-chart-4/30 bg-chart-4/10 text-chart-4",
};

export function RouteClusterBadge({
  name,
  period,
  status,
  onClick,
  className,
}: RouteClusterBadgeProps) {
  const statusCls = STATUS_CLASS[status ?? "active"] ?? STATUS_CLASS.active;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[11px] font-medium transition-opacity",
        statusCls,
        onClick && "cursor-pointer hover:opacity-80",
        className,
      )}
      onClick={onClick}
      data-testid="badge-route-cluster"
      title={name + (period ? ` · ${period}` : "")}
    >
      <span className="truncate max-w-[120px]">{name}</span>
      {period && <span className="shrink-0 opacity-70">· {period}</span>}
    </span>
  );
}
