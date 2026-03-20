import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download,
  TrendingUp,
  TrendingDown,
  Clock,
  Fuel,
  Leaf,
  Users,
  CheckCircle2,
  BarChart3,
  AlertTriangle,
  DollarSign,
  Activity,
  Truck,
  ArrowUpRight,
  ArrowDownRight,
  Share2,
  Copy,
  Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import jsPDF from "jspdf";

interface ROISummary {
  totalOrders: number;
  completedOrders: number;
  completionRate: number;
  avgActualDurationMinutes: number;
  avgEstimatedDurationMinutes: number;
  avgSetupTimeMinutes: number;
  efficiencyGainPercent: number;
  setupTimeReductionPercent: number;
  totalDistanceKm: number;
  totalCo2Kg: number;
  totalFuelLiters: number;
  distanceBaseline: { firstHalfAvgKm: number; secondHalfAvgKm: number };
  distanceReductionPercent: number;
  distanceSavedKm: number;
  co2Baseline: { firstHalfAvgKg: number; secondHalfAvgKg: number };
  co2ReductionPercent: number;
  co2SavedKg: number;
  totalValue: number;
  totalCost: number;
  activeResources: number;
  productivityPerResource: number;
  productivityPerDay: number;
  productivityPerWeek: number;
  deviationCount: number;
  deviationTrend: { firstPeriodAvg: number; secondPeriodAvg: number } | null;
  setupTimeBaseline: { firstHalfAvgMinutes: number; secondHalfAvgMinutes: number };
}

interface MonthlyMetrics {
  month: string;
  completedOrders: number;
  totalOrders: number;
  completionRate: number;
  avgDurationMinutes: number;
  avgSetupTimeMinutes: number;
  totalDistanceKm: number;
  totalCo2Kg: number;
  totalFuelLiters: number;
  deviationCount: number;
  totalValue: number;
  totalCost: number;
  productivityPerResource: number;
}

interface ROIData {
  customer: { id: string; name: string };
  period: { from: string; to: string; months: number };
  summary: ROISummary;
  monthly: MonthlyMetrics[];
}

interface CustomerOption {
  id: string;
  name: string;
  orderCount: number;
}

function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  const months = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  return `${months[parseInt(m) - 1]} ${y.slice(2)}`;
}

import type { LucideIcon } from "lucide-react";

