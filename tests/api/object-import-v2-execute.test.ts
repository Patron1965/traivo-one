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
  clusters,
  objects,
  objectParents,
  objectImportSessions,
  objectImportRows,
  metadataKatalog,
  metadataVarden,
  metadataHistorik,
} from "@shared/schema";
import { eq } from "drizzle-orm";

// Task #828 (code-review finding #4): API-nivå E2E över hela validate→execute-
// flödet genom de RIKTIGA route-handlers (inte bara core-logiken). Monteras bakom
// samma tenant-middleware som i prod (`requireTenantWithFallback`) på en isolerad
// app med stubbad auth (x-test-user-id → req.user.claims.sub). Verifierar:
//  1. create-beslut bygger hierarkin (org → butik) och parentar utrustning under
//     butiken (delar butikens interim_id).
//  2. RE-IMPORT: butik/org klassas update, utrustning create — och butiks-objektet
//     korrumperas INTE av utrustningsraderna (regression för finding #1).

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `oiv2-${Date.now()}`;
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

// En header-rad + datarader. Kolumner: 0 system, 1 namn, 2 interim, 3 interim-förälder.
const MATRIX: string[][] = [
  ["Systemnummer", "Objektnamn", "Interimsnummer", "Interims-förälder"],
  ["", "Hemköp Sverige AB", "1000", ""],
  ["", "Hemköp Centrum", "10", "1000"],
  ["", "Pantkärl", "10", ""],
  ["", "Matavfallskärl", "10", ""],
];

const MAPPINGS = {
  "0": { target: "system_id", type: "standard" as const },
  "1": { target: "name", type: "standard" as const, required: true },
  "2": { target: "interim_id", type: "standard" as const },
  "3": { target: "interim_parent_id", type: "standard" as const },
};

// Kör hela flödet upload→mappings→validate→execute och pollar status till klart.
async function runImport(): Promise<any> {
  const up = await req("POST", "/api/import/objects-v2/upload", {
    userId: ADMIN,
    body: { matrix: MATRIX, fileName: "hemkop.xlsx" },
  });
  expect(up.status).toBe(200);
  const sessionId = up.body.session_id as string;

  const mp = await req("PUT", `/api/import/objects-v2/${sessionId}/mappings`, {
    userId: ADMIN,
    body: { mappings: MAPPINGS },
  });
  expect(mp.status).toBe(200);

  const val = await req("POST", `/api/import/objects-v2/${sessionId}/validate`, { userId: ADMIN });
  expect(val.status).toBe(200);
  expect(val.body.summary.invalid).toBe(0);

  const exec = await req("POST", `/api/import/objects-v2/${sessionId}/execute`, {
    userId: ADMIN,
    body: { customerId: CUSTOMER_ID },
  });
  expect(exec.status).toBe(202);

  // Poll status tills completed/failed.
  for (let i = 0; i < 50; i++) {
    const st = await req("GET", `/api/import/objects-v2/${sessionId}/status`, { userId: ADMIN });
    if (st.body.status === "completed" || st.body.status === "failed") break;
    await sleep(150);
  }
  const result = await req("GET", `/api/import/objects-v2/${sessionId}/result`, { userId: ADMIN });
  expect(result.status).toBe(200);
  expect(result.body?.status).toBe("completed");
  return { sessionId, result: result.body };
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
  // execute använder requireAdmin som läser req.tenantRole → tenant-middleware
  // måste köra först (precis som i routes.ts).
  app.use(requireTenantWithFallback);
  registerObjectImportV2Routes(app);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(tenants).values({ id: TENANT, name: "OIV2 Test", subdomain: TENANT }).onConflictDoNothing();
  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();
  await db
    .insert(customers)
    .values({ id: CUSTOMER_ID, tenantId: TENANT, name: "Hemköp", customerNumber: "K-1" })
    .onConflictDoNothing();
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  // Rensa i beroende-ordning (barn först), tenant-scopat.
  await db.delete(metadataHistorik).where(eq(metadataHistorik.tenantId, TENANT));
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(objectImportRows).where(eq(objectImportRows.tenantId, TENANT));
  await db.delete(objectImportSessions).where(eq(objectImportSessions.tenantId, TENANT));
  await db.delete(objectParents).where(eq(objectParents.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(clusters).where(eq(clusters.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(userTenantRoles).where(eq(userTenantRoles.tenantId, TENANT));
  await db.delete(users).where(eq(users.id, ADMIN));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
}, 30000);

describe("Import 2.0 execute — API-nivå E2E", () => {
  it("create-flödet bygger hierarki och parentar utrustning under butiken", async () => {
    const { sessionId, result } = await runImport();

    expect(result.summary.created).toBe(4); // org + butik + 2 utrustning
    expect(result.summary.updated).toBe(0);
    expect(result.summary.errors).toBe(0);

    const rows = await db.select().from(objects).where(eq(objects.tenantId, TENANT));
    const byName = new Map(rows.map((o) => [o.name, o]));
    const org = byName.get("Hemköp Sverige AB")!;
    const butik = byName.get("Hemköp Centrum")!;
    const pant = byName.get("Pantkärl")!;
    const matavfall = byName.get("Matavfallskärl")!;

    expect(org).toBeTruthy();
    expect(butik.parentId).toBe(org.id); // butik under org
    expect(butik.objectNumber).toBe("MALL-10"); // interim-primär → MALL-prefix
    // Utrustning parentas under butiken (delar interim 10).
    expect(pant.parentId).toBe(butik.id);
    expect(matavfall.parentId).toBe(butik.id);

    // Persistent per-rad-livscykel: alla 4 rader imported.
    const rres = await req("GET", `/api/import/objects-v2/${sessionId}/rows`, { userId: ADMIN });
    expect(rres.body.counts.imported).toBe(4);
  });

  it("re-import: butik/org uppdateras, utrustning skapas, butiken korrumperas inte", async () => {
    const { result } = await runImport();

    // org + butik matchar via MALL-nummer → update; 2 utrustning → create.
    expect(result.summary.updated).toBe(2);
    expect(result.summary.created).toBe(2);

    // Butiks-objektet (MALL-10) får ALDRIG överskrivas av en utrustningsrad.
    const butikRows = await db
      .select()
      .from(objects)
      .where(eq(objects.objectNumber, "MALL-10"));
    expect(butikRows).toHaveLength(1);
    expect(butikRows[0].name).toBe("Hemköp Centrum"); // ej "Pantkärl"/"Matavfallskärl"
  });
});
