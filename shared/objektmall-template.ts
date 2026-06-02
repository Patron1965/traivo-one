// Multi-sheet Excel-mall för objektimport (KINAB-flödet).
// Auktoritativ specifikation för kolumnnamn och flikar i
// `Traivo_objektimport_mall_v2.xlsx`. UI:t (admin-import-vy) och
// backend-parser/-mall-generator delar definitionerna här så de aldrig
// driver isär.
//
// Task #618 — Enhetligt importprotokoll (fyra nummer):
//   Varje objektflik bär samma nummerprotokoll i de inledande kolumnerna:
//     Systemnummer | Interimsnummer | Systemföräldranummer | Interimföräldranummer | Objektnamn | ...
//   • Systemnummer fyllt        → UPPDATERA befintligt objekt (matchas mot
//     objectNumber = systemnummer/butiksnummer, eller mot objektnamn = butiksnamn).
//   • enbart Interimsnummer      → SKAPA nytt objekt (objectNumber = MALL-<interim>),
//     re-import via samma interim uppdaterar i stället för att duplicera.
//   • Systemföräldranummer       → peka om till BEFINTLIG förälder (existing→existing).
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

export interface ObjektmallSheet {
  key: "organisation" | "stores" | "containers" | "metadata";
  name: string;
  intro: string;
  columns: ObjektmallColumn[];
}

export const OBJEKTMALL_VERSION = "v2" as const;
export const OBJEKTMALL_FILENAME = `Traivo_objektimport_mall_${OBJEKTMALL_VERSION}.xlsx`;
export const OBJEKTMALL_BATCH_PREFIX = "objektmall-";
// Prefix vi sätter framför interimsnumret när vi sparar `objectNumber`
// så vi inte krockar med användarens egna objektsnummer.
export const OBJEKTMALL_INTERIM_PREFIX = "MALL-";

// Maskinläsbar markör i "Läs mig först"-fliken för interimslist-flaggan.
// Parsern letar efter denna sträng i en cell och läser cellen till höger om den.
export const OBJEKTMALL_INTERIM_FLAG_MARKER = "[INTERIMSLISTA]";
export const OBJEKTMALL_INTERIM_FLAG_LABEL =
  `${OBJEKTMALL_INTERIM_FLAG_MARKER} Är hela denna fil enbart NYA interimsnummer (ren nyimport)? ` +
  `Skriv JA i cellen till höger för att hoppa över system-/uppdateringsmatchning:`;

// Gemensamma nummerkolumner (protokollet) som inleder varje objektflik.
// `withParent=false` för rotnivån (organisation) som inte har förälder.
function numberColumns(withParent: boolean): ObjektmallColumn[] {
  const cols: ObjektmallColumn[] = [
    {
      key: "systemNumber",
      header: "Systemnummer",
      required: false,
      description:
        "Traivos systemnummer (eller kundens butiksnummer) för ett BEFINTLIGT objekt. Fyll i för att UPPDATERA. Lämna tomt för nytt objekt.",
      example: "",
      aliases: ["Systemnr", "Butiksnummer"],
    },
    {
      key: "interim",
      header: "Interimsnummer",
      required: false,
      description:
        "Ditt eget löpnummer för NYA objekt (t.ex. ORG-1). Binder ihop nivåerna och möjliggör re-import. Lämna tomt om raden enbart uppdaterar via systemnummer.",
      example: "",
    },
  ];
  if (withParent) {
    cols.push(
      {
        key: "systemParentNumber",
        header: "Systemföräldranummer",
        required: false,
        description:
          "Förälderns systemnummer (befintligt objekt). Används för att peka om objektet till en redan befintlig förälder.",
        example: "",
        aliases: ["Systemförälder"],
      },
      {
        key: "parentInterim",
        header: "Interimföräldranummer",
        required: false,
        description:
          "Förälderns interimsnummer (en rad i denna fil — ny eller befintlig). Antingen detta eller Systemföräldranummer måste anges (utom rotnivå).",
        example: "",
        aliases: ["Föräldra-interimsnummer"],
      },
    );
  }
  return cols;
}

