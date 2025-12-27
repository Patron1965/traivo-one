import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  MapPin, Play, CheckCircle, ArrowLeft,
  Loader2, AlertTriangle, Navigation, Phone,
  HelpCircle, Clock, Trash2, Ban, MapPinOff, Timer, Bell
} from "lucide-react";
import { startOfDay, endOfDay, format } from "date-fns";
import { sv } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import { FieldAIAssistant } from "@/components/FieldAIAssistant";
import { PhotoCapture } from "@/components/PhotoCapture";
import type { WorkOrderWithObject, Customer } from "@shared/schema";

type View = "jobs" | "job";

interface SimpleFieldAppProps {
  resourceId?: string;
}

export function SimpleFieldApp({ resourceId }: SimpleFieldAppProps) {
  const { toast } = useToast();
  const [view, setView] = useState<View>("jobs");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobStarted, setJobStarted] = useState(false);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [showProblemPanel, setShowProblemPanel] = useState(false);

  const handleNotificationRef = useRef<((notification: Notification) => void) | null>(null);
  
  handleNotificationRef.current = (notification: Notification) => {
    const iconMap: Record<string, "default" | "destructive"> = {
      job_assigned: "default",
      job_updated: "default", 
      schedule_changed: "default",
      priority_changed: "default",
      job_cancelled: "destructive",
    };
    
    toast({
      title: notification.title,
      description: notification.message,
      variant: iconMap[notification.type] || "default",
    });

    queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });

    if ("vibrate" in navigator) {
      navigator.vibrate(200);
    }
  };

  const handleNotification = useCallback((notification: Notification) => {
    handleNotificationRef.current?.(notification);
  }, []);

  const { notifications, unreadCount, isConnected } = useNotifications({
    resourceId: resourceId || "",
    onNotification: handleNotification,
    autoConnect: !!resourceId,
  });

  useEffect(() => {
    if (jobStarted && startTime) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTime.getTime()) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [jobStarted, startTime]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const { data: workOrders = [], isLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const objectIdsNeeded = useMemo(() => {
    const today = new Date();
    const todayStart = startOfDay(today);
    const todayEnd = endOfDay(today);
    return workOrders
      .filter(wo => {
        if (!wo.scheduledDate) return false;
        if (resourceId && wo.resourceId !== resourceId) return false;
        const scheduled = new Date(wo.scheduledDate);
        return scheduled >= todayStart && scheduled <= todayEnd;
      })
      .map(wo => wo.objectId)
      .filter(Boolean);
  }, [workOrders, resourceId]);

  const { data: objects = [] } = useObjectsByIds(objectIdsNeeded);
  const objectMap = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects]);
  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  const today = new Date();
  const todayStart = startOfDay(today);
  const todayEnd = endOfDay(today);

  const todayJobs = workOrders.filter(wo => {
    if (!wo.scheduledDate) return false;
    if (resourceId && wo.resourceId !== resourceId) return false;
    const scheduled = new Date(wo.scheduledDate);
    return scheduled >= todayStart && scheduled <= todayEnd && wo.status !== "completed";
  }).sort((a, b) => {
    const timeA = a.scheduledStartTime || "00:00";
    const timeB = b.scheduledStartTime || "00:00";
    return timeA.localeCompare(timeB);
  });

  const completedCount = workOrders.filter(wo => {
    if (!wo.scheduledDate) return false;
    if (resourceId && wo.resourceId !== resourceId) return false;
    const scheduled = new Date(wo.scheduledDate);
    return scheduled >= todayStart && scheduled <= todayEnd && wo.status === "completed";
  }).length;

  const selectedJob = selectedJobId ? workOrders.find(wo => wo.id === selectedJobId) : null;
  const selectedObject = selectedJob ? objectMap.get(selectedJob.objectId) : null;
  const selectedCustomer = selectedJob ? customerMap.get(selectedJob.customerId) : null;

  const completeJobMutation = useMutation({
    mutationFn: async (id: string) => {
      const elapsed = Math.ceil(elapsedSeconds / 60);
      await apiRequest("PATCH", `/api/work-orders/${id}`, {
        status: "completed",
        completedAt: new Date().toISOString(),
        actualDuration: elapsed,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: "Klart!", description: "Jobbet markerat som slutfört." });
      setJobStarted(false);
      setStartTime(null);
      setElapsedSeconds(0);
      setView("jobs");
      setSelectedJobId(null);
    },
  });

  const handleSelectJob = (jobId: string) => {
    setSelectedJobId(jobId);
    setView("job");
    setShowAiPanel(false);
    setShowProblemPanel(false);
  };

  const handleStartJob = () => {
    setJobStarted(true);
    setStartTime(new Date());
    setElapsedSeconds(0);
  };

  const handleBack = () => {
    setView("jobs");
    setSelectedJobId(null);
    setJobStarted(false);
    setStartTime(null);
    setShowAiPanel(false);
    setShowProblemPanel(false);
  };

  const reportProblem = (problemType: string) => {
    toast({ title: "Rapporterat", description: `Problem: ${problemType}` });
    setShowProblemPanel(false);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-lg text-muted-foreground">Laddar schema...</p>
      </div>
    );
  }

  if (view === "job" && selectedJob) {
    const accessInfo = (selectedObject?.accessInfo || {}) as {
      gateCode?: string;
      keyLocation?: string;
      parking?: string;
      specialInstructions?: string;
    };

    return (
      <div className="flex flex-col h-full bg-background">
        <FieldAIAssistant 
          isOpen={showAiPanel}
          onClose={() => setShowAiPanel(false)}
          jobContext={{
            jobTitle: selectedJob.title,
            objectName: selectedJob.objectName ?? undefined,
            objectAddress: selectedJob.objectAddress ?? undefined,
            accessInfo: (selectedObject?.accessInfo as { gateCode?: string; keyLocation?: string; parking?: string; specialInstructions?: string } | undefined),
          }}
        />
        
        <div className="flex items-center gap-3 p-4 border-b bg-card">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleBack}
            data-testid="button-back-from-job"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">{selectedJob.title}</h1>
            <p className="text-sm text-muted-foreground truncate">{selectedJob.objectName}</p>
          </div>
          {jobStarted && (
            <Badge variant="secondary" className="font-mono text-base gap-1">
              <Timer className="h-4 w-4" />
              {formatTime(elapsedSeconds)}
            </Badge>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {selectedJob.objectAddress && (
              <Button
                variant="outline"
                className="h-auto py-3 flex-col gap-1"
                onClick={() => window.open(`https://maps.google.com?q=${encodeURIComponent(selectedJob.objectAddress + ", " + (selectedObject?.city || ""))}`)}
                data-testid="button-navigate"
              >
                <Navigation className="h-5 w-5 text-blue-500" />
                <span className="text-xs">Navigera</span>
              </Button>
            )}
            {selectedCustomer?.phone && (
              <Button
                variant="outline"
                className="h-auto py-3 flex-col gap-1"
                onClick={() => window.open(`tel:${selectedCustomer.phone}`)}
                data-testid="button-call"
              >
                <Phone className="h-5 w-5 text-green-500" />
                <span className="text-xs">Ring kund</span>
              </Button>
            )}
            <Button
              variant="outline"
              className="h-auto py-3 flex-col gap-1"
              onClick={() => {
                setShowAiPanel(!showAiPanel);
                setShowProblemPanel(false);
              }}
              data-testid="button-ask-ai"
            >
              <HelpCircle className="h-5 w-5 text-purple-500" />
              <span className="text-xs">AI-hjälp</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-3 flex-col gap-1"
              onClick={() => {
                setShowProblemPanel(!showProblemPanel);
                setShowAiPanel(false);
              }}
              data-testid="button-report-problem"
            >
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <span className="text-xs">Problem</span>
            </Button>
          </div>


          {showProblemPanel && (
            <Card className="border-orange-200 dark:border-orange-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  Rapportera problem
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { icon: Trash2, text: "Trasigt kärl", color: "text-orange-500" },
                    { icon: Ban, text: "Kommer ej åt", color: "text-red-500" },
                    { icon: MapPinOff, text: "Fel adress", color: "text-yellow-600" },
                    { icon: Clock, text: "Ingen tid", color: "text-blue-500" },
                  ].map((problem, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      className="h-auto py-3 flex-col gap-1"
                      onClick={() => reportProblem(problem.text)}
                      data-testid={`button-problem-${i}`}
                    >
                      <problem.icon className={`h-5 w-5 ${problem.color}`} />
                      <span className="text-xs">{problem.text}</span>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <PhotoCapture 
            workOrderId={selectedJob.id}
            existingPhotos={(selectedJob.metadata as { photos?: string[] } | null)?.photos || []}
            onPhotosChange={async (photos) => {
              try {
                await apiRequest("PATCH", `/api/work-orders/${selectedJob.id}`, {
                  metadata: { ...(selectedJob.metadata as object || {}), photos }
                });
                queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
              } catch (error) {
                console.error("Failed to save photos:", error);
              }
            }}
          />

          {accessInfo.gateCode && (
            <Card className="border-green-200 dark:border-green-800">
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Portkod</p>
                <p className="text-3xl font-mono font-bold text-center mt-1">{accessInfo.gateCode}</p>
              </CardContent>
            </Card>
          )}

          {accessInfo.specialInstructions && (
            <Card className="border-yellow-200 dark:border-yellow-800">
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Viktig info</p>
                <p className="text-sm">{accessInfo.specialInstructions}</p>
              </CardContent>
            </Card>
          )}

          {selectedJob.objectAddress && (
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Adress</p>
                <p className="text-sm">{selectedJob.objectAddress}</p>
                {selectedObject?.city && (
                  <p className="text-sm text-muted-foreground">{selectedObject.city}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="p-4 border-t bg-card">
          {!jobStarted ? (
            <Button
              size="mobile"
              className="w-full gap-2"
              onClick={handleStartJob}
              data-testid="button-start-job"
            >
              <Play className="h-5 w-5" />
              Starta jobb
            </Button>
          ) : (
            <Button
              size="mobile"
              className="w-full gap-2 bg-green-600"
              onClick={() => completeJobMutation.mutate(selectedJob.id)}
              disabled={completeJobMutation.isPending}
              data-testid="button-complete-job"
            >
              {completeJobMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle className="h-5 w-5" />
              )}
              Slutför
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-4 border-b bg-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Dagens schema</h1>
            <p className="text-sm text-muted-foreground">
              {format(today, "EEEE d MMMM", { locale: sv })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {resourceId && (
              <Badge 
                variant={isConnected ? "outline" : "destructive"} 
                className={isConnected ? "text-green-600" : ""}
                data-testid="badge-connection-status"
              >
                <Bell className="h-3 w-3 mr-1" />
                {isConnected ? (unreadCount > 0 ? unreadCount : "Live") : "Offline"}
              </Badge>
            )}
            <Badge variant="secondary">{todayJobs.length} kvar</Badge>
            <Badge variant="outline" className="text-green-600">{completedCount} klara</Badge>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setShowAiPanel(true)}
              data-testid="button-open-ai-assistant"
            >
              <HelpCircle className="h-5 w-5 text-purple-500" />
            </Button>
          </div>
        </div>
      </div>

      <FieldAIAssistant 
        isOpen={showAiPanel}
        onClose={() => setShowAiPanel(false)}
        jobContext={selectedJob ? {
          jobTitle: selectedJob.title,
          objectName: selectedJob.objectName ?? undefined,
          objectAddress: selectedJob.objectAddress ?? undefined,
          accessInfo: (selectedObject?.accessInfo as { gateCode?: string; keyLocation?: string; parking?: string; specialInstructions?: string } | undefined),
        } : undefined}
      />

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {todayJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
            <CheckCircle className="h-16 w-16 text-green-500" />
            <div>
              <p className="text-xl font-semibold">Alla jobb klara!</p>
              <p className="text-muted-foreground">Bra jobbat idag</p>
            </div>
          </div>
        ) : (
          todayJobs.map((job, index) => (
            <Card 
              key={job.id}
              className="hover-elevate active-elevate-2 cursor-pointer"
              onClick={() => handleSelectJob(job.id)}
              data-testid={`button-job-${job.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{job.title}</p>
                      {job.scheduledStartTime && (
                        <Badge variant="outline" className="shrink-0 text-xs">
                          <Clock className="h-3 w-3 mr-1" />
                          {job.scheduledStartTime}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{job.objectAddress || job.objectName}</span>
                    </div>
                    {job.estimatedDuration && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Beräknad tid: {job.estimatedDuration} min
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="p-4 border-t bg-card">
        <Button
          variant="outline"
          className="w-full h-12 gap-2"
          onClick={() => setShowAiPanel(!showAiPanel)}
          data-testid="button-ask-ai-general"
        >
          <HelpCircle className="h-5 w-5 text-purple-500" />
          {showAiPanel ? "Visa jobb" : "Fråga AI om hjälp"}
        </Button>
      </div>
    </div>
  );
}
