import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  MapPin, Play, CheckCircle, ArrowLeft,
  Loader2, AlertTriangle, Navigation, Phone,
  HelpCircle, Clock, Trash2, Ban, MapPinOff, Timer, Bell, WifiOff, FileSignature, Camera, X
} from "lucide-react";
import { startOfDay, endOfDay, format } from "date-fns";
import { sv } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import { useOfflineSupport } from "@/hooks/useOfflineSupport";
import { FieldAIAssistant } from "@/components/FieldAIAssistant";
import { PhotoCapture } from "@/components/PhotoCapture";
import { SignatureCapture } from "@/components/SignatureCapture";
import { generateJobProtocol, downloadBlob } from "@/components/JobProtocolGenerator";
import { MaterialLog, type MaterialItem } from "@/components/MaterialLog";
import type { WorkOrderWithObject, Customer } from "@shared/schema";
import { IMPOSSIBLE_REASONS, IMPOSSIBLE_REASON_LABELS } from "@shared/schema";
import { Textarea } from "@/components/ui/textarea";
import { DailyProgressCard } from "@/components/DailyProgressCard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

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
  const [showSignaturePanel, setShowSignaturePanel] = useState(false);
  const [currentSignature, setCurrentSignature] = useState<string | null>(null);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [showImpossibleDialog, setShowImpossibleDialog] = useState(false);
  const [selectedImpossibleReason, setSelectedImpossibleReason] = useState<string | null>(null);
  const [impossibleReasonText, setImpossibleReasonText] = useState("");
  const [impossiblePhoto, setImpossiblePhoto] = useState<string | null>(null);
  const [isUploadingImpossiblePhoto, setIsUploadingImpossiblePhoto] = useState(false);


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

  const { isOnline, cacheWorkOrders } = useOfflineSupport({
    onOffline: () => {
      toast({
        title: "Du är offline",
        description: "Dagens jobb är cachade och tillgängliga.",
        variant: "destructive",
      });
    },
    onOnline: () => {
      toast({
        title: "Ansluten igen",
        description: "Synkroniserar data...",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
  });

  const { scrollContainerRef, isRefreshing, pullDistance, shouldTrigger } = usePullToRefresh({
    onRefresh: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: "Uppdaterat", description: "Schemat har uppdaterats." });
    },
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

  useEffect(() => {
    if (workOrders.length > 0) {
      cacheWorkOrders(workOrders);
    }
  }, [workOrders, cacheWorkOrders]);

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
  const selectedJobMetadata = (selectedJob?.metadata as Record<string, unknown>) || {};
  const existingSignaturePath = (selectedJobMetadata.signaturePath as string) || null;

  const completeJobMutation = useMutation({
    mutationFn: async ({ id, signaturePath }: { id: string; signaturePath?: string }) => {
      const elapsed = Math.ceil(elapsedSeconds / 60);
      const job = workOrders.find(wo => wo.id === id);
      const existingMetadata = (job?.metadata as Record<string, unknown>) || {};
      const photos = (existingMetadata.photos as string[]) || [];
      const finalSignature = signaturePath || (existingMetadata.signaturePath as string) || undefined;
      
      const updatedMetadata = {
        ...existingMetadata,
        signaturePath: finalSignature,
        materials: materials.length > 0 ? materials : (existingMetadata.materials || []),
      };
      
      await apiRequest("PATCH", `/api/work-orders/${id}`, {
        status: "completed",
        completedAt: new Date().toISOString(),
        actualDuration: elapsed,
        metadata: updatedMetadata,
      });

      if (job) {
        const customer = customerMap.get(job.customerId);
        const pdfBlob = await generateJobProtocol({
          workOrderId: job.id,
          title: job.title,
          objectName: job.objectName || undefined,
          objectAddress: job.objectAddress || undefined,
          customerName: customer?.name || undefined,
          scheduledDate: job.scheduledDate ? String(job.scheduledDate) : undefined,
          actualDuration: elapsed,
          photos,
          signaturePath: finalSignature,
          materials: materials.length > 0 ? materials : (existingMetadata.materials as MaterialItem[]) || [],
          status: "completed",
        });
        downloadBlob(pdfBlob, `protokoll-${job.id.slice(0, 8)}.pdf`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: "Klart!", description: "Jobbet slutfört och protokoll genererat." });
      setJobStarted(false);
      setStartTime(null);
      setElapsedSeconds(0);
      setView("jobs");
      setSelectedJobId(null);
      setShowSignaturePanel(false);
      setCurrentSignature(null);
      setMaterials([]);
    },
  });

  const markImpossibleMutation = useMutation({
    mutationFn: async ({ 
      id, 
      reason, 
      reasonText,
      photoUrl
    }: { 
      id: string; 
      reason: string; 
      reasonText?: string;
      photoUrl?: string;
    }) => {
      await apiRequest("PATCH", `/api/work-orders/${id}`, {
        status: "omojlig",
        impossibleReason: reason,
        impossibleReasonText: reasonText || null,
        impossibleAt: new Date().toISOString(),
        impossibleBy: resourceId || null,
        impossiblePhotoUrl: photoUrl || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ 
        title: "Order markerad som omöjlig", 
        description: "Ordern har markerats och en ny kommer schemaläggas.",
      });
      setShowImpossibleDialog(false);
      setSelectedImpossibleReason(null);
      setImpossibleReasonText("");
      setImpossiblePhoto(null);
      setShowProblemPanel(false);
      setView("jobs");
      setSelectedJobId(null);
    },
    onError: () => {
      toast({ 
        title: "Fel", 
        description: "Kunde inte markera ordern som omöjlig.", 
        variant: "destructive" 
      });
    },
  });

  const handleSelectJob = (jobId: string) => {
    setSelectedJobId(jobId);
    setView("job");
    setShowAiPanel(false);
    setShowProblemPanel(false);
    setMaterials([]);
    setCurrentSignature(null);
  };

  const handleStartJob = () => {
    const existingMaterials = (selectedJobMetadata.materials as MaterialItem[]) || [];
    setMaterials(existingMaterials);
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

  const handleSelectImpossibleReason = (reason: string) => {
    setSelectedImpossibleReason(reason);
    setShowImpossibleDialog(true);
  };

  const handleConfirmImpossible = () => {
    if (selectedJob && selectedImpossibleReason) {
      markImpossibleMutation.mutate({
        id: selectedJob.id,
        reason: selectedImpossibleReason,
        reasonText: impossibleReasonText || undefined,
        photoUrl: impossiblePhoto || undefined,
      });
    }
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
                  Markera som omöjlig
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Välj anledning till att ordern inte kan utföras:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {IMPOSSIBLE_REASONS.map((reason) => (
                    <Button
                      key={reason}
                      variant="outline"
                      className="h-auto py-3 flex-col gap-1"
                      onClick={() => handleSelectImpossibleReason(reason)}
                      data-testid={`button-impossible-${reason}`}
                    >
                      {reason === "locked_gate" && <Ban className="h-5 w-5 text-red-500" />}
                      {reason === "no_access" && <Ban className="h-5 w-5 text-red-500" />}
                      {reason === "wrong_address" && <MapPinOff className="h-5 w-5 text-yellow-600" />}
                      {reason === "obstacle" && <Trash2 className="h-5 w-5 text-orange-500" />}
                      {reason === "customer_absent" && <Clock className="h-5 w-5 text-blue-500" />}
                      {reason === "weather" && <AlertTriangle className="h-5 w-5 text-gray-500" />}
                      {reason === "equipment_issue" && <AlertTriangle className="h-5 w-5 text-purple-500" />}
                      {reason === "other" && <HelpCircle className="h-5 w-5 text-gray-500" />}
                      <span className="text-xs">{IMPOSSIBLE_REASON_LABELS[reason]}</span>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Dialog open={showImpossibleDialog} onOpenChange={setShowImpossibleDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Bekräfta omöjlig order</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Du markerar denna order som omöjlig med anledning: 
                  <strong className="ml-1">
                    {selectedImpossibleReason && IMPOSSIBLE_REASON_LABELS[selectedImpossibleReason as keyof typeof IMPOSSIBLE_REASON_LABELS]}
                  </strong>
                </p>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Ytterligare detaljer (valfritt)
                  </label>
                  <Textarea
                    value={impossibleReasonText}
                    onChange={(e) => setImpossibleReasonText(e.target.value)}
                    placeholder="Beskriv vad som hindrade dig..."
                    data-testid="input-impossible-reason-text"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Foto som bevis (valfritt)
                  </label>
                  {impossiblePhoto ? (
                    <div className="relative">
                      <img 
                        src={impossiblePhoto} 
                        alt="Bevis" 
                        className="w-full h-32 object-cover rounded-md border"
                      />
                      <Button
                        size="icon"
                        variant="destructive"
                        className="absolute top-1 right-1"
                        onClick={() => setImpossiblePhoto(null)}
                        data-testid="button-remove-impossible-photo"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        id="impossible-photo-input"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setIsUploadingImpossiblePhoto(true);
                            try {
                              const response = await fetch("/api/uploads/request-url", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  name: `impossible-${selectedJobId}-${Date.now()}-${file.name}`,
                                  size: file.size,
                                  contentType: file.type,
                                }),
                              });

                              if (!response.ok) throw new Error("Kunde inte få uppladdnings-URL");

                              const { uploadURL, objectPath } = await response.json();

                              const uploadResponse = await fetch(uploadURL, {
                                method: "PUT",
                                body: file,
                                headers: { "Content-Type": file.type },
                              });

                              if (!uploadResponse.ok) throw new Error("Uppladdning misslyckades");
                              
                              setImpossiblePhoto(objectPath);
                              toast({ title: "Foto uppladdat" });
                            } catch (error) {
                              console.error("Upload error:", error);
                              toast({ 
                                title: "Fel vid uppladdning", 
                                description: "Kunde inte ladda upp bilden.",
                                variant: "destructive" 
                              });
                            } finally {
                              setIsUploadingImpossiblePhoto(false);
                            }
                          }
                          e.target.value = "";
                        }}
                        data-testid="input-impossible-photo"
                      />
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => document.getElementById('impossible-photo-input')?.click()}
                        disabled={isUploadingImpossiblePhoto}
                        data-testid="button-take-impossible-photo"
                      >
                        {isUploadingImpossiblePhoto ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Camera className="h-4 w-4 mr-2" />
                        )}
                        {isUploadingImpossiblePhoto ? "Laddar upp..." : "Ta foto"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setShowImpossibleDialog(false);
                    setSelectedImpossibleReason(null);
                    setImpossibleReasonText("");
                    setImpossiblePhoto(null);
                  }}
                >
                  Avbryt
                </Button>
                <Button 
                  variant="destructive"
                  onClick={handleConfirmImpossible}
                  disabled={markImpossibleMutation.isPending}
                  data-testid="button-confirm-impossible"
                >
                  {markImpossibleMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 mr-1" />
                  )}
                  Markera som omöjlig
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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

          {jobStarted && (
            <MaterialLog
              materials={materials}
              onMaterialsChange={setMaterials}
            />
          )}

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

        {showSignaturePanel && (
          <div className="p-4 border-t bg-muted/50">
            <SignatureCapture
              workOrderId={selectedJob.id}
              existingSignature={currentSignature || existingSignaturePath}
              onSignatureSaved={(path) => {
                setCurrentSignature(path);
                setShowSignaturePanel(false);
                completeJobMutation.mutate({ id: selectedJob.id, signaturePath: path });
              }}
              onCancel={() => setShowSignaturePanel(false)}
            />
          </div>
        )}

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
          ) : showSignaturePanel ? null : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="mobile"
                variant="outline"
                className="gap-2"
                onClick={() => completeJobMutation.mutate({ 
                  id: selectedJob.id, 
                  signaturePath: currentSignature || existingSignaturePath || undefined 
                })}
                disabled={completeJobMutation.isPending}
                data-testid="button-complete-without-signature"
              >
                {completeJobMutation.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <CheckCircle className="h-5 w-5" />
                )}
                {existingSignaturePath ? "Slutf\u00f6r" : "Utan signatur"}
              </Button>
              <Button
                size="mobile"
                className="gap-2 bg-green-600"
                onClick={() => setShowSignaturePanel(true)}
                disabled={completeJobMutation.isPending}
                data-testid="button-complete-with-signature"
              >
                <FileSignature className="h-5 w-5" />
                {existingSignaturePath ? "Ny signatur" : "Signera"}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-4 border-b bg-card space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Dagens schema</h1>
            <p className="text-sm text-muted-foreground">
              {format(today, "EEEE d MMMM", { locale: sv })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!isOnline && (
              <Badge 
                variant="destructive"
                data-testid="badge-offline-status"
              >
                <WifiOff className="h-3 w-3 mr-1" />
                Offline
              </Badge>
            )}
            {resourceId && isOnline && (
              <Badge 
                variant={isConnected ? "outline" : "secondary"} 
                className={isConnected ? "text-green-600" : ""}
                data-testid="badge-connection-status"
              >
                <Bell className="h-3 w-3 mr-1" />
                {isConnected ? (unreadCount > 0 ? unreadCount : "Live") : "..."}
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
        <DailyProgressCard 
          completed={completedCount} 
          total={completedCount + todayJobs.length} 
          compact 
        />
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

      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-auto p-4 space-y-3 pull-to-refresh"
      >
        {pullDistance > 0 && (
          <div 
            className="flex items-center justify-center transition-all"
            style={{ height: pullDistance }}
          >
            <div className={`flex items-center gap-2 text-sm text-muted-foreground ${isRefreshing ? "animate-pulse" : ""}`}>
              {isRefreshing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Uppdaterar...</span>
                </>
              ) : shouldTrigger ? (
                <span>Släpp för att uppdatera</span>
              ) : (
                <span>Dra ner för att uppdatera</span>
              )}
            </div>
          </div>
        )}
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
