import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { tenants, customers, objects, objectParents } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { InsertObject } from "@shared/schema";

// Task #862: storage.moveObject är affärskritisk (hela grenen följer med en
// butik som byter samarbetspartner) men saknade direkta enhetstester. Route-
// nivåfallen (cykelskydd → 400, tenant-isolering → 404, rotflytt → null,
// parentId↔object_parents-synk) täcks redan av object-move-copy.test.ts. Här
// verifieras storage-lagret direkt: (a) objektet flyttas, (b) primär
// object_parents hålls i synk med objects.parentId, (c) tidigare primär-
// relation demotas (men raderas ej), och (d) barnträdet lämnas intakt.

const NS = `mvti-${Date.now()}`;
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
  await storage.ensureTenant(TENANT_A, { name: "Move Tree Integrity A" });
  await storage.ensureTenant(TENANT_B, { name: "Move Tree Integrity B" });
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
    console.warn("Cleanup (object-move-tree-integrity.test) ofullständig:", err);
  }
}, 30000);

async function primaryParents(objectId: string) {
  return db.select().from(objectParents)
    .where(and(eq(objectParents.objectId, objectId), eq(objectParents.isPrimary, true)));
}

async function objectRow(objectId: string) {
  const [row] = await db.select().from(objects).where(eq(objects.id, objectId));
  return row;
}

describe("storage.moveObject — flyttar objektet och håller object_parents i synk", () => {
  let p1: string;
  let p2: string;
  let obj: string;

  beforeAll(async () => {
    const a = await storage.createObject(makeObject(TENANT_A, { name: `${NS} synk-p1` }));
    p1 = a.id;
    const b = await storage.createObject(makeObject(TENANT_A, { name: `${NS} synk-p2` }));
    p2 = b.id;
    const o = await storage.createObject(makeObject(TENANT_A, { name: `${NS} synk-obj`, parentId: p1 }));
    obj = o.id;
    // Seed en explicit primär object_parents-rad mot p1 (motsvarar ett objekt
    // som redan har en synkad föräldra-relation innan flytt).
    await storage.addObjectParent({
      tenantId: TENANT_A, objectId: obj, parentId: p1, isPrimary: true, relationContext: "primary",
    });
  });

  it("(a) flyttar objektet: returvärdet och DB-raden pekar på nya föräldern", async () => {
    const moved = await storage.moveObject(obj, p2, TENANT_A);
    expect(moved).toBeTruthy();
    expect(moved!.parentId).toBe(p2);
    expect((await objectRow(obj)).parentId).toBe(p2);
  });

  it("(b) primär object_parents-raden är i synk med objects.parentId", async () => {
    const primaries = await primaryParents(obj);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].parentId).toBe(p2);
    expect((await objectRow(obj)).parentId).toBe(primaries[0].parentId);
  });
});

describe("storage.moveObject — (c) demotar tidigare primär-relation utan att radera den", () => {
  let p1: string;
  let p2: string;
  let pAlt: string;
  let obj: string;

  beforeAll(async () => {
    const a = await storage.createObject(makeObject(TENANT_A, { name: `${NS} demote-p1` }));
    p1 = a.id;
    const b = await storage.createObject(makeObject(TENANT_A, { name: `${NS} demote-p2` }));
    p2 = b.id;
    const c = await storage.createObject(makeObject(TENANT_A, { name: `${NS} demote-alt` }));
    pAlt = c.id;
    const o = await storage.createObject(makeObject(TENANT_A, { name: `${NS} demote-obj`, parentId: p1 }));
    obj = o.id;
    // Multi-förälder: p1 är primär, pAlt är en alternativ (icke-primär) relation.
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: obj, parentId: p1, isPrimary: true, relationContext: "primary" });
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: obj, parentId: pAlt, isPrimary: false, relationContext: "alternativ" });
  });

  it("efter flytt till p2: p2 är primär, p1 demoteras men finns kvar, pAlt orörd", async () => {
    await storage.moveObject(obj, p2, TENANT_A);

    const all = await db.select().from(objectParents).where(eq(objectParents.objectId, obj));
    const byParent = new Map(all.map((r) => [r.parentId, r]));

    // Exakt en primär — och den pekar på p2.
    const primaries = all.filter((r) => r.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].parentId).toBe(p2);

    // Tidigare primär (p1) finns kvar men är demoterad.
    expect(byParent.get(p1)).toBeTruthy();
    expect(byParent.get(p1)!.isPrimary).toBe(false);

    // Alternativ relation (pAlt) är oförändrat icke-primär och finns kvar.
    expect(byParent.get(pAlt)).toBeTruthy();
    expect(byParent.get(pAlt)!.isPrimary).toBe(false);
  });
});

