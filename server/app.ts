import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
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

interface AssetMeta {
  path: string;
  ext: string;
}

interface PlatformMeta {
  bundle: string;
  assets: AssetMeta[];
}

interface ExportMetadata {
  version: number;
  bundler: string;
  fileMetadata: {
    ios?: PlatformMeta;
    android?: PlatformMeta;
  };
}

function getMetadata(): ExportMetadata {
  const metaPath = path.join(exportDir, 'metadata.json');
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

function getAppJson() {
  const appJsonPath = path.join(projectRoot, 'app.json');
  return JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
}

function getExpoSdkVersion(): string {
  try {
    const expoPkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'node_modules', 'expo', 'package.json'), 'utf-8'));
    return expoPkg.version;
  } catch {
    return '54.0.0';
  }
}

function getHostUrl(req: express.Request): string {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000';
  return `${proto}://${host}`;
}

app.get('/manifest/:platform', (req, res) => {
  const platform = req.params.platform;
  if (platform !== 'ios' && platform !== 'android') {
    return res.status(404).json({ error: 'Invalid platform' });
  }
  const manifest = buildManifest(platform, req);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('expo-protocol-version', '1');
  res.json(manifest);
});

app.use('/_expo', express.static(path.join(exportDir, '_expo'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.hbc')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  },
}));

app.use('/assets', express.static(path.join(exportDir, 'assets')));

function buildManifest(platform: string, req: express.Request) {
  const appJson = getAppJson();
  const expo = appJson.expo;
  const hostUrl = getHostUrl(req);
  const hostUri = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000') as string;
  const sdkVersion = getExpoSdkVersion();
  const sdkMajor = sdkVersion.split('.')[0] + '.0.0';

  const metadata = getMetadata();
  const platformMeta = metadata.fileMetadata[platform as 'ios' | 'android'];

  const bundleUrl = platformMeta
    ? `${hostUrl}/${platformMeta.bundle}`
    : `${hostUrl}/_expo/static/js/${platform}/index.hbc`;

  const assets = platformMeta
    ? platformMeta.assets.map((asset, index) => ({
        key: asset.path.replace('assets/', ''),
        contentType: asset.ext === 'ttf' ? 'font/ttf' : `image/${asset.ext}`,
        url: `${hostUrl}/${asset.path}`,
        fileHashes: [asset.path.replace('assets/', '')],
      }))
    : [];

  return {
    id: `@anonymous/${expo.slug}`,
    createdAt: new Date().toISOString(),
    runtimeVersion: `exposdk:${sdkMajor}`,
    launchAsset: {
      key: 'bundle',
      url: bundleUrl,
      contentType: 'application/javascript',
    },
    assets,
    metadata: {},
    extra: {
      expoClient: {
        ...expo,
        sdkVersion: sdkMajor,
        platforms: ['ios', 'android', 'web'],
        iconUrl: `${hostUrl}/assets/icon.png`,
        hostUri,
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

app.get('/api/qrcode/:platform', async (req, res) => {
  const platform = req.params.platform;
  if (platform !== 'ios' && platform !== 'android') {
    return res.status(404).json({ error: 'Invalid platform' });
  }
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000') as string;
  const expoUrl = `exps://${host}/manifest/${platform}`;
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

app.use(express.static(templatesDir));

app.get('/', (req, res) => {
  const expoPlatform = req.headers['expo-platform'] as string | undefined;
  if (expoPlatform === 'ios' || expoPlatform === 'android') {
    const manifest = buildManifest(expoPlatform, req);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('expo-protocol-version', '1');
    return res.json(manifest);
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
  } catch {
    console.log('Warning: No export metadata found');
  }
});
