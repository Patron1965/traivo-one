// Task #1085: Systemgenererad metadata för ett objekt.
//
// Samlar de fält som är SYSTEMGENERERADE (read-only, "låsta mot manuell krock")
// och som ska visas i objektets metadata-modell i stället för de gamla
// "Ordrar/Rating/Felanmälningar"-sektionerna och special-flikarna.
//
// ARKITEKTUR (objekt-360-memory): inget fabriceras. Varje fält backas av en
// verklig kolumn, en relaterad tabell eller en live-beräkning. Inga nya
// metadata_katalog/metadata_varden-rader skrivs — allt härleds vid läsning.
//
//   - Adress (gatuadress/postnummer/ort)  → objekt-kolumner
//   - Geokodad position (lat/long, entré) → objekt-kolumner satta vid geokodning
//   - Inpekade orderkoncept               → live-compute (delad villkorsmotor)
//   - Kopplade uppgifter (historik)       → work_orders för objektet
//   - Kopplade uppgifter (kommande)       → assignments (planeringslager)
//   - Bilder                              → metadata_varden (datatyp='image', Etapp 5)
//   - Felanmälningar                      → public_issue_reports
//   - Betyg                               → technician_ratings (via WO)
import { storage } from "../storage";
import { db } from "../db";
import { and, eq, inArray, isNull, sql, desc } from "drizzle-orm";
import {
  assignments,
  customerCommunications,
  customers,
  metadataKatalog,
  metadataVarden,
  objects,
  orderConcepts,
  resources,
  technicianRatings,
  workOrders,
  workOrderLines,
  IMPOSSIBLE_REASON_LABELS,
  type ImpossibleReason,
} from "@shared/schema";
import {
  deriveConceptTargets,
  evaluateConditionsForObject,
} from "./order-concept-targeting";
import {
  getObjectWithAllMetadata,
  getObjectGeoFields,
  type ObjectGeoFields,
} from "../metadata-queries";

export type SystemAddressGroup = {
  gatuadress: string | null;
  postnummer: string | null;
  ort: string | null;
};

export type SystemPositionGroup = {
  latitude: number | null;
  longitude: number | null;
  entranceLatitude: number | null;
  entranceLongitude: number | null;
  locationType: string | null;
  geocoded: boolean;
  // Task #1110: What3words är ett SEKUNDÄRT platsfält som backas av användbar
  // (icke-system) metadata — inte en hårdkodad objekt-kolumn. Läses arvs-medvetet
  // via metadata-katalogen (namn "What3words").
  what3words: string | null;
};

// Task #1110: katalognamnet för det återinförda What3words-platsfältet.
export const WHAT3WORDS_METADATA_NAME = "What3words";

// Task #1204 (66): katalognamnet för "Fastighetsägare" — ett arvbart (icke-system)
// metadatafält som läses arvs-medvetet ur metadata-katalogen, samma mönster som
// What3words. Till skillnad från What3words ärvs det nedåt (standardArvs: true).
export const FASTIGHETSAGARE_METADATA_NAME = "Fastighetsägare";

export type PointedInConcept = {
  id: string;
  name: string;
  status: string | null;
  invoiceModel: string | null;
  customerId: string | null;
  customerName: string | null;
};

export type SystemTaskHistory = {
  id: string;
  title: string | null;
  status: string | null;
  orderStatus: string | null;
  scheduledDate: string | null;
  lineCount: number;
  // "Född ur": orderNumber som börjar "SO-" = snabborder; orderConceptId satt =
  // orderkoncept. Klienten härleder ursprungsetiketten + länk från dessa.
  orderNumber: string | null;
  orderConceptId: string | null;
};

export type SystemTaskFuture = {
  id: string;
  title: string | null;
  status: string | null;
  priority: string | null;
  scheduledDate: string | null;
  quantity: number | null;
  orderConceptId: string | null;
  orderConceptName: string | null;
  customerId: string | null;
  customerName: string | null;
  // Task #1205 (fält 54): läsbar matchningsorsak (varför objektet hakades på konceptet).
  matchReason: string | null;
};

export type SystemImage = {
  id: string;
  imageUrl: string;
  description: string | null;
  imageType: string | null;
  imageDate: string | null;
};

