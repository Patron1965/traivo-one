import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play, Navigation, AlertTriangle, ChevronDown, ChevronUp,
  Car, MapPin, Wrench, CheckCircle, Circle,
} from "lucide-react";

type TimelineStep = "travel" | "on_site" | "working" | "completed";

interface FocusTimelineProps {
  currentStep: TimelineStep;
}

const TIMELINE_STEPS: { key: TimelineStep; label: string; icon: typeof Car }[] = [
  { key: "travel", label: "Resa", icon: Car },
  { key: "on_site", label: "På plats", icon: MapPin },
  { key: "working", label: "Arbete", icon: Wrench },
  { key: "completed", label: "Klart", icon: CheckCircle },
];

const stepOrder: TimelineStep[] = ["travel", "on_site", "working", "completed"];

function getStepState(step: TimelineStep, current: TimelineStep): "done" | "active" | "pending" {
  const currentIdx = stepOrder.indexOf(current);
  const stepIdx = stepOrder.indexOf(step);
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

export function FocusTimeline({ currentStep }: FocusTimelineProps) {
  return (
    <Card className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900/50 dark:to-slate-800/50 border-slate-200 dark:border-slate-700" data-testid="focus-timeline">
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between">
          {TIMELINE_STEPS.map((step, idx) => {
            const state = getStepState(step.key, currentStep);
            const Icon = step.icon;
            return (
              <div key={step.key} className="flex items-center gap-0 flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                      state === "done"
                        ? "bg-chart-2 text-white"
                        : state === "active"
                        ? "bg-chart-1 text-white ring-2 ring-chart-1/30 dark:ring-chart-1/70 animate-pulse"
                        : "bg-muted border-2 border-muted-foreground/20 text-muted-foreground"
                    }`}
                    data-testid={`timeline-step-${step.key}`}
                  >
                    {state === "done" ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </div>
                  <span className={`text-[10px] mt-1 font-medium ${
                    state === "active" ? "text-chart-1" : 
                    state === "done" ? "text-chart-2" : "text-muted-foreground"
                  }`}>{step.label}</span>
                </div>
                {idx < TIMELINE_STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 -mt-4 transition-all ${
                    state === "done" ? "bg-chart-2/15" : state === "active" ? "bg-chart-1/30 dark:bg-chart-1/15" : "bg-muted-foreground/20"
                  }`} />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  skapad: { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-700 dark:text-gray-300", label: "Skapad" },
  scheduled: { bg: "bg-chart-1/15 dark:bg-chart-1/15", text: "text-chart-1", label: "Schemalagd" },
  tilldelad: { bg: "bg-chart-1/15 dark:bg-chart-1/15", text: "text-chart-1", label: "Tilldelad" },
  paborjad: { bg: "bg-chart-4/15 dark:bg-chart-4/15", text: "text-chart-4", label: "Pågår" },
  utford: { bg: "bg-chart-2/15 dark:bg-chart-2/15", text: "text-chart-2", label: "Utförd" },
  avbruten: { bg: "bg-destructive/15 dark:bg-destructive/15", text: "text-destructive", label: "Avbruten" },
  omojlig: { bg: "bg-destructive/15 dark:bg-destructive/15", text: "text-destructive", label: "Omöjlig" },
  fakturerad: { bg: "bg-chart-2/15 dark:bg-chart-2/15", text: "text-chart-2", label: "Fakturerad" },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const config = STATUS_COLORS[status] || STATUS_COLORS.skapad;
  return (
    <Badge className={`${config.bg} ${config.text} border-0 text-xs`} data-testid="badge-order-status">
      {config.label}
    </Badge>
  );
}

interface FocusCTAProps {
  jobStarted: boolean;
  hasAddress: boolean;
  onStart: () => void;
  onNavigate: () => void;
  onReport: () => void;
}

export function FocusCTA({ jobStarted, hasAddress, onStart, onNavigate, onReport }: FocusCTAProps) {
  return (
    <div className="grid grid-cols-3 gap-3" data-testid="focus-cta-buttons">
      <Button
        variant={jobStarted ? "outline" : "default"}
        className={`h-auto py-4 flex-col gap-2 ${!jobStarted ? "bg-chart-2 hover:bg-chart-2 text-white" : ""}`}
        onClick={onStart}
        disabled={jobStarted}
        data-testid="focus-button-start"
      >
        <Play className={`h-6 w-6 ${jobStarted ? "text-muted-foreground" : ""}`} />
        <span className="text-xs font-medium">{jobStarted ? "Startad" : "Starta"}</span>
      </Button>
      <Button
        variant="outline"
        className="h-auto py-4 flex-col gap-2"
        onClick={onNavigate}
        disabled={!hasAddress}
        data-testid="focus-button-navigate"
      >
        <Navigation className={`h-6 w-6 ${hasAddress ? "text-chart-1" : "text-muted-foreground"}`} />
        <span className="text-xs font-medium">Navigera</span>
      </Button>
      <Button
        variant="outline"
        className="h-auto py-4 flex-col gap-2"
        onClick={onReport}
        data-testid="focus-button-report"
      >
        <AlertTriangle className="h-6 w-6 text-chart-4" />
        <span className="text-xs font-medium">Rapportera</span>
      </Button>
    </div>
  );
}

interface ExpandableDetailProps {
  children: React.ReactNode;
}

export function ExpandableDetail({ children }: ExpandableDetailProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div data-testid="expandable-detail">
      <Button
        variant="ghost"
        className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
        data-testid="button-toggle-detail"
      >
        {expanded ? (
          <>
            <ChevronUp className="h-4 w-4" />
            Dölj detaljer
          </>
        ) : (
          <>
            <ChevronDown className="h-4 w-4" />
            Mer info
          </>
        )}
      </Button>
      {expanded && (
        <div className="space-y-4 mt-2 animate-in slide-in-from-top-2 duration-200" data-testid="detail-content">
          {children}
        </div>
      )}
    </div>
  );
}

export function getTimelineStep(jobStarted: boolean, elapsedSeconds: number, orderStatus: string): TimelineStep {
  if (orderStatus === "utford" || orderStatus === "fakturerad") return "completed";
  if (jobStarted && elapsedSeconds > 0) return "working";
  if (jobStarted) return "on_site";
  return "travel";
}

export function useFocusMode() {
  const [focusMode, setFocusModeState] = useState(() => {
    try {
      const stored = localStorage.getItem("traivo_focus_mode");
      return stored !== "false";
    } catch {
      return true;
    }
  });

  const setFocusMode = (val: boolean) => {
    setFocusModeState(val);
    try {
      localStorage.setItem("traivo_focus_mode", String(val));
    } catch {}
  };

  return { focusMode, setFocusMode };
}
