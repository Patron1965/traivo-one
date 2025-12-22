import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
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
import { Loader2 } from "lucide-react";

function Router() {
  return (
    <Switch>
      <Route path="/" component={WeekPlannerPage} />
      <Route path="/planner" component={WeekPlannerPage} />
      <Route path="/routes" component={RoutesPage} />
      <Route path="/optimization" component={OptimizationPrepPage} />
      <Route path="/objects" component={ObjectsPage} />
      <Route path="/resources" component={ResourcesPage} />
      <Route path="/procurements" component={ProcurementsPage} />
      <Route path="/articles" component={ArticlesPage} />
      <Route path="/price-lists" component={PriceListsPage} />
      <Route path="/order-stock" component={OrderStockPage} />
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="/import" component={ImportPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-4 p-2 border-b sticky top-0 bg-background z-50">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
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
