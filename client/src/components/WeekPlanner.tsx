import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor, KeyboardSensor, closestCenter, type DragStartEvent, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, User } from "lucide-react";
import { format, addDays, startOfWeek, startOfMonth, isSameDay, getDaysInMonth, addMonths } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrderWithObject, Customer, TaskDependency, Cluster, ObjectTimeRestriction } from "@shared/schema";
import { RESTRICTION_TYPE_LABELS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

import type { ViewMode, WeekPlannerProps, PlannerAction, WeatherForecastData, WeatherImpactDay } from "./weekplanner/types";
import { HOURS_IN_DAY, DAY_START_HOUR, DAY_END_HOUR, zoomLevels } from "./weekplanner/types";
import { DroppableCell } from "./weekplanner/DndComponents";
import { JobCard, DragOverlayContent } from "./weekplanner/JobCard";
import { UnscheduledSidebar } from "./weekplanner/UnscheduledSidebar";
import { AssignDialog, SendScheduleDialog, ConflictDialog, ClearDialog, AutoFillDialog, DepChainDialog } from "./weekplanner/PlannerDialogs";
import { PlannerToolbar, PlannerFooter } from "./weekplanner/PlannerToolbar";
import { DayTimelineView } from "./weekplanner/DayTimelineView";
import { WeekGridView } from "./weekplanner/WeekGridView";
import { MonthView } from "./weekplanner/MonthView";
import { RouteMapView } from "./weekplanner/RouteMapView";

export function WeekPlanner({ onAddJob, onSelectJob, showAIPanel, onToggleAIPanel }: WeekPlannerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [showUnscheduled, setShowUnscheduled] = useState(true);
  const [filterCustomer, setFilterCustomer] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterCluster, setFilterCluster] = useState<string>("all");
  const [filterTeam, setFilterTeam] = useState<string>("all");
  const [filterExecutionCode, setFilterExecutionCode] = useState<string>("all");
  const [hiddenResourceIds, setHiddenResourceIds] = useState<Set<string>>(new Set());
  const [orderstockSearch, setOrderstockSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sidebarFiltersOpen, setSidebarFiltersOpen] = useState(false);
  const [unscheduledPage, setUnscheduledPage] = useState(0);
  const UNSCHEDULED_PAGE_SIZE = 50;

  const [activeResourceId, setActiveResourceId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<PlannerAction[]>([]);
  const [redoStack, setRedoStack] = useState<PlannerAction[]>([]);
  const [activeDragJob, setActiveDragJob] = useState<WorkOrderWithObject | null>(null);
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
  const [pendingSchedule, setPendingSchedule] = useState<{ jobId: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string; conflicts: string[] } | null>(null);
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
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [expandedSubSteps, setExpandedSubSteps] = useState<Record<string, boolean>>({});
  const zoom = zoomLevels[zoomLevel];
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const { data: teamsData = [] } = useQuery<Array<{ id: string; name: string; clusterId: string | null; color: string | null }>>({ queryKey: ["/api/teams"] });
  const { data: teamMembersData = [] } = useQuery<Array<{ teamId: string; resourceId: string }>>({ queryKey: ["/api/team-members"] });

  const teamResourceIds = useMemo(() => {
    if (filterTeam === "all") return null;
    const ids = new Set<string>();
    teamMembersData.forEach(tm => { if (tm.teamId === filterTeam) ids.add(tm.resourceId); });
    return ids;
  }, [filterTeam, teamMembersData]);

  const visibleDates = useMemo((): Date[] => {
    if (viewMode === "day") return [currentDate];
    if (viewMode === "week") return Array.from({ length: 5 }, (_, i) => addDays(currentWeekStart, i));
    const monthStart = startOfMonth(currentDate);
    return Array.from({ length: getDaysInMonth(currentDate) }, (_, i) => addDays(monthStart, i));
  }, [viewMode, currentDate, currentWeekStart]);

  const { data: resources = [], isLoading: resourcesLoading } = useQuery<Resource[]>({ queryKey: ["/api/resources"] });
  const { data: weatherData } = useQuery<WeatherForecastData>({ queryKey: ["/api/weather/forecast"], staleTime: 30 * 60 * 1000 });

  const weatherByDate = useMemo(() => {
    const map = new Map<string, { forecast: WeatherForecastData["forecasts"][0]; impact: WeatherImpactDay }>();
    if (!weatherData?.forecasts || !weatherData?.impacts) return map;
    weatherData.forecasts.forEach((f, i) => {
      const impact = weatherData.impacts[i];
      if (impact) map.set(f.date, { forecast: f, impact });
    });
    return map;
  }, [weatherData]);

  const visibleResources = useMemo(() => {
    if (hiddenResourceIds.size === 0) return resources;
    return resources.filter(r => !hiddenResourceIds.has(r.id));
  }, [resources, hiddenResourceIds]);

  const dateRange = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    return { startDate: format(addDays(monthStart, -14), "yyyy-MM-dd"), endDate: format(addDays(monthStart, 45), "yyyy-MM-dd") };
  }, [currentDate.getFullYear(), currentDate.getMonth()]);

  const { data: scheduledWorkOrders = [], isLoading: scheduledLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders", "scheduled", dateRange.startDate, dateRange.endDate],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch scheduled work orders");
      return res.json();
    },
    staleTime: 60000,
  });

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(orderstockSearch); setUnscheduledPage(0); }, 300);
    return () => clearTimeout(timer);
  }, [orderstockSearch]);

  const unscheduledQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("status", "unscheduled");
    params.set("limit", String(UNSCHEDULED_PAGE_SIZE));
    params.set("offset", "0");
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    return params.toString();
  }, [debouncedSearch, UNSCHEDULED_PAGE_SIZE]);

  const { data: unscheduledData, isLoading: unscheduledLoading } = useQuery<{ workOrders: WorkOrderWithObject[]; total: number }>({
    queryKey: ["/api/work-orders", "unscheduled-paginated", debouncedSearch],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders?${unscheduledQueryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch unscheduled work orders");
      return res.json();
    },
    staleTime: 120000,
  });

  const [accumulatedUnscheduled, setAccumulatedUnscheduled] = useState<WorkOrderWithObject[]>([]);
  const [unscheduledTotal, setUnscheduledTotal] = useState(0);

  useEffect(() => {
    if (unscheduledData) {
      if (unscheduledPage === 0) {
        setAccumulatedUnscheduled(unscheduledData.workOrders);
      } else {
        setAccumulatedUnscheduled(prev => {
          const existingIds = new Set(prev.map(wo => wo.id));
          return [...prev, ...unscheduledData.workOrders.filter(wo => !existingIds.has(wo.id))];
        });
      }
      setUnscheduledTotal(unscheduledData.total);
    }
  }, [unscheduledData, unscheduledPage]);

  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const loadMoreUnscheduled = useCallback(async () => {
    const nextPage = unscheduledPage + 1;
    setLoadMoreLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", "unscheduled");
      params.set("limit", String(UNSCHEDULED_PAGE_SIZE));
      params.set("offset", String(nextPage * UNSCHEDULED_PAGE_SIZE));
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      const res = await fetch(`/api/work-orders?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load more");
      const data: { workOrders: WorkOrderWithObject[]; total: number } = await res.json();
      setAccumulatedUnscheduled(prev => {
        const existingIds = new Set(prev.map(wo => wo.id));
        return [...prev, ...data.workOrders.filter(wo => !existingIds.has(wo.id))];
      });
      setUnscheduledTotal(data.total);
      setUnscheduledPage(nextPage);
    } finally { setLoadMoreLoading(false); }
  }, [unscheduledPage, UNSCHEDULED_PAGE_SIZE, debouncedSearch]);

  const hasMoreUnscheduled = accumulatedUnscheduled.length < unscheduledTotal;

  const workOrders = useMemo(() => {
    const ids = new Set(scheduledWorkOrders.map(wo => wo.id));
    return [...scheduledWorkOrders, ...accumulatedUnscheduled.filter(wo => !ids.has(wo.id))];
  }, [scheduledWorkOrders, accumulatedUnscheduled]);

  const workOrdersLoading = scheduledLoading || unscheduledLoading;
  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: clusters = [] } = useQuery<Cluster[]>({ queryKey: ["/api/clusters"] });
  const clusterMap = useMemo(() => new Map(clusters.map(c => [c.id, c])), [clusters]);
  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  const workOrderIds = useMemo(() => workOrders.map(wo => wo.id), [workOrders]);

  const { data: dependenciesData } = useQuery<{ dependencies: Record<string, TaskDependency[]>; dependents: Record<string, TaskDependency[]> }>({
    queryKey: ["/api/task-dependencies/batch", workOrderIds.join(",")],
    queryFn: async () => {
      if (workOrderIds.length === 0) return { dependencies: {}, dependents: {} };
      const res = await apiRequest("POST", "/api/task-dependencies/batch", { workOrderIds });
      return res.json();
    },
    enabled: workOrderIds.length > 0,
    staleTime: 120000,
  });

  const { data: depChainData } = useQuery<{ chain: Array<{ type: string; dependencyType: string; workOrder: { id: string; title: string; status: string; executionStatus: string; scheduledDate: string | null; scheduledStartTime: string | null; creationMethod: string | null } }> }>({
    queryKey: ["/api/work-orders", depChainJobId, "dependency-chain"],
    queryFn: async () => {
      if (!depChainJobId) return { chain: [] };
      const res = await apiRequest("GET", `/api/work-orders/${depChainJobId}/dependency-chain`);
      return res.json();
    },
    enabled: !!depChainJobId && depChainDialogOpen,
  });

  const scheduledObjectIds = useMemo(() => Array.from(new Set(workOrders.map(wo => wo.objectId).filter(Boolean) as string[])), [workOrders]);

  const { data: timeRestrictions = [] } = useQuery<ObjectTimeRestriction[]>({
    queryKey: ["/api/time-restrictions", scheduledObjectIds.join(",")],
    queryFn: async () => {
      if (scheduledObjectIds.length === 0) return [];
      const res = await apiRequest("GET", `/api/time-restrictions?objectIds=${scheduledObjectIds.join(",")}`);
      return res.json();
    },
    enabled: scheduledObjectIds.length > 0,
    staleTime: 120000,
  });

  const restrictionsByObject = useMemo(() => {
    const map = new Map<string, ObjectTimeRestriction[]>();
    for (const r of timeRestrictions) {
      if (!map.has(r.objectId)) map.set(r.objectId, []);
      map.get(r.objectId)!.push(r);
    }
    return map;
  }, [timeRestrictions]);

  const { data: timewindowsData = [] } = useQuery<Array<{ workOrderId: string; dayOfWeek: string | null; startTime: string | null; endTime: string | null; weekNumber: number | null }>>({
    queryKey: ["/api/task-timewindows"],
    staleTime: 120000,
  });

  const timewindowMap = useMemo(() => {
    const map = new Map<string, typeof timewindowsData>();
    timewindowsData.forEach(tw => {
      const existing = map.get(tw.workOrderId) || [];
      existing.push(tw);
      map.set(tw.workOrderId, existing);
    });
    return map;
  }, [timewindowsData]);

  const workOrdersQueryKey = ["/api/work-orders", dateRange.startDate, dateRange.endDate];

  const updateWorkOrderMutation = useMutation({
    mutationFn: async ({ id, resourceId, scheduledDate, scheduledStartTime }: { id: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string }) => {
      const payload: Record<string, unknown> = { resourceId, scheduledDate, status: "scheduled", orderStatus: "planerad_resurs" };
      if (scheduledStartTime) payload.scheduledStartTime = scheduledStartTime;
      return (await apiRequest("PATCH", `/api/work-orders/${id}`, payload)).json() as Promise<WorkOrderWithObject>;
    },
    onMutate: async ({ id, resourceId, scheduledDate }) => {
      await queryClient.cancelQueries({ queryKey: workOrdersQueryKey });
      const previousData = queryClient.getQueryData<WorkOrderWithObject[]>(workOrdersQueryKey);
      queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old =>
        old?.map(job => job.id === id ? { ...job, resourceId, scheduledDate: new Date(scheduledDate + "T12:00:00Z"), status: "scheduled" as const, orderStatus: "planerad_resurs" as const } : job)
      );
      return { previousData };
    },
    onSuccess: (updatedWorkOrder, variables) => {
      queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old =>
        old?.map(job => job.id === variables.id ? { ...job, ...updatedWorkOrder } : job)
      );
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", "unscheduled-paginated"] });
      setUnscheduledPage(0);
    },
    onError: (error, _variables, context) => {
      if (context?.previousData) queryClient.setQueryData(workOrdersQueryKey, context.previousData);
      toast({ title: "Fel", description: "Kunde inte uppdatera jobbet.", variant: "destructive" });
    },
  });

  const unscheduleWorkOrderMutation = useMutation({
    mutationFn: async (id: string) => {
      return (await apiRequest("PATCH", `/api/work-orders/${id}`, { resourceId: null, scheduledDate: null, scheduledStartTime: null, status: "draft", orderStatus: "skapad" })).json() as Promise<WorkOrderWithObject>;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: workOrdersQueryKey });
      const previousData = queryClient.getQueryData<WorkOrderWithObject[]>(workOrdersQueryKey);
      queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old =>
        old?.map(job => job.id === id ? { ...job, resourceId: null, scheduledDate: null, scheduledStartTime: null, status: "draft" as const, orderStatus: "skapad" as const } : job)
      );
      return { previousData };
    },
    onSuccess: (updatedWorkOrder, id) => {
      queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, old =>
        old?.map(job => job.id === id ? { ...job, ...updatedWorkOrder } : job)
      );
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", "unscheduled-paginated"] });
      setUnscheduledPage(0);
      toast({ title: "Avschemalagt", description: "Jobbet flyttades tillbaka till oschemalagda." });
    },
    onError: (error, _id, context) => {
      if (context?.previousData) queryClient.setQueryData(workOrdersQueryKey, context.previousData);
      toast({ title: "Fel", description: "Kunde inte avschemalägg jobbet.", variant: "destructive" });
    },
  });

  const applyActionMutation = useMutation({
    mutationFn: async ({ jobId, state }: { jobId: string; state: PlannerAction["previousState"] }) => {
      return (await apiRequest("PATCH", `/api/work-orders/${jobId}`, { resourceId: state.resourceId, scheduledDate: state.scheduledDate, scheduledStartTime: state.scheduledStartTime, status: state.status, orderStatus: state.orderStatus })).json() as Promise<WorkOrderWithObject>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workOrdersQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", "unscheduled-paginated"] });
      setUnscheduledPage(0);
    },
    onError: () => { toast({ title: "Fel", description: "Kunde inte ångra/göra om ändringen.", variant: "destructive" }); },
  });

  const sendScheduleMutation = useMutation({
    mutationFn: async ({ resourceId, jobs, dateRange }: { resourceId: string; jobs: Array<{ id: string; title: string; objectName?: string; objectAddress?: string; scheduledDate: string; scheduledStartTime?: string; estimatedDuration?: number; accessCode?: string; keyNumber?: string }>; dateRange: { start: string; end: string } }) => {
      return (await apiRequest("POST", `/api/notifications/send-schedule/${resourceId}`, { jobs, dateRange, fieldAppUrl: `${window.location.origin}/field` })).json();
    },
    onSuccess: (data) => {
      if (data.success) { toast({ title: "Schema skickat!", description: `Schemat har skickats till ${data.recipient}` }); setSendScheduleDialogOpen(false); }
      else { toast({ title: "Kunde inte skicka", description: data.error || "Ett fel uppstod", variant: "destructive" }); }
    },
    onError: (error) => { toast({ title: "Fel", description: error instanceof Error ? error.message : "Kunde inte skicka schema", variant: "destructive" }); },
  });

  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

  const unscheduledJobs = useMemo(() => {
    const jobs = workOrders.filter(job => !job.scheduledDate || !job.resourceId);
    const searchLower = orderstockSearch.toLowerCase().trim();
    return jobs.filter(job => {
      if (filterCustomer !== "all" && job.customerId !== filterCustomer) return false;
      if (filterPriority !== "all" && job.priority !== filterPriority) return false;
      if (filterCluster !== "all") { if (filterCluster === "none" ? job.clusterId : job.clusterId !== filterCluster) return false; }
      if (filterTeam !== "all") { if (job.teamId && job.teamId !== filterTeam) return false; if (!job.teamId && teamResourceIds && job.resourceId && !teamResourceIds.has(job.resourceId)) return false; }
      if (filterExecutionCode !== "all" && (job as any).executionCode !== filterExecutionCode) return false;
      if (searchLower) {
        const t = (job.title || "").toLowerCase(); const o = (job.objectName || "").toLowerCase(); const c = (customerMap.get(job.customerId)?.name || "").toLowerCase();
        if (!t.includes(searchLower) && !o.includes(searchLower) && !c.includes(searchLower)) return false;
      }
      return true;
    }).sort((a, b) => {
      const ap = priorityOrder[a.priority] ?? 99; const bp = priorityOrder[b.priority] ?? 99;
      if (ap !== bp) return ap - bp;
      return (a.plannedWindowEnd ? new Date(a.plannedWindowEnd).getTime() : Infinity) - (b.plannedWindowEnd ? new Date(b.plannedWindowEnd).getTime() : Infinity);
    });
  }, [workOrders, filterCustomer, filterPriority, filterCluster, filterTeam, teamResourceIds, filterExecutionCode, orderstockSearch, customerMap]);

  const sidebarActiveFilterCount = [filterCustomer !== "all", filterPriority !== "all", filterCluster !== "all", filterTeam !== "all", filterExecutionCode !== "all"].filter(Boolean).length;
  const clearAllSidebarFilters = () => { setFilterCustomer("all"); setFilterPriority("all"); setFilterCluster("all"); setFilterTeam("all"); setFilterExecutionCode("all"); setOrderstockSearch(""); };

  const sidebarQuickStats = useMemo(() => {
    const all = workOrders.filter(j => !j.scheduledDate || !j.resourceId);
    return {
      urgentCount: all.filter(j => j.priority === "urgent").length,
      highCount: all.filter(j => j.priority === "high").length,
      overdueCount: all.filter(j => j.plannedWindowEnd && new Date(j.plannedWindowEnd) < new Date()).length,
      totalHours: Math.round(all.reduce((s, j) => s + (j.estimatedDuration || 0) / 60, 0) * 10) / 10,
    };
  }, [workOrders]);

  const scheduledJobs = useMemo(() => workOrders.filter(j => j.scheduledDate && j.resourceId), [workOrders]);
  const filteredScheduledJobs = useMemo(() => scheduledJobs.filter(j => {
    if (filterCustomer !== "all" && j.customerId !== filterCustomer) return false;
    if (filterPriority !== "all" && j.priority !== filterPriority) return false;
    return true;
  }), [scheduledJobs, filterCustomer, filterPriority]);

  const currentViewScheduledJobs = useMemo(() => {
    let rangeStart: Date, rangeEnd: Date;
    if (viewMode === "month") { rangeStart = startOfMonth(currentDate); rangeEnd = addDays(rangeStart, getDaysInMonth(currentDate)); }
    else if (viewMode === "day") { rangeStart = new Date(currentDate); rangeStart.setHours(0, 0, 0, 0); rangeEnd = addDays(rangeStart, 1); }
    else { rangeStart = currentWeekStart; rangeEnd = addDays(currentWeekStart, 5); }
    return filteredScheduledJobs.filter(j => { if (!j.scheduledDate) return false; const d = new Date(j.scheduledDate); return d >= rangeStart && d < rangeEnd; });
  }, [filteredScheduledJobs, viewMode, currentWeekStart, currentDate]);

  const resourceDayJobMap = useMemo(() => {
    const map: Record<string, Record<string, WorkOrderWithObject[]>> = {};
    const hoursMap: Record<string, Record<string, number>> = {};
    for (const job of filteredScheduledJobs) {
      if (!job.resourceId || !job.scheduledDate) continue;
      const rid = job.resourceId;
      const dateStr = typeof job.scheduledDate === "string" ? job.scheduledDate : (job.scheduledDate as Date).toISOString();
      const dayKey = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr.split(" ")[0];
      if (!map[rid]) { map[rid] = {}; hoursMap[rid] = {}; }
      if (!map[rid][dayKey]) { map[rid][dayKey] = []; hoursMap[rid][dayKey] = 0; }
      map[rid][dayKey].push(job);
      const dur = (job.estimatedDuration || 0) / 60;
      const mult = weatherByDate.get(dayKey)?.impact.capacityMultiplier ?? 1;
      hoursMap[rid][dayKey] += mult > 0 && mult < 1 ? dur / mult : dur;
    }
    return { jobs: map, hours: hoursMap };
  }, [filteredScheduledJobs, weatherByDate]);

  const routeJobsForView = useMemo(() => {
    if (viewMode !== "route" || !routeViewResourceId) return [];
    const dateKey = format(currentDate, "yyyy-MM-dd");
    const base = (resourceDayJobMap.jobs[routeViewResourceId]?.[dateKey] || [])
      .filter(j => j.taskLatitude && j.taskLongitude)
      .sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
    return routeJobOrder.length > 0 && routeJobOrder.every(id => base.some(j => j.id === id))
      ? routeJobOrder.map(id => base.find(j => j.id === id)!).filter(Boolean) : base;
  }, [viewMode, routeViewResourceId, currentDate, resourceDayJobMap, routeJobOrder]);

  const weekGoals = useMemo(() => {
    const ws = viewMode === "week" ? currentWeekStart : startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekDateKeys = new Set(Array.from({ length: 5 }, (_, i) => format(addDays(ws, i), "yyyy-MM-dd")));
    const weekJobs = scheduledJobs.filter(j => { if (!j.scheduledDate) return false; const d = j.scheduledDate; const dk = d instanceof Date ? format(d, "yyyy-MM-dd") : String(d).split("T")[0]; return weekDateKeys.has(dk); });
    const totalHours = weekJobs.reduce((s, j) => s + (j.estimatedDuration || 60), 0) / 60;
    const totalCost = weekJobs.reduce((s, j) => s + ((j as any).cachedCost || 0), 0);
    const twh = resources.reduce((s, r) => s + (r.weeklyHours || 40), 0);
    const twb = twh * 450; const ts = resources.length * 6 * 5;
    return {
      time: { current: totalHours, target: twh, pct: twh > 0 ? Math.round((totalHours / twh) * 100) : 0 },
      economy: { current: totalCost, target: twb, pct: twb > 0 ? Math.round((totalCost / twb) * 100) : 0 },
      count: { current: weekJobs.length, target: ts, pct: ts > 0 ? Math.round((weekJobs.length / ts) * 100) : 0 },
    };
  }, [scheduledJobs, resources, viewMode, currentWeekStart, currentDate]);

  const getJobsForResourceAndDay = useCallback((resourceId: string, day: Date) => resourceDayJobMap.jobs[resourceId]?.[format(day, "yyyy-MM-dd")] || [], [resourceDayJobMap]);
  const getResourceDayHours = useCallback((resourceId: string, day: Date) => resourceDayJobMap.hours[resourceId]?.[format(day, "yyyy-MM-dd")] || 0, [resourceDayJobMap]);

  const weekTravelTotal = useMemo(() => {
    const ws = viewMode === "week" ? currentWeekStart : startOfWeek(currentDate, { weekStartsOn: 1 });
    let totalMin = 0, totalKm = 0;
    const hav = (lat1: number, lon1: number, lat2: number, lon2: number) => { const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); };
    for (const resource of resources) {
      for (let di = 0; di < 5; di++) {
        const dayJobs = getJobsForResourceAndDay(resource.id, addDays(ws, di)).filter(j => j.scheduledStartTime && j.taskLatitude && j.taskLongitude).sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
        for (let i = 0; i < dayJobs.length - 1; i++) {
          const f = dayJobs[i], t = dayJobs[i + 1];
          if (f.taskLatitude && f.taskLongitude && t.taskLatitude && t.taskLongitude) { const d = hav(f.taskLatitude, f.taskLongitude, t.taskLatitude, t.taskLongitude); totalKm += d; totalMin += Math.max(Math.round(d / 50 * 60), 5); }
        }
      }
    }
    return { minutes: totalMin, km: Math.round(totalKm * 10) / 10, hours: Math.round(totalMin / 60 * 10) / 10 };
  }, [resources, viewMode, currentWeekStart, currentDate, getJobsForResourceAndDay]);

  const travelTimesForDay = useMemo(() => {
    const result: Record<string, Array<{ fromJobId: string; toJobId: string; minutes: number; distanceKm: number; startTime: string; endTime: string }>> = {};
    const hav = (lat1: number, lon1: number, lat2: number, lon2: number) => { const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); };
    for (const resource of resources) {
      const dayJobs = getJobsForResourceAndDay(resource.id, currentDate).filter(j => j.scheduledStartTime && j.taskLatitude && j.taskLongitude).sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
      const travels: typeof result[string] = [];
      for (let i = 0; i < dayJobs.length - 1; i++) {
        const f = dayJobs[i], t = dayJobs[i + 1];
        if (!f.taskLatitude || !f.taskLongitude || !t.taskLatitude || !t.taskLongitude) continue;
        const dist = hav(f.taskLatitude, f.taskLongitude, t.taskLatitude, t.taskLongitude);
        const travelMin = Math.max(Math.round(dist / 50 * 60), 5);
        const [fH, fM] = (f.scheduledStartTime || "08:00").split(":").map(Number);
        const fromEnd = fH * 60 + fM + (f.estimatedDuration || 60);
        const travelEnd = fromEnd + travelMin;
        travels.push({ fromJobId: f.id, toJobId: t.id, minutes: travelMin, distanceKm: Math.round(dist * 10) / 10, startTime: `${Math.floor(fromEnd / 60).toString().padStart(2, "0")}:${(fromEnd % 60).toString().padStart(2, "0")}`, endTime: `${Math.floor(travelEnd / 60).toString().padStart(2, "0")}:${(travelEnd % 60).toString().padStart(2, "0")}` });
      }
      if (travels.length > 0) result[resource.id] = travels;
    }
    return result;
  }, [resources, currentDate, getJobsForResourceAndDay]);

  const getCapacityPercentage = useCallback((hours: number) => Math.min((hours / HOURS_IN_DAY) * 100, 100), []);
  const getCapacityColor = useCallback((pct: number) => pct >= 100 ? "bg-red-500" : pct >= 85 ? "bg-orange-500" : pct >= 65 ? "bg-yellow-500" : "bg-green-500", []);
  const getCapacityBgColor = useCallback((pct: number) => pct >= 100 ? "bg-red-50 dark:bg-red-950/20" : pct >= 85 ? "bg-orange-50 dark:bg-orange-950/20" : pct >= 65 ? "bg-yellow-50 dark:bg-yellow-950/20" : "", []);
  const getDropFitClass = useCallback((resourceId: string, dayStr: string, jobDurationMinutes: number) => {
    const newHours = (resourceDayJobMap.hours[resourceId]?.[dayStr] || 0) + jobDurationMinutes / 60;
    const pct = (newHours / HOURS_IN_DAY) * 100;
    if (pct > 110) return { bg: "bg-red-100 dark:bg-red-950/40 ring-red-400", label: "Överbokning", color: "text-red-600" };
    if (pct > 85) return { bg: "bg-orange-100 dark:bg-orange-950/40 ring-orange-400", label: "Tight", color: "text-orange-600" };
    if (pct > 65) return { bg: "bg-yellow-100 dark:bg-yellow-950/40 ring-yellow-400", label: "Bra", color: "text-yellow-600" };
    return { bg: "bg-green-100 dark:bg-green-950/40 ring-green-400", label: "Gott om plats", color: "text-green-600" };
  }, [resourceDayJobMap]);

  const resourceWeekSummary = useMemo(() => {
    const summary: Record<string, { totalHours: number; weeklyCapacity: number; pct: number }> = {};
    const weekDates = viewMode === "week" ? visibleDates : [];
    for (const resource of resources) {
      let totalHours = 0;
      for (const day of weekDates) totalHours += resourceDayJobMap.hours[resource.id]?.[format(day, "yyyy-MM-dd")] || 0;
      const cap = resource.weeklyHours || 40;
      summary[resource.id] = { totalHours, weeklyCapacity: cap, pct: cap > 0 ? Math.round((totalHours / cap) * 100) : 0 };
    }
    return summary;
  }, [resources, visibleDates, viewMode, resourceDayJobMap]);

  const navigate = (direction: "prev" | "next") => {
    if (viewMode === "day" || viewMode === "route") { const d = addDays(currentDate, direction === "next" ? 1 : -1); setCurrentDate(d); setCurrentWeekStart(startOfWeek(d, { weekStartsOn: 1 })); }
    else if (viewMode === "week") { const ws = addDays(currentWeekStart, direction === "next" ? 7 : -7); setCurrentWeekStart(ws); setCurrentDate(ws); }
    else { const d = addMonths(currentDate, direction === "next" ? 1 : -1); setCurrentDate(d); setCurrentWeekStart(startOfWeek(d, { weekStartsOn: 1 })); }
  };
  const handleViewModeChange = (newMode: ViewMode) => { if (newMode === "week") setCurrentWeekStart(startOfWeek(currentDate, { weekStartsOn: 1 })); setViewMode(newMode); };
  const goToToday = () => { const t = new Date(); setCurrentDate(t); setCurrentWeekStart(startOfWeek(t, { weekStartsOn: 1 })); };
  const goToDay = (day: Date) => { setCurrentDate(day); setCurrentWeekStart(startOfWeek(day, { weekStartsOn: 1 })); setViewMode("day"); };
  const getHeaderLabel = () => {
    if (viewMode === "day" || viewMode === "route") return format(currentDate, "EEEE d MMMM yyyy", { locale: sv });
    if (viewMode === "week") return `Vecka ${format(currentWeekStart, "w", { locale: sv })} - ${format(currentWeekStart, "MMMM yyyy", { locale: sv })}`;
    return format(currentDate, "MMMM yyyy", { locale: sv });
  };

  const handleJobClick = useCallback((jobId: string) => { setSelectedJob(jobId); onSelectJob?.(jobId); }, [onSelectJob]);
  const handleOpenAssignDialog = useCallback((job: WorkOrderWithObject, e: React.MouseEvent) => { e.stopPropagation(); setJobToAssign(job); setAssignDate(format(currentDate, "yyyy-MM-dd")); setAssignResourceId(null); setAssignDialogOpen(true); }, [currentDate]);
  const handleQuickAssign = useCallback(() => { if (!jobToAssign || !assignResourceId || !assignDate) return; updateWorkOrderMutation.mutate({ id: jobToAssign.id, resourceId: assignResourceId, scheduledDate: assignDate }); setAssignDialogOpen(false); setJobToAssign(null); setAssignResourceId(null); }, [jobToAssign, assignResourceId, assignDate, updateWorkOrderMutation]);

  const addToUndoStack = useCallback((action: PlannerAction) => { setUndoStack(prev => [...prev.slice(-19), action]); setRedoStack([]); }, []);

  const detectConflictsForJob = useCallback((job: WorkOrderWithObject, resourceId: string, dateStr: string, startTime?: string | null): string[] => {
    const reasons: string[] = [];
    const dateObj = new Date(dateStr + "T12:00:00Z");
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const jobDay = dayNames[dateObj.getUTCDay()];
    const tws = timewindowMap.get(job.id);
    if (tws && tws.length > 0) {
      const dayMatch = tws.filter(tw => !tw.dayOfWeek || tw.dayOfWeek === jobDay);
      if (dayMatch.length > 0) { for (const tw of dayMatch) { if (tw.startTime && tw.endTime && startTime && (startTime < tw.startTime || startTime > tw.endTime)) reasons.push(`Utanför tidsfönster (${tw.startTime}–${tw.endTime})`); } }
      else if (tws.some(tw => tw.dayOfWeek)) reasons.push(`Fel dag — tillåtna: ${tws.filter(tw => tw.dayOfWeek).map(tw => tw.dayOfWeek).join(", ")}`);
    }
    const pStart = job.plannedWindowStart ? new Date(job.plannedWindowStart) : null;
    const pEnd = job.plannedWindowEnd ? new Date(job.plannedWindowEnd) : null;
    if (pStart && dateObj < pStart) reasons.push(`Före leveransfönster (${format(pStart, "d MMM", { locale: sv })})`);
    if (pEnd && dateObj > pEnd) reasons.push(`Efter leveransfönster (${format(pEnd, "d MMM", { locale: sv })})`);
    if (job.objectId) {
      const objR = restrictionsByObject.get(job.objectId) || [];
      const di = dateObj.getUTCDay() || 7;
      for (const r of objR) { if (!r.isActive || !r.weekdays || r.weekdays.length === 0) continue; if (r.weekdays.includes(di)) { const label = RESTRICTION_TYPE_LABELS[r.restrictionType] || r.restrictionType; reasons.push(r.isBlockingAllDay ? `${label} — hela dagen blockerad` : r.startTime && r.endTime ? `${label} (${r.startTime}–${r.endTime})` : `${label} — begränsning aktiv`); } }
    }
    const advDays = (job as any).advanceNotificationDays || 0;
    if (advDays > 0) { const today = new Date(); today.setHours(0, 0, 0, 0); const daysUntil = Math.floor((dateObj.getTime() - today.getTime()) / 86400000); if (daysUntil < advDays) reasons.push(`Avisering krävs ${advDays} dagar i förväg — bara ${Math.max(0, daysUntil)} dagar kvar`); }
    if (dependenciesData?.dependencies) { for (const dep of (dependenciesData.dependencies[job.id] || [])) { const p = workOrders.find(wo => wo.id === dep.dependsOnWorkOrderId); if (p) { if (!p.scheduledDate || p.executionStatus === "not_planned") reasons.push(`Beroende "${p.title}" ej planerad`); else if (new Date(p.scheduledDate) > dateObj) reasons.push(`Beroende "${p.title}" planerad efter (${format(new Date(p.scheduledDate), "d MMM", { locale: sv })})`); } } }
    if (startTime) {
      const [jH, jM] = startTime.split(":").map(Number); const jS = jH * 60 + jM; const jE = jS + (job.estimatedDuration || 60);
      for (const other of scheduledJobs.filter(j => j.id !== job.id && j.resourceId === resourceId && j.scheduledDate && isSameDay(new Date(j.scheduledDate), dateObj))) {
        if (!other.scheduledStartTime) continue; const [oH, oM] = other.scheduledStartTime.split(":").map(Number); if (jS < oH * 60 + oM + (other.estimatedDuration || 60) && jE > oH * 60 + oM) { reasons.push(`Överlapp med "${other.title}" (${other.scheduledStartTime})`); break; }
      }
    }
    return reasons;
  }, [scheduledJobs, timewindowMap, restrictionsByObject, dependenciesData, workOrders]);

  const executeSchedule = useCallback((jobId: string, resourceId: string, scheduledDate: string, scheduledStartTime?: string) => {
    const job = workOrders.find(j => j.id === jobId);
    if (!job) return;
    addToUndoStack({ type: "schedule", jobId, previousState: { resourceId: job.resourceId || null, scheduledDate: job.scheduledDate ? format(new Date(job.scheduledDate), "yyyy-MM-dd") : null, scheduledStartTime: job.scheduledStartTime || null, status: job.status, orderStatus: job.orderStatus }, newState: { resourceId, scheduledDate, scheduledStartTime: scheduledStartTime || null, status: "scheduled", orderStatus: "planerad_resurs" } });
    updateWorkOrderMutation.mutate({ id: jobId, resourceId, scheduledDate, scheduledStartTime });
  }, [workOrders, addToUndoStack, updateWorkOrderMutation]);

  const handleAcceptConflict = useCallback(() => {
    if (!pendingSchedule) return;
    executeSchedule(pendingSchedule.jobId, pendingSchedule.resourceId, pendingSchedule.scheduledDate, pendingSchedule.scheduledStartTime);
    setConflictDialogOpen(false); setPendingSchedule(null);
    toast({ title: "Schemalagt trots varning", description: "Jobbet har schemalagts trots identifierade konflikter." });
  }, [pendingSchedule, executeSchedule, toast]);

  const handleDndDragStart = useCallback((event: DragStartEvent) => { setActiveDragJob(workOrders.find(j => j.id === event.active.id) || null); }, [workOrders]);
  const handleDndDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragJob(null);
    const { active, over } = event;
    if (!over) return;
    const jobId = active.id as string; const dropId = over.id as string;
    if (viewMode === "route" && routeJobsForView.length > 0) {
      const isRouteJob = routeJobsForView.some(j => j.id === jobId);
      const isDropOnRouteJob = routeJobsForView.some(j => j.id === dropId);
      if (isRouteJob && isDropOnRouteJob && jobId !== dropId) {
        const oldIdx = routeJobsForView.findIndex(j => j.id === jobId);
        const newIdx = routeJobsForView.findIndex(j => j.id === dropId);
        if (oldIdx !== -1 && newIdx !== -1) {
          const newOrder = arrayMove(routeJobsForView, oldIdx, newIdx);
          setRouteJobOrder(newOrder.map(j => j.id));
          let mins = 8 * 60; const ds = format(currentDate, "yyyy-MM-dd");
          newOrder.forEach((job, idx) => {
            updateWorkOrderMutation.mutate({ id: job.id, resourceId: job.resourceId!, scheduledDate: ds, scheduledStartTime: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` });
            mins += (job.estimatedDuration || 30) + (idx < newOrder.length - 1 ? 5 : 0);
          });
          toast({ title: "Körordning uppdaterad", description: `${newOrder.length} stopp har fått ny ordning` });
        }
        return;
      }
    }
    const job = workOrders.find(j => j.id === jobId);
    if (!job) return;
    const parts = dropId.split("|");
    if (parts.length < 2) return;
    const resourceId = parts[0]; const dateStr = parts[1]; const hour = parts[2] ? parseInt(parts[2], 10) : undefined;
    const day = new Date(dateStr + "T12:00:00Z");
    if (job.resourceId === resourceId && job.scheduledDate && isSameDay(new Date(job.scheduledDate), day) && hour === undefined) return;
    let scheduledStartTime = hour !== undefined ? `${hour.toString().padStart(2, "0")}:00` : undefined;
    if (!scheduledStartTime && viewMode === "week") {
      const existing = (resourceDayJobMap.jobs[resourceId]?.[dateStr] || []).filter(j => j.scheduledStartTime).sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
      let nextSlot = DAY_START_HOUR * 60;
      for (const e of existing) { const [eH, eM] = (e.scheduledStartTime || "07:00").split(":").map(Number); const end = eH * 60 + eM + (e.estimatedDuration || 60); if (end > nextSlot) nextSlot = end; }
      const h = Math.floor(nextSlot / 60);
      if (h < DAY_END_HOUR) scheduledStartTime = `${h.toString().padStart(2, "0")}:${(nextSlot % 60).toString().padStart(2, "0")}`;
    }
    const conflicts = detectConflictsForJob(job, resourceId, dateStr, scheduledStartTime);
    if (conflicts.length > 0) { setPendingSchedule({ jobId, resourceId, scheduledDate: dateStr, scheduledStartTime, conflicts }); setConflictDialogOpen(true); return; }
    executeSchedule(jobId, resourceId, dateStr, scheduledStartTime);
    if (scheduledStartTime) toast({ title: "Schemalagt", description: `Starttid ${scheduledStartTime} tilldelad automatiskt` });
  }, [workOrders, executeSchedule, detectConflictsForJob, viewMode, routeJobsForView, toast, updateWorkOrderMutation, currentDate, resourceDayJobMap]);

  const jobConflicts = useMemo(() => {
    const conflicts: Record<string, string[]> = {};
    for (const job of scheduledJobs) {
      if (!job.scheduledDate || !job.resourceId) continue;
      const reasons = detectConflictsForJob(job, job.resourceId, format(new Date(job.scheduledDate), "yyyy-MM-dd"), job.scheduledStartTime || null);
      if (reasons.length > 0) conflicts[job.id] = reasons;
    }
    return conflicts;
  }, [scheduledJobs, detectConflictsForJob]);

  const handleUnschedule = useCallback((e: { stopPropagation: () => void }, jobId: string) => {
    e.stopPropagation();
    const job = workOrders.find(j => j.id === jobId);
    if (job) addToUndoStack({ type: "unschedule", jobId, previousState: { resourceId: job.resourceId || null, scheduledDate: job.scheduledDate ? format(new Date(job.scheduledDate), "yyyy-MM-dd") : null, scheduledStartTime: job.scheduledStartTime || null, status: job.status, orderStatus: job.orderStatus }, newState: { resourceId: null, scheduledDate: null, scheduledStartTime: null, status: "draft", orderStatus: "skapad" } });
    unscheduleWorkOrderMutation.mutate(jobId);
  }, [workOrders, addToUndoStack, unscheduleWorkOrderMutation]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1)); setRedoStack(prev => [...prev, last]);
    applyActionMutation.mutate({ jobId: last.jobId, state: last.previousState });
    toast({ title: "Ändring ångrad" });
  }, [undoStack, applyActionMutation, toast]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1)); setUndoStack(prev => [...prev, last]);
    applyActionMutation.mutate({ jobId: last.jobId, state: last.newState });
    toast({ title: "Ändring återställd" });
  }, [redoStack, applyActionMutation, toast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); if (undoStack.length > 0) handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); if (redoStack.length > 0) handleRedo(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo, undoStack.length, redoStack.length]);

  const handleResourceClick = useCallback((resourceId: string) => setActiveResourceId(resourceId), []);
  const activeResource = useMemo(() => activeResourceId ? resources.find(r => r.id === activeResourceId) || null : null, [activeResourceId, resources]);
  const activeResourceJobs = useMemo(() => activeResourceId ? scheduledJobs.filter(j => j.resourceId === activeResourceId).sort((a, b) => { if (!a.scheduledDate || !b.scheduledDate) return 0; return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime(); }) : [], [activeResourceId, scheduledJobs]);
  const activeResourceJobsByDay = useMemo(() => { const map: Record<string, WorkOrderWithObject[]> = {}; for (const j of activeResourceJobs) { if (!j.scheduledDate) continue; const dk = (typeof j.scheduledDate === "string" ? j.scheduledDate : (j.scheduledDate as Date).toISOString()).split("T")[0]; if (!map[dk]) map[dk] = []; map[dk].push(j); } return map; }, [activeResourceJobs]);

  const handleSendSchedule = useCallback((resource: Resource) => { setSendScheduleResource(resource); setSendScheduleCopied(false); setSendScheduleDialogOpen(true); }, []);
  const getResourceScheduleJobs = useCallback((resourceId: string) => {
    const startDate = viewMode === "week" ? currentWeekStart : currentDate;
    const endDate = viewMode === "week" ? addDays(currentWeekStart, 4) : viewMode === "month" ? addDays(startOfMonth(currentDate), getDaysInMonth(currentDate) - 1) : currentDate;
    return workOrders.filter(j => j.resourceId === resourceId && j.scheduledDate && new Date(j.scheduledDate) >= startDate && new Date(j.scheduledDate) <= endDate)
      .map(j => ({ id: j.id, title: j.title, objectName: j.objectName || undefined, objectAddress: j.objectAddress || undefined, scheduledDate: typeof j.scheduledDate === "string" ? j.scheduledDate : j.scheduledDate instanceof Date ? j.scheduledDate.toISOString() : new Date(j.scheduledDate as any).toISOString(), scheduledStartTime: j.scheduledStartTime || undefined, estimatedDuration: j.estimatedDuration || undefined, accessCode: j.objectAccessCode || undefined, keyNumber: j.objectKeyNumber || undefined }));
  }, [workOrders, viewMode, currentWeekStart, currentDate]);

  const handleSendScheduleEmail = useCallback(() => {
    if (!sendScheduleResource) return;
    const jobs = getResourceScheduleJobs(sendScheduleResource.id);
    if (jobs.length === 0) { toast({ title: "Inga jobb att skicka", description: "Resursen har inga planerade jobb för denna period.", variant: "destructive" }); return; }
    const sd = viewMode === "week" ? format(currentWeekStart, "yyyy-MM-dd") : format(currentDate, "yyyy-MM-dd");
    const ed = viewMode === "week" ? format(addDays(currentWeekStart, 4), "yyyy-MM-dd") : viewMode === "month" ? format(addDays(startOfMonth(currentDate), getDaysInMonth(currentDate) - 1), "yyyy-MM-dd") : format(currentDate, "yyyy-MM-dd");
    sendScheduleMutation.mutate({ resourceId: sendScheduleResource.id, jobs, dateRange: { start: sd, end: ed } });
  }, [sendScheduleResource, getResourceScheduleJobs, sendScheduleMutation, viewMode, currentWeekStart, currentDate, toast]);

  const handleCopyFieldAppLink = useCallback(async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/field`); setSendScheduleCopied(true); toast({ title: "Länk kopierad!", description: "Klistra in i SMS eller meddelande." }); setTimeout(() => setSendScheduleCopied(false), 3000); }
    catch { toast({ title: "Kunde inte kopiera", variant: "destructive" }); }
  }, [toast]);

  const handleOptimizeRoute = useCallback(async () => {
    if (routeJobsForView.length < 2) return;
    setIsOptimizing(true);
    try {
      const stops = routeJobsForView.map(j => ({ workOrderId: j.id, objectId: j.objectId || "", objectName: j.objectName || j.title, latitude: j.taskLatitude || 0, longitude: j.taskLongitude || 0, estimatedDuration: j.estimatedDuration || 0, scheduledStartTime: j.scheduledStartTime || undefined }));
      const result = await (await apiRequest("POST", "/api/route/optimize", { stops })).json();
      if (result.optimizedStops) { setRouteJobOrder(result.optimizedStops.map((s: { workOrderId: string }) => s.workOrderId)); toast({ title: "Rutt optimerad", description: `Körsträcka minskad med ${result.savingsPercent}% (${result.originalDistance} km → ${result.optimizedDistance} km)` }); }
    } catch { toast({ title: "Fel vid optimering", description: "Kunde inte optimera rutten", variant: "destructive" }); }
    finally { setIsOptimizing(false); }
  }, [routeJobsForView, toast]);

  const handleClearAllScheduled = async () => {
    setClearLoading(true);
    try {
      let clearStart: Date, clearEnd: Date;
      if (viewMode === "month") { clearStart = startOfMonth(currentDate); clearEnd = addDays(clearStart, getDaysInMonth(currentDate) - 1); }
      else if (viewMode === "day") { clearStart = currentDate; clearEnd = currentDate; }
      else { clearStart = currentWeekStart; clearEnd = addDays(currentWeekStart, 4); }
      const data = await (await apiRequest("POST", "/api/work-orders/bulk-unschedule", { startDate: format(clearStart, "yyyy-MM-dd"), endDate: format(clearEnd, "yyyy-MM-dd") })).json();
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      setUnscheduledPage(0); setClearDialogOpen(false);
      toast({ title: "Planering rensad", description: `${data.count} jobb avplanerade och flyttade tillbaka till orderstocken.` });
    } catch { toast({ title: "Fel", description: "Kunde inte rensa planeringen", variant: "destructive" }); }
    finally { setClearLoading(false); }
  };

  const handleAutoFillPreview = async () => {
    setAutoFillLoading(true); setAutoFillPreview(null);
    try {
      const ws = viewMode === "week" ? currentWeekStart : startOfWeek(currentDate, { weekStartsOn: 1 });
      const data = await (await apiRequest("POST", "/api/auto-plan-week", { weekStartDate: format(ws, "yyyy-MM-dd"), resourceIds: resources.map(r => r.id), overbookingPercent: autoFillOverbooking })).json();
      setAutoFillPreview(data.assignments || []); setAutoFillSkipped(data.totalSkipped || 0);
      setAutoFillDiag(data.totalUnscheduled != null ? { totalUnscheduled: data.totalUnscheduled, capacityPerDay: data.capacityPerDay || {}, maxMinutesPerDay: data.maxMinutesPerDay || 480, resourceCount: data.resourceCount || 0, clusterSkipped: data.clusterSkipped || 0 } : null);
    } catch { toast({ title: "Fel", description: "Kunde inte generera planering", variant: "destructive" }); }
    finally { setAutoFillLoading(false); }
  };

  const handleAutoFillApply = async () => {
    if (!autoFillPreview || autoFillPreview.length === 0) return;
    setAutoFillApplying(true);
    try {
      const data = await (await apiRequest("POST", "/api/auto-plan-week/apply", { assignments: autoFillPreview })).json();
      toast({ title: "Planering tillämpad", description: `${data.applied} uppdrag planerade${autoFillSkipped > 0 ? `, ${autoFillSkipped} ryms ej denna vecka` : ""}` });
      setAutoFillDialogOpen(false); setAutoFillPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] }); setUnscheduledPage(0);
    } catch { toast({ title: "Fel", description: "Kunde inte tillämpa planering", variant: "destructive" }); }
    finally { setAutoFillApplying(false); }
  };

  const handleOpenDepChain = useCallback((jobId: string) => { setDepChainJobId(jobId); setDepChainDialogOpen(true); }, []);
  const handleToggleSubStep = useCallback((jobId: string) => setExpandedSubSteps(prev => ({ ...prev, [jobId]: !prev[jobId] })), []);

  const isLoading = resourcesLoading || workOrdersLoading;
  if (isLoading) return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  const jobCardProps = {
    selectedJob,
    jobConflicts,
    dependenciesData,
    timewindowMap,
    expandedSubSteps,
    onJobClick: handleJobClick,
    onUnschedule: handleUnschedule,
    onToggleSubStep: handleToggleSubStep,
    onOpenDepChain: handleOpenDepChain,
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDndDragStart} onDragEnd={handleDndDragEnd}>
      <div className="flex h-full">
        <UnscheduledSidebar
          showUnscheduled={showUnscheduled} setShowUnscheduled={setShowUnscheduled}
          unscheduledJobs={unscheduledJobs} unscheduledTotal={unscheduledTotal} accumulatedCount={accumulatedUnscheduled.length}
          hasMoreUnscheduled={hasMoreUnscheduled} loadMoreLoading={loadMoreLoading} loadMoreUnscheduled={loadMoreUnscheduled}
          orderstockSearch={orderstockSearch} setOrderstockSearch={setOrderstockSearch}
          sidebarFiltersOpen={sidebarFiltersOpen} setSidebarFiltersOpen={setSidebarFiltersOpen}
          sidebarActiveFilterCount={sidebarActiveFilterCount} clearAllSidebarFilters={clearAllSidebarFilters}
          sidebarQuickStats={sidebarQuickStats}
          filterCustomer={filterCustomer} setFilterCustomer={setFilterCustomer}
          filterPriority={filterPriority} setFilterPriority={setFilterPriority}
          filterCluster={filterCluster} setFilterCluster={setFilterCluster}
          filterTeam={filterTeam} setFilterTeam={setFilterTeam}
          filterExecutionCode={filterExecutionCode} setFilterExecutionCode={setFilterExecutionCode}
          customers={customers} clusters={clusters} teamsData={teamsData}
          customerMap={customerMap} clusterMap={clusterMap}
          selectedJob={selectedJob} onJobClick={handleJobClick} onOpenAssignDialog={handleOpenAssignDialog}
          timewindowMap={timewindowMap}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <PlannerToolbar
            viewMode={viewMode} headerLabel={getHeaderLabel()}
            onNavigate={navigate} onGoToday={goToToday} onViewModeChange={handleViewModeChange}
            undoCount={undoStack.length} redoCount={redoStack.length} onUndo={handleUndo} onRedo={handleRedo}
            zoomLevel={zoomLevel} setZoomLevel={setZoomLevel}
            resources={resources} visibleResources={visibleResources}
            hiddenResourceIds={hiddenResourceIds} setHiddenResourceIds={setHiddenResourceIds}
            onAddJob={onAddJob} onAutoFill={() => { setAutoFillDialogOpen(true); setAutoFillPreview(null); }}
            onClearAll={() => setClearDialogOpen(true)}
            showAIPanel={showAIPanel} onToggleAIPanel={onToggleAIPanel}
            weekGoals={weekGoals} weekTravelTotal={weekTravelTotal}
            visibleDates={visibleDates} getResourceDayHours={getResourceDayHours}
            jobConflictCount={Object.keys(jobConflicts).length}
            filteredScheduledCount={filteredScheduledJobs.length}
            unscheduledCount={unscheduledJobs.length}
          />

          {viewMode === "day" && (
            <DayTimelineView
              currentDate={currentDate} visibleResources={visibleResources}
              timeRestrictions={timeRestrictions}
              getJobsForResourceAndDay={getJobsForResourceAndDay}
              getResourceDayHours={getResourceDayHours} getCapacityPercentage={getCapacityPercentage}
              getDropFitClass={getDropFitClass} activeDragJob={activeDragJob}
              travelTimesForDay={travelTimesForDay} zoom={zoom}
              jobCardProps={jobCardProps}
            />
          )}
          {viewMode === "week" && (
            <WeekGridView
              visibleDates={visibleDates} visibleResources={visibleResources}
              getJobsForResourceAndDay={getJobsForResourceAndDay}
              getResourceDayHours={getResourceDayHours} getCapacityPercentage={getCapacityPercentage}
              getCapacityColor={getCapacityColor} getCapacityBgColor={getCapacityBgColor}
              getDropFitClass={getDropFitClass} activeDragJob={activeDragJob}
              restrictionsByObject={restrictionsByObject} resourceWeekSummary={resourceWeekSummary}
              zoom={zoom} weatherByDate={weatherByDate}
              onResourceClick={handleResourceClick} onSendSchedule={handleSendSchedule}
              jobCardProps={jobCardProps}
            />
          )}
          {viewMode === "month" && (
            <MonthView
              currentDate={currentDate} filteredScheduledJobs={filteredScheduledJobs}
              jobConflicts={jobConflicts} timeRestrictions={timeRestrictions}
              zoom={zoom} goToDay={goToDay}
            />
          )}
          {viewMode === "route" && (
            <RouteMapView
              currentDate={currentDate} resources={resources}
              routeViewResourceId={routeViewResourceId} setRouteViewResourceId={(v) => { setRouteViewResourceId(v); setRouteJobOrder([]); }}
              routeJobs={routeJobsForView} routeJobOrder={routeJobOrder}
              customerMap={customerMap} isOptimizing={isOptimizing}
              selectedJob={selectedJob} onJobClick={handleJobClick}
              onSortEnd={() => {}} onOptimizeRoute={handleOptimizeRoute}
              onSendSchedule={handleSendSchedule}
            />
          )}

          <PlannerFooter
            jobConflictCount={Object.keys(jobConflicts).length}
            filteredScheduledCount={filteredScheduledJobs.length}
            unscheduledCount={unscheduledJobs.length}
          />
        </div>

        <Sheet open={!!activeResourceId} onOpenChange={(open) => !open && setActiveResourceId(null)}>
          <SheetContent className="w-[400px] sm:w-[450px] p-0 flex flex-col">
            {activeResource && (
              <>
                <SheetHeader className="p-4 border-b">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12"><AvatarFallback className="text-lg">{activeResource.initials || activeResource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback></Avatar>
                    <div>
                      <SheetTitle className="text-left">{activeResource.name}</SheetTitle>
                      <p className="text-sm text-muted-foreground">{activeResource.resourceType || "Fälttekniker"} • {activeResource.weeklyHours || 40}h/vecka</p>
                    </div>
                  </div>
                </SheetHeader>
                <div className="p-4 border-b bg-muted/30">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2"><User className="h-4 w-4" /><span>Veckoschema - Dra jobb hit för att schemalägga</span></div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-background rounded-md p-2 text-center"><div className="font-medium">{activeResourceJobs.length}</div><div className="text-muted-foreground">jobb</div></div>
                    <div className="bg-background rounded-md p-2 text-center"><div className="font-medium">{(activeResourceJobs.reduce((s, j) => s + (j.estimatedDuration || 0), 0) / 60).toFixed(1).replace(".", ",")} h</div><div className="text-muted-foreground">planerat</div></div>
                    <div className="bg-background rounded-md p-2 text-center"><div className="font-medium">{Object.keys(activeResourceJobsByDay).length}</div><div className="text-muted-foreground">dagar</div></div>
                  </div>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-4">
                    {visibleDates.map((day) => {
                      const dayKey = format(day, "yyyy-MM-dd");
                      const dayJobs = activeResourceJobsByDay[dayKey] || [];
                      const dayHours = dayJobs.reduce((s, j) => s + (j.estimatedDuration || 0) / 60, 0);
                      const droppableId = `${activeResourceId}|${dayKey}`;
                      return (
                        <div key={dayKey} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className={`text-sm font-medium ${isSameDay(day, new Date()) ? "text-primary" : ""}`}>{format(day, "EEEE d MMM", { locale: sv })}</div>
                            <Badge variant="secondary" className="text-xs">{dayHours.toFixed(1)}h</Badge>
                          </div>
                          <DroppableCell id={droppableId} className="min-h-[80px] border border-dashed rounded-md p-2 transition-colors">
                            <div data-testid={`panel-drop-zone-${dayKey}`}>
                              {dayJobs.length === 0 ? (
                                <div className="text-xs text-muted-foreground text-center py-4">Dra jobb hit för att schemalägga</div>
                              ) : (
                                <div className="space-y-2">{dayJobs.map(job => <JobCard key={job.id} job={job} {...jobCardProps} />)}</div>
                              )}
                            </div>
                          </DroppableCell>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </>
            )}
          </SheetContent>
        </Sheet>
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
        {activeDragJob && <DragOverlayContent job={activeDragJob} timewindowMap={timewindowMap} />}
      </DragOverlay>

      <AssignDialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen} jobToAssign={jobToAssign} assignDate={assignDate} setAssignDate={setAssignDate} assignResourceId={assignResourceId} setAssignResourceId={setAssignResourceId} resources={resources} onConfirm={handleQuickAssign} isPending={updateWorkOrderMutation.isPending} />
      <SendScheduleDialog open={sendScheduleDialogOpen} onOpenChange={setSendScheduleDialogOpen} resource={sendScheduleResource} onSendEmail={handleSendScheduleEmail} onCopyLink={handleCopyFieldAppLink} copied={sendScheduleCopied} isPending={sendScheduleMutation.isPending} />
      <ConflictDialog open={conflictDialogOpen} onOpenChange={(o) => { if (!o) { setConflictDialogOpen(false); setPendingSchedule(null); } }} pendingSchedule={pendingSchedule} workOrders={workOrders} onAccept={handleAcceptConflict} onCancel={() => { setConflictDialogOpen(false); setPendingSchedule(null); }} />
      <ClearDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen} viewMode={viewMode} jobCount={currentViewScheduledJobs.length} onConfirm={handleClearAllScheduled} loading={clearLoading} />
      <AutoFillDialog open={autoFillDialogOpen} onOpenChange={setAutoFillDialogOpen} overbooking={autoFillOverbooking} setOverbooking={setAutoFillOverbooking} loading={autoFillLoading} applying={autoFillApplying} preview={autoFillPreview} skipped={autoFillSkipped} diag={autoFillDiag} resources={resources} viewMode={viewMode} currentWeekStart={currentWeekStart} currentDate={currentDate} onPreview={handleAutoFillPreview} onApply={handleAutoFillApply} />
      <DepChainDialog open={depChainDialogOpen} onOpenChange={(o) => { if (!o) { setDepChainDialogOpen(false); setDepChainJobId(null); } }} depChainJobId={depChainJobId} workOrders={workOrders} depChainData={depChainData} />
    </DndContext>
  );
}
