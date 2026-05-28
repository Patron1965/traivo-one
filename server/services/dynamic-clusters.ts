// Dynamiska kluster — task #552 krav (E).
// Utvärderar tenant-objekt mot ett klusters regelsats och uppdaterar
// `objects.clusterId` enligt matchning. Kör synkront vid manuell trigger
// och i bakgrundsjob från metadata-change-jobs.ts.
import { db } from "../db";
import { objects, clusters, metadataVarden, metadataKatalog, type ClusterDynamicRules } from "@shared/schema";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";

type RuleSet = ClusterDynamicRules["rules"][number];

function matchOne(rule: RuleSet, obj: any, metaByKatalog: Map<string, any>): boolean {
  if (rule.kind === "postalPrefix") {
    const pc = (obj.postal_code ?? obj.postalCode ?? "").toString().replace(/\s+/g, "");
    return pc.startsWith(rule.value.replace(/\s+/g, ""));
  }
  if (rule.kind === "city") {
    return ((obj.city ?? "") as string).toLowerCase() === rule.value.toLowerCase();
  }
  if (rule.kind === "metadata") {
    const meta = metaByKatalog.get(rule.katalogNamn);
    if (!meta) return rule.operator === "ne";
    const val = meta.varde_string ?? meta.varde_integer ?? meta.varde_decimal ?? meta.varde_boolean ?? meta.varde_datetime ?? meta.varde_json;
    switch (rule.operator) {
      case "eq": return String(val) === String(rule.value);
      case "ne": return String(val) !== String(rule.value);
      case "contains": return String(val ?? "").toLowerCase().includes(String(rule.value).toLowerCase());
      case "in": return Array.isArray(rule.value) && rule.value.map(String).includes(String(val));
    }
  }
  return false;
}

export async function evaluateDynamicCluster(
  clusterId: string,
  tenantId: string,
  rules: ClusterDynamicRules,
  opts: { dryRun?: boolean } = {},
): Promise<{ matched: number; assigned: number; removed: number; sample: string[] }> {
  // Hämta alla objekt + metadata via SQL för effektivitet.
  const objs = await db.execute(sql`
    SELECT id, name, postal_code, city, cluster_id FROM objects
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
  `).then(r => r.rows as any[]);

  // Hämta katalog-id för alla metadata-typer som refereras
  const katalogNamn = rules.rules.filter(r => r.kind === "metadata").map(r => (r as any).katalogNamn);
  const katalog = katalogNamn.length > 0
    ? await db.select().from(metadataKatalog).where(and(eq(metadataKatalog.tenantId, tenantId), inArray(metadataKatalog.namn, katalogNamn)))
    : [];
  const katalogIdByName = new Map(katalog.map(k => [k.namn, k.id]));
  const katalogNameById = new Map(katalog.map(k => [k.id, k.namn]));

  // Hämta alla metadata-värden för dessa katalog-ids
  const allMeta = katalog.length > 0
    ? await db.select().from(metadataVarden).where(and(eq(metadataVarden.tenantId, tenantId), inArray(metadataVarden.metadataKatalogId, katalog.map(k => k.id))))
    : [];
  const metaByObject = new Map<string, Map<string, any>>();
  for (const m of allMeta) {
    if (!m.objektId || !m.metadataKatalogId) continue;
    if (!metaByObject.has(m.objektId)) metaByObject.set(m.objektId, new Map());
    const name = katalogNameById.get(m.metadataKatalogId);
    if (name) metaByObject.get(m.objektId)!.set(name, m);
  }

  const matched: string[] = [];
  for (const o of objs) {
    const meta = metaByObject.get(o.id) ?? new Map();
    const results = rules.rules.map(r => matchOne(r, o, meta));
    const ok = rules.match === "all" ? results.every(Boolean) : results.some(Boolean);
    if (ok) matched.push(o.id);
  }

  let assigned = 0;
  let removed = 0;
  if (!opts.dryRun) {
    // Tilldela matchande objekt till klustret
    if (matched.length > 0) {
      const toAssign = matched.filter(id => (objs.find(o => o.id === id)?.cluster_id) !== clusterId);
      if (toAssign.length > 0) {
        await db.update(objects).set({ clusterId }).where(and(eq(objects.tenantId, tenantId), inArray(objects.id, toAssign)));
        assigned = toAssign.length;
      }
    }
    // Ta bort kluster-tillhörighet från objekt som tidigare matchat men nu inte gör det
    const matchedSet = new Set(matched);
    const toRemove = objs.filter(o => o.cluster_id === clusterId && !matchedSet.has(o.id)).map(o => o.id);
    if (toRemove.length > 0) {
      await db.update(objects).set({ clusterId: null }).where(and(eq(objects.tenantId, tenantId), inArray(objects.id, toRemove)));
      removed = toRemove.length;
    }
    await db.update(clusters).set({ dynamicRulesLastAppliedAt: new Date() }).where(and(eq(clusters.id, clusterId), eq(clusters.tenantId, tenantId)));
  }

  return { matched: matched.length, assigned, removed, sample: matched.slice(0, 10) };
}

// Kör alla aktiva dynamiska kluster för en tenant. Anropas från
// metadata-change-jobs efter större batch-uppdateringar.
export async function evaluateAllDynamicClusters(tenantId: string): Promise<{ clusters: number; totalAssigned: number; totalRemoved: number }> {
  const all = await db.select().from(clusters).where(and(eq(clusters.tenantId, tenantId), isNull(clusters.deletedAt)));
  let totalAssigned = 0;
  let totalRemoved = 0;
  let processed = 0;
  for (const c of all) {
    if (!c.dynamicRules) continue;
    try {
      const { clusterDynamicRulesSchema } = await import("@shared/schema");
      const parsed = clusterDynamicRulesSchema.safeParse(c.dynamicRules);
      if (!parsed.success) continue;
      const r = await evaluateDynamicCluster(c.id, tenantId, parsed.data);
      totalAssigned += r.assigned;
      totalRemoved += r.removed;
      processed++;
    } catch (err) {
      console.error(`[dynamic-clusters] failed for ${c.id}:`, err);
    }
  }
  return { clusters: processed, totalAssigned, totalRemoved };
}