export type SystemIssueReport = {
  id: string;
  title: string | null;
  description: string | null;
  category: string | null;
  status: string | null;
  photos: string[] | null;
  createdAt: string | null;
};

export type SystemRating = {
  id: string;
  workOrderId: string | null;
  resourceName: string | null;
  rating: number;
  comment: string | null;
  createdAt: string | null;
};

// Task #1128: Inspektionsresultat — backas av inspection_metadata (objekt-scopat).
export type SystemInspection = {
  id: string;
  inspectionType: string | null;
  status: string | null;
  comment: string | null;
  inspectedBy: string | null;
  inspectedAt: string | null;
};

// Task #1128: Kommunikation — backas av customer_communications (objekt-scopat).
// Endast tenant-scopad läsning; innehåller mottagar-PII → aldrig utanför tenant.
export type SystemCommunication = {
  id: string;
  channel: string | null;
  notificationType: string | null;
  recipientName: string | null;
  subject: string | null;
  aiGenerated: boolean;
  status: string | null;
  sentAt: string | null;
};

// Task #1155 (Feature G): Ej-utförda uppgifter — backas av work_orders med
// orderStatus="omojlig" ("kunde ej utföras"). Systemgenererad (read-only):
// orsak (kod+etikett+fritext), varifrån (uppgiftens titel) och tidpunkt
// (impossibleAt). Härleds vid läsning — inga nya metadata-rader skrivs.
export type SystemUnperformedTask = {
  id: string;
  title: string | null;
  reasonCode: string | null;
  reason: string | null;
  reasonText: string | null;
  impossibleAt: string | null;
  executionCode: string | null;
};

// Task #1370: Systeminformation — read-only teknisk sektion längst ned på
// objektsidan, åtskild från redigerbar metadata. ENBART riktiga objekt-kolumner
// (objekt-360-memory: inget fabriceras):
//   - internalId/objectNumber/status/createdAt/deletedAt → objects-kolumner
//   - parentId/parentName → objects.parent_id (+ namn-lookup)
//   - childCount → count(objects.parent_id = id), tenant-scopat
//   - sourceSystem → härlett ur importBatchId/isInterimObject (riktiga kolumner)
// MEDVETNA UTELÄMNANDEN (dokumenterat beslut): "Versionsnummer" och
// "ändrad datum/av" saknar backing-kolumner på objects (ingen updated_at/
// updated_by) — de utelämnas i stället för att fabriceras.
export type SystemInfoGroup = {
  internalId: string;
  objectNumber: string | null;
  status: string | null;
  createdAt: string | null;
  archivedAt: string | null;
  sourceSystem: string | null;
  importBatchId: string | null;
  parentId: string | null;
  parentName: string | null;
  childCount: number;
  hierarchyDepth: number | null;
};

export type ObjectSystemGeneratedMetadata = {
  address: SystemAddressGroup;
  position: SystemPositionGroup;
  // T005: den kanoniska systemlåsta geografimodellen som TVÅ arvs-medvetna grupper.
  // `address`/`position` ovan behålls (expand-contract) för bakåtkompatibilitet —
  // dessa nya grupper bär KÄLLA/ARV + ownRowId och driver objekthuvud-UI:t (T006).
  standardAddress: ObjectGeoFields["standardAddress"];
  advancedPosition: ObjectGeoFields["advancedPosition"];
  // Task #1204 (66): arvbart fastighetsägare-fält, läst arvs-medvetet ur katalogen.
  propertyOwner: string | null;
  pointedInConcepts: PointedInConcept[];
  tasksHistory: SystemTaskHistory[];
  tasksFuture: SystemTaskFuture[];
  unperformedTasks: SystemUnperformedTask[];
  images: SystemImage[];
  issueReports: SystemIssueReport[];
  ratings: SystemRating[];
  inspections: SystemInspection[];
  communications: SystemCommunication[];
  systemInfo: SystemInfoGroup | null;
};

const toIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;

/**
 * Live-beräknar vilka orderkoncept som "pekar in" på objektet, dvs objektet
 * ligger i konceptets inpekade gren (subträd) ELLER legacy-kluster OCH matchar
 * konceptets villkor. Återanvänder den delade resolvern så resultatet är
 * identiskt med steg 4-förhandsvisning / expansion.
 */
