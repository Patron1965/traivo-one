import { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopNav } from "@/components/layout/TopNav";
import { FloatingActionButton } from "@/components/layout/FloatingActionButton";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/hooks/use-auth";
import { ThemeProvider, useTheme } from "@/hooks/use-theme";
import { CommandPalette } from "@/components/CommandPalette";
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
import OnboardingWizardPage from "@/pages/OnboardingWizardPage";
import SystemOverviewPage from "@/pages/SystemOverviewPage";
import ClustersPage from "@/pages/ClustersPage";
import ClusterDetailPage from "@/pages/ClusterDetailPage";
import EconomicsDashboardPage from "@/pages/EconomicsDashboardPage";
import SetupTimeAnalysisPage from "@/pages/SetupTimeAnalysisPage";
import PredictivePlanningPage from "@/pages/PredictivePlanningPage";
import AutoClusterPage from "@/pages/AutoClusterPage";
import WeatherPlanningPage from "@/pages/WeatherPlanningPage";
import CustomerPortalPage from "@/pages/CustomerPortalPage";
import PortalMessagesPage from "@/pages/PortalMessagesPage";
import SystemDashboardPage from "@/pages/SystemDashboardPage";
import IndustryPackagesPage from "@/pages/IndustryPackagesPage";
import MobileFieldPage from "@/pages/MobileFieldPage";
import ProjectReportPage from "@/pages/ProjectReportPage";
import MetadataPage from "@/pages/MetadataPage";
import MetadataSettingsPage from "@/pages/MetadataSettingsPage";
import FortnoxSettingsPage from "@/pages/FortnoxSettingsPage";
import MyTasksPage from "@/pages/MyTasksPage";
import ArchitecturePage from "@/pages/architecture";
import OrderConceptsPage from "@/pages/OrderConceptsPage";
import AssignmentsPage from "@/pages/AssignmentsPage";
import PitchPage from "@/pages/PitchPage";
import AIAssistantPage from "@/pages/AIAssistantPage";
import ReportingDashboardPage from "@/pages/ReportingDashboardPage";
import WorkflowGuidePage from "@/pages/WorkflowGuidePage";
import DataRequirementsPage from "@/pages/DataRequirementsPage";
import InvestorPitchPage from "@/pages/InvestorPitchPage";
import ApiCostsDashboardPage from "@/pages/ApiCostsDashboardPage";
import PortalLoginPage from "@/pages/portal/PortalLoginPage";
import PortalVerifyPage from "@/pages/portal/PortalVerifyPage";
import PortalDashboardPage from "@/pages/portal/PortalDashboardPage";
import PortalClusterOverviewPage from "@/pages/portal/PortalClusterOverviewPage";
import PortalInvoicesPage from "@/pages/portal/PortalInvoicesPage";
import PortalContractsPage from "@/pages/portal/PortalContractsPage";
import PortalSettingsPage from "@/pages/portal/PortalSettingsPage";
import PortalIssuesPage from "@/pages/portal/PortalIssuesPage";
import PortalDemoPage from "@/pages/portal/PortalDemoPage";
import AIPlanningPage from "@/pages/AIPlanningPage";
import AICommandCenterPage from "@/pages/AICommandCenterPage";
import FieldLoginPage from "@/pages/FieldLoginPage";
import PublicReportPage from "@/pages/public-report";
import SmsSettingsPage from "@/pages/SmsSettingsPage";
import EnvironmentalCertificatePage from "@/pages/EnvironmentalCertificatePage";
import LundstamsROIPage from "@/pages/LundstamsROIPage";
import InspectionSearchPage from "@/pages/InspectionSearchPage";
import InvoicingPage from "@/pages/InvoicingPage";
import FleetManagementPage from "@/pages/FleetManagementPage";
import PlannerMapPage from "@/pages/PlannerMapPage";
import HistoricalMapPage from "@/pages/HistoricalMapPage";
import ChecklistTemplatesPage from "@/pages/ChecklistTemplatesPage";
import UserManagementPage from "@/pages/UserManagementPage";
import TenantConfigPage from "@/pages/TenantConfigPage";
import { TenantBrandingProvider } from "@/components/TenantBrandingProvider";
import { TourProvider } from "@/hooks/use-tour";
import { TourGuide } from "@/components/TourGuide";
import { TourAutoStart } from "@/components/TourAutoStart";
import { Loader2 } from "lucide-react";

