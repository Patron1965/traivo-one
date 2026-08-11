import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerImportRoutes } from "../../server/routes/importRoutes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { db } from "../../server/db";
import {
  tenants,
  users,
  userTenantRoles,
  customers,
  objects,
  workOrders,
  metadataHistorik,
  metadataVarden,
  metadataKatalog,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { setObjectKund } from "./helpers/object-kund";

// Task #1542 — regressionsskydd för Modus-importens kundpolicy (Task #1540):
// När CSV-radens "Kund" INTE matchar någon känd kund (och ingen override finns):
//   * policy "object"  ⇒ ordern får objektets METADATA-härledda kund
//     (read-model-overlay från Ekonomi-metadatat "Kund") — aldrig någon
//     "första kunden"-default eller annan gissning.
//   * policy "skip" (default) ⇒ raden hoppas över helt, ingen order skapas.
// En framtida ändring som tyst återinför en auto-kund ska faila här.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `modusuc-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const RIGHT_CUSTOMER_ID = `${NS}-right-customer`;
// Kund som FINNS i registret men aldrig refereras av CSV:n — kanariefågel för
// att ingen "första/enda kund"-fallback smyger in.
const DECOY_CUSTOMER_ID = `${NS}-decoy-customer`;

const CSV_HEADER =
  "Uppgifts Id;Uppgiftsnamn;Objekt;Kund;Uppgiftstyp;Status;Varaktighet";

function buildCsv(rows: string[]): string {
  return [CSV_HEADER, ...rows].join("\n");
}

async function postModusTasks(csv: string, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "modus-tasks.csv");
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${baseUrl}/api/import/modus/tasks`, {
    method: "POST",
    headers: { "x-test-user-id": ADMIN },
    body: form,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function workOrdersByModusId(modusId: string) {
  return db
    .select({
      id: workOrders.id,
      customerId: workOrders.customerId,
      externalReference: workOrders.externalReference,
    })
    .from(workOrders)
    .where(and(eq(workOrders.tenantId, TENANT), eq(workOrders.externalReference, modusId)));
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
  await registerImportRoutes(app);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(tenants).values({ id: TENANT, name: "Modus UC", subdomain: TENANT }).onConflictDoNothing();
  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();
  await db
    .insert(customers)
    .values([
      { id: RIGHT_CUSTOMER_ID, tenantId: TENANT, name: "Rätt Kund AB", customerNumber: "K-1" },
      { id: DECOY_CUSTOMER_ID, tenantId: TENANT, name: "Lockbetes-Kund AB", customerNumber: "K-2" },
    ])
    .onConflictDoNothing();

  // Objekt 111: HAR metadata-härledd kund (Ekonomi-metadatat "Kund").
  const [objWithKund] = await db
    .insert(objects)
    .values({ tenantId: TENANT, name: "Objekt med kund", objectNumber: "MODUS-111" } as any)
    .returning();
  await setObjectKund(TENANT, objWithKund.id, RIGHT_CUSTOMER_ID);
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await db.delete(workOrders).where(eq(workOrders.tenantId, TENANT));
  await db.delete(metadataHistorik).where(eq(metadataHistorik.tenantId, TENANT));
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(userTenantRoles).where(eq(userTenantRoles.tenantId, TENANT));
  await db.delete(users).where(eq(users.id, ADMIN));
  await db.execute(sql`DELETE FROM import_batches WHERE tenant_id = ${TENANT}`);
  await db.delete(tenants).where(eq(tenants.id, TENANT));
  if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("Task #1540/#1542 — Modus-import: okänd kund + unresolvedCustomerPolicy", () => {
  it('policy "object": ordern får objektets metadata-härledda kund — aldrig en gissad kund', async () => {
    const csv = buildCsv([
      `${NS}-T1;Testuppgift 1;111;Okänd Kund AB (999);Tömning;Utförd;60`,
    ]);
    const { status, body } = await postModusTasks(csv, { unresolvedCustomerPolicy: "object" });
    expect(status).toBe(200);
    expect(body.created).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.errors).toHaveLength(0);

    const rows = await workOrdersByModusId(`${NS}-T1`);
    expect(rows).toHaveLength(1);
    // Kunden kommer från objektets Kund-metadata (read-model-overlay) — inte
    // från CSV:ns okända kund och inte från någon annan kund i registret.
    expect(rows[0].customerId).toBe(RIGHT_CUSTOMER_ID);
    expect(rows[0].customerId).not.toBe(DECOY_CUSTOMER_ID);
  });

  it('policy "skip" (default): raden hoppas över — ingen order skapas', async () => {
    const csv = buildCsv([
      `${NS}-T2;Testuppgift 2;111;Okänd Kund AB (999);Tömning;Utförd;60`,
    ]);
    // Ingen policy skickas ⇒ default "skip".
    const { status, body } = await postModusTasks(csv);
    expect(status).toBe(200);
    expect(body.created).toBe(0);
    expect(body.skipped).toBe(1);

    const rows = await workOrdersByModusId(`${NS}-T2`);
    expect(rows).toHaveLength(0);
  });

  it("känd kund i CSV:n vinner alltid över objektets härledda kund", async () => {
    const csv = buildCsv([
      `${NS}-T3;Testuppgift 3;111;Lockbetes-Kund AB;Tömning;Utförd;60`,
    ]);
    const { status, body } = await postModusTasks(csv, { unresolvedCustomerPolicy: "object" });
    expect(status).toBe(200);
    expect(body.created).toBe(1);

    const rows = await workOrdersByModusId(`${NS}-T3`);
    expect(rows).toHaveLength(1);
    expect(rows[0].customerId).toBe(DECOY_CUSTOMER_ID);
  });
});
