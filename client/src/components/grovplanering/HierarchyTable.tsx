/**
 * Navet – 3-nivå kollapsbar hierarki (Task #1283)
 * Ruttklump (L1) → Stoppklump (L2) → Uppgift (L3)
 *
 * Data byggs klient-sidan via buildHierarchy() från en platt lista med
 * GridTaskRow som har routeClusterId/stopClusterId-fält ifyllda av API:t.
 */
import { useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  Route,
  MapPin,
  MoreVertical,
  UserPlus,
  RotateCcw,
  ExternalLink,
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
  type GridTaskRow,
  type HierarchyL1Route,
  type HierarchyL2Stop,
  type HierarchyKpis,
} from "@/lib/rough-planning";
import type { ClusterRef } from "@/components/clustering/ClusterSidePanel";

const COL_COUNT = 8;

interface HierarchyTableProps {
  tasks: GridTaskRow[];
  selected: Map<string, GridTaskRow>;
  onToggleRow: (row: GridTaskRow) => void;
  onAssignRow: (row: GridTaskRow) => void;
  onRevokeRow: (row: GridTaskRow) => void;
  onOpenCluster?: (ref: ClusterRef) => void;
  onAssignCluster?: (tasks: GridTaskRow[]) => void;
}

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
          <span key={s} className="flex items-center gap-1 text-xs text-muted-foreground" title={meta.label}>
            <span className={cn("inline-block h-2 w-2 rounded-full shrink-0", meta.dot)} />
            {counts.get(s)}
          </span>
        );
      })}
    </span>
  );
}

function KpiCells({ kpis }: { kpis: HierarchyKpis }) {
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
    </>
  );
}

