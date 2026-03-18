import { useEffect, useState, useCallback } from "react";
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
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
import { WelcomeSplash } from "@/components/WelcomeSplash";
import NotFound from "@/pages/not-found";
import WeekPlannerPage from "@/pages/WeekPlannerPage";
import RoutesPage from "@/pages/RoutesPage";
import ObjectsPage from "@/pages/ObjectsPage";
import ObjectDetailPage from "@/pages/ObjectDetailPage";
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
import MyReportsPage from "@/pages/MyReportsPage";
import ArchitecturePage from "@/pages/architecture";
import OrderConceptsPage from "@/pages/OrderConceptsPage";
import OrderConceptWizardPage from "@/pages/OrderConceptWizardPage";
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
import WorkSessionsPage from "@/pages/WorkSessionsPage";
import { TenantBrandingProvider } from "@/components/TenantBrandingProvider";
import { TourProvider } from "@/hooks/use-tour";
import { TourGuide } from "@/components/TourGuide";
import { TourAutoStart } from "@/components/TourAutoStart";
import { Loader2 } from "lucide-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";

function Router() {
  return (
    <Switch>
      <Route path="/">{() => <ProtectedRoute component={MyTasksPage} path="/" />}</Route>
      <Route path="/home">{() => <ProtectedRoute component={MyTasksPage} path="/home" />}</Route>
      <Route path="/planner">{() => <ProtectedRoute component={WeekPlannerPage} path="/planner" />}</Route>
      <Route path="/week-planner">{() => <ProtectedRoute component={WeekPlannerPage} path="/week-planner" />}</Route>
      <Route path="/clusters">{() => <ProtectedRoute component={ClustersPage} path="/clusters" />}</Route>
      <Route path="/clusters/:id">{() => <ProtectedRoute component={ClusterDetailPage} path="/clusters" />}</Route>
      <Route path="/routes">{() => <ProtectedRoute component={RoutesPage} path="/routes" />}</Route>
      <Route path="/optimization">{() => <ProtectedRoute component={OptimizationPrepPage} path="/optimization" />}</Route>
      <Route path="/objects/:id">{() => <ProtectedRoute component={ObjectDetailPage} path="/objects" />}</Route>
      <Route path="/objects">{() => <ProtectedRoute component={ObjectsPage} path="/objects" />}</Route>
      <Route path="/resources">{() => <ProtectedRoute component={ResourcesPage} path="/resources" />}</Route>
      <Route path="/procurements">{() => <ProtectedRoute component={ProcurementsPage} path="/procurements" />}</Route>
      <Route path="/articles">{() => <ProtectedRoute component={ArticlesPage} path="/articles" />}</Route>
      <Route path="/price-lists">{() => <ProtectedRoute component={PriceListsPage} path="/price-lists" />}</Route>
      <Route path="/order-stock">{() => <ProtectedRoute component={OrderStockPage} path="/order-stock" />}</Route>
      <Route path="/vehicles">{() => <ProtectedRoute component={VehiclesPage} path="/vehicles" />}</Route>
      <Route path="/subscriptions">{() => <ProtectedRoute component={SubscriptionsPage} path="/subscriptions" />}</Route>
      <Route path="/planning-parameters">{() => <ProtectedRoute component={PlanningParametersPage} path="/planning-parameters" />}</Route>
      <Route path="/dashboard">{() => <ProtectedRoute component={DashboardPage} path="/dashboard" />}</Route>
      <Route path="/economics">{() => <ProtectedRoute component={EconomicsDashboardPage} path="/economics" />}</Route>
      <Route path="/setup-analysis">{() => <ProtectedRoute component={SetupTimeAnalysisPage} path="/setup-analysis" />}</Route>
      <Route path="/predictive-planning">{() => <ProtectedRoute component={PredictivePlanningPage} path="/predictive-planning" />}</Route>
      <Route path="/auto-cluster">{() => <ProtectedRoute component={AutoClusterPage} path="/auto-cluster" />}</Route>
      <Route path="/weather">{() => <ProtectedRoute component={WeatherPlanningPage} path="/weather" />}</Route>
      <Route path="/customer-portal">{() => <ProtectedRoute component={CustomerPortalPage} path="/customer-portal" />}</Route>
      <Route path="/portal-messages">{() => <ProtectedRoute component={PortalMessagesPage} path="/portal-messages" />}</Route>
      <Route path="/import">{() => <ProtectedRoute component={ImportPage} path="/import" />}</Route>
      <Route path="/system-overview">{() => <ProtectedRoute component={SystemOverviewPage} path="/system-overview" />}</Route>
      <Route path="/settings">{() => <ProtectedRoute component={SettingsPage} path="/settings" />}</Route>
      <Route path="/system-dashboard">{() => <ProtectedRoute component={SystemDashboardPage} path="/system-dashboard" />}</Route>
      <Route path="/industry-packages">{() => <ProtectedRoute component={IndustryPackagesPage} path="/industry-packages" />}</Route>
      <Route path="/mobile">{() => <ProtectedRoute component={MobileFieldPage} path="/mobile" />}</Route>
      <Route path="/field">{() => <ProtectedRoute component={MobileFieldPage} path="/field" />}</Route>
      <Route path="/simple">{() => <ProtectedRoute component={MobileFieldPage} path="/simple" />}</Route>
      <Route path="/project-report">{() => <ProtectedRoute component={ProjectReportPage} path="/project-report" />}</Route>
      <Route path="/metadata">{() => <ProtectedRoute component={MetadataPage} path="/metadata" />}</Route>
      <Route path="/metadata-settings">{() => <ProtectedRoute component={MetadataSettingsPage} path="/metadata-settings" />}</Route>
      <Route path="/invoicing">{() => <ProtectedRoute component={InvoicingPage} path="/invoicing" />}</Route>
      <Route path="/fleet">{() => <ProtectedRoute component={FleetManagementPage} path="/fleet" />}</Route>
      <Route path="/user-management">{() => <ProtectedRoute component={UserManagementPage} path="/user-management" />}</Route>
      <Route path="/fortnox">{() => <ProtectedRoute component={FortnoxSettingsPage} path="/fortnox" />}</Route>
      <Route path="/sms-settings">{() => <ProtectedRoute component={SmsSettingsPage} path="/sms-settings" />}</Route>
      <Route path="/api-costs">{() => <ProtectedRoute component={ApiCostsDashboardPage} path="/api-costs" />}</Route>
      <Route path="/environmental-certificates">{() => <ProtectedRoute component={EnvironmentalCertificatePage} path="/environmental-certificates" />}</Route>
      <Route path="/architecture">{() => <ProtectedRoute component={ArchitecturePage} path="/architecture" />}</Route>
      <Route path="/order-concepts">{() => <ProtectedRoute component={OrderConceptsPage} path="/order-concepts" />}</Route>
      <Route path="/order-concepts/new">{() => <ProtectedRoute component={OrderConceptWizardPage} path="/order-concepts" />}</Route>
      <Route path="/order-concepts/:id/edit">{() => <ProtectedRoute component={OrderConceptWizardPage} path="/order-concepts" />}</Route>
      <Route path="/assignments">{() => <ProtectedRoute component={AssignmentsPage} path="/assignments" />}</Route>
      <Route path="/pitch">{() => <ProtectedRoute component={PitchPage} path="/pitch" />}</Route>
      <Route path="/ai-assistant">{() => <ProtectedRoute component={AIAssistantPage} path="/ai-assistant" />}</Route>
      <Route path="/reporting">{() => <ProtectedRoute component={ReportingDashboardPage} path="/reporting" />}</Route>
      <Route path="/workflow-guide">{() => <ProtectedRoute component={WorkflowGuidePage} path="/workflow-guide" />}</Route>
      <Route path="/data-requirements">{() => <ProtectedRoute component={DataRequirementsPage} path="/data-requirements" />}</Route>
      <Route path="/investor-pitch">{() => <ProtectedRoute component={InvestorPitchPage} path="/investor-pitch" />}</Route>
      <Route path="/ai-planning">{() => <ProtectedRoute component={AIPlanningPage} path="/ai-planning" />}</Route>
      <Route path="/ai-command-center">{() => <ProtectedRoute component={AICommandCenterPage} path="/ai-command-center" />}</Route>
      <Route path="/lundstams-roi">{() => <ProtectedRoute component={LundstamsROIPage} path="/lundstams-roi" />}</Route>
      <Route path="/inspections">{() => <ProtectedRoute component={InspectionSearchPage} path="/inspections" />}</Route>
      <Route path="/planner-map">{() => <ProtectedRoute component={PlannerMapPage} path="/planner-map" />}</Route>
      <Route path="/historical-map">{() => <ProtectedRoute component={HistoricalMapPage} path="/historical-map" />}</Route>
      <Route path="/checklist-templates">{() => <ProtectedRoute component={ChecklistTemplatesPage} path="/checklist-templates" />}</Route>
      <Route path="/work-sessions">{() => <ProtectedRoute component={WorkSessionsPage} path="/work-sessions" />}</Route>
      <Route path="/my-reports">{() => <ProtectedRoute component={MyReportsPage} path="/my-reports" />}</Route>
      <Route path="/tenant-config">{() => <ProtectedRoute component={TenantConfigPage} path="/tenant-config" />}</Route>
      <Route path="/onboarding">{() => <ProtectedRoute component={OnboardingWizardPage} path="/onboarding" />}</Route>
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

function useLoginSplash() {
  const [showSplash, setShowSplash] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("login") === "1") {
      const url = new URL(window.location.href);
      url.searchParams.delete("login");
      window.history.replaceState({}, "", url.pathname + url.search);
      return true;
    }
    return false;
  });

  const dismissSplash = useCallback(() => setShowSplash(false), []);

  return { showSplash, dismissSplash };
}

