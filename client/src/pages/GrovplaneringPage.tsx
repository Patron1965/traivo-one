import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  format,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  addWeeks,
} from "date-fns";
import { sv } from "date-fns/locale";
import { CalendarDays, MapPin, Search, Users, Loader2 } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  UnplannedTasksMap,
  type UnplannedTaskPin,
} from "@/components/grovplanering/UnplannedTasksMap";
import type {
  GeographicDistrict,
  Team,
  WorkOrderWithObject,
} from "@shared/schema";

const UNPLANNED_PAGE_SIZE = 200;
const ALL_DISTRICTS = "all";

type UnplannedResponse = { workOrders: WorkOrderWithObject[]; total: number };

// Effektiv koordinat för en uppgift (uppgiftens koordinat, annars objektets).
// Returnerar null när giltig koordinat saknas (NaN-säkert).
function woCoords(o: WorkOrderWithObject): { lat: number; lng: number } | null {
  const la = o.taskLatitude ?? o.objectLatitude;
  const lo = o.taskLongitude ?? o.objectLongitude;
  if (la == null || lo == null) return null;
  const lat = Number(la);
  const lng = Number(lo);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function isoWeekString(date: Date): string {
  return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, "0")}`;
}

// Plats (geografisk) för en uppgift — adress i första hand, annars objektnamn.
function taskLocation(o: WorkOrderWithObject): string {
  return o.objectAddress || o.objectName || "Okänd plats";
}

// "Senast utförande" — leveransfönstrets slut, annars start.
function latestDeliveryLabel(o: WorkOrderWithObject): string {
  const raw = o.desiredDeliveryEnd ?? o.desiredDeliveryStart;
  if (!raw) return "Ingen leveranstid satt";
  const d = new Date(raw as unknown as string);
  if (!Number.isFinite(d.getTime())) return "Ingen leveranstid satt";
  return format(d, "d MMM yyyy", { locale: sv });
}

export default function GrovplaneringPage() {
  const { toast } = useToast();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [districtFilter, setDistrictFilter] = useState<string>(ALL_DISTRICTS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignTeam, setAssignTeam] = useState<string>("");
  const [assignWeek, setAssignWeek] = useState<string>(() =>
    isoWeekString(new Date()),
  );

  // Debounce fri-textsöket innan det når servern.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const unplannedQuery = useQuery<UnplannedResponse>({
    queryKey: ["/api/rough-planning/unplanned", { limit: UNPLANNED_PAGE_SIZE, search }],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(UNPLANNED_PAGE_SIZE) });
      if (search) params.set("search", search);
      const res = await apiRequest(
        "GET",
        `/api/rough-planning/unplanned?${params.toString()}`,
      );
      return res.json();
    },
  });
  const teamsQuery = useQuery<Team[]>({ queryKey: ["/api/teams"] });
  const districtsQuery = useQuery<GeographicDistrict[]>({
    queryKey: ["/api/districts"],
  });

  const teams = useMemo(
    () => (teamsQuery.data ?? []).filter((t) => t.status === "active"),
    [teamsQuery.data],
  );
  const districts = districtsQuery.data ?? [];

  const unplanned = unplannedQuery.data?.workOrders ?? [];
  const totalMatching = unplannedQuery.data?.total ?? unplanned.length;
  const truncated = totalMatching > unplanned.length;

  // Distriktsfilter sker på klienten mot uppgiftens districtId.
  const tasks = useMemo(() => {
    if (districtFilter === ALL_DISTRICTS) return unplanned;
    return unplanned.filter((o) => o.districtId === districtFilter);
  }, [unplanned, districtFilter]);

  // Kart-pins: endast uppgifter med giltig koordinat, samma urval som listan.
  const pins = useMemo<UnplannedTaskPin[]>(() => {
    return tasks
      .map((o): UnplannedTaskPin | null => {
        const c = woCoords(o);
        if (!c) return null;
        return {
          id: o.id,
          lat: c.lat,
          lng: c.lng,
          title: o.title || o.id.slice(0, 8),
          reference: o.externalReference,
          address: taskLocation(o),
        };
      })
      .filter((p): p is UnplannedTaskPin => p !== null);
  }, [tasks]);

  const selectedCount = useMemo(
    () => tasks.filter((o) => selectedIds.has(o.id)).length,
    [tasks, selectedIds],
  );
  const allSelected = tasks.length > 0 && selectedCount === tasks.length;
  const someSelected = selectedCount > 0 && !allSelected;

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelectedIds(() => (checked ? new Set(tasks.map((o) => o.id)) : new Set()));
  };

  // Veckoval för tilldelning: aktuell vecka + kommande 11 veckor.
  const weekOptions = useMemo(() => {
    const start = startOfISOWeek(new Date());
    return Array.from({ length: 12 }, (_, i) => {
      const d = addWeeks(start, i);
      return {
        value: isoWeekString(d),
        label: `v.${getISOWeek(d)} · ${format(d, "d MMM", { locale: sv })}`,
      };
    });
  }, []);

  const assignMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/work-orders/bulk-rough-plan", {
        workOrderIds: ids,
        roughPlannedWeek: assignWeek,
        teamId: assignTeam,
      });
      return res.json() as Promise<{
        summary: { total: number; planned: number; error: number };
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/rough-planning/unplanned"],
      });
      setSelectedIds(new Set());
      const teamName = teams.find((t) => t.id === assignTeam)?.name ?? "team";
      const { planned, error } = data.summary;
      toast({
        title: error > 0 ? "Tilldelning delvis klar" : "Uppgifter tilldelade",
        description:
          `${planned} uppgifter tilldelade ${teamName} (${assignWeek})` +
          (error > 0 ? ` · ${error} misslyckades` : ""),
        variant: error > 0 ? "destructive" : undefined,
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Kunde inte tilldela",
        description: e.message,
        variant: "destructive",
      }),
  });

  const handleAssign = () => {
    const ids = tasks.filter((o) => selectedIds.has(o.id)).map((o) => o.id);
    if (ids.length === 0 || !assignTeam) return;
    assignMutation.mutate(ids);
  };

  const isLoading = unplannedQuery.isLoading || teamsQuery.isLoading || districtsQuery.isLoading;
  const isError = unplannedQuery.isError || teamsQuery.isError || districtsQuery.isError;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        icon={CalendarDays}
        title="Grovplanering"
        description="Ej planerade uppgifter — filtrera, se på kartan och tilldela till team."
      />

      {/* Filter: distrikt + sök */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-64">
          <Label htmlFor="filter-district">Distrikt</Label>
          <Select value={districtFilter} onValueChange={setDistrictFilter}>
            <SelectTrigger id="filter-district" className="mt-1" data-testid="select-district-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DISTRICTS}>Alla distrikt</SelectItem>
              {districts.map((d) => (
                <SelectItem key={d.id} value={d.id} data-testid={`option-district-${d.id}`}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <Label htmlFor="filter-search">Sök</Label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="filter-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Sök uppgift, adress eller objekt…"
              className="pl-9"
              data-testid="input-search"
            />
          </div>
        </div>
      </div>

      {/* Tilldelningsrad — visas när uppgifter är markerade */}
      {selectedCount > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2"
          data-testid="assign-bar"
        >
          <span className="text-sm font-medium" data-testid="text-selected-count">
            {selectedCount} markerade
          </span>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <Select value={assignTeam} onValueChange={setAssignTeam}>
              <SelectTrigger className="w-[180px]" data-testid="select-assign-team">
                <SelectValue placeholder="Välj team" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id} data-testid={`option-team-${t.id}`}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Select value={assignWeek} onValueChange={setAssignWeek}>
            <SelectTrigger className="w-[160px]" data-testid="select-assign-week">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weekOptions.map((w) => (
                <SelectItem key={w.value} value={w.value} data-testid={`option-week-${w.value}`}>
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!assignTeam || assignMutation.isPending}
            onClick={handleAssign}
            data-testid="button-assign"
          >
            {assignMutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Tilldela team
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
            data-testid="button-clear-selection"
          >
            Avmarkera
          </Button>
        </div>
      )}

      <QueryState
        isLoading={isLoading}
        isError={isError}
        isEmpty={false}
        error={(unplannedQuery.error || teamsQuery.error || districtsQuery.error) as Error | null}
        onRetry={() => {
          unplannedQuery.refetch();
          teamsQuery.refetch();
          districtsQuery.refetch();
        }}
      >
        {/* Uppgiftslista */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold" data-testid="text-list-title">
                Ej planerade uppgifter ({tasks.length})
              </h2>
              {truncated && (
                <p className="text-xs text-muted-foreground" data-testid="text-truncation-hint">
                  Visar de första {unplanned.length} av {totalMatching} — förfina sökningen för att se fler.
                </p>
              )}
            </div>
            {tasks.length > 0 && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(c) => toggleAll(c === true)}
                  data-testid="checkbox-select-all"
                />
                Markera alla
              </label>
            )}
          </div>

          {tasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground" data-testid="text-empty-list">
              {search || districtFilter !== ALL_DISTRICTS
                ? "Inga uppgifter matchar filtret."
                : "Det finns inga ej planerade uppgifter."}
            </p>
          ) : (
            <div className="space-y-2">
              {tasks.map((o) => {
                const selected = selectedIds.has(o.id);
                return (
                  <div
                    key={o.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleOne(o.id, !selected)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleOne(o.id, !selected);
                      }
                    }}
                    className="hover-elevate flex items-start gap-3 rounded-md border p-3"
                    data-state={selected ? "selected" : undefined}
                    data-testid={`row-uppgift-${o.id}`}
                  >
                    <div className="pointer-events-none pt-0.5">
                      <Checkbox checked={selected} aria-label={`Markera ${o.title}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium" data-testid={`text-uppgift-title-${o.id}`}>
                        {o.externalReference && (
                          <span className="mr-2 text-muted-foreground">
                            {o.externalReference}
                          </span>
                        )}
                        {o.title || o.id.slice(0, 8)}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground" data-testid={`text-uppgift-location-${o.id}`}>
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        {taskLocation(o)}
                      </div>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid={`text-uppgift-delivery-${o.id}`}>
                        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                        Senast: {latestDeliveryLabel(o)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Karta */}
        <section className="mt-6 space-y-3">
          <h2 className="text-lg font-semibold">Karta</h2>
          {pins.length === 0 ? (
            <p className="rounded-md border py-8 text-center text-sm text-muted-foreground" data-testid="text-map-empty">
              Inga uppgifter med koordinater att visa på kartan.
            </p>
          ) : (
            <UnplannedTasksMap pins={pins} />
          )}
        </section>
      </QueryState>
    </div>
  );
}
