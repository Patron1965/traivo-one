import { db } from "./db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { articles, objects, metadataKatalog, metadataVarden, type AssociationCondition } from "@shared/schema";
import { getObjectWithAllMetadata, getObjectAtkomstFields } from "./metadata-queries";

// Task #835: utökade operatorer. greater/less = numerisk jämförelse om båda är tal,
// annars lexikografisk. has_value = fältet har ett (icke-tomt) värde ("ungefärlig träff").
export type AssociationOperator =
  | "equals" | "contains" | "starts_with" | "not_equals"
  | "greater" | "less" | "has_value";

function matchValue(actual: string | null, expected: string, operator: AssociationOperator): boolean {
  if (actual == null) return false;
  const a = actual.toLowerCase().trim();
  const e = expected.toLowerCase().trim();
  switch (operator) {
    case "equals": return a === e;
    case "contains": return a.includes(e);
    case "starts_with": return a.startsWith(e);
    case "not_equals": return a !== e;
    case "has_value": return a.length > 0;
    case "greater": {
      const na = parseFloat(a), ne = parseFloat(e);
      if (!isNaN(na) && !isNaN(ne)) return na > ne;
      return a > e;
    }
    case "less": {
      const na = parseFloat(a), ne = parseFloat(e);
      if (!isNaN(na) && !isNaN(ne)) return na < ne;
      return a < e;
    }
    default: return false;
  }
}

// ===== Task #835: konsoliderad regelmotor =====
// Ren legacy-fasthakningsmatchare, extraherad ordagrant från
// storage.getApplicableArticlesForObject. BÅDE storage-resolvern och regelmotorn
// (hook_level-villkor) anropar denna → paritet by construction.
export interface HookObjectContext {
  objectType: string;
  hierarchyLevel: string;
  accessCode?: string | null;
}

export function legacyHookMatch(
  ctx: HookObjectContext,
  hookLevelRaw: string,
  hookConditions?: Record<string, unknown> | null,
): boolean {
  const objectType = (ctx.objectType || "").toLowerCase();
  const hierarchyLevel = (ctx.hierarchyLevel || "").toLowerCase();

  const karlTypes = ["matavfall", "atervinning", "uj_hushallsavfall", "plastemballage", "restavfall"];
  const isKarl = karlTypes.includes(objectType) || hierarchyLevel === "karl";
  const isMatKarl = objectType === "matavfall" || objectType.includes("mat");
  const isRestKarl = objectType === "restavfall" || objectType.includes("rest");
  const isPlastKarl = objectType === "plastemballage" || objectType.includes("plast");

  const isFastighet = objectType === "fastighet" || hierarchyLevel === "fastighet";
  const isRum = ["rum", "soprum", "kok"].includes(objectType) || hierarchyLevel === "rum";
  const isBrf = hierarchyLevel === "brf";
  const isKoncern = hierarchyLevel === "koncern";

  const hasAccessCode = !!(ctx.accessCode && ctx.accessCode.trim() !== "");

  const getHierarchyPosition = (level: string): number => {
    if (level === "koncern") return 0;
    if (level === "brf") return 1;
    if (level === "fastighet") return 2;
    if (level === "rum") return 3;
    if (level === "karl" || level === "karl_mat" || level === "karl_rest" || level === "karl_plast") return 4;
    if (level === "kod") return -1;
    return -1;
  };
  const getCurrentObjectLevel = (): number => {
    if (isKoncern) return 0;
    if (isBrf) return 1;
    if (isFastighet) return 2;
    if (isRum) return 3;
    if (isKarl) return 4;
    return -1;
  };
  const currentLevel = getCurrentObjectLevel();

  const hookLevel = (hookLevelRaw || "").toLowerCase();
  if (!hookLevel) return false;
  const conditions = hookConditions || {};

  let levelMatches = false;
  if (hookLevel === "kod") {
    levelMatches = hasAccessCode;
  } else if (hookLevel === "karl_mat") {
    levelMatches = isMatKarl;
  } else if (hookLevel === "karl_rest") {
    levelMatches = isRestKarl;
  } else if (hookLevel === "karl_plast") {
    levelMatches = isPlastKarl;
  } else {
    const hookPosition = getHierarchyPosition(hookLevel);
    if (hookPosition >= 0 && currentLevel >= 0) {
      levelMatches = currentLevel >= hookPosition;
    }
  }
  if (!levelMatches) return false;

  if (Object.keys(conditions).length > 0) {
    if (conditions.container_type && conditions.container_type !== objectType) {
      return false;
    }
  }
  return true;
}

