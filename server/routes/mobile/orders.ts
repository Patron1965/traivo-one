import { Router } from 'express';
import { pool, sendPushNotification } from '../../db';
import {
  MOCK_RESOURCE, MOCK_TOKEN, MOCK_TEAM, MOCK_ORDERS, MOCK_ARTICLES,
  MOCK_CHECKLIST_TEMPLATES, MOCK_MATERIAL_LOGS, MOCK_MAX_LOGS,
  findMockOrder,
} from './mockData';
import {
  IS_MOCK_MODE, plannixFetch, getAuthHeader, haversineDistance,
  transformPlannixOrder, handleTimeEntries,
} from './proxyHelper';

const router = Router();

router.get('/my-orders', async (req, res) => {
  if (IS_MOCK_MODE) {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const orders = MOCK_ORDERS.filter(o => o.scheduledDate === date);
    const teamMemberIds = MOCK_TEAM.status === 'active'
      ? MOCK_TEAM.members.map((m: any) => m.resourceId)
      : [];
    const tagged = orders.map(o => ({
      ...o,
      isTeamOrder: teamMemberIds.length > 1 && teamMemberIds.includes(o.resourceId),
      teamName: teamMemberIds.length > 1 && teamMemberIds.includes(o.resourceId) ? MOCK_TEAM.name : undefined,
    }));
    res.json(tagged);
    return;
  }

  try {
    const queryString = req.query.date ? `?date=${req.query.date}` : '';
    const { status, data } = await plannixFetch(`/api/mobile/my-orders${queryString}`, {
      method: 'GET',
      headers: getAuthHeader(req),
    });
    if (status === 200) {
      const rawOrders = Array.isArray(data) ? data : (data.orders || []);
      const transformed = rawOrders.map(transformPlannixOrder);
      res.json(transformed);
    } else {
      res.status(status).json(data);
    }
  } catch (error: any) {
    console.error('My-orders proxy error:', error.message);
    res.status(503).json({ error: 'Kunde inte hämta ordrar. Försök igen.' });
  }
});

router.get('/orders/:id', async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = findMockOrder(req.params.id);
    if (order) {
      res.json(order);
    } else {
      res.status(404).json({ error: 'Order hittades inte' });
    }
    return;
  }

  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${req.params.id}`, {
      method: 'GET',
      headers: getAuthHeader(req),
    });
    if (status === 200 && data) {
      res.json(transformPlannixOrder(data));
    } else {
      res.status(status).json(data);
    }
  } catch (error: any) {
    res.status(503).json({ error: 'Kunde inte hämta order. Försök igen.' });
  }
});

router.get('/orders/:id/checklist', async (req, res) => {
  if (IS_MOCK_MODE) {
    const idParam = req.params.id;
    const order = MOCK_ORDERS.find(o => o.id === parseInt(idParam) || o.orderNumber === idParam || o.id.toString() === idParam);
    if (!order) {
      res.status(404).json({ error: 'Order hittades inte' });
      return;
    }
    const articleTypes = [...new Set(order.articles.map((a: any) => a.category))] as string[];
    const objectTemplate = MOCK_CHECKLIST_TEMPLATES[order.objectType];
    const checklists = objectTemplate ? [objectTemplate] : [];
    res.json({ orderId: order.id.toString(), articleTypes, checklists });
    return;
  }

  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${req.params.id}/checklist`, {
      method: 'GET',
      headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch (error: any) {
    res.status(503).json({ error: 'Kunde inte hämta checklista. Försök igen.' });
  }
});

