// Import 2.0 — delad fält-katalog och matchningsregler.
// Realiserar §4 (fälttyper/matchning), §6.3 (KNOWN_FIELDS) och §6.4
// (valideringsregler) i traivo_import_specification.
//
// Filen importeras av både klient (Matcha data-dialog) och server
// (auto-matchning + validering) så att en enda sanning gäller.

export type FieldCategory = "standard" | "address" | "contact" | "metadata";

export type ValidatorType =
  | "text"
  | "text_id"
  | "integer"
  | "decimal"
  | "email"
  | "phone"
  | "date"
  | "boolean"
  | "gps";

export interface FieldDefinition {
  /** API-nyckel, t.ex. "system_id", "address.street", "metadata.typ". */
  key: string;
  /** Svensk etikett för UI. */
  label: string;
  description: string;
  category: FieldCategory;
  type: ValidatorType;
  required: boolean;
}

// §6.3 — exakta matchningar (case-insensitive, mot rad 1 systemfältnamn).
export const KNOWN_FIELDS: Record<string, string> = {
  systemnummer: "system_id",
  systemföräldranummer: "system_parent_id",
  systemforaldranummer: "system_parent_id",
  objektnamn: "name",
  interimsnummer: "interim_id",
  interimföräldranummer: "interim_parent_id",
  interimforaldranummer: "interim_parent_id",
  __empty: "__empty",
  externt_id: "external_id",
  extern_id: "external_id",
  kund: "customer_name",
  kundnamn: "customer_name",
  "kund (namn)": "customer_name",
  kundnummer: "customer_ref",
  kundnr: "customer_ref",
  kundreferens: "customer_ref",
  "kund (kundnummer)": "customer_ref",
  leveransadress: "address.full",
  "delivery latitude": "position.lat",
  "delivery longitude": "position.lng",
};

// §6.3 — adress-punktnotation → sammansatt address-objekt.
export const ADDRESS_PATTERNS: Record<string, string> = {
  "adress.gata": "address.street",
  "adress.gatunummer": "address.street_number",
  "adress.postnummer": "address.postal_code",
  "adress.ort": "address.city",
};

// §6.3 — kontakt-punktnotation → sammansatt contact-objekt.
export const CONTACT_PATTERNS: Record<string, string> = {
  "kontaktperson.namn": "contact.name",
  "kontaktperson.titel": "contact.title",
  "kontaktperson.telefon": "contact.phone",
  "kontaktperson.epost": "contact.email",
  "kontaktperson.e-post": "contact.email",
  "e-post": "contact.email",
  epost: "contact.email",
};

// §6.4 — valideringsregler per fält.
export const FIELD_RULES: Record<string, { type: ValidatorType; required: boolean }> = {
  name: { type: "text", required: true },
  system_id: { type: "text_id", required: false },
  system_parent_id: { type: "text_id", required: false },
  interim_id: { type: "text_id", required: false },
  interim_parent_id: { type: "text_id", required: false },
  external_id: { type: "text_id", required: false },
  customer_name: { type: "text", required: false },
  customer_ref: { type: "text", required: false },
  "address.full": { type: "text", required: false },
  "address.street": { type: "text", required: false },
  "address.street_number": { type: "text", required: false },
  "address.postal_code": { type: "text", required: false },
  "address.city": { type: "text", required: false },
  "position.lat": { type: "gps", required: false },
  "position.lng": { type: "gps", required: false },
  "contact.name": { type: "text", required: false },
  "contact.title": { type: "text", required: false },
  "contact.phone": { type: "phone", required: false },
  "contact.email": { type: "email", required: false },
};

// §4.1 / §6.6 — fält-katalog för "Matcha data"-dialogen, grupperad per kategori.
export const FIELD_CATALOG: FieldDefinition[] = [
  // Standardfält
  { key: "system_id", label: "Systemnummer", description: "Traivos unika ID – ifyllt = uppdatera", category: "standard", type: "text_id", required: false },
  { key: "system_parent_id", label: "Systemföräldranummer", description: "Peka mot befintlig förälder", category: "standard", type: "text_id", required: false },
  { key: "name", label: "Objektnamn", description: "Obligatoriskt – namn på objektet", category: "standard", type: "text", required: true },
  { key: "interim_id", label: "Interimsnummer", description: "Temporärt ID för hierarki", category: "standard", type: "text_id", required: false },
  { key: "interim_parent_id", label: "Interimföräldranummer", description: "Temporär förälderreferens", category: "standard", type: "text_id", required: false },
  { key: "external_id", label: "externt_id", description: "Kundens egna referensnummer", category: "standard", type: "text_id", required: false },
  { key: "customer_name", label: "Kund (namn)", description: "Koppla raden till en kund via kundens namn", category: "standard", type: "text", required: false },
  { key: "customer_ref", label: "Kund (kundnummer)", description: "Koppla raden till en kund via kundnummer/org.nr", category: "standard", type: "text", required: false },
  { key: "__empty", label: "__EMPTY (ignorera)", description: "Ignorera kolumnen", category: "standard", type: "text", required: false },
  // Adressfält
  { key: "address.full", label: "Leveransadress", description: "Fullständig adress", category: "address", type: "text", required: false },
  { key: "address.street", label: "adress.gata", description: 'Underfält "gata" → address', category: "address", type: "text", required: false },
  { key: "address.street_number", label: "adress.gatunummer", description: 'Underfält "gatunummer" → address', category: "address", type: "text", required: false },
  { key: "address.postal_code", label: "adress.postnummer", description: 'Underfält "postnummer" → address', category: "address", type: "text", required: false },
  { key: "address.city", label: "adress.ort", description: 'Underfält "ort" → address', category: "address", type: "text", required: false },
  { key: "position.lat", label: "Delivery Latitude", description: "Latitud (WGS84)", category: "address", type: "gps", required: false },
  { key: "position.lng", label: "Delivery Longitude", description: "Longitud (WGS84)", category: "address", type: "gps", required: false },
  // Kontaktfält
  { key: "contact.name", label: "kontaktperson.namn", description: "Kontaktpersons namn", category: "contact", type: "text", required: false },
  { key: "contact.title", label: "kontaktperson.titel", description: "Titel/roll", category: "contact", type: "text", required: false },
  { key: "contact.phone", label: "kontaktperson.telefon", description: "Telefonnummer", category: "contact", type: "phone", required: false },
  { key: "contact.email", label: "kontaktperson.epost", description: "E-postadress", category: "contact", type: "email", required: false },
];

/** Alla kända API-nycklar (för fuzzy-matchning). */
export const ALL_KNOWN_KEYS: string[] = Array.from(
  new Set([
    ...Object.values(KNOWN_FIELDS),
    ...Object.values(ADDRESS_PATTERNS),
    ...Object.values(CONTACT_PATTERNS),
    ...FIELD_CATALOG.map((f) => f.key),
  ]),
);

/** Normaliserar en rubrik för matchning (trim + lowercase). */
export function normalizeHeader(header: string): string {
  return (header ?? "").trim().toLowerCase();
}

export interface ColumnMapping {
  /** API-nyckel eller fritt metadata.*-namn. */
  target: string;
  /** Kategori för UI-gruppering och skrivlogik. */
  type: FieldCategory;
  required?: boolean;
}

export type ColumnMappings = Record<string, ColumnMapping>;
