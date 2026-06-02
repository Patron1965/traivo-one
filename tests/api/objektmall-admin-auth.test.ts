import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerObjektmallImportRoutes, buildTemplateWorkbook } from "../../server/routes/objektmallImportRoutes";
import { db } from "../../server/db";
import { tenants, users, userTenantRoles } from "../../shared/schema";
import { eq, inArray } from "drizzle-orm";

// Regressionstest för Task #615.
//
// `/api/admin/objektmall/*` ligger under admin-skip i routes.ts och kör därför
// SIN EGEN `requireTenantWithFallback` före `requireAdmin`. Utan den skulle
// `requireAdmin` läsa ett otillsatt `req.tenantRole` och tyst svara 403 i
// produktion (men inte i dev). Vi monterar routarna på en isolerad app med en
// stubbad auth-middleware (läser x-test-user-id → req.user.claims.sub) och kör
// hela auth-matrisen i NODE_ENV=production:
//   - oinloggad           → 401
//   - icke-admin medlem    → 403
//   - admin                → 200
// Detta täcker både en GET (template) och en write-route (preview).

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `objektmall-auth-${Date.now()}`;
const TENANT_ID = `${NS}-tenant`;
const ADMIN_UID = `${NS}-admin`;
const MEMBER_UID = `${NS}-member`;

async function req(
  method: string,
  path: string,
  opts: { userId?: string | null; body?: FormData } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.userId) headers["x-test-user-id"] = opts.userId;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body,
  });
  const ct = res.headers.get("content-type") ?? "";
  let body: any = null;
  if (ct.includes("application/json")) {
    body = await res.json().catch(() => null);
  } else {
    body = await res.arrayBuffer().catch(() => null);
  }
  return { status: res.status, body, contentType: ct };
}

beforeAll(async () => {
  originalNodeEnv = process.env.NODE_ENV;
  // Reproducera produktionsbeteendet (getTenantIdWithFallback kastar i prod om
  // tenant saknas; ingen kinab-dev-fallback).
  process.env.NODE_ENV = "production";

  const app = express();
  // Stubbad auth-middleware: x-test-user-id → req.user.claims.sub, precis som
  // Replit-OIDC populerar för riktiga sessioner. Inget annat mockas.
  app.use((reqIn: any, _res, next) => {
    const uid = reqIn.headers["x-test-user-id"];
    if (uid) reqIn.user = { claims: { sub: String(uid) } };
    next();
  });
  registerObjektmallImportRoutes(app);
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await db.insert(tenants).values({ id: TENANT_ID, name: "Objektmall Auth Test", subdomain: TENANT_ID }).onConflictDoNothing();
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
      // Admin i en icke-kinab-tenant → passerar både tenant-resolution och requireAdmin.
      { userId: ADMIN_UID, tenantId: TENANT_ID, role: "admin", isActive: true, assignedBy: ADMIN_UID },
      // Vanlig medlem → passerar tenant-resolution men blockeras av requireAdmin (403).
      { userId: MEMBER_UID, tenantId: TENANT_ID, role: "user", isActive: true, assignedBy: ADMIN_UID },
    ])
    .onConflictDoNothing();
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN_UID, MEMBER_UID]));
  await db.delete(users).where(inArray(users.id, [ADMIN_UID, MEMBER_UID]));
  await db.delete(tenants).where(eq(tenants.id, TENANT_ID));
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

function templateFormData(buf: Buffer): FormData {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(buf)]), "mall.xlsx");
  return fd;
}

describe("GET /api/admin/objektmall/template — auth-matris (prod)", () => {
  it("oinloggad → 401", async () => {
    const res = await req("GET", "/api/admin/objektmall/template");
    expect(res.status).toBe(401);
  });

  it("icke-admin medlem → 403", async () => {
    const res = await req("GET", "/api/admin/objektmall/template", { userId: MEMBER_UID });
    expect(res.status).toBe(403);
  });

  it("admin → 200 (laddar ner xlsx)", async () => {
    const res = await req("GET", "/api/admin/objektmall/template", { userId: ADMIN_UID });
    expect(res.status).toBe(200);
    expect(res.contentType).toMatch(/spreadsheetml\.sheet/);
    expect((res.body as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });
});

describe("POST /api/admin/objektmall/preview — auth-matris (prod, write-route)", () => {
  it("oinloggad → 401", async () => {
    const buf = await buildTemplateWorkbook();
    const res = await req("POST", "/api/admin/objektmall/preview", { body: templateFormData(buf) });
    expect(res.status).toBe(401);
  });

  it("icke-admin medlem → 403", async () => {
    const buf = await buildTemplateWorkbook();
    const res = await req("POST", "/api/admin/objektmall/preview", {
      userId: MEMBER_UID,
      body: templateFormData(buf),
    });
    expect(res.status).toBe(403);
  });

  it("admin → 200 (torrkörning av tom mall passerar)", async () => {
    const buf = await buildTemplateWorkbook();
    const res = await req("POST", "/api/admin/objektmall/preview", {
      userId: ADMIN_UID,
      body: templateFormData(buf),
    });
    expect(res.status).toBe(200);
    expect(res.body?.dryRun).toBe(true);
    expect(res.body?.ok).toBe(true);
  });
});
