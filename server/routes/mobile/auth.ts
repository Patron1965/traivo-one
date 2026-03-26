import type { Express } from "express";
  import {
    MobileAuthenticatedRequest, enrichOrderForMobile, broadcastPlannerEvent, handleQuickAction, getFallbackChecklist,
    storage, db, eq, sql, desc, and, gte, isNull, inArray, z,
    formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID, mobileTokens, generateMobileToken, validateMobileToken, isMobileAuthenticated,
    getTenantIdWithFallback, asyncHandler,
    NotFoundError, ValidationError, ForbiddenError,
    isAuthenticated,
    routeFeedbackTable, orderChecklistItems, workOrders, ORDER_STATUSES, customerChangeRequests, taskMetadataUpdates, etaNotificationsTable, pushTokens, resources, teams, teamMembers, resourceProfileAssignments, workEntries, workSessions,
    mapGoCategory, ONE_CATEGORIES, SEVERITY_LEVELS, GO_CATEGORY_MAP, AUTO_LINK_DEVIATION_TYPES,
    notificationService, triggerETANotification,
    OpenAI,
    getArticleMetadataForObject, writeArticleMetadataOnObject,
    handleWorkOrderStatusChange,
  } from "./shared";
  import type { Request, Response } from "express";
  
  export function registerAuthRoutes(app: Express) {
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();

// Mobile login - authenticate with email and PIN
app.post("/api/mobile/login", asyncHandler(async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const attempt = loginAttempts.get(clientIp);
    if (attempt) {
      if (now > attempt.resetAt) {
        loginAttempts.delete(clientIp);
      } else if (attempt.count >= 10) {
        return res.status(429).json({ error: "För många inloggningsförsök. Försök igen om 15 minuter." });
      }
    }

    const { email, pin, username, password } = req.body;
    
    const tenantId = getTenantIdWithFallback(req);
    const resources = await storage.getResources(tenantId);
    let resource: any = null;

    if (pin && !email && !username) {
      resource = resources.find(r => r.pin === pin && r.status === 'active');
    } else if (username && password) {
      resource = resources.find(r =>
        (r.email?.toLowerCase() === username.toLowerCase() || r.name?.toLowerCase() === username.toLowerCase()) && r.status === 'active'
      );
      if (resource && resource.pin && resource.pin !== password) {
        resource = null;
      }
    } else if (email && pin) {
      resource = resources.find(r =>
        r.email?.toLowerCase() === email.toLowerCase() && r.status === 'active'
      );
      if (resource) {
        if (resource.pin) {
          if (resource.pin !== pin) resource = null;
        } else {
          if (pin.length < 4 || pin.length > 6) {
            return res.status(401).json({ error: "PIN must be 4-6 digits" });
          }
        }
      }
    } else {
      throw new ValidationError("PIN or username/password required");
    }

    if (!resource) {
      const existing = loginAttempts.get(clientIp);
      if (existing) {
        existing.count++;
      } else {
        loginAttempts.set(clientIp, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
      }
      return res.status(401).json({ error: "Ogiltiga inloggningsuppgifter" });
    }
    
    loginAttempts.delete(clientIp);
    const token = generateMobileToken();
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
    
    mobileTokens.set(token, { resourceId: resource.id, tenantId: resource.tenantId, expiresAt });
    
    console.log(`[mobile] Login successful for resource ${resource.name} (${resource.id})`);
    
    res.json({
      token,
      user: {
        id: resource.id,
        name: resource.name,
        role: resource.resourceType || "driver",
        resourceId: resource.id,
        vehicleRegNo: "",
        executionCodes: resource.executionCodes || [],
      },
      success: true,
      resource: {
        id: resource.id,
        tenantId: resource.tenantId,
        userId: resource.userId,
        name: resource.name,
        initials: resource.initials,
        resourceType: resource.resourceType,
        phone: resource.phone,
        email: resource.email,
        homeLocation: resource.homeLocation,
        homeLatitude: resource.homeLatitude,
        homeLongitude: resource.homeLongitude,
        status: resource.status,
        executionCodes: resource.executionCodes || [],
      },
    });
}));

// Mobile logout
app.post("/api/mobile/logout", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader.substring(7);
    mobileTokens.delete(token);
    res.json({ success: true });
}));

  }
  