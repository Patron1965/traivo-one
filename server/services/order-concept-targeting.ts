import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  metadataDefinitions,
  objectMetadata,
  type ServiceObject,
} from "@shared/schema";

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

/**
 * Operator-matchning för ETT villkor. Enda källan till sanning — återanvänds av
 * alla inpeknings-/villkorsvägar så preview och execute aldrig kan driva isär.
 */
export function matchesFilter(
  metadataValue: unknown,
  operator: string,
  filterValue: unknown,
): boolean {
  switch (operator) {
    case "equals":
      return String(metadataValue ?? "") === String(filterValue ?? "");
    case "not_equals":
      return String(metadataValue ?? "") !== String(filterValue ?? "");
    case "contains":
      return String(metadataValue ?? "")
        .toLowerCase()
        .includes(String(filterValue ?? "").toLowerCase());
    case "starts_with":
      return String(metadataValue ?? "")
        .toLowerCase()
        .startsWith(String(filterValue ?? "").toLowerCase());
    case "greater_than":
      return Number(metadataValue) > Number(filterValue);
    case "less_than":
      return Number(metadataValue) < Number(filterValue);
    case "in_list":
      return Array.isArray(filterValue) && filterValue.map(String).includes(String(metadataValue));
    case "exists":
      return metadataValue !== undefined && metadataValue !== null && metadataValue !== "";
    case "not_exists":
      return metadataValue === undefined || metadataValue === null || metadataValue === "";
    default:
      return true;
  }
}

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
 * Bygger metadata-karta (fieldKey → värde) i en batch och returnerar de objekt
 * som matchar ALLA filter. Objektets baskolumner används som fallback-nycklar
 * (t.ex. objectType) när metadatanyckeln saknas. Tom filterlista = alla objekt.
 */
export async function filterObjectsByConditions(
  tenantId: string,
  objectsList: ServiceObject[],
  filters: ConditionFilterInput[],
): Promise<ServiceObject[]> {
  if (filters.length === 0) return objectsList;
  if (objectsList.length === 0) return [];

  const objectIds = objectsList.map((o) => o.id);
  const defs = await db
    .select()
    .from(metadataDefinitions)
    .where(and(eq(metadataDefinitions.tenantId, tenantId), isNull(metadataDefinitions.deletedAt)));
  const defKey = new Map(defs.map((d) => [d.id, d.fieldKey]));
  const rows = await db
    .select()
    .from(objectMetadata)
    .where(and(eq(objectMetadata.tenantId, tenantId), inArray(objectMetadata.objectId, objectIds)));

  const metaByObject = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = defKey.get(row.definitionId);
    if (!key) continue;
    const map = metaByObject.get(row.objectId) ?? {};
    map[key] = (row as any).valueJson ?? (row as any).value;
    metaByObject.set(row.objectId, map);
  }

  return objectsList.filter((obj) => {
    const meta = metaByObject.get(obj.id) ?? {};
    return filters.every((f) => {
      const value = f.metadataKey in meta ? meta[f.metadataKey] : (obj as any)[f.metadataKey];
      return matchesFilter(value, f.operator, f.filterValue);
    });
  });
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
