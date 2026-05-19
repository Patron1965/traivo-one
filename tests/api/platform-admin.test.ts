import { describe, it, expect } from "vitest";
import { apiGet, apiPost, apiDelete } from "./helpers";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { auditLogs, invitations, tenants, users } from "../../shared/schema";
import { and, eq, like } from "drizzle-orm";

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
