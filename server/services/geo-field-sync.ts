// ============================================================================
// GEO-FIELD-SYNC (T004) — enkelriktad synk metadata → objekt-kolumner.
// ----------------------------------------------------------------------------
// Kanonisk geografimodell (Mats + architect): metadata_varden är KÄLLAN för de
// systemlåsta geo-fälten (Gatuadress/Postnummer/Postort/Koordinater). Objektets
// kolumner (address/postalCode/city/latitude/longitude) är en ENKELRIKTAD,
// ruttbar CACHE som object-location.ts läser. Denna modul är den ENDA platsen
// som materialiserar metadatavärden till kolumnerna.
//
// Grundregler (säkra i BÅDA miljöerna — dev har adress i kolumner/tom metadata,
// prod har adress i metadata/tomma kolumner):
//   • PRESENT-VALUE-ONLY: en kolumn skrivs BARA när det upplösta (ärvda) metadata-
//     värdet är icke-tomt OCH skiljer sig. Ett tomt/saknat metadatavärde nollar
//     ALDRIG en kolumn. → dev = no-op, prod = rent additiv ifyllnad.
//   • Koordinater: en MANUELL Koordinater-rad (metod ej automatisk) skrivs till
//     kolumn och geokodas ALDRIG. Saknas manuell koordinat geokodas adressen via
//     den befintliga pipelinen (triggerGeocodeIfMissing), som speglar tillbaka
//     koordinaten till Koordinater-metadata med metod='auto' (mirrorCoordinates).
//   • Fördjupad position (grupp 'fordjupad_position') rör ALDRIG kolumner och är
//     ALDRIG ruttbar.
//
// Loop-säkerhet i två lager: (a) en in-flight-vakt (Set) hoppar över återinträde,
// (b) konvergens — spegling → enqueueMetadataChange → sync igen, men andra varvet
// jämför och skriver inget (kolumn = redan satt), så inget tredje varv.
// ============================================================================

import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  SYSTEMLASTA_GEO_FALT,
  getObjectsMetadataValuesForCatalog,
  createMetadata,
  updateMetadata,
  isAutomaticOrigin,
} from "../metadata-queries";
import { isUsableCoord, parseCoordinateJson } from "./object-location";
// Bakåtkompat: parsern bor nu i object-location.ts (leaf) för att undvika
// importcykel med metadata-queries; re-exporteras här för befintliga importörer.
export { parseCoordinateJson };

// Ruttbara standardadress-strängfält → objekt-kolumn. Härleds konceptuellt ur
// SYSTEMLASTA_GEO_FALT (grupp='standardadress', datatyp='string'); mappningen
// namn→kolumn är explicit eftersom kolumnnamnen inte finns i katalog-definitionen.
const GEO_COLUMN_MAP: Record<string, "address" | "postalCode" | "city"> = {
  gatuadress: "address",
  postnummer: "postalCode",
  postort: "city",
};

const KOORDINATER_KEY = "koordinater";

export interface GeoSyncResult {
  objectId: string;
  columnsUpdated: string[];
  geocodeTriggered: boolean;
  skipped?: string;
}

// (a) In-flight-vakt: hindrar synkront återinträde per objekt.
const inFlight = new Set<string>();

interface GeoKatalogEntry {
  id: string;
  key: string; // lower(namn)
  datatyp: string;
}

/**
 * Läser tenantens systemlåsta geo-katalogfält (aktiva). Returnerar strängfält-
 * id:n (med kolumnmappning) och Koordinater-id:t. Tom om ensureSystemlastaFalt
 * inte körts för tenanten ännu → hela synken blir no-op.
 */
async function resolveGeoKatalog(tenantId: string): Promise<{
  stringFields: { id: string; column: "address" | "postalCode" | "city" }[];
  koordinaterId: string | null;
}> {
  const namnList = SYSTEMLASTA_GEO_FALT.map((d) => d.namn);
  const rows = (
    await db.execute(sql`
      SELECT id, namn, datatyp
      FROM metadata_katalog
      WHERE tenant_id = ${tenantId}
        AND deleted_at IS NULL
        AND systemlast = TRUE
        AND lower(namn) = ANY(ARRAY[${sql.join(
          namnList.map((n) => sql`${n.toLowerCase()}`),
          sql`, `,
        )}])
    `)
  ).rows as { id: string; namn: string; datatyp: string }[];

  const entries: GeoKatalogEntry[] = rows.map((r) => ({
    id: r.id,
    key: r.namn.toLowerCase(),
    datatyp: r.datatyp,
  }));

  const stringFields = entries
    .filter((e) => GEO_COLUMN_MAP[e.key])
    .map((e) => ({ id: e.id, column: GEO_COLUMN_MAP[e.key] }));
  const koordinater = entries.find((e) => e.key === KOORDINATER_KEY);

  return { stringFields, koordinaterId: koordinater?.id ?? null };
}

