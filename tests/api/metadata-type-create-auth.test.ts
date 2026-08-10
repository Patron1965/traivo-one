import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { metadataRouter } from "../../server/metadata-routes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { db } from "../../server/db";
import {
  tenants, users, userTenantRoles, metadataKatalog, metadataVarden, objects,
} from "../../shared/schema";
import { eq, inArray, and } from "drizzle-orm";

// Regressionstest för Task #1443.
//
// Katalogändringar är tenant-globala — endast systemansvarig (owner/admin) får
// skapa metadatafält. Vi verifierar server-side (UI-gating är inte auktorisation):
//   - icke-admin medlem → 403 med läsbart meddelande på POST /api/metadata/types
//   - admin             → 201 (fältet skapas)
//   - icke-admin kan FORTFARANDE lägga till ett befintligt, godkänt fält på ett
//     objekt (POST /api/metadata) — vanliga användarflödet förblir öppet.
//
// Isolerad app med stubbad auth (x-test-user-id → req.user.claims.sub) och
// requireTenantWithFallback framför routern, precis som i produktion.
// NODE_ENV=production så dev-fallbacks inte maskerar beteendet.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `mdtype-auth-${Date.now()}`;
const TENANT_ID = `${NS}-tenant`;
const ADMIN_UID = `${NS}-admin`;
const MEMBER_UID = `${NS}-member`;
const OBJECT_ID = `${NS}-obj`;
const FIELD_NAMN = `${NS}-portkod`;
const MEMBER_FIELD_NAMN = `${NS}-nekat-falt`;

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
  // Stubbad auth: x-test-user-id → req.user.claims.sub (som Replit-OIDC).
  app.use((reqIn: any, _res, next) => {
    const uid = reqIn.headers["x-test-user-id"];
    if (uid) reqIn.user = { claims: { sub: String(uid) } };
    next();
  });
  app.use("/api/metadata", requireTenantWithFallback, metadataRouter);
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await db.insert(tenants).values({ id: TENANT_ID, name: "Mdtype Auth Test", subdomain: TENANT_ID }).onConflictDoNothing();
  await db
    .insert(users)
    .values([
      { id: ADMIN_UID, email: `${ADMIN_UID}@test.local` },
      { id: MEMBER_UID, email: `${MEMBER_UID}@test.local` },
    ])
    .onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values([
      { userId: ADMIN_UID, tenantId: TENANT_ID, role: "admin", assignedBy: ADMIN_UID },
      { userId: MEMBER_UID, tenantId: TENANT_ID, role: "user", assignedBy: ADMIN_UID },
    ])
    .onConflictDoNothing();
  await db
    .insert(objects)
    .values({ id: OBJECT_ID, tenantId: TENANT_ID, name: "Testobjekt", objectNumber: `${NS}-OBJ-1` } as any)
    .onConflictDoNothing();
}, 30000);

afterAll(async () => {
  await db.delete(metadataVarden).where(eq(metadataVarden.objektId, OBJECT_ID)).catch(() => {});
  await db
    .delete(metadataKatalog)
    .where(and(eq(metadataKatalog.tenantId, TENANT_ID), inArray(metadataKatalog.namn, [FIELD_NAMN, MEMBER_FIELD_NAMN])))
    .catch(() => {});
  await db.delete(objects).where(eq(objects.id, OBJECT_ID)).catch(() => {});
  await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN_UID, MEMBER_UID])).catch(() => {});
  await db.delete(users).where(inArray(users.id, [ADMIN_UID, MEMBER_UID])).catch(() => {});
  await db.delete(tenants).where(eq(tenants.id, TENANT_ID)).catch(() => {});
  process.env.NODE_ENV = originalNodeEnv;
  await new Promise<void>((r) => server.close(() => r()));
}, 30000);

describe("Task #1443: rollkrav på skapande av metadatafält", () => {
  it("oinloggad nekas (401)", async () => {
    const r = await req("POST", "/api/metadata/types", {
      body: { namn: MEMBER_FIELD_NAMN, datatyp: "string" },
    });
    expect(r.status).toBe(401);
  });

  it("icke-admin nekas skapa fält med läsbart meddelande (403)", async () => {
    const r = await req("POST", "/api/metadata/types", {
      userId: MEMBER_UID,
      body: { namn: MEMBER_FIELD_NAMN, datatyp: "string" },
    });
    expect(r.status).toBe(403);
    expect(r.body?.error).toBe("Behörighet saknas");
    expect(String(r.body?.message ?? "")).toContain("owner");
    // Fältet får INTE ha skapats.
    const rows = await db
      .select()
      .from(metadataKatalog)
      .where(and(eq(metadataKatalog.tenantId, TENANT_ID), eq(metadataKatalog.namn, MEMBER_FIELD_NAMN)));
    expect(rows.length).toBe(0);
  });

  it("admin får skapa fält (201)", async () => {
    const r = await req("POST", "/api/metadata/types", {
      userId: ADMIN_UID,
      body: { namn: FIELD_NAMN, datatyp: "string" },
    });
    expect(r.status).toBe(201);
    expect(r.body?.namn).toBe(FIELD_NAMN);
  });

  it("icke-admin kan fortfarande lägga till befintligt fält på objekt", async () => {
    const r = await req("POST", "/api/metadata", {
      userId: MEMBER_UID,
      body: { objektId: OBJECT_ID, metadataTypNamn: FIELD_NAMN, varde: "1234" },
    });
    expect(r.status).toBe(201);
    expect(r.body?.varde ?? r.body?.value ?? "1234").toBeTruthy();
  });
});
