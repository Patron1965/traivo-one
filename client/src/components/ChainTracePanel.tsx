import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, FileText, Package, ClipboardList, User, CheckCircle2, Receipt, AlertCircle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { useLocation } from "wouter";
import { formatSekFromOre } from "@/lib/format";

interface ChainTracePanelProps {
  workOrderId: string | null;
  open: boolean;
  onClose: () => void;
}

interface ChainTraceData {
  avtal: {
    id: string | null;
    name: string | null;
    scenario: string | null;
    status: string | null;
    customerId: string | null;
    customerName: string | null;
    articleId: string | null;
    matchType: "article" | null;
  } | null;
  artiklar: Array<{
    id: string;
    articleId: string;
    articleNumber: string | null;
    name: string | null;
    quantity: number;
    resolvedPrice: number | null;
    priceSource: string | null;
  }>;
  uppgift: {
    id: string;
    title: string;
    status: string;
    orderStatus: string;
    scheduledDate: string | null;
    completedAt: string | null;
    objectId: string;
    objectName: string | null;
    objectAddress: string | null;
  };
  resurs: {
    id: string;
    name: string;
    resourceType: string;
    phone: string | null;
  } | null;
  utfall: {
    completedAt: string | null;
    actualDuration: number | null;
    protocols: Array<{
      id: string;
      protocolType: string;
      protocolNumber: string | null;
      executedAt: string;
      executedByName: string | null;
      assessmentRating: string | null;
      status: string | null;
    }>;
  };
  faktura: Array<{
    id: string;
    fortnoxInvoiceNumber: string | null;
    status: string;
    totalAmount: number | null;
    exportedAt: string | null;
    isCreditInvoice: boolean;
  }>;
}

const SCENARIO_LABELS: Record<string, string> = {
  avrop: "Avrop",
  schema: "Schema",
  abonnemang: "Abonnemang",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-chart-2/15 text-chart-2 dark:bg-chart-2/15",
  completed: "bg-chart-1/15 text-chart-1 dark:bg-chart-1/15",
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  pending: "bg-chart-3/15 text-chart-3 dark:bg-chart-3/15",
  exported: "bg-chart-2/15 text-chart-2 dark:bg-chart-2/15",
  failed: "bg-destructive/15 text-destructive dark:bg-destructive/15",
  cancelled: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  skapad: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  planerad_pre: "bg-chart-3/15 text-chart-3 dark:bg-chart-3/15",
  planerad_resurs: "bg-chart-1/15 text-chart-1 dark:bg-chart-1/15",
  planerad_las: "bg-chart-1/15 text-chart-1 dark:bg-chart-1/15",
  utford: "bg-chart-2/15 text-chart-2 dark:bg-chart-2/15",
  fakturerad: "bg-chart-2/15 text-chart-2 dark:bg-chart-2/15",
};

const formatCurrency = (amount: number | null) => formatSekFromOre(amount, { emptyDash: true, decimals: true });

interface StepConfig {
  key: string;
  icon: typeof FileText;
  label: string;
  active: boolean;
  completed: boolean;
  navigateTo?: string;
}

