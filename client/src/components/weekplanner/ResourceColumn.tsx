import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Send } from "lucide-react";
import type { Resource } from "@shared/schema";

interface ResourceColumnProps {
  resource: Resource;
  summary?: { totalHours: number; weeklyCapacity: number; pct: number };
  onResourceClick: (resourceId: string) => void;
  onSendSchedule: (resource: Resource) => void;
}

export const ResourceColumn = memo(function ResourceColumn({ resource, summary, onResourceClick, onSendSchedule }: ResourceColumnProps) {
  return (
    <div
      className="p-2 border-r bg-muted/30 cursor-pointer hover:bg-muted/60 transition-colors group flex flex-col justify-between"
      onClick={() => onResourceClick(resource.id)}
      data-testid={`resource-cell-${resource.id}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <Avatar className="h-6 w-6 shrink-0">
          <AvatarFallback className="text-[10px]">{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
        </Avatar>
        <span className="text-xs font-medium truncate">{resource.name}</span>
      </div>
      {summary && (
        <div className="mt-1">
          <div className="flex items-center gap-1">
            <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${summary.pct >= 100 ? "bg-red-500" : summary.pct >= 80 ? "bg-green-500" : summary.pct >= 50 ? "bg-yellow-500" : "bg-gray-400"}`} style={{ width: `${Math.min(summary.pct, 100)}%` }} />
            </div>
            <span className={`text-[9px] tabular-nums ${summary.pct >= 100 ? "text-red-600" : summary.pct >= 80 ? "text-green-600" : "text-muted-foreground"}`}>{summary.pct}%</span>
          </div>
          <div className="text-[9px] text-muted-foreground mt-0.5">{summary.totalHours.toFixed(1)}h / {summary.weeklyCapacity}h</div>
        </div>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); onSendSchedule(resource); }}
            data-testid={`send-schedule-${resource.id}`}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Skicka schema till {resource.name}</TooltipContent>
      </Tooltip>
    </div>
  );
});
