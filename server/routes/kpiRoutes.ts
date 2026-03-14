import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { requireAdmin } from "../tenant-middleware";
import { objects, workOrders, apiUsageLogs, apiBudgets, insertMetadataDefinitionSchema, insertObjectMetadataSchema, insertObjectPayerSchema } from "@shared/schema";
import { getISOWeek, getStartOfISOWeek } from "./helpers";
import { sendEmail } from "../replit_integrations/resend";

export async function registerKPIRoutes(app: Express) {
// ============================================
// KPI / ANALYTICS ENDPOINTS
// ============================================

app.get("/api/kpis/daily", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const dateParam = req.query.date as string;
    const date = dateParam ? new Date(dateParam) : new Date();
    
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const orders = await storage.getWorkOrdersByDate(tenantId, date);
    const resources = await storage.getResources(tenantId);

    const completed = orders.filter(o => 
      o.completedAt || o.status === "completed" || o.executionStatus === "completed"
    );
    const remaining = orders.filter(o => 
      !o.completedAt && o.status !== "completed" && o.executionStatus !== "completed"
    );

    const durationsMinutes = completed
      .map(o => o.actualDuration || o.estimatedDuration || 0)
      .filter(d => d > 0);
    const avgTimePerTask = durationsMinutes.length > 0
      ? Math.round(durationsMinutes.reduce((a, b) => a + b, 0) / durationsMinutes.length)
      : 0;

    const activeResources = resources.filter(r => 
      orders.some(o => o.resourceId === r.id)
    );

    const resourceKpis = activeResources.map(r => {
      const resourceOrders = orders.filter(o => o.resourceId === r.id);
      const resourceCompleted = resourceOrders.filter(o => 
        o.completedAt || o.status === "completed" || o.executionStatus === "completed"
      );
      const resourceDurations = resourceCompleted
        .map(o => o.actualDuration || o.estimatedDuration || 0)
        .filter(d => d > 0);
      return {
        resourceId: r.id,
        resourceName: r.name,
        totalTasks: resourceOrders.length,
        completedTasks: resourceCompleted.length,
        remainingTasks: resourceOrders.length - resourceCompleted.length,
        avgTimeMinutes: resourceDurations.length > 0
          ? Math.round(resourceDurations.reduce((a, b) => a + b, 0) / resourceDurations.length)
          : 0,
      };
    });

    res.json({
      date: date.toISOString().split("T")[0],
      totalTasks: orders.length,
      completedTasks: completed.length,
      remainingTasks: remaining.length,
      completionRate: orders.length > 0 ? Math.round((completed.length / orders.length) * 100) : 0,
      avgTimePerTaskMinutes: avgTimePerTask,
      activeResources: activeResources.length,
      resourceKpis,
    });
  } catch (error) {
    console.error("Failed to compute daily KPIs:", error);
    res.status(500).json({ error: "Failed to compute KPIs" });
  }
});

app.get("/api/kpis/weekly", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const weekParam = req.query.week as string;
    
    let startOfWeek: Date;
    if (weekParam) {
      startOfWeek = new Date(weekParam);
    } else {
      startOfWeek = new Date();
      const day = startOfWeek.getDay();
      const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
      startOfWeek.setDate(diff);
    }
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const prevStart = new Date(startOfWeek);
    prevStart.setDate(prevStart.getDate() - 7);
    const prevEnd = new Date(startOfWeek);
    prevEnd.setMilliseconds(-1);

    const thisWeekOrders = await storage.getWorkOrders(tenantId, startOfWeek, endOfWeek, true);
    const prevWeekOrders = await storage.getWorkOrders(tenantId, prevStart, prevEnd, true);
    const thisWeek = thisWeekOrders;
    const prevWeek = prevWeekOrders;

    const calcStats = (orders: typeof thisWeek) => {
      const completed = orders.filter(o => o.completedAt || o.status === "completed" || o.executionStatus === "completed");
      const durations = completed.map(o => o.actualDuration || o.estimatedDuration || 0).filter(d => d > 0);
      return {
        totalTasks: orders.length,
        completedTasks: completed.length,
        completionRate: orders.length > 0 ? Math.round((completed.length / orders.length) * 100) : 0,
        avgTimeMinutes: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      };
    };

    const current = calcStats(thisWeek);
    const previous = calcStats(prevWeek);

    res.json({
      weekStart: startOfWeek.toISOString().split("T")[0],
      weekEnd: endOfWeek.toISOString().split("T")[0],
      current,
      previous,
      trends: {
        tasksDelta: current.totalTasks - previous.totalTasks,
        completionRateDelta: current.completionRate - previous.completionRate,
        avgTimeDelta: current.avgTimeMinutes - previous.avgTimeMinutes,
      },
    });
  } catch (error) {
    console.error("Failed to compute weekly KPIs:", error);
    res.status(500).json({ error: "Failed to compute weekly KPIs" });
  }
});

app.post("/api/system/weekly-report/trigger", requireAdmin, async (req, res) => {
  try {
    const result = await generateAndSendWeeklyReports();
    res.json(result);
  } catch (error) {
    console.error("Failed to trigger weekly report:", error);
    res.status(500).json({ error: "Failed to send weekly reports" });
  }
});

