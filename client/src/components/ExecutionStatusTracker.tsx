import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
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

export const EXECUTION_STATUS_LABELS: Record<string, string> = {
  not_planned: "Ej planerad",
  planned_rough: "Grovplanerad",
  planned_fine: "Finplanerad",
  on_way: "På väg",
  on_site: "På plats",
  completed: "Utförd",
  inspected: "Kontrollerad",
  invoiced: "Fakturerad",
};

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

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  not_planned: { bg: "bg-muted", text: "text-muted-foreground", border: "border-muted-foreground/30" },
  planned_rough: { bg: "bg-blue-50 dark:bg-blue-950", text: "text-blue-700 dark:text-blue-300", border: "border-blue-300 dark:border-blue-700" },
  planned_fine: { bg: "bg-indigo-50 dark:bg-indigo-950", text: "text-indigo-700 dark:text-indigo-300", border: "border-indigo-300 dark:border-indigo-700" },
  on_way: { bg: "bg-amber-50 dark:bg-amber-950", text: "text-amber-700 dark:text-amber-300", border: "border-amber-300 dark:border-amber-700" },
  on_site: { bg: "bg-orange-50 dark:bg-orange-950", text: "text-orange-700 dark:text-orange-300", border: "border-orange-300 dark:border-orange-700" },
  completed: { bg: "bg-green-50 dark:bg-green-950", text: "text-green-700 dark:text-green-300", border: "border-green-300 dark:border-green-700" },
  inspected: { bg: "bg-teal-50 dark:bg-teal-950", text: "text-teal-700 dark:text-teal-300", border: "border-teal-300 dark:border-teal-700" },
  invoiced: { bg: "bg-emerald-50 dark:bg-emerald-950", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-300 dark:border-emerald-700" },
};

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
  const colors = STATUS_COLORS[status] || STATUS_COLORS.not_planned;
  const Icon = STATUS_ICONS[status] || Circle;
  const label = EXECUTION_STATUS_LABELS[status] || status;

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
          const stepColors = STATUS_COLORS[s];

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
                title={EXECUTION_STATUS_LABELS[s]}
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
        <span>Ej planerad</span>
        <span>Fakturerad</span>
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
