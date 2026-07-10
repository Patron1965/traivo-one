import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, TrendingUp, TrendingDown, DollarSign, Users, BarChart3, AlertTriangle, Package } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  BarChart, Bar, Tooltip as RechartsTooltip, Legend
} from "recharts";
import { format, subDays, startOfMonth, endOfMonth, subMonths, eachDayOfInterval, eachMonthOfInterval } from "date-fns";
import { sv } from "date-fns/locale";
import type { WorkOrder, Customer } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

export default function EconomicsDashboardPage() {
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

  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const { data: articleMargins = [] } = useQuery<Array<{
    articleId: string;
    articleNumber: string | null;
    name: string | null;
    unitCost: number | null;
    listPrice: number | null;
    totalRevenue: number;
    totalCost: number;
    totalMargin: number;
    marginPercent: number;
    totalQuantity: number;
    lineCount: number;
  }>>({
    queryKey: ["/api/kpis/article-margins"],
    enabled: isAdmin,
  });

  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  // Filtrera till ordrar med ekonomisk data (cachedValue och cachedCost ej null)
  const ordersWithEconomicData = useMemo(() => 
    workOrders.filter(wo => wo.cachedValue !== null && wo.cachedCost !== null),
    [workOrders]
  );
  
  const ordersWithoutEconomicData = workOrders.length - ordersWithEconomicData.length;

  const totalValue = ordersWithEconomicData.reduce((sum, wo) => sum + (wo.cachedValue ?? 0), 0);
  const totalCost = ordersWithEconomicData.reduce((sum, wo) => sum + (wo.cachedCost ?? 0), 0);
  const totalMargin = totalValue - totalCost;
  const marginPercent = totalValue > 0 ? Math.round((totalMargin / totalValue) * 100) : 0;

  const customerProfitability = useMemo(() => {
    const data: Record<string, { name: string; value: number; cost: number; margin: number; orders: number }> = {};
    
    ordersWithEconomicData.forEach(wo => {
      const customerId = wo.customerId || "okand";
      if (!data[customerId]) {
        const customer = customerMap.get(customerId);
        data[customerId] = { 
          name: customer?.name || "Okänd kund", 
          value: 0, 
          cost: 0, 
          margin: 0,
          orders: 0 
        };
      }
      data[customerId].value += wo.cachedValue ?? 0;
      data[customerId].cost += wo.cachedCost ?? 0;
      data[customerId].margin = data[customerId].value - data[customerId].cost;
      data[customerId].orders += 1;
    });

    return Object.entries(data)
      .map(([id, d]) => ({ 
        id, 
        ...d, 
        marginPercent: d.value > 0 ? Math.round((d.margin / d.value) * 100) : 0 
      }))
      .sort((a, b) => b.margin - a.margin);
  }, [ordersWithEconomicData, customerMap]);

  const monthlyTrends = useMemo(() => {
    const now = new Date();
    const months = eachMonthOfInterval({
      start: subMonths(startOfMonth(now), 5),
      end: endOfMonth(now)
    });

    return months.map(month => {
      const monthStart = startOfMonth(month);
      const monthEnd = endOfMonth(month);
      
      const monthOrders = ordersWithEconomicData.filter(wo => {
        if (!wo.scheduledDate) return false;
        const date = wo.scheduledDate instanceof Date ? wo.scheduledDate : new Date(String(wo.scheduledDate));
        return date >= monthStart && date <= monthEnd;
      });

      const value = monthOrders.reduce((sum, wo) => sum + (wo.cachedValue ?? 0), 0);
      const cost = monthOrders.reduce((sum, wo) => sum + (wo.cachedCost ?? 0), 0);

      return {
        month: format(month, "MMM", { locale: sv }),
        fullMonth: format(month, "MMMM yyyy", { locale: sv }),
        intakt: value,
        kostnad: cost,
        marginal: value - cost,
        orders: monthOrders.length
      };
    });
  }, [ordersWithEconomicData]);

  const dailyTrends = useMemo(() => {
    const now = new Date();
    const days = eachDayOfInterval({
      start: subDays(now, 29),
      end: now
    });

    return days.map(day => {
      const dayOrders = ordersWithEconomicData.filter(wo => {
        if (!wo.scheduledDate) return false;
        const date = wo.scheduledDate instanceof Date ? wo.scheduledDate : new Date(String(wo.scheduledDate));
        return format(date, "yyyy-MM-dd") === format(day, "yyyy-MM-dd");
      });

      return {
        date: format(day, "d/M"),
        intakt: dayOrders.reduce((sum, wo) => sum + (wo.cachedValue ?? 0), 0),
        orders: dayOrders.length
      };
    });
  }, [ordersWithEconomicData]);

  if (workOrdersLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const topCustomers = customerProfitability.slice(0, 5);
  const worstCustomers = [...customerProfitability].sort((a, b) => a.margin - b.margin).slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader icon={TrendingUp} title="Ekonomisk översikt" description="Analysera lönsamhet per kund" testId="text-page-title" />
      {ordersWithoutEconomicData > 0 && (
        <div className="flex items-center gap-2 p-2 rounded bg-chart-3/15 text-chart-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <span>
            {ordersWithoutEconomicData} av {workOrders.length} ordrar saknar ekonomisk data och exkluderas från beräkningarna.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="card-total-revenue">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total intäkt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(totalValue / 1000).toFixed(0)}k SEK</div>
            <p className="text-xs text-muted-foreground">{ordersWithEconomicData.length} ordrar med data</p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-cost">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total kostnad</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(totalCost / 1000).toFixed(0)}k SEK</div>
            <p className="text-xs text-muted-foreground">Material + arbetskostnad</p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-margin">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Marginal</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalMargin >= 0 ? "text-chart-2" : "text-destructive"}`}>
              {(totalMargin / 1000).toFixed(0)}k SEK
            </div>
            <div className="flex items-center gap-1 text-xs">
              {totalMargin >= 0 ? (
                <TrendingUp className="h-3 w-3 text-chart-2" />
              ) : (
                <TrendingDown className="h-3 w-3 text-destructive" />
              )}
              <span className={totalMargin >= 0 ? "text-chart-2" : "text-destructive"}>
                {marginPercent}% marginal
              </span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-order-value">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Snittordervärde</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {workOrders.length > 0 ? Math.round(totalValue / workOrders.length) : 0} SEK
            </div>
            <p className="text-xs text-muted-foreground">Per arbetsorder</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-monthly-trends">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Månadstrend (senaste 6 mån)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyTrends}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis className="text-xs" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <RechartsTooltip 
                    formatter={(value: number, name: string) => [
                      `${value.toLocaleString()} SEK`, 
                      name === "intakt" ? "Intäkt" : name === "kostnad" ? "Kostnad" : "Marginal"
                    ]}
                    labelFormatter={(label) => monthlyTrends.find(m => m.month === label)?.fullMonth || label}
                  />
                  <Legend formatter={(value) => value === "intakt" ? "Intäkt" : value === "kostnad" ? "Kostnad" : "Marginal"} />
                  <Bar dataKey="intakt" fill="hsl(140, 70%, 45%)" name="intakt" />
                  <Bar dataKey="kostnad" fill="hsl(350, 70%, 50%)" name="kostnad" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-daily-trends">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Daglig intäkt (senaste 30 dagar)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyTrends}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" className="text-xs" interval={4} />
                  <YAxis className="text-xs" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <RechartsTooltip 
                    formatter={(value: number) => [`${value.toLocaleString()} SEK`, "Intäkt"]}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="intakt" 
                    stroke="hsl(200, 70%, 50%)" 
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {isAdmin && (
      <Card data-testid="card-article-margins">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Marginal per artikel
          </CardTitle>
        </CardHeader>
        <CardContent>
          {articleMargins.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Inga artikelrader att analysera ännu.</p>
          ) : (
            <ScrollArea className="h-80">
              <div className="space-y-2">
                {articleMargins.slice(0, 20).map((a) => (
                  <div
                    key={a.articleId}
                    className="flex items-center justify-between gap-3 p-2 rounded bg-muted/30"
                    data-testid={`article-margin-row-${a.articleId}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {a.articleNumber && (
                          <Badge variant="outline" className="text-[10px] font-mono">{a.articleNumber}</Badge>
                        )}
                        <span className="font-medium text-sm truncate">{a.name || "Okänd artikel"}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {a.lineCount} rader · {Math.round(a.totalQuantity).toLocaleString()} enheter
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-muted-foreground">
                        {(a.totalRevenue / 100).toLocaleString()} kr intäkt
                      </div>
                      <div className={`text-sm font-medium ${a.totalMargin >= 0 ? "text-chart-2" : "text-destructive"}`}>
                        {a.totalMargin >= 0 ? "+" : ""}{(a.totalMargin / 100).toLocaleString()} kr
                        <span className="ml-1 text-xs opacity-75">({a.marginPercent}%)</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-top-customers">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Mest lönsamma kunder
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {topCustomers.map((customer, idx) => (
                  <div 
                    key={customer.id} 
                    className="flex items-center justify-between p-2 rounded bg-muted/30"
                    data-testid={`top-customer-${customer.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="h-5 w-5 p-0 flex items-center justify-center">
                        {idx + 1}
                      </Badge>
                      <div>
                        <span className="font-medium text-sm">{customer.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          ({customer.orders} ordrar)
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-medium text-chart-2">+{customer.margin.toLocaleString()} SEK</span>
                      <span className="text-xs text-muted-foreground block">{customer.marginPercent}%</span>
                    </div>
                  </div>
                ))}
                {topCustomers.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">Inga kunder med ordrar</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card data-testid="card-low-margin-customers">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5" />
              Lägst marginal (behöver uppmärksamhet)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {worstCustomers.map((customer, idx) => (
                  <div 
                    key={customer.id} 
                    className="flex items-center justify-between p-2 rounded bg-muted/30"
                    data-testid={`low-margin-customer-${customer.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive" className="h-5 w-5 p-0 flex items-center justify-center">
                        {idx + 1}
                      </Badge>
                      <div>
                        <span className="font-medium text-sm">{customer.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          ({customer.orders} ordrar)
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`font-medium ${customer.margin >= 0 ? "text-chart-3" : "text-destructive"}`}>
                        {customer.margin >= 0 ? "+" : ""}{customer.margin.toLocaleString()} SEK
                      </span>
                      <span className="text-xs text-muted-foreground block">{customer.marginPercent}%</span>
                    </div>
                  </div>
                ))}
                {worstCustomers.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">Inga kunder med ordrar</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
