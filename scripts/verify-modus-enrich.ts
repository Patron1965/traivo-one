/**
 * Task #244 — Verifiering: kör verklig Modus-fil från Kinab mot
 * berika-flödet och rapportera matchningsfrekvens, fält-täckning
 * och resulterande datakvalitet.
 *
 * Körs med:
 *   tsx scripts/verify-modus-enrich.ts <csv-file> [--apply]
 *
 * Utan --apply körs bara preview (ingen DB-skrivning).
 * Med --apply seedar standardtyper och skriver metadata-värden i en
 * enrich-modus-batch precis som /api/import/modus/objects/enrich/apply.
 */

import { readFileSync } from "fs";
import path from "path";
import Papa from "papaparse";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "../server/db";
import {
  objects,
  metadataKatalog,
  metadataVarden,
  importBatches,
  auditLogs,
} from "../shared/schema";
import {
  KARL_METADATA_DEFINITIONS,
  seedKarlMetadataTypes,
  getAllMetadataTypes,
  createMetadata,
  updateMetadata,
} from "../server/metadata-queries";

const TENANT_ID = "kinab";

function parseCsv(filePath: string): Record<string, string>[] {
  const csvText = readFileSync(filePath, "utf-8");
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    delimiter: ";",
  });
  if (result.errors.length > 0) {
    console.warn(`CSV-varningar (${result.errors.length}):`, result.errors[0]);
  }
  return result.data;
}

function autoDetectMetadataColumns(rows: Record<string, string>[]) {
  const cols: { csvColumn: string; metadataName: string }[] = [];
  const seen = new Set<string>();
  const firstRow = rows[0];
  if (!firstRow) return cols;
  for (const key of Object.keys(firstRow)) {
    if (key.startsWith("Metadata - ")) {
      const name = key.replace("Metadata - ", "").trim();
      if (name && !seen.has(name.toLowerCase())) {
        cols.push({ csvColumn: key, metadataName: name });
        seen.add(name.toLowerCase());
      }
    }
  }
  return cols;
}

async function baselineCoverage() {
  const [{ total }] = await db.execute<any>(sql`
    SELECT COUNT(*)::int AS total FROM objects
    WHERE tenant_id = ${TENANT_ID} AND object_type = 'karl' AND deleted_at IS NULL
  `).then((r: any) => r.rows ?? r);
  return { karlTotal: Number(total) };
}

async function metadataCoverage(typeNames: string[]) {
  if (typeNames.length === 0) return {} as Record<string, number>;
  const types = await db
    .select({ id: metadataKatalog.id, namn: metadataKatalog.namn })
    .from(metadataKatalog)
    .where(and(eq(metadataKatalog.tenantId, TENANT_ID), inArray(metadataKatalog.namn, typeNames)));
  const coverage: Record<string, number> = {};
  for (const t of types) {
    const rows = await db.execute<any>(sql`
      SELECT COUNT(DISTINCT v.objekt_id)::int AS c
      FROM metadata_varden v
      JOIN objects o ON o.id = v.objekt_id
      WHERE v.tenant_id = ${TENANT_ID}
        AND v.metadata_katalog_id = ${t.id}
        AND o.object_type = 'karl'
        AND o.deleted_at IS NULL
    `).then((r: any) => r.rows ?? r);
    coverage[t.namn] = Number(rows[0]?.c ?? 0);
  }
  return coverage;
}

