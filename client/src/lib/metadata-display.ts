// Presentationsnamn för ett metadatafält.
//
// `namn` är den IMMUTABLA, skiftlägeskänsliga universella matchningsnyckeln
// (import/order-koncept/villkorsfilter/sök) och får aldrig redigeras fritt.
// `visningsnamn` är ett fritt redigerbart presentationsnamn (rätt versalisering/
// stavning) som ENDAST styr hur fältet renderas i UI. Använd alltid denna helper
// när ett fältnamn visas för användaren — aldrig för matchning/lookup.
//
// Fallback: när `visningsnamn` saknas visas `namn` med understreck → mellanslag,
// vilket bevarar den tidigare renderingen (`namn.replace(/_/g, ' ')`).
export function metadataDisplayName(
  k?: { visningsnamn?: string | null; namn?: string | null } | null,
): string {
  if (!k) return "";
  const v = k.visningsnamn?.trim();
  if (v) return v;
  return (k.namn ?? "").replace(/_/g, " ");
}

// Datatyp → svensk etikett. Delad källa så väljarlistor och DATATYPE_META
// (med ikoner) inte divergerar.
export const METADATA_DATATYPE_LABELS: Record<string, string> = {
  string: "Text",
  code: "Kod",
  integer: "Heltal",
  decimal: "Tal",
  interval: "Intervall",
  boolean: "Ja/Nej",
  datetime: "Datum",
  json: "Struktur",
  location: "Plats",
  referens: "Referens",
  image: "Bild",
  file: "Fil",
};

// Enhetlig etikett för en metadatatyp i "Lägg till metadata"-väljare.
// Bygger: "{nummer}. {Visningsnamn} (kategori) · datatyp".
// Använder metadataDisplayName för namn (visningsnamn → namn med
// understreck→mellanslag) så båda väljarna formaterar identiskt.
export function metadataTypeOptionLabel(
  t?: {
    visningsnamn?: string | null;
    namn?: string | null;
    kategori?: string | null;
    datatyp?: string | null;
    displayNumber?: number | null;
  } | null,
): string {
  if (!t) return "";
  const prefix = t.displayNumber != null ? `${t.displayNumber}. ` : "";
  const name = metadataDisplayName(t);
  const displayName = name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
  const kategori = t.kategori ? ` (${t.kategori})` : "";
  const dtHint =
    t.datatyp && METADATA_DATATYPE_LABELS[t.datatyp]
      ? ` · ${METADATA_DATATYPE_LABELS[t.datatyp].toLowerCase()}`
      : "";
  return `${prefix}${displayName}${kategori}${dtHint}`;
}
