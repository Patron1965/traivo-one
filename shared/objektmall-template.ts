// Enflik-importmall för objektimport (KINAB-flödet).
// Auktoritativ specifikation för kolumnnamn i `Traivo_objektimport_mall_v3.xlsx`.
// UI:t (admin-import-vy) och backend-parser/-mall-generator delar definitionerna
// här så de aldrig driver isär.
//
// Task #631 — Enflik-mall + dynamiska metadata-kolumner:
//   Mallen består av EN enda "Import"-flik (utöver "Läs mig först"). En rad = ett
//   objekt oavsett nivå; hierarkin byggs via föräldrakolumnerna i stället för via
//   separata flikar, och objektets nivå härleds från förälderkedjan.
//
//   Kolumn A–E är FASTA:
//     Systemnummer | Interimsnummer | Systemföräldranummer | Interimföräldranummer | Objektnamn
//   Kolumn F och framåt definieras vid varje import: rad 1 bär metadata-
//   referensnamn (variabelt antal), och varje rads cell under är det rådata-värdet.
//
// Task #618 — Enhetligt nummerprotokoll (fyra nummer):
//   • Systemnummer fyllt        → UPPDATERA befintligt objekt. Kolumn A är ALLTID
//     Traivos eget systemnummer (objectNumber); kundens egna butiksnummer hör hemma
//     i en metadata-kolumn (t.ex. externt_id), inte i kolumn A.
//   • enbart Interimsnummer      → SKAPA nytt objekt (objectNumber = MALL-<interim>),
//     re-import via samma interim uppdaterar i stället för att duplicera.
//   • Systemföräldranummer       → peka mot BEFINTLIG förälder (existing→existing).
//   • Interimföräldranummer      → peka mot en rad i samma fil (ny eller befintlig).

export interface ObjektmallColumn {
  key: string; // Intern nyckel (engelska) som parser-koden referar.
  header: string; // Svenskt kolumnnamn i .xlsx — exakt så det visas i Excel.
  required: boolean;
  description: string;
  example?: string;
  // Tidigare/alternativa rubriknamn som parsern också accepterar (bakåtkompat).
  aliases?: string[];
}

export const OBJEKTMALL_VERSION = "v3" as const;
export const OBJEKTMALL_FILENAME = `Traivo_objektimport_mall_${OBJEKTMALL_VERSION}.xlsx`;
export const OBJEKTMALL_BATCH_PREFIX = "objektmall-";
// Prefix vi sätter framför interimsnumret när vi sparar `objectNumber`
// så vi inte krockar med användarens egna objektsnummer.
// LEGACY (Task #1433): nya importer sparar INTE längre interimsnumret i
// objectNumber — objektet får ett systemmyntat OBJ-NNN och interimsnumret
// lagras separat som metadata (se OBJEKTMALL_INTERIM_METADATA_FALT).
// Prefixet behålls för bakåtkompatibel matchning av redan skapade MALL-objekt.
export const OBJEKTMALL_INTERIM_PREFIX = "MALL-";
// Metadata-katalogfältets `namn` (universell matchningsnyckel) där importens
// interimsnummer lagras. Re-importmatchning sker på detta värde + objektets
// kund — så samma interimsnummer i listor till OLIKA kunder blir olika objekt.
export const OBJEKTMALL_INTERIM_METADATA_FALT = "interimsnummer";

// Flik-namn i arbetsboken.
export const OBJEKTMALL_README_SHEET_NAME = "Läs mig först";
export const OBJEKTMALL_IMPORT_SHEET_NAME = "Import";

// Maskinläsbar markör i "Läs mig först"-fliken för interimslist-flaggan.
// Parsern letar efter denna sträng i en cell och läser cellen till höger om den.
export const OBJEKTMALL_INTERIM_FLAG_MARKER = "[INTERIMSLISTA]";
export const OBJEKTMALL_INTERIM_FLAG_LABEL =
  `${OBJEKTMALL_INTERIM_FLAG_MARKER} Är hela denna fil enbart NYA interimsnummer (ren nyimport)? ` +
  `Skriv JA i cellen till höger för att hoppa över system-/uppdateringsmatchning:`;

