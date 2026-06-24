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
