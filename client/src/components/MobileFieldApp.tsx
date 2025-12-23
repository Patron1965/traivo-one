import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { 
  MapPin, Clock, Phone, Navigation, Key, Car, Info, 
  Play, CheckCircle, Camera, ArrowLeft, ChevronRight, Loader2, Pause, Timer, Square, Bell, HelpCircle
} from "lucide-react";
import { startOfDay, endOfDay } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import { FieldAIAssistant } from "@/components/FieldAIAssistant";
import type { WorkOrderWithObject, ServiceObject, Customer } from "@shared/schema";

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

type View = "list" | "detail" | "completion";

interface MobileFieldAppProps {
  initialView?: View;
  resourceId?: string;
}

export function MobileFieldApp({ initialView = "list", resourceId }: MobileFieldAppProps) {
  const { toast } = useToast();
  const [view, setView] = useState<View>(initialView);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobStarted, setJobStarted] = useState(false);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [completionData, setCompletionData] = useState({
    setupTime: "",
    setupReason: "",
    notes: "",
  });

  const handleNotification = useCallback((notification: Notification) => {
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
  }, [toast]);

  const { notifications, unreadCount, isConnected } = useNotifications({
    resourceId: resourceId || "",
    onNotification: handleNotification,
    autoConnect: !!resourceId,
  });
  
  // Timer effect - uppdaterar varje sekund när jobb är startat
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
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [jobStarted, startTime]);
  
  // Formatera tid som MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  // Endast hämta objekt som refereras i dagens arbetsordrar (för accessInfo)
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
    return scheduled >= todayStart && scheduled <= todayEnd;
  }).sort((a, b) => {
    const timeA = a.scheduledStartTime || "00:00";
    const timeB = b.scheduledStartTime || "00:00";
    return timeA.localeCompare(timeB);
  });

  const selectedJob = selectedJobId ? workOrders.find(wo => wo.id === selectedJobId) : null;
  const selectedObject = selectedJob ? objectMap.get(selectedJob.objectId) : null;
  const selectedCustomer = selectedJob ? customerMap.get(selectedJob.customerId) : null;

  const completeJobMutation = useMutation({
    mutationFn: async (data: { id: string; setupTime: number; setupReason: string; notes: string }) => {
      await apiRequest("PATCH", `/api/work-orders/${data.id}`, {
        status: "completed",
        completedAt: new Date().toISOString(),
        notes: data.notes,
      });
      
      if (data.setupTime > 0) {
        const job = workOrders.find(wo => wo.id === data.id);
        if (job) {
          await apiRequest("POST", "/api/setup-time-logs", {
            workOrderId: data.id,
            objectId: job.objectId,
            resourceId: job.resourceId || null,
            category: data.setupReason || "other",
            durationMinutes: data.setupTime,
            notes: data.notes,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/setup-time-logs"] });
      toast({ title: "Jobb slutfört", description: "Arbetsordern har markerats som slutförd." });
      setJobStarted(false);
      setStartTime(null);
      setElapsedSeconds(0);
      setView("list");
      setSelectedJobId(null);
      setCompletionData({ setupTime: "", setupReason: "", notes: "" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte slutföra jobbet.", variant: "destructive" });
    },
  });

  const handleSelectJob = (jobId: string) => {
    setSelectedJobId(jobId);
    setView("detail");
  };

  const handleStartJob = () => {
    setJobStarted(true);
    setStartTime(new Date());
    setElapsedSeconds(0);
  };

  const handleCompleteJob = () => {
    // Beräkna automatisk tid från timer
    const elapsedMinutes = Math.ceil(elapsedSeconds / 60);
    setCompletionData(prev => ({
      ...prev,
      setupTime: elapsedMinutes.toString(),
    }));
    setView("completion");
  };

  const handleSubmitCompletion = () => {
    if (!selectedJobId) return;
    completeJobMutation.mutate({
      id: selectedJobId,
      setupTime: parseInt(completionData.setupTime) || 0,
      setupReason: completionData.setupReason,
      notes: completionData.notes,
    });
  };

  const isLoading = workOrdersLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (view === "list") {
    return (
      <div className="flex flex-col h-full bg-background">
        <FieldAIAssistant 
          isOpen={showAiPanel}
          onClose={() => setShowAiPanel(false)}
          jobContext={selectedJob ? {
            jobTitle: selectedJob.title,
            objectName: selectedJob.objectName,
            objectAddress: selectedJob.objectAddress,
            accessInfo: selectedObject?.accessInfo,
          } : undefined}
        />
        
        <div className="p-4 border-b">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-semibold">Dagens jobb</h1>
              <p className="text-sm text-muted-foreground">{todayJobs.length} jobb planerade</p>
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
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {todayJobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Inga jobb schemalagda för idag
            </div>
          ) : (
            todayJobs.map((job) => {
              const obj = objectMap.get(job.objectId);
              return (
                <Card 
                  key={job.id} 
                  className="hover-elevate active-elevate-2 cursor-pointer"
                  onClick={() => handleSelectJob(job.id)}
                  data-testid={`mobile-job-${job.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-1 h-full min-h-[60px] rounded-full ${priorityColors[job.priority]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <h3 className="font-medium text-sm truncate">{job.title}</h3>
                          <Badge variant="outline" className="shrink-0">{job.scheduledStartTime || "TBD"}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{job.objectName || "Okänt objekt"}</p>
                        {job.objectAddress && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            <span className="truncate">{job.objectAddress}{obj?.city ? `, ${obj.city}` : ""}</span>
                          </div>
                        )}
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    );
  }

  if (view === "completion" && selectedJob) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="p-4 border-b flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setView("detail")} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">Slutför jobb</h1>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-6">
          <div>
            <h2 className="text-sm font-medium mb-2">{selectedJob.title}</h2>
            <p className="text-sm text-muted-foreground">{selectedJob.objectName || "Okänt objekt"}</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Ställtid (minuter)</label>
                {startTime && (
                  <Badge variant="secondary" className="text-xs">
                    <Timer className="h-3 w-3 mr-1" />
                    Automatiskt uppmätt
                  </Badge>
                )}
              </div>
              <Input 
                type="number"
                placeholder="0"
                value={completionData.setupTime}
                onChange={(e) => setCompletionData({...completionData, setupTime: e.target.value})}
                data-testid="input-setup-time"
              />
              {startTime && (
                <p className="text-xs text-muted-foreground">
                  Tiden mättes automatiskt från när du startade jobbet. Du kan justera om det behövs.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Orsak till ställtid</label>
              <Select 
                value={completionData.setupReason} 
                onValueChange={(v) => setCompletionData({...completionData, setupReason: v})}
              >
                <SelectTrigger data-testid="select-setup-reason">
                  <SelectValue placeholder="Välj orsak" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gate_access">Grindåtkomst</SelectItem>
                  <SelectItem value="parking">Parkering</SelectItem>
                  <SelectItem value="waiting_customer">Väntan på kund</SelectItem>
                  <SelectItem value="key_issue">Nyckelproblem</SelectItem>
                  <SelectItem value="other">Övrigt</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Anteckningar</label>
              <Textarea 
                placeholder="Beskriv utfört arbete..."
                value={completionData.notes}
                onChange={(e) => setCompletionData({...completionData, notes: e.target.value})}
                className="min-h-[100px]"
                data-testid="input-notes"
              />
            </div>

            <Button variant="outline" className="w-full" data-testid="button-add-photo">
              <Camera className="h-4 w-4 mr-2" />
              Lägg till foto
            </Button>
          </div>
        </div>
        <div className="p-4 border-t">
          <Button 
            size="mobile"
            className="w-full" 
            onClick={handleSubmitCompletion} 
            disabled={completeJobMutation.isPending}
            data-testid="button-submit-completion"
          >
            {completeJobMutation.isPending ? (
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="h-5 w-5 mr-2" />
            )}
            Slutför jobb
          </Button>
        </div>
      </div>
    );
  }

  if (!selectedJob) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Inget jobb valt</p>
      </div>
    );
  }

  const accessInfo = (selectedObject?.accessInfo || {}) as {
    gateCode?: string;
    keyLocation?: string;
    parking?: string;
    specialInstructions?: string;
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-4 border-b flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => { setView("list"); setSelectedJobId(null); }} data-testid="button-back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold truncate">{selectedJob.title}</h1>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-4 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{selectedJob.objectName || "Okänt objekt"}</h2>
                <Badge>{selectedJob.scheduledStartTime || "TBD"}</Badge>
              </div>
              
              {selectedJob.objectAddress && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span>{selectedJob.objectAddress}{selectedObject?.city ? `, ${selectedObject.city}` : ""}</span>
                </div>
              )}

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Beräknad tid: {selectedJob.estimatedDuration || 0} min</span>
              </div>

              <div className="flex gap-2">
                {selectedCustomer?.phone && (
                  <Button 
                    variant="outline" 
                    className="flex-1"
                    onClick={() => window.open(`tel:${selectedCustomer.phone}`)}
                    data-testid="button-call"
                  >
                    <Phone className="h-4 w-4 mr-2" />
                    Ring
                  </Button>
                )}
                {selectedObject?.address && (
                  <Button 
                    variant="outline" 
                    className="flex-1"
                    onClick={() => window.open(`https://maps.google.com?q=${encodeURIComponent(selectedObject.address + ", " + selectedObject.city)}`)}
                    data-testid="button-navigate"
                  >
                    <Navigation className="h-4 w-4 mr-2" />
                    Navigera
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <Key className="h-4 w-4" />
                Åtkomstinformation
              </h3>
              <div className="space-y-3">
                {accessInfo.gateCode && (
                  <div className="flex items-center justify-between p-3 bg-muted rounded-md">
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Grindkod</span>
                    </div>
                    <span className="font-mono text-lg font-semibold">{accessInfo.gateCode}</span>
                  </div>
                )}
                {accessInfo.parking && (
                  <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
                    <Car className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm">{accessInfo.parking}</span>
                  </div>
                )}
                {accessInfo.keyLocation && (
                  <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
                    <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm">{accessInfo.keyLocation}</span>
                  </div>
                )}
                {accessInfo.specialInstructions && (
                  <div className="p-3 bg-orange-100 dark:bg-orange-950 border border-orange-300 dark:border-orange-800 rounded-md">
                    <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300">
                      <Info className="h-4 w-4 shrink-0" />
                      <span className="text-sm font-medium">{accessInfo.specialInstructions}</span>
                    </div>
                  </div>
                )}
                {!accessInfo.gateCode && !accessInfo.parking && !accessInfo.keyLocation && !accessInfo.specialInstructions && (
                  <p className="text-sm text-muted-foreground">Ingen åtkomstinformation registrerad</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="p-4 border-t space-y-3">
        {jobStarted && (
          <div className="flex items-center justify-center gap-3 p-3 bg-muted rounded-md">
            <Timer className="h-5 w-5 text-primary animate-pulse" />
            <span className="text-2xl font-mono font-bold" data-testid="text-elapsed-time">
              {formatTime(elapsedSeconds)}
            </span>
            <Badge variant="secondary">Pågående</Badge>
          </div>
        )}
        {!jobStarted ? (
          <Button size="mobile" className="w-full" onClick={handleStartJob} data-testid="button-start-job">
            <Play className="h-5 w-5 mr-2" />
            Starta jobb
          </Button>
        ) : (
          <Button size="mobile" className="w-full bg-green-600" onClick={handleCompleteJob} data-testid="button-complete-job">
            <CheckCircle className="h-5 w-5 mr-2" />
            Klart - Slutför jobb
          </Button>
        )}
      </div>
    </div>
  );
}
