/**
 * Adress-normalisering för avstämning av kund-fastighetslistor mot Traivos
 * objekt. Returnerar en stabil nyckel som ignorerar typografi-variationer
 * (gemener/versaler, avslutande punkt, tomma extra mellanslag, svenska tecken),
 * samt expanderar vanliga svenska gatu-förkortningar (g. → gatan, v. → vägen).
 *
 * Nyckelformat: "<normaliserad-adress>|<ort>"  (postnummer används bara om ort
 * saknas, eftersom samma gatuadress nästan aldrig finns i två olika orter med
 * olika postnummer i Sveriges officiella adressregister).
 */

export interface AddressParts {
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
}

const STREET_ABBREVIATIONS: Record<string, string> = {
  "g": "gatan",
  "g.": "gatan",
  "gt": "gatan",
  "gt.": "gatan",
  "v": "vagen",
  "v.": "vagen",
  "vg": "vagen",
  "vg.": "vagen",
  "st": "stora",
  "st.": "stora",
  "lill": "lilla",
};

function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae");
}

function expandTokens(tokens: string[]): string[] {
  return tokens.map((t) => STREET_ABBREVIATIONS[t] ?? t);
}

/**
 * Normalisera en gatuadress: små bokstäver, ta bort diakritiska tecken,
 * expandera kända förkortningar, kollapsa whitespace, ta bort skiljetecken.
 * Bevara siffror och gatu-nummer (inkl. bokstavs-suffix som "12B", "5-7").
 */
export function normalizeStreetAddress(address: string | null | undefined): string {
  if (!address) return "";
  let s = String(address).trim().toLowerCase();
  if (!s) return "";
  s = stripDiacritics(s);
  // Splitta sammanhängande gatu-förkortningar med punkt: "storg." → "stor g.",
  // så att den efterföljande token-expansionen kan översätta "g." → "gatan".
  s = s.replace(/([a-z])(gt|vg|g|v)\.(?=\s|$)/g, "$1 $2.");
  // Behåll bokstäver, siffror, mellanslag, bindestreck (för "12-14") och snedstreck.
  // Punkt/komma/parentes etc tas bort.
  s = s.replace(/[^a-z0-9 \-/]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  const tokens = s.split(" ").filter(Boolean);
  let out = expandTokens(tokens).join(" ");
  // Slå ihop husnummer + bokstavs-suffix separerat av mellanslag:
  // "12 a" → "12a", "12 - 14" hanteras separat (bindestreck behålls).
  out = out.replace(/(\d)\s+([a-z])\b/g, "$1$2");
  // Slå ihop husnummer + bindestreck + nummer/bokstav med extra spaces:
  // "12 - 14" → "12-14"
  out = out.replace(/(\d)\s*-\s*([0-9a-z])/g, "$1-$2");
  return out;
}

export function normalizeCity(city: string | null | undefined): string {
  if (!city) return "";
  let s = String(city).trim().toLowerCase();
  if (!s) return "";
  s = stripDiacritics(s);
  s = s.replace(/[^a-z0-9 \-]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function normalizePostalCode(postal: string | null | undefined): string {
  if (!postal) return "";
  return String(postal).replace(/\D/g, "");
}

/**
 * Bygg en jämförelsenyckel av en adress. Tom sträng om adress saknas
 * (kan ej matchas).
 */
export function normalizeAddressKey(parts: AddressParts): string {
  const addr = normalizeStreetAddress(parts.address);
  if (!addr) return "";
  const city = normalizeCity(parts.city);
  if (city) return `${addr}|${city}`;
  const zip = normalizePostalCode(parts.postalCode);
  if (zip) return `${addr}|zip:${zip}`;
  // Ingen ort eller postnummer — använd bara adressen. Inte unikt mellan orter,
  // men för en enskild kund där alla objekt ligger i samma kommun är detta OK.
  return addr;
}
