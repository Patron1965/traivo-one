/**
 * Integrationstester för Clerk JIT-provisioning (server/middlewares/requireAuth.ts).
 *
 * Kör mot riktiga dev-databasen med mockad Clerk-klient. Täcker:
 *  1. Migrerad användare: legacy-ID resolvas via Clerk externalId (server-side,
 *     utan att lita på sessionclaims) och den befintliga raden återanvänds.
 *  2. Inbjuden ny användare: JIT skapar rad och konsumerar pending-inbjudan
 *     → exakt förväntad tenant-roll.
 *  3. Inaktiverad användare: nekas (jitProvisionUser → undefined) trots giltig
 *     Clerk-session.
 *  4. E-postlänkning: befintlig lokal rad med samma verifierade e-post
 *     adopteras istället för dublett-insert.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const clerkUsers = new Map<string, { externalId: string | null; email: string | null; verified?: boolean }>();

let mockAuth: { userId: string; sessionClaims: Record<string, unknown> } | null = null;

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(() => mockAuth),
  clerkClient: {
    users: {
      getUser: vi.fn(async (id: string) => {
        const u = clerkUsers.get(id);
        if (!u) throw new Error("not found");
        const verification = { status: u.verified === false ? "unverified" : "verified" };
        return {
          id,
          externalId: u.externalId,
          primaryEmailAddress: u.email ? { emailAddress: u.email, verification } : null,
          emailAddresses: u.email ? [{ emailAddress: u.email, verification }] : [],
        };
      }),
      getUserList: vi.fn(async () => ({ data: [], totalCount: 0 })),
      banUser: vi.fn(async () => ({})),
      unbanUser: vi.fn(async () => ({})),
    },
  },
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

import { jitProvisionUser, resolveRequestUser } from "../../server/middlewares/requireAuth";
import { getUserTenants } from "../../server/tenant-middleware";
import { db } from "../../server/db";
import { users, userTenantRoles, invitations, tenants } from "@shared/schema";
import { eq, inArray, like } from "drizzle-orm";

const RUN = `jitclerk-${Date.now()}`;
const LEGACY_ID = `${RUN}-legacy`;
const LEGACY_EMAIL = `${RUN}-legacy@test.local`;
const INVITED_EMAIL = `${RUN}-invited@test.local`;
const INVITED_UNVERIFIED_EMAIL = `${RUN}-invited-unverified@test.local`;
const INACTIVE_ID = `${RUN}-inactive`;
const EMAILLINK_ID = `${RUN}-emaillink`;
const EMAILLINK_EMAIL = `${RUN}-emaillink@test.local`;
const TENANT_ID = "kinab";

const createdUserIds: string[] = [];

beforeAll(async () => {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, TENANT_ID)).limit(1);
  expect(tenant, `tenant '${TENANT_ID}' måste finnas i dev-DB`).toBeTruthy();

  await db.insert(users).values([
    { id: LEGACY_ID, email: LEGACY_EMAIL, isActive: true },
    { id: INACTIVE_ID, email: `${RUN}-inactive@test.local`, isActive: false },
    { id: EMAILLINK_ID, email: EMAILLINK_EMAIL, isActive: true },
  ]);
  createdUserIds.push(LEGACY_ID, INACTIVE_ID, EMAILLINK_ID);

  await db.insert(invitations).values([
    { email: INVITED_EMAIL, tenantId: TENANT_ID, role: "planner", status: "pending" },
    { email: INVITED_UNVERIFIED_EMAIL, tenantId: TENANT_ID, role: "planner", status: "pending" },
  ]);
});

afterAll(async () => {
  await db.delete(invitations).where(like(invitations.email, `${RUN}-%`));
  const ids = [...createdUserIds];
  const extra = await db.select().from(users).where(like(users.email, `${RUN}-%`));
  for (const u of extra) if (!ids.includes(u.id)) ids.push(u.id);
  if (ids.length) {
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, ids));
    await db.delete(users).where(inArray(users.id, ids));
  }
});

describe("Clerk JIT-provisioning", () => {
  it("migrerad användare: resolvar legacy-ID via Clerk externalId utan sessionclaims", async () => {
    const clerkId = `user_${RUN}_migrated`;
    clerkUsers.set(clerkId, { externalId: LEGACY_ID, email: LEGACY_EMAIL });

    const dbUser = await jitProvisionUser(clerkId, {}); // inga claims alls
    expect(dbUser?.id).toBe(LEGACY_ID);
  });

  it("förfalskad sessionClaims.userId ignoreras — identiteten binds via API-externalId", async () => {
    const clerkId = `user_${RUN}_claimspoof`;
    // Clerk-API:t (auktoritativt) saknar externalId → identitet = Clerk-native ID.
    clerkUsers.set(clerkId, { externalId: null, email: null });

    // Angriparen försöker binda sessionen till en priviligierad befintlig
    // lokal användare via en token-claim.
    const dbUser = await jitProvisionUser(clerkId, { userId: LEGACY_ID });
    expect(dbUser?.id).toBe(clerkId);
    expect(dbUser?.id).not.toBe(LEGACY_ID);
    createdUserIds.push(clerkId);
  });

  it("Clerk-API-fel → fail closed (ingen identitetsbindning)", async () => {
    const clerkId = `user_${RUN}_apifail`;
    // Inte registrerad i mocken → getUser kastar.
    const dbUser = await jitProvisionUser(clerkId, { userId: LEGACY_ID });
    expect(dbUser).toBeUndefined();
  });

  it("inbjuden ny användare: skapas och får exakt inbjudans tenant-roll", async () => {
    const clerkId = `user_${RUN}_invited`;
    clerkUsers.set(clerkId, { externalId: null, email: INVITED_EMAIL });

    const dbUser = await jitProvisionUser(clerkId, {});
    expect(dbUser).toBeTruthy();
    expect(dbUser!.id).toBe(clerkId);
    createdUserIds.push(clerkId);

    const roles = await db
      .select()
      .from(userTenantRoles)
      .where(eq(userTenantRoles.userId, clerkId));
    const kinabRole = roles.find((r) => r.tenantId === TENANT_ID);
    expect(kinabRole?.role).toBe("planner");

    const [invite] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.email, INVITED_EMAIL));
    expect(invite.status).toBe("used");
    expect(invite.usedBy).toBe(clerkId);
  });

  it("inaktiverad användare nekas trots giltig Clerk-session", async () => {
    const clerkId = `user_${RUN}_inactive`;
    clerkUsers.set(clerkId, { externalId: INACTIVE_ID, email: null });

    const dbUser = await jitProvisionUser(clerkId, {});
    expect(dbUser).toBeUndefined();
  });

  it("OVERIFIERAD e-post konsumerar INTE inbjudan och adopterar INGEN rad", async () => {
    const clerkId = `user_${RUN}_unverified`;
    // Samma e-post som en befintlig lokal rad + som en pending-inbjudan hade
    // kunnat matcha — men adressen är overifierad → får inte länkas.
    clerkUsers.set(clerkId, { externalId: null, email: EMAILLINK_EMAIL, verified: false });

    const dbUser = await jitProvisionUser(clerkId, {});
    // Ingen adoption av EMAILLINK_ID-raden — en NY rad utan e-post skapas.
    expect(dbUser?.id).toBe(clerkId);
    expect(dbUser?.email).toBeNull();
    createdUserIds.push(clerkId);

    // Ingen inbjudningsroll — endast ev. dev-only default-tilldelning ("user")
    // via ensureDefaultTenantAssignment (avstängd i prod utan AUTO_ASSIGN_TENANT).
    const roles = await db
      .select()
      .from(userTenantRoles)
      .where(eq(userTenantRoles.userId, clerkId));
    expect(roles.some((r) => r.role === "planner")).toBe(false);
  });

  it("overifierad e-post på inbjuden användare ger ingen inbjudningsroll", async () => {
    const clerkId = `user_${RUN}_unverified_invite`;
    clerkUsers.set(clerkId, { externalId: null, email: INVITED_UNVERIFIED_EMAIL, verified: false });

    const dbUser = await jitProvisionUser(clerkId, {});
    expect(dbUser?.id).toBe(clerkId);
    createdUserIds.push(clerkId);

    const roles = await db
      .select()
      .from(userTenantRoles)
      .where(eq(userTenantRoles.userId, clerkId));
    expect(roles.some((r) => r.role === "planner")).toBe(false);

    // Inbjudan är fortfarande pending — får inte konsumeras av overifierad adress.
    const [invite] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.email, INVITED_UNVERIFIED_EMAIL));
    expect(invite.status).toBe("pending");
  });

  it("pending-inbjudningar i FLERA tenants → ingen konsumeras (fail closed)", async () => {
    const clerkId = `user_${RUN}_multitenant`;
    const email = `${RUN}-multitenant@test.local`;
    const otherTenants = await db.select().from(tenants).limit(2);
    expect(otherTenants.length).toBeGreaterThanOrEqual(2);
    const tenantB = otherTenants.find((t) => t.id !== TENANT_ID)?.id ?? otherTenants[1].id;

    await db.insert(invitations).values([
      { email, tenantId: TENANT_ID, role: "planner", status: "pending" },
      { email, tenantId: tenantB, role: "admin", status: "pending" },
    ]);

    clerkUsers.set(clerkId, { externalId: null, email });
    const dbUser = await jitProvisionUser(clerkId, {});
    expect(dbUser).toBeTruthy();
    createdUserIds.push(clerkId);

    const roles = await db
      .select()
      .from(userTenantRoles)
      .where(eq(userTenantRoles.userId, clerkId));
    // Inga inbjudningsroller alls — fail closed vid tvetydighet.
    expect(roles.some((r) => r.role === "planner" || r.role === "admin")).toBe(false);

    const invites = await db.select().from(invitations).where(eq(invitations.email, email));
    expect(invites.every((i) => i.status === "pending")).toBe(true);
  });

  it("resolveRequestUser: Clerk-session ger dbUser+shim och tenant-uppslag (som /api/me/tenant)", async () => {
    const clerkId = `user_${RUN}_resolve`;
    const email = `${RUN}-resolve@test.local`;
    // Egen pending-inbjudan → användaren får en tenant-roll vid JIT.
    await db.insert(invitations).values({
      email,
      tenantId: TENANT_ID,
      role: "planner",
      status: "pending",
    });
    clerkUsers.set(clerkId, { externalId: null, email });

    mockAuth = { userId: clerkId, sessionClaims: {} };
    try {
      const req: any = {};
      const dbUser = await resolveRequestUser(req);
      expect(dbUser?.id).toBe(clerkId);
      createdUserIds.push(clerkId);
      expect(req.dbUser?.id).toBe(clerkId);
      expect(req.user?.claims?.sub).toBe(clerkId);

      // Samma uppslag som GET /api/me/tenant gör med det resolvade ID:t.
      const userTenants = await getUserTenants(dbUser!.id);
      const membership = userTenants.find((t: any) => t.tenantId === TENANT_ID);
      expect(membership?.role).toBe("planner");
    } finally {
      mockAuth = null;
    }
  });

  it("resolveRequestUser: ingen Clerk-session → null", async () => {
    const req: any = {};
    expect(await resolveRequestUser(req)).toBeNull();
    expect(req.dbUser).toBeUndefined();
  });

  it("inbjudan med roll 'owner' ger ALDRIG ägarroll via JIT (fail closed)", async () => {
    const clerkId = `user_${RUN}_ownerinvite`;
    const email = `${RUN}-ownerinvite@test.local`;
    // Simulera en (otillåten) owner-inbjudan som smugit sig in i DB.
    await db.insert(invitations).values({
      email,
      tenantId: TENANT_ID,
      role: "owner",
      status: "pending",
    });
    clerkUsers.set(clerkId, { externalId: null, email });

    const dbUser = await jitProvisionUser(clerkId, {});
    expect(dbUser).toBeTruthy();
    createdUserIds.push(clerkId);

    const roles = await db
      .select()
      .from(userTenantRoles)
      .where(eq(userTenantRoles.userId, clerkId));
    expect(roles.some((r) => r.role === "owner")).toBe(false);

    // Inbjudan får inte markeras som använd.
    const [invite] = await db.select().from(invitations).where(eq(invitations.email, email));
    expect(invite.status).toBe("pending");
  });

  it("befintlig rad adopteras via verifierad e-post (ingen dublett)", async () => {
    const clerkId = `user_${RUN}_emaillink`;
    // externalId saknas/pekar fel — bara e-posten matchar
    clerkUsers.set(clerkId, { externalId: null, email: EMAILLINK_EMAIL });

    const dbUser = await jitProvisionUser(clerkId, {});
    expect(dbUser?.id).toBe(EMAILLINK_ID);

    const rows = await db.select().from(users).where(eq(users.email, EMAILLINK_EMAIL));
    expect(rows.length).toBe(1);
  });
});
