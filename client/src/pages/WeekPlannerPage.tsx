import { useState, useMemo, useEffect } from "react";
import { WeekPlanner } from "@/components/WeekPlanner";
import { JobModal } from "@/components/JobModal";
import { JobDetailModal } from "@/components/JobDetailModal";
import { AISuggestionsPanel } from "@/components/AISuggestionsPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, X, AlertTriangle } from "lucide-react";
import { format, startOfWeek, addDays } from "date-fns";

export default function WeekPlannerPage() {
  const [showJobModal, setShowJobModal] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [filterParam] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("filter");
  });
  const [showAIPanel, setShowAIPanel] = useState(() => {
    const saved = localStorage.getItem('weekplanner-ai-panel-open');
    return saved === 'true';
  });
  
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
      {filterParam === "unassigned" && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 dark:bg-amber-950/20 dark:border-amber-800" data-testid="banner-unassigned-filter">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
            Uppgifter utan resurstilldelning — tilldela resurser via veckoplaneraren nedan
          </span>
          <Badge variant="outline" className="text-xs border-amber-300 text-amber-600">Från import</Badge>
        </div>
      )}
      <div className="flex flex-1 min-h-0">
      <div className="flex-1 min-w-0 overflow-auto">
        <WeekPlanner 
          onAddJob={() => setShowJobModal(true)}
          onSelectJob={(id) => setSelectedJobId(id)}
          showAIPanel={showAIPanel}
          onToggleAIPanel={() => setShowAIPanel(!showAIPanel)}
        />
      </div>

      {showAIPanel && (
        <div className="w-80 max-w-[320px] border-l bg-background flex flex-col shrink-0 overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b shrink-0">
            <span className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              AI stöd
            </span>
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
            <AISuggestionsPanel
              weekStart={weekDates.start}
              weekEnd={weekDates.end}
              onScheduleApplied={() => {}}
            />
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
      />
      </div>
    </div>
  );
}
