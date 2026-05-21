import { memo, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { AlertTriangle, Plus, Navigation, Cloud, Sun, CloudRain, Snowflake, ShieldAlert, ShieldCheck, ShieldX, EyeOff, ChevronDown, ChevronRight, Trash2, UserPlus, Loader2, Repeat, Users } from "lucide-react";
import { format, isSameDay } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrderWithObject, ObjectTimeRestriction } from "@shared/schema";
import { HOURS_IN_DAY, getJobCategory, haversineDistance } from "./types";
import type { WeatherImpactDay, WeatherForecastData, ConstraintCell } from "./types";
import { constraintCategoryLabels } from "./types";
import { DroppableCell, DraggableJobCard } from "./DndComponents";
import { JobCard } from "./JobCard";
import { ResourceColumn } from "./ResourceColumn";

interface TeamRow {
  id: string;
  name: string;
  color: string | null;
  isUncategorized: boolean;
  isResourceFallback?: boolean;
  resourceId?: string | null;
  memberCount: number;
}

interface WeekGridViewProps {
  visibleDates: Date[];
  visibleResources: Resource[];
  filterBar?: React.ReactNode;
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
  dragOverConflicts?: Record<string, string[]>;
  clusterMatchedResourceIds?: Set<string>;
  showConstraintLayer?: boolean;
  constraintMap?: Map<string, ConstraintCell>;
  remoteDragActive?: boolean;
  remoteHoveredDropId?: string | null;
  currentPeriod?: { start: string; end: string };
  rowMode?: "team" | "resource";
  teamRows?: TeamRow[];
  getJobsForTeamAndDay?: (teamId: string, day: Date) => WorkOrderWithObject[];
  getTeamDayHours?: (teamId: string, day: Date) => number;
  teamWeekSummary?: Record<string, { totalHours: number; weeklyCapacity: number; pct: number }>;
  hiddenUntiedTeamSummary?: { fallbackResources: number; fallbackJobs: number; uncategorizedJobs: number; totalJobs: number } | null;
  showingUntiedUnderFilter?: boolean;
  onShowUntiedTeamRows?: () => void;
  onHideUntiedTeamRows?: () => void;
  allResources?: Resource[];
  teamMembersData?: Array<{ id: string; teamId: string; resourceId: string; role: string | null }>;
}

type TeamMemberRow = { id: string; teamId: string; resourceId: string; role: string | null };

function deriveInitials(r: Resource | undefined, fallback: string) {
  if (r?.initials) return r.initials.slice(0, 2).toUpperCase();
  const name = r?.name ?? fallback;
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || name.slice(0, 2).toUpperCase();
}

