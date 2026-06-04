import { db } from "./db";
import { sql, eq, and, inArray, desc, asc } from "drizzle-orm";
import { computeFamilyValues } from "./metadata-formula";
import { METADATA_AREA_OPTIONS } from "@shared/metadata-areas";
import { 
  objects, 
  customers,
  articles,
  metadataKatalog, 
  metadataKatalogKunder,
  metadataAreas,
  metadataVarden,
  metadataHistorik,
  orderTypeMetadataLinks,
  MetadataArea,
  MetadataKatalog,
  MetadataVarden,
  MetadataHistorik,
  MetadataVardenWithKatalog,
  ObjectWithAllMetadataEAV,
  GeographicPosition,
  OrderTypeMetadataLink,
} from "@shared/schema";

// Task #663: katalogtyp berikad med dess kundlås-kopplingar (tom array = generellt
// fält, gäller alla kunder; en eller flera customerIds = kundlåst).
export type MetadataKatalogWithCustomers = MetadataKatalog & { customerIds: string[] };

// Task #682: ursprungsmodell. `metod` på metadata_varden bär ursprunget för
// VEM/VAD som satte värdet. Automatiska ursprung (system/tjänst/import/beräkning/
// arv/auto) skrivs av systemet och får aldrig sättas eller överskrivas manuellt.
// 'utforande' är legacy-ursprung för tjänst-skrivningar och behandlas som tjänst.
export const AUTOMATIC_ORIGIN_METHODS = new Set([
  'system', 'tjanst', 'utforande', 'import', 'berakning', 'arvd', 'auto', 'automatisk',
]);
export function isAutomaticOrigin(metod?: string | null): boolean {
  return metod != null && AUTOMATIC_ORIGIN_METHODS.has(metod);
}
// Skrivskyddade ursprung som inte får överskrivas av en manuell ändring.
export const READONLY_ORIGIN_METHODS = new Set(['system', 'tjanst', 'utforande']);
export function isReadonlyOrigin(metod?: string | null): boolean {
  return metod != null && READONLY_ORIGIN_METHODS.has(metod);
}

// Kastas när en manuell mutation försöker röra ett systemgenererat/read-only
// metadatafält. Mappas till HTTP 403 i route-lagret.
export class ReadonlyMetadataError extends Error {
  constructor(message = 'Systemgenererat metadatafält kan inte ändras manuellt') {
    super(message);
    this.name = 'ReadonlyMetadataError';
  }
}

// Kastas vid ogiltig metadata-input (t.ex. okända katalog-id i sorteringsordning).
// Mappas till HTTP 400 i route-lagret.
export class InvalidMetadataInputError extends Error {
  constructor(message = 'Ogiltig metadata-input') {
    super(message);
    this.name = 'InvalidMetadataInputError';
  }
}

export function getDisplayValue(existing: MetadataVarden): string | null {
  return existing.vardeString ?? 
    (existing.vardeInteger != null ? String(existing.vardeInteger) : null) ??
    (existing.vardeDecimal != null ? String(existing.vardeDecimal) : null) ??
    (existing.vardeBoolean != null ? String(existing.vardeBoolean) : null) ??
    (existing.vardeDatetime ? existing.vardeDatetime.toISOString() : null) ??
    (existing.vardeJson ? JSON.stringify(existing.vardeJson) : null) ??
    existing.vardeReferens ?? null;
}

// ============================================================================
// IMPORT-SKRIVHJÄLPARE (Task #632)
// Transaktionssäkra hjälpare för att skriva per-objekt-metadatavärden under
// Excel-objektimporten (post-it-modellen §6.12): ersättande (allowDuplicates=
// false) ersätter befintligt värde + arkiverar gamla till historik;
// kompletterande (allowDuplicates=true) lägger till värdet parallellt.
// ============================================================================

// En exekverare som antingen är den globala db-anslutningen eller en pågående
// transaktion (commitImport kör allt i db.transaction). Båda exponerar samma
// query-builder-API som dessa hjälpare använder (select/insert/update).
export type MetadataExecutor =
  | typeof db
  | Parameters<Parameters<typeof db["transaction"]>[0]>[0];

export type ImportMetadataWriteStatus = "create" | "replace" | "add" | "unchanged";

type VardeFields = {
  vardeString: string | null;
  vardeInteger: number | null;
  vardeDecimal: number | null;
  vardeBoolean: boolean | null;
  vardeDatetime: Date | null;
  vardeJson: unknown | null;
  vardeReferens: string | null;
};

// Coerca ett rådata-strängvärde till typade värdefält enligt datatyp.
// Kastar Error (svenskt meddelande) vid ogiltigt värde. Speglar valideringen i
// createMetadata/updateMetadata så import och manuell inmatning är konsekventa.
function coerceVardeFields(datatyp: string, raw: string): VardeFields {
  const fields: VardeFields = {
    vardeString: null,
    vardeInteger: null,
    vardeDecimal: null,
    vardeBoolean: null,
    vardeDatetime: null,
    vardeJson: null,
    vardeReferens: null,
  };
  const v = raw;
  switch (datatyp) {
    case "string":
      fields.vardeString = String(v);
      break;
    case "integer": {
      const n = parseInt(String(v), 10);
      if (isNaN(n)) throw new Error(`Ogiltigt heltal: "${v}"`);
      fields.vardeInteger = n;
      break;
    }
    case "decimal": {
      const n = parseFloat(String(v).replace(",", "."));
      if (isNaN(n)) throw new Error(`Ogiltigt decimaltal: "${v}"`);
      fields.vardeDecimal = n;
      break;
    }
    case "boolean": {
      const s = String(v).trim().toLowerCase();
      if (s === "true" || s === "1" || s === "ja" || s === "yes" || s === "x") {
        fields.vardeBoolean = true;
      } else if (s === "false" || s === "0" || s === "nej" || s === "no") {
        fields.vardeBoolean = false;
      } else {
        throw new Error(`Ogiltigt ja/nej-värde: "${v}"`);
      }
      break;
    }
    case "datetime": {
      const d = new Date(v);
      if (isNaN(d.getTime())) throw new Error(`Ogiltigt datum/tid-värde: "${v}"`);
      fields.vardeDatetime = d;
      break;
    }
    case "json":
    case "location":
      try {
        fields.vardeJson = JSON.parse(v);
      } catch {
        throw new Error(`Ogiltigt JSON-värde: "${v}"`);
      }
      break;
    case "referens":
      fields.vardeReferens = String(v);
      break;
    case "image":
    case "file":
    case "code":
    case "interval":
      fields.vardeString = String(v);
      break;
    default:
      throw new Error(`Okänd datatyp: ${datatyp}`);
  }
  return fields;
}

// Validera + coerca ett rådata-strängvärde mot en katalog-definition.
// Returnerar de typade värdefälten samt det normaliserade visningsvärdet
// (samma representation som getDisplayValue ger för en sparad rad), så att
// förhandsgranskning och commit jämför äpplen med äpplen. Kastar vid ogiltigt
// värde eller värde utanför allowedValues.
export function coerceMetadataVardeFromRaw(
  katalog: Pick<MetadataKatalog, "datatyp" | "allowedValues" | "namn">,
  raw: string,
): { vardeFields: VardeFields; displayValue: string } {
  if (katalog.allowedValues && katalog.allowedValues.length > 0) {
    if (!katalog.allowedValues.includes(raw)) {
      throw new Error(
        `Ogiltigt värde "${raw}" för "${katalog.namn}". Tillåtna värden: ${katalog.allowedValues.join(", ")}`,
      );
    }
  }
  const vardeFields = coerceVardeFields(katalog.datatyp, raw);
  const displayValue = getDisplayValue(vardeFields as MetadataVarden) ?? raw;
  return { vardeFields, displayValue };
}

// Räkna ut förhandsstatus (skapa/ersätt/lägg till/oförändrad) för ett
// importerat värde, givet de befintliga lokala visningsvärdena på objektet.
// Ren funktion utan DB-anrop — används i förhandsgranskningen.
export function computeImportMetadataStatus(
  allowDuplicates: boolean,
  existingDisplayValues: string[],
  newDisplayValue: string,
): ImportMetadataWriteStatus {
  if (allowDuplicates) {
    return existingDisplayValues.includes(newDisplayValue) ? "unchanged" : "add";
  }
  if (existingDisplayValues.length === 0) return "create";
  return existingDisplayValues[0] === newDisplayValue ? "unchanged" : "replace";
}

// Skriv ett importerat metadatavärde på ett objekt med post-it-modellens
// beteende. Körs med medskickad exekverare (transaktion) så hela importen
// förblir atomär. Returnerar vad som hände (för räkning/loggning).
export async function writeImportedMetadataValue(
  exec: MetadataExecutor,
  args: {
    tenantId: string;
    objektId: string;
    katalog: MetadataKatalog;
    rawValue: string;
    andradAv?: string | null;
  },
): Promise<ImportMetadataWriteStatus> {
  const { tenantId, objektId, katalog } = args;
  const andradAv = args.andradAv ?? "import";
  const { vardeFields, displayValue } = coerceMetadataVardeFromRaw(katalog, args.rawValue);

  const existing = await exec
    .select()
    .from(metadataVarden)
    .where(and(
      eq(metadataVarden.objektId, objektId),
      eq(metadataVarden.metadataKatalogId, katalog.id),
      eq(metadataVarden.tenantId, tenantId),
    ));

  const insertValue = async (): Promise<string> => {
    const [inserted] = await exec.insert(metadataVarden).values({
      tenantId,
      objektId,
      metadataKatalogId: katalog.id,
      ...vardeFields,
      arvsNedat: katalog.standardArvs,
      skapadAv: andradAv ?? undefined,
      metod: "import",
    }).returning();
    return inserted.id;
  };
  const writeHistorik = async (
    vardenId: string | null,
    gammaltVarde: string | null,
  ): Promise<void> => {
    await exec.insert(metadataHistorik).values({
      tenantId,
      metadataVardenId: vardenId,
      objektId,
      metadataKatalogId: katalog.id,
      gammaltVarde,
      nyttVarde: displayValue,
      andradAv: andradAv ?? "import",
      andringsMetod: "import",
    });
  };

  // Kompletterande (post-it bredvid): lägg till parallellt, men hoppa över om
  // ett identiskt värde redan finns (gör re-import idempotent).
  if (katalog.allowDuplicates) {
    const identical = existing.some((e) => getDisplayValue(e) === displayValue);
    if (identical) return "unchanged";
    const vardenId = await insertValue();
    await writeHistorik(vardenId, null);
    return "add";
  }

  // Ersättande (post-it ovanpå): max ett lokalt värde — ersätt och arkivera.
  if (existing.length === 0) {
    const vardenId = await insertValue();
    await writeHistorik(vardenId, null);
    return "create";
  }
  const current = existing[0];
  const oldDisplay = getDisplayValue(current);
  if (oldDisplay === displayValue) return "unchanged";
  await exec
    .update(metadataVarden)
    .set({ ...vardeFields, uppdateradAv: andradAv ?? undefined, metod: "import", updatedAt: new Date() })
    .where(and(eq(metadataVarden.id, current.id), eq(metadataVarden.tenantId, tenantId)));
  await writeHistorik(current.id, oldDisplay);
  return "replace";
}

// ============================================================================
// METADATAREFERENS SOM STABIL UNIVERSELL NYCKEL (Task #645)
// ----------------------------------------------------------------------------
// Referensnamnet på en metadatatyp (`metadata_katalog.namn` + den korta
// `beteckning`) är inte bara en Excel-header vid import — det är en universell,
// stabil nyckel som binder ihop import-matchning, order-/koncept-filter
// (`concept_filters.metadata_key`) och sök/filter. Den fungerar som en API-
// nyckel snarare än en etikett. Därför får referensen inte tyst döpas om när
// typen redan ANVÄNDS, eftersom det skulle bryta dessa kopplingar.
//
// "Används" räknas här som: (a) det finns metadatavärden (objekt eller WO,
// inkl. importerade) som pekar på katalogposten, eller (b) ett koncept-filter
// matchar referensen via `metadata_key` (namn eller beteckning). Räkningen
// centraliseras här så att samma definition av "i bruk" används i route-
// blockeringen och kan återanvändas av UI/scheduler.
export interface MetadataKatalogUsage {
  katalogId: string;
  namn: string | null;
  beteckning: string | null;
  valueCount: number;        // rader i metadata_varden (objekt + WO, inkl. import)
  conceptFilterCount: number; // concept_filters som matchar namn/beteckning
  total: number;
}

export async function getMetadataKatalogUsage(
  katalogId: string,
  tenantId: string,
): Promise<MetadataKatalogUsage> {
  const [katalog] = await db
    .select({ namn: metadataKatalog.namn, beteckning: metadataKatalog.beteckning })
    .from(metadataKatalog)
    .where(and(eq(metadataKatalog.id, katalogId), eq(metadataKatalog.tenantId, tenantId)));

  if (!katalog) {
    return {
      katalogId,
      namn: null,
      beteckning: null,
      valueCount: 0,
      conceptFilterCount: 0,
      total: 0,
    };
  }

  const valuesRes = await db.execute(sql`
    SELECT COUNT(*)::int AS c
    FROM metadata_varden
    WHERE tenant_id = ${tenantId} AND metadata_katalog_id = ${katalogId}
  `);
  const valueCount = Number((valuesRes.rows[0] as { c: number } | undefined)?.c ?? 0);

  // concept_filters saknar tenant_id — scopas via order_concepts. Referensen kan
  // anges som antingen namn eller den korta beteckningen, så vi matchar båda.
  const refKeys = [katalog.namn, katalog.beteckning].filter(
    (k): k is string => typeof k === "string" && k.length > 0,
  );
  let conceptFilterCount = 0;
  if (refKeys.length > 0) {
    const filtersRes = await db.execute(sql`
      SELECT COUNT(*)::int AS c
      FROM concept_filters cf
      JOIN order_concepts oc ON oc.id = cf.order_concept_id
      WHERE oc.tenant_id = ${tenantId}
        AND oc.deleted_at IS NULL
        AND cf.metadata_key IN (${sql.join(refKeys, sql`, `)})
    `);
    conceptFilterCount = Number((filtersRes.rows[0] as { c: number } | undefined)?.c ?? 0);
  }

  return {
    katalogId,
    namn: katalog.namn ?? null,
    beteckning: katalog.beteckning ?? null,
    valueCount,
    conceptFilterCount,
    total: valueCount + conceptFilterCount,
  };
}

// ============================================================================
// SAMMANSATTA (JSON) FÄLT — PER-UNDERFÄLT-ARV (Task #644)
// ----------------------------------------------------------------------------
// Sammansatta metadatafält (punktnotation `adress.gata`, `kontaktperson.namn`
// osv) lagras som EN katalog-post med datatyp "json" där underfälten ligger i
// `varde_json` (se objektmall-importens buildCompositeObject/asJsonKatalog).
//
// Vid resolvning längs den primära förälderkedjan mergas underfält per
// underfält: närmaste objekt som definierar ett underfält vinner det, övriga
// underfält ärvs från längre upp i kedjan. Exempel: ett rum som bara sätter
// `adress.gata` behåller ärvt `postnummer`/`ort` från fastigheten ovanför.
//
// Endast objekt-formade json-värden mergas. Arrayer och primitiver behandlas
// som atomära — då används närmaste värdet oförändrat, så icke-sammansatta
// json-fält bevarar sin tidigare "närmaste-vinner"-semantik (allt-eller-inget).
// Vanlig arvskontroll (arvs_nedat / stoppa_vidare_arvning / niva_las) styr
// fortfarande VILKA nivåer som finns med i `valuesNearestFirst` — den filtreras
// i den rekursiva CTE:n innan denna merge körs — så breaks_inheritance/fixed
// kapar kedjan på vanligt sätt även för sammansatta fält.
export function mergeCompositeJsonValues(valuesNearestFirst: unknown[]): unknown {
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);

  const nearest = valuesNearestFirst.length > 0 ? valuesNearestFirst[0] : null;
  if (!isPlainObject(nearest)) {
    return nearest ?? null;
  }

  const merged: Record<string, unknown> = {};
  for (const value of valuesNearestFirst) {
    if (!isPlainObject(value)) continue;
    for (const key of Object.keys(value)) {
      if (!(key in merged)) {
        merged[key] = value[key];
      }
    }
  }
  return merged;
}

// ============================================================================
// HÄMTA OBJEKT MED ALL METADATA (INKL. ÄRVD)
// Rekursiv CTE som går uppåt i hierarkin och samlar metadata
// ============================================================================

