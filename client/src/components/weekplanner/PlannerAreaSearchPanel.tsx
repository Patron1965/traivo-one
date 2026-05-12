import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { QueryState } from "@/components/QueryState";
import { DraggableJobCard } from "./DndComponents";
import { JobCard } from "./JobCard";
import { workOrderStatusBadge } from "@/lib/status-colors";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import {
  X,
  Search,
  MapPin,
  Filter,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Calendar,
  RotateCw,
} from "lucide-react";
import { OBJECT_HIERARCHY_LEVELS, ORDER_STATUSES, type WorkOrderWithObject } from "@shared/schema";

const HIERARCHY_LABELS: Record<string, string> = {
  koncern: "Koncern",
  brf: "BRF",
  fastighet: "Fastighet",
  rum: "Rum",
  karl: "Kärl",
};

const STATUS_LABELS: Record<string, string> = {
  skapad: "Skapad",
  planerad_pre: "Planerad (pre)",
  planerad_resurs: "Planerad (resurs)",
  planerad_las: "Låst",
  utford: "Utförd",
  fakturerad: "Fakturerad",
  omojlig: "Omöjlig",
  avbruten: "Avbruten",
};

export type AreaSearchRow = WorkOrderWithObject & {
  objectCity: string | null;
  objectHierarchyLevel: string | null;
  objectLastServiceDate: string | null;
  conceptIntervalDays: number | null;
  conceptName: string | null;
};

