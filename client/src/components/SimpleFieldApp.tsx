import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  MapPin, Play, CheckCircle, ArrowLeft,
  Loader2, AlertTriangle, Navigation, Phone,
  HelpCircle, Clock, Trash2, Ban, MapPinOff, Timer, Bell, WifiOff, FileSignature, Camera, X,
  Key, DoorOpen, ListChecks, CircleDot, Circle, Mail, Coffee, MessageSquare, ChevronRight,
  User, CloudSun, Pause, SkipForward, Send, Flag, Thermometer, Wind, Download, Share,
  Lock, Unlock, ClipboardCheck, Wrench, UserX, AlarmClock, Car
} from "lucide-react";
import { startOfDay, endOfDay, format } from "date-fns";
import { sv } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import { useOfflineSupport } from "@/hooks/useOfflineSupport";
import { useOfflineData } from "@/hooks/useOfflineData";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { OfflineIndicator, OfflineBanner } from "@/components/OfflineIndicator";
import { FieldAIAssistant } from "@/components/FieldAIAssistant";
import { PhotoCapture } from "@/components/PhotoCapture";
import { SignatureCapture } from "@/components/SignatureCapture";
import { generateJobProtocol, downloadBlob } from "@/components/JobProtocolGenerator";
import { MaterialLog, type MaterialItem } from "@/components/MaterialLog";
import { OrderChecklist } from "@/components/OrderChecklist";
import { SigningValidationModal } from "@/components/SigningValidationModal";
import type { WorkOrderWithObject, Customer } from "@shared/schema";
import { IMPOSSIBLE_REASONS, IMPOSSIBLE_REASON_LABELS, REQUIRED_FIELDS_BY_ORDER_TYPE } from "@shared/schema";
import { CATEGORY_LABELS, SEVERITY_LABELS, GO_CATEGORIES } from "@shared/changeRequestCategories";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DailyProgressCard } from "@/components/DailyProgressCard";
import { VoiceInput } from "@/components/VoiceInput";
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
  
  const [showInspectionPanel, setShowInspectionPanel] = useState(false);
  const [inspectionItems, setInspectionItems] = useState<Record<string, { status: string; issues: string[]; comment: string }>>({
    door: { status: '', issues: [], comment: '' },
    lock: { status: '', issues: [], comment: '' },
    window: { status: '', issues: [], comment: '' },
    lighting: { status: '', issues: [], comment: '' },
    floor: { status: '', issues: [], comment: '' },
    ventilation: { status: '', issues: [], comment: '' },
  });

  const [showNotesPanel, setShowNotesPanel] = useState(false);
  const [jobNote, setJobNote] = useState("");
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [breakStartTime, setBreakStartTime] = useState<Date | null>(null);
  const [breakElapsedSeconds, setBreakElapsedSeconds] = useState(0);
  const breakTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);
  const [showCompletedDialog, setShowCompletedDialog] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationMissingFields, setValidationMissingFields] = useState<{ field: string; label: string }[]>([]);

  const [showChangeRequestPanel, setShowChangeRequestPanel] = useState(false);
  const [changeRequestCategory, setChangeRequestCategory] = useState("");
  const [changeRequestDescription, setChangeRequestDescription] = useState("");
  const [changeRequestSeverity, setChangeRequestSeverity] = useState<string>("medium");
  const [changeRequestPhoto, setChangeRequestPhoto] = useState<string | null>(null);
  const [isUploadingChangePhoto, setIsUploadingChangePhoto] = useState(false);

  const [dismissedInstallBanner, setDismissedInstallBanner] = useState(() => {
    try {
      return localStorage.getItem("traivo_pwa_install_dismissed") === "true";
    } catch {
      return false;
    }
  });

  const handleDismissInstallBanner = () => {
    setDismissedInstallBanner(true);
    try {
      localStorage.setItem("traivo_pwa_install_dismissed", "true");
    } catch {
      // localStorage not available
    }
  };

  const { canInstall, isInstalled, isIOS, promptInstall } = usePWAInstall();

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

  const { notifications, unreadCount, isConnected, markAsRead } = useNotifications({
    resourceId: resourceId || "",
    onNotification: handleNotification,
    autoConnect: !!resourceId,
  });

  const handleOpenNotificationsPanel = () => {
    setShowNotificationsPanel(!showNotificationsPanel);
    if (!showNotificationsPanel) {
      notifications.filter(n => !n.read).forEach(n => markAsRead(n.id));
    }
  };

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

  const { 
    isSyncing, 
    pendingChanges, 
    lastSyncAt, 
    syncNow,
    queueStatusUpdate,
    savePhoto,
  } = useOfflineData({ resourceId, autoSync: true });

  const { scrollContainerRef, isRefreshing, pullDistance, shouldTrigger } = usePullToRefresh({
    onRefresh: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: "Uppdaterat", description: "Schemat har uppdaterats." });
    },
  });

  useEffect(() => {
    if (jobStarted && startTime && !isOnBreak) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTime.getTime()) / 1000) - breakElapsedSeconds);
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
  }, [jobStarted, startTime, isOnBreak, breakElapsedSeconds]);

  useEffect(() => {
    if (isOnBreak && breakStartTime) {
      breakTimerRef.current = setInterval(() => {
        setBreakElapsedSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (breakTimerRef.current) {
        clearInterval(breakTimerRef.current);
        breakTimerRef.current = null;
      }
    }
    return () => {
      if (breakTimerRef.current) clearInterval(breakTimerRef.current);
    };
  }, [isOnBreak, breakStartTime]);

  const [gpsActive, setGpsActive] = useState(false);
  const gpsWatchRef = useRef<number | null>(null);
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPositionRef = useRef<{ lat: number; lng: number; speed: number; heading: number; accuracy: number } | null>(null);
  const statusRef = useRef({ isOnBreak, jobStarted, selectedJobId });

  useEffect(() => {
    statusRef.current = { isOnBreak, jobStarted, selectedJobId };
  }, [isOnBreak, jobStarted, selectedJobId]);

  const sendPositionUpdate = useCallback(async () => {
    const pos = lastPositionRef.current;
    if (!pos || !resourceId) return;
    const { isOnBreak: brk, jobStarted: started, selectedJobId: jobId } = statusRef.current;
    const currentStatus = brk ? "break" : started ? "on_site" : "traveling";
    try {
      await fetch("/api/resources/position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceId,
          latitude: pos.lat,
          longitude: pos.lng,
          speed: pos.speed,
          heading: pos.heading,
          accuracy: pos.accuracy,
          status: currentStatus,
          workOrderId: jobId || undefined,
        }),
      });
    } catch {
    }
  }, [resourceId]);

  useEffect(() => {
    if (!resourceId || !navigator.geolocation) return;

    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        lastPositionRef.current = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          speed: position.coords.speed || 0,
          heading: position.coords.heading || 0,
          accuracy: position.coords.accuracy || 0,
        };
        setGpsActive(true);
      },
      () => {
        setGpsActive(false);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );

    sendPositionUpdate();
    gpsIntervalRef.current = setInterval(sendPositionUpdate, 15000);

    return () => {
      if (gpsWatchRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
        gpsWatchRef.current = null;
      }
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current);
        gpsIntervalRef.current = null;
      }
    };
  }, [resourceId, sendPositionUpdate]);

  useEffect(() => {
    sendPositionUpdate();
  }, [isOnBreak, jobStarted, selectedJobId, sendPositionUpdate]);

  const notifiedOrdersRef = useRef<Set<string>>(new Set());

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const { data: workOrders = [], isLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders"],
    refetchInterval: 30000, // Poll every 30 seconds for new jobs
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: weatherData } = useQuery<{ temperature: number; description: string; windSpeed: number }>({
    queryKey: ["/api/weather/today"],
    staleTime: 1000 * 60 * 30,
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
    return scheduled >= todayStart && scheduled <= todayEnd && wo.orderStatus !== "utford";
  }).sort((a, b) => {
    const timeA = a.scheduledStartTime || "00:00";
    const timeB = b.scheduledStartTime || "00:00";
    return timeA.localeCompare(timeB);
  });

  const { data: dependencyData = {} } = useQuery<Record<string, { dependsOn: Array<{ parentId: string; type: string; completed: boolean }>; isLocked: boolean; isDependentTask: boolean }>>({
    queryKey: ["/api/field-worker/dependency-info"],
    queryFn: async () => {
      const ids = todayJobs.map(j => j.id);
      if (ids.length === 0) return {};
      const results: Record<string, any> = {};
      const dateStr = new Date().toISOString().split('T')[0];
      const res = await fetch(`/api/field-worker/tasks?date=${dateStr}${resourceId ? `&resourceId=${resourceId}` : ''}`);
      if (res.ok) {
        const tasks = await res.json();
        for (const t of tasks) {
          results[t.id] = { dependsOn: t.dependsOn || [], isLocked: t.isLocked || false, isDependentTask: t.isDependentTask || false };
        }
      }
      return results;
    },
    enabled: todayJobs.length > 0,
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (todayJobs.length === 0) return;
    const checkUpcoming = () => {
      const now = new Date();
      for (const job of todayJobs) {
        if (!job.scheduledStartTime || ["utford", "avbruten", "omojlig", "paborjad", "fakturerad"].includes(job.orderStatus)) continue;
        if (notifiedOrdersRef.current.has(job.id)) continue;
        const [h, m] = job.scheduledStartTime.split(":").map(Number);
        const scheduled = new Date(now);
        scheduled.setHours(h, m, 0, 0);
        const diffMs = scheduled.getTime() - now.getTime();
        const diffMin = diffMs / 60000;
        if (diffMin > 0 && diffMin <= 10) {
          notifiedOrdersRef.current.add(job.id);
          toast({
            title: `${job.title} börjar snart`,
            description: `Schemalagd kl ${job.scheduledStartTime} — om ${Math.ceil(diffMin)} min`,
          });
          if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
        }
      }
    };
    checkUpcoming();
    const interval = setInterval(checkUpcoming, 30000);
    return () => clearInterval(interval);
  }, [todayJobs, toast]);


  const completedCount = workOrders.filter(wo => {
    if (!wo.scheduledDate) return false;
    if (resourceId && wo.resourceId !== resourceId) return false;
    const scheduled = new Date(wo.scheduledDate);
    return scheduled >= todayStart && scheduled <= todayEnd && wo.orderStatus === "utford";
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
        orderStatus: "utford",
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
          orderStatus: "utford",
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
      setBreakElapsedSeconds(0);
      setIsOnBreak(false);
      setShowSignaturePanel(false);
      setCurrentSignature(null);
      setMaterials([]);
      setJobNote("");
      setShowCompletedDialog(true);
    },
  });

  const saveNoteMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const job = workOrders.find(wo => wo.id === id);
      const existingMetadata = (job?.metadata as Record<string, unknown>) || {};
      const existingNotes = (existingMetadata.fieldNotes as string[]) || [];
      
      await apiRequest("PATCH", `/api/work-orders/${id}`, {
        metadata: {
          ...existingMetadata,
          fieldNotes: [...existingNotes, { text: note, timestamp: new Date().toISOString() }],
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: "Anteckning sparad" });
      setJobNote("");
      setShowNotesPanel(false);
    },
  });

  const quickActionMutation = useMutation({
    mutationFn: async ({ orderId, actionType }: { orderId: string; actionType: string }) => {
      const response = await apiRequest("POST", "/api/quick-action", { orderId, actionType });
      return response.json();
    },
    onSuccess: (data: { success: boolean; actionLabel: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: data.actionLabel, description: "Snabbåtgärd registrerad och planerare notifierad." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte utföra snabbåtgärden.", variant: "destructive" });
    },
  });

  const IMPOSSIBLE_TO_DEVIATION_TYPE: Record<string, string> = {
    locked_gate: "blocked_access",
    no_access: "blocked_access",
    wrong_address: "other",
    obstacle: "blocked_access",
    customer_absent: "customer_absent",
    weather: "other",
    equipment_issue: "equipment_issue",
    other: "other",
  };

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

      try {
        const deviationType = IMPOSSIBLE_TO_DEVIATION_TYPE[reason] || "other";
        const reasonLabel = IMPOSSIBLE_REASON_LABELS[reason as keyof typeof IMPOSSIBLE_REASON_LABELS] || reason;
        await apiRequest("POST", `/api/field/orders/${id}/deviations`, {
          type: deviationType,
          description: `${reasonLabel}${reasonText ? `: ${reasonText}` : ""}`,
          photos: photoUrl ? [photoUrl] : [],
          resourceId: resourceId || undefined,
        });
      } catch (err) {
        console.error("[field] Failed to create deviation report:", err);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ 
        title: "Order markerad som omöjlig", 
        description: "Avvikelserapport skapad automatiskt.",
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

  const submitChangeRequestMutation = useMutation({
    mutationFn: async (data: {
      objectId: string;
      category: string;
      description: string;
      severity: string;
      photos?: string[];
    }) => {
      const res = await apiRequest("POST", "/api/field/customer-change-requests", {
        ...data,
        resourceId: resourceId || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/field/my-reports"] });
      toast({
        title: "Kundrapport skickad",
        description: "Rapporten har registrerats och skickats till planeraren.",
      });
      setShowChangeRequestPanel(false);
      setChangeRequestCategory("");
      setChangeRequestDescription("");
      setChangeRequestSeverity("medium");
      setChangeRequestPhoto(null);
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte skicka kundrapport.",
        variant: "destructive",
      });
    },
  });

  const notifyCustomerMutation = useMutation({
    mutationFn: async ({ workOrderId, estimatedMinutes }: { workOrderId: string; estimatedMinutes?: number }) => {
      const response = await apiRequest("POST", `/api/notifications/technician-on-way/${workOrderId}`, {
        estimatedMinutes: estimatedMinutes || 30,
      });
      return response.json();
    },
    onSuccess: (data: { success: boolean; sent: number; message?: string }) => {
      if (data.success) {
        toast({ 
          title: "Kund notifierad", 
          description: data.message || `Notifiering skickad till ${data.sent} mottagare`,
        });
      } else {
        toast({ 
          title: "Notifiering ej skickad", 
          description: "Ingen e-postadress registrerad för kunden.",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({ 
        title: "Fel", 
        description: "Kunde inte skicka notifiering till kund.", 
        variant: "destructive" 
      });
    },
  });

  const saveInspectionMutation = useMutation({
    mutationFn: async (items: Record<string, { status: string; issues: string[]; comment: string }>) => {
      const results = [];
      for (const [type, data] of Object.entries(items)) {
        if (data.status) {
          const res = await apiRequest("POST", "/api/inspection-metadata", {
            workOrderId: selectedJobId,
            objectId: selectedJob?.objectId,
            inspectionType: type,
            status: data.status,
            issues: data.issues,
            comment: data.comment || null,
            photoUrls: [],
            inspectedBy: resourceId || null,
          });
          results.push(await res.json());
        }
      }
      return results;
    },
    onSuccess: () => {
      toast({ title: "Besiktning sparad", description: "Besiktningsdata har registrerats." });
      setShowInspectionPanel(false);
      queryClient.invalidateQueries({ queryKey: ["/api/inspection-metadata"] });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte spara besiktning.", variant: "destructive" });
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

  const handleToggleBreak = () => {
    if (isOnBreak) {
      setIsOnBreak(false);
      toast({ title: "Rast avslutad", description: `Rastade i ${formatTime(breakElapsedSeconds)}` });
    } else {
      setIsOnBreak(true);
      setBreakStartTime(new Date());
      toast({ title: "Rast startad", description: "Jobbtimern är pausad" });
    }
  };

  const allTodayJobs = useMemo(() => {
    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    return workOrders.filter(wo => {
      if (!wo.scheduledDate) return false;
      if (resourceId && wo.resourceId !== resourceId) return false;
      const scheduled = new Date(wo.scheduledDate);
      return scheduled >= dayStart && scheduled <= dayEnd;
    }).sort((a, b) => {
      const timeA = a.scheduledStartTime || "00:00";
      const timeB = b.scheduledStartTime || "00:00";
      return timeA.localeCompare(timeB);
    });
  }, [workOrders, resourceId]);

  const handleNextJob = () => {
    setShowCompletedDialog(false);
    const currentIndex = allTodayJobs.findIndex(j => j.id === selectedJobId);
    const nextPendingJob = allTodayJobs.slice(currentIndex + 1).find(j => j.orderStatus !== "utford");
    if (nextPendingJob) {
      handleSelectJob(nextPendingJob.id);
    } else {
      setView("jobs");
      setSelectedJobId(null);
    }
  };

  const handleGoBackToJobs = () => {
    setShowCompletedDialog(false);
    setView("jobs");
    setSelectedJobId(null);
  };

  const getNextJob = () => {
    const currentIndex = allTodayJobs.findIndex(j => j.id === selectedJobId);
    return allTodayJobs.slice(currentIndex + 1).find(j => j.orderStatus !== "utford") || null;
  };

  const validateBeforeSigning = (job: WorkOrderWithObject, hasSignature: boolean): { field: string; label: string }[] => {
    const orderType = job.orderType || "service";
    const requiredFields = REQUIRED_FIELDS_BY_ORDER_TYPE[orderType] || REQUIRED_FIELDS_BY_ORDER_TYPE.default || [];
    const metadata = (job.metadata as Record<string, unknown>) || {};
    const photos = (metadata.photos as string[]) || [];
    const missing: { field: string; label: string }[] = [];

    for (const req of requiredFields) {
      switch (req.field) {
        case "description":
          if (!job.description && !job.notes && !(metadata.fieldNotes as unknown[])?.length) {
            missing.push(req);
          }
          break;
        case "photos":
          if (photos.length === 0) {
            missing.push(req);
          }
          break;
        case "signature":
          if (!hasSignature && !(metadata.signaturePath as string)) {
            missing.push(req);
          }
          break;
        case "materials":
          if (materials.length === 0 && !(metadata.materials as unknown[])?.length) {
            missing.push(req);
          }
          break;
        case "inspection":
          if (!Object.values(inspectionItems).some(i => i.status)) {
            missing.push(req);
          }
          break;
      }
    }
    return missing;
  };

  const handleCompleteWithValidation = (signaturePath?: string) => {
    if (!selectedJob) return;
    const sigPath = signaturePath || currentSignature || existingSignaturePath;
    const missing = validateBeforeSigning(selectedJob, !!sigPath);
    if (missing.length > 0) {
      setValidationMissingFields(missing);
      setShowValidationModal(true);
      return;
    }
    completeJobMutation.mutate({
      id: selectedJob.id,
      signaturePath: sigPath || undefined,
    });
  };

  const [travelDistances, setTravelDistances] = useState<Record<string, { distanceKm: number | null; travelMinutes: number | null }>>({});
  const lastDistanceFetchRef = useRef<number>(0);
  const lastFetchPositionRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!lastPositionRef.current || !gpsActive || todayJobs.length === 0) return;
    const now = Date.now();
    if (now - lastDistanceFetchRef.current < 60_000) return;

    const pos = lastPositionRef.current;
    const prevPos = lastFetchPositionRef.current;
    if (prevPos && Object.keys(travelDistances).length > 0) {
      const dLat = Math.abs(pos.lat - prevPos.lat);
      const dLng = Math.abs(pos.lng - prevPos.lng);
      if (dLat < 0.001 && dLng < 0.001) return;
    }

    lastDistanceFetchRef.current = now;
    lastFetchPositionRef.current = { lat: pos.lat, lng: pos.lng };

    const destinations = todayJobs
      .filter(j => j.orderStatus !== "utford")
      .map(j => {
        const obj = objectMap.get(j.objectId);
        return {
          id: j.id,
          lat: obj?.latitude ?? j.taskLatitude,
          lng: obj?.longitude ?? j.taskLongitude,
        };
      })
      .filter(d => d.lat != null && d.lng != null);

    if (destinations.length === 0) return;

    fetch("/api/mobile/travel-times", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: pos.lat, longitude: pos.lng, destinations }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.results) {
          const map: Record<string, { distanceKm: number | null; travelMinutes: number | null }> = {};
          for (const r of data.results) {
            map[r.id] = { distanceKm: r.distanceKm, travelMinutes: r.durationMinutes };
          }
          setTravelDistances(map);
        }
      })
      .catch(() => {});
  }, [todayJobs, objectMap, gpsActive, travelDistances]);

  const openNavigation = useCallback((lat: number, lng: number) => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      window.open(`maps://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`, "_blank");
    } else {
      window.location.href = `google.navigation:q=${lat},${lng}`;
      setTimeout(() => {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`, "_blank");
      }, 500);
    }
  }, []);

  const getNextPendingJob = useCallback(() => {
    return todayJobs.find(j => j.orderStatus !== "utford") || null;
  }, [todayJobs]);

  const getPriorityBadge = (priority?: string) => {
    switch (priority) {
      case "urgent":
        return <Badge variant="destructive" className="text-[10px]"><Flag className="h-3 w-3 mr-0.5" />Brådskande</Badge>;
      case "high":
        return <Badge className="bg-orange-500 text-[10px]"><Flag className="h-3 w-3 mr-0.5" />Hög</Badge>;
      default:
        return null;
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
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold truncate">{selectedJob.title}</h1>
              {getPriorityBadge(selectedJob.priority)}
            </div>
            <p className="text-sm text-muted-foreground truncate">{selectedJob.objectName}</p>
          </div>
          <div className="flex items-center gap-2">
            {isOnBreak && (
              <Badge className="bg-amber-500 animate-pulse font-mono text-sm gap-1">
                <Coffee className="h-3 w-3" />
                Rast
              </Badge>
            )}
            {jobStarted && (
              <Badge variant="secondary" className="font-mono text-base gap-1">
                <Timer className="h-4 w-4" />
                {formatTime(elapsedSeconds)}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Arbetsflödesindikator */}
          <Card className="bg-muted/30">
            <CardContent className="py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <ListChecks className="h-3.5 w-3.5" />
                  Arbetsflöde
                </span>
                <Badge variant={jobStarted ? "default" : "outline"} className="text-[10px]">
                  {!jobStarted ? "Väntar på start" : "Pågår"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                {[
                  { label: "Åka dit", done: true },
                  { label: "Starta", done: jobStarted },
                  { label: "Utför", done: jobStarted && elapsedSeconds > 60 },
                  { label: "Slutför", done: false }
                ].map((step, idx, arr) => (
                  <div key={step.label} className="flex items-center gap-1">
                    <div className="flex flex-col items-center">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                        step.done ? "bg-green-500 text-white" : "bg-muted border-2 border-muted-foreground/30"
                      }`}>
                        {step.done ? (
                          <CheckCircle className="h-4 w-4" />
                        ) : (
                          <Circle className="h-4 w-4" />
                        )}
                      </div>
                      <span className="text-[10px] mt-1 text-muted-foreground">{step.label}</span>
                    </div>
                    {idx < arr.length - 1 && (
                      <div className={`w-8 h-0.5 -mt-4 ${step.done ? "bg-green-500" : "bg-muted-foreground/30"}`} />
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {selectedJob.plannedNotes && (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30" data-testid="card-planned-notes">
              <CardContent className="py-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-xs font-medium text-blue-800 dark:text-blue-400">Meddelande från planerare</span>
                </div>
                <p className="text-sm text-blue-900 dark:text-blue-200">{selectedJob.plannedNotes}</p>
              </CardContent>
            </Card>
          )}

          {/* Åtkomstinformation - stort och tydligt */}
          {(selectedJob.objectAccessCode || selectedJob.objectKeyNumber || accessInfo.gateCode) && (
            <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
              <CardContent className="py-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <DoorOpen className="h-4 w-4 text-amber-600" />
                  <span className="text-xs font-medium text-amber-800 dark:text-amber-400">Åtkomstinformation</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(selectedJob.objectAccessCode || accessInfo.gateCode) && (
                    <div className="text-center p-2 bg-white dark:bg-background rounded border">
                      <p className="text-[10px] text-muted-foreground uppercase">Portkod</p>
                      <p className="text-2xl font-mono font-bold">{selectedJob.objectAccessCode || accessInfo.gateCode}</p>
                    </div>
                  )}
                  {selectedJob.objectKeyNumber && (
                    <div className="text-center p-2 bg-white dark:bg-background rounded border">
                      <p className="text-[10px] text-muted-foreground uppercase flex items-center justify-center gap-1">
                        <Key className="h-3 w-3" />
                        Nyckel
                      </p>
                      <p className="text-2xl font-mono font-bold">{selectedJob.objectKeyNumber}</p>
                    </div>
                  )}
                </div>
                {accessInfo.keyLocation && (
                  <p className="text-xs text-muted-foreground mt-2">Nyckelplats: {accessInfo.keyLocation}</p>
                )}
              </CardContent>
            </Card>
          )}

          {selectedCustomer && (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30">
              <CardContent className="py-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <User className="h-4 w-4 text-blue-600" />
                  <span className="text-xs font-medium text-blue-800 dark:text-blue-400">Kontaktperson</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{selectedCustomer.name}</p>
                    {selectedCustomer.phone && (
                      <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                    )}
                  </div>
                  {selectedCustomer.phone && (
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => window.open(`tel:${selectedCustomer.phone}`)}
                      data-testid="button-call-contact"
                    >
                      <Phone className="h-4 w-4 text-green-500" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-3 gap-2">
            {selectedJob.objectAddress && (
              <Button
                variant="outline"
                className="h-auto py-3 flex-col gap-1"
                onClick={() => {
                  window.open(`https://maps.google.com?q=${encodeURIComponent(selectedJob.objectAddress + ", " + (selectedObject?.city || ""))}`);
                  if (selectedJobId) {
                    const pos = lastPositionRef.current;
                    fetch(`/api/work-orders/${selectedJobId}/auto-eta-sms`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        technicianLat: pos?.lat || null,
                        technicianLng: pos?.lng || null,
                      }),
                    }).then(r => r.json()).then(data => {
                      if (data.success && !data.skipped) {
                        toast({ title: "Kund-SMS skickat", description: `ETA: ca ${data.etaMinutes} min` });
                      }
                    }).catch((err) => {
                      console.error("[auto-eta-sms] Error:", err);
                    });
                  }
                }}
                data-testid="button-navigate"
              >
                <Navigation className="h-5 w-5 text-blue-500" />
                <span className="text-xs">Navigera</span>
              </Button>
            )}
            <Button
              variant="outline"
              className="h-auto py-3 flex-col gap-1"
              onClick={() => {
                if (selectedJobId) {
                  notifyCustomerMutation.mutate({ workOrderId: selectedJobId, estimatedMinutes: 30 });
                }
              }}
              disabled={notifyCustomerMutation.isPending || !selectedCustomer?.email}
              data-testid="button-notify-customer"
            >
              {notifyCustomerMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Mail className="h-5 w-5 text-teal-500" />
              )}
              <span className="text-xs">Meddela</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-3 flex-col gap-1"
              onClick={() => {
                setShowAiPanel(!showAiPanel);
                setShowProblemPanel(false);
                setShowNotesPanel(false);
              }}
              data-testid="button-ask-ai"
            >
              <HelpCircle className="h-5 w-5 text-purple-500" />
              <span className="text-xs">AI-hjälp</span>
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              className="h-auto py-3 flex-col gap-1"
              onClick={() => {
                setShowNotesPanel(!showNotesPanel);
                setShowProblemPanel(false);
                setShowAiPanel(false);
              }}
              data-testid="button-add-note"
            >
              <MessageSquare className="h-5 w-5 text-indigo-500" />
              <span className="text-xs">Anteckning</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-3 flex-col gap-1"
              onClick={() => {
                setShowProblemPanel(!showProblemPanel);
                setShowAiPanel(false);
                setShowNotesPanel(false);
              }}
              data-testid="button-report-problem"
            >
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <span className="text-xs">Problem</span>
            </Button>
            {jobStarted && (
              <Button
                variant={isOnBreak ? "default" : "outline"}
                className={`h-auto py-3 flex-col gap-1 ${isOnBreak ? "bg-amber-500 hover:bg-amber-600" : ""}`}
                onClick={handleToggleBreak}
                data-testid="button-toggle-break"
              >
                {isOnBreak ? (
                  <>
                    <Play className="h-5 w-5" />
                    <span className="text-xs">Fortsätt</span>
                  </>
                ) : (
                  <>
                    <Coffee className="h-5 w-5 text-amber-500" />
                    <span className="text-xs">Rast</span>
                  </>
                )}
              </Button>
            )}
          </div>

          {jobStarted && selectedJobId && (
            <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-emerald-600" />
                  Snabbåtgärder
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="outline"
                    className="h-auto py-4 flex-col gap-2 border-2 text-sm font-medium"
                    onClick={() => quickActionMutation.mutate({ orderId: selectedJobId, actionType: "needs_part" })}
                    disabled={quickActionMutation.isPending}
                    data-testid="button-quick-needs-part"
                  >
                    {quickActionMutation.isPending ? (
                      <Loader2 className="h-7 w-7 animate-spin" />
                    ) : (
                      <Wrench className="h-7 w-7 text-blue-500" />
                    )}
                    <span className="text-xs leading-tight text-center">Behöver reservdel</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto py-4 flex-col gap-2 border-2 text-sm font-medium"
                    onClick={() => quickActionMutation.mutate({ orderId: selectedJobId, actionType: "customer_absent" })}
                    disabled={quickActionMutation.isPending}
                    data-testid="button-quick-customer-absent"
                  >
                    {quickActionMutation.isPending ? (
                      <Loader2 className="h-7 w-7 animate-spin" />
                    ) : (
                      <UserX className="h-7 w-7 text-orange-500" />
                    )}
                    <span className="text-xs leading-tight text-center">Kund ej hemma</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto py-4 flex-col gap-2 border-2 text-sm font-medium"
                    onClick={() => quickActionMutation.mutate({ orderId: selectedJobId, actionType: "takes_longer" })}
                    disabled={quickActionMutation.isPending}
                    data-testid="button-quick-takes-longer"
                  >
                    {quickActionMutation.isPending ? (
                      <Loader2 className="h-7 w-7 animate-spin" />
                    ) : (
                      <AlarmClock className="h-7 w-7 text-amber-500" />
                    )}
                    <span className="text-xs leading-tight text-center">Tar längre tid</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {showNotesPanel && (
            <Card className="border-indigo-200 dark:border-indigo-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-indigo-500" />
                  Lägg till anteckning
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Textarea
                    value={jobNote}
                    onChange={(e) => setJobNote(e.target.value)}
                    placeholder="Skriv din anteckning här..."
                    className="min-h-[80px] flex-1"
                    data-testid="input-job-note"
                  />
                  <VoiceInput
                    onTranscript={(text) => {
                      setJobNote((prev) => prev ? `${prev} ${text}` : text);
                    }}
                    className="shrink-0 self-start mt-1"
                  />
                </div>
                <Button
                  className="w-full gap-2"
                  onClick={() => {
                    if (selectedJobId && jobNote.trim()) {
                      saveNoteMutation.mutate({ id: selectedJobId, note: jobNote.trim() });
                    }
                  }}
                  disabled={!jobNote.trim() || saveNoteMutation.isPending}
                  data-testid="button-save-note"
                >
                  {saveNoteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Spara anteckning
                </Button>
              </CardContent>
            </Card>
          )}


          {showProblemPanel && (
            <Card className="border-orange-200 dark:border-orange-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  Rapportera problem
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">Markera som omöjlig</p>
                  <p className="text-xs text-muted-foreground mb-3">
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
                </div>

                <div className="border-t pt-4">
                  <Button
                    variant={showChangeRequestPanel ? "default" : "outline"}
                    className="w-full gap-2"
                    onClick={() => setShowChangeRequestPanel(!showChangeRequestPanel)}
                    data-testid="button-toggle-change-request"
                  >
                    <Flag className="h-4 w-4" />
                    Skicka kundrapport
                  </Button>
                </div>

                {showChangeRequestPanel && selectedJob && (
                  <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
                    <p className="text-sm font-medium">Ny kundrapport</p>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Kategori</label>
                      <Select value={changeRequestCategory} onValueChange={setChangeRequestCategory}>
                        <SelectTrigger data-testid="select-change-category">
                          <SelectValue placeholder="Välj kategori..." />
                        </SelectTrigger>
                        <SelectContent>
                          {GO_CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {CATEGORY_LABELS[cat] || cat}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Allvarlighetsgrad</label>
                      <Select value={changeRequestSeverity} onValueChange={setChangeRequestSeverity}>
                        <SelectTrigger data-testid="select-change-severity">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(SEVERITY_LABELS).map(([val, label]) => (
                            <SelectItem key={val} value={val}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Beskrivning</label>
                      <Textarea
                        value={changeRequestDescription}
                        onChange={(e) => setChangeRequestDescription(e.target.value)}
                        placeholder="Beskriv problemet..."
                        className="min-h-[60px]"
                        data-testid="input-change-description"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Foto (valfritt)</label>
                      {changeRequestPhoto ? (
                        <div className="relative">
                          <img src={changeRequestPhoto} alt="Foto" className="w-full h-24 object-cover rounded-md border" />
                          <Button size="icon" variant="destructive" className="absolute top-1 right-1 h-6 w-6" onClick={() => setChangeRequestPhoto(null)} data-testid="button-remove-change-photo">
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            id="change-request-photo-input"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                setIsUploadingChangePhoto(true);
                                try {
                                  const response = await fetch("/api/uploads/request-url", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      name: `change-req-${selectedJobId}-${Date.now()}-${file.name}`,
                                      size: file.size,
                                      contentType: file.type,
                                    }),
                                  });
                                  if (!response.ok) throw new Error("Upload URL failed");
                                  const { uploadURL, objectPath } = await response.json();
                                  const uploadRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
                                  if (!uploadRes.ok) throw new Error("Upload failed");
                                  setChangeRequestPhoto(objectPath);
                                  toast({ title: "Foto uppladdat" });
                                } catch {
                                  toast({ title: "Fel vid uppladdning", variant: "destructive" });
                                } finally {
                                  setIsUploadingChangePhoto(false);
                                }
                              }
                              e.target.value = "";
                            }}
                            data-testid="input-change-photo"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full gap-1"
                            onClick={() => document.getElementById("change-request-photo-input")?.click()}
                            disabled={isUploadingChangePhoto}
                            data-testid="button-take-change-photo"
                          >
                            {isUploadingChangePhoto ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
                            {isUploadingChangePhoto ? "Laddar upp..." : "Ta foto"}
                          </Button>
                        </>
                      )}
                    </div>
                    <Button
                      className="w-full gap-2"
                      onClick={() => {
                        if (selectedJob?.objectId && changeRequestCategory && changeRequestDescription.trim()) {
                          submitChangeRequestMutation.mutate({
                            objectId: selectedJob.objectId,
                            category: changeRequestCategory,
                            description: changeRequestDescription.trim(),
                            severity: changeRequestSeverity,
                            photos: changeRequestPhoto ? [changeRequestPhoto] : undefined,
                          });
                        }
                      }}
                      disabled={!changeRequestCategory || !changeRequestDescription.trim() || submitChangeRequestMutation.isPending}
                      data-testid="button-submit-change-request"
                    >
                      {submitChangeRequestMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Skicka rapport
                    </Button>
                  </div>
                )}
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

          <Dialog open={showCompletedDialog} onOpenChange={setShowCompletedDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  Jobb slutfört!
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <p className="text-sm text-muted-foreground">
                  Bra jobbat! Vad vill du göra nu?
                </p>
                {getNextJob() && (
                  <Card className="border-primary/20 bg-primary/5">
                    <CardContent className="py-3">
                      <p className="text-xs text-muted-foreground mb-1">Nästa jobb</p>
                      <p className="font-medium">{getNextJob()?.title}</p>
                      <p className="text-sm text-muted-foreground">{getNextJob()?.objectAddress}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-col">
                {getNextJob() && (
                  <Button 
                    className="w-full gap-2"
                    onClick={handleNextJob}
                    data-testid="button-go-to-next-job"
                  >
                    <SkipForward className="h-4 w-4" />
                    Gå till nästa jobb
                  </Button>
                )}
                <Button 
                  variant="outline"
                  className="w-full"
                  onClick={handleGoBackToJobs}
                  data-testid="button-back-to-jobs-list"
                >
                  Tillbaka till jobbslistan
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

          {/* Besiktning */}
          <Card className="border-teal-200 dark:border-teal-800">
            <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowInspectionPanel(!showInspectionPanel)}>
              <CardTitle className="text-base flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-teal-600" />
                  Besiktning
                </div>
                <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${showInspectionPanel ? 'rotate-90' : ''}`} />
              </CardTitle>
            </CardHeader>
            {showInspectionPanel && (
              <CardContent className="space-y-3">
                {Object.entries({
                  door: { label: 'Dörr', issues: ['Knarrar', 'Stängs inte', 'Skadad', 'Saknar stängare'] },
                  lock: { label: 'Lås', issues: ['Slitet', 'Fastnar', 'Saknas', 'Fel nyckel'] },
                  window: { label: 'Fönster', issues: ['Sprucket', 'Öppnas inte', 'Trasig spanjolette', 'Kondens'] },
                  lighting: { label: 'Belysning', issues: ['Ur funktion', 'Blinkar', 'Saknas', 'Felaktig armatur'] },
                  floor: { label: 'Golv', issues: ['Skadat', 'Halt', 'Smutsigt', 'Sprickor'] },
                  ventilation: { label: 'Ventilation', issues: ['Ur funktion', 'Oljud', 'Dålig luft', 'Blockerad'] },
                }).map(([type, config]) => (
                  <div key={type} className="border rounded-lg p-3 space-y-2" data-testid={`inspection-item-${type}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{config.label}</span>
                      <div className="flex gap-1">
                        {['ok', 'warning', 'error'].map(status => (
                          <Button
                            key={status}
                            size="sm"
                            variant={inspectionItems[type]?.status === status ? 'default' : 'outline'}
                            className={`h-7 px-2 text-xs ${
                              inspectionItems[type]?.status === status
                                ? status === 'ok' ? 'bg-green-600 hover:bg-green-700' 
                                  : status === 'warning' ? 'bg-amber-500 hover:bg-amber-600'
                                  : 'bg-red-600 hover:bg-red-700'
                                : ''
                            }`}
                            onClick={() => setInspectionItems(prev => ({
                              ...prev,
                              [type]: { ...prev[type], status }
                            }))}
                            data-testid={`button-inspection-${type}-${status}`}
                          >
                            {status === 'ok' ? 'OK' : status === 'warning' ? 'Varning' : 'Fel'}
                          </Button>
                        ))}
                      </div>
                    </div>
                    {inspectionItems[type]?.status && inspectionItems[type].status !== 'ok' && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {config.issues.map(issue => (
                            <Badge
                              key={issue}
                              variant={inspectionItems[type]?.issues?.includes(issue) ? 'default' : 'outline'}
                              className="cursor-pointer text-xs"
                              onClick={() => setInspectionItems(prev => {
                                const current = prev[type]?.issues || [];
                                const updated = current.includes(issue)
                                  ? current.filter(i => i !== issue)
                                  : [...current, issue];
                                return { ...prev, [type]: { ...prev[type], issues: updated } };
                              })}
                              data-testid={`badge-issue-${type}-${issue}`}
                            >
                              {issue}
                            </Badge>
                          ))}
                        </div>
                        <Textarea
                          placeholder="Kommentar..."
                          className="min-h-[40px] text-sm"
                          value={inspectionItems[type]?.comment || ''}
                          onChange={(e) => setInspectionItems(prev => ({
                            ...prev,
                            [type]: { ...prev[type], comment: e.target.value }
                          }))}
                          data-testid={`input-inspection-comment-${type}`}
                        />
                      </div>
                    )}
                  </div>
                ))}
                <Button
                  className="w-full gap-2"
                  onClick={() => saveInspectionMutation.mutate(inspectionItems)}
                  disabled={saveInspectionMutation.isPending || !Object.values(inspectionItems).some(i => i.status)}
                  data-testid="button-save-inspection"
                >
                  {saveInspectionMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  Spara besiktning
                </Button>
              </CardContent>
            )}
          </Card>

          {jobStarted && (
            <OrderChecklist
              workOrderId={selectedJob.id}
              orderType={selectedJob.orderType}
            />
          )}

          {jobStarted && (
            <MaterialLog
              materials={materials}
              onMaterialsChange={setMaterials}
            />
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
                handleCompleteWithValidation(path);
              }}
              onCancel={() => setShowSignaturePanel(false)}
            />
          </div>
        )}

        <SigningValidationModal
          open={showValidationModal}
          onOpenChange={setShowValidationModal}
          missingFields={validationMissingFields}
        />

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
                onClick={() => handleCompleteWithValidation()}
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
      <OfflineBanner isOnline={isOnline} />
      <div className="p-4 border-b bg-card space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              data-testid="button-back-mobile"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">Dagens schema</h1>
              <p className="text-sm text-muted-foreground">
                {format(today, "EEEE d MMMM", { locale: sv })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {weatherData && (
              <Badge variant="outline" className="text-xs gap-1" data-testid="badge-weather">
                <Thermometer className="h-3 w-3" />
                {Math.round(weatherData.temperature)}°
                {weatherData.windSpeed > 10 && (
                  <>
                    <Wind className="h-3 w-3 ml-1" />
                    {Math.round(weatherData.windSpeed)}
                  </>
                )}
              </Badge>
            )}
            <OfflineIndicator
              isOnline={isOnline}
              isSyncing={isSyncing}
              pendingChanges={pendingChanges}
              lastSyncAt={lastSyncAt}
              onSyncNow={syncNow}
            />
            {resourceId && (
              <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${gpsActive ? "text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400" : "text-muted-foreground bg-muted"}`} data-testid="indicator-gps-status">
                <Navigation className="h-3 w-3" />
                <span>{gpsActive ? "GPS" : "Ingen GPS"}</span>
              </div>
            )}
            {resourceId && isOnline && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 gap-1"
                onClick={handleOpenNotificationsPanel}
                data-testid="button-toggle-notifications"
              >
                <Bell className={`h-4 w-4 ${isConnected ? "text-green-500" : "text-muted-foreground"}`} />
                {unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </Button>
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

        {showNotificationsPanel && notifications.length > 0 && (
          <Card className="border-primary/20">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Notifikationer
              </CardTitle>
            </CardHeader>
            <CardContent className="py-2 px-3 max-h-40 overflow-auto space-y-2">
              {notifications.slice(0, 5).map((notif, idx) => (
                <div key={idx} className="text-sm border-l-2 border-primary pl-2">
                  <p className="font-medium">{notif.title}</p>
                  <p className="text-xs text-muted-foreground">{notif.message}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <DailyProgressCard 
          completed={completedCount} 
          total={completedCount + todayJobs.length} 
          compact 
        />

        {(() => {
          const nextPendingJob = getNextPendingJob();
          if (!nextPendingJob) return null;
          const obj = objectMap.get(nextPendingJob.objectId);
          const lat = obj?.latitude ?? nextPendingJob.taskLatitude;
          const lng = obj?.longitude ?? nextPendingJob.taskLongitude;
          const dist = travelDistances[nextPendingJob.id];
          if (lat == null || lng == null) return null;
          return (
            <Card className="bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-700 dark:to-blue-800 text-white border-0">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider opacity-80">Nästa stopp</p>
                    <p className="font-semibold text-sm truncate">{nextPendingJob.objectAddress || nextPendingJob.title}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {nextPendingJob.scheduledStartTime && (
                        <span className="text-xs opacity-90 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {nextPendingJob.scheduledStartTime}
                        </span>
                      )}
                      {dist && dist.distanceKm != null && (
                        <span className="text-xs opacity-90 flex items-center gap-1" data-testid="text-next-stop-travel">
                          <Car className="h-3 w-3" />
                          {dist.distanceKm} km — {dist.travelMinutes} min
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-white text-blue-600 hover:bg-blue-50 shrink-0 gap-1.5 font-semibold"
                    onClick={(e) => {
                      e.stopPropagation();
                      openNavigation(Number(lat), Number(lng));
                    }}
                    data-testid="button-next-stop-navigate"
                  >
                    <Navigation className="h-4 w-4" />
                    Navigera
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* PWA Install Banner */}
        {!isInstalled && !dismissedInstallBanner && (canInstall || isIOS) && (
          <Card className="bg-primary/10 border-primary/20">
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                  <Download className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">Installera Traivo Go</p>
                  <p className="text-xs text-muted-foreground">
                    {isIOS ? "Tryck dela → Lägg till på hemskärmen" : "Snabbare åtkomst från hemskärmen"}
                  </p>
                </div>
                <div className="flex gap-2">
                  {canInstall && (
                    <Button
                      size="sm"
                      onClick={promptInstall}
                      data-testid="button-install-pwa"
                    >
                      Installera
                    </Button>
                  )}
                  {isIOS && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        toast({
                          title: "Lägg till på hemskärmen",
                          description: "Tryck på dela-ikonen längst ner och välj 'Lägg till på hemskärmen'",
                        });
                      }}
                      data-testid="button-ios-install-help"
                    >
                      <Share className="h-4 w-4 mr-1" />
                      Hur?
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={handleDismissInstallBanner}
                    data-testid="button-dismiss-install-banner"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
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
              className={`hover-elevate active-elevate-2 cursor-pointer ${dependencyData[job.id]?.isLocked ? 'opacity-60 border-red-200 dark:border-red-800' : ''}`}
              onClick={() => {
                if (dependencyData[job.id]?.isLocked) {
                  toast({ title: "Beroende ej klart", description: "Det finns olösta beroenden för detta jobb.", variant: "destructive" });
                }
                handleSelectJob(job.id);
              }}
              data-testid={`button-job-${job.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{job.title}</p>
                        {getPriorityBadge(job.priority)}
                        {dependencyData[job.id]?.isLocked && (
                          <Badge variant="outline" className="text-[10px] border-red-300 text-red-600 dark:text-red-400 gap-0.5">
                            <Lock className="h-3 w-3" />
                            Låst
                          </Badge>
                        )}
                        {dependencyData[job.id]?.isDependentTask && !dependencyData[job.id]?.isLocked && (
                          <Badge variant="outline" className="text-[10px] border-green-300 text-green-600 dark:text-green-400 gap-0.5">
                            <Unlock className="h-3 w-3" />
                            Upplåst
                          </Badge>
                        )}
                      </div>
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
                    {job.plannedNotes && (
                      <div className="flex items-start gap-1.5 mt-1.5 p-1.5 rounded bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800" data-testid={`planned-notes-preview-${job.id}`}>
                        <MessageSquare className="h-3 w-3 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                        <span className="text-xs text-blue-700 dark:text-blue-300 line-clamp-2">{job.plannedNotes}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {job.estimatedDuration && (
                        <span className="text-xs text-muted-foreground">
                          {job.estimatedDuration} min
                        </span>
                      )}
                      {travelDistances[job.id] && travelDistances[job.id].distanceKm != null && (
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5" data-testid={`travel-info-${job.id}`}>
                          <Navigation className="h-2.5 w-2.5" />
                          {travelDistances[job.id].distanceKm} km · {travelDistances[job.id].travelMinutes} min
                        </span>
                      )}
                      {(job.objectAccessCode || job.objectKeyNumber) && (
                        <Badge variant="outline" className="text-[10px] gap-0.5">
                          <Key className="h-2.5 w-2.5" />
                          Kod
                        </Badge>
                      )}
                    </div>
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