export async function getObjectWithAllMetadata(
  objektId: string,
  tenantId: string
): Promise<ObjectWithAllMetadataEAV | null> {
  const [objekt] = await db
    .select()
    .from(objects)
    .where(and(eq(objects.id, objektId), eq(objects.tenantId, tenantId)));

  if (!objekt) return null;

  // Build parent chain with stoppaVidareArvning tracking
  // The CTE now tracks which metadata types should be blocked from further inheritance
  const parentChainQuery = sql`
    WITH RECURSIVE parent_chain AS (
      SELECT
        id,
        parent_id,
        name,
        0 as level,
        ARRAY[]::varchar[] as blocked_katalog_ids
      FROM objects
      WHERE id = ${objektId} AND tenant_id = ${tenantId}

      UNION ALL

      SELECT
        o.id,
        o.parent_id,
        o.name,
        pc.level + 1,
        -- Accumulate blocked katalog IDs when we encounter stoppaVidareArvning
        pc.blocked_katalog_ids || COALESCE(
          (SELECT ARRAY_AGG(mv.metadata_katalog_id) 
           FROM metadata_varden mv 
           WHERE mv.objekt_id = pc.id 
             AND mv.stoppa_vidare_arvning = TRUE
             AND mv.tenant_id = ${tenantId}),
          ARRAY[]::varchar[]
        )
      FROM objects o
      INNER JOIN parent_chain pc ON o.id = pc.parent_id
      WHERE o.tenant_id = ${tenantId}
    ),
    metadata_with_context AS (
      SELECT
        mv.id,
        mv.objekt_id,
        mv.metadata_katalog_id,
        mv.varde_string,
        mv.varde_integer,
        mv.varde_decimal,
        mv.varde_boolean,
        mv.varde_datetime,
        mv.varde_json,
        mv.varde_referens,
        mv.arvs_nedat,
        mv.stoppa_vidare_arvning,
        mv.niva_las,
        mv.kopplad_till_metadata_id,
        mv.skapad_av,
        mv.uppdaterad_av,
        mv.metod,
        mv.raderad,
        mv.created_at,
        mv.updated_at,
        mk.id as katalog_id,
        mk.namn as katalog_namn,
        mk.beskrivning as katalog_beskrivning,
        mk.datatyp as katalog_datatyp,
        mk.referens_tabell as katalog_referens_tabell,
        mk.ar_logisk as katalog_ar_logisk,
        mk.standard_arvs as katalog_standard_arvs,
        mk.kategori as katalog_kategori,
        mk.sort_order as katalog_sort_order,
        mk.icon as katalog_icon,
        mk.area as katalog_area,
        mk.display_number as katalog_display_number,
        mk.allow_duplicates as katalog_allow_duplicates,
        mk.allowed_values as katalog_allowed_values,
        mk.beteckning as katalog_beteckning,
        mk.is_system as katalog_is_system,
        mk.is_required as katalog_is_required,
        mk.kronologisk_visning as katalog_kronologisk_visning,
        pc.level,
        pc.name as from_objekt_namn,
        pc.blocked_katalog_ids,
        CASE
          WHEN mv.objekt_id = ${objektId} THEN 'local'
          ELSE 'inherited'
        END as source,
        -- Rank by level (0 = local object, higher = further ancestor)
        ROW_NUMBER() OVER (
          PARTITION BY mv.metadata_katalog_id 
          ORDER BY pc.level ASC
        ) as rn
      FROM parent_chain pc
      INNER JOIN metadata_varden mv ON mv.objekt_id = pc.id
      INNER JOIN metadata_katalog mk ON mv.metadata_katalog_id = mk.id
      WHERE
        -- Include if local OR (inheritable AND not blocked by stoppa_vidare_arvning AND not niva_las)
        -- Task #710: mjuk-raderade förälder-rader (raderad=TRUE) ärvs aldrig nedåt —
        -- ett borttaget värde ska inte flöda till barn. Lokala rader (inkl. tombstones)
        -- behålls alltid så att den strukna markeringen kan visas på objektets egen nivå.
        (
          mv.objekt_id = ${objektId} 
          OR (mv.arvs_nedat = TRUE AND COALESCE(mv.niva_las, FALSE) = FALSE AND COALESCE(mv.raderad, FALSE) = FALSE AND NOT (mv.metadata_katalog_id = ANY(pc.blocked_katalog_ids)))
        )
        AND mv.tenant_id = ${tenantId}
        AND mk.tenant_id = ${tenantId}
    )
    -- Task #644: behåll ALLA berättigade nivåer (ej bara rn=1). Skalära fält tar
    -- fortfarande närmaste värdet (rn=1) i JS nedan, men sammansatta json-fält
    -- behöver hela nivåkedjan för att kunna mergas per underfält. Sortering på
    -- metadata_katalog_id + rn samlar varje katalog kontiguöst, närmast först.
    SELECT * FROM metadata_with_context
    ORDER BY
      katalog_kategori,
      katalog_sort_order,
      metadata_katalog_id,
      rn
  `;

  const metadataResults = await db.execute(parentChainQuery);

  // Task #644: gruppera rader per katalog (raderna är redan ordnade närmast-först
  // inom varje katalog via ORDER BY ... metadata_katalog_id, rn). För skalära fält
  // används närmaste raden (den första) precis som tidigare; för sammansatta
  // json-fält mergas underfälten per underfält längs kedjan (närmaste vinner).
  const rowsByKatalog = new Map<string, any[]>();
  const katalogOrder: string[] = [];
  for (const row of metadataResults.rows as any[]) {
    // Dedup/gruppera på katalog_id (inte namn) för korrekt tenant-isolering.
    let group = rowsByKatalog.get(row.katalog_id);
    if (!group) {
      group = [];
      rowsByKatalog.set(row.katalog_id, group);
      katalogOrder.push(row.katalog_id);
    }
    group.push(row);
  }

  const metadataWithKatalog: MetadataVardenWithKatalog[] = [];

  // Task #710: visningsvärde för en rå CTE-rad (snake_case) — speglar getDisplayValue.
  const rawRowDisplay = (r: any): string | null =>
    r.varde_string ??
    (r.varde_integer != null ? String(r.varde_integer) : null) ??
    (r.varde_decimal != null ? String(r.varde_decimal) : null) ??
    (r.varde_boolean != null ? String(r.varde_boolean) : null) ??
    (r.varde_datetime ? new Date(r.varde_datetime).toISOString() : null) ??
    (r.varde_json ? JSON.stringify(r.varde_json) : null) ??
    r.varde_referens ??
    null;

  for (const katalogId of katalogOrder) {
    const group = rowsByKatalog.get(katalogId)!;
    const nearest = group[0];

    // Task #710: ursprung/override/mjuk-radering per katalog-grupp. Gruppen är
    // ordnad närmast-först; den lokala raden (om någon) ligger först, ärvda rader
    // (source='inherited') följer. En lokal rad bredvid en ärvbar förälder-rad =
    // override ("Ärvd, men ändrad"). En lokal rad med raderad=TRUE = mjuk-raderad
    // (eget värde dolt, eller tombstone som stryker ett ärvt värde).
    const nearestIsLocal = nearest.objekt_id === objektId;
    const inheritedRow = group.find((r) => r.source === "inherited");
    const hasLocalShadow = nearestIsLocal && inheritedRow != null;
    const softDeleted = nearestIsLocal && nearest.raderad === true;
    const nearestHasOwnValue = rawRowDisplay(nearest) != null;
    const overridden = hasLocalShadow && !softDeleted && nearestHasOwnValue;
    const inheritedValue =
      hasLocalShadow || softDeleted ? (inheritedRow ? rawRowDisplay(inheritedRow) : null) : null;
    const inheritedFromName =
      hasLocalShadow || softDeleted ? (inheritedRow?.from_objekt_namn ?? null) : null;

    // Sammansatta json-fält: merga underfält över alla nivåer (närmaste först).
    // Övriga datatyper: använd närmaste värdet oförändrat.
    const resolvedVardeJson =
      nearest.katalog_datatyp === "json"
        ? mergeCompositeJsonValues(group.map((r) => r.varde_json))
        : nearest.varde_json;

    metadataWithKatalog.push({
      id: nearest.id,
      tenantId: tenantId,
      objektId: nearest.objekt_id,
      workOrderId: null, // Object metadata doesn't have workOrderId
      metadataKatalogId: nearest.metadata_katalog_id,
      vardeString: nearest.varde_string,
      vardeInteger: nearest.varde_integer,
      vardeDecimal: nearest.varde_decimal,
      vardeBoolean: nearest.varde_boolean,
      vardeDatetime: nearest.varde_datetime,
      vardeJson: resolvedVardeJson,
      vardeReferens: nearest.varde_referens,
      arvsNedat: nearest.arvs_nedat,
      stoppaVidareArvning: nearest.stoppa_vidare_arvning,
      nivaLas: nearest.niva_las ?? false,
      koppladTillMetadataId: nearest.kopplad_till_metadata_id,
      skapadAv: nearest.skapad_av,
      uppdateradAv: nearest.uppdaterad_av,
      metod: nearest.metod ?? 'manuell',
      createdAt: nearest.created_at,
      updatedAt: nearest.updated_at,
      katalog: {
        id: nearest.katalog_id,
        tenantId: tenantId,
        namn: nearest.katalog_namn,
        beskrivning: nearest.katalog_beskrivning,
        datatyp: nearest.katalog_datatyp,
        referensTabell: nearest.katalog_referens_tabell,
        arLogisk: nearest.katalog_ar_logisk,
        standardArvs: nearest.katalog_standard_arvs,
        kategori: nearest.katalog_kategori,
        sortOrder: nearest.katalog_sort_order,
        icon: nearest.katalog_icon,
        area: nearest.katalog_area ?? null,
        displayNumber: nearest.katalog_display_number ?? null,
        allowDuplicates: nearest.katalog_allow_duplicates ?? false,
        allowedValues: nearest.katalog_allowed_values ?? null,
        beteckning: nearest.katalog_beteckning ?? null,
        isSystem: nearest.katalog_is_system ?? false,
        isRequired: nearest.katalog_is_required ?? false,
        kronologiskVisning: nearest.katalog_kronologisk_visning ?? false,
        createdAt: nearest.created_at,
      } as any,
      source: nearest.source,
      fromObject: nearest.source === 'inherited' ? {
        id: nearest.objekt_id,
        namn: nearest.from_objekt_namn,
        level: nearest.level,
      } : undefined,
      // Task #710
      overridden,
      inheritedValue,
      inheritedFromName,
      softDeleted,
      raderad: nearest.raderad === true,
    });
  }

  // Task #663: filtrera bort kundlåsta fält som inte hör till objektets kund.
  // Ett fält utan kopplingar är generellt (alltid med). Ett kundlåst fält behålls
  // bara om objektets kund (eller någon av dess förfäder) finns bland de kopplade
  // kunderna. Saknar objektet kund kan inget kundlås matcha → endast generella fält.
  const customerLinks = await getMetadataCustomerLinks(tenantId);
  const hasAnyLock = Array.from(customerLinks.values()).some((l) => l.length > 0);
  let filteredMetadata = metadataWithKatalog;
  if (hasAnyLock) {
    const scope = objekt.customerId
      ? await getCustomerSelfAndAncestorIds(tenantId, objekt.customerId)
      : new Set<string>();
    filteredMetadata = metadataWithKatalog.filter((m) =>
      isMetadataAllowedForCustomerScope(customerLinks.get(m.metadataKatalogId), scope),
    );
  }

  // Task #666: injicera beräknade fält (derive-on-read). Ett beräknat katalogfält
  // lagrar inget eget värde — det räknas ut per familj från syskonfältens numeriska
  // värden vid läsning, så det alltid speglar aktuella indata och visas readonly.
  // Ogiltiga formler (okänt fält, division med noll, cirkelreferens) ger ett tydligt
  // felmeddelande på fältet utan att krascha övriga fält (se computeFamilyValues).
  const allTypes = await getAllMetadataTypes(tenantId);
  // Alla katalogtyper som är markerade beräknade (även de med ogiltig/tom formel).
  // Eventuella lagrade värden för dessa (t.ex. fält som var vanligt och senare
  // gjordes beräknat) ska aldrig visas eller mata syskonformler — derive-on-read
  // är auktoritativt. Strippa dem ur filteredMetadata innan vi bygger baseValues.
  const computedTypeIds = new Set(
    allTypes.filter((t) => t.arBeraknad).map((t) => t.id),
  );
  if (computedTypeIds.size > 0) {
    filteredMetadata = filteredMetadata.filter(
      (m) => !computedTypeIds.has(m.metadataKatalogId),
    );
  }
  const computedTypes = allTypes.filter(
    (t) => t.arBeraknad && t.formel && t.formel.trim() !== "" && t.parentMetadataId,
  );
  if (computedTypes.length > 0) {
    // SQL-frågan ovan selekterar inte arBeraknad/formel/parentMetadataId — berika
    // redan upplösta entries så klienten kan visa formel-info och familjegruppering.
    const typeById = new Map(allTypes.map((t) => [t.id, t]));
    for (const entry of filteredMetadata) {
      const t = typeById.get(entry.metadataKatalogId);
      if (t) {
        (entry.katalog as any).arBeraknad = t.arBeraknad;
        (entry.katalog as any).formel = t.formel;
        (entry.katalog as any).parentMetadataId = t.parentMetadataId;
      }
    }

    // Kundlås-scope för beräknade fält (samma regel som för lagrade fält ovan).
    const computedScope = objekt.customerId
      ? await getCustomerSelfAndAncestorIds(tenantId, objekt.customerId)
      : new Set<string>();

    // Numeriska syskonvärden per familj (parentMetadataId → { fältnamn: nummer }).
    const baseValuesByFamily = new Map<string, Record<string, number>>();
    const familiesPresent = new Set<string>();
    const existingKatalogIds = new Set(filteredMetadata.map((m) => m.metadataKatalogId));
    for (const entry of filteredMetadata) {
      const parentId = (entry.katalog as any).parentMetadataId as string | null;
      if (!parentId) continue;
      familiesPresent.add(parentId);
      let values = baseValuesByFamily.get(parentId);
      if (!values) {
        values = {};
        baseValuesByFamily.set(parentId, values);
      }
      const num = entry.vardeInteger ?? entry.vardeDecimal;
      if (typeof num === "number" && Number.isFinite(num)) {
        values[entry.katalog.namn] = num;
      }
    }

    // Gruppera beräknade fält per familj. Objektvyn är värdedriven: vi injicerar
    // bara beräknade fält i familjer som faktiskt har minst ett värde på objektet.
    const computedByFamily = new Map<string, MetadataKatalog[]>();
    for (const t of computedTypes) {
      const pid = t.parentMetadataId!;
      if (!familiesPresent.has(pid)) continue;
      if (hasAnyLock && !isMetadataAllowedForCustomerScope(customerLinks.get(t.id), computedScope)) {
        continue;
      }
      const arr = computedByFamily.get(pid) ?? [];
      arr.push(t);
      computedByFamily.set(pid, arr);
    }

    for (const entry of Array.from(computedByFamily.entries())) {
      const [parentId, fields] = entry;
      const baseValues = baseValuesByFamily.get(parentId) ?? {};
      // Beräknade syskon skickas in som beräknade fält så formler kan referera
      // varandra (t.ex. volym = yta * hojd). computeFamilyValues löser ordningen
      // och detekterar cirkelreferenser.
      const results = computeFamilyValues(
        baseValues,
        fields.map((f) => ({ namn: f.namn, formel: f.formel })),
      );
      for (const f of fields) {
        // Hoppa över om ett riktigt lagrat värde redan finns för fältet.
        if (existingKatalogIds.has(f.id)) continue;
        const res = results[f.namn];
        const isInteger = f.datatyp === "integer";
        let vardeInteger: number | null = null;
        let vardeDecimal: number | null = null;
        if (res && res.value !== null) {
          if (isInteger) vardeInteger = Math.round(res.value);
          else vardeDecimal = res.value;
        }
        filteredMetadata.push({
          id: `computed-${f.id}`,
          tenantId,
          objektId,
          workOrderId: null,
          metadataKatalogId: f.id,
          vardeString: null,
          vardeInteger,
          vardeDecimal,
          vardeBoolean: null,
          vardeDatetime: null,
          vardeJson: null,
          vardeReferens: null,
          arvsNedat: false,
          stoppaVidareArvning: false,
          nivaLas: false,
          koppladTillMetadataId: null,
          skapadAv: null,
          uppdateradAv: null,
          metod: "berakning",
          createdAt: f.createdAt,
          updatedAt: f.createdAt,
          katalog: f as any,
          source: "computed",
          computed: true,
          computedError: res ? res.error : "Kunde inte beräkna",
        });
      }
    }
  }

  // Task #710: per-objekt sorteringsordning. Hämta närmaste icke-null
  // `metadata_field_order` uppåt i förälderkedjan (ordningen ärvs nedåt, aldrig
  // uppåt). Fält som finns i ordningen sorteras enligt den; övriga behåller sin
  // nuvarande relativa ordning (katalog-kategori/sort_order) efteråt.
  const orderRes = await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, metadata_field_order, 0 AS depth
      FROM objects
      WHERE id = ${objektId} AND tenant_id = ${tenantId}
      UNION ALL
      SELECT o.id, o.parent_id, o.metadata_field_order, c.depth + 1
      FROM objects o
      INNER JOIN chain c ON o.id = c.parent_id
      WHERE o.tenant_id = ${tenantId}
    )
    SELECT metadata_field_order
    FROM chain
    WHERE metadata_field_order IS NOT NULL
    ORDER BY depth ASC
    LIMIT 1
  `);
  const fieldOrder = orderRes.rows[0]?.metadata_field_order as string[] | null | undefined;
  if (Array.isArray(fieldOrder) && fieldOrder.length > 0) {
    const orderIndex = new Map<string, number>();
    fieldOrder.forEach((kid, i) => orderIndex.set(kid, i));
    filteredMetadata.forEach((m) => {
      m.sortIndex = orderIndex.has(m.metadataKatalogId)
        ? orderIndex.get(m.metadataKatalogId)!
        : null;
    });
    const decorated = filteredMetadata.map((m, i) => ({ m, i }));
    decorated.sort((a, b) => {
      const ai = a.m.sortIndex ?? null;
      const bi = b.m.sortIndex ?? null;
      if (ai != null && bi != null) return ai - bi || a.i - b.i;
      if (ai != null) return -1;
      if (bi != null) return 1;
      return a.i - b.i;
    });
    filteredMetadata = decorated.map((x) => x.m);
  }

  return {
    id: objekt.id,
    name: objekt.name,
    objectType: objekt.objectType,
    parentId: objekt.parentId,
    metadata: filteredMetadata,
  };
}

// ============================================================================
// HÄMTA METADATA-VÄRDE (med ärvning)
// ============================================================================

export async function getMetadataValue(
  objektId: string,
  metadataTypNamn: string,
  tenantId: string
): Promise<any | null> {
  const objectWithMetadata = await getObjectWithAllMetadata(objektId, tenantId);
  
  if (!objectWithMetadata) return null;

  const metadata = objectWithMetadata.metadata.find(m => m.katalog.namn === metadataTypNamn);
  
  if (!metadata) return null;

  switch (metadata.katalog.datatyp) {
    case 'string':
      return metadata.vardeString;
    case 'integer':
      return metadata.vardeInteger;
    case 'decimal':
      return metadata.vardeDecimal;
    case 'boolean':
      return metadata.vardeBoolean;
    case 'datetime':
      return metadata.vardeDatetime;
    case 'json':
      return metadata.vardeJson;
    case 'referens':
      return metadata.vardeReferens;
    default:
      return null;
  }
}

// ============================================================================
// SKAPA METADATA
// ============================================================================

// Task #681: kopiera ett objekts LOKALA (direkta) metadatavärden till ett annat
// objekt. Endast rader som faktiskt ligger på källobjektet kopieras — ärvda
// värden hoppas över eftersom de ärvs naturligt via hierarkin på målobjektet.
// Beräknade fält finns aldrig i metadata_varden (derive-on-read) och kopieras
// därför aldrig. Alla värdekolumner och ärvningsflaggor bevaras 1:1.
export async function copyObjectLocalMetadata(
  sourceObjectId: string,
  targetObjectId: string,
  tenantId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(metadataVarden)
    .where(and(
      eq(metadataVarden.objektId, sourceObjectId),
      eq(metadataVarden.tenantId, tenantId),
    ));
  if (rows.length === 0) return 0;
  const toInsert = rows.map((r) => ({
    tenantId,
    objektId: targetObjectId,
    metadataKatalogId: r.metadataKatalogId,
    vardeString: r.vardeString,
    vardeInteger: r.vardeInteger,
    vardeDecimal: r.vardeDecimal,
    vardeBoolean: r.vardeBoolean,
    vardeDatetime: r.vardeDatetime,
    vardeJson: r.vardeJson,
    vardeReferens: r.vardeReferens,
    arvsNedat: r.arvsNedat,
    stoppaVidareArvning: r.stoppaVidareArvning,
    nivaLas: r.nivaLas,
    koppladTillMetadataId: r.koppladTillMetadataId,
    skapadAv: r.skapadAv,
    metod: r.metod,
  }));
  await db.insert(metadataVarden).values(toInsert);
  return toInsert.length;
}

export async function createMetadata(data: {
  tenantId: string;
  objektId: string;
  metadataTypNamn: string;
  varde: string | number | boolean | Date | Record<string, unknown> | null;
  arvsNedat?: boolean;
  nivaLas?: boolean;
  koppladTillMetadataId?: string | null;
  skapadAv?: string;
  metod?: string;
}): Promise<MetadataVarden> {
  // SECURITY: Verify object belongs to tenant before allowing metadata creation
  const [objekt] = await db
    .select()
    .from(objects)
    .where(and(
      eq(objects.id, data.objektId),
      eq(objects.tenantId, data.tenantId)
    ));

  if (!objekt) {
    throw new Error(`Object "${data.objektId}" not found or does not belong to tenant`);
  }

  // Verify metadata type exists for this tenant
  const [metadataTyp] = await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.namn, data.metadataTypNamn),
      eq(metadataKatalog.tenantId, data.tenantId)
    ));

  if (!metadataTyp) {
    throw new Error(`Metadata type "${data.metadataTypNamn}" not found for this tenant`);
  }

  // Task #666: beräknade fält är readonly — värdet härleds vid läsning från
  // formeln och får aldrig lagras manuellt (skulle annars permanent överskugga
  // beräkningen i läs-vägen).
  if (metadataTyp.arBeraknad) {
    throw new Error(`"${metadataTyp.namn}" är ett beräknat fält och kan inte sättas manuellt — värdet räknas ut automatiskt från formeln.`);
  }

  // Task #682: systemfält (isSystem) sätts enbart av systemet via auto-ursprung
  // (system/tjänst/import/beräkning/arv/auto). En manuell skrivning (metod=manuell
  // eller utelämnad) avvisas så att read-only-garantin håller även på API-nivån.
  if (metadataTyp.isSystem && !isAutomaticOrigin(data.metod)) {
    throw new Error(`"${metadataTyp.namn}" är ett systemfält och sätts automatiskt — det kan inte anges manuellt.`);
  }

  // PDF §7/§14: dropdown-validering (allowedValues)
  if (metadataTyp.allowedValues && metadataTyp.allowedValues.length > 0) {
    const asString = data.varde === null || data.varde === undefined ? '' : String(data.varde);
    if (!metadataTyp.allowedValues.includes(asString)) {
      throw new Error(`Ogiltigt värde för "${metadataTyp.namn}". Tillåtna värden: ${metadataTyp.allowedValues.join(', ')}`);
    }
  }

  // PDF §14: respektera nivå-lås från ärvda värden — gå alltid via objektets
  // ancestor-kedja (rekursivt CTE) och kolla om någon förälder har niva_las=TRUE
  // för samma katalog. Deterministiskt och oberoende av tenant-bred volym.
  const lockCheck = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, 0 AS depth
      FROM objects
      WHERE id = ${objekt.parentId ?? null}::text AND tenant_id = ${data.tenantId}
      UNION ALL
      SELECT o.id, o.parent_id, a.depth + 1
      FROM objects o
      INNER JOIN ancestors a ON o.id = a.parent_id
      WHERE o.tenant_id = ${data.tenantId} AND a.depth < 100
    )
    SELECT a.id AS objekt_id
    FROM ancestors a
    INNER JOIN metadata_varden mv ON mv.objekt_id = a.id
    WHERE mv.tenant_id = ${data.tenantId}
      AND mv.metadata_katalog_id = ${metadataTyp.id}
      AND mv.niva_las = TRUE
    LIMIT 1
  `);
  if ((lockCheck.rows as any[]).length > 0) {
    throw new Error(`Nivå-lås: värdet för "${metadataTyp.namn}" är låst av en förälder och kan inte överskridas på denna nivå.`);
  }
  // PDF §14: dubblettkontroll (allowDuplicates=false → max ett lokalt värde per objekt)
  if (!metadataTyp.allowDuplicates) {
    const [duplicate] = await db
      .select({ id: metadataVarden.id })
      .from(metadataVarden)
      .where(and(
        eq(metadataVarden.objektId, data.objektId),
        eq(metadataVarden.metadataKatalogId, metadataTyp.id),
        eq(metadataVarden.tenantId, data.tenantId)
      ))
      .limit(1);
    if (duplicate) {
      throw new Error(`Dubblett: "${metadataTyp.namn}" finns redan på objektet. Tillåt dubbletter i katalogen om flera värden behövs.`);
    }
  }

  const vardeFields: Record<string, string | number | boolean | Date | Record<string, unknown> | null> = {
    vardeString: null,
    vardeInteger: null,
    vardeDecimal: null,
    vardeBoolean: null,
    vardeDatetime: null,
    vardeJson: null,
    vardeReferens: null,
  };

  // VALIDATION: Strict datatype validation for all types
  switch (metadataTyp.datatyp) {
    case 'string':
      vardeFields.vardeString = String(data.varde);
      break;
    case 'integer':
      vardeFields.vardeInteger = parseInt(String(data.varde));
      if (isNaN(vardeFields.vardeInteger)) {
        throw new Error(`Invalid integer value: ${data.varde}`);
      }
      break;
    case 'decimal':
      vardeFields.vardeDecimal = parseFloat(String(data.varde));
      if (isNaN(vardeFields.vardeDecimal)) {
        throw new Error(`Invalid decimal value: ${data.varde}`);
      }
      break;
    case 'boolean':
      // Strict boolean parsing - reject ambiguous values
      if (typeof data.varde === 'boolean') {
        vardeFields.vardeBoolean = data.varde;
      } else if (data.varde === 'true' || data.varde === '1') {
        vardeFields.vardeBoolean = true;
      } else if (data.varde === 'false' || data.varde === '0') {
        vardeFields.vardeBoolean = false;
      } else {
        throw new Error(`Invalid boolean value: ${data.varde}`);
      }
      break;
    case 'datetime':
      vardeFields.vardeDatetime = new Date(data.varde);
      if (isNaN(vardeFields.vardeDatetime.getTime())) {
        throw new Error(`Invalid datetime value: ${data.varde}`);
      }
      break;
    case 'json':
      try {
        vardeFields.vardeJson = typeof data.varde === 'string' ? JSON.parse(data.varde) : data.varde;
      } catch (e) {
        throw new Error(`Invalid JSON value: ${data.varde}`);
      }
      break;
    case 'referens':
      vardeFields.vardeReferens = String(data.varde);
      break;
    case 'image':
    case 'file':
    case 'code':
    case 'interval':
      vardeFields.vardeString = String(data.varde);
      break;
    case 'location':
      vardeFields.vardeJson = typeof data.varde === 'string' ? JSON.parse(data.varde) : data.varde;
      break;
    default:
      throw new Error(`Unknown datatype: ${metadataTyp.datatyp}`);
  }

  const [newMetadata] = await db.insert(metadataVarden).values({
    tenantId: data.tenantId,
    objektId: data.objektId,
    metadataKatalogId: metadataTyp.id,
    ...vardeFields,
    arvsNedat: data.arvsNedat ?? metadataTyp.standardArvs,
    nivaLas: data.nivaLas ?? false,
    koppladTillMetadataId: data.koppladTillMetadataId ?? null,
    skapadAv: data.skapadAv,
    metod: data.metod ?? 'manuell',
  }).returning();

  await db.insert(metadataHistorik).values({
    tenantId: data.tenantId,
    metadataVardenId: newMetadata.id,
    objektId: data.objektId,
    metadataKatalogId: metadataTyp.id,
    gammaltVarde: null,
    nyttVarde: getDisplayValue(newMetadata),
    andradAv: data.skapadAv ?? 'system',
    andringsMetod: data.metod ?? 'manuell',
  });

  // Task #552 (D): notifiera bakgrundsjob om metadata-ändring.
  try {
    const { enqueueMetadataChange } = await import("./services/metadata-change-jobs");
    enqueueMetadataChange(data.tenantId, data.objektId);
  } catch (err) {
    console.error("[metadata-queries] enqueueMetadataChange failed (create):", err);
  }

  return newMetadata;
}

