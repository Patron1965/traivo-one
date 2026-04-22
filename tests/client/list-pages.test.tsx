import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { Component, Suspense, type ComponentType, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/hooks/use-language";
import ResourcesPage from "@/pages/ResourcesPage";
import ClustersPage from "@/pages/ClustersPage";
import ObjectsPage from "@/pages/ObjectsPage";
import VehiclesPage from "@/pages/VehiclesPage";
import ArticlesPage from "@/pages/ArticlesPage";
import FleetManagementPage from "@/pages/FleetManagementPage";
import ProcurementsPage from "@/pages/ProcurementsPage";
import OrderStockPage from "@/pages/OrderStockPage";
import BookingSlotsAdminPage from "@/pages/BookingSlotsAdminPage";
import ChecklistTemplatesPage from "@/pages/ChecklistTemplatesPage";
import NotificationsPage from "@/pages/NotificationsPage";
import WorkSessionsPage from "@/pages/WorkSessionsPage";
import SubscriptionsPage from "@/pages/SubscriptionsPage";
import MyTasksPage from "@/pages/MyTasksPage";
import MyReportsPage from "@/pages/MyReportsPage";
import OrderConceptsPage from "@/pages/OrderConceptsPage";

class CapturingErrorBoundary extends Component<
  { onError: (e: unknown) => void; children: ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    if (this.state.error) return <div data-testid="boundary-error" />;
    return this.props.children;
  }
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        queryFn: async () => [],
      },
      mutations: { retry: false },
    },
  });
}

function renderPage(
  Page: ComponentType<unknown>,
  onError: (e: unknown) => void,
) {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <QueryClientProvider client={makeClient()}>
      <LanguageProvider>
        <TooltipProvider>
          <Router hook={hook}>
            <CapturingErrorBoundary onError={onError}>
              <Suspense fallback={<div>loading</div>}>
                <Page />
              </Suspense>
            </CapturingErrorBoundary>
          </Router>
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

const cases: Array<[string, ComponentType<unknown>]> = [
  ["ResourcesPage", ResourcesPage],
  ["ClustersPage", ClustersPage],
  ["ObjectsPage", ObjectsPage],
  ["VehiclesPage", VehiclesPage],
  ["ArticlesPage", ArticlesPage],
  ["FleetManagementPage", FleetManagementPage],
  ["ProcurementsPage", ProcurementsPage],
  ["OrderStockPage", OrderStockPage],
  ["BookingSlotsAdminPage", BookingSlotsAdminPage],
  ["ChecklistTemplatesPage", ChecklistTemplatesPage],
  ["NotificationsPage", NotificationsPage],
  ["WorkSessionsPage", WorkSessionsPage],
  ["SubscriptionsPage", SubscriptionsPage],
  ["MyTasksPage", MyTasksPage],
  ["MyReportsPage", MyReportsPage],
  ["OrderConceptsPage", OrderConceptsPage],
];

describe("List pages render with empty data without crashing", () => {
  afterEach(() => {
    cleanup();
  });

  for (const [name, Page] of cases) {
    it(`${name} renders without throwing on empty dataset`, async () => {
      const captured: unknown[] = [];
      const originalError = console.error;
      console.error = () => {};
      try {
        const { container } = renderPage(Page, (e) => captured.push(e));
        await settle();
        expect(container).toBeTruthy();
        const messages = captured.map((e) =>
          e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        );
        expect(captured, `Render produced errors: ${messages.join("; ")}`).toHaveLength(0);
      } finally {
        console.error = originalError;
      }
    });
  }
});
