import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerObjectRoutes } from "../../server/routes/objectRoutes";
import { registerCustomerRoutes } from "../../server/routes/customerRoutes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { errorHandler } from "../../server/middleware/errorHandler";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import {
  tenants,
  users,
  userTenantRoles,
  customers,
  objects,
  objectParents,
  metadataKatalog,
  metadataVarden,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { setObjectKund, cleanupObjectKund } from "./helpers/object-kund";
import type { InsertObject } from "@shared/schema";

// Task #720: integrationstester för flytta-/kopiera-objekt-flödena (Task #713).
//
// Säkerhets- och dataintegritetskritisk logik (cykelskydd, tenant-isolering,
// gren-remap, metadata-kopiering, parentId↔object_parents-synk) verifieras här
// genom att montera de RIKTIGA routrarna (registerObjectRoutes +
// registerCustomerRoutes) bakom samma tenant-middleware som i prod
// (`requireTenantWithFallback`) på en isolerad app med stubbad auth
// (x-test-user-id → req.user.claims.sub) och NODE_ENV=production. Samma mönster
// som metadata-katalog-route.test.ts.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `mvcp-${Date.now()}`;
const TENANT_A = `${NS}-tenant-a`;
const TENANT_B = `${NS}-tenant-b`;
const ADMIN_A = `${NS}-admin-a`;
const ADMIN_B = `${NS}-admin-b`;

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
  return { status: res.status, body };
}

let customerA = "";
let customerB = "";

function makeObject(
  tenantId: string,
  overrides: Partial<InsertObject> & Pick<InsertObject, "name">,
): InsertObject {
  return {
    tenantId,
    status: "active",
    ...overrides,
  } as InsertObject;
}

// getObject härleder customerId ur Ekonomi-metadatafältet "Kund" (Etapp 5;
// object_payers är borttagen). copyObjectTree läser rotobjektet via getObject,
// så roten måste ha kund-metadata för att klonen ska få en giltig customerId.
async function addPrimaryPayer(objectId: string, tenantId: string): Promise<void> {
  await setObjectKund(tenantId, objectId, tenantId === TENANT_B ? customerB : customerA);
}