// ============================================================================
// UPPDATERA METADATA
// ============================================================================

export async function updateMetadata(
  metadataId: string,
  varde: string | number | boolean | Date | Record<string, unknown> | null,
  tenantId: string,
  uppdateradAv?: string,
  metod?: string
): Promise<MetadataVarden> {
  const [existing] = await db
    .select()
    .from(metadataVarden)
    .where(and(eq(metadataVarden.id, metadataId), eq(metadataVarden.tenantId, tenantId)));

  if (!existing) {
    throw new Error(`Metadata with id ${metadataId} not found`);
  }

  // SECURITY: Also verify the metadata type belongs to this tenant
  const [metadataTyp] = await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.id, existing.metadataKatalogId),
      eq(metadataKatalog.tenantId, tenantId)
    ));

  if (!metadataTyp) {
    throw new Error(`Metadata type not found for this tenant`);
  }

  // Task #666: beräknade fält är readonly — värdet härleds vid läsning från
  // formeln och får aldrig lagras manuellt.
  if (metadataTyp.arBeraknad) {
    throw new Error(`"${metadataTyp.namn}" är ett beräknat fält och kan inte ändras manuellt — värdet räknas ut automatiskt från formeln.`);
  }

  // Task #682: systemfält och värden med system-/tjänst-ursprung är read-only och
  // får inte överskrivas av en manuell ändring. Systemet uppdaterar dem själv genom
  // att skicka ett auto-ursprung (metod=system/tjanst), vilket släpps igenom här.
  if (metadataTyp.isSystem && !isAutomaticOrigin(metod)) {
    throw new Error(`"${metadataTyp.namn}" är ett systemfält och sätts automatiskt — det kan inte ändras manuellt.`);
  }
  if (isReadonlyOrigin(existing.metod) && !isAutomaticOrigin(metod)) {
    throw new Error(`"${metadataTyp.namn}" sattes av ${existing.metod === 'system' ? 'systemet' : 'en tjänst'} och kan inte redigeras manuellt.`);
  }

  // PDF §7/§14: dropdown-validering (allowedValues) — gäller även uppdatering
  if (metadataTyp.allowedValues && metadataTyp.allowedValues.length > 0) {
    const asString = varde === null || varde === undefined ? '' : String(varde);
    if (!metadataTyp.allowedValues.includes(asString)) {
      throw new Error(`Ogiltigt värde för "${metadataTyp.namn}". Tillåtna värden: ${metadataTyp.allowedValues.join(', ')}`);
    }
  }

  const vardeFields: Record<string, string | number | boolean | Date | Record<string, unknown> | null> = {
    vardeString: null,
    vardeInteger: null,
    vardeDecimal: null,
    vardeBoolean: null,
    vardeDatetime: null,
    vardeJson: null,
    vardeReferens: null,
  };

  // VALIDATION: Proper datatype validation matching createMetadata
  switch (metadataTyp.datatyp) {
    case 'string':
      vardeFields.vardeString = String(varde);
      break;
    case 'integer':
      vardeFields.vardeInteger = parseInt(String(varde));
      if (isNaN(vardeFields.vardeInteger)) {
        throw new Error(`Invalid integer value: ${varde}`);
      }
      break;
    case 'decimal':
      vardeFields.vardeDecimal = parseFloat(String(varde));
      if (isNaN(vardeFields.vardeDecimal)) {
        throw new Error(`Invalid decimal value: ${varde}`);
      }
      break;
    case 'boolean':
      // Strict boolean parsing
      if (typeof varde === 'boolean') {
        vardeFields.vardeBoolean = varde;
      } else if (varde === 'true' || varde === '1') {
        vardeFields.vardeBoolean = true;
      } else if (varde === 'false' || varde === '0') {
        vardeFields.vardeBoolean = false;
      } else {
        throw new Error(`Invalid boolean value: ${varde}`);
      }
      break;
    case 'datetime':
      vardeFields.vardeDatetime = new Date(varde);
      if (isNaN(vardeFields.vardeDatetime.getTime())) {
        throw new Error(`Invalid datetime value: ${varde}`);
      }
      break;
    case 'json':
      try {
        vardeFields.vardeJson = typeof varde === 'string' ? JSON.parse(varde) : varde;
      } catch (e) {
        throw new Error(`Invalid JSON value: ${varde}`);
      }
      break;
    case 'referens':
      vardeFields.vardeReferens = String(varde);
      break;
    case 'image':
    case 'file':
    case 'code':
    case 'interval':
      vardeFields.vardeString = String(varde);
      break;
    case 'location':
      vardeFields.vardeJson = typeof varde === 'string' ? JSON.parse(varde) : varde;
      break;
    default:
      throw new Error(`Unknown datatype: ${metadataTyp.datatyp}`);
  }

  const oldValue = getDisplayValue(existing);

  const [updated] = await db
    .update(metadataVarden)
    .set({
      ...vardeFields,
      uppdateradAv,
      metod: metod ?? 'manuell',
      updatedAt: new Date(),
    })
    .where(and(eq(metadataVarden.id, metadataId), eq(metadataVarden.tenantId, tenantId)))
    .returning();

  await db.insert(metadataHistorik).values({
    tenantId,
    metadataVardenId: metadataId,
    objektId: existing.objektId,
    metadataKatalogId: existing.metadataKatalogId,
    gammaltVarde: oldValue,
    nyttVarde: getDisplayValue(updated),
    andradAv: uppdateradAv ?? 'system',
    andringsMetod: metod ?? 'manuell',
  });

  // Task #552 (D): notifiera bakgrundsjob om metadata-ändring.
  try {
    const { enqueueMetadataChange } = await import("./services/metadata-change-jobs");
    enqueueMetadataChange(tenantId, existing.objektId);
  } catch (err) {
    console.error("[metadata-queries] enqueueMetadataChange failed (update):", err);
  }

  return updated;
}

