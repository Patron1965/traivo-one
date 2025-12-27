import { useState, useMemo, useEffect } from "react";
import { WeekPlanner } from "@/components/WeekPlanner";
import { JobModal } from "@/components/JobModal";
import { AISuggestionsPanel } from "@/components/AISuggestionsPanel";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";
import { format, startOfWeek, addDays } from "date-fns";

export default function WeekPlannerPage() {
  const [showJobModal, setShowJobModal] = useState(false);
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
    <div className="flex h-full relative">
      <div className="flex-1 min-w-0 overflow-auto">
        <WeekPlanner 
          onAddJob={() => setShowJobModal(true)}
          onSelectJob={(id) => console.log("Selected job for detail:", id)}
        />
      </div>

      {showAIPanel && (
        <div className="w-80 max-w-[320px] border-l bg-background flex flex-col shrink-0 overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b shrink-0">
            <span className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              AI Planeringsassistent
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

      {!showAIPanel && (
        <Button
          onClick={() => setShowAIPanel(true)}
          className="fixed bottom-6 right-6 shadow-xl z-50 bg-purple-600 hover:bg-purple-700 text-white gap-2 px-4 py-5"
          data-testid="button-open-ai-panel"
        >
          <Sparkles className="h-5 w-5" />
          AI Assistent
        </Button>
      )}

      <JobModal 
        open={showJobModal}
        onClose={() => setShowJobModal(false)}
        onSubmit={(data) => console.log("New job created:", data)}
      />
    </div>
  );
}