beforeAll(async () => {
  originalNodeEnv = process.env.NODE_ENV;
  // Reproducera produktionsbeteendet: requireTenantWithFallback populerar
  // req.tenantId från användarens tenant-roll; getTenantIdWithFallback kastar i
  // prod om det saknas.
  process.env.NODE_ENV = "production";

  const app = express();
  app.use(express.json());
  // Stubbad auth: x-test-user-id → req.user.claims.sub, precis som Replit-OIDC.
  app.use((reqIn: any, _res, next) => {
    const uid = reqIn.headers["x-test-user-id"];
    if (uid) reqIn.user = { claims: { sub: String(uid) } };
    next();
  });
  // Samma kedja som i routes.ts: tenant-middleware före routrarna.
  app.use("/api", requireTenantWithFallback);
  await registerObjectRoutes(app);
  await registerCustomerRoutes(app);
  app.use(errorHandler);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await storage.ensureTenant(TENANT_A, { name: "Move/Copy Test A" });
  await storage.ensureTenant(TENANT_B, { name: "Move/Copy Test B" });
  const cA = await storage.createCustomer({ tenantId: TENANT_A, name: `${NS} Kund A`, customerNumber: `${NS}-A` });
  customerA = cA.id;
  const cB = await storage.createCustomer({ tenantId: TENANT_B, name: `${NS} Kund B`, customerNumber: `${NS}-B` });
  customerB = cB.id;
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
  // Bäst-möjlig städning i FK-säker ordning. Lindas i try/catch eftersom
  // kopiering kan ha skapat extra rader (kluster m.m.) som inte är i scope.
  try {
    await db.delete(metadataVarden).where(inArray(metadataVarden.tenantId, [TENANT_A, TENANT_B]));
    await db.delete(metadataKatalog).where(inArray(metadataKatalog.tenantId, [TENANT_A, TENANT_B]));
    await db.delete(objectParents).where(inArray(objectParents.tenantId, [TENANT_A, TENANT_B]));
    await cleanupObjectKund([TENANT_A, TENANT_B]);
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT_A, TENANT_B]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT_A, TENANT_B]));
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN_A, ADMIN_B]));
    await db.delete(users).where(inArray(users.id, [ADMIN_A, ADMIN_B]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT_A, TENANT_B]));
  } catch (err) {
    console.warn("Cleanup (object-move-copy.test) ofullständig:", err);
  }
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("PATCH /api/objects/:id/move — cykelskydd", () => {
  let root: string;
  let child: string;
  let grandchild: string;

  beforeAll(async () => {
    const r = await storage.createObject(makeObject(TENANT_A, { name: `${NS} cykel-rot` }));
    root = r.id;
    const c = await storage.createObject(makeObject(TENANT_A, { name: `${NS} cykel-barn`, parentId: root }));
    child = c.id;
    const g = await storage.createObject(makeObject(TENANT_A, { name: `${NS} cykel-barnbarn`, parentId: child }));
    grandchild = g.id;
  });

  it("avvisar flytt av objekt under sitt eget direkta barn (cykel)", async () => {
    const res = await req("PATCH", `/api/objects/${root}/move`, { userId: ADMIN_A, body: { parentId: child } });
    expect(res.status).toBe(400);
    expect(res.body?.message).toMatch(/cykel/i);
  });

  it("avvisar flytt av objekt under sitt barnbarn (djupare cykel)", async () => {
    const res = await req("PATCH", `/api/objects/${root}/move`, { userId: ADMIN_A, body: { parentId: grandchild } });
    expect(res.status).toBe(400);
    expect(res.body?.message).toMatch(/cykel/i);
  });

  it("avvisar flytt där objektet blir sin egen förälder", async () => {
    const res = await req("PATCH", `/api/objects/${root}/move`, { userId: ADMIN_A, body: { parentId: root } });
    expect(res.status).toBe(400);
    expect(res.body?.message).toMatch(/egen förälder/i);
  });

  it("tillåter giltig flytt (barnbarn flyttas upp under roten)", async () => {
    const res = await req("PATCH", `/api/objects/${grandchild}/move`, { userId: ADMIN_A, body: { parentId: root } });
    expect(res.status).toBe(200);
    expect(res.body?.parentId).toBe(root);
  });
});

