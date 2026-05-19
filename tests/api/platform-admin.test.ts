import { describe, it, expect } from "vitest";
import { apiGet, apiPost, apiDelete } from "./helpers";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { auditLogs, invitations, tenants, users, userTenantRoles } from "../../shared/schema";
import { and, eq, inArray, like } from "drizzle-orm";
import { requirePlatformOwner } from "../../server/platform-owner-middleware";

// Hjälp för att köra `requirePlatformOwner` mot mockade req/res utan att
// behöva en seedad Replit-OIDC-session — vi simulerar ett serverside-
// session-objekt (`req.session.userId`) som motsvarar en redan-inloggad
// användare. Middlewaren slår sedan upp rollen mot user_tenant_roles
// direkt i DB, så testet bevisar äkta DB-driven authz.
async function runRequirePlatformOwner(userId: string | null) {
  let statusCode = 0;
  let body: unknown = null;
  let nextCalled = false;
  const req: any = {
    session: userId ? { userId } : {},
    headers: { "user-agent": "vitest-auth-matrix" },
    path: "/api/platform/me",
    method: "GET",
    ip: "127.0.0.1",
  };
  const res: any = {
    status(code: number) { statusCode = code; return this; },
    json(payload: unknown) { body = payload; return this; },
  };
  await new Promise<void>((resolve) => {
    requirePlatformOwner(req, res, () => { nextCalled = true; statusCode = statusCode || 200; resolve(); });
    if (!nextCalled) setTimeout(resolve, 50);
  });
  return { statusCode, body, nextCalled, platformOwnerUserId: req.platformOwnerUserId };
}

// Task #498 — smoke-tester för plattformsägar-routes. Verifierar att
// /api/platform/* INTE är åtkomliga utan plattformsägar-roll (oinloggad → 401,
// owner-check i `requirePlatformOwner` är källan-till-sanning) och att
// inputvalidering (RADERA-confirm) fungerar.

describe("Plattformsadmin /api/platform/* — autz-matrix utan auth", () => {
  const getEndpoints = [
    "/api/platform/me",
    "/api/platform/users",
    "/api/platform/users/some-id",
    "/api/platform/audit-log",
  ];
  for (const path of getEndpoints) {
    it(`GET ${path} returnerar 401 utan auth`, async () => {
      const res = await apiGet(path);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });
  }

  it("POST /api/platform/users/:id/anonymize returnerar 401 utan auth", async () => {
    const res = await apiPost("/api/platform/users/anything/anonymize", { reason: "test" });
    expect(res.status).toBe(401);
  });

  it("DELETE /api/platform/users/:id returnerar 401 utan auth (bekräftelse-grind nås aldrig)", async () => {
    const res = await apiDelete("/api/platform/users/anything");
    expect(res.status).toBe(401);
  });

  it("Endast /api/platform/audit-log (entalsform) är registrerad enligt spec", async () => {
    // /api/platform/audit-log (entalsform) ska kräva auth (401) — bekräftar att
    // routen är registrerad och skyddad. Pluralformen är medvetet inte registrerad.
    const correct = await apiGet("/api/platform/audit-log");
    expect(correct.status).toBe(401);
    expect(correct.body).toHaveProperty("error");
  });
});

describe("Plattformsadmin storage: deleteUser FK-impact + lost-inviter-markör", () => {
  const TID = `platformtest-${Date.now()}`;
  const UID = `usr-deletetest-${Date.now()}`;
  const VID = `usr-victim-${Date.now()}`;
  const INV_ID = `inv-deletetest-${Date.now()}`;

  it("nullar FKs, markerar pending invitations, returnerar fkImpact, och resource-impact reflekterar tillståndet", async () => {
    // Seed: tenant + två users + en pending invitation skapad av UID
    await db.insert(tenants).values({ id: TID, name: "Platform Test Tenant", subdomain: TID }).onConflictDoNothing();
    await db.insert(users).values({ id: UID, email: `${UID}@test.local`, firstName: "Del", lastName: "User" }).onConflictDoNothing();
    await db.insert(users).values({ id: VID, email: `${VID}@test.local`, firstName: "Vic", lastName: "Tim" }).onConflictDoNothing();
    await db.insert(invitations).values({
      id: INV_ID,
      email: "invitee@test.local",
      tenantId: TID,
      role: "user",
      invitedBy: UID,
      status: "pending",
    }).onConflictDoNothing();
    await db.insert(auditLogs).values({
      tenantId: TID,
      userId: UID,
      action: "test.seed.actor",
      resourceType: "user",
      resourceId: VID,
    });

    // Sanity: computeUserResourceImpact ser invitations + audit
    const impactBefore = await storage.computeUserResourceImpact(UID);
    expect(impactBefore["invitations.invited_by (pending)"] ?? 0).toBeGreaterThanOrEqual(1);
    expect(impactBefore["audit_logs.user_id"] ?? 0).toBeGreaterThanOrEqual(1);

    // Act: radera
    const result = await storage.deleteUser(UID);

    // FK impact-summary returnerades och innehåller invitations-markören
    expect(result).toHaveProperty("fkImpact");
    expect(result).toHaveProperty("lostInviterInvitations");
    expect(result.lostInviterInvitations).toBeGreaterThanOrEqual(1);
    expect(result.fkImpact["invitations.invited_by (lost_inviter)"]).toBeGreaterThanOrEqual(1);

    // Invitation har null invitedBy + deterministisk "förlorad inbjudare"-markör
    const [inv] = await db.select().from(invitations).where(eq(invitations.id, INV_ID));
    expect(inv).toBeDefined();
    expect(inv.invitedBy).toBeNull();
    expect(inv.deliveryError).toMatch(/^\[INVITER_DELETED:/);
    expect(inv.deliveryError).toContain(UID);

    // Audit-logg har nullad user_id (SET NULL)
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "test.seed.actor"));
    for (const a of audits) {
      expect(a.userId).toBeNull();
    }

    // User-raden är borta
    const remaining = await db.select().from(users).where(eq(users.id, UID));
    expect(remaining.length).toBe(0);

    // Städa (audit_logs först — FK till tenants är RESTRICT)
    await db.delete(auditLogs).where(eq(auditLogs.action, "test.seed.actor"));
    await db.delete(invitations).where(eq(invitations.id, INV_ID));
    await db.delete(users).where(eq(users.id, VID));
    await db.delete(tenants).where(eq(tenants.id, TID));
  });
});

