// Hierarkiskt visningsnamn ("släktnamn") för objekt — task #552 krav (A).
// Bygger ett namn som "Stockholm › BRF Gamla Stan › Hus A › Källare 1" baserat
// på tenant-konfigurerade regler i `tenants.settings.displayNameRules`.
//
// Designval: ingen separat kolumn — beräknas on-read. För massvyer (listor)
// kan UI fortfarande visa `object.name`; visningsnamnet är opt-in per vy.
//
// Multi-förälder (task #619): ett objekt kan ha flera föräldrar via
// `object_parents`. Släktnamnet kan därför generera ETT namn per förälderkedja.
// Den PRIMÄRA kedjan (object_parents.isPrimary, som speglar objects.parentId)
// väljs som standardvisning. computeDisplayName/Batch fortsätter följa den
// primära kedjan (parentId) för list-/massvyer; computeObjectDisplayNames ger
// alla alternativa släktnamn för detaljvyer.
import { db } from "../db";
import { objects, objectParents, tenants, displayNameRulesSchema, type DisplayNameRules } from "@shared/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { objectOwnMetadataTextValueSql } from "./object-metadata-sql";

const DEFAULT_RULES: DisplayNameRules = {
  enabled: false,
  separator: " › ",
  maxDepth: 3,
  includeLevels: [],
  skipDuplicateNames: true,
};

export async function getDisplayNameRules(tenantId: string): Promise<DisplayNameRules> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const raw = (tenant?.settings as Record<string, unknown> | null | undefined)?.displayNameRules;
  if (!raw) return DEFAULT_RULES;
  const parsed = displayNameRulesSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_RULES;
}

export async function saveDisplayNameRules(tenantId: string, rules: DisplayNameRules): Promise<DisplayNameRules> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const current = (tenant?.settings as Record<string, unknown> | null | undefined) ?? {};
  const merged = { ...current, displayNameRules: rules };
  await db.update(tenants).set({ settings: merged as any }).where(eq(tenants.id, tenantId));
  return rules;
}

type MinimalObject = {
  id: string;
  name: string;
  parentId: string | null;
  hierarchyLevel: string | null;
  nameTranslations: Record<string, string> | null;
};

// Task #634: normalisera språkkod (2–3 bokstäver, gemener) — annars ignoreras.
export function normalizeLanguage(lang: string | null | undefined): string | undefined {
  if (!lang) return undefined;
  const l = lang.trim().toLowerCase();
  return /^[a-z]{2,3}$/.test(l) ? l : undefined;
}

function coerceTranslations(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k.trim().toLowerCase()] = v;
  }
  return Object.keys(out).length ? out : null;
}

// Task #634: lokaliserat namn för en nod — väljer språk-metadatat om satt,
// annars det interna namnet (kolumn E). Aldrig tomt-strängar om internt finns.
function localizedName(o: MinimalObject, language?: string): string {
  if (language && o.nameTranslations) {
    const hit = o.nameTranslations[language];
    if (hit && hit.trim()) return hit;
  }
  return o.name ?? "";
}

// Task #1486: nivån (hierarchyLevel) för släktnamns-filtrering (includeLevels)
// härleds ur klassificerings-metadatat "Anläggningstyp" (objektets EGNA rad,
// aldrig ärvt) — legacy-kolumnen objects.hierarchy_level är borttagen.
const OBJECT_NAME_COLUMNS = {
  id: objects.id,
  name: objects.name,
  parentId: objects.parentId,
  hierarchyLevel: objectOwnMetadataTextValueSql("Anläggningstyp"),
  nameTranslations: objects.nameTranslations,
} as const;

function toMinimal(o: {
  id: string; name: string | null; parentId: string | null; hierarchyLevel: string | null; nameTranslations: unknown;
}): MinimalObject {
  return {
    id: o.id,
    name: o.name ?? "",
    parentId: o.parentId ?? null,
    hierarchyLevel: o.hierarchyLevel ?? null,
    nameTranslations: coerceTranslations(o.nameTranslations),
  };
}