function ResourcePicker({
  candidates,
  triggerLabel,
  triggerIcon,
  triggerTestId,
  triggerAriaLabel,
  triggerVariant = "outline",
  triggerClassName,
  disabled,
  onSelect,
  emptyText = "Inga lediga resurser",
}: {
  candidates: Resource[];
  triggerLabel?: string;
  triggerIcon: React.ReactNode;
  triggerTestId: string;
  triggerAriaLabel: string;
  triggerVariant?: "outline" | "ghost" | "default";
  triggerClassName?: string;
  disabled?: boolean;
  onSelect: (resourceId: string) => void;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={triggerVariant}
          size={triggerLabel ? "sm" : "icon"}
          className={triggerClassName ?? (triggerLabel ? "h-7 text-xs" : "h-7 w-7")}
          disabled={disabled}
          data-testid={triggerTestId}
          aria-label={triggerAriaLabel}
        >
          {triggerIcon}
          {triggerLabel ? <span className="ml-1">{triggerLabel}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Sök resurs…" data-testid={`${triggerTestId}-input`} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {candidates.length > 0 && (
              <CommandGroup heading="Resurser utan team">
                {candidates.map(r => (
                  <CommandItem
                    key={r.id}
                    value={`${r.name} ${r.email ?? ""}`}
                    onSelect={() => { onSelect(r.id); setOpen(false); }}
                    data-testid={`${triggerTestId}-option-${r.id}`}
                  >
                    <span className="h-5 w-5 rounded-full bg-primary/15 text-primary text-[10px] font-semibold flex items-center justify-center mr-2 shrink-0">
                      {deriveInitials(r, r.name)}
                    </span>
                    <span className="truncate">{r.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function TeamMemberPanel({
  teamId,
  teamName,
  freeResources,
  resourcesById,
}: {
  teamId: string;
  teamName: string;
  freeResources: Resource[];
  resourcesById: Map<string, Resource>;
}) {
  const { toast } = useToast();
  const { data: members = [], isLoading } = useQuery<TeamMemberRow[]>({
    queryKey: ["/api/team-members", teamId],
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/team-members"] });
    queryClient.invalidateQueries({ queryKey: ["/api/team-members", teamId] });
  };

  const removeMutation = useMutation({
    mutationFn: async (memberId: string) => {
      await apiRequest("DELETE", `/api/team-member/${memberId}`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Resurs borttagen från team" });
    },
    onError: (err) => {
      toast({ title: "Kunde inte ta bort resurs", description: err instanceof Error ? err.message : "Försök igen", variant: "destructive" });
    },
  });

  const addMutation = useMutation({
    mutationFn: async (resourceId: string) => {
      await apiRequest("POST", `/api/team-members/${teamId}`, { resourceId, role: "medlem" });
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Resurs tillagd i team" });
    },
    onError: (err) => {
      toast({ title: "Kunde inte lägga till resurs", description: err instanceof Error ? err.message : "Försök igen", variant: "destructive" });
    },
  });

  const replaceMutation = useMutation({
    mutationFn: async ({ memberId, newResourceId }: { memberId: string; newResourceId: string }) => {
      await apiRequest("DELETE", `/api/team-member/${memberId}`);
      try {
        await apiRequest("POST", `/api/team-members/${teamId}`, { resourceId: newResourceId, role: "medlem" });
      } catch (postErr) {
        // Rollback: try to recreate the deleted membership so we don't leave the team short-handed.
        const original = members.find(m => m.id === memberId);
        if (original) {
          try {
            await apiRequest("POST", `/api/team-members/${teamId}`, { resourceId: original.resourceId, role: original.role ?? "medlem" });
          } catch {
            // Surface combined failure below.
          }
        }
        throw postErr;
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Resurs utbytt" });
    },
    onError: (err) => {
      invalidateAll();
      toast({
        title: "Kunde inte byta ut resurs",
        description: err instanceof Error ? `${err.message}. Tidigare medlemskap har återställts om möjligt.` : "Försök igen",
        variant: "destructive",
      });
    },
  });

  const memberResourceIds = useMemo(() => new Set(members.map(m => m.resourceId)), [members]);
  const candidatesForAdd = useMemo(
    () => freeResources.filter(r => !memberResourceIds.has(r.id)),
    [freeResources, memberResourceIds],
  );

  return (
    <div className="px-3 py-2 bg-muted/40 border-b" data-testid={`panel-team-members-${teamId}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>Medlemmar i {teamName}</span>
          <span className="tabular-nums">({members.length})</span>
        </div>
        <ResourcePicker
          candidates={candidatesForAdd}
          triggerLabel="Lägg till medlem"
          triggerIcon={<UserPlus className="h-3.5 w-3.5" />}
          triggerTestId={`button-add-team-member-${teamId}`}
          triggerAriaLabel="Lägg till medlem"
          disabled={addMutation.isPending || candidatesForAdd.length === 0}
          onSelect={(rid) => addMutation.mutate(rid)}
        />
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Hämtar medlemmar…
        </div>
      ) : members.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">Teamet har inga medlemmar än.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
          {members.map(m => {
            const r = resourcesById.get(m.resourceId);
            const name = r?.name ?? "Okänd resurs";
            const role = m.role && m.role !== "medlem" ? m.role : (r?.resourceType ?? "");
            const removingThis = removeMutation.isPending && removeMutation.variables === m.id;
            const replacingThis = replaceMutation.isPending && replaceMutation.variables?.memberId === m.id;
            return (
              <li
                key={m.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-background border"
                data-testid={`row-team-member-${m.id}`}
              >
                <span className="h-7 w-7 rounded-full bg-primary/15 text-primary text-[11px] font-semibold flex items-center justify-center shrink-0">
                  {deriveInitials(r, name)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate" title={name}>{name}</div>
                  {role && (
                    <div className="text-[10px] text-muted-foreground truncate capitalize">{role}</div>
                  )}
                </div>
                <ResourcePicker
                  candidates={candidatesForAdd}
                  triggerIcon={replacingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5" />}
                  triggerTestId={`button-replace-team-member-${m.id}`}
                  triggerAriaLabel={`Byt ut ${name}`}
                  triggerVariant="ghost"
                  disabled={replaceMutation.isPending || removeMutation.isPending || candidatesForAdd.length === 0}
                  onSelect={(newRid) => replaceMutation.mutate({ memberId: m.id, newResourceId: newRid })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  disabled={removingThis || replaceMutation.isPending}
                  onClick={() => removeMutation.mutate(m.id)}
                  data-testid={`button-remove-team-member-${m.id}`}
                  aria-label={`Ta bort ${name}`}
                >
                  {removingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function getWeatherIcon(code: number) {
  if ([0, 1].includes(code)) return <Sun className="h-3 w-3 text-chart-3" />;
  if ([2, 3].includes(code)) return <Cloud className="h-3 w-3 text-muted-foreground" />;
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return <CloudRain className="h-3 w-3 text-chart-1" />;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return <Snowflake className="h-3 w-3 text-chart-1" />;
  return <Cloud className="h-3 w-3 text-muted-foreground" />;
}

function getWeatherMultiplierLabel(multiplier: number) {
  if (multiplier >= 1.0) return null;
  const pctIncrease = Math.round((1 / multiplier - 1) * 100);
  return `+${pctIncrease}% tid`;
}

export const WeekGridView = memo(function WeekGridView(props: WeekGridViewProps) {
  const {
    visibleDates, visibleResources, filterBar, getJobsForResourceAndDay, getResourceDayHours,
    getCapacityPercentage, getCapacityColor, getCapacityBgColor, getDropFitClass,
    activeDragJob, restrictionsByObject, resourceWeekSummary, zoom, weatherByDate,
    onResourceClick, onSendSchedule, jobCardProps, dragOverConflicts, clusterMatchedResourceIds,
    showConstraintLayer, constraintMap, remoteDragActive, remoteHoveredDropId,
    rowMode = "resource", teamRows = [], getJobsForTeamAndDay, getTeamDayHours, teamWeekSummary,
    hiddenUntiedTeamSummary, showingUntiedUnderFilter, onShowUntiedTeamRows, onHideUntiedTeamRows,
    allResources = [], teamMembersData = [],
  } = props;

  const { user } = useAuth();
  const fallbackStorageKey = `planner.fallbackRows.expanded.${user?.tenantId ?? "anon"}`;

  const resourcesById = useMemo(() => {
    const m = new Map<string, Resource>();
    for (const r of allResources) m.set(r.id, r);
    return m;
  }, [allResources]);

  const tiedResourceIds = useMemo(() => {
    const s = new Set<string>();
    for (const tm of teamMembersData) s.add(tm.resourceId);
    return s;
  }, [teamMembersData]);

  const freeResources = useMemo(
    () => allResources.filter(r => !tiedResourceIds.has(r.id)).sort((a, b) => a.name.localeCompare(b.name, "sv")),
    [allResources, tiedResourceIds],
  );

  const { regularTeamRows, fallbackTeamRows } = useMemo(() => {
    const regular: TeamRow[] = [];
    const fallback: TeamRow[] = [];
    for (const t of teamRows) {
      if (t.isResourceFallback) fallback.push(t);
      else regular.push(t);
    }
    return { regularTeamRows: regular, fallbackTeamRows: fallback };
  }, [teamRows]);

  const fallbackJobCount = useMemo(() => {
    if (!getJobsForTeamAndDay || fallbackTeamRows.length === 0) return 0;
    let total = 0;
    for (const t of fallbackTeamRows) {
      for (const d of visibleDates) total += getJobsForTeamAndDay(t.id, d).length;
    }
    return total;
  }, [fallbackTeamRows, visibleDates, getJobsForTeamAndDay]);

  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [fallbackExpanded, setFallbackExpanded] = useState<boolean>(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(fallbackStorageKey);
      if (raw === "1") setFallbackExpanded(true);
      else if (raw === "0") setFallbackExpanded(false);
    } catch {
      // ignore
    }
  }, [fallbackStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(fallbackStorageKey, fallbackExpanded ? "1" : "0");
    } catch {
      // ignore
    }
  }, [fallbackStorageKey, fallbackExpanded]);

  const zoomPadClass = zoom.scale <= 0.5 ? "p-0.5" : zoom.scale >= 2 ? "p-4" : "p-2";
  const zoomGapClass = zoom.scale <= 0.5 ? "space-y-0" : zoom.scale >= 2 ? "space-y-3" : "space-y-1";

  const isTeamMode = rowMode === "team";
  const headerLabel = isTeamMode ? "Team" : "Resurser";

  const renderTeamRow = (team: TeamRow) => {
    const summary = teamWeekSummary?.[team.id];
    const pct = summary?.pct ?? 0;
    const isFallback = !!team.isResourceFallback;
    const dayCapacity = isFallback ? HOURS_IN_DAY : (team.memberCount || 1) * HOURS_IN_DAY;
    const canExpand = !isFallback && !team.isUncategorized;
    const isExpanded = canExpand && expandedTeamId === team.id;
    return (
      <div key={team.id}>
        <div className="grid grid-cols-[160px_repeat(5,minmax(0,1fr))] border-b" data-testid={`team-row-${team.id}`}>
          <div className="sticky left-0 bg-background z-10 p-3 border-r flex flex-col justify-between" style={{ minHeight: `${zoom.weekH}px` }}>
            <div className="flex items-center gap-2">
              {canExpand ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0 -ml-1"
                  onClick={(e) => { e.stopPropagation(); setExpandedTeamId(isExpanded ? null : team.id); }}
                  data-testid={`button-toggle-team-members-${team.id}`}
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? "Dölj medlemmar" : "Visa medlemmar"}
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </Button>
              ) : (
                <span className="h-5 w-5 shrink-0 -ml-1" aria-hidden />
              )}
              {team.color ? (
                <span className="h-6 w-6 rounded-full shrink-0 flex items-center justify-center" style={{ backgroundColor: team.color }} data-testid={`avatar-team-color-${team.id}`} />
              ) : !team.isUncategorized ? (
                <span
                  className={`h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold ring-1 ${isFallback ? "bg-warning/15 text-warning ring-warning/40 dark:bg-warning/20 dark:ring-warning/60" : "bg-primary/15 text-primary ring-primary/30 dark:bg-primary/20 dark:ring-primary/50"}`}
                  data-testid={`avatar-team-initials-${team.id}`}
                >
                  {team.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || team.name.slice(0, 2).toUpperCase()}
                </span>
              ) : null}
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium truncate ${team.isUncategorized ? "text-muted-foreground italic" : ""}`} data-testid={`text-team-name-${team.id}`}>{team.name}</div>
                {isFallback ? (
                  <div className="text-[10px] text-warning">Saknar team</div>
                ) : !team.isUncategorized ? (
                  <div className="text-[10px] text-muted-foreground">{team.memberCount} medlem{team.memberCount === 1 ? "" : "mar"}</div>
                ) : null}
              </div>
            </div>
            {summary && (
              <div className="mt-2">
                <div className="h-1.5 bg-muted-foreground/15 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${getCapacityColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">{summary.totalHours.toFixed(1)}h / {summary.weeklyCapacity}h</div>
              </div>
            )}
          </div>
          {visibleDates.map((day, dayIndex) => {
            const jobs = getJobsForTeamAndDay ? getJobsForTeamAndDay(team.id, day) : [];
            const dayHours = getTeamDayHours ? getTeamDayHours(team.id, day) : 0;
            const dayStr = format(day, "yyyy-MM-dd");
            const droppableId = isFallback && team.resourceId
              ? `${team.resourceId}|${dayStr}`
              : `team:${team.id}|${dayStr}`;
            const capacityPct = dayCapacity > 0 ? Math.round((dayHours / dayCapacity) * 100) : 0;
            const isOverbooked = dayHours > dayCapacity;
            let teamDropFit: { bg: string; label: string; color: string } | null = null;
            if (activeDragJob && !team.isUncategorized && (isFallback || team.memberCount > 0)) {
              const newHours = dayHours + (activeDragJob.estimatedDuration || 60) / 60;
              const projectedPct = dayCapacity > 0 ? (newHours / dayCapacity) * 100 : 0;
              if (projectedPct > 110) teamDropFit = { bg: "bg-destructive/15 dark:bg-destructive/15 ring-destructive/40", label: isFallback ? "Överbokar resursen" : "Överbokar teamet", color: "text-destructive" };
              else if (projectedPct > 85) teamDropFit = { bg: "bg-warning/15 dark:bg-warning/15 ring-warning/40", label: "Tight", color: "text-warning" };
              else if (projectedPct > 65) teamDropFit = { bg: "bg-chart-3/15 dark:bg-chart-3/15 ring-chart-3/40", label: "Belastad", color: "text-chart-3" };
              else teamDropFit = { bg: "bg-chart-2/15 dark:bg-chart-2/15 ring-chart-2/40", label: "Fri kapacitet", color: "text-chart-2" };
            }
            return (
              <DroppableCell
                key={dayIndex}
                id={droppableId}
                className={`${zoomPadClass} border-r last:border-r-0 transition-colors overflow-hidden min-w-0 ${getCapacityBgColor(capacityPct)}`}
                style={{ minHeight: `${zoom.weekH}px` }}
                dragOverConflicts={dragOverConflicts?.[droppableId]}
                dropFitInfo={teamDropFit}
                remoteDragActive={remoteDragActive}
                remoteHovered={remoteHoveredDropId === droppableId}
              >
                <div className="min-w-0 overflow-hidden" data-testid={isFallback ? `drop-zone-resource-fallback-${team.resourceId}-${dayStr}` : `drop-zone-team-${team.id}-${dayStr}`}>
                  <div className="flex items-center gap-1 mb-2">
                    <div className="h-2 flex-1 bg-muted-foreground/15 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${getCapacityColor(capacityPct)}`} style={{ width: `${Math.min(capacityPct, 100)}%` }} />
                    </div>
                    <span className={`text-[10px] tabular-nums ${isOverbooked ? "text-destructive font-semibold" : capacityPct >= 85 ? "text-warning" : "text-muted-foreground"}`}>
                      {dayHours.toFixed(1).replace(".", ",")}h
                    </span>
                  </div>
                  <div className={zoomGapClass}>
                    {jobs.length === 0 && (
                      <div className="flex items-center justify-center py-4 text-muted-foreground/70">
                        <Plus className="h-4 w-4" />
                      </div>
                    )}
                    {jobs.map((job) => (
                      <DraggableJobCard key={job.id} id={job.id}>
                        <JobCard job={job} compact {...jobCardProps} />
                      </DraggableJobCard>
                    ))}
                  </div>
                </div>
              </DroppableCell>
            );
          })}
        </div>
        {isExpanded && (
          <TeamMemberPanel
            teamId={team.id}
            teamName={team.name}
            freeResources={freeResources}
            resourcesById={resourcesById}
          />
        )}
      </div>
    );
  };
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {filterBar}
    <div className="flex-1 overflow-y-auto overflow-x-auto">
      <div className="w-full min-w-[700px]">
        <div className="grid grid-cols-[160px_repeat(5,minmax(0,1fr))] border-b sticky top-0 bg-background z-20">
          <div className="p-2 font-medium text-sm text-muted-foreground border-r sticky left-0 bg-background z-30" data-testid="week-grid-row-header">{headerLabel}</div>
          {visibleDates.map((day, i) => {
            const isToday = isSameDay(day, new Date());
            const dayStr = format(day, "yyyy-MM-dd");
            const weather = weatherByDate.get(dayStr);
            const multiplierLabel = weather ? getWeatherMultiplierLabel(weather.impact.capacityMultiplier) : null;
            return (
              <div key={i} className={`p-3 text-center border-r last:border-r-0 ${isToday ? "bg-primary/10 dark:bg-primary/15 border-b-2 border-b-primary" : ""}`}>
                <div className="text-xs text-muted-foreground uppercase font-medium tracking-wide">{format(day, "EEE", { locale: sv })}</div>
                <div className={`text-lg font-semibold ${isToday ? "text-primary" : "text-foreground"}`}>{format(day, "d")}</div>
                {weather && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-center gap-1 mt-0.5" data-testid={`weather-${dayStr}`}>
                        {getWeatherIcon(weather.forecast.weatherCode)}
                        <span className="text-[10px] text-muted-foreground">{Math.round(weather.forecast.temperature)}°</span>
                        {multiplierLabel && (
                          <span className={`text-[9px] font-medium px-1 rounded ${
                            weather.impact.impactLevel === "severe" || weather.impact.impactLevel === "high"
                              ? "bg-destructive/15 text-destructive dark:bg-destructive/15"
                              : weather.impact.impactLevel === "medium"
                              ? "bg-chart-3/15 text-chart-3 dark:bg-chart-3/15"
                              : "bg-chart-1/15 text-chart-1 dark:bg-chart-1/15"
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
                      {multiplierLabel && <p className="text-warning">Kapacitetspåverkan: {multiplierLabel}</p>}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>

        {isTeamMode && showingUntiedUnderFilter && onHideUntiedTeamRows && (
          <div
            className="grid grid-cols-[160px_repeat(5,minmax(0,1fr))] bg-chart-1/10 dark:bg-chart-1/15 border-b"
            data-testid="banner-showing-untied-team"
          >
            <div className="sticky left-0 z-10 px-3 py-2 border-r flex items-center gap-2 bg-chart-1/10 dark:bg-chart-1/15">
              <EyeOff className="h-3.5 w-3.5 text-chart-1 shrink-0" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-chart-1">Filter + utan team</span>
            </div>
            <div className="col-span-5 px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs text-chart-1">
                Visar även rader utan teamtillhörighet trots aktivt team-filter.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-chart-1/30 dark:border-chart-1/70 hover:bg-chart-1/15 dark:hover:bg-chart-1/15"
                onClick={onHideUntiedTeamRows}
                data-testid="button-hide-untied-team-rows"
              >
                Dölj igen
              </Button>
            </div>
          </div>
        )}

        {isTeamMode && hiddenUntiedTeamSummary && (
          <div
            className="grid grid-cols-[160px_repeat(5,minmax(0,1fr))] bg-warning/10 dark:bg-warning/15 border-b"
            data-testid="banner-hidden-untied-team"
          >
            <div className="sticky left-0 z-10 px-3 py-2 border-r flex items-center gap-2 bg-warning/10 dark:bg-warning/15">
              <EyeOff className="h-3.5 w-3.5 text-warning shrink-0" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-warning">Dolt av filter</span>
            </div>
            <div className="col-span-5 px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs text-warning" data-testid="text-hidden-untied-summary">
                Team-filtret döljer{" "}
                <strong className="font-semibold tabular-nums">{hiddenUntiedTeamSummary.totalJobs}</strong>{" "}
                jobb
                {hiddenUntiedTeamSummary.fallbackResources > 0 && (
                  <>
                    {" "}på{" "}
                    <strong className="font-semibold tabular-nums">{hiddenUntiedTeamSummary.fallbackResources}</strong>{" "}
                    resurs{hiddenUntiedTeamSummary.fallbackResources === 1 ? "" : "er"} utan team
                  </>
                )}
                {hiddenUntiedTeamSummary.uncategorizedJobs > 0 && (
                  <>
                    {hiddenUntiedTeamSummary.fallbackResources > 0 ? " och " : " under "}
                    <strong className="font-semibold tabular-nums">{hiddenUntiedTeamSummary.uncategorizedJobs}</strong>{" "}
                    okategoriserade jobb
                  </>
                )}.
              </span>
              {onShowUntiedTeamRows && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-warning/30 dark:border-warning/70 hover:bg-warning/15 dark:hover:bg-warning/15"
                  onClick={onShowUntiedTeamRows}
                  data-testid="button-show-untied-team-rows"
                >
                  Visa ändå
                </Button>
              )}
            </div>
          </div>
        )}

        {isTeamMode && regularTeamRows.map(team => renderTeamRow(team))}

        {isTeamMode && fallbackTeamRows.length > 0 && (
          <div
            className="grid grid-cols-[160px_repeat(5,minmax(0,1fr))] bg-muted/40 border-b"
            data-testid="banner-fallback-rows-toggle"
          >
            <div className="sticky left-0 z-10 px-3 py-2 border-r flex items-center gap-2 bg-muted/40">
              <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Utan team</span>
            </div>
            <div className="col-span-5 px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs text-muted-foreground" data-testid="text-fallback-rows-summary">
                <strong className="font-semibold tabular-nums">{fallbackTeamRows.length}</strong>{" "}
                resurs{fallbackTeamRows.length === 1 ? "" : "er"} utan team
                {fallbackJobCount > 0 && (
                  <>
                    {" "}har{" "}
                    <strong className="font-semibold tabular-nums">{fallbackJobCount}</strong>{" "}
                    jobb
                  </>
                )}.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setFallbackExpanded(v => !v)}
                data-testid="button-toggle-fallback-rows"
                aria-expanded={fallbackExpanded}
              >
                {fallbackExpanded ? "Dölj" : "Visa"}
              </Button>
            </div>
          </div>
        )}

        {isTeamMode && fallbackExpanded && fallbackTeamRows.map(team => renderTeamRow(team))}

        {!isTeamMode && visibleResources.map((resource) => {
          const summary = resourceWeekSummary[resource.id];
          return (
            <div key={resource.id} className="grid grid-cols-[160px_repeat(5,minmax(0,1fr))] border-b">
              <div className="sticky left-0 bg-background z-10">
                <ResourceColumn resource={resource} summary={summary} onResourceClick={onResourceClick} onSendSchedule={onSendSchedule} isClusterMatch={!!activeDragJob && clusterMatchedResourceIds?.has(resource.id)} currentPeriod={props.currentPeriod} />
              </div>
              {visibleDates.map((day, dayIndex) => {
                const jobs = getJobsForResourceAndDay(resource.id, day);
                const dayHours = getResourceDayHours(resource.id, day);
                const isOverbooked = dayHours > HOURS_IN_DAY;
                const capacityPct = getCapacityPercentage(dayHours);
                const dayStr = format(day, "yyyy-MM-dd");
                const droppableId = `${resource.id}|${dayStr}`;

                const sortedDayJobs = [...jobs]
                  .map(j => ({ job: j, lat: (j.taskLatitude ?? j.objectLatitude) as number | null | undefined, lng: (j.taskLongitude ?? j.objectLongitude) as number | null | undefined }))
                  .filter(x => x.job.scheduledStartTime && x.lat != null && x.lng != null)
                  .sort((a, b) => (a.job.scheduledStartTime || "").localeCompare(b.job.scheduledStartTime || ""));
                let totalTravelMin = 0;
                let totalTravelKm = 0;
                for (let si = 0; si < sortedDayJobs.length - 1; si++) {
                  const sFrom = sortedDayJobs[si];
                  const sTo = sortedDayJobs[si + 1];
                  if (sFrom.lat != null && sFrom.lng != null && sTo.lat != null && sTo.lng != null) {
                    const d = haversineDistance(sFrom.lat, sFrom.lng, sTo.lat, sTo.lng);
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
                    className={`${zoomPadClass} border-r last:border-r-0 transition-colors overflow-hidden min-w-0 ${getCapacityBgColor(capacityPct)} ${restrictedJobs.length > 0 ? "bg-destructive/10 dark:bg-destructive/15" : ""}`}
                    dropFitInfo={cellDropFit}
                    style={{ minHeight: `${zoom.weekH}px` }}
                    dragOverConflicts={dragOverConflicts?.[droppableId]}
                    remoteDragActive={remoteDragActive}
                    remoteHovered={remoteHoveredDropId === droppableId}
                  >
                    <div className="min-w-0 overflow-hidden" data-testid={`drop-zone-${resource.id}-${dayStr}`}>
                      <div className="flex items-center gap-1 mb-2">
                        <div className="h-2 flex-1 bg-muted-foreground/15 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${getCapacityColor(capacityPct)}`} style={{ width: `${Math.min(capacityPct, 100)}%` }} />
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`text-[10px] tabular-nums cursor-help ${isOverbooked ? "text-destructive font-semibold" : capacityPct >= 85 ? "text-warning" : "text-muted-foreground"}`}>
                              {dayHours.toFixed(1).replace(".", ",")}h
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{dayHours.toFixed(1)}h planerat av {HOURS_IN_DAY}h</p>
                            <p>{Math.max(0, HOURS_IN_DAY - dayHours).toFixed(1)}h kvar</p>
                            {isOverbooked && <p className="text-destructive font-medium">Överbokad med {(dayHours - HOURS_IN_DAY).toFixed(1)}h</p>}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      {isOverbooked && (
                        <div className="flex items-center gap-1 text-[10px] text-destructive mb-1 font-medium">
                          <AlertTriangle className="h-3 w-3 text-warning" /><span>+{(dayHours - HOURS_IN_DAY).toFixed(1)}h över</span>
                        </div>
                      )}
                      {restrictedJobs.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 text-[10px] text-destructive mb-1 cursor-help" data-testid={`cell-restriction-${resource.id}-${dayStr}`}>
                              <AlertTriangle className="h-3 w-3 shrink-0 text-warning" /><span>{restrictedJobs.length} begränsad</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs space-y-1">
                              <p className="font-medium text-destructive">Tidsbegränsade uppdrag</p>
                              {restrictedJobs.map(j => <p key={j.id}>{j.title} - {j.objectName}</p>)}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {showConstraintLayer && constraintMap && (() => {
                        const cellConstraint = constraintMap.get(`${resource.id}|${dayStr}`);
                        if (!cellConstraint) {
                          return (
                            <div className="flex items-center gap-1 text-[10px] text-chart-2 mb-1 px-1 py-0.5 rounded bg-chart-2/10 dark:bg-chart-2/15" data-testid={`constraint-ok-${resource.id}-${dayStr}`}>
                              <ShieldCheck className="h-3 w-3 shrink-0" />
                              <span>Tillgänglig</span>
                            </div>
                          );
                        }
                        const isBlocked = cellConstraint.status === "blocked";
                        const Icon = isBlocked ? ShieldX : ShieldAlert;
                        const colorCls = isBlocked
                          ? "text-destructive"
                          : "text-warning";
                        const bgCls = isBlocked
                          ? "bg-destructive/10 dark:bg-destructive/15"
                          : "bg-warning/10 dark:bg-warning/15";
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className={`flex items-center gap-1 text-[10px] ${colorCls} mb-1 cursor-help px-1 py-0.5 rounded ${bgCls}`} data-testid={`constraint-${resource.id}-${dayStr}`}>
                                <Icon className="h-3 w-3 shrink-0" />
                                <span>{isBlocked ? "Blockerad" : "Varning"}</span>
                                <span className="text-muted-foreground">({cellConstraint.constraints.length})</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs">
                              <div className="text-xs space-y-1.5">
                                <p className={`font-semibold ${isBlocked ? "text-destructive" : "text-warning"}`}>
                                  {isBlocked ? "Hårda begränsningar" : "Mjuka begränsningar"}
                                </p>
                                {cellConstraint.constraints.map((c, i) => (
                                  <div key={i} className="flex items-start gap-1.5">
                                    <span className={`mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 ${c.severity === "critical" ? "bg-destructive/15" : "bg-warning/15"}`} />
                                    <div>
                                      <span className="font-medium">{constraintCategoryLabels[c.category] || c.category}: </span>
                                      <span>{c.description}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })()}
                      <div className={zoomGapClass}>
                        {jobs.length === 0 && (
                          <div className="flex items-center justify-center py-4 text-muted-foreground/70">
                            <Plus className="h-4 w-4" />
                          </div>
                        )}
                        {jobs.map((job) => (
                          <DraggableJobCard key={job.id} id={job.id}>
                            <JobCard job={job} compact {...jobCardProps} />
                          </DraggableJobCard>
                        ))}
                      </div>
                      {totalTravelMin > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 mt-2 px-1.5 py-0.5 rounded text-[10px] bg-chart-3/15 dark:bg-chart-3/15 text-chart-3 border border-chart-3/20 dark:border-chart-3/80" data-testid={`travel-summary-${resource.id}-${dayStr}`}>
                              <Navigation className="h-2.5 w-2.5" />
                              <span>{totalTravelMin} min</span>
                              <span className="text-chart-3">({Math.round(totalTravelKm)} km)</span>
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
    </div>
  );
});
