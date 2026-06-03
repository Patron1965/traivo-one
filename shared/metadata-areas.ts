// Task #674: Område är det ENDA grupperingsfältet i det svenska metadata-systemet
// (metadataKatalog). Listan absorberar de gamla "kategori"-värdena: KINAB-
// affärsområden först, därefter de tekniska/legacy-kategorierna. Ordningen styr
// både väljaren i redigeringsvyn och grupperingens visningsordning i objekt- och
// inställningsvyn. Den gamla `kategori`-kolumnen behålls (expand-contract) men
// används inte längre för gruppering — håll därför denna lista som den enda
// källan till sanning för områdesetiketter/ordning så att inget migrerat värde
// visas som rå nyckel.

export interface MetadataAreaOption {
  value: string;
  label: string;
}

export const METADATA_AREA_OPTIONS: MetadataAreaOption[] = [
  { value: "grunduppgifter", label: "Grunduppgifter" },
  { value: "produktion", label: "Produktion" },
  { value: "status", label: "Status" },
  { value: "ekonomi", label: "Ekonomi" },
  { value: "geografi", label: "Geografi" },
  { value: "kontakt", label: "Kontaktinformation" },
  { value: "kundreferens", label: "Kundreferens" },
  { value: "administrativ", label: "Administration" },
  { value: "artikel", label: "Artiklar & Priser" },
  { value: "leverans", label: "Leverans" },
  { value: "kvantitet", label: "Kvantiteter" },
  { value: "tid", label: "Tid & Schemaläggning" },
  { value: "klassificering", label: "Klassificering" },
  { value: "atkomst", label: "Åtkomst" },
  { value: "betyg", label: "Betyg" },
  { value: "beskrivning", label: "Beskrivningar" },
  { value: "bilagor", label: "Bilagor" },
  { value: "kärl", label: "Kärl" },
  { value: "importerad", label: "Importerad" },
  { value: "annat", label: "Övrigt" },
];

export const METADATA_AREA_ORDER: string[] = METADATA_AREA_OPTIONS.map((o) => o.value);

export const METADATA_AREA_LABELS: Record<string, string> = Object.fromEntries(
  METADATA_AREA_OPTIONS.map((o) => [o.value, o.label]),
);

// Returnerar en visningsetikett för ett områdesvärde. Tom/okänd nyckel faller
// tillbaka till "Övrigt" (tomt) respektive råvärdet (okänt) så att inget fält
// blir osynligt.
export function metadataAreaLabel(key: string | null | undefined): string {
  if (!key) return "Övrigt";
  return METADATA_AREA_LABELS[key] ?? key;
}
