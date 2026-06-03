import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  metadataKatalog,
  metadataVarden,
  orderConcepts,
  conceptFilters,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { getMetadataKatalogUsage } from "../../server/metadata-queries";

// Task #645: metadatareferensen (namn/beteckning) är en stabil universell nyckel.
// getMetadataKatalogUsage avgör om en metadatatyp är "i bruk" — vilket blockerar
// tyst omdöpning av referensen. Räkningen täcker både metadatavärden
// (objekt/WO, inkl. import) och koncept-filter som matchar referensen.

let TEST_TENANT: string;
let createdTenant = false;
let unusedKatalogId: string;
let usedKatalogId: string;
let conceptKatalogId: string;
let orderConceptId: string;

describe("getMetadataKatalogUsage (Task #645)", () => {
  beforeAll(async () => {
    const tenantId = `mk-usage-${Date.now()}`;
    const [tenant] = await db
      .insert(tenants)
      .values({ id: tenantId, name: "Metadata Usage Test Tenant" })
      .onConflictDoNothing()
      .returning();
    TEST_TENANT = tenant?.id ?? tenantId;
    createdTenant = !!tenant;

    const [unused] = await db
      .insert(metadataKatalog)
      .values({ tenantId: TEST_TENANT, namn: "OanväntFält", datatyp: "string", beteckning: "OAN" })
      .returning();
    unusedKatalogId = unused.id;

    const [used] = await db
      .insert(metadataKatalog)
      .values({ tenantId: TEST_TENANT, namn: "AnväntFält", datatyp: "string", beteckning: "ANV" })
      .returning();
    usedKatalogId = used.id;

    // Ett metadatavärde gör typen "i bruk" (objekt/WO null tillåtet i schemat).
    await db.insert(metadataVarden).values({
      tenantId: TEST_TENANT,
      metadataKatalogId: usedKatalogId,
      vardeString: "ett värde",
    });

    // En typ som bara refereras av ett koncept-filter via beteckningen.
    const [conceptKat] = await db
      .insert(metadataKatalog)
      .values({ tenantId: TEST_TENANT, namn: "FilterFält", datatyp: "string", beteckning: "FIL" })
      .returning();
    conceptKatalogId = conceptKat.id;

    const [concept] = await db
      .insert(orderConcepts)
      .values({ tenantId: TEST_TENANT, name: "Testkoncept" })
      .returning();
    orderConceptId = concept.id;

    await db.insert(conceptFilters).values({
      orderConceptId,
      metadataKey: "FIL", // matchar beteckningen på conceptKat
      operator: "equals",
      filterValue: "x",
    });
  });

  afterAll(async () => {
    await db.delete(conceptFilters).where(eq(conceptFilters.orderConceptId, orderConceptId));
    await db.delete(orderConcepts).where(eq(orderConcepts.id, orderConceptId));
    await db.delete(metadataVarden).where(eq(metadataVarden.metadataKatalogId, usedKatalogId));
    for (const id of [unusedKatalogId, usedKatalogId, conceptKatalogId]) {
      await db.delete(metadataKatalog).where(eq(metadataKatalog.id, id));
    }
    if (createdTenant) {
      await db.delete(tenants).where(eq(tenants.id, TEST_TENANT));
    }
  });

  it("rapporterar total=0 för en oanvänd metadatatyp", async () => {
    const usage = await getMetadataKatalogUsage(unusedKatalogId, TEST_TENANT);
    expect(usage.valueCount).toBe(0);
    expect(usage.conceptFilterCount).toBe(0);
    expect(usage.total).toBe(0);
  });

  it("räknar metadatavärden som gör typen i bruk", async () => {
    const usage = await getMetadataKatalogUsage(usedKatalogId, TEST_TENANT);
    expect(usage.valueCount).toBe(1);
    expect(usage.total).toBeGreaterThan(0);
  });

  it("räknar koncept-filter som matchar referensens beteckning", async () => {
    const usage = await getMetadataKatalogUsage(conceptKatalogId, TEST_TENANT);
    expect(usage.conceptFilterCount).toBe(1);
    expect(usage.total).toBe(1);
  });

  it("returnerar tom användning för okänt id", async () => {
    const usage = await getMetadataKatalogUsage("finns-inte", TEST_TENANT);
    expect(usage.total).toBe(0);
    expect(usage.namn).toBeNull();
  });
});
