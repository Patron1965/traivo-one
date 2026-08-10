// ============================================================================
// KANONISKA SYSTEMLÅSTA GEOGRAFI-FÄLT (Task #1438)
// ----------------------------------------------------------------------------
// Dessa katalogfält (lower(namn) = kanonisk nyckel) utgör objektets geografi-
// modell och visas ENBART i den samlade Geografi-sektionen på objektsidan
// (ObjectDomainGrid). De ska därför exkluderas ur den generiska metadata-
// karusellen (ObjectMetadataBody) — annars visas samma värde två gånger.
// Speglar server-sidans SYSTEMLASTA_GEO_FALT (server/metadata-queries.ts).
// ============================================================================

export const CANONICAL_GEO_FIELD_KEYS = new Set([
  "gatuadress",
  "postnummer",
  "postort",
  "koordinater",
  "fördjupad position",
  "avdelning/port/våning",
]);

/** true om katalogfältet (via namn) är ett kanoniskt systemlåst geografifält. */
export function isCanonicalGeoFieldName(namn: string | null | undefined): boolean {
  if (!namn) return false;
  return CANONICAL_GEO_FIELD_KEYS.has(namn.trim().toLowerCase());
}
