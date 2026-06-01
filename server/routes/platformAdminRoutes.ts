import type { Express, Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { auditLogs, userTenantRoles, tenants, users } from "@shared/schema";
import { requirePlatformOwner } from "../platform-owner-middleware";
import { AppError, ValidationError, ConflictError } from "../errors";

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
 * Nyckelnamn vars värden ska redakteras när vi skickar ut audit-log-
 * objekt (changes/metadata) i GDPR-exporter. Vi matchar case-insensitivt
 * på substring så både "email", "Email", "userEmail", "firstName",
 * "last_name", "fullName" osv fångas. Samma princip som
 * subject-redakteringen ovan — vi behåller hash+längd så incident-
 * jämförelser fortsatt fungerar utan att klartext lämnar systemet.
 */
const PII_KEY_PATTERNS = [/email/i, /firstname/i, /lastname/i, /fullname/i, /(^|_)name($|_)/i];

function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERNS.some((re) => re.test(key));
}

function redactPiiInJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactPiiInJson);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isPiiKey(k) && (typeof v === "string" || v === null)) {
        out[k] = redactPii(v);
      } else {
        out[k] = redactPiiInJson(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * Redakterar en hel audit-rad för export — `changes`/`metadata` rensas
 * från klartext-e-post/namn medan tekniska fält (id, action, ipAddress,
 * userAgent, tidsstämplar) lämnas orörda. Mobile-/portal-tokens i klar-
 * text bör inte ligga i audit_logs, men säkerhetsmarginalen i
 * `redactPiiInJson` ovan plockar bort namnsatta nyckelfält ändå.
 */
function redactAuditRowForExport<T extends { changes: unknown; metadata: unknown }>(row: T): T {
  return {
    ...row,
    changes: redactPiiInJson(row.changes),
    metadata: redactPiiInJson(row.metadata),
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
        throw new AppError("Användaren hittades inte.", 404, { code: "ERR_NOT_FOUND" });
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
        throw new ValidationError("Du kan inte anonymisera dig själv.");
      }
      const existing = await storage.getUser(targetId);
      if (!existing) {
        await logPlatformAccess(req, "platform.user.anonymize.notfound", targetId, { status: 404 });
        throw new AppError("Användaren hittades inte.", 404, { code: "ERR_NOT_FOUND" });
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
        throw new ConflictError("Sista aktiva owner", {
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
        throw new ValidationError("Du kan inte radera ditt eget konto.");
      }
      if (req.body?.confirm !== "RADERA") {
        await logPlatformAccess(req, "platform.user.delete.rejected", targetId, { status: 400, reason: "missing_confirm" });
        throw new ValidationError("Bekräftelse saknas", {
          message: 'Skicka { "confirm": "RADERA" } i body för att bekräfta hård radering.',
        });
      }
      const existing = await storage.getUser(targetId);
      if (!existing) {
        await logPlatformAccess(req, "platform.user.delete.notfound", targetId, { status: 404 });
        throw new AppError("Användaren hittades inte.", 404, { code: "ERR_NOT_FOUND" });
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
        throw new ConflictError("Sista aktiva owner", {
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

  // GET /api/platform/users/:id/history — full historik per användare
  // (komplett audit-tidslinje + alla medlemskap + senaste inloggningar).
  // Avsedd för incident-utredningar och GDPR-förfrågningar.
  app.get(
    "/api/platform/users/:id/history",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {
      const targetId = req.params.id;
      const user = await storage.getUser(targetId);
      if (!user) {
        await logPlatformAccess(req, "platform.user.history.notfound", targetId, { status: 404 });
        throw new AppError("Användaren hittades inte.", 404, { code: "ERR_NOT_FOUND" });
      }

      const parsedLimit = Number.parseInt((req.query.limit as string) || "100", 10);
      const parsedOffset = Number.parseInt((req.query.offset as string) || "0", 10);
      const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 100, 1), 500);
      const offset = Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0);

      // Hela tidslinjen: rader där användaren är aktör (userId) ELLER mål
      // (resourceId) — vi taggar varje rad så frontend kan visa rollen.
      const timelineRows = await db
        .select()
        .from(auditLogs)
        .where(or(eq(auditLogs.userId, targetId), eq(auditLogs.resourceId, targetId)))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset);

      const timeline = timelineRows.map((row) => {
        const isActor = row.userId === targetId;
        const isTarget = row.resourceId === targetId;
        const role: "actor" | "target" | "both" =
          isActor && isTarget ? "both" : isActor ? "actor" : "target";
        return { ...row, role };
      });

      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(or(eq(auditLogs.userId, targetId), eq(auditLogs.resourceId, targetId)));

      // Alla medlemskap (aktiva + inaktiva), nyaste först.
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
        .where(eq(userTenantRoles.userId, targetId))
        .orderBy(desc(userTenantRoles.createdAt));

      // Senaste inloggningar: i dag loggas inte explicita login-events i
      // audit_logs (vi har `users.lastLoginAt` istället). Vi tar med
      // eventuella framtida login-actions ("login", "auth.login*",
      // "*.login") så endpointen redan är förberedd, plus fallback med
      // senaste kända login-tidsstämpel från user-raden.
      const recentLogins = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.userId, targetId),
            or(
              eq(auditLogs.action, "login"),
              like(auditLogs.action, "auth.login%"),
              like(auditLogs.action, "%.login"),
            ),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(20);

      await logPlatformAccess(req, "platform.user.history.read", targetId, {
        limit,
        offset,
        timelineReturned: timeline.length,
        timelineTotal: totalCount,
        membershipCount: memberships.length,
        recentLoginsCount: recentLogins.length,
      });

      res.json({
        userId: targetId,
        lastLoginAt: user.lastLoginAt,
        timeline,
        timelineTotal: totalCount,
        limit,
        offset,
        memberships,
        recentLogins,
      });
    }),
  );

  // GET /api/platform/users/:id/history/export?format=csv|json
  // GDPR-export (art. 15 right of access). Streamar HELA tidslinjen
  // (alla audit-rader där användaren är aktör eller mål) + medlemskap +
  // inloggningar i ett paket. PII redakteras enligt samma princip som
  // resten av plattforms-loggen (SHA-256-prefix + längd för e-post/namn).
  // Själva exporten loggas som `platform.user.history.export`.
  app.get(
    "/api/platform/users/:id/history/export",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {
      const targetId = req.params.id;
      const format = ((req.query.format as string) || "json").toLowerCase();
      if (format !== "csv" && format !== "json") {
        throw new ValidationError("format måste vara 'csv' eller 'json'");
      }
      const user = await storage.getUser(targetId);
      if (!user) {
        await logPlatformAccess(req, "platform.user.history.export.notfound", targetId, {
          status: 404,
          format,
        });
        throw new AppError("Användaren hittades inte.", 404, { code: "ERR_NOT_FOUND" });
      }

      // Hämta medlemskap (komplett, inkl. inaktiva).
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
        .where(eq(userTenantRoles.userId, targetId))
        .orderBy(desc(userTenantRoles.createdAt));

      // Inloggningar (samma filter som /history-endpointen).
      const recentLoginsRaw = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.userId, targetId),
            or(
              eq(auditLogs.action, "login"),
              like(auditLogs.action, "auth.login%"),
              like(auditLogs.action, "%.login"),
            ),
          ),
        )
        .orderBy(desc(auditLogs.createdAt));
      const recentLogins = recentLoginsRaw.map(redactAuditRowForExport);

      // Räkna timeline-storleken upp front så vi kan logga den.
      const [{ count: timelineTotal }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(or(eq(auditLogs.userId, targetId), eq(auditLogs.resourceId, targetId)));

      const generatedAt = new Date().toISOString();
      const safeFilename = `traivo-user-history-${targetId}-${generatedAt.slice(0, 10)}`;
      const subject = {
        userId: targetId,
        emailRedacted: redactPii(user.email),
        firstNameRedacted: redactPii(user.firstName),
        lastNameRedacted: redactPii(user.lastName),
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      };

      // Chunkad iteration över hela tidslinjen — undviker att läsa
      // hundratusentals rader i minnet på en gång. 1000/chunk är en bra
      // kompromiss mellan round-trips och RAM. Vi streamar direkt till
      // klienten så svaret kan börja flöda omedelbart.
      const CHUNK = 1000;
      const tagRole = (row: { userId: string | null; resourceId: string | null }) => {
        const isActor = row.userId === targetId;
        const isTarget = row.resourceId === targetId;
        return isActor && isTarget ? "both" : isActor ? "actor" : "target";
      };

      if (format === "json") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}.json"`);
        res.write(
          `{"generatedAt":${JSON.stringify(generatedAt)},` +
            `"subject":${JSON.stringify(subject)},` +
            `"memberships":${JSON.stringify(memberships)},` +
            `"recentLogins":${JSON.stringify(recentLogins)},` +
            `"timelineTotal":${timelineTotal},` +
            `"timeline":[`,
        );
        let offset = 0;
        let written = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const chunk = await db
            .select()
            .from(auditLogs)
            .where(or(eq(auditLogs.userId, targetId), eq(auditLogs.resourceId, targetId)))
            .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
            .limit(CHUNK)
            .offset(offset);
          for (const row of chunk) {
            const tagged = { ...redactAuditRowForExport(row), role: tagRole(row) };
            res.write((written === 0 ? "" : ",") + JSON.stringify(tagged));
            written += 1;
          }
          if (chunk.length < CHUNK) break;
          offset += CHUNK;
        }
        res.write("]}");
        res.end();
        await logPlatformAccess(req, "platform.user.history.export", targetId, {
          format,
          timelineExported: written,
          timelineTotal,
          membershipCount: memberships.length,
          recentLoginsCount: recentLogins.length,
        });
        return;
      }

      // CSV: header med metadata-kommentarer + tre sektioner (subject,
      // memberships, recent_logins, timeline). En enda fil med tydliga
      // section-headers så Excel/LibreOffice fortfarande kan öppna den.
      const csvEscape = (value: unknown): string => {
        if (value == null) return "";
        const s = typeof value === "object" ? JSON.stringify(value) : String(value);
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const writeRow = (cells: unknown[]) => res.write(cells.map(csvEscape).join(",") + "\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}.csv"`);
      res.write(`# Traivo user history export\n`);
      res.write(`# generatedAt,${generatedAt}\n`);
      res.write(`# userId,${targetId}\n`);
      res.write(`# timelineTotal,${timelineTotal}\n\n`);

      res.write(`## subject\n`);
      writeRow([
        "userId",
        "emailHash",
        "emailLength",
        "firstNameHash",
        "firstNameLength",
        "lastNameHash",
        "lastNameLength",
        "isActive",
        "lastLoginAt",
        "createdAt",
      ]);
      writeRow([
        subject.userId,
        subject.emailRedacted?.hash ?? "",
        subject.emailRedacted?.length ?? "",
        subject.firstNameRedacted?.hash ?? "",
        subject.firstNameRedacted?.length ?? "",
        subject.lastNameRedacted?.hash ?? "",
        subject.lastNameRedacted?.length ?? "",
        subject.isActive,
        subject.lastLoginAt,
        subject.createdAt,
      ]);
      res.write("\n");

      res.write(`## memberships\n`);
      writeRow(["tenantId", "tenantName", "role", "isActive", "assignedBy", "createdAt"]);
      for (const m of memberships) {
        writeRow([m.tenantId, m.tenantName, m.role, m.isActive, m.assignedBy, m.createdAt]);
      }
      res.write("\n");

      res.write(`## recent_logins\n`);
      writeRow(["id", "action", "createdAt", "ipAddress", "userAgent", "changes", "metadata"]);
      for (const r of recentLogins) {
        writeRow([r.id, r.action, r.createdAt, r.ipAddress, r.userAgent, r.changes, r.metadata]);
      }
      res.write("\n");

      res.write(`## timeline\n`);
      writeRow([
        "id",
        "createdAt",
        "role",
        "action",
        "resourceType",
        "resourceId",
        "userId",
        "ipAddress",
        "userAgent",
        "changes",
        "metadata",
      ]);
      let offset = 0;
      let written = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const chunk = await db
          .select()
          .from(auditLogs)
          .where(or(eq(auditLogs.userId, targetId), eq(auditLogs.resourceId, targetId)))
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(CHUNK)
          .offset(offset);
        for (const rawRow of chunk) {
          const row = redactAuditRowForExport(rawRow);
          writeRow([
            row.id,
            row.createdAt,
            tagRole(rawRow),
            row.action,
            row.resourceType,
            row.resourceId,
            row.userId,
            row.ipAddress,
            row.userAgent,
            row.changes,
            row.metadata,
          ]);
          written += 1;
        }
        if (chunk.length < CHUNK) break;
        offset += CHUNK;
      }
      res.end();
      await logPlatformAccess(req, "platform.user.history.export", targetId, {
        format,
        timelineExported: written,
        timelineTotal,
        membershipCount: memberships.length,
        recentLoginsCount: recentLogins.length,
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

  // GET /api/platform/logins — cross-user, filterbar inloggningshistorik.
  // Läser auth.login* från audit_logs och joinar med users så vi kan visa
  // e-post/namn även för borttagna/anonymiserade konton (då är user-raden
  // borta men metadata.email finns kvar fram tills audit-rensning).
  //
  // Stödjer filter: outcome (success|failed), method (replit|password|
  // portal|mobile), tenantId, ip (exakt eller substring), q (fri-text mot
  // metadata.email, users.email, ip), from/to (ISO-tidsstämpel),
  // limit/offset, format=csv för export.
  app.get(
    "/api/platform/logins",
    requirePlatformOwner,
    asyncHandler(async (req, res) => {
      const outcome = (req.query.outcome as string) || "";
      const method = (req.query.method as string) || "";
      const tenantId = (req.query.tenantId as string) || "";
      const ip = (req.query.ip as string) || "";
      const q = ((req.query.q as string) || "").trim();
      const from = (req.query.from as string) || "";
      const to = (req.query.to as string) || "";
      const format = ((req.query.format as string) || "json").toLowerCase();
      const CSV_MAX = 50000;
      const JSON_MAX = 1000;
      // CSV-läget ignorerar ALLTID caller-angiven `limit`/`offset` och
      // exporterar hela det filtrerade datasetet upp till CSV_MAX. Det
      // stänger fönstret där en API-konsument kan trigga tyst
      // trunkering genom att glömma höja limit — direkt farligt för
      // GDPR/incident-utredningar. JSON-läget defaultar till 200 och
      // tar emot caller-limit upp till JSON_MAX.
      const parsedLimit = Number.parseInt((req.query.limit as string) || "200", 10);
      const parsedOffset = Number.parseInt((req.query.offset as string) || "0", 10);
      const limit =
        format === "csv"
          ? CSV_MAX
          : Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 200, 1), JSON_MAX);
      const offset =
        format === "csv" ? 0 : Math.max(Number.isFinite(parsedOffset) ? parsedOffset : 0, 0);

      const conditions = [
        or(eq(auditLogs.action, "auth.login"), eq(auditLogs.action, "auth.login.failed")),
      ];

      if (outcome === "success") {
        conditions.push(eq(auditLogs.action, "auth.login"));
      } else if (outcome === "failed") {
        conditions.push(eq(auditLogs.action, "auth.login.failed"));
      }

      const validMethods = new Set(["replit", "password", "portal", "mobile"]);
      if (method && validMethods.has(method)) {
        conditions.push(sql`${auditLogs.metadata}->>'method' = ${method}`);
      }

      if (tenantId) {
        conditions.push(eq(auditLogs.tenantId, tenantId));
      }

      if (ip) {
        conditions.push(sql`${auditLogs.ipAddress} ILIKE ${"%" + ip + "%"}`);
      }

      if (q) {
        const like = `%${q}%`;
        conditions.push(
          sql`(${auditLogs.metadata}->>'email' ILIKE ${like}
               OR ${users.email} ILIKE ${like}
               OR ${auditLogs.ipAddress} ILIKE ${like})`,
        );
      }

      if (from) {
        const d = new Date(from);
        if (!Number.isNaN(d.getTime())) {
          conditions.push(sql`${auditLogs.createdAt} >= ${d.toISOString()}`);
        }
      }
      if (to) {
        const d = new Date(to);
        if (!Number.isNaN(d.getTime())) {
          conditions.push(sql`${auditLogs.createdAt} <= ${d.toISOString()}`);
        }
      }

      const whereExpr = and(...conditions);

      const rowsQuery = db
        .select({
          id: auditLogs.id,
          createdAt: auditLogs.createdAt,
          userId: auditLogs.userId,
          tenantId: auditLogs.tenantId,
          action: auditLogs.action,
          ipAddress: auditLogs.ipAddress,
          userAgent: auditLogs.userAgent,
          metadata: auditLogs.metadata,
          userEmail: users.email,
          userFirstName: users.firstName,
          userLastName: users.lastName,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.userId))
        .where(whereExpr)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset);

      if (format === "csv") {
        const rows = await rowsQuery;
        await logPlatformAccess(req, "platform.logins.export", null, {
          format: "csv",
          returned: rows.length,
          filters: { outcome, method, tenantId, ip, q, from, to },
        });
        const csvEscape = (value: unknown): string => {
          if (value == null) return "";
          const s = typeof value === "object" ? JSON.stringify(value) : String(value);
          if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="traivo-logins-${new Date().toISOString().slice(0, 10)}.csv"`,
        );
        res.write(
          [
            "createdAt",
            "outcome",
            "method",
            "tenantId",
            "userId",
            "userEmail",
            "metadataEmail",
            "firstName",
            "lastName",
            "ipAddress",
            "userAgent",
            "reason",
          ].join(",") + "\n",
        );
        for (const r of rows) {
          const meta = (r.metadata ?? {}) as Record<string, unknown>;
          const outcomeVal = r.action === "auth.login" ? "success" : "failed";
          res.write(
            [
              r.createdAt,
              outcomeVal,
              meta.method ?? "",
              r.tenantId ?? "",
              r.userId ?? "",
              r.userEmail ?? "",
              meta.email ?? "",
              r.userFirstName ?? "",
              r.userLastName ?? "",
              r.ipAddress ?? "",
              r.userAgent ?? "",
              meta.reason ?? "",
            ]
              .map(csvEscape)
              .join(",") + "\n",
          );
        }
        res.end();
        return;
      }

      const [rows, totalRow] = await Promise.all([
        rowsQuery,
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(auditLogs)
          .leftJoin(users, eq(users.id, auditLogs.userId))
          .where(whereExpr),
      ]);
      const total = totalRow[0]?.count ?? 0;

      const shaped = rows.map((r) => {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          createdAt: r.createdAt,
          outcome: r.action === "auth.login" ? "success" : "failed",
          action: r.action,
          method: (meta.method as string | undefined) ?? null,
          reason: (meta.reason as string | undefined) ?? null,
          metadataEmail: (meta.email as string | undefined) ?? null,
          tenantId: r.tenantId,
          userId: r.userId,
          userEmail: r.userEmail,
          userFirstName: r.userFirstName,
          userLastName: r.userLastName,
          ipAddress: r.ipAddress,
          userAgent: r.userAgent,
        };
      });

      await logPlatformAccess(req, "platform.logins.list", null, {
        returned: shaped.length,
        total,
        limit,
        offset,
        filters: { outcome, method, tenantId, ip, q, from, to },
      });

      res.json({ logins: shaped, total, limit, offset });
    }),
  );
}
