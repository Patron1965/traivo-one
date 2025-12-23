import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  MapPin, Play, CheckCircle, ArrowLeft, Mic, MicOff, 
  Volume2, Loader2, AlertTriangle, Navigation, Phone,
  HelpCircle, Clock, Trash2, Ban, MapPinOff, Timer, MessageCircle, Bell
} from "lucide-react";
import { startOfDay, endOfDay, format } from "date-fns";
import { sv } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import { FieldAIAssistant } from "@/components/FieldAIAssistant";
import type { WorkOrderWithObject, Customer } from "@shared/schema";

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
  interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onerror: ((event: Event) => void) | null;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    start(): void;
    stop(): void;
  }
  interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
  }
  interface SpeechRecognitionResultList {
    readonly length: number;
    [index: number]: SpeechRecognitionResult;
  }
  interface SpeechRecognitionResult {
    readonly length: number;
    [index: number]: SpeechRecognitionAlternative;
  }
  interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }
}

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
  const [isListening, setIsListening] = useState(false);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

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

    try {
      const audio = new Audio("data:audio/wav;base64,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");
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch (e) {
      // Audio not supported
    }
  }, [toast]);

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

  const aiMutation = useMutation({
    mutationFn: async (question: string) => {
      const jobContext = selectedJob ? {
        jobTitle: selectedJob.title,
        objectName: selectedJob.objectName,
        objectAddress: selectedJob.objectAddress,
        accessInfo: selectedObject?.accessInfo,
      } : {};
      
      const response = await apiRequest("POST", "/api/ai/field-assistant", {
        question,
        jobContext,
      }) as { answer?: string };
      return response.answer || "Jag förstår inte. Försök igen.";
    },
    onSuccess: (answer) => {
      setAiAnswer(answer);
      speakAnswer(answer);
    },
    onError: () => {
      setAiAnswer("Något gick fel. Försök igen.");
    },
  });

  const startListening = () => {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognitionAPI) {
      toast({ title: "Röstinmatning stöds inte", variant: "destructive" });
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "sv-SE";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      setAiQuestion(transcript);
      aiMutation.mutate(transcript);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const speakAnswer = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "sv-SE";
    utterance.rate = 0.9;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

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
              <MessageCircle className="h-5 w-5 text-purple-500" />
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

          {showAiPanel && (
            <Card className="border-purple-200 dark:border-purple-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-purple-500" />
                  AI-assistent
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-center">
                  <button
                    onClick={isListening ? stopListening : startListening}
                    disabled={aiMutation.isPending}
                    className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
                      isListening 
                        ? "bg-red-500 animate-pulse" 
                        : "bg-primary"
                    }`}
                    data-testid="button-voice-input"
                  >
                    {aiMutation.isPending ? (
                      <Loader2 className="h-8 w-8 text-white animate-spin" />
                    ) : isListening ? (
                      <MicOff className="h-8 w-8 text-white" />
                    ) : (
                      <Mic className="h-8 w-8 text-white" />
                    )}
                  </button>
                </div>
                {isListening && (
                  <p className="text-center text-sm text-primary animate-pulse">Lyssnar...</p>
                )}
                {aiQuestion && (
                  <div className="p-3 bg-muted rounded-lg text-sm">
                    <span className="font-medium">Du: </span>{aiQuestion}
                  </div>
                )}
                {aiAnswer && (
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm">{aiAnswer}</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-8 w-8"
                        onClick={isSpeaking ? stopSpeaking : () => speakAnswer(aiAnswer)}
                        data-testid="button-speak-answer"
                      >
                        <Volume2 className={`h-4 w-4 ${isSpeaking ? "animate-pulse text-primary" : ""}`} />
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {["Hur öppnar jag?", "Var är ingången?", "Hjälp med problem"].map((q, i) => (
                    <Button
                      key={i}
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setAiQuestion(q);
                        aiMutation.mutate(q);
                      }}
                      disabled={aiMutation.isPending}
                      data-testid={`button-quick-question-${i}`}
                    >
                      {q}
                    </Button>
                  ))}
                </div>
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
          </div>
        </div>
      </div>

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
          onClick={() => {
            setShowAiPanel(!showAiPanel);
            setAiQuestion("");
            setAiAnswer("");
          }}
          data-testid="button-ask-ai-general"
        >
          <HelpCircle className="h-5 w-5 text-purple-500" />
          {showAiPanel ? "Visa jobb" : "Fråga AI om hjälp"}
        </Button>
      </div>
    </div>
  );
}