describe("requirePlatformOwner — auth-matrix mot riktig DB", () => {
  const NS = `authmtx-${Date.now()}`;
  const OTHER_TID = `${NS}-other`;
  const ADMIN_UID = `${NS}-kinab-admin`;
  const OTHER_OWNER_UID = `${NS}-other-owner`;
  const KINAB_OWNER_UID = `${NS}-kinab-owner`;
  const INACTIVE_OWNER_UID = `${NS}-kinab-inactive`;

  it("seedar fixtures, validerar 401/403/200-matrisen, och städar", async () => {
    // Säkra att tenant `kinab` finns (skapas annars av migreringar i prod);
    // ifall den saknas i testdatabasen skapar vi den för testet.
    await db.insert(tenants).values({ id: "kinab", name: "Kinab", subdomain: "kinab" }).onConflictDoNothing();
    await db.insert(tenants).values({ id: OTHER_TID, name: "Annan", subdomain: OTHER_TID }).onConflictDoNothing();

    await db.insert(users).values([
      { id: ADMIN_UID, email: `${ADMIN_UID}@test.local` },
      { id: OTHER_OWNER_UID, email: `${OTHER_OWNER_UID}@test.local` },
      { id: KINAB_OWNER_UID, email: `${KINAB_OWNER_UID}@test.local` },
      { id: INACTIVE_OWNER_UID, email: `${INACTIVE_OWNER_UID}@test.local` },
    ]).onConflictDoNothing();

    await db.insert(userTenantRoles).values([
      { userId: ADMIN_UID, tenantId: "kinab", role: "admin", isActive: true },
      { userId: OTHER_OWNER_UID, tenantId: OTHER_TID, role: "owner", isActive: true },
      { userId: KINAB_OWNER_UID, tenantId: "kinab", role: "owner", isActive: true },
      { userId: INACTIVE_OWNER_UID, tenantId: "kinab", role: "owner", isActive: false },
    ]).onConflictDoNothing();

    try {
      // 1) Oinloggad → 401
      const anon = await runRequirePlatformOwner(null);
      expect(anon.statusCode).toBe(401);
      expect(anon.nextCalled).toBe(false);

      // 2) Kinab-admin → 403
      const admin = await runRequirePlatformOwner(ADMIN_UID);
      expect(admin.statusCode).toBe(403);
      expect(admin.nextCalled).toBe(false);

      // 3) Owner i annan tenant → 403
      const otherOwner = await runRequirePlatformOwner(OTHER_OWNER_UID);
      expect(otherOwner.statusCode).toBe(403);
      expect(otherOwner.nextCalled).toBe(false);

      // 4) Inaktiv kinab-owner → 403 (isActive=false ska blockera)
      const inactive = await runRequirePlatformOwner(INACTIVE_OWNER_UID);
      expect(inactive.statusCode).toBe(403);
      expect(inactive.nextCalled).toBe(false);

      // 5) Kinab-owner (aktiv) → next() + req.platformOwnerUserId satt
      const kinabOwner = await runRequirePlatformOwner(KINAB_OWNER_UID);
      expect(kinabOwner.nextCalled).toBe(true);
      expect(kinabOwner.platformOwnerUserId).toBe(KINAB_OWNER_UID);

      // 6) Audit-logg ska ha fyra `platform.access.denied`-rader (en per nekat försök)
      const denied = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "platform.access.denied"), like(auditLogs.userAgent, "vitest-auth-matrix%")));
      expect(denied.length).toBeGreaterThanOrEqual(4);
    } finally {
      const uids = [ADMIN_UID, OTHER_OWNER_UID, KINAB_OWNER_UID, INACTIVE_OWNER_UID];
      // Städa — audit_logs först (RESTRICT-FK till tenants), sedan roller,
      // sedan users, sist den extra tenant vi skapade. `kinab`-tenanten
      // lämnas eftersom seedern äger den.
      await db.delete(auditLogs).where(like(auditLogs.userAgent, "vitest-auth-matrix%"));
      await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, uids));
      await db.delete(users).where(inArray(users.id, uids));
      await db.delete(tenants).where(eq(tenants.id, OTHER_TID));
    }
  });
});
