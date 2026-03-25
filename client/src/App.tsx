import { useEffect, useState, useCallback, lazy, Suspense } from "react";
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
import { TenantBrandingProvider } from "@/components/TenantBrandingProvider";
import { FeatureProvider } from "@/lib/feature-context";
import { TourProvider } from "@/hooks/use-tour";
import { TourGuide } from "@/components/TourGuide";
import { TourAutoStart } from "@/components/TourAutoStart";
import { Loader2 } from "lucide-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const NotFound = lazy(() => import("@/pages/not-found"));
const AccessDeniedPage = lazy(() => import("@/pages/AccessDeniedPage"));
const WeekPlannerPage = lazy(() => import("@/pages/WeekPlannerPage"));
const RoutesPage = lazy(() => import("@/pages/RoutesPage"));
const ObjectsPage = lazy(() => import("@/pages/ObjectsPage"));
const ObjectDetailPage = lazy(() => import("@/pages/ObjectDetailPage"));
const ResourcesPage = lazy(() => import("@/pages/ResourcesPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const ImportPage = lazy(() => import("@/pages/ImportPage"));
const ProcurementsPage = lazy(() => import("@/pages/ProcurementsPage"));
const OptimizationPrepPage = lazy(() => import("@/pages/OptimizationPrepPage"));
const LandingPage = lazy(() => import("@/pages/LandingPage"));
const ArticlesPage = lazy(() => import("@/pages/ArticlesPage"));
const PriceListsPage = lazy(() => import("@/pages/PriceListsPage"));
const OrderStockPage = lazy(() => import("@/pages/OrderStockPage"));
const VehiclesPage = lazy(() => import("@/pages/VehiclesPage"));
const SubscriptionsPage = lazy(() => import("@/pages/SubscriptionsPage"));
const PlanningParametersPage = lazy(() => import("@/pages/PlanningParametersPage"));
const OnboardingWizardPage = lazy(() => import("@/pages/OnboardingWizardPage"));
const SystemOverviewPage = lazy(() => import("@/pages/SystemOverviewPage"));
const ClustersPage = lazy(() => import("@/pages/ClustersPage"));
const ClusterDetailPage = lazy(() => import("@/pages/ClusterDetailPage"));
const EconomicsDashboardPage = lazy(() => import("@/pages/EconomicsDashboardPage"));
const SetupTimeAnalysisPage = lazy(() => import("@/pages/SetupTimeAnalysisPage"));
const PredictivePlanningPage = lazy(() => import("@/pages/PredictivePlanningPage"));
const AutoClusterPage = lazy(() => import("@/pages/AutoClusterPage"));
const WeatherPlanningPage = lazy(() => import("@/pages/WeatherPlanningPage"));
const CustomerPortalPage = lazy(() => import("@/pages/CustomerPortalPage"));
const CustomerReportsPage = lazy(() => import("@/pages/CustomerReportsPage"));
const PortalMessagesPage = lazy(() => import("@/pages/PortalMessagesPage"));
const BookingSlotsAdminPage = lazy(() => import("@/pages/BookingSlotsAdminPage"));
const SystemDashboardPage = lazy(() => import("@/pages/SystemDashboardPage"));
const IndustryPackagesPage = lazy(() => import("@/pages/IndustryPackagesPage"));
const MobileFieldPage = lazy(() => import("@/pages/MobileFieldPage"));
const ProjectReportPage = lazy(() => import("@/pages/ProjectReportPage"));
const MetadataPage = lazy(() => import("@/pages/MetadataPage"));
const MetadataSettingsPage = lazy(() => import("@/pages/MetadataSettingsPage"));
const FortnoxSettingsPage = lazy(() => import("@/pages/FortnoxSettingsPage"));
const MyTasksPage = lazy(() => import("@/pages/MyTasksPage"));
const MyReportsPage = lazy(() => import("@/pages/MyReportsPage"));
const ArchitecturePage = lazy(() => import("@/pages/architecture"));
const OrderConceptsPage = lazy(() => import("@/pages/OrderConceptsPage"));
const OrderConceptWizardPage = lazy(() => import("@/pages/OrderConceptWizardPage"));
const AssignmentsPage = lazy(() => import("@/pages/AssignmentsPage"));
const PitchPage = lazy(() => import("@/pages/PitchPage"));
const AIAssistantPage = lazy(() => import("@/pages/AIAssistantPage"));
const ReportingDashboardPage = lazy(() => import("@/pages/ReportingDashboardPage"));
const WorkflowGuidePage = lazy(() => import("@/pages/WorkflowGuidePage"));
const DataRequirementsPage = lazy(() => import("@/pages/DataRequirementsPage"));
const InvestorPitchPage = lazy(() => import("@/pages/InvestorPitchPage"));
const ApiCostsDashboardPage = lazy(() => import("@/pages/ApiCostsDashboardPage"));
const PortalLoginPage = lazy(() => import("@/pages/portal/PortalLoginPage"));
const PortalVerifyPage = lazy(() => import("@/pages/portal/PortalVerifyPage"));
const PortalDashboardPage = lazy(() => import("@/pages/portal/PortalDashboardPage"));
const PortalClusterOverviewPage = lazy(() => import("@/pages/portal/PortalClusterOverviewPage"));
const PortalInvoicesPage = lazy(() => import("@/pages/portal/PortalInvoicesPage"));
const PortalContractsPage = lazy(() => import("@/pages/portal/PortalContractsPage"));
const PortalSettingsPage = lazy(() => import("@/pages/portal/PortalSettingsPage"));
const PortalIssuesPage = lazy(() => import("@/pages/portal/PortalIssuesPage"));
const PortalDemoPage = lazy(() => import("@/pages/portal/PortalDemoPage"));
const PortalROIReportPage = lazy(() => import("@/pages/portal/PortalROIReportPage"));
const PortalFieldPage = lazy(() => import("@/pages/portal/PortalFieldPage"));
const AIPlanningPage = lazy(() => import("@/pages/AIPlanningPage"));
const AICommandCenterPage = lazy(() => import("@/pages/AICommandCenterPage"));
const FieldLoginPage = lazy(() => import("@/pages/FieldLoginPage"));
const PublicReportPage = lazy(() => import("@/pages/public-report"));
const SmsSettingsPage = lazy(() => import("@/pages/SmsSettingsPage"));
const EnvironmentalCertificatePage = lazy(() => import("@/pages/EnvironmentalCertificatePage"));
const LundstamsROIPage = lazy(() => import("@/pages/LundstamsROIPage"));
const ROIReportPage = lazy(() => import("@/pages/ROIReportPage"));
const InspectionSearchPage = lazy(() => import("@/pages/InspectionSearchPage"));
const InvoicingPage = lazy(() => import("@/pages/InvoicingPage"));
const FleetManagementPage = lazy(() => import("@/pages/FleetManagementPage"));
const ProactiveSalesPage = lazy(() => import("@/pages/ProactiveSalesPage"));
const PlannerMapPage = lazy(() => import("@/pages/PlannerMapPage"));
const HistoricalMapPage = lazy(() => import("@/pages/HistoricalMapPage"));
const ChecklistTemplatesPage = lazy(() => import("@/pages/ChecklistTemplatesPage"));
const UserManagementPage = lazy(() => import("@/pages/UserManagementPage"));
const TenantConfigPage = lazy(() => import("@/pages/TenantConfigPage"));
const WorkSessionsPage = lazy(() => import("@/pages/WorkSessionsPage"));
const AnnualPlanningPage = lazy(() => import("@/pages/AnnualPlanningPage"));
const PredictiveMaintenancePage = lazy(() => import("@/pages/PredictiveMaintenancePage"));
const ModuleUpgradePage = lazy(() => import("@/pages/ModuleUpgradePage"));
const TelephonyPage = lazy(() => import("@/pages/TelephonyPage"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Laddar sida...</p>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
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
        <Route path="/customer-reports">{() => <ProtectedRoute component={CustomerReportsPage} path="/customer-reports" />}</Route>
        <Route path="/portal-messages">{() => <ProtectedRoute component={PortalMessagesPage} path="/portal-messages" />}</Route>
        <Route path="/booking-slots">{() => <ProtectedRoute component={BookingSlotsAdminPage} path="/booking-slots" />}</Route>
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
        <Route path="/proactive-sales">{() => <ProtectedRoute component={ProactiveSalesPage} path="/proactive-sales" />}</Route>
        <Route path="/workflow-guide">{() => <ProtectedRoute component={WorkflowGuidePage} path="/workflow-guide" />}</Route>
        <Route path="/data-requirements">{() => <ProtectedRoute component={DataRequirementsPage} path="/data-requirements" />}</Route>
        <Route path="/investor-pitch">{() => <ProtectedRoute component={InvestorPitchPage} path="/investor-pitch" />}</Route>
        <Route path="/ai-planning">{() => <ProtectedRoute component={AIPlanningPage} path="/ai-planning" />}</Route>
        <Route path="/ai-command-center">{() => <ProtectedRoute component={AICommandCenterPage} path="/ai-command-center" />}</Route>
        <Route path="/lundstams-roi">{() => <ProtectedRoute component={LundstamsROIPage} path="/lundstams-roi" />}</Route>
        <Route path="/roi-report">{() => <ProtectedRoute component={ROIReportPage} path="/roi-report" />}</Route>
        <Route path="/inspections">{() => <ProtectedRoute component={InspectionSearchPage} path="/inspections" />}</Route>
        <Route path="/planner-map">{() => <ProtectedRoute component={PlannerMapPage} path="/planner-map" />}</Route>
        <Route path="/historical-map">{() => <ProtectedRoute component={HistoricalMapPage} path="/historical-map" />}</Route>
        <Route path="/checklist-templates">{() => <ProtectedRoute component={ChecklistTemplatesPage} path="/checklist-templates" />}</Route>
        <Route path="/work-sessions">{() => <ProtectedRoute component={WorkSessionsPage} path="/work-sessions" />}</Route>
        <Route path="/annual-planning">{() => <ProtectedRoute component={AnnualPlanningPage} path="/annual-planning" />}</Route>
        <Route path="/predictive-maintenance">{() => <ProtectedRoute component={PredictiveMaintenancePage} path="/predictive-maintenance" />}</Route>
        <Route path="/telephony">{() => <ProtectedRoute component={TelephonyPage} path="/telephony" />}</Route>
        <Route path="/my-reports">{() => <ProtectedRoute component={MyReportsPage} path="/my-reports" />}</Route>
        <Route path="/tenant-config">{() => <ProtectedRoute component={TenantConfigPage} path="/tenant-config" />}</Route>
        <Route path="/onboarding">{() => <ProtectedRoute component={OnboardingWizardPage} path="/onboarding" />}</Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function PortalRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
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
        <Route path="/portal/roi-report" component={PortalROIReportPage} />
        <Route path="/portal/field" component={PortalFieldPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function FieldAppContent() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <div className="min-h-screen bg-background">
          <MobileFieldPage />
        </div>
      </Suspense>
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
  const { isAuthenticated, isLoading, accessGranted } = useAuth();
  const { showSplash, dismissSplash } = useLoginSplash();
  
  const isPendingFieldRedirect = useFieldLoginRedirect();
  
  if (isPendingFieldRedirect) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Öppnar Traivo Go...</p>
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

  if (location.startsWith("/report/")) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <PublicReportPage />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (location === "/field" || location === "/mobile" || location === "/simple") {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Laddar Traivo Go...</p>
          </div>
        </div>
      );
    }
    
    if (!isAuthenticated) {
      return (
        <Suspense fallback={<PageLoader />}>
          <FieldLoginPage />
        </Suspense>
      );
    }
    
    if (!accessGranted) {
      return (
        <Suspense fallback={<PageLoader />}>
          <AccessDeniedPage />
        </Suspense>
      );
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
    return (
      <Suspense fallback={<PageLoader />}>
        <LandingPage />
      </Suspense>
    );
  }

  if (!accessGranted) {
    return (
      <Suspense fallback={<PageLoader />}>
        <AccessDeniedPage />
      </Suspense>
    );
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
      <FeatureProvider>
        <ThemeProvider>
          <TooltipProvider>
            <AppContent />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </FeatureProvider>
    </QueryClientProvider>
  );
}
