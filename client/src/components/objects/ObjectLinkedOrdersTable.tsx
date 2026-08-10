import { useMemo, useState } from "react";
import { Link } from "wouter";
// OBS: lucide `History` aliasas — oaliasad import skuggar globala inbyggda (lint:icon-shadowing).
import { ClipboardList, History as HistoryIcon, ListChecks, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
// och redovisas i SEPARATA sektioner (tidigare en kombinerad tabell, Task #1370).
// Inom varje sektion skiljs aktiva/kommande rader från historik (utförda m.fl.)
// via deriveUppgiftStatus (kontraktets enda mappning) — ingen egen statuslogik.

interface LinkedWorkOrder {
  id: string;
  orderNumber?: string | null;
  title?: string | null;
  sourceType?: string | null;
  orderConceptId?: string | null;
  orderConceptName?: string | null;
  orderStatus?: string | null;
  executionStatus?: string | null;
  invoiceQueueState?: string | null;
  impossibleReason?: string | null;
  scheduledDate?: string | Date | null;
  createdAt?: string | Date | null;
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
}

interface Props {
  workOrders: LinkedWorkOrder[];
  assignments: LinkedAssignment[];
  /** true = rendera ENBART order-sektionerna (uppgifterna visas separat i ObjectTasksNav). */
  ordersOnly?: boolean;
}

interface LinkedRow {
  key: string;
  /** Ordernummer (WO) — klickbar till detaljvyn. Assignments saknar detaljvy. */
  orderNumber: string | null;
  orderId: string | null;
  title: string;
  sourceLabel: string;
  orderConceptId: string | null;
  orderConceptName: string | null;
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
}: {
  rows: LinkedRow[];
  testidPrefix: string;
  showOrderColumn: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {showOrderColumn && <TableHead>Order</TableHead>}
            <TableHead>Titel</TableHead>
            <TableHead>Källa</TableHead>
            <TableHead>Orderkoncept</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Datum</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key} data-testid={`row-${testidPrefix}-${row.key}`}>
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
                <Badge variant="outline">{row.sourceLabel}</Badge>
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
            sourceLabel: taskSourceLabel(wo.sourceType),
            orderConceptId: wo.orderConceptId ?? null,
            orderConceptName: wo.orderConceptName ?? null,
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
            sourceLabel: taskSourceLabel(a.sourceType),
            orderConceptId: a.orderConceptId ?? null,
            orderConceptName: a.orderConceptName ?? null,
            status,
            statusLabel: UPPGIFT_STATUS_LABELS[status],
            date: toDate(a.scheduledDate) ?? toDate(a.createdAt),
          };
        }),
      ),
    [assignments],
  );
}

export function ObjectLinkedOrdersTable({ workOrders, assignments, ordersOnly = false }: Props) {
  const woRows = useWoRows(workOrders);
  const asgRows = useAsgRows(assignments);

  const activeOrders = woRows.filter((r) => !HISTORY_STATUSES.has(r.status));
  const historyOrders = woRows.filter((r) => HISTORY_STATUSES.has(r.status));
  const activeTasks = asgRows.filter((r) => !HISTORY_STATUSES.has(r.status));
  const historyTasks = asgRows.filter((r) => HISTORY_STATUSES.has(r.status));

  return (
    <div className="space-y-4">
      {/* ---------- Kopplade ordrar (work_orders) ---------- */}
      <Card data-testid="card-linked-orders">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Kopplade ordrar
            {activeOrders.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{activeOrders.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4" data-testid="empty-linked-orders">
              Inga aktiva ordrar kopplade till objektet.
            </p>
          ) : (
            <LinkedRowsTable rows={activeOrders} testidPrefix="linked-order" showOrderColumn />
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
            <LinkedRowsTable rows={historyOrders} testidPrefix="history-order" showOrderColumn />
          )}
        </CardContent>
      </Card>

      {/* ---------- Kopplade uppgifter (assignments, planeringslager) ---------- */}
      {!ordersOnly && (
      <Card data-testid="card-linked-assignments">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListChecks className="h-4 w-4" /> Kopplade uppgifter
            {activeTasks.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{activeTasks.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4" data-testid="empty-linked-assignments">
              Inga aktiva eller kommande uppgifter kopplade till objektet.
            </p>
          ) : (
            <LinkedRowsTable rows={activeTasks} testidPrefix="linked-task" showOrderColumn={false} />
          )}

          <div className="space-y-2" data-testid="section-task-history">
            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <HistoryIcon className="h-3.5 w-3.5" /> Historik (utförda/avslutade uppgifter)
            </div>
            {historyTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2" data-testid="empty-task-history">
                Inga utförda eller avslutade uppgifter ännu.
              </p>
            ) : (
              <LinkedRowsTable rows={historyTasks} testidPrefix="history-task" showOrderColumn={false} />
            )}
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}

// ============================================================================
// UPPGIFTSNAV I MINIATYR (objektsidan, sista sektionen)
// ----------------------------------------------------------------------------
// Samlar ALLA uppgifter kopplade till objektet (work_orders + assignments) i en
// sökbar, statusfiltrerad lista. Statusgrupperna mappar kontraktets
// deriveUppgiftStatus (enda status-mappningen — ingen egen logik):
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

export function ObjectTasksNav({ workOrders, assignments }: Omit<Props, "ordersOnly">) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TaskNavFilter>("alla");

  const woRows = useWoRows(workOrders);
  const asgRows = useAsgRows(assignments);
  const allRows = useMemo(() => sortNewestFirst([...woRows, ...asgRows]), [woRows, asgRows]);

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
    return allRows.filter((r) => {
      if (filter !== "alla" && !TASKNAV_GROUPS[filter].has(r.status)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.orderNumber ?? "").toLowerCase().includes(q) ||
        (r.orderConceptName ?? "").toLowerCase().includes(q) ||
        r.statusLabel.toLowerCase().includes(q) ||
        r.sourceLabel.toLowerCase().includes(q)
      );
    });
  }, [allRows, filter, search]);

  return (
    <Card data-testid="card-object-tasks-nav">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListChecks className="h-4 w-4" /> Kopplade uppgifter
          {allRows.length > 0 && (
            <Badge variant="secondary" className="text-[10px]" data-testid="badge-tasks-nav-count">
              {allRows.length}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Alla uppgifter kopplade till objektet — sök och filtrera på status.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök uppgift, order, orderkoncept…"
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
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4" data-testid="empty-tasks-nav">
            {allRows.length === 0
              ? "Inga uppgifter kopplade till objektet ännu."
              : "Inga uppgifter matchar sökningen/filtret."}
          </p>
        ) : (
          <LinkedRowsTable rows={visible} testidPrefix="tasks-nav" showOrderColumn />
        )}
      </CardContent>
    </Card>
  );
}
