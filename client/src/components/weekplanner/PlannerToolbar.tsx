import { memo, useState } from "react";
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
import { ChevronLeft, ChevronRight, Plus, AlertTriangle, Sparkles, Undo2, Redo2, CalendarDays, Calendar, CalendarRange, Clock, MapPin, Navigation, Wand2, TrendingUp, Activity, UsersRound, ZoomIn, ZoomOut, Trash2, ArrowRight, ChevronDown, ChevronUp, Crosshair, ExternalLink } from "lucide-react";
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
  onUrgentJob?: () => void;
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
    onAddJob, onAutoFill, onClearAll, onCarryOver, onUrgentJob, showAIPanel, onToggleAIPanel,
    weekGoals, weekTravelTotal,
    visibleDates, getResourceDayHours,
    jobConflictCount, filteredScheduledCount, unscheduledCount,
  } = props;

  const [showCapacity, setShowCapacity] = useState(false);
  const [showGoals, setShowGoals] = useState(false);

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
      <div className="flex items-center gap-1.5 px-2 py-1 border-b h-12" data-testid="planner-toolbar">
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onNavigate("prev")} data-testid="button-nav-prev">
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Föregående</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onGoToday} data-testid="button-today">
                <Crosshair className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Idag</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onNavigate("next")} data-testid="button-nav-next">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Nästa</TooltipContent>
          </Tooltip>
        </div>

        <h2 className="text-sm font-semibold truncate min-w-0" data-testid="text-header-label">{headerLabel}</h2>

        <div className="flex items-center gap-0.5 ml-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onUndo} disabled={undoCount === 0} data-testid="button-undo">
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ångra (Ctrl+Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRedo} disabled={redoCount === 0} data-testid="button-redo">
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Gör om (Ctrl+Y)</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-6 mx-1" />

        <div className="flex items-center gap-1 shrink-0">
          {viewMode !== "route" && (
            <div className="flex items-center gap-0.5 border rounded px-0.5" data-testid="zoom-controls">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-6 w-6" disabled={zoomLevel === 0} onClick={() => setZoomLevel(Math.max(0, zoomLevel - 1))} data-testid="button-zoom-out">
                    <ZoomOut className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zooma ut</TooltipContent>
              </Tooltip>
              <span className="text-[10px] text-muted-foreground w-10 text-center cursor-pointer select-none" onClick={() => setZoomLevel(1)} data-testid="text-zoom-level">
                {zoom.label}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-6 w-6" disabled={zoomLevel === zoomLevels.length - 1} onClick={() => setZoomLevel(Math.min(zoomLevels.length - 1, zoomLevel + 1))} data-testid="button-zoom-in">
                    <ZoomIn className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zooma in</TooltipContent>
              </Tooltip>
            </div>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 relative" data-testid="button-resource-filter">
                    <UsersRound className="h-4 w-4" />
                    {hiddenResourceIds.size > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center px-0.5">{visibleResources.length}/{resources.length}</span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Filtrera resurser</TooltipContent>
              </Tooltip>
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

          <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && onViewModeChange(v as ViewMode)} className="h-8" data-testid="toggle-view-mode">
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem value="day" aria-label="Dagvy (1)" className="h-7 w-7 p-0" data-testid="toggle-day">
                  <CalendarDays className="h-3.5 w-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Dagvy (1)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem value="week" aria-label="Veckovy (2)" className="h-7 w-7 p-0" data-testid="toggle-week">
                  <CalendarRange className="h-3.5 w-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Veckovy (2)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem value="month" aria-label="Månadsvy (3)" className="h-7 w-7 p-0" data-testid="toggle-month">
                  <Calendar className="h-3.5 w-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Månadsvy (3)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem value="route" aria-label="Ruttvy" className="h-7 w-7 p-0" data-testid="toggle-route">
                  <MapPin className="h-3.5 w-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Ruttvy</TooltipContent>
            </Tooltip>
          </ToggleGroup>

          <Separator orientation="vertical" className="h-6 mx-0.5" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="default" size="icon" className="h-8 w-8" onClick={() => onAddJob?.()} data-testid="button-add-job">
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Nytt jobb (N)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={onAutoFill} data-testid="button-auto-fill-week">
                <Wand2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fyll veckan (F)</TooltipContent>
          </Tooltip>
          {onCarryOver && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={onCarryOver} data-testid="button-carry-over">
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Flytta oavslutade</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={onClearAll} data-testid="button-clear-all-scheduled">
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rensa all planering</TooltipContent>
          </Tooltip>
          {onUrgentJob && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30" onClick={onUrgentJob} data-testid="button-urgent-job">
                  <AlertTriangle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Akut jobb</TooltipContent>
            </Tooltip>
          )}

          <Separator orientation="vertical" className="h-6 mx-0.5" />

          {viewMode === "week" && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className={`h-7 w-7 ${showCapacity ? "bg-accent" : ""}`} onClick={() => setShowCapacity(!showCapacity)} data-testid="button-toggle-capacity">
                    <Activity className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Visa/dölj kapacitet</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className={`h-7 w-7 ${showGoals ? "bg-accent" : ""}`} onClick={() => setShowGoals(!showGoals)} data-testid="button-toggle-goals">
                    <TrendingUp className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Visa/dölj veckomål</TooltipContent>
              </Tooltip>
            </>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.open("/planering/popout", "traivo-planner", "width=1400,height=900,menubar=no,toolbar=no,location=no,status=no")} data-testid="button-popout-planner">
                <ExternalLink className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Öppna i eget fönster</TooltipContent>
          </Tooltip>

          {onToggleAIPanel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant={showAIPanel ? "default" : "ghost"} size="icon" className="h-8 w-8" onClick={onToggleAIPanel} data-testid="button-toggle-ai-panel">
                  <Sparkles className="h-4 w-4 text-purple-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>AI-stöd</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {showCapacity && viewMode === "week" && (
        <div className="px-3 py-1.5 border-b bg-muted/20">
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
                <div key={resource.id} className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-background border">
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

      {showGoals && viewMode === "week" && (
        <div className="px-3 py-1.5 border-b bg-muted/10">
          <div className="flex items-center gap-4 text-xs flex-wrap" data-testid="goal-bars">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium text-muted-foreground">Veckomål:</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 min-w-[120px]" data-testid="goal-bar-time">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground w-5">Tid</span>
                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full transition-all rounded-full ${getGoalColor(weekGoals.time.pct)}`} style={{ width: `${Math.min(weekGoals.time.pct, 100)}%` }} />
                  </div>
                  <span className={`font-semibold tabular-nums ${getGoalTextColor(weekGoals.time.pct)}`}>{weekGoals.time.pct}%</span>
                </div>
              </TooltipTrigger>
              <TooltipContent><p>{weekGoals.time.current.toFixed(1)}h av {weekGoals.time.target}h planerat</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 min-w-[120px]" data-testid="goal-bar-economy">
                  <TrendingUp className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground w-8">Ekon.</span>
                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full transition-all rounded-full ${getGoalColor(weekGoals.economy.pct)}`} style={{ width: `${Math.min(weekGoals.economy.pct, 100)}%` }} />
                  </div>
                  <span className={`font-semibold tabular-nums ${getGoalTextColor(weekGoals.economy.pct)}`}>{weekGoals.economy.pct}%</span>
                </div>
              </TooltipTrigger>
              <TooltipContent><p>{(weekGoals.economy.current / 100).toLocaleString("sv-SE")} kr av {(weekGoals.economy.target / 100).toLocaleString("sv-SE")} kr budget</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 min-w-[120px]" data-testid="goal-bar-count">
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground w-7">Antal</span>
                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
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
      )}
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
    <div className="px-3 py-1.5 border-t bg-muted/50 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 text-xs" data-testid="legend-block-categories">
        <span className="text-muted-foreground font-medium mr-1">Kategorier:</span>
        <div className="flex items-center gap-1"><span className="w-3 h-1.5 bg-green-500 rounded-sm"></span><span>Produktion</span></div>
        <div className="flex items-center gap-1"><span className="w-3 h-1.5 bg-yellow-400 rounded-sm"></span><span>Restid</span></div>
        <div className="flex items-center gap-1"><span className="w-3 h-1.5 bg-blue-400 rounded-sm"></span><span>Rast</span></div>
        <div className="flex items-center gap-1"><span className="w-3 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-sm"></span><span>Ledig</span></div>
        {jobConflictCount > 0 && (
          <>
            <span className="text-muted-foreground">|</span>
            <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" />
              <span>{jobConflictCount} konflikter</span>
            </div>
          </>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {filteredScheduledCount} schemalagda | {unscheduledCount} oschemalagda
      </div>
    </div>
  );
});
