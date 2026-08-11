import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
// OBS: lucide `History` aliasas — oaliasad import skuggar globala inbyggda (lint:icon-shadowing).
import { ClipboardList, ExternalLink, History as HistoryIcon, ListChecks, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { taskSourceLabel } from "@shared/task-source";
import {
  deriveUppgiftStatus,
  UPPGIFT_STATUS_LABELS,
  type InvoiceQueueState,
  type UppgiftStatus,
} from "@shared/uppgift-contract";
import type { ExecutionStatus, OrderStatus } from "@shared/schema";

// Task #1442: "Kopplade ordrar" och "Kopplade uppgifter" är olika relationstyper
// och redovisas i SEPARATA sektioner. Inom varje sektion skiljs aktiva/kommande
// rader från historik (utförda m.fl.) via deriveUppgiftStatus (kontraktets enda
// mappning) — ingen egen statuslogik.
//
// Task #1474: båda sektionerna läser nu den subträds-medvetna endpointen
// GET /api/objects/:id/linked-work?scope=self|subtree och har en växel
// "Endast detta objekt / Inkl. underordnade objekt". Varje rad märks med sitt
// objekt (klickbar länk) när subträdet är på. Uppgiftsnavet har dessutom
// typ- och tidsperiodfilter samt spårbarhetslänkar till källan.

interface LinkedWorkOrder {
  id: string;
  orderNumber?: string | null;
  title?: string | null;
  orderType?: string | null;
  sourceType?: string | null;
  orderConceptId?: string | null;
  orderConceptName?: string | null;
  orderStatus?: string | null;
  executionStatus?: string | null;
  invoiceQueueState?: string | null;
  impossibleReason?: string | null;
  scheduledDate?: string | Date | null;
  createdAt?: string | Date | null;
  objectId?: string | null;
  objectName?: string | null;
  resourceName?: string | null;
}

interface LinkedAssignment {
  id: string;
  title?: string | null;
  status?: string | null;
  sourceType?: string | null;
  orderConceptId?: string | null;
  orderConceptName?: string | null;
  scheduledDate?: string | null;
  createdAt?: string | null;
  objectId?: string | null;
  objectName?: string | null;
  resourceName?: string | null;
}

interface LinkedWorkResponse {
  scope: "self" | "subtree";
  workOrders: LinkedWorkOrder[];
  assignments: LinkedAssignment[];
  truncated: { workOrders: boolean; assignments: boolean };
}

/** Delad hämtning av objektets uppgifter/ordrar, med valfritt subträd. */
function useLinkedWork(objectId: string, includeSubtree: boolean) {
  const scope = includeSubtree ? "subtree" : "self";
  return useQuery<LinkedWorkResponse>({
    queryKey: ["/api/objects", objectId, "linked-work", scope],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${objectId}/linked-work?scope=${scope}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Kunde inte hämta kopplade uppgifter");
      return res.json();
    },
    enabled: !!objectId,
  });
}

interface LinkedRow {
  key: string;
  /** Ordernummer (WO) — klickbar till detaljvyn. Assignments saknar detaljvy. */
  orderNumber: string | null;
  orderId: string | null;
  title: string;
  sourceType: string | null;
  sourceLabel: string;
  orderType: string | null;
  orderConceptId: string | null;
  orderConceptName: string | null;
  objectId: string | null;
  objectName: string | null;
  /** Task #1533: utförare (tilldelad resurs), när sådan finns. */
  resourceName: string | null;
  status: UppgiftStatus;
  statusLabel: string;
  date: Date | null;
}

// Historik = uppgiften har nått ett avslutat/terminalt läge enligt kontraktet.
const HISTORY_STATUSES = new Set<UppgiftStatus>([
  "utford",
  "fakturakontroll",
  "fakturerad",
  "omojlig_att_utfora",
  "avbruten",
]);

