import { db } from "./db";
import { sql, eq, and, inArray, desc, asc, isNull, isNotNull } from "drizzle-orm";
import { computeFamilyValues } from "./metadata-formula";
import { METADATA_AREA_OPTIONS } from "@shared/metadata-areas";
import { 
  objects, 
  customers,
  articles,
  metadataKatalog, 
  insertMetadataKatalogSchema,
  metadataKatalogKunder,
  metadataAreas,
  metadataVarden,
  metadataHistorik,
  orderTypeMetadataLinks,
  objectHeaderConfigs,
  objectQuickFieldConfigs,
  MetadataArea,
  MetadataKatalog,
  MetadataVarden,
  MetadataHistorik,
  MetadataVardenWithKatalog,
  ObjectWithAllMetadataEAV,
  GeographicPosition,
  OrderTypeMetadataLink,
  MetadataDefinition,
} from "@shared/schema";
import { primaryPayerCustomerIdSql, getObjectPrimaryCustomerId } from "./services/object-customer";
import { objectOwnMetadataTextValueSql, objectOwnMetadataTextValueSqlFor } from "./services/object-metadata-sql";
import { parseCoordinateJson } from "./services/object-location";
import { OBJEKTMALL_INTERIM_METADATA_FALT } from "@shared/objektmall-template";

// ======
// INTERIMNUMMER = TEMPORÄRT IMPORTFÄLT (Task #1441)
// ----------------------------------------------------------------------------
// 'interimsnummer' är en kundskopad matchningsnyckel för re-import — INTE ett
// vanligt metadatafält. Det ska:
//   • filtreras bort från alla vanliga metadatalistor/fältväljare/objektvyer,
//   • aldrig kunna redigeras/raderas via de manuella metadata-vägarna
//     (import-vägen skriver via auto-ursprung och släpps igenom),
//   • aldrig omfattas av GDPR-anonymisering (tekniskt matchningsnummer),
//   • enbart visas read-only i objektets systeminformationssektion.
// Lagringen ligger kvar i metadata_varden (expand-contract) — enbart
// klassning/visning ändras, så re-import-matchningen (som läser
// metadata_varden direkt via katalognamnet) är opåverkad.
// ======
export function isInterimKatalogNamn(namn: string | null | undefined): boolean {
  return (namn ?? "").trim().toLowerCase() === OBJEKTMALL_INTERIM_METADATA_FALT;
}

// Idempotent backfill: klassar en redan lat-skapad interim-katalogpost som
// system-/internfält (isSystem = värde-read-only, systemlast = definitionslås,
// visasIKarusell=false = dold i karusellytor). Best-effort, anropas från
// /types-läsvägen precis som övriga ensure-funktioner.
export async function ensureInterimSystemFalt(tenantId: string): Promise<void> {
  await db.execute(sql`
    UPDATE metadata_katalog
    SET is_system = TRUE, systemlast = TRUE, visas_i_karusell = FALSE
    WHERE tenant_id = ${tenantId}
      AND LOWER(namn) = ${OBJEKTMALL_INTERIM_METADATA_FALT}
      AND (is_system = FALSE OR systemlast = FALSE OR visas_i_karusell = TRUE)
  `);
}

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

// Task #1218: anonymisering får ENDAST ske på lokala (icke-ärvda) värden.
// Kastas när målet inte har någon lokal metadata_varden-rad (t.ex. rent ärvt
// fält på ett barn) — annars rapporteras falsk framgång utan att något raderas.
export class NoLocalMetadataToAnonymizeError extends Error {
  constructor(
    message = 'Fältet har inget lokalt värde att anonymisera. Ärvda värden måste anonymiseras på källobjektet.',
  ) {
    super(message);
    this.name = 'NoLocalMetadataToAnonymizeError';
  }
}

export function getDisplayValue(existing: MetadataVarden): string | null {
  return existing.vardeString ?? 
    (existing.vardeInteger != null ? String(existing.vardeInteger) : null) ??
    (existing.vardeDecimal != null ? String(existing.vardeDecimal) : null) ??
    (existing.vardeBoolean != null ? String(existing.vardeBoolean) : null) ??
    // OBS: råa db.execute()-rader (t.ex. getObjectWithAllMetadata) returnerar
    // timestamp-kolumner som STRÄNGAR, inte Date — wrappa i new Date() så att
    // .toISOString() inte kastar (annars kraschar bl.a. getArticleMetadataForObject
    // för datetime-fält → metadatastyrd leveranstid faller alltid tillbaka).
    (existing.vardeDatetime ? new Date(existing.vardeDatetime).toISOString() : null) ??
    (existing.vardeJson ? JSON.stringify(existing.vardeJson) : null) ??
    existing.vardeReferens ?? null;
}

// ======
// IMPORT-SKRIVHJÄLPARE (Task #632)
// Transaktionssäkra hjälpare för att skriva per-objekt-metadatavärden under
// Excel-objektimporten (post-it-modellen §6.12): ersättande (allowDuplicates=
// false) ersätter befintligt värde + arkiverar gamla till historik;
// kompletterande (allowDuplicates=true) lägger till värdet parallellt.
// ======

// En exekverare som antingen är den globala db-anslutningen eller en pågående
// transaktion (commitImport kör allt i db.transaction). Båda exponerar samma
// query-builder-API som dessa hjälpare använder (select/insert/update).
export type MetadataExecutor =
  | typeof db
  | Parameters<Parameters<typeof db["transaction"]>[0]>[0];

export type ImportMetadataWriteStatus = "create" | "replace" | "add" | "unchanged";

// Task #1459: mynta en explicit grupp-nyckel som binder ihop sammanhörande
// flervärdesrader (t.ex. en kontaktpersons Namn/Titel/Telefon/E-post) så att
// parningen är deterministisk oberoende av skapandeordning/id-sortering.
export function mintMetadataGruppNyckel(prefix = "kontakt"): string {
  return `${prefix}-${crypto.randomUUID()}`;
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
    case "rubrik":
      throw new Error(`Rubrik-/samlingsfält kan inte ha ett värde — det grupperar bara underfält.`);
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

// ======
// KANONISERING AV METADATA-SYSTEMEN (Task #992)
// ----------------------------------------------------------------------------
// Det engelska legacy-systemet (metadata_definitions.data_type / object_metadata)
// använder ett mindre typvokabulär än den svenska katalogen
// (metadata_katalog.datatyp / metadata_varden). Dessa mappningar används av
// kompatibilitets-API:t (/api/metadata-definitions som vy över katalogen) så att
// en engelsk definition kan speglas mot rätt svensk datatyp och tvärtom.
// ----------------------------------------------------------------------------

// engelsk data_type → svensk datatyp. Okänd/utelämnad typ → "string" (säkrast:
// lagrar råvärdet utan coercion-fel).
export function mapEnglishDataTypeToDatatyp(dataType: string | null | undefined): string {
  switch ((dataType ?? "").toLowerCase()) {
    case "number":
      return "decimal";
    case "date":
      return "datetime";
    case "boolean":
      return "boolean";
    case "json":
      return "json";
    case "text":
    default:
      return "string";
  }
}

// Task #992: idempotent installation av en metadatadefinition från ett
// branschpaket till den kanoniska svenska katalogen (aldrig en ny engelsk
// metadata_definitions-rad). Nyckel = namn (fieldKey i första hand, annars
// fieldLabel). Hoppar över om en katalogpost med samma namn redan finns för
// tenanten (= duplikat-skip, motsvarar paketinstallationens tidigare beteende).
export async function ensurePackageMetadataKatalog(
  tenantId: string,
  meta: {
    fieldKey?: string | null;
    fieldLabel?: string | null;
    dataType?: string | null;
    propagationType?: string | null;
    isRequired?: boolean | null;
  },
): Promise<{ created: boolean }> {
  const namn = ((meta.fieldKey ?? "") || (meta.fieldLabel ?? "")).trim();
  if (!namn) return { created: false };
  const [existing] = await db
    .select({ id: metadataKatalog.id })
    .from(metadataKatalog)
    .where(and(eq(metadataKatalog.tenantId, tenantId), eq(metadataKatalog.namn, namn)))
    .limit(1);
  if (existing) return { created: false };
  const fieldLabel = (meta.fieldLabel ?? "").trim();
  const beskrivning = fieldLabel && fieldLabel !== namn ? fieldLabel : null;
  const data = insertMetadataKatalogSchema.parse({
    tenantId,
    namn,
    beskrivning,
    datatyp: mapEnglishDataTypeToDatatyp(meta.dataType ?? undefined),
    standardArvs: (meta.propagationType ?? "falling") !== "fixed",
    isRequired: meta.isRequired === true,
    isSystem: false,
    area: "annat",
  });
  (data as Record<string, unknown>).kategori =
    ((data as Record<string, unknown>).area as string | null | undefined) || "annat";
  await db.insert(metadataKatalog).values(data).onConflictDoNothing();
  return { created: true };
}

// svensk datatyp → engelsk data_type (för kompatibilitets-API:t). Den rikare
// svenska modellen kollapsar till de fem engelska typerna; integer/decimal →
// number, datetime → date, json/location → json, övrigt → text.
export function mapDatatypToEnglishDataType(datatyp: string | null | undefined): string {
  switch ((datatyp ?? "").toLowerCase()) {
    case "integer":
    case "decimal":
      return "number";
    case "datetime":
      return "date";
    case "boolean":
      return "boolean";
    case "json":
    case "location":
      return "json";
    case "string":
    case "referens":
    default:
      return "text";
  }
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
    // Task #1459: explicit grupp-nyckel för sammanhörande flervärdesrader
    // (kontaktpersonens underfält). Sätts på nya rader när den anges.
    gruppNyckel?: string | null;
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
      gruppNyckel: args.gruppNyckel ?? null,
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

// ======
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

// ======
// KOMPATIBILITETS-VY: /api/metadata-definitions som vy över metadata_katalog
// ----------------------------------------------------------------------------
// (Task #992) Det engelska metadata_definitions-systemet är nu read-only
// audit/rollback. Den legacy REST-ytan /api/metadata-definitions serveras
// istället som en vy över den kanoniska svenska katalogen, så att frontend
// (ObjectsPage, Articles*, orderkoncept-stegen, MetadataDefinitionsPage,
// IndustryPackages) fortsätter fungera utan att läsa de tomma engelska
// tabellerna. Invarianter:
//   - id === metadata_katalog.id  → PATCH/DELETE/usage opererar direkt på
//     katalograden (ingen separat identitet → ingen ny drift).
//   - fieldKey === deriveMetadataDotKey(k) ?? namn  → exakt den nyckel som
//     villkorsmotorn (getObjectsConditionMetadata) indexerar på, så att
//     concept_filters.metadata_key fortsätter resolva.
//   - Beräknade fält (arBeraknad) INKLUDERAS — de är fortfarande giltiga,
//     valbara definitioner (T002 strippar bara deras *värden* vid matchning).
// ----------------------------------------------------------------------------

// Task #992-cleanup: identisk form som den (nu tabell-lösa) MetadataDefinition i
// @shared/schema. Aliasas för att undvika drift mellan compat-vyn och frontend-typen.
export type MetadataDefinitionCompat = MetadataDefinition;

// Speglar en svensk katalograd till den engelska MetadataDefinition-formen som
// frontend förväntar sig. `byId` används av deriveMetadataDotKey för att hitta
// förälderns namn (punktnotation för underfält).
export function katalogToDefinitionCompat(
  k: MetadataKatalog,
  byId: Map<string, Pick<MetadataKatalog, "namn">>,
): MetadataDefinitionCompat {
  return {
    id: k.id,
    tenantId: k.tenantId,
    fieldKey: deriveMetadataDotKey(k, byId) ?? k.namn,
    // fieldKey förblir den exakta (skiftlägeskänsliga) matchningsnyckeln. fieldLabel
    // är ren presentation → visa visningsnamn om satt, annars namn.
    fieldLabel: k.visningsnamn?.trim() || k.namn,
    dataType: mapDatatypToEnglishDataType(k.datatyp),
    propagationType: k.standardArvs ? "falling" : "fixed",
    applicableLevels: [],
    defaultValue: null,
    validationRules: {},
    isRequired: k.isRequired,
    sortOrder: k.sortOrder ?? 0,
    createdAt: k.createdAt,
    deletedAt: k.deletedAt ?? null,
    replacedByDefinitionId: null,
  };
}

export async function getMetadataDefinitionsCompat(
  tenantId: string,
  opts?: { includeDeleted?: boolean },
): Promise<MetadataDefinitionCompat[]> {
  const whereExpr = opts?.includeDeleted
    ? eq(metadataKatalog.tenantId, tenantId)
    : and(eq(metadataKatalog.tenantId, tenantId), isNull(metadataKatalog.deletedAt));
  const rows = await db
    .select()
    .from(metadataKatalog)
    .where(whereExpr)
    .orderBy(metadataKatalog.area, metadataKatalog.sortOrder, metadataKatalog.namn);
  // byId från samma resultatmängd (inkl. arkiverade när includeDeleted=true) så
  // att punktnotationsnycklar för underfält förblir stabila även i arkivvyn.
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Task #1441: interimnummer är ett temporärt importfält — aldrig valbart som
  // vanlig metadatadefinition (fältväljare/exportkolumner/compat-vyn).
  return rows
    .filter((r) => !isInterimKatalogNamn(r.namn))
    .map((r) => katalogToDefinitionCompat(r, byId));
}

export async function getMetadataDefinitionCompat(
  tenantId: string,
  id: string,
): Promise<MetadataDefinitionCompat | undefined> {
  const [row] = await db
    .select()
    .from(metadataKatalog)
    .where(and(eq(metadataKatalog.id, id), eq(metadataKatalog.tenantId, tenantId)));
  if (!row) return undefined;
  // Task #1441: interimnummer är ett dolt temporärt importfält — exponeras inte
  // heller via detalj-uppslaget (samma regel som listfiltret ovan).
  if (isInterimKatalogNamn(row.namn)) return undefined;
  const byId = new Map<string, Pick<MetadataKatalog, "namn">>([[row.id, { namn: row.namn }]]);
  if (row.parentMetadataId) {
    const [parent] = await db
      .select({ id: metadataKatalog.id, namn: metadataKatalog.namn })
      .from(metadataKatalog)
      .where(and(eq(metadataKatalog.id, row.parentMetadataId), eq(metadataKatalog.tenantId, tenantId)));
    if (parent) byId.set(parent.id, { namn: parent.namn });
  }
  return katalogToDefinitionCompat(row, byId);
}

// ======
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

// ======
// BATCH: METADATAVÄRDEN (INKL. ÄRVD) FÖR FLERA OBJEKT + URVAL KATALOGFÄLT
// Task #859: driver de valbara metadatakolumnerna i objektlistan. En enda
// rekursiv CTE går uppåt i hierarkin för ALLA efterfrågade objekt samtidigt
// (root_id-spårning) och plockar närmaste värdet per (objekt, katalogfält).
// Returnerar { [objektId]: { [katalogId]: visningsvärde } }. Endast värden som
// faktiskt finns lokalt eller ärvs från en förälder tas med; mjuk-raderade
// (raderad=TRUE) lokala tombstones ger inget värde.
// ======

export async function getObjectsMetadataValuesForCatalog(
  tenantId: string,
  objectIds: string[],
  katalogIds: string[],
): Promise<Record<string, Record<string, string>>> {
  const result: Record<string, Record<string, string>> = {};
  if (objectIds.length === 0 || katalogIds.length === 0) return result;

  // Task #1213: arv traverserar ALLA föräldrar via object_parents (union med
  // legacy objects.parent_id-kanten), med path-array som cykelskydd. Primär
  // gren vinner vid lika nivå (primary_branch DESC i rangordningen). Endast
  // AKTIVA rader deltar; arkiverade/anonymiserade poster syns aldrig här.
  const query = sql`
    WITH RECURSIVE parent_chain AS (
      SELECT
        id AS root_id,
        id,
        0 as level,
        TRUE as primary_branch,
        ARRAY[id]::varchar[] as path,
        ARRAY[]::varchar[] as blocked_katalog_ids
      FROM objects
      WHERE id = ANY(ARRAY[${sql.join(objectIds.map((id) => sql`${id}`), sql`, `)}]) AND tenant_id = ${tenantId}

      UNION ALL

      SELECT
        pc.root_id,
        o.id,
        pc.level + 1,
        (pc.primary_branch AND edges.is_primary) as primary_branch,
        pc.path || o.id,
        pc.blocked_katalog_ids || COALESCE(
          (SELECT ARRAY_AGG(mv.metadata_katalog_id)
           FROM metadata_varden mv
           WHERE mv.objekt_id = pc.id
             AND mv.stoppa_vidare_arvning = TRUE
             AND mv.tenant_id = ${tenantId}),
          ARRAY[]::varchar[]
        )
      FROM (
        SELECT op.object_id, op.parent_id, op.is_primary
        FROM object_parents op WHERE op.tenant_id = ${tenantId}
        UNION
        SELECT o2.id, o2.parent_id, TRUE
        FROM objects o2 WHERE o2.tenant_id = ${tenantId} AND o2.parent_id IS NOT NULL
      ) edges
      INNER JOIN parent_chain pc ON edges.object_id = pc.id
      INNER JOIN objects o ON o.id = edges.parent_id AND o.tenant_id = ${tenantId}
      WHERE NOT (o.id = ANY(pc.path))
    ),
    metadata_candidates AS (
      SELECT DISTINCT ON (pc.root_id, mv.id)
        pc.root_id,
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
        mv.raderad,
        mk.datatyp as katalog_datatyp,
        pc.level,
        pc.primary_branch
      FROM parent_chain pc
      INNER JOIN metadata_varden mv ON mv.objekt_id = pc.id
      INNER JOIN metadata_katalog mk ON mv.metadata_katalog_id = mk.id
      WHERE
        (
          (mv.objekt_id = pc.root_id AND (mv.status = 'aktiv' OR COALESCE(mv.raderad, FALSE) = TRUE))
          OR (mv.status = 'aktiv' AND mv.arvs_nedat = TRUE AND COALESCE(mv.niva_las, FALSE) = FALSE AND COALESCE(mv.raderad, FALSE) = FALSE AND NOT (mv.metadata_katalog_id = ANY(pc.blocked_katalog_ids)))
        )
        AND mv.tenant_id = ${tenantId}
        AND mk.tenant_id = ${tenantId}
        AND mv.metadata_katalog_id = ANY(ARRAY[${sql.join(katalogIds.map((id) => sql`${id}`), sql`, `)}])
      ORDER BY pc.root_id, mv.id, pc.level ASC, pc.primary_branch DESC
    ),
    metadata_with_context AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY root_id, metadata_katalog_id
          ORDER BY level ASC, primary_branch DESC
        ) as rn
      FROM metadata_candidates
    )
    SELECT * FROM metadata_with_context
    ORDER BY root_id, metadata_katalog_id, rn
  `;

  const rows = (await db.execute(query)).rows as any[];

  const rawRowDisplay = (r: any): string | null =>
    r.varde_string ??
    (r.varde_integer != null ? String(r.varde_integer) : null) ??
    (r.varde_decimal != null ? String(r.varde_decimal) : null) ??
    (r.varde_boolean != null ? String(r.varde_boolean) : null) ??
    (r.varde_datetime ? new Date(r.varde_datetime).toISOString() : null) ??
    (r.varde_json ? JSON.stringify(r.varde_json) : null) ??
    r.varde_referens ??
    null;

  // Gruppera per (root_id, katalog_id) — raderna är ordnade närmast-först.
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const key = `${r.root_id}\u0000${r.metadata_katalog_id}`;
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
    }
    g.push(r);
  }

  for (const [key, group] of Array.from(groups.entries())) {
    const sep = key.indexOf("\u0000");
    const rootId = key.slice(0, sep);
    const katalogId = key.slice(sep + 1);
    const nearest = group[0];
    const nearestIsLocal = nearest.objekt_id === rootId;
    const softDeleted = nearestIsLocal && nearest.raderad === true;
    if (softDeleted) continue; // mjuk-raderad → inget visningsvärde

    let display: string | null;
    if (nearest.katalog_datatyp === "json") {
      const merged = mergeCompositeJsonValues(group.map((r) => r.varde_json));
      display = merged != null ? JSON.stringify(merged) : null;
    } else {
      display = rawRowDisplay(nearest);
    }
    if (display == null || display === "") continue;

    let objMap = result[rootId];
    if (!objMap) {
      objMap = {};
      result[rootId] = objMap;
    }
    objMap[katalogId] = display;
  }

  return result;
}

// ======
// BATCH: METADATA FÖR VILLKORSMATCHNING (orderkoncept steg 4)
// Task #992: enda kanoniska källan för "objekt → {nyckel → värde}" som
// orderkoncept-villkorsmotorn (server/services/order-concept-targeting.ts)
// matchar mot. Läser SVENSKT (metadata_katalog/metadata_varden) via
// getObjectsMetadataValuesForCatalog — inkl. ärvda och sammansatta json-fält
// samt mjuk-radering — och nycklar VARJE värde på katalogens `namn`, dess
// `beteckning` OCH ev. punktnotation (förälder.barn). Då fortsätter ett sparat
// concept_filters.metadata_key resolva oavsett vilken av dessa det pekar på
// (back-fillen matchar fieldKey → namn|beteckning). Beräknade fält
// (ar_beraknad) utelämnas — de härleds vid läsning och deltog aldrig i
// villkorsmatchningen (det engelska systemet exponerade dem aldrig).
// ======

