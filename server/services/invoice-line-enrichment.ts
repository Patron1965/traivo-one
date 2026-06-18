// Task #1025: Berika fakturarader till Fortnox med objektreferenser.
//
// Varje fakturarad som skickas till Fortnox ska bära en läsbar beskrivning
// berikad med objektkontext (objektnamn, adress, fasadnummer, kärlnummer,
// fraktion, utförandedatum) så mottagaren direkt förstår VAD som utförts och
// VAR raden debiteras. Fortnox radmodell saknar anpassade fält — referenserna
// bäddas därför in i Description-strängen.
//
// Källprecedens (revisionskorrekt): den frysta metadata-snapshoten på
// arbetsordern (work_orders.metadata_snapshot, satt vid expansion/frysning)
// vinner PER FÄLT. Saknade fält fylls från aktuell svensk objektmetadata
// (metadata_katalog/metadata_varden via getObjectsConditionMetadata). Aktuella
// värden får aldrig skriva över en träff från snapshoten.
//
// Metadatafältens namn är tenant-konfigurerbara — därför matchas varje referens
// mot en lista av normaliserade alias (diakritik-/skiftlägesokänsligt) och
// saknade värden hoppas tyst över. Arbetsorder utan snapshot/metadata ger en
// tom referensmängd och faller tillbaka till dagens radbeskrivning.

import { storage } from "../storage";
import { getObjectsConditionMetadata } from "../metadata-queries";
import type { WorkOrder } from "@shared/schema";

export interface ObjectInvoiceRefs {
  objektnamn?: string;
  adress?: string;
  fasadnummer?: string;
  karlnummer?: string;
  fraktion?: string;
  utforandedatum?: string; // YYYY-MM-DD
  // Kundreferens ("Er referens") sätts på FAKTURAHUVUDET (Fortnox saknar
  // radnivå-referens) — den bäddas därför ALDRIG in i radbeskrivningen.
  kundreferens?: string;
}

// Max längd på den berikade Description-strängen. Fortnox tillåter längre, men
// en stabil, läsbar radvy är viktigare än att klämma in allt — låg-prioriterade
// referenser fälls bort före hård avhuggning. Håll konservativt.
export const INVOICE_DESCRIPTION_MAX_LENGTH = 200;

// Normalisera en nyckel för diakritik-/skiftlägesokänslig jämförelse.
function normalizeKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_./-]+/g, "")
    .trim();
}

// Alias per referensfält (normaliserade). Första träffen med icke-tomt värde
// vinner. Lägg till synonymer här när nya tenant-konventioner upptäcks.
const REF_ALIASES: Record<keyof ObjectInvoiceRefs, string[]> = {
  objektnamn: ["objektnamn", "objekt", "namn"],
  adress: ["adress", "address", "postadress", "gatuadress", "besoksadress"],
  fasadnummer: ["fasadnummer", "fasadnr", "fasad", "fasnr"],
  karlnummer: [
    "karlnummer",
    "karlnr",
    "karlid",
    "behallarnummer",
    "tanknummer",
    "kannummer",
  ],
  fraktion: ["fraktion", "avfallsfraktion", "avfallstyp", "materialslag"],
  utforandedatum: [], // härleds från completedAt, ej från metadata
  kundreferens: [
    "kundreferens",
    "kundref",
    "erreferens",
    "yourreference",
    "bestallarreferens",
    "bestallarref",
    "ordreferens",
    "referens",
  ],
};

// Coerce ett godtyckligt metadatavärde till en kompakt visningssträng. Tomma /
// strukturerade tomvärden ignoreras (returnerar undefined).
function coerceToDisplay(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") {
    const t = value.trim();
    return t.length ? t : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value.map(coerceToDisplay).filter((s): s is string => !!s);
    return parts.length ? parts.join(", ") : undefined;
  }
  if (typeof value === "object") {
    // Vanliga former: { value: ... } eller { varde: ... } eller fritt JSON.
    const obj = value as Record<string, unknown>;
    for (const k of ["value", "varde", "text", "label", "namn"]) {
      if (k in obj) {
        const d = coerceToDisplay(obj[k]);
        if (d) return d;
      }
    }
    return undefined;
  }
  return undefined;
}

