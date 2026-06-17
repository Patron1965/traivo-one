import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addDays, startOfWeek, startOfMonth, isSameDay, getDaysInMonth, addMonths, startOfYear, endOfYear, startOfQuarter, endOfQuarter } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrderWithObject, Customer, TaskDependency, Cluster, ObjectTimeRestriction } from "@shared/schema";
import type { DeliveryRestrictionNote } from "@shared/delivery-restrictions";
import { RESTRICTION_TYPE_LABELS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ViewMode, PlannerAction, WeatherForecastData, WeatherImpactDay, ConstraintData, ConstraintCell, CommuteSummaryResult } from "./types";
import { computeDateFilterParams, buildUnscheduledQueryString } from "./dateFilterUtils";
import { HOURS_IN_DAY, DAY_START_HOUR, DAY_END_HOUR } from "./types";
import type { WhatIfResult } from "./WhatIfPreview";
import { haversineDistanceKm as haversineKm, estimateTravelMinutes as estimateTravelMinutesGeo } from "@/lib/geo";

// Plannerns ursprungliga semantik: minst 5 minuter per ben även för
// 0 km (samlokaliserade jobb), för att matcha det överlappsskydd och
// dagstotaler som plannern presenterar. Får inte ändras utan att
// uppdatera UnscheduledSidebar/dagstotalerna i samma rörelse.
function estimateTravelMinutes(distanceKm: number): number {
  const m = estimateTravelMinutesGeo(distanceKm, 50);
  return Math.max(5, m);
}

const UNSCHEDULED_PAGE_SIZE = 50;
const PLANNER_FILTERS_KEY = "traivo-planner-filters";

