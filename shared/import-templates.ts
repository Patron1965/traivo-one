// Central källa för importmallar — används av:
//   1. UI:t i ImportPage (kolumntabellerna som visas under "Visa förväntade kolumner")
//   2. Backend-endpointen GET /api/import/template/:type som genererar .xlsx
// På så sätt kan inte mallen som laddas ner driva isär från vad importen kräver.

export interface ImportTemplateColumn {
  name: string;
  /**
   * Visningsetikett (svensk). När satt används den som rubrik i den nedladdade
   * mallen och i wizardens kolumn-hint istället för det interna `name`. Importens
   * auto-mappning matchar både `name` och `label`, så mallen kan döpas om fritt.
   */
  label?: string;
  required: boolean;
  description: string;
  example?: string;
}

export interface ImportTemplateDefinition {
  key: ImportTemplateKey;
  fileName: string;
  sheetName: string;
  title: string;
  intro: string;
  columns: ImportTemplateColumn[];
}

export type ImportTemplateKey =
  | "modus-objekt"
  | "modus-tasks"
  | "modus-events"
  | "modus-fakturarader"
  | "fortnox-kunder"
  | "fortnox-fakturahistorik"
  | "fastighetslista"
  | "barnobjekt"
  | "wizard-organisation"
  | "wizard-stores"
  | "wizard-equipment";

const MODUS_OBJEKT: ImportTemplateDefinition = {
  key: "modus-objekt",
  fileName: "traivo-mall-modus-objekt.xlsx",
  sheetName: "Objekt",
  title: "Modus — Objekt",
  intro:
    "Modus-export av objekt (fastigheter, soprum, behållare). Hierarki byggs via Parent-kolumnen. " +
    "Alla kolumner som börjar med 'Metadata - ' importeras automatiskt till metadata-systemet.",
  columns: [
    { name: "Id", required: true, description: "Unikt Modus-ID för objektet", example: "M-12345" },
    { name: "Namn", required: true, description: "Objektets namn (t.ex. fastighetsnamn)", example: "Storgatan 5" },
    { name: "Typ", required: true, description: "Objekttyp: Fastighet, Adress, Soprum, etc.", example: "Fastighet" },
    { name: "Parent", required: false, description: "ID för överordnat objekt (hierarki)", example: "M-12000" },
    { name: "Kund", required: false, description: "Kundnamn (skapande-tenant/historik). Auktoritativ betalare hanteras i object_payers — se ADR v3.", example: "Telgebostäder AB" },
    { name: "Latitud", required: false, description: "GPS-koordinat (komma ersätts automatiskt med punkt)", example: "59,1956" },
    { name: "Longitud", required: false, description: "GPS-koordinat (komma ersätts automatiskt med punkt)", example: "17,6253" },
    { name: "Adress 1", required: false, description: "Gatuadress", example: "Storgatan 5" },
    { name: "Ort", required: false, description: "Ort/stad", example: "Södertälje" },
    { name: "Postnummer", required: false, description: "Postnummer", example: "151 30" },
    { name: "Beskrivning", required: false, description: "Rad 2 = Kontaktperson, Rad 3 = Telefon, Rad 4 = E-post", example: "Husvärden\nAnna Andersson\n08-1234567\nanna@telge.se" },
    { name: "Metadata - Antal kärl", required: false, description: "Exempel på Metadata-kolumn. Alla 'Metadata - *' importeras automatiskt.", example: "4" },
  ],
};

