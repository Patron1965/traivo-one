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
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled rejection at:', promise, 'reason:', reason);
});

(async () => {
  try {
    console.log('[startup] Beginning server initialization...');

    const port = parseInt(process.env.PORT || "5000", 10);
    httpServer.listen(
      {
        port,
        host: "0.0.0.0",
        reusePort: true,
      },
      () => {
        log(`serving on port ${port}`);
      },
    );
    
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

      res.status(status).json({ message });
      throw err;
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

    console.log('[startup] Server fully initialized');
  } catch (error) {
    console.error('[FATAL] Server startup failed:', error);
    console.error('Stack:', (error as Error).stack);
    process.exit(1);
  }
})();
