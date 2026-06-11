import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { db } from "../../server/db";
import {
  tenants,
  users,
  userTenantRoles,
  customers,
  objects,
  orderConcepts,
  assignments,
  metadataKatalog,
  metadataVarden,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { registerFortnoxRoutes } from "../../server/routes/fortnoxRoutes";

// Task #910: integrationstest för POST /api/order-concepts/:id/execute med
// metadatastyrd leveranstid (Task #901 B8). När konceptet pekar ut ett
// metadatafält (metadata_katalog.namn) läses objektets värde ärvningsmedvetet
// och tolkas som leveransdatum. Giltigt värde stämplas på assignment.scheduledDate
// och räknas som deliveryTimeFromMetadata; saknat/ogiltigt värde faller tillbaka
// på det schemalagda datumet och räknas som deliveryTimeFallback. Saknas fältet
// helt på konceptet ska beteendet vara oförändrat (inga räknare).
//
// Appen monteras bakom samma tenant-middleware som i prod
// (requireTenantWithFallback) med en stubbad auth (x-test-user-id) och
// NODE_ENV=production, precis som metadata-katalog-route.test.ts.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `dt-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;

let customerId: string;
let objValidId: string;
let objInvalidId: string;
let objMissingId: string;
let katalogId: string;
let conceptWithFieldId: string;
let conceptWithoutFieldId: string;

const META_FIELD = "Leveranstid";
const VALID_META_DATE = new Date("2026-08-15T10:00:00.000Z");
const SCHEDULED_DATE = new Date("2026-09-01T08:00:00.000Z");

async function execute(conceptId: string) {
  const res = await fetch(`${baseUrl}/api/order-concepts/${conceptId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": ADMIN },
    body: JSON.stringify({ scheduledDate: SCHEDULED_DATE.toISOString() }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
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
  await registerFortnoxRoutes(app);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await db.insert(tenants).values({ id: TENANT, name: "Delivery Time Test Tenant" }).onConflictDoNothing();
  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();

  const [customer] = await db
    .insert(customers)
    .values({ tenantId: TENANT, name: "Leveranstid Testkund" })
    .returning();
  customerId = customer.id;

  const [objValid] = await db
    .insert(objects)
    .values({ tenantId: TENANT, customerId, name: "Objekt giltig", objectType: "fastighet" })
    .returning();
  objValidId = objValid.id;

  const [objInvalid] = await db
    .insert(objects)
    .values({ tenantId: TENANT, customerId, name: "Objekt ogiltig", objectType: "fastighet" })
    .returning();
  objInvalidId = objInvalid.id;

  const [objMissing] = await db
    .insert(objects)
    .values({ tenantId: TENANT, customerId, name: "Objekt saknar", objectType: "fastighet" })
    .returning();
  objMissingId = objMissing.id;

  // Metadatatyp som konceptet pekar ut via namn.
  const [katalog] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: META_FIELD, datatyp: "datetime", beteckning: "LEV" })
    .returning();
  katalogId = katalog.id;

  // objValid: giltigt datetime-värde.
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId: objValidId,
    metadataKatalogId: katalogId,
    vardeDatetime: VALID_META_DATE,
  });
  // objInvalid: skräp-sträng som parseDeliveryDate avvisar → fallback.
  await db.insert(metadataVarden).values({
    tenantId: TENANT,
    objektId: objInvalidId,
    metadataKatalogId: katalogId,
    vardeString: "inte-ett-datum",
  });
  // objMissing: inget värde alls för fältet → fallback.

  const [withField] = await db
    .insert(orderConcepts)
    .values({ tenantId: TENANT, name: "Koncept med leveranstidsfält", deliveryTimeMetadataField: META_FIELD })
    .returning();
  conceptWithFieldId = withField.id;

  const [withoutField] = await db
    .insert(orderConcepts)
    .values({ tenantId: TENANT, name: "Koncept utan leveranstidsfält" })
    .returning();
  conceptWithoutFieldId = withoutField.id;
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await db.delete(assignments).where(eq(assignments.tenantId, TENANT));
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db
    .delete(orderConcepts)
    .where(inArray(orderConcepts.id, [conceptWithFieldId, conceptWithoutFieldId]));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.id, customerId));
  await db.delete(userTenantRoles).where(eq(userTenantRoles.userId, ADMIN));
  await db.delete(users).where(eq(users.id, ADMIN));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("POST /api/order-concepts/:id/execute — metadatastyrd leveranstid (Task #910)", () => {
  it("oinloggad → 401", async () => {
    const res = await fetch(`${baseUrl}/api/order-concepts/${conceptWithFieldId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: SCHEDULED_DATE.toISOString() }),
    });
    expect(res.status).toBe(401);
  });

  it("stämplar metadatadatum på objekt med giltigt värde och faller tillbaka för övriga", async () => {
    const { status, body } = await execute(conceptWithFieldId);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.objectsMatched).toBe(3);
    expect(body.assignmentsCreated).toBe(3);

    // En träff från metadata (objValid), två fallback (objInvalid + objMissing).
    expect(body.deliveryTimeFromMetadata).toBe(1);
    expect(body.deliveryTimeFallback).toBe(2);

    const byObject = new Map<string, any>(
      (body.assignments as any[]).map((a) => [a.objectId, a]),
    );

    // objValid: scheduledDate = metadatavärdet.
    const validAssignment = byObject.get(objValidId);
    expect(validAssignment).toBeDefined();
    expect(new Date(validAssignment.scheduledDate).toISOString()).toBe(
      VALID_META_DATE.toISOString(),
    );

    // objInvalid + objMissing: fallback till det schemalagda datumet.
    for (const id of [objInvalidId, objMissingId]) {
      const a = byObject.get(id);
      expect(a).toBeDefined();
      expect(new Date(a.scheduledDate).toISOString()).toBe(SCHEDULED_DATE.toISOString());
    }
  });

  it("koncept utan leveranstidsfält → oförändrat beteende (inga räknare, schemalagt datum)", async () => {
    const { status, body } = await execute(conceptWithoutFieldId);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.assignmentsCreated).toBe(3);
    expect(body.deliveryTimeFromMetadata).toBe(0);
    expect(body.deliveryTimeFallback).toBe(0);

    for (const a of body.assignments as any[]) {
      expect(new Date(a.scheduledDate).toISOString()).toBe(SCHEDULED_DATE.toISOString());
    }
  });
});
