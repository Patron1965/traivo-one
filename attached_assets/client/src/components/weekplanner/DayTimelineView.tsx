import { memo } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Navigation, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { format } from "date-fns";
import type { Resource, WorkOrderWithObject, ObjectTimeRestriction } from "@shared/schema";
import { DAY_START_HOUR, DAY_END_HOUR, HOURS_IN_DAY, getJobCategory } from "./types";
import type { ConstraintCell } from "./types";
import { constraintCategoryLabels } from "./types";
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
  clusterMatchedResourceIds?: Set<string>;
  showConstraintLayer?: boolean;
  constraintMap?: Map<string, ConstraintCell>;
  remoteDragActive?: boolean;
  remoteHoveredDropId?: string | null;
}

export const DayTimelineView = memo(function DayTimelineView(props: DayTimelineViewProps) {
  const {
    currentDate, visibleResources, timeRestrictions,
    getJobsForResourceAndDay, getResourceDayHours, getCapacityPercentage,
    getDropFitClass, activeDragJob, travelTimesForDay, zoom, jobCardProps,
    dragOverConflicts, clusterMatchedResourceIds,
    showConstraintLayer, constraintMap, remoteDragActive, remoteHoveredDropId,
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
          <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 dark:bg-destructive/15 border-b border-destructive/20 dark:border-destructive/80" data-testid="day-restrictions-banner">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <span className="text-xs text-destructive">
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
              <div key={resource.id} className={`p-2 border-r last:border-r-0 flex flex-col items-center justify-center gap-0.5 min-w-0 transition-colors ${activeDragJob && clusterMatchedResourceIds?.has(resource.id) ? "bg-chart-2/10 dark:bg-chart-2/15 ring-1 ring-inset ring-chart-2/40" : ""}`}>
                <div className="flex items-center gap-1.5">
                  <Avatar className="h-5 w-5 shrink-0">
                    <AvatarFallback className="text-[10px]">{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-medium truncate">{resource.name}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={`text-[10px] whitespace-nowrap cursor-help shrink-0 ${capacityPct >= 100 ? "text-destructive font-semibold" : capacityPct >= 85 ? "text-warning" : "text-muted-foreground"}`}>
                        {dayHours.toFixed(1)}h
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{dayHours.toFixed(1)}h av {HOURS_IN_DAY}h</p>
                      <p>{Math.max(0, HOURS_IN_DAY - dayHours).toFixed(1)}h kvar</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
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
              const constraintCellKey = `${resource.id}|${dayStr}`;
              const slotConstraint = showConstraintLayer && constraintMap ? constraintMap.get(constraintCellKey) : undefined;
              const constraintBg = slotConstraint?.status === "blocked" ? "bg-destructive/10 dark:bg-destructive/15" : slotConstraint?.status === "warning" ? "bg-warning/10 dark:bg-warning/15" : "";
              const cellBg = constraintBg || (cellHasProduction ? "bg-chart-2/10 dark:bg-chart-2/15" : cellHasTravel ? "bg-chart-3/10 dark:bg-chart-3/15" : cellHasBreak ? "bg-chart-1/10 dark:bg-chart-1/15" : "bg-muted/20");

              const dayCellDropFit = activeDragJob ? getDropFitClass(resource.id, format(day, "yyyy-MM-dd"), activeDragJob.estimatedDuration || 60) : null;

              return (
                <DroppableCell
                  key={resource.id}
                  id={droppableId}
                  className={`${zoomPadClass} border-r last:border-r-0 transition-colors ${cellBg}`}
                  dropFitInfo={dayCellDropFit}
                  style={{ minHeight: `${zoom.dayH}px` }}
                  dragOverConflicts={dragOverConflicts?.[droppableId]}
                  remoteDragActive={remoteDragActive}
                  remoteHovered={remoteHoveredDropId === droppableId}
                >
                  <div className={zoomGapClass} data-testid={`drop-zone-${resource.id}-${hour}`}>
                    {showConstraintLayer && constraintMap && hour === DAY_START_HOUR && (() => {
                      const cellConstraint = constraintMap.get(`${resource.id}|${dayStr}`);
                      if (!cellConstraint) {
                        return (
                          <div className="flex items-center gap-1 text-[9px] text-chart-2 px-1 py-0.5 rounded bg-chart-2/10 dark:bg-chart-2/15 mb-1" data-testid={`constraint-ok-day-${resource.id}`}>
                            <ShieldCheck className="h-2.5 w-2.5 shrink-0" />
                            <span>Tillgänglig</span>
                          </div>
                        );
                      }
                      const isBlocked = cellConstraint.status === "blocked";
                      const Icon = isBlocked ? ShieldX : ShieldAlert;
                      return (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className={`flex items-center gap-1 text-[9px] cursor-help px-1 py-0.5 rounded mb-1 ${isBlocked ? "text-destructive bg-destructive/10 dark:bg-destructive/15" : "text-warning bg-warning/10 dark:bg-warning/15"}`} data-testid={`constraint-day-${resource.id}`}>
                              <Icon className="h-2.5 w-2.5 shrink-0" />
                              <span>{isBlocked ? "Blockerad" : "Varning"} ({cellConstraint.constraints.length})</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <div className="text-xs space-y-1">
                              {cellConstraint.constraints.map((c, i) => (
                                <div key={i} className="flex items-start gap-1.5">
                                  <span className={`mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 ${c.severity === "critical" ? "bg-destructive/15" : "bg-warning/15"}`} />
                                  <span><strong>{constraintCategoryLabels[c.category] || c.category}:</strong> {c.description}</span>
                                </div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })()}
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
                                <div className="flex items-center gap-1.5 px-2 py-1 mt-1 rounded text-xs bg-chart-3/15 dark:bg-chart-3/15 border border-chart-3/30 dark:border-chart-3/70 text-chart-3" data-testid={`travel-block-${job.id}`}>
                                  <Navigation className="h-3 w-3" />
                                  <span>Restid {travelAfter.minutes} min</span>
                                  <span className="text-chart-3">({travelAfter.distanceKm} km)</span>
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
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-chart-3/15 dark:bg-chart-3/15 border border-chart-3/30 dark:border-chart-3/70 text-chart-3">
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
