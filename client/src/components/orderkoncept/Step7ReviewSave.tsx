import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Save, Copy, PlayCircle, Loader2, CheckCircle2,
  Package, Calendar,
  BarChart3, TrendingUp, FileDown, AlertCircle,
  ClipboardList, ListChecks, Repeat
} from "lucide-react";
import ArticleHitResult from "./ArticleHitResult";

interface Step7Props {
  conceptId: string | null;
  conceptName: string;
  customerName?: string;
  deliveryTimeType: string;
  onBeforeAction: () => Promise<void>;
}

interface ArticleLine {
  id: string;
  name: string;
  articleNumber: string;
  quantity: number;
  unitPriceKr: number;
  lineTotalKr: number;
  costKr: number;
  productionMinutes: number;
}

interface ReviewSchedule {
  type: string | null;
  intervalStartDate: string | null;
  intervalEndDate: string | null;
  intervalFrequencyDays: number | null;
  toleranceDays: number;
  timeWindows: Array<{ weekdays: number[]; timeFrom: string; timeTo: string }>;
  mainDeliveryWindows?: Array<{
    startDate?: string | null;
    startTime?: string | null;
    endDate?: string | null;
    endTime?: string | null;
    intervalFrequencyDays?: number | null;
    intervalFlexDays?: number | null;
  }>;
  deliveryRestrictions: any;
}

interface DetailRow {
  kind: "field" | "pretask" | "admin";
  objectId: string | null;
  objectName: string | null;
  objectNumber: string | null;
  taskName: string;
  quantity: number;
  valueKr: number | null;
  destination: "grovplanering" | "admin";
}

interface MaterialLine {
  name: string;
  totalQuantity: number;
  unit: string;
}

interface SummaryMetrics {
  objectsHit: number;
  objectsMissed: number;
  inpekadeCount: number;
  taskCount: number;
  adminTaskCount: number;
  preTaskCount: number;
  productionMinutesActual: number;
  materialLines: MaterialLine[];
}

interface Repetition {
  sourceConceptName: string | null;
  method: string;
  isRecurring: boolean;
  frequencyDays: number | null;
  flexDays: number;
  generations: number | null;
  validUntil: string | null;
  label: string;
}

interface ReviewSummary {
  articleLines: ArticleLine[];
  totalMatchedObjects?: number;
  totalValueKr: number;
  totalCostKr: number;
  totalProductionMinutes: number;
  schedule: ReviewSchedule;
  isFixedPrice?: boolean;
  fixedPriceAmountKr?: number | null;
  detailRows?: DetailRow[];
  summaryMetrics?: SummaryMetrics;
  repetition?: Repetition;
  // Task #1057: dynamiskt beräknad abonnemangsavgift (kronor/period); null för övriga metoder.
  subscriptionFeeKr?: number | null;
}

interface ExecuteReceipt {
  created?: number;
  assignmentsCreated?: number;
  objectsHit?: number;
  objectsMissed?: number;
  preTasksCreated?: number;
  adminWorkOrdersCreated?: number;
  datesGenerated?: number;
  skipped?: number;
  message?: string;
  subscription?: unknown;
}

interface SimulatePeriod {
  year: number;
  month: number;
  label: string;
  jobCount: number;
  weeklyAvg: number;
}

interface SimulateResult {
  objectCount: number;
  periods: SimulatePeriod[];
  summary: { totalJobs: number; monthlyAvg: number; weeklyAvg: number };
}

interface ValidateIssue {
  code: string;
  message: string;
}

interface ValidateResult {
  valid: boolean;
  errors: ValidateIssue[];
  warnings: ValidateIssue[];
}

const WEEKDAY_LABELS = ["Sö", "Må", "Ti", "On", "To", "Fr", "Lö"];

function fmtKr(kr: number) {
  return kr.toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " kr";
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("sv-SE");
}

