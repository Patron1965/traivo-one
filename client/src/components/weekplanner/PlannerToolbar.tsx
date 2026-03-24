import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, Plus, AlertTriangle, Sparkles, Undo2, Redo2, CalendarDays, Calendar, CalendarRange, Clock, MapPin, Navigation, Wand2, TrendingUp, Activity, UsersRound, ZoomIn, ZoomOut, Trash2, ArrowRight } from "lucide-react";
import type { Resource, ResourceProfile, ResourceProfileAssignment } from "@shared/schema";
import type { ViewMode } from "./types";
import { zoomLevels } from "./types";

interface PlannerToolbarProps {
  viewMode: ViewMode;
  headerLabel: string;
  onNavigate: (dir: "prev" | "next") => void;
  onGoToday: () => void;
  onViewModeChange: (mode: ViewMode) => void;
  undoCount: number;
  redoCount: number;
  onUndo: () => void;
  onRedo: () => void;
  zoomLevel: number;
  setZoomLevel: (v: number) => void;
  resources: Resource[];
  visibleResources: Resource[];
  hiddenResourceIds: Set<string>;
  setHiddenResourceIds: (v: Set<string>) => void;
  onAddJob?: () => void;
  onAutoFill: () => void;
  onClearAll: () => void;
  onCarryOver?: () => void;
  showAIPanel?: boolean;
  onToggleAIPanel?: () => void;
  weekGoals: {
    time: { current: number; target: number; pct: number };
    economy: { current: number; target: number; pct: number };
    count: { current: number; target: number; pct: number };
  };
  weekTravelTotal: { minutes: number; km: number; hours: number };
  resourceCapacities?: Array<{ resource: Resource; utilization: number }>;
  visibleDates: Date[];
  getResourceDayHours: (resourceId: string, day: Date) => number;
  jobConflictCount: number;
  filteredScheduledCount: number;
  unscheduledCount: number;
}

const getGoalColor = (pct: number) => {
  if (pct >= 80) return "bg-green-500";
  if (pct >= 50) return "bg-yellow-500";
  return "bg-red-500";
};

