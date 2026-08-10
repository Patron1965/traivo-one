import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { metadataRouter } from "../../server/metadata-routes";
import { registerObjectRoutes } from "../../server/routes/objectRoutes";
import { registerCustomerRoutes } from "../../server/routes/customerRoutes";
import { registerKPIRoutes } from "../../server/routes/kpiRoutes";
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
  metadataHistorik,
} from "@shared/schema";
import { inArray } from "drizzle-orm";

// Task #1366: vinjettbild/logotyp — historik-kedjan över arv + åsidosättning.
//
// Verifierar reviewer-kraven:
// 1. Ärvd bild: barnets entry pekar på KÄLLOBJEKTETS rad (entry.id) — dess
//    historik nås via GET /historik/:id.
// 2. Åsidosättning: barnet får egen rad (overridden=true) och exponerar
//    inheritedMetadataId = källradens id, så källkedjan förblir läsbar.
// 3. Byte av det egna värdet arkiverar gamla värdet till metadata_historik
//    med SERVER-auktoritativ aktör (req.user vinner över klient-payload).
// 4. /api/metadata-labels PATCH accepterar och persisterar visaIVinjett
//    (samma flagga som /api/metadata/types).

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `vih-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const FIELD = `${NS}_vinjettbild`;
let customerId = "";
let parentId = "";
let childId = "";
let katalogId = "";

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

async function createObject(name: string): Promise<string> {
  const res = await req("POST", "/api/objects", {
    userId: ADMIN,
    body: { name, customerId, status: "active" },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function getEntry(objektId: string) {
  const res = await req("GET", `/api/metadata/objects/${objektId}`, { userId: ADMIN });
  expect(res.status).toBe(200);
  const list = Array.isArray(res.body) ? res.body : res.body?.metadata ?? [];
  return list.find((e: any) => e.katalog?.namn === FIELD || e.metadataKatalogId === katalogId);
}

beforeAll(async () => {
  originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  const app = express();
  app.use(express.json());
  app.use((reqIn: any, _res, next) => {
    const uid = reqIn.headers["x-test-user-id"];
    if (uid) reqIn.user = { claims: { sub: String(uid) } };
    next();
  });
  app.use("/api", requireTenantWithFallback);
  app.use("/api/metadata", metadataRouter);
  await registerObjectRoutes(app);
  await registerCustomerRoutes(app);
  await registerKPIRoutes(app);
  app.use(errorHandler);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await storage.ensureTenant(TENANT, { name: "Vinjettbild-historik Test" });
  const c = await storage.createCustomer({
    tenantId: TENANT,
    name: `${NS} Kund`,
    customerNumber: `${NS}-K`,
  });
  customerId = c.id;
  await db.insert(users).values([{ id: ADMIN, email: `${ADMIN}@test.local` }]).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values([{ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN }])
    .onConflictDoNothing();

  const [kat] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: FIELD, datatyp: "image", standardArvs: true })
    .returning({ id: metadataKatalog.id });
  katalogId = kat.id;

  parentId = await createObject(`${NS} Förälder`);
  childId = await createObject(`${NS} Barn`);
  const link = await req("POST", `/api/objects/${childId}/parents`, {
    userId: ADMIN,
    body: { parentId },
  });
  expect(link.status).toBe(201);
}, 40000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  try {
    await db.delete(metadataHistorik).where(inArray(metadataHistorik.tenantId, [TENANT]));
    await db.delete(metadataVarden).where(inArray(metadataVarden.tenantId, [TENANT]));
    await db.delete(metadataKatalog).where(inArray(metadataKatalog.tenantId, [TENANT]));
    await db.delete(objectParents).where(inArray(objectParents.tenantId, [TENANT]));
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT]));
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN]));
    await db.delete(users).where(inArray(users.id, [ADMIN]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT]));
  } catch (err) {
    console.warn("Cleanup (vignette-image-history.test) ofullständig:", err);
  }
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

let parentRowId = "";
let childRowId = "";

describe("Task #1366 — vinjettbild-historik över arv och åsidosättning", () => {
  it("bild på föräldern ärvs till barnet; barnets entry pekar på källraden", async () => {
    const post = await req("POST", "/api/metadata", {
      userId: ADMIN,
      body: { objektId: parentId, metadataTypNamn: FIELD, varde: "/objects/p1.png" },
    });
    expect(post.status).toBe(201);
    parentRowId = post.body.id;

    const entry = await getEntry(childId);
    expect(entry).toBeTruthy();
    expect(entry.source).toBe("inherited");
    expect(entry.id).toBe(parentRowId); // historik nås via källradens id
  });

  it("byte på föräldern arkiverar gamla bilden med server-auktoritativ aktör", async () => {
    const put = await req("PUT", `/api/metadata/${parentRowId}`, {
      userId: ADMIN,
      // Klienten försöker fejka aktören — servern ska vinna.
      body: { varde: "/objects/p2.png", uppdateradAv: "fejk-anvandare" },
    });
    expect(put.status).toBe(200);

    const hist = await req("GET", `/api/metadata/historik/${parentRowId}`, { userId: ADMIN });
    expect(hist.status).toBe(200);
    const row = hist.body.find((h: any) => h.gammaltVarde === "/objects/p1.png");
    expect(row).toBeTruthy();
    expect(row.nyttVarde).toBe("/objects/p2.png");
    expect(row.andradAv).toBe(ADMIN); // aldrig "fejk-anvandare" eller "system"
  });

  it("åsidosättning på barnet exponerar inheritedMetadataId → källkedjan förblir läsbar", async () => {
    const post = await req("POST", "/api/metadata", {
      userId: ADMIN,
      body: { objektId: childId, metadataTypNamn: FIELD, varde: "/objects/c1.png" },
    });
    expect(post.status).toBe(201);
    childRowId = post.body.id;

    const entry = await getEntry(childId);
    expect(entry.overridden).toBe(true);
    expect(entry.id).toBe(childRowId);
    expect(entry.inheritedMetadataId).toBe(parentRowId);

    // Källobjektets historik nås fortfarande via det exponerade id:t.
    const hist = await req("GET", `/api/metadata/historik/${entry.inheritedMetadataId}`, { userId: ADMIN });
    expect(hist.status).toBe(200);
    expect(hist.body.some((h: any) => h.gammaltVarde === "/objects/p1.png")).toBe(true);
  });

  it("nytt byte på barnet bygger på den egna kedjan utan att källkedjan påverkas", async () => {
    const put = await req("PUT", `/api/metadata/${childRowId}`, {
      userId: ADMIN,
      body: { varde: "/objects/c2.png" },
    });
    expect(put.status).toBe(200);

    const own = await req("GET", `/api/metadata/historik/${childRowId}`, { userId: ADMIN });
    expect(own.status).toBe(200);
    const ownRow = own.body.find((h: any) => h.gammaltVarde === "/objects/c1.png");
    expect(ownRow).toBeTruthy();
    expect(ownRow.andradAv).toBe(ADMIN);

    const src = await req("GET", `/api/metadata/historik/${parentRowId}`, { userId: ADMIN });
    expect(src.body.some((h: any) => h.gammaltVarde === "/objects/p1.png")).toBe(true);
  });

  it("/api/metadata-labels PATCH accepterar och persisterar visaIVinjett", async () => {
    const patch = await req("PATCH", `/api/metadata-labels/${katalogId}`, {
      userId: ADMIN,
      body: { visaIVinjett: true },
    });
    expect(patch.status).toBe(200);
    expect(patch.body.visaIVinjett).toBe(true);

    const get = await req("GET", `/api/metadata-labels/${katalogId}`, { userId: ADMIN });
    expect(get.status).toBe(200);
    expect(get.body.visaIVinjett).toBe(true);

    // Även avstängning (false) måste kunna persisteras via samma yta.
    const patchOff = await req("PATCH", `/api/metadata-labels/${katalogId}`, {
      userId: ADMIN,
      body: { visaIVinjett: false },
    });
    expect(patchOff.status).toBe(200);
    expect(patchOff.body.visaIVinjett).toBe(false);

    const getOff = await req("GET", `/api/metadata-labels/${katalogId}`, { userId: ADMIN });
    expect(getOff.body.visaIVinjett).toBe(false);
  });
});