function fmtMinutes(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} tim ${m} min` : `${h} tim`;
}

function fmtMethod(method: string) {
  // Task #1056: UI har bara två metoder. Legacy "schedule" visas under
  // "Efterfakturering" men markeras (schemalagd) för tydlighet i sammanfattningen.
  switch (method) {
    case "call_off": return "Efterfakturering";
    case "schedule": return "Efterfakturering (schemalagd)";
    case "subscription": return "Abonnemang";
    default: return method;
  }
}

function ScheduleSummary({ schedule }: { schedule: ReviewSchedule }) {
  // Task #978: nya huvudtidsfönster (en eller flera datum+tid-perioder) prioriteras.
  const windows = Array.isArray(schedule.mainDeliveryWindows) ? schedule.mainDeliveryWindows : [];
  if (windows.length > 0) {
    return (
      <div className="space-y-2 text-sm" data-testid="schedule-main-windows">
        {windows.map((w, i) => {
          const freq = w.intervalFrequencyDays ?? null;
          const flex = w.intervalFlexDays ?? 0;
          return (
            <div key={i} className="space-y-0.5" data-testid={`schedule-window-${i}`}>
              <div className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span>
                  <span className="font-medium">
                    {fmtDate(w.startDate ?? null)}{w.startTime ? ` ${w.startTime}` : ""}
                  </span>
                  {" → "}
                  <span className="font-medium">
                    {fmtDate(w.endDate ?? null)}{w.endTime ? ` ${w.endTime}` : ""}
                  </span>
                  {i === 0 && windows.length > 1 && (
                    <span className="ml-1.5 text-xs text-muted-foreground">(primärt)</span>
                  )}
                </span>
              </div>
              {freq != null && freq > 0 && (
                <div className="flex items-center gap-2 text-muted-foreground pl-5 text-xs">
                  <span>var {freq}:e dag{flex > 0 ? ` (±${flex} dag${flex > 1 ? "ar" : ""})` : ""}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  if (!schedule.type) {
    return <span className="text-muted-foreground text-sm">Ej konfigurerat</span>;
  }
  if (schedule.type === "interval") {
    const freq = schedule.intervalFrequencyDays;
    const tol = schedule.toleranceDays ?? 0;
    return (
      <div className="space-y-1 text-sm">
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span>
            <span className="font-medium">{fmtDate(schedule.intervalStartDate)}</span>
            {" → "}
            <span className="font-medium">{fmtDate(schedule.intervalEndDate)}</span>
          </span>
        </div>
        {freq != null && (
          <div className="flex items-center gap-2 text-muted-foreground pl-5">
            <span>var {freq}:e dag{tol > 0 ? ` (±${tol} dag${tol > 1 ? "ar" : ""})` : ""}</span>
          </div>
        )}
      </div>
    );
  }
  if (schedule.type === "time_window") {
    const windows: ReviewSchedule["timeWindows"] = Array.isArray(schedule.timeWindows) ? schedule.timeWindows : [];
    if (windows.length === 0) {
      return <span className="text-muted-foreground text-sm">Tidsfönster (ej konfigurerade)</span>;
    }
    return (
      <div className="space-y-1">
        {windows.map((w, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>
              {w.weekdays.map(d => WEEKDAY_LABELS[d]).join(", ")}{" "}
              <span className="font-medium">{w.timeFrom}–{w.timeTo}</span>
            </span>
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-muted-foreground text-sm">{schedule.type}</span>;
}

// Task #1067: fakturastopp-segment (nivåer som delas upp) från subscription-calc.
interface SubscriptionSegment {
  segmentKey: string | null;
  fieldName: string | null;
  value: string | null;
  label: string;
  monthlyTotal: number;
  objectCount: number;
  isStop: boolean;
}

interface SubscriptionCalcResult {
  monthlyTotal: number;
  matchedObjects: number;
  computed: boolean;
  fakturastopp?: boolean;
  segments?: SubscriptionSegment[];
}

export default function Step7ReviewSave({
  conceptId,
  conceptName,
  customerName,
  deliveryTimeType,
  onBeforeAction,
}: Step7Props) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [templateName, setTemplateName] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [receipt, setReceipt] = useState<ExecuteReceipt | null>(null);

  const { data: summary, isLoading: summaryLoading } = useQuery<ReviewSummary>({
    queryKey: ["/api/order-concepts", conceptId, "review-summary"],
    queryFn: async () => {
      if (!conceptId) throw new Error("Inget koncept-id");
      const res = await fetch(`/api/order-concepts/${conceptId}/review-summary`);
      if (!res.ok) throw new Error("Kunde inte hämta sammanfattning");
      return res.json();
    },
    enabled: !!conceptId,
    staleTime: 10_000,
  });

  // Task #1067: nivå-vy (fakturastopp-segment) för abonnemang — visar TYDLIGT vilka
  // organisatoriska nivåer fakturan stoppas på. Hämtas bara för abonnemangskoncept.
  const isSubscriptionConcept = summary?.repetition?.method === "subscription";
  const { data: subscriptionCalc } = useQuery<SubscriptionCalcResult>({
    queryKey: ["/api/order-concepts", conceptId, "subscription-calc"],
    queryFn: async () => {
      const res = await fetch(`/api/order-concepts/${conceptId}/subscription-calc`);
      if (!res.ok) throw new Error("Kunde inte ladda abonnemangsberäkning");
      return res.json();
    },
    enabled: !!conceptId && isSubscriptionConcept,
    staleTime: 10_000,
  });

  const { data: simData, isLoading: simLoading } = useQuery<SimulateResult>({
    queryKey: ["/api/order-concepts", conceptId, "simulate"],
    queryFn: async () => {
      const res = await fetch(`/api/order-concepts/${conceptId}/simulate`);
      if (!res.ok) throw new Error("Kunde inte ladda simulering");
      return res.json();
    },
    enabled: !!conceptId,
    staleTime: 30000,
  });

  // Task #836 (Fas 3): Förvalidering — ledtids- och beroendevarningar före expansion.
  const { data: validation, isLoading: validationLoading } = useQuery<ValidateResult>({
    queryKey: ["/api/order-concepts", conceptId, "validate"],
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/order-concepts/${conceptId}/validate`, {});
      return res.json();
    },
    enabled: !!conceptId,
    staleTime: 10_000,
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!conceptId) throw new Error("Spara konceptet först.");
      await onBeforeAction();
      const res = await apiRequest("POST", `/api/order-concepts/${conceptId}/save-as-template`, {
        name: templateName.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      toast({ title: "Mall sparad", description: "Konceptet sparades som mall." });
    },
    onError: (e: Error) => toast({ title: "Kunde inte spara mall", description: e.message, variant: "destructive" }),
  });

  const copyMutation = useMutation({
    mutationFn: async () => {
      if (!conceptId) throw new Error("Spara konceptet först.");
      await onBeforeAction();
      const res = await apiRequest("POST", `/api/order-concepts/${conceptId}/copy`, {});
      return res.json();
    },
    onSuccess: (data: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      toast({ title: "Koncept kopierat" });
      if (data?.id) navigate(`/order-concepts/${data.id}/edit`);
    },
    onError: (e: Error) => toast({ title: "Kunde inte kopiera", description: e.message, variant: "destructive" }),
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      if (!conceptId) throw new Error("Spara konceptet först.");
      await onBeforeAction();
      await apiRequest("PATCH", `/api/order-concepts/${conceptId}`, { status: "active" });
      const res = await apiRequest("POST", `/api/order-concepts/${conceptId}/execute`, {});
      return res.json();
    },
    onSuccess: (data: ExecuteReceipt) => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
      setReceipt(data ?? {});
      const n = data?.created ?? data?.assignmentsCreated;
      let description = n != null ? `${n} uppdrag skickade till uppgiftsnavet.` : "Konceptet kördes.";
      if (data?.objectsMissed != null && data.objectsMissed > 0) {
        description += ` ${data.objectsMissed} objekt utan träff hoppades över.`;
      }
      toast({ title: "Order skapad", description });
    },
    onError: (e: Error) => toast({ title: "Kunde inte skapa order", description: e.message, variant: "destructive" }),
  });

  const handleExportPdf = async () => {
    if (!conceptId) {
      toast({
        title: "Konceptet är inte sparat",
        description: "Spara konceptet innan du exporterar PDF.",
        variant: "destructive",
      });
      return;
    }
    setPdfLoading(true);
    try {
      const res = await fetch(`/api/order-concepts/${conceptId}/export-pdf`, {
        credentials: "include",
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "Okänt fel");
        throw new Error(errText || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${conceptName || "orderkoncept"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "PDF exporterad", description: "Filen laddades ned." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Okänt fel";
      toast({ title: "Kunde inte exportera PDF", description: msg, variant: "destructive" });
    } finally {
      setPdfLoading(false);
    }
  };

  const busy = saveTemplateMutation.isPending || copyMutation.isPending || executeMutation.isPending || pdfLoading;

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );

  const ReceiptStat = ({ label, value, testid }: { label: string; value: number; testid: string }) => (
    <div className="rounded-lg border bg-background/60 p-2 text-center">
      <div className="text-lg font-bold tabular-nums" data-testid={testid}>{value.toLocaleString("sv-SE")}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );

  const maxJobCount = simData ? Math.max(...simData.periods.map((p) => p.jobCount), 1) : 1;

  return (
    <div className="space-y-5" data-testid="step7-review-save">

      {/* Kvitto efter skapad order (Task #979) */}
      {receipt && (
        <Card className="border-chart-2/50 bg-chart-2/5" data-testid="card-receipt">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-chart-2" /> Order skapad — kvitto
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm" data-testid="receipt-headline">
              {receipt.subscription
                ? "Abonnemanget aktiverades."
                : `${(receipt.created ?? receipt.assignmentsCreated ?? 0).toLocaleString("sv-SE")} uppdrag genererades och skickades till uppgiftsnavet.`}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(receipt.assignmentsCreated ?? receipt.created) != null && (
                <ReceiptStat label="Uppdrag" value={receipt.assignmentsCreated ?? receipt.created ?? 0} testid="receipt-assignments" />
              )}
              {receipt.objectsHit != null && (
                <ReceiptStat label="Träffade objekt" value={receipt.objectsHit} testid="receipt-objects-hit" />
              )}
              {receipt.datesGenerated != null && (
                <ReceiptStat label="Datum (generationer)" value={receipt.datesGenerated} testid="receipt-dates" />
              )}
              {receipt.preTasksCreated != null && receipt.preTasksCreated > 0 && (
                <ReceiptStat label="Föruppgifter" value={receipt.preTasksCreated} testid="receipt-pretasks" />
              )}
              {receipt.adminWorkOrdersCreated != null && receipt.adminWorkOrdersCreated > 0 && (
                <ReceiptStat label="Administrativa" value={receipt.adminWorkOrdersCreated} testid="receipt-admin" />
              )}
              {receipt.objectsMissed != null && receipt.objectsMissed > 0 && (
                <ReceiptStat label="Utan träff" value={receipt.objectsMissed} testid="receipt-missed" />
              )}
            </div>
            {receipt.message && <p className="text-xs text-muted-foreground" data-testid="receipt-message">{receipt.message}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={() => navigate("/grovplanering")} data-testid="button-go-rough-planning">
                Gå till uppgiftsnavet
              </Button>
              <Button variant="outline" onClick={() => navigate("/order-concepts")} data-testid="button-go-concepts">
                Till orderkoncept
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Identitet */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-chart-2" /> Identitet
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Namn" value={conceptName || "—"} />
          <Row label="Kund" value={customerName || "Från metadata"} />
        </CardContent>
      </Card>

      {/* Tids- & beroendevarningar (Fas 3) */}
      {conceptId && !validationLoading && validation &&
        (validation.errors.length > 0 || validation.warnings.length > 0) && (
        <Card data-testid="card-validation-warnings">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-warning" /> Varningar & kontroller
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {validation.errors.map((e, i) => (
              <div
                key={`err-${i}`}
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm"
                data-testid={`validation-error-${e.code}`}
              >
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <span>{e.message}</span>
              </div>
            ))}
            {validation.warnings.map((w, i) => (
              <div
                key={`warn-${i}`}
                className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm"
                data-testid={`validation-warning-${w.code}`}
              >
                <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <span>{w.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Resultat av artikelträffar — vilka inpekade objekt artikeln faktiskt träffar */}
      <ArticleHitResult conceptId={conceptId} />

      {/* Sammanfattning (Task #979) */}
      {summary?.summaryMetrics && (
        <Card data-testid="card-summary-metrics">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ClipboardList className="h-4 w-4" /> Sammanfattning
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <Row
              label="Träffade objekt"
              value={
                <span data-testid="summary-objects-hit">
                  {summary.summaryMetrics.objectsHit}
                  {summary.summaryMetrics.objectsMissed > 0 && (
                    <span className="text-muted-foreground font-normal">
                      {" "}av {summary.summaryMetrics.inpekadeCount} inpekade ({summary.summaryMetrics.objectsMissed} utan träff)
                    </span>
                  )}
                </span>
              }
            />
            <Row label="Antal uppgifter" value={<span data-testid="summary-task-count">{summary.summaryMetrics.taskCount.toLocaleString("sv-SE")}</span>} />
            {summary.summaryMetrics.preTaskCount > 0 && (
              <Row label="Föruppgifter" value={summary.summaryMetrics.preTaskCount.toLocaleString("sv-SE")} />
            )}
            {summary.summaryMetrics.adminTaskCount > 0 && (
              <Row label="Administrativa uppgifter" value={summary.summaryMetrics.adminTaskCount.toLocaleString("sv-SE")} />
            )}
            <Row label="Ordervärde" value={<span className="font-semibold" data-testid="summary-order-value">{fmtKr(summary.totalValueKr)}</span>} />
            {summary.repetition?.method === "subscription" && (
              <Row
                label="Abonnemangsavgift (per period)"
                value={
                  <span className="font-semibold text-primary" data-testid="summary-subscription-fee">
                    {fmtKr(summary.subscriptionFeeKr ?? summary.totalValueKr)}
                  </span>
                }
              />
            )}
            {/* Task #1067: nivå-vy — vilka organisatoriska nivåer fakturan stoppas på. */}
            {summary.repetition?.method === "subscription" &&
              subscriptionCalc?.computed &&
              subscriptionCalc.fakturastopp &&
              (subscriptionCalc.segments?.length ?? 0) > 0 && (
                <div className="pt-2" data-testid="summary-subscription-segments">
                  <div className="text-sm text-muted-foreground mb-1">
                    Fakturastopp — en faktura per nivå (samma kund)
                  </div>
                  <div className="space-y-0.5">
                    {subscriptionCalc.segments!.map((seg, i) => (
                      <div
                        key={seg.segmentKey ?? `customer-${i}`}
                        className="flex justify-between items-center gap-2 text-sm"
                        data-testid={`summary-segment-${i}`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          {seg.isStop ? (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal shrink-0">Stopp</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal shrink-0">Kundnivå</Badge>
                          )}
                          <span className="truncate">{seg.label}</span>
                          <span className="text-xs text-muted-foreground shrink-0">({seg.objectCount} obj)</span>
                        </span>
                        <span className="font-medium tabular-nums shrink-0">{fmtKr(seg.monthlyTotal)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            <Row label="Produktionstid" value={<span data-testid="summary-production-time">{fmtMinutes(summary.summaryMetrics.productionMinutesActual)}</span>} />
            {summary.summaryMetrics.materialLines.length > 0 && (
              <div className="pt-2">
                <div className="text-sm text-muted-foreground mb-1">Materialåtgång</div>
                <div className="space-y-0.5">
                  {summary.summaryMetrics.materialLines.map((m, i) => (
                    <div key={i} className="flex justify-between text-sm" data-testid={`material-line-${i}`}>
                      <span>{m.name}</span>
                      <span className="font-medium tabular-nums">{m.totalQuantity.toLocaleString("sv-SE")} {m.unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Detaljlista — genererade uppgifter (Task #979) */}
      {summary?.detailRows && summary.detailRows.length > 0 && (
        <Card data-testid="card-detail-rows">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ListChecks className="h-4 w-4" /> Detaljlista — genererade uppgifter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-1.5 pr-2 font-medium">Objekt</th>
                    <th className="py-1.5 px-2 font-medium">Uppgift</th>
                    <th className="py-1.5 pl-2 font-medium text-right">Antal</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.detailRows.map((d, i) => (
                    <tr key={i} className="border-b last:border-0" data-testid={`detail-row-${i}`}>
                      <td className="py-1.5 pr-2">
                        {d.objectName ? (
                          <span>
                            <span className="font-medium">{d.objectName}</span>
                            {d.objectNumber && <span className="text-xs text-muted-foreground ml-1">({d.objectNumber})</span>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">
                            {d.kind === "admin" ? "Administrativ" : d.kind === "pretask" ? "Per träffobjekt" : "—"}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-2">{d.taskName}</td>
                      <td className="py-1.5 pl-2 text-right tabular-nums">{d.quantity.toLocaleString("sv-SE")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {summary.repetition && summary.repetition.generations != null && summary.repetition.generations > 1 && (
              <p className="text-xs text-muted-foreground mt-2" data-testid="detail-generations-note">
                Listan visar en generation. Vid körning skapas detta × {summary.repetition.generations} generationer.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Artiklar & ekonomi */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Package className="h-4 w-4" /> Uppgifter & ekonomi
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : summary && summary.articleLines.length > 0 ? (
            <div className="space-y-1">
              {summary.articleLines.map(line => (
                <div key={line.id} className="text-sm py-1 border-b last:border-0">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-medium">{line.name}</span>
                      {line.articleNumber && (
                        <span className="text-xs text-muted-foreground ml-1.5">({line.articleNumber})</span>
                      )}
                    </div>
                    <span className="font-semibold tabular-nums">{fmtKr(line.lineTotalKr)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtKr(line.unitPriceKr)} × {line.quantity.toLocaleString("sv-SE")} st
                    {line.productionMinutes > 0 && (
                      <span className="ml-2">· {fmtMinutes(line.productionMinutes)}</span>
                    )}
                  </div>
                </div>
              ))}
              <Separator className="my-2" />
              <div className="space-y-0.5 pt-1">
                <Row
                  label="Matchade objekt"
                  value={<span data-testid="summary-economy-matched">{(summary.totalMatchedObjects ?? 0).toLocaleString("sv-SE")}</span>}
                />
                <Row label="Totalt ordervärde" value={<span className="text-base font-bold">{fmtKr(summary.totalValueKr)}</span>} />
                <Row label="Beräknad kostnad" value={fmtKr(summary.totalCostKr)} />
                <Row
                  label="Beräknad arbetstid"
                  value={fmtMinutes(summary.summaryMetrics?.productionMinutesActual ?? summary.totalProductionMinutes)}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">Inga uppgifter/artiklar tillagda</p>
          )}
        </CardContent>
      </Card>

      {/* Schema */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Schema
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : summary ? (
            <ScheduleSummary schedule={summary.schedule} />
          ) : (
            <span className="text-sm text-muted-foreground italic">—</span>
          )}
        </CardContent>
      </Card>

      {/* Repetition (Task #979) */}
      {summary?.repetition && (
        <Card data-testid="card-repetition">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Repeat className="h-4 w-4" /> Repetition
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <Row label="Källkoncept" value={summary.repetition.sourceConceptName || conceptName || "—"} />
            <Row label="Metod" value={fmtMethod(summary.repetition.method)} />
            <Row
              label="Återkommande"
              value={
                <Badge variant={summary.repetition.isRecurring ? "default" : "secondary"} data-testid="repetition-recurring">
                  {summary.repetition.isRecurring ? "Ja" : "Nej"}
                </Badge>
              }
            />
            {summary.repetition.generations != null && (
              <Row label="Antal generationer" value={<span data-testid="repetition-generations">{summary.repetition.generations.toLocaleString("sv-SE")}</span>} />
            )}
            {summary.repetition.validUntil && (
              <Row label="Giltig t.o.m." value={<span data-testid="repetition-valid-until">{fmtDate(summary.repetition.validUntil)}</span>} />
            )}
            <div className="pt-1 text-sm" data-testid="repetition-label">
              <span className="text-muted-foreground">{summary.repetition.label}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Simulering — uppskattade jobb per månad (Fas 4) */}
      <Card data-testid="card-simulation">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Simulering — uppskattade jobb per månad
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!conceptId ? (
            <p className="text-sm text-muted-foreground text-center py-4">Spara konceptet för att se simulering.</p>
          ) : simLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !simData || simData.summary.totalJobs === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Inga jobb uppskattade — konfigurera leveranstid (intervall eller tidsfönster) i steg 5.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-chart-2/10 dark:bg-chart-2/15 text-center">
                  <div className="text-xl font-bold text-chart-2" data-testid="sim-total-jobs">
                    {simData.summary.totalJobs.toLocaleString("sv-SE")}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Totalt (12 mån)</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50 text-center">
                  <div className="text-xl font-bold" data-testid="sim-monthly-avg">
                    {simData.summary.monthlyAvg.toLocaleString("sv-SE")}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Snitt/månad</div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50 text-center">
                  <div className="text-xl font-bold" data-testid="sim-weekly-avg">
                    {simData.summary.weeklyAvg.toLocaleString("sv-SE")}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Snitt/vecka</div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                <TrendingUp className="h-3 w-3" />
                Baserat på {simData.objectCount} objekt
              </div>
              <div className="space-y-1">
                {simData.periods.map((p) => (
                  <div key={`${p.year}-${p.month}`} className="flex items-center gap-2 text-xs" data-testid={`sim-period-${p.year}-${p.month}`}>
                    <span className="w-16 text-muted-foreground shrink-0">{p.label}</span>
                    <div className="flex-1 bg-muted/40 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-chart-2 h-2 rounded-full transition-all"
                        style={{ width: `${(p.jobCount / maxJobCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-medium">
                      {p.jobCount > 0 ? p.jobCount.toLocaleString("sv-SE") : <span className="text-muted-foreground">—</span>}
                    </span>
                    <Badge variant="outline" className="text-xs w-16 justify-center shrink-0">
                      ~{p.weeklyAvg}/v
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Spara som mall / kopiera */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Exportera och dela</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !conceptId}
              onClick={handleExportPdf}
              data-testid="button-export-pdf"
            >
              {pdfLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4 mr-1" />
              )}
              Exportera PDF
            </Button>
            {!conceptId && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <AlertCircle className="h-3 w-3" />
                Spara konceptet för att aktivera PDF-export.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Spara som mall</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="template-name" className="text-xs mb-1 block">Mallnamn (valfritt)</Label>
            <Input
              id="template-name"
              placeholder={`${conceptName || "Koncept"} (mall)`}
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              data-testid="input-template-name"
            />
          </div>
          <Button
            variant="outline"
            disabled={busy || !conceptId}
            onClick={() => saveTemplateMutation.mutate()}
            data-testid="button-save-template"
          >
            {saveTemplateMutation.isPending
              ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              : <Save className="h-4 w-4 mr-1" />}
            Spara mall
          </Button>
          <Button
            variant="outline"
            disabled={busy || !conceptId}
            onClick={() => copyMutation.mutate()}
            data-testid="button-copy-concept"
          >
            {copyMutation.isPending
              ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              : <Copy className="h-4 w-4 mr-1" />}
            Kopiera koncept
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          size="lg"
          disabled={busy || !conceptId || !!receipt}
          onClick={() => executeMutation.mutate()}
          data-testid="button-create-order"
        >
          {executeMutation.isPending
            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            : <PlayCircle className="h-4 w-4 mr-2" />}
          {receipt ? "Order skapad" : "Skapa order"}
        </Button>
      </div>
    </div>
  );
}
