import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkOrderWithObject } from "@shared/schema";
import { ObjectTimeline } from "@/components/timeline/ObjectTimeline";

// Task #1170: lås att den återanvändbara objekt-tidslinjen renderar delade
// QueryState-ytor (laddning/fel-med-retry/tom "Inga uppgifter") i stället för
// råa spinners/tomma dukar. Data injiceras via fetchTimeline så vi kan styra
// varje tillstånd deterministiskt.

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
    },
  });
}

function renderTimeline(fetchTimeline: (s: string, e: string) => Promise<WorkOrderWithObject[]>) {
  return render(
    <QueryClientProvider client={makeClient()}>
      <ObjectTimeline
        fetchTimeline={fetchTimeline}
        queryKeyPrefix={["/api/objects", "obj-timeline-test", "timeline"]}
        initialViewMode="month"
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("ObjectTimeline — QueryState-ytor", () => {
  it("visar QueryState-laddning medan hämtningen pågår", () => {
    // En hämtning som aldrig resolvas → förblir i laddningsläge.
    const fetchTimeline = vi.fn(() => new Promise<WorkOrderWithObject[]>(() => {}));
    const { getByTestId } = renderTimeline(fetchTimeline);
    expect(getByTestId("query-state-loading")).toBeTruthy();
  });

  it("visar tom-state 'Inga uppgifter' när inga uppgifter finns", async () => {
    const fetchTimeline = vi.fn(async () => [] as WorkOrderWithObject[]);
    const { getByTestId } = renderTimeline(fetchTimeline);
    await waitFor(() => {
      expect(getByTestId("query-state-empty")).toBeTruthy();
    });
    expect(getByTestId("query-state-empty").textContent).toContain("Inga uppgifter");
  });

  it("visar fel-state med en 'Försök igen'-knapp som hämtar om", async () => {
    const fetchTimeline = vi
      .fn<[string, string], Promise<WorkOrderWithObject[]>>()
      .mockRejectedValueOnce(new Error("nätverksfel"))
      .mockResolvedValue([]);
    const { getByTestId } = renderTimeline(fetchTimeline);
    await waitFor(() => {
      expect(getByTestId("query-state-error")).toBeTruthy();
    });
    const retry = getByTestId("button-query-retry");
    fireEvent.click(retry);
    // Efter retry löser den andra hämtningen → tom-state visas.
    await waitFor(() => {
      expect(getByTestId("query-state-empty")).toBeTruthy();
    });
  });
});
