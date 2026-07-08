import type { ServiceObject } from "@shared/schema";
import { OBJECT_LOCATION_TYPES, type ObjectLocationType } from "@shared/schema";

/**
 * Task #990 — Objektets platsmodell (centraliserad platsupplösning).
 *
 * Tre platstyper styr hur uppgiftsmotor och UI behandlar ett objekt:
 *  - "pinpoint": exakt koordinat krävs; objektet är ruttbart.
 *  - "area":     område (t.ex. "Söderort"); ev. ungefärlig centroid-koordinat för
 *                kartvisning men ALDRIG ruttbart — motorn ska inte gissa en exakt punkt.
 *  - "none":     ingen geografi alls.
 *
 * Legacy-rader saknar explicit platstyp (kolumnen är nullable utan default). Deras
 * effektiva typ härleds: användbar koordinat ⇒ pinpoint, polyline/polygon ⇒ area,
 * annars none. Det bevarar exakt dagens ruttningsbeteende (objekt med koordinater
 * ruttas, övriga inte) tills någon explicit sätter en platstyp.
 *
 * Denna modul är den ENDA källan för objekt-platslogik (jfr beroende-uppgiften
 * "Lager- & återtagslogik") — duplicera aldrig koordinat-/fallback-logiken.
 *
 * Geografi v1/v2 (Mats beslut, uppgiftslogik): v1 behandlar geografi som PUNKT
 * (pinpoint) — antal-/faktureringslogiken är rent numerisk och gör inga
 * geometri-antaganden, så den fungerar oförändrat när v2 introducerar yta+linje.
 * v2-sömmen: explicit yt-/linjegeometri (polygon/polyline) blir metadata-driven via
 * metadata_katalog (geometri-datatyp) i stället för hårdkodade kolumner; "area" här
 * är dagens minimala platshållare (centroid för karta, aldrig ruttbar) tills dess.
 */

// Minimal delmängd av ServiceObject som resolvern behöver. Gör helpern användbar
// även för delvis-hydrerade rader utan typtvång.
export type LocatableObject = Pick<
  ServiceObject,
  | "latitude"
  | "longitude"
  | "entranceLatitude"
  | "entranceLongitude"
  | "address"
  | "city"
  | "postalCode"
  | "addressDescriptor"
  | "polylineData"
  | "locationType"
>;

export interface ResolvedObjectLocation {
  /** Effektiv platstyp (explicit kolumnvärde eller härledd). */
  locationType: ObjectLocationType;
  /** Sammansatt adress (gatuadress/postnr/stad) — null om helt tom. */
  address: string | null;
  /** Ruttnings-/visningskoordinat (objektets huvudkoordinat), null om saknas. */
  latitude: number | null;
  longitude: number | null;
  /** Sann ENBART om motorn säkert kan rutta till en exakt punkt. */
  routable: boolean;
  /** Mänskligt läsbart skäl när routable=false (för diagnos / ej-tilldelad). */
  reason: string;
}

/**
 * En koordinat är användbar om den är ett ändligt tal skilt från 0. Matchar (och
 * härdar) den befintliga `obj.latitude && obj.longitude`-truthiness som redan
 * behandlar 0/NaN som "saknas".
 */
export function isUsableCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" && Number.isFinite(lat) && lat !== 0 &&
    typeof lng === "number" && Number.isFinite(lng) && lng !== 0
  );
}

/**
 * Tolkar en koordinat-JSON tolerant. Accepterar {lat,lng}, {latitude,longitude}
 * eller GeoJSON {coordinates:[lng,lat]}. Returnerar null om ingen giltig punkt
 * (t.ex. polygon/sträckning med nästlad coordinates-array → isUsableCoord false).
 *
 * Bor här (leaf-modul) så både geo-field-sync (skriv-sidan) och metadata-queries
 * (läs-sidan/getObjectGeoFields.point) delar EN parser utan importcykel.
 */
