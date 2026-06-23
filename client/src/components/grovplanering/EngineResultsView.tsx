import { Fragment, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Info,
  Layers,
  MapPin,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";

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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  SLOT_TYPE_META,
  DECISION_META,
  GROUPING_BASIS_LABEL,
  formatSuggestedTime,
  formatFlexibility,
  formatHoursFromMinutes,
  formatCount,
  type EngineClumpResult,
  type EngineResultsResponse,
  type EngineTaskResult,
  type PlannerDecision,
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

function DecisionBadge({
  decision,
  testId,
}: {
  decision: PlannerDecision | null;
  testId: string;
}) {
  if (!decision) {
    return (
      <Badge
        variant="outline"
        className="border-dashed text-muted-foreground"
        data-testid={testId}
      >
        Obeslutat
      </Badge>
    );
  }
  const meta = DECISION_META[decision];
  return (
    <Badge variant="outline" className={meta.badge} data-testid={testId}>
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

type DecisionInput = "accepterad" | "avvisad" | "ingen";

interface DecisionPayload {
  target: "task" | "clump";
  decision: DecisionInput;
  assignmentId?: string;
  groupKey?: string;
}

export function EngineResultsView({ data }: EngineResultsViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [collapsedClumps, setCollapsedClumps] = useState<Set<string>>(new Set());
  const [explainTask, setExplainTask] = useState<EngineTaskResult | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const { toast } = useToast();

  const decisionMutation = useMutation({
    mutationFn: async (payload: DecisionPayload) => {
      const res = await apiRequest(
        "POST",
        "/api/rough-planning/engine-results/decision",
        payload,
      );
      return res.json();
    },
    onMutate: (payload: DecisionPayload) => {
      setPendingKey(payload.target === "task" ? payload.assignmentId! : payload.groupKey!);
    },
    onSuccess: (_data, payload) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rough-planning/engine-results"] });
      const verb =
        payload.decision === "accepterad"
          ? "accepterad"
          : payload.decision === "avvisad"
            ? "avvisad"
            : "återställd";
      toast({
        title: "Beslut sparat",
        description:
          payload.target === "clump"
            ? `Klumpuppgiftens föreslagna tid ${verb}.`
            : `Uppgiftens föreslagna tid ${verb}.`,
      });
    },
    onError: () => {
      toast({
        title: "Kunde inte spara beslutet",
        description: "Försök igen.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setPendingKey(null);
    },
  });

  const decide = (payload: DecisionPayload) => decisionMutation.mutate(payload);

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

  const renderDecisionActions = (
    decision: PlannerDecision | null,
    rowKey: string,
    onDecide: (d: DecisionInput) => void,
    testIdSuffix: string,
  ) => {
    const isPending = pendingKey === rowKey && decisionMutation.isPending;
    return (
      <div className="flex items-center justify-end gap-1">
        <Button
          size="icon"
          variant="ghost"
          className={cn(
            "h-7 w-7",
            decision === "accepterad" && "bg-chart-2/15 text-chart-2",
          )}
          disabled={isPending}
          onClick={(e) => {
            e.stopPropagation();
            onDecide(decision === "accepterad" ? "ingen" : "accepterad");
          }}
          title={decision === "accepterad" ? "Ångra acceptans" : "Acceptera förslaget"}
          data-testid={`button-accept-${testIdSuffix}`}
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={cn(
            "h-7 w-7",
            decision === "avvisad" && "bg-destructive/15 text-destructive",
          )}
          disabled={isPending}
          onClick={(e) => {
            e.stopPropagation();
            onDecide(decision === "avvisad" ? "ingen" : "avvisad");
          }}
          title={decision === "avvisad" ? "Ångra avvisning" : "Avvisa förslaget"}
          data-testid={`button-reject-${testIdSuffix}`}
        >
          <X className="h-4 w-4" />
        </Button>
        {decision && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground"
            disabled={isPending}
            onClick={(e) => {
              e.stopPropagation();
              onDecide("ingen");
            }}
            title="Återställ (obeslutat)"
            data-testid={`button-reset-${testIdSuffix}`}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  };

  const renderTaskRow = (task: EngineTaskResult, indent = false) => (
    <ContextMenu key={task.assignmentId}>
      <ContextMenuTrigger asChild>
        <TableRow
          className={cn(
            "cursor-context-menu",
            task.decision === "avvisad" && "opacity-50",
          )}
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
          <TableCell className="align-top">
            <DecisionBadge
              decision={task.decision}
              testId={`badge-decision-${task.assignmentId}`}
            />
          </TableCell>
          <TableCell className="align-top">
            {renderDecisionActions(
              task.decision,
              task.assignmentId,
              (d) => decide({ target: "task", assignmentId: task.assignmentId, decision: d }),
              task.assignmentId,
            )}
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
        <ContextMenuItem
          onClick={() =>
            decide({
              target: "task",
              assignmentId: task.assignmentId,
              decision: task.decision === "accepterad" ? "ingen" : "accepterad",
            })
          }
          data-testid={`menuitem-accept-${task.assignmentId}`}
        >
          <Check className="h-4 w-4" />
          {task.decision === "accepterad" ? "Ångra acceptans" : "Acceptera förslaget"}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() =>
            decide({
              target: "task",
              assignmentId: task.assignmentId,
              decision: task.decision === "avvisad" ? "ingen" : "avvisad",
            })
          }
          data-testid={`menuitem-reject-${task.assignmentId}`}
        >
          <X className="h-4 w-4" />
          {task.decision === "avvisad" ? "Ångra avvisning" : "Avvisa förslaget"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  const renderClump = (clump: EngineClumpResult) => {
    const isCollapsed = collapsedClumps.has(clump.groupKey);
    return (
      <Fragment key={clump.groupKey}>
        <TableRow
          className={cn(
            "bg-muted/40 hover-elevate cursor-pointer",
            clump.decision === "avvisad" && "opacity-50",
          )}
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
          <TableCell className="align-top">
            <DecisionBadge
              decision={clump.decision}
              testId={`badge-decision-${clump.groupKey}`}
            />
          </TableCell>
          <TableCell className="align-top">
            {renderDecisionActions(
              clump.decision,
              clump.groupKey,
              (d) => decide({ target: "clump", groupKey: clump.groupKey, decision: d }),
              clump.groupKey,
            )}
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
              <TableHead>Beslut</TableHead>
              <TableHead className="text-right">Åtgärd</TableHead>
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
