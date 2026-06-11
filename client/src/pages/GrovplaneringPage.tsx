import { useEffect, useMemo, useState } from "react";
import {
  useQuery,
  useMutation,
  keepPreviousData,
} from "@tanstack/react-query";
import {
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCcw,
  Users,
  XCircle,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RoughSummaryCard } from "@/components/grovplanering/RoughSummaryCard";
import {
  RoughFilterPanel,
  createDefaultFilter,
  type FilterState,
} from "@/components/grovplanering/RoughFilterPanel";
import { RoughGridTable } from "@/components/grovplanering/RoughGridTable";
import { RoughAssignModal } from "@/components/grovplanering/RoughAssignModal";
import {
  ROUGH_STATUS_ORDER,
  ROUGH_STATUS_META,
  resolvePeriodRange,
  formatCount,
  type GridResponse,
  type GridTaskRow,
  type GridGroup,
  type GridKpis,
  type GroupBy,
  type RoughStatus,
} from "@/lib/rough-planning";
import type { Team, GeographicDistrict } from "@shared/schema";

interface AppliedFilter {
  districtIds: string[];
  teamIds: string[];
  postalCode: string;
  city: string;
  from?: string;
  to?: string;
  taskTypes: string[];
  statuses: RoughStatus[];
}

const EMPTY_APPLIED: AppliedFilter = {
  districtIds: [],
  teamIds: [],
  postalCode: "",
  city: "",
  taskTypes: [],
  statuses: [],
};

const EMPTY_KPIS: GridKpis = {
  productionMinutes: 0,
  value: 0,
  cost: 0,
  taskCount: 0,
  objectCount: 0,
};

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "objekt", label: "Objekt" },
  { value: "kund", label: "Kund" },
  { value: "orderkoncept", label: "Orderkoncept" },
  { value: "ingen", label: "Ingen" },
];

function buildFilterParams(applied: AppliedFilter, groupBy: GroupBy): URLSearchParams {
  const p = new URLSearchParams();
  p.set("groupBy", groupBy);
  if (applied.districtIds.length) p.set("districtIds", applied.districtIds.join(","));
  if (applied.teamIds.length) p.set("teamIds", applied.teamIds.join(","));
  if (applied.postalCode) p.set("postalCode", applied.postalCode);
  if (applied.city) p.set("city", applied.city);
  if (applied.from) p.set("from", applied.from);
  if (applied.to) p.set("to", applied.to);
  if (applied.taskTypes.length) p.set("taskTypes", applied.taskTypes.join(","));
  if (applied.statuses.length) p.set("statuses", applied.statuses.join(","));
  return p;
}

function buildGridUrl(
  applied: AppliedFilter,
  groupBy: GroupBy,
  offset: number,
  limit: number,
): string {
  const p = buildFilterParams(applied, groupBy);
  p.set("offset", String(offset));
  p.set("limit", String(limit));
  return `/api/rough-planning/grid?${p.toString()}`;
}

function pageWindow(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "ellipsis")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("ellipsis");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

