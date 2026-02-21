"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const qrcode_1 = __importDefault(require("qrcode"));
const mobile_1 = require("./routes/mobile");
const ai_1 = require("./routes/ai");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use('/api/mobile', mobile_1.mobileRoutes);
app.use('/api/mobile/ai', ai_1.aiRoutes);
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'driver-core-api' });
});
const projectRoot = path_1.default.resolve(__dirname, '..');
const distDir = path_1.default.join(projectRoot, 'dist');
const templatesDir = path_1.default.join(projectRoot, 'server', 'templates');
function getAppJson() {
    const appJsonPath = path_1.default.join(projectRoot, 'app.json');
    return JSON.parse(fs_1.default.readFileSync(appJsonPath, 'utf-8'));
}
function getHostUrl(req) {
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
app.use('/bundles', express_1.default.static(distDir, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.bundle')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    },
}));
app.use('/assets', express_1.default.static(path_1.default.join(distDir, 'assets')));
function buildManifest(platform, req) {
    const appJson = getAppJson();
    const expo = appJson.expo;
    const hostUrl = getHostUrl(req);
    const hostUri = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000');
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
    const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5000');
    const expoUrl = `exps://${host}/manifest/${platform}`;
    try {
        const svg = await qrcode_1.default.toString(expoUrl, {
            type: 'svg',
            width: 220,
            margin: 2,
            color: { dark: '#1B4F72', light: '#FFFFFF' },
        });
        res.setHeader('Content-Type', 'image/svg+xml');
        res.send(svg);
    }
    catch (err) {
        res.status(500).json({ error: 'QR generation failed' });
    }
});
app.use(express_1.default.static(templatesDir));
app.get('/', (req, res) => {
    const expoPlatform = req.headers['expo-platform'];
    if (expoPlatform === 'ios' || expoPlatform === 'android') {
        const manifest = buildManifest(expoPlatform, req);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('expo-protocol-version', '1');
        return res.json(manifest);
    }
    res.sendFile(path_1.default.join(templatesDir, 'landing-page.html'));
});
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Driver Core API running on port ${PORT}`);
    const iosBundleExists = fs_1.default.existsSync(path_1.default.join(distDir, 'ios', 'index.bundle'));
    const androidBundleExists = fs_1.default.existsSync(path_1.default.join(distDir, 'android', 'index.bundle'));
    console.log(`Static bundles: iOS=${iosBundleExists}, Android=${androidBundleExists}`);
});
