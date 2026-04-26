import { memo, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Send, CheckCircle2, AlertCircle } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, ResourceProfile, ResourceProfileAssignment } from "@shared/schema";

interface ResourceColumnProps {
  resource: Resource;
  summary?: { totalHours: number; weeklyCapacity: number; pct: number };
  onResourceClick: (resourceId: string) => void;
  onSendSchedule: (resource: Resource) => void;
  isClusterMatch?: boolean;
  /** Period currently shown in the planner — used to color the publish indicator. */
  currentPeriod?: { start: string; end: string };
}

export const ResourceColumn = memo(function ResourceColumn({ resource, summary, onResourceClick, onSendSchedule, isClusterMatch, currentPeriod }: ResourceColumnProps) {
  const { data: profiles = [] } = useQuery<ResourceProfile[]>({ queryKey: ["/api/resource-profiles"] });
  const { data: assignments = [] } = useQuery<ResourceProfileAssignment[]>({
    queryKey: ["/api/resource-profiles", "all-assignments"],
    queryFn: async () => {
      if (!profiles.length) return [];
      const results = await Promise.all(profiles.map(p => fetch(`/api/resource-profiles/${p.id}/resources`).then(r => r.json())));
      return results.flat();
    },
    enabled: profiles.length > 0,
  });

  const resourceProfiles = assignments
    .filter(a => a.resourceId === resource.id)
    .map(a => profiles.find(p => p.id === a.profileId))
    .filter(Boolean) as ResourceProfile[];

  return (
    <div
      className={`p-2 border-r cursor-pointer hover:bg-muted/60 transition-colors group flex flex-col justify-between ${isClusterMatch ? "bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-400/50 dark:ring-emerald-500/40" : "bg-muted/30"}`}
      onClick={() => onResourceClick(resource.id)}
      data-testid={`resource-cell-${resource.id}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <Avatar className="h-6 w-6 shrink-0">
          <AvatarFallback className="text-[10px]">{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs font-medium truncate block">{resource.name}</span>
            </TooltipTrigger>
            <TooltipContent side="right">{resource.name}</TooltipContent>
          </Tooltip>
          {resourceProfiles.length > 0 && (
            <div className="flex gap-0.5 mt-0.5">
              {resourceProfiles.map(p => (
                <Tooltip key={p.id}>
                  <TooltipTrigger asChild>
                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color || "#3B82F6" }} data-testid={`profile-dot-${resource.id}-${p.id}`} />
                  </TooltipTrigger>
                  <TooltipContent>{p.name}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
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
      {(() => {
        const lastPublishedAt = resource.lastSchedulePublishedAt ? new Date(resource.lastSchedulePublishedAt as any) : null;
        const periodMatchesCurrent = currentPeriod
          && resource.lastSchedulePeriodStart === currentPeriod.start
          && resource.lastSchedulePeriodEnd === currentPeriod.end;
        const hoursAgo = lastPublishedAt ? differenceInHours(new Date(), lastPublishedAt) : null;
        const fresh = lastPublishedAt && periodMatchesCurrent && (hoursAgo ?? 999) < 24;
        const stale = lastPublishedAt && periodMatchesCurrent && !fresh;
        const neverPublished = !lastPublishedAt || !periodMatchesCurrent;

        const indicatorClass = fresh
          ? "text-green-600 dark:text-green-400"
          : stale
            ? "text-amber-600 dark:text-amber-400"
            : "text-red-600 dark:text-red-400";

        const labelText = lastPublishedAt && periodMatchesCurrent
          ? `Skickat ${format(lastPublishedAt, "EEE HH:mm", { locale: sv })}`
          : "Ej skickat";

        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={`flex items-center gap-1 mt-1 text-[9px] ${indicatorClass}`}
                onClick={(e) => { e.stopPropagation(); onSendSchedule(resource); }}
                data-testid={`indicator-published-${resource.id}`}
              >
                {neverPublished ? <AlertCircle className="h-2.5 w-2.5" /> : <CheckCircle2 className="h-2.5 w-2.5" />}
                <span className="truncate">{labelText}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {lastPublishedAt
                ? `${periodMatchesCurrent ? "Aktuell period publicerad" : "Senaste publicering avsåg en annan period"} — ${format(lastPublishedAt, "d MMM yyyy HH:mm", { locale: sv })}`
                : "Schemat för denna period har inte publicerats än"}
            </TooltipContent>
          </Tooltip>
        );
      })()}
      <div className="mt-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-full text-[10px] gap-1 px-2"
          onClick={(e) => { e.stopPropagation(); onSendSchedule(resource); }}
          data-testid={`send-schedule-${resource.id}`}
        >
          <Send className="h-3 w-3" />
          Skicka
        </Button>
      </div>
    </div>
  );
});
