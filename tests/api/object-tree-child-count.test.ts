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
  metadataVarden,
} from "@shared/schema";
import { inArray, eq } from "drizzle-orm";
import { setObjectKund, cleanupObjectKund } from "./helpers/object-kund";
import type { InsertObject } from "@shared/schema";

// Task #734: regressionsvakt för objektträdets child-count-badge.
//
// Task #733 fixade en tyst bugg där child-count alltid blev 0 eftersom en
// korrelerad scalar-subselect refererade yttre objektets id okvalificerat
// (drizzle renderade det som bart "id" → band till inre tabellen). Buggen
// faller tyst — inget fel, bara fel siffror. Testet monterar de RIKTIGA
// routrarna (registerCustomerRoutes) bakom samma tenant-middleware som i prod
// (`requireTenantWithFallback`) med stubbad auth (x-test-user-id) och
// NODE_ENV=production — samma mönster som object-move-copy.test.ts.
//
// Mot pre-fix-koden hade alla assertions på childCount > 0 fallit (childCount=0).

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `otcc-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;

let customerMain = "";
let customerOther = "";

// Hierarki:
//   root (2 direkta barn)
//     ├── childA (1 direkt barn: grandchild)
//     │     └── grandchild (0 barn)
//     └── childB (0 barn)
let rootId = "";
let childAId = "";
let childBId = "";
let grandchildId = "";
// Separat rot kopplad till en annan kund (för kundfilter-assertions).
let otherRootId = "";

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
  overrides: Partial<InsertObject> & Pick<InsertObject, "name">,
): InsertObject {
  return {
    tenantId: TENANT,
    customerId: customerMain,
    status: "active",
    ...overrides,
  } as InsertObject;
}

// childCount resolveras via "Kund"-metadatat när kundfilter används (Etapp 5;
// object_payers är borttagen), så varje objekt får kund-metadata (default = customerMain).
async function addPrimaryPayer(objectId: string, customerId: string): Promise<void> {
  await setObjectKund(TENANT, objectId, customerId);
}
async function removeObjectKund(objectId: string): Promise<void> {
  await db.delete(metadataVarden).where(eq(metadataVarden.objektId, objectId));
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

  await storage.ensureTenant(TENANT, { name: "Object Tree Child Count Test" });
  const cMain = await storage.createCustomer({ tenantId: TENANT, name: `${NS} Kund Main`, customerNumber: `${NS}-M` });
  customerMain = cMain.id;
  const cOther = await storage.createCustomer({ tenantId: TENANT, name: `${NS} Kund Other`, customerNumber: `${NS}-O` });
  customerOther = cOther.id;

  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();

  const root = await storage.createObject(makeObject({ name: `${NS} root` }));
  rootId = root.id;
  const childA = await storage.createObject(makeObject({ name: `${NS} childA`, parentId: rootId }));
  childAId = childA.id;
  const childB = await storage.createObject(makeObject({ name: `${NS} childB`, parentId: rootId }));
  childBId = childB.id;
  const grandchild = await storage.createObject(makeObject({ name: `${NS} grandchild`, parentId: childAId }));
  grandchildId = grandchild.id;

  // Separat rot kopplad till en ANNAN kund för att verifiera kundfiltret.
  const otherRoot = await storage.createObject(
    makeObject({ name: `${NS} otherRoot`, customerId: customerOther }),
  );
  otherRootId = otherRoot.id;
  await storage.createObject(
    makeObject({ name: `${NS} otherChild`, parentId: otherRootId, customerId: customerOther }),
  );

  await addPrimaryPayer(rootId, customerMain);
  await addPrimaryPayer(childAId, customerMain);
  await addPrimaryPayer(childBId, customerMain);
  await addPrimaryPayer(grandchildId, customerMain);
  await addPrimaryPayer(otherRootId, customerOther);
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  try {
    await cleanupObjectKund([TENANT]);
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT]));
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN]));
    await db.delete(users).where(inArray(users.id, [ADMIN]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT]));
  } catch (err) {
    console.warn("Cleanup (object-tree-child-count.test) ofullständig:", err);
  }
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("GET /api/objects/tree — childCount på rot-nivå", () => {
  it("returnerar korrekt antal direkta barn per rot-objekt (skulle ha gett 0 före fixen)", async () => {
    const res = await req("GET", "/api/objects/tree", { userId: ADMIN });
    expect(res.status).toBe(200);
    const root = (res.body as any[]).find((o) => o.id === rootId);
    expect(root).toBeDefined();
    // Roten har två direkta barn (childA, childB). Pre-fix gav 0.
    expect(root.childCount).toBe(2);
  });

  it("respekterar kundfiltret för både rader och childCount", async () => {
    const res = await req("GET", `/api/objects/tree?customerId=${customerMain}`, { userId: ADMIN });
    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((o) => o.id);
    // Endast main-kundens rot ska synas; den andra kundens rot filtreras bort.
    expect(ids).toContain(rootId);
    expect(ids).not.toContain(otherRootId);
    const root = (res.body as any[]).find((o) => o.id === rootId);
    expect(root.childCount).toBe(2);
  });

  it("exkluderar barn som tillhör annan kund från childCount", async () => {
    // childB byter primär betalare till en annan kund → räknas inte med när
    // main-kunden filtreras. Verifierar att childCount-subqueryn ärver filtret.
    await removeObjectKund(childBId);
    await addPrimaryPayer(childBId, customerOther);

    const res = await req("GET", `/api/objects/tree?customerId=${customerMain}`, { userId: ADMIN });
    expect(res.status).toBe(200);
    const root = (res.body as any[]).find((o) => o.id === rootId);
    // Bara childA är kvar under main-kunden.
    expect(root.childCount).toBe(1);

    // Återställ för efterföljande test.
    await removeObjectKund(childBId);
    await addPrimaryPayer(childBId, customerMain);
  });
});

describe("GET /api/objects/tree/:parentId/children — childCount på barn-nivå", () => {
  it("returnerar korrekt childCount för varje direkt barn (skulle ha gett 0 före fixen)", async () => {
    const res = await req("GET", `/api/objects/tree/${rootId}/children`, { userId: ADMIN });
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    const childA = rows.find((o) => o.id === childAId);
    const childB = rows.find((o) => o.id === childBId);
    expect(childA).toBeDefined();
    expect(childB).toBeDefined();
    // childA har ett barn (grandchild), childB har inga.
    expect(childA.childCount).toBe(1);
    expect(childB.childCount).toBe(0);
  });

  it("löv-objekt rapporterar childCount = 0", async () => {
    const res = await req("GET", `/api/objects/tree/${childAId}/children`, { userId: ADMIN });
    expect(res.status).toBe(200);
    const grandchild = (res.body as any[]).find((o) => o.id === grandchildId);
    expect(grandchild).toBeDefined();
    expect(grandchild.childCount).toBe(0);
  });
});
