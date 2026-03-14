import type { Express, Request as ExpressRequest, Response as ExpressResponse } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { requireTenantWithFallback, getTenantIdWithFallback, getUserTenants } from "./tenant-middleware";
import { notificationService } from "./notifications";
import { handleMcpSse, handleMcpMessage } from "./mcp";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { anomalyMonitor } from "./anomaly-monitor";
import { startWeeklyReportScheduler } from "./weekly-report";
import { metadataRouter } from "./metadata-routes";
import { formatZodError, DEFAULT_TENANT_ID } from "./routes/helpers";

import { registerCustomerRoutes } from "./routes/customerRoutes";
import { registerObjectRoutes } from "./routes/objectRoutes";
import { registerResourceRoutes } from "./routes/resourceRoutes";
import { registerWorkOrderRoutes } from "./routes/workOrderRoutes";
import { registerImportRoutes } from "./routes/importRoutes";
import { registerConfigRoutes } from "./routes/configRoutes";
import { registerClusterRoutes } from "./routes/clusterRoutes";
import { registerAIRoutes } from "./routes/aiRoutes";
import { registerMobileRoutes } from "./routes/mobileRoutes";
import { registerPlannerRoutes } from "./routes/plannerRoutes";
import { registerKPIRoutes } from "./routes/kpiRoutes";
import { registerFortnoxRoutes } from "./routes/fortnoxRoutes";
import { registerOrderConceptRoutes } from "./routes/orderConceptRoutes";
import { registerPortalRoutes } from "./routes/portalRoutes";
import { registerExtendedRoutes } from "./routes/extendedRoutes";
import { registerIoTRoutes } from "./routes/iotRoutes";

async function ensureDefaultTenant() {
  return storage.ensureTenant(DEFAULT_TENANT_ID, {
    name: "Traivo",
    orgNumber: "556789-1234",
    contactEmail: "info@traivo.se",
    contactPhone: "+46701234567",
    settings: {},
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  notificationService.initialize(httpServer);
  anomalyMonitor.start();
  startWeeklyReportScheduler();
  
  await setupAuth(app);
  registerAuthRoutes(app);
  
  await ensureDefaultTenant();

  app.get("/api/me/tenant", async (req, res) => {
    try {
      const user = req.user as any;
      if (!user?.claims?.sub) {
        return res.json({ tenantId: "default-tenant", role: "user", tenants: [] });
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
      res.status(500).json({ error: "Failed to fetch tenant info" });
    }
  });

  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/portal") || req.path.startsWith("/mobile") || req.path.startsWith("/planner") || req.path.startsWith("/admin") || req.path.startsWith("/auth") || (req.path === "/iot/signals" && req.method === "POST")) {
      return next();
    }
    return requireTenantWithFallback(req, res, next);
  });

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

  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const [orderStats] = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE order_status IN ('utford', 'fakturerad')) AS completed,
          COUNT(*) FILTER (WHERE order_status NOT IN ('utford', 'fakturerad', 'omojlig')) AS pending,
          COUNT(*) FILTER (WHERE order_status = 'omojlig') AS impossible,
          COUNT(*) FILTER (WHERE scheduled_date IS NOT NULL) AS scheduled,
          COALESCE(SUM(cached_value), 0) AS total_value,
          COUNT(*) AS total
        FROM work_orders WHERE tenant_id = ${tenantId}
      `);
      const [customerStats] = await db.execute(sql`
        SELECT COUNT(*) AS total FROM customers WHERE tenant_id = ${tenantId}
      `);
      const [resourceStats] = await db.execute(sql`
        SELECT COUNT(*) FILTER (WHERE status = 'active') AS active FROM resources WHERE tenant_id = ${tenantId}
      `);
      const [clusterStats] = await db.execute(sql`
        SELECT COUNT(*) FILTER (WHERE status = 'active') AS active FROM clusters WHERE tenant_id = ${tenantId}
      `);
      const stats = orderStats as Record<string, any>;
      res.json({
        completedOrders: Number(stats.completed || 0),
        pendingOrders: Number(stats.pending || 0),
        impossibleOrders: Number(stats.impossible || 0),
        scheduledOrders: Number(stats.scheduled || 0),
        totalOrderValue: Number(stats.total_value || 0),
        totalOrders: Number(stats.total || 0),
        activeCustomers: Number((customerStats as any).total || 0),
        activeResources: Number((resourceStats as any).active || 0),
        activeClusters: Number((clusterStats as any).active || 0),
      });
    } catch (error) {
      console.error("Failed to fetch dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  registerCustomerRoutes(app);
  registerObjectRoutes(app);
  registerResourceRoutes(app);
  registerWorkOrderRoutes(app);
  registerImportRoutes(app);
  registerConfigRoutes(app);
  registerClusterRoutes(app);
  registerAIRoutes(app);
  registerMobileRoutes(app);
  registerPlannerRoutes(app);
  registerKPIRoutes(app);
  registerFortnoxRoutes(app);
  registerOrderConceptRoutes(app);
  registerPortalRoutes(app);
  registerExtendedRoutes(app);
  registerIoTRoutes(app);

  app.use((err: any, _req: ExpressRequest, res: ExpressResponse, _next: any) => {
    console.error("[global-error]", err);
    if (err instanceof z.ZodError) {
      return res.status(400).json(formatZodError(err));
    }
    const message = err.message || "Ett oväntat serverfel uppstod";
    res.status(err.status || 500).json({ error: message });
  });

  return httpServer;
}
