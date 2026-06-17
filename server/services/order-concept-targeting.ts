import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  metadataDefinitions,
  objectMetadata,
  type ServiceObject,
} from "@shared/schema";
// Task #940: matchesFilter lever nu i @shared/condition-matching (delas av klient
// och server). Re-exporteras här så befintliga server-importörer är oförändrade.
import { matchesFilter } from "@shared/condition-matching";

export { matchesFilter };

// ============================================================================
// Delad inpeknings-/villkorslogik för orderkoncept (steg 4).
//
// All målupplösning (vilka objekt ett koncept pekar in) och villkorsmatchning
// (vilka av dem som matchar filtren) går via denna modul så att förhandsvisning
// (condition-preview), execute, abonnemangs-beräkning, rullande körning,
// ändringsdetektering och granskningssammanfattning matchar IDENTISKT. Tidigare
// fanns 5+ kopior av operator-switchen som kunde driva isär.
//
// ADR v3: koncept pekar in OBJEKT/GRENAR (gren-rot-id:n i target_object_ids).
// Upplösning sker live via getObjectSubtreeIds (primär parent_id-kedja,
// tenant-scopat, exkl. soft-deletade). Legacy kluster-koncept faller tillbaka
// på target_cluster_ids / target_cluster_id (expand-contract).
// ============================================================================

export type ConditionFilterInput = {
  metadataKey: string;
  operator: string;
  filterValue?: unknown;
};

export type ResolveTargetOptions = {
  tenantId: string;
  /** Gren-ROT-objekt-id:n (ADR v3). Föredras framför kluster när satt. */
  objectIds?: string[] | null;
  /** Legacy kluster-id:n (bakåtkomp). Används bara när objectIds saknas. */
  clusterIds?: string[] | null;
  /**
   * När varken objectIds eller clusterIds finns: returnera alla tenant-objekt
   * (execute-beteende) i stället för tom lista (preview-beteende).
   */
  fallbackAllObjects?: boolean;
};

/**
 * Resolvar de konkreta målobjekten för ett koncept (eller en ad-hoc-selektion).
 *
 * Prioritet: objektgrenar (subträd via getObjectSubtreeIds) → legacy kluster →
 * ev. alla objekt. Alla grenar är tenant-scopade och exkluderar soft-deletade.
 */
export async function resolveTargetObjects(
  opts: ResolveTargetOptions,
): Promise<ServiceObject[]> {
  const { tenantId, objectIds, clusterIds, fallbackAllObjects } = opts;

  // 1. Objekt-/gren-inpekning (ADR v3) — föredras.
  if (objectIds && objectIds.length > 0) {
    const idSet = new Set<string>();
    for (const rootId of objectIds) {
      const subtree = await storage.getObjectSubtreeIds(tenantId, rootId);
      for (const id of subtree) idSet.add(id);
    }
    if (idSet.size === 0) return [];
    const all = await storage.getObjects(tenantId);
    return all.filter((o) => idSet.has(o.id));
  }

  // 2. Legacy kluster-inpekning (bakåtkomp).
  if (clusterIds && clusterIds.length > 0) {
    const objectMap = new Map<string, ServiceObject>();
    for (const clusterId of clusterIds) {
      const clusterObjects = await storage.getClusterObjects(clusterId);
      for (const obj of clusterObjects) {
        if (obj.tenantId === tenantId) objectMap.set(obj.id, obj);
      }
    }
    return Array.from(objectMap.values());
  }

  // 3. Inget mål valt.
  if (fallbackAllObjects) return await storage.getObjects(tenantId);
  return [];
}

/**
 * Bygger metadata-karta (objectId → {fieldKey → värde}) i en batch. Värdet tas
 * från valueJson om satt, annars value (text). Samma uppbyggnad används av både
 * bulk-filtreringen och enskild-objekt-testet så de aldrig kan driva isär.
 */
export async function buildObjectMetadataMap(
  tenantId: string,
  objectIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const metaByObject = new Map<string, Record<string, unknown>>();
  if (objectIds.length === 0) return metaByObject;

  const defs = await db
    .select()
    .from(metadataDefinitions)
    .where(and(eq(metadataDefinitions.tenantId, tenantId), isNull(metadataDefinitions.deletedAt)));
  const defKey = new Map(defs.map((d) => [d.id, d.fieldKey]));
  const rows = await db
    .select()
    .from(objectMetadata)
    .where(and(eq(objectMetadata.tenantId, tenantId), inArray(objectMetadata.objectId, objectIds)));

  for (const row of rows) {
    const key = defKey.get(row.definitionId);
    if (!key) continue;
    const map = metaByObject.get(row.objectId) ?? {};
    map[key] = (row as any).valueJson ?? (row as any).value;
    metaByObject.set(row.objectId, map);
  }
  return metaByObject;
}

