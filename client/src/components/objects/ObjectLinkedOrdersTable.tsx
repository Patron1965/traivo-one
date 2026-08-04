import { useMemo } from "react";
import { Link } from "wouter";
import { ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
} from "@shared/uppgift-contract";
import type { ExecutionStatus, OrderStatus } from "@shared/schema";

// Task #1370 (krav 11): "Kopplade order och uppgifter" — sammanställning av
// objektets order (work_orders) och planeringsuppgifter (assignments) med
// källa (Task #1369-ursprung), orderkoncept, status och datum. Status härleds
// ENBART via deriveUppgiftStatus (kontraktets enda mappning) — ingen egen logik.

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
}

interface LinkedRow {
  key: string;
  kind: "order" | "uppgift";
  /** Ordernummer (WO) — klickbar till detaljvyn. Assignments saknar detaljvy. */
  orderNumber: string | null;
  orderId: string | null;
  title: string;
  sourceLabel: string;
  orderConceptId: string | null;
  orderConceptName: string | null;
  statusLabel: string;
  date: Date | null;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ObjectLinkedOrdersTable({ workOrders, assignments }: Props) {
  const rows = useMemo<LinkedRow[]>(() => {
    const woRows: LinkedRow[] = workOrders.map((wo) => ({
      key: `wo-${wo.id}`,
      kind: "order",
      orderNumber: wo.orderNumber ?? null,
      orderId: wo.id,
      title: wo.title || "(utan titel)",
      sourceLabel: taskSourceLabel(wo.sourceType),
      orderConceptId: wo.orderConceptId ?? null,
      orderConceptName: wo.orderConceptName ?? null,
      statusLabel:
        UPPGIFT_STATUS_LABELS[
          deriveUppgiftStatus({
            orderStatus: (wo.orderStatus as OrderStatus | null) ?? null,
            executionStatus: (wo.executionStatus as ExecutionStatus | null) ?? null,
            invoiceQueueState: (wo.invoiceQueueState as InvoiceQueueState | null) ?? null,
            impossible: !!wo.impossibleReason,
          })
        ],
      date: toDate(wo.scheduledDate) ?? toDate(wo.createdAt),
    }));
    const asgRows: LinkedRow[] = assignments.map((a) => ({
      key: `asg-${a.id}`,
      kind: "uppgift",
      orderNumber: null,
      orderId: null,
      title: a.title || "(utan titel)",
      sourceLabel: taskSourceLabel(a.sourceType),
      orderConceptId: a.orderConceptId ?? null,
      orderConceptName: a.orderConceptName ?? null,
      statusLabel:
        UPPGIFT_STATUS_LABELS[
          deriveUppgiftStatus({
            executionStatus: (a.status as ExecutionStatus | null) ?? null,
            materialized: false,
          })
        ],
      date: toDate(a.scheduledDate) ?? toDate(a.createdAt),
    }));
    // Nyaste först; rader utan datum sist.
    return [...woRows, ...asgRows].sort((x, y) => {
      const xt = x.date?.getTime() ?? -Infinity;
      const yt = y.date?.getTime() ?? -Infinity;
      return yt - xt;
    });
  }, [workOrders, assignments]);

  return (
    <Card data-testid="card-linked-orders">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ClipboardList className="h-4 w-4" /> Kopplade order och uppgifter
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4" data-testid="empty-linked-orders">
            Inga order eller uppgifter kopplade till objektet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Uppgift</TableHead>
                  <TableHead>Källa</TableHead>
                  <TableHead>Orderkoncept</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Datum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key} data-testid={`row-linked-${row.key}`}>
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
                    <TableCell className="max-w-[260px] truncate" title={row.title}>
                      {row.title}
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
        )}
      </CardContent>
    </Card>
  );
}
