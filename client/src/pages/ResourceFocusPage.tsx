import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, Loader2, Calendar, Clock, MapPin, X, Maximize2 } from "lucide-react";
import { format, addDays, startOfWeek, isSameDay } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrderWithObject } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFocusedResource } from "@/hooks/useFocusedResource";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";

const HOURS_IN_DAY = 8;

const priorityDotColors: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

export default function ResourceFocusPage() {
  // Extract ID from URL path since we render outside Router
  const getResourceIdFromPath = () => {
    const match = window.location.pathname.match(/\/resource-focus\/(.+)/);
    return match ? match[1] : "";
  };
  const [resourceId] = useState(getResourceIdFromPath);
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const { toast } = useToast();
  const { focusResource, unfocusResource, onJobAssignment, notifyJobAssigned } = useFocusedResource();

  const { data: resource, isLoading: resourceLoading } = useQuery<Resource>({
    queryKey: ["/api/resources", resourceId],
    queryFn: async () => {
      const res = await fetch(`/api/resources/${resourceId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch resource");
      return res.json();
    },
    enabled: !!resourceId,
  });

  const dateRange = useMemo(() => {
    const startDate = format(currentWeekStart, "yyyy-MM-dd");
    const endDate = format(addDays(currentWeekStart, 6), "yyyy-MM-dd");
    return { startDate, endDate };
  }, [currentWeekStart]);

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders", dateRange.startDate, dateRange.endDate, resourceId],
    queryFn: async () => {
      const url = `/api/work-orders?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}&resourceId=${resourceId}&limit=200`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch work orders");
      return res.json();
    },
    enabled: !!resourceId,
    refetchInterval: 5000,
  });

  const workOrdersQueryKey = ["/api/work-orders", dateRange.startDate, dateRange.endDate, resourceId];

  const updateWorkOrderMutation = useMutation({
    mutationFn: async ({ id, resourceId: resId, scheduledDate }: { id: string; resourceId: string; scheduledDate: string }) => {
      const response = await apiRequest("PATCH", `/api/work-orders/${id}`, {
        resourceId: resId,
        scheduledDate,
        status: "scheduled",
        orderStatus: "planerad_resurs",
      });
      return response.json() as Promise<WorkOrderWithObject>;
    },
    onSuccess: (updatedWorkOrder, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      notifyJobAssigned(variables.id, variables.resourceId, true);
      toast({
        title: "Jobb tilldelat",
        description: `Jobbet har schemalagts till ${resource?.name || "resursen"}.`,
      });
    },
    onError: (error, variables) => {
      console.error("Assignment error:", error);
      notifyJobAssigned(variables.id, variables.resourceId, false);
      toast({
        title: "Fel",
        description: "Kunde inte tilldela jobbet.",
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({
        title: "Avschemalagt",
        description: "Jobbet flyttades tillbaka till oschemalagda.",
      });
    },
    onError: (error) => {
      console.error("Unschedule error:", error);
      toast({
        title: "Fel",
        description: "Kunde inte avschemalägg jobbet.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (resource) {
      focusResource(resource.id, resource.name);
      document.title = `${resource.name} - Unicorn Resurs`;
    }

    return () => {
      unfocusResource();
    };
  }, [resource, focusResource, unfocusResource]);

  useEffect(() => {
    return onJobAssignment((jobId, resId, _date) => {
      if (resId === resourceId) {
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      }
    });
  }, [resourceId, onJobAssignment]);

  const visibleDates = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => addDays(currentWeekStart, i));
  }, [currentWeekStart]);

  const jobsByDay = useMemo(() => {
    const map: Record<string, WorkOrderWithObject[]> = {};
    for (const job of workOrders) {
      if (!job.scheduledDate || job.resourceId !== resourceId) continue;
      const dateStr = typeof job.scheduledDate === "string"
        ? job.scheduledDate
        : (job.scheduledDate as Date).toISOString();
      const dayKey = dateStr.split("T")[0];
      if (!map[dayKey]) map[dayKey] = [];
      map[dayKey].push(job);
    }
    return map;
  }, [workOrders, resourceId]);

  const navigate = (direction: "prev" | "next") => {
    setCurrentWeekStart(prev => addDays(prev, direction === "next" ? 7 : -7));
  };

  const goToToday = () => {
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
  };

  if (!resourceId || resourceLoading || !resource) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalJobs = workOrders.filter(j => j.resourceId === resourceId).length;
  const totalHours = workOrders
    .filter(j => j.resourceId === resourceId)
    .reduce((sum, j) => sum + (j.estimatedDuration || 0) / 60, 0);

  return (
    <TooltipProvider>
      <div className="flex flex-col min-h-screen bg-background">
        <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-12 w-12">
                <AvatarFallback className="text-lg">
                  {resource.initials || resource.name.split(" ").map(n => n[0]).join("")}
                </AvatarFallback>
              </Avatar>
              <div>
                <h1 className="text-xl font-bold">{resource.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {resource.resourceType || "Fälttekniker"} • {resource.weeklyHours || 40}h/vecka
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-sm">
                <Calendar className="h-3.5 w-3.5 mr-1" />
                {totalJobs} jobb
              </Badge>
              <Badge variant="outline" className="text-sm">
                <Clock className="h-3.5 w-3.5 mr-1" />
                {totalHours.toFixed(1)}h
              </Badge>
              <ThemeToggle />
            </div>
          </div>
          
          <div className="flex items-center gap-2 px-4 pb-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={() => navigate("prev")} data-testid="button-prev-week">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Föregående vecka</TooltipContent>
            </Tooltip>
            <Button variant="outline" size="sm" onClick={goToToday} data-testid="button-today">
              Idag
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={() => navigate("next")} data-testid="button-next-week">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Nästa vecka</TooltipContent>
            </Tooltip>
            <span className="text-sm font-medium ml-2 capitalize">
              Vecka {format(currentWeekStart, "w", { locale: sv })} - {format(currentWeekStart, "MMMM yyyy", { locale: sv })}
            </span>
          </div>
        </header>

        <main className="flex-1 p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {visibleDates.map((day) => {
              const dayKey = format(day, "yyyy-MM-dd");
              const dayJobs = jobsByDay[dayKey] || [];
              const dayHours = dayJobs.reduce((sum, j) => sum + (j.estimatedDuration || 0) / 60, 0);
              const isToday = isSameDay(day, new Date());
              const capacityPct = Math.min((dayHours / HOURS_IN_DAY) * 100, 100);
              const isOverbooked = dayHours > HOURS_IN_DAY;

              return (
                <div key={dayKey} className="flex flex-col">
                  <div className={`p-3 rounded-t-md border border-b-0 ${isToday ? "bg-primary/10 border-primary" : "bg-muted/50"}`}>
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground uppercase">
                        {format(day, "EEE", { locale: sv })}
                      </div>
                      <div className={`text-2xl font-bold ${isToday ? "text-primary" : ""}`}>
                        {format(day, "d")}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Progress 
                        value={capacityPct} 
                        className={`h-2 flex-1 ${isOverbooked ? "[&>div]:bg-orange-500" : ""}`} 
                      />
                      <span className={`text-xs ${isOverbooked ? "text-orange-600" : "text-muted-foreground"}`}>
                        {dayHours.toFixed(1)}h
                      </span>
                    </div>
                  </div>

                  <ScrollArea className={`flex-1 min-h-[300px] border rounded-b-md p-2 ${isToday ? "border-primary" : ""}`}>
                    {dayJobs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-8">
                        <Calendar className="h-8 w-8 mb-2 opacity-50" />
                        <p className="text-sm">Inga jobb</p>
                        <p className="text-xs">Tilldela från huvudfönstret</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {dayJobs.map((job) => (
                          <Card 
                            key={job.id} 
                            className="hover-elevate group"
                            data-testid={`focus-job-${job.id}`}
                          >
                            <CardContent className="p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDotColors[job.priority]}`} />
                                    <span className="text-sm font-medium truncate">{job.title}</span>
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate mt-1">
                                    {job.objectName || "Okänt objekt"}
                                  </div>
                                  {job.objectAddress && (
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                      <MapPin className="h-3 w-3" />
                                      <span className="truncate">{job.objectAddress}</span>
                                    </div>
                                  )}
                                  {job.scheduledStartTime && (
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                      <Clock className="h-3 w-3" />
                                      {job.scheduledStartTime}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => unscheduleWorkOrderMutation.mutate(job.id)}
                                        data-testid={`button-unschedule-${job.id}`}
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Avschemalägg</TooltipContent>
                                  </Tooltip>
                                  <Badge variant="secondary" className="text-[10px]">
                                    {((job.estimatedDuration || 0) / 60).toFixed(1)}h
                                  </Badge>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              );
            })}
          </div>
        </main>

        <footer className="border-t p-3 bg-muted/50">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Maximize2 className="h-4 w-4" />
              <span>Resursfokus-vy - Tilldela jobb från huvudfönstret</span>
            </div>
            <div>
              Uppdateras automatiskt var 5:e sekund
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
