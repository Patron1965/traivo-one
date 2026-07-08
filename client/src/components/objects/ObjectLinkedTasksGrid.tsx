import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Layers, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { RoughGridTable } from "@/components/grovplanering/RoughGridTable";
import {
  ROUGH_STATUS_META,
  ROUGH_STATUS_ORDER,
  creationSourceLabel,
  type GridGroup,
  type GridKpis,
  type GridResponse,
  type GridTaskRow,
  type GroupBy,
  type RoughStatus,
} from "@/lib/rough-planning";

const EMPTY_SELECTED = new Map<string, GridTaskRow>();
const noop = () => {};
const ALL = "all";

interface ObjectLinkedTasksGridProps {
  objectId: string;
}

/** Räkna om gruppens KPI:er utifrån de filtrerade raderna så summorna aldrig ljuger. */
function recomputeSummary(tasks: GridTaskRow[]): GridKpis {
  const objectIds = new Set<string>();
  let productionMinutes = 0;
  let value = 0;
  let cost = 0;
  for (const t of tasks) {
    productionMinutes += t.productionMinutes || 0;
    value += t.value || 0;
    cost += t.cost || 0;
    if (t.objectId) objectIds.add(t.objectId);
  }
  return { productionMinutes, value, cost, taskCount: tasks.length, objectCount: objectIds.size };
}

/**
 * Mikro-grovplanering på objektsidan: samma grovplaneringslayout (RoughGridTable)
 * men läsvy, avgränsad till objektets subträd via `?objectId=`. Ingen urvals-/
 * tilldelningslogik — bara bläddring, källa (varifrån uppgiften kommer), filtrering
 * och kollaps per grupp. Full planering sker på /grovplanering.
 *
 * OBS om filtret: uppgiftsraderna (GridTaskRow) bär de fält som faktiskt går att
 * fråga på (status, källa, uppgiftstyp, objekt/kund, fritext). Informationspaketets
 * fältkatalog (shared/uppgift-contract.ts INFORMATIONSPAKET_FALT) är en dokumentations-
 * katalog utan datakonsumenter, så filtret bygger på de närvarande fälten — inte en
 * literal 94-kolumnsfiltrering som saknar underliggande data.
 */
