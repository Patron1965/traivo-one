import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";

// Integrationstest: kopplar ihop den RIKTIGA route-geometri-handlern
// (server/routes/routeGeometryRoutes) med den RIKTIGA klientkomponenten
// (RouteDayMap) över en faktisk HTTP-server. Syftet är att verifiera att
// kontraktet hänger ihop end-to-end — dvs att klienten ritar raka
// fallback-linjer när /api/route-geometry svarar 500/502, och en riktig
// polyline när den svarar 200. (Frontend-fallback och serverns fel-svar är
// redan testtäckta var för sig i route-day-map.test.tsx respektive
// route-geometry.test.ts; detta testar limmet mellan dem.)

// Mocka routing-tjänsten som den riktiga handlern dynamiskt importerar, så att
// vi kan styra 500/502/200 utan Geoapify-nyckel eller nätverksanrop.
const mockIsAvailable = vi.fn<[], boolean>();
const mockGetRouteGeometry =
  vi.fn<
    [Array<{ lat: number; lng: number }>],
    Promise<{ coordinates: [number, number][] } | null>
  >();

vi.mock("../../server/services/routing", () => ({
  isGeoapifyRoutingAvailable: () => mockIsAvailable(),
  getRouteGeometry: (waypoints: Array<{ lat: number; lng: number }>) =>
    mockGetRouteGeometry(waypoints),
}));

// react-leaflet renderar imperativt mot en riktig Leaflet-karta, vilket inte
// fungerar i jsdom. Mocka de tre primitiverna RouteDayMap använder så att
// renderad ruttgeometri (Polyline) och numrerade pins (Marker) blir
// inspekterbara DOM-noder. (Samma stubbar som route-day-map.test.tsx.)
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

vi.mock("@/components/ui/map", () => ({
  BaseMap: ({ children }: { children?: ReactNode }) => (
    <div data-testid="base-map">{children}</div>
  ),
  MapFitBounds: () => null,
  numberedDivIcon: (opts: { number: number }) => opts,
}));

import { registerRouteGeometryRoutes } from "../../server/routes/routeGeometryRoutes";
import { RouteDayMap, type RouteMapJob } from "@/components/ui/map/RouteDayMap";

// Den riktiga (node-) fetch innan setup.ts byter ut globalThis.fetch mot en
// mock i sin beforeEach. Vi forwardar klientens relativa URL:er hit.
const realFetch = globalThis.fetch.bind(globalThis);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Replikera version-prefix-rewriten i server/routes.ts: klienten anropar
  // /api/v1/route-geometry (via versionedUrl) men handlern lyssnar på
  // /api/route-geometry.
  app.use((req, _res, next) => {
    if (req.url.startsWith("/api/v1/") || req.url === "/api/v1") {
      req.url = "/api" + req.url.slice("/api/v1".length);
    }
    next();
  });
  registerRouteGeometryRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  mockIsAvailable.mockReset();
  mockGetRouteGeometry.mockReset();
  // Forwarda klientens relativa fetch-anrop (t.ex. /api/v1/route-geometry) till
  // den riktiga test-servern. Detta är det som gör testet end-to-end i stället
  // för att mocka svaret.
  (globalThis as any).fetch = (input: any, init?: any) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    const absolute = url.startsWith("http") ? url : `${baseUrl}${url}`;
    return realFetch(absolute, init);
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

const JOBS: RouteMapJob[] = [
  { id: "a", lat: 62.39, lng: 17.3, label: "Jobb A", timeLabel: "08:00" },
  { id: "b", lat: 62.4, lng: 17.31, label: "Jobb B", timeLabel: "09:00" },
  { id: "c", lat: 62.41, lng: 17.32, label: "Jobb C", timeLabel: "10:00" },
];

const JOB_POINTS: [number, number][] = JOBS.map((j) => [j.lat, j.lng]);

/** Hittar ruttpolylinjen vars positions matchar exakt. */
function findPolylineByPositions(positions: [number, number][]) {
  const wanted = JSON.stringify(positions);
  return screen
    .queryAllByTestId("leaflet-polyline")
    .find((el) => el.getAttribute("data-positions") === wanted);
}

describe("Integration: RouteDayMap ↔ /api/route-geometry (end-to-end)", () => {
  it("ritar raka fallback-linjer när servern svarar 500 (Geoapify-nyckel saknas)", async () => {
    mockIsAvailable.mockReturnValue(false); // → handlern returnerar 500

    renderMap({ jobs: JOBS, testId: "map-weekly-route" });

    // Klienten måste rita den raka fallback-rutten (råa jobbkoordinater) trots
    // att geometri-anropet failade — och inte bli tom eller krascha.
    await waitFor(() => {
      expect(findPolylineByPositions(JOB_POINTS)).toBeTruthy();
    });
    // Fallback-indikatorn ska visas så att planeraren förstår att rutten är
    // ungefärlig.
    await waitFor(() => {
      expect(
        screen.getByTestId("map-weekly-route-fallback-indicator"),
      ).toBeTruthy();
    });
    expect(mockIsAvailable).toHaveBeenCalled();
  });

  it("ritar raka fallback-linjer när servern svarar 502 (routing-tjänst nere)", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockResolvedValue(null); // → handlern returnerar 502

    renderMap({ jobs: JOBS, testId: "map-today-route" });

    await waitFor(() => {
      expect(findPolylineByPositions(JOB_POINTS)).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("map-today-route-fallback-indicator"),
      ).toBeTruthy();
    });
    expect(mockGetRouteGeometry).toHaveBeenCalled();
  });

  it("ritar den riktiga vägbaserade polylinjen när servern svarar 200", async () => {
    const roadGeometry: [number, number][] = [
      [62.39, 17.3],
      [62.395, 17.305],
      [62.4, 17.31],
      [62.405, 17.315],
      [62.41, 17.32],
    ];
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockResolvedValue({ coordinates: roadGeometry });

    renderMap({ jobs: JOBS, testId: "map-weekly-route" });

    await waitFor(() => {
      expect(findPolylineByPositions(roadGeometry)).toBeTruthy();
    });
    // Den raka fallback-rutten ska INTE användas när riktig geometri finns,
    // och fallback-indikatorn ska inte visas.
    expect(findPolylineByPositions(JOB_POINTS)).toBeUndefined();
    expect(
      screen.queryByTestId("map-weekly-route-fallback-indicator"),
    ).toBeNull();
    expect(mockGetRouteGeometry).toHaveBeenCalledWith(
      JOBS.map((j) => ({ lat: j.lat, lng: j.lng })),
    );
  });
});
