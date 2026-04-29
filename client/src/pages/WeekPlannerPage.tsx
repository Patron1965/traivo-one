import { useState, useMemo, useEffect } from "react";
import { WeekPlanner } from "@/components/WeekPlanner";
import { JobModal } from "@/components/JobModal";
import { JobDetailModal } from "@/components/JobDetailModal";
import { AISuggestionsPanel } from "@/components/AISuggestionsPanel";
import { RouteOptimizationPanel } from "@/components/RouteOptimizationPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Sparkles, X, AlertTriangle, Route } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { format, startOfWeek, addDays } from "date-fns";

export default function WeekPlannerPage() {
  const [showJobModal, setShowJobModal] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [filterParam] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("filter");
  });
  const [showAIPanel, setShowAIPanel] = useState(() => {
    const saved = localStorage.getItem('weekplanner-ai-panel-open');
    return saved === 'true';
  });
  const [aiPanelTab, setAiPanelTab] = useState<"ai" | "vrp">("ai");
  
  useEffect(() => {
    localStorage.setItem('weekplanner-ai-panel-open', String(showAIPanel));
  }, [showAIPanel]);
  
  const weekDates = useMemo(() => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    return {
      start: format(weekStart, "yyyy-MM-dd"),
      end: format(addDays(weekStart, 6), "yyyy-MM-dd"),
    };
  }, []);

  return (
    <div className="flex h-full relative flex-col">
      <div className="px-4 pt-4">
        <PageHeader icon={Calendar} title="Veckoplanerare" testId="text-page-title" />
      </div>
      {filterParam === "unassigned" && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 dark:bg-amber-950/20 dark:border-amber-800" data-testid="banner-unassigned-filter">
          <AlertTriangle className="h-4 w-4 text-orange-500 dark:text-orange-400 shrink-0" />
          <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
            Uppgifter utan resurstilldelning — tilldela resurser via veckoplaneraren nedan
          </span>
          <Badge variant="outline" className="text-xs border-amber-300 text-amber-600">Från import</Badge>
        </div>
      )}
      <div className="flex flex-1 min-h-0 mx-3 mb-3 border border-border rounded-lg shadow-sm bg-background overflow-hidden">
      <div className="flex-1 min-w-0 overflow-auto">
        <WeekPlanner 
          onAddJob={() => setShowJobModal(true)}
          onSelectJob={(id) => setSelectedJobId(id)}
          onSelectedJobIdsChange={setSelectedJobIds}
          showAIPanel={showAIPanel}
          onToggleAIPanel={() => setShowAIPanel(!showAIPanel)}
        />
      </div>

      {showAIPanel && (
        <div className="w-80 max-w-[320px] border-l border-border bg-background flex flex-col shrink-0 overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b shrink-0">
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={aiPanelTab === "ai" ? "default" : "ghost"}
                className="h-7 text-xs gap-1"
                onClick={() => setAiPanelTab("ai")}
                data-testid="button-tab-ai"
              >
                <Sparkles className="h-3 w-3" />
                AI stöd
              </Button>
              <Button
                size="sm"
                variant={aiPanelTab === "vrp" ? "default" : "ghost"}
                className="h-7 text-xs gap-1"
                onClick={() => setAiPanelTab("vrp")}
                data-testid="button-tab-vrp"
              >
                <Route className="h-3 w-3" />
                VRP
              </Button>
            </div>
            <Button 
              size="icon" 
              variant="ghost" 
              onClick={() => setShowAIPanel(false)}
              data-testid="button-close-ai-panel"
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


      <JobModal 
        open={showJobModal}
        onClose={() => setShowJobModal(false)}
        onSubmit={(data) => console.log("New job created:", data)}
      />

      <JobDetailModal
        open={selectedJobId !== null}
        onClose={() => setSelectedJobId(null)}
        workOrderId={selectedJobId}
        bulkWorkOrderIds={selectedJobIds.size > 1 ? Array.from(selectedJobIds) : undefined}
      />
      </div>
    </div>
  );
}