/** Läser objektets EGNA (icke-ärvda) Koordinater-rad om den finns. */
async function readOwnKoordinaterRow(
  tenantId: string,
  objektId: string,
  koordinaterId: string,
): Promise<{ id: string; vardeJson: unknown; metod: string | null } | null> {
  const rows = (
    await db.execute(sql`
      SELECT id, varde_json, metod
      FROM metadata_varden
      WHERE tenant_id = ${tenantId}
        AND objekt_id = ${objektId}
        AND metadata_katalog_id = ${koordinaterId}
        AND COALESCE(raderad, FALSE) = FALSE
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `)
  ).rows as { id: string; varde_json: unknown; metod: string | null }[];
  if (rows.length === 0) return null;
  return { id: rows[0].id, vardeJson: rows[0].varde_json, metod: rows[0].metod ?? null };
}

// Sant om objektet har en TOMBSTONAD (raderad) egen Koordinater-rad men ingen aktiv.
// createMetadatas dubblett-vakt filtrerar INTE på raderad, så en spegling får aldrig
// försöka CREATE när en tombstone finns (skulle kasta "Dubblett" i all evighet).
// Semantik: användaren tog bort koordinaten → respektera det, spegla inte tillbaka.
async function hasTombstonedKoordinater(
  tenantId: string,
  objektId: string,
  koordinaterId: string,
): Promise<boolean> {
  const rows = (
    await db.execute(sql`
      SELECT 1 FROM metadata_varden
      WHERE tenant_id = ${tenantId} AND objekt_id = ${objektId}
        AND metadata_katalog_id = ${koordinaterId}
        AND COALESCE(raderad, FALSE) = TRUE
      LIMIT 1
    `)
  ).rows as unknown[];
  return rows.length > 0;
}

/**
 * Speglar en (geokodad eller på annat sätt systemhärledd) koordinat tillbaka till
 * objektets Koordinater-metadatafält med metod='auto'. Respekterar en manuell
 * koordinat (skriver ALDRIG över en icke-automatisk rad). Fire-and-forget-vänlig.
 */
export async function mirrorCoordinatesToMetadata(
  tenantId: string,
  objektId: string,
  lat: number,
  lng: number,
): Promise<void> {
  if (!isUsableCoord(lat, lng)) return;
  const { koordinaterId } = await resolveGeoKatalog(tenantId);
  if (!koordinaterId) return; // katalogfält saknas → inget att spegla till

  const value = { type: "point", lat, lng };
  const own = await readOwnKoordinaterRow(tenantId, objektId, koordinaterId);

  if (own) {
    // Respektera en manuell pin — spegla bara över automatiska rader.
    if (!isAutomaticOrigin(own.metod)) return;
    const existing = parseCoordinateJson(own.vardeJson);
    if (existing && existing.lat === lat && existing.lng === lng) return; // konvergerat
    await updateMetadata(own.id, value, tenantId, "system", "auto");
    return;
  }

  // Ingen AKTIV egen rad. En tombstonad rad = användaren tog bort koordinaten →
  // respektera det och spegla inte (och undvik createMetadatas dubblett-vakt som
  // inte filtrerar raderad → skulle annars kasta "Dubblett" vid varje geokodning).
  if (await hasTombstonedKoordinater(tenantId, objektId, koordinaterId)) return;

  // Ingen egen rad alls → skapa en auto-rad. Koordinater är systemlast men INTE isSystem,
  // och metod='auto' är ett automatiskt ursprung, så createMetadata släpper igenom.
  await createMetadata({
    tenantId,
    objektId,
    metadataTypNamn: "Koordinater",
    varde: value,
    metod: "auto",
    skapadAv: "system",
  });
}

/**
 * Synkar ett objekts (och valfritt hela subträdets) upplösta geo-metadatavärden
 * ned i de ruttbara objekt-kolumnerna. Present-value-only. Triggar geokodning när
 * en adress finns men ruttbar koordinat saknas och ingen manuell koordinat satts.
 */