function RouteRow({
  route,
  expanded,
  onToggle,
  onOpenCluster,
  onAssignCluster,
}: {
  route: HierarchyL1Route;
  expanded: boolean;
  onToggle: () => void;
  onOpenCluster?: (ref: ClusterRef) => void;
  onAssignCluster?: (tasks: GridTaskRow[]) => void;
}) {
  const allTasks = route.stopClusters.flatMap((s) => s.tasks);
  return (
    <TableRow
      className="bg-muted/40 hover:bg-muted/60 cursor-pointer"
      data-testid={`row-route-${route.id ?? "none"}`}
      onClick={onToggle}
    >
      <TableCell className="w-9">
        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" tabIndex={-1}>
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      </TableCell>
      <TableCell className="min-w-[180px]">
        <div className="flex items-center gap-2">
          <Route className="h-3.5 w-3.5 shrink-0 text-chart-4" />
          <span className="font-semibold text-sm truncate" data-testid={`text-route-name-${route.id ?? "none"}`}>
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
              data-testid={`button-route-actions-${route.id ?? "none"}`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {route.id && onOpenCluster && (
              <DropdownMenuItem
                onClick={() => onOpenCluster({ type: "route", id: route.id! })}
                data-testid={`action-route-open-${route.id}`}
              >
                <ExternalLink className="h-4 w-4" />
                Öppna klumpanel
              </DropdownMenuItem>
            )}
            {onAssignCluster && allTasks.length > 0 && (
              <DropdownMenuItem
                onClick={() => onAssignCluster(allTasks)}
                data-testid={`action-route-assign-${route.id ?? "none"}`}
              >
                <UserPlus className="h-4 w-4" />
                Tilldela alla ({route.kpis.taskCount})…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

function StopRow({
  stop,
  expanded,
  onToggle,
  onOpenCluster,
  onAssignCluster,
}: {
  stop: HierarchyL2Stop;
  expanded: boolean;
  onToggle: () => void;
  onOpenCluster?: (ref: ClusterRef) => void;
  onAssignCluster?: (tasks: GridTaskRow[]) => void;
}) {
  return (
    <TableRow
      className="bg-muted/20 hover:bg-muted/40 cursor-pointer"
      data-testid={`row-stop-${stop.id ?? "none"}`}
      onClick={onToggle}
    >
      <TableCell className="w-9">
        <div className="flex items-center">
          <span className="ml-5 shrink-0">
            <Button size="icon" variant="ghost" className="h-6 w-6" tabIndex={-1}>
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </Button>
          </span>
        </div>
      </TableCell>
      <TableCell className="min-w-[180px]">
        <div className="flex items-center gap-2 pl-5">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-chart-4" />
          <span className="text-sm truncate" data-testid={`text-stop-name-${stop.id ?? "none"}`}>
            {stop.displayName}
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
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              data-testid={`button-stop-actions-${stop.id ?? "none"}`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {stop.id && onOpenCluster && (
              <DropdownMenuItem
                onClick={() => onOpenCluster({ type: "stop", id: stop.id! })}
                data-testid={`action-stop-open-${stop.id}`}
              >
                <ExternalLink className="h-4 w-4" />
                Öppna klumpanel
              </DropdownMenuItem>
            )}
            {onAssignCluster && stop.tasks.length > 0 && (
              <DropdownMenuItem
                onClick={() => onAssignCluster(stop.tasks)}
                data-testid={`action-stop-assign-${stop.id ?? "none"}`}
              >
                <UserPlus className="h-4 w-4" />
                Tilldela alla ({stop.kpis.taskCount})…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

function TaskRow({
  row,
  selected,
  onToggleRow,
  onAssignRow,
  onRevokeRow,
}: {
  row: GridTaskRow;
  selected: boolean;
  onToggleRow: (row: GridTaskRow) => void;
  onAssignRow: (row: GridTaskRow) => void;
  onRevokeRow: (row: GridTaskRow) => void;
}) {
  const meta = ROUGH_STATUS_META[row.status];
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
      <TableCell className="min-w-[200px]">
        <div className="pl-10">
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

export function HierarchyTable({
  tasks,
  selected,
  onToggleRow,
  onAssignRow,
  onRevokeRow,
  onOpenCluster,
  onAssignCluster,
}: HierarchyTableProps) {
  const hierarchy = useMemo(() => buildHierarchy(tasks), [tasks]);

  const [collapsedRoutes, setCollapsedRoutes] = useState<Set<string>>(new Set());
  const [collapsedStops, setCollapsedStops] = useState<Set<string>>(new Set());

  const toggleRoute = (key: string) =>
    setCollapsedRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleStop = (key: string) =>
    setCollapsedStops((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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

  return (
    <div className="overflow-x-auto rounded-lg border" data-testid="table-hierarchy">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-9" />
            <TableHead>Namn</TableHead>
            <TableHead className="whitespace-nowrap">Leveranstid</TableHead>
            <TableHead className="whitespace-nowrap text-right">Uppgifter</TableHead>
            <TableHead className="whitespace-nowrap text-right">Prod.tid</TableHead>
            <TableHead className="whitespace-nowrap text-right">Värde</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-9" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {hierarchy.map((route) => {
            const routeKey = route.id ?? "__no_route__";
            const routeExpanded = !collapsedRoutes.has(routeKey);

            return [
              <RouteRow
                key={`route-${routeKey}`}
                route={route}
                expanded={routeExpanded}
                onToggle={() => toggleRoute(routeKey)}
                onOpenCluster={onOpenCluster}
                onAssignCluster={onAssignCluster}
              />,
              ...(routeExpanded
                ? route.stopClusters.flatMap((stop) => {
                    const stopKey = `${routeKey}__${stop.id ?? "__no_stop__"}`;
                    const stopExpanded = !collapsedStops.has(stopKey);

                    return [
                      <StopRow
                        key={`stop-${stopKey}`}
                        stop={stop}
                        expanded={stopExpanded}
                        onToggle={() => toggleStop(stopKey)}
                        onOpenCluster={onOpenCluster}
                        onAssignCluster={onAssignCluster}
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
                            />
                          ))
                        : []),
                    ];
                  })
                : []),
            ];
          })}
        </TableBody>
      </Table>
      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        {tasks.length} uppgifter · {hierarchy.filter((r) => r.id !== null).length} ruttklumpar ·{" "}
        {hierarchy.reduce(
          (n, r) => n + r.stopClusters.filter((s) => s.id !== null).length,
          0,
        )}{" "}
        stoppklumpar
      </div>
    </div>
  );
}
