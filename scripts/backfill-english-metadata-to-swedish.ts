/**
 * scripts/backfill-english-metadata-to-swedish.ts
 *
 * Task #992 — Konsolidera metadata-systemen.
 *
 * Speglar lokala värden från det avvecklade ENGELSKA metadata-systemet
 * (metadata_definitions / object_metadata) till den kanoniska SVENSKA katalogen
 * (metadata_katalog / metadata_varden / metadata_historik) så att import,
 * objektläsning, villkorsfilter, arv och export kan läsa EN källa utan
 * round-trip-drift.
 *
 * Säkerhet & idempotens:
 *   - Migrerar ENDAST lokala engelska rader (object_metadata.inherited_from_object_id
 *     IS NULL). Svensk arv beräknas vid läsning, så ärvda speglingar behövs ej.
 *   - Skriver ALDRIG över ett befintligt svenskt lokalt värde (svenska systemet är
 *     kanoniskt och kan vara nyare). Finns redan ett värde på (objekt, katalog)
 *     hoppas raden över och rapporteras. Soft-raderade (raderad) svenska värden
 *     räknas också som "finns" → migreringen återupplivar inte raderad data.
 *   - För allowDuplicates-fält läggs värdet till parallellt om inget identiskt
 *     visningsvärde redan finns (post-it-modellen).
 *   - Matchar engelsk fieldKey → svensk katalog via namn ELLER beteckning
 *     (case-insensitivt). Saknas matchning skapas en katalogpost (namn=fieldKey,
 *     beskrivning=fieldLabel, datatyp mappad från data_type) — annars hamnar
 *     värdet utanför villkorsfilter/objektvyer.
 *   - metod='migration' på både metadata_varden och metadata_historik.
 *   - Alla SELECT/INSERT scopas på tenant_id (multi-tenant, defense-in-depth).
 *
 * Användning:
 *   npx tsx scripts/backfill-english-metadata-to-swedish.ts                 # dry-run (default)
 *   npx tsx scripts/backfill-english-metadata-to-swedish.ts --confirm       # skarp körning
 *   npx tsx scripts/backfill-english-metadata-to-swedish.ts --tenant kinab  # begränsa tenant
 */

import { db } from "../server/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  metadataDefinitions,
  objectMetadata,
  metadataKatalog,
  metadataVarden,
  metadataHistorik,
  type MetadataKatalog,
  type MetadataVarden,
} from "../shared/schema";
import {
  coerceMetadataVardeFromRaw,
  getDisplayValue,
  mapEnglishDataTypeToDatatyp,
} from "../server/metadata-queries";

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes("--confirm");
const tenantIdx = argv.indexOf("--tenant");
const ONLY_TENANT = tenantIdx >= 0 ? (argv[tenantIdx + 1] ?? null) : null;

interface TenantStats {
  candidates: number;
  created: number;       // nya metadata_varden (single-value)
  added: number;         // nya metadata_varden (allowDuplicates)
  skippedExisting: number; // svenskt värde finns redan
  skippedEmpty: number;  // engelsk rad utan value/valueJson
  skippedOrphan: number; // object_metadata utan giltig definition
  skippedTypeError: number; // värdet kunde inte coercas till datatyp
  katalogCreated: number;
}

function emptyStats(): TenantStats {
  return {
    candidates: 0,
    created: 0,
    added: 0,
    skippedExisting: 0,
    skippedEmpty: 0,
    skippedOrphan: 0,
    skippedTypeError: 0,
    katalogCreated: 0,
  };
}

type VardeFields = {
  vardeString: string | null;
  vardeInteger: number | null;
  vardeDecimal: number | null;
  vardeBoolean: boolean | null;
  vardeDatetime: Date | null;
  vardeJson: unknown | null;
  vardeReferens: string | null;
};

const EMPTY_VARDE: VardeFields = {
  vardeString: null,
  vardeInteger: null,
  vardeDecimal: null,
  vardeBoolean: null,
  vardeDatetime: null,
  vardeJson: null,
  vardeReferens: null,
};

async function listTenantIds(): Promise<string[]> {
  if (ONLY_TENANT) return [ONLY_TENANT];
  const rows = await db
    .selectDistinct({ tenantId: objectMetadata.tenantId })
    .from(objectMetadata)
    .where(isNull(objectMetadata.inheritedFromObjectId));
  return rows.map((r) => r.tenantId);
}

