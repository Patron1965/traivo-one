import { Router, Request, Response } from 'express';
import { pool } from '../../db';
import { MOCK_RESOURCE } from './mockData';
import {
  IS_MOCK_MODE, traivoFetch, getAuthHeader,
  haversineDistance, parseCoordPoints, simplifyCoordinates, buildFallbackResponse,
} from './proxyHelper';

interface CoordPoint {
  lat: number;
  lon: number;
}

interface GeoapifyLeg {
  time?: number;
  distance?: number;
  steps?: GeoapifyStep[];
}

interface GeoapifyStep {
  geometry?: unknown;
  distance?: number;
  time?: number;
}

interface GeoapifyAction {
  type: string;
  job_id?: string;
}

interface DistancePair {
  id: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}

const router = Router();

router.get('/route', async (req: Request, res: Response) => {
  const rawCoords = req.query.coords;
  const coords = typeof rawCoords === 'string' ? decodeURIComponent(rawCoords).trim() : '';
  console.log('[route] raw coords type:', typeof rawCoords, 'value:', JSON.stringify(rawCoords), 'decoded length:', coords.length, 'hasApiKey:', !!process.env.GEOAPIFY_API_KEY);
  if (!coords) {
    return res.status(400).json({ error: 'coords parameter required (lon1,lat1;lon2,lat2;...)' });
  }

  const parsed = parseCoordPoints(coords);
  if (!parsed || parsed.length < 2 || parsed.length > 25) {
    return res.status(400).json({ error: 'Between 2 and 25 valid coordinate pairs required' });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    console.warn('[route] GEOAPIFY_API_KEY not set, returning fallback');
    return res.json(buildFallbackResponse(parsed));
  }

  const waypoints = parsed.map((p: CoordPoint) => `${p.lat},${p.lon}`).join('|');
  const url = `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&details=route_details&traffic=approximated&apiKey=${apiKey}`;

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15000);

  try {
    const response = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);
    console.log('[route] Geoapify response status:', response.status);

    if (!response.ok) {
      const text = await response.text();
      console.error('[route] Geoapify error:', response.status, text.substring(0, 300));
      return res.json(buildFallbackResponse(parsed));
    }

    const data = await response.json();
    const features = data?.features;
    if (!features || features.length === 0) {
      console.error('[route] Geoapify: no features in response');
      return res.json(buildFallbackResponse(parsed));
    }

    const feature = features[0];
    const props = feature.properties;
    const geometry = feature.geometry;

    let allCoordinates: number[][] = [];
    if (geometry.type === 'MultiLineString') {
      for (const line of geometry.coordinates) {
        allCoordinates = allCoordinates.concat(line);
      }
    } else if (geometry.type === 'LineString') {
      allCoordinates = geometry.coordinates;
    }

    const trafficDuration = props.time || 0;
    const totalDistanceMeters = props.distance || 0;
    const normalDuration = totalDistanceMeters > 0 ? Math.round(totalDistanceMeters / 12.5) : trafficDuration;

    const legs = (props.legs || []).map((leg: GeoapifyLeg) => {
      const legTrafficDuration = leg.time || 0;
      const legDist = leg.distance || 0;
      const legNormalDuration = legDist > 0 ? Math.round(legDist / 12.5) : legTrafficDuration;
      return {
        distance: legDist,
        duration: legTrafficDuration,
        durationWithoutTraffic: legNormalDuration,
        steps: [],
      };
    });

    const simplified = simplifyCoordinates(allCoordinates, 1500);
    console.log('[route] Success: rawCoords=', allCoordinates.length, 'simplified=', simplified.length, 'dist=', totalDistanceMeters, 'dur=', trafficDuration, 'normalDur=', normalDuration);
    res.json({
      waypoints: parsed.map((p: CoordPoint, i: number) => ({
        location: [p.lon, p.lat],
        waypointIndex: i,
        tripsIndex: 0,
      })),
      trips: [{
        geometry: { type: 'LineString', coordinates: simplified },
        distance: totalDistanceMeters,
        duration: trafficDuration,
        durationWithoutTraffic: normalDuration,
        legs,
      }],
    });
  } catch (error: unknown) {
    clearTimeout(timeout);
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('[route] Geoapify fetch error:', msg);
    res.json(buildFallbackResponse(parsed));
  }
});

