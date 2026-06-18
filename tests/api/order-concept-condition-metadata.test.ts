import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  customers,
  objects,
  metadataKatalog,
  metadataVarden,
  type ServiceObject,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  buildObjectMetadataMap,
  filterObjectsByConditions,
  evaluateConditionsForObject,
} from "../../server/services/order-concept-targeting";

// Task #992: orderkoncept-villkorsmotorn läser nu metadata KANONISKT från det
// svenska systemet (metadata_katalog/metadata_varden) i stället för det
// avvecklade engelska (metadata_definitions/object_metadata). Detta
// integrationstest verifierar att filter resolvar mot importerade svenska
// värden via fältets `namn`, dess `beteckning` och med arv, att lokala värden
// skuggar ärvda, samt att beräknade fält (ar_beraknad) ALDRIG deltar i
// matchningen även om ett lagrat värde finns kvar.

const NS = `cm-${Date.now()}`;
const TENANT = `${NS}-tenant`;

let parent: ServiceObject;
let child: ServiceObject;

beforeAll(async () => {
  await db
    .insert(tenants)
    .values({ id: TENANT, name: "Condition Metadata Test" })
    .onConflictDoNothing();
  const [customer] = await db
    .insert(customers)
    .values({ tenantId: TENANT, name: "Testkund" })
    .returning();

  [parent] = await db
    .insert(objects)
    .values({ tenantId: TENANT, customerId: customer.id, name: "Förälder", objectType: "fastighet" })
    .returning();
  [child] = await db
    .insert(objects)
    .values({
      tenantId: TENANT,
      customerId: customer.id,
      name: "Barn",
      objectType: "lagenhet",
      parentId: parent.id,
    })
    .returning();

  // Katalogfält: Kärltyp (sträng, beteckning KT), Antal (heltal, beteckning ANT)
  // och Yta (beräknat fält → får aldrig matcha trots lagrat värde).
  const [karltyp] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: "Kärltyp", datatyp: "string", beteckning: "KT" })
    .returning();
  const [antal] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: "Antal", datatyp: "integer", beteckning: "ANT" })
    .returning();
  const [yta] = await db
    .insert(metadataKatalog)
    .values({
      tenantId: TENANT,
      namn: "Yta",
      datatyp: "decimal",
      beteckning: "M2",
      arBeraknad: true,
      formel: "1*2",
    })
    .returning();

  // Förälder: Kärltyp=plastkärl och Antal=10 — båda ärvs nedåt.
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId: parent.id,
    metadataKatalogId: karltyp.id,
    vardeString: "plastkärl",
    arvsNedat: true,
  });
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId: parent.id,
    metadataKatalogId: antal.id,
    vardeInteger: 10,
    arvsNedat: true,
  });
  // Barn: eget Antal=5 (skuggar ärvt 10), ingen egen Kärltyp (ärver plastkärl).
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId: child.id,
    metadataKatalogId: antal.id,
    vardeInteger: 5,
  });
  // Lagrat (inaktuellt) värde på det beräknade fältet — får ALDRIG matcha.
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId: parent.id,
    metadataKatalogId: yta.id,
    vardeDecimal: 999,
  });

  // Nyckelkollision: fält A:s beteckning ("KOD") == fält B:s namn ("KOD").
  // Kanoniskt `namn` ska ALLTID vinna över ett annat fälts `beteckning`, annars
  // resolvar ett sparat concept_filters.metadata_key mot fel objektvärde.
  const [collideA] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: "Container", datatyp: "string", beteckning: "KOD" })
    .returning();
  const [collideB] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: "KOD", datatyp: "string", beteckning: "KODB" })
    .returning();
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId: parent.id,
    metadataKatalogId: collideA.id,
    vardeString: "alfa",
  });
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId: parent.id,
    metadataKatalogId: collideB.id,
    vardeString: "beta",
  });
}, 30000);

afterAll(async () => {
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
}, 30000);

describe("orderkoncept villkorsmotor läser svensk metadata (Task #992)", () => {
  it("bygger karta nycklad på namn OCH beteckning; beräknat fält strippat", async () => {
    const map = await buildObjectMetadataMap(TENANT, [parent.id, child.id]);
    const p = map.get(parent.id) ?? {};
    expect(p["Kärltyp"]).toBe("plastkärl");
    expect(p["KT"]).toBe("plastkärl"); // beteckning resolvar samma värde
    expect(p["Antal"]).toBe("10");
    expect(p["ANT"]).toBe("10");
    // Beräknat fält (Yta) ska aldrig finnas i kartan trots lagrat varde_decimal.
    expect("Yta" in p).toBe(false);
    expect("M2" in p).toBe(false);
  });

  it("matchar via namn (equals) — inkl. ärvt värde på barnet", async () => {
    const m = await filterObjectsByConditions(TENANT, [parent, child], [
      { metadataKey: "Kärltyp", operator: "equals", filterValue: "plastkärl" },
    ]);
    expect(m.map((o) => o.id).sort()).toEqual([parent.id, child.id].sort());
  });

  it("matchar via beteckning (equals) — samma värde, annan nyckel", async () => {
    const m = await filterObjectsByConditions(TENANT, [parent, child], [
      { metadataKey: "KT", operator: "equals", filterValue: "plastkärl" },
    ]);
    expect(m.map((o) => o.id).sort()).toEqual([parent.id, child.id].sort());
  });

  it("legacy fieldKey==namn fortsätter resolva mot ärvt värde på barn", async () => {
    const { matched } = await evaluateConditionsForObject(TENANT, child, [
      { metadataKey: "Kärltyp", operator: "equals", filterValue: "plastkärl" },
    ]);
    expect(matched).toBe(true);
  });

  it("lokalt numeriskt värde skuggar ärvt (greater_than)", async () => {
    // Antal: förälder=10, barn=5 (eget). greater_than 7 → bara föräldern.
    const m = await filterObjectsByConditions(TENANT, [parent, child], [
      { metadataKey: "Antal", operator: "greater_than", filterValue: 7 },
    ]);
    expect(m.map((o) => o.id)).toEqual([parent.id]);
  });

  it("beräknat fält deltar aldrig i matchning (exists=false)", async () => {
    const { matched } = await evaluateConditionsForObject(TENANT, parent, [
      { metadataKey: "Yta", operator: "exists", filterValue: undefined },
    ]);
    expect(matched).toBe(false);
  });

  it("kanoniskt namn vinner över ett annat fälts beteckning vid kollision", async () => {
    // Fält A: namn=Container, beteckning=KOD (värde "alfa").
    // Fält B: namn=KOD,       beteckning=KODB (värde "beta").
    const map = await buildObjectMetadataMap(TENANT, [parent.id]);
    const p = map.get(parent.id) ?? {};
    // Nyckeln "KOD" MÅSTE resolva mot fält B:s namn-värde, inte A:s beteckning.
    expect(p["KOD"]).toBe("beta");
    expect(p["Container"]).toBe("alfa");
    expect(p["KODB"]).toBe("beta");

    // Filter på "KOD" matchar B:s värde, inte A:s.
    const hit = await filterObjectsByConditions(TENANT, [parent], [
      { metadataKey: "KOD", operator: "equals", filterValue: "beta" },
    ]);
    expect(hit.map((o) => o.id)).toEqual([parent.id]);
    const miss = await filterObjectsByConditions(TENANT, [parent], [
      { metadataKey: "KOD", operator: "equals", filterValue: "alfa" },
    ]);
    expect(miss).toEqual([]);
  });
});