const MODUS_TASKS: ImportTemplateDefinition = {
  key: "modus-tasks",
  fileName: "traivo-mall-modus-tasks.xlsx",
  sheetName: "Uppgifter",
  title: "Modus — Uppgifter (arbetsordrar)",
  intro:
    "Modus-export av uppgifter/arbetsordrar. Kräver att objekten är importerade först — uppgifter " +
    "kopplas mot objekt via Modus-objekt-ID.",
  columns: [
    { name: "Uppgifts Id", required: true, description: "Unikt ID för uppgiften", example: "T-98765" },
    { name: "Objekt", required: true, description: "Referens till Modus objekt-ID", example: "M-12345" },
    { name: "Kund", required: false, description: "Kundnamn i format 'Namn (ID)'", example: "Telgebostäder AB (T001)" },
    { name: "Uppgiftsnamn", required: false, description: "Titel på arbetsorderna", example: "Kärltvätt vår 2025" },
    { name: "Uppgiftstyp", required: false, description: "Kärltvätt, Rumstvätt, Tvätt UJ-behållare", example: "Kärltvätt" },
    { name: "Jobb", required: false, description: "Jobbgruppering, format 'Namn (ID)'", example: "Vårrunda 2025 (J-44)" },
    { name: "Beställning", required: false, description: "Beställningsnummer", example: "B-2025-017" },
    { name: "Prislista", required: false, description: "Prislistans namn (t.ex. Vafab Miljö)", example: "Vafab Miljö" },
    { name: "Varaktighet", required: false, description: "Uppskattad tid i minuter", example: "45" },
    { name: "Kostnad", required: false, description: "Beräknad kostnad (komma-decimal)", example: "120,50" },
    { name: "Pris", required: false, description: "Beräknat pris (komma-decimal)", example: "156,56" },
    { name: "Status", required: false, description: "done, not_started, in_progress, not_feasible", example: "done" },
    { name: "Resultat", required: false, description: "Anteckningar/kommentarer från fältarbetare", example: "Utförd utan anmärkning" },
    { name: "Fakturerad", required: false, description: "1 = fakturerad, 0 = ej fakturerad", example: "1" },
    { name: "Starttid", required: false, description: "Startdatum i ISO-format", example: "2025-04-12T08:00:00" },
    { name: "Sluttid", required: false, description: "Slutdatum i ISO-format", example: "2025-04-12T08:45:00" },
    { name: "Planerad år", required: false, description: "Planerat år (t.ex. 2025)", example: "2025" },
    { name: "Planerad vecka", required: false, description: "Planerad vecka (1-52)", example: "15" },
    { name: "Planerad dag o tid", required: false, description: "Datum och tid i ISO-format", example: "2025-04-12T08:00:00" },
    { name: "Team", required: false, description: "Resursnamn/fordons-ID (skapas automatiskt om ny)", example: "Bil 1" },
  ],
};

const MODUS_EVENTS: ImportTemplateDefinition = {
  key: "modus-events",
  fileName: "traivo-mall-modus-events.xlsx",
  sheetName: "Händelser",
  title: "Modus — Händelser (events)",
  intro:
    "Modus-export av händelser per uppgift. Används för att räkna fram arbetstider och ställtider " +
    "baserat på tidsstämplar mellan 'in_progress' och 'done'.",
  columns: [
    { name: "Event Id", required: false, description: "Löpnummer för händelsen", example: "1" },
    { name: "Uppgifts Id", required: true, description: "Kopplar händelsen till en uppgift", example: "T-98765" },
    { name: "Event Typ", required: true, description: "in_progress, done, not_started, not_feasible", example: "done" },
    { name: "Beskrivning", required: false, description: "Statusbeskrivning", example: "Uppgift slutförd" },
    { name: "Tid", required: true, description: "Tidsstämpel för händelsen (ISO-format)", example: "2025-04-12T08:45:00" },
  ],
};

const MODUS_INVOICE_LINES: ImportTemplateDefinition = {
  key: "modus-fakturarader",
  fileName: "traivo-mall-modus-fakturarader.xlsx",
  sheetName: "Fakturarader",
  title: "Modus — Fakturarader",
  intro:
    "Modus-export av fakturarader. Kopplar mot uppgifter via Uppgift Id. " +
    "Skapar artiklar automatiskt baserat på Fortnox Artikel Id (t.ex. K100 = kärltvätt).",
  columns: [
    { name: "Uppgift Id", required: true, description: "Kopplar fakturaraden till en uppgift", example: "T-98765" },
    { name: "Rad", required: false, description: "Radnummer inom uppgiften", example: "1" },
    { name: "Beskrivning", required: false, description: "Beskrivning: 'Adress: Tjänstetyp'", example: "Storgatan 5: Kärltvätt" },
    { name: "Antal", required: false, description: "Antal enheter", example: "4" },
    { name: "Pris", required: false, description: "Styckpris (komma-decimal, t.ex. 156,56)", example: "156,56" },
    { name: "Fortnox Artikel Id", required: false, description: "Artikelkod: K100 (kärltvätt), UJ100 (underjord)", example: "K100" },
    { name: "Fortnox Kostnadsställe", required: false, description: "Kostnadsställe i Fortnox", example: "100" },
    { name: "Fortnox Projekt", required: false, description: "Projektkod/team-referens", example: "BIL1" },
  ],
};

