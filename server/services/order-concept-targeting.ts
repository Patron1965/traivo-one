import { storage } from "../storage";
// Task #992: villkorsmotorn läser metadata KANONISKT från det svenska systemet
// (metadata_katalog/metadata_varden) via denna batch-helper i stället för det
// avvecklade engelska metadata_definitions/object_metadata.
import { getObjectsConditionMetadata } from "../metadata-queries";
import { type ServiceObject } from "@shared/schema";
// Task #940: matchesFilter lever nu i @shared/condition-matching (delas av klient
// och server). Re-exporteras här så befintliga server-importörer är oförändrade.
import { matchesFilter, CONDITION_OPERATORS, operatorNeedsNoValue } from "@shared/condition-matching";

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
// tenant-scopat, exkl. soft-deletade). Etapp 5: kluster-inpekning borttagen.
// ============================================================================

export type ConditionFilterInput = {
  metadataKey: string;
  operator: string;
  filterValue?: unknown;
};

export type ResolveTargetOptions = {
  tenantId: string;
  /** Gren-ROT-objekt-id:n (ADR v3). */
  objectIds?: string[] | null;
  /**
   * När objectIds saknas: returnera alla tenant-objekt (execute-beteende)
   * i stället för tom lista (preview-beteende).
   */
  fallbackAllObjects?: boolean;
};

/**
 * Resolvar de konkreta målobjekten för ett koncept (eller en ad-hoc-selektion).
 *
 * Prioritet: objektgrenar (subträd via getObjectSubtreeIds) → ev. alla objekt.
 * Alla grenar är tenant-scopade och exkluderar soft-deletade.
 */
export async function resolveTargetObjects(
  opts: ResolveTargetOptions,
): Promise<ServiceObject[]> {
  const { tenantId, objectIds, fallbackAllObjects } = opts;

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

  // 2. Inget mål valt.
  if (fallbackAllObjects) return await storage.getObjects(tenantId);
  return [];
}

/**
 * Bygger metadata-karta (objectId → {nyckel → värde}) i en batch. Task #992:
 * läser KANONISKT från det svenska systemet (metadata_katalog/metadata_varden,
 * inkl. arv + sammansatta json-fält) via getObjectsConditionMetadata. Varje
 * värde nycklas på katalogens `namn`, dess `beteckning` och ev. punktnotation
 * så att ett sparat concept_filters.metadata_key fortsätter resolva. Tunn
 * wrapper kvar för stabil export (bulk-filtrering, enskilt test och
 * delivery-restriction-notes delar exakt samma karta).
 */
export async function buildObjectMetadataMap(
  tenantId: string,
  objectIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  return getObjectsConditionMetadata(tenantId, objectIds);
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

// ============================================================================
// Task #1205 (fält 54): läsbar matchningsorsak.
//
// Bygger en människoläsbar svensk sammanfattning av VARFÖR ett objekt hakades på
// ett orderkoncept (vilka villkor som matchade), snapshotad vid expansion så att
// den överlever senare filteredigeringar. Använder EXAKT samma värde-upplösning
// (resolveConditionValue) och operator-semantik (matchesFilter) som urvalet, så
// orsaken alltid speglar den faktiska matchningen.
// ============================================================================

/** Läsbar operator-etikett (svensk) för en villkorsoperator. */
function operatorLabel(operator: string): string {
  return CONDITION_OPERATORS.find((o) => o.value === operator)?.label ?? operator;
}

/** Formaterar ett filtervärde läsbart (arrayer → "a/b/c"). */
function formatFilterValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join("/");
  return String(value ?? "");
}

/**
 * Bygger en läsbar orsak-sträng från per-villkor-resultat. Endast passerade
 * villkor tas med (matchande objekt passerar alla). Tom villkorslista ⇒
 * "Hela grenen (inga villkor)".
 */
export function formatMatchReason(results: ConditionEvalResult[]): string {
  if (results.length === 0) return "Hela grenen (inga villkor)";
  const passed = results.filter((r) => r.passed);
  if (passed.length === 0) return "Hela grenen (inga villkor)";
  const parts = passed.map((r) => {
    const field = r.metadataKey;
    const op = operatorLabel(r.operator);
    if (operatorNeedsNoValue(r.operator)) return `${field} ${op}`;
    return `${field} ${op} ${formatFilterValue(r.filterValue)}`;
  });
  return parts.join("; ");
}

/**
 * Bygger matchningsorsak per objekt i EN batch (delad metadata-karta) för de
 * angivna objekten mot filtren. Returnerar Map<objectId, orsak-sträng>. Används
 * vid koncept-expansion för att stämpla assignments.matchReason.
 */
export async function buildMatchReasonsForObjects(
  tenantId: string,
  objectsList: ServiceObject[],
  filters: ConditionFilterInput[],
): Promise<Map<string, string>> {
  const reasons = new Map<string, string>();
  if (objectsList.length === 0) return reasons;
  if (filters.length === 0) {
    for (const obj of objectsList) reasons.set(obj.id, formatMatchReason([]));
    return reasons;
  }
  const metaByObject = await buildObjectMetadataMap(tenantId, objectsList.map((o) => o.id));
  for (const obj of objectsList) {
    const meta = metaByObject.get(obj.id) ?? {};
    const results: ConditionEvalResult[] = filters.map((f) => {
      const actualValue = resolveConditionValue(obj, meta, f.metadataKey);
      return {
        metadataKey: f.metadataKey,
        operator: f.operator,
        filterValue: f.filterValue,
        actualValue,
        passed: matchesFilter(actualValue, f.operator, f.filterValue),
      };
    });
    reasons.set(obj.id, formatMatchReason(results));
  }
  return reasons;
}

/**
 * Härledar gren-rot-id:n (ADR v3) från ett koncept (target_object_ids).
 */
export function deriveConceptTargets(concept: {
  targetObjectIds?: string[] | null;
}): { objectIds: string[] } {
  const objectIds =
    Array.isArray(concept.targetObjectIds) && concept.targetObjectIds.length > 0
      ? concept.targetObjectIds
      : [];
  return { objectIds };
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
  },
  filters: ConditionFilterInput[],
  opts?: { fallbackAllObjects?: boolean },
): Promise<{ targetObjects: ServiceObject[]; matchingObjects: ServiceObject[] }> {
  const { objectIds } = deriveConceptTargets(concept);
  const targetObjects = await resolveTargetObjects({
    tenantId,
    objectIds,
    fallbackAllObjects: opts?.fallbackAllObjects ?? false,
  });
  const matchingObjects = await filterObjectsByConditions(tenantId, targetObjects, filters);
  return { targetObjects, matchingObjects };
}
