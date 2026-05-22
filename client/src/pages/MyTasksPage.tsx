import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  Eye,
  Phone,
  Image,
  Package,
  History,
  Building2,
  Target,
  Route,
} from "lucide-react";
import { format, isToday, isTomorrow, startOfWeek, endOfWeek } from "date-fns";
import { sv } from "date-fns/locale";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder, Resource, ServiceObject } from "@shared/schema";
import { ProactiveTips } from "@/components/ProactiveTips";
import { Activity, ChevronDown } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ObjectContactsPanel } from "@/components/ObjectContactsPanel";
import { ObjectImagesGallery } from "@/components/ObjectImagesGallery";
import { OnboardingGuide } from "@/components/OnboardingGuide";
import { useLanguage } from "@/hooks/use-language";
import { enUS as enLocale } from "date-fns/locale";

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
  const { t: tl } = useLanguage();
  const [messages, setMessages] = useState<AIMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: tl("ai.greeting"),
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
          pendingOrders: todaysOrders.filter(o => o.orderStatus !== "utford").length,
        },
      });
      return response.json();
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.answer || tl("ai.error-answer"),
      }]);
    },
    onError: () => {
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: tl("ai.error-generic"),
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
          <div className="p-2 rounded-lg bg-chart-5/15">
            <Sparkles className="h-5 w-5 text-chart-5" />
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
                <div className="p-1.5 rounded-full bg-chart-5/15 h-7 w-7 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-chart-5" />
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
              <div className="p-1.5 rounded-full bg-chart-5/15 h-7 w-7 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4 text-chart-5" />
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
            placeholder={tl("ai.input-placeholder")}
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
  const styleMap = {
    warning: {
      card: "bg-chart-4/10 dark:bg-chart-4/15 border-chart-4/20 dark:border-chart-4/80",
      iconBg: "bg-chart-4/15 dark:bg-chart-4/15",
      iconColor: "text-chart-4",
    },
    success: {
      card: "bg-chart-2/10 dark:bg-chart-2/15 border-chart-2/20 dark:border-chart-2/80",
      iconBg: "bg-chart-2/15 dark:bg-chart-2/15",
      iconColor: "text-chart-2",
    },
    default: {
      card: "",
      iconBg: "bg-chart-1/10 dark:bg-chart-1/15",
      iconColor: "text-chart-1",
    },
  };

  const s = styleMap[variant];
  
  return (
    <Link href={href}>
      <Card className={`hover-elevate cursor-pointer transition-all ${s.card}`} data-testid={`card-stat-${title.toLowerCase().replace(/\s/g, '-')}`}>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              <p className="text-3xl font-bold mt-1">{value}</p>
              <p className="text-sm text-muted-foreground mt-2">{description}</p>
            </div>
            <div className={`p-3 rounded-xl ${s.iconBg}`}>
              <Icon className={`h-6 w-6 ${s.iconColor}`} />
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

function getRecentPageMap(tl: (key: string) => string): Record<string, { title: string; icon: React.ElementType; color: string }> {
  return {
    "/": { title: tl("nav.today"), icon: Calendar, color: "text-chart-1" },
    "/home": { title: tl("nav.today"), icon: Calendar, color: "text-chart-1" },
    "/objects": { title: tl("nav.objects"), icon: Building2, color: "text-chart-2" },
    "/resources": { title: tl("nav.resources"), icon: Users, color: "text-chart-5" },
    "/vehicles": { title: tl("nav.vehicles"), icon: Truck, color: "text-chart-4" },
    "/clusters": { title: tl("nav.clusters"), icon: Target, color: "text-chart-3" },
    "/planner": { title: tl("nav.week-planner"), icon: Calendar, color: "text-chart-2" },
    "/order-stock": { title: tl("nav.order-stock"), icon: FileText, color: "text-chart-1" },
    "/routes": { title: tl("nav.route-planning"), icon: Route, color: "text-chart-4" },
    "/dashboard": { title: tl("nav.dashboard"), icon: BarChart3, color: "text-destructive" },
    "/mobile": { title: tl("nav.mobile-field"), icon: Smartphone, color: "text-chart-2" },
  };
}

function RecentPages() {
  const { t: tl } = useLanguage();
  const recentPageMap = getRecentPageMap(tl);
  const [recentUrls, setRecentUrls] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("traivo-recent-pages");
    if (stored) {
      try {
        const urls = JSON.parse(stored) as string[];
        setRecentUrls(urls.filter((url) => url !== "/" && url !== "/home").slice(0, 4));
      } catch {
        setRecentUrls([]);
      }
    }
  }, []);

  if (recentUrls.length === 0) return null;

  return (
    <Card className="mb-8">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="p-1 rounded-md bg-chart-1/15 dark:bg-chart-1/15">
            <History className="h-3.5 w-3.5 text-chart-1" />
          </div>
          Senast besökta
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {recentUrls.map((url) => {
            const page = recentPageMap[url];
            if (!page) return null;
            const Icon = page.icon;
            return (
              <Link key={url} href={url}>
                <Button variant="secondary" size="sm" className="gap-2" data-testid={`recent-page-${url.replace("/", "") || "home"}`}>
                  <Icon className={`h-4 w-4 ${page.color}`} />
                  {page.title}
                </Button>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentChanges({ orders }: { orders: WorkOrder[] }) {
  const { t: tl } = useLanguage();
  const recentlyChanged = orders
    .filter(o => o.createdAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  if (recentlyChanged.length === 0) return null;

  const statusLabels: Record<string, { label: string; color: string }> = {
    skapad: { label: tl("status.skapad"), color: "bg-chart-1/15 text-chart-1 border border-chart-1/30" },
    planerad_pre: { label: tl("status.pre-planned"), color: "bg-chart-3/15 text-chart-3 border border-chart-3/30" },
    planerad_resurs: { label: tl("status.planned"), color: "bg-chart-2/15 text-chart-2 border border-chart-2/30" },
    completed: { label: tl("status.utford"), color: "bg-chart-2/15 text-chart-2 border border-chart-2/30" },
    scheduled: { label: tl("status.scheduled"), color: "bg-chart-5/15 text-chart-5 border border-chart-5/30" },
  };

  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="mb-4" data-testid="card-recent-changes">
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <div className="p-1 rounded-md bg-chart-4/15 dark:bg-chart-4/15">
                  <Activity className="h-3.5 w-3.5 text-chart-4" />
                </div>
                Senaste aktivitet
                <span className="text-xs font-normal text-muted-foreground">({recentlyChanged.length})</span>
              </CardTitle>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
            </div>
            <CardDescription>Senast skapade ordrar</CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            <div className="space-y-2">
              {recentlyChanged.map(order => {
                const s = statusLabels[order.orderStatus] || { label: order.orderStatus, color: "bg-gray-100 text-gray-800" };
                return (
                  <div key={order.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors" data-testid={`recent-change-${order.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{order.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(order.createdAt), "d MMM HH:mm", { locale: sv })}
                      </p>
                    </div>
                    <Badge variant="secondary" className={`text-xs shrink-0 ${s.color}`}>
                      {s.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function DailyProgress({ orders }: { orders: WorkOrder[] }) {
  const todaysOrders = orders.filter((order) => {
    if (!order.scheduledDate) return false;
    return isToday(new Date(order.scheduledDate));
  });

  const completedToday = todaysOrders.filter((o) => o.orderStatus === "utford").length;
  const total = todaysOrders.length;
  const percentage = total > 0 ? Math.round((completedToday / total) * 100) : 0;
  const notStarted = completedToday === 0 && total > 0;

  if (total === 0) return null;

  if (notStarted) {
    return (
      <Card className="mb-8 bg-muted/30 border-border" data-testid="card-daily-progress-ready">
        <CardContent className="py-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="font-semibold">Dagen är redo</p>
              <p className="text-sm text-muted-foreground">
                {total} {total === 1 ? "order planerad" : "ordrar planerade"} — starta första jobbet för att börja räkna framsteg
              </p>
            </div>
            <Badge variant="outline" data-testid="badge-progress-ready">Inte påbörjad</Badge>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-8 bg-gradient-to-r from-[#1B4B6B]/5 via-[#4A9B9B]/5 to-[#7DBFB0]/8 dark:from-[#1B4B6B]/15 dark:via-[#4A9B9B]/10 dark:to-[#7DBFB0]/15 border-[#4A9B9B]/20 dark:border-[#4A9B9B]/30">
      <CardContent className="py-6">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#4A9B9B]/15 dark:bg-[#4A9B9B]/25">
              <CheckCircle2 className="h-5 w-5 text-[#1B4B6B] dark:text-[#7DBFB0]" />
            </div>
            <div>
              <p className="font-semibold">Dagens framsteg</p>
              <p className="text-sm text-muted-foreground">
                {completedToday} av {total} ordrar klara
              </p>
            </div>
          </div>
          <div className="text-3xl font-bold text-[#1B4B6B] dark:text-[#7DBFB0]">{percentage}%</div>
        </div>
        <Progress value={percentage} className="h-2" />
        {percentage === 100 && (
          <p className="text-sm text-primary mt-3 font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Fantastiskt! Alla dagens ordrar är klara!
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TodaysOrdersList({ 
  orders, 
  objectMap, 
  onViewObject 
}: { 
  orders: WorkOrder[]; 
  objectMap: Map<string, ServiceObject>; 
  onViewObject?: (object: ServiceObject) => void;
}) {
  const { t: tl } = useLanguage();
  const todaysOrders = orders.filter(order => {
    if (!order.scheduledDate) return false;
    return isToday(new Date(order.scheduledDate));
  }).slice(0, 5);

  if (todaysOrders.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title={tl("page.today.no-jobs-today")}
        description="Inga arbetsordrar schemalagda för idag. Planera in jobb via veckoplaneraren."
        actionLabel="Öppna Veckoplaneraren"
        onAction={() => window.location.href = "/planner"}
        actionIcon={Calendar}
      />
    );
  }

  return (
    <div className="space-y-3">
      {todaysOrders.map((order) => {
        const object = order.objectId ? objectMap.get(order.objectId) : null;
        const locationName = object?.name || object?.address || tl("common.unknown-location");
        
        return (
          <div
            key={order.id}
            className="flex items-center gap-4 p-4 rounded-lg bg-muted/30 dark:bg-muted/20 border border-transparent hover:border-[#4A9B9B]/20 dark:hover:border-[#4A9B9B]/30 hover-elevate transition-colors"
            data-testid={`order-item-${order.id}`}
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{order.title || order.description || tl("common.order")}</p>
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
            <Badge variant={order.orderStatus === "utford" ? "default" : "secondary"}>
              {order.orderStatus === "utford" ? tl("status.done") : 
               order.orderStatus === "planerad_resurs" ? tl("status.planned") : 
               order.orderStatus === "planerad_las" ? tl("status.planerad_las") : tl("status.new")}
            </Badge>
            {object && onViewObject && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onViewObject(object)}
                data-testid={`button-view-object-${object.id}`}
              >
                <Eye className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MyTasksPage() {
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [selectedObject, setSelectedObject] = useState<ServiceObject | null>(null);
  const [objectDialogOpen, setObjectDialogOpen] = useState(false);
  const { t: tl, language } = useLanguage();
  const dateLocale = language === "en" ? enLocale : sv;
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
    order.orderStatus !== "utford" && 
    order.orderStatus !== "fakturerad" &&
    order.orderStatus !== "avbruten" &&
    order.priority === "high"
  );

  const thisWeekOrders = orders.filter(order => {
    if (!order.scheduledDate) return false;
    const orderDate = new Date(order.scheduledDate);
    return orderDate >= weekStart && orderDate <= weekEnd;
  });

  const completedThisWeek = thisWeekOrders.filter(o => o.orderStatus === "utford").length;
  const activeResources = resources.filter(r => r.status === "active").length;

  const handleViewObject = (obj: ServiceObject) => {
    setSelectedObject(obj);
    setObjectDialogOpen(true);
  };

  return (
    <div className="p-6 space-y-6">
        <div className="rounded-xl bg-gradient-to-r from-[#1B4B6B]/8 via-[#4A9B9B]/6 to-[#7DBFB0]/8 dark:from-[#1B4B6B]/20 dark:via-[#4A9B9B]/15 dark:to-[#7DBFB0]/20 border border-[#1B4B6B]/10 dark:border-[#4A9B9B]/20 p-6 -mx-0">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium text-[#1B4B6B]/70 dark:text-[#7DBFB0]/80 mb-1">
                {format(today, "EEEE d MMMM yyyy", { locale: dateLocale })}
              </p>
              {ordersLoading ? (
                <>
                  <Skeleton className="h-9 w-64 mb-2" />
                  <Skeleton className="h-5 w-48" />
                </>
              ) : (
                <>
                  <h1 className="text-2xl font-semibold text-foreground" data-testid="page-title">
                    {todaysOrders.length > 0 
                      ? `${todaysOrders.length} ${tl("page.today.jobs")}`
                      : tl("page.today.no-jobs")
                    }
                  </h1>
                  <p className="text-muted-foreground mt-2">
                    {todaysOrders.length > 0 
                      ? `${todaysOrders.filter(o => o.orderStatus === "utford").length} ${tl("page.today.completed")}, ${todaysOrders.filter(o => o.orderStatus !== "utford").length} ${tl("page.today.remaining")}`
                      : tl("page.today.plan-new")
                    }
                  </p>
                </>
              )}
            </div>
            <Button 
              onClick={() => setAiPanelOpen(true)}
              className="bg-[#1B4B6B] hover:bg-[#1B4B6B]/90 dark:bg-[#4A9B9B] dark:hover:bg-[#4A9B9B]/90 text-white shadow-sm"
              data-testid="button-open-ai-assistant"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              {tl("page.today.ask-ai")}
            </Button>
          </div>
        </div>

        <OnboardingGuide />

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
              title={tl("page.today.orders")}
              value={todaysOrders.length}
              description={`${todaysOrders.filter(o => o.orderStatus === "utford").length} ${tl("page.today.completed")}`}
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
              title={tl("page.today.urgent")}
              value={urgentOrders.length}
              description={tl("page.today.needs-attention")}
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
              title={tl("page.today.this-week")}
              value={`${completedThisWeek}/${thisWeekOrders.length}`}
              description={tl("page.today.orders-done")}
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
              title={tl("page.today.active-resources")}
              value={activeResources}
              description={`${tl("page.today.of-total")} ${resources.length} ${tl("page.today.total-suffix")}`}
              icon={Users}
              href="/resources"
            />
          )}
        </div>

        {/* Dagens jobb - huvudfokus */}
        <Card className="mb-6 border-l-4 border-l-[#1B4B6B] dark:border-l-[#4A9B9B]">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-[#1B4B6B]/10 dark:bg-[#4A9B9B]/20">
                  <Calendar className="h-4 w-4 text-[#1B4B6B] dark:text-[#4A9B9B]" />
                </div>
                {tl("page.today.todays-jobs")}
              </CardTitle>
              <CardDescription>
                {todaysOrders.length > 0 
                  ? `${todaysOrders.filter(o => o.orderStatus !== "utford").length} ${tl("page.today.jobs-remaining")}`
                  : tl("page.today.no-jobs-today")
                }
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Link href="/mobile">
                <Button size="sm" data-testid="button-start-field-work">
                  <Smartphone className="h-4 w-4 mr-2" />
                  Starta fältarbete
                </Button>
              </Link>
              <Link href="/planner">
                <Button variant="outline" size="sm" data-testid="button-view-planner">
                  {tl("page.planner.title")}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {ordersLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : (
              <TodaysOrdersList orders={orders} objectMap={objectMap} onViewObject={handleViewObject} />
            )}
          </CardContent>
        </Card>

        {/* Daily Progress */}
        {!ordersLoading && <DailyProgress orders={orders} />}

        {/* Recent Pages - compact */}
        <RecentPages />

        {/* Recent Changes */}
        {!ordersLoading && <RecentChanges orders={orders} />}

        {/* Proactive AI Tips - smaller */}
        <ProactiveTips />

      <AIAssistantPanel 
        isOpen={aiPanelOpen} 
        onClose={() => setAiPanelOpen(false)}
        todaysOrders={todaysOrders}
        thisWeekOrders={thisWeekOrders}
      />

      <Dialog open={objectDialogOpen} onOpenChange={setObjectDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {tl("page.today.object-details")}
            </DialogTitle>
            {selectedObject && (
              <DialogDescription>
                {selectedObject.name} - {selectedObject.address || tl("common.no-address")}
              </DialogDescription>
            )}
          </DialogHeader>

          {selectedObject && (
            <Tabs defaultValue="info" className="flex-1 overflow-hidden flex flex-col">
              <TabsList className="shrink-0">
                <TabsTrigger value="info">Information</TabsTrigger>
                <TabsTrigger value="contacts" data-testid="tab-object-contacts">
                  <Phone className="h-3 w-3 mr-1" />
                  Kontakter
                </TabsTrigger>
                <TabsTrigger value="images" data-testid="tab-object-images">
                  <Image className="h-3 w-3 mr-1" />
                  Bilder
                </TabsTrigger>
              </TabsList>

              <TabsContent value="info" className="flex-1 overflow-auto mt-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Typ</div>
                      <div className="font-medium">{selectedObject.objectType}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Adress</div>
                      <div className="font-medium">{selectedObject.address || "-"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Stad</div>
                      <div className="font-medium">{selectedObject.city || "-"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Tillgångstyp</div>
                      <Badge variant="secondary">{selectedObject.accessType || "open"}</Badge>
                    </div>
                    {selectedObject.accessCode && (
                      <div>
                        <div className="text-sm text-muted-foreground">Åtkomstkod</div>
                        <div className="font-medium">{selectedObject.accessCode}</div>
                      </div>
                    )}
                  </div>
                  {selectedObject.notes && (
                    <div>
                      <div className="text-sm text-muted-foreground">Anteckningar</div>
                      <div className="text-sm mt-1 p-3 bg-muted rounded-md">{selectedObject.notes}</div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="contacts" className="flex-1 overflow-auto mt-4">
                <ObjectContactsPanel
                  objectId={selectedObject.id}
                  tenantId={selectedObject.tenantId}
                />
              </TabsContent>

              <TabsContent value="images" className="flex-1 overflow-auto mt-4">
                <ObjectImagesGallery
                  objectId={selectedObject.id}
                  tenantId={selectedObject.tenantId}
                />
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
