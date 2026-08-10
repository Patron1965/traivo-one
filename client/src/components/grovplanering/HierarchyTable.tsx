/**
 * Navet – 3-nivå kollapsbar hierarki (Task #1283)
 * Ruttklump (L1) → Stoppklump (L2) → Uppgift (L3)
 *
 * Klick på L1/L2-rad → öppnar ClusterSidePanel.
 * Chevron-knapp → expanderar/kollapserar nivån.
 * Uppgifter utan ruttklump → platta L3-rader nedanför trädstrukturen.
 */
import { useState, useMemo, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Route,
  MapPin,
  MoreVertical,
  UserPlus,
  RotateCcw,
  Map as MapIcon,
} from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatSekFromOre } from "@/lib/format";
import {
  ROUGH_STATUS_META,
  ROUGH_STATUS_ORDER,
  formatHours,
  formatDateShort,
  clusterDeliveryRange,
  buildHierarchy,
  computeMargin,
  formatMargin,
  type GridTaskRow,
  type HierarchyL1Route,
  type HierarchyL2Stop,
  type HierarchyKpis,
} from "@/lib/rough-planning";
import type { ClusterRef } from "@/components/clustering/ClusterSidePanel";

/** 10 kolumner: chevron/check | Utförandetyp | Namn | Leveranstid | Uppgifter | Prod.tid | Värde | Marginal | Status | Åtgärder */
const COL_COUNT = 10;

interface HierarchyTableProps {
  tasks: GridTaskRow[];
  selected: Map<string, GridTaskRow>;
  onToggleRow: (row: GridTaskRow) => void;
  onAssignRow: (row: GridTaskRow) => void;
  onRevokeRow: (row: GridTaskRow) => void;
  onOpenCluster?: (ref: ClusterRef) => void;
  onAssignCluster?: (tasks: GridTaskRow[]) => void;
  onRevokeCluster?: (tasks: GridTaskRow[]) => void;
  onGoToMap?: (clusterRef?: ClusterRef) => void;
}

// ---------------------------------------------------------------------------
// Sortering
// ---------------------------------------------------------------------------
type SortKey = "leveranstid" | "tid" | "varde" | "marginal";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="h-3 w-3 ml-1 opacity-40" />;
  return sortDir === "asc"
    ? <ChevronUp className="h-3 w-3 ml-1" />
    : <ChevronDown className="h-3 w-3 ml-1" />;
}

function sortedTaskList(tasks: GridTaskRow[], sortKey: SortKey | null, sortDir: SortDir): GridTaskRow[] {
  if (!sortKey) return tasks;
  return [...tasks].sort((a, b) => {
    let av: number | string | null, bv: number | string | null;
    switch (sortKey) {
      case "leveranstid": av = a.desiredDeliveryStart; bv = b.desiredDeliveryStart; break;
      case "tid": av = a.productionMinutes; bv = b.productionMinutes; break;
      case "varde": av = a.value; bv = b.value; break;
      case "marginal": av = a.value - a.cost; bv = b.value - b.cost; break;
    }
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });
}

// ---------------------------------------------------------------------------
// Utförandetyp-aggregering per klumpad nivå (L1/L2)
// ---------------------------------------------------------------------------
function aggregateExecutionCode(tasks: GridTaskRow[]): string {
  const codes = [...new Set(tasks.map((t) => t.executionCode).filter(Boolean) as string[])];
  if (codes.length === 0) return "–";
  if (codes.length === 1) return codes[0];
  return `${codes[0]} +${codes.length - 1}`;
}

