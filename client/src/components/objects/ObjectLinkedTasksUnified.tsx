import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ClipboardList, Zap, Link as LinkIcon, Loader2, Cog, Calendar, ChevronDown, ChevronUp, Users,
} from "lucide-react";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Produktägarbeslut 2026-08-10 (Objekt-360, sektion 4 i skissen):
// orderkoncept-uppgifter, snabbordrar och andra uppgiftskällor redovisas i
// EN gemensam lista ("Kopplade uppgifter") där varje rad visar och länkar
// till sin källa — inte i separata kort per källtyp.

interface AssignmentRow {
  id: string;
  title?: string | null;
  scheduledDate?: string | null;
  quantity?: number | null;
  orderConceptId?: string | null;
  orderConceptName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
}

interface SystemOrderRow {
  id: string;
  title: string | null;
  status: string | null;
  orderStatus: string | null;
  scheduledDate: string | null;
  lineCount: number;
  orderNumber: string | null;
  orderConceptId: string | null;
  sourceAssignmentId?: string | null;
}

interface SystemMetaResponse {
  tasksHistory: SystemOrderRow[];
}

type Kalla = "orderkoncept" | "snabborder" | "order" | "manuell";

interface UnifiedRow {
  key: string;
  title: string;
  scheduledDate: string | null;
  /** Sekundär info-rad (ordernummer, antal, rader …) */
  meta: string[];
  statusLabel: string | null;
  kalla: Kalla;
  kallaLabel: string;
  /** Primär källänk. */
  linkPath: string | null;
  linkLabel: string | null;
  /** Ev. sekundär länk (kund / öppna order). */
  secondaryPath: string | null;
  secondaryLabel: string | null;
  secondaryIcon: "users" | "order" | null;
}

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("sv-SE") : null;

const ORDER_STATUS_LABELS: Record<string, string> = {
  skapad: "Skapad",
  grovplanerad: "Grovplanerad",
  planerad: "Planerad",
  pagaende: "Pågående",
  utford: "Utförd",
  fakturerad: "Fakturerad",
  installd: "Inställd",
};

function kallaIcon(kalla: Kalla) {
  switch (kalla) {
    case "orderkoncept": return <LinkIcon className="h-3 w-3" />;
    case "snabborder": return <Zap className="h-3 w-3" />;
    case "order": return <ClipboardList className="h-3 w-3" />;
    default: return <Cog className="h-3 w-3" />;
  }
}

