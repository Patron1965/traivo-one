/**
 * Klumpvy — lista route clusters och stop clusters med bulk-åtgärder.
 * Används som "Klumpvy"-fliken i GrovplaneringPage.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CheckCircle2,
  Lock,
  LockOpen,
  Loader2,
  Clock,
  Route,
  MapPin,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Merge,
  Users,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ClusterSidePanel, type ClusterRef } from "./ClusterSidePanel";

// ============================================================================
// Typer
// ============================================================================

interface RouteClusterListItem {
  id: string;
  displayName: string;
  status: string;
  executionCode: string | null;
  calculatedWorkMinutes: number | null;
  calculatedTravelMinutes: number | null;
  precisionLevel: string | null;
  period: string | null;
  taskCount: number;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusKilometers: number | null;
}

interface StopClusterListItem {
  id: string;
  displayName: string;
  status: string;
  executionCode: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  calculatedDurationMinutes: number | null;
  memberCount: number;
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

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: "Aktiv", cls: "bg-muted text-muted-foreground" },
  auto: { label: "Auto", cls: "bg-muted text-muted-foreground" },
  confirmed: { label: "Bekräftad", cls: "bg-chart-2/15 text-chart-2" },
  locked: { label: "Låst", cls: "bg-chart-1/15 text-chart-1" },
  dissolved: { label: "Upplöst", cls: "bg-muted/50 text-muted-foreground/60" },
};

const PRECISION_LABEL: Record<string, string> = {
  high: "Hög",
  medium: "Medel",
  low: "Låg",
};

function StatusChip({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.active;
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium", meta.cls)}>
      {meta.label}
    </span>
  );
}

// ============================================================================
// RouteClusterCard
// ============================================================================

function RouteClusterCard({
  cluster,
  selected,
  onSelect,
  onOpen,
}: {
  cluster: RouteClusterListItem;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onOpen: (ref: ClusterRef) => void;
}) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-colors hover:bg-muted/30",
        selected && "ring-2 ring-primary ring-offset-1",
        cluster.status === "dissolved" && "opacity-50",
      )}
      data-testid={`card-route-cluster-${cluster.id}`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 p-3 pb-1">
        <div className="flex items-start gap-2 min-w-0">
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onSelect(cluster.id, v === true)}
            onClick={(e) => e.stopPropagation()}
            data-testid={`check-route-cluster-${cluster.id}`}
            className="mt-0.5 shrink-0"
          />
          <div className="min-w-0">
            <CardTitle
              className="text-sm font-semibold leading-tight truncate cursor-pointer hover:underline"
              onClick={() => onOpen({ type: "route", id: cluster.id })}
              data-testid={`link-route-cluster-${cluster.id}`}
            >
              {cluster.displayName}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <StatusChip status={cluster.status} />
              {cluster.period && (
                <span className="text-[11px] text-muted-foreground">{cluster.period}</span>
              )}
              {cluster.precisionLevel && (
                <span className="text-[11px] text-muted-foreground">
                  Precision: {PRECISION_LABEL[cluster.precisionLevel] ?? cluster.precisionLevel}
                </span>
              )}
            </div>
          </div>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground font-medium">
          {cluster.taskCount} uppg.
        </span>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            Prod.tid
          </div>
          <span className="tabular-nums">{formatMinutes(cluster.calculatedWorkMinutes)}</span>

          <div className="flex items-center gap-1 text-muted-foreground">
            <Route className="h-3 w-3" />
            Restid
          </div>
          <span className="tabular-nums">{formatMinutes(cluster.calculatedTravelMinutes)}</span>

          {cluster.executionCode && (
            <>
              <div className="text-muted-foreground">Kod</div>
              <span>{cluster.executionCode}</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// StopClusterCard
// ============================================================================

function StopClusterCard({
  cluster,
  selected,
  onSelect,
  onOpen,
}: {
  cluster: StopClusterListItem;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onOpen: (ref: ClusterRef) => void;
}) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-colors hover:bg-muted/30",
        selected && "ring-2 ring-primary ring-offset-1",
        cluster.status === "dissolved" && "opacity-50",
      )}
      data-testid={`card-stop-cluster-${cluster.id}`}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 p-3 pb-1">
        <div className="flex items-start gap-2 min-w-0">
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onSelect(cluster.id, v === true)}
            onClick={(e) => e.stopPropagation()}
            data-testid={`check-stop-cluster-${cluster.id}`}
            className="mt-0.5 shrink-0"
          />
          <div className="min-w-0">
            <CardTitle
              className="text-sm font-semibold leading-tight truncate cursor-pointer hover:underline"
              onClick={() => onOpen({ type: "stop", id: cluster.id })}
              data-testid={`link-stop-cluster-${cluster.id}`}
            >
              {cluster.displayName}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <StatusChip status={cluster.status} />
              {cluster.executionCode && (
                <span className="text-[11px] text-muted-foreground">{cluster.executionCode}</span>
              )}
            </div>
          </div>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground font-medium">
          {cluster.memberCount} uppg.
        </span>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            Produktionstid
          </div>
          <span className="tabular-nums">{formatMinutes(cluster.calculatedDurationMinutes)}</span>

          <div className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="h-3 w-3" />
            Radie
          </div>
          <span className="tabular-nums">
            {cluster.radiusMeters ? `${cluster.radiusMeters} m` : "–"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// MassActionBar
// ============================================================================

function MassActionBar({
  count,
  type,
  onConfirm,
  onLock,
  onUnlock,
  loading,
  onClear,
  onMerge,
  onSendToVeckoplan,
}: {
  count: number;
  type: "route" | "stop";
  onConfirm: () => void;
  onLock: () => void;
  onUnlock: () => void;
  loading: boolean;
  onClear: () => void;
  onMerge?: () => void;
  onSendToVeckoplan?: () => void;
}) {
  if (count === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2"
      data-testid="bar-cluster-mass-actions"
    >
      <span className="text-sm font-medium">
        {count} {type === "route" ? "ruttförslag" : "stoppklumpar"} markerade
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={onConfirm}
        disabled={loading}
        data-testid="button-mass-confirm"
      >
        <CheckCircle2 className="h-4 w-4" />
        Bekräfta alla
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onLock}
        disabled={loading}
        data-testid="button-mass-lock"
      >
        <Lock className="h-4 w-4" />
        Lås alla
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onUnlock}
        disabled={loading}
        data-testid="button-mass-unlock"
      >
        <LockOpen className="h-4 w-4" />
        Lås upp alla
      </Button>
      {/* Slå ihop: bara för stoppklumpar, exakt 2 valda */}
      {type === "stop" && count === 2 && onMerge && (
        <Button
          size="sm"
          variant="outline"
          onClick={onMerge}
          disabled={loading}
          data-testid="button-mass-merge"
        >
          <Merge className="h-4 w-4" />
          Slå ihop
        </Button>
      )}
      {/* Skicka till veckoplan */}
      {onSendToVeckoplan && (
        <Button
          size="sm"
          variant="outline"
          onClick={onSendToVeckoplan}
          disabled={loading}
          data-testid="button-mass-send-veckoplan"
        >
          <CalendarDays className="h-4 w-4" />
          Skicka till veckoplan
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
        disabled={loading}
        data-testid="button-mass-clear"
      >
        Avmarkera
      </Button>
    </div>
  );
}