// ---------------------------------------------------------------------------
// StatusDots — bubble-up statusvisning
// ---------------------------------------------------------------------------
function StatusDots({ tasks }: { tasks: GridTaskRow[] }) {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  }
  const present = ROUGH_STATUS_ORDER.filter((s) => counts.has(s));
  if (present.length === 0) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {present.map((s) => {
        const meta = ROUGH_STATUS_META[s];
        return (
          <span
            key={s}
            className="flex items-center gap-1 text-xs text-muted-foreground"
            title={meta.label}
          >
            <span className={cn("inline-block h-2 w-2 rounded-full shrink-0", meta.dot)} />
            {counts.get(s)}
          </span>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KpiCells — aggregerade kolumner (Uppgifter | Prod.tid | Värde | Marginal)
// ---------------------------------------------------------------------------
function KpiCells({ kpis }: { kpis: HierarchyKpis }) {
  const margin = computeMargin(kpis.value, kpis.cost);
  return (
    <>
      <TableCell className="whitespace-nowrap text-right tabular-nums text-sm font-medium">
        {kpis.taskCount}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums text-sm">
        {formatHours(kpis.productionMinutes)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums text-sm">
        {formatSekFromOre(kpis.value)}
      </TableCell>
      <TableCell
        className={cn(
          "whitespace-nowrap text-right tabular-nums text-sm",
          margin !== null && margin < 0 ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {formatMargin(margin)}
      </TableCell>
    </>
  );
}

// ---------------------------------------------------------------------------
// RouteRow — L1 ruttklump
// ---------------------------------------------------------------------------
function RouteRow({
  route,
  expanded,
  onToggleExpand,
  onOpenCluster,
  onAssignCluster,
  onRevokeCluster,
  onGoToMap,
}: {
  route: HierarchyL1Route;
  expanded: boolean;
  onToggleExpand: (e: React.MouseEvent) => void;
  onOpenCluster?: (ref: ClusterRef) => void;
  onAssignCluster?: (tasks: GridTaskRow[]) => void;
  onRevokeCluster?: (tasks: GridTaskRow[]) => void;
  onGoToMap?: (ref?: ClusterRef) => void;
}) {
  const allTasks = route.stopClusters.flatMap((s) => s.tasks);
  const assignedTasks = allTasks.filter((t) => t.status === "tilldelad");
  const clusterRef: ClusterRef = { type: "route", id: route.id };

  const handleRowClick = () => {
    if (onOpenCluster) onOpenCluster(clusterRef);
  };

  return (
    <TableRow
      className={cn(
        "bg-muted/40 hover:bg-muted/60",
        onOpenCluster && "cursor-pointer",
      )}
      data-testid={`row-route-${route.id}`}
      onClick={handleRowClick}
    >
      <TableCell className="w-9" onClick={(e) => e.stopPropagation()}>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          tabIndex={-1}
          onClick={onToggleExpand}
          data-testid={`button-route-expand-${route.id}`}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {aggregateExecutionCode(allTasks)}
      </TableCell>
      <TableCell className="min-w-[200px]">
        <div className="flex items-center gap-2">
          <Route className="h-3.5 w-3.5 shrink-0 text-chart-4" />
          <span
            className="font-semibold text-sm truncate"
            data-testid={`text-route-name-${route.id}`}
          >
            {route.displayName}
          </span>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {clusterDeliveryRange(allTasks)}
      </TableCell>
      <KpiCells kpis={route.kpis} />
      <TableCell>
        <StatusDots tasks={allTasks} />
      </TableCell>
      <TableCell className="w-9" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              data-testid={`button-route-actions-${route.id}`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onAssignCluster && allTasks.length > 0 && (
              <DropdownMenuItem
                onClick={() => onAssignCluster(allTasks)}
                data-testid={`action-route-assign-${route.id}`}
              >
                <UserPlus className="h-4 w-4" />
                Tilldela alla ({route.kpis.taskCount})…
              </DropdownMenuItem>
            )}
            {onRevokeCluster && assignedTasks.length > 0 && (
              <DropdownMenuItem
                onClick={() => onRevokeCluster(assignedTasks)}
                data-testid={`action-route-revoke-${route.id}`}
              >
                <RotateCcw className="h-4 w-4" />
                Återkalla tilldelade ({assignedTasks.length})…
              </DropdownMenuItem>
            )}
            {onGoToMap && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onGoToMap(clusterRef)}
                  data-testid={`action-route-map-${route.id}`}
                >
                  <MapIcon className="h-4 w-4" />
                  Visa på karta
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// StopRow — L2 stoppklump
// ---------------------------------------------------------------------------
function StopRow({
  stop,
  expanded,
  onToggleExpand,
  onOpenCluster,
  onAssignCluster,
  onRevokeCluster,
  onGoToMap,
}: {
  stop: HierarchyL2Stop;
  expanded: boolean;
  onToggleExpand: (e: React.MouseEvent) => void;
  onOpenCluster?: (ref: ClusterRef) => void;
  onAssignCluster?: (tasks: GridTaskRow[]) => void;
  onRevokeCluster?: (tasks: GridTaskRow[]) => void;
  onGoToMap?: (ref?: ClusterRef) => void;
}) {
  const assignedTasks = stop.tasks.filter((t) => t.status === "tilldelad");
  const clusterRef: ClusterRef | undefined = stop.id
    ? { type: "stop", id: stop.id }
    : undefined;

  const handleRowClick = () => {
    if (stop.id && onOpenCluster) onOpenCluster({ type: "stop", id: stop.id });
  };

  return (
    <TableRow
      className={cn(
        "bg-muted/20 hover:bg-muted/40",
        stop.id && onOpenCluster && "cursor-pointer",
      )}
      data-testid={`row-stop-${stop.id ?? "ungrouped"}`}
      onClick={handleRowClick}
    >
      <TableCell className="w-9" onClick={(e) => e.stopPropagation()}>
        <div className="pl-5">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            tabIndex={-1}
            onClick={onToggleExpand}
            data-testid={`button-stop-expand-${stop.id ?? "ungrouped"}`}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {aggregateExecutionCode(stop.tasks)}
      </TableCell>
      <TableCell className="min-w-[200px]">
        <div className="flex items-center gap-2 pl-5">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-chart-4" />
          <span
            className="text-sm truncate"
            data-testid={`text-stop-name-${stop.id ?? "ungrouped"}`}
          >
            {stop.displayName || <span className="italic text-muted-foreground">Utan stoppklump</span>}
          </span>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {clusterDeliveryRange(stop.tasks)}
      </TableCell>
      <KpiCells kpis={stop.kpis} />
      <TableCell>
        <StatusDots tasks={stop.tasks} />
      </TableCell>
      <TableCell className="w-9" onClick={(e) => e.stopPropagation()}>
        {(stop.id || onAssignCluster || onGoToMap) && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                data-testid={`button-stop-actions-${stop.id ?? "ungrouped"}`}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onAssignCluster && stop.tasks.length > 0 && (
                <DropdownMenuItem
                  onClick={() => onAssignCluster(stop.tasks)}
                  data-testid={`action-stop-assign-${stop.id ?? "ungrouped"}`}
                >
                  <UserPlus className="h-4 w-4" />
                  Tilldela alla ({stop.kpis.taskCount})…
                </DropdownMenuItem>
              )}
              {onRevokeCluster && assignedTasks.length > 0 && (
                <DropdownMenuItem
                  onClick={() => onRevokeCluster(assignedTasks)}
                  data-testid={`action-stop-revoke-${stop.id ?? "ungrouped"}`}
                >
                  <RotateCcw className="h-4 w-4" />
                  Återkalla tilldelade ({assignedTasks.length})…
                </DropdownMenuItem>
              )}
              {onGoToMap && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onGoToMap(clusterRef)}
                    data-testid={`action-stop-map-${stop.id ?? "ungrouped"}`}
                  >
                    <MapIcon className="h-4 w-4" />
                    Visa på karta
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// TaskRow — L3 enskild uppgift (indenterad under stopp ELLER platt/oklämmad)
// ---------------------------------------------------------------------------
function TaskRow({
  row,
  selected,
  onToggleRow,
  onAssignRow,
  onRevokeRow,
  indentLevel,
}: {
  row: GridTaskRow;
  selected: boolean;
  onToggleRow: (row: GridTaskRow) => void;
  onAssignRow: (row: GridTaskRow) => void;
  onRevokeRow: (row: GridTaskRow) => void;
  indentLevel: 0 | 1 | 2;
}) {
  const meta = ROUGH_STATUS_META[row.status];
  const margin = computeMargin(row.value, row.cost);
  const indentPx = indentLevel === 2 ? "pl-[3.5rem]" : indentLevel === 1 ? "pl-[1.75rem]" : "pl-1";

  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      data-testid={`row-task-hier-${row.id}`}
    >
      <TableCell className="w-9">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleRow(row)}
          data-testid={`check-hier-task-${row.id}`}
        />
      </TableCell>
      {/* Utförandetyp — L3 */}
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {row.executionCode ?? row.articleTypeLabel ?? "–"}
      </TableCell>
      <TableCell className="min-w-[220px]">
        <div className={indentPx}>
          <div className="font-medium text-sm truncate">
            {row.objectName ?? row.title ?? "–"}
          </div>
          {row.title && row.objectName && (
            <div className="text-xs text-muted-foreground truncate">{row.title}</div>
          )}
          {row.teamName && (
            <div className="flex items-center gap-1 mt-0.5">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: row.teamColor ?? undefined }}
              />
              <span className="text-[11px] text-muted-foreground">{row.teamName}</span>
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {formatDateShort(row.desiredDeliveryStart)}
      </TableCell>
      <TableCell />
      <TableCell className="whitespace-nowrap text-right tabular-nums text-sm">
        {formatHours(row.productionMinutes)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums text-sm">
        {formatSekFromOre(row.value)}
      </TableCell>
      <TableCell
        className={cn(
          "whitespace-nowrap text-right tabular-nums text-sm",
          margin !== null && margin < 0 ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {formatMargin(margin)}
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-1.5">
          <span className={cn("inline-block h-2 w-2 rounded-full shrink-0", meta.dot)} />
          <span className="text-xs">{meta.label}</span>
        </span>
      </TableCell>
      <TableCell className="w-9">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              data-testid={`button-hier-task-actions-${row.id}`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => onAssignRow(row)}
              data-testid={`action-hier-assign-${row.id}`}
            >
              <UserPlus className="h-4 w-4" />
              Tilldela…
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={row.status !== "tilldelad"}
              onClick={() => onRevokeRow(row)}
              data-testid={`action-hier-revoke-${row.id}`}
            >
              <RotateCcw className="h-4 w-4" />
              Återkalla tilldelning
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// HierarchyTable — huvudkomponent
// ---------------------------------------------------------------------------
export function HierarchyTable({
  tasks,
  selected,
  onToggleRow,
  onAssignRow,
  onRevokeRow,
  onOpenCluster,
  onAssignCluster,
  onRevokeCluster,
  onGoToMap,
}: HierarchyTableProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = useCallback((col: SortKey) => {
    setSortKey((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return col;
      }
      setSortDir("asc");
      return col;
    });
  }, []);

  const sortedTasks = useMemo(
    () => sortedTaskList(tasks, sortKey, sortDir),
    [tasks, sortKey, sortDir],
  );

  const { routes, unclusteredTasks } = useMemo(
    () => buildHierarchy(sortedTasks),
    [sortedTasks],
  );

  const [collapsedRoutes, setCollapsedRoutes] = useState<Set<string>>(new Set());
  const [collapsedStops, setCollapsedStops] = useState<Set<string>>(new Set());

  const toggleRoute = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleStop = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedStops((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (tasks.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border py-16 text-muted-foreground"
        data-testid="text-hierarchy-empty"
      >
        Inga uppgifter matchar nuvarande filter.
      </div>
    );
  }

  const routeCount = routes.length;
  const stopCount = routes.reduce(
    (n, r) => n + r.stopClusters.filter((s) => s.id !== null).length,
    0,
  );

  return (
    <div className="overflow-x-auto rounded-lg border" data-testid="table-hierarchy">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-9" />
            <TableHead className="whitespace-nowrap">Utförandetyp</TableHead>
            <TableHead>Namn</TableHead>
            <TableHead
              className="whitespace-nowrap cursor-pointer select-none hover:text-foreground"
              onClick={() => handleSort("leveranstid")}
            >
              <span className="flex items-center">
                Leveranstid
                <SortIcon col="leveranstid" sortKey={sortKey} sortDir={sortDir} />
              </span>
            </TableHead>
            <TableHead className="whitespace-nowrap text-right">Uppgifter</TableHead>
            <TableHead
              className="whitespace-nowrap text-right cursor-pointer select-none hover:text-foreground"
              onClick={() => handleSort("tid")}
            >
              <span className="flex items-center justify-end">
                Prod.tid
                <SortIcon col="tid" sortKey={sortKey} sortDir={sortDir} />
              </span>
            </TableHead>
            <TableHead
              className="whitespace-nowrap text-right cursor-pointer select-none hover:text-foreground"
              onClick={() => handleSort("varde")}
            >
              <span className="flex items-center justify-end">
                Värde
                <SortIcon col="varde" sortKey={sortKey} sortDir={sortDir} />
              </span>
            </TableHead>
            <TableHead
              className="whitespace-nowrap text-right cursor-pointer select-none hover:text-foreground"
              onClick={() => handleSort("marginal")}
            >
              <span className="flex items-center justify-end">
                Marginal
                <SortIcon col="marginal" sortKey={sortKey} sortDir={sortDir} />
              </span>
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-9" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* L1/L2/L3 — uppgifter med ruttklump */}
          {routes.map((route) => {
            const routeKey = route.id;
            const routeExpanded = !collapsedRoutes.has(routeKey);

            return [
              <RouteRow
                key={`route-${routeKey}`}
                route={route}
                expanded={routeExpanded}
                onToggleExpand={(e) => toggleRoute(routeKey, e)}
                onOpenCluster={onOpenCluster}
                onAssignCluster={onAssignCluster}
                onRevokeCluster={onRevokeCluster}
                onGoToMap={onGoToMap}
              />,
              ...(routeExpanded
                ? route.stopClusters.flatMap((stop) => {
                    const stopKey = `${routeKey}__${stop.id ?? "__nostop__"}`;
                    const stopExpanded = !collapsedStops.has(stopKey);

                    return [
                      <StopRow
                        key={`stop-${stopKey}`}
                        stop={stop}
                        expanded={stopExpanded}
                        onToggleExpand={(e) => toggleStop(stopKey, e)}
                        onOpenCluster={onOpenCluster}
                        onAssignCluster={onAssignCluster}
                        onRevokeCluster={onRevokeCluster}
                        onGoToMap={onGoToMap}
                      />,
                      ...(stopExpanded
                        ? stop.tasks.map((row) => (
                            <TaskRow
                              key={`task-${row.id}`}
                              row={row}
                              selected={selected.has(row.id)}
                              onToggleRow={onToggleRow}
                              onAssignRow={onAssignRow}
                              onRevokeRow={onRevokeRow}
                              indentLevel={2}
                            />
                          ))
                        : []),
                    ];
                  })
                : []),
            ];
          })}

          {/* Platta L3-rader — uppgifter utan ruttklump */}
          {unclusteredTasks.length > 0 && (
            <>
              {routes.length > 0 && (
                <TableRow>
                  <TableCell
                    colSpan={COL_COUNT}
                    className="py-1 px-3 text-xs text-muted-foreground bg-muted/10 border-t"
                  >
                    Utan klumptillhörighet ({unclusteredTasks.length})
                  </TableCell>
                </TableRow>
              )}
              {unclusteredTasks.map((row) => (
                <TaskRow
                  key={`task-unc-${row.id}`}
                  row={row}
                  selected={selected.has(row.id)}
                  onToggleRow={onToggleRow}
                  onAssignRow={onAssignRow}
                  onRevokeRow={onRevokeRow}
                  indentLevel={0}
                />
              ))}
            </>
          )}
        </TableBody>
      </Table>
      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        {tasks.length} uppgifter · {routeCount} ruttförslag · {stopCount} stoppklumpar
        {unclusteredTasks.length > 0 && ` · ${unclusteredTasks.length} utan klump`}
      </div>
    </div>
  );
}
