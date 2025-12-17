import { WeekPlanner } from "../WeekPlanner";

export default function WeekPlannerExample() {
  return (
    <div className="h-[600px] border rounded-lg overflow-hidden bg-background">
      <WeekPlanner 
        onAddJob={() => console.log("Add job modal would open")}
        onSelectJob={(id) => console.log("Selected job:", id)}
      />
    </div>
  );
}
