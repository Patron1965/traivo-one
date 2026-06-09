/**
 * Task #835 — data-agnostiskt paritetstest för artikel-associationsregler.
 *
 * Varför: KINAB-prod har representativ artikel/objekt-data; dev-DB:n har det inte.
 * Därför jämför detta skript legacy-fasthakningsmatchning mot den nya regelbaserade
 * resolvern PER OBJEKT, BEGRÄNSAT till artiklar som hade en hookLevel (de enda som
 * fanns i legacy-resolvern). De måste ge identiskt resultat — annars har migreringen
 * (0075) eller regelmotorn ändrat prod-matchning, vilket inte får ske tyst.
 *
 * Association-only-artiklar (hade association_label men ingen hookLevel) är AVSIKTLIGT
 * uteslutna: de dyker nytt upp i resolvern som en del av Fas 2-konsolideringen och är
 * inte en paritetsavvikelse.
 *
 * Körs i post-merge mot prod (icke-blockerande varning) och kan köras manuellt som grind
 * (exit 1 vid avvikelse) inför Fas 3 (Task #836) när gamla kolumner ska tas bort.
 *
 * Användning: npx tsx scripts/article-association-parity-check.ts
 */
import { db } from "../server/db";
import { articles, objects, type AssociationCondition } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  legacyHookMatch,
  evaluateArticleAssociationRules,
  extractDisplayValue,
  type HookObjectContext,
} from "../server/association-service";
import { getObjectWithAllMetadata } from "../server/metadata-queries";

async function main() {
  const allArticles = await db.select().from(articles).where(isNull(articles.deletedAt));

  const byTenant = new Map<string, typeof allArticles>();
  for (const a of allArticles) {
    const list = byTenant.get(a.tenantId) ?? [];
    list.push(a);
    byTenant.set(a.tenantId, list);
  }

  let comparisons = 0;
  let deviations = 0;

  for (const [tenantId, tArticles] of byTenant) {
    // Endast artiklar som hade en hookLevel var i legacy-resolvern → paritetens omfång.
    const hookArticles = tArticles.filter((a) => a.hookLevel && a.hookLevel.trim() !== "");
    if (hookArticles.length === 0) continue;

    const tObjects = await db
      .select()
      .from(objects)
      .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));

    const needsMeta = hookArticles.some(
      (a) =>
        Array.isArray(a.associationRules) &&
        (a.associationRules as AssociationCondition[]).some((c) => c.source === "metadata"),
    );

    for (const obj of tObjects) {
      const hookCtx: HookObjectContext = {
        objectType: obj.objectType || "",
        hierarchyLevel: obj.hierarchyLevel || "",
        accessCode: obj.accessCode ?? null,
      };

      let lookupMeta: (label: string) => string | null = () => null;
      if (needsMeta) {
        const om = await getObjectWithAllMetadata(obj.id, tenantId);
        const list = om?.metadata ?? [];
        lookupMeta = (label: string) => {
          const m = list.find(
            (mm: any) => mm.katalog.beteckning === label || mm.katalog.namn === label,
          );
          return m ? extractDisplayValue(m) : null;
        };
      }

      for (const art of hookArticles) {
        comparisons++;
        const legacy = legacyHookMatch(
          hookCtx,
          art.hookLevel!,
          art.hookConditions as Record<string, unknown> | null,
        );
        const rules = (art.associationRules as AssociationCondition[] | null) || [];
        const next =
          rules.length > 0
            ? evaluateArticleAssociationRules(rules, { hook: hookCtx, lookupMeta })
            : legacy;
        if (legacy !== next) {
          deviations++;
          console.error(
            `[parity] AVVIKELSE tenant=${tenantId} object=${obj.id} (${obj.objectType}/${obj.hierarchyLevel}) ` +
              `article=${art.articleNumber} legacy=${legacy} ny=${next} rules=${JSON.stringify(rules)}`,
          );
        }
      }
    }
  }

  console.log(`[parity] jämförelser=${comparisons} avvikelser=${deviations}`);
  if (deviations > 0) {
    console.error(`[parity] ✗ ${deviations} avvikelser — paritet bruten mellan legacy och regelbaserad resolver.`);
    process.exit(1);
  }
  console.log(`[parity] ✓ paritet OK — legacy == regelbaserad resolver för alla hookLevel-artiklar.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[parity] fel:", e);
  process.exit(1);
});
