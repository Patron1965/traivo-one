import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { getUserTenants } from "../../tenant-middleware";
import { db } from "../../db";
import { userTenantRoles } from "@shared/schema";
import { eq } from "drizzle-orm";

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
        r => r.assignedBy !== null || r.role !== "user"
      );

      res.json({
        ...user,
        accessGranted,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
