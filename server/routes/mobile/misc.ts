import { Router } from 'express';
import { pool } from '../../db';
import {
  MOCK_RESOURCE, MOCK_ORDERS, MOCK_NOTIFICATIONS_LEGACY, MOCK_ARTICLES,
  MOCK_NOTIFICATIONS, MOCK_DISRUPTIONS, MOCK_CHANGE_REQUESTS, MOCK_MAX_LOGS,
  CHANGE_REQUEST_CATEGORIES, findMockOrder,
} from './mockData';
import {
  IS_MOCK_MODE, traivoFetch, getAuthHeader, haversineDistance,
  parseCoordPoints, simplifyCoordinates, buildFallbackResponse,
} from './proxyHelper';

const router = Router();

router.get('/notifications/count', async (req, res) => {
  if (IS_MOCK_MODE) {
    const unread = MOCK_NOTIFICATIONS_LEGACY.filter(n => !n.isRead).length;
    res.json({ count: unread });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/notifications/count', { method: 'GET', headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: any) {
    console.error('[LIVE] Notifications count proxy error:', error.message);
    res.status(503).json({ error: 'Kunde inte hämta antal aviseringar. Försök igen.' });
  }
});

router.get('/notifications', async (req, res) => {
  if (IS_MOCK_MODE) {
    const unreadCount = MOCK_NOTIFICATIONS.filter(n => !n.read).length;
    res.json({ notifications: MOCK_NOTIFICATIONS, unreadCount });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/notifications', { headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: any) {
    console.error('Notifications fetch error:', error?.message);
    res.status(503).json({ error: 'Kunde inte hämta aviseringar.' });
  }
});

