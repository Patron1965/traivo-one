import { cn } from "@/lib/utils";

interface StopClusterBadgeProps {
  name: string;
  memberCount?: number | null;
  status?: string | null;
  onClick?: () => void;
  className?: string;
}

const STATUS_CLASS: Record<string, string> = {
  locked: "border-chart-3/40 bg-chart-3/15 text-chart-3",
  confirmed: "border-chart-5/40 bg-chart-5/15 text-chart-5",
  active: "border-muted bg-muted/50 text-muted-foreground",
  auto: "border-muted bg-muted/50 text-muted-foreground",
};

export function StopClusterBadge({
  name,
  memberCount,
  status,
  onClick,
  className,
}: StopClusterBadgeProps) {
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
      data-testid="badge-stop-cluster"
      title={name + (memberCount != null ? ` · ${memberCount} uppg.` : "")}
    >
      <span className="truncate max-w-[120px]">{name}</span>
      {memberCount != null && (
        <span className="shrink-0 opacity-70">· {memberCount} uppg.</span>
      )}
    </span>
  );
}
