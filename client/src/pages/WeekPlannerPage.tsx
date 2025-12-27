import { useState } from "react";
import { WeekPlanner } from "@/components/WeekPlanner";
import { JobModal } from "@/components/JobModal";

export default function WeekPlannerPage() {
  const [showJobModal, setShowJobModal] = useState(false);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 min-w-0 overflow-hidden">
        <WeekPlanner 
          onAddJob={() => setShowJobModal(true)}
          onSelectJob={(id) => console.log("Selected job for detail:", id)}
        />
      </div>

      <JobModal 
        open={showJobModal}
        onClose={() => setShowJobModal(false)}
        onSubmit={(data) => console.log("New job created:", data)}
      />
    </div>
  );
}