export async function getObjectsConditionMetadata(
  tenantId: string,
  objectIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (objectIds.length === 0) return out;

  const types = await getAllMetadataTypes(tenantId);
  const byId = new Map(types.map((t) => [t.id, t]));
  // Beräknade fält strippas: värdet härleds vid läsning och deltog aldrig i
  // villkorsmatchningen (det engelska object_metadata saknade formelfält).
  const matchable = types.filter((t) => !t.arBeraknad);
  if (matchable.length === 0) return out;

  const valuesByObject = await getObjectsMetadataValuesForCatalog(
    tenantId,
    objectIds,
    matchable.map((t) => t.id),
  );

  for (const objectId of objectIds) {
    const values = valuesByObject[objectId];
    if (!values) continue;
    const record: Record<string, unknown> = {};
    // Precedens som buildMetadataTypeLookup: namn → punktnotation → beteckning.
    // Den MÅSTE appliceras i tre separata pass ÖVER alla fält (inte per fält),
    // annars kan ett tidigare fälts `beteckning` ockupera en nyckel som ett
    // senare fälts `namn` behöver — och då resolvar concept_filters.metadata_key
    // mot fel objektvärde. Pass 1 skriver alla kanoniska `namn` (vinner alltid),
    // pass 2 fyller bara luckor med punktnotation, pass 3 bara kvarvarande luckor
    // med `beteckning`.
    for (const type of matchable) {
      const value = values[type.id];
      if (value == null) continue;
      if (!(type.namn in record)) record[type.namn] = value;
    }
    for (const type of matchable) {
      const value = values[type.id];
      if (value == null) continue;
      const dot = deriveMetadataDotKey(type, byId);
      if (dot && !(dot in record)) record[dot] = value;
    }
    for (const type of matchable) {
      const value = values[type.id];
      if (value == null) continue;
      const bet = type.beteckning?.trim();
      if (bet && !(bet in record)) record[bet] = value;
    }
    if (Object.keys(record).length > 0) out.set(objectId, record);
  }
  return out;
}

// ======
// HÄMTA OBJEKT MED ALL METADATA (INKL. ÄRVD)
// Rekursiv CTE som går uppåt i hierarkin och samlar metadata
// ======

export async function getObjectWithAllMetadata(
  objektId: string,
  tenantId: string
): Promise<ObjectWithAllMetadataEAV | null> {
  const [objekt] = await db
    .select()
    .from(objects)
    .where(and(eq(objects.id, objektId), eq(objects.tenantId, tenantId)));

  if (!objekt) return null;

  // Etapp 5: objektets kund härleds ur Ekonomi-metadatat ("Kund"), inte kolumn.
  const objektCustomerId = await getObjectPrimaryCustomerId(objektId);

  // Build parent chain with stoppaVidareArvning tracking
  // The CTE now tracks which metadata types should be blocked from further inheritance
  // Task #1213: arv traverserar ALLA föräldrar via object_parents (union med
  // legacy objects.parent_id-kanten), med path-array som cykelskydd. Primär
  // gren vinner vid lika nivå (primary_branch DESC i rangordningen).
  const parentChainQuery = sql`
    WITH RECURSIVE parent_chain AS (
      SELECT
        id,
        name,
        0 as level,
        TRUE as primary_branch,
        ARRAY[id]::varchar[] as path,
        ARRAY[]::varchar[] as blocked_katalog_ids
      FROM objects
      WHERE id = ${objektId} AND tenant_id = ${tenantId}

      UNION ALL

      SELECT
        o.id,
        o.name,
        pc.level + 1,
        (pc.primary_branch AND edges.is_primary) as primary_branch,
        pc.path || o.id,
        -- Accumulate blocked katalog IDs when we encounter stoppaVidareArvning
        pc.blocked_katalog_ids || COALESCE(
          (SELECT ARRAY_AGG(mv.metadata_katalog_id) 
           FROM metadata_varden mv 
           WHERE mv.objekt_id = pc.id 
             AND mv.stoppa_vidare_arvning = TRUE
             AND mv.tenant_id = ${tenantId}),
          ARRAY[]::varchar[]
        )
      FROM (
        SELECT op.object_id, op.parent_id, op.is_primary
        FROM object_parents op WHERE op.tenant_id = ${tenantId}
        UNION
        SELECT o2.id, o2.parent_id, TRUE
        FROM objects o2 WHERE o2.tenant_id = ${tenantId} AND o2.parent_id IS NOT NULL
      ) edges
      INNER JOIN parent_chain pc ON edges.object_id = pc.id
      INNER JOIN objects o ON o.id = edges.parent_id AND o.tenant_id = ${tenantId}
      WHERE NOT (o.id = ANY(pc.path))
    ),
    metadata_candidates AS (
      SELECT DISTINCT ON (mv.id)
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
        mv.grupp_nyckel,
        mv.raderad,
        mv.status,
        mv.created_at,
        mv.updated_at,
        mk.id as katalog_id,
        mk.namn as katalog_namn,
        mk.visningsnamn as katalog_visningsnamn,
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
        mk.visas_i_karusell as katalog_visas_i_karusell,
        pc.level,
        pc.name as from_objekt_namn,
        pc.blocked_katalog_ids,
        pc.primary_branch,
        CASE
          WHEN mv.objekt_id = ${objektId} THEN 'local'
          ELSE 'inherited'
        END as source
      FROM parent_chain pc
      INNER JOIN metadata_varden mv ON mv.objekt_id = pc.id
      INNER JOIN metadata_katalog mk ON mv.metadata_katalog_id = mk.id
      WHERE
        -- Include if local OR (inheritable AND not blocked by stoppa_vidare_arvning AND not niva_las)
        -- Task #710: mjuk-raderade förälder-rader (raderad=TRUE) ärvs aldrig nedåt —
        -- ett borttaget värde ska inte flöda till barn. Lokala rader (inkl. tombstones)
        -- behålls alltid så att den strukna markeringen kan visas på objektets egen nivå.
        -- Task #1213: statusmodell — endast AKTIVA rader deltar i visning/arv.
        -- Lokalt: status='aktiv' ELLER raderad=TRUE (mjuk-raderade/tombstones visas
        -- strukna på egen nivå). Arkiverade poster (status='arkiverad', raderad=FALSE)
        -- syns aldrig här — de hör hemma i historik/arkiv-vyer.
        -- Task #1218: ANONYMISERADE lokala rader visas (utan värde) så att posten
        -- kan renderas med status "Anonymiserad"; de ärvs ALDRIG nedåt.
        (
          (mv.objekt_id = ${objektId} AND (mv.status IN ('aktiv', 'anonymiserad') OR COALESCE(mv.raderad, FALSE) = TRUE))
          OR (mv.status = 'aktiv' AND mv.arvs_nedat = TRUE AND COALESCE(mv.niva_las, FALSE) = FALSE AND COALESCE(mv.raderad, FALSE) = FALSE AND NOT (mv.metadata_katalog_id = ANY(pc.blocked_katalog_ids)))
        )
        AND mv.tenant_id = ${tenantId}
        AND mk.tenant_id = ${tenantId}
        -- Arkiverade (soft-deletade) katalogtyper ska aldrig rendera sina värden
        -- på objektet. Utan detta läcker gamla arkiverade familjer (t.ex. en
        -- tidigare "Kontakt" under Grunduppgifter) in bredvid den aktiva familjen
        -- → samma fält syns i två områden = metadata "blandas" mellan områden.
        AND mk.deleted_at IS NULL
      -- Diamant-dedup: samma mv-rad nåbar via flera grenar → behåll närmaste
      -- (lägst nivå), primär gren först vid lika nivå.
      ORDER BY mv.id, pc.level ASC, pc.primary_branch DESC
    ),
    metadata_with_context AS (
      SELECT *,
        -- Rank by level (0 = local object, higher = further ancestor);
        -- primär gren vinner vid lika nivå (Task #1213 multi-förälder-arv).
        ROW_NUMBER() OVER (
          PARTITION BY metadata_katalog_id
          ORDER BY level ASC, primary_branch DESC
        ) as rn
      FROM metadata_candidates
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

    // Task #1441: interimnummer (temporärt importfält) visas aldrig bland
    // objektets metadatarader — det renderas enbart i systeminformationen.
    if (isInterimKatalogNamn(nearest.katalog_namn)) continue;

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

    // Task #1213: konfliktdetektering vid multi-förälder-arv. Om flera ärvda
    // rader på SAMMA (närmaste) nivå från olika grenar har olika värden flaggas
    // konflikt — primär gren vinner i visningen, men UI:t ska varna.
    const inheritedWithValue = group.filter(
      (r) => r.source === "inherited" && rawRowDisplay(r) != null,
    );
    let inheritanceConflict = false;
    let conflictSources: { fromObjectName: string | null; value: string | null }[] | undefined;
    if (inheritedWithValue.length > 1) {
      const minLevel = Math.min(...inheritedWithValue.map((r) => r.level ?? 0));
      const atMinLevel = inheritedWithValue.filter((r) => (r.level ?? 0) === minLevel);
      const distinctValues = new Set(atMinLevel.map((r) => rawRowDisplay(r)));
      // Konflikt kräver att värdena kommer från OLIKA källobjekt (olika grenar).
      // Ett enskilt förälder-objekt med flera värden (allowDuplicates) är INTE
      // en arvskonflikt — det är multi-instans-data från samma källa.
      const distinctSources = new Set(atMinLevel.map((r) => r.objekt_id ?? r.from_objekt_namn));
      if (atMinLevel.length > 1 && distinctValues.size > 1 && distinctSources.size > 1) {
        inheritanceConflict = true;
        const seen = new Set<string>();
        conflictSources = [];
        for (const r of atMinLevel) {
          const key = `${r.objekt_id ?? r.from_objekt_namn}::${rawRowDisplay(r)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          conflictSources.push({
            fromObjectName: r.from_objekt_namn ?? null,
            value: rawRowDisplay(r),
          });
        }
      }
    }

    // Sammansatta json-fält: merga underfält över alla nivåer (närmaste först).
    // Övriga datatyper: använd närmaste värdet oförändrat.
    const resolvedVardeJson =
      nearest.katalog_datatyp === "json"
        ? mergeCompositeJsonValues(group.map((r) => r.varde_json))
        : nearest.varde_json;

    // Multi-instans (allowDuplicates): additivt — exponera alla värden i gruppen
    // så klienten kan bläddra dem i karusell. Nearest/collapse ovan är OFÖRÄNDRAT
    // (funktionen delas av portal/kpi/article). Endast satt för duplicerbara fält.
    const instances =
      (nearest.katalog_allow_duplicates ?? false) === true
        ? group
            .filter((r) => r.raderad !== true && rawRowDisplay(r) != null)
            .map((r) => ({
              id: r.id,
              objektId: r.objekt_id,
              source: (r.source === "inherited" ? "inherited" : "local") as
                | "local"
                | "inherited",
              fromObjectName:
                r.source === "inherited" ? (r.from_objekt_namn ?? null) : null,
              level: r.level ?? 0,
              metod: r.metod ?? "manuell",
              displayValue: rawRowDisplay(r),
              vardeJson: r.varde_json ?? null,
              createdAt: r.created_at ?? null,
              // Task #1459: explicit gruppering av sammanhörande flervärdesrader
              // (kontaktpersonens underfält). NULL = legacy-rad (index-parning).
              gruppNyckel: r.grupp_nyckel ?? null,
            }))
        : undefined;

    metadataWithKatalog.push(({
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
      status: nearest.status ?? 'aktiv',
      raderadAv: null,
      raderadVid: null,
      arkiveradAv: null,
      arkiveradVid: null,
      konverteradFranHistorikId: null,
      createdAt: nearest.created_at,
      updatedAt: nearest.updated_at,
      katalog: {
        id: nearest.katalog_id,
        tenantId: tenantId,
        namn: nearest.katalog_namn,
        visningsnamn: nearest.katalog_visningsnamn ?? null,
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
        visasIKarusell: nearest.katalog_visas_i_karusell ?? true,
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
      // Task #1366: källradens id när ett lokalt värde skuggar ett ärvt — låter
      // klienten hämta källobjektets historik-kedja separat (tenant-scopad route).
      inheritedMetadataId: hasLocalShadow || softDeleted ? (inheritedRow?.id ?? null) : null,
      softDeleted,
      raderad: nearest.raderad === true,
      instances,
      // Task #1213: konflikt vid multi-förälder-arv
      inheritanceConflict: inheritanceConflict || undefined,
      conflictSources,
    }) as unknown as (typeof metadataWithKatalog)[number]);
  }

  // Task #663: filtrera bort kundlåsta fält som inte hör till objektets kund.
  // Ett fält utan kopplingar är generellt (alltid med). Ett kundlåst fält behålls
  // bara om objektets kund (eller någon av dess förfäder) finns bland de kopplade
  // kunderna. Saknar objektet kund kan inget kundlås matcha → endast generella fält.
  const customerLinks = await getMetadataCustomerLinks(tenantId);
  const hasAnyLock = Array.from(customerLinks.values()).some((l) => l.length > 0);
  let filteredMetadata = metadataWithKatalog;
  if (hasAnyLock) {
    const scope = objektCustomerId
      ? await getCustomerSelfAndAncestorIds(tenantId, objektCustomerId)
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
    const computedScope = objektCustomerId
      ? await getCustomerSelfAndAncestorIds(tenantId, objektCustomerId)
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
        filteredMetadata.push(({
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
          raderad: false,
          status: 'aktiv',
          raderadAv: null,
          raderadVid: null,
          arkiveradAv: null,
          arkiveradVid: null,
          konverteradFranHistorikId: null,
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
        }) as unknown as (typeof filteredMetadata)[number]);
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

  // Task #1486: objectType finns inte längre som objektkolumn — härled ur
  // objektets EGNA klassificerings-metadata (Objekttyp, source=local, ärvs ej).
  const ownObjectType = (() => {
    for (const m of filteredMetadata) {
      if ((m as any).source && (m as any).source !== "local") continue;
      if (((m.katalog as any)?.namn ?? "").toLowerCase() !== "objekttyp") continue;
      const v = typeof m.vardeString === "string" ? m.vardeString.trim() : "";
      if (v) return v;
    }
    return null;
  })();

  return {
    id: objekt.id,
    name: objekt.name,
    objectType: ownObjectType ?? "",
    parentId: objekt.parentId,
    metadata: filteredMetadata,
  };
}

// ======
// HÄMTA METADATA-VÄRDE (med ärvning)
// ======

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