// ============================================
// ANOMALY MONITORING API ENDPOINTS
// ============================================

// Manually trigger anomaly check and get results
app.get("/api/system/anomalies/check", async (req, res) => {
  try {
    const alerts = await anomalyMonitor.runManualCheck();
    res.json({
      timestamp: new Date().toISOString(),
      alertCount: alerts.length,
      alerts: alerts
    });
  } catch (error) {
    console.error("Failed to run anomaly check:", error);
    res.status(500).json({ error: "Failed to run anomaly check" });
  }
});

// ============================================
// SYSTEM DASHBOARD API ENDPOINTS
// ============================================

// Branding Templates - List all
app.get("/api/system/branding-templates", async (req, res) => {
  try {
    const templates = await storage.getBrandingTemplates();
    res.json(templates);
  } catch (error) {
    console.error("Failed to fetch branding templates:", error);
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

// Branding Templates - Get by ID
app.get("/api/system/branding-templates/:id", async (req, res) => {
  try {
    const template = await storage.getBrandingTemplate(req.params.id);
    if (!template) return res.status(404).json({ error: "Template not found" });
    res.json(template);
  } catch (error) {
    console.error("Failed to fetch branding template:", error);
    res.status(500).json({ error: "Failed to fetch template" });
  }
});

// Branding Templates - Get by slug
app.get("/api/system/branding-templates/slug/:slug", async (req, res) => {
  try {
    const template = await storage.getBrandingTemplateBySlug(req.params.slug);
    if (!template) return res.status(404).json({ error: "Template not found" });
    res.json(template);
  } catch (error) {
    console.error("Failed to fetch branding template:", error);
    res.status(500).json({ error: "Failed to fetch template" });
  }
});

// Tenant Branding - Get current tenant branding
app.get("/api/system/map-config", (_req, res) => {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (apiKey) {
    res.json({
      tileUrl: `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${apiKey}`,
      attribution: '&copy; <a href="https://www.geoapify.com/">Geoapify</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
  } else {
    res.json({
      tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
  }
});

app.get("/api/system/tenant-branding", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const branding = await storage.getTenantBranding(tenantId);
    res.json(branding || null);
  } catch (error) {
    console.error("Failed to fetch tenant branding:", error);
    res.status(500).json({ error: "Failed to fetch branding" });
  }
});

// Tenant Branding - Update or create branding
app.put("/api/system/tenant-branding", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { templateId, ...brandingData } = req.body;
    
    let existing = await storage.getTenantBranding(tenantId);
    
    // If using a template, fetch and merge template colors
    if (templateId) {
      const template = await storage.getBrandingTemplate(templateId);
      if (template) {
        brandingData.templateId = templateId;
        brandingData.primaryColor = brandingData.primaryColor || template.primaryColor;
        brandingData.primaryLight = brandingData.primaryLight || template.primaryLight;
        brandingData.primaryDark = brandingData.primaryDark || template.primaryDark;
        brandingData.secondaryColor = brandingData.secondaryColor || template.secondaryColor;
        brandingData.accentColor = brandingData.accentColor || template.accentColor;
        brandingData.successColor = brandingData.successColor || template.successColor;
        brandingData.errorColor = brandingData.errorColor || template.errorColor;
        
        // Increment template usage
        await storage.incrementTemplateUsage(templateId);
      }
    }
    
    let result;
    if (existing) {
      result = await storage.updateTenantBranding(tenantId, brandingData);
    } else {
      result = await storage.createTenantBranding({ 
        tenantId, 
        ...brandingData 
      });
    }
    
    // Create audit log
    await storage.createAuditLog({
      tenantId,
      action: existing ? "update_branding" : "create_branding",
      resourceType: "tenant_branding",
      resourceId: result?.id,
      changes: brandingData,
    });
    
    res.json(result);
  } catch (error) {
    console.error("Failed to update tenant branding:", error);
    res.status(500).json({ error: "Failed to update branding" });
  }
});

// Tenant Branding - Publish branding (admin only)
app.post("/api/system/tenant-branding/publish", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const result = await storage.publishTenantBranding(tenantId);
    
    if (!result) {
      return res.status(404).json({ error: "Branding not found" });
    }
    
    await storage.createAuditLog({
      tenantId,
      action: "publish_branding",
      resourceType: "tenant_branding",
      resourceId: result.id,
    });
    
    res.json(result);
  } catch (error) {
    console.error("Failed to publish branding:", error);
    res.status(500).json({ error: "Failed to publish branding" });
  }
});

// SMS Configuration - Get current SMS settings (admin only)
app.get("/api/system/sms-config", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    
    res.json({
      smsEnabled: tenant.smsEnabled ?? false,
      smsProvider: tenant.smsProvider ?? "none",
      smsFromName: tenant.smsFromName ?? tenant.name ?? "",
    });
  } catch (error) {
    console.error("Failed to get SMS config:", error);
    res.status(500).json({ error: "Failed to get SMS configuration" });
  }
});

