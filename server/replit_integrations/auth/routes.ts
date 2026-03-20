import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { getUserTenants } from "../../tenant-middleware";
import { db } from "../../db";
import { userTenantRoles } from "@shared/schema";
import { eq } from "drizzle-orm";

const ROLE_PRIVILEGE_ORDER = [
  "owner",
  "admin",
  "planner",
  "technician",
  "user",
  "viewer",
  "customer",
  "reporter",
];

function getMostPrivilegedRole(roles: { role: string }[]): string | null {
  // For multi-tenant users, returns the globally most privileged role across all tenants
  if (roles.length === 0) return null;
  let best: string | null = null;
  let bestIndex = ROLE_PRIVILEGE_ORDER.length;
  for (const r of roles) {
    const idx = ROLE_PRIVILEGE_ORDER.indexOf(r.role);
    if (idx !== -1 && idx < bestIndex) {
      bestIndex = idx;
      best = r.role;
    }
  }
  return best;
}

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const roles = await db
        .select({
          tenantId: userTenantRoles.tenantId,
          role: userTenantRoles.role,
          assignedBy: userTenantRoles.assignedBy,
        })
        .from(userTenantRoles)
        .where(eq(userTenantRoles.userId, userId));

      const accessGranted = roles.some(
        r => r.tenantId !== "default-tenant" || r.assignedBy !== null || r.role !== "user"
      );

      const tenantRole = getMostPrivilegedRole(roles);

      res.json({
        ...user,
        role: tenantRole || user.role,
        accessGranted,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
