import type { Express, Request as ExpressRequest, Response as ExpressResponse } from "express";

/**
 * POST /api/route-geometry
 *
 * Returnerar polyline-koordinater för en rutt mellan waypoints. Frontend
 * använder svaret för att rita rutten på kartan och faller tillbaka till raka
 * linjer om endpointen failar. Därför måste den fail:a kontrollerat och
 * förutsägbart (rätt statuskod + strukturerad `{ error }`-payload) snarare än
 * krascha eller läcka — kontraktet som frontend-fallbacken litar på.
 */
export function registerRouteGeometryRoutes(app: Express): void {
  app.post("/api/route-geometry", async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { waypoints } = req.body;
      if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
        return res.status(400).json({ error: "Minst 2 waypoints krävs" });
      }

      if (waypoints.length > 25) {
        return res.status(400).json({ error: "Max 25 waypoints" });
      }

      const { getRouteGeometry, isGeoapifyRoutingAvailable } = await import(
        "../services/routing"
      );
      if (!isGeoapifyRoutingAvailable()) {
        return res.status(500).json({ error: "Geoapify API-nyckel saknas" });
      }

      const result = await getRouteGeometry(
        waypoints.map((wp: { lat: number; lng: number }) => ({ lat: wp.lat, lng: wp.lng })),
      );
      if (!result) {
        return res.status(502).json({ error: "Geoapify routing-fel" });
      }
      res.json({ coordinates: result.coordinates });
    } catch (error) {
      console.error("[route-geometry] Error:", error);
      res.status(500).json({ error: "Kunde inte hämta ruttgeometri" });
    }
  });
}
