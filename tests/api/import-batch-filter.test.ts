// Task #1357: "Visa objekten" efter Import 2.0 länkar till objektlistan
// filtrerad på importens batch (importBatchId). Testet kör de RIKTIGA
// route-handlers (upload→mappings→validate→execute) och verifierar att BÅDE
// nyskapade OCH uppdaterade objekt stämplas med batch-id:t, samt att
// getObjectsPaginated med importBatchId-filtret returnerar exakt batchens objekt.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerObjectImportV2Routes } from "../../server/routes/objectImportV2Routes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { storage } from "../../server/storage";
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
  importActions,
  importBatches,
  metadataHistorik,
  metadataVarden,
  metadataKatalog,
} from "@shared/schema";
import { eq } from "drizzle-orm";

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `oiv2bf-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const CUSTOMER_ID = `${NS}-customer`;
const EXISTING_NO = `BF-${Date.now() % 100000}`;
let existingId = "";

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
async function runImport(matrix: string[][], mappings: Record<string, any>): Promise<any> {
  const up = await req("POST", "/api/import/objects-v2/upload", {
    userId: ADMIN,
    body: { matrix, fileName: "batchfilter.csv" },
  });
  expect(up.status).toBe(200);
  const sessionId = up.body.session_id;
  const mp = await req("PUT", `/api/import/objects-v2/${sessionId}/mappings`, {
    userId: ADMIN,
    body: { mappings },
  });
  expect(mp.status).toBe(200);
  const val = await req("POST", `/api/import/objects-v2/${sessionId}/validate`, { userId: ADMIN });
  expect(val.status).toBe(200);
  const exec = await req("POST", `/api/import/objects-v2/${sessionId}/execute`, {
    userId: ADMIN,
    body: { customerId: CUSTOMER_ID },
  });
  expect(exec.status).toBe(202);
  for (let i = 0; i < 60; i++) {
    const st = await req("GET", `/api/import/objects-v2/${sessionId}/status`, { userId: ADMIN });
    if (st.body.status === "completed" || st.body.status === "failed") break;
    await sleep(500);
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

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(tenants).values({ id: TENANT, name: "OIV2 BatchFilter", subdomain: TENANT }).onConflictDoNothing();
  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();
  await db
    .insert(customers)
    .values({ id: CUSTOMER_ID, tenantId: TENANT, name: "Kund", customerNumber: "K-BF" })
    .onConflictDoNothing();

  // Befintligt objekt som ska UPPDATERAS av importen (matchas via system_id).
  const [existing] = await db
    .insert(objects)
    .values({ tenantId: TENANT, customerId: CUSTOMER_ID, name: "Befintlig", objectNumber: EXISTING_NO })
    .returning();
  existingId = existing.id;
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
  await db.delete(objectParents).where(eq(objectParents.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(userTenantRoles).where(eq(userTenantRoles.tenantId, TENANT));
  await db.delete(users).where(eq(users.id, ADMIN));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("Importbatch-filter (Task #1357)", () => {
  it("stämplar skapade OCH uppdaterade objekt med batch-id och batchfiltret returnerar exakt batchens objekt", async () => {
    const matrix = [
      ["Objektnummer", "Objektnamn"],
      [EXISTING_NO, "Uppdaterad"], // uppdateras (match via system_id)
      ["", "Nytt A"], // skapas
    ];
    const mappings = {
      "0": { target: "system_id", type: "standard" as const },
      "1": { target: "name", type: "standard" as const, required: true },
    };
    const result = await runImport(matrix, mappings);
    expect(result.summary.errors).toBe(0);
    expect(result.summary.created).toBe(1);
    expect(result.summary.updated).toBe(1);

    // Resultatet exponerar batch-id:t så att klienten kan länka till objektlistan.
    const batchId: string = result.import_batch_id;
    expect(batchId).toMatch(/^objects-v2-/);

    // Uppdaterat objekt stämplat med batchen (inte bara nyskapade).
    const [existing] = await db.select().from(objects).where(eq(objects.id, existingId));
    expect(existing.name).toBe("Uppdaterad");
    expect(existing.importBatchId).toBe(batchId);

    // Batchfiltret returnerar exakt batchens objekt (skapat + uppdaterat).
    const page = await storage.getObjectsPaginated(TENANT, 100, 0, undefined, undefined, {
      importBatchId: batchId,
    });
    expect(page.total).toBe(2);
    const names = page.objects.map((o) => o.name).sort();
    expect(names).toEqual(["Nytt A", "Uppdaterad"]);
    for (const o of page.objects) expect(o.importBatchId).toBe(batchId);
  });

  it("okänd batch ger tomt resultat", async () => {
    const page = await storage.getObjectsPaginated(TENANT, 100, 0, undefined, undefined, {
      importBatchId: `objects-v2-missing-${Date.now()}`,
    });
    expect(page.total).toBe(0);
    expect(page.objects).toEqual([]);
  });
});
