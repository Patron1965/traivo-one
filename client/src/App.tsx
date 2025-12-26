import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopNav } from "@/components/layout/TopNav";
import { FloatingActionButton } from "@/components/layout/FloatingActionButton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import WeekPlannerPage from "@/pages/WeekPlannerPage";
import RoutesPage from "@/pages/RoutesPage";
import ObjectsPage from "@/pages/ObjectsPage";
import ResourcesPage from "@/pages/ResourcesPage";
import DashboardPage from "@/pages/DashboardPage";
import SettingsPage from "@/pages/SettingsPage";
import ImportPage from "@/pages/ImportPage";
import ProcurementsPage from "@/pages/ProcurementsPage";
import OptimizationPrepPage from "@/pages/OptimizationPrepPage";
import LandingPage from "@/pages/LandingPage";
import ArticlesPage from "@/pages/ArticlesPage";
import PriceListsPage from "@/pages/PriceListsPage";
import OrderStockPage from "@/pages/OrderStockPage";
import VehiclesPage from "@/pages/VehiclesPage";
import SubscriptionsPage from "@/pages/SubscriptionsPage";
import PlanningParametersPage from "@/pages/PlanningParametersPage";
import SystemOverviewPage from "@/pages/SystemOverviewPage";
import ClustersPage from "@/pages/ClustersPage";
import ClusterDetailPage from "@/pages/ClusterDetailPage";
import EconomicsDashboardPage from "@/pages/EconomicsDashboardPage";
import SetupTimeAnalysisPage from "@/pages/SetupTimeAnalysisPage";
import PredictivePlanningPage from "@/pages/PredictivePlanningPage";
import MobileFieldPage from "@/pages/MobileFieldPage";
import SimpleFieldPage from "@/pages/SimpleFieldPage";
import AutoClusterPage from "@/pages/AutoClusterPage";
import WeatherPlanningPage from "@/pages/WeatherPlanningPage";
import CustomerPortalPage from "@/pages/CustomerPortalPage";
import SystemDashboardPage from "@/pages/SystemDashboardPage";
import { TenantBrandingProvider } from "@/components/TenantBrandingProvider";
import { Loader2 } from "lucide-react";

function Router() {
  return (
    <Switch>
      <Route path="/" component={WeekPlannerPage} />
      <Route path="/planner" component={WeekPlannerPage} />
      <Route path="/week-planner" component={WeekPlannerPage} />
      <Route path="/clusters" component={ClustersPage} />
      <Route path="/clusters/:id" component={ClusterDetailPage} />
      <Route path="/routes" component={RoutesPage} />
      <Route path="/optimization" component={OptimizationPrepPage} />
      <Route path="/objects" component={ObjectsPage} />
      <Route path="/resources" component={ResourcesPage} />
      <Route path="/procurements" component={ProcurementsPage} />
      <Route path="/articles" component={ArticlesPage} />
      <Route path="/price-lists" component={PriceListsPage} />
      <Route path="/order-stock" component={OrderStockPage} />
      <Route path="/vehicles" component={VehiclesPage} />
      <Route path="/subscriptions" component={SubscriptionsPage} />
      <Route path="/planning-parameters" component={PlanningParametersPage} />
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="/economics" component={EconomicsDashboardPage} />
      <Route path="/setup-analysis" component={SetupTimeAnalysisPage} />
      <Route path="/predictive-planning" component={PredictivePlanningPage} />
      <Route path="/mobile" component={MobileFieldPage} />
      <Route path="/field" component={SimpleFieldPage} />
      <Route path="/auto-cluster" component={AutoClusterPage} />
      <Route path="/weather" component={WeatherPlanningPage} />
      <Route path="/customer-portal" component={CustomerPortalPage} />
      <Route path="/import" component={ImportPage} />
      <Route path="/system-overview" component={SystemOverviewPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/system-dashboard" component={SystemDashboardPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  return (
    <TenantBrandingProvider>
      <div className="flex flex-col min-h-screen w-full">
        <TopNav />
        <main className="flex-1 overflow-auto">
          <ErrorBoundary>
            <Router />
          </ErrorBoundary>
        </main>
        <FloatingActionButton />
      </div>
    </TenantBrandingProvider>
  );
}

function AppContent() {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LandingPage />;
  }

  return <AuthenticatedApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppContent />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
