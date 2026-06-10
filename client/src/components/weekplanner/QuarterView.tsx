import { memo, useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { WorkOrderWithObject } from "@shared/schema";

interface QuarterViewProps {
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

export const QuarterView = memo(function QuarterView(props: QuarterViewProps) {
  const { currentDate, filteredScheduledJobs, jobConflicts, goToMonth } = props;
  const year = currentDate.getFullYear();
  const quarter = Math.floor(currentDate.getMonth() / 3);
  const startMonth = quarter * 3;
  const now = new Date();

  const buckets = useMemo(() => {
    const arr: MonthBucket[] = Array.from({ length: 3 }, () => ({ jobCount: 0, totalHours: 0, conflictCount: 0 }));
    for (const j of filteredScheduledJobs) {
      if (!j.scheduledDate) continue;
      const d = new Date(j.scheduledDate);
      if (d.getFullYear() !== year) continue;
      const offset = d.getMonth() - startMonth;
      if (offset < 0 || offset > 2) continue;
      const b = arr[offset];
      b.jobCount += 1;
      b.totalHours += (j.estimatedDuration || 0) / 60;
      if (jobConflicts[j.id]) b.conflictCount += 1;
    }
    return arr;
  }, [filteredScheduledJobs, jobConflicts, year, startMonth]);

  const maxHours = useMemo(() => Math.max(1, ...buckets.map(b => b.totalHours)), [buckets]);

  return (
    <div className="flex-1 overflow-auto p-4" data-testid="quarter-view">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {buckets.map((b, offset) => {
          const monthIdx = startMonth + offset;
          const day = new Date(year, monthIdx, 1);
          const isCurrentMonth = monthIdx === now.getMonth() && year === now.getFullYear();
          const loadPct = Math.round((b.totalHours / maxHours) * 100);
          return (
            <div
              key={monthIdx}
              className={`p-4 rounded-md border cursor-pointer hover-elevate transition-colors ${isCurrentMonth ? "border-primary bg-primary/5" : "border-border bg-muted/30"}`}
              style={{ minHeight: "140px" }}
              onClick={() => goToMonth(day)}
              data-testid={`quarter-month-${offset}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className={`text-base font-medium capitalize ${isCurrentMonth ? "text-primary" : ""}`}>
                  {format(day, "MMMM", { locale: sv })}
                </span>
                {b.conflictCount > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-warning" data-testid={`quarter-conflict-${offset}`}>
                        <AlertTriangle className="h-3.5 w-3.5" /><span className="text-xs">{b.conflictCount}</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{b.conflictCount} jobb med konflikter</TooltipContent>
                  </Tooltip>
                )}
              </div>
              {b.jobCount > 0 ? (
                <>
                  <div className="text-2xl font-semibold mb-1" data-testid={`quarter-count-${offset}`}>{b.jobCount}</div>
                  <div className="text-xs text-muted-foreground mb-3" data-testid={`quarter-summary-${offset}`}>
                    jobb / {b.totalHours.toFixed(1).replace(".", ",")}h
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden" data-testid={`quarter-load-${offset}`}>
                    <div className="h-full bg-primary rounded-full" style={{ width: `${loadPct}%` }} />
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground/60">Inga jobb</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
