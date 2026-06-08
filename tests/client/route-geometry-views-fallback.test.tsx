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
// (server/routes/routeGeometryRoutes) med de TRE andra kartvyer som anropar
// /api/route-geometry med EGEN, separat fallback-logik (inte via RouteDayMap):
//   - veckoplanerarens RouteMapView
//   - OptimizedRouteMap
//   - MonitorPopoutPage (pop-out)
// RouteDayMap är redan testtäckt i route-geometry-integration.test.tsx; detta
// testar att ÄVEN de tre andra ritar raka fallback-linjer när Geoapify ligger
// nere (500/502) i stället för att bli tomma eller krascha — och en riktig
// vägbaserad polyline när servern svarar 200.

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
// fungerar i jsdom. Mocka primitiverna alla tre vyerna använder så att renderad
// ruttgeometri (Polyline) blir inspekterbara DOM-noder.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="map-container">{children}</div>
  ),
  TileLayer: () => null,
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
  CircleMarker: ({ children }: { children?: ReactNode }) => (
    <div data-testid="leaflet-circlemarker">{children}</div>
  ),
  Polygon: ({ children }: { children?: ReactNode }) => (
    <div data-testid="leaflet-polygon">{children}</div>
  ),
  Circle: ({ children }: { children?: ReactNode }) => (
    <div data-testid="leaflet-circle">{children}</div>
  ),
  useMap: () => ({ fitBounds: () => {} }),
}));

// Leaflet (default-export) används av RouteMapView (latLngBounds) och
// MonitorPopoutPage (divIcon/latLng/latLngBounds). Pure-stubs räcker.
vi.mock("leaflet", () => {
  const L = {
    divIcon: (opts: unknown) => opts,
    latLng: (a: number, b: number) => [a, b],
    latLngBounds: (pts: unknown) => ({ pts }),
  };
  return { default: L, ...L };
});

// BaseMap/MapFitBounds/ikon-helpers drar in riktig Leaflet → ersätt med stubbar.
vi.mock("@/components/ui/map", () => ({
  BaseMap: ({ children }: { children?: ReactNode }) => (
    <div data-testid="base-map">{children}</div>
  ),
  MapFitBounds: () => null,
  numberedDivIcon: (opts: { number: number }) => opts,
  breakDivIcon: () => ({}),
  getRouteSegmentColor: () => "#3B82F6",
  getClusterColor: () => "#3B82F6",
  CLUSTER_COLOR_PALETTE: ["#3B82F6", "#ef4444", "#22c55e"],
}));

// RouteMapView drar in dnd-kit + en tung listrad-komponent som inte är relevant
// för ruttgeometrin → ersätt med lättviktsstubbar.
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children?: ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
}));
vi.mock("@/components/weekplanner/DndComponents", () => ({
  SortableRouteItem: ({ job }: { job: { id: string; title?: string } }) => (
    <div data-testid={`route-item-${job.id}`}>{job.title}</div>
  ),
}));

// MonitorPopoutPage-beroenden som inte rör ruttgeometrin.
vi.mock("@/hooks/use-map-config", () => ({
  useMapConfig: () => ({ tileUrl: "", attribution: "" }),
}));
vi.mock("@/components/UrgentJobDialog", () => ({
  UrgentJobDialog: () => null,
}));

import { registerRouteGeometryRoutes } from "../../server/routes/routeGeometryRoutes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RouteMapView } from "@/components/weekplanner/RouteMapView";
import { OptimizedRouteMap } from "@/components/OptimizedRouteMap";
import MonitorPopoutPage from "@/pages/MonitorPopoutPage";
import type { Resource, WorkOrderWithObject } from "@shared/schema";

