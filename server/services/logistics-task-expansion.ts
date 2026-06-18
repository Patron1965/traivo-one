// Task #989: Lager- & återtagslogik i uppgiftsmotorn — rena hjälpfunktioner.
//
// Generisk "var-är-uppgiften"-intelligens som delas av orderkoncept-expansion
// (assignments) och fältappens retur-/hämtflöde (work_orders). Inga DB-anrop här
// så att logiken är enkel att enhetstesta och inte kan divergera mellan call-sites.
//
// Grundregel: en varuartikel med en lagerplats måste först HÄMTAS på lagret och
// sedan LEVERERAS på objektet. Hämtuppgiften ligger före leveransuppgiften i tid.
// Saknas lagerplats sker ingen split — exakt dagens beteende (expand-contract).

import type { Article } from "@shared/schema";

export type LogisticsRole = "pickup" | "deliver" | "return";

// Endast de fält vi faktiskt läser — så att även "tunna" artikel-objekt
// (t.ex. enrichade orderrader) kan skickas in utan hela Article-typen.
type StockArticleFields = Pick<
  Article,
  "articleType" | "stockLocation" | "stockLatitude" | "stockLongitude"
>;
type LeadTimeFields = Pick<Article, "dependencyMinutesBefore" | "leadTimeDays">;

export type TaskGeo = {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

// Default-ledtid (minuter) som hämtuppgiften läggs före leveransuppgiften när
// artikeln inte anger något eget värde. 120 min = samma storleksordning som
// befintliga för-/beroendeuppgifter och ger fältet marginal att hämta först.
export const DEFAULT_PICKUP_LEAD_MINUTES = 120;

// En artikel kan hämtas på en lagerplats om den har både en namngiven plats och
// giltiga koordinater (annars går uppgiften inte att rutta/leverera korrekt).
export function articleHasStockLocation(
  article: Partial<StockArticleFields> | null | undefined,
): boolean {
  return (
    !!article &&
    typeof article.stockLocation === "string" &&
    article.stockLocation.trim().length > 0 &&
    article.stockLatitude != null &&
    article.stockLongitude != null
  );
}

// "Varuartikel med lagerplats" — orderkoncept-expansion ska då dela uppgiften i
// hämta@lager + leverera@objekt. Endast articleType === "vara" splittas; tjänster,
// kontroller och beroendeartiklar lämnas orörda (beroende har sitt eget flöde).
export function shouldSplitForStockPickup(
  article: Partial<StockArticleFields> | null | undefined,
): boolean {
  return (
    !!article &&
    article.articleType === "vara" &&
    articleHasStockLocation(article)
  );
}

// Platsen för en hämt-/retur-uppgift = artikelns lagerplats.
export function resolveStockLocation(
  article: Partial<StockArticleFields> | null | undefined,
): TaskGeo {
  return {
    address: article?.stockLocation ?? null,
    latitude: article?.stockLatitude ?? null,
    longitude: article?.stockLongitude ?? null,
  };
}

// Antal minuter som hämtuppgiften ska ligga FÖRE leveransuppgiften. Återanvänder
// artikelns dependencyMinutesBefore (samma fält som beroendeuppgifter), faller
// annars tillbaka på DEFAULT_PICKUP_LEAD_MINUTES. Alltid > 0.
export function resolvePickupLeadMinutes(
  article: Partial<LeadTimeFields> | null | undefined,
): number {
  const explicit = Number(article?.dependencyMinutesBefore ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return DEFAULT_PICKUP_LEAD_MINUTES;
}

// Schemalagt datum för hämtuppgiften givet leveransuppgiftens datum. Returnerar
// undefined om leveransdatum saknas (då lämnas hämtuppgiften också oschemalagd).
export function computePickupDate(
  deliverDate: Date | null | undefined,
  article: Partial<LeadTimeFields> | null | undefined,
): Date | undefined {
  if (!deliverDate) return undefined;
  const lead = resolvePickupLeadMinutes(article);
  return new Date(deliverDate.getTime() - lead * 60_000);
}
