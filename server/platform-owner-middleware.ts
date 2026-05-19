import type { Request, RequestHandler } from "express";
import { db } from "./db";
import { auditLogs, userTenantRoles } from "@shared/schema";
import { and, eq } from "drizzle-orm";

type ReplitSessionClaims = { claims?: { sub?: string } };
type ReplitSessionData = { userId?: string };

const PLATFORM_OWNER_TENANT = "kinab";
const PLATFORM_OWNER_ROLE = "owner";

declare global {
  namespace Express {
    interface Request {
      platformOwnerUserId?: string;
    }
  }
}

async function logDeniedAccess(
  req: Request,
  reason: string,
  userId: string | null,
): Promise<void> {
  try {
    const xff = req.headers["x-forwarded-for"];
    const ip =
      (typeof xff === "string" ? xff.split(",")[0]?.trim() : undefined) ||
      req.ip ||
      null;
    const ua = req.headers["user-agent"];
    await db.insert(auditLogs).values({
      tenantId: null,
      userId,
      action: "platform.access.denied",
      resourceType: "platform",
      resourceId: null,
      changes: null,
      ipAddress: ip,
      userAgent: typeof ua === "string" ? ua : null,
      metadata: { reason, path: req.path, method: req.method },
    });
  } catch (err) {
    console.error("[requirePlatformOwner] denial-log failed", err);
  }
}

/**
 * requirePlatformOwner — endast användare med aktiv owner-roll i tenant
 * `kinab` släpps igenom. Servern slår alltid upp rollen i `user_tenant_roles`
 * direkt från databasen (inga klient-headers används), så detta är inte
 * spoofbart från frontend. Alla 401/403-händelser loggas i audit_logs som
 * `platform.access.denied` för säkerhetsspårning.
 */
export const requirePlatformOwner: RequestHandler = async (req, res, next) => {
  const replitUser = (req as Request & { user?: ReplitSessionClaims }).user;
  const sessionUserId = (req.session as ReplitSessionData | undefined)?.userId;
  const userId: string | undefined = replitUser?.claims?.sub || sessionUserId;

  if (!userId) {
    await logDeniedAccess(req, "unauthenticated", null);
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
      await logDeniedAccess(
        req,
        !row
          ? "not_kinab_member"
          : row.role !== PLATFORM_OWNER_ROLE
            ? `wrong_role:${row.role}`
            : "inactive_owner",
        userId,
      );
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