router.get('/route-optimized', async (req: Request, res: Response) => {
  const coords = req.query.coords as string;
  if (!coords) {
    return res.status(400).json({ error: 'coords parameter required (lon1,lat1;lon2,lat2;...)' });
  }

  const parsed = parseCoordPoints(coords);
  if (!parsed || parsed.length < 2 || parsed.length > 25) {
    return res.status(400).json({ error: 'Between 2 and 25 valid coordinate pairs required' });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    console.warn('GEOAPIFY_API_KEY not set, returning fallback');
    return res.json(buildFallbackResponse(parsed));
  }

  const startPoint = parsed[0];
  const jobPoints = parsed.slice(1);

  const body = {
    mode: 'drive',
    agents: [{
      start_location: [startPoint.lon, startPoint.lat],
    }],
    jobs: jobPoints.map((p: CoordPoint, i: number) => ({
      id: `job_${i}`,
      location: [p.lon, p.lat],
      duration: 600,
    })),
  };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 20000);

  try {
    const response = await fetch(`https://api.geoapify.com/v1/routeplanner?apiKey=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      console.error('Geoapify planner error:', response.status, text.substring(0, 300));
      return res.json(buildFallbackResponse(parsed));
    }

    const data = await response.json();
    const features = data?.features;
    if (!features || features.length === 0) {
      console.error('Geoapify planner: no features');
      return res.json(buildFallbackResponse(parsed));
    }

    const agentFeature = features.find((f: { properties?: { agent_index?: number } }) => f.properties?.agent_index !== undefined);
    if (!agentFeature) {
      console.error('Geoapify planner: no agent feature found');
      return res.json(buildFallbackResponse(parsed));
    }

    const props = agentFeature.properties;
    const geometry = agentFeature.geometry;

    let allCoordinates: number[][] = [];
    if (geometry.type === 'MultiLineString') {
      for (const line of geometry.coordinates) {
        allCoordinates = allCoordinates.concat(line);
      }
    } else if (geometry.type === 'LineString') {
      allCoordinates = geometry.coordinates;
    }

    const actions: GeoapifyAction[] = props.actions || [];
    const jobActions = actions.filter((a: GeoapifyAction) => a.type === 'job');
    const optimizedOrder: number[] = [];
    for (const a of jobActions) {
      const jobIdx = parseInt(a.job_id?.replace('job_', '') || '-1', 10);
      if (jobIdx >= 0 && jobIdx < jobPoints.length) {
        optimizedOrder.push(jobIdx + 1);
      }
    }

    if (optimizedOrder.length === 0) {
      console.warn('Geoapify planner: no valid job actions found');
      return res.json(buildFallbackResponse(parsed));
    }

    const allIndices = [0, ...optimizedOrder];
    const reorderedWaypoints = allIndices.map((origIdx) => ({
      location: [parsed[origIdx].lon, parsed[origIdx].lat],
      waypointIndex: origIdx,
      tripsIndex: 0,
    }));

    const reorderedPoints = allIndices.map(i => parsed[i]);
    const routeWaypoints = reorderedPoints.map((p: CoordPoint) => `${p.lat},${p.lon}`).join('|');
    const routeUrl = `https://api.geoapify.com/v1/routing?waypoints=${routeWaypoints}&mode=drive&details=route_details&traffic=approximated&apiKey=${apiKey}`;

    const ctrl2 = new AbortController();
    const timeout2 = setTimeout(() => ctrl2.abort(), 15000);
    try {
      const routeResp = await fetch(routeUrl, { signal: ctrl2.signal });
      clearTimeout(timeout2);

      if (routeResp.ok) {
        const routeData = await routeResp.json();
        const routeFeature = routeData?.features?.[0];
        if (routeFeature) {
          const routeGeom = routeFeature.geometry;
          let routeCoords: number[][] = [];
          if (routeGeom.type === 'MultiLineString') {
            for (const line of routeGeom.coordinates) {
              routeCoords = routeCoords.concat(line);
            }
          } else if (routeGeom.type === 'LineString') {
            routeCoords = routeGeom.coordinates;
          }

          const routeProps = routeFeature.properties;
          const routeTrafficDuration = routeProps.time || props.time || 0;
          const routeTotalDist = routeProps.distance || props.distance || 0;
          const routeNormalDuration = routeTotalDist > 0 ? Math.round(routeTotalDist / 12.5) : routeTrafficDuration;

          const routeLegs = (routeProps.legs || []).map((leg: GeoapifyLeg) => {
            const legTrafficDur = leg.time || 0;
            const legDist = leg.distance || 0;
            const legNormalDur = legDist > 0 ? Math.round(legDist / 12.5) : legTrafficDur;
            return {
              distance: legDist,
              duration: legTrafficDur,
              durationWithoutTraffic: legNormalDur,
              steps: ((leg.steps || []) as GeoapifyStep[]).map((step: GeoapifyStep) => ({
                geometry: step.geometry || null,
                distance: step.distance || 0,
                duration: step.time || 0,
              })),
            };
          });

          return res.json({
            waypoints: reorderedWaypoints,
            trips: [{
              geometry: { type: 'LineString', coordinates: simplifyCoordinates(routeCoords, 1500) },
              distance: routeTotalDist,
              duration: routeTrafficDuration,
              durationWithoutTraffic: routeNormalDuration,
              legs: routeLegs,
            }],
            optimized: true,
          });
        }
      }
    } catch (routeErr: unknown) {
      clearTimeout(timeout2);
      const msg = routeErr instanceof Error ? routeErr.message : 'unknown';
      console.warn('Geoapify routing for optimized order failed:', msg);
    }

    const fallbackTrafficDur = props.time || 0;
    const fallbackDist = props.distance || 0;
    const fallbackNormalDur = fallbackDist > 0 ? Math.round(fallbackDist / 12.5) : fallbackTrafficDur;

    const legs = (props.legs || []).map((leg: GeoapifyLeg) => {
      const ld = leg.distance || 0;
      const lt = leg.time || 0;
      return {
        distance: ld,
        duration: lt,
        durationWithoutTraffic: ld > 0 ? Math.round(ld / 12.5) : lt,
        steps: [],
      };
    });

    res.json({
      waypoints: reorderedWaypoints,
      trips: [{
        geometry: { type: 'LineString', coordinates: simplifyCoordinates(allCoordinates, 1500) },
        distance: fallbackDist,
        duration: fallbackTrafficDur,
        durationWithoutTraffic: fallbackNormalDur,
        legs,
      }],
      optimized: true,
    });
  } catch (error: unknown) {
    clearTimeout(timeout);
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('Geoapify planner fetch error:', msg);
    res.json(buildFallbackResponse(parsed));
  }
});