export function ObjectLinkedTasksUnified({
  objectId,
  assignments,
  navigate,
}: {
  objectId: string;
  assignments: AssignmentRow[];
  navigate: (path: string) => void;
}) {
  const { data, isLoading } = useQuery<SystemMetaResponse>({
    queryKey: ["/api/objects", objectId, "system-generated-metadata"],
  });
  // Task #1533 (mockup-gap 6): enhetlig tabell med kapad lista + "Visa alla (N)".
  const [showAll, setShowAll] = useState(false);
  const ROW_CAP = 8;

  const orders = data?.tasksHistory ?? [];

  // En logisk uppgift = EN rad: en assignment som materialiserats till en
  // order (wo.sourceAssignmentId) visas bara som ordern — aldrig dubbelt.
  const materializedAssignmentIds = new Set(
    orders.map((o) => o.sourceAssignmentId).filter((x): x is string => !!x),
  );

  const rows: UnifiedRow[] = [
    // Planerade uppgifter från orderkoncept (assignments — ej materialiserade).
    ...assignments.filter((a) => !materializedAssignmentIds.has(a.id)).map((a): UnifiedRow => ({
      key: `assignment-${a.id}`,
      title: a.title || "Uppgift",
      scheduledDate: a.scheduledDate ?? null,
      meta: typeof a.quantity === "number" && a.quantity > 0 ? [`${a.quantity} st`] : [],
      statusLabel: "Planerad",
      kalla: "orderkoncept",
      kallaLabel: a.orderConceptName || "Orderkoncept",
      linkPath: a.orderConceptId ? `/order-concepts/${a.orderConceptId}/edit` : null,
      linkLabel: a.orderConceptName || "Orderkoncept",
      secondaryPath: a.customerId ? `/customers/${a.customerId}` : null,
      secondaryLabel: a.customerName || "Kund",
      secondaryIcon: "users",
    })),
    // Ordrar/work orders som fötts för objektet (koncept, snabborder, manuellt).
    ...orders.map((row): UnifiedRow => {
      const kalla: Kalla = row.orderConceptId
        ? "orderkoncept"
        : row.orderNumber?.startsWith("SO-")
          ? "snabborder"
          : "order";
      return {
        key: `wo-${row.id}`,
        title: row.title || row.orderNumber || "Order",
        scheduledDate: row.scheduledDate,
        meta: [
          ...(row.orderNumber ? [row.orderNumber] : []),
          ...(row.lineCount > 0 ? [`${row.lineCount} rader`] : []),
        ],
        statusLabel: row.orderStatus ? (ORDER_STATUS_LABELS[row.orderStatus] ?? row.orderStatus) : null,
        kalla,
        // Produktägarbeslut: uppgifter skapas via orderkoncept, snabborder
        // eller uppgiftskaparen — ingen egen "system"-kategori.
        kallaLabel:
          kalla === "orderkoncept" ? "Orderkoncept" : kalla === "snabborder" ? "Snabborder" : "Uppgiftskaparen",
        linkPath: row.orderConceptId
          ? `/order-concepts/${row.orderConceptId}/edit`
          : `/work-orders/${row.id}`,
        linkLabel: row.orderConceptId
          ? "Öppna orderkoncept"
          : kalla === "snabborder"
            ? `Öppna snabborder${row.orderNumber ? ` ${row.orderNumber}` : ""}`
            : "Öppna order",
        secondaryPath: row.orderConceptId ? `/work-orders/${row.id}` : null,
        secondaryLabel: row.orderConceptId ? "Öppna order" : null,
        secondaryIcon: row.orderConceptId ? "order" : null,
      };
    }),
  ].sort((a, b) => {
    // Senast planerade först; rader utan datum sist.
    const ad = a.scheduledDate ? new Date(a.scheduledDate).getTime() : -Infinity;
    const bd = b.scheduledDate ? new Date(b.scheduledDate).getTime() : -Infinity;
    return bd - ad;
  });

  return (
    <Card data-testid="card-linked-tasks">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardList className="h-4 w-4" /> Kopplade uppgifter
          {rows.length > 0 && (
            <Badge variant="secondary" className="text-xs" data-testid="badge-linked-tasks-count">
              {rows.length}
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Alla uppgifter och ordrar för detta objekt — oavsett källa. Varje rad
          länkar till sitt ursprung (orderkoncept, snabborder eller order).
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Laddar uppgifter…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="empty-linked-tasks">
            Inga kopplade uppgifter för detta objekt ännu.
          </p>
        ) : (
          <div className="space-y-2">
            {/* Task #1533 (mockup-gap 6): enhetlig tabell — alla källor
                (orderkoncept/snabborder/order) i samma kolumnuppsättning. */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Uppgift</TableHead>
                    <TableHead>Datum</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Källa</TableHead>
                    <TableHead className="text-right">Åtgärd</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(showAll ? rows : rows.slice(0, ROW_CAP)).map((row) => (
                    <TableRow key={row.key} data-testid={`linked-task-row-${row.key}`}>
                      <TableCell className="max-w-[240px]">
                        <div className="text-sm font-medium truncate" data-testid={`text-linked-task-title-${row.key}`}>
                          {row.title}
                        </div>
                        {row.meta.length > 0 && (
                          <div className="text-xs text-muted-foreground truncate">
                            {row.meta.join(" · ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {row.scheduledDate ? (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {fmtDate(row.scheduledDate)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.statusLabel ? (
                          <Badge variant="secondary" className="text-[10px]">{row.statusLabel}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="text-[10px] inline-flex items-center gap-1"
                          data-testid={`badge-kalla-${row.key}`}
                        >
                          {kallaIcon(row.kalla)}
                          {row.kallaLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {row.linkPath && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => navigate(row.linkPath!)}
                            data-testid={`link-source-${row.key}`}
                          >
                            {kallaIcon(row.kalla)}
                            <span className="ml-1">{row.linkLabel}</span>
                          </Button>
                        )}
                        {row.secondaryPath && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs ml-1"
                            onClick={() => navigate(row.secondaryPath!)}
                            data-testid={`link-secondary-${row.key}`}
                          >
                            {row.secondaryIcon === "users" && <Users className="h-3 w-3 mr-1" />}
                            {row.secondaryLabel}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {rows.length > ROW_CAP && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAll((v) => !v)}
                data-testid="button-linked-tasks-show-all"
              >
                {showAll ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5 mr-1.5" /> Visa färre
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5 mr-1.5" /> Visa alla ({rows.length})
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
