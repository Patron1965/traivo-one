import type { Express, Request as ExpressRequest, Response as ExpressResponse } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { requireTenantWithFallback, getTenantIdWithFallback, getUserTenants } from "./tenant-middleware";
import { moduleGuardMiddleware } from "./feature-flags";
import { notificationService } from "./notifications";
import { handleMcpSse, handleMcpMessage } from "./mcp";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { anomalyMonitor } from "./anomaly-monitor";
import { predictiveScheduler } from "./routes/predictiveRoutes";
import { startWeeklyReportScheduler } from "./weekly-report";
import { metadataRouter } from "./metadata-routes";
import { formatZodError, DEFAULT_TENANT_ID } from "./routes/helpers";
import { AppError } from "./errors";

import { registerCustomerRoutes } from "./routes/customerRoutes";
import { registerObjectRoutes } from "./routes/objectRoutes";
import { registerResourceRoutes } from "./routes/resourceRoutes";
import { registerWorkOrderRoutes } from "./routes/workOrderRoutes";
import { registerImportRoutes } from "./routes/importRoutes";
import { registerConfigRoutes } from "./routes/configRoutes";
import { registerClusterRoutes } from "./routes/clusterRoutes";
import { registerAIRoutes } from "./routes/aiRoutes";
import { registerMobileRoutes } from "./routes/mobile";
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
  predictiveScheduler.start();
  
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
      const stats = orderStats as Record<string, string | number | null>;
      const custStats = customerStats as Record<string, string | number | null>;
      const resStats = resourceStats as Record<string, string | number | null>;
      const cluStats = clusterStats as Record<string, string | number | null>;
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
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  app.get("/api/dashboard/alerts", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const startOfToday = new Date(todayStr + "T00:00:00.000Z");
      const endOfToday = new Date(todayStr + "T23:59:59.999Z");

      const [overdueRows] = await db.execute(sql`
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

      const activeResources = await storage.getResources(tenantId);
      const activeResourceIds = activeResources.filter(r => r.status === "active").map(r => r.id);

      let idleResources: { id: string; name: string }[] = [];
      if (activeResourceIds.length > 0) {
        const [busyRows] = await db.execute(sql`
          SELECT DISTINCT resource_id
          FROM work_orders
          WHERE tenant_id = ${tenantId}
            AND resource_id IS NOT NULL
            AND scheduled_date >= ${startOfToday}
            AND scheduled_date <= ${endOfToday}
            AND order_status NOT IN ('utford', 'fakturerad', 'omojlig')
            AND deleted_at IS NULL
        `);
        const busyIds = new Set(
          Array.isArray(busyRows)
            ? (busyRows as any[]).map((r: any) => r.resource_id)
            : [(busyRows as any)?.resource_id].filter(Boolean)
        );
        idleResources = activeResources
          .filter(r => r.status === "active" && !busyIds.has(r.id))
          .map(r => ({ id: r.id, name: r.name }));
      }

      const [collisionRows] = await db.execute(sql`
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

      const parseTime = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + (m || 0);
      };
      const collisionList = Array.isArray(collisionRows) ? collisionRows as any[] : collisionRows ? [collisionRows] : [];
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

      const overdueList = Array.isArray(overdueRows) ? overdueRows as any[] : overdueRows ? [overdueRows] : [];
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
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  app.get("/api/dashboard/capacity", async (req, res) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const dateParam = req.query.date as string;
      const date = dateParam ? new Date(dateParam) : new Date();
      const dateStr = date.toISOString().split("T")[0];
      const startOfDay = new Date(dateStr + "T00:00:00.000Z");
      const endOfDay = new Date(dateStr + "T23:59:59.999Z");

      const activeResources = await storage.getResources(tenantId);
      const active = activeResources.filter(r => r.status === "active");

      const [orderRows] = await db.execute(sql`
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

      const bookedMap = new Map<string, number>();
      const rowList = Array.isArray(orderRows) ? orderRows as any[] : orderRows ? [orderRows] : [];
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
      res.status(500).json({ error: "Failed to fetch capacity" });
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
  registerAnnualGoalRoutes(app);
  registerPredictiveRoutes(app);
  registerRoiRoutes(app);
  registerFeatureRoutes(app);
  registerDisruptionRoutes(app);
  registerFeedbackLoopRoutes(app);
  registerETANotificationRoutes(app);

  app.use((err: any, _req: ExpressRequest, res: ExpressResponse, _next: any) => {
    if (err instanceof z.ZodError) {
      return res.status(400).json(formatZodError(err));
    }

    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }

    console.error("[global-error]", err);
    const message = err.message || "Ett oväntat serverfel uppstod";
    res.status(err.status || 500).json({ error: message });
  });

  return httpServer;
}
