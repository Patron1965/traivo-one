/**
 * Task #1534: objekt-scope i Uppgiftsnavet (?objectId= från objektsidan,
 * Task #1533) får aldrig tappas vid filterbyten eller visa fel objektnamn.
 *
 * Vaktar tre saker:
 *  1. Grid-anropet (/api/rough-planning/grid) behåller objectId efter
 *     applyFilters och veckobyte från kartvyn (handleWeekChange).
 *  2. "Rensa" och chip-krysset tar bort scopet — grid-anropet skickas då
 *     UTAN objectId (ingen kvarhängande param).
 *  3. Chip-namnet läses via egen query-key ["/api/objects", id, "detail"]
 *     och kan aldrig visa list-/kollisionsdata som ligger cachad under
 *     ["/api/objects"] eller ["/api/objects", id].
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

// Tunga/leaflet-beroende barn mockas bort — de är irrelevanta för scope-logiken.
// Kartvyns mock exponerar en knapp som anropar onWeekChange (handleWeekChange)
// så att veckobytes-kodvägen kan triggas utan riktig karta.
vi.mock("@/components/clustering/ClusterMapView", () => ({
  ClusterMapView: (props: { onWeekChange: (d: Date) => void }) => (
    <button
      data-testid="button-mock-map-week-change"
      onClick={() => props.onWeekChange(new Date(2026, 7, 24))} // måndag v.35 2026
    >
      mock-week-change
    </button>
  ),
}));
vi.mock("@/components/clustering/ClusterListView", () => ({
  ClusterListView: () => <div data-testid="mock-cluster-list" />,
}));
vi.mock("@/components/clustering/ClusterSidePanel", () => ({
  ClusterSidePanel: () => null,
}));
vi.mock("@/components/grovplanering/EngineResultsView", () => ({
  EngineResultsView: () => <div data-testid="mock-engine-results" />,
}));

import GrovplaneringPage from "@/pages/GrovplaneringPage";

const SCOPE_ID = "obj-scope-1";
const DETAIL_NAME = "Rätt Detaljnamn";

const EMPTY_GRID = {
  summary: { productionMinutes: 0, value: 0, cost: 0, taskCount: 0, objectCount: 0 },
  groups: [],
  pagination: { total: 0, offset: 0, limit: 20 },
  grouping: "objekt",
  truncated: false,
};

let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock() {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/rough-planning/grid")) return json(EMPTY_GRID);
    if (url.includes("/rough-planning/engine-results"))
      return json({ hasResults: false, lastRunAt: null });
    if (url.includes("/rough-planning/cities")) return json([]);
    if (url.includes("/auth/user")) return json({ id: "u1", role: "admin" });
    // Chip-detaljanropet (rå fetch, oversionerad URL i GrovplaneringPage).
    if (url.includes(`/api/objects/${SCOPE_ID}`))
      return json({ id: SCOPE_ID, name: DETAIL_NAME, objectNumber: "OBJ-001" });
    return json([]);
  });
  (globalThis as any).fetch = fetchMock;
}

/** Alla grid-anrop hittills, som URLSearchParams. */
function gridCalls(): URLSearchParams[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/rough-planning/grid"))
    .map((u) => new URL(u, "http://localhost").searchParams);
}

function lastGridCall(): URLSearchParams {
  const calls = gridCalls();
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1];
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        // Speglar appens default-fetcher: key-segment join:as till URL —
        // det är exakt kollisionen "detail"-suffixet ska skydda mot.
        queryFn: async ({ queryKey }) => {
          const res = await fetch(queryKey.join("/"), { credentials: "include" });
          return res.json();
        },
      },
      mutations: { retry: false },
    },
  });
}

function renderPage(client = makeClient()) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <GrovplaneringPage />
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  };
}

async function waitForGridCall(count = 1) {
  await waitFor(() => expect(gridCalls().length).toBeGreaterThanOrEqual(count));
}

