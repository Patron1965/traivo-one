import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ClipboardList, Target, Calendar, CalendarClock, CircleSlash, Loader2,
  Link as LinkIcon, Users,
} from "lucide-react";
import { KallaBadge } from "@/lib/metadata-kalla";
import { getWorkOrderStatusBadge } from "@/lib/status-colors";

// Task #1160: Dedikerade kort för KOPPLADE UPPGIFTER och KOPPLADE ORDERKONCEPT
// på objektsidan. Läser samma /api/objects/:id/system-generated-metadata som
// ObjectSystemGeneratedPanel och återanvänder grovplaneringens status-badge-
// härledning (getWorkOrderStatusBadge) så uppgiftsvisningen är enhetlig.

interface PointedInConcept {
  id: string;
  name: string;
  status: string | null;
  invoiceModel: string | null;
  customerId: string | null;
  customerName: string | null;
}
interface SystemTaskHistory {
  id: string;
  title: string | null;
  status: string | null;
  orderStatus: string | null;
  scheduledDate: string | null;
  lineCount: number;
}
interface SystemTaskFuture {
  id: string;
  title: string | null;
  status: string | null;
  priority: string | null;
  scheduledDate: string | null;
  quantity: number | null;
  orderConceptId: string | null;
  orderConceptName: string | null;
  customerId: string | null;
  customerName: string | null;
  matchReason: string | null;
}
interface SystemUnperformedTask {
  id: string;
  title: string | null;
  reasonCode: string | null;
  reason: string | null;
  reasonText: string | null;
  impossibleAt: string | null;
  executionCode: string | null;
}
interface SystemGeneratedMetadata {
  pointedInConcepts: PointedInConcept[];
  tasksHistory: SystemTaskHistory[];
  tasksFuture: SystemTaskFuture[];
  unperformedTasks: SystemUnperformedTask[];
}

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("sv-SE") : null;

