import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addWeeks, getISOWeek, getYear } from "date-fns";

interface ClusterWeekSliderProps {
  weekRef: Date;
  onChange: (newWeekRef: Date) => void;
  disabled?: boolean;
}

export function ClusterWeekSlider({ weekRef, onChange, disabled }: ClusterWeekSliderProps) {
  const wNum = getISOWeek(weekRef);
  const year = getYear(weekRef);
  return (
    <div className="flex items-center gap-1" data-testid="cluster-week-slider">
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        disabled={disabled}
        onClick={() => onChange(addWeeks(weekRef, -1))}
        data-testid="button-cluster-week-prev"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span
        className="min-w-[80px] text-center text-sm font-medium tabular-nums"
        data-testid="text-cluster-week"
      >
        v.{wNum} {year}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        disabled={disabled}
        onClick={() => onChange(addWeeks(weekRef, 1))}
        data-testid="button-cluster-week-next"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
