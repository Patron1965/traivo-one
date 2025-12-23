import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { 
  MapPin, Play, CheckCircle, ArrowLeft, Mic, MicOff, 
  Volume2, Loader2, AlertTriangle, Navigation, Phone,
  HelpCircle, X
} from "lucide-react";
import { startOfDay, endOfDay } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import type { WorkOrderWithObject, ServiceObject, Customer } from "@shared/schema";

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

type View = "jobs" | "job" | "ai" | "problem";

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
  
  const [isListening, setIsListening] = useState(false);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

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
      toast({ title: "Bra jobbat!", description: "Jobbet är klart." });
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
  };

  const handleStartJob = () => {
    setJobStarted(true);
    setStartTime(new Date());
    setElapsedSeconds(0);
  };

  const handleBack = () => {
    if (view === "ai" || view === "problem") {
      setView("job");
      setAiQuestion("");
      setAiAnswer("");
    } else {
      setView("jobs");
      setSelectedJobId(null);
      setJobStarted(false);
      setStartTime(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
        <p className="text-xl">Laddar...</p>
      </div>
    );
  }

  if (view === "ai") {
    return (
      <div className="flex flex-col h-full bg-background">
        <button
          onClick={handleBack}
          className="flex items-center gap-3 p-6 border-b text-left hover-elevate"
          data-testid="button-back-from-ai"
        >
          <ArrowLeft className="h-8 w-8" />
          <span className="text-2xl font-medium">Tillbaka</span>
        </button>

        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-8">
          <div className="text-center space-y-2">
            <HelpCircle className="h-16 w-16 mx-auto text-primary" />
            <h1 className="text-3xl font-bold">Fråga AI</h1>
            <p className="text-xl text-muted-foreground">
              Tryck på mikrofonen och ställ din fråga
            </p>
          </div>

          <button
            onClick={isListening ? stopListening : startListening}
            disabled={aiMutation.isPending}
            className={`w-40 h-40 rounded-full flex items-center justify-center transition-all ${
              isListening 
                ? "bg-red-500 animate-pulse" 
                : "bg-primary hover:scale-105"
            }`}
            data-testid="button-voice-input"
          >
            {aiMutation.isPending ? (
              <Loader2 className="h-20 w-20 text-white animate-spin" />
            ) : isListening ? (
              <MicOff className="h-20 w-20 text-white" />
            ) : (
              <Mic className="h-20 w-20 text-white" />
            )}
          </button>

          {isListening && (
            <p className="text-2xl text-primary animate-pulse">Lyssnar...</p>
          )}

          {aiQuestion && (
            <div className="w-full max-w-md p-6 bg-muted rounded-2xl">
              <p className="text-lg font-medium mb-2">Du frågade:</p>
              <p className="text-xl">{aiQuestion}</p>
            </div>
          )}

          {aiAnswer && (
            <div className="w-full max-w-md p-6 bg-primary/10 border-2 border-primary rounded-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-medium mb-2 text-primary">Svar:</p>
                  <p className="text-xl">{aiAnswer}</p>
                </div>
                <button
                  onClick={isSpeaking ? stopSpeaking : () => speakAnswer(aiAnswer)}
                  className="p-3 rounded-full bg-primary text-white shrink-0"
                  data-testid="button-speak-answer"
                >
                  <Volume2 className={`h-6 w-6 ${isSpeaking ? "animate-pulse" : ""}`} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t space-y-4">
          <p className="text-center text-lg text-muted-foreground">Vanliga frågor:</p>
          <div className="grid gap-3">
            {[
              "Hur öppnar jag kärlet?",
              "Var är ingången?",
              "Vad gör jag om det är fel?",
            ].map((q, i) => (
              <button
                key={i}
                onClick={() => {
                  setAiQuestion(q);
                  aiMutation.mutate(q);
                }}
                disabled={aiMutation.isPending}
                className="p-4 text-xl text-left bg-muted rounded-xl hover-elevate"
                data-testid={`button-quick-question-${i}`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (view === "problem") {
    return (
      <div className="flex flex-col h-full bg-background">
        <button
          onClick={handleBack}
          className="flex items-center gap-3 p-6 border-b text-left hover-elevate"
          data-testid="button-back-from-problem"
        >
          <ArrowLeft className="h-8 w-8" />
          <span className="text-2xl font-medium">Tillbaka</span>
        </button>

        <div className="flex-1 p-6">
          <h1 className="text-3xl font-bold mb-8 text-center">Vad är problemet?</h1>
          
          <div className="grid gap-4">
            {[
              { icon: "🗑️", text: "Kärlet är trasigt", color: "bg-orange-100 dark:bg-orange-950 border-orange-300" },
              { icon: "🚫", text: "Kommer inte åt", color: "bg-red-100 dark:bg-red-950 border-red-300" },
              { icon: "📍", text: "Fel adress", color: "bg-yellow-100 dark:bg-yellow-950 border-yellow-300" },
              { icon: "⏰", text: "Ingen tid", color: "bg-blue-100 dark:bg-blue-950 border-blue-300" },
              { icon: "❓", text: "Annat", color: "bg-gray-100 dark:bg-gray-800 border-gray-300" },
            ].map((problem, i) => (
              <button
                key={i}
                onClick={() => {
                  toast({ title: "Rapporterat", description: `Problem: ${problem.text}` });
                  setView("job");
                }}
                className={`flex items-center gap-4 p-6 text-2xl rounded-2xl border-2 ${problem.color} hover-elevate`}
                data-testid={`button-problem-${i}`}
              >
                <span className="text-4xl">{problem.icon}</span>
                <span>{problem.text}</span>
              </button>
            ))}
          </div>
        </div>
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
        <button
          onClick={handleBack}
          className="flex items-center gap-3 p-6 border-b text-left hover-elevate"
          data-testid="button-back-from-job"
        >
          <ArrowLeft className="h-8 w-8" />
          <span className="text-2xl font-medium">Tillbaka</span>
        </button>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold">{selectedJob.title}</h1>
            <p className="text-xl text-muted-foreground">{selectedJob.objectName}</p>
          </div>

          {selectedJob.objectAddress && (
            <button
              onClick={() => window.open(`https://maps.google.com?q=${encodeURIComponent(selectedJob.objectAddress + ", " + (selectedObject?.city || ""))}`)}
              className="w-full flex items-center gap-4 p-6 bg-blue-100 dark:bg-blue-950 rounded-2xl border-2 border-blue-300 hover-elevate"
              data-testid="button-navigate"
            >
              <Navigation className="h-10 w-10 text-blue-600" />
              <div className="text-left flex-1">
                <p className="text-lg font-medium">Navigera hit</p>
                <p className="text-muted-foreground">{selectedJob.objectAddress}</p>
              </div>
            </button>
          )}

          {accessInfo.gateCode && (
            <div className="p-6 bg-green-100 dark:bg-green-950 rounded-2xl border-2 border-green-300">
              <p className="text-lg text-muted-foreground mb-2">Portkod</p>
              <p className="text-5xl font-mono font-bold text-center">{accessInfo.gateCode}</p>
            </div>
          )}

          {accessInfo.specialInstructions && (
            <div className="p-6 bg-yellow-100 dark:bg-yellow-950 rounded-2xl border-2 border-yellow-300">
              <p className="text-lg font-medium mb-2">Viktig info</p>
              <p className="text-xl">{accessInfo.specialInstructions}</p>
            </div>
          )}

          {selectedCustomer?.phone && (
            <button
              onClick={() => window.open(`tel:${selectedCustomer.phone}`)}
              className="w-full flex items-center gap-4 p-6 bg-muted rounded-2xl hover-elevate"
              data-testid="button-call"
            >
              <Phone className="h-10 w-10" />
              <div className="text-left">
                <p className="text-lg font-medium">Ring kund</p>
                <p className="text-muted-foreground">{selectedCustomer.phone}</p>
              </div>
            </button>
          )}

          {jobStarted && (
            <div className="text-center p-6 bg-primary/10 rounded-2xl">
              <p className="text-lg text-muted-foreground mb-2">Tid</p>
              <p className="text-6xl font-mono font-bold text-primary" data-testid="text-timer">
                {formatTime(elapsedSeconds)}
              </p>
            </div>
          )}
        </div>

        <div className="p-6 border-t space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setView("ai")}
              className="flex flex-col items-center gap-2 p-6 bg-purple-100 dark:bg-purple-950 rounded-2xl border-2 border-purple-300 hover-elevate"
              data-testid="button-ask-ai"
            >
              <HelpCircle className="h-10 w-10 text-purple-600" />
              <span className="text-xl font-medium">Fråga AI</span>
            </button>
            <button
              onClick={() => setView("problem")}
              className="flex flex-col items-center gap-2 p-6 bg-orange-100 dark:bg-orange-950 rounded-2xl border-2 border-orange-300 hover-elevate"
              data-testid="button-report-problem"
            >
              <AlertTriangle className="h-10 w-10 text-orange-600" />
              <span className="text-xl font-medium">Problem</span>
            </button>
          </div>

          {!jobStarted ? (
            <button
              onClick={handleStartJob}
              className="w-full flex items-center justify-center gap-4 p-8 bg-primary text-primary-foreground text-3xl font-bold rounded-2xl hover-elevate"
              data-testid="button-start-job"
            >
              <Play className="h-10 w-10" />
              STARTA
            </button>
          ) : (
            <button
              onClick={() => completeJobMutation.mutate(selectedJob.id)}
              disabled={completeJobMutation.isPending}
              className="w-full flex items-center justify-center gap-4 p-8 bg-green-600 text-white text-3xl font-bold rounded-2xl hover-elevate"
              data-testid="button-complete-job"
            >
              {completeJobMutation.isPending ? (
                <Loader2 className="h-10 w-10 animate-spin" />
              ) : (
                <CheckCircle className="h-10 w-10" />
              )}
              KLAR
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-6 border-b text-center">
        <h1 className="text-3xl font-bold">Dagens jobb</h1>
        <p className="text-xl text-muted-foreground mt-2">
          {todayJobs.length} kvar · {completedCount} klara
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {todayJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <CheckCircle className="h-24 w-24 text-green-500" />
            <p className="text-3xl font-bold">Alla jobb klara!</p>
            <p className="text-xl text-muted-foreground">Bra jobbat idag</p>
          </div>
        ) : (
          todayJobs.map((job, index) => (
            <button
              key={job.id}
              onClick={() => handleSelectJob(job.id)}
              className="w-full flex items-center gap-4 p-6 bg-card rounded-2xl border-2 text-left hover-elevate active-elevate-2"
              data-testid={`button-job-${job.id}`}
            >
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary text-primary-foreground text-2xl font-bold shrink-0">
                {index + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-2xl font-medium truncate">{job.title}</p>
                <div className="flex items-center gap-2 text-lg text-muted-foreground mt-1">
                  <MapPin className="h-5 w-5 shrink-0" />
                  <span className="truncate">{job.objectAddress || job.objectName}</span>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <div className="p-6 border-t">
        <button
          onClick={() => {
            setSelectedJobId(null);
            setView("ai");
          }}
          className="w-full flex items-center justify-center gap-4 p-6 bg-purple-100 dark:bg-purple-950 text-purple-900 dark:text-purple-100 rounded-2xl border-2 border-purple-300 hover-elevate"
          data-testid="button-ask-ai-general"
        >
          <HelpCircle className="h-8 w-8" />
          <span className="text-2xl font-medium">Fråga AI om hjälp</span>
        </button>
      </div>
    </div>
  );
}