function KPICard({ title, value, subtitle, icon: Icon, trend, color }: {
  title: string; value: string | number; subtitle?: string;
  icon: LucideIcon; trend?: "up" | "down" | "neutral"; color?: string;
}) {
  return (
    <Card data-testid={`kpi-${title.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">{title}</p>
            <p className="text-2xl font-bold" style={color ? { color } : undefined}>{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {trend === "up" && <ArrowUpRight className="h-3 w-3 text-green-600" />}
                {trend === "down" && <ArrowDownRight className="h-3 w-3 text-red-500" />}
                {subtitle}
              </p>
            )}
          </div>
          <div className="p-2 rounded-lg bg-muted">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function generatePDF(data: ROIData) {
  const doc = new jsPDF();
  const s = data.summary;
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(27, 75, 107);
  doc.rect(0, 0, pageWidth, 40, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.text("Traivo ROI-rapport", 20, 22);
  doc.setFontSize(11);
  doc.text(data.customer.name, 20, 32);

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  const fromDate = new Date(data.period.from).toLocaleDateString("sv-SE");
  const toDate = new Date(data.period.to).toLocaleDateString("sv-SE");
  doc.text(`Period: ${fromDate} - ${toDate} (${data.period.months} m\u00e5nader)`, 20, 52);

  doc.setFontSize(14);
  doc.setTextColor(27, 75, 107);
  doc.text("Sammanfattning", 20, 65);

  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  const rows = [
    ["Totalt ordrar", `${s.totalOrders}`],
    ["Utf\u00f6rda ordrar", `${s.completedOrders}`],
    ["Completion rate", `${s.completionRate}%`],
    ["Snitt uppdragstid", `${s.avgActualDurationMinutes} min`],
    ["Snitt st\u00e4lltid", `${s.avgSetupTimeMinutes} min`],
    ["Effektivitetsvinst", `${s.efficiencyGainPercent}%`],
    ["St\u00e4lltidsreduktion", `${s.setupTimeReductionPercent}%`],
    ["Total k\u00f6rstr\u00e4cka", `${s.totalDistanceKm} km`],
    ["CO2-uts\u00e4pping", `${s.totalCo2Kg} kg`],
    ["Br\u00e4nslef\u00f6rbrukning", `${s.totalFuelLiters} L`],
    ["Aktiva resurser", `${s.activeResources}`],
    ["Produktivitet/resurs", `${s.productivityPerResource} ordrar`],
    ["Avvikelser", `${s.deviationCount}`],
  ];

  let y = 75;
  for (const [label, val] of rows) {
    doc.setFont("helvetica", "normal");
    doc.text(label, 25, y);
    doc.setFont("helvetica", "bold");
    doc.text(val, 120, y);
    y += 7;
  }

  y += 10;
  doc.setFontSize(14);
  doc.setTextColor(27, 75, 107);
  doc.text("M\u00e5nadsdata", 20, y);
  y += 10;

  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  const headers = ["M\u00e5nad", "Ordrar", "Utf\u00f6rda", "Rate", "Snittid", "Avvikelser"];
  const colX = [25, 55, 80, 105, 125, 155];
  headers.forEach((h, i) => doc.text(h, colX[i], y));
  y += 5;

  doc.setTextColor(0, 0, 0);
  for (const m of data.monthly) {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    doc.text(m.month, colX[0], y);
    doc.text(`${m.totalOrders}`, colX[1], y);
    doc.text(`${m.completedOrders}`, colX[2], y);
    doc.text(`${m.completionRate}%`, colX[3], y);
    doc.text(`${m.avgDurationMinutes} min`, colX[4], y);
    doc.text(`${m.deviationCount}`, colX[5], y);
    y += 5;
  }

  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text(`Genererad av Traivo ${new Date().toLocaleDateString("sv-SE")}`, 20, 290);

  doc.save(`ROI-${data.customer.name.replace(/\s+/g, "_")}.pdf`);
}

export default function ROIReportPage() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [monthsBack, setMonthsBack] = useState("12");
  const [shareUrl, setShareUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const { data: customerList, isLoading: loadingCustomers } = useQuery<CustomerOption[]>({
    queryKey: ["/api/reports/roi-customers"],
  });

  const { data: roiData, isLoading: loadingROI } = useQuery<ROIData>({
    queryKey: ["/api/reports/roi", selectedCustomerId, monthsBack],
    queryFn: async () => {
      const res = await fetch(`/api/reports/roi/${selectedCustomerId}?months=${monthsBack}`);
      if (!res.ok) throw new Error("Kunde inte h\u00e4mta ROI-data");
      return res.json();
    },
    enabled: !!selectedCustomerId,
  });

  const s = roiData?.summary;
  const monthly = roiData?.monthly || [];

  const chartData = monthly.map(m => ({
    ...m,
    monthLabel: formatMonth(m.month),
  }));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="roi-report-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">ROI-rapport</h1>
          <p className="text-muted-foreground text-sm">Avkastningsanalys baserad p\u00e5 faktisk anv\u00e4ndningsdata</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId} data-testid="select-customer">
            <SelectTrigger className="w-[240px]" data-testid="select-customer-trigger">
              <SelectValue placeholder="V\u00e4lj kund..." />
            </SelectTrigger>
            <SelectContent>
              {(customerList || []).map(c => (
                <SelectItem key={c.id} value={c.id} data-testid={`select-customer-${c.id}`}>
                  {c.name} ({c.orderCount} ordrar)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={monthsBack} onValueChange={setMonthsBack} data-testid="select-period">
            <SelectTrigger className="w-[130px]" data-testid="select-period-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 m\u00e5nader</SelectItem>
              <SelectItem value="6">6 m\u00e5nader</SelectItem>
              <SelectItem value="12">12 m\u00e5nader</SelectItem>
              <SelectItem value="24">24 m\u00e5nader</SelectItem>
            </SelectContent>
          </Select>
          {roiData && (
            <>
              <Button variant="outline" onClick={() => generatePDF(roiData)} data-testid="button-export-pdf">
                <Download className="h-4 w-4 mr-2" />
                Exportera PDF
              </Button>
              <Button
                variant="outline"
                data-testid="button-share"
                onClick={async () => {
                  try {
                    const res = await apiRequest("POST", `/api/reports/roi/${selectedCustomerId}/share`);
                    const data = await res.json();
                    setShareUrl(data.shareUrl);
                    toast({ title: "Delningsl\u00e4nk skapad", description: "L\u00e4nken \u00e4r giltig i 30 dagar." });
                  } catch {
                    toast({ title: "Kunde inte skapa delningsl\u00e4nk", variant: "destructive" });
                  }
                }}
              >
                <Share2 className="h-4 w-4 mr-2" />
                Dela med kund
              </Button>
            </>
          )}
        </div>
      </div>

      {shareUrl && (
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <code className="flex-1 text-xs bg-muted p-2 rounded truncate" data-testid="text-share-url">{shareUrl}</code>
            <Button
              size="sm"
              variant="outline"
              data-testid="button-copy-share-url"
              onClick={() => {
                navigator.clipboard.writeText(shareUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </CardContent>
        </Card>
      )}

      {!selectedCustomerId && (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">V\u00e4lj en kund f\u00f6r att visa ROI-rapport</p>
            <p className="text-sm mt-1">Rapporten ber\u00e4knas automatiskt fr\u00e5n faktisk anv\u00e4ndningsdata</p>
          </CardContent>
        </Card>
      )}

      {loadingROI && selectedCustomerId && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      )}

      {s && roiData && (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold" data-testid="text-customer-name">{roiData.customer.name}</h2>
            <Badge variant="secondary" data-testid="badge-period">{roiData.period.months} m\u00e5nader</Badge>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard
              title="Completion Rate"
              value={`${s.completionRate}%`}
              subtitle={`${s.completedOrders} av ${s.totalOrders} ordrar`}
              icon={CheckCircle2}
              color={s.completionRate >= 90 ? "#16a34a" : s.completionRate >= 70 ? "#d97706" : "#dc2626"}
            />
            <KPICard
              title="Effektivitetsvinst"
              value={`${s.efficiencyGainPercent}%`}
              subtitle={`${s.avgActualDurationMinutes} vs ${s.avgEstimatedDurationMinutes} min`}
              icon={TrendingUp}
              trend={s.efficiencyGainPercent > 0 ? "up" : "neutral"}
              color={s.efficiencyGainPercent > 0 ? "#16a34a" : undefined}
            />
            <KPICard
              title="St\u00e4lltidsreduktion"
              value={`${s.setupTimeReductionPercent}%`}
              subtitle={`F\u00f6re: ${s.setupTimeBaseline.firstHalfAvgMinutes} min \u2192 Efter: ${s.setupTimeBaseline.secondHalfAvgMinutes} min`}
              icon={Clock}
              trend={s.setupTimeReductionPercent > 0 ? "up" : "neutral"}
            />
            <KPICard
              title="Produktivitet"
              value={s.productivityPerDay}
              subtitle={`ordrar/dag \u00b7 ${s.productivityPerWeek}/vecka \u00b7 ${s.productivityPerResource}/resurs`}
              icon={Users}
            />
            <KPICard
              title="Ruttoptimering"
              value={`${s.distanceReductionPercent}%`}
              subtitle={`F\u00f6re: ${s.distanceBaseline.firstHalfAvgKm} km/m\u00e5n \u2192 Efter: ${s.distanceBaseline.secondHalfAvgKm} km/m\u00e5n (${s.distanceSavedKm > 0 ? "-" : ""}${Math.abs(s.distanceSavedKm)} km)`}
              icon={Truck}
              trend={s.distanceReductionPercent > 0 ? "up" : "neutral"}
            />
            <KPICard
              title="CO2-besparing"
              value={`${s.co2ReductionPercent}%`}
              subtitle={`F\u00f6re: ${s.co2Baseline.firstHalfAvgKg} kg/m\u00e5n \u2192 Efter: ${s.co2Baseline.secondHalfAvgKg} kg/m\u00e5n (${s.co2SavedKg > 0 ? "-" : ""}${Math.abs(s.co2SavedKg)} kg)`}
              icon={Leaf}
              color="#16a34a"
              trend={s.co2ReductionPercent > 0 ? "up" : "neutral"}
            />
            <KPICard
              title="Avvikelser"
              value={s.deviationCount}
              subtitle={s.deviationTrend
                ? `${s.deviationTrend.firstPeriodAvg} \u2192 ${s.deviationTrend.secondPeriodAvg}/m\u00e5n`
                : "Ingen trenddata"}
              icon={AlertTriangle}
              trend={s.deviationTrend && s.deviationTrend.secondPeriodAvg < s.deviationTrend.firstPeriodAvg ? "up" : "neutral"}
            />
            <KPICard
              title="Orderv\u00e4rde"
              value={`${Math.round(s.totalValue / 100).toLocaleString("sv-SE")} kr`}
              subtitle={`Kostnad: ${Math.round(s.totalCost / 100).toLocaleString("sv-SE")} kr`}
              icon={DollarSign}
            />
          </div>

          {chartData.length > 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Ordrar & Completion Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" domain={[0, 100]} unit="%" />
                      <Tooltip />
                      <Legend />
                      <Bar yAxisId="left" dataKey="completedOrders" fill="#4A9B9B" name="Utf\u00f6rda" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="left" dataKey="totalOrders" fill="#E8F4F8" name="Totalt" radius={[4, 4, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="completionRate" stroke="#1B4B6B" strokeWidth={2} name="Rate %" dot={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Uppdragstid & St\u00e4lltid (min)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis unit=" min" />
                      <Tooltip />
                      <Legend />
                      <Area type="monotone" dataKey="avgDurationMinutes" fill="#7DBFB0" fillOpacity={0.3} stroke="#4A9B9B" strokeWidth={2} name="Uppdragstid" />
                      <Area type="monotone" dataKey="avgSetupTimeMinutes" fill="#E8F4F8" fillOpacity={0.3} stroke="#6B7C8C" strokeWidth={2} name="St\u00e4lltid" />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Milj\u00f6p\u00e5verkan</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="dist" />
                      <YAxis yAxisId="co2" orientation="right" />
                      <Tooltip />
                      <Legend />
                      <Line yAxisId="dist" type="monotone" dataKey="totalDistanceKm" stroke="#1B4B6B" strokeWidth={2} name="K\u00f6rstr\u00e4cka (km)" dot={false} />
                      <Line yAxisId="co2" type="monotone" dataKey="totalCo2Kg" stroke="#16a34a" strokeWidth={2} name="CO2 (kg)" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Produktivitet & Avvikelser</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" />
                      <Tooltip />
                      <Legend />
                      <Bar yAxisId="left" dataKey="productivityPerResource" fill="#4A9B9B" name="Ordrar/resurs" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="right" dataKey="deviationCount" fill="#dc2626" name="Avvikelser" radius={[4, 4, 0, 0]} opacity={0.6} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}

          {chartData.length <= 1 && (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Activity className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p>F\u00f6r lite data f\u00f6r att visa trenddiagram. Ut\u00f6ka perioden eller v\u00e4nta p\u00e5 mer historisk data.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