// ============================================================================
// RADERA METADATA
// ============================================================================

export async function deleteMetadata(
  metadataId: string,
  tenantId: string,
  raderadAv?: string,
  metod?: string,
): Promise<void> {
  // Task #579: logga radering till historik FÖRE delete så att tidslinjen
  // ser "X → ∅"-steget. FK på metadata_varden_id är ON DELETE SET NULL —
  // raden överlever cascade och hittas av tidslinjen via (objekt, katalog).
  // Allt körs i samma transaktion med FOR UPDATE-lås så att samtidiga
  // raderingar inte tappar audit-raden eller skriver dubbletter.
  await db.transaction(async (tx) => {
    const lockedRows = await tx.execute(sql`
      SELECT * FROM metadata_varden
      WHERE id = ${metadataId} AND tenant_id = ${tenantId}
      FOR UPDATE
    `);
    const existing = (lockedRows.rows as any[])[0];
    if (!existing) return; // redan raderad — idempotent

    await tx.insert(metadataHistorik).values({
      tenantId,
      metadataVardenId: existing.id,
      objektId: existing.objekt_id ?? existing.objektId,
      metadataKatalogId: existing.metadata_katalog_id ?? existing.metadataKatalogId,
      gammaltVarde: getDisplayValue({
        vardeString: existing.varde_string ?? existing.vardeString ?? null,
        vardeInteger: existing.varde_integer ?? existing.vardeInteger ?? null,
        vardeDecimal: existing.varde_decimal ?? existing.vardeDecimal ?? null,
        vardeBoolean: existing.varde_boolean ?? existing.vardeBoolean ?? null,
        vardeDatetime: existing.varde_datetime ?? existing.vardeDatetime ?? null,
        vardeJson: existing.varde_json ?? existing.vardeJson ?? null,
        vardeReferens: existing.varde_referens ?? existing.vardeReferens ?? null,
      } as any),
      nyttVarde: null,
      andradAv: raderadAv ?? 'system',
      andringsMetod: metod ?? 'manuell-radering',
    });

    await tx.delete(metadataVarden).where(
      and(eq(metadataVarden.id, metadataId), eq(metadataVarden.tenantId, tenantId))
    );
  });
}

// ============================================================================
// Task #710: MJUK-RADERING & ÅTERSTÄLLNING AV OBJEKT-METADATA (Session 7 §4)
// ============================================================================

// Bygg getDisplayValue-kompatibelt objekt från en rå (snake_case) varden-rad.
function rawVardenForDisplay(existing: any): any {
  return {
    vardeString: existing.varde_string ?? existing.vardeString ?? null,
    vardeInteger: existing.varde_integer ?? existing.vardeInteger ?? null,
    vardeDecimal: existing.varde_decimal ?? existing.vardeDecimal ?? null,
    vardeBoolean: existing.varde_boolean ?? existing.vardeBoolean ?? null,
    vardeDatetime: existing.varde_datetime ?? existing.vardeDatetime ?? null,
    vardeJson: existing.varde_json ?? existing.vardeJson ?? null,
    vardeReferens: existing.varde_referens ?? existing.vardeReferens ?? null,
  };
}

// Mjuk-raderar ett metadata-fält på ett objekt. Två fall:
//  - Lokal rad finns: sätt raderad=true (eget värde döljs men bevaras + historik).
//  - Endast ärvt värde: skapa en lokal "tombstone"-rad (utan eget värde,
//    arvs_nedat=false, raderad=true) som negativt markerar fältet som borttaget;
//    det ärvda värdet visas struket och flödar inte vidare nedåt.
// Idempotent: redan mjuk-raderat fält ger ingen ändring.
export async function softDeleteObjectMetadata(
  objektId: string,
  metadataKatalogId: string,
  tenantId: string,
  raderadAv?: string,
  metod?: string,
): Promise<void> {
  const methodLabel = metod ?? 'mjuk-radering';
  const actor = raderadAv ?? 'system';
  // Pre-state: resolvera nuvarande (ev. ärvda) visningsvärde för historiken.
  const obj = await getObjectWithAllMetadata(objektId, tenantId);
  const entry = obj?.metadata.find((m) => m.metadataKatalogId === metadataKatalogId);
  // Inget synligt värde (varken eget eller ärvt) → inget att radera. No-op för att
  // undvika "phantom"-tombstones / audit-brus.
  if (!entry) {
    return;
  }
  const inheritedDisplay = getDisplayValue(entry as any);
  // Systemgenererade/read-only-värden får inte mjuk-raderas manuellt (speglar
  // create/update-skyddet som kollar isSystem/automatiskt ursprung).
  if (isReadonlyOrigin(entry?.metod)) {
    throw new ReadonlyMetadataError();
  }

  await db.transaction(async (tx) => {
    // Lås ALLA lokala rader för katalogen (allowDuplicates-kataloger kan ha
    // flera) — deterministisk ordning och fullständig hantering. Att radera
    // "fältet" tar bort samtliga värden på objektet.
    const lockedRows = await tx.execute(sql`
      SELECT * FROM metadata_varden
      WHERE objekt_id = ${objektId}
        AND metadata_katalog_id = ${metadataKatalogId}
        AND tenant_id = ${tenantId}
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    `);
    const existingRows = lockedRows.rows as any[];

    if (existingRows.length > 0) {
      for (const existing of existingRows) {
        if (existing.raderad === true) continue; // redan mjuk-raderad — idempotent
        await tx
          .update(metadataVarden)
          .set({ raderad: true, raderadAv: actor, raderadVid: new Date(), uppdateradAv: actor })
          .where(and(eq(metadataVarden.id, existing.id), eq(metadataVarden.tenantId, tenantId)));

        await tx.insert(metadataHistorik).values({
          tenantId,
          metadataVardenId: existing.id,
          objektId,
          metadataKatalogId,
          gammaltVarde: getDisplayValue(rawVardenForDisplay(existing)),
          nyttVarde: null,
          andradAv: actor,
          andringsMetod: methodLabel,
        });
      }
    } else {
      // Inget lokalt värde → skapa tombstone som stryker det ärvda värdet.
      const [tomb] = await tx
        .insert(metadataVarden)
        .values({
          tenantId,
          objektId,
          metadataKatalogId,
          arvsNedat: false,
          nivaLas: false,
          raderad: true,
          raderadAv: actor,
          raderadVid: new Date(),
          skapadAv: actor,
          metod: methodLabel,
        })
        .returning();

      await tx.insert(metadataHistorik).values({
        tenantId,
        metadataVardenId: tomb.id,
        objektId,
        metadataKatalogId,
        gammaltVarde: inheritedDisplay,
        nyttVarde: null,
        andradAv: actor,
        andringsMetod: methodLabel,
      });
    }
  });
}

// Återställer ett mjuk-raderat metadata-fält.
//  - Tombstone (ingen egen data): ta bort raden → det ärvda värdet återkommer.
//  - Eget mjuk-raderat värde: nolla raderad-flaggan → värdet visas igen.
// Idempotent: fält som inte är mjuk-raderat ger ingen ändring.
export async function restoreObjectMetadata(
  objektId: string,
  metadataKatalogId: string,
  tenantId: string,
  restoredBy?: string,
): Promise<void> {
  const actor = restoredBy ?? 'system';
  // Pre-state: det ärvda värde som återkommer om vi tar bort en tombstone.
  const obj = await getObjectWithAllMetadata(objektId, tenantId);
  const entry = obj?.metadata.find((m) => m.metadataKatalogId === metadataKatalogId);
  const inheritedDisplay = entry?.inheritedValue ?? null;

  await db.transaction(async (tx) => {
    // Lås ALLA rader för katalogen (allowDuplicates kan ha flera) i
    // deterministisk ordning och återställ samtliga mjuk-raderade.
    const lockedRows = await tx.execute(sql`
      SELECT * FROM metadata_varden
      WHERE objekt_id = ${objektId}
        AND metadata_katalog_id = ${metadataKatalogId}
        AND tenant_id = ${tenantId}
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    `);
    const existingRows = lockedRows.rows as any[];
    if (existingRows.length === 0) return; // inget lokalt att återställa

    for (const existing of existingRows) {
      if (existing.raderad !== true) continue; // ej mjuk-raderad — idempotent

      const ownDisplay = getDisplayValue(rawVardenForDisplay(existing));
      const isTombstone = ownDisplay == null;

      if (isTombstone) {
        await tx.delete(metadataVarden).where(
          and(eq(metadataVarden.id, existing.id), eq(metadataVarden.tenantId, tenantId)),
        );
        await tx.insert(metadataHistorik).values({
          tenantId,
          metadataVardenId: existing.id,
          objektId,
          metadataKatalogId,
          gammaltVarde: null,
          nyttVarde: inheritedDisplay,
          andradAv: actor,
          andringsMetod: 'aterstalld',
        });
      } else {
        await tx
          .update(metadataVarden)
          .set({ raderad: false, raderadAv: null, raderadVid: null, uppdateradAv: actor })
          .where(and(eq(metadataVarden.id, existing.id), eq(metadataVarden.tenantId, tenantId)));
        await tx.insert(metadataHistorik).values({
          tenantId,
          metadataVardenId: existing.id,
          objektId,
          metadataKatalogId,
          gammaltVarde: null,
          nyttVarde: ownDisplay,
          andradAv: actor,
          andringsMetod: 'aterstalld',
        });
      }
    }
  });
}

// Sätter per-objekt sorteringsordning för metadata-fält (ordnad lista av
// katalog-id:n). Ordningen ärvs nedåt i hierarkin. Tenant-scoped.
export async function setObjectMetadataOrder(
  objektId: string,
  tenantId: string,
  orderedKatalogIds: string[],
): Promise<void> {
  // Deduplicera medan ordningen bevaras (första förekomst vinner).
  const deduped = Array.from(new Set(orderedKatalogIds));
  // Validera att varje katalog-id finns för denna tenant — annars riskerar vi att
  // persista skräp/cross-tenant-id:n i objects.metadata_field_order.
  if (deduped.length > 0) {
    const existing = await db
      .select({ id: metadataKatalog.id })
      .from(metadataKatalog)
      .where(
        and(
          eq(metadataKatalog.tenantId, tenantId),
          inArray(metadataKatalog.id, deduped),
        ),
      );
    const existingIds = new Set(existing.map((r) => r.id));
    const unknown = deduped.filter((id) => !existingIds.has(id));
    if (unknown.length > 0) {
      throw new InvalidMetadataInputError(
        `Okända metadata-katalog-id i sorteringsordning: ${unknown.join(', ')}`,
      );
    }
  }
  const res = await db
    .update(objects)
    .set({ metadataFieldOrder: deduped })
    .where(and(eq(objects.id, objektId), eq(objects.tenantId, tenantId)))
    .returning({ id: objects.id });
  if (res.length === 0) {
    throw new Error('Objekt hittades inte');
  }
}

// ============================================================================
// Task #579: HÄMTA HISTORIK PER (OBJEKT, DEFINITION)
// Kronologisk tidslinje för ett specifikt fält på ett objekt — fungerar även
// efter att själva metadata_varden-raden har raderats (cascade), eftersom vi
// filtrerar på katalog-id direkt och låter NULL-värden från cascade-radade
// historik-rader filtreras bort på applikationsnivå om de förekommer.
// ============================================================================

export interface MetadataDefinitionHistoryEntry {
  id: string;
  metadataVardenId: string | null;
  gammaltVarde: string | null;
  nyttVarde: string | null;
  andradAv: string | null;
  andradVid: Date;
  andringsMetod: string | null;
}

export async function getMetadataDefinitionHistory(
  objektId: string,
  metadataKatalogId: string,
  tenantId: string,
  limit: number = 200,
): Promise<MetadataDefinitionHistoryEntry[]> {
  const rows = await db
    .select({
      id: metadataHistorik.id,
      metadataVardenId: metadataHistorik.metadataVardenId,
      gammaltVarde: metadataHistorik.gammaltVarde,
      nyttVarde: metadataHistorik.nyttVarde,
      andradAv: metadataHistorik.andradAv,
      andradVid: metadataHistorik.andradVid,
      andringsMetod: metadataHistorik.andringsMetod,
    })
    .from(metadataHistorik)
    .where(and(
      eq(metadataHistorik.tenantId, tenantId),
      eq(metadataHistorik.objektId, objektId),
      eq(metadataHistorik.metadataKatalogId, metadataKatalogId),
    ))
    .orderBy(desc(metadataHistorik.andradVid))
    .limit(limit);
  return rows;
}

export async function getLatestChangedAtForObjectMetadata(
  objektId: string,
  tenantId: string,
): Promise<Map<string, Date>> {
  const rows = await db.execute(sql`
    SELECT metadata_katalog_id, MAX(andrad_vid) AS last_changed
    FROM metadata_historik
    WHERE tenant_id = ${tenantId}
      AND objekt_id = ${objektId}
    GROUP BY metadata_katalog_id
  `);
  const map = new Map<string, Date>();
  for (const row of rows.rows as Array<{ metadata_katalog_id: string; last_changed: string | Date }>) {
    map.set(row.metadata_katalog_id, new Date(row.last_changed));
  }
  return map;
}

// ============================================================================
// PROPAGERA METADATA NEDÅT TILL BARNOBJEKT
// ============================================================================

export interface PropagationResult {
  inserted: number;
  updated: number;
  skipped: number;
  affectedObjectIds: string[];
}

