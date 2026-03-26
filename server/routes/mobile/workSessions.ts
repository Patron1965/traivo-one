import { Router } from 'express';
import { MOCK_RESOURCE, getMockWorkSession, getMockWorkSessionEntries, setMockWorkSession, setMockWorkSessionEntries } from './mockData';
import { IS_MOCK_MODE, traivoFetch, getAuthHeader } from './proxyHelper';

const router = Router();

router.post('/work-sessions/start', async (req, res) => {
  if (IS_MOCK_MODE) {
    const session = {
      id: 'ws-' + Date.now(),
      resourceId: MOCK_RESOURCE.id,
      teamId: req.body.teamId || null,
      status: 'active',
      startedAt: new Date().toISOString(),
      pausedAt: null,
      endedAt: null,
      notes: req.body.notes || '',
      totalWorkMinutes: 0,
      totalBreakMinutes: 0,
    };
    setMockWorkSession(session);
    setMockWorkSessionEntries([]);
    res.json({ success: true, session });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/work-sessions/start', { method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte starta arbetspass.' }); }
});

router.get('/work-sessions/active', async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json({ session: getMockWorkSession() });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/mobile/work-sessions/active', { method: 'GET', headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte hämta aktivt arbetspass.' }); }
});

router.post('/work-sessions/:id/stop', async (req, res) => {
  if (IS_MOCK_MODE) {
    const session = getMockWorkSession();
    if (session && session.id === req.params.id) {
      session.status = 'completed';
      session.endedAt = new Date().toISOString();
      setMockWorkSession(session);
    }
    res.json({ success: true, session: getMockWorkSession() });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/work-sessions/${req.params.id}/stop`, { method: 'POST', headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte avsluta arbetspass.' }); }
});

router.post('/work-sessions/:id/pause', async (req, res) => {
  if (IS_MOCK_MODE) {
    const session = getMockWorkSession();
    if (session && session.id === req.params.id) {
      session.status = 'paused';
      session.pausedAt = new Date().toISOString();
      setMockWorkSession(session);
    }
    res.json({ success: true, session: getMockWorkSession() });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/work-sessions/${req.params.id}/pause`, { method: 'POST', headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte pausa arbetspass.' }); }
});

router.post('/work-sessions/:id/resume', async (req, res) => {
  if (IS_MOCK_MODE) {
    const session = getMockWorkSession();
    if (session && session.id === req.params.id) {
      session.status = 'active';
      session.pausedAt = null;
      setMockWorkSession(session);
    }
    res.json({ success: true, session: getMockWorkSession() });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/work-sessions/${req.params.id}/resume`, { method: 'POST', headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte återuppta arbetspass.' }); }
});

router.post('/work-sessions/:id/entries', async (req, res) => {
  if (IS_MOCK_MODE) {
    const entry = { id: 'wse-' + Date.now(), sessionId: req.params.id, ...req.body, createdAt: new Date().toISOString() };
    const entries = getMockWorkSessionEntries();
    entries.push(entry);
    setMockWorkSessionEntries(entries);
    res.json({ success: true, entry });
    return;
  }
  try {
    const { status, data } = await traivoFetch(`/api/mobile/work-sessions/${req.params.id}/entries`, { method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte logga tidspost.' }); }
});

export { router as workSessionsRouter };