async function backfillTenant(tenantId: string, stats: TenantStats): Promise<void> {
  // 1. Engelska definitioner (inkl. soft-raderade — värden kan peka på en
  //    raderad definition men är fortfarande äkta data).
  const defs = await db
    .select({
      id: metadataDefinitions.id,
      fieldKey: metadataDefinitions.fieldKey,
      fieldLabel: metadataDefinitions.fieldLabel,
      dataType: metadataDefinitions.dataType,
      propagationType: metadataDefinitions.propagationType,
    })
    .from(metadataDefinitions)
    .where(eq(metadataDefinitions.tenantId, tenantId));
  const defById = new Map(defs.map((d) => [d.id, d]));

  // 2. Svensk katalog → uppslag på lower(namn) och lower(beteckning).
  const katalogRows = await db
    .select()
    .from(metadataKatalog)
    .where(eq(metadataKatalog.tenantId, tenantId));
  const byNamn = new Map<string, MetadataKatalog>();
  const byBeteckning = new Map<string, MetadataKatalog>();
  for (const k of katalogRows) {
    if (k.namn) byNamn.set(k.namn.toLowerCase(), k);
    if (k.beteckning) byBeteckning.set(k.beteckning.toLowerCase(), k);
  }
  const findKatalog = (fieldKey: string): MetadataKatalog | undefined => {
    const key = fieldKey.toLowerCase();
    return byNamn.get(key) ?? byBeteckning.get(key);
  };

  // 3. Lokala engelska värden.
  const rows = await db
    .select({
      id: objectMetadata.id,
      objectId: objectMetadata.objectId,
      definitionId: objectMetadata.definitionId,
      value: objectMetadata.value,
      valueJson: objectMetadata.valueJson,
      breaksInheritance: objectMetadata.breaksInheritance,
    })
    .from(objectMetadata)
    .where(and(eq(objectMetadata.tenantId, tenantId), isNull(objectMetadata.inheritedFromObjectId)));

  stats.candidates += rows.length;

  for (const row of rows) {
    const def = defById.get(row.definitionId);
    if (!def || !def.fieldKey) {
      stats.skippedOrphan += 1;
      continue;
    }

    const hasJson = row.valueJson !== null && row.valueJson !== undefined;
    const hasText = row.value !== null && row.value !== undefined && row.value !== "";
    if (!hasJson && !hasText) {
      stats.skippedEmpty += 1;
      continue;
    }

    // Hitta eller skapa katalogpost.
    let katalog = findKatalog(def.fieldKey);
    if (!katalog) {
      const datatyp = mapEnglishDataTypeToDatatyp(def.dataType);
      if (DRY_RUN) {
        // Spegla en virtuell katalogpost för dry-run så vi kan rapportera värdet.
        katalog = {
          id: `<ny:${def.fieldKey}>`,
          tenantId,
          namn: def.fieldKey,
          beteckning: null,
          beskrivning: def.fieldLabel ?? null,
          datatyp,
          allowedValues: null,
          allowDuplicates: false,
          standardArvs: def.propagationType !== "fixed",
        } as unknown as MetadataKatalog;
        byNamn.set(def.fieldKey.toLowerCase(), katalog);
        stats.katalogCreated += 1;
      } else {
        const [inserted] = await db
          .insert(metadataKatalog)
          .values({
            tenantId,
            namn: def.fieldKey,
            beskrivning: def.fieldLabel ?? null,
            datatyp,
            standardArvs: def.propagationType !== "fixed",
            kategori: "annat",
          })
          .returning();
        katalog = inserted;
        byNamn.set(def.fieldKey.toLowerCase(), katalog);
        stats.katalogCreated += 1;
      }
    }

    // Bygg typade värdefält + visningsvärde.
    let vardeFields: VardeFields;
    let displayValue: string;
    try {
      if (hasJson) {
        vardeFields = { ...EMPTY_VARDE, vardeJson: row.valueJson };
        displayValue = JSON.stringify(row.valueJson);
      } else {
        const coerced = coerceMetadataVardeFromRaw(katalog, row.value as string);
        vardeFields = coerced.vardeFields as VardeFields;
        displayValue = coerced.displayValue;
      }
    } catch {
      // Värdet passar inte katalogens datatyp (t.ex. "abc" mot decimal). Hoppa
      // hellre över än att krascha hela migreringen — rapporteras för granskning.
      stats.skippedTypeError += 1;
      continue;
    }

    // Idempotens / aldrig-skriv-över: kolla befintliga svenska värden.
    // (Virtuell dry-run-katalog kan inte ha värden ännu → tom lista.)
    const existing: MetadataVarden[] = katalog.id.startsWith("<ny:")
      ? []
      : await db
          .select()
          .from(metadataVarden)
          .where(
            and(
              eq(metadataVarden.objektId, row.objectId),
              eq(metadataVarden.metadataKatalogId, katalog.id),
              eq(metadataVarden.tenantId, tenantId),
            ),
          );

    if (katalog.allowDuplicates) {
      const identical = existing.some((e) => getDisplayValue(e) === displayValue);
      if (identical) {
        stats.skippedExisting += 1;
        continue;
      }
      if (!DRY_RUN) {
        await insertVarde(tenantId, row.objectId, katalog, vardeFields, displayValue, !!row.breaksInheritance);
      }
      stats.added += 1;
    } else {
      if (existing.length > 0) {
        stats.skippedExisting += 1;
        continue;
      }
      if (!DRY_RUN) {
        await insertVarde(tenantId, row.objectId, katalog, vardeFields, displayValue, !!row.breaksInheritance);
      }
      stats.created += 1;
    }
  }
}

