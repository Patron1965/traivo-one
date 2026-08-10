import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerCustomerRoutes } from "../../server/routes/customerRoutes";
import { registerObjectLifecycleRoutes } from "../../server/routes/objectLifecycleRoutes";
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
  workOrders,
  auditLogs,
} from "@shared/schema";
import { inArray, eq } from "drizzle-orm";

// Task #1428: POST /api/objects/bulk-delete — massradering som EN batch-
// operation. Vaktar:
//  - raderbara objekt raderas, blockerade får läsbar orsak (uppgifter/underobjekt)
//  - förälder + barn i samma urval raderas i rätt ordning (barn först)
//  - förälder med OMARKERAT barn blockeras
//  - cross-tenant-id:n raderas aldrig och läcker ingen info ("hittades inte")

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `obd-${Date.now()}`;
const TENANT_A = `${NS}-tenant-a`;
const TENANT_B = `${NS}-tenant-b`;
const USER_A = `${NS}-user-a`;
const USER_B = `${NS}-user-b`;

let customerA = "";
let freeObj = "";        // helt oanvänt → raderas
let woObj = "";          // har work order → blockeras
let parentObj = "";      // förälder vars barn också är markerat → raderas
let childObj = "";       // barn till parentObj → raderas
let keptParentObj = "";  // förälder vars barn INTE är markerat → blockeras
let keptChildObj = "";   // omarkerat barn (ska överleva)
let objectB = "";        // annan tenant

async function post(path: string, userId: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": userId },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

const resultFor = (body: any, id: string) =>
  (body?.results as Array<{ id: string; status: string; reason?: string }>).find((r) => r.id === id);

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
  registerObjectLifecycleRoutes(app);
  app.use(errorHandler);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await storage.ensureTenant(TENANT_A, { name: "Bulk-delete Tenant A" });
  await storage.ensureTenant(TENANT_B, { name: "Bulk-delete Tenant B" });

  await db.insert(users).values([
    { id: USER_A, email: `${USER_A}@test.local` },
    { id: USER_B, email: `${USER_B}@test.local` },
  ]).onConflictDoNothing();
  await db.insert(userTenantRoles).values([
    { userId: USER_A, tenantId: TENANT_A, role: "admin", isActive: true, assignedBy: USER_A },
    { userId: USER_B, tenantId: TENANT_B, role: "admin", isActive: true, assignedBy: USER_B },
  ]).onConflictDoNothing();

  const [cA] = await db.insert(customers).values({ tenantId: TENANT_A, name: `${NS} Kund A` }).returning();
  customerA = cA.id;

  const mk = async (name: string, tenantId = TENANT_A, parentId?: string) =>
    (await storage.createObject({ tenantId, name: `${NS} ${name}`, status: "active", ...(parentId ? { parentId } : {}) } as any)).id;

  freeObj = await mk("Fritt");
  woObj = await mk("Med WO");
  parentObj = await mk("Förälder");
  childObj = await mk("Barn", TENANT_A, parentObj);
  keptParentObj = await mk("Förälder kvar-barn");
  keptChildObj = await mk("Omarkerat barn", TENANT_A, keptParentObj);
  objectB = await mk("Objekt B", TENANT_B);

  await db.insert(workOrders).values({ tenantId: TENANT_A, customerId: customerA, objectId: woObj, title: `${NS} WO` });
}, 60000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  const T = [TENANT_A, TENANT_B];
  // Arkiveringstestet skriver audit-loggar → städa dem före tenants (FK).
  await db.delete(auditLogs).where(inArray(auditLogs.tenantId, T));
  await db.delete(workOrders).where(inArray(workOrders.tenantId, T));
  await db.delete(objects).where(inArray(objects.tenantId, T));
  await db.delete(customers).where(inArray(customers.tenantId, T));
  await db.delete(userTenantRoles).where(inArray(userTenantRoles.tenantId, T));
  await db.delete(users).where(inArray(users.id, [USER_A, USER_B]));
  await db.delete(tenants).where(inArray(tenants.id, T));
  process.env.NODE_ENV = originalNodeEnv;
}, 60000);

