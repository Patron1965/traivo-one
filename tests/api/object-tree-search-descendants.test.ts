import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
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
} from "@shared/schema";
import { inArray } from "drizzle-orm";
import { setObjectKund, cleanupObjectKund } from "./helpers/object-kund";
import type { InsertObject } from "@shared/schema";

// Task #735: regressionsvakt för objektträdets sök-gren och rekursiva
// descendants-uppslag på samma endpoint-familj som Task #734 täckte
// (child-count). Båda är handskriven/rekursiv korrelerad SQL som faller TYST
// (fel/tomt resultat, inget fel) om tenant-predikatet eller den rekursiva
// joinen går sönder:
//   - GET /api/objects/tree?search=...   (matchande objekt + kundnamn + släktnamn)
//   - GET /api/objects/tree/:parentId/descendants  (rekursiv CTE över alla barn-id)
//
// Testet monterar de RIKTIGA routrarna (registerCustomerRoutes) bakom samma
// tenant-middleware som i prod (`requireTenantWithFallback`) med stubbad auth
// (x-test-user-id) och NODE_ENV=production — samma mönster som
// object-tree-child-count.test.ts.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `otsd-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const TENANT2 = `${NS}-tenant2`;
const ADMIN = `${NS}-admin`;
const ADMIN2 = `${NS}-admin2`;

let customerMain = "";
let customerOther = "";
let customer2 = "";

// Hierarki (TENANT/customerMain om inget annat anges):
//   root (adress "<NS> Storgatan 1")
//     ├── childA
//     │     └── grandchild
//     └── childB  (primär betalare = customerOther)
// Plus sök-isolering: "<NS> zebra main" i TENANT och "<NS> zebra other" i TENANT2.
let rootId = "";
let childAId = "";
let childBId = "";
let grandchildId = "";
let rootObjectNumber = "";
let zebraMainId = "";
let zebraOtherId = "";

