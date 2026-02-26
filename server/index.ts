import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";

const app = express();
const httpServer = createServer(app);

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
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
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
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
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
    
    console.log('[startup] Registering routes...');
    await registerRoutes(httpServer, app);
    console.log('[startup] Routes registered');

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      console.error(`[error] ${status} ${message}`, err.stack || '');
      if (!res.headersSent) {
        res.status(status).json({ message });
      }
    });

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