router.post('/notifications/:id/read', async (req, res) => {
  if (IS_MOCK_MODE) {
    const id = parseInt(req.params.id);
    const notif = MOCK_NOTIFICATIONS.find(n => n.id === id);
    if (notif) notif.read = true;
    res.json({ success: true });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/notifications/${req.params.id}/read`, {
      method: 'POST', headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch (error: any) {
    res.status(503).json({ error: 'Kunde inte markera som läst.' });
  }
});

router.post('/notifications/read-all', async (req, res) => {
  if (IS_MOCK_MODE) {
    MOCK_NOTIFICATIONS.forEach(n => { n.read = true; });
    res.json({ success: true, count: MOCK_NOTIFICATIONS.length });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/notifications/read-all', {
      method: 'POST', headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch (error: any) {
    res.status(503).json({ error: 'Kunde inte markera alla som lästa.' });
  }
});

router.get('/map-config', async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json({
      defaultCenter: { latitude: 59.1950, longitude: 17.6260 },
      defaultZoom: 12,
      clusterRadius: 50,
      showTraffic: false,
      mapStyle: 'standard',
      refreshIntervalMs: 30000,
      maxMarkersVisible: 200,
    });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/map-config', { method: 'GET', headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: any) {
    console.error('[LIVE] Map-config proxy error:', error.message);
    res.status(503).json({ error: 'Kunde inte hämta kartkonfiguration. Försök igen.' });
  }
});

router.post('/sync', async (req, res) => {
  if (IS_MOCK_MODE) {
    const { actions } = req.body;
    if (!Array.isArray(actions)) { res.status(400).json({ error: 'actions måste vara en array' }); return; }
    const results = actions.map((action: any) => ({ clientId: action.clientId, success: true, serverTimestamp: new Date().toISOString() }));
    res.json({ success: true, results });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/sync', {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Synkronisering misslyckades.' }); }
});

router.get('/sync/status', async (req, res) => {
  res.json({ lastSync: new Date().toISOString(), pendingActions: 0 });
});

router.get('/articles', (req, res) => {
  const search = (req.query.search as string || '').toLowerCase();
  if (search) {
    res.json(MOCK_ARTICLES.filter(a => a.name.toLowerCase().includes(search)));
  } else {
    res.json(MOCK_ARTICLES);
  }
});

router.get('/weather', async (_req, res) => {
  try {
    const response = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=59.1950&longitude=17.6260&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe/Stockholm&forecast_days=1'
    );
    const data = await response.json();
    const current = data.current;

    const weatherDescriptions: Record<number, string> = {
      0: 'Klart', 1: 'Mestadels klart', 2: 'Delvis molnigt', 3: 'Mulet',
      45: 'Dimma', 48: 'Dimma med rimfrost',
      51: 'Lätt duggregn', 53: 'Måttligt duggregn', 55: 'Kraftigt duggregn',
      61: 'Lätt regn', 63: 'Måttligt regn', 65: 'Kraftigt regn',
      71: 'Lätt snöfall', 73: 'Måttligt snöfall', 75: 'Kraftigt snöfall', 77: 'Snökorn',
      80: 'Lätta regnskurar', 81: 'Måttliga regnskurar', 82: 'Kraftiga regnskurar',
      85: 'Lätta snöbyar', 86: 'Kraftiga snöbyar',
      95: 'Åskväder', 96: 'Åskväder med hagel', 99: 'Åskväder med kraftigt hagel',
    };

    const weatherIcons: Record<number, string> = {
      0: 'sun', 1: 'sun', 2: 'cloud', 3: 'cloud',
      45: 'cloud', 48: 'cloud',
      51: 'cloud-drizzle', 53: 'cloud-drizzle', 55: 'cloud-drizzle',
      61: 'cloud-rain', 63: 'cloud-rain', 65: 'cloud-rain',
      71: 'cloud-snow', 73: 'cloud-snow', 75: 'cloud-snow', 77: 'cloud-snow',
      80: 'cloud-rain', 81: 'cloud-rain', 82: 'cloud-rain',
      85: 'cloud-snow', 86: 'cloud-snow',
      95: 'cloud-lightning', 96: 'cloud-lightning', 99: 'cloud-lightning',
    };

    const code = current.weather_code;
    const warnings: string[] = [];
    if (current.wind_speed_10m > 15) warnings.push('Blåsigt väder');
    if (current.precipitation > 5) warnings.push('Kraftig nederbörd');
    if (current.temperature_2m < 0) warnings.push('Minusgrader - halkrisk');
    if (code >= 95) warnings.push('Åskvarning');

    res.json({
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      description: weatherDescriptions[code] || 'Okänt',
      icon: weatherIcons[code] || 'cloud',
      windSpeed: Math.round(current.wind_speed_10m),
      precipitation: current.precipitation,
      warnings,
    });
  } catch (error) {
    res.json({
      temperature: 8,
      feelsLike: 5,
      description: 'Delvis molnigt',
      icon: 'cloud',
      windSpeed: 12,
      precipitation: 0,
      warnings: [],
    });
  }
});

router.get('/summary', async (req, res) => {
  if (IS_MOCK_MODE) {
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = MOCK_ORDERS.filter(o => o.scheduledDate === today);
    const remaining = todayOrders.filter(o => o.status !== 'completed' && o.status !== 'cancelled' && o.status !== 'failed');

    let totalDistance = 0;
    const sortedOrders = [...todayOrders].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 1; i < sortedOrders.length; i++) {
      const prev = sortedOrders[i - 1];
      const curr = sortedOrders[i];
      if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
        totalDistance += haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      }
    }

    res.json({
      totalOrders: todayOrders.length,
      completedOrders: todayOrders.filter(o => o.status === 'completed').length,
      remainingOrders: remaining.length,
      failedOrders: todayOrders.filter(o => o.status === 'failed').length,
      totalDuration: todayOrders.reduce((sum, o) => sum + o.estimatedDuration, 0),
      estimatedTimeRemaining: remaining.reduce((sum, o) => sum + o.estimatedDuration, 0),
      totalDistance: Math.round(totalDistance * 10) / 10,
    });
    return;
  }
  try {
    const { status: summaryStatus, data: summaryData } = await traivoFetch('/api/mobile/summary', {
      method: 'GET', headers: getAuthHeader(req),
    });
    if (summaryStatus === 200 && summaryData && summaryData.totalOrders !== undefined) {
      res.json(summaryData);
      return;
    }
  } catch {}
  try {
    const { status: ordersStatus, data: ordersData } = await traivoFetch('/api/mobile/my-orders', {
      method: 'GET', headers: getAuthHeader(req),
    });
    if (ordersStatus === 200) {
      const rawOrders = Array.isArray(ordersData) ? ordersData : (ordersData.orders || []);
      const completed = rawOrders.filter((o: any) => o.status === 'completed').length;
      const failed = rawOrders.filter((o: any) => o.status === 'failed' || o.status === 'impossible').length;
      const cancelled = rawOrders.filter((o: any) => o.status === 'cancelled').length;
      const remaining = rawOrders.length - completed - failed - cancelled;
      res.json({
        totalOrders: rawOrders.length,
        completedOrders: completed,
        remainingOrders: remaining,
        failedOrders: failed,
        totalDuration: rawOrders.reduce((sum: number, o: any) => sum + (o.estimatedDuration || 0), 0),
        estimatedTimeRemaining: rawOrders.filter((o: any) => o.status !== 'completed' && o.status !== 'failed' && o.status !== 'cancelled')
          .reduce((sum: number, o: any) => sum + (o.estimatedDuration || 0), 0),
      });
    } else {
      res.json({ totalOrders: 0, completedOrders: 0, remainingOrders: 0, failedOrders: 0, totalDuration: 0, estimatedTimeRemaining: 0 });
    }
  } catch (error: any) {
    console.error('[LIVE] Summary proxy error:', error.message);
    res.status(503).json({ error: 'Kunde inte hämta sammanfattning. Försök igen.' });
  }
});

router.get('/route', async (req, res) => {
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

  const waypoints = parsed.map(p => `${p.lat},${p.lon}`).join('|');
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

    const legs = (props.legs || []).map((leg: any) => {
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
      waypoints: parsed.map((p, i) => ({
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
  } catch (error: any) {
    clearTimeout(timeout);
    console.error('[route] Geoapify fetch error:', error.message);
    res.json(buildFallbackResponse(parsed));
  }
});

router.get('/route-optimized', async (req, res) => {
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
    jobs: jobPoints.map((p, i) => ({
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

    const agentFeature = features.find((f: any) => f.properties?.agent_index !== undefined);
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

    const actions = props.actions || [];
    const jobActions = actions.filter((a: any) => a.type === 'job');
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
    const routeWaypoints = reorderedPoints.map(p => `${p.lat},${p.lon}`).join('|');
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

          const routeLegs = (routeProps.legs || []).map((leg: any) => {
            const legTrafficDur = leg.time || 0;
            const legDist = leg.distance || 0;
            const legNormalDur = legDist > 0 ? Math.round(legDist / 12.5) : legTrafficDur;
            return {
              distance: legDist,
              duration: legTrafficDur,
              durationWithoutTraffic: legNormalDur,
              steps: (leg.steps || []).map((step: any) => ({
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
    } catch (routeErr: any) {
      clearTimeout(timeout2);
      console.warn('Geoapify routing for optimized order failed:', routeErr.message);
    }

    const fallbackTrafficDur = props.time || 0;
    const fallbackDist = props.distance || 0;
    const fallbackNormalDur = fallbackDist > 0 ? Math.round(fallbackDist / 12.5) : fallbackTrafficDur;

    const legs = (props.legs || []).map((leg: any) => {
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
  } catch (error: any) {
    clearTimeout(timeout);
    console.error('Geoapify planner fetch error:', error.message);
    res.json(buildFallbackResponse(parsed));
  }
});

router.post('/position', async (req, res) => {
  const { latitude, longitude, speed, heading, accuracy } = req.body;

  if (latitude == null || longitude == null || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'Giltiga latitude och longitude krävs' });
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Koordinater utanför giltigt intervall' });
  }

  if (!IS_MOCK_MODE) {
    try {
      await traivoFetch('/api/mobile/position', {
        method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
      });
    } catch (e: any) {
      console.error('[LIVE] Position proxy error:', e.message);
    }
  }

  try {
    if (latitude != null && longitude != null) {
      const driverId = IS_MOCK_MODE ? MOCK_RESOURCE.id : 'unknown';
      const driverName = IS_MOCK_MODE ? MOCK_RESOURCE.name : 'Okänd';
      const vehicleRegNo = IS_MOCK_MODE ? MOCK_RESOURCE.vehicleRegNo : '';
      await pool.query(
        `INSERT INTO driver_locations (driver_id, driver_name, vehicle_reg_no, latitude, longitude, speed, heading, accuracy, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW())
         ON CONFLICT (driver_id) DO UPDATE SET
           driver_name = EXCLUDED.driver_name,
           vehicle_reg_no = EXCLUDED.vehicle_reg_no,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           speed = COALESCE(EXCLUDED.speed, driver_locations.speed),
           heading = COALESCE(EXCLUDED.heading, driver_locations.heading),
           accuracy = COALESCE(EXCLUDED.accuracy, driver_locations.accuracy),
           status = 'active',
           updated_at = NOW()`,
        [driverId, driverName, vehicleRegNo, latitude, longitude, speed || 0, heading || 0, accuracy || 0]
      );
    }
    res.json({ received: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error saving GPS position:', error);
    res.json({ received: true, timestamp: new Date().toISOString() });
  }
});

router.post('/status', async (req, res) => {
  const { online } = req.body;
  try {
    const driverId = IS_MOCK_MODE ? MOCK_RESOURCE.id : 'unknown';
    const driverName = IS_MOCK_MODE ? MOCK_RESOURCE.name : 'Okänd';
    const vehicleRegNo = IS_MOCK_MODE ? MOCK_RESOURCE.vehicleRegNo : '';
    if (online) {
      await pool.query(
        `INSERT INTO driver_locations (driver_id, driver_name, vehicle_reg_no, latitude, longitude, status, updated_at)
         VALUES ($1, $2, $3, 0, 0, 'active', NOW())
         ON CONFLICT (driver_id) DO UPDATE SET
           status = 'active',
           updated_at = NOW()`,
        [driverId, driverName, vehicleRegNo]
      );
    } else {
      await pool.query(
        `UPDATE driver_locations SET status = 'offline', updated_at = NOW() WHERE driver_id = $1`,
        [driverId]
      );
    }
    res.json({ success: true, online });
  } catch (error) {
    console.error('Error updating driver status:', error);
    res.json({ success: true, online });
  }
});

router.post('/gps', async (req, res) => {
  const { latitude, longitude, speed, heading, accuracy, driverId, driverName, vehicleRegNo, currentOrderId, currentOrderNumber } = req.body;

  if (latitude == null || longitude == null || !driverId) {
    return res.status(400).json({ error: 'latitude, longitude och driverId krävs' });
  }
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'latitude och longitude måste vara nummer' });
  }

  try {
    if (latitude != null && longitude != null && driverId) {
      await pool.query(
        `INSERT INTO driver_locations (driver_id, driver_name, vehicle_reg_no, latitude, longitude, speed, heading, accuracy, current_order_id, current_order_number, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', NOW())
         ON CONFLICT (driver_id) DO UPDATE SET
           driver_name = EXCLUDED.driver_name,
           vehicle_reg_no = EXCLUDED.vehicle_reg_no,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           speed = COALESCE(EXCLUDED.speed, driver_locations.speed),
           heading = COALESCE(EXCLUDED.heading, driver_locations.heading),
           accuracy = COALESCE(EXCLUDED.accuracy, driver_locations.accuracy),
           current_order_id = EXCLUDED.current_order_id,
           current_order_number = EXCLUDED.current_order_number,
           status = 'active',
           updated_at = NOW()`,
        [driverId, driverName || 'Okänd', vehicleRegNo, latitude, longitude, speed || 0, heading || 0, accuracy || 0, currentOrderId, currentOrderNumber]
      );
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Error saving GPS position:', error);
    res.json({ received: true });
  }
});

router.post('/push-token', async (req, res) => {
  const { expoPushToken, platform } = req.body;
  const token = expoPushToken || req.body.token;
  if (!token) {
    return res.status(400).json({ error: 'expoPushToken krävs' });
  }
  const driverId = IS_MOCK_MODE ? String(MOCK_RESOURCE.id) : String(req.body.driverId || MOCK_RESOURCE.id);
  try {
    await pool.query(
      `INSERT INTO push_tokens (driver_id, expo_push_token, platform, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (driver_id)
       DO UPDATE SET expo_push_token = $2, platform = $3, updated_at = NOW()`,
      [String(driverId), token, platform]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('Push token registration error:', err.message);
    res.status(500).json({ error: 'Kunde inte registrera push-token' });
  }
});

router.delete('/push-token', async (req, res) => {
  const driverId = IS_MOCK_MODE ? String(MOCK_RESOURCE.id) : String(req.body.driverId || req.query.driverId || MOCK_RESOURCE.id);
  try {
    await pool.query('DELETE FROM push_tokens WHERE driver_id = $1', [driverId]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Push token removal error:', err.message);
    res.status(500).json({ error: 'Kunde inte ta bort push-token' });
  }
});

router.get('/route-feedback/mine', async (req, res) => {
  const driverId = MOCK_RESOURCE.id;
  try {
    const result = await pool.query(
      `SELECT * FROM route_feedback WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [driverId]
    );
    res.json({ success: true, feedback: result.rows });
  } catch (err: any) {
    console.error('Route feedback fetch error:', err.message);
    res.json({ success: true, feedback: [] });
  }
});

router.post('/route-feedback', async (req, res) => {
  const driverId = MOCK_RESOURCE.id;
  const { rating, reasons, comment, date } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Betyg (1-5) krävs' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO route_feedback (driver_id, rating, reasons, comment, feedback_date, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [driverId, rating, JSON.stringify(reasons || []), comment || '', date || new Date().toISOString().split('T')[0]]
    );
    res.json({ success: true, feedback: result.rows[0] });
  } catch (err: any) {
    console.error('Route feedback save error:', err.message);
    res.status(500).json({ error: 'Kunde inte spara ruttbetyg' });
  }
});

