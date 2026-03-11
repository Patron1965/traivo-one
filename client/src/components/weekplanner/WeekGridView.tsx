import { memo, useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Plus, Navigation, Cloud, Sun, CloudRain, Snowflake } from "lucide-react";
import { format, isSameDay } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrderWithObject, ObjectTimeRestriction } from "@shared/schema";
import { HOURS_IN_DAY, getJobCategory, haversineDistance } from "./types";
import type { WeatherImpactDay, WeatherForecastData } from "./types";
import { DroppableCell } from "./DndComponents";
import { JobCard } from "./JobCard";
import { ResourceColumn } from "./ResourceColumn";

interface WeekGridViewProps {
  visibleDates: Date[];
  visibleResources: Resource[];
  getJobsForResourceAndDay: (resourceId: string, day: Date) => WorkOrderWithObject[];
  getResourceDayHours: (resourceId: string, day: Date) => number;
  getCapacityPercentage: (hours: number) => number;
  getCapacityColor: (pct: number) => string;
  getCapacityBgColor: (pct: number) => string;
  getDropFitClass: (resourceId: string, dayStr: string, durationMin: number) => { bg: string; label: string; color: string } | null;
  activeDragJob: WorkOrderWithObject | null;
  restrictionsByObject: Map<string, ObjectTimeRestriction[]>;
  resourceWeekSummary: Record<string, { totalHours: number; weeklyCapacity: number; pct: number }>;
  zoom: { dayH: number; weekH: number; monthH: number; scale: number };
  weatherByDate: Map<string, { forecast: WeatherForecastData["forecasts"][0]; impact: WeatherImpactDay }>;
  onResourceClick: (resourceId: string) => void;
  onSendSchedule: (resource: Resource) => void;
  jobCardProps: Omit<React.ComponentProps<typeof JobCard>, 'job' | 'compact'>;
}

function getWeatherIcon(code: number) {
  if ([0, 1].includes(code)) return <Sun className="h-3 w-3 text-yellow-500" />;
  if ([2, 3].includes(code)) return <Cloud className="h-3 w-3 text-gray-400" />;
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return <CloudRain className="h-3 w-3 text-blue-500" />;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return <Snowflake className="h-3 w-3 text-blue-300" />;
  return <Cloud className="h-3 w-3 text-gray-400" />;
}

function getWeatherMultiplierLabel(multiplier: number) {
  if (multiplier >= 1.0) return null;
  const pctIncrease = Math.round((1 / multiplier - 1) * 100);
  return `+${pctIncrease}% tid`;
}

