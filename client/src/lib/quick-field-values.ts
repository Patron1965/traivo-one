// Task #1439: delad, ren värdesupplösning för snabbfält (quick fields).
//
// Snabbfälten pekas in som metadata_katalog-fält, men flera av de kanoniska
// fälten (Objektnamn, Postnummer/Postort/Gatuadress, Koordinater) har sitt
// sanningsvärde i objektkolumnerna — metadata är källan men kolumnerna är den
// synkade cachen (memory: geo-field-sync), och Objektnamn är ett rent systemfält
// utan metadata_varden-rad. Utan kolumn-fallback renderar sådana slots tomt.
//
// Här löses ett slot-värde upp i ordningen:
//   1. metadata_varden-rad för katalogfältet (inkl. ärvda värden)
//   2. objektkolumn-fallback via fältets kanoniska namn (case-insensitivt)
// Bild-typade fält (datatyp='image') särbehandlas: värdet är en bildsökväg som
// ska renderas som miniatyr, inte som text.

export interface QuickFieldEntryLike {
  vardeString?: string | null;
  vardeInteger?: number | null;
  vardeDecimal?: number | null;
  vardeBoolean?: boolean | null;
  vardeDatetime?: string | null;
  vardeJson?: unknown;
  source?: string;
  softDeleted?: boolean;
  raderad?: boolean;
  metadataKatalogId?: string;
  katalog?: { namn?: string; visningsnamn?: string };
}

export interface QuickFieldSlotDef {
  katalogId: string;
  namn: string;
  visningsnamn?: string | null;
  datatyp: string;
}

export interface ObjectColumnValues {
  name?: string | null;
  objectNumber?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  entranceLatitude?: number | string | null;
  entranceLongitude?: number | string | null;
}

export function isImagePath(v: string | null | undefined): boolean {
  return !!v && (v.startsWith("/") || v.startsWith("http"));
}

function toNum(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "59.32938, 18.06871" — 5 decimaler räcker för visning (≈1 m). */
export function formatCoordinatePair(
  lat: number | string | null | undefined,
  lng: number | string | null | undefined,
): string | null {
  const la = toNum(lat);
  const ln = toNum(lng);
  if (la == null || ln == null) return null;
  return `${la.toFixed(5)}, ${ln.toFixed(5)}`;
}

/** Tolka ett location-JSON-värde ({lat,lng}, {latitude,longitude} eller GeoJSON). */
export function parseLocationValue(raw: unknown): { lat: number; lng: number } | null {
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
  const la = toNum(lat as any);
  const ln = toNum(lng as any);
  return la != null && ln != null ? { lat: la, lng: ln } : null;
}

/** Visningsvärde ur en metadata-rad. location-typade fält formateras som koordinatpar. */
export function entryDisplayValue(
  entry: QuickFieldEntryLike | undefined,
  datatyp?: string,
): string | null {
  if (!entry) return null;
  if (entry.vardeString != null && entry.vardeString !== "") return entry.vardeString;
  if (entry.vardeInteger != null) return String(entry.vardeInteger);
  if (entry.vardeDecimal != null) return String(entry.vardeDecimal);
  if (entry.vardeBoolean != null) return entry.vardeBoolean ? "Ja" : "Nej";
  if (entry.vardeDatetime) return new Date(entry.vardeDatetime).toLocaleDateString("sv-SE");
  if (entry.vardeJson != null) {
    if (datatyp === "location") {
      const p = parseLocationValue(entry.vardeJson);
      if (p) return formatCoordinatePair(p.lat, p.lng);
    }
    return typeof entry.vardeJson === "object"
      ? JSON.stringify(entry.vardeJson)
      : String(entry.vardeJson);
  }
  return null;
}

// Kanoniska fältnamn (lower-case) → objektkolumn-fallback. Namn är den
// universella nyckeln i katalogen (memory: systemomraden-ensure-adoption).
export function objectColumnFallbackValue(
  fieldNamn: string,
  obj: ObjectColumnValues,
): string | null {
  const key = (fieldNamn ?? "").trim().toLowerCase();
  const nonEmpty = (v: string | null | undefined) =>
    v != null && String(v).trim() !== "" ? String(v).trim() : null;
  switch (key) {
    case "objektnamn":
      return nonEmpty(obj.name);
    case "postnummer":
      return nonEmpty(obj.postalCode);
    case "postort":
      return nonEmpty(obj.city);
    case "gatuadress":
      return nonEmpty(obj.address);
    case "koordinater":
    case "position":
      return (
        formatCoordinatePair(obj.latitude, obj.longitude) ??
        formatCoordinatePair(obj.entranceLatitude, obj.entranceLongitude)
      );
    default:
      return null;
  }
}

export interface ResolvedQuickFieldValue {
  /** Textvärde att visa (null = tomt läge "—"). */
  value: string | null;
  /** Bildsökväg när fältet är bild-typat och har en giltig sökväg. */
  imageUrl: string | null;
  /** true när värdet kom från en objektkolumn (ingen metadata-rad fanns). */
  fromObjectColumn: boolean;
}

/** Lös upp ett snabbfälts-slots visningsvärde: metadata-rad först, sedan objektkolumn. */
export function resolveQuickFieldValue(
  field: QuickFieldSlotDef,
  entry: QuickFieldEntryLike | undefined,
  obj: ObjectColumnValues,
): ResolvedQuickFieldValue {
  const fromEntry = entryDisplayValue(entry, field.datatyp);
  if (fromEntry != null) {
    const imageUrl = field.datatyp === "image" && isImagePath(fromEntry) ? fromEntry : null;
    return { value: fromEntry, imageUrl, fromObjectColumn: false };
  }
  const fallback = objectColumnFallbackValue(field.namn, obj);
  return { value: fallback, imageUrl: null, fromObjectColumn: fallback != null };
}

// ============================================================================
// Vinjettbild — vilken katalograd driver bild-brickan?
// Konfigurerat imageMetadataKatalogId vinner. Saknas konfig (null) faller vi
// tillbaka på objektets egen/ärvda bildmetadata: först det kanoniska fältet
// "Vinjetbild", annars första bild-lika värdet. Så visas en importerad bild
// direkt utan att fältet måste läggas till igen i objekttyps-konfigen.
// ============================================================================

const VIGNETTE_FIELD_NAMES = new Set(["vinjetbild", "vinjettbild", "vignettbild"]);

export function resolveVignetteKatalogId(
  configuredKatalogId: string | null | undefined,
  metadata: QuickFieldEntryLike[],
): string | null {
  if (configuredKatalogId) return configuredKatalogId;
  const active = metadata.filter(
    (m) => !m.softDeleted && !m.raderad && !!m.metadataKatalogId,
  );
  const byName = active.find(
    (m) =>
      VIGNETTE_FIELD_NAMES.has((m.katalog?.namn ?? "").trim().toLowerCase()) &&
      isImagePath(m.vardeString),
  );
  if (byName) return byName.metadataKatalogId!;
  return null;
}