describe("storage.moveObject — (d) barnträdet lämnas intakt", () => {
  let p1: string;
  let p2: string;
  let obj: string;
  let childA: string;
  let childB: string;
  let grandchild: string;

  beforeAll(async () => {
    const a = await storage.createObject(makeObject(TENANT_A, { name: `${NS} tree-p1` }));
    p1 = a.id;
    const b = await storage.createObject(makeObject(TENANT_A, { name: `${NS} tree-p2` }));
    p2 = b.id;
    const o = await storage.createObject(makeObject(TENANT_A, { name: `${NS} tree-obj`, parentId: p1 }));
    obj = o.id;
    const ca = await storage.createObject(makeObject(TENANT_A, { name: `${NS} tree-childA`, parentId: obj }));
    childA = ca.id;
    const cb = await storage.createObject(makeObject(TENANT_A, { name: `${NS} tree-childB`, parentId: obj }));
    childB = cb.id;
    const g = await storage.createObject(makeObject(TENANT_A, { name: `${NS} tree-grandchild`, parentId: childA }));
    grandchild = g.id;
    // Explicita object_parents-rader för barnen, mot obj.
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: childA, parentId: obj, isPrimary: true, relationContext: "primary" });
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: childB, parentId: obj, isPrimary: true, relationContext: "primary" });
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: grandchild, parentId: childA, isPrimary: true, relationContext: "primary" });
  });

  it("efter flytt av obj följer barnen med: deras parentId pekar oförändrat på obj", async () => {
    await storage.moveObject(obj, p2, TENANT_A);

    // Det flyttade objektet bytte förälder.
    expect((await objectRow(obj)).parentId).toBe(p2);

    // Barnen pekar fortfarande på obj (inte p2, inte null) — grenen följde med.
    expect((await objectRow(childA)).parentId).toBe(obj);
    expect((await objectRow(childB)).parentId).toBe(obj);
    expect((await objectRow(grandchild)).parentId).toBe(childA);
  });

  it("barnens object_parents-rader är oförändrade (ingen tappad/dubblerad relation)", async () => {
    const childAPrimaries = await primaryParents(childA);
    expect(childAPrimaries).toHaveLength(1);
    expect(childAPrimaries[0].parentId).toBe(obj);

    const childBPrimaries = await primaryParents(childB);
    expect(childBPrimaries).toHaveLength(1);
    expect(childBPrimaries[0].parentId).toBe(obj);

    const grandchildPrimaries = await primaryParents(grandchild);
    expect(grandchildPrimaries).toHaveLength(1);
    expect(grandchildPrimaries[0].parentId).toBe(childA);
  });
});

describe("storage.moveObject — flytt till rotnivå (parentId=null)", () => {
  let p1: string;
  let obj: string;

  beforeAll(async () => {
    const a = await storage.createObject(makeObject(TENANT_A, { name: `${NS} root-p1` }));
    p1 = a.id;
    const o = await storage.createObject(makeObject(TENANT_A, { name: `${NS} root-obj`, parentId: p1 }));
    obj = o.id;
    await storage.addObjectParent({ tenantId: TENANT_A, objectId: obj, parentId: p1, isPrimary: true, relationContext: "primary" });
  });

  it("nollar objects.parentId och demotar primär-raden (ingen primär kvar)", async () => {
    const moved = await storage.moveObject(obj, null, TENANT_A);
    expect(moved!.parentId).toBeNull();
    expect((await objectRow(obj)).parentId).toBeNull();

    const primaries = await primaryParents(obj);
    expect(primaries).toHaveLength(0);
  });
});

describe("storage.moveObject — defensiva spärrar", () => {
  let obj: string;

  beforeAll(async () => {
    const o = await storage.createObject(makeObject(TENANT_A, { name: `${NS} guard-obj` }));
    obj = o.id;
  });

  it("kastar när objektet skulle bli sin egen förälder", async () => {
    await expect(storage.moveObject(obj, obj, TENANT_A)).rejects.toThrow(/egen förälder/i);
  });

  it("returnerar undefined för okänt objekt-id", async () => {
    const result = await storage.moveObject(`${NS}-finns-ej`, null, TENANT_A);
    expect(result).toBeUndefined();
  });

  it("returnerar undefined när objektet tillhör en annan tenant (tenant-isolering)", async () => {
    const result = await storage.moveObject(obj, null, TENANT_B);
    expect(result).toBeUndefined();
    // Objektet i tenant A ska vara orört.
    expect((await objectRow(obj)).tenantId).toBe(TENANT_A);
  });
});