// Utvärderar en artikels associationRules (AND). Returnerar true bara om minst ett
// "hookande" villkor (hook_level/metadata) finns och alla villkor matchar.
// object_type-villkor påverkar EJ resolvern (objectTypes gjorde aldrig det) → hoppas över.
export function evaluateArticleAssociationRules(
  rules: AssociationCondition[] | null | undefined,
  ctx: { hook: HookObjectContext; lookupMeta: (label: string) => string | null },
): boolean {
  if (!Array.isArray(rules) || rules.length === 0) return false;
  const hookingConds = rules.filter((c) => c.source === "hook_level" || c.source === "metadata");
  if (hookingConds.length === 0) return false;
  for (const cond of hookingConds) {
    if (cond.source === "hook_level") {
      if (!legacyHookMatch(ctx.hook, cond.level, cond.conditions as Record<string, unknown> | undefined)) {
        return false;
      }
    } else if (cond.source === "metadata") {
      const actual = ctx.lookupMeta(cond.label);
      const op = (cond.operator || "equals") as AssociationOperator;
      if (op === "has_value") {
        if (!(actual != null && actual.trim() !== "")) return false;
      } else {
        if (!matchValue(actual, cond.value ?? "", op)) return false;
      }
    }
  }
  return true;
}

export function extractDisplayValue(m: any): string | null {
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

  // Task #835: hämta objektets intrinsiska fält för hook_level-villkor.
  // Etapp 5: åtkomstkod läses ur metadata (systemområdet Åtkomst), ej objektkolumn.
  const [objRow] = await db
    .select({
      objectType: objects.objectType,
      hierarchyLevel: objects.hierarchyLevel,
    })
    .from(objects)
    .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));
  const atkomst = await getObjectAtkomstFields(objectId, tenantId, objMeta ?? undefined);
  const hookCtx: HookObjectContext = {
    objectType: objRow?.objectType || "",
    hierarchyLevel: objRow?.hierarchyLevel || "",
    accessCode: atkomst.portkod,
  };

  const findMeta = (label: string) =>
    objMeta.metadata.find((m) => m.katalog.beteckning === label || m.katalog.namn === label);
  const lookupMeta = (label: string): string | null => {
    const m = findMeta(label);
    return m ? extractDisplayValue(m) : null;
  };

  // Bara artiklar som faktiskt har en matchningsregel (ny eller legacy).
  const associationArticles = allArticles.filter(
    (a) =>
      (Array.isArray(a.associationRules) && (a.associationRules as AssociationCondition[]).length > 0) ||
      (a.associationLabel && a.associationValue)
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
    const rules = (art.associationRules as AssociationCondition[] | null) || [];
    if (rules.length > 0) {
      // Ny multi-AND-väg. Visa första metadata-villkoret som representativ träff.
      if (!evaluateArticleAssociationRules(rules, { hook: hookCtx, lookupMeta })) continue;
      const firstMeta = rules.find((c) => c.source === "metadata") as
        | Extract<AssociationCondition, { source: "metadata" }>
        | undefined;
      const repLabel = firstMeta?.label ?? "";
      const repMeta = repLabel ? findMeta(repLabel) : undefined;
      results.push({
        article: art,
        matchedLabel: repLabel,
        matchedValue: firstMeta?.value ?? "",
        objectValue: repMeta ? extractDisplayValue(repMeta) : null,
        operator: firstMeta?.operator ?? "equals",
        inherited: repMeta ? repMeta.objektId !== objectId : false,
      });
      continue;
    }

    // Legacy enkel-villkorsväg (back-compat under expand-fasen).
    const label = art.associationLabel!;
    const expectedValue = art.associationValue!;
    const operator = (art.associationOperator || "equals") as AssociationOperator;
    const meta = findMeta(label);
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
