// Task #1129: Informationspaket-träd på objektsidan.
//
// Bygger en LÄSVY (ingen mutation) över objektets uppgifter — utförda
// (work_orders) och kommande (assignments, inkl. call_off-avrop som inte syns i
// vanliga work_order-läsningar) — med varje uppgifts informationspaket (inmatad
// metadata + foton) och dess faktureringskoppling.
//
// ÅTERANVÄNDNING (ingen parallell andra-källa): status/typ-logiken kommer från
// grovplaneringens grid (STATUS_CASE, normalizeTaskType, TASK_TYPE_LABELS),
// faktureringsmetoden via den kanoniska getOrderConceptMethod, och
// koncept-inpekningen via den delade villkorsmotorn (deriveConceptTargets +
// evaluateConditionsForObject) — samma som planner-konceptdata / steg 4.
//
// work_orders saknar orderConceptId; konceptkopplingen härleds därför via
// live-compute per objekt (inte en WO-join). Kommande assignments bär
// orderConceptId direkt.
import { db } from "../db";
import { and, eq, inArray, isNull, sql, desc } from "drizzle-orm";
import {
  workOrders,
  assignments,
  objects,
  customers,
  orderConcepts,
  protocols,
  metadataVarden,
  metadataKatalog,
} from "@shared/schema";
import { storage } from "../storage";
import {
  STATUS_CASE,
  normalizeTaskType,
  TASK_TYPE_LABELS,
  ROUGH_STATUS_LABELS,
  type RoughStatus,
} from "../grovplanering-grid";
import {
  getOrderConceptMethod,
  isFakturastoppConsolidation,
} from "@shared/order-concept-method";
import {
  deriveConceptTargets,
  evaluateConditionsForObject,
} from "./order-concept-targeting";

// Skydd mot orimligt stora subträd/objekt — läsvyn ska vara snabb.
const MAX_OBJECTS = 400;
const MAX_WORK_ORDERS = 400;
const MAX_ASSIGNMENTS = 400;

export type InvoiceConnectionCategory =
  | "fritt"
  | "objekt_orderkoncept"
  | "fakturareferens"
  | "lopande"
  | "abonnemang";

export interface InvoiceConnection {
  category: InvoiceConnectionCategory;
  label: string;
  detail: string | null;
  zeroInvoice: boolean;
  conceptId: string | null;
  conceptName: string | null;
}

export interface InfoPackageMetadataEntry {
  label: string;
  value: string;
}

export interface InfoPackagePhoto {
  url: string;
  description: string | null;
}

export interface InfoPackageNode {
  id: string;
  source: "work_order" | "assignment";
  kind: "historik" | "kommande";
  title: string | null;
  status: RoughStatus | "kommande";
  statusLabel: string;
  taskType: string;
  taskTypeLabel: string;
  executionCode: string | null;
  objectId: string | null;
  objectName: string | null;
  location: string | null;
  city: string | null;
  scheduledDate: string | null;
  productionMinutes: number;
  value: number; // öre
  cost: number; // öre
  orderConceptId: string | null;
  orderConceptName: string | null;
  customerName: string | null;
  invoice: InvoiceConnection;
  metadata: InfoPackageMetadataEntry[];
  photos: InfoPackagePhoto[];
}

export interface InfoPackageTreeResult {
  nodes: InfoPackageNode[];
  objectCount: number;
  includeChildren: boolean;
  truncated: boolean;
}

const toIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;

const PHOTO_DATATYPES = new Set(["foto", "bild", "photo", "image"]);

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "per dag",
  weekly: "per vecka",
  monthly: "per månad",
  quarterly: "per kvartal",
  yearly: "per år",
};

type ConceptRow = Awaited<ReturnType<typeof storage.getOrderConcepts>>[number];

/**
 * Härleder en uppgifts faktureringskoppling som läsvy utifrån det kopplade
 * orderkonceptet (om något). Kategorierna speglar specens fem fall:
 *   fritt / samfaktureras på objekt-orderkoncept / mot fakturareferens /
 *   löpande per dag-vecka-månad / abonnemang med "0-faktura".
 */
