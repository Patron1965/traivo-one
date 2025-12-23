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
    <div className="flex h-full">
      <div className={`flex-1 min-w-0 transition-all duration-300 ${showAIPanel ? "mr-0" : ""}`}>
        <div className="h-full relative">
          <WeekPlanner 
            onAddJob={() => setShowJobModal(true)}
            onSelectJob={(id) => console.log("Selected job for detail:", id)}
          />
          
          {!showAIPanel && (
            <Button
              className="absolute top-4 right-4 gap-2 shadow-lg"
              onClick={() => setShowAIPanel(true)}
              data-testid="button-show-ai-panel"
            >
              <Sparkles className="h-4 w-4" />
              AI Assistent
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {showAIPanel && (
        <div className="w-80 border-l bg-muted/30 flex flex-col shrink-0 relative">
          <Button
            size="icon"
            variant="ghost"
            className="absolute top-2 right-2 z-10"
            onClick={() => setShowAIPanel(false)}
            data-testid="button-hide-ai-panel"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
          
          <div className="flex-1 overflow-auto pt-2">
            <AISuggestionsPanel
              weekStart={weekStart}
              weekEnd={weekEnd}
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
    </div>
  );
}
