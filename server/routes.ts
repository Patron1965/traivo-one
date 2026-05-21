import type { Express, Request as ExpressRequest, Response as ExpressResponse } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { registerMagicLinkRoutes } from "./replit_integrations/auth/magicLinkAuth";
import { registerInvitationsRoutes } from "./routes/invitationsRoutes";
import { requireTenantWithFallback, getTenantIdWithFallback, getUserTenants } from "./tenant-middleware";
import { moduleGuardMiddleware } from "./feature-flags";
import { notificationService } from "./notifications";
import { handleMcpSse, handleMcpMessage } from "./mcp";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { anomalyMonitor } from "./anomaly-monitor";
import { predictiveScheduler } from "./routes/predictiveRoutes";
import { slaRiskScheduler } from "./services/sla-risk-scheduler";
import { registerSlaRiskRoutes } from "./routes/slaRiskRoutes";
import { geocodeScheduler } from "./services/geocode-scheduler";
import { notificationCleanupScheduler, getRetentionConfig } from "./services/notification-cleanup-scheduler";
import { fortnoxMappingCleanupScheduler } from "./services/fortnox-mapping-cleanup-scheduler";
import { auditCleanupScheduler } from "./services/audit-cleanup-scheduler";
import { prodHealthCheckScheduler } from "./services/prod-health-check-scheduler";
import { registerProdHealthCheckRoutes } from "./routes/prodHealthCheckRoutes";
import { startWeeklyReportScheduler } from "./weekly-report";
import { metadataRouter } from "./metadata-routes";
import { formatZodError, DEFAULT_TENANT_ID } from "./routes/helpers";
import { AppError } from "./errors";

import { registerCustomerRoutes } from "./routes/customerRoutes";
import { registerObjectRoutes } from "./routes/objectRoutes";
import { registerResourceRoutes } from "./routes/resourceRoutes";
import { registerWorkOrderRoutes } from "./routes/workOrderRoutes";
import { registerImportRoutes } from "./routes/importRoutes";
import { registerOnboardingRoutes } from "./routes/onboardingRoutes";
import { registerConfigRoutes } from "./routes/configRoutes";
import { registerClusterRoutes } from "./routes/clusterRoutes";
import { registerAIRoutes } from "./routes/aiRoutes";
import { registerOptimizationRoutes } from "./routes/optimizationRoutes";
import { registerMobileRoutes, registerMobileAliasRoutes } from "./routes/mobile";
import { registerPlannerRoutes } from "./routes/plannerRoutes";
import { registerKPIRoutes } from "./routes/kpiRoutes";
import { registerFortnoxRoutes } from "./routes/fortnoxRoutes";
import { registerOrderConceptRoutes } from "./routes/orderConceptRoutes";
import { registerPortalRoutes } from "./routes/portalRoutes";
import { registerExtendedRoutes } from "./routes/extendedRoutes";
import { registerIoTRoutes } from "./routes/iotRoutes";
import { registerAnnualGoalRoutes } from "./routes/annualGoalRoutes";
import { registerPredictiveRoutes } from "./routes/predictiveRoutes";
import { registerRoiRoutes } from "./routes/roiRoutes";
import { registerDisruptionRoutes } from "./routes/disruptionRoutes";
import { registerFeedbackLoopRoutes } from "./routes/feedbackLoopRoutes";
import { registerETANotificationRoutes } from "./routes/etaNotificationRoutes";
import { registerFeatureRoutes } from "./routes/featureRoutes";
import { registerUrgentJobRoutes } from "./routes/urgentJobRoutes";
import { registerCapacityForecastRoutes, capacityForecastScheduler } from "./routes/capacityForecastRoutes";
import { registerRealtimeTestRoutes } from "./routes/realtime-test";
import { registerResendWebhookRoutes } from "./routes/resendWebhookRoutes";

async function ensureDefaultTenant() {
  // Only auto-create the legacy demo tenant if the database has no tenants at all.
  // In production / customer setups (e.g. Kinab) this is a no-op.
  const existing = await storage.getTenant(DEFAULT_TENANT_ID);
  if (existing) return existing;
  const { db } = await import("./db");
  const { tenants } = await import("@shared/schema");
  const any = await db.select().from(tenants).limit(1);
  if (any.length > 0) return undefined;
  return storage.ensureTenant(DEFAULT_TENANT_ID, {
    name: "Traivo",
    orgNumber: "556789-1234",
    contactEmail: "info@traivo.se",
    contactPhone: "+46701234567",
    settings: {},
  });
}

