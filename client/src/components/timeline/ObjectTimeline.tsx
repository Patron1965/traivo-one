import { memo, useMemo, useState } from "react";
import {
  addDays, addMonths, addQuarters, addWeeks, addYears,
  startOfYear, endOfYear, startOfQuarter, endOfQuarter,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  format, isSameDay, getWeek, getQuarter,
} from "date-fns";
import { sv } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, CalendarDays, Clock, MapPin,
} from "lucide-react";
import type { WorkOrderWithObject } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { QueryState } from "@/components/QueryState";
import { zoomLevels } from "@/components/weekplanner/types";
import { MonthView } from "@/components/weekplanner/MonthView";
import { QuarterView } from "@/components/weekplanner/QuarterView";
import { YearView } from "@/components/weekplanner/YearView";
import { getWorkOrderStatusBadge } from "@/lib/status-colors";

export type TimelineViewMode = "year" | "quarter" | "month" | "week" | "day";

// Zoom-nivåer från grovt (år) till fint (dag) — index 0 = mest utzoomat.
const ZOOM_ORDER: TimelineViewMode[] = ["year", "quarter", "month", "week", "day"];

const VIEW_LABELS: Record<TimelineViewMode, string> = {
  year: "År",
  quarter: "Kvartal",
  month: "Månad",
  week: "Vecka",
  day: "Dag",
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  skapad: "Skapad",
  planerad_pre: "Förplanerad",
  planerad_resurs: "Resursplanerad",
  planerad_las: "Låst",
  utford: "Utförd",
  fakturerad: "Fakturerad",
  omojlig: "Omöjlig",
  avbruten: "Avbruten",
};

function statusLabel(status: string | null | undefined): string {
  if (!status) return "Okänd";
  return ORDER_STATUS_LABELS[status] ?? status;
}

export interface ObjectTimelineProps {
  /**
   * Hämtar tidslinje-data för ett halvöppet intervall [startDate, endDate]
   * (ISO YYYY-MM-DD). Injiceras av föräldern så att komponenten kan
   * återanvändas mot olika endpoints (t.ex. kundportalens variant).
   */
  fetchTimeline: (startDate: string, endDate: string) => Promise<WorkOrderWithObject[]>;
  /** Cache-prefix för react-query. Året appendas internt. */
  queryKeyPrefix: readonly unknown[];
  onSelectTask?: (taskId: string) => void;
  initialViewMode?: TimelineViewMode;
  className?: string;
}

function fmtHours(minutes: number): string {
  return (minutes / 60).toFixed(1).replace(".", ",");
}

