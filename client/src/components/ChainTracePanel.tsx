import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, FileText, Package, ClipboardList, User, CheckCircle2, Receipt, ChevronRight, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

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
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  exported: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

function formatCurrency(amount: number | null): string {
  if (amount == null) return "-";
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", minimumFractionDigits: 0 }).format(amount / 100);
}

function StepNode({ icon: Icon, label, active, completed, last }: {
  icon: typeof FileText;
  label: string;
  active: boolean;
  completed: boolean;
  last?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 transition-colors ${
        completed
          ? "bg-[#4A9B9B] border-[#4A9B9B] text-white"
          : active
            ? "border-[#1B4B6B] text-[#1B4B6B] dark:border-[#7DBFB0] dark:text-[#7DBFB0]"
            : "border-gray-300 text-gray-400 dark:border-gray-600 dark:text-gray-500"
      }`}>
        <Icon className="w-4 h-4" />
      </div>
      <span className={`text-sm font-medium ${
        completed || active
          ? "text-foreground"
          : "text-muted-foreground"
      }`}>{label}</span>
      {!last && <ChevronRight className="w-4 h-4 text-muted-foreground mx-1" />}
    </div>
  );
}

export function ChainTracePanel({ workOrderId, open, onClose }: ChainTracePanelProps) {
  const { data: trace, isLoading, error } = useQuery<ChainTraceData>({
    queryKey: ["/api/chain-trace", workOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/chain-trace/${workOrderId}`);
      if (!res.ok) throw new Error("Kunde inte hämta kedjedata");
      return res.json();
    },
    enabled: open && !!workOrderId,
  });

  const hasAvtal = !!trace?.avtal?.id;
  const hasArtiklar = (trace?.artiklar?.length ?? 0) > 0;
  const hasResurs = !!trace?.resurs;
  const hasUtfall = !!trace?.utfall?.completedAt || (trace?.utfall?.protocols?.length ?? 0) > 0;
  const hasFaktura = (trace?.faktura?.length ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-chain-trace">
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
          <div className="flex items-center gap-2 p-4 text-red-600 dark:text-red-400" data-testid="chain-trace-error">
            <AlertCircle className="w-5 h-5" />
            <span>Kunde inte ladda kedjedata</span>
          </div>
        )}

        {trace && (
          <div className="space-y-4" data-testid="chain-trace-content">
            <div className="flex flex-wrap items-center gap-1 py-2 px-1" data-testid="chain-trace-stepper">
              <StepNode icon={FileText} label="Avtal" active={hasAvtal} completed={hasAvtal} />
              <StepNode icon={Package} label="Artikel" active={hasArtiklar} completed={hasArtiklar} />
              <StepNode icon={ClipboardList} label="Uppgift" active={true} completed={true} />
              <StepNode icon={User} label="Resurs" active={hasResurs} completed={hasResurs} />
              <StepNode icon={CheckCircle2} label="Utfall" active={hasUtfall} completed={hasUtfall} />
              <StepNode icon={Receipt} label="Faktura" active={hasFaktura} completed={hasFaktura} last />
            </div>

            <Separator />

            <div className="space-y-4">
              <section data-testid="chain-section-avtal">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Avtal / Orderkoncept
                </h3>
                {trace.avtal ? (
                  <div className="bg-muted/40 rounded-lg p-3 space-y-1">
                    {trace.avtal.id ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="font-medium" data-testid="text-avtal-name">{trace.avtal.name}</span>
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
                      </>
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
              </section>

              <section data-testid="chain-section-artiklar">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                  <Package className="w-4 h-4" /> Artiklar ({trace.artiklar.length})
                </h3>
                {trace.artiklar.length > 0 ? (
                  <div className="space-y-1">
                    {trace.artiklar.map((art) => (
                      <div key={art.id} className="bg-muted/40 rounded-lg p-3 flex items-center justify-between" data-testid={`row-artikel-${art.id}`}>
                        <div>
                          <span className="font-medium text-sm">{art.name || "Okänd artikel"}</span>
                          {art.articleNumber && (
                            <span className="text-xs text-muted-foreground ml-2">#{art.articleNumber}</span>
                          )}
                          <span className="text-xs text-muted-foreground ml-2">× {art.quantity}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium">{formatCurrency(art.resolvedPrice)}</span>
                          {art.priceSource && (
                            <Badge variant="outline" className="ml-2 text-xs">{art.priceSource}</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Inga artiklar kopplade</p>
                )}
              </section>

              <section data-testid="chain-section-uppgift">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                  <ClipboardList className="w-4 h-4" /> Uppgift
                </h3>
                <div className="bg-muted/40 rounded-lg p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium" data-testid="text-uppgift-title">{trace.uppgift.title}</span>
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
              </section>

              <section data-testid="chain-section-resurs">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                  <User className="w-4 h-4" /> Resurs
                </h3>
                {trace.resurs ? (
                  <div className="bg-muted/40 rounded-lg p-3 space-y-1">
                    <span className="font-medium" data-testid="text-resurs-name">{trace.resurs.name}</span>
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
              </section>

              <section data-testid="chain-section-utfall">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Utfall
                </h3>
                {hasUtfall ? (
                  <div className="space-y-2">
                    {trace.utfall.completedAt && (
                      <div className="bg-muted/40 rounded-lg p-3 space-y-1">
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
                      <div key={p.id} className="bg-muted/40 rounded-lg p-3 flex items-center justify-between" data-testid={`row-protocol-${p.id}`}>
                        <div>
                          <span className="text-sm font-medium">{p.protocolType}</span>
                          {p.protocolNumber && <span className="text-xs text-muted-foreground ml-2">#{p.protocolNumber}</span>}
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
              </section>

              <section data-testid="chain-section-faktura">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                  <Receipt className="w-4 h-4" /> Faktura
                </h3>
                {trace.faktura.length > 0 ? (
                  <div className="space-y-1">
                    {trace.faktura.map((inv) => (
                      <div key={inv.id} className="bg-muted/40 rounded-lg p-3 flex items-center justify-between" data-testid={`row-faktura-${inv.id}`}>
                        <div>
                          <span className="text-sm font-medium">
                            {inv.fortnoxInvoiceNumber ? `Faktura #${inv.fortnoxInvoiceNumber}` : "Ej exporterad"}
                          </span>
                          {inv.isCreditInvoice && <Badge variant="outline" className="ml-2 text-xs border-red-300 text-red-600 dark:border-red-700 dark:text-red-400">Kreditfaktura</Badge>}
                          {inv.exportedAt && (
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(inv.exportedAt), "d MMM yyyy", { locale: sv })}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium">{formatCurrency(inv.totalAmount)}</span>
                          <Badge className={`ml-2 ${STATUS_COLORS[inv.status] || "bg-gray-100"}`} data-testid={`badge-faktura-status-${inv.id}`}>{inv.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Ej fakturerad</p>
                )}
              </section>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