async function computePointedInConcepts(
  tenantId: string,
  object: Awaited<ReturnType<typeof storage.getObject>>,
): Promise<PointedInConcept[]> {
  if (!object) return [];
  const concepts = await storage.getOrderConcepts(tenantId);
  if (concepts.length === 0) return [];

  const subtreeCache = new Map<string, Set<string>>();
  const getSubtree = async (rootId: string): Promise<Set<string>> => {
    const cached = subtreeCache.get(rootId);
    if (cached) return cached;
    const ids = new Set(await storage.getObjectSubtreeIds(tenantId, rootId));
    subtreeCache.set(rootId, ids);
    return ids;
  };

  const matched: PointedInConcept[] = [];
  for (const concept of concepts) {
    if ((concept as any).deletedAt) continue;
    const { objectIds } = deriveConceptTargets(concept as any);

    let inScope = false;
    if (objectIds.length > 0) {
      for (const rootId of objectIds) {
        const subtree = await getSubtree(rootId);
        if (subtree.has(object.id)) {
          inScope = true;
          break;
        }
      }
    }
    if (!inScope) continue;

    const filters = await storage.getConceptFilters(concept.id);
    const filterInput = filters.map((f) => ({
      metadataKey: f.metadataKey,
      operator: f.operator,
      filterValue: f.filterValue,
    }));
    const { matched: passes } = await evaluateConditionsForObject(
      tenantId,
      object as any,
      filterInput,
    );
    if (!passes) continue;

    matched.push({
      id: concept.id,
      name: concept.name,
      status: (concept as any).status ?? null,
      invoiceModel: (concept as any).invoiceModel ?? null,
      customerId: (concept as any).customerId ?? null,
      customerName: null,
    });
  }

  // Berika kundnamn i en batch.
  const customerIds = Array.from(
    new Set(matched.map((m) => m.customerId).filter((x): x is string => !!x)),
  );
  if (customerIds.length > 0) {
    const rows = await db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), inArray(customers.id, customerIds)));
    const nameById = new Map(rows.map((r) => [r.id, r.name]));
    for (const m of matched) {
      if (m.customerId) m.customerName = nameById.get(m.customerId) ?? null;
    }
  }

  return matched;
}

async function computeTasksHistory(
  tenantId: string,
  objectId: string,
): Promise<SystemTaskHistory[]> {
  const allOrders = await storage.getWorkOrders(tenantId, undefined, undefined, true, 500);
  const objectOrders = allOrders.filter((wo) => wo.objectId === objectId).slice(0, 50);
  const orderIds = objectOrders.map((wo) => wo.id);
  const lineCounts = new Map<string, number>();
  if (orderIds.length > 0) {
    const rows = await db
      .select({ workOrderId: workOrderLines.workOrderId, count: sql<number>`count(*)::int` })
      .from(workOrderLines)
      .where(and(eq(workOrderLines.tenantId, tenantId), inArray(workOrderLines.workOrderId, orderIds)))
      .groupBy(workOrderLines.workOrderId);
    for (const r of rows) lineCounts.set(r.workOrderId, Number(r.count) || 0);
  }
  return objectOrders.map((wo) => ({
    id: wo.id,
    title: wo.title ?? null,
    status: wo.status ?? null,
    orderStatus: wo.orderStatus ?? null,
    scheduledDate: toIso(wo.scheduledDate),
    lineCount: lineCounts.get(wo.id) ?? 0,
    orderNumber: wo.orderNumber ?? null,
    orderConceptId: wo.orderConceptId ?? null,
  }));
}

