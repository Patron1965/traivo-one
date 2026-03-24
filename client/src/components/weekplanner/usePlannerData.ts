import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, addDays, startOfWeek, startOfMonth, isSameDay, getDaysInMonth, addMonths } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrderWithObject, Customer, TaskDependency, Cluster, ObjectTimeRestriction } from "@shared/schema";
import { RESTRICTION_TYPE_LABELS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ViewMode, PlannerAction, WeatherForecastData, WeatherImpactDay } from "./types";
import { HOURS_IN_DAY, DAY_START_HOUR, DAY_END_HOUR } from "./types";

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
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [showUnscheduled, setShowUnscheduled] = useState(saved?.showUnscheduled ?? true);
  const [filterCustomer, setFilterCustomer] = useState<string>(saved?.filterCustomer ?? "all");
  const [filterPriority, setFilterPriority] = useState<string>(saved?.filterPriority ?? "all");
  const [filterCluster, setFilterCluster] = useState<string>(saved?.filterCluster ?? "all");
  const [filterTeam, setFilterTeam] = useState<string>(saved?.filterTeam ?? "all");
  const [filterExecutionCode, setFilterExecutionCode] = useState<string>(saved?.filterExecutionCode ?? "all");
  const [hiddenResourceIds, setHiddenResourceIds] = useState<Set<string>>(new Set(saved?.hiddenResourceIds ?? []));
  const [orderstockSearch, setOrderstockSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sidebarFiltersOpen, setSidebarFiltersOpen] = useState(false);
  const [unscheduledPage, setUnscheduledPage] = useState(0);
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<PlannerAction[]>([]);
  const [redoStack, setRedoStack] = useState<PlannerAction[]>([]);
  const [routeViewResourceId, setRouteViewResourceId] = useState<string | null>(null);
  const [routeJobOrder, setRouteJobOrder] = useState<string[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [jobToAssign, setJobToAssign] = useState<WorkOrderWithObject | null>(null);
  const [assignDate, setAssignDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [assignResourceId, setAssignResourceId] = useState<string | null>(null);
  const [sendScheduleDialogOpen, setSendScheduleDialogOpen] = useState(false);
  const [sendScheduleResource, setSendScheduleResource] = useState<Resource | null>(null);
  const [sendScheduleCopied, setSendScheduleCopied] = useState(false);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [pendingSchedule, setPendingSchedule] = useState<{ jobId: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string; conflicts: string[]; bulkJobs?: Array<{ jobId: string; startTime: string }> } | null>(null);
  const [autoFillDialogOpen, setAutoFillDialogOpen] = useState(false);
  const [depChainDialogOpen, setDepChainDialogOpen] = useState(false);
  const [depChainJobId, setDepChainJobId] = useState<string | null>(null);
  const [autoFillOverbooking, setAutoFillOverbooking] = useState(0);
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [autoFillPreview, setAutoFillPreview] = useState<Array<{ workOrderId: string; resourceId: string; scheduledDate: string; scheduledStartTime: string; title: string; address: string; estimatedDuration: number; priority: string }> | null>(null);
  const [autoFillApplying, setAutoFillApplying] = useState(false);
  const [autoFillSkipped, setAutoFillSkipped] = useState(0);
  const [autoFillDiag, setAutoFillDiag] = useState<{ totalUnscheduled: number; capacityPerDay: Record<string, number>; maxMinutesPerDay: number; resourceCount: number; clusterSkipped: number } | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(saved?.zoomLevel ?? 1);
  const [expandedSubSteps, setExpandedSubSteps] = useState<Record<string, boolean>>({});
  const [activeDragJob, setActiveDragJob] = useState<WorkOrderWithObject | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    savePlannerFilters({
      filterCustomer, filterPriority, filterCluster, filterTeam,
      filterExecutionCode, hiddenResourceIds: Array.from(hiddenResourceIds),
      zoomLevel, showUnscheduled, viewMode,
    });
  }, [filterCustomer, filterPriority, filterCluster, filterTeam, filterExecutionCode, hiddenResourceIds, zoomLevel, showUnscheduled, viewMode]);

  const { data: teamsData = [] } = useQuery<Array<{ id: string; name: string; clusterId: string | null; color: string | null }>>({ queryKey: ["/api/teams"] });
  const { data: teamMembersData = [] } = useQuery<Array<{ teamId: string; resourceId: string }>>({ queryKey: ["/api/team-members"] });
  const teamResourceIds = useMemo(() => { if (filterTeam === "all") return null; const ids = new Set<string>(); teamMembersData.forEach(tm => { if (tm.teamId === filterTeam) ids.add(tm.resourceId); }); return ids; }, [filterTeam, teamMembersData]);

  const visibleDates = useMemo((): Date[] => {
    if (viewMode === "day") return [currentDate];
    if (viewMode === "week") return Array.from({ length: 5 }, (_, i) => addDays(currentWeekStart, i));
    const monthStart = startOfMonth(currentDate);
    return Array.from({ length: getDaysInMonth(currentDate) }, (_, i) => addDays(monthStart, i));
  }, [viewMode, currentDate, currentWeekStart]);

  const { data: resources = [], isLoading: resourcesLoading } = useQuery<Resource[]>({ queryKey: ["/api/resources"] });
  const { data: weatherData } = useQuery<WeatherForecastData>({ queryKey: ["/api/weather/forecast"], staleTime: 30 * 60 * 1000 });
  const weatherByDate = useMemo(() => { const map = new Map<string, { forecast: WeatherForecastData["forecasts"][0]; impact: WeatherImpactDay }>(); if (!weatherData?.forecasts || !weatherData?.impacts) return map; weatherData.forecasts.forEach((f, i) => { const impact = weatherData.impacts[i]; if (impact) map.set(f.date, { forecast: f, impact }); }); return map; }, [weatherData]);
  const visibleResources = useMemo(() => hiddenResourceIds.size === 0 ? resources : resources.filter(r => !hiddenResourceIds.has(r.id)), [resources, hiddenResourceIds]);

  const dateRange = useMemo(() => { const ms = startOfMonth(currentDate); return { startDate: format(addDays(ms, -14), "yyyy-MM-dd"), endDate: format(addDays(ms, 45), "yyyy-MM-dd") }; }, [currentDate.getFullYear(), currentDate.getMonth()]);

  const { data: scheduledWorkOrders = [], isLoading: scheduledLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders", "scheduled", dateRange.startDate, dateRange.endDate],
    queryFn: async () => { const res = await fetch(`/api/work-orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`, { credentials: "include" }); if (!res.ok) throw new Error("Failed"); return res.json(); },
    staleTime: 60000,
  });

  useEffect(() => { const t = setTimeout(() => { setDebouncedSearch(orderstockSearch); setUnscheduledPage(0); }, 300); return () => clearTimeout(t); }, [orderstockSearch]);

  const unscheduledQueryParams = useMemo(() => { const p = new URLSearchParams(); p.set("status", "unscheduled"); p.set("limit", String(UNSCHEDULED_PAGE_SIZE)); p.set("offset", "0"); if (debouncedSearch.trim()) p.set("search", debouncedSearch.trim()); return p.toString(); }, [debouncedSearch]);

  const { data: unscheduledData, isLoading: unscheduledLoading } = useQuery<{ workOrders: WorkOrderWithObject[]; total: number }>({
    queryKey: ["/api/work-orders", "unscheduled-paginated", debouncedSearch],
    queryFn: async () => { const res = await fetch(`/api/work-orders?${unscheduledQueryParams}`, { credentials: "include" }); if (!res.ok) throw new Error("Failed"); return res.json(); },
    staleTime: 120000,
  });

  const [accumulatedUnscheduled, setAccumulatedUnscheduled] = useState<WorkOrderWithObject[]>([]);
  const [unscheduledTotal, setUnscheduledTotal] = useState(0);
  useEffect(() => { if (unscheduledData) { if (unscheduledPage === 0) { setAccumulatedUnscheduled(unscheduledData.workOrders); } else { setAccumulatedUnscheduled(prev => { const ids = new Set(prev.map(wo => wo.id)); return [...prev, ...unscheduledData.workOrders.filter(wo => !ids.has(wo.id))]; }); } setUnscheduledTotal(unscheduledData.total); } }, [unscheduledData, unscheduledPage]);

  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const loadMoreUnscheduled = useCallback(async () => {
    const np = unscheduledPage + 1; setLoadMoreLoading(true);
    try { const p = new URLSearchParams(); p.set("status", "unscheduled"); p.set("limit", String(UNSCHEDULED_PAGE_SIZE)); p.set("offset", String(np * UNSCHEDULED_PAGE_SIZE)); if (debouncedSearch.trim()) p.set("search", debouncedSearch.trim()); const res = await fetch(`/api/work-orders?${p.toString()}`, { credentials: "include" }); if (!res.ok) throw new Error("Failed"); const data: { workOrders: WorkOrderWithObject[]; total: number } = await res.json(); setAccumulatedUnscheduled(prev => { const ids = new Set(prev.map(wo => wo.id)); return [...prev, ...data.workOrders.filter(wo => !ids.has(wo.id))]; }); setUnscheduledTotal(data.total); setUnscheduledPage(np); } finally { setLoadMoreLoading(false); }
  }, [unscheduledPage, debouncedSearch]);
  const hasMoreUnscheduled = accumulatedUnscheduled.length < unscheduledTotal;

  const workOrders = useMemo(() => { const ids = new Set(scheduledWorkOrders.map(wo => wo.id)); return [...scheduledWorkOrders, ...accumulatedUnscheduled.filter(wo => !ids.has(wo.id))]; }, [scheduledWorkOrders, accumulatedUnscheduled]);
  const workOrdersLoading = scheduledLoading || unscheduledLoading;
  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: clusters = [] } = useQuery<Cluster[]>({ queryKey: ["/api/clusters"] });
  const clusterMap = useMemo(() => new Map(clusters.map(c => [c.id, c])), [clusters]);
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

  const { data: timewindowsData = [] } = useQuery<Array<{ workOrderId: string; dayOfWeek: string | null; startTime: string | null; endTime: string | null; weekNumber: number | null }>>({ queryKey: ["/api/task-timewindows"], staleTime: 120000 });
  const timewindowMap = useMemo(() => { const map = new Map<string, typeof timewindowsData>(); timewindowsData.forEach(tw => { const e = map.get(tw.workOrderId) || []; e.push(tw); map.set(tw.workOrderId, e); }); return map; }, [timewindowsData]);

  const workOrdersQueryKey = ["/api/work-orders", dateRange.startDate, dateRange.endDate];

  const updateWorkOrderMutation = useMutation({
    mutationFn: async ({ id, resourceId, scheduledDate, scheduledStartTime }: { id: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string }) => { const payload: Record<string, unknown> = { resourceId, scheduledDate, orderStatus: "planerad_resurs" }; if (scheduledStartTime) payload.scheduledStartTime = scheduledStartTime; return (await apiRequest("PATCH", `/api/work-orders/${id}`, payload)).json() as Promise<WorkOrderWithObject>; },
    onMutate: async ({ id, resourceId, scheduledDate }) => { await queryClient.cancelQueries({ queryKey: workOrdersQueryKey }); const prev = queryClient.getQueryData<WorkOrderWithObject[]>(workOrdersQueryKey); queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old => old?.map(j => j.id === id ? { ...j, resourceId, scheduledDate: new Date(scheduledDate + "T12:00:00Z"), orderStatus: "planerad_resurs" as const } : j)); return { previousData: prev }; },
    onSuccess: (updated, vars) => { queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old => old?.map(j => j.id === vars.id ? { ...j, ...updated } : j)); queryClient.invalidateQueries({ queryKey: ["/api/work-orders", "unscheduled-paginated"] }); setUnscheduledPage(0); },
    onError: (_err, _vars, ctx) => { if (ctx?.previousData) queryClient.setQueryData(workOrdersQueryKey, ctx.previousData); toast({ title: "Fel", description: "Kunde inte uppdatera jobbet.", variant: "destructive" }); },
  });

  const unscheduleWorkOrderMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("PATCH", `/api/work-orders/${id}`, { resourceId: null, scheduledDate: null, scheduledStartTime: null, orderStatus: "skapad" })).json() as Promise<WorkOrderWithObject>,
    onMutate: async (id) => { await queryClient.cancelQueries({ queryKey: workOrdersQueryKey }); const prev = queryClient.getQueryData<WorkOrderWithObject[]>(workOrdersQueryKey); queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old => old?.map(j => j.id === id ? { ...j, resourceId: null, scheduledDate: null, scheduledStartTime: null, orderStatus: "skapad" as const } : j)); return { previousData: prev }; },
    onSuccess: (updated, id) => { queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old => old?.map(j => j.id === id ? { ...j, ...updated } : j)); queryClient.invalidateQueries({ queryKey: ["/api/work-orders", "unscheduled-paginated"] }); setUnscheduledPage(0); toast({ title: "Avschemalagt", description: "Jobbet flyttades tillbaka till oschemalagda." }); },
    onError: (_err, _id, ctx) => { if (ctx?.previousData) queryClient.setQueryData(workOrdersQueryKey, ctx.previousData); toast({ title: "Fel", description: "Kunde inte avschemalägg jobbet.", variant: "destructive" }); },
  });

  const applyActionMutation = useMutation({
    mutationFn: async ({ jobId, state }: { jobId: string; state: PlannerAction["previousState"] }) => (await apiRequest("PATCH", `/api/work-orders/${jobId}`, { resourceId: state.resourceId, scheduledDate: state.scheduledDate, scheduledStartTime: state.scheduledStartTime, orderStatus: state.orderStatus })).json() as Promise<WorkOrderWithObject>,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: workOrdersQueryKey }); queryClient.invalidateQueries({ queryKey: ["/api/work-orders", "unscheduled-paginated"] }); setUnscheduledPage(0); },
    onError: () => { toast({ title: "Fel", description: "Kunde inte ångra/göra om ändringen.", variant: "destructive" }); },
  });

  const sendScheduleMutation = useMutation({
    mutationFn: async ({ resourceId, jobs, dateRange }: { resourceId: string; jobs: Array<{ id: string; title: string; objectName?: string; objectAddress?: string; scheduledDate: string; scheduledStartTime?: string; estimatedDuration?: number; accessCode?: string; keyNumber?: string }>; dateRange: { start: string; end: string } }) => (await apiRequest("POST", `/api/notifications/send-schedule/${resourceId}`, { jobs, dateRange, fieldAppUrl: `${window.location.origin}/field` })).json(),
    onSuccess: (data) => { if (data.success) { toast({ title: "Schema skickat!", description: `Schemat har skickats till ${data.recipient}` }); setSendScheduleDialogOpen(false); } else { toast({ title: "Kunde inte skicka", description: data.error || "Ett fel uppstod", variant: "destructive" }); } },
    onError: (err) => { toast({ title: "Fel", description: err instanceof Error ? err.message : "Kunde inte skicka schema", variant: "destructive" }); },
  });

  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

  const unscheduledJobs = useMemo(() => {
    const jobs = workOrders.filter(j => !j.scheduledDate || !j.resourceId);
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

  const sidebarActiveFilterCount = [filterCustomer !== "all", filterPriority !== "all", filterCluster !== "all", filterTeam !== "all", filterExecutionCode !== "all"].filter(Boolean).length;
  const clearAllSidebarFilters = () => { setFilterCustomer("all"); setFilterPriority("all"); setFilterCluster("all"); setFilterTeam("all"); setFilterExecutionCode("all"); setOrderstockSearch(""); };
  const sidebarQuickStats = useMemo(() => { const all = workOrders.filter(j => !j.scheduledDate || !j.resourceId); return { urgentCount: all.filter(j => j.priority === "urgent").length, highCount: all.filter(j => j.priority === "high").length, overdueCount: all.filter(j => j.plannedWindowEnd && new Date(j.plannedWindowEnd) < new Date()).length, totalHours: Math.round(all.reduce((s, j) => s + (j.estimatedDuration || 0) / 60, 0) * 10) / 10 }; }, [workOrders]);

  const scheduledJobs = useMemo(() => workOrders.filter(j => j.scheduledDate && j.resourceId), [workOrders]);
  const filteredScheduledJobs = useMemo(() => scheduledJobs.filter(j => { if (filterCustomer !== "all" && j.customerId !== filterCustomer) return false; if (filterPriority !== "all" && j.priority !== filterPriority) return false; return true; }), [scheduledJobs, filterCustomer, filterPriority]);

  const currentViewScheduledJobs = useMemo(() => {
    let rs: Date, re: Date;
    if (viewMode === "month") { rs = startOfMonth(currentDate); re = addDays(rs, getDaysInMonth(currentDate)); }
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
    const base = (resourceDayJobMap.jobs[routeViewResourceId]?.[dk] || []).filter(j => j.taskLatitude && j.taskLongitude).sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
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
    const hav = (lat1: number, lon1: number, lat2: number, lon2: number) => { const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); };
    for (const res of resources) { for (let di = 0; di < 5; di++) { const dj = getJobsForResourceAndDay(res.id, addDays(ws, di)).filter(j => j.scheduledStartTime && j.taskLatitude && j.taskLongitude).sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || "")); for (let i = 0; i < dj.length - 1; i++) { const f = dj[i], t = dj[i + 1]; if (f.taskLatitude && f.taskLongitude && t.taskLatitude && t.taskLongitude) { const d = hav(f.taskLatitude, f.taskLongitude, t.taskLatitude, t.taskLongitude); totalKm += d; totalMin += Math.max(Math.round(d / 50 * 60), 5); } } } }
    return { minutes: totalMin, km: Math.round(totalKm * 10) / 10, hours: Math.round(totalMin / 60 * 10) / 10 };
  }, [resources, viewMode, currentWeekStart, currentDate, getJobsForResourceAndDay]);

  const travelTimesForDay = useMemo(() => {
    const result: Record<string, Array<{ fromJobId: string; toJobId: string; minutes: number; distanceKm: number; startTime: string; endTime: string }>> = {};
    const hav = (lat1: number, lon1: number, lat2: number, lon2: number) => { const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); };
    for (const res of resources) { const dj = getJobsForResourceAndDay(res.id, currentDate).filter(j => j.scheduledStartTime && j.taskLatitude && j.taskLongitude).sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || "")); const travels: typeof result[string] = []; for (let i = 0; i < dj.length - 1; i++) { const f = dj[i], t = dj[i + 1]; if (!f.taskLatitude || !f.taskLongitude || !t.taskLatitude || !t.taskLongitude) continue; const dist = hav(f.taskLatitude, f.taskLongitude, t.taskLatitude, t.taskLongitude); const tm = Math.max(Math.round(dist / 50 * 60), 5); const [fH, fM] = (f.scheduledStartTime || "08:00").split(":").map(Number); const fe = fH * 60 + fM + (f.estimatedDuration || 60); const te = fe + tm; travels.push({ fromJobId: f.id, toJobId: t.id, minutes: tm, distanceKm: Math.round(dist * 10) / 10, startTime: `${Math.floor(fe / 60).toString().padStart(2, "0")}:${(fe % 60).toString().padStart(2, "0")}`, endTime: `${Math.floor(te / 60).toString().padStart(2, "0")}:${(te % 60).toString().padStart(2, "0")}` }); } if (travels.length > 0) result[res.id] = travels; }
    return result;
  }, [resources, currentDate, getJobsForResourceAndDay]);

  const getCapacityPercentage = useCallback((h: number) => Math.min((h / HOURS_IN_DAY) * 100, 100), []);
  const getCapacityColor = useCallback((p: number) => p >= 100 ? "bg-red-500" : p >= 85 ? "bg-orange-500" : p >= 65 ? "bg-yellow-500" : "bg-green-500", []);
  const getCapacityBgColor = useCallback((p: number) => p >= 100 ? "bg-red-50 dark:bg-red-950/20" : p >= 85 ? "bg-orange-50 dark:bg-orange-950/20" : p >= 65 ? "bg-yellow-50 dark:bg-yellow-950/20" : "", []);
  const getDropFitClass = useCallback((rid: string, dayStr: string, dur: number) => {
    const nh = (resourceDayJobMap.hours[rid]?.[dayStr] || 0) + dur / 60;
    const p = (nh / HOURS_IN_DAY) * 100;
    if (p > 110) return { bg: "bg-red-100 dark:bg-red-950/40 ring-red-400", label: "Överbokning", color: "text-red-600" };
    if (p > 85) return { bg: "bg-orange-100 dark:bg-orange-950/40 ring-orange-400", label: "Tight", color: "text-orange-600" };
    if (p > 65) return { bg: "bg-yellow-100 dark:bg-yellow-950/40 ring-yellow-400", label: "Bra", color: "text-yellow-600" };
    return { bg: "bg-green-100 dark:bg-green-950/40 ring-green-400", label: "Gott om plats", color: "text-green-600" };
  }, [resourceDayJobMap]);

  const resourceWeekSummary = useMemo(() => {
    const s: Record<string, { totalHours: number; weeklyCapacity: number; pct: number }> = {};
    const wd = viewMode === "week" ? visibleDates : [];
    for (const r of resources) { let th = 0; for (const d of wd) th += resourceDayJobMap.hours[r.id]?.[format(d, "yyyy-MM-dd")] || 0; const cap = r.weeklyHours || 40; s[r.id] = { totalHours: th, weeklyCapacity: cap, pct: cap > 0 ? Math.round((th / cap) * 100) : 0 }; }
    return s;
  }, [resources, visibleDates, viewMode, resourceDayJobMap]);

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
    if (dependenciesData?.dependencies) { for (const dep of (dependenciesData.dependencies[job.id] || [])) { const p = workOrders.find(wo => wo.id === dep.dependsOnWorkOrderId); if (p) { if (!p.scheduledDate || p.executionStatus === "not_planned") reasons.push(`Beroende "${p.title}" ej planerad`); else if (new Date(p.scheduledDate) > dateObj) reasons.push(`Beroende "${p.title}" planerad efter (${format(new Date(p.scheduledDate), "d MMM", { locale: sv })})`); } } }
    if (startTime) { const [jH, jM] = startTime.split(":").map(Number); const jS = jH * 60 + jM; const jE = jS + (job.estimatedDuration || 60); for (const other of scheduledJobs.filter(j => j.id !== job.id && j.resourceId === resourceId && j.scheduledDate && isSameDay(new Date(j.scheduledDate), dateObj))) { if (!other.scheduledStartTime) continue; const [oH, oM] = other.scheduledStartTime.split(":").map(Number); if (jS < oH * 60 + oM + (other.estimatedDuration || 60) && jE > oH * 60 + oM) { reasons.push(`Överlapp med "${other.title}" (${other.scheduledStartTime})`); break; } } }
    return reasons;
  }, [scheduledJobs, timewindowMap, restrictionsByObject, dependenciesData, workOrders]);

  const jobConflicts = useMemo(() => { const c: Record<string, string[]> = {}; for (const j of scheduledJobs) { if (!j.scheduledDate || !j.resourceId) continue; const r = detectConflictsForJob(j, j.resourceId, format(new Date(j.scheduledDate), "yyyy-MM-dd"), j.scheduledStartTime || null); if (r.length > 0) c[j.id] = r; } return c; }, [scheduledJobs, detectConflictsForJob]);

  const addToUndoStack = useCallback((action: PlannerAction) => { setUndoStack(prev => [...prev.slice(-19), action]); setRedoStack([]); }, []);

  const executeSchedule = useCallback((jobId: string, resourceId: string, scheduledDate: string, scheduledStartTime?: string) => {
    const job = workOrders.find(j => j.id === jobId);
    if (!job) return;
    addToUndoStack({ type: "schedule", jobId, previousState: { resourceId: job.resourceId || null, scheduledDate: job.scheduledDate ? format(new Date(job.scheduledDate), "yyyy-MM-dd") : null, scheduledStartTime: job.scheduledStartTime || null, orderStatus: job.orderStatus }, newState: { resourceId, scheduledDate, scheduledStartTime: scheduledStartTime || null, orderStatus: "planerad_resurs" } });
    updateWorkOrderMutation.mutate({ id: jobId, resourceId, scheduledDate, scheduledStartTime });
  }, [workOrders, addToUndoStack, updateWorkOrderMutation]);

  const navigate = (direction: "prev" | "next") => {
    if (viewMode === "day" || viewMode === "route") { const d = addDays(currentDate, direction === "next" ? 1 : -1); setCurrentDate(d); setCurrentWeekStart(startOfWeek(d, { weekStartsOn: 1 })); }
    else if (viewMode === "week") { const ws = addDays(currentWeekStart, direction === "next" ? 7 : -7); setCurrentWeekStart(ws); setCurrentDate(ws); }
    else { const d = addMonths(currentDate, direction === "next" ? 1 : -1); setCurrentDate(d); setCurrentWeekStart(startOfWeek(d, { weekStartsOn: 1 })); }
  };
  const handleViewModeChange = (m: ViewMode) => { if (m === "week") setCurrentWeekStart(startOfWeek(currentDate, { weekStartsOn: 1 })); setViewMode(m); };
  const goToToday = () => { const t = new Date(); setCurrentDate(t); setCurrentWeekStart(startOfWeek(t, { weekStartsOn: 1 })); };
  const goToDay = (day: Date) => { setCurrentDate(day); setCurrentWeekStart(startOfWeek(day, { weekStartsOn: 1 })); setViewMode("day"); };
  const getHeaderLabel = () => { if (viewMode === "day" || viewMode === "route") return format(currentDate, "EEEE d MMMM yyyy", { locale: sv }); if (viewMode === "week") return `Vecka ${format(currentWeekStart, "w", { locale: sv })} - ${format(currentWeekStart, "MMMM yyyy", { locale: sv })}`; return format(currentDate, "MMMM yyyy", { locale: sv }); };

  const handleJobClick = useCallback((jobId: string) => { setSelectedJob(jobId); }, []);
  const handleOpenAssignDialog = useCallback((job: WorkOrderWithObject, e: React.MouseEvent) => { e.stopPropagation(); setJobToAssign(job); setAssignDate(format(currentDate, "yyyy-MM-dd")); setAssignResourceId(null); setAssignDialogOpen(true); }, [currentDate]);
  const handleQuickAssign = useCallback(() => { if (!jobToAssign || !assignResourceId || !assignDate) return; updateWorkOrderMutation.mutate({ id: jobToAssign.id, resourceId: assignResourceId, scheduledDate: assignDate }); setAssignDialogOpen(false); setJobToAssign(null); setAssignResourceId(null); }, [jobToAssign, assignResourceId, assignDate, updateWorkOrderMutation]);

  const handleAcceptConflict = useCallback(() => {
    if (!pendingSchedule) return;
    if (pendingSchedule.bulkJobs && pendingSchedule.bulkJobs.length > 0) {
      for (const bj of pendingSchedule.bulkJobs) {
        executeSchedule(bj.jobId, pendingSchedule.resourceId, pendingSchedule.scheduledDate, bj.startTime);
      }
      toast({ title: "Bulk-flytt klar trots varning", description: `${pendingSchedule.bulkJobs.length} order schemalagda trots konflikter.` });
    } else {
      executeSchedule(pendingSchedule.jobId, pendingSchedule.resourceId, pendingSchedule.scheduledDate, pendingSchedule.scheduledStartTime);
      toast({ title: "Schemalagt trots varning", description: "Jobbet har schemalagts trots identifierade konflikter." });
    }
    setConflictDialogOpen(false);
    setPendingSchedule(null);
  }, [pendingSchedule, executeSchedule, toast]);

  const handleUnschedule = useCallback((e: { stopPropagation: () => void }, jobId: string) => { e.stopPropagation(); const job = workOrders.find(j => j.id === jobId); if (job) addToUndoStack({ type: "unschedule", jobId, previousState: { resourceId: job.resourceId || null, scheduledDate: job.scheduledDate ? format(new Date(job.scheduledDate), "yyyy-MM-dd") : null, scheduledStartTime: job.scheduledStartTime || null, orderStatus: job.orderStatus }, newState: { resourceId: null, scheduledDate: null, scheduledStartTime: null, orderStatus: "skapad" } }); unscheduleWorkOrderMutation.mutate(jobId); }, [workOrders, addToUndoStack, unscheduleWorkOrderMutation]);

  const handleUndo = useCallback(() => { if (undoStack.length === 0) return; const last = undoStack[undoStack.length - 1]; setUndoStack(prev => prev.slice(0, -1)); setRedoStack(prev => [...prev, last]); applyActionMutation.mutate({ jobId: last.jobId, state: last.previousState }); toast({ title: "Ändring ångrad" }); }, [undoStack, applyActionMutation, toast]);
  const handleRedo = useCallback(() => { if (redoStack.length === 0) return; const last = redoStack[redoStack.length - 1]; setRedoStack(prev => prev.slice(0, -1)); setUndoStack(prev => [...prev, last]); applyActionMutation.mutate({ jobId: last.jobId, state: last.newState }); toast({ title: "Ändring återställd" }); }, [redoStack, applyActionMutation, toast]);

  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); if (undoStack.length > 0) handleUndo(); } if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); if (redoStack.length > 0) handleRedo(); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [handleUndo, handleRedo, undoStack.length, redoStack.length]);

  const handleResourceClick = useCallback((rid: string) => setActiveResourceId(rid), []);
  const activeResource = useMemo(() => activeResourceId ? resources.find(r => r.id === activeResourceId) || null : null, [activeResourceId, resources]);
  const activeResourceJobs = useMemo(() => activeResourceId ? scheduledJobs.filter(j => j.resourceId === activeResourceId).sort((a, b) => { if (!a.scheduledDate || !b.scheduledDate) return 0; return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime(); }) : [], [activeResourceId, scheduledJobs]);
  const activeResourceJobsByDay = useMemo(() => { const m: Record<string, WorkOrderWithObject[]> = {}; for (const j of activeResourceJobs) { if (!j.scheduledDate) continue; const dk = (typeof j.scheduledDate === "string" ? j.scheduledDate : (j.scheduledDate as Date).toISOString()).split("T")[0]; if (!m[dk]) m[dk] = []; m[dk].push(j); } return m; }, [activeResourceJobs]);

  const handleSendSchedule = useCallback((r: Resource) => { setSendScheduleResource(r); setSendScheduleCopied(false); setSendScheduleDialogOpen(true); }, []);
  const getResourceScheduleJobs = useCallback((rid: string) => { const sd = viewMode === "week" ? currentWeekStart : currentDate; const ed = viewMode === "week" ? addDays(currentWeekStart, 4) : viewMode === "month" ? addDays(startOfMonth(currentDate), getDaysInMonth(currentDate) - 1) : currentDate; return workOrders.filter(j => j.resourceId === rid && j.scheduledDate && new Date(j.scheduledDate) >= sd && new Date(j.scheduledDate) <= ed).map(j => ({ id: j.id, title: j.title, objectName: j.objectName || undefined, objectAddress: j.objectAddress || undefined, scheduledDate: typeof j.scheduledDate === "string" ? j.scheduledDate : j.scheduledDate instanceof Date ? j.scheduledDate.toISOString() : new Date(String(j.scheduledDate)).toISOString(), scheduledStartTime: j.scheduledStartTime || undefined, estimatedDuration: j.estimatedDuration || undefined, accessCode: j.objectAccessCode || undefined, keyNumber: j.objectKeyNumber || undefined })); }, [workOrders, viewMode, currentWeekStart, currentDate]);

  const handleSendScheduleEmail = useCallback(() => { if (!sendScheduleResource) return; const jobs = getResourceScheduleJobs(sendScheduleResource.id); if (jobs.length === 0) { toast({ title: "Inga jobb att skicka", description: "Resursen har inga planerade jobb för denna period.", variant: "destructive" }); return; } const sd = viewMode === "week" ? format(currentWeekStart, "yyyy-MM-dd") : format(currentDate, "yyyy-MM-dd"); const ed = viewMode === "week" ? format(addDays(currentWeekStart, 4), "yyyy-MM-dd") : viewMode === "month" ? format(addDays(startOfMonth(currentDate), getDaysInMonth(currentDate) - 1), "yyyy-MM-dd") : format(currentDate, "yyyy-MM-dd"); sendScheduleMutation.mutate({ resourceId: sendScheduleResource.id, jobs, dateRange: { start: sd, end: ed } }); }, [sendScheduleResource, getResourceScheduleJobs, sendScheduleMutation, viewMode, currentWeekStart, currentDate, toast]);

  const handleCopyFieldAppLink = useCallback(async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/field`); setSendScheduleCopied(true); toast({ title: "Länk kopierad!", description: "Klistra in i SMS eller meddelande." }); setTimeout(() => setSendScheduleCopied(false), 3000); } catch { toast({ title: "Kunde inte kopiera", variant: "destructive" }); } }, [toast]);

  const handleOptimizeRoute = useCallback(async () => { if (routeJobsForView.length < 2) return; setIsOptimizing(true); try { const stops = routeJobsForView.map(j => ({ workOrderId: j.id, objectId: j.objectId || "", objectName: j.objectName || j.title, latitude: j.taskLatitude || 0, longitude: j.taskLongitude || 0, estimatedDuration: j.estimatedDuration || 0, scheduledStartTime: j.scheduledStartTime || undefined })); const result = await (await apiRequest("POST", "/api/route/optimize", { stops })).json(); if (result.optimizedStops) { setRouteJobOrder(result.optimizedStops.map((s: { workOrderId: string }) => s.workOrderId)); toast({ title: "Rutt optimerad", description: `Körsträcka minskad med ${result.savingsPercent}% (${result.originalDistance} km → ${result.optimizedDistance} km)` }); } } catch { toast({ title: "Fel vid optimering", description: "Kunde inte optimera rutten", variant: "destructive" }); } finally { setIsOptimizing(false); } }, [routeJobsForView, toast]);

  const handleClearAllScheduled = async () => {
    setClearLoading(true);
    try { let cs: Date, ce: Date; if (viewMode === "month") { cs = startOfMonth(currentDate); ce = addDays(cs, getDaysInMonth(currentDate) - 1); } else if (viewMode === "day") { cs = currentDate; ce = currentDate; } else { cs = currentWeekStart; ce = addDays(currentWeekStart, 4); } const data = await (await apiRequest("POST", "/api/work-orders/bulk-unschedule", { startDate: format(cs, "yyyy-MM-dd"), endDate: format(ce, "yyyy-MM-dd") })).json(); queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] }); setUnscheduledPage(0); setClearDialogOpen(false); toast({ title: "Planering rensad", description: `${data.count} jobb avplanerade och flyttade tillbaka till orderstocken.` }); } catch { toast({ title: "Fel", description: "Kunde inte rensa planeringen", variant: "destructive" }); } finally { setClearLoading(false); }
  };

  const handleAutoFillPreview = async () => {
    setAutoFillLoading(true); setAutoFillPreview(null);
    try { const ws = viewMode === "week" ? currentWeekStart : startOfWeek(currentDate, { weekStartsOn: 1 }); const data = await (await apiRequest("POST", "/api/auto-plan-week", { weekStartDate: format(ws, "yyyy-MM-dd"), resourceIds: resources.map(r => r.id), overbookingPercent: autoFillOverbooking })).json(); setAutoFillPreview(data.assignments || []); setAutoFillSkipped(data.totalSkipped || 0); setAutoFillDiag(data.totalUnscheduled != null ? { totalUnscheduled: data.totalUnscheduled, capacityPerDay: data.capacityPerDay || {}, maxMinutesPerDay: data.maxMinutesPerDay || 480, resourceCount: data.resourceCount || 0, clusterSkipped: data.clusterSkipped || 0 } : null); } catch { toast({ title: "Fel", description: "Kunde inte generera planering", variant: "destructive" }); } finally { setAutoFillLoading(false); }
  };

  const handleAutoFillApply = async () => {
    if (!autoFillPreview || autoFillPreview.length === 0) return; setAutoFillApplying(true);
    try { const data = await (await apiRequest("POST", "/api/auto-plan-week/apply", { assignments: autoFillPreview })).json(); toast({ title: "Planering tillämpad", description: `${data.applied} uppdrag planerade${autoFillSkipped > 0 ? `, ${autoFillSkipped} ryms ej denna vecka` : ""}` }); setAutoFillDialogOpen(false); setAutoFillPreview(null); queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] }); setUnscheduledPage(0); } catch { toast({ title: "Fel", description: "Kunde inte tillämpa planering", variant: "destructive" }); } finally { setAutoFillApplying(false); }
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
    } catch { toast({ title: "Fel", description: "Kunde inte flytta jobb", variant: "destructive" }); }
  }, [toast]);

  const handleOpenDepChain = useCallback((jobId: string) => { setDepChainJobId(jobId); setDepChainDialogOpen(true); }, []);
  const handleToggleSubStep = useCallback((jobId: string) => setExpandedSubSteps(prev => ({ ...prev, [jobId]: !prev[jobId] })), []);

  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);
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

  return {
    viewMode, currentDate, currentWeekStart, selectedJob, showUnscheduled, setShowUnscheduled,
    filterCustomer, setFilterCustomer, filterPriority, setFilterPriority,
    filterCluster, setFilterCluster, filterTeam, setFilterTeam,
    filterExecutionCode, setFilterExecutionCode,
    hiddenResourceIds, setHiddenResourceIds,
    orderstockSearch, setOrderstockSearch, sidebarFiltersOpen, setSidebarFiltersOpen,
    zoomLevel, setZoomLevel, expandedSubSteps, activeDragJob, setActiveDragJob,
    activeResourceId, setActiveResourceId, activeResource, activeResourceJobs, activeResourceJobsByDay,
    undoStack, redoStack,
    routeViewResourceId, setRouteViewResourceId, routeJobOrder, setRouteJobOrder, isOptimizing,
    assignDialogOpen, setAssignDialogOpen, jobToAssign, assignDate, setAssignDate, assignResourceId, setAssignResourceId,
    sendScheduleDialogOpen, setSendScheduleDialogOpen, sendScheduleResource, sendScheduleCopied,
    conflictDialogOpen, setConflictDialogOpen, pendingSchedule, setPendingSchedule,
    autoFillDialogOpen, setAutoFillDialogOpen, autoFillOverbooking, setAutoFillOverbooking,
    autoFillLoading, autoFillPreview, autoFillApplying, autoFillSkipped, autoFillDiag,
    clearDialogOpen, setClearDialogOpen, clearLoading,
    depChainDialogOpen, setDepChainDialogOpen, depChainJobId, depChainData,
    resources, resourcesLoading, visibleResources, visibleDates,
    customers, clusters, clusterMap, customerMap, teamsData,
    workOrders, workOrdersLoading,
    dependenciesData, timeRestrictions, restrictionsByObject, timewindowMap,
    weatherByDate,
    unscheduledJobs, unscheduledTotal, accumulatedUnscheduled, hasMoreUnscheduled, loadMoreLoading, loadMoreUnscheduled,
    sidebarActiveFilterCount, clearAllSidebarFilters, sidebarQuickStats,
    scheduledJobs, filteredScheduledJobs, currentViewScheduledJobs,
    resourceDayJobMap, routeJobsForView,
    weekGoals, weekTravelTotal, travelTimesForDay,
    getJobsForResourceAndDay, getResourceDayHours,
    getCapacityPercentage, getCapacityColor, getCapacityBgColor, getDropFitClass,
    resourceWeekSummary, jobConflicts,
    updateWorkOrderMutation, unscheduleWorkOrderMutation, sendScheduleMutation,
    navigate, handleViewModeChange, goToToday, goToDay, getHeaderLabel,
    handleJobClick, handleOpenAssignDialog, handleQuickAssign,
    handleAcceptConflict, handleUnschedule, handleUndo, handleRedo,
    handleResourceClick, handleSendSchedule, handleSendScheduleEmail, handleCopyFieldAppLink,
    handleOptimizeRoute, handleClearAllScheduled, handleAutoFillPreview, handleAutoFillApply, handleCarryOver,
    handleOpenDepChain, handleToggleSubStep,
    executeSchedule, detectConflictsForJob,
    selectedJobIds, toggleJobSelection, clearSelection, selectAllVisible,
    toast,
  };
}