const FORTNOX_CUSTOMERS: ImportTemplateDefinition = {
  key: "fortnox-kunder",
  fileName: "traivo-mall-fortnox-kunder.xlsx",
  sheetName: "Kunder",
  title: "Fortnox — Kunder",
  intro:
    "Fortnox-export av kundregistret (xlsx). Tekniska Fortnox-kolumnnamn används. Befintliga kunder " +
    "med samma kundnummer hoppas över om inte 'merge' valts vid uppladdning.",
  columns: [
    { name: "customer_number", required: true, description: "Kundnummer i Fortnox (unikt)", example: "1001" },
    { name: "name", required: true, description: "Kundens namn", example: "Telgebostäder AB" },
    { name: "organisation_number", required: false, description: "Organisationsnummer (10 eller 12 siffror)", example: "556123-4567" },
    { name: "type", required: false, description: "Kundtyp: company eller private", example: "company" },
    { name: "active", required: false, description: "1 = aktiv, 0 = inaktiv", example: "1" },
    { name: "email", required: false, description: "Allmän e-post", example: "info@telge.se" },
    { name: "email_invoice", required: false, description: "E-post för fakturor (e-faktura)", example: "faktura@telge.se" },
    { name: "your_reference", required: false, description: "Er referens / kontaktperson", example: "Anna Andersson" },
    { name: "phone1", required: false, description: "Telefonnummer", example: "08-123 45 67" },
    { name: "delivery_name", required: false, description: "Leveransnamn", example: "Telgebostäder AB" },
    { name: "delivery_address", required: false, description: "Leveransadress (gata)", example: "Storgatan 5" },
    { name: "delivery_zip_code", required: false, description: "Leveransadress – postnummer", example: "151 30" },
    { name: "delivery_city", required: false, description: "Leveransadress – ort", example: "Södertälje" },
    { name: "invoice_address", required: false, description: "Fakturaadress (gata)", example: "Box 123" },
    { name: "invoice_zip_code", required: false, description: "Fakturaadress – postnummer", example: "151 21" },
    { name: "invoice_city", required: false, description: "Fakturaadress – ort", example: "Södertälje" },
  ],
};

const FORTNOX_INVOICES: ImportTemplateDefinition = {
  key: "fortnox-fakturahistorik",
  fileName: "traivo-mall-fortnox-fakturahistorik.xlsx",
  sheetName: "Fakturarader",
  title: "Fortnox — Fakturahistorik",
  intro:
    "Fortnox-export av historiska fakturor (radnivå). Systemet identifierar återkommande artiklar " +
    "per kund (t.ex. samma städning varje månad) och föreslår tjänsteavtal.",
  columns: [
    { name: "InvoiceNumber", required: true, description: "Fakturanummer", example: "10042" },
    { name: "InvoiceDate", required: true, description: "Fakturadatum (YYYY-MM-DD)", example: "2025-01-31" },
    { name: "CustomerNumber", required: true, description: "Kundnummer i Fortnox", example: "1001" },
    { name: "CustomerName", required: false, description: "Kundnamn", example: "Telgebostäder AB" },
    { name: "ArticleNumber", required: false, description: "Artikelnummer (krävs om Description saknas)", example: "K100" },
    { name: "Description", required: false, description: "Artikelbeskrivning (krävs om ArticleNumber saknas)", example: "Kärltvätt Storgatan 5" },
    { name: "Quantity", required: false, description: "Antal (komma-decimal)", example: "4" },
    { name: "Price", required: false, description: "Styckpris (komma-decimal)", example: "156,56" },
    { name: "Total", required: false, description: "Radsumma (komma-decimal). Beräknas från pris × antal om tom.", example: "626,24" },
  ],
};

