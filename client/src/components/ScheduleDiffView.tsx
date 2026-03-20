import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Check,
  X,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Minus,
  ArrowRight,
  Loader2,
  Clock,
  Route,
  BarChart3,
  Shield,
  Zap,
  Info,
} from "lucide-react";

interface DecisionTraceSummary {
  totalDrivingChange: number;
  totalSetupChange: number;
  workloadBalanceScore: number;
  riskScore: number;
  totalOrdersScheduled: number;
  estimatedEfficiency: number;
}

interface DecisionTraceMove {
  workOrderId: string;
  workOrderTitle: string;
  from: {
    resourceId: string | null;
    resourceName: string | null;
    day: string | null;
    startTime: string | null;
  };
  to: {
    resourceId: string;
    resourceName: string;
    day: string;
    startTime: string | null;
  };
  reasons: string[];
  constraintStatus: "valid" | "warning" | "violation";
  confidence: number;
}

interface ConstraintViolation {
  type: "hard" | "soft";
  category: string;
  severity: "critical" | "warning";
  workOrderId: string;
  resourceId?: string;
  description: string;
}

interface ScheduleAssignment {
  workOrderId: string;
  resourceId: string;
  scheduledDate: string;
  reason: string;
  confidence: number;
}

interface DecisionTrace {
  summary: DecisionTraceSummary;
  moves: DecisionTraceMove[];
  constraintViolations: ConstraintViolation[];
  riskFactors: string[];
}

interface ScheduleDiffViewProps {
  assignments: ScheduleAssignment[];
  summary: string;
  totalOrdersScheduled: number;
  estimatedEfficiency: number;
  decisionTrace?: DecisionTrace;
  onApplyAll: (assignments: ScheduleAssignment[]) => void;
  onApplySingle?: (assignment: ScheduleAssignment) => void;
  onRejectSingle?: (workOrderId: string) => void;
  onCancel: () => void;
  isApplying: boolean;
}

