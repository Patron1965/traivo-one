import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { getExecutionStatusLabel, getExecutionStatusTone, type ExecutionStatusTone } from "@/lib/status-colors";
import {
  Circle,
  Calendar,
  CalendarCheck,
  Truck,
  MapPin,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  LucideIcon,
} from "lucide-react";

export const EXECUTION_STATUS_ORDER = [
  "not_planned",
  "planned_rough",
  "planned_fine",
  "on_way",
  "on_site",
  "completed",
  "inspected",
  "invoiced",
] as const;

// Etiketter härleds ur den enda källan (status-colors.executionStatusMeta) så
// trackern aldrig motsäger badge/WO-detalj.
export const EXECUTION_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  EXECUTION_STATUS_ORDER.map((s) => [s, getExecutionStatusLabel(s)]),
);

const STATUS_ICONS: Record<string, LucideIcon> = {
  not_planned: Circle,
  planned_rough: Calendar,
  planned_fine: CalendarCheck,
  on_way: Truck,
  on_site: MapPin,
  completed: CheckCircle2,
  inspected: ClipboardCheck,
  invoiced: FileText,
};

// Färgerna härleds ur den enda källan (status-colors.executionStatusMeta.tone) så
// trackern aldrig motsäger badge/WO-detalj. Varje tone får sin fyllda tracker-variant här.
const TONE_COLORS: Record<ExecutionStatusTone, { bg: string; text: string; border: string }> = {
  "chart-2": { bg: "bg-chart-2/10 dark:bg-chart-2/15", text: "text-chart-2", border: "border-chart-2/30 dark:border-chart-2/70" },
  warning: { bg: "bg-warning/10 dark:bg-warning/15", text: "text-warning", border: "border-warning/30 dark:border-warning/70" },
  "chart-4": { bg: "bg-chart-4/10 dark:bg-chart-4/15", text: "text-chart-4", border: "border-chart-4/30 dark:border-chart-4/70" },
  muted: { bg: "bg-muted", text: "text-muted-foreground", border: "border-muted-foreground/30" },
  destructive: { bg: "bg-destructive/10 dark:bg-destructive/15", text: "text-destructive", border: "border-destructive/30 dark:border-destructive/70" },
};

function colorsFor(status: string): { bg: string; text: string; border: string } {
  return TONE_COLORS[getExecutionStatusTone(status)];
}

interface ExecutionStatusTrackerProps {
  status: string;
  variant?: "badge" | "full" | "compact";
  showProgress?: boolean;
  className?: string;
}

export function ExecutionStatusTracker({
  status,
  variant = "badge",
  showProgress = false,
  className,
}: ExecutionStatusTrackerProps) {
  const currentIndex = EXECUTION_STATUS_ORDER.indexOf(status as typeof EXECUTION_STATUS_ORDER[number]);
  const progress = currentIndex >= 0 ? ((currentIndex + 1) / EXECUTION_STATUS_ORDER.length) * 100 : 0;
  const colors = colorsFor(status);
  const Icon = STATUS_ICONS[status] || Circle;
  const label = getExecutionStatusLabel(status);

  if (variant === "badge") {
    return (
      <Badge
        variant="outline"
        className={cn(colors.bg, colors.text, colors.border, "gap-1", className)}
        data-testid={`status-badge-${status}`}
      >
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    );
  }

  if (variant === "compact") {
    return (
      <div className={cn("flex items-center gap-2", className)} data-testid={`status-compact-${status}`}>
        <div className={cn("p-1.5 rounded-full", colors.bg, colors.border, "border")}>
          <Icon className={cn("h-4 w-4", colors.text)} />
        </div>
        <span className={cn("text-sm font-medium", colors.text)}>{label}</span>
        {showProgress && (
          <span className="text-xs text-muted-foreground ml-auto">
            {currentIndex + 1}/{EXECUTION_STATUS_ORDER.length}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)} data-testid="status-tracker-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn("p-2 rounded-full", colors.bg, colors.border, "border")}>
            <Icon className={cn("h-5 w-5", colors.text)} />
          </div>
          <div>
            <p className={cn("font-medium", colors.text)}>{label}</p>
            <p className="text-xs text-muted-foreground">
              Steg {currentIndex + 1} av {EXECUTION_STATUS_ORDER.length}
            </p>
          </div>
        </div>
      </div>

      {showProgress && <Progress value={progress} className="h-2" />}

      <div className="flex gap-1">
        {EXECUTION_STATUS_ORDER.map((s, index) => {
          const isCompleted = index <= currentIndex;
          const isCurrent = index === currentIndex;
          const StepIcon = STATUS_ICONS[s];
          const stepColors = colorsFor(s);

          return (
            <div
              key={s}
              className={cn(
                "flex-1 flex flex-col items-center gap-1",
                index > 0 && "relative"
              )}
            >
              {index > 0 && (
                <div
                  className={cn(
                    "absolute left-0 top-3 w-full h-0.5 -translate-x-1/2",
                    isCompleted ? "bg-primary" : "bg-muted"
                  )}
                />
              )}
              <div
                className={cn(
                  "relative z-10 p-1 rounded-full border transition-colors",
                  isCurrent
                    ? cn(stepColors.bg, stepColors.border, "ring-2 ring-primary ring-offset-2 ring-offset-background")
                    : isCompleted
                    ? "bg-primary border-primary"
                    : "bg-muted border-muted-foreground/30"
                )}
                title={getExecutionStatusLabel(s)}
              >
                <StepIcon
                  className={cn(
                    "h-3 w-3",
                    isCurrent
                      ? stepColors.text
                      : isCompleted
                      ? "text-primary-foreground"
                      : "text-muted-foreground"
                  )}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{getExecutionStatusLabel(EXECUTION_STATUS_ORDER[0])}</span>
        <span>{getExecutionStatusLabel(EXECUTION_STATUS_ORDER[EXECUTION_STATUS_ORDER.length - 1])}</span>
      </div>
    </div>
  );
}

interface ExecutionStatusBadgeProps {
  status: string;
  className?: string;
}

export function ExecutionStatusBadge({ status, className }: ExecutionStatusBadgeProps) {
  return <ExecutionStatusTracker status={status} variant="badge" className={className} />;
}