/**
 * Värde-upplösning för ETT villkor mot ETT objekt: metadatanyckeln först,
 * annars objektets baskolumn (t.ex. objectType) som fallback. Enda källan så att
 * bulk-filtrering och enskilt test resolvar identiskt värde.
 */
function resolveConditionValue(
  obj: ServiceObject,
  meta: Record<string, unknown>,
  metadataKey: string,
): unknown {
  return metadataKey in meta ? meta[metadataKey] : (obj as any)[metadataKey];
}

/**
 * Returnerar de objekt som matchar ALLA filter. Objektets baskolumner används
 * som fallback-nycklar (t.ex. objectType) när metadatanyckeln saknas. Tom
 * filterlista = alla objekt.
 */
export async function filterObjectsByConditions(
  tenantId: string,
  objectsList: ServiceObject[],
  filters: ConditionFilterInput[],
): Promise<ServiceObject[]> {
  if (filters.length === 0) return objectsList;
  if (objectsList.length === 0) return [];

  const metaByObject = await buildObjectMetadataMap(tenantId, objectsList.map((o) => o.id));

  return objectsList.filter((obj) => {
    const meta = metaByObject.get(obj.id) ?? {};
    return filters.every((f) =>
      matchesFilter(resolveConditionValue(obj, meta, f.metadataKey), f.operator, f.filterValue),
    );
  });
}

export type ConditionEvalResult = {
  metadataKey: string;
  operator: string;
  filterValue: unknown;
  /** Objektets faktiska (upplösta) värde för fältet — för felsökning i UI. */
  actualValue: unknown;
  passed: boolean;
};

/**
 * Utvärderar filtren mot ETT objekt och returnerar per-villkor pass/fail samt
 * objektets faktiska värde. Använder EXAKT samma värde-upplösning
 * (resolveConditionValue) och matchesFilter som bulk-förhandsvisning/expansion,
 * så ett enskilt test alltid stämmer överens med "X av Y matchar". Tom
 * filterlista ⇒ matched=true (alla objekt i grenen inkluderas).
 */
export async function evaluateConditionsForObject(
  tenantId: string,
  object: ServiceObject,
  filters: ConditionFilterInput[],
): Promise<{ matched: boolean; results: ConditionEvalResult[] }> {
  const metaByObject = await buildObjectMetadataMap(tenantId, [object.id]);
  const meta = metaByObject.get(object.id) ?? {};
  const results: ConditionEvalResult[] = filters.map((f) => {
    const actualValue = resolveConditionValue(object, meta, f.metadataKey);
    return {
      metadataKey: f.metadataKey,
      operator: f.operator,
      filterValue: f.filterValue,
      actualValue,
      passed: matchesFilter(actualValue, f.operator, f.filterValue),
    };
  });
  return { matched: results.every((r) => r.passed), results };
}

/**
 * Härledar gren-rot-id:n (ADR v3) respektive legacy kluster-id:n från ett
 * koncept, med samma fallback-kedja överallt:
 *   target_object_ids → target_cluster_ids → target_cluster_id.
 */
export function deriveConceptTargets(concept: {
  targetObjectIds?: string[] | null;
  targetClusterIds?: string[] | null;
  targetClusterId?: string | null;
}): { objectIds: string[]; clusterIds: string[] } {
  const objectIds =
    Array.isArray(concept.targetObjectIds) && concept.targetObjectIds.length > 0
      ? concept.targetObjectIds
      : [];
  const clusterIds =
    Array.isArray(concept.targetClusterIds) && concept.targetClusterIds.length > 0
      ? concept.targetClusterIds
      : concept.targetClusterId
        ? [concept.targetClusterId]
        : [];
  return { objectIds, clusterIds };
}

/**
 * Bekvämlighets-wrapper: resolvar målobjekt för ett koncept och applicerar
 * dess filter i ett svep. Används av execute och alla körnings-/beräknings-
 * vägar så att urval + matchning alltid är identiskt.
 */
export async function resolveConceptMatchingObjects(
  tenantId: string,
  concept: {
    targetObjectIds?: string[] | null;
    targetClusterIds?: string[] | null;
    targetClusterId?: string | null;
  },
  filters: ConditionFilterInput[],
  opts?: { fallbackAllObjects?: boolean },
): Promise<{ targetObjects: ServiceObject[]; matchingObjects: ServiceObject[] }> {
  const { objectIds, clusterIds } = deriveConceptTargets(concept);
  const targetObjects = await resolveTargetObjects({
    tenantId,
    objectIds,
    clusterIds,
    fallbackAllObjects: opts?.fallbackAllObjects ?? false,
  });
  const matchingObjects = await filterObjectsByConditions(tenantId, targetObjects, filters);
  return { targetObjects, matchingObjects };
}
