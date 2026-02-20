import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor, KeyboardSensor, closestCenter, useDraggable, useDroppable, type DragStartEvent, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, Plus, AlertTriangle, Loader2, CalendarDays, Calendar, CalendarRange, Clock, Inbox, ChevronDown, ChevronUp, X, User, Sparkles, Undo2, Redo2, Link2, ArrowRight, MapPin, Navigation, GripVertical, Wand2, ExternalLink, FileText, Send, UserPlus, Key, DoorOpen, TrendingUp, Activity, Mail, Copy, Check } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, addDays, startOfWeek, startOfMonth, isSameDay, getDaysInMonth, addMonths } from "date-fns";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrderWithObject, Customer, TaskDependency, Cluster } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PlannerAction {
  type: "schedule" | "unschedule";
  jobId: string;
  previousState: {
    resourceId: string | null;
    scheduledDate: string | null;
    scheduledStartTime: string | null;
    status: string;
    orderStatus: string;
  };
  newState: {
    resourceId: string | null;
    scheduledDate: string | null;
    scheduledStartTime: string | null;
    status: string;
    orderStatus: string;
  };
}

const priorityDotColors: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

const priorityLabels: Record<string, string> = {
  urgent: "Akut",
  high: "Hög",
  normal: "Normal",
  low: "Låg",
};

const statusBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  scheduled: "default",
  draft: "outline",
  in_progress: "secondary",
};

const executionStatusLabels: Record<string, string> = {
  not_planned: "Ej planerad",
  planned_rough: "Grovplanerad",
  planned_fine: "Finplanerad",
  on_way: "På väg",
  on_site: "På plats",
  completed: "Utförd",
  inspected: "Kontrollerad",
  invoiced: "Fakturerad",
};

const executionStatusColors: Record<string, string> = {
  not_planned: "bg-gray-400",
  planned_rough: "bg-yellow-500",
  planned_fine: "bg-blue-500",
  on_way: "bg-purple-500",
  on_site: "bg-indigo-500",
  completed: "bg-green-500",
  inspected: "bg-teal-500",
  invoiced: "bg-emerald-600",
};

const executionStatusOrder = [
  "not_planned", "planned_rough", "planned_fine", "on_way", 
  "on_site", "completed", "inspected", "invoiced"
];

const HOURS_IN_DAY = 8;
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 17;

type TimeBlockCategory = "production" | "travel" | "break" | "free";

const timeBlockColors: Record<TimeBlockCategory, string> = {
  production: "bg-green-500",
  travel: "bg-yellow-400",
  break: "bg-blue-400",
  free: "bg-gray-200 dark:bg-gray-700",
};

const timeBlockBorders: Record<TimeBlockCategory, string> = {
  production: "border-l-green-500",
  travel: "border-l-yellow-400",
  break: "border-l-blue-400",
  free: "border-l-gray-300",
};

const timeBlockLabels: Record<TimeBlockCategory, string> = {
  production: "Produktionstid",
  travel: "Restid",
  break: "Egentid/rast",
  free: "Ledig tid",
};

function getJobCategory(job: WorkOrderWithObject): TimeBlockCategory {
  const title = (job.title || "").toLowerCase();
  const type = (job.orderType || "").toLowerCase();
  if (title.includes("resa") || title.includes("körning") || title.includes("transport") || title.includes("restid") || type === "travel") {
    return "travel";
  }
  if (title.includes("rast") || title.includes("vila") || title.includes("lunch") || title.includes("paus") || type === "break") {
    return "break";
  }
  return "production";
}

function DraggableJobCard({ id, children, disabled = false }: { id: string; children: JSX.Element; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    disabled,
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  } : undefined;

  return (
    <div ref={setNodeRef} style={style as React.CSSProperties} {...listeners} {...attributes}>
      {children}
    </div>
  );
}

function DroppableCell({ id, children, className = "" }: { id: string; children: JSX.Element; className?: string }) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`${className} ${isOver ? "ring-2 ring-primary ring-inset bg-primary/10" : ""}`}
    >
      {children}
    </div>
  );
}