// Den riktiga (node-) fetch innan setup.ts byter ut globalThis.fetch mot en
// mock. Vi forwardar klientens relativa URL:er hit.
const realFetch = globalThis.fetch.bind(globalThis);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerRouteGeometryRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  // jsdom saknar WebSocket; MonitorPopoutPage öppnar en (i try/catch). Stub:a så
  // att inget oväntat kastas under render.
  if (!(globalThis as any).WebSocket) {
    (globalThis as any).WebSocket = class {
      close() {}
    } as any;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  mockIsAvailable.mockReset();
  mockGetRouteGeometry.mockReset();
  // Forwarda klientens relativa fetch-anrop (/api/route-geometry) till den
  // riktiga test-servern. Detta är det som gör testet end-to-end.
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
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/** Hittar ruttpolylinjen vars positions matchar exakt. */
function findPolylineByPositions(positions: [number, number][]) {
  const wanted = JSON.stringify(positions);
  return screen
    .queryAllByTestId("leaflet-polyline")
    .find((el) => el.getAttribute("data-positions") === wanted);
}

// --- Gemensamma jobbkoordinater ---------------------------------------------
const P1: [number, number] = [62.39, 17.3];
const P2: [number, number] = [62.4, 17.31];
const P3: [number, number] = [62.41, 17.32];
const STRAIGHT_LINE: [number, number][] = [P1, P2, P3];
const ROAD_GEOMETRY: [number, number][] = [
  [62.39, 17.3],
  [62.395, 17.305],
  [62.4, 17.31],
  [62.405, 17.315],
  [62.41, 17.32],
];

// ===========================================================================
// 1) Veckoplanerarens RouteMapView
// ===========================================================================
describe("RouteMapView ↔ /api/route-geometry (Geoapify nere)", () => {
  const routeJobs = [
    { id: "a", title: "Jobb A", customerId: "c1", taskLatitude: P1[0], taskLongitude: P1[1] },
    { id: "b", title: "Jobb B", customerId: "c1", taskLatitude: P2[0], taskLongitude: P2[1] },
    { id: "c", title: "Jobb C", customerId: "c1", taskLatitude: P3[0], taskLongitude: P3[1] },
  ] as unknown as WorkOrderWithObject[];

  const resources = [{ id: "r1", name: "Resurs 1" }] as unknown as Resource[];

  function renderView() {
    return render(
      <QueryClientProvider client={makeClient()}>
        <TooltipProvider>
        <RouteMapView
          currentDate={new Date("2026-06-05")}
          resources={resources}
          routeViewResourceId="r1"
          setRouteViewResourceId={() => {}}
          routeJobs={routeJobs}
          routeJobOrder={["a", "b", "c"]}
          customerMap={new Map()}
          isOptimizing={false}
          selectedJob={null}
          onJobClick={() => {}}
          onSortEnd={() => {}}
          onOptimizeRoute={() => {}}
          onSendSchedule={() => {}}
        />
        </TooltipProvider>
      </QueryClientProvider>,
    );
  }

  it("ritar raka fallback-linjer när servern svarar 500 (nyckel saknas)", async () => {
    mockIsAvailable.mockReturnValue(false); // → 500

    renderView();

    await waitFor(() => {
      expect(findPolylineByPositions(STRAIGHT_LINE)).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("route-geometry-fallback-indicator"),
      ).toBeTruthy();
    });
    expect(mockIsAvailable).toHaveBeenCalled();
  });

  it("ritar raka fallback-linjer när servern svarar 502 (routing-tjänst nere)", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockResolvedValue(null); // → 502

    renderView();

    await waitFor(() => {
      expect(findPolylineByPositions(STRAIGHT_LINE)).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("route-geometry-fallback-indicator"),
      ).toBeTruthy();
    });
    expect(mockGetRouteGeometry).toHaveBeenCalled();
  });

  it("ritar den riktiga vägbaserade polylinjen när servern svarar 200", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockResolvedValue({ coordinates: ROAD_GEOMETRY });

    renderView();

    await waitFor(() => {
      expect(findPolylineByPositions(ROAD_GEOMETRY)).toBeTruthy();
    });
    expect(findPolylineByPositions(STRAIGHT_LINE)).toBeUndefined();
    expect(
      screen.queryByTestId("route-geometry-fallback-indicator"),
    ).toBeNull();
  });
});

