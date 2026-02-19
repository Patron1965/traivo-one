import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { mobileRoutes } from './routes/mobile';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/api/mobile', mobileRoutes);

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

app.get('/manifest/ios', (req, res) => {
  const appJson = getAppJson();
  const expo = appJson.expo;
  const hostUrl = getHostUrl(req);

  const manifest = {
    id: `@anonymous/${expo.slug}`,
    createdAt: new Date().toISOString(),
    runtimeVersion: {
      type: 'fingerprint',
      fingerprintSources: [],
    },
    launchAsset: {
      url: `${hostUrl}/bundles/ios/index.bundle`,
      contentType: 'application/javascript',
    },
    assets: [],
    metadata: {},
    extra: {
      expoClient: {
        ...expo,
        hostUri: (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000') as string,
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

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('expo-protocol-version', '1');
  res.json(manifest);
});

app.get('/manifest/android', (req, res) => {
  const appJson = getAppJson();
  const expo = appJson.expo;
  const hostUrl = getHostUrl(req);

  const manifest = {
    id: `@anonymous/${expo.slug}`,
    createdAt: new Date().toISOString(),
    runtimeVersion: {
      type: 'fingerprint',
      fingerprintSources: [],
    },
    launchAsset: {
      url: `${hostUrl}/bundles/android/index.bundle`,
      contentType: 'application/javascript',
    },
    assets: [],
    metadata: {},
    extra: {
      expoClient: {
        ...expo,
        hostUri: (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000') as string,
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

app.use(express.static(path.join(__dirname, 'templates')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'landing-page.html'));
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Driver Core API running on port ${PORT}`);
  
  const iosBundleExists = fs.existsSync(path.join(distDir, 'ios', 'index.bundle'));
  const androidBundleExists = fs.existsSync(path.join(distDir, 'android', 'index.bundle'));
  console.log(`Static bundles: iOS=${iosBundleExists}, Android=${androidBundleExists}`);
});