function SortableRouteItem({ 
  job, 
  index, 
  totalCount, 
  customer, 
  travelToNext, 
  isSelected, 
  onSelect 
}: { 
  job: WorkOrderWithObject; 
  index: number; 
  totalCount: number;
  customer?: { name: string };
  travelToNext?: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: job.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        className={`p-3 cursor-pointer hover-elevate ${isSelected ? "ring-2 ring-primary" : ""}`}
        onClick={() => onSelect(job.id)}
        data-testid={`route-job-${job.id}`}
      >
        <div className="flex items-start gap-2">
          <div 
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </div>
          <div 
            className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${
              index === 0 ? "bg-green-500" : index === totalCount - 1 ? "bg-red-500" : "bg-blue-500"
            }`}
          >
            {index + 1}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{job.title}</div>
            <div className="text-xs text-muted-foreground truncate">{job.objectName}</div>
            {customer && (
              <div className="text-xs text-muted-foreground truncate">{customer.name}</div>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {job.scheduledStartTime && (
                <Badge variant="outline" className="text-[10px]">
                  {job.scheduledStartTime}
                </Badge>
              )}
              <Badge variant="secondary" className="text-[10px]">
                {((job.estimatedDuration || 0) / 60).toFixed(1)}h
              </Badge>
            </div>
          </div>
        </div>
      </Card>
      {travelToNext !== undefined && (
        <div className="flex items-center gap-2 py-1.5 pl-3 text-xs text-muted-foreground">
          <div className="w-4" />
          <div className="w-6 flex justify-center">
            <div className="w-0.5 h-4 bg-blue-300" />
          </div>
          <span>~{travelToNext} min körning</span>
        </div>
      )}
    </div>
  );
}

interface WeekPlannerProps {
  onAddJob?: () => void;
  onSelectJob?: (jobId: string) => void;
  showAIPanel?: boolean;
  onToggleAIPanel?: () => void;
}

type ViewMode = "day" | "week" | "month" | "route";

export function WeekPlanner({ onAddJob, onSelectJob, showAIPanel, onToggleAIPanel }: WeekPlannerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [showUnscheduled, setShowUnscheduled] = useState(true);
  const [filterCustomer, setFilterCustomer] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterCluster, setFilterCluster] = useState<string>("all");
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<PlannerAction[]>([]);
  const [redoStack, setRedoStack] = useState<PlannerAction[]>([]);
  const [activeDragJob, setActiveDragJob] = useState<WorkOrderWithObject | null>(null);
  const [routeViewResourceId, setRouteViewResourceId] = useState<string | null>(null);
  const [routeJobOrder, setRouteJobOrder] = useState<string[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isSendingToMobile, setIsSendingToMobile] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [jobToAssign, setJobToAssign] = useState<WorkOrderWithObject | null>(null);
  const [assignDate, setAssignDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [assignResourceId, setAssignResourceId] = useState<string | null>(null);
  const [sendScheduleDialogOpen, setSendScheduleDialogOpen] = useState(false);
  const [sendScheduleResource, setSendScheduleResource] = useState<Resource | null>(null);
  const [sendScheduleCopied, setSendScheduleCopied] = useState(false);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [pendingSchedule, setPendingSchedule] = useState<{ jobId: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string; conflicts: string[] } | null>(null);
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const visibleDates = useMemo((): Date[] => {
    if (viewMode === "day") {
      return [currentDate];
    } else if (viewMode === "week") {
      return Array.from({ length: 5 }, (_, i) => addDays(currentWeekStart, i));
    } else {
      const monthStart = startOfMonth(currentDate);
      const daysInMonth = getDaysInMonth(currentDate);
      return Array.from({ length: daysInMonth }, (_, i) => addDays(monthStart, i));
    }
  }, [viewMode, currentDate, currentWeekStart]);

  const { data: resources = [], isLoading: resourcesLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const dateRange = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const startDate = format(addDays(monthStart, -14), "yyyy-MM-dd");
    const endDate = format(addDays(monthStart, 45), "yyyy-MM-dd");
    return { startDate, endDate };
  }, [currentDate.getFullYear(), currentDate.getMonth()]);

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders", dateRange.startDate, dateRange.endDate],
    queryFn: async () => {
      const url = `/api/work-orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&includeUnscheduled=true&limit=500`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch work orders");
      return res.json();
    },
    staleTime: 60000,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: clusters = [] } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const clusterMap = useMemo(() => {
    const map = new Map<string, Cluster>();
    clusters.forEach(c => map.set(c.id, c));
    return map;
  }, [clusters]);

  const workOrderIds = useMemo(() => workOrders.map(wo => wo.id), [workOrders]);

  const { data: dependenciesData } = useQuery<{
    dependencies: Record<string, TaskDependency[]>;
    dependents: Record<string, TaskDependency[]>;
  }>({
    queryKey: ["/api/task-dependencies/batch", workOrderIds.join(",")],
    queryFn: async () => {
      if (workOrderIds.length === 0) return { dependencies: {}, dependents: {} };
      const res = await apiRequest("POST", "/api/task-dependencies/batch", { workOrderIds });
      return res.json();
    },
    enabled: workOrderIds.length > 0,
    staleTime: 120000,
  });

  const workOrdersQueryKey = ["/api/work-orders", dateRange.startDate, dateRange.endDate];
  
  const updateWorkOrderMutation = useMutation({
    mutationFn: async ({ id, resourceId, scheduledDate, scheduledStartTime }: { id: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string }) => {
      const payload: Record<string, unknown> = { 
        resourceId, 
        scheduledDate, 
        status: "scheduled",
        orderStatus: "planerad_resurs"
      };
      if (scheduledStartTime) {
        payload.scheduledStartTime = scheduledStartTime;
      }
      const response = await apiRequest("PATCH", `/api/work-orders/${id}`, payload);
      return response.json() as Promise<WorkOrderWithObject>;
    },
    onMutate: async ({ id, resourceId, scheduledDate }) => {
      await queryClient.cancelQueries({ queryKey: workOrdersQueryKey });
      const previousData = queryClient.getQueryData<WorkOrderWithObject[]>(workOrdersQueryKey);
      
      queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, (old) => {
        if (!old) return old;
        return old.map(job => 
          job.id === id 
            ? { ...job, resourceId, scheduledDate: new Date(scheduledDate + "T12:00:00Z"), status: "scheduled" as const, orderStatus: "planerad_resurs" as const }
            : job
        );
      });
      
      return { previousData };
    },
    onSuccess: (updatedWorkOrder, variables) => {
      console.log("MUTATION SUCCESS:", variables.id, "server response:", updatedWorkOrder);
      queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, (old) => {
        if (!old) return old;
        return old.map(job => job.id === variables.id ? { ...job, ...updatedWorkOrder } : job);
      });
    },
    onError: (error, _variables, context) => {
      console.error("MUTATION ERROR:", error);
      if (context?.previousData) {
        queryClient.setQueryData(workOrdersQueryKey, context.previousData);
      }
      toast({
        title: "Fel",
        description: "Kunde inte uppdatera jobbet.",
        variant: "destructive",
      });
    },
  });

  const unscheduleWorkOrderMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("PATCH", `/api/work-orders/${id}`, {
        resourceId: null,
        scheduledDate: null,
        scheduledStartTime: null,
        status: "draft",
        orderStatus: "skapad",
      });
      return response.json() as Promise<WorkOrderWithObject>;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: workOrdersQueryKey });
      const previousData = queryClient.getQueryData<WorkOrderWithObject[]>(workOrdersQueryKey);
      
      queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, (old) => {
        if (!old) return old;
        return old.map(job => 
          job.id === id 
            ? { ...job, resourceId: null, scheduledDate: null, scheduledStartTime: null, status: "draft" as const, orderStatus: "skapad" as const }
            : job
        );
      });
      
      return { previousData };
    },
    onSuccess: (updatedWorkOrder, id) => {
      queryClient.setQueryData<WorkOrderWithObject[]>(workOrdersQueryKey, (old) => {
        if (!old) return old;
        return old.map(job => job.id === id ? { ...job, ...updatedWorkOrder } : job);
      });
      toast({
        title: "Avschemalagt",
        description: "Jobbet flyttades tillbaka till oschemalagda.",
      });
    },
    onError: (error, _id, context) => {
      console.error("UNSCHEDULE ERROR:", error);
      if (context?.previousData) {
        queryClient.setQueryData(workOrdersQueryKey, context.previousData);
      }
      toast({
        title: "Fel",
        description: "Kunde inte avschemalägg jobbet.",
        variant: "destructive",
      });
    },
  });

  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  
  const unscheduledJobs = useMemo(() => {
    const jobs = workOrders.filter(job => !job.scheduledDate || !job.resourceId);
    
    const filtered = jobs.filter(job => {
      if (filterCustomer !== "all" && job.customerId !== filterCustomer) return false;
      if (filterPriority !== "all" && job.priority !== filterPriority) return false;
      if (filterCluster !== "all") {
        if (filterCluster === "none") {
          if (job.clusterId) return false;
        } else {
          if (job.clusterId !== filterCluster) return false;
        }
      }
      if (filterTeam !== "all") {
        if (job.teamId && job.teamId !== filterTeam) return false;
        if (!job.teamId && teamResourceIds && job.resourceId && !teamResourceIds.has(job.resourceId)) return false;
      }
      return true;
    });
    
    return filtered.sort((a, b) => {
      const aPriority = priorityOrder[a.priority] ?? 99;
      const bPriority = priorityOrder[b.priority] ?? 99;
      return aPriority - bPriority;
    });
  }, [workOrders, filterCustomer, filterPriority, filterCluster, filterTeam, teamResourceIds]);
  
  const scheduledJobs = useMemo(
    () => workOrders.filter(job => job.scheduledDate && job.resourceId),
    [workOrders]
  );

  const filteredScheduledJobs = useMemo(() => {
    return scheduledJobs.filter(job => {
      if (filterCustomer !== "all" && job.customerId !== filterCustomer) return false;
      if (filterPriority !== "all" && job.priority !== filterPriority) return false;
      return true;
    });
  }, [scheduledJobs, filterCustomer, filterPriority]);

  const resourceDayJobMap = useMemo(() => {
    const map: Record<string, Record<string, WorkOrderWithObject[]>> = {};
    const hoursMap: Record<string, Record<string, number>> = {};
    
    for (const job of filteredScheduledJobs) {
      if (!job.resourceId || !job.scheduledDate) continue;
      const resourceId = job.resourceId;
      const dateStr = typeof job.scheduledDate === 'string' 
        ? job.scheduledDate 
        : (job.scheduledDate as Date).toISOString();
      const dayKey = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr.split(" ")[0];
      
      if (!map[resourceId]) {
        map[resourceId] = {};
        hoursMap[resourceId] = {};
      }
      if (!map[resourceId][dayKey]) {
        map[resourceId][dayKey] = [];
        hoursMap[resourceId][dayKey] = 0;
      }
      map[resourceId][dayKey].push(job);
      hoursMap[resourceId][dayKey] += (job.estimatedDuration || 0) / 60;
    }
    
    return { jobs: map, hours: hoursMap };
  }, [filteredScheduledJobs]);

  const routeJobsForView = useMemo(() => {
    if (viewMode !== "route" || !routeViewResourceId) return [];
    const dateKey = format(currentDate, "yyyy-MM-dd");
    const baseRouteJobs = (resourceDayJobMap.jobs[routeViewResourceId]?.[dateKey] || [])
      .filter(j => j.taskLatitude && j.taskLongitude)
      .sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
    
    return routeJobOrder.length > 0 && routeJobOrder.every(id => baseRouteJobs.some(j => j.id === id))
      ? routeJobOrder.map(id => baseRouteJobs.find(j => j.id === id)!).filter(Boolean)
      : baseRouteJobs;
  }, [viewMode, routeViewResourceId, currentDate, resourceDayJobMap, routeJobOrder]);

  const navigate = (direction: "prev" | "next") => {
    if (viewMode === "day" || viewMode === "route") {
      const newDate = addDays(currentDate, direction === "next" ? 1 : -1);
      setCurrentDate(newDate);
      setCurrentWeekStart(startOfWeek(newDate, { weekStartsOn: 1 }));
    } else if (viewMode === "week") {
      const newWeekStart = addDays(currentWeekStart, direction === "next" ? 7 : -7);
      setCurrentWeekStart(newWeekStart);
      setCurrentDate(newWeekStart);
    } else {
      const newDate = addMonths(currentDate, direction === "next" ? 1 : -1);
      setCurrentDate(newDate);
      setCurrentWeekStart(startOfWeek(newDate, { weekStartsOn: 1 }));
    }
  };

  const handleViewModeChange = (newMode: ViewMode) => {
    if (newMode === "week") {
      setCurrentWeekStart(startOfWeek(currentDate, { weekStartsOn: 1 }));
    }
    setViewMode(newMode);
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setCurrentWeekStart(startOfWeek(today, { weekStartsOn: 1 }));
  };

  const goToDay = (day: Date) => {
    setCurrentDate(day);
    setCurrentWeekStart(startOfWeek(day, { weekStartsOn: 1 }));
    setViewMode("day");
  };

  const getHeaderLabel = () => {
    if (viewMode === "day" || viewMode === "route") {
      return format(currentDate, "EEEE d MMMM yyyy", { locale: sv });
    } else if (viewMode === "week") {
      return `Vecka ${format(currentWeekStart, "w", { locale: sv })} - ${format(currentWeekStart, "MMMM yyyy", { locale: sv })}`;
    } else {
      return format(currentDate, "MMMM yyyy", { locale: sv });
    }
  };

  const getJobsForResourceAndDay = useCallback((resourceId: string, day: Date) => {
    const dayKey = format(day, "yyyy-MM-dd");
    return resourceDayJobMap.jobs[resourceId]?.[dayKey] || [];
  }, [resourceDayJobMap]);

  const getResourceDayHours = useCallback((resourceId: string, day: Date) => {
    const dayKey = format(day, "yyyy-MM-dd");
    return resourceDayJobMap.hours[resourceId]?.[dayKey] || 0;
  }, [resourceDayJobMap]);

  const getCapacityPercentage = useCallback((hours: number) => {
    return Math.min((hours / HOURS_IN_DAY) * 100, 100);
  }, []);

  const handleJobClick = useCallback((jobId: string) => {
    setSelectedJob(jobId);
    onSelectJob?.(jobId);
  }, [onSelectJob]);

  const handleOpenAssignDialog = useCallback((job: WorkOrderWithObject, e: React.MouseEvent) => {
    e.stopPropagation();
    setJobToAssign(job);
    setAssignDate(format(currentDate, "yyyy-MM-dd"));
    setAssignResourceId(null);
    setAssignDialogOpen(true);
  }, [currentDate]);

  const handleQuickAssign = useCallback(() => {
    if (!jobToAssign || !assignResourceId || !assignDate) return;
    
    updateWorkOrderMutation.mutate({
      id: jobToAssign.id,
      resourceId: assignResourceId,
      scheduledDate: assignDate,
    });
    setAssignDialogOpen(false);
    setJobToAssign(null);
    setAssignResourceId(null);
  }, [jobToAssign, assignResourceId, assignDate, updateWorkOrderMutation]);

  // Route optimization and export handlers
  const handleOptimizeRoute = useCallback(async () => {
    if (routeJobsForView.length < 2) return;
    
    setIsOptimizing(true);
    try {
      const stops = routeJobsForView.map(j => ({
        workOrderId: j.id,
        objectId: j.objectId || "",
        objectName: j.objectName || j.title,
        latitude: j.taskLatitude || 0,
        longitude: j.taskLongitude || 0,
        estimatedDuration: j.estimatedDuration || 0,
        scheduledStartTime: j.scheduledStartTime || undefined
      }));
      
      const response = await apiRequest("POST", "/api/route/optimize", { stops });
      const result = await response.json();
      
      if (result.optimizedStops) {
        const newOrder = result.optimizedStops.map((s: { workOrderId: string }) => s.workOrderId);
        setRouteJobOrder(newOrder);
        
        toast({
          title: "Rutt optimerad",
          description: `Körsträcka minskad med ${result.savingsPercent}% (${result.originalDistance} km → ${result.optimizedDistance} km)`,
        });
      }
    } catch (error) {
      console.error("Failed to optimize route:", error);
      toast({
        title: "Fel vid optimering",
        description: "Kunde inte optimera rutten",
        variant: "destructive"
      });
    } finally {
      setIsOptimizing(false);
    }
  }, [routeJobsForView, toast]);

  const handleOpenGoogleMaps = useCallback(async () => {
    try {
      const stops = routeJobsForView.map(j => ({
        workOrderId: j.id,
        objectId: j.objectId || "",
        objectName: j.objectName || j.title,
        latitude: j.taskLatitude || 0,
        longitude: j.taskLongitude || 0,
        estimatedDuration: j.estimatedDuration || 0
      }));
      
      const response = await apiRequest("POST", "/api/route/google-maps-url", { stops });
      const result = await response.json();
      
      if (result.url) {
        window.open(result.url, "_blank");
      }
    } catch (error) {
      console.error("Failed to generate Google Maps URL:", error);
      toast({
        title: "Fel",
        description: "Kunde inte öppna Google Maps",
        variant: "destructive"
      });
    }
  }, [routeJobsForView, toast]);

  const handlePrintRoute = useCallback(() => {
    const selectedResource = routeViewResourceId ? resources.find(r => r.id === routeViewResourceId) : null;
    const dateStr = format(currentDate, "yyyy-MM-dd");
    const printWindow = window.open("", "_blank");
    
    if (!printWindow) {
      toast({ title: "Fel", description: "Kunde inte öppna utskriftsfönster", variant: "destructive" });
      return;
    }
    
    // Calculate total travel time
    let totalTravelTime = 0;
    for (let i = 0; i < routeJobsForView.length - 1; i++) {
      const lat1 = routeJobsForView[i].taskLatitude || 0;
      const lon1 = routeJobsForView[i].taskLongitude || 0;
      const lat2 = routeJobsForView[i + 1].taskLatitude || 0;
      const lon2 = routeJobsForView[i + 1].taskLongitude || 0;
      
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c;
      totalTravelTime += Math.round((distance / 40) * 60);
    }
    
    // Generate Google Maps URL for QR code
    const validStops = routeJobsForView.filter(j => j.taskLatitude && j.taskLongitude);
    let googleMapsUrl = "";
    if (validStops.length > 0) {
      const origin = `${validStops[0].taskLatitude},${validStops[0].taskLongitude}`;
      const destination = validStops.length > 1 
        ? `${validStops[validStops.length - 1].taskLatitude},${validStops[validStops.length - 1].taskLongitude}`
        : origin;
      const waypoints = validStops.slice(1, -1).map(s => `${s.taskLatitude},${s.taskLongitude}`).join("|");
      googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
      if (waypoints) googleMapsUrl += `&waypoints=${encodeURIComponent(waypoints)}`;
    }
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Rutt - ${selectedResource?.name || "Resurs"} - ${dateStr}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
          h1 { font-size: 24px; margin-bottom: 8px; }
          .header { margin-bottom: 20px; }
          .meta { color: #666; font-size: 14px; margin-bottom: 4px; }
          .summary { background: #f5f5f5; padding: 12px; border-radius: 4px; margin-bottom: 20px; display: flex; gap: 20px; }
          .summary-item { text-align: center; }
          .summary-value { font-size: 20px; font-weight: bold; }
          .summary-label { font-size: 12px; color: #666; }
          .stop { border: 1px solid #ddd; border-radius: 4px; padding: 12px; margin-bottom: 8px; display: flex; align-items: flex-start; gap: 12px; }
          .stop-number { width: 28px; height: 28px; background: #3b82f6; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; flex-shrink: 0; }
          .stop-number.first { background: #22c55e; }
          .stop-number.last { background: #ef4444; }
          .stop-content { flex: 1; }
          .stop-title { font-weight: 600; margin-bottom: 4px; }
          .stop-address { color: #666; font-size: 13px; }
          .stop-time { font-size: 12px; color: #888; margin-top: 4px; }
          .google-maps { margin-top: 20px; padding: 12px; background: #e3f2fd; border-radius: 4px; }
          .google-maps a { color: #1976d2; font-weight: 500; }
          @media print { 
            body { padding: 0; } 
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Körschema: ${selectedResource?.name || "Resurs"}</h1>
          <div class="meta">Datum: ${format(currentDate, "EEEE d MMMM yyyy", { locale: sv })}</div>
          <div class="meta">Utskrivet: ${format(new Date(), "yyyy-MM-dd HH:mm", { locale: sv })}</div>
        </div>
        
        <div class="summary">
          <div class="summary-item">
            <div class="summary-value">${routeJobsForView.length}</div>
            <div class="summary-label">Stopp</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">${totalTravelTime} min</div>
            <div class="summary-label">Uppskattad körtid</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">${(routeJobsForView.reduce((sum, j) => sum + (j.estimatedDuration || 0), 0) / 60).toFixed(1)}h</div>
            <div class="summary-label">Arbetstid</div>
          </div>
        </div>
        
        ${routeJobsForView.map((job, idx) => `
          <div class="stop">
            <div class="stop-number ${idx === 0 ? "first" : idx === routeJobsForView.length - 1 ? "last" : ""}">${idx + 1}</div>
            <div class="stop-content">
              <div class="stop-title">${job.title}</div>
              <div class="stop-address">${job.objectName || ""}</div>
              ${job.scheduledStartTime ? `<div class="stop-time">Planerad start: ${job.scheduledStartTime}</div>` : ""}
              ${job.estimatedDuration ? `<div class="stop-time">Uppskattad tid: ${(job.estimatedDuration / 60).toFixed(1)}h</div>` : ""}
            </div>
          </div>
        `).join("")}
        
        ${googleMapsUrl ? `
          <div class="google-maps">
            <strong>Öppna rutten i Google Maps:</strong><br/>
            <a href="${googleMapsUrl}" target="_blank">${googleMapsUrl.substring(0, 80)}...</a>
          </div>
        ` : ""}
        
        <script>window.print();</script>
      </body>
      </html>
    `;
    
    printWindow.document.write(html);
    printWindow.document.close();
  }, [routeJobsForView, routeViewResourceId, resources, currentDate, toast]);

  const handleSendToMobile = useCallback(async () => {
    if (!routeViewResourceId || routeJobsForView.length === 0) return;
    
    setIsSendingToMobile(true);
    try {
      const stops = routeJobsForView.map(j => ({
        workOrderId: j.id,
        objectId: j.objectId || "",
        objectName: j.objectName || j.title,
        title: j.title,
        latitude: j.taskLatitude || 0,
        longitude: j.taskLongitude || 0,
        estimatedDuration: j.estimatedDuration || 0,
        scheduledStartTime: j.scheduledStartTime || undefined
      }));
      
      // Generate Google Maps URL
      const urlResponse = await apiRequest("POST", "/api/route/google-maps-url", { stops });
      const { url: googleMapsUrl } = await urlResponse.json();
      
      // Send to mobile app
      await apiRequest("POST", "/api/route/send-to-mobile", {
        resourceId: routeViewResourceId,
        stops,
        date: format(currentDate, "yyyy-MM-dd"),
        googleMapsUrl
      });
      
      const selectedResource = resources.find(r => r.id === routeViewResourceId);
      toast({
        title: "Rutt skickad",
        description: `Rutten har skickats till ${selectedResource?.name || "resursen"}s mobilapp`,
      });
    } catch (error) {
      console.error("Failed to send route to mobile:", error);
      toast({
        title: "Fel",
        description: "Kunde inte skicka rutt till mobilappen",
        variant: "destructive"
      });
    } finally {
      setIsSendingToMobile(false);
    }
  }, [routeViewResourceId, routeJobsForView, currentDate, resources, toast]);

  const addToUndoStack = useCallback((action: PlannerAction) => {
    setUndoStack(prev => [...prev.slice(-19), action]);
    setRedoStack([]);
  }, []);

  const handleDndDragStart = useCallback((event: DragStartEvent) => {
    const jobId = event.active.id as string;
    const job = workOrders.find(j => j.id === jobId);
    setActiveDragJob(job || null);
  }, [workOrders]);

  const applyActionMutation = useMutation({
    mutationFn: async ({ jobId, state }: { jobId: string; state: PlannerAction["previousState"] }) => {
      const response = await apiRequest("PATCH", `/api/work-orders/${jobId}`, {
        resourceId: state.resourceId,
        scheduledDate: state.scheduledDate,
        scheduledStartTime: state.scheduledStartTime,
        status: state.status,
        orderStatus: state.orderStatus,
      });
      return response.json() as Promise<WorkOrderWithObject>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workOrdersQueryKey });
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte ångra/göra om ändringen.",
        variant: "destructive",
      });
    },
  });

  const sendScheduleMutation = useMutation({
    mutationFn: async ({ resourceId, jobs, dateRange }: { 
      resourceId: string; 
      jobs: Array<{
        id: string;
        title: string;
        objectName?: string;
        objectAddress?: string;
        scheduledDate: string;
        scheduledStartTime?: string;
        estimatedDuration?: number;
        accessCode?: string;
        keyNumber?: string;
      }>;
      dateRange: { start: string; end: string };
    }) => {
      const fieldAppUrl = `${window.location.origin}/field`;
      const response = await apiRequest("POST", `/api/notifications/send-schedule/${resourceId}`, {
        jobs,
        dateRange,
        fieldAppUrl,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: "Schema skickat!",
          description: `Schemat har skickats till ${data.recipient}`,
        });
        setSendScheduleDialogOpen(false);
      } else {
        toast({
          title: "Kunde inte skicka",
          description: data.error || "Ett fel uppstod",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Fel",
        description: error instanceof Error ? error.message : "Kunde inte skicka schema",
        variant: "destructive",
      });
    },
  });

  const getResourceScheduleJobs = useCallback((resourceId: string) => {
    const startDate = viewMode === "week" ? currentWeekStart : currentDate;
    const endDate = viewMode === "week" 
      ? addDays(currentWeekStart, 4) 
      : viewMode === "month" 
        ? addDays(startOfMonth(currentDate), getDaysInMonth(currentDate) - 1)
        : currentDate;
    
    return workOrders
      .filter(job => 
        job.resourceId === resourceId && 
        job.scheduledDate &&
        new Date(job.scheduledDate) >= startDate &&
        new Date(job.scheduledDate) <= endDate
      )
      .map(job => {
        let dateStr = "";
        if (job.scheduledDate) {
          if (typeof job.scheduledDate === 'string') {
            dateStr = job.scheduledDate;
          } else if (job.scheduledDate instanceof Date) {
            dateStr = job.scheduledDate.toISOString();
          } else {
            dateStr = new Date(job.scheduledDate as unknown as string).toISOString();
          }
        }
        return {
          id: job.id,
          title: job.title,
          objectName: job.objectName || undefined,
          objectAddress: job.objectAddress || undefined,
          scheduledDate: dateStr,
          scheduledStartTime: job.scheduledStartTime || undefined,
          estimatedDuration: job.estimatedDuration || undefined,
          accessCode: job.objectAccessCode || undefined,
          keyNumber: job.objectKeyNumber || undefined,
        };
      });
  }, [workOrders, viewMode, currentWeekStart, currentDate]);

  const handleSendSchedule = useCallback((resource: Resource) => {
    setSendScheduleResource(resource);
    setSendScheduleCopied(false);
    setSendScheduleDialogOpen(true);
  }, []);

  const handleSendScheduleEmail = useCallback(() => {
    if (!sendScheduleResource) return;
    
    const jobs = getResourceScheduleJobs(sendScheduleResource.id);
    if (jobs.length === 0) {
      toast({
        title: "Inga jobb att skicka",
        description: "Resursen har inga planerade jobb för denna period.",
        variant: "destructive",
      });
      return;
    }
    
    const startDate = viewMode === "week" ? format(currentWeekStart, "yyyy-MM-dd") : format(currentDate, "yyyy-MM-dd");
    const endDate = viewMode === "week" 
      ? format(addDays(currentWeekStart, 4), "yyyy-MM-dd")
      : viewMode === "month"
        ? format(addDays(startOfMonth(currentDate), getDaysInMonth(currentDate) - 1), "yyyy-MM-dd")
        : format(currentDate, "yyyy-MM-dd");
    
    sendScheduleMutation.mutate({
      resourceId: sendScheduleResource.id,
      jobs,
      dateRange: { start: startDate, end: endDate },
    });
  }, [sendScheduleResource, getResourceScheduleJobs, sendScheduleMutation, viewMode, currentWeekStart, currentDate, toast]);

  const handleCopyFieldAppLink = useCallback(async () => {
    const fieldAppUrl = `${window.location.origin}/field`;
    try {
      await navigator.clipboard.writeText(fieldAppUrl);
      setSendScheduleCopied(true);
      toast({
        title: "Länk kopierad!",
        description: "Klistra in i SMS eller meddelande.",
      });
      setTimeout(() => setSendScheduleCopied(false), 3000);
    } catch {
      toast({
        title: "Kunde inte kopiera",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    
    const lastAction = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, lastAction]);
    
    applyActionMutation.mutate({
      jobId: lastAction.jobId,
      state: lastAction.previousState,
    });
    
    toast({ title: "Ändring ångrad" });
  }, [undoStack, applyActionMutation, toast]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    
    const lastAction = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, lastAction]);
    
    applyActionMutation.mutate({
      jobId: lastAction.jobId,
      state: lastAction.newState,
    });
    
    toast({ title: "Ändring återställd" });
  }, [redoStack, applyActionMutation, toast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (undoStack.length > 0) {
          handleUndo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (redoStack.length > 0) {
          handleRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, undoStack.length, redoStack.length]);

  const handleResourceClick = useCallback((resourceId: string) => {
    setActiveResourceId(resourceId);
  }, []);

  const activeResource = useMemo(() => {
    if (!activeResourceId) return null;
    return resources.find(r => r.id === activeResourceId) || null;
  }, [activeResourceId, resources]);

  const activeResourceJobs = useMemo(() => {
    if (!activeResourceId) return [];
    return scheduledJobs
      .filter(job => job.resourceId === activeResourceId)
      .sort((a, b) => {
        if (!a.scheduledDate || !b.scheduledDate) return 0;
        return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime();
      });
  }, [activeResourceId, scheduledJobs]);

  const activeResourceJobsByDay = useMemo(() => {
    const map: Record<string, WorkOrderWithObject[]> = {};
    for (const job of activeResourceJobs) {
      if (!job.scheduledDate) continue;
      const dateStr = typeof job.scheduledDate === 'string' 
        ? job.scheduledDate 
        : (job.scheduledDate as Date).toISOString();
      const dayKey = dateStr.split("T")[0];
      if (!map[dayKey]) map[dayKey] = [];
      map[dayKey].push(job);
    }
    return map;
  }, [activeResourceJobs]);

  const { data: teamsData = [] } = useQuery<Array<{ id: string; name: string; clusterId: string | null; color: string | null }>>({
    queryKey: ["/api/teams"],
  });

  const { data: teamMembersData = [] } = useQuery<Array<{ teamId: string; resourceId: string }>>({
    queryKey: ["/api/team-members"],
  });

  const [filterTeam, setFilterTeam] = useState<string>("all");

  const resourceTeamMap = useMemo(() => {
    const map = new Map<string, string[]>();
    teamMembersData.forEach(tm => {
      const existing = map.get(tm.resourceId) || [];
      existing.push(tm.teamId);
      map.set(tm.resourceId, existing);
    });
    return map;
  }, [teamMembersData]);

  const teamResourceIds = useMemo(() => {
    if (filterTeam === "all") return null;
    const ids = new Set<string>();
    teamMembersData.forEach(tm => {
      if (tm.teamId === filterTeam) ids.add(tm.resourceId);
    });
    return ids;
  }, [filterTeam, teamMembersData]);

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

  const detectDropConflicts = useCallback((job: WorkOrderWithObject, resourceId: string, dateStr: string, startTime?: string): string[] => {
    const reasons: string[] = [];
    const dateObj = new Date(dateStr + "T12:00:00Z");
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const jobDay = dayNames[dateObj.getUTCDay()];

    const tws = timewindowMap.get(job.id);
    if (tws && tws.length > 0) {
      const dayMatch = tws.filter(tw => !tw.dayOfWeek || tw.dayOfWeek === jobDay);
      if (dayMatch.length > 0) {
        for (const tw of dayMatch) {
          if (tw.startTime && tw.endTime && startTime) {
            if (startTime < tw.startTime || startTime > tw.endTime) {
              reasons.push(`Utanför tidsfönster (${tw.startTime}–${tw.endTime})`);
            }
          }
        }
      } else if (tws.some(tw => tw.dayOfWeek)) {
        const allowedDays = tws.filter(tw => tw.dayOfWeek).map(tw => tw.dayOfWeek);
        reasons.push(`Fel dag — tillåtna: ${allowedDays.join(", ")}`);
      }
    }

    const plannedStart = job.plannedWindowStart ? new Date(job.plannedWindowStart) : null;
    const plannedEnd = job.plannedWindowEnd ? new Date(job.plannedWindowEnd) : null;
    if (plannedStart && dateObj < plannedStart) {
      reasons.push(`Före leveransfönster (${format(plannedStart, "d MMM", { locale: sv })})`);
    }
    if (plannedEnd && dateObj > plannedEnd) {
      reasons.push(`Efter leveransfönster (${format(plannedEnd, "d MMM", { locale: sv })})`);
    }

    if (startTime) {
      const jobDur = job.estimatedDuration || 60;
      const [jH, jM] = startTime.split(":").map(Number);
      const jobStartMin = jH * 60 + jM;
      const jobEndMin = jobStartMin + jobDur;

      const sameResourceDayJobs = scheduledJobs.filter(
        j => j.id !== job.id && j.resourceId === resourceId && j.scheduledDate &&
          isSameDay(new Date(j.scheduledDate), dateObj)
      );
      for (const other of sameResourceDayJobs) {
        if (!other.scheduledStartTime) continue;
        const [oH, oM] = other.scheduledStartTime.split(":").map(Number);
        const otherStart = oH * 60 + oM;
        const otherEnd = otherStart + (other.estimatedDuration || 60);
        if (jobStartMin < otherEnd && jobEndMin > otherStart) {
          reasons.push(`Överlapp med "${other.title}" (${other.scheduledStartTime})`);
          break;
        }
      }
    }

    return reasons;
  }, [scheduledJobs, timewindowMap]);

  const executeSchedule = useCallback((jobId: string, resourceId: string, scheduledDate: string, scheduledStartTime?: string) => {
    const job = workOrders.find(j => j.id === jobId);
    if (!job) return;

    const previousDateStr = job.scheduledDate
      ? format(new Date(job.scheduledDate), "yyyy-MM-dd")
      : null;

    addToUndoStack({
      type: "schedule",
      jobId,
      previousState: {
        resourceId: job.resourceId || null,
        scheduledDate: previousDateStr,
        scheduledStartTime: job.scheduledStartTime || null,
        status: job.status,
        orderStatus: job.orderStatus,
      },
      newState: {
        resourceId,
        scheduledDate,
        scheduledStartTime: scheduledStartTime || null,
        status: "scheduled",
        orderStatus: "planerad_resurs",
      },
    });

    updateWorkOrderMutation.mutate({
      id: jobId,
      resourceId,
      scheduledDate,
      scheduledStartTime,
    });
  }, [workOrders, addToUndoStack, updateWorkOrderMutation]);

  const handleAcceptConflict = useCallback(() => {
    if (!pendingSchedule) return;
    executeSchedule(pendingSchedule.jobId, pendingSchedule.resourceId, pendingSchedule.scheduledDate, pendingSchedule.scheduledStartTime);
    setConflictDialogOpen(false);
    setPendingSchedule(null);
    toast({
      title: "Schemalagt trots varning",
      description: "Jobbet har schemalagts trots identifierade konflikter.",
    });
  }, [pendingSchedule, executeSchedule, toast]);

  const handleDndDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragJob(null);
    
    const { active, over } = event;
    if (!over) return;
    
    const jobId = active.id as string;
    const dropId = over.id as string;
    
    if (viewMode === "route" && routeJobsForView.length > 0) {
      const isRouteJob = routeJobsForView.some(j => j.id === jobId);
      const isDropOnRouteJob = routeJobsForView.some(j => j.id === dropId);
      
      if (isRouteJob && isDropOnRouteJob && jobId !== dropId) {
        const oldIndex = routeJobsForView.findIndex(j => j.id === jobId);
        const newIndex = routeJobsForView.findIndex(j => j.id === dropId);
        
        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = arrayMove(routeJobsForView, oldIndex, newIndex);
          setRouteJobOrder(newOrder.map(j => j.id));
          
          let currentMinutes = 8 * 60;
          const dateStr = format(currentDate, "yyyy-MM-dd");
          
          newOrder.forEach((job, idx) => {
            const hours = Math.floor(currentMinutes / 60);
            const mins = currentMinutes % 60;
            const newStartTime = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
            
            updateWorkOrderMutation.mutate({
              id: job.id,
              resourceId: job.resourceId!,
              scheduledDate: dateStr,
              scheduledStartTime: newStartTime
            });
            
            const jobDuration = job.estimatedDuration || 30;
            const travelBuffer = idx < newOrder.length - 1 ? 5 : 0;
            currentMinutes += jobDuration + travelBuffer;
          });
          
          toast({
            title: "Körordning uppdaterad",
            description: `${newOrder.length} stopp har fått ny ordning`,
          });
        }
        return;
      }
    }
    
    const job = workOrders.find(j => j.id === jobId);
    if (!job) return;
    
    const parts = dropId.split("|");
    if (parts.length < 2) return;
    
    const resourceId = parts[0];
    const dateStr = parts[1];
    const hour = parts[2] ? parseInt(parts[2], 10) : undefined;
    const day = new Date(dateStr + "T12:00:00Z");
    
    const isSameResourceAndDay = job.resourceId === resourceId && 
      job.scheduledDate && isSameDay(new Date(job.scheduledDate), day);
    
    if (isSameResourceAndDay && hour === undefined) return;
    
    const scheduledStartTime = hour !== undefined ? `${hour.toString().padStart(2, "0")}:00` : undefined;

    const conflicts = detectDropConflicts(job, resourceId, dateStr, scheduledStartTime);
    if (conflicts.length > 0) {
      setPendingSchedule({ jobId, resourceId, scheduledDate: dateStr, scheduledStartTime, conflicts });
      setConflictDialogOpen(true);
      return;
    }

    executeSchedule(jobId, resourceId, dateStr, scheduledStartTime);
  }, [workOrders, executeSchedule, detectDropConflicts, viewMode, routeJobsForView, toast, updateWorkOrderMutation, currentDate]);

  const jobConflicts = useMemo(() => {
    const conflicts: Record<string, string[]> = {};

    for (const job of scheduledJobs) {
      if (!job.scheduledDate || !job.resourceId) continue;
      const reasons: string[] = [];

      const dateObj = new Date(job.scheduledDate);
      const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const jobDay = dayNames[dateObj.getUTCDay()];
      const jobStartTime = job.scheduledStartTime || null;
      const tws = timewindowMap.get(job.id);
      if (tws && tws.length > 0) {
        const dayMatch = tws.filter(tw => !tw.dayOfWeek || tw.dayOfWeek === jobDay);
        if (dayMatch.length > 0) {
          for (const tw of dayMatch) {
            if (tw.startTime && tw.endTime && jobStartTime) {
              if (jobStartTime < tw.startTime || jobStartTime > tw.endTime) {
                reasons.push(`Utanför tidsfönster (${tw.startTime}–${tw.endTime})`);
              }
            }
          }
        } else if (tws.some(tw => tw.dayOfWeek)) {
          const allowedDays = tws.filter(tw => tw.dayOfWeek).map(tw => tw.dayOfWeek);
          reasons.push(`Fel dag — tillåtna: ${allowedDays.join(", ")}`);
        }
      }

      const plannedStart = job.plannedWindowStart ? new Date(job.plannedWindowStart) : null;
      const plannedEnd = job.plannedWindowEnd ? new Date(job.plannedWindowEnd) : null;
      if (plannedStart && dateObj < plannedStart) {
        reasons.push(`Schemalagd före leveransfönster (${format(plannedStart, "d MMM", { locale: sv })})`);
      }
      if (plannedEnd && dateObj > plannedEnd) {
        reasons.push(`Schemalagd efter leveransfönster (${format(plannedEnd, "d MMM", { locale: sv })})`);
      }

      const sameResourceDayJobs = scheduledJobs.filter(
        j => j.id !== job.id && j.resourceId === job.resourceId && j.scheduledDate &&
          isSameDay(new Date(j.scheduledDate), dateObj)
      );
      if (jobStartTime) {
        const jobDurationMin = job.estimatedDuration || 60;
        const [jH, jM] = jobStartTime.split(":").map(Number);
        const jobStartMin = jH * 60 + jM;
        const jobEndMin = jobStartMin + jobDurationMin;

        for (const other of sameResourceDayJobs) {
          if (!other.scheduledStartTime) continue;
          const [oH, oM] = other.scheduledStartTime.split(":").map(Number);
          const otherStart = oH * 60 + oM;
          const otherEnd = otherStart + (other.estimatedDuration || 60);
          if (jobStartMin < otherEnd && jobEndMin > otherStart) {
            reasons.push(`Överlapp med "${other.title}" (${other.scheduledStartTime})`);
            break;
          }
        }
      }

      if (reasons.length > 0) {
        conflicts[job.id] = reasons;
      }
    }
    return conflicts;
  }, [scheduledJobs, timewindowMap]);

  const isLoading = resourcesLoading || workOrdersLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleUnschedule = (e: { stopPropagation: () => void }, jobId: string) => {
    e.stopPropagation();
    
    const job = workOrders.find(j => j.id === jobId);
    if (job) {
      const previousDateStr = job.scheduledDate 
        ? format(new Date(job.scheduledDate), "yyyy-MM-dd")
        : null;
      
      addToUndoStack({
        type: "unschedule",
        jobId,
        previousState: {
          resourceId: job.resourceId || null,
          scheduledDate: previousDateStr,
          scheduledStartTime: job.scheduledStartTime || null,
          status: job.status,
          orderStatus: job.orderStatus,
        },
        newState: {
          resourceId: null,
          scheduledDate: null,
          scheduledStartTime: null,
          status: "draft",
          orderStatus: "skapad",
        },
      });
    }
    
    unscheduleWorkOrderMutation.mutate(jobId);
  };

  const renderJobCard = (job: WorkOrderWithObject, compact = false) => {
    const execStatus = (job as { executionStatus?: string }).executionStatus || "not_planned";
    const execIndex = executionStatusOrder.indexOf(execStatus);
    const execProgress = ((execIndex + 1) / executionStatusOrder.length) * 100;
    
    const jobDependencies = dependenciesData?.dependencies?.[job.id] || [];
    const jobDependents = dependenciesData?.dependents?.[job.id] || [];
    const hasDependencies = jobDependencies.length > 0;
    const hasDependents = jobDependents.length > 0;
    const category = getJobCategory(job);
    const hasConflict = job.scheduledDate && jobConflicts[job.id];
    
    return (
      <DraggableJobCard key={job.id} id={job.id}>
        <Card
          className={`p-2 cursor-grab active:cursor-grabbing hover-elevate active-elevate-2 border-l-4 ${timeBlockBorders[category]} ${selectedJob === job.id ? "ring-2 ring-primary" : ""} ${hasConflict ? "ring-2 ring-red-500 bg-red-50 dark:bg-red-950/30" : ""} group touch-none`}
          onClick={() => handleJobClick(job.id)}
          data-testid={`job-card-${job.id}`}
        >
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${executionStatusColors[execStatus] || "bg-gray-400"} ${
                      (execStatus === "on_way" || execStatus === "on_site") ? "animate-pulse" : ""
                    }`} />
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs">
                      <p className="font-medium">{executionStatusLabels[execStatus] || execStatus}</p>
                      {execStatus === "on_way" && <p className="text-muted-foreground">Fältarbetaren är på väg</p>}
                      {execStatus === "on_site" && <p className="text-muted-foreground">Fältarbetaren är på plats</p>}
                    </div>
                  </TooltipContent>
                </Tooltip>
                <span className="text-xs font-medium truncate">{job.title}</span>
                {(hasDependencies || hasDependents) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 shrink-0">
                        {hasDependencies && (
                          <Link2 className="h-3 w-3 text-orange-500" />
                        )}
                        {hasDependents && (
                          <ArrowRight className="h-3 w-3 text-blue-500" />
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs space-y-1">
                        {hasDependencies && (
                          <p className="flex items-center gap-1">
                            <Link2 className="h-3 w-3 text-orange-500" />
                            Beroende av {jobDependencies.length} uppgift{jobDependencies.length > 1 ? "er" : ""}
                          </p>
                        )}
                        {hasDependents && (
                          <p className="flex items-center gap-1">
                            <ArrowRight className="h-3 w-3 text-blue-500" />
                            Blockerar {jobDependents.length} uppgift{jobDependents.length > 1 ? "er" : ""}
                          </p>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate">{job.objectName || "Okänt objekt"}</div>
              {/* Åtkomstinformation */}
              {(job.objectAccessCode || job.objectKeyNumber) && (
                <div className="flex items-center gap-2 mt-0.5">
                  {job.objectAccessCode && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                          <DoorOpen className="h-2.5 w-2.5" />
                          {job.objectAccessCode}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Portkod</TooltipContent>
                    </Tooltip>
                  )}
                  {job.objectKeyNumber && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                          <Key className="h-2.5 w-2.5" />
                          {job.objectKeyNumber}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Nyckelnummer</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
              {hasConflict && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400 mt-0.5 cursor-help" data-testid={`conflict-warning-${job.id}`}>
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span className="truncate">{jobConflicts[job.id][0]}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <div className="space-y-1">
                      <p className="font-medium text-red-600 dark:text-red-400">Konfliktvarning</p>
                      {jobConflicts[job.id].map((reason, i) => (
                        <p key={i} className="text-xs flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                          {reason}
                        </p>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
              {!compact && (
                <>
                  {job.scheduledStartTime && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      <Clock className="h-3 w-3" />
                      {job.scheduledStartTime}
                    </div>
                  )}
                  <div className="flex items-center gap-1 mt-1">
                    <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                      <div 
                        className={`h-full ${executionStatusColors[execStatus] || "bg-gray-400"} transition-all`}
                        style={{ width: `${execProgress}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-muted-foreground">{execIndex + 1}/8</span>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                    onClick={(e) => handleUnschedule(e, job.id)}
                    data-testid={`button-unschedule-${job.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Avschemalägg</TooltipContent>
              </Tooltip>
              <Badge variant={statusBadgeVariant[job.status] || "outline"} className="text-[10px]">
                {((job.estimatedDuration || 0) / 60).toFixed(1).replace(".", ",")} h
              </Badge>
            </div>
          </div>
        </Card>
      </DraggableJobCard>
    );
  };

  const renderDayTimelineView = () => {
    const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);
    const day = currentDate;

    return (
      <div className="flex-1 overflow-auto">
        <div className="min-w-[600px]">
          <div className="grid border-b sticky top-0 bg-background z-10" style={{ gridTemplateColumns: `200px repeat(${resources.length}, 1fr)` }}>
            <div className="p-3 font-medium text-sm text-muted-foreground border-r">Tid</div>
            {resources.map((resource) => {
              const dayHours = getResourceDayHours(resource.id, day);
              const capacityPct = getCapacityPercentage(dayHours);
              return (
                <div key={resource.id} className="p-3 text-center border-r last:border-r-0">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{resource.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={capacityPct} className={`h-2 ${capacityPct > 100 ? "[&>div]:bg-orange-500" : ""}`} />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{dayHours.toFixed(1)}h</span>
                  </div>
                </div>
              );
            })}
          </div>

          {hours.map((hour) => (
            <div key={hour} className="grid border-b" style={{ gridTemplateColumns: `200px repeat(${resources.length}, 1fr)` }}>
              <div className="p-2 border-r text-sm text-muted-foreground font-medium">
                {hour.toString().padStart(2, "0")}:00
              </div>
              {resources.map((resource) => {
                const jobs = getJobsForResourceAndDay(resource.id, day).filter(job => {
                  if (!job.scheduledStartTime) return hour === DAY_START_HOUR;
                  const jobHour = parseInt(job.scheduledStartTime.split(":")[0], 10);
                  return jobHour === hour;
                });
                const dayStr = format(day, "yyyy-MM-dd");
                const droppableId = `${resource.id}|${dayStr}|${hour}`;

                return (
                  <DroppableCell
                    key={resource.id}
                    id={droppableId}
                    className="p-2 border-r last:border-r-0 min-h-[60px] transition-colors bg-muted/20"
                  >
                    <div className="space-y-1" data-testid={`drop-zone-${resource.id}-${hour}`}>
                      {jobs.map((job) => renderJobCard(job))}
                    </div>
                  </DroppableCell>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderWeekView = () => (
    <div className="flex-1 overflow-auto">
      <div className="min-w-[1000px]">
        <div className="grid grid-cols-[200px_repeat(5,1fr)] border-b sticky top-0 bg-background z-10">
          <div className="p-3 font-medium text-sm text-muted-foreground border-r">Resurser</div>
          {visibleDates.map((day, i) => {
            const isToday = isSameDay(day, new Date());
            return (
              <div key={i} className={`p-3 text-center border-r last:border-r-0 ${isToday ? "bg-primary/5" : ""}`}>
                <div className="text-xs text-muted-foreground uppercase">{format(day, "EEE", { locale: sv })}</div>
                <div className={`text-lg font-semibold ${isToday ? "text-primary" : ""}`}>{format(day, "d")}</div>
              </div>
            );
          })}
        </div>

        {resources.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            Inga resurser registrerade. Lägg till resurser för att börja planera.
          </div>
        ) : (
          resources.map((resource) => (
            <div key={resource.id} className="grid grid-cols-[200px_repeat(5,1fr)] border-b">
              <div 
                className="p-3 border-r flex items-center gap-3 group"
                data-testid={`resource-row-${resource.id}`}
              >
                <Avatar 
                  className="h-8 w-8 cursor-pointer hover-elevate"
                  onClick={() => handleResourceClick(resource.id)}
                >
                  <AvatarFallback className="text-xs">{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                </Avatar>
                <div 
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => handleResourceClick(resource.id)}
                >
                  <div className="text-sm font-medium truncate">{resource.name}</div>
                  <div className="text-xs text-muted-foreground">{resource.weeklyHours || 40}h/vecka</div>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSendSchedule(resource);
                      }}
                      data-testid={`send-schedule-${resource.id}`}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Skicka schema till {resource.name}</TooltipContent>
                </Tooltip>
              </div>
              {visibleDates.map((day, dayIndex) => {
                const jobs = getJobsForResourceAndDay(resource.id, day);
                const dayHours = getResourceDayHours(resource.id, day);
                const isOverbooked = dayHours > HOURS_IN_DAY;
                const capacityPct = getCapacityPercentage(dayHours);
                const dayStr = format(day, "yyyy-MM-dd");
                const droppableId = `${resource.id}|${dayStr}`;

                return (
                  <DroppableCell 
                    key={dayIndex} 
                    id={droppableId}
                    className="p-2 border-r last:border-r-0 min-h-[120px] transition-colors bg-muted/30"
                  >
                    <div data-testid={`drop-zone-${resource.id}-${dayStr}`}>
                      <div className="flex items-center gap-1 mb-2">
                        <Progress value={capacityPct} className={`h-1.5 flex-1 ${isOverbooked ? "[&>div]:bg-orange-500" : ""}`} />
                        <span className={`text-[10px] ${isOverbooked ? "text-orange-600" : "text-muted-foreground"}`}>
                          {dayHours.toFixed(1).replace(".", ",")} h
                        </span>
                      </div>
                      {isOverbooked && (
                        <div className="flex items-center gap-1 text-xs text-orange-600 mb-1">
                          <AlertTriangle className="h-3 w-3" />
                          <span>Överbokning</span>
                        </div>
                      )}
                      <div className="space-y-1">
                        {jobs.map((job) => renderJobCard(job, true))}
                      </div>
                    </div>
                  </DroppableCell>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderMonthView = () => (
    <div className="flex-1 overflow-auto p-4">
      <div className="grid grid-cols-7 gap-1 mb-2">
        {["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"].map((day) => (
          <div key={day} className="text-center text-xs text-muted-foreground font-medium py-2">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {(() => {
          const monthStart = startOfMonth(currentDate);
          const startDay = monthStart.getDay() || 7;
          const emptyCells = startDay - 1;
          const daysInCurrentMonth = getDaysInMonth(currentDate);
          const cells = [];
          
          for (let i = 0; i < emptyCells; i++) {
            cells.push(<div key={`empty-${i}`} className="min-h-[80px]" />);
          }
          
          for (let d = 1; d <= daysInCurrentMonth; d++) {
            const day = new Date(currentDate.getFullYear(), currentDate.getMonth(), d);
            const dayJobs = filteredScheduledJobs.filter(j => j.scheduledDate && isSameDay(new Date(j.scheduledDate), day));
            const isToday = isSameDay(day, new Date());
            const totalHours = dayJobs.reduce((sum, j) => sum + (j.estimatedDuration || 0) / 60, 0);
            
            cells.push(
              <div 
                key={d} 
                className={`min-h-[80px] p-2 rounded-md border cursor-pointer hover-elevate ${isToday ? "border-primary bg-primary/5" : "border-border bg-muted/30"}`}
                onClick={() => goToDay(day)}
                data-testid={`month-day-${d}`}
              >
                <div className={`text-sm font-medium mb-1 ${isToday ? "text-primary" : ""}`}>{d}</div>
                {dayJobs.length > 0 && (
                  <div className="space-y-1">
                    <Badge variant="secondary" className="text-[10px]">
                      {dayJobs.length} jobb
                    </Badge>
                    <div className="text-[10px] text-muted-foreground">
                      {totalHours.toFixed(1)}h
                    </div>
                  </div>
                )}
              </div>
            );
          }
          
          return cells;
        })()}
      </div>
    </div>
  );

  const renderDragOverlay = () => {
    if (!activeDragJob) return null;
    return (
      <Card className="p-3 shadow-lg border-primary/50 bg-background/95 backdrop-blur-sm w-[250px] rotate-2">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDotColors[activeDragJob.priority]}`} />
            <span className="text-sm font-medium">{activeDragJob.title}</span>
          </div>
          <div className="text-xs text-muted-foreground">{activeDragJob.objectName || "Okänt objekt"}</div>
          <Badge variant="secondary" className="text-[10px]">
            {((activeDragJob.estimatedDuration || 0) / 60).toFixed(1).replace(".", ",")} h
          </Badge>
        </div>
      </Card>
    );
  };

  const createNumberedIcon = (number: number, isFirst: boolean, isLast: boolean) => {
    const color = isFirst ? "#22c55e" : isLast ? "#ef4444" : "#3b82f6";
    return L.divIcon({
      className: "custom-marker",
      html: `<div style="
        background-color: ${color};
        color: white;
        border-radius: 50%;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 12px;
        border: 2px solid white;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      ">${number}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  };

  const MapFitBounds = ({ positions }: { positions: [number, number][] }) => {
    const map = useMap();
    useEffect(() => {
      if (positions.length > 0) {
        const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])));
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    }, [map, positions.length]);
    return null;
  };

  const calculateTravelTime = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    const avgSpeedKmH = 40;
    return Math.round((distance / avgSpeedKmH) * 60);
  };

  const renderRouteMapView = () => {
    const selectedResource = routeViewResourceId ? resources.find(r => r.id === routeViewResourceId) : null;
    const routeJobs = routeJobsForView;
    
    // Find first date with scheduled jobs for this resource (search all work orders)
    const resourceJobDates = workOrders
      .filter(j => j.resourceId === routeViewResourceId && j.scheduledDate)
      .map(j => {
        const dateStr = typeof j.scheduledDate === 'string' 
          ? j.scheduledDate 
          : (j.scheduledDate as Date).toISOString();
        return dateStr.includes("T") ? dateStr.split("T")[0] : dateStr.split(" ")[0];
      })
      .filter((v, i, a) => a.indexOf(v) === i) // unique dates
      .sort();
    
    const firstJobDate = resourceJobDates.length > 0 ? resourceJobDates[0] : null;
    const handleJumpToDate = () => {
      if (firstJobDate) {
        const date = new Date(firstJobDate + "T12:00:00Z");
        setCurrentDate(date);
        setCurrentWeekStart(startOfWeek(date, { weekStartsOn: 1 }));
      }
    };
    
    const positions: [number, number][] = routeJobs.map(j => [j.taskLatitude!, j.taskLongitude!]);
    const defaultCenter: [number, number] = positions[0] || [59.3293, 18.0686];
    
    let totalTravelTime = 0;
    const segments: { from: number; to: number; time: number }[] = [];
    for (let i = 0; i < routeJobs.length - 1; i++) {
      const time = calculateTravelTime(
        routeJobs[i].taskLatitude!,
        routeJobs[i].taskLongitude!,
        routeJobs[i + 1].taskLatitude!,
        routeJobs[i + 1].taskLongitude!
      );
      totalTravelTime += time;
      segments.push({ from: i, to: i + 1, time });
    }
    
    const totalWorkTime = routeJobs.reduce((sum, j) => sum + (j.estimatedDuration || 0), 0);

    return (
      <div className="flex-1 flex flex-col min-h-[400px]">
        <div className="flex items-center gap-4 p-3 border-b bg-muted/30 flex-wrap">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Välj resurs:</span>
          </div>
          <Select value={routeViewResourceId || ""} onValueChange={(v) => { setRouteViewResourceId(v); setRouteJobOrder([]); }}>
            <SelectTrigger className="w-[200px]" data-testid="select-route-resource">
              <SelectValue placeholder="Välj resurs..." />
            </SelectTrigger>
            <SelectContent>
              {resources.map((resource) => (
                <SelectItem key={resource.id} value={resource.id}>
                  {resource.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedResource && routeJobs.length > 0 && (
            <>
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <Badge variant="secondary" className="text-xs">
                  <Navigation className="h-3 w-3 mr-1" />
                  {routeJobs.length} stopp
                </Badge>
                <Badge variant="outline" className="text-xs">
                  <Clock className="h-3 w-3 mr-1" />
                  {Math.round(totalTravelTime)} min körtid
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {(totalWorkTime / 60).toFixed(1)}h arbete
                </Badge>
              </div>
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOptimizeRoute}
                  disabled={isOptimizing || routeJobs.length < 2}
                  data-testid="button-optimize-route"
                >
                  {isOptimizing ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4 mr-1" />
                  )}
                  Optimera
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenGoogleMaps}
                  data-testid="button-google-maps"
                >
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Google Maps
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePrintRoute}
                  data-testid="button-print-route"
                >
                  <FileText className="h-4 w-4 mr-1" />
                  Skriv ut
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleSendToMobile}
                  disabled={isSendingToMobile}
                  data-testid="button-send-to-mobile"
                >
                  {isSendingToMobile ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-1" />
                  )}
                  Skicka till mobil
                </Button>
              </div>
            </>
          )}
        </div>
        
        <div className="flex-1 bg-muted/20 p-8">
          {!selectedResource ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3 text-muted-foreground">
                <MapPin className="h-16 w-16 mx-auto opacity-30" />
                <p className="text-lg font-medium">Välj en resurs för att visa dagens rutt</p>
                <p className="text-sm">Välj en resurs i dropdown-menyn ovan för att se schemalagda jobb på kartan</p>
              </div>
            </div>
          ) : routeJobs.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-4 text-muted-foreground">
                <AlertTriangle className="h-16 w-16 mx-auto opacity-30" />
                <p className="text-lg font-medium">Inga schemalagda jobb med koordinater för {selectedResource.name} denna dag</p>
                <p className="text-sm">Navigera till ett datum med schemalagda jobb eller schemalägg nya jobb först</p>
                {firstJobDate && (
                  <Button 
                    variant="default" 
                    onClick={handleJumpToDate}
                    data-testid="button-jump-to-jobs"
                  >
                    <Calendar className="h-4 w-4 mr-2" />
                    Gå till {format(new Date(firstJobDate + "T12:00:00Z"), "d MMMM yyyy", { locale: sv })}
                  </Button>
                )}
              </div>
            </div>
          ) : (
          <div className="flex-1 flex">
            <div className="flex-1 relative">
              <MapContainer
                key={`route-map-${routeViewResourceId}-${format(currentDate, "yyyy-MM-dd")}`}
                center={defaultCenter}
                zoom={12}
                className="h-full w-full"
                scrollWheelZoom={true}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapFitBounds positions={positions} />
                
                {positions.length > 1 && (
                  <Polyline
                    positions={positions}
                    color="#3b82f6"
                    weight={3}
                    opacity={0.7}
                    dashArray="8,8"
                  />
                )}
                
                {routeJobs.map((job, index) => (
                  <Marker
                    key={job.id}
                    position={[job.taskLatitude!, job.taskLongitude!]}
                    icon={createNumberedIcon(index + 1, index === 0, index === routeJobs.length - 1)}
                  >
                    <Popup>
                      <div className="text-sm space-y-1 min-w-[180px]">
                        <div className="font-medium">{index + 1}. {job.title}</div>
                        <div className="text-muted-foreground">{job.objectName}</div>
                        {job.scheduledStartTime && (
                          <div className="text-xs">
                            Starttid: {job.scheduledStartTime}
                          </div>
                        )}
                        <div className="text-xs">
                          Uppskattat: {((job.estimatedDuration || 0) / 60).toFixed(1)}h
                        </div>
                        {segments[index] && (
                          <div className="text-xs text-blue-600 pt-1 border-t">
                            Nästa stopp: ~{segments[index].time} min
                          </div>
                        )}
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
            
            <div className="w-[280px] border-l bg-muted/20 flex flex-col">
              <div className="p-3 border-b">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Navigation className="h-4 w-4" />
                    Körordning
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    <GripVertical className="h-3 w-3 mr-1" />
                    Dra för att ändra
                  </Badge>
                </div>
              </div>
              <ScrollArea className="flex-1">
                <SortableContext items={routeJobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
                  <div className="p-2 space-y-1">
                    {routeJobs.map((job, index) => (
                      <SortableRouteItem
                        key={job.id}
                        job={job}
                        index={index}
                        totalCount={routeJobs.length}
                        customer={customerMap.get(job.customerId)}
                        travelToNext={segments[index]?.time}
                        isSelected={selectedJob === job.id}
                        onSelect={handleJobClick}
                      />
                    ))}
                  </div>
                </SortableContext>
              </ScrollArea>
            </div>
          </div>
        )}
        </div>
      </div>
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDndDragStart}
      onDragEnd={handleDndDragEnd}
    >
    <div className="flex h-full">
      <Collapsible open={showUnscheduled} onOpenChange={setShowUnscheduled} className="flex">
        <CollapsibleContent className="w-[280px] border-r bg-muted/20 flex flex-col">
          <div className="p-3 border-b space-y-3">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Oschemalagda</span>
              <Badge variant="secondary" className="text-xs">{unscheduledJobs.length}</Badge>
            </div>
            <div className="space-y-2">
              <Select value={filterCustomer} onValueChange={setFilterCustomer}>
                <SelectTrigger className="w-full h-8 text-xs" data-testid="select-unscheduled-customer">
                  <SelectValue placeholder="Alla kunder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla kunder</SelectItem>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger className="w-full h-8 text-xs" data-testid="select-unscheduled-priority">
                  <SelectValue placeholder="Alla prioriteter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla prioriteter</SelectItem>
                  <SelectItem value="urgent">Akut</SelectItem>
                  <SelectItem value="high">Hög</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Låg</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterCluster} onValueChange={setFilterCluster}>
                <SelectTrigger className="w-full h-8 text-xs" data-testid="select-unscheduled-cluster">
                  <SelectValue placeholder="Alla områden" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla områden</SelectItem>
                  <SelectItem value="none">Utan område</SelectItem>
                  {clusters.map((cluster) => (
                    <SelectItem key={cluster.id} value={cluster.id}>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cluster.color || "#3B82F6" }} />
                        {cluster.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {teamsData.length > 0 && (
                <Select value={filterTeam} onValueChange={setFilterTeam}>
                  <SelectTrigger className="w-full h-8 text-xs" data-testid="select-unscheduled-team">
                    <SelectValue placeholder="Alla team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alla team</SelectItem>
                    {teamsData.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: team.color || "#3B82F6" }} />
                          {team.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <ScrollArea className="flex-1 p-2">
            <div className="space-y-2">
              {unscheduledJobs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  Inga oschemalagda jobb
                </div>
              ) : (
                unscheduledJobs.map((job) => {
                  const customer = customerMap.get(job.customerId);
                  const jobCluster = job.clusterId ? clusterMap.get(job.clusterId) : null;
                  return (
                    <DraggableJobCard key={job.id} id={job.id}>
                      <Card
                        className={`p-3 cursor-grab active:cursor-grabbing hover-elevate active-elevate-2 touch-none ${selectedJob === job.id ? "ring-2 ring-primary" : ""}`}
                        onClick={() => handleJobClick(job.id)}
                        data-testid={`unscheduled-job-${job.id}`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDotColors[job.priority]}`} />
                            <span className="text-sm font-medium">{job.title}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">{job.objectName || "Okänt objekt"}</div>
                          {customer && (
                            <div className="text-xs text-muted-foreground">{customer.name}</div>
                          )}
                          {jobCluster && (
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground" data-testid={`unscheduled-job-cluster-${job.id}`}>
                              <MapPin className="h-2.5 w-2.5" />
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: jobCluster.color || "#3B82F6" }} />
                              {jobCluster.name}
                            </div>
                          )}
                          {/* Åtkomstinformation på oschemalagda jobb */}
                          {(job.objectAccessCode || job.objectKeyNumber) && (
                            <div className="flex items-center gap-2 mt-1">
                              {job.objectAccessCode && (
                                <span className="flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                                  <DoorOpen className="h-2.5 w-2.5" />
                                  {job.objectAccessCode}
                                </span>
                              )}
                              {job.objectKeyNumber && (
                                <span className="flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                                  <Key className="h-2.5 w-2.5" />
                                  {job.objectKeyNumber}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-2 pt-1">
                            <Badge variant="outline" className="text-[10px]">
                              {priorityLabels[job.priority] || job.priority}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              {((job.estimatedDuration || 0) / 60).toFixed(1).replace(".", ",")} h
                            </Badge>
                          </div>
                          <Button
                            size="sm"
                            variant="default"
                            className="w-full mt-2"
                            onClick={(e) => handleOpenAssignDialog(job, e)}
                            data-testid={`button-assign-job-${job.id}`}
                          >
                            <UserPlus className="h-3 w-3 mr-1" />
                            Tilldela resurs
                          </Button>
                        </div>
                      </Card>
                    </DraggableJobCard>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </CollapsibleContent>
        <Tooltip>
          <TooltipTrigger asChild>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-full rounded-none border-r w-6" data-testid="button-toggle-unscheduled">
                {showUnscheduled ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{showUnscheduled ? "Dölj oplanerade" : "Visa oplanerade"}</p>
          </TooltipContent>
        </Tooltip>
      </Collapsible>

      <div className="flex flex-col flex-1">
        <div className="flex items-center justify-between gap-4 p-4 border-b overflow-x-auto">
          <div className="flex items-center gap-2 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={() => navigate("prev")} data-testid="button-prev">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Föregående</p></TooltipContent>
            </Tooltip>
            <Button variant="outline" size="sm" onClick={goToToday} data-testid="button-today">
              Idag
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={() => navigate("next")} data-testid="button-next">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Nästa</p></TooltipContent>
            </Tooltip>
            <span className="text-sm font-medium ml-2 capitalize whitespace-nowrap" data-testid="text-date-label">
              {getHeaderLabel()}
            </span>
            <div className="flex items-center gap-1 ml-2 border-l pl-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={handleUndo} 
                    disabled={undoStack.length === 0}
                    data-testid="button-undo"
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Ångra (Ctrl+Z)</p></TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={handleRedo} 
                    disabled={redoStack.length === 0}
                    data-testid="button-redo"
                  >
                    <Redo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Gör om (Ctrl+Y)</p></TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && handleViewModeChange(v as ViewMode)} data-testid="toggle-view-mode">
              <ToggleGroupItem value="day" aria-label="Dagvy" data-testid="toggle-day">
                <CalendarDays className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Dag</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="week" aria-label="Veckovy" data-testid="toggle-week">
                <CalendarRange className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Vecka</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="month" aria-label="Månadsvy" data-testid="toggle-month">
                <Calendar className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Månad</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="route" aria-label="Ruttvy" data-testid="toggle-route">
                <MapPin className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Rutt</span>
              </ToggleGroupItem>
            </ToggleGroup>
            <Button onClick={() => { onAddJob?.(); }} data-testid="button-add-job">
              <Plus className="h-4 w-4 mr-2" />
              Nytt jobb
            </Button>
            {onToggleAIPanel && (
              <Button 
                variant={showAIPanel ? "default" : "ghost"} 
                onClick={onToggleAIPanel}
                data-testid="button-toggle-ai-panel"
              >
                <Sparkles className="h-4 w-4 mr-2 text-purple-500" />
                AI stöd
              </Button>
            )}
          </div>
        </div>

        {/* Kapacitetsöversikt */}
        {viewMode === "week" && (
          <div className="px-4 py-2 border-b bg-muted/20">
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <div className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">Kapacitet:</span>
              </div>
              {resources.slice(0, 6).map((resource) => {
                const weekHours = visibleDates.reduce((sum, day) => sum + getResourceDayHours(resource.id, day), 0);
                const weekCapacity = (resource.weeklyHours || 40);
                const utilization = Math.round((weekHours / weekCapacity) * 100);
                const isOverbooked = utilization > 100;
                const isLow = utilization < 50;
                return (
                  <div key={resource.id} className="flex items-center gap-1.5 px-2 py-1 rounded bg-background border">
                    <span className="font-medium">{resource.initials || resource.name.split(" ")[0]}</span>
                    <div className="w-12 h-1.5 bg-muted rounded overflow-hidden">
                      <div 
                        className={`h-full transition-all ${isOverbooked ? "bg-red-500" : isLow ? "bg-yellow-500" : "bg-green-500"}`}
                        style={{ width: `${Math.min(utilization, 100)}%` }}
                      />
                    </div>
                    <span className={`${isOverbooked ? "text-red-600" : isLow ? "text-yellow-600" : "text-green-600"}`}>
                      {utilization}%
                    </span>
                  </div>
                );
              })}
              {resources.length > 6 && (
                <span className="text-muted-foreground">+{resources.length - 6} till</span>
              )}
            </div>
          </div>
        )}

        {viewMode === "day" && renderDayTimelineView()}
        {viewMode === "week" && renderWeekView()}
        {viewMode === "month" && renderMonthView()}
        {viewMode === "route" && renderRouteMapView()}

        <div className="p-3 border-t bg-muted/50 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 text-xs" data-testid="legend-block-categories">
            <span className="text-muted-foreground font-medium mr-1">Kategorier:</span>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-1.5 bg-green-500 rounded-sm"></span>
              <span>Produktion</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-1.5 bg-yellow-400 rounded-sm"></span>
              <span>Restid</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-1.5 bg-blue-400 rounded-sm"></span>
              <span>Egentid</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-sm"></span>
              <span>Ledig</span>
            </div>
            <span className="text-muted-foreground mx-1">|</span>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-red-500 rounded-full"></span>
              <span>Akut</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-orange-500 rounded-full"></span>
              <span>Hög</span>
            </div>
            {Object.keys(jobConflicts).length > 0 && (
              <>
                <span className="text-muted-foreground mx-1">|</span>
                <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  <span>{Object.keys(jobConflicts).length} konflikter</span>
                </div>
              </>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {filteredScheduledJobs.length} schemalagda | {unscheduledJobs.length} oschemalagda | Dra jobb för att schemalägga
          </div>
        </div>
      </div>

      {/* Resource Detail Panel */}
      <Sheet open={!!activeResourceId} onOpenChange={(open) => !open && setActiveResourceId(null)}>
        <SheetContent className="w-[400px] sm:w-[450px] p-0 flex flex-col">
          {activeResource && (
            <>
              <SheetHeader className="p-4 border-b">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="text-lg">
                      {activeResource.initials || activeResource.name.split(" ").map(n => n[0]).join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <SheetTitle className="text-left">{activeResource.name}</SheetTitle>
                    <p className="text-sm text-muted-foreground">
                      {activeResource.resourceType || "Fälttekniker"} • {activeResource.weeklyHours || 40}h/vecka
                    </p>
                  </div>
                </div>
              </SheetHeader>

              <div className="p-4 border-b bg-muted/30">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <User className="h-4 w-4" />
                  <span>Veckoschema - Dra jobb hit för att schemalägga</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-background rounded-md p-2 text-center">
                    <div className="font-medium">{activeResourceJobs.length}</div>
                    <div className="text-muted-foreground">jobb</div>
                  </div>
                  <div className="bg-background rounded-md p-2 text-center">
                    <div className="font-medium">
                      {(activeResourceJobs.reduce((sum, j) => sum + (j.estimatedDuration || 0), 0) / 60).toFixed(1).replace(".", ",")} h
                    </div>
                    <div className="text-muted-foreground">planerat</div>
                  </div>
                  <div className="bg-background rounded-md p-2 text-center">
                    <div className="font-medium">{Object.keys(activeResourceJobsByDay).length}</div>
                    <div className="text-muted-foreground">dagar</div>
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                  {visibleDates.map((day) => {
                    const dayKey = format(day, "yyyy-MM-dd");
                    const dayJobs = activeResourceJobsByDay[dayKey] || [];
                    const dayHours = dayJobs.reduce((sum, j) => sum + (j.estimatedDuration || 0) / 60, 0);
                    const isToday = isSameDay(day, new Date());
                    const panelDroppableId = `${activeResourceId}|${dayKey}`;

                    return (
                      <div key={dayKey} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className={`text-sm font-medium ${isToday ? "text-primary" : ""}`}>
                            {format(day, "EEEE d MMM", { locale: sv })}
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {dayHours.toFixed(1)}h
                          </Badge>
                        </div>
                        <DroppableCell
                          id={panelDroppableId}
                          className="min-h-[80px] border border-dashed rounded-md p-2 transition-colors"
                        >
                          <div data-testid={`panel-drop-zone-${dayKey}`}>
                            {dayJobs.length === 0 ? (
                              <div className="text-xs text-muted-foreground text-center py-4">
                                Dra jobb hit för att schemalägga
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {dayJobs.map((job) => renderJobCard(job))}
                              </div>
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
    <DragOverlay dropAnimation={{
      duration: 200,
      easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
    }}>
      {renderDragOverlay()}
    </DragOverlay>
    
    {/* Quick Assign Dialog */}
    <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tilldela resurs</DialogTitle>
          <DialogDescription>
            Välj resurs och datum för: {jobToAssign?.title}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Datum</Label>
            <Input
              type="date"
              value={assignDate}
              onChange={(e) => setAssignDate(e.target.value)}
              data-testid="input-assign-date"
            />
          </div>
          <div className="space-y-2">
            <Label>Resurs</Label>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {resources.map((resource) => (
                <div
                  key={resource.id}
                  className={`p-3 rounded-md border cursor-pointer hover-elevate ${
                    assignResourceId === resource.id ? "ring-2 ring-primary" : ""
                  }`}
                  onClick={() => setAssignResourceId(resource.id)}
                  data-testid={`assign-resource-${resource.id}`}
                >
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{resource.name}</span>
                    <Badge variant="secondary" className="text-xs ml-auto">
                      {resource.resourceType}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
            Avbryt
          </Button>
          <Button 
            onClick={handleQuickAssign}
            disabled={!assignResourceId || updateWorkOrderMutation.isPending}
            data-testid="button-confirm-assign"
          >
            {updateWorkOrderMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Tilldela
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    
    {/* Send Schedule Dialog */}
    <Dialog open={sendScheduleDialogOpen} onOpenChange={setSendScheduleDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Skicka schema</DialogTitle>
          <DialogDescription>
            Skicka schemat till {sendScheduleResource?.name} för aktuell period
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {sendScheduleResource && (
            <>
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>{sendScheduleResource.initials || sendScheduleResource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{sendScheduleResource.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {sendScheduleResource.email || "Ingen e-post"}
                    </div>
                  </div>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Antal jobb i period: </span>
                  <span className="font-medium">{getResourceScheduleJobs(sendScheduleResource.id).length}</span>
                </div>
              </div>
              
              <div className="space-y-3">
                <Button 
                  className="w-full justify-start gap-3" 
                  variant="outline"
                  onClick={handleSendScheduleEmail}
                  disabled={!sendScheduleResource.email || sendScheduleMutation.isPending}
                  data-testid="button-send-schedule-email"
                >
                  {sendScheduleMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  <div className="text-left flex-1">
                    <div>Skicka via e-post</div>
                    <div className="text-xs text-muted-foreground">
                      {sendScheduleResource.email || "Ingen e-post registrerad"}
                    </div>
                  </div>
                </Button>
                
                <Button 
                  className="w-full justify-start gap-3" 
                  variant="outline"
                  onClick={handleCopyFieldAppLink}
                  data-testid="button-copy-field-link"
                >
                  {sendScheduleCopied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  <div className="text-left flex-1">
                    <div>Kopiera länk till fältappen</div>
                    <div className="text-xs text-muted-foreground">
                      Klistra in i SMS eller meddelande
                    </div>
                  </div>
                </Button>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSendScheduleDialogOpen(false)}>
            Stäng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Conflict Confirmation Dialog */}
    <Dialog open={conflictDialogOpen} onOpenChange={(open) => { if (!open) { setConflictDialogOpen(false); setPendingSchedule(null); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-5 w-5" />
            Konflikt upptäckt
          </DialogTitle>
          <DialogDescription>
            Följande konflikter identifierades vid schemaläggning. Du kan välja att schemalägga ändå.
          </DialogDescription>
        </DialogHeader>
        {pendingSchedule && (
          <div className="space-y-3 py-2">
            <div className="p-3 bg-muted rounded-lg text-sm">
              <div className="font-medium">{workOrders.find(j => j.id === pendingSchedule.jobId)?.title}</div>
              <div className="text-muted-foreground text-xs mt-1">
                Planerad: {pendingSchedule.scheduledDate}
                {pendingSchedule.scheduledStartTime && ` kl ${pendingSchedule.scheduledStartTime}`}
              </div>
            </div>
            <div className="space-y-2">
              {pendingSchedule.conflicts.map((conflict, i) => (
                <div key={i} className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-950/30 rounded border border-red-200 dark:border-red-800">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <span className="text-sm">{conflict}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { setConflictDialogOpen(false); setPendingSchedule(null); }} data-testid="button-cancel-conflict">
            Avbryt
          </Button>
          <Button
            variant="destructive"
            onClick={handleAcceptConflict}
            data-testid="button-accept-conflict"
          >
            <AlertTriangle className="h-4 w-4 mr-2" />
            Schemalägg ändå
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </DndContext>
  );
}
