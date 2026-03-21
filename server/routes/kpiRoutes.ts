import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from "../errors";
import { requireAdmin } from "../tenant-middleware";
import { objects, workOrders, apiUsageLogs, apiBudgets, invitations, insertMetadataDefinitionSchema, insertObjectMetadataSchema, insertObjectPayerSchema } from "@shared/schema";
import { getISOWeek, getStartOfISOWeek } from "./helpers";
import { sendEmail } from "../replit_integrations/resend";

export async function registerKPIRoutes(app: Express) {
// ============================================
// KPI / ANALYTICS ENDPOINTS
// ============================================

app.get("/api/kpis/daily", asyncHandler(async (req, res) => {
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
}));

app.get("/api/kpis/weekly", asyncHandler(async (req, res) => {
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
}));

app.post("/api/system/weekly-report/trigger", requireAdmin, asyncHandler(async (req, res) => {
    const result = await generateAndSendWeeklyReports();
    res.json(result);
}));

// ============================================
// ANOMALY MONITORING API ENDPOINTS
// ============================================

// Manually trigger anomaly check and get results
app.get("/api/system/anomalies/check", asyncHandler(async (req, res) => {
    const alerts = await anomalyMonitor.runManualCheck();
    res.json({
      timestamp: new Date().toISOString(),
      alertCount: alerts.length,
      alerts: alerts
    });
}));

// ============================================
// SYSTEM DASHBOARD API ENDPOINTS
// ============================================

// Branding Templates - List all
app.get("/api/system/branding-templates", asyncHandler(async (req, res) => {
    const templates = await storage.getBrandingTemplates();
    res.json(templates);
}));

// Branding Templates - Get by ID
app.get("/api/system/branding-templates/:id", asyncHandler(async (req, res) => {
    const template = await storage.getBrandingTemplate(req.params.id);
    if (!template) throw new NotFoundError("Mall hittades inte");
    res.json(template);
}));

// Branding Templates - Get by slug
app.get("/api/system/branding-templates/slug/:slug", asyncHandler(async (req, res) => {
    const template = await storage.getBrandingTemplateBySlug(req.params.slug);
    if (!template) throw new NotFoundError("Mall hittades inte");
    res.json(template);
}));

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

app.get("/api/system/tenant-branding", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const branding = await storage.getTenantBranding(tenantId);
    res.json(branding || null);
}));

