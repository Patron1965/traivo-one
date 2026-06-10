import { memo, useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { WorkOrderWithObject } from "@shared/schema";

interface YearViewProps {
  currentDate: Date;
  filteredScheduledJobs: WorkOrderWithObject[];
  jobConflicts: Record<string, string[]>;
  goToMonth: (day: Date) => void;
}

interface MonthBucket {
  jobCount: number;
  totalHours: number;
  conflictCount: number;
}

export const YearView = memo(function YearView(props: YearViewProps) {
  const { currentDate, filteredScheduledJobs, jobConflicts, goToMonth } = props;
  const year = currentDate.getFullYear();
  const now = new Date();

  const buckets = useMemo(() => {
    const arr: MonthBucket[] = Array.from({ length: 12 }, () => ({ jobCount: 0, totalHours: 0, conflictCount: 0 }));
    for (const j of filteredScheduledJobs) {
      if (!j.scheduledDate) continue;
      const d = new Date(j.scheduledDate);
      if (d.getFullYear() !== year) continue;
      const b = arr[d.getMonth()];
      b.jobCount += 1;
      b.totalHours += (j.estimatedDuration || 0) / 60;
      if (jobConflicts[j.id]) b.conflictCount += 1;
    }
    return arr;
  }, [filteredScheduledJobs, jobConflicts, year]);

  const maxHours = useMemo(() => Math.max(1, ...buckets.map(b => b.totalHours)), [buckets]);

  return (
    <div className="flex-1 overflow-auto p-4" data-testid="year-view">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {buckets.map((b, idx) => {
          const day = new Date(year, idx, 1);
          const isCurrentMonth = idx === now.getMonth() && year === now.getFullYear();
          const loadPct = Math.round((b.totalHours / maxHours) * 100);
          return (
            <div
              key={idx}
              className={`p-3 rounded-md border cursor-pointer hover-elevate transition-colors ${isCurrentMonth ? "border-primary bg-primary/5" : "border-border bg-muted/30"}`}
              style={{ minHeight: "96px" }}
              onClick={() => goToMonth(day)}
              data-testid={`year-month-${idx}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-medium capitalize ${isCurrentMonth ? "text-primary" : ""}`}>
                  {format(day, "MMMM", { locale: sv })}
                </span>
                {b.conflictCount > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-warning" data-testid={`year-conflict-${idx}`}>
                        <AlertTriangle className="h-3 w-3" /><span className="text-[10px]">{b.conflictCount}</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{b.conflictCount} jobb med konflikter</TooltipContent>
                  </Tooltip>
                )}
              </div>
              {b.jobCount > 0 ? (
                <>
                  <div className="text-xs text-muted-foreground mb-2" data-testid={`year-summary-${idx}`}>
                    {b.jobCount} jobb / {b.totalHours.toFixed(1).replace(".", ",")}h
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden" data-testid={`year-load-${idx}`}>
                    <div className="h-full bg-primary rounded-full" style={{ width: `${loadPct}%` }} />
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground/60">Inga jobb</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
