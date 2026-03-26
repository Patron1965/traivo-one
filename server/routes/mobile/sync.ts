import { Router } from 'express';
import {
  IS_MOCK_MODE, traivoFetch, getAuthHeader,
} from './proxyHelper';

interface SyncAction {
  clientId: string;
  type: string;
  payload: Record<string, unknown>;
}

const router = Router();

router.post('/sync', async (req, res) => {
  if (IS_MOCK_MODE) {
    const { actions } = req.body;
    if (!Array.isArray(actions)) { res.status(400).json({ error: 'actions måste vara en array' }); return; }
    const results = actions.map((action: SyncAction) => ({ clientId: action.clientId, success: true, serverTimestamp: new Date().toISOString() }));
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

router.get('/sync/status', async (_req, res) => {
  res.json({ lastSync: new Date().toISOString(), pendingActions: 0 });
});

export { router as syncRouter };
