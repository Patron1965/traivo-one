import { Router, Request, Response } from 'express';
import { pool } from '../../db';
import {
  MOCK_RESOURCE, MOCK_ORDERS, MOCK_ARTICLES,
  MOCK_DISRUPTIONS, MOCK_CHANGE_REQUESTS, MOCK_MAX_LOGS,
  CHANGE_REQUEST_CATEGORIES, findMockOrder,
} from './mockData';
import {
  IS_MOCK_MODE, traivoFetch, getAuthHeader, haversineDistance,
} from './proxyHelper';

interface WeatherCurrent {
  temperature_2m: number;
  apparent_temperature: number;
  weather_code: number;
  wind_speed_10m: number;
  precipitation: number;
}

interface MockDeviation {
  id: string;
  createdAt: string;
  [key: string]: unknown;
}

interface MockOrder {
  id: number | string;
  orderNumber: string;
  customerName: string;
  address: string;
  deviations?: MockDeviation[];
  customerNotified?: boolean;
  enRouteAt?: string;
  customer?: { id: string };
  estimatedMinutes?: number;
  resourceId?: number | string;
  status: string;
  scheduledDate: string;
  sortOrder: number;
  estimatedDuration: number;
  latitude?: number;
  longitude?: number;
}

const router = Router();

router.get('/map-config', async (req: Request, res: Response) => {
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
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('[LIVE] Map-config proxy error:', msg);
    res.status(503).json({ error: 'Kunde inte hämta kartkonfiguration. Försök igen.' });
  }
});

router.get('/articles', (_req: Request, res: Response) => {
  const search = ((_req.query.search as string) || '').toLowerCase();
  if (search) {
    res.json(MOCK_ARTICLES.filter(a => a.name.toLowerCase().includes(search)));
  } else {
    res.json(MOCK_ARTICLES);
  }
});

