import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { QueryState } from "@/components/QueryState";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatSekFromOre } from "@/lib/format";
import { Clock, Send, AlertCircle, CheckCircle2 } from "lucide-react";

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

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

export default function InvoiceQueuePage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"held" | "consolidated">("held");
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
      </Tabs>
    </div>
  );
}
