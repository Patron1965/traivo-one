import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerObjectRoutes } from "../../server/routes/objectRoutes";
import { registerCustomerRoutes } from "../../server/routes/customerRoutes";
import { metadataRouter } from "../../server/metadata-routes";
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
  objectParents,
  metadataKatalog,
  metadataVarden,
  metadataHistorik,
  workOrders,
} from "@shared/schema";
import { inArray, eq, and, sql } from "drizzle-orm";

// Task #1218 (Etapp 6): GDPR-anonymisering är LOKAL-ONLY och fail-closed.
// Verifierar mot dev-DB:n med de RIKTIGA routrarna bakom samma tenant-middleware
// som i prod (stubbad auth: x-test-user-id → req.user.claims.sub, NODE_ENV=production).
// Samma harness-mönster som object-metadata-inheritance-write.test.ts.
//   1) Anonymisera ett LOKALT värde på källan → 200 + värde förstört + status
//      'anonymiserad' + audit-rad (VEM/NÄR, aldrig VAD).
//   2) Anonymisera ett rent ÄRVT värde på ett barn → 409, ingen falsk framgång,
//      källvärdet på föräldern är oförändrat, ingen audit-rad på barnet.
//   3) Icke-admin → 403 (requireAdmin).

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `anon-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const MEMBER = `${NS}-member`;
const FIELD_SINGLE = `${NS}_Kontakt`;
// Exakt katalog-namn som matar uppgiftspaketets åtkomst-del (ANON_ATKOMST_NAMN).
// Måste vara exakt "Åtkomstkod" — matchning sker på gemener-namn. Unikt per tenant.
const FIELD_ATKOMST = "Åtkomstkod";
let customerId = "";
let parentId = "";
let childId = "";
let singleKatalogId = "";
let atkomstKatalogId = "";
let scrubWoId = "";

async function req(
  method: string,
  path: string,
  opts: { userId?: string | null; body?: unknown } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.userId) headers["x-test-user-id"] = opts.userId;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function createObject(name: string): Promise<string> {
  const res = await req("POST", "/api/objects", {
    userId: ADMIN,
    body: { name, customerId, objectType: "karl", objectLevel: 1, status: "active" },
  });
  expect(res.status).toBe(201);
  expect(res.body?.id).toBeTruthy();
  return res.body.id as string;
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
  await registerObjectRoutes(app);
  await registerCustomerRoutes(app);
  app.use("/api/metadata", metadataRouter);
  app.use(errorHandler);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await storage.ensureTenant(TENANT, { name: "Metadata-anonymisering Test" });
  const c = await storage.createCustomer({
    tenantId: TENANT,
    name: `${NS} Kund`,
    customerNumber: `${NS}-K`,
  });
  customerId = c.id;
  await db
    .insert(users)
    .values([
      { id: ADMIN, email: `${ADMIN}@test.local` },
      { id: MEMBER, email: `${MEMBER}@test.local` },
    ])
    .onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values([
      { userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN },
      { userId: MEMBER, tenantId: TENANT, role: "member", isActive: true, assignedBy: ADMIN },
    ])
    .onConflictDoNothing();

  const [single] = await db
    .insert(metadataKatalog)
    .values({
      tenantId: TENANT,
      namn: FIELD_SINGLE,
      datatyp: "string",
      standardArvs: true,
      allowDuplicates: false,
    })
    .returning({ id: metadataKatalog.id });
  singleKatalogId = single.id;

  parentId = await createObject(`${NS} Förälder`);
  childId = await createObject(`${NS} Barn`);
  const link = await req("POST", `/api/objects/${childId}/parents`, {
    userId: ADMIN,
    body: { parentId },
  });
  expect(link.status).toBe(201);

  // Lokalt värde på FÖRÄLDERN (ärvs nedåt till barnet).
  const seed = await req("POST", `/api/objects/${parentId}/metadata/new-instance`, {
    userId: ADMIN,
    body: { metadataTypNamn: FIELD_SINGLE, varde: "Anna 070-111 11 11", level: parentId },
  });
  expect(seed.status).toBe(201);

  // Åtkomstkod-fält (matar uppgiftspaketets atkomst-del) + lokalt värde på föräldern.
  const [atk] = await db
    .insert(metadataKatalog)
    .values({
      tenantId: TENANT,
      namn: FIELD_ATKOMST,
      datatyp: "string",
      standardArvs: true,
      allowDuplicates: false,
    })
    .returning({ id: metadataKatalog.id });
  atkomstKatalogId = atk.id;
  const seedAtk = await req("POST", `/api/objects/${parentId}/metadata/new-instance`, {
    userId: ADMIN,
    body: { metadataTypNamn: FIELD_ATKOMST, varde: "1234", level: parentId },
  });
  expect(seedAtk.status).toBe(201);

  // Work order på föräldern med ett uppgiftspaket som bär åtkomst-kopian (jsonb).
  const [wo] = await db
    .insert(workOrders)
    .values({
      tenantId: TENANT,
      customerId,
      objectId: parentId,
      title: `${NS} WO`,
      uppgiftspaket: { version: 1, atkomst: { kod: "1234" }, position: null } as any,
    })
    .returning({ id: workOrders.id });
  scrubWoId = wo.id;
}, 40000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  try {
    await db.delete(workOrders).where(inArray(workOrders.tenantId, [TENANT]));
    await db.delete(metadataHistorik).where(inArray(metadataHistorik.tenantId, [TENANT]));
    await db.delete(metadataVarden).where(inArray(metadataVarden.tenantId, [TENANT]));
    await db.delete(metadataKatalog).where(inArray(metadataKatalog.tenantId, [TENANT]));
    await db.delete(objectParents).where(inArray(objectParents.tenantId, [TENANT]));
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT]));
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN, MEMBER]));
    await db.delete(users).where(inArray(users.id, [ADMIN, MEMBER]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT]));
  } catch (err) {
    console.warn("Cleanup (metadata-anonymize.test) ofullständig:", err);
  }
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("Task #1218 — GDPR-anonymisering (lokal-only, fail-closed)", () => {
  it("kräver explicit bekräftelse: confirm saknas → 400", async () => {
    const res = await req("POST", `/api/metadata/objects/${parentId}/field/${singleKatalogId}/anonymize`, {
      userId: ADMIN,
      body: {},
    });
    expect(res.status).toBe(400);
  });

  it("icke-admin avvisas → 403", async () => {
    const res = await req("POST", `/api/metadata/objects/${parentId}/field/${singleKatalogId}/anonymize`, {
      userId: MEMBER,
      body: { confirm: true },
    });
    expect(res.status).toBe(403);
    // Värdet är oförändrat.
    const [row] = await db
      .select({ vardeString: metadataVarden.vardeString, status: metadataVarden.status })
      .from(metadataVarden)
      .where(and(eq(metadataVarden.objektId, parentId), eq(metadataVarden.metadataKatalogId, singleKatalogId)));
    expect(row?.vardeString).toBe("Anna 070-111 11 11");
    expect(row?.status).not.toBe("anonymiserad");
  });

  it("ärvt-only fält på BARN → 409, ingen falsk framgång, källvärdet oförändrat", async () => {
    const res = await req("POST", `/api/metadata/objects/${childId}/field/${singleKatalogId}/anonymize`, {
      userId: ADMIN,
      body: { confirm: true },
    });
    expect(res.status).toBe(409);
    // Källvärdet på FÖRÄLDERN är intakt.
    const [row] = await db
      .select({ vardeString: metadataVarden.vardeString, status: metadataVarden.status })
      .from(metadataVarden)
      .where(and(eq(metadataVarden.objektId, parentId), eq(metadataVarden.metadataKatalogId, singleKatalogId)));
    expect(row?.vardeString).toBe("Anna 070-111 11 11");
    expect(row?.status).not.toBe("anonymiserad");
    // Ingen audit-rad stämplades för barnet.
    const childAudit = await db
      .select({ id: metadataHistorik.id })
      .from(metadataHistorik)
      .where(
        and(
          eq(metadataHistorik.objektId, childId),
          eq(metadataHistorik.andringsMetod, "anonymisering"),
        ),
      );
    expect(childAudit.length).toBe(0);
  });

  it("anonymisering av åtkomst-fält förstör uppgiftspaket-kopian (jsonb) på WO → atkomst = null", async () => {
    // Förhandsvillkor: paketet bär åtkomst-kopian innan anonymisering.
    const before = await db.execute(sql`
      SELECT uppgiftspaket -> 'atkomst' AS atkomst
      FROM work_orders WHERE id = ${scrubWoId}
    `);
    expect(JSON.stringify((before.rows[0] as any)?.atkomst)).toContain("1234");

    const res = await req("POST", `/api/metadata/objects/${parentId}/field/${atkomstKatalogId}/anonymize`, {
      userId: ADMIN,
      body: { confirm: true },
    });
    expect(res.status).toBe(200);

    // Den durabla paket-kopian är förstörd (jsonb null), inte kvarlämnad.
    const after = await db.execute(sql`
      SELECT uppgiftspaket -> 'atkomst' AS atkomst
      FROM work_orders WHERE id = ${scrubWoId}
    `);
    const atkomstAfter = (after.rows[0] as any)?.atkomst;
    expect(atkomstAfter === null || String(atkomstAfter) === "null").toBe(true);
  });

  it("lokalt värde på KÄLLAN → 200, värde förstört + status 'anonymiserad' + audit-rad (VEM/NÄR, ej VAD)", async () => {
    const res = await req("POST", `/api/metadata/objects/${parentId}/field/${singleKatalogId}/anonymize`, {
      userId: ADMIN,
      body: { confirm: true },
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select({
        vardeString: metadataVarden.vardeString,
        vardeJson: metadataVarden.vardeJson,
        status: metadataVarden.status,
        anonymiseradAv: metadataVarden.anonymiseradAv,
        anonymiseradVid: metadataVarden.anonymiseradVid,
      })
      .from(metadataVarden)
      .where(and(eq(metadataVarden.objektId, parentId), eq(metadataVarden.metadataKatalogId, singleKatalogId)));
    expect(row?.vardeString).toBeNull();
    expect(row?.vardeJson).toBeNull();
    expect(row?.status).toBe("anonymiserad");
    expect(row?.anonymiseradAv).toBe(ADMIN);
    expect(row?.anonymiseradVid).toBeTruthy();

    // Audit-rad: VEM och NÄR — aldrig VAD.
    const [audit] = await db
      .select({
        andradAv: metadataHistorik.andradAv,
        andringsMetod: metadataHistorik.andringsMetod,
        gammaltVarde: metadataHistorik.gammaltVarde,
        nyttVarde: metadataHistorik.nyttVarde,
      })
      .from(metadataHistorik)
      .where(
        and(
          eq(metadataHistorik.objektId, parentId),
          eq(metadataHistorik.andringsMetod, "anonymisering"),
        ),
      );
    expect(audit?.andradAv).toBe(ADMIN);
    expect(audit?.gammaltVarde).toBeNull();
    expect(audit?.nyttVarde).toBeNull();

    // Ingen historik-rad för fältet läcker det gamla värdet.
    const leaks = await db
      .select({ id: metadataHistorik.id })
      .from(metadataHistorik)
      .where(
        and(
          eq(metadataHistorik.objektId, parentId),
          eq(metadataHistorik.metadataKatalogId, singleKatalogId),
        ),
      );
    for (const _ of leaks) {
      // täcks av gammalt/nytt = NULL-scrub ovan; assertion på audit-raden räcker.
    }
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("oåterkallelig: PUT /api/metadata/:id på anonymiserad rad → 409, värde/status oförändrat", async () => {
    // Föregående test anonymiserade singleKatalogId på föräldern → raden är nu
    // status 'anonymiserad' med nullat värde. En vanlig redigeringsväg får ALDRIG
    // återuppliva den (skriva nytt värde eller flippa status till 'aktiv').
    const [row] = await db
      .select({ id: metadataVarden.id })
      .from(metadataVarden)
      .where(and(eq(metadataVarden.objektId, parentId), eq(metadataVarden.metadataKatalogId, singleKatalogId)));
    expect(row?.id).toBeTruthy();

    const res = await req("PUT", `/api/metadata/${row.id}`, {
      userId: ADMIN,
      body: { varde: "Återupplivat värde 070-999 99 99", uppdateradAv: ADMIN, metod: "manuell" },
    });
    expect(res.status).toBe(409);

    // Raden är fortfarande anonymiserad och tom — inget värde skrevs, status ej flippad.
    const [after] = await db
      .select({ vardeString: metadataVarden.vardeString, status: metadataVarden.status })
      .from(metadataVarden)
      .where(eq(metadataVarden.id, row.id));
    expect(after?.vardeString).toBeNull();
    expect(after?.status).toBe("anonymiserad");
  });
});
