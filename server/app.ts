import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { mobileRoutes } from './routes/mobile';
import { aiRoutes } from './routes/ai';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/api/mobile', mobileRoutes);
app.use('/api/mobile/ai', aiRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'driver-core-api' });
});

const projectRoot = path.resolve(__dirname, '..');
const templatesDir = path.join(projectRoot, 'server', 'templates');

function getHostUri(req: express.Request): string {
  return (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000') as string;
}

const EXPO_DEV_PORT = 8081;

const expoProxy = createProxyMiddleware({
  target: `http://127.0.0.1:${EXPO_DEV_PORT}`,
  changeOrigin: true,
  ws: true,
  on: {
    proxyRes: (proxyRes, _req, _res) => {
      proxyRes.headers['access-control-allow-origin'] = '*';
    },
    error: (err, _req, res) => {
      console.error('Proxy error:', err.message);
      if ('writeHead' in res && typeof (res as any).writeHead === 'function') {
        (res as any).status?.(502).json?.({ error: 'Expo dev server not available' });
      }
    },
  },
});

app.get('/api/qrcode', async (req, res) => {
  const host = getHostUri(req);
  const expoUrl = `exp://${host}`;
  try {
    const svg = await QRCode.toString(expoUrl, {
      type: 'svg',
      width: 220,
      margin: 2,
      color: { dark: '#1B4F72', light: '#FFFFFF' },
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

app.get('/api/qrcode/:platform', async (req, res) => {
  const host = getHostUri(req);
  const expoUrl = `exp://${host}`;
  try {
    const svg = await QRCode.toString(expoUrl, {
      type: 'svg',
      width: 220,
      margin: 2,
      color: { dark: '#1B4F72', light: '#FFFFFF' },
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

app.get('/', (req, res, next) => {
  const expoPlatform = req.headers['expo-platform'] as string | undefined;
  const userAgent = req.headers['user-agent'] || '';
  const isExpoClient = expoPlatform || userAgent.includes('Expo') || userAgent.includes('okhttp');

  if (isExpoClient) {
    return expoProxy(req, res, next);
  }
  res.sendFile(path.join(templatesDir, 'landing-page.html'));
});

app.use('/assets', express.static(path.join(projectRoot, 'assets')));

app.use('/logs', expoProxy);
app.use('/symbolicate', expoProxy);
app.use('/status', expoProxy);
app.use('/inspector', expoProxy);
app.use('/json', expoProxy);
app.use('/message', expoProxy);
app.use('/__metro_hmr', expoProxy);

app.use((req, res, next) => {
  if (req.path.endsWith('.bundle') || req.path.endsWith('.map')) {
    return expoProxy(req, res, next);
  }
  next();
});

app.use(express.static(templatesDir));

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Driver Core API running on port ${PORT}`);
  console.log(`Proxying Expo requests to dev server on port ${EXPO_DEV_PORT}`);
});