// Task #1155 (Feature G): "kunde ej utföras" = orderStatus "omojlig". De
// strukturerade fälten (impossibleReason/-Text/-At) finns redan på work_orders
// (ingen migration). Presenteras som systemgenererad metadata på objektet.
async function computeUnperformedTasks(
  tenantId: string,
  objectId: string,
): Promise<SystemUnperformedTask[]> {
  const rows = await db
    .select({
      id: workOrders.id,
      title: workOrders.title,
      impossibleReason: workOrders.impossibleReason,
      impossibleReasonText: workOrders.impossibleReasonText,
      impossibleAt: workOrders.impossibleAt,
      scheduledDate: workOrders.scheduledDate,
      executionCode: workOrders.executionCode,
    })
    .from(workOrders)
    .where(and(
      eq(workOrders.tenantId, tenantId),
      eq(workOrders.objectId, objectId),
      eq(workOrders.orderStatus, "omojlig"),
      isNull(workOrders.deletedAt),
    ))
    .orderBy(desc(workOrders.impossibleAt))
    .limit(50);
  return rows.map((r) => {
    const code = r.impossibleReason ?? null;
    const label = code
      ? (IMPOSSIBLE_REASON_LABELS[code as ImpossibleReason] ?? code)
      : null;
    return {
      id: r.id,
      title: r.title ?? null,
      reasonCode: code,
      reason: label,
      reasonText: r.impossibleReasonText ?? null,
      impossibleAt: toIso(r.impossibleAt) ?? toIso(r.scheduledDate),
      executionCode: r.executionCode ?? null,
    };
  });
}

async function computeTasksFuture(
  tenantId: string,
  objectId: string,
): Promise<SystemTaskFuture[]> {
  const rows = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      status: assignments.status,
      priority: assignments.priority,
      scheduledDate: assignments.scheduledDate,
      quantity: assignments.quantity,
      orderConceptId: assignments.orderConceptId,
      orderConceptName: orderConcepts.name,
      customerId: orderConcepts.customerId,
      customerName: customers.name,
      matchReason: assignments.matchReason,
    })
    .from(assignments)
    .leftJoin(orderConcepts, eq(assignments.orderConceptId, orderConcepts.id))
    .leftJoin(customers, eq(orderConcepts.customerId, customers.id))
    .where(and(
      eq(assignments.tenantId, tenantId),
      eq(assignments.objectId, objectId),
      isNull(assignments.deletedAt),
    ))
    .orderBy(desc(assignments.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? null,
    status: r.status ?? null,
    priority: r.priority ?? null,
    scheduledDate: toIso(r.scheduledDate),
    quantity: r.quantity ?? null,
    orderConceptId: r.orderConceptId ?? null,
    orderConceptName: r.orderConceptName ?? null,
    customerId: r.customerId ?? null,
    customerName: r.customerName ?? null,
    matchReason: r.matchReason ?? null,
  }));
}

async function computeRatings(
  tenantId: string,
  objectId: string,
): Promise<SystemRating[]> {
  const rows = await db
    .select({
      id: technicianRatings.id,
      workOrderId: technicianRatings.workOrderId,
      resourceName: resources.name,
      rating: technicianRatings.rating,
      comment: technicianRatings.comment,
      createdAt: technicianRatings.createdAt,
    })
    .from(technicianRatings)
    .innerJoin(workOrders, eq(technicianRatings.workOrderId, workOrders.id))
    .leftJoin(resources, eq(technicianRatings.resourceId, resources.id))
    .where(and(
      eq(technicianRatings.tenantId, tenantId),
      eq(workOrders.tenantId, tenantId),
      eq(workOrders.objectId, objectId),
    ))
    .orderBy(desc(technicianRatings.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    workOrderId: r.workOrderId ?? null,
    resourceName: r.resourceName ?? null,
    rating: r.rating,
    comment: r.comment ?? null,
    createdAt: toIso(r.createdAt),
  }));
}

/**
 * Etapp 5: Bilder läses ur metadata-systemet (metadata_varden med
 * datatyp='image' i katalogen), inte ur gamla object_images-tabellen.
 * Exporteras även för WO-expand-panelen (workOrderRoutes).
 */
