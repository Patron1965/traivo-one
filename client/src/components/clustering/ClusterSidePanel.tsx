import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Lock,
  LockOpen,
  CheckCircle2,
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
  Clock,
  MapPin,
  Pencil,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ============================================================================
// Typer
// ============================================================================

interface ClusterTask {
  id: string;
  orderNumber: string | null;
  title: string | null;
  orderStatus: string;
  executionCode: string | null;
  estimatedDuration: number | null;
  scheduledDate: string | null;
}

interface StopClusterDetail {
  id: string;
  displayName: string;
  status: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  executionCode: string | null;
  calculatedDurationMinutes: number | null;
  memberCount: number;
  tasks: ClusterTask[];
}

interface RouteClusterDetail {
  id: string;
  displayName: string;
  status: string;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusKilometers: number | null;
  executionCode: string | null;
  calculatedWorkMinutes: number | null;
  calculatedTravelMinutes: number | null;
  precisionLevel: string | null;
  period: string | null;
  taskCount: number;
  tasks: ClusterTask[];
}

// ============================================================================
// Hjälpfunktioner
// ============================================================================

function formatMinutes(min: number | null | undefined): string {
  if (min == null) return "–";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const STATUS_META: Record<string, { label: string; variant: "default" | "outline" | "secondary" }> = {
  active: { label: "Aktiv", variant: "secondary" },
  auto: { label: "Auto", variant: "secondary" },
  confirmed: { label: "Bekräftad", variant: "default" },
  locked: { label: "Låst", variant: "outline" },
  dissolved: { label: "Upplöst", variant: "outline" },
};

const PRECISION_LABEL: Record<string, string> = {
  high: "Hög",
  medium: "Medel",
  low: "Låg",
};

// ============================================================================
// StopClusterPanel
// ============================================================================

function StopClusterPanel({
  clusterId,
  onClose,
}: {
  clusterId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [tasksOpen, setTasksOpen] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");

  const { data: cluster, isLoading } = useQuery<StopClusterDetail>({
    queryKey: ["/api/clustering/stop-clusters", clusterId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/clustering/stop-clusters/${clusterId}`)).json(),
  });

  const patchMutation = useMutation({
    mutationFn: async (body: { status?: string; displayName?: string }) =>
      (await apiRequest("PATCH", `/api/clustering/stop-clusters/${clusterId}`, body)).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/stop-clusters"] });
      setEditingName(false);
      toast({ title: "Stoppklump uppdaterad" });
    },
    onError: () => toast({ title: "Fel vid uppdatering", variant: "destructive" }),
  });

  if (isLoading || !cluster) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Laddar…
      </div>
    );
  }

  const meta = STATUS_META[cluster.status] ?? STATUS_META.active;

  return (
    <div className="flex flex-col gap-4 p-1">
      {/* Rubrik */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-1">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="h-8 text-sm"
                data-testid="input-cluster-name"
                autoFocus
              />
              <Button
                size="sm"
                onClick={() => patchMutation.mutate({ displayName: nameValue })}
                disabled={patchMutation.isPending || !nameValue.trim()}
                data-testid="button-cluster-name-save"
              >
                Spara
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingName(false)}
                data-testid="button-cluster-name-cancel"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="font-semibold leading-tight">{cluster.displayName}</span>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => { setNameValue(cluster.displayName); setEditingName(true); }}
                data-testid="button-cluster-name-edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <Badge variant={meta.variant} className="w-fit text-xs" data-testid="badge-cluster-status">
            {meta.label}
          </Badge>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="text-muted-foreground flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> Radie
        </div>
        <div className="tabular-nums">{cluster.radiusMeters ? `${cluster.radiusMeters} m` : "–"}</div>

        <div className="text-muted-foreground flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> Produktionstid
        </div>
        <div className="tabular-nums">{formatMinutes(cluster.calculatedDurationMinutes)}</div>

        <div className="text-muted-foreground">Utförandekod</div>
        <div>{cluster.executionCode ?? "–"}</div>

        <div className="text-muted-foreground">Uppgifter</div>
        <div className="tabular-nums font-medium">{cluster.memberCount}</div>
      </div>

      <Separator />

      {/* Åtgärder */}
      <div className="flex flex-wrap gap-2">
        {cluster.status !== "confirmed" && cluster.status !== "locked" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => patchMutation.mutate({ status: "confirmed" })}
            disabled={patchMutation.isPending}
            data-testid="button-cluster-confirm"
          >
            <CheckCircle2 className="h-4 w-4" />
            Bekräfta
          </Button>
        )}
        {cluster.status !== "locked" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => patchMutation.mutate({ status: "locked" })}
            disabled={patchMutation.isPending}
            data-testid="button-cluster-lock"
          >
            <Lock className="h-4 w-4" />
            Lås
          </Button>
        )}
        {cluster.status === "locked" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => patchMutation.mutate({ status: "auto" })}
            disabled={patchMutation.isPending}
            data-testid="button-cluster-unlock"
          >
            <LockOpen className="h-4 w-4" />
            Lås upp
          </Button>
        )}
      </div>

      <Separator />

      {/* Uppgiftslista */}
      <div>
        <button
          className="flex w-full items-center justify-between text-sm font-medium hover:text-foreground text-muted-foreground"
          onClick={() => setTasksOpen((v) => !v)}
          data-testid="button-cluster-tasks-toggle"
        >
          Uppgifter ({cluster.tasks.length})
          {tasksOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {tasksOpen && (
          <ul className="mt-2 flex flex-col gap-1">
            {cluster.tasks.length === 0 && (
              <li className="text-xs text-muted-foreground py-2">Inga uppgifter</li>
            )}
            {cluster.tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
                data-testid={`row-cluster-task-${t.id}`}
              >
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate">{t.title ?? t.orderNumber ?? t.id.slice(0, 8)}</span>
                  {t.orderNumber && t.title && (
                    <span className="text-muted-foreground truncate">{t.orderNumber}</span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {t.estimatedDuration != null && (
                    <span className="tabular-nums text-muted-foreground">
                      {formatMinutes(t.estimatedDuration)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// RouteClusterPanel
// ============================================================================

function RouteClusterPanel({
  clusterId,
  onClose,
}: {
  clusterId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [tasksOpen, setTasksOpen] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");

  const { data: cluster, isLoading } = useQuery<RouteClusterDetail>({
    queryKey: ["/api/clustering/route-clusters", clusterId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/clustering/route-clusters/${clusterId}`)).json(),
  });

  const patchMutation = useMutation({
    mutationFn: async (body: { status?: string; displayName?: string }) =>
      (await apiRequest("PATCH", `/api/clustering/route-clusters/${clusterId}`, body)).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/route-clusters"] });
      setEditingName(false);
      toast({ title: "Ruttklump uppdaterad" });
    },
    onError: () => toast({ title: "Fel vid uppdatering", variant: "destructive" }),
  });

  if (isLoading || !cluster) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Laddar…
      </div>
    );
  }

  const meta = STATUS_META[cluster.status] ?? STATUS_META.active;
  const precLabel = PRECISION_LABEL[cluster.precisionLevel ?? ""] ?? cluster.precisionLevel ?? "–";

  return (
    <div className="flex flex-col gap-4 p-1">
      {/* Rubrik */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-1">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="h-8 text-sm"
                data-testid="input-route-cluster-name"
                autoFocus
              />
              <Button
                size="sm"
                onClick={() => patchMutation.mutate({ displayName: nameValue })}
                disabled={patchMutation.isPending || !nameValue.trim()}
                data-testid="button-route-cluster-name-save"
              >
                Spara
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingName(false)}
                data-testid="button-route-cluster-name-cancel"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="font-semibold leading-tight">{cluster.displayName}</span>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => { setNameValue(cluster.displayName); setEditingName(true); }}
                data-testid="button-route-cluster-name-edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Badge variant={meta.variant} className="w-fit text-xs" data-testid="badge-route-cluster-status">
              {meta.label}
            </Badge>
            {cluster.period && (
              <span className="text-xs text-muted-foreground">{cluster.period}</span>
            )}
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="text-muted-foreground flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> Produktionstid
        </div>
        <div className="tabular-nums">{formatMinutes(cluster.calculatedWorkMinutes)}</div>

        <div className="text-muted-foreground flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> Restid
        </div>
        <div className="tabular-nums">{formatMinutes(cluster.calculatedTravelMinutes)}</div>

        <div className="text-muted-foreground">Precision</div>
        <div>{precLabel}</div>

        <div className="text-muted-foreground">Utförandekod</div>
        <div>{cluster.executionCode ?? "–"}</div>

        <div className="text-muted-foreground">Radie</div>
        <div className="tabular-nums">{cluster.radiusKilometers ? `${cluster.radiusKilometers} km` : "–"}</div>

        <div className="text-muted-foreground">Uppgifter</div>
        <div className="tabular-nums font-medium">{cluster.taskCount}</div>
      </div>

      <Separator />

      {/* Åtgärder */}
      <div className="flex flex-wrap gap-2">
        {cluster.status !== "confirmed" && cluster.status !== "locked" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => patchMutation.mutate({ status: "confirmed" })}
            disabled={patchMutation.isPending}
            data-testid="button-route-cluster-confirm"
          >
            <CheckCircle2 className="h-4 w-4" />
            Bekräfta
          </Button>
        )}
        {cluster.status !== "locked" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => patchMutation.mutate({ status: "locked" })}
            disabled={patchMutation.isPending}
            data-testid="button-route-cluster-lock"
          >
            <Lock className="h-4 w-4" />
            Lås
          </Button>
        )}
        {cluster.status === "locked" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => patchMutation.mutate({ status: "active" })}
            disabled={patchMutation.isPending}
            data-testid="button-route-cluster-unlock"
          >
            <LockOpen className="h-4 w-4" />
            Lås upp
          </Button>
        )}
      </div>

      <Separator />

      {/* Uppgiftslista */}
      <div>
        <button
          className="flex w-full items-center justify-between text-sm font-medium hover:text-foreground text-muted-foreground"
          onClick={() => setTasksOpen((v) => !v)}
          data-testid="button-route-cluster-tasks-toggle"
        >
          Uppgifter ({cluster.tasks.length})
          {tasksOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {tasksOpen && (
          <ul className="mt-2 flex flex-col gap-1">
            {cluster.tasks.length === 0 && (
              <li className="text-xs text-muted-foreground py-2">Inga uppgifter</li>
            )}
            {cluster.tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
                data-testid={`row-route-cluster-task-${t.id}`}
              >
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate">{t.title ?? t.orderNumber ?? t.id.slice(0, 8)}</span>
                  {t.orderNumber && t.title && (
                    <span className="text-muted-foreground truncate">{t.orderNumber}</span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {t.estimatedDuration != null && (
                    <span className="tabular-nums text-muted-foreground">
                      {formatMinutes(t.estimatedDuration)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Exporterat ClusterSidePanel
// ============================================================================

export type ClusterRef =
  | { type: "stop"; id: string }
  | { type: "route"; id: string };

interface ClusterSidePanelProps {
  cluster: ClusterRef | null;
  onClose: () => void;
}

export function ClusterSidePanel({ cluster, onClose }: ClusterSidePanelProps) {
  return (
    <Sheet open={cluster !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-[380px] sm:w-[420px] overflow-y-auto"
        data-testid="sheet-cluster-panel"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>
            {cluster?.type === "route" ? "Ruttklump" : "Stoppklump"}
          </SheetTitle>
        </SheetHeader>
        {cluster?.type === "stop" && (
          <StopClusterPanel clusterId={cluster.id} onClose={onClose} />
        )}
        {cluster?.type === "route" && (
          <RouteClusterPanel clusterId={cluster.id} onClose={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}
