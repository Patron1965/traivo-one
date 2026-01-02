import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import { format, isToday, isTomorrow, startOfWeek, endOfWeek } from "date-fns";
import { sv } from "date-fns/locale";
import type { WorkOrder, Resource, ServiceObject } from "@shared/schema";

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
        <div className="mb-8">
          <h1 className="text-3xl font-bold" data-testid="page-title">
            Välkommen till Unicorn
          </h1>
          <p className="text-muted-foreground mt-2">
            {format(today, "EEEE d MMMM yyyy", { locale: sv })}
          </p>
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

        <div className="grid gap-6 lg:grid-cols-3 mb-8">
          <Card className="lg:col-span-2">
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HelpCircle className="h-5 w-5" />
                Snabbhjälp
              </CardTitle>
              <CardDescription>Vanliga frågor</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/30">
                <p className="font-medium text-sm">Hur lägger jag till en ny order?</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Gå till Veckoplanering och klicka på "Ny order" eller använd snabbknappen (+)
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <p className="font-medium text-sm">Hur rapporterar jag ett slutfört jobb?</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Använd Mobilappen för att markera jobbet som klart direkt på plats
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <p className="font-medium text-sm">Hur hittar jag en specifik kund?</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Använd sökfältet i navigeringen eller gå till Objekt
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

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
    </div>
  );
}
