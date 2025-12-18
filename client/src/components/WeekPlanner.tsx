import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChevronLeft, ChevronRight, Plus, AlertTriangle, Loader2, CalendarDays, Calendar, CalendarRange } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { format, addDays, startOfWeek, startOfMonth, endOfMonth, isSameDay, isSameMonth, getDaysInMonth, addMonths } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrder, ServiceObject } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const priorityColors: Record<string, string> = {
  urgent: "border-l-4 border-l-red-500",
  high: "border-l-4 border-l-orange-500",
  normal: "border-l-4 border-l-blue-500",
  low: "border-l-4 border-l-gray-400",
};

const statusBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  scheduled: "default",
  draft: "outline",
  in_progress: "secondary",
};

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
  const { toast } = useToast();

  const getVisibleDates = (): Date[] => {
    if (viewMode === "day") {
      return [currentDate];
    } else if (viewMode === "week") {
      return Array.from({ length: 5 }, (_, i) => addDays(currentWeekStart, i));
    } else {
      const monthStart = startOfMonth(currentDate);
      const daysInMonth = getDaysInMonth(currentDate);
      return Array.from({ length: daysInMonth }, (_, i) => addDays(monthStart, i));
    }
  };

  const visibleDates = getVisibleDates();
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(currentWeekStart, i));

  const { data: resources = [], isLoading: resourcesLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const updateWorkOrderMutation = useMutation({
    mutationFn: async ({ id, resourceId, scheduledDate }: { id: string; resourceId: string; scheduledDate: string }) => {
      return apiRequest("PATCH", `/api/work-orders/${id}`, { resourceId, scheduledDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({
        title: "Jobb flyttat",
        description: "Jobbet har schemalagts om.",
      });
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte flytta jobbet.",
        variant: "destructive",
      });
    },
  });

  const objectMap = new Map(objects.map(o => [o.id, o]));

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

  const getHeaderLabel = () => {
    if (viewMode === "day") {
      return format(currentDate, "EEEE d MMMM yyyy", { locale: sv });
    } else if (viewMode === "week") {
      return `Vecka ${format(currentWeekStart, "w", { locale: sv })} - ${format(currentWeekStart, "MMMM yyyy", { locale: sv })}`;
    } else {
      return format(currentDate, "MMMM yyyy", { locale: sv });
    }
  };

  const getJobsForResourceAndDay = (resourceId: string, day: Date) => {
    return workOrders.filter(job => {
      if (job.resourceId !== resourceId || !job.scheduledDate) return false;
      return isSameDay(new Date(job.scheduledDate), day);
    });
  };

  const getResourceDayHours = (resourceId: string, day: Date) => {
    const jobs = getJobsForResourceAndDay(resourceId, day);
    return jobs.reduce((total, job) => total + (job.estimatedDuration || 0) / 60, 0);
  };

  const handleJobClick = (jobId: string) => {
    setSelectedJob(jobId);
    onSelectJob?.(jobId);
  };

  const handleDragStart = (e: React.DragEvent, jobId: string) => {
    e.dataTransfer.setData("jobId", jobId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, cellId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCell(cellId);
  };

  const handleDragLeave = () => {
    setDragOverCell(null);
  };

  const handleDrop = (e: React.DragEvent, resourceId: string, day: Date) => {
    e.preventDefault();
    setDragOverCell(null);
    
    const jobId = e.dataTransfer.getData("jobId");
    if (!jobId) return;

    const job = workOrders.find(j => j.id === jobId);
    if (!job) return;

    const isSameResourceAndDay = job.resourceId === resourceId && 
      job.scheduledDate && isSameDay(new Date(job.scheduledDate), day);
    
    if (isSameResourceAndDay) return;

    updateWorkOrderMutation.mutate({
      id: jobId,
      resourceId,
      scheduledDate: format(day, "yyyy-MM-dd"),
    });
  };

  const isLoading = resourcesLoading || workOrdersLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-4 p-4 border-b flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => navigate("prev")} data-testid="button-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday} data-testid="button-today">
            Idag
          </Button>
          <Button variant="outline" size="icon" onClick={() => navigate("next")} data-testid="button-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium ml-2 capitalize" data-testid="text-date-label">
            {getHeaderLabel()}
          </span>
        </div>
        <div className="flex items-center gap-3">
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

      {viewMode === "month" ? (
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
                const dayJobs = workOrders.filter(j => j.scheduledDate && isSameDay(new Date(j.scheduledDate), day));
                const isToday = isSameDay(day, new Date());
                
                cells.push(
                  <div 
                    key={d} 
                    className={`min-h-[80px] p-2 rounded-md border ${isToday ? "border-primary bg-primary/5" : "border-border bg-muted/30"}`}
                  >
                    <div className={`text-sm font-medium mb-1 ${isToday ? "text-primary" : ""}`}>{d}</div>
                    {dayJobs.length > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        {dayJobs.length} jobb
                      </Badge>
                    )}
                  </div>
                );
              }
              
              return cells;
            })()}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className={`${viewMode === "day" ? "min-w-[400px]" : "min-w-[800px]"}`}>
            <div className={`grid ${viewMode === "day" ? "grid-cols-[200px_1fr]" : "grid-cols-[200px_repeat(5,1fr)]"} border-b sticky top-0 bg-background z-10`}>
              <div className="p-3 font-medium text-sm text-muted-foreground border-r">Resurser</div>
              {visibleDates.map((day, i) => (
                <div key={i} className="p-3 text-center border-r last:border-r-0">
                  <div className="text-xs text-muted-foreground uppercase">{format(day, "EEE", { locale: sv })}</div>
                  <div className="text-lg font-semibold">{format(day, "d")}</div>
                </div>
              ))}
            </div>

            {resources.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                Inga resurser registrerade. Lägg till resurser för att börja planera.
              </div>
            ) : (
              resources.map((resource) => (
                <div key={resource.id} className={`grid ${viewMode === "day" ? "grid-cols-[200px_1fr]" : "grid-cols-[200px_repeat(5,1fr)]"} border-b`}>
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
                    const isOverbooked = dayHours > 8;
                    const cellId = `${resource.id}-${dayIndex}`;
                    const isDragOver = dragOverCell === cellId;

                    return (
                      <div 
                        key={dayIndex} 
                        className={`p-2 border-r last:border-r-0 ${viewMode === "day" ? "min-h-[200px]" : "min-h-[120px]"} transition-colors ${
                          isDragOver ? "bg-primary/10" : "bg-muted/30"
                        }`}
                        onDragOver={(e) => handleDragOver(e, cellId)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, resource.id, day)}
                        data-testid={`drop-zone-${resource.id}-${format(day, "yyyy-MM-dd")}`}
                      >
                        {isOverbooked && (
                          <div className="flex items-center gap-1 text-xs text-orange-600 mb-1">
                            <AlertTriangle className="h-3 w-3" />
                            <span>{dayHours.toFixed(1)}h (överbokning)</span>
                          </div>
                        )}
                        <div className="space-y-1">
                          {jobs.map((job) => {
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
                                  </div>
                                  <Badge variant={statusBadgeVariant[job.status] || "outline"} className="text-[10px] shrink-0">
                                    {((job.estimatedDuration || 0) / 60).toFixed(1)}h
                                  </Badge>
                                </div>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}

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
          {workOrders.length} jobb totalt | Dra jobb för att flytta
        </div>
      </div>
    </div>
  );
}
