import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Brain, Sparkles, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Clock, RefreshCw, Loader2, Send, MessageCircle, Zap, Target,
  BarChart3, Users, ArrowUpRight, ArrowDownRight, Minus, Navigation,
  Bell, Mail, Smartphone, Eye, ChevronRight, Lightbulb, Shield
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface InsightCard {
  id: string;
  type: "kpi" | "anomaly" | "recommendation" | "trend" | "warning";
  title: string;
  description: string;
  metric?: string;
  metricValue?: string;
  trend?: "up" | "down" | "stable";
  severity: "info" | "warning" | "critical" | "success";
  actionLabel?: string;
  actionRoute?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestedActions?: Array<{ label: string; action: string; params?: any }>;
  followUpQuestions?: string[];
}

interface ETAOverviewEntry {
  orderId: string;
  title: string;
  customerName: string;
  scheduledTime: string;
  estimatedArrival: string;
  delayMinutes: number;
  status: string;
}

interface CommunicationEntry {
  id: number;
  type: string;
  channel: string;
  status: string;
  recipientName: string;
  sentAt: string;
  aiSummary?: string;
}

function InsightCardComponent({ card }: { card: InsightCard }) {
  const severityStyles: Record<string, string> = {
    info: "border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20",
    warning: "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20",
    critical: "border-l-red-500 bg-red-50/50 dark:bg-red-950/20",
    success: "border-l-green-500 bg-green-50/50 dark:bg-green-950/20",
  };

  const severityBadge: Record<string, string> = {
    info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    warning: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  };

  const typeIcons: Record<string, any> = {
    kpi: BarChart3,
    anomaly: AlertTriangle,
    recommendation: Lightbulb,
    trend: TrendingUp,
    warning: Shield,
  };

  const TrendIcon = card.trend === "up" ? ArrowUpRight : card.trend === "down" ? ArrowDownRight : Minus;
  const TypeIcon = typeIcons[card.type] || Sparkles;

  return (
    <Card className={`border-l-4 rounded-lg ${severityStyles[card.severity]} transition-all hover:shadow-md`} data-testid={`insight-card-${card.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1">
            <div className="p-2 rounded-lg bg-background shadow-sm">
              <TypeIcon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-semibold text-sm" data-testid={`text-insight-title-${card.id}`}>{card.title}</h4>
                <Badge className={`text-xs ${severityBadge[card.severity]}`} data-testid={`badge-insight-type-${card.id}`}>
                  {card.type === "kpi" ? "KPI" : card.type === "anomaly" ? "Avvikelse" : card.type === "recommendation" ? "Rekommendation" : card.type === "trend" ? "Trend" : "Varning"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground" data-testid={`text-insight-desc-${card.id}`}>{card.description}</p>
              {card.metric && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-muted-foreground">{card.metric}:</span>
                  <span className="font-bold text-lg" data-testid={`text-insight-value-${card.id}`}>{card.metricValue}</span>
                  {card.trend && <TrendIcon className={`h-4 w-4 ${card.trend === "up" ? "text-green-600" : card.trend === "down" ? "text-red-600" : "text-gray-400"}`} />}
                </div>
              )}
            </div>
          </div>
          {card.actionLabel && (
            <Button variant="outline" size="sm" className="shrink-0" data-testid={`insight-action-${card.id}`}>
              {card.actionLabel}
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PlannerChat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const chatMutation = useMutation({
    mutationFn: async (query: string) => {
      const res = await apiRequest("POST", "/api/ai/planner-chat", {
        query,
        conversationHistory: messages.slice(-6).map(m => ({ role: m.role, content: m.content })),
      });
      return res.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.message,
        suggestedActions: data.suggestedActions,
        followUpQuestions: data.followUpQuestions,
      }]);
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte bearbeta frågan", variant: "destructive" });
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (action: any) => {
      const res = await apiRequest("POST", "/api/ai/planner-chat/execute", action);
      return res.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: data.message || "Åtgärd utförd.",
      }]);
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
  });

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages(prev => [...prev, { role: "user", content: input }]);
    chatMutation.mutate(input);
    setInput("");
  };

  const handleFollowUp = (q: string) => {
    setMessages(prev => [...prev, { role: "user", content: q }]);
    chatMutation.mutate(q);
  };

  return (
    <Card className="h-[500px] flex flex-col" data-testid="planner-chat">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-5 w-5 text-purple-600" />
          AI Planeringsassistent
        </CardTitle>
        <CardDescription>Ställ frågor och ge instruktioner på naturligt språk</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col overflow-hidden p-4 pt-0">
        <ScrollArea className="flex-1 pr-4" ref={scrollRef}>
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Brain className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Fråga mig om planeringen</p>
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  {["Hur ser veckan ut?", "Visa oplanerade ordrar", "Vilka resurser har lägst belastning?"].map(q => (
                    <Button key={q} variant="outline" size="sm" onClick={() => handleFollowUp(q)} data-testid={`chat-suggestion-${q.slice(0,10)}`}>
                      {q}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-4 py-2.5 ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {msg.suggestedActions.map((a, j) => (
                        <Button key={j} size="sm" variant="secondary" className="h-7 text-xs" onClick={() => executeMutation.mutate(a)} data-testid={`chat-action-${j}`}>
                          <Zap className="h-3 w-3 mr-1" />
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {msg.followUpQuestions && msg.followUpQuestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {msg.followUpQuestions.map((q, j) => (
                        <Button key={j} size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleFollowUp(q)} data-testid={`chat-followup-${j}`}>
                          {q}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {chatMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-xl px-4 py-2.5 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Analyserar...</span>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
        <div className="flex gap-2 mt-3 pt-3 border-t">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Skriv din fråga..."
            disabled={chatMutation.isPending}
            data-testid="chat-input"
          />
          <Button onClick={handleSend} disabled={chatMutation.isPending || !input.trim()} data-testid="chat-send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ETAPanel() {
  const { data: etaData, isLoading } = useQuery<ETAOverviewEntry[]>({
    queryKey: ["/api/ai/eta-overview"],
    refetchInterval: 60000,
  });

  const delayCheckMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/eta-check-delays", { thresholdMinutes: 15 });
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <Card data-testid="eta-panel">
        <CardContent className="p-6 flex items-center justify-center h-40">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const delayed = (etaData || []).filter(e => e.delayMinutes > 10);

  return (
    <Card data-testid="eta-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Navigation className="h-5 w-5 text-blue-600" />
              ETA & Förseningar
            </CardTitle>
            <CardDescription>Realtids-ETA för dagens ordrar</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => delayCheckMutation.mutate()} disabled={delayCheckMutation.isPending} data-testid="eta-check-delays">
            {delayCheckMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            <span className="ml-1.5">Kolla förseningar</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {delayCheckMutation.data && (
          <div className="mb-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-sm">
            <p>{delayCheckMutation.data.message || `${delayCheckMutation.data.notified || 0} förseningsnotiser skickade`}</p>
          </div>
        )}
        {delayed.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
            <p className="text-sm">Inga signifikanta förseningar just nu</p>
          </div>
        ) : (
          <div className="space-y-2">
            {delayed.slice(0, 6).map(entry => (
              <div key={entry.orderId} className="flex items-center justify-between p-2.5 rounded-lg bg-red-50/50 dark:bg-red-950/20 border border-red-200/50 dark:border-red-800/30" data-testid={`eta-entry-${entry.orderId}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{entry.title}</p>
                  <p className="text-xs text-muted-foreground">{entry.customerName}</p>
                </div>
                <Badge variant="destructive" className="ml-2 shrink-0">
                  +{entry.delayMinutes} min
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CommunicationsPanel() {
  const { data: comms, isLoading } = useQuery<CommunicationEntry[]>({
    queryKey: ["/api/customer-communications"],
  });

  const channelIcon: Record<string, any> = { email: Mail, sms: Smartphone };

  return (
    <Card data-testid="communications-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-green-600" />
          Kundkommunikation
        </CardTitle>
        <CardDescription>Automatiska AI-meddelanden</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (comms || []).length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Inga meddelanden skickade ännu</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(comms || []).slice(0, 8).map(c => {
              const Icon = channelIcon[c.channel] || Bell;
              return (
                <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors" data-testid={`comm-entry-${c.id}`}>
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{c.recipientName}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.aiSummary || c.type}</p>
                  </div>
                  <Badge variant={c.status === "sent" ? "default" : "secondary"} className="text-xs shrink-0">
                    {c.status === "sent" ? "Skickat" : c.status === "failed" ? "Misslyckades" : "Väntande"}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AssistedPlanningPanel() {
  const [instructions, setInstructions] = useState("");
  const { toast } = useToast();

  const planMutation = useMutation({
    mutationFn: async (inst: string) => {
      const res = await apiRequest("POST", "/api/ai/assisted-plan", {
        instructions: inst,
        weekStart: new Date().toISOString().split("T")[0],
        weekEnd: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Plan genererad", description: data.explanation?.slice(0, 100) || "Klart!" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte skapa plan", variant: "destructive" });
    },
  });

  return (
    <Card data-testid="assisted-planning-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="h-5 w-5 text-orange-600" />
          AI-assisterad Planering
        </CardTitle>
        <CardDescription>Ge instruktioner på naturligt språk</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="T.ex. 'Prioritera brådskande ordrar före lunch, fokusera på område Sthlm Söder'"
          rows={3}
          data-testid="planning-instructions"
        />
        <div className="flex flex-wrap gap-2">
          {["Balansera arbetsbelastning", "Prioritera brådskande ordrar", "Minimera körtid"].map(s => (
            <Button key={s} variant="outline" size="sm" className="text-xs" onClick={() => setInstructions(s)} data-testid={`planning-preset-${s.slice(0,10)}`}>
              {s}
            </Button>
          ))}
        </div>
        <Button onClick={() => planMutation.mutate(instructions)} disabled={planMutation.isPending || !instructions.trim()} className="w-full" data-testid="planning-generate">
          {planMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Genererar plan...</> : <><Sparkles className="h-4 w-4 mr-2" />Skapa AI-plan</>}
        </Button>

        {planMutation.data && (
          <div className="mt-3 p-3 rounded-lg bg-muted/50 space-y-2">
            <p className="text-sm font-medium">Resultat:</p>
            <p className="text-sm text-muted-foreground">{planMutation.data.explanation}</p>
            {planMutation.data.metrics && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                {Object.entries(planMutation.data.metrics).slice(0, 4).map(([k, v]) => (
                  <div key={k} className="text-center p-2 rounded bg-background">
                    <p className="text-xs text-muted-foreground">{k}</p>
                    <p className="font-bold">{String(v)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AICommandCenterPage() {
  const { data: insights, isLoading: insightsLoading, refetch: refetchInsights } = useQuery<InsightCard[]>({
    queryKey: ["/api/ai/insights"],
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Brain className="h-7 w-7 text-purple-600" />
            AI Command Center
          </h1>
          <p className="text-muted-foreground mt-1">Samlade AI-funktioner för intelligent fältservice</p>
        </div>
        <Button variant="outline" onClick={() => refetchInsights()} data-testid="button-refresh-insights">
          <RefreshCw className="h-4 w-4 mr-2" />
          Uppdatera
        </Button>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList data-testid="ai-tabs">
          <TabsTrigger value="overview" data-testid="tab-overview">Översikt</TabsTrigger>
          <TabsTrigger value="planner" data-testid="tab-planner">AI-Planerare</TabsTrigger>
          <TabsTrigger value="eta" data-testid="tab-eta">ETA & Förseningar</TabsTrigger>
          <TabsTrigger value="communication" data-testid="tab-communication">Kommunikation</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div className="md:col-span-2 xl:col-span-2 space-y-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-yellow-600" />
                AI-Insikter
              </h2>
              {insightsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-3">
                  {(insights || []).map(card => (
                    <InsightCardComponent key={card.id} card={card} />
                  ))}
                  {(!insights || insights.length === 0) && (
                    <Card className="p-8 text-center text-muted-foreground">
                      <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p>Inga insikter tillgängliga. Klicka uppdatera för att generera.</p>
                    </Card>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-4">
              <ETAPanel />
              <CommunicationsPanel />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="planner" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PlannerChat />
            <AssistedPlanningPanel />
          </div>
        </TabsContent>

        <TabsContent value="eta">
          <ETAPanel />
        </TabsContent>

        <TabsContent value="communication">
          <CommunicationsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