function VerticalStep({ step, isLast, expanded, onToggle, children }: {
  step: StepConfig;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const [, setLocation] = useLocation();
  const Icon = step.icon;

  return (
    <div className="relative flex gap-3" data-testid={`chain-step-${step.key}`}>
      <div className="flex flex-col items-center">
        <button
          onClick={onToggle}
          className={`flex items-center justify-center w-9 h-9 rounded-full border-2 transition-all cursor-pointer hover:scale-110 ${
            step.completed
              ? "bg-[#4A9B9B] border-[#4A9B9B] text-white"
              : step.active
                ? "border-[#1B4B6B] text-[#1B4B6B] dark:border-[#7DBFB0] dark:text-[#7DBFB0] bg-[#E8F4F8] dark:bg-[#1B4B6B]/30"
                : "border-gray-300 text-gray-400 dark:border-gray-600 dark:text-gray-500"
          }`}
          data-testid={`button-step-${step.key}`}
        >
          <Icon className="w-4 h-4" />
        </button>
        {!isLast && (
          <div className={`w-0.5 flex-1 min-h-[16px] ${
            step.completed ? "bg-[#4A9B9B]" : "bg-gray-200 dark:bg-gray-700"
          }`} />
        )}
      </div>

      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <button
            onClick={onToggle}
            className="flex items-center gap-1 cursor-pointer hover:underline"
          >
            <span className={`text-sm font-semibold ${
              step.completed || step.active ? "text-foreground" : "text-muted-foreground"
            }`}>{step.label}</span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
          {step.navigateTo && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              title="Gå till detalj"
              onClick={(e) => {
                e.stopPropagation();
                setLocation(step.navigateTo!);
              }}
              data-testid={`button-navigate-${step.key}`}
            >
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
            </Button>
          )}
        </div>
        {expanded && (
          <div className="mt-1">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChainTracePanel({ workOrderId, open, onClose }: ChainTracePanelProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set(["avtal", "artiklar", "uppgift", "resurs", "utfall", "faktura"]));

  const { data: trace, isLoading, error } = useQuery<ChainTraceData>({
    queryKey: ["/api/chain-trace", workOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/chain-trace/${workOrderId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Fel ${res.status}`);
      }
      return res.json();
    },
    enabled: open && !!workOrderId,
  });

  const toggleStep = (key: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const hasAvtal = !!trace?.avtal?.id;
  const hasArtiklar = (trace?.artiklar?.length ?? 0) > 0;
  const hasResurs = !!trace?.resurs;
  const hasUtfall = !!trace?.utfall?.completedAt || (trace?.utfall?.protocols?.length ?? 0) > 0;
  const hasFaktura = (trace?.faktura?.length ?? 0) > 0;

  const steps: StepConfig[] = [
    { key: "avtal", icon: FileText, label: "Avtal / Orderkoncept", active: hasAvtal, completed: hasAvtal, navigateTo: trace?.avtal?.id ? `/order-concepts/${trace.avtal.id}/edit` : undefined },
    { key: "artiklar", icon: Package, label: `Artiklar (${trace?.artiklar?.length ?? 0})`, active: hasArtiklar, completed: hasArtiklar, navigateTo: hasArtiklar ? `/articles` : undefined },
    { key: "uppgift", icon: ClipboardList, label: "Uppgift", active: true, completed: true, navigateTo: trace?.uppgift?.objectId ? `/objects/${trace.uppgift.objectId}` : undefined },
    { key: "resurs", icon: User, label: "Resurs", active: hasResurs, completed: hasResurs, navigateTo: trace?.resurs?.id ? `/resources` : undefined },
    { key: "utfall", icon: CheckCircle2, label: "Utfall", active: hasUtfall, completed: hasUtfall },
    { key: "faktura", icon: Receipt, label: "Faktura", active: hasFaktura, completed: hasFaktura, navigateTo: hasFaktura ? `/invoicing` : undefined },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-chain-trace">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ClipboardList className="w-5 h-5 text-[#1B4B6B] dark:text-[#7DBFB0]" />
            Kedjeöversikt
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-12" data-testid="chain-trace-loading">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-4 text-destructive" data-testid="chain-trace-error">
            <AlertCircle className="w-5 h-5" />
            <span>{(error as Error).message || "Kunde inte ladda kedjedata"}</span>
          </div>
        )}

        {trace && (
          <div className="pt-2" data-testid="chain-trace-content">
            <VerticalStep step={steps[0]} isLast={false} expanded={expandedSteps.has("avtal")} onToggle={() => toggleStep("avtal")}>
              <div data-testid="chain-section-avtal">
                {trace.avtal ? (
                  <div className="bg-muted/40 rounded-lg p-3 space-y-1">
                    {trace.avtal.id ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm" data-testid="text-avtal-name">{trace.avtal.name}</span>
                        {trace.avtal.status && (
                          <Badge className={STATUS_COLORS[trace.avtal.status] || "bg-gray-100"} data-testid="badge-avtal-status">
                            {trace.avtal.status}
                          </Badge>
                        )}
                        {trace.avtal.scenario && (
                          <Badge variant="outline" data-testid="badge-avtal-scenario">
                            {SCENARIO_LABELS[trace.avtal.scenario] || trace.avtal.scenario}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground italic">Inget orderkoncept kopplat</span>
                    )}
                    {trace.avtal.customerName && (
                      <p className="text-sm text-muted-foreground" data-testid="text-avtal-customer">
                        Kund: <span className="text-foreground">{trace.avtal.customerName}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Ingen avtals- eller kundinformation</p>
                )}
              </div>
            </VerticalStep>

            <VerticalStep step={steps[1]} isLast={false} expanded={expandedSteps.has("artiklar")} onToggle={() => toggleStep("artiklar")}>
              <div data-testid="chain-section-artiklar">
                {trace.artiklar.length > 0 ? (
                  <div className="space-y-1">
                    {trace.artiklar.map((art) => (
                      <div key={art.id} className="bg-muted/40 rounded-lg p-2.5 flex items-center justify-between gap-2" data-testid={`row-artikel-${art.id}`}>
                        <div className="min-w-0">
                          <span className="font-medium text-sm">{art.name || "Okänd artikel"}</span>
                          {art.articleNumber && (
                            <span className="text-xs text-muted-foreground ml-1.5">#{art.articleNumber}</span>
                          )}
                          <span className="text-xs text-muted-foreground ml-1.5">× {art.quantity}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-medium">{formatCurrency(art.resolvedPrice)}</span>
                          {art.priceSource && (
                            <Badge variant="outline" className="ml-1.5 text-xs">{art.priceSource}</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Inga artiklar kopplade</p>
                )}
              </div>
            </VerticalStep>

            <VerticalStep step={steps[2]} isLast={false} expanded={expandedSteps.has("uppgift")} onToggle={() => toggleStep("uppgift")}>
              <div data-testid="chain-section-uppgift">
                <div className="bg-muted/40 rounded-lg p-3 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm" data-testid="text-uppgift-title">{trace.uppgift.title}</span>
                    <Badge className={STATUS_COLORS[trace.uppgift.orderStatus] || STATUS_COLORS[trace.uppgift.status] || "bg-gray-100"} data-testid="badge-uppgift-status">
                      {trace.uppgift.orderStatus}
                    </Badge>
                  </div>
                  {trace.uppgift.objectName && (
                    <p className="text-sm text-muted-foreground" data-testid="text-uppgift-object">
                      Objekt: <span className="text-foreground">{trace.uppgift.objectName}</span>
                      {trace.uppgift.objectAddress && <span className="ml-1 text-xs">({trace.uppgift.objectAddress})</span>}
                    </p>
                  )}
                  {trace.uppgift.scheduledDate && (
                    <p className="text-sm text-muted-foreground">
                      Planerad: <span className="text-foreground">{format(new Date(trace.uppgift.scheduledDate), "d MMM yyyy", { locale: sv })}</span>
                    </p>
                  )}
                  {trace.uppgift.completedAt && (
                    <p className="text-sm text-muted-foreground">
                      Slutförd: <span className="text-foreground">{format(new Date(trace.uppgift.completedAt), "d MMM yyyy HH:mm", { locale: sv })}</span>
                    </p>
                  )}
                </div>
              </div>
            </VerticalStep>

            <VerticalStep step={steps[3]} isLast={false} expanded={expandedSteps.has("resurs")} onToggle={() => toggleStep("resurs")}>
              <div data-testid="chain-section-resurs">
                {trace.resurs ? (
                  <div className="bg-muted/40 rounded-lg p-3 space-y-1">
                    <span className="font-medium text-sm" data-testid="text-resurs-name">{trace.resurs.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{trace.resurs.resourceType}</Badge>
                      {trace.resurs.phone && (
                        <span className="text-xs text-muted-foreground">{trace.resurs.phone}</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Ingen resurs tilldelad</p>
                )}
              </div>
            </VerticalStep>

            <VerticalStep step={steps[4]} isLast={false} expanded={expandedSteps.has("utfall")} onToggle={() => toggleStep("utfall")}>
              <div data-testid="chain-section-utfall">
                {hasUtfall ? (
                  <div className="space-y-1.5">
                    {trace.utfall.completedAt && (
                      <div className="bg-muted/40 rounded-lg p-2.5 space-y-1">
                        <p className="text-sm">
                          Slutförd: <span className="font-medium">{format(new Date(trace.utfall.completedAt), "d MMM yyyy HH:mm", { locale: sv })}</span>
                        </p>
                        {trace.utfall.actualDuration && (
                          <p className="text-sm text-muted-foreground">
                            Faktisk tid: <span className="text-foreground">{trace.utfall.actualDuration} min</span>
                          </p>
                        )}
                      </div>
                    )}
                    {trace.utfall.protocols.map((p) => (
                      <div key={p.id} className="bg-muted/40 rounded-lg p-2.5 flex items-center justify-between" data-testid={`row-protocol-${p.id}`}>
                        <div>
                          <span className="text-sm font-medium">{p.protocolType}</span>
                          {p.protocolNumber && <span className="text-xs text-muted-foreground ml-1.5">#{p.protocolNumber}</span>}
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(p.executedAt), "d MMM yyyy HH:mm", { locale: sv })}
                            {p.executedByName && ` — ${p.executedByName}`}
                          </p>
                        </div>
                        {p.status && <Badge className={STATUS_COLORS[p.status] || "bg-gray-100"} data-testid={`badge-protocol-status-${p.id}`}>{p.status}</Badge>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Inga utfallsdata ännu</p>
                )}
              </div>
            </VerticalStep>

            <VerticalStep step={steps[5]} isLast={true} expanded={expandedSteps.has("faktura")} onToggle={() => toggleStep("faktura")}>
              <div data-testid="chain-section-faktura">
                {trace.faktura.length > 0 ? (
                  <div className="space-y-1">
                    {trace.faktura.map((inv) => (
                      <div key={inv.id} className="bg-muted/40 rounded-lg p-2.5 flex items-center justify-between" data-testid={`row-faktura-${inv.id}`}>
                        <div>
                          <span className="text-sm font-medium">
                            {inv.fortnoxInvoiceNumber ? `Faktura #${inv.fortnoxInvoiceNumber}` : "Ej exporterad"}
                          </span>
                          {inv.isCreditInvoice && <Badge variant="outline" className="ml-1.5 text-xs border-destructive/30 text-destructive dark:border-destructive/70">Kredit</Badge>}
                          {inv.exportedAt && (
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(inv.exportedAt), "d MMM yyyy", { locale: sv })}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium">{formatCurrency(inv.totalAmount)}</span>
                          <Badge className={`ml-1.5 ${STATUS_COLORS[inv.status] || "bg-gray-100"}`} data-testid={`badge-faktura-status-${inv.id}`}>{inv.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Ej fakturerad</p>
                )}
              </div>
            </VerticalStep>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
