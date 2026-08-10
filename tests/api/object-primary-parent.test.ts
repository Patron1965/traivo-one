import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Request, Response, NextFunction, Express } from "express";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { tenants, customers, objects, objectParents } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { InsertObject } from "@shared/schema";
import { AppError } from "../../server/errors";
import { registerObjectRoutes } from "../../server/routes/objectRoutes";

// Task #873: byte av primär förälder via flerförälder-vägen (storage.setPrimaryParent
// + PATCH /api/objects/:id/primary-parent) saknade automatiserade tester. Till
// skillnad från flytt/move (Task #862) byter denna väg bara VILKEN befintlig
// förälder-relation som är primär — utan att radera någon relation — och speglar
// valet till legacy objects.parentId (som styr metadata-arv och släktnamn). En
// tyst regression här skulle kunna peka arvet mot fel förälder. Tester körs mot
// riktig DB (samma mönster som object-move-tree-integrity.test.ts).

const NS = `ppar-${Date.now()}`;
const TENANT_A = `${NS}-tenant-a`;
const TENANT_B = `${NS}-tenant-b`;

let customerA = "";
let customerB = "";

function makeObject(
  tenantId: string,
  overrides: Partial<InsertObject> & Pick<InsertObject, "name">,
): InsertObject {
  return {
    tenantId,
    customerId: tenantId === TENANT_B ? customerB : customerA,
    status: "active",
    ...overrides,
  } as InsertObject;
}

beforeAll(async () => {
  await storage.ensureTenant(TENANT_A, { name: "Primary Parent A" });
  await storage.ensureTenant(TENANT_B, { name: "Primary Parent B" });
  const cA = await storage.createCustomer({ tenantId: TENANT_A, name: `${NS} Kund A`, customerNumber: `${NS}-A` });
  customerA = cA.id;
  const cB = await storage.createCustomer({ tenantId: TENANT_B, name: `${NS} Kund B`, customerNumber: `${NS}-B` });
  customerB = cB.id;
}, 30000);

afterAll(async () => {
  try {
    await db.delete(objectParents).where(inArray(objectParents.tenantId, [TENANT_A, TENANT_B]));
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT_A, TENANT_B]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT_A, TENANT_B]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT_A, TENANT_B]));
  } catch (err) {
    console.warn("Cleanup (object-primary-parent.test) ofullständig:", err);
  }
}, 30000);

async function allParents(objectId: string) {
  return db.select().from(objectParents).where(eq(objectParents.objectId, objectId));
}

async function objectRow(objectId: string) {
  const [row] = await db.select().from(objects).where(eq(objects.id, objectId));
  return row;
}

// ---------------------------------------------------------------------------
// storage.setPrimaryParent — direkta enhetstester mot riktig DB
// ---------------------------------------------------------------------------

describe("storage.setPrimaryParent — byter primär utan att radera relationer", () => {
  let p1: string;
  let p2: string;
  let pAlt: string;
  let obj: string;

  beforeAll(async () => {
    const a = await storage.createObject(makeObject(TENANT_A, { name: `${NS} set-p1` }));
    p1 = a.id;
    const b = await storage.createObject(makeObject(TENANT_A, { name: `${NS} set-p2` }));
    p2 = b.id;
    const c = await storage.createObject(makeObject(TENANT_A, { name: `${NS} set-alt` }));
    pAlt = c.id;
    const o = await storage.createObject(makeObject(TENANT_A, { name: `${NS} set-obj`, parentId: p1 }));
    obj = o.id;
    // p1 är primär, p2 och pAlt är alternativa (icke-primära) relationer.
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: obj, parentId: p1, isPrimary: true, relationContext: "primary" });
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: obj, parentId: p2, isPrimary: false, relationContext: "alternativ" });
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: obj, parentId: pAlt, isPrimary: false, relationContext: "alternativ" });
  });

  it("(a) sätter exakt EN primär relation — och den pekar på den nya föräldern", async () => {
    const updated = await storage.setPrimaryParent(obj, p2, TENANT_A);
    expect(updated).toBeTruthy();
    expect(updated!.parentId).toBe(p2);
    expect(updated!.isPrimary).toBe(true);

    const primaries = (await allParents(obj)).filter((r) => r.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].parentId).toBe(p2);
  });

  it("(b) demotar tidigare primär (p1) utan att radera någon relation", async () => {
    const all = await allParents(obj);
    // Alla tre relationer finns kvar.
    expect(all).toHaveLength(3);
    const byParent = new Map(all.map((r) => [r.parentId, r]));
    expect(byParent.get(p1)).toBeTruthy();
    expect(byParent.get(p1)!.isPrimary).toBe(false);
    expect(byParent.get(p2)!.isPrimary).toBe(true);
    expect(byParent.get(pAlt)).toBeTruthy();
    expect(byParent.get(pAlt)!.isPrimary).toBe(false);
  });

  it("(c) speglar valet till legacy objects.parentId", async () => {
    expect((await objectRow(obj)).parentId).toBe(p2);
  });
});

