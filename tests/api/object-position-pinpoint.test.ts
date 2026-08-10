import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { metadataRouter } from "../../server/metadata-routes";
import { registerObjectRoutes } from "../../server/routes/objectRoutes";
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
  metadataHistorik,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

// Task #1367: flyttbar pinpoint på objektsidan.
//
// Kartdialogen sparar via den dedikerade endpointen
// PUT /api/objects/:id/position (requireAdmin = owner/admin, speglar UI:t):
// - Skrivningen går via metadata-vägen (fältet "Koordinater", metod='manuell')
//   — metadata är källan; objektkolumnerna (latitude/longitude) är en ruttbar
//   cache som endpointen synkar SYNKRONT innan svaret (ingen stale klient-cache).
// - Lagrat: lat/lng (varde_json), senast ändrad, ändrad av (server-auktoritativ
//   aktör), källa (metod='manuell').
// - Flytt av pinpointen arkiveras i metadatahistoriken (vem/när/källa).
// - Icke-admin tenant-medlem nekas (403) — UI-gaten backas av servern.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `pin-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const MEMBER = `${NS}-member`;
let customerId = "";
let objektId = "";
let rowId = "";

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
  app.use("/api/metadata", metadataRouter);
  await registerObjectRoutes(app);
  await registerCustomerRoutes(app);
  app.use(errorHandler);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await storage.ensureTenant(TENANT, { name: "Pinpoint Test" });
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
      { userId: MEMBER, tenantId: TENANT, role: "user", isActive: true, assignedBy: ADMIN },
    ])
    .onConflictDoNothing();

  // Geo-katalogfältet (samma namn/datatyp/systemlast som den systemlåsta
  // geografimodellen — geo-synken matchar på systemlast + lower(namn)).
  await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, namn: "Koordinater", datatyp: "location", standardArvs: true, systemlast: true });

  const created = await req("POST", "/api/objects", {
    userId: ADMIN,
    body: { name: `${NS} Objekt`, customerId, status: "active" },
  });
  expect(created.status).toBe(201);
  objektId = created.body.id;
}, 40000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  try {
    await db.delete(metadataHistorik).where(inArray(metadataHistorik.tenantId, [TENANT]));
    await db.delete(metadataVarden).where(inArray(metadataVarden.tenantId, [TENANT]));
    await db.delete(metadataKatalog).where(inArray(metadataKatalog.tenantId, [TENANT]));
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT]));
    await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN, MEMBER]));
    await db.delete(users).where(inArray(users.id, [ADMIN, MEMBER]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT]));
  } catch (err) {
    console.warn("Cleanup (object-position-pinpoint.test) ofullständig:", err);
  }
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("Task #1367 — PUT /api/objects/:id/position (pinpoint via metadata-vägen)", () => {
  it("icke-admin tenant-medlem nekas (403)", async () => {
    const res = await req("PUT", `/api/objects/${objektId}/position`, {
      userId: MEMBER,
      body: { lat: 59.3293, lng: 18.0686 },
    });
    expect(res.status).toBe(403);
  });

  it("ogiltiga koordinater avvisas (400)", async () => {
    const res = await req("PUT", `/api/objects/${objektId}/position`, {
      userId: ADMIN,
      body: { lat: 123, lng: 18.0686 },
    });
    expect(res.status).toBe(400);
  });

  it("sparar punkten via metadata-vägen och synkar kolumn-cachen innan svar", async () => {
    const res = await req("PUT", `/api/objects/${objektId}/position`, {
      userId: ADMIN,
      body: { lat: 59.3293, lng: 18.0686 },
    });
    expect(res.status).toBe(200);
    rowId = res.body.metadataId;
    expect(rowId).toBeTruthy();
    // Kolumn-cachen är redan uppdaterad i svaret (synk körs synkront).
    expect(Number(res.body.latitude)).toBeCloseTo(59.3293, 4);
    expect(Number(res.body.longitude)).toBeCloseTo(18.0686, 4);

    // Metadata = källan: raden bär punkt-json, manuellt ursprung och aktör.
    const [row] = await db.select().from(metadataVarden).where(eq(metadataVarden.id, rowId));
    expect(row.vardeJson).toMatchObject({ type: "point", lat: 59.3293, lng: 18.0686 });
    expect(row.metod).toBe("manuell");
    expect(row.skapadAv).toBe(ADMIN);

    // Objektkolumnerna (cachen) matchar utan någon manuell synk i testet.
    const obj = await storage.getObject(objektId);
    expect(Number(obj?.latitude)).toBeCloseTo(59.3293, 4);
    expect(Number(obj?.longitude)).toBeCloseTo(18.0686, 4);
  });

  it("flytt av pinpointen arkiverar gamla positionen i historiken (vem/när/källa)", async () => {
    const res = await req("PUT", `/api/objects/${objektId}/position`, {
      userId: ADMIN,
      body: { lat: 57.7089, lng: 11.9746 },
    });
    expect(res.status).toBe(200);
    // Id-stabil ersättning (auto-arkivering på enkelvärdesfält).
    expect(res.body.metadataId).toBe(rowId);
    expect(Number(res.body.latitude)).toBeCloseTo(57.7089, 4);
    expect(Number(res.body.longitude)).toBeCloseTo(11.9746, 4);

    const hist = await req("GET", `/api/metadata/historik/${rowId}`, { userId: ADMIN });
    expect(hist.status).toBe(200);
    const entry = hist.body.find((h: any) => String(h.gammaltVarde ?? "").includes("59.3293"));
    expect(entry).toBeTruthy();
    expect(entry.andradAv).toBe(ADMIN);
    expect(entry.andradVid).toBeTruthy();
    expect(entry.andringsMetod).toBe("manuell");
  });

  it("objektets metadata-läsning exponerar position + attribution för kartdialogen", async () => {
    const res = await req("GET", `/api/metadata/objects/${objektId}`, { userId: ADMIN });
    expect(res.status).toBe(200);
    const list = Array.isArray(res.body) ? res.body : res.body?.metadata ?? [];
    const entry = list.find((e: any) => e.katalog?.namn === "Koordinater");
    expect(entry).toBeTruthy();
    expect(entry.vardeJson).toMatchObject({ lat: 57.7089, lng: 11.9746 });
    expect(entry.metod).toBe("manuell");
    expect(entry.uppdateradAv ?? entry.skapadAv).toBe(ADMIN);
  });
});
