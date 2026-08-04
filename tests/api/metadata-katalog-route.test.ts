import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { metadataRouter } from "../../server/metadata-routes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { db } from "../../server/db";
import {
  tenants,
  users,
  userTenantRoles,
  metadataKatalog,
  metadataVarden,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

// Task #646: integrationstest för referensnyckel-skyddet på HTTP-routen.
//
// Task #645 härdade metadatareferensen (`metadata_katalog.namn`/`beteckning`)
// så att den inte tyst kan döpas om när en typ är i bruk, och tvingade unikhet
// per tenant. Enhetstestet (`metadata-katalog-usage.test.ts`) täcker bara
// räknar-helpern direkt mot DB — det är på routen (POST/PUT
// `/api/metadata/types`) som 409-blocken och unikhetsfelen faktiskt returneras
// till användaren. Här monteras `metadataRouter` bakom samma tenant-middleware
// som i prod (`requireTenantWithFallback`) på en isolerad app med en stubbad
// auth-middleware (x-test-user-id → req.user.claims.sub) och NODE_ENV=production.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `mk-route-${Date.now()}`;
const TENANT_A = `${NS}-tenant-a`;
const TENANT_B = `${NS}-tenant-b`;
const ADMIN_A = `${NS}-admin-a`;
const ADMIN_B = `${NS}-admin-b`;

const createdKatalogIds: string[] = [];

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
  const body = await res.json().catch(() => null);
  if (body && typeof body === "object" && typeof (body as any).id === "string") {
    createdKatalogIds.push((body as any).id);
  }
  return { status: res.status, body };
}

beforeAll(async () => {
  originalNodeEnv = process.env.NODE_ENV;
  // Reproducera produktionsbeteendet (getTenantIdWithFallback kastar i prod om
  // tenant saknas, men requireTenantWithFallback populerar req.tenantId först).
  process.env.NODE_ENV = "production";

  const app = express();
  app.use(express.json());
  // Stubbad auth: x-test-user-id → req.user.claims.sub, precis som Replit-OIDC
  // populerar för riktiga sessioner. Inget annat mockas.
  app.use((reqIn: any, _res, next) => {
    const uid = reqIn.headers["x-test-user-id"];
    if (uid) reqIn.user = { claims: { sub: String(uid) } };
    next();
  });
  // Samma kedja som i routes.ts: tenant-middleware före metadataRouter.
  app.use("/api/metadata", requireTenantWithFallback, metadataRouter);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await db
    .insert(tenants)
    .values([
      { id: TENANT_A, name: "Metadata Route Test A", subdomain: TENANT_A },
      { id: TENANT_B, name: "Metadata Route Test B", subdomain: TENANT_B },
    ])
    .onConflictDoNothing();
  await db
    .insert(users)
    .values([
      { id: ADMIN_A, email: `${ADMIN_A}@test.local` },
      { id: ADMIN_B, email: `${ADMIN_B}@test.local` },
    ])
    .onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values([
      { userId: ADMIN_A, tenantId: TENANT_A, role: "admin", isActive: true, assignedBy: ADMIN_A },
      { userId: ADMIN_B, tenantId: TENANT_B, role: "admin", isActive: true, assignedBy: ADMIN_B },
    ])
    .onConflictDoNothing();
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  // Rensa metadatavärden + katalogposter skapade under testet.
  if (createdKatalogIds.length > 0) {
    await db.delete(metadataVarden).where(inArray(metadataVarden.metadataKatalogId, createdKatalogIds));
    await db.delete(metadataKatalog).where(inArray(metadataKatalog.id, createdKatalogIds));
  }
  await db.delete(metadataKatalog).where(inArray(metadataKatalog.tenantId, [TENANT_A, TENANT_B]));
  await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN_A, ADMIN_B]));
  await db.delete(users).where(inArray(users.id, [ADMIN_A, ADMIN_B]));
  await db.delete(tenants).where(inArray(tenants.id, [TENANT_A, TENANT_B]));
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("Katalog-skrivningar kräver owner/admin (Task #1368)", () => {
  const MEMBER = `${NS}-member`;

  it("icke-admin tenant-medlem nekas på POST och PUT /types (403)", async () => {
    await db.insert(users).values([{ id: MEMBER, email: `${MEMBER}@test.local` }]).onConflictDoNothing();
    await db
      .insert(userTenantRoles)
      .values([{ userId: MEMBER, tenantId: TENANT_A, role: "user", isActive: true, assignedBy: ADMIN_A }])
      .onConflictDoNothing();

    const created = await req("POST", "/api/metadata/types", {
      userId: ADMIN_A,
      body: { namn: `${NS}-rollgate`, datatyp: "string" },
    });
    expect(created.status).toBe(201);

    const postRes = await req("POST", "/api/metadata/types", {
      userId: MEMBER,
      body: { namn: `${NS}-member-created`, datatyp: "string" },
    });
    expect(postRes.status).toBe(403);

    const putRes = await req("PUT", `/api/metadata/types/${created.body.id}`, {
      userId: MEMBER,
      body: { area: "ekonomi" },
    });
    expect(putRes.status).toBe(403);

    // Admin får däremot uppdatera (område + vinjettflagga från objektsidan).
    const adminPut = await req("PUT", `/api/metadata/types/${created.body.id}`, {
      userId: ADMIN_A,
      body: { area: "ekonomi", visaIVinjett: true },
    });
    expect(adminPut.status).toBe(200);
    expect(adminPut.body.area).toBe("ekonomi");
    expect(adminPut.body.visaIVinjett).toBe(true);

    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [MEMBER]));
    await db.delete(users).where(inArray(users.id, [MEMBER]));
  });
});

