import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
  CalendarDays,
  AlertTriangle,
  Merge,
  Scissors,
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
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  routeDescription: string | null;
  calculatedWorkMinutes: number | null;
  calculatedTravelMinutes: number | null;
  precisionLevel: string | null;
  period: string | null;
  taskCount: number;
  tasks: ClusterTask[];
}

interface StopClusterSummary {
  id: string;
  displayName: string;
  status: string;
  memberCount: number;
}

interface RouteClusterSummary {
  id: string;
  displayName: string;
  status: string;
  taskCount: number;
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

function ConstraintWarning() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>Klumpen är låst. Manuella ändringar kan avvika från klumpkriterierna (geografi, tid, utförandekod).</span>
    </div>
  );
}

// ============================================================================
// MergePanel — gemensam komponent för slå ihop
// ============================================================================

function MergePanel({
  currentId,
  clusterType,
  otherClusters,
  isMergePending,
  onConfirm,
  onCancel,
}: {
  currentId: string;
  clusterType: "stop" | "route";
  otherClusters: Array<{ id: string; displayName: string; status: string; count: number }>;
  isMergePending: boolean;
  onConfirm: (targetId: string) => void;
  onCancel: () => void;
}) {
  const [targetId, setTargetId] = useState("");
  const eligible = otherClusters.filter(
    (c) => c.id !== currentId && c.status !== "dissolved"
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 px-3 py-3">
      <p className="text-xs font-medium">
        Välj klump att slå ihop med <span className="text-muted-foreground">(den här klumpen upplöses)</span>
      </p>
      {eligible.length === 0 ? (
        <p className="text-xs text-muted-foreground">Inga andra klumpar tillgängliga.</p>
      ) : (
        <Select value={targetId} onValueChange={setTargetId}>
          <SelectTrigger className="h-8 text-xs" data-testid="select-merge-target">
            <SelectValue placeholder="Välj målklump…" />
          </SelectTrigger>
          <SelectContent>
            {eligible.map((c) => (
              <SelectItem key={c.id} value={c.id} data-testid={`option-merge-target-${c.id}`}>
                {c.displayName}
                <span className="ml-1 text-muted-foreground">
                  ({c.count} uppg.)
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={!targetId || isMergePending}
          onClick={() => onConfirm(targetId)}
          data-testid="button-merge-confirm"
        >
          {isMergePending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Slå ihop
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} data-testid="button-merge-cancel">
          Avbryt
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// SplitPanel — gemensam komponent för dela
// ============================================================================

function SplitPanel({
  tasks,
  isSplitPending,
  onConfirm,
  onCancel,
}: {
  tasks: ClusterTask[];
  isSplitPending: boolean;
  onConfirm: (taskIds: string[], displayName?: string) => void;
  onCancel: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [splitName, setSplitName] = useState("");

  function toggleTask(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canSplit = selectedIds.size >= 1 && selectedIds.size < tasks.length;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 px-3 py-3">
      <p className="text-xs font-medium">
        Välj uppgifter att flytta till en ny klump
      </p>
      {tasks.length <= 1 ? (
        <p className="text-xs text-muted-foreground">Klumpen måste ha minst 2 uppgifter för att kunna delas.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/60">
                <Checkbox
                  id={`split-task-${t.id}`}
                  checked={selectedIds.has(t.id)}
                  onCheckedChange={() => toggleTask(t.id)}
                  data-testid={`checkbox-split-task-${t.id}`}
                />
                <Label
                  htmlFor={`split-task-${t.id}`}
                  className="flex-1 cursor-pointer text-xs leading-tight"
                >
                  <span className="font-medium">{t.title ?? t.orderNumber ?? t.id.slice(0, 8)}</span>
                  {t.estimatedDuration != null && (
                    <span className="ml-1 text-muted-foreground tabular-nums">
                      {formatMinutes(t.estimatedDuration)}
                    </span>
                  )}
                </Label>
              </li>
            ))}
          </ul>
          <Input
            placeholder="Namn på ny klump (valfritt)"
            value={splitName}
            onChange={(e) => setSplitName(e.target.value)}
            className="h-8 text-xs"
            data-testid="input-split-name"
          />
          {!canSplit && selectedIds.size > 0 && selectedIds.size >= tasks.length && (
            <p className="text-xs text-warning">Minst en uppgift måste stanna kvar i den ursprungliga klumpen.</p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canSplit || isSplitPending}
              onClick={() =>
                onConfirm(
                  Array.from(selectedIds),
                  splitName.trim() || undefined
                )
              }
              data-testid="button-split-confirm"
            >
              {isSplitPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Dela ({selectedIds.size} valda)
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} data-testid="button-split-cancel">
              Avbryt
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

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
  const [, navigate] = useLocation();
  const [tasksOpen, setTasksOpen] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [lockComment, setLockComment] = useState("");
  const [showLockComment, setShowLockComment] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showSplit, setShowSplit] = useState(false);

  const { data: cluster, isLoading } = useQuery<StopClusterDetail>({
    queryKey: ["/api/clustering/stop-clusters", clusterId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/clustering/stop-clusters/${clusterId}`)).json(),
  });

  const { data: allClusters } = useQuery<StopClusterSummary[]>({
    queryKey: ["/api/clustering/stop-clusters"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/clustering/stop-clusters")).json(),
    enabled: showMerge,
  });

  const patchMutation = useMutation({
    mutationFn: async (body: { status?: string; displayName?: string }) =>
      (await apiRequest("PATCH", `/api/clustering/stop-clusters/${clusterId}`, body)).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/stop-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      setEditingName(false);
      setShowLockComment(false);
      setLockComment("");
      toast({ title: "Stoppklump uppdaterad" });
    },
    onError: () => toast({ title: "Fel vid uppdatering", variant: "destructive" }),
  });

  const mergeMutation = useMutation({
    mutationFn: async (targetId: string) =>
      (
        await apiRequest("POST", "/api/clustering/stop-clusters/merge", {
          sourceId: clusterId,
          targetId,
        })
      ).json(),
    onSuccess: (_data, targetId) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/stop-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      toast({ title: "Klumpar sammanslagna" });
      onClose();
    },
    onError: () => toast({ title: "Fel vid sammanslagning", variant: "destructive" }),
  });

  const splitMutation = useMutation({
    mutationFn: async ({
      taskIds,
      displayName,
    }: {
      taskIds: string[];
      displayName?: string;
    }) =>
      (
        await apiRequest("POST", `/api/clustering/stop-clusters/${clusterId}/split`, {
          taskIds,
          ...(displayName ? { displayName } : {}),
        })
      ).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/stop-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      setShowSplit(false);
      toast({ title: "Klump delad" });
    },
    onError: () => toast({ title: "Fel vid delning", variant: "destructive" }),
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
  const isLocked = cluster.status === "locked";

  const mergeTargetList = (allClusters ?? [])
    .filter((c) => c.id !== clusterId && c.status !== "dissolved")
    .map((c) => ({ id: c.id, displayName: c.displayName, status: c.status, count: c.memberCount }));

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

      {isLocked && <ConstraintWarning />}
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
          showLockComment ? (
            <div className="flex w-full flex-col gap-2">
              <Textarea
                placeholder="Kommentar (valfritt)"
                value={lockComment}
                onChange={(e) => setLockComment(e.target.value)}
                className="h-20 text-xs resize-none"
                data-testid="textarea-lock-comment"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => patchMutation.mutate({ status: "locked" })}
                  disabled={patchMutation.isPending}
                  data-testid="button-cluster-lock-confirm"
                >
                  <Lock className="h-4 w-4" />
                  Lås
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowLockComment(false)}
                  data-testid="button-cluster-lock-cancel"
                >
                  Avbryt
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowLockComment(true)}
              disabled={patchMutation.isPending}
              data-testid="button-cluster-lock"
            >
              <Lock className="h-4 w-4" />
              Lås
            </Button>
          )
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate("/veckoplan")}
          data-testid="button-cluster-send-to-veckoplan"
        >
          <CalendarDays className="h-4 w-4" />
          Skicka till veckoplan
        </Button>

        {/* Slå ihop */}
        {!showMerge && !showSplit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowMerge(true)}
            data-testid="button-cluster-merge"
          >
            <Merge className="h-4 w-4" />
            Slå ihop
          </Button>
        )}

        {/* Dela klump */}
        {!showMerge && !showSplit && cluster.tasks.length >= 2 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowSplit(true)}
            data-testid="button-cluster-split"
          >
            <Scissors className="h-4 w-4" />
            Dela klump
          </Button>
        )}
      </div>

      {/* Merge-panel */}
      {showMerge && (
        <MergePanel
          currentId={clusterId}
          clusterType="stop"
          otherClusters={mergeTargetList}
          isMergePending={mergeMutation.isPending}
          onConfirm={(targetId) => mergeMutation.mutate(targetId)}
          onCancel={() => setShowMerge(false)}
        />
      )}

      {/* Split-panel */}
      {showSplit && (
        <SplitPanel
          tasks={cluster.tasks}
          isSplitPending={splitMutation.isPending}
          onConfirm={(taskIds, displayName) =>
            splitMutation.mutate({ taskIds, displayName })
          }
          onCancel={() => setShowSplit(false)}
        />
      )}

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
  const [, navigate] = useLocation();
  const [tasksOpen, setTasksOpen] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [lockComment, setLockComment] = useState("");
  const [showLockComment, setShowLockComment] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showSplit, setShowSplit] = useState(false);

  const { data: cluster, isLoading } = useQuery<RouteClusterDetail>({
    queryKey: ["/api/clustering/route-clusters", clusterId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/clustering/route-clusters/${clusterId}`)).json(),
  });

  const { data: allClusters } = useQuery<RouteClusterSummary[]>({
    queryKey: ["/api/clustering/route-clusters"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/clustering/route-clusters")).json(),
    enabled: showMerge,
  });

  const patchMutation = useMutation({
    mutationFn: async (body: { status?: string; displayName?: string; routeDescription?: string }) =>
      (await apiRequest("PATCH", `/api/clustering/route-clusters/${clusterId}`, body)).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/route-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      setEditingName(false);
      setShowLockComment(false);
      setLockComment("");
      toast({ title: "Ruttklump uppdaterad" });
    },
    onError: () => toast({ title: "Fel vid uppdatering", variant: "destructive" }),
  });

  const mergeMutation = useMutation({
    mutationFn: async (targetId: string) =>
      (
        await apiRequest("POST", "/api/clustering/route-clusters/merge", {
          sourceId: clusterId,
          targetId,
        })
      ).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/route-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      toast({ title: "Ruttklumpar sammanslagna" });
      onClose();
    },
    onError: () => toast({ title: "Fel vid sammanslagning", variant: "destructive" }),
  });

  const splitMutation = useMutation({
    mutationFn: async ({
      taskIds,
      displayName,
    }: {
      taskIds: string[];
      displayName?: string;
    }) =>
      (
        await apiRequest("POST", `/api/clustering/route-clusters/${clusterId}/split`, {
          taskIds,
          ...(displayName ? { displayName } : {}),
        })
      ).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/route-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      setShowSplit(false);
      toast({ title: "Ruttklump delad" });
    },
    onError: () => toast({ title: "Fel vid delning", variant: "destructive" }),
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
  const isLocked = cluster.status === "locked";

  const mergeTargetList = (allClusters ?? [])
    .filter((c) => c.id !== clusterId && c.status !== "dissolved")
    .map((c) => ({ id: c.id, displayName: c.displayName, status: c.status, count: c.taskCount }));

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

      {isLocked && <ConstraintWarning />}
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

      {cluster.routeDescription && (
        <p className="text-xs text-muted-foreground rounded border border-border bg-muted/30 px-2 py-1.5">
          {cluster.routeDescription}
        </p>
      )}

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
          showLockComment ? (
            <div className="flex w-full flex-col gap-2">
              <Textarea
                placeholder="Låskommentar (valfritt, sparas i ruttnotes)"
                value={lockComment}
                onChange={(e) => setLockComment(e.target.value)}
                className="h-20 text-xs resize-none"
                data-testid="textarea-route-lock-comment"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    patchMutation.mutate({
                      status: "locked",
                      ...(lockComment.trim() ? { routeDescription: lockComment.trim() } : {}),
                    })
                  }
                  disabled={patchMutation.isPending}
                  data-testid="button-route-cluster-lock-confirm"
                >
                  <Lock className="h-4 w-4" />
                  Lås
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowLockComment(false)}
                  data-testid="button-route-cluster-lock-cancel"
                >
                  Avbryt
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowLockComment(true)}
              disabled={patchMutation.isPending}
              data-testid="button-route-cluster-lock"
            >
              <Lock className="h-4 w-4" />
              Lås
            </Button>
          )
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate("/veckoplan")}
          data-testid="button-route-cluster-send-to-veckoplan"
        >
          <CalendarDays className="h-4 w-4" />
          Skicka till veckoplan
        </Button>

        {/* Slå ihop */}
        {!showMerge && !showSplit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowMerge(true)}
            data-testid="button-route-cluster-merge"
          >
            <Merge className="h-4 w-4" />
            Slå ihop
          </Button>
        )}

        {/* Dela klump */}
        {!showMerge && !showSplit && cluster.tasks.length >= 2 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowSplit(true)}
            data-testid="button-route-cluster-split"
          >
            <Scissors className="h-4 w-4" />
            Dela klump
          </Button>
        )}
      </div>

      {/* Merge-panel */}
      {showMerge && (
        <MergePanel
          currentId={clusterId}
          clusterType="route"
          otherClusters={mergeTargetList}
          isMergePending={mergeMutation.isPending}
          onConfirm={(targetId) => mergeMutation.mutate(targetId)}
          onCancel={() => setShowMerge(false)}
        />
      )}

      {/* Split-panel */}
      {showSplit && (
        <SplitPanel
          tasks={cluster.tasks}
          isSplitPending={splitMutation.isPending}
          onConfirm={(taskIds, displayName) =>
            splitMutation.mutate({ taskIds, displayName })
          }
          onCancel={() => setShowSplit(false)}
        />
      )}

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
        className="w-[380px] sm:w-[440px] overflow-y-auto"
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