const getGoalTextColor = (pct: number) => {
  if (pct >= 80) return "text-green-600 dark:text-green-400";
  if (pct >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
};

export const PlannerToolbar = memo(function PlannerToolbar(props: PlannerToolbarProps) {
  const {
    viewMode, headerLabel, onNavigate, onGoToday, onViewModeChange,
    undoCount, redoCount, onUndo, onRedo,
    zoomLevel, setZoomLevel,
    resources, visibleResources, hiddenResourceIds, setHiddenResourceIds,
    onAddJob, onAutoFill, onClearAll, onCarryOver, showAIPanel, onToggleAIPanel,
    weekGoals, weekTravelTotal,
    visibleDates, getResourceDayHours,
    jobConflictCount, filteredScheduledCount, unscheduledCount,
  } = props;

  const { data: profiles = [] } = useQuery<ResourceProfile[]>({ queryKey: ["/api/resource-profiles"] });
  const { data: profileAssignments = [] } = useQuery<ResourceProfileAssignment[]>({
    queryKey: ["/api/resource-profiles", "all-assignments"],
    queryFn: async () => {
      if (!profiles.length) return [];
      const results = await Promise.all(profiles.map(p => fetch(`/api/resource-profiles/${p.id}/resources`).then(r => r.json())));
      return results.flat();
    },
    enabled: profiles.length > 0,
  });

  const filterByProfile = (profileId: string) => {
    const assignedResourceIds = profileAssignments.filter(a => a.profileId === profileId).map(a => a.resourceId);
    const newHidden = new Set<string>();
    resources.forEach(r => { if (!assignedResourceIds.includes(r.id)) newHidden.add(r.id); });
    setHiddenResourceIds(newHidden);
  };

  const zoom = zoomLevels[zoomLevel];

  return (
    <>
      <div className="flex items-center gap-2 p-3 border-b flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => onNavigate("prev")} data-testid="button-nav-prev">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={onGoToday} data-testid="button-today">Idag</Button>
            <Button variant="outline" size="icon" onClick={() => onNavigate("next")} data-testid="button-nav-next">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="text-lg font-semibold truncate" data-testid="text-header-label">{headerLabel}</h2>
          <div className="flex items-center gap-1 ml-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onUndo} disabled={undoCount === 0} data-testid="button-undo">
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Ångra (Ctrl+Z)</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onRedo} disabled={redoCount === 0} data-testid="button-redo">
                  <Redo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Gör om (Ctrl+Y)</p></TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {viewMode !== "route" && (
            <div className="flex items-center gap-1 border rounded-md px-1" data-testid="zoom-controls">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={zoomLevel === 0} onClick={() => setZoomLevel(Math.max(0, zoomLevel - 1))} data-testid="button-zoom-out">
                    <ZoomOut className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zooma ut</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] text-muted-foreground w-12 text-center cursor-pointer select-none" onClick={() => setZoomLevel(1)} data-testid="text-zoom-level">
                    {zoom.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Klicka för att återställa zoom</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={zoomLevel === zoomLevels.length - 1} onClick={() => setZoomLevel(Math.min(zoomLevels.length - 1, zoomLevel + 1))} data-testid="button-zoom-in">
                    <ZoomIn className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zooma in</TooltipContent>
              </Tooltip>
            </div>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5" data-testid="button-resource-filter">
                <UsersRound className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Resurser</span>
                {hiddenResourceIds.size > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">{visibleResources.length}/{resources.length}</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="end" data-testid="popover-resource-filter">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Filtrera resurser</span>
                {hiddenResourceIds.size > 0 && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setHiddenResourceIds(new Set())} data-testid="button-show-all-resources">
                    Visa alla
                  </Button>
                )}
              </div>
              {profiles.length > 0 && (
                <>
                  <div className="text-xs text-muted-foreground mb-1">Filtrera per profil</div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {profiles.map(p => (
                      <Badge key={p.id} variant="outline" className="cursor-pointer text-[10px] px-1.5 py-0.5 hover:bg-accent" style={{ borderColor: p.color || undefined }} onClick={() => filterByProfile(p.id)} data-testid={`button-filter-profile-${p.id}`}>
                        <span className="w-2 h-2 rounded-full mr-1 inline-block" style={{ backgroundColor: p.color || "#3B82F6" }} />
                        {p.name}
                      </Badge>
                    ))}
                  </div>
                  <Separator className="mb-2" />
                </>
              )}
              <ScrollArea className="max-h-64">
                <div className="space-y-1">
                  {resources.map((resource) => (
                    <label key={resource.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer" data-testid={`resource-filter-${resource.id}`}>
                      <Checkbox
                        checked={!hiddenResourceIds.has(resource.id)}
                        onCheckedChange={(checked) => {
                          setHiddenResourceIds((() => {
                            const next = new Set(hiddenResourceIds);
                            if (checked) { next.delete(resource.id); } else { next.add(resource.id); }
                            return next;
                          })());
                        }}
                      />
                      <Avatar className="h-5 w-5 shrink-0">
                        <AvatarFallback className="text-[10px]">{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                      </Avatar>
                      <span className="text-xs truncate">{resource.name}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
          <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && onViewModeChange(v as ViewMode)} data-testid="toggle-view-mode">
            <ToggleGroupItem value="day" aria-label="Dagvy" data-testid="toggle-day">
              <CalendarDays className="h-4 w-4 mr-1" /><span className="hidden sm:inline">Dag</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="week" aria-label="Veckovy" data-testid="toggle-week">
              <CalendarRange className="h-4 w-4 mr-1" /><span className="hidden sm:inline">Vecka</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="month" aria-label="Månadsvy" data-testid="toggle-month">
              <Calendar className="h-4 w-4 mr-1" /><span className="hidden sm:inline">Månad</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="route" aria-label="Ruttvy" data-testid="toggle-route">
              <MapPin className="h-4 w-4 mr-1" /><span className="hidden sm:inline">Rutt</span>
            </ToggleGroupItem>
          </ToggleGroup>
          <Button onClick={() => onAddJob?.()} data-testid="button-add-job">
            <Plus className="h-4 w-4 mr-2" />Nytt jobb
          </Button>
          <Button variant="outline" onClick={onAutoFill} data-testid="button-auto-fill-week">
            <Wand2 className="h-4 w-4 mr-2" />Fyll veckan
          </Button>
          {onCarryOver && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" onClick={onCarryOver} data-testid="button-carry-over">
                  <ArrowRight className="h-4 w-4 mr-2" />Flytta oavslutade
                </Button>
              </TooltipTrigger>
              <TooltipContent>Flytta gårdagens oavslutade jobb till idag</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="text-destructive hover:bg-destructive/10" onClick={onClearAll} data-testid="button-clear-all-scheduled">
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rensa all planering för {viewMode === "month" ? "denna månad" : viewMode === "day" ? "denna dag" : "denna vecka"}</TooltipContent>
          </Tooltip>
          {onToggleAIPanel && (
            <Button variant={showAIPanel ? "default" : "ghost"} onClick={onToggleAIPanel} data-testid="button-toggle-ai-panel">
              <Sparkles className="h-4 w-4 mr-2 text-purple-500" />AI stöd
            </Button>
          )}
        </div>
      </div>

      {viewMode === "week" && (
        <div className="px-4 py-2 border-b bg-muted/20">
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">Kapacitet:</span>
            </div>
            {resources.slice(0, 6).map((resource) => {
              const weekHours = visibleDates.reduce((sum, day) => sum + getResourceDayHours(resource.id, day), 0);
              const weekCapacity = resource.weeklyHours || 40;
              const utilization = Math.round((weekHours / weekCapacity) * 100);
              const isOverbooked = utilization > 100;
              const isLow = utilization < 50;
              return (
                <div key={resource.id} className="flex items-center gap-1.5 px-2 py-1 rounded bg-background border">
                  <span className="font-medium">{resource.initials || resource.name.split(" ")[0]}</span>
                  <div className="w-12 h-1.5 bg-muted rounded overflow-hidden">
                    <div className={`h-full transition-all ${isOverbooked ? "bg-red-500" : isLow ? "bg-yellow-500" : "bg-green-500"}`} style={{ width: `${Math.min(utilization, 100)}%` }} />
                  </div>
                  <span className={`${isOverbooked ? "text-red-600" : isLow ? "text-yellow-600" : "text-green-600"}`}>{utilization}%</span>
                </div>
              );
            })}
            {resources.length > 6 && <span className="text-muted-foreground">+{resources.length - 6} till</span>}
          </div>
        </div>
      )}

      <div className="px-4 py-2 border-b bg-muted/10">
        <div className="flex items-center gap-6 text-xs flex-wrap" data-testid="goal-bars">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium text-muted-foreground">Veckomål:</span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 min-w-[140px]" data-testid="goal-bar-time">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground w-6">Tid</span>
                <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full transition-all rounded-full ${getGoalColor(weekGoals.time.pct)}`} style={{ width: `${Math.min(weekGoals.time.pct, 100)}%` }} />
                </div>
                <span className={`font-semibold tabular-nums ${getGoalTextColor(weekGoals.time.pct)}`}>{weekGoals.time.pct}%</span>
              </div>
            </TooltipTrigger>
            <TooltipContent><p>{weekGoals.time.current.toFixed(1)}h av {weekGoals.time.target}h planerat</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 min-w-[140px]" data-testid="goal-bar-economy">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground w-10">Ekon.</span>
                <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full transition-all rounded-full ${getGoalColor(weekGoals.economy.pct)}`} style={{ width: `${Math.min(weekGoals.economy.pct, 100)}%` }} />
                </div>
                <span className={`font-semibold tabular-nums ${getGoalTextColor(weekGoals.economy.pct)}`}>{weekGoals.economy.pct}%</span>
              </div>
            </TooltipTrigger>
            <TooltipContent><p>{(weekGoals.economy.current / 100).toLocaleString("sv-SE")} kr av {(weekGoals.economy.target / 100).toLocaleString("sv-SE")} kr budget</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 min-w-[140px]" data-testid="goal-bar-count">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground w-8">Antal</span>
                <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full transition-all rounded-full ${getGoalColor(weekGoals.count.pct)}`} style={{ width: `${Math.min(weekGoals.count.pct, 100)}%` }} />
                </div>
                <span className={`font-semibold tabular-nums ${getGoalTextColor(weekGoals.count.pct)}`}>{weekGoals.count.pct}%</span>
              </div>
            </TooltipTrigger>
            <TooltipContent><p>{weekGoals.count.current} av {weekGoals.count.target} stopp planerade</p></TooltipContent>
          </Tooltip>
          {weekTravelTotal.minutes > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800" data-testid="goal-bar-travel">
                  <Navigation className="h-3 w-3" />
                  <span className="font-medium">{weekTravelTotal.hours}h</span>
                  <span className="text-yellow-500">({weekTravelTotal.km} km)</span>
                </div>
              </TooltipTrigger>
              <TooltipContent><p>Total restid veckan: {weekTravelTotal.minutes} min, {weekTravelTotal.km} km</p></TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </>
  );
});

export const PlannerFooter = memo(function PlannerFooter({
  jobConflictCount,
  filteredScheduledCount,
  unscheduledCount,
}: {
  jobConflictCount: number;
  filteredScheduledCount: number;
  unscheduledCount: number;
}) {
  return (
    <div className="p-3 border-t bg-muted/50 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-4 text-xs" data-testid="legend-block-categories">
        <span className="text-muted-foreground font-medium mr-1">Kategorier:</span>
        <div className="flex items-center gap-1.5"><span className="w-3 h-1.5 bg-green-500 rounded-sm"></span><span>Produktion</span></div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-1.5 bg-yellow-400 rounded-sm"></span><span>Restid</span></div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-1.5 bg-blue-400 rounded-sm"></span><span>Egentid</span></div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-sm"></span><span>Ledig</span></div>
        <span className="text-muted-foreground mx-1">|</span>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-red-500 rounded-full"></span><span>Akut</span></div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-orange-500 rounded-full"></span><span>Hög</span></div>
        {jobConflictCount > 0 && (
          <>
            <span className="text-muted-foreground mx-1">|</span>
            <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" />
              <span>{jobConflictCount} konflikter</span>
            </div>
          </>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {filteredScheduledCount} schemalagda | {unscheduledCount} oschemalagda | Dra jobb för att schemalägga
      </div>
    </div>
  );
});
