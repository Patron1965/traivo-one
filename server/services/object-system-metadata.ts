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
//   - Bilder                              → object_images
//   - Felanmälningar                      → public_issue_reports
//   - Betyg                               → technician_ratings (via WO)
import { storage } from "../storage";
import { db } from "../db";
import { and, eq, inArray, isNull, sql, desc } from "drizzle-orm";
import {
  assignments,
  customerCommunications,
  customers,
  orderConcepts,
  resources,
  technicianRatings,
  workOrders,
  workOrderLines,
} from "@shared/schema";
import {
  deriveConceptTargets,
  evaluateConditionsForObject,
} from "./order-concept-targeting";
import { getMetadataValue } from "../metadata-queries";

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

export type ObjectSystemGeneratedMetadata = {
  address: SystemAddressGroup;
  position: SystemPositionGroup;
  pointedInConcepts: PointedInConcept[];
  tasksHistory: SystemTaskHistory[];
  tasksFuture: SystemTaskFuture[];
  images: SystemImage[];
  issueReports: SystemIssueReport[];
  ratings: SystemRating[];
  inspections: SystemInspection[];
  communications: SystemCommunication[];
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
    const { objectIds, clusterIds } = deriveConceptTargets(concept as any);

    let inScope = false;
    if (objectIds.length > 0) {
      for (const rootId of objectIds) {
        const subtree = await getSubtree(rootId);
        if (subtree.has(object.id)) {
          inScope = true;
          break;
        }
      }
    } else if (clusterIds.length > 0) {
      // Legacy kluster-inpekning (under avveckling): billig medlemskoll via
      // objektets clusterId i stället för att ladda hela klustret.
      inScope = !!object.clusterId && clusterIds.includes(object.clusterId);
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
  }));
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

  const address: SystemAddressGroup = {
    gatuadress: object?.address ?? null,
    postnummer: object?.postalCode ?? null,
    ort: object?.city ?? null,
  };

  // Task #1110: What3words läses arvs-medvetet ur metadata-katalogen (icke-system,
  // manuellt skrivbart). Saknas fältet/raden returneras null.
  const what3wordsRaw = await getMetadataValue(
    objectId,
    WHAT3WORDS_METADATA_NAME,
    tenantId,
  );
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

  const [
    pointedInConcepts,
    tasksHistory,
    tasksFuture,
    imagesRaw,
    issuesRaw,
    ratings,
    inspections,
    communications,
  ] = await Promise.all([
    computePointedInConcepts(tenantId, object),
    computeTasksHistory(tenantId, objectId),
    computeTasksFuture(tenantId, objectId),
    storage.getObjectImages(objectId),
    storage.getPublicIssueReports(tenantId, { objectId }),
    computeRatings(tenantId, objectId),
    computeInspections(tenantId, objectId),
    computeCommunications(tenantId, objectId),
  ]);

  const images: SystemImage[] = imagesRaw.map((img) => ({
    id: img.id,
    imageUrl: img.imageUrl,
    description: img.description ?? null,
    imageType: img.imageType ?? null,
    imageDate: toIso(img.imageDate),
  }));

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
    pointedInConcepts,
    tasksHistory,
    tasksFuture,
    images,
    issueReports,
    ratings,
    inspections,
    communications,
  };
}