export const WeekGridView = memo(function WeekGridView(props: WeekGridViewProps) {
  const {
    visibleDates, visibleResources, getJobsForResourceAndDay, getResourceDayHours,
    getCapacityPercentage, getCapacityColor, getCapacityBgColor, getDropFitClass,
    activeDragJob, restrictionsByObject, resourceWeekSummary, zoom, weatherByDate,
    onResourceClick, onSendSchedule, jobCardProps,
  } = props;

  const zoomPadClass = zoom.scale <= 0.5 ? "p-0.5" : zoom.scale >= 2 ? "p-4" : "p-2";
  const zoomGapClass = zoom.scale <= 0.5 ? "space-y-0" : zoom.scale >= 2 ? "space-y-3" : "space-y-1";

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden">
      <div className="w-full">
        <div className="grid grid-cols-[120px_repeat(5,minmax(0,1fr))] border-b sticky top-0 bg-background z-10">
          <div className="p-2 font-medium text-sm text-muted-foreground border-r">Resurser</div>
          {visibleDates.map((day, i) => {
            const isToday = isSameDay(day, new Date());
            const dayStr = format(day, "yyyy-MM-dd");
            const weather = weatherByDate.get(dayStr);
            const multiplierLabel = weather ? getWeatherMultiplierLabel(weather.impact.capacityMultiplier) : null;
            return (
              <div key={i} className={`p-3 text-center border-r last:border-r-0 ${isToday ? "bg-primary/5" : ""}`}>
                <div className="text-xs text-muted-foreground uppercase">{format(day, "EEE", { locale: sv })}</div>
                <div className={`text-lg font-semibold ${isToday ? "text-primary" : ""}`}>{format(day, "d")}</div>
                {weather && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-center gap-1 mt-0.5" data-testid={`weather-${dayStr}`}>
                        {getWeatherIcon(weather.forecast.weatherCode)}
                        <span className="text-[10px] text-muted-foreground">{Math.round(weather.forecast.temperature)}°</span>
                        {multiplierLabel && (
                          <span className={`text-[9px] font-medium px-1 rounded ${
                            weather.impact.impactLevel === "severe" || weather.impact.impactLevel === "high"
                              ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : weather.impact.impactLevel === "medium"
                              ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          }`}>
                            {multiplierLabel}
                          </span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-medium">{weather.forecast.weatherDescription}</p>
                      <p>Temp: {weather.forecast.temperature}°C, Vind: {weather.forecast.windSpeed} m/s</p>
                      <p>Nederbörd: {weather.forecast.precipitation} mm</p>
                      {multiplierLabel && <p className="text-amber-500">Kapacitetspåverkan: {multiplierLabel}</p>}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>

        {visibleResources.map((resource) => {
          const summary = resourceWeekSummary[resource.id];
          return (
            <div key={resource.id} className="grid grid-cols-[120px_repeat(5,minmax(0,1fr))] border-b">
              <ResourceColumn resource={resource} summary={summary} onResourceClick={onResourceClick} onSendSchedule={onSendSchedule} />
              {visibleDates.map((day, dayIndex) => {
                const jobs = getJobsForResourceAndDay(resource.id, day);
                const dayHours = getResourceDayHours(resource.id, day);
                const isOverbooked = dayHours > HOURS_IN_DAY;
                const capacityPct = getCapacityPercentage(dayHours);
                const dayStr = format(day, "yyyy-MM-dd");
                const droppableId = `${resource.id}|${dayStr}`;

                const sortedDayJobs = [...jobs]
                  .filter(j => j.scheduledStartTime && j.taskLatitude && j.taskLongitude)
                  .sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
                let totalTravelMin = 0;
                let totalTravelKm = 0;
                for (let si = 0; si < sortedDayJobs.length - 1; si++) {
                  const sFrom = sortedDayJobs[si];
                  const sTo = sortedDayJobs[si + 1];
                  if (sFrom.taskLatitude && sFrom.taskLongitude && sTo.taskLatitude && sTo.taskLongitude) {
                    const d = haversineDistance(sFrom.taskLatitude, sFrom.taskLongitude, sTo.taskLatitude, sTo.taskLongitude);
                    totalTravelKm += d;
                    totalTravelMin += Math.max(Math.round(d / 50 * 60), 5);
                  }
                }

                const cellDayOfWeek = day.getDay() || 7;
                const restrictedJobs = jobs.filter(j => {
                  if (!j.objectId) return false;
                  const objR = restrictionsByObject.get(j.objectId) || [];
                  return objR.some(r => r.isActive && r.weekdays && r.weekdays.includes(cellDayOfWeek));
                });

                const cellDropFit = activeDragJob ? getDropFitClass(resource.id, dayStr, activeDragJob.estimatedDuration || 60) : null;

                return (
                  <DroppableCell
                    key={dayIndex}
                    id={droppableId}
                    className={`${zoomPadClass} border-r last:border-r-0 transition-colors overflow-hidden min-w-0 ${getCapacityBgColor(capacityPct)} ${restrictedJobs.length > 0 ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}
                    dropFitInfo={cellDropFit}
                    style={{ minHeight: `${zoom.weekH}px` }}
                  >
                    <div className="min-w-0 overflow-hidden" data-testid={`drop-zone-${resource.id}-${dayStr}`}>
                      <div className="flex items-center gap-1 mb-2">
                        <div className="h-2 flex-1 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${getCapacityColor(capacityPct)}`} style={{ width: `${Math.min(capacityPct, 100)}%` }} />
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`text-[10px] tabular-nums cursor-help ${isOverbooked ? "text-red-600 dark:text-red-400 font-semibold" : capacityPct >= 85 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}>
                              {dayHours.toFixed(1).replace(".", ",")}h
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{dayHours.toFixed(1)}h planerat av {HOURS_IN_DAY}h</p>
                            <p>{Math.max(0, HOURS_IN_DAY - dayHours).toFixed(1)}h kvar</p>
                            {isOverbooked && <p className="text-red-500 font-medium">Överbokad med {(dayHours - HOURS_IN_DAY).toFixed(1)}h</p>}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      {isOverbooked && (
                        <div className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400 mb-1 font-medium">
                          <AlertTriangle className="h-3 w-3" /><span>+{(dayHours - HOURS_IN_DAY).toFixed(1)}h över</span>
                        </div>
                      )}
                      {restrictedJobs.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400 mb-1 cursor-help" data-testid={`cell-restriction-${resource.id}-${dayStr}`}>
                              <AlertTriangle className="h-3 w-3 shrink-0" /><span>{restrictedJobs.length} begränsad</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs space-y-1">
                              <p className="font-medium text-red-500">Tidsbegränsade uppdrag</p>
                              {restrictedJobs.map(j => <p key={j.id}>{j.title} - {j.objectName}</p>)}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <div className={zoomGapClass}>
                        {jobs.length === 0 && (
                          <div className="flex items-center justify-center py-4 text-muted-foreground/40">
                            <Plus className="h-4 w-4" />
                          </div>
                        )}
                        {jobs.map((job) => <JobCard key={job.id} job={job} compact {...jobCardProps} />)}
                      </div>
                      {totalTravelMin > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 mt-2 px-1.5 py-0.5 rounded text-[10px] bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800" data-testid={`travel-summary-${resource.id}-${dayStr}`}>
                              <Navigation className="h-2.5 w-2.5" />
                              <span>{totalTravelMin} min</span>
                              <span className="text-yellow-500">({Math.round(totalTravelKm)} km)</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent><p>Total restid: {totalTravelMin} min, {Math.round(totalTravelKm * 10) / 10} km</p></TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </DroppableCell>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
});