// ======
// SKAPA METADATA
// ======

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
  // Task #1459: explicit grupp-nyckel för sammanhörande flervärdesrader
  // (t.ex. kontaktpersonens underfält) — sätts på den nya raden.
  gruppNyckel?: string | null;
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

  // Task #1441: interimnummer är ett temporärt importfält (matchningsnyckel för
  // re-import) — endast import-vägen (auto-ursprung) får skriva det. Namn-baserad
  // guard oberoende av isSystem-flaggan (defense-in-depth, täcker äldre rader).
  if (isInterimKatalogNamn(metadataTyp.namn) && !isAutomaticOrigin(data.metod)) {
    throw new ReadonlyMetadataError(`"${metadataTyp.namn}" är ett tekniskt importfält och kan inte anges manuellt.`);
  }

  // Rubrik/samlingsfält: ett rent gruppfält som bara grupperar underfält och
  // aldrig håller ett eget värde. Avvisa därför alla värdeskrivningar.
  if (metadataTyp.datatyp === 'rubrik') {
    throw new Error(`"${metadataTyp.namn}" är ett rubrik-/samlingsfält och kan inte ha ett eget värde — det grupperar bara underfält.`);
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
      AND mv.status = 'aktiv'
      AND COALESCE(mv.raderad, FALSE) = FALSE
    LIMIT 1
  `);
  if ((lockCheck.rows as any[]).length > 0) {
    throw new Error(`Nivå-lås: värdet för "${metadataTyp.namn}" är låst av en förälder och kan inte överskridas på denna nivå.`);
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
      vardeFields.vardeDatetime = new Date(data.varde as string | number | Date);
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

  // Task #1213 (G1): hård auto-arkivering på enkelvärdesfält — oavsett vilken
  // väg skrivningen kommer. Finns redan en AKTIV lokal rad för katalogen kastas
  // INTE längre "Dubblett"; i stället arkiveras det gamla värdet som fullvärdig
  // post och den befintliga raden uppdateras in-place (id-stabilt). En aktiv
  // tombstone (raderad=true utan eget värde) återanvänds på samma sätt — den
  // får det nya värdet och raderad-markeringen nollas.
  if (!metadataTyp.allowDuplicates) {
    const existingRows = await db
      .select()
      .from(metadataVarden)
      .where(and(
        eq(metadataVarden.objektId, data.objektId),
        eq(metadataVarden.metadataKatalogId, metadataTyp.id),
        eq(metadataVarden.tenantId, data.tenantId)
      ));
    const target = existingRows
      .filter((r) => r.status === 'aktiv')
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))[0];
    if (target) {
      // Spegla updateMetadata:s read-only-skydd: värden med system-/tjänst-
      // ursprung får bara ersättas av ett automatiskt ursprung.
      if (isReadonlyOrigin(target.metod) && !isAutomaticOrigin(data.metod)) {
        throw new Error(`"${metadataTyp.namn}" sattes av ${target.metod === 'system' ? 'systemet' : 'en tjänst'} och kan inte redigeras manuellt.`);
      }
      const oldValue = getDisplayValue(target);
      const newDisplayProbe = getDisplayValue({ ...target, ...vardeFields } as MetadataVarden);
      if (oldValue !== null && oldValue !== newDisplayProbe) {
        await insertArchivedClone(target, data.skapadAv);
      }
      const [replaced] = await db
        .update(metadataVarden)
        .set({
          ...vardeFields,
          arvsNedat: data.arvsNedat ?? target.arvsNedat,
          nivaLas: data.nivaLas ?? target.nivaLas,
          koppladTillMetadataId: data.koppladTillMetadataId ?? target.koppladTillMetadataId,
          gruppNyckel: data.gruppNyckel ?? target.gruppNyckel,
          uppdateradAv: data.skapadAv,
          metod: data.metod ?? 'manuell',
          status: 'aktiv',
          raderad: false,
          raderadAv: null,
          raderadVid: null,
          updatedAt: new Date(),
        })
        .where(and(eq(metadataVarden.id, target.id), eq(metadataVarden.tenantId, data.tenantId)))
        .returning();

      await db.insert(metadataHistorik).values({
        tenantId: data.tenantId,
        metadataVardenId: replaced.id,
        objektId: data.objektId,
        metadataKatalogId: metadataTyp.id,
        gammaltVarde: oldValue,
        nyttVarde: getDisplayValue(replaced),
        andradAv: data.skapadAv ?? 'system',
        andringsMetod: data.metod ?? 'manuell',
      });

      try {
        const { enqueueMetadataChange } = await import("./services/metadata-change-jobs");
        enqueueMetadataChange(data.tenantId, data.objektId);
      } catch (err) {
        console.error("[metadata-queries] enqueueMetadataChange failed (create/replace):", err);
      }

      return replaced;
    }
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
    gruppNyckel: data.gruppNyckel ?? null,
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

// ======
// BATCHAD IMPORT-METADATASKRIVNING (perf — Objektimport 2.0 steg 5)
// ----------------------------------------------------------------------------
// Steg 5 skrev tidigare metadata via createMetadata() en gång per fält.
// createMetadata gör ~7–8 round-trips per fält (objekt-tenantkoll, katalog-
// uppslag per namn, rekursiv nivå-lås-CTE, dubblettkoll, insert varden + insert
// historik). För en fil med hundratals kärl × flera fält blev det tiotusentals
// sekventiella queries → flera minuter.
//
// Denna funktion bevarar EXAKT samma synliga beteende men arbetar per OBJEKT
// istället för per fält:
//   • katalogen är förinläst av anroparen (ingen per-fält-SELECT),
//   • objekt-tenantkollen hoppas (anroparen äger/skapade objektet),
//   • nivå-låset kollas med EN rekursiv CTE per objekt (mot förälderkedjan),
//   • dubbletter mot redan lagrade värden kollas med EN SELECT per objekt och
//     hoppas helt för nyskapade objekt (de har inga befintliga värden),
//   • alla varden- resp. historik-rader sätts in i var sin batch-insert.
// Tysta hopp (beräknat fält, ogiltigt värde, allowedValues, nivå-lås, dubblett)
// speglar de kast som createMetadata gjorde och som anroparen tidigare svalde.
export interface ImportMetadataBatchField {
  namn: string;
  varde: string | number | boolean | Date | Record<string, unknown> | null;
}

// Coerca + validera ett import-värde mot katalogens datatyp. Speglar exakt
// valideringen i createMetadata (rad ~975–1090): allowedValues jämförs mot
// String(varde), och json/location tar emot redan-parsade objekt direkt.
function coerceImportBatchVarde(
  katalog: MetadataKatalog,
  varde: string | number | boolean | Date | Record<string, unknown> | null,
): VardeFields {
  if (katalog.allowedValues && katalog.allowedValues.length > 0) {
    const asString = varde === null || varde === undefined ? "" : String(varde);
    if (!katalog.allowedValues.includes(asString)) {
      throw new Error(`Ogiltigt värde för "${katalog.namn}".`);
    }
  }
  const fields: VardeFields = {
    vardeString: null,
    vardeInteger: null,
    vardeDecimal: null,
    vardeBoolean: null,
    vardeDatetime: null,
    vardeJson: null,
    vardeReferens: null,
  };
  switch (katalog.datatyp) {
    case "string":
      fields.vardeString = String(varde);
      break;
    case "integer": {
      const n = parseInt(String(varde));
      if (isNaN(n)) throw new Error(`Invalid integer value: ${varde}`);
      fields.vardeInteger = n;
      break;
    }
    case "decimal": {
      const n = parseFloat(String(varde));
      if (isNaN(n)) throw new Error(`Invalid decimal value: ${varde}`);
      fields.vardeDecimal = n;
      break;
    }
    case "boolean":
      if (typeof varde === "boolean") fields.vardeBoolean = varde;
      else if (varde === "true" || varde === "1") fields.vardeBoolean = true;
      else if (varde === "false" || varde === "0") fields.vardeBoolean = false;
      else throw new Error(`Invalid boolean value: ${varde}`);
      break;
    case "datetime": {
      const d = new Date(varde as any);
      if (isNaN(d.getTime())) throw new Error(`Invalid datetime value: ${varde}`);
      fields.vardeDatetime = d;
      break;
    }
    case "json":
    case "location":
      fields.vardeJson = typeof varde === "string" ? JSON.parse(varde) : varde;
      break;
    case "referens":
      fields.vardeReferens = String(varde);
      break;
    case "image":
    case "file":
    case "code":
    case "interval":
      fields.vardeString = String(varde);
      break;
    default:
      throw new Error(`Unknown datatype: ${katalog.datatyp}`);
  }
  return fields;
}

export async function writeObjectImportMetadataBatch(args: {
  tenantId: string;
  objektId: string;
  // Objektets förälder i DB (för nivå-lås-kontroll mot förälderkedjan). För
  // nyskapade objekt = den satta föräldern; för uppdateringar den upplösta
  // föräldern (null när raden inte deklarerar någon — då kan nivå-lås från en
  // tidigare satt DB-förälder teoretiskt missas, men det fältet skulle i
  // praktiken redan ha hoppats av dubblettkollen vid re-import).
  objectParentId: string | null;
  isNewObject: boolean;
  fields: ImportMetadataBatchField[];
  katalogByName: Map<string, MetadataKatalog>;
  skapadAv?: string;
  // När true skrivs redan lagrade ersättande fält (allowDuplicates=false) ÖVER
  // med importens värde i stället för att bevaras ("första-skrivningen-vinner").
  // Möjliggör en äkta export → redigera → importera-cykel. Default false =
  // bakåtkompatibelt bevarande.
  overwriteExisting?: boolean;
}): Promise<void> {
  const { tenantId, objektId, objectParentId, isNewObject, fields, katalogByName, skapadAv, overwriteExisting } = args;
  if (fields.length === 0) return;

  type Prepared = {
    katalog: MetadataKatalog;
    vardeFields: VardeFields;
  };
  const prepared: Prepared[] = [];
  const seenNoDupKatalogIds = new Set<string>();

  for (const f of fields) {
    const katalog = katalogByName.get(f.namn);
    if (!katalog) continue; // katalogen kunde inte säkerställas — hoppa tyst
    if (katalog.arBeraknad) continue; // beräknat fält är readonly (createMetadata kastade)
    // Systemfält släpps alltid igenom: import är ett automatiskt ursprung.
    let vardeFields: VardeFields;
    try {
      vardeFields = coerceImportBatchVarde(katalog, f.varde);
    } catch {
      continue; // ogiltigt värde / allowedValues → hoppa tyst (som förr)
    }
    // Inom samma batch: för ersättande fält (allowDuplicates=false) vinner det
    // första värdet — speglar att ett andra createMetadata-anrop för samma
    // katalog kastade "Dubblett" och hoppades.
    if (!katalog.allowDuplicates) {
      if (seenNoDupKatalogIds.has(katalog.id)) continue;
      seenNoDupKatalogIds.add(katalog.id);
    }
    prepared.push({ katalog, vardeFields });
  }
  if (prepared.length === 0) return;

  // Nivå-lås: hämta alla katalog-id som någon förälder i kedjan har låst (EN CTE).
  if (objectParentId) {
    const lockRes = await db.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, 0 AS depth
        FROM objects
        WHERE id = ${objectParentId}::text AND tenant_id = ${tenantId}
        UNION ALL
        SELECT o.id, o.parent_id, a.depth + 1
        FROM objects o
        INNER JOIN ancestors a ON o.id = a.parent_id
        WHERE o.tenant_id = ${tenantId} AND a.depth < 100
      )
      SELECT DISTINCT mv.metadata_katalog_id AS katalog_id
      FROM ancestors a
      INNER JOIN metadata_varden mv ON mv.objekt_id = a.id
      WHERE mv.tenant_id = ${tenantId} AND mv.niva_las = TRUE
        AND mv.status = 'aktiv'
        AND COALESCE(mv.raderad, FALSE) = FALSE
    `);
    const locked = new Set<string>();
    for (const r of lockRes.rows as any[]) if (r.katalog_id) locked.add(String(r.katalog_id));
    if (locked.size) {
      for (let i = prepared.length - 1; i >= 0; i--) {
        if (locked.has(prepared[i].katalog.id)) prepared.splice(i, 1);
      }
    }
  }
  if (prepared.length === 0) return;

  // Dubblettkoll mot redan lagrade värden (endast ersättande fält). Nyskapade
  // objekt har inga befintliga värden → hoppa hela kollen.
  //
  // Standardläge (overwriteExisting=false): "första-skrivningen-vinner" —
  // katalog-id som redan har ett värde tas bort ur `prepared` (bevaras).
  //
  // Skriv-över-läge (overwriteExisting=true): redan lagrade värden RADERAS så
  // att importens värde ersätter dem (äkta export → redigera → importera).
  // Gamla värdet fångas för historik (gammaltVarde) innan raderingen.
  const overwrittenOldValues = new Map<string, string | null>();
  if (!isNewObject) {
    const noDupKatalogIds = prepared
      .filter((p) => !p.katalog.allowDuplicates)
      .map((p) => p.katalog.id);
    if (noDupKatalogIds.length) {
      // Task #1213: endast AKTIVA rader räknas som befintliga — arkiverade
      // poster (ersatta värden/historik-konverteringar) blockerar aldrig en ny
      // skrivning och får inte fångas som "gammalt värde".
      const existing = await db
        .select()
        .from(metadataVarden)
        .where(and(
          eq(metadataVarden.objektId, objektId),
          eq(metadataVarden.tenantId, tenantId),
          inArray(metadataVarden.metadataKatalogId, noDupKatalogIds),
          eq(metadataVarden.status, 'aktiv'),
        ));
      const existingSet = new Set(existing.map((e) => e.metadataKatalogId));
      if (existingSet.size) {
        if (overwriteExisting) {
          // Fånga gamla värden per katalog (för historik) och ARKIVERA dem
          // (Task #1213 G1: fullvärdiga arkiverade poster i stället för DELETE)
          // så att den nya inserten blir det enda AKTIVA ersättande värdet.
          // Set-baserat: rader med eget värde blir status='arkiverad'
          // (raderad=false, arvs_nedat=false → deltar aldrig i arv/visning);
          // tombstones utan eget värde raderas hårt (ren negativ-markering
          // som ersätts av det nya importerade värdet).
          for (const row of existing) {
            if (!overwrittenOldValues.has(row.metadataKatalogId)) {
              overwrittenOldValues.set(row.metadataKatalogId, getDisplayValue(row as MetadataVarden));
            }
          }
          const rowsWithValue = existing
            .filter((r) => getDisplayValue(r as MetadataVarden) !== null)
            .map((r) => r.id);
          const tombstoneRows = existing
            .filter((r) => getDisplayValue(r as MetadataVarden) === null)
            .map((r) => r.id);
          if (rowsWithValue.length) {
            await db
              .update(metadataVarden)
              .set({
                status: 'arkiverad',
                arkiveradAv: skapadAv ?? 'import',
                arkiveradVid: new Date(),
                arvsNedat: false,
                stoppaVidareArvning: false,
                raderad: false,
                raderadAv: null,
                raderadVid: null,
              })
              .where(and(
                eq(metadataVarden.tenantId, tenantId),
                inArray(metadataVarden.id, rowsWithValue),
              ));
          }
          if (tombstoneRows.length) {
            await db
              .delete(metadataVarden)
              .where(and(
                eq(metadataVarden.tenantId, tenantId),
                inArray(metadataVarden.id, tombstoneRows),
              ));
          }
        } else {
          for (let i = prepared.length - 1; i >= 0; i--) {
            if (!prepared[i].katalog.allowDuplicates && existingSet.has(prepared[i].katalog.id)) {
              prepared.splice(i, 1);
            }
          }
        }
      }
    }
  }
  if (prepared.length === 0) return;

  const buildVardenRow = (p: Prepared) => ({
    tenantId,
    objektId,
    metadataKatalogId: p.katalog.id,
    ...p.vardeFields,
    arvsNedat: p.katalog.standardArvs,
    nivaLas: false,
    skapadAv: skapadAv,
    metod: "import",
  });
  // Historik byggs ur den FAKTISKT insatta raden (inte positionellt mot
  // `prepared`) så att metadataVardenId/metadataKatalogId/nyttVarde alltid hör
  // ihop oavsett radordning i RETURNING. Speglar createMetadata exakt:
  // nyttVarde = getDisplayValue(insatt rad) (null tillåtet).
  const buildHistorikRow = (row: MetadataVarden) => ({
    tenantId,
    metadataVardenId: row.id,
    objektId,
    metadataKatalogId: row.metadataKatalogId,
    gammaltVarde: overwrittenOldValues.get(row.metadataKatalogId) ?? null,
    nyttVarde: getDisplayValue(row),
    andradAv: skapadAv ?? "system",
    andringsMetod: "import",
  });

  // Batch-insert med per-rad-fallback: om batchen mot förmodan fallerar (t.ex.
  // ett oväntat constraint-fel) faller vi tillbaka till en rad i taget så ett
  // enda dåligt värde inte tar ned hela objektets metadata — speglar den gamla
  // best-effort-semantiken per fält.
  try {
    const inserted = await db
      .insert(metadataVarden)
      .values(prepared.map(buildVardenRow) as any)
      .returning();
    if (inserted.length) {
      await db
        .insert(metadataHistorik)
        .values(inserted.map((row) => buildHistorikRow(row as MetadataVarden)) as any);
    }
  } catch {
    for (const p of prepared) {
      try {
        const [row] = await db
          .insert(metadataVarden)
          .values(buildVardenRow(p) as any)
          .returning();
        if (row) await db.insert(metadataHistorik).values(buildHistorikRow(row as MetadataVarden) as any);
      } catch {
        // hoppa tyst — best-effort metadata
      }
    }
  }

  // Bakgrundsjob: en gång per objekt (debouncas ändå per tenant).
  try {
    const { enqueueMetadataChange } = await import("./services/metadata-change-jobs");
    enqueueMetadataChange(tenantId, objektId);
  } catch (err) {
    console.error("[metadata-queries] enqueueMetadataChange failed (import batch):", err);
  }
}

// ======
// PRIMÄR ARVSKEDJA (delad primitiv)
// ----------------------------------------------------------------------------
// Returnerar objekt-id:n längs objektets PRIMÄRA förälderkedja, ordnade
// närmast-först: [self, primär-förälder, ..., rot]. `objects.parentId` speglar
// alltid den primära föräldern (se object_parents), så en enkel parent_id-
// vandring ger exakt den kedja som metadata-arv följer. Icke-primära föräldrar
// ärver aldrig nedåt och ingår därför inte. Används av arvs-skrivsemantiken
// (edit-på-källan / ny-instans-på-nivå) och snabbfälts-konfigens nedåt-arv.
// ======

