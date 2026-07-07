import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerObjectImportV2Routes } from "../../server/routes/objectImportV2Routes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { pivotLongMetadataMatrix } from "../../client/src/components/import/ObjectImportV2Flow";
import { db } from "../../server/db";
import {
  tenants,
  users,
  userTenantRoles,
  customers,
  clusters,
  objects,
  objectParents,
  objectImportSessions,
  objectImportRows,
  importActions,
  importBatches,
  objectPayers,
  metadataKatalog,
  metadataVarden,
  metadataHistorik,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";

// Task #1177: end-to-end round-trip för tre-fils-exporten. Exporten och
// matchningsimporten är verifierade var för sig (alias-mappning + pivot i
// three-file-export-import.test.ts), men den fulla vägen export → redigera →
// importera → objekt/metadata uppdaterade är inte integrationstestad eftersom
// e2e blockeras av extern Replit-OAuth. Detta test kör de RIKTIGA route-
// handlers (upload→mappings→validate→execute) bakom samma tenant-middleware
// som i prod och verifierar att BEFINTLIGA objekt + förälderkopplingar +
// metadata uppdateras korrekt när de tre exportfilerna läses tillbaka —
// inklusive Fil 3 i pivoterat långformat.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;
let lastValidation: any = null;

const NS = `oiv2rt-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const CUSTOMER_ID = `${NS}-customer`;

// Befintliga objekt (motsvarar det som exporterats): en org + en butik under den.
const ORG_NO = `${NS}-ORG`;
const BUTIK_NO = `${NS}-BUTIK`;
let orgId = "";
let butikId = "";
let adressKatId = "";
let stadKatId = "";

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

// Kör hela flödet upload→mappings→validate→execute och pollar tills klart.
async function runImport(
  matrix: string[][],
  mappings: Record<string, any>,
  opts: { overwriteMetadata?: boolean } = {},
): Promise<any> {
  const up = await req("POST", "/api/import/objects-v2/upload", {
    userId: ADMIN,
    body: { matrix, fileName: "roundtrip.csv" },
  });
  expect(up.status).toBe(200);
  const sessionId = up.body.session_id as string;

  const mp = await req("PUT", `/api/import/objects-v2/${sessionId}/mappings`, {
    userId: ADMIN,
    body: { mappings },
  });
  expect(mp.status).toBe(200);

  const val = await req("POST", `/api/import/objects-v2/${sessionId}/validate`, { userId: ADMIN });
  expect(val.status).toBe(200);
  expect(val.body.summary.invalid).toBe(0);
  lastValidation = val.body;

  const exec = await req("POST", `/api/import/objects-v2/${sessionId}/execute`, {
    userId: ADMIN,
    body: { customerId: CUSTOMER_ID, overwriteMetadata: opts.overwriteMetadata ?? false },
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

// Läs ut ett metadatavärde (varde_string) för ett objekt + katalograd.
async function readMetaValue(objektId: string, katalogId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(metadataVarden)
    .where(
      and(
        eq(metadataVarden.tenantId, TENANT),
        eq(metadataVarden.objektId, objektId),
        eq(metadataVarden.metadataKatalogId, katalogId),
      ),
    );
  return row?.vardeString ?? null;
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

  await db.insert(tenants).values({ id: TENANT, name: "OIV2 RT", subdomain: TENANT }).onConflictDoNothing();
  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();
  await db
    .insert(customers)
    .values({ id: CUSTOMER_ID, tenantId: TENANT, name: "Kund", customerNumber: "K-RT" })
    .onConflictDoNothing();

  // Befintlig hierarki: org → butik (som om den redan exporterats).
  const [org] = await db
    .insert(objects)
    .values({ tenantId: TENANT, customerId: CUSTOMER_ID, name: "Org", objectNumber: ORG_NO })
    .returning();
  orgId = org.id;
  const [butik] = await db
    .insert(objects)
    .values({ tenantId: TENANT, customerId: CUSTOMER_ID, name: "Butik", objectNumber: BUTIK_NO, parentId: orgId })
    .returning();
  butikId = butik.id;
  await db
    .insert(objectParents)
    .values({ tenantId: TENANT, objectId: butikId, parentId: orgId, isPrimary: true })
    .onConflictDoNothing();

  // Metadatakatalog + befintliga värden på butiken (Fil 3-innehåll).
  const [adress] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: "Adress", datatyp: "string" })
    .returning();
  adressKatId = adress.id;
  const [stad] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: "Stad", datatyp: "string" })
    .returning();
  stadKatId = stad.id;
  // Endast Adress finns sedan tidigare — Stad saknas och ska adderas vid import.
  await db.insert(metadataVarden).values([
    { tenantId: TENANT, objektId: butikId, metadataKatalogId: adressKatId, vardeString: "Gamla vägen 1" },
  ]);
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await db.delete(metadataHistorik).where(eq(metadataHistorik.tenantId, TENANT));
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(objectImportRows).where(eq(objectImportRows.tenantId, TENANT));
  await db.delete(objectImportSessions).where(eq(objectImportSessions.tenantId, TENANT));
  await db.delete(importActions).where(eq(importActions.tenantId, TENANT));
  await db.delete(importBatches).where(eq(importBatches.tenantId, TENANT));
  await db.delete(objectPayers).where(eq(objectPayers.tenantId, TENANT));
  await db.delete(objectParents).where(eq(objectParents.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(clusters).where(eq(clusters.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(userTenantRoles).where(eq(userTenantRoles.tenantId, TENANT));
  await db.delete(users).where(eq(users.id, ADMIN));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("Tre-fils-export → återimport round-trip (Task #1177)", () => {
  // Fil 1 — Objekt: Objektnummer, Objektnamn, Släktnamn, Status. Vi redigerar
  // butikens namn och läser tillbaka den. system_id matchar befintligt objekt.
  it("Fil 1: uppdaterar befintligt objekts namn utan att skapa dubbletter", async () => {
    const matrix = [
      ["Objektnummer", "Objektnamn", "Släktnamn", "Status"],
      [ORG_NO, "Org", "Org", "active"],
      [BUTIK_NO, "Butik Centrum", "Org › Butik Centrum", "active"],
    ];
    const mappings = {
      "0": { target: "system_id", type: "standard" as const },
      "1": { target: "name", type: "standard" as const, required: true },
      "3": { target: "active_status", type: "standard" as const },
    };
    const result = await runImport(matrix, mappings);
    expect(result.summary.created).toBe(0);
    expect(result.summary.updated).toBe(2);
    expect(result.summary.errors).toBe(0);

    const [butik] = await db.select().from(objects).where(eq(objects.id, butikId));
    expect(butik.name).toBe("Butik Centrum");
    // Ingen dubblett skapad för butiksnumret.
    const dupes = await db.select().from(objects).where(eq(objects.objectNumber, BUTIK_NO));
    expect(dupes).toHaveLength(1);
  });

  // Fil 2 — Kopplade objekt: Huvudobjekt, Namn, Koppling uppåt, Släktnamn.
  // Bekräftar att förälderkopplingen (butik under org) läses tillbaka via
  // system_parent_id.
  it("Fil 2: bevarar förälderkopplingen via system_parent_id", async () => {
    const matrix = [
      ["Huvudobjekt", "Namn", "Koppling uppåt", "Släktnamn"],
      [BUTIK_NO, "Butik Centrum", ORG_NO, "Org › Butik Centrum"],
    ];
    const mappings = {
      "0": { target: "system_id", type: "standard" as const },
      "1": { target: "name", type: "standard" as const, required: true },
      "2": { target: "system_parent_id", type: "standard" as const },
    };
    const result = await runImport(matrix, mappings);
    expect(result.summary.errors).toBe(0);

    const [butik] = await db.select().from(objects).where(eq(objects.id, butikId));
    expect(butik.parentId).toBe(orgId);
    const [link] = await db
      .select()
      .from(objectParents)
      .where(and(eq(objectParents.objectId, butikId), eq(objectParents.parentId, orgId)));
    expect(link).toBeTruthy();
  });

  // Fil 3 — Metadata i långformat: pivoteras klient-sida (pivotLongMetadataMatrix)
  // till brett format innan uppladdning. Round-trip-semantiken för metadata på
  // BEFINTLIGA objekt är "första-skrivningen-vinner": ersättande fält
  // (allowDuplicates=false) skrivs INTE över (Adress bevaras), medan fält som
  // saknades adderas (Stad skapas). Detta dokumenterar hur exporten läses
  // tillbaka utan att radera redan lagrade värden.
  it("Fil 3 (pivoterat långformat): adderar saknat metadatafält, bevarar befintligt", async () => {
    const longMatrix = [
      ["Objektnummer", "Objektnamn", "Släktnamn", "Metadatafält", "Data"],
      [BUTIK_NO, "Butik Centrum", "Org › Butik Centrum", "Adress", "Nya vägen 5"],
      [BUTIK_NO, "Butik Centrum", "Org › Butik Centrum", "Stad", "Göteborg"],
    ];
    const wide = pivotLongMetadataMatrix(longMatrix)!;
    expect(wide).not.toBeNull();
    expect(wide[0]).toEqual(["Objektnummer", "Objektnamn", "metadata.Adress", "metadata.Stad"]);

    const mappings = {
      "0": { target: "system_id", type: "standard" as const },
      "1": { target: "name", type: "standard" as const, required: true },
      "2": { target: "metadata.Adress", type: "metadata" as const },
      "3": { target: "metadata.Stad", type: "metadata" as const },
    };
    const result = await runImport(wide, mappings);
    expect(result.summary.errors).toBe(0);
    expect(result.summary.updated).toBe(1);

    // Förhandsvisningen varnar om att Adress (befintligt värde) bevaras.
    const butikRow = lastValidation?.rows?.find((r: any) =>
      (r.issues ?? []).some((i: any) => i.field === "metadata"),
    );
    expect(butikRow).toBeTruthy();
    const metaIssue = butikRow.issues.find((i: any) => i.field === "metadata");
    expect(metaIssue.message).toContain("Adress");
    expect(metaIssue.message).toContain("Skriv över");

    // Befintligt värde bevaras (skrivs inte över).
    expect(await readMetaValue(butikId, adressKatId)).toBe("Gamla vägen 1");
    // Fält som saknades adderas.
    expect(await readMetaValue(butikId, stadKatId)).toBe("Göteborg");
  });

  // Task #1179: med overwriteMetadata=true skrivs ett redigerat metadatavärde
  // på ett BEFINTLIGT objekt faktiskt över (äkta export → redigera → importera).
  it("Fil 3 med skriv-över: uppdaterar befintligt metadatavärde", async () => {
    const longMatrix = [
      ["Objektnummer", "Objektnamn", "Släktnamn", "Metadatafält", "Data"],
      [BUTIK_NO, "Butik Centrum", "Org › Butik Centrum", "Adress", "Nyaste vägen 9"],
    ];
    const wide = pivotLongMetadataMatrix(longMatrix)!;
    const mappings = {
      "0": { target: "system_id", type: "standard" as const },
      "1": { target: "name", type: "standard" as const, required: true },
      "2": { target: "metadata.Adress", type: "metadata" as const },
    };
    const result = await runImport(wide, mappings, { overwriteMetadata: true });
    expect(result.summary.errors).toBe(0);

    // Adress skrivs nu över med det redigerade värdet.
    expect(await readMetaValue(butikId, adressKatId)).toBe("Nyaste vägen 9");
    // Endast ett värde per ersättande katalogfält (inget dubblettvärde kvar).
    const rows = await db
      .select()
      .from(metadataVarden)
      .where(
        and(
          eq(metadataVarden.tenantId, TENANT),
          eq(metadataVarden.objektId, butikId),
          eq(metadataVarden.metadataKatalogId, adressKatId),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