// SMS Configuration - Update SMS settings (admin only)
const smsConfigSchema = z.object({
  smsEnabled: z.boolean().optional(),
  smsProvider: z.enum(["twilio", "46elks", "none"]).optional(),
  smsFromName: z.string().max(100).optional(),
});

app.put("/api/system/sms-config", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    
    const parseResult = smsConfigSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Invalid request data", details: parseResult.error.flatten() });
    }
    
    const tenant = await storage.updateTenantSmsSettings(tenantId, parseResult.data);
    
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    
    await storage.createAuditLog({
      tenantId,
      action: "update_sms_config",
      resourceType: "tenant",
      resourceId: tenantId,
      data: parseResult.data,
    });
    
    res.json({
      smsEnabled: tenant.smsEnabled ?? false,
      smsProvider: tenant.smsProvider ?? "none",
      smsFromName: tenant.smsFromName ?? "",
    });
  } catch (error) {
    console.error("Failed to update SMS config:", error);
    res.status(500).json({ error: "Failed to update SMS configuration" });
  }
});

// SMS Configuration - Test SMS sending (admin only)
app.post("/api/system/sms-config/test", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number is required" });
    }
    
    const tenant = await storage.getTenant(tenantId);
    if (!tenant?.smsEnabled) {
      return res.status(400).json({ error: "SMS is not enabled for this tenant" });
    }
    
    const { sendNotification } = await import("./unified-notifications");
    const result = await sendNotification({
      tenantId,
      recipients: [{ phone: phoneNumber, name: "Test" }],
      notificationType: "reminder",
      channel: "sms",
      data: {
        objectAddress: "Testadress 123",
        scheduledDate: "idag",
        scheduledTime: "10:00",
      },
    });
    
    if (result.success && result.smsSent > 0) {
      res.json({ success: true, message: "Test-SMS skickat!" });
    } else {
      res.status(500).json({ success: false, error: result.errors.join(", ") || "Failed to send test SMS" });
    }
  } catch (error: any) {
    console.error("Failed to send test SMS:", error);
    res.status(500).json({ error: error.message || "Failed to send test SMS" });
  }
});

// User Tenant Roles - List all users with roles for current tenant (admin only)
app.get("/api/system/user-roles", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const roles = await storage.getUserTenantRoles(tenantId);
    res.json(roles);
  } catch (error) {
    console.error("Failed to fetch user roles:", error);
    res.status(500).json({ error: "Failed to fetch user roles" });
  }
});

// User Tenant Roles - Create new user role (admin only)
app.post("/api/system/user-roles", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const { userId, name, role, permissions, password } = req.body;
    
    if (!userId || !role) {
      return res.status(400).json({ error: "userId and role are required" });
    }
    
    // Check if user already has a role
    const existing = await storage.getUserTenantRole(userId, tenantId);
    if (existing) {
      return res.status(400).json({ error: "User already has a role in this tenant" });
    }
    
    // Create or update user record with password if provided
    const email = userId.startsWith("email:") ? userId.replace("email:", "") : null;
    if (email) {
      const passwordHash = password ? hashPassword(password) : undefined;
      const [firstName, ...lastNameParts] = (name || "").split(" ");
      await storage.upsertUser({
        id: userId,
        email,
        firstName: firstName || null,
        lastName: lastNameParts.join(" ") || null,
        passwordHash,
      });
    }
    
    const result = await storage.createUserTenantRole({
      userId,
      tenantId,
      role,
      permissions: permissions || [],
      isActive: true,
    });
    
    await storage.createAuditLog({
      tenantId,
      action: "create_user_role",
      resourceType: "user_tenant_roles",
      resourceId: result.id,
      changes: { userId, role, permissions, hasPassword: !!password },
    });
    
    res.status(201).json(result);
  } catch (error) {
    console.error("Failed to create user role:", error);
    res.status(500).json({ error: "Failed to create user role" });
  }
});

// User Tenant Roles - Update role (admin only)
app.patch("/api/system/user-roles/:id", requireAdmin, async (req, res) => {
  try {
    const { role, permissions, isActive, password } = req.body;
    
    const result = await storage.updateUserTenantRole(req.params.id, {
      role,
      permissions,
      isActive,
    });
    
    if (!result) {
      return res.status(404).json({ error: "User role not found" });
    }
    
    // Update password if provided
    if (password && result.userId) {
      const email = result.userId.startsWith("email:") ? result.userId.replace("email:", "") : null;
      if (email) {
        const passwordHash = hashPassword(password);
        await storage.upsertUser({
          id: result.userId,
          email,
          passwordHash,
        });
      }
    }
    
    const tenantId = getTenantIdWithFallback(req);
    await storage.createAuditLog({
      tenantId,
      action: "update_user_role",
      resourceType: "user_tenant_roles",
      resourceId: result.id,
      changes: { role, permissions, isActive, passwordChanged: !!password },
    });
    
    res.json(result);
  } catch (error) {
    console.error("Failed to update user role:", error);
    res.status(500).json({ error: "Failed to update user role" });
  }
});