function KPIDiffTable({ trace }: { trace: DecisionTrace }) {
  const s = trace.summary;

  const rows = [
    {
      label: "Körtid",
      icon: <Route className="h-3.5 w-3.5" />,
      delta: s.totalDrivingChange,
      unit: "min",
      format: (v: number) => `${v > 0 ? "+" : ""}${v} min`,
    },
    {
      label: "Ställtid",
      icon: <Clock className="h-3.5 w-3.5" />,
      delta: s.totalSetupChange,
      unit: "min",
      format: (v: number) => `${v > 0 ? "+" : ""}${v} min`,
    },
    {
      label: "Arbetsbalans",
      icon: <BarChart3 className="h-3.5 w-3.5" />,
      delta: s.workloadBalanceScore,
      unit: "score",
      format: (v: number) => `${Math.round(v * 100)}%`,
    },
    {
      label: "Riskindex",
      icon: <Shield className="h-3.5 w-3.5" />,
      delta: s.riskScore,
      unit: "risk",
      format: (v: number) => `${Math.round(v * 100)}%`,
    },
    {
      label: "Effektivitet",
      icon: <Zap className="h-3.5 w-3.5" />,
      delta: s.estimatedEfficiency,
      unit: "pct",
      format: (v: number) => `${v}%`,
    },
  ];

  return (
    <Card className="p-3" data-testid="kpi-diff-table">
      <div className="text-xs font-medium text-muted-foreground mb-2">KPI-sammanfattning</div>
      <div className="space-y-1.5">
        {rows.map((row) => {
          let color = "text-muted-foreground";
          let DeltaIcon = Minus;

          if (row.unit === "min") {
            if (row.delta < 0) { color = "text-green-600 dark:text-green-400"; DeltaIcon = TrendingDown; }
            else if (row.delta > 0) { color = "text-amber-600 dark:text-amber-400"; DeltaIcon = TrendingUp; }
          } else if (row.unit === "score") {
            if (row.delta >= 0.8) { color = "text-green-600 dark:text-green-400"; DeltaIcon = TrendingUp; }
            else if (row.delta < 0.5) { color = "text-amber-600 dark:text-amber-400"; DeltaIcon = TrendingDown; }
          } else if (row.unit === "risk") {
            if (row.delta <= 0.2) { color = "text-green-600 dark:text-green-400"; DeltaIcon = TrendingDown; }
            else if (row.delta >= 0.5) { color = "text-red-600 dark:text-red-400"; DeltaIcon = TrendingUp; }
            else { color = "text-amber-600 dark:text-amber-400"; DeltaIcon = Minus; }
          } else if (row.unit === "pct") {
            if (row.delta >= 80) { color = "text-green-600 dark:text-green-400"; DeltaIcon = TrendingUp; }
            else if (row.delta < 60) { color = "text-amber-600 dark:text-amber-400"; DeltaIcon = TrendingDown; }
          }

          return (
            <div key={row.label} className="flex items-center justify-between text-xs" data-testid={`kpi-row-${row.label}`}>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {row.icon}
                {row.label}
              </span>
              <span className={`flex items-center gap-1 font-medium ${color}`}>
                <DeltaIcon className="h-3 w-3" />
                {row.format(row.delta)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RiskBadge({ score, factors }: { score: number; factors: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const pct = Math.round(score * 100);

  let color = "bg-green-500/20 text-green-700 dark:text-green-300";
  let label = "Låg risk";
  if (pct >= 50) {
    color = "bg-red-500/20 text-red-700 dark:text-red-300";
    label = "Hög risk";
  } else if (pct >= 25) {
    color = "bg-amber-500/20 text-amber-700 dark:text-amber-300";
    label = "Måttlig risk";
  }

  return (
    <div data-testid="risk-badge">
      <button
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${color} cursor-pointer`}
        onClick={() => setExpanded(!expanded)}
        data-testid="button-toggle-risk"
      >
        <Shield className="h-3 w-3" />
        {label} ({pct}%)
        {factors.length > 0 && (
          expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        )}
      </button>
      {expanded && factors.length > 0 && (
        <div className="mt-1.5 space-y-1 pl-1" data-testid="risk-factors-list">
          {factors.map((factor, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3 w-3 mt-0.5 shrink-0 text-amber-500" />
              <span>{factor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConstraintViolationsAlert({ violations }: { violations: ConstraintViolation[] }) {
  const [expanded, setExpanded] = useState(false);
  if (violations.length === 0) return null;

  const hard = violations.filter(v => v.type === "hard");
  const soft = violations.filter(v => v.type === "soft");

  return (
    <Card className="p-3 border-amber-500/50 bg-amber-50/50 dark:bg-amber-900/10" data-testid="constraint-violations">
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setExpanded(!expanded)}
        data-testid="button-toggle-violations"
      >
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="text-xs font-medium flex-1">
          {violations.length} constraint-{violations.length === 1 ? "varning" : "varningar"}
          {hard.length > 0 && <span className="text-red-600 dark:text-red-400 ml-1">({hard.length} hårda)</span>}
          {soft.length > 0 && <span className="text-amber-600 dark:text-amber-400 ml-1">({soft.length} mjuka)</span>}
        </span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5" data-testid="violations-list">
          {violations.map((v, i) => (
            <div
              key={i}
              className={`flex items-start gap-1.5 text-xs rounded px-2 py-1 ${
                v.type === "hard"
                  ? "bg-red-100/50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
                  : "bg-amber-100/50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
              }`}
              data-testid={`violation-${i}`}
            >
              {v.type === "hard" ? (
                <ShieldAlert className="h-3 w-3 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              )}
              <span>{v.description}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function MoveCard({
  move,
  onAccept,
  onReject,
}: {
  move: DecisionTraceMove;
  onAccept?: () => void;
  onReject?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = move.constraintStatus === "valid"
    ? <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
    : move.constraintStatus === "warning"
    ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
    : <ShieldAlert className="h-3.5 w-3.5 text-red-500" />;

  const confidenceColor = move.confidence >= 80
    ? "bg-green-500/20 text-green-700 dark:text-green-300"
    : move.confidence >= 60
    ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
    : "bg-red-500/20 text-red-700 dark:text-red-300";

  return (
    <Card className="p-2.5 space-y-1.5" data-testid={`move-card-${move.workOrderId}`}>
      <div className="flex items-start gap-2">
        {statusIcon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-medium truncate">{move.workOrderTitle}</span>
            <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${confidenceColor}`}>
              {move.confidence}%
            </Badge>
          </div>

          <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
            {move.from.resourceName ? (
              <>
                <span className="truncate max-w-[80px]">{move.from.resourceName}</span>
                {move.from.day && <span className="shrink-0">{formatShortDate(move.from.day)}</span>}
              </>
            ) : (
              <span className="italic">Ej schemalagd</span>
            )}
            <ArrowRight className="h-3 w-3 shrink-0 text-primary" />
            <span className="truncate max-w-[80px] font-medium">{move.to.resourceName}</span>
            <span className="shrink-0">{formatShortDate(move.to.day)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          className="text-[10px] text-muted-foreground flex items-center gap-0.5 hover:text-foreground"
          onClick={() => setExpanded(!expanded)}
          data-testid={`button-expand-move-${move.workOrderId}`}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {move.reasons.length} anledning{move.reasons.length !== 1 ? "ar" : ""}
        </button>

        {(onAccept || onReject) && (
          <div className="flex items-center gap-1">
            {onReject && (
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                onClick={onReject}
                data-testid={`button-reject-move-${move.workOrderId}`}
              >
                <X className="h-3 w-3 text-red-500" />
              </Button>
            )}
            {onAccept && (
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                onClick={onAccept}
                data-testid={`button-accept-move-${move.workOrderId}`}
              >
                <Check className="h-3 w-3 text-green-500" />
              </Button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="space-y-1 pt-1 border-t" data-testid={`move-reasons-${move.workOrderId}`}>
          {move.reasons.map((reason, i) => (
            <div key={i} className="text-[10px] text-muted-foreground flex items-start gap-1">
              <span className="text-primary mt-0.5">•</span>
              <span>{reason}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T12:00:00");
    const days = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];
    return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
  } catch {
    return dateStr;
  }
}

export function ScheduleDiffView({
  assignments,
  summary,
  totalOrdersScheduled,
  estimatedEfficiency,
  decisionTrace,
  onApplyAll,
  onApplySingle,
  onRejectSingle,
  onCancel,
  isApplying,
}: ScheduleDiffViewProps) {
  const [showOnlyChanges, setShowOnlyChanges] = useState(false);

  if (!decisionTrace) {
    return (
      <div className="space-y-4" data-testid="schedule-diff-view">
        <Card className="p-3 bg-muted/50">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Effektivitet</span>
              <span className="text-sm text-muted-foreground">{estimatedEfficiency}%</span>
            </div>
            <p className="text-xs text-muted-foreground">{summary}</p>
          </div>
        </Card>
        <div className="text-sm font-medium">{totalOrdersScheduled} ordrar att schemalägga</div>
        {assignments.length > 0 && (
          <div className="space-y-2 max-h-[200px] overflow-auto">
            {assignments.map((a) => (
              <Card key={a.workOrderId} className="p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono truncate">{a.workOrderId.slice(0, 8)}...</p>
                    <p className="text-xs text-muted-foreground truncate">{a.reason}</p>
                  </div>
                  <Badge className={`text-[10px] px-1.5 shrink-0 ${a.confidence >= 80 ? "bg-green-500/20 text-green-700" : a.confidence >= 60 ? "bg-amber-500/20 text-amber-700" : "bg-red-500/20 text-red-700"}`}>
                    {a.confidence}%
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        )}
        <ActionButtons
          assignments={assignments}
          onApplyAll={onApplyAll}
          onCancel={onCancel}
          isApplying={isApplying}
        />
      </div>
    );
  }

  const filteredMoves = showOnlyChanges
    ? decisionTrace.moves.filter(m => m.from.resourceId !== m.to.resourceId || m.from.day !== m.to.day)
    : decisionTrace.moves;

  const handleReject = (workOrderId: string) => {
    onRejectSingle?.(workOrderId);
  };

  const handleAcceptSingle = (workOrderId: string) => {
    const assignment = assignments.find(a => a.workOrderId === workOrderId);
    if (assignment) {
      onApplySingle?.(assignment);
    }
  };

  return (
    <div className="space-y-3" data-testid="schedule-diff-view">
      <KPIDiffTable trace={decisionTrace} />

      {decisionTrace.riskFactors.length > 0 && (
        <RiskBadge score={decisionTrace.summary.riskScore} factors={decisionTrace.riskFactors} />
      )}

      <ConstraintViolationsAlert violations={decisionTrace.constraintViolations} />

      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">
          {filteredMoves.length} flytt{filteredMoves.length !== 1 ? "ar" : ""}
        </span>
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
          <Switch
            checked={showOnlyChanges}
            onCheckedChange={setShowOnlyChanges}
            className="h-4 w-7"
            data-testid="switch-show-only-changes"
          />
          Bara ändringar
        </label>
      </div>

      {filteredMoves.length === 0 && (
        <div className="text-center py-4 text-xs text-muted-foreground" data-testid="empty-moves">
          <ShieldCheck className="h-6 w-6 mx-auto mb-1.5 text-green-500" />
          {showOnlyChanges ? "Alla ordrar behåller sina nuvarande platser." : "Inga förslag att visa."}
        </div>
      )}

      <div className="space-y-2 max-h-[300px] overflow-auto" data-testid="moves-list">
        {filteredMoves.map((move) => (
          <MoveCard
            key={move.workOrderId}
            move={move}
            onAccept={onApplySingle ? () => handleAcceptSingle(move.workOrderId) : undefined}
            onReject={onRejectSingle ? () => handleReject(move.workOrderId) : undefined}
          />
        ))}
      </div>

      <ActionButtons
        assignments={assignments}
        onApplyAll={onApplyAll}
        onCancel={onCancel}
        isApplying={isApplying}
      />
    </div>
  );
}

function ActionButtons({
  assignments,
  onApplyAll,
  onCancel,
  isApplying,
}: {
  assignments: ScheduleAssignment[];
  onApplyAll: (assignments: ScheduleAssignment[]) => void;
  onCancel: () => void;
  isApplying: boolean;
}) {
  return (
    <div className="flex gap-2">
      {assignments.length > 0 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onApplyAll(assignments)}
          disabled={isApplying}
          data-testid="button-apply-auto-schedule"
        >
          {isApplying ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Check className="h-4 w-4 mr-2" />
          )}
          Tillämpa alla ({assignments.length})
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={onCancel}
        disabled={isApplying}
        data-testid="button-cancel-auto-schedule"
      >
        Avbryt
      </Button>
    </div>
  );
}
