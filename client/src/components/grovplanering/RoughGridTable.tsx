import { Fragment } from "react";
import { useLocation } from "wouter";
import {
  Building2,
  Users,
  Layers,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  MoreVertical,
  RotateCcw,
  UserPlus,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatSekFromOre } from "@/lib/format";
import { useExecutionCodes } from "@/hooks/use-execution-codes";
import {
  ROUGH_STATUS_META,
  creationSourceLabel,
  formatHours,
  formatCount,
  formatDateShort,
  weekChip,
  type GridGroup,
  type GridTaskRow,
  type GroupBy,
} from "@/lib/rough-planning";
import { RouteClusterBadge } from "@/components/clustering/RouteClusterBadge";
import { StopClusterBadge } from "@/components/clustering/StopClusterBadge";
import type { ClusterRef } from "@/components/clustering/ClusterSidePanel";

export interface TaskClusters {
  stop: { id: string; displayName: string; status?: string; memberCount?: number }[];
  route: { id: string; displayName: string; status?: string; period?: string | null; workMinutes?: number | null }[];
}

const GROUP_ICON: Record<GroupBy, typeof Building2 | null> = {
  objekt: Building2,
  kund: Users,
  orderkoncept: Layers,
  ingen: null,
};

const COL_COUNT = 12;

interface RoughGridTableProps {
  groups: GridGroup[];
  grouping: GroupBy;
  selected: Map<string, GridTaskRow>;
  collapsed: Set<string>;
  onToggleRow: (row: GridTaskRow) => void;
  onToggleGroup: (group: GridGroup, checked: boolean) => void;
  onToggleCollapse: (key: string) => void;
  onToggleAllVisible: (checked: boolean) => void;
  allVisibleSelected: boolean;
  onAssignRow: (row: GridTaskRow) => void;
  onRevokeRow: (row: GridTaskRow) => void;
  // Mikro-grovplanering (objektsidan): läsvy utan urval/tilldelning.
  readOnly?: boolean;
  onOpenCluster?: (ref: ClusterRef) => void;
  getTaskClusters?: (taskId: string) => TaskClusters | undefined;
}

function StatusCell({ status }: { status: GridTaskRow["status"] }) {
  const meta = ROUGH_STATUS_META[status];
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <span className={cn("inline-block h-2.5 w-2.5 rounded-full", meta.dot)} />
      <span className="text-xs">{meta.label}</span>
    </span>
  );
}

