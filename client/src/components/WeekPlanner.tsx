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
import { ChevronLeft, ChevronRight, Plus, AlertTriangle, Loader2, CalendarDays, Calendar, CalendarRange, Clock, Inbox, ChevronDown, ChevronUp, X, User, Sparkles, Undo2, Redo2, Link2, ArrowRight, MapPin, Navigation, GripVertical, Wand2, ExternalLink, FileText, Send, UserPlus, Key, DoorOpen, TrendingUp, Activity, Mail, Copy, Check, UsersRound, Filter, XCircle, ZoomIn, ZoomOut, Trash2 } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, addDays, startOfWeek, startOfMonth, isSameDay, getDaysInMonth, addMonths } from "date-fns";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrderWithObject, Customer, TaskDependency, Cluster, ObjectTimeRestriction } from "@shared/schema";
import { EXECUTION_CODE_LABELS, EXECUTION_CODE_ICONS, RESTRICTION_TYPE_LABELS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { WorkOrderMetadataPanel } from "./WorkOrderMetadataPanel";

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

function SubStepsExpander({ jobId, isExpanded, onToggle }: { jobId: string; isExpanded: boolean; onToggle: () => void }) {
  const { data: subStepsData } = useQuery<{
    subSteps: Array<{ id: string; title: string; status: string; executionStatus: string; estimatedDuration: number }>;
    structuralInfo: { totalSteps: number; steps: Array<{ stepName: string; sequenceOrder: number; isOptional: boolean }> } | null;
    progress: { completed: number; total: number };
  }>({
    queryKey: ["/api/work-orders", jobId, "sub-steps"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/work-orders/${jobId}/sub-steps`);
      return res.json();
    },
    enabled: isExpanded,
    staleTime: 60000,
  });

  const hasStructure = subStepsData && (subStepsData.subSteps.length > 0 || (subStepsData.structuralInfo && subStepsData.structuralInfo.totalSteps > 0));

  if (!hasStructure && !isExpanded) return null;

  return (
    <div className="mt-1">
      <button
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        data-testid={`substeps-toggle-${jobId}`}
      >
        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        <span>Delsteg</span>
        {subStepsData?.progress && subStepsData.progress.total > 0 && (
          <span className="text-[9px] bg-muted px-1 rounded">
            {subStepsData.progress.completed}/{subStepsData.progress.total}
          </span>
        )}
      </button>
      {isExpanded && subStepsData && (
        <div className="mt-1 space-y-0.5 pl-2 border-l-2 border-muted" data-testid={`substeps-list-${jobId}`}>
          {subStepsData.subSteps.length > 0 ? (
            subStepsData.subSteps.map((step) => {
              const isDone = step.executionStatus === "completed" || step.executionStatus === "inspected" || step.executionStatus === "invoiced";
              return (
                <div key={step.id} className="flex items-center gap-1.5 text-[10px]" data-testid={`substep-${step.id}`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isDone ? "bg-green-500" : "bg-gray-300"}`} />
                  <span className={isDone ? "line-through text-muted-foreground" : ""}>{step.title}</span>
                  <span className="text-muted-foreground ml-auto">{step.estimatedDuration}m</span>
                </div>
              );
            })
          ) : subStepsData.structuralInfo ? (
            subStepsData.structuralInfo.steps.map((step, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]" data-testid={`substep-template-${i}`}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-gray-300" />
                <span>{step.stepName || `Steg ${step.sequenceOrder}`}</span>
                {step.isOptional && <Badge className="text-[8px] h-3 px-1" variant="outline">Valfri</Badge>}
              </div>
            ))
          ) : (
            <span className="text-[10px] text-muted-foreground">Inga delsteg</span>
          )}
        </div>
      )}
    </div>
  );
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

