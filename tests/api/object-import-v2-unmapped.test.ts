import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { registerObjectImportV2Routes } from "../../server/routes/objectImportV2Routes";
import { requireTenantWithFallback } from "../../server/tenant-middleware";
import { db } from "../../server/db";
import { tenants, users, userTenantRoles, metadataKatalog, metadataVarden, metadataHistorik, objects, objectImportSessions, objectImportRows, importBatches, importActions } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";

// Task #1478 — omatchade kolumner får aldrig tappas tyst:
//  1. Upload auto-matchar mot tenantens metadata-katalog (namn + synonymer).
//  2. Validate-summary listar kolumner med data utan mappning (unmapped_columns);
//     explicit ignorerade (__empty) och auto-ignorerade (Släktnamn) flaggas INTE.
//  3. Mappade metadatamål vars enda katalograd är arkiverad listas i
//     archived_metadata_fields.

let baseUrl = "";
let server: any;
let originalNodeEnv: string | undefined;

const NS = `oiv2u-${Date.now()}`;
const TENANT = `${NS}-tenant`;
const ADMIN = `${NS}-admin`;

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api/import/objects-v2${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user-id": ADMIN },
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
  // Minimal fel-middleware (speglar appens globala): AppError → JSON med message.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err?.statusCode ?? err?.status ?? 500).json({ message: err?.message ?? "Internt fel" });
  });

  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await db.insert(tenants).values({ id: TENANT, name: "OIV2 Unmapped Test", subdomain: TENANT }).onConflictDoNothing();
  await db.insert(users).values({ id: ADMIN, email: `${ADMIN}@test.local` }).onConflictDoNothing();
  await db
    .insert(userTenantRoles)
    .values({ userId: ADMIN, tenantId: TENANT, role: "admin", isActive: true, assignedBy: ADMIN })
    .onConflictDoNothing();

  // Katalog: aktivt "Typ" + ENBART arkiverat "Objekttyp".
  await db.insert(metadataKatalog).values([
    { tenantId: TENANT, namn: "Typ", datatyp: "string", kategori: "test" },
    { tenantId: TENANT, namn: "Tömningsdag", datatyp: "string", kategori: "test" },
    { tenantId: TENANT, namn: "Butiksnummer", datatyp: "string", kategori: "test" },
    { tenantId: TENANT, namn: "Objekttyp", datatyp: "string", kategori: "test", deletedAt: new Date() },
    // Arkiverad KLON av aktiva "Typ" — får aldrig skuggas fram eller dubbleras.
    { tenantId: TENANT, namn: "Typ", datatyp: "string", kategori: "test", deletedAt: new Date() },
  ]);
});