const FASTIGHETSLISTA: ImportTemplateDefinition = {
  key: "fastighetslista",
  fileName: "traivo-mall-fastighetslista.xlsx",
  sheetName: "Fastigheter",
  title: "Årlig fastighetslista från kund",
  intro:
    "Excel/CSV med kundens fastigheter (1-2 ggr/år). Systemet matchar på adress + ort och visar " +
    "nya, ändrade och saknade objekt. Kolumnnamn kan variera — vid uppladdning mappas dina kolumner mot fälten nedan.",
  columns: [
    { name: "Adress", required: true, description: "Gatuadress (gata + nummer)", example: "Storgatan 5" },
    { name: "Postnummer", required: false, description: "Postnummer", example: "151 30" },
    { name: "Ort", required: false, description: "Ort / postort", example: "Södertälje" },
    { name: "Objektnamn", required: false, description: "Fastighetsnamn (valfritt)", example: "Kvarteret Linden 3" },
    { name: "Fastighetsbeteckning", required: false, description: "Externt ID / fastighetsbeteckning (valfritt)", example: "LINDEN 3:5" },
  ],
};

const BARNOBJEKT: ImportTemplateDefinition = {
  key: "barnobjekt",
  fileName: "traivo-mall-barnobjekt.xlsx",
  sheetName: "Underobjekt",
  title: "Underobjekt (barnobjekt)",
  intro:
    "Lägg till nya underobjekt under ett befintligt föräldraobjekt. Adress, ort och postnummer " +
    "ärvs från föräldraobjektet om de utelämnas.",
  columns: [
    { name: "name", required: true, description: "Underobjektets namn", example: "Källare 1" },
    { name: "objectNumber", required: false, description: "Externt objektnummer (valfritt)", example: "10101" },
    { name: "hierarchyLevel", required: false, description: "Hierarkinivå (valfritt — ärvs annars)", example: "utrymme" },
    { name: "address", required: false, description: "Adress (ärvs från föräldraobjekt om tom)", example: "Storgatan 5" },
    { name: "city", required: false, description: "Ort (ärvs från föräldraobjekt om tom)", example: "Södertälje" },
    { name: "postalCode", required: false, description: "Postnummer (ärvs från föräldraobjekt om tom)", example: "151 30" },
  ],
};

// Task #578 — Tre-stegs import-wizard. Interim-IDn refereras mellan stegen.
const WIZARD_ORGANISATION: ImportTemplateDefinition = {
  key: "wizard-organisation",
  fileName: "traivo-mall-wizard-organisation.xlsx",
  sheetName: "Organisation",
  title: "Wizard steg 1 — Organisation",
  intro:
    "Första steget i tre-stegs import-wizarden: organisationsnoder (koncern, " +
    "region, BRF). Sätt ett interim-ID per rad (t.ex. ORG-1) som du sedan kan " +
    "referera i kolumnen 'Förälder (interim-ID)' i steg 2 (butiker) och steg 3 (fysiska objekt).",
  columns: [
    { name: "interim", label: "Interim-ID", required: true, description: "Tillfälligt ID som steg 2/3 refererar till", example: "ORG-1" },
    { name: "name", label: "Namn", required: true, description: "Namn på organisationsnoden", example: "Axfood AB" },
    { name: "hierarchyLevel", label: "Hierarkinivå", required: false, description: "koncern, brf, fastighet, rum, karl", example: "koncern" },
    { name: "parentInterim", label: "Förälder (interim-ID)", required: false, description: "Interim-ID för överordnad rad (tom = rot)", example: "" },
    { name: "address", label: "Adress", required: false, description: "Adress (valfritt)", example: "Solnavägen 4" },
    { name: "city", label: "Ort", required: false, description: "Ort (valfritt)", example: "Solna" },
    { name: "postalCode", label: "Postnummer", required: false, description: "Postnummer (valfritt)", example: "171 54" },
  ],
};

