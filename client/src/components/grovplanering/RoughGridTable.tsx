import { Fragment } from "react";
import {
  Building2,
  Users,
  Layers,
  ChevronRight,
  ChevronDown,
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
  formatHours,
  formatCount,
  formatDateShort,
  weekChip,
  type GridGroup,
  type GridTaskRow,
  type GroupBy,
} from "@/lib/rough-planning";

const GROUP_ICON: Record<GroupBy, typeof Building2 | null> = {
  objekt: Building2,
  kund: Users,
  orderkoncept: Layers,
  ingen: null,
};

const COL_COUNT = 13;

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
}: {
  row: GridTaskRow;
  selected: boolean;
  executionCodeLabel: (code: string) => string;
  onToggleRow: (row: GridTaskRow) => void;
  onAssignRow: (row: GridTaskRow) => void;
  onRevokeRow: (row: GridTaskRow) => void;
}) {
  const chip = weekChip(row.roughPlannedWeek);
  return (
    <TableRow data-state={selected ? "selected" : undefined} data-testid={`row-task-${row.id}`}>
      <TableCell className="w-9">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleRow(row)}
          data-testid={`check-task-${row.id}`}
        />
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
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="font-normal">
          {row.taskTypeLabel}
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
      <TableCell className="whitespace-nowrap text-sm tabular-nums">
        {formatDateShort(row.lastServiceDate)}
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
            <DropdownMenuItem
              onClick={() => onAssignRow(row)}
              data-testid={`action-assign-${row.id}`}
            >
              <UserPlus className="h-4 w-4" />
              Tilldela…
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={row.status !== "tilldelad"}
              onClick={() => onRevokeRow(row)}
              data-testid={`action-revoke-${row.id}`}
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
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(c) => onToggleAllVisible(c === true)}
                data-testid="check-select-all"
              />
            </TableHead>
            <TableHead className="w-8" />
            <TableHead>Status</TableHead>
            <TableHead>Kund</TableHead>
            <TableHead>Objekt / Uppgift</TableHead>
            <TableHead>Uppgiftstyp</TableHead>
            <TableHead>Utförandekod</TableHead>
            <TableHead>Önskad lev.</TableHead>
            <TableHead className="text-right">Tid</TableHead>
            <TableHead>Team</TableHead>
            <TableHead>Vecka</TableHead>
            <TableHead>Senast utförd</TableHead>
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
                      <Checkbox
                        checked={groupSelected}
                        onCheckedChange={(c) => onToggleGroup(group, c === true)}
                        data-testid={`check-group-${group.key}`}
                      />
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