describe("Flytt/kopiera — tenant-isolering", () => {
  let objectA: string;
  let parentB: string;
  let objectB: string;

  beforeAll(async () => {
    const oa = await storage.createObject(makeObject(TENANT_A, { name: `${NS} iso-A` }));
    objectA = oa.id;
    const pb = await storage.createObject(makeObject(TENANT_B, { name: `${NS} iso-B-parent` }));
    parentB = pb.id;
    const ob = await storage.createObject(makeObject(TENANT_B, { name: `${NS} iso-B-obj` }));
    objectB = ob.id;
  });

  it("avvisar flytt med förälder i annan tenant (404)", async () => {
    const res = await req("PATCH", `/api/objects/${objectA}/move`, { userId: ADMIN_A, body: { parentId: parentB } });
    expect(res.status).toBe(404);
  });

  it("avvisar flytt av objekt som tillhör annan tenant (404)", async () => {
    const res = await req("PATCH", `/api/objects/${objectB}/move`, { userId: ADMIN_A, body: { parentId: objectA } });
    expect(res.status).toBe(404);
  });

  it("avvisar kopiering av objekt som tillhör annan tenant (404)", async () => {
    const res = await req("POST", `/api/objects/${objectB}/copy`, { userId: ADMIN_A, body: { mode: "single" } });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/objects/:id/copy — gren-kopiering remappar parentId", () => {
  let parent: string;
  let root: string;
  let c1: string;
  let c2: string;
  let g1: string;

  beforeAll(async () => {
    // Förälder som roten hänger under (kopian ska hänga på samma förälder).
    const p = await storage.createObject(makeObject(TENANT_A, { name: `${NS} branch-top` }));
    parent = p.id;
    const r = await storage.createObject(makeObject(TENANT_A, { name: `${NS} branch-rot`, parentId: parent }));
    root = r.id;
    const a = await storage.createObject(makeObject(TENANT_A, { name: `${NS} branch-c1`, parentId: root }));
    c1 = a.id;
    const b = await storage.createObject(makeObject(TENANT_A, { name: `${NS} branch-c2`, parentId: root }));
    c2 = b.id;
    const g = await storage.createObject(makeObject(TENANT_A, { name: `${NS} branch-g1`, parentId: c1 }));
    g1 = g.id;
    await addPrimaryPayer(root, TENANT_A);
  });

  it("klonar hela grenen med bevarad intern hierarki", async () => {
    const res = await req("POST", `/api/objects/${root}/copy`, { userId: ADMIN_A, body: { mode: "branch" } });
    expect(res.status).toBe(201);
    expect(res.body?.createdCount).toBe(4); // rot + c1 + c2 + g1
    const createdIds: string[] = res.body.createdIds;
    expect(createdIds).toHaveLength(4);

    const clones = await db.select().from(objects).where(inArray(objects.id, createdIds));
    const byName = new Map(clones.map((c) => [c.name, c]));
    const cloneRoot = byName.get(`${NS} branch-rot`);
    const cloneC1 = byName.get(`${NS} branch-c1`);
    const cloneC2 = byName.get(`${NS} branch-c2`);
    const cloneG1 = byName.get(`${NS} branch-g1`);
    expect(cloneRoot).toBeTruthy();
    expect(cloneC1).toBeTruthy();
    expect(cloneC2).toBeTruthy();
    expect(cloneG1).toBeTruthy();

    // Rot-kopian hängs på SAMMA förälder som källan (originalets parent).
    expect(cloneRoot!.parentId).toBe(parent);
    // Barn-kloner pekar på rot-KLONEN, inte originalet.
    expect(cloneC1!.parentId).toBe(cloneRoot!.id);
    expect(cloneC2!.parentId).toBe(cloneRoot!.id);
    // Barnbarns-klonen pekar på c1-KLONEN.
    expect(cloneG1!.parentId).toBe(cloneC1!.id);

    // Klonerna är distinkta objekt (nya id:n).
    expect(createdIds).not.toContain(root);
    expect(createdIds).not.toContain(c1);
  });

  it("single-kopiering klonar bara objektet, inte barnen", async () => {
    const res = await req("POST", `/api/objects/${root}/copy`, { userId: ADMIN_A, body: { mode: "single" } });
    expect(res.status).toBe(201);
    expect(res.body?.createdCount).toBe(1);
  });
});

describe("POST /api/objects/:id/copy — metadata-kopiering (egna kopieras, ärvda fryses ej)", () => {
  let katalogLocal: string;
  let katalogParent: string;
  let parent: string;
  let source: string;

  beforeAll(async () => {
    const p = await storage.createObject(makeObject(TENANT_A, { name: `${NS} meta-parent` }));
    parent = p.id;
    const s = await storage.createObject(makeObject(TENANT_A, { name: `${NS} meta-source`, parentId: parent }));
    source = s.id;
    await addPrimaryPayer(source, TENANT_A);

    // Task #992-cleanup: den engelska metadata-modellen är borttagen — endast den
    // svenska metadata_varden finns kvar. Ett EGET värde på källobjektet ska
    // kopieras; ett värde som bara finns på FÖRÄLDERN (ärvs on-read av källan) ska
    // INTE frysas in på klonen.
    const [katL] = await db.insert(metadataKatalog).values({
      tenantId: TENANT_A, namn: `${NS}-eget`, datatyp: "string",
    }).returning();
    katalogLocal = katL.id;
    const [katP] = await db.insert(metadataKatalog).values({
      tenantId: TENANT_A, namn: `${NS}-arvt`, datatyp: "string",
    }).returning();
    katalogParent = katP.id;

    // Eget värde på källan — ska kopieras.
    await db.insert(metadataVarden).values({
      tenantId: TENANT_A, objektId: source, metadataKatalogId: katalogLocal, vardeString: "sv-lokalt",
    });
    // Ärvt värde: lagras BARA på föräldern, aldrig som egen rad på källan.
    await db.insert(metadataVarden).values({
      tenantId: TENANT_A, objektId: parent, metadataKatalogId: katalogParent, vardeString: "sv-arvt",
    });
  });

  it("kopierar egna svenska metadata men fryser inte ärvda (förälder-)värden", async () => {
    const res = await req("POST", `/api/objects/${source}/copy`, { userId: ADMIN_A, body: { mode: "single" } });
    expect(res.status).toBe(201);
    const cloneId: string = res.body.id;
    expect(cloneId).toBeTruthy();
    expect(res.body?.metadataCopyError).toBeNull();

    const cloneAll = await db.select().from(metadataVarden)
      .where(and(eq(metadataVarden.objektId, cloneId), eq(metadataVarden.tenantId, TENANT_A)));
    // Endast källans EGNA rader ska ha kopierats — förälderns (ärvda) värde fryses ej.
    // (Källan har även en egen "Kund"-metadatarad från setObjectKund; den kopieras med.)
    const cloneSwedish = cloneAll.filter((r) =>
      r.metadataKatalogId === katalogLocal || r.metadataKatalogId === katalogParent,
    );
    expect(cloneSwedish).toHaveLength(1);
    expect(cloneSwedish[0].metadataKatalogId).toBe(katalogLocal);
    expect(cloneSwedish[0].vardeString).toBe("sv-lokalt");
    expect(cloneAll.some((r) => r.metadataKatalogId === katalogParent)).toBe(false);
  });
});

describe("PATCH /api/objects/:id/move — parentId ↔ primär object_parents i synk", () => {
  let p1: string;
  let p2: string;
  let obj: string;

  beforeAll(async () => {
    const a = await storage.createObject(makeObject(TENANT_A, { name: `${NS} sync-p1` }));
    p1 = a.id;
    const b = await storage.createObject(makeObject(TENANT_A, { name: `${NS} sync-p2` }));
    p2 = b.id;
    const o = await storage.createObject(makeObject(TENANT_A, { name: `${NS} sync-obj`, parentId: p1 }));
    obj = o.id;
  });

  it("efter flytt speglar objects.parentId och primär object_parents-raden nya föräldern", async () => {
    const res = await req("PATCH", `/api/objects/${obj}/move`, { userId: ADMIN_A, body: { parentId: p2 } });
    expect(res.status).toBe(200);
    expect(res.body?.parentId).toBe(p2);

    const [row] = await db.select().from(objects).where(eq(objects.id, obj));
    expect(row.parentId).toBe(p2);

    const primaries = await db.select().from(objectParents)
      .where(and(eq(objectParents.objectId, obj), eq(objectParents.isPrimary, true)));
    expect(primaries).toHaveLength(1);
    expect(primaries[0].parentId).toBe(p2);
  });

  it("frikoppling (parentId=null) nollar objects.parentId och primär-raden", async () => {
    const res = await req("PATCH", `/api/objects/${obj}/move`, { userId: ADMIN_A, body: { parentId: null } });
    expect(res.status).toBe(200);
    expect(res.body?.parentId).toBeNull();

    const [row] = await db.select().from(objects).where(eq(objects.id, obj));
    expect(row.parentId).toBeNull();

    const primaries = await db.select().from(objectParents)
      .where(and(eq(objectParents.objectId, obj), eq(objectParents.isPrimary, true)));
    expect(primaries).toHaveLength(0);
  });
});