router.post('/quick-action', async (req, res) => {
  const { orderId, actionType } = req.body;
  const validActions = ['needs_part', 'customer_absent', 'takes_longer'];
  if (!orderId || !actionType || !validActions.includes(actionType)) {
    return res.status(400).json({ error: 'orderId och giltig actionType krävs (needs_part, customer_absent, takes_longer)' });
  }

  const actionLabels: Record<string, string> = {
    needs_part: 'Behöver reservdel',
    customer_absent: 'Kund ej hemma',
    takes_longer: 'Tar längre tid',
  };

  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find(o => o.id === parseInt(orderId) || o.orderNumber === orderId);
    if (!order) return res.status(404).json({ error: 'Order hittades inte' });

    const note = { text: actionLabels[actionType], timestamp: new Date().toISOString() };
    if (!order.metadata) order.metadata = { fieldNotes: [], materialNeeds: [] };
    order.metadata.fieldNotes = [...(order.metadata.fieldNotes || []), note];

    if (actionType === 'customer_absent') {
      order.status = 'deferred';
    } else if (actionType === 'takes_longer') {
      order.estimatedDuration = Math.round(order.estimatedDuration * 1.5);
    } else if (actionType === 'needs_part') {
      order.metadata.materialNeeds = [...(order.metadata.materialNeeds || []), 'Reservdel behövs'];
    }

    return res.json({
      success: true,
      actionType,
      actionLabel: actionLabels[actionType],
      order,
    });
  }

  try {
    const { status, data } = await plannixFetch('/api/mobile/quick-action', {
      method: 'POST',
      headers: getAuthHeader(req),
      body: JSON.stringify({ orderId, actionType }),
    });
    res.status(status).json(data);
  } catch (error: any) {
    res.status(503).json({ error: 'Kunde inte utföra snabbåtgärd' });
  }
});

