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
};

export async function computeDisplayName(
  objectId: string,
  tenantId: string,
  rules?: DisplayNameRules,
): Promise<string> {
  const r = rules ?? (await getDisplayNameRules(tenantId));
  const [obj] = await db
    .select({ id: objects.id, name: objects.name, parentId: objects.parentId, hierarchyLevel: objects.hierarchyLevel })
    .from(objects)
    .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));
  if (!obj) return "";
  if (!r.enabled) return obj.name ?? "";

  const chain: MinimalObject[] = [obj as MinimalObject];
  let cursor: string | null = obj.parentId;
  let guard = 0;
  while (cursor && guard < 8) {
    const [parent] = await db
      .select({ id: objects.id, name: objects.name, parentId: objects.parentId, hierarchyLevel: objects.hierarchyLevel })
      .from(objects)
      .where(and(eq(objects.id, cursor), eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
    if (!parent) break;
    chain.push(parent as MinimalObject);
    cursor = parent.parentId;
    guard++;
  }
  // chain[0] = barnet, chain[n] = roten. Bygg uppifrån.
  let parts = chain.slice().reverse().map(o => ({ name: o.name ?? "", level: o.hierarchyLevel ?? "" }));
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
};

// Multi-förälder (task #619): bygg ett släktnamn per direkt förälder via
// `object_parents`. Den primära kedjan väljs som default. Uppåt i hierarkin
// följs varje förälders PRIMÄRA relation (eller legacy parentId) så att varje
// kedja blir deterministisk.
export async function computeObjectDisplayNames(
  objectId: string,
  tenantId: string,
  rules?: DisplayNameRules,
): Promise<ObjectDisplayNames> {
  const r = rules ?? (await getDisplayNameRules(tenantId));

  const all = await db
    .select({ id: objects.id, name: objects.name, parentId: objects.parentId, hierarchyLevel: objects.hierarchyLevel })
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
  const byId = new Map<string, MinimalObject>(all.map(o => [o.id, o as MinimalObject]));

  const start = byId.get(objectId);
  if (!start) return { primary: "", chains: [] };
  const selfName = start.name ?? "";
  if (!r.enabled) return { primary: selfName, chains: [] };

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
      name: formatChain(rootToChild.map(o => ({ name: o.name ?? "", level: o.hierarchyLevel ?? "" })), r),
      path: rootToChild.map(o => ({ id: o.id, name: o.name ?? "", level: o.hierarchyLevel ?? "" })),
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
  return { primary: primaryChain?.name || selfName, chains };
}

// Batch-variant för listor — undviker N+1 genom att hämta alla objekt en gång.
export async function computeDisplayNamesBatch(
  objectIds: string[],
  tenantId: string,
  rules?: DisplayNameRules,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (objectIds.length === 0) return result;
  const r = rules ?? (await getDisplayNameRules(tenantId));
  const all = await db
    .select({ id: objects.id, name: objects.name, parentId: objects.parentId, hierarchyLevel: objects.hierarchyLevel })
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
  const byId = new Map<string, MinimalObject>(all.map(o => [o.id, o as MinimalObject]));

  for (const id of objectIds) {
    const start = byId.get(id);
    if (!start) { result.set(id, ""); continue; }
    if (!r.enabled) { result.set(id, start.name ?? ""); continue; }
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
    let parts = chain.slice().reverse().map(o => ({ name: o.name ?? "", level: o.hierarchyLevel ?? "" }));
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