function Router() {
  return (
    <Switch>
      <Route path="/" component={MyTasksPage} />
      <Route path="/home" component={MyTasksPage} />
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
      <Route path="/auto-cluster" component={AutoClusterPage} />
      <Route path="/weather" component={WeatherPlanningPage} />
      <Route path="/customer-portal" component={CustomerPortalPage} />
      <Route path="/portal-messages" component={PortalMessagesPage} />
      <Route path="/import" component={ImportPage} />
      <Route path="/system-overview" component={SystemOverviewPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/system-dashboard" component={SystemDashboardPage} />
      <Route path="/industry-packages" component={IndustryPackagesPage} />
      <Route path="/mobile" component={MobileFieldPage} />
      <Route path="/field" component={MobileFieldPage} />
      <Route path="/simple" component={MobileFieldPage} />
      <Route path="/project-report" component={ProjectReportPage} />
      <Route path="/metadata" component={MetadataPage} />
      <Route path="/metadata-settings" component={MetadataSettingsPage} />
      <Route path="/invoicing" component={InvoicingPage} />
      <Route path="/fleet" component={FleetManagementPage} />
      <Route path="/user-management" component={UserManagementPage} />
      <Route path="/fortnox" component={FortnoxSettingsPage} />
      <Route path="/sms-settings" component={SmsSettingsPage} />
      <Route path="/api-costs" component={ApiCostsDashboardPage} />
      <Route path="/environmental-certificates" component={EnvironmentalCertificatePage} />
      <Route path="/architecture" component={ArchitecturePage} />
      <Route path="/order-concepts" component={OrderConceptsPage} />
      <Route path="/assignments" component={AssignmentsPage} />
      <Route path="/pitch" component={PitchPage} />
      <Route path="/ai-assistant" component={AIAssistantPage} />
      <Route path="/reporting" component={ReportingDashboardPage} />
      <Route path="/workflow-guide" component={WorkflowGuidePage} />
      <Route path="/data-requirements" component={DataRequirementsPage} />
      <Route path="/investor-pitch" component={InvestorPitchPage} />
      <Route path="/ai-planning" component={AIPlanningPage} />
      <Route path="/ai-command-center" component={AICommandCenterPage} />
      <Route path="/lundstams-roi" component={LundstamsROIPage} />
      <Route path="/inspections" component={InspectionSearchPage} />
      <Route path="/planner-map" component={PlannerMapPage} />
      <Route path="/historical-map" component={HistoricalMapPage} />
      <Route path="/checklist-templates" component={ChecklistTemplatesPage} />
      <Route path="/tenant-config" component={TenantConfigPage} />
      <Route path="/onboarding" component={OnboardingWizardPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function PortalRouter() {
  return (
    <Switch>
      <Route path="/portal" component={PortalLoginPage} />
      <Route path="/portal/demo" component={PortalDemoPage} />
      <Route path="/portal/verify" component={PortalVerifyPage} />
      <Route path="/portal/dashboard" component={PortalDashboardPage} />
      <Route path="/portal/clusters" component={PortalClusterOverviewPage} />
      <Route path="/portal/invoices" component={PortalInvoicesPage} />
      <Route path="/portal/contracts" component={PortalContractsPage} />
      <Route path="/portal/settings" component={PortalSettingsPage} />
      <Route path="/portal/issues" component={PortalIssuesPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function FieldAppContent() {
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background">
        <MobileFieldPage />
      </div>
    </ErrorBoundary>
  );
}

function useFieldLoginRedirect() {
  const [location, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();
  
  useEffect(() => {
    const fieldRedirect = sessionStorage.getItem("field_login_redirect");
    if (fieldRedirect && isAuthenticated && location !== fieldRedirect) {
      sessionStorage.removeItem("field_login_redirect");
      setLocation(fieldRedirect);
    }
  }, [isAuthenticated, setLocation, location]);
  
  return sessionStorage.getItem("field_login_redirect") !== null;
}

function AppContent() {
  const [location] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  
  const isPendingFieldRedirect = useFieldLoginRedirect();
  
  if (isPendingFieldRedirect) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Öppnar fältappen...</p>
        </div>
      </div>
    );
  }

  if (location.startsWith("/portal")) {
    return (
      <ErrorBoundary>
        <PortalRouter />
      </ErrorBoundary>
    );
  }

  // Public issue report page - no auth required
  if (location.startsWith("/report/")) {
    return (
      <ErrorBoundary>
        <PublicReportPage />
      </ErrorBoundary>
    );
  }

  // Standalone field app - no navigation, just the field app
  if (location === "/field" || location === "/mobile" || location === "/simple") {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Laddar fältappen...</p>
          </div>
        </div>
      );
    }
    
    if (!isAuthenticated) {
      return <FieldLoginPage />;
    }
    
    return <FieldAppContent />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Laddar...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LandingPage />;
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const { theme, toggleTheme } = useTheme();
  
  return (
    <TenantBrandingProvider>
      <TourProvider>
        <div className="flex flex-col min-h-screen bg-background pb-16 md:pb-0">
          <TopNav />
          <main className="flex-1">
            <ErrorBoundary>
              <Router />
            </ErrorBoundary>
          </main>
          <FloatingActionButton />
          <MobileBottomNav />
          <CommandPalette onThemeToggle={toggleTheme} currentTheme={theme} />
          <TourGuide />
          <TourAutoStart />
        </div>
      </TourProvider>
    </TenantBrandingProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AppContent />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