// De FASTA kolumnerna A–E som inleder varje rad i Import-fliken. Kolumn F och
// framåt är dynamiska metadata-kolumner (referensnamn på rad 1) och definieras
// inte här — de läses in vid varje import.
export const OBJEKTMALL_FIXED_COLUMNS: ObjektmallColumn[] = [
  {
    key: "systemNumber",
    header: "Systemnummer",
    required: false,
    description:
      "Traivos systemnummer för ett BEFINTLIGT objekt. Unikt ID som systemet själv skapar. Fyll i för att UPPDATERA, lämna tomt för nytt objekt. Kundens egna butiksnummer läggs i en separat metadata-kolumn (t.ex. 'externt_id') — inte här.",
    example: "",
    aliases: ["Systemnr"],
  },
  {
    key: "interim",
    header: "Interimsnummer",
    required: false,
    description:
      "Ditt eget löpnummer för NYA objekt (t.ex. ORG-1). Binder ihop nivåerna och möjliggör re-import. Lämna tomt om raden enbart uppdaterar via systemnummer.",
    example: "ORG-1",
  },
  {
    key: "systemParentNumber",
    header: "Systemföräldranummer",
    required: false,
    description:
      "Förälderns systemnummer (befintligt objekt). Används för att peka objektet mot en redan befintlig förälder.",
    example: "",
    aliases: ["Systemförälder"],
  },
  {
    key: "parentInterim",
    header: "Interimföräldranummer",
    required: false,
    description:
      "Förälderns interimsnummer (en rad i denna fil — ny eller befintlig). Lämna tomt för rotnivå (objekt utan förälder).",
    example: "",
    aliases: ["Föräldra-interimsnummer"],
  },
  {
    key: "name",
    header: "Objektnamn",
    required: true,
    description: "Objektets namn (obligatoriskt på varje rad oavsett nivå).",
    example: "KINAB Koncern",
    aliases: ["Namn"],
  },
];

// Illustrativa metadata-referensnamn som visas i den tomma mallens kolumn F+.
// De är BARA exempel — användaren byter ut/lägger till egna referensnamn.
// Task #633: exemplet visar punktnotation för ett sammansatt fält (adress med
// underfälten gata/gatunummer/postnummer/ort).
// Task #642 (session 4): kontaktperson visas också som sammansatt fält
// (kontaktperson.namn/titel/telefon) och externt_id som exempel på var kundens
// egna butiksnummer hör hemma (en vanlig metadata-kolumn, inte kolumn A).
export const OBJEKTMALL_EXAMPLE_METADATA_HEADERS: string[] = [
  "adress.gata",
  "adress.gatunummer",
  "adress.postnummer",
  "adress.ort",
  "kontaktperson.namn",
  "kontaktperson.titel",
  "kontaktperson.telefon",
  "externt_id",
];

// ============================================================
// Sammansatta metadatafält — punktnotation `fält.underfält` (Task #633).
// ------------------------------------------------------------
// Kolumner som delar prefix före punkten hör ihop som ETT logiskt fält och
// lagras strukturerat (JSON) på objektet. Ex: "adress.gata", "adress.ort" →
// fältet "adress" med underfälten { gata, ort }. Backend-parser och UI delar
// dessa hjälpare så konventionen tolkas likadant överallt.
// ============================================================
export const OBJEKTMALL_COMPOSITE_SEPARATOR = ".";

// Dela upp ett referensnamn i { prefix, subfield } om det använder punktnotation.
// Returnerar null för enkla (icke-sammansatta) kolumner. Punkt först/sist eller
// tomma delar räknas inte som giltig punktnotation.
export function parseCompositeRef(
  refName: string,
): { prefix: string; subfield: string } | null {
  const idx = refName.indexOf(OBJEKTMALL_COMPOSITE_SEPARATOR);
  if (idx <= 0) return null;
  const prefix = refName.slice(0, idx).trim();
  const subfield = refName.slice(idx + OBJEKTMALL_COMPOSITE_SEPARATOR.length).trim();
  if (!prefix || !subfield) return null;
  return { prefix, subfield };
}

// Alla giltiga rubriknamn för en kolumn (huvudrubrik + alias), gemena.
export function objektmallColumnHeaderAliases(col: ObjektmallColumn): string[] {
  return [col.header, ...(col.aliases ?? [])].map((h) => h.toLowerCase());
}

// Alla fasta huvud-/alias-rubriker (gemena) — används för att skilja fasta
// kolumner från dynamiska metadata-kolumner vid parsning.
export function objektmallFixedHeaderSet(): Set<string> {
  const set = new Set<string>();
  for (const col of OBJEKTMALL_FIXED_COLUMNS) {
    for (const h of objektmallColumnHeaderAliases(col)) set.add(h);
  }
  return set;
}
