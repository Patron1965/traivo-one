import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import {
  tenants,
  customers,
  objects,
  articles,
  assignments,
  assignmentArticles,
  metadataKatalog,
  metadataVarden,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { DatabaseStorage } from "../../server/storage";
import { runMetadataChangeJobNow } from "../../server/services/metadata-change-jobs";

// Å1: Dynamisk omräkning av framtida ogjorda uppgifter när ett objekts metadata
// ändras. propagateTaskQuantities ska räkna om antal + totaler för icke-finaliserade
// assignments vars artikel har quantityMode='matches_field', men ALDRIG röra
// utförda (completed) eller avbrutna (cancelled) uppgifter (frozen snapshot).

const storage = new DatabaseStorage();

const METADATA_FIELD = "AntalKarl";
const METADATA_VALUE = 5;
const UNIT_PRICE = 500;
const UNIT_COST = 200;
const UNIT_TIME = 30;

let TEST_TENANT: string;
let createdTenant = false;
let customerId: string;
let objectId: string;
let katalogId: string;
let metadataVardeId: string;
let articleId: string;

let plannedAssignmentId: string;
let completedAssignmentId: string;

describe("Å1 - dynamisk uppdatering av framtida ogjorda uppgifter (matches_field)", () => {
  beforeAll(async () => {
    const tenantId = `mdprop-test-${Date.now()}`;
    const [tenant] = await db
      .insert(tenants)
      .values({ id: tenantId, name: "Metadata Propagation Tenant" })
      .onConflictDoNothing()
      .returning();
    TEST_TENANT = tenant?.id ?? tenantId;
    createdTenant = !!tenant;

    const [customer] = await db
      .insert(customers)
      .values({ tenantId: TEST_TENANT, name: "Prop Testkund" })
      .returning();
    customerId = customer.id;

    const [object] = await db
      .insert(objects)
      .values({
        tenantId: TEST_TENANT,
        customerId,
        name: "Prop Testobjekt",
        objectType: "fastighet",
      })
      .returning();
    objectId = object.id;

    // Metadatatyp + objektvärde (5 kärl) — sätts direkt i DB för att undvika
    // den debounced enqueue-vägen i createMetadata.
    const [katalog] = await db
      .insert(metadataKatalog)
      .values({
        tenantId: TEST_TENANT,
        namn: METADATA_FIELD,
        datatyp: "integer",
      })
      .returning();
    katalogId = katalog.id;

    const [varde] = await db
      .insert(metadataVarden)
      .values({
        tenantId: TEST_TENANT,
        objektId: objectId,
        metadataKatalogId: katalogId,
        vardeInteger: METADATA_VALUE,
      })
      .returning();
    metadataVardeId = varde.id;

    const [article] = await db
      .insert(articles)
      .values({
        tenantId: TEST_TENANT,
        articleNumber: `PROP-${Date.now()}`,
        name: "Prop Test Artikel",
        articleType: "tjanst",
        quantityMode: "matches_field",
        quantityMetadataField: METADATA_FIELD,
      })
      .returning();
    articleId = article.id;

    const planned = await storage.createAssignment({
      tenantId: TEST_TENANT,
      objectId,
      title: "Prop framtida uppgift",
      status: "planned",
      quantity: 1,
    });
    plannedAssignmentId = planned.id;

    const completed = await storage.createAssignment({
      tenantId: TEST_TENANT,
      objectId,
      title: "Prop utförd uppgift",
      status: "completed",
      quantity: 1,
    });
    completedAssignmentId = completed.id;

    for (const assignmentId of [plannedAssignmentId, completedAssignmentId]) {
      await storage.createAssignmentArticle({
        assignmentId,
        articleId,
        quantity: 1,
        unitPrice: UNIT_PRICE,
        totalPrice: UNIT_PRICE,
        unitCost: UNIT_COST,
        totalCost: UNIT_COST,
        unitTime: UNIT_TIME,
        totalTime: UNIT_TIME,
      });
    }
  });

  afterAll(async () => {
    await db
      .delete(assignmentArticles)
      .where(inArray(assignmentArticles.assignmentId, [plannedAssignmentId, completedAssignmentId].filter(Boolean)))
      .catch(() => {});
    if (plannedAssignmentId || completedAssignmentId) {
      await db
        .delete(assignments)
        .where(inArray(assignments.id, [plannedAssignmentId, completedAssignmentId].filter(Boolean)))
        .catch(() => {});
    }
    if (metadataVardeId) {
      await db.delete(metadataVarden).where(eq(metadataVarden.id, metadataVardeId)).catch(() => {});
    }
    if (katalogId) {
      await db.delete(metadataKatalog).where(eq(metadataKatalog.id, katalogId)).catch(() => {});
    }
    if (articleId) {
      await db.delete(articles).where(eq(articles.id, articleId)).catch(() => {});
    }
    if (objectId) {
      await db.delete(objects).where(eq(objects.id, objectId)).catch(() => {});
    }
    if (customerId) {
      await db.delete(customers).where(eq(customers.id, customerId)).catch(() => {});
    }
    if (createdTenant && TEST_TENANT) {
      await db.delete(tenants).where(eq(tenants.id, TEST_TENANT)).catch(() => {});
    }
  });

  it("räknar om antal + totaler för framtida ogjord uppgift till objektets metadatavärde", async () => {
    const before = await storage.getAssignmentArticles(plannedAssignmentId);
    expect(before[0].quantity).toBe(1);

    await runMetadataChangeJobNow(TEST_TENANT, [objectId]);

    const after = await storage.getAssignmentArticles(plannedAssignmentId);
    expect(after[0].quantity).toBe(METADATA_VALUE);
    expect(after[0].totalPrice).toBe(UNIT_PRICE * METADATA_VALUE);
    expect(after[0].totalCost).toBe(UNIT_COST * METADATA_VALUE);
    expect(after[0].totalTime).toBe(UNIT_TIME * METADATA_VALUE);

    const [plannedAssignment] = await db
      .select({ quantity: assignments.quantity })
      .from(assignments)
      .where(eq(assignments.id, plannedAssignmentId));
    expect(plannedAssignment.quantity).toBe(METADATA_VALUE);
  });

  it("lämnar utförd (completed) uppgift orörd — frozen snapshot", async () => {
    const completed = await storage.getAssignmentArticles(completedAssignmentId);
    expect(completed[0].quantity).toBe(1);
    expect(completed[0].totalPrice).toBe(UNIT_PRICE);
  });
});
