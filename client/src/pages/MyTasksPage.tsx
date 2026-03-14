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
import { ObjectContactsPanel } from "@/components/ObjectContactsPanel";
import { ObjectImagesGallery } from "@/components/ObjectImagesGallery";

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

const recentPageMap: Record<string, { title: string; icon: React.ElementType; color: string }> = {
  "/": { title: "Start", icon: Calendar, color: "text-blue-500" },
  "/home": { title: "Start", icon: Calendar, color: "text-blue-500" },
  "/objects": { title: "Objekt", icon: Building2, color: "text-emerald-500" },
  "/resources": { title: "Resurser", icon: Users, color: "text-purple-500" },
  "/vehicles": { title: "Fordon", icon: Truck, color: "text-orange-500" },
  "/clusters": { title: "Kluster", icon: Target, color: "text-cyan-500" },
  "/planner": { title: "Veckoplanering", icon: Calendar, color: "text-green-500" },
  "/order-stock": { title: "Orderstock", icon: FileText, color: "text-indigo-500" },
  "/routes": { title: "Rutter", icon: Route, color: "text-amber-500" },
  "/dashboard": { title: "Dashboard", icon: BarChart3, color: "text-pink-500" },
  "/mobile": { title: "Mobilapp", icon: Smartphone, color: "text-teal-500" },
};

function RecentPages() {
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
          <History className="h-4 w-4 text-muted-foreground" />
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

function DailyProgress({ orders }: { orders: WorkOrder[] }) {
  const todaysOrders = orders.filter((order) => {
    if (!order.scheduledDate) return false;
    return isToday(new Date(order.scheduledDate));
  });

  const completedToday = todaysOrders.filter((o) => o.status === "completed").length;
  const total = todaysOrders.length;
  const percentage = total > 0 ? Math.round((completedToday / total) * 100) : 0;

  if (total === 0) return null;

  return (
    <Card className="mb-8 bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
      <CardContent className="py-6">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold">Dagens framsteg</p>
              <p className="text-sm text-muted-foreground">
                {completedToday} av {total} ordrar klara
              </p>
            </div>
          </div>
          <div className="text-3xl font-bold text-primary">{percentage}%</div>
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

  const handleViewObject = (obj: ServiceObject) => {
    setSelectedObject(obj);
    setObjectDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
          <div>
            <p className="text-muted-foreground text-sm mb-1">
              {format(today, "EEEE d MMMM yyyy", { locale: sv })}
            </p>
            {ordersLoading ? (
              <>
                <Skeleton className="h-9 w-64 mb-2" />
                <Skeleton className="h-5 w-48" />
              </>
            ) : (
              <>
                <h1 className="text-3xl font-bold" data-testid="page-title">
                  {todaysOrders.length > 0 
                    ? `${todaysOrders.length} jobb att utföra idag`
                    : 'Inga jobb schemalagda idag'
                  }
                </h1>
                <p className="text-muted-foreground mt-2">
                  {todaysOrders.length > 0 
                    ? `${todaysOrders.filter(o => o.status === "completed").length} slutförda, ${todaysOrders.filter(o => o.status !== "completed").length} kvar`
                    : 'Planera nya jobb eller se veckans överblick'
                  }
                </p>
              </>
            )}
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

        {/* Dagens jobb - huvudfokus */}
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Dagens jobb
              </CardTitle>
              <CardDescription>
                {todaysOrders.length > 0 
                  ? `${todaysOrders.filter(o => o.status !== "completed").length} jobb kvar att utföra`
                  : 'Inga jobb schemalagda för idag'
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
                  Veckoplanering
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

        {/* Proactive AI Tips - smaller */}
        <ProactiveTips />
      </div>

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
              Objektdetaljer
            </DialogTitle>
            {selectedObject && (
              <DialogDescription>
                {selectedObject.name} - {selectedObject.address || "Ingen adress"}
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
