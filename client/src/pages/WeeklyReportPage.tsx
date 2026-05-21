import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/layout/PageHeader";
import { FileText, Printer, Plus, Trash2, Loader2, Save, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatSekFromOre } from "@/lib/format";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  BarChart, Bar, Tooltip as RechartsTooltip, Legend,
} from "recharts";
import { DEVIATION_CATEGORY_LABELS } from "@shared/schema";

interface WeeklyReportResponse {
  isoYear: number;
  isoWeek: number;
  weekStart: string;
  weekEnd: string;
  filters: { teamId: string | null; clusterId: string | null };
  teams: { id: string; name: string }[];
  clusters: { id: string; name: string }[];
  current: PeriodStats;
  previous: PeriodStats;
  trend: (PeriodStats & { isoYear: number; isoWeek: number; weekStart: string })[];
  resourcePerformance: { resourceId: string; name: string; total: number; completed: number; minutes: number; efficiency: number }[];
  deviations: {
    weekTotal: number;
    openTotal: number;
    critical: number;
    resolved: number;
    byCategory: { category: string; count: number }[];
    rootCauses: { cause: string; count: number }[];
    topOpen: { id: string; title: string; category: string | null; severity: string | null; reportedAt: string | null }[];
  };
  nextPlan: {
    totalOrders: number;
    plannedMinutes: number;
    capacityMinutes: number;
    utilizationRate: number;
    activeResourceCount: number;
    perPriority: { priority: string; count: number }[];
  };
  quality: {
    routeFeedback: { avgRating: number; totalCount: number; ratingDistribution: Record<string, number> } | null;
    anomalies: { impossibleOrders: number; cancelledOrders: number };
  };
  notes: {
    decisions: string;
    actionItems: ActionItem[];
    updatedAt: string | null;
    updatedBy: string | null;
  };
}

interface PeriodStats {
  totalOrders: number;
  completedOrders: number;
  completionRate: number;
  containers: number;
  revenue: number;
  avgLeadMinutes: number;
  totalEstimatedMinutes: number;
  slaRate: number;
  slaBreaches: number;
}

interface ActionItem {
  text: string;
  owner?: string | null;
  due?: string | null;
  done?: boolean;
}

function isoWeekToMonday(year: number, week: number): string {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const monday = new Date(simple);
  if (dow <= 4) monday.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  else monday.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  return monday.toISOString().split("T")[0];
}