export async function getObjectMetadataImages(
  tenantId: string,
  objectId: string,
): Promise<SystemImage[]> {
  const rows = await db
    .select({
      id: metadataVarden.id,
      imageUrl: metadataVarden.vardeString,
      typeName: metadataKatalog.visningsnamn,
      fallbackName: metadataKatalog.namn,
      updatedAt: metadataVarden.updatedAt,
    })
    .from(metadataVarden)
    .innerJoin(metadataKatalog, eq(metadataVarden.metadataKatalogId, metadataKatalog.id))
    .where(and(
      eq(metadataVarden.tenantId, tenantId),
      eq(metadataVarden.objektId, objectId),
      eq(metadataVarden.raderad, false),
      eq(metadataVarden.status, "aktiv"),
      eq(metadataKatalog.datatyp, "image"),
      isNull(metadataKatalog.deletedAt),
    ))
    .orderBy(desc(metadataVarden.updatedAt))
    .limit(100);
  return rows
    .filter((r) => !!r.imageUrl)
    .map((r) => ({
      id: r.id,
      imageUrl: r.imageUrl as string,
      description: r.typeName ?? r.fallbackName ?? null,
      imageType: r.fallbackName ?? null,
      imageDate: toIso(r.updatedAt),
    }));
}

async function computeInspections(
  tenantId: string,
  objectId: string,
): Promise<SystemInspection[]> {
  // storage.getInspectionMetadata är redan tenant+objekt-scopad och sorterad
  // (inspectedAt desc). Kapa till senaste 50.
  const rows = await storage.getInspectionMetadata(tenantId, objectId);
  return rows.slice(0, 50).map((r) => ({
    id: r.id,
    inspectionType: r.inspectionType ?? null,
    status: r.status ?? null,
    comment: r.comment ?? null,
    inspectedBy: r.inspectedBy ?? null,
    inspectedAt: toIso(r.inspectedAt),
  }));
}

async function computeCommunications(
  tenantId: string,
  objectId: string,
): Promise<SystemCommunication[]> {
  // Tenant-scopad läsning (mottagar-PII får aldrig lämna tenant).
  const rows = await db
    .select({
      id: customerCommunications.id,
      channel: customerCommunications.channel,
      notificationType: customerCommunications.notificationType,
      recipientName: customerCommunications.recipientName,
      subject: customerCommunications.subject,
      aiGenerated: customerCommunications.aiGenerated,
      status: customerCommunications.status,
      sentAt: customerCommunications.sentAt,
      createdAt: customerCommunications.createdAt,
    })
    .from(customerCommunications)
    .where(and(
      eq(customerCommunications.tenantId, tenantId),
      eq(customerCommunications.objectId, objectId),
    ))
    .orderBy(desc(customerCommunications.createdAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel ?? null,
    notificationType: r.notificationType ?? null,
    recipientName: r.recipientName ?? null,
    subject: r.subject ?? null,
    aiGenerated: !!r.aiGenerated,
    status: r.status ?? null,
    sentAt: toIso(r.sentAt) ?? toIso(r.createdAt),
  }));
}

/**
 * Bygger objektets systemgenererade metadata-paket. Tenant-ägarkontroll görs av
 * anroparen (routen) — denna funktion antar att objektet redan validerats.
 */