async function runPreview(csvPath: string) {
  const rows = parseCsv(csvPath);
  const detected = autoDetectMetadataColumns(rows);

  // Räkna kärl per ObjectType i CSV
  const typeCounts = new Map<string, number>();
  for (const r of rows) {
    const t = (r["Typ"] || "").trim();
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
  }

  // Match mot DB
  const modusIds = new Set<string>();
  for (const r of rows) {
    const id = (r["Id"] || "").replace(/\s/g, "");
    if (id) modusIds.add(id);
  }
  const objectNumbers = Array.from(modusIds).flatMap((id) => [`MODUS-${id}`, id]);
  const CHUNK = 5000;
  const matched: Array<{ id: string; objectNumber: string | null; type: string | null }> = [];
  for (let i = 0; i < objectNumbers.length; i += CHUNK) {
    const slice = objectNumbers.slice(i, i + CHUNK);
    const partial = await db
      .select({ id: objects.id, objectNumber: objects.objectNumber, type: objects.objectType })
      .from(objects)
      .where(
        and(
          eq(objects.tenantId, TENANT_ID),
          inArray(objects.objectNumber, slice),
          isNull(objects.deletedAt),
        ),
      );
    matched.push(...partial);
  }

  const matchedKarl = matched.filter((m) => m.type === "karl").length;
  const matchedTotal = matched.length;

  // Hur många matchningar per metadata-fält (har faktiskt värde)
  const perFieldRowsWithValue = new Map<string, number>();
  for (const c of detected) perFieldRowsWithValue.set(c.metadataName, 0);
  const matchedIds = new Set(matched.map((m) => m.objectNumber!.replace(/^MODUS-/, "")));
  for (const r of rows) {
    const id = (r["Id"] || "").replace(/\s/g, "");
    if (!matchedIds.has(id)) continue;
    for (const c of detected) {
      const v = (r[c.csvColumn] || "").trim();
      if (v) perFieldRowsWithValue.set(c.metadataName, (perFieldRowsWithValue.get(c.metadataName) || 0) + 1);
    }
  }

  const seededTypeNames = KARL_METADATA_DEFINITIONS.map((d) => d.namn);
  const detectedNamesLc = new Set(detected.map((d) => d.metadataName.toLowerCase()));
  const matchedSeededTypes = seededTypeNames.filter((n) => detectedNamesLc.has(n.toLowerCase()));
  const missingSeededTypes = seededTypeNames.filter((n) => !detectedNamesLc.has(n.toLowerCase()));

  console.log("============================================================");
  console.log("PREVIEW (Task #244)");
  console.log("Fil:", path.basename(csvPath));
  console.log("CSV-rader totalt:", rows.length);
  console.log("CSV-rader per Typ:");
  for (const [t, n] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${t || "(tomt)"}: ${n}`);
  }
  console.log("Unika MODUS-id i CSV:", modusIds.size);
  console.log("Matchade objekt i Kinab-DB:", matchedTotal);
  console.log("  varav kärl:", matchedKarl);
  console.log("Matchade rader / unika MODUS-id:", `${((matchedTotal / modusIds.size) * 100).toFixed(1)}%`);
  console.log();
  console.log(`Auto-detekterade Metadata-kolumner i CSV (${detected.length}):`);
  for (const c of detected) {
    const filled = perFieldRowsWithValue.get(c.metadataName) || 0;
    console.log(`  - ${c.csvColumn} -> "${c.metadataName}"  (rader m. värde bland matchade: ${filled})`);
  }
  console.log();
  console.log("Standardtyper (seed-types):");
  console.log("  matchar CSV-kolumn:", matchedSeededTypes.length ? matchedSeededTypes.join(", ") : "(inga)");
  console.log("  saknas i CSV:", missingSeededTypes.length ? missingSeededTypes.join(", ") : "(inga)");
  console.log("============================================================");

  return { rows, detected, matched, modusIds, matchedSeededTypes };
}

async function runApply(csvPath: string) {
  const rows = parseCsv(csvPath);
  const detected = autoDetectMetadataColumns(rows);

  console.log("\n[apply] Seedar standardtyper för kärl…");
  const seedRes = await seedKarlMetadataTypes(TENANT_ID);
  console.log("  skapade:", seedRes.created.length ? seedRes.created.join(", ") : "(inga)");
  console.log("  fanns redan:", seedRes.existing.length ? seedRes.existing.join(", ") : "(inga)");

  const allTypes = await getAllMetadataTypes(TENANT_ID);
  const typeByName = new Map(allTypes.map((t) => [t.namn.toLowerCase(), t]));

  const modusIds = new Set<string>();
  for (const r of rows) {
    const id = (r["Id"] || "").replace(/\s/g, "");
    if (id) modusIds.add(id);
  }
  const objectNumbers = Array.from(modusIds).flatMap((id) => [`MODUS-${id}`, id]);
  const APPLY_CHUNK = 5000;
  const matchedObjs: Array<{ id: string; objectNumber: string | null }> = [];
  for (let i = 0; i < objectNumbers.length; i += APPLY_CHUNK) {
    const slice = objectNumbers.slice(i, i + APPLY_CHUNK);
    const partial = await db
      .select({ id: objects.id, objectNumber: objects.objectNumber })
      .from(objects)
      .where(
        and(
          eq(objects.tenantId, TENANT_ID),
          inArray(objects.objectNumber, slice),
          isNull(objects.deletedAt),
        ),
      );
    matchedObjs.push(...partial);
  }

  const modusToObjectId = new Map<string, string>();
  for (const o of matchedObjs) {
    if (!o.objectNumber) continue;
    modusToObjectId.set(o.objectNumber.replace(/^MODUS-/, ""), o.id);
  }

  const batchId = `enrich-modus-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const baseMetadata = {
    type: "enrich-modus" as const,
    metadataColumns: detected.map((c) => c.metadataName),
    startedBy: "verify-script",
    startedAt,
  };

  await db.insert(importBatches).values({
    tenantId: TENANT_ID,
    batchId,
    totalRows: rows.length,
    created: 0,
    updated: 0,
    errors: 0,
    metadata: { ...baseMetadata, status: "in_progress" },
  });

  // Förladda existerande metadata för matchade objekt + relevanta typer
  const matchedObjectIds = Array.from(new Set(matchedObjs.map((o) => o.id)));
  const typeIds = detected
    .map((c) => typeByName.get(c.metadataName.toLowerCase())?.id)
    .filter((x): x is string => !!x);

  type ExistingRow = { id: string; objektId: string; metadataKatalogId: string; display: string | null };
  const existingByKey = new Map<string, ExistingRow>();
  if (matchedObjectIds.length && typeIds.length) {
    const existing = await db
      .select()
      .from(metadataVarden)
      .where(
        and(
          eq(metadataVarden.tenantId, TENANT_ID),
          inArray(metadataVarden.objektId, matchedObjectIds),
          inArray(metadataVarden.metadataKatalogId, typeIds),
        ),
      );
    for (const v of existing) {
      if (!v.objektId) continue;
      const display =
        v.vardeString ??
        (v.vardeInteger != null ? String(v.vardeInteger) : null) ??
        (v.vardeDecimal != null ? String(v.vardeDecimal) : null) ??
        (v.vardeBoolean != null ? String(v.vardeBoolean) : null) ??
        (v.vardeReferens ?? null);
      existingByKey.set(`${v.objektId}::${v.metadataKatalogId}`, {
        id: v.id,
        objektId: v.objektId,
        metadataKatalogId: v.metadataKatalogId,
        display,
      });
    }
  }

  let created = 0,
    updated = 0,
    unchanged = 0,
    unmatched = 0,
    invalidId = 0,
    matchedRowCount = 0;
  const errors: string[] = [];
  const uniqueMatchedObjects = new Set<string>();
  const auditBatch: any[] = [];
  const FLUSH_AT = 500;
  const skippedPerField = new Map<string, number>();

  async function flushAudit() {
    if (auditBatch.length === 0) return;
    await db.insert(auditLogs).values(auditBatch.splice(0, auditBatch.length));
  }

  let rowIdx = 0;
  for (const row of rows) {
    rowIdx++;
    if (rowIdx % 5000 === 0) {
      console.log(
        `  [progress] rad ${rowIdx}/${rows.length}  match=${matchedRowCount}  created=${created} updated=${updated} unchanged=${unchanged}`,
      );
    }
    const modusId = (row["Id"] || "").replace(/\s/g, "");
    if (!modusId) {
      invalidId++;
      continue;
    }
    const objectId = modusToObjectId.get(modusId);
    if (!objectId) {
      unmatched++;
      continue;
    }
    matchedRowCount++;
    uniqueMatchedObjects.add(objectId);

    for (const c of detected) {
      const type = typeByName.get(c.metadataName.toLowerCase());
      if (!type) {
        skippedPerField.set(c.metadataName, (skippedPerField.get(c.metadataName) || 0) + 1);
        continue;
      }
      const raw = (row[c.csvColumn] || "").trim();
      if (!raw) continue;
      const key = `${objectId}::${type.id}`;
      const existing = existingByKey.get(key);
      try {
        if (!existing) {
          const newRow = await createMetadata({
            tenantId: TENANT_ID,
            objektId: objectId,
            metadataTypNamn: type.namn,
            varde: raw,
            skapadAv: "modus-enrich",
            metod: "modus-enrich",
          });
          existingByKey.set(key, {
            id: newRow.id,
            objektId: objectId,
            metadataKatalogId: type.id,
            display: raw,
          });
          created++;
          auditBatch.push({
            tenantId: TENANT_ID,
            userId: null,
            action: "enrich_modus",
            resourceType: "object_metadata",
            resourceId: newRow.id,
            changes: { before: null, after: { metadataKatalogId: type.id, metadataNamn: type.namn, value: raw } },
            metadata: { batchId, objectId, source: "modus-enrich" },
          });
        } else if ((existing.display ?? "").trim() === raw) {
          unchanged++;
        } else {
          const beforeValue = existing.display;
          await updateMetadata(existing.id, raw, TENANT_ID, "modus-enrich", "modus-enrich");
          existing.display = raw;
          updated++;
          auditBatch.push({
            tenantId: TENANT_ID,
            userId: null,
            action: "enrich_modus",
            resourceType: "object_metadata",
            resourceId: existing.id,
            changes: {
              before: { value: beforeValue },
              after: { metadataKatalogId: type.id, metadataNamn: type.namn, value: raw },
            },
            metadata: { batchId, objectId, source: "modus-enrich" },
          });
        }
      } catch (err: any) {
        if (errors.length < 100) errors.push(`"${c.metadataName}" (MODUS-${modusId}): ${err.message || err}`);
      }
      if (auditBatch.length >= FLUSH_AT) await flushAudit();
    }
  }
  await flushAudit();

  await db
    .update(importBatches)
    .set({
      created,
      updated,
      errors: errors.length,
      metadata: {
        ...baseMetadata,
        status: "completed",
        unchanged,
        unmatchedCount: unmatched,
        invalidIdCount: invalidId,
        matchedRowCount,
        uniqueMatchedObjectCount: uniqueMatchedObjects.size,
        finishedAt: new Date().toISOString(),
      },
    })
    .where(and(eq(importBatches.batchId, batchId), eq(importBatches.tenantId, TENANT_ID)));

  console.log("\n============================================================");
  console.log("APPLY (Task #244)");
  console.log("BatchId:", batchId);
  console.log("Totala rader:", rows.length);
  console.log("Matchade rader:", matchedRowCount);
  console.log("Unika berikade kärl/objekt:", uniqueMatchedObjects.size);
  console.log("Skapade metadata-värden:", created);
  console.log("Uppdaterade:", updated);
  console.log("Oförändrade:", unchanged);
  console.log("Omatchade MODUS-id (rader):", unmatched);
  console.log("Saknat Id (rader):", invalidId);
  if (skippedPerField.size) {
    console.log("Skippade rader p.g.a. saknad metadatatyp i seed:");
    for (const [k, v] of [...skippedPerField.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  - ${k}: ${v}`);
    }
  }
  if (errors.length) console.log("Första fel:", errors.slice(0, 5));
  console.log("============================================================");

  return { batchId };
}

async function reportCoverage() {
  const baseline = await baselineCoverage();
  const cov = await metadataCoverage(KARL_METADATA_DEFINITIONS.map((d) => d.namn));
  console.log("\n--- Datakvalitet (kärl-täckning per standardtyp) ---");
  console.log(`Totalt antal kärl: ${baseline.karlTotal}`);
  for (const def of KARL_METADATA_DEFINITIONS) {
    const c = cov[def.namn] ?? 0;
    const pct = baseline.karlTotal ? ((c / baseline.karlTotal) * 100).toFixed(1) : "0.0";
    console.log(`  ${def.namn.padEnd(20)} ${String(c).padStart(6)}  (${pct}%)`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = args.find((a) => !a.startsWith("--"));
  const apply = args.includes("--apply");
  if (!csvPath) {
    console.error("Användning: tsx scripts/verify-modus-enrich.ts <csv> [--apply]");
    process.exit(2);
  }
  await runPreview(csvPath);
  await reportCoverage();
  if (apply) {
    await runApply(csvPath);
    await reportCoverage();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Fel:", err);
  process.exit(1);
});