export function parseCoordinateJson(raw: unknown): { lat: number; lng: number } | null {
  let obj: any = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;

  let lat: unknown = obj.lat ?? obj.latitude;
  let lng: unknown = obj.lng ?? obj.lon ?? obj.longitude;
  if ((lat == null || lng == null) && Array.isArray(obj.coordinates) && obj.coordinates.length >= 2) {
    // GeoJSON-ordning: [longitude, latitude]
    lng = obj.coordinates[0];
    lat = obj.coordinates[1];
  }
  if (isUsableCoord(lat, lng)) {
    return { lat: lat as number, lng: lng as number };
  }
  return null;
}

/** Bygger en sammansatt adresssträng; tål stad-only, gatuadress eller koordinater. */
export function buildObjectAddress(
  obj: Pick<LocatableObject, "address" | "postalCode" | "city">,
): string | null {
  const parts = [obj.address, obj.postalCode, obj.city]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

function normalizeLocationType(raw: unknown): ObjectLocationType | null {
  return typeof raw === "string" && (OBJECT_LOCATION_TYPES as readonly string[]).includes(raw)
    ? (raw as ObjectLocationType)
    : null;
}

/** Effektiv platstyp: explicit kolumnvärde vinner; annars härleds från geografi. */
export function resolveEffectiveObjectLocationType(obj: LocatableObject): ObjectLocationType {
  const explicit = normalizeLocationType(obj.locationType);
  if (explicit) return explicit;
  if (
    isUsableCoord(obj.latitude, obj.longitude) ||
    isUsableCoord(obj.entranceLatitude, obj.entranceLongitude)
  ) {
    return "pinpoint";
  }
  if (obj.polylineData != null) return "area";
  return "none";
}

/**
 * Full platsupplösning. `routable` är sann ENBART för pinpoint med användbar
 * koordinat — huvudkoordinat föredras, annars faller vi tillbaka på entré-
 * koordinaten (entré är också en exakt ruttbar punkt). Area/none ruttas aldrig
 * (motorn ska inte gissa en punkt). Area kan ändå returnera en centroid-koordinat
 * för kartvisning.
 */
export function resolveObjectLocation(obj: LocatableObject): ResolvedObjectLocation {
  const locationType = resolveEffectiveObjectLocationType(obj);
  const address = buildObjectAddress(obj);
  const hasMain = isUsableCoord(obj.latitude, obj.longitude);
  const hasEntrance = isUsableCoord(obj.entranceLatitude, obj.entranceLongitude);
  const latitude = hasMain ? (obj.latitude as number) : null;
  const longitude = hasMain ? (obj.longitude as number) : null;

  if (locationType === "none") {
    return {
      locationType,
      address,
      latitude: null,
      longitude: null,
      routable: false,
      reason: "Objektet saknar geografisk koppling (platstyp: ingen).",
    };
  }

  if (locationType === "area") {
    return {
      locationType,
      address,
      latitude,
      longitude,
      routable: false,
      reason: hasMain ? "Område — ungefärlig position, ej ruttbar." : "Område utan position.",
    };
  }

  // pinpoint — ruttbart via huvudkoordinat, annars entré-koordinat som fallback.
  if (hasMain) {
    return { locationType, address, latitude, longitude, routable: true, reason: "" };
  }
  if (hasEntrance) {
    return {
      locationType,
      address,
      latitude: obj.entranceLatitude as number,
      longitude: obj.entranceLongitude as number,
      routable: true,
      reason: "",
    };
  }
  return {
    locationType,
    address,
    latitude: null,
    longitude: null,
    routable: false,
    reason: "Exakt position saknas (platstyp: exakt men koordinat saknas).",
  };
}

/** Snabbtest: kan motorn rutta till objektet? */
export function objectIsRoutable(obj: LocatableObject): boolean {
  return resolveObjectLocation(obj).routable;
}