// User Tenant Roles - Import users from CSV data
app.post("/api/system/user-roles/import", requireAdmin, async (req, res) => {
  try {
    const { users } = req.body;
    
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: "No users provided" });
    }
    
    let imported = 0;
    let skipped = 0;
    
    for (const user of users) {
      if (!user.email) {
        skipped++;
        continue;
      }
      
      const userId = `email:${user.email}`;
      const tenantId = getTenantIdWithFallback(req);
      
      // Check if user already has a role
      const existing = await storage.getUserTenantRole(userId, tenantId);
      if (existing) {
        skipped++;
        continue;
      }
      
      // Map role names (Swedish to English) - handle whitespace and case variations
      let role = user.role?.toLowerCase().trim() || "viewer";
      const roleMap: Record<string, string> = {
        "ägare": "owner",
        "owner": "owner",
        "administratör": "admin",
        "administrator": "admin",
        "admin": "admin",
        "planerare": "planner",
        "planner": "planner",
        "tekniker": "technician",
        "technician": "technician",
        "läsare": "viewer",
        "viewer": "viewer",
        "user": "viewer",
        "användare": "viewer",
      };
      role = roleMap[role] || "viewer";
      
      await storage.createUserTenantRole({
        userId,
        tenantId,
        role,
        permissions: [],
        isActive: true,
      });
      imported++;
    }
    
    const tenantIdForLog = getTenantIdWithFallback(req);
    await storage.createAuditLog({
      tenantId: tenantIdForLog,
      action: "import_users",
      resourceType: "user_tenant_roles",
      changes: { imported, skipped, total: users.length },
    });
    
    res.json({ imported, skipped, total: users.length });
  } catch (error) {
    console.error("Failed to import users:", error);
    res.status(500).json({ error: "Failed to import users" });
  }
});

// User Tenant Roles - Delete role
app.delete("/api/system/user-roles/:id", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    await storage.createAuditLog({
      tenantId,
      action: "delete_user_role",
      resourceType: "user_tenant_roles",
      resourceId: req.params.id,
    });
    
    await storage.deleteUserTenantRole(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete user role:", error);
    res.status(500).json({ error: "Failed to delete user role" });
  }
});

// ============================================
// INDUSTRY PACKAGES API ENDPOINTS
// ============================================

// Industry Packages - List all available packages
app.get("/api/system/industry-packages", async (req, res) => {
  try {
    const packages = await storage.getIndustryPackages();
    res.json(packages);
  } catch (error) {
    console.error("Failed to fetch industry packages:", error);
    res.status(500).json({ error: "Failed to fetch industry packages" });
  }
});

// Industry Packages - Get by ID with full data
app.get("/api/system/industry-packages/:id", async (req, res) => {
  try {
    const pkg = await storage.getIndustryPackage(req.params.id);
    if (!pkg) return res.status(404).json({ error: "Package not found" });
    
    const packageData = await storage.getIndustryPackageData(req.params.id);
    res.json({ ...pkg, data: packageData });
  } catch (error) {
    console.error("Failed to fetch industry package:", error);
    res.status(500).json({ error: "Failed to fetch package" });
  }
});

// Industry Packages - Get tenant installation history
app.get("/api/system/industry-packages/installations", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const installations = await storage.getTenantPackageInstallations(tenantId);
    res.json(installations);
  } catch (error) {
    console.error("Failed to fetch package installations:", error);
    res.status(500).json({ error: "Failed to fetch installations" });
  }
});