interface AreaSearchResponse {
  rows: AreaSearchRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface PlannerAreaSearchPanelProps {
  open: boolean;
  onClose: () => void;
  onSelectJob: (jobId: string) => void;
  onResultsChange: (jobs: WorkOrderWithObject[]) => void;
}

const PAGE_SIZE = 50;
const EMPTY_TIMEWINDOW_MAP = new Map<string, Array<{ workOrderId: string; dayOfWeek: string | null; startTime: string | null; endTime: string | null; weekNumber: number | null }>>();
const EMPTY_EXPANDED: Record<string, boolean> = {};

function readUrlState() {
  if (typeof window === "undefined") return {} as any;
  const sp = new URLSearchParams(window.location.search);
  return {
    open: sp.get("areaSearch") === "open",
    city: sp.get("areaCity") || "",
    hierarchies: (sp.get("areaHier") || "").split(",").filter(Boolean),
    statuses: (sp.get("areaStatus") || "").split(",").filter(Boolean),
    from: sp.get("areaFrom") || "",
    to: sp.get("areaTo") || "",
    page: Math.max(1, parseInt(sp.get("areaPage") || "1", 10) || 1),
  };
}

function writeUrlState(patch: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  const next = sp.toString();
  const url = `${window.location.pathname}${next ? "?" + next : ""}${window.location.hash || ""}`;
  window.history.replaceState(null, "", url);
}

export const PlannerAreaSearchPanel = memo(function PlannerAreaSearchPanel({
  open,
  onClose,
  onSelectJob,
  onResultsChange,
}: PlannerAreaSearchPanelProps) {
  const initial = useMemo(() => readUrlState(), []);
  const [city, setCity] = useState<string>(initial.city || "");
  const [cityInput, setCityInput] = useState<string>(initial.city || "");
  const [hierarchies, setHierarchies] = useState<string[]>(initial.hierarchies || []);
  const [statuses, setStatuses] = useState<string[]>(initial.statuses || []);
  const [from, setFrom] = useState<string>(initial.from || "");
  const [to, setTo] = useState<string>(initial.to || "");
  const [page, setPage] = useState<number>(initial.page || 1);
  const [cityPopoverOpen, setCityPopoverOpen] = useState(false);

  // Persist URL state
  useEffect(() => {
    writeUrlState({
      areaSearch: open ? "open" : null,
      areaCity: city || null,
      areaHier: hierarchies.length ? hierarchies.join(",") : null,
      areaStatus: statuses.length ? statuses.join(",") : null,
      areaFrom: from || null,
      areaTo: to || null,
      areaPage: page > 1 ? String(page) : null,
    });
  }, [open, city, hierarchies, statuses, from, to, page]);

  // City autocomplete
  const citiesQuery = useQuery<string[]>({
    queryKey: ["/api/planner/area-search/cities", cityInput],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (cityInput) sp.set("q", cityInput);
      const r = await fetch(`/api/planner/area-search/cities?${sp.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: open && cityPopoverOpen,
  });

  // Main search
  const searchParams = useMemo(() => {
    const sp = new URLSearchParams();
    if (city) sp.set("city", city);
    if (hierarchies.length) sp.set("hierarchyLevels", hierarchies.join(","));
    if (statuses.length) sp.set("statuses", statuses.join(","));
    if (from) sp.set("lastServiceFrom", from);
    if (to) sp.set("lastServiceTo", to);
    sp.set("page", String(page));
    sp.set("pageSize", String(PAGE_SIZE));
    return sp.toString();
  }, [city, hierarchies, statuses, from, to, page]);

  const searchQuery = useQuery<AreaSearchResponse>({
    queryKey: ["/api/planner/area-search", searchParams],
    queryFn: async () => {
      const r = await fetch(`/api/planner/area-search?${searchParams}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: open && !!city,
  });

  // Bubble up results so WeekPlanner can register them as draggable
  const rows = searchQuery.data?.rows || [];
  useEffect(() => {
    onResultsChange(rows as unknown as WorkOrderWithObject[]);
  }, [rows, onResultsChange]);

  // When panel closes, clear extra dnd jobs
  useEffect(() => {
    if (!open) onResultsChange([]);
  }, [open, onResultsChange]);

  const toggleHierarchy = useCallback((h: string) => {
    setHierarchies(prev => prev.includes(h) ? prev.filter(x => x !== h) : [...prev, h]);
    setPage(1);
  }, []);

  const toggleStatus = useCallback((s: string) => {
    setStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
    setPage(1);
  }, []);

  const handleApplyCity = useCallback((c: string) => {
    setCity(c);
    setCityInput(c);
    setPage(1);
    setCityPopoverOpen(false);
  }, []);

  const handleReset = useCallback(() => {
    setCity("");
    setCityInput("");
    setHierarchies([]);
    setStatuses([]);
    setFrom("");
    setTo("");
    setPage(1);
  }, []);

  const total = searchQuery.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!open) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <aside
      className="w-[380px] shrink-0 border-l bg-background flex flex-col h-full"
      data-testid="panel-area-search"
    >
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2 bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="h-4 w-4 text-primary shrink-0" />
          <h3 className="text-sm font-semibold truncate">Sök område</h3>
          {total > 0 && (
            <Badge variant="secondary" className="text-xs" data-testid="badge-area-search-count">
              {total}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleReset}
            title="Återställ filter"
            data-testid="button-area-search-reset"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
            data-testid="button-area-search-close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="px-3 py-3 space-y-3 border-b">
        {/* City autocomplete */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Område / ort
          </label>
          <Popover open={cityPopoverOpen} onOpenChange={setCityPopoverOpen}>
            <PopoverTrigger asChild>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={cityInput}
                  onChange={(e) => {
                    setCityInput(e.target.value);
                    setCityPopoverOpen(true);
                  }}
                  onFocus={() => setCityPopoverOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleApplyCity(cityInput.trim());
                    }
                  }}
                  placeholder="t.ex. Stockholm"
                  className="h-8 pl-7 text-sm"
                  data-testid="input-area-search-city"
                />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-[330px] p-0" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
              <div className="max-h-72 overflow-auto py-1">
                {citiesQuery.isLoading && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Laddar…</div>
                )}
                {!citiesQuery.isLoading && (citiesQuery.data || []).length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Inga matchande orter</div>
                )}
                {(citiesQuery.data || []).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
                    onClick={() => handleApplyCity(c)}
                    data-testid={`option-area-city-${c}`}
                  >
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    {c}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {city && (
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-xs gap-1" data-testid="badge-area-active-city">
                <MapPin className="h-3 w-3" />
                {city}
                <button
                  type="button"
                  onClick={() => { setCity(""); setCityInput(""); setPage(1); }}
                  className="ml-1 hover-elevate rounded"
                  data-testid="button-clear-area-city"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            </div>
          )}
        </div>

        {/* Hierarchy */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Layers className="h-3 w-3" /> Hierarkinivå
          </label>
          <div className="flex flex-wrap gap-1.5">
            {OBJECT_HIERARCHY_LEVELS.map((h) => {
              const active = hierarchies.includes(h);
              return (
                <Button
                  key={h}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => toggleHierarchy(h)}
                  data-testid={`button-area-hierarchy-${h}`}
                >
                  {HIERARCHY_LABELS[h] || h}
                </Button>
              );
            })}
          </div>
        </div>

        {/* Status filter */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Filter className="h-3 w-3" /> Orderstatus
          </label>
          <div className="grid grid-cols-2 gap-1">
            {ORDER_STATUSES.map((s) => (
              <label
                key={s}
                className="flex items-center gap-1.5 text-[11px] cursor-pointer hover-elevate rounded px-1.5 py-0.5"
                data-testid={`label-area-status-${s}`}
              >
                <Checkbox
                  checked={statuses.includes(s)}
                  onCheckedChange={() => toggleStatus(s)}
                  className="h-3 w-3"
                  data-testid={`checkbox-area-status-${s}`}
                />
                <span>{STATUS_LABELS[s] || s}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Last service date */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Calendar className="h-3 w-3" /> Senaste service
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-muted-foreground">Från</span>
              <Input
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setPage(1); }}
                className="h-7 text-xs"
                data-testid="input-area-last-service-from"
              />
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground">Till</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); setPage(1); }}
                className="h-7 text-xs"
                data-testid="input-area-last-service-to"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 flex flex-col">
        {!city ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10 text-muted-foreground">
            <MapPin className="h-8 w-8 mb-3 opacity-40" />
            <p className="text-sm font-medium">Välj en ort för att börja söka</p>
            <p className="text-xs mt-1">Kombinera med hierarki, status och senaste service.</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-2">
              <QueryState
                isLoading={searchQuery.isLoading}
                isError={searchQuery.isError}
                isEmpty={!searchQuery.isLoading && rows.length === 0}
                error={searchQuery.error as { message?: string } | null}
                onRetry={() => searchQuery.refetch()}
                emptyTitle="Inga jobb i området"
                emptyDescription="Justera filter eller välj en annan ort."
                loadingVariant="skeleton-rows"
                skeletonRows={6}
              >
                <div className="space-y-1.5" data-testid="list-area-search-results">
                  {rows.map((row) => {
                    const job = row as unknown as WorkOrderWithObject;
                    const lastSvc = row.objectLastServiceDate
                      ? new Date(row.objectLastServiceDate)
                      : null;
                    const interval = row.conceptIntervalDays;
                    let dueState: "ok" | "warning" | "destructive" = "ok";
                    let dueLabel = "";
                    if (lastSvc && interval && interval > 0) {
                      const next = new Date(lastSvc);
                      next.setDate(next.getDate() + interval);
                      const diffDays = Math.floor((next.getTime() - today.getTime()) / 86400000);
                      if (diffDays < -30) {
                        dueState = "destructive";
                        dueLabel = `${Math.abs(diffDays)}d över`;
                      } else if (diffDays <= 0) {
                        dueState = "warning";
                        dueLabel = diffDays === 0 ? "idag" : `${Math.abs(diffDays)}d sen`;
                      } else if (diffDays <= 7) {
                        dueState = "warning";
                        dueLabel = `om ${diffDays}d`;
                      } else {
                        dueLabel = `om ${diffDays}d`;
                      }
                    }
                    const dueClass =
                      dueState === "destructive"
                        ? "bg-destructive/15 text-destructive border-destructive/30"
                        : dueState === "warning"
                          ? "bg-warning/15 text-warning border-warning/40"
                          : "bg-muted text-muted-foreground border-border";

                    return (
                      <div
                        key={job.id}
                        className="rounded-md border bg-card overflow-hidden hover-elevate"
                        data-testid={`row-area-result-${job.id}`}
                      >
                        <DraggableJobCard id={job.id}>
                          <JobCard
                            job={job}
                            selectedJob={null}
                            jobConflicts={{}}
                            dependenciesData={undefined}
                            timewindowMap={EMPTY_TIMEWINDOW_MAP}
                            expandedSubSteps={EMPTY_EXPANDED}
                            onJobClick={(id) => onSelectJob(id)}
                            onUnschedule={() => {}}
                            onToggleSubStep={() => {}}
                            onOpenDepChain={() => {}}
                            selectedJobIds={new Set()}
                            onToggleSelection={() => {}}
                          />
                        </DraggableJobCard>
                        <div className="px-2 pb-2 pt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                          {row.objectHierarchyLevel && (
                            <Badge variant="outline" className="text-[10px] py-0 h-4 chart-4">
                              {HIERARCHY_LABELS[row.objectHierarchyLevel] || row.objectHierarchyLevel}
                            </Badge>
                          )}
                          {row.orderStatus && (
                            <span
                              className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] ${workOrderStatusBadge[row.orderStatus] || "bg-muted text-muted-foreground border border-border"}`}
                              data-testid={`status-area-${row.orderStatus}-${job.id}`}
                            >
                              {STATUS_LABELS[row.orderStatus] || row.orderStatus}
                            </span>
                          )}
                          {lastSvc && (
                            <span className="text-muted-foreground" data-testid={`text-last-service-${job.id}`}>
                              Senast: {format(lastSvc, "d MMM yyyy", { locale: sv })}
                            </span>
                          )}
                          {dueLabel && (
                            <span
                              className={`inline-flex items-center px-1.5 py-0 rounded border text-[10px] ${dueClass}`}
                              data-testid={`badge-area-due-${job.id}`}
                            >
                              {dueLabel}
                            </span>
                          )}
                          {row.conceptName && (
                            <span className="text-muted-foreground truncate max-w-[160px]" title={row.conceptName}>
                              · {row.conceptName}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </QueryState>
            </div>
          </ScrollArea>
        )}

        {/* Pagination */}
        {city && total > PAGE_SIZE && (
          <div className="border-t px-3 py-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground" data-testid="text-area-page-info">
              Sida {page} / {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                data-testid="button-area-page-prev"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                data-testid="button-area-page-next"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
});