export function ObjectLinkedTasksCards({
  objectId,
  navigate,
}: {
  objectId: string;
  navigate: (path: string) => void;
}) {
  const { data, isLoading } = useQuery<SystemGeneratedMetadata>({
    queryKey: ["/api/objects", objectId, "system-generated-metadata"],
    enabled: !!objectId,
  });

  const concepts = data?.pointedInConcepts ?? [];
  const history = data?.tasksHistory ?? [];
  const future = data?.tasksFuture ?? [];
  const unperformed = data?.unperformedTasks ?? [];
  const taskCount = history.length + future.length + unperformed.length;

  return (
    <div className="space-y-4">
      {/* ==================== KOPPLADE UPPGIFTER ==================== */}
      <Card data-testid="card-linked-tasks">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> Kopplade uppgifter
            <KallaBadge kalla="SYS" />
            {taskCount > 0 && (
              <Badge variant="secondary" className="text-xs" data-testid="badge-linked-tasks-count">
                {taskCount}
              </Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Uppgifter kopplade till detta objekt — kommande (planeringslager), historik samt ej-utförda.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Laddar uppgifter…
            </div>
          ) : taskCount === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="empty-linked-tasks">
              Inga uppgifter kopplade till detta objekt ännu.
            </p>
          ) : (
            <>
              {future.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5" /> Kommande ({future.length})
                  </h4>
                  <div className="space-y-2">
                    {future.map((a) => (
                      <div
                        key={a.id}
                        className="rounded-lg border border-border p-3"
                        data-testid={`linked-task-future-${a.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{a.title || "Uppgift"}</div>
                            <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                              {fmtDate(a.scheduledDate) && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />{fmtDate(a.scheduledDate)}
                                </span>
                              )}
                              {typeof a.quantity === "number" && a.quantity > 0 && <span>{a.quantity} st</span>}
                            </div>
                            {a.orderConceptId && (
                              <div
                                className="mt-1 text-xs text-muted-foreground"
                                data-testid={`text-linked-task-match-reason-${a.id}`}
                              >
                                <span className="font-medium">Matchningsorsak:</span>{" "}
                                {a.matchReason || "—"}
                              </div>
                            )}
                          </div>
                          {a.status && (
                            <Badge className={`text-[10px] shrink-0 ${getWorkOrderStatusBadge(a.status)}`}>
                              {a.status}
                            </Badge>
                          )}
                        </div>
                        {(a.orderConceptId || a.customerId) && (
                          <div className="mt-2 flex items-center gap-2 flex-wrap">
                            {a.orderConceptId && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => navigate(`/order-concepts/${a.orderConceptId}/edit`)}
                                data-testid={`link-linked-task-concept-${a.id}`}
                              >
                                <LinkIcon className="h-3 w-3 mr-1" />
                                {a.orderConceptName || "Orderkoncept"}
                              </Button>
                            )}
                            {a.customerId && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => navigate(`/customers/${a.customerId}`)}
                                data-testid={`link-linked-task-customer-${a.id}`}
                              >
                                <Users className="h-3 w-3 mr-1" />
                                {a.customerName || "Kund"}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {history.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <ClipboardList className="h-3.5 w-3.5" /> Historik ({history.length})
                  </h4>
                  <div className="space-y-2">
                    {history.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => navigate(`/work-orders/${o.id}`)}
                        className="w-full text-left rounded-lg border border-border p-3 hover:bg-accent transition-colors"
                        data-testid={`linked-task-history-${o.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{o.title || "Uppgift"}</div>
                            <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                              {fmtDate(o.scheduledDate) && <span>{fmtDate(o.scheduledDate)}</span>}
                              {o.lineCount > 0 && <span>{o.lineCount} rader</span>}
                            </div>
                          </div>
                          {o.orderStatus && (
                            <Badge className={`text-[10px] shrink-0 ${getWorkOrderStatusBadge(o.orderStatus)}`}>
                              {o.orderStatus}
                            </Badge>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {unperformed.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-destructive flex items-center gap-1.5">
                    <CircleSlash className="h-3.5 w-3.5" /> Ej-utförda ({unperformed.length})
                  </h4>
                  <div className="space-y-2">
                    {unperformed.map((u) => (
                      <div
                        key={u.id}
                        className="rounded-lg border border-destructive/30 p-3"
                        data-testid={`linked-task-unperformed-${u.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{u.title || "Uppgift"}</div>
                            {u.reasonText && (
                              <div className="text-xs text-muted-foreground truncate">{u.reasonText}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                            {u.reason && <Badge variant="destructive" className="text-[10px]">{u.reason}</Badge>}
                            {fmtDate(u.impossibleAt) && <span className="text-xs">{fmtDate(u.impossibleAt)}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ==================== KOPPLADE ORDERKONCEPT ==================== */}
      <Card data-testid="card-linked-concepts">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" /> Kopplade orderkoncept
            <KallaBadge kalla="SYS" />
            {concepts.length > 0 && (
              <Badge variant="secondary" className="text-xs" data-testid="badge-linked-concepts-count">
                {concepts.length}
              </Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Orderkoncept som pekar in på detta objekt (via inpekning eller underträd).
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Laddar orderkoncept…
            </div>
          ) : concepts.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="empty-linked-concepts">
              Inga orderkoncept pekar in på detta objekt.
            </p>
          ) : (
            <div className="space-y-2">
              {concepts.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-border p-3"
                  data-testid={`linked-concept-${c.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{c.name}</div>
                      {c.customerName && (
                        <div className="text-xs text-muted-foreground truncate">{c.customerName}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.invoiceModel && <Badge variant="outline" className="text-[10px]">{c.invoiceModel}</Badge>}
                      {c.status && <Badge variant="secondary" className="text-[10px]">{c.status}</Badge>}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => navigate(`/order-concepts/${c.id}/edit`)}
                      data-testid={`link-linked-concept-open-${c.id}`}
                    >
                      <LinkIcon className="h-3 w-3 mr-1" /> Öppna orderkoncept
                    </Button>
                    {c.customerId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => navigate(`/customers/${c.customerId}`)}
                        data-testid={`link-linked-concept-customer-${c.id}`}
                      >
                        <Users className="h-3 w-3 mr-1" />
                        {c.customerName || "Kund"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
