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
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import type { GeographicDistrict, Team, WorkOrderWithObject } from "@shared/schema";

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

  const workOrdersQuery = useQuery<WorkOrderWithObject[]>({
    queryKey: ["/api/work-orders", { allDates: true, includeUnscheduled: true }],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/work-orders?allDates=true&includeUnscheduled=true");
      return res.json();
    },
  });
  const teamsQuery = useQuery<Team[]>({ queryKey: ["/api/teams"] });
  const districtsQuery = useQuery<GeographicDistrict[]>({ queryKey: ["/api/districts"] });

  const allOrders = workOrdersQuery.data ?? [];
  const teams = (teamsQuery.data ?? []).filter((t) => t.status === "active");
  const districts = districtsQuery.data ?? [];
  const districtById = useMemo(
    () => new Map(districts.map((d) => [d.id, d])),
    [districts],
  );

  const weekOrders = useMemo(
    () =>
      allOrders.filter(
        (o) =>
          o.roughPlannedWeek === week &&
          (districtFilter === "all" || o.districtId === districtFilter),
      ),
    [allOrders, week, districtFilter],
  );

  const unplanned = useMemo(
    () => allOrders.filter((o) => !o.roughPlannedWeek && o.orderStatus !== "completed" && o.orderStatus !== "cancelled"),
    [allOrders],
  );

  const totals = useMemo(() => {
    const value = weekOrders.reduce((s, o) => s + (o.cachedValue ?? 0), 0);
    const demandH = weekOrders.reduce((s, o) => s + (o.estimatedDuration ?? 0) / 60, 0);
    const capacityH = teams.reduce((s, t) => s + (t.productionHoursTarget ?? 0), 0);
    return { value, demandH, capacityH, count: weekOrders.length };
  }, [weekOrders, teams]);

  const teamRows = useMemo(() => {
    return teams.map((t) => {
      const rows = weekOrders.filter((o) => o.teamId === t.id);
      const demandH = rows.reduce((s, o) => s + (o.estimatedDuration ?? 0) / 60, 0);
      const value = rows.reduce((s, o) => s + (o.cachedValue ?? 0), 0);
      const capacityH = t.productionHoursTarget ?? 0;
      const util = capacityH > 0 ? (demandH / capacityH) * 100 : 0;
      return { team: t, count: rows.length, demandH, value, capacityH, util };
    });
  }, [teams, weekOrders]);

  const unassignedTeamOrders = useMemo(
    () => weekOrders.filter((o) => !o.teamId),
    [weekOrders],
  );

  const districtRows = useMemo(() => {
    const map = new Map<string, { count: number; value: number; demandH: number }>();
    for (const o of weekOrders) {
      const key = o.districtId ?? UNASSIGNED;
      const cur = map.get(key) ?? { count: 0, value: 0, demandH: 0 };
      cur.count += 1;
      cur.value += o.cachedValue ?? 0;
      cur.demandH += (o.estimatedDuration ?? 0) / 60;
      map.set(key, cur);
    }
    return Array.from(map.entries()).map(([id, agg]) => ({
      id,
      name: id === UNASSIGNED ? "Utan distrikt" : districtById.get(id)?.name ?? "Okänt distrikt",
      color: id === UNASSIGNED ? "#6B7C8C" : districtById.get(id)?.color ?? "#3B82F6",
      ...agg,
    }));
  }, [weekOrders, districtById]);

  const statusRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of weekOrders) {
      const k = o.orderStatus ?? "unknown";
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return Array.from(map.entries());
  }, [weekOrders]);

  const assignMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const payload: Record<string, unknown> = { roughPlannedWeek: week };
      if (assignDistrict !== UNASSIGNED) payload.districtId = assignDistrict;
      return apiRequest("PATCH", `/api/work-orders/${orderId}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders", { allDates: true, includeUnscheduled: true }] });
      toast({ title: "Order grovplanerad", description: `Lagd på ${week}` });
    },
    onError: (e: Error) => toast({ title: "Kunde inte grovplanera", description: e.message, variant: "destructive" }),
  });

  const weekStart = weekStartFromString(week);
  const weekLabel = `${week} · ${format(weekStart, "d MMM", { locale: sv })}`;
  const utilPct = totals.capacityH > 0 ? Math.round((totals.demandH / totals.capacityH) * 100) : 0;

  const isLoading = workOrdersQuery.isLoading || teamsQuery.isLoading || districtsQuery.isLoading;
  const isError = workOrdersQuery.isError || teamsQuery.isError || districtsQuery.isError;

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
        error={(workOrdersQuery.error || teamsQuery.error || districtsQuery.error) as Error | null}
        onRetry={() => {
          workOrdersQuery.refetch();
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
                  {unassignedTeamOrders.length > 0 && (
                    <TableRow data-testid="row-team-unassigned">
                      <TableCell className="font-medium text-muted-foreground">Utan team</TableCell>
                      <TableCell className="text-right">{unassignedTeamOrders.length}</TableCell>
                      <TableCell className="text-right">
                        {(unassignedTeamOrders.reduce((s, o) => s + (o.estimatedDuration ?? 0), 0) / 60).toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right">-</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell className="text-right">
                        {formatSekFromOre(unassignedTeamOrders.reduce((s, o) => s + (o.cachedValue ?? 0), 0))}
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
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Ogrovplanerade ordrar ({unplanned.length})</CardTitle>
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
          </CardHeader>
          <CardContent>
            {unplanned.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Alla aktiva ordrar är grovplanerade.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Objekt</TableHead>
                    <TableHead className="text-right">Tid (h)</TableHead>
                    <TableHead className="text-right">Värde</TableHead>
                    <TableHead className="text-right">Åtgärd</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unplanned.slice(0, 50).map((o) => (
                    <TableRow key={o.id} data-testid={`row-unplanned-${o.id}`}>
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