export function ObjectLinkedTasksGrid({ objectId }: ObjectLinkedTasksGridProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const grouping: GroupBy = "objekt";

  const { data, isLoading, isError, refetch, isFetching } = useQuery<GridResponse>({
    queryKey: ["/api/rough-planning/grid", "object", objectId],
    queryFn: async () => {
      const params = new URLSearchParams({
        groupBy: grouping,
        objectId,
        offset: "0",
        limit: "200",
      });
      const res = await apiRequest("GET", `/api/rough-planning/grid?${params.toString()}`);
      return res.json();
    },
    enabled: !!objectId,
  });

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const baseGroups = data?.groups ?? [];

  // Filteralternativ härleds ur faktiskt närvarande rader (aldrig hårdkodade).
  const { statusOptions, sourceOptions, typeOptions } = useMemo(() => {
    const statuses = new Set<RoughStatus>();
    const sources = new Map<string, string>();
    const types = new Map<string, string>();
    for (const g of baseGroups) {
      for (const t of g.tasks) {
        statuses.add(t.status);
        if (t.source) sources.set(t.source, creationSourceLabel(t.source) ?? t.source);
        if (t.taskType) types.set(t.taskType, t.taskTypeLabel || t.taskType);
      }
    }
    return {
      statusOptions: ROUGH_STATUS_ORDER.filter((s) => statuses.has(s)),
      sourceOptions: Array.from(sources.entries()).sort((a, b) => a[1].localeCompare(b[1], "sv")),
      typeOptions: Array.from(types.entries()).sort((a, b) => a[1].localeCompare(b[1], "sv")),
    };
  }, [baseGroups]);

  const hasActiveFilters =
    search.trim() !== "" || statusFilter !== ALL || sourceFilter !== ALL || typeFilter !== ALL;

  const filteredGroups = useMemo<GridGroup[]>(() => {
    if (!hasActiveFilters) return baseGroups;
    const q = search.trim().toLowerCase();
    const matches = (t: GridTaskRow) => {
      if (statusFilter !== ALL && t.status !== statusFilter) return false;
      if (sourceFilter !== ALL && (t.source ?? "") !== sourceFilter) return false;
      if (typeFilter !== ALL && t.taskType !== typeFilter) return false;
      if (q) {
        const hay = [t.title, t.objectName, t.customerName, t.taskTypeLabel]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };
    return baseGroups
      .map((g) => {
        const tasks = g.tasks.filter(matches);
        return { ...g, tasks, summary: recomputeSummary(tasks) };
      })
      .filter((g) => g.tasks.length > 0);
  }, [baseGroups, hasActiveFilters, search, statusFilter, sourceFilter, typeFilter]);

  const clearFilters = () => {
    setSearch("");
    setStatusFilter(ALL);
    setSourceFilter(ALL);
    setTypeFilter(ALL);
  };

  if (isLoading) {
    return (
      <div
        className="flex items-center gap-2 py-8 text-sm text-muted-foreground"
        data-testid="loading-linked-tasks-grid"
      >
        <Loader2 className="h-4 w-4 animate-spin" /> Laddar uppgifter...
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-muted-foreground">Kunde inte ladda uppgifterna.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-linked-tasks">
            Försök igen
          </Button>
        </CardContent>
      </Card>
    );
  }

  const total = data?.pagination?.total ?? 0;

  if (baseGroups.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <Layers className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground" data-testid="empty-linked-tasks-grid">
            Inga uppgifter kopplade till objektet eller dess undernoder.
          </p>
        </CardContent>
      </Card>
    );
  }

  const shownCount = filteredGroups.reduce((n, g) => n + g.tasks.length, 0);

  return (
    <div className="space-y-3" data-testid="linked-tasks-grid">
      {/* Filterrad — bygger på de fält som faktiskt finns på uppgiftsraderna. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök titel, objekt eller kund…"
            className="h-9 pl-8"
            data-testid="input-filter-linked-tasks"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[150px]" data-testid="select-filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alla statusar</SelectItem>
            {statusOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {ROUGH_STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="h-9 w-[150px]" data-testid="select-filter-source">
            <SelectValue placeholder="Källa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alla källor</SelectItem>
            {sourceOptions.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-9 w-[170px]" data-testid="select-filter-type">
            <SelectValue placeholder="Uppgiftstyp" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alla uppgiftstyper</SelectItem>
            {typeOptions.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={clearFilters}
            data-testid="button-clear-filters-linked-tasks"
          >
            <X className="mr-1 h-4 w-4" /> Rensa filter
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
        <span data-testid="text-linked-tasks-count">
          {hasActiveFilters
            ? `${shownCount} av ${total} ${total === 1 ? "uppgift" : "uppgifter"}`
            : `${total} ${total === 1 ? "uppgift" : "uppgifter"} i objektets träd`}
        </span>
        {data?.truncated && !hasActiveFilters && (
          <span>(visar de första {baseGroups.reduce((n, g) => n + g.tasks.length, 0)})</span>
        )}
      </div>

      {filteredGroups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Layers className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground" data-testid="empty-linked-tasks-filtered">
              Inga uppgifter matchar filtret.
            </p>
            <Button variant="outline" size="sm" onClick={clearFilters} data-testid="button-clear-filters-empty">
              Rensa filter
            </Button>
          </CardContent>
        </Card>
      ) : (
        <RoughGridTable
          groups={filteredGroups}
          grouping={grouping}
          selected={EMPTY_SELECTED}
          collapsed={collapsed}
          onToggleRow={noop}
          onToggleGroup={noop}
          onToggleCollapse={toggleCollapse}
          onToggleAllVisible={noop}
          allVisibleSelected={false}
          onAssignRow={noop}
          onRevokeRow={noop}
          readOnly
        />
      )}
    </div>
  );
}
