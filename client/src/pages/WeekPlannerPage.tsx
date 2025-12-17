import { useState } from "react";
import { WeekPlanner } from "@/components/WeekPlanner";
import { JobModal } from "@/components/JobModal";

export default function WeekPlannerPage() {
  const [showJobModal, setShowJobModal] = useState(false);

  return (
    <>
      <WeekPlanner 
        onAddJob={() => setShowJobModal(true)}
        onSelectJob={(id) => console.log("Selected job for detail:", id)}
      />
      <JobModal 
        open={showJobModal}
        onClose={() => setShowJobModal(false)}
        onSubmit={(data) => console.log("New job created:", data)}
      />
    </>
  );
}