describe("storage.setPrimaryParent — (d) tenant-isolering", () => {
  let p1: string;
  let p2: string;
  let obj: string;

  beforeAll(async () => {
    const a = await storage.createObject(makeObject(TENANT_A, { name: `${NS} iso-p1` }));
    p1 = a.id;
    const b = await storage.createObject(makeObject(TENANT_A, { name: `${NS} iso-p2` }));
    p2 = b.id;
    const o = await storage.createObject(makeObject(TENANT_A, { name: `${NS} iso-obj`, parentId: p1 }));
    obj = o.id;
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: obj, parentId: p1, isPrimary: true, relationContext: "primary" });
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: obj, parentId: p2, isPrimary: false, relationContext: "alternativ" });
  });

  it("anrop med fel tenant returnerar undefined och lämnar relationer + parentId orörda", async () => {
    const result = await storage.setPrimaryParent(obj, p2, TENANT_B);
    expect(result).toBeUndefined();

    // Relationerna i TENANT_A är oförändrade: p1 fortfarande primär, p2 alternativ.
    const all = await allParents(obj);
    const byParent = new Map(all.map((r) => [r.parentId, r]));
    expect(byParent.get(p1)!.isPrimary).toBe(true);
    expect(byParent.get(p2)!.isPrimary).toBe(false);
    expect((await allParents(obj)).filter((r) => r.isPrimary)).toHaveLength(1);

    // Legacy objects.parentId är oförändrat (pekar fortfarande på p1).
    expect((await objectRow(obj)).parentId).toBe(p1);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/objects/:id/primary-parent — route-tester mot riktig DB
// ---------------------------------------------------------------------------

async function buildApp(tenantId: string): Promise<Express> {
  const expressMod = await import("express");
  const expressFn = (expressMod as unknown as { default?: typeof import("express").default }).default
    ?? (expressMod as unknown as typeof import("express").default);
  const app = expressFn();
  app.use(expressFn.json());
  // Injicera tenant-kontexten som tenant-middleware annars skulle sätta, så att
  // getTenantIdWithFallback(req) returnerar test-tenanten i stället för fallback.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { tenantId: string }).tenantId = tenantId;
    next();
  });
  await registerObjectRoutes(app);
  // Spegla den globala error-middleware:n i server/index.ts så AppError-kastande
  // routes får sin status-kod i stället för att bubbla upp till 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status = err instanceof AppError
      ? err.statusCode
      : (err as { status?: number; statusCode?: number })?.status
        ?? (err as { status?: number; statusCode?: number })?.statusCode
        ?? 500;
    const message = err instanceof Error ? err.message : "Ett oväntat serverfel uppstod";
    res.status(status).json({ error: message });
  });
  return app;
}

interface PatchResult {
  status: number;
  body: Record<string, unknown>;
}

async function patchRoute(app: Express, path: string, body: Record<string, unknown>): Promise<PatchResult> {
  const http = await import("http");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Could not allocate test port");
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("PATCH /api/objects/:id/primary-parent", () => {
  let app: Express;
  let p1: string;
  let p2: string;
  let obj: string;

  beforeAll(async () => {
    app = await buildApp(TENANT_A);
    const a = await storage.createObject(makeObject(TENANT_A, { name: `${NS} route-p1` }));
    p1 = a.id;
    const b = await storage.createObject(makeObject(TENANT_A, { name: `${NS} route-p2` }));
    p2 = b.id;
    const o = await storage.createObject(makeObject(TENANT_A, { name: `${NS} route-obj`, parentId: p1 }));
    obj = o.id;
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: obj, parentId: p1, isPrimary: true, relationContext: "primary" });
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: obj, parentId: p2, isPrimary: false, relationContext: "alternativ" });
  });

  it("400 när parentId saknas i body", async () => {
    const res = await patchRoute(app, `/api/objects/${obj}/primary-parent`, {});
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/parentId/i);
  });

  it("404 när angiven parentId inte är en befintlig föräldrarelation", async () => {
    const res = await patchRoute(app, `/api/objects/${obj}/primary-parent`, { parentId: `${NS}-finns-ej` });
    expect(res.status).toBe(404);
  });

  it("200 lyckad väg: returnerar den uppdaterade relationen som primär", async () => {
    const res = await patchRoute(app, `/api/objects/${obj}/primary-parent`, { parentId: p2 });
    expect(res.status).toBe(200);
    expect(res.body.parentId).toBe(p2);
    expect(res.body.isPrimary).toBe(true);

    // Sidoeffekt verifierad mot DB: exakt en primär, och legacy parentId speglad.
    const primaries = (await allParents(obj)).filter((r) => r.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].parentId).toBe(p2);
    expect((await objectRow(obj)).parentId).toBe(p2);
  });
});
