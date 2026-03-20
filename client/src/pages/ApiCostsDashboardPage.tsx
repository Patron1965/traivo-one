import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, DollarSign, Activity, Zap, AlertTriangle,
  TrendingUp, Server, Mail, MessageSquare, MapPin, Cloud, Brain,
  Settings, Shield, Gauge
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  BarChart, Bar, Tooltip as RechartsTooltip, Legend, PieChart, Pie, Cell
} from "recharts";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const SERVICE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  openai: { label: "OpenAI", icon: Brain, color: "hsl(var(--chart-1))" },
  resend: { label: "Resend (E-post)", icon: Mail, color: "hsl(var(--chart-2))" },
  twilio: { label: "Twilio (SMS)", icon: MessageSquare, color: "hsl(var(--chart-3))" },
  geoapify: { label: "Geoapify (Routing)", icon: MapPin, color: "hsl(var(--chart-4))" },
  "geoapify-geocoding": { label: "Geoapify (Geocoding)", icon: MapPin, color: "hsl(25, 95%, 53%)" },
  "open-meteo": { label: "Open-Meteo", icon: Cloud, color: "hsl(var(--chart-5))" },
  "google-geocoding": { label: "Google Geocoding (avvecklad)", icon: MapPin, color: "hsl(142, 71%, 35%)" },
  nominatim: { label: "Nominatim", icon: MapPin, color: "hsl(280, 60%, 55%)" },
  openrouteservice: { label: "OpenRouteService", icon: MapPin, color: "hsl(340, 65%, 47%)" },
};

const PERIOD_LABELS: Record<string, string> = {
  day: "Idag",
  week: "Senaste veckan",
  month: "Denna månad",
  year: "Detta år",
};

const PIE_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

interface BudgetStatus {
  currentUsageUsd: number;
  monthlyBudgetUsd: number;
  percentUsed: number;
  projectedMonthEndUsd: number;
  status: "ok" | "warning" | "critical" | "exceeded";
  daysRemaining: number;
}

interface ServiceSummary {
  service: string;
  totalCostUsd: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgDurationMs: number;
  errorCount: number;
}

interface CostSummary {
  period: string;
  startDate: string;
  endDate: string;
  totalCostUsd: number;
  totalCalls: number;
  services: ServiceSummary[];
}

interface TrendPoint {
  date: string;
  service: string;
  totalCostUsd: number;
  totalCalls: number;
  totalTokens: number;
}

interface ApiBudget {
  id: string;
  service: string;
  tenantId: string | null;
  monthlyBudgetUsd: number;
  alertThresholdPercent: number;
}

interface RecentLog {
  id: string;
  service: string;
  method: string;
  model: string | null;
  estimatedCostUsd: number;
  inputTokens: number | null;
  outputTokens: number | null;
  units: number;
  statusCode: number;
  durationMs: number | null;
  createdAt: string;
  tenantId: string | null;
}

function formatCostSEK(usd: number): string {
  const sek = usd * 10.5;
  if (sek < 0.01) return "< 0,01 kr";
  if (sek < 1) return `${sek.toFixed(2)} kr`;
  if (sek < 100) return `${sek.toFixed(1)} kr`;
  return `${Math.round(sek).toLocaleString("sv-SE")} kr`;
}