describe("POST /api/objects/bulk-delete (Task #1428)", () => {
  it("blandat urval: raderar fria + hela delträd, blockerar med orsak, läcker inget cross-tenant", async () => {
    const ids = [freeObj, woObj, parentObj, childObj, keptParentObj, objectB];
    const { status, body } = await post("/api/objects/bulk-delete", USER_A, { ids });
    expect(status).toBe(200);

    // Fritt objekt + hela markerade delträdet (förälder + barn) raderas.
    expect(resultFor(body, freeObj)?.status).toBe("deleted");
    expect(resultFor(body, parentObj)?.status).toBe("deleted");
    expect(resultFor(body, childObj)?.status).toBe("deleted");

    // Objekt med uppgift blockeras med läsbar orsak.
    const wo = resultFor(body, woObj);
    expect(wo?.status).toBe("blocked");
    expect(wo?.reason).toContain("uppgift");

    // Förälder med omarkerat barn blockeras på underobjekt.
    const kept = resultFor(body, keptParentObj);
    expect(kept?.status).toBe("blocked");
    expect(kept?.reason).toContain("underobjekt");

    // Cross-tenant-id ger bara "hittades inte" — ingen radering, ingen info.
    const other = resultFor(body, objectB);
    expect(other?.status).toBe("blocked");
    expect(other?.reason).toBe("Objektet hittades inte");

    expect(body.deleted).toBe(3);
    expect(body.blocked).toBe(3);

    // DB-verifiering: raderade borta, blockerade + andra tenantens objekt kvar.
    const remaining = await db.select({ id: objects.id }).from(objects)
      .where(inArray(objects.id, [freeObj, parentObj, childObj, woObj, keptParentObj, keptChildObj, objectB]));
    const remainingIds = new Set(remaining.map((r) => r.id));
    expect(remainingIds.has(freeObj)).toBe(false);
    expect(remainingIds.has(parentObj)).toBe(false);
    expect(remainingIds.has(childObj)).toBe(false);
    expect(remainingIds.has(woObj)).toBe(true);
    expect(remainingIds.has(keptParentObj)).toBe(true);
    expect(remainingIds.has(keptChildObj)).toBe(true);
    expect(remainingIds.has(objectB)).toBe(true);
  });

  it("urval med ENBART cross-tenant/okända id:n svarar tenant-säkert utan serverfel", async () => {
    const { status, body } = await post("/api/objects/bulk-delete", USER_A, { ids: ["finns-inte-1", "finns-inte-2"] });
    expect(status).toBe(200);
    expect(body.deleted).toBe(0);
    expect(body.blocked).toBe(2);
    for (const r of body.results) {
      expect(r.status).toBe("blocked");
      expect(r.reason).toBe("Objektet hittades inte");
    }
  });

  it("returnerar resultat i barn-först-ordning även när föräldern skickas först", async () => {
    // Nytt delträd där föräldern blockeras (barnet blockeras av en WO) —
    // resultatordningen ska ändå vara barn före förälder.
    const pId = (await storage.createObject({ tenantId: TENANT_A, name: `${NS} Ordning F`, status: "active" } as any)).id;
    const cId = (await storage.createObject({ tenantId: TENANT_A, name: `${NS} Ordning B`, status: "active", parentId: pId } as any)).id;
    await db.insert(workOrders).values({ tenantId: TENANT_A, customerId: customerA, objectId: cId, title: `${NS} WO ordning` });

    const { status, body } = await post("/api/objects/bulk-delete", USER_A, { ids: [pId, cId] });
    expect(status).toBe(200);
    const order = (body.results as Array<{ id: string }>).map((r) => r.id);
    expect(order.indexOf(cId)).toBeLessThan(order.indexOf(pId));
    // Barnet blockeras av WO → föräldern blockeras av kvarvarande underobjekt.
    expect(resultFor(body, cId)?.reason).toContain("uppgift");
    expect(resultFor(body, pId)?.reason).toContain("underobjekt");
  });

  it("arkivering av förälder blockerad av OMARKERAT aktivt barn avvisas med läsbar orsak (klienten visar den kvar i dialogen)", async () => {
    // keptParentObj blockerades i bulk-delete (omarkerat barn keptChildObj lever).
    // "Arkivera blockerade"-flödet POSTar /archive per objekt — här ska servern
    // vägra (409) och preflight ge den läsbara orsaken som klienten visar.
    const arch = await post(`/api/objects/${keptParentObj}/archive`, USER_A, { reason: "test" });
    expect(arch.status).toBe(409);

    const pfRes = await fetch(`${baseUrl}/api/objects/${keptParentObj}/archive-preflight`, {
      headers: { "x-test-user-id": USER_A },
    });
    expect(pfRes.status).toBe(200);
    const pf = await pfRes.json();
    expect(pf.blockers.join(" ")).toContain("underobjekt");

    // Föräldern är fortfarande aktiv (inte tyst halv-arkiverad).
    const [row] = await db.select({ deletedAt: objects.deletedAt }).from(objects).where(eq(objects.id, keptParentObj));
    expect(row.deletedAt).toBeNull();

    // Efter att barnet arkiverats går föräldern att arkivera — vägen vidare finns.
    const archChild = await post(`/api/objects/${keptChildObj}/archive`, USER_A, { reason: "test" });
    expect(archChild.status).toBe(200);
    const archParent = await post(`/api/objects/${keptParentObj}/archive`, USER_A, { reason: "test" });
    expect(archParent.status).toBe(200);
  });

  it("validerar payload", async () => {
    const empty = await post("/api/objects/bulk-delete", USER_A, { ids: [] });
    expect(empty.status).toBe(400);
    const tooMany = await post("/api/objects/bulk-delete", USER_A, { ids: Array.from({ length: 1001 }, (_, i) => `x${i}`) });
    expect(tooMany.status).toBe(400);
  });
});
