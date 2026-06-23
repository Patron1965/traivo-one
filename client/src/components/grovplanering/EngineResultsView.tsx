import { Fragment, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Info,
  Layers,
  MapPin,
  Sparkles,
} from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatSekFromOre } from "@/lib/format";
import {
  SLOT_TYPE_META,
  GROUPING_BASIS_LABEL,
  formatSuggestedTime,
  formatFlexibility,
  formatHoursFromMinutes,
  formatCount,
  type EngineClumpResult,
  type EngineResultsResponse,
  type EngineTaskResult,
  type SlotType,
} from "@/lib/engine-results";

type SortKey = "time" | "type" | "executionCode" | "value";
type SortDir = "asc" | "desc";

interface EngineResultsViewProps {
  data: EngineResultsResponse;
}

function SlotTypeBadge({ slotType }: { slotType: SlotType }) {
  const meta = SLOT_TYPE_META[slotType] ?? SLOT_TYPE_META.onskad;
  return (
    <Badge variant="outline" className={meta.badge} data-testid="badge-slot-type">
      {meta.label}
    </Badge>
  );
}

function sortTasks(
  tasks: EngineTaskResult[],
  key: SortKey,
  dir: SortDir,
): EngineTaskResult[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "time":
        cmp = (a.chosen?.windowStart ?? "").localeCompare(b.chosen?.windowStart ?? "");
        break;
      case "type":
        cmp = (a.chosen?.slotType ?? "").localeCompare(b.chosen?.slotType ?? "");
        break;
      case "executionCode":
        cmp = a.executionCode.localeCompare(b.executionCode, "sv");
        break;
      case "value":
        cmp = a.valueOre - b.valueOre;
        break;
    }
    if (cmp === 0) {
      cmp = (a.title ?? a.objectName ?? "").localeCompare(b.title ?? b.objectName ?? "", "sv");
    }
    return cmp * factor;
  });
}

