import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Receipt, ArrowUpRight, ArrowDownRight, Snowflake } from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { type InvoiceRecalculationLog } from "@shared/schema";

const REASON_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  metadata_change: { label: "Metadata-ändring", variant: "secondary" },
  index_adjustment: { label: "Indexjustering", variant: "default" },
  price_change: { label: "Prisändring", variant: "destructive" },
  manual: { label: "Manuell", variant: "outline" },
};

function formatSEK(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(d));
}

export default function InvoiceRecalculationLogPage() {
  const [workOrderFilter, setWorkOrderFilter] = useState("");

  const { data: logs = [], isLoading } = useQuery<InvoiceRecalculationLog[]>({
    queryKey: ["/api/invoice-recalculation-log", workOrderFilter || null],
    queryFn: async () => {
      const url = workOrderFilter
        ? `/api/invoice-recalculation-log?workOrderId=${encodeURIComponent(workOrderFilter)}`
        : "/api/invoice-recalculation-log";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta omräkningslogg");
      return res.json();
    },
  });

  const totalDelta = logs.reduce((s, l) => s + Number(l.delta ?? 0), 0);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <PageHeader
        icon={Receipt}
        title="Omräkningslogg (faktura)"
        description="Spårbarhet enligt bokföringslagen — alla omräkningar av frysta arbetsorderpriser loggas här."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Antal omräkningar</CardDescription>
            <CardTitle className="text-2xl tabular-nums" data-testid="stat-count">
              {logs.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total nettoförändring</CardDescription>
            <CardTitle
              className={`text-2xl tabular-nums flex items-center gap-2 ${
                totalDelta >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
              }`}
              data-testid="stat-total-delta"
            >
              {totalDelta >= 0 ? (
                <ArrowUpRight className="h-5 w-5" />
              ) : (
                <ArrowDownRight className="h-5 w-5" />
              )}
              {formatSEK(totalDelta)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Senaste omräkning</CardDescription>
            <CardTitle className="text-base font-normal text-muted-foreground" data-testid="stat-latest">
              {logs.length > 0 ? formatDateTime(logs[0].triggeredAt) : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtrera</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Filtrera på arbetsorder-ID..."
            value={workOrderFilter}
            onChange={(e) => setWorkOrderFilter(e.target.value)}
            className="max-w-md"
            data-testid="input-filter-wo"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Snowflake className="h-5 w-5" />
            Omräkningar
          </CardTitle>
          <CardDescription>
            Skapas automatiskt när priset på en fryst arbetsorder räknas om (metadata-ändring, indexjustering, prisändring eller manuellt).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              icon={Snowflake}
              title="Inga omräkningar ännu"
              description="När en fryst arbetsorder räknas om dyker raderna upp här med spårbarhet enligt bokföringslagen."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tidpunkt</TableHead>
                  <TableHead>Arbetsorder</TableHead>
                  <TableHead>Anledning</TableHead>
                  <TableHead className="text-right">Tidigare</TableHead>
                  <TableHead className="text-right">Nytt</TableHead>
                  <TableHead className="text-right">Delta</TableHead>
                  <TableHead>Period(er)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const reason = REASON_LABELS[log.recalculationReason] ?? {
                    label: log.recalculationReason,
                    variant: "outline" as const,
                  };
                  const delta = Number(log.delta ?? 0);
                  const periods = (log.affectedPeriods ?? []) as string[];
                  return (
                    <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDateTime(log.triggeredAt)}
                      </TableCell>
                      <TableCell>
                        {log.workOrderId ? (
                          <Link
                            href={`/work-orders/${log.workOrderId}`}
                            className="text-primary hover:underline font-mono text-xs"
                            data-testid={`link-wo-${log.id}`}
                          >
                            {log.workOrderId.slice(0, 8)}…
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={reason.variant}>{reason.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatSEK(Number(log.previousValue ?? 0))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatSEK(Number(log.newValue ?? 0))}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${
                          delta >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {delta >= 0 ? "+" : ""}
                        {formatSEK(delta)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {periods.length > 0 ? periods.join(", ") : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