const mockOptJobs = new Map<string, { status: string; progress: number; createdAt: number }>();

router.post('/optimize-route', async (req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    const jobId = `opt-${Date.now()}`;
    mockOptJobs.set(jobId, { status: 'completed', progress: 100, createdAt: Date.now() });
    setTimeout(() => mockOptJobs.delete(jobId), 300000);
    return res.json({ success: true, jobId, estimatedTime: 15 });
  }
  try {
    const { status, data } = await traivoFetch('/api/optimization/submit', {
      method: 'POST',
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: 'Kunde inte starta optimering' });
  }
});

router.get('/optimize-route/:jobId/status', async (req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    const job = mockOptJobs.get(req.params.jobId);
    return res.json(job || { status: 'completed', progress: 100 });
  }
  try {
    const { status, data } = await traivoFetch(
      `/api/optimization/jobs/${req.params.jobId}/status`,
      { method: 'GET', headers: getAuthHeader(req) }
    );
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: 'Kunde inte hämta optimeringsstatus' });
  }
});

router.get('/optimize-route/:jobId/result', async (req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    return res.json({ success: true, optimizedRoute: null });
  }
  try {
    const { status, data } = await traivoFetch(
      `/api/optimization/jobs/${req.params.jobId}/result`,
      { method: 'GET', headers: getAuthHeader(req) }
    );
    res.status(status).json(data);
  } catch {
    res.status(503).json({ error: 'Kunde inte hämta optimeringsresultat' });
  }
});