export async function propagateMetadataDown(
  objektId: string,
  metadataKatalogId: string | null,
  tenantId: string,
  propagatedBy?: string
): Promise<PropagationResult> {
  const descendantsQuery = sql`
    WITH RECURSIVE descendants AS (
      SELECT id, name, parent_id, 0 as level
      FROM objects
      WHERE parent_id = ${objektId} AND tenant_id = ${tenantId}
      UNION ALL
      SELECT o.id, o.name, o.parent_id, d.level + 1
      FROM objects o
      INNER JOIN descendants d ON o.parent_id = d.id
      WHERE o.tenant_id = ${tenantId}
    )
    SELECT id FROM descendants ORDER BY level
  `;
  const descResult = await db.execute(descendantsQuery);
  const childIds = (descResult.rows as any[]).map(r => r.id);

  if (childIds.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, affectedObjectIds: [] };
  }

  // Task #710: mjuk-raderade förälder-rader (raderad=true) får aldrig propageras
  // nedåt — ett borttaget värde ska inte återskapas på barn.
  let parentMetadataQuery = db
    .select()
    .from(metadataVarden)
    .where(and(
      eq(metadataVarden.objektId, objektId),
      eq(metadataVarden.tenantId, tenantId),
      eq(metadataVarden.arvsNedat, true),
      eq(metadataVarden.raderad, false)
    ));

  const parentMetadata = metadataKatalogId
    ? await db.select().from(metadataVarden).where(and(
        eq(metadataVarden.objektId, objektId),
        eq(metadataVarden.tenantId, tenantId),
        eq(metadataVarden.arvsNedat, true),
        eq(metadataVarden.raderad, false),
        eq(metadataVarden.metadataKatalogId, metadataKatalogId)
      ))
    : await parentMetadataQuery;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const affectedObjectIds: string[] = [];

  for (const pm of parentMetadata) {
    if (pm.nivaLas || pm.stoppaVidareArvning) {
      skipped += childIds.length;
      continue;
    }

    for (const childId of childIds) {
      const [existingLocal] = await db
        .select()
        .from(metadataVarden)
        .where(and(
          eq(metadataVarden.objektId, childId),
          eq(metadataVarden.metadataKatalogId, pm.metadataKatalogId),
          eq(metadataVarden.tenantId, tenantId)
        ))
        .limit(1);

      if (existingLocal) {
        // Task #710: skilj ned-ärvda kopior (metod='arvd', ej raderade) från äkta
        // overrides och tombstones. Tidigare propagerade kopior ska uppdateras när
        // föräldern ändras; äkta overrides (annan metod) och mjuk-raderade rader
        // (raderad=true) lämnas orörda så att lokala val/borttagningar bevaras.
        if (existingLocal.metod === 'arvd' && !existingLocal.raderad) {
          const oldDisplay = getDisplayValue(existingLocal);
          const [updatedEntry] = await db
            .update(metadataVarden)
            .set({
              vardeString: pm.vardeString,
              vardeInteger: pm.vardeInteger,
              vardeDecimal: pm.vardeDecimal,
              vardeBoolean: pm.vardeBoolean,
              vardeDatetime: pm.vardeDatetime,
              vardeJson: pm.vardeJson,
              vardeReferens: pm.vardeReferens,
              uppdateradAv: propagatedBy ?? 'system',
              updatedAt: new Date(),
            })
            .where(and(
              eq(metadataVarden.id, existingLocal.id),
              eq(metadataVarden.tenantId, tenantId),
            ))
            .returning();
          const newDisplay = getDisplayValue(updatedEntry);
          if (oldDisplay !== newDisplay) {
            await db.insert(metadataHistorik).values({
              tenantId,
              metadataVardenId: updatedEntry.id,
              objektId: childId,
              metadataKatalogId: pm.metadataKatalogId,
              gammaltVarde: oldDisplay,
              nyttVarde: newDisplay,
              andradAv: propagatedBy ?? 'system',
              andringsMetod: 'arvd',
            });
            updated++;
            if (!affectedObjectIds.includes(childId)) {
              affectedObjectIds.push(childId);
            }
          } else {
            skipped++;
          }
          continue;
        }
        skipped++;
        continue;
      }

      const [newEntry] = await db.insert(metadataVarden).values({
        tenantId,
        objektId: childId,
        metadataKatalogId: pm.metadataKatalogId,
        vardeString: pm.vardeString,
        vardeInteger: pm.vardeInteger,
        vardeDecimal: pm.vardeDecimal,
        vardeBoolean: pm.vardeBoolean,
        vardeDatetime: pm.vardeDatetime,
        vardeJson: pm.vardeJson,
        vardeReferens: pm.vardeReferens,
        arvsNedat: true,
        nivaLas: false,
        skapadAv: propagatedBy ?? 'system',
        metod: 'arvd',
      }).returning();

      await db.insert(metadataHistorik).values({
        tenantId,
        metadataVardenId: newEntry.id,
        objektId: childId,
        metadataKatalogId: pm.metadataKatalogId,
        gammaltVarde: null,
        nyttVarde: getDisplayValue(newEntry),
        andradAv: propagatedBy ?? 'system',
        andringsMetod: 'arvd',
      });

      inserted++;
      if (!affectedObjectIds.includes(childId)) {
        affectedObjectIds.push(childId);
      }
    }
  }

  // Task #552 (D): notifiera bakgrundsjob — använd `force` för att inte
  // debounca när hela barnträd arvr ned.
  if (affectedObjectIds.length > 0) {
    try {
      const { enqueueMetadataChange } = await import("./services/metadata-change-jobs");
      for (const id of affectedObjectIds) enqueueMetadataChange(tenantId, id, { force: true });
    } catch (err) {
      console.error("[metadata-queries] enqueueMetadataChange failed (propagate):", err);
    }
  }

  return { inserted, updated, skipped, affectedObjectIds };
}

// ============================================================================
// PROPAGERINGS-PREVIEW - visa vilka objekt som påverkas
// ============================================================================

export interface PropagationPreviewItem {
  objektId: string;
  objektNamn: string;
  level: number;
  status: 'will_receive' | 'has_local' | 'blocked';
  localValue?: string | null;
  localMethod?: string | null;
}

export interface PropagationPreview {
  parentValue: string | null;
  metadataName: string;
  items: PropagationPreviewItem[];
  totalWillReceive: number;
  totalHasLocal: number;
  totalBlocked: number;
}

export async function getPropagationPreview(
  objektId: string,
  metadataKatalogId: string,
  tenantId: string
): Promise<PropagationPreview> {
  const [parentMeta] = await db
    .select()
    .from(metadataVarden)
    .where(and(
      eq(metadataVarden.objektId, objektId),
      eq(metadataVarden.metadataKatalogId, metadataKatalogId),
      eq(metadataVarden.tenantId, tenantId)
    ))
    .limit(1);

  if (!parentMeta) {
    throw new Error("Metadata not found on parent object");
  }

  const [katalog] = await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.id, metadataKatalogId),
      eq(metadataKatalog.tenantId, tenantId)
    ))
    .limit(1);

  const parentValue = getDisplayValue(parentMeta);
  const isBlocked = parentMeta.nivaLas || parentMeta.stoppaVidareArvning;

  const descendantsQuery = sql`
    WITH RECURSIVE descendants AS (
      SELECT id, name, parent_id, 0 as level
      FROM objects
      WHERE parent_id = ${objektId} AND tenant_id = ${tenantId}
      UNION ALL
      SELECT o.id, o.name, o.parent_id, d.level + 1
      FROM objects o
      INNER JOIN descendants d ON o.parent_id = d.id
      WHERE o.tenant_id = ${tenantId}
    )
    SELECT id, name, parent_id, level FROM descendants ORDER BY level, name
  `;
  const descResult = await db.execute(descendantsQuery);
  const descendants = descResult.rows as { id: string; name: string; parent_id: string; level: number }[];

  if (descendants.length === 0) {
    return {
      parentValue,
      metadataName: katalog?.namn || '',
      items: [],
      totalWillReceive: 0,
      totalHasLocal: 0,
      totalBlocked: 0,
    };
  }

  const items: PropagationPreviewItem[] = [];
  let totalWillReceive = 0;
  let totalHasLocal = 0;
  let totalBlocked = 0;

  const blockedParentIds = new Set<string>();
  if (isBlocked) {
    blockedParentIds.add(objektId);
  }

  for (const desc of descendants) {
    if (blockedParentIds.has(desc.parent_id)) {
      blockedParentIds.add(desc.id);
      items.push({
        objektId: desc.id,
        objektNamn: desc.name,
        level: desc.level,
        status: 'blocked',
      });
      totalBlocked++;
      continue;
    }

    const [existingLocal] = await db
      .select()
      .from(metadataVarden)
      .where(and(
        eq(metadataVarden.objektId, desc.id),
        eq(metadataVarden.metadataKatalogId, metadataKatalogId),
        eq(metadataVarden.tenantId, tenantId)
      ))
      .limit(1);

    if (existingLocal) {
      if (existingLocal.stoppaVidareArvning) {
        blockedParentIds.add(desc.id);
      }
      // Task #710: ned-ärvda kopior (metod='arvd', ej raderade) uppdateras vid
      // propagering — visa dem som "will_receive". Äkta overrides och tombstones
      // räknas som lokala och lämnas orörda.
      const isRefreshableInherited =
        existingLocal.metod === 'arvd' && !existingLocal.raderad;
      items.push({
        objektId: desc.id,
        objektNamn: desc.name,
        level: desc.level,
        status: isRefreshableInherited ? 'will_receive' : 'has_local',
        localValue: getDisplayValue(existingLocal),
        localMethod: existingLocal.metod,
      });
      if (isRefreshableInherited) {
        totalWillReceive++;
      } else {
        totalHasLocal++;
      }
    } else {
      items.push({
        objektId: desc.id,
        objektNamn: desc.name,
        level: desc.level,
        status: 'will_receive',
      });
      totalWillReceive++;
    }
  }

  return {
    parentValue,
    metadataName: katalog?.namn || '',
    items,
    totalWillReceive,
    totalHasLocal,
    totalBlocked,
  };
}

// ============================================================================
// ARVSTRADSVY - visa metadata-arv genom hierarkin
// ============================================================================

export interface InheritanceTreeNode {
  id: string;
  namn: string;
  typ: string;
  level: number;
  metadataValue: string | null;
  metadataSource: 'local' | 'inherited' | 'none';
  nivaLas: boolean;
  children: InheritanceTreeNode[];
}

export async function getInheritanceTree(
  rootId: string,
  metadataKatalogId: string,
  tenantId: string
): Promise<InheritanceTreeNode | null> {
  const treeQuery = sql`
    WITH RECURSIVE tree AS (
      SELECT id, name, object_type, parent_id, 0 as level, ARRAY[id] as path
      FROM objects
      WHERE id = ${rootId} AND tenant_id = ${tenantId}
      UNION ALL
      SELECT o.id, o.name, o.object_type, o.parent_id, t.level + 1, t.path || o.id
      FROM objects o
      INNER JOIN tree t ON o.parent_id = t.id
      WHERE o.tenant_id = ${tenantId}
    )
    SELECT 
      t.id, t.name, t.object_type, t.parent_id, t.level,
      mv.id as metadata_id,
      COALESCE(mv.varde_string, CAST(mv.varde_integer AS TEXT), CAST(mv.varde_decimal AS TEXT), CAST(mv.varde_boolean AS TEXT), mv.varde_referens) as varde,
      COALESCE(mv.niva_las, FALSE) as niva_las,
      COALESCE(mv.arvs_nedat, FALSE) as arvs_nedat
    FROM tree t
    LEFT JOIN metadata_varden mv ON mv.objekt_id = t.id 
      AND mv.metadata_katalog_id = ${metadataKatalogId}
      AND mv.tenant_id = ${tenantId}
    ORDER BY t.path
  `;

  const result = await db.execute(treeQuery);
  const rows = result.rows as any[];

  if (rows.length === 0) return null;

  const nodeMap = new Map<string, InheritanceTreeNode>();

  rows.forEach(row => {
    nodeMap.set(row.id, {
      id: row.id,
      namn: row.name,
      typ: row.object_type,
      level: row.level,
      metadataValue: row.varde || null,
      metadataSource: row.metadata_id ? 'local' : 'none',
      nivaLas: row.niva_las === true,
      children: [],
    });
  });

  let inheritedValue: string | null = null;
  rows.forEach(row => {
    const node = nodeMap.get(row.id)!;
    if (node.metadataSource === 'local') {
      inheritedValue = node.metadataValue;
    } else if (inheritedValue && node.metadataSource === 'none') {
      node.metadataSource = 'inherited';
      node.metadataValue = inheritedValue;
    }

    if (row.parent_id !== null) {
      const parent = nodeMap.get(row.parent_id);
      if (parent) {
        parent.children.push(node);
      }
    }
  });

  return nodeMap.get(rootId) || null;
}

// ============================================================================
// HÄMTA METADATA FÖR ARBETSORDER (artikel-koppling)
// ============================================================================

export async function getArticleMetadataForObject(
  objektId: string,
  fetchMetadataCode: string,
  tenantId: string
): Promise<{ value: any; displayValue: string; source: string; datatype: string; katalogId: string; katalogName: string } | null> {
  const objectWithMetadata = await getObjectWithAllMetadata(objektId, tenantId);
  if (!objectWithMetadata) return null;

  const metadata = objectWithMetadata.metadata.find(m => m.katalog.namn === fetchMetadataCode);
  if (!metadata) return null;

  const value = metadata.vardeString ?? metadata.vardeInteger ?? metadata.vardeDecimal ??
    metadata.vardeBoolean ?? metadata.vardeDatetime ?? metadata.vardeJson ?? metadata.vardeReferens;

  return {
    value,
    displayValue: getDisplayValue(metadata as any) || '',
    source: metadata.source,
    datatype: metadata.katalog.datatyp || 'text',
    katalogId: metadata.metadataKatalogId,
    katalogName: metadata.katalog.namn,
  };
}

export async function writeArticleMetadataOnObject(
  objektId: string,
  leaveMetadataCode: string,
  value: any,
  tenantId: string,
  executedBy?: string,
  // Ursprung för skrivningen. Default 'tjanst' (artikel-writeback från mobil-
  // utförande). Light-utförandevyn i kundportalen (Task #715) skickar 'utforande'
  // så att ändringsloggen får korrekt källa. Båda är read-only/auto-ursprung och
  // släpps igenom guards (isAutomaticOrigin), men kan skrivas över av en ny
  // auto-skrivning (annan utförande/tjänst) — bara rena manuella edits blockeras.
  metod: string = 'tjanst',
): Promise<MetadataVarden> {
  const [metadataTyp] = await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.namn, leaveMetadataCode),
      eq(metadataKatalog.tenantId, tenantId)
    ));

  if (!metadataTyp) {
    throw new Error(`Metadata type "${leaveMetadataCode}" not found for tenant`);
  }

  const [existing] = await db
    .select()
    .from(metadataVarden)
    .where(and(
      eq(metadataVarden.objektId, objektId),
      eq(metadataVarden.metadataKatalogId, metadataTyp.id),
      eq(metadataVarden.tenantId, tenantId)
    ))
    .limit(1);

  if (existing) {
    return updateMetadata(existing.id, value, tenantId, executedBy, metod);
  } else {
    return createMetadata({
      tenantId,
      objektId,
      metadataTypNamn: leaveMetadataCode,
      varde: value,
      skapadAv: executedBy,
      metod,
    });
  }
}

// Task #682: skriv ett systemgenererat metadatavärde på ett objekt (metod='system').
// Används av händelse-hooks (t.ex. WO skapad, felanmälan inkommen) för att fylla
// read-only systemfält. Skapar värdet om det saknas, annars uppdaterar det.
// `setBy` blir VAD/VEM som satte värdet (t.ex. `system:wo-create`). Tyst no-op om
// systemfältet inte finns i tenantens katalog (alla tenants har inte seeded det).
export async function writeSystemMetadataOnObject(
  objektId: string,
  systemMetadataCode: string,
  value: any,
  tenantId: string,
  setBy: string = 'system',
): Promise<MetadataVarden | null> {
  const [metadataTyp] = await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.namn, systemMetadataCode),
      eq(metadataKatalog.tenantId, tenantId),
    ));

  if (!metadataTyp) {
    return null;
  }

  const [existing] = await db
    .select()
    .from(metadataVarden)
    .where(and(
      eq(metadataVarden.objektId, objektId),
      eq(metadataVarden.metadataKatalogId, metadataTyp.id),
      eq(metadataVarden.tenantId, tenantId),
    ))
    .limit(1);

  if (existing) {
    return updateMetadata(existing.id, value, tenantId, setBy, 'system');
  }
  return createMetadata({
    tenantId,
    objektId,
    metadataTypNamn: systemMetadataCode,
    varde: value,
    skapadAv: setBy,
    metod: 'system',
  });
}

// ============================================================================
// HÄMTA METADATA-HISTORIK
// ============================================================================

export async function getMetadataHistorik(
  metadataVardenId: string,
  tenantId: string
): Promise<MetadataHistorik[]> {
  return db
    .select()
    .from(metadataHistorik)
    .where(and(
      eq(metadataHistorik.metadataVardenId, metadataVardenId),
      eq(metadataHistorik.tenantId, tenantId)
    ))
    .orderBy(desc(metadataHistorik.andradVid));
}

export async function getObjectMetadataHistorik(
  objektId: string,
  tenantId: string
): Promise<(MetadataHistorik & { katalogNamn: string | null })[]> {
  const results = await db
    .select({
      id: metadataHistorik.id,
      tenantId: metadataHistorik.tenantId,
      metadataVardenId: metadataHistorik.metadataVardenId,
      objektId: metadataHistorik.objektId,
      metadataKatalogId: metadataHistorik.metadataKatalogId,
      gammaltVarde: metadataHistorik.gammaltVarde,
      nyttVarde: metadataHistorik.nyttVarde,
      andradAv: metadataHistorik.andradAv,
      andradVid: metadataHistorik.andradVid,
      andringsMetod: metadataHistorik.andringsMetod,
      katalogNamn: metadataKatalog.namn,
    })
    .from(metadataHistorik)
    .leftJoin(metadataKatalog, eq(metadataHistorik.metadataKatalogId, metadataKatalog.id))
    .where(and(
      eq(metadataHistorik.objektId, objektId),
      eq(metadataHistorik.tenantId, tenantId)
    ))
    .orderBy(desc(metadataHistorik.andradVid))
    .limit(100);
  return results;
}

// ============================================================================
// HÄMTA KORSBEFRUKTAD METADATA
// ============================================================================

