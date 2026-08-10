import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { metadataRouter } from "../../server/metadata-routes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { db } from "../../server/db";
import {
  tenants,
  users,
  userTenantRoles,
  metadataKatalog,
  metadataKatalogKunder,
  metadataVarden,
  metadataHistorik,
  objects,
  customers,
  orderTypeMetadataLinks,
  objectHeaderConfigs,
  objectQuickFieldConfigs,
  importTemplates,
  metadataEditors,
  metadataEditorFields,
  metadataEditorSubmissions,
  metadataEditorSubmissionValues,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

// Task #1497: städvy för importskapade katalogfält.
// Testar GET /types/import-created (lista med användningsräkning) och
// POST /types/:id/merge-into (sammanslagning mot kanoniskt fält med hård
// usage-bekräftelse; källfältet arkiveras — aldrig hard-delete).
// Samma isolerade route-monteringsmönster som metadata-katalog-route.test.ts.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `mk-cleanup-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;
const MEMBER = `${NS}-member`;
const OBJ_1 = `${NS}-obj-1`;
const OBJ_2 = `${NS}-obj-2`;

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

async function insertKatalog(values: Partial<typeof metadataKatalog.$inferInsert> & { namn: string }) {
  const [row] = await db
    .insert(metadataKatalog)
    .values({ tenantId: TENANT, datatyp: "string", ...values })
    .returning();
  return row;
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
  app.use("/api/metadata", requireTenantWithFallback, metadataRouter);

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await db.insert(tenants).values([{ id: TENANT, name: "Import Cleanup Test", subdomain: TENANT }]).onConflictDoNothing();
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
  await db
    .insert(objects)
    .values([
      { id: OBJ_1, tenantId: TENANT, name: `${NS} objekt 1` },
      { id: OBJ_2, tenantId: TENANT, name: `${NS} objekt 2` },
    ])
    .onConflictDoNothing();
}, 30000);

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await db.delete(importTemplates).where(eq(importTemplates.tenantId, TENANT));
  await db.delete(metadataEditorSubmissionValues).where(eq(metadataEditorSubmissionValues.tenantId, TENANT));
  await db.delete(metadataEditorSubmissions).where(eq(metadataEditorSubmissions.tenantId, TENANT));
  await db.delete(metadataEditorFields).where(eq(metadataEditorFields.tenantId, TENANT));
  await db.delete(metadataEditors).where(eq(metadataEditors.tenantId, TENANT));
  await db.delete(orderTypeMetadataLinks).where(eq(orderTypeMetadataLinks.tenantId, TENANT));
  await db.delete(metadataKatalogKunder).where(eq(metadataKatalogKunder.tenantId, TENANT));
  await db.delete(objectHeaderConfigs).where(eq(objectHeaderConfigs.tenantId, TENANT));
  await db.delete(objectQuickFieldConfigs).where(eq(objectQuickFieldConfigs.tenantId, TENANT));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(metadataHistorik).where(eq(metadataHistorik.tenantId, TENANT));
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(objects).where(inArray(objects.id, [OBJ_1, OBJ_2]));
  await db.delete(userTenantRoles).where(inArray(userTenantRoles.userId, [ADMIN, MEMBER]));
  await db.delete(users).where(inArray(users.id, [ADMIN, MEMBER]));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
  process.env.NODE_ENV = originalNodeEnv;
}, 30000);

describe("GET /api/metadata/types/import-created (Task #1497)", () => {
  it("kräver admin", async () => {
    const anon = await req("GET", "/api/metadata/types/import-created");
    expect(anon.status).toBe(401);
    const member = await req("GET", "/api/metadata/types/import-created", { userId: MEMBER });
    expect(member.status).toBe(403);
  });

  it("listar endast importskapade fält med användningsräkning; systemlåsta exkluderas", async () => {
    const importFalt = await insertKatalog({ namn: `${NS}-lazy-a`, kategori: "import" });
    await insertKatalog({ namn: `${NS}-lazy-b`, kategori: "importerad" });
    await insertKatalog({ namn: `${NS}-manuell`, kategori: "annat" });
    await insertKatalog({ namn: `${NS}-syslast`, kategori: "import", isSystem: true, systemlast: true });

    await db.insert(metadataVarden).values([
      { tenantId: TENANT, objektId: OBJ_1, metadataKatalogId: importFalt.id, vardeString: "v1" },
      { tenantId: TENANT, objektId: OBJ_2, metadataKatalogId: importFalt.id, vardeString: "v2" },
    ]);

    const res = await req("GET", "/api/metadata/types/import-created", { userId: ADMIN });
    expect(res.status).toBe(200);
    const names = (res.body as any[]).map((r) => r.namn);
    expect(names).toContain(`${NS}-lazy-a`);
    expect(names).toContain(`${NS}-lazy-b`);
    expect(names).not.toContain(`${NS}-manuell`);
    expect(names).not.toContain(`${NS}-syslast`);
    const a = (res.body as any[]).find((r) => r.namn === `${NS}-lazy-a`);
    expect(a.valueCount).toBe(2);
    expect(a.usageTotal).toBe(2);
  });
});

