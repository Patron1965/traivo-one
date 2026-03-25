import { db } from "./db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { articles, objects, metadataKatalog, metadataVarden } from "@shared/schema";
import { getObjectWithAllMetadata } from "./metadata-queries";

export type AssociationOperator = "equals" | "contains" | "starts_with" | "not_equals";

function matchValue(actual: string | null, expected: string, operator: AssociationOperator): boolean {
  if (actual == null) return false;
  const a = actual.toLowerCase().trim();
  const e = expected.toLowerCase().trim();
  switch (operator) {
    case "equals": return a === e;
    case "contains": return a.includes(e);
    case "starts_with": return a.startsWith(e);
    case "not_equals": return a !== e;
    default: return false;
  }
}

function extractDisplayValue(m: any): string | null {
  return m.vardeString ??
    (m.vardeInteger != null ? String(m.vardeInteger) : null) ??
    (m.vardeDecimal != null ? String(m.vardeDecimal) : null) ??
    (m.vardeBoolean != null ? String(m.vardeBoolean) : null) ??
    (m.vardeDatetime ? String(m.vardeDatetime) : null) ??
    m.vardeReferens ?? null;
}

export async function getMatchingArticlesForObject(
  objectId: string,
  tenantId: string
) {
  const objMeta = await getObjectWithAllMetadata(objectId, tenantId);
  if (!objMeta) return [];

  const allArticles = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.tenantId, tenantId),
        eq(articles.status, "active"),
        isNull(articles.deletedAt)
      )
    );

  const associationArticles = allArticles.filter(
    (a) => a.associationLabel && a.associationValue
  );

  const results: Array<{
    article: typeof allArticles[0];
    matchedLabel: string;
    matchedValue: string;
    objectValue: string | null;
    operator: string;
    inherited: boolean;
  }> = [];

  for (const art of associationArticles) {
    const label = art.associationLabel!;
    const expectedValue = art.associationValue!;
    const operator = (art.associationOperator || "equals") as AssociationOperator;

    const meta = objMeta.metadata.find(
      (m) => m.katalog.beteckning === label || m.katalog.namn === label
    );
    if (!meta) continue;

    const actualValue = extractDisplayValue(meta);
    if (matchValue(actualValue, expectedValue, operator)) {
      results.push({
        article: art,
        matchedLabel: label,
        matchedValue: expectedValue,
        objectValue: actualValue,
        operator,
        inherited: meta.objektId !== objectId,
      });
    }
  }

  return results;
}

export async function getMatchedObjectsForArticle(
  articleId: string,
  tenantId: string
) {
  const [article] = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.id, articleId),
        eq(articles.tenantId, tenantId)
      )
    );

  if (!article || !article.associationLabel || !article.associationValue) {
    return { article, matches: [] };
  }

  const label = article.associationLabel;
  const expectedValue = article.associationValue;
  const operator = (article.associationOperator || "equals") as AssociationOperator;

  const katalogRows = await db
    .select()
    .from(metadataKatalog)
    .where(
      and(
        eq(metadataKatalog.tenantId, tenantId),
        sql`(${metadataKatalog.beteckning} = ${label} OR ${metadataKatalog.namn} = ${label})`
      )
    );

  if (katalogRows.length === 0) {
    return { article, matches: [] };
  }

  const katalogIds = katalogRows.map((k) => k.id);

  const rows = await db
    .select({
      objektId: metadataVarden.objektId,
      vardeString: metadataVarden.vardeString,
      vardeInteger: metadataVarden.vardeInteger,
      vardeDecimal: metadataVarden.vardeDecimal,
      vardeBoolean: metadataVarden.vardeBoolean,
      vardeDatetime: metadataVarden.vardeDatetime,
      vardeReferens: metadataVarden.vardeReferens,
      objectName: objects.name,
      objectAddress: objects.address,
      objectType: objects.objectType,
    })
    .from(metadataVarden)
    .innerJoin(objects, eq(objects.id, metadataVarden.objektId))
    .where(
      and(
        eq(metadataVarden.tenantId, tenantId),
        eq(objects.status, "active"),
        isNull(objects.deletedAt),
        sql`${metadataVarden.metadataKatalogId} = ANY(${katalogIds})`
      )
    );

  const matches = rows
    .filter((r) => {
      const actual = extractDisplayValue(r);
      return matchValue(actual, expectedValue, operator);
    })
    .map((r) => ({
      objectId: r.objektId,
      objectName: r.objectName,
      objectAddress: r.objectAddress,
      objectType: r.objectType,
      metadataValue: extractDisplayValue(r),
    }));

  return { article, matches };
}

export async function testArticleAssociation(
  articleId: string,
  tenantId: string,
  label: string,
  value: string,
  operator: AssociationOperator
) {
  const katalogRows = await db
    .select()
    .from(metadataKatalog)
    .where(
      and(
        eq(metadataKatalog.tenantId, tenantId),
        sql`(${metadataKatalog.beteckning} = ${label} OR ${metadataKatalog.namn} = ${label})`
      )
    );

  if (katalogRows.length === 0) {
    return { matchCount: 0, matches: [], labelFound: false };
  }

  const katalogIds = katalogRows.map((k) => k.id);

  const rows = await db
    .select({
      objektId: metadataVarden.objektId,
      vardeString: metadataVarden.vardeString,
      vardeInteger: metadataVarden.vardeInteger,
      vardeDecimal: metadataVarden.vardeDecimal,
      vardeBoolean: metadataVarden.vardeBoolean,
      vardeDatetime: metadataVarden.vardeDatetime,
      vardeReferens: metadataVarden.vardeReferens,
      objectName: objects.name,
      objectAddress: objects.address,
    })
    .from(metadataVarden)
    .innerJoin(objects, eq(objects.id, metadataVarden.objektId))
    .where(
      and(
        eq(metadataVarden.tenantId, tenantId),
        eq(objects.status, "active"),
        isNull(objects.deletedAt),
        sql`${metadataVarden.metadataKatalogId} = ANY(${katalogIds})`
      )
    );

  const matches = rows
    .filter((r) => {
      const actual = extractDisplayValue(r);
      return matchValue(actual, value, operator);
    })
    .map((r) => ({
      objectId: r.objektId,
      objectName: r.objectName,
      objectAddress: r.objectAddress,
      metadataValue: extractDisplayValue(r),
    }));

  return {
    matchCount: matches.length,
    matches: matches.slice(0, 20),
    labelFound: true,
    labelName: katalogRows[0].namn,
    labelBeteckning: katalogRows[0].beteckning,
  };
}
