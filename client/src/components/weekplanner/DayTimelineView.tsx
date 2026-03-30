import { memo } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Navigation } from "lucide-react";
import { format } from "date-fns";
import type { Resource, WorkOrderWithObject, ObjectTimeRestriction } from "@shared/schema";
import { DAY_START_HOUR, DAY_END_HOUR, HOURS_IN_DAY, getJobCategory } from "./types";
import { DroppableCell, DraggableJobCard } from "./DndComponents";
import { JobCard } from "./JobCard";

interface DayTimelineViewProps {
  currentDate: Date;
  visibleResources: Resource[];
  timeRestrictions: ObjectTimeRestriction[];
  getJobsForResourceAndDay: (resourceId: string, day: Date) => WorkOrderWithObject[];
  getResourceDayHours: (resourceId: string, day: Date) => number;
  getCapacityPercentage: (hours: number) => number;
  getDropFitClass: (resourceId: string, dayStr: string, durationMin: number) => { bg: string; label: string; color: string } | null;
  activeDragJob: WorkOrderWithObject | null;
  travelTimesForDay: Record<string, Array<{ fromJobId: string; toJobId: string; minutes: number; distanceKm: number; startTime: string; endTime: string }>>;
  zoom: { dayH: number; weekH: number; monthH: number; scale: number };
  jobCardProps: Omit<React.ComponentProps<typeof JobCard>, 'job' | 'compact'>;
  dragOverConflicts?: Record<string, string[]>;
}

export const DayTimelineView = memo(function DayTimelineView(props: DayTimelineViewProps) {
  const {
    currentDate, visibleResources, timeRestrictions,
    getJobsForResourceAndDay, getResourceDayHours, getCapacityPercentage,
    getDropFitClass, activeDragJob, travelTimesForDay, zoom, jobCardProps,
    dragOverConflicts,
  } = props;

  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);
  const day = currentDate;
  const dayOfWeek = day.getDay() || 7;
  const dayRestrictions = timeRestrictions.filter(r => r.isActive && r.weekdays && r.weekdays.includes(dayOfWeek));
  const zoomPadClass = zoom.scale <= 0.5 ? "p-0.5" : zoom.scale >= 2 ? "p-4" : "p-2";
  const zoomGapClass = zoom.scale <= 0.5 ? "space-y-0" : zoom.scale >= 2 ? "space-y-3" : "space-y-1";

  return (
    <div className="flex-1 overflow-auto">
      <div style={{ minWidth: `${60 + visibleResources.length * 120}px` }}>
        {dayRestrictions.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800" data-testid="day-restrictions-banner">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
            <span className="text-xs text-red-600 dark:text-red-400">
              {dayRestrictions.length} tidsbegränsning{dayRestrictions.length > 1 ? "ar" : ""} aktiv{dayRestrictions.length > 1 ? "a" : ""} idag
            </span>
          </div>
        )}
        <div className="grid border-b sticky top-0 bg-background z-10" style={{ gridTemplateColumns: `60px repeat(${visibleResources.length}, 1fr)` }}>
          <div className="p-2 font-medium text-sm text-muted-foreground border-r flex items-center justify-center">Tid</div>
          {visibleResources.map((resource) => {
            const dayHours = getResourceDayHours(resource.id, day);
            const capacityPct = getCapacityPercentage(dayHours);
            return (
              <div key={resource.id} className="p-2 border-r last:border-r-0 flex items-center justify-center gap-1.5 min-w-0">
                <Avatar className="h-5 w-5 shrink-0">
                  <AvatarFallback className="text-[10px]">{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                </Avatar>
                <span className="text-xs font-medium truncate">{resource.name}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={`text-[10px] whitespace-nowrap cursor-help shrink-0 ${capacityPct >= 100 ? "text-red-600 dark:text-red-400 font-semibold" : capacityPct >= 85 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}>
                      {dayHours.toFixed(1)}h
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{dayHours.toFixed(1)}h av {HOURS_IN_DAY}h</p>
                    <p>{Math.max(0, HOURS_IN_DAY - dayHours).toFixed(1)}h kvar</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>

        {hours.map((hour) => (
          <div key={hour} className="grid border-b" style={{ gridTemplateColumns: `60px repeat(${visibleResources.length}, 1fr)` }}>
            <div className="p-2 border-r text-sm text-muted-foreground font-medium text-center">
              {hour.toString().padStart(2, "0")}:00
            </div>
            {visibleResources.map((resource) => {
              const jobs = getJobsForResourceAndDay(resource.id, day).filter(job => {
                if (!job.scheduledStartTime) return hour === DAY_START_HOUR;
                const jobHour = parseInt(job.scheduledStartTime.split(":")[0], 10);
                return jobHour === hour;
              });
              const dayStr = format(day, "yyyy-MM-dd");
              const droppableId = `${resource.id}|${dayStr}|${hour}`;
              const resourceTravels = travelTimesForDay[resource.id] || [];
              const hourTravels = resourceTravels.filter(t => {
                const tHour = parseInt(t.startTime.split(":")[0], 10);
                return tHour === hour;
              });

              const cellHasProduction = jobs.some(j => getJobCategory(j) === "production");
              const cellHasTravel = jobs.some(j => getJobCategory(j) === "travel");
              const cellHasBreak = jobs.some(j => getJobCategory(j) === "break");
              const cellBg = cellHasProduction ? "bg-green-50/50 dark:bg-green-950/10" : cellHasTravel ? "bg-yellow-50/50 dark:bg-yellow-950/10" : cellHasBreak ? "bg-blue-50/50 dark:bg-blue-950/10" : "bg-muted/20";

              const dayCellDropFit = activeDragJob ? getDropFitClass(resource.id, format(day, "yyyy-MM-dd"), activeDragJob.estimatedDuration || 60) : null;

              return (
                <DroppableCell
                  key={resource.id}
                  id={droppableId}
                  className={`${zoomPadClass} border-r last:border-r-0 transition-colors ${cellBg}`}
                  dropFitInfo={dayCellDropFit}
                  style={{ minHeight: `${zoom.dayH}px` }}
                  dragOverConflicts={dragOverConflicts?.[droppableId]}
                >
                  <div className={zoomGapClass} data-testid={`drop-zone-${resource.id}-${hour}`}>
                    {jobs.map((job) => {
                      const travelAfter = resourceTravels.find(t => t.fromJobId === job.id);
                      return (
                        <div key={job.id}>
                          <DraggableJobCard id={job.id}>
                            <JobCard job={job} {...jobCardProps} />
                          </DraggableJobCard>
                          {travelAfter && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1.5 px-2 py-1 mt-1 rounded text-xs bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200" data-testid={`travel-block-${job.id}`}>
                                  <Navigation className="h-3 w-3" />
                                  <span>Restid {travelAfter.minutes} min</span>
                                  <span className="text-yellow-600 dark:text-yellow-400">({travelAfter.distanceKm} km)</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Körtid: {travelAfter.startTime}–{travelAfter.endTime}</p>
                                <p>Avstånd: {travelAfter.distanceKm} km (beräknat ~50 km/h)</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      );
                    })}
                    {hourTravels.filter(t => !jobs.some(j => j.id === t.fromJobId)).map((t, i) => (
                      <Tooltip key={`travel-orphan-${i}`}>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200">
                            <Navigation className="h-3 w-3" />
                            <span>Restid {t.minutes} min ({t.distanceKm} km)</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent><p>Körtid: {t.startTime}–{t.endTime}</p></TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </DroppableCell>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
