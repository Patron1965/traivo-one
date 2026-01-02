import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "wouter";
import {
  Calendar,
  MapPin,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Smartphone,
  BarChart3,
  FileText,
  HelpCircle,
  Truck,
  Users,
  MessageCircle,
  Send,
  Loader2,
  Bot,
  User,
  X,
  Sparkles,
} from "lucide-react";
import { format, isToday, isTomorrow, startOfWeek, endOfWeek } from "date-fns";
import { sv } from "date-fns/locale";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder, Resource, ServiceObject } from "@shared/schema";

interface AIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function AIAssistantPanel({ 
  isOpen, 
  onClose,
  todaysOrders,
  thisWeekOrders,
}: { 
  isOpen: boolean; 
  onClose: () => void;
  todaysOrders: WorkOrder[];
  thisWeekOrders: WorkOrder[];
}) {
  const [messages, setMessages] = useState<AIMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hej! Jag är din AI-assistent. Fråga mig om dagens arbete, kommande uppdrag eller om du behöver hjälp med något.",
    }
  ]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const askMutation = useMutation({
    mutationFn: async (question: string) => {
      const response = await apiRequest("POST", "/api/ai/field-assistant", {
        question,
        jobContext: {
          todaysOrderCount: todaysOrders.length,
          thisWeekOrderCount: thisWeekOrders.length,
          pendingOrders: todaysOrders.filter(o => o.status !== "completed").length,
        },
      });
      return response.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.answer || "Jag kunde tyvärr inte svara på det just nu.",
      }]);
    },
    onError: () => {
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: "Ett fel uppstod. Försök igen senare.",
      }]);
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || askMutation.isPending) return;
    
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: "user",
      content: input,
    }]);
    askMutation.mutate(input);
    setInput("");
  };

  if (!isOpen) return null;

  return (
    <Card className="fixed bottom-4 right-4 w-[380px] max-w-[calc(100vw-2rem)] h-[500px] max-h-[calc(100vh-8rem)] flex flex-col shadow-lg z-50" data-testid="panel-ai-assistant">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <Sparkles className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <CardTitle className="text-base">AI-Assistent</CardTitle>
            <CardDescription className="text-xs">Fråga om arbete och planering</CardDescription>
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-ai">
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="p-1.5 rounded-full bg-purple-500/10 h-7 w-7 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-purple-500" />
                </div>
              )}
              <div
                className={`rounded-lg px-3 py-2 max-w-[80%] text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {msg.content}
              </div>
              {msg.role === "user" && (
                <div className="p-1.5 rounded-full bg-primary/10 h-7 w-7 flex items-center justify-center shrink-0">
                  <User className="h-4 w-4 text-primary" />
                </div>
              )}
            </div>
          ))}
          {askMutation.isPending && (
            <div className="flex gap-2 justify-start">
              <div className="p-1.5 rounded-full bg-purple-500/10 h-7 w-7 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4 text-purple-500" />
              </div>
              <div className="bg-muted rounded-lg px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>
      <div className="p-3 border-t shrink-0">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Skriv din fråga..."
            disabled={askMutation.isPending}
            data-testid="input-ai-question"
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={!input.trim() || askMutation.isPending}
            data-testid="button-send-ai"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </Card>
  );
}

function StatCard({ 
  title, 
  value, 
  description, 
  icon: Icon, 
  href,
  variant = "default" 
}: { 
  title: string; 
  value: string | number; 
  description: string; 
  icon: React.ElementType;
  href: string;
  variant?: "default" | "warning" | "success";
}) {
  const bgClass = variant === "warning" 
    ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800" 
    : variant === "success" 
    ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800"
    : "";
  
  return (
    <Link href={href}>
      <Card className={`hover-elevate cursor-pointer transition-all ${bgClass}`} data-testid={`card-stat-${title.toLowerCase().replace(/\s/g, '-')}`}>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{title}</p>
              <p className="text-3xl font-bold mt-1">{value}</p>
              <p className="text-sm text-muted-foreground mt-2">{description}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <Icon className="h-6 w-6 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function QuickActionCard({
  title,
  description,
  icon: Icon,
  href,
  testId,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  testId: string;
}) {
  return (
    <Link href={href}>
      <Card className="hover-elevate cursor-pointer h-full" data-testid={testId}>
        <CardContent className="p-6 flex flex-col h-full">
          <div className="p-3 rounded-lg bg-primary/10 w-fit mb-4">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <h3 className="font-semibold text-lg mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground flex-1">{description}</p>
          <div className="flex items-center gap-2 mt-4 text-sm text-primary">
            <span>Gå till</span>
            <ArrowRight className="h-4 w-4" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function TodaysOrdersList({ orders, objectMap }: { orders: WorkOrder[]; objectMap: Map<string, ServiceObject> }) {
  const todaysOrders = orders.filter(order => {
    if (!order.scheduledDate) return false;
    return isToday(new Date(order.scheduledDate));
  }).slice(0, 5);

  if (todaysOrders.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>Inga ordrar planerade idag</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {todaysOrders.map((order) => {
        const object = order.objectId ? objectMap.get(order.objectId) : null;
        const locationName = object?.name || object?.address || "Okänd plats";
        
        return (
          <div
            key={order.id}
            className="flex items-center gap-4 p-4 rounded-lg bg-muted/30 hover-elevate"
            data-testid={`order-item-${order.id}`}
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{order.title || order.description || "Order"}</p>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                {order.scheduledStartTime && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {order.scheduledStartTime}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {locationName}
                </span>
              </div>
            </div>
            <Badge variant={order.status === "completed" ? "default" : "secondary"}>
              {order.status === "completed" ? "Klar" : 
               order.status === "in_progress" ? "Pågår" : 
               order.status === "scheduled" ? "Planerad" : "Ny"}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

export default function MyTasksPage() {
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });

  const { data: orders = [], isLoading: ordersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: resources = [], isLoading: resourcesLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: objects = [], isLoading: objectsLoading } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const objectMap = new Map(objects.map(o => [o.id, o]));

  const todaysOrders = orders.filter(order => {
    if (!order.scheduledDate) return false;
    return isToday(new Date(order.scheduledDate));
  });

  const urgentOrders = orders.filter(order => 
    order.status !== "completed" && 
    order.status !== "cancelled" &&
    order.priority === "high"
  );

  const thisWeekOrders = orders.filter(order => {
    if (!order.scheduledDate) return false;
    const orderDate = new Date(order.scheduledDate);
    return orderDate >= weekStart && orderDate <= weekEnd;
  });

  const completedThisWeek = thisWeekOrders.filter(o => o.status === "completed").length;
  const activeResources = resources.filter(r => r.status === "active").length;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold" data-testid="page-title">
              Välkommen till Unicorn
            </h1>
            <p className="text-muted-foreground mt-2">
              {format(today, "EEEE d MMMM yyyy", { locale: sv })}
            </p>
          </div>
          <Button 
            onClick={() => setAiPanelOpen(true)}
            className="bg-purple-600 hover:bg-purple-700 text-white"
            data-testid="button-open-ai-assistant"
          >
            <MessageCircle className="h-4 w-4 mr-2" />
            Fråga din AI-assistent
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          {ordersLoading ? (
            <Card>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-4 w-32" />
              </CardContent>
            </Card>
          ) : (
            <StatCard
              title="Dagens ordrar"
              value={todaysOrders.length}
              description={`${todaysOrders.filter(o => o.status === "completed").length} slutförda`}
              icon={Calendar}
              href="/planner"
            />
          )}
          {ordersLoading ? (
            <Card>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-4 w-32" />
              </CardContent>
            </Card>
          ) : (
            <StatCard
              title="Brådskande"
              value={urgentOrders.length}
              description="Kräver uppmärksamhet"
              icon={AlertTriangle}
              href="/order-stock"
              variant={urgentOrders.length > 0 ? "warning" : "default"}
            />
          )}
          {ordersLoading ? (
            <Card>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-4 w-32" />
              </CardContent>
            </Card>
          ) : (
            <StatCard
              title="Denna vecka"
              value={`${completedThisWeek}/${thisWeekOrders.length}`}
              description="Ordrar klara"
              icon={CheckCircle2}
              href="/planner"
              variant={completedThisWeek === thisWeekOrders.length && thisWeekOrders.length > 0 ? "success" : "default"}
            />
          )}
          {resourcesLoading ? (
            <Card>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-4 w-32" />
              </CardContent>
            </Card>
          ) : (
            <StatCard
              title="Aktiva resurser"
              value={activeResources}
              description={`Av ${resources.length} totalt`}
              icon={Users}
              href="/resources"
            />
          )}
        </div>

        <Card className="mb-8">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <div>
              <CardTitle>Dagens arbete</CardTitle>
              <CardDescription>Ordrar planerade för idag</CardDescription>
            </div>
            <Link href="/planner">
              <Button variant="outline" size="sm" data-testid="button-view-planner">
                Se hela planeringen
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : (
              <TodaysOrdersList orders={orders} objectMap={objectMap} />
            )}
          </CardContent>
        </Card>

        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-4">Snabbval</h2>
          <p className="text-muted-foreground mb-6">Gå direkt till de vanligaste funktionerna</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <QuickActionCard
            title="Veckoplanering"
            description="Planera och fördela arbete för veckan"
            icon={Calendar}
            href="/planner"
            testId="quick-action-planner"
          />
          <QuickActionCard
            title="Mobilapp"
            description="Starta fältarbete på mobilen"
            icon={Smartphone}
            href="/mobile"
            testId="quick-action-mobile"
          />
          <QuickActionCard
            title="Dashboard"
            description="Se nyckeltal och statistik"
            icon={BarChart3}
            href="/dashboard"
            testId="quick-action-dashboard"
          />
          <QuickActionCard
            title="Orderstock"
            description="Hantera alla ordrar"
            icon={FileText}
            href="/order-stock"
            testId="quick-action-orders"
          />
        </div>
      </div>

      <AIAssistantPanel 
        isOpen={aiPanelOpen} 
        onClose={() => setAiPanelOpen(false)}
        todaysOrders={todaysOrders}
        thisWeekOrders={thisWeekOrders}
      />
    </div>
  );
}
