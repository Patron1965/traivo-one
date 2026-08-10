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
  metadataKatalog,
  objectImportMappingTemplates,
} from "@shared/schema";
import { eq } from "drizzle-orm";

// Task #1495: sparade matchningsmallar för Import 2.0.
//  1. CRUD: spara (namn unikt per tenant, CI), lista (med signatur-matchning),
//     byta namn, ta bort.
//  2. Apply: mallmappningar valideras mot dagens katalog — metadata-mål som är
//     arkiverade/borttagna flaggas som stale och appliceras ALDRIG tyst;
//     inbyggda nycklar (name, system_id …) är fortsatt giltiga.
//  3. Tenant-isolering: en annan tenants mall är osynlig/oåtkomlig.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `oimt-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const TENANT2 = `${NS}-tenant2`;
const ADMIN = `${NS}-admin`;
const ADMIN2 = `${NS}-admin2`;

const SIGNATURE = "Objektnummer|Objektnamn|Lyftkrok|Gammalt fält";

async function api(
  method: string,
  path: string,
  body?: unknown,
  user: string = ADMIN,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user-id": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
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
  // Fånga fel som JSON (spegel av produktions-felhanteraren i miniatyr).
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? err.status ?? 500).json({ message: err.message });
  });

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(tenants).values({ id: TENANT, name: "OIMT Test" }).onConflictDoNothing();
  await db.insert(tenants).values({ id: TENANT2, name: "OIMT Test 2" }).onConflictDoNothing();
  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db.insert(users).values({ id: ADMIN2, email: `${ADMIN2}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN2, tenantId: TENANT2, role: "admin", isActive: true, assignedBy: ADMIN2 })
    .onConflictDoNothing();

  // Katalog: ett aktivt fält och ett ARKIVERAT fält (stale-scenariot).
  await db.insert(metadataKatalog).values({
    tenantId: TENANT,
    namn: `${NS}_lyftkrok`,
    visningsnamn: "Lyftkrok",
    datatyp: "string",
  });
  await db.insert(metadataKatalog).values({
    tenantId: TENANT,
    namn: `${NS}_utganget`,
    datatyp: "string",
    deletedAt: new Date(),
    archivedBy: ADMIN,
  });
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await db.delete(objectImportMappingTemplates).where(eq(objectImportMappingTemplates.tenantId, TENANT));
  await db.delete(objectImportMappingTemplates).where(eq(objectImportMappingTemplates.tenantId, TENANT2));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(userTenantRoles).where(eq(userTenantRoles.userId, ADMIN));
  await db.delete(userTenantRoles).where(eq(userTenantRoles.userId, ADMIN2));
  await db.delete(users).where(eq(users.id, ADMIN));
  await db.delete(users).where(eq(users.id, ADMIN2));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT2));
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

const validMappings = {
  "0": { target: "system_id", type: "standard" },
  "1": { target: "name", type: "standard", required: true },
  "2": { target: `metadata.${NS}_lyftkrok`, type: "metadata" },
  "3": { target: `metadata.${NS}_utganget`, type: "metadata" },
};

describe("Import 2.0 matchningsmallar (Task #1495)", () => {
  let templateId = "";

  it("sparar en mall med namn (tenant-scopad)", async () => {
    const { status, body } = await api("POST", "/api/import/objects-v2/mapping-templates", {
      name: `${NS} Tredo objektimport v1`,
      headerSignature: SIGNATURE,
      mappings: validMappings,
    });
    expect(status).toBe(201);
    expect(body.template.name).toBe(`${NS} Tredo objektimport v1`);
    expect(body.template.column_count).toBe(4);
    templateId = body.template.id;
  });

  it("avvisar dubblett-namn (case-insensitive) med 409", async () => {
    const { status } = await api("POST", "/api/import/objects-v2/mapping-templates", {
      name: `${NS} TREDO OBJEKTIMPORT V1`,
      headerSignature: SIGNATURE,
      mappings: validMappings,
    });
    expect(status).toBe(409);
  });

  it("avvisar tom mall (utan mappningar)", async () => {
    const { status } = await api("POST", "/api/import/objects-v2/mapping-templates", {
      name: `${NS} tom`,
      headerSignature: SIGNATURE,
      mappings: {},
    });
    expect(status).toBe(400);
  });

  it("listar mallar och flaggar signatur-matchning", async () => {
    const { status, body } = await api(
      "GET",
      `/api/import/objects-v2/mapping-templates?signature=${encodeURIComponent(SIGNATURE)}`,
    );
    expect(status).toBe(200);
    const t = body.templates.find((x: any) => x.id === templateId);
    expect(t).toBeTruthy();
    expect(t.matches_signature).toBe(true);
    const { body: other } = await api(
      "GET",
      `/api/import/objects-v2/mapping-templates?signature=${encodeURIComponent("Annan|Struktur")}`,
    );
    expect(other.templates.find((x: any) => x.id === templateId).matches_signature).toBe(false);
  });

  it("apply validerar mot katalogen: arkiverat målfält blir stale, aktiva appliceras", async () => {
    const { status, body } = await api(
      "POST",
      `/api/import/objects-v2/mapping-templates/${templateId}/apply`,
      {},
    );
    expect(status).toBe(200);
    // Aktiva + inbyggda mål appliceras.
    expect(body.mappings["0"].target).toBe("system_id");
    expect(body.mappings["1"].target).toBe("name");
    expect(body.mappings["2"].target).toBe(`metadata.${NS}_lyftkrok`);
    // Arkiverat metadatafält appliceras ALDRIG tyst — flaggas som stale.
    expect(body.mappings["3"]).toBeUndefined();
    expect(body.stale).toHaveLength(1);
    expect(body.stale[0].column_index).toBe(3);
    expect(body.stale[0].target).toBe(`metadata.${NS}_utganget`);
    expect(body.stale[0].reason).toMatch(/matchas om/);
  });

  it("kan byta namn på mall (och avvisar krock med annan malls namn)", async () => {
    const { status, body } = await api(
      "PATCH",
      `/api/import/objects-v2/mapping-templates/${templateId}`,
      { name: `${NS} Tredo v2` },
    );
    expect(status).toBe(200);
    expect(body.template.name).toBe(`${NS} Tredo v2`);

    const { body: b2 } = await api("POST", "/api/import/objects-v2/mapping-templates", {
      name: `${NS} annan mall`,
      headerSignature: "X|Y",
      mappings: { "0": { target: "name", type: "standard" } },
    });
    const { status: dupStatus } = await api(
      "PATCH",
      `/api/import/objects-v2/mapping-templates/${b2.template.id}`,
      { name: `${NS} tredo V2` },
    );
    expect(dupStatus).toBe(409);
  });

  it("tenant-isolering: annan tenants mall syns inte och kan inte röras", async () => {
    const { body } = await api("GET", "/api/import/objects-v2/mapping-templates", undefined, ADMIN2);
    expect(body.templates.find((x: any) => x.id === templateId)).toBeUndefined();
    const { status: applyStatus } = await api(
      "POST",
      `/api/import/objects-v2/mapping-templates/${templateId}/apply`,
      {},
      ADMIN2,
    );
    expect(applyStatus).toBe(404);
    const { status: delStatus } = await api(
      "DELETE",
      `/api/import/objects-v2/mapping-templates/${templateId}`,
      undefined,
      ADMIN2,
    );
    expect(delStatus).toBe(404);
  });

  it("tar bort mall", async () => {
    const { status, body } = await api(
      "DELETE",
      `/api/import/objects-v2/mapping-templates/${templateId}`,
    );
    expect(status).toBe(200);
    expect(body.deleted).toBe(true);
    const { status: applyStatus } = await api(
      "POST",
      `/api/import/objects-v2/mapping-templates/${templateId}/apply`,
      {},
    );
    expect(applyStatus).toBe(404);
  });
});