export function EngineResultsView({ data }: EngineResultsViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [collapsedClumps, setCollapsedClumps] = useState<Set<string>>(new Set());
  const [explainTask, setExplainTask] = useState<EngineTaskResult | null>(null);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const toggleClump = (groupKey: string) =>
    setCollapsedClumps((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });

  const standaloneSorted = useMemo(
    () => sortTasks(data.standalone, sortKey, sortDir),
    [data.standalone, sortKey, sortDir],
  );

  const clumpsSorted = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    return [...data.clumps].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "time":
          cmp = a.windowStart.localeCompare(b.windowStart);
          break;
        case "type":
          cmp = a.slotType.localeCompare(b.slotType);
          break;
        case "executionCode":
          cmp = a.executionCode.localeCompare(b.executionCode, "sv");
          break;
        case "value":
          cmp = a.summedValueOre - b.summedValueOre;
          break;
      }
      return cmp * factor;
    });
  }, [data.clumps, sortKey, sortDir]);

  const SortHeader = ({ label, sk }: { label: string; sk: SortKey }) => (
    <button
      type="button"
      className="flex items-center gap-1 font-medium hover:text-foreground"
      onClick={() => toggleSort(sk)}
      data-testid={`sort-${sk}`}
    >
      {label}
      {sortKey === sk ? (
        <ChevronsUpDown className="h-3 w-3 text-primary" />
      ) : (
        <ChevronsUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );

  const renderTaskRow = (task: EngineTaskResult, indent = false) => (
    <ContextMenu key={task.assignmentId}>
      <ContextMenuTrigger asChild>
        <TableRow
          className="cursor-context-menu"
          data-testid={`row-engine-task-${task.assignmentId}`}
        >
          <TableCell className={cn("align-top", indent && "pl-10")}>
            <div className="font-medium" data-testid={`text-task-title-${task.assignmentId}`}>
              {task.title ?? "Uppgift"}
            </div>
            <div className="text-xs text-muted-foreground">
              {task.objectName ?? "Okänt objekt"}
              {task.customerName ? ` · ${task.customerName}` : ""}
            </div>
          </TableCell>
          <TableCell className="align-top">
            {task.chosen ? (
              <span
                className="font-medium tabular-nums"
                data-testid={`text-task-time-${task.assignmentId}`}
              >
                {formatSuggestedTime(task.chosen.windowStart, task.chosen.windowEnd)}
              </span>
            ) : (
              <span className="text-muted-foreground">–</span>
            )}
          </TableCell>
          <TableCell className="align-top">
            <span
              className="tabular-nums text-muted-foreground"
              data-testid={`text-task-flex-${task.assignmentId}`}
            >
              {formatFlexibility(task)}
            </span>
          </TableCell>
          <TableCell className="align-top">
            {task.chosen ? <SlotTypeBadge slotType={task.chosen.slotType} /> : "–"}
          </TableCell>
          <TableCell className="align-top">
            <Badge variant="secondary" data-testid={`badge-exec-${task.assignmentId}`}>
              {task.executionCode}
            </Badge>
          </TableCell>
          <TableCell className="align-top tabular-nums">
            {formatHoursFromMinutes(task.durationMinutes)}
          </TableCell>
          <TableCell className="align-top text-right tabular-nums">
            {formatSekFromOre(task.valueOre)}
          </TableCell>
          <TableCell className="align-top text-right">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setExplainTask(task)}
              data-testid={`button-explain-${task.assignmentId}`}
            >
              <Info className="h-4 w-4" />
            </Button>
          </TableCell>
        </TableRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() => setExplainTask(task)}
          data-testid={`menuitem-explain-${task.assignmentId}`}
        >
          <Info className="h-4 w-4" />
          Förklara motorns val
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  const renderClump = (clump: EngineClumpResult) => {
    const isCollapsed = collapsedClumps.has(clump.groupKey);
    return (
      <Fragment key={clump.groupKey}>
        <TableRow
          className="bg-muted/40 hover-elevate cursor-pointer"
          onClick={() => toggleClump(clump.groupKey)}
          data-testid={`row-engine-clump-${clump.groupKey}`}
        >
          <TableCell className="align-top">
            <div className="flex items-center gap-2">
              {isCollapsed ? (
                <ChevronRight className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0" />
              )}
              <Layers className="h-4 w-4 shrink-0 text-chart-4" />
              <div>
                <div className="font-semibold">
                  Klumpuppgift · {formatCount(clump.memberCount)} uppgifter
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {clump.address ?? "Adress saknas"}
                  <span className="ml-1">· {GROUPING_BASIS_LABEL[clump.groupingBasis]}</span>
                </div>
              </div>
            </div>
          </TableCell>
          <TableCell className="align-top font-medium tabular-nums">
            {formatSuggestedTime(clump.windowStart, clump.windowEnd)}
          </TableCell>
          <TableCell className="align-top text-muted-foreground">—</TableCell>
          <TableCell className="align-top">
            <SlotTypeBadge slotType={clump.slotType} />
          </TableCell>
          <TableCell className="align-top">
            <Badge variant="secondary">{clump.executionCode}</Badge>
          </TableCell>
          <TableCell className="align-top tabular-nums">
            {formatHoursFromMinutes(clump.summedDurationMinutes)}
          </TableCell>
          <TableCell className="align-top text-right tabular-nums font-medium">
            {formatSekFromOre(clump.summedValueOre)}
          </TableCell>
          <TableCell className="align-top text-right text-xs text-muted-foreground">
            Kostnad {formatSekFromOre(clump.summedCostOre)}
          </TableCell>
        </TableRow>
        {!isCollapsed && clump.members.map((m) => renderTaskRow(m, true))}
      </Fragment>
    );
  };

  if (!data.hasResults) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center text-muted-foreground"
        data-testid="empty-engine-results"
      >
        <Sparkles className="h-8 w-8 text-muted-foreground/60" />
        <p className="font-medium text-foreground">Inga motorförslag ännu</p>
        <p className="max-w-md text-sm">
          Kör tids- &amp; geografimotorn för att generera föreslagna slottider.
          Motorn väger ihop kundönskad tid, tidsregler och utförandekoder samt
          grupperar närliggande uppgifter till klumpuppgifter.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Uppgift / klump</TableHead>
              <TableHead>
                <SortHeader label="Föreslagen tid" sk="time" />
              </TableHead>
              <TableHead>Flexibilitet</TableHead>
              <TableHead>
                <SortHeader label="Typ" sk="type" />
              </TableHead>
              <TableHead>
                <SortHeader label="Utförandekod" sk="executionCode" />
              </TableHead>
              <TableHead>Produktionstid</TableHead>
              <TableHead className="text-right">
                <SortHeader label="Ordervärde" sk="value" />
              </TableHead>
              <TableHead className="text-right">Motivering</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clumpsSorted.map((c) => renderClump(c))}
            {standaloneSorted.map((t) => renderTaskRow(t))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={explainTask !== null} onOpenChange={(o) => !o && setExplainTask(null)}>
        <DialogContent className="max-w-lg" data-testid="dialog-engine-explain">
          <DialogHeader>
            <DialogTitle>Motorns motivering</DialogTitle>
            <DialogDescription>
              {explainTask?.title ?? "Uppgift"}
              {explainTask?.objectName ? ` · ${explainTask.objectName}` : ""}
            </DialogDescription>
          </DialogHeader>

          {explainTask && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Utförandekod:</span>
                <Badge variant="secondary">{explainTask.executionCode}</Badge>
                {explainTask.chosen && (
                  <>
                    <span className="text-muted-foreground">Vald typ:</span>
                    <SlotTypeBadge slotType={explainTask.chosen.slotType} />
                  </>
                )}
              </div>

              <p className="text-sm text-muted-foreground">
                Motorn vägde ihop tidsvillkoren (kundönskad tid väger tyngst, sedan
                krävda och fördelaktiga tidsregler) tillsammans med utförandekoden
                och valde slottiden med högst poäng. Övriga kandidater visas som
                alternativ.
              </p>

              <div className="space-y-2">
                {explainTask.candidates.map((c, i) => {
                  const meta =
                    SLOT_TYPE_META[c.slotType] ?? SLOT_TYPE_META.onskad;
                  return (
                    <div
                      key={`${c.windowStart}-${i}`}
                      className={cn(
                        "rounded-md border p-3 text-sm",
                        c.status === "vald"
                          ? "border-chart-2/50 bg-chart-2/10"
                          : "border-border",
                      )}
                      data-testid={`explain-candidate-${i}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium tabular-nums">
                          {formatSuggestedTime(c.windowStart, c.windowEnd)}
                        </span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={meta.badge}>
                            {meta.label}
                          </Badge>
                          {c.status === "vald" ? (
                            <Badge className="bg-chart-2/15 text-chart-2 border border-chart-2/30">
                              Vald
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Alternativ
                            </span>
                          )}
                        </div>
                      </div>
                      {c.reason && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {c.reason}
                        </p>
                      )}
                      {c.score != null && (
                        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                          Poäng: {c.score.toLocaleString("sv-SE")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
