import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Send, Mic, MicOff, MapPin, Navigation, Phone, Clock, 
  CheckCircle, Play, ArrowLeft, Loader2, Bot, User,
  Calendar, ChevronRight, Volume2, VolumeX, Settings,
  Compass, Target, Sparkles, ListTodo, MoreHorizontal
} from "lucide-react";
import { startOfDay, endOfDay, format, startOfWeek, endOfWeek, addDays } from "date-fns";
import { sv } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useObjectsByIds } from "@/hooks/useObjectSearch";
import { useVoice } from "@/hooks/useVoice";
import type { WorkOrderWithObject, Customer, Resource } from "@shared/schema";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  actions?: QuickAction[];
}

interface QuickAction {
  label: string;
  icon: string;
  action: () => void;
}

interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface AIFieldAssistantProps {
  resourceId?: string;
  resourceName?: string;
  onLogout?: () => void;
}

type View = "chat" | "jobs" | "job-detail";

export function AIFieldAssistant({ resourceId, resourceName, onLogout }: AIFieldAssistantProps) {
  const { toast } = useToast();
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobStarted, setJobStarted] = useState(false);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleVoiceResult = useCallback((transcript: string, isFinal: boolean) => {
    setInputText(transcript);
    if (isFinal && transcript.trim()) {
      handleSendMessage(transcript);
    }
  }, []);

  const handleVoiceError = useCallback((error: string) => {
    toast({ title: "Röstfel", description: error, variant: "destructive" });
  }, [toast]);

  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isRecognitionSupported,
    isSpeaking,
    speak,
    stopSpeaking,
    isSynthesisSupported,
  } = useVoice({
    language: "sv-SE",
    continuous: false,
    onResult: handleVoiceResult,
    onError: handleVoiceError,
  });

  // Geolocation
  useEffect(() => {
    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setPosition({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          });
        },
        (error) => {
          console.log("Geolocation error:", error.message);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  // Timer for job duration
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

  // Scroll to bottom when new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Welcome message on mount
  useEffect(() => {
    const greeting = getGreeting();
    const welcomeMessage: Message = {
      id: "welcome",
      role: "assistant",
      content: `${greeting}, ${resourceName || "där"}! Jag är din AI-assistent. Hur kan jag hjälpa dig idag?\n\nJag kan hjälpa dig med:\n• Visa dagens uppdrag\n• Navigera till nästa jobb\n• Ge information om kunders objekt\n• Svara på frågor om arbetet`,
      timestamp: new Date(),
      actions: [
        { label: "Dagens uppdrag", icon: "list", action: () => setView("jobs") },
        { label: "Nästa jobb", icon: "navigation", action: () => goToNextJob() },
      ],
    };
    setMessages([welcomeMessage]);
  }, [resourceName]);

  // Update input while listening
  useEffect(() => {
    if (isListening) {
      setInputText(transcript);
    }
  }, [isListening, transcript]);

  const { data: workOrders = [], isLoading: ordersLoading } = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const todayStart = startOfDay(selectedDate);
  const todayEnd = endOfDay(selectedDate);

  const todayJobs = useMemo(() => {
    return workOrders
      .filter((wo) => {
        if (!wo.scheduledDate) return false;
        if (resourceId && wo.resourceId !== resourceId) return false;
        const scheduled = new Date(wo.scheduledDate);
        return scheduled >= todayStart && scheduled <= todayEnd;
      })
      .sort((a, b) => {
        const timeA = a.scheduledStartTime || "00:00";
        const timeB = b.scheduledStartTime || "00:00";
        return timeA.localeCompare(timeB);
      });
  }, [workOrders, resourceId, todayStart, todayEnd]);

  const pendingJobs = todayJobs.filter((j) => j.status !== "completed");
  const completedJobs = todayJobs.filter((j) => j.status === "completed");

  const objectIdsNeeded = useMemo(() => {
    return todayJobs.map((wo) => wo.objectId).filter(Boolean);
  }, [todayJobs]);

  const { data: objects = [] } = useObjectsByIds(objectIdsNeeded);
  const objectMap = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const customerMap = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const selectedJob = selectedJobId ? workOrders.find((wo) => wo.id === selectedJobId) : null;
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
      setView("chat");
      setSelectedJobId(null);
      
      // Add completion message
      const msg: Message = {
        id: `complete-${Date.now()}`,
        role: "assistant",
        content: `Bra jobbat! Uppdraget är slutfört på ${formatTime(elapsedSeconds)}.\n\n${pendingJobs.length > 1 ? `Du har ${pendingJobs.length - 1} uppdrag kvar idag.` : "Det var dagens sista uppdrag!"}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, msg]);
    },
  });

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 10) return "God morgon";
    if (hour < 12) return "God förmiddag";
    if (hour < 18) return "God eftermiddag";
    return "God kväll";
  }

  function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  function goToNextJob() {
    if (pendingJobs.length > 0) {
      setSelectedJobId(pendingJobs[0].id);
      setView("job-detail");
    } else {
      const msg: Message = {
        id: `no-jobs-${Date.now()}`,
        role: "assistant",
        content: "Du har inga fler uppdrag idag. Bra jobbat!",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, msg]);
    }
  }

  function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async function handleSendMessage(text?: string) {
    const messageText = text || inputText.trim();
    if (!messageText || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: messageText,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);

    try {
      // Build context for AI
      const context = {
        module: "field-app",
        path: "/field",
        resourceId,
        resourceName,
        position,
        todayJobsCount: pendingJobs.length,
        completedJobsCount: completedJobs.length,
        currentJob: selectedJob ? {
          title: selectedJob.title,
          address: selectedJob.objectAddress,
          customer: selectedCustomer?.name,
        } : null,
        nearbyJobs: position ? pendingJobs.slice(0, 3).map((j) => ({
          title: j.title,
          address: j.objectAddress,
        })) : [],
      };

      const response = await apiRequest("POST", "/api/ai/field-assistant", {
        question: messageText,
        context,
      });

      const data = await response.json();
      
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Speak response if voice enabled
      if (voiceEnabled && isSynthesisSupported) {
        speak(data.answer);
      }
    } catch (error) {
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: "Kunde inte få svar just nu. Försök igen om en stund.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleStartJob() {
    setJobStarted(true);
    setStartTime(new Date());
    setElapsedSeconds(0);
  }

  function handleNavigate(address: string, city?: string) {
    const fullAddress = city ? `${address}, ${city}` : address;
    window.open(`https://maps.google.com?q=${encodeURIComponent(fullAddress)}`);
  }

  function handleCall(phone: string) {
    window.open(`tel:${phone}`);
  }

  // Header component
  const Header = () => (
    <div className="flex items-center justify-between gap-3 p-4 border-b bg-card">
      <div className="flex items-center gap-3">
        {view !== "chat" ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (view === "job-detail") {
                setView("jobs");
                setSelectedJobId(null);
                setJobStarted(false);
              } else {
                setView("chat");
              }
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        ) : null}
        <Avatar className="h-10 w-10 bg-primary">
          <AvatarFallback className="bg-primary text-primary-foreground font-bold">
            {resourceName ? resourceName.charAt(0).toUpperCase() : "U"}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="font-semibold">{resourceName || "Fältarbetare"}</p>
          <p className="text-xs text-muted-foreground">
            {format(selectedDate, "EEEE d MMMM", { locale: sv })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {position && (
          <Badge variant="outline" className="text-xs text-green-600">
            <Compass className="h-3 w-3 mr-1" />
            GPS
          </Badge>
        )}
        {jobStarted && (
          <Badge variant="secondary" className="font-mono">
            <Clock className="h-3 w-3 mr-1" />
            {formatTime(elapsedSeconds)}
          </Badge>
        )}
        {onLogout && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onLogout}
            data-testid="button-logout"
          >
            <Settings className="h-5 w-5" />
          </Button>
        )}
      </div>
    </div>
  );

  // Quick stats bar
  const StatsBar = () => (
    <div className="flex items-center gap-2 p-3 border-b bg-muted/50">
      <Badge 
        variant="outline" 
        className="flex-1 justify-center py-1.5 cursor-pointer"
        onClick={() => setView("jobs")}
        data-testid="badge-pending-jobs"
      >
        <Target className="h-3.5 w-3.5 mr-1.5 text-blue-500" />
        {pendingJobs.length} kvar
      </Badge>
      <Badge 
        variant="outline" 
        className="flex-1 justify-center py-1.5 text-green-600"
        data-testid="badge-completed-jobs"
      >
        <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
        {completedJobs.length} klara
      </Badge>
    </div>
  );

  // Chat view
  const ChatView = () => (
    <div className="flex flex-col h-full">
      <StatsBar />
      
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
            >
              <Avatar className={`h-8 w-8 shrink-0 ${msg.role === "user" ? "bg-primary" : "bg-muted"}`}>
                <AvatarFallback className={msg.role === "user" ? "bg-primary text-primary-foreground" : ""}>
                  {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                </AvatarFallback>
              </Avatar>
              <div className={`flex-1 max-w-[80%] ${msg.role === "user" ? "text-right" : ""}`}>
                <div
                  className={`inline-block p-3 rounded-2xl text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted rounded-bl-md"
                  }`}
                >
                  {msg.content}
                </div>
                {msg.actions && msg.actions.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {msg.actions.map((action, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        onClick={action.action}
                        className="text-xs"
                        data-testid={`button-quick-action-${i}`}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {format(msg.timestamp, "HH:mm")}
                </p>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <Avatar className="h-8 w-8 shrink-0 bg-muted">
                <AvatarFallback>
                  <Loader2 className="h-4 w-4 animate-spin" />
                </AvatarFallback>
              </Avatar>
              <div className="bg-muted p-3 rounded-2xl rounded-bl-md">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-foreground/30 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-foreground/30 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-foreground/30 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="p-4 border-t bg-card">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder={isListening ? "Lyssnar..." : "Skriv ett meddelande..."}
              className="w-full h-12 px-4 pr-12 rounded-full border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={isLoading}
              data-testid="input-chat-message"
            />
            {isRecognitionSupported && (
              <Button
                variant="ghost"
                size="icon"
                className={`absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full ${isListening ? "text-red-500" : ""}`}
                onClick={isListening ? stopListening : startListening}
                data-testid="button-voice-input"
              >
                {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </Button>
            )}
          </div>
          <Button
            size="icon"
            className="h-12 w-12 rounded-full shrink-0"
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isLoading}
            data-testid="button-send-message"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
        
        {/* Quick actions */}
        <div className="flex items-center justify-center gap-2 mt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView("jobs")}
            className="text-xs"
            data-testid="button-view-jobs"
          >
            <ListTodo className="h-4 w-4 mr-1" />
            Uppdrag
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={goToNextJob}
            className="text-xs"
            data-testid="button-next-job"
          >
            <Navigation className="h-4 w-4 mr-1" />
            Nästa jobb
          </Button>
          {isSynthesisSupported && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVoiceEnabled(!voiceEnabled)}
              className="text-xs"
              data-testid="button-toggle-voice"
            >
              {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  // Jobs list view
  const JobsView = () => (
    <div className="flex flex-col h-full">
      <StatsBar />
      
      <ScrollArea className="flex-1 p-4">
        {ordersLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : pendingJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
            <p className="text-xl font-semibold">Inga fler uppdrag!</p>
            <p className="text-muted-foreground mt-1">Bra jobbat idag</p>
            {completedJobs.length > 0 && (
              <p className="text-sm text-muted-foreground mt-4">
                Du har slutfört {completedJobs.length} uppdrag idag
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {pendingJobs.map((job, index) => {
              const obj = objectMap.get(job.objectId);
              return (
                <Card
                  key={job.id}
                  className="hover-elevate active-elevate-2 cursor-pointer"
                  onClick={() => {
                    setSelectedJobId(job.id);
                    setView("job-detail");
                  }}
                  data-testid={`card-job-${job.id}`}
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
                      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <div className="p-4 border-t bg-card">
        <Button
          variant="outline"
          className="w-full h-12"
          onClick={() => setView("chat")}
          data-testid="button-back-to-chat"
        >
          <Sparkles className="h-5 w-5 mr-2 text-purple-500" />
          Tillbaka till AI-assistenten
        </Button>
      </div>
    </div>
  );

  // Job detail view
  const JobDetailView = () => {
    if (!selectedJob) return null;

    const accessInfo = (selectedObject?.accessInfo || {}) as {
      gateCode?: string;
      keyLocation?: string;
      parking?: string;
      specialInstructions?: string;
    };

    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b bg-card">
          <h2 className="font-semibold text-lg">{selectedJob.title}</h2>
          <p className="text-sm text-muted-foreground">{selectedJob.objectName}</p>
        </div>

        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {/* Quick actions grid */}
            <div className="grid grid-cols-2 gap-3">
              {selectedJob.objectAddress && (
                <Button
                  variant="outline"
                  className="h-auto py-4 flex-col gap-2"
                  onClick={() => handleNavigate(selectedJob.objectAddress!, selectedObject?.city ?? undefined)}
                  data-testid="button-navigate"
                >
                  <Navigation className="h-6 w-6 text-blue-500" />
                  <span>Navigera</span>
                </Button>
              )}
              {selectedCustomer?.phone && (
                <Button
                  variant="outline"
                  className="h-auto py-4 flex-col gap-2"
                  onClick={() => handleCall(selectedCustomer.phone!)}
                  data-testid="button-call"
                >
                  <Phone className="h-6 w-6 text-green-500" />
                  <span>Ring kund</span>
                </Button>
              )}
            </div>

            {/* Gate code */}
            {accessInfo.gateCode && (
              <Card className="border-green-500/30">
                <CardContent className="py-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Portkod</p>
                  <p className="text-4xl font-mono font-bold mt-1">{accessInfo.gateCode}</p>
                </CardContent>
              </Card>
            )}

            {/* Special instructions */}
            {accessInfo.specialInstructions && (
              <Card className="border-yellow-500/30">
                <CardContent className="py-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Viktig info</p>
                  <p className="text-sm">{accessInfo.specialInstructions}</p>
                </CardContent>
              </Card>
            )}

            {/* Address */}
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

            {/* Customer info */}
            {selectedCustomer && (
              <Card>
                <CardContent className="py-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Kund</p>
                  <p className="text-sm font-medium">{selectedCustomer.name}</p>
                  {selectedCustomer.phone && (
                    <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t bg-card">
          {!jobStarted ? (
            <Button
              size="lg"
              className="w-full h-14 text-lg gap-2"
              onClick={handleStartJob}
              data-testid="button-start-job"
            >
              <Play className="h-6 w-6" />
              Starta uppdrag
            </Button>
          ) : (
            <Button
              size="lg"
              className="w-full h-14 text-lg gap-2 bg-green-600 hover:bg-green-700"
              onClick={() => completeJobMutation.mutate(selectedJob.id)}
              disabled={completeJobMutation.isPending}
              data-testid="button-complete-job"
            >
              {completeJobMutation.isPending ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <CheckCircle className="h-6 w-6" />
              )}
              Slutför ({formatTime(elapsedSeconds)})
            </Button>
          )}
        </div>
      </div>
    );
  };

  if (ordersLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground">Laddar...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <Header />
      {view === "chat" && <ChatView />}
      {view === "jobs" && <JobsView />}
      {view === "job-detail" && <JobDetailView />}
    </div>
  );
}