router.post('/position/batch', async (req: Request, res: Response) => {
  const { positions } = req.body;
  if (!Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({ error: 'positions array required' });
  }
  const driverId = IS_MOCK_MODE ? String(MOCK_RESOURCE.id) : 'unknown';
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS driver_location_history (
        id SERIAL PRIMARY KEY,
        driver_id VARCHAR(255) NOT NULL,
        latitude DOUBLE PRECISION NOT NULL,
        longitude DOUBLE PRECISION NOT NULL,
        speed DOUBLE PRECISION DEFAULT 0,
        heading DOUBLE PRECISION DEFAULT 0,
        accuracy DOUBLE PRECISION DEFAULT 0,
        recorded_at TIMESTAMP DEFAULT NOW()
      )
    `);
    for (const pos of positions.slice(-50)) {
      await pool.query(
        `INSERT INTO driver_location_history (driver_id, latitude, longitude, speed, heading, accuracy, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [driverId, pos.latitude, pos.longitude, pos.speed || 0, pos.heading || 0, pos.accuracy || 0,
         pos.timestamp ? new Date(pos.timestamp) : new Date()]
      );
    }
    res.json({ received: true, count: positions.length });
  } catch (err: any) {
    console.error('Batch position save error:', err.message);
    res.json({ received: true, count: 0 });
  }
});

router.get('/route-metrics/today', async (_req: Request, res: Response) => {
  const driverId = IS_MOCK_MODE ? String(MOCK_RESOURCE.id) : 'unknown';
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as positions,
        MIN(recorded_at) as first_pos, MAX(recorded_at) as last_pos
       FROM driver_location_history
       WHERE driver_id = $1 AND recorded_at::date = CURRENT_DATE`,
      [driverId]
    );
    const row = result.rows[0] || {};
    const posCount = parseInt(row.positions || '0');
    res.json({
      totalDistance: posCount > 0 ? Math.round(posCount * 0.3 * 10) / 10 : 0,
      totalDuration: posCount > 0 ? Math.round((new Date(row.last_pos).getTime() - new Date(row.first_pos).getTime()) / 60000) : 0,
      stopsCompleted: 0,
      stopsReordered: 0,
    });
  } catch {
    res.json({ totalDistance: 0, totalDuration: 0, stopsCompleted: 0, stopsReordered: 0 });
  }
});

router.post('/distance', async (req: Request, res: Response) => {
  const { fromLat, fromLng, toLat, toLng } = req.body;
  if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
    return res.status(400).json({ error: 'fromLat, fromLng, toLat, toLng krävs' });
  }
  if (IS_MOCK_MODE) {
    const distKm = haversineDistance(fromLat, fromLng, toLat, toLng);
    const durationMin = Math.round(distKm * 1.4);
    return res.json({ distanceKm: Math.round(distKm * 10) / 10, durationMin: Math.max(1, durationMin), source: 'haversine' as const });
  }
  try {
    const { status, data } = await traivoFetch('/api/distance', {
      method: 'POST',
      headers: getAuthHeader(req),
      body: JSON.stringify({ fromLat, fromLng, toLat, toLng }),
    });
    res.status(status).json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('[LIVE] Distance proxy error:', msg);
    res.status(503).json({ error: 'Kunde inte beräkna avstånd. Försök igen.' });
  }
});

router.post('/distance/batch', async (req: Request, res: Response) => {
  const { pairs } = req.body;
  if (!Array.isArray(pairs)) {
    return res.status(400).json({ error: 'pairs array krävs' });
  }
  const results: Record<string, { distanceKm: number; durationMin: number; source: 'haversine' }> = {};
  for (const p of pairs as DistancePair[]) {
    const distKm = haversineDistance(p.fromLat, p.fromLng, p.toLat, p.toLng);
    results[p.id] = { distanceKm: Math.round(distKm * 10) / 10, durationMin: Math.max(1, Math.round(distKm * 1.4)), source: 'haversine' as const };
  }
  res.json({ results });
});

export { router as routingRouter };
