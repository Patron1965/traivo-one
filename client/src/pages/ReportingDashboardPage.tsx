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
  Loader2, TrendingUp, DollarSign, Users, MapPin, BarChart3, 
  CheckCircle2, Clock, Truck, Target, ArrowUpRight, ArrowDownRight,
  AlertTriangle, Activity, Zap, FileText, Download, Building2,
  Timer, Gauge, ShieldAlert, CircleSlash, Award, Star, MessageSquare
} from "lucide-react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  BarChart, Bar, Tooltip as RechartsTooltip, Legend, PieChart, Pie, Cell, 
  AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ComposedChart
} from "recharts";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, eachDayOfInterval, differenceInMinutes } from "date-fns";
import { sv } from "date-fns/locale";
import type { WorkOrder, Customer, Resource, Cluster, DeviationReport } from "@shared/schema";
import { DEVIATION_CATEGORY_LABELS, SEVERITY_LEVEL_LABELS } from "@shared/schema";
import { PredictionAccuracyTab } from "@/components/reporting/PredictionAccuracyTab";

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

const CHART_TOOLTIP_STYLE = { 
  backgroundColor: "hsl(var(--card))", 
  border: "1px solid hsl(var(--border))", 
  borderRadius: "8px",
  fontSize: "12px"
};

const REASON_CATEGORY_LABELS: Record<string, string> = {
  felaktig_ordning: "Felaktig ordningsföljd",
  orimliga_kortider: "Orimliga körtider",
  vagarbete_hinder: "Vägarbete/Hinder",
  for_manga_stopp: "För många stopp",
  saknad_info: "Saknad info",
  trafik: "Trafikproblem",
  optimal: "Optimal rutt",
  ovrigt: "Övrigt",
};

const RATING_COLORS = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#22c55e"];

