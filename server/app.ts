import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import http from 'http';
import QRCode from 'qrcode';
import { Server as SocketIOServer } from 'socket.io';
import { mobileRoutes } from './routes/mobile';
import { aiRoutes } from './routes/ai';
import { plannerRoutes } from './routes/planner';

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  path: '/ws',
});

io.on('connection', (socket) => {
  console.log(`WebSocket client connected: ${socket.id}`);

  socket.on('join', (data: { resourceId?: string; tenantId?: string }) => {
    if (data.resourceId) {
      socket.join(`resource:${data.resourceId}`);
    }
    if (data.tenantId) {
      socket.join(`tenant:${data.tenantId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`WebSocket client disconnected: ${socket.id}`);
  });
});

(app as any).io = io;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api/mobile', mobileRoutes);
app.use('/api/mobile/ai', aiRoutes);
app.use('/api/planner', plannerRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'nordnav-api' });
});

const projectRoot = fs.existsSync(path.resolve(__dirname, '..', 'app.json'))
  ? path.resolve(__dirname, '..')
  : process.cwd();
const metroDir = path.join(projectRoot, 'dist-metro');
const templatesDir = path.join(projectRoot, 'server', 'templates');
console.log(`[init] projectRoot=${projectRoot}, templatesDir=${templatesDir}, exists=${fs.existsSync(templatesDir)}`);

let cachedAppJson: any = null;
let cachedSdkVersion: string = '54.0.0';

function loadAppJson() {
  try {
    cachedAppJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf-8'));
  } catch (e) {
    console.error('Failed to load app.json:', e);
    cachedAppJson = { expo: { name: 'Nordnav Go', slug: 'fltapp', splash: {} } };
  }
}

function loadSdkVersion() {
  try {
    cachedSdkVersion = JSON.parse(fs.readFileSync(path.join(projectRoot, 'node_modules', 'expo', 'package.json'), 'utf-8')).version;
  } catch {
    cachedSdkVersion = '54.0.0';
  }
}

loadAppJson();
loadSdkVersion();

function getAppJson() {
  return cachedAppJson;
}

function getExpoSdkVersion(): string {
  return cachedSdkVersion;
}

function getHostUrl(req: express.Request): string {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000';
  return `${proto}://${host}`;
}

function getHostUri(req: express.Request): string {
  return (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000') as string;
}

function buildManifest(platform: 'ios' | 'android', req: express.Request) {
  const appJson = getAppJson();
  const expo = appJson.expo;
  const hostUrl = getHostUrl(req);
  const hostUri = getHostUri(req);
  const sdkVersion = getExpoSdkVersion();
  const sdkMajor = sdkVersion.split('.')[0] + '.0.0';

  const bundlePath = path.join(metroDir, platform, 'index.bundle');
  let bundleHash = '';
  try {
    const stat = fs.statSync(bundlePath);
    bundleHash = `?v=${stat.mtimeMs.toString(36)}`;
  } catch {}
  const bundleUrl = `${hostUrl}/bundles/${platform}/index.bundle${bundleHash}`;

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    runtimeVersion: `exposdk:${sdkMajor}`,
    launchAsset: {
      key: 'bundle',
      contentType: 'application/javascript',
      url: bundleUrl,
    },
    assets: [],
    metadata: {},
    extra: {
      eas: {},
      expoClient: {
        ...expo,
        sdkVersion: sdkMajor,
        platforms: ['ios', 'android', 'web'],
        iconUrl: `${hostUrl}/assets/icon.png`,
        hostUri,
        splash: {
          ...expo.splash,
          imageUrl: `${hostUrl}/assets/${expo.splash?.image?.replace('./', '') || 'splash-icon.png'}`,
        },
        _internal: {
          isDebug: false,
          projectRoot: '/home/runner/workspace',
          dynamicConfigPath: null,
          staticConfigPath: '/home/runner/workspace/app.json',
          packageJsonPath: '/home/runner/workspace/package.json',
        },
      },
      expoGo: {
        debuggerHost: hostUri,
        developer: {
          tool: 'expo-cli',
          projectRoot: '/home/runner/workspace',
        },
        packagerOpts: {
          dev: false,
        },
        mainModuleName: 'index',
      },
      scopeKey: `@anonymous/${expo.slug}`,
    },
  };
}

function serveManifest(platform: 'ios' | 'android', req: express.Request, res: express.Response) {
  try {
    const manifest = buildManifest(platform, req);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('expo-protocol-version', '0');
    res.setHeader('expo-sfv-version', '0');
    res.setHeader('cache-control', 'private, max-age=0');
    res.send(JSON.stringify(manifest));
  } catch (e) {
    console.error('Failed to serve manifest:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate manifest' });
    }
  }
}

app.get('/manifest/:platform', (req, res) => {
  const platform = req.params.platform as string;
  if (platform !== 'ios' && platform !== 'android') {
    return res.status(404).json({ error: 'Invalid platform' });
  }
  serveManifest(platform, req, res);
});

const bundleCache: Record<string, { content: string; mtime: number }> = {};
const DEV_DOMAIN = '143744bc-0950-40ae-a71f-7334bd02d088-00-2jqn3h1bml74q.kirk.replit.dev';

app.get('/bundles/:platform/index.bundle', (req, res) => {
  const platform = req.params.platform;
  if (platform !== 'ios' && platform !== 'android') {
    return res.status(404).send('Invalid platform');
  }
  const bundlePath = path.join(metroDir, platform, 'index.bundle');
  if (!fs.existsSync(bundlePath)) {
    return res.status(404).send('Bundle not found. Run: bash scripts/build.sh');
  }
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '') as string;
  const cacheKey = `${platform}:${host}`;

  try {
    const stat = fs.statSync(bundlePath);
    const mtime = stat.mtimeMs;
    const cached = bundleCache[cacheKey];

    if (!cached || cached.mtime !== mtime) {
      let bundle = fs.readFileSync(bundlePath, 'utf-8');
      if (host && host !== 'localhost:5000' && host !== 'localhost') {
        bundle = bundle.replaceAll(DEV_DOMAIN, host);
      }
      bundleCache[cacheKey] = { content: bundle, mtime };
    }

    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(bundleCache[cacheKey].content);
  } catch (e) {
    console.error('Bundle serve error:', e);
    res.status(500).send('Failed to serve bundle');
  }
});

app.use('/assets', express.static(path.join(projectRoot, 'assets'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.ttf')) {
      res.setHeader('Content-Type', 'font/ttf');
    } else if (filePath.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));

app.get('/api/qrcode', async (req, res) => {
  const host = getHostUri(req);
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https') as string;
  const expoProto = proto === 'https' ? 'exps' : 'exp';
  const expoUrl = `${expoProto}://${host}`;
  try {
    const svg = await QRCode.toString(expoUrl, {
      type: 'svg', width: 220, margin: 2,
      color: { dark: '#1B4F72', light: '#FFFFFF' },
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch { res.status(500).json({ error: 'QR generation failed' }); }
});

app.get('/api/qrcode/:platform', async (req, res) => {
  const host = getHostUri(req);
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https') as string;
  const expoProto = proto === 'https' ? 'exps' : 'exp';
  const expoUrl = `${expoProto}://${host}`;
  try {
    const svg = await QRCode.toString(expoUrl, {
      type: 'svg', width: 220, margin: 2,
      color: { dark: '#1B4F72', light: '#FFFFFF' },
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch { res.status(500).json({ error: 'QR generation failed' }); }
});

app.get('/status', (_req, res) => {
  res.send('packager-status:running');
});

app.use(express.static(templatesDir));

app.get('/planner/map', (_req, res) => {
  res.sendFile(path.join(templatesDir, 'planner-map.html'));
});

app.get('/support', (_req, res) => {
  res.sendFile(path.join(templatesDir, 'support.html'));
});

app.get('/', (req, res) => {
  try {
    const expoPlatform = req.headers['expo-platform'] as string | undefined;
    if (expoPlatform === 'ios' || expoPlatform === 'android') {
      return serveManifest(expoPlatform, req, res);
    }

    const userAgent = req.headers['user-agent'] || '';
    if (userAgent.includes('Expo') || userAgent.includes('okhttp')) {
      const platform = userAgent.includes('iPhone') || userAgent.includes('iOS') ? 'ios' : 'android';
      return serveManifest(platform as 'ios' | 'android', req, res);
    }

    const landingPath = path.join(templatesDir, 'landing-page.html');
    res.sendFile(landingPath, (err) => {
      if (err && !res.headersSent) {
        res.status(200).send(`<!DOCTYPE html><html><head><title>Nordnav Go</title></head><body><h1>Nordnav Go API</h1><p>Server is running.</p></body></html>`);
      }
    });
  } catch (e) {
    if (!res.headersSent) {
      res.status(200).send(`<!DOCTYPE html><html><head><title>Nordnav Go</title></head><body><h1>Nordnav Go API</h1><p>Server is running.</p></body></html>`);
    }
  }
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  console.error(err.stack);
  setTimeout(() => process.exit(1), 500);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
});
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
});

const PORT = 5000;
server.listen(PORT, '0.0.0.0', () => {
  const kinabUrl = process.env.KINAB_API_URL;
  const mockMode = !kinabUrl || process.env.KINAB_MOCK_MODE === 'true';
  console.log(`Nordnav Go API running on port ${PORT}`);
  console.log(`Kinab Core Concept: ${mockMode ? 'MOCK MODE (no KINAB_API_URL set)' : `LIVE → ${kinabUrl}`}`);
  const iosBundle = path.join(metroDir, 'ios', 'index.bundle');
  const androidBundle = path.join(metroDir, 'android', 'index.bundle');
  const hasIos = fs.existsSync(iosBundle);
  const hasAndroid = fs.existsSync(androidBundle);
  console.log(`Metro JS bundles: iOS=${hasIos}, Android=${hasAndroid}`);
  if (hasIos) console.log(`  iOS: ${(fs.statSync(iosBundle).size / 1024 / 1024).toFixed(1)} MB`);
  if (hasAndroid) console.log(`  Android: ${(fs.statSync(androidBundle).size / 1024 / 1024).toFixed(1)} MB`);
  if (!hasIos || !hasAndroid) {
    console.log('Warning: Bundles missing. Run: bash scripts/build.sh');
  }
});

server.on('error', (err: any) => {
  console.error('Server error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

setInterval(() => {
  process.stdout.write('');
}, 15000);