// ============================================================================
// Exported ClusterListView
// ============================================================================

type StatusFilter = "all" | "active" | "confirmed" | "locked" | "dissolved";

export function ClusterListView() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [activeSection, setActiveSection] = useState<"route" | "stop">("route");
  const [routeCollapsed, setRouteCollapsed] = useState(false);
  const [stopCollapsed, setStopCollapsed] = useState(false);
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(new Set());
  const [selectedStopIds, setSelectedStopIds] = useState<Set<string>>(new Set());
  const [openCluster, setOpenCluster] = useState<ClusterRef | null>(null);

  // ---- Queries ----
  const routeQuery = useQuery<RouteClusterListItem[]>({
    queryKey: ["/api/clustering/route-clusters", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      return (await apiRequest("GET", `/api/clustering/route-clusters?${params}`)).json();
    },
  });

  const stopQuery = useQuery<StopClusterListItem[]>({
    queryKey: ["/api/clustering/stop-clusters", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      return (await apiRequest("GET", `/api/clustering/stop-clusters?${params}`)).json();
    },
  });

  // ---- Full-run mutations ----
  const routeFullRun = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/clustering/route/full-run", {})).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/route-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      toast({ title: "Ruttförslag skapade" });
    },
    onError: () => toast({ title: "Fel vid skapande av ruttförslag", variant: "destructive" }),
  });

  const stopFullRun = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/clustering/stop/full-run", {})).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/stop-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      toast({ title: "Stoppklumpning klar" });
    },
    onError: () => toast({ title: "Fel vid stoppklumpning", variant: "destructive" }),
  });

  // ---- Merge stop clusters mutation (exakt 2 valda) ----
  const mergeStopMutation = useMutation({
    mutationFn: async ([sourceId, targetId]: [string, string]) =>
      (await apiRequest("POST", "/api/clustering/stop-clusters/merge", { sourceId, targetId })).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/stop-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      setSelectedStopIds(new Set());
      toast({ title: "Stoppklumpar sammanslagna" });
    },
    onError: () => toast({ title: "Fel vid sammanslagning", variant: "destructive" }),
  });

  // ---- Mass-action mutations ----
  const massRouteMutation = useMutation({
    mutationFn: async (status: string) => {
      await Promise.all(
        Array.from(selectedRouteIds).map((id) =>
          apiRequest("PATCH", `/api/clustering/route-clusters/${id}`, { status }),
        ),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/route-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      setSelectedRouteIds(new Set());
      toast({ title: "Ruttförslag uppdaterade" });
    },
    onError: () => toast({ title: "Fel vid massåtgärd", variant: "destructive" }),
  });

  const massStopMutation = useMutation({
    mutationFn: async (status: string) => {
      await Promise.all(
        Array.from(selectedStopIds).map((id) =>
          apiRequest("PATCH", `/api/clustering/stop-clusters/${id}`, { status }),
        ),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/clustering/stop-clusters"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      setSelectedStopIds(new Set());
      toast({ title: "Stoppklumpar uppdaterade" });
    },
    onError: () => toast({ title: "Fel vid massåtgärd", variant: "destructive" }),
  });

  // ---- Helpers ----
  const toggleRouteSelect = (id: string, checked: boolean) =>
    setSelectedRouteIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleStopSelect = (id: string, checked: boolean) =>
    setSelectedStopIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const routeClusters = routeQuery.data ?? [];
  const stopClusters = stopQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Filterrad */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Status:</span>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
            <SelectTrigger className="h-8 w-[150px]" data-testid="select-cluster-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla</SelectItem>
              <SelectItem value="active">Aktiva</SelectItem>
              <SelectItem value="confirmed">Bekräftade</SelectItem>
              <SelectItem value="locked">Låsta</SelectItem>
              <SelectItem value="dissolved">Upplösta</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => routeFullRun.mutate()}
            disabled={routeFullRun.isPending}
            data-testid="button-route-full-run"
          >
            {routeFullRun.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Räkna om ruttförslag
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => stopFullRun.mutate()}
            disabled={stopFullRun.isPending}
            data-testid="button-stop-full-run"
          >
            {stopFullRun.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Räkna om stoppklumpar
          </Button>
        </div>
      </div>

      {/* Massåtgärder */}
      {selectedRouteIds.size > 0 && (
        <MassActionBar
          count={selectedRouteIds.size}
          type="route"
          loading={massRouteMutation.isPending}
          onConfirm={() => massRouteMutation.mutate("confirmed")}
          onLock={() => massRouteMutation.mutate("locked")}
          onUnlock={() => massRouteMutation.mutate("active")}
          onClear={() => setSelectedRouteIds(new Set())}
          onSendToVeckoplan={() => navigate("/veckoplan")}
        />
      )}
      {selectedStopIds.size > 0 && (
        <MassActionBar
          count={selectedStopIds.size}
          type="stop"
          loading={massStopMutation.isPending || mergeStopMutation.isPending}
          onConfirm={() => massStopMutation.mutate("confirmed")}
          onLock={() => massStopMutation.mutate("locked")}
          onUnlock={() => massStopMutation.mutate("auto")}
          onClear={() => setSelectedStopIds(new Set())}
          onMerge={() => {
            const [src, tgt] = Array.from(selectedStopIds);
            if (src && tgt) mergeStopMutation.mutate([src, tgt]);
          }}
          onSendToVeckoplan={() => navigate("/veckoplan")}
        />
      )}

      {/* Ruttförslag */}
      <div>
        <button
          className="flex items-center gap-2 text-sm font-semibold mb-2 hover:text-foreground text-foreground"
          onClick={() => setRouteCollapsed((v) => !v)}
          data-testid="button-route-clusters-toggle"
        >
          <Route className="h-4 w-4 text-muted-foreground" />
          Ruttförslag
          <Badge variant="secondary" className="text-xs">
            {routeClusters.length}
          </Badge>
          {routeCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {!routeCollapsed && (
          <>
            {routeQuery.isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Laddar ruttförslag…
              </div>
            ) : routeClusters.length === 0 ? (
              <div
                className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground"
                data-testid="text-no-route-clusters"
              >
                Inga ruttförslag hittades. Kör "Räkna om ruttförslag" för att bygga förslag.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {routeClusters.map((c) => (
                  <RouteClusterCard
                    key={c.id}
                    cluster={c}
                    selected={selectedRouteIds.has(c.id)}
                    onSelect={toggleRouteSelect}
                    onOpen={setOpenCluster}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <Separator />

      {/* Stoppklumpar */}
      <div>
        <button
          className="flex items-center gap-2 text-sm font-semibold mb-2 hover:text-foreground text-foreground"
          onClick={() => setStopCollapsed((v) => !v)}
          data-testid="button-stop-clusters-toggle"
        >
          <MapPin className="h-4 w-4 text-muted-foreground" />
          Stoppklumpar
          <Badge variant="secondary" className="text-xs">
            {stopClusters.length}
          </Badge>
          {stopCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {!stopCollapsed && (
          <>
            {stopQuery.isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Laddar stoppklumpar…
              </div>
            ) : stopClusters.length === 0 ? (
              <div
                className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground"
                data-testid="text-no-stop-clusters"
              >
                Inga stoppklumpar hittades. Kör "Räkna om stoppklumpar" för att bygga klumpar.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {stopClusters.map((c) => (
                  <StopClusterCard
                    key={c.id}
                    cluster={c}
                    selected={selectedStopIds.has(c.id)}
                    onSelect={toggleStopSelect}
                    onOpen={setOpenCluster}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Side panel */}
      <ClusterSidePanel cluster={openCluster} onClose={() => setOpenCluster(null)} />
    </div>
  );
}
