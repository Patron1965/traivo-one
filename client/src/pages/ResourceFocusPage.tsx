import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, Loader2, Calendar, Clock, MapPin, X } from "lucide-react";
import { format, addDays, startOfWeek } from "date-fns";
import { sv } from "date-fns/locale";
import type { Resource, WorkOrderWithObject } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/ThemeToggle";

const HOURS_IN_DAY = 8;
const CHANNEL_NAME = "unicorn-resource-focus";
const STORAGE_KEY = "unicorn-focused-resource";

const priorityDotColors: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

export default function ResourceFocusPage() {
  // Extract ID from URL path
  const [resourceId] = useState(() => {
    const match = window.location.pathname.match(/\/resource-focus\/(.+)/);
    return match ? match[1] : "";
  });
  
  const [currentWeekStart, setCurrentWeekStart] = useState(() => 
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  
  const { toast } = useToast();
  const channelRef = useRef<BroadcastChannel | null>(null);
  const windowIdRef = useRef(Math.random().toString(36).substring(7));

  // Setup BroadcastChannel for cross-window communication
  useEffect(() => {
    if (typeof BroadcastChannel !== "undefined") {
      channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    }
    return () => {
      channelRef.current?.close();
    };
  }, []);

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

  const { data: workOrders = [] } = useQuery<WorkOrderWithObject[]>({
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

  // Broadcast focus state when resource loads
  useEffect(() => {
    if (resource && channelRef.current) {
      const message = {
        type: "focus-resource",
        resourceId: resource.id,
        resourceName: resource.name,
        windowId: windowIdRef.current,
      };
      channelRef.current.postMessage(message);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        resourceId: resource.id,
        resourceName: resource.name,
        windowId: windowIdRef.current,
      }));
      document.title = `${resource.name} - Unicorn Resurs`;
    }

    return () => {
      if (channelRef.current) {
        channelRef.current.postMessage({
          type: "unfocus-resource",
          windowId: windowIdRef.current,
        });
      }
      localStorage.removeItem(STORAGE_KEY);
    };
  }, [resource]);

  // Listen for job assignments from other windows
  useEffect(() => {
    if (!channelRef.current) return;
    
    const handler = (event: MessageEvent) => {
      if (event.data.type === "assign-job" && event.data.resourceId === resourceId) {
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      }
    };
    
    channelRef.current.addEventListener("message", handler);
    return () => channelRef.current?.removeEventListener("message", handler);
  }, [resourceId]);

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
        </header>

        <div className="flex items-center justify-between gap-4 p-4 border-b">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => navigate("prev")}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToToday}>
              Idag
            </Button>
            <Button variant="outline" size="icon" onClick={() => navigate("next")}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <span className="text-sm font-medium">
            {format(currentWeekStart, "d MMM", { locale: sv })} - {format(addDays(currentWeekStart, 4), "d MMM yyyy", { locale: sv })}
          </span>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-5 gap-4">
            {visibleDates.map(date => {
              const dateKey = format(date, "yyyy-MM-dd");
              const dayJobs = jobsByDay[dateKey] || [];
              const dayMinutes = dayJobs.reduce((sum, j) => sum + (j.estimatedDuration || 0), 0);
              const dayHours = dayMinutes / 60;
              const utilization = Math.min((dayHours / HOURS_IN_DAY) * 100, 100);
              const isToday = format(new Date(), "yyyy-MM-dd") === dateKey;

              return (
                <Card key={dateKey} className={isToday ? "ring-2 ring-primary" : ""}>
                  <div className="p-3 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium capitalize">
                          {format(date, "EEEE", { locale: sv })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(date, "d MMM", { locale: sv })}
                        </p>
                      </div>
                      <Badge variant={utilization > 100 ? "destructive" : utilization > 80 ? "secondary" : "outline"} className="text-xs">
                        {dayHours.toFixed(1)}h
                      </Badge>
                    </div>
                    <Progress value={utilization} className="h-1 mt-2" />
                  </div>
                  <ScrollArea className="h-[calc(100vh-280px)]">
                    <div className="p-2 space-y-2">
                      {dayJobs.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">
                          Inga jobb
                        </p>
                      ) : (
                        dayJobs.map(job => (
                          <Card key={job.id} className="p-2 group">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <div className={`h-2 w-2 rounded-full ${priorityDotColors[job.priority || "normal"]}`} />
                                  <p className="text-sm font-medium truncate">{job.title}</p>
                                </div>
                                {job.objectAddress && (
                                  <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                    <MapPin className="h-3 w-3" />
                                    <span className="truncate">{job.objectAddress}</span>
                                  </div>
                                )}
                                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  <span>{job.estimatedDuration || 0} min</span>
                                </div>
                              </div>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => unscheduleWorkOrderMutation.mutate(job.id)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Ta bort från schema</TooltipContent>
                              </Tooltip>
                            </div>
                          </Card>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