export async function getPrimaryChainObjectIds(
  tenantId: string,
  objektId: string,
): Promise<string[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_id, 0 AS depth
      FROM objects
      WHERE id = ${objektId} AND tenant_id = ${tenantId}
      UNION ALL
      SELECT o.id, o.parent_id, c.depth + 1
      FROM objects o
      INNER JOIN chain c ON o.id = c.parent_id
      WHERE o.tenant_id = ${tenantId} AND c.depth < 100
    )
    SELECT id FROM chain ORDER BY depth ASC
  `);
  return (result.rows as any[]).map((r) => r.id as string);
}

// ======
// SNABBFÄLTS-KONFIG (objektvy 360, P1)
// Löser upp vilka (upp till tre) katalogfält som ska visas som "snabbfält" högst
// upp på ett objekt. Arvsmodellen speglar objekt-metadata: närmast-vinner uppåt
// den PRIMÄRA förälderkedjan (en per-objekt-rad åsidosätter alla förfäder), och
// om inget objekt i kedjan har en egen rad faller vi tillbaka på den tenant-
// omfattande objectHeaderConfigs för objektets objectType. En per-objekt-rad
// gäller ÄVEN om alla tre slots är tomma (= medvetet inga snabbfält här).
// ======

export interface ResolvedQuickFieldSlot {
  katalogId: string;
  namn: string;
  visningsnamn: string | null;
  datatyp: string;
  beteckning: string | null;
}

export interface ResolvedQuickFieldConfig {
  // Ordnade katalog-slots (hydrerade med namn/datatyp för klienten). Tomma slots
  // och katalogfält som inte längre finns/tillhör tenant filtreras bort.
  fields: ResolvedQuickFieldSlot[];
  // Var konfigen kom ifrån: ett specifikt objekt i kedjan, objekttyp-defaulten,
  // eller ingenstans (default null-konfig).
  source:
    | { level: "object"; objectId: string }
    | { level: "objectType"; objectType: string }
    // Task #1366: fallback-nivå — fält flaggade "Visa i objektvinjett" i katalogen.
    | { level: "katalog" }
    | { level: "none" };
  // Om DETTA objekt har en egen rad (styr om UI:t visar "åsidosatt" vs "ärvd").
  hasOwnOverride: boolean;
  // Råa slot-id:n från den vinnande konfigen (icke-hydrerade, i slot-ordning).
  rawKatalogIds: (string | null)[];
}

export async function resolveQuickFieldConfig(
  tenantId: string,
  objektId: string,
): Promise<ResolvedQuickFieldConfig> {
  const chain = await getPrimaryChainObjectIds(tenantId, objektId);

  // Hämta alla per-objekt-konfigar längs kedjan i EN fråga och välj närmast-först.
  let winning: { objectId: string; ids: (string | null)[] } | null = null;
  let hasOwnOverride = false;
  if (chain.length > 0) {
    const rows = await db
      .select({
        objectId: objectQuickFieldConfigs.objectId,
        f1: objectQuickFieldConfigs.field1KatalogId,
        f2: objectQuickFieldConfigs.field2KatalogId,
        f3: objectQuickFieldConfigs.field3KatalogId,
      })
      .from(objectQuickFieldConfigs)
      .where(and(
        eq(objectQuickFieldConfigs.tenantId, tenantId),
        inArray(objectQuickFieldConfigs.objectId, chain),
      ));
    const byObject = new Map(rows.map((r) => [r.objectId, r]));
    hasOwnOverride = byObject.has(objektId);
    for (const id of chain) {
      const row = byObject.get(id);
      if (row) {
        winning = { objectId: id, ids: [row.f1, row.f2, row.f3] };
        break;
      }
    }
  }

  let source: ResolvedQuickFieldConfig["source"] = { level: "none" };
  let rawKatalogIds: (string | null)[] = [];

  if (winning) {
    source = { level: "object", objectId: winning.objectId };
    rawKatalogIds = winning.ids;
  } else {
    // Fallback: tenant-omfattande objecttyp-default (objectHeaderConfigs).
    // Task #1486: objekttypen läses ur objektets EGNA metadata (Objekttyp) —
    // legacy-kolumnen objects.object_type finns inte längre. Uppslags-nyckeln
    // in i objectHeaderConfigs.objectType (STRING) är oförändrad.
    const [self] = await db
      .select({ objectType: objectOwnMetadataTextValueSql("Objekttyp") })
      .from(objects)
      .where(and(eq(objects.id, objektId), eq(objects.tenantId, tenantId)))
      .limit(1);
    if (self?.objectType) {
      const [cfg] = await db
        .select({
          f1: objectHeaderConfigs.field1KatalogId,
          f2: objectHeaderConfigs.field2KatalogId,
          f3: objectHeaderConfigs.field3KatalogId,
        })
        .from(objectHeaderConfigs)
        .where(and(
          eq(objectHeaderConfigs.tenantId, tenantId),
          eq(objectHeaderConfigs.objectType, self.objectType),
        ))
        .limit(1);
      if (cfg) {
        source = { level: "objectType", objectType: self.objectType };
        rawKatalogIds = [cfg.f1, cfg.f2, cfg.f3];
      }
    }
    // Task #1366: sista fallback — katalogfält flaggade "Visa i objektvinjett".
    // Upp till tre, ordnade efter displayNumber (nulls sist), sortOrder, namn.
    if (source.level === "none") {
      const flagged = await db
        .select({ id: metadataKatalog.id })
        .from(metadataKatalog)
        .where(and(
          eq(metadataKatalog.tenantId, tenantId),
          eq(metadataKatalog.visaIVinjett, true),
          isNull(metadataKatalog.deletedAt),
        ))
        .orderBy(
          sql`${metadataKatalog.displayNumber} ASC NULLS LAST`,
          asc(metadataKatalog.sortOrder),
          asc(metadataKatalog.namn),
        )
        .limit(3);
      if (flagged.length > 0) {
        source = { level: "katalog" };
        rawKatalogIds = flagged.map((f) => f.id);
      }
    }
  }

  // Hydrera slots (bevara slot-ordning; hoppa över tomma/okända/andra tenants).
  const ids = rawKatalogIds.filter((v): v is string => typeof v === "string" && v.length > 0);
  const fields: ResolvedQuickFieldSlot[] = [];
  if (ids.length > 0) {
    const katalogRows = await db
      .select({
        id: metadataKatalog.id,
        namn: metadataKatalog.namn,
        visningsnamn: metadataKatalog.visningsnamn,
        datatyp: metadataKatalog.datatyp,
        beteckning: metadataKatalog.beteckning,
      })
      .from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.tenantId, tenantId),
        inArray(metadataKatalog.id, ids),
        isNull(metadataKatalog.deletedAt),
      ));
    const byId = new Map(katalogRows.map((r) => [r.id, r]));
    for (const id of ids) {
      const k = byId.get(id);
      if (k) {
        fields.push({
          katalogId: k.id,
          namn: k.namn,
          visningsnamn: k.visningsnamn,
          datatyp: k.datatyp,
          beteckning: k.beteckning,
        });
      }
    }
  }

  return { fields, source, hasOwnOverride, rawKatalogIds };
}

// ======
// Task #1213 (G1): ARKIVERING AV ERSATTA VÄRDEN — enkelvärdesfält
// ----------------------------------------------------------------------------
// När ett enkelvärdesfält (allowDuplicates=false) får ett NYTT värde arkiveras
// det gamla värdet som en FULLVÄRDIG arkiverad post: en klonad rad med
// status='arkiverad' (raderad=false, arvs_nedat=false → deltar aldrig i arv
// eller närmaste-värde-visning). Den befintliga raden uppdateras därefter
// in-place så att metadata_varden.id förblir stabilt för alla referenser
// (koppladTillMetadataId, historik-pekare, klient-cachar).
// ======

async function insertArchivedClone(
  existing: MetadataVarden,
  arkiveradAv: string | undefined,
): Promise<void> {
  await db.insert(metadataVarden).values({
    tenantId: existing.tenantId,
    objektId: existing.objektId,
    workOrderId: existing.workOrderId,
    metadataKatalogId: existing.metadataKatalogId,
    vardeString: existing.vardeString,
    vardeInteger: existing.vardeInteger,
    vardeDecimal: existing.vardeDecimal,
    vardeBoolean: existing.vardeBoolean,
    vardeDatetime: existing.vardeDatetime,
    vardeJson: existing.vardeJson,
    vardeReferens: existing.vardeReferens,
    arvsNedat: false,
    stoppaVidareArvning: false,
    nivaLas: false,
    koppladTillMetadataId: existing.koppladTillMetadataId,
    skapadAv: existing.skapadAv,
    uppdateradAv: arkiveradAv,
    metod: existing.metod,
    raderad: false,
    status: 'arkiverad',
    arkiveradAv: arkiveradAv ?? 'system',
    arkiveradVid: new Date(),
    // Bevara ursprunglig skapandetid så den arkiverade posten sorterar rätt
    // i tidslinjer ("värdet gällde från createdAt till arkiveradVid").
    createdAt: existing.createdAt,
  });
}

// Task #1213: läs arkiverade poster (status='arkiverad') för ett objekt.
// Fullvärdiga arkiverade poster = ersatta enkelvärden, mjuk-borttagna egna
// värden och konverterade historikrader. Sorteras nyast-arkiverad först.
export async function getArchivedMetadataPosts(
  objektId: string,
  tenantId: string,
): Promise<Array<MetadataVarden & { katalog: MetadataKatalog | null }>> {
  const rows = await db
    .select()
    .from(metadataVarden)
    .leftJoin(metadataKatalog, eq(metadataVarden.metadataKatalogId, metadataKatalog.id))
    .where(and(
      eq(metadataVarden.objektId, objektId),
      eq(metadataVarden.tenantId, tenantId),
      eq(metadataVarden.status, 'arkiverad'),
    ))
    .orderBy(desc(metadataVarden.arkiveradVid), desc(metadataVarden.updatedAt));
  return rows.map((r) => ({
    ...r.metadata_varden,
    katalog: r.metadata_katalog ?? null,
  }));
}

// ======
// UPPDATERA METADATA
// ======

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

  // GDPR: anonymiserade rader är oåterkalleliga — värdet är förstört för alltid.
  // Ingen redigeringsväg får återuppliva dem (skriva nytt värde eller auto-återställa
  // status till 'aktiv'). Anonymiseringens egen underhållsväg går via
  // anonymizeObjectMetadataField (direkt db.update), aldrig genom updateMetadata.
  if (existing.status === 'anonymiserad') {
    throw new Error(`"${metadataTyp.namn}" är anonymiserat och kan inte ändras — anonymisering är oåterkallelig.`);
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
  // Task #1441: interimnummer (temporärt importfält) får endast skrivas via
  // import-vägen (auto-ursprung) — aldrig redigeras manuellt.
  if (isInterimKatalogNamn(metadataTyp.namn) && !isAutomaticOrigin(metod)) {
    throw new ReadonlyMetadataError(`"${metadataTyp.namn}" är ett tekniskt importfält och kan inte ändras manuellt.`);
  }
  if (isReadonlyOrigin(existing.metod) && !isAutomaticOrigin(metod)) {
    throw new Error(`"${metadataTyp.namn}" sattes av ${existing.metod === 'system' ? 'systemet' : 'en tjänst'} och kan inte redigeras manuellt.`);
  }

  // Rubrik/samlingsfält grupperar bara underfält och håller aldrig ett eget värde —
  // avvisa värdeskrivning även på uppdateringsvägen (matchar createMetadata).
  if (metadataTyp.datatyp === 'rubrik') {
    throw new Error(`"${metadataTyp.namn}" är ett rubrik-/samlingsfält och kan inte ha ett eget värde — det grupperar bara underfält.`);
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
      vardeFields.vardeDatetime = new Date(varde as string | number | Date);
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

  // Task #1213 (G1): nytt värde på ett enkelvärdesfält → gamla värdet arkiveras
  // som fullvärdig post innan raden uppdateras in-place (id-stabilt).
  const newDisplayProbe = getDisplayValue({ ...existing, ...vardeFields } as MetadataVarden);
  if (!metadataTyp.allowDuplicates && oldValue !== null && oldValue !== newDisplayProbe) {
    await insertArchivedClone(existing, uppdateradAv);
  }

  const [updated] = await db
    .update(metadataVarden)
    .set({
      ...vardeFields,
      uppdateradAv,
      metod: metod ?? 'manuell',
      status: 'aktiv',
      updatedAt: new Date(),
    })
    .where(and(eq(metadataVarden.id, metadataId), eq(metadataVarden.tenantId, tenantId)))
    .returning();

  // Race: raden kan ha raderats (deleteMetadataGuarded) mellan pre-läsningen och
  // UPDATE:n — då matchar WHERE inget. Svara med definierat "not found" (→404)
  // istället för att dereferera undefined (500).
  if (!updated) {
    throw new Error(`Metadata with id ${metadataId} not found`);
  }

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
    if (existing.objektId) enqueueMetadataChange(tenantId, existing.objektId);
  } catch (err) {
    console.error("[metadata-queries] enqueueMetadataChange failed (update):", err);
  }

  return updated;
}

export interface GuardedDeleteResult {
  status: 'deleted' | 'not_found' | 'blocked';
  changedHistorikCount: number;
  conceptFilterCount: number;
}

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

    // Task #1441: interimnummer (temporärt importfält) är re-import-matchnings-
    // nyckeln — manuell radering skulle tyst bryta matchningsförmågan.
    const katalogIdForDelete = existing.metadata_katalog_id ?? existing.metadataKatalogId;
    if (katalogIdForDelete && !isAutomaticOrigin(metod)) {
      const [kat] = await tx
        .select({ namn: metadataKatalog.namn })
        .from(metadataKatalog)
        .where(and(eq(metadataKatalog.id, katalogIdForDelete), eq(metadataKatalog.tenantId, tenantId)));
      if (kat && isInterimKatalogNamn(kat.namn)) {
        throw new ReadonlyMetadataError('Interimsnummer är ett tekniskt importfält och kan inte tas bort manuellt.');
      }
    }

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

// ======
// Task #1213: CENTRALT SKRIVLAGER — flagg-uppdatering & rollback-radering
// ----------------------------------------------------------------------------
// Alla metadata-writes ska gå via detta modul-API. Routes/services får inte
// köra egna db.update/db.delete direkt mot metadata_varden.
// ======

// Uppdaterar arvs-flaggor (arvsNedat / stoppaVidareArvning) på en befintlig
// metadata-post. Tenant-scoped; rör aldrig värdefält eller status.
export async function setMetadataInheritanceFlags(
  metadataId: string,
  tenantId: string,
  flags: { arvsNedat?: boolean; stoppaVidareArvning?: boolean },
  uppdateradAv?: string,
): Promise<MetadataVarden | undefined> {
  const [updated] = await db
    .update(metadataVarden)
    .set({
      ...(flags.arvsNedat !== undefined ? { arvsNedat: flags.arvsNedat } : {}),
      ...(flags.stoppaVidareArvning !== undefined ? { stoppaVidareArvning: flags.stoppaVidareArvning } : {}),
      ...(uppdateradAv !== undefined ? { uppdateradAv } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(metadataVarden.id, metadataId), eq(metadataVarden.tenantId, tenantId)))
    .returning();
  return updated;
}

// Hård-raderar metadata-rader som ett led i en ROLLBACK/ÅNGRA-operation
// (import-ångra, enrich-återställning). Detta är avsiktligt en riktig DELETE —
// raderna skapades av den operation som ångras och ska inte lämna arkivspår.
// Accepterar tx (drizzle-transaktion) eller db. Returnerar antal raderade.
export async function rollbackDeleteMetadataRows(
  executor: Pick<typeof db, 'delete'>,
  tenantId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const del = await executor
    .delete(metadataVarden)
    .where(and(inArray(metadataVarden.id, ids), eq(metadataVarden.tenantId, tenantId)))
    .returning({ id: metadataVarden.id });
  return del.length;
}

// ======
// Task #710: MJUK-RADERING & ÅTERSTÄLLNING AV OBJEKT-METADATA (Session 7 §4)
// ======

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
        if (existing.status !== 'aktiv') continue; // arkiverad/anonymiserad post — rör ej
        // Task #1213: mjuk-borttag av eget värde = logisk status 'arkiverad'
        // (fullvärdig arkiverad post); raderad-flaggan behålls som teknisk
        // mekanik för struken-visning + restore-vägen.
        await tx
          .update(metadataVarden)
          .set({
            raderad: true,
            raderadAv: actor,
            raderadVid: new Date(),
            uppdateradAv: actor,
            status: 'arkiverad',
            arkiveradAv: actor,
            arkiveradVid: new Date(),
          })
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
          .set({
            raderad: false,
            raderadAv: null,
            raderadVid: null,
            uppdateradAv: actor,
            status: 'aktiv',
            arkiveradAv: null,
            arkiveradVid: null,
          })
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

// ======
// Task #1218 (Etapp 6): GDPR-ANONYMISERING AV ETT METADATA-FÄLT PÅ ETT OBJEKT
// ----------------------------------------------------------------------------
// Oåterkalleligt: förstör värdet i ALLA kopior —
//  1. metadata_varden: alla rader för (objekt, katalog) oavsett status (aktiva,
//     arkiverade, tombstones) — värdefälten nollas, status='anonymiserad'.
//  2. metadata_historik: gammalt_varde/nytt_varde nollas för (objekt, katalog).
//  3. Audit-rad i historiken: VEM/NÄR — aldrig VAD (andringsMetod='anonymisering').
//  4. Uppgiftspaket-kopior (work_orders + assignments, ÄVEN frysta) + tekniska
//     spegelkolumner scrubbas om fältet matar paketet (åtkomst-/geo-fält).
//  5. Geo-spegelkolumner på objects (address/postalCode/city/koordinater).
// Ingen restore-väg finns eller får byggas.
// ======

// Katalog-namn (lowercase) som matar uppgiftspaketets åtkomst-del.
const ANON_ATKOMST_NAMN = new Set(['åtkomsttyp', 'åtkomstkod', 'nyckelnummer', 'åtkomstinfo']);
// Katalog-namn (lowercase) som matar position/geo-speglar.
const ANON_GEO_NAMN = new Set([
  'gatuadress', 'postnummer', 'postort', 'koordinater',
  'fördjupad position', 'avdelning/port/våning',
]);
// Geo-strängfält → objekt-kolumn (speglar GEO_COLUMN_MAP i geo-field-sync).
const ANON_GEO_OBJECT_COLUMN: Record<string, string> = {
  gatuadress: 'address',
  postnummer: 'postal_code',
  postort: 'city',
};

export interface AnonymizeResult {
  anonymizedRows: number;
  historikRowsScrubbed: number;
}

export async function anonymizeObjectMetadataField(
  objektId: string,
  metadataKatalogId: string,
  tenantId: string,
  anonymiseradAv: string,
): Promise<AnonymizeResult> {
  const [katalog] = await db
    .select()
    .from(metadataKatalog)
    .where(and(eq(metadataKatalog.id, metadataKatalogId), eq(metadataKatalog.tenantId, tenantId)))
    .limit(1);
  if (!katalog) {
    throw new InvalidMetadataInputError('Metadatadefinition hittades inte');
  }

  // Task #1441: interimnummer är ett tekniskt matchningsnummer (ingen persondata)
  // och är dessutom re-import-nyckeln — GDPR-anonymisering får aldrig röra det.
  if (isInterimKatalogNamn(katalog.namn)) {
    throw new ReadonlyMetadataError('Interimsnummer är ett tekniskt importfält och omfattas inte av anonymisering.');
  }

  const now = new Date();
  let anonymizedRows = 0;
  let historikRowsScrubbed = 0;

  await db.transaction(async (tx) => {
    // Lås ALLA lokala rader för katalogen (alla statusar) i deterministisk ordning.
    const locked = await tx.execute(sql`
      SELECT id FROM metadata_varden
      WHERE objekt_id = ${objektId}
        AND metadata_katalog_id = ${metadataKatalogId}
        AND tenant_id = ${tenantId}
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    `);
    const ids = (locked.rows as Array<{ id: string }>).map((r) => r.id);

    // Fail closed: inget lokalt värde ⇒ anonymisera INGET (ingen historik-scrub,
    // ingen audit-rad, inga spegel-scrubbar) och rapportera aldrig falsk framgång.
    // Ärvda värden måste anonymiseras på källobjektet.
    if (ids.length === 0) {
      throw new NoLocalMetadataToAnonymizeError();
    }

    await tx
      .update(metadataVarden)
      .set({
        vardeString: null,
        vardeInteger: null,
        vardeDecimal: null,
        vardeBoolean: null,
        vardeDatetime: null,
        vardeJson: null,
        vardeReferens: null,
        status: 'anonymiserad',
        anonymiseradAv,
        anonymiseradVid: now,
        uppdateradAv: anonymiseradAv,
        updatedAt: now,
      })
      .where(and(inArray(metadataVarden.id, ids), eq(metadataVarden.tenantId, tenantId)));
    anonymizedRows = ids.length;

    // Historiken: förstör gamla/nya värden för fältet på objektet.
    const scrubbed = await tx.execute(sql`
      UPDATE metadata_historik
      SET gammalt_varde = NULL, nytt_varde = NULL
      WHERE objekt_id = ${objektId}
        AND metadata_katalog_id = ${metadataKatalogId}
        AND tenant_id = ${tenantId}
        AND (gammalt_varde IS NOT NULL OR nytt_varde IS NOT NULL)
    `);
    historikRowsScrubbed = scrubbed.rowCount ?? 0;

    // Audit-rad: VEM och NÄR — aldrig VAD.
    await tx.insert(metadataHistorik).values({
      tenantId,
      metadataVardenId: ids[0] ?? null,
      objektId,
      metadataKatalogId,
      gammaltVarde: null,
      nyttVarde: null,
      andradAv: anonymiseradAv,
      andringsMetod: 'anonymisering',
    });
  });

  const namnKey = (katalog.namn ?? '').toLowerCase();

  // GDPR-completeness: alla DURABLA/icke-automatiskt-ombyggda kopior av värdet
  // MÅSTE förstöras som del av success-kontraktet. Om någon av dessa misslyckas
  // KASTAR vi (→ non-200) så anonymiseringen aldrig rapporteras klar medan
  // personuppgifter ligger kvar i en kopia. Den primära raden är redan
  // committad+nullad, så en retry är idempotent (låser om den nu nullade raden).

  // Geo-spegelkolumner på objektet. Enkelriktad cache, men rebuild sker inte
  // automatiskt till NULL — måste därför scrubbas här (obligatoriskt).
  const objectColumn = ANON_GEO_OBJECT_COLUMN[namnKey];
  if (objectColumn) {
    await db.execute(sql`
      UPDATE objects SET ${sql.raw(`"${objectColumn}"`)} = NULL
      WHERE id = ${objektId} AND tenant_id = ${tenantId}
    `);
  }
  if (namnKey === 'koordinater') {
    await db.execute(sql`
      UPDATE objects SET latitude = NULL, longitude = NULL,
        entrance_latitude = NULL, entrance_longitude = NULL
      WHERE id = ${objektId} AND tenant_id = ${tenantId}
    `);
  }

  const { scrubUppgiftspaketForAnonymization, propagateUppgiftspaket } = await import(
    './services/uppgiftspaket'
  );
  const scrubAtkomst = ANON_ATKOMST_NAMN.has(namnKey);
  const scrubPosition = ANON_GEO_NAMN.has(namnKey);

  // Uppgiftspaket-kopior (jsonb på work_orders + assignments i HELA subträdet,
  // inkl. FRYSTA uppgifter) är durabla kopior som INTE byggs om från källan.
  // Obligatorisk scrub — kastar vidare vid fel (surfaced som non-200).
  if (scrubAtkomst || scrubPosition) {
    await scrubUppgiftspaketForAnonymization(tenantId, objektId, {
      atkomst: scrubAtkomst,
      position: scrubPosition,
    });
  }

  // Rebuild av ÖPPNA uppgifters paket från den nu-nullade källan är en cache-lik
  // projektion (öppna paket byggs ändå om vid nästa propagering/läsning) →
  // best-effort; får inte fälla en redan komplett anonymisering.
  try {
    await propagateUppgiftspaket(tenantId, [objektId]);
  } catch (err) {
    console.error(
      `[metadata-queries] uppgiftspaket-rebuild (öppna) efter anonymisering misslyckades (objekt ${objektId}):`,
      err,
    );
  }

  return { anonymizedRows, historikRowsScrubbed };
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

// ======
// Task #579: HÄMTA HISTORIK PER (OBJEKT, DEFINITION)
// Kronologisk tidslinje för ett specifikt fält på ett objekt — fungerar även
// efter att själva metadata_varden-raden har raderats (cascade), eftersom vi
// filtrerar på katalog-id direkt och låter NULL-värden från cascade-radade
// historik-rader filtreras bort på applikationsnivå om de förekommer.
// ======

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

// ======
// PROPAGERA METADATA NEDÅT TILL BARNOBJEKT
// ======

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

// ======
// PROPAGERINGS-PREVIEW - visa vilka objekt som påverkas
// ======

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

// ======
// ARVSTRADSVY - visa metadata-arv genom hierarkin
// ======

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
  // Task #1486: objekttypen (typ) härleds ur objektets EGNA metadata (Objekttyp)
  // i den yttre SELECT:en — legacy-kolumnen object_type finns inte längre.
  const treeQuery = sql`
    WITH RECURSIVE tree AS (
      SELECT id, name, parent_id, 0 as level, ARRAY[id] as path
      FROM objects
      WHERE id = ${rootId} AND tenant_id = ${tenantId}
      UNION ALL
      SELECT o.id, o.name, o.parent_id, t.level + 1, t.path || o.id
      FROM objects o
      INNER JOIN tree t ON o.parent_id = t.id
      WHERE o.tenant_id = ${tenantId}
    )
    SELECT 
      t.id, t.name, ${objectOwnMetadataTextValueSqlFor("Objekttyp", sql.raw("t.id"))} AS object_type, t.parent_id, t.level,
      mv.id as metadata_id,
      COALESCE(mv.varde_string, CAST(mv.varde_integer AS TEXT), CAST(mv.varde_decimal AS TEXT), CAST(mv.varde_boolean AS TEXT), mv.varde_referens) as varde,
      COALESCE(mv.niva_las, FALSE) as niva_las,
      COALESCE(mv.arvs_nedat, FALSE) as arvs_nedat
    FROM tree t
    LEFT JOIN metadata_varden mv ON mv.objekt_id = t.id 
      AND mv.metadata_katalog_id = ${metadataKatalogId}
      AND mv.tenant_id = ${tenantId}
      AND (mv.status = 'aktiv' OR COALESCE(mv.raderad, FALSE) = TRUE)
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

// ======
// HÄMTA METADATA FÖR ARBETSORDER (artikel-koppling)
// ======

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

// ======
// HÄMTA METADATA-HISTORIK
// ======

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
      importBatchId: metadataHistorik.importBatchId,
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

// ======
// HÄMTA KORSBEFRUKTAD METADATA
// ======

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
      AND mv_related.status = 'aktiv'
    WHERE
      mv_base.objekt_id = ${objektId}
      AND mk_base.namn = ${baseMetadataTypNamn}
      AND mv_base.tenant_id = ${tenantId}
      AND mv_base.status = 'aktiv'
  `;

  const result = await db.execute(query);
  return result.rows as any[];
}

// ======
// GEOGRAFISK UPPLÖSNINGSORDNING
// GPS (exakt) > Adress (grov)
// ======

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

// ======
// HÄMTA KLUSTERTRÄD
// ======

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
  // Task #1486: objekttypen (typ) härleds ur objektets EGNA metadata (Objekttyp)
  // i den yttre SELECT:en — legacy-kolumnen object_type finns inte längre.
  const treeQuery = sql`
    WITH RECURSIVE tree AS (
      SELECT
        id,
        name,
        parent_id,
        0 as level,
        ARRAY[id] as path
      FROM objects
      WHERE id = ${rootId} AND tenant_id = ${tenantId}

      UNION ALL

      SELECT
        o.id,
        o.name,
        o.parent_id,
        t.level + 1,
        t.path || o.id
      FROM objects o
      INNER JOIN tree t ON o.parent_id = t.id
      WHERE o.tenant_id = ${tenantId}
    )
    SELECT
      t.id,
      t.name,
      ${objectOwnMetadataTextValueSqlFor("Objekttyp", sql.raw("t.id"))} AS object_type,
      t.parent_id,
      t.level,
      t.path
    FROM tree t
    ORDER BY t.path
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

// ======
// HITTA OBJEKT MED SPECIFIK METADATA
// ======

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
      AND mv.status = 'aktiv'
      AND COALESCE(mv.raderad, FALSE) = FALSE
  `;

  if (varde !== undefined) {
    baseQuery = sql`
      SELECT DISTINCT o.id
      FROM objects o
      INNER JOIN metadata_varden mv ON mv.objekt_id = o.id
      INNER JOIN metadata_katalog mk ON mv.metadata_katalog_id = mk.id
      WHERE mk.namn = ${metadataTypNamn}
        AND o.tenant_id = ${tenantId}
        AND mv.status = 'aktiv'
        AND COALESCE(mv.raderad, FALSE) = FALSE
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

// ======
// HÄMTA ALLA METADATATYPER FÖR EN TENANT
// ======

export async function getAllMetadataTypes(tenantId: string): Promise<MetadataKatalog[]> {
  // Task #716: arkiverade typer (deleted_at satt) döljs från katalog/objektvyer.
  return await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.tenantId, tenantId),
      isNull(metadataKatalog.deletedAt),
    ))
    .orderBy(metadataKatalog.area, metadataKatalog.sortOrder);
}

// Task #716: arkivera (soft-delete) en metadatatyp. Returnerar false om typen inte
// finns/redan arkiverad inom tenant. Historiska metadata_snapshot/varden påverkas ej.
export async function softDeleteMetadataType(
  tenantId: string,
  id: string,
  opts?: { archivedBy?: string | null; archivedReason?: string | null },
): Promise<boolean> {
  const result = await db
    .update(metadataKatalog)
    .set({
      deletedAt: new Date(),
      archivedBy: opts?.archivedBy ?? null,
      archivedReason: opts?.archivedReason ?? null,
    })
    .where(and(
      eq(metadataKatalog.id, id),
      eq(metadataKatalog.tenantId, tenantId),
      isNull(metadataKatalog.deletedAt),
    ))
    .returning({ id: metadataKatalog.id });
  return result.length > 0;
}

// Skiftlägesokänsligt identitetsuppslag för metadata_katalog. `namn` och (icke-null)
// `beteckning` är per-tenant unika universella nycklar — matchning måste vara
// skiftlägesokänslig (seedDefaultMetadataTypes dedupar redan via toLowerCase) så att
// t.ex. "Kontakt" och "kontakt" inte kan samexistera. Returnerar första matchande raden
// (eller null) så anropare kan skilja en AKTIV kollision ("finns redan", 409) från en
// ARKIVERAD kollision (återställ-vägen). `excludeId` används vid omdöpning så att raden
// inte kolliderar med sig själv.
export type MetadataIdentityField = "namn" | "beteckning";

export async function findMetadataTypeByIdentity(
  tenantId: string,
  field: MetadataIdentityField,
  value: string,
  opts: { archived: boolean; excludeId?: string },
): Promise<Pick<MetadataKatalog, "id" | "namn" | "beteckning" | "datatyp" | "area" | "deletedAt"> | null> {
  const col = field === "namn" ? metadataKatalog.namn : metadataKatalog.beteckning;
  const rows = await db
    .select({
      id: metadataKatalog.id,
      namn: metadataKatalog.namn,
      beteckning: metadataKatalog.beteckning,
      datatyp: metadataKatalog.datatyp,
      area: metadataKatalog.area,
      deletedAt: metadataKatalog.deletedAt,
    })
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.tenantId, tenantId),
      sql`lower(${col}) = lower(${value})`,
      opts.archived ? isNotNull(metadataKatalog.deletedAt) : isNull(metadataKatalog.deletedAt),
    ))
    .limit(opts.excludeId ? 10 : 1);
  const match = rows.find((r) => !opts.excludeId || r.id !== opts.excludeId);
  return match ?? null;
}