function loadSavedFilters(): {
  filterCustomer: string;
  filterPriority: string;
  filterCluster: string;
  filterTeam: string;
  filterExecutionCode: string;
  hiddenResourceIds: string[];
  zoomLevel: number;
  showUnscheduled: boolean;
  viewMode: ViewMode;
  weekRowMode: "team" | "resource";
  selectedTeamIds?: string[];
  showUntiedTeamRows?: boolean;
} | null {
  try {
    const stored = localStorage.getItem(PLANNER_FILTERS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

function savePlannerFilters(filters: Record<string, unknown>) {
  try {
    localStorage.setItem(PLANNER_FILTERS_KEY, JSON.stringify(filters));
  } catch {}
}

export function usePlannerData() {
  const saved = useMemo(() => loadSavedFilters(), []);
  const [viewMode, setViewMode] = useState<ViewMode>(saved?.viewMode ?? "week");
  // Task #521: stöd carry-over-notiser och andra deep-links via `?day=YYYY-MM-DD`.
  const initialDate = useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("day");
      if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const parsed = new Date(`${raw}T00:00:00`);
        if (!isNaN(parsed.getTime())) return parsed;
      }
    } catch {}
    return new Date();
  }, []);
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(initialDate, { weekStartsOn: 1 }));
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [showUnscheduled, setShowUnscheduled] = useState(saved?.showUnscheduled ?? true);
  const [filterCustomer, setFilterCustomer] = useState<string>(saved?.filterCustomer ?? "all");
  const [filterPriority, setFilterPriority] = useState<string>(saved?.filterPriority ?? "all");
  const [filterCluster, setFilterCluster] = useState<string>(saved?.filterCluster ?? "all");
  const [filterTeam, setFilterTeam] = useState<string>(saved?.filterTeam ?? "all");
  const [filterExecutionCode, setFilterExecutionCode] = useState<string>(saved?.filterExecutionCode ?? "all");
  const [hiddenResourceIds, setHiddenResourceIds] = useState<Set<string>>(new Set(saved?.hiddenResourceIds ?? []));
  const [resourceNameFilter, setResourceNameFilter] = useState("");
  const [resourceExecutionCodeFilter, setResourceExecutionCodeFilter] = useState<string[]>([]);
  const [resourceOccupancyFilter, setResourceOccupancyFilter] = useState<"all" | "free" | "loaded" | "overloaded">("all");
  const [orderstockSearch, setOrderstockSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sidebarFiltersOpen, setSidebarFiltersOpen] = useState(false);
  const [unscheduledPage, setUnscheduledPage] = useState(0);
  const [filterDateField, setFilterDateField] = useState<"none" | "desired" | "created" | "sla">("none");
  const [filterDatePeriod, setFilterDatePeriod] = useState<"all" | "week" | "two_weeks" | "month" | "custom">("all");
  const [filterDateCustomFrom, setFilterDateCustomFrom] = useState<string>("");
  const [filterDateCustomTo, setFilterDateCustomTo] = useState<string>("");
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<PlannerAction[]>([]);
  const [redoStack, setRedoStack] = useState<PlannerAction[]>([]);
  const [routeViewResourceId, setRouteViewResourceId] = useState<string | null>(null);
  const [routeJobOrder, setRouteJobOrder] = useState<string[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [jobToAssign, setJobToAssign] = useState<WorkOrderWithObject | null>(null);
  const [assignDate, setAssignDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [sendScheduleDialogOpen, setSendScheduleDialogOpen] = useState(false);
  const [sendScheduleResource, setSendScheduleResource] = useState<Resource | null>(null);
  const [sendScheduleCopied, setSendScheduleCopied] = useState(false);
  const [sendChannelEmail, setSendChannelEmail] = useState(true);
  const [sendChannelSms, setSendChannelSms] = useState(true);
  const [sendLastResult, setSendLastResult] = useState<{
    email?: { success: boolean; recipient?: string; error?: string };
    sms?: { success: boolean; recipient?: string; error?: string };
  } | null>(null);
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkChannelEmail, setBulkChannelEmail] = useState(true);
  const [bulkChannelSms, setBulkChannelSms] = useState(true);
  const [bulkResults, setBulkResults] = useState<Record<string, { email?: { success: boolean; error?: string }; sms?: { success: boolean; error?: string } }>>({});
  const [bulkSending, setBulkSending] = useState(false);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [pendingSchedule, setPendingSchedule] = useState<{ jobId: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string; conflicts: string[]; bulkJobs?: Array<{ jobId: string; startTime: string }> } | null>(null);
  const [autoFillDialogOpen, setAutoFillDialogOpen] = useState(false);
  const [depChainDialogOpen, setDepChainDialogOpen] = useState(false);
  const [depChainJobId, setDepChainJobId] = useState<string | null>(null);
  const [autoFillOverbooking, setAutoFillOverbooking] = useState(0);
  const [autoFillGeoClustering, setAutoFillGeoClustering] = useState(true);
  const [autoFillGeoSpread, setAutoFillGeoSpread] = useState<Record<string, { totalJobs: number; zonesUsed: number; dominantZonePct: number }> | null>(null);
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [autoFillPreview, setAutoFillPreview] = useState<Array<{ workOrderId: string; resourceId: string; scheduledDate: string; scheduledStartTime: string; title: string; address: string; estimatedDuration: number; priority: string }> | null>(null);
  const [autoFillApplying, setAutoFillApplying] = useState(false);
  const [autoFillSkipped, setAutoFillSkipped] = useState(0);
  const [autoFillDiag, setAutoFillDiag] = useState<{ totalUnscheduled: number; capacityPerDay: Record<string, number>; maxMinutesPerDay: number; resourceCount: number; clusterSkipped: number } | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(saved?.zoomLevel ?? 0);
  const [expandedSubSteps, setExpandedSubSteps] = useState<Record<string, boolean>>({});
  const [activeDragJob, setActiveDragJob] = useState<WorkOrderWithObject | null>(null);
  const [weekRowMode, setWeekRowMode] = useState<"team" | "resource">(saved?.weekRowMode ?? "team");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(Array.isArray(saved?.selectedTeamIds) ? saved!.selectedTeamIds! : []);
  const [showUntiedTeamRows, setShowUntiedTeamRows] = useState<boolean>(saved?.showUntiedTeamRows ?? false);
  const { toast } = useToast();

  useEffect(() => {
    savePlannerFilters({
      filterCustomer, filterPriority, filterCluster, filterTeam,
      filterExecutionCode, hiddenResourceIds: Array.from(hiddenResourceIds),
      zoomLevel, showUnscheduled, viewMode, weekRowMode, selectedTeamIds, showUntiedTeamRows,
    });
  }, [filterCustomer, filterPriority, filterCluster, filterTeam, filterExecutionCode, hiddenResourceIds, zoomLevel, showUnscheduled, viewMode, weekRowMode, selectedTeamIds, showUntiedTeamRows]);

  const { data: teamsData = [] } = useQuery<Array<{ id: string; name: string; clusterId: string | null; color: string | null }>>({ queryKey: ["/api/teams"] });
  const { data: teamMembersData = [] } = useQuery<Array<{ id: string; teamId: string; resourceId: string; role: string | null }>>({ queryKey: ["/api/team-members"] });
  const teamResourceIds = useMemo(() => { if (filterTeam === "all") return null; const ids = new Set<string>(); teamMembersData.forEach(tm => { if (tm.teamId === filterTeam) ids.add(tm.resourceId); }); return ids; }, [filterTeam, teamMembersData]);

  const visibleDates = useMemo((): Date[] => {
    if (viewMode === "day") return [currentDate];
    if (viewMode === "week") return Array.from({ length: 5 }, (_, i) => addDays(currentWeekStart, i));
    if (viewMode === "quarter" || viewMode === "year") return [currentDate];
    const monthStart = startOfMonth(currentDate);
    return Array.from({ length: getDaysInMonth(currentDate) }, (_, i) => addDays(monthStart, i));
  }, [viewMode, currentDate, currentWeekStart]);

  const { data: resources = [], isLoading: resourcesLoading } = useQuery<Resource[]>({ queryKey: ["/api/resources"] });
  const weatherWeekStart = useMemo(() => format(currentWeekStart, "yyyy-MM-dd"), [currentWeekStart]);
  const weatherDays = useMemo(() => Math.max(1, Math.min(visibleDates.length || 7, 14)), [visibleDates.length]);
  const { data: weatherData } = useQuery<WeatherForecastData>({
    queryKey: ["/api/weather/forecast", weatherWeekStart, weatherDays],
    queryFn: async () => {
      const res = await fetch(`/api/weather/forecast?weekStart=${weatherWeekStart}&days=${weatherDays}`, { credentials: "include" });
      if (!res.ok) throw new Error("weather fetch failed");
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
  });
  const weatherByDate = useMemo(() => { const map = new Map<string, { forecast: WeatherForecastData["forecasts"][0]; impact: WeatherImpactDay }>(); if (!weatherData?.forecasts || !weatherData?.impacts) return map; weatherData.forecasts.forEach((f, i) => { const impact = weatherData.impacts[i]; if (impact) map.set(f.date, { forecast: f, impact }); }); return map; }, [weatherData]);
  const baseVisibleResources = useMemo(() => {
    return resources.filter(r => {
      if (hiddenResourceIds.has(r.id)) return false;
      if (teamResourceIds && !teamResourceIds.has(r.id)) return false;
      if (resourceNameFilter.trim()) {
        if (!r.name.toLowerCase().includes(resourceNameFilter.toLowerCase().trim())) return false;
      }
      if (resourceExecutionCodeFilter.length > 0) {
        if (!resourceExecutionCodeFilter.some(ec => (r.executionCodes || []).includes(ec))) return false;
      }
      return true;
    });
  }, [resources, hiddenResourceIds, teamResourceIds, resourceNameFilter, resourceExecutionCodeFilter]);

  const dateRange = useMemo(() => {
    if (viewMode === "year") {
      return { startDate: format(startOfYear(currentDate), "yyyy-MM-dd"), endDate: format(endOfYear(currentDate), "yyyy-MM-dd") };
    }
    if (viewMode === "quarter") {
      return { startDate: format(startOfQuarter(currentDate), "yyyy-MM-dd"), endDate: format(endOfQuarter(currentDate), "yyyy-MM-dd") };
    }
    const ms = startOfMonth(currentDate);
    return { startDate: format(addDays(ms, -14), "yyyy-MM-dd"), endDate: format(addDays(ms, 45), "yyyy-MM-dd") };
  }, [viewMode, currentDate.getFullYear(), currentDate.getMonth()]);

  const { data: scheduledWorkOrders = [], isLoading: scheduledLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders", "scheduled", dateRange.startDate, dateRange.endDate],
    queryFn: async () => { const res = await fetch(`/api/work-orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`, { credentials: "include" }); if (!res.ok) throw new Error("Failed"); return res.json(); },
    staleTime: 60000,
  });

  useEffect(() => { const t = setTimeout(() => { setDebouncedSearch(orderstockSearch); setUnscheduledPage(0); }, 300); return () => clearTimeout(t); }, [orderstockSearch]);

  const dateFilterParams = useMemo(() => computeDateFilterParams({
    field: filterDateField,
    period: filterDatePeriod,
    customFrom: filterDateCustomFrom,
    customTo: filterDateCustomTo,
    weekStart: currentWeekStart,
  }), [filterDateField, filterDatePeriod, filterDateCustomFrom, filterDateCustomTo, currentWeekStart]);

  const dateFilterActive = dateFilterParams !== null;

  useEffect(() => { setUnscheduledPage(0); }, [filterDateField, filterDatePeriod, filterDateCustomFrom, filterDateCustomTo, currentWeekStart]);

  const buildUnscheduledParams = useCallback((offset: number) => buildUnscheduledQueryString({
    search: debouncedSearch,
    offset,
    limit: UNSCHEDULED_PAGE_SIZE,
    dateFilter: dateFilterParams,
  }), [debouncedSearch, dateFilterParams]);

  const unscheduledQueryParams = useMemo(() => buildUnscheduledParams(0), [buildUnscheduledParams]);

  const { data: unscheduledData, isLoading: unscheduledLoading } = useQuery<{ workOrders: WorkOrderWithObject[]; total: number; missingDateFieldCount?: number }>({
    queryKey: ["/api/work-orders", "unscheduled-paginated", debouncedSearch, dateFilterParams],
    queryFn: async () => { const res = await fetch(`/api/work-orders?${unscheduledQueryParams}`, { credentials: "include" }); if (!res.ok) throw new Error("Failed"); return res.json(); },
    staleTime: 120000,
  });

  const [accumulatedUnscheduled, setAccumulatedUnscheduled] = useState<WorkOrderWithObject[]>([]);
  const [unscheduledTotal, setUnscheduledTotal] = useState(0);
  const [unscheduledMissingDateCount, setUnscheduledMissingDateCount] = useState(0);
  useEffect(() => { if (unscheduledData) { if (unscheduledPage === 0) { setAccumulatedUnscheduled(unscheduledData.workOrders); } else { setAccumulatedUnscheduled(prev => { const ids = new Set(prev.map(wo => wo.id)); return [...prev, ...unscheduledData.workOrders.filter(wo => !ids.has(wo.id))]; }); } setUnscheduledTotal(unscheduledData.total); setUnscheduledMissingDateCount(unscheduledData.missingDateFieldCount || 0); } }, [unscheduledData, unscheduledPage]);

  const [missingDateExpanded, setMissingDateExpanded] = useState(false);
  const missingDateField = (filterDateField === "desired" || filterDateField === "sla") ? filterDateField : null;
  const missingDateEnabled = missingDateExpanded && dateFilterActive && missingDateField !== null && unscheduledMissingDateCount > 0;
  const { data: missingDateData, isLoading: missingDateLoading } = useQuery<{ workOrders: WorkOrderWithObject[]; total: number }>({
    queryKey: ["/api/work-orders", "unscheduled-missing-date", missingDateField, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("status", "unscheduled");
      params.set("missingDateOnly", "true");
      if (missingDateField) params.set("dateField", missingDateField);
      if (debouncedSearch) params.set("search", debouncedSearch);
      params.set("limit", "100");
      const res = await fetch(`/api/work-orders?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: missingDateEnabled,
    staleTime: 60000,
  });
  const missingDateJobs = useMemo(() => missingDateData?.workOrders ?? [], [missingDateData]);

  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const loadMoreUnscheduled = useCallback(async () => {
    const np = unscheduledPage + 1; setLoadMoreLoading(true);
    try { const params = buildUnscheduledParams(np * UNSCHEDULED_PAGE_SIZE); const res = await fetch(`/api/work-orders?${params}`, { credentials: "include" }); if (!res.ok) throw new Error("Failed"); const data: { workOrders: WorkOrderWithObject[]; total: number; missingDateFieldCount?: number } = await res.json(); setAccumulatedUnscheduled(prev => { const ids = new Set(prev.map(wo => wo.id)); return [...prev, ...data.workOrders.filter(wo => !ids.has(wo.id))]; }); setUnscheduledTotal(data.total); setUnscheduledMissingDateCount(data.missingDateFieldCount || 0); setUnscheduledPage(np); } finally { setLoadMoreLoading(false); }
  }, [unscheduledPage, buildUnscheduledParams]);
  const hasMoreUnscheduled = accumulatedUnscheduled.length < unscheduledTotal;

  const workOrders = useMemo(() => { const ids = new Set(scheduledWorkOrders.map(wo => wo.id)); return [...scheduledWorkOrders, ...accumulatedUnscheduled.filter(wo => !ids.has(wo.id))]; }, [scheduledWorkOrders, accumulatedUnscheduled]);
  const workOrdersLoading = scheduledLoading || unscheduledLoading;
  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: clusters = [] } = useQuery<Cluster[]>({ queryKey: ["/api/clusters"] });
  const clusterMap = useMemo(() => new Map(clusters.map(c => [c.id, c])), [clusters]);
  const clusterMatchedResourceIds = useMemo(() => {
    const matched = new Set<string>();
    if (!activeDragJob?.clusterId) return matched;
    const cluster = clusters.find(c => c.id === activeDragJob.clusterId);
    if (!cluster?.postalCodes?.length) return matched;
    const clusterPostals = cluster.postalCodes;
    for (const r of resources) {
      if (!r.serviceArea?.length) continue;
      if (r.serviceArea.some(p => clusterPostals.includes(p))) {
        matched.add(r.id);
      }
    }
    return matched;
  }, [activeDragJob?.clusterId, clusters, resources]);
  const { data: clusterSettings } = useQuery<{ hardClusterBlocking: boolean }>({ queryKey: ["/api/cluster-settings"], staleTime: 60000 });
  const hardClusterBlocking = clusterSettings?.hardClusterBlocking !== false;
  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  const workOrderIds = useMemo(() => workOrders.map(wo => wo.id), [workOrders]);
  const { data: dependenciesData } = useQuery<{ dependencies: Record<string, TaskDependency[]>; dependents: Record<string, TaskDependency[]> }>({
    queryKey: ["/api/task-dependencies/batch", workOrderIds.join(",")],
    queryFn: async () => { if (workOrderIds.length === 0) return { dependencies: {}, dependents: {} }; const res = await apiRequest("POST", "/api/task-dependencies/batch", { workOrderIds }); return res.json(); },
    enabled: workOrderIds.length > 0, staleTime: 120000,
  });

  const { data: depChainData } = useQuery<{ chain: Array<{ type: string; dependencyType: string; workOrder: { id: string; title: string; orderStatus: string; executionStatus: string; scheduledDate: string | null; scheduledStartTime: string | null; creationMethod: string | null } }> }>({
    queryKey: ["/api/work-orders", depChainJobId, "dependency-chain"],
    queryFn: async () => { if (!depChainJobId) return { chain: [] }; const res = await apiRequest("GET", `/api/work-orders/${depChainJobId}/dependency-chain`); return res.json(); },
    enabled: !!depChainJobId && depChainDialogOpen,
  });

  const scheduledObjectIds = useMemo(() => Array.from(new Set(workOrders.map(wo => wo.objectId).filter(Boolean) as string[])), [workOrders]);
  const { data: timeRestrictions = [] } = useQuery<ObjectTimeRestriction[]>({ queryKey: ["/api/time-restrictions", scheduledObjectIds.join(",")], queryFn: async () => { if (scheduledObjectIds.length === 0) return []; const res = await apiRequest("GET", `/api/time-restrictions?objectIds=${scheduledObjectIds.join(",")}`); return res.json(); }, enabled: scheduledObjectIds.length > 0, staleTime: 120000 });
  const restrictionsByObject = useMemo(() => { const map = new Map<string, ObjectTimeRestriction[]>(); for (const r of timeRestrictions) { if (!map.has(r.objectId)) map.set(r.objectId, []); map.get(r.objectId)!.push(r); } return map; }, [timeRestrictions]);
  // Task #978 (T004): Live-beräknade leverans-tidsrestriktioner (orderkoncept) per objekt.
  const { data: deliveryRestrictionNotes = {} } = useQuery<Record<string, DeliveryRestrictionNote[]>>({ queryKey: ["/api/planner/delivery-restrictions", scheduledObjectIds.join(",")], queryFn: async () => { if (scheduledObjectIds.length === 0) return {}; const res = await apiRequest("GET", `/api/planner/delivery-restrictions?objectIds=${scheduledObjectIds.join(",")}`); return res.json(); }, enabled: scheduledObjectIds.length > 0, staleTime: 120000 });
  const deliveryRestrictionsByObject = useMemo(() => { const map = new Map<string, DeliveryRestrictionNote[]>(); for (const [oid, notes] of Object.entries(deliveryRestrictionNotes)) map.set(oid, notes); return map; }, [deliveryRestrictionNotes]);

  const { data: timewindowsData = [] } = useQuery<Array<{ workOrderId: string; dayOfWeek: string | null; startTime: string | null; endTime: string | null; weekNumber: number | null }>>({ queryKey: ["/api/task-timewindows"], staleTime: 120000 });
  const timewindowMap = useMemo(() => { const map = new Map<string, typeof timewindowsData>(); timewindowsData.forEach(tw => { const e = map.get(tw.workOrderId) || []; e.push(tw); map.set(tw.workOrderId, e); }); return map; }, [timewindowsData]);

  const workOrdersQueryKey = ["/api/work-orders", "scheduled", dateRange.startDate, dateRange.endDate];

  const updateWorkOrderMutation = useMutation({
    mutationFn: async ({ id, resourceId, scheduledDate, scheduledStartTime, clusterOverride }: { id: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string; clusterOverride?: boolean }) => { const payload: Record<string, unknown> = { resourceId, scheduledDate, orderStatus: "planerad_resurs" }; if (scheduledStartTime) payload.scheduledStartTime = scheduledStartTime; if (clusterOverride) payload.clusterOverride = "planner override"; return (await apiRequest("PATCH", `/api/work-orders/${id}`, payload)).json() as Promise<WorkOrderWithObject>; },
    onMutate: async ({ id, resourceId, scheduledDate, scheduledStartTime }) => {
      await queryClient.cancelQueries({ queryKey: workOrdersQueryKey });
      const prev = queryClient.getQueryData<WorkOrderWithObject[]>(workOrdersQueryKey);
      const jobInScheduled = prev?.find(j => j.id === id);
      if (jobInScheduled) {
        queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old => old?.map(j => j.id === id ? { ...j, resourceId, scheduledDate: new Date(scheduledDate + "T12:00:00Z"), scheduledStartTime: scheduledStartTime || j.scheduledStartTime, orderStatus: "planerad_resurs" as const } : j));
      } else {
        const unscheduledJob = accumulatedUnscheduled.find(j => j.id === id);
        if (unscheduledJob) {
          queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old => [...(old || []), { ...unscheduledJob, resourceId, scheduledDate: new Date(scheduledDate + "T12:00:00Z"), scheduledStartTime: scheduledStartTime || null, orderStatus: "planerad_resurs" as const }]);
          setAccumulatedUnscheduled(prev => prev.filter(j => j.id !== id));
        }
      }
      return { previousData: prev };
    },
    onSuccess: (updated, vars) => { queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old => old?.map(j => j.id === vars.id ? { ...j, ...updated } : j)); queryClient.invalidateQueries({ queryKey: ["/api/work-orders", "unscheduled-paginated"] }); setUnscheduledPage(0); },
    onError: (err, _vars, ctx) => { if (ctx?.previousData) queryClient.setQueryData(workOrdersQueryKey, ctx.previousData); toast({ title: "Kunde inte uppdatera jobbet", description: err instanceof Error ? err.message : "Försök igen", variant: "destructive" }); },
  });

  const assignTeamMutation = useMutation({
    mutationFn: async ({ id, teamId, scheduledDate }: { id: string; teamId: string | null; scheduledDate: string }) => {
      const payload: Record<string, unknown> = { teamId, resourceId: null, scheduledDate, orderStatus: "planerad_resurs" };
      return (await apiRequest("PATCH", `/api/work-orders/${id}`, payload)).json() as Promise<WorkOrderWithObject>;
    },
    onMutate: async ({ id, teamId, scheduledDate }) => {
      await queryClient.cancelQueries({ queryKey: workOrdersQueryKey });
      const prev = queryClient.getQueryData<WorkOrderWithObject[]>(workOrdersQueryKey);
      const jobInScheduled = prev?.find(j => j.id === id);
      if (jobInScheduled) {
        queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old => old?.map(j => j.id === id ? { ...j, teamId, resourceId: null, scheduledDate: new Date(scheduledDate + "T12:00:00Z"), orderStatus: "planerad_resurs" as const } : j));
      } else {
        const unscheduledJob = accumulatedUnscheduled.find(j => j.id === id);
        if (unscheduledJob) {
          queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old => [...(old || []), { ...unscheduledJob, teamId, resourceId: null, scheduledDate: new Date(scheduledDate + "T12:00:00Z"), orderStatus: "planerad_resurs" as const }]);
          setAccumulatedUnscheduled(prev => prev.filter(j => j.id !== id));
        }
      }
      return { previousData: prev };
    },
    onSuccess: (updated, vars) => { queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old => old?.map(j => j.id === vars.id ? { ...j, ...updated } : j)); queryClient.invalidateQueries({ queryKey: ["/api/work-orders", "unscheduled-paginated"] }); setUnscheduledPage(0); },
    onError: (err, _vars, ctx) => { if (ctx?.previousData) queryClient.setQueryData(workOrdersQueryKey, ctx.previousData); toast({ title: "Kunde inte tilldela team", description: err instanceof Error ? err.message : "Försök igen", variant: "destructive" }); },
  });

  const unscheduleWorkOrderMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("PATCH", `/api/work-orders/${id}`, { resourceId: null, scheduledDate: null, scheduledStartTime: null, orderStatus: "skapad" })).json() as Promise<WorkOrderWithObject>,
    onMutate: async (id) => { await queryClient.cancelQueries({ queryKey: workOrdersQueryKey }); const prev = queryClient.getQueryData<WorkOrderWithObject[]>(workOrdersQueryKey); queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old => old?.map(j => j.id === id ? { ...j, resourceId: null, scheduledDate: null, scheduledStartTime: null, orderStatus: "skapad" as const } : j)); return { previousData: prev }; },
    onSuccess: (updated, id) => { queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old => old?.map(j => j.id === id ? { ...j, ...updated } : j)); queryClient.invalidateQueries({ queryKey: ["/api/work-orders", "unscheduled-paginated"] }); setUnscheduledPage(0); toast({ title: "Avschemalagt", description: "Jobbet flyttades tillbaka till oschemalagda." }); },
    onError: (err, _id, ctx) => { if (ctx?.previousData) queryClient.setQueryData(workOrdersQueryKey, ctx.previousData); toast({ title: "Kunde inte avschemalägg jobbet", description: err instanceof Error ? err.message : "Försök igen", variant: "destructive" }); },
  });

  const applyActionMutation = useMutation({
    mutationFn: async ({ jobId, state }: { jobId: string; state: PlannerAction["previousState"] }) => (await apiRequest("PATCH", `/api/work-orders/${jobId}`, { resourceId: state.resourceId, teamId: state.teamId, scheduledDate: state.scheduledDate, scheduledStartTime: state.scheduledStartTime, orderStatus: state.orderStatus })).json() as Promise<WorkOrderWithObject>,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: workOrdersQueryKey }); queryClient.invalidateQueries({ queryKey: ["/api/work-orders", "unscheduled-paginated"] }); setUnscheduledPage(0); },
    onError: (error: Error) => { toast({ title: "Kunde inte ångra/göra om ändringen", description: error.message, variant: "destructive" }); },
  });

  const sendScheduleMutation = useMutation({
    mutationFn: async ({ resourceId, jobs, dateRange, channels }: { resourceId: string; jobs: Array<{ id: string; title: string; objectName?: string; objectAddress?: string; scheduledDate: string; scheduledStartTime?: string; estimatedDuration?: number; accessCode?: string; keyNumber?: string }>; dateRange: { start: string; end: string }; channels: { email: boolean; sms: boolean } }) => (await apiRequest("POST", `/api/notifications/send-schedule/${resourceId}`, { jobs, dateRange, fieldAppUrl: `${window.location.origin}/field`, channels })).json(),
    onSuccess: (data, variables) => {
      const result = {
        email: data.email as { success: boolean; recipient?: string; error?: string } | undefined,
        sms: data.sms as { success: boolean; recipient?: string; error?: string } | undefined,
      };
      setSendLastResult(result);
      const emailOk = result.email?.success;
      const smsOk = result.sms?.success;
      const emailFail = result.email && !emailOk;
      const smsFail = result.sms && !smsOk;
      const okParts: string[] = [];
      if (emailOk) okParts.push("e-post");
      if (smsOk) okParts.push("SMS");
      const failParts: string[] = [];
      if (emailFail) failParts.push("e-post");
      if (smsFail) failParts.push("SMS");
      if (okParts.length > 0 && failParts.length === 0) {
        toast({ title: "Schema skickat", description: `Skickat via ${okParts.join(" + ")}.` });
      } else if (okParts.length > 0 && failParts.length > 0) {
        toast({ title: "Delvis skickat", description: `OK: ${okParts.join(", ")}. Misslyckades: ${failParts.join(", ")}.`, variant: "destructive" });
      } else if (failParts.length > 0) {
        toast({ title: "Kunde inte skicka", description: `Misslyckades: ${failParts.join(", ")}.`, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/resources", variables.resourceId, "sms-history"] });
    },
    onError: (err) => { toast({ title: "Kunde inte skicka schema", description: err instanceof Error ? err.message : "Försök igen senare.", variant: "destructive" }); },
  });

  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

  const unscheduledJobs = useMemo(() => {
    const jobs = workOrders.filter(j => !j.scheduledDate || (!j.resourceId && !j.teamId));
    const sl = orderstockSearch.toLowerCase().trim();
    return jobs.filter(j => {
      if (filterCustomer !== "all" && j.customerId !== filterCustomer) return false;
      if (filterPriority !== "all" && j.priority !== filterPriority) return false;
      if (filterCluster !== "all") { if (filterCluster === "none" ? j.clusterId : j.clusterId !== filterCluster) return false; }
      if (filterTeam !== "all") { if (j.teamId && j.teamId !== filterTeam) return false; if (!j.teamId && teamResourceIds && j.resourceId && !teamResourceIds.has(j.resourceId)) return false; }
      if (filterExecutionCode !== "all" && j.executionCode !== filterExecutionCode) return false;
      if (sl) { const t = (j.title || "").toLowerCase(); const o = (j.objectName || "").toLowerCase(); const c = (customerMap.get(j.customerId)?.name || "").toLowerCase(); if (!t.includes(sl) && !o.includes(sl) && !c.includes(sl)) return false; }
      return true;
    }).sort((a, b) => { const ap = priorityOrder[a.priority] ?? 99; const bp = priorityOrder[b.priority] ?? 99; if (ap !== bp) return ap - bp; return (a.plannedWindowEnd ? new Date(a.plannedWindowEnd).getTime() : Infinity) - (b.plannedWindowEnd ? new Date(b.plannedWindowEnd).getTime() : Infinity); });
  }, [workOrders, filterCustomer, filterPriority, filterCluster, filterTeam, teamResourceIds, filterExecutionCode, orderstockSearch, customerMap]);

  const sidebarActiveFilterCount = [filterCustomer !== "all", filterPriority !== "all", filterCluster !== "all", filterTeam !== "all", filterExecutionCode !== "all", dateFilterActive].filter(Boolean).length;
  const clearAllSidebarFilters = () => { setFilterCustomer("all"); setFilterPriority("all"); setFilterCluster("all"); setFilterTeam("all"); setFilterExecutionCode("all"); setOrderstockSearch(""); setFilterDateField("none"); setFilterDatePeriod("all"); setFilterDateCustomFrom(""); setFilterDateCustomTo(""); };
  const sidebarQuickStats = useMemo(() => { const all = workOrders.filter(j => !j.scheduledDate || (!j.resourceId && !j.teamId)); return { urgentCount: all.filter(j => j.priority === "urgent").length, highCount: all.filter(j => j.priority === "high").length, overdueCount: all.filter(j => j.plannedWindowEnd && new Date(j.plannedWindowEnd) < new Date()).length, totalHours: Math.round(all.reduce((s, j) => s + (j.estimatedDuration || 0) / 60, 0) * 10) / 10 }; }, [workOrders]);

  const scheduledJobs = useMemo(() => workOrders.filter(j => j.scheduledDate && j.resourceId), [workOrders]);
  const filteredScheduledJobs = useMemo(() => scheduledJobs.filter(j => { if (filterCustomer !== "all" && j.customerId !== filterCustomer) return false; if (filterPriority !== "all" && j.priority !== filterPriority) return false; return true; }), [scheduledJobs, filterCustomer, filterPriority]);

  const currentViewScheduledJobs = useMemo(() => {
    let rs: Date, re: Date;
    if (viewMode === "year") { rs = startOfYear(currentDate); re = addDays(endOfYear(currentDate), 1); }
    else if (viewMode === "quarter") { rs = startOfQuarter(currentDate); re = addDays(endOfQuarter(currentDate), 1); }
    else if (viewMode === "month") { rs = startOfMonth(currentDate); re = addDays(rs, getDaysInMonth(currentDate)); }
    else if (viewMode === "day") { rs = new Date(currentDate); rs.setHours(0, 0, 0, 0); re = addDays(rs, 1); }
    else { rs = currentWeekStart; re = addDays(currentWeekStart, 5); }
    return filteredScheduledJobs.filter(j => { if (!j.scheduledDate) return false; const d = new Date(j.scheduledDate); return d >= rs && d < re; });
  }, [filteredScheduledJobs, viewMode, currentWeekStart, currentDate]);

  const resourceDayJobMap = useMemo(() => {
    const map: Record<string, Record<string, WorkOrderWithObject[]>> = {};
    const hoursMap: Record<string, Record<string, number>> = {};
    for (const job of filteredScheduledJobs) {
      if (!job.resourceId || !job.scheduledDate) continue;
      const rid = job.resourceId;
      const ds = typeof job.scheduledDate === "string" ? job.scheduledDate : (job.scheduledDate as Date).toISOString();
      const dk = ds.includes("T") ? ds.split("T")[0] : ds.split(" ")[0];
      if (!map[rid]) { map[rid] = {}; hoursMap[rid] = {}; }
      if (!map[rid][dk]) { map[rid][dk] = []; hoursMap[rid][dk] = 0; }
      map[rid][dk].push(job);
      const dur = (job.estimatedDuration || 0) / 60;
      const mult = weatherByDate.get(dk)?.impact.capacityMultiplier ?? 1;
      hoursMap[rid][dk] += mult > 0 && mult < 1 ? dur / mult : dur;
    }
    return { jobs: map, hours: hoursMap };
  }, [filteredScheduledJobs, weatherByDate]);

  const getJobsForResourceAndDay = useCallback((rid: string, day: Date) => resourceDayJobMap.jobs[rid]?.[format(day, "yyyy-MM-dd")] || [], [resourceDayJobMap]);
  const getResourceDayHours = useCallback((rid: string, day: Date) => resourceDayJobMap.hours[rid]?.[format(day, "yyyy-MM-dd")] || 0, [resourceDayJobMap]);

  const routeJobsForView = useMemo(() => {
    if (viewMode !== "route" || !routeViewResourceId) return [];
    const dk = format(currentDate, "yyyy-MM-dd");
    const base = (resourceDayJobMap.jobs[routeViewResourceId]?.[dk] || []).filter(j => (j.taskLatitude ?? j.objectLatitude) != null && (j.taskLongitude ?? j.objectLongitude) != null).sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
    return routeJobOrder.length > 0 && routeJobOrder.every(id => base.some(j => j.id === id)) ? routeJobOrder.map(id => base.find(j => j.id === id)!).filter(Boolean) : base;
  }, [viewMode, routeViewResourceId, currentDate, resourceDayJobMap, routeJobOrder]);

  const weekGoals = useMemo(() => {
    const ws = viewMode === "week" ? currentWeekStart : startOfWeek(currentDate, { weekStartsOn: 1 });
    const wdk = new Set(Array.from({ length: 5 }, (_, i) => format(addDays(ws, i), "yyyy-MM-dd")));
    const wj = scheduledJobs.filter(j => { if (!j.scheduledDate) return false; const d = j.scheduledDate; const dk = d instanceof Date ? format(d, "yyyy-MM-dd") : String(d).split("T")[0]; return wdk.has(dk); });
    const th = wj.reduce((s, j) => s + (j.estimatedDuration || 60), 0) / 60;
    const tc = wj.reduce((s, j) => s + (j.cachedCost || 0), 0);
    const twh = resources.reduce((s, r) => s + (r.weeklyHours || 40), 0);
    const twb = twh * 450; const ts = resources.length * 6 * 5;
    return { time: { current: th, target: twh, pct: twh > 0 ? Math.round((th / twh) * 100) : 0 }, economy: { current: tc, target: twb, pct: twb > 0 ? Math.round((tc / twb) * 100) : 0 }, count: { current: wj.length, target: ts, pct: ts > 0 ? Math.round((wj.length / ts) * 100) : 0 } };
  }, [scheduledJobs, resources, viewMode, currentWeekStart, currentDate]);

  const weekTravelTotal = useMemo(() => {
    const ws = viewMode === "week" ? currentWeekStart : startOfWeek(currentDate, { weekStartsOn: 1 });
    let totalMin = 0, totalKm = 0;
    for (const res of resources) { for (let di = 0; di < 5; di++) { const dj = getJobsForResourceAndDay(res.id, addDays(ws, di)).map(j => ({ j, lat: j.taskLatitude ?? j.objectLatitude, lng: j.taskLongitude ?? j.objectLongitude })).filter(x => x.j.scheduledStartTime && x.lat != null && x.lng != null).sort((a, b) => (a.j.scheduledStartTime || "").localeCompare(b.j.scheduledStartTime || "")); for (let i = 0; i < dj.length - 1; i++) { const f = dj[i], t = dj[i + 1]; if (f.lat != null && f.lng != null && t.lat != null && t.lng != null) { const d = haversineKm(f.lat, f.lng, t.lat, t.lng); totalKm += d; totalMin += estimateTravelMinutes(d); } } } }
    return { minutes: totalMin, km: Math.round(totalKm * 10) / 10, hours: Math.round(totalMin / 60 * 10) / 10 };
  }, [resources, viewMode, currentWeekStart, currentDate, getJobsForResourceAndDay]);

  const travelTimesForDay = useMemo(() => {
    const result: Record<string, Array<{ fromJobId: string; toJobId: string; minutes: number; distanceKm: number; startTime: string; endTime: string }>> = {};
    for (const res of resources) { const dj = getJobsForResourceAndDay(res.id, currentDate).map(j => ({ j, lat: j.taskLatitude ?? j.objectLatitude, lng: j.taskLongitude ?? j.objectLongitude })).filter(x => x.j.scheduledStartTime && x.lat != null && x.lng != null).sort((a, b) => (a.j.scheduledStartTime || "").localeCompare(b.j.scheduledStartTime || "")); const travels: typeof result[string] = []; for (let i = 0; i < dj.length - 1; i++) { const f = dj[i], t = dj[i + 1]; if (f.lat == null || f.lng == null || t.lat == null || t.lng == null) continue; const dist = haversineKm(f.lat, f.lng, t.lat, t.lng); const tm = estimateTravelMinutes(dist); const [fH, fM] = (f.j.scheduledStartTime || "08:00").split(":").map(Number); const fe = fH * 60 + fM + (f.j.estimatedDuration || 60); const te = fe + tm; travels.push({ fromJobId: f.j.id, toJobId: t.j.id, minutes: tm, distanceKm: Math.round(dist * 10) / 10, startTime: `${Math.floor(fe / 60).toString().padStart(2, "0")}:${(fe % 60).toString().padStart(2, "0")}`, endTime: `${Math.floor(te / 60).toString().padStart(2, "0")}:${(te % 60).toString().padStart(2, "0")}` }); } if (travels.length > 0) result[res.id] = travels; }
    return result;
  }, [resources, currentDate, getJobsForResourceAndDay]);

  const getCapacityPercentage = useCallback((h: number) => Math.min((h / HOURS_IN_DAY) * 100, 100), []);
  const getCapacityColor = useCallback((p: number) => p >= 100 ? "bg-destructive/15" : p >= 85 ? "bg-warning/15" : p >= 65 ? "bg-chart-3/15" : "bg-chart-2/15", []);
  const getCapacityBgColor = useCallback((p: number) => p >= 100 ? "bg-destructive/10 dark:bg-destructive/15" : p >= 85 ? "bg-warning/10 dark:bg-warning/15" : p >= 65 ? "bg-chart-3/10 dark:bg-chart-3/15" : "", []);
  const getDropFitClass = useCallback((rid: string, dayStr: string, dur: number) => {
    const nh = (resourceDayJobMap.hours[rid]?.[dayStr] || 0) + dur / 60;
    const p = (nh / HOURS_IN_DAY) * 100;
    if (p > 110) return { bg: "bg-destructive/15 dark:bg-destructive/15 ring-destructive/40", label: "Överbokning", color: "text-destructive" };
    if (p > 85) return { bg: "bg-warning/15 dark:bg-warning/15 ring-warning/40", label: "Tight", color: "text-warning" };
    if (p > 65) return { bg: "bg-chart-3/15 dark:bg-chart-3/15 ring-chart-3/40", label: "Bra", color: "text-chart-3" };
    return { bg: "bg-chart-2/15 dark:bg-chart-2/15 ring-chart-2/40", label: "Gott om plats", color: "text-chart-2" };
  }, [resourceDayJobMap]);

  const resourceWeekSummary = useMemo(() => {
    const s: Record<string, { totalHours: number; weeklyCapacity: number; pct: number }> = {};
    const wd = viewMode === "week" ? visibleDates : [];
    for (const r of resources) { let th = 0; for (const d of wd) th += resourceDayJobMap.hours[r.id]?.[format(d, "yyyy-MM-dd")] || 0; const cap = r.weeklyHours || 40; s[r.id] = { totalHours: th, weeklyCapacity: cap, pct: cap > 0 ? Math.round((th / cap) * 100) : 0 }; }
    return s;
  }, [resources, visibleDates, viewMode, resourceDayJobMap]);

  // Team-row infrastructure (week view, weekRowMode === "team")
  const UNCATEGORIZED_TEAM_ID = "__uncategorized__";
  const RESOURCE_FALLBACK_PREFIX = "__resource__";
  const resourceFallbackId = useCallback((rid: string) => `${RESOURCE_FALLBACK_PREFIX}${rid}`, []);
  const isResourceFallbackRow = useCallback((rowId: string) => rowId.startsWith(RESOURCE_FALLBACK_PREFIX), []);
  const extractResourceId = useCallback((rowId: string) => rowId.slice(RESOURCE_FALLBACK_PREFIX.length), []);
  // Resource → list of team ids (a resource can belong to multiple teams)
  const resourceTeamMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const tm of teamMembersData) {
      const arr = m.get(tm.resourceId);
      if (arr) {
        if (!arr.includes(tm.teamId)) arr.push(tm.teamId);
      } else {
        m.set(tm.resourceId, [tm.teamId]);
      }
    }
    return m;
  }, [teamMembersData]);

  const teamSizeMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const tm of teamMembersData) {
      m.set(tm.teamId, (m.get(tm.teamId) || 0) + 1);
    }
    return m;
  }, [teamMembersData]);

  // Job → list of team-row ids it should appear in. A job appears in:
  //  - its workOrder.teamId row (if set), AND
  //  - every team its resourceId is a member of (if no workOrder.teamId)
  //  - a resource-fallback row when it has a resource but the resource has no team membership
  //  - "Okategoriserade" when neither team nor resource is set, or when the referenced resource no longer exists
  const resourceIdSet = useMemo(() => new Set(resources.map(r => r.id)), [resources]);
  const teamRowAssignments = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const job of workOrders) {
      if (!job.scheduledDate) continue;
      const rows: string[] = [];
      if (job.teamId) {
        rows.push(job.teamId);
      } else if (job.resourceId && resourceIdSet.has(job.resourceId)) {
        const teamIds = resourceTeamMap.get(job.resourceId);
        if (teamIds && teamIds.length > 0) {
          for (const tid of teamIds) rows.push(tid);
        } else {
          rows.push(resourceFallbackId(job.resourceId));
        }
      } else {
        // No team, no resource — or resource no longer exists (deleted). Always show somewhere.
        rows.push(UNCATEGORIZED_TEAM_ID);
      }
      map.set(job.id, rows);
    }
    return map;
  }, [workOrders, resourceTeamMap, resourceFallbackId, resourceIdSet]);

  const teamDayJobMap = useMemo(() => {
    const jobs: Record<string, Record<string, WorkOrderWithObject[]>> = {};
    const hours: Record<string, Record<string, number>> = {};
    for (const job of workOrders) {
      if (!job.scheduledDate) continue;
      if (filterCustomer !== "all" && job.customerId !== filterCustomer) continue;
      if (filterPriority !== "all" && job.priority !== filterPriority) continue;
      const rowIds = teamRowAssignments.get(job.id);
      if (!rowIds || rowIds.length === 0) continue;
      const ds = typeof job.scheduledDate === "string" ? job.scheduledDate : (job.scheduledDate as Date).toISOString();
      const dk = ds.includes("T") ? ds.split("T")[0] : ds.split(" ")[0];
      const dur = (job.estimatedDuration || 0) / 60;
      const mult = weatherByDate.get(dk)?.impact.capacityMultiplier ?? 1;
      const adj = mult > 0 && mult < 1 ? dur / mult : dur;
      for (const rowId of rowIds) {
        if (!jobs[rowId]) { jobs[rowId] = {}; hours[rowId] = {}; }
        if (!jobs[rowId][dk]) { jobs[rowId][dk] = []; hours[rowId][dk] = 0; }
        jobs[rowId][dk].push(job);
        hours[rowId][dk] += adj;
      }
    }
    return { jobs, hours };
  }, [workOrders, teamRowAssignments, weatherByDate, filterCustomer, filterPriority]);

  const getJobsForTeamAndDay = useCallback((rowId: string, day: Date) => teamDayJobMap.jobs[rowId]?.[format(day, "yyyy-MM-dd")] || [], [teamDayJobMap]);
  const getTeamDayHours = useCallback((rowId: string, day: Date) => teamDayJobMap.hours[rowId]?.[format(day, "yyyy-MM-dd")] || 0, [teamDayJobMap]);

  // E8: Sammanställning av ENBART inställelseresa (hem ↔ arbetsområde) för en rad/dag.
  // Resa till första jobbet + hem från sista jobbet — separat från restid mellan jobb.
  const getCommuteSummary = useCallback((rowId: string, day: Date, kind: "resource" | "team"): CommuteSummaryResult => {
    const empty = (reason: "no-base" | "no-jobs", baseLabel = "", baseSource = ""): CommuteSummaryResult => ({
      ok: false, reason, baseLabel, baseSource, outKm: 0, outMin: 0, backKm: 0, backMin: 0, totalKm: 0, totalMin: 0, firstLabel: "", lastLabel: "", jobCount: 0,
    });

    // 1. Lös utgångspunkt (bas).
    let baseLat: number | null = null, baseLng: number | null = null, baseLabel = "", baseSource = "";
    if (kind === "resource") {
      const res = resources.find(r => r.id === rowId);
      if (res) {
        if (res.homeLatitude != null && res.homeLongitude != null) {
          baseLat = res.homeLatitude; baseLng = res.homeLongitude; baseLabel = res.name || "Hemadress"; baseSource = "Hemadress";
        } else if (res.currentLatitude != null && res.currentLongitude != null) {
          baseLat = res.currentLatitude; baseLng = res.currentLongitude; baseLabel = res.name || "Senaste position"; baseSource = "Senaste position";
        }
      }
    } else {
      // Team: teamledarens hem → någon medlems hem → medlems senaste position → klustercentrum.
      const members = teamMembersData.filter(tm => tm.teamId === rowId);
      const ordered = [...members].sort((a, b) => (b.role === "leader" ? 1 : 0) - (a.role === "leader" ? 1 : 0));
      for (const m of ordered) {
        const res = resources.find(r => r.id === m.resourceId);
        if (!res) continue;
        if (res.homeLatitude != null && res.homeLongitude != null) {
          baseLat = res.homeLatitude; baseLng = res.homeLongitude;
          baseLabel = res.name || "Teammedlem"; baseSource = m.role === "leader" ? "Teamledarens hemadress" : "Teammedlems hemadress";
          break;
        }
        if (baseLat == null && res.currentLatitude != null && res.currentLongitude != null) {
          baseLat = res.currentLatitude; baseLng = res.currentLongitude;
          baseLabel = res.name || "Teammedlem"; baseSource = "Teammedlems senaste position";
        }
      }
      if (baseLat == null) {
        const team = teamsData.find(t => t.id === rowId);
        const cl = team?.clusterId ? clusters.find(c => c.id === team.clusterId) : undefined;
        if (cl && cl.centerLatitude != null && cl.centerLongitude != null) {
          baseLat = cl.centerLatitude; baseLng = cl.centerLongitude; baseLabel = cl.name || "Kluster"; baseSource = "Klustercentrum";
        }
      }
    }

    if (baseLat == null || baseLng == null) return empty("no-base");

    // 2. Lokaliserade, schemalagda jobb för raden/dagen, sorterade på starttid.
    const jobs = (kind === "team" ? getJobsForTeamAndDay(rowId, day) : getJobsForResourceAndDay(rowId, day))
      .map(j => ({ j, lat: (j.taskLatitude ?? j.objectLatitude) as number | null | undefined, lng: (j.taskLongitude ?? j.objectLongitude) as number | null | undefined }))
      .filter(x => x.j.scheduledStartTime && x.lat != null && x.lng != null)
      .sort((a, b) => (a.j.scheduledStartTime || "").localeCompare(b.j.scheduledStartTime || ""));

    if (jobs.length === 0) return empty("no-jobs", baseLabel, baseSource);

    const first = jobs[0], last = jobs[jobs.length - 1];
    const outKm = haversineKm(baseLat, baseLng, first.lat!, first.lng!);
    const backKm = haversineKm(last.lat!, last.lng!, baseLat, baseLng);
    const outMin = estimateTravelMinutes(outKm);
    const backMin = estimateTravelMinutes(backKm);

    return {
      ok: true, baseLabel, baseSource,
      outKm: Math.round(outKm * 10) / 10, outMin,
      backKm: Math.round(backKm * 10) / 10, backMin,
      totalKm: Math.round((outKm + backKm) * 10) / 10, totalMin: outMin + backMin,
      firstLabel: first.j.objectName || first.j.title || "Första jobbet",
      lastLabel: last.j.objectName || last.j.title || "Sista jobbet",
      jobCount: jobs.length,
    };
  }, [resources, teamMembersData, teamsData, clusters, getJobsForTeamAndDay, getJobsForResourceAndDay]);

  const teamRows = useMemo(() => {
    const rows: Array<{ id: string; name: string; color: string | null; isUncategorized: boolean; isResourceFallback: boolean; resourceId: string | null; memberCount: number }> = [];
    const allowed = selectedTeamIds.length > 0 ? new Set(selectedTeamIds) : null;
    for (const t of teamsData) {
      if (allowed && !allowed.has(t.id)) continue;
      rows.push({ id: t.id, name: t.name, color: t.color, isUncategorized: false, isResourceFallback: false, resourceId: null, memberCount: teamSizeMap.get(t.id) || 0 });
    }
    // Resource-fallback rows: one per resource that has scheduled jobs but no team membership.
    // Show when no team filter is active, OR when filter active and the user opted in via showUntiedTeamRows.
    const includeUntied = !allowed || showUntiedTeamRows;
    if (includeUntied) {
      const fallbackRowIds = Object.keys(teamDayJobMap.jobs).filter(rid => isResourceFallbackRow(rid));
      const fallbackRows: typeof rows = [];
      for (const rowId of fallbackRowIds) {
        const rid = extractResourceId(rowId);
        const r = resources.find(rr => rr.id === rid);
        if (!r) continue;
        fallbackRows.push({
          id: rowId,
          name: r.name,
          color: null,
          isUncategorized: false,
          isResourceFallback: true,
          resourceId: rid,
          memberCount: 1,
        });
      }
      fallbackRows.sort((a, b) => a.name.localeCompare(b.name, "sv"));
      rows.push(...fallbackRows);
    }
    const showUncategorized = !allowed || allowed.has(UNCATEGORIZED_TEAM_ID) || showUntiedTeamRows;
    if (showUncategorized) {
      const hasUncategorized = Object.keys(teamDayJobMap.jobs[UNCATEGORIZED_TEAM_ID] || {}).length > 0;
      if (hasUncategorized) {
        rows.push({ id: UNCATEGORIZED_TEAM_ID, name: "Okategoriserade", color: null, isUncategorized: true, isResourceFallback: false, resourceId: null, memberCount: 0 });
      }
    }
    return rows;
  }, [teamsData, selectedTeamIds, showUntiedTeamRows, teamDayJobMap, teamSizeMap, resources, isResourceFallbackRow, extractResourceId]);

  // When team filter is active and the user has not opted in to showing untied rows,
  // compute how many fallback resources / jobs and uncategorized jobs are hidden in the
  // currently visible week so the planner knows that more work exists outside the filter.
  const hiddenUntiedTeamSummary = useMemo(() => {
    const filterActive = selectedTeamIds.length > 0;
    if (!filterActive || showUntiedTeamRows) return null;
    if (viewMode !== "week") return null;
    const dateKeys = visibleDates.map(d => format(d, "yyyy-MM-dd"));
    let fallbackResources = 0;
    let fallbackJobs = 0;
    const fallbackRowIds = Object.keys(teamDayJobMap.jobs).filter(rid => isResourceFallbackRow(rid));
    for (const rowId of fallbackRowIds) {
      let rowJobs = 0;
      for (const dk of dateKeys) {
        rowJobs += teamDayJobMap.jobs[rowId]?.[dk]?.length || 0;
      }
      if (rowJobs > 0) {
        fallbackResources += 1;
        fallbackJobs += rowJobs;
      }
    }
    const includeUncategorizedInHidden = !selectedTeamIds.includes(UNCATEGORIZED_TEAM_ID);
    let uncategorizedJobs = 0;
    if (includeUncategorizedInHidden) {
      for (const dk of dateKeys) {
        uncategorizedJobs += teamDayJobMap.jobs[UNCATEGORIZED_TEAM_ID]?.[dk]?.length || 0;
      }
    }
    const totalJobs = fallbackJobs + uncategorizedJobs;
    if (fallbackResources === 0 && totalJobs === 0) return null;
    return { fallbackResources, fallbackJobs, uncategorizedJobs, totalJobs };
  }, [selectedTeamIds, showUntiedTeamRows, viewMode, visibleDates, teamDayJobMap, isResourceFallbackRow]);

  const teamWeekSummary = useMemo(() => {
    const s: Record<string, { totalHours: number; weeklyCapacity: number; pct: number }> = {};
    const wd = viewMode === "week" ? visibleDates : [];
    for (const row of teamRows) {
      let th = 0;
      for (const d of wd) th += teamDayJobMap.hours[row.id]?.[format(d, "yyyy-MM-dd")] || 0;
      // Capacity = sum of weeklyHours of team members (resources). For uncategorized: 0 (no implicit capacity).
      // For resource-fallback rows: capacity = weeklyHours of that single resource.
      let cap = 0;
      if (row.isResourceFallback && row.resourceId) {
        const r = resources.find(rr => rr.id === row.resourceId);
        if (r) cap = r.weeklyHours || 40;
      } else if (!row.isUncategorized) {
        const memberIds = teamMembersData.filter(tm => tm.teamId === row.id).map(tm => tm.resourceId);
        for (const rid of memberIds) {
          const r = resources.find(rr => rr.id === rid);
          if (r) cap += r.weeklyHours || 40;
        }
      }
      s[row.id] = { totalHours: th, weeklyCapacity: cap, pct: cap > 0 ? Math.round((th / cap) * 100) : 0 };
    }
    return s;
  }, [teamRows, visibleDates, viewMode, teamDayJobMap, teamMembersData, resources]);

  const visibleResources = useMemo(() => {
    if (resourceOccupancyFilter === "all") return baseVisibleResources;
    return baseVisibleResources.filter(r => {
      const summary = resourceWeekSummary[r.id];
      if (!summary) return true;
      const pct = summary.pct;
      if (resourceOccupancyFilter === "free") return pct < 60;
      if (resourceOccupancyFilter === "loaded") return pct >= 60 && pct <= 90;
      if (resourceOccupancyFilter === "overloaded") return pct > 90;
      return true;
    });
  }, [baseVisibleResources, resourceWeekSummary, resourceOccupancyFilter]);

  const allExecutionCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const r of resources) {
      for (const ec of (r.executionCodes || [])) {
        if (ec) codes.add(ec);
      }
    }
    return Array.from(codes).sort();
  }, [resources]);

  const resourceActiveFilterCount = [
    resourceNameFilter.trim() !== "",
    resourceExecutionCodeFilter.length > 0,
    resourceOccupancyFilter !== "all",
    filterTeam !== "all",
  ].filter(Boolean).length;

  const clearResourceFilters = useCallback(() => {
    setResourceNameFilter("");
    setResourceExecutionCodeFilter([]);
    setResourceOccupancyFilter("all");
    setFilterTeam("all");
  }, []);

  const detectConflictsForJob = useCallback((job: WorkOrderWithObject, resourceId: string, dateStr: string, startTime?: string | null): string[] => {
    const reasons: string[] = [];
    const dateObj = new Date(dateStr + "T12:00:00Z");
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const jobDay = dayNames[dateObj.getUTCDay()];
    const tws = timewindowMap.get(job.id);
    if (tws && tws.length > 0) { const dm = tws.filter(tw => !tw.dayOfWeek || tw.dayOfWeek === jobDay); if (dm.length > 0) { for (const tw of dm) { if (tw.startTime && tw.endTime && startTime && (startTime < tw.startTime || startTime > tw.endTime)) reasons.push(`Utanför tidsfönster (${tw.startTime}–${tw.endTime})`); } } else if (tws.some(tw => tw.dayOfWeek)) reasons.push(`Fel dag — tillåtna: ${tws.filter(tw => tw.dayOfWeek).map(tw => tw.dayOfWeek).join(", ")}`); }
    const pS = job.plannedWindowStart ? new Date(job.plannedWindowStart) : null; const pE = job.plannedWindowEnd ? new Date(job.plannedWindowEnd) : null;
    if (pS && dateObj < pS) reasons.push(`Före leveransfönster (${format(pS, "d MMM", { locale: sv })})`);
    if (pE && dateObj > pE) reasons.push(`Efter leveransfönster (${format(pE, "d MMM", { locale: sv })})`);
    if (job.objectId) { const objR = restrictionsByObject.get(job.objectId) || []; const di = dateObj.getUTCDay() || 7; for (const r of objR) { if (!r.isActive || !r.weekdays || r.weekdays.length === 0) continue; if (r.weekdays.includes(di)) { const label = RESTRICTION_TYPE_LABELS[r.restrictionType] || r.restrictionType; reasons.push(r.isBlockingAllDay ? `${label} — hela dagen blockerad` : r.startTime && r.endTime ? `${label} (${r.startTime}–${r.endTime})` : `${label} — begränsning aktiv`); } } }
    const advDays = (job.metadata as Record<string, number> | null)?.advanceNotificationDays || 0;
    if (advDays > 0) { const today = new Date(); today.setHours(0, 0, 0, 0); const daysUntil = Math.floor((dateObj.getTime() - today.getTime()) / 86400000); if (daysUntil < advDays) reasons.push(`Avisering krävs ${advDays} dagar i förväg — bara ${Math.max(0, daysUntil)} dagar kvar`); }
    if (dependenciesData?.dependencies) { for (const dep of (dependenciesData.dependencies[job.id] || [])) { const p = workOrders.find(wo => wo.id === dep.dependsOnWorkOrderId); if (p) { if (!p.scheduledDate || p.executionStatus === "not_planned") reasons.push(`⚠ Beroende "${p.title}" ej planerad (varning)`); else if (new Date(p.scheduledDate) > dateObj) reasons.push(`⚠ Beroende "${p.title}" planerad efter (${format(new Date(p.scheduledDate), "d MMM", { locale: sv })})`); } } }
    const activeSet = new Set(["skapad", "planerad_pre", "planerad_resurs", "planerad_las"]);
    if (startTime) { const [jH, jM] = startTime.split(":").map(Number); const jS = jH * 60 + jM; const jE = jS + (job.estimatedDuration || 60); for (const other of scheduledJobs.filter(j => j.id !== job.id && j.resourceId === resourceId && j.scheduledDate && activeSet.has(j.orderStatus) && isSameDay(new Date(j.scheduledDate), dateObj))) { if (!other.scheduledStartTime) continue; const [oH, oM] = other.scheduledStartTime.split(":").map(Number); const oS = oH * 60 + oM; const oE = oS + (other.estimatedDuration || 60); let travelMin = 0; let travelKm = 0; const hasCoords = job.taskLatitude != null && job.taskLongitude != null && other.taskLatitude != null && other.taskLongitude != null; if (hasCoords) { const dist = haversineKm(job.taskLatitude!, job.taskLongitude!, other.taskLatitude!, other.taskLongitude!); if (dist >= 0.1) { travelKm = dist; travelMin = estimateTravelMinutes(dist); } } const jEWithTravel = jE + travelMin; const oEWithTravel = oE + travelMin; if (jS < oEWithTravel && jEWithTravel > oS) { if (travelMin > 0 && !(jS < oE && jE > oS)) { reasons.push(`Överlapp med "${other.title}" (${other.scheduledStartTime}) — ~${travelMin} min restid krävs (${Math.round(travelKm * 10) / 10} km)`); } else if (travelMin > 0) { reasons.push(`Överlapp med "${other.title}" (${other.scheduledStartTime}) + ~${travelMin} min restid`); } else { reasons.push(`Överlapp med "${other.title}" (${other.scheduledStartTime})`); } break; } } }
    if (job.clusterId) {
      const cluster = clusterMap.get(job.clusterId);
      const resource = resources.find(r => r.id === resourceId);
      if (cluster && resource) {
        const normalize = (pc: string) => pc.replace(/\s/g, "").trim();
        const clusterPostalCodes = (cluster.postalCodes || []).map(normalize).filter(Boolean);
        const resourceServiceArea = (resource.serviceArea || []).map(normalize).filter(Boolean);
        if (clusterPostalCodes.length > 0 && resourceServiceArea.length > 0) {
          const resourceSet = new Set(resourceServiceArea);
          const overlap = clusterPostalCodes.some(pc => resourceSet.has(pc));
          if (!overlap) {
            if (hardClusterBlocking) {
              reasons.push(`[BLOCK] Kluster "${cluster.name}" — resursen arbetar inte i detta verksamhetsområde`);
            } else {
              reasons.push(`⚠ Kluster "${cluster.name}" — resursen arbetar normalt inte i detta område`);
            }
          }
        }
      }
    }
    return reasons;
  }, [scheduledJobs, timewindowMap, restrictionsByObject, dependenciesData, workOrders, clusterMap, resources, hardClusterBlocking]);

  const detectTeamConflictsForJob = useCallback((job: WorkOrderWithObject, teamId: string, dateStr: string): string[] => {
    const base = detectConflictsForJob(job, "__team__", dateStr, null);
    const teamJobs = teamDayJobMap.jobs[teamId]?.[dateStr] || [];
    if (job.objectId) {
      for (const other of teamJobs) {
        if (other.id === job.id) continue;
        if (other.objectId === job.objectId) {
          base.push(`Samma objekt redan inplanerat hos teamet (${other.title || other.objectName || ""})`);
          break;
        }
      }
    }
    return base;
  }, [detectConflictsForJob, teamDayJobMap]);

  const activeStatuses = useMemo(() => new Set(["skapad", "planerad_pre", "planerad_resurs", "planerad_las"]), []);
  const jobConflicts = useMemo(() => { const c: Record<string, string[]> = {}; for (const j of scheduledJobs) { if (!j.scheduledDate || !j.resourceId) continue; if (!activeStatuses.has(j.orderStatus)) continue; const r = detectConflictsForJob(j, j.resourceId, format(new Date(j.scheduledDate), "yyyy-MM-dd"), j.scheduledStartTime || null); if (r.length > 0) c[j.id] = r; } return c; }, [scheduledJobs, detectConflictsForJob, activeStatuses]);

  const addToUndoStack = useCallback((action: PlannerAction) => { setUndoStack(prev => [...prev.slice(-19), action]); setRedoStack([]); }, []);

  const executeSchedule = useCallback((jobId: string, resourceId: string, scheduledDate: string, scheduledStartTime?: string, clusterOverride?: boolean) => {
    const job = workOrders.find(j => j.id === jobId);
    if (!job) return;
    const previousTeamId = job.teamId ?? null;
    addToUndoStack({ type: "schedule", jobId, previousState: { resourceId: job.resourceId || null, teamId: previousTeamId, scheduledDate: job.scheduledDate ? format(new Date(job.scheduledDate), "yyyy-MM-dd") : null, scheduledStartTime: job.scheduledStartTime || null, orderStatus: job.orderStatus }, newState: { resourceId, teamId: previousTeamId, scheduledDate, scheduledStartTime: scheduledStartTime || null, orderStatus: "planerad_resurs" } });
    updateWorkOrderMutation.mutate({ id: jobId, resourceId, scheduledDate, scheduledStartTime, clusterOverride });
  }, [workOrders, addToUndoStack, updateWorkOrderMutation]);

  const executeTeamSchedule = useCallback((jobId: string, teamId: string, scheduledDate: string) => {
    const job = workOrders.find(j => j.id === jobId);
    if (!job) return;
    if (teamId === UNCATEGORIZED_TEAM_ID) {
      toast({ title: "Kan inte tilldela till Okategoriserade", description: "Välj ett team eller en resurs." });
      return;
    }
    const previousTeamId = job.teamId ?? null;
    addToUndoStack({
      type: "team-assign",
      jobId,
      previousState: {
        resourceId: job.resourceId || null,
        teamId: previousTeamId,
        scheduledDate: job.scheduledDate ? format(new Date(job.scheduledDate), "yyyy-MM-dd") : null,
        scheduledStartTime: job.scheduledStartTime || null,
        orderStatus: job.orderStatus,
      },
      newState: {
        resourceId: null,
        teamId,
        scheduledDate,
        scheduledStartTime: job.scheduledStartTime || null,
        orderStatus: "planerad_resurs",
      },
    });
    assignTeamMutation.mutate({ id: jobId, teamId, scheduledDate });
  }, [workOrders, addToUndoStack, assignTeamMutation, toast]);

  const navigate = (direction: "prev" | "next") => {
    if (viewMode === "day" || viewMode === "route") { const d = addDays(currentDate, direction === "next" ? 1 : -1); setCurrentDate(d); setCurrentWeekStart(startOfWeek(d, { weekStartsOn: 1 })); }
    else if (viewMode === "week") { const ws = addDays(currentWeekStart, direction === "next" ? 7 : -7); setCurrentWeekStart(ws); setCurrentDate(ws); }
    else if (viewMode === "quarter") { const d = addMonths(currentDate, direction === "next" ? 3 : -3); setCurrentDate(d); setCurrentWeekStart(startOfWeek(d, { weekStartsOn: 1 })); }
    else if (viewMode === "year") { const d = addMonths(currentDate, direction === "next" ? 12 : -12); setCurrentDate(d); setCurrentWeekStart(startOfWeek(d, { weekStartsOn: 1 })); }
    else { const d = addMonths(currentDate, direction === "next" ? 1 : -1); setCurrentDate(d); setCurrentWeekStart(startOfWeek(d, { weekStartsOn: 1 })); }
  };
  const handleViewModeChange = (m: ViewMode) => { if (m === "week") setCurrentWeekStart(startOfWeek(currentDate, { weekStartsOn: 1 })); setViewMode(m); };
  const goToToday = () => { const t = new Date(); setCurrentDate(t); setCurrentWeekStart(startOfWeek(t, { weekStartsOn: 1 })); };
  const goToDay = (day: Date) => { setCurrentDate(day); setCurrentWeekStart(startOfWeek(day, { weekStartsOn: 1 })); setViewMode("day"); };
  const goToMonth = (day: Date) => { setCurrentDate(day); setCurrentWeekStart(startOfWeek(day, { weekStartsOn: 1 })); setViewMode("month"); };
  const getHeaderLabel = () => {
    if (viewMode === "day" || viewMode === "route") return format(currentDate, "EEEE d MMMM yyyy", { locale: sv });
    if (viewMode === "week") return `Vecka ${format(currentWeekStart, "w", { locale: sv })} - ${format(currentWeekStart, "MMMM yyyy", { locale: sv })}`;
    if (viewMode === "quarter") return `Kvartal ${Math.floor(currentDate.getMonth() / 3) + 1} ${format(currentDate, "yyyy")}`;
    if (viewMode === "year") return `År ${format(currentDate, "yyyy")}`;
    return format(currentDate, "MMMM yyyy", { locale: sv });
  };

  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const [whatIfLoading, setWhatIfLoading] = useState(false);
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResult | null>(null);
  const [whatIfPending, setWhatIfPending] = useState<{
    jobId: string;
    jobTitle: string;
    resourceId: string;
    scheduledDate: string;
    scheduledStartTime?: string;
    clusterOverride?: boolean;
    bulkJobs?: Array<{ jobId: string; startTime: string }>;
  } | null>(null);
  const whatIfRequestIdRef = useRef(0);

  const fetchWhatIf = useCallback(async (workOrderId: string, toResourceId: string, scheduledDate: string, scheduledStartTime?: string, fromResourceId?: string | null, fromDate?: string | null) => {
    const requestId = ++whatIfRequestIdRef.current;
    setWhatIfLoading(true);
    setWhatIfResult(null);
    try {
      const res = await apiRequest("POST", "/api/planning/what-if", {
        workOrderId,
        toResourceId,
        scheduledDate,
        scheduledStartTime,
        fromResourceId,
        fromDate,
      });
      const data: WhatIfResult = await res.json();
      if (whatIfRequestIdRef.current === requestId) {
        setWhatIfResult(data);
      }
    } catch (err) {
      if (whatIfRequestIdRef.current === requestId) {
        setWhatIfResult(null);
        toast({ title: "Konsekvensanalys misslyckades", description: (err as Error).message, variant: "destructive" });
      }
    } finally {
      if (whatIfRequestIdRef.current === requestId) {
        setWhatIfLoading(false);
      }
    }
  }, [toast]);

  const handleJobClick = useCallback((jobId: string) => { setSelectedJob(jobId); }, []);
  const handleOpenAssignDialog = useCallback((job: WorkOrderWithObject, e: React.MouseEvent) => { e.stopPropagation(); setJobToAssign(job); setAssignDate(format(currentDate, "yyyy-MM-dd")); setAssignDialogOpen(true); }, [currentDate]);

  const handleAcceptConflict = useCallback(() => {
    if (!pendingSchedule) return;
    if (pendingSchedule.conflicts.some(c => c.startsWith("[BLOCK]"))) {
      setConflictDialogOpen(false);
      setPendingSchedule(null);
      return;
    }
    const hasClusterConflict = pendingSchedule.conflicts.some(c => c.includes("Kluster"));
    if (pendingSchedule.bulkJobs && pendingSchedule.bulkJobs.length > 0) {
      for (const bj of pendingSchedule.bulkJobs) {
        executeSchedule(bj.jobId, pendingSchedule.resourceId, pendingSchedule.scheduledDate, bj.startTime, hasClusterConflict);
      }
      toast({ title: "Bulk-flytt klar trots varning", description: `${pendingSchedule.bulkJobs.length} order schemalagda trots konflikter.` });
    } else {
      executeSchedule(pendingSchedule.jobId, pendingSchedule.resourceId, pendingSchedule.scheduledDate, pendingSchedule.scheduledStartTime, hasClusterConflict);
      toast({ title: "Schemalagt trots varning", description: "Jobbet har schemalagts trots identifierade konflikter." });
    }
    setConflictDialogOpen(false);
    setPendingSchedule(null);
  }, [pendingSchedule, executeSchedule, toast]);

  const handleUnschedule = useCallback((e: { stopPropagation: () => void }, jobId: string) => { e.stopPropagation(); const job = workOrders.find(j => j.id === jobId); if (job) { const previousTeamId = job.teamId ?? null; addToUndoStack({ type: "unschedule", jobId, previousState: { resourceId: job.resourceId || null, teamId: previousTeamId, scheduledDate: job.scheduledDate ? format(new Date(job.scheduledDate), "yyyy-MM-dd") : null, scheduledStartTime: job.scheduledStartTime || null, orderStatus: job.orderStatus }, newState: { resourceId: null, teamId: previousTeamId, scheduledDate: null, scheduledStartTime: null, orderStatus: "skapad" } }); } unscheduleWorkOrderMutation.mutate(jobId); }, [workOrders, addToUndoStack, unscheduleWorkOrderMutation]);

  const handleUndo = useCallback(() => { if (undoStack.length === 0) return; const last = undoStack[undoStack.length - 1]; setUndoStack(prev => prev.slice(0, -1)); setRedoStack(prev => [...prev, last]); applyActionMutation.mutate({ jobId: last.jobId, state: last.previousState }); toast({ title: "Ändring ångrad" }); }, [undoStack, applyActionMutation, toast]);
  const handleRedo = useCallback(() => { if (redoStack.length === 0) return; const last = redoStack[redoStack.length - 1]; setRedoStack(prev => prev.slice(0, -1)); setUndoStack(prev => [...prev, last]); applyActionMutation.mutate({ jobId: last.jobId, state: last.newState }); toast({ title: "Ändring återställd" }); }, [redoStack, applyActionMutation, toast]);

  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); if (undoStack.length > 0) handleUndo(); } if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); if (redoStack.length > 0) handleRedo(); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [handleUndo, handleRedo, undoStack.length, redoStack.length]);

  const handleResourceClick = useCallback((rid: string) => setActiveResourceId(rid), []);
  const activeResource = useMemo(() => activeResourceId ? resources.find(r => r.id === activeResourceId) || null : null, [activeResourceId, resources]);
  const activeResourceJobs = useMemo(() => activeResourceId ? scheduledJobs.filter(j => j.resourceId === activeResourceId).sort((a, b) => { if (!a.scheduledDate || !b.scheduledDate) return 0; return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime(); }) : [], [activeResourceId, scheduledJobs]);
  const activeResourceJobsByDay = useMemo(() => { const m: Record<string, WorkOrderWithObject[]> = {}; for (const j of activeResourceJobs) { if (!j.scheduledDate) continue; const dk = (typeof j.scheduledDate === "string" ? j.scheduledDate : (j.scheduledDate as Date).toISOString()).split("T")[0]; if (!m[dk]) m[dk] = []; m[dk].push(j); } return m; }, [activeResourceJobs]);

  const handleSendSchedule = useCallback((r: Resource) => {
    setSendScheduleResource(r);
    setSendScheduleCopied(false);
    setSendLastResult(null);
    setSendChannelEmail(!!r.email);
    const smsEnabled = r.smsOnScheduleSend !== false;
    setSendChannelSms(!!r.phone && smsEnabled);
    setSendScheduleDialogOpen(true);
  }, []);
  const getResourceScheduleJobs = useCallback((rid: string) => { const sd = viewMode === "week" ? currentWeekStart : viewMode === "year" ? startOfYear(currentDate) : viewMode === "quarter" ? startOfQuarter(currentDate) : currentDate; const ed = viewMode === "week" ? addDays(currentWeekStart, 4) : viewMode === "year" ? endOfYear(currentDate) : viewMode === "quarter" ? endOfQuarter(currentDate) : viewMode === "month" ? addDays(startOfMonth(currentDate), getDaysInMonth(currentDate) - 1) : currentDate; return workOrders.filter(j => j.resourceId === rid && j.scheduledDate && new Date(j.scheduledDate) >= sd && new Date(j.scheduledDate) <= ed).map(j => ({ id: j.id, title: j.title, objectName: j.objectName || undefined, objectAddress: j.objectAddress || undefined, scheduledDate: typeof j.scheduledDate === "string" ? j.scheduledDate : j.scheduledDate instanceof Date ? j.scheduledDate.toISOString() : new Date(String(j.scheduledDate)).toISOString(), scheduledStartTime: j.scheduledStartTime || undefined, estimatedDuration: j.estimatedDuration || undefined, accessCode: j.objectAccessCode || undefined, keyNumber: j.objectKeyNumber || undefined })); }, [workOrders, viewMode, currentWeekStart, currentDate]);

  const computeCurrentDateRange = useCallback(() => {
    if (viewMode === "year") return { start: format(startOfYear(currentDate), "yyyy-MM-dd"), end: format(endOfYear(currentDate), "yyyy-MM-dd") };
    if (viewMode === "quarter") return { start: format(startOfQuarter(currentDate), "yyyy-MM-dd"), end: format(endOfQuarter(currentDate), "yyyy-MM-dd") };
    const sd = viewMode === "week" ? format(currentWeekStart, "yyyy-MM-dd") : format(currentDate, "yyyy-MM-dd");
    const ed = viewMode === "week"
      ? format(addDays(currentWeekStart, 4), "yyyy-MM-dd")
      : viewMode === "month"
        ? format(addDays(startOfMonth(currentDate), getDaysInMonth(currentDate) - 1), "yyyy-MM-dd")
        : format(currentDate, "yyyy-MM-dd");
    return { start: sd, end: ed };
  }, [viewMode, currentWeekStart, currentDate]);

  const submitSendSchedule = useCallback((channels: { email: boolean; sms: boolean }) => {
    if (!sendScheduleResource) return;
    if (!channels.email && !channels.sms) {
      toast({ title: "Välj minst en kanal", variant: "destructive" });
      return;
    }
    const jobs = getResourceScheduleJobs(sendScheduleResource.id);
    if (jobs.length === 0) {
      toast({ title: "Inga jobb att skicka", description: "Resursen har inga planerade jobb för denna period.", variant: "destructive" });
      return;
    }
    setSendLastResult(null);
    sendScheduleMutation.mutate({
      resourceId: sendScheduleResource.id,
      jobs,
      dateRange: computeCurrentDateRange(),
      channels,
    });
  }, [sendScheduleResource, getResourceScheduleJobs, sendScheduleMutation, computeCurrentDateRange, toast]);

  const handleSendScheduleEmail = useCallback(() => submitSendSchedule({ email: true, sms: false }), [submitSendSchedule]);

  const openBulkSendDialog = useCallback(() => {
    const dateRange = computeCurrentDateRange();
    const eligible = resources.filter(r => workOrders.some(j => j.resourceId === r.id && j.scheduledDate && new Date(j.scheduledDate) >= new Date(dateRange.start) && new Date(j.scheduledDate) <= new Date(dateRange.end + "T23:59:59")));
    setBulkSelectedIds(new Set(eligible.map(r => r.id)));
    setBulkResults({});
    setBulkChannelEmail(true);
    setBulkChannelSms(true);
    setBulkSendOpen(true);
  }, [computeCurrentDateRange, resources, workOrders]);

  const handleBulkSendSchedule = useCallback(async () => {
    const dateRange = computeCurrentDateRange();
    const ids = Array.from(bulkSelectedIds);
    if (ids.length === 0) return;
    if (!bulkChannelEmail && !bulkChannelSms) {
      toast({ title: "Välj minst en kanal", variant: "destructive" });
      return;
    }
    setBulkSending(true);
    setBulkResults({});
    let okCount = 0;
    let failCount = 0;
    for (const rid of ids) {
      const resource = resources.find(r => r.id === rid);
      if (!resource) continue;
      const jobs = getResourceScheduleJobs(rid);
      if (jobs.length === 0) {
        setBulkResults(prev => ({ ...prev, [rid]: { ...(bulkChannelEmail ? { email: { success: false, error: "Inga jobb" } } : {}), ...(bulkChannelSms ? { sms: { success: false, error: "Inga jobb" } } : {}) } }));
        failCount++;
        continue;
      }
      try {
        const smsAllowed = resource.smsOnScheduleSend !== false;
        const channels = {
          email: bulkChannelEmail && !!resource.email,
          sms: bulkChannelSms && !!resource.phone && smsAllowed,
        };
        if (!channels.email && !channels.sms) {
          setBulkResults(prev => ({ ...prev, [rid]: { ...(bulkChannelEmail ? { email: { success: false, error: "Saknar e-post" } } : {}), ...(bulkChannelSms ? { sms: { success: false, error: !resource.phone ? "Saknar telefon" : "SMS avstängt" } } : {}) } }));
          failCount++;
          continue;
        }
        const res = await apiRequest("POST", `/api/notifications/send-schedule/${rid}`, { jobs, dateRange, fieldAppUrl: `${window.location.origin}/field`, channels });
        const data = await res.json();
        setBulkResults(prev => ({ ...prev, [rid]: { email: data.email, sms: data.sms } }));
        const allOk = (!data.email || data.email.success) && (!data.sms || data.sms.success);
        if (allOk) okCount++; else failCount++;
      } catch (err) {
        setBulkResults(prev => ({ ...prev, [rid]: { email: bulkChannelEmail ? { success: false, error: err instanceof Error ? err.message : "Fel" } : undefined, sms: bulkChannelSms ? { success: false, error: err instanceof Error ? err.message : "Fel" } : undefined } }));
        failCount++;
      }
    }
    setBulkSending(false);
    queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
    if (failCount === 0) {
      toast({ title: "Schema publicerat", description: `Skickat till ${okCount} ${okCount === 1 ? "tekniker" : "tekniker"}.` });
    } else {
      toast({ title: "Delvis publicerat", description: `${okCount} OK, ${failCount} misslyckades.`, variant: failCount > okCount ? "destructive" : "default" });
    }
  }, [computeCurrentDateRange, bulkSelectedIds, bulkChannelEmail, bulkChannelSms, resources, getResourceScheduleJobs, toast]);

  const resourceJobCountForCurrentPeriod = useMemo(() => {
    const dateRange = computeCurrentDateRange();
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end + "T23:59:59");
    const counts: Record<string, number> = {};
    for (const j of workOrders) {
      if (!j.resourceId || !j.scheduledDate) continue;
      const d = new Date(j.scheduledDate);
      if (d >= start && d <= end) counts[j.resourceId] = (counts[j.resourceId] || 0) + 1;
    }
    return counts;
  }, [workOrders, computeCurrentDateRange]);

  const currentPeriodRange = useMemo(() => computeCurrentDateRange(), [computeCurrentDateRange]);

  const handleCopyFieldAppLink = useCallback(async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/field`); setSendScheduleCopied(true); toast({ title: "Länk kopierad!", description: "Klistra in i SMS eller meddelande." }); setTimeout(() => setSendScheduleCopied(false), 3000); } catch { toast({ title: "Kunde inte kopiera", variant: "destructive" }); } }, [toast]);

  const handleOptimizeRoute = useCallback(async () => { if (routeJobsForView.length < 2) return; setIsOptimizing(true); try { const stops = routeJobsForView.map(j => ({ workOrderId: j.id, objectId: j.objectId || "", objectName: j.objectName || j.title, latitude: j.taskLatitude || 0, longitude: j.taskLongitude || 0, estimatedDuration: j.estimatedDuration || 0, scheduledStartTime: j.scheduledStartTime || undefined })); const result = await (await apiRequest("POST", "/api/route/optimize", { stops })).json(); if (result.optimizedStops) { setRouteJobOrder(result.optimizedStops.map((s: { workOrderId: string }) => s.workOrderId)); toast({ title: "Rutt optimerad", description: `Körsträcka minskad med ${result.savingsPercent}% (${result.originalDistance} km → ${result.optimizedDistance} km)` }); } } catch { toast({ title: "Fel vid optimering", description: "Kunde inte optimera rutten", variant: "destructive" }); } finally { setIsOptimizing(false); } }, [routeJobsForView, toast]);

  const handleClearAllScheduled = async () => {
    setClearLoading(true);
    try { let cs: Date, ce: Date; if (viewMode === "year") { cs = startOfYear(currentDate); ce = endOfYear(currentDate); } else if (viewMode === "quarter") { cs = startOfQuarter(currentDate); ce = endOfQuarter(currentDate); } else if (viewMode === "month") { cs = startOfMonth(currentDate); ce = addDays(cs, getDaysInMonth(currentDate) - 1); } else if (viewMode === "day") { cs = currentDate; ce = currentDate; } else { cs = currentWeekStart; ce = addDays(currentWeekStart, 4); } const data = await (await apiRequest("POST", "/api/work-orders/bulk-unschedule", { startDate: format(cs, "yyyy-MM-dd"), endDate: format(ce, "yyyy-MM-dd") })).json(); queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] }); setUnscheduledPage(0); setClearDialogOpen(false); toast({ title: "Planering rensad", description: `${data.count} jobb avplanerade och flyttade tillbaka till orderstocken.` }); } catch (error) { toast({ title: "Kunde inte rensa planeringen", description: error.message, variant: "destructive" }); } finally { setClearLoading(false); }
  };

  const handleAutoFillPreview = async () => {
    setAutoFillLoading(true); setAutoFillPreview(null);
    try { const ws = viewMode === "week" ? currentWeekStart : startOfWeek(currentDate, { weekStartsOn: 1 }); const data = await (await apiRequest("POST", "/api/auto-plan-week", { weekStartDate: format(ws, "yyyy-MM-dd"), resourceIds: resources.map(r => r.id), overbookingPercent: autoFillOverbooking, geoClusteringEnabled: autoFillGeoClustering })).json(); setAutoFillPreview(data.assignments || []); setAutoFillSkipped(data.totalSkipped || 0); setAutoFillDiag(data.totalUnscheduled != null ? { totalUnscheduled: data.totalUnscheduled, capacityPerDay: data.capacityPerDay || {}, maxMinutesPerDay: data.maxMinutesPerDay || 480, resourceCount: data.resourceCount || 0, clusterSkipped: data.clusterSkipped || 0 } : null); setAutoFillGeoSpread(data.geoSpreadPerDay || null); } catch (error) { toast({ title: "Kunde inte generera planering", description: error.message, variant: "destructive" }); } finally { setAutoFillLoading(false); }
  };

  const handleAutoFillApply = async () => {
    if (!autoFillPreview || autoFillPreview.length === 0) return; setAutoFillApplying(true);
    try { const data = await (await apiRequest("POST", "/api/auto-plan-week/apply", { assignments: autoFillPreview })).json(); toast({ title: "Planering tillämpad", description: `${data.applied} uppdrag planerade${autoFillSkipped > 0 ? `, ${autoFillSkipped} ryms ej denna vecka` : ""}` }); setAutoFillDialogOpen(false); setAutoFillPreview(null); queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] }); setUnscheduledPage(0); } catch (error) { toast({ title: "Kunde inte tillämpa planering", description: error.message, variant: "destructive" }); } finally { setAutoFillApplying(false); }
  };

  const handleCarryOver = useCallback(async () => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const today = new Date();
    try {
      const data = await (await apiRequest("POST", "/api/work-orders/carry-over", { 
        fromDate: format(yesterday, "yyyy-MM-dd"), 
        toDate: format(today, "yyyy-MM-dd") 
      })).json();
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      setUnscheduledPage(0);
      if (data.moved > 0) {
        toast({ title: "Jobb flyttade", description: `${data.moved} oavslutade jobb från igår flyttade till idag.` });
      } else {
        toast({ title: "Inga jobb att flytta", description: "Alla jobb från igår är redan avslutade." });
      }
    } catch (error) { toast({ title: "Kunde inte flytta jobb", description: error.message, variant: "destructive" }); }
  }, [toast]);

  const handleOpenDepChain = useCallback((jobId: string) => { setDepChainJobId(jobId); setDepChainDialogOpen(true); }, []);
  const handleToggleSubStep = useCallback((jobId: string) => setExpandedSubSteps(prev => ({ ...prev, [jobId]: !prev[jobId] })), []);

  const handleWhatIfConfirm = useCallback(() => {
    if (!whatIfPending) return;
    if (whatIfPending.bulkJobs && whatIfPending.bulkJobs.length > 0) {
      for (const bj of whatIfPending.bulkJobs) {
        executeSchedule(bj.jobId, whatIfPending.resourceId, whatIfPending.scheduledDate, bj.startTime, whatIfPending.clusterOverride);
      }
      toast({ title: "Bulk-flytt klar", description: `${whatIfPending.bulkJobs.length} order flyttade till ${whatIfPending.scheduledDate}` });
    } else {
      executeSchedule(whatIfPending.jobId, whatIfPending.resourceId, whatIfPending.scheduledDate, whatIfPending.scheduledStartTime, whatIfPending.clusterOverride);
      if (whatIfPending.scheduledStartTime) toast({ title: "Schemalagt", description: `Starttid ${whatIfPending.scheduledStartTime} tilldelad automatiskt` });
    }
    setWhatIfOpen(false);
    setWhatIfPending(null);
    setWhatIfResult(null);
  }, [whatIfPending, executeSchedule, toast]);

  const handleWhatIfCancel = useCallback(() => {
    setWhatIfOpen(false);
    setWhatIfPending(null);
    setWhatIfResult(null);
  }, []);

  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);

  useEffect(() => {
    setSelectedJobIds(new Set());
    lastSelectedRef.current = null;
  }, [viewMode, currentDate, currentWeekStart]);

  useEffect(() => {
    setResourceNameFilter("");
    setResourceExecutionCodeFilter([]);
    setResourceOccupancyFilter("all");
    setFilterTeam("all");
  }, [currentWeekStart, currentDate]);

  useEffect(() => {
    if (viewMode !== "week") {
      setResourceOccupancyFilter("all");
    }
  }, [viewMode]);

  const toggleJobSelection = useCallback((jobId: string, shiftKey = false) => {
    setSelectedJobIds(prev => {
      const next = new Set(prev);
      if (shiftKey && lastSelectedRef.current && lastSelectedRef.current !== jobId) {
        const allIds = filteredScheduledJobs.map(j => j.id);
        const lastIdx = allIds.indexOf(lastSelectedRef.current);
        const curIdx = allIds.indexOf(jobId);
        if (lastIdx !== -1 && curIdx !== -1) {
          const start = Math.min(lastIdx, curIdx);
          const end = Math.max(lastIdx, curIdx);
          for (let i = start; i <= end; i++) {
            next.add(allIds[i]);
          }
          lastSelectedRef.current = jobId;
          return next;
        }
      }
      if (next.has(jobId)) { next.delete(jobId); } else { next.add(jobId); }
      lastSelectedRef.current = jobId;
      return next;
    });
  }, [filteredScheduledJobs]);
  const clearSelection = useCallback(() => setSelectedJobIds(new Set()), []);
  const selectAllVisible = useCallback(() => {
    const ids = new Set(filteredScheduledJobs.map(j => j.id));
    setSelectedJobIds(ids);
  }, [filteredScheduledJobs]);

  const [showConstraintLayer, setShowConstraintLayer] = useState(false);
  const constraintWeekStart = useMemo(() => format(currentWeekStart, "yyyy-MM-dd"), [currentWeekStart]);
  const { data: constraintData } = useQuery<ConstraintData>({
    queryKey: ["/api/planning/constraints", constraintWeekStart],
    queryFn: async () => {
      const res = await fetch(`/api/planning/constraints?weekStart=${constraintWeekStart}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch constraints");
      return res.json();
    },
    enabled: showConstraintLayer,
    staleTime: 120000,
  });

  const constraintMap = useMemo(() => {
    const map = new Map<string, ConstraintCell>();
    if (!constraintData?.cells) return map;
    for (const cell of constraintData.cells) {
      map.set(`${cell.resourceId}|${cell.date}`, cell);
    }
    return map;
  }, [constraintData]);

  return {
    viewMode, setViewMode, currentDate, setCurrentDate, currentWeekStart, setCurrentWeekStart,
    selectedJob, setSelectedJob, showUnscheduled, setShowUnscheduled,
    filterCustomer, setFilterCustomer, filterPriority, setFilterPriority,
    filterCluster, setFilterCluster, filterTeam, setFilterTeam,
    filterExecutionCode, setFilterExecutionCode,
    hiddenResourceIds, setHiddenResourceIds,
    orderstockSearch, setOrderstockSearch, sidebarFiltersOpen, setSidebarFiltersOpen,
    zoomLevel, setZoomLevel, expandedSubSteps, activeDragJob, setActiveDragJob, clusterMatchedResourceIds,
    activeResourceId, setActiveResourceId, activeResource, activeResourceJobs, activeResourceJobsByDay,
    undoStack, redoStack,
    routeViewResourceId, setRouteViewResourceId, routeJobOrder, setRouteJobOrder, isOptimizing,
    assignDialogOpen, setAssignDialogOpen, jobToAssign, assignDate, setAssignDate,
    sendScheduleDialogOpen, setSendScheduleDialogOpen, sendScheduleResource, sendScheduleCopied,
    conflictDialogOpen, setConflictDialogOpen, pendingSchedule, setPendingSchedule,
    autoFillDialogOpen, setAutoFillDialogOpen, autoFillOverbooking, setAutoFillOverbooking,
    autoFillGeoClustering, setAutoFillGeoClustering, autoFillGeoSpread,
    autoFillLoading, autoFillPreview, autoFillApplying, autoFillSkipped, autoFillDiag,
    clearDialogOpen, setClearDialogOpen, clearLoading,
    depChainDialogOpen, setDepChainDialogOpen, depChainJobId, depChainData,
    resources, resourcesLoading, visibleResources, visibleDates,
    resourceNameFilter, setResourceNameFilter,
    resourceExecutionCodeFilter, setResourceExecutionCodeFilter,
    resourceOccupancyFilter, setResourceOccupancyFilter,
    allExecutionCodes, resourceActiveFilterCount, clearResourceFilters,
    customers, clusters, clusterMap, customerMap, teamsData, teamMembersData,
    weekRowMode, setWeekRowMode,
    selectedTeamIds, setSelectedTeamIds,
    showUntiedTeamRows, setShowUntiedTeamRows, hiddenUntiedTeamSummary,
    teamRows, getJobsForTeamAndDay, getTeamDayHours, teamWeekSummary,
    getCommuteSummary,
    executeTeamSchedule,
    workOrders, workOrdersLoading,
    dependenciesData, timeRestrictions, restrictionsByObject, deliveryRestrictionsByObject, timewindowMap,
    weatherByDate,
    unscheduledJobs, unscheduledTotal, accumulatedUnscheduled, hasMoreUnscheduled, loadMoreLoading, loadMoreUnscheduled,
    unscheduledMissingDateCount,
    missingDateExpanded, setMissingDateExpanded, missingDateJobs, missingDateLoading,
    filterDateField, setFilterDateField, filterDatePeriod, setFilterDatePeriod,
    filterDateCustomFrom, setFilterDateCustomFrom, filterDateCustomTo, setFilterDateCustomTo,
    dateFilterActive,
    sidebarActiveFilterCount, clearAllSidebarFilters, sidebarQuickStats,
    scheduledJobs, filteredScheduledJobs, currentViewScheduledJobs,
    resourceDayJobMap, routeJobsForView,
    weekGoals, weekTravelTotal, travelTimesForDay,
    getJobsForResourceAndDay, getResourceDayHours,
    getCapacityPercentage, getCapacityColor, getCapacityBgColor, getDropFitClass,
    resourceWeekSummary, jobConflicts,
    updateWorkOrderMutation, assignTeamMutation, unscheduleWorkOrderMutation, sendScheduleMutation,
    navigate, handleViewModeChange, goToToday, goToDay, goToMonth, getHeaderLabel,
    handleJobClick, handleOpenAssignDialog,
    handleAcceptConflict, handleUnschedule, handleUndo, handleRedo,
    handleResourceClick, handleSendSchedule, handleSendScheduleEmail, submitSendSchedule, handleCopyFieldAppLink,
    sendChannelEmail, setSendChannelEmail, sendChannelSms, setSendChannelSms, sendLastResult,
    bulkSendOpen, setBulkSendOpen, bulkSelectedIds, setBulkSelectedIds,
    bulkChannelEmail, setBulkChannelEmail, bulkChannelSms, setBulkChannelSms,
    bulkResults, bulkSending, openBulkSendDialog, handleBulkSendSchedule,
    resourceJobCountForCurrentPeriod, currentPeriodRange,
    handleOptimizeRoute, handleClearAllScheduled, handleAutoFillPreview, handleAutoFillApply, handleCarryOver,
    handleOpenDepChain, handleToggleSubStep,
    executeSchedule, detectConflictsForJob, detectTeamConflictsForJob,
    selectedJobIds, toggleJobSelection, clearSelection, selectAllVisible,
    whatIfOpen, setWhatIfOpen, whatIfLoading, whatIfResult, whatIfPending, setWhatIfPending,
    fetchWhatIf, handleWhatIfConfirm, handleWhatIfCancel,
    showConstraintLayer, setShowConstraintLayer, constraintMap,
    toast,
  };
}
