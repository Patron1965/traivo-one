import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerPlatformAdminRoutes } from "../../server/routes/platformAdminRoutes";
import { db } from "../../server/db";
import {
  auditLogs,
  invitations,
  tenants,
  users,
  userTenantRoles,
} from "../../shared/schema";
import { and, eq, inArray } from "drizzle-orm";

// Task #500 — integrationstester för /api/platform/*
//
// Vi monterar `registerPlatformAdminRoutes` på en isolerad express-app med en
// stubbad session-middleware som läser `x-test-user-id`-headern. Det matchar
// hur `requirePlatformOwner` redan läser `req.session.userId` (fallback från
// Replit-OIDC), så testerna kör äkta middleware mot riktig DB utan att
// behöva en signerad cookie. Inga andra produktionsbeteenden mockas.

let baseUrl = "";
let server: any;

const NS = `plat-routes-${Date.now()}`;
const OTHER_TID = `${NS}-other`;
const MEMBER_UID = `${NS}-kinab-member`;
const OTHER_OWNER_UID = `${NS}-other-owner`;
const INACTIVE_OWNER_UID = `${NS}-kinab-inactive`;
const KINAB_OWNER_UID = `${NS}-kinab-owner`;
const TARGET_LONE_OWNER_UID = `${NS}-target-lone-owner`;
const TARGET_PLAIN_UID = `${NS}-target-plain`;
const TARGET_CONCURRENT_UID = `${NS}-target-concurrent`;
const TARGET_CONFIRM_UID = `${NS}-target-confirm`;
const LONE_TENANT_A = `${NS}-lone-a`;
const LONE_TENANT_B = `${NS}-lone-b`;

async function req(
  method: string,
  path: string,
  opts: { userId?: string | null; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.userId) headers["x-test-user-id"] = opts.userId;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Stubbad session-middleware: läser x-test-user-id och exponerar den som
  // req.session.userId så `requirePlatformOwner` ser en "inloggad" användare.
  app.use((reqIn: any, _res, next) => {
    const uid = reqIn.headers["x-test-user-id"];
    reqIn.session = uid ? { userId: String(uid) } : {};
    next();
  });
  registerPlatformAdminRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Seed fixtures
  await db
    .insert(tenants)
    .values([
      { id: "kinab", name: "Kinab", subdomain: "kinab" },
      { id: OTHER_TID, name: "Annan", subdomain: OTHER_TID },
      { id: LONE_TENANT_A, name: "Lone A", subdomain: LONE_TENANT_A },
      { id: LONE_TENANT_B, name: "Lone B", subdomain: LONE_TENANT_B },
    ])
    .onConflictDoNothing();

  await db
    .insert(users)
    .values([
      { id: MEMBER_UID, email: `${MEMBER_UID}@test.local` },
      { id: OTHER_OWNER_UID, email: `${OTHER_OWNER_UID}@test.local` },
      { id: INACTIVE_OWNER_UID, email: `${INACTIVE_OWNER_UID}@test.local` },
      { id: KINAB_OWNER_UID, email: `${KINAB_OWNER_UID}@test.local` },
      { id: TARGET_LONE_OWNER_UID, email: `${TARGET_LONE_OWNER_UID}@test.local` },
      { id: TARGET_PLAIN_UID, email: `${TARGET_PLAIN_UID}@test.local` },
      { id: TARGET_CONCURRENT_UID, email: `${TARGET_CONCURRENT_UID}@test.local` },
      { id: TARGET_CONFIRM_UID, email: `${TARGET_CONFIRM_UID}@test.local` },
    ])
    .onConflictDoNothing();

  await db
    .insert(userTenantRoles)
    .values([
      { userId: MEMBER_UID, tenantId: "kinab", role: "member", isActive: true },
      { userId: OTHER_OWNER_UID, tenantId: OTHER_TID, role: "owner", isActive: true },
      { userId: INACTIVE_OWNER_UID, tenantId: "kinab", role: "owner", isActive: false },
      { userId: KINAB_OWNER_UID, tenantId: "kinab", role: "owner", isActive: true },
      // Target som är ensam aktiv owner i TVÅ tenants — testar 409-grenen.
      { userId: TARGET_LONE_OWNER_UID, tenantId: LONE_TENANT_A, role: "owner", isActive: true },
      { userId: TARGET_LONE_OWNER_UID, tenantId: LONE_TENANT_B, role: "owner", isActive: true },
    ])
    .onConflictDoNothing();
}, 30000);

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  const uids = [
    MEMBER_UID,
    OTHER_OWNER_UID,
    INACTIVE_OWNER_UID,
    KINAB_OWNER_UID,
    TARGET_LONE_OWNER_UID,
    TARGET_PLAIN_UID,
    TARGET_CONCURRENT_UID,
    TARGET_CONFIRM_UID,
  ];
  // Audit-rader först (FK till tenants har RESTRICT i schema även om tenantId=null här)
  await db.delete(auditLogs).where(inArray(auditLogs.userId, uids));
  await db.delete(auditLogs).where(inArray(auditLogs.resourceId, uids));
  await db.delete(invitations).where(inArray(invitations.tenantId, [OTHER_TID, LONE_TENANT_A, LONE_TENANT_B]));
  await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, uids));
  await db.delete(users).where(inArray(users.id, uids));
  await db.delete(tenants).where(inArray(tenants.id, [OTHER_TID, LONE_TENANT_A, LONE_TENANT_B]));
}, 30000);