afterAll(async () => {
  await db.delete(metadataHistorik).where(eq(metadataHistorik.tenantId, TENANT));
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(importActions).where(eq(importActions.tenantId, TENANT));
  await db.delete(importBatches).where(eq(importBatches.tenantId, TENANT));
  await db.delete(objectImportRows).where(eq(objectImportRows.tenantId, TENANT));
  await db.delete(objectImportSessions).where(eq(objectImportSessions.tenantId, TENANT));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(userTenantRoles).where(eq(userTenantRoles.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
  await db.delete(users).where(eq(users.id, ADMIN));
  await new Promise<void>((r) => server.close(() => r()));
  process.env.NODE_ENV = originalNodeEnv;
});

describe("Import 2.0 — omatchade kolumner tappas aldrig tyst (Task #1478)", () => {
  it("auto-matchar kundrubriker mot tenantens katalog och flaggar bara äkta omatchade", async () => {
    const upload = await api("POST", "/upload", {
      fileName: "test.xlsx",
      matrix: [
        ["Objektnamn", "Objekt typ", "Butik", "Tömningsdag", "Släktnamn", "Pantkärl", "Tomkolumn"],
        ["Butik A", "Butik", "12", "Måndag", "A > B", "3", ""],
        ["Butik B", "Kiosk", "14", "Tisdag", "A > C", "5", ""],
      ],
    });
    expect(upload.status).toBe(200);
    const cols = upload.body.columns as Array<{ index: number; header: string; autoMatch: string | null }>;
    const byHeader = new Map(cols.map((c) => [c.header, c.autoMatch]));
    expect(byHeader.get("Objektnamn")).toBe("name");
    expect(byHeader.get("Objekt typ")).toBe("metadata.Typ"); // synonym → aktivt katalogfält
    expect(byHeader.get("Butik")).toBe("metadata.Butiksnummer");
    expect(byHeader.get("Tömningsdag")).toBe("metadata.Tömningsdag");
    expect(byHeader.get("Släktnamn")).toBe("__empty"); // auto-ignorerad
    expect(byHeader.get("Pantkärl")).toBeNull(); // finns ej i katalogen → omatchad
    // Auto-ignorerad kolumn persisteras som explicit __empty-mappning.
    expect(upload.body.mappings["4"]).toMatchObject({ target: "__empty" });

    const sessionId = upload.body.session_id as string;
    const validate = await api("POST", `/${sessionId}/validate`, {});
    expect(validate.status).toBe(200);
    const summary = validate.body.summary;
    // Endast Pantkärl (data + ingen mappning) — inte Släktnamn (__empty) och
    // inte Tomkolumn (ingen data).
    expect(summary.unmapped_columns).toEqual([{ index: 5, header: "Pantkärl" }]);
    expect(summary.archived_metadata_fields).toEqual([]);
  });

  it("flaggar mappade metadatamål vars enda katalograd är arkiverad", async () => {
    const upload = await api("POST", "/upload", {
      fileName: "test2.xlsx",
      matrix: [
        ["Objektnamn", "Egen kolumn"],
        ["Butik A", "Butik"],
      ],
    });
    const sessionId = upload.body.session_id as string;
    // Mappa kolumn 1 manuellt till det arkiverade fältet Objekttyp.
    const put = await api("PUT", `/${sessionId}/mappings`, {
      mappings: {
        "0": { target: "name", type: "standard", required: true },
        "1": { target: "metadata.Objekttyp", type: "metadata" },
      },
    });
    expect(put.status).toBe(200);
    const validate = await api("POST", `/${sessionId}/validate`, {});
    expect(validate.status).toBe(200);
    expect(validate.body.summary.unmapped_columns).toEqual([]);
    expect(validate.body.summary.archived_metadata_fields).toEqual(["Objekttyp"]);
  });

  it("rensar tidigare valideringsresultat när mappningar sparas om", async () => {
    const upload = await api("POST", "/upload", {
      fileName: "test3.xlsx",
      matrix: [
        ["Objektnamn"],
        ["Butik A"],
      ],
    });
    const sessionId = upload.body.session_id as string;
    await api("POST", `/${sessionId}/validate`, {});
    const before = await api("GET", `/${sessionId}/validation`);
    expect(before.body.summary).toBeTruthy();
    await api("PUT", `/${sessionId}/mappings`, {
      mappings: { "0": { target: "name", type: "standard", required: true } },
    });
    const after = await api("GET", `/${sessionId}/validation`);
    expect(after.body.summary ?? null).toBeNull();
  });

  it("execute avvisas utan aktuell validering och utan kvitto på omatchade kolumner", async () => {
    const upload = await api("POST", "/upload", {
      fileName: "test5.xlsx",
      matrix: [
        ["Objektnamn", "Pantkärl"],
        ["Butik X", "3"],
      ],
    });
    const sessionId = upload.body.session_id as string;
    await api("PUT", `/${sessionId}/mappings`, {
      mappings: { "0": { target: "name", type: "standard", required: true } },
    });
    // 1. Ingen validering körd (PUT rensade den) → execute avvisas.
    const noVal = await api("POST", `/${sessionId}/execute`, {});
    expect(noVal.status).toBe(400);

    // 2. Validering flaggar Pantkärl som omatchad med data → execute utan kvitto avvisas.
    await api("POST", `/${sessionId}/validate`, {});
    const noAck = await api("POST", `/${sessionId}/execute`, {});
    expect(noAck.status).toBe(400);
    expect(String(noAck.body?.message ?? "")).toContain("Pantkärl");

    // 3. Ny mappningssparning invaliderar valideringen igen — kvitto räcker inte.
    await api("PUT", `/${sessionId}/mappings`, {
      mappings: { "0": { target: "name", type: "standard", required: true } },
    });
    const staleAck = await api("POST", `/${sessionId}/execute`, { acknowledgeUnmappedColumns: true });
    expect(staleAck.status).toBe(400);

    // 4. Race-scenariot: mappningarna ändras UTAN att valideringen rensas
    //    (simulerar PUT som interfolieras med validate). Snapshot-checken i
    //    execute måste avvisa den inaktuella valideringen.
    await api("POST", `/${sessionId}/validate`, {});
    await db
      .update(objectImportSessions)
      .set({
        mappings: {
          "0": { target: "name", type: "standard", required: true },
          "1": { target: "metadata.Typ", type: "metadata" },
        } as any,
      })
      .where(eq(objectImportSessions.id, sessionId));
    const stale = await api("POST", `/${sessionId}/execute`, { acknowledgeUnmappedColumns: true });
    expect(stale.status).toBe(400);
    expect(String(stale.body?.message ?? "")).toContain("äldre mappningar");

    // 5. Färsk validering + uttryckligt kvitto → execute accepteras.
    await api("POST", `/${sessionId}/validate`, {});
    const ok = await api("POST", `/${sessionId}/execute`, { acknowledgeUnmappedColumns: true });
    expect(ok.status).toBe(202);
  });

  it("strikt gate (Task #1494): okänt metadatafält och datatypfel blockerar importen", async () => {
    const upload = await api("POST", "/upload", {
      fileName: "strict.xlsx",
      matrix: [
        ["Objektnamn", "Okänt fält", "Antal"],
        ["Butik S", "x", "tjugoåtta"],
      ],
    });
    const sessionId = upload.body.session_id as string;

    // Heltalsfält för datatypkollen.
    await db.insert(metadataKatalog).values([
      { tenantId: TENANT, namn: "Antal kärl", datatyp: "heltal", kategori: "test" },
    ]);

    await api("PUT", `/${sessionId}/mappings`, {
      mappings: {
        "0": { target: "name", type: "standard", required: true },
        "1": { target: "metadata.Finns Ej I Katalogen", type: "metadata" },
        "2": { target: "metadata.Antal kärl", type: "metadata" },
      },
    });
    const validate = await api("POST", `/${sessionId}/validate`, {});
    expect(validate.status).toBe(200);
    const errs = validate.body.summary.column_errors as Array<{ index: number; header: string; message: string }>;
    // Okänt katalogfält → blockerande kolumnfel med den exakta frasen.
    expect(errs.some((e) => e.index === 1 && e.message.includes("Ingen matchning"))).toBe(true);
    // Datatypfel ("tjugoåtta" mot Heltal) → radfel som gör raden ogiltig.
    const rows = validate.body.rows as Array<{ status: string; issues: Array<{ field: string; severity: string }> }>;
    expect(rows[0].status).toBe("invalid");
    expect(rows[0].issues.some((i) => i.field === "metadata.Antal kärl" && i.severity === "error")).toBe(true);

    // Execute stoppas av kolumnfelen — inga fält skapas tyst.
    const exec = await api("POST", `/${sessionId}/execute`, {});
    expect(exec.status).toBe(400);
    expect(String(exec.body?.message ?? "")).toContain("Kolumnmatchningen är inte giltig");
    const created = await db
      .select()
      .from(metadataKatalog)
      .where(and(eq(metadataKatalog.tenantId, TENANT), eq(metadataKatalog.namn, "Finns Ej I Katalogen")));
    expect(created).toHaveLength(0);
  });

  it("strikt gate (Task #1494): två kolumner mot samma singelvärdesfält blockerar", async () => {
    const upload = await api("POST", "/upload", {
      fileName: "dup.xlsx",
      matrix: [
        ["Objektnamn", "T1", "T2"],
        ["Butik D", "Måndag", "Tisdag"],
      ],
    });
    const sessionId = upload.body.session_id as string;
    await api("PUT", `/${sessionId}/mappings`, {
      mappings: {
        "0": { target: "name", type: "standard", required: true },
        "1": { target: "metadata.Tömningsdag", type: "metadata" },
        "2": { target: "metadata.Tömningsdag", type: "metadata" },
      },
    });
    const validate = await api("POST", `/${sessionId}/validate`, {});
    const errs = validate.body.summary.column_errors as Array<{ index: number; message: string }>;
    expect(errs.map((e) => e.index).sort()).toEqual([1, 2]);
    expect(errs[0].message).toContain("samma fält");
    const exec = await api("POST", `/${sessionId}/execute`, {});
    expect(exec.status).toBe(400);
  });

  it("execute återställer arkiverat fält och skriver till aktiv rad när arkiverad klon finns", async () => {
    const upload = await api("POST", "/upload", {
      fileName: "test4.xlsx",
      matrix: [
        ["Objektnamn", "Interimsnummer", "A", "B"],
        ["Restore-butik", "9001", "Kiosk", "Blå"],
      ],
    });
    const sessionId = upload.body.session_id as string;
    await api("PUT", `/${sessionId}/mappings`, {
      mappings: {
        "0": { target: "name", type: "standard", required: true },
        "1": { target: "interim_id", type: "standard" },
        "2": { target: "metadata.Objekttyp", type: "metadata" }, // enbart arkiverad → återställs
        "3": { target: "metadata.Typ", type: "metadata" }, // aktiv + arkiverad klon → aktiv används
      },
    });
    await api("POST", `/${sessionId}/validate`, {});
    // Task #1494: arkiverade metadata-mål återställs ALDRIG tyst — utan det
    // uttryckliga valet stoppas importen.
    const blocked = await api("POST", `/${sessionId}/execute`, {});
    expect(blocked.status).toBe(400);
    expect(String(blocked.body?.message ?? "")).toContain("Arkiverade metadatafält");
    const exec = await api("POST", `/${sessionId}/execute`, { restoreArchivedMetadataFields: true });
    expect(exec.status).toBe(202);
    for (let i = 0; i < 50; i++) {
      const st = await api("GET", `/${sessionId}/status`);
      if (st.body.status === "completed" || st.body.status === "failed") break;
      await new Promise((r) => setTimeout(r, 150));
    }
    const result = await api("GET", `/${sessionId}/result`);
    expect(result.body?.status).toBe("completed");

    // "Objekttyp" har återställts (avarkiverats) — exakt en aktiv rad.
    const objekttyp = await db
      .select()
      .from(metadataKatalog)
      .where(and(eq(metadataKatalog.tenantId, TENANT), eq(metadataKatalog.namn, "Objekttyp")));
    expect(objekttyp.filter((k) => k.deletedAt == null)).toHaveLength(1);

    // "Typ": fortfarande exakt EN aktiv rad (klonen förblir arkiverad, ingen dubblett).
    const typ = await db
      .select()
      .from(metadataKatalog)
      .where(and(eq(metadataKatalog.tenantId, TENANT), eq(metadataKatalog.namn, "Typ")));
    expect(typ.filter((k) => k.deletedAt == null)).toHaveLength(1);
    const aktivTyp = typ.find((k) => k.deletedAt == null)!;

    // Värdet skrevs mot den AKTIVA Typ-raden (inte den arkiverade klonen).
    const varden = await db
      .select()
      .from(metadataVarden)
      .where(and(eq(metadataVarden.tenantId, TENANT), eq(metadataVarden.metadataKatalogId, aktivTyp.id)));
    expect(varden.some((v) => v.vardeString === "Blå")).toBe(true);
  });
});
