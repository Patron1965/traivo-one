import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import { fixInitialOwnerRole } from "./startup-fixes";
import { startImportBatchWatchdog } from "./import-batch-watchdog";
import { logger } from "./logger";
import { requestIdMiddleware } from "./middleware/request-id";
import { errorHandler } from "./middleware/errorHandler";
import { registerHealthRoutes } from "./routes/healthRoutes";

const app = express();
const httpServer = createServer(app);

app.use(requestIdMiddleware);

app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      const accept = String(req.headers["accept"] || "");
      const ctype = String(res.getHeader("Content-Type") || "");
      if (accept.includes("text/event-stream") || ctype.includes("text/event-stream")) {
        return false;
      }
      return compression.filter(req, res);
    },
  }),
);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// CORS middleware for mobile API endpoints
app.use((req, res, next) => {
  if (req.path.startsWith('/api/mobile')) {
    const origin = req.headers.origin;
    // Allow same-origin, Replit URLs, and localhost for development
    const allowedPatterns = [
      /^https?:\/\/.*\.replit\.dev$/,
      /^https?:\/\/.*\.replit\.app$/,
      /^https?:\/\/.*\.exp\.direct$/,
      /^https?:\/\/localhost(:\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    ];
    
    if (origin && allowedPatterns.some(pattern => pattern.test(origin))) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
  }
  next();
});

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

registerHealthRoutes(app);

export function log(message: string, source = "express") {
  logger.info({ source }, message);
}

// Fields whose values must never appear in logs because they are reusable bearer
// credentials. Add any future token/secret fields here.
const SENSITIVE_FIELDS = new Set([
  "token",
  "sessionToken",
  "shareToken",
  "shareUrl",
  "accessToken",
  "refreshToken",
  "secret",
  "password",
]);

function redactSensitiveFields(value: any, depth = 0): any {
  if (depth > 10) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const redacted: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      redacted[k] = SENSITIVE_FIELDS.has(k) ? "[REDACTED]" : redactSensitiveFields(v, depth + 1);
    }
    return redacted;
  }
  return value;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const reqLog = req.log ?? logger;
      let preview: string | undefined;
      if (capturedJsonResponse) {
        if (Array.isArray(capturedJsonResponse)) {
          preview = `[Array(${capturedJsonResponse.length} items)]`;
        } else {
          const safe = redactSensitiveFields(capturedJsonResponse);
          const jsonStr = JSON.stringify(safe);
          preview = jsonStr.length > 200 ? jsonStr.slice(0, 200) + "..." : jsonStr;
        }
      }
      reqLog.info(
        {
          method: req.method,
          route: path,
          status: res.statusCode,
          durationMs: duration,
          tenantId: req.tenantId,
          response: preview,
        },
        `${req.method} ${path} ${res.statusCode} in ${duration}ms`,
      );
    }
  });

  next();
});

// Global error handlers for uncaught exceptions
process.on('uncaughtException', (error: any) => {
  if (error?.code === 'EADDRINUSE') {
    console.error('[startup] Port in use, will retry...');
    return;
  }
  console.error('[FATAL] Uncaught exception:', error);
  console.error('Stack:', (error as Error).stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled rejection at:', promise, 'reason:', reason);
});

process.on('SIGTERM', () => {
  console.error('[SIGNAL] Received SIGTERM - keeping server alive');
});

process.on('SIGINT', () => {
  console.error('[SIGNAL] Received SIGINT - keeping server alive');
});

process.on('exit', (code) => {
  console.error(`[EXIT] Process exiting with code ${code}`);
});

(async () => {
  try {
    console.log('[startup] Beginning server initialization...');
    
    // Seed database on startup (skips if already seeded)
    try {
      console.log('[startup] Seeding database...');
      await seedDatabase();
      console.log('[startup] Database seeding complete');
    } catch (error) {
      console.error("Failed to seed database:", error);
    }

    try {
      await fixInitialOwnerRole();
    } catch (error) {
      console.error("[startup] Failed to run owner role fix:", error);
    }

    // Återhämta avbrutna berikningskörningar (Task #253). Vid uppstart är alla
    // import_batches med metadata.status='in_progress' per definition övergivna
    // — processen som ägde dem är död. Markera dem som failed med tydlig orsak
    // så UI inte fastnar i progress-läget och användaren kan starta om.
    try {
      console.log('[startup] Running import-batch watchdog...');
      const recovered = await startImportBatchWatchdog();
      // Operationell sammanfattning på en rad så det går enkelt att grepa i
      // produktionsloggar för incidentdiagnostik (scanned/recovered/raced/errors).
      console.log(
        `[startup] [import-watchdog] summary scanned=${recovered.scanned} recovered=${recovered.recovered.length} raced=${recovered.raced.length} errors=${recovered.errors.length}`,
      );
      if (recovered.recovered.length > 0) {
        console.log(
          `[startup] Watchdog markerade ${recovered.recovered.length} övergiven(a) batch(es) som failed: ${recovered.recovered.join(", ")}`,
        );
      }
      if (recovered.raced.length > 0) {
        console.log(
          `[startup] Watchdog hoppade över ${recovered.raced.length} batch(es) som hann progressera under racet: ${recovered.raced.join(", ")}`,
        );
      }
      if (recovered.errors.length > 0) {
        console.error('[startup] Watchdog kunde inte markera några batches:', recovered.errors);
      }
    } catch (error) {
      console.error("[startup] Failed to run import-batch watchdog:", error);
    }

    console.log('[startup] Registering routes...');
    await registerRoutes(httpServer, app);
    console.log('[startup] Routes registered');

    app.use(errorHandler);

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    if (process.env.NODE_ENV === "production") {
      console.log('[startup] Setting up static file serving...');
      serveStatic(app);
    } else {
      console.log('[startup] Setting up Vite dev server...');
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    const port = parseInt(process.env.PORT || "5000", 10);
    
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[startup] Port ${port} in use, retrying in 2s...`);
        setTimeout(() => {
          httpServer.listen({ port, host: "0.0.0.0" }, () => {
            log(`serving on port ${port}`);
          });
        }, 2000);
      } else {
        console.error('[FATAL] Server error:', err);
        process.exit(1);
      }
    });

    httpServer.listen(
      {
        port,
        host: "0.0.0.0",
      },
      () => {
        log(`serving on port ${port}`);
      },
    );
  } catch (error) {
    console.error('[FATAL] Server startup failed:', error);
    console.error('Stack:', (error as Error).stack);
    process.exit(1);
  }
})();