export function deriveInvoiceConnection(
  concept: ConceptRow | null | undefined,
  hasFrozenReferences: boolean,
): InvoiceConnection {
  if (!concept) {
    return {
      category: "fritt",
      label: "Fritt",
      detail: "Fri uppgift utan orderkoncept-koppling",
      zeroInvoice: false,
      conceptId: null,
      conceptName: null,
    };
  }

  const base = {
    conceptId: concept.id,
    conceptName: concept.name ?? null,
  };
  const model = getOrderConceptMethod(concept as any);

  if (model === "subscription") {
    return {
      ...base,
      category: "abonnemang",
      label: "Abonnemang",
      detail: 'Faktureras via abonnemangsavgift — bekräftande "0-faktura" per uppgift',
      zeroInvoice: true,
    };
  }

  const consolidation = (concept as any).invoiceConsolidation as string | null | undefined;
  const departmentField = (concept as any).departmentMetadataField as string | null | undefined;
  const billingFrequency = (concept as any).billingFrequency as string | null | undefined;
  const fakturastopp = isFakturastoppConsolidation(consolidation);

  // Frusna radreferenser på uppgiften, eller ett fakturastopp som delar på ett
  // metadatafält ⇒ "mot fakturareferens".
  if (hasFrozenReferences || (fakturastopp && departmentField)) {
    return {
      ...base,
      category: "fakturareferens",
      label: "Mot fakturareferens",
      detail: departmentField
        ? `Delas på fakturareferens (${departmentField})`
        : "Frusna fakturareferenser på uppgiften",
      zeroInvoice: false,
    };
  }

  // Schema-modell, eller ett fakturastopp på en ren frekvens ⇒ löpande.
  if (model === "schedule" || fakturastopp) {
    const freqKey = fakturastopp ? consolidation : billingFrequency;
    const freqLabel = freqKey ? FREQUENCY_LABELS[freqKey] ?? null : null;
    return {
      ...base,
      category: "lopande",
      label: freqLabel ? `Löpande ${freqLabel}` : "Löpande",
      detail: "Periodisk fakturering",
      zeroInvoice: false,
    };
  }

  // call_off på kundnivå ⇒ samfaktureras på objekt-orderkoncept.
  return {
    ...base,
    category: "objekt_orderkoncept",
    label: "Samfaktureras på objekt-orderkoncept",
    detail: "Avrop/efterfakturering rullas upp på kundnivå",
    zeroInvoice: false,
  };
}

