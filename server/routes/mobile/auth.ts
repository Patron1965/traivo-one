import { Router } from 'express';
import { MOCK_RESOURCE, MOCK_TOKEN, MOCK_PROFILES } from './mockData';
import { IS_MOCK_MODE, plannixFetch, getAuthHeader } from './proxyHelper';

const router = Router();

router.post('/login', async (req, res) => {
  if (IS_MOCK_MODE) {
    const { username, password, pin, email } = req.body;
    if (email && pin) {
      if (pin.length === 4 || pin.length === 6) {
        res.json({ success: true, token: MOCK_TOKEN, resource: MOCK_RESOURCE });
      } else {
        res.status(401).json({ success: false, error: 'Ogiltig PIN-kod' });
      }
    } else if (pin) {
      if (pin.length === 4 || pin.length === 6) {
        res.json({ success: true, token: MOCK_TOKEN, resource: MOCK_RESOURCE });
      } else {
        res.status(401).json({ success: false, error: 'Ogiltig PIN-kod' });
      }
    } else if (username && password) {
      res.json({ success: true, token: MOCK_TOKEN, resource: MOCK_RESOURCE });
    } else {
      res.status(401).json({ success: false, error: 'Ogiltiga inloggningsuppgifter' });
    }
    return;
  }

  try {
    const { status, data } = await plannixFetch('/api/mobile/login', {
      method: 'POST',
      body: JSON.stringify(req.body),
    });

    if (status === 200 && data.token) {
      const resource = data.resource || data.user || {};
      res.json({
        success: true,
        token: data.token,
        resource,
      });
    } else {
      res.status(status || 401).json({
        success: false,
        error: data.error || data.message || 'Inloggningen misslyckades',
      });
    }
  } catch (error: any) {
    console.error('[LIVE] Login proxy error:', error.message);
    res.status(503).json({
      success: false,
      error: 'Kunde inte nå inloggningsservern. Försök igen om en stund.',
    });
  }
});

router.post('/logout', async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json({ success: true });
    return;
  }

  try {
    const { status, data } = await plannixFetch('/api/mobile/logout', {
      method: 'POST',
      headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch (error: any) {
    console.error('[LIVE] Logout proxy error:', error.message);
    res.status(503).json({ success: false, error: 'Kunde inte nå servern vid utloggning.' });
  }
});

router.get('/me', async (req, res) => {
  if (IS_MOCK_MODE) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.includes(MOCK_TOKEN)) {
      res.json({ success: true, resource: MOCK_RESOURCE });
    } else {
      res.status(401).json({ success: false, error: 'Ej autentiserad' });
    }
    return;
  }

  try {
    const { status, data } = await plannixFetch('/api/mobile/me', {
      method: 'GET',
      headers: getAuthHeader(req),
    });

    if (status === 200) {
      if (data.success !== undefined) {
        res.json(data);
      } else {
        res.json({ success: true, resource: data });
      }
    } else {
      res.status(status).json({
        success: false,
        error: data.error || data.message || 'Ej autentiserad',
      });
    }
  } catch (error: any) {
    console.error('Me proxy error:', error.message);
    res.status(503).json({
      success: false,
      error: 'Kunde inte verifiera sessionen. Försök igen.',
    });
  }
});

router.patch('/me/notification-prefs', async (req, res) => {
  const body = req.body || {};
  const hasScheduleSend = typeof body.smsOnScheduleSend === 'boolean';
  const hasExtraJob = typeof body.smsOnExtraJob === 'boolean';

  if (!hasScheduleSend && !hasExtraJob) {
    res.status(400).json({
      success: false,
      error: 'Minst ett av smsOnScheduleSend eller smsOnExtraJob måste anges som boolean.',
    });
    return;
  }

  if (IS_MOCK_MODE) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.includes(MOCK_TOKEN)) {
      res.status(401).json({ success: false, error: 'Ej autentiserad' });
      return;
    }
    if (hasScheduleSend) MOCK_RESOURCE.smsOnScheduleSend = body.smsOnScheduleSend;
    if (hasExtraJob) MOCK_RESOURCE.smsOnExtraJob = body.smsOnExtraJob;
    res.json({
      smsOnScheduleSend: MOCK_RESOURCE.smsOnScheduleSend,
      smsOnExtraJob: MOCK_RESOURCE.smsOnExtraJob,
      lastSchedulePublishedAt: MOCK_RESOURCE.lastSchedulePublishedAt,
      lastSchedulePeriodStart: MOCK_RESOURCE.lastSchedulePeriodStart,
      lastSchedulePeriodEnd: MOCK_RESOURCE.lastSchedulePeriodEnd,
    });
    return;
  }

  try {
    const patchBody: Record<string, boolean> = {};
    if (hasScheduleSend) patchBody.smsOnScheduleSend = body.smsOnScheduleSend;
    if (hasExtraJob) patchBody.smsOnExtraJob = body.smsOnExtraJob;
    const { status, data } = await plannixFetch('/api/mobile/me/notification-prefs', {
      method: 'PATCH',
      headers: { ...getAuthHeader(req), 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    });
    res.status(status).json(data);
  } catch (error: any) {
    console.error('[LIVE] notification-prefs proxy error:', error.message);
    res.status(503).json({
      success: false,
      error: 'Kunde inte spara notisinställningar. Försök igen.',
    });
  }
});

router.get('/my-profiles', async (req, res) => {
  if (IS_MOCK_MODE) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.includes(MOCK_TOKEN)) {
      res.json({ success: true, assignments: MOCK_PROFILES });
    } else {
      res.status(401).json({ success: false, error: 'Ej autentiserad' });
    }
    return;
  }

  try {
    const meResponse = await plannixFetch('/api/mobile/me', {
      method: 'GET',
      headers: getAuthHeader(req),
    });
    const resourceId = meResponse.data?.resource?.id || meResponse.data?.id;
    if (!resourceId) {
      res.status(401).json({ success: false, error: 'Kunde inte identifiera resursen' });
      return;
    }

    const { status, data } = await plannixFetch(`/resource_profile_assignments?resourceId=${resourceId}`, {
      method: 'GET',
      headers: getAuthHeader(req),
    });

    if (status === 200) {
      const assignments = Array.isArray(data) ? data : (data.assignments || data.data || []);
      res.json({ success: true, assignments });
    } else {
      res.status(status).json({
        success: false,
        error: data.error || data.message || 'Kunde inte hämta profiler',
      });
    }
  } catch (error: any) {
    console.error('Profiles proxy error:', error.message);
    res.status(503).json({
      success: false,
      error: 'Kunde inte hämta profiler. Försök igen.',
    });
  }
});

export { router as authRouter };