// Industry Packages - Install package for tenant
app.post("/api/system/industry-packages/:id/install", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const packageId = req.params.id;
    const userId = (req.user as any)?.id;
    
    const pkg = await storage.getIndustryPackage(packageId);
    if (!pkg) return res.status(404).json({ error: "Package not found" });
    
    const packageData = await storage.getIndustryPackageData(packageId);
    
    let articlesInstalled = 0;
    let metadataInstalled = 0;
    let structuralArticlesInstalled = 0;
    
    const articlesData = packageData.find(d => d.dataType === "articles");
    if (articlesData && Array.isArray(articlesData.data)) {
      for (const article of articlesData.data as any[]) {
        try {
          await storage.createArticle({
            tenantId,
            articleNumber: article.articleNumber,
            name: article.name,
            description: article.description,
            articleType: article.articleType,
            unitPrice: article.unitPrice?.toString(),
            unit: article.unit,
            objectTypes: article.objectTypes,
          });
          articlesInstalled++;
        } catch (err) {
          console.warn(`Skipping duplicate article ${article.articleNumber}:`, err);
        }
      }
    }
    
    const metadataData = packageData.find(d => d.dataType === "metadataDefinitions");
    if (metadataData && Array.isArray(metadataData.data)) {
      for (const meta of metadataData.data as any[]) {
        try {
          await storage.createMetadataDefinition({
            tenantId,
            fieldKey: meta.fieldKey,
            fieldLabel: meta.fieldLabel,
            dataType: meta.dataType,
            objectTypes: meta.objectTypes,
            propagationType: meta.propagationType,
            isRequired: meta.isRequired,
            description: meta.description,
            defaultValue: meta.defaultValue,
            validationRules: meta.validationRules,
          });
          metadataInstalled++;
        } catch (err) {
          console.warn(`Skipping duplicate metadata ${meta.fieldKey}:`, err);
        }
      }
    }
    
    const structuralData = packageData.find(d => d.dataType === "structuralArticles");
    if (structuralData && Array.isArray(structuralData.data)) {
      const tenantArticles = await storage.getArticles(tenantId);
      const articleMap = new Map(tenantArticles.map(a => [a.articleNumber, a.id]));
      
      for (const sa of structuralData.data as any[]) {
        try {
          const parentId = articleMap.get(sa.parentArticleNumber);
          const childId = articleMap.get(sa.childArticleNumber);
          
          if (parentId && childId) {
            await storage.createStructuralArticle({
              tenantId,
              parentArticleId: parentId,
              childArticleId: childId,
              sequenceOrder: sa.sequenceOrder || 1,
              quantity: sa.quantity?.toString() || "1",
              isConditional: sa.isConditional || false,
              conditionType: sa.conditionType,
              conditionValue: sa.conditionValue,
            });
            structuralArticlesInstalled++;
          } else {
            console.warn(`Skipping structural article: parent=${sa.parentArticleNumber} child=${sa.childArticleNumber} - articles not found`);
          }
        } catch (err) {
          console.warn(`Skipping structural article:`, err);
        }
      }
    }
    
    const installation = await storage.createTenantPackageInstallation({
      tenantId,
      packageId,
      installedBy: userId,
      articlesInstalled,
      metadataInstalled,
      structuralArticlesInstalled,
      status: "completed",
    });
    
    await storage.createAuditLog({
      tenantId,
      userId,
      action: "install_industry_package",
      resourceType: "industry_package",
      resourceId: packageId,
      changes: { 
        packageName: pkg.name, 
        articlesInstalled, 
        metadataInstalled,
        structuralArticlesInstalled
      },
    });
    
    res.json({
      success: true,
      installation,
      summary: {
        articlesInstalled,
        metadataInstalled,
        structuralArticlesInstalled,
      },
    });
  } catch (error) {
    console.error("Failed to install industry package:", error);
    res.status(500).json({ error: "Failed to install package" });
  }
});

// Tenant Onboarding - Create new tenant with package and admin user
app.post("/api/system/onboard-tenant", requireAdmin, async (req, res) => {
  try {
    const { company, industryPackageId, adminUser } = req.body;
    const currentUserId = (req.user as any)?.id;

    if (!company?.name) {
      return res.status(400).json({ error: "Företagsnamn krävs" });
    }
    if (!adminUser?.email || !adminUser?.password) {
      return res.status(400).json({ error: "E-post och lösenord krävs för admin-användaren" });
    }

    const existingUser = await storage.getUserByUsername(adminUser.email);
    if (existingUser) {
      return res.status(409).json({ error: "En användare med den e-postadressen finns redan" });
    }

    const tenantId = `tenant-${Date.now()}`;
    const tenant = await storage.createTenant({
      id: tenantId,
      name: company.name,
      orgNumber: company.orgNumber || null,
      contactEmail: company.contactEmail || null,
      contactPhone: company.contactPhone || null,
      industry: company.industry || null,
    });

    let packageSummary = null;
    if (industryPackageId) {
      const pkg = await storage.getIndustryPackage(industryPackageId);
      if (pkg) {
        const packageData = await storage.getIndustryPackageData(industryPackageId);
        let articlesInstalled = 0;
        let metadataInstalled = 0;
        let structuralArticlesInstalled = 0;

        const articlesData = packageData.find(d => d.dataType === "articles");
        if (articlesData && Array.isArray(articlesData.data)) {
          for (const article of articlesData.data as any[]) {
            try {
              await storage.createArticle({
                tenantId,
                articleNumber: article.articleNumber,
                name: article.name,
                description: article.description,
                articleType: article.articleType,
                unitPrice: article.unitPrice?.toString(),
                unit: article.unit,
                objectTypes: article.objectTypes,
              });
              articlesInstalled++;
            } catch (err) {
              console.warn(`Skipping duplicate article ${article.articleNumber}:`, err);
            }
          }
        }

        const metadataData = packageData.find(d => d.dataType === "metadataDefinitions");
        if (metadataData && Array.isArray(metadataData.data)) {
          for (const meta of metadataData.data as any[]) {
            try {
              await storage.createMetadataDefinition({
                tenantId,
                fieldKey: meta.fieldKey,
                fieldLabel: meta.fieldLabel,
                dataType: meta.dataType,
                objectTypes: meta.objectTypes,
                propagationType: meta.propagationType,
                isRequired: meta.isRequired,
                description: meta.description,
                defaultValue: meta.defaultValue,
                validationRules: meta.validationRules,
              });
              metadataInstalled++;
            } catch (err) {
              console.warn(`Skipping duplicate metadata ${meta.fieldKey}:`, err);
            }
          }
        }

        const structuralData = packageData.find(d => d.dataType === "structuralArticles");
        if (structuralData && Array.isArray(structuralData.data)) {
          const tenantArticles = await storage.getArticles(tenantId);
          const articleMap = new Map(tenantArticles.map(a => [a.articleNumber, a.id]));
          for (const sa of structuralData.data as any[]) {
            try {
              const parentId = articleMap.get(sa.parentArticleNumber);
              const childId = articleMap.get(sa.childArticleNumber);
              if (parentId && childId) {
                await storage.createStructuralArticle({
                  tenantId,
                  parentArticleId: parentId,
                  childArticleId: childId,
                  sequenceOrder: sa.sequenceOrder || 1,
                  quantity: sa.quantity?.toString() || "1",
                  isConditional: sa.isConditional || false,
                  conditionType: sa.conditionType,
                  conditionValue: sa.conditionValue,
                });
                structuralArticlesInstalled++;
              }
            } catch (err) {
              console.warn(`Skipping structural article:`, err);
            }
          }
        }

        await storage.createTenantPackageInstallation({
          tenantId,
          packageId: industryPackageId,
          installedBy: currentUserId,
          articlesInstalled,
          metadataInstalled,
          structuralArticlesInstalled,
          status: "completed",
        });

        packageSummary = {
          packageName: pkg.name,
          articlesInstalled,
          metadataInstalled,
          structuralArticlesInstalled,
        };
      }
    }

    const hashedPassword = hashPassword(adminUser.password);
    const user = await storage.createUser({
      email: adminUser.email,
      firstName: adminUser.firstName || null,
      lastName: adminUser.lastName || null,
      passwordHash: hashedPassword,
      role: "admin",
      isActive: true,
    });

    await storage.createUserTenantRole({
      userId: user.id,
      tenantId,
      role: "owner",
      assignedBy: currentUserId,
    });

    await storage.createAuditLog({
      tenantId,
      userId: currentUserId,
      action: "onboard_tenant",
      resourceType: "tenant",
      resourceId: tenantId,
      changes: {
        companyName: company.name,
        adminEmail: adminUser.email,
        packageInstalled: packageSummary?.packageName || null,
      },
    });

    console.log(`[onboarding] New tenant "${company.name}" (${tenantId}) created with admin "${adminUser.email}"`);

    res.status(201).json({
      success: true,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        orgNumber: tenant.orgNumber,
        industry: tenant.industry,
      },
      adminUser: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      packageSummary,
    });
  } catch (error) {
    console.error("Failed to onboard tenant:", error);
    res.status(500).json({ error: "Kunde inte skapa företagskonto" });
  }
});