function DroppableCell({ id, children, className = "", dropFitInfo, style }: { id: string; children: JSX.Element; className?: string; dropFitInfo?: { bg: string; label: string; color: string } | null; style?: React.CSSProperties }) {
  const { isOver, setNodeRef } = useDroppable({ id });

  const dropClass = isOver && dropFitInfo
    ? `ring-2 ring-inset ${dropFitInfo.bg} ${dropFitInfo.bg.includes("ring-") ? "" : "ring-primary"}`
    : isOver
    ? "ring-2 ring-primary ring-inset bg-primary/10"
    : "";

  return (
    <div
      ref={setNodeRef}
      className={`${className} ${dropClass}`}
      style={style}
    >
      {isOver && dropFitInfo && (
        <div className={`text-[9px] font-medium mb-1 ${dropFitInfo.color} flex items-center gap-1`} data-testid="drop-fit-indicator">
          <span className={`w-1.5 h-1.5 rounded-full ${dropFitInfo.bg.split(" ")[0].replace("bg-", "bg-").replace("/40", "").replace("/20", "").replace("100", "500").replace("50", "500")}`} />
          {dropFitInfo.label}
        </div>
      )}
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
              {(job as any).metadata?.teamName && (
                <Badge variant="outline" className="text-[10px] gap-0.5">
                  <UsersRound className="h-2.5 w-2.5" />
                  {(job as any).metadata.teamName}
                </Badge>
              )}
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
  const [filterTeam, setFilterTeam] = useState<string>("all");
  const [filterExecutionCode, setFilterExecutionCode] = useState<string>("all");
  const [orderstockSearch, setOrderstockSearch] = useState("");
  const [sidebarFiltersOpen, setSidebarFiltersOpen] = useState(false);

  const { data: teamsData = [] } = useQuery<Array<{ id: string; name: string; clusterId: string | null; color: string | null }>>({
    queryKey: ["/api/teams"],
  });

  const { data: teamMembersData = [] } = useQuery<Array<{ teamId: string; resourceId: string }>>({
    queryKey: ["/api/team-members"],
  });

  const teamResourceIds = useMemo(() => {
    if (filterTeam === "all") return null;
    const ids = new Set<string>();
    teamMembersData.forEach(tm => {
      if (tm.teamId === filterTeam) ids.add(tm.resourceId);
    });
    return ids;
  }, [filterTeam, teamMembersData]);
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
  const zoomLevels = [
    { label: "Kompakt", dayH: 28, weekH: 36, monthH: 40, scale: 0.5 },
    { label: "Normal", dayH: 60, weekH: 120, monthH: 100, scale: 1 },
    { label: "XL", dayH: 140, weekH: 320, monthH: 240, scale: 2 },
  ];
  const zoom = zoomLevels[zoomLevel];
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

  const { data: scheduledWorkOrders = [], isLoading: scheduledLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders", "scheduled", dateRange.startDate, dateRange.endDate],
    queryFn: async () => {
      const url = `/api/work-orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch scheduled work orders");
      return res.json();
    },
    staleTime: 60000,
  });

  const { data: unscheduledWorkOrders = [], isLoading: unscheduledLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders", "unscheduled"],
    queryFn: async () => {
      const url = `/api/work-orders?status=unscheduled&limit=500`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch unscheduled work orders");
      return res.json();
    },
    staleTime: 120000,
  });

  const workOrders = useMemo(() => {
    const ids = new Set(scheduledWorkOrders.map(wo => wo.id));
    const uniqueUnscheduled = unscheduledWorkOrders.filter(wo => !ids.has(wo.id));
    return [...scheduledWorkOrders, ...uniqueUnscheduled];
  }, [scheduledWorkOrders, unscheduledWorkOrders]);

  const workOrdersLoading = scheduledLoading || unscheduledLoading;

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

  const { data: depChainData } = useQuery<{ chain: Array<{ type: string; dependencyType: string; workOrder: { id: string; title: string; status: string; executionStatus: string; scheduledDate: string | null; scheduledStartTime: string | null; creationMethod: string | null } }> }>({
    queryKey: ["/api/work-orders", depChainJobId, "dependency-chain"],
    queryFn: async () => {
      if (!depChainJobId) return { chain: [] };
      const res = await apiRequest("GET", `/api/work-orders/${depChainJobId}/dependency-chain`);
      return res.json();
    },
    enabled: !!depChainJobId && depChainDialogOpen,
  });

  const scheduledObjectIds = useMemo(() => {
    const ids = Array.from(new Set(workOrders.map(wo => wo.objectId).filter(Boolean) as string[]));
    return ids;
  }, [workOrders]);

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

  const [expandedSubSteps, setExpandedSubSteps] = useState<Record<string, boolean>>({});

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
    
    const searchLower = orderstockSearch.toLowerCase().trim();
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
      if (filterExecutionCode !== "all") {
        if ((job as any).executionCode !== filterExecutionCode) return false;
      }
      if (searchLower) {
        const title = (job.title || "").toLowerCase();
        const objName = (job.objectName || "").toLowerCase();
        const custName = (job.customerId ? (customerMap.get(job.customerId)?.name || "") : "").toLowerCase();
        if (!title.includes(searchLower) && !objName.includes(searchLower) && !custName.includes(searchLower)) return false;
      }
      return true;
    });
    
    return filtered.sort((a, b) => {
      const aPriority = priorityOrder[a.priority] ?? 99;
      const bPriority = priorityOrder[b.priority] ?? 99;
      if (aPriority !== bPriority) return aPriority - bPriority;
      const aEnd = a.plannedWindowEnd ? new Date(a.plannedWindowEnd).getTime() : Infinity;
      const bEnd = b.plannedWindowEnd ? new Date(b.plannedWindowEnd).getTime() : Infinity;
      return aEnd - bEnd;
    });
  }, [workOrders, filterCustomer, filterPriority, filterCluster, filterTeam, teamResourceIds, filterExecutionCode, orderstockSearch, customerMap]);
  
  const sidebarActiveFilterCount = [
    filterCustomer !== "all" ? 1 : 0,
    filterPriority !== "all" ? 1 : 0,
    filterCluster !== "all" ? 1 : 0,
    filterTeam !== "all" ? 1 : 0,
    filterExecutionCode !== "all" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const clearAllSidebarFilters = () => {
    setFilterCustomer("all");
    setFilterPriority("all");
    setFilterCluster("all");
    setFilterTeam("all");
    setFilterExecutionCode("all");
    setOrderstockSearch("");
  };

  const sidebarQuickStats = useMemo(() => {
    const allUnscheduled = workOrders.filter(job => !job.scheduledDate || !job.resourceId);
    const urgentCount = allUnscheduled.filter(j => j.priority === "urgent").length;
    const highCount = allUnscheduled.filter(j => j.priority === "high").length;
    const overdueCount = allUnscheduled.filter(j => j.plannedWindowEnd && new Date(j.plannedWindowEnd) < new Date()).length;
    const totalHours = allUnscheduled.reduce((sum, j) => sum + (j.estimatedDuration || 0) / 60, 0);
    return { urgentCount, highCount, overdueCount, totalHours: Math.round(totalHours * 10) / 10 };
  }, [workOrders]);

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

  const currentViewScheduledJobs = useMemo(() => {
    let rangeStart: Date;
    let rangeEnd: Date;
    if (viewMode === "month") {
      rangeStart = startOfMonth(currentDate);
      rangeEnd = addDays(rangeStart, getDaysInMonth(currentDate));
    } else if (viewMode === "day") {
      rangeStart = new Date(currentDate);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd = addDays(rangeStart, 1);
    } else {
      rangeStart = currentWeekStart;
      rangeEnd = addDays(currentWeekStart, 5);
    }
    return filteredScheduledJobs.filter(job => {
      if (!job.scheduledDate) return false;
      const jobDate = new Date(job.scheduledDate);
      return jobDate >= rangeStart && jobDate < rangeEnd;
    });
  }, [filteredScheduledJobs, viewMode, currentWeekStart, currentDate]);

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

  const weekGoals = useMemo(() => {
    const weekStart = viewMode === "week" ? currentWeekStart : startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekDates = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
    const weekDateKeys = new Set(weekDates.map(d => format(d, "yyyy-MM-dd")));

    const weekJobs = scheduledJobs.filter(j => {
      if (!j.scheduledDate) return false;
      const d = j.scheduledDate;
      const dateKey = d instanceof Date ? format(d, "yyyy-MM-dd") : String(d).split("T")[0];
      return weekDateKeys.has(dateKey);
    });

    const totalMinutes = weekJobs.reduce((sum, j) => sum + (j.estimatedDuration || 60), 0);
    const totalHours = totalMinutes / 60;
    const totalCost = weekJobs.reduce((sum, j) => sum + ((j as any).cachedCost || 0), 0);
    const totalStops = weekJobs.length;

    const totalWeeklyHours = resources.reduce((sum, r) => sum + (r.weeklyHours || 40), 0);
    const totalWeeklyBudget = totalWeeklyHours * 450;
    const targetStops = resources.length * 6 * 5;

    const timePct = totalWeeklyHours > 0 ? Math.round((totalHours / totalWeeklyHours) * 100) : 0;
    const econPct = totalWeeklyBudget > 0 ? Math.round((totalCost / totalWeeklyBudget) * 100) : 0;
    const countPct = targetStops > 0 ? Math.round((totalStops / targetStops) * 100) : 0;

    return {
      time: { current: totalHours, target: totalWeeklyHours, pct: timePct },
      economy: { current: totalCost, target: totalWeeklyBudget, pct: econPct },
      count: { current: totalStops, target: targetStops, pct: countPct },
    };
  }, [scheduledJobs, resources, viewMode, currentWeekStart, currentDate]);

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

  const weekTravelTotal = useMemo(() => {
    const weekStart = viewMode === "week" ? currentWeekStart : startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekDates = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
    let totalMin = 0;
    let totalKm = 0;
    const hav = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    for (const resource of resources) {
      for (const day of weekDates) {
        const dayJobs = getJobsForResourceAndDay(resource.id, day)
          .filter(j => j.scheduledStartTime && j.taskLatitude && j.taskLongitude)
          .sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
        for (let i = 0; i < dayJobs.length - 1; i++) {
          const from = dayJobs[i];
          const to = dayJobs[i + 1];
          if (from.taskLatitude && from.taskLongitude && to.taskLatitude && to.taskLongitude) {
            const d = hav(from.taskLatitude, from.taskLongitude, to.taskLatitude, to.taskLongitude);
            totalKm += d;
            totalMin += Math.max(Math.round(d / 50 * 60), 5);
          }
        }
      }
    }
    return { minutes: totalMin, km: Math.round(totalKm * 10) / 10, hours: Math.round(totalMin / 60 * 10) / 10 };
  }, [resources, viewMode, currentWeekStart, currentDate, getJobsForResourceAndDay]);

  const travelTimesForDay = useMemo(() => {
    const result: Record<string, Array<{ fromJobId: string; toJobId: string; minutes: number; distanceKm: number; startTime: string; endTime: string }>> = {};
    
    const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    for (const resource of resources) {
      const dayJobs = getJobsForResourceAndDay(resource.id, currentDate)
        .filter(j => j.scheduledStartTime && j.taskLatitude && j.taskLongitude)
        .sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
      
      const travels: typeof result[string] = [];
      for (let i = 0; i < dayJobs.length - 1; i++) {
        const from = dayJobs[i];
        const to = dayJobs[i + 1];
        if (!from.taskLatitude || !from.taskLongitude || !to.taskLatitude || !to.taskLongitude) continue;

        const dist = haversineDistance(from.taskLatitude, from.taskLongitude, to.taskLatitude, to.taskLongitude);
        const travelMinutes = Math.max(Math.round(dist / 50 * 60), 5);
        
        const fromDur = from.estimatedDuration || 60;
        const [fH, fM] = (from.scheduledStartTime || "08:00").split(":").map(Number);
        const fromEnd = fH * 60 + fM + fromDur;
        const travelEnd = fromEnd + travelMinutes;
        
        travels.push({
          fromJobId: from.id,
          toJobId: to.id,
          minutes: travelMinutes,
          distanceKm: Math.round(dist * 10) / 10,
          startTime: `${Math.floor(fromEnd / 60).toString().padStart(2, "0")}:${(fromEnd % 60).toString().padStart(2, "0")}`,
          endTime: `${Math.floor(travelEnd / 60).toString().padStart(2, "0")}:${(travelEnd % 60).toString().padStart(2, "0")}`,
        });
      }
      if (travels.length > 0) result[resource.id] = travels;
    }
    return result;
  }, [resources, currentDate, getJobsForResourceAndDay]);

  const getCapacityPercentage = useCallback((hours: number) => {
    return Math.min((hours / HOURS_IN_DAY) * 100, 100);
  }, []);

  const getCapacityColor = useCallback((pct: number) => {
    if (pct >= 100) return "bg-red-500";
    if (pct >= 85) return "bg-orange-500";
    if (pct >= 65) return "bg-yellow-500";
    return "bg-green-500";
  }, []);

  const getCapacityBgColor = useCallback((pct: number) => {
    if (pct >= 100) return "bg-red-50 dark:bg-red-950/20";
    if (pct >= 85) return "bg-orange-50 dark:bg-orange-950/20";
    if (pct >= 65) return "bg-yellow-50 dark:bg-yellow-950/20";
    return "";
  }, []);

  const getDropFitClass = useCallback((resourceId: string, dayStr: string, jobDurationMinutes: number) => {
    const currentHours = resourceDayJobMap.hours[resourceId]?.[dayStr] || 0;
    const newHours = currentHours + jobDurationMinutes / 60;
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
      for (const day of weekDates) {
        const dayKey = format(day, "yyyy-MM-dd");
        totalHours += resourceDayJobMap.hours[resource.id]?.[dayKey] || 0;
      }
      const weeklyCapacity = resource.weeklyHours || 40;
      summary[resource.id] = {
        totalHours,
        weeklyCapacity,
        pct: weeklyCapacity > 0 ? Math.round((totalHours / weeklyCapacity) * 100) : 0,
      };
    }
    return summary;
  }, [resources, visibleDates, viewMode, resourceDayJobMap]);

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

  const resourceTeamMap = useMemo(() => {
    const map = new Map<string, string[]>();
    teamMembersData.forEach(tm => {
      const existing = map.get(tm.resourceId) || [];
      existing.push(tm.teamId);
      map.set(tm.resourceId, existing);
    });
    return map;
  }, [teamMembersData]);

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

  const detectConflictsForJob = useCallback((job: WorkOrderWithObject, resourceId: string, dateStr: string, startTime?: string | null): string[] => {
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

    if (job.objectId) {
      const objRestrictions = restrictionsByObject.get(job.objectId) || [];
      const dayIndex = dateObj.getUTCDay() || 7;
      for (const r of objRestrictions) {
        if (!r.isActive || !r.weekdays || r.weekdays.length === 0) continue;
        if (r.weekdays.includes(dayIndex)) {
          const label = RESTRICTION_TYPE_LABELS[r.restrictionType] || r.restrictionType;
          if (r.isBlockingAllDay) {
            reasons.push(`${label} — hela dagen blockerad`);
          } else if (r.startTime && r.endTime) {
            reasons.push(`${label} (${r.startTime}–${r.endTime})`);
          } else {
            reasons.push(`${label} — begränsning aktiv`);
          }
        }
      }
    }

    const advanceDays = (job as any).advanceNotificationDays || 0;
    if (advanceDays > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysUntilJob = Math.floor((dateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilJob < advanceDays) {
        reasons.push(`Avisering krävs ${advanceDays} dagar i förväg — bara ${Math.max(0, daysUntilJob)} dagar kvar`);
      }
    }

    if (dependenciesData?.dependencies) {
      const deps = dependenciesData.dependencies[job.id] || [];
      for (const dep of deps) {
        const parentJob = workOrders.find(wo => wo.id === dep.dependsOnWorkOrderId);
        if (parentJob) {
          if (!parentJob.scheduledDate || parentJob.executionStatus === "not_planned") {
            reasons.push(`Beroende "${parentJob.title}" ej planerad`);
          } else {
            const parentDate = new Date(parentJob.scheduledDate);
            if (parentDate > dateObj) {
              reasons.push(`Beroende "${parentJob.title}" planerad efter (${format(parentDate, "d MMM", { locale: sv })})`);
            }
          }
        }
      }
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
  }, [scheduledJobs, timewindowMap, restrictionsByObject, dependenciesData, workOrders]);

  const detectDropConflicts = detectConflictsForJob;

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
    
    let scheduledStartTime = hour !== undefined ? `${hour.toString().padStart(2, "0")}:00` : undefined;

    if (!scheduledStartTime && viewMode === "week") {
      const existingDayJobs = (resourceDayJobMap.jobs[resourceId]?.[dateStr] || [])
        .filter(j => j.scheduledStartTime)
        .sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
      
      let nextSlotMinutes = DAY_START_HOUR * 60;
      for (const existing of existingDayJobs) {
        const [eH, eM] = (existing.scheduledStartTime || "07:00").split(":").map(Number);
        const endMin = eH * 60 + eM + (existing.estimatedDuration || 60);
        if (endMin > nextSlotMinutes) nextSlotMinutes = endMin;
      }
      const h = Math.floor(nextSlotMinutes / 60);
      const m = nextSlotMinutes % 60;
      if (h < DAY_END_HOUR) {
        scheduledStartTime = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
      }
    }

    const conflicts = detectDropConflicts(job, resourceId, dateStr, scheduledStartTime);
    if (conflicts.length > 0) {
      setPendingSchedule({ jobId, resourceId, scheduledDate: dateStr, scheduledStartTime, conflicts });
      setConflictDialogOpen(true);
      return;
    }

    executeSchedule(jobId, resourceId, dateStr, scheduledStartTime);
    if (scheduledStartTime) {
      toast({ title: "Schemalagt", description: `Starttid ${scheduledStartTime} tilldelad automatiskt` });
    }
  }, [workOrders, executeSchedule, detectDropConflicts, viewMode, routeJobsForView, toast, updateWorkOrderMutation, currentDate, resourceDayJobMap]);

  const jobConflicts = useMemo(() => {
    const conflicts: Record<string, string[]> = {};
    for (const job of scheduledJobs) {
      if (!job.scheduledDate || !job.resourceId) continue;
      const dateStr = format(new Date(job.scheduledDate), "yyyy-MM-dd");
      const reasons = detectConflictsForJob(job, job.resourceId, dateStr, job.scheduledStartTime || null);
      if (reasons.length > 0) {
        conflicts[job.id] = reasons;
      }
    }
    return conflicts;
  }, [scheduledJobs, detectConflictsForJob]);

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

  const handleClearAllScheduled = async () => {
    setClearLoading(true);
    try {
      let clearStart: Date;
      let clearEnd: Date;
      if (viewMode === "month") {
        clearStart = startOfMonth(currentDate);
        clearEnd = addDays(clearStart, getDaysInMonth(currentDate) - 1);
      } else if (viewMode === "day") {
        clearStart = currentDate;
        clearEnd = currentDate;
      } else {
        clearStart = currentWeekStart;
        clearEnd = addDays(currentWeekStart, 4);
      }
      const response = await apiRequest("POST", "/api/work-orders/bulk-unschedule", {
        startDate: format(clearStart, "yyyy-MM-dd"),
        endDate: format(clearEnd, "yyyy-MM-dd"),
      });
      const data = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      setClearDialogOpen(false);
      toast({
        title: "Planering rensad",
        description: `${data.count} jobb avplanerade och flyttade tillbaka till orderstocken.`,
      });
    } catch (error) {
      toast({ title: "Fel", description: "Kunde inte rensa planeringen", variant: "destructive" });
    } finally {
      setClearLoading(false);
    }
  };

  const handleAutoFillPreview = async () => {
    setAutoFillLoading(true);
    setAutoFillPreview(null);
    try {
      const weekStart = viewMode === "week" ? currentWeekStart : startOfWeek(currentDate, { weekStartsOn: 1 });
      const response = await apiRequest("POST", "/api/auto-plan-week", {
        weekStartDate: format(weekStart, "yyyy-MM-dd"),
        resourceIds: resources.map(r => r.id),
        overbookingPercent: autoFillOverbooking,
      });
      const data = await response.json();
      setAutoFillPreview(data.assignments || []);
      setAutoFillSkipped(data.totalSkipped || 0);
      setAutoFillDiag(data.totalUnscheduled != null ? { totalUnscheduled: data.totalUnscheduled, capacityPerDay: data.capacityPerDay || {}, maxMinutesPerDay: data.maxMinutesPerDay || 480, resourceCount: data.resourceCount || 0, clusterSkipped: data.clusterSkipped || 0 } : null);
    } catch (error) {
      toast({ title: "Fel", description: "Kunde inte generera planering", variant: "destructive" });
    } finally {
      setAutoFillLoading(false);
    }
  };

  const handleAutoFillApply = async () => {
    if (!autoFillPreview || autoFillPreview.length === 0) return;
    setAutoFillApplying(true);
    try {
      const response = await apiRequest("POST", "/api/auto-plan-week/apply", {
        assignments: autoFillPreview,
      });
      const data = await response.json();
      const skippedMsg = autoFillSkipped > 0 ? `, ${autoFillSkipped} ryms ej denna vecka` : "";
      toast({ title: "Planering tillämpad", description: `${data.applied} uppdrag planerade${skippedMsg}` });
      setAutoFillDialogOpen(false);
      setAutoFillPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    } catch (error) {
      toast({ title: "Fel", description: "Kunde inte tillämpa planering", variant: "destructive" });
    } finally {
      setAutoFillApplying(false);
    }
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
          className={`p-2 cursor-grab active:cursor-grabbing hover-elevate active-elevate-2 border-l-4 overflow-hidden ${timeBlockBorders[category]} ${selectedJob === job.id ? "ring-2 ring-primary" : ""} ${hasConflict ? "ring-2 ring-red-500 bg-red-50 dark:bg-red-950/30" : ""} group touch-none`}
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
                {(job as any).executionCode && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-[10px] shrink-0 bg-slate-100 dark:bg-slate-800 px-1 rounded" data-testid={`exec-code-${job.id}`}>
                        {EXECUTION_CODE_ICONS[(job as any).executionCode] || "KOD"}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{EXECUTION_CODE_LABELS[(job as any).executionCode] || (job as any).executionCode}</TooltipContent>
                  </Tooltip>
                )}
                {(hasDependencies || hasDependents) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="flex items-center gap-0.5 shrink-0 cursor-pointer hover:opacity-70"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDepChainJobId(job.id);
                          setDepChainDialogOpen(true);
                        }}
                        data-testid={`dep-chain-link-${job.id}`}
                      >
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
                        <p className="text-muted-foreground">Klicka för att se beroendekedjan</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate">{job.objectName || "Okänt objekt"}</div>
              {(job as any).metadata?.teamName && (
                <Badge variant="outline" className="text-[9px] h-4 gap-0.5 mt-0.5" style={{ borderColor: "#3B82F6" }} data-testid={`team-badge-${job.id}`}>
                  <UsersRound className="h-2.5 w-2.5" />
                  {(job as any).metadata.teamName}
                </Badge>
              )}
              {(job as any).creationMethod === "automatic" && (
                <Badge className="text-[9px] h-4 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-amber-300" data-testid={`pickup-badge-${job.id}`}>
                  Plockuppgift
                </Badge>
              )}
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
                      <span>{job.scheduledStartTime}</span>
                      {(() => {
                        const cardTws = timewindowMap.get(job.id);
                        if (cardTws && cardTws.length > 0) {
                          const hasTimeBound = cardTws.some(tw => tw.startTime && tw.endTime);
                          if (hasTimeBound) {
                            const isWithin = cardTws.some(tw => {
                              if (!tw.startTime || !tw.endTime || !job.scheduledStartTime) return false;
                              return job.scheduledStartTime >= tw.startTime && job.scheduledStartTime <= tw.endTime;
                            });
                            return (
                              <span className={`text-[9px] px-1 rounded ${isWithin ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"}`}>
                                {isWithin ? "i fönster" : "utanför"}
                              </span>
                            );
                          }
                        }
                        return null;
                      })()}
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
                  <SubStepsExpander jobId={job.id} isExpanded={!!expandedSubSteps[job.id]} onToggle={() => setExpandedSubSteps(prev => ({ ...prev, [job.id]: !prev[job.id] }))} />
                  {selectedJob === job.id && (
                    <WorkOrderMetadataPanel
                      workOrderId={job.id}
                      objectId={job.objectId}
                      executionStatus={execStatus}
                      compact
                    />
                  )}
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

  const zoomTextClass = zoom.scale <= 0.5 ? "text-[8px]" : zoom.scale >= 2 ? "text-base" : "text-xs";
  const zoomPadClass = zoom.scale <= 0.5 ? "p-0.5" : zoom.scale >= 2 ? "p-4" : "p-2";
  const zoomGapClass = zoom.scale <= 0.5 ? "space-y-0" : zoom.scale >= 2 ? "space-y-3" : "space-y-1";

  const renderDayTimelineView = () => {
    const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);
    const day = currentDate;
    const dayOfWeek = day.getDay() || 7;

    const dayRestrictions = timeRestrictions.filter(r => r.isActive && r.weekdays && r.weekdays.includes(dayOfWeek));

    return (
      <div className="flex-1 overflow-auto">
        <div style={{ minWidth: `${60 + resources.length * 120}px` }}>
          {dayRestrictions.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-800" data-testid="day-restrictions-banner">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
              <span className="text-xs text-red-600 dark:text-red-400">
                {dayRestrictions.length} tidsbegränsning{dayRestrictions.length > 1 ? "ar" : ""} aktiv{dayRestrictions.length > 1 ? "a" : ""} idag
              </span>
            </div>
          )}
          <div className="grid border-b sticky top-0 bg-background z-10" style={{ gridTemplateColumns: `60px repeat(${resources.length}, 1fr)` }}>
            <div className="p-2 font-medium text-sm text-muted-foreground border-r flex items-center justify-center">Tid</div>
            {resources.map((resource) => {
              const dayHours = getResourceDayHours(resource.id, day);
              const capacityPct = getCapacityPercentage(dayHours);
              return (
                <div key={resource.id} className="p-2 border-r last:border-r-0 flex items-center justify-center gap-1.5 min-w-0">
                  <Avatar className="h-5 w-5 shrink-0">
                    <AvatarFallback className="text-[10px]">{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-medium truncate">{resource.name}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={`text-[10px] whitespace-nowrap cursor-help shrink-0 ${capacityPct >= 100 ? "text-red-600 dark:text-red-400 font-semibold" : capacityPct >= 85 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}>
                        {dayHours.toFixed(1)}h
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{dayHours.toFixed(1)}h av {HOURS_IN_DAY}h</p>
                      <p>{Math.max(0, HOURS_IN_DAY - dayHours).toFixed(1)}h kvar</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </div>

          {hours.map((hour) => (
            <div key={hour} className="grid border-b" style={{ gridTemplateColumns: `60px repeat(${resources.length}, 1fr)` }}>
              <div className="p-2 border-r text-sm text-muted-foreground font-medium text-center">
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
                const resourceTravels = travelTimesForDay[resource.id] || [];
                const hourTravels = resourceTravels.filter(t => {
                  const tHour = parseInt(t.startTime.split(":")[0], 10);
                  return tHour === hour;
                });

                const cellHasProduction = jobs.some(j => getJobCategory(j) === "production");
                const cellHasTravel = jobs.some(j => getJobCategory(j) === "travel");
                const cellHasBreak = jobs.some(j => getJobCategory(j) === "break");
                const cellBg = cellHasProduction ? "bg-green-50/50 dark:bg-green-950/10" : cellHasTravel ? "bg-yellow-50/50 dark:bg-yellow-950/10" : cellHasBreak ? "bg-blue-50/50 dark:bg-blue-950/10" : "bg-muted/20";

                const dayCellDropFit = activeDragJob ? getDropFitClass(resource.id, format(day, "yyyy-MM-dd"), activeDragJob.estimatedDuration || 60) : null;

                return (
                  <DroppableCell
                    key={resource.id}
                    id={droppableId}
                    className={`${zoomPadClass} border-r last:border-r-0 transition-colors ${cellBg}`}
                    dropFitInfo={dayCellDropFit}
                    style={{ minHeight: `${zoom.dayH}px` }}
                  >
                    <div className={zoomGapClass} data-testid={`drop-zone-${resource.id}-${hour}`}>
                      {jobs.map((job) => {
                        const travelAfter = resourceTravels.find(t => t.fromJobId === job.id);
                        return (
                          <div key={job.id}>
                            {renderJobCard(job)}
                            {travelAfter && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1.5 px-2 py-1 mt-1 rounded text-xs bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200" data-testid={`travel-block-${job.id}`}>
                                    <Navigation className="h-3 w-3" />
                                    <span>Restid {travelAfter.minutes} min</span>
                                    <span className="text-yellow-600 dark:text-yellow-400">({travelAfter.distanceKm} km)</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Körtid: {travelAfter.startTime}–{travelAfter.endTime}</p>
                                  <p>Avstånd: {travelAfter.distanceKm} km (beräknat ~50 km/h)</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        );
                      })}
                      {hourTravels.filter(t => !jobs.some(j => j.id === t.fromJobId)).map((t, i) => (
                        <Tooltip key={`travel-orphan-${i}`}>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200">
                              <Navigation className="h-3 w-3" />
                              <span>Restid {t.minutes} min ({t.distanceKm} km)</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Körtid: {t.startTime}–{t.endTime}</p>
                          </TooltipContent>
                        </Tooltip>
                      ))}
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
    <div className="flex-1 overflow-y-auto overflow-x-hidden">
      <div className="w-full">
        <div className="grid grid-cols-[120px_repeat(5,minmax(0,1fr))] border-b sticky top-0 bg-background z-10">
          <div className="p-2 font-medium text-sm text-muted-foreground border-r">Resurser</div>
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
          resources.map((resource) => {
            const weekSummary = resourceWeekSummary[resource.id];
            return (
            <div key={resource.id} className="grid grid-cols-[120px_repeat(5,minmax(0,1fr))] border-b">
              <div 
                className="p-2 border-r flex items-center gap-2 group overflow-hidden"
                data-testid={`resource-row-${resource.id}`}
              >
                <Avatar 
                  className="h-7 w-7 shrink-0 cursor-pointer hover-elevate"
                  onClick={() => handleResourceClick(resource.id)}
                >
                  <AvatarFallback className="text-[10px]">{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                </Avatar>
                <div 
                  className="min-w-0 flex-1 cursor-pointer overflow-hidden"
                  onClick={() => handleResourceClick(resource.id)}
                >
                  <div className="text-xs font-medium truncate">{resource.name}</div>
                  {weekSummary && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5 mt-0.5" data-testid={`week-utilization-${resource.id}`}>
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${getCapacityColor(weekSummary.pct)}`} style={{ width: `${Math.min(weekSummary.pct, 100)}%` }} />
                          </div>
                          <span className={`text-[10px] tabular-nums ${weekSummary.pct >= 100 ? "text-red-600 dark:text-red-400 font-medium" : weekSummary.pct >= 85 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}>
                            {weekSummary.totalHours.toFixed(1)}h/{weekSummary.weeklyCapacity}h
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Veckobeläggning: {weekSummary.pct}%</p>
                        <p>{weekSummary.totalHours.toFixed(1)}h planerat av {weekSummary.weeklyCapacity}h kapacitet</p>
                        <p>{Math.max(0, weekSummary.weeklyCapacity - weekSummary.totalHours).toFixed(1)}h kvar</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
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

                const sortedDayJobs = [...jobs]
                  .filter(j => j.scheduledStartTime && j.taskLatitude && j.taskLongitude)
                  .sort((a, b) => (a.scheduledStartTime || "").localeCompare(b.scheduledStartTime || ""));
                let totalTravelMin = 0;
                let totalTravelKm = 0;
                const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
                  const R = 6371;
                  const dLat = (lat2 - lat1) * Math.PI / 180;
                  const dLon = (lon2 - lon1) * Math.PI / 180;
                  const a2 = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
                  return R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));
                };
                for (let si = 0; si < sortedDayJobs.length - 1; si++) {
                  const sFrom = sortedDayJobs[si];
                  const sTo = sortedDayJobs[si + 1];
                  if (sFrom.taskLatitude && sFrom.taskLongitude && sTo.taskLatitude && sTo.taskLongitude) {
                    const d = haversine(sFrom.taskLatitude, sFrom.taskLongitude, sTo.taskLatitude, sTo.taskLongitude);
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
                    className={`${zoomPadClass} border-r last:border-r-0 transition-colors overflow-hidden min-w-0 ${getCapacityBgColor(capacityPct)} ${restrictedJobs.length > 0 ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}
                    dropFitInfo={cellDropFit}
                    style={{ minHeight: `${zoom.weekH}px` }}
                  >
                    <div className="min-w-0 overflow-hidden" data-testid={`drop-zone-${resource.id}-${dayStr}`}>
                      <div className="flex items-center gap-1 mb-2">
                        <div className="h-2 flex-1 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${getCapacityColor(capacityPct)}`} style={{ width: `${Math.min(capacityPct, 100)}%` }} />
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`text-[10px] tabular-nums cursor-help ${isOverbooked ? "text-red-600 dark:text-red-400 font-semibold" : capacityPct >= 85 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}>
                              {dayHours.toFixed(1).replace(".", ",")}h
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{dayHours.toFixed(1)}h planerat av {HOURS_IN_DAY}h</p>
                            <p>{Math.max(0, HOURS_IN_DAY - dayHours).toFixed(1)}h kvar</p>
                            {isOverbooked && <p className="text-red-500 font-medium">Överbokad med {(dayHours - HOURS_IN_DAY).toFixed(1)}h</p>}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      {isOverbooked && (
                        <div className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400 mb-1 font-medium">
                          <AlertTriangle className="h-3 w-3" />
                          <span>+{(dayHours - HOURS_IN_DAY).toFixed(1)}h över</span>
                        </div>
                      )}
                      {restrictedJobs.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400 mb-1 cursor-help" data-testid={`cell-restriction-${resource.id}-${dayStr}`}>
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              <span>{restrictedJobs.length} begränsad</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs space-y-1">
                              <p className="font-medium text-red-500">Tidsbegränsade uppdrag</p>
                              {restrictedJobs.map(j => (
                                <p key={j.id}>{j.title} - {j.objectName}</p>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <div className={zoomGapClass}>
                        {jobs.length === 0 && (
                          <div className="flex items-center justify-center py-4 text-muted-foreground/40">
                            <Plus className="h-4 w-4" />
                          </div>
                        )}
                        {jobs.map((job) => renderJobCard(job, true))}
                      </div>
                      {totalTravelMin > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 mt-2 px-1.5 py-0.5 rounded text-[10px] bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800" data-testid={`travel-summary-${resource.id}-${dayStr}`}>
                              <Navigation className="h-2.5 w-2.5" />
                              <span>{totalTravelMin} min</span>
                              <span className="text-yellow-500">({Math.round(totalTravelKm)} km)</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Total restid: {totalTravelMin} min, {Math.round(totalTravelKm * 10) / 10} km</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </DroppableCell>
                );
              })}
            </div>
            );
          })
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
            cells.push(<div key={`empty-${i}`} style={{ minHeight: `${zoom.monthH}px` }} />);
          }
          
          for (let d = 1; d <= daysInCurrentMonth; d++) {
            const day = new Date(currentDate.getFullYear(), currentDate.getMonth(), d);
            const dayJobs = filteredScheduledJobs.filter(j => j.scheduledDate && isSameDay(new Date(j.scheduledDate), day));
            const isToday = isSameDay(day, new Date());
            const totalHours = dayJobs.reduce((sum, j) => sum + (j.estimatedDuration || 0) / 60, 0);

            const productionCount = dayJobs.filter(j => getJobCategory(j) === "production").length;
            const travelCount = dayJobs.filter(j => getJobCategory(j) === "travel").length;
            const breakCount = dayJobs.filter(j => getJobCategory(j) === "break").length;

            const dayConflictCount = dayJobs.filter(j => jobConflicts[j.id]).length;

            const dayOfWeek = day.getDay() || 7;
            const dayObjectIds = new Set(dayJobs.map(j => j.objectId).filter(Boolean));
            const dayRestrictionCount = dayObjectIds.size > 0
              ? timeRestrictions.filter(r =>
                  r.isActive && r.weekdays && r.weekdays.includes(dayOfWeek) && dayObjectIds.has(r.objectId)
                ).length
              : 0;
            
            cells.push(
              <div 
                key={d} 
                className={`p-2 rounded-md border cursor-pointer hover-elevate transition-colors ${isToday ? "border-primary bg-primary/5" : dayRestrictionCount > 0 ? "border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20" : "border-border bg-muted/30"}`}
                style={{ minHeight: `${zoom.monthH}px` }}
                onClick={() => goToDay(day)}
                data-testid={`month-day-${d}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-sm font-medium ${isToday ? "text-primary" : ""}`}>{d}</span>
                  {dayConflictCount > 0 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-0.5 text-red-500" data-testid={`month-conflict-${d}`}>
                          <AlertTriangle className="h-3 w-3" />
                          <span className="text-[9px]">{dayConflictCount}</span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{dayConflictCount} jobb med konflikter</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                {dayJobs.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-0.5" data-testid={`month-categories-${d}`}>
                      {productionCount > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-0.5 text-[9px]" data-testid={`month-production-${d}`}>
                              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0"></span>
                              <span>{productionCount}</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Produktionstid: {productionCount} jobb</TooltipContent>
                        </Tooltip>
                      )}
                      {travelCount > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-0.5 text-[9px] ml-1" data-testid={`month-travel-${d}`}>
                              <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0"></span>
                              <span>{travelCount}</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Restid: {travelCount} jobb</TooltipContent>
                        </Tooltip>
                      )}
                      {breakCount > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-0.5 text-[9px] ml-1" data-testid={`month-break-${d}`}>
                              <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0"></span>
                              <span>{breakCount}</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Egentid: {breakCount} jobb</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground" data-testid={`month-summary-${d}`}>
                      {dayJobs.length} jobb / {totalHours.toFixed(1)}h
                    </div>
                    {dayRestrictionCount > 0 && (
                      <div className="text-[9px] text-red-500 flex items-center gap-0.5" data-testid={`month-restriction-${d}`}>
                        <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                        {dayRestrictionCount} begr.
                      </div>
                    )}
                  </div>
                )}
                {dayJobs.length === 0 && dayRestrictionCount > 0 && (
                  <div className="text-[9px] text-red-500 flex items-center gap-0.5 mt-1" data-testid={`month-restriction-${d}`}>
                    <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                    {dayRestrictionCount} begr.
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
    const dragTws = timewindowMap.get(activeDragJob.id);
    const hasTimeWindow = dragTws && dragTws.length > 0;
    const windowLabel = hasTimeWindow
      ? dragTws.map(tw => {
          const parts: string[] = [];
          if (tw.dayOfWeek) parts.push(tw.dayOfWeek.substring(0, 3));
          if (tw.startTime && tw.endTime) parts.push(`${tw.startTime}–${tw.endTime}`);
          return parts.join(" ");
        }).join(", ")
      : null;
    const hasDeadline = activeDragJob.plannedWindowEnd;
    
    return (
      <Card className="p-3 shadow-xl border-primary/50 bg-background/95 backdrop-blur-sm w-[260px] rotate-1">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDotColors[activeDragJob.priority]}`} />
            <span className="text-sm font-medium truncate">{activeDragJob.title}</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">{activeDragJob.objectName || "Okänt objekt"}</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="secondary" className="text-[10px]">
              {((activeDragJob.estimatedDuration || 0) / 60).toFixed(1).replace(".", ",")} h
            </Badge>
            {windowLabel && (
              <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600 dark:text-blue-400">
                <Clock className="h-2.5 w-2.5 mr-0.5" />
                {windowLabel}
              </Badge>
            )}
            {hasDeadline && (
              <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-600 dark:text-amber-400">
                DL: {format(new Date(activeDragJob.plannedWindowEnd!), "d MMM", { locale: sv })}
              </Badge>
            )}
          </div>
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
          <div className="p-3 border-b space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Inbox className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Oschemalagda</span>
                <Badge variant="secondary" className="text-xs">{unscheduledJobs.length}</Badge>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap" data-testid="sidebar-quick-stats">
              {sidebarQuickStats.urgentCount > 0 && (
                <Badge variant="destructive" className="text-[10px] h-5 gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {sidebarQuickStats.urgentCount} akut
                </Badge>
              )}
              {sidebarQuickStats.highCount > 0 && (
                <Badge className="text-[10px] h-5 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 border-orange-300">
                  {sidebarQuickStats.highCount} hög
                </Badge>
              )}
              {sidebarQuickStats.overdueCount > 0 && (
                <Badge variant="outline" className="text-[10px] h-5 gap-1 text-red-600 border-red-300">
                  <Clock className="h-2.5 w-2.5" />
                  {sidebarQuickStats.overdueCount} försenade
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] h-5 font-normal">
                {sidebarQuickStats.totalHours}h totalt
              </Badge>
            </div>
            <Input
              placeholder="Sök jobb, objekt, kund..."
              value={orderstockSearch}
              onChange={(e) => setOrderstockSearch(e.target.value)}
              className="h-8 text-xs"
              data-testid="input-orderstock-search"
            />
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 flex-1"
                onClick={() => setSidebarFiltersOpen(!sidebarFiltersOpen)}
                data-testid="button-toggle-sidebar-filters"
              >
                <Filter className="h-3.5 w-3.5" />
                Filter
                {sidebarActiveFilterCount > 0 && (
                  <Badge variant="secondary" className="text-xs rounded-full">
                    {sidebarActiveFilterCount}
                  </Badge>
                )}
                {sidebarFiltersOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
              {sidebarActiveFilterCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={clearAllSidebarFilters} data-testid="button-clear-sidebar-filters">
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Rensa alla filter</TooltipContent>
                </Tooltip>
              )}
            </div>
            {sidebarActiveFilterCount > 0 && (
              <div className="flex items-center gap-1 flex-wrap" data-testid="sidebar-active-filters">
                {filterCustomer !== "all" && (
                  <Badge variant="secondary" className="text-[10px] gap-0.5 cursor-pointer" onClick={() => setFilterCustomer("all")} data-testid="badge-sidebar-filter-customer">
                    {customers.find(c => c.id === filterCustomer)?.name || "Kund"}
                    <X className="h-2.5 w-2.5" />
                  </Badge>
                )}
                {filterPriority !== "all" && (
                  <Badge variant="secondary" className="text-[10px] gap-0.5 cursor-pointer" onClick={() => setFilterPriority("all")} data-testid="badge-sidebar-filter-priority">
                    {priorityLabels[filterPriority] || filterPriority}
                    <X className="h-2.5 w-2.5" />
                  </Badge>
                )}
                {filterCluster !== "all" && (
                  <Badge variant="secondary" className="text-[10px] gap-0.5 cursor-pointer" onClick={() => setFilterCluster("all")} data-testid="badge-sidebar-filter-cluster">
                    {filterCluster === "none" ? "Utan område" : clusters.find(c => c.id === filterCluster)?.name || "Område"}
                    <X className="h-2.5 w-2.5" />
                  </Badge>
                )}
                {filterTeam !== "all" && (
                  <Badge variant="secondary" className="text-[10px] gap-0.5 cursor-pointer" onClick={() => setFilterTeam("all")} data-testid="badge-sidebar-filter-team">
                    {teamsData.find(t => t.id === filterTeam)?.name || "Team"}
                    <X className="h-2.5 w-2.5" />
                  </Badge>
                )}
                {filterExecutionCode !== "all" && (
                  <Badge variant="secondary" className="text-[10px] gap-0.5 cursor-pointer" onClick={() => setFilterExecutionCode("all")} data-testid="badge-sidebar-filter-exec-code">
                    {EXECUTION_CODE_LABELS[filterExecutionCode] || filterExecutionCode}
                    <X className="h-2.5 w-2.5" />
                  </Badge>
                )}
              </div>
            )}
            {sidebarFiltersOpen && (
              <div className="space-y-2 pt-1" data-testid="sidebar-filter-dropdowns">
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
                <Select value={filterExecutionCode} onValueChange={setFilterExecutionCode}>
                  <SelectTrigger className="w-full h-8 text-xs" data-testid="select-unscheduled-execution-code">
                    <SelectValue placeholder="Alla utförandekoder" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alla utförandekoder</SelectItem>
                    {Object.entries(EXECUTION_CODE_LABELS).map(([code, label]) => (
                      <SelectItem key={code} value={code}>
                        <span className="flex items-center gap-1.5">
                          {EXECUTION_CODE_ICONS[code]} {label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
                        className={`p-3 cursor-grab active:cursor-grabbing hover-elevate active-elevate-2 touch-none ${selectedJob === job.id ? "ring-2 ring-primary" : ""} ${job.priority === "urgent" ? "border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-950/20" : job.priority === "high" ? "border-l-4 border-l-orange-500" : ""}`}
                        onClick={() => handleJobClick(job.id)}
                        data-testid={`unscheduled-job-${job.id}`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDotColors[job.priority]}`} />
                            <span className="text-sm font-medium">{job.title}</span>
                            {job.priority === "urgent" && (
                              <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                            )}
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
                          {(() => {
                            const jobTws = timewindowMap.get(job.id);
                            if (jobTws && jobTws.length > 0) {
                              const twLabel = jobTws.map(tw => {
                                const parts: string[] = [];
                                if (tw.dayOfWeek) parts.push(tw.dayOfWeek.substring(0, 3));
                                if (tw.startTime && tw.endTime) parts.push(`${tw.startTime}–${tw.endTime}`);
                                return parts.join(" ");
                              }).join(", ");
                              return (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400" data-testid={`unscheduled-timewindow-${job.id}`}>
                                      <Clock className="h-2.5 w-2.5" />
                                      <span className="truncate">{twLabel}</span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="text-xs space-y-1">
                                      <p className="font-medium">Tillåtna tidsfönster</p>
                                      {jobTws.map((tw, i) => (
                                        <p key={i}>{tw.dayOfWeek || "Alla dagar"}{tw.startTime && tw.endTime ? ` ${tw.startTime}–${tw.endTime}` : ""}</p>
                                      ))}
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            }
                            return null;
                          })()}
                          {job.plannedWindowEnd && (
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground" data-testid={`unscheduled-deadline-${job.id}`}>
                              <Clock className="h-2.5 w-2.5" />
                              <span>Deadline: {format(new Date(job.plannedWindowEnd), "d MMM", { locale: sv })}</span>
                              {new Date(job.plannedWindowEnd) < new Date() && (
                                <Badge variant="destructive" className="text-[9px] h-4 ml-1">Försenad</Badge>
                              )}
                              {new Date(job.plannedWindowEnd) >= new Date() && new Date(job.plannedWindowEnd) < addDays(new Date(), 7) && (
                                <Badge className="text-[9px] h-4 ml-1 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-amber-300">Snart</Badge>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-2 pt-1 flex-wrap">
                            <Badge variant="outline" className="text-[10px]">
                              {priorityLabels[job.priority] || job.priority}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              {((job.estimatedDuration || 0) / 60).toFixed(1).replace(".", ",")} h
                            </Badge>
                            {(job as any).executionCode && (
                              <Badge variant="outline" className="text-[10px]" data-testid={`unscheduled-exec-code-${job.id}`}>
                                {EXECUTION_CODE_ICONS[(job as any).executionCode] || "KOD"} {EXECUTION_CODE_LABELS[(job as any).executionCode] || (job as any).executionCode}
                              </Badge>
                            )}
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="default"
                                className="w-full mt-1.5"
                                onClick={(e) => handleOpenAssignDialog(job, e)}
                                data-testid={`button-assign-job-${job.id}`}
                              >
                                <UserPlus className="h-3.5 w-3.5 mr-1" />
                                Tilldela
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Tilldela resurs och datum</TooltipContent>
                          </Tooltip>
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
            {viewMode !== "route" && (
              <div className="flex items-center gap-1 border rounded-md px-1" data-testid="zoom-controls">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={zoomLevel === 0}
                      onClick={() => setZoomLevel(Math.max(0, zoomLevel - 1))}
                      data-testid="button-zoom-out"
                    >
                      <ZoomOut className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Zooma ut</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="text-[10px] text-muted-foreground w-12 text-center cursor-pointer select-none"
                      onClick={() => setZoomLevel(1)}
                      data-testid="text-zoom-level"
                    >
                      {zoom.label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Klicka för att återställa zoom</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={zoomLevel === zoomLevels.length - 1}
                      onClick={() => setZoomLevel(Math.min(zoomLevels.length - 1, zoomLevel + 1))}
                      data-testid="button-zoom-in"
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Zooma in</TooltipContent>
                </Tooltip>
              </div>
            )}
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
            <Button 
              variant="outline" 
              onClick={() => { setAutoFillDialogOpen(true); setAutoFillPreview(null); }}
              data-testid="button-auto-fill-week"
            >
              <Wand2 className="h-4 w-4 mr-2" />
              Fyll veckan
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => setClearDialogOpen(true)}
                  data-testid="button-clear-all-scheduled"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rensa all planering för {viewMode === "month" ? "denna månad" : viewMode === "day" ? "denna dag" : "denna vecka"}</TooltipContent>
            </Tooltip>
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

        {/* Målstaplar - Goal progress bars */}
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
    <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Rensa planering
          </DialogTitle>
          <DialogDescription>
            Är du säker? <strong>{currentViewScheduledJobs.length} schemalagda jobb</strong> i {viewMode === "month" ? "denna månad" : viewMode === "day" ? "denna dag" : "denna vecka"} kommer att avplaneras och flyttas tillbaka till orderstocken.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setClearDialogOpen(false)} data-testid="button-cancel-clear">
            Avbryt
          </Button>
          <Button variant="destructive" onClick={handleClearAllScheduled} disabled={clearLoading} data-testid="button-confirm-clear">
            {clearLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
            Rensa {currentViewScheduledJobs.length} jobb
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={autoFillDialogOpen} onOpenChange={(open) => { if (!open) { setAutoFillDialogOpen(false); setAutoFillPreview(null); } }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            Fyll veckan automatiskt
          </DialogTitle>
          <DialogDescription>
            Fyll lediga tider i veckan med oplanerade uppdrag. Algoritmen prioriterar brådsamma uppdrag och minimerar körsträckan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-2 block">Överbokningstolerans: {autoFillOverbooking}%</label>
            <input
              type="range"
              min={0}
              max={50}
              step={5}
              value={autoFillOverbooking}
              onChange={(e) => setAutoFillOverbooking(Number(e.target.value))}
              className="w-full accent-primary"
              data-testid="slider-overbooking"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>0% (exakt)</span>
              <span>25%</span>
              <span>50% (max)</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleAutoFillPreview} disabled={autoFillLoading} data-testid="button-auto-fill-preview">
              {autoFillLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Förhandsgranska
            </Button>
            <span className="text-xs text-muted-foreground">
              {resources.length} resurser, v.{format(viewMode === "week" ? currentWeekStart : startOfWeek(currentDate, { weekStartsOn: 1 }), "w", { locale: sv })}
            </span>
          </div>

          {autoFillPreview && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Badge variant="default">{autoFillPreview.length} tilldelade</Badge>
                {autoFillSkipped > 0 && <Badge variant="secondary">{autoFillSkipped} ryms ej</Badge>}
              </div>
              {autoFillSkipped > 0 && autoFillPreview.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>{autoFillSkipped} uppdrag ryms ej i schemat och förblir oplanerade i orderstocken.</p>
                  {autoFillDiag && autoFillDiag.clusterSkipped > 0 && (
                    <p className="text-amber-500">{autoFillDiag.clusterSkipped} av dessa saknar matchande resurs för sitt kluster.</p>
                  )}
                </div>
              )}

              {autoFillPreview.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[1fr_120px_80px_60px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                    <span>Uppdrag</span>
                    <span>Resurs</span>
                    <span>Dag</span>
                    <span>Tid</span>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {autoFillPreview.map((a, i) => {
                      const resource = resources.find(r => r.id === a.resourceId);
                      return (
                        <div key={i} className="grid grid-cols-[1fr_120px_80px_60px] gap-2 px-3 py-2 border-t text-sm items-center" data-testid={`auto-fill-row-${i}`}>
                          <div className="truncate">
                            <span className="font-medium">{a.title}</span>
                            {a.address && <span className="text-xs text-muted-foreground ml-1">- {a.address}</span>}
                          </div>
                          <span className="text-xs">{resource?.name || a.resourceId}</span>
                          <span className="text-xs">{format(new Date(a.scheduledDate + "T12:00:00"), "EEE d/M", { locale: sv })}</span>
                          <span className="text-xs">{a.scheduledStartTime}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {autoFillPreview.length === 0 && (
                <div className="p-4 text-sm border rounded-lg space-y-2">
                  <p className="text-center text-muted-foreground font-medium">Inga uppdrag kunde tilldelas denna vecka.</p>
                  {autoFillDiag && (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {autoFillDiag.totalUnscheduled === 0 ? (
                        <p className="flex items-center gap-1"><Check className="h-3.5 w-3.5 text-green-500" /> Alla uppdrag är redan planerade.</p>
                      ) : (
                        <>
                          <p>{autoFillDiag.totalUnscheduled} oplanerade uppdrag hittades men ryms ej i schemat.</p>
                          <p>{autoFillDiag.resourceCount} resurser × 5 dagar = {autoFillDiag.resourceCount * 5} resursdagar (max {Math.round(autoFillDiag.maxMinutesPerDay / 60)}h/dag)</p>
                          {Object.entries(autoFillDiag.capacityPerDay).length > 0 && (
                            <div className="grid grid-cols-5 gap-1 mt-1">
                              {Object.entries(autoFillDiag.capacityPerDay).sort().map(([day, mins]) => {
                                const pct = Math.min(100, Math.round((mins / autoFillDiag!.maxMinutesPerDay) * 100 / autoFillDiag!.resourceCount * autoFillDiag!.resourceCount));
                                const totalCapacity = autoFillDiag!.maxMinutesPerDay * autoFillDiag!.resourceCount;
                                const fillPct = Math.min(100, Math.round((mins / totalCapacity) * 100));
                                return (
                                  <div key={day} className="text-center">
                                    <p className="font-medium">{day.slice(5)}</p>
                                    <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-0.5">
                                      <div className={`h-full rounded-full ${fillPct >= 95 ? 'bg-red-500' : fillPct >= 70 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${fillPct}%` }} />
                                    </div>
                                    <p className="mt-0.5">{fillPct}%</p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {autoFillDiag.clusterSkipped > 0 && (
                            <p className="text-amber-500 mt-1">{autoFillDiag.clusterSkipped} uppdrag saknar matchande resurs för sitt kluster (geografiskt område).</p>
                          )}
                          <p className="mt-1">Prova att öka överbokningsprocenten eller byta till en annan vecka.</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { setAutoFillDialogOpen(false); setAutoFillPreview(null); }} data-testid="button-cancel-auto-fill">
            Avbryt
          </Button>
          {autoFillPreview && autoFillPreview.length > 0 && (
            <Button onClick={handleAutoFillApply} disabled={autoFillApplying} data-testid="button-apply-auto-fill">
              {autoFillApplying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              Tillämpa ({autoFillPreview.length} uppdrag)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={depChainDialogOpen} onOpenChange={(open) => { if (!open) { setDepChainDialogOpen(false); setDepChainJobId(null); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-orange-500" />
            Beroendekedja
          </DialogTitle>
          <DialogDescription>
            Visar alla uppgifter som är kopplade via beroenden.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {depChainJobId && (
            <div className="p-3 border rounded-lg bg-primary/5">
              <div className="text-sm font-medium">
                {workOrders.find(w => w.id === depChainJobId)?.title || "Vald uppgift"}
              </div>
              <div className="text-xs text-muted-foreground">
                {workOrders.find(w => w.id === depChainJobId)?.objectName}
              </div>
            </div>
          )}
          {depChainData?.chain && depChainData.chain.length > 0 ? (
            <div className="space-y-2">
              {depChainData.chain.map((item, i) => (
                <div key={i} className={`p-3 border rounded-lg flex items-start gap-3 ${item.workOrder.creationMethod === "automatic" ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30" : ""}`}>
                  <div className="shrink-0 mt-0.5">
                    {item.type === "depends_on" ? (
                      <Link2 className="h-4 w-4 text-orange-500" />
                    ) : (
                      <ArrowRight className="h-4 w-4 text-blue-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{item.workOrder.title}</div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {item.type === "depends_on" ? "Föregångare" : "Efterföljare"}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {item.dependencyType === "automatic" ? "Automatisk" : item.dependencyType === "structural" ? "Strukturell" : "Sekventiell"}
                      </Badge>
                      {item.workOrder.scheduledDate && (
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(item.workOrder.scheduledDate).toLocaleDateString("sv-SE")}
                          {item.workOrder.scheduledStartTime && ` ${item.workOrder.scheduledStartTime}`}
                        </span>
                      )}
                      {item.workOrder.creationMethod === "automatic" && (
                        <Badge className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                          Plockuppgift
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-sm text-muted-foreground">
              Inga beroenden hittades
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setDepChainDialogOpen(false); setDepChainJobId(null); }} data-testid="button-close-dep-chain">
            Stäng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </DndContext>
  );
}