// Task #716: återställ en arkiverad metadatatyp. Blockerar (returnerar collision) om
// en AKTIV typ med samma namn/beteckning redan finns — då dessa är universella nycklar.
export async function restoreMetadataType(
  tenantId: string,
  id: string,
): Promise<{ ok: true; type: MetadataKatalog } | { ok: false; reason: "not_found" } | { ok: false; reason: "name_collision"; conflict: string }> {
  const [archived] = await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.id, id),
      eq(metadataKatalog.tenantId, tenantId),
      isNotNull(metadataKatalog.deletedAt),
    ))
    .limit(1);
  if (!archived) return { ok: false, reason: "not_found" };

  // Kollision mot aktiv typ med samma namn? Skiftlägesokänsligt — namnet är en
  // universell nyckel och "Kontakt"/"kontakt" får inte samexistera.
  const [nameClash] = await db
    .select({ id: metadataKatalog.id })
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.tenantId, tenantId),
      sql`lower(${metadataKatalog.namn}) = lower(${archived.namn})`,
      isNull(metadataKatalog.deletedAt),
    ))
    .limit(1);
  if (nameClash) {
    return { ok: false, reason: "name_collision", conflict: `namn "${archived.namn}"` };
  }
  if (archived.beteckning) {
    const [betClash] = await db
      .select({ id: metadataKatalog.id })
      .from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.tenantId, tenantId),
        sql`lower(${metadataKatalog.beteckning}) = lower(${archived.beteckning})`,
        isNull(metadataKatalog.deletedAt),
      ))
      .limit(1);
    if (betClash) {
      return { ok: false, reason: "name_collision", conflict: `beteckning "${archived.beteckning}"` };
    }
  }

  const [restored] = await db
    .update(metadataKatalog)
    .set({ deletedAt: null, archivedBy: null, archivedReason: null })
    .where(and(
      eq(metadataKatalog.id, id),
      eq(metadataKatalog.tenantId, tenantId),
    ))
    .returning();
  return { ok: true, type: restored };
}

// Task #716: lista arkiverade metadatatyper för admin-arkivet.
export async function listArchivedMetadataTypes(tenantId: string): Promise<MetadataKatalog[]> {
  return await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.tenantId, tenantId),
      isNotNull(metadataKatalog.deletedAt),
    ))
    .orderBy(desc(metadataKatalog.deletedAt));
}

// ======
// IMPORTSKAPADE KATALOGFÄLT — STÄDNING/KANONISERING (Task #1497)
// ----------------------------------------------------------------------------
// Före Task #1494 kunde importflöden lazy-skapa katalogfält (kategori 'import'
// eller 'importerad') utan att någon medvetet definierat dem. Dessa hjälpare
// listar sådana fält med användningsräkning och kan slå ihop ett importskapat
// fält mot ett kanoniskt fält (repoint av värden/historik/kopplingar) med samma
// hårda skydd som övriga katalog-writes: usage-bekräftelse krävs, källfältet
// arkiveras (soft-delete) — ALDRIG hard-delete med historik.
// ======

export const IMPORT_CREATED_KATEGORIER = ["import", "importerad"] as const;

export type ImportCreatedMetadataType = MetadataKatalog & {
  valueCount: number;
  conceptFilterCount: number;
  configRefCount: number;
  usageTotal: number;
};

// Räkna KONFIGURATIONS-referenser till en katalogpost: ordertyp-länkar, kundlås,
// objekthuvud-konfigar (bild/logo/fält-slots) och snabbfälts-konfigar. Dessa är
// "i bruk" i lika hög grad som lagrade värden — ett fält med enbart sådana
// referenser får inte arkiveras via städvyn (konfigen skulle peka på ett
// arkiverat fält). Ett enda DB-anrop; kan räkna flera fält åt gången.
export async function countMetadataKatalogConfigRefs(
  tenantId: string,
  katalogIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (katalogIds.length === 0) return result;
  const idList = sql.join(katalogIds, sql`, `);
  const res = await db.execute(sql`
    SELECT id, SUM(c)::int AS c FROM (
      SELECT metadata_katalog_id AS id, COUNT(*) AS c
      FROM order_type_metadata_links
      WHERE tenant_id = ${tenantId} AND metadata_katalog_id IN (${idList})
      GROUP BY metadata_katalog_id
      UNION ALL
      SELECT metadata_katalog_id, COUNT(*)
      FROM metadata_katalog_customers
      WHERE tenant_id = ${tenantId} AND metadata_katalog_id IN (${idList})
      GROUP BY metadata_katalog_id
      UNION ALL
      SELECT k.kid, COUNT(*)
      FROM object_header_configs ohc,
        LATERAL unnest(ARRAY[
          ohc.image_metadata_katalog_id, ohc.logo_metadata_katalog_id,
          ohc.field1_katalog_id, ohc.field2_katalog_id, ohc.field3_katalog_id
        ]) AS k(kid)
      WHERE ohc.tenant_id = ${tenantId} AND k.kid IN (${idList})
      GROUP BY k.kid
      UNION ALL
      SELECT fid, COUNT(*)
      FROM import_templates it, LATERAL unnest(it.field_ids) AS f(fid)
      WHERE it.tenant_id = ${tenantId} AND f.fid IN (${idList})
      GROUP BY fid
      UNION ALL
      SELECT metadata_katalog_id, COUNT(*)
      FROM metadata_editor_fields
      WHERE tenant_id = ${tenantId} AND metadata_katalog_id IN (${idList})
      GROUP BY metadata_katalog_id
      UNION ALL
      SELECT sv.metadata_katalog_id, COUNT(*)
      FROM metadata_editor_submission_values sv
      JOIN metadata_editor_submissions s ON s.id = sv.submission_id
      WHERE s.tenant_id = ${tenantId} AND s.status = 'pending'
        AND sv.metadata_katalog_id IN (${idList})
      GROUP BY sv.metadata_katalog_id
      UNION ALL
      SELECT k.kid, COUNT(*)
      FROM object_quick_field_configs oqc,
        LATERAL unnest(ARRAY[
          oqc.field1_katalog_id, oqc.field2_katalog_id, oqc.field3_katalog_id
        ]) AS k(kid)
      WHERE oqc.tenant_id = ${tenantId} AND k.kid IN (${idList})
      GROUP BY k.kid
    ) refs
    GROUP BY id
  `);
  for (const row of res.rows as Array<{ id: string; c: number }>) {
    result.set(row.id, Number(row.c));
  }
  return result;
}

// Fullständig användningsräkning för ett importskapat fält: lagrade värden +
// koncept-filter + konfigurations-referenser. Används av arkiverings-vakten.
export async function getImportCreatedFieldTotalUsage(
  tenantId: string,
  katalogId: string,
): Promise<{ valueCount: number; conceptFilterCount: number; configRefCount: number; total: number }> {
  const usage = await getMetadataKatalogUsage(katalogId, tenantId);
  const configRefs = await countMetadataKatalogConfigRefs(tenantId, [katalogId]);
  const configRefCount = configRefs.get(katalogId) ?? 0;
  return {
    valueCount: usage.valueCount,
    conceptFilterCount: usage.conceptFilterCount,
    configRefCount,
    total: usage.valueCount + usage.conceptFilterCount + configRefCount,
  };
}

// Lista aktiva katalogfält skapade av importflödet (kategori 'import'/'importerad')
// med användningsräkning (metadata_varden-rader + koncept-filter som refererar
// fältet via namn/beteckning). System-/definitionslåsta fält (t.ex. interim-
// nyckeln) exkluderas — de är avsiktliga interna systemfält, inte städkandidater.
export async function listImportCreatedMetadataTypes(
  tenantId: string,
): Promise<ImportCreatedMetadataType[]> {
  const rows = await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.tenantId, tenantId),
      isNull(metadataKatalog.deletedAt),
      inArray(metadataKatalog.kategori, [...IMPORT_CREATED_KATEGORIER]),
      eq(metadataKatalog.isSystem, false),
      eq(metadataKatalog.systemlast, false),
    ))
    .orderBy(asc(metadataKatalog.namn));
  const active = rows.filter((r) => !isInterimKatalogNamn(r.namn));
  if (active.length === 0) return [];

  const ids = active.map((r) => r.id);
  const valuesRes = await db.execute(sql`
    SELECT metadata_katalog_id AS id, COUNT(*)::int AS c
    FROM metadata_varden
    WHERE tenant_id = ${tenantId}
      AND metadata_katalog_id IN (${sql.join(ids, sql`, `)})
    GROUP BY metadata_katalog_id
  `);
  const valueCounts = new Map<string, number>(
    (valuesRes.rows as Array<{ id: string; c: number }>).map((r) => [r.id, Number(r.c)]),
  );

  // Koncept-filter refererar fält via metadata_key = namn ELLER beteckning
  // (concept_filters saknar tenant_id — scopas via order_concepts).
  const refKeys = Array.from(new Set(
    active.flatMap((r) => [r.namn, r.beteckning]).filter(
      (k): k is string => typeof k === "string" && k.length > 0,
    ),
  ));
  const filterCounts = new Map<string, number>();
  if (refKeys.length > 0) {
    const filtersRes = await db.execute(sql`
      SELECT cf.metadata_key AS k, COUNT(*)::int AS c
      FROM concept_filters cf
      JOIN order_concepts oc ON oc.id = cf.order_concept_id
      WHERE oc.tenant_id = ${tenantId}
        AND oc.deleted_at IS NULL
        AND cf.metadata_key IN (${sql.join(refKeys, sql`, `)})
      GROUP BY cf.metadata_key
    `);
    for (const row of filtersRes.rows as Array<{ k: string; c: number }>) {
      filterCounts.set(row.k, Number(row.c));
    }
  }

  const configRefCounts = await countMetadataKatalogConfigRefs(tenantId, ids);

  return active.map((r) => {
    const valueCount = valueCounts.get(r.id) ?? 0;
    const conceptFilterCount =
      (r.namn ? filterCounts.get(r.namn) ?? 0 : 0) +
      (r.beteckning ? filterCounts.get(r.beteckning) ?? 0 : 0);
    const configRefCount = configRefCounts.get(r.id) ?? 0;
    return {
      ...r,
      valueCount,
      conceptFilterCount,
      configRefCount,
      usageTotal: valueCount + conceptFilterCount + configRefCount,
    };
  });
}

export type MergeImportMetadataTypeResult =
  | { ok: true; movedValues: number; movedHistorik: number; updatedConceptFilters: number }
  | { ok: false; status: number; error: string; code?: string; expectedUsage?: number };

