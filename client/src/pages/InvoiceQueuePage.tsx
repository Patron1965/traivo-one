import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryState } from "@/components/QueryState";
import { apiRequest, queryClient, versionedUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatSekFromOre } from "@/lib/format";
import { Clock, Send, AlertCircle, CheckCircle2, Settings2, Search, Scissors, Layers, ReceiptText } from "lucide-react";

const NO_GROUPING = "__none__";

type QueueWorkOrder = {
  id: string;
  title: string | null;
  scheduledDate: string | null;
  frozenUnitPrice: number | string | null;
  frozenQuantity: number | string | null;
  cachedValue: number | string | null;
};

type QueueGroup = {
  key: string;
  recipientId: string | null;
  recipientName: string | null;
  recipientLevel: string | null;
  customerId: string | null;
  customerName: string | null;
  heldUntil: string | null;
  totalAmount: number;
  workOrders: QueueWorkOrder[];
};

type QueueResponse = {
  state: string;
  groups: QueueGroup[];
  totalWorkOrders: number;
};

type ConsolidatedInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  state: string;
  customerName: string | null;
  recipientName: string | null;
  consolidationPeriodStart: string | null;
  consolidationPeriodEnd: string | null;
  workOrderIds: string[];
  releasedReason: string | null;
};

type FlowConfig = {
  enabled: boolean;
  breakFieldName: string;
  groupingFieldName: string | null;
};
type CatalogField = { id: string; namn: string; datatyp: string | null };
type FlowConfigResponse = { config: FlowConfig; availableFields: CatalogField[] };

type ObjectLite = { id: string; name: string; displayName?: string | null };

