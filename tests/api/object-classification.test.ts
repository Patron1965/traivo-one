import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import { tenants, objects, metadataKatalog, metadataVarden, metadataHistorik } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { ensureSystemomradenFalt, createMetadata } from "../../server/metadata-queries";
import {
  backfillClassificationMetadata,
  mirrorClassificationToMetadata,
  getObjectHookClassification,
  syncClassificationColumns,
} from "../../server/services/object-classification";
import { storage } from "../../server/storage";
import { copyObjectTree } from "../../server/services/object-copy";

// Task #1484: objekttyp/nivå som metadata (expand-fas).
// Verifierar mot dev-DB:n:
//  1) ensureSystemomradenFalt etablerar Objekttyp/Anläggningstyp (klassificering).
//  2) Backfill är idempotent, insert-only och hoppar över befintliga rader.
//  3) Fasthakningens klassificering läses metadata-först med kolumn-fallback.
//  4) Spegling kolumn→metadata skriver aldrig över en MANUELL rad.
//  5) Metadata→kolumn-synk är present-value-only.

const NS = `klass-${Date.now()}`;
const TENANT = `${NS}-tenant`;
let objA = ""; // har kolumnvärden, ingen metadata → backfill skapar
let objB = ""; // har MANUELL Objekttyp-metadata ≠ kolumn → metadata vinner
let objC = ""; // tomma/default-kolumner

async function createObj(name: string, cols: Partial<{ objectType: string; hierarchyLevel: string }>): Promise<string> {
  const [row] = await db.insert(objects).values({
    tenantId: TENANT,
    name,
    objectNumber: `${NS}-${name}`,
    ...(cols as any),
  } as any).returning({ id: objects.id });
  return row.id;
}

beforeAll(async () => {
  await db.insert(tenants).values({ id: TENANT, name: TENANT } as any);
  const ensured = await ensureSystemomradenFalt(TENANT);
  expect([...ensured.created, ...ensured.adopted, ...ensured.alreadyOk]).toEqual(
    expect.arrayContaining(["Objekttyp", "Anläggningstyp"]),
  );
  objA = await createObj("A", { objectType: "fastighet", hierarchyLevel: "fastighet" });
  objB = await createObj("B", { objectType: "omrade", hierarchyLevel: "brf" });
  objC = await createObj("C", {});
});

