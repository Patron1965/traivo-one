import { Dashboard } from "@/components/Dashboard";
import { QuickStats } from "@/components/layout/QuickStats";
import { AnomalyAlerts } from "@/components/AnomalyAlerts";
import { PredictiveInsights } from "@/components/PredictiveInsights";

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Översikt och nyckeltal</p>
      </div>
      <QuickStats />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Dashboard />
        </div>
        <div className="space-y-6">
          <PredictiveInsights />
          <AnomalyAlerts />
        </div>
      </div>
    </div>
  );
}
