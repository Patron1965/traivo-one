import { Dashboard } from "@/components/Dashboard";
import { QuickStats } from "@/components/layout/QuickStats";

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Översikt och nyckeltal</p>
      </div>
      <QuickStats />
      <Dashboard />
    </div>
  );
}