export const API_VERSION = "v1";
export const API_VERSION_PREFIX = `/api/${API_VERSION}`;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  notificationService.initialize(httpServer);
  anomalyMonitor.start();
  startWeeklyReportScheduler();
  predictiveScheduler.start();
  slaRiskScheduler.start();
  geocodeScheduler.start();
  notificationCleanupScheduler.start();
  fortnoxMappingCleanupScheduler.start();
  auditCleanupScheduler.start();
  capacityForecastScheduler.start();
  prodHealthCheckScheduler.start();

  app.use((req: ExpressRequest, _res: ExpressResponse, next) => {
    if (req.url.startsWith(`/api/${API_VERSION}/`) || req.url === `/api/${API_VERSION}`) {
      req.url = "/api" + req.url.slice(`/api/${API_VERSION}`.length);
      req.__apiVersioned = true;
    }
    next();
  });

  const DEPRECATION_SKIP_PREFIXES = ["/auth", "/version"];

  app.use("/api", (req: ExpressRequest, res: ExpressResponse, next) => {
    if (req.__apiVersioned) {
      return next();
    }
    if (req.path === "/" || req.path === "") {
      return next();
    }
    if (DEPRECATION_SKIP_PREFIXES.some(p => req.path.startsWith(p))) {
      return next();
    }
    res.setHeader("Deprecation", "true");
    res.setHeader("Sunset", "2027-06-01");
    res.setHeader("Link", `</api/${API_VERSION}${req.path}>; rel="successor-version"`);
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[api-deprecation] Unversioned call: ${req.method} /api${req.path}`);
    }
    next();
  });

  app.get("/api/version", (_req: ExpressRequest, res: ExpressResponse) => {
    res.json({
      current: API_VERSION,
      supported: [API_VERSION],
      deprecatedUnversioned: true,
      sunset: "2027-06-01",
    });
  });

  await setupAuth(app);
  registerAuthRoutes(app);
  registerMagicLinkRoutes(app);
  registerInvitationsRoutes(app);
  
  await ensureDefaultTenant();

  app.get("/api/me/tenant", async (req, res) => {
    try {
      const user = req.user;
      if (!user?.claims?.sub) {
        // Säkerhet: returnera ingen tenant för oinloggade besökare. Tidigare
        // returnerade vi `kinab/user` som back-compat-fallback, vilket lät
        // frontend-flöden tro att besökaren hade access. Frontend hanterar
        // null-tenant korrekt via useAuth/AccessDeniedPage.
        return res.json({
          tenantId: null,
          role: null,
          tenantName: null,
          tenants: [],
          message: "Du är inte inloggad."
        });
      }

      const tenants = await getUserTenants(user.claims.sub);
      
      if (tenants.length > 0) {
        res.json({
          tenantId: tenants[0].tenantId,
          role: tenants[0].role,
          tenantName: tenants[0].tenantName,
          tenants,
        });
      } else {
        res.json({
          tenantId: null,
          role: null,
          tenantName: null,
          tenants: [],
          message: "Du är inte kopplad till någon organisation ännu. Kontakta administratör."
        });
      }
    } catch (error) {
      console.error("Failed to fetch tenant info:", error);
      res.status(500).json({ error: "Kunde inte hämta organisationsuppgifter" });
    }
  });

  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/portal") || req.path.startsWith("/mobile") || req.path.startsWith("/admin") || req.path.startsWith("/platform") || req.path.startsWith("/auth") || req.path.startsWith("/webhooks/") || (req.path === "/iot/signals" && req.method === "POST")) {
      return next();
    }
    return requireTenantWithFallback(req, res, next);
  });

  app.use("/api", moduleGuardMiddleware);

  const CUSTOMER_ALLOWED_PATHS = new Set([
    "/my-objects", "/my-reports", "/portal-booking-config",
    "/slot-preferences", "/tenant-info", "/booking-options",
    "/portal",
  ]);

  const REPORTER_ALLOWED_PATHS = new Set([
    "/my-reports", "/tenant-info",
  ]);

  app.use("/api", (req, res, next) => {
    const role = req.tenantRole;
    if (!role || role === "owner" || role === "admin" || role === "planner" || role === "technician" || role === "user" || role === "viewer") {
      return next();
    }
    const pathSegment = "/" + req.path.split("/").filter(Boolean)[0];
    if (role === "customer") {
      if (CUSTOMER_ALLOWED_PATHS.has(pathSegment)) {
        return next();
      }
      return res.status(403).json({
        error: "Behörighet saknas",
        message: "Kundanvändare har inte tillgång till denna resurs.",
      });
    }
    if (role === "reporter") {
      if (REPORTER_ALLOWED_PATHS.has(pathSegment)) {
        return next();
      }
      return res.status(403).json({
        error: "Behörighet saknas",
        message: "Anmälaranvändare har inte tillgång till denna resurs.",
      });
    }
    return next();
  });

  registerObjectStorageRoutes(app);

  app.get("/mcp/sse", handleMcpSse);
  app.post("/mcp/messages", handleMcpMessage);

  app.use("/api/metadata", metadataRouter);

  app.get("/api/nav-badges", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const unassignedRows = await db.execute(sql`
        SELECT COUNT(*) AS count FROM work_orders
        WHERE tenant_id = ${tenantId}
        AND deleted_at IS NULL
        AND resource_id IS NULL
        AND order_status NOT IN ('utford', 'fakturerad', 'omojlig', 'avbruten')
      `);
      const unplannedRows = await db.execute(sql`
        SELECT COUNT(*) AS count FROM work_orders
        WHERE tenant_id = ${tenantId}
        AND deleted_at IS NULL
        AND scheduled_date IS NULL
        AND order_status NOT IN ('utford', 'fakturerad', 'omojlig', 'avbruten')
      `);
      const unreadRows = await db.execute(sql`
        SELECT COUNT(*) AS count FROM portal_messages
        WHERE tenant_id = ${tenantId}
        AND sender_type = 'customer'
        AND is_read = false
      `);
      const getCount = (result: { rows: Record<string, unknown>[] } | Record<string, unknown>[]) => {
        const rows = Array.isArray(result) ? result : result.rows;
        if (!Array.isArray(rows) || rows.length === 0) return 0;
        return Number(rows[0]?.count ?? 0);
      };
      res.setHeader("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
      res.setHeader("Vary", "Cookie, Accept-Encoding");
      res.json({
        unassignedOrders: getCount(unassignedRows),
        unplannedAssignments: getCount(unplannedRows),
        unreadMessages: getCount(unreadRows),
      });
    } catch (error) {
      console.error("Failed to fetch nav badges:", error);
      res.json({ unassignedOrders: 0, unplannedAssignments: 0, unreadMessages: 0 });
    }
  });

  // In-app user notifications (planners/admins) — bell in header
  app.get("/api/notifications", async (req, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ error: "Ej autentiserad" });
      const tenantId = getTenantIdWithFallback(req);
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
      const unreadOnly = req.query.unreadOnly === "true" || statusParam === "unread";
      const readOnly = statusParam === "read";
      const type = typeof req.query.type === "string" && req.query.type ? req.query.type : undefined;
      const includeTotal = req.query.includeTotal === "true";
      const items = await storage.getUserNotifications(userId, tenantId, { limit, offset, unreadOnly, readOnly, type });
      const unreadCount = await storage.getUnreadUserNotificationCount(userId, tenantId);
      const retention = getRetentionConfig();
      const response: { notifications: typeof items; unreadCount: number; total?: number; retention: { readDays: number; unreadDays: number } } = { notifications: items, unreadCount, retention };
      if (includeTotal) {
        response.total = await storage.getUserNotificationsCount(userId, tenantId, { unreadOnly, readOnly, type });
      }
      res.json(response);
    } catch (error) {
      console.error("Failed to fetch user notifications:", error);
      res.status(500).json({ error: "Kunde inte hämta notiser" });
    }
  });

  app.get("/api/notifications/types", async (req, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ error: "Ej autentiserad" });
      const tenantId = getTenantIdWithFallback(req);
      const types = await storage.getUserNotificationTypes(userId, tenantId);
      res.json({ types });
    } catch (error) {
      console.error("Failed to fetch user notification types:", error);
      res.status(500).json({ error: "Kunde inte hämta notistyper" });
    }
  });

  app.patch("/api/notifications/:id/read", async (req, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ error: "Ej autentiserad" });
      const updated = await storage.markUserNotificationRead(req.params.id, userId);
      if (!updated) return res.status(404).json({ error: "Notis hittades inte" });
      res.json(updated);
    } catch (error) {
      console.error("Failed to mark notification read:", error);
      res.status(500).json({ error: "Kunde inte uppdatera notis" });
    }
  });

  // Issue a short-lived WS token bound to the authenticated user so the
  // header bell can subscribe to live in-app notifications without polling.
  app.post("/api/notifications/user-token", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ error: "Ej autentiserad" });
      const tenantId = getTenantIdWithFallback(req);
      const token = notificationService.generateUserAuthToken(userId, tenantId);
      res.json({ token, expiresIn: 300, userId });
    } catch (error) {
      console.error("Failed to issue user notification token:", error);
      res.status(500).json({ error: "Kunde inte skapa token" });
    }
  });

  // Manual trigger for the notification cleanup job. Registered under
  // /api/admin/ so it bypasses tenant middleware and can be called by an
  // external cron without a session, using NOTIFICATION_CLEANUP_TOKEN.
  // When a session is used instead, the caller must be admin/owner.
  app.post("/api/admin/notifications/cleanup", async (req: any, res) => {
    try {
      const token = process.env.NOTIFICATION_CLEANUP_TOKEN;
      const provided = req.header("x-cleanup-token") || (typeof req.query.token === "string" ? req.query.token : undefined);
      const tokenOk = !!token && provided === token;

      if (!tokenOk) {
        const userId = req.user?.claims?.sub;
        if (!userId) {
          return res.status(401).json({ error: "Ej autentiserad" });
        }
        const dbUser = await storage.getUser(userId);
        const role = dbUser?.role || "user";
        if (role !== "admin" && role !== "owner") {
          return res.status(403).json({ error: "Ej behörig", message: "Administratörsrättigheter krävs." });
        }
      }

      const result = await notificationCleanupScheduler.runOnce();
      res.json(result);
    } catch (error) {
      console.error("Failed to run notification cleanup:", error);
      res.status(500).json({ error: "Kunde inte rensa notiser" });
    }
  });

  // Manuell trigger för Fortnox-mapping-städning (Task #468). Samma autentiserings-
  // mönster som notifications/cleanup: cron via FORTNOX_MAPPING_CLEANUP_TOKEN, eller
  // admin/owner-session.
  app.post("/api/admin/fortnox-mappings/cleanup", async (req: any, res) => {
    try {
      const token = process.env.FORTNOX_MAPPING_CLEANUP_TOKEN;
      const provided = req.header("x-cleanup-token") || (typeof req.query.token === "string" ? req.query.token : undefined);
      const tokenOk = !!token && provided === token;

      if (!tokenOk) {
        const userId = req.user?.claims?.sub;
        if (!userId) {
          return res.status(401).json({ error: "Ej autentiserad" });
        }
        const dbUser = await storage.getUser(userId);
        const role = dbUser?.role || "user";
        if (role !== "admin" && role !== "owner") {
          return res.status(403).json({ error: "Ej behörig", message: "Administratörsrättigheter krävs." });
        }
      }

      const result = await fortnoxMappingCleanupScheduler.runOnce();
      res.json(result);
    } catch (error) {
      console.error("Failed to run fortnox mapping cleanup:", error);
      res.status(500).json({ error: "Kunde inte rensa Fortnox-mappningar" });
    }
  });

  // Manuell trigger för audit-logg-städning (Task #511). Samma autentiserings-
  // mönster som notifications/cleanup: cron via AUDIT_LOG_CLEANUP_TOKEN, eller
  // admin/owner-session.
  app.post("/api/admin/audit-logs/cleanup", async (req: any, res) => {
    try {
      const token = process.env.AUDIT_LOG_CLEANUP_TOKEN;
      const provided = req.header("x-cleanup-token") || (typeof req.query.token === "string" ? req.query.token : undefined);
      const tokenOk = !!token && provided === token;

      if (!tokenOk) {
        const userId = req.user?.claims?.sub;
        if (!userId) {
          return res.status(401).json({ error: "Ej autentiserad" });
        }
        const dbUser = await storage.getUser(userId);
        const role = dbUser?.role || "user";
        if (role !== "admin" && role !== "owner") {
          return res.status(403).json({ error: "Ej behörig", message: "Administratörsrättigheter krävs." });
        }
      }

      const result = await auditCleanupScheduler.runOnce();
      res.json(result);
    } catch (error) {
      console.error("Failed to run audit log cleanup:", error);
      res.status(500).json({ error: "Kunde inte rensa audit-loggar" });
    }
  });

  app.patch("/api/notifications/read-all", async (req, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ error: "Ej autentiserad" });
      const tenantId = getTenantIdWithFallback(req);
      const count = await storage.markAllUserNotificationsRead(userId, tenantId);
      res.json({ count });
    } catch (error) {
      console.error("Failed to mark all notifications read:", error);
      res.status(500).json({ error: "Kunde inte uppdatera notiser" });
    }
  });

  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const orderResult = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE order_status IN ('utford', 'fakturerad')) AS completed,
          COUNT(*) FILTER (WHERE order_status NOT IN ('utford', 'fakturerad', 'omojlig')) AS pending,
          COUNT(*) FILTER (WHERE order_status = 'omojlig') AS impossible,
          COUNT(*) FILTER (WHERE scheduled_date IS NOT NULL) AS scheduled,
          COALESCE(SUM(cached_value), 0) AS total_value,
          COUNT(*) AS total
        FROM work_orders WHERE tenant_id = ${tenantId}
      `);
      const customerResult = await db.execute(sql`
        SELECT COUNT(*) AS total FROM customers WHERE tenant_id = ${tenantId}
      `);
      const resourceResult = await db.execute(sql`
        SELECT COUNT(*) FILTER (WHERE status = 'active') AS active FROM resources WHERE tenant_id = ${tenantId}
      `);
      const clusterResult = await db.execute(sql`
        SELECT COUNT(*) FILTER (WHERE status = 'active') AS active FROM clusters WHERE tenant_id = ${tenantId}
      `);
      const getRow = (result: any) => {
        const rows = Array.isArray(result) ? result : result?.rows;
        return (Array.isArray(rows) ? rows[0] : result) || {};
      };
      const stats = getRow(orderResult) as Record<string, string | number | null>;
      const custStats = getRow(customerResult) as Record<string, string | number | null>;
      const resStats = getRow(resourceResult) as Record<string, string | number | null>;
      const cluStats = getRow(clusterResult) as Record<string, string | number | null>;
      res.json({
        completedOrders: Number(stats.completed || 0),
        pendingOrders: Number(stats.pending || 0),
        impossibleOrders: Number(stats.impossible || 0),
        scheduledOrders: Number(stats.scheduled || 0),
        totalOrderValue: Number(stats.total_value || 0),
        totalOrders: Number(stats.total || 0),
        activeCustomers: Number(custStats.total || 0),
        activeResources: Number(resStats.active || 0),
        activeClusters: Number(cluStats.active || 0),
      });
    } catch (error) {
      console.error("Failed to fetch dashboard stats:", error);
      res.status(500).json({ error: "Kunde inte hämta dashboard-statistik" });
    }
  });

  app.get("/api/dashboard/alerts", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const startOfToday = new Date(todayStr + "T00:00:00.000Z");
      const endOfToday = new Date(todayStr + "T23:59:59.999Z");

      const overdueResult = await db.execute(sql`
        SELECT id, title, scheduled_date, resource_id, object_id, order_status
        FROM work_orders
        WHERE tenant_id = ${tenantId}
          AND order_status NOT IN ('utford', 'fakturerad', 'omojlig')
          AND scheduled_date IS NOT NULL
          AND scheduled_date < ${startOfToday}
          AND deleted_at IS NULL
        ORDER BY scheduled_date ASC
        LIMIT 20
      `);
      const overdueRows = Array.isArray(overdueResult) ? overdueResult : (overdueResult as any)?.rows || [];

      const activeResources = await storage.getResources(tenantId);
      const activeResourceIds = activeResources.filter(r => r.status === "active").map(r => r.id);

      let idleResources: { id: string; name: string }[] = [];
      if (activeResourceIds.length > 0) {
        const busyResult = await db.execute(sql`
          SELECT DISTINCT resource_id
          FROM work_orders
          WHERE tenant_id = ${tenantId}
            AND resource_id IS NOT NULL
            AND scheduled_date >= ${startOfToday}
            AND scheduled_date <= ${endOfToday}
            AND order_status NOT IN ('utford', 'fakturerad', 'omojlig')
            AND deleted_at IS NULL
        `);
        const busyRows = Array.isArray(busyResult) ? busyResult : (busyResult as any)?.rows || [];
        const busyIds = new Set(
          (busyRows as any[]).map((r: any) => r.resource_id).filter(Boolean)
        );
        idleResources = activeResources
          .filter(r => r.status === "active" && !busyIds.has(r.id))
          .map(r => ({ id: r.id, name: r.name }));
      }

      const collisionResult = await db.execute(sql`
        SELECT a.id AS order_a_id, a.title AS order_a_title,
               a.scheduled_start_time AS start_a, a.estimated_duration AS duration_a,
               b.id AS order_b_id, b.title AS order_b_title,
               b.scheduled_start_time AS start_b, b.estimated_duration AS duration_b,
               a.resource_id, a.scheduled_date
        FROM work_orders a
        JOIN work_orders b ON a.resource_id = b.resource_id
          AND a.tenant_id = b.tenant_id
          AND DATE(a.scheduled_date) = DATE(b.scheduled_date)
          AND a.id < b.id
        WHERE a.tenant_id = ${tenantId}
          AND a.scheduled_date >= ${startOfToday}
          AND a.scheduled_date <= ${endOfToday}
          AND a.scheduled_start_time IS NOT NULL
          AND b.scheduled_start_time IS NOT NULL
          AND a.order_status NOT IN ('utford', 'fakturerad', 'omojlig')
          AND b.order_status NOT IN ('utford', 'fakturerad', 'omojlig')
          AND a.deleted_at IS NULL
          AND b.deleted_at IS NULL
        LIMIT 50
      `);
      const collisionRows = Array.isArray(collisionResult) ? collisionResult : (collisionResult as any)?.rows || [];

      const parseTime = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + (m || 0);
      };
      const collisionList = collisionRows as any[];
      const doubleBookings: any[] = [];
      for (const row of collisionList) {
        if (!row.start_a || !row.start_b) continue;
        const startA = parseTime(row.start_a);
        const endA = startA + (row.duration_a || 60);
        const startB = parseTime(row.start_b);
        const endB = startB + (row.duration_b || 60);
        if (startA < endB && endA > startB) {
          const resource = activeResources.find(r => r.id === row.resource_id);
          doubleBookings.push({
            resourceId: row.resource_id,
            resourceName: resource?.name || "Okänd resurs",
            orderA: { id: row.order_a_id, title: row.order_a_title, startTime: row.start_a },
            orderB: { id: row.order_b_id, title: row.order_b_title, startTime: row.start_b },
          });
        }
      }

      const overdueList = overdueRows as any[];
      const overdueAlerts = overdueList.map((r: any) => ({
        id: r.id,
        title: r.title || `Order ${(r.id || "").slice(0, 8)}`,
        scheduledDate: r.scheduled_date,
        resourceId: r.resource_id,
      }));

      res.json({
        overdue: overdueAlerts,
        idleResources,
        doubleBookings,
        totalAlerts: overdueAlerts.length + idleResources.length + doubleBookings.length,
      });
    } catch (error) {
      console.error("Failed to fetch dashboard alerts:", error);
      res.status(500).json({ error: "Kunde inte hämta varningar" });
    }
  });

  app.get("/api/dashboard/capacity/:dateParam?", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const dateParam = (req.params.dateParam || req.query.date) as string;
      const date = dateParam ? new Date(dateParam) : new Date();
      const dateStr = date.toISOString().split("T")[0];
      const startOfDay = new Date(dateStr + "T00:00:00.000Z");
      const endOfDay = new Date(dateStr + "T23:59:59.999Z");

      const activeResources = await storage.getResources(tenantId);
      const active = activeResources.filter(r => r.status === "active");

      const orderResult = await db.execute(sql`
        SELECT resource_id, 
               COALESCE(SUM(estimated_duration), 0) AS booked_minutes
        FROM work_orders
        WHERE tenant_id = ${tenantId}
          AND scheduled_date >= ${startOfDay}
          AND scheduled_date <= ${endOfDay}
          AND resource_id IS NOT NULL
          AND order_status NOT IN ('omojlig')
          AND deleted_at IS NULL
        GROUP BY resource_id
      `);
      const orderRows = Array.isArray(orderResult) ? orderResult : (orderResult as any)?.rows || [];

      const bookedMap = new Map<string, number>();
      const rowList = orderRows as any[];
      for (const row of rowList) {
        if (row.resource_id) {
          bookedMap.set(row.resource_id, Number(row.booked_minutes || 0));
        }
      }

      const defaultDailyMinutes = 8 * 60;

      const capacity = active.map(r => {
        const dailyMinutes = r.weeklyHours
          ? Math.round((r.weeklyHours / 5) * 60)
          : defaultDailyMinutes;
        const bookedMinutes = bookedMap.get(r.id) || 0;
        const utilization = dailyMinutes > 0
          ? Math.round((bookedMinutes / dailyMinutes) * 100)
          : 0;

        return {
          resourceId: r.id,
          resourceName: r.name,
          bookedMinutes,
          availableMinutes: dailyMinutes,
          utilization,
        };
      });

      res.json({
        date: dateStr,
        resources: capacity,
      });
    } catch (error) {
      console.error("Failed to fetch capacity:", error);
      res.status(500).json({ error: "Kunde inte hämta kapacitetsdata" });
    }
  });

  // Register Go-compat path aliases first so they take precedence for
  // Bearer-token requests over web/admin routes registered below.
  registerMobileAliasRoutes(app);

  registerObjectRoutes(app);
  registerCustomerRoutes(app);
  registerResourceRoutes(app);
  registerWorkOrderRoutes(app);
  registerImportRoutes(app);
  await registerOnboardingRoutes(app);
  registerConfigRoutes(app);
  registerClusterRoutes(app);
  registerAIRoutes(app);
  registerOptimizationRoutes(app);
  const { registerMlRoutes } = await import("./routes/mlRoutes");
  registerMlRoutes(app);
  const { registerRestoreDormantRoutes } = await import("./routes/restoreDormantRoutes");
  registerRestoreDormantRoutes(app);

  const { registerShadowComparisonRoutes } = await import("./routes/shadowComparisonRoutes");
  registerShadowComparisonRoutes(app);
  registerMobileRoutes(app);
  registerRealtimeTestRoutes(app);
  registerPlannerRoutes(app);
  registerKPIRoutes(app);
  registerResendWebhookRoutes(app);
  const { registerPlatformAdminRoutes } = await import("./routes/platformAdminRoutes");
  registerPlatformAdminRoutes(app);
  await registerFortnoxRoutes(app);
  registerOrderConceptRoutes(app);
  registerPortalRoutes(app);
  registerExtendedRoutes(app);
  registerIoTRoutes(app);
  registerAnnualGoalRoutes(app);
  registerPredictiveRoutes(app);
  registerRoiRoutes(app);
  registerFeatureRoutes(app);
  registerDisruptionRoutes(app);
  registerFeedbackLoopRoutes(app);
  registerETANotificationRoutes(app);
  registerUrgentJobRoutes(app);
  registerSlaRiskRoutes(app);
  registerCapacityForecastRoutes(app);
  registerProdHealthCheckRoutes(app);

  app.post("/api/route-geometry", async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      const { waypoints } = req.body;
      if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
        return res.status(400).json({ error: "Minst 2 waypoints krävs" });
      }

      if (waypoints.length > 25) {
        return res.status(400).json({ error: "Max 25 waypoints" });
      }

      const { getRouteGeometry, isGeoapifyRoutingAvailable } = await import("./services/routing");
      if (!isGeoapifyRoutingAvailable()) {
        return res.status(500).json({ error: "Geoapify API-nyckel saknas" });
      }

      const result = await getRouteGeometry(
        waypoints.map((wp: { lat: number; lng: number }) => ({ lat: wp.lat, lng: wp.lng })),
      );
      if (!result) {
        return res.status(502).json({ error: "Geoapify routing-fel" });
      }
      res.json({ coordinates: result.coordinates });
    } catch (error) {
      console.error("[route-geometry] Error:", error);
      res.status(500).json({ error: "Kunde inte hämta ruttgeometri" });
    }
  });

  app.use((err: unknown, _req: ExpressRequest, res: ExpressResponse, _next: unknown) => {
    if (res.headersSent) return;

    if (err instanceof z.ZodError) {
      return res.status(400).json(formatZodError(err));
    }

    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }

    console.error("[global-error]", err);
    const message = err instanceof Error ? err.message : "Ett oväntat serverfel uppstod";
    const status = (err as Record<string, number>)?.status || 500;
    res.status(status).json({ error: message });
  });

  return httpServer;
}
