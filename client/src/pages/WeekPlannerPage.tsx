import { useState } from "react";
import { WeekPlanner } from "@/components/WeekPlanner";
import { JobModal } from "@/components/JobModal";
import { AISuggestionsPanel } from "@/components/AISuggestionsPanel";
import { Button } from "@/components/ui/button";
import { Sparkles, PanelRightClose, PanelRightOpen } from "lucide-react";
import { format, startOfWeek, endOfWeek } from "date-fns";

export default function WeekPlannerPage() {
  const [showJobModal, setShowJobModal] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(true);
  const [currentDate] = useState(new Date());

  const weekStart = format(startOfWeek(currentDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(currentDate, { weekStartsOn: 1 }), "yyyy-MM-dd");

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 min-w-0 overflow-hidden relative">
        <WeekPlanner 
          onAddJob={() => setShowJobModal(true)}
          onSelectJob={(id) => console.log("Selected job for detail:", id)}
        />
        
        {!showAIPanel && (
          <div className="absolute top-16 right-4 z-50">
            <Button
              size="sm"
              className="shadow-lg bg-purple-600 hover:bg-purple-700 text-white gap-1"
              onClick={() => setShowAIPanel(true)}
              data-testid="button-show-ai-panel"
            >
              <Sparkles className="h-4 w-4" />
              AI
            </Button>
          </div>
        )}
      </div>

      {/* Temporarily disabled to debug hook error
      {showAIPanel && (
        <div className="w-80 border-l bg-muted/30 flex flex-col shrink-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 p-3 border-b shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="h-4 w-4 text-purple-500 shrink-0" />
              <span className="font-medium text-sm truncate">AI Assistent</span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="shrink-0"
              onClick={() => setShowAIPanel(false)}
              data-testid="button-hide-ai-panel"
            >
              <PanelRightClose className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex-1 overflow-auto">
            <AISuggestionsPanel
              weekStart={weekStart}
              weekEnd={weekEnd}
              onScheduleApplied={() => {}}
            />
          </div>
        </div>
      )}
      */}

      <JobModal 
        open={showJobModal}
        onClose={() => setShowJobModal(false)}
        onSubmit={(data) => console.log("New job created:", data)}
      />
    </div>
  );
}
