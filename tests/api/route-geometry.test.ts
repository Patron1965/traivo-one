import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";

// Mocka routing-tjänsten så att route-geometri-handlern kan testas utan
// Geoapify-nyckel eller nätverksanrop. Handlern gör dynamisk import av
// "../services/routing" (relativt server/routes/), vilket vi fångar här.
const mockIsAvailable = vi.fn<[], boolean>();
const mockGetRouteGeometry =
  vi.fn<[Array<{ lat: number; lng: number }>], Promise<{ coordinates: [number, number][] } | null>>();

vi.mock("../../server/services/routing", () => ({
  isGeoapifyRoutingAvailable: () => mockIsAvailable(),
  getRouteGeometry: (waypoints: Array<{ lat: number; lng: number }>) =>
    mockGetRouteGeometry(waypoints),
}));

import { registerRouteGeometryRoutes } from "../../server/routes/routeGeometryRoutes";

let server: Server;
let baseUrl: string;

async function postGeometry(body: unknown) {
  const res = await fetch(`${baseUrl}/api/route-geometry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json: json as Record<string, unknown> | null, raw: text };
}

const VALID_WAYPOINTS = [
  { lat: 59.3293, lng: 18.0686 },
  { lat: 59.8586, lng: 17.6389 },
];

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
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  mockIsAvailable.mockReset();
  mockGetRouteGeometry.mockReset();
});

describe("POST /api/route-geometry — validering", () => {
  it("returnerar 400 med strukturerad payload när waypoints saknas", async () => {
    mockIsAvailable.mockReturnValue(true);
    const res = await postGeometry({});
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "Minst 2 waypoints krävs" });
    expect(mockGetRouteGeometry).not.toHaveBeenCalled();
  });

  it("returnerar 400 när färre än 2 waypoints skickas", async () => {
    mockIsAvailable.mockReturnValue(true);
    const res = await postGeometry({ waypoints: [{ lat: 59.3, lng: 18.0 }] });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "Minst 2 waypoints krävs" });
  });

  it("returnerar 400 när waypoints inte är en array", async () => {
    mockIsAvailable.mockReturnValue(true);
    const res = await postGeometry({ waypoints: "inte-en-array" });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "Minst 2 waypoints krävs" });
  });

  it("returnerar 400 när fler än 25 waypoints skickas", async () => {
    mockIsAvailable.mockReturnValue(true);
    const waypoints = Array.from({ length: 26 }, (_, i) => ({ lat: 59 + i * 0.01, lng: 18 }));
    const res = await postGeometry({ waypoints });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "Max 25 waypoints" });
    expect(mockGetRouteGeometry).not.toHaveBeenCalled();
  });
});

describe("POST /api/route-geometry — kontrollerade fel (frontend-fallbackens kontrakt)", () => {
  it("returnerar 500 med strukturerad payload när Geoapify-nyckeln saknas", async () => {
    mockIsAvailable.mockReturnValue(false);
    const res = await postGeometry({ waypoints: VALID_WAYPOINTS });
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "Geoapify API-nyckel saknas" });
    expect(mockGetRouteGeometry).not.toHaveBeenCalled();
  });

  it("returnerar 502 med strukturerad payload när routing-tjänsten ger null", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockResolvedValue(null);
    const res = await postGeometry({ waypoints: VALID_WAYPOINTS });
    expect(res.status).toBe(502);
    expect(res.json).toEqual({ error: "Geoapify routing-fel" });
  });

  it("returnerar 500 med strukturerad payload (ingen läcka) när routing kastar", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockRejectedValue(new Error("ECONNREFUSED hemlig-intern-detalj"));
    const res = await postGeometry({ waypoints: VALID_WAYPOINTS });
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "Kunde inte hämta ruttgeometri" });
    // Säkerställ att internt felmeddelande/stacktrace inte läcker till klienten.
    expect(res.raw).not.toContain("hemlig-intern-detalj");
    expect(res.raw).not.toContain("ECONNREFUSED");
  });
});

describe("POST /api/route-geometry — lyckat svar (mockad routing)", () => {
  it("returnerar 200 med coordinates-array när routing-tjänsten är tillgänglig", async () => {
    const coordinates: [number, number][] = [
      [59.3293, 18.0686],
      [59.5, 17.85],
      [59.8586, 17.6389],
    ];
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockResolvedValue({ coordinates });

    const res = await postGeometry({ waypoints: VALID_WAYPOINTS });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ coordinates });
    expect(mockGetRouteGeometry).toHaveBeenCalledWith(VALID_WAYPOINTS);
  });

  it("returnerar 200 med tom coordinates-array när rutten saknar geometri", async () => {
    mockIsAvailable.mockReturnValue(true);
    mockGetRouteGeometry.mockResolvedValue({ coordinates: [] });

    const res = await postGeometry({ waypoints: VALID_WAYPOINTS });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ coordinates: [] });
  });
});