type PreviewGroup = {
  key: string;
  recipientName: string | null;
  customerName: string | null;
  segmentKey: string | null;
  breakObjectId: string | null;
  breakObjectName: string | null;
  groupingFieldName: string | null;
  groupingValue: string | null;
  workOrderCount: number;
  totalAmount: number;
};
type PreviewResponse = {
  enabled: boolean;
  config: FlowConfig;
  root: { id: string; name: string };
  groups: PreviewGroup[];
  totalWorkOrders: number;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

export default function InvoiceQueuePage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"held" | "consolidated" | "flow">("held");
  const [recipientFilter, setRecipientFilter] = useState("");

  const queueQuery = useQuery<QueueResponse>({
    queryKey: ["/api/invoice-queue", { state: "held" }],
  });

  const filteredGroups = (queueQuery.data?.groups ?? []).filter((g) => {
    if (!recipientFilter.trim()) return true;
    const q = recipientFilter.trim().toLowerCase();
    return (
      (g.recipientName ?? "").toLowerCase().includes(q) ||
      (g.customerName ?? "").toLowerCase().includes(q)
    );
  });

  const consolidatedQuery = useQuery<ConsolidatedInvoice[]>({
    queryKey: ["/api/invoice-queue/consolidated"],
    enabled: tab === "consolidated",
  });

  const releaseMutation = useMutation({
    mutationFn: async (payload: { recipientId?: string; customerId?: string; reason?: string }) => {
      const res = await apiRequest("POST", "/api/invoice-queue/release", payload);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Fakturor släppta",
        description: `${data.invoicesCreated ?? 0} samlingsfakturor skapade (${data.workOrdersConsolidated ?? 0} arbetsorder).`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-queue/consolidated"] });
    },
    onError: (err: any) => {
      toast({
        title: "Kunde inte släppa",
        description: err?.message ?? "Okänt fel",
        variant: "destructive",
      });
    },
  });

  const releaseAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/invoice-queue/release", { reason: "Släpp alla via Fakturakö" });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Alla bromsade fakturor släppta",
        description: `${data.invoicesCreated ?? 0} samlingsfakturor skapade.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-queue/consolidated"] });
    },
  });

  // --- Task #970: Fakturaflöde (config + förhandsvisning) ---
  const [cfgEnabled, setCfgEnabled] = useState(false);
  const [cfgBreak, setCfgBreak] = useState("");
  const [cfgGrouping, setCfgGrouping] = useState<string>(NO_GROUPING);
  const [objSearch, setObjSearch] = useState("");
  const [debouncedObjSearch, setDebouncedObjSearch] = useState("");
  const [selectedObject, setSelectedObject] = useState<ObjectLite | null>(null);

  const configQuery = useQuery<FlowConfigResponse>({
    queryKey: ["/api/invoice-flow/config"],
    enabled: tab === "flow",
  });

  useEffect(() => {
    const c = configQuery.data?.config;
    if (c) {
      setCfgEnabled(c.enabled);
      setCfgBreak(c.breakFieldName);
      setCfgGrouping(c.groupingFieldName ?? NO_GROUPING);
    }
  }, [configQuery.data]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedObjSearch(objSearch), 300);
    return () => clearTimeout(t);
  }, [objSearch]);

  const objectsQuery = useQuery<ObjectLite[]>({
    queryKey: ["/api/objects", "invoice-flow-picker", debouncedObjSearch],
    enabled: tab === "flow" && debouncedObjSearch.trim().length >= 2,
    queryFn: async () => {
      const res = await fetch(
        versionedUrl(`/api/objects?limit=20&search=${encodeURIComponent(debouncedObjSearch.trim())}`),
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Kunde inte söka objekt");
      const data = await res.json();
      return Array.isArray(data) ? data : (data.objects ?? []);
    },
  });

  const previewQuery = useQuery<PreviewResponse>({
    queryKey: ["/api/invoice-flow/preview", selectedObject?.id ?? ""],
    enabled: tab === "flow" && !!selectedObject?.id,
    queryFn: async () => {
      const res = await fetch(
        versionedUrl(`/api/invoice-flow/preview?rootObjectId=${encodeURIComponent(selectedObject!.id)}`),
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Kunde inte hämta förhandsvisning");
      return res.json();
    },
  });

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      const body = {
        enabled: cfgEnabled,
        breakFieldName: cfgBreak.trim() || "Fakturastopp",
        groupingFieldName: cfgGrouping === NO_GROUPING ? null : cfgGrouping,
      };
      const res = await apiRequest("PUT", "/api/invoice-flow/config", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sparat", description: "Fakturaflödes-reglerna har uppdaterats." });
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-flow/config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoice-flow/preview"] });
    },
    onError: (err: any) =>
      toast({ title: "Kunde inte spara", description: err?.message ?? "Okänt fel", variant: "destructive" }),
  });

  const fieldNames = (configQuery.data?.availableFields ?? []).map((f) => f.namn);
  const breakOptions = cfgBreak && !fieldNames.includes(cfgBreak) ? [cfgBreak, ...fieldNames] : fieldNames;
  const groupingOptions =
    cfgGrouping !== NO_GROUPING && cfgGrouping && !fieldNames.includes(cfgGrouping)
      ? [cfgGrouping, ...fieldNames]
      : fieldNames;

  return (
    <div className="container mx-auto py-6 space-y-6" data-testid="page-invoice-queue">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fakturakö</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            Arbetsorder som väntar på konsolidering enligt fakturamottagarens policy
            (immediate / daily / weekly / monthly). När perioden stänger plockas de
            automatiskt och blir samlingsfakturor.
          </p>
        </div>
        <Button
          variant="default"
          onClick={() => releaseAllMutation.mutate()}
          disabled={releaseAllMutation.isPending || !queueQuery.data?.groups.length}
          data-testid="button-release-all"
        >
          <Send className="h-4 w-4 mr-2" />
          Släpp alla nu
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "held" | "consolidated")}>
        <TabsList>
          <TabsTrigger value="held" data-testid="tab-held">
            <Clock className="h-4 w-4 mr-2" />
            Bromsade ({queueQuery.data?.totalWorkOrders ?? 0})
          </TabsTrigger>
          <TabsTrigger value="consolidated" data-testid="tab-consolidated">
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Konsoliderade
          </TabsTrigger>
          <TabsTrigger value="flow" data-testid="tab-flow">
            <Settings2 className="h-4 w-4 mr-2" />
            Fakturaflöde
          </TabsTrigger>
        </TabsList>

        <TabsContent value="held" className="space-y-4 mt-4">
          <Input
            placeholder="Filtrera på mottagare eller kund..."
            value={recipientFilter}
            onChange={(e) => setRecipientFilter(e.target.value)}
            className="max-w-md"
            data-testid="input-recipient-filter"
          />
          <QueryState
            isLoading={queueQuery.isLoading}
            isError={!!queueQuery.error}
            error={queueQuery.error as Error | null}
            isEmpty={!filteredGroups.length}
            emptyTitle="Inga bromsade fakturor"
            emptyDescription="Alla mottagare har policy=immediate, perioden har inte stängt än, eller filtret matchar ingen."
          >
            {filteredGroups.map((group) => (
              <Card key={group.key} data-testid={`card-group-${group.key}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <CardTitle className="text-base">
                        {group.recipientName ?? group.customerName ?? "Okänd mottagare"}
                      </CardTitle>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                        {group.recipientLevel && (
                          <Badge variant="outline" data-testid={`badge-level-${group.key}`}>
                            {group.recipientLevel}
                          </Badge>
                        )}
                        {group.customerName && group.recipientName && (
                          <span>Kund: {group.customerName}</span>
                        )}
                        <span>
                          Släpps: {group.heldUntil ? formatDate(group.heldUntil) : "Manuell"}
                        </span>
                        <span data-testid={`text-total-${group.key}`}>
                          Totalt: {formatSekFromOre(group.totalAmount)}
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() =>
                        releaseMutation.mutate({
                          recipientId: group.recipientId ?? undefined,
                          customerId: group.recipientId ? undefined : (group.customerId ?? undefined),
                          reason: `Manuell släpp via Fakturakö för ${group.recipientName ?? group.customerName ?? "okänd"}`,
                        })
                      }
                      disabled={releaseMutation.isPending}
                      data-testid={`button-release-${group.key}`}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Släpp nu
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table density="compact">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Arbetsorder</TableHead>
                        <TableHead>Planerad</TableHead>
                        <TableHead className="text-right">Belopp</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.workOrders.map((wo) => {
                        const price = Number(wo.frozenUnitPrice ?? 0);
                        const qty = Number(wo.frozenQuantity ?? 0);
                        const amount = price > 0 && qty > 0 ? Math.round(price * qty) : Math.round(Number(wo.cachedValue ?? 0));
                        return (
                          <TableRow key={wo.id} data-testid={`row-wo-${wo.id}`}>
                            <TableCell className="font-mono text-xs">
                              {wo.title ?? wo.id.slice(0, 8)}
                            </TableCell>
                            <TableCell className="text-xs">{formatDate(wo.scheduledDate)}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatSekFromOre(amount)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </QueryState>
        </TabsContent>

        <TabsContent value="consolidated" className="space-y-4 mt-4">
          <QueryState
            isLoading={consolidatedQuery.isLoading}
            isError={!!consolidatedQuery.error}
            error={consolidatedQuery.error as Error | null}
            isEmpty={!consolidatedQuery.data?.length}
            emptyTitle="Inga konsoliderade fakturor"
            emptyDescription="Här hamnar samlingsfakturor efter att en period stängts eller en manuell släpp körts."
          >
            <Card>
              <CardContent className="pt-6">
                <Table density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fakturanr</TableHead>
                      <TableHead>Datum</TableHead>
                      <TableHead>Mottagare / Kund</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Antal WO</TableHead>
                      <TableHead className="text-right">Summa</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {consolidatedQuery.data?.map((inv) => (
                      <TableRow key={inv.id} data-testid={`row-invoice-${inv.id}`}>
                        <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                        <TableCell className="text-xs">{formatDate(inv.invoiceDate)}</TableCell>
                        <TableCell>{inv.recipientName ?? inv.customerName ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {formatDate(inv.consolidationPeriodStart)} → {formatDate(inv.consolidationPeriodEnd)}
                        </TableCell>
                        <TableCell className="tabular-nums">{inv.workOrderIds?.length ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatSekFromOre(Math.round(inv.totalAmount))}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{inv.state}</Badge>
                          {inv.releasedReason && (
                            <span className="ml-2 inline-flex items-center text-xs text-warning">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              Släppt manuellt
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </QueryState>
        </TabsContent>

        <TabsContent value="flow" className="space-y-4 mt-4">
          {/* --- Konfiguration --- */}
          <Card data-testid="card-flow-config">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Regler för fakturaflöde
              </CardTitle>
              <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
                När ett orderkoncept pekas in från toppen av ett objektträd samlas alla
                färdiga arbetsorder i grenarna under normalt på <strong>en</strong> faktura.
                Två metadatastyrda regler kan dela upp den: ett <strong>fakturastopp</strong> på
                en nod bryter samlingen där, och ett <strong>grupperingsfält</strong> (t.ex.
                Förvaltare) ger en faktura per distinkt värde. Avstängt = exakt som idag.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <QueryState
                isLoading={configQuery.isLoading}
                isError={!!configQuery.error}
                error={configQuery.error as Error | null}
                isEmpty={false}
              >
                <div className="flex items-center justify-between gap-4 rounded-md border p-4">
                  <div>
                    <Label htmlFor="switch-flow-enabled" className="text-sm font-medium">
                      Aktivera metadatastyrt fakturaflöde
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Påverkar endast arbetsorder som markeras redo att fakturera efter att detta sparats.
                    </p>
                  </div>
                  <Switch
                    id="switch-flow-enabled"
                    checked={cfgEnabled}
                    onCheckedChange={setCfgEnabled}
                    data-testid="switch-flow-enabled"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm flex items-center gap-2">
                      <Scissors className="h-3.5 w-3.5" />
                      Fakturastopp-fält
                    </Label>
                    <Select value={cfgBreak || undefined} onValueChange={setCfgBreak}>
                      <SelectTrigger data-testid="select-break-field">
                        <SelectValue placeholder="Välj metadatafält..." />
                      </SelectTrigger>
                      <SelectContent>
                        {breakOptions.length === 0 && (
                          <SelectItem value="Fakturastopp">Fakturastopp</SelectItem>
                        )}
                        {breakOptions.map((name) => (
                          <SelectItem key={name} value={name} data-testid={`option-break-${name}`}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Objekt där detta fält är sant (Ja/true) bryter samlingen. Läses lokalt per nod.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5" />
                      Grupperingsfält
                    </Label>
                    <Select value={cfgGrouping} onValueChange={setCfgGrouping}>
                      <SelectTrigger data-testid="select-grouping-field">
                        <SelectValue placeholder="Ingen gruppering" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_GROUPING} data-testid="option-grouping-none">
                          Ingen gruppering
                        </SelectItem>
                        {groupingOptions.map((name) => (
                          <SelectItem key={name} value={name} data-testid={`option-grouping-${name}`}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      En separat faktura per distinkt värde. Värdet ärvs nedåt (närmaste vinner).
                    </p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={() => saveConfigMutation.mutate()}
                    disabled={saveConfigMutation.isPending}
                    data-testid="button-save-flow-config"
                  >
                    Spara regler
                  </Button>
                </div>
              </QueryState>
            </CardContent>
          </Card>

          {/* --- Förhandsvisning --- */}
          <Card data-testid="card-flow-preview">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ReceiptText className="h-4 w-4" />
                Förhandsvisning
              </CardTitle>
              <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
                Välj toppobjektet för ett träd för att se hur fakturorna skulle delas upp
                med <strong>aktuell</strong> metadata och reglerna ovan. Beräknas live och
                kan skilja sig från redan frysta arbetsorder.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Sök objekt (minst 2 tecken)..."
                  value={objSearch}
                  onChange={(e) => setObjSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-object-search"
                />
                {debouncedObjSearch.trim().length >= 2 && !selectedObject && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-auto">
                    {objectsQuery.isLoading && (
                      <div className="p-3 text-sm text-muted-foreground">Söker...</div>
                    )}
                    {!objectsQuery.isLoading && (objectsQuery.data?.length ?? 0) === 0 && (
                      <div className="p-3 text-sm text-muted-foreground">Inga objekt matchar.</div>
                    )}
                    {objectsQuery.data?.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className="block w-full text-left px-3 py-2 text-sm hover-elevate"
                        onClick={() => {
                          setSelectedObject(o);
                          setObjSearch(o.displayName || o.name);
                        }}
                        data-testid={`option-object-${o.id}`}
                      >
                        {o.displayName || o.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedObject && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Valt toppobjekt:</span>
                  <Badge variant="secondary" data-testid="badge-selected-object">
                    {selectedObject.displayName || selectedObject.name}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedObject(null);
                      setObjSearch("");
                    }}
                    data-testid="button-clear-object"
                  >
                    Rensa
                  </Button>
                </div>
              )}

              {selectedObject && (
                <QueryState
                  isLoading={previewQuery.isLoading}
                  isError={!!previewQuery.error}
                  error={previewQuery.error as Error | null}
                  isEmpty={!previewQuery.data?.groups.length}
                  emptyTitle="Inga fakturerbara arbetsorder"
                  emptyDescription="Det här trädet har inga arbetsorder med kund eller frusen mottagare ännu."
                >
                  {!previewQuery.data?.enabled && (
                    <div
                      className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
                      data-testid="banner-flow-disabled"
                    >
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      Funktionen är avstängd — detta är en förhandsvisning av vad som skulle hända om du aktiverar den.
                    </div>
                  )}
                  <div className="text-sm text-muted-foreground" data-testid="text-preview-summary">
                    {previewQuery.data?.groups.length ?? 0} faktura
                    {(previewQuery.data?.groups.length ?? 0) === 1 ? "" : "or"} skulle skapas från{" "}
                    {previewQuery.data?.totalWorkOrders ?? 0} arbetsorder.
                  </div>
                  <div className="grid gap-3">
                    {previewQuery.data?.groups.map((g) => (
                      <Card key={g.key} data-testid={`card-preview-group-${g.key}`}>
                        <CardContent className="pt-4">
                          <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div className="space-y-1.5">
                              <div className="font-medium">
                                {g.recipientName ?? g.customerName ?? "Okänd mottagare"}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {g.breakObjectName && (
                                  <Badge variant="outline" className="gap-1" data-testid={`badge-break-${g.key}`}>
                                    <Scissors className="h-3 w-3" />
                                    Fakturastopp: {g.breakObjectName}
                                  </Badge>
                                )}
                                {g.groupingValue && (
                                  <Badge variant="outline" className="gap-1" data-testid={`badge-grouping-${g.key}`}>
                                    <Layers className="h-3 w-3" />
                                    {g.groupingFieldName ?? "Gruppering"}: {g.groupingValue}
                                  </Badge>
                                )}
                                {!g.segmentKey && (
                                  <Badge variant="secondary" data-testid={`badge-standard-${g.key}`}>
                                    Standard (ingen uppdelning)
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-lg font-semibold tabular-nums" data-testid={`text-preview-amount-${g.key}`}>
                                {formatSekFromOre(g.totalAmount)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {g.workOrderCount} arbetsorder
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </QueryState>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