router.get('/terminology', async (req, res) => {
  const terminology: Record<string, string> = {
    order: 'Order',
    work_order: 'Arbetsorder',
    deviation: 'Avvikelse',
    material: 'Material',
    inspection: 'Inspektion',
    checklist: 'Checklista',
    signature: 'Signatur',
    driver: 'Chaufför',
    technician: 'Tekniker',
    planner: 'Planerare',
    customer: 'Kund',
    object: 'Objekt',
    article: 'Artikel',
    route: 'Rutt',
    work_session: 'Arbetspass',
    check_in: 'Incheckning',
    check_out: 'Utcheckning',
    pause: 'Paus',
    status_not_started: 'Ej påbörjad',
    status_in_progress: 'Pågående',
    status_completed: 'Utförd',
    status_failed: 'Misslyckad',
    status_cancelled: 'Inställd',
    status_on_site: 'På plats',
    status_travel: 'Under resa',
    status_signed_off: 'Kvitterad',
    priority_low: 'Låg',
    priority_medium: 'Medium',
    priority_high: 'Hög',
    priority_urgent: 'Brådskande',
    photo_before: 'Före',
    photo_after: 'Efter',
    route_feedback: 'Ruttbetyg',
    notification: 'Notifiering',
    team: 'Team',
  };

  if (!IS_MOCK_MODE) {
    try {
      const { status, data } = await traivoFetch('/api/mobile/terminology', {
        headers: getAuthHeader(req),
      });
      if (status === 200 && data && typeof data === 'object') {
        return res.json({ success: true, terminology: data.terminology || data });
      }
      return res.status(status).json(data);
    } catch (error: any) {
      console.error('[LIVE] Terminology proxy error:', error.message);
      return res.status(503).json({ error: 'Kunde inte hämta terminologi. Försök igen.' });
    }
  }
  res.json({ success: true, terminology });
});

