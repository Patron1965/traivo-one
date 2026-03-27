import { Router, Request, Response } from 'express';
import { IS_MOCK_MODE } from './proxyHelper';

const router = Router();

interface UrgentJobRecord {
  id: string;
  orderId: string | number;
  resourceId: string | number;
  status: 'pending' | 'accepted' | 'declined' | 'en_route' | 'arrived' | 'in_progress' | 'completed' | 'reassigned' | 'issue_reported';
  declineReason?: string;
  acceptedAt?: string;
  declinedAt?: string;
  completedAt?: string;
  startNavigation?: boolean;
  createdAt: string;
}

const urgentJobStore = new Map<string, UrgentJobRecord>();

const MOCK_URGENT_JOB = {
  id: 'urgent-001',
  orderId: 9901,
  type: 'Containerbyte',
  address: 'Solnavägen 42, Solna',
  city: 'Solna',
  latitude: 59.3600,
  longitude: 18.0000,
  distance: '1.2 km',
  estimatedMinutes: 4,
  deadline: new Date(Date.now() + 3600000).toISOString(),
  deadlineLabel: 'om 1h',
  customerName: 'AB Bygg',
  customerPhone: '08-123 456',
  notes: 'Full container, arbete blockerat',
  assignedBy: 'Lisa P. (planerare)',
  assignedAt: new Date().toISOString(),
  priority: 'urgent' as const,
  articles: 'Container 6m³ → töm+byt',
};

router.post('/jobs/urgent/accept', (req: Request, res: Response) => {
  const { jobId, startNavigation } = req.body;
  if (!jobId) {
    return res.status(400).json({ success: false, error: 'jobId krävs' });
  }

  if (IS_MOCK_MODE) {
    const record: UrgentJobRecord = {
      id: jobId,
      orderId: MOCK_URGENT_JOB.orderId,
      resourceId: 101,
      status: 'accepted',
      acceptedAt: new Date().toISOString(),
      startNavigation: startNavigation ?? false,
      createdAt: new Date().toISOString(),
    };
    urgentJobStore.set(jobId, record);
    console.log(`[URGENT] Job ${jobId} accepted (mock), startNavigation=${startNavigation}`);
    return res.json({ success: true, status: 'accepted', jobId });
  }

  return res.json({ success: true, status: 'accepted', jobId });
});

router.post('/jobs/urgent/decline', (req: Request, res: Response) => {
  const { jobId, reason } = req.body;
  if (!jobId || !reason) {
    return res.status(400).json({ success: false, error: 'jobId och reason krävs' });
  }

  if (IS_MOCK_MODE) {
    const record: UrgentJobRecord = {
      id: jobId,
      orderId: MOCK_URGENT_JOB.orderId,
      resourceId: 101,
      status: 'declined',
      declineReason: reason,
      declinedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    urgentJobStore.set(jobId, record);
    console.log(`[URGENT] Job ${jobId} declined (mock), reason: ${reason}`);
    return res.json({ success: true, status: 'declined', jobId });
  }

  return res.json({ success: true, status: 'declined', jobId });
});

router.post('/jobs/urgent/:id/status', (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  const validStatuses = ['en_route', 'arrived', 'in_progress', 'completed', 'issue_reported'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: `Ogiltig status: ${status}` });
  }

  if (IS_MOCK_MODE) {
    const existing = urgentJobStore.get(id);
    if (existing) {
      existing.status = status;
      if (status === 'completed') existing.completedAt = new Date().toISOString();
    }
    console.log(`[URGENT] Job ${id} status → ${status} (mock)`);
    return res.json({ success: true, jobId: id, status });
  }

  return res.json({ success: true, jobId: id, status });
});

router.get('/jobs/urgent/active', (_req: Request, res: Response) => {
  if (IS_MOCK_MODE) {
    const active = Array.from(urgentJobStore.values()).find(
      j => !['completed', 'declined', 'reassigned'].includes(j.status)
    );
    return res.json({ success: true, activeJob: active || null });
  }

  return res.json({ success: true, activeJob: null });
});

router.post('/jobs/urgent/test-trigger', (_req: Request, res: Response) => {
  if (!IS_MOCK_MODE) {
    return res.status(403).json({ success: false, error: 'Endast i mock-läge' });
  }

  const io = (global as any).__socketIO;
  if (!io) {
    return res.status(500).json({ success: false, error: 'WebSocket ej initierad' });
  }

  const testJob = {
    ...MOCK_URGENT_JOB,
    id: `urgent-${Date.now()}`,
    assignedAt: new Date().toISOString(),
    deadline: new Date(Date.now() + 3600000).toISOString(),
  };

  io.to('resource:101').emit('job:urgent:assigned', { job: testJob });
  io.emit('job:urgent:assigned', { job: testJob });
  console.log(`[URGENT] Test trigger sent: ${testJob.id}`);

  return res.json({ success: true, job: testJob });
});

export { router as urgentJobsRouter };