export async function getCrossFertilizedMetadata(
  objektId: string,
  baseMetadataTypNamn: string,
  tenantId: string
): Promise<any[]> {
  const query = sql`
    SELECT
      mv_base.id as base_id,
      mk_base.namn as base_typ,
      COALESCE(
        mv_base.varde_string,
        CAST(mv_base.varde_integer AS TEXT),
        CAST(mv_base.varde_decimal AS TEXT),
        CAST(mv_base.varde_boolean AS TEXT),
        mv_base.varde_referens
      ) as base_varde,
      mv_related.id as related_id,
      mk_related.namn as related_typ,
      COALESCE(
        mv_related.varde_string,
        CAST(mv_related.varde_integer AS TEXT),
        CAST(mv_related.varde_decimal AS TEXT),
        CAST(mv_related.varde_boolean AS TEXT),
        mv_related.varde_referens
      ) as related_varde
    FROM metadata_varden mv_base
    INNER JOIN metadata_katalog mk_base ON mv_base.metadata_katalog_id = mk_base.id
    LEFT JOIN metadata_varden mv_related ON mv_related.kopplad_till_metadata_id = mv_base.id
    LEFT JOIN metadata_katalog mk_related ON mv_related.metadata_katalog_id = mk_related.id
    WHERE
      mv_base.objekt_id = ${objektId}
      AND mk_base.namn = ${baseMetadataTypNamn}
      AND mv_base.tenant_id = ${tenantId}
  `;

  const result = await db.execute(query);
  return result.rows as any[];
}

// ============================================================================
// GEOGRAFISK UPPLÖSNINGSORDNING
// GPS (exakt) > Adress (grov)
// ============================================================================

export async function getGeographicPosition(
  objektId: string,
  tenantId: string
): Promise<GeographicPosition | null> {
  const objectWithMetadata = await getObjectWithAllMetadata(objektId, tenantId);
  
  if (!objectWithMetadata) return null;

  const gpsMetadata = objectWithMetadata.metadata.find(m => m.katalog.namn === 'GPS');
  if (gpsMetadata && gpsMetadata.vardeString) {
    return {
      typ: 'GPS',
      precision: 'exakt',
      varde: gpsMetadata.vardeString,
      fromObject: gpsMetadata.fromObject,
    };
  }

  const adressMetadata = objectWithMetadata.metadata.find(m => m.katalog.namn === 'Adress');
  if (adressMetadata && adressMetadata.vardeString) {
    return {
      typ: 'Adress',
      precision: 'grov',
      varde: adressMetadata.vardeString,
      fromObject: adressMetadata.fromObject,
    };
  }

  return null;
}

// ============================================================================
// HÄMTA KLUSTERTRÄD
// ============================================================================

export interface ClusterTreeNode {
  id: string;
  namn: string;
  typ: string;
  parentId: string | null;
  children: ClusterTreeNode[];
  level: number;
}

export async function getClusterTree(
  rootId: string,
  tenantId: string
): Promise<ClusterTreeNode | null> {
  const treeQuery = sql`
    WITH RECURSIVE tree AS (
      SELECT
        id,
        name,
        object_type,
        parent_id,
        0 as level,
        ARRAY[id] as path
      FROM objects
      WHERE id = ${rootId} AND tenant_id = ${tenantId}

      UNION ALL

      SELECT
        o.id,
        o.name,
        o.object_type,
        o.parent_id,
        t.level + 1,
        t.path || o.id
      FROM objects o
      INNER JOIN tree t ON o.parent_id = t.id
      WHERE o.tenant_id = ${tenantId}
    )
    SELECT * FROM tree
    ORDER BY path
  `;

  const result = await db.execute(treeQuery);
  const rows = result.rows as any[];

  if (rows.length === 0) return null;

  const nodeMap = new Map<string, ClusterTreeNode>();

  rows.forEach(row => {
    nodeMap.set(row.id, {
      id: row.id,
      namn: row.name,
      typ: row.object_type,
      parentId: row.parent_id,
      children: [],
      level: row.level,
    });
  });

  rows.forEach(row => {
    if (row.parent_id !== null) {
      const parent = nodeMap.get(row.parent_id);
      const child = nodeMap.get(row.id);
      if (parent && child) {
        parent.children.push(child);
      }
    }
  });

  return nodeMap.get(rootId) || null;
}

// ============================================================================
// HITTA OBJEKT MED SPECIFIK METADATA
// ============================================================================

export async function findObjectsWithMetadata(
  metadataTypNamn: string,
  tenantId: string,
  varde?: any
): Promise<ObjectWithAllMetadataEAV[]> {
  let baseQuery = sql`
    SELECT DISTINCT o.id
    FROM objects o
    INNER JOIN metadata_varden mv ON mv.objekt_id = o.id
    INNER JOIN metadata_katalog mk ON mv.metadata_katalog_id = mk.id
    WHERE mk.namn = ${metadataTypNamn}
      AND o.tenant_id = ${tenantId}
  `;

  if (varde !== undefined) {
    baseQuery = sql`
      SELECT DISTINCT o.id
      FROM objects o
      INNER JOIN metadata_varden mv ON mv.objekt_id = o.id
      INNER JOIN metadata_katalog mk ON mv.metadata_katalog_id = mk.id
      WHERE mk.namn = ${metadataTypNamn}
        AND o.tenant_id = ${tenantId}
        AND (
          mv.varde_string = ${String(varde)}
          OR CAST(mv.varde_integer AS TEXT) = ${String(varde)}
          OR mv.varde_referens = ${String(varde)}
        )
    `;
  }

  const result = await db.execute(baseQuery);
  const objectIds = (result.rows as any[]).map(row => row.id);

  const objectsWithMetadata: ObjectWithAllMetadataEAV[] = [];
  for (const objectId of objectIds) {
    const obj = await getObjectWithAllMetadata(objectId, tenantId);
    if (obj) {
      objectsWithMetadata.push(obj);
    }
  }

  return objectsWithMetadata;
}

// ============================================================================
// HÄMTA ALLA METADATATYPER FÖR EN TENANT
// ============================================================================

export async function getAllMetadataTypes(tenantId: string): Promise<MetadataKatalog[]> {
  return await db
    .select()
    .from(metadataKatalog)
    .where(eq(metadataKatalog.tenantId, tenantId))
    .orderBy(metadataKatalog.area, metadataKatalog.sortOrder);
}

// ============================================================================
// KUNDLÅSTA METADATAFÄLT (Task #663)
// ============================================================================

// Hämtar alla kundlås-kopplingar för en tenant som Map<katalogId, customerId[]>.
// Ett katalogfält som SAKNAS i kartan (eller har tom array) är ett generellt fält
// som gäller alla kunder (back-compat). Ett fält med en eller flera customerIds är
// kundlåst. Ett enda DB-anrop — använd vid massuppslag (objektpanel, types-endpoint).
export async function getMetadataCustomerLinks(
  tenantId: string,
): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      metadataKatalogId: metadataKatalogKunder.metadataKatalogId,
      customerId: metadataKatalogKunder.customerId,
    })
    .from(metadataKatalogKunder)
    .where(eq(metadataKatalogKunder.tenantId, tenantId));
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.metadataKatalogId);
    if (list) list.push(r.customerId);
    else map.set(r.metadataKatalogId, [r.customerId]);
  }
  return map;
}

// Returnerar kundens egen id + alla förfäder-id:n (uppåt i parent_customer_id-
// kedjan) som ett Set. Används för att avgöra om ett kundlåst fält gäller ett
// objekt: fältet gäller om någon av dess kopplade kunder finns i detta set (dvs.
// objektets kund ÄR den kopplade kunden eller en ättling till den). Iterativ
// uppåtgång med cykelskydd (max 32 nivåer), speglar storage.getCustomerAncestors.
export async function getCustomerSelfAndAncestorIds(
  tenantId: string,
  customerId: string,
): Promise<Set<string>> {
  const result = new Set<string>([customerId]);
  let currentId: string | null | undefined = customerId;
  for (let i = 0; i < 32; i++) {
    if (!currentId) break;
    const [row] = await db
      .select({ parentCustomerId: customers.parentCustomerId })
      .from(customers)
      .where(and(
        eq(customers.id, currentId),
        eq(customers.tenantId, tenantId),
      ))
      .limit(1);
    if (!row || !row.parentCustomerId) break;
    if (result.has(row.parentCustomerId)) break; // cykelskydd
    result.add(row.parentCustomerId);
    currentId = row.parentCustomerId;
  }
  return result;
}

// Avgör om ett katalogfält ska vara synligt givet en kunds scope-set (self +
// ancestors). Tom/saknad koppling = generellt fält (alltid synligt). Annars synligt
// endast om minst en kopplad kund finns i scope-setet.
export function isMetadataAllowedForCustomerScope(
  linkIds: string[] | undefined,
  scope: Set<string>,
): boolean {
  if (!linkIds || linkIds.length === 0) return true;
  return linkIds.some((id) => scope.has(id));
}

// Hämtar alla katalogtyper för en tenant berikade med deras kundlås-kopplingar.
// Om `customerId` anges filtreras resultatet hierarki-medvetet: generella fält +
// fält kopplade till kunden eller någon av dess förfäder. Utan `customerId`
// returneras alla typer (admin-vy) med customerIds[] för klientfiltrering.
export async function getAllMetadataTypesWithCustomers(
  tenantId: string,
  customerId?: string,
): Promise<MetadataKatalogWithCustomers[]> {
  const [types, links] = await Promise.all([
    getAllMetadataTypes(tenantId),
    getMetadataCustomerLinks(tenantId),
  ]);
  const scope = customerId
    ? await getCustomerSelfAndAncestorIds(tenantId, customerId)
    : null;
  const enriched: MetadataKatalogWithCustomers[] = [];
  for (const t of types) {
    const customerIds = links.get(t.id) ?? [];
    if (scope && !isMetadataAllowedForCustomerScope(customerIds, scope)) continue;
    enriched.push({ ...t, customerIds });
  }
  return enriched;
}

// Task #663: returnerar katalogen kundlås-filtrerad för ett specifikt objekt.
// Objektets kund härleds server-side (objects.customerId) så klienten aldrig kan
// vidga synligheten via egna parametrar. Resultatet = generella fält + fält
// kopplade till objektets kund eller någon av dess förfäder. Saknar objektet kund
// (eller objektet hör ej till tenant) returneras endast generella fält.
export async function getAvailableMetadataTypesForObject(
  tenantId: string,
  objectId: string,
): Promise<MetadataKatalogWithCustomers[]> {
  const [objekt] = await db
    .select({ customerId: objects.customerId })
    .from(objects)
    .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)))
    .limit(1);
  const customerId = objekt?.customerId ?? undefined;
  return getAllMetadataTypesWithCustomers(tenantId, customerId ?? "__none__");
}

// ============================================================================
// METADATA-FAMILJER: PUNKTNOTATION (Task #662)
// ============================================================================

// Härleder punktnotationsnyckeln för ett underfält: förälder.namn + "." + barn.namn.
// Returnerar null för rotfält (utan förälder) eller om föräldern saknas i kartan.
export function deriveMetadataDotKey(
  type: Pick<MetadataKatalog, "namn" | "parentMetadataId">,
  byId: Map<string, Pick<MetadataKatalog, "namn">>,
): string | null {
  if (!type.parentMetadataId) return null;
  const parent = byId.get(type.parentMetadataId);
  if (!parent) return null;
  return `${parent.namn}.${type.namn}`;
}

// Task #664: Härleder ordnade Excel-kolumnheaders för en importmalls fältlista.
// För varje fortfarande existerande katalog-ID returneras dess punktnotation
// (underfält) eller `namn` (rotfält) — exakt den sträng som buildMetadataTypeLookup
// matchar mot vid import, så genererad mall och import håller ihop. Raderade/okända
// ID:n hoppas tyst över; ordningen följer fieldIds; dubblett-headers filtreras bort.
export async function resolveTemplateFieldHeaders(
  tenantId: string,
  fieldIds: string[],
): Promise<Array<{ id: string; header: string; namn: string; beteckning: string | null }>> {
  if (!Array.isArray(fieldIds) || fieldIds.length === 0) return [];
  const types = await getAllMetadataTypes(tenantId);
  const byId = new Map(types.map((t) => [t.id, t]));
  const out: Array<{ id: string; header: string; namn: string; beteckning: string | null }> = [];
  const seen = new Set<string>();
  for (const id of fieldIds) {
    const t = byId.get(id);
    if (!t) continue;
    const header = deriveMetadataDotKey(t, byId) ?? t.namn;
    const key = header.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: t.id, header, namn: t.namn, beteckning: t.beteckning ?? null });
  }
  return out;
}

// Bygger ett case-insensitivt uppslag header/namn → katalogtyp för import-matchning.
// Inkluderar varje typs `namn` samt den härledda punktnotationen (kontakt.fornamn)
// så att en CSV-header som "kontakt.fornamn" matchar rätt underfält automatiskt.
// Direkta namn registreras först och vinner därför över punktnotationsnycklar.
export function buildMetadataTypeLookup(
  types: MetadataKatalog[],
): Map<string, MetadataKatalog> {
  const byId = new Map(types.map((t) => [t.id, t]));
  const map = new Map<string, MetadataKatalog>();
  for (const t of types) {
    map.set(t.namn.toLowerCase(), t);
  }
  for (const t of types) {
    const dot = deriveMetadataDotKey(t, byId);
    if (dot) {
      const key = dot.toLowerCase();
      if (!map.has(key)) map.set(key, t);
    }
  }
  // Matcha även på beteckning så att en import-kolumn som råkar bära beteckningen
  // hittar befintligt fält i stället för att auto-skapa en dubblett (Task #672).
  // Namn/punktnyckel har företräde — beteckning fyller bara luckor.
  for (const t of types) {
    const bet = t.beteckning?.trim().toLowerCase();
    if (bet && !map.has(bet)) map.set(bet, t);
  }
  return map;
}

// Validerar ett föreslaget överordnat metadata-fält (Task #662). Returnerar ett
// svenskt felmeddelande om kopplingen är ogiltig, annars null. Tillämpar samma
// invariant på alla skriv-ytor: ingen självreferens, föräldern måste finnas i
// samma tenant, och endast en nivå av föräldraskap tillåts (föräldern får inte
// själv vara ett underfält).
export async function validateParentMetadataLink(
  tenantId: string,
  parentId: string,
  selfId: string | null,
): Promise<string | null> {
  if (selfId && parentId === selfId) {
    return "Ett metadatafält kan inte vara sin egen förälder.";
  }
  const [parent] = await db
    .select()
    .from(metadataKatalog)
    .where(and(eq(metadataKatalog.id, parentId), eq(metadataKatalog.tenantId, tenantId)))
    .limit(1);
  if (!parent) {
    return "Det överordnade metadatafältet hittades inte i denna tenant.";
  }
  if (parent.parentMetadataId) {
    return "Endast en nivå av metadata-familjer tillåts — det valda fältet är redan ett underfält.";
  }
  return null;
}

// ============================================================================
// SEED STANDARD METADATATYPER FÖR EN TENANT
// ============================================================================

