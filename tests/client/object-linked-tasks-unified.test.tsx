import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ObjectLinkedTasksUnified } from "@/components/objects/ObjectLinkedTasksUnified";
import { getQueryFn } from "@/lib/queryClient";

// Task #1512: Kopplade uppgifter — en logisk uppgift får ALDRIG visas dubbelt.
// En assignment som materialiserats till en order (wo.sourceAssignmentId) visas
// bara som ordern. Käll-klassning: orderConceptId → Orderkoncept,
// orderNumber SO-* → Snabborder, övrigt → Uppgiftskaparen — med rätt länkar.

const OBJECT_ID = "obj-1512";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

interface OrderRow {
  id: string;
  title: string | null;
  status: string | null;
  orderStatus: string | null;
  scheduledDate: string | null;
  lineCount: number;
  orderNumber: string | null;
  orderConceptId: string | null;
  sourceAssignmentId?: string | null;
}

function installFetchMock(tasksHistory: OrderRow[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/system-generated-metadata")) {
      return jsonResponse({ tasksHistory });
    }
    return jsonResponse({});
  });
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

function renderComponent(
  assignments: {
    id: string;
    title?: string | null;
    scheduledDate?: string | null;
    quantity?: number | null;
    orderConceptId?: string | null;
    orderConceptName?: string | null;
    customerId?: string | null;
    customerName?: string | null;
  }[],
) {
  const navigate = vi.fn();
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        queryFn: getQueryFn({ on401: "returnNull" }),
      },
    },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <ObjectLinkedTasksUnified
        objectId={OBJECT_ID}
        assignments={assignments}
        navigate={navigate}
      />
    </QueryClientProvider>,
  );
  return { ...utils, navigate };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ObjectLinkedTasksUnified (Task #1512)", () => {
  it("visar materialiserad assignment som EN rad — ordern, aldrig dubbelt", async () => {
    installFetchMock([
      {
        id: "wo-1",
        title: "Gräsklippning",
        status: "draft",
        orderStatus: "planerad",
        scheduledDate: "2026-08-01T08:00:00.000Z",
        lineCount: 2,
        orderNumber: null,
        orderConceptId: "koncept-1",
        sourceAssignmentId: "assignment-1",
      },
    ]);
    const { queryByTestId, getByTestId } = renderComponent([
      {
        id: "assignment-1",
        title: "Gräsklippning",
        scheduledDate: "2026-08-01T08:00:00.000Z",
        orderConceptId: "koncept-1",
        orderConceptName: "Skötselavtal",
      },
      {
        id: "assignment-2",
        title: "Häckklippning",
        scheduledDate: "2026-09-01T08:00:00.000Z",
        orderConceptId: "koncept-1",
        orderConceptName: "Skötselavtal",
      },
    ]);

    await waitFor(() => {
      expect(getByTestId("linked-task-row-wo-wo-1")).toBeTruthy();
    });
    // Materialiserad assignment-rad döljs.
    expect(queryByTestId("linked-task-row-assignment-assignment-1")).toBeNull();
    // Icke-materialiserad assignment visas fortfarande.
    expect(getByTestId("linked-task-row-assignment-assignment-2")).toBeTruthy();
    // Totalt exakt 2 rader (aldrig 3).
    expect(getByTestId("badge-linked-tasks-count").textContent).toBe("2");
  });

  it("käll-klassar order: orderConceptId → Orderkoncept med konceptlänk", async () => {
    installFetchMock([
      {
        id: "wo-k",
        title: "Konceptorder",
        status: "draft",
        orderStatus: "skapad",
        scheduledDate: "2026-08-05T08:00:00.000Z",
        lineCount: 0,
        orderNumber: null,
        orderConceptId: "koncept-9",
        sourceAssignmentId: null,
      },
    ]);
    const { getByTestId, navigate } = renderComponent([]);

    await waitFor(() => {
      expect(getByTestId("badge-kalla-wo-wo-k").textContent).toContain("Orderkoncept");
    });
    fireEvent.click(getByTestId("link-source-wo-wo-k"));
    expect(navigate).toHaveBeenCalledWith("/order-concepts/koncept-9/edit");
    // Sekundär länk → ordern.
    fireEvent.click(getByTestId("link-secondary-wo-wo-k"));
    expect(navigate).toHaveBeenCalledWith("/work-orders/wo-k");
  });

  it("käll-klassar order: orderNumber SO-* → Snabborder med orderlänk", async () => {
    installFetchMock([
      {
        id: "wo-s",
        title: "Snabbjobb",
        status: "draft",
        orderStatus: "skapad",
        scheduledDate: "2026-08-06T08:00:00.000Z",
        lineCount: 1,
        orderNumber: "SO-123",
        orderConceptId: null,
        sourceAssignmentId: null,
      },
    ]);
    const { getByTestId, queryByTestId, navigate } = renderComponent([]);

    await waitFor(() => {
      expect(getByTestId("badge-kalla-wo-wo-s").textContent).toContain("Snabborder");
    });
    fireEvent.click(getByTestId("link-source-wo-wo-s"));
    expect(navigate).toHaveBeenCalledWith("/work-orders/wo-s");
    expect(queryByTestId("link-secondary-wo-wo-s")).toBeNull();
  });

  it("käll-klassar order: övrigt → Uppgiftskaparen med orderlänk", async () => {
    installFetchMock([
      {
        id: "wo-p",
        title: "Manuell order",
        status: "draft",
        orderStatus: "skapad",
        scheduledDate: "2026-08-07T08:00:00.000Z",
        lineCount: 0,
        orderNumber: "WO-77",
        orderConceptId: null,
        sourceAssignmentId: null,
      },
    ]);
    const { getByTestId, navigate } = renderComponent([]);

    await waitFor(() => {
      expect(getByTestId("badge-kalla-wo-wo-p").textContent).toContain("Uppgiftskaparen");
    });
    fireEvent.click(getByTestId("link-source-wo-wo-p"));
    expect(navigate).toHaveBeenCalledWith("/work-orders/wo-p");
  });

  it("assignment utan materialisering visas som Orderkoncept-rad med konceptlänk", async () => {
    installFetchMock([]);
    const { getByTestId, navigate } = renderComponent([
      {
        id: "assignment-x",
        title: "Planerad uppgift",
        scheduledDate: "2026-10-01T08:00:00.000Z",
        orderConceptId: "koncept-2",
        orderConceptName: "Vinteravtal",
        customerId: "cust-1",
        customerName: "Kund AB",
      },
    ]);

    await waitFor(() => {
      expect(getByTestId("linked-task-row-assignment-assignment-x")).toBeTruthy();
    });
    expect(getByTestId("badge-kalla-assignment-assignment-x").textContent).toContain(
      "Vinteravtal",
    );
    fireEvent.click(getByTestId("link-source-assignment-assignment-x"));
    expect(navigate).toHaveBeenCalledWith("/order-concepts/koncept-2/edit");
  });
});