export default function GrovplaneringPage() {
  const { toast } = useToast();

  const [groupBy, setGroupBy] = useState<GroupBy>("objekt");
  const [pageSize, setPageSize] = useState(20);
  const [offset, setOffset] = useState(0);

  const [draft, setDraft] = useState<FilterState>(createDefaultFilter);
  const [applied, setApplied] = useState<AppliedFilter>(EMPTY_APPLIED);

  const [selected, setSelected] = useState<Map<string, GridTaskRow>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [assignTarget, setAssignTarget] = useState<GridTaskRow[] | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<
    { ids: string[]; label: string } | null
  >(null);

  // Referensdata.
  const { data: teams = [] } = useQuery<Team[]>({ queryKey: ["/api/teams"] });
  const { data: districts = [] } = useQuery<GeographicDistrict[]>({
    queryKey: ["/api/districts"],
  });
  const { data: cities = [] } = useQuery<string[]>({
    queryKey: ["/api/rough-planning/cities"],
  });

  // Rutnät.
  const gridUrl = buildGridUrl(applied, groupBy, offset, pageSize);
  const {
    data,
    isLoading,
    isError,
    isFetching,
  } = useQuery<GridResponse>({
    queryKey: ["/api/rough-planning/grid", applied, groupBy, offset, pageSize],
    queryFn: async () => (await apiRequest("GET", gridUrl)).json(),
    placeholderData: keepPreviousData,
  });

  const groups: GridGroup[] = data?.groups ?? [];
  const total = data?.pagination.total ?? 0;
  const summary = data?.summary ?? EMPTY_KPIS;

  // Selektion.
  const visibleRows = useMemo(
    () => groups.flatMap((g) => g.tasks),
    [groups],
  );
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id));

  const toggleRow = (row: GridTaskRow) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row);
      return next;
    });

  const toggleGroup = (group: GridGroup, checked: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const t of group.tasks) {
        if (checked) next.set(t.id, t);
        else next.delete(t.id);
      }
      return next;
    });

  // "Markera grupp": markera ALLA rader i gruppen över alla sidor (Task #922).
  // Hämtar hela gruppens rader serverside (samma filter/gruppering) och slår ihop
  // dem i urvalet — inte bara den synliga sidans rader.
  const [selectingGroupKey, setSelectingGroupKey] = useState<string | null>(null);
  const selectWholeGroup = async (group: GridGroup) => {
    setSelectingGroupKey(group.key);
    try {
      const p = buildFilterParams(applied, groupBy);
      p.set("groupKey", group.key);
      const res = await apiRequest(
        "GET",
        `/api/rough-planning/group-rows?${p.toString()}`,
      );
      const data = (await res.json()) as { rows: GridTaskRow[] };
      setSelected((prev) => {
        const next = new Map(prev);
        for (const r of data.rows) next.set(r.id, r);
        return next;
      });
    } catch (err) {
      toast({
        title: "Kunde inte markera gruppen",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSelectingGroupKey(null);
    }
  };

  const toggleAllVisible = (checked: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const r of visibleRows) {
        if (checked) next.set(r.id, r);
        else next.delete(r.id);
      }
      return next;
    });

  const clearSelection = () => setSelected(new Map());

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectionKpis: GridKpis = useMemo(() => {
    const objs = new Set<string>();
    let pm = 0;
    let v = 0;
    let c = 0;
    for (const r of Array.from(selected.values())) {
      pm += r.productionMinutes;
      v += r.value;
      c += r.cost;
      if (r.objectId) objs.add(r.objectId);
    }
    return {
      productionMinutes: pm,
      value: v,
      cost: c,
      taskCount: selected.size,
      objectCount: objs.size,
    };
  }, [selected]);

  const selectedTilldeladCount = useMemo(
    () =>
      Array.from(selected.values()).filter((r) => r.status === "tilldelad")
        .length,
    [selected],
  );

  // Filter apply/clear.
  const applyFilters = () => {
    const { from, to } = resolvePeriodRange(
      draft.periodMode,
      new Date(draft.anchor),
      draft.rangeFrom,
      draft.rangeTo,
    );
    setApplied({
      districtIds: draft.districtIds,
      teamIds: draft.teamIds,
      postalCode: draft.postalCode.trim(),
      city: draft.city,
      from,
      to,
      taskTypes: draft.taskTypes,
      statuses: draft.statuses,
    });
    setOffset(0);
  };

  const clearFilters = () => {
    setDraft(createDefaultFilter());
    setApplied(EMPTY_APPLIED);
    setOffset(0);
  };

  // Återställ sida vid grupperings-/sidstorleksbyte.
  useEffect(() => {
    setOffset(0);
  }, [groupBy, pageSize]);

  // Mutationer.
  const assignMutation = useMutation({
    mutationFn: async (vars: {
      ids: string[];
      week: string;
      teamId: string;
      kommentar: string;
    }) => {
      const res = await apiRequest("POST", "/api/work-orders/bulk-rough-plan", {
        workOrderIds: vars.ids,
        roughPlannedWeek: vars.week,
        teamId: vars.teamId,
        kommentar: vars.kommentar || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Uppgifter tilldelade" });
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      clearSelection();
      setAssignTarget(null);
    },
    onError: (err: Error) => {
      toast({
        title: "Kunde inte tilldela",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/rough-planning/revoke", {
        workOrderIds: ids,
      });
      return res.json() as Promise<{ updated: number; skipped: number }>;
    },
    onSuccess: (result) => {
      toast({
        title: "Tilldelning återkallad",
        description:
          result.skipped > 0
            ? `${result.updated} återkallade, ${result.skipped} hoppades över (ej tilldelade).`
            : `${result.updated} återkallade.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/grid"] });
      clearSelection();
      setRevokeTarget(null);
    },
    onError: (err: Error) => {
      toast({
        title: "Kunde inte återkalla",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + pageSize, total);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        icon={CalendarRange}
        title="Grovplanering"
        description="Filtrera, gruppera och tilldela uppgifter till team och veckor."
      />

      {/* Summeringskort */}
      <div className="grid gap-3 lg:grid-cols-2">
        <RoughSummaryCard
          title="Summering — enligt filter"
          kpis={summary}
          variant="filter"
          testIdPrefix="summary-filter"
        />
        <RoughSummaryCard
          title="Summering — markerade"
          kpis={selectionKpis}
          variant="selection"
          testIdPrefix="summary-selection"
        />
      </div>

      {/* Filterpanel */}
      <RoughFilterPanel
        value={draft}
        onChange={setDraft}
        districts={districts.map((d) => ({ id: d.id, name: d.name }))}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        cities={cities}
        onApply={applyFilters}
        onClear={clearFilters}
        isFetching={isFetching}
      />

      {/* Gruppering & Åtgärder */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Gruppera per:</span>
            <RadioGroup
              value={groupBy}
              onValueChange={(v) => setGroupBy(v as GroupBy)}
              className="flex flex-wrap items-center gap-4"
              data-testid="radiogroup-groupby"
            >
              {GROUP_OPTIONS.map((o) => (
                <div key={o.value} className="flex items-center gap-1.5">
                  <RadioGroupItem
                    value={o.value}
                    id={`group-${o.value}`}
                    data-testid={`radio-group-${o.value}`}
                  />
                  <Label
                    htmlFor={`group-${o.value}`}
                    className="cursor-pointer text-sm font-normal"
                  >
                    {o.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-sm text-muted-foreground"
              data-testid="text-selection-count"
            >
              {formatCount(selected.size)} markerade
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={visibleRows.length === 0}
              onClick={() => toggleAllVisible(true)}
              data-testid="button-select-all"
            >
              Markera alla
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={selected.size === 0}
              onClick={clearSelection}
              data-testid="button-clear-selection"
            >
              <XCircle className="h-4 w-4" />
              Avmarkera alla
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={groups.length === 0}
                  data-testid="button-select-group"
                >
                  Markera grupp
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-72 w-64 overflow-y-auto"
              >
                {groups.map((g) => (
                  <DropdownMenuItem
                    key={g.key}
                    onClick={() => selectWholeGroup(g)}
                    disabled={selectingGroupKey !== null}
                    data-testid={`menuitem-select-group-${g.key}`}
                  >
                    <span className="truncate">{g.label}</span>
                    <span className="ml-auto flex items-center gap-1.5 pl-3 text-xs text-muted-foreground">
                      {selectingGroupKey === g.key && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {formatCount(g.summary.taskCount)}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="outline"
              disabled={selectedTilldeladCount === 0}
              onClick={() =>
                setRevokeTarget({
                  ids: Array.from(selected.values())
                    .filter((r) => r.status === "tilldelad")
                    .map((r) => r.id),
                  label: `${selectedTilldeladCount} markerade`,
                })
              }
              data-testid="button-revoke-selected"
            >
              <RotateCcw className="h-4 w-4" />
              Återkalla tilldelning
            </Button>
            <Button
              size="sm"
              disabled={selected.size === 0}
              onClick={() => setAssignTarget(Array.from(selected.values()))}
              data-testid="button-assign-selected"
            >
              <Users className="h-4 w-4" />
              Tilldela markerade
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Rutnät */}
      {isLoading ? (
        <div className="flex items-center justify-center rounded-lg border py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Laddar uppgifter…
        </div>
      ) : isError ? (
        <div className="rounded-lg border py-16 text-center text-destructive" data-testid="text-grid-error">
          Kunde inte ladda uppgifter. Försök igen.
        </div>
      ) : (
        <>
          {data?.truncated && (
            <p className="text-xs text-warning" data-testid="text-truncated-warning">
              Visar de första 10 000 uppgifterna. Förfina filtret för fullständigt resultat.
            </p>
          )}
          <RoughGridTable
            groups={groups}
            grouping={data?.grouping ?? groupBy}
            selected={selected}
            collapsed={collapsed}
            onToggleRow={toggleRow}
            onToggleGroup={toggleGroup}
            onToggleCollapse={toggleCollapse}
            onToggleAllVisible={toggleAllVisible}
            allVisibleSelected={allVisibleSelected}
            onAssignRow={(row) => setAssignTarget([row])}
            onRevokeRow={(row) =>
              setRevokeTarget({
                ids: [row.id],
                label: row.objectName ?? row.title ?? "uppgift",
              })
            }
          />

          {/* Paginering + legend */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span data-testid="text-pagination-range">
                Visar {formatCount(rangeStart)}–{formatCount(rangeEnd)} av{" "}
                {formatCount(total)} uppgifter
              </span>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => setPageSize(Number(v))}
              >
                <SelectTrigger className="h-8 w-[110px]" data-testid="select-pagesize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[20, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}/sida
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={currentPage <= 1}
                  onClick={() => setOffset(Math.max(0, offset - pageSize))}
                  data-testid="button-page-prev"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {pageWindow(currentPage, totalPages).map((p, i) =>
                  p === "ellipsis" ? (
                    <span key={`e-${i}`} className="px-1 text-muted-foreground">
                      …
                    </span>
                  ) : (
                    <Button
                      key={p}
                      size="icon"
                      variant={p === currentPage ? "default" : "outline"}
                      className="h-8 w-8 tabular-nums"
                      onClick={() => setOffset((p - 1) * pageSize)}
                      data-testid={`button-page-${p}`}
                    >
                      {p}
                    </Button>
                  ),
                )}
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={currentPage >= totalPages}
                  onClick={() => setOffset(offset + pageSize)}
                  data-testid="button-page-next"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Statuslegend */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/30 p-3">
        <span className="text-xs font-medium text-muted-foreground">Status:</span>
        {ROUGH_STATUS_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-xs">
            <span
              className={
                "inline-block h-2.5 w-2.5 rounded-full " + ROUGH_STATUS_META[s].dot
              }
            />
            {ROUGH_STATUS_META[s].label}
          </span>
        ))}
      </div>

      {/* Tilldela-modal */}
      <RoughAssignModal
        open={assignTarget !== null}
        onOpenChange={(o) => !o && setAssignTarget(null)}
        selectedRows={assignTarget ?? []}
        teams={teams}
        isPending={assignMutation.isPending}
        onSubmit={({ teamId, week, kommentar }) =>
          assignMutation.mutate({
            ids: (assignTarget ?? []).map((r) => r.id),
            week,
            teamId,
            kommentar,
          })
        }
      />

      {/* Återkalla-bekräftelse */}
      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
      >
        <AlertDialogContent data-testid="dialog-revoke">
          <AlertDialogHeader>
            <AlertDialogTitle>Återkalla tilldelning?</AlertDialogTitle>
            <AlertDialogDescription>
              Detta tar bort team, vecka och kommentar för {revokeTarget?.label}.
              Endast uppgifter med status “Tilldelad” påverkas — utförda eller
              avvikande uppgifter lämnas orörda.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-revoke-cancel">
              Avbryt
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.ids)}
              data-testid="button-revoke-confirm"
            >
              Återkalla
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
