// ============================================================================
// OBJEKT-KLASSIFICERING (Task #1484) — objekttyp/nivå som metadata (expand-fas).
// ----------------------------------------------------------------------------
// Kanonisk modell (samma mönster som geo-field-sync): metadata_varden är KÄLLAN
// för objektets klassificering (Objekttyp/Anläggningstyp i systemområdet
// Klassificering). Objektkolumnerna objects.objectType/hierarchyLevel är en
// ENKELRIKTAD CACHE som legacy-läsare (listor, VRP-plumbing, fasthakningens
// fallback) fortsätter läsa under expand-fasen. Kolumnerna rivs i #1486.
//
// Grundregler:
//   • PRESENT-VALUE-ONLY: en kolumn skrivs BARA när metadatavärdet är icke-tomt
//     och skiljer sig. Tomt/saknat metadatavärde nollar ALDRIG en kolumn.
//   • Spegling kolumn→metadata (legacy-skrivvägar: import, portal, Modus) rör
//     ALDRIG en manuell metadata-rad — bara auto-rader uppdateras/skapas.
//   • Fasthakningen läser metadata-först (eget värde; arv=false för dessa fält)
//     med kolumn-fallback → paritet med dagens utfall efter backfill.
//
// Loop-säkerhet: metadata→kolumn-synken skriver kolumner via rå db.update (inte
// storage.updateObject) så ingen ny spegling triggas; spegling kolumn→metadata
// konvergerar (andra varvet jämför lika och skriver inget).
// ============================================================================

import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  createMetadata,
  updateMetadata,
  isAutomaticOrigin,
  getObjectWithAllMetadata,
} from "../metadata-queries";

export const OBJEKTTYP_FALT = "Objekttyp";
export const ANLAGGNINGSTYP_FALT = "Anläggningstyp";

// objects-kolumn ↔ katalogfält (lower(namn) = key i SYSTEMOMRADEN_FALT).
const FIELD_MAP = [
  { key: "objekttyp", namn: OBJEKTTYP_FALT, column: "object_type" as const, prop: "objectType" as const },
  { key: "anläggningstyp", namn: ANLAGGNINGSTYP_FALT, column: "hierarchy_level" as const, prop: "hierarchyLevel" as const },
];

export interface ClassificationValues {
  objectType?: string | null;
  hierarchyLevel?: string | null;
}

interface KatalogRow { id: string; key: string }

/** Tenantens aktiva klassificerings-katalogfält. Tom map = ensure ej körd → no-op. */
async function resolveKlassificeringKatalog(tenantId: string): Promise<Map<string, string>> {
  const rows = (
    await db.execute(sql`
      SELECT id, lower(namn) AS key
      FROM metadata_katalog
      WHERE tenant_id = ${tenantId}
        AND deleted_at IS NULL
        AND lower(namn) IN ('objekttyp', 'anläggningstyp')
    `)
  ).rows as unknown as KatalogRow[];
  const map = new Map<string, string>();
  for (const r of rows) if (!map.has(r.key)) map.set(r.key, r.id);
  return map;
}

/** Objektets EGNA aktiva rad för ett katalogfält (klassificering ärvs inte). */
async function readOwnRow(
  tenantId: string,
  objektId: string,
  katalogId: string,
): Promise<{ id: string; varde: string | null; metod: string | null } | null> {
  const rows = (
    await db.execute(sql`
      SELECT id, varde_string AS varde, metod
      FROM metadata_varden
      WHERE tenant_id = ${tenantId}
        AND objekt_id = ${objektId}
        AND metadata_katalog_id = ${katalogId}
        AND status = 'aktiv'
        AND COALESCE(raderad, FALSE) = FALSE
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `)
  ).rows as unknown as { id: string; varde: string | null; metod: string | null }[];
  return rows[0] ?? null;
}

/** Sant om objektet har en TOMBSTONAD egen rad (användaren tog bort värdet → spegla ej). */
async function hasTombstonedRow(tenantId: string, objektId: string, katalogId: string): Promise<boolean> {
  const rows = (
    await db.execute(sql`
      SELECT 1 FROM metadata_varden
      WHERE tenant_id = ${tenantId} AND objekt_id = ${objektId}
        AND metadata_katalog_id = ${katalogId}
        AND COALESCE(raderad, FALSE) = TRUE
      LIMIT 1
    `)
  ).rows as unknown[];
  return rows.length > 0;
}

/**
 * Speglar kolumnvärden (från legacy-skrivvägar) till metadata som auto-rader.
 * Skriver ALDRIG över en manuell rad, respekterar tombstones, no-op när
 * katalogfälten saknas. Best-effort — anropas fire-and-forget efter commit.
 */
