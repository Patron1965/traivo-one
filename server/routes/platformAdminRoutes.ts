import type { Express, Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { auditLogs, userTenantRoles } from "@shared/schema";
import { and, desc, eq, like } from "drizzle-orm";
import { requirePlatformOwner } from "../platform-owner-middleware";

/**
 * Redaktera PII för audit-loggar: lagrar SHA-256-hash + längd så att
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
 * Kör en plattforms-mutation under ett Postgres advisory-lås per target-user.
 * Detta serialiserar samtidiga plattforms-admin-anrop mot samma användare och
 * stänger TOCTOU-fönstret mellan "sista aktiva owner"-kontrollen och själva
 * mutationen.
 */
async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  // pg_advisory_xact_lock släpps automatiskt vid transaktionsslut.
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
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

async function isLastActiveOwnerOf(userId: string): Promise<string[]> {
  // Returnera tenant-IDs där användaren är ENDA aktiva owner.
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
    const hasOtherActiveOwner = otherOwners.some((r) => r.id) && otherOwners.length > 1;
    if (!hasOtherActiveOwner) blocking.push(tenantId);
  }
  return blocking;
}

export function registerPlatformAdminRoutes(app: Express): void {
  // GET /api/platform/users — alla användare cross-tenant + medlemskap
  app.get(
    "/api/platform/users",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {
      const search = ((req.query.q as string) || "").trim().toLowerCase();
      const rows = await storage.listAllUsersWithTenants();
      const filtered = search
        ? rows.filter((u) => {
            const hay = [
              u.email ?? "",
              u.firstName ?? "",
              u.lastName ?? "",
              u.id,
              ...u.memberships.map((m) => `${m.tenantId} ${m.tenantName} ${m.role}`),
            ]
              .join(" ")
              .toLowerCase();
            return hay.includes(search);
          })
        : rows;
      const safe = filtered.map(({ passwordHash, ...u }) => u);
      res.json(safe);
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
        return res.status(400).json({ error: "Du kan inte anonymisera dig själv." });
      }
      const existing = await storage.getUser(targetId);
      if (!existing) {
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
        return res.status(409).json({
          error: "Sista aktiva owner",
          message: `Användaren är enda aktiva owner i ${result.blocking.length} organisation(er): ${result.blocking.join(", ")}. Skicka { "force": true } för att gå vidare.`,
          blockingTenants: result.blocking,
        });
      }
      const { ip, userAgent } = getClientMeta(req);
      await storage.createAuditLog({
        tenantId: null as any,
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
        return res.status(400).json({ error: "Du kan inte radera ditt eget konto." });
      }
      // Klient måste skicka { "confirm": "RADERA" } för att förhindra misstag
      if (req.body?.confirm !== "RADERA") {
        return res.status(400).json({
          error: "Bekräftelse saknas",
          message: 'Skicka { "confirm": "RADERA" } i body för att bekräfta hård radering.',
        });
      }
      const existing = await storage.getUser(targetId);
      if (!existing) {
        return res.status(404).json({ error: "Användaren hittades inte." });
      }

      const force = req.body?.force === true;
      const { ip, userAgent } = getClientMeta(req);
      const result = await withUserLock(targetId, async () => {
        const blocking = await isLastActiveOwnerOf(targetId);
        if (blocking.length > 0 && !force) {
          return { kind: "blocked" as const, blocking };
        }
        // Logga FÖRE radering så att resourceId bevaras även om users-raden tas bort.
        // PII redakteras (hash + längd) för GDPR right-to-erasure-kompatibilitet.
        await storage.createAuditLog({
          tenantId: null as any,
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
          metadata: { reason: req.body?.reason ?? null, force, blockingTenants: blocking },
        });
        await storage.deleteUser(targetId);
        return { kind: "ok" as const, blocking };
      });
      if (result.kind === "blocked") {
        return res.status(409).json({
          error: "Sista aktiva owner",
          message: `Användaren är enda aktiva owner i ${result.blocking.length} organisation(er): ${result.blocking.join(", ")}. Skicka { "force": true } tillsammans med confirm för att gå vidare.`,
          blockingTenants: result.blocking,
        });
      }
      res.json({ success: true });
    }),
  );

  // GET /api/platform/audit-logs — plattformsåtgärder (cross-tenant)
  app.get(
    "/api/platform/audit-logs",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {
      const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 500);
      const actionFilter = (req.query.action as string) || "platform.";
      const rows = await db
        .select()
        .from(auditLogs)
        .where(like(auditLogs.action, `${actionFilter}%`))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);
      res.json(rows);
    }),
  );
}