function formatCostUSD(usd: number): string {
  if (usd < 0.0001) return "< $0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export default function ApiCostsDashboardPage() {
  const [period, setPeriod] = useState("month");
  const [trendDays, setTrendDays] = useState(30);
  const { toast } = useToast();

  const { data: budgetStatus } = useQuery<BudgetStatus>({
    queryKey: ["/api/system/budget-status"],
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<CostSummary>({
    queryKey: [`/api/system/api-costs/summary?period=${period}`],
  });

  const { data: trends = [], isLoading: trendsLoading } = useQuery<TrendPoint[]>({
    queryKey: [`/api/system/api-costs/trends?days=${trendDays}`],
  });

  const { data: budgets = [], isLoading: budgetsLoading } = useQuery<ApiBudget[]>({
    queryKey: ["/api/system/api-budgets"],
  });

  const { data: recentData, isLoading: recentLoading } = useQuery<{ logs: RecentLog[]; total: number }>({
    queryKey: ["/api/system/api-costs/recent?limit=50"],
  });

  const { data: tenantCosts = [], isLoading: tenantsLoading } = useQuery<{ tenantId: string; service: string; totalCostUsd: number; totalCalls: number }[]>({
    queryKey: [`/api/system/api-costs/by-tenant?period=${period}`],
  });

  const budgetMutation = useMutation({
    mutationFn: async (data: { service: string; monthlyBudgetUsd: number; alertThresholdPercent: number }) => {
      const res = await apiRequest("PUT", "/api/system/api-budgets", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/api-budgets"] });
      toast({ title: "Budget uppdaterad" });
    },
  });

  const trendChartData = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};
    trends.forEach(t => {
      if (!byDate[t.date]) byDate[t.date] = {};
      byDate[t.date][t.service] = (byDate[t.date][t.service] || 0) + t.totalCostUsd;
    });
    return Object.entries(byDate)
      .map(([date, services]) => ({ date, ...services }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [trends]);

  const callsChartData = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};
    trends.forEach(t => {
      if (!byDate[t.date]) byDate[t.date] = {};
      byDate[t.date][t.service] = (byDate[t.date][t.service] || 0) + t.totalCalls;
    });
    return Object.entries(byDate)
      .map(([date, services]) => ({ date, ...services }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [trends]);

  const pieData = useMemo(() => {
    if (!summary?.services) return [];
    return summary.services
      .filter(s => s.totalCostUsd > 0)
      .map(s => ({
        name: SERVICE_CONFIG[s.service]?.label || s.service,
        value: s.totalCostUsd,
      }));
  }, [summary]);

  const uniqueServices = useMemo(() => {
    const services = new Set<string>();
    trends.forEach(t => services.add(t.service));
    return Array.from(services);
  }, [trends]);

  const budgetAlerts = useMemo(() => {
    if (!summary?.services || budgets.length === 0) return [];
    return budgets.map(b => {
      const service = summary.services.find(s => s.service === b.service);
      const currentCost = service?.totalCostUsd || 0;
      const percentUsed = b.monthlyBudgetUsd > 0 ? (currentCost / b.monthlyBudgetUsd) * 100 : 0;
      return {
        ...b,
        currentCost,
        percentUsed: Math.round(percentUsed),
        isOverBudget: percentUsed >= 100,
        isWarning: percentUsed >= b.alertThresholdPercent,
      };
    });
  }, [summary, budgets]);

  const tenantSummary = useMemo(() => {
    const byTenant: Record<string, { totalCost: number; totalCalls: number; services: string[] }> = {};
    tenantCosts.forEach(tc => {
      if (!byTenant[tc.tenantId]) byTenant[tc.tenantId] = { totalCost: 0, totalCalls: 0, services: [] };
      byTenant[tc.tenantId].totalCost += tc.totalCostUsd;
      byTenant[tc.tenantId].totalCalls += tc.totalCalls;
      if (!byTenant[tc.tenantId].services.includes(tc.service)) {
        byTenant[tc.tenantId].services.push(tc.service);
      }
    });
    return Object.entries(byTenant)
      .map(([tenantId, data]) => ({ tenantId, ...data }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [tenantCosts]);

  if (summaryLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">API-kostnader</h1>
          <p className="text-muted-foreground text-sm">
            Realtidsövervakning av alla externa API-tjänster
          </p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]" data-testid="select-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Idag</SelectItem>
            <SelectItem value="week">Senaste veckan</SelectItem>
            <SelectItem value="month">Denna månad</SelectItem>
            <SelectItem value="year">Detta år</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {budgetStatus && (
        <Card data-testid="card-budget-status" className={
          budgetStatus.status === "exceeded" ? "border-red-500 bg-red-50 dark:bg-red-950/20" :
          budgetStatus.status === "critical" ? "border-orange-500 bg-orange-50 dark:bg-orange-950/20" :
          budgetStatus.status === "warning" ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20" :
          "border-green-500/30"
        }>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className={`h-5 w-5 ${
                  budgetStatus.status === "exceeded" ? "text-red-500" :
                  budgetStatus.status === "critical" ? "text-orange-500" :
                  budgetStatus.status === "warning" ? "text-yellow-500" :
                  "text-green-500"
                }`} />
                <CardTitle className="text-base">AI-budgetstatus</CardTitle>
              </div>
              <Badge data-testid="badge-budget-status" variant={
                budgetStatus.status === "exceeded" ? "destructive" :
                budgetStatus.status === "critical" ? "destructive" :
                budgetStatus.status === "warning" ? "secondary" :
                "outline"
              }>
                {budgetStatus.status === "exceeded" ? "Överskriden" :
                 budgetStatus.status === "critical" ? "Kritisk" :
                 budgetStatus.status === "warning" ? "Varning" :
                 "OK"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Förbrukat denna månad</p>
                <p className="text-lg font-bold" data-testid="text-budget-current">{formatCostSEK(budgetStatus.currentUsageUsd)}</p>
                <p className="text-xs text-muted-foreground">{formatCostUSD(budgetStatus.currentUsageUsd)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Månadsbudget</p>
                <p className="text-lg font-bold" data-testid="text-budget-limit">{formatCostSEK(budgetStatus.monthlyBudgetUsd)}</p>
                <p className="text-xs text-muted-foreground">{formatCostUSD(budgetStatus.monthlyBudgetUsd)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Prognos månadsslut</p>
                <p className={`text-lg font-bold ${budgetStatus.projectedMonthEndUsd > budgetStatus.monthlyBudgetUsd ? "text-red-500" : ""}`} data-testid="text-budget-forecast">
                  {formatCostSEK(budgetStatus.projectedMonthEndUsd)}
                </p>
                <p className="text-xs text-muted-foreground">{budgetStatus.daysRemaining} dagar kvar</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Utnyttjat</p>
                <div className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                  <span className={`text-lg font-bold ${
                    budgetStatus.percentUsed >= 100 ? "text-red-500" :
                    budgetStatus.percentUsed >= 80 ? "text-orange-500" :
                    ""
                  }`} data-testid="text-budget-percent">{budgetStatus.percentUsed}%</span>
                </div>
                <Progress 
                  value={Math.min(budgetStatus.percentUsed, 100)} 
                  className="h-2 mt-1"
                  data-testid="progress-budget"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-total-cost">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total kostnad</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCostSEK(summary?.totalCostUsd || 0)}</div>
            <p className="text-xs text-muted-foreground">
              {formatCostUSD(summary?.totalCostUsd || 0)} | {PERIOD_LABELS[period]}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-calls">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Totala anrop</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(summary?.totalCalls || 0).toLocaleString("sv-SE")}</div>
            <p className="text-xs text-muted-foreground">{PERIOD_LABELS[period]}</p>
          </CardContent>
        </Card>

        <Card data-testid="card-services-count">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Aktiva tjänster</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.services?.length || 0}</div>
            <p className="text-xs text-muted-foreground">av {Object.keys(SERVICE_CONFIG).length} konfigurerade</p>
          </CardContent>
        </Card>

        <Card data-testid="card-budget-alerts">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Budgetvarningar</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {budgetAlerts.filter(a => a.isWarning).length}
            </div>
            <p className="text-xs text-muted-foreground">
              {budgetAlerts.filter(a => a.isOverBudget).length} över budget
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList data-testid="tabs-main">
          <TabsTrigger value="overview" data-testid="tab-overview">Översikt</TabsTrigger>
          <TabsTrigger value="trends" data-testid="tab-trends">Trender</TabsTrigger>
          <TabsTrigger value="services" data-testid="tab-services">Per tjänst</TabsTrigger>
          <TabsTrigger value="tenants" data-testid="tab-tenants">Per tenant</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">Loggar</TabsTrigger>
          <TabsTrigger value="budgets" data-testid="tab-budgets">Budget</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2" data-testid="card-cost-chart">
              <CardHeader>
                <CardTitle className="text-base">Kostnadstrend</CardTitle>
              </CardHeader>
              <CardContent>
                {trendsLoading ? (
                  <div className="flex items-center justify-center h-[300px]">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : trendChartData.length === 0 ? (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                    Ingen data ännu. Kostnader loggas automatiskt vid API-anrop.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={trendChartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                      <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" tickFormatter={(v) => `$${v}`} />
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                        formatter={(value: number, name: string) => [formatCostUSD(value), SERVICE_CONFIG[name]?.label || name]}
                      />
                      <Legend formatter={(value) => SERVICE_CONFIG[value]?.label || value} />
                      {uniqueServices.map((service, i) => {
                        const svcColor = SERVICE_CONFIG[service]?.color || PIE_COLORS[i % PIE_COLORS.length];
                        return (
                          <Area
                            key={service}
                            type="monotone"
                            dataKey={service}
                            stackId="1"
                            stroke={svcColor}
                            fill={svcColor}
                            fillOpacity={0.4}
                          />
                        );
                      })}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-pie-chart">
              <CardHeader>
                <CardTitle className="text-base">Kostnadsfördelning</CardTitle>
              </CardHeader>
              <CardContent>
                {pieData.length === 0 ? (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                    Ingen kostnadsdata
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {pieData.map((_, index) => (
                          <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
                        formatter={(value: number) => [formatCostUSD(value), "Kostnad"]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {budgetAlerts.filter(a => a.isWarning).length > 0 && (
            <Card className="border-destructive/50" data-testid="card-budget-warnings">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Budgetvarningar
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {budgetAlerts.filter(a => a.isWarning).map(alert => (
                  <div key={alert.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={alert.isOverBudget ? "destructive" : "secondary"}>
                        {SERVICE_CONFIG[alert.service]?.label || alert.service}
                      </Badge>
                      <span className="text-sm">
                        {formatCostUSD(alert.currentCost)} / {formatCostUSD(alert.monthlyBudgetUsd)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 min-w-[200px]">
                      <Progress
                        value={Math.min(alert.percentUsed, 100)}
                        className="h-2"
                      />
                      <span className={`text-sm font-medium ${alert.isOverBudget ? "text-destructive" : "text-yellow-500"}`}>
                        {alert.percentUsed}%
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <div className="flex items-center gap-2">
            <Select value={String(trendDays)} onValueChange={(v) => setTrendDays(Number(v))}>
              <SelectTrigger className="w-[180px]" data-testid="select-trend-days">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Senaste 7 dagar</SelectItem>
                <SelectItem value="14">Senaste 14 dagar</SelectItem>
                <SelectItem value="30">Senaste 30 dagar</SelectItem>
                <SelectItem value="90">Senaste 90 dagar</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card data-testid="card-cost-trend">
              <CardHeader>
                <CardTitle className="text-base">Kostnad per dag (USD)</CardTitle>
              </CardHeader>
              <CardContent>
                {trendChartData.length === 0 ? (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                    Ingen data för vald period
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={trendChartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
                        formatter={(value: number, name: string) => [formatCostUSD(value), SERVICE_CONFIG[name]?.label || name]}
                      />
                      <Legend formatter={(value) => SERVICE_CONFIG[value]?.label || value} />
                      {uniqueServices.map((service, i) => (
                        <Bar key={service} dataKey={service} stackId="a" fill={SERVICE_CONFIG[service]?.color || PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-calls-trend">
              <CardHeader>
                <CardTitle className="text-base">Anrop per dag</CardTitle>
              </CardHeader>
              <CardContent>
                {callsChartData.length === 0 ? (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                    Ingen data för vald period
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={callsChartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
                        formatter={(value: number, name: string) => [`${value} anrop`, SERVICE_CONFIG[name]?.label || name]}
                      />
                      <Legend formatter={(value) => SERVICE_CONFIG[value]?.label || value} />
                      {uniqueServices.map((service, i) => (
                        <Bar key={service} dataKey={service} stackId="a" fill={SERVICE_CONFIG[service]?.color || PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="services" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(summary?.services || []).map(service => {
              const config = SERVICE_CONFIG[service.service];
              const Icon = config?.icon || Server;
              const budget = budgets.find(b => b.service === service.service);
              const budgetPercent = budget ? (service.totalCostUsd / budget.monthlyBudgetUsd) * 100 : null;

              return (
                <Card key={service.service} data-testid={`card-service-${service.service}`}>
                  <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {config?.label || service.service}
                    </CardTitle>
                    {service.errorCount > 0 && (
                      <Badge variant="destructive">{service.errorCount} fel</Badge>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-2xl font-bold">{formatCostSEK(service.totalCostUsd)}</div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Anrop</span>
                        <span className="font-medium text-foreground">{service.totalCalls.toLocaleString("sv-SE")}</span>
                      </div>
                      {service.totalInputTokens > 0 && (
                        <div className="flex justify-between">
                          <span>Input tokens</span>
                          <span className="font-medium text-foreground">{service.totalInputTokens.toLocaleString("sv-SE")}</span>
                        </div>
                      )}
                      {service.totalOutputTokens > 0 && (
                        <div className="flex justify-between">
                          <span>Output tokens</span>
                          <span className="font-medium text-foreground">{service.totalOutputTokens.toLocaleString("sv-SE")}</span>
                        </div>
                      )}
                      {service.avgDurationMs > 0 && (
                        <div className="flex justify-between">
                          <span>Svarstid (snitt)</span>
                          <span className="font-medium text-foreground">{service.avgDurationMs} ms</span>
                        </div>
                      )}
                    </div>
                    {budgetPercent !== null && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>Budget</span>
                          <span>{Math.round(budgetPercent)}%</span>
                        </div>
                        <Progress value={Math.min(budgetPercent, 100)} className="h-1.5" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {(!summary?.services || summary.services.length === 0) && (
              <div className="col-span-full text-center text-muted-foreground py-12">
                Inga API-anrop registrerade ännu. Data visas automatiskt när tjänster används.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="tenants" className="space-y-4">
          <Card data-testid="card-tenant-breakdown">
            <CardHeader>
              <CardTitle className="text-base">Kostnader per tenant - {PERIOD_LABELS[period]}</CardTitle>
            </CardHeader>
            <CardContent>
              {tenantsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : tenantSummary.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  Ingen tenant-data ännu
                </div>
              ) : (
                <div className="space-y-3">
                  {tenantSummary.map(tenant => (
                    <div key={tenant.tenantId} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-md bg-muted/30">
                      <div>
                        <span className="font-medium" data-testid={`text-tenant-${tenant.tenantId}`}>
                          {tenant.tenantId === "system" ? "System (ingen tenant)" : tenant.tenantId}
                        </span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {tenant.services.map(s => (
                            <Badge key={s} variant="secondary" className="text-xs">
                              {SERVICE_CONFIG[s]?.label || s}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{formatCostSEK(tenant.totalCost)}</div>
                        <div className="text-xs text-muted-foreground">{tenant.totalCalls} anrop</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Card data-testid="card-recent-logs">
            <CardHeader>
              <CardTitle className="text-base">Senaste API-anrop ({recentData?.total || 0} totalt)</CardTitle>
            </CardHeader>
            <CardContent>
              {recentLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !recentData?.logs?.length ? (
                <div className="text-center text-muted-foreground py-8">
                  Inga loggar ännu
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2 font-medium">Tidpunkt</th>
                        <th className="text-left py-2 px-2 font-medium">Tjänst</th>
                        <th className="text-left py-2 px-2 font-medium">Metod</th>
                        <th className="text-left py-2 px-2 font-medium">Modell</th>
                        <th className="text-right py-2 px-2 font-medium">Tokens</th>
                        <th className="text-right py-2 px-2 font-medium">Kostnad</th>
                        <th className="text-right py-2 px-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentData.logs.map(log => (
                        <tr key={log.id} className="border-b border-border/50" data-testid={`row-log-${log.id}`}>
                          <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">
                            {format(new Date(log.createdAt), "d MMM HH:mm:ss", { locale: sv })}
                          </td>
                          <td className="py-2 px-2">
                            <Badge variant="secondary">
                              {SERVICE_CONFIG[log.service]?.label || log.service}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 font-mono text-xs">{log.method || "-"}</td>
                          <td className="py-2 px-2 font-mono text-xs">{log.model || "-"}</td>
                          <td className="py-2 px-2 text-right">
                            {log.inputTokens || log.outputTokens
                              ? `${(log.inputTokens || 0).toLocaleString("sv-SE")} / ${(log.outputTokens || 0).toLocaleString("sv-SE")}`
                              : `${log.units} st`}
                          </td>
                          <td className="py-2 px-2 text-right font-medium">{formatCostUSD(log.estimatedCostUsd)}</td>
                          <td className="py-2 px-2 text-right">
                            {log.statusCode >= 400 ? (
                              <Badge variant="destructive">{log.statusCode}</Badge>
                            ) : (
                              <span className="text-muted-foreground">{log.statusCode}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="budgets" className="space-y-4">
          <Card data-testid="card-budget-settings">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Budgetinställningar
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(SERVICE_CONFIG).map(([key, config]) => {
                  const existing = budgets.find(b => b.service === key);
                  const currentCost = summary?.services?.find(s => s.service === key)?.totalCostUsd || 0;
                  return (
                    <BudgetRow
                      key={key}
                      service={key}
                      label={config.label}
                      Icon={config.icon}
                      currentBudget={existing?.monthlyBudgetUsd}
                      currentThreshold={existing?.alertThresholdPercent}
                      currentCost={currentCost}
                      onSave={(budget, threshold) => {
                        budgetMutation.mutate({
                          service: key,
                          monthlyBudgetUsd: budget,
                          alertThresholdPercent: threshold,
                        });
                      }}
                      saving={budgetMutation.isPending}
                    />
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BudgetRow({
  service,
  label,
  Icon,
  currentBudget,
  currentThreshold,
  currentCost,
  onSave,
  saving,
}: {
  service: string;
  label: string;
  Icon: any;
  currentBudget?: number;
  currentThreshold?: number;
  currentCost: number;
  onSave: (budget: number, threshold: number) => void;
  saving: boolean;
}) {
  const [budget, setBudget] = useState(String(currentBudget || ""));
  const [threshold, setThreshold] = useState(String(currentThreshold || 80));

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-md bg-muted/30" data-testid={`budget-row-${service}`}>
      <div className="flex items-center gap-2 min-w-[150px]">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">{label}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Nuvarande: {formatCostUSD(currentCost)}/mån</span>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <Input
          type="number"
          step="0.01"
          placeholder="Budget (USD/mån)"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          className="w-[140px]"
          data-testid={`input-budget-${service}`}
        />
        <Input
          type="number"
          min="1"
          max="100"
          placeholder="Varning %"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          className="w-[100px]"
          data-testid={`input-threshold-${service}`}
        />
        <Button
          size="sm"
          onClick={() => onSave(Number(budget), Number(threshold))}
          disabled={!budget || saving}
          data-testid={`button-save-budget-${service}`}
        >
          Spara
        </Button>
      </div>
    </div>
  );
}