export const OBJEKTMALL_SHEETS: ObjektmallSheet[] = [
  {
    key: "organisation",
    name: "Steg 1 — Organisation",
    intro:
      "Toppnivå (koncern, kommun, varumärke) — rotnivån, ingen förälder krävs. En rad = en organisationsnod. " +
      "Fyll i Interimsnummer för nya noder; fyll i Systemnummer för att uppdatera en befintlig.",
    columns: [
      ...numberColumns(false),
      {
        key: "name",
        header: "Objektnamn",
        required: true,
        description: "Organisationens namn (obligatoriskt)",
        example: "KINAB Koncern",
        aliases: ["Namn"],
      },
      { key: "description", header: "Beskrivning", required: false, description: "Valfri beskrivning", example: "Moderbolag" },
    ],
  },
  {
    key: "stores",
    name: "Steg 2 — Butiker",
    intro:
      "Butiker/platser/fastigheter under en organisation. Ange förälder via Interimföräldranummer (rad i Steg 1) " +
      "eller Systemföräldranummer (befintligt objekt). Endast Objektnamn + förälder är obligatoriskt; adress m.m. är metadata och ärvs vid behov.",
    columns: [
      ...numberColumns(true),
      {
        key: "name",
        header: "Objektnamn",
        required: true,
        description: "Butikens/platsens namn (obligatoriskt)",
        example: "ICA Söderköping",
        aliases: ["Namn"],
      },
      { key: "address", header: "Adress", required: false, description: "Gatuadress (metadata — geokodning sker separat efter import)", example: "Storgatan 5" },
      { key: "postalCode", header: "Postnummer", required: false, description: "Postnummer (metadata)", example: "614 30" },
      { key: "city", header: "Stad", required: false, description: "Ort/stad (metadata)", example: "Söderköping" },
      { key: "contactName", header: "Kontaktperson", required: false, description: "Namn på primär kontaktperson", example: "Anna Andersson" },
      { key: "contactPhone", header: "Telefon", required: false, description: "Telefonnummer", example: "070-123 45 67" },
      { key: "contactEmail", header: "E-post", required: false, description: "E-postadress", example: "anna@ica-soderkoping.se" },
    ],
  },
  {
    key: "containers",
    name: "Steg 3 — Kärl per butik",
    intro:
      "Fysiska kärl/objekt under en butik. Ange förälder via Interimföräldranummer (Steg 2/1) eller Systemföräldranummer. " +
      "Objektnamn kan lämnas tomt — då genereras det automatiskt från Kärltyp + butiknamn.",
    columns: [
      ...numberColumns(true),
      {
        key: "name",
        header: "Objektnamn",
        required: false,
        description: "Kärlets namn. Lämna tomt för att auto-generera från Kärltyp + butiknamn.",
        example: "",
        aliases: ["Namn"],
      },
      { key: "containerType", header: "Kärltyp", required: false, description: "Typ av kärl, t.ex. Matavfall, Restavfall, Wellpapp", example: "Matavfall" },
      { key: "count", header: "Antal", required: false, description: "Antal kärl (heltal)", example: "2" },
      { key: "volumeLiters", header: "Volym (L)", required: false, description: "Volym per kärl i liter", example: "240" },
      { key: "emptyingDay", header: "Tömningsdag", required: false, description: "Veckodag eller intervall, t.ex. Tisdag, V2/Mån", example: "Tisdag" },
      { key: "notes", header: "Anteckningar", required: false, description: "Fritext / placering", example: "Bakgård, kod 1234" },
    ],
  },
  {
    key: "metadata",
    name: "Metadatafält (valfri)",
    intro:
      "Definitioner av extra metadata-fält som kan kopplas på objekten. Befintliga fält " +
      "uppdateras, nya skapas. Strukturella ändringar på fält som redan används blockeras (se ADR v3).",
    columns: [
      { key: "fieldKey", header: "Fältnyckel", required: true, description: "Tekniskt ID (a-z, 0-9, _). Får ej ändras efter att fältet används.", example: "vinjettbild" },
      { key: "fieldLabel", header: "Visningsnamn", required: true, description: "Det användaren ser i UI", example: "Vinjettbild" },
      { key: "dataType", header: "Datatyp", required: false, description: "text | number | date | boolean | json (default: text)", example: "text" },
      { key: "propagationType", header: "Propagering", required: false, description: "fixed | falling | dynamic (default: falling)", example: "falling" },
      { key: "applicableLevels", header: "Tillämpliga nivåer", required: false, description: "Kommaseparerad lista: koncern,brf,fastighet,rum,karl", example: "fastighet,karl" },
      { key: "defaultValue", header: "Standardvärde", required: false, description: "Default-värde om inget anges", example: "" },
      { key: "isRequired", header: "Obligatoriskt", required: false, description: "ja/nej (default: nej)", example: "nej" },
      { key: "sortOrder", header: "Sorteringsordning", required: false, description: "Heltal — lägre visas först", example: "10" },
    ],
  },
];

// Alla giltiga rubriknamn för en kolumn (huvudrubrik + alias), gemena.
export function objektmallColumnHeaderAliases(col: ObjektmallColumn): string[] {
  return [col.header, ...(col.aliases ?? [])].map((h) => h.toLowerCase());
}

export function getObjektmallSheet(key: ObjektmallSheet["key"]): ObjektmallSheet {
  const s = OBJEKTMALL_SHEETS.find((x) => x.key === key);
  if (!s) throw new Error(`Okänd flik: ${key}`);
  return s;
}
