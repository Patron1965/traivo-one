import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerObjectImportV2Routes } from "../../server/routes/objectImportV2Routes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
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
import { and, eq, inArray, sql } from "drizzle-orm";
import { getObjectPrimaryCustomerId, ensurePrimaryPayer } from "../../server/services/object-customer";
import { findCandidates } from "../../scripts/cleanup-import-auto-customer";

// Task #1437: INGEN automatisk kundkoppling vid objektimport.
//  1. Import UTAN kund (varken body.customerId eller kund-kolumn) ⇒ objekten
//     skapas helt utan Kund-metadata (ingen "första aktiva kund"-fallback).
//  2. Kund-koppling förblir OPT-IN: uttryckligt vald kund (body.customerId)
//     skriver Kund-metadata, och den härledda kunden (samma väg som order-
//     konceptens FROM_METADATA/kundhärledning läser) resolverar korrekt.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `oiv2nc-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const CUSTOMER_ID = `${NS}-customer`;

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

async function runImport(matrix: string[][], executeBody: Record<string, unknown>): Promise<any> {
  const up = await req("POST", "/api/import/objects-v2/upload", {
    userId: ADMIN,
    body: { matrix, fileName: "no-customer.xlsx" },
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
    body: executeBody,
  });
  expect(exec.status).toBe(202);

  for (let i = 0; i < 50; i++) {
    const st = await req("GET", `/api/import/objects-v2/${sessionId}/status`, { userId: ADMIN });
    if (st.body.status === "completed" || st.body.status === "failed") break;
    await sleep(150);
  }
  const result = await req("GET", `/api/import/objects-v2/${sessionId}/result`, { userId: ADMIN });
  expect(result.status).toBe(200);
  return result.body;
}

