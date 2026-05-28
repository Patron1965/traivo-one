// Hierarkiskt visningsnamn ("släktnamn") för objekt — task #552 krav (A).
// Bygger ett namn som "Stockholm › BRF Gamla Stan › Hus A › Källare 1" baserat
// på tenant-konfigurerade regler i `tenants.settings.displayNameRules`.
//
// Designval: ingen separat kolumn — beräknas on-read. För massvyer (listor)
// kan UI fortfarande visa `object.name`; visningsnamnet är opt-in per vy.
import { db } from "../db";
import { objects, tenants, displayNameRulesSchema, type DisplayNameRules } from "@shared/schema";
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