function TaskRow({
  row,
  selected,
  executionCodeLabel,
  onToggleRow,
  onAssignRow,
  onRevokeRow,
  readOnly = false,
  onOpenCluster,
  taskClusters,
}: {
  row: GridTaskRow;
  selected: boolean;
  executionCodeLabel: (code: string) => string;
  onToggleRow: (row: GridTaskRow) => void;
  onAssignRow: (row: GridTaskRow) => void;
  onRevokeRow: (row: GridTaskRow) => void;
  readOnly?: boolean;
  onOpenCluster?: (ref: ClusterRef) => void;
  taskClusters?: TaskClusters;
}) {
  const [, navigate] = useLocation();
  const chip = weekChip(row.roughPlannedWeek);
  const sourceLabel = creationSourceLabel(row.source);
  return (
    <TableRow data-state={selected ? "selected" : undefined} data-testid={`row-task-${row.id}`}>
      <TableCell className="w-9">
        {!readOnly && (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleRow(row)}
            data-testid={`check-task-${row.id}`}
          />
        )}
      </TableCell>
      <TableCell className="w-8" />
      <TableCell>
        <StatusCell status={row.status} />
      </TableCell>
      <TableCell className="max-w-[160px] truncate">
        {row.customerName ?? "–"}
      </TableCell>
      <TableCell className="max-w-[220px]">
        <div className="truncate font-medium">{row.objectName ?? "–"}</div>
        {row.title && (
          <div className="truncate text-xs text-muted-foreground">{row.title}</div>
        )}
        {sourceLabel && (
          <div
            className="truncate text-[11px] text-muted-foreground/80"
            data-testid={`text-task-source-${row.id}`}
          >
            Källa: {sourceLabel}
          </div>
        )}
        {/* Klump-badges: möjliga klumpar från batch-fetch eller fallback till assigned */}
        {(() => {
          const routeEntries = taskClusters?.route.length
            ? taskClusters.route
            : row.routeClusterId
            ? [{ id: row.routeClusterId, displayName: row.routeClusterName ?? row.routeClusterId.slice(0, 8), status: undefined, period: null }]
            : [];
          const stopEntries = taskClusters?.stop.length
            ? taskClusters.stop
            : row.stopClusterId
            ? [{ id: row.stopClusterId, displayName: row.stopClusterName ?? row.stopClusterId.slice(0, 8), status: undefined, memberCount: undefined }]
            : [];
          if (routeEntries.length === 0 && stopEntries.length === 0) return null;
          return (
            <>
              <div className="mt-0.5 flex flex-wrap gap-1" data-testid={`badges-clusters-${row.id}`}>
                {routeEntries.map((c) => (
                  <RouteClusterBadge
                    key={c.id}
                    name={c.displayName}
                    period={c.period}
                    status={c.status}
                    onClick={onOpenCluster ? () => onOpenCluster({ type: "route", id: c.id }) : undefined}
                  />
                ))}
                {stopEntries.map((c) => (
                  <StopClusterBadge
                    key={c.id}
                    name={c.displayName}
                    memberCount={"memberCount" in c ? c.memberCount : undefined}
                    status={c.status}
                    onClick={onOpenCluster ? () => onOpenCluster({ type: "stop", id: c.id }) : undefined}
                  />
                ))}
              </div>
              {(routeEntries.length + stopEntries.length) > 0 && (
                <div className="mt-0.5 text-[10px] text-muted-foreground/70" data-testid={`text-cluster-info-${row.id}`}>
                  {routeEntries.length > 0 && `${routeEntries.length} ruttförslag`}
                  {routeEntries.length > 0 && stopEntries.length > 0 && " · "}
                  {stopEntries.length > 0 && `${stopEntries.length} stoppklump${stopEntries.length > 1 ? "ar" : ""}`}
                </div>
              )}
            </>
          );
        })()}
      </TableCell>
      <TableCell>
        {/* Task #1485: artikeltyp från artikelkopplingen; legacy = härledd från
            fritext-orderType (gamla rader utan artikel). */}
        <Badge
          variant="outline"
          className="font-normal"
          title={
            row.articleTypeSource === "legacy"
              ? "Härledd från fritext (saknar artikelkoppling)"
              : undefined
          }
        >
          {row.articleTypeLabel ?? "–"}
          {row.articleTypeSource === "legacy" && (
            <span className="ml-1 text-muted-foreground">*</span>
          )}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm" data-testid={`text-execution-code-${row.id}`}>
        {row.executionCode ? (
          executionCodeLabel(row.executionCode)
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm tabular-nums">
        {formatDateShort(row.desiredDeliveryStart)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
        {formatHours(row.productionMinutes)}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {row.teamName ? (
          <span className="flex items-center gap-1.5 text-sm">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: row.teamColor ?? undefined }}
            />
            {row.teamName}
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {chip ? (
          <span className="inline-flex rounded-md border border-chart-4/30 bg-chart-4/15 px-1.5 py-0.5 text-xs font-medium text-chart-4">
            {chip}
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
        {formatSekFromOre(row.value)}
      </TableCell>
      <TableCell className="w-9">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              data-testid={`button-row-actions-${row.id}`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Uppgiftsnavet: hopp till uppgiftens fullständiga detaljvy */}
            <DropdownMenuItem
              onClick={() => navigate(`/work-orders/${row.id}`)}
              data-testid={`action-details-${row.id}`}
            >
              <ExternalLink className="h-4 w-4" />
              Visa detaljer
            </DropdownMenuItem>
            {!readOnly && (
              <>
                <DropdownMenuItem
                  onSelect={() => setTimeout(() => onAssignRow(row), 0)}
                  data-testid={`action-assign-${row.id}`}
                >
                  <UserPlus className="h-4 w-4" />
                  Tilldela…
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={row.status !== "tilldelad"}
                  onSelect={() => setTimeout(() => onRevokeRow(row), 0)}
                  data-testid={`action-revoke-${row.id}`}
                >
                  <RotateCcw className="h-4 w-4" />
                  Återkalla tilldelning
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

export function RoughGridTable({
  groups,
  grouping,
  selected,
  collapsed,
  onToggleRow,
  onToggleGroup,
  onToggleCollapse,
  onToggleAllVisible,
  allVisibleSelected,
  onAssignRow,
  onRevokeRow,
  readOnly = false,
  onOpenCluster,
  getTaskClusters,
}: RoughGridTableProps) {
  const flat = grouping === "ingen";
  const GroupIcon = GROUP_ICON[grouping];

  // Task #1110: visa utförandekoders etiketter (registret + legacy-fritext på raderna).
  const rowExecutionCodes = groups.flatMap((g) =>
    g.tasks.map((t) => t.executionCode).filter((c): c is string => !!c),
  );
  const { labelFor: executionCodeLabel } = useExecutionCodes(rowExecutionCodes);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table density="compact">
        <TableHeader>
          <TableRow>
            <TableHead className="w-9">
              {!readOnly && (
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={(c) => onToggleAllVisible(c === true)}
                  data-testid="check-select-all"
                />
              )}
            </TableHead>
            <TableHead className="w-8" />
            <TableHead>Status</TableHead>
            <TableHead>Kund</TableHead>
            <TableHead>Objekt / Uppgift</TableHead>
            <TableHead>Artikeltyp</TableHead>
            <TableHead>Utförandekod</TableHead>
            <TableHead>Önskad lev.</TableHead>
            <TableHead className="text-right">Tid</TableHead>
            <TableHead>Team</TableHead>
            <TableHead>Vecka</TableHead>
            <TableHead className="text-right">Ordervärde</TableHead>
            <TableHead className="w-9" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            const groupSelected =
              group.tasks.length > 0 &&
              group.tasks.every((t) => selected.has(t.id));
            return (
              <Fragment key={group.key}>
                {!flat && (
                  <TableRow
                    className="bg-muted/40 hover:bg-muted/60"
                    data-testid={`row-group-${group.key}`}
                  >
                    <TableCell className="w-9">
                      {!readOnly && (
                        <Checkbox
                          checked={groupSelected}
                          onCheckedChange={(c) => onToggleGroup(group, c === true)}
                          data-testid={`check-group-${group.key}`}
                        />
                      )}
                    </TableCell>
                    <TableCell className="w-8">
                      <button
                        type="button"
                        onClick={() => onToggleCollapse(group.key)}
                        className="flex h-6 w-6 items-center justify-center rounded-md hover-elevate"
                        data-testid={`button-collapse-${group.key}`}
                        aria-label={isCollapsed ? "Expandera" : "Fäll ihop"}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell colSpan={3}>
                      <div className="flex items-center gap-2">
                        {GroupIcon && (
                          <GroupIcon className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-semibold">{group.label}</span>
                        {grouping !== "kund" && (
                          <Badge variant="secondary" className="font-normal">
                            {formatCount(group.objectCount)} objekt
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatCount(group.summary.taskCount)} uppgifter
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      {formatDateShort(group.earliestDesired)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-sm font-medium tabular-nums">
                      {formatHours(group.summary.productionMinutes)}
                    </TableCell>
                    <TableCell colSpan={2} />
                    <TableCell className="whitespace-nowrap text-right text-sm font-medium tabular-nums">
                      {formatSekFromOre(group.summary.value)}
                    </TableCell>
                    <TableCell className="w-9" />
                  </TableRow>
                )}
                {(flat || !isCollapsed) &&
                  group.tasks.map((row) => (
                    <TaskRow
                      key={row.id}
                      row={row}
                      selected={selected.has(row.id)}
                      executionCodeLabel={executionCodeLabel}
                      onToggleRow={onToggleRow}
                      onAssignRow={onAssignRow}
                      onRevokeRow={onRevokeRow}
                      readOnly={readOnly}
                      onOpenCluster={onOpenCluster}
                      taskClusters={getTaskClusters?.(row.id)}
                    />
                  ))}
              </Fragment>
            );
          })}
          {groups.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={COL_COUNT + 1}
                className="py-10 text-center text-muted-foreground"
              >
                Inga uppgifter matchar filtret.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
