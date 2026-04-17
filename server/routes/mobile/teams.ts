import { Router } from 'express';
import { MOCK_RESOURCE, MOCK_TOKEN, MOCK_TEAM, MOCK_RESOURCES, MOCK_TEAM_INVITES, MOCK_ORDERS } from './mockData';
import { IS_MOCK_MODE, plannixFetch, getAuthHeader } from './proxyHelper';

const router = Router();

router.get('/my-team', async (req, res) => {
  if (IS_MOCK_MODE) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.includes(MOCK_TOKEN)) {
      res.json({ success: true, team: MOCK_TEAM });
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

    const { status, data } = await plannixFetch(`/api/teams?memberId=${resourceId}&status=active`, {
      method: 'GET',
      headers: getAuthHeader(req),
    });

    if (status === 200) {
      const teams = Array.isArray(data) ? data : (data.teams || data.data || []);
      const activeTeam = teams.find((t: any) => t.status === 'active') || teams[0] || null;
      res.json({ success: true, team: activeTeam });
    } else {
      res.json({ success: true, team: null });
    }
  } catch (error: any) {
    console.error('Team proxy error:', error.message);
    res.status(503).json({
      success: false,
      error: 'Kunde inte hämta teaminfo. Försök igen.',
    });
  }
});

router.post('/teams', async (req, res) => {
  if (IS_MOCK_MODE) {
    const { name, description, color, memberId } = req.body;
    if (!name) { res.status(400).json({ error: 'Teamnamn krävs' }); return; }
    const partner = MOCK_RESOURCES.find(r => r.id === memberId);
    MOCK_TEAM.id = 'team-' + Date.now();
    MOCK_TEAM.name = name;
    MOCK_TEAM.description = description || '';
    MOCK_TEAM.color = color || '#4A9B9B';
    MOCK_TEAM.status = 'active';
    MOCK_TEAM.leaderId = MOCK_RESOURCE.id;
    MOCK_TEAM.members = [
      { id: 'tm-1', resourceId: MOCK_RESOURCE.id, name: MOCK_RESOURCE.name, role: 'leader', phone: MOCK_RESOURCE.phone, email: MOCK_RESOURCE.email, isOnline: true },
    ];
    if (partner) {
      MOCK_TEAM.members.push({ id: 'tm-' + partner.id, resourceId: partner.id, name: partner.name, role: 'member', phone: partner.phone, email: partner.email, isOnline: false });
    }
    res.json({ success: true, team: MOCK_TEAM });
    return;
  }
  try {
    const { status, data } = await plannixFetch('/api/teams', { method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte skapa team.' }); }
});

router.post('/teams/:id/invite', async (req, res) => {
  if (IS_MOCK_MODE) {
    const { resourceId } = req.body;
    const resource = MOCK_RESOURCES.find(r => r.id === resourceId);
    if (!resource) { res.status(404).json({ error: 'Resurs hittades inte' }); return; }
    const invite = { id: 'inv-' + Date.now(), teamId: req.params.id, resourceId, resourceName: resource.name, status: 'pending', createdAt: new Date().toISOString() };
    MOCK_TEAM_INVITES.push(invite);
    const io = (req.app as any).io;
    if (io) { io.to(`resource:${resourceId}`).emit('team:invite', { invite, teamName: MOCK_TEAM.name }); }
    res.json({ success: true, invite });
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/teams/${req.params.id}/invite`, { method: 'POST', headers: getAuthHeader(req), body: JSON.stringify(req.body) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte skicka inbjudan.' }); }
});

router.post('/teams/:id/accept', async (req, res) => {
  if (IS_MOCK_MODE) {
    const invite = MOCK_TEAM_INVITES.find(i => i.teamId === req.params.id && i.status === 'pending');
    if (invite) {
      invite.status = 'accepted';
      const resource = MOCK_RESOURCES.find(r => r.id === invite.resourceId);
      if (resource && !MOCK_TEAM.members.find((m: any) => m.resourceId === resource.id)) {
        MOCK_TEAM.members.push({ id: 'tm-' + resource.id, resourceId: resource.id, name: resource.name, role: 'member', phone: resource.phone, email: resource.email, isOnline: false });
      }
    }
    res.json({ success: true, team: MOCK_TEAM });
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/teams/${req.params.id}/accept`, { method: 'POST', headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte acceptera inbjudan.' }); }
});

router.post('/teams/:id/leave', async (req, res) => {
  if (IS_MOCK_MODE) {
    MOCK_TEAM.members = MOCK_TEAM.members.filter((m: any) => m.resourceId !== MOCK_RESOURCE.id);
    if (MOCK_TEAM.members.length === 0) { MOCK_TEAM.status = 'inactive'; }
    const io = (req.app as any).io;
    if (io) { io.to(`team:${req.params.id}`).emit('team:member_left', { resourceId: MOCK_RESOURCE.id, name: MOCK_RESOURCE.name }); }
    res.json({ success: true });
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/teams/${req.params.id}/leave`, { method: 'POST', headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte lämna teamet.' }); }
});

router.delete('/teams/:id', async (req, res) => {
  if (IS_MOCK_MODE) {
    MOCK_TEAM.status = 'inactive';
    MOCK_TEAM.members = [];
    res.json({ success: true });
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/teams/${req.params.id}`, { method: 'DELETE', headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte ta bort teamet.' }); }
});

router.get('/resources/search', async (req, res) => {
  if (IS_MOCK_MODE) {
    const q = ((req.query.q as string) || '').toLowerCase();
    const results = MOCK_RESOURCES.filter(r => r.id !== MOCK_RESOURCE.id && r.name.toLowerCase().includes(q));
    res.json(results);
    return;
  }
  try {
    const { status, data } = await plannixFetch(`/api/resources/search?q=${encodeURIComponent(req.query.q as string || '')}`, { method: 'GET', headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte söka resurser.' }); }
});

router.get('/team-invites', async (req, res) => {
  if (IS_MOCK_MODE) {
    const pending = MOCK_TEAM_INVITES.filter(i => i.resourceId === MOCK_RESOURCE.id && i.status === 'pending');
    res.json(pending);
    return;
  }
  try {
    const { status, data } = await plannixFetch('/api/mobile/team-invites', { method: 'GET', headers: getAuthHeader(req) });
    res.status(status).json(data);
  } catch (error: any) { res.status(503).json({ error: 'Kunde inte hämta inbjudningar.' }); }
});

router.get('/team-orders', async (req, res) => {
  if (IS_MOCK_MODE) {
    if (MOCK_TEAM.status !== 'active' || MOCK_TEAM.members.length === 0) {
      res.json([]);
      return;
    }
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const teamMemberIds = MOCK_TEAM.members.map((m: any) => m.resourceId);
    const orders = MOCK_ORDERS.filter(o => o.scheduledDate === date && teamMemberIds.includes(o.resourceId));
    const assigneeLookup: Record<string, string> = {};
    MOCK_TEAM.members.forEach((m: any) => { assigneeLookup[String(m.resourceId)] = m.name; });
    const tagged = orders.map(o => ({
      ...o,
      isTeamOrder: true,
      teamName: MOCK_TEAM.name,
      assigneeName: assigneeLookup[String(o.resourceId)] || 'Okänd',
    }));
    res.json(tagged);
    return;
  }
  try {
    const queryString = req.query.date ? `?date=${req.query.date}` : '';
    const { status, data } = await plannixFetch(`/api/mobile/team-orders${queryString}`, {
      method: 'GET',
      headers: getAuthHeader(req),
    });
    res.status(status).json(data);
  } catch (error: any) {
    res.status(503).json({ error: 'Kunde inte hämta teamordrar.' });
  }
});

export { router as teamsRouter };