// Industry Packages - Seed default packages (admin only, one-time setup)
app.post("/api/system/industry-packages/seed", requireAdmin, async (req, res) => {
  try {
    const { allPackages, getPackageData } = await import("./data/industryPackages");
    
    const results = [];
    for (const pkgData of allPackages) {
      const existing = await storage.getIndustryPackageBySlug(pkgData.slug);
      if (existing) {
        results.push({ slug: pkgData.slug, status: "skipped", message: "Already exists" });
        continue;
      }
      
      const pkg = await storage.createIndustryPackage(pkgData);
      
      const data = getPackageData(pkgData.slug);
      
      if (data.articles.length > 0) {
        await storage.createIndustryPackageData({
          packageId: pkg.id,
          dataType: "articles",
          data: data.articles,
        });
      }
      
      if (data.metadata.length > 0) {
        await storage.createIndustryPackageData({
          packageId: pkg.id,
          dataType: "metadataDefinitions",
          data: data.metadata,
        });
      }
      
      if (data.structuralArticles.length > 0) {
        await storage.createIndustryPackageData({
          packageId: pkg.id,
          dataType: "structuralArticles",
          data: data.structuralArticles,
        });
      }
      
      results.push({ 
        slug: pkgData.slug, 
        status: "created", 
        articles: data.articles.length,
        metadata: data.metadata.length,
        structuralArticles: data.structuralArticles.length,
      });
    }
    
    res.json({ success: true, results });
  } catch (error) {
    console.error("Failed to seed industry packages:", error);
    res.status(500).json({ error: "Failed to seed packages" });
  }
});

