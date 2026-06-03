import { db } from "./db";
import { sql, eq, and, inArray, desc } from "drizzle-orm";
import { 
  objects, 
  metadataKatalog, 
  metadataVarden,
  metadataHistorik,
  MetadataKatalog,
  MetadataVarden,
  MetadataHistorik,
  MetadataVardenWithKatalog,
  ObjectWithAllMetadataEAV,
  GeographicPosition
} from "@shared/schema";

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
        (
          mv.objekt_id = ${objektId} 
          OR (mv.arvs_nedat = TRUE AND COALESCE(mv.niva_las, FALSE) = FALSE AND NOT (mv.metadata_katalog_id = ANY(pc.blocked_katalog_ids)))
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

  for (const katalogId of katalogOrder) {
    const group = rowsByKatalog.get(katalogId)!;
    const nearest = group[0];

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
    });
  }

  return {
    id: objekt.id,
    name: objekt.name,
    objectType: objekt.objectType,
    parentId: objekt.parentId,
    metadata: metadataWithKatalog,
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
    return { inserted: 0, skipped: 0, affectedObjectIds: [] };
  }

  let parentMetadataQuery = db
    .select()
    .from(metadataVarden)
    .where(and(
      eq(metadataVarden.objektId, objektId),
      eq(metadataVarden.tenantId, tenantId),
      eq(metadataVarden.arvsNedat, true)
    ));

  const parentMetadata = metadataKatalogId
    ? await db.select().from(metadataVarden).where(and(
        eq(metadataVarden.objektId, objektId),
        eq(metadataVarden.tenantId, tenantId),
        eq(metadataVarden.arvsNedat, true),
        eq(metadataVarden.metadataKatalogId, metadataKatalogId)
      ))
    : await parentMetadataQuery;

  let inserted = 0;
  let skipped = 0;
  const affectedObjectIds: string[] = [];

  for (const pm of parentMetadata) {
    if (pm.nivaLas || pm.stoppaVidareArvning) {
      skipped += childIds.length;
      continue;
    }

    for (const childId of childIds) {
      const [existingLocal] = await db
        .select({ id: metadataVarden.id })
        .from(metadataVarden)
        .where(and(
          eq(metadataVarden.objektId, childId),
          eq(metadataVarden.metadataKatalogId, pm.metadataKatalogId),
          eq(metadataVarden.tenantId, tenantId)
        ))
        .limit(1);

      if (existingLocal) {
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

  return { inserted, skipped, affectedObjectIds };
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
      items.push({
        objektId: desc.id,
        objektNamn: desc.name,
        level: desc.level,
        status: 'has_local',
        localValue: getDisplayValue(existingLocal),
        localMethod: existingLocal.metod,
      });
      totalHasLocal++;
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
  executedBy?: string
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
    return updateMetadata(existing.id, value, tenantId, executedBy, 'utforande');
  } else {
    return createMetadata({
      tenantId,
      objektId,
      metadataTypNamn: leaveMetadataCode,
      varde: value,
      skapadAv: executedBy,
      metod: 'utforande',
    });
  }
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
    .orderBy(metadataKatalog.kategori, metadataKatalog.sortOrder);
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
  { namn: 'Objektnamn', datatyp: 'string', arLogisk: true, standardArvs: false, kategori: 'grunduppgifter', beskrivning: 'Objektets namn (systemfält)', sortOrder: 1000, icon: 'Type', area: 'grunduppgifter', displayNumber: 1000, isSystem: true, isRequired: true },
];

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
    await db.insert(metadataKatalog).values({ tenantId, ...def });
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
    .orderBy(metadataKatalog.kategori, metadataKatalog.sortOrder);

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