describe("POST /api/metadata/types/:id/merge-into (Task #1497)", () => {
  it("blockerar utan exakt usage-bekräftelse och vid fel datatyp/kategori", async () => {
    const source = await insertKatalog({ namn: `${NS}-src-guard`, kategori: "import" });
    const target = await insertKatalog({ namn: `${NS}-tgt-guard`, kategori: "annat" });
    const wrongType = await insertKatalog({ namn: `${NS}-tgt-int`, kategori: "annat", datatyp: "integer" });
    const nonImport = await insertKatalog({ namn: `${NS}-src-manuell`, kategori: "annat" });
    await db.insert(metadataVarden).values([
      { tenantId: TENANT, objektId: OBJ_1, metadataKatalogId: source.id, vardeString: "x" },
    ]);

    // Fel confirmUsage → 409 med förväntat antal
    const bad = await req("POST", `/api/metadata/types/${source.id}/merge-into`, {
      userId: ADMIN,
      body: { targetId: target.id, confirmUsage: 0 },
    });
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe("USAGE_CONFIRMATION_MISMATCH");
    expect(bad.body.expectedUsage).toBe(1);

    // Olika datatyp → 400
    const dt = await req("POST", `/api/metadata/types/${source.id}/merge-into`, {
      userId: ADMIN,
      body: { targetId: wrongType.id, confirmUsage: 1 },
    });
    expect(dt.status).toBe(400);

    // Källa som inte är importskapad → 400
    const cat = await req("POST", `/api/metadata/types/${nonImport.id}/merge-into`, {
      userId: ADMIN,
      body: { targetId: target.id, confirmUsage: 0 },
    });
    expect(cat.status).toBe(400);

    // Icke-admin → 403
    const member = await req("POST", `/api/metadata/types/${source.id}/merge-into`, {
      userId: MEMBER,
      body: { targetId: target.id, confirmUsage: 1 },
    });
    expect(member.status).toBe(403);
  });

  it("blockerar mål som själv är importskapat (server-side kanonisk-vakt)", async () => {
    const source = await insertKatalog({ namn: `${NS}-src-noncanon`, kategori: "import" });
    const importTarget = await insertKatalog({ namn: `${NS}-tgt-import`, kategori: "importerad" });
    const res = await req("POST", `/api/metadata/types/${source.id}/merge-into`, {
      userId: ADMIN,
      body: { targetId: importTarget.id, confirmUsage: 0 },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/importskapat/i);
  });

  it("flyttar värden + historik till målet och arkiverar källan (aldrig hard-delete)", async () => {
    const source = await insertKatalog({ namn: `${NS}-src-merge`, kategori: "import" });
    const target = await insertKatalog({ namn: `${NS}-tgt-merge`, kategori: "annat" });
    const [v] = await db
      .insert(metadataVarden)
      .values([{ tenantId: TENANT, objektId: OBJ_1, metadataKatalogId: source.id, vardeString: "flyttas" }])
      .returning();
    await db.insert(metadataHistorik).values([
      {
        tenantId: TENANT,
        metadataVardenId: v.id,
        objektId: OBJ_1,
        metadataKatalogId: source.id,
        gammaltVarde: null,
        nyttVarde: "flyttas",
        andradAv: "import",
        andringsMetod: "import",
      },
    ]);

    const res = await req("POST", `/api/metadata/types/${source.id}/merge-into`, {
      userId: ADMIN,
      body: { targetId: target.id, confirmUsage: 1 },
    });
    expect(res.status).toBe(200);
    expect(res.body.movedValues).toBe(1);
    expect(res.body.movedHistorik).toBe(1);

    // Värdet pekar nu på målet
    const moved = await db
      .select()
      .from(metadataVarden)
      .where(and(eq(metadataVarden.tenantId, TENANT), eq(metadataVarden.metadataKatalogId, target.id)));
    expect(moved).toHaveLength(1);
    expect(moved[0].vardeString).toBe("flyttas");

    // Källan är arkiverad (soft-delete), inte borttagen
    const [src] = await db
      .select()
      .from(metadataKatalog)
      .where(eq(metadataKatalog.id, source.id));
    expect(src).toBeDefined();
    expect(src.deletedAt).not.toBeNull();
    expect(src.archivedReason).toMatch(/Sammanslagen/);
  });

  it("blockerar när ett objekt har värden i BÅDA fälten och målet är enkelvärdesfält", async () => {
    const source = await insertKatalog({ namn: `${NS}-src-conflict`, kategori: "import" });
    const target = await insertKatalog({ namn: `${NS}-tgt-conflict`, kategori: "annat", allowDuplicates: false });
    await db.insert(metadataVarden).values([
      { tenantId: TENANT, objektId: OBJ_1, metadataKatalogId: source.id, vardeString: "a" },
      { tenantId: TENANT, objektId: OBJ_1, metadataKatalogId: target.id, vardeString: "b" },
    ]);

    const res = await req("POST", `/api/metadata/types/${source.id}/merge-into`, {
      userId: ADMIN,
      body: { targetId: target.id, confirmUsage: 1 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("VALUE_CONFLICTS");
  });
});

describe("DELETE /api/metadata/types/:id — arkiverings-vakt för importskapade fält (Task #1497)", () => {
  it("blockerar arkivering vid lagrade värden", async () => {
    const falt = await insertKatalog({ namn: `${NS}-arch-values`, kategori: "import" });
    await db.insert(metadataVarden).values([
      { tenantId: TENANT, objektId: OBJ_1, metadataKatalogId: falt.id, vardeString: "x" },
    ]);
    const res = await req("DELETE", `/api/metadata/types/${falt.id}`, { userId: ADMIN });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IMPORT_FIELD_IN_USE");
    expect(res.body.usage.valueCount).toBe(1);
  });

  it("blockerar arkivering vid ordertyp-länk (konfig-referens)", async () => {
    const falt = await insertKatalog({ namn: `${NS}-arch-otl`, kategori: "import" });
    await db.insert(orderTypeMetadataLinks).values([
      { tenantId: TENANT, orderType: "service", metadataKatalogId: falt.id },
    ]);
    const res = await req("DELETE", `/api/metadata/types/${falt.id}`, { userId: ADMIN });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IMPORT_FIELD_IN_USE");
    expect(res.body.usage.configRefCount).toBe(1);
  });

  it("blockerar arkivering vid kundlås-koppling", async () => {
    const KUND = `${NS}-kund`;
    await db.insert(customers).values([{ id: KUND, tenantId: TENANT, name: `${NS} Kund` }]).onConflictDoNothing();
    const falt = await insertKatalog({ namn: `${NS}-arch-kund`, kategori: "importerad" });
    await db.insert(metadataKatalogKunder).values([
      { tenantId: TENANT, metadataKatalogId: falt.id, customerId: KUND },
    ]);
    const res = await req("DELETE", `/api/metadata/types/${falt.id}`, { userId: ADMIN });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IMPORT_FIELD_IN_USE");
  });

  it("blockerar arkivering vid header- och snabbfälts-slots", async () => {
    const faltHeader = await insertKatalog({ namn: `${NS}-arch-header`, kategori: "import" });
    const faltQuick = await insertKatalog({ namn: `${NS}-arch-quick`, kategori: "import" });
    await db.insert(objectHeaderConfigs).values([
      { tenantId: TENANT, objectType: `${NS}-typ`, field2KatalogId: faltHeader.id },
    ]);
    await db.insert(objectQuickFieldConfigs).values([
      { tenantId: TENANT, objectId: OBJ_2, field1KatalogId: faltQuick.id },
    ]);

    const resHeader = await req("DELETE", `/api/metadata/types/${faltHeader.id}`, { userId: ADMIN });
    expect(resHeader.status).toBe(409);
    expect(resHeader.body.code).toBe("IMPORT_FIELD_IN_USE");

    const resQuick = await req("DELETE", `/api/metadata/types/${faltQuick.id}`, { userId: ADMIN });
    expect(resQuick.status).toBe(409);
    expect(resQuick.body.code).toBe("IMPORT_FIELD_IN_USE");
  });

  it("blockerar arkivering när en importmall refererar fältet; merge repointar field_ids (ordning + dedupe)", async () => {
    const falt = await insertKatalog({ namn: `${NS}-arch-mall`, kategori: "import" });
    const kanon = await insertKatalog({ namn: `${NS}-mall-kanon`, kategori: null });
    const other = await insertKatalog({ namn: `${NS}-mall-annan`, kategori: null });
    // Mall 1: källan mitt i listan, målet finns INTE → positionsvis ersättning.
    const [mall1] = await db.insert(importTemplates).values({
      tenantId: TENANT, name: `${NS}-mall1`, fieldIds: [other.id, falt.id],
    }).returning();
    // Mall 2: målet finns redan → dedupe (behåll första förekomsten).
    const [mall2] = await db.insert(importTemplates).values({
      tenantId: TENANT, name: `${NS}-mall2`, fieldIds: [kanon.id, other.id, falt.id],
    }).returning();

    const del = await req("DELETE", `/api/metadata/types/${falt.id}`, { userId: ADMIN });
    expect(del.status).toBe(409);
    expect(del.body.code).toBe("IMPORT_FIELD_IN_USE");
    expect(del.body.usage.configRefCount).toBe(2);

    const merge = await req("POST", `/api/metadata/types/${falt.id}/merge-into`, {
      userId: ADMIN,
      body: { targetId: kanon.id, confirmUsage: 0 },
    });
    expect(merge.status).toBe(200);
    const [m1] = await db.select().from(importTemplates).where(eq(importTemplates.id, mall1.id));
    expect(m1.fieldIds).toEqual([other.id, kanon.id]);
    const [m2] = await db.select().from(importTemplates).where(eq(importTemplates.id, mall2.id));
    expect(m2.fieldIds).toEqual([kanon.id, other.id]);
  });

  it("blockerar arkivering när ett metadata-editorfält pekar på fältet; merge repointar editor + pending-snapshot", async () => {
    const falt = await insertKatalog({ namn: `${NS}-arch-editor`, kategori: "import" });
    const kanon = await insertKatalog({ namn: `${NS}-editor-kanon`, kategori: null });
    const [editor] = await db.insert(metadataEditors).values({
      tenantId: TENANT,
      name: `${NS}-editor`,
      type: "object_specific",
      reporterConfig: {} as any,
    }).returning();
    const [ef] = await db.insert(metadataEditorFields).values({
      tenantId: TENANT,
      editorId: editor.id,
      kind: "text",
      label: "Testfält",
      metadataKatalogId: falt.id,
    }).returning();
    const [pendingSub] = await db.insert(metadataEditorSubmissions).values({
      tenantId: TENANT, editorId: editor.id, objectId: OBJ_1, status: "pending",
    }).returning();
    const [approvedSub] = await db.insert(metadataEditorSubmissions).values({
      tenantId: TENANT, editorId: editor.id, objectId: OBJ_1, status: "approved",
    }).returning();
    const [pendingVal] = await db.insert(metadataEditorSubmissionValues).values({
      tenantId: TENANT, submissionId: pendingSub.id, fieldId: ef.id, metadataKatalogId: falt.id,
    }).returning();
    const [approvedVal] = await db.insert(metadataEditorSubmissionValues).values({
      tenantId: TENANT, submissionId: approvedSub.id, fieldId: ef.id, metadataKatalogId: falt.id,
    }).returning();

    // Arkivering blockeras — editorfältet + pending-snapshot räknas som användning.
    const del = await req("DELETE", `/api/metadata/types/${falt.id}`, { userId: ADMIN });
    expect(del.status).toBe(409);
    expect(del.body.code).toBe("IMPORT_FIELD_IN_USE");
    expect(del.body.usage.configRefCount).toBe(2);

    // Merge mot kanoniskt fält repointar editorfältet + pending-snapshot,
    // men lämnar godkänd inlämnings snapshot orörd (historik).
    const merge = await req("POST", `/api/metadata/types/${falt.id}/merge-into`, {
      userId: ADMIN,
      body: { targetId: kanon.id, confirmUsage: 0 },
    });
    expect(merge.status).toBe(200);
    const [efAfter] = await db.select().from(metadataEditorFields).where(eq(metadataEditorFields.id, ef.id));
    expect(efAfter.metadataKatalogId).toBe(kanon.id);
    const [pvAfter] = await db.select().from(metadataEditorSubmissionValues).where(eq(metadataEditorSubmissionValues.id, pendingVal.id));
    expect(pvAfter.metadataKatalogId).toBe(kanon.id);
    const [avAfter] = await db.select().from(metadataEditorSubmissionValues).where(eq(metadataEditorSubmissionValues.id, approvedVal.id));
    expect(avAfter.metadataKatalogId).toBe(falt.id);
  });

  it("tillåter arkivering av helt oanvänt importskapat fält; listan visar konfig-referenser", async () => {
    const oanvant = await insertKatalog({ namn: `${NS}-arch-fri`, kategori: "import" });

    // Listan inkluderar configRefCount i usageTotal
    const list = await req("GET", "/api/metadata/types/import-created", { userId: ADMIN });
    const otl = (list.body as any[]).find((r) => r.namn === `${NS}-arch-otl`);
    expect(otl.configRefCount).toBe(1);
    expect(otl.usageTotal).toBe(1);

    const res = await req("DELETE", `/api/metadata/types/${oanvant.id}`, { userId: ADMIN });
    expect(res.status).toBe(204);
    const [row] = await db.select().from(metadataKatalog).where(eq(metadataKatalog.id, oanvant.id));
    expect(row.deletedAt).not.toBeNull();
  });
});