function formatMetadataValue(row: {
  vardeString: string | null;
  vardeInteger: number | null;
  vardeDecimal: number | null;
  vardeBoolean: boolean | null;
  vardeDatetime: Date | null;
  vardeJson: any | null;
  vardeReferens: string | null;
}): string | null {
  if (row.vardeString != null && row.vardeString.trim()) return row.vardeString.trim();
  if (row.vardeReferens != null && row.vardeReferens.trim()) return row.vardeReferens.trim();
  if (row.vardeInteger != null) return String(row.vardeInteger);
  if (row.vardeDecimal != null) return String(row.vardeDecimal);
  if (row.vardeBoolean != null) return row.vardeBoolean ? "Ja" : "Nej";
  if (row.vardeDatetime != null) {
    const d = row.vardeDatetime instanceof Date ? row.vardeDatetime : new Date(row.vardeDatetime);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString("sv-SE") : null;
  }
  if (row.vardeJson != null) {
    try {
      return typeof row.vardeJson === "string" ? row.vardeJson : JSON.stringify(row.vardeJson);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Batchad koncept-inpekning: vilka orderkoncept pekar in på respektive objekt.
 * Returnerar objectId → primärt koncept-id (minsta id för determinism). Bygger
 * subträd och hämtar koncept/filter EN gång (jfr computePointedInConcepts som
 * gör det per objekt).
 */
async function computePointedInConceptByObject(
  tenantId: string,
  objectRows: { id: string }[],
  concepts: ConceptRow[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (objectRows.length === 0 || concepts.length === 0) return result;

  const subtreeCache = new Map<string, Set<string>>();
  const getSubtree = async (rootId: string): Promise<Set<string>> => {
    const cached = subtreeCache.get(rootId);
    if (cached) return cached;
    const ids = new Set(await storage.getObjectSubtreeIds(tenantId, rootId));
    subtreeCache.set(rootId, ids);
    return ids;
  };

  const fullObjectById = new Map<string, any>();

  for (const concept of concepts) {
    if ((concept as any).deletedAt) continue;
    const { objectIds } = deriveConceptTargets(concept as any);

    // Objekt i konceptets inpekade gren (subträd).
    const inScope: { id: string }[] = [];
    if (objectIds.length > 0) {
      const subtrees = await Promise.all(objectIds.map((r) => getSubtree(r)));
      for (const obj of objectRows) {
        if (subtrees.some((s) => s.has(obj.id))) inScope.push(obj);
      }
    }
    if (inScope.length === 0) continue;

    const filters = await storage.getConceptFilters(concept.id);
    const filterInput = filters.map((f) => ({
      metadataKey: f.metadataKey,
      operator: f.operator,
      filterValue: f.filterValue,
    }));

    for (const obj of inScope) {
      // Endast determinera ett primärt koncept per objekt (minsta id).
      const existing = result.get(obj.id);
      if (existing && existing <= concept.id) continue;

      let fullObject = fullObjectById.get(obj.id);
      if (fullObject === undefined) {
        fullObject = await storage.getObject(obj.id);
        fullObjectById.set(obj.id, fullObject);
      }
      if (!fullObject) continue;

      const { matched } = await evaluateConditionsForObject(
        tenantId,
        fullObject as any,
        filterInput,
      );
      if (!matched) continue;

      if (!existing || concept.id < existing) result.set(obj.id, concept.id);
    }
  }

  return result;
}

/**
 * Bygger informationspaket-trädets noder för ett objekt (+ valfritt subträd).
 * Tenant-/objektägarskap verifieras av anroparen (routen).
 */
export async function getObjectInfoPackageTree(
  tenantId: string,
  rootObjectId: string,
  includeChildren: boolean,
): Promise<InfoPackageTreeResult> {
  // 1. Objekt-scope.
  let objectIds: string[] = [rootObjectId];
  if (includeChildren) {
    objectIds = await storage.getObjectSubtreeIds(tenantId, rootObjectId);
    if (!objectIds.includes(rootObjectId)) objectIds.push(rootObjectId);
  }
  let truncated = false;
  if (objectIds.length > MAX_OBJECTS) {
    objectIds = objectIds.slice(0, MAX_OBJECTS);
    truncated = true;
  }

  // Objektrader (för inpekning + namn/plats).
  const objectRows = await db
    .select({
      id: objects.id,
      name: objects.name,
      address: objects.address,
      city: objects.city,
      postalCode: objects.postalCode,
    })
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), inArray(objects.id, objectIds)));
  const objectMeta = new Map(objectRows.map((o) => [o.id, o]));

  // Koncept (en gång) + inpekning per objekt (för WO-faktureringskoppling).
  const concepts = await storage.getOrderConcepts(tenantId);
  const conceptById = new Map(concepts.map((c) => [c.id, c]));
  const pointedConceptByObject = await computePointedInConceptByObject(
    tenantId,
    objectRows.map((o) => ({ id: o.id })),
    concepts,
  );

  // 2. Utförda/historik — work_orders (återanvänder grovplaneringens status/typ).
  const woRows = await db
    .select({
      id: workOrders.id,
      status: STATUS_CASE,
      objectId: workOrders.objectId,
      title: workOrders.title,
      orderType: workOrders.orderType,
      executionCode: workOrders.executionCode,
      scheduledDate: workOrders.scheduledDate,
      desiredDeliveryStart: workOrders.desiredDeliveryStart,
      productionMinutes: workOrders.cachedProductionMinutes,
      value: workOrders.cachedValue,
      cost: workOrders.cachedCost,
      customerName: customers.name,
      frozenRefs: workOrders.frozenInvoiceRowReferences,
    })
    .from(workOrders)
    .leftJoin(customers, eq(workOrders.customerId, customers.id))
    .where(
      and(
        eq(workOrders.tenantId, tenantId),
        inArray(workOrders.objectId, objectIds),
        isNull(workOrders.deletedAt),
      ),
    )
    .orderBy(desc(workOrders.scheduledDate))
    .limit(MAX_WORK_ORDERS + 1);
  if (woRows.length > MAX_WORK_ORDERS) {
    truncated = true;
    woRows.length = MAX_WORK_ORDERS;
  }
  const woIds = woRows.map((r) => r.id);

  // Batchad metadata + foton för WO:erna.
  const metaByWo = new Map<string, InfoPackageMetadataEntry[]>();
  const photosByWo = new Map<string, InfoPackagePhoto[]>();
  if (woIds.length > 0) {
    const metaRows = await db
      .select({
        workOrderId: metadataVarden.workOrderId,
        namn: metadataKatalog.namn,
        visningsnamn: metadataKatalog.visningsnamn,
        datatyp: metadataKatalog.datatyp,
        vardeString: metadataVarden.vardeString,
        vardeInteger: metadataVarden.vardeInteger,
        vardeDecimal: metadataVarden.vardeDecimal,
        vardeBoolean: metadataVarden.vardeBoolean,
        vardeDatetime: metadataVarden.vardeDatetime,
        vardeJson: metadataVarden.vardeJson,
        vardeReferens: metadataVarden.vardeReferens,
      })
      .from(metadataVarden)
      .innerJoin(metadataKatalog, eq(metadataVarden.metadataKatalogId, metadataKatalog.id))
      .where(
        and(
          eq(metadataVarden.tenantId, tenantId),
          inArray(metadataVarden.workOrderId, woIds),
        ),
      )
      .orderBy(metadataKatalog.area, metadataKatalog.sortOrder);

    for (const m of metaRows) {
      if (!m.workOrderId) continue;
      const value = formatMetadataValue(m);
      if (value == null) continue;
      const label = (m.visningsnamn && m.visningsnamn.trim()) || m.namn;
      if (PHOTO_DATATYPES.has((m.datatyp ?? "").toLowerCase())) {
        const arr = photosByWo.get(m.workOrderId) ?? [];
        arr.push({ url: value, description: label });
        photosByWo.set(m.workOrderId, arr);
      } else {
        const arr = metaByWo.get(m.workOrderId) ?? [];
        arr.push({ label, value });
        metaByWo.set(m.workOrderId, arr);
      }
    }

    const protoRows = await db
      .select({
        workOrderId: protocols.workOrderId,
        before: protocols.beforePhotoUrl,
        after: protocols.afterPhotoUrl,
        additional: protocols.additionalPhotos,
      })
      .from(protocols)
      .where(
        and(eq(protocols.tenantId, tenantId), inArray(protocols.workOrderId, woIds)),
      );
    for (const p of protoRows) {
      if (!p.workOrderId) continue;
      const arr = photosByWo.get(p.workOrderId) ?? [];
      if (p.before) arr.push({ url: p.before, description: "Före" });
      if (p.after) arr.push({ url: p.after, description: "Efter" });
      for (const url of p.additional ?? []) {
        if (url) arr.push({ url, description: null });
      }
      if (arr.length > 0) photosByWo.set(p.workOrderId, arr);
    }
  }

  const nodes: InfoPackageNode[] = [];

  for (const r of woRows) {
    const obj = r.objectId ? objectMeta.get(r.objectId) : undefined;
    const taskType = normalizeTaskType(r.orderType);
    const conceptId = r.objectId ? pointedConceptByObject.get(r.objectId) ?? null : null;
    const concept = conceptId ? conceptById.get(conceptId) ?? null : null;
    const frozen = r.frozenRefs as { rows?: unknown[] } | null;
    const hasFrozen = !!(frozen && Array.isArray(frozen.rows) && frozen.rows.length > 0);
    const invoice = deriveInvoiceConnection(concept, hasFrozen);
    nodes.push({
      id: r.id,
      source: "work_order",
      kind: "historik",
      title: r.title ?? null,
      status: r.status,
      statusLabel: ROUGH_STATUS_LABELS[r.status] ?? "Okänd",
      taskType,
      taskTypeLabel: TASK_TYPE_LABELS[taskType] ?? "Övrigt",
      executionCode: r.executionCode ?? null,
      objectId: r.objectId ?? null,
      objectName: obj?.name ?? null,
      location: obj?.address ?? null,
      city: obj?.city ?? null,
      scheduledDate: toIso(r.scheduledDate) ?? toIso(r.desiredDeliveryStart),
      productionMinutes: r.productionMinutes ?? 0,
      value: r.value ?? 0,
      cost: r.cost ?? 0,
      orderConceptId: invoice.conceptId,
      orderConceptName: invoice.conceptName,
      customerName: r.customerName ?? null,
      invoice,
      metadata: metaByWo.get(r.id) ?? [],
      photos: photosByWo.get(r.id) ?? [],
    });
  }

  // 3. Kommande — assignments (inkl. call_off-avrop, som annars är osynliga).
  const asgRows = await db
    .select({
      id: assignments.id,
      objectId: assignments.objectId,
      title: assignments.title,
      status: assignments.status,
      scheduledDate: assignments.scheduledDate,
      quantity: assignments.quantity,
      value: assignments.cachedValue,
      cost: assignments.cachedCost,
      productionMinutes: assignments.estimatedDuration,
      executionCode: assignments.executionCode,
      orderConceptId: assignments.orderConceptId,
      orderConceptName: orderConcepts.name,
      customerName: customers.name,
    })
    .from(assignments)
    .leftJoin(orderConcepts, eq(assignments.orderConceptId, orderConcepts.id))
    .leftJoin(customers, eq(orderConcepts.customerId, customers.id))
    .where(
      and(
        eq(assignments.tenantId, tenantId),
        inArray(assignments.objectId, objectIds),
        isNull(assignments.deletedAt),
      ),
    )
    .orderBy(desc(assignments.createdAt))
    .limit(MAX_ASSIGNMENTS + 1);
  if (asgRows.length > MAX_ASSIGNMENTS) {
    truncated = true;
    asgRows.length = MAX_ASSIGNMENTS;
  }

  for (const r of asgRows) {
    const obj = r.objectId ? objectMeta.get(r.objectId) : undefined;
    const concept = r.orderConceptId ? conceptById.get(r.orderConceptId) ?? null : null;
    const invoice = deriveInvoiceConnection(concept, false);
    const metadata: InfoPackageMetadataEntry[] = [];
    if (r.quantity != null) metadata.push({ label: "Antal", value: String(r.quantity) });
    nodes.push({
      id: r.id,
      source: "assignment",
      kind: "kommande",
      title: r.title ?? null,
      status: "kommande",
      statusLabel: "Kommande",
      taskType: "ovrigt",
      taskTypeLabel: TASK_TYPE_LABELS.ovrigt ?? "Övrigt",
      executionCode: r.executionCode ?? null,
      objectId: r.objectId ?? null,
      objectName: obj?.name ?? null,
      location: obj?.address ?? null,
      city: obj?.city ?? null,
      scheduledDate: toIso(r.scheduledDate),
      productionMinutes: r.productionMinutes ?? 0,
      value: r.value ?? 0,
      cost: r.cost ?? 0,
      orderConceptId: r.orderConceptId ?? invoice.conceptId,
      orderConceptName: r.orderConceptName ?? invoice.conceptName,
      customerName: r.customerName ?? null,
      invoice,
      metadata,
      photos: [],
    });
  }

  return {
    nodes,
    objectCount: objectIds.length,
    includeChildren,
    truncated,
  };
}
