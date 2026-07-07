import type { Express, Request as ExpressRequest, Response as ExpressResponse } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { registerMagicLinkRoutes } from "./replit_integrations/auth/magicLinkAuth";
import { registerInvitationsRoutes } from "./routes/invitationsRoutes";
import { registerRouteGeometryRoutes } from "./routes/routeGeometryRoutes";
import { requireTenantWithFallback, getTenantIdWithFallback, getUserTenants, requireAdmin } from "./tenant-middleware";
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
import { carryOverNotificationScheduler } from "./services/carry-over-notification-scheduler";
import { prodHealthCheckScheduler } from "./services/prod-health-check-scheduler";
import { registerProdHealthCheckRoutes } from "./routes/prodHealthCheckRoutes";
import { githubMirrorScheduler } from "./services/github-mirror-scheduler";
import { invoiceConsolidationScheduler } from "./services/invoice-consolidation-scheduler";
import { orderConceptAutoRunScheduler, runDueConceptsForTenant } from "./services/order-concept-auto-runner";
import { registerInvoiceQueueRoutes } from "./routes/invoiceQueueRoutes";
import { registerGithubMirrorRoutes } from "./routes/githubMirrorRoutes";
import { startWeeklyReportScheduler } from "./weekly-report";
import { metadataRouter } from "./metadata-routes";
import { DEFAULT_TENANT_ID } from "./routes/helpers";

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
import { runTimeGeoEngine } from "./services/time-geo-engine";
import { registerMobileRoutes, registerMobileAliasRoutes } from "./routes/mobile";
import { registerPlannerRoutes } from "./routes/plannerRoutes";
import { registerWeeklyPlanRoutes } from "./routes/weeklyPlanRoutes";
import { registerKPIRoutes } from "./routes/kpiRoutes";
import { registerFortnoxRoutes } from "./routes/fortnoxRoutes";
import { registerOrderConceptRoutes } from "./routes/orderConceptRoutes";
import { registerPortalRoutes } from "./routes/portalRoutes";
import { registerExtendedRoutes } from "./routes/extendedRoutes";
import { registerIntegrationsHealthRoutes } from "./routes/integrationsHealthRoutes";
import { startIntegrationsHealthScheduler } from "./services/external-service-health";
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
import { registerTelinkRoutes } from "./routes/telinkRoutes";
import { telinkSyncScheduler } from "./services/telink-sync-scheduler";

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
  carryOverNotificationScheduler.start();
  capacityForecastScheduler.start();
  prodHealthCheckScheduler.start();
  githubMirrorScheduler.start();

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
    if (req.path.startsWith("/public/") || req.path.startsWith("/portal") || req.path.startsWith("/mobile") || req.path.startsWith("/admin") || req.path.startsWith("/platform") || req.path.startsWith("/auth") || req.path.startsWith("/webhooks/") || (req.path === "/iot/signals" && req.method === "POST")) {
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

  // Task #521: Per-användar opt-in/opt-out för in-app-notistyper. Default ON
  // (notisen levereras om ingen rad finns). Endast inloggad användare läser/sätter
  // sitt eget preference.
  app.get("/api/notifications/preferences", async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ error: "Ej autentiserad" });
      const tenantId = getTenantIdWithFallback(req);
      const prefs = await storage.getUserNotificationPreferences(userId, tenantId);
      res.json({ preferences: prefs });
    } catch (error) {
      console.error("Failed to fetch notification preferences:", error);
      res.status(500).json({ error: "Kunde inte hämta notisinställningar" });
    }
  });

  app.put("/api/notifications/preferences/:type", async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) return res.status(401).json({ error: "Ej autentiserad" });
      const tenantId = getTenantIdWithFallback(req);
      const type = String(req.params.type || "").trim();
      if (!type) return res.status(400).json({ error: "type krävs" });
      const enabled = req.body?.enabled !== false; // default true om saknas
      const row = await storage.setUserNotificationPreference(tenantId, userId, type, enabled);
      res.json(row);
    } catch (error) {
      console.error("Failed to set notification preference:", error);
      res.status(500).json({ error: "Kunde inte spara notisinställning" });
    }
  });

  // Task #521: Manuell trigger för carry-over-notis. Tenant-scoped path så
  // `requireTenantWithFallback` (/api-middleware ovan) resolverar tenant från
  // session, och `requireAdmin` kollar tenant-rollen via user_tenant_roles
  // (inte legacy globala users.role). Default dryRun=true så produktion inte
  // spammar i misstag — sätt body.dryRun=false för att faktiskt skicka.
  app.post("/api/carry-over/run", requireAdmin, async (req: any, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const dryRun = req.body?.dryRun !== false;
      const summary = await carryOverNotificationScheduler.runManual(tenantId, { dryRun });
      res.json({ dryRun, summary });
    } catch (error) {
      console.error("Failed to run carry-over notification:", error);
      res.status(500).json({ error: "Kunde inte köra carry-over-notis" });
    }
  });

  // Task #996: Manuell trigger för auto-körning av abonnemang/schema-koncept.
  // Tenant-scoped path (requireTenantWithFallback resolverar tenant, requireAdmin
  // kollar tenant-rollen). Kör samma väg som bakgrundsschemaläggaren men bara för
  // den inloggades tenant — för verifiering/manuell körning.
  app.post("/api/order-concepts/auto-run", requireAdmin, async (req: any, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const result = await runDueConceptsForTenant(tenantId, { now: new Date() });
      res.json({ success: true, result });
    } catch (error) {
      console.error("Failed to run order-concept auto-run:", error);
      res.status(500).json({ error: "Kunde inte köra automatisk koncept-körning" });
    }
  });

  // Task #1038: Manuell körning av Tids- & geografimotorn för en vald period/
  // horisont. requireAdmin (tenant-roll). Ingen UI här (separat nedströms-uppgift)
  // — detta är den körbara funktionens server-exponering. Default-period = idag
  // → +14 dagar om body saknar datum.
  app.post("/api/time-geo-engine/run", requireAdmin, async (req: any, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const body = req.body ?? {};
      const now = new Date();
      const periodStart = body.periodStart ? new Date(body.periodStart) : now;
      const periodEnd = body.periodEnd
        ? new Date(body.periodEnd)
        : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
        return res.status(400).json({ error: "Ogiltigt periodStart/periodEnd-datum" });
      }
      const result = await runTimeGeoEngine(tenantId, {
        periodStart,
        periodEnd,
        groupingRadiusMeters:
          typeof body.groupingRadiusMeters === "number" ? body.groupingRadiusMeters : undefined,
        dailyCapacityMinutes:
          typeof body.dailyCapacityMinutes === "number" ? body.dailyCapacityMinutes : undefined,
        maxAssignments: typeof body.maxAssignments === "number" ? body.maxAssignments : undefined,
        now,
      });
      res.json({ success: true, result });
    } catch (error) {
      console.error("Failed to run time-geo engine:", error);
      res.status(500).json({ error: "Kunde inte köra tids- & geografimotorn" });
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

  // Register Go-compat path aliases first so they take precedence for
  // Bearer-token requests over web/admin routes registered below.
  registerMobileAliasRoutes(app);

  registerObjectRoutes(app);
  // Task #552: objekt-livscykel v2 (släktnamn, arkivering, dynamiska kluster)
  const { registerObjectLifecycleRoutes } = await import("./routes/objectLifecycleRoutes");
  registerObjectLifecycleRoutes(app);
  // Task #716: admin-arkiv (arkiverade objekt/ordrar/bilder/kontakter/metadatatyper + återställning)
  const { registerArchiveRoutes } = await import("./routes/archiveRoutes");
  registerArchiveRoutes(app);
  const { registerImportPayersRoutes } = await import("./routes/importPayersRoutes");
  registerImportPayersRoutes(app);
  registerCustomerRoutes(app);
  registerResourceRoutes(app);
  registerWorkOrderRoutes(app);
  registerImportRoutes(app);
  // Task #578: tre-stegs import-wizard (Organisation → Butiker → Fysiska objekt)
  const { registerImportWizardRoutes } = await import("./routes/importWizardRoutes");
  registerImportWizardRoutes(app);
  // Task #603: Excel-mall objektimport (multi-flik upload + dry-run + commit)
  const { registerObjektmallImportRoutes } = await import("./routes/objektmallImportRoutes");
  registerObjektmallImportRoutes(app);
  // Import 2.0: session-baserat 5-stegsflöde (Upload → Preview → Map → Validate → Build)
  const { registerObjectImportV2Routes } = await import("./routes/objectImportV2Routes");
  registerObjectImportV2Routes(app);
  // Ångra-funktion: rulla tillbaka senaste ångringsbara import-batchen (requireAdmin)
  const { registerImportUndoRoutes } = await import("./routes/importUndoRoutes");
  registerImportUndoRoutes(app);
  const { registerOrderTypeMetadataRoutes } = await import("./routes/orderTypeMetadataRoutes");
  registerOrderTypeMetadataRoutes(app);
  await registerOnboardingRoutes(app);
  registerConfigRoutes(app);
  const { registerSession11Routes } = await import("./routes/session11Routes");
  await registerSession11Routes(app);
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
  registerWeeklyPlanRoutes(app);
  registerKPIRoutes(app);
  registerResendWebhookRoutes(app);
  const { registerPlatformAdminRoutes } = await import("./routes/platformAdminRoutes");
  registerPlatformAdminRoutes(app);
  await registerFortnoxRoutes(app);
  registerOrderConceptRoutes(app);
  registerPortalRoutes(app);
  registerExtendedRoutes(app);
  const { registerMetadataEditorRoutes } = await import("./routes/metadataEditorRoutes");
  registerMetadataEditorRoutes(app);
  registerIntegrationsHealthRoutes(app);
  startIntegrationsHealthScheduler();
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
  registerGithubMirrorRoutes(app);
  // Task #558: Fakturakö + konsoliderings-policy
  registerInvoiceQueueRoutes(app);
  invoiceConsolidationScheduler.start();

  // Task #996: Auto-körning av abonnemang/schema-orderkoncept (env-gated)
  orderConceptAutoRunScheduler.start();

  // Task #582: Telink-koppling + auto-ärende vid kontaktbyte
  registerTelinkRoutes(app);
  telinkSyncScheduler.start();

  registerRouteGeometryRoutes(app);

  // Global error-middleware registreras i server/index.ts (errorHandler) efter
  // att alla routes är monterade — den hanterar AppError, ZodError och okända fel
  // med strukturerad JSON-respons inkl. code/message/details/requestId.

  return httpServer;
}