export async function mirrorClassificationToMetadata(
  tenantId: string,
  objektId: string,
  values: ClassificationValues,
): Promise<void> {
  let katalog = await resolveKlassificeringKatalog(tenantId);
  if (katalog.size < FIELD_MAP.length) {
    // Självläkande: saknas de kanoniska systemfälten (tenant som varken
    // startats om, öppnat metadata-inställningarna eller backfillats) etableras
    // de här — annars skulle speglingen tyst no-op:a och modellen bli
    // deploy-ordningsberoende.
    try {
      const { ensureSystemomradenFalt } = await import("../metadata-queries");
      await ensureSystemomradenFalt(tenantId);
      katalog = await resolveKlassificeringKatalog(tenantId);
    } catch (err) {
      console.error(`[object-classification] ensureSystemomradenFalt failed tenant=${tenantId}:`, err);
    }
  }
  if (katalog.size === 0) return;

  for (const f of FIELD_MAP) {
    const raw = values[f.prop];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) continue; // present-value-only
    const katalogId = katalog.get(f.key);
    if (!katalogId) continue;

    const own = await readOwnRow(tenantId, objektId, katalogId);
    if (own) {
      if (!isAutomaticOrigin(own.metod)) continue; // manuell rad vinner
      if ((own.varde ?? "") === value) continue;   // konvergerat
      await updateMetadata(own.id, value, tenantId, "system", "auto");
      continue;
    }
    if (await hasTombstonedRow(tenantId, objektId, katalogId)) continue;
    // Minimera dubblett-fönstret mot parallella metadata-skrivare (t.ex.
    // kopieringens metadata-kopia): läs om egen rad precis före insert.
    if (await readOwnRow(tenantId, objektId, katalogId)) continue;
    await createMetadata({
      tenantId,
      objektId,
      metadataTypNamn: f.namn,
      varde: value,
      metod: "auto",
      skapadAv: "system",
    });
  }
}

/**
 * Tx-säker, uppskjuten spegling: schemalägger mirrorClassificationToMetadata
 * och väntar tills objektraden är COMMITTAD (synlig utanför transaktionen)
 * innan metadata skrivs. Rullas transaktionen tillbaka syns raden aldrig →
 * speglingen ger upp tyst efter maxförsöken. Fire-and-forget; får anropas
 * mitt i en pågående transaktion.
 */
export function scheduleClassificationMirror(
  tenantId: string,
  objectId: string,
  values: ClassificationValues,
): void {
  const objectType = typeof values.objectType === "string" ? values.objectType.trim() : "";
  const hierarchyLevel = typeof values.hierarchyLevel === "string" ? values.hierarchyLevel.trim() : "";
  if (!objectType && !hierarchyLevel) return;

  const MAX_ATTEMPTS = 6;
  const RETRY_MS = 2000;
  let attempt = 0;
  const tryMirror = async (): Promise<void> => {
    attempt++;
    try {
      const rows = (
        await db.execute(sql`SELECT 1 FROM objects WHERE id = ${objectId} AND tenant_id = ${tenantId} LIMIT 1`)
      ).rows as unknown[];
      if (rows.length === 0) {
        // Ej committad än (eller rollback). Försök igen en stund, ge sedan upp.
        if (attempt < MAX_ATTEMPTS) setTimeout(() => { void tryMirror(); }, RETRY_MS);
        return;
      }
      await mirrorClassificationToMetadata(tenantId, objectId, { objectType, hierarchyLevel });
    } catch (err) {
      console.error(`[object-classification] deferred mirror failed object=${objectId} attempt=${attempt}:`, err);
      if (attempt < MAX_ATTEMPTS) setTimeout(() => { void tryMirror(); }, RETRY_MS);
    }
  };
  setImmediate(() => { void tryMirror(); });
}

/**
 * Läser klassificeringen ur ett redan hämtat getObjectWithAllMetadata-resultat.
 * Endast EGNA rader räknas (source=local) — klassificering ärvs aldrig.
 */
export function resolveClassificationFromMetadata(
  objMeta: { metadata: Array<any> } | null | undefined,
): ClassificationValues {
  const out: ClassificationValues = {};
  if (!objMeta) return out;
  for (const m of objMeta.metadata) {
    const key = (m.katalog?.namn ?? "").toLowerCase();
    if (m.source && m.source !== "local") continue;
    const value = typeof m.vardeString === "string" ? m.vardeString.trim() : "";
    if (!value) continue;
    if (key === "objekttyp" && out.objectType === undefined) out.objectType = value;
    if (key === "anläggningstyp" && out.hierarchyLevel === undefined) out.hierarchyLevel = value;
  }
  return out;
}

/**
 * Metadata→kolumn-synk (cache-materialisering), present-value-only. Anropas från
 * metadata-change-jobs när metadata ändrats. Rå db.update → ingen ny spegling.
 * Returnerar antal objekt vars kolumner uppdaterades.
 */