async function insertVarde(
  tenantId: string,
  objektId: string,
  katalog: MetadataKatalog,
  vardeFields: VardeFields,
  displayValue: string,
  breaksInheritance: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(metadataVarden)
      .values({
        tenantId,
        objektId,
        metadataKatalogId: katalog.id,
        ...vardeFields,
        arvsNedat: katalog.standardArvs,
        stoppaVidareArvning: breaksInheritance,
        skapadAv: "migration",
        metod: "migration",
      })
      .returning();
    await tx.insert(metadataHistorik).values({
      tenantId,
      metadataVardenId: inserted.id,
      objektId,
      metadataKatalogId: katalog.id,
      gammaltVarde: null,
      nyttVarde: displayValue,
      andradAv: "migration",
      andringsMetod: "migration",
    });
  });
}

async function main() {
  console.log("=".repeat(72));
  console.log("BACKFILL  object_metadata (engelska) → metadata_varden (svenska)  [Task #992]");
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (ingen ändring sparas)" : "SKARP KÖRNING (--confirm)"}`);
  if (ONLY_TENANT) console.log(`Tenant-filter: ${ONLY_TENANT}`);
  console.log("=".repeat(72));

  const tenantIds = await listTenantIds();
  if (tenantIds.length === 0) {
    console.log("Inga tenants med lokala engelska metadatavärden hittades.");
    process.exit(0);
  }

  const grand = emptyStats();
  for (const tenantId of tenantIds) {
    const stats = emptyStats();
    await backfillTenant(tenantId, stats);
    console.log(
      `\n[${tenantId}] kandidater=${stats.candidates}` +
        `\n   skapade=${stats.created}  tillagda(dup)=${stats.added}  katalog_skapade=${stats.katalogCreated}` +
        `\n   hoppade(svenskt värde finns)=${stats.skippedExisting}  tomma=${stats.skippedEmpty}` +
        `  orphan=${stats.skippedOrphan}  typfel=${stats.skippedTypeError}`,
    );
    grand.candidates += stats.candidates;
    grand.created += stats.created;
    grand.added += stats.added;
    grand.skippedExisting += stats.skippedExisting;
    grand.skippedEmpty += stats.skippedEmpty;
    grand.skippedOrphan += stats.skippedOrphan;
    grand.skippedTypeError += stats.skippedTypeError;
    grand.katalogCreated += stats.katalogCreated;
  }

  console.log("\n" + "=".repeat(72));
  console.log(
    `TOTALT: kandidater=${grand.candidates}  skapade=${grand.created}  tillagda(dup)=${grand.added}` +
      `  katalog_skapade=${grand.katalogCreated}`,
  );
  console.log(
    `        hoppade(finns)=${grand.skippedExisting}  tomma=${grand.skippedEmpty}` +
      `  orphan=${grand.skippedOrphan}  typfel=${grand.skippedTypeError}`,
  );
  if (DRY_RUN) console.log("(dry-run — kör med --confirm för att spara)");
  console.log("=".repeat(72));
  process.exit(0);
}

main().catch((err) => {
  console.error("FEL:", err);
  process.exit(1);
});