// Audit Logs - Get logs for current tenant
app.get("/api/system/audit-logs", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const action = req.query.action as string;
    const userId = req.query.userId as string;
    
    const tenantId = getTenantIdWithFallback(req);
    const logs = await storage.getAuditLogs(tenantId, { limit, offset, action, userId });
    res.json(logs);
  } catch (error) {
    console.error("Failed to fetch audit logs:", error);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

// Project Statistics API - Returns code statistics for PDF generation
app.get("/api/system/project-stats", async (req, res) => {
  try {
    // Project code statistics (based on actual code count)
    const stats = {
      projectName: "Traivo - AI-Driven Field Service Planning Platform",
      generatedDate: new Date().toISOString(),
      codeStats: {
        totalLines: 43628,
        frontend: { lines: 31253, files: 120, description: "React/TypeScript frontend" },
        backend: { lines: 11304, files: 45, description: "Express.js/Node.js backend" },
        shared: { lines: 1071, files: 15, description: "Delad typning och schema" },
        totalFiles: 180,
      },
      features: [
        "Drag-and-drop veckoplanering",
        "AI-driven ruttoptimering (Geoapify Route Planner)",
        "GPS-spårning i realtid med breadcrumb-trails",
        "Automatisk anomali-övervakning",
        "Mobil fältapp med digitala signaturer",
        "Flerföretagsstöd-arkitektur",
        "WebSocket push-notifikationer",
        "MCP-integration för externa AI-assistenter",
        "Modus 2.0 CSV-import",
        "Väderoptimerad schemaläggning",
      ],
      techStack: [
        "React 18 + TypeScript",
        "Express.js + Node.js",
        "PostgreSQL + Drizzle ORM",
        "TanStack Query",
        "Tailwind CSS + Shadcn/UI",
        "Leaflet kartor",
        "OpenAI GPT-4",
        "WebSocket realtidskommunikation",
      ],
      costComparison: {
        // Swedish development costs
        hourlyRate: { min: 800, max: 1500, currency: "SEK" },
        // Estimate: 10-20 lines of production code per hour for complex systems
        estimatedHours: { min: 2181, max: 4363 }, // 43628 / 20 and 43628 / 10
        // Total cost range
        totalCost: {
          min: 2181 * 800, // 1 744 800 SEK
          max: 4363 * 1500, // 6 544 500 SEK
          currency: "SEK",
        },
        // Additional costs for a typical project
        additionalCosts: {
          projectManagement: "15-20% av utvecklingskostnad",
          uxDesign: "10-15% av utvecklingskostnad",
          testing: "20-30% av utvecklingskostnad",
          infrastructure: "Löpande månadskostnad",
        },
        // Timeline estimate
        timeline: {
          team: "3-5 utvecklare",
          duration: "6-12 månader",
        },
        notes: [
          "Uppskattningen baseras på 10-20 rader produktionskod per timme",
          "Timkostnaden för svenska konsulter varierar mellan 800-1500 kr/tim",
          "Inkluderar inte projektledning, UX-design eller infrastruktur",
          "Ett erfaret team kan leverera snabbare men till högre timkostnad",
        ],
      },
    };
    
    res.json(stats);
  } catch (error) {
    console.error("Failed to get project stats:", error);
    res.status(500).json({ error: "Failed to get project stats" });
  }
});

// Send project report via email
app.post("/api/system/send-project-report", requireAdmin, async (req, res) => {
  try {
    const { to, pdfBase64 } = req.body;
    
    if (!to || !pdfBase64) {
      return res.status(400).json({ error: "Missing required fields: to, pdfBase64" });
    }

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    
    const result = await sendEmail({
      to,
      subject: "Traivo Projektrapport - Kodstatistik och Kostnadsjämförelse",
      html: `
        <h1>Traivo Projektrapport</h1>
        <p>Bifogat finner du projektrapporten med kodstatistik och kostnadsjämförelse för Traivo-plattformen.</p>
        <h2>Sammanfattning</h2>
        <ul>
          <li><strong>Totalt antal kodrader:</strong> ~43 600</li>
          <li><strong>Uppskattad utvecklingskostnad:</strong> 1,7 - 6,5 miljoner SEK</li>
          <li><strong>Uppskattad utvecklingstid:</strong> 6-12 månader med 3-5 utvecklare</li>
        </ul>
        <p>Se bifogad PDF för detaljerad information.</p>
        <hr>
        <p><em>Genererad av Traivo - AI-Driven Field Service Planning Platform</em></p>
      `,
      attachments: [
        {
          filename: "Traivo_Projektrapport_Kostnadsjamforelse.pdf",
          content: pdfBuffer,
        }
      ],
    });
    
    console.log("Email sent successfully:", result);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Failed to send email:", error);
    res.status(500).json({ error: "Failed to send email", details: String(error) });
  }
});

// ============== METADATA DEFINITIONS ==============
app.get("/api/metadata-definitions", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const definitions = await storage.getMetadataDefinitions(tenantId);
    res.json(definitions);
  } catch (error) {
    console.error("Failed to fetch metadata definitions:", error);
    res.status(500).json({ error: "Failed to fetch metadata definitions" });
  }
});

app.get("/api/metadata-definitions/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const definition = await storage.getMetadataDefinition(req.params.id);
    const verified = verifyTenantOwnership(definition, tenantId);
    if (!verified) return res.status(404).json({ error: "Definition not found" });
    res.json(verified);
  } catch (error) {
    console.error("Failed to fetch metadata definition:", error);
    res.status(500).json({ error: "Failed to fetch metadata definition" });
  }
});

app.post("/api/metadata-definitions", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertMetadataDefinitionSchema.parse({ ...req.body, tenantId });
    const definition = await storage.createMetadataDefinition(data);
    res.status(201).json(definition);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to create metadata definition:", error);
    res.status(500).json({ error: "Failed to create metadata definition" });
  }
});