describe("POST /api/metadata/types — unikhet & normalisering (Task #646)", () => {
  it("oinloggad → 401", async () => {
    const res = await req("POST", "/api/metadata/types", {
      body: { namn: `${NS}-anon`, datatyp: "string" },
    });
    expect(res.status).toBe(401);
  });

  it("dubblett beteckning inom samma tenant → 409", async () => {
    const first = await req("POST", "/api/metadata/types", {
      userId: ADMIN_A,
      body: { namn: `${NS}-bet-1`, datatyp: "string", beteckning: "DUPBET" },
    });
    expect(first.status).toBe(201);

    const second = await req("POST", "/api/metadata/types", {
      userId: ADMIN_A,
      body: { namn: `${NS}-bet-2`, datatyp: "string", beteckning: "DUPBET" },
    });
    expect(second.status).toBe(409);
    expect(second.body?.error).toMatch(/beteckning/i);
  });

  it("tom/blank beteckning normaliseras till null och kolliderar inte", async () => {
    const first = await req("POST", "/api/metadata/types", {
      userId: ADMIN_A,
      body: { namn: `${NS}-blank-1`, datatyp: "string", beteckning: "   " },
    });
    expect(first.status).toBe(201);
    expect(first.body?.beteckning).toBeNull();

    // En andra typ med blank beteckning ska INTE räknas som dubblett (null != null).
    const second = await req("POST", "/api/metadata/types", {
      userId: ADMIN_A,
      body: { namn: `${NS}-blank-2`, datatyp: "string", beteckning: "" },
    });
    expect(second.status).toBe(201);
    expect(second.body?.beteckning).toBeNull();
  });

  it("samma beteckning i en annan tenant → 201 (unikhet är per tenant)", async () => {
    // TENANT_A har redan "DUPBET" från testet ovan; TENANT_B ska kunna återanvända den.
    const res = await req("POST", "/api/metadata/types", {
      userId: ADMIN_B,
      body: { namn: `${NS}-cross`, datatyp: "string", beteckning: "DUPBET" },
    });
    expect(res.status).toBe(201);
  });
});