export async function syncClassificationColumns(
  tenantId: string,
  objectIds: string[],
): Promise<number> {
  if (objectIds.length === 0) return 0;
  const katalog = await resolveKlassificeringKatalog(tenantId);
  if (katalog.size === 0) return 0;

  let updated = 0;
  for (const objectId of objectIds) {
    const sets: string[] = [];
    const values: ClassificationValues = {};
    for (const f of FIELD_MAP) {
      const katalogId = katalog.get(f.key);
      if (!katalogId) continue;
      const own = await readOwnRow(tenantId, objectId, katalogId);
      const value = own?.varde?.trim();
      if (value) values[f.prop] = value;
    }
    if (values.objectType === undefined && values.hierarchyLevel === undefined) continue;

    const res = await db.execute(sql`
      UPDATE objects SET
        object_type = COALESCE(${values.objectType ?? null}, object_type),
        hierarchy_level = COALESCE(${values.hierarchyLevel ?? null}, hierarchy_level)
      WHERE id = ${objectId} AND tenant_id = ${tenantId}
        AND (
          (${values.objectType ?? null}::text IS NOT NULL AND object_type IS DISTINCT FROM ${values.objectType ?? null}) OR
          (${values.hierarchyLevel ?? null}::text IS NOT NULL AND hierarchy_level IS DISTINCT FROM ${values.hierarchyLevel ?? null})
        )
    `);
    if ((res as any).rowCount > 0) updated++;
    void sets;
  }
  return updated;
}

/**
 * Fasthakningens klassificeringskontext: metadata-först (eget värde), kolumn-
 * fallback under expand-fasen. objMeta kan skickas in om redan hämtat (perf).
 */
export async function getObjectHookClassification(
  tenantId: string,
  objectId: string,
  fallback: { objectType?: string | null; hierarchyLevel?: string | null },
  objMeta?: { metadata: Array<any> } | null,
): Promise<{ objectType: string; hierarchyLevel: string }> {
  const meta = objMeta !== undefined ? objMeta : await getObjectWithAllMetadata(objectId, tenantId);
  const resolved = resolveClassificationFromMetadata(meta);
  return {
    objectType: resolved.objectType ?? fallback.objectType ?? "",
    hierarchyLevel: resolved.hierarchyLevel ?? fallback.hierarchyLevel ?? "",
  };
}

export interface ClassificationBackfillResult {
  tenantId: string;
  scanned: number;
  created: number;
  skippedExisting: number;
  skippedEmpty: number;
  errors: number;
}

/**
 * Idempotent backfill: kopierar befintliga kolumnvärden till metadata för alla
 * aktiva objekt som saknar egen (aktiv eller tombstonad) rad. Dry-run default.
 * Present-value-only; skriver aldrig över befintliga rader.
 */
export async function backfillClassificationMetadata(
  tenantId: string,
  opts: { dryRun?: boolean } = {},
): Promise<ClassificationBackfillResult> {
  const dryRun = opts.dryRun !== false;
  const result: ClassificationBackfillResult = {
    tenantId, scanned: 0, created: 0, skippedExisting: 0, skippedEmpty: 0, errors: 0,
  };
  const katalog = await resolveKlassificeringKatalog(tenantId);
  if (katalog.size === 0) return result;

  const objs = (
    await db.execute(sql`
      SELECT id, object_type AS "objectType", hierarchy_level AS "hierarchyLevel"
      FROM objects
      WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    `)
  ).rows as unknown as { id: string; objectType: string | null; hierarchyLevel: string | null }[];

  for (const obj of objs) {
    result.scanned++;
    for (const f of FIELD_MAP) {
      const katalogId = katalog.get(f.key);
      if (!katalogId) continue;
      const value = (obj[f.prop] ?? "").trim();
      if (!value) { result.skippedEmpty++; continue; }

      // Finns NÅGON egen rad (aktiv eller tombstonad) → rör aldrig.
      const existing = (
        await db.execute(sql`
          SELECT 1 FROM metadata_varden
          WHERE tenant_id = ${tenantId} AND objekt_id = ${obj.id}
            AND metadata_katalog_id = ${katalogId}
          LIMIT 1
        `)
      ).rows as unknown[];
      if (existing.length > 0) { result.skippedExisting++; continue; }

      if (dryRun) { result.created++; continue; }
      try {
        await createMetadata({
          tenantId,
          objektId: obj.id,
          metadataTypNamn: f.namn,
          varde: value,
          metod: "auto",
          skapadAv: "system",
        });
        result.created++;
      } catch (err) {
        result.errors++;
        console.error(`[object-classification] backfill misslyckades objekt=${obj.id} fält=${f.namn}:`, err);
      }
    }
  }
  return result;
}