router.post('/travel-times', async (req, res) => {
  const { latitude, longitude, destinations } = req.body;
  if (!latitude || !longitude || !Array.isArray(destinations) || destinations.length === 0) {
    return res.status(400).json({ error: 'latitude, longitude och destinations[] krävs' });
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Ogiltiga koordinater' });
  }

  const validDests = destinations
    .filter((d: any) => d.id && typeof d.lat === 'number' && typeof d.lng === 'number')
    .slice(0, 20);

  const GEOAPIFY_KEY = process.env.GEOAPIFY_API_KEY;
  if (GEOAPIFY_KEY && validDests.length > 0) {
    try {
      const results = await Promise.all(validDests.map(async (dest: any) => {
        try {
          const routeUrl = `https://api.geoapify.com/v1/routing?waypoints=${latitude},${longitude}|${dest.lat},${dest.lng}&mode=drive&traffic=approximated&apiKey=${GEOAPIFY_KEY}`;
          const resp = await fetch(routeUrl);
          if (resp.ok) {
            const data = await resp.json();
            const leg = data.features?.[0]?.properties;
            if (leg) {
              return {
                id: dest.id,
                distanceKm: Math.round((leg.distance / 1000) * 10) / 10,
                durationMinutes: Math.round(leg.time / 60),
              };
            }
          }
        } catch {}
        const R = 6371;
        const dLat = (dest.lat - latitude) * Math.PI / 180;
        const dLng = (dest.lng - longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(latitude * Math.PI / 180) * Math.cos(dest.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return { id: dest.id, distanceKm: Math.round(km * 10) / 10, durationMinutes: Math.round(km * 2) };
      }));
      return res.json({ results, source: 'geoapify' });
    } catch {}
  }

  const results = validDests.map((dest: any) => {
    const R = 6371;
    const dLat = (dest.lat - latitude) * Math.PI / 180;
    const dLng = (dest.lng - longitude) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(latitude * Math.PI / 180) * Math.cos(dest.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return { id: dest.id, distanceKm: Math.round(km * 10) / 10, durationMinutes: Math.round(km * 2) };
  });
  res.json({ results, source: 'haversine' });
});

router.patch('/orders/:id/status', async (req, res) => {
  const { status: newStatus } = req.body;
  const allowedStatuses = ['planned', 'dispatched', 'en_route', 'on_site', 'in_progress', 'completed', 'failed', 'cancelled', 'deferred', 'planerad_pre', 'planerad_resurs', 'planerad_las', 'paborjad', 'utford', 'fakturerad', 'impossible'];
  if (!newStatus || typeof newStatus !== 'string') {
    return res.status(400).json({ error: 'Status krävs' });
  }
  if (!allowedStatuses.includes(newStatus)) {
    return res.status(400).json({ error: `Ogiltig status: ${newStatus}` });
  }
  const io = (req.app as any).io;
  if (IS_MOCK_MODE) {
    const order = findMockOrder(req.params.id);
    if (order) {
      if (order.isLocked) {
        res.status(403).json({ error: 'Uppdraget är låst - beroende uppdrag ej slutförda' });
        return;
      }
      order.status = newStatus;
      if (newStatus === 'on_site' || newStatus === 'in_progress' || newStatus === 'paborjad' || newStatus === 'planerad_las' || newStatus === 'en_route') {
        order.actualStartTime = order.actualStartTime || new Date().toISOString();
      }
      if (newStatus === 'en_route') {
        (order as any).onWayAt = new Date().toISOString();
      }
      if (newStatus === 'in_progress' || newStatus === 'paborjad') {
        (order as any).onSiteAt = new Date().toISOString();
      }
      if (newStatus === 'completed' || newStatus === 'utford') {
        order.completedAt = new Date().toISOString();
        order.actualEndTime = new Date().toISOString();
        if (order.actualStartTime) {
          const startMs = new Date(order.actualStartTime).getTime();
          const endMs = new Date(order.completedAt).getTime();
          order.actualDuration = Math.round((endMs - startMs) / 60000);
        }
        if (req.body.actualDuration != null) {
          order.actualDuration = req.body.actualDuration;
        }
      }
      if (newStatus === 'dispatched' || newStatus === 'en_route') {
        order.enRouteAt = new Date().toISOString();
        order.customerNotified = true;
      }
      if (newStatus === 'failed' || newStatus === 'impossible') {
        order.actualEndTime = new Date().toISOString();
        if (req.body.impossibleReason) {
          order.impossibleReason = req.body.impossibleReason;
          order.impossibleAt = new Date().toISOString();
        }
      }
      if (newStatus === 'fakturerad') {
        order.completedAt = order.completedAt || new Date().toISOString();
      }
      const driverId = String(order.resourceId || MOCK_RESOURCE.id);
      try {
        await handleTimeEntries(String(order.id), driverId, newStatus);
      } catch (err: any) {
        console.error('[time-entries] Error in mock handleTimeEntries:', err.message);
      }
      if (io) {
        io.emit('order:updated', { orderId: order.id, status: order.status, updatedAt: new Date().toISOString() });
        if (MOCK_TEAM.status === 'active') {
          io.to(`team:${MOCK_TEAM.id}`).emit('team:order_updated', { orderId: order.id, status: order.status, updatedBy: MOCK_RESOURCE.name, updatedAt: new Date().toISOString() });
        }
      }
      const statusLabels: Record<string, string> = {
        skapad: 'Skapad', planerad_pre: 'Förplanerad', planerad_resurs: 'Tilldelad',
        planerad_las: 'Tilldelad', paborjad: 'Påbörjad', utford: 'Utförd', fakturerad: 'Fakturerad',
        impossible: 'Omöjlig', planned: 'Planerad', dispatched: 'Skickad',
        on_site: 'På plats', in_progress: 'Pågår', completed: 'Slutförd',
        failed: 'Misslyckad', cancelled: 'Avbruten', deferred: 'Uppskjuten',
      };
      const label = statusLabels[newStatus] || newStatus;
      if (order.resourceId) {
        sendPushNotification(
          String(order.resourceId),
          `Order ${order.orderNumber}`,
          `Status ändrad till: ${label}`,
          { orderId: String(order.id), orderNumber: order.orderNumber, status: newStatus }
        ).catch(() => {});
      }
      res.json(order);
    } else {
      res.status(404).json({ error: 'Order hittades inte' });
    }
    return;
  }

  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${req.params.id}/status`, {
      method: 'PATCH',
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body),
    });
    if (status === 200) {
      const driverId = String(MOCK_RESOURCE.id);
      handleTimeEntries(req.params.id, driverId, newStatus).catch(err => {
        console.error('[time-entries] Error in non-mock handleTimeEntries:', err.message);
      });
    }
    res.status(status).json(data);
  } catch (error: any) {
    res.status(503).json({ error: 'Kunde inte uppdatera status. Försök igen.' });
  }
});

router.get('/orders/:id/time-entries', async (req, res) => {
  const orderId = req.params.id;
  try {
    const result = await pool.query(
      `SELECT id, order_id, driver_id, status, started_at, ended_at, duration_seconds, created_at FROM time_entries WHERE order_id = $1 ORDER BY started_at ASC`,
      [orderId]
    );
    res.json(result.rows.map(row => ({
      id: row.id,
      orderId: row.order_id,
      driverId: row.driver_id,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: row.duration_seconds,
      createdAt: row.created_at,
    })));
  } catch (err: any) {
    console.error('Error fetching time entries:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta tidrapport' });
  }
});

router.get('/time-summary', async (req, res) => {
  const driverId = String(MOCK_RESOURCE.id);
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 86400000);
  try {
    const result = await pool.query(
      `SELECT status, started_at, ended_at, duration_seconds FROM time_entries WHERE driver_id = $1 AND started_at >= $2 AND started_at < $3 ORDER BY started_at ASC`,
      [driverId, startOfDay, endOfDay]
    );
    let travelSeconds = 0;
    let onSiteSeconds = 0;
    let workingSeconds = 0;
    const now = new Date();
    for (const row of result.rows) {
      const duration = row.duration_seconds != null
        ? row.duration_seconds
        : Math.floor((now.getTime() - new Date(row.started_at).getTime()) / 1000);
      if (row.status === 'travel') travelSeconds += duration;
      else if (row.status === 'on_site') onSiteSeconds += duration;
      else if (row.status === 'working') workingSeconds += duration;
    }
    const totalSeconds = travelSeconds + onSiteSeconds + workingSeconds;
    res.json({
      totalSeconds,
      travelSeconds,
      onSiteSeconds,
      workingSeconds,
      entries: result.rows.length,
    });
  } catch (err: any) {
    console.error('Error fetching time summary:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta tidssammanfattning' });
  }
});

router.get('/statistics', async (req, res) => {
  const driverId = String(MOCK_RESOURCE.id);
  const period = (req.query.period as string) || 'week';
  const offset = parseInt(req.query.offset as string) || 0;

  const now = new Date();
  let periodStart: Date;
  let periodEnd: Date;
  let prevStart: Date;
  let prevEnd: Date;
  let days: number;

  if (period === 'month') {
    const y = now.getFullYear();
    const m = now.getMonth() - offset;
    periodStart = new Date(y, m, 1);
    periodEnd = new Date(y, m + 1, 1);
    prevStart = new Date(y, m - 1, 1);
    prevEnd = new Date(y, m, 1);
    days = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / 86400000);
  } else {
    const dayOfWeek = now.getDay() || 7;
    const mondayThis = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1);
    periodStart = new Date(mondayThis.getTime() - offset * 7 * 86400000);
    periodEnd = new Date(periodStart.getTime() + 7 * 86400000);
    prevStart = new Date(periodStart.getTime() - 7 * 86400000);
    prevEnd = new Date(periodStart.getTime());
    days = 7;
  }

  try {
    const [currentEntries, prevEntries] = await Promise.all([
      pool.query(
        `SELECT order_id, status, started_at, ended_at, duration_seconds FROM time_entries WHERE driver_id = $1 AND started_at >= $2 AND started_at < $3 ORDER BY started_at ASC`,
        [driverId, periodStart, periodEnd]
      ),
      pool.query(
        `SELECT order_id, status, started_at, ended_at, duration_seconds FROM time_entries WHERE driver_id = $1 AND started_at >= $2 AND started_at < $3 ORDER BY started_at ASC`,
        [driverId, prevStart, prevEnd]
      ),
    ]);

    function aggregateEntries(rows: any[]) {
      let travel = 0, onSite = 0, working = 0;
      const orderIds = new Set<string>();
      const n = new Date();
      for (const r of rows) {
        const dur = r.duration_seconds != null ? r.duration_seconds : Math.floor((n.getTime() - new Date(r.started_at).getTime()) / 1000);
        if (r.status === 'travel') travel += dur;
        else if (r.status === 'on_site') onSite += dur;
        else if (r.status === 'working') working += dur;
        orderIds.add(r.order_id);
      }
      return { travel, onSite, working, total: travel + onSite + working, orderIds };
    }

    const current = aggregateEntries(currentEntries.rows);
    const previous = aggregateEntries(prevEntries.rows);

    const dailyBreakdown: any[] = [];
    for (let d = 0; d < days; d++) {
      const dayStart = new Date(periodStart.getTime() + d * 86400000);
      const dayEnd = new Date(dayStart.getTime() + 86400000);
      let travel = 0, onSite = 0, working = 0;
      for (const r of currentEntries.rows) {
        const start = new Date(r.started_at);
        if (start >= dayStart && start < dayEnd) {
          const dur = r.duration_seconds != null ? r.duration_seconds : Math.floor((new Date().getTime() - start.getTime()) / 1000);
          if (r.status === 'travel') travel += dur;
          else if (r.status === 'on_site') onSite += dur;
          else if (r.status === 'working') working += dur;
        }
      }
      dailyBreakdown.push({
        date: dayStart.toISOString().split('T')[0],
        dayLabel: ['Sön', 'Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör'][dayStart.getDay()],
        travel: Math.round(travel / 60),
        onSite: Math.round(onSite / 60),
        working: Math.round(working / 60),
      });
    }

    const periodOrders = MOCK_ORDERS;
    const completedOrders = periodOrders.filter(o => o.completedAt && new Date(o.completedAt) >= periodStart && new Date(o.completedAt) < periodEnd);
    const prevCompletedOrders = MOCK_ORDERS.filter(o => o.completedAt && new Date(o.completedAt) >= prevStart && new Date(o.completedAt) < prevEnd);
    const ordersWithDeviations = periodOrders.filter(o => o.deviations && o.deviations.length > 0);
    const prevOrdersWithDeviations = MOCK_ORDERS.filter(o => o.deviations && o.deviations.length > 0);
    const ordersWithSignoff = periodOrders.filter(o => (o as any).customerSignOff);
    const prevOrdersWithSignoff = MOCK_ORDERS.filter(o => (o as any).customerSignOff);
    const totalOrders = periodOrders.length;

    const uniqueOrdersCurrent = current.orderIds.size || completedOrders.length;
    const avgTimePerOrder = uniqueOrdersCurrent > 0 ? Math.round(current.total / uniqueOrdersCurrent / 60) : 0;
    const avgTravelTime = uniqueOrdersCurrent > 0 ? Math.round(current.travel / uniqueOrdersCurrent / 60) : 0;
    const avgOnSiteTime = uniqueOrdersCurrent > 0 ? Math.round(current.onSite / uniqueOrdersCurrent / 60) : 0;

    const uniqueOrdersPrev = previous.orderIds.size || prevCompletedOrders.length || 1;
    const prevAvgTimePerOrder = uniqueOrdersPrev > 0 ? Math.round(previous.total / uniqueOrdersPrev / 60) : 0;
    const prevAvgTravelTime = uniqueOrdersPrev > 0 ? Math.round(previous.travel / uniqueOrdersPrev / 60) : 0;

    function trendPercent(curr: number, prev: number): number {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    }

    const monthNames = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
    let periodLabel: string;
    if (period === 'month') {
      periodLabel = `${monthNames[periodStart.getMonth()]} ${periodStart.getFullYear()}`;
    } else {
      const weekNum = Math.ceil(((periodStart.getTime() - new Date(periodStart.getFullYear(), 0, 1).getTime()) / 86400000 + 1) / 7);
      periodLabel = offset === 0 ? 'Denna vecka' : `Vecka ${weekNum}`;
    }

    res.json({
      period,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      periodLabel,
      dailyBreakdown,
      currentPeriod: {
        completedOrders: completedOrders.length,
        totalOrders,
        ordersWithDeviations: ordersWithDeviations.length,
        ordersWithSignoff: ordersWithSignoff.length,
        avgTimePerOrder,
        avgTravelTime,
        avgOnSiteTime,
      },
      previousPeriod: {
        completedOrders: prevCompletedOrders.length,
        avgTimePerOrder: prevAvgTimePerOrder,
        avgTravelTime: prevAvgTravelTime,
      },
      trends: {
        orders: trendPercent(completedOrders.length, prevCompletedOrders.length),
        avgTimePerOrder: trendPercent(avgTimePerOrder, prevAvgTimePerOrder),
        avgTravelTime: trendPercent(avgTravelTime, prevAvgTravelTime),
        deviations: trendPercent(ordersWithDeviations.length, prevOrdersWithDeviations.length),
        signoffs: trendPercent(ordersWithSignoff.length, prevOrdersWithSignoff.length),
      },
    });
  } catch (err: any) {
    console.error('Error fetching statistics:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta statistik' });
  }
});

router.post('/orders/:id/deviations', async (req, res) => {
  if (IS_MOCK_MODE) {
    const orderId = parseInt(req.params.id);
    const deviation = { id: Date.now(), orderId, ...req.body, createdAt: new Date().toISOString() };
    const order = MOCK_ORDERS.find(o => o.id === orderId);
    if (order) order.deviations.push(deviation);
    res.json(deviation);
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${req.params.id}/deviations`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (error: any) { console.error('Deviation proxy error:', error?.message); res.status(503).json({ error: 'Kunde inte rapportera avvikelse.' }); }
});

router.get('/orders/:id/materials', async (req, res) => {
  if (IS_MOCK_MODE) {
    const orderId = parseInt(req.params.id);
    const logs = MOCK_MATERIAL_LOGS.filter(m => m.orderId === orderId);
    res.json(logs);
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${req.params.id}/materials`, {
      method: 'GET', headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte hämta material.' }); }
});

router.post('/orders/:id/materials', async (req, res) => {
  if (IS_MOCK_MODE) {
    const io = (req.app as any).io;
    const entry = {
      id: Date.now(),
      orderId: parseInt(req.params.id),
      ...req.body,
      registeredBy: MOCK_RESOURCE.name,
      registeredByResourceId: MOCK_RESOURCE.id,
      createdAt: new Date().toISOString(),
    };
    MOCK_MATERIAL_LOGS.push(entry);
    if (MOCK_MATERIAL_LOGS.length > MOCK_MAX_LOGS) MOCK_MATERIAL_LOGS.splice(0, MOCK_MATERIAL_LOGS.length - MOCK_MAX_LOGS);
    if (io && MOCK_TEAM.status === 'active') {
      io.to(`team:${MOCK_TEAM.id}`).emit('team:material_logged', { orderId: entry.orderId, entry });
    }
    res.json(entry);
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${req.params.id}/materials`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (error: any) { console.error('Material proxy error:', error?.message); res.status(503).json({ error: 'Kunde inte logga material.' }); }
});

router.post('/orders/:id/signature', async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = findMockOrder(req.params.id);
    if (order) { order.signatureUrl = req.body.signatureData; res.json({ success: true }); }
    else res.status(404).json({ error: 'Order hittades inte' });
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${req.params.id}/signature`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (error: any) { console.error('Signature proxy error:', error?.message); res.status(503).json({ error: 'Kunde inte spara signatur.' }); }
});

router.post('/orders/:id/notes', async (req, res) => {
  if (IS_MOCK_MODE) {
    const orderId = parseInt(req.params.id);
    const order = MOCK_ORDERS.find(o => o.id === orderId);
    if (order) {
      const note = { id: Date.now(), orderId, text: req.body.text, createdBy: 'Chaufför', createdAt: new Date().toISOString() };
      if (!order.orderNotes) order.orderNotes = [];
      order.orderNotes.push(note);
      res.json(note);
    } else res.status(404).json({ error: 'Order hittades inte' });
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${req.params.id}/notes`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte spara anteckning.' }); }
});

router.patch('/orders/:id/substeps/:stepId', async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = findMockOrder(req.params.id);
    if (order && order.subSteps) {
      const step = order.subSteps.find((s: any) => s.id === parseInt(req.params.stepId));
      if (step) { step.completed = req.body.completed; res.json(step); }
      else res.status(404).json({ error: 'Delsteg hittades inte' });
    } else res.status(404).json({ error: 'Order hittades inte' });
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${req.params.id}/substeps/${req.params.stepId}`, {
      method: 'PATCH', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte uppdatera delsteg.' }); }
});

router.post('/orders/:id/inspections', async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = findMockOrder(req.params.id);
    if (order) { order.inspections = req.body.inspections; res.json({ success: true, inspections: order.inspections }); }
    else res.status(404).json({ error: 'Order hittades inte' });
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${req.params.id}/inspections`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte spara inspektion.' }); }
});

router.post('/inspections/:orderId/photos', async (req, res) => {
  const { orderId } = req.params;
  const { photos } = req.body;

  if (!photos || !Array.isArray(photos) || photos.length === 0) {
    res.status(400).json({ error: 'Inga foton att ladda upp' });
    return;
  }

  const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
  const driverId = IS_MOCK_MODE ? String(MOCK_RESOURCE.id) : String((req as any).driverId || MOCK_RESOURCE.id);

  try {
    const results: { category: string; photoSlot: string; id: number }[] = [];
    const errors: { category: string; photoSlot: string; error: string }[] = [];

    for (const photo of photos) {
      const { category, photoSlot, base64Data } = photo;
      if (!category || !photoSlot || !base64Data) {
        errors.push({ category: category || 'okänd', photoSlot: photoSlot || 'okänd', error: 'Saknar obligatoriska fält' });
        continue;
      }

      const dataSize = Buffer.byteLength(base64Data, 'utf8');
      if (dataSize > MAX_PHOTO_SIZE) {
        errors.push({ category, photoSlot, error: `Bilden är för stor (${(dataSize / 1024 / 1024).toFixed(1)} MB, max 5 MB)` });
        continue;
      }

      const result = await pool.query(
        `INSERT INTO inspection_photos (order_id, driver_id, category, photo_slot, base64_data)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [orderId, driverId, category, photoSlot, base64Data]
      );
      results.push({ category, photoSlot, id: result.rows[0].id });
    }

    if (errors.length > 0 && results.length === 0) {
      res.status(400).json({ success: false, errors });
      return;
    }

    res.json({ success: true, uploaded: results, errors });
  } catch (err: any) {
    console.error('Inspection photo upload error:', err.message);
    res.status(500).json({ error: 'Kunde inte spara inspektionsfoton' });
  }
});

router.get('/inspections/:orderId/photos', async (req, res) => {
  const { orderId } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, category, photo_slot, base64_data, created_at
       FROM inspection_photos WHERE order_id = $1 ORDER BY created_at`,
      [orderId]
    );
    res.json({ success: true, photos: result.rows.map(r => ({
      id: r.id,
      category: r.category,
      photoSlot: r.photo_slot,
      base64Data: r.base64_data,
      createdAt: r.created_at,
    }))});
  } catch (err: any) {
    console.error('Fetch inspection photos error:', err.message);
    res.status(500).json({ error: 'Kunde inte hämta inspektionsfoton' });
  }
});

router.post('/orders/:id/upload-photo', async (req, res) => {
  if (IS_MOCK_MODE) {
    const orderId = parseInt(req.params.id);
    const order = MOCK_ORDERS.find(o => o.id === orderId);
    if (!order) { res.status(404).json({ error: 'Order hittades inte' }); return; }
    const photoId = `photo-${Date.now()}`;
    res.json({ success: true, photoId, presignedUrl: `/api/mobile/photos/${photoId}/upload`, confirmUrl: `/api/mobile/orders/${orderId}/confirm-photo` });
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${req.params.id}/upload-photo`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte hämta uppladdnings-URL.' }); }
});

router.post('/orders/:id/confirm-photo', async (req, res) => {
  if (IS_MOCK_MODE) {
    const order = findMockOrder(req.params.id);
    if (order) { const photoUrl = `/photos/${req.body.photoId}.jpg`; order.photos.push(photoUrl); res.json({ success: true, photoUrl }); }
    else res.status(404).json({ error: 'Order hittades inte' });
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${req.params.id}/confirm-photo`, {
      method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch { res.status(503).json({ error: 'Kunde inte bekräfta foto.' }); }
});

router.post('/orders/:id/customer-signoff', async (req, res) => {
  const { id } = req.params;
  const { customerName, signatureData, signedAt } = req.body;

  if (!customerName || !signatureData) {
    return res.status(400).json({ error: 'customerName och signatureData krävs' });
  }

  if (IS_MOCK_MODE) {
    const order = MOCK_ORDERS.find(o => String(o.id) === String(id));
    if (!order) {
      return res.status(404).json({ error: 'Order hittades inte' });
    }
    order.customerSignOff = {
      customerName,
      signatureData,
      signedAt: signedAt || new Date().toISOString(),
    };
    return res.json({ success: true, signOff: order.customerSignOff });
  }

  try {
    const { status, data } = await plannixFetch(`/api/mobile/orders/${id}/customer-signoff`, {
      method: 'POST',
      headers: getAuthHeader(req),
      body: JSON.stringify({ customerName, signatureData, signedAt }),
    });
    res.status(status).json(data);
  } catch (error: any) {
    console.error('[customer-signoff] Upstream error:', error.message);
    return res.status(503).json({
      error: 'Kunde inte spara kundkvittering. Försök igen.',
    });
  }
});

export { router as ordersRouter };