describe("PUT /api/metadata/types/:id — referensnyckel-skydd (Task #646)", () => {
  it("blockerar omdöpning av namn/beteckning med 409 när typen är i bruk", async () => {
    const created = await req("POST", "/api/metadata/types", {
      userId: ADMIN_A,
      body: { namn: `${NS}-used`, datatyp: "string", beteckning: "USED" },
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // Gör typen "i bruk" via ett metadatavärde (objekt/WO null tillåtet i schemat).
    await db.insert(metadataVarden).values({
      tenantId: TENANT_A,
      metadataKatalogId: id,
      vardeString: "ett värde",
    });

    const renameNamn = await req("PUT", `/api/metadata/types/${id}`, {
      userId: ADMIN_A,
      body: { namn: `${NS}-used-renamed` },
    });
    expect(renameNamn.status).toBe(409);
    expect(renameNamn.body?.error).toMatch(/referensnamnet/i);
    expect(renameNamn.body?.usage?.valueCount).toBe(1);

    const renameBeteckning = await req("PUT", `/api/metadata/types/${id}`, {
      userId: ADMIN_A,
      body: { beteckning: "USED2" },
    });
    expect(renameBeteckning.status).toBe(409);

    // Icke-referensfält (t.ex. beskrivning) ska fortfarande gå att uppdatera.
    const okEdit = await req("PUT", `/api/metadata/types/${id}`, {
      userId: ADMIN_A,
      body: { beskrivning: "uppdaterad beskrivning" },
    });
    expect(okEdit.status).toBe(200);
  });

  it("tillåter omdöpning när typen inte används", async () => {
    const created = await req("POST", "/api/metadata/types", {
      userId: ADMIN_A,
      body: { namn: `${NS}-unused`, datatyp: "string", beteckning: "UNU" },
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const renamed = await req("PUT", `/api/metadata/types/${id}`, {
      userId: ADMIN_A,
      body: { namn: `${NS}-unused-renamed`, beteckning: "UNU2" },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body?.namn).toBe(`${NS}-unused-renamed`);
    expect(renamed.body?.beteckning).toBe("UNU2");
  });

  it("dubblett namn inom tenant → 409 (med self-exclusion)", async () => {
    const a = await req("POST", "/api/metadata/types", {
      userId: ADMIN_A,
      body: { namn: `${NS}-dn-alpha`, datatyp: "string" },
    });
    const b = await req("POST", "/api/metadata/types", {
      userId: ADMIN_A,
      body: { namn: `${NS}-dn-beta`, datatyp: "string" },
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    // Döp om beta → alpha kolliderar med a.
    const collide = await req("PUT", `/api/metadata/types/${b.body.id}`, {
      userId: ADMIN_A,
      body: { namn: `${NS}-dn-alpha` },
    });
    expect(collide.status).toBe(409);
    expect(collide.body?.error).toMatch(/kod/i);

    // Self-exclusion: PUT med oförändrat namn på a själv ska lyckas (ingen 409).
    const selfOk = await req("PUT", `/api/metadata/types/${a.body.id}`, {
      userId: ADMIN_A,
      body: { namn: `${NS}-dn-alpha`, beskrivning: "samma namn, ny beskrivning" },
    });
    expect(selfOk.status).toBe(200);
  });

  it("dubblett beteckning inom tenant → 409 (med self-exclusion)", async () => {
    const a = await req("POST", "/api/metadata/types", {
      userId: ADMIN_A,
      body: { namn: `${NS}-db-a`, datatyp: "string", beteckning: "DBA" },
    });
    const b = await req("POST", "/api/metadata/types", {
      userId: ADMIN_A,
      body: { namn: `${NS}-db-b`, datatyp: "string", beteckning: "DBB" },
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const collide = await req("PUT", `/api/metadata/types/${b.body.id}`, {
      userId: ADMIN_A,
      body: { beteckning: "DBA" },
    });
    expect(collide.status).toBe(409);
    expect(collide.body?.error).toMatch(/beteckning/i);

    // Self-exclusion: oförändrad beteckning på a själv → 200.
    const selfOk = await req("PUT", `/api/metadata/types/${a.body.id}`, {
      userId: ADMIN_A,
      body: { beteckning: "DBA", beskrivning: "samma beteckning" },
    });
    expect(selfOk.status).toBe(200);
  });

  it("cross-tenant isolering: typ i tenant A är osynlig för tenant B:s unikhetskontroll", async () => {
    const inA = await req("POST", "/api/metadata/types", {
      userId: ADMIN_A,
      body: { namn: `${NS}-iso`, datatyp: "string", beteckning: "ISO" },
    });
    expect(inA.status).toBe(201);

    // Tenant B skapar samma namn + beteckning → tillåtet (per-tenant unikhet).
    const inB = await req("POST", "/api/metadata/types", {
      userId: ADMIN_B,
      body: { namn: `${NS}-iso`, datatyp: "string", beteckning: "ISO" },
    });
    expect(inB.status).toBe(201);

    // Tenant B kan inte se/röra tenant A:s typ (404 vid PUT på A:s id).
    const crossPut = await req("PUT", `/api/metadata/types/${inA.body.id}`, {
      userId: ADMIN_B,
      body: { beskrivning: "försök från fel tenant" },
    });
    expect(crossPut.status).toBe(404);
  });
});
