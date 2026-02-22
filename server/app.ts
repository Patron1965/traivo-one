import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import QRCode from 'qrcode';
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
const exportDir = path.join(projectRoot, 'dist-export');
const templatesDir = path.join(projectRoot, 'server', 'templates');

interface AssetMeta { path: string; ext: string; }
interface PlatformMeta { bundle: string; assets: AssetMeta[]; }
interface ExportMetadata {
  version: number;
  bundler: string;
  fileMetadata: { ios?: PlatformMeta; android?: PlatformMeta; };
}

let cachedMetadata: ExportMetadata | null = null;
function getMetadata(): ExportMetadata {
  if (!cachedMetadata) {
    cachedMetadata = JSON.parse(fs.readFileSync(path.join(exportDir, 'metadata.json'), 'utf-8'));
  }
  return cachedMetadata!;
}

function getAppJson() {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf-8'));
}

function getExpoSdkVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'node_modules', 'expo', 'package.json'), 'utf-8')).version;
  } catch { return '54.0.0'; }
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

  const metadata = getMetadata();
  const platformMeta = metadata.fileMetadata[platform];
  const bundleUrl = platformMeta
    ? `${hostUrl}/${platformMeta.bundle}`
    : `${hostUrl}/_expo/static/js/${platform}/index.hbc`;

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
        mainModuleName: 'index.ts',
      },
      scopeKey: `@anonymous/${expo.slug}`,
    },
  };
}

function serveManifest(platform: 'ios' | 'android', req: express.Request, res: express.Response) {
  const manifest = buildManifest(platform, req);
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('expo-protocol-version', '0');
  res.setHeader('expo-sfv-version', '0');
  res.setHeader('cache-control', 'private, max-age=0');
  res.send(JSON.stringify(manifest));
}

app.get('/manifest/:platform', (req, res) => {
  const platform = req.params.platform as string;
  if (platform !== 'ios' && platform !== 'android') {
    return res.status(404).json({ error: 'Invalid platform' });
  }
  serveManifest(platform, req, res);
});

app.use('/_expo', express.static(path.join(exportDir, '_expo'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.hbc')) {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

app.use('/assets', express.static(path.join(exportDir, 'assets'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.ttf')) {
      res.setHeader('Content-Type', 'font/ttf');
    } else if (filePath.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));

app.use('/assets', express.static(path.join(projectRoot, 'assets')));

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

app.get('/', (req, res) => {
  const expoPlatform = req.headers['expo-platform'] as string | undefined;
  if (expoPlatform === 'ios' || expoPlatform === 'android') {
    return serveManifest(expoPlatform, req, res);
  }

  const userAgent = req.headers['user-agent'] || '';
  if (userAgent.includes('Expo') || userAgent.includes('okhttp')) {
    const platform = userAgent.includes('iPhone') || userAgent.includes('iOS') ? 'ios' : 'android';
    return serveManifest(platform as 'ios' | 'android', req, res);
  }

  res.sendFile(path.join(templatesDir, 'landing-page.html'));
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Driver Core API running on port ${PORT}`);
  try {
    const metadata = getMetadata();
    const hasIos = !!metadata.fileMetadata.ios;
    const hasAndroid = !!metadata.fileMetadata.android;
    console.log(`Hermes bundles: iOS=${hasIos}, Android=${hasAndroid}`);
    if (hasIos) console.log(`  iOS: ${metadata.fileMetadata.ios!.bundle} (${(fs.statSync(path.join(exportDir, metadata.fileMetadata.ios!.bundle)).size / 1024 / 1024).toFixed(1)} MB)`);
    if (hasAndroid) console.log(`  Android: ${metadata.fileMetadata.android!.bundle} (${(fs.statSync(path.join(exportDir, metadata.fileMetadata.android!.bundle)).size / 1024 / 1024).toFixed(1)} MB)`);
  } catch { console.log('Warning: No export metadata found. Run: bash scripts/build.sh'); }
});
