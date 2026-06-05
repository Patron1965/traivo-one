import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RouteDayMap, type RouteMapJob } from "@/components/ui/map/RouteDayMap";

// react-leaflet renders imperatively into a real Leaflet map, which does not
// work in jsdom. Mock the three primitives RouteDayMap uses so the rendered
// route geometry (Polyline) and numbered job pins (Marker) become inspectable
// DOM nodes.
vi.mock("react-leaflet", () => ({
  Polyline: ({
    positions,
    pathOptions,
  }: {
    positions: [number, number][];
    pathOptions?: { color?: string; weight?: number; dashArray?: string };
  }) => (
    <div
      data-testid="leaflet-polyline"
      data-positions={JSON.stringify(positions)}
      data-color={pathOptions?.color ?? ""}
      data-weight={String(pathOptions?.weight ?? "")}
      data-dasharray={pathOptions?.dashArray ?? ""}
    />
  ),
  Marker: ({
    position,
    icon,
    children,
  }: {
    position: [number, number];
    icon?: { number?: number };
    children?: ReactNode;
  }) => (
    <div
      data-testid="leaflet-marker"
      data-position={JSON.stringify(position)}
      data-number={String(icon?.number ?? "")}
    >
      {children}
    </div>
  ),
  Popup: ({ children }: { children?: ReactNode }) => (
    <div data-testid="leaflet-popup">{children}</div>
  ),
}));

// Replace the BaseMap/MapFitBounds (which pull in real Leaflet) with light
// stubs, and make numberedDivIcon echo its argument so the Marker mock can read
// the pin number.
vi.mock("@/components/ui/map", () => ({
  BaseMap: ({ children }: { children?: ReactNode }) => (
    <div data-testid="base-map">{children}</div>
  ),
  MapFitBounds: () => null,
  numberedDivIcon: (opts: { number: number }) => opts,
}));

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

function renderMap(props: Parameters<typeof RouteDayMap>[0]) {
  return render(
    <QueryClientProvider client={makeClient()}>
      <RouteDayMap {...props} />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const JOBS: RouteMapJob[] = [
  { id: "a", lat: 62.39, lng: 17.3, label: "Jobb A", timeLabel: "08:00" },
  { id: "b", lat: 62.4, lng: 17.31, label: "Jobb B", timeLabel: "09:00" },
  { id: "c", lat: 62.41, lng: 17.32, label: "Jobb C", timeLabel: "10:00" },
];

const JOB_POINTS: [number, number][] = JOBS.map((j) => [j.lat, j.lng]);

/** Finds the route polyline (the one matching the supplied positions). */
function findPolylineByPositions(positions: [number, number][]) {
  const wanted = JSON.stringify(positions);
  return screen
    .queryAllByTestId("leaflet-polyline")
    .find((el) => el.getAttribute("data-positions") === wanted);
}

describe("RouteDayMap — route survives a failing route-geometry service", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  for (const testId of ["map-weekly-route", "map-today-route"] as const) {
    it(`[${testId}] draws straight lines between jobs when /api/route-geometry returns a 500`, async () => {
      (globalThis as any).fetch = vi.fn(async () =>
        jsonResponse({ message: "Geoapify key missing" }, 500),
      );

      renderMap({ jobs: JOBS, testId });

      // The straight-line fallback polyline (the raw job coordinates) must be
      // rendered even though the geometry request failed.
      await waitFor(() => {
        expect(findPolylineByPositions(JOB_POINTS)).toBeTruthy();
      });
      expect((globalThis as any).fetch).toHaveBeenCalled();
    });

    it(`[${testId}] draws straight lines when /api/route-geometry returns empty coordinates`, async () => {
      (globalThis as any).fetch = vi.fn(async () =>
        jsonResponse({ coordinates: [] }),
      );

      renderMap({ jobs: JOBS, testId });

      await waitFor(() => {
        expect(findPolylineByPositions(JOB_POINTS)).toBeTruthy();
      });
    });

    it(`[${testId}] renders numbered pins for every job with coordinates`, async () => {
      (globalThis as any).fetch = vi.fn(async () => jsonResponse({ coordinates: [] }));

      renderMap({ jobs: JOBS, testId });

      const markers = await screen.findAllByTestId("leaflet-marker");
      expect(markers).toHaveLength(JOBS.length);
      expect(markers.map((m) => m.getAttribute("data-number"))).toEqual([
        "1",
        "2",
        "3",
      ]);
      // Pin positions match the job coordinates in order.
      expect(markers.map((m) => m.getAttribute("data-position"))).toEqual(
        JOBS.map((j) => JSON.stringify([j.lat, j.lng])),
      );
    });

    it(`[${testId}] shows the empty state and no pins when there are no coordinates`, () => {
      renderMap({ jobs: [], testId, emptyLabel: "Inga koordinater för vald dag." });

      expect(screen.getByTestId(`${testId}-empty`)).toBeTruthy();
      expect(screen.getByTestId(`${testId}-empty`).textContent).toContain(
        "Inga koordinater för vald dag.",
      );
      expect(screen.queryByTestId("leaflet-marker")).toBeNull();
      expect(screen.queryByTestId("leaflet-polyline")).toBeNull();
    });
  }

  it("uses the road-based geometry (not straight lines) when the service responds with coordinates", async () => {
    const roadGeometry: [number, number][] = [
      [62.39, 17.3],
      [62.395, 17.305],
      [62.4, 17.31],
      [62.405, 17.315],
      [62.41, 17.32],
    ];
    (globalThis as any).fetch = vi.fn(async () =>
      jsonResponse({ coordinates: roadGeometry }),
    );

    renderMap({ jobs: JOBS, testId: "map-weekly-route" });

    await waitFor(() => {
      expect(findPolylineByPositions(roadGeometry)).toBeTruthy();
    });
    // The raw straight-line fallback should NOT be used once real geometry exists.
    expect(findPolylineByPositions(JOB_POINTS)).toBeUndefined();
  });
});
