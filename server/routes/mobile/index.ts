import { Router } from 'express';
import { IS_MOCK_MODE, PLANNIX_API_URL } from './proxyHelper';
import { MOCK_ORDERS } from './mockData';
import { authRouter } from './auth';
import { teamsRouter } from './teams';
import { ordersRouter } from './orders';
import { workSessionsRouter } from './workSessions';
import { notificationsRouter } from './notifications';
import { syncRouter } from './sync';
import { routingRouter } from './routing';
import { miscRouter } from './misc';
import { urgentJobsRouter } from './urgentJobs';

const router = Router();

router.use((req, _res, next) => {
  const mode = IS_MOCK_MODE ? 'MOCK' : 'LIVE';
  console.log(`[${mode}] ${req.method} ${req.baseUrl}${req.path}`);
  next();
});

router.use((_req, res, next) => {
  if (IS_MOCK_MODE) {
    res.setHeader('X-Plannix-Mock', 'true');
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        (body as Record<string, unknown>)._mock = true;
      }
      return originalJson(body);
    };
  }
  next();
});

router.get('/server-mode', (_req, res) => {
  res.json({
    mode: IS_MOCK_MODE ? 'mock' : 'live',
    backendUrl: IS_MOCK_MODE ? null : PLANNIX_API_URL,
  });
});

router.use(authRouter);
router.use(teamsRouter);
router.use(ordersRouter);
router.use(workSessionsRouter);
router.use(notificationsRouter);
router.use(syncRouter);
router.use(routingRouter);
router.use(miscRouter);
router.use(urgentJobsRouter);

export { router as mobileRoutes, MOCK_ORDERS };
