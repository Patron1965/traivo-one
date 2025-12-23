import { useState } from "react";
import { WeekPlanner } from "@/components/WeekPlanner";
import { JobModal } from "@/components/JobModal";
import { AISuggestionsPanel } from "@/components/AISuggestionsPanel";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";
import { format, startOfWeek, endOfWeek } from "date-fns";

export default function WeekPlannerPage() {
  const [showJobModal, setShowJobModal] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [currentDate] = useState(new Date());

  const weekStart = format(startOfWeek(currentDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(currentDate, { weekStartsOn: 1 }), "yyyy-MM-dd");

  return (
    <div className="flex h-full">
      <div className="flex-1 relative">
        <WeekPlanner 
          onAddJob={() => setShowJobModal(true)}
          onSelectJob={(id) => console.log("Selected job for detail:", id)}
        />
        
        {!showAIPanel && (
          <Button
            className="fixed bottom-6 right-6 shadow-lg z-50"
            onClick={() => setShowAIPanel(true)}
            data-testid="button-open-ai-panel"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            AI Assistent
          </Button>
        )}
      </div>

      {showAIPanel && (
        <div className="w-80 border-l bg-background flex flex-col">
          <div className="flex items-center justify-between p-3 border-b">
            <span className="font-medium text-sm">AI Planeringsassistent</span>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setShowAIPanel(false)}
              data-testid="button-close-ai-panel"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto">
            <AISuggestionsPanel
              weekStart={weekStart}
              weekEnd={weekEnd}
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
