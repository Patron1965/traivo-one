import type { Express } from "express";
import { mobileLoginLimiter } from "../../middleware/rate-limit";
  import {
    MobileAuthenticatedRequest,
    storage, db, eq,
    mobileTokens, generateMobileToken, validateMobileToken, isMobileAuthenticated,
    getTenantIdWithFallback, asyncHandler,
    NotFoundError, ValidationError,
    notificationService,
  } from "./shared";
  import type { Resource } from "./shared";
  import type { Response } from "express";
  import { USER_ROLES, type UserRole } from "@shared/schema";
import { logLoginEvent } from "../../login-audit";

  const VALID_RBAC_ROLES = new Set<string>(USER_ROLES);
  function normalizeRbacRole(value: unknown): UserRole | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return VALID_RBAC_ROLES.has(normalized) ? (normalized as UserRole) : null;
  }
  
  export function registerAuthRoutes(app: Express) {
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();

// Mobile login - authenticate with email and PIN
app.post("/api/mobile/login", mobileLoginLimiter, asyncHandler(async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const attempt = loginAttempts.get(clientIp);
    const { email, pin, username, password } = req.body;
    if (attempt) {
      if (now > attempt.resetAt) {
        loginAttempts.delete(clientIp);
      } else if (attempt.count >= 10) {
        await logLoginEvent({
          req,
          method: "mobile",
          outcome: "failed",
          email: email || username || null,
          reason: "rate_limited",
          extra: { clientIp },
        });
        return res.status(429).json({ error: "För många inloggningsförsök. Försök igen om 15 minuter." });
      }
    }

    const tenantId = getTenantIdWithFallback(req);
    const resources = await storage.getResources(tenantId);
    let resource: Resource | undefined;

    if (pin && !email && !username) {
      resource = resources.find(r => r.pin === pin && r.status === 'active');
    } else if (username && password) {
      resource = resources.find(r =>
        (r.email?.toLowerCase() === username.toLowerCase() || r.name?.toLowerCase() === username.toLowerCase()) && r.status === 'active'
      );
      if (resource && resource.pin && resource.pin !== password) {
        resource = undefined;
      }
    } else if (email && pin) {
      resource = resources.find(r =>
        r.email?.toLowerCase() === email.toLowerCase() && r.status === 'active'
      );
      if (resource) {
        if (resource.pin) {
          if (resource.pin !== pin) resource = undefined;
        } else {
          if (pin.length < 4 || pin.length > 6) {
            return res.status(401).json({ error: "PIN must be 4-6 digits" });
          }
        }
      }
    } else {
      await logLoginEvent({
        req,
        method: "mobile",
        outcome: "failed",
        tenantId,
        email: email || username || null,
        reason: "missing_credentials",
      });
      throw new ValidationError("PIN or username/password required");
    }

    if (!resource) {
      const existing = loginAttempts.get(clientIp);
      if (existing) {
        existing.count++;
      } else {
        loginAttempts.set(clientIp, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
      }
      await logLoginEvent({
        req,
        method: "mobile",
        outcome: "failed",
        tenantId,
        email: email || username || null,
        reason: "invalid_credentials",
        extra: { hasPin: !!pin, hasPassword: !!password },
      });
      return res.status(401).json({ error: "Ogiltiga inloggningsuppgifter" });
    }
    
    loginAttempts.delete(clientIp);
    const token = generateMobileToken();
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
    
    mobileTokens.set(token, { resourceId: resource.id, tenantId: resource.tenantId, expiresAt });
    
    console.log(`[mobile] Login successful for resource ${resource.name} (${resource.id})`);
    await logLoginEvent({
      req,
      method: "mobile",
      outcome: "success",
      tenantId: resource.tenantId,
      userId: resource.userId ?? null,
      email: resource.email ?? null,
      extra: { resourceId: resource.id, resourceName: resource.name },
    });

    // Map RBAC role from linked users-row when available; fall back to "technician"
    // for resources without a user (typical field workers logged in via PIN).
    let rbacRole: UserRole = "technician";
    if (resource.userId) {
      const linkedUser = await storage.getUser(resource.userId).catch(() => undefined);
      const candidate = normalizeRbacRole(linkedUser?.role);
      if (candidate) rbacRole = candidate;
    }

    res.json({
      token,
      user: {
        id: resource.id,
        name: resource.name,
        role: rbacRole,
        resourceType: resource.resourceType || "driver",
        resourceId: resource.id,
        tenantId: resource.tenantId,
        userId: resource.userId,
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
    const authHeader = req.headers.authorization || "";
    const token = authHeader.substring(7);
    mobileTokens.delete(token);
    res.json({ success: true });
}));

app.get("/api/mobile/me", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resource = await storage.getResource(req.mobileResourceId);
    if (!resource) {
      throw new NotFoundError("Resurs hittades inte");
    }
    res.json({
      ...resource,
      startLatitude: resource.homeLatitude || null,
      startLongitude: resource.homeLongitude || null,
    });
}));

// Issue a short-lived WebSocket / Socket.io auth token bound to the
// authenticated mobile resource. Mobile clients (Traivo Go) use this token
// in the `auth.token` field when calling `io(API_URL, { auth: { token } })`
// or as `?token=...` on the legacy raw-WS endpoint `/ws/notifications`.
app.post("/api/mobile/notifications/token", isMobileAuthenticated, asyncHandler(async (req: MobileAuthenticatedRequest, res: Response) => {
    const resourceId = req.mobileResourceId;
    const resource = await storage.getResource(resourceId);
    if (!resource) {
      throw new NotFoundError("Resurs hittades inte");
    }
    const token = notificationService.generateAuthToken(resourceId, resource.tenantId);
    res.json({
      token,
      expiresIn: 300,
      resourceId,
    });
}));

  }
  