router.get('/customer-change-requests/categories', async (_req, res) => {
  res.json({ success: true, categories: CHANGE_REQUEST_CATEGORIES });
});

router.get('/customer-change-requests/mine', async (req, res) => {
  if (IS_MOCK_MODE) {
    const resourceId = String((req as any).mobileResourceId || MOCK_RESOURCE.id);
    const mine = MOCK_CHANGE_REQUESTS.filter(r => r.reportedByResourceId === resourceId);
    res.json({ success: true, items: mine, total: mine.length });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/customer-change-requests/mine', {
      headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch (error: any) {
    console.error('Customer change requests mine error:', error?.message);
    res.status(503).json({ error: 'Kunde inte hämta kundrapporter.' });
  }
});

router.post('/customer-change-requests', async (req, res) => {
  if (IS_MOCK_MODE) {
    const newReport = {
      id: `cr-${Date.now()}`,
      ...req.body,
      status: 'new',
      reportedByName: MOCK_RESOURCE.name,
      reportedByResourceId: String(MOCK_RESOURCE.id),
      createdAt: new Date().toISOString(),
    };
    MOCK_CHANGE_REQUESTS.unshift(newReport);
    if (MOCK_CHANGE_REQUESTS.length > MOCK_MAX_LOGS) MOCK_CHANGE_REQUESTS.splice(MOCK_MAX_LOGS);
    res.json({ success: true, report: newReport });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/customer-change-requests', {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (error: any) {
    console.error('Customer change request create error:', error?.message);
    res.status(503).json({ error: 'Kunde inte skapa kundrapport.' });
  }
});

router.get('/deviations/mine', async (req, res) => {
  if (IS_MOCK_MODE) {
    const allDeviations: any[] = [];
    for (const order of MOCK_ORDERS) {
      if (order.deviations) {
        for (const d of order.deviations) {
          allDeviations.push({
            ...d,
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            address: order.address,
          });
        }
      }
    }
    allDeviations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ success: true, items: allDeviations, total: allDeviations.length });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/deviations/mine', {
      headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch (error: any) {
    console.error('My deviations error:', error?.message);
    res.status(503).json({ error: 'Kunde inte hämta avvikelser.' });
  }
});

