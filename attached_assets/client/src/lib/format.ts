/**
 * Centraliserade formateringshjälpare för Traivo-klienten.
 *
 * VIKTIGT om valuta: prisfält i databasen lagras i ÖRE (cachedValue,
 * cachedCost, resolvedPrice, listPrice, etc). Använd `formatSekFromOre`
 * för dessa. För fält som redan är i kronor (Fleet, Invoice-summor som
 * passerat backend-konvertering) använd `formatSek`.
 */

const sekFormatter = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  maximumFractionDigits: 0,
});

const sekFormatterWithDecimals = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
});

/** Formaterar ett kronor-belopp som "1 234 kr". */
export function formatSek(kronor: number | null | undefined, opts?: { decimals?: boolean; emptyDash?: boolean }): string {
  if (kronor == null) return opts?.emptyDash ? "-" : "0 kr";
  const fmt = opts?.decimals ? sekFormatterWithDecimals : sekFormatter;
  return fmt.format(kronor);
}

/** Formaterar ett öres-belopp (databasens lagrade prisfält) som "1 234 kr". */
export function formatSekFromOre(ore: number | null | undefined, opts?: { decimals?: boolean; emptyDash?: boolean }): string {
  if (ore == null) return opts?.emptyDash ? "-" : "0 kr";
  const kronor = ore / 100;
  const fmt = opts?.decimals ? sekFormatterWithDecimals : sekFormatter;
  return fmt.format(kronor);
}