// Bygg en normaliserad nyckel→värde-karta från en metadata-källa (snapshot
// eller svensk villkorsmetadata). Senare nycklar skriver inte över tidigare.
function buildNormalizedLookup(
  source: Record<string, unknown> | null | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  if (!source) return out;
  for (const [key, value] of Object.entries(source)) {
    const norm = normalizeKey(key);
    if (!norm || out.has(norm)) continue;
    const display = coerceToDisplay(value);
    if (display) out.set(norm, display);
  }
  return out;
}

// Plocka första alias-träffen ur en normaliserad karta.
function pickAlias(
  lookup: Map<string, string>,
  aliases: string[],
): string | undefined {
  for (const alias of aliases) {
    const hit = lookup.get(alias);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Lös ut objektreferenser för en arbetsorder. Snapshot vinner per fält; saknade
 * fält fylls från aktuell svensk objektmetadata. Tenant-säkrad: objekt och
 * metadata läses alltid med tenantId. Best-effort — fel/avsaknad ger tomma
 * fält, aldrig kast.
 */
export async function resolveObjectInvoiceRefs(
  tenantId: string,
  workOrder: Pick<
    WorkOrder,
    "tenantId" | "objectId" | "completedAt" | "metadataSnapshot"
  > &
    Partial<Pick<WorkOrder, "externalReference">>,
): Promise<ObjectInvoiceRefs> {
  const refs: ObjectInvoiceRefs = {};

  // Utförandedatum härleds direkt från arbetsordern (ej metadata).
  if (workOrder.completedAt) {
    const d =
      workOrder.completedAt instanceof Date
        ? workOrder.completedAt
        : new Date(workOrder.completedAt as unknown as string);
    if (!Number.isNaN(d.getTime())) {
      refs.utforandedatum = d.toISOString().slice(0, 10);
    }
  }

  // Kundreferens (fakturahuvud) — lägsta prioritet: WO-skalären
  // external_reference. Snapshot-/live-metadata kan skriva över nedan (kräver
  // objectId). Sätts även för objektlösa arbetsordrar.
  if (workOrder.externalReference) {
    const t = String(workOrder.externalReference).trim();
    if (t) refs.kundreferens = t;
  }

  if (!workOrder.objectId) return refs;

  // 1) Frusen snapshot (revisionskorrekt) — vinner per fält.
  const snapshotLookup = buildNormalizedLookup(
    workOrder.metadataSnapshot as Record<string, unknown> | null | undefined,
  );

  const metaFields: (keyof ObjectInvoiceRefs)[] = [
    "objektnamn",
    "adress",
    "fasadnummer",
    "karlnummer",
    "fraktion",
  ];
  for (const field of metaFields) {
    const hit = pickAlias(snapshotLookup, REF_ALIASES[field]);
    if (hit) refs[field] = hit;
  }

  // Kundreferens: snapshot-metadata vinner över WO-skalären (external_reference).
  const kundrefSnapshot = pickAlias(snapshotLookup, REF_ALIASES.kundreferens);
  if (kundrefSnapshot) refs.kundreferens = kundrefSnapshot;

  // 2) Fyll saknade fält + kundreferens från aktuell svensk objektmetadata.
  //    Live-metadata vinner över WO-skalären men aldrig över snapshoten.
  const missing = metaFields.filter((f) => !refs[f]);
  const needLiveForKundref = !kundrefSnapshot;
  if (missing.length > 0 || needLiveForKundref) {
    try {
      const liveMap = await getObjectsConditionMetadata(tenantId, [
        workOrder.objectId,
      ]);
      const liveLookup = buildNormalizedLookup(liveMap.get(workOrder.objectId));
      for (const field of missing) {
        const hit = pickAlias(liveLookup, REF_ALIASES[field]);
        if (hit) refs[field] = hit;
      }
      if (needLiveForKundref) {
        const liveKundref = pickAlias(liveLookup, REF_ALIASES.kundreferens);
        if (liveKundref) refs.kundreferens = liveKundref;
      }
    } catch (err) {
      console.warn(
        "[invoice-enrichment] live metadata-lookup misslyckades:",
        err,
      );
    }
  }

  // 3) Objektnamn: föredra objektets faktiska namn (tenant-säkrad läsning) om
  //    varken snapshot eller metadata gav ett namn.
  if (!refs.objektnamn) {
    try {
      const obj = await storage.getObject(workOrder.objectId);
      if (obj && obj.tenantId === tenantId && obj.name) {
        refs.objektnamn = obj.name;
      }
    } catch (err) {
      console.warn("[invoice-enrichment] objekt-namnläsning misslyckades:", err);
    }
  }

  return refs;
}

// Ordnade referens-segment (hög → låg prioritet). Låg-prioriterade fälls bort
// först vid längdbegränsning.
function buildRefSegments(refs: ObjectInvoiceRefs): string[] {
  const segments: string[] = [];
  if (refs.objektnamn) segments.push(`Objekt: ${refs.objektnamn}`);
  if (refs.adress) segments.push(`Adress: ${refs.adress}`);
  if (refs.fasadnummer) segments.push(`Fasadnr: ${refs.fasadnummer}`);
  if (refs.karlnummer) segments.push(`Kärl: ${refs.karlnummer}`);
  if (refs.fraktion) segments.push(`Fraktion: ${refs.fraktion}`);
  if (refs.utforandedatum) segments.push(`Utfört: ${refs.utforandedatum}`);
  // OBS: kundreferens ingår medvetet INTE — den hör hemma på fakturahuvudet.
  return segments;
}

/**
 * Bygg den DELADE bastexten för en fakturarad (FÖRE berikning) så att enskild
 * och konsoliderad export aldrig kan drifta isär. Detta är kärnan i Task #1025:
 * radtexten måste bli IDENTISK oavsett exportväg.
 *
 * Prioritet:
 *  - Fritextrad (ingen artikel): radens egen `description` → `notes` → "Fritextrad".
 *  - Artikelrad: radens `notes` → frozen-markör (om fryst pris) → undefined
 *    (artikelnamnet i Fortnox + objektreferenserna räcker som radtext).
 *
 * OBS: bygg ALDRIG in WO-titel/id här. Det skulle göra en konsoliderad rad ≠
 * motsvarande enskild rad. Objekt-/koncept-referenser tillförs separat av
 * `formatEnrichedDescription`.
 */
export function buildInvoiceLineBaseText(
  line: {
    articleId?: string | null;
    notes?: string | null;
    description?: string | null;
  },
  opts?: { useFrozen?: boolean },
): string | undefined {
  if (!line.articleId) {
    return line.description || line.notes || "Fritextrad";
  }
  return line.notes || (opts?.useFrozen ? "Fryst pris (audit-snapshot)" : undefined);
}

/**
 * Komponera en berikad, läsbar radbeskrivning. Delas av enskild och konsoliderad
 * export så att raderna formateras IDENTISKT. Basetexten (artikeltext/notes)
 * behålls alltid; referenser läggs till i prioritetsordning och fälls bort från
 * svansen om maxlängden överskrids. Returnerar undefined om varken bastext eller
 * referenser finns (bevarar dagens beteende för rader utan beskrivning).
 */
export function formatEnrichedDescription(
  baseText: string | null | undefined,
  refs: ObjectInvoiceRefs,
): string | undefined {
  const base = (baseText ?? "").trim();
  const segments = buildRefSegments(refs);

  if (!base && segments.length === 0) return undefined;

  const sep = " · ";
  let result = base;
  for (const seg of segments) {
    const candidate = result ? `${result}${sep}${seg}` : seg;
    if (candidate.length <= INVOICE_DESCRIPTION_MAX_LENGTH) {
      result = candidate;
    } else {
      break; // släng detta och resterande låg-prioriterade segment
    }
  }

  // Edge: tom bastext + första (högst-prioriterade) segmentet är längre än
  // maxlängden → loopen hann inte lägga till något. Hugg av första segmentet i
  // stället för att tappa referensen helt och returnera undefined.
  if (!result && segments.length > 0) {
    result = segments[0];
  }

  if (result.length > INVOICE_DESCRIPTION_MAX_LENGTH) {
    result = result.slice(0, INVOICE_DESCRIPTION_MAX_LENGTH);
  }

  return result.length ? result : undefined;
}
