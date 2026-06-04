import type { Article } from "@shared/schema";

// Gemensam helper: en artikel deriverar automatiskt till en föruppgift om den
// är av typen "beroende" eller har ett negativt offsetMinutes (utförs före
// huvuduppgiften). Återanvänds av Steg 6-guiden, orderkoncept-wizarden och
// artikellistan så att "Föruppgift"-badgen visas konsekvent.
export function deriveIsPreTask(article: Pick<Article, "articleType" | "offsetMinutes">): boolean {
  return article.articleType === "beroende" || (article.offsetMinutes ?? 0) < 0;
}