function RouteFeedbackTab() {
  const [feedbackResourceFilter, setFeedbackResourceFilter] = useState<string>("all");
  const [feedbackDateRange, setFeedbackDateRange] = useState<string>("30d");
  const [feedbackAreaFilter, setFeedbackAreaFilter] = useState<string>("all");

  const { data: clusters } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const dateParams = useMemo(() => {
    const end = new Date();
    const start = new Date();
    if (feedbackDateRange === "7d") start.setDate(start.getDate() - 7);
    else if (feedbackDateRange === "30d") start.setDate(start.getDate() - 30);
    else if (feedbackDateRange === "90d") start.setDate(start.getDate() - 90);
    else start.setFullYear(start.getFullYear() - 1);
    return {
      startDate: start.toISOString().split("T")[0],
      endDate: end.toISOString().split("T")[0],
    };
  }, [feedbackDateRange]);

  const clusterParam = feedbackAreaFilter !== "all" ? `&clusterId=${feedbackAreaFilter}` : "";
  const summaryUrl = `/api/route-feedback/summary?startDate=${dateParams.startDate}&endDate=${dateParams.endDate}${clusterParam}`;
  const { data: summary, isLoading, isError } = useQuery<{
    avgRating: number;
    totalCount: number;
    byCategory: Record<string, number>;
    byResource: { resourceId: string; resourceName: string; avgRating: number; count: number }[];
    ratingDistribution: Record<string, number>;
    byDay: { date: string; avgRating: number; count: number }[];
  }>({
    queryKey: [summaryUrl],
  });

  const listUrl = `/api/route-feedback?limit=50&startDate=${dateParams.startDate}&endDate=${dateParams.endDate}${feedbackResourceFilter !== "all" ? `&resourceId=${feedbackResourceFilter}` : ""}${clusterParam}`;
  const { data: recentFeedback } = useQuery<Array<{
    id: string;
    resourceName: string;
    date: string;
    rating: number;
    reasonCategory: string | null;
    freeText: string | null;
  }>>({
    queryKey: [listUrl],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h3 className="text-lg font-medium mb-2">Kunde inte ladda feedback</h3>
          <p className="text-sm text-muted-foreground">Ett fel uppstod vid hämtning av rutt-feedback. Försök ladda om sidan.</p>
        </CardContent>
      </Card>
    );
  }

  if (!summary || summary.totalCount === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Star className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">Ingen rutt-feedback ännu</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Förare kan betygsätta sina dagliga rutter via mobilappen. Feedback visas här när den börjar komma in.
          </p>
        </CardContent>
      </Card>
    );
  }

  const ratingData = Object.entries(summary.ratingDistribution).map(([rating, count]) => ({
    rating: `${rating} ★`,
    count: count as number,
    fill: RATING_COLORS[parseInt(rating) - 1],
  }));

  const categoryData = Object.entries(summary.byCategory).map(([cat, count]) => ({
    category: REASON_CATEGORY_LABELS[cat] || cat,
    count: count as number,
  })).sort((a, b) => b.count - a.count);

  const resourceData = [...summary.byResource]
    .sort((a, b) => b.avgRating - a.avgRating)
    .slice(0, 10);

  const dailyTrend = summary?.byDay || [];

  return (
    <>
      <div className="flex flex-wrap gap-3 items-center" data-testid="feedback-filters">
        <Select value={feedbackDateRange} onValueChange={setFeedbackDateRange}>
          <SelectTrigger className="w-[160px]" data-testid="feedback-date-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Senaste 7 dagar</SelectItem>
            <SelectItem value="30d">Senaste 30 dagar</SelectItem>
            <SelectItem value="90d">Senaste 90 dagar</SelectItem>
            <SelectItem value="1y">Senaste året</SelectItem>
          </SelectContent>
        </Select>
        {summary && summary.byResource.length > 0 && (
          <Select value={feedbackResourceFilter} onValueChange={setFeedbackResourceFilter}>
            <SelectTrigger className="w-[200px]" data-testid="feedback-resource-filter">
              <SelectValue placeholder="Alla förare" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla förare</SelectItem>
              {summary.byResource.map((r) => (
                <SelectItem key={r.resourceId} value={r.resourceId}>{r.resourceName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {clusters && clusters.length > 0 && (
          <Select value={feedbackAreaFilter} onValueChange={setFeedbackAreaFilter}>
            <SelectTrigger className="w-[200px]" data-testid="feedback-area-filter">
              <SelectValue placeholder="Alla områden" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla områden</SelectItem>
              {clusters.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Snittbetyg"
          value={`${summary.avgRating}/5`}
          icon={<Star className="h-4 w-4 text-yellow-500" />}
          subtitle={`Baserat på ${summary.totalCount} svar`}
        />
        <KPICard
          title="Antal svar"
          value={summary.totalCount}
          icon={<MessageSquare className="h-4 w-4 text-blue-500" />}
        />
        <KPICard
          title="Nöjda förare (4-5)"
          value={`${summary.totalCount > 0 ? Math.round((((summary.ratingDistribution[4] || 0) + (summary.ratingDistribution[5] || 0)) / summary.totalCount) * 100) : 0}%`}
          icon={<Award className="h-4 w-4 text-green-500" />}
        />
        <KPICard
          title="Kategorier"
          value={Object.keys(summary.byCategory).length}
          icon={<BarChart3 className="h-4 w-4 text-purple-500" />}
          subtitle="unika orsaker"
        />
      </div>

      {dailyTrend.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Betyg över tid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} />
                <RechartsTooltip />
                <Area type="monotone" dataKey="avgRating" name="Snittbetyg" stroke="#4A9B9B" fill="#4A9B9B" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="h-4 w-4" />
              Betygsfördelning
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={ratingData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="rating" />
                <YAxis allowDecimals={false} />
                <RechartsTooltip />
                <Bar dataKey="count" name="Antal">
                  {ratingData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {categoryData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Orsaker
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={categoryData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis dataKey="category" type="category" width={120} tick={{ fontSize: 12 }} />
                  <RechartsTooltip />
                  <Bar dataKey="count" name="Antal" fill="#4A9B9B" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {resourceData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Snittbetyg per förare
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {resourceData.map((r) => (
                <div key={r.resourceId} className="flex items-center gap-3" data-testid={`feedback-resource-${r.resourceId}`}>
                  <div className="w-32 truncate text-sm font-medium">{r.resourceName}</div>
                  <div className="flex-1">
                    <Progress value={(r.avgRating / 5) * 100} className="h-2" />
                  </div>
                  <div className="flex items-center gap-1 w-20 justify-end">
                    <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                    <span className="text-sm font-medium">{r.avgRating}</span>
                    <span className="text-xs text-muted-foreground">({r.count})</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {recentFeedback && recentFeedback.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Senaste feedback
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {recentFeedback.map((fb) => (
                  <div key={fb.id} className="flex items-start gap-3 p-3 rounded-lg border" data-testid={`feedback-item-${fb.id}`}>
                    <div className="flex items-center gap-0.5 mt-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`h-3.5 w-3.5 ${s <= fb.rating ? "text-yellow-500 fill-yellow-500" : "text-gray-300"}`}
                        />
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{fb.resourceName}</span>
                        <span className="text-muted-foreground">{fb.date}</span>
                        {fb.reasonCategory && (
                          <Badge variant="outline" className="text-xs">
                            {REASON_CATEGORY_LABELS[fb.reasonCategory] || fb.reasonCategory}
                          </Badge>
                        )}
                      </div>
                      {fb.freeText && (
                        <p className="text-sm text-muted-foreground mt-1">{fb.freeText}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </>
  );
}

export default function ReportingDashboardPage() {
  const [timeRange, setTimeRange] = useState<"week" | "month" | "quarter">("month");

  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders", { allDates: true }],
    queryFn: async () => {
      const res = await fetch("/api/work-orders?allDates=true");
      if (!res.ok) throw new Error("Failed to fetch work orders");
      return res.json();
    },
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

  const { data: deviations = [] } = useQuery<DeviationReport[]>({
    queryKey: ["/api/deviation-reports"],
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

  const filteredDeviations = useMemo(() => {
    return deviations.filter(d => {
      if (!d.reportedAt) return false;
      const date = new Date(d.reportedAt);
      return date >= dateRange.start && date <= dateRange.end;
    });
  }, [deviations, dateRange]);

  const previousPeriodDeviations = useMemo(() => {
    const periodLength = differenceInMinutes(dateRange.end, dateRange.start);
    const prevStart = new Date(dateRange.start.getTime() - periodLength * 60 * 1000);
    const prevEnd = new Date(dateRange.end.getTime() - periodLength * 60 * 1000);
    return deviations.filter(d => {
      if (!d.reportedAt) return false;
      const date = new Date(d.reportedAt);
      return date >= prevStart && date <= prevEnd;
    });
  }, [deviations, dateRange]);

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
      avgOrderValue,
      plannedMinutes,
      actualMinutes
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
    const data: Record<string, { name: string; orders: number; completed: number; value: number; hours: number; plannedHours: number; actualHours: number; deviationCount: number }> = {};

    filteredOrders.forEach(wo => {
      if (!wo.resourceId) return;
      
      if (!data[wo.resourceId]) {
        const resource = resourceMap.get(wo.resourceId);
        data[wo.resourceId] = {
          name: resource?.name || "Okänd resurs",
          orders: 0,
          completed: 0,
          value: 0,
          hours: 0,
          plannedHours: 0,
          actualHours: 0,
          deviationCount: 0
        };
      }

      data[wo.resourceId].orders += 1;
      if (wo.orderStatus === "utford" || wo.orderStatus === "fakturerad") {
        data[wo.resourceId].completed += 1;
      }
      data[wo.resourceId].value += wo.cachedValue ?? 0;
      data[wo.resourceId].plannedHours += (wo.estimatedDuration ?? 0) / 60;
      data[wo.resourceId].actualHours += (wo.actualDuration ?? 0) / 60;
      data[wo.resourceId].hours += (wo.actualDuration ?? wo.estimatedDuration ?? 0) / 60;
    });

    filteredDeviations.forEach(d => {
      if (d.workOrderId) {
        const wo = filteredOrders.find(w => w.id === d.workOrderId);
        if (wo?.resourceId && data[wo.resourceId]) {
          data[wo.resourceId].deviationCount += 1;
        }
      }
    });

    return Object.entries(data)
      .map(([id, d]) => ({
        id,
        ...d,
        completionRate: d.orders > 0 ? Math.round((d.completed / d.orders) * 100) : 0,
        avgValue: d.orders > 0 ? Math.round(d.value / d.orders) : 0,
        efficiency: d.plannedHours > 0 ? Math.round((d.actualHours / d.plannedHours) * 100) : 0,
        ordersPerHour: d.hours > 0 ? Math.round((d.completed / d.hours) * 10) / 10 : 0
      }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 10);
  }, [filteredOrders, resourceMap, filteredDeviations]);

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

  // --- Productivity data ---
  const productivityTrend = useMemo(() => {
    const days = eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
    return days.map(day => {
      const dayStart = startOfDay(day);
      const dayEnd = endOfDay(day);
      const dayOrders = filteredOrders.filter(wo => {
        if (!wo.scheduledDate) return false;
        const d = new Date(wo.scheduledDate);
        return d >= dayStart && d <= dayEnd;
      });
      const planned = dayOrders.reduce((s, wo) => s + (wo.estimatedDuration ?? 0), 0) / 60;
      const actual = dayOrders.filter(wo => wo.actualDuration).reduce((s, wo) => s + (wo.actualDuration ?? 0), 0) / 60;
      const completed = dayOrders.filter(wo => wo.orderStatus === "utford" || wo.orderStatus === "fakturerad").length;
      const activeRes = new Set(dayOrders.map(wo => wo.resourceId).filter(Boolean)).size;
      return {
        date: format(day, "d MMM", { locale: sv }),
        shortDate: format(day, "d/M"),
        planerat: Math.round(planned * 10) / 10,
        faktiskt: Math.round(actual * 10) / 10,
        slutförda: completed,
        resurser: activeRes,
        effektivitet: planned > 0 ? Math.round((actual / planned) * 100) : 0
      };
    });
  }, [filteredOrders, dateRange]);

  const resourceRadar = useMemo(() => {
    if (resourcePerformance.length === 0) return [];
    const maxOrders = Math.max(1, ...resourcePerformance.map(rp => rp.orders));
    const maxValue = Math.max(1, ...resourcePerformance.map(rp => rp.value));
    return resourcePerformance.slice(0, 6).map(r => ({
      name: r.name.split(" ")[0],
      slutförda: r.completionRate,
      effektivitet: Math.min(r.efficiency || 0, 150),
      ordrar: Math.min(Math.round((r.orders / maxOrders) * 100), 100),
      intäkt: Math.min(Math.round((r.value / maxValue) * 100), 100),
      tempo: Math.min(Math.round((r.ordersPerHour || 0) * 50), 100)
    }));
  }, [resourcePerformance]);

  // --- Completion data ---
  const completionTrend = useMemo(() => {
    const days = eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
    let cumulativeCompleted = 0;
    let cumulativeTotal = 0;
    return days.map(day => {
      const dayStart = startOfDay(day);
      const dayEnd = endOfDay(day);
      const dayOrders = filteredOrders.filter(wo => {
        if (!wo.scheduledDate) return false;
        const d = new Date(wo.scheduledDate);
        return d >= dayStart && d <= dayEnd;
      });
      const total = dayOrders.length;
      const completed = dayOrders.filter(wo => wo.orderStatus === "utford" || wo.orderStatus === "fakturerad").length;
      const failed = dayOrders.filter(wo => wo.orderStatus === "omojlig").length;
      cumulativeTotal += total;
      cumulativeCompleted += completed;
      return {
        date: format(day, "d MMM", { locale: sv }),
        shortDate: format(day, "d/M"),
        totalt: total,
        slutförda: completed,
        misslyckade: failed,
        kumulativGrad: cumulativeTotal > 0 ? Math.round((cumulativeCompleted / cumulativeTotal) * 100) : 0
      };
    });
  }, [filteredOrders, dateRange]);

  const completionByPriority = useMemo(() => {
    const priorities: Record<string, { label: string; total: number; completed: number }> = {
      standard: { label: "Standard", total: 0, completed: 0 },
      high: { label: "Hög", total: 0, completed: 0 },
      urgent: { label: "Brådskande", total: 0, completed: 0 },
      low: { label: "Låg", total: 0, completed: 0 }
    };
    filteredOrders.forEach(wo => {
      const p = wo.priority || "standard";
      if (!priorities[p]) priorities[p] = { label: p, total: 0, completed: 0 };
      priorities[p].total += 1;
      if (wo.orderStatus === "utford" || wo.orderStatus === "fakturerad") {
        priorities[p].completed += 1;
      }
    });
    return Object.entries(priorities)
      .filter(([, v]) => v.total > 0)
      .map(([key, v]) => ({
        priority: key,
        name: v.label,
        totalt: v.total,
        slutförda: v.completed,
        grad: v.total > 0 ? Math.round((v.completed / v.total) * 100) : 0
      }));
  }, [filteredOrders]);

  const avgCompletionTime = useMemo(() => {
    const withDuration = filteredOrders.filter(wo => 
      (wo.orderStatus === "utford" || wo.orderStatus === "fakturerad") && wo.actualDuration
    );
    if (withDuration.length === 0) return 0;
    const total = withDuration.reduce((s, wo) => s + (wo.actualDuration ?? 0), 0);
    return Math.round(total / withDuration.length);
  }, [filteredOrders]);

  // --- Deviation data ---
  const deviationsByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredDeviations.forEach(d => {
      const cat = d.category || "other";
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([cat, count]) => ({
        category: cat,
        name: (DEVIATION_CATEGORY_LABELS as Record<string, string>)[cat] || cat,
        value: count
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredDeviations]);

  const deviationsBySeverity = useMemo(() => {
    const severityOrder = ["critical", "high", "medium", "low"];
    const counts: Record<string, number> = {};
    filteredDeviations.forEach(d => {
      const sev = d.severityLevel || "medium";
      counts[sev] = (counts[sev] || 0) + 1;
    });
    return severityOrder
      .filter(s => counts[s])
      .map(s => ({
        severity: s,
        name: (SEVERITY_LEVEL_LABELS as Record<string, string>)[s] || s,
        value: counts[s] || 0
      }));
  }, [filteredDeviations]);

  const deviationTrend = useMemo(() => {
    const days = eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
    return days.map(day => {
      const dayStart = startOfDay(day);
      const dayEnd = endOfDay(day);
      const dayDevs = filteredDeviations.filter(d => {
        if (!d.reportedAt) return false;
        const date = new Date(d.reportedAt);
        return date >= dayStart && date <= dayEnd;
      });
      const resolved = dayDevs.filter(d => d.status === "resolved" || d.status === "closed").length;
      return {
        date: format(day, "d MMM", { locale: sv }),
        shortDate: format(day, "d/M"),
        rapporterade: dayDevs.length,
        åtgärdade: resolved,
        öppna: dayDevs.length - resolved
      };
    });
  }, [filteredDeviations, dateRange]);

  const deviationStatusSummary = useMemo(() => {
    const statusLabels: Record<string, string> = {
      open: "Öppen",
      in_progress: "Pågående",
      resolved: "Åtgärdad",
      closed: "Stängd"
    };
    const counts: Record<string, number> = {};
    filteredDeviations.forEach(d => {
      const st = d.status || "open";
      counts[st] = (counts[st] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([st, count]) => ({
        status: st,
        name: statusLabels[st] || st,
        value: count
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredDeviations]);

  const deviationKpis = useMemo(() => {
    const total = filteredDeviations.length;
    const prevTotal = previousPeriodDeviations.length;
    const change = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0;
    const resolved = filteredDeviations.filter(d => d.status === "resolved" || d.status === "closed").length;
    const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;
    const critical = filteredDeviations.filter(d => d.severityLevel === "critical" || d.severityLevel === "high").length;
    const open = filteredDeviations.filter(d => d.status === "open" || d.status === "in_progress").length;
    return { total, change, resolved, resolutionRate, critical, open };
  }, [filteredDeviations, previousPeriodDeviations]);

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

  const SEVERITY_COLORS: Record<string, string> = {
    critical: "hsl(0, 80%, 50%)",
    high: "hsl(25, 90%, 55%)",
    medium: "hsl(45, 90%, 50%)",
    low: "hsl(200, 70%, 50%)"
  };

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
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Rapportering & Analys</h1>
          <p className="text-muted-foreground">Nyckeltal, produktivitet och avvikelsestatistik</p>
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
          title="Avvikelser"
          value={deviationKpis.total}
          subtitle={`${deviationKpis.open} öppna`}
          change={deviationKpis.change}
          changeLabel="vs föreg."
          icon={<AlertTriangle className="h-5 w-5 text-orange-500" />}
          variant={deviationKpis.critical > 3 ? "danger" : deviationKpis.total > 0 ? "warning" : "default"}
        />
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList data-testid="tabs-report-sections" className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview" data-testid="tab-overview">Översikt</TabsTrigger>
          <TabsTrigger value="productivity" data-testid="tab-productivity">Produktivitet</TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-completed">Slutförda</TabsTrigger>
          <TabsTrigger value="deviations" data-testid="tab-deviations">Avvikelser</TabsTrigger>
          <TabsTrigger value="resources" data-testid="tab-resources">Resurser</TabsTrigger>
          <TabsTrigger value="areas" data-testid="tab-areas">Områden</TabsTrigger>
          <TabsTrigger value="customers" data-testid="tab-customers">Kunder</TabsTrigger>
          <TabsTrigger value="route-feedback" data-testid="tab-route-feedback">Rutt-feedback</TabsTrigger>
          <TabsTrigger value="prediction" data-testid="tab-prediction">Prediktionsnoggrannhet</TabsTrigger>
        </TabsList>

        {/* === OVERVIEW TAB === */}
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
                      <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "hsl(var(--foreground))" }} />
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
                      <Pie data={statusDistribution} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                        {statusDistribution.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
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
                      <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      <Bar dataKey="orders" name="Ordrar" fill="hsl(200, 70%, 50%)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* === PRODUCTIVITY TAB === */}
        <TabsContent value="productivity" className="space-y-4" data-testid="tab-content-productivity">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              title="Effektivitet"
              value={`${kpis.efficiency}%`}
              subtitle="Faktisk / Planerad tid"
              icon={<Gauge className="h-5 w-5 text-primary" />}
              variant={kpis.efficiency > 0 && kpis.efficiency <= 110 ? "success" : kpis.efficiency > 110 ? "warning" : "default"}
            />
            <KPICard
              title="Planerad tid"
              value={`${Math.round(kpis.plannedMinutes / 60)}h`}
              subtitle={`${filteredOrders.length} ordrar`}
              icon={<Clock className="h-5 w-5 text-primary" />}
            />
            <KPICard
              title="Faktisk tid"
              value={`${Math.round(kpis.actualMinutes / 60)}h`}
              subtitle={kpis.actualMinutes > kpis.plannedMinutes ? "Mer än planerat" : "Under planerad"}
              icon={<Timer className="h-5 w-5 text-primary" />}
              variant={kpis.actualMinutes > kpis.plannedMinutes * 1.2 ? "warning" : "default"}
            />
            <KPICard
              title="Snitt tid/order"
              value={`${avgCompletionTime} min`}
              subtitle="slutförda ordrar"
              icon={<Target className="h-5 w-5 text-primary" />}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Tidseffektivitet per dag
                </CardTitle>
                <CardDescription>Planerad vs faktisk tid (timmar)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]" data-testid="chart-productivity-trend">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={productivityTrend}>
                      <defs>
                        <linearGradient id="gradPlanerat" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(200, 70%, 50%)" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="hsl(200, 70%, 50%)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="shortDate" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      <Legend />
                      <Area type="monotone" dataKey="planerat" name="Planerat (h)" stroke="hsl(200, 70%, 50%)" fill="url(#gradPlanerat)" />
                      <Bar dataKey="faktiskt" name="Faktiskt (h)" fill="hsl(140, 70%, 45%)" radius={[2, 2, 0, 0]} barSize={12} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Effektivitetstrend
                </CardTitle>
                <CardDescription>Daglig effektivitet (faktisk/planerad %)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]" data-testid="chart-efficiency-trend">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={productivityTrend}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="shortDate" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} domain={[0, 'auto']} />
                      <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value: number) => [`${value}%`, "Effektivitet"]} />
                      <Line type="monotone" dataKey="effektivitet" name="Effektivitet %" stroke="hsl(280, 70%, 50%)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      {/* 100% reference line */}
                      <Line type="monotone" dataKey={() => 100} name="Mål (100%)" stroke="hsl(0, 0%, 60%)" strokeDasharray="5 5" strokeWidth={1} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Award className="h-4 w-4" />
                  Resursprestanda jämförelse
                </CardTitle>
                <CardDescription>Relativ prestanda per resurs</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]" data-testid="chart-resource-radar">
                  {resourceRadar.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={resourceRadar}>
                        <PolarGrid className="stroke-muted" />
                        <PolarAngleAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <PolarRadiusAxis tick={{ fontSize: 9 }} domain={[0, 100]} />
                        <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                        <Radar name="Slutförandegrad" dataKey="slutförda" stroke="hsl(200, 70%, 50%)" fill="hsl(200, 70%, 50%)" fillOpacity={0.2} />
                        <Radar name="Effektivitet" dataKey="effektivitet" stroke="hsl(140, 70%, 45%)" fill="hsl(140, 70%, 45%)" fillOpacity={0.15} />
                        <Radar name="Tempo" dataKey="tempo" stroke="hsl(280, 70%, 50%)" fill="hsl(280, 70%, 50%)" fillOpacity={0.1} />
                        <Legend />
                      </RadarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      Ingen resursdata tillgänglig
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Resursranking
                </CardTitle>
                <CardDescription>Ordrar per timme och slutförandegrad</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]" data-testid="chart-resource-ranking">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={resourcePerformance.slice(0, 8)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 10 }} />
                      <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      <Legend />
                      <Bar dataKey="completed" name="Slutförda" fill="hsl(140, 70%, 45%)" radius={[0, 2, 2, 0]} barSize={10} />
                      <Bar dataKey="orders" name="Totalt" fill="hsl(200, 70%, 50%)" radius={[0, 2, 2, 0]} barSize={10} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* === COMPLETED TAB === */}
        <TabsContent value="completed" className="space-y-4" data-testid="tab-content-completed">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              title="Slutförda"
              value={kpis.completed}
              subtitle={`av ${kpis.totalOrders} totalt`}
              change={kpis.completionChange}
              changeLabel="vs föreg."
              icon={<CheckCircle2 className="h-5 w-5 text-green-600" />}
              variant="success"
            />
            <KPICard
              title="Slutförandegrad"
              value={`${kpis.completionRate}%`}
              subtitle="i perioden"
              icon={<Target className="h-5 w-5 text-primary" />}
              variant={kpis.completionRate >= 80 ? "success" : kpis.completionRate >= 50 ? "default" : "warning"}
            />
            <KPICard
              title="Snitt tid"
              value={`${avgCompletionTime} min`}
              subtitle="per slutförd order"
              icon={<Timer className="h-5 w-5 text-primary" />}
            />
            <KPICard
              title="Misslyckade"
              value={filteredOrders.filter(wo => wo.orderStatus === "omojlig").length}
              subtitle="markerade omöjliga"
              icon={<CircleSlash className="h-5 w-5 text-red-500" />}
              variant={filteredOrders.filter(wo => wo.orderStatus === "omojlig").length > 3 ? "danger" : "default"}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Slutförandetrend
                </CardTitle>
                <CardDescription>Daglig slutförandegrad och volymer</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]" data-testid="chart-completion-trend">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={completionTrend}>
                      <defs>
                        <linearGradient id="gradSlutforda" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(140, 70%, 45%)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(140, 70%, 45%)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="shortDate" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 100]} />
                      <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      <Legend />
                      <Area yAxisId="left" type="monotone" dataKey="slutförda" name="Slutförda" stroke="hsl(140, 70%, 45%)" fill="url(#gradSlutforda)" />
                      <Bar yAxisId="left" dataKey="misslyckade" name="Misslyckade" fill="hsl(350, 70%, 50%)" radius={[2, 2, 0, 0]} barSize={8} />
                      <Line yAxisId="right" type="monotone" dataKey="kumulativGrad" name="Kumulativ %" stroke="hsl(280, 70%, 50%)" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Per prioritet
                </CardTitle>
                <CardDescription>Slutförandegrad per prioritetsnivå</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]" data-testid="chart-completion-by-priority">
                  {completionByPriority.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={completionByPriority}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                        <Legend />
                        <Bar dataKey="totalt" name="Totalt" fill="hsl(200, 70%, 50%)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="slutförda" name="Slutförda" fill="hsl(140, 70%, 45%)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      Inga ordrar med prioritetsdata
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Slutförandegrad per resurs
              </CardTitle>
              <CardDescription>Jämförelse mellan resurser</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]" data-testid="chart-completion-by-resource">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={resourcePerformance.slice(0, 10)}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value: number) => [`${value}%`, "Slutförandegrad"]} />
                    <Bar dataKey="completionRate" name="Slutförandegrad %" fill="hsl(200, 70%, 50%)" radius={[4, 4, 0, 0]}>
                      {resourcePerformance.slice(0, 10).map((entry, i) => (
                        <Cell 
                          key={`cell-${i}`} 
                          fill={entry.completionRate >= 80 ? "hsl(140, 70%, 45%)" : entry.completionRate >= 50 ? "hsl(45, 90%, 50%)" : "hsl(350, 70%, 50%)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* === DEVIATIONS TAB === */}
        <TabsContent value="deviations" className="space-y-4" data-testid="tab-content-deviations">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              title="Avvikelser"
              value={deviationKpis.total}
              change={deviationKpis.change}
              changeLabel="vs föreg."
              icon={<AlertTriangle className="h-5 w-5 text-orange-500" />}
              variant={deviationKpis.total > 10 ? "danger" : deviationKpis.total > 0 ? "warning" : "default"}
            />
            <KPICard
              title="Åtgärdsgrad"
              value={`${deviationKpis.resolutionRate}%`}
              subtitle={`${deviationKpis.resolved} åtgärdade`}
              icon={<CheckCircle2 className="h-5 w-5 text-green-600" />}
              variant={deviationKpis.resolutionRate >= 80 ? "success" : deviationKpis.resolutionRate >= 50 ? "default" : "warning"}
            />
            <KPICard
              title="Kritiska"
              value={deviationKpis.critical}
              subtitle="hög/kritisk allvarlighet"
              icon={<ShieldAlert className="h-5 w-5 text-red-500" />}
              variant={deviationKpis.critical > 0 ? "danger" : "default"}
            />
            <KPICard
              title="Öppna"
              value={deviationKpis.open}
              subtitle="väntar på åtgärd"
              icon={<Clock className="h-5 w-5 text-primary" />}
              variant={deviationKpis.open > 5 ? "warning" : "default"}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Avvikelsetrend
                </CardTitle>
                <CardDescription>Rapporterade och åtgärdade per dag</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]" data-testid="chart-deviation-trend">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={deviationTrend}>
                      <defs>
                        <linearGradient id="gradRapporterade" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(350, 70%, 50%)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(350, 70%, 50%)" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="gradAtgardade" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(140, 70%, 45%)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(140, 70%, 45%)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="shortDate" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      <Legend />
                      <Area type="monotone" dataKey="rapporterade" name="Rapporterade" stroke="hsl(350, 70%, 50%)" fill="url(#gradRapporterade)" />
                      <Area type="monotone" dataKey="åtgärdade" name="Åtgärdade" stroke="hsl(140, 70%, 45%)" fill="url(#gradAtgardade)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Per kategori
                </CardTitle>
                <CardDescription>Avvikelser fördelade per typ</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]" data-testid="chart-deviation-by-category">
                  {deviationsByCategory.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={deviationsByCategory} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                        <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10 }} />
                        <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                        <Bar dataKey="value" name="Antal" fill="hsl(30, 90%, 50%)" radius={[0, 4, 4, 0]}>
                          {deviationsByCategory.map((_, i) => (
                            <Cell key={`cat-${i}`} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      Inga avvikelser i perioden
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" />
                  Allvarlighetsgrad
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[220px]" data-testid="chart-deviation-severity">
                  {deviationsBySeverity.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={deviationsBySeverity} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                          {deviationsBySeverity.map((entry) => (
                            <Cell key={entry.severity} fill={SEVERITY_COLORS[entry.severity] || COLORS[0]} />
                          ))}
                        </Pie>
                        <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      Ingen data
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3" data-testid="list-deviation-status">
                  {deviationStatusSummary.map((item, i) => {
                    const pct = deviationKpis.total > 0 ? Math.round((item.value / deviationKpis.total) * 100) : 0;
                    return (
                      <div key={item.status}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm">{item.name}</span>
                          <span className="text-sm font-medium">{item.value} ({pct}%)</span>
                        </div>
                        <Progress value={pct} className="h-2" />
                      </div>
                    );
                  })}
                  {deviationStatusSummary.length === 0 && (
                    <p className="text-muted-foreground text-center py-4">Inga avvikelser</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Senaste avvikelser
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[220px]">
                  <div className="space-y-2" data-testid="list-recent-deviations">
                    {filteredDeviations.slice(0, 8).map(d => (
                      <div key={d.id} className="flex items-start gap-2 p-2 rounded-lg border text-sm">
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                          d.severityLevel === "critical" ? "bg-red-500" :
                          d.severityLevel === "high" ? "bg-orange-500" :
                          d.severityLevel === "medium" ? "bg-yellow-500" : "bg-blue-500"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{d.title || (DEVIATION_CATEGORY_LABELS as Record<string, string>)[d.category] || d.category}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.reportedAt ? format(new Date(d.reportedAt), "d MMM HH:mm", { locale: sv }) : "–"}
                          </p>
                        </div>
                        <Badge variant={d.status === "resolved" || d.status === "closed" ? "secondary" : "outline"} className="text-[10px] shrink-0">
                          {d.status === "open" ? "Öppen" : d.status === "in_progress" ? "Pågår" : d.status === "resolved" ? "Åtgärdad" : d.status === "closed" ? "Stängd" : d.status}
                        </Badge>
                      </div>
                    ))}
                    {filteredDeviations.length === 0 && (
                      <p className="text-muted-foreground text-center py-4">Inga avvikelser i perioden</p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* === RESOURCES TAB === */}
        <TabsContent value="resources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resursprestanda</CardTitle>
              <CardDescription>Översikt över resursernas arbetsbelastning och prestanda</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {resourcePerformance.map(resource => (
                  <div key={resource.id} className="border rounded-lg p-3" data-testid={`resource-card-${resource.id}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{resource.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{resource.orders} ordrar</Badge>
                        <Badge variant="secondary">{Math.round(resource.value / 1000)}k</Badge>
                        {resource.deviationCount > 0 && (
                          <Badge variant="destructive" className="text-[10px]">{resource.deviationCount} avv.</Badge>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Slutförandegrad</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Progress value={resource.completionRate} className="h-1.5 flex-1" />
                          <span className="text-xs font-medium">{resource.completionRate}%</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Effektivitet</p>
                        <p className={`font-medium ${resource.efficiency > 120 ? "text-red-600" : resource.efficiency > 100 ? "text-amber-600" : "text-green-600"}`}>
                          {resource.efficiency > 0 ? `${resource.efficiency}%` : "–"}
                        </p>
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

        {/* === AREAS TAB === */}
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
                    <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
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

        {/* === CUSTOMERS TAB === */}
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
                    <div key={customer.id} className="flex items-center gap-4 p-3 border rounded-lg" data-testid={`customer-row-${customer.id}`}>
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

        {/* === ROUTE FEEDBACK TAB === */}
        <TabsContent value="route-feedback" className="space-y-4" data-testid="tab-content-route-feedback">
          <RouteFeedbackTab />
        </TabsContent>

        {/* === PREDICTION ACCURACY TAB === */}
        <TabsContent value="prediction" className="space-y-4" data-testid="tab-content-prediction">
          <PredictionAccuracyTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