// Alla Kund-metadatarader för ett objekt (via katalognamnet 'kund').
async function kundRowsFor(objectId: string) {
  const res = await db.execute(sql`
    SELECT mv.id, mv.varde_referens
    FROM metadata_varden mv
    JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
      AND lower(mk.namn) = 'kund' AND mk.deleted_at IS NULL
    WHERE mv.objekt_id = ${objectId} AND mv.tenant_id = ${TENANT}
      AND COALESCE(mv.raderad, FALSE) = FALSE
  `);
  return ((res as any).rows ?? []) as Array<{ id: string; varde_referens: string | null }>;
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

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(tenants).values({ id: TENANT, name: "OIV2 NoCust", subdomain: TENANT }).onConflictDoNothing();
  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();
  await db
    .insert(customers)
    .values({ id: CUSTOMER_ID, tenantId: TENANT, name: "Explicit AB", customerNumber: "K-9" })
    .onConflictDoNothing();
  // 'Kund'-katalogposten (skapas normalt av ensureSystemomradenFalt).
  await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: "Kund", datatyp: "referens", kategori: "ekonomi" } as any)
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
  if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("Task #1437 — ingen automatisk kundkoppling vid import", () => {
  it("import utan kund skapar objekt HELT utan Kund-metadata", async () => {
    const result = await runImport(
      [
        ["Objektnamn", "Interimsnummer"],
        ["Kundlös Fastighet", "NC-1"],
        ["Kundlöst Kärl 1", "NC-2"],
      ],
      {}, // ingen customerId — förr föll detta tillbaka på "första aktiva kund"
    );
    expect(result.summary.created).toBe(2);
    expect(result.summary.errors).toBe(0);
    expect(result.customer_id).toBeNull();
    expect(result.customers_linked).toBe(0);

    const rows = await db
      .select()
      .from(objects)
      .where(and(eq(objects.tenantId, TENANT), inArray(objects.name, ["Kundlös Fastighet", "Kundlöst Kärl 1"])));
    expect(rows.length).toBe(2);
    for (const o of rows) {
      expect(await kundRowsFor(o.id)).toHaveLength(0);
      // Härledd kund (samma väg som orderkoncept/UI läser) = null.
      expect(await getObjectPrimaryCustomerId(o.id)).toBeNull();
    }
  });

  it("uttryckligen vald kund skriver Kund-metadata som härleds korrekt (opt-in kvar)", async () => {
    const result = await runImport(
      [
        ["Objektnamn", "Interimsnummer"],
        ["Explicit Fastighet", "NC-10"],
      ],
      { customerId: CUSTOMER_ID },
    );
    expect(result.summary.created).toBe(1);
    expect(result.summary.errors).toBe(0);

    const [obj] = await db
      .select()
      .from(objects)
      .where(and(eq(objects.tenantId, TENANT), eq(objects.name, "Explicit Fastighet")));
    expect(obj).toBeTruthy();
    const kund = await kundRowsFor(obj.id);
    expect(kund).toHaveLength(1);
    expect(kund[0].varde_referens).toBe(CUSTOMER_ID);
    // Metadata-härledningen (den väg orderkonceptens kund-härledning läser).
    expect(await getObjectPrimaryCustomerId(obj.id)).toBe(CUSTOMER_ID);

    // Task #1437 proveniens: uttryckligt vald kund stämplas 'import-explicit'
    // (skapad_av) så att städskriptet ALDRIG klassar den som legacy-fallback.
    // Task #1467: metod='import' så kunden visas som "Importerad" (inte
    // "Systemgenererad") i Ekonomi-sektionen.
    const res = await db.execute(sql`
      SELECT skapad_av, metod FROM metadata_varden WHERE id = ${kund[0].id}
    `);
    expect(((res as any).rows ?? [])[0]?.skapad_av).toBe("import-explicit");
    expect(((res as any).rows ?? [])[0]?.metod).toBe("import");
  });

  it("städskriptet fångar bara legacy-fallback-rader — explicit valda kunder bevaras", async () => {
    // Objektet "Explicit Fastighet" (skapad_av='import-explicit') får INTE vara
    // kandidat. Seeda en syntetisk legacy-rad (skapad_av='system') på ett
    // importerat objekt och verifiera att ENBART den fångas.
    const [legacyObj] = await db
      .insert(objects)
      .values({
        tenantId: TENANT,
        name: "Legacy Auto-kund",
        objectNumber: `${NS}-LEG-1`,
        importBatchId: `${NS}-legacy-batch`,
      } as any)
      .returning();
    const [katalog] = (
      (await db.execute(sql`
        SELECT id FROM metadata_katalog
        WHERE tenant_id = ${TENANT} AND lower(namn) = 'kund' AND deleted_at IS NULL
      `)) as any
    ).rows;
    await db.execute(sql`
      INSERT INTO metadata_varden (tenant_id, objekt_id, metadata_katalog_id, varde_referens, skapad_av, metod)
      VALUES (${TENANT}, ${legacyObj.id}, ${katalog.id}, ${CUSTOMER_ID}, 'system', 'system')
    `);

    // Simulera övriga explicit-vägar (Fortnox-import, objekt-kopiering,
    // portal/manuellt UI) — samtliga skriver via ensurePrimaryPayer med
    // distinkt origin och får ALDRIG bli städkandidater.
    const explicitOrigins = ["import-explicit", "copy-explicit", "portal-explicit", "user-explicit"];
    const explicitObjIds: string[] = [];
    for (const origin of explicitOrigins) {
      const [o] = await db
        .insert(objects)
        .values({
          tenantId: TENANT,
          name: `Explicit via ${origin}`,
          objectNumber: `${NS}-${origin}`,
          importBatchId: `${NS}-batch-${origin}`,
        } as any)
        .returning();
      const mvId = await ensurePrimaryPayer(TENANT, o.id, CUSTOMER_ID, origin);
      expect(mvId).toBeTruthy();
      explicitObjIds.push(o.id);
    }

    const candidates = await findCandidates({ tenant: TENANT, customer: null });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].objekt_id).toBe(legacyObj.id);
    for (const id of explicitObjIds) {
      expect(candidates.map((c: any) => c.objekt_id)).not.toContain(id);
    }
    // Objektet med uttryckligen vald kund finns INTE i kandidatmängden.
    const objIds = candidates.map((c: any) => c.objekt_id);
    const [explicitObj] = await db
      .select()
      .from(objects)
      .where(and(eq(objects.tenantId, TENANT), eq(objects.name, "Explicit Fastighet")));
    expect(objIds).not.toContain(explicitObj.id);
  });
});