const WIZARD_STORES: ImportTemplateDefinition = {
  key: "wizard-stores",
  fileName: "traivo-mall-wizard-butiker.xlsx",
  sheetName: "Butiker",
  title: "Wizard steg 2 — Butiker",
  intro:
    "Andra steget: fysiska platser (butiker, fastigheter). 'Förälder (interim-ID)' " +
    "måste peka på en organisationsrad från steg 1. Adress, ort och postnummer " +
    "ärvs från överordnad organisation om de utelämnas.",
  columns: [
    { name: "interim", label: "Interim-ID", required: true, description: "Tillfälligt ID som steg 3 refererar till", example: "BUT-101" },
    { name: "name", label: "Namn", required: true, description: "Butikens/fastighetens namn", example: "Willys Solna" },
    { name: "parentInterim", label: "Förälder (interim-ID)", required: true, description: "Interim-ID från steg 1 (organisation)", example: "ORG-1" },
    { name: "objectNumber", label: "Objektnummer", required: false, description: "Externt objektnummer (valfritt)", example: "1001" },
    { name: "address", label: "Adress", required: false, description: "Adress (ärvs från organisation om tom)", example: "Solnavägen 4" },
    { name: "city", label: "Ort", required: false, description: "Ort (ärvs från organisation om tom)", example: "Solna" },
    { name: "postalCode", label: "Postnummer", required: false, description: "Postnummer (ärvs från organisation om tom)", example: "171 54" },
  ],
};

const WIZARD_EQUIPMENT: ImportTemplateDefinition = {
  key: "wizard-equipment",
  fileName: "traivo-mall-wizard-objekt.xlsx",
  sheetName: "Fysiska objekt",
  title: "Wizard steg 3 — Fysiska objekt",
  intro:
    "Tredje steget: utrustning/objekt inom butikerna (kärl, fettavskiljare, " +
    "soprum). 'Förälder (interim-ID)' måste peka på en butiksrad från steg 2. Adress " +
    "ärvs från överordnad butik om den utelämnas.",
  columns: [
    { name: "interim", label: "Interim-ID", required: false, description: "Tillfälligt ID (valfritt — endast om framtida steg behöver referera)", example: "OBJ-1" },
    { name: "name", label: "Namn", required: true, description: "Objektets namn", example: "Sopkärl 660L bak" },
    { name: "parentInterim", label: "Förälder (interim-ID)", required: true, description: "Interim-ID från steg 2 (butik)", example: "BUT-101" },
    { name: "objectNumber", label: "Objektnummer", required: false, description: "Externt objektnummer (valfritt)", example: "K-0001" },
    { name: "hierarchyLevel", label: "Hierarkinivå", required: false, description: "rum, karl, etc.", example: "karl" },
    { name: "address", label: "Adress", required: false, description: "Adress (ärvs från butik om tom)", example: "" },
    { name: "city", label: "Ort", required: false, description: "Ort (ärvs från butik om tom)", example: "" },
    { name: "postalCode", label: "Postnummer", required: false, description: "Postnummer (ärvs från butik om tom)", example: "" },
  ],
};

export const IMPORT_TEMPLATES: Record<ImportTemplateKey, ImportTemplateDefinition> = {
  "modus-objekt": MODUS_OBJEKT,
  "modus-tasks": MODUS_TASKS,
  "modus-events": MODUS_EVENTS,
  "modus-fakturarader": MODUS_INVOICE_LINES,
  "fortnox-kunder": FORTNOX_CUSTOMERS,
  "fortnox-fakturahistorik": FORTNOX_INVOICES,
  "fastighetslista": FASTIGHETSLISTA,
  "barnobjekt": BARNOBJEKT,
  "wizard-organisation": WIZARD_ORGANISATION,
  "wizard-stores": WIZARD_STORES,
  "wizard-equipment": WIZARD_EQUIPMENT,
};

export function getImportTemplate(key: string): ImportTemplateDefinition | null {
  return (IMPORT_TEMPLATES as Record<string, ImportTemplateDefinition>)[key] ?? null;
}
