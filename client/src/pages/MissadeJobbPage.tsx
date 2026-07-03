import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CircleSlash, Search, ExternalLink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useExecutionCodes } from "@/hooks/use-execution-codes";
import { IMPOSSIBLE_REASONS, IMPOSSIBLE_REASON_LABELS, type GeographicDistrict } from "@shared/schema";

// Task #1155 (Feature G): Rapport över ej-utförda uppgifter ("kunde ej utföras").
// Läsvy ovanpå backend-endpointen /api/reports/unperformed-orders. Filtrera per
// distrikt, utförarkod, orsak, fritext och datumintervall; summeringskort per
// distrikt/utförarkod/orsak samt en tabell som djuplänkar till respektive order.

const ALL = "__all__";

interface UnperformedOrder {
  id: string;
  orderNumber: string | null;
  title: string | null;
  objectId: string | null;
  objectName: string | null;
  districtId: string | null;
  districtName: string | null;
  executionCode: string | null;
  reasonCode: string | null;
  reason: string | null;
  reasonText: string | null;
  impossibleAt: string | null;
  impossibleByName: string | null;
  scheduledDate: string | null;
}
interface AggBucket {
  key: string;
  label: string;
  count: number;
}
interface UnperformedReport {
  orders: UnperformedOrder[];
  summary: {
    total: number;
    byDistrict: AggBucket[];
    byExecutionCode: AggBucket[];
    byReason: AggBucket[];
  };
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("sv-SE") : "—";

export default function MissadeJobbPage() {
  const [search, setSearch] = useState("");
  const [districtId, setDistrictId] = useState<string>(ALL);
  const [executionCode, setExecutionCode] = useState<string>(ALL);
  const [reason, setReason] = useState<string>(ALL);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const districtsQuery = useQuery<GeographicDistrict[]>({
    queryKey: ["/api/districts"],
  });
  const districts = districtsQuery.data ?? [];
  const { options: executionOptions } = useExecutionCodes();

  const filters = { search, districtId, executionCode, reason, startDate, endDate };

  const reportQuery = useQuery<UnperformedReport>({
    queryKey: ["/api/reports/unperformed-orders", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (districtId !== ALL) params.set("districtId", districtId);
      if (executionCode !== ALL) params.set("executionCode", executionCode);
      if (reason !== ALL) params.set("reason", reason);
      if (startDate) params.set("startDate", new Date(startDate).toISOString());
      if (endDate) {
        // inkludera hela slutdagen
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        params.set("endDate", end.toISOString());
      }
      const qs = params.toString();
      const res = await apiRequest("GET", `/api/reports/unperformed-orders${qs ? `?${qs}` : ""}`);
      return res.json();
    },
  });

  const report = reportQuery.data;
  const hasActiveFilters =
    !!search.trim() ||
    districtId !== ALL ||
    executionCode !== ALL ||
    reason !== ALL ||
    !!startDate ||
    !!endDate;

  const clearFilters = () => {
    setSearch("");
    setDistrictId(ALL);
    setExecutionCode(ALL);
    setReason(ALL);
    setStartDate("");
    setEndDate("");
  };

  const topBuckets = (buckets: AggBucket[] | undefined) =>
    (buckets ?? []).slice(0, 6);

  const summaryCards = useMemo(
    () => [
      { title: "Per distrikt", buckets: topBuckets(report?.summary.byDistrict), testId: "summary-district" },
      { title: "Per utförarkod", buckets: topBuckets(report?.summary.byExecutionCode), testId: "summary-execution" },
      { title: "Per orsak", buckets: topBuckets(report?.summary.byReason), testId: "summary-reason" },
    ],
    [report],
  );

  return (
    <div className="space-y-6 p-6" data-testid="page-missade-jobb">
      <PageHeader
        icon={CircleSlash}
        title="Ej-utförda uppgifter"
        description="Uppgifter som inte kunde utföras (markerade 'kunde ej utföras') — med orsak, distrikt och tidpunkt."
        testId="text-missade-jobb-title"
      />

      {/* Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Sök titel, objekt eller ordernummer"
                className="pl-9"
                data-testid="input-search"
              />
            </div>

            <Select value={districtId} onValueChange={setDistrictId}>
              <SelectTrigger data-testid="select-district">
                <SelectValue placeholder="Distrikt" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Alla distrikt</SelectItem>
                {districts.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={executionCode} onValueChange={setExecutionCode}>
              <SelectTrigger data-testid="select-execution-code">
                <SelectValue placeholder="Utförarkod" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Alla utförarkoder</SelectItem>
                {executionOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger data-testid="select-reason">
                <SelectValue placeholder="Orsak" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Alla orsaker</SelectItem>
                {IMPOSSIBLE_REASONS.map((code) => (
                  <SelectItem key={code} value={code}>
                    {IMPOSSIBLE_REASON_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-start-date"
                aria-label="Från datum"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                data-testid="input-end-date"
                aria-label="Till datum"
              />
            </div>

            {hasActiveFilters && (
              <div className="flex items-center">
                <Button variant="ghost" onClick={clearFilters} data-testid="button-clear-filters">
                  Rensa filter
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summeringskort */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Totalt ej-utförda</CardTitle>
          </CardHeader>
          <CardContent>
            {reportQuery.isLoading ? (
              <Skeleton className="h-9 w-16" />
            ) : (
              <div className="text-3xl font-semibold text-destructive" data-testid="text-total">
                {report?.summary.total ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        {summaryCards.map((card) => (
          <Card key={card.testId}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
            </CardHeader>
            <CardContent>
              {reportQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : card.buckets.length === 0 ? (
                <p className="text-sm text-muted-foreground">Inga data.</p>
              ) : (
                <ul className="space-y-1" data-testid={card.testId}>
                  {card.buckets.map((b) => (
                    <li key={b.key} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-foreground">{b.label}</span>
                      <Badge variant="secondary" className="shrink-0">
                        {b.count}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabell */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ordrar</CardTitle>
        </CardHeader>
        <CardContent>
          {reportQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : reportQuery.isError ? (
            <p className="text-sm text-destructive" data-testid="text-error">
              Kunde inte hämta rapporten.
            </p>
          ) : (report?.orders.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-empty">
              Inga ej-utförda uppgifter matchar filtret.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Uppgift</TableHead>
                    <TableHead>Objekt</TableHead>
                    <TableHead>Distrikt</TableHead>
                    <TableHead>Utförarkod</TableHead>
                    <TableHead>Orsak</TableHead>
                    <TableHead>Markerad</TableHead>
                    <TableHead className="text-right">Öppna</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report?.orders.map((o) => (
                    <TableRow key={o.id} data-testid={`row-order-${o.id}`}>
                      <TableCell className="font-medium">
                        <span className="block truncate max-w-[220px]">{o.title || "Uppgift"}</span>
                        {o.orderNumber && (
                          <span className="text-xs text-muted-foreground">#{o.orderNumber}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{o.objectName || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{o.districtName || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{o.executionCode || "—"}</TableCell>
                      <TableCell>
                        {o.reason ? (
                          <Badge variant="destructive" data-testid={`badge-reason-${o.id}`}>
                            {o.reason}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {o.reasonText && (
                          <span className="block text-xs text-muted-foreground truncate max-w-[220px]">
                            {o.reasonText}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {fmtDate(o.impossibleAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/work-orders/${o.id}`}>
                          <Button variant="ghost" size="sm" data-testid={`link-order-${o.id}`}>
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
