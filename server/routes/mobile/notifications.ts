import { Router } from 'express';
import crypto from 'crypto';
import { MOCK_NOTIFICATIONS_LEGACY, MOCK_NOTIFICATIONS } from './mockData';
import { IS_MOCK_MODE, traivoFetch, getAuthHeader } from './proxyHelper';

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
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('[LIVE] Notifications count proxy error:', msg);
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
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    console.error('Notifications fetch error:', msg);
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
  } catch (error: unknown) {
    res.status(503).json({ error: 'Kunde inte markera som läst.' });
  }
});

router.get('/notifications/unread-count', async (req, res) => {
  if (IS_MOCK_MODE) {
    const unreadCount = MOCK_NOTIFICATIONS.filter(n => !n.read).length;
    res.json({ success: true, unreadCount });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/notifications/unread-count', { headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: unknown) {
    res.status(503).json({ error: 'Kunde inte hamta antal olasta.' });
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
  } catch (error: unknown) {
    res.status(503).json({ error: 'Kunde inte markera alla som lästa.' });
  }
});

const wsTokens = new Map<string, { resourceId: string; createdAt: number }>();

router.post('/notifications/token', (req, res) => {
  const { resourceId } = req.body;
  if (!resourceId) {
    return res.status(400).json({ error: 'resourceId krävs' });
  }
  const token = crypto.randomUUID();
  wsTokens.set(token, { resourceId: String(resourceId), createdAt: Date.now() });
  setTimeout(() => wsTokens.delete(token), 60000);
  res.json({ token });
});

export { router as notificationsRouter, wsTokens };
