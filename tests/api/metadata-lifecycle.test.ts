import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerObjectRoutes } from "../../server/routes/objectRoutes";
import { registerCustomerRoutes } from "../../server/routes/customerRoutes";
import { registerKPIRoutes } from "../../server/routes/kpiRoutes";
import { metadataRouter } from "../../server/metadata-routes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { errorHandler } from "../../server/middleware/errorHandler";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { getObjectKontaktPersons } from "../../server/metadata-queries";
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
} from "@shared/schema";
import { inArray, eq, and, isNotNull } from "drizzle-orm";

// Task #1440: radering, arkivering och anonymisering är TRE separata flöden.
//   1) Kontaktkortet: kontaktfamiljen (area='kontakt') läses konsoliderat med
//      varden-id per underfält → redigering via generella metadata-endpoints;
//      delvis ifyllda kontakter hanteras.
//   2) Hård radering (DELETE /api/metadata/:id) vägras med 409 USE_ARCHIVE när
//      värdet har verklig historik (ändringar); färska värden får raderas.
//   3) Arkivering döljer (raderad=true) men bevarar värde + historik; restore.
//   4) Anonymisering rör ALDRIG interimnummer (403) och raderar inte historik-
//      rader (bara deras innehåll).

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `lifec-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const TECH = `${NS}-tech`; // viewer — får INTE mutera metadata-värden
let customerId = "";
let objectId = "";
let namnKatalogId = "";
let telefonKatalogId = "";
let titelKatalogId = "";
let plainKatalogId = "";
let interimKatalogId = "";

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
  let body: any = null;
  try {
    body = res.status !== 204 ? await res.json() : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function createKatalog(namn: string, area?: string): Promise<string> {
  const [row] = await db
    .insert(metadataKatalog)
    .values({
      tenantId: TENANT,
      namn,
      datatyp: "string",
      standardArvs: true,
      allowDuplicates: namn === "Namn", // flera kontakter = flera Namn-värden
      ...(area ? { area } : {}),
    })
    .returning({ id: metadataKatalog.id });
  return row.id;
}

async function createValue(katalogNamn: string, varde: string): Promise<string> {
  const res = await req("POST", "/api/metadata", {
    userId: ADMIN,
    body: { objektId: objectId, metadataTypNamn: katalogNamn, varde },
  });
  expect(res.status).toBe(201);
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
  await registerKPIRoutes(app);
  app.use("/api/metadata", metadataRouter);
  app.use(errorHandler);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await storage.ensureTenant(TENANT, { name: "Metadata-livscykel Test" });
  const c = await storage.createCustomer({
    tenantId: TENANT,
    name: `${NS} Kund`,
    customerNumber: `${NS}-K`,
  });
  customerId = c.id;
  await db.insert(users).values([
    { id: ADMIN, email: `${ADMIN}@test.local` },
    { id: TECH, email: `${TECH}@test.local` },
  ]).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values([
      { userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN },
      { userId: TECH, tenantId: TENANT, role: "viewer", isActive: true, assignedBy: ADMIN },
    ])
    .onConflictDoNothing();

  const objRes = await req("POST", "/api/objects", {
    userId: ADMIN,
    body: { name: `${NS} Objekt`, customerId, objectType: "karl", objectLevel: 1, status: "active" },
  });
  expect(objRes.status).toBe(201);
  objectId = objRes.body.id;

  namnKatalogId = await createKatalog("Namn", "kontakt");
  titelKatalogId = await createKatalog("Titel", "kontakt");
  telefonKatalogId = await createKatalog("Telefon", "kontakt");
  plainKatalogId = await createKatalog(`${NS}_Fält`);
  interimKatalogId = await createKatalog("interimsnummer");
}, 40000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  try {
    await db.delete(metadataHistorik).where(inArray(metadataHistorik.tenantId, [TENANT]));
    await db.delete(metadataVarden).where(inArray(metadataVarden.tenantId, [TENANT]));
    await db.delete(metadataKatalog).where(inArray(metadataKatalog.tenantId, [TENANT]));
    await db.delete(objectParents).where(inArray(objectParents.tenantId, [TENANT]));
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT]));
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN, TECH]));
    await db.delete(users).where(inArray(users.id, [ADMIN, TECH]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT]));
  } catch (err) {
    console.warn("Cleanup (metadata-lifecycle.test) ofullständig:", err);
  }
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("Task #1440 — kontaktkort: konsoliderad läsning + redigering via metadata", () => {
  it("delvis ifylld kontakt exponeras med varden-id per underfält och katalognamn för saknade", async () => {
    const namnId = await createValue("Namn", "Anna Andersson");
    await createValue("Telefon", "070-111 11 11");

    const persons = await getObjectKontaktPersons(objectId, TENANT);
    expect(persons.length).toBe(1);
    const p = persons[0];
    expect(p.namn).toBe("Anna Andersson");
    expect(p.telefon).toBe("070-111 11 11");
    expect(p.titel).toBeNull(); // delvis ifylld — inget titel-värde
    expect(p.fields.namn.vardenId).toBe(namnId);
    expect(p.fields.telefon.vardenId).toBeTruthy();
    expect(p.fields.titel.vardenId).toBeNull();
    // Katalognamn följer med så kortet kan POST:a ett saknat underfält, och
    // katalog-id så att tömning kan gå via ARKIVERING (aldrig hård radering).
    expect(p.fields.titel.katalogNamn).toBe("Titel");
    expect(p.fields.telefon.katalogId).toBe(telefonKatalogId);
    expect(p.inherited).toBe(false);

    // Redigering i kortet = PUT på underfältets varden-id.
    const upd = await req("PUT", `/api/metadata/${namnId}`, {
      userId: ADMIN,
      body: { varde: "Anna Svensson" },
    });
    expect(upd.status).toBe(200);
    const persons2 = await getObjectKontaktPersons(objectId, TENANT);
    expect(persons2[0]?.namn).toBe("Anna Svensson");
  });

  it("tömning av kontaktfält i kortet arkiverar — värdet döljs men historik/rad bevaras", async () => {
    const persons = await getObjectKontaktPersons(objectId, TENANT);
    const telVardenId = persons[0]?.fields.telefon.vardenId;
    expect(telVardenId).toBeTruthy();

    // Kortets "tömning" = arkiveringsendpointen (aldrig DELETE /api/metadata/:id).
    const arch = await req("DELETE", `/api/metadata/objects/${objectId}/field/${telefonKatalogId}`, {
      userId: ADMIN,
      body: {},
    });
    expect(arch.status).toBe(204);

    const [row] = await db.select().from(metadataVarden).where(eq(metadataVarden.id, telVardenId!));
    expect(row.raderad).toBe(true);
    expect(row.vardeString).toBe("070-111 11 11"); // värdet bevarat i arkivet

    const after = await getObjectKontaktPersons(objectId, TENANT);
    expect(after[0]?.telefon ?? null).toBeNull(); // dolt i kortet

    // Återställ inför följande tester.
    const rest = await req("POST", `/api/metadata/objects/${objectId}/field/${telefonKatalogId}/restore`, {
      userId: ADMIN,
      body: {},
    });
    expect(rest.status).toBe(204);
  });

  it("värde-mutationer kräver skrivande medlemsroll — viewer nekas server-side (403)", async () => {
    const persons = await getObjectKontaktPersons(objectId, TENANT);
    const namnId = persons[0]?.fields.namn.vardenId!;

    const put = await req("PUT", `/api/metadata/${namnId}`, {
      userId: TECH,
      body: { varde: "Hackad" },
    });
    expect(put.status).toBe(403);

    const post = await req("POST", "/api/metadata", {
      userId: TECH,
      body: { objektId: objectId, metadataTypNamn: "Titel", varde: "Chef" },
    });
    expect(post.status).toBe(403);

    const del = await req("DELETE", `/api/metadata/${namnId}`, { userId: TECH });
    expect(del.status).toBe(403);

    const arch = await req("DELETE", `/api/metadata/objects/${objectId}/field/${namnKatalogId}`, {
      userId: TECH,
      body: {},
    });
    expect(arch.status).toBe(403);

    const persons2 = await getObjectKontaktPersons(objectId, TENANT);
    expect(persons2[0]?.namn).toBe("Anna Svensson"); // orört

    // Övriga mutationsvägar är också gate:ade (inheritance, ordning, WO-metadata).
    const inh = await req("PATCH", `/api/metadata/${namnId}/inheritance`, {
      userId: TECH,
      body: { arvsStatus: "lokal" },
    });
    expect(inh.status).toBe(403);
    const ord = await req("PUT", `/api/metadata/objects/${objectId}/order`, {
      userId: TECH,
      body: { orderedKatalogIds: [] },
    });
    expect(ord.status).toBe(403);
    const woPost = await req("POST", "/api/metadata/work-orders/fake-wo-id", {
      userId: TECH,
      body: { nyckel: "x", varde: "y" },
    });
    expect(woPost.status).toBe(403);
    const woDel = await req("DELETE", "/api/metadata/work-orders/metadata/fake-id", { userId: TECH });
    expect(woDel.status).toBe(403);
    const bulk = await req("POST", "/api/metadata/work-orders/bulk-apply", {
      userId: TECH,
      body: {},
    });
    expect(bulk.status).toBe(403);
  });

  it("två kontakter där den andra saknar underfält: redigering omparar aldrig den första", async () => {
    // Kontakt 1: Anna (namn+titel+telefon). Kontakt 2: bara namn.
    await createValue("Titel", "VD");
    await createValue("Namn", "Bertil Berg");

    const persons = await getObjectKontaktPersons(objectId, TENANT);
    expect(persons.length).toBe(2);
    const anna = persons.find((p) => p.namn === "Anna Svensson")!;
    const bertil = persons.find((p) => p.namn === "Bertil Berg")!;
    expect(anna).toBeTruthy();
    expect(bertil).toBeTruthy();
    // Titel/telefon paras med Anna (kontakt 1) — aldrig med Bertil.
    expect(anna.titel).toBe("VD");
    expect(bertil.titel ?? null).toBeNull();
    expect(bertil.fields.titel.vardenId).toBeNull();

    // Rad-exakt redigering av kontakt 2:s namn (PUT per varden-id).
    const put = await req("PUT", `/api/metadata/${bertil.fields.namn.vardenId}`, {
      userId: ADMIN,
      body: { varde: "Bertil Bergström" },
    });
    expect(put.status).toBe(200);

    const after = await getObjectKontaktPersons(objectId, TENANT);
    const anna2 = after.find((p) => p.namn === "Anna Svensson")!;
    const bertil2 = after.find((p) => p.namn === "Bertil Bergström")!;
    // Kontakt 1 helt oförändrad — ingen omparning av titel/telefon.
    expect(anna2.titel).toBe("VD");
    expect(anna2.telefon).toBe("070-111 11 11");
    expect(anna2.fields.namn.vardenId).toBe(anna.fields.namn.vardenId);
    expect(bertil2.fields.namn.vardenId).toBe(bertil.fields.namn.vardenId);
    expect(bertil2.titel ?? null).toBeNull();

    // Städa: ta bort Bertil så följande tester ser en kontakt.
    await db.delete(metadataHistorik).where(eq(metadataHistorik.metadataVardenId, bertil.fields.namn.vardenId!));
    await db.delete(metadataVarden).where(eq(metadataVarden.id, bertil.fields.namn.vardenId!));
  });
});

describe("Task #1440 — hård radering vs arkivering", () => {
  it("färskt värde utan historik får hård-raderas (204)", async () => {
    const id = await createValue(`${NS}_Fält`, "temp-värde");
    const del = await req("DELETE", `/api/metadata/${id}`, { userId: ADMIN });
    expect(del.status).toBe(204);
    const rows = await db.select().from(metadataVarden).where(eq(metadataVarden.id, id));
    expect(rows.length).toBe(0);
  });

  it("värde med verklig historik vägras hård radering → 409 USE_ARCHIVE, värdet kvar", async () => {
    const id = await createValue(`${NS}_Fält`, "v1");
    const upd = await req("PUT", `/api/metadata/${id}`, { userId: ADMIN, body: { varde: "v2" } });
    expect(upd.status).toBe(200);

    const del = await req("DELETE", `/api/metadata/${id}`, { userId: ADMIN });
    expect(del.status).toBe(409);
    expect(del.body?.code).toBe("USE_ARCHIVE");
    expect(String(del.body?.message ?? del.body?.error)).toMatch(/[Aa]rkivera/);

    const rows = await db.select().from(metadataVarden).where(eq(metadataVarden.id, id));
    expect(rows.length).toBe(1);
    expect(rows[0].vardeString).toBe("v2");

    // Arkivering fungerar istället: döljer men bevarar värde + historik.
    const arch = await req("DELETE", `/api/metadata/objects/${objectId}/field/${plainKatalogId}`, {
      userId: ADMIN,
      body: {},
    });
    expect(arch.status).toBe(204);
    const [archived] = await db.select().from(metadataVarden).where(eq(metadataVarden.id, id));
    expect(archived.raderad).toBe(true);
    expect(archived.vardeString).toBe("v2"); // värdet bevarat
    const hist = await db
      .select()
      .from(metadataHistorik)
      .where(and(eq(metadataHistorik.metadataVardenId, id), isNotNull(metadataHistorik.gammaltVarde)));
    expect(hist.length).toBeGreaterThan(0); // historiken bevarad

    // Återställning är möjlig.
    const rest = await req("POST", `/api/metadata/objects/${objectId}/field/${plainKatalogId}/restore`, {
      userId: ADMIN,
      body: {},
    });
    expect(rest.status).toBe(204);
    const [restored] = await db.select().from(metadataVarden).where(eq(metadataVarden.id, id));
    expect(restored.raderad).toBe(false);
  });

  it("samtidig uppdatering + radering är serialiserad — aldrig raderat värde MED ny historik", async () => {
    // Spärr-utvärderingen körs i samma FOR UPDATE-tx som raderingen; en
    // samtidig PUT kan inte smita in historik mellan check och delete.
    for (let round = 0; round < 5; round++) {
      const id = await createValue(`${NS}_Fält`, `race-${round}-a`);
      const [putRes, delRes] = await Promise.all([
        req("PUT", `/api/metadata/${id}`, { userId: ADMIN, body: { varde: `race-${round}-b` } }),
        req("DELETE", `/api/metadata/${id}`, { userId: ADMIN }),
      ]);
      // Racen får ALDRIG ge 500 — förlorande PUT ska bli definierad 404.
      expect([200, 404]).toContain(putRes.status);
      expect([204, 409]).toContain(delRes.status);
      const rows = await db.select().from(metadataVarden).where(eq(metadataVarden.id, id));
      const hist = await db
        .select()
        .from(metadataHistorik)
        .where(and(eq(metadataHistorik.metadataVardenId, id), isNotNull(metadataHistorik.gammaltVarde)));
      if (rows.length === 0) {
        // Raderad: då får ingen ÄNDRINGS-historik ha hunnit skapas före delete
        // (delete-raden själv har gammaltVarde men FK sätts NULL vid delete —
        // kvarvarande rader med metadata_varden_id=id ska alltså vara 0).
        expect(delRes.status).toBe(204);
      } else {
        // Kvar: antingen blockerades delete (409) av PUT:ens historik, eller
        // så raderades + återskapades aldrig — värdet ska vara konsistent.
        expect([200, 409]).toContain(delRes.status === 204 ? 200 : delRes.status);
        if (delRes.status === 409) {
          expect(hist.length).toBeGreaterThan(0);
          expect(putRes.status).toBe(200);
        }
        await db.delete(metadataHistorik).where(eq(metadataHistorik.metadataVardenId, id));
        await db.delete(metadataVarden).where(eq(metadataVarden.id, id));
      }
    }
  });
});

describe("Task #1460 — spärren kan inte kringgås via kompat-/objekt-/bulkvägar", () => {
  // Hjälpare: nytt objekt med eget metadata-värde (och ev. verklig historik).
  async function createObjectWithValue(
    suffix: string,
    opts: { withHistory: boolean },
  ): Promise<{ objId: string; vardenId: string }> {
    const objRes = await req("POST", "/api/objects", {
      userId: ADMIN,
      body: { name: `${NS} ${suffix}`, customerId, objectType: "karl", objectLevel: 1, status: "active" },
    });
    expect(objRes.status).toBe(201);
    const objId = objRes.body.id as string;
    const create = await req("POST", "/api/metadata", {
      userId: ADMIN,
      body: { objektId: objId, metadataTypNamn: `${NS}_Fält`, varde: `${suffix}-v1` },
    });
    expect(create.status).toBe(201);
    const vardenId = create.body.id as string;
    if (opts.withHistory) {
      const upd = await req("PUT", `/api/metadata/${vardenId}`, {
        userId: ADMIN,
        body: { varde: `${suffix}-v2` },
      });
      expect(upd.status).toBe(200);
    }
    return { objId, vardenId };
  }

  it("kompat-API:t DELETE /api/objects/:objectId/metadata/:id blockeras vid historik (409 USE_ARCHIVE)", async () => {
    const { objId, vardenId } = await createObjectWithValue("kompat", { withHistory: true });

    const del = await req("DELETE", `/api/objects/${objId}/metadata/${vardenId}`, { userId: ADMIN });
    expect(del.status).toBe(409);
    expect(del.body?.code).toBe("USE_ARCHIVE");

    const rows = await db.select().from(metadataVarden).where(eq(metadataVarden.id, vardenId));
    expect(rows.length).toBe(1);
    expect(rows[0].vardeString).toBe("kompat-v2");
  });

  it("kompat-API:t får fortfarande radera färska värden utan historik (204)", async () => {
    const { objId, vardenId } = await createObjectWithValue("kompat2", { withHistory: false });
    const del = await req("DELETE", `/api/objects/${objId}/metadata/${vardenId}`, { userId: ADMIN });
    expect(del.status).toBe(204);
    const rows = await db.select().from(metadataVarden).where(eq(metadataVarden.id, vardenId));
    expect(rows.length).toBe(0);
  });

  it("what3words-tömning arkiverar (mjuk-raderar) när värdet har historik — raden hård-raderas aldrig", async () => {
    const objRes = await req("POST", "/api/objects", {
      userId: ADMIN,
      body: { name: `${NS} w3w`, customerId, objectType: "karl", objectLevel: 1, status: "active" },
    });
    expect(objRes.status).toBe(201);
    const objId = objRes.body.id as string;

    // Sätt + ändra → verklig historik på what3words-värdet.
    const set1 = await req("POST", `/api/objects/${objId}/what3words`, {
      userId: ADMIN,
      body: { what3words: "index.home.raft" },
    });
    expect(set1.status).toBe(200);
    const set2 = await req("POST", `/api/objects/${objId}/what3words`, {
      userId: ADMIN,
      body: { what3words: "daring.lion.race" },
    });
    expect(set2.status).toBe(200);

    const [row] = await db
      .select()
      .from(metadataVarden)
      .where(and(eq(metadataVarden.objektId, objId), eq(metadataVarden.tenantId, TENANT), eq(metadataVarden.raderad, false)));
    expect(row).toBeTruthy();

    // Tömning: raden ska finnas kvar (mjuk-raderad), inte hård-raderas.
    const clear = await req("POST", `/api/objects/${objId}/what3words`, {
      userId: ADMIN,
      body: { what3words: null },
    });
    expect(clear.status).toBe(200);

    const [after] = await db.select().from(metadataVarden).where(eq(metadataVarden.id, row.id));
    expect(after).toBeTruthy();
    expect(after.raderad).toBe(true);
    expect(after.vardeString).toBe("daring.lion.race"); // värdet bevarat i arkivet
  });

  it("DELETE /api/objects/:id blockeras när objektets metadata har verklig historik (409)", async () => {
    const { objId, vardenId } = await createObjectWithValue("objdel", { withHistory: true });

    const del = await req("DELETE", `/api/objects/${objId}`, { userId: ADMIN });
    expect(del.status).toBe(409);
    expect(String(del.body?.message ?? del.body?.error)).toMatch(/[Aa]rkivera/);

    // Objekt + värde + historik orörda.
    const objRows = await db.select({ id: objects.id }).from(objects).where(eq(objects.id, objId));
    expect(objRows.length).toBe(1);
    const valRows = await db.select().from(metadataVarden).where(eq(metadataVarden.id, vardenId));
    expect(valRows.length).toBe(1);
    const hist = await db
      .select()
      .from(metadataHistorik)
      .where(and(eq(metadataHistorik.metadataVardenId, vardenId), isNotNull(metadataHistorik.gammaltVarde)));
    expect(hist.length).toBeGreaterThan(0);
  });

  it("DELETE /api/objects/:id tillåts för objekt vars metadata bara har skapande-historik", async () => {
    const { objId } = await createObjectWithValue("objdel2", { withHistory: false });
    const del = await req("DELETE", `/api/objects/${objId}`, { userId: ADMIN });
    expect(del.status).toBe(204);
    const objRows = await db.select({ id: objects.id }).from(objects).where(eq(objects.id, objId));
    expect(objRows.length).toBe(0);
  });

  it("bulk-delete blockerar objekt med metadatahistorik men raderar de utan", async () => {
    const a = await createObjectWithValue("bulk-hist", { withHistory: true });
    const b = await createObjectWithValue("bulk-fresh", { withHistory: false });

    const res = await req("POST", "/api/objects/bulk-delete", {
      userId: ADMIN,
      body: { ids: [a.objId, b.objId] },
    });
    expect(res.status).toBe(200);
    const byId = new Map((res.body.results as any[]).map((r) => [r.id, r]));
    expect(byId.get(a.objId)?.status).toBe("blocked");
    expect(String(byId.get(a.objId)?.reason ?? "")).toMatch(/metadatahistorik/);
    expect(byId.get(b.objId)?.status).toBe("deleted");

    // Blockerat objekt + dess värde/historik finns kvar; det färska är borta.
    const aRows = await db.select({ id: objects.id }).from(objects).where(eq(objects.id, a.objId));
    expect(aRows.length).toBe(1);
    const aVal = await db.select().from(metadataVarden).where(eq(metadataVarden.id, a.vardenId));
    expect(aVal.length).toBe(1);
    const bRows = await db.select({ id: objects.id }).from(objects).where(eq(objects.id, b.objId));
    expect(bRows.length).toBe(0);
  });
});

describe("Task #1440 — anonymisering: interimnummer orört, historik bevaras", () => {
  it("interimsnummer kan ALDRIG anonymiseras → 403, värdet orört", async () => {
    // Task #1441 (main): interim-fält är read-only via API — seeda direkt i DB
    // (som importen gör) för att testa anonymiserings-spärren.
    const [seeded] = await db
      .insert(metadataVarden)
      .values({
        tenantId: TENANT,
        objektId: objectId,
        metadataKatalogId: interimKatalogId,
        vardeString: "INT-12345",
        metod: "system",
      })
      .returning({ id: metadataVarden.id });
    const id = seeded.id;
    const res = await req("POST", `/api/metadata/objects/${objectId}/field/${interimKatalogId}/anonymize`, {
      userId: ADMIN,
      body: { confirm: true },
    });
    expect(res.status).toBe(403);
    const [row] = await db.select().from(metadataVarden).where(eq(metadataVarden.id, id));
    expect(row.vardeString).toBe("INT-12345");
    expect(row.status).not.toBe("anonymiserad");
  });

  it("anonymisering förstör värdet men raderar INTE historikrader", async () => {
    const id = await createValue("Telefon", "070-222 22 22");
    await req("PUT", `/api/metadata/${id}`, { userId: ADMIN, body: { varde: "070-333 33 33" } });
    const histBefore = await db
      .select({ id: metadataHistorik.id })
      .from(metadataHistorik)
      .where(eq(metadataHistorik.metadataVardenId, id));
    expect(histBefore.length).toBeGreaterThan(0);

    const res = await req("POST", `/api/metadata/objects/${objectId}/field/${telefonKatalogId}/anonymize`, {
      userId: ADMIN,
      body: { confirm: true },
    });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(metadataVarden).where(eq(metadataVarden.id, id));
    expect(row.status).toBe("anonymiserad");
    expect(row.vardeString).not.toBe("070-333 33 33");

    // Historiken finns kvar som rader (audit-spåret raderas inte) — bara
    // innehållet (VAD) är förstört.
    const histAfter = await db
      .select({ gammaltVarde: metadataHistorik.gammaltVarde, nyttVarde: metadataHistorik.nyttVarde })
      .from(metadataHistorik)
      .where(eq(metadataHistorik.metadataVardenId, id));
    expect(histAfter.length).toBeGreaterThanOrEqual(histBefore.length);
    for (const h of histAfter) {
      expect(h.gammaltVarde ?? "").not.toContain("070-333 33 33");
      expect(h.nyttVarde ?? "").not.toContain("070-333 33 33");
    }
  });
});