// ===========================================================================
// 2) OptimizedRouteMap (legacy stops-läge)
// ===========================================================================
describe("OptimizedRouteMap ↔ /api/route-geometry (Geoapify nere)", () => {
  const stops = [
    { workOrderId: "w1", objectId: "o1", objectName: "Obj 1", latitude: P1[0], longitude: P1[1], estimatedDuration: 30 },
    { workOrderId: "w2", objectId: "o2", objectName: "Obj 2", latitude: P2[0], longitude: P2[1], estimatedDuration: 30 },
    { workOrderId: "w3", objectId: "o3", objectName: "Obj 3", latitude: P3[0], longitude: P3[1], estimatedDuration: 30 },
  ];

  function renderView() {
    return render(
      <QueryClientProvider client={makeClient()}>
        <OptimizedRouteMap stops={stops} resourceName="Resurs 1" />
      </QueryClientProvider>,
    );
  }

  it("ritar raka fallback-linjer när servern svarar 500 (nyckel saknas)", async () => {
    mockIsAvailable.mockReturnValue(false); // → 500

    renderView();

    await waitFor(() => {
      expect(findPolylineByPositions(STRAIGHT_LINE)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByTestId("badge-route-fallback")).toBeTruthy();
    });
    expect(mockIsAvailable).toHaveBeenCalled();
  });

  it("ritar raka fallback-linjer när servern svarar 502 (routing-tjänst nere)", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockResolvedValue(null); // → 502

    renderView();

    await waitFor(() => {
      expect(findPolylineByPositions(STRAIGHT_LINE)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByTestId("badge-route-fallback")).toBeTruthy();
    });
    expect(mockGetRouteGeometry).toHaveBeenCalled();
  });

  it("ritar den riktiga vägbaserade polylinjen när servern svarar 200", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockResolvedValue({ coordinates: ROAD_GEOMETRY });

    renderView();

    await waitFor(() => {
      expect(findPolylineByPositions(ROAD_GEOMETRY)).toBeTruthy();
    });
    expect(findPolylineByPositions(STRAIGHT_LINE)).toBeUndefined();
    expect(screen.queryByTestId("badge-route-fallback")).toBeNull();
  });
});

// ===========================================================================
// 3) MonitorPopoutPage (pop-out)
// ===========================================================================
describe("MonitorPopoutPage ↔ /api/route-geometry (Geoapify nere)", () => {
  function buildWorkOrders(): WorkOrderWithObject[] {
    const now = new Date().toISOString();
    return [
      { id: "wo1", title: "Jobb A", resourceId: "r1", scheduledDate: now, scheduledStartTime: "08:00", taskLatitude: P1[0], taskLongitude: P1[1], orderStatus: "planned" },
      { id: "wo2", title: "Jobb B", resourceId: "r1", scheduledDate: now, scheduledStartTime: "09:00", taskLatitude: P2[0], taskLongitude: P2[1], orderStatus: "planned" },
      { id: "wo3", title: "Jobb C", resourceId: "r1", scheduledDate: now, scheduledStartTime: "10:00", taskLatitude: P3[0], taskLongitude: P3[1], orderStatus: "planned" },
    ] as unknown as WorkOrderWithObject[];
  }

  function renderPage() {
    const client = makeClient();
    // Seed:a queries så att enbart route-geometri-anropet går till test-servern.
    client.setQueryData(["/api/work-orders"], buildWorkOrders());
    client.setQueryData(["/api/resources"], [{ id: "r1", name: "Resurs 1" }]);
    client.setQueryData(["/api/resources/active-positions"], []);
    client.setQueryData(["/api/clusters/zones"], { clusterZones: [], resourceZones: [] });
    return render(
      <QueryClientProvider client={client}>
        <MonitorPopoutPage />
      </QueryClientProvider>,
    );
  }

  it("ritar raka fallback-linjer när servern svarar 500 (nyckel saknas)", async () => {
    mockIsAvailable.mockReturnValue(false); // → 500

    renderPage();

    await waitFor(() => {
      expect(findPolylineByPositions(STRAIGHT_LINE)).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("route-geometry-fallback-indicator"),
      ).toBeTruthy();
    });
    expect(mockIsAvailable).toHaveBeenCalled();
  });

  it("ritar raka fallback-linjer när servern svarar 502 (routing-tjänst nere)", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockResolvedValue(null); // → 502

    renderPage();

    await waitFor(() => {
      expect(findPolylineByPositions(STRAIGHT_LINE)).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("route-geometry-fallback-indicator"),
      ).toBeTruthy();
    });
    expect(mockGetRouteGeometry).toHaveBeenCalled();
  });

  it("ritar den riktiga vägbaserade polylinjen när servern svarar 200", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockResolvedValue({ coordinates: ROAD_GEOMETRY });

    renderPage();

    await waitFor(() => {
      expect(findPolylineByPositions(ROAD_GEOMETRY)).toBeTruthy();
    });
    expect(findPolylineByPositions(STRAIGHT_LINE)).toBeUndefined();
    expect(
      screen.queryByTestId("route-geometry-fallback-indicator"),
    ).toBeNull();
  });
});

