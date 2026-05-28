// Multi-sheet Excel-mall för objektimport (KINAB-flödet).
// Auktoritativ specifikation för kolumnnamn och flikar i
// `Traivo_objektimport_mall_v1.xlsx`. UI:t (admin-import-vy) och
// backend-parser/-mall-generator delar definitionerna här så de aldrig
// driver isär.

export interface ObjektmallColumn {
  key: string; // Intern nyckel (engelska) som parser-koden referar.
  header: string; // Svenskt kolumnnamn i .xlsx — exakt så det visas i Excel.
  required: boolean;
  description: string;
  example?: string;
}

export interface ObjektmallSheet {
  key: "organisation" | "stores" | "containers" | "metadata";
  name: string;
  intro: string;
  columns: ObjektmallColumn[];
}

export const OBJEKTMALL_VERSION = "v1" as const;
export const OBJEKTMALL_FILENAME = `Traivo_objektimport_mall_${OBJEKTMALL_VERSION}.xlsx`;
export const OBJEKTMALL_BATCH_PREFIX = "objektmall-";
// Prefix vi sätter framför interimsnumret när vi sparar `objectNumber`
// så vi inte krockar med användarens egna objektsnummer.
export const OBJEKTMALL_INTERIM_PREFIX = "MALL-";

export const OBJEKTMALL_SHEETS: ObjektmallSheet[] = [
  {
    key: "organisation",
    name: "Steg 1 — Organisation",
    intro:
      "Toppnivå (koncern, kommun, varumärke). En rad = en organisationsnod. Interimsnumret " +
      "är ditt eget löpnummer (t.ex. ORG-1) som binder ihop nivåerna och möjliggör re-import.",
    columns: [
      { key: "interim", header: "Interimsnummer", required: true, description: "Unikt löpnummer för raden, t.ex. ORG-1", example: "ORG-1" },
      { key: "name", header: "Namn", required: true, description: "Organisationens namn", example: "KINAB Koncern" },
      { key: "description", header: "Beskrivning", required: false, description: "Valfri beskrivning", example: "Moderbolag" },
    ],
  },
  {
    key: "stores",
    name: "Steg 2 — Butiker",
    intro:
      "Butiker/platser/fastigheter under en organisation. Föräldra-interimsnumret pekar på en rad " +
      "från Steg 1.",
    columns: [
      { key: "interim", header: "Interimsnummer", required: true, description: "Unikt löpnummer, t.ex. BUT-101", example: "BUT-101" },
      { key: "parentInterim", header: "Föräldra-interimsnummer", required: true, description: "Interimsnummer från Steg 1", example: "ORG-1" },
      { key: "name", header: "Namn", required: true, description: "Butikens/platsens namn", example: "ICA Söderköping" },
      { key: "address", header: "Adress", required: false, description: "Gatuadress (geokodning sker separat efter import)", example: "Storgatan 5" },
      { key: "postalCode", header: "Postnummer", required: false, description: "Postnummer", example: "614 30" },
      { key: "city", header: "Stad", required: false, description: "Ort/stad", example: "Söderköping" },
      { key: "contactName", header: "Kontaktperson", required: false, description: "Namn på primär kontaktperson", example: "Anna Andersson" },
      { key: "contactPhone", header: "Telefon", required: false, description: "Telefonnummer", example: "070-123 45 67" },
      { key: "contactEmail", header: "E-post", required: false, description: "E-postadress", example: "anna@ica-soderkoping.se" },
    ],
  },
  {
    key: "containers",
    name: "Steg 3 — Kärl per butik",
    intro:
      "Fysiska kärl/objekt under en butik. Namnet genereras automatiskt från kärltyp + " +
      "butiknamn — du behöver bara fylla i interim, föräldra-interim, typ och antal.",
    columns: [
      { key: "interim", header: "Interimsnummer", required: true, description: "Unikt löpnummer, t.ex. KARL-1001", example: "KARL-1001" },
      { key: "parentInterim", header: "Föräldra-interimsnummer", required: true, description: "Interimsnummer från Steg 2 (eller Steg 1)", example: "BUT-101" },
      { key: "containerType", header: "Kärltyp", required: true, description: "Typ av kärl, t.ex. Matavfall, Restavfall, Wellpapp", example: "Matavfall" },
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

export function getObjektmallSheet(key: ObjektmallSheet["key"]): ObjektmallSheet {
  const s = OBJEKTMALL_SHEETS.find((x) => x.key === key);
  if (!s) throw new Error(`Okänd flik: ${key}`);
  return s;
}
