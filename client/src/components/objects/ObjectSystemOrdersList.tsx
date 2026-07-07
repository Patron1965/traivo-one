import { useQuery } from "@tanstack/react-query";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown, ClipboardList, Zap, Link as LinkIcon, Loader2, Cog,
} from "lucide-react";
import { KallaBadge } from "@/lib/metadata-kalla";

// C4: Systemkopplade ordrar ("född ur"). Läser samma system-generated-metadata
// endpoint som ObjectSystemGeneratedPanel; tasksHistory bär nu orderNumber +
// orderConceptId så varje rad kan djuplänka till sitt ursprung.
interface SystemOrderRow {
  id: string;
  title: string | null;
  status: string | null;
  orderStatus: string | null;
  scheduledDate: string | null;
  lineCount: number;
  orderNumber: string | null;
  orderConceptId: string | null;
}
interface SystemMetaResponse {
  tasksHistory: SystemOrderRow[];
}

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("sv-SE") : null;

/** Härleder ursprung ("född ur") för en order. */
function bornFromLabel(row: SystemOrderRow): { text: string; kind: "snabborder" | "koncept" | "manuell" } {
  if (row.orderConceptId) return { text: "Orderkoncept", kind: "koncept" };
  if (row.orderNumber?.startsWith("SO-")) return { text: "Snabborder", kind: "snabborder" };
  return { text: "Manuellt skapad", kind: "manuell" };
}

export function ObjectSystemOrdersList({
  objectId,
  navigate,
}: {
  objectId: string;
  navigate: (path: string) => void;
}) {
  const { data, isLoading } = useQuery<SystemMetaResponse>({
    queryKey: ["/api/objects", objectId, "system-generated-metadata"],
  });

  const orders = data?.tasksHistory ?? [];

  return (
    <Card data-testid="card-system-orders">
      <Collapsible defaultOpen={false}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 group"
              data-testid="button-toggle-system-orders"
            >
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="h-4 w-4" /> Systemkopplade ordrar
                <KallaBadge kalla="SYS" />
                {orders.length > 0 && (
                  <Badge variant="secondary" className="text-xs" data-testid="badge-system-orders-count">
                    {orders.length}
                  </Badge>
                )}
              </CardTitle>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </CollapsibleTrigger>
          <p className="text-xs text-muted-foreground">
            Historiska ordrar som genererats för detta objekt. Varje rad visar vad
            den föddes ur och länkar till ursprunget.
          </p>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Laddar ordrar…
              </div>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="empty-system-orders">
                Inga systemkopplade ordrar för detta objekt ännu.
              </p>
            ) : (
              <div className="space-y-2">
                {orders.map((row) => {
                  const born = bornFromLabel(row);
                  const date = fmtDate(row.scheduledDate);
                  return (
                    <div
                      key={row.id}
                      className="rounded-lg border border-border p-3"
                      data-testid={`system-order-row-${row.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate" data-testid={`text-system-order-title-${row.id}`}>
                            {row.title || row.orderNumber || "Order"}
                          </div>
                          <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                            {row.orderNumber && <span>{row.orderNumber}</span>}
                            {date && <span>{date}</span>}
                            {row.lineCount > 0 && <span>{row.lineCount} rader</span>}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[10px] inline-flex items-center gap-1 shrink-0"
                          data-testid={`badge-born-from-${row.id}`}
                        >
                          {born.kind === "koncept" ? (
                            <LinkIcon className="h-3 w-3" />
                          ) : born.kind === "snabborder" ? (
                            <Zap className="h-3 w-3" />
                          ) : (
                            <Cog className="h-3 w-3" />
                          )}
                          Född ur: {born.text}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {row.orderConceptId && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => navigate(`/order-concepts/${row.orderConceptId}/edit`)}
                            data-testid={`link-system-order-concept-${row.id}`}
                          >
                            <LinkIcon className="h-3 w-3 mr-1" /> Öppna orderkoncept
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => navigate(`/work-orders/${row.id}`)}
                          data-testid={`link-system-order-wo-${row.id}`}
                        >
                          Öppna order
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