export async function syncObjectGeoFields(
  tenantId: string,
  objektId: string,
  opts: { cascade?: boolean } = {},
): Promise<GeoSyncResult[]> {
  const { stringFields, koordinaterId } = await resolveGeoKatalog(tenantId);
  if (stringFields.length === 0 && !koordinaterId) return [];

  // Målobjekt: self (+ ättlingar när cascade, eftersom en förälders adress-ändring
  // ändrar barnens UPPLÖSTA värde).
  let targetIds: string[] = [objektId];
  if (opts.cascade) {
    try {
      const subtree = await storage.getObjectSubtreeIds(tenantId, objektId);
      if (subtree.length > 0) targetIds = subtree;
    } catch {
      // subtree-fel → synka åtminstone self
    }
  }

  const katalogIds = [
    ...stringFields.map((f) => f.id),
    ...(koordinaterId ? [koordinaterId] : []),
  ];
  const resolved = await getObjectsMetadataValuesForCatalog(tenantId, targetIds, katalogIds);

  const results: GeoSyncResult[] = [];
  for (const id of targetIds) {
    if (inFlight.has(id)) {
      results.push({ objectId: id, columnsUpdated: [], geocodeTriggered: false, skipped: "in-flight" });
      continue;
    }
    inFlight.add(id);
    try {
      results.push(await syncOne(tenantId, id, resolved[id] ?? {}, stringFields, koordinaterId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[geo-field-sync] sync failed for object ${id}: ${message}`);
      results.push({ objectId: id, columnsUpdated: [], geocodeTriggered: false, skipped: `error: ${message}` });
    } finally {
      inFlight.delete(id);
    }
  }
  return results;
}

async function syncOne(
  tenantId: string,
  objektId: string,
  values: Record<string, string>,
  stringFields: { id: string; column: "address" | "postalCode" | "city" }[],
  koordinaterId: string | null,
): Promise<GeoSyncResult> {
  const obj = await storage.getObject(objektId);
  if (!obj || obj.tenantId !== tenantId || obj.deletedAt) {
    return { objectId: objektId, columnsUpdated: [], geocodeTriggered: false, skipped: "object missing/other-tenant" };
  }

  const updateData: Record<string, unknown> = {};
  const columnsUpdated: string[] = [];

  // Present-value-only: skriv strängkolumn bara när upplöst värde finns och skiljer sig.
  for (const f of stringFields) {
    const resolvedVal = values[f.id];
    if (resolvedVal == null || resolvedVal === "") continue;
    if ((obj as any)[f.column] === resolvedVal) continue;
    updateData[f.column] = resolvedVal;
    columnsUpdated.push(f.column);
  }

  // Manuell koordinat → kolumn (aldrig geokoda). Auto/ingen → geokodas nedan.
  let manualCoord = false;
  if (koordinaterId) {
    const own = await readOwnKoordinaterRow(tenantId, objektId, koordinaterId);
    if (own && !isAutomaticOrigin(own.metod)) {
      const coord = parseCoordinateJson(own.vardeJson);
      if (coord) {
        manualCoord = true;
        if (obj.latitude !== coord.lat || obj.longitude !== coord.lng) {
          updateData.latitude = coord.lat;
          updateData.longitude = coord.lng;
          columnsUpdated.push("latitude", "longitude");
        }
      }
    }
  }

  if (Object.keys(updateData).length > 0) {
    await storage.updateObject(objektId, updateData);
  }

  // Effektiva kolumnvärden efter skrivning (för geokod-beslut).
  const effAddress = (updateData.address ?? obj.address) as string | null;
  const effPostal = (updateData.postalCode ?? obj.postalCode) as string | null;
  const effCity = (updateData.city ?? obj.city) as string | null;
  const effLat = (updateData.latitude ?? obj.latitude) as number | null;
  const effLng = (updateData.longitude ?? obj.longitude) as number | null;
  const hasAddress = [effAddress, effPostal, effCity].some(
    (p) => typeof p === "string" && p.trim().length > 0,
  );

  // Om en adress-strängkolumn ändrats måste koordinaten geokodas OM även när objektet
  // redan har (gamla) koordinater — annars pekar den ruttbara punkten på fel plats.
  const addressColumnsChanged = columnsUpdated.some(
    (c) => c === "address" || c === "postalCode" || c === "city",
  );
  const needsGeocode =
    !manualCoord &&
    hasAddress &&
    obj.locationType !== "none" &&
    (!isUsableCoord(effLat, effLng) || addressColumnsChanged);
  let geocodeTriggered = false;
  if (needsGeocode) {
    // Återanvänd den befintliga geokod-pipelinen; den speglar tillbaka koordinaten
    // till metadata via mirrorCoordinatesToMetadata (call-site i geocoding.ts).
    // force=true när adressen ändrats, annars hoppar objectNeedsGeocoding över den.
    try {
      const { triggerGeocodeIfMissing } = await import("./geocoding");
      triggerGeocodeIfMissing(objektId, { force: addressColumnsChanged });
      geocodeTriggered = true;
    } catch (err) {
      console.error(`[geo-field-sync] geocode trigger failed for ${objektId}:`, err);
    }
  }

  if (columnsUpdated.length > 0 || geocodeTriggered) {
    console.log(
      `[geo-field-sync] object=${objektId} columns=[${columnsUpdated.join(",")}] geocode=${geocodeTriggered}`,
    );
  }
  return { objectId: objektId, columnsUpdated, geocodeTriggered };
}

// ============================================================================
// BACKFILL (manuellt, guardat script — kör ALDRIG vid startup).
// ----------------------------------------------------------------------------
// Gör legacy-objekt (dev-stil: adress i kolumner, inga metadatavärden) konsekventa
// genom att skriva metod='auto'-metadatavärden ENBART där objektet har en icke-tom
// kolumn och saknar ett eget aktivt metadatavärde. No-op i prod (kolumner tomma).
// ============================================================================

export interface GeoBackfillReport {
  tenantId: string;
  dryRun: boolean;
  objectsScanned: number;
  fieldsWritten: number;
  perField: Record<string, number>;
  details: { objectId: string; field: string; value: string }[];
}

export async function backfillColumnsToMetadata(
  tenantId: string,
  opts: { dryRun?: boolean; limit?: number } = {},
): Promise<GeoBackfillReport> {
  const dryRun = opts.dryRun !== false; // säker default: dry-run om ej explicit false
  const { stringFields, koordinaterId } = await resolveGeoKatalog(tenantId);

  const report: GeoBackfillReport = {
    tenantId,
    dryRun,
    objectsScanned: 0,
    fieldsWritten: 0,
    perField: {},
    details: [],
  };
  if (stringFields.length === 0 && !koordinaterId) return report;

  const objs = await storage.getObjects(tenantId);
  const targets = opts.limit && opts.limit > 0 ? objs.slice(0, opts.limit) : objs;
  report.objectsScanned = targets.length;

  // Kolumn → katalog-namn för write.
  const columnToNamn: Record<string, string> = { address: "Gatuadress", postalCode: "Postnummer", city: "Postort" };

  for (const obj of targets) {
    // Egna aktiva metadatavärden för geo-fälten (för att inte skriva dubbletter).
    const katalogIds = [...stringFields.map((f) => f.id), ...(koordinaterId ? [koordinaterId] : [])];
    const ownRows = (
      await db.execute(sql`
        SELECT metadata_katalog_id FROM metadata_varden
        WHERE tenant_id = ${tenantId} AND objekt_id = ${obj.id}
          AND COALESCE(raderad, FALSE) = FALSE
          AND metadata_katalog_id = ANY(ARRAY[${sql.join(katalogIds.map((k) => sql`${k}`), sql`, `)}])
      `)
    ).rows as { metadata_katalog_id: string }[];
    const ownSet = new Set(ownRows.map((r) => r.metadata_katalog_id));

    for (const f of stringFields) {
      if (ownSet.has(f.id)) continue;
      const colVal = (obj as any)[f.column] as string | null;
      if (typeof colVal !== "string" || colVal.trim() === "") continue;
      const namn = columnToNamn[f.column];
      report.perField[namn] = (report.perField[namn] ?? 0) + 1;
      report.fieldsWritten++;
      report.details.push({ objectId: obj.id, field: namn, value: colVal });
      if (!dryRun) {
        await createMetadata({ tenantId, objektId: obj.id, metadataTypNamn: namn, varde: colVal, metod: "auto", skapadAv: "system" });
      }
    }

    if (koordinaterId && !ownSet.has(koordinaterId) && isUsableCoord(obj.latitude, obj.longitude)) {
      const value = { type: "point", lat: obj.latitude as number, lng: obj.longitude as number };
      report.perField["Koordinater"] = (report.perField["Koordinater"] ?? 0) + 1;
      report.fieldsWritten++;
      report.details.push({ objectId: obj.id, field: "Koordinater", value: JSON.stringify(value) });
      if (!dryRun) {
        await createMetadata({ tenantId, objektId: obj.id, metadataTypNamn: "Koordinater", varde: value, metod: "auto", skapadAv: "system" });
      }
    }
  }

  console.log(
    `[geo-field-sync] backfill tenant=${tenantId} dryRun=${dryRun} scanned=${report.objectsScanned} written=${report.fieldsWritten}`,
  );
  return report;
}
