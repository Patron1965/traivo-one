import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { 
  Loader2, TrendingUp, TrendingDown, DollarSign, Users, MapPin, BarChart3, 
  CheckCircle2, Clock, Truck, Calendar, Target, ArrowUpRight, ArrowDownRight,
  Package, AlertTriangle, Activity, Zap, FileText, Download, Building2
} from "lucide-react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  BarChart, Bar, Tooltip as RechartsTooltip, Legend, PieChart, Pie, Cell, AreaChart, Area
} from "recharts";
import { format, subDays, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, eachDayOfInterval, eachWeekOfInterval, differenceInMinutes } from "date-fns";
import { sv } from "date-fns/locale";
import type { WorkOrder, Customer, Resource, Cluster } from "@shared/schema";

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  change?: number;
  changeLabel?: string;
  icon: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
}

function KPICard({ title, value, subtitle, change, changeLabel, icon, variant = "default" }: KPICardProps) {
  const variantStyles = {
    default: "bg-card",
    success: "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
    warning: "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800",
    danger: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
  };

  return (
    <Card className={variantStyles[variant]} data-testid={`kpi-card-${title.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
            {change !== undefined && (
              <div className="flex items-center gap-1 mt-2">
                {change >= 0 ? (
                  <ArrowUpRight className="h-3 w-3 text-green-600" />
                ) : (
                  <ArrowDownRight className="h-3 w-3 text-red-600" />
                )}
                <span className={`text-xs font-medium ${change >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {change >= 0 ? "+" : ""}{change}%
                </span>
                {changeLabel && <span className="text-xs text-muted-foreground">{changeLabel}</span>}
              </div>
            )}
          </div>
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReportingDashboardPage() {
  const [timeRange, setTimeRange] = useState<"week" | "month" | "quarter">("month");

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: clusters = [] } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const clusterMap = useMemo(() => new Map(clusters.map(c => [c.id, c])), [clusters]);
  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);
  const resourceMap = useMemo(() => new Map(resources.map(r => [r.id, r])), [resources]);

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (timeRange) {
      case "week":
        return { start: startOfWeek(now, { locale: sv }), end: endOfWeek(now, { locale: sv }) };
      case "month":
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case "quarter":
        return { start: subMonths(startOfMonth(now), 2), end: endOfMonth(now) };
    }
  }, [timeRange]);

  const filteredOrders = useMemo(() => {
    return workOrders.filter(wo => {
      if (!wo.scheduledDate) return false;
      const date = new Date(wo.scheduledDate);
      return date >= dateRange.start && date <= dateRange.end;
    });
  }, [workOrders, dateRange]);

  const previousPeriodOrders = useMemo(() => {
    const periodLength = differenceInMinutes(dateRange.end, dateRange.start);
    const prevStart = new Date(dateRange.start.getTime() - periodLength * 60 * 1000);
    const prevEnd = new Date(dateRange.end.getTime() - periodLength * 60 * 1000);
    
    return workOrders.filter(wo => {
      if (!wo.scheduledDate) return false;
      const date = new Date(wo.scheduledDate);
      return date >= prevStart && date <= prevEnd;
    });
  }, [workOrders, dateRange]);

  const kpis = useMemo(() => {
    const completed = filteredOrders.filter(wo => wo.orderStatus === "utford" || wo.orderStatus === "fakturerad").length;
    const prevCompleted = previousPeriodOrders.filter(wo => wo.orderStatus === "utford" || wo.orderStatus === "fakturerad").length;
    const completionChange = prevCompleted > 0 ? Math.round(((completed - prevCompleted) / prevCompleted) * 100) : 0;

    const totalValue = filteredOrders.reduce((sum, wo) => sum + (wo.cachedValue ?? 0), 0);
    const prevValue = previousPeriodOrders.reduce((sum, wo) => sum + (wo.cachedValue ?? 0), 0);
    const valueChange = prevValue > 0 ? Math.round(((totalValue - prevValue) / prevValue) * 100) : 0;

    const totalCost = filteredOrders.reduce((sum, wo) => sum + (wo.cachedCost ?? 0), 0);
    const margin = totalValue - totalCost;
    const marginPercent = totalValue > 0 ? Math.round((margin / totalValue) * 100) : 0;

    const plannedMinutes = filteredOrders.reduce((sum, wo) => sum + (wo.estimatedDuration ?? 0), 0);
    const actualMinutes = filteredOrders
      .filter(wo => wo.actualDuration)
      .reduce((sum, wo) => sum + (wo.actualDuration ?? 0), 0);
    const efficiency = plannedMinutes > 0 ? Math.round((actualMinutes / plannedMinutes) * 100) : 0;

    const activeResources = new Set(filteredOrders.map(wo => wo.resourceId).filter(Boolean)).size;
    const totalResources = resources.length;
    const utilization = totalResources > 0 ? Math.round((activeResources / totalResources) * 100) : 0;

    const pending = filteredOrders.filter(wo => wo.orderStatus === "skapad" || wo.orderStatus === "planerad_pre").length;
    const urgent = filteredOrders.filter(wo => {
      const metadata = wo.metadata as Record<string, unknown> | null;
      return metadata?.priority === "urgent" || metadata?.priority === "high";
    }).length;

    const avgOrderValue = filteredOrders.length > 0 ? Math.round(totalValue / filteredOrders.length) : 0;

    return {
      totalOrders: filteredOrders.length,
      completed,
      completionChange,
      completionRate: filteredOrders.length > 0 ? Math.round((completed / filteredOrders.length) * 100) : 0,
      totalValue,
      valueChange,
      margin,
      marginPercent,
      efficiency,
      utilization,
      activeResources,
      totalResources,
      pending,
      urgent,
      avgOrderValue
    };
  }, [filteredOrders, previousPeriodOrders, resources]);

  const dailyTrend = useMemo(() => {
    const days = eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
    
    return days.map(day => {
      const dayStart = startOfDay(day);
      const dayEnd = endOfDay(day);
      
      const dayOrders = filteredOrders.filter(wo => {
        if (!wo.scheduledDate) return false;
        const date = new Date(wo.scheduledDate);
        return date >= dayStart && date <= dayEnd;
      });

      const completed = dayOrders.filter(wo => wo.orderStatus === "utford" || wo.orderStatus === "fakturerad").length;
      const value = dayOrders.reduce((sum, wo) => sum + (wo.cachedValue ?? 0), 0);

      return {
        date: format(day, "d MMM", { locale: sv }),
        shortDate: format(day, "d/M"),
        ordrar: dayOrders.length,
        slutförda: completed,
        intäkt: Math.round(value / 1000)
      };
    });
  }, [filteredOrders, dateRange]);

  const statusDistribution = useMemo(() => {
    const statusLabels: Record<string, string> = {
      skapad: "Skapad",
      planerad_pre: "Preliminär",
      planerad_resurs: "Tilldelad",
      planerad_las: "Låst",
      utford: "Utförd",
      fakturerad: "Fakturerad",
      omojlig: "Omöjlig"
    };

    const counts: Record<string, number> = {};
    filteredOrders.forEach(wo => {
      const status = wo.orderStatus || "skapad";
      counts[status] = (counts[status] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([status, count]) => ({
        name: statusLabels[status] || status,
        value: count,
        status
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredOrders]);

  const resourcePerformance = useMemo(() => {
    const data: Record<string, { name: string; orders: number; completed: number; value: number; hours: number }> = {};

    filteredOrders.forEach(wo => {
      if (!wo.resourceId) return;
      
      if (!data[wo.resourceId]) {
        const resource = resourceMap.get(wo.resourceId);
        data[wo.resourceId] = {
          name: resource?.name || "Okänd resurs",
          orders: 0,
          completed: 0,
          value: 0,
          hours: 0
        };
      }

      data[wo.resourceId].orders += 1;
      if (wo.orderStatus === "utford" || wo.orderStatus === "fakturerad") {
        data[wo.resourceId].completed += 1;
      }
      data[wo.resourceId].value += wo.cachedValue ?? 0;
      data[wo.resourceId].hours += (wo.actualDuration ?? wo.estimatedDuration ?? 0) / 60;
    });

    return Object.entries(data)
      .map(([id, d]) => ({
        id,
        ...d,
        completionRate: d.orders > 0 ? Math.round((d.completed / d.orders) * 100) : 0,
        avgValue: d.orders > 0 ? Math.round(d.value / d.orders) : 0
      }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 10);
  }, [filteredOrders, resourceMap]);

  const clusterPerformance = useMemo(() => {
    const data: Record<string, { name: string; orders: number; value: number; margin: number }> = {};

    filteredOrders.forEach(wo => {
      const clusterId = wo.clusterId || "ingen";
      
      if (!data[clusterId]) {
        const cluster = clusterMap.get(clusterId);
        data[clusterId] = {
          name: cluster?.name || "Inget kluster",
          orders: 0,
          value: 0,
          margin: 0
        };
      }

      data[clusterId].orders += 1;
      data[clusterId].value += wo.cachedValue ?? 0;
      data[clusterId].margin += (wo.cachedValue ?? 0) - (wo.cachedCost ?? 0);
    });

    return Object.entries(data)
      .map(([id, d]) => ({
        id,
        ...d,
        marginPercent: d.value > 0 ? Math.round((d.margin / d.value) * 100) : 0
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [filteredOrders, clusterMap]);

  const customerTop = useMemo(() => {
    const data: Record<string, { name: string; orders: number; value: number }> = {};

    filteredOrders.forEach(wo => {
      if (!wo.customerId) return;
      
      if (!data[wo.customerId]) {
        const customer = customerMap.get(wo.customerId);
        data[wo.customerId] = {
          name: customer?.name || "Okänd kund",
          orders: 0,
          value: 0
        };
      }

      data[wo.customerId].orders += 1;
      data[wo.customerId].value += wo.cachedValue ?? 0;
    });

    return Object.entries(data)
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [filteredOrders, customerMap]);

  const COLORS = [
    "hsl(200, 70%, 50%)",
    "hsl(140, 70%, 45%)",
    "hsl(280, 70%, 50%)",
    "hsl(30, 90%, 50%)",
    "hsl(350, 70%, 50%)",
    "hsl(180, 70%, 45%)",
    "hsl(60, 70%, 45%)",
    "hsl(320, 70%, 50%)"
  ];

  if (workOrdersLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" data-testid="reporting-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rapportering & Analys</h1>
          <p className="text-muted-foreground">Nyckeltal och prestationsöversikt</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={timeRange} onValueChange={(v) => setTimeRange(v as typeof timeRange)}>
            <SelectTrigger className="w-[140px]" data-testid="select-time-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">Denna vecka</SelectItem>
              <SelectItem value="month">Denna månad</SelectItem>
              <SelectItem value="quarter">Kvartal</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" data-testid="button-export-report">
            <Download className="h-4 w-4 mr-2" />
            Exportera
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <KPICard
          title="Totalt ordrar"
          value={kpis.totalOrders}
          subtitle={`${kpis.pending} väntande`}
          icon={<FileText className="h-5 w-5 text-primary" />}
        />
        <KPICard
          title="Slutförda"
          value={kpis.completed}
          subtitle={`${kpis.completionRate}% slutförandegrad`}
          change={kpis.completionChange}
          changeLabel="vs föreg."
          icon={<CheckCircle2 className="h-5 w-5 text-green-600" />}
          variant={kpis.completionRate >= 80 ? "success" : kpis.completionRate >= 50 ? "default" : "warning"}
        />
        <KPICard
          title="Intäkter"
          value={`${Math.round(kpis.totalValue / 1000)}k`}
          subtitle={`Snitt ${kpis.avgOrderValue} kr/order`}
          change={kpis.valueChange}
          changeLabel="vs föreg."
          icon={<DollarSign className="h-5 w-5 text-primary" />}
        />
        <KPICard
          title="Marginal"
          value={`${kpis.marginPercent}%`}
          subtitle={`${Math.round(kpis.margin / 1000)}k kr`}
          icon={<TrendingUp className="h-5 w-5 text-green-600" />}
          variant={kpis.marginPercent >= 30 ? "success" : kpis.marginPercent >= 15 ? "default" : "warning"}
        />
        <KPICard
          title="Resursutnyttjande"
          value={`${kpis.utilization}%`}
          subtitle={`${kpis.activeResources}/${kpis.totalResources} aktiva`}
          icon={<Users className="h-5 w-5 text-primary" />}
        />
        <KPICard
          title="Brådskande"
          value={kpis.urgent}
          subtitle="prioriterade ordrar"
          icon={<AlertTriangle className="h-5 w-5 text-orange-500" />}
          variant={kpis.urgent > 5 ? "danger" : kpis.urgent > 0 ? "warning" : "default"}
        />
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList data-testid="tabs-report-sections">
          <TabsTrigger value="overview" data-testid="tab-overview">Översikt</TabsTrigger>
          <TabsTrigger value="resources" data-testid="tab-resources">Resurser</TabsTrigger>
          <TabsTrigger value="areas" data-testid="tab-areas">Områden</TabsTrigger>
          <TabsTrigger value="customers" data-testid="tab-customers">Kunder</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Daglig trend
                </CardTitle>
                <CardDescription>Ordrar och intäkter per dag</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyTrend}>
                      <defs>
                        <linearGradient id="colorOrdrar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(200, 70%, 50%)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(200, 70%, 50%)" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorIntakt" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(140, 70%, 45%)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(140, 70%, 45%)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="shortDate" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                      <YAxis yAxisId="left" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Legend />
                      <Area yAxisId="left" type="monotone" dataKey="ordrar" name="Ordrar" stroke="hsl(200, 70%, 50%)" fill="url(#colorOrdrar)" />
                      <Area yAxisId="right" type="monotone" dataKey="intäkt" name="Intäkt (tkr)" stroke="hsl(140, 70%, 45%)" fill="url(#colorIntakt)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Statusfördelning
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {statusDistribution.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1 mt-2">
                  {statusDistribution.slice(0, 4).map((item, i) => (
                    <div key={item.status} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                        <span className="text-muted-foreground">{item.name}</span>
                      </div>
                      <span className="font-medium">{item.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Topp 5 kunder
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {customerTop.map((customer, i) => (
                    <div key={customer.id} className="flex items-center gap-3">
                      <span className="text-xs font-medium text-muted-foreground w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{customer.name}</p>
                        <p className="text-xs text-muted-foreground">{customer.orders} ordrar</p>
                      </div>
                      <Badge variant="secondary">{Math.round(customer.value / 1000)}k</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Områdesprestanda
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={clusterPerformance.slice(0, 5)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 10 }} />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                      />
                      <Bar dataKey="orders" name="Ordrar" fill="hsl(200, 70%, 50%)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="resources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resursprestanda</CardTitle>
              <CardDescription>Översikt över resursernas arbetsbelastning och prestanda</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {resourcePerformance.map(resource => (
                  <div key={resource.id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{resource.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{resource.orders} ordrar</Badge>
                        <Badge variant="secondary">{Math.round(resource.value / 1000)}k</Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Slutförandegrad</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Progress value={resource.completionRate} className="h-1.5 flex-1" />
                          <span className="text-xs font-medium">{resource.completionRate}%</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Snitt/order</p>
                        <p className="font-medium">{resource.avgValue} kr</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Arbetad tid</p>
                        <p className="font-medium">{Math.round(resource.hours)}h</p>
                      </div>
                    </div>
                  </div>
                ))}
                {resourcePerformance.length === 0 && (
                  <p className="text-muted-foreground text-center py-8">Ingen resursdata för vald period</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="areas" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Kluster/Områden</CardTitle>
              <CardDescription>Intäkter och marginaler per geografiskt område</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={clusterPerformance}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                    />
                    <Legend />
                    <Bar dataKey="value" name="Intäkt" fill="hsl(200, 70%, 50%)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="margin" name="Marginal" fill="hsl(140, 70%, 45%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                {clusterPerformance.slice(0, 4).map(cluster => (
                  <div key={cluster.id} className="text-center p-3 border rounded-lg">
                    <p className="text-sm font-medium truncate">{cluster.name}</p>
                    <p className="text-2xl font-bold text-primary">{cluster.marginPercent}%</p>
                    <p className="text-xs text-muted-foreground">marginal</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customers" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Kundanalys</CardTitle>
              <CardDescription>Värde och ordervolym per kund</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {customerTop.map((customer, i) => (
                    <div key={customer.id} className="flex items-center gap-4 p-3 border rounded-lg">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold">
                        {i + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{customer.name}</p>
                        <p className="text-sm text-muted-foreground">{customer.orders} ordrar under perioden</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg">{Math.round(customer.value).toLocaleString("sv-SE")} kr</p>
                        <p className="text-xs text-muted-foreground">
                          Snitt {customer.orders > 0 ? Math.round(customer.value / customer.orders).toLocaleString("sv-SE") : 0} kr/order
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
