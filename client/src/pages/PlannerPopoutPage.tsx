import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { WeekPlanner } from "@/components/WeekPlanner";
import { JobModal } from "@/components/JobModal";
import { EnkelUppgiftWizard } from "@/components/EnkelUppgiftWizard";
import { JobDetailModal } from "@/components/JobDetailModal";
import { AISuggestionsPanel } from "@/components/AISuggestionsPanel";
import { RouteOptimizationPanel } from "@/components/RouteOptimizationPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, X, Route, ExternalLink, Calendar, Inbox, Plus } from "lucide-react";
import { format, startOfWeek, addDays } from "date-fns";
import type { PlannerDisplayMode } from "@/components/weekplanner/types";
import type { SyncRole } from "@/components/weekplanner/usePlannerSync";

function readPopoutView(): "calendar" | "orderlager" | "full" {
  if (typeof window === "undefined") return "full";
  const params = new URLSearchParams(window.location.search);
  const v = params.get("view");
  if (v === "calendar" || v === "orderlager") return v;
  return "full";
}

export default function PlannerPopoutPage() {
  const [location] = useLocation();
  const [showJobModal, setShowJobModal] = useState(false);
  const [showEnkelUppgift, setShowEnkelUppgift] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showAIPanel, setShowAIPanel] = useState(() => {
    const saved = localStorage.getItem('weekplanner-ai-panel-open');
    return saved === 'true';
  });
  const [aiPanelTab, setAiPanelTab] = useState<"ai" | "vrp">("ai");

  const popoutView = useMemo(() => readPopoutView(), [location]);
  const displayMode: PlannerDisplayMode = popoutView === "calendar"
    ? "calendar-only"
    : popoutView === "orderlager"
      ? "orderlager-only"
      : "full";
  const popoutRole: SyncRole = popoutView === "calendar"
    ? "popout-calendar"
    : popoutView === "orderlager"
      ? "popout-orderlager"
      : "main";

  const headerLabel = popoutView === "calendar"
    ? "Kalender"
    : popoutView === "orderlager"
      ? "Orderlager"
      : "Planering";

  useEffect(() => {
    localStorage.setItem('weekplanner-ai-panel-open', String(showAIPanel));
  }, [showAIPanel]);

  useEffect(() => {
    document.title = `Traivo — ${headerLabel} (Pop-out)`;
  }, [headerLabel]);

  const weekDates = useMemo(() => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    return {
      start: format(weekStart, "yyyy-MM-dd"),
      end: format(addDays(weekStart, 6), "yyyy-MM-dd"),
    };
  }, []);

  const showAIPanelInPopout = displayMode === "calendar-only" || displayMode === "full";

  return (
    <div className="flex flex-col h-screen bg-background text-foreground" data-testid="planner-popout-page">
      <div className="flex items-center justify-between px-5 py-3 border-b bg-gradient-to-r from-chart-2/10 via-background to-background shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-chart-2/15 text-chart-2">
            {popoutView === "calendar" ? <Calendar className="h-5 w-5" /> : <Inbox className="h-5 w-5" />}
          </div>
          <div className="flex flex-col leading-tight">
            <h1 className="text-lg font-semibold text-foreground tracking-tight" data-testid="text-popout-heading">
              {headerLabel}
            </h1>
            <span className="text-xs text-muted-foreground">Pop-out · synkad med huvudfönstret</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setShowEnkelUppgift(true)}
            data-testid="button-open-enkel-uppgift"
          >
            <Plus className="h-3.5 w-3.5" />
            Enkel uppgift
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => window.opener?.focus()}
            data-testid="button-back-to-main"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Huvudfönstret
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-auto">
          <WeekPlanner
            onAddJob={() => setShowJobModal(true)}
            onSelectJob={(id) => setSelectedJobId(id)}
            showAIPanel={showAIPanelInPopout && showAIPanel}
            onToggleAIPanel={showAIPanelInPopout ? () => setShowAIPanel(!showAIPanel) : undefined}
            displayMode={displayMode}
            popoutRole={popoutRole}
          />
        </div>

        {showAIPanelInPopout && showAIPanel && (
          <div className="w-80 max-w-[320px] border-l bg-background flex flex-col shrink-0 overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b shrink-0">
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant={aiPanelTab === "ai" ? "default" : "ghost"}
                  className="h-7 text-xs gap-1"
                  onClick={() => setAiPanelTab("ai")}
                  data-testid="button-tab-ai-popout"
                >
                  <Sparkles className="h-3 w-3" />
                  AI stöd
                </Button>
                <Button
                  size="sm"
                  variant={aiPanelTab === "vrp" ? "default" : "ghost"}
                  className="h-7 text-xs gap-1"
                  onClick={() => setAiPanelTab("vrp")}
                  data-testid="button-tab-vrp-popout"
                >
                  <Route className="h-3 w-3" />
                  VRP
                </Button>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowAIPanel(false)}
                data-testid="button-close-ai-panel-popout"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto bg-background">
              {aiPanelTab === "ai" ? (
                <AISuggestionsPanel
                  weekStart={weekDates.start}
                  weekEnd={weekDates.end}
                  onScheduleApplied={() => {}}
                />
              ) : (
                <RouteOptimizationPanel
                  selectedDate={format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <JobModal
        open={showJobModal}
        onClose={() => setShowJobModal(false)}
        onSubmit={(data) => console.log("New job created:", data)}
      />

      <EnkelUppgiftWizard
        open={showEnkelUppgift}
        onClose={() => setShowEnkelUppgift(false)}
      />

      <JobDetailModal
        open={selectedJobId !== null}
        onClose={() => setSelectedJobId(null)}
        workOrderId={selectedJobId}
      />
    </div>
  );
}