export async function computeDisplayName(
  objectId: string,
  tenantId: string,
  rules?: DisplayNameRules,
  language?: string,
): Promise<string> {
  const r = rules ?? (await getDisplayNameRules(tenantId));
  const lang = normalizeLanguage(language);
  const [objRaw] = await db
    .select(OBJECT_NAME_COLUMNS)
    .from(objects)
    .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));
  if (!objRaw) return "";
  const obj = toMinimal(objRaw);
  if (!r.enabled) return localizedName(obj, lang);

  const chain: MinimalObject[] = [obj];
  let cursor: string | null = obj.parentId;
  let guard = 0;
  while (cursor && guard < 8) {
    const [parentRaw] = await db
      .select(OBJECT_NAME_COLUMNS)
      .from(objects)
      .where(and(eq(objects.id, cursor), eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
    if (!parentRaw) break;
    const parent = toMinimal(parentRaw);
    chain.push(parent);
    cursor = parent.parentId;
    guard++;
  }
  // chain[0] = barnet, chain[n] = roten. Bygg uppifrån.
  let parts = chain.slice().reverse().map(o => ({ name: localizedName(o, lang), level: o.hierarchyLevel ?? "" }));
  if (r.includeLevels.length > 0) {
    parts = parts.filter((p, idx) => idx === parts.length - 1 || r.includeLevels.includes(p.level));
  }
  if (r.skipDuplicateNames) {
    parts = parts.filter((p, idx, arr) => idx === 0 || p.name !== arr[idx - 1].name);
  }
  if (parts.length > r.maxDepth) {
    parts = parts.slice(parts.length - r.maxDepth);
  }
  return parts.map(p => p.name).filter(Boolean).join(r.separator);
}

// Gemensam formatterare: tar en sökväg rot→barn och bygger släktnamnet enligt
// reglerna (includeLevels, skipDuplicateNames, maxDepth, separator).
function formatChain(
  rootToChild: { name: string; level: string }[],
  r: DisplayNameRules,
): string {
  let parts = rootToChild.slice();
  if (r.includeLevels.length > 0) {
    parts = parts.filter((p, idx) => idx === parts.length - 1 || r.includeLevels.includes(p.level));
  }
  if (r.skipDuplicateNames) {
    parts = parts.filter((p, idx, arr) => idx === 0 || p.name !== arr[idx - 1].name);
  }
  if (parts.length > r.maxDepth) {
    parts = parts.slice(parts.length - r.maxDepth);
  }
  return parts.map(p => p.name).filter(Boolean).join(r.separator);
}

// En enskild förälderkedja (släktnamn) för ett objekt.
export type DisplayNameChain = {
  // Den direkta föräldern som inleder kedjan (null = legacy/ingen förälder).
  parentId: string | null;
  relationContext: string | null;
  isPrimary: boolean;
  // Färdigt släktnamn enligt tenant-regler.
  name: string;
  // Full sökväg rot→objekt (för expanderbar visning, ej avkortad).
  path: { id: string; name: string; level: string }[];
};

export type ObjectDisplayNames = {
  // Primärt släktnamn (default-visning) — primär kedja, eller objektets eget
  // namn om regler är avstängda eller objektet saknar föräldrar.
  primary: string;
  // Alla släktnamn, ett per direkt förälder. Primär kedja först.
  chains: DisplayNameChain[];
  // Task #634: vilket språk som detta svar lokaliserades mot (undefined = internt).
  language?: string;
  // Task #634: objektets egna språkmärkta visningsnamn (lang → namn) — för UI:s
  // språkväljare. Påverkar aldrig kolumn E.
  translations?: Record<string, string>;
  // Task #634: tillgängliga språk i kedjan (objektets + föräldrarnas), sorterade.
  languages?: string[];
  // Om tenantens släktnamns-regler (displayNameRules.enabled) är påslagna. När
  // false beräknas inga kedjor (chains=[]) — UI:t använder detta för att skilja
  // "avstängt i inställningar" från "saknar förälder".
  rulesEnabled: boolean;
};

// Multi-förälder (task #619): bygg ett släktnamn per direkt förälder via
// `object_parents`. Den primära kedjan väljs som default. Uppåt i hierarkin
// följs varje förälders PRIMÄRA relation (eller legacy parentId) så att varje
// kedja blir deterministisk.
export async function computeObjectDisplayNames(
  objectId: string,
  tenantId: string,
  rules?: DisplayNameRules,
  language?: string,
): Promise<ObjectDisplayNames> {
  const r = rules ?? (await getDisplayNameRules(tenantId));
  const lang = normalizeLanguage(language);

  const all = await db
    .select(OBJECT_NAME_COLUMNS)
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
  const byId = new Map<string, MinimalObject>(all.map(o => [o.id, toMinimal(o)]));

  const start = byId.get(objectId);
  if (!start) return { primary: "", chains: [], language: lang, rulesEnabled: r.enabled };
  const selfName = localizedName(start, lang);
  const translations = start.nameTranslations ?? undefined;
  if (!r.enabled) return { primary: selfName, chains: [], language: lang, translations, rulesEnabled: false };

  // object_parents per barn → relationer.
  const relRows = await db
    .select({
      objectId: objectParents.objectId,
      parentId: objectParents.parentId,
      isPrimary: objectParents.isPrimary,
      relationContext: objectParents.relationContext,
    })
    .from(objectParents)
    .where(eq(objectParents.tenantId, tenantId));
  const relsByChild = new Map<string, { parentId: string; isPrimary: boolean; relationContext: string | null }[]>();
  for (const row of relRows) {
    const arr = relsByChild.get(row.objectId) ?? [];
    arr.push({ parentId: row.parentId, isPrimary: row.isPrimary, relationContext: row.relationContext });
    relsByChild.set(row.objectId, arr);
  }

  // Välj uppåt-förälder för en nod: primär relation > första relation > legacy parentId.
  const nextParentId = (id: string): string | null => {
    const rels = relsByChild.get(id);
    if (rels && rels.length > 0) {
      const primary = rels.find(x => x.isPrimary) ?? rels[0];
      return primary.parentId;
    }
    return byId.get(id)?.parentId ?? null;
  };

  // Bygg full sökväg rot→objekt med given direkt förälder som start uppåt.
  const buildPath = (firstParentId: string | null): MinimalObject[] => {
    const chain: MinimalObject[] = [start];
    const seen = new Set<string>([start.id]);
    let cursor = firstParentId;
    let guard = 0;
    while (cursor && guard < 8 && !seen.has(cursor)) {
      const p = byId.get(cursor);
      if (!p) break;
      chain.push(p);
      seen.add(p.id);
      cursor = nextParentId(p.id);
      guard++;
    }
    return chain.slice().reverse();
  };

  const toChain = (
    firstParentId: string | null,
    isPrimary: boolean,
    relationContext: string | null,
  ): DisplayNameChain => {
    const rootToChild = buildPath(firstParentId);
    return {
      parentId: firstParentId,
      relationContext,
      isPrimary,
      name: formatChain(rootToChild.map(o => ({ name: localizedName(o, lang), level: o.hierarchyLevel ?? "" })), r),
      path: rootToChild.map(o => ({ id: o.id, name: localizedName(o, lang), level: o.hierarchyLevel ?? "" })),
    };
  };

  const directRels = relsByChild.get(objectId) ?? [];
  let chains: DisplayNameChain[];
  if (directRels.length > 0) {
    chains = directRels.map(rel => toChain(rel.parentId, rel.isPrimary, rel.relationContext));
    // Säkra att exakt en kedja markeras primär (fall tillbaka på parentId-match).
    if (!chains.some(c => c.isPrimary)) {
      const match = chains.find(c => c.parentId === start.parentId) ?? chains[0];
      if (match) match.isPrimary = true;
    }
  } else {
    // Legacy: ingen object_parents-rad → enkel kedja längs parentId.
    chains = [toChain(start.parentId, true, "primary")];
  }

  // Primär kedja först, övriga efter.
  chains.sort((a, b) => (a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1));
  const primaryChain = chains.find(c => c.isPrimary) ?? chains[0];

  // Task #634: samla tillgängliga språk i hela primärkedjan så UI:t kan erbjuda val.
  const langSet = new Set<string>();
  Array.from(byId.values()).forEach((o) => {
    if (o.nameTranslations) Object.keys(o.nameTranslations).forEach((k) => langSet.add(k));
  });
  const languages = Array.from(langSet).sort();

  return {
    primary: primaryChain?.name || selfName,
    chains,
    language: lang,
    translations,
    languages: languages.length ? languages : undefined,
    rulesEnabled: r.enabled,
  };
}

// Batch-variant för listor — undviker N+1 genom att hämta alla objekt en gång.
export async function computeDisplayNamesBatch(
  objectIds: string[],
  tenantId: string,
  rules?: DisplayNameRules,
  language?: string,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (objectIds.length === 0) return result;
  const r = rules ?? (await getDisplayNameRules(tenantId));
  const lang = normalizeLanguage(language);
  const all = await db
    .select(OBJECT_NAME_COLUMNS)
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
  const byId = new Map<string, MinimalObject>(all.map(o => [o.id, toMinimal(o)]));

  for (const id of objectIds) {
    const start = byId.get(id);
    if (!start) { result.set(id, ""); continue; }
    if (!r.enabled) { result.set(id, localizedName(start, lang)); continue; }
    const chain: MinimalObject[] = [start];
    let cursor = start.parentId;
    let guard = 0;
    while (cursor && guard < 8) {
      const p = byId.get(cursor);
      if (!p) break;
      chain.push(p);
      cursor = p.parentId;
      guard++;
    }
    let parts = chain.slice().reverse().map(o => ({ name: localizedName(o, lang), level: o.hierarchyLevel ?? "" }));
    if (r.includeLevels.length > 0) {
      parts = parts.filter((p, idx) => idx === parts.length - 1 || r.includeLevels.includes(p.level));
    }
    if (r.skipDuplicateNames) {
      parts = parts.filter((p, idx, arr) => idx === 0 || p.name !== arr[idx - 1].name);
    }
    if (parts.length > r.maxDepth) parts = parts.slice(parts.length - r.maxDepth);
    result.set(id, parts.map(p => p.name).filter(Boolean).join(r.separator));
  }
  return result;
}
