import type { RequestHandler } from "express";
import { db } from "./db";
import { userTenantRoles } from "@shared/schema";
import { and, eq } from "drizzle-orm";

const PLATFORM_OWNER_TENANT = "kinab";
const PLATFORM_OWNER_ROLE = "owner";

declare global {
  namespace Express {
    interface Request {
      platformOwnerUserId?: string;
    }
  }
}

/**
 * requirePlatformOwner — endast användare med owner-roll i tenant `kinab`
 * släpps igenom. Servern slår alltid upp rollen i `user_tenant_roles`
 * direkt från databasen (inga klient-headers används), så detta är
 * inte spoofbart från frontend.
 */
export const requirePlatformOwner: RequestHandler = async (req, res, next) => {
  const replitUser: any = (req as any).user;
  const sessionUserId = (req.session as any)?.userId as string | undefined;
  const userId: string | undefined = replitUser?.claims?.sub || sessionUserId;

  if (!userId) {
    return res.status(401).json({
      error: "Ej autentiserad",
      message: "Du måste logga in.",
    });
  }

  try {
    const rows = await db
      .select({
        role: userTenantRoles.role,
        isActive: userTenantRoles.isActive,
      })
      .from(userTenantRoles)
      .where(
        and(
          eq(userTenantRoles.userId, userId),
          eq(userTenantRoles.tenantId, PLATFORM_OWNER_TENANT),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row || row.role !== PLATFORM_OWNER_ROLE || row.isActive !== true) {
      return res.status(403).json({
        error: "Plattformsägar-behörighet krävs",
        message:
          "Denna åtgärd är förbehållen plattformsägare (kinab + owner).",
      });
    }

    req.platformOwnerUserId = userId;
    next();
  } catch (err) {
    console.error("[requirePlatformOwner]", err);
    return res
      .status(500)
      .json({ error: "Kunde inte verifiera plattformsägar-behörighet" });
  }
};