router.get('/weather', async (_req: Request, res: Response) => {
  try {
    const response = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=59.1950&longitude=17.6260&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe/Stockholm&forecast_days=1'
    );
    const data = await response.json();
    const current: WeatherCurrent = data.current;

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
  } catch {
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

router.get('/summary', async (req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = (MOCK_ORDERS as MockOrder[]).filter(o => o.scheduledDate === today);
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
  } catch { /* fall through to orders-based summary */ }
  try {
    const { status: ordersStatus, data: ordersData } = await traivoFetch('/api/mobile/my-orders', {
      method: 'GET', headers: getAuthHeader(req),
    });
    if (ordersStatus === 200) {
      const rawOrders: MockOrder[] = Array.isArray(ordersData) ? ordersData : (ordersData.orders || []);
      const completed = rawOrders.filter(o => o.status === 'completed').length;
      const failed = rawOrders.filter(o => o.status === 'failed' || o.status === 'impossible').length;
      const cancelled = rawOrders.filter(o => o.status === 'cancelled').length;
      const remainingCount = rawOrders.length - completed - failed - cancelled;
      res.json({
        totalOrders: rawOrders.length,
        completedOrders: completed,
        remainingOrders: remainingCount,
        failedOrders: failed,
        totalDuration: rawOrders.reduce((sum, o) => sum + (o.estimatedDuration || 0), 0),
        estimatedTimeRemaining: rawOrders.filter(o => o.status !== 'completed' && o.status !== 'failed' && o.status !== 'cancelled')
          .reduce((sum, o) => sum + (o.estimatedDuration || 0), 0),
      });
    } else {
      res.json({ totalOrders: 0, completedOrders: 0, remainingOrders: 0, failedOrders: 0, totalDuration: 0, estimatedTimeRemaining: 0 });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('[LIVE] Summary proxy error:', msg);
    res.status(503).json({ error: 'Kunde inte hämta sammanfattning. Försök igen.' });
  }
});

router.post('/position', async (req: Request, res: Response) => {
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      console.error('[LIVE] Position proxy error:', msg);
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

router.post('/status', async (req: Request, res: Response) => {
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

router.post('/gps', async (req: Request, res: Response) => {
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

router.post('/push-token', async (req: Request, res: Response) => {
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('Push token registration error:', msg);
    res.status(500).json({ error: 'Kunde inte registrera push-token' });
  }
});

router.delete('/push-token', async (req: Request, res: Response) => {
  const mobileReq = req as Request & { mobileResourceId?: string };
  const driverId = IS_MOCK_MODE ? String(MOCK_RESOURCE.id) : String(req.body.driverId || req.query.driverId || MOCK_RESOURCE.id);
  try {
    await pool.query('DELETE FROM push_tokens WHERE driver_id = $1', [driverId]);
    res.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('Push token removal error:', msg);
    res.status(500).json({ error: 'Kunde inte ta bort push-token' });
  }
});

router.get('/route-feedback/mine', async (_req: Request, res: Response) => {
  const driverId = MOCK_RESOURCE.id;
  try {
    const result = await pool.query(
      `SELECT * FROM route_feedback WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [driverId]
    );
    res.json({ success: true, feedback: result.rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('Route feedback fetch error:', msg);
    res.json({ success: true, feedback: [] });
  }
});

router.post('/route-feedback', async (req: Request, res: Response) => {
  const driverId = MOCK_RESOURCE.id;
  const { rating, reasons, comment, date, optimizationJobId, actualMetrics } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Betyg (1-5) krävs' });
  }
  try {
    await pool.query(`
      ALTER TABLE route_feedback
        ADD COLUMN IF NOT EXISTS optimization_job_id VARCHAR(255),
        ADD COLUMN IF NOT EXISTS actual_distance_km DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS actual_duration_min DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS stops_completed INTEGER,
        ADD COLUMN IF NOT EXISTS stops_reordered INTEGER
    `).catch(() => {});
    const result = await pool.query(
      `INSERT INTO route_feedback (
        driver_id, rating, reasons, comment, feedback_date,
        optimization_job_id, actual_distance_km, actual_duration_min,
        stops_completed, stops_reordered, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *`,
      [
        driverId, rating, JSON.stringify(reasons || []), comment || '',
        date || new Date().toISOString().split('T')[0],
        optimizationJobId || null,
        actualMetrics?.actualDistanceKm || null,
        actualMetrics?.actualDurationMin || null,
        actualMetrics?.stopsCompleted || null,
        actualMetrics?.stopsReordered || null,
      ]
    );
    if (!IS_MOCK_MODE) {
      traivoFetch('/api/optimization/feedback', {
        method: 'POST',
        headers: getAuthHeader(req),
        body: JSON.stringify({ ...req.body, driverId }),
      }).catch(() => {});
    }
    res.json({ success: true, feedback: result.rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('Route feedback save error:', msg);
    res.status(500).json({ error: 'Kunde inte spara ruttbetyg' });
  }
});

router.get('/terminology', async (req: Request, res: Response) => {
  const terminology: Record<string, string> = {
    order: 'Order', work_order: 'Arbetsorder', deviation: 'Avvikelse',
    material: 'Material', inspection: 'Inspektion', checklist: 'Checklista',
    signature: 'Signatur', driver: 'Chaufför', technician: 'Tekniker',
    planner: 'Planerare', customer: 'Kund', object: 'Objekt',
    article: 'Artikel', route: 'Rutt', work_session: 'Arbetspass',
    check_in: 'Incheckning', check_out: 'Utcheckning', pause: 'Paus',
    status_not_started: 'Ej påbörjad', status_in_progress: 'Pågående',
    status_completed: 'Utförd', status_failed: 'Misslyckad',
    status_cancelled: 'Inställd', status_on_site: 'På plats',
    status_travel: 'Under resa', status_signed_off: 'Kvitterad',
    priority_low: 'Låg', priority_medium: 'Medium', priority_high: 'Hög',
    priority_urgent: 'Brådskande', photo_before: 'Före', photo_after: 'Efter',
    route_feedback: 'Ruttbetyg', notification: 'Notifiering', team: 'Team',
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
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'unknown';
      console.error('[LIVE] Terminology proxy error:', msg);
      return res.status(503).json({ error: 'Kunde inte hämta terminologi. Försök igen.' });
    }
  }
  res.json({ success: true, terminology });
});

router.get('/customer-change-requests/categories', async (_req: Request, res: Response) => {
  res.json({ success: true, categories: CHANGE_REQUEST_CATEGORIES });
});

router.get('/customer-change-requests/mine', async (req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    const mobileReq = req as Request & { mobileResourceId?: string };
    const resourceId = String(mobileReq.mobileResourceId || MOCK_RESOURCE.id);
    const mine = MOCK_CHANGE_REQUESTS.filter(r => r.reportedByResourceId === resourceId);
    res.json({ success: true, items: mine, total: mine.length });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/customer-change-requests/mine', {
      headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('Customer change requests mine error:', msg);
    res.status(503).json({ error: 'Kunde inte hämta kundrapporter.' });
  }
});

router.post('/customer-change-requests', async (req: Request, res: Response) => {
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
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('Customer change request create error:', msg);
    res.status(503).json({ error: 'Kunde inte skapa kundrapport.' });
  }
});

router.get('/deviations/mine', async (req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    const allDeviations: Array<MockDeviation & { orderNumber: string; customerName: string; address: string }> = [];
    for (const order of MOCK_ORDERS as MockOrder[]) {
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
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('My deviations error:', msg);
    res.status(503).json({ error: 'Kunde inte hämta avvikelser.' });
  }
});

router.post('/work-orders/carry-over', async (req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const incomplete = (MOCK_ORDERS as MockOrder[]).filter(o =>
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
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('Carry-over error:', msg);
    res.status(503).json({ error: 'Kunde inte flytta ordrar.' });
  }
});

router.post('/work-orders/:id/auto-eta-sms', async (req: Request, res: Response) => {
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
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('Auto ETA SMS error:', msg);
    res.status(503).json({ error: 'Kunde inte skicka ETA-SMS.' });
  }
});

interface DisruptionEvent {
  id: string;
  tenantId: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  timestamp: string;
  status: string;
  affectedResources: string[];
  affectedOrders: string[];
  suggestions: unknown[];
  decisionTrace: unknown[];
}

router.post('/disruptions/trigger/delay', async (req: Request, res: Response) => {
  const { workOrderId, workOrderTitle, resourceId, resourceName, estimatedDuration, actualDuration } = req.body;
  if (!workOrderId || !resourceId || estimatedDuration == null || actualDuration == null) {
    return res.status(400).json({ error: 'workOrderId, resourceId, estimatedDuration, actualDuration krävs' });
  }
  const ratio = actualDuration / estimatedDuration;
  if (ratio <= 1.5) {
    return res.json({ message: 'Förseningen understiger tröskelvärdet (50%)' });
  }
  if (IS_MOCK_MODE) {
    const event: DisruptionEvent = {
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

router.post('/disruptions/trigger/early-completion', async (req: Request, res: Response) => {
  const { resourceId, resourceName, slackMinutes } = req.body;
  if (!resourceId || slackMinutes == null) {
    return res.status(400).json({ error: 'resourceId, slackMinutes krävs' });
  }
  if (slackMinutes <= 45) {
    return res.json({ message: 'Ingen ledig tid (under 45 min).' });
  }
  if (IS_MOCK_MODE) {
    const event: DisruptionEvent = {
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

router.post('/disruptions/trigger/resource-unavailable', async (req: Request, res: Response) => {
  const { resourceId, resourceName, reason } = req.body;
  if (!resourceId || !reason) {
    return res.status(400).json({ error: 'resourceId, reason krävs' });
  }
  if (IS_MOCK_MODE) {
    const event: DisruptionEvent = {
      id: `disr-${Date.now()}`,
      tenantId: 'traivo-demo',
      type: 'resource_unavailable',
      severity: 'high',
      title: `Resurs ej tillgänglig: ${resourceName || resourceId}`,
      description: `Orsak: ${reason}`,
      timestamp: new Date().toISOString(),
      status: 'active',
      affectedResources: [resourceId],
      affectedOrders: (MOCK_ORDERS as MockOrder[]).filter(o => String(o.resourceId) === String(resourceId) && !['completed', 'utford', 'impossible', 'cancelled'].includes(o.status)).map(o => String(o.id)),
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

router.get('/break-config', async (req: Request, res: Response) => {
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

interface EtaNotification {
  id: string;
  workOrderId: string;
  customerId: string;
  channel: string;
  etaMinutes: number;
  etaTime: string;
  marginMinutes: number;
  status: string;
  errorMessage: null;
  createdAt: string;
}

router.get('/eta-notification/history', async (req: Request, res: Response) => {
  const { workOrderId, customerId } = req.query;
  if (IS_MOCK_MODE) {
    const notifications: EtaNotification[] = [];
    for (const order of MOCK_ORDERS as MockOrder[]) {
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

router.get('/eta-notification/config', async (req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    return res.json({ enabled: true, marginMinutes: 15, channel: 'email', triggerOnEnRoute: true });
  }
  try {
    const { status, data } = await traivoFetch('/api/eta-notification/config', { headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte hämta konfiguration.' }); }
});

const mockUserPreferences: Record<string, any> = {};

router.get('/user/preferences', async (req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    const driverId = String(MOCK_RESOURCE.id);
    res.json({
      success: true,
      preferences: mockUserPreferences[driverId] || {
        pushEnabled: true,
        darkMode: false,
        fontSize: 'medium',
        hapticFeedback: true,
        mapType: 'standard',
        showTraffic: true,
        autoNavigate: false,
        breakReminders: true,
        breakIntervalMinutes: 120,
      },
    });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/user/preferences', { headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte hamta preferenser.' }); }
});

router.patch('/user/preferences', async (req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    const driverId = String(MOCK_RESOURCE.id);
    if (!mockUserPreferences[driverId]) mockUserPreferences[driverId] = {};
    Object.assign(mockUserPreferences[driverId], req.body);
    res.json({ success: true, preferences: mockUserPreferences[driverId] });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/user/preferences', {
      method: 'PATCH', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte spara preferenser.' }); }
});

router.get('/app/config', async (req: Request, res: Response) => {
  res.json({
    success: true,
    config: {
      features: {
        hamburgerMenu: true,
        aiAssistant: true,
        teamFeature: true,
        offlineMode: true,
        darkMode: false,
        haptics: true,
      },
      navigation: {
        tabs: ['home', 'orders', 'map'],
        menuItems: ['ai', 'notifications', 'team', 'statistics', 'customerReports', 'deviations', 'routeFeedback', 'profile', 'settings'],
      },
    },
  });
});

router.get('/app/version-check', async (req: Request, res: Response) => {
  const currentVersion = (req.query.currentVersion as string) || '1.0.0';
  const latestVersion = '2.0.0';
  res.json({
    success: true,
    currentVersion,
    latestVersion,
    needsUpdate: currentVersion < latestVersion,
    forceUpdate: false,
    updateUrl: {
      ios: 'https://apps.apple.com/app/traivo-go',
      android: 'https://play.google.com/store/apps/details?id=com.traivo.go',
    },
  });
});

router.get('/statistics/summary', async (req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = (MOCK_ORDERS as MockOrder[]).filter(o => o.scheduledDate === today);
    const completed = todayOrders.filter(o => o.status === 'completed' || o.status === 'utford').length;
    const totalMinutes = todayOrders.reduce((sum, o) => sum + (o.estimatedDuration || 0), 0);

    let totalDistance = 0;
    const sorted = [...todayOrders].sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
        totalDistance += haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
      }
    }

    res.json({
      success: true,
      summary: {
        today: {
          completedOrders: completed,
          totalOrders: todayOrders.length,
          hoursWorked: Math.round(totalMinutes / 60 * 10) / 10,
          kilometers: Math.round(totalDistance),
        },
      },
    });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/statistics/summary', { headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte hamta statistik.' }); }
});

export { router as miscRouter };
