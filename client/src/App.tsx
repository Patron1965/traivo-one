import { useEffect, useState, lazy, Suspense } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopNav } from "@/components/layout/TopNav";
import { DegradedModeBanner } from "@/components/layout/DegradedModeBanner";
import { FloatingActionButton } from "@/components/layout/FloatingActionButton";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/hooks/use-auth";
import { ThemeProvider, useTheme } from "@/hooks/use-theme";
import { LanguageProvider } from "@/hooks/use-language";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcutsDialog } from "@/components/KeyboardShortcutsDialog";
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
const WeeklyPlanViewPage = lazy(() => import("@/pages/WeeklyPlanViewPage"));
const GrovplaneringPage = lazy(() => import("@/pages/GrovplaneringPage"));
const PlaneringsHubPage = lazy(() => import("@/pages/PlaneringsHubPage"));
const DistrictsAdminPage = lazy(() => import("@/pages/DistrictsAdminPage"));
const RoutesPage = lazy(() => import("@/pages/RoutesPage"));
const ObjectsPage = lazy(() => import("@/pages/ObjectsPage"));
const ObjectDetailPage = lazy(() => import("@/pages/ObjectDetailPage"));
const WorkOrderDetailPage = lazy(() => import("@/pages/WorkOrderDetailPage"));
const ObjectDuplicatesPage = lazy(() => import("@/pages/ObjectDuplicatesPage"));
const MissingCoordinatesPage = lazy(() => import("@/pages/MissingCoordinatesPage"));
const ResourcesPage = lazy(() => import("@/pages/ResourcesPage"));
const ExecutorRegisterPage = lazy(() => import("@/pages/ExecutorRegisterPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const ImportPage = lazy(() => import("@/pages/ImportPage"));
const ObjektmallImportPage = lazy(() => import("@/pages/admin/ObjektmallImportPage"));
const ImportTemplatesPage = lazy(() => import("@/pages/admin/ImportTemplatesPage"));
const ArticleTypesPage = lazy(() => import("@/pages/admin/ArticleTypesPage"));
const ExecutionCodesPage = lazy(() => import("@/pages/admin/ExecutionCodesPage"));
const TimeCodesPage = lazy(() => import("@/pages/admin/TimeCodesPage"));
const IconsPage = lazy(() => import("@/pages/admin/IconsPage"));
const ProcurementsPage = lazy(() => import("@/pages/ProcurementsPage"));
const OptimizationPrepPage = lazy(() => import("@/pages/OptimizationPrepPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const ArticlesPage = lazy(() => import("@/pages/ArticlesPage"));
const ArticleFormPage = lazy(() => import("@/pages/ArticleFormPage"));
const PriceListsPage = lazy(() => import("@/pages/PriceListsPage"));
const OrderStockPage = lazy(() => import("@/pages/OrderStockPage"));
const VehiclesPage = lazy(() => import("@/pages/VehiclesPage"));
const SubscriptionsPage = lazy(() => import("@/pages/SubscriptionsPage"));
const PlanningParametersPage = lazy(() => import("@/pages/PlanningParametersPage"));
const PlannerSearchFiltersPage = lazy(() => import("@/pages/PlannerSearchFiltersPage"));
const ArticleComponentsPage = lazy(() => import("@/pages/ArticleComponentsPage"));
const SuppliersPage = lazy(() => import("@/pages/SuppliersPage"));
const ProductionTimeListsPage = lazy(() => import("@/pages/ProductionTimeListsPage"));
const StructureArticlesPage = lazy(() => import("@/pages/StructureArticlesPage"));
const InvoiceRecalculationLogPage = lazy(() => import("@/pages/InvoiceRecalculationLogPage"));
const InvoiceQueuePage = lazy(() => import("@/pages/InvoiceQueuePage"));
const OnboardingWizardPage = lazy(() => import("@/pages/OnboardingWizardPage"));
const SystemOverviewPage = lazy(() => import("@/pages/SystemOverviewPage"));
const ClustersPage = lazy(() => import("@/pages/ClustersPage"));
const ClusterDetailPage = lazy(() => import("@/pages/ClusterDetailPage"));
const EconomicsDashboardPage = lazy(() => import("@/pages/EconomicsDashboardPage"));
const SetupTimeAnalysisPage = lazy(() => import("@/pages/SetupTimeAnalysisPage"));
const PredictivePlanningPage = lazy(() => import("@/pages/PredictivePlanningPage"));
const CustomerPortalPage = lazy(() => import("@/pages/CustomerPortalPage"));
const CustomerReportsPage = lazy(() => import("@/pages/CustomerReportsPage"));
const CasesPage = lazy(() => import("@/pages/CasesPage"));
const DynamicReportPage = lazy(() => import("@/pages/DynamicReportPage"));
const PortalMessagesPage = lazy(() => import("@/pages/PortalMessagesPage"));
const BookingSlotsAdminPage = lazy(() => import("@/pages/BookingSlotsAdminPage"));
const SystemDashboardPage = lazy(() => import("@/pages/SystemDashboardPage"));
const IndustryPackagesPage = lazy(() => import("@/pages/IndustryPackagesPage"));
const MobileFieldPage = lazy(() => import("@/pages/MobileFieldPage"));
const ProjectReportPage = lazy(() => import("@/pages/ProjectReportPage"));
const MetadataSettingsPage = lazy(() => import("@/pages/MetadataSettingsPage"));
const MetadataDefinitionsPage = lazy(() => import("@/pages/MetadataDefinitionsPage"));
const MetadataEditorsPage = lazy(() => import("@/pages/MetadataEditorsPage"));
const MetadataEditorReviewPage = lazy(() => import("@/pages/MetadataEditorReviewPage"));
const MetadataEditorPublicPage = lazy(() => import("@/pages/MetadataEditorPublicPage"));
const OrderTypeMetadataPage = lazy(() => import("@/pages/OrderTypeMetadataPage"));
const FortnoxSettingsPage = lazy(() => import("@/pages/FortnoxSettingsPage"));
const MyTasksPage = lazy(() => import("@/pages/MyTasksPage"));
const MyReportsPage = lazy(() => import("@/pages/MyReportsPage"));
const ArchitecturePage = lazy(() => import("@/pages/architecture"));
const OrderConceptsPage = lazy(() => import("@/pages/OrderConceptsPage"));
const OrderConceptWizardPage = lazy(() => import("@/pages/OrderConceptWizardPage"));
const AssignmentsPage = lazy(() => import("@/pages/AssignmentsPage"));
const AIAssistantPage = lazy(() => import("@/pages/AIAssistantPage"));
const ReportingDashboardPage = lazy(() => import("@/pages/ReportingDashboardPage"));
const WeeklyReportPage = lazy(() => import("@/pages/WeeklyReportPage"));
const WorkflowGuidePage = lazy(() => import("@/pages/WorkflowGuidePage"));
const DataRequirementsPage = lazy(() => import("@/pages/DataRequirementsPage"));
const ApiCostsDashboardPage = lazy(() => import("@/pages/ApiCostsDashboardPage"));
const MLDataQualityPage = lazy(() => import("@/pages/MLDataQualityPage"));
const RestoreDormantCustomersPage = lazy(() => import("@/pages/admin/RestoreDormantCustomersPage"));
const ShadowComparisonPage = lazy(() => import("@/pages/admin/ShadowComparisonPage"));
const ArchivePage = lazy(() => import("@/pages/ArchivePage"));
const PlatformAdminPage = lazy(() => import("@/pages/PlatformAdminPage"));
const PortalLoginPage = lazy(() => import("@/pages/portal/PortalLoginPage"));
const PortalVerifyPage = lazy(() => import("@/pages/portal/PortalVerifyPage"));
const PortalDashboardPage = lazy(() => import("@/pages/portal/PortalDashboardPage"));
const PortalClusterOverviewPage = lazy(() => import("@/pages/portal/PortalClusterOverviewPage"));
const PortalCalendarPage = lazy(() => import("@/pages/portal/PortalCalendarPage"));
const PortalInvoicesPage = lazy(() => import("@/pages/portal/PortalInvoicesPage"));
const PortalContractsPage = lazy(() => import("@/pages/portal/PortalContractsPage"));
const PortalSettingsPage = lazy(() => import("@/pages/portal/PortalSettingsPage"));
const PortalIssuesPage = lazy(() => import("@/pages/portal/PortalIssuesPage"));
const PortalDemoPage = lazy(() => import("@/pages/portal/PortalDemoPage"));
const PortalROIReportPage = lazy(() => import("@/pages/portal/PortalROIReportPage"));
const PortalFieldPage = lazy(() => import("@/pages/portal/PortalFieldPage"));
const PortalMapPage = lazy(() => import("@/pages/portal/PortalMapPage"));
const PortalCompletedJobsPage = lazy(() => import("@/pages/portal/PortalCompletedJobsPage"));
const PortalExecutionPage = lazy(() => import("@/pages/portal/PortalExecutionPage"));
const AIPlanningPage = lazy(() => import("@/pages/AIPlanningPage"));
const AICommandCenterPage = lazy(() => import("@/pages/AICommandCenterPage"));
const FieldLoginPage = lazy(() => import("@/pages/FieldLoginPage"));
const PublicReportPage = lazy(() => import("@/pages/public-report"));
const PublicFeedbackPage = lazy(() => import("@/pages/public-feedback"));
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
const ExecutionTypesPage = lazy(() => import("@/pages/ExecutionTypesPage"));
const WorkSessionsPage = lazy(() => import("@/pages/WorkSessionsPage"));
const AnnualPlanningPage = lazy(() => import("@/pages/AnnualPlanningPage"));
const PredictiveMaintenancePage = lazy(() => import("@/pages/PredictiveMaintenancePage"));
const ModuleUpgradePage = lazy(() => import("@/pages/ModuleUpgradePage"));
const TelephonyPage = lazy(() => import("@/pages/TelephonyPage"));
const MonitorPopoutPage = lazy(() => import("@/pages/MonitorPopoutPage"));
const PlannerPopoutPage = lazy(() => import("@/pages/PlannerPopoutPage"));
const ControlTowerPage = lazy(() => import("@/pages/ControlTowerPage"));
const UnitManagerPage = lazy(() => import("@/pages/UnitManagerPage"));
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"));
const CustomersPage = lazy(() => import("@/pages/CustomersPage"));
const CustomerDetailPage = lazy(() => import("@/pages/CustomerDetailPage"));

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
        <Route path="/home">{() => <Redirect to="/" />}</Route>
        <Route path="/planering">{() => <ProtectedRoute component={PlaneringsHubPage} path="/planering" />}</Route>
        <Route path="/planner">{() => <ProtectedRoute component={WeekPlannerPage} path="/planner" />}</Route>
        <Route path="/week-planner">{() => <Redirect to="/planner" />}</Route>
        <Route path="/veckoplan">{() => <ProtectedRoute component={WeeklyPlanViewPage} path="/veckoplan" />}</Route>
        <Route path="/veckoplanering">{() => <ProtectedRoute component={WeeklyPlanViewPage} path="/veckoplan" />}</Route>
        <Route path="/grovplanering">{() => <ProtectedRoute component={GrovplaneringPage} path="/grovplanering" />}</Route>
        <Route path="/distrikt">{() => <ProtectedRoute component={DistrictsAdminPage} path="/distrikt" />}</Route>
        <Route path="/clusters">{() => <ProtectedRoute component={ClustersPage} path="/clusters" />}</Route>
        <Route path="/clusters/:id">{() => <ProtectedRoute component={ClusterDetailPage} path="/clusters" />}</Route>
        <Route path="/routes">{() => <ProtectedRoute component={RoutesPage} path="/routes" />}</Route>
        <Route path="/optimization">{() => <ProtectedRoute component={OptimizationPrepPage} path="/optimization" />}</Route>
        <Route path="/objects/duplicates">{() => <ProtectedRoute component={ObjectDuplicatesPage} path="/objects" />}</Route>
        <Route path="/objects/missing-coordinates">{() => <ProtectedRoute component={MissingCoordinatesPage} path="/objects" />}</Route>
        <Route path="/objects/:id">{() => <ProtectedRoute component={ObjectDetailPage} path="/objects" />}</Route>
        <Route path="/objects">{() => <ProtectedRoute component={ObjectsPage} path="/objects" />}</Route>
        <Route path="/work-orders/:id">{() => <ProtectedRoute component={WorkOrderDetailPage} path="/work-orders" />}</Route>
        <Route path="/resources">{() => <ProtectedRoute component={ResourcesPage} path="/resources" />}</Route>
        <Route path="/utforarregister">{() => <ProtectedRoute component={ExecutorRegisterPage} path="/utforarregister" />}</Route>
        <Route path="/procurements">{() => <ProtectedRoute component={ProcurementsPage} path="/procurements" />}</Route>
        <Route path="/articles/new">{() => <ProtectedRoute component={ArticleFormPage} path="/articles" />}</Route>
        <Route path="/articles/:id/edit">{() => <ProtectedRoute component={ArticleFormPage} path="/articles" />}</Route>
        <Route path="/articles">{() => <ProtectedRoute component={ArticlesPage} path="/articles" />}</Route>
        <Route path="/price-lists">{() => <ProtectedRoute component={PriceListsPage} path="/price-lists" />}</Route>
        <Route path="/order-stock">{() => <ProtectedRoute component={OrderStockPage} path="/order-stock" />}</Route>
        <Route path="/vehicles">{() => <ProtectedRoute component={VehiclesPage} path="/vehicles" />}</Route>
        <Route path="/subscriptions">{() => <ProtectedRoute component={SubscriptionsPage} path="/subscriptions" />}</Route>
        <Route path="/planning-parameters">{() => <ProtectedRoute component={PlanningParametersPage} path="/planning-parameters" />}</Route>
        <Route path="/planner-search-filters">{() => <ProtectedRoute component={PlannerSearchFiltersPage} path="/planner-search-filters" />}</Route>
        <Route path="/article-components">{() => <ProtectedRoute component={ArticleComponentsPage} path="/article-components" />}</Route>
        <Route path="/structure-articles">{() => <ProtectedRoute component={StructureArticlesPage} path="/structure-articles" />}</Route>
        <Route path="/production-time-lists">{() => <ProtectedRoute component={ProductionTimeListsPage} path="/production-time-lists" />}</Route>
        <Route path="/suppliers">{() => <ProtectedRoute component={SuppliersPage} path="/suppliers" />}</Route>
        <Route path="/invoice-recalculation-log">{() => <ProtectedRoute component={InvoiceRecalculationLogPage} path="/invoice-recalculation-log" />}</Route>
        <Route path="/invoice-queue">{() => <ProtectedRoute component={InvoiceQueuePage} path="/invoice-queue" />}</Route>
        <Route path="/dashboard">{() => <ProtectedRoute component={DashboardPage} path="/dashboard" />}</Route>
        <Route path="/economics">{() => <ProtectedRoute component={EconomicsDashboardPage} path="/economics" />}</Route>
        <Route path="/setup-analysis">{() => <ProtectedRoute component={SetupTimeAnalysisPage} path="/setup-analysis" />}</Route>
        <Route path="/predictive-planning">{() => <ProtectedRoute component={PredictivePlanningPage} path="/predictive-planning" />}</Route>
        <Route path="/customer-portal">{() => <ProtectedRoute component={CustomerPortalPage} path="/customer-portal" />}</Route>
        <Route path="/customer-reports">{() => <ProtectedRoute component={CustomerReportsPage} path="/customer-reports" />}</Route>
        <Route path="/cases">{() => <ProtectedRoute component={CasesPage} path="/cases" />}</Route>
        <Route path="/portal-messages">{() => <ProtectedRoute component={PortalMessagesPage} path="/portal-messages" />}</Route>
        <Route path="/booking-slots">{() => <ProtectedRoute component={BookingSlotsAdminPage} path="/booking-slots" />}</Route>
        <Route path="/utforandetyper">{() => <ProtectedRoute component={ExecutionTypesPage} path="/utforandetyper" />}</Route>
        <Route path="/import">{() => <ProtectedRoute component={ImportPage} path="/import" />}</Route>
        <Route path="/objektmall-import">{() => <ProtectedRoute component={ObjektmallImportPage} path="/objektmall-import" />}</Route>
        <Route path="/import-templates">{() => <ProtectedRoute component={ImportTemplatesPage} path="/import-templates" />}</Route>
        <Route path="/article-types">{() => <ProtectedRoute component={ArticleTypesPage} path="/article-types" />}</Route>
        <Route path="/execution-codes">{() => <ProtectedRoute component={ExecutionCodesPage} path="/execution-codes" />}</Route>
        <Route path="/time-codes">{() => <ProtectedRoute component={TimeCodesPage} path="/time-codes" />}</Route>
        <Route path="/icons">{() => <ProtectedRoute component={IconsPage} path="/icons" />}</Route>
        <Route path="/system-overview">{() => <ProtectedRoute component={SystemOverviewPage} path="/system-overview" />}</Route>
        <Route path="/settings">{() => <ProtectedRoute component={SettingsPage} path="/settings" />}</Route>
        <Route path="/system-dashboard">{() => <ProtectedRoute component={SystemDashboardPage} path="/system-dashboard" />}</Route>
        <Route path="/industry-packages">{() => <ProtectedRoute component={IndustryPackagesPage} path="/industry-packages" />}</Route>
        <Route path="/mobile">{() => <ProtectedRoute component={MobileFieldPage} path="/mobile" />}</Route>
        <Route path="/field">{() => <Redirect to="/mobile" />}</Route>
        <Route path="/simple">{() => <Redirect to="/mobile" />}</Route>
        <Route path="/project-report">{() => <ProtectedRoute component={ProjectReportPage} path="/project-report" />}</Route>
        <Route path="/metadata">{() => <Redirect to="/metadata-settings" />}</Route>
        <Route path="/metadata-settings">{() => <ProtectedRoute component={MetadataSettingsPage} path="/metadata-settings" />}</Route>
        <Route path="/metadata-definitions">{() => <ProtectedRoute component={MetadataDefinitionsPage} path="/metadata-definitions" />}</Route>
        <Route path="/metadata-editors">{() => <ProtectedRoute component={MetadataEditorsPage} path="/metadata-editors" />}</Route>
        <Route path="/metadata-granskning">{() => <ProtectedRoute component={MetadataEditorReviewPage} path="/metadata-granskning" />}</Route>
        <Route path="/order-type-metadata">{() => <ProtectedRoute component={OrderTypeMetadataPage} path="/order-type-metadata" />}</Route>
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
        <Route path="/ai-assistant">{() => <ProtectedRoute component={AIAssistantPage} path="/ai-assistant" />}</Route>
        <Route path="/reporting">{() => <ProtectedRoute component={ReportingDashboardPage} path="/reporting" />}</Route>
        <Route path="/weekly-report">{() => <ProtectedRoute component={WeeklyReportPage} path="/weekly-report" />}</Route>
        <Route path="/proactive-sales">{() => <ProtectedRoute component={ProactiveSalesPage} path="/proactive-sales" />}</Route>
        <Route path="/workflow-guide">{() => <ProtectedRoute component={WorkflowGuidePage} path="/workflow-guide" />}</Route>
        <Route path="/data-requirements">{() => <ProtectedRoute component={DataRequirementsPage} path="/data-requirements" />}</Route>
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
        <Route path="/control-tower">{() => <ProtectedRoute component={ControlTowerPage} path="/control-tower" />}</Route>
        <Route path="/enhetsansvarig">{() => <ProtectedRoute component={UnitManagerPage} path="/enhetsansvarig" />}</Route>
        <Route path="/my-reports">{() => <ProtectedRoute component={MyReportsPage} path="/my-reports" />}</Route>
        <Route path="/tenant-config">{() => <ProtectedRoute component={TenantConfigPage} path="/tenant-config" />}</Route>
        <Route path="/onboarding">{() => <ProtectedRoute component={OnboardingWizardPage} path="/onboarding" />}</Route>
        <Route path="/notifications">{() => <ProtectedRoute component={NotificationsPage} path="/notifications" />}</Route>
        <Route path="/customers/:id">{() => <ProtectedRoute component={CustomerDetailPage} path="/customers" />}</Route>
        <Route path="/customers">{() => <ProtectedRoute component={CustomersPage} path="/customers" />}</Route>
        <Route path="/ml-data-quality">{() => <ProtectedRoute component={MLDataQualityPage} path="/ml-data-quality" />}</Route>
        <Route path="/restore-dormant-customers">{() => <ProtectedRoute component={RestoreDormantCustomersPage} path="/restore-dormant-customers" />}</Route>
        <Route path="/shadow-comparison">{() => <ProtectedRoute component={ShadowComparisonPage} path="/shadow-comparison" />}</Route>
        <Route path="/archive">{() => <ProtectedRoute component={ArchivePage} path="/archive" />}</Route>
        <Route path="/platform-admin">{() => <ProtectedRoute component={PlatformAdminPage} path="/platform-admin" />}</Route>
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
        <Route path="/portal/calendar" component={PortalCalendarPage} />
        <Route path="/portal/invoices" component={PortalInvoicesPage} />
        <Route path="/portal/contracts" component={PortalContractsPage} />
        <Route path="/portal/settings" component={PortalSettingsPage} />
        <Route path="/portal/issues" component={PortalIssuesPage} />
        <Route path="/portal/roi-report" component={PortalROIReportPage} />
        <Route path="/portal/field" component={PortalFieldPage} />
        <Route path="/portal/map" component={PortalMapPage} />
        <Route path="/portal/completed-jobs" component={PortalCompletedJobsPage} />
        <Route path="/portal/execution" component={PortalExecutionPage} />
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

function AppContent() {
  const [location] = useLocation();
  const { isAuthenticated, isLoading, accessGranted } = useAuth();
  
  const isPendingFieldRedirect = useFieldLoginRedirect();
  
  if (isPendingFieldRedirect) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Öppnar Kinab Go...</p>
        </div>
      </div>
    );
  }

  if (location.startsWith("/portal") && !location.startsWith("/portal-messages")) {
    return (
      <ErrorBoundary>
        <PortalRouter />
      </ErrorBoundary>
    );
  }

  if (location.startsWith("/report/near/")) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <DynamicReportPage />
        </Suspense>
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

  if (location.startsWith("/feedback/")) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <PublicFeedbackPage />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (location.startsWith("/metadata-form/")) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <MetadataEditorPublicPage />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (location === "/monitor/popout") {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Laddar kartövervakning...</p>
          </div>
        </div>
      );
    }
    if (!isAuthenticated) {
      return (
        <Suspense fallback={<PageLoader />}>
          <LoginPage />
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
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <MonitorPopoutPage />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (location === "/planering/popout") {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Laddar planering...</p>
          </div>
        </div>
      );
    }
    if (!isAuthenticated) {
      return (
        <Suspense fallback={<PageLoader />}>
          <LoginPage />
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
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <PlannerPopoutPage />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (location === "/field-login" || location === "/mobile" || location === "/field" || location === "/simple") {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Laddar Kinab Go...</p>
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
        <LoginPage />
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
      <AuthenticatedApp />
    </TenantBrandingProvider>
  );
}

function TechnicianRedirect() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (user?.role === "technician" && location !== "/mobile" && location !== "/settings") {
      setLocation("/mobile");
    }
  }, [user, location, setLocation]);

  useEffect(() => {
    import("@/lib/sentry").then(({ setSentryTenant }) => {
      setSentryTenant(user?.tenantId ?? null);
    });
  }, [user?.tenantId]);

  return null;
}

function AuthenticatedApp() {
  const { theme, toggleTheme } = useTheme();
  const [location] = useLocation();
  const hideFloatingButton = location.startsWith("/order-concepts/new") || location.includes("/edit") || location.startsWith("/mobile");
  
  return (
    <TourProvider>
      <div className="flex flex-col min-h-screen bg-background pb-16 md:pb-0">
        <TechnicianRedirect />
        <DegradedModeBanner />
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
        <LanguageProvider>
          <ThemeProvider>
            <TooltipProvider>
              <AppContent />
              <Toaster />
            </TooltipProvider>
          </ThemeProvider>
        </LanguageProvider>
      </FeatureProvider>
    </QueryClientProvider>
  );
}