app.post("/api/system/scrape-branding", requireAdmin, asyncHandler(async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      throw new ValidationError("URL krävs");
    }

    let targetUrl = url.trim();
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = "https://" + targetUrl;
    }

    try {
      const parsedUrl = new URL(targetUrl);
      const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TraivoBrandBot/1.0)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Kunde inte hämta sidan (HTTP ${response.status})`);
      }

      const html = await response.text();

      const logos: string[] = [];
      const colors: string[] = [];
      let companyName = "";

      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) {
        let t = titleMatch[1].trim();
        t = t.split(/\s*[-–—|•·]\s*/)[0].trim();
        if (t.length > 0 && t.length < 80) {
          companyName = t;
        }
      }

      const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
      if (ogTitleMatch && ogTitleMatch[1].length < 80) {
        companyName = ogTitleMatch[1].split(/\s*[-–—|•·]\s*/)[0].trim();
      }

      const resolveUrl = (src: string) => {
        if (!src) return "";
        if (src.startsWith("//")) return parsedUrl.protocol + src;
        if (src.startsWith("http")) return src;
        if (src.startsWith("/")) return baseUrl + src;
        return baseUrl + "/" + src;
      };

      const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      if (ogImageMatch) {
        logos.push(resolveUrl(ogImageMatch[1]));
      }

      const linkIconMatches = [...html.matchAll(/<link[^>]+rel=["'](?:icon|apple-touch-icon|shortcut icon)["'][^>]*href=["']([^"']+)["'][^>]*>/gi)];
      for (const m of linkIconMatches) {
        if (m[1]) logos.push(resolveUrl(m[1]));
      }

      const imgLogoPatterns = [
        /<img[^>]+(?:class|id|alt)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/gi,
        /<img[^>]+src=["']([^"']+)["'][^>]*(?:class|id|alt)=["'][^"']*logo[^"']*["']/gi,
        /<img[^>]+src=["']([^"']*logo[^"']*)["']/gi,
      ];
      for (const pattern of imgLogoPatterns) {
        const matches = [...html.matchAll(pattern)];
        for (const m of matches) {
          if (m[1] && !m[1].includes("data:image/svg") && m[1].length < 500) {
            logos.push(resolveUrl(m[1]));
          }
        }
      }

      const svgLogoMatch = html.match(/<(?:a[^>]+(?:class|id)=["'][^"']*logo[^"']*["'][^>]*>|header[^>]*>)[\s\S]*?(<svg[\s\S]*?<\/svg>)/i);
      if (svgLogoMatch) {
        const svgDataUrl = "data:image/svg+xml;base64," + Buffer.from(svgLogoMatch[1]).toString("base64");
        logos.unshift(svgDataUrl);
      }

      const hexColors = new Set<string>();
      const colorPatterns = [
        /(?:background-color|background|color|border-color)\s*:\s*(#[0-9a-fA-F]{6})\b/g,
        /(?:background-color|background|color|border-color)\s*:\s*(#[0-9a-fA-F]{3})\b/g,
      ];
      for (const pattern of colorPatterns) {
        const matches = [...html.matchAll(pattern)];
        for (const m of matches) {
          let hex = m[1];
          if (hex.length === 4) {
            hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
          }
          hex = hex.toUpperCase();
          if (hex !== "#FFFFFF" && hex !== "#000000" && hex !== "#F5F5F5" && hex !== "#EEEEEE" && hex !== "#333333" && hex !== "#666666" && hex !== "#999999" && hex !== "#CCCCCC") {
            hexColors.add(hex);
          }
        }
      }

      const themeColorMatch = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i);
      if (themeColorMatch && /^#[0-9a-fA-F]{3,6}$/.test(themeColorMatch[1])) {
        let tc = themeColorMatch[1].toUpperCase();
        if (tc.length === 4) tc = "#" + tc[1] + tc[1] + tc[2] + tc[2] + tc[3] + tc[3];
        hexColors.add(tc);
        colors.unshift(tc);
      }

      colors.push(...[...hexColors].filter(c => !colors.includes(c)).slice(0, 10));

      const uniqueLogos = [...new Set(logos)].slice(0, 5);

      res.json({
        companyName,
        logos: uniqueLogos,
        colors,
        sourceUrl: targetUrl,
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new ValidationError("Timeout: Sidan svarade inte inom 10 sekunder");
      }
      throw new ValidationError(err.message || "Kunde inte analysera webbplatsen");
    }
}));

app.post("/api/system/tenant-branding/upload-logo", requireAdmin, asyncHandler(async (req, res) => {
    const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json({ uploadURL, objectPath });
}));

app.post("/api/system/tenant-branding/confirm-logo", requireAdmin, asyncHandler(async (req, res) => {
    const { objectPath } = req.body;
    if (!objectPath || typeof objectPath !== "string") {
      throw new ValidationError("objectPath krävs");
    }

    const serveUrl = `/api/storage/serve${objectPath}`;
    res.json({ url: serveUrl, objectPath });
}));

app.get("/api/storage/serve/objects/*", asyncHandler(async (req, res) => {
    const objectPath = `/objects/${(req.params as any)[0]}`;
    const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
    const objectStorageService = new ObjectStorageService();
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    await objectStorageService.downloadObject(file, res, 86400);
}));

// Tenant Branding - Update or create branding
app.put("/api/system/tenant-branding", requireAdmin, asyncHandler(async (req, res) => {
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
}));

// Tenant Branding - Publish branding (admin only)
app.post("/api/system/tenant-branding/publish", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const result = await storage.publishTenantBranding(tenantId);
    
    if (!result) {
      throw new NotFoundError("Varumärke hittades inte");
    }
    
    await storage.createAuditLog({
      tenantId,
      action: "publish_branding",
      resourceType: "tenant_branding",
      resourceId: result.id,
    });
    
    res.json(result);
}));

// SMS Configuration - Get current SMS settings (admin only)
app.get("/api/system/sms-config", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    
    if (!tenant) {
      throw new NotFoundError("Företag hittades inte");
    }
    
    res.json({
      smsEnabled: tenant.smsEnabled ?? false,
      smsProvider: tenant.smsProvider ?? "none",
      smsFromName: tenant.smsFromName ?? tenant.name ?? "",
    });
}));

// SMS Configuration - Update SMS settings (admin only)
const smsConfigSchema = z.object({
  smsEnabled: z.boolean().optional(),
  smsProvider: z.enum(["twilio", "46elks", "none"]).optional(),
  smsFromName: z.string().max(100).optional(),
});

app.put("/api/system/sms-config", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    
    const parseResult = smsConfigSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: "Ogiltig förfrågan", details: parseResult.error.flatten() });
    }
    
    const tenant = await storage.updateTenantSmsSettings(tenantId, parseResult.data);
    
    if (!tenant) {
      throw new NotFoundError("Företag hittades inte");
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
}));

// SMS Configuration - Test SMS sending (admin only)
app.post("/api/system/sms-config/test", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      throw new ValidationError("Telefonnummer krävs");
    }
    
    const tenant = await storage.getTenant(tenantId);
    if (!tenant?.smsEnabled) {
      throw new ValidationError("SMS är inte aktiverat för detta företag");
    }
    
    const { sendNotification } = await import("../unified-notifications");
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
      res.status(500).json({ success: false, error: result.errors.join(", ") || "Kunde inte skicka test-SMS" });
    }
}));

// User Tenant Roles - List all users with roles for current tenant (admin only)
app.get("/api/system/user-roles", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const roles = await storage.getUserTenantRoles(tenantId);
    res.json(roles);
}));

// User Tenant Roles - Create new user role (admin only)
app.post("/api/system/user-roles", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { userId, name, role, permissions, password } = req.body;
    
    if (!userId || !role) {
      throw new ValidationError("userId och roll krävs");
    }
    
    // Check if user already has a role
    const existing = await storage.getUserTenantRole(userId, tenantId);
    if (existing) {
      throw new ValidationError("Användaren har redan en roll i detta företag");
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
}));

// User Tenant Roles - Update role (admin only)
app.patch("/api/system/user-roles/:id", requireAdmin, asyncHandler(async (req, res) => {
    const { role, permissions, isActive, password } = req.body;
    
    const result = await storage.updateUserTenantRole(req.params.id, {
      role,
      permissions,
      isActive,
    });
    
    if (!result) {
      throw new NotFoundError("Användarroll hittades inte");
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
}));

// User Tenant Roles - Import users from CSV data
app.post("/api/system/user-roles/import", requireAdmin, asyncHandler(async (req, res) => {
    const { users } = req.body;
    
    if (!Array.isArray(users) || users.length === 0) {
      throw new ValidationError("Inga användare angivna");
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
}));

// User Tenant Roles - Delete role
app.delete("/api/system/user-roles/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.createAuditLog({
      tenantId,
      action: "delete_user_role",
      resourceType: "user_tenant_roles",
      resourceId: req.params.id,
    });
    
    await storage.deleteUserTenantRole(req.params.id);
    res.status(204).send();
}));

// ============================================
// INDUSTRY PACKAGES API ENDPOINTS
// ============================================

// Industry Packages - List all available packages
app.get("/api/system/industry-packages", asyncHandler(async (req, res) => {
    const packages = await storage.getIndustryPackages();
    res.json(packages);
}));

// Industry Packages - Get by ID with full data
app.get("/api/system/industry-packages/:id", asyncHandler(async (req, res) => {
    const pkg = await storage.getIndustryPackage(req.params.id);
    if (!pkg) throw new NotFoundError("Paket hittades inte");
    
    const packageData = await storage.getIndustryPackageData(req.params.id);
    res.json({ ...pkg, data: packageData });
}));

// Industry Packages - Get tenant installation history
app.get("/api/system/industry-packages/installations", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const installations = await storage.getTenantPackageInstallations(tenantId);
    res.json(installations);
}));

// Industry Packages - Install package for tenant
app.post("/api/system/industry-packages/:id/install", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const packageId = req.params.id;
    const userId = (req.user as any)?.id;
    
    const pkg = await storage.getIndustryPackage(packageId);
    if (!pkg) throw new NotFoundError("Paket hittades inte");
    
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
}));

// Tenant Onboarding - Create new tenant with package and admin user
app.post("/api/system/onboard-tenant", requireAdmin, asyncHandler(async (req, res) => {
    const { company, industryPackageId, adminUser } = req.body;
    const currentUserId = (req.user as any)?.id;

    if (!company?.name) {
      throw new ValidationError("Företagsnamn krävs");
    }
    if (!adminUser?.email || !adminUser?.password) {
      throw new ValidationError("E-post och lösenord krävs för admin-användaren");
    }

    const existingUser = await storage.getUserByUsername(adminUser.email);
    if (existingUser) {
      throw new ConflictError("En användare med den e-postadressen finns redan");
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
}));

// Industry Packages - Seed default packages (admin only, one-time setup)
app.post("/api/system/industry-packages/seed", requireAdmin, asyncHandler(async (req, res) => {
    const { allPackages, getPackageData } = await import("../data/industryPackages");
    
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
}));

// Audit Logs - Get logs for current tenant
app.get("/api/system/audit-logs", asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const action = req.query.action as string;
    const userId = req.query.userId as string;
    
    const tenantId = getTenantIdWithFallback(req);
    const logs = await storage.getAuditLogs(tenantId, { limit, offset, action, userId });
    res.json(logs);
}));

// Project Statistics API - Returns code statistics for PDF generation
app.get("/api/system/project-stats", asyncHandler(async (req, res) => {
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
}));

// Send project report via email
app.post("/api/system/send-project-report", requireAdmin, asyncHandler(async (req, res) => {
    const { to, pdfBase64 } = req.body;
    
    if (!to || !pdfBase64) {
      throw new ValidationError("Missing required fields: to, pdfBase64");
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
}));

// ============== METADATA DEFINITIONS ==============
app.get("/api/metadata-definitions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const definitions = await storage.getMetadataDefinitions(tenantId);
    res.json(definitions);
}));

app.get("/api/metadata-definitions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const definition = await storage.getMetadataDefinition(req.params.id);
    const verified = verifyTenantOwnership(definition, tenantId);
    if (!verified) throw new NotFoundError("Definition hittades inte");
    res.json(verified);
}));

app.post("/api/metadata-definitions", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertMetadataDefinitionSchema.parse({ ...req.body, tenantId });
    const definition = await storage.createMetadataDefinition(data);
    res.status(201).json(definition);
}));

app.patch("/api/metadata-definitions/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getMetadataDefinition(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Definition hittades inte");
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
    if (!definition) throw new NotFoundError("Definition hittades inte");
    res.json(definition);
}));

app.delete("/api/metadata-definitions/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getMetadataDefinition(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Definition hittades inte");
    }
    await storage.deleteMetadataDefinition(req.params.id);
    res.status(204).send();
}));

// ============== OBJECT METADATA ==============
// Helper to verify object belongs to current tenant
async function verifyObjectTenant(objectId: string, tenantId: string): Promise<boolean> {
  const obj = await storage.getObject(objectId);
  return obj?.tenantId === tenantId;
}

app.get("/api/objects/:objectId/metadata", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const metadata = await storage.getObjectMetadata(req.params.objectId);
    res.json(metadata);
}));

app.post("/api/objects/:objectId/metadata", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const data = insertObjectMetadataSchema.parse({ 
      ...req.body, 
      tenantId,
      objectId: req.params.objectId 
    });
    const metadata = await storage.createObjectMetadata(data);
    res.status(201).json(metadata);
}));

app.patch("/api/objects/:objectId/metadata/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const updateSchema = z.object({
      value: z.string().optional(),
      breaksInheritance: z.boolean().optional(),
    });
    const updateData = updateSchema.parse(req.body);
    // Storage method enforces objectId and tenantId match at DB level
    const metadata = await storage.updateObjectMetadata(req.params.id, req.params.objectId, tenantId, updateData);
    if (!metadata) throw new NotFoundError("Metadata not found or does not belong to this object");
    res.json(metadata);
}));

app.delete("/api/objects/:objectId/metadata/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    // Storage method enforces objectId and tenantId match at DB level
    await storage.deleteObjectMetadata(req.params.id, req.params.objectId, tenantId);
    res.status(204).send();
}));

// Get effective metadata for an object (including inherited values)
app.get("/api/objects/:objectId/effective-metadata", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const effectiveMetadata = await storage.getEffectiveMetadata(req.params.objectId, tenantId);
    res.json(effectiveMetadata);
}));

// ============== OBJECT PAYERS ==============
app.get("/api/objects/:objectId/payers", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const payers = await storage.getObjectPayers(req.params.objectId);
    res.json(payers);
}));

app.post("/api/objects/:objectId/payers", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    const data = insertObjectPayerSchema.parse({
      ...req.body,
      tenantId,
      objectId: req.params.objectId
    });
    const payer = await storage.createObjectPayer(data);
    res.status(201).json(payer);
}));

app.patch("/api/objects/:objectId/payers/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
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
    if (!payer) throw new NotFoundError("Betalare hittades inte eller tillhör inte detta objekt");
    res.json(payer);
}));

app.delete("/api/objects/:objectId/payers/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!await verifyObjectTenant(req.params.objectId, tenantId)) {
      throw new ForbiddenError("Åtkomst nekad");
    }
    await storage.deleteObjectPayer(req.params.id, req.params.objectId, tenantId);
    res.status(204).send();
}));

// ============================================
// ROUTE FEEDBACK ENDPOINTS
// ============================================
app.get("/api/route-feedback", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { resourceId, startDate, endDate, limit: limitStr, clusterId } = req.query as Record<string, string>;
    const parsedLimit = limitStr ? Math.min(Math.max(parseInt(limitStr) || 50, 1), 200) : undefined;

    let filteredResourceIds: string[] | undefined;
    if (clusterId) {
      const clusterObjects = await storage.getClusterObjects(clusterId);
      const clusterOrders = await storage.getWorkOrders(tenantId);
      const objectIds = new Set(clusterObjects.map(o => o.id));
      filteredResourceIds = [...new Set(
        clusterOrders.filter(o => o.objectId && objectIds.has(o.objectId) && o.resourceId).map(o => o.resourceId!)
      )];
    }

    const feedback = await storage.getRouteFeedback(tenantId, {
      resourceId: resourceId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      limit: parsedLimit,
    });

    const filtered = filteredResourceIds
      ? feedback.filter(f => filteredResourceIds!.includes(f.resourceId))
      : feedback;

    const resources = await storage.getResources(tenantId);
    const resourceMap = new Map(resources.map(r => [r.id, r.name]));
    const enriched = filtered.map(f => ({
      ...f,
      resourceName: resourceMap.get(f.resourceId) || f.resourceId,
    }));
    res.json(enriched);
}));

app.get("/api/route-feedback/summary", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { startDate, endDate, clusterId } = req.query as Record<string, string>;

    let areaResourceIds: string[] | undefined;
    if (clusterId) {
      const clusterObjects = await storage.getClusterObjects(clusterId);
      const clusterOrders = await storage.getWorkOrders(tenantId);
      const objectIds = new Set(clusterObjects.map(o => o.id));
      areaResourceIds = [...new Set(
        clusterOrders.filter(o => o.objectId && objectIds.has(o.objectId) && o.resourceId).map(o => o.resourceId!)
      )];
    }

    const summary = await storage.getRouteFeedbackSummary(tenantId, {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      resourceIds: areaResourceIds,
    });

    const resources = await storage.getResources(tenantId);
    const resourceMap = new Map(resources.map(r => [r.id, r.name]));
    const enrichedByResource = summary.byResource.map(r => ({
      ...r,
      resourceName: resourceMap.get(r.resourceId) || r.resourceId,
    }));
    res.json({ ...summary, byResource: enrichedByResource });
}));

// ============================================
// INVITATIONS - User invitation management
// ============================================

app.get("/api/invitations", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const result = await db
      .select()
      .from(invitations)
      .where(eq(invitations.tenantId, tenantId))
      .orderBy(desc(invitations.createdAt));
    res.json(result);
}));

app.post("/api/invitations", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const user = req.user as any;
    const userId = user?.claims?.sub;

    const { email, role } = req.body;
    if (!email || typeof email !== "string" || !email.includes("@")) {
      throw new ValidationError("Giltig e-postadress krävs");
    }

    const validRoles = ["owner", "admin", "planner", "technician", "user", "viewer"];
    if (role && !validRoles.includes(role)) {
      throw new ValidationError("Ogiltig roll");
    }

    const existing = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.email, email.toLowerCase()),
          eq(invitations.tenantId, tenantId),
          eq(invitations.status, "pending")
        )
      );

    if (existing.length > 0) {
      throw new ConflictError("En inbjudan finns redan för denna e-postadress");
    }

    const [invitation] = await db
      .insert(invitations)
      .values({
        email: email.toLowerCase(),
        tenantId,
        role: role || "user",
        invitedBy: userId,
        status: "pending",
      })
      .returning();

    try {
      const appUrl = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : process.env.REPLIT_DEPLOYMENT_URL || "https://traivo.replit.app";
      const roleLabel: Record<string, string> = {
        owner: "Ägare", admin: "Admin", planner: "Planerare",
        technician: "Tekniker", user: "Användare", viewer: "Läsare",
      };
      await sendEmail({
        to: email.toLowerCase(),
        subject: "Du har bjudits in till Traivo",
        html: `
          <div style="font-family: Inter, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
            <h2 style="color: #1B4B6B;">Välkommen till Traivo!</h2>
            <p>Du har bjudits in med rollen <strong>${roleLabel[role] || role || "Användare"}</strong>.</p>
            <p>Klicka på knappen nedan för att komma igång:</p>
            <a href="${appUrl}" style="display: inline-block; padding: 12px 24px; background: #1B4B6B; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 16px 0;">Logga in på Traivo</a>
            <p style="color: #6B7C8C; font-size: 13px; margin-top: 24px;">Om du inte förväntat dig denna inbjudan kan du ignorera detta meddelande.</p>
          </div>
        `,
      });
      console.log(`[invitation] Email sent to ${email.toLowerCase()}`);
    } catch (err) {
      console.error("[invitation] Failed to send email:", err);
    }

    res.json(invitation);
}));

app.delete("/api/invitations/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { id } = req.params;

    const [invitation] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, id));

    if (!invitation || invitation.tenantId !== tenantId) {
      throw new NotFoundError("Inbjudan hittades inte");
    }

    if (invitation.status !== "pending") {
      throw new ValidationError("Kan bara ta bort väntande inbjudningar");
    }

    await db.delete(invitations).where(eq(invitations.id, id));
    res.json({ success: true });
}));

}