afterAll(async () => {
  // Vänta ut ev. kvarvarande uppskjutna speglingar (retry-fönster) innan städning,
  // och städa ALLT tenant-scopat (även objekt från fallerade deltester) så att
  // tenant-raderingen aldrig faller på FK-rester.
  await new Promise((r) => setTimeout(r, 2500));
  await db.delete(metadataHistorik).where(eq(metadataHistorik.tenantId, TENANT));
  await db.delete(metadataVarden).where(eq(metadataVarden.tenantId, TENANT));
  await db.execute(sql`DELETE FROM object_parents WHERE tenant_id = ${TENANT}`);
  await db.delete(objects).where(eq(objects.tenantId, TENANT));
  await db.delete(metadataKatalog).where(eq(metadataKatalog.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
});

async function readMeta(objektId: string, namn: string): Promise<{ varde: string | null; metod: string | null } | null> {
  const rows = (await db.execute(sql`
    SELECT mv.varde_string AS varde, mv.metod
    FROM metadata_varden mv
    JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
    WHERE mv.tenant_id = ${TENANT} AND mv.objekt_id = ${objektId}
      AND lower(mk.namn) = ${namn.toLowerCase()}
      AND mv.status = 'aktiv' AND COALESCE(mv.raderad, FALSE) = FALSE
  `)).rows as any[];
  return rows[0] ?? null;
}

describe("Objektklassificering som metadata (Task #1484)", () => {
  it("backfill: dry-run skriver inget, skarp körning insert-only, idempotent", async () => {
    const dry = await backfillClassificationMetadata(TENANT, { dryRun: true });
    expect(dry.created).toBeGreaterThan(0);
    expect(await readMeta(objA, "Objekttyp")).toBeNull();

    const r1 = await backfillClassificationMetadata(TENANT, { dryRun: false });
    expect(r1.errors).toBe(0);
    const a = await readMeta(objA, "Objekttyp");
    expect(a?.varde).toBe("fastighet");
    expect(a?.metod).toBe("auto");
    expect((await readMeta(objA, "Anläggningstyp"))?.varde).toBe("fastighet");

    // Idempotent: andra körningen skapar inget nytt.
    const r2 = await backfillClassificationMetadata(TENANT, { dryRun: false });
    expect(r2.created).toBe(0);
    expect(r2.errors).toBe(0);
  });

  it("hook-klassificering: metadata-först, kolumn-fallback", async () => {
    // objB: manuell metadata "utrustning" ≠ kolumn "omrade" → metadata vinner.
    await createMetadata({
      tenantId: TENANT,
      objektId: objB,
      metadataTypNamn: "Objekttyp",
      varde: "utrustning",
      skapadAv: "test",
    });
    const b = await getObjectHookClassification(TENANT, objB, {
      objectType: "omrade",
      hierarchyLevel: "brf",
    });
    expect(b.objectType).toBe("utrustning");
    // Anläggningstyp saknar egen rad på objB (backfillades) → egen rad finns → "brf".
    expect(b.hierarchyLevel).toBe("brf");

    // objC: ingen metadata → kolumn-fallback.
    await db.delete(metadataVarden).where(and(eq(metadataVarden.tenantId, TENANT), eq(metadataVarden.objektId, objC)));
    const c = await getObjectHookClassification(TENANT, objC, {
      objectType: "omrade",
      hierarchyLevel: "fastighet",
    });
    expect(c.objectType).toBe("omrade");
    expect(c.hierarchyLevel).toBe("fastighet");
  });

  it("spegling kolumn→metadata skriver aldrig över manuell rad", async () => {
    await mirrorClassificationToMetadata(TENANT, objB, { objectType: "omrade" });
    expect((await readMeta(objB, "Objekttyp"))?.varde).toBe("utrustning"); // manuell vinner

    // objC saknar rad → auto-rad skapas; uppdateras vid nytt kolumnvärde.
    await mirrorClassificationToMetadata(TENANT, objC, { objectType: "rum" });
    expect((await readMeta(objC, "Objekttyp"))?.varde).toBe("rum");
    await mirrorClassificationToMetadata(TENANT, objC, { objectType: "karl" });
    const c = await readMeta(objC, "Objekttyp");
    expect(c?.varde).toBe("karl");
    expect(c?.metod).toBe("auto");
  });

  it("metadata→kolumn-synk är present-value-only", async () => {
    const updated = await syncClassificationColumns(TENANT, [objB, objC]);
    expect(updated).toBeGreaterThan(0);
    const [b] = await db.select().from(objects).where(eq(objects.id, objB));
    expect(b.objectType).toBe("utrustning"); // kolumn-cache följde metadatat
    const [c] = await db.select().from(objects).where(eq(objects.id, objC));
    expect(c.objectType).toBe("karl");
    // hierarchyLevel på objC saknar metadata → kolumnen orörd (default kvar).
    expect(c.hierarchyLevel).toBe("fastighet");
  });

  it("objekt kan skapas utan typ/nivå (defaults, ingen fabricerad metadata)", async () => {
    const created = await storage.createObject({ tenantId: TENANT, name: "utan-typ", objectNumber: `${NS}-D` } as any);
    // setImmediate-spegling: vänta ut eventloopen — inget ska ha speglats (fälten var ej satta).
    await new Promise((r) => setTimeout(r, 150));
    expect(await readMeta(created.id, "Objekttyp")).toBeNull();
    expect(created.objectType).toBe("omrade"); // kolumn-default (cache) kvar under expand
  });

  it("explicit satt typ vid create (även explicit objektnummer) speglas till metadata", async () => {
    const created = await storage.createObject({
      tenantId: TENANT,
      name: "med-typ",
      objectNumber: `${NS}-E`,
      objectType: "fastighet",
      hierarchyLevel: "brf",
    } as any);
    let t: Awaited<ReturnType<typeof readMeta>> = null;
    let a: Awaited<ReturnType<typeof readMeta>> = null;
    for (let i = 0; i < 24 && !(t && a); i++) {
      await new Promise((r) => setTimeout(r, 250));
      t = t ?? await readMeta(created.id, "Objekttyp");
      a = a ?? await readMeta(created.id, "Anläggningstyp");
    }
    expect(t?.varde).toBe("fastighet");
    expect(t?.metod).toBe("auto");
    expect(a?.varde).toBe("brf");
    // Städning sker tenant-brett i afterAll (efter att uppskjutna speglingar lugnat sig).
  });

  it("objekt skapat inuti transaktion speglas till metadata efter commit (tx-säker mirror)", async () => {
    const created = await db.transaction(async (tx) => {
      return await storage.createObject({
        tenantId: TENANT,
        name: "tx-skapad",
        objectNumber: `${NS}-TX`,
        objectType: "utrustning",
        hierarchyLevel: "fastighet",
      } as any, tx as any);
    });
    // Den uppskjutna speglingen pollar tills raden är committad (retry 2s).
    let t: Awaited<ReturnType<typeof readMeta>> = null;
    for (let i = 0; i < 20 && !t; i++) {
      await new Promise((r) => setTimeout(r, 250));
      t = await readMeta(created.id, "Objekttyp");
    }
    expect(t?.varde).toBe("utrustning");
    expect(t?.metod).toBe("auto");
    expect((await readMeta(created.id, "Anläggningstyp"))?.varde).toBe("fastighet");
    // Städning sker tenant-brett i afterAll (efter att uppskjutna speglingar lugnat sig).
  });

  it("objekt skapat i yttre tx UTAN objektnummer (auto-nummer) speglas efter commit", async () => {
    const created = await db.transaction(async (tx) => {
      return await storage.createObject({
        tenantId: TENANT,
        name: "tx-auto-nr",
        objectType: "rum",
        hierarchyLevel: "brf",
      } as any, tx as any);
    });
    expect(created.objectNumber).toMatch(/^OBJ-/);
    let t: Awaited<ReturnType<typeof readMeta>> = null;
    let a: Awaited<ReturnType<typeof readMeta>> = null;
    for (let i = 0; i < 24 && !(t && a); i++) {
      await new Promise((r) => setTimeout(r, 250));
      t = t ?? await readMeta(created.id, "Objekttyp");
      a = a ?? await readMeta(created.id, "Anläggningstyp");
    }
    expect(t?.varde).toBe("rum");
    expect(t?.metod).toBe("auto");
    expect(a?.varde).toBe("brf");
    // Städning sker tenant-brett i afterAll (efter att uppskjutna speglingar lugnat sig).
  });

  it("tenant UTAN katalogfälten: spegling självläker (skapar kanoniska systemfält, ej ad-hoc)", async () => {
    const T2 = `${NS}-tenant2`;
    await db.insert(tenants).values({ id: T2, name: T2 } as any);
    try {
      // Ingen ensureSystemomradenFalt körd för T2 — mirror ska etablera fälten själv.
      const [obj] = await db.insert(objects).values({
        tenantId: T2, name: "boot", objectNumber: `${NS}-BOOT`,
        objectType: "fastighet", hierarchyLevel: "brf",
      } as any).returning({ id: objects.id });
      await mirrorClassificationToMetadata(T2, obj.id, { objectType: "fastighet", hierarchyLevel: "brf" });

      const kat = (await db.execute(sql`
        SELECT namn, area, systemlast FROM metadata_katalog
        WHERE tenant_id = ${T2} AND deleted_at IS NULL AND lower(namn) IN ('objekttyp','anläggningstyp')
      `)).rows as any[];
      expect(kat.length).toBe(2);
      for (const k of kat) {
        expect(k.area).toBe("klassificering"); // kanonisk system-konfiguration, ej ad-hoc
        expect(k.systemlast).toBe(true);       // strukturlåst systemfält
      }
      const rows = (await db.execute(sql`
        SELECT mk.namn, mv.varde_string AS varde FROM metadata_varden mv
        JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
        WHERE mv.tenant_id = ${T2} AND mv.objekt_id = ${obj.id} AND mv.status='aktiv'
          AND lower(mk.namn) IN ('objekttyp','anläggningstyp')
      `)).rows as any[];
      expect(new Map(rows.map((r: any) => [r.namn.toLowerCase(), r.varde])).get("objekttyp")).toBe("fastighet");
      // Metadata-först fasthakning fungerar direkt.
      const c = await getObjectHookClassification(T2, obj.id, { objectType: "annat", hierarchyLevel: "annat" });
      expect(c.objectType).toBe("fastighet");
      expect(c.hierarchyLevel).toBe("brf");
    } finally {
      await new Promise((r) => setTimeout(r, 500));
      await db.execute(sql`DELETE FROM metadata_historik WHERE tenant_id = ${T2}`);
      await db.execute(sql`DELETE FROM metadata_varden WHERE tenant_id = ${T2}`);
      await db.execute(sql`DELETE FROM objects WHERE tenant_id = ${T2}`);
      await db.execute(sql`DELETE FROM metadata_katalog WHERE tenant_id = ${T2}`);
      await db.delete(tenants).where(eq(tenants.id, T2));
    }
  });

  it("kopiering: legacy-kolumn-källa får auto-metadata, manuell metadata-källa förblir kanonisk", async () => {
    const cleanupIds: string[] = [];
    const waitMeta = async (objektId: string, namn: string) => {
      let row: Awaited<ReturnType<typeof readMeta>> = null;
      for (let i = 0; i < 24 && !row; i++) {
        await new Promise((r) => setTimeout(r, 250));
        row = await readMeta(objektId, namn);
      }
      return row;
    };
    try {
      // Källa 1: enbart legacy-kolumner, ingen klassificerings-metadata.
      const legacySrc = await createObj("kopia-legacy-src", { objectType: "rum", hierarchyLevel: "brf" });
      cleanupIds.push(legacySrc);
      const r1 = await copyObjectTree(legacySrc, TENANT, "single" as any, { name: "kopia-legacy" });
      cleanupIds.push(...r1.createdIds);
      const t1 = await waitMeta(r1.rootId, "Objekttyp");
      expect(t1?.varde).toBe("rum");
      expect(t1?.metod).toBe("auto");
      expect((await readMeta(r1.rootId, "Anläggningstyp"))?.varde).toBe("brf");

      // Källa 2: MANUELL Objekttyp-metadata som avviker från kolumnen — kopian
      // ska behålla den manuella raden som kanonisk (mirror rör den aldrig).
      const manualSrc = await createObj("kopia-manuell-src", { objectType: "rum", hierarchyLevel: "brf" });
      cleanupIds.push(manualSrc);
      await createMetadata({
        tenantId: TENANT,
        objektId: manualSrc,
        metadataTypNamn: "Objekttyp",
        varde: "utrustning",
        skapadAv: "test",
      });
      const r2 = await copyObjectTree(manualSrc, TENANT, "single" as any, { name: "kopia-manuell" });
      cleanupIds.push(...r2.createdIds);
      // Vänta ut den uppskjutna speglingen och verifiera att manuellt värde står kvar.
      await new Promise((r) => setTimeout(r, 1500));
      const t2 = await waitMeta(r2.rootId, "Objekttyp");
      expect(t2?.varde).toBe("utrustning");
      // Exakt EN aktiv Objekttyp-rad (ingen auto-dubblett bredvid den kopierade).
      const cnt = (await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM metadata_varden mv
        JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
        WHERE mv.tenant_id = ${TENANT} AND mv.objekt_id = ${r2.rootId}
          AND lower(mk.namn) = 'objekttyp'
          AND mv.status = 'aktiv' AND COALESCE(mv.raderad, FALSE) = FALSE
      `)).rows as any[];
      expect(cnt[0].n).toBe(1);
    } finally {
      // Städning sker tenant-brett i afterAll (efter att uppskjutna speglingar lugnat sig).
      void cleanupIds;
    }
  });
});
