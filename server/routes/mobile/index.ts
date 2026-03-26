import { Router } from 'express';
import { IS_MOCK_MODE, TRAIVO_API_URL } from './proxyHelper';
import { MOCK_ORDERS } from './mockData';
import { authRouter } from './auth';
import { teamsRouter } from './teams';
import { ordersRouter } from './orders';
import { workSessionsRouter } from './workSessions';
import { miscRouter } from './misc';

const router = Router();

router.use((req, _res, next) => {
  const mode = IS_MOCK_MODE ? 'MOCK' : 'LIVE';
  console.log(`[${mode}] ${req.method} ${req.baseUrl}${req.path}`);
  next();
});

router.use((_req, res, next) => {
  if (IS_MOCK_MODE) {
    res.setHeader('X-Traivo-Mock', 'true');
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        body._mock = true;
      }
      return originalJson(body);
    };
  }
  next();
});

router.get('/server-mode', (_req, res) => {
  res.json({
    mode: IS_MOCK_MODE ? 'mock' : 'live',
    backendUrl: IS_MOCK_MODE ? null : TRAIVO_API_URL,
  });
});

router.use(authRouter);
router.use(teamsRouter);
router.use(ordersRouter);
router.use(workSessionsRouter);
router.use(miscRouter);

export { router as mobileRoutes, MOCK_ORDERS };