// Läsbara etiketter för de vanligaste ordertyperna; okända värden visas rått.
const ORDER_TYPE_LABELS: Record<string, string> = {
  service: "Service",
  installation: "Installation",
  inspection: "Inspektion",
  emergency: "Akut",
  maintenance: "Underhåll",
  startpunkt: "Startpunkt",
};
const orderTypeLabel = (v: string | null): string | null =>
  v ? (ORDER_TYPE_LABELS[v] ?? v) : null;

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sortNewestFirst(rows: LinkedRow[]): LinkedRow[] {
  return [...rows].sort((x, y) => {
    const xt = x.date?.getTime() ?? -Infinity;
    const yt = y.date?.getTime() ?? -Infinity;
    return yt - xt;
  });
}

/** Delad tabellrendering för både order- och uppgiftssektionen. */
function LinkedRowsTable({
  rows,
  testidPrefix,
  showOrderColumn,
  showObjectColumn = false,
  showTypeColumn = false,
  showResourceColumn = false,
}: {
  rows: LinkedRow[];
  testidPrefix: string;
  showOrderColumn: boolean;
  showObjectColumn?: boolean;
  showTypeColumn?: boolean;
  /** Task #1533: kolumnen "Utförare" (tilldelad resurs). */
  showResourceColumn?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {showTypeColumn && <TableHead>Typ</TableHead>}
            {showOrderColumn && <TableHead>Order</TableHead>}
            <TableHead>Titel</TableHead>
            <TableHead>Källa</TableHead>
            <TableHead>Orderkoncept</TableHead>
            {showObjectColumn && <TableHead>Objekt</TableHead>}
            {showResourceColumn && <TableHead>Utförare</TableHead>}
            <TableHead>Status</TableHead>
            <TableHead>Datum</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key} data-testid={`row-${testidPrefix}-${row.key}`}>
              {showTypeColumn && (
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {orderTypeLabel(row.orderType) ?? "—"}
                </TableCell>
              )}
              {showOrderColumn && (
                <TableCell>
                  {row.orderId ? (
                    <Link
                      href={`/work-orders/${row.orderId}`}
                      className="text-primary hover:underline font-medium"
                      data-testid={`link-order-${row.orderId}`}
                    >
                      {row.orderNumber || "Öppna"}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              )}
              <TableCell className="max-w-[260px] truncate" title={row.title}>
                {row.orderId ? (
                  <Link
                    href={`/work-orders/${row.orderId}`}
                    className="hover:underline"
                    data-testid={`link-order-title-${row.orderId}`}
                  >
                    {row.title}
                  </Link>
                ) : (
                  row.title
                )}
              </TableCell>
              <TableCell>
                {/* Spårbarhet: snabborder/order öppnar ordern; koncept-födda
                    rader länkas via Orderkoncept-kolumnen intill. */}
                {row.orderId ? (
                  <Link href={`/work-orders/${row.orderId}`} data-testid={`link-source-${row.key}`}>
                    <Badge variant="outline" className="cursor-pointer hover-elevate">
                      {row.sourceLabel}
                    </Badge>
                  </Link>
                ) : (
                  <Badge variant="outline">{row.sourceLabel}</Badge>
                )}
              </TableCell>
              <TableCell>
                {row.orderConceptId ? (
                  <Link
                    href={`/order-concepts/${row.orderConceptId}/edit`}
                    className="text-primary hover:underline"
                    data-testid={`link-concept-${row.orderConceptId}`}
                  >
                    {row.orderConceptName || "Orderkoncept"}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              {showObjectColumn && (
                <TableCell className="max-w-[200px] truncate">
                  {row.objectId ? (
                    <Link
                      href={`/objects/${row.objectId}`}
                      className="text-primary hover:underline"
                      title={row.objectName ?? undefined}
                      data-testid={`link-object-${row.key}`}
                    >
                      {row.objectName || "Objekt"}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              )}
              {showResourceColumn && (
                <TableCell className="whitespace-nowrap text-xs" data-testid={`text-resource-${row.key}`}>
                  {row.resourceName || <span className="text-muted-foreground">—</span>}
                </TableCell>
              )}
              <TableCell>
                <Badge variant="secondary">{row.statusLabel}</Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {row.date ? row.date.toLocaleDateString("sv-SE") : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Bygger kontraktsstatus-rader ur work_orders. Delas av order- och uppgiftsvyerna. */
function useWoRows(workOrders: LinkedWorkOrder[]): LinkedRow[] {
  return useMemo<LinkedRow[]>(
    () =>
      sortNewestFirst(
        workOrders.map((wo) => {
          const status = deriveUppgiftStatus({
            orderStatus: (wo.orderStatus as OrderStatus | null) ?? null,
            executionStatus: (wo.executionStatus as ExecutionStatus | null) ?? null,
            invoiceQueueState: (wo.invoiceQueueState as InvoiceQueueState | null) ?? null,
            impossible: !!wo.impossibleReason,
          });
          return {
            key: `wo-${wo.id}`,
            orderNumber: wo.orderNumber ?? null,
            orderId: wo.id,
            title: wo.title || "(utan titel)",
            sourceType: wo.sourceType ?? null,
            sourceLabel: taskSourceLabel(wo.sourceType),
            orderType: wo.orderType ?? null,
            orderConceptId: wo.orderConceptId ?? null,
            orderConceptName: wo.orderConceptName ?? null,
            objectId: wo.objectId ?? null,
            objectName: wo.objectName ?? null,
            resourceName: wo.resourceName ?? null,
            status,
            statusLabel: UPPGIFT_STATUS_LABELS[status],
            date: toDate(wo.scheduledDate) ?? toDate(wo.createdAt),
          };
        }),
      ),
    [workOrders],
  );
}

/** Bygger kontraktsstatus-rader ur assignments (planeringslagret). */
function useAsgRows(assignments: LinkedAssignment[]): LinkedRow[] {
  return useMemo<LinkedRow[]>(
    () =>
      sortNewestFirst(
        assignments.map((a) => {
          const status = deriveUppgiftStatus({
            executionStatus: (a.status as ExecutionStatus | null) ?? null,
            materialized: false,
          });
          return {
            key: `asg-${a.id}`,
            orderNumber: null,
            orderId: null,
            title: a.title || "(utan titel)",
            sourceType: a.sourceType ?? null,
            sourceLabel: taskSourceLabel(a.sourceType),
            orderType: null,
            orderConceptId: a.orderConceptId ?? null,
            orderConceptName: a.orderConceptName ?? null,
            objectId: a.objectId ?? null,
            objectName: a.objectName ?? null,
            resourceName: a.resourceName ?? null,
            status,
            statusLabel: UPPGIFT_STATUS_LABELS[status],
            date: toDate(a.scheduledDate) ?? toDate(a.createdAt),
          };
        }),
      ),
    [assignments],
  );
}

/** Växeln "Endast detta objekt / Inkl. underordnade objekt". */
function SubtreeToggle({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={`switch-${id}`} />
      <Label htmlFor={id} className="text-xs text-muted-foreground cursor-pointer">
        Inkl. underordnade objekt
      </Label>
    </div>
  );
}

interface ObjectScopedProps {
  objectId: string;
}

export function ObjectLinkedOrdersTable({ objectId }: ObjectScopedProps) {
  const [includeSubtree, setIncludeSubtree] = useState(false);
  const { data } = useLinkedWork(objectId, includeSubtree);
  const woRows = useWoRows(data?.workOrders ?? []);

  const activeOrders = woRows.filter((r) => !HISTORY_STATUSES.has(r.status));
  const historyOrders = woRows.filter((r) => HISTORY_STATUSES.has(r.status));
  const showObjectColumn = includeSubtree;

  return (
    <div className="space-y-4">
      {/* ---------- Kopplade ordrar (work_orders) ---------- */}
      <Card data-testid="card-linked-orders">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              <ClipboardList className="h-4 w-4" /> Snabbordrar och ordrar
              {activeOrders.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">{activeOrders.length}</Badge>
              )}
            </CardTitle>
            <SubtreeToggle
              id="orders-subtree"
              checked={includeSubtree}
              onChange={setIncludeSubtree}
            />
          </div>
          {data?.truncated.workOrders && (
            <p className="text-xs text-muted-foreground">
              Listan är kapad — visar de senaste {data.workOrders.length} ordrarna.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {activeOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4" data-testid="empty-linked-orders">
              {includeSubtree
                ? "Inga aktiva snabbordrar eller ordrar i objektet eller dess underordnade objekt."
                : "Inga aktiva snabbordrar eller ordrar kopplade till objektet."}
            </p>
          ) : (
            <LinkedRowsTable
              rows={activeOrders}
              testidPrefix="linked-order"
              showOrderColumn
              showObjectColumn={showObjectColumn}
              showTypeColumn
            />
          )}
        </CardContent>
      </Card>

      {/* ---------- Orderhistorik (utförda/avslutade work_orders) ---------- */}
      <Card data-testid="card-order-history">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <HistoryIcon className="h-4 w-4" /> Orderhistorik
            {historyOrders.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{historyOrders.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4" data-testid="empty-order-history">
              Inga utförda eller avslutade ordrar ännu.
            </p>
          ) : (
            <LinkedRowsTable
              rows={historyOrders}
              testidPrefix="history-order"
              showOrderColumn
              showObjectColumn={showObjectColumn}
              showTypeColumn
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// UPPGIFTSNAV I MINIATYR (objektsidan, sista sektionen)
// ----------------------------------------------------------------------------
// Samlar ALLA uppgifter kopplade till objektet — och valfritt hela dess gren —
// (work_orders + assignments) i en sökbar lista med status-, typ- och
// tidsperiodfilter. Statusgrupperna mappar kontraktets deriveUppgiftStatus
// (enda status-mappningen — ingen egen logik):
//   Ej gjord  = skapad / i_masterplanering / planerad / omöjlig / avbruten
//   Pågående  = på väg / på plats
//   Gjord     = utförd / fakturakontroll / fakturerad
// ============================================================================

type TaskNavFilter = "alla" | "ej_gjord" | "pagaende" | "gjord";

const TASKNAV_GROUPS: Record<Exclude<TaskNavFilter, "alla">, Set<UppgiftStatus>> = {
  ej_gjord: new Set(["skapad", "i_masterplanering", "planerad", "omojlig_att_utfora", "avbruten"]),
  pagaende: new Set(["pa_vag", "pa_plats"]),
  gjord: new Set(["utford", "fakturakontroll", "fakturerad"]),
};

const TASKNAV_FILTER_LABELS: Record<TaskNavFilter, string> = {
  alla: "Alla",
  ej_gjord: "Ej gjord",
  pagaende: "Pågående",
  gjord: "Gjord",
};

// Tidsperiodfilter: relativa fönster bakåt + "Kommande" (datum i framtiden).
type PeriodFilter = "alla" | "kommande" | "30d" | "90d" | "365d";
const PERIOD_LABELS: Record<PeriodFilter, string> = {
  alla: "Alla perioder",
  kommande: "Kommande",
  "30d": "Senaste 30 dagarna",
  "90d": "Senaste 90 dagarna",
  "365d": "Senaste året",
};
const PERIOD_DAYS: Record<Exclude<PeriodFilter, "alla" | "kommande">, number> = {
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

function matchesPeriod(date: Date | null, period: PeriodFilter, now: Date): boolean {
  if (period === "alla") return true;
  if (!date) return false;
  if (period === "kommande") return date.getTime() >= now.getTime();
  const from = now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000;
  return date.getTime() >= from && date.getTime() <= now.getTime();
}

const ALL = "all";

export function ObjectTasksNav({ objectId }: ObjectScopedProps) {
  const [includeSubtree, setIncludeSubtree] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TaskNavFilter>("alla");
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("alla");

  const { data } = useLinkedWork(objectId, includeSubtree);
  const woRows = useWoRows(data?.workOrders ?? []);
  const asgRows = useAsgRows(data?.assignments ?? []);
  const allRows = useMemo(() => sortNewestFirst([...woRows, ...asgRows]), [woRows, asgRows]);

  // Typalternativ härleds ur faktiskt närvarande rader (aldrig hårdkodade).
  const typeOptions = useMemo(() => {
    const types = new Map<string, string>();
    for (const r of allRows) {
      if (r.orderType) types.set(r.orderType, orderTypeLabel(r.orderType) ?? r.orderType);
    }
    return Array.from(types.entries()).sort((a, b) => a[1].localeCompare(b[1], "sv"));
  }, [allRows]);

  const counts = useMemo(() => {
    const c: Record<TaskNavFilter, number> = { alla: allRows.length, ej_gjord: 0, pagaende: 0, gjord: 0 };
    for (const r of allRows) {
      for (const key of ["ej_gjord", "pagaende", "gjord"] as const) {
        if (TASKNAV_GROUPS[key].has(r.status)) c[key]++;
      }
    }
    return c;
  }, [allRows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = new Date();
    return allRows.filter((r) => {
      if (filter !== "alla" && !TASKNAV_GROUPS[filter].has(r.status)) return false;
      if (typeFilter !== ALL && (r.orderType ?? "") !== typeFilter) return false;
      if (!matchesPeriod(r.date, periodFilter, now)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.orderNumber ?? "").toLowerCase().includes(q) ||
        (r.orderConceptName ?? "").toLowerCase().includes(q) ||
        (r.objectName ?? "").toLowerCase().includes(q) ||
        r.statusLabel.toLowerCase().includes(q) ||
        r.sourceLabel.toLowerCase().includes(q)
      );
    });
  }, [allRows, filter, typeFilter, periodFilter, search]);

  const truncated = !!data && (data.truncated.workOrders || data.truncated.assignments);

  return (
    <Card data-testid="card-object-tasks-nav">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListChecks className="h-4 w-4" /> Kopplade uppgifter
            {allRows.length > 0 && (
              <Badge variant="secondary" className="text-[10px]" data-testid="badge-tasks-nav-count">
                {allRows.length}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Task #1533: öppna hela Uppgiftsnavet förfiltrerat på objektet
                (grid-endpointens ?objectId= = rotobjekt + hela subträdet). */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              asChild
              data-testid="button-open-tasks-nav"
            >
              <Link href={`/grovplanering?objectId=${objectId}`}>
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Öppna i Uppgiftsnavet
              </Link>
            </Button>
            <SubtreeToggle
              id="tasks-nav-subtree"
              checked={includeSubtree}
              onChange={setIncludeSubtree}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {includeSubtree
            ? "Alla uppgifter i objektet och dess underordnade objekt — sök och filtrera."
            : "Alla uppgifter kopplade till objektet — sök och filtrera."}
          {truncated && " Listan är kapad till de senaste raderna."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök uppgift, order, orderkoncept, objekt…"
              className="h-8 pl-8 text-sm"
              data-testid="input-tasks-nav-search"
            />
          </div>
          <div className="flex items-center gap-1">
            {(Object.keys(TASKNAV_FILTER_LABELS) as TaskNavFilter[]).map((key) => (
              <Button
                key={key}
                variant={filter === key ? "default" : "outline"}
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={() => setFilter(key)}
                data-testid={`button-tasks-nav-filter-${key}`}
              >
                {TASKNAV_FILTER_LABELS[key]}
                <span className="ml-1 opacity-70">({counts[key]})</span>
              </Button>
            ))}
          </div>
          {typeOptions.length > 0 && (
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-[160px] text-xs" data-testid="select-tasks-nav-type">
                <SelectValue placeholder="Uppgiftstyp" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Alla uppgiftstyper</SelectItem>
                {typeOptions.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={periodFilter} onValueChange={(v) => setPeriodFilter(v as PeriodFilter)}>
            <SelectTrigger className="h-8 w-[170px] text-xs" data-testid="select-tasks-nav-period">
              <SelectValue placeholder="Tidsperiod" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABELS) as PeriodFilter[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PERIOD_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4" data-testid="empty-tasks-nav">
            {allRows.length === 0
              ? "Inga uppgifter kopplade till objektet ännu."
              : "Inga uppgifter matchar sökningen/filtret."}
          </p>
        ) : (
          <LinkedRowsTable
            rows={visible}
            testidPrefix="tasks-nav"
            showOrderColumn
            showObjectColumn={includeSubtree}
            showTypeColumn
            showResourceColumn
          />
        )}
      </CardContent>
    </Card>
  );
}
