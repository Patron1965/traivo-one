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

const distDir = path.join(__dirname, '..', 'dist');

function getAppJson() {
  const appJsonPath = path.join(__dirname, '..', 'app.json');
  return JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
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

app.use('/bundles', express.static(distDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.bundle')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  },
}));

app.use('/assets', express.static(path.join(distDir, 'assets')));

function buildManifest(platform: string, req: express.Request) {
  const appJson = getAppJson();
  const expo = appJson.expo;
  const hostUrl = getHostUrl(req);
  const hostUri = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000') as string;

  return {
    id: `@anonymous/${expo.slug}`,
    createdAt: new Date().toISOString(),
    runtimeVersion: {
      type: 'fingerprint',
      fingerprintSources: [],
    },
    launchAsset: {
      url: `${hostUrl}/bundles/${platform}/index.bundle`,
      contentType: 'application/javascript',
    },
    assets: [],
    metadata: {},
    extra: {
      expoClient: {
        ...expo,
        hostUri,
      },
      expoGo: {
        developer: {
          tool: 'expo-cli',
          projectRoot: '/home/runner/workspace',
        },
        packagerOpts: {
          dev: false,
        },
      },
    },
  };
}

app.get('/api/qrcode/:platform', async (req, res) => {
  const platform = req.params.platform;
  if (platform !== 'ios' && platform !== 'android') {
    return res.status(404).json({ error: 'Invalid platform' });
  }
  const hostUrl = getHostUrl(req);
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

app.use(express.static(path.join(__dirname, 'templates')));

app.get('/', (req, res) => {
  const expoPlatform = req.headers['expo-platform'] as string | undefined;
  if (expoPlatform === 'ios' || expoPlatform === 'android') {
    const manifest = buildManifest(expoPlatform, req);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('expo-protocol-version', '1');
    return res.json(manifest);
  }
  res.sendFile(path.join(__dirname, 'templates', 'landing-page.html'));
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Driver Core API running on port ${PORT}`);
  
  const iosBundleExists = fs.existsSync(path.join(distDir, 'ios', 'index.bundle'));
  const androidBundleExists = fs.existsSync(path.join(distDir, 'android', 'index.bundle'));
  console.log(`Static bundles: iOS=${iosBundleExists}, Android=${androidBundleExists}`);
});