function currentIsoWeek(): { year: number; week: number } {
  const date = new Date();
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

function deltaBadge(curr: number, prev: number, suffix = "") {
  const delta = curr - prev;
  if (delta === 0) return <span className="text-muted-foreground text-xs">±0{suffix}</span>;
  const pos = delta > 0;
  return (
    <span className={`text-xs font-medium ${pos ? "text-chart-2" : "text-destructive"}`}>
      {pos ? "+" : ""}{delta}{suffix}
    </span>
  );
}

export default function WeeklyReportPage() {
  const { toast } = useToast();
  const initial = currentIsoWeek();
  const [isoYear, setIsoYear] = useState(initial.year);
  const [isoWeek, setIsoWeek] = useState(initial.week);
  const [teamId, setTeamId] = useState<string>("all");
  const [clusterId, setClusterId] = useState<string>("all");

  const weekParam = useMemo(() => isoWeekToMonday(isoYear, isoWeek), [isoYear, isoWeek]);

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams({ week: weekParam });
    if (teamId !== "all") params.set("teamId", teamId);
    if (clusterId !== "all") params.set("clusterId", clusterId);
    return `/api/reports/weekly?${params.toString()}`;
  }, [weekParam, teamId, clusterId]);

  const { data, isLoading, isError } = useQuery<WeeklyReportResponse>({
    queryKey: [queryUrl],
  });

  const [decisions, setDecisions] = useState("");
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.notes && !dirty) {
      setDecisions(data.notes.decisions || "");
      setActionItems(data.notes.actionItems || []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.notes?.updatedAt, data?.isoWeek, data?.isoYear]);

  const saveNotes = useMutation({
    mutationFn: async () => {
      return apiRequest("PUT", "/api/reports/weekly/notes", {
        isoYear,
        isoWeek,
        decisions,
        actionItems: actionItems.filter(a => a.text && a.text.trim().length > 0),
      });
    },
    onSuccess: () => {
      toast({ title: "Sparat", description: "Veckans bestämpunkter uppdaterade." });
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: [queryUrl] });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte spara", description: err?.message || "Försök igen", variant: "destructive" });
    },
  });

  function changeWeek(delta: number) {
    const monday = new Date(weekParam);
    monday.setDate(monday.getDate() + delta * 7);
    const d = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const w = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    setIsoYear(d.getUTCFullYear());
    setIsoWeek(w);
    setDirty(false);
  }

  function addActionItem() {
    setActionItems([...actionItems, { text: "", owner: "", due: "" }]);
    setDirty(true);
  }
  function updateActionItem(idx: number, patch: Partial<ActionItem>) {
    setActionItems(actionItems.map((a, i) => i === idx ? { ...a, ...patch } : a));
    setDirty(true);
  }
  function removeActionItem(idx: number) {
    setActionItems(actionItems.filter((_, i) => i !== idx));
    setDirty(true);
  }

  if (isError) {
    return (
      <div className="container mx-auto p-6">
        <Card><CardContent className="py-12 text-center text-muted-foreground">Kunde inte ladda veckorapporten.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6 print:p-0 print:space-y-4">
      <div className="print:hidden">
        <PageHeader
          icon={FileText}
          title="Veckomötes-rapport"
          description="Sammanställd vy för planeringsmötet — utfall, trender, avvikelser, plan och kvalitet."
          testId="text-weekly-report-title"
        >
          <Button variant="outline" onClick={() => window.print()} data-testid="button-print-report">
            <Printer className="h-4 w-4 mr-2" /> Skriv ut / Spara som PDF
          </Button>
        </PageHeader>
      </div>

      <Card className="print:hidden">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => changeWeek(-1)} data-testid="button-prev-week"><ChevronLeft className="h-4 w-4" /></Button>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input type="number" value={isoYear} onChange={(e) => { setIsoYear(parseInt(e.target.value) || isoYear); setDirty(false); }} className="w-24" data-testid="input-iso-year" />
            <span className="text-sm text-muted-foreground">Vecka</span>
            <Input type="number" min={1} max={53} value={isoWeek} onChange={(e) => { setIsoWeek(parseInt(e.target.value) || isoWeek); setDirty(false); }} className="w-20" data-testid="input-iso-week" />
          </div>
          <Button variant="ghost" size="icon" onClick={() => changeWeek(1)} data-testid="button-next-week"><ChevronRight className="h-4 w-4" /></Button>

          <Separator orientation="vertical" className="h-8 mx-2" />

          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger className="w-44" data-testid="select-team-filter"><SelectValue placeholder="Alla team" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla team</SelectItem>
              {data?.teams?.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={clusterId} onValueChange={setClusterId}>
            <SelectTrigger className="w-44" data-testid="select-cluster-filter"><SelectValue placeholder="Alla kluster" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla kluster</SelectItem>
              {data?.clusters?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>

          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />}
        </CardContent>
      </Card>

      {/* Print-header (visas bara vid utskrift) */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-bold" style={{ color: "#1B4B6B" }}>Veckomötes-rapport</h1>
        <p className="text-sm">
          Vecka {data?.isoWeek}, {data?.isoYear} &middot; {data?.weekStart} – {data?.weekEnd}
          {teamId !== "all" && data?.teams?.find(t => t.id === teamId) && ` · Team: ${data.teams.find(t => t.id === teamId)!.name}`}
          {clusterId !== "all" && data?.clusters?.find(c => c.id === clusterId) && ` · Kluster: ${data.clusters.find(c => c.id === clusterId)!.name}`}
        </p>
        <hr className="my-3" style={{ borderColor: "#1B4B6B" }} />
      </div>

      {isLoading && !data && (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      )}

      {data && (
        <>
          {/* SECTION 1: Veckans utfall */}
          <section className="space-y-3 print:break-inside-avoid">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="inline-block w-6 h-6 rounded-full bg-primary/15 text-primary text-xs flex items-center justify-center font-semibold">1</span>
              Veckans utfall
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiTile label="Slutförda kärl" value={data.current.containers.toLocaleString("sv-SE")} delta={deltaBadge(data.current.containers, data.previous?.containers ?? 0)} testId="kpi-containers" />
              <KpiTile label="Intäkt" value={formatSekFromOre(data.current.revenue)} delta={deltaBadge(data.current.revenue - data.previous?.revenue ?? 0, 0)} testId="kpi-revenue" />
              <KpiTile label="Snitt-ledtid" value={`${data.current.avgLeadMinutes} min`} delta={deltaBadge(data.current.avgLeadMinutes, data.previous?.avgLeadMinutes ?? 0, " min")} testId="kpi-lead" />
              <KpiTile label="SLA-uppfyllnad" value={`${data.current.slaRate}%`} delta={deltaBadge(data.current.slaRate, data.previous?.slaRate ?? 0, "%")} testId="kpi-sla" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-muted-foreground">
              <div>Totalt ordrar: <span className="font-medium text-foreground">{data.current.totalOrders}</span></div>
              <div>Slutförda: <span className="font-medium text-foreground">{data.current.completedOrders}</span></div>
              <div>Måluppfyllnad: <span className="font-medium text-foreground">{data.current.completionRate}%</span></div>
              <div>SLA-brott: <span className="font-medium text-foreground">{data.current.slaBreaches}</span></div>
            </div>
          </section>

          {/* SECTION 2: 4-veckors-trender */}
          <section className="space-y-3 print:break-inside-avoid">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="inline-block w-6 h-6 rounded-full bg-primary/15 text-primary text-xs flex items-center justify-center font-semibold">2</span>
              4-veckors-trender
            </h2>
            <Card>
              <CardContent className="p-4">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.trend.map(t => ({
                    label: `v${t.isoWeek}`,
                    Kärl: t.containers,
                    "Intäkt (kr)": Math.round(t.revenue / 100),
                    "Ledtid (min)": t.avgLeadMinutes,
                    "SLA %": t.slaRate,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <RechartsTooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="Kärl" stroke="#1B4B6B" strokeWidth={2} />
                    <Line yAxisId="left" type="monotone" dataKey="Intäkt (kr)" stroke="#4A9B9B" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="Ledtid (min)" stroke="#7DBFB0" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="SLA %" stroke="#2C3E50" strokeWidth={2} strokeDasharray="4 4" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </section>

          {/* SECTION 3: Avvikelser + root-cause */}
          <section className="space-y-3 print:break-inside-avoid">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="inline-block w-6 h-6 rounded-full bg-primary/15 text-primary text-xs flex items-center justify-center font-semibold">3</span>
              Öppna avvikelser & root-cause
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiTile label="Avvikelser denna vecka" value={data.deviations.weekTotal} testId="kpi-dev-week" />
              <KpiTile label="Öppna totalt" value={data.deviations.openTotal} testId="kpi-dev-open" />
              <KpiTile label="Kritiska" value={data.deviations.critical} variant={data.deviations.critical > 0 ? "danger" : "default"} testId="kpi-dev-critical" />
              <KpiTile label="Lösta" value={data.deviations.resolved} testId="kpi-dev-resolved" />
            </div>
            <div className="grid lg:grid-cols-2 gap-3">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Per kategori</CardTitle></CardHeader>
                <CardContent>
                  {data.deviations.byCategory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Inga avvikelser denna vecka.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={data.deviations.byCategory.map(c => ({
                        name: (DEVIATION_CATEGORY_LABELS as any)?.[c.category] || c.category,
                        count: c.count,
                      }))} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" allowDecimals={false} />
                        <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 12 }} />
                        <RechartsTooltip />
                        <Bar dataKey="count" fill="#1B4B6B" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Toppade rotorsaker</CardTitle></CardHeader>
                <CardContent>
                  {data.deviations.rootCauses.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Inga registrerade rotorsaker.</p>
                  ) : (
                    <ul className="text-sm space-y-1">
                      {data.deviations.rootCauses.map(rc => (
                        <li key={rc.cause} className="flex justify-between" data-testid={`root-cause-${rc.cause}`}>
                          <span className="text-foreground">{rc.cause}</span>
                          <Badge variant="secondary">{rc.count}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
            {data.deviations.topOpen.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Top 10 öppna avvikelser</CardTitle></CardHeader>
                <CardContent>
                  <ul className="text-sm divide-y">
                    {data.deviations.topOpen.map(d => (
                      <li key={d.id} className="py-2 flex justify-between gap-3" data-testid={`open-dev-${d.id}`}>
                        <span className="truncate">{d.title}</span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0">
                          {d.category && <Badge variant="outline">{(DEVIATION_CATEGORY_LABELS as any)?.[d.category] || d.category}</Badge>}
                          {d.severity === "critical" && <Badge variant="destructive">Kritisk</Badge>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </section>

          {/* SECTION 4: Nästa veckas plan */}
          <section className="space-y-3 print:break-inside-avoid">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="inline-block w-6 h-6 rounded-full bg-primary/15 text-primary text-xs flex items-center justify-center font-semibold">4</span>
              Nästa veckas plan & kapacitet
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiTile label="Planerade ordrar" value={data.nextPlan.totalOrders} testId="kpi-next-orders" />
              <KpiTile label="Planerad tid" value={`${Math.round(data.nextPlan.plannedMinutes / 60)} h`} testId="kpi-next-planned" />
              <KpiTile label="Kapacitet" value={`${Math.round(data.nextPlan.capacityMinutes / 60)} h`} testId="kpi-next-capacity" />
              <KpiTile
                label="Beläggning"
                value={`${data.nextPlan.utilizationRate}%`}
                variant={data.nextPlan.utilizationRate > 100 ? "danger" : data.nextPlan.utilizationRate > 85 ? "warning" : "default"}
                testId="kpi-next-utilization"
              />
            </div>
            {data.nextPlan.perPriority.length > 0 && (
              <div className="flex flex-wrap gap-2 text-sm">
                {data.nextPlan.perPriority.map(p => (
                  <Badge key={p.priority} variant="outline">{p.priority}: {p.count}</Badge>
                ))}
              </div>
            )}
          </section>

          {/* SECTION 5: Kvalitet */}
          <section className="space-y-3 print:break-inside-avoid">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="inline-block w-6 h-6 rounded-full bg-primary/15 text-primary text-xs flex items-center justify-center font-semibold">5</span>
              Kvalitet
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiTile
                label="Förare-betyg (snitt)"
                value={data.quality.routeFeedback ? `${data.quality.routeFeedback.avgRating}/5` : "—"}
                delta={data.quality.routeFeedback ? <span className="text-xs text-muted-foreground">{data.quality.routeFeedback.totalCount} svar</span> : undefined}
                testId="kpi-feedback"
              />
              <KpiTile label="Omöjliga ordrar" value={data.quality.anomalies.impossibleOrders} variant={data.quality.anomalies.impossibleOrders > 0 ? "warning" : "default"} testId="kpi-impossible" />
              <KpiTile label="Avbrutna ordrar" value={data.quality.anomalies.cancelledOrders} testId="kpi-cancelled" />
            </div>
          </section>

          {/* SECTION 6: Manuella bestämpunkter */}
          <section className="space-y-3 print:break-inside-avoid">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span className="inline-block w-6 h-6 rounded-full bg-primary/15 text-primary text-xs flex items-center justify-center font-semibold">6</span>
                Manuella bestämpunkter
              </h2>
              <Button
                onClick={() => saveNotes.mutate()}
                disabled={!dirty || saveNotes.isPending}
                className="print:hidden"
                data-testid="button-save-notes"
              >
                {saveNotes.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Spara
              </Button>
            </div>
            <Card>
              <CardContent className="p-4 space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Beslut & anteckningar</label>
                  <Textarea
                    rows={5}
                    value={decisions}
                    onChange={(e) => { setDecisions(e.target.value); setDirty(true); }}
                    placeholder="Vad bestämde vi på mötet?"
                    data-testid="textarea-decisions"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium">Att-göra-punkter</label>
                    <Button variant="outline" size="sm" onClick={addActionItem} className="print:hidden" data-testid="button-add-action">
                      <Plus className="h-4 w-4 mr-1" /> Ny punkt
                    </Button>
                  </div>
                  {actionItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Inga uppföljningspunkter.</p>
                  ) : (
                    <ul className="space-y-2">
                      {actionItems.map((item, idx) => (
                        <li key={idx} className="flex flex-col md:flex-row gap-2 items-start md:items-center" data-testid={`action-item-${idx}`}>
                          <Input
                            placeholder="Att-göra"
                            value={item.text}
                            onChange={(e) => updateActionItem(idx, { text: e.target.value })}
                            className="flex-1"
                            data-testid={`input-action-text-${idx}`}
                          />
                          <Input
                            placeholder="Ansvarig"
                            value={item.owner || ""}
                            onChange={(e) => updateActionItem(idx, { owner: e.target.value })}
                            className="w-full md:w-40"
                            data-testid={`input-action-owner-${idx}`}
                          />
                          <Input
                            type="date"
                            value={item.due || ""}
                            onChange={(e) => updateActionItem(idx, { due: e.target.value })}
                            className="w-full md:w-44"
                            data-testid={`input-action-due-${idx}`}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeActionItem(idx)}
                            className="print:hidden"
                            data-testid={`button-remove-action-${idx}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {data.notes.updatedAt && (
                  <p className="text-xs text-muted-foreground">Senast uppdaterad: {new Date(data.notes.updatedAt).toLocaleString("sv-SE")}</p>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Resursproduktivitet (bonus, alltid med på print) */}
          {data.resourcePerformance.length > 0 && (
            <section className="space-y-3 print:break-inside-avoid">
              <h2 className="text-lg font-semibold">Resursproduktivitet</h2>
              <Card>
                <CardContent className="p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left border-b">
                          <th className="py-2 pr-2">Resurs</th>
                          <th className="py-2 px-2 text-right">Klart/Totalt</th>
                          <th className="py-2 px-2 text-right">Minuter</th>
                          <th className="py-2 pl-2 text-right">Effektivitet</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.resourcePerformance.map(r => (
                          <tr key={r.resourceId} className="border-b last:border-0" data-testid={`row-resource-${r.resourceId}`}>
                            <td className="py-2 pr-2">{r.name}</td>
                            <td className="py-2 px-2 text-right">{r.completed}/{r.total}</td>
                            <td className="py-2 px-2 text-right">{r.minutes}</td>
                            <td className="py-2 pl-2 text-right">
                              <span className={r.efficiency >= 90 ? "text-chart-2" : r.efficiency >= 70 ? "text-warning" : "text-destructive"}>
                                {r.efficiency}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}
        </>
      )}

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { font-family: 'Inter', sans-serif; }
          .print\\:hidden { display: none !important; }
          section { break-inside: avoid; page-break-inside: avoid; }
          h2 { color: #1B4B6B; }
        }
      `}</style>
    </div>
  );
}

function KpiTile({ label, value, delta, variant = "default", testId }: {
  label: string;
  value: string | number;
  delta?: React.ReactNode;
  variant?: "default" | "warning" | "danger";
  testId?: string;
}) {
  const bg = variant === "danger"
    ? "bg-destructive/10 border-destructive/30"
    : variant === "warning"
    ? "bg-warning/10 border-warning/30"
    : "bg-card";
  return (
    <Card className={bg} data-testid={testId}>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {delta && <div className="mt-1">{delta}</div>}
      </CardContent>
    </Card>
  );
}