// PDF §7: standardkatalog grupperad per område (idempotent per namn).
// Lägg till nya typer utan att röra existerande (analogt med seedKarlMetadataTypes).
export const STANDARD_METADATA_DEFINITIONS: Array<{
  namn: string;
  datatyp: string;
  arLogisk: boolean;
  standardArvs: boolean;
  kategori: string;
  beskrivning: string;
  sortOrder: number;
  icon: string;
  area?: 'grunduppgifter' | 'produktion' | 'status' | 'ekonomi';
  displayNumber?: number;
  allowDuplicates?: boolean;
  allowedValues?: string[];
  isSystem?: boolean;
  isRequired?: boolean;
  referensTabell?: string;
  kronologiskVisning?: boolean;
}> = [
  // === Grunduppgifter ===
  // PDF §7: displayNumber följer 1/3/6/9/12/15/18/21/24 — systemfält Objektnamn = 1000 (alltid sist).
  { namn: 'Kontakt', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'grunduppgifter', beskrivning: 'Kontaktperson (namn/telefon/e-post)', sortOrder: 1, icon: 'User', area: 'grunduppgifter', displayNumber: 1 },
  { namn: 'Vinjetbild', datatyp: 'image', arLogisk: false, standardArvs: false, kategori: 'grunduppgifter', beskrivning: 'Bild som representerar objektet', sortOrder: 3, icon: 'Image', area: 'grunduppgifter', displayNumber: 3 },

  // === Produktion ===
  { namn: 'Typ', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'produktion', beskrivning: 'Objekttyp (kärl, miljörum, säck, container, ...)', sortOrder: 6, icon: 'Layers', area: 'produktion', displayNumber: 6, allowedValues: ['Kärl', 'Miljörum', 'Säck', 'Container', 'Underjordsbehållare', 'Övrigt'] },
  { namn: 'Antal', datatyp: 'integer', arLogisk: true, standardArvs: false, kategori: 'produktion', beskrivning: 'Antal av objektet', sortOrder: 9, icon: 'Hash', area: 'produktion', displayNumber: 9 },
  { namn: 'Yta', datatyp: 'decimal', arLogisk: true, standardArvs: false, kategori: 'produktion', beskrivning: 'Yta i m² (flera värden tillåts)', sortOrder: 12, icon: 'Square', area: 'produktion', displayNumber: 12, allowDuplicates: true },
  { namn: 'Storlek', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'produktion', beskrivning: 'Storlek (S/M/L)', sortOrder: 15, icon: 'Maximize', area: 'produktion', displayNumber: 15, allowedValues: ['S', 'M', 'L'] },
  { namn: 'Lyftkrok', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'produktion', beskrivning: 'Lyftkrokens skick', sortOrder: 18, icon: 'Anchor', area: 'produktion', displayNumber: 18, allowedValues: ['Okej', 'Inte okej'] },
  { namn: 'Tömningsdag', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'produktion', beskrivning: 'Veckodag för tömning (1=mån … 7=sön)', sortOrder: 21, icon: 'Calendar', area: 'produktion', displayNumber: 21, allowedValues: ['1', '2', '3', '4', '5', '6', '7'] },
  { namn: 'Färg', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'produktion', beskrivning: 'Färg på objektet', sortOrder: 24, icon: 'Palette', area: 'produktion', displayNumber: 24, allowedValues: ['Grön', 'Blå', 'Brun', 'Svart', 'Gul'] },

  // === System (alltid sist) ===
  // Task #682: systemgenererade, read-only fält som skrivs automatiskt vid
  // relevant händelse (metod='system'). De kan aldrig sättas/ändras manuellt.
  { namn: 'Senaste arbetsorder', datatyp: 'string', arLogisk: false, standardArvs: false, kategori: 'status', beskrivning: 'Senast skapade arbetsorder på objektet (systemfält, sätts automatiskt)', sortOrder: 990, icon: 'ClipboardList', area: 'status', displayNumber: 990, isSystem: true },
  { namn: 'Senaste felanmälan', datatyp: 'string', arLogisk: false, standardArvs: false, kategori: 'status', beskrivning: 'Senast inkomna felanmälan på objektet (systemfält, sätts automatiskt)', sortOrder: 992, icon: 'AlertTriangle', area: 'status', displayNumber: 992, isSystem: true, kronologiskVisning: true },
  // Task #714: kundbetyg/feedback via QR — kronologisk gallerivy (historik-tidslinje).
  { namn: 'Senaste kundbetyg', datatyp: 'string', arLogisk: false, standardArvs: false, kategori: 'status', beskrivning: 'Senast inkomna kundbetyg/feedback via QR på objektet (systemfält, sätts automatiskt)', sortOrder: 993, icon: 'Star', area: 'status', displayNumber: 993, isSystem: true, kronologiskVisning: true },
  // Task #693: ytterligare livshändelser som ger systemgenererade fält.
  { namn: 'Senast slutförd order', datatyp: 'string', arLogisk: false, standardArvs: false, kategori: 'status', beskrivning: 'Senast slutförda arbetsorder på objektet (systemfält, sätts automatiskt vid slutförande)', sortOrder: 994, icon: 'CheckCircle2', area: 'status', displayNumber: 994, isSystem: true },
  { namn: 'Senast fakturerad order', datatyp: 'string', arLogisk: false, standardArvs: false, kategori: 'ekonomi', beskrivning: 'Senast fakturerade arbetsorder på objektet (systemfält, sätts automatiskt vid Fortnox-export)', sortOrder: 996, icon: 'Receipt', area: 'ekonomi', displayNumber: 996, isSystem: true },
  { namn: 'Senast inställd order', datatyp: 'string', arLogisk: false, standardArvs: false, kategori: 'status', beskrivning: 'Senast inställda (avbeställda) arbetsorder på objektet (systemfält, sätts automatiskt vid inställning)', sortOrder: 998, icon: 'XCircle', area: 'status', displayNumber: 998, isSystem: true },
  { namn: 'Objektnamn', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'grunduppgifter', beskrivning: 'Objektets namn (systemfält)', sortOrder: 1000, icon: 'Type', area: 'grunduppgifter', displayNumber: 1000, isSystem: true, isRequired: true },
];

// ============================================================================
// METADATA-OMRÅDEN (REDIGERBARA KATEGORIER) — Task #675
// ----------------------------------------------------------------------------
// Område är det enda grupperingsfältet (metadata_katalog.area). Listan är nu
// tenant-scopad data (metadata_areas). seedDefaultMetadataAreas seedar standard-
// listan (isSystem=true) idempotent och backfillar dessutom eventuella område-
// värden som redan används av katalogfält men saknar en rad (så inget i bruk
// hamnar utanför väljaren). De hårdkodade konstanterna behålls som fallback i UI.
// ============================================================================

export async function seedDefaultMetadataAreas(tenantId: string): Promise<void> {
  const existing = await db
    .select({ value: metadataAreas.value })
    .from(metadataAreas)
    .where(eq(metadataAreas.tenantId, tenantId));
  const existingValues = new Set(existing.map((e) => e.value));

  const toInsert: {
    tenantId: string;
    value: string;
    label: string;
    sortOrder: number;
    isSystem: boolean;
  }[] = [];

  // 1. Standardlistan från konstanterna (isSystem=true, kan ej tas bort).
  METADATA_AREA_OPTIONS.forEach((opt, i) => {
    if (!existingValues.has(opt.value)) {
      toInsert.push({ tenantId, value: opt.value, label: opt.label, sortOrder: i, isSystem: true });
      existingValues.add(opt.value);
    }
  });

  // 2. Backfill: områdesvärden som redan finns på katalogfält men saknar en rad
  //    (t.ex. legacy-värden). Markeras som icke-system; de skyddas ändå av
  //    usage-guarden vid radering eftersom de är i bruk.
  const usedAreas = await db
    .select({ area: metadataKatalog.area })
    .from(metadataKatalog)
    .where(eq(metadataKatalog.tenantId, tenantId));
  let nextOrder = METADATA_AREA_OPTIONS.length;
  for (const row of usedAreas) {
    const a = (row.area ?? "").trim();
    if (!a || existingValues.has(a)) continue;
    toInsert.push({ tenantId, value: a, label: a, sortOrder: nextOrder++, isSystem: false });
    existingValues.add(a);
  }

  if (toInsert.length > 0) {
    await db.insert(metadataAreas).values(toInsert).onConflictDoNothing();
  }
}

export async function getMetadataAreas(tenantId: string): Promise<MetadataArea[]> {
  return db
    .select()
    .from(metadataAreas)
    .where(eq(metadataAreas.tenantId, tenantId))
    .orderBy(asc(metadataAreas.sortOrder), asc(metadataAreas.label));
}

// Räknar hur många metadatafält (katalogposter) som använder ett område. Används
// som usage-guard innan radering, i linje med övriga livscykel-guards.
export async function getMetadataAreaUsage(tenantId: string, value: string): Promise<number> {
  const res = await db.execute(sql`
    SELECT COUNT(*)::int AS c
    FROM metadata_katalog
    WHERE tenant_id = ${tenantId} AND area = ${value}
  `);
  return Number((res.rows[0] as { c: number } | undefined)?.c ?? 0);
}

export async function seedDefaultMetadataTypes(tenantId: string): Promise<{ created: string[]; existing: string[] }> {
  const existing = await db
    .select({ namn: metadataKatalog.namn })
    .from(metadataKatalog)
    .where(eq(metadataKatalog.tenantId, tenantId));
  const existingNames = new Set(existing.map(e => e.namn.toLowerCase()));

  const created: string[] = [];
  const skipped: string[] = [];

  // 1. PDF §7 standardkatalog
  for (const def of STANDARD_METADATA_DEFINITIONS) {
    if (existingNames.has(def.namn.toLowerCase())) {
      skipped.push(def.namn);
      continue;
    }
    await db.insert(metadataKatalog).values({ tenantId, ...def });
    created.push(def.namn);
  }

  // 1b. Backfill: standardkatalog-fält som redan finns men vars kronologiskVisning
  // har ändrats i koden (t.ex. system-fält som ska visas kronologiskt) uppdateras
  // idempotent så att existerande tenants får rätt beteende utan migrering.
  const chronologicalNames = STANDARD_METADATA_DEFINITIONS
    .filter(d => d.kronologiskVisning === true)
    .map(d => d.namn);
  if (chronologicalNames.length > 0) {
    await db
      .update(metadataKatalog)
      .set({ kronologiskVisning: true })
      .where(and(
        eq(metadataKatalog.tenantId, tenantId),
        inArray(metadataKatalog.namn, chronologicalNames),
        eq(metadataKatalog.kronologiskVisning, false),
      ));
  }

  // 2. Legacy default-typer — behåll bakåtkompatibilitet för tomma tenants,
  // men hoppa över namn som redan finns i standardkatalogen (undvik dubbletter).
  if (existing.length === 0) {
    const standardNames = new Set(STANDARD_METADATA_DEFINITIONS.map(d => d.namn.toLowerCase()));
    await seedLegacyDefaultMetadataTypes(tenantId, standardNames);
  }

  return { created, existing: skipped };
}

async function seedLegacyDefaultMetadataTypes(tenantId: string, skipNames: Set<string> = new Set()): Promise<void> {
  const defaultTypes = [
    { namn: 'Adress', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'geografi', beskrivning: 'Postadress (grov position)', sortOrder: 1, icon: 'MapPin' },
    { namn: 'GPS', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'geografi', beskrivning: 'GPS-koordinater (longitud, latitud)', sortOrder: 2, icon: 'Navigation' },

    { namn: 'Antal', datatyp: 'integer', arLogisk: true, standardArvs: false, kategori: 'kvantitet', beskrivning: 'Antal av objektet', sortOrder: 10, icon: 'Hash' },
    { namn: 'Area', datatyp: 'decimal', arLogisk: true, standardArvs: false, kategori: 'kvantitet', beskrivning: 'Storlek i kvadratmeter', sortOrder: 11, icon: 'Square' },
    { namn: 'Volym', datatyp: 'integer', arLogisk: true, standardArvs: false, kategori: 'kvantitet', beskrivning: 'Volym i liter', sortOrder: 12, icon: 'Box' },
    
    { namn: 'Kund', datatyp: 'referens', referensTabell: 'customers', arLogisk: true, standardArvs: true, kategori: 'administrativ', beskrivning: 'Kund-referens', sortOrder: 20, icon: 'Building' },
    { namn: 'Kundnummer', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'administrativ', beskrivning: 'Kundnummer', sortOrder: 21, icon: 'FileText' },
    { namn: 'Er_Referens', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'administrativ', beskrivning: 'Kundens referens', sortOrder: 22, icon: 'FileSearch' },
    { namn: 'Er_Ordernummer', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'administrativ', beskrivning: 'Kundens ordernummer', sortOrder: 23, icon: 'ClipboardList' },
    
    { namn: 'Kontaktperson_Namn', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'kontakt', beskrivning: 'Kontaktpersonens namn', sortOrder: 30, icon: 'User' },
    { namn: 'Kontaktperson_Telefon', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'kontakt', beskrivning: 'Kontaktpersonens telefonnummer', sortOrder: 31, icon: 'Phone' },
    { namn: 'Kontaktperson_Epost', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'kontakt', beskrivning: 'Kontaktpersonens e-post', sortOrder: 32, icon: 'Mail' },
    { namn: 'Kontaktperson_Roll', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'kontakt', beskrivning: 'Kontaktpersonens roll (t.ex. Bovärd, Förvaltare)', sortOrder: 33, icon: 'Badge' },
    
    { namn: 'Beskrivning', datatyp: 'string', arLogisk: false, standardArvs: false, kategori: 'beskrivning', beskrivning: 'Fritextbeskrivning', sortOrder: 40, icon: 'FileText' },
    { namn: 'Anteckningar', datatyp: 'string', arLogisk: false, standardArvs: false, kategori: 'beskrivning', beskrivning: 'Praktiska anteckningar', sortOrder: 41, icon: 'StickyNote' },
    { namn: 'Markning', datatyp: 'string', arLogisk: false, standardArvs: false, kategori: 'beskrivning', beskrivning: 'Taggar/etiketter', sortOrder: 42, icon: 'Tag' },
    
    { namn: 'Artikel', datatyp: 'referens', referensTabell: 'articles', arLogisk: true, standardArvs: false, kategori: 'artikel', beskrivning: 'Artikel-referens', sortOrder: 50, icon: 'Package' },
    { namn: 'Prislista', datatyp: 'referens', referensTabell: 'price_lists', arLogisk: true, standardArvs: true, kategori: 'artikel', beskrivning: 'Prislista-referens', sortOrder: 51, icon: 'DollarSign' },
    
    { namn: 'Frekvens', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'tid', beskrivning: 'Hur ofta något ska göras', sortOrder: 60, icon: 'RefreshCw' },
    { namn: 'Tidsfonster', datatyp: 'json', arLogisk: true, standardArvs: true, kategori: 'tid', beskrivning: 'När något får/måste göras', sortOrder: 61, icon: 'Clock' },
    
    { namn: 'Detaljtyp', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'klassificering', beskrivning: 'Specifik typ av objekt (t.ex. Pantkärl_160L, Miljörum)', sortOrder: 70, icon: 'Layers' },
    { namn: 'Kod', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'atkomst', beskrivning: 'Åtkomstkod till objekt/område', sortOrder: 80, icon: 'Key' },
    { namn: 'Rating', datatyp: 'integer', arLogisk: true, standardArvs: false, kategori: 'betyg', beskrivning: 'Betyg/rating (t.ex. 4 av 5)', sortOrder: 90, icon: 'Star' },
    
    { namn: 'Foto', datatyp: 'json', arLogisk: false, standardArvs: false, kategori: 'bilagor', beskrivning: 'Foton kopplade till objektet', sortOrder: 100, icon: 'Image' },
    { namn: 'Filer', datatyp: 'json', arLogisk: false, standardArvs: false, kategori: 'bilagor', beskrivning: 'Dokument/filer kopplade till objektet', sortOrder: 101, icon: 'File' },
  ];

  for (const type of defaultTypes) {
    if (skipNames.has(type.namn.toLowerCase())) continue;
    await db.insert(metadataKatalog).values({
      tenantId,
      ...type,
      // Task #674: Område är grupperingsfältet — sätt det från kategorin så att
      // nya tenants får rätt gruppering direkt utan att köra migreringsskriptet.
      area: (type as any).area ?? type.kategori,
    });
  }
}

// ============================================================================
// SEED KÄRL-METADATATYPER (Modus-berikning, Task #241)
// Idempotent: kontrollerar per (tenantId, namn) och skippar om typen redan finns.
// ============================================================================

export const KARL_METADATA_DEFINITIONS: Array<{
  namn: string;
  datatyp: 'string' | 'integer' | 'decimal' | 'boolean' | 'datetime' | 'json' | 'referens';
  beskrivning: string;
  kategori: string;
  arLogisk: boolean;
  standardArvs: boolean;
  sortOrder: number;
  icon: string;
}> = [
  { namn: 'Kärlstorlek', datatyp: 'decimal', beskrivning: 'Kärlets volym i liter', kategori: 'kärl', arLogisk: true, standardArvs: false, sortOrder: 200, icon: 'Box' },
  { namn: 'Material', datatyp: 'string', beskrivning: 'Material (t.ex. plast, metall)', kategori: 'kärl', arLogisk: true, standardArvs: false, sortOrder: 201, icon: 'Layers' },
  { namn: 'Lås', datatyp: 'string', beskrivning: 'Låstyp (t.ex. enkellås, dubbellås)', kategori: 'kärl', arLogisk: true, standardArvs: false, sortOrder: 202, icon: 'Lock' },
  { namn: 'Placering', datatyp: 'string', beskrivning: 'Placering av kärl/rum (t.ex. källare, miljöhus)', kategori: 'kärl', arLogisk: true, standardArvs: true, sortOrder: 203, icon: 'MapPin' },
  { namn: 'Fraktion', datatyp: 'string', beskrivning: 'Avfallsfraktion (t.ex. matavfall, restavfall)', kategori: 'kärl', arLogisk: true, standardArvs: true, sortOrder: 204, icon: 'Recycle' },
  { namn: 'Tömningsfrekvens', datatyp: 'string', beskrivning: 'Hur ofta tömning sker (t.ex. veckovis, 2v)', kategori: 'kärl', arLogisk: true, standardArvs: true, sortOrder: 205, icon: 'RefreshCw' },
  { namn: 'OrganisationsTyp', datatyp: 'string', beskrivning: 'Typ av organisation/uppdragsgivare', kategori: 'kärl', arLogisk: true, standardArvs: true, sortOrder: 206, icon: 'Building2' },
];