export const ObjectTimeline = memo(function ObjectTimeline({
  fetchTimeline,
  queryKeyPrefix,
  onSelectTask,
  initialViewMode = "month",
  className,
}: ObjectTimelineProps) {
  const [viewMode, setViewMode] = useState<TimelineViewMode>(initialViewMode);
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [zoomIndex, setZoomIndex] = useState(1); // cellhöjd för månadsvyn

  // Hämta hela året (± 7 dagar för randveckor) så att zoom mellan år/kvartal/
  // månad/vecka/dag inte triggar nya nätverksanrop förrän året byts.
  const fetchYear = currentDate.getFullYear();
  const rangeStart = useMemo(
    () => format(addDays(startOfYear(currentDate), -7), "yyyy-MM-dd"),
    [fetchYear],
  );
  const rangeEnd = useMemo(
    () => format(addDays(endOfYear(currentDate), 7), "yyyy-MM-dd"),
    [fetchYear],
  );

  const query = useQuery<WorkOrderWithObject[]>({
    queryKey: [...queryKeyPrefix, fetchYear],
    queryFn: () => fetchTimeline(rangeStart, rangeEnd),
  });

  const tasks = query.data ?? [];

  // Filtrera till synlig period för vecka/dag (år/kvartal/månad filtrerar internt).
  const weekStart = useMemo(() => startOfWeek(currentDate, { weekStartsOn: 1 }), [currentDate]);
  const weekEnd = useMemo(() => endOfWeek(currentDate, { weekStartsOn: 1 }), [currentDate]);

  const weekTasksByDay = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return days.map((day) => ({
      day,
      tasks: tasks
        .filter((t) => t.scheduledDate && isSameDay(new Date(t.scheduledDate), day))
        .sort((a, b) => (a.scheduledStartTime ?? "").localeCompare(b.scheduledStartTime ?? "")),
    }));
  }, [tasks, weekStart]);

  const dayTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.scheduledDate && isSameDay(new Date(t.scheduledDate), currentDate))
        .sort((a, b) => (a.scheduledStartTime ?? "").localeCompare(b.scheduledStartTime ?? "")),
    [tasks, currentDate],
  );

  // ---- navigering ----
  const navigate = (dir: -1 | 1) => {
    setCurrentDate((d) => {
      switch (viewMode) {
        case "year": return addYears(d, dir);
        case "quarter": return addQuarters(d, dir);
        case "month": return addMonths(d, dir);
        case "week": return addWeeks(d, dir);
        case "day": return addDays(d, dir);
      }
    });
  };

  const goToMonth = (day: Date) => { setCurrentDate(day); setViewMode("month"); };
  const goToDay = (day: Date) => { setCurrentDate(day); setViewMode("day"); };

  const zoomTo = (dir: -1 | 1) => {
    const idx = ZOOM_ORDER.indexOf(viewMode);
    const next = Math.min(ZOOM_ORDER.length - 1, Math.max(0, idx + dir));
    setViewMode(ZOOM_ORDER[next]);
  };

  const periodLabel = useMemo(() => {
    switch (viewMode) {
      case "year":
        return String(currentDate.getFullYear());
      case "quarter":
        return `Kv${getQuarter(currentDate)} ${currentDate.getFullYear()}`;
      case "month":
        return format(currentDate, "MMMM yyyy", { locale: sv });
      case "week":
        return `Vecka ${getWeek(currentDate, { weekStartsOn: 1 })} • ${format(weekStart, "d MMM", { locale: sv })}–${format(weekEnd, "d MMM yyyy", { locale: sv })}`;
      case "day":
        return format(currentDate, "EEEE d MMMM yyyy", { locale: sv });
    }
  }, [viewMode, currentDate, weekStart, weekEnd]);

  const zoom = zoomLevels[zoomIndex];
  const noConflicts: Record<string, string[]> = {};

  return (
    <div className={`flex flex-col h-full min-h-[28rem] ${className ?? ""}`} data-testid="object-timeline">
      {/* Verktygsrad */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-border">
        <div className="flex items-center gap-1">
          <Button
            variant="outline" size="icon" className="h-8 w-8"
            onClick={() => navigate(-1)}
            data-testid="button-timeline-prev"
            aria-label="Föregående"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline" size="sm" className="h-8"
            onClick={() => setCurrentDate(new Date())}
            data-testid="button-timeline-today"
          >
            Idag
          </Button>
          <Button
            variant="outline" size="icon" className="h-8 w-8"
            onClick={() => navigate(1)}
            data-testid="button-timeline-next"
            aria-label="Nästa"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm font-medium capitalize" data-testid="text-timeline-period">
            {periodLabel}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {viewMode === "month" && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="icon" className="h-8 w-8"
                onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
                disabled={zoomIndex === 0}
                data-testid="button-timeline-zoom-out"
                aria-label="Mindre celler"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                variant="outline" size="icon" className="h-8 w-8"
                onClick={() => setZoomIndex((i) => Math.min(zoomLevels.length - 1, i + 1))}
                disabled={zoomIndex === zoomLevels.length - 1}
                data-testid="button-timeline-zoom-in"
                aria-label="Större celler"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => zoomTo(-1)}
              disabled={viewMode === "year"}
              data-testid="button-timeline-zoomlevel-out"
              aria-label="Zooma ut"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={(v) => v && setViewMode(v as TimelineViewMode)}
              data-testid="toggle-timeline-viewmode"
            >
              {ZOOM_ORDER.map((mode) => (
                <ToggleGroupItem
                  key={mode}
                  value={mode}
                  size="sm"
                  className="h-8 px-2.5 text-xs"
                  data-testid={`toggle-view-${mode}`}
                >
                  {VIEW_LABELS[mode]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => zoomTo(1)}
              disabled={viewMode === "day"}
              data-testid="button-timeline-zoomlevel-in"
              aria-label="Zooma in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Innehåll */}
      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        isEmpty={tasks.length === 0}
        error={query.error as { message?: string } | null}
        onRetry={() => query.refetch()}
        emptyTitle="Inga uppgifter"
        emptyDescription="Det finns inga schemalagda uppgifter för det här objektet eller dess underliggande objekt under den valda perioden."
      >
        <div className="flex-1 flex flex-col overflow-hidden">
          {viewMode === "year" && (
            <YearView
              currentDate={currentDate}
              filteredScheduledJobs={tasks}
              jobConflicts={noConflicts}
              goToMonth={goToMonth}
            />
          )}
          {viewMode === "quarter" && (
            <QuarterView
              currentDate={currentDate}
              filteredScheduledJobs={tasks}
              jobConflicts={noConflicts}
              goToMonth={goToMonth}
            />
          )}
          {viewMode === "month" && (
            <MonthView
              currentDate={currentDate}
              filteredScheduledJobs={tasks}
              jobConflicts={noConflicts}
              timeRestrictions={[]}
              zoom={zoom}
              goToDay={goToDay}
            />
          )}
          {viewMode === "week" && (
            <div className="flex-1 overflow-auto p-3" data-testid="timeline-week-view">
              <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
                {weekTasksByDay.map(({ day, tasks: dt }) => {
                  const isToday = isSameDay(day, new Date());
                  return (
                    <div
                      key={day.toISOString()}
                      className={`rounded-md border p-2 min-h-[8rem] ${isToday ? "border-primary bg-primary/5" : "border-border bg-muted/30"}`}
                      data-testid={`week-day-${format(day, "yyyy-MM-dd")}`}
                    >
                      <div className={`text-xs font-medium mb-2 capitalize ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                        {format(day, "EEE d/M", { locale: sv })}
                      </div>
                      <div className="space-y-1">
                        {dt.length === 0 && (
                          <div className="text-[10px] text-muted-foreground/60">—</div>
                        )}
                        {dt.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => onSelectTask?.(t.id)}
                            className="w-full text-left rounded-sm border border-border bg-background p-1.5 hover-elevate"
                            data-testid={`week-task-${t.id}`}
                          >
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              {t.scheduledStartTime && (
                                <span className="inline-flex items-center gap-0.5">
                                  <Clock className="h-2.5 w-2.5" />{t.scheduledStartTime}
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-medium truncate">{t.title}</div>
                            {t.objectName && (
                              <div className="text-[10px] text-muted-foreground truncate">{t.objectName}</div>
                            )}
                            <Badge className={`mt-1 text-[9px] ${getWorkOrderStatusBadge(t.orderStatus)}`}>
                              {statusLabel(t.orderStatus)}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {viewMode === "day" && (
            <div className="flex-1 overflow-auto p-3" data-testid="timeline-day-view">
              {dayTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                  <CalendarDays className="h-8 w-8 mb-3" />
                  <p className="text-sm">Inga uppgifter denna dag.</p>
                </div>
              ) : (
                <div className="space-y-2 max-w-3xl mx-auto">
                  {dayTasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onSelectTask?.(t.id)}
                      className="w-full text-left rounded-md border border-border bg-card p-3 hover-elevate"
                      data-testid={`day-task-${t.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{t.title}</div>
                          {t.objectName && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{t.objectName}</span>
                            </div>
                          )}
                        </div>
                        <Badge className={`shrink-0 text-[10px] ${getWorkOrderStatusBadge(t.orderStatus)}`}>
                          {statusLabel(t.orderStatus)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        {t.scheduledStartTime && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />{t.scheduledStartTime}
                          </span>
                        )}
                        {!!t.estimatedDuration && (
                          <span>{fmtHours(t.estimatedDuration)} h</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </QueryState>
    </div>
  );
});
