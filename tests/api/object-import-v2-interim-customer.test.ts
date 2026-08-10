import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerObjectImportV2Routes } from "../../server/routes/objectImportV2Routes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { metadataRouter } from "../../server/metadata-routes";
import { registerKPIRoutes } from "../../server/routes/kpiRoutes";
import { db } from "../../server/db";
import {
  tenants,
  users,
  userTenantRoles,
  customers,
  objects,
  objectParents,
  objectImportSessions,
  objectImportRows,
  metadataKatalog,
  metadataVarden,
  metadataHistorik,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { OBJEKTMALL_INTERIM_METADATA_FALT, OBJEKTMALL_INTERIM_PREFIX } from "@shared/objektmall-template";
import {
  getAllMetadataTypesWithCustomers,
  getMetadataDefinitionsCompat,
  getObjectWithAllMetadata,
  getMetadataDefinitionCompat,
  createMetadata,
  anonymizeObjectMetadataField,
} from "../../server/metadata-queries";

// Task #1433: återanvända interimnummer får ALDRIG krocka mellan listor.
//  1. Nya interim-objekt får systemmyntat OBJ-NNN (inte MALL-<interim>) och
//     interimsnumret lagras separat som metadata ('interimsnummer').
//  2. Samma interimnummer importerat till TVÅ OLIKA kunder ⇒ TVÅ objekt.
//  3. Re-import till SAMMA kund ⇒ update (ingen dubblett).
//  4. Bakåtkompat: befintliga MALL-objekt matchas fortsatt.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `oiv2ic-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const CUST_A = `${NS}-cust-a`;
const CUST_B = `${NS}-cust-b`;

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const MAPPINGS = {
  "0": { target: "name", type: "standard" as const, required: true },
  "1": { target: "interim_id", type: "standard" as const },
};

// Kör hela flödet upload→mappings→execute (med angiven kund) och pollar klart.
async function runImport(matrix: string[][], customerId: string): Promise<any> {
  const up = await req("POST", "/api/import/objects-v2/upload", {
    userId: ADMIN,
    body: { matrix, fileName: "interim.xlsx" },
  });
  expect(up.status).toBe(200);
  const sessionId = up.body.session_id as string;

  const mp = await req("PUT", `/api/import/objects-v2/${sessionId}/mappings`, {
    userId: ADMIN,
    body: { mappings: MAPPINGS },
  });
  expect(mp.status).toBe(200);

  // Task #1478: execute kräver aktuell validering (serverauktoritativ gate).
  const val = await req("POST", `/api/import/objects-v2/${sessionId}/validate`, { userId: ADMIN });
  expect(val.status).toBe(200);

  const exec = await req("POST", `/api/import/objects-v2/${sessionId}/execute`, {
    userId: ADMIN,
    body: { customerId },
  });
  expect(exec.status).toBe(202);

  for (let i = 0; i < 50; i++) {
    const st = await req("GET", `/api/import/objects-v2/${sessionId}/status`, { userId: ADMIN });
    if (st.body.status === "completed" || st.body.status === "failed") break;
    await sleep(150);
  }
  const result = await req("GET", `/api/import/objects-v2/${sessionId}/result`, { userId: ADMIN });
  expect(result.status).toBe(200);
  expect(result.body?.status).toBe("completed");
  return result.body;
}

beforeAll(async () => {
  originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((reqIn: any, _res, next) => {
    const uid = reqIn.headers["x-test-user-id"];
    if (uid) reqIn.user = { claims: { sub: String(uid) } };
    next();
  });
  app.use(requireTenantWithFallback);
  registerObjectImportV2Routes(app);
  // Task #1441: publika metadata-endpoints — spoof-skydds-regression.
  app.use("/api/metadata", metadataRouter);
  // Task #1441: etikett-/katalogytor (/api/metadata-labels) — dolt-fält-regression.
  await registerKPIRoutes(app);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(tenants).values({ id: TENANT, name: "OIV2 Interim Test", subdomain: TENANT }).onConflictDoNothing();
  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();
  await db
    .insert(customers)
    .values([
      { id: CUST_A, tenantId: TENANT, name: "Kund A", customerNumber: "KA-1" },
      { id: CUST_B, tenantId: TENANT, name: "Kund B", customerNumber: "KB-1" },
    ])
    .onConflictDoNothing();
  // 'Kund'-katalogposten (Ekonomi-metadata) måste finnas för att importens
  // ensurePrimaryPayer ska kunna koppla objekt → kund — utan den blir alla
  // objekt kund-lösa och kundskopningen kan inte testas på riktigt.
  await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: "Kund", datatyp: "referens", referensTabell: "customers", kategori: "ekonomi" })
    .onConflictDoNothing();
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await db.delete(metadataHistorik).where(eq(metadataHistorik.tenantId, TENANT));
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(objectImportRows).where(eq(objectImportRows.tenantId, TENANT));
  await db.delete(objectImportSessions).where(eq(objectImportSessions.tenantId, TENANT));
  await db.delete(objectParents).where(eq(objectParents.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(userTenantRoles).where(eq(userTenantRoles.tenantId, TENANT));
  await db.delete(users).where(eq(users.id, ADMIN));
  await db.execute(sql`DELETE FROM import_actions WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM import_batches WHERE tenant_id = ${TENANT}`);
  await db.delete(tenants).where(eq(tenants.id, TENANT));
}, 30000);

async function objectsNamed(name: string) {
  return db
    .select()
    .from(objects)
    .where(and(eq(objects.tenantId, TENANT), eq(objects.name, name)));
}

describe("Import 2.0 — interimsnummer är kundskopad matchningsnyckel (Task #1433)", () => {
  it("nytt interim-objekt myntas som OBJ-NNN och interimsnumret sparas som metadata", async () => {
    const result = await runImport(
      [
        ["Objektnamn", "Interimsnummer"],
        ["Butik Alfa", "BUT3"],
      ],
      CUST_A,
    );
    expect(result.summary.created).toBe(1);
    expect(result.summary.updated).toBe(0);

    const rows = await objectsNamed("Butik Alfa");
    expect(rows).toHaveLength(1);
    expect(rows[0].objectNumber).toMatch(/^OBJ-\d+$/); // systemmyntat, inte MALL-BUT3

    // Interimsnumret lagras separat som metadata ('interimsnummer').
    const [kat] = await db
      .select({ id: metadataKatalog.id })
      .from(metadataKatalog)
      .where(and(eq(metadataKatalog.tenantId, TENANT), eq(metadataKatalog.namn, OBJEKTMALL_INTERIM_METADATA_FALT)));
    expect(kat).toBeTruthy();
    const meta = await db
      .select({ varde: metadataVarden.vardeString })
      .from(metadataVarden)
      .where(
        and(
          eq(metadataVarden.tenantId, TENANT),
          eq(metadataVarden.objektId, rows[0].id),
          eq(metadataVarden.metadataKatalogId, kat.id),
          eq(metadataVarden.status, "aktiv"),
        ),
      );
    expect(meta.map((m) => m.varde)).toEqual(["BUT3"]);
  });

  it("samma interimnummer till en ANNAN kund skapar ett SEPARAT objekt", async () => {
    const result = await runImport(
      [
        ["Objektnamn", "Interimsnummer"],
        ["Butik Beta", "BUT3"],
      ],
      CUST_B,
    );
    // Kund B:s BUT3 får ALDRIG matcha/uppdatera Kund A:s objekt.
    expect(result.summary.created).toBe(1);
    expect(result.summary.updated).toBe(0);

    // Kund A:s objekt är orört; två separata objekt finns nu.
    expect(await objectsNamed("Butik Alfa")).toHaveLength(1);
    expect(await objectsNamed("Butik Beta")).toHaveLength(1);
  });

  it("re-import av samma interimnummer till SAMMA kund uppdaterar (ingen dubblett)", async () => {
    const result = await runImport(
      [
        ["Objektnamn", "Interimsnummer"],
        ["Butik Alfa uppdaterad", "BUT3"],
      ],
      CUST_A,
    );
    expect(result.summary.created).toBe(0);
    expect(result.summary.updated).toBe(1);

    // Kund A:s objekt uppdaterades; Kund B:s är orört. Fortfarande exakt 2 objekt.
    expect(await objectsNamed("Butik Alfa uppdaterad")).toHaveLength(1);
    expect(await objectsNamed("Butik Beta")).toHaveLength(1);
    expect(await objectsNamed("Butik Alfa")).toHaveLength(0);
  });

  it("samma interimnummer till TVÅ kunder i SAMMA fil ger två objekt — och re-import uppdaterar båda oberoende", async () => {
    const MAPPINGS_WITH_CUST = {
      "0": { target: "name", type: "standard" as const, required: true },
      "1": { target: "interim_id", type: "standard" as const },
      "2": { target: "customer_name", type: "standard" as const },
    };
    const runWithCust = async (matrix: string[][]) => {
      const up = await req("POST", "/api/import/objects-v2/upload", {
        userId: ADMIN,
        body: { matrix, fileName: "interim-tvakund.xlsx" },
      });
      const sessionId = up.body.session_id as string;
      await req("PUT", `/api/import/objects-v2/${sessionId}/mappings`, {
        userId: ADMIN,
        body: { mappings: MAPPINGS_WITH_CUST },
      });
      // Task #1478: execute kräver aktuell validering.
      await req("POST", `/api/import/objects-v2/${sessionId}/validate`, { userId: ADMIN });
      const exec = await req("POST", `/api/import/objects-v2/${sessionId}/execute`, {
        userId: ADMIN,
        body: { customerId: CUST_A },
      });
      expect(exec.status).toBe(202);
      for (let i = 0; i < 50; i++) {
        const st = await req("GET", `/api/import/objects-v2/${sessionId}/status`, { userId: ADMIN });
        if (st.body.status === "completed" || st.body.status === "failed") break;
        await sleep(150);
      }
      const result = await req("GET", `/api/import/objects-v2/${sessionId}/result`, { userId: ADMIN });
      expect(result.body?.status).toBe("completed");
      return result.body;
    };

    // Två primärrader delar interimnummer men pekar på OLIKA kunder.
    const first = await runWithCust([
      ["Objektnamn", "Interimsnummer", "Kund"],
      ["Depå A", "DEP7", "Kund A"],
      ["Depå B", "DEP7", "Kund B"],
    ]);
    expect(first.summary.created).toBe(2); // ALDRIG primär+utrustning
    expect(first.summary.updated).toBe(0);
    expect(await objectsNamed("Depå A")).toHaveLength(1);
    expect(await objectsNamed("Depå B")).toHaveLength(1);
    const depaA = (await objectsNamed("Depå A"))[0];
    const depaB = (await objectsNamed("Depå B"))[0];
    expect(depaA.parentId).toBeNull(); // inte barn under varandra
    expect(depaB.parentId).toBeNull();

    // Re-import av samma fil ⇒ två OBEROENDE uppdateringar (inga dubbletter).
    const second = await runWithCust([
      ["Objektnamn", "Interimsnummer", "Kund"],
      ["Depå A v2", "DEP7", "Kund A"],
      ["Depå B v2", "DEP7", "Kund B"],
    ]);
    expect(second.summary.created).toBe(0);
    expect(second.summary.updated).toBe(2);
    const a2 = await objectsNamed("Depå A v2");
    const b2 = await objectsNamed("Depå B v2");
    expect(a2).toHaveLength(1);
    expect(b2).toHaveLength(1);
    expect(a2[0].id).toBe(depaA.id); // rätt objekt uppdaterades
    expect(b2[0].id).toBe(depaB.id);
  });

  it("bakåtkompat: befintligt MALL-objekt matchas fortsatt via objectNumber", async () => {
    // Simulera ett objekt skapat FÖRE Task #1433 (MALL-<interim>, ingen metadata).
    await db.insert(objects).values({
      tenantId: TENANT,
      name: "Legacy-butik",
      objectNumber: OBJEKTMALL_INTERIM_PREFIX + "LEG1",
    });

    const result = await runImport(
      [
        ["Objektnamn", "Interimsnummer"],
        ["Legacy-butik uppdaterad", "LEG1"],
      ],
      CUST_A,
    );
    expect(result.summary.created).toBe(0);
    expect(result.summary.updated).toBe(1);
    expect(await objectsNamed("Legacy-butik uppdaterad")).toHaveLength(1);
    expect(await objectsNamed("Legacy-butik")).toHaveLength(0);
  });

  // Task #1441: interimnummer är ett TEMPORÄRT importfält — klassat som system-
  // fält, dolt från vanliga metadatavyer, skyddat mot manuell redigering och
  // GDPR-anonymisering. Matchningsförmågan (testerna ovan) är opåverkad.
  it("Task #1441: interim-fältet klassas som systemfält och döljs/skyddas", async () => {
    const [kat] = await db
      .select()
      .from(metadataKatalog)
      .where(and(eq(metadataKatalog.tenantId, TENANT), eq(metadataKatalog.namn, OBJEKTMALL_INTERIM_METADATA_FALT)));
    expect(kat).toBeTruthy();
    // Lat-skapad av importen med systemklassning (Task #1441).
    expect(kat.isSystem).toBe(true);
    expect(kat.systemlast).toBe(true);
    expect(kat.visasIKarusell).toBe(false);

    // Dolt från katalog-/fältlistor (UI-/API-läsvägarna).
    const types = await getAllMetadataTypesWithCustomers(TENANT);
    expect(types.some((t) => t.namn === OBJEKTMALL_INTERIM_METADATA_FALT)).toBe(false);
    const defs = await getMetadataDefinitionsCompat(TENANT);
    expect(defs.some((d) => d.fieldKey === OBJEKTMALL_INTERIM_METADATA_FALT)).toBe(false);

    // Dolt bland objektets metadatarader — men värdet finns kvar i
    // metadata_varden (re-import-nyckeln, verifierat i testet ovan).
    const obj = (await objectsNamed("Butik Alfa uppdaterad"))[0];
    expect(obj).toBeTruthy();
    const full = await getObjectWithAllMetadata(obj.id, TENANT);
    expect(full?.metadata.some((m) => m.katalog?.namn === OBJEKTMALL_INTERIM_METADATA_FALT)).toBe(false);

    // Manuell skrivning blockeras (import-vägen med auto-ursprung släpps igenom).
    await expect(
      createMetadata({
        tenantId: TENANT,
        objektId: obj.id,
        metadataTypNamn: OBJEKTMALL_INTERIM_METADATA_FALT,
        varde: "HACK-1",
      }),
    ).rejects.toThrow(/systemfält|importfält/);

    // GDPR-anonymisering rör aldrig interimnumret.
    await expect(
      anonymizeObjectMetadataField(obj.id, kat.id, TENANT, ADMIN),
    ).rejects.toThrow(/anonymisering/);

    // Värdet är fortfarande intakt efter de blockerade försöken.
    const meta = await db
      .select({ varde: metadataVarden.vardeString })
      .from(metadataVarden)
      .where(
        and(
          eq(metadataVarden.tenantId, TENANT),
          eq(metadataVarden.objektId, obj.id),
          eq(metadataVarden.metadataKatalogId, kat.id),
          eq(metadataVarden.status, "aktiv"),
        ),
      );
    expect(meta.map((m) => m.varde)).toEqual(["BUT3"]);
  });

  // Task #1441 (review): auto-ursprung (metod) får ALDRIG etableras från
  // klient-payload — spoofad metod="import" ska avvisas av API:t, och
  // interim-raden ska inte kunna raderas via generiska DELETE-vägen.
  it("Task #1441: spoofad metod via publika metadata-API:t avvisas (create/update/delete)", async () => {
    const obj = (await objectsNamed("Butik Alfa uppdaterad"))[0];
    const [kat] = await db
      .select({ id: metadataKatalog.id })
      .from(metadataKatalog)
      .where(and(eq(metadataKatalog.tenantId, TENANT), eq(metadataKatalog.namn, OBJEKTMALL_INTERIM_METADATA_FALT)));
    const [row] = await db
      .select({ id: metadataVarden.id })
      .from(metadataVarden)
      .where(
        and(
          eq(metadataVarden.tenantId, TENANT),
          eq(metadataVarden.objektId, obj.id),
          eq(metadataVarden.metadataKatalogId, kat.id),
          eq(metadataVarden.status, "aktiv"),
        ),
      );
    expect(row).toBeTruthy();

    // CREATE med spoofad auto-metod → 403 (avvisas i routen, når aldrig guards).
    const created = await req("POST", "/api/metadata", {
      userId: ADMIN,
      body: {
        objektId: obj.id,
        metadataTypNamn: OBJEKTMALL_INTERIM_METADATA_FALT,
        varde: "SPOOF-1",
        metod: "import",
      },
    });
    expect(created.status).toBe(403);

    // UPDATE med spoofad auto-metod → 403.
    const updated = await req("PUT", `/api/metadata/${row.id}`, {
      userId: ADMIN,
      body: { varde: "SPOOF-2", metod: "import" },
    });
    expect(updated.status).toBe(403);

    // Manuell UPDATE (utan metod) → blockeras av systemfälts-guarden.
    const manual = await req("PUT", `/api/metadata/${row.id}`, {
      userId: ADMIN,
      body: { varde: "SPOOF-3" },
    });
    expect(manual.status).toBeGreaterThanOrEqual(400);

    // DELETE via generiska vägen → 403 (interim = re-import-nyckel).
    const deleted = await req("DELETE", `/api/metadata/${row.id}`, { userId: ADMIN });
    expect(deleted.status).toBe(403);

    // Detalj-uppslaget i compat-API:t exponerar inte interim-definitionen.
    expect(await getMetadataDefinitionCompat(TENANT, kat.id)).toBeUndefined();

    // Etikett-/katalogytorna (fältväljare/konfiguration) exponerar inte fältet.
    const labels = await req("GET", "/api/metadata-labels", { userId: ADMIN });
    expect(labels.status).toBe(200);
    expect(
      (labels.body as any[]).some((l) => l.namn?.toLowerCase() === OBJEKTMALL_INTERIM_METADATA_FALT),
    ).toBe(false);
    const labelDetail = await req("GET", `/api/metadata-labels/${kat.id}`, { userId: ADMIN });
    expect(labelDetail.status).toBe(404);
    const defDetail = await req("GET", `/api/metadata-definitions/${kat.id}`, { userId: ADMIN });
    expect(defDetail.status).toBe(404);

    // Värdet är orört efter alla försök.
    const meta = await db
      .select({ varde: metadataVarden.vardeString, raderad: metadataVarden.raderad })
      .from(metadataVarden)
      .where(and(eq(metadataVarden.tenantId, TENANT), eq(metadataVarden.id, row.id)));
    expect(meta).toHaveLength(1);
    expect(meta[0].varde).toBe("BUT3");
    expect(meta[0].raderad).toBe(false);
  });
});
