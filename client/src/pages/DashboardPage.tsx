import { Dashboard } from "@/components/Dashboard";
import { QuickStats } from "@/components/layout/QuickStats";
import { AnomalyAlerts } from "@/components/AnomalyAlerts";
import { PredictiveInsights } from "@/components/PredictiveInsights";
import { TodayOverview } from "@/components/dashboard/TodayOverview";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { DashboardAlerts } from "@/components/dashboard/DashboardAlerts";
import { CapacityOverview } from "@/components/dashboard/CapacityOverview";
import { AutoDistributeToday } from "@/components/dashboard/AutoDistributeToday";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { en as enLocale } from "date-fns/locale";
import { useLanguage } from "@/hooks/use-language";

export default function DashboardPage() {
  const { t: tl, language } = useLanguage();
  const dateLocale = language === "en" ? enLocale : sv;
  const today = new Date();

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 10) return tl("page.dashboard.morning");
    if (hour < 18) return tl("page.dashboard.hello");
    return tl("page.dashboard.evening");
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-dashboard-greeting">
            {getGreeting()}!
          </h1>
          <p className="text-muted-foreground">
            {format(today, "EEEE d MMMM yyyy", { locale: dateLocale })} - Traivo Dashboard
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoDistributeToday />
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