async function req(
  method: string,
  path: string,
  opts: { userId?: string | null } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.userId) headers["x-test-user-id"] = opts.userId;
  const res = await fetch(`${baseUrl}${path}`, { method, headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function makeObject(
  tenantId: string,
  customerId: string,
  overrides: Partial<InsertObject> & Pick<InsertObject, "name">,
): InsertObject {
  return {
    tenantId,
    customerId,
    status: "active",
    ...overrides,
  } as InsertObject;
}

// Etapp 5: object_payers borttagen — kund sätts via "Kund"-metadatat.
async function addPrimaryPayer(
  tenantId: string,
  objectId: string,
  customerId: string,
): Promise<void> {
  await setObjectKund(tenantId, objectId, customerId);
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
  await registerCustomerRoutes(app);
  app.use(errorHandler);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await storage.ensureTenant(TENANT, { name: "Object Tree Search/Descendants Test" });
  await storage.ensureTenant(TENANT2, { name: "Object Tree Search Isolation Test" });

  const cMain = await storage.createCustomer({ tenantId: TENANT, name: `${NS} Kund Main`, customerNumber: `${NS}-M` });
  customerMain = cMain.id;
  const cOther = await storage.createCustomer({ tenantId: TENANT, name: `${NS} Kund Other`, customerNumber: `${NS}-O` });
  customerOther = cOther.id;
  const c2 = await storage.createCustomer({ tenantId: TENANT2, name: `${NS} Kund T2`, customerNumber: `${NS}-T2` });
  customer2 = c2.id;

  for (const [uid, tid] of [[ADMIN, TENANT], [ADMIN2, TENANT2]] as const) {
    await db.insert(users).values({ id: uid, email: `${uid}@test.local` }).onConflictDoNothing();
    await db
      .insert(userTenantRoles)
      .values({ userId: uid, tenantId: tid, role: "admin", isActive: true, assignedBy: uid })
      .onConflictDoNothing();
  }

  const root = await storage.createObject(
    makeObject(TENANT, customerMain, { name: `${NS} root`, address: `${NS} Storgatan 1` }),
  );
  rootId = root.id;
  rootObjectNumber = root.objectNumber!;
  const childA = await storage.createObject(makeObject(TENANT, customerMain, { name: `${NS} childA`, parentId: rootId }));
  childAId = childA.id;
  const childB = await storage.createObject(makeObject(TENANT, customerMain, { name: `${NS} childB`, parentId: rootId }));
  childBId = childB.id;
  const grandchild = await storage.createObject(makeObject(TENANT, customerMain, { name: `${NS} grandchild`, parentId: childAId }));
  grandchildId = grandchild.id;

  // Sök-isolering: samma sökterm ("zebra") i båda tenants. MAIN-sökning ska
  // ALDRIG returnera TENANT2-objektet.
  const zebraMain = await storage.createObject(makeObject(TENANT, customerMain, { name: `${NS} zebra main` }));
  zebraMainId = zebraMain.id;
  const zebraOther = await storage.createObject(makeObject(TENANT2, customer2, { name: `${NS} zebra other` }));
  zebraOtherId = zebraOther.id;

  // Primära betalare. childB läggs på customerOther för att verifiera att
  // descendants-kundfiltret beskär den grenen.
  await addPrimaryPayer(TENANT, rootId, customerMain);
  await addPrimaryPayer(TENANT, childAId, customerMain);
  await addPrimaryPayer(TENANT, childBId, customerOther);
  await addPrimaryPayer(TENANT, grandchildId, customerMain);
  await addPrimaryPayer(TENANT, zebraMainId, customerMain);
  await addPrimaryPayer(TENANT2, zebraOtherId, customer2);
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  try {
    await cleanupObjectKund([TENANT, TENANT2]);
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT, TENANT2]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT, TENANT2]));
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN, ADMIN2]));
    await db.delete(users).where(inArray(users.id, [ADMIN, ADMIN2]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT, TENANT2]));
  } catch (err) {
    console.warn("Cleanup (object-tree-search-descendants.test) ofullständig:", err);
  }
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("GET /api/objects/tree?search= — sök-gren", () => {
  it("matchar på namn och berikar med kundnamn + släktnamn", async () => {
    const res = await req("GET", `/api/objects/tree?search=${encodeURIComponent(`${NS} childA`)}`, { userId: ADMIN });
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    const match = rows.find((o) => o.id === childAId);
    expect(match).toBeDefined();
    // Kundnamn kommer via join på primär payer (customerMain).
    expect(match.customerName).toBe(`${NS} Kund Main`);
    expect(match.customerId).toBe(customerMain);
    // Släktnamn (displayName) ska vara satt (minst objektets eget namn).
    expect(typeof match.displayName).toBe("string");
    expect(match.displayName.length).toBeGreaterThan(0);
  });

  it("matchar på adress", async () => {
    const res = await req("GET", `/api/objects/tree?search=${encodeURIComponent("storgatan")}`, { userId: ADMIN });
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((o) => o.id);
    expect(ids).toContain(rootId);
  });

  it("matchar på objektnummer", async () => {
    const res = await req("GET", `/api/objects/tree?search=${encodeURIComponent(rootObjectNumber)}`, { userId: ADMIN });
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((o) => o.id);
    expect(ids).toContain(rootId);
  });

  it("respekterar tenant-isolering (samma sökterm i annan tenant läcker inte)", async () => {
    const res = await req("GET", `/api/objects/tree?search=${encodeURIComponent("zebra")}`, { userId: ADMIN });
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((o) => o.id);
    expect(ids).toContain(zebraMainId);
    // TENANT2-objektet med samma sökterm får ALDRIG synas för MAIN.
    expect(ids).not.toContain(zebraOtherId);
  });

  it("TENANT2-admin ser bara sitt eget objekt för samma sökterm", async () => {
    const res = await req("GET", `/api/objects/tree?search=${encodeURIComponent("zebra")}`, { userId: ADMIN2 });
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((o) => o.id);
    expect(ids).toContain(zebraOtherId);
    expect(ids).not.toContain(zebraMainId);
  });
});

describe("GET /api/objects/tree/:parentId/descendants — rekursiv CTE", () => {
  it("returnerar hela det rekursiva descendant-setet (inkl. roten själv)", async () => {
    const res = await req("GET", `/api/objects/tree/${rootId}/descendants`, { userId: ADMIN });
    expect(res.status).toBe(200);
    const ids = res.body as string[];
    expect(new Set(ids)).toEqual(new Set([rootId, childAId, childBId, grandchildId]));
  });

  it("kundfiltret beskär grenar som tillhör annan kund", async () => {
    // childB har customerOther som primär betalare → den (och ev. barn) ska
    // beskäras när vi filtrerar på customerMain. childA/grandchild stannar.
    const res = await req("GET", `/api/objects/tree/${rootId}/descendants?customerId=${customerMain}`, { userId: ADMIN });
    expect(res.status).toBe(200);
    const ids = res.body as string[];
    expect(new Set(ids)).toEqual(new Set([rootId, childAId, grandchildId]));
    expect(ids).not.toContain(childBId);
  });

  it("respekterar tenant-isolering för anchor-objektet (annan tenant ger tomt)", async () => {
    // ADMIN2 (TENANT2) frågar efter MAIN:s rot → CTE-anchorns tenant-predikat
    // matchar inget → tomt set.
    const res = await req("GET", `/api/objects/tree/${rootId}/descendants`, { userId: ADMIN2 });
    expect(res.status).toBe(200);
    const ids = res.body as string[];
    expect(ids).toEqual([]);
  });
});
