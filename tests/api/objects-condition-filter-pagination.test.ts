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
  metadataKatalog,
  metadataVarden,
} from "@shared/schema";
import { inArray, eq } from "drizzle-orm";
import { buildObjectMetadataMap } from "../../server/services/order-concept-targeting";

// Task #1412: /api/objects med metadatavillkor strömmar numera bas-objekten
// sida för sida (batchvis) i stället för att hämta ALLT (limit 1 000 000) och
// filtrera i minnet. Testerna verifierar att den batchade vägen ger samma
// total + korrekt paginering som den delade matchningen
// (filterObjectsByConditions), och att buildObjectMetadataMap chunk:ar stora
// id-listor (>500) utan att tappa värden över chunk-gränsen.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `cf1412-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const FIELD = `Zonkod ${NS}`;

let customerId = "";
let katalogId = "";

async function req(path: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-test-user-id": ADMIN,
  };
  const res = await fetch(`${baseUrl}${path}`, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function conditions(operator: string, filterValue: string) {
  return encodeURIComponent(
    JSON.stringify([{ metadataKey: FIELD, operator, filterValue }]),
  );
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

  await storage.ensureTenant(TENANT, { name: "Condition Filter Pagination Test" });
  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();

  const customer = await storage.createCustomer({
    tenantId: TENANT,
    name: `${NS} Kund`,
    customerNumber: `${NS}-K`,
  });
  customerId = customer.id;

  const [katalog] = await db
    .insert(metadataKatalog)
    .values({
      tenantId: TENANT,
      namn: FIELD,
      datatyp: "string",
      area: "annat",
      kategori: "annat",
    })
    .returning();
  katalogId = katalog.id;

  // 5 objekt; 3 matchar Zonkod = "A" (Obj 1, 3, 5). Namnsorterade i den ordningen.
  const spec: { name: string; zon: string | null }[] = [
    { name: `${NS} Obj 1`, zon: "A" },
    { name: `${NS} Obj 2`, zon: "B" },
    { name: `${NS} Obj 3`, zon: "A" },
    { name: `${NS} Obj 4`, zon: null },
    { name: `${NS} Obj 5`, zon: "A" },
  ];
  for (const s of spec) {
    const obj = await storage.createObject({
      tenantId: TENANT,
      customerId,
      name: s.name,
      status: "active",
    } as any);
    if (s.zon) {
      await db.insert(metadataVarden).values({
        tenantId: TENANT,
        objektId: obj.id,
        metadataKatalogId: katalogId,
        vardeString: s.zon,
      });
    }
  }
}, 60000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  try {
    await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
    await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
    await db.delete(objects).where(eq(objects.tenantId, TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TENANT));
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN]));
    await db.delete(users).where(inArray(users.id, [ADMIN]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT]));
  } catch (err) {
    console.warn("Cleanup (objects-condition-filter-pagination.test) ofullständig:", err);
  }
  process.env.NODE_ENV = originalNodeEnv;
});

describe("GET /api/objects med villkorsfilter (batchad genomströmning)", () => {
  it("returnerar korrekt total och första sidan", async () => {
    const res = await req(
      `/api/objects?search=${encodeURIComponent(NS)}&conditions=${conditions("equals", "A")}&limit=2&offset=0`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.objects).toHaveLength(2);
    expect(res.body.objects.map((o: any) => o.name)).toEqual([`${NS} Obj 1`, `${NS} Obj 3`]);
  });

  it("paginerar korrekt med offset in i matchningsmängden", async () => {
    const res = await req(
      `/api/objects?search=${encodeURIComponent(NS)}&conditions=${conditions("equals", "A")}&limit=2&offset=2`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.objects).toHaveLength(1);
    expect(res.body.objects[0].name).toBe(`${NS} Obj 5`);
  });

  it("offset förbi matchningsmängden ger tom sida men rätt total", async () => {
    const res = await req(
      `/api/objects?search=${encodeURIComponent(NS)}&conditions=${conditions("equals", "A")}&limit=10&offset=10`,
    );
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.objects).toHaveLength(0);
  });

  it("not_equals matchar komplementet (delad semantik)", async () => {
    const res = await req(
      `/api/objects?search=${encodeURIComponent(NS)}&conditions=${conditions("not_equals", "A")}&limit=10&offset=0`,
    );
    expect(res.status).toBe(200);
    // Obj 2 (B) + Obj 4 (saknar värde) — samma semantik som matchesFilter.
    expect(res.body.total).toBe(2);
  });
});

describe("buildObjectMetadataMap chunk:ar stora id-listor", () => {
  it("returnerar samma värden över chunk-gränsen (>500 objekt)", async () => {
    // 520 objekt, alla med Zonkod satt — kartan måste innehålla ALLA.
    const objRows = Array.from({ length: 520 }, (_, i) => ({
      tenantId: TENANT,
      customerId,
      name: `${NS} Bulk ${String(i).padStart(3, "0")}`,
    }));
    const inserted = await db.insert(objects).values(objRows).returning({ id: objects.id });
    const bulkIds = inserted.map((r) => r.id);
    await db.insert(metadataVarden).values(
      bulkIds.map((id) => ({
        tenantId: TENANT,
        objektId: id,
        metadataKatalogId: katalogId,
        vardeString: "A",
      })),
    );

    const map = await buildObjectMetadataMap(TENANT, bulkIds);
    let withValue = 0;
    for (const id of bulkIds) {
      if (map.get(id)?.[FIELD] === "A") withValue++;
    }
    expect(withValue).toBe(520);
  }, 120_000);
});