// ===========================================================================
// 4) OptimizedRouteMap (VRP-/klusterläge — flera fordon/rutter)
// ===========================================================================
// Klusterläget har en EGEN, separat fallback-gren: per-rutt geometri lagras i
// roadGeometries[route.resourceId] och varje rutt ritas med sin egen polyline.
// Fallback-indikatorn (badge-route-fallback) visas så snart MINST en rutt med
// ≥2 stopp saknar vägbaserad geometri. Testar 500/502 (alla faller tillbaka),
// 200 (alla får riktiga polylines) samt blandfallet (en lyckas, en faller
// tillbaka → badge syns + den lyckade rutten ritas vägbaserat).
describe("OptimizedRouteMap VRP-läge ↔ /api/route-geometry (flera fordon)", () => {
  // Två fordon, varje fordon ≥2 stopp, på distinkta koordinater så vi kan skilja
  // rutterna åt i DOM:en och styra mocken per rutt via waypoints[0].lat.
  const V1P1: [number, number] = [62.39, 17.3];
  const V1P2: [number, number] = [62.4, 17.31];
  const V2P1: [number, number] = [63.5, 18.4];
  const V2P2: [number, number] = [63.51, 18.41];

  const ROUTE1_STRAIGHT: [number, number][] = [V1P1, V1P2];
  const ROUTE2_STRAIGHT: [number, number][] = [V2P1, V2P2];
  const ROUTE1_ROAD: [number, number][] = [V1P1, [62.395, 17.305], V1P2];
  const ROUTE2_ROAD: [number, number][] = [V2P1, [63.505, 18.405], V2P2];

  const vrpRoutes = [
    {
      resourceId: "veh-1",
      resourceName: "Fordon 1",
      totalDistanceKm: 12.3,
      totalDurationMinutes: 45,
      stops: [
        { orderId: "o1", orderTitle: "Jobb 1", sequence: 1, location: { lat: V1P1[0], lng: V1P1[1] }, serviceMinutes: 30 },
        { orderId: "o2", orderTitle: "Jobb 2", sequence: 2, location: { lat: V1P2[0], lng: V1P2[1] }, serviceMinutes: 30 },
      ],
    },
    {
      resourceId: "veh-2",
      resourceName: "Fordon 2",
      totalDistanceKm: 8.7,
      totalDurationMinutes: 30,
      stops: [
        { orderId: "o3", orderTitle: "Jobb 3", sequence: 1, location: { lat: V2P1[0], lng: V2P1[1] }, serviceMinutes: 30 },
        { orderId: "o4", orderTitle: "Jobb 4", sequence: 2, location: { lat: V2P2[0], lng: V2P2[1] }, serviceMinutes: 30 },
      ],
    },
  ];

  function renderView() {
    return render(
      <QueryClientProvider client={makeClient()}>
        <OptimizedRouteMap vrpRoutes={vrpRoutes as any} />
      </QueryClientProvider>,
    );
  }

  it("ritar raka fallback-linjer för VARJE rutt när servern svarar 500 (nyckel saknas)", async () => {
    mockIsAvailable.mockReturnValue(false); // → 500 för alla rutter

    renderView();

    await waitFor(() => {
      expect(findPolylineByPositions(ROUTE1_STRAIGHT)).toBeTruthy();
      expect(findPolylineByPositions(ROUTE2_STRAIGHT)).toBeTruthy();
    });
    // Båda fallback-linjerna är streckade (dashArray satt, ej riktig körväg).
    expect(findPolylineByPositions(ROUTE1_STRAIGHT)?.getAttribute("data-dasharray")).toBe("8, 4");
    expect(findPolylineByPositions(ROUTE2_STRAIGHT)?.getAttribute("data-dasharray")).toBe("8, 4");
    await waitFor(() => {
      expect(screen.getByTestId("badge-route-fallback")).toBeTruthy();
    });
    expect(mockIsAvailable).toHaveBeenCalled();
  });

  it("ritar raka fallback-linjer för VARJE rutt när servern svarar 502 (routing-tjänst nere)", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockResolvedValue(null); // → 502 för alla rutter

    renderView();

    await waitFor(() => {
      expect(findPolylineByPositions(ROUTE1_STRAIGHT)).toBeTruthy();
      expect(findPolylineByPositions(ROUTE2_STRAIGHT)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByTestId("badge-route-fallback")).toBeTruthy();
    });
    expect(mockGetRouteGeometry).toHaveBeenCalledTimes(2);
  });

  it("ritar riktiga vägbaserade polylines för båda rutterna när servern svarar 200", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockImplementation(async (waypoints) => {
      // Skilj rutterna åt på första waypointens latitud.
      if (waypoints[0].lat === V1P1[0]) return { coordinates: ROUTE1_ROAD };
      return { coordinates: ROUTE2_ROAD };
    });

    renderView();

    await waitFor(() => {
      expect(findPolylineByPositions(ROUTE1_ROAD)).toBeTruthy();
      expect(findPolylineByPositions(ROUTE2_ROAD)).toBeTruthy();
    });
    // Inga raka fallback-linjer och ingen fallback-badge.
    expect(findPolylineByPositions(ROUTE1_STRAIGHT)).toBeUndefined();
    expect(findPolylineByPositions(ROUTE2_STRAIGHT)).toBeUndefined();
    expect(screen.queryByTestId("badge-route-fallback")).toBeNull();
  });

  it("blandfall: en rutt lyckas (vägbaserad) och en faller tillbaka (rak) → badge syns", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockImplementation(async (waypoints) => {
      // Fordon 1 lyckas, Fordon 2 misslyckas (null → 502).
      if (waypoints[0].lat === V1P1[0]) return { coordinates: ROUTE1_ROAD };
      return null;
    });

    renderView();

    await waitFor(() => {
      // Rutt 1 ritas vägbaserad, rutt 2 faller tillbaka till rak linje.
      expect(findPolylineByPositions(ROUTE1_ROAD)).toBeTruthy();
      expect(findPolylineByPositions(ROUTE2_STRAIGHT)).toBeTruthy();
    });
    // Rutt 1 ska INTE ha någon rak fallback-linje.
    expect(findPolylineByPositions(ROUTE1_STRAIGHT)).toBeUndefined();
    // Fallback-badgen ska visas eftersom minst en rutt föll tillbaka.
    await waitFor(() => {
      expect(screen.getByTestId("badge-route-fallback")).toBeTruthy();
    });
  });
});
