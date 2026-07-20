/**
 * MapTimeline — veckodetalj (planerarläge) eller dagdetalj (utförarläge).
 * Renderas inuti kart-containern som ett overlay-element.
 */
import { addWeeks, addDays, startOfISOWeek, getISOWeek, isSameDay, isSameWeek, format } from "date-fns";
import { sv } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MapTimelineProps {
  mode: "planera" | "utfor";
  weekRef: Date;
  onWeekChange: (d: Date) => void;
  selectedDay: Date;
  onDayChange: (d: Date) => void;
}

export function MapTimeline({
  mode,
  weekRef,
  onWeekChange,
  selectedDay,
  onDayChange,
}: MapTimelineProps) {
  const today = new Date();

  if (mode === "planera") {
    const weeks = Array.from({ length: 5 }, (_, i) => addWeeks(weekRef, i - 2));
    return (
      <div
        className="absolute bottom-14 left-1/2 z-[1000] -translate-x-1/2 flex items-center gap-0.5 rounded-full border border-border bg-card/95 px-2 py-1 shadow-sm backdrop-blur-sm"
        data-testid="map-timeline-planner"
      >
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => onWeekChange(addWeeks(weekRef, -1))}
          data-testid="button-timeline-prev-week"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        {weeks.map((w) => {
          const isCurrent = isSameWeek(w, weekRef, { weekStartsOn: 1 });
          const isCurrentWeekOfToday = isSameWeek(w, today, { weekStartsOn: 1 });
          return (
            <button
              key={w.getTime()}
              onClick={() => onWeekChange(startOfISOWeek(w))}
              className={cn(
                "rounded-full px-3 py-0.5 text-xs font-medium tabular-nums transition-colors",
                isCurrent
                  ? "bg-primary text-primary-foreground"
                  : isCurrentWeekOfToday
                    ? "bg-muted font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              data-testid={`button-timeline-week-${getISOWeek(w)}`}
            >
              v.{getISOWeek(w)}
            </button>
          );
        })}
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => onWeekChange(addWeeks(weekRef, 1))}
          data-testid="button-timeline-next-week"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <button
          onClick={() => onWeekChange(today)}
          className="ml-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          data-testid="button-timeline-today"
        >
          Idag
        </button>
      </div>
    );
  }

  const weekStart = startOfISOWeek(weekRef);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div
      className="absolute bottom-14 left-1/2 z-[1000] -translate-x-1/2 flex items-center gap-0.5 rounded-full border border-border bg-card/95 px-2 py-1 shadow-sm backdrop-blur-sm"
      data-testid="map-timeline-field"
    >
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={() => onWeekChange(addWeeks(weekRef, -1))}
        data-testid="button-timeline-prev-day-week"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      {days.map((d) => {
        const isSelected = isSameDay(d, selectedDay);
        const isToday = isSameDay(d, today);
        return (
          <button
            key={d.getTime()}
            onClick={() => onDayChange(d)}
            className={cn(
              "flex flex-col items-center rounded-lg px-2 py-0.5 text-xs transition-colors",
              isSelected
                ? "bg-primary text-primary-foreground"
                : isToday
                  ? "bg-muted text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            data-testid={`button-timeline-day-${format(d, "yyyy-MM-dd")}`}
          >
            <span className="uppercase leading-tight">
              {format(d, "EEE", { locale: sv }).slice(0, 3)}
            </span>
            <span className="tabular-nums font-medium leading-tight">{format(d, "d")}</span>
          </button>
        );
      })}
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6"
        onClick={() => onWeekChange(addWeeks(weekRef, 1))}
        data-testid="button-timeline-next-day-week"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
      <button
        onClick={() => {
          onWeekChange(today);
          onDayChange(today);
        }}
        className="ml-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        data-testid="button-timeline-today-field"
      >
        Idag
      </button>
    </div>
  );
}