function AppContent() {
  const [location] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const { showSplash, dismissSplash } = useLoginSplash();
  
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

  return (
    <TenantBrandingProvider>
      {showSplash && <WelcomeSplash onComplete={dismissSplash} />}
      <AuthenticatedApp />
    </TenantBrandingProvider>
  );
}

function TechnicianRedirect() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (user?.role === "technician" && location !== "/mobile" && location !== "/field" && location !== "/simple" && location !== "/settings") {
      setLocation("/mobile");
    }
  }, [user, location, setLocation]);

  return null;
}

function AuthenticatedApp() {
  const { theme, toggleTheme } = useTheme();
  const [location] = useLocation();
  const hideFloatingButton = location.startsWith("/order-concepts/new") || location.includes("/edit");
  
  return (
    <TourProvider>
      <div className="flex flex-col min-h-screen bg-background pb-16 md:pb-0">
        <TechnicianRedirect />
        <TopNav />
        <main className="flex-1">
          <ErrorBoundary>
            <Router />
          </ErrorBoundary>
        </main>
        {!hideFloatingButton && <FloatingActionButton />}
        <MobileBottomNav />
        <CommandPalette onThemeToggle={toggleTheme} currentTheme={theme} />
        <KeyboardShortcutsDialog />
        <TourGuide />
        <TourAutoStart />
      </div>
    </TourProvider>
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