export async function getObjectSystemGeneratedMetadata(
  tenantId: string,
  objectId: string,
): Promise<ObjectSystemGeneratedMetadata> {
  const object = await storage.getObject(objectId);

  // T005: hämta objektets arvs-medvetna metadata EN gång och härled What3words,
  // Fastighetsägare OCH geo-grupperna ur samma ögonblicksbild (undviker 3 separata
  // recursive-CTE:er). owm=null om objektet inte finns i tenanten → fälten degraderas.
  const owm = await getObjectWithAllMetadata(objectId, tenantId);

  const address: SystemAddressGroup = {
    gatuadress: object?.address ?? null,
    postnummer: object?.postalCode ?? null,
    ort: object?.city ?? null,
  };

  // Task #1110/#1204: What3words + Fastighetsägare läses arvs-medvetet ur katalogen
  // (icke-system, manuellt skrivbara). Speglar getMetadataValue:s datatyp-switch.
  const readCatalogValue = (namn: string): unknown => {
    const entry = owm?.metadata.find((m) => m.katalog.namn === namn);
    if (!entry) return null;
    switch (entry.katalog.datatyp) {
      case "string":
        return entry.vardeString;
      case "integer":
        return entry.vardeInteger;
      case "decimal":
        return entry.vardeDecimal;
      case "boolean":
        return entry.vardeBoolean;
      case "datetime":
        return entry.vardeDatetime;
      case "json":
        return entry.vardeJson;
      case "referens":
        return entry.vardeReferens;
      default:
        return null;
    }
  };

  const what3wordsRaw = readCatalogValue(WHAT3WORDS_METADATA_NAME);
  const what3words =
    typeof what3wordsRaw === "string" && what3wordsRaw.trim()
      ? what3wordsRaw.trim()
      : null;

  const position: SystemPositionGroup = {
    latitude: object?.latitude ?? null,
    longitude: object?.longitude ?? null,
    entranceLatitude: object?.entranceLatitude ?? null,
    entranceLongitude: object?.entranceLongitude ?? null,
    locationType: object?.locationType ?? null,
    geocoded: !!(object?.latitude && object?.longitude),
    what3words,
  };

  const fastighetsagareRaw = readCatalogValue(FASTIGHETSAGARE_METADATA_NAME);
  const propertyOwner =
    typeof fastighetsagareRaw === "string" && fastighetsagareRaw.trim()
      ? fastighetsagareRaw.trim()
      : null;

  const [
    geo,
    pointedInConcepts,
    tasksHistory,
    tasksFuture,
    unperformedTasks,
    imagesRaw,
    issuesRaw,
    ratings,
    inspections,
    communications,
  ] = await Promise.all([
    getObjectGeoFields(objectId, tenantId, owm),
    computePointedInConcepts(tenantId, object),
    computeTasksHistory(tenantId, objectId),
    computeTasksFuture(tenantId, objectId),
    computeUnperformedTasks(tenantId, objectId),
    getObjectMetadataImages(tenantId, objectId),
    storage.getPublicIssueReports(tenantId, { objectId }),
    computeRatings(tenantId, objectId),
    computeInspections(tenantId, objectId),
    computeCommunications(tenantId, objectId),
  ]);

  const images: SystemImage[] = imagesRaw;

  // Task #1370: Systeminformation — riktiga objekt-kolumner + förälder/barn.
  let systemInfo: SystemInfoGroup | null = null;
  if (object && object.tenantId === tenantId) {
    const [parentRow, childRow] = await Promise.all([
      object.parentId
        ? db
            .select({ id: objects.id, name: objects.name })
            .from(objects)
            .where(and(eq(objects.tenantId, tenantId), eq(objects.id, object.parentId)))
            .limit(1)
        : Promise.resolve([] as { id: string; name: string | null }[]),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(objects)
        .where(and(
          eq(objects.tenantId, tenantId),
          eq(objects.parentId, objectId),
          isNull(objects.deletedAt),
        )),
    ]);
    // Källsystem härleds ur riktiga kolumner: importBatchId (importerad) och
    // isInterimObject (interim från import). Saknas båda ⇒ skapad i Traivo.
    const sourceSystem = object.importBatchId
      ? "Import"
      : object.isInterimObject
        ? "Import (interim)"
        : "Traivo";
    systemInfo = {
      internalId: object.id,
      objectNumber: object.objectNumber ?? null,
      status: object.deletedAt ? "archived" : (object.status ?? null),
      createdAt: toIso(object.createdAt),
      archivedAt: toIso(object.deletedAt),
      sourceSystem,
      importBatchId: object.importBatchId ?? null,
      parentId: object.parentId ?? null,
      parentName: parentRow[0]?.name ?? null,
      childCount: Number(childRow[0]?.count ?? 0),
      hierarchyDepth: object.hierarchyDepth ?? null,
    };
  }

  const issueReports: SystemIssueReport[] = issuesRaw.map((it) => ({
    id: it.id,
    title: it.title ?? null,
    description: it.description ?? null,
    category: it.category ?? null,
    status: it.status ?? null,
    photos: it.photos ?? null,
    createdAt: toIso(it.createdAt),
  }));

  return {
    address,
    position,
    standardAddress: geo.standardAddress,
    advancedPosition: geo.advancedPosition,
    propertyOwner,
    pointedInConcepts,
    tasksHistory,
    tasksFuture,
    unperformedTasks,
    images,
    issueReports,
    ratings,
    inspections,
    communications,
    systemInfo,
  };
}