router.post('/work-orders/carry-over', async (req, res) => {
  if (IS_MOCK_MODE) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const incomplete = MOCK_ORDERS.filter(o =>
      !['completed', 'utford', 'fakturerad', 'cancelled', 'impossible'].includes(o.status)
    );
    const carriedOver = incomplete.map(o => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      previousDate: yesterday.toISOString().split('T')[0],
      newDate: new Date().toISOString().split('T')[0],
    }));
    res.json({ success: true, carriedOver, count: carriedOver.length });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/work-orders/carry-over', {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (error: any) {
    console.error('Carry-over error:', error?.message);
    res.status(503).json({ error: 'Kunde inte flytta ordrar.' });
  }
});

router.post('/work-orders/:id/auto-eta-sms', async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = findMockOrder(req.params.id);
    if (!order) { res.status(404).json({ error: 'Order hittades inte' }); return; }
    res.json({
      success: true,
      message: `ETA-SMS skickat till ${order.customerName}`,
      estimatedArrival: new Date(Date.now() + (order.estimatedMinutes || 15) * 60000).toISOString(),
    });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/work-orders/${req.params.id}/auto-eta-sms`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (error: any) {
    console.error('Auto ETA SMS error:', error?.message);
    res.status(503).json({ error: 'Kunde inte skicka ETA-SMS.' });
  }
});

router.post('/distance', async (req, res) => {
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
  } catch (error: any) {
    console.error('[LIVE] Distance proxy error:', error.message);
    res.status(503).json({ error: 'Kunde inte beräkna avstånd. Försök igen.' });
  }
});

router.post('/distance/batch', async (req, res) => {
  const { pairs } = req.body;
  if (!Array.isArray(pairs)) {
    return res.status(400).json({ error: 'pairs array krävs' });
  }
  const results: Record<string, any> = {};
  for (const p of pairs) {
    const distKm = haversineDistance(p.fromLat, p.fromLng, p.toLat, p.toLng);
    results[p.id] = { distanceKm: Math.round(distKm * 10) / 10, durationMin: Math.max(1, Math.round(distKm * 1.4)), source: 'haversine' as const };
  }
  res.json({ results });
});

router.post('/disruptions/trigger/delay', async (req, res) => {
  const { workOrderId, workOrderTitle, resourceId, resourceName, estimatedDuration, actualDuration } = req.body;
  if (!workOrderId || !resourceId || estimatedDuration == null || actualDuration == null) {
    return res.status(400).json({ error: 'workOrderId, resourceId, estimatedDuration, actualDuration krävs' });
  }
  const ratio = actualDuration / estimatedDuration;
  if (ratio <= 1.5) {
    return res.json({ message: 'Förseningen understiger tröskelvärdet (50%)' });
  }
  if (IS_MOCK_MODE) {
    const event = {
      id: `disr-${Date.now()}`,
      tenantId: 'traivo-demo',
      type: 'significant_delay',
      severity: ratio > 2.5 ? 'critical' : ratio > 2 ? 'high' : 'medium',
      title: `Betydande försening: ${workOrderTitle || workOrderId}`,
      description: `${resourceName || resourceId} har arbetat ${actualDuration} min (beräknat ${estimatedDuration} min)`,
      timestamp: new Date().toISOString(),
      status: 'active',
      affectedResources: [resourceId],
      affectedOrders: [workOrderId],
      suggestions: [],
      decisionTrace: [],
    };
    MOCK_DISRUPTIONS.push(event);
    return res.json(event);
  }
  try {
    const { status, data } = await traivoFetch('/api/disruptions/trigger/delay', {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte trigga störning.' }); }
});

router.post('/disruptions/trigger/early-completion', async (req, res) => {
  const { resourceId, resourceName, slackMinutes } = req.body;
  if (!resourceId || slackMinutes == null) {
    return res.status(400).json({ error: 'resourceId, slackMinutes krävs' });
  }
  if (slackMinutes <= 45) {
    return res.json({ message: 'Ingen ledig tid (under 45 min).' });
  }
  if (IS_MOCK_MODE) {
    const event = {
      id: `disr-${Date.now()}`,
      tenantId: 'traivo-demo',
      type: 'early_completion',
      severity: 'low',
      title: `Tidigt klart: ${resourceName || resourceId}`,
      description: `${resourceName || resourceId} har ${slackMinutes} min kvar av arbetsdagen`,
      timestamp: new Date().toISOString(),
      status: 'active',
      affectedResources: [resourceId],
      affectedOrders: [],
      suggestions: [],
      decisionTrace: [],
    };
    MOCK_DISRUPTIONS.push(event);
    return res.json(event);
  }
  try {
    const { status, data } = await traivoFetch('/api/disruptions/trigger/early-completion', {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte trigga störning.' }); }
});

router.post('/disruptions/trigger/resource-unavailable', async (req, res) => {
  const { resourceId, resourceName, reason } = req.body;
  if (!resourceId || !reason) {
    return res.status(400).json({ error: 'resourceId, reason krävs' });
  }
  if (IS_MOCK_MODE) {
    const event = {
      id: `disr-${Date.now()}`,
      tenantId: 'traivo-demo',
      type: 'resource_unavailable',
      severity: 'high',
      title: `Resurs ej tillgänglig: ${resourceName || resourceId}`,
      description: `Orsak: ${reason}`,
      timestamp: new Date().toISOString(),
      status: 'active',
      affectedResources: [resourceId],
      affectedOrders: MOCK_ORDERS.filter(o => String(o.resourceId) === String(resourceId) && !['completed', 'utford', 'impossible', 'cancelled'].includes(o.status)).map(o => String(o.id)),
      suggestions: [],
      decisionTrace: [],
    };
    MOCK_DISRUPTIONS.push(event);
    return res.json(event);
  }
  try {
    const { status, data } = await traivoFetch('/api/disruptions/trigger/resource-unavailable', {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte trigga störning.' }); }
});

router.get('/break-config', async (req, res) => {
  if (IS_MOCK_MODE) {
    return res.json({
      enabled: true,
      durationMinutes: 30,
      earliestSeconds: 39600,
      latestSeconds: 46800,
    });
  }
  try {
    const { status, data } = await traivoFetch('/api/break-config', { headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte hämta rastkonfiguration.' }); }
});

router.get('/eta-notification/history', async (req, res) => {
  const { workOrderId, customerId } = req.query;
  if (IS_MOCK_MODE) {
    const notifications: any[] = [];
    for (const order of MOCK_ORDERS) {
      if (order.customerNotified) {
        if (workOrderId && String(order.id) !== String(workOrderId)) continue;
        notifications.push({
          id: `eta-${order.id}`,
          workOrderId: String(order.id),
          customerId: order.customer?.id || 'cust-1',
          channel: 'email',
          etaMinutes: 15,
          etaTime: order.enRouteAt || new Date().toISOString(),
          marginMinutes: 15,
          status: 'sent',
          errorMessage: null,
          createdAt: order.enRouteAt || new Date().toISOString(),
        });
      }
    }
    return res.json(notifications);
  }
  try {
    const qs = customerId ? `?customerId=${customerId}` : workOrderId ? `?workOrderId=${workOrderId}` : '';
    const { status, data } = await traivoFetch(`/api/eta-notification/history${qs}`, { headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte hämta notifieringshistorik.' }); }
});

router.get('/eta-notification/config', async (req, res) => {
  if (IS_MOCK_MODE) {
    return res.json({ enabled: true, marginMinutes: 15, channel: 'email', triggerOnEnRoute: true });
  }
  try {
    const { status, data } = await traivoFetch('/api/eta-notification/config', { headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte hämta konfiguration.' }); }
});

export { router as miscRouter };