beforeEach(() => {
  localStorage.clear();
  installFetchMock();
  window.history.replaceState(null, "", `/grovplanering?objectId=${SCOPE_ID}`);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Uppgiftsnavet — objekt-scope (?objectId=) bevaras genom filterbyten", () => {
  it("initialt grid-anrop innehåller objectId och chippen visas", async () => {
    renderPage();
    await waitForGridCall();
    expect(lastGridCall().get("objectId")).toBe(SCOPE_ID);
    await waitFor(() =>
      expect(screen.getByTestId("chip-object-scope")).toBeTruthy(),
    );
  });

  it("applyFilters (Visa/Tillämpa) behåller objectId i grid-anropet", async () => {
    renderPage();
    await waitForGridCall();
    const before = gridCalls().length;

    // Ändra utkastet (postnummer) så apply ger ett nytt applied-objekt + fetch.
    fireEvent.change(screen.getByTestId("input-postal"), {
      target: { value: "12345" },
    });
    fireEvent.click(screen.getByTestId("button-apply-filters"));

    await waitFor(() => expect(gridCalls().length).toBeGreaterThan(before));
    const params = lastGridCall();
    expect(params.get("postalCode")).toBe("12345");
    expect(params.get("objectId")).toBe(SCOPE_ID);
  });

  it("veckobyte från kartvyn (handleWeekChange) behåller objectId", async () => {
    // Persisterat filter i veckoläge med känt ankare — mockens datum
    // (2026-08-24) ligger i en annan vecka så handleWeekChange applicerar.
    const persisted = { periodMode: "vecka", anchor: "2026-08-03" };
    localStorage.setItem("grovplanering.filter.v1", JSON.stringify(persisted));

    renderPage();
    await waitForGridCall();
    const before = gridCalls().length;
    const fromBefore = lastGridCall().get("from");

    // Byt till kartvyn och trigga veckobyte via den mockade kartan.
    fireEvent.mouseDown(screen.getByTestId("tab-karta"));
    fireEvent.click(screen.getByTestId("tab-karta"));
    const weekBtn = await screen.findByTestId("button-mock-map-week-change");
    fireEvent.click(weekBtn);

    await waitFor(() => expect(gridCalls().length).toBeGreaterThan(before));
    const params = lastGridCall();
    expect(params.get("objectId")).toBe(SCOPE_ID);
    // Perioden ska faktiskt ha flyttats (annars testade vi ingen ny kodväg).
    expect(params.get("from")).not.toBe(fromBefore);
  });

  it("'Rensa' tar bort scopet — grid-anropet skickas utan objectId och chippen försvinner", async () => {
    renderPage();
    await waitForGridCall();
    await waitFor(() =>
      expect(screen.getByTestId("chip-object-scope")).toBeTruthy(),
    );
    const before = gridCalls().length;

    fireEvent.click(screen.getByTestId("button-clear-filters"));

    await waitFor(() => expect(gridCalls().length).toBeGreaterThan(before));
    expect(lastGridCall().get("objectId")).toBeNull();
    expect(screen.queryByTestId("chip-object-scope")).toBeNull();
  });

  it("chip-krysset tar bort scopet men behåller övriga filter", async () => {
    renderPage();
    await waitForGridCall();
    const chipClear = await screen.findByTestId("button-clear-object-scope");
    const before = gridCalls().length;

    fireEvent.click(chipClear);

    await waitFor(() => expect(gridCalls().length).toBeGreaterThan(before));
    expect(lastGridCall().get("objectId")).toBeNull();
    expect(screen.queryByTestId("chip-object-scope")).toBeNull();
  });
});

describe("Uppgiftsnavet — chip-namnets query-key-isolering", () => {
  it("chippen visar detaljnamnet, aldrig list-/kollisionsdata i cachen", async () => {
    const client = makeClient();
    // Förorena cachen med list-data under nycklarna som HADE kolliderat om
    // chippen använt default-nyckelformen (["/api/objects"] / [..., id]).
    client.setQueryData(["/api/objects"], [
      { id: SCOPE_ID, name: "FEL Listnamn" },
    ]);
    client.setQueryData(["/api/objects", SCOPE_ID], {
      objects: [{ id: SCOPE_ID, name: "FEL Kollisionsnamn" }],
      total: 1,
    });

    renderPage(client);

    const chip = await screen.findByTestId("chip-object-scope");
    await waitFor(() => expect(chip.textContent).toContain(DETAIL_NAME));
    expect(chip.textContent).not.toContain("FEL Listnamn");
    expect(chip.textContent).not.toContain("FEL Kollisionsnamn");

    // Detaljdatat ligger under sin egen key — och list-nycklarna är orörda.
    expect(
      (client.getQueryData(["/api/objects", SCOPE_ID, "detail"]) as any)?.name,
    ).toBe(DETAIL_NAME);
    expect(
      (client.getQueryData(["/api/objects"]) as any)[0].name,
    ).toBe("FEL Listnamn");
  });

  it("utan objectId i URL:en görs inget detaljanrop och ingen chip visas", async () => {
    window.history.replaceState(null, "", "/grovplanering");
    renderPage();
    await waitForGridCall();
    expect(screen.queryByTestId("chip-object-scope")).toBeNull();
    const detailCalls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/api/objects/"));
    expect(detailCalls).toHaveLength(0);
  });
});
