import { memo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle } from "lucide-react";
import { startOfMonth, getDaysInMonth, isSameDay } from "date-fns";
import type { WorkOrderWithObject, ObjectTimeRestriction } from "@shared/schema";
import { getJobCategory } from "./types";

interface MonthViewProps {
  currentDate: Date;
  filteredScheduledJobs: WorkOrderWithObject[];
  jobConflicts: Record<string, string[]>;
  timeRestrictions: ObjectTimeRestriction[];
  zoom: { dayH: number; weekH: number; monthH: number; scale: number };
  goToDay: (day: Date) => void;
}

export const MonthView = memo(function MonthView(props: MonthViewProps) {
  const { currentDate, filteredScheduledJobs, jobConflicts, timeRestrictions, zoom, goToDay } = props;

  const monthStart = startOfMonth(currentDate);
  const startDay = monthStart.getDay() || 7;
  const emptyCells = startDay - 1;
  const daysInCurrentMonth = getDaysInMonth(currentDate);

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="grid grid-cols-7 gap-1 mb-2">
        {["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"].map((day) => (
          <div key={day} className="text-center text-xs text-muted-foreground font-medium py-2">{day}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: emptyCells }, (_, i) => (
          <div key={`empty-${i}`} style={{ minHeight: `${zoom.monthH}px` }} />
        ))}
        {Array.from({ length: daysInCurrentMonth }, (_, idx) => {
          const d = idx + 1;
          const day = new Date(currentDate.getFullYear(), currentDate.getMonth(), d);
          const dayJobs = filteredScheduledJobs.filter(j => j.scheduledDate && isSameDay(new Date(j.scheduledDate), day));
          const isToday = isSameDay(day, new Date());
          const totalHours = dayJobs.reduce((sum, j) => sum + (j.estimatedDuration || 0) / 60, 0);
          const productionCount = dayJobs.filter(j => getJobCategory(j) === "production").length;
          const travelCount = dayJobs.filter(j => getJobCategory(j) === "travel").length;
          const breakCount = dayJobs.filter(j => getJobCategory(j) === "break").length;
          const dayConflictCount = dayJobs.filter(j => jobConflicts[j.id]).length;
          const dayOfWeek = day.getDay() || 7;
          const dayObjectIds = new Set(dayJobs.map(j => j.objectId).filter(Boolean));
          const dayRestrictionCount = dayObjectIds.size > 0
            ? timeRestrictions.filter(r => r.isActive && r.weekdays && r.weekdays.includes(dayOfWeek) && dayObjectIds.has(r.objectId)).length
            : 0;

          return (
            <div
              key={d}
              className={`p-2 rounded-md border cursor-pointer hover-elevate transition-colors ${isToday ? "border-primary bg-primary/5" : dayRestrictionCount > 0 ? "border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20" : "border-border bg-muted/30"}`}
              style={{ minHeight: `${zoom.monthH}px` }}
              onClick={() => goToDay(day)}
              data-testid={`month-day-${d}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm font-medium ${isToday ? "text-primary" : ""}`}>{d}</span>
                {dayConflictCount > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-red-500" data-testid={`month-conflict-${d}`}>
                        <AlertTriangle className="h-3 w-3" /><span className="text-[9px]">{dayConflictCount}</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{dayConflictCount} jobb med konflikter</TooltipContent>
                  </Tooltip>
                )}
              </div>
              {dayJobs.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-0.5" data-testid={`month-categories-${d}`}>
                    {productionCount > 0 && (
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5 text-[9px]" data-testid={`month-production-${d}`}>
                          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0"></span><span>{productionCount}</span>
                        </span>
                      </TooltipTrigger><TooltipContent>Produktionstid: {productionCount} jobb</TooltipContent></Tooltip>
                    )}
                    {travelCount > 0 && (
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5 text-[9px] ml-1" data-testid={`month-travel-${d}`}>
                          <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0"></span><span>{travelCount}</span>
                        </span>
                      </TooltipTrigger><TooltipContent>Restid: {travelCount} jobb</TooltipContent></Tooltip>
                    )}
                    {breakCount > 0 && (
                      <Tooltip><TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5 text-[9px] ml-1" data-testid={`month-break-${d}`}>
                          <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0"></span><span>{breakCount}</span>
                        </span>
                      </TooltipTrigger><TooltipContent>Egentid: {breakCount} jobb</TooltipContent></Tooltip>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground" data-testid={`month-summary-${d}`}>
                    {dayJobs.length} jobb / {totalHours.toFixed(1)}h
                  </div>
                  {dayRestrictionCount > 0 && (
                    <div className="text-[9px] text-red-500 flex items-center gap-0.5" data-testid={`month-restriction-${d}`}>
                      <AlertTriangle className="h-2.5 w-2.5 shrink-0" />{dayRestrictionCount} begr.
                    </div>
                  )}
                </div>
              )}
              {dayJobs.length === 0 && dayRestrictionCount > 0 && (
                <div className="text-[9px] text-red-500 flex items-center gap-0.5 mt-1" data-testid={`month-restriction-${d}`}>
                  <AlertTriangle className="h-2.5 w-2.5 shrink-0" />{dayRestrictionCount} begr.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