// Slå ihop ett importskapat katalogfält (source) mot ett kanoniskt fält (target):
// repointar metadata_varden/metadata_historik/ordertyp-länkar/kundlås/header- och
// snabbfälts-konfigar + koncept-filter (namn-nyckel), och arkiverar därefter
// källfältet (soft-delete, historiken bevaras). Kräver exakt usage-bekräftelse
// (confirmUsage === källfältets valueCount) — samma hårda skydd som övriga
// katalog-writes.
export async function mergeImportMetadataType(
  tenantId: string,
  sourceId: string,
  targetId: string,
  opts: { confirmUsage: number; mergedBy?: string | null },
): Promise<MergeImportMetadataTypeResult> {
  if (sourceId === targetId) {
    return { ok: false, status: 400, error: "Käll- och målfält kan inte vara samma fält." };
  }
  const rows = await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.tenantId, tenantId),
      inArray(metadataKatalog.id, [sourceId, targetId]),
    ));
  const source = rows.find((r) => r.id === sourceId);
  const target = rows.find((r) => r.id === targetId);
  if (!source) return { ok: false, status: 404, error: "Källfältet hittades inte." };
  if (!target) return { ok: false, status: 404, error: "Målfältet hittades inte." };
  if (source.deletedAt) return { ok: false, status: 409, error: "Källfältet är redan arkiverat." };
  if (target.deletedAt) {
    return { ok: false, status: 409, error: "Målfältet är arkiverat — återställ det först." };
  }
  if (!IMPORT_CREATED_KATEGORIER.includes((source.kategori ?? "") as any)) {
    return {
      ok: false, status: 400,
      error: "Endast importskapade fält (kategori 'import'/'importerad') kan slås ihop via städvyn.",
    };
  }
  if (source.isSystem || source.systemlast || isInterimKatalogNamn(source.namn)) {
    return { ok: false, status: 403, error: "Systemlåsta fält kan inte slås ihop." };
  }
  // Målet måste vara ett KANONISKT fält — att slå ihop ett importskapat fält
  // mot ett annat importskapat fält skulle bara flytta röran (server-side-vakt,
  // klientens väljare filtrerar redan).
  if (IMPORT_CREATED_KATEGORIER.includes((target.kategori ?? "") as any)) {
    return {
      ok: false, status: 400,
      error: "Målfältet är också importskapat — välj ett kanoniskt (medvetet definierat) fält som mål.",
    };
  }
  if (target.arBeraknad) {
    return { ok: false, status: 400, error: "Målfältet är ett beräknat fält och kan inte ta emot lagrade värden." };
  }
  if (target.datatyp === "rubrik" || source.datatyp === "rubrik") {
    return { ok: false, status: 400, error: "Rubrik-/samlingsfält kan inte slås ihop — de lagrar inga värden." };
  }
  if (source.datatyp !== target.datatyp) {
    return {
      ok: false, status: 400,
      error: `Fälten har olika datatyp (${source.datatyp} ≠ ${target.datatyp}) — värdena kan inte flyttas säkert.`,
    };
  }
  // Källfält som är förälder i en familj kan inte slås ihop (barnen skulle bli föräldralösa).
  const [child] = await db
    .select({ id: metadataKatalog.id })
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.tenantId, tenantId),
      eq(metadataKatalog.parentMetadataId, sourceId),
      isNull(metadataKatalog.deletedAt),
    ))
    .limit(1);
  if (child) {
    return { ok: false, status: 409, error: "Källfältet har underfält — flytta eller arkivera underfälten först." };
  }

  // Hård usage-bekräftelse: confirmUsage måste vara exakt antalet värde-rader.
  const usage = await getMetadataKatalogUsage(sourceId, tenantId);
  if (opts.confirmUsage !== usage.valueCount) {
    return {
      ok: false, status: 409, code: "USAGE_CONFIRMATION_MISMATCH",
      expectedUsage: usage.valueCount,
      error: `Bekräftelsen matchar inte — fältet har ${usage.valueCount} lagrade värden. Skicka confirmUsage=${usage.valueCount} för att slå ihop.`,
    };
  }

  // Kollisionskontroll: när målet INTE tillåter flervärden får inget objekt/WO
  // ha lokala värden i BÅDA fälten (skulle ge dubbla "ersättande" värden).
  if (!target.allowDuplicates) {
    const conflictRes = await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM (
        SELECT COALESCE(objekt_id, work_order_id) AS holder
        FROM metadata_varden
        WHERE tenant_id = ${tenantId} AND metadata_katalog_id = ${sourceId}
        INTERSECT
        SELECT COALESCE(objekt_id, work_order_id) AS holder
        FROM metadata_varden
        WHERE tenant_id = ${tenantId} AND metadata_katalog_id = ${targetId}
      ) x
    `);
    const conflicts = Number((conflictRes.rows[0] as { c: number } | undefined)?.c ?? 0);
    if (conflicts > 0) {
      return {
        ok: false, status: 409, code: "VALUE_CONFLICTS",
        error: `${conflicts} objekt/arbetsordrar har värden i BÅDA fälten och målet tillåter bara ett värde. Rensa dubbletterna först eller välj ett annat målfält.`,
      };
    }
  }

  return await db.transaction(async (tx) => {
    // 1) Värden + historik pekas om till målfältet (historiken följer med).
    const movedValuesRes = await tx.execute(sql`
      UPDATE metadata_varden SET metadata_katalog_id = ${targetId}
      WHERE tenant_id = ${tenantId} AND metadata_katalog_id = ${sourceId}
    `);
    const movedHistorikRes = await tx.execute(sql`
      UPDATE metadata_historik SET metadata_katalog_id = ${targetId}
      WHERE tenant_id = ${tenantId} AND metadata_katalog_id = ${sourceId}
    `);

    // 2) Ordertyp-länkar: ta bort käll-länkar som kolliderar med befintlig
    //    mål-länk (unik per tenant+ordertyp+katalog), repointa resten.
    await tx.execute(sql`
      DELETE FROM order_type_metadata_links s
      WHERE s.tenant_id = ${tenantId} AND s.metadata_katalog_id = ${sourceId}
        AND EXISTS (
          SELECT 1 FROM order_type_metadata_links t
          WHERE t.tenant_id = s.tenant_id AND t.order_type = s.order_type
            AND t.metadata_katalog_id = ${targetId}
        )
    `);
    await tx.execute(sql`
      UPDATE order_type_metadata_links SET metadata_katalog_id = ${targetId}
      WHERE tenant_id = ${tenantId} AND metadata_katalog_id = ${sourceId}
    `);

    // 3) Kundlås-kopplingar: dedupe + repoint.
    await tx.execute(sql`
      DELETE FROM metadata_katalog_customers s
      WHERE s.tenant_id = ${tenantId} AND s.metadata_katalog_id = ${sourceId}
        AND EXISTS (
          SELECT 1 FROM metadata_katalog_customers t
          WHERE t.tenant_id = s.tenant_id AND t.customer_id = s.customer_id
            AND t.metadata_katalog_id = ${targetId}
        )
    `);
    await tx.execute(sql`
      UPDATE metadata_katalog_customers SET metadata_katalog_id = ${targetId}
      WHERE tenant_id = ${tenantId} AND metadata_katalog_id = ${sourceId}
    `);

    // 4) Header-/snabbfälts-konfigar som pekar in källfältet.
    for (const col of [
      "image_metadata_katalog_id", "logo_metadata_katalog_id",
      "field1_katalog_id", "field2_katalog_id", "field3_katalog_id",
    ]) {
      await tx.execute(sql`
        UPDATE object_header_configs SET ${sql.raw(`"${col}"`)} = ${targetId}
        WHERE tenant_id = ${tenantId} AND ${sql.raw(`"${col}"`)} = ${sourceId}
      `);
    }
    for (const col of ["field1_katalog_id", "field2_katalog_id", "field3_katalog_id"]) {
      await tx.execute(sql`
        UPDATE object_quick_field_configs SET ${sql.raw(`"${col}"`)} = ${targetId}
        WHERE tenant_id = ${tenantId} AND ${sql.raw(`"${col}"`)} = ${sourceId}
      `);
    }

    // 4a) Importmallar: byt ut käll-id mot mål-id i field_ids-arrayen —
    // bevara ordningen (positionsvis ersättning) och deduplicera om målet
    // redan finns i mallen (behåll första förekomsten).
    await tx.execute(sql`
      UPDATE import_templates it SET field_ids = sub.new_ids, updated_at = NOW()
      FROM (
        SELECT t.id, ARRAY(
          SELECT fid FROM (
            SELECT CASE WHEN f.fid = ${sourceId} THEN ${targetId} ELSE f.fid END AS fid,
                   f.ord,
                   ROW_NUMBER() OVER (
                     PARTITION BY CASE WHEN f.fid = ${sourceId} THEN ${targetId} ELSE f.fid END
                     ORDER BY f.ord
                   ) AS rn
            FROM unnest(t.field_ids) WITH ORDINALITY AS f(fid, ord)
          ) mapped
          WHERE rn = 1
          ORDER BY ord
        ) AS new_ids
        FROM import_templates t
        WHERE t.tenant_id = ${tenantId} AND ${sourceId} = ANY(t.field_ids)
      ) sub
      WHERE it.id = sub.id
    `);

    // 4b) Metadata-editorer: fält som skriver in i källfältet repointas till
    // målet så framtida inlämningar landar i det kanoniska fältet.
    await tx.execute(sql`
      UPDATE metadata_editor_fields SET metadata_katalog_id = ${targetId}
      WHERE tenant_id = ${tenantId} AND metadata_katalog_id = ${sourceId}
    `);
    // Inlämnings-snapshots: PENDING inlämningar godkänns senare mot snapshotens
    // katalog-id — repointa dem så approve skriver till det kanoniska fältet.
    // Godkända/avvisade inlämningar är historik och lämnas orörda (medvetet
    // beslut: snapshoten dokumenterar vad som gällde vid inlämningen; redan
    // godkända värden flyttas ändå via metadata_varden-repointen ovan).
    await tx.execute(sql`
      UPDATE metadata_editor_submission_values sv SET metadata_katalog_id = ${targetId}
      FROM metadata_editor_submissions s
      WHERE s.id = sv.submission_id
        AND s.tenant_id = ${tenantId} AND s.status = 'pending'
        AND sv.tenant_id = ${tenantId} AND sv.metadata_katalog_id = ${sourceId}
    `);

    // 5) Koncept-filter (namn-nyckel): repointa metadata_key mot målets namn.
    const sourceKeys = [source.namn, source.beteckning].filter(
      (k): k is string => typeof k === "string" && k.length > 0,
    );
    let updatedConceptFilters = 0;
    if (sourceKeys.length > 0) {
      const cfRes = await tx.execute(sql`
        UPDATE concept_filters cf SET metadata_key = ${target.namn}
        FROM order_concepts oc
        WHERE oc.id = cf.order_concept_id
          AND oc.tenant_id = ${tenantId}
          AND cf.metadata_key IN (${sql.join(sourceKeys, sql`, `)})
      `);
      updatedConceptFilters = Number(cfRes.rowCount ?? 0);
    }

    // 6) Arkivera källfältet (soft-delete — historiken finns kvar, ingen hard-delete).
    await tx
      .update(metadataKatalog)
      .set({
        deletedAt: new Date(),
        archivedBy: opts.mergedBy ?? null,
        archivedReason: `Sammanslagen till "${target.namn}" (importstädning)`,
      })
      .where(and(
        eq(metadataKatalog.id, sourceId),
        eq(metadataKatalog.tenantId, tenantId),
        isNull(metadataKatalog.deletedAt),
      ));

    return {
      ok: true as const,
      movedValues: Number(movedValuesRes.rowCount ?? 0),
      movedHistorik: Number(movedHistorikRes.rowCount ?? 0),
      updatedConceptFilters,
    };
  });
}

// ======
// KUNDLÅSTA METADATAFÄLT (Task #663)
// ======

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
    // Task #1441: interimnummer (temporärt importfält) döljs från katalog-/
    // fältlistor — det visas enbart i objektets systeminformationssektion.
    if (isInterimKatalogNamn(t.namn)) continue;
    const customerIds = links.get(t.id) ?? [];
    if (scope && !isMetadataAllowedForCustomerScope(customerIds, scope)) continue;
    enriched.push({ ...t, customerIds });
  }
  return enriched;
}

// Task #663: returnerar katalogen kundlås-filtrerad för ett specifikt objekt.
// Objektets kund härleds server-side via primär-payer (object_payers) så klienten
// aldrig kan vidga synligheten via egna parametrar. Resultatet = generella fält +
// fält kopplade till objektets kund eller någon av dess förfäder. Saknar objektet
// kund (eller objektet hör ej till tenant) returneras endast generella fält.
export async function getAvailableMetadataTypesForObject(
  tenantId: string,
  objectId: string,
): Promise<MetadataKatalogWithCustomers[]> {
  const [objekt] = await db
    .select({ customerId: primaryPayerCustomerIdSql() })
    .from(objects)
    .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)))
    .limit(1);
  const customerId = objekt?.customerId ?? undefined;
  return getAllMetadataTypesWithCustomers(tenantId, customerId ?? "__none__");
}

// ======
// METADATA-FAMILJER: PUNKTNOTATION (Task #662)
// ======

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

// ======
// METADATA-GRUPPER (familjer): expansion grupp-förälder → barn (Alternativ B)
// ======
// En grupp-förälder (t.ex. "Kontakt") är ETT katalogfält med ≥1 barn som pekar på
// den via parentMetadataId. När en artikels "Visa/Lämna metadata" pekar ut en
// grupp-förälder ska HELA familjen (alla barn) tas med — både för visning och för
// "lämna". Föräldern bär ALDRIG ett eget värde (icke informationsbärare); allt
// läs/skriv/obligatorium sker på barnen. Medlemskapet är DYNAMISKT: nya barn som
// läggs till i katalogen tas med automatiskt (ingen frysning vid artikel-spara).

export interface MetadataGroupIndex {
  // Lägsta-vinner-uppslag namn(lower) → katalogtyp.
  byNameLower: Map<string, MetadataKatalog>;
  // parentMetadataId → dess (aktiva) barn.
  childrenByParentId: Map<string, MetadataKatalog[]>;
}

// Bygger ett index för grupp-expansion från en lista katalogtyper (rena typer,
// vanligen getAllMetadataTypes(tenantId) som redan filtrerar bort arkiverade).
export function buildMetadataGroupIndex(types: MetadataKatalog[]): MetadataGroupIndex {
  const byNameLower = new Map<string, MetadataKatalog>();
  const childrenByParentId = new Map<string, MetadataKatalog[]>();
  for (const t of types) {
    const key = t.namn.toLowerCase();
    if (!byNameLower.has(key)) byNameLower.set(key, t);
  }
  for (const t of types) {
    if (!t.parentMetadataId) continue;
    const arr = childrenByParentId.get(t.parentMetadataId) ?? [];
    arr.push(t);
    childrenByParentId.set(t.parentMetadataId, arr);
  }
  return { byNameLower, childrenByParentId };
}

// Returnerar barnen för en grupp-förälder (matchad på namn). Tom lista om namnet
// inte finns eller saknar barn (= bladfält, ingen grupp).
export function getMetadataGroupChildren(
  parentNamn: string | null | undefined,
  index: MetadataGroupIndex,
): MetadataKatalog[] {
  if (!parentNamn) return [];
  const parent = index.byNameLower.get(parentNamn.toLowerCase());
  if (!parent) return [];
  return index.childrenByParentId.get(parent.id) ?? [];
}

// Sant om namnet är en grupp-förälder (har minst ett barn).
export function isMetadataGroupField(
  namn: string | null | undefined,
  index: MetadataGroupIndex,
): boolean {
  return getMetadataGroupChildren(namn, index).length > 0;
}

// Expanderar artikel-metadatarader (Visa/Lämna). En rad vars metadataField är en
// grupp-förälder ersätts av EN rad per barn (ärver övriga fält: canUpdate/required/
// clarification/instruction). Bladfält (inkl. okända namn) lämnas orörda. Föräldern
// släpps alltid ur resultatet → bär aldrig värde. Dedupar på resultatets
// metadataField (case-insensitivt, första vinner) så ett barn aldrig dubblas även
// om det valts både direkt och via sin grupp.
export function expandArticleMetadataRows<T extends { metadataField?: string | null }>(
  rows: T[] | null | undefined,
  index: MetadataGroupIndex,
): Array<Omit<T, "metadataField"> & { metadataField: string; groupField: string | null }> {
  const out: Array<Omit<T, "metadataField"> & { metadataField: string; groupField: string | null }> = [];
  if (!Array.isArray(rows)) return out;
  const seen = new Set<string>();
  for (const row of rows) {
    const field = row?.metadataField;
    if (!field) continue;
    const children = getMetadataGroupChildren(field, index);
    if (children.length > 0) {
      for (const child of children) {
        const key = child.namn.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...(row as object), metadataField: child.namn, groupField: field } as any);
      }
    } else {
      const key = field.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...(row as object), metadataField: field, groupField: null } as any);
    }
  }
  return out;
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

// ======
// SEED STANDARD METADATATYPER FÖR EN TENANT
// ======

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
  // Task #1054: systemfält för kundnummer. Värdet populeras via import (auto-ursprung)
  // — isSystem blockerar manuell skrivning (jfr Butiksnummer/Fakturareferens). Matchas
  // mot kundregistret (kundnummer först, kundnamn fallback) vid FROM_METADATA-härledning.
  { namn: 'Kundnummer', datatyp: 'string', arLogisk: true, standardArvs: true, kategori: 'grunduppgifter', beskrivning: 'Kundens kundnummer — matchas mot kundregistret vid kund-härledning (FROM_METADATA)', sortOrder: 2, icon: 'Hash', area: 'grunduppgifter', displayNumber: 2, isSystem: true },
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

// ======
// METADATA-OMRÅDEN (REDIGERBARA KATEGORIER) — Task #675
// ----------------------------------------------------------------------------
// Område är det enda grupperingsfältet (metadata_katalog.area). Listan är nu
// tenant-scopad data (metadata_areas). seedDefaultMetadataAreas seedar standard-
// listan (isSystem=true) idempotent och backfillar dessutom eventuella område-
// värden som redan används av katalogfält men saknar en rad (så inget i bruk
// hamnar utanför väljaren). De hårdkodade konstanterna behålls som fallback i UI.
// ======

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

// ======
// SYSTEMLÅST GEOGRAFIMODELL — kanoniska positionsfält
// ----------------------------------------------------------------------------
// Två positioner som RIKTIGA ärvda metadatafält (metadata_katalog), systemlåsta
// (systemlast=true → STRUKTUREN kan ej ändras/raderas via API, men VÄRDEN är fria;
// jfr isSystem som låser värden). isSystem=false här — adresser måste kunna redigeras.
//   1. Standardadress (ruttbar, ärvs nedåt): Gatuadress, Postnummer, Postort,
//      Koordinater (ruttbar punkt lat/lng).
//   2. Fördjupad position (valfri, ALDRIG ruttbar, ärvs + override per objekt):
//      geometri (punkt/yta/sträckning som JSON) + Avdelning/Port/Våning.
//
// Adoption-in-place: matchar befintligt fält SKIFTLÄGESOKÄNSLIGT på `namn` (den
// immutabla universella nyckeln) bland AKTIVA (deletedAt IS NULL) rader och flippar
// det till systemlåst + kanonisk area/ordning/arv — `namn` och `datatyp` rörs ALDRIG.
// Säkerhetsspärrar (aldrig tyst omtypning/dubblett/värdekorruption):
//   • datatyp-krock  → hoppas över + rapporteras.
//   • flera aktiva träffar (tvetydigt) → hoppas över + rapporteras.
//   • befintlig träff är isSystem (värdelåst) → hoppas över + rapporteras
//     (får ej bli en redigerbar positionsmodell med låsta värden).
//   • ingen aktiv träff → skapas nytt.
// Idempotent: andra körningen är no-op (alreadyOk). Rör ALDRIG metadata_varden.
// Exporteras som ENDA källan för geo-modellen (T004 sync / T005 objekthuvud läser
// `ruttbar` härifrån).
// ======

export interface SystemlastGeoFaltDef {
  key: string;          // lower(namn) — kanonisk identitet för skiftlägesokänslig matchning
  namn: string;         // föredraget namn vid nyskapande (immutabel universell nyckel)
  visningsnamn: string;
  datatyp: string;
  standardArvs: boolean;
  sortOrder: number;
  icon: string;
  beskrivning: string;
  ruttbar: boolean;     // true = del av ruttbar standardadress; false = fördjupad (ALDRIG ruttbar)
  grupp: 'standardadress' | 'fordjupad_position';
}

export const SYSTEMLASTA_GEO_FALT: SystemlastGeoFaltDef[] = [
  // --- Standardadress (ruttbar, ärvs nedåt) ---
  { key: 'gatuadress', namn: 'Gatuadress', visningsnamn: 'Gatuadress', datatyp: 'string', standardArvs: true, sortOrder: 1, icon: 'MapPin', beskrivning: 'Gatuadress för standardadressen (ruttbar, ärvs nedåt).', ruttbar: true, grupp: 'standardadress' },
  { key: 'postnummer', namn: 'Postnummer', visningsnamn: 'Postnummer', datatyp: 'string', standardArvs: true, sortOrder: 2, icon: 'Hash', beskrivning: 'Postnummer för standardadressen.', ruttbar: true, grupp: 'standardadress' },
  { key: 'postort', namn: 'Postort', visningsnamn: 'Postort', datatyp: 'string', standardArvs: true, sortOrder: 3, icon: 'Building2', beskrivning: 'Postort för standardadressen.', ruttbar: true, grupp: 'standardadress' },
  { key: 'koordinater', namn: 'Koordinater', visningsnamn: 'Koordinater', datatyp: 'location', standardArvs: true, sortOrder: 4, icon: 'Navigation', beskrivning: 'Ruttbar koordinat (lat/lng). Geokodas från adressen men kan överskridas manuellt.', ruttbar: true, grupp: 'standardadress' },
  // --- Fördjupad position (valfri, ALDRIG ruttbar, ärvs + override) ---
  { key: 'fördjupad position', namn: 'Fördjupad position', visningsnamn: 'Fördjupad position', datatyp: 'location', standardArvs: true, sortOrder: 5, icon: 'MapPinned', beskrivning: 'Valfri exakt position (punkt/yta/sträckning) — ALDRIG ruttbar. Lagras som JSON-geometri {type, coordinates}.', ruttbar: false, grupp: 'fordjupad_position' },
  { key: 'avdelning/port/våning', namn: 'Avdelning/Port/Våning', visningsnamn: 'Avdelning/Port/Våning', datatyp: 'string', standardArvs: true, sortOrder: 6, icon: 'DoorOpen', beskrivning: 'Avdelning, port och/eller våning för den fördjupade positionen.', ruttbar: false, grupp: 'fordjupad_position' },
];

export interface EnsureSystemlastGeoResult {
  created: string[];
  adopted: string[];
  alreadyOk: string[];
  conflicts: Array<{ namn: string; reason: string }>;
}

// Idempotent installation av den kanoniska systemlåsta geografimodellen för en
// tenant. Anropas från den befintliga idempotenta auto-seed-vägen (metadata GET
// /types) så partiella kataloger alltid får baslinjen utan migrering.
export async function ensureSystemlastaFalt(tenantId: string): Promise<EnsureSystemlastGeoResult> {
  const result: EnsureSystemlastGeoResult = { created: [], adopted: [], alreadyOk: [], conflicts: [] };

  // Hämta alla katalograder för tenanten en gång (aktiva + arkiverade) så vi kan
  // matcha skiftlägesokänsligt och skilja aktiva från soft-deletade.
  const rows = await db
    .select({
      id: metadataKatalog.id,
      namn: metadataKatalog.namn,
      datatyp: metadataKatalog.datatyp,
      area: metadataKatalog.area,
      sortOrder: metadataKatalog.sortOrder,
      standardArvs: metadataKatalog.standardArvs,
      systemlast: metadataKatalog.systemlast,
      isSystem: metadataKatalog.isSystem,
      visningsnamn: metadataKatalog.visningsnamn,
      deletedAt: metadataKatalog.deletedAt,
    })
    .from(metadataKatalog)
    .where(eq(metadataKatalog.tenantId, tenantId));

  for (const def of SYSTEMLASTA_GEO_FALT) {
    const activeMatches = rows.filter(
      (r) => r.deletedAt === null && r.namn.toLowerCase() === def.key,
    );

    if (activeMatches.length === 0) {
      // Skapa nytt kanoniskt systemlåst fält (STRUKTUR låst, VÄRDEN fria).
      await db.insert(metadataKatalog).values({
        tenantId,
        namn: def.namn,
        visningsnamn: def.visningsnamn,
        datatyp: def.datatyp,
        arLogisk: true,
        standardArvs: def.standardArvs,
        kategori: 'geografi',
        area: 'geografi',
        beskrivning: def.beskrivning,
        sortOrder: def.sortOrder,
        icon: def.icon,
        isSystem: false,
        systemlast: true,
      });
      result.created.push(def.namn);
      continue;
    }

    if (activeMatches.length > 1) {
      result.conflicts.push({
        namn: def.namn,
        reason: `Flera aktiva fält matchar "${def.key}" (${activeMatches.length} st) — tvetydigt, hoppar över adoption.`,
      });
      continue;
    }

    const existing = activeMatches[0];

    // isSystem-fält låser VÄRDEN → får inte bli en redigerbar positionsmodell.
    if (existing.isSystem) {
      result.conflicts.push({
        namn: existing.namn,
        reason: `Fältet är isSystem (värdelåst) — adopteras ej till redigerbar positionsmodell.`,
      });
      continue;
    }

    // Datatyp-krock: adoptera aldrig ett fält med annan datatyp (skulle korrumpera
    // befintliga värden).
    if ((existing.datatyp ?? '').toLowerCase() !== def.datatyp.toLowerCase()) {
      result.conflicts.push({
        namn: existing.namn,
        reason: `Datatyp "${existing.datatyp}" ≠ kanonisk "${def.datatyp}" — hoppar över (byter aldrig datatyp på fält i bruk).`,
      });
      continue;
    }

    // Redan kanoniskt? (idempotens)
    const alreadyOk =
      existing.systemlast === true &&
      existing.area === 'geografi' &&
      existing.sortOrder === def.sortOrder &&
      existing.standardArvs === def.standardArvs &&
      (existing.visningsnamn ?? '').length > 0;
    if (alreadyOk) {
      result.alreadyOk.push(existing.namn);
      continue;
    }

    // Adoptera in-place: flippa systemlast + kanonisk area/ordning/arv. `namn` och
    // `datatyp` rörs ALDRIG. Behåll befintligt visningsnamn om satt, annars kanoniskt.
    await db
      .update(metadataKatalog)
      .set({
        systemlast: true,
        area: 'geografi',
        kategori: 'geografi',
        sortOrder: def.sortOrder,
        standardArvs: def.standardArvs,
        visningsnamn:
          (existing.visningsnamn ?? '').length > 0 ? existing.visningsnamn : def.visningsnamn,
      })
      .where(and(eq(metadataKatalog.id, existing.id), eq(metadataKatalog.tenantId, tenantId)));
    result.adopted.push(existing.namn);
  }

  return result;
}

// ======
// Task #1214 (Etapp 2): SYSTEMOMRÅDEN — systemdefinierade metadataområden
// ----------------------------------------------------------------------------
// Generalisering av Geografi-systemlast-mönstret till fler områden: Ekonomi,
// Kontakt, Åtkomst, Tid, Individ, Kärl och Bild. Samma semantik som
// ensureSystemlastaFalt (adopt-or-create, skiftlägesokänslig namn-matchning
// bland AKTIVA rader, systemlast=true låser STRUKTUR men aldrig VÄRDEN), plus:
//   • referensTabell — referensfält (Kund→customers, Artikelkoppling→articles);
//     sätts vid nyskapande och fylls på vid adoption om den saknas.
//   • allowDuplicates — flervärdesfält (kontaktpersonens underfält, Bilder);
//     flippas till true vid adoption (aldrig true→false).
//   • parentKey — familje-barn (Kontaktperson-rubriken + Namn/Titel/Telefon/
//     E-post); barnets parentMetadataId sätts till den kanoniska rubrik-raden.
//     Pekar barnet redan på en ANNAN förälder → konflikt (hoppar över).
//   • adoptIsSystem — Kundnummer/Fakturareferens finns som isSystem (värdelåsta,
//     auto-ifyllda vid import) i standardkatalogen; de adopteras in i Ekonomi-
//     området UTAN att isSystem röras (värdelåset behålls som det är).
// Rör ALDRIG namn/datatyp/metadata_varden. Idempotent (andra körningen no-op).
// ======

export interface SystemomradeFaltDef {
  key: string;            // lower(namn) — kanonisk identitet för matchning
  namn: string;           // föredraget namn vid nyskapande (immutabel universell nyckel)
  visningsnamn: string;
  datatyp: string;
  standardArvs: boolean;
  sortOrder: number;
  icon: string;
  beskrivning: string;
  area: string;           // metadataområde (grupperingsnyckel)
  referensTabell?: string;   // endast för datatyp 'referens'
  allowDuplicates?: boolean; // flervärdesfält
  parentKey?: string;        // key till rubrik-förälder i samma lista (familje-barn)
  adoptIsSystem?: boolean;   // tillåt adoption av isSystem-rad (isSystem behålls orörd)
  arLogisk?: boolean;        // default true (bild-/filfält: false, som Vinjetbild)
}

export const SYSTEMOMRADEN_FALT: SystemomradeFaltDef[] = [
  // --- Ekonomi ---
  // OBS: standardArvs MÅSTE vara false för Kund — ett objekt får ALDRIG ärva kund
  // automatiskt från förälderobjekt (olika aktörer kan beställa på samma objekt).
  // Kund sätts manuellt eller via orderkoncept. Se migration 0148 (backfill).
  { key: 'kund', namn: 'Kund', visningsnamn: 'Kund', datatyp: 'referens', referensTabell: 'customers', standardArvs: false, sortOrder: 1, icon: 'Building2', beskrivning: 'Kund kopplad till objektet (referens till kundregistret).', area: 'ekonomi' },
  { key: 'kundnummer', namn: 'Kundnummer', visningsnamn: 'Kundnummer', datatyp: 'string', standardArvs: true, sortOrder: 2, icon: 'Hash', beskrivning: 'Kundnummer för matchning mot kundregistret.', area: 'ekonomi', adoptIsSystem: true },
  { key: 'betalare', namn: 'Betalare', visningsnamn: 'Betalare', datatyp: 'string', standardArvs: true, sortOrder: 3, icon: 'Wallet', beskrivning: 'Betalare (om annan än kunden).', area: 'ekonomi' },
  { key: 'betalarnummer', namn: 'Betalarnummer', visningsnamn: 'Betalarnummer', datatyp: 'string', standardArvs: true, sortOrder: 4, icon: 'Hash', beskrivning: 'Betalarens kundnummer.', area: 'ekonomi' },
  { key: 'fakturareferens', namn: 'Fakturareferens', visningsnamn: 'Fakturareferens', datatyp: 'string', standardArvs: true, sortOrder: 5, icon: 'FileText', beskrivning: 'Referens som anges på fakturan.', area: 'ekonomi', adoptIsSystem: true },
  { key: 'kostnadsställe', namn: 'Kostnadsställe', visningsnamn: 'Kostnadsställe', datatyp: 'string', standardArvs: true, sortOrder: 6, icon: 'Landmark', beskrivning: 'Kostnadsställe för fakturering/bokföring.', area: 'ekonomi' },
  { key: 'projekt', namn: 'Projekt', visningsnamn: 'Projekt', datatyp: 'string', standardArvs: true, sortOrder: 7, icon: 'FolderKanban', beskrivning: 'Projekt för fakturering/bokföring.', area: 'ekonomi' },
  // --- Kontakt (flervärdes-familj: rubrik + underfält) ---
  { key: 'kontaktperson', namn: 'Kontaktperson', visningsnamn: 'Kontaktperson', datatyp: 'rubrik', standardArvs: true, sortOrder: 1, icon: 'Users', beskrivning: 'Kontaktperson för objektet (grupperar Namn/Titel/Telefon/E-post).', area: 'kontakt' },
  { key: 'namn', namn: 'Namn', visningsnamn: 'Namn', datatyp: 'string', standardArvs: true, sortOrder: 2, icon: 'Type', beskrivning: 'Kontaktpersonens namn.', area: 'kontakt', parentKey: 'kontaktperson', allowDuplicates: true },
  { key: 'titel', namn: 'Titel', visningsnamn: 'Titel', datatyp: 'string', standardArvs: true, sortOrder: 3, icon: 'BadgeCheck', beskrivning: 'Kontaktpersonens titel/roll.', area: 'kontakt', parentKey: 'kontaktperson', allowDuplicates: true },
  { key: 'telefon', namn: 'Telefon', visningsnamn: 'Telefon', datatyp: 'string', standardArvs: true, sortOrder: 4, icon: 'Phone', beskrivning: 'Kontaktpersonens telefonnummer.', area: 'kontakt', parentKey: 'kontaktperson', allowDuplicates: true },
  { key: 'e-post', namn: 'E-post', visningsnamn: 'E-post', datatyp: 'string', standardArvs: true, sortOrder: 5, icon: 'Mail', beskrivning: 'Kontaktpersonens e-postadress.', area: 'kontakt', parentKey: 'kontaktperson', allowDuplicates: true },
  // --- Åtkomst ---
  { key: 'åtkomsttyp', namn: 'Åtkomsttyp', visningsnamn: 'Åtkomsttyp', datatyp: 'string', standardArvs: true, sortOrder: 1, icon: 'KeyRound', beskrivning: 'Typ av åtkomst (t.ex. nyckel, tagg, kod, port).', area: 'atkomst' },
  { key: 'åtkomstkod', namn: 'Åtkomstkod', visningsnamn: 'Åtkomstkod', datatyp: 'string', standardArvs: true, sortOrder: 2, icon: 'Key', beskrivning: 'Kod för åtkomst till objektet/området.', area: 'atkomst' },
  { key: 'nyckelnummer', namn: 'Nyckelnummer', visningsnamn: 'Nyckelnummer', datatyp: 'string', standardArvs: true, sortOrder: 3, icon: 'Hash', beskrivning: 'Nyckelnummer/nyckel-id.', area: 'atkomst' },
  { key: 'åtkomstinfo', namn: 'Åtkomstinfo', visningsnamn: 'Åtkomstinfo', datatyp: 'string', standardArvs: true, sortOrder: 4, icon: 'Info', beskrivning: 'Fri åtkomstinformation (instruktioner, kontaktväg m.m.).', area: 'atkomst' },
  // --- Tid ---
  { key: 'tidsfönster', namn: 'Tidsfönster', visningsnamn: 'Tidsfönster', datatyp: 'json', standardArvs: true, sortOrder: 1, icon: 'Clock', beskrivning: 'Tillåtna tidsfönster för utförande (JSON).', area: 'tid' },
  { key: 'tidsrestriktioner', namn: 'Tidsrestriktioner', visningsnamn: 'Tidsrestriktioner', datatyp: 'json', standardArvs: true, sortOrder: 2, icon: 'CalendarClock', beskrivning: 'Tidsrestriktioner/begränsningar för utförande (JSON).', area: 'tid' },
  // --- Individ (individspecifikt — ärvs inte) ---
  { key: 'serienummer', namn: 'Serienummer', visningsnamn: 'Serienummer', datatyp: 'string', standardArvs: false, sortOrder: 1, icon: 'Barcode', beskrivning: 'Individens serienummer.', area: 'individ' },
  { key: 'tillverkare', namn: 'Tillverkare', visningsnamn: 'Tillverkare', datatyp: 'string', standardArvs: false, sortOrder: 2, icon: 'Factory', beskrivning: 'Tillverkare/fabrikat.', area: 'individ' },
  { key: 'inköpsdatum', namn: 'Inköpsdatum', visningsnamn: 'Inköpsdatum', datatyp: 'datetime', standardArvs: false, sortOrder: 3, icon: 'Calendar', beskrivning: 'Datum då individen köptes in.', area: 'individ' },
  { key: 'garanti', namn: 'Garanti', visningsnamn: 'Garanti', datatyp: 'datetime', standardArvs: false, sortOrder: 4, icon: 'ShieldCheck', beskrivning: 'Garanti giltig t.o.m.', area: 'individ' },
  { key: 'besiktning', namn: 'Besiktning', visningsnamn: 'Besiktning', datatyp: 'datetime', standardArvs: false, sortOrder: 5, icon: 'ClipboardCheck', beskrivning: 'Senaste/nästa besiktningsdatum.', area: 'individ' },
  { key: 'skick', namn: 'Skick', visningsnamn: 'Skick', datatyp: 'string', standardArvs: false, sortOrder: 6, icon: 'Activity', beskrivning: 'Individens skick/kondition.', area: 'individ' },
  { key: 'artikelkoppling', namn: 'Artikelkoppling', visningsnamn: 'Artikelkoppling', datatyp: 'referens', referensTabell: 'articles', standardArvs: false, sortOrder: 7, icon: 'Package', beskrivning: 'Koppling till artikel i artikelregistret.', area: 'individ' },
  // --- Kärl / Kapacitet ---
  { key: 'antal kärl', namn: 'Antal kärl', visningsnamn: 'Antal kärl', datatyp: 'integer', standardArvs: false, sortOrder: 1, icon: 'Container', beskrivning: 'Antal kärl på platsen.', area: 'kärl' },
  { key: 'serviceperioder', namn: 'Serviceperioder', visningsnamn: 'Serviceperioder', datatyp: 'string', standardArvs: true, sortOrder: 2, icon: 'CalendarRange', beskrivning: 'Serviceperioder (t.ex. vecka/månad/säsong).', area: 'kärl' },
  { key: 'ställtid', namn: 'Ställtid', visningsnamn: 'Ställtid', datatyp: 'integer', standardArvs: true, sortOrder: 3, icon: 'Timer', beskrivning: 'Ställtid i minuter.', area: 'kärl' },
  // --- Klassificering (Task #1484: objekttyp/nivå blir metadata, kolumner = cache) ---
  // standardArvs=false: varje objekt har sin EGEN typ/nivå — ett rum får aldrig
  // ärva "fastighet" från sin förälder. Fri sträng under expand-fasen (paritet
  // med dagens kolumnvärden); allowed_values kan stramas åt i contract-fasen.
  { key: 'objekttyp', namn: 'Objekttyp', visningsnamn: 'Objekttyp', datatyp: 'string', standardArvs: false, sortOrder: 1, icon: 'Shapes', beskrivning: 'Objektets typ (t.ex. fastighet, omrade, utrustning). Källa för artikel-fasthakning; objektkolumnen är en cache.', area: 'klassificering' },
  { key: 'anläggningstyp', namn: 'Anläggningstyp', visningsnamn: 'Anläggningstyp', datatyp: 'string', standardArvs: false, sortOrder: 2, icon: 'Layers', beskrivning: 'Objektets nivå/anläggningstyp (t.ex. koncern, brf, fastighet, rum, karl). Källa för nivåbaserad artikel-fasthakning; objektkolumnen hierarchyLevel är en cache.', area: 'klassificering' },
  // --- Bild ---
  { key: 'bilder', namn: 'Bilder', visningsnamn: 'Bilder', datatyp: 'image', standardArvs: false, sortOrder: 1, icon: 'Image', beskrivning: 'Bilder kopplade till objektet (flera tillåtna).', area: 'bild', allowDuplicates: true, arLogisk: false },
  { key: 'vinjetbild', namn: 'Vinjetbild', visningsnamn: 'Vinjettbild', datatyp: 'image', standardArvs: false, sortOrder: 2, icon: 'ImagePlus', beskrivning: 'Utpekad vinjettbild för objektet.', area: 'bild', arLogisk: false },
];

export interface EnsureSystemomradenResult {
  created: string[];
  adopted: string[];
  alreadyOk: string[];
  conflicts: Array<{ namn: string; reason: string }>;
}

export async function ensureSystemomradenFalt(tenantId: string): Promise<EnsureSystemomradenResult> {
  const result: EnsureSystemomradenResult = { created: [], adopted: [], alreadyOk: [], conflicts: [] };

  const rows = await db
    .select({
      id: metadataKatalog.id,
      namn: metadataKatalog.namn,
      datatyp: metadataKatalog.datatyp,
      area: metadataKatalog.area,
      sortOrder: metadataKatalog.sortOrder,
      standardArvs: metadataKatalog.standardArvs,
      systemlast: metadataKatalog.systemlast,
      isSystem: metadataKatalog.isSystem,
      visningsnamn: metadataKatalog.visningsnamn,
      referensTabell: metadataKatalog.referensTabell,
      allowDuplicates: metadataKatalog.allowDuplicates,
      parentMetadataId: metadataKatalog.parentMetadataId,
      deletedAt: metadataKatalog.deletedAt,
    })
    .from(metadataKatalog)
    .where(eq(metadataKatalog.tenantId, tenantId));

  // Kanoniskt katalog-id per def-key (fylls på under körningen: rubrik-föräldrar
  // ligger före sina barn i listan så barnens parentMetadataId kan resolvas).
  const idByKey = new Map<string, string>();

  for (const def of SYSTEMOMRADEN_FALT) {
    const activeMatches = rows.filter(
      (r) => r.deletedAt === null && r.namn.toLowerCase() === def.key,
    );

    // Resolva kanonisk förälder för familje-barn. Saknas föräldern (konflikt på
    // rubrik-raden) hoppas barnet över så vi aldrig skapar föräldralösa barn.
    let parentId: string | null = null;
    if (def.parentKey) {
      parentId = idByKey.get(def.parentKey) ?? null;
      if (!parentId) {
        result.conflicts.push({
          namn: def.namn,
          reason: `Familje-föräldern "${def.parentKey}" kunde inte etableras — hoppar över barnfältet.`,
        });
        continue;
      }
    }

    if (activeMatches.length === 0) {
      const [inserted] = await db
        .insert(metadataKatalog)
        .values({
          tenantId,
          namn: def.namn,
          visningsnamn: def.visningsnamn,
          datatyp: def.datatyp,
          arLogisk: def.arLogisk ?? true,
          standardArvs: def.standardArvs,
          kategori: def.area,
          area: def.area,
          beskrivning: def.beskrivning,
          sortOrder: def.sortOrder,
          icon: def.icon,
          isSystem: false,
          systemlast: true,
          referensTabell: def.referensTabell ?? null,
          allowDuplicates: def.allowDuplicates ?? false,
          parentMetadataId: parentId,
        })
        .returning({ id: metadataKatalog.id });
      idByKey.set(def.key, inserted.id);
      result.created.push(def.namn);
      continue;
    }

    if (activeMatches.length > 1) {
      result.conflicts.push({
        namn: def.namn,
        reason: `Flera aktiva fält matchar "${def.key}" (${activeMatches.length} st) — tvetydigt, hoppar över adoption.`,
      });
      continue;
    }

    const existing = activeMatches[0];

    // isSystem-fält är värdelåsta — adopteras bara när def:en explicit tillåter
    // det (Kundnummer/Fakturareferens behåller sitt värdelås orört).
    if (existing.isSystem && !def.adoptIsSystem) {
      result.conflicts.push({
        namn: existing.namn,
        reason: `Fältet är isSystem (värdelåst) — adopteras ej.`,
      });
      continue;
    }

    if ((existing.datatyp ?? '').toLowerCase() !== def.datatyp.toLowerCase()) {
      result.conflicts.push({
        namn: existing.namn,
        reason: `Datatyp "${existing.datatyp}" ≠ kanonisk "${def.datatyp}" — hoppar över (byter aldrig datatyp på fält i bruk).`,
      });
      continue;
    }

    // Barn som redan pekar på en ANNAN förälder omföräldras aldrig tyst.
    if (def.parentKey && existing.parentMetadataId && existing.parentMetadataId !== parentId) {
      result.conflicts.push({
        namn: existing.namn,
        reason: `Fältet tillhör redan en annan familj — omföräldras ej.`,
      });
      continue;
    }

    idByKey.set(def.key, existing.id);

    const wantReferensTabell = def.referensTabell ?? null;
    const needsReferensTabell =
      wantReferensTabell !== null && (existing.referensTabell ?? null) === null;
    const needsAllowDuplicates = def.allowDuplicates === true && existing.allowDuplicates !== true;
    const needsParent = def.parentKey ? existing.parentMetadataId !== parentId : false;

    const alreadyOk =
      existing.systemlast === true &&
      existing.area === def.area &&
      existing.sortOrder === def.sortOrder &&
      existing.standardArvs === def.standardArvs &&
      (existing.visningsnamn ?? '').length > 0 &&
      !needsReferensTabell &&
      !needsAllowDuplicates &&
      !needsParent;
    if (alreadyOk) {
      result.alreadyOk.push(existing.namn);
      continue;
    }

    await db
      .update(metadataKatalog)
      .set({
        systemlast: true,
        area: def.area,
        kategori: def.area,
        sortOrder: def.sortOrder,
        standardArvs: def.standardArvs,
        visningsnamn:
          (existing.visningsnamn ?? '').length > 0 ? existing.visningsnamn : def.visningsnamn,
        ...(needsReferensTabell ? { referensTabell: wantReferensTabell } : {}),
        ...(needsAllowDuplicates ? { allowDuplicates: true } : {}),
        ...(needsParent ? { parentMetadataId: parentId } : {}),
      })
      .where(and(eq(metadataKatalog.id, existing.id), eq(metadataKatalog.tenantId, tenantId)));
    result.adopted.push(existing.namn);
  }

  return result;
}

// ======
// T005: LÄS OBJEKTETS GEO-FÄLT (arvs-medvetet) FÖR OBJEKTHUVUD / SYSTEM-METADATA
// ----------------------------------------------------------------------------
// Exponerar den kanoniska systemlåsta geografimodellen som TVÅ grupper —
// standardadress (ruttbar) och fördjupad position (ALDRIG ruttbar) — läst
// ARVS-MEDVETET ur metadata-katalogen (samma källa som object-location-cachen,
// närmast-vinner). Varje fält bär KÄLLA/ARV (eget/ärvt/saknas) + ownRowId så
// objekthuvud-UI:t (T006) kan visa arv-badges och redigera via metadata.
//
// VIKTIGT: getMetadataValue:s datatyp-switch saknar 'location'-fall → returnerar
// null för Koordinater/Fördjupad position. Här läses vardeJson DIREKT i stället.
// ======

export type GeoFieldSource = 'own' | 'inherited' | 'missing';

export interface SystemGeoField {
  key: string;
  katalogId: string | null; // null = fältet är inte seedat i denna tenant
  namn: string;
  visningsnamn: string;
  datatyp: string; // 'string' | 'location'
  ruttbar: boolean;
  grupp: 'standardadress' | 'fordjupad_position';
  value: string | null; // display-text för sträng-fält
  json: unknown | null; // location-json {lat,lng} eller {type,coordinates}
  point: { lat: number; lng: number } | null; // normaliserad punkt (location-fält); null för polygon/sträckning
  source: GeoFieldSource;
  fromObject: { id: string; namn: string } | null;
  metod: string | null;
  ownRowId: string | null; // egen aktiv rad (endast source='own') — för PATCH i T006
}

export interface ObjectGeoFields {
  standardAddress: {
    gatuadress: SystemGeoField;
    postnummer: SystemGeoField;
    postort: SystemGeoField;
    koordinater: SystemGeoField;
  };
  advancedPosition: {
    fordjupadPosition: SystemGeoField;
    avdelningPortVaning: SystemGeoField;
  };
}

const SYSTEMLASTA_GEO_KEYS = new Set(SYSTEMLASTA_GEO_FALT.map((d) => d.key));

export async function getObjectGeoFields(
  objektId: string,
  tenantId: string,
  preloaded?: Awaited<ReturnType<typeof getObjectWithAllMetadata>>,
): Promise<ObjectGeoFields> {
  // 1) Katalog-id per geo-namn (aktiva, skiftlägesokänsligt). Ger katalogId ÄVEN
  //    när objektet saknar värde, så T006 kan skapa ett första värde.
  const katalogRows = await db
    .select({
      id: metadataKatalog.id,
      namn: metadataKatalog.namn,
      visningsnamn: metadataKatalog.visningsnamn,
      datatyp: metadataKatalog.datatyp,
    })
    .from(metadataKatalog)
    .where(and(eq(metadataKatalog.tenantId, tenantId), isNull(metadataKatalog.deletedAt)));
  const katByKey = new Map<
    string,
    { id: string; visningsnamn: string | null; datatyp: string | null }
  >();
  for (const r of katalogRows) {
    const k = (r.namn ?? '').toLowerCase();
    if (SYSTEMLASTA_GEO_KEYS.has(k) && !katByKey.has(k)) {
      katByKey.set(k, {
        id: r.id,
        visningsnamn: r.visningsnamn ?? null,
        datatyp: r.datatyp ?? null,
      });
    }
  }

  // 2) Arvs-medvetna värden ur EAV (närmast-vinner). Återanvänder ev. redan hämtad
  //    ObjectWithAllMetadata för att undvika en extra recursive-CTE.
  const owm = preloaded ?? (await getObjectWithAllMetadata(objektId, tenantId));
  const entryByKey = new Map<string, MetadataVardenWithKatalog>();
  if (owm) {
    for (const m of owm.metadata) {
      const k = (m.katalog?.namn ?? '').toLowerCase();
      if (SYSTEMLASTA_GEO_KEYS.has(k) && !entryByKey.has(k)) entryByKey.set(k, m);
    }
  }

  const build = (def: SystemlastGeoFaltDef): SystemGeoField => {
    const kat = katByKey.get(def.key) ?? null;
    const entry = entryByKey.get(def.key);
    let value: string | null = null;
    let json: unknown | null = null;
    let point: { lat: number; lng: number } | null = null;
    let source: GeoFieldSource = 'missing';
    let fromObject: { id: string; namn: string } | null = null;
    let metod: string | null = null;
    let ownRowId: string | null = null;

    if (entry) {
      const isLocal = entry.source === 'local';
      const isTombstone = isLocal && entry.raderad === true;
      if (isTombstone) {
        // Eget värde borttaget (tombstone stryker ev. ärvt) → inget effektivt värde.
        source = 'missing';
      } else {
        source = isLocal ? 'own' : 'inherited';
        metod = entry.metod ?? null;
        if (def.datatyp === 'location') {
          json = entry.vardeJson ?? null;
          // Normaliserad punkt via delad parser (single source). null för
          // polygon/sträckning (nästlad coordinates) → objekthuvudet ritar då
          // ingen P2-markör, bara descriptorn.
          point = parseCoordinateJson(json);
        } else {
          value = entry.vardeString ?? null;
        }
        if (source === 'inherited' && entry.fromObject) {
          fromObject = { id: entry.fromObject.id, namn: entry.fromObject.namn };
        }
        if (source === 'own') ownRowId = entry.id ?? null;
      }
    }

    return {
      key: def.key,
      katalogId: kat?.id ?? entry?.metadataKatalogId ?? null,
      namn: def.namn,
      visningsnamn:
        kat?.visningsnamn && kat.visningsnamn.length > 0 ? kat.visningsnamn : def.visningsnamn,
      datatyp: def.datatyp,
      ruttbar: def.ruttbar,
      grupp: def.grupp,
      value,
      json,
      point,
      source,
      fromObject,
      metod,
      ownRowId,
    };
  };

  const byKeyDef = (key: string): SystemGeoField =>
    build(SYSTEMLASTA_GEO_FALT.find((d) => d.key === key)!);

  return {
    standardAddress: {
      gatuadress: byKeyDef('gatuadress'),
      postnummer: byKeyDef('postnummer'),
      postort: byKeyDef('postort'),
      koordinater: byKeyDef('koordinater'),
    },
    advancedPosition: {
      fordjupadPosition: byKeyDef('fördjupad position'),
      avdelningPortVaning: byKeyDef('avdelning/port/våning'),
    },
  };
}

// ======
// ÅTKOMST-METADATA (Etapp 5) — ersätter objects.access*/key_number-kolumnerna.
// Arvs-medveten läsning (närmast-vinner) av systemområdet "Åtkomst":
// Åtkomsttyp / Åtkomstkod / Nyckelnummer / Åtkomstinfo. Delar
// getObjectWithAllMetadata-resolutionen (tombstones/multi-förälder hanteras där).
// ======

export interface ObjectAtkomstFields {
  typ: string | null;
  portkod: string | null;
  nyckelnummer: string | null;
  info: string | null;
}

const ATKOMST_KEYS = {
  typ: 'åtkomsttyp',
  portkod: 'åtkomstkod',
  nyckelnummer: 'nyckelnummer',
  info: 'åtkomstinfo',
} as const;

// Arvs-medveten läsning av ETT katalogfält (per namn) för flera objekt.
// Returnerar { objektId: visningsvärde } — objekt utan värde utelämnas.
export async function getObjectsMetadataValueByKatalogNamn(
  tenantId: string,
  objectIds: string[],
  katalogNamn: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (objectIds.length === 0) return out;
  const res = await db.execute(sql`
    SELECT id FROM metadata_katalog
    WHERE tenant_id = ${tenantId} AND LOWER(namn) = LOWER(${katalogNamn}) AND deleted_at IS NULL
    LIMIT 1
  `);
  const row = (res.rows as any[])[0];
  if (!row) return out;
  const katalogId = String(row.id);
  const values = await getObjectsMetadataValuesForCatalog(tenantId, objectIds, [katalogId]);
  for (const objectId of Object.keys(values)) {
    const v = values[objectId]?.[katalogId];
    if (v !== undefined && v !== null && String(v).trim().length > 0) out[objectId] = String(v);
  }
  return out;
}

export async function getObjectAtkomstFields(
  objektId: string,
  tenantId: string,
  preloaded?: Awaited<ReturnType<typeof getObjectWithAllMetadata>>,
): Promise<ObjectAtkomstFields> {
  const owm = preloaded ?? (await getObjectWithAllMetadata(objektId, tenantId));
  const result: ObjectAtkomstFields = { typ: null, portkod: null, nyckelnummer: null, info: null };
  if (!owm) return result;
  const byKey = new Map<string, MetadataVardenWithKatalog>();
  const wanted = new Set<string>(Object.values(ATKOMST_KEYS));
  for (const m of owm.metadata) {
    const k = (m.katalog?.namn ?? '').toLowerCase();
    if (wanted.has(k) && !byKey.has(k)) byKey.set(k, m);
  }
  const readString = (key: string): string | null => {
    const entry = byKey.get(key);
    if (!entry) return null;
    if (entry.source === 'local' && entry.raderad === true) return null;
    const v = entry.vardeString ?? null;
    return v && v.trim().length > 0 ? v : null;
  };
  result.typ = readString(ATKOMST_KEYS.typ);
  result.portkod = readString(ATKOMST_KEYS.portkod);
  result.nyckelnummer = readString(ATKOMST_KEYS.nyckelnummer);
  result.info = readString(ATKOMST_KEYS.info);
  return result;
}

export interface ObjectKontaktSubfield {
  vardenId: string | null;
  katalogNamn: string | null;
  /** Katalog-id — behövs för arkivering (DELETE /objects/:oid/field/:kid)
   *  när ett underfält töms i kontaktkortet (hård delete används aldrig där). */
  katalogId: string | null;
  inherited: boolean;
  fromObjectName: string | null;
}
export interface ObjectKontaktPerson {
  namn: string | null;
  titel: string | null;
  telefon: string | null;
  epost: string | null;
  fields: {
    namn: ObjectKontaktSubfield;
    titel: ObjectKontaktSubfield;
    telefon: ObjectKontaktSubfield;
    epost: ObjectKontaktSubfield;
  };
  inherited: boolean;
  inheritedFromObjectName: string | null;
  createdAt: string | null;
  /** Task #1459: explicit grupp-nyckel som binder ihop personens underfält.
   *  NULL = legacy-kontakt (index-parad) — kompletteringar är då inte rad-säkra. */
  gruppNyckel: string | null;
}

const KONTAKT_SUBFIELD_KEYS = ['namn', 'titel', 'telefon', 'e-post'] as const;

/**
 * Kontaktpersoner för ett objekt (egna + ärvda). Underfälten (Namn/Titel/
 * Telefon/E-post) är parallella flervärdesrader — personer paras ihop i
 * skapandeordning (created_at, sedan id). Rader vars alla fält är tomma
 * filtreras bort.
 */
export async function getObjectKontaktPersons(
  objektId: string,
  tenantId: string,
): Promise<ObjectKontaktPerson[]> {
  const owm = await getObjectWithAllMetadata(objektId, tenantId);
  if (!owm) return [];

  type KontaktCell = {
    value: string;
    vardenId: string | null;
    inherited: boolean;
    fromObjectName: string | null;
    createdAt: string | null;
    // Task #1459: explicit grupp-nyckel — rader med samma nyckel hör till samma
    // person. NULL = legacy-rad som paras per index (kronologisk fallback).
    gruppNyckel: string | null;
  };
  const valuesByKey = new Map<string, KontaktCell[]>();
  const katalogNamnByKey = new Map<string, string>();
  for (const key of KONTAKT_SUBFIELD_KEYS) valuesByKey.set(key, []);

  // Katalognamn per underfält hämtas från katalogen (inte bara från värdena) så
  // att kortet kan skapa ett SAKNAT underfält (POST med metadataTypNamn).
  const katalogIdByKey = new Map<string, string>();
  const kontaktKatalogRows = await db
    .select({ id: metadataKatalog.id, namn: metadataKatalog.namn })
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.tenantId, tenantId),
      isNull(metadataKatalog.deletedAt),
      eq(metadataKatalog.area, 'kontakt'),
    ));
  for (const k of kontaktKatalogRows) {
    const key = (k.namn ?? '').toLowerCase();
    if (valuesByKey.has(key) && k.namn) {
      katalogNamnByKey.set(key, k.namn);
      katalogIdByKey.set(key, k.id);
    }
  }

  for (const m of owm.metadata) {
    const k = (m.katalog?.namn ?? '').toLowerCase();
    if (!valuesByKey.has(k)) continue;
    // Endast Kontakt-områdets fält (skydd mot namnkrock med andra områden).
    if ((m.katalog?.area ?? '') !== 'kontakt') continue;
    if (m.katalog?.namn) katalogNamnByKey.set(k, m.katalog.namn);
    const list = valuesByKey.get(k)!;
    const entryCreatedAt = (m as any).createdAt ? String((m as any).createdAt) : null;
    if (m.instances && m.instances.length > 0) {
      // Kontaktparning per index: sortera KRONOLOGISKT (created_at, sedan id) så
      // att underfälten paras i skapandeordning — lexikal id-sortering kan para
      // titel/telefon med fel kontakt.
      const sorted = [...m.instances].sort((a, b) => {
        const ta = (a as any).createdAt ? new Date(String((a as any).createdAt)).getTime() : 0;
        const tb = (b as any).createdAt ? new Date(String((b as any).createdAt)).getTime() : 0;
        if (ta !== tb) return ta - tb;
        return String(a.id).localeCompare(String(b.id));
      });
      for (const inst of sorted) {
        const v = (inst.displayValue ?? '').trim();
        list.push({
          value: v,
          vardenId: inst.source === 'local' ? inst.id : null,
          inherited: inst.source === 'inherited',
          fromObjectName: inst.source === 'inherited' ? (inst.fromObjectName ?? null) : null,
          createdAt: (inst as any).createdAt ? String((inst as any).createdAt) : null,
          gruppNyckel: (inst as any).gruppNyckel ?? null,
        });
      }
    } else if (!(m.source === 'local' && m.raderad === true)) {
      const v = (m.vardeString ?? '').trim();
      if (v) {
        const inherited = m.source === 'inherited';
        list.push({
          value: v,
          vardenId: inherited ? null : m.id,
          inherited,
          fromObjectName: inherited ? ((m as any).fromObjectName ?? (m as any).fromObject?.namn ?? null) : null,
          createdAt: entryCreatedAt,
          gruppNyckel: (m as any).gruppNyckel ?? null,
        });
      }
    }
  }

  const subfield = (key: string, cell: KontaktCell | undefined): ObjectKontaktSubfield => ({
    vardenId: cell?.vardenId ?? null,
    katalogNamn: katalogNamnByKey.get(key) ?? null,
    katalogId: katalogIdByKey.get(key) ?? null,
    inherited: cell?.inherited ?? false,
    fromObjectName: cell?.fromObjectName ?? null,
  });

  // Task #1459: explicit grupp-nyckel är primär parning — alla rader med samma
  // nyckel hör till samma person, oavsett skapandeordning. Rader UTAN nyckel
  // (legacy, före backfill) paras per index precis som förr, som egna personer
  // efter de nyckel-grupperade.
  type CellQuad = {
    namn?: KontaktCell;
    titel?: KontaktCell;
    telefon?: KontaktCell;
    epost?: KontaktCell;
  };
  const KEY_TO_PROP: Record<string, keyof CellQuad> = {
    namn: 'namn',
    titel: 'titel',
    telefon: 'telefon',
    'e-post': 'epost',
  };
  const grouped = new Map<string, CellQuad>(); // gruppNyckel → cells (insättningsordning = första förekomst)
  const legacyByKey = new Map<string, KontaktCell[]>();
  for (const key of KONTAKT_SUBFIELD_KEYS) legacyByKey.set(key, []);
  for (const key of KONTAKT_SUBFIELD_KEYS) {
    const prop = KEY_TO_PROP[key];
    for (const cell of valuesByKey.get(key)!) {
      if (cell.gruppNyckel) {
        const quad = grouped.get(cell.gruppNyckel) ?? {};
        // Första värdet per underfält vinner (dubblett inom samma grupp = data-
        // anomali; visa deterministiskt den kronologiskt första).
        if (!quad[prop]) quad[prop] = cell;
        grouped.set(cell.gruppNyckel, quad);
      } else {
        legacyByKey.get(key)!.push(cell);
      }
    }
  }

  const quads: Array<{ cells: CellQuad; gruppNyckel: string | null }> = [];
  // Nyckel-grupperade personer, sorterade på tidigast skapad rad (stabil ordning).
  const groupedEntries = Array.from(grouped.entries()).sort((a, b) => {
    const minTs = (q: CellQuad) => {
      const ts = [q.namn, q.titel, q.telefon, q.epost]
        .filter((c): c is KontaktCell => !!c && !!c.createdAt)
        .map((c) => new Date(c.createdAt!).getTime());
      return ts.length > 0 ? Math.min(...ts) : Number.MAX_SAFE_INTEGER;
    };
    const ta = minTs(a[1]);
    const tb = minTs(b[1]);
    if (ta !== tb) return ta - tb;
    return a[0].localeCompare(b[0]);
  });
  for (const [gruppNyckel, cells] of groupedEntries) quads.push({ cells, gruppNyckel });
  // Legacy-rader utan nyckel: index-parning (samma regel som före Task #1459).
  const legacyMax = Math.max(...KONTAKT_SUBFIELD_KEYS.map((k) => legacyByKey.get(k)!.length), 0);
  for (let i = 0; i < legacyMax; i++) {
    quads.push({
      cells: {
        namn: legacyByKey.get('namn')![i],
        titel: legacyByKey.get('titel')![i],
        telefon: legacyByKey.get('telefon')![i],
        epost: legacyByKey.get('e-post')![i],
      },
      gruppNyckel: null,
    });
  }

  const persons: ObjectKontaktPerson[] = [];
  for (const { cells, gruppNyckel } of quads) {
    const namn = cells.namn?.value || null;
    const titel = cells.titel?.value || null;
    const telefon = cells.telefon?.value || null;
    const epost = cells.epost?.value || null;
    if (!(namn || titel || telefon || epost)) continue;
    const present = [cells.namn, cells.titel, cells.telefon, cells.epost].filter(
      (c): c is KontaktCell => !!c && !!c.value,
    );
    const inherited = present.some((c) => c.inherited);
    persons.push({
      namn,
      titel,
      telefon,
      epost,
      fields: {
        namn: subfield('namn', cells.namn),
        titel: subfield('titel', cells.titel),
        telefon: subfield('telefon', cells.telefon),
        epost: subfield('e-post', cells.epost),
      },
      inherited,
      inheritedFromObjectName: present.find((c) => c.inherited)?.fromObjectName ?? null,
      createdAt: present.find((c) => c.createdAt)?.createdAt ?? null,
      gruppNyckel,
    });
  }
  return persons;
}

/**
 * Skriv en kontaktperson till objektets Kontakt-metadata (add-semantik,
 * flervärdes). Idempotent per identiskt värde och underfält. Best-effort:
 * saknas något katalogfält hoppas det över.
 */
export async function writeObjectKontaktPerson(
  objektId: string,
  tenantId: string,
  person: { namn?: string | null; titel?: string | null; telefon?: string | null; epost?: string | null },
  andradAv?: string | null,
): Promise<void> {
  const katalogRows = await db
    .select()
    .from(metadataKatalog)
    .where(and(
      eq(metadataKatalog.tenantId, tenantId),
      isNull(metadataKatalog.deletedAt),
      eq(metadataKatalog.area, 'kontakt'),
    ));
  const katByKey = new Map(katalogRows.map((k) => [(k.namn ?? '').toLowerCase(), k]));
  const writes: Array<[string, string | null | undefined]> = [
    ['namn', person.namn],
    ['titel', person.titel],
    ['telefon', person.telefon],
    ['e-post', person.epost],
  ];
  // Task #1459: alla underfält för EN person stämplas med samma grupp-nyckel så
  // att läsvägen kan para dem deterministiskt (aldrig per index/id-ordning).
  const gruppNyckel = mintMetadataGruppNyckel('kontakt');
  for (const [key, raw] of writes) {
    const value = (raw ?? '').trim();
    if (!value) continue;
    const katalog = katByKey.get(key);
    if (!katalog) continue;
    await writeImportedMetadataValue(db, {
      tenantId,
      objektId,
      katalog,
      rawValue: value,
      andradAv: andradAv ?? 'system',
      gruppNyckel,
    });
  }
}

/**
 * Alla e-postadresser i objektets Kontakt-metadata (egna + ärvda, dedupade).
 * Används av kundnotifieringar för mottagarlistan.
 */
export async function getObjectKontaktEmails(
  objektId: string,
  tenantId: string,
): Promise<string[]> {
  const owm = await getObjectWithAllMetadata(objektId, tenantId);
  if (!owm) return [];
  const emails = new Set<string>();
  for (const m of owm.metadata) {
    const k = (m.katalog?.namn ?? '').toLowerCase();
    if (k !== 'e-post') continue;
    if (m.instances && m.instances.length > 0) {
      for (const inst of m.instances) {
        const v = (inst.displayValue ?? '').trim();
        if (v && v.includes('@')) emails.add(v);
      }
    } else {
      const v = (m.vardeString ?? '').trim();
      if (v && v.includes('@') && !(m.source === 'local' && m.raderad === true)) emails.add(v);
    }
  }
  return Array.from(emails);
}

// ======
// SEED KÄRL-METADATATYPER (Modus-berikning, Task #241)
// Idempotent: kontrollerar per (tenantId, namn) och skippar om typen redan finns.
// ======

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

// ======
// WORK ORDER METADATA - CRUD operations for work order metadata
// ======

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
    visningsnamn: string | null;
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
      katalogVisningsnamn: metadataKatalog.visningsnamn,
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
      visningsnamn: row.katalogVisningsnamn ?? null,
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

  // Rubrik/samlingsfält grupperar bara underfält och håller aldrig ett eget värde.
  if (metadataTyp.datatyp === 'rubrik') {
    throw new Error(`"${metadataTyp.namn}" är ett rubrik-/samlingsfält och kan inte ha ett eget värde — det grupperar bara underfält.`);
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
      vardeFields.vardeDatetime = new Date(data.varde as string | number | Date);
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

// ======
// METADATA KOPPLAD TILL ORDERTYP (Task #665)
// ======

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

// Kap 6 (master-spec): obligatorisk informationslämning. Returnerar listan av
// leave-metadata-koder som SAKNAR värde men är obligatoriska — anropas precis
// innan en uppgift markeras som slutförd (både web- och mobil-completion) för
// att blockera slutförandet tills värdena finns.
//
// Regler:
//  * Endast artiklar med `leaveMetadataRequired = true` och en `leaveMetadataCode`.
//  * Auto-format (timestamp/boolean_true/counter_increment) uppfyller alltid kravet
//    automatiskt (systemet skriver värdet vid slutförandet) → räknas aldrig som saknat.
//  * Format "value" (direkt input) kräver ett värde: antingen medskickat i
//    `providedValues` (kod → värde) eller redan satt på objektet.
export async function findMissingRequiredLeaveMetadata(
  lines: Array<{ articleId: string | null }>,
  objectId: string,
  tenantId: string,
  providedValues: Record<string, string> = {},
): Promise<string[]> {
  const missing: string[] = [];
  const seen = new Set<string>();
  // Grupp-expansion (Alt B): en leave-rad som pekar på en grupp-förälder expanderas
  // till sina barn — kravet gäller då varje barnfält. Laddas en gång per anrop.
  const groupIndex = buildMetadataGroupIndex(await getAllMetadataTypes(tenantId));
  // Ett obligatoriskt fält uppfylls om värdet skickats med (providedValues) ELLER
  // redan finns på objektet. Dedupas per kod (namn) så samma fält aldrig dubblas.
  const checkRequired = async (code: string): Promise<void> => {
    if (seen.has(code)) return;
    seen.add(code);
    const provided = providedValues[code];
    if (provided !== undefined && String(provided).trim() !== "") return;
    const existing = await getArticleMetadataForObject(objectId, code, tenantId);
    if (existing?.value !== undefined && existing?.value !== null && String(existing.value).trim() !== "") return;
    missing.push(code);
  };
  for (const line of lines) {
    if (!line.articleId) continue;
    const article = await db.query.articles.findFirst({
      where: and(eq(articles.id, line.articleId), eq(articles.tenantId, tenantId)),
    });
    if (!article) continue;
    // Legacy single-value-vägen (expand-contract: behålls orörd).
    if (article.leaveMetadataRequired && article.leaveMetadataCode) {
      const fmt = article.leaveMetadataFormat;
      // Auto-format fylls i av systemet → aldrig obligatoriskt att fylla i manuellt.
      if (!(fmt === "timestamp" || fmt === "boolean_true" || fmt === "counter_increment")) {
        await checkRequired(article.leaveMetadataCode);
      }
    }
    // Ny modell: leaveMetadataFields med required=true kräver ett manuellt värde.
    // Grupp-förälder expanderas till barn (required ärvs ned till varje barn).
    const leaveRows = Array.isArray(article.leaveMetadataFields)
      ? (article.leaveMetadataFields as Array<{ metadataField?: string; required?: boolean }>)
      : [];
    for (const row of expandArticleMetadataRows(leaveRows, groupIndex)) {
      if (!row.required || !row.metadataField) continue;
      await checkRequired(row.metadataField);
    }
  }
  return missing;
}

// Skriv tillbaka medskickade "lämna"-värden för konfigurerade leaveMetadataFields
// (ny modell). Endast fält som faktiskt finns i artiklarnas konfiguration skrivs —
// aldrig godtyckliga klient-skickade nycklar. Legacy single-value-writeback
// (auto-format) hanteras separat i respektive route och lämnas orörd.
export async function writeProvidedLeaveMetadataFields(
  lines: Array<{ articleId: string | null }>,
  objectId: string,
  tenantId: string,
  providedValues: Record<string, string>,
  setBy: string,
): Promise<void> {
  if (!providedValues || Object.keys(providedValues).length === 0) return;
  const written = new Set<string>();
  // Grupp-expansion (Alt B): en leave-rad som pekar på en grupp-förälder skriver
  // tillbaka varje barnfält separat (föräldern bär aldrig värde).
  const groupIndex = buildMetadataGroupIndex(await getAllMetadataTypes(tenantId));
  for (const line of lines) {
    if (!line.articleId) continue;
    const article = await db.query.articles.findFirst({
      where: and(eq(articles.id, line.articleId), eq(articles.tenantId, tenantId)),
    });
    const leaveRows = Array.isArray(article?.leaveMetadataFields)
      ? (article!.leaveMetadataFields as Array<{ metadataField?: string }>)
      : [];
    for (const row of expandArticleMetadataRows(leaveRows, groupIndex)) {
      const field = row.metadataField;
      if (!field || written.has(field)) continue;
      const provided = providedValues[field];
      if (provided === undefined || String(provided).trim() === "") continue;
      written.add(field);
      await writeArticleMetadataOnObject(objectId, field, String(provided), tenantId, setBy);
    }
  }
}


export async function deleteMetadataGuarded(
  metadataId: string,
  tenantId: string,
  raderadAv?: string,
  metod?: string,
): Promise<GuardedDeleteResult> {
  return await db.transaction(async (tx) => {
    const lockedRows = await tx.execute(sql`
      SELECT * FROM metadata_varden
      WHERE id = ${metadataId} AND tenant_id = ${tenantId}
      FOR UPDATE
    `);
    const existing = (lockedRows.rows as any[])[0];
    if (!existing) {
      return { status: 'not_found' as const, changedHistorikCount: 0, conceptFilterCount: 0 };
    }

    // Task #1441-invariant: interim-fält är en intern matchningsnyckel för
    // re-import och får aldrig hård-raderas manuellt (samma guard som
    // deleteMetadata) — mappas till 403 i routen.
    const katalogIdForGuard = existing.metadata_katalog_id ?? existing.metadataKatalogId ?? null;
    if (katalogIdForGuard) {
      const [kat] = await tx
        .select({ namn: metadataKatalog.namn })
        .from(metadataKatalog)
        .where(and(eq(metadataKatalog.id, katalogIdForGuard), eq(metadataKatalog.tenantId, tenantId)));
      if (kat && isInterimKatalogNamn(kat.namn)) {
        throw new ReadonlyMetadataError('Interimsnummer är ett tekniskt importfält och kan inte tas bort manuellt.');
      }
    }

    // Blockerare 1: verklig historik (dokumenterade ändringar; rena
    // skapande-rader har gammalt_varde IS NULL och blockerar inte).
    const historikRes = await tx.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM metadata_historik
      WHERE metadata_varden_id = ${metadataId}
        AND tenant_id = ${tenantId}
        AND gammalt_varde IS NOT NULL
    `);
    const changedHistorikCount = Number((historikRes.rows as any[])[0]?.cnt ?? 0);

    // Blockerare 2: kopplingar (villkorsfilter i orderkoncept/artiklar).
    const katalogId = existing.metadata_katalog_id ?? existing.metadataKatalogId ?? null;
    let conceptFilterCount = 0;
    if (katalogId) {
      const usage = await getMetadataKatalogUsage(katalogId, tenantId);
      conceptFilterCount = usage.conceptFilterCount ?? 0;
    }

    if (changedHistorikCount > 0 || conceptFilterCount > 0) {
      return { status: 'blocked' as const, changedHistorikCount, conceptFilterCount };
    }

    await tx.insert(metadataHistorik).values({
      tenantId,
      metadataVardenId: existing.id,
      objektId: existing.objekt_id ?? existing.objektId,
      metadataKatalogId: katalogId,
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
    return { status: 'deleted' as const, changedHistorikCount, conceptFilterCount };
  });
}