app.patch("/api/metadata-definitions/:id", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getMetadataDefinition(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Definition not found" });
    }
    // Only allow updating safe fields - never tenantId, id, fieldKey, or createdAt
    const updateSchema = z.object({
      fieldLabel: z.string().optional(),
      dataType: z.string().optional(),
      propagationType: z.string().optional(),
      applicableLevels: z.array(z.string()).optional(),
      isRequired: z.boolean().optional(),
      defaultValue: z.string().nullable().optional(),
    });
    const updateData = updateSchema.parse(req.body);
    const definition = await storage.updateMetadataDefinition(req.params.id, updateData);
    if (!definition) return res.status(404).json({ error: "Definition not found" });
    res.json(definition);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to update metadata definition:", error);
    res.status(500).json({ error: "Failed to update metadata definition" });
  }
});

app.delete("/api/metadata-definitions/:id", requireAdmin, async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getMetadataDefinition(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Definition not found" });
    }
    await storage.deleteMetadataDefinition(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete metadata definition:", error);
    res.status(500).json({ error: "Failed to delete metadata definition" });
  }
});

// ============== OBJECT METADATA ==============
// Helper to verify object belongs to current tenant
async function verifyObjectTenant(objectId: string, tenantId: string): Promise<boolean> {
  const obj = await storage.getObject(objectId);
  return obj?.tenantId === tenantId;
}

app.get("/api/objects/:objectId/metadata", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const metadata = await storage.getObjectMetadata(req.params.objectId);
    res.json(metadata);
  } catch (error) {
    console.error("Failed to fetch object metadata:", error);
    res.status(500).json({ error: "Failed to fetch object metadata" });
  }
});

app.post("/api/objects/:objectId/metadata", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const data = insertObjectMetadataSchema.parse({ 
      ...req.body, 
      tenantId,
      objectId: req.params.objectId 
    });
    const metadata = await storage.createObjectMetadata(data);
    res.status(201).json(metadata);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to create object metadata:", error);
    res.status(500).json({ error: "Failed to create object metadata" });
  }
});

app.patch("/api/objects/:objectId/metadata/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const updateSchema = z.object({
      value: z.string().optional(),
      breaksInheritance: z.boolean().optional(),
    });
    const updateData = updateSchema.parse(req.body);
    // Storage method enforces objectId and tenantId match at DB level
    const metadata = await storage.updateObjectMetadata(req.params.id, req.params.objectId, tenantId, updateData);
    if (!metadata) return res.status(404).json({ error: "Metadata not found or does not belong to this object" });
    res.json(metadata);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to update object metadata:", error);
    res.status(500).json({ error: "Failed to update object metadata" });
  }
});

app.delete("/api/objects/:objectId/metadata/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    // Storage method enforces objectId and tenantId match at DB level
    await storage.deleteObjectMetadata(req.params.id, req.params.objectId, tenantId);
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete object metadata:", error);
    res.status(500).json({ error: "Failed to delete object metadata" });
  }
});

// Get effective metadata for an object (including inherited values)
app.get("/api/objects/:objectId/effective-metadata", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const effectiveMetadata = await storage.getEffectiveMetadata(req.params.objectId, tenantId);
    res.json(effectiveMetadata);
  } catch (error) {
    console.error("Failed to fetch effective metadata:", error);
    res.status(500).json({ error: "Failed to fetch effective metadata" });
  }
});

// ============== OBJECT PAYERS ==============
app.get("/api/objects/:objectId/payers", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const payers = await storage.getObjectPayers(req.params.objectId);
    res.json(payers);
  } catch (error) {
    console.error("Failed to fetch object payers:", error);
    res.status(500).json({ error: "Failed to fetch object payers" });
  }
});

app.post("/api/objects/:objectId/payers", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const data = insertObjectPayerSchema.parse({
      ...req.body,
      tenantId,
      objectId: req.params.objectId
    });
    const payer = await storage.createObjectPayer(data);
    res.status(201).json(payer);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to create object payer:", error);
    res.status(500).json({ error: "Failed to create object payer" });
  }
});

app.patch("/api/objects/:objectId/payers/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const updateSchema = z.object({
      customerId: z.string().optional(),
      payerType: z.string().optional(),
      sharePercent: z.number().optional(),
      articleTypes: z.array(z.string()).optional(),
      priority: z.number().optional(),
      validFrom: z.string().nullable().optional().transform(v => v ? new Date(v) : null),
      validTo: z.string().nullable().optional().transform(v => v ? new Date(v) : null),
      invoiceReference: z.string().optional(),
      fortnoxCustomerId: z.string().optional(),
      notes: z.string().optional(),
    });
    const updateData = updateSchema.parse(req.body);
    const payer = await storage.updateObjectPayer(req.params.id, req.params.objectId, tenantId, updateData);
    if (!payer) return res.status(404).json({ error: "Payer not found or does not belong to this object" });
    res.json(payer);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to update object payer:", error);
    res.status(500).json({ error: "Failed to update object payer" });
  }
});

app.delete("/api/objects/:objectId/payers/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    await storage.deleteObjectPayer(req.params.id, req.params.objectId, tenantId);
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete object payer:", error);
    res.status(500).json({ error: "Failed to delete object payer" });
  }
});

}
