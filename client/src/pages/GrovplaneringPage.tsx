import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, getISOWeek, getISOWeekYear, startOfISOWeek, addWeeks } from "date-fns";
import { sv } from "date-fns/locale";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Users,
  Gauge,
  Banknote,
  MapPin,
  ClipboardList,
  Plus,
  Crosshair,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatSekFromOre } from "@/lib/format";
import { getExecutionStatusBadge } from "@/lib/status-colors";
import { RoughPlanningMap } from "@/components/grovplanering/RoughPlanningMap";
import type {
  GeographicDistrict,
  RoughPlanningMapPoint,
  RoughPlanningSummary,
  RoughPlanningTyngdpunktWeek,
  Team,
  WorkOrderWithObject,
} from "@shared/schema";

const UNPLANNED_PAGE_SIZE = 50;

type UnplannedResponse = { workOrders: WorkOrderWithObject[]; total: number };

const UNASSIGNED = "__none__";

function isoWeekString(date: Date): string {
  return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, "0")}`;
}

function weekStartFromString(week: string): Date {
  const m = week.match(/^(\d{4})-W(\d{2})$/);
  const now = new Date();
  if (!m) return startOfISOWeek(now);
  const year = Number(m[1]);
  const wk = Number(m[2]);
  const jan4 = new Date(year, 0, 4);
  return addWeeks(startOfISOWeek(jan4), wk - 1);
}

export default function GrovplaneringPage() {
  const { toast } = useToast();
  const [week, setWeek] = useState<string>(() => isoWeekString(new Date()));
  const [districtFilter, setDistrictFilter] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<"team" | "district">("team");
  const [assignDistrict, setAssignDistrict] = useState<string>(UNASSIGNED);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoSuggestDistrict, setAutoSuggestDistrict] = useState(false);

  const summaryQuery = useQuery<RoughPlanningSummary>({
    queryKey: [
      "/api/rough-planning/summary",
      { week, districtId: districtFilter === "all" ? undefined : districtFilter },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ week });
      if (districtFilter !== "all") params.set("districtId", districtFilter);
      const res = await apiRequest("GET", `/api/rough-planning/summary?${params.toString()}`);
      return res.json();
    },
  });
  const unplannedQuery = useQuery<UnplannedResponse>({
    queryKey: ["/api/rough-planning/unplanned", { limit: UNPLANNED_PAGE_SIZE }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/rough-planning/unplanned?limit=${UNPLANNED_PAGE_SIZE}`);
      return res.json();
    },
  });
  const teamsQuery = useQuery<Team[]>({ queryKey: ["/api/teams"] });
  const districtsQuery = useQuery<GeographicDistrict[]>({ queryKey: ["/api/districts"] });

  // Flerveckors översikt: vald vecka + kommande 7 veckor.
  const overviewWeeks = useMemo(() => {
    const start = weekStartFromString(week);
    return Array.from({ length: 8 }, (_, i) => isoWeekString(addWeeks(start, i)));
  }, [week]);

  const districtIdParam = districtFilter === "all" ? undefined : districtFilter;

  const overviewQuery = useQuery<RoughPlanningTyngdpunktWeek[]>({
    queryKey: ["/api/rough-planning/tyngdpunkt-overview", { weeks: overviewWeeks, districtId: districtIdParam }],
    queryFn: async () => {
      const params = new URLSearchParams({ weeks: overviewWeeks.join(",") });
      if (districtIdParam) params.set("districtId", districtIdParam);
      const res = await apiRequest("GET", `/api/rough-planning/tyngdpunkt-overview?${params.toString()}`);
      return res.json();
    },
  });

  const mapQuery = useQuery<RoughPlanningMapPoint[]>({
    queryKey: ["/api/rough-planning/map", { week, districtId: districtIdParam }],
    queryFn: async () => {
      const params = new URLSearchParams({ week });
      if (districtIdParam) params.set("districtId", districtIdParam);
      const res = await apiRequest("GET", `/api/rough-planning/map?${params.toString()}`);
      return res.json();
    },
  });

  const summary = summaryQuery.data;
  const teams = (teamsQuery.data ?? []).filter((t) => t.status === "active");
  const districts = districtsQuery.data ?? [];
  const districtById = useMemo(
    () => new Map(districts.map((d) => [d.id, d])),
    [districts],
  );

  const unplanned = unplannedQuery.data?.workOrders ?? [];
  const unplannedTotal = unplannedQuery.data?.total ?? 0;

  const totals = useMemo(() => {
    const t = summary?.totals;
    return {
      value: t?.valueOre ?? 0,
      demandH: t?.demandHours ?? 0,
      capacityH: t?.capacityHours ?? 0,
      count: t?.count ?? 0,
    };
  }, [summary]);

  const teamAggById = useMemo(
    () => new Map((summary?.byTeam ?? []).map((r) => [r.teamId, r])),
    [summary],
  );

  const teamRows = useMemo(() => {
    return teams.map((t) => {
      const agg = teamAggById.get(t.id);
      const demandH = agg?.demandHours ?? 0;
      const value = agg?.valueOre ?? 0;
      const count = agg?.count ?? 0;
      const capacityH = t.productionHoursTarget ?? 0;
      const util = capacityH > 0 ? (demandH / capacityH) * 100 : 0;
      return { team: t, count, demandH, value, capacityH, util };
    });
  }, [teams, teamAggById]);

  const unassignedTeamAgg = useMemo(
    () => (summary?.byTeam ?? []).find((r) => r.teamId === null) ?? null,
    [summary],
  );

  const districtRows = useMemo(() => {
    return (summary?.byDistrict ?? []).map((r) => {
      const id = r.districtId ?? UNASSIGNED;
      return {
        id,
        name: r.districtId === null ? "Utan distrikt" : districtById.get(r.districtId)?.name ?? "Okänt distrikt",
        color: r.districtId === null ? "#6B7C8C" : districtById.get(r.districtId)?.color ?? "#3B82F6",
        count: r.count,
        value: r.valueOre,
        demandH: r.demandHours,
      };
    });
  }, [summary, districtById]);

  const statusRows = useMemo(
    () => (summary?.statusCounts ?? []).map((s) => [s.status, s.count] as const),
    [summary],
  );

  const assignMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const payload: Record<string, unknown> = { roughPlannedWeek: week };
      if (assignDistrict !== UNASSIGNED) payload.districtId = assignDistrict;
      return apiRequest("PATCH", `/api/work-orders/${orderId}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/unplanned"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/map"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/tyngdpunkt-overview"] });
      toast({ title: "Order grovplanerad", description: `Lagd på ${week}` });
    },
    onError: (e: Error) => toast({ title: "Kunde inte grovplanera", description: e.message, variant: "destructive" }),
  });

  const unplannedShown = useMemo(() => unplanned.slice(0, 50), [unplanned]);

  const selectedShownIds = useMemo(
    () => unplannedShown.filter((o) => selectedIds.has(o.id)).map((o) => o.id),
    [unplannedShown, selectedIds],
  );
  const allShownSelected = unplannedShown.length > 0 && selectedShownIds.length === unplannedShown.length;
  const someShownSelected = selectedShownIds.length > 0 && !allShownSelected;

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelectedIds(() => (checked ? new Set(unplannedShown.map((o) => o.id)) : new Set()));
  };

  const bulkMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const payload: Record<string, unknown> = {
        workOrderIds: ids,
        roughPlannedWeek: week,
        autoSuggestDistrict,
      };
      if (assignDistrict !== UNASSIGNED) payload.districtId = assignDistrict;
      const res = await apiRequest("POST", "/api/work-orders/bulk-rough-plan", payload);
      return res.json() as Promise<{
        summary: { total: number; planned: number; error: number; autoAssigned: number };
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/unplanned"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/map"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/tyngdpunkt-overview"] });
      setSelectedIds(new Set());
      const { planned, error, autoAssigned } = data.summary;
      const parts = [`${planned} grovplanerade på ${week}`];
      if (autoAssigned > 0) parts.push(`${autoAssigned} fick distrikt via postnummer`);
      if (error > 0) parts.push(`${error} misslyckades`);
      toast({
        title: error > 0 ? "Grovplanering delvis klar" : "Ordrar grovplanerade",
        description: parts.join(" · "),
        variant: error > 0 ? "destructive" : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Kunde inte grovplanera", description: e.message, variant: "destructive" }),
  });

  const weekStart = weekStartFromString(week);
  const weekLabel = `${week} · ${format(weekStart, "d MMM", { locale: sv })}`;
  const utilPct = totals.capacityH > 0 ? Math.round((totals.demandH / totals.capacityH) * 100) : 0;

  const isLoading = summaryQuery.isLoading || teamsQuery.isLoading || districtsQuery.isLoading;
  const isError = summaryQuery.isError || teamsQuery.isError || districtsQuery.isError;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        icon={CalendarDays}
        title="Grovplanering"
        description="Veckoöversikt: behov vs kapacitet per team, ordervärde, status och geografisk fördelning"
        testId="text-grovplanering-title"
      >
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeek(isoWeekString(addWeeks(weekStart, -1)))}
            data-testid="button-prev-week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[140px] text-center text-sm font-medium" data-testid="text-current-week">
            {weekLabel}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeek(isoWeekString(addWeeks(weekStart, 1)))}
            data-testid="button-next-week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeek(isoWeekString(new Date()))} data-testid="button-this-week">
            Denna vecka
          </Button>
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Distrikt</span>
          <Select value={districtFilter} onValueChange={setDistrictFilter}>
            <SelectTrigger className="w-[200px]" data-testid="select-district-filter">
              <SelectValue placeholder="Alla distrikt" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla distrikt</SelectItem>
              {districts.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Gruppera</span>
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as "team" | "district")}>
            <SelectTrigger className="w-[160px]" data-testid="select-group-by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="team">Per team</SelectItem>
              <SelectItem value="district">Per distrikt</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        isEmpty={false}
        error={(summaryQuery.error || teamsQuery.error || districtsQuery.error) as Error | null}
        onRetry={() => {
          summaryQuery.refetch();
          unplannedQuery.refetch();
          teamsQuery.refetch();
          districtsQuery.refetch();
        }}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="card-kpi-orders">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <ClipboardList className="h-4 w-4" /> Ordrar
              </div>
              <p className="text-2xl font-semibold mt-1" data-testid="text-kpi-orders">{totals.count}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-value">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Banknote className="h-4 w-4" /> Ordervärde
              </div>
              <p className="text-2xl font-semibold mt-1" data-testid="text-kpi-value">{formatSekFromOre(totals.value)}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-demand">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Gauge className="h-4 w-4" /> Behov / kapacitet
              </div>
              <p className="text-2xl font-semibold mt-1" data-testid="text-kpi-demand">
                {totals.demandH.toFixed(1)} / {totals.capacityH.toFixed(0)} h
              </p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-util">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Users className="h-4 w-4" /> Beläggning
              </div>
              <p className="text-2xl font-semibold mt-1" data-testid="text-kpi-util">{utilPct}%</p>
              <Progress value={Math.min(utilPct, 100)} className="mt-2 h-1.5" />
            </CardContent>
          </Card>
        </div>

        {statusRows.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {statusRows.map(([status, n]) => (
              <Badge key={status} className={getExecutionStatusBadge(status)} data-testid={`badge-status-${status}`}>
                {status}: {n}
              </Badge>
            ))}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1" data-testid="card-tyngdpunkt">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Crosshair className="h-4 w-4" /> Tyngdpunkt {week}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary?.tyngdpunkt ? (
                <>
                  <div>
                    <p className="text-xs text-muted-foreground">Närmaste ort</p>
                    <p className="text-lg font-semibold" data-testid="text-tyngdpunkt-ort">
                      {summary.tyngdpunkt.nearestDistrictName ?? "Okänd ort"}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid="text-tyngdpunkt-coords">
                      {summary.tyngdpunkt.lat.toFixed(4)}, {summary.tyngdpunkt.lng.toFixed(4)}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div>
                      <p className="text-xs text-muted-foreground">Uppgifter</p>
                      <p className="text-sm font-semibold" data-testid="text-tyngdpunkt-count">{totals.count}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Ordervärde</p>
                      <p className="text-sm font-semibold" data-testid="text-tyngdpunkt-value">{formatSekFromOre(totals.value)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Produktionstid</p>
                      <p className="text-sm font-semibold" data-testid="text-tyngdpunkt-demand">{totals.demandH.toFixed(1)} h</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Baserat på {summary.tyngdpunkt.pointCount} ordrar med koordinater
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground py-4" data-testid="text-tyngdpunkt-empty">
                  Inga grovplanerade ordrar med koordinater denna vecka.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2" data-testid="card-grovplanering-map">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Karta — grovplanerade ordrar
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mapQuery.isLoading ? (
                <div className="h-[420px] w-full rounded-md border bg-muted/30 animate-pulse" data-testid="map-loading" />
              ) : (mapQuery.data?.length ?? 0) === 0 ? (
                <div className="flex h-[420px] w-full items-center justify-center rounded-md border text-sm text-muted-foreground" data-testid="map-empty">
                  Inga grovplanerade ordrar med koordinater denna vecka.
                </div>
              ) : (
                <RoughPlanningMap
                  points={mapQuery.data ?? []}
                  tyngdpunkt={summary?.tyngdpunkt ?? null}
                  districts={districts}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <Card data-testid="card-tyngdpunkt-overview">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> Tyngdpunkt över tid (kommande veckor)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vecka</TableHead>
                  <TableHead>Tyngdpunkt-ort</TableHead>
                  <TableHead className="text-right">Uppgifter</TableHead>
                  <TableHead className="text-right">Ordervärde</TableHead>
                  <TableHead className="text-right">Produktionstid (h)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(overviewQuery.data ?? []).map((row) => (
                  <TableRow
                    key={row.week}
                    data-state={row.week === week ? "selected" : undefined}
                    data-testid={`row-overview-${row.week}`}
                  >
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => setWeek(row.week)}
                        data-testid={`button-overview-week-${row.week}`}
                      >
                        {row.week}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.orderCount === 0
                        ? "—"
                        : row.nearestDistrictName ?? (row.lat != null ? "Okänd ort" : "Saknar koordinater")}
                    </TableCell>
                    <TableCell className="text-right">{row.orderCount}</TableCell>
                    <TableCell className="text-right">{formatSekFromOre(row.valueOre)}</TableCell>
                    <TableCell className="text-right">{row.demandHours.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
                {(overviewQuery.data?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      {overviewQuery.isLoading ? "Laddar…" : "Ingen data"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {groupBy === "team" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Behov vs kapacitet per team</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-right">Ordrar</TableHead>
                    <TableHead className="text-right">Behov (h)</TableHead>
                    <TableHead className="text-right">Kapacitet (h)</TableHead>
                    <TableHead className="w-[180px]">Beläggning</TableHead>
                    <TableHead className="text-right">Ordervärde</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamRows.map((r) => (
                    <TableRow key={r.team.id} data-testid={`row-team-${r.team.id}`}>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: r.team.color ?? "#3B82F6" }} />
                          {r.team.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right">{r.demandH.toFixed(1)}</TableCell>
                      <TableCell className="text-right">{r.capacityH.toFixed(0)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={Math.min(r.util, 100)} className="h-1.5 flex-1" />
                          <Badge
                            variant="outline"
                            className={r.util > 100 ? "bg-destructive/10 text-destructive border-destructive/30" : r.util > 85 ? "bg-warning/10 text-warning border-warning/30" : ""}
                          >
                            {Math.round(r.util)}%
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{formatSekFromOre(r.value)}</TableCell>
                    </TableRow>
                  ))}
                  {unassignedTeamAgg && unassignedTeamAgg.count > 0 && (
                    <TableRow data-testid="row-team-unassigned">
                      <TableCell className="font-medium text-muted-foreground">Utan team</TableCell>
                      <TableCell className="text-right">{unassignedTeamAgg.count}</TableCell>
                      <TableCell className="text-right">
                        {unassignedTeamAgg.demandHours.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right">-</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell className="text-right">
                        {formatSekFromOre(unassignedTeamAgg.valueOre)}
                      </TableCell>
                    </TableRow>
                  )}
                  {teamRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        Inga aktiva team
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Geografisk fördelning per distrikt
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Distrikt</TableHead>
                    <TableHead className="text-right">Ordrar</TableHead>
                    <TableHead className="text-right">Behov (h)</TableHead>
                    <TableHead className="text-right">Ordervärde</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {districtRows.map((r) => (
                    <TableRow key={r.id} data-testid={`row-district-dist-${r.id}`}>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: r.color }} />
                          {r.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right">{r.demandH.toFixed(1)}</TableCell>
                      <TableCell className="text-right">{formatSekFromOre(r.value)}</TableCell>
                    </TableRow>
                  ))}
                  {districtRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                        Inga ordrar denna vecka
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-base">
              Ogrovplanerade ordrar ({unplannedTotal}
              {unplannedTotal > unplanned.length ? `, visar ${unplanned.length}` : ""})
            </CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Lägg på distrikt</span>
                <Select value={assignDistrict} onValueChange={setAssignDistrict}>
                  <SelectTrigger className="w-[180px]" data-testid="select-assign-district">
                    <SelectValue placeholder="Utan distrikt" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>Utan distrikt</SelectItem>
                    {districts.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="auto-suggest-district"
                  checked={autoSuggestDistrict}
                  onCheckedChange={setAutoSuggestDistrict}
                  data-testid="switch-auto-suggest-district"
                />
                <Label htmlFor="auto-suggest-district" className="text-sm text-muted-foreground cursor-pointer">
                  Föreslå distrikt från postnummer
                </Label>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedShownIds.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
                <span className="text-sm font-medium" data-testid="text-selected-count">
                  {selectedShownIds.length} markerade
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                    data-testid="button-clear-selection"
                  >
                    Avmarkera
                  </Button>
                  <Button
                    size="sm"
                    disabled={bulkMutation.isPending}
                    onClick={() => bulkMutation.mutate(selectedShownIds)}
                    data-testid="button-bulk-assign"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Grovplanera markerade på {week}
                  </Button>
                </div>
              </div>
            )}
            {unplanned.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Alla aktiva ordrar är grovplanerade.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={allShownSelected ? true : someShownSelected ? "indeterminate" : false}
                        onCheckedChange={(c) => toggleAll(c === true)}
                        aria-label="Markera alla"
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Objekt</TableHead>
                    <TableHead className="text-right">Tid (h)</TableHead>
                    <TableHead className="text-right">Värde</TableHead>
                    <TableHead className="text-right">Åtgärd</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unplannedShown.map((o) => (
                    <TableRow
                      key={o.id}
                      data-state={selectedIds.has(o.id) ? "selected" : undefined}
                      data-testid={`row-unplanned-${o.id}`}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(o.id)}
                          onCheckedChange={(c) => toggleOne(o.id, c === true)}
                          aria-label={`Markera ${o.title || o.id.slice(0, 8)}`}
                          data-testid={`checkbox-unplanned-${o.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{o.title || o.id.slice(0, 8)}</TableCell>
                      <TableCell className="text-muted-foreground">{o.objectName ?? "-"}</TableCell>
                      <TableCell className="text-right">{((o.estimatedDuration ?? 0) / 60).toFixed(1)}</TableCell>
                      <TableCell className="text-right">{formatSekFromOre(o.cachedValue)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={assignMutation.isPending}
                          onClick={() => assignMutation.mutate(o.id)}
                          data-testid={`button-assign-${o.id}`}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" /> {week}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </QueryState>
    </div>
  );
}