export async function seedKarlMetadataTypes(tenantId: string): Promise<{ created: string[]; existing: string[] }> {
  const existing = await db
    .select({ namn: metadataKatalog.namn })
    .from(metadataKatalog)
    .where(eq(metadataKatalog.tenantId, tenantId));
  const existingNames = new Set(existing.map(e => e.namn.toLowerCase()));

  const created: string[] = [];
  const skipped: string[] = [];
  for (const def of KARL_METADATA_DEFINITIONS) {
    if (existingNames.has(def.namn.toLowerCase())) {
      skipped.push(def.namn);
      continue;
    }
    // Task #674: Område är grupperingsfältet — sätt det från kategorin.
    await db.insert(metadataKatalog).values({ tenantId, ...def, area: def.kategori });
    created.push(def.namn);
  }
  return { created, existing: skipped };
}

// ============================================================================
// WORK ORDER METADATA - CRUD operations for work order metadata
// ============================================================================

export interface WorkOrderMetadataWithKatalog {
  id: string;
  tenantId: string;
  workOrderId: string;
  metadataKatalogId: string;
  vardeString: string | null;
  vardeInteger: number | null;
  vardeDecimal: number | null;
  vardeBoolean: boolean | null;
  vardeDatetime: Date | null;
  vardeJson: any | null;
  vardeReferens: string | null;
  skapadAv: string | null;
  uppdateradAv: string | null;
  createdAt: Date;
  updatedAt: Date;
  katalog: {
    id: string;
    namn: string;
    beskrivning: string | null;
    datatyp: string;
    kategori: string | null;
    sortOrder: number | null;
    icon: string | null;
  };
}

export async function getWorkOrderMetadata(
  workOrderId: string,
  tenantId: string
): Promise<WorkOrderMetadataWithKatalog[]> {
  const results = await db
    .select({
      id: metadataVarden.id,
      tenantId: metadataVarden.tenantId,
      workOrderId: metadataVarden.workOrderId,
      metadataKatalogId: metadataVarden.metadataKatalogId,
      vardeString: metadataVarden.vardeString,
      vardeInteger: metadataVarden.vardeInteger,
      vardeDecimal: metadataVarden.vardeDecimal,
      vardeBoolean: metadataVarden.vardeBoolean,
      vardeDatetime: metadataVarden.vardeDatetime,
      vardeJson: metadataVarden.vardeJson,
      vardeReferens: metadataVarden.vardeReferens,
      skapadAv: metadataVarden.skapadAv,
      uppdateradAv: metadataVarden.uppdateradAv,
      createdAt: metadataVarden.createdAt,
      updatedAt: metadataVarden.updatedAt,
      katalogId: metadataKatalog.id,
      katalogNamn: metadataKatalog.namn,
      katalogBeskrivning: metadataKatalog.beskrivning,
      katalogDatatyp: metadataKatalog.datatyp,
      katalogKategori: metadataKatalog.kategori,
      katalogSortOrder: metadataKatalog.sortOrder,
      katalogIcon: metadataKatalog.icon,
    })
    .from(metadataVarden)
    .innerJoin(metadataKatalog, eq(metadataVarden.metadataKatalogId, metadataKatalog.id))
    .where(and(
      eq(metadataVarden.workOrderId, workOrderId),
      eq(metadataVarden.tenantId, tenantId)
    ))
    .orderBy(metadataKatalog.area, metadataKatalog.sortOrder);

  return results.map(row => ({
    id: row.id,
    tenantId: row.tenantId,
    workOrderId: row.workOrderId!,
    metadataKatalogId: row.metadataKatalogId,
    vardeString: row.vardeString,
    vardeInteger: row.vardeInteger,
    vardeDecimal: row.vardeDecimal,
    vardeBoolean: row.vardeBoolean,
    vardeDatetime: row.vardeDatetime,
    vardeJson: row.vardeJson,
    vardeReferens: row.vardeReferens,
    skapadAv: row.skapadAv,
    uppdateradAv: row.uppdateradAv,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    katalog: {
      id: row.katalogId,
      namn: row.katalogNamn,
      beskrivning: row.katalogBeskrivning,
      datatyp: row.katalogDatatyp,
      kategori: row.katalogKategori,
      sortOrder: row.katalogSortOrder,
      icon: row.katalogIcon,
    },
  }));
}

export async function createWorkOrderMetadata(data: {
  tenantId: string;
  workOrderId: string;
  metadataTypNamn: string;
  varde: string | number | boolean | Date | Record<string, unknown> | null;
  skapadAv?: string;
}): Promise<MetadataVarden> {
  // Verify metadata type exists for this tenant
  const [metadataTyp] = await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.namn, data.metadataTypNamn),
      eq(metadataKatalog.tenantId, data.tenantId)
    ));

  if (!metadataTyp) {
    throw new Error(`Metadata type "${data.metadataTypNamn}" not found for this tenant`);
  }

  const vardeFields: Record<string, string | number | boolean | Date | Record<string, unknown> | null> = {
    vardeString: null,
    vardeInteger: null,
    vardeDecimal: null,
    vardeBoolean: null,
    vardeDatetime: null,
    vardeJson: null,
    vardeReferens: null,
  };

  // VALIDATION: Strict datatype validation for all types
  switch (metadataTyp.datatyp) {
    case 'string':
      vardeFields.vardeString = String(data.varde);
      break;
    case 'integer':
      vardeFields.vardeInteger = parseInt(String(data.varde));
      if (isNaN(vardeFields.vardeInteger)) {
        throw new Error(`Invalid integer value: ${data.varde}`);
      }
      break;
    case 'decimal':
      vardeFields.vardeDecimal = parseFloat(String(data.varde));
      if (isNaN(vardeFields.vardeDecimal)) {
        throw new Error(`Invalid decimal value: ${data.varde}`);
      }
      break;
    case 'boolean':
      if (typeof data.varde === 'boolean') {
        vardeFields.vardeBoolean = data.varde;
      } else if (data.varde === 'true' || data.varde === '1') {
        vardeFields.vardeBoolean = true;
      } else if (data.varde === 'false' || data.varde === '0') {
        vardeFields.vardeBoolean = false;
      } else {
        throw new Error(`Invalid boolean value: ${data.varde}`);
      }
      break;
    case 'datetime':
      vardeFields.vardeDatetime = new Date(data.varde);
      if (isNaN(vardeFields.vardeDatetime.getTime())) {
        throw new Error(`Invalid datetime value: ${data.varde}`);
      }
      break;
    case 'json':
      try {
        vardeFields.vardeJson = typeof data.varde === 'string' ? JSON.parse(data.varde) : data.varde;
      } catch (e) {
        throw new Error(`Invalid JSON value: ${data.varde}`);
      }
      break;
    case 'referens':
      vardeFields.vardeReferens = String(data.varde);
      break;
    default:
      throw new Error(`Unknown datatype: ${metadataTyp.datatyp}`);
  }

  const [newMetadata] = await db.insert(metadataVarden).values({
    tenantId: data.tenantId,
    objektId: null, // Work order metadata has no objektId
    workOrderId: data.workOrderId,
    metadataKatalogId: metadataTyp.id,
    ...vardeFields,
    arvsNedat: false, // Work order metadata doesn't inherit
    skapadAv: data.skapadAv,
  }).returning();

  return newMetadata;
}

export async function deleteWorkOrderMetadata(
  metadataId: string,
  tenantId: string
): Promise<void> {
  const [existing] = await db
    .select()
    .from(metadataVarden)
    .where(and(
      eq(metadataVarden.id, metadataId),
      eq(metadataVarden.tenantId, tenantId)
    ));

  if (!existing || !existing.workOrderId) {
    throw new Error("Work order metadata not found");
  }

  await db.delete(metadataVarden).where(
    and(eq(metadataVarden.id, metadataId), eq(metadataVarden.tenantId, tenantId))
  );
}

// ============================================================================
// METADATA KOPPLAD TILL ORDERTYP (Task #665)
// ============================================================================

// Ett kopplat fält som ska visas i orderformuläret. `dotKey` är punktnotation för
// underfält (förälder.namn), annars null. `linkSortOrder` kommer från kopplingen,
// `customerIds` är fältets kundlås (tom = generellt). Familj-förälder expanderas
// till sina underfält — själva förälder-raden returneras aldrig som inmatningsfält.
export type OrderTypeMetadataField = MetadataKatalogWithCustomers & {
  dotKey: string | null;
  linkSortOrder: number;
};

// Hämtar alla kopplingar (ordertyp → metadata_katalog) för en tenant + ordertyp.
export async function getOrderTypeMetadataLinks(
  tenantId: string,
  orderType: string,
): Promise<OrderTypeMetadataLink[]> {
  return await db
    .select()
    .from(orderTypeMetadataLinks)
    .where(and(
      eq(orderTypeMetadataLinks.tenantId, tenantId),
      eq(orderTypeMetadataLinks.orderType, orderType),
    ))
    .orderBy(orderTypeMetadataLinks.sortOrder, orderTypeMetadataLinks.createdAt);
}

// Hämtar kopplingar berikade med fältets namn/datatyp för admin-vyn (alla typer).
export async function getOrderTypeMetadataLinksWithField(
  tenantId: string,
  orderType: string,
): Promise<Array<OrderTypeMetadataLink & { katalog: MetadataKatalog | null }>> {
  const [links, types] = await Promise.all([
    getOrderTypeMetadataLinks(tenantId, orderType),
    getAllMetadataTypes(tenantId),
  ]);
  const byId = new Map(types.map((t) => [t.id, t]));
  return links.map((l) => ({ ...l, katalog: byId.get(l.metadataKatalogId) ?? null }));
}

// Skapar en koppling (idempotent via unikt index — befintlig koppling uppdaterar
// sortOrder istället för att skapa dubblett). Tenant-scopad.
export async function createOrderTypeMetadataLink(data: {
  tenantId: string;
  orderType: string;
  metadataKatalogId: string;
  sortOrder?: number;
  createdBy?: string;
}): Promise<OrderTypeMetadataLink> {
  // Verifiera att fältet tillhör samma tenant (annars kan en klient koppla in
  // ett annat tenants katalog-ID via egen payload).
  const [field] = await db
    .select({ id: metadataKatalog.id })
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.id, data.metadataKatalogId),
      eq(metadataKatalog.tenantId, data.tenantId),
    ))
    .limit(1);
  if (!field) {
    throw new Error("Metadatafältet hittades inte för denna tenant");
  }

  const [link] = await db
    .insert(orderTypeMetadataLinks)
    .values({
      tenantId: data.tenantId,
      orderType: data.orderType,
      metadataKatalogId: data.metadataKatalogId,
      sortOrder: data.sortOrder ?? 0,
      createdBy: data.createdBy,
    })
    .onConflictDoUpdate({
      target: [
        orderTypeMetadataLinks.tenantId,
        orderTypeMetadataLinks.orderType,
        orderTypeMetadataLinks.metadataKatalogId,
      ],
      set: { sortOrder: data.sortOrder ?? 0 },
    })
    .returning();
  return link;
}

// Raderar en koppling. Tenant-predikat på DELETE (defense-in-depth) även om id
// redan är globalt unikt.
export async function deleteOrderTypeMetadataLink(
  id: string,
  tenantId: string,
): Promise<void> {
  const deleted = await db
    .delete(orderTypeMetadataLinks)
    .where(and(
      eq(orderTypeMetadataLinks.id, id),
      eq(orderTypeMetadataLinks.tenantId, tenantId),
    ))
    .returning({ id: orderTypeMetadataLinks.id });
  if (deleted.length === 0) {
    throw new Error("Kopplingen hittades inte");
  }
}

// Task #682: var används en metadatareferens redan? Returnerar vilka andra
// ordertyper och artiklar som redan är kopplade till samma katalogfält, så att UI
// kan varna innan en ny koppling skapas (undviker generiska fältkollisioner, t.ex.
// `antal_matavfall` vs `antal`). `excludeOrderType` filtrerar bort den ordertyp som
// just nu redigeras. Tenant-scopad.
export async function getMetadataReferenceLinkUsage(
  tenantId: string,
  metadataKatalogId: string,
  excludeOrderType?: string,
): Promise<{
  field: { id: string; namn: string } | null;
  orderTypes: string[];
  articles: Array<{ id: string; name: string; articleNumber: string; relation: 'leave' | 'fetch' }>;
}> {
  const [field] = await db
    .select({ id: metadataKatalog.id, namn: metadataKatalog.namn })
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.id, metadataKatalogId),
      eq(metadataKatalog.tenantId, tenantId),
    ))
    .limit(1);

  if (!field) {
    return { field: null, orderTypes: [], articles: [] };
  }

  const linkRows = await db
    .select({ orderType: orderTypeMetadataLinks.orderType })
    .from(orderTypeMetadataLinks)
    .where(and(
      eq(orderTypeMetadataLinks.tenantId, tenantId),
      eq(orderTypeMetadataLinks.metadataKatalogId, metadataKatalogId),
    ));

  const orderTypes = Array.from(
    new Set(
      linkRows
        .map((r) => r.orderType)
        .filter((ot) => !excludeOrderType || ot !== excludeOrderType),
    ),
  );

  // Artiklar kopplar via katalogfältets NAMN (text-kolumner), inte via id.
  const articleRows = await db
    .select({
      id: articles.id,
      name: articles.name,
      articleNumber: articles.articleNumber,
      leaveMetadataCode: articles.leaveMetadataCode,
      fetchMetadataCode: articles.fetchMetadataCode,
    })
    .from(articles)
    .where(and(
      eq(articles.tenantId, tenantId),
      sql`(${articles.leaveMetadataCode} = ${field.namn} OR ${articles.fetchMetadataCode} = ${field.namn})`,
    ));

  const articleUsage = articleRows.map((a) => ({
    id: a.id,
    name: a.name,
    articleNumber: a.articleNumber,
    relation: (a.leaveMetadataCode === field.namn ? 'leave' : 'fetch') as 'leave' | 'fetch',
  }));

  return { field: { id: field.id, namn: field.namn }, orderTypes, articles: articleUsage };
}

// Task #665 + #663: löser ut de metadatafält som ska visas i orderformuläret för
// en given ordertyp. Familj-förälder-kopplingar expanderas till sina underfält;
// rot-/lövfält-kopplingar inkluderas som de är. Resultatet kundlås-filtreras
// (Task #663): med `customerId` döljs fält vars kundlås inte matchar orderns kund
// eller någon av dess förfäder. Utan `customerId` (admin-förhandsvisning) visas
// alla fält men berikade med deras `customerIds[]`.
export async function resolveOrderTypeMetadataFields(
  tenantId: string,
  orderType: string,
  customerId?: string,
): Promise<OrderTypeMetadataField[]> {
  const [links, types, customerLinks] = await Promise.all([
    getOrderTypeMetadataLinks(tenantId, orderType),
    getAllMetadataTypes(tenantId),
    getMetadataCustomerLinks(tenantId),
  ]);
  if (links.length === 0) return [];

  const byId = new Map(types.map((t) => [t.id, t]));
  // Bygg barn-uppslag: parentMetadataId → barn[] (en nivå, Task #662).
  const childrenByParent = new Map<string, MetadataKatalog[]>();
  for (const t of types) {
    if (t.parentMetadataId) {
      const arr = childrenByParent.get(t.parentMetadataId);
      if (arr) arr.push(t);
      else childrenByParent.set(t.parentMetadataId, [t]);
    }
  }
  Array.from(childrenByParent.values()).forEach((arr) => {
    arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  });

  const scope = customerId
    ? await getCustomerSelfAndAncestorIds(tenantId, customerId)
    : null;

  const out: OrderTypeMetadataField[] = [];
  const seen = new Set<string>();

  const pushField = (field: MetadataKatalog, linkSortOrder: number) => {
    if (seen.has(field.id)) return;
    const customerIds = customerLinks.get(field.id) ?? [];
    if (scope && !isMetadataAllowedForCustomerScope(customerIds, scope)) return;
    seen.add(field.id);
    out.push({
      ...field,
      customerIds,
      dotKey: deriveMetadataDotKey(field, byId),
      linkSortOrder,
    });
  };

  for (const link of links) {
    const target = byId.get(link.metadataKatalogId);
    if (!target) continue; // raderat fält — hoppa tyst
    const children = childrenByParent.get(target.id) ?? [];
    if (children.length > 0) {
      // Familj-förälder: expandera till underfält (förälder-raden lagrar inget värde).
      for (const child of children) {
        pushField(child, link.sortOrder ?? 0);
      }
    } else {
      // Rot-/lövfält eller underfält direkt kopplat: inkludera fältet självt.
      pushField(target, link.sortOrder ?? 0);
    }
  }

  return out;
}
