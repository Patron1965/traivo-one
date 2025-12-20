import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronLeft, ChevronRight, Plus, AlertTriangle, Loader2, CalendarDays, Calendar, CalendarRange, Clock, Inbox, ChevronDown, ChevronUp } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { format, addDays, startOfWeek, startOfMonth, isSameDay, getDaysInMonth, addMonths } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrder, ServiceObject, Customer } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const priorityColors: Record<string, string> = {
  urgent: "border-l-4 border-l-red-500",
  high: "border-l-4 border-l-orange-500",
  normal: "border-l-4 border-l-blue-500",
  low: "border-l-4 border-l-gray-400",
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

const HOURS_IN_DAY = 8;
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 17;

interface WeekPlannerProps {
  onAddJob?: () => void;
  onSelectJob?: (jobId: string) => void;
}

type ViewMode = "day" | "week" | "month";

export function WeekPlanner({ onAddJob, onSelectJob }: WeekPlannerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  const [showUnscheduled, setShowUnscheduled] = useState(true);
  const [filterCustomer, setFilterCustomer] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const { toast } = useToast();

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
    const firstDate = visibleDates[0];
    const lastDate = visibleDates[visibleDates.length - 1];
    const startDate = format(addDays(firstDate, -7), "yyyy-MM-dd");
    const endDate = format(addDays(lastDate, 7), "yyyy-MM-dd");
    return { startDate, endDate };
  }, [visibleDates]);

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders", dateRange.startDate, dateRange.endDate],
    queryFn: async () => {
      const url = `/api/work-orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&includeUnscheduled=true&limit=500`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch work orders");
      return res.json();
    },
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const dragOverCellRef = useRef<string | null>(null);

  const workOrdersQueryKey = ["/api/work-orders", dateRange.startDate, dateRange.endDate];
  
  const updateWorkOrderMutation = useMutation({
    mutationFn: async ({ id, resourceId, scheduledDate, scheduledStartTime }: { id: string; resourceId: string; scheduledDate: string; scheduledStartTime?: string }) => {
      const payload: Record<string, unknown> = { resourceId, scheduledDate, status: "scheduled" };
      if (scheduledStartTime) {
        payload.scheduledStartTime = scheduledStartTime;
      }
      const response = await apiRequest("PATCH", `/api/work-orders/${id}`, payload);
      return response;
    },
    onMutate: async ({ id, resourceId, scheduledDate }) => {
      await queryClient.cancelQueries({ queryKey: workOrdersQueryKey });
      const previousData = queryClient.getQueryData<WorkOrder[]>(workOrdersQueryKey);
      
      queryClient.setQueryData<WorkOrder[]>(workOrdersQueryKey, (old) => {
        if (!old) return old;
        return old.map(job => 
          job.id === id 
            ? { ...job, resourceId, scheduledDate: new Date(scheduledDate), status: "scheduled" as const }
            : job
        );
      });
      
      return { previousData };
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"], exact: false });
    },
  });

  const objectMap = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects]);
  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  
  const unscheduledJobs = useMemo(() => {
    const jobs = workOrders.filter(job => !job.scheduledDate || !job.resourceId);
    
    const filtered = jobs.filter(job => {
      if (filterCustomer !== "all" && job.customerId !== filterCustomer) return false;
      if (filterPriority !== "all" && job.priority !== filterPriority) return false;
      return true;
    });
    
    return filtered.sort((a, b) => {
      const aPriority = priorityOrder[a.priority] ?? 99;
      const bPriority = priorityOrder[b.priority] ?? 99;
      return aPriority - bPriority;
    });
  }, [workOrders, filterCustomer, filterPriority]);
  
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
    const map: Record<string, Record<string, WorkOrder[]>> = {};
    const hoursMap: Record<string, Record<string, number>> = {};
    
    for (const job of filteredScheduledJobs) {
      if (!job.resourceId || !job.scheduledDate) continue;
      const resourceId = job.resourceId;
      const dateStr = typeof job.scheduledDate === 'string' 
        ? job.scheduledDate 
        : (job.scheduledDate as Date).toISOString();
      const dayKey = dateStr.split("T")[0];
      
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

  const navigate = (direction: "prev" | "next") => {
    if (viewMode === "day") {
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
    if (viewMode === "day") {
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

  const handleDragStart = useCallback((e: React.DragEvent, jobId: string) => {
    e.dataTransfer.setData("jobId", jobId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, cellId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverCellRef.current !== cellId) {
      dragOverCellRef.current = cellId;
      setDragOverCell(cellId);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    dragOverCellRef.current = null;
    setDragOverCell(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, resourceId: string, day: Date, hour?: number) => {
    e.preventDefault();
    dragOverCellRef.current = null;
    setDragOverCell(null);
    
    const jobId = e.dataTransfer.getData("jobId");
    console.log("DROP: jobId =", jobId, "isPending =", updateWorkOrderMutation.isPending);
    if (!jobId) return;

    const job = workOrders.find(j => j.id === jobId);
    if (!job) {
      console.log("DROP: job not found");
      return;
    }

    const isSameResourceAndDay = job.resourceId === resourceId && 
      job.scheduledDate && isSameDay(new Date(job.scheduledDate), day);
    
    if (isSameResourceAndDay && !hour) {
      console.log("DROP: same resource and day, skipping");
      return;
    }

    const scheduledStartTime = hour !== undefined ? `${hour.toString().padStart(2, "0")}:00` : undefined;

    console.log("DROP: calling mutate for", jobId, "to", resourceId, format(day, "yyyy-MM-dd"));
    updateWorkOrderMutation.mutate({
      id: jobId,
      resourceId,
      scheduledDate: format(day, "yyyy-MM-dd"),
      scheduledStartTime,
    });
  }, [workOrders, updateWorkOrderMutation]);

  const isLoading = resourcesLoading || workOrdersLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderJobCard = (job: WorkOrder, compact = false) => {
    const obj = objectMap.get(job.objectId);
    return (
      <Card
        key={job.id}
        draggable
        onDragStart={(e) => handleDragStart(e, job.id)}
        className={`p-2 cursor-grab active:cursor-grabbing hover-elevate active-elevate-2 ${priorityColors[job.priority]} ${selectedJob === job.id ? "ring-2 ring-primary" : ""}`}
        onClick={() => handleJobClick(job.id)}
        data-testid={`job-card-${job.id}`}
      >
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate">{job.title}</div>
            <div className="text-xs text-muted-foreground truncate">{obj?.name || "Okänt objekt"}</div>
            {!compact && job.scheduledStartTime && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                <Clock className="h-3 w-3" />
                {job.scheduledStartTime}
              </div>
            )}
          </div>
          <Badge variant={statusBadgeVariant[job.status] || "outline"} className="text-[10px] shrink-0">
            {((job.estimatedDuration || 0) / 60).toFixed(1)}h
          </Badge>
        </div>
      </Card>
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
                const cellId = `${resource.id}-${hour}`;
                const isDragOver = dragOverCell === cellId;

                return (
                  <div
                    key={resource.id}
                    className={`p-2 border-r last:border-r-0 min-h-[60px] transition-colors ${isDragOver ? "bg-primary/10" : "bg-muted/20"}`}
                    onDragOver={(e) => handleDragOver(e, cellId)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, resource.id, day, hour)}
                    data-testid={`drop-zone-${resource.id}-${hour}`}
                  >
                    <div className="space-y-1">
                      {jobs.map((job) => renderJobCard(job))}
                    </div>
                  </div>
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
      <div className="min-w-[800px]">
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
              <div className="p-3 border-r flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">{resource.initials || resource.name.split(" ").map(n => n[0]).join("")}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{resource.name}</div>
                  <div className="text-xs text-muted-foreground">{resource.weeklyHours || 40}h/vecka</div>
                </div>
              </div>
              {visibleDates.map((day, dayIndex) => {
                const jobs = getJobsForResourceAndDay(resource.id, day);
                const dayHours = getResourceDayHours(resource.id, day);
                const isOverbooked = dayHours > HOURS_IN_DAY;
                const capacityPct = getCapacityPercentage(dayHours);
                const cellId = `${resource.id}-${dayIndex}`;
                const isDragOver = dragOverCell === cellId;

                return (
                  <div 
                    key={dayIndex} 
                    className={`p-2 border-r last:border-r-0 min-h-[120px] transition-colors ${isDragOver ? "bg-primary/10" : "bg-muted/30"}`}
                    onDragOver={(e) => handleDragOver(e, cellId)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, resource.id, day)}
                    data-testid={`drop-zone-${resource.id}-${format(day, "yyyy-MM-dd")}`}
                  >
                    <div className="flex items-center gap-1 mb-2">
                      <Progress value={capacityPct} className={`h-1.5 flex-1 ${isOverbooked ? "[&>div]:bg-orange-500" : ""}`} />
                      <span className={`text-[10px] ${isOverbooked ? "text-orange-600" : "text-muted-foreground"}`}>
                        {dayHours.toFixed(1)}h
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

  return (
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
                  const obj = objectMap.get(job.objectId);
                  const customer = customerMap.get(job.customerId);
                  return (
                    <Card
                      key={job.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, job.id)}
                      className={`p-3 cursor-grab active:cursor-grabbing hover-elevate active-elevate-2 ${priorityColors[job.priority]} ${selectedJob === job.id ? "ring-2 ring-primary" : ""}`}
                      onClick={() => handleJobClick(job.id)}
                      data-testid={`unscheduled-job-${job.id}`}
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-medium">{job.title}</div>
                        <div className="text-xs text-muted-foreground">{obj?.name || "Okänt objekt"}</div>
                        {customer && (
                          <div className="text-xs text-muted-foreground">{customer.name}</div>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                          <Badge variant="outline" className="text-[10px]">
                            {priorityLabels[job.priority] || job.priority}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {((job.estimatedDuration || 0) / 60).toFixed(1)}h
                          </Badge>
                        </div>
                      </div>
                    </Card>
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
        <div className="flex items-center justify-between gap-4 p-4 border-b flex-wrap">
          <div className="flex items-center gap-2">
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
            <span className="text-sm font-medium ml-2 capitalize" data-testid="text-date-label">
              {getHeaderLabel()}
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
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
            </ToggleGroup>
            <Button onClick={() => { onAddJob?.(); }} data-testid="button-add-job">
              <Plus className="h-4 w-4 mr-2" />
              Nytt jobb
            </Button>
          </div>
        </div>

        {viewMode === "day" && renderDayTimelineView()}
        {viewMode === "week" && renderWeekView()}
        {viewMode === "month" && renderMonthView()}

        <div className="p-3 border-t bg-muted/50 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-500 rounded-sm"></span>
              <span>Akut</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-orange-500 rounded-sm"></span>
              <span>Hög</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-blue-500 rounded-sm"></span>
              <span>Normal</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-gray-400 rounded-sm"></span>
              <span>Låg</span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {filteredScheduledJobs.length} schemalagda | {unscheduledJobs.length} oschemalagda | Dra jobb för att schemalägga
          </div>
        </div>
      </div>
    </div>
  );
}