describe("/api/platform/* — auth-matrix mot riktiga route-handlers", () => {
  it("oinloggad → 401 på alla /api/platform/*", async () => {
    const paths: Array<[string, string]> = [
      ["GET", "/api/platform/me"],
      ["GET", "/api/platform/users"],
      ["GET", `/api/platform/users/${TARGET_PLAIN_UID}`],
      ["GET", "/api/platform/audit-log"],
      ["POST", `/api/platform/users/${TARGET_PLAIN_UID}/anonymize`],
      ["DELETE", `/api/platform/users/${TARGET_PLAIN_UID}`],
    ];
    for (const [method, path] of paths) {
      const res = await req(method, path, { body: method === "POST" || method === "DELETE" ? {} : undefined });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.body).toHaveProperty("error");
    }
  });

  it("vanlig kinab-medlem (role=member) → 403", async () => {
    const res = await req("GET", "/api/platform/users", { userId: MEMBER_UID });
    expect(res.status).toBe(403);
  });

  it("owner i annan tenant än kinab → 403", async () => {
    const res = await req("GET", "/api/platform/users", { userId: OTHER_OWNER_UID });
    expect(res.status).toBe(403);
  });

  it("kinab-owner men isActive=false → 403", async () => {
    const res = await req("GET", "/api/platform/users", { userId: INACTIVE_OWNER_UID });
    expect(res.status).toBe(403);
  });

  it("kinab-owner aktiv → 200 på GET /users", async () => {
    const res = await req("GET", "/api/platform/users?limit=1", { userId: KINAB_OWNER_UID });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("users");
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body).toHaveProperty("total");
  });
});

describe("/api/platform/users/:id DELETE — confirm + last-owner-skydd", () => {
  it("DELETE utan {confirm:'RADERA'} → 400", async () => {
    const res = await req("DELETE", `/api/platform/users/${TARGET_CONFIRM_UID}`, {
      userId: KINAB_OWNER_UID,
      body: {},
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toMatch(/Bekräftelse/i);
    // Användaren ska fortfarande finnas kvar
    const stillThere = await db.select().from(users).where(eq(users.id, TARGET_CONFIRM_UID));
    expect(stillThere.length).toBe(1);
  });

  it("DELETE av enda aktiva owner utan force → 409, med force → 200", async () => {
    // Steg 1: utan force ska last-owner-skyddet slå till med 409
    const blocked = await req("DELETE", `/api/platform/users/${TARGET_LONE_OWNER_UID}`, {
      userId: KINAB_OWNER_UID,
      body: { confirm: "RADERA" },
    });
    expect(blocked.status).toBe(409);
    expect(Array.isArray(blocked.body?.blockingTenants)).toBe(true);
    expect(blocked.body.blockingTenants).toEqual(
      expect.arrayContaining([LONE_TENANT_A, LONE_TENANT_B]),
    );
    // Target ska fortfarande existera
    const stillThere = await db.select().from(users).where(eq(users.id, TARGET_LONE_OWNER_UID));
    expect(stillThere.length).toBe(1);

    // Steg 2: med force ska raderingen gå igenom
    const forced = await req("DELETE", `/api/platform/users/${TARGET_LONE_OWNER_UID}`, {
      userId: KINAB_OWNER_UID,
      body: { confirm: "RADERA", force: true },
    });
    expect(forced.status).toBe(200);
    expect(forced.body?.success).toBe(true);
    const gone = await db.select().from(users).where(eq(users.id, TARGET_LONE_OWNER_UID));
    expect(gone.length).toBe(0);

    // Audit-rad skapad
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "platform.user.delete"), eq(auditLogs.resourceId, TARGET_LONE_OWNER_UID)));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("två samtidiga DELETE mot samma user serialiseras (advisory-lås) — båda klarar sig utan race-fel", async () => {
    // Båda anropen skickas parallellt. Med pg_advisory_xact_lock i
    // withUserLock körs den andra DELETE först när den första committat.
    // Route-handlern är idempotent (`storage.deleteUser` no-op:ar på en
    // redan borttagen rad), så båda förväntas svara 200 utan att kollidera
    // med "tuple concurrently updated"/FK-fel. Utan advisory-lås skulle
    // last-owner-kontrollen kunna race:a och produera inkonsistenta
    // audit-loggar; här ska vi alltid se TVÅ platform.user.delete-rader
    // för target — en per request — och användaren ska vara borta.
    const both = await Promise.all([
      req("DELETE", `/api/platform/users/${TARGET_CONCURRENT_UID}`, {
        userId: KINAB_OWNER_UID,
        body: { confirm: "RADERA" },
      }),
      req("DELETE", `/api/platform/users/${TARGET_CONCURRENT_UID}`, {
        userId: KINAB_OWNER_UID,
        body: { confirm: "RADERA" },
      }),
    ]);
    for (const r of both) {
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body?.success).toBe(true);
    }
    const gone = await db.select().from(users).where(eq(users.id, TARGET_CONCURRENT_UID));
    expect(gone.length).toBe(0);

    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "platform.user.delete"), eq(auditLogs.resourceId, TARGET_CONCURRENT_UID)));
    expect(audit.length).toBe(2);
  });
});
