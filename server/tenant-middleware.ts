import type { Request, Response, NextFunction, RequestHandler } from "express";
import { db } from "./db";
import { userTenantRoles, tenants, type UserRole } from "@shared/schema";
import { eq, and } from "drizzle-orm";

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      tenantRole?: UserRole;
      tenantName?: string;
    }
  }
}

export interface TenantContext {
  tenantId: string;
  role: UserRole;
  tenantName: string;
}

async function getUserTenantRole(userId: string): Promise<TenantContext | null> {
  const result = await db
    .select({
      tenantId: userTenantRoles.tenantId,
      role: userTenantRoles.role,
      tenantName: tenants.name,
      assignedBy: userTenantRoles.assignedBy,
    })
    .from(userTenantRoles)
    .innerJoin(tenants, eq(userTenantRoles.tenantId, tenants.id))
    .where(eq(userTenantRoles.userId, userId));

  if (result.length === 0) {
    return null;
  }

  const preferred = result.find(r => r.tenantId !== "default-tenant")
    || result.find(r => r.assignedBy !== null)
    || result.find(r => r.role !== "user")
    || result[0];

  return {
    tenantId: preferred.tenantId,
    role: preferred.role as UserRole,
    tenantName: preferred.tenantName,
  };
}

export const requireTenant: RequestHandler = async (req, res, next) => {
  const user = req.user as any;
  
  if (!user || !user.claims?.sub) {
    return res.status(401).json({ error: "Ej autentiserad" });
  }

  const userId = user.claims.sub;
  const tenantContext = await getUserTenantRole(userId);

  if (!tenantContext) {
    return res.status(403).json({ 
      error: "Ingen organisation kopplad", 
      message: "Din användare är inte kopplad till någon organisation. Kontakta administratör." 
    });
  }

  req.tenantId = tenantContext.tenantId;
  req.tenantRole = tenantContext.role;
  req.tenantName = tenantContext.tenantName;

  next();
};

export const requireRole = (...allowedRoles: UserRole[]): RequestHandler => {
  return (req, res, next) => {
    if (!req.tenantRole) {
      return res.status(403).json({ error: "Ingen roll tilldelad" });
    }

    if (!allowedRoles.includes(req.tenantRole)) {
      return res.status(403).json({ 
        error: "Behörighet saknas", 
        message: `Denna åtgärd kräver någon av rollerna: ${allowedRoles.join(", ")}` 
      });
    }

    next();
  };
};

export const requireAdmin: RequestHandler = requireRole("owner", "admin");
export const requireOwner: RequestHandler = requireRole("owner");

export function getTenantId(req: Request): string {
  if (!req.tenantId) {
    throw new Error("Tenant ID saknas - requireTenant middleware måste användas först");
  }
  return req.tenantId;
}

export async function assignUserToTenant(
  userId: string, 
  tenantId: string, 
  role: UserRole = "user",
  assignedBy?: string
): Promise<void> {
  await db.insert(userTenantRoles).values({
    userId,
    tenantId,
    role,
    assignedBy,
  }).onConflictDoUpdate({
    target: [userTenantRoles.userId, userTenantRoles.tenantId],
    set: { role, assignedBy, createdAt: new Date() },
  });
}

export async function removeUserFromTenant(userId: string, tenantId: string): Promise<void> {
  await db
    .delete(userTenantRoles)
    .where(
      and(
        eq(userTenantRoles.userId, userId),
        eq(userTenantRoles.tenantId, tenantId)
      )
    );
}

export async function getUserTenants(userId: string): Promise<TenantContext[]> {
  const result = await db
    .select({
      tenantId: userTenantRoles.tenantId,
      role: userTenantRoles.role,
      tenantName: tenants.name,
    })
    .from(userTenantRoles)
    .innerJoin(tenants, eq(userTenantRoles.tenantId, tenants.id))
    .where(eq(userTenantRoles.userId, userId));

  return result.map(r => ({
    tenantId: r.tenantId,
    role: r.role as UserRole,
    tenantName: r.tenantName,
  }));
}

/**
 * Tenant middleware - requires authentication and tenant membership.
 * - Unauthenticated users: rejected with 401
 * - Authenticated users without tenant membership: rejected with 403 (must be explicitly assigned)
 * - Authenticated users with tenant membership: granted access to their assigned tenant
 * 
 * NOTE: Unauthenticated fallback removed for security (2026-01-05)
 */
export const requireTenantWithFallback: RequestHandler = async (req, res, next) => {
  const user = req.user as any;
  
  if (!user || !user.claims?.sub) {
    return res.status(401).json({ 
      error: "Ej autentiserad", 
      message: "Du måste logga in för att komma åt denna resurs." 
    });
  }

  const userId = user.claims.sub;
  const tenantContext = await getUserTenantRole(userId);

  if (!tenantContext) {
    return res.status(403).json({ 
      error: "Ingen organisation kopplad", 
      message: "Din användare är inte kopplad till någon organisation. Kontakta administratör för att bli tilldelad en organisation." 
    });
  }

  if (tenantContext.tenantId === "default-tenant" && tenantContext.role === "user") {
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction) {
      return res.status(403).json({
        error: "Åtkomst nekad",
        message: "Du har inte behörighet att komma åt denna resurs. En administratör måste bjuda in dig först.",
      });
    }

    const allRoles = await db
      .select({
        tenantId: userTenantRoles.tenantId,
        role: userTenantRoles.role,
        assignedBy: userTenantRoles.assignedBy,
      })
      .from(userTenantRoles)
      .where(eq(userTenantRoles.userId, userId));

    const hasAccess = allRoles.some(
      r => r.tenantId !== "default-tenant" || r.assignedBy !== null || r.role !== "user"
    );

    if (!hasAccess) {
      return res.status(403).json({
        error: "Åtkomst nekad",
        message: "Du har inte behörighet att komma åt denna resurs. En administratör måste bjuda in dig först.",
      });
    }
  }

  req.tenantId = tenantContext.tenantId;
  req.tenantRole = tenantContext.role;
  req.tenantName = tenantContext.tenantName;

  next();
};

export function getTenantIdWithFallback(req: Request): string {
  if (!req.tenantId) {
    const isDevelopment = process.env.NODE_ENV !== "production";
    
    if (isDevelopment) {
      console.warn(
        "[SECURITY WARNING] getTenantIdWithFallback called without req.tenantId. " +
        "This indicates the requireTenantWithFallback middleware was not properly applied. " +
        "In production, this would return 401 Unauthorized."
      );
      return "default-tenant";
    } else {
      throw new Error("Tenant ID missing - Access denied");
    }
  }
  
  return req.tenantId;
}
