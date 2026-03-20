import { Dashboard } from "@/components/Dashboard";
import { QuickStats } from "@/components/layout/QuickStats";
import { AnomalyAlerts } from "@/components/AnomalyAlerts";
import { PredictiveInsights } from "@/components/PredictiveInsights";
import { TodayOverview } from "@/components/dashboard/TodayOverview";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { DashboardAlerts } from "@/components/dashboard/DashboardAlerts";
import { CapacityOverview } from "@/components/dashboard/CapacityOverview";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 10) return "God morgon";
  if (hour < 18) return "Hej";
  return "God kväll";
}

export default function DashboardPage() {
  const today = new Date();

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-dashboard-greeting">
            {getGreeting()}!
          </h1>
          <p className="text-muted-foreground">
            {format(today, "EEEE d MMMM yyyy", { locale: sv })} - Traivo Dashboard
          </p>
        </div>
      </div>

      <QuickStats />

      <QuickActions />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Dashboard />
        </div>
        <div className="space-y-6">
          <DashboardAlerts />
          <CapacityOverview />
          <TodayOverview />
          <PredictiveInsights />
          <AnomalyAlerts />
        </div>
      </div>
    </div>
  );
}
