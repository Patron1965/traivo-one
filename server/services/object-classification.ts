// ======
// OBJEKT-KLASSIFICERING — objekttyp/nivå som metadata (contract-fas, Task #1486).
// ----------------------------------------------------------------------------
// Kanonisk modell: metadata_varden är ENDA källan för objektets klassificering
// (fälten "Objekttyp"/"Anläggningstyp" i systemområdet Klassificering).
// Legacy-kolumnerna objects.object_type/hierarchy_level/object_level är
// BORTTAGNA (migration 0151) — det finns ingen kolumncache och ingen fallback.
//
// Grundregler:
//   • Spegling värde→metadata (legacy-skrivvägar: import, portal, Modus) rör
//     ALDRIG en manuell metadata-rad — bara auto-rader uppdateras/skapas.
//   • Tombstonad egen rad (användaren tog bort värdet) respekteras — speglas ej.
//   • Klassificering ärvs INTE (arv=false på katalogfälten): endast objektets
//     EGNA rader räknas.
// ======

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

// katalogfält (lower(namn) = key i SYSTEMOMRADEN_FALT) ↔ logisk egenskap.
const FIELD_MAP = [
  { key: "objekttyp", namn: OBJEKTTYP_FALT, prop: "objectType" as const },
  { key: "anläggningstyp", namn: ANLAGGNINGSTYP_FALT, prop: "hierarchyLevel" as const },
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
 * Skriver klassificeringsvärden (från legacy-skrivvägar som import/portal/Modus)
 * till metadata som auto-rader. Skriver ALDRIG över en manuell rad, respekterar
 * tombstones, självläker saknade katalogfält. Best-effort — anropas
 * fire-and-forget efter commit.
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
 * Tx-säker, uppskjuten klassificerings-skrivning: schemalägger
 * mirrorClassificationToMetadata och väntar tills objektraden är COMMITTAD
 * (synlig utanför transaktionen) innan metadata skrivs. Rullas transaktionen
 * tillbaka syns raden aldrig → speglingen ger upp tyst efter maxförsöken.
 * Fire-and-forget; får anropas mitt i en pågående transaktion.
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
 * Klassificeringen (Objekttyp/Anläggningstyp) för ETT objekt, metadata-only —
 * ingen kolumn-fallback (kolumnerna finns inte längre). objMeta kan skickas in
 * om redan hämtat (perf). Tomma strängar när värde saknas.
 */
export async function getObjectHookClassification(
  tenantId: string,
  objectId: string,
  objMeta?: { metadata: Array<any> } | null,
): Promise<{ objectType: string; hierarchyLevel: string }> {
  const meta = objMeta !== undefined ? objMeta : await getObjectWithAllMetadata(objectId, tenantId);
  const resolved = resolveClassificationFromMetadata(meta);
  return {
    objectType: resolved.objectType ?? "",
    hierarchyLevel: resolved.hierarchyLevel ?? "",
  };
}

/**
 * Klassificeringen för MÅNGA objekt i ett svep (list-/filtervägar). Läser bara
 * objektens EGNA aktiva rader — klassificering ärvs inte. Objekt utan värde
 * saknas i mappen.
 */
export async function getClassificationForObjects(
  tenantId: string,
  objectIds: string[],
): Promise<Map<string, { objectType?: string; hierarchyLevel?: string }>> {
  const out = new Map<string, { objectType?: string; hierarchyLevel?: string }>();
  if (objectIds.length === 0) return out;
  const rows = (
    await db.execute(sql`
      SELECT mv.objekt_id AS "objektId", lower(mk.namn) AS key, mv.varde_string AS varde
      FROM metadata_varden mv
      JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
        AND mk.tenant_id = mv.tenant_id
        AND mk.deleted_at IS NULL
        AND lower(mk.namn) IN ('objekttyp', 'anläggningstyp')
      WHERE mv.tenant_id = ${tenantId}
        AND mv.objekt_id IN (${sql.join(objectIds.map((id) => sql`${id}`), sql`, `)})
        AND mv.status = 'aktiv'
        AND COALESCE(mv.raderad, FALSE) = FALSE
        AND COALESCE(mv.varde_string, '') <> ''
    `)
  ).rows as unknown as { objektId: string; key: string; varde: string }[];
  for (const r of rows) {
    const entry = out.get(r.objektId) ?? {};
    if (r.key === "objekttyp" && entry.objectType === undefined) entry.objectType = r.varde;
    if (r.key === "anläggningstyp" && entry.hierarchyLevel === undefined) entry.hierarchyLevel = r.varde;
    out.set(r.objektId, entry);
  }
  return out;
}
