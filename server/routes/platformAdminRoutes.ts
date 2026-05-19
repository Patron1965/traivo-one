import type { Express, Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { auditLogs, userTenantRoles, tenants } from "@shared/schema";
import { requirePlatformOwner } from "../platform-owner-middleware";

/**
 * Redaktera PII för audit-loggar: lagrar SHA-256-prefix + längd så att
 * "samma e-post"-jämförelser kan göras vid utredning utan att klartext
 * sparas (krävs av GDPR right-to-erasure).
 */
function redactPii(value: string | null | undefined): { hash: string; length: number } | null {
  if (!value) return null;
  const trimmed = String(value);
  return {
    hash: createHash("sha256").update(trimmed).digest("hex").slice(0, 16),
    length: trimmed.length,
  };
}

/**
 * Kör en plattforms-mutation under Postgres advisory-lås. Vi låser både
 * target-user OCH alla tenants där hen är aktiv owner — det stänger
 * TOCTOU-fönstret mellan "sista aktiva owner"-kontrollen och själva
 * mutationen, även för samtidiga raderings-/anonymiserings-anrop mot
 * *olika* owners i samma tenant. Tenant-låsen tas i sorterad ordning
 * för att undvika deadlocks när två admin-flöden träffar samma par av
 * tenants.
 */
async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    const ownerTenantRows = await tx
      .select({ tenantId: userTenantRoles.tenantId })
      .from(userTenantRoles)
      .where(
        and(
          eq(userTenantRoles.userId, userId),
          eq(userTenantRoles.role, "owner"),
          eq(userTenantRoles.isActive, true),
        ),
      );
    const tenantIds = Array.from(new Set(ownerTenantRows.map((r) => r.tenantId))).sort();
    for (const tid of tenantIds) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`tenant:owners:${tid}`}))`);
    }
    return await fn();
  });
}

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

function getClientMeta(req: Request) {
  const xff = req.headers["x-forwarded-for"];
  const ip = (typeof xff === "string" ? xff.split(",")[0]?.trim() : undefined) || req.ip || null;
  const userAgent = req.headers["user-agent"] || null;
  return { ip, userAgent: typeof userAgent === "string" ? userAgent : null };
}

async function logPlatformAccess(
  req: Request,
  action: string,
  resourceId: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { ip, userAgent } = getClientMeta(req);
    await storage.createAuditLog({
      tenantId: null,
      userId: req.platformOwnerUserId ?? null,
      action,
      resourceType: "platform",
      resourceId,
      changes: null,
      ipAddress: ip,
      userAgent,
      metadata: { path: req.path, method: req.method, ...extra },
    });
  } catch (err) {
    console.error("[platform-admin] audit log failed", err);
  }
}

async function isLastActiveOwnerOf(userId: string): Promise<string[]> {
  const ownerRows = await db
    .select({ tenantId: userTenantRoles.tenantId })
    .from(userTenantRoles)
    .where(
      and(
        eq(userTenantRoles.userId, userId),
        eq(userTenantRoles.role, "owner"),
        eq(userTenantRoles.isActive, true),
      ),
    );

  const blocking: string[] = [];
  for (const { tenantId } of ownerRows) {
    const otherOwners = await db
      .select({ id: userTenantRoles.id })
      .from(userTenantRoles)
      .where(
        and(
          eq(userTenantRoles.tenantId, tenantId),
          eq(userTenantRoles.role, "owner"),
          eq(userTenantRoles.isActive, true),
        ),
      );
    if (otherOwners.length <= 1) blocking.push(tenantId);
  }
  return blocking;
}

export function registerPlatformAdminRoutes(app: Express): void {
  // GET /api/platform/me — låter frontend gate:a UI på rollen utan att
  // läcka information (en icke-owner får 403 från middleware).
  app.get(
    "/api/platform/me",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {
      await logPlatformAccess(req, "platform.me.read", req.platformOwnerUserId ?? null);
      res.json({ isPlatformOwner: true, userId: req.platformOwnerUserId });
    }),
  );

  // GET /api/platform/users — alla användare cross-tenant + medlemskap (paginerad)
  app.get(
    "/api/platform/users",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {
      const search = ((req.query.q as string) || "").trim().toLowerCase();
      const parsedLimit = Number.parseInt((req.query.limit as string) || "50", 10);
      const parsedOffset = Number.parseInt((req.query.offset as string) || "0", 10);
      const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1), 200);
      const offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0);

      const { users: page, total } = await storage.listAllUsersWithTenantsPaged({
        search: search || undefined,
        limit,
        offset,
      });
      const safe = page.map(({ passwordHash, ...u }) => u);
      await logPlatformAccess(req, "platform.users.list", null, {
        total,
        returned: safe.length,
        limit,
        offset,
        query: search || null,
      });
      res.json({ users: safe, total, limit, offset });
    }),
  );

  // GET /api/platform/users/:id — detaljerad användarvy (medlemskap + senaste audit)
  app.get(
    "/api/platform/users/:id",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {
      const targetId = req.params.id;
      const user = await storage.getUser(targetId);
      if (!user) {
        await logPlatformAccess(req, "platform.user.read.notfound", targetId, { status: 404 });
        return res.status(404).json({ error: "Användaren hittades inte." });
      }
      const memberships = await db
        .select({
          tenantId: userTenantRoles.tenantId,
          tenantName: tenants.name,
          role: userTenantRoles.role,
          isActive: userTenantRoles.isActive,
          assignedBy: userTenantRoles.assignedBy,
          createdAt: userTenantRoles.createdAt,
        })
        .from(userTenantRoles)
        .leftJoin(tenants, eq(tenants.id, userTenantRoles.tenantId))
        .where(eq(userTenantRoles.userId, targetId));

      const recentAudit = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.userId, targetId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(25);

      const recentTargeted = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.resourceId, targetId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(25);

      const { passwordHash: _omit, ...safeUser } = user;
      const resourceImpact = await storage.computeUserResourceImpact(targetId);
      await logPlatformAccess(req, "platform.user.read", targetId, {
        resourceImpactKeys: Object.keys(resourceImpact).length,
      });
      res.json({
        user: safeUser,
        memberships,
        resourceImpact,
        recentAuditAsActor: recentAudit,
        recentAuditAsTarget: recentTargeted,
      });
    }),
  );

  // POST /api/platform/users/:id/anonymize — GDPR-anonymisering
  app.post(
    "/api/platform/users/:id/anonymize",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {
      const targetId = req.params.id;
      const actorId = req.platformOwnerUserId!;
      if (targetId === actorId) {
        await logPlatformAccess(req, "platform.user.anonymize.rejected", targetId, { status: 400, reason: "self" });
        return res.status(400).json({ error: "Du kan inte anonymisera dig själv." });
      }
      const existing = await storage.getUser(targetId);
      if (!existing) {
        await logPlatformAccess(req, "platform.user.anonymize.notfound", targetId, { status: 404 });
        return res.status(404).json({ error: "Användaren hittades inte." });
      }

      const force = req.body?.force === true;
      const result = await withUserLock(targetId, async () => {
        const blocking = await isLastActiveOwnerOf(targetId);
        if (blocking.length > 0 && !force) {
          return { kind: "blocked" as const, blocking };
        }
        const updated = await storage.anonymizeUser(targetId);
        return { kind: "ok" as const, updated, blocking };
      });
      if (result.kind === "blocked") {
        await logPlatformAccess(req, "platform.user.anonymize.blocked", targetId, {
          status: 409,
          blockingTenants: result.blocking,
          force: false,
        });
        return res.status(409).json({
          error: "Sista aktiva owner",
          message: `Användaren är enda aktiva owner i ${result.blocking.length} organisation(er): ${result.blocking.join(", ")}. Skicka { "force": true } för att gå vidare.`,
          blockingTenants: result.blocking,
        });
      }
      const { ip, userAgent } = getClientMeta(req);
      await storage.createAuditLog({
        tenantId: null,
        userId: actorId,
        action: "platform.user.anonymize",
        resourceType: "user",
        resourceId: targetId,
        changes: {
          before: {
            emailRedacted: redactPii(existing.email),
            firstNameRedacted: redactPii(existing.firstName),
            lastNameRedacted: redactPii(existing.lastName),
          },
        },
        ipAddress: ip,
        userAgent,
        metadata: { reason: req.body?.reason ?? null, force, blockingTenants: result.blocking },
      });
      res.json({ success: true, user: result.updated });
    }),
  );

  // DELETE /api/platform/users/:id — hård radering (GDPR right to erasure)
  app.delete(
    "/api/platform/users/:id",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {
      const targetId = req.params.id;
      const actorId = req.platformOwnerUserId!;
      if (targetId === actorId) {
        await logPlatformAccess(req, "platform.user.delete.rejected", targetId, { status: 400, reason: "self" });
        return res.status(400).json({ error: "Du kan inte radera ditt eget konto." });
      }
      if (req.body?.confirm !== "RADERA") {
        await logPlatformAccess(req, "platform.user.delete.rejected", targetId, { status: 400, reason: "missing_confirm" });
        return res.status(400).json({
          error: "Bekräftelse saknas",
          message: 'Skicka { "confirm": "RADERA" } i body för att bekräfta hård radering.',
        });
      }
      const existing = await storage.getUser(targetId);
      if (!existing) {
        await logPlatformAccess(req, "platform.user.delete.notfound", targetId, { status: 404 });
        return res.status(404).json({ error: "Användaren hittades inte." });
      }

      const force = req.body?.force === true;
      const { ip, userAgent } = getClientMeta(req);
      const result = await withUserLock(targetId, async () => {
        const blocking = await isLastActiveOwnerOf(targetId);
        if (blocking.length > 0 && !force) {
          return { kind: "blocked" as const, blocking };
        }
        const impact = await storage.deleteUser(targetId);
        await storage.createAuditLog({
          tenantId: null,
          userId: actorId,
          action: "platform.user.delete",
          resourceType: "user",
          resourceId: targetId,
          changes: {
            deleted: {
              emailRedacted: redactPii(existing.email),
              firstNameRedacted: redactPii(existing.firstName),
              lastNameRedacted: redactPii(existing.lastName),
              createdAt: existing.createdAt,
            },
          },
          ipAddress: ip,
          userAgent,
          metadata: {
            reason: req.body?.reason ?? null,
            force,
            blockingTenants: blocking,
            fkImpact: impact.fkImpact,
            lostInviterInvitations: impact.lostInviterInvitations,
          },
        });
        return { kind: "ok" as const, blocking, impact };
      });
      if (result.kind === "blocked") {
        await logPlatformAccess(req, "platform.user.delete.blocked", targetId, {
          status: 409,
          blockingTenants: result.blocking,
          force: false,
        });
        return res.status(409).json({
          error: "Sista aktiva owner",
          message: `Användaren är enda aktiva owner i ${result.blocking.length} organisation(er): ${result.blocking.join(", ")}. Skicka { "force": true } tillsammans med confirm för att gå vidare.`,
          blockingTenants: result.blocking,
        });
      }
      res.json({
        success: true,
        fkImpact: result.impact.fkImpact,
        lostInviterInvitations: result.impact.lostInviterInvitations,
      });
    }),
  );

  // GET /api/platform/audit-log — plattformsåtgärder (cross-tenant)
  app.get(
    "/api/platform/audit-log",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {
      const limit = Math.min(parseInt((req.query.limit as string) || "200", 10), 500);
      // Endpointen är strikt låst till `platform.`-prefixet. Caller får
      // skicka in en understräng (t.ex. `user.delete`) men prefixet
      // tvingas alltid på server-side så endpointen aldrig kan användas
      // för att läsa tenant-audit-rader.
      const rawAction = (req.query.action as string) || "";
      const sanitized = rawAction.replace(/^platform\.?/, "").replace(/[^a-zA-Z0-9._-]/g, "");
      const actionFilter = `platform.${sanitized}`;
      const rows = await db
        .select()
        .from(auditLogs)
        .where(like(auditLogs.action, `${actionFilter}%`))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);
      await logPlatformAccess(req, "platform.audit-log.list", null, { limit, actionFilter });
      res.json(rows);
    }),
  );
}
