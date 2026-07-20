import { 
  type User, type InsertUser, type UpsertUser,
  type Tenant, type InsertTenant,
  type Customer, type InsertCustomer,
  type CustomerRelationship, type InsertCustomerRelationship,
  type ServiceObject, type InsertObject,
  type Resource, type InsertResource,
  type WorkOrder, type InsertWorkOrder, type WorkOrderWithObject,
  type RoughPlanningSummary,
  type RoughPlanningTyngdpunktWeek,
  type RoughPlanningMapPoint,
  type SetupTimeLog, type InsertSetupTimeLog,
  type Procurement, type InsertProcurement,
  type Article, type InsertArticle,
  type ArticleTypeDefinition, type InsertArticleTypeDefinition,
  type ExecutionCodeDefinition, type InsertExecutionCodeDefinition,
  type TimeCodeDefinition, type InsertTimeCodeDefinition,
  type IconDefinition, type InsertIconDefinition,
  type PriceList, type InsertPriceList,
  type PriceListArticle, type InsertPriceListArticle,
  type ResourceArticle, type InsertResourceArticle,
  type WorkOrderLine, type InsertWorkOrderLine,
  type WorkOrderObject, type InsertWorkOrderObject, workOrderObjects,
  type SimulationScenario, type InsertSimulationScenario,
  type Vehicle, type InsertVehicle,
  type Equipment, type InsertEquipment,
  type ResourceVehicle, type InsertResourceVehicle,
  type ResourceEquipment, type InsertResourceEquipment,
  type ResourceAvailability, type InsertResourceAvailability,
  type VehicleSchedule, type InsertVehicleSchedule,
  type Subscription, type InsertSubscription,
  type Team, type InsertTeam, type TaskType,
  type TeamMember, type InsertTeamMember,
  type PlanningParameter, type InsertPlanningParameter,
  type ResourcePosition, type InsertResourcePosition,
  type OrderStatus,
  type BrandingTemplate, type InsertBrandingTemplate,
  type TenantBranding, type InsertTenantBranding,
  type UserTenantRole, type InsertUserTenantRole,
  type AuditLog, type InsertAuditLog,
  type IndustryPackage, type InsertIndustryPackage,
  type IndustryPackageData, type InsertIndustryPackageData,
  type TenantPackageInstallation, type InsertTenantPackageInstallation,
  type FortnoxConfig, type InsertFortnoxConfig,
  type FortnoxMapping, type InsertFortnoxMapping,
  type FortnoxInvoiceExport, type InsertFortnoxInvoiceExport,
  type FortnoxExportLogEntry, type InsertFortnoxExportLogEntry,
  type ManualInvoiceLine, type InsertManualInvoiceLine,
  type TaskDesiredTimewindow, type InsertTaskDesiredTimewindow,
  type TaskDependency, type InsertTaskDependency,
  type TaskInformation, type InsertTaskInformation,
  type StructuralArticle, type InsertStructuralArticle,
  type OrderConcept, type InsertOrderConcept,
  type ConceptFilter, type InsertConceptFilter,
  type PlannerSearchFilter, type InsertPlannerSearchFilter,
  type ArticleComponent, type InsertArticleComponent,
  type InvoiceRecalculationLog, type InsertInvoiceRecalculationLog,
  type Assignment, type InsertAssignment,
  type AssignmentArticle, type InsertAssignmentArticle,
  type SubscriptionChange, type InsertSubscriptionChange,
  type TaskDependencyTemplate, type InsertTaskDependencyTemplate,
  type TaskDependencyInstance, type InsertTaskDependencyInstance,
  type InvoiceRule, type InsertInvoiceRule,
  type OrderConceptRunLog, type InsertOrderConceptRunLog,
  type OrderConceptObject, type InsertOrderConceptObject,
  type OrderConceptArticle, type InsertOrderConceptArticle,
  type ArticleObjectMapping, type InsertArticleObjectMapping,
  type InvoiceConfiguration, type InsertInvoiceConfiguration,
  type DocumentConfiguration, type InsertDocumentConfiguration,
  type DeliverySchedule, type InsertDeliverySchedule,
  type CustomerPortalToken, type InsertCustomerPortalToken,
  type CustomerPortalSession, type InsertCustomerPortalSession,
  type PortalUser, type InsertPortalUser,
  type PortalUserObjectScope,
  type CustomerBookingRequest, type InsertCustomerBookingRequest,
  type CustomerPortalMessage, type InsertCustomerPortalMessage,
  type CustomerInvoice, type InsertCustomerInvoice,
  type CustomerIssueReport, type InsertCustomerIssueReport,
  type CustomerServiceContract, type InsertCustomerServiceContract,
  type FortnoxContractSuggestion, type InsertFortnoxContractSuggestion,
  type CustomerNotificationSettings, type InsertCustomerNotificationSettings,
  type Protocol, type InsertProtocol,
  type DeviationReport, type InsertDeviationReport,
  type QrCodeLink, type InsertQrCodeLink,
  type PublicIssueReport, type InsertPublicIssueReport,
  type MetadataEditor, type InsertMetadataEditor,
  type MetadataEditorField, type InsertMetadataEditorField,
  type MetadataEditorSubmission, type InsertMetadataEditorSubmission,
  type MetadataEditorSubmissionValue, type InsertMetadataEditorSubmissionValue,
  type CustomerChangeRequest, type InsertCustomerChangeRequest,
  type EnvironmentalData, type InsertEnvironmentalData,
  type VisitConfirmation, type InsertVisitConfirmation,
  type TechnicianRating, type InsertTechnicianRating,
  type PortalMessage, type InsertPortalMessage,
  type SelfBookingSlot, type InsertSelfBookingSlot,
  type SelfBooking, type InsertSelfBooking,
  type InspectionMetadata, type InsertInspectionMetadata,
  type ChecklistTemplate, type InsertChecklistTemplate,
  type DriverNotification, type InsertDriverNotification,
  userNotifications, type UserNotification, type InsertUserNotification,
  userNotificationPreferences, type UserNotificationPreference,
  type OfflineSyncLog, type InsertOfflineSyncLog,
  type FuelLog, type InsertFuelLog,
  type MaintenanceLog, type InsertMaintenanceLog,
  type ObjectParent, type InsertObjectParent,
  type ObjectArticle, type InsertObjectArticle,
  type ResourceProfile, type InsertResourceProfile,
  type ResourceProfileAssignment, type InsertResourceProfileAssignment,
  type WorkSession, type InsertWorkSession,
  type WorkEntry, type InsertWorkEntry,
  type EquipmentBooking, type InsertEquipmentBooking,
  type IotDevice, type InsertIotDevice,
  type IotApiKey, type InsertIotApiKey,
  type IotSignal, type InsertIotSignal,
  workSessions, workEntries, equipmentBookings,
  iotDevices, iotApiKeys, iotSignals, routeFeedback,
  type RouteFeedback, type InsertRouteFeedback,
  inspectionMetadata, checklistTemplates, driverNotifications, offlineSyncLog,
  fuelLogs, maintenanceLogs, objectParents, objectArticles,
  resourceProfiles, resourceProfileAssignments,
  fortnoxConfig, fortnoxMappings, fortnoxInvoiceExports, fortnoxExportLogEntries, manualInvoiceLines,
  users, tenants, customers, customerRelationships, objects, resources, workOrders, setupTimeLogs, procurements,
  articles, articleTypeDefinitions, executionCodeDefinitions, timeCodeDefinitions, iconDefinitions, priceLists, priceListArticles, resourceArticles, workOrderLines, simulationScenarios,
  vehicles, equipment, resourceVehicles, resourceEquipment, resourceAvailability,
  vehicleSchedule, subscriptions, teams, teamMembers, taskTypes, planningParameters,
  resourcePositions,
  brandingTemplates, tenantBranding, userTenantRoles, auditLogs,
  industryPackages, industryPackageData, tenantPackageInstallations,
  taskDesiredTimewindows, taskDependencies, taskInformation, structuralArticles,
  orderConcepts, conceptFilters, plannerSearchFilters, articleComponents, invoiceRecalculationLog, assignments, assignmentArticles, subscriptionChanges,
  productionTimeLists, suppliers, supplierArticleLinks,
  type ProductionTimeList, type InsertProductionTimeList,
  type Supplier, type InsertSupplier,
  type SupplierArticleLink, type InsertSupplierArticleLink,
  taskDependencyTemplates, taskDependencyInstances, invoiceRules, orderConceptRunLogs,
  orderConceptObjects, orderConceptArticles, articleObjectMappings,
  invoiceConfigurations, documentConfigurations, deliverySchedules,
  invoiceRecipients,
  type InvoiceRecipient, type InsertInvoiceRecipient, type InvoiceRecipientLevel,
  invoiceConsolidationPolicies,
  type InvoiceConsolidationPolicy, type InsertInvoiceConsolidationPolicy, type InvoiceConsolidationPeriod,
  customerPortalTokens, customerPortalSessions, customerBookingRequests, customerPortalMessages,
  portalUsers, portalUserObjectScopes,
  customerInvoices, customerIssueReports, customerServiceContracts, fortnoxContractSuggestions, customerNotificationSettings,
  protocols, deviationReports, qrCodeLinks, publicIssueReports, customerChangeRequests, environmentalData,
  metadataEditors, metadataEditorFields, metadataEditorSubmissions, metadataEditorSubmissionValues,
  visitConfirmations, technicianRatings, portalMessages, selfBookingSlots, selfBookings,
  tenantFeatures,
  planningDecisionLog,
  invitations, recurringSlotPatterns,
  customerCommunications,
  type CustomerCommunication,
  type DeliveryPreferences,
  EMPTY_DELIVERY_PREFERENCES,
  deliveryPreferencesSchema,
  // Task #785 — Veckoplanering: datafundament
  weeklyPlans, weeklyPlanTasks, personalTasks, personalTaskSchedules,
  travelTimeEntries, weeklyPlanWarnings, geographicDistricts, districtZones,
  stopClusters, routeClusters,
  planningReservations, type PlanningReservation, type InsertPlanningReservation,
  preTasks, execTypePreTaskRules, disruptions,
  slotTimes, type SlotTime, type InsertSlotTime,
  savedFilters, type SavedFilter, type InsertSavedFilter,
  type WeeklyPlan, type InsertWeeklyPlan,
  type WeeklyPlanTask, type InsertWeeklyPlanTask,
  type PersonalTask, type InsertPersonalTask,
  type PersonalTaskSchedule, type InsertPersonalTaskSchedule,
  type TravelTimeEntry, type InsertTravelTimeEntry,
  type WeeklyPlanWarning, type InsertWeeklyPlanWarning,
  type GeographicDistrict, type InsertGeographicDistrict,
  type DistrictZone, type InsertDistrictZone,
  type PreTask, type InsertPreTask,
  type ExecTypePreTaskRule, type InsertExecTypePreTaskRule,
  type Disruption, type InsertDisruption,
  type ExecutorRegister, type ExecutorRegisterAsset, type ExecutorRegisterPerson, type ExecutorRegisterTeam,
} from "@shared/schema";
import { db } from "./db";
import { eq, ne, and, or, isNull, isNotNull, asc, desc, gte, lte, lt, sql, inArray, notInArray, getTableColumns, type SQL, type SQLWrapper } from "drizzle-orm";

type Condition = SQL | SQLWrapper | undefined;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ExecuteResult = { rows?: unknown[]; rowCount?: number };
function asExecuteResult(r: unknown): ExecuteResult {
  return (r ?? {}) as ExecuteResult;
}
import {
  primaryPayerCustomerIdSql,
  primaryPayerCustomerIdSqlFor,
  objectHasPrimaryCustomerSql,
  objectPrimaryCustomerInSql,
  objectHasNoPrimaryCustomerSql,
  objectHasLinkedTaskSql,
  getObjectPrimaryCustomerId,
  type LinkedTaskFilter,
} from "./services/object-customer";
import { objectMetadataTextValueSql } from "./services/object-metadata-sql";

/**
 * Returnerar en Drizzle "select-shape" för objects där `customerId` är
 * överlagrat med primär-payer-customer_id (härlett ur Ekonomi-metadatat
 * "Kund") istället för den legacy-kolumn `objects.customer_id` som är borta.
 *
 * Använd som `db.select(objectColumnsWithPrimaryCustomer()).from(objects)...`.
 */
function objectColumnsWithPrimaryCustomer() {
  const cols = getTableColumns(objects);
  return { ...cols, customerId: primaryPayerCustomerIdSql() };
}

// Smala typade helpers för neon/drizzle-execute-resultat — driver-formerna
// skiljer sig (neon-http returnerar `rows`, andra returnerar arrayen direkt
// och bär `rowCount` på objektet). Helpers ersätter `as any`-castar i
// plattformsadmin- och GDPR-flödena.
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybe = result as { rows?: unknown };
  return Array.isArray(maybe?.rows) ? (maybe.rows as T[]) : [];
}
function rowCountOf(result: unknown): number {
  const maybe = result as { rowCount?: number | null };
  return Number(maybe?.rowCount ?? 0);
}
import { invalidateWorkflowCaches } from "./services/dashboardCache";
import { inferTeamIdForResource, invalidateTeamInferenceCache } from "./utils/teamInference";
// Task #835: konsoliderad artikelmatchning. legacyHookMatch delas med resolvern → paritet.
import {
  legacyHookMatch,
  evaluateArticleAssociationRules,
  extractDisplayValue as extractMetaDisplayValue,
  type HookObjectContext,
} from "./association-service";
import { getObjectWithAllMetadata, getObjectAtkomstFields } from "./metadata-queries";
import { buildUppgiftspaket } from "./services/uppgiftspaket";
import type { InsertAssignment as InsertAssignmentType } from "@shared/schema";
import { haversineDistanceKm } from "./distance-matrix-service";
import type { AssociationCondition } from "@shared/schema";

export interface ResolvedArticlePrice {
  articleId: string;
  articleNumber: string;
  name: string;
  articleType: string;
  hookLevel: string | null;
  productionTime: number;
  listPrice: number;
  resolvedPrice: number;
  priceSource: string;
  priceListName: string | null;
  isManual: boolean;
  objectArticleId: string | null;
  overridePrice: number | null;
}


export interface CustomerTreeNode {
  id: string;
  name: string;
  parentId: string | null;
  hierarchyLevel: string | null;
  address: string | null;
  hasCoords: boolean;
  childCount: number;
}

export interface CustomerMapPoint {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  hierarchyLevel: string | null;
}

export interface CustomerObjectSearchHit {
  id: string;
  name: string;
  objectNumber: string | null;
  address: string | null;
  hierarchyLevel: string | null;
  parentId: string | null;
  path: Array<{ id: string; name: string; hierarchyLevel: string | null }>;
}

export interface ObjectParentSearchHit {
  id: string;
  name: string;
  objectNumber: string | null;
  address: string | null;
  city: string | null;
  objectType: string | null;
  hierarchyLevel: string | null;
  // Släktnamn-kedja rot → löv (löv = objektet självt).
  path: Array<{ id: string; name: string }>;
}

export interface ObjectParentRelationEnriched {
  id: string;
  objectId: string;
  parentId: string;
  isPrimary: boolean;
  relationContext: string | null;
  createdAt: Date | string | null;
  parentName: string | null;
  // Släktnamn-kedja för föräldern rot → förälder.
  parentPath: Array<{ id: string; name: string }>;
}

export interface CustomerMapAggregate {
  cellKey: string;
  latitude: number;
  longitude: number;
  count: number;
}

export type CustomerMapData =
  | { mode: "points"; points: CustomerMapPoint[]; total: number }
  | { mode: "aggregates"; aggregates: CustomerMapAggregate[]; total: number };


/** Berikningsfakta för en veckoplan-uppgift (join work_orders + objects). */
export interface WeeklyPlanTaskFact {
  taskId: string;
  name: string | null;
  value: number; // öre (cachedValue)
  productionMinutes: number;
  lat: number | null;
  lng: number | null;
  objectId: string | null;
  locationName: string | null;
}

/**
 * Ej planerad kandidat till veckoplanen: en arbetsorder som är grovplanerad
 * (`rough_planned_week`) för teamets vecka men ännu inte tillagd som
 * `weekly_plan_tasks`-block. Används av "Ej planerade"-panelen.
 */
export interface WeeklyPlanCandidate {
  id: string; // work_orders.id
  name: string | null;
  value: number; // öre (cachedValue)
  productionMinutes: number;
  lat: number | null;
  lng: number | null;
  objectId: string | null;
  locationName: string | null;
  orderType: string | null;
}

/** Distriktscentrum för "närmaste ort"-approximation (Task #877). */
interface DistrictCoord {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/**
 * Närmaste distrikt (haversine) till en koordinat — används som proxy för
 * "närmaste ort" i grovplaneringens tyngdpunkt. Returnerar null om koordinaten
 * eller distriktslistan saknas.
 */
function nearestDistrictLabel(
  lat: number | null,
  lng: number | null,
  districts: DistrictCoord[],
): { id: string; name: string } | null {
  if (lat == null || lng == null || districts.length === 0) return null;
  let best: DistrictCoord | null = null;
  let bestDist = Infinity;
  for (const d of districts) {
    const dist = haversineDistanceKm(lat, lng, d.lat, d.lng);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}

// Task #1292: Live-position per aktivt fältteam (utförarläge på kartan).
export interface TeamMemberLivePosition {
  resourceId: string;
  resourceName: string;
  latitude: number;
  longitude: number;
  status: string | null;
  lastUpdate: string;
}

export interface TeamLivePosition {
  teamId: string;
  teamName: string;
  teamColor: string | null;
  resourceIds: string[];
  /** Senast rapporterade positionen bland teamets medlemmar (back-compat). */
  position: TeamMemberLivePosition | null;
  /** Alla medlemmar med känd position (Task #1299: expanderad medlemsvy). */
  memberPositions: TeamMemberLivePosition[];
}

// Task #1298: Dagens färdväg (breadcrumb-spår) per team i utförarläget.
export interface TeamPositionTrail {
  teamId: string;
  teamName: string;
  teamColor: string | null;
  points: Array<{
    latitude: number;
    longitude: number;
    recordedAt: string;
  }>;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getUsersByTenant(tenantId: string): Promise<User[]>;
  listAllUsersWithTenants(): Promise<Array<User & { memberships: Array<{ tenantId: string; tenantName: string; role: string; isActive: boolean | null; assignedBy: string | null }> }>>;
  listAllUsersWithTenantsPaged(opts: { search?: string; limit: number; offset: number }): Promise<{ users: Array<User & { memberships: Array<{ tenantId: string; tenantName: string; role: string; isActive: boolean | null; assignedBy: string | null }> }>; total: number }>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<{ fkImpact: Record<string, number>; lostInviterInvitations: number }>;
  anonymizeUser(id: string): Promise<User | undefined>;
  computeUserResourceImpact(id: string): Promise<Record<string, number>>;
  upsertUser(user: Partial<UpsertUser> & { id: string; email: string }): Promise<User>;
  
  getTenant(id: string): Promise<Tenant | undefined>;
  getPublicTenants(): Promise<Tenant[]>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  ensureTenant(id: string, defaultData: Omit<InsertTenant, 'id'>): Promise<Tenant>;
  updateTenant(id: string, data: Partial<InsertTenant>): Promise<Tenant | undefined>;
  /**
   * Skriver godtyckliga nycklar i `tenants.settings` (jsonb merge). Föredra detta för
   * generisk settings-uppdatering. `updateTenantSmsSettings` finns kvar som typ-säker
   * convenience för SMS-fälten som även lever utanför `settings`-bloben.
   */
  updateTenantSettings(id: string, settings: Record<string, unknown>): Promise<Tenant | undefined>;
  /** Typ-säker variant för SMS-konfig (smsEnabled/smsProvider/smsFromName som top-level kolumner). */
  updateTenantSmsSettings(id: string, data: { smsEnabled?: boolean; smsProvider?: string; smsFromName?: string }): Promise<Tenant | undefined>;
  
  getCustomers(tenantId: string): Promise<Customer[]>;
  getCustomersPaginated(tenantId: string, limit: number, offset: number, search?: string, filters?: { hierarchyType?: string | "none"; rootsOnly?: boolean }): Promise<{ customers: Customer[]; total: number }>;
  getCustomersByIds(tenantId: string, ids: string[]): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | undefined>;
  getCustomerAggregates(tenantId: string, customerIds?: string[]): Promise<Array<{ customerId: string; objectCount: number; activeOrders: number }>>;
  getCustomerTotals(tenantId: string): Promise<{ customerCount: number; objectCount: number; activeOrders: number }>;
  getCustomerStats(tenantId: string, customerId: string): Promise<{
    objectsByLevel: Record<string, number>;
    totalObjects: number;
    activeOrders: number;
    completedOrders: number;
    invoicedOrders: number;
    totalOrders: number;
    activeSubscriptions: number;
    invoicedLast12Months: number;
  }>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  resolveInternalCustomer(tenantId: string): Promise<Customer>;
  updateCustomer(id: string, customer: Partial<InsertCustomer>): Promise<Customer | undefined>;
  deleteCustomer(id: string): Promise<void>;
  restoreCustomer(id: string, tenantId: string): Promise<Customer | undefined>;

  // ADR v3 §2.2: kundhierarki (koncern → region → lokal).
  /** Returnerar omedelbar förälder eller null. Verifierar tenant. */
  getCustomerParent(tenantId: string, customerId: string): Promise<Customer | null>;
  /** Returnerar direkta barn (en nivå ner). */
  getCustomerChildren(tenantId: string, customerId: string): Promise<Customer[]>;
  /** Returnerar förfäder från närmaste förälder upp till roten (max 32 nivåer). */
  getCustomerAncestors(tenantId: string, customerId: string): Promise<Customer[]>;
  /** Returnerar id för alla ättlingar (rekursivt, exkl. self). Max 32 nivåer, cykel-skydd via depth-limit. */
  getCustomerDescendants(tenantId: string, customerId: string): Promise<string[]>;
  /** Rollup-stats per direkt barn-kund inklusive deras ättlingar + self + total. ADR v3 §2.2. */
  getCustomerHierarchyStats(tenantId: string, customerId: string): Promise<{
    self: { objectCount: number; activeOrders: number; ordersLast30Days: number; revenueLast30Days: number };
    rollup: { objectCount: number; activeOrders: number; ordersLast30Days: number; revenueLast30Days: number };
    descendantCount: number;
    children: Array<{
      id: string;
      name: string;
      hierarchyType: string | null;
      isReseller: boolean;
      objectCount: number;
      activeOrders: number;
      ordersLast30Days: number;
      revenueLast30Days: number;
      descendantCount: number;
    }>;
  }>;
  /**
   * Sätter `parent_customer_id`. Kastar Error om: parent saknas, parent
   * tillhör annan tenant, eller om bytet skulle skapa en cykel.
   * `parentId=null` lyfter kunden till fristående/rot.
   */
  setCustomerParent(tenantId: string, customerId: string, parentId: string | null): Promise<Customer>;

  // ADR v3 §2.2: icke-ägar-relationer (återförsäljare etc).
  getCustomerRelationships(tenantId: string, customerId: string): Promise<{
    outgoing: CustomerRelationship[];
    incoming: CustomerRelationship[];
  }>;
  createCustomerRelationship(data: InsertCustomerRelationship): Promise<CustomerRelationship>;
  deleteCustomerRelationship(tenantId: string, id: string): Promise<void>;
  
  /** Föredragen API: hämtar samtliga objekt för en tenant. */
  getObjects(tenantId: string): Promise<ServiceObject[]>;
  getObjectsPaginated(tenantId: string, limit: number, offset: number, search?: string, customerIds?: string[], filters?: { objectType?: string; hierarchyLevel?: string; isInterimObject?: boolean; issue?: string; reported?: boolean; locationType?: string; linkedTask?: LinkedTaskFilter }): Promise<{ objects: ServiceObject[]; total: number }>;
  getObjectsByIds(tenantId: string, ids: string[]): Promise<ServiceObject[]>;
  getObjectsWithIssues(tenantId: string, options?: { issueType?: string; status?: string; customerId?: string; limit?: number }): Promise<{
    totalObjectsWithIssues: number;
    issueTypes: Record<string, number>;
    objects: Array<{
      object: ServiceObject;
      issueType: string;
      issueCount: number;
      latestIssue: Date | null;
      severity?: string;
      details: Array<{ id: string; title: string; status: string; reportedAt: Date; severity: string | null }>;
    }>;
  }>;
  getObject(id: string): Promise<ServiceObject | undefined>;
  getObjectByObjectNumber(tenantId: string, objectNumber: string): Promise<ServiceObject | undefined>;
  getObjectsByCustomer(customerId: string, tenantId?: string): Promise<ServiceObject[]>;
  getCustomerObjectTreeRoots(customerId: string, tenantId: string): Promise<CustomerTreeNode[]>;
  getCustomerObjectTreeChildren(customerId: string, tenantId: string, parentId: string): Promise<CustomerTreeNode[]>;
  getCustomerObjectMapPoints(customerId: string, tenantId: string, opts?: { bbox?: [number, number, number, number]; limit?: number }): Promise<CustomerMapPoint[]>;
  searchCustomerObjects(customerId: string, tenantId: string, query: string, limit?: number): Promise<CustomerObjectSearchHit[]>;
  searchObjectsForParent(tenantId: string, query: string, opts?: { excludeObjectId?: string; limit?: number }): Promise<ObjectParentSearchHit[]>;
  getCustomerObjectMapData(customerId: string, tenantId: string, opts: { bbox?: [number, number, number, number]; zoom: number; limit?: number }): Promise<CustomerMapData>;
  createObject(object: InsertObject, tx?: DbTransaction): Promise<ServiceObject>;
  updateObject(id: string, object: Partial<InsertObject>): Promise<ServiceObject | undefined>;
  deleteObject(id: string): Promise<void>;
  getResources(tenantId: string): Promise<Resource[]>;
  getResourcesPaginated(tenantId: string, limit: number, offset: number, search?: string): Promise<{ resources: Resource[]; total: number }>;
  getResource(id: string): Promise<Resource | undefined>;
  createResource(resource: InsertResource): Promise<Resource>;
  updateResource(id: string, resource: Partial<InsertResource>): Promise<Resource | undefined>;
  deleteResource(id: string): Promise<void>;
  
  /**
   * Hämtar arbetsorder för en tenant utan paginering. Använd för bakgrundsjobb
   * (disruption/optimization/anomaly) där man behöver hela mängden, eller för små
   * dataset. För UI-listor: använd {@link getWorkOrdersPaginated}.
   */
  getWorkOrders(tenantId: string, startDate?: Date, endDate?: Date, includeUnscheduled?: boolean, limit?: number): Promise<WorkOrderWithObject[]>;
  /** Fritextsökning av aktiva ordrar för planerarens "Hitta order" — utan datumgränser, max `limit` träffar. */
  searchActiveWorkOrders(tenantId: string, query: string, limit?: number): Promise<Array<{ id: string; title: string | null; objectName: string | null; objectAddress: string | null; customerName: string | null; externalReference: string | null; executionCode: string | null; scheduledDate: string | null; resourceId: string | null; teamId: string | null; orderStatus: string }>>;
  getWorkOrdersByExternalRefs(tenantId: string, refs: string[]): Promise<Array<{ id: string; externalReference: string | null; modusId: string | null; metadata: unknown }>>;
  /**
   * Grovplanering-aggregat per vecka (Task #795). Returnerar färdiga summor per
   * team, distrikt och status — ingen orderlista skickas till klienten.
   */
  getRoughPlanningSummary(tenantId: string, week: string, districtId?: string): Promise<RoughPlanningSummary>;
  /**
   * Paginerad lista av aktiva ordrar som ännu inte grovplanerats (Task #795):
   * `rough_planned_week IS NULL` och status inte terminal (utford/fakturerad/
   * omojlig/avbruten).
   */
  getUnplannedRoughWorkOrders(tenantId: string, limit: number, offset: number, search?: string): Promise<{ workOrders: WorkOrderWithObject[]; total: number }>;
  /**
   * Oplanerade ordrar inom en radie (km) från en koordinat (Task #899). Återanvänder
   * grundfiltret för grovplanering + haversine och returnerar närmast först med
   * `distanceKm`. Bounding-box-prefilter i SQL håller kandidatmängden begränsad.
   */
  getUnplannedRoughNearby(tenantId: string, lat: number, lng: number, radiusKm: number, limit: number): Promise<Array<WorkOrderWithObject & { distanceKm: number }>>;
  /**
   * Flerveckors geografisk tyngdpunkt (Task #877). Returnerar en rad per
   * begärd vecka (saknade veckor fylls med nollor) med centroid + närmaste
   * distrikt. Flyktigt — ingen DB-persistering.
   */
  getRoughPlanningTyngdpunktOverview(tenantId: string, weeks: string[], districtId?: string): Promise<RoughPlanningTyngdpunktWeek[]>;
  /**
   * Kart-punkter för grovplanerade ordrar en vecka (Task #877): grovplanerade
   * ordrar (`rough_planned_week = week`) med koordinater, ev. distriktsfiltrerat.
   */
  getRoughPlanningMapPoints(tenantId: string, week: string, districtId?: string): Promise<RoughPlanningMapPoint[]>;
  getUnscheduledWorkOrders(tenantId: string, limit?: number): Promise<WorkOrderWithObject[]>;
  /**
   * Task #854: tidslinje-data för ett objekt + hela dess underträd. Resolvar
   * subträdet via rekursiv CTE (parentId) och returnerar schemalagda
   * arbetsordrar inom [startDate, endDate], tenant-scopat, ordnade på datum.
   */
  getObjectSubtreeTimeline(tenantId: string, rootObjectId: string, startDate: Date, endDate: Date): Promise<WorkOrderWithObject[]>;
  /** Subträds-id:n (self + ättlingar) via rekursiv CTE, tenant-scopat, exkl. soft-deletade. */
  getObjectSubtreeIds(tenantId: string, rootObjectId: string): Promise<string[]>;
  /** Schemalagda arbetsordrar för en explicit mängd objekt-id:n inom [startDate, endDate], tenant-scopat. */
  getWorkOrdersForObjectIds(tenantId: string, objectIds: string[], startDate: Date, endDate: Date): Promise<WorkOrderWithObject[]>;
  getUnscheduledWorkOrdersPaginated(tenantId: string, limit: number, offset: number, search?: string, dateFilter?: { field: 'desired' | 'created' | 'sla'; from?: string; to?: string }): Promise<{ workOrders: WorkOrderWithObject[]; total: number; missingDateFieldCount?: number }>;
  getUnscheduledMissingDateField(tenantId: string, field: 'desired' | 'sla', search?: string, limit?: number): Promise<WorkOrderWithObject[]>;
  /** Paginerad variant av {@link getWorkOrders} — föredragen för UI/list-vyer. */
  getWorkOrdersPaginated(tenantId: string, limit: number, offset: number, startDate?: Date, endDate?: Date, includeUnscheduled?: boolean, status?: string): Promise<{ workOrders: WorkOrderWithObject[]; total: number }>;
  bulkUnscheduleWorkOrders(tenantId: string, startDate: Date, endDate: Date, resourceIds?: string[]): Promise<number>;
  getWorkOrder(id: string): Promise<WorkOrder | undefined>;
  getWorkOrdersByResource(resourceId: string, startDate?: Date, endDate?: Date): Promise<WorkOrder[]>;
  getWorkOrdersByDate(tenantId: string, date: Date): Promise<WorkOrder[]>;
  getWorkOrderCounts(tenantId: string): Promise<{ overdue: number; todayPending: number; total: number }>;
  getActiveResourceCount(tenantId: string): Promise<number>;
  createWorkOrder(workOrder: InsertWorkOrder): Promise<WorkOrder>;
  createWorkOrderWithLines(
    workOrder: InsertWorkOrder,
    lines: Omit<InsertWorkOrderLine, "workOrderId" | "tenantId">[],
    opts?: { assignOrderNumber?: boolean },
  ): Promise<{ workOrder: WorkOrder; lines: WorkOrderLine[] }>;
  previewNextWorkOrderNumber(tenantId: string): Promise<string>;
  updateWorkOrder(id: string, workOrder: Partial<InsertWorkOrder>): Promise<WorkOrder | undefined>;
  deleteWorkOrder(id: string, opts?: { reason?: string; userId?: string | null }): Promise<void>;
  restoreWorkOrder(id: string): Promise<WorkOrder | undefined>;
  listArchivedWorkOrders(tenantId: string): Promise<Array<WorkOrder & { objectName: string | null; objectNumber: string | null }>>;
  getWorkOrderByModusId(tenantId: string, modusId: string): Promise<WorkOrder | undefined>;
  getRecentWorkOrdersForObject(tenantId: string, objectId: string, excludeId: string, limit?: number): Promise<WorkOrder[]>;
  getCustomerCommunicationsByWorkOrder(tenantId: string, workOrderId: string, limit?: number): Promise<CustomerCommunication[]>;

  createSetupTimeLog(log: InsertSetupTimeLog): Promise<SetupTimeLog>;
  getSetupTimeLogs(tenantId: string, objectId?: string): Promise<SetupTimeLog[]>;
  
  getProcurements(tenantId: string): Promise<Procurement[]>;
  getProcurement(id: string): Promise<Procurement | undefined>;
  createProcurement(procurement: InsertProcurement): Promise<Procurement>;
  updateProcurement(id: string, procurement: Partial<InsertProcurement>): Promise<Procurement | undefined>;
  deleteProcurement(id: string): Promise<void>;
  
  // Articles
  getArticles(tenantId: string): Promise<Article[]>;
  getArticlesPaginated(tenantId: string, limit: number, offset: number, search?: string, filters?: { articleType?: string; hookLevel?: string }): Promise<{ articles: Article[]; total: number }>;
  getArticle(id: string): Promise<Article | undefined>;
  getArticleByNumber(tenantId: string, articleNumber: string, excludeId?: string): Promise<Article | undefined>;
  getApplicableArticlesForObject(tenantId: string, objectId: string): Promise<Article[]>;
  createArticle(article: InsertArticle): Promise<Article>;
  updateArticle(id: string, article: Partial<InsertArticle>): Promise<Article | undefined>;
  deleteArticle(id: string): Promise<void>;

  // Article type registry (Task #834) — per-tenant katalog över artikeltyper
  getArticleTypeDefinitions(tenantId: string): Promise<ArticleTypeDefinition[]>;
  getArticleTypeDefinition(id: string, tenantId: string): Promise<ArticleTypeDefinition | undefined>;
  createArticleTypeDefinition(data: InsertArticleTypeDefinition): Promise<ArticleTypeDefinition>;
  updateArticleTypeDefinition(id: string, tenantId: string, patch: Partial<InsertArticleTypeDefinition>): Promise<ArticleTypeDefinition | undefined>;
  archiveArticleTypeDefinition(id: string, tenantId: string): Promise<void>;
  getArticleTypeUsageCount(tenantId: string, key: string): Promise<number>;
  seedArticleTypeDefinitions(tenantId: string): Promise<void>;

  // Execution code registry (Task #942) — per-tenant katalog över utförandekoder
  getExecutionCodeDefinitions(tenantId: string): Promise<ExecutionCodeDefinition[]>;
  getExecutionCodeDefinition(id: string, tenantId: string): Promise<ExecutionCodeDefinition | undefined>;
  createExecutionCodeDefinition(data: InsertExecutionCodeDefinition): Promise<ExecutionCodeDefinition>;
  updateExecutionCodeDefinition(id: string, tenantId: string, patch: Partial<InsertExecutionCodeDefinition>): Promise<ExecutionCodeDefinition | undefined>;
  archiveExecutionCodeDefinition(id: string, tenantId: string): Promise<void>;
  getExecutionCodeUsageCount(tenantId: string, key: string): Promise<number>;
  seedExecutionCodeDefinitions(tenantId: string): Promise<void>;

  // Time code registry (Tidskoder) — per-tenant register över tidskoder (grupp + prioritet)
  getTimeCodeDefinitions(tenantId: string): Promise<TimeCodeDefinition[]>;
  getTimeCodeDefinition(id: string, tenantId: string): Promise<TimeCodeDefinition | undefined>;
  createTimeCodeDefinition(data: InsertTimeCodeDefinition): Promise<TimeCodeDefinition>;
  updateTimeCodeDefinition(id: string, tenantId: string, patch: Partial<InsertTimeCodeDefinition>): Promise<TimeCodeDefinition | undefined>;
  archiveTimeCodeDefinition(id: string, tenantId: string): Promise<void>;
  getTimeCodeUsageCount(tenantId: string, key: string): Promise<number>;
  seedTimeCodeDefinitions(tenantId: string): Promise<void>;

  // Icon registry (Task #942) — per-tenant katalog över namngivna ikoner
  getIconDefinitions(tenantId: string): Promise<IconDefinition[]>;
  getIconDefinition(id: string, tenantId: string): Promise<IconDefinition | undefined>;
  createIconDefinition(data: InsertIconDefinition): Promise<IconDefinition>;
  updateIconDefinition(id: string, tenantId: string, patch: Partial<InsertIconDefinition>): Promise<IconDefinition | undefined>;
  archiveIconDefinition(id: string, tenantId: string): Promise<void>;
  getIconUsageCount(tenantId: string, key: string): Promise<number>;
  seedIconDefinitions(tenantId: string): Promise<void>;

  // Object Articles (manual article links)
  getObjectArticles(tenantId: string, objectId: string): Promise<ObjectArticle[]>;
  addObjectArticle(data: InsertObjectArticle): Promise<ObjectArticle>;
  removeObjectArticle(tenantId: string, objectId: string, id: string): Promise<boolean>;
  updateObjectArticlePrice(tenantId: string, objectId: string, id: string, overridePrice: number | null): Promise<ObjectArticle | undefined>;
  
  // Resolved article prices
  getResolvedArticlePricesForObject(tenantId: string, objectId: string): Promise<ResolvedArticlePrice[]>;
  
  // Price Lists
  getPriceLists(tenantId: string): Promise<PriceList[]>;
  getPriceListsPaginated(tenantId: string, limit: number, offset: number, search?: string): Promise<{ priceLists: PriceList[]; total: number }>;
  getPriceList(id: string): Promise<PriceList | undefined>;
  createPriceList(priceList: InsertPriceList): Promise<PriceList>;
  updatePriceList(id: string, priceList: Partial<InsertPriceList>): Promise<PriceList | undefined>;
  deletePriceList(id: string): Promise<void>;
  
  // Price List Articles
  getPriceListArticles(priceListId: string): Promise<PriceListArticle[]>;
  getPriceListArticle(id: string): Promise<PriceListArticle | undefined>;
  createPriceListArticle(priceListArticle: InsertPriceListArticle): Promise<PriceListArticle>;
  updatePriceListArticle(id: string, data: Partial<InsertPriceListArticle>): Promise<PriceListArticle | undefined>;
  deletePriceListArticle(id: string): Promise<void>;
  
  // Resource Articles (resurskompetenser)
  getResourceArticles(resourceId: string): Promise<ResourceArticle[]>;
  getResourceArticle(id: string): Promise<ResourceArticle | undefined>;
  createResourceArticle(resourceArticle: InsertResourceArticle): Promise<ResourceArticle>;
  updateResourceArticle(id: string, data: Partial<InsertResourceArticle>): Promise<ResourceArticle | undefined>;
  deleteResourceArticle(id: string): Promise<void>;
  
  // Work Order Lines
  getWorkOrderLines(workOrderId: string): Promise<WorkOrderLine[]>;
  createWorkOrderLine(line: InsertWorkOrderLine, options?: { skipRecalc?: boolean }): Promise<WorkOrderLine>;
  updateWorkOrderLine(id: string, data: Partial<InsertWorkOrderLine>, options?: { skipRecalc?: boolean }): Promise<WorkOrderLine | undefined>;
  deleteWorkOrderLine(id: string, options?: { skipRecalc?: boolean }): Promise<void>;
  getWorkOrderLine(id: string): Promise<WorkOrderLine | undefined>;
  
  // Work Order Objects
  getWorkOrderObjects(workOrderId: string): Promise<WorkOrderObject[]>;
  getWorkOrderObject(id: string): Promise<WorkOrderObject | undefined>;
  createWorkOrderObject(data: InsertWorkOrderObject): Promise<WorkOrderObject>;
  deleteWorkOrderObject(id: string): Promise<void>;
  
  // Simulation Scenarios
  getSimulationScenarios(tenantId: string): Promise<SimulationScenario[]>;
  getSimulationScenario(id: string): Promise<SimulationScenario | undefined>;
  createSimulationScenario(scenario: InsertSimulationScenario): Promise<SimulationScenario>;
  updateSimulationScenario(id: string, data: Partial<InsertSimulationScenario>): Promise<SimulationScenario | undefined>;
  deleteSimulationScenario(id: string): Promise<void>;
  
  // Order Stock (with filters and pagination)
  getOrderStock(tenantId: string, options?: {
    includeSimulated?: boolean;
    scenarioId?: string;
    orderStatus?: OrderStatus;
    activeOnly?: boolean;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    pageSize?: number;
    search?: string;
    metadataFilters?: { metadataName: string; operator: string; value: string }[];
  }): Promise<{ orders: WorkOrder[]; total: number; byStatus: Record<string, number>; aggregates: { totalValue: number; totalCost: number; totalProductionMinutes: number } }>;
  
  // Price Resolution
  resolveArticlePrice(tenantId: string, articleId: string, customerId: string, date?: Date): Promise<{
    price: number;
    cost: number;
    productionMinutes: number;
    priceListId: string | null;
    source: 'rabattbrev' | 'kundunik' | 'generell' | 'listprice';
  }>;

  resolveArticlePriceFromList(tenantId: string, articleId: string, priceListId: string): Promise<{
    price: number;
    cost: number;
    productionMinutes: number;
    priceListId: string | null;
    source: string;
  }>;
  
  // Update work order status
  updateWorkOrderStatus(id: string, newStatus: OrderStatus): Promise<WorkOrder | undefined>;
  
  // Recalculate work order totals from lines
  recalculateWorkOrderTotals(workOrderId: string): Promise<WorkOrder | undefined>;

  // Recalculate work order totals for many orders at once
  recalculateWorkOrderTotalsBulk(workOrderIds: string[]): Promise<{ recalculated: number; changed: number }>;
  
  // System Dashboard - Branding Templates
  getBrandingTemplates(): Promise<BrandingTemplate[]>;
  getBrandingTemplate(id: string): Promise<BrandingTemplate | undefined>;
  getBrandingTemplateBySlug(slug: string): Promise<BrandingTemplate | undefined>;
  createBrandingTemplate(template: InsertBrandingTemplate): Promise<BrandingTemplate>;
  updateBrandingTemplate(id: string, data: Partial<InsertBrandingTemplate>): Promise<BrandingTemplate | undefined>;
  deleteBrandingTemplate(id: string): Promise<void>;
  incrementTemplateUsage(id: string): Promise<void>;
  
  // System Dashboard - Tenant Branding
  getTenantBranding(tenantId: string): Promise<TenantBranding | undefined>;
  createTenantBranding(branding: InsertTenantBranding): Promise<TenantBranding>;
  updateTenantBranding(tenantId: string, data: Partial<InsertTenantBranding>): Promise<TenantBranding | undefined>;
  publishTenantBranding(tenantId: string): Promise<TenantBranding | undefined>;
  
  // System Dashboard - User Tenant Roles
  getUserTenantRoles(tenantId: string): Promise<(UserTenantRole & { user: User | null })[]>;
  getUserTenantRole(userId: string, tenantId: string): Promise<UserTenantRole | undefined>;
  getUserRolesForUser(userId: string): Promise<UserTenantRole[]>;
  createUserTenantRole(role: InsertUserTenantRole): Promise<UserTenantRole>;
  updateUserTenantRole(id: string, data: Partial<InsertUserTenantRole>): Promise<UserTenantRole | undefined>;
  deleteUserTenantRole(id: string): Promise<void>;
  isOwner(userId: string, tenantId: string): Promise<boolean>;
  
  // System Dashboard - Audit Logs
  getAuditLogs(tenantId: string, options?: { limit?: number; offset?: number; action?: string; userId?: string; resourceType?: string; resourceId?: string }): Promise<AuditLog[]>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  deleteOldAuditLogs(opts: { loginOlderThanDays: number; otherOlderThanDays: number }): Promise<{ loginDeleted: number; otherDeleted: number }>;
  
  // Industry Packages
  getIndustryPackages(): Promise<IndustryPackage[]>;
  getIndustryPackage(id: string): Promise<IndustryPackage | undefined>;
  getIndustryPackageBySlug(slug: string): Promise<IndustryPackage | undefined>;
  createIndustryPackage(pkg: InsertIndustryPackage): Promise<IndustryPackage>;
  getIndustryPackageData(packageId: string): Promise<IndustryPackageData[]>;
  createIndustryPackageData(data: InsertIndustryPackageData): Promise<IndustryPackageData>;
  getTenantPackageInstallations(tenantId: string): Promise<TenantPackageInstallation[]>;
  createTenantPackageInstallation(installation: InsertTenantPackageInstallation): Promise<TenantPackageInstallation>;
  
  // Resource Position Tracking
  // (TeamLivePosition — Task #1292, se interface-deklarationen ovanför IStorage)
  updateResourcePosition(resourceId: string, position: { currentLatitude: number; currentLongitude: number; lastPositionUpdate: Date; trackingStatus: string }): Promise<Resource | undefined>;
  createResourcePosition(position: InsertResourcePosition): Promise<ResourcePosition>;
  getResourcePositions(resourceId: string, startDate?: Date, endDate?: Date): Promise<ResourcePosition[]>;
  getActiveResourcePositions(tenantId: string): Promise<Resource[]>;
  getAllActiveResourcePositions(): Promise<Resource[]>;
  getTeamLivePositions(tenantId: string): Promise<TeamLivePosition[]>;
  // (TeamPositionTrail — Task #1298, dagens färdväg per team)
  getTeamPositionTrails(tenantId: string, startDate: Date, endDate: Date): Promise<TeamPositionTrail[]>;
  
  // Fortnox Config
  getFortnoxConfig(tenantId: string): Promise<FortnoxConfig | undefined>;
  createFortnoxConfig(config: InsertFortnoxConfig): Promise<FortnoxConfig>;
  updateFortnoxConfig(tenantId: string, data: Partial<InsertFortnoxConfig>): Promise<FortnoxConfig | undefined>;
  
  // Fortnox Mappings
  getFortnoxMappings(tenantId: string, entityType?: string): Promise<FortnoxMapping[]>;
  getFortnoxMapping(tenantId: string, entityType: string, unicornId: string): Promise<FortnoxMapping | undefined>;
  createFortnoxMapping(mapping: InsertFortnoxMapping): Promise<FortnoxMapping>;
  updateFortnoxMapping(id: string, tenantId: string, data: Partial<InsertFortnoxMapping>): Promise<FortnoxMapping | undefined>;
  deleteFortnoxMapping(id: string, tenantId: string): Promise<void>;
  /**
   * Tar bort alla Fortnox-mappningar som pekar på en specifik unicorn-entitet
   * (customer/article/resource). Anropas från delete-flöden så att mappningen
   * inte blir föräldralös när målraden soft/hard-raderas. Idempotent.
   */
  deleteFortnoxMappingsForEntity(entityType: "customer" | "article" | "resource", unicornId: string): Promise<number>;
  /**
   * Städar bort föräldralösa Fortnox-mappningar för entity_types vi mappar mot
   * tenant-tabeller (customer/article/resource). Lämnar costcenter/project i fred.
   * Returnerar antal raderade rader per entitetstyp. Om `tenantId` utelämnas
   * körs det globalt över alla tenants. Säker att köra periodiskt.
   */
  cleanupOrphanFortnoxMappings(tenantId?: string): Promise<{ customer: number; article: number; resource: number; total: number }>;

  // Fortnox Invoice Exports
  getFortnoxInvoiceExports(tenantId: string, status?: string): Promise<FortnoxInvoiceExport[]>;
  getFortnoxInvoiceExport(id: string): Promise<FortnoxInvoiceExport | undefined>;
  createFortnoxInvoiceExport(invoiceExport: InsertFortnoxInvoiceExport): Promise<FortnoxInvoiceExport>;
  updateFortnoxInvoiceExport(id: string, tenantId: string, data: Partial<InsertFortnoxInvoiceExport>): Promise<FortnoxInvoiceExport | undefined>;
  // Task #1243: atomisk claim (pending|failed -> processing) — förhindrar dubbel-export
  // vid samtidiga/upprepade anrop (t.ex. timeout+retry). Returnerar undefined om
  // exporten redan är under bearbetning/klar (annan status) — anroparen ska då
  // behandla det som "redan hanterat", inte som fel.
  claimFortnoxInvoiceExportForProcessing(id: string, tenantId: string): Promise<FortnoxInvoiceExport | undefined>;
  createFortnoxExportLogEntry(entry: InsertFortnoxExportLogEntry): Promise<FortnoxExportLogEntry>;
  getFortnoxExportLogEntries(exportId: string, tenantId: string): Promise<FortnoxExportLogEntry[]>;
  
  // Manual Invoice Lines
  getManualInvoiceLines(tenantId: string, customerId?: string, status?: string): Promise<ManualInvoiceLine[]>;
  getManualInvoiceLine(id: string): Promise<ManualInvoiceLine | undefined>;
  createManualInvoiceLine(line: InsertManualInvoiceLine): Promise<ManualInvoiceLine>;
  updateManualInvoiceLine(id: string, tenantId: string, data: Partial<InsertManualInvoiceLine>): Promise<ManualInvoiceLine | undefined>;
  deleteManualInvoiceLine(id: string, tenantId: string): Promise<void>;
  
  // Task Desired Timewindows
  getTaskTimewindows(workOrderId: string): Promise<TaskDesiredTimewindow[]>;
  getTaskTimewindowsBatch(workOrderIds: string[]): Promise<Record<string, TaskDesiredTimewindow[]>>;
  createTaskTimewindow(timewindow: InsertTaskDesiredTimewindow): Promise<TaskDesiredTimewindow>;
  updateTaskTimewindow(id: string, workOrderId: string, tenantId: string, data: Partial<InsertTaskDesiredTimewindow>): Promise<TaskDesiredTimewindow | undefined>;
  deleteTaskTimewindow(id: string, workOrderId: string, tenantId: string): Promise<void>;
  
  // Task Dependencies
  getTaskDependencies(workOrderId: string): Promise<TaskDependency[]>;
  getTaskDependents(workOrderId: string): Promise<TaskDependency[]>;
  getTaskDependenciesBatch(workOrderIds: string[]): Promise<{
    dependencies: Record<string, TaskDependency[]>;
    dependents: Record<string, TaskDependency[]>;
  }>;
  createTaskDependency(dependency: InsertTaskDependency): Promise<TaskDependency>;
  deleteTaskDependency(id: string, tenantId: string): Promise<void>;
  
  // Task Information
  getTaskInformation(workOrderId: string): Promise<TaskInformation[]>;
  createTaskInformation(info: InsertTaskInformation): Promise<TaskInformation>;
  updateTaskInformation(id: string, workOrderId: string, tenantId: string, data: Partial<InsertTaskInformation>): Promise<TaskInformation | undefined>;
  deleteTaskInformation(id: string, workOrderId: string, tenantId: string): Promise<void>;
  

  // Structural Articles
  getStructuralArticles(tenantId: string): Promise<StructuralArticle[]>;
  getStructuralArticlesByParent(parentArticleId: string): Promise<StructuralArticle[]>;
  createStructuralArticle(article: InsertStructuralArticle): Promise<StructuralArticle>;
  updateStructuralArticle(id: string, tenantId: string, data: Partial<InsertStructuralArticle>): Promise<StructuralArticle | undefined>;
  deleteStructuralArticle(id: string, tenantId: string): Promise<void>;
  
  // Order Concepts
  getOrderConcepts(tenantId: string): Promise<OrderConcept[]>;
  getOrderConcept(id: string): Promise<OrderConcept | undefined>;
  createOrderConcept(concept: InsertOrderConcept): Promise<OrderConcept>;
  updateOrderConcept(id: string, tenantId: string, data: Partial<InsertOrderConcept>): Promise<OrderConcept | undefined>;
  deleteOrderConcept(id: string, tenantId: string): Promise<void>;
  
  // Concept Filters
  getConceptFilters(orderConceptId: string): Promise<ConceptFilter[]>;
  createConceptFilter(filter: InsertConceptFilter): Promise<ConceptFilter>;
  updateConceptFilter(id: string, orderConceptId: string, data: Partial<InsertConceptFilter>): Promise<ConceptFilter | undefined>;
  deleteConceptFilter(id: string, orderConceptId: string): Promise<void>;

  // ADR v3 (F3): Planner Search Filters
  getPlannerSearchFilters(tenantId: string, userId?: string): Promise<PlannerSearchFilter[]>;
  getPlannerSearchFilter(id: string, tenantId: string): Promise<PlannerSearchFilter | undefined>;
  createPlannerSearchFilter(filter: InsertPlannerSearchFilter): Promise<PlannerSearchFilter>;
  updatePlannerSearchFilter(id: string, tenantId: string, data: Partial<InsertPlannerSearchFilter>): Promise<PlannerSearchFilter | undefined>;
  deletePlannerSearchFilter(id: string, tenantId: string): Promise<void>;

  // ADR v3 (F4): Article Components (BOM)
  getArticleComponents(parentArticleId: string, tenantId: string): Promise<ArticleComponent[]>;
  getArticleComponent(id: string, tenantId: string): Promise<ArticleComponent | undefined>;
  createArticleComponent(component: InsertArticleComponent): Promise<ArticleComponent>;
  updateArticleComponent(id: string, tenantId: string, data: Partial<InsertArticleComponent>): Promise<ArticleComponent | undefined>;
  deleteArticleComponent(id: string, tenantId: string): Promise<void>;

  // Session 11 (Register 3): Produktionstidslista
  getProductionTimeLists(tenantId: string, articleId?: string): Promise<ProductionTimeList[]>;
  getProductionTimeList(id: string, tenantId: string): Promise<ProductionTimeList | undefined>;
  createProductionTimeList(data: InsertProductionTimeList): Promise<ProductionTimeList>;
  updateProductionTimeList(id: string, tenantId: string, data: Partial<InsertProductionTimeList>): Promise<ProductionTimeList | undefined>;
  deleteProductionTimeList(id: string, tenantId: string): Promise<void>;

  // Session 11 (Register 5): Leverantörsregister
  getSuppliers(tenantId: string, opts?: { includeDeleted?: boolean }): Promise<Supplier[]>;
  getSupplier(id: string, tenantId: string): Promise<Supplier | undefined>;
  createSupplier(data: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: string, tenantId: string, data: Partial<InsertSupplier>): Promise<Supplier | undefined>;
  deleteSupplier(id: string, tenantId: string): Promise<void>;
  getSupplierArticleLinks(tenantId: string, opts?: { articleId?: string; supplierId?: string }): Promise<SupplierArticleLink[]>;
  getSupplierArticleLink(id: string, tenantId: string): Promise<SupplierArticleLink | undefined>;
  createSupplierArticleLink(data: InsertSupplierArticleLink): Promise<SupplierArticleLink>;
  updateSupplierArticleLink(id: string, tenantId: string, data: Partial<InsertSupplierArticleLink>): Promise<SupplierArticleLink | undefined>;
  deleteSupplierArticleLink(id: string, tenantId: string): Promise<void>;

  // ADR v3 (F6): Index-justering pa prislista
  applyIndexAdjustmentToPriceList(priceListId: string, tenantId: string, percentage: number): Promise<{ priceListId: string; percentage: number; updatedArticles: number; indexDate: Date }>;

  // ADR v3 (F5): Frozen WO snapshot + Invoice Recalculation Log
  freezeWorkOrder(workOrderId: string, tenantId: string, opts?: { force?: boolean }): Promise<{ workOrderId: string; frozenUnit: string; frozenQuantity: number; frozenUnitPrice: number; frozenUnitCost: number; frozenUnitTime: number; alreadyFrozen: boolean }>;

  // ADR v3 §2.3 (Task #556): Fakturamottagare med arv + konfliktresolver
  getInvoiceRecipients(tenantId: string, customerId: string): Promise<InvoiceRecipient[]>;
  getInvoiceRecipient(tenantId: string, id: string): Promise<InvoiceRecipient | undefined>;
  createInvoiceRecipient(data: InsertInvoiceRecipient): Promise<InvoiceRecipient>;
  updateInvoiceRecipient(tenantId: string, id: string, data: Partial<InsertInvoiceRecipient>): Promise<InvoiceRecipient | undefined>;
  deleteInvoiceRecipient(tenantId: string, id: string): Promise<void>;
  resolveInvoiceRecipient(
    tenantId: string,
    customerId: string,
    opts?: { hintLevel?: InvoiceRecipientLevel | null; pinnedRecipientId?: string | null; at?: Date },
  ): Promise<{
    recipient: InvoiceRecipient | null;
    sourceCustomerId: string | null;
    sourceLevel: InvoiceRecipientLevel | null;
    conflicts: InvoiceRecipient[];
    hintConflict: boolean;
    hasConflict: boolean;
    chain: Array<{ customerId: string; customerName: string; recipients: InvoiceRecipient[] }>;
  }>;
  recalculateWorkOrder(workOrderId: string, tenantId: string, triggeredBy: string | null, reason?: string): Promise<{ previousValue: number; newValue: number; delta: number; logId: string | null }>;
  getInvoiceRecalculationLogs(tenantId: string, opts?: { workOrderId?: string; limit?: number; offset?: number }): Promise<InvoiceRecalculationLog[]>;
  createInvoiceRecalculationLog(entry: InsertInvoiceRecalculationLog): Promise<InvoiceRecalculationLog>;
  
  // Assignments
  getAssignments(tenantId: string, options?: { status?: string; resourceId?: string; clusterId?: string; startDate?: Date; endDate?: Date }): Promise<Assignment[]>;
  getAssignment(id: string): Promise<Assignment | undefined>;
  createAssignment(assignment: InsertAssignment): Promise<Assignment>;
  updateAssignment(id: string, tenantId: string, data: Partial<InsertAssignment>): Promise<Assignment | undefined>;
  deleteAssignment(id: string, tenantId: string): Promise<void>;
  
  // Assignment Articles
  getAssignmentArticles(assignmentId: string): Promise<AssignmentArticle[]>;
  getAssignmentArticlesForAssignments(assignmentIds: string[]): Promise<AssignmentArticle[]>;
  createAssignmentArticle(article: InsertAssignmentArticle): Promise<AssignmentArticle>;
  updateAssignmentArticle(id: string, assignmentId: string, data: Partial<InsertAssignmentArticle>): Promise<AssignmentArticle | undefined>;
  deleteAssignmentArticle(id: string, assignmentId: string): Promise<void>;
  
  // Subscription Changes
  getSubscriptionChanges(tenantId: string, conceptId?: string, status?: string): Promise<SubscriptionChange[]>;
  createSubscriptionChange(change: InsertSubscriptionChange): Promise<SubscriptionChange>;
  updateSubscriptionChangeStatus(id: string, tenantId: string, status: string, approvedBy?: string): Promise<SubscriptionChange | undefined>;

  // Task Dependency Templates
  getTaskDependencyTemplates(tenantId: string, articleId?: string): Promise<TaskDependencyTemplate[]>;
  getTaskDependencyTemplate(id: string): Promise<TaskDependencyTemplate | undefined>;
  createTaskDependencyTemplate(template: InsertTaskDependencyTemplate): Promise<TaskDependencyTemplate>;
  updateTaskDependencyTemplate(id: string, tenantId: string, data: Partial<InsertTaskDependencyTemplate>): Promise<TaskDependencyTemplate | undefined>;
  deleteTaskDependencyTemplate(id: string, tenantId: string): Promise<void>;

  // Task Dependency Instances
  getTaskDependencyInstances(tenantId: string, parentWorkOrderId?: string): Promise<TaskDependencyInstance[]>;
  createTaskDependencyInstance(instance: InsertTaskDependencyInstance): Promise<TaskDependencyInstance>;
  updateTaskDependencyInstanceCompleted(id: string, tenantId: string, completed: boolean): Promise<TaskDependencyInstance | undefined>;

  // Invoice Rules
  getInvoiceRules(tenantId: string, orderConceptId?: string): Promise<InvoiceRule[]>;
  getInvoiceRule(id: string): Promise<InvoiceRule | undefined>;
  createInvoiceRule(rule: InsertInvoiceRule): Promise<InvoiceRule>;
  updateInvoiceRule(id: string, tenantId: string, data: Partial<InsertInvoiceRule>): Promise<InvoiceRule | undefined>;
  deleteInvoiceRule(id: string, tenantId: string): Promise<void>;

  // Order Concept Run Logs
  getOrderConceptRunLogs(tenantId: string, orderConceptId?: string): Promise<OrderConceptRunLog[]>;
  createOrderConceptRunLog(log: InsertOrderConceptRunLog): Promise<OrderConceptRunLog>;

  // Order Concept Wizard - Objects
  getOrderConceptObjects(orderConceptId: string): Promise<OrderConceptObject[]>;
  addOrderConceptObjects(objects: InsertOrderConceptObject[]): Promise<OrderConceptObject[]>;
  removeOrderConceptObject(orderConceptId: string, objectId: string): Promise<void>;

  // Order Concept Wizard - Articles
  getOrderConceptArticles(orderConceptId: string): Promise<OrderConceptArticle[]>;
  addOrderConceptArticle(article: InsertOrderConceptArticle): Promise<OrderConceptArticle>;
  removeOrderConceptArticle(id: string, orderConceptId: string): Promise<void>;
  updateOrderConceptArticle(id: string, orderConceptId: string, updates: Partial<InsertOrderConceptArticle>): Promise<OrderConceptArticle | undefined>;

  // Order Concept Wizard - Article-Object Mappings
  getArticleObjectMappings(orderConceptId: string): Promise<ArticleObjectMapping[]>;
  createArticleObjectMapping(mapping: InsertArticleObjectMapping): Promise<ArticleObjectMapping>;
  deleteArticleObjectMappings(orderConceptId: string): Promise<void>;

  // Order Concept Wizard - Invoice Configuration
  getInvoiceConfiguration(orderConceptId: string): Promise<InvoiceConfiguration | undefined>;
  upsertInvoiceConfiguration(config: InsertInvoiceConfiguration): Promise<InvoiceConfiguration>;

  // Order Concept Wizard - Document Configurations
  getDocumentConfigurations(orderConceptId: string): Promise<DocumentConfiguration[]>;
  upsertDocumentConfigurations(orderConceptId: string, configs: InsertDocumentConfiguration[]): Promise<DocumentConfiguration[]>;

  // Order Concept Wizard - Delivery Schedules
  getDeliverySchedules(orderConceptId: string): Promise<DeliverySchedule[]>;
  upsertDeliverySchedules(orderConceptId: string, schedules: InsertDeliverySchedule[]): Promise<DeliverySchedule[]>;

  // Customer Portal - Tokens and Sessions
  createPortalToken(token: InsertCustomerPortalToken): Promise<CustomerPortalToken>;
  getPortalTokenByHash(tokenHash: string): Promise<CustomerPortalToken | undefined>;
  deletePortalToken(id: string): Promise<void>;
  createPortalSession(session: InsertCustomerPortalSession): Promise<CustomerPortalSession>;
  getPortalSessionByToken(sessionToken: string): Promise<CustomerPortalSession | undefined>;
  updatePortalSessionAccess(id: string): Promise<void>;
  deletePortalSession(id: string): Promise<void>;

  // Customer Portal - Portal Users (per-objekt-scope)
  upsertPortalUser(data: InsertPortalUser): Promise<PortalUser>;
  getPortalUser(id: string): Promise<PortalUser | undefined>;
  getPortalUserByEmail(tenantId: string, customerId: string, email: string): Promise<PortalUser | undefined>;
  getPortalUsersByCustomer(tenantId: string, customerId: string): Promise<Array<PortalUser & { scopeObjectIds: string[] }>>;
  deletePortalUser(id: string): Promise<void>;
  setPortalUserScope(portalUserId: string, objectIds: string[]): Promise<void>;
  getPortalUserScopeRaw(portalUserId: string): Promise<string[]>;
  resolvePortalUserScopeObjectIds(portalUserId: string, tenantId: string): Promise<Set<string> | null>;
  
  // Customer Portal - Booking Requests
  getBookingRequests(tenantId: string, customerId?: string): Promise<CustomerBookingRequest[]>;
  getBookingRequest(id: string): Promise<CustomerBookingRequest | undefined>;
  createBookingRequest(request: InsertCustomerBookingRequest): Promise<CustomerBookingRequest>;
  updateBookingRequest(id: string, tenantId: string, data: Partial<InsertCustomerBookingRequest>): Promise<CustomerBookingRequest | undefined>;
  getWorkOrdersByCustomer(customerId: string, tenantId: string): Promise<WorkOrder[]>;
  
  // Customer Portal - Messages (legacy)
  markPortalMessagesAsRead(tenantId: string, customerId: string): Promise<void>;
  getAllPortalMessagesForStaff(tenantId: string): Promise<CustomerPortalMessage[]>;
  getCustomersWithMessages(tenantId: string): Promise<string[]>;
  markStaffMessagesAsRead(tenantId: string, customerId: string): Promise<void>;
  
  // Customer Portal - Invoices
  getCustomerInvoices(tenantId: string, customerId: string): Promise<CustomerInvoice[]>;
  createCustomerInvoice(invoice: InsertCustomerInvoice): Promise<CustomerInvoice>;
  
  // Customer Portal - Issue Reports
  getCustomerIssueReports(tenantId: string, customerId: string): Promise<CustomerIssueReport[]>;
  createCustomerIssueReport(report: InsertCustomerIssueReport): Promise<CustomerIssueReport>;
  updateCustomerIssueReport(id: string, tenantId: string, data: Partial<InsertCustomerIssueReport>): Promise<CustomerIssueReport | undefined>;
  
  // Customer Portal - Service Contracts
  getCustomerServiceContracts(tenantId: string, customerId: string): Promise<CustomerServiceContract[]>;
  createCustomerServiceContract(contract: InsertCustomerServiceContract): Promise<CustomerServiceContract>;

  // Fortnox contract suggestions (from invoice history)
  listFortnoxContractSuggestions(tenantId: string, opts?: { status?: string; importBatchId?: string; customerId?: string }): Promise<FortnoxContractSuggestion[]>;
  getFortnoxContractSuggestion(id: string, tenantId: string): Promise<FortnoxContractSuggestion | undefined>;
  createFortnoxContractSuggestions(rows: InsertFortnoxContractSuggestion[]): Promise<FortnoxContractSuggestion[]>;
  updateFortnoxContractSuggestion(id: string, tenantId: string, updates: Partial<FortnoxContractSuggestion>): Promise<FortnoxContractSuggestion | undefined>;
  deleteFortnoxContractSuggestionsByBatch(tenantId: string, importBatchId: string): Promise<number>;
  
  // Customer Portal - Notification Settings
  getCustomerNotificationSettings(tenantId: string, customerId: string): Promise<CustomerNotificationSettings | undefined>;
  upsertCustomerNotificationSettings(settings: InsertCustomerNotificationSettings): Promise<CustomerNotificationSettings>;
  
  // Protocols
  getProtocols(tenantId: string, options?: { workOrderId?: string; objectId?: string; protocolType?: string; status?: string }): Promise<Protocol[]>;
  getProtocol(id: string): Promise<Protocol | undefined>;
  createProtocol(protocol: InsertProtocol): Promise<Protocol>;
  updateProtocol(id: string, tenantId: string, data: Partial<InsertProtocol>): Promise<Protocol | undefined>;
  deleteProtocol(id: string, tenantId: string): Promise<void>;
  
  // Deviation Reports
  getDeviationReports(tenantId: string, options?: { objectId?: string; status?: string; category?: string; severity?: string }): Promise<DeviationReport[]>;
  getDeviationReport(id: string): Promise<DeviationReport | undefined>;
  createDeviationReport(report: InsertDeviationReport): Promise<DeviationReport>;
  updateDeviationReport(id: string, tenantId: string, data: Partial<InsertDeviationReport>): Promise<DeviationReport | undefined>;
  
  // QR Code Links
  getQrCodeLinks(tenantId: string, objectId?: string): Promise<QrCodeLink[]>;
  getQrCodeLinkByCode(code: string): Promise<QrCodeLink | undefined>;
  getQrCodeLink(id: string): Promise<QrCodeLink | undefined>;
  createQrCodeLink(link: InsertQrCodeLink): Promise<QrCodeLink>;
  updateQrCodeLink(id: string, tenantId: string, data: Partial<InsertQrCodeLink>): Promise<QrCodeLink | undefined>;
  incrementQrCodeScanCount(id: string): Promise<void>;
  deleteQrCodeLink(id: string, tenantId: string): Promise<void>;
  
  // Public Issue Reports
  getPublicIssueReports(tenantId: string, options?: { objectId?: string; status?: string }): Promise<PublicIssueReport[]>;
  getPublicIssueReport(id: string): Promise<PublicIssueReport | undefined>;
  createPublicIssueReport(report: InsertPublicIssueReport): Promise<PublicIssueReport>;
  updatePublicIssueReport(id: string, tenantId: string, data: Partial<InsertPublicIssueReport>): Promise<PublicIssueReport | undefined>;

  // Metadata Editors ("Metadata Lämnare", Task #956)
  getMetadataEditors(tenantId: string, options?: { type?: string; isActive?: boolean }): Promise<MetadataEditor[]>;
  getMetadataEditor(id: string, tenantId: string): Promise<MetadataEditor | undefined>;
  createMetadataEditor(editor: InsertMetadataEditor): Promise<MetadataEditor>;
  updateMetadataEditor(id: string, tenantId: string, data: Partial<InsertMetadataEditor>): Promise<MetadataEditor | undefined>;
  deleteMetadataEditor(id: string, tenantId: string): Promise<void>;
  getMetadataEditorFields(editorId: string, tenantId: string): Promise<MetadataEditorField[]>;
  createMetadataEditorField(field: InsertMetadataEditorField): Promise<MetadataEditorField>;
  replaceMetadataEditorFields(editorId: string, tenantId: string, fields: InsertMetadataEditorField[]): Promise<MetadataEditorField[]>;
  getMetadataEditorSubmissions(tenantId: string, options?: { editorId?: string; objectId?: string; status?: string }): Promise<MetadataEditorSubmission[]>;
  getMetadataEditorSubmission(id: string, tenantId: string): Promise<MetadataEditorSubmission | undefined>;
  createMetadataEditorSubmission(submission: InsertMetadataEditorSubmission): Promise<MetadataEditorSubmission>;
  updateMetadataEditorSubmission(id: string, tenantId: string, data: Partial<InsertMetadataEditorSubmission>): Promise<MetadataEditorSubmission | undefined>;
  getMetadataEditorSubmissionValues(submissionId: string, tenantId: string): Promise<MetadataEditorSubmissionValue[]>;
  createMetadataEditorSubmissionValue(value: InsertMetadataEditorSubmissionValue): Promise<MetadataEditorSubmissionValue>;
  updateMetadataEditorSubmissionValue(id: string, tenantId: string, data: Partial<InsertMetadataEditorSubmissionValue>): Promise<MetadataEditorSubmissionValue | undefined>;

  // Customer Change Requests
  getCustomerChangeRequests(options: { tenantId: string; customerId?: string; objectId?: string; status?: string; category?: string; dateFrom?: string; dateTo?: string; createdByResourceId?: string; limit?: number; offset?: number }): Promise<{ items: CustomerChangeRequest[]; total: number }>;
  getCustomerChangeRequest(id: string): Promise<CustomerChangeRequest | undefined>;
  createCustomerChangeRequest(request: InsertCustomerChangeRequest): Promise<CustomerChangeRequest>;
  updateCustomerChangeRequest(id: string, tenantId: string, data: Partial<CustomerChangeRequest>): Promise<CustomerChangeRequest | undefined>;
  
  // Environmental Data
  getEnvironmentalData(tenantId: string, options?: { workOrderId?: string; resourceId?: string; startDate?: Date; endDate?: Date }): Promise<EnvironmentalData[]>;
  createEnvironmentalData(data: InsertEnvironmentalData): Promise<EnvironmentalData>;
  updateEnvironmentalData(id: string, tenantId: string, data: Partial<InsertEnvironmentalData>): Promise<EnvironmentalData | undefined>;
  
  // Customer Portal 2.0 - Visit Confirmations
  getVisitConfirmations(tenantId: string, options?: { customerId?: string; workOrderId?: string }): Promise<VisitConfirmation[]>;
  getVisitConfirmation(id: string): Promise<VisitConfirmation | undefined>;
  getVisitConfirmationByWorkOrder(workOrderId: string): Promise<VisitConfirmation | undefined>;
  createVisitConfirmation(confirmation: InsertVisitConfirmation): Promise<VisitConfirmation>;
  
  // Customer Portal 2.0 - Technician Ratings
  getTechnicianRatings(tenantId: string, options?: { resourceId?: string; customerId?: string; workOrderId?: string }): Promise<TechnicianRating[]>;
  getTechnicianRating(id: string): Promise<TechnicianRating | undefined>;
  getTechnicianRatingByWorkOrder(workOrderId: string): Promise<TechnicianRating | undefined>;
  createTechnicianRating(rating: InsertTechnicianRating): Promise<TechnicianRating>;
  getResourceAverageRating(resourceId: string): Promise<{ average: number; count: number }>;
  
  // Customer Portal 2.0 - Portal Messages (Chat)
  getPortalMessages(tenantId: string, options?: { workOrderId?: string; customerId?: string; resourceId?: string; unreadOnly?: boolean }): Promise<PortalMessage[]>;
  getPortalMessage(id: string): Promise<PortalMessage | undefined>;
  createPortalMessage(message: InsertPortalMessage): Promise<PortalMessage>;
  markMessageAsRead(id: string): Promise<PortalMessage | undefined>;
  getUnreadMessageCount(tenantId: string, customerId?: string, resourceId?: string): Promise<number>;
  
  // Customer Portal 2.0 - Self Booking Slots
  getSelfBookingSlots(tenantId: string, options?: { startDate?: Date; endDate?: Date; serviceType?: string; isActive?: boolean }): Promise<SelfBookingSlot[]>;
  getSelfBookingSlot(id: string): Promise<SelfBookingSlot | undefined>;
  createSelfBookingSlot(slot: InsertSelfBookingSlot): Promise<SelfBookingSlot>;
  updateSelfBookingSlot(id: string, data: Partial<InsertSelfBookingSlot>): Promise<SelfBookingSlot | undefined>;
  deleteSelfBookingSlot(id: string): Promise<void>;
  incrementSlotBookingCount(slotId: string): Promise<SelfBookingSlot | undefined>;
  
  // Customer Portal 2.0 - Self Bookings
  getSelfBookings(tenantId: string, options?: { customerId?: string; status?: string }): Promise<SelfBooking[]>;
  getSelfBooking(id: string): Promise<SelfBooking | undefined>;
  createSelfBooking(booking: InsertSelfBooking): Promise<SelfBooking>;
  updateSelfBooking(id: string, data: Partial<InsertSelfBooking>): Promise<SelfBooking | undefined>;
  
  // Inspection metadata
  getInspectionMetadata(tenantId: string, objectId?: string): Promise<InspectionMetadata[]>;
  createInspectionMetadata(data: InsertInspectionMetadata): Promise<InspectionMetadata>;
  searchInspectionMetadata(tenantId: string, filters: { inspectionType?: string; status?: string; objectId?: string }): Promise<InspectionMetadata[]>;

  // Checklist Templates
  getChecklistTemplates(tenantId: string): Promise<ChecklistTemplate[]>;
  getChecklistTemplate(id: string, tenantId: string): Promise<ChecklistTemplate | undefined>;
  getChecklistTemplatesByArticleType(tenantId: string, articleType: string): Promise<ChecklistTemplate[]>;
  createChecklistTemplate(template: InsertChecklistTemplate): Promise<ChecklistTemplate>;
  updateChecklistTemplate(id: string, tenantId: string, data: Partial<InsertChecklistTemplate>): Promise<ChecklistTemplate | undefined>;
  deleteChecklistTemplate(id: string, tenantId: string): Promise<void>;

  // Driver Notifications
  getDriverNotifications(resourceId: string, options?: { unreadOnly?: boolean; limit?: number }): Promise<DriverNotification[]>;
  listDriverNotificationsByResource(resourceId: string, tenantId: string, options?: { types?: string[]; limit?: number }): Promise<DriverNotification[]>;
  createDriverNotification(notification: InsertDriverNotification): Promise<DriverNotification>;
  markDriverNotificationRead(id: string, resourceId: string): Promise<DriverNotification | undefined>;
  markAllDriverNotificationsRead(resourceId: string): Promise<number>;
  getUnreadNotificationCount(resourceId: string): Promise<number>;

  // User Notifications (in-app for planners/admins)
  getUserNotifications(userId: string, tenantId: string, options?: { unreadOnly?: boolean; readOnly?: boolean; limit?: number; offset?: number; type?: string }): Promise<UserNotification[]>;
  getUserNotificationsCount(userId: string, tenantId: string, options?: { unreadOnly?: boolean; readOnly?: boolean; type?: string }): Promise<number>;
  getUserNotificationTypes(userId: string, tenantId: string): Promise<string[]>;
  createUserNotification(notification: InsertUserNotification): Promise<UserNotification>;
  markUserNotificationRead(id: string, userId: string): Promise<UserNotification | undefined>;
  markAllUserNotificationsRead(userId: string, tenantId: string): Promise<number>;
  getUnreadUserNotificationCount(userId: string, tenantId: string): Promise<number>;
  deleteOldUserNotifications(opts: { readOlderThanDays?: number; unreadOlderThanDays?: number; tenantId?: string }): Promise<{ readDeleted: number; unreadDeleted: number }>;

  // User notification preferences (per-type opt-out; default ON when row saknas)
  getUserNotificationPreference(tenantId: string, userId: string, type: string): Promise<UserNotificationPreference | undefined>;
  getUserNotificationPreferences(userId: string, tenantId: string): Promise<UserNotificationPreference[]>;
  setUserNotificationPreference(tenantId: string, userId: string, type: string, enabled: boolean): Promise<UserNotificationPreference>;

  // Offline Sync Log
  createOfflineSyncLog(log: InsertOfflineSyncLog): Promise<OfflineSyncLog>;
  getOfflineSyncLogs(resourceId: string, status?: string): Promise<OfflineSyncLog[]>;
  updateOfflineSyncLogStatus(id: string, status: string, errorMessage?: string): Promise<OfflineSyncLog | undefined>;

  // Fuel Logs
  getFuelLogs(tenantId: string, vehicleId?: string): Promise<FuelLog[]>;
  createFuelLog(log: InsertFuelLog): Promise<FuelLog>;
  deleteFuelLog(id: string, tenantId: string): Promise<void>;

  // Maintenance Logs
  getMaintenanceLogs(tenantId: string, vehicleId?: string): Promise<MaintenanceLog[]>;
  createMaintenanceLog(log: InsertMaintenanceLog): Promise<MaintenanceLog>;
  deleteMaintenanceLog(id: string, tenantId: string): Promise<void>;

  // Object Parents (multi-parent relationships)
  getObjectParents(objectId: string): Promise<ObjectParent[]>;
  getObjectParentsEnriched(objectId: string, tenantId: string): Promise<ObjectParentRelationEnriched[]>;
  getObjectChildren(parentId: string): Promise<ObjectParent[]>;
  addObjectParent(data: InsertObjectParent): Promise<ObjectParent>;
  addObjectParentSafe(objectId: string, parentId: string, tenantId: string, relationContext?: string | null): Promise<ObjectParent>;
  removeObjectParent(id: string, objectId?: string): Promise<void>;
  setPrimaryParent(objectId: string, parentId: string, tenantId: string): Promise<ObjectParent | undefined>;
  moveObject(objectId: string, newParentId: string | null, tenantId: string): Promise<ServiceObject | undefined>;
  wouldCreateObjectCycle(tenantId: string, objectId: string, candidateParentId: string | null): Promise<boolean>;

  // Resource Profiles (Utföranderoller)
  getResourceProfiles(tenantId: string): Promise<ResourceProfile[]>;
  getResourceProfile(id: string): Promise<ResourceProfile | undefined>;
  createResourceProfile(profile: InsertResourceProfile): Promise<ResourceProfile>;
  updateResourceProfile(id: string, data: Partial<Omit<InsertResourceProfile, 'tenantId'>>): Promise<ResourceProfile | undefined>;
  deleteResourceProfile(id: string, tenantId?: string): Promise<void>;
  getResourceProfileAssignments(tenantId: string, profileId?: string, resourceId?: string): Promise<ResourceProfileAssignment[]>;
  assignResourceProfile(data: InsertResourceProfileAssignment): Promise<ResourceProfileAssignment>;
  removeResourceProfileAssignment(id: string): Promise<void>;
  removeResourceProfileAssignmentByPair(profileId: string, resourceId: string): Promise<void>;

  getWorkSessions(tenantId: string, options?: { resourceId?: string; teamId?: string; startDate?: Date; endDate?: Date; status?: string }): Promise<WorkSession[]>;
  getWorkSession(id: string): Promise<WorkSession | undefined>;
  createWorkSession(session: InsertWorkSession): Promise<WorkSession>;
  updateWorkSession(id: string, data: Partial<InsertWorkSession>): Promise<WorkSession | undefined>;
  deleteWorkSession(id: string): Promise<void>;

  getWorkEntries(workSessionId: string): Promise<WorkEntry[]>;
  getWorkEntriesByResource(tenantId: string, resourceId: string, startDate?: Date, endDate?: Date): Promise<WorkEntry[]>;
  getWorkEntry(id: string): Promise<WorkEntry | undefined>;
  createWorkEntry(entry: InsertWorkEntry): Promise<WorkEntry>;
  updateWorkEntry(id: string, data: Partial<InsertWorkEntry>): Promise<WorkEntry | undefined>;
  deleteWorkEntry(id: string): Promise<void>;

  getEquipmentBookings(tenantId: string, options?: { vehicleId?: string; equipmentId?: string; resourceId?: string; teamId?: string; date?: Date; startDate?: Date; endDate?: Date; status?: string }): Promise<EquipmentBooking[]>;
  getEquipmentBooking(id: string): Promise<EquipmentBooking | undefined>;
  createEquipmentBooking(booking: InsertEquipmentBooking): Promise<EquipmentBooking>;
  updateEquipmentBooking(id: string, data: Partial<InsertEquipmentBooking>): Promise<EquipmentBooking | undefined>;
  deleteEquipmentBooking(id: string): Promise<void>;
  releaseEquipmentByWorkSession(workSessionId: string): Promise<number>;

  getIotDevices(tenantId: string): Promise<IotDevice[]>;
  getIotDevice(id: string): Promise<IotDevice | undefined>;
  getIotDeviceByExternalId(tenantId: string, externalDeviceId: string): Promise<IotDevice | undefined>;
  createIotDevice(device: InsertIotDevice): Promise<IotDevice>;
  updateIotDevice(id: string, data: Partial<InsertIotDevice>): Promise<IotDevice | undefined>;
  deleteIotDevice(id: string): Promise<void>;

  getIotApiKeys(tenantId: string): Promise<IotApiKey[]>;
  getIotApiKeyByKey(apiKey: string): Promise<IotApiKey | undefined>;
  createIotApiKey(key: InsertIotApiKey): Promise<IotApiKey>;
  deleteIotApiKey(id: string): Promise<void>;

  getIotSignals(tenantId: string, options?: { deviceId?: string; limit?: number }): Promise<IotSignal[]>;
  createIotSignal(signal: InsertIotSignal): Promise<IotSignal>;
  updateIotSignal(id: string, data: Partial<InsertIotSignal>): Promise<IotSignal | undefined>;

  getRouteFeedback(tenantId: string, options?: { resourceId?: string; startDate?: string; endDate?: string; limit?: number }): Promise<RouteFeedback[]>;
  createRouteFeedback(feedback: InsertRouteFeedback): Promise<RouteFeedback>;
  getRouteFeedbackSummary(tenantId: string, options?: { startDate?: string; endDate?: string; resourceIds?: string[] }): Promise<{ avgRating: number; totalCount: number; byCategory: Record<string, number>; byResource: { resourceId: string; avgRating: number; count: number }[]; ratingDistribution: Record<number, number>; byDay: { date: string; avgRating: number; count: number }[] }>;

  getResourceAvailabilityByTenant(tenantId: string): Promise<ResourceAvailability[]>;
  getVehicleSchedulesByTenant(tenantId: string): Promise<VehicleSchedule[]>;
  getResourceVehiclesByResourceIds(resourceIds: string[]): Promise<ResourceVehicle[]>;
  getResourceArticlesByResourceIds(resourceIds: string[]): Promise<ResourceArticle[]>;
  createPlanningDecisionLog(log: { tenantId: string; userId?: string; weekStart: string; weekEnd: string; summary: unknown; moveCount: number; violationCount: number; riskScore: number; totalOrdersScheduled: number }): Promise<void>;

  // ============== Task #1240: Delad filtermotor — sparade filter ==============
  getSavedFilters(tenantId: string, scope: string, userId: string): Promise<SavedFilter[]>;
  createSavedFilter(tenantId: string, userId: string, data: InsertSavedFilter): Promise<SavedFilter>;
  updateSavedFilter(tenantId: string, userId: string, id: string, data: Partial<InsertSavedFilter>): Promise<SavedFilter | undefined>;
  deleteSavedFilter(tenantId: string, userId: string, id: string): Promise<void>;

  // ============== Task #785: Veckoplanering – datafundament ==============
  // Alla queries är tenant-scopade; alla UPDATE/DELETE har tenant_id i WHERE.
  // Geografiska distrikt
  getGeographicDistricts(tenantId: string): Promise<GeographicDistrict[]>;
  getGeographicDistrict(tenantId: string, id: string): Promise<GeographicDistrict | undefined>;
  createGeographicDistrict(data: InsertGeographicDistrict): Promise<GeographicDistrict>;
  updateGeographicDistrict(tenantId: string, id: string, data: Partial<InsertGeographicDistrict>): Promise<GeographicDistrict | undefined>;
  deleteGeographicDistrict(tenantId: string, id: string): Promise<void>;
  // Distrikt-zoner
  getDistrictZones(tenantId: string, districtId?: string): Promise<DistrictZone[]>;
  getDistrictZone(tenantId: string, id: string): Promise<DistrictZone | undefined>;
  createDistrictZone(data: InsertDistrictZone): Promise<DistrictZone>;
  updateDistrictZone(tenantId: string, id: string, data: Partial<InsertDistrictZone>): Promise<DistrictZone | undefined>;
  deleteDistrictZone(tenantId: string, id: string): Promise<void>;
  // Veckoplaner
  getWeeklyPlans(tenantId: string, opts?: { teamId?: string; year?: number; weekNumber?: number; status?: string }): Promise<WeeklyPlan[]>;
  getWeeklyPlan(tenantId: string, id: string): Promise<WeeklyPlan | undefined>;
  createWeeklyPlan(data: InsertWeeklyPlan): Promise<WeeklyPlan>;
  updateWeeklyPlan(tenantId: string, id: string, data: Partial<InsertWeeklyPlan>): Promise<WeeklyPlan | undefined>;
  deleteWeeklyPlan(tenantId: string, id: string): Promise<void>;
  // Veckoplan-uppgifter
  getWeeklyPlanTasks(tenantId: string, weeklyPlanId: string): Promise<WeeklyPlanTask[]>;
  getWeeklyPlanTaskFacts(tenantId: string, taskIds: string[]): Promise<WeeklyPlanTaskFact[]>;
  getWeeklyPlanCandidates(tenantId: string, planId: string, teamId: string, week: string): Promise<WeeklyPlanCandidate[]>;
  getWeeklyPlanTask(tenantId: string, id: string): Promise<WeeklyPlanTask | undefined>;
  createWeeklyPlanTask(data: InsertWeeklyPlanTask): Promise<WeeklyPlanTask>;
  updateWeeklyPlanTask(tenantId: string, id: string, data: Partial<InsertWeeklyPlanTask>): Promise<WeeklyPlanTask | undefined>;
  deleteWeeklyPlanTask(tenantId: string, id: string): Promise<void>;
  // Personliga uppgifter
  getPersonalTasks(tenantId: string, opts?: { weeklyPlanId?: string; teamId?: string }): Promise<PersonalTask[]>;
  getPersonalTask(tenantId: string, id: string): Promise<PersonalTask | undefined>;
  createPersonalTask(data: InsertPersonalTask): Promise<PersonalTask>;
  updatePersonalTask(tenantId: string, id: string, data: Partial<InsertPersonalTask>): Promise<PersonalTask | undefined>;
  deletePersonalTask(tenantId: string, id: string): Promise<void>;
  // Personliga-uppgift-scheman
  getPersonalTaskSchedules(tenantId: string, opts?: { teamId?: string; activeOnly?: boolean }): Promise<PersonalTaskSchedule[]>;
  getPersonalTaskSchedule(tenantId: string, id: string): Promise<PersonalTaskSchedule | undefined>;
  createPersonalTaskSchedule(data: InsertPersonalTaskSchedule): Promise<PersonalTaskSchedule>;
  updatePersonalTaskSchedule(tenantId: string, id: string, data: Partial<InsertPersonalTaskSchedule>): Promise<PersonalTaskSchedule | undefined>;
  deletePersonalTaskSchedule(tenantId: string, id: string): Promise<void>;
  // Restidsposter
  getTravelTimeEntries(tenantId: string, weeklyPlanId?: string): Promise<TravelTimeEntry[]>;
  getTravelTimeEntry(tenantId: string, id: string): Promise<TravelTimeEntry | undefined>;
  createTravelTimeEntry(data: InsertTravelTimeEntry): Promise<TravelTimeEntry>;
  updateTravelTimeEntry(tenantId: string, id: string, data: Partial<InsertTravelTimeEntry>): Promise<TravelTimeEntry | undefined>;
  deleteTravelTimeEntry(tenantId: string, id: string): Promise<void>;
  // Planeringsreservationer ("reservtid", Task #1238)
  getPlanningReservations(tenantId: string, opts?: { weeklyPlanId?: string; teamId?: string; resourceId?: string }): Promise<PlanningReservation[]>;
  getPlanningReservation(tenantId: string, id: string): Promise<PlanningReservation | undefined>;
  createPlanningReservation(data: InsertPlanningReservation): Promise<PlanningReservation>;
  updatePlanningReservation(tenantId: string, id: string, data: Partial<InsertPlanningReservation>): Promise<PlanningReservation | undefined>;
  deletePlanningReservation(tenantId: string, id: string): Promise<void>;
  // Veckoplan-varningar
  getWeeklyPlanWarnings(tenantId: string, weeklyPlanId: string): Promise<WeeklyPlanWarning[]>;
  getWeeklyPlanWarning(tenantId: string, id: string): Promise<WeeklyPlanWarning | undefined>;
  createWeeklyPlanWarning(data: InsertWeeklyPlanWarning): Promise<WeeklyPlanWarning>;
  updateWeeklyPlanWarning(tenantId: string, id: string, data: Partial<InsertWeeklyPlanWarning>): Promise<WeeklyPlanWarning | undefined>;
  deleteWeeklyPlanWarning(tenantId: string, id: string): Promise<void>;
  deleteWeeklyPlanWarningsByPlan(tenantId: string, weeklyPlanId: string): Promise<void>;

  // Task #1037: Slottids-register
  getSlotTimes(tenantId: string, opts?: { assignmentId?: string; assignmentGroupKey?: string; status?: string }): Promise<SlotTime[]>;
  getSlotTime(tenantId: string, id: string): Promise<SlotTime | undefined>;
  createSlotTime(data: InsertSlotTime): Promise<SlotTime>;
  createSlotTimes(rows: InsertSlotTime[]): Promise<number>;
  updateSlotTime(tenantId: string, id: string, data: Partial<InsertSlotTime>): Promise<SlotTime | undefined>;
  deleteSlotTime(tenantId: string, id: string): Promise<void>;
  clearEngineSlotTimes(tenantId: string, source: string, opts: { assignmentIds?: string[]; windowStart?: Date; windowEnd?: Date }): Promise<number>;
  setSlotTimePlannerDecision(tenantId: string, opts: { assignmentIds?: string[]; assignmentGroupKey?: string; decision: string | null; decidedBy: string | null }): Promise<number>;
  getTenantGroupingRadiusMeters(tenantId: string): Promise<number | null>;
  getTenantEngineDefaults(tenantId: string): Promise<PlanningParameter | undefined>;
  upsertTenantEngineDefaults(tenantId: string, data: Partial<InsertPlanningParameter>): Promise<PlanningParameter>;
  getCustomersDeliveryPreferences(customerIds: string[]): Promise<Map<string, unknown>>;
  getObjectsPrimaryCustomerIds(objectIds: string[]): Promise<Map<string, string | null>>;

  // Pre-tasks
  getPreTasks(tenantId: string, opts?: { workOrderId?: string; status?: string }): Promise<PreTask[]>;
  getPreTask(tenantId: string, id: string): Promise<PreTask | undefined>;
  createPreTask(data: InsertPreTask): Promise<PreTask>;
  updatePreTask(tenantId: string, id: string, data: Partial<InsertPreTask>): Promise<PreTask | undefined>;
  deletePreTask(tenantId: string, id: string): Promise<void>;
  // Regler: utförandetyp → pre-task
  getExecTypePreTaskRules(tenantId: string, opts?: { executionType?: string; activeOnly?: boolean }): Promise<ExecTypePreTaskRule[]>;
  getExecTypePreTaskRule(tenantId: string, id: string): Promise<ExecTypePreTaskRule | undefined>;
  createExecTypePreTaskRule(data: InsertExecTypePreTaskRule): Promise<ExecTypePreTaskRule>;
  updateExecTypePreTaskRule(tenantId: string, id: string, data: Partial<InsertExecTypePreTaskRule>): Promise<ExecTypePreTaskRule | undefined>;
  deleteExecTypePreTaskRule(tenantId: string, id: string): Promise<void>;
  // Pågående störningar (persisterade — överlever omstart)
  getDisruptions(tenantId: string, opts?: { includeResolved?: boolean }): Promise<Disruption[]>;
  getDisruption(tenantId: string, id: string): Promise<Disruption | undefined>;
  createDisruption(data: InsertDisruption): Promise<Disruption>;
  updateDisruption(tenantId: string, id: string, data: Partial<InsertDisruption>): Promise<Disruption | undefined>;
}

// Delad SELECT-form för oplanerade grovplanerings-ordrar (Task #899). Återanvänds
// av getUnplannedRoughWorkOrders (paginerat) och getUnplannedRoughNearby (radie).
const ROUGH_UNPLANNED_SELECT = {
  id: workOrders.id,
  tenantId: workOrders.tenantId,
  customerId: workOrders.customerId,
  objectId: workOrders.objectId,
  clusterId: workOrders.clusterId,
  resourceId: workOrders.resourceId,
  teamId: workOrders.teamId,
  title: workOrders.title,
  description: workOrders.description,
  orderType: workOrders.orderType,
  priority: workOrders.priority,
  orderStatus: workOrders.orderStatus,
  scheduledDate: workOrders.scheduledDate,
  scheduledStartTime: workOrders.scheduledStartTime,
  plannedWindowStart: workOrders.plannedWindowStart,
  plannedWindowEnd: workOrders.plannedWindowEnd,
  estimatedDuration: workOrders.estimatedDuration,
  actualDuration: workOrders.actualDuration,
  setupTime: workOrders.setupTime,
  setupReason: workOrders.setupReason,
  lockedAt: workOrders.lockedAt,
  completedAt: workOrders.completedAt,
  invoicedAt: workOrders.invoicedAt,
  cachedValue: workOrders.cachedValue,
  cachedCost: workOrders.cachedCost,
  cachedProductionMinutes: workOrders.cachedProductionMinutes,
  isSimulated: workOrders.isSimulated,
  simulationScenarioId: workOrders.simulationScenarioId,
  plannedBy: workOrders.plannedBy,
  plannedNotes: workOrders.plannedNotes,
  notes: workOrders.notes,
  metadata: workOrders.metadata,
  createdAt: workOrders.createdAt,
  deletedAt: workOrders.deletedAt,
  impossibleReason: workOrders.impossibleReason,
  impossibleReasonText: workOrders.impossibleReasonText,
  impossibleAt: workOrders.impossibleAt,
  impossibleBy: workOrders.impossibleBy,
  impossiblePhotoUrl: workOrders.impossiblePhotoUrl,
  executionStatus: workOrders.executionStatus,
  creationMethod: workOrders.creationMethod,
  structuralArticleId: workOrders.structuralArticleId,
  roughPlannedWeek: workOrders.roughPlannedWeek,
  districtId: workOrders.districtId,

  taskLatitude: workOrders.taskLatitude,
  taskLongitude: workOrders.taskLongitude,
  externalReference: workOrders.externalReference,
  onWayAt: workOrders.onWayAt,
  onSiteAt: workOrders.onSiteAt,
  inspectedAt: workOrders.inspectedAt,
  executionCode: workOrders.executionCode,
  importBatchId: workOrders.importBatchId,
  outsidePreferredWindow: workOrders.outsidePreferredWindow,
  deliveryPreferencePriority: workOrders.deliveryPreferencePriority,
  taskCategory: workOrders.taskCategory,
  locationRequirement: workOrders.locationRequirement,
  status: workOrders.status,
  desiredDeliveryStart: workOrders.desiredDeliveryStart,
  desiredDeliveryEnd: workOrders.desiredDeliveryEnd,
  etaSmsSent: workOrders.etaSmsSent,
  objectName: objects.name,
  objectNameTranslations: objects.nameTranslations,
  objectAddress: objects.address,
  objectAccessCode: objectMetadataTextValueSql("Åtkomstkod"),
  objectKeyNumber: objectMetadataTextValueSql("Nyckelnummer"),
  objectLatitude: objects.latitude,
  objectLongitude: objects.longitude,
  customerName: customers.name,
};

// Fri metadata-sök för grovplaneringen (Task #899, D7). Tokeniserar på blanksteg
// (cap 6) och AND:ar tokens; varje token OR-matchar WO-titel/beskrivning, WO-
// metadata (jsonb-text), objektnamn/adress samt objektets svenska metadatavärden
// (metadata_varden) + katalognamn. Objektberoende matchning ligger i KORRELERADE
// subqueries (refererar work_orders.object_id) så samma villkor funkar i både
// count-frågan (utan join) och data-frågan (med join). v1 matchar endast värden
// satta DIREKT på objektet — inte nedärvda från förälder.
function buildRoughUnplannedSearchCondition(tenantId: string, search: string): SQL | undefined {
  const tokens = search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (tokens.length === 0) return undefined;
  const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
  const tokenConds: SQL[] = tokens.map((tok) => {
    const like = `%${escapeLike(tok)}%`;
    return sql`(
      ${workOrders.title} ILIKE ${like}
      OR ${workOrders.description} ILIKE ${like}
      OR CAST(${workOrders.metadata} AS TEXT) ILIKE ${like}
      OR EXISTS (
        SELECT 1 FROM objects o2
        WHERE o2.id = ${workOrders.objectId}
          AND o2.tenant_id = ${tenantId}
          AND (o2.name ILIKE ${like} OR o2.address ILIKE ${like})
      )
      OR EXISTS (
        SELECT 1 FROM metadata_varden mv
        JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
        WHERE mv.objekt_id = ${workOrders.objectId}
          AND mv.tenant_id = ${tenantId}
          AND mv.status = 'aktiv'
          AND mv.raderad = false
          AND (
            mv.varde_string ILIKE ${like}
            OR mv.varde_referens ILIKE ${like}
            OR CAST(mv.varde_integer AS TEXT) ILIKE ${like}
            OR mk.namn ILIKE ${like}
          )
      )
    )`;
  });
  return tokenConds.length === 1 ? tokenConds[0] : and(...tokenConds);
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getUsersByTenant(tenantId: string): Promise<User[]> {
    // OBS: rollen som returneras är tenant-rollen från user_tenant_roles
    // (per-tenant), inte den globala users.role-kolumnen — det är den
    // som invitations/admin-UI sätter och som spelar roll för access.
    const rows = await db
      .select({ user: users, tenantRole: userTenantRoles.role })
      .from(userTenantRoles)
      .innerJoin(users, eq(userTenantRoles.userId, users.id))
      .where(eq(userTenantRoles.tenantId, tenantId))
      .orderBy(desc(users.createdAt));
    return rows.map(r => ({ ...r.user, role: r.tenantRole ?? r.user.role }));
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db.update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user || undefined;
  }

  async deleteUser(id: string): Promise<{ fkImpact: Record<string, number>; lostInviterInvitations: number }> {
    return await db.transaction(async (tx) => {
      const fkImpact: Record<string, number> = {};
      const bump = async (name: string, p: Promise<unknown>) => {
        const r = await p;
        const n = rowCountOf(r);
        if (n) fkImpact[name] = n;
        return n;
      };

      // user_tenant_roles tas bort helt (inte SET NULL)
      const utrDeleted = await bump("user_tenant_roles", tx.delete(userTenantRoles).where(eq(userTenantRoles.userId, id)));

      await bump("resources.user_id", tx.update(resources).set({ userId: null }).where(eq(resources.userId, id)));
      await bump("tenant_branding.created_by", tx.update(tenantBranding).set({ createdBy: null }).where(eq(tenantBranding.createdBy, id)));
      await bump("tenant_branding.updated_by", tx.update(tenantBranding).set({ updatedBy: null }).where(eq(tenantBranding.updatedBy, id)));
      await bump("user_tenant_roles.assigned_by", tx.update(userTenantRoles).set({ assignedBy: null }).where(eq(userTenantRoles.assignedBy, id)));

      // "Förlorad inbjudare"-markör: pending invitations som hen skapade får
      // en deterministisk sentinel i delivery_error så att UI/audit kan visa
      // varför invited_by är NULL. Status lämnas orörd (pending → kan fortfarande
      // användas av mottagaren) men spårbarheten bevaras.
      const lostMarker = `[INVITER_DELETED:${id}@${new Date().toISOString()}]`;
      const lostInviterRes = await tx
        .update(invitations)
        .set({ invitedBy: null, deliveryError: lostMarker })
        .where(and(eq(invitations.invitedBy, id), eq(invitations.status, "pending")));
      const lostInviterInvitations = rowCountOf(lostInviterRes);
      if (lostInviterInvitations) fkImpact["invitations.invited_by (lost_inviter)"] = lostInviterInvitations;

      // Resterande (icke-pending) invitations: bara nulla invited_by
      await bump("invitations.invited_by", tx.update(invitations).set({ invitedBy: null }).where(eq(invitations.invitedBy, id)));
      await bump("invitations.used_by", tx.update(invitations).set({ usedBy: null }).where(eq(invitations.usedBy, id)));
      await bump("audit_logs.user_id", tx.update(auditLogs).set({ userId: null }).where(eq(auditLogs.userId, id)));
      await bump("tenant_package_installations.installed_by", tx.update(tenantPackageInstallations).set({ installedBy: null }).where(eq(tenantPackageInstallations.installedBy, id)));
      await bump("task_information.created_by", tx.update(taskInformation).set({ createdBy: null }).where(eq(taskInformation.createdBy, id)));
      await bump("order_concepts.created_by", tx.update(orderConcepts).set({ createdBy: null }).where(eq(orderConcepts.createdBy, id)));
      await bump("assignments.created_by", tx.update(assignments).set({ createdBy: null }).where(eq(assignments.createdBy, id)));
      await bump("subscription_changes.approved_by", tx.update(subscriptionChanges).set({ approvedBy: null }).where(eq(subscriptionChanges.approvedBy, id)));
      await bump("order_concept_run_logs.run_by", tx.update(orderConceptRunLogs).set({ runBy: null }).where(eq(orderConceptRunLogs.runBy, id)));
      await bump("customer_booking_requests.handled_by", tx.update(customerBookingRequests).set({ handledBy: null }).where(eq(customerBookingRequests.handledBy, id)));
      await bump("customer_portal_messages.sender_user_id", tx.update(customerPortalMessages).set({ senderUserId: null }).where(eq(customerPortalMessages.senderUserId, id)));
      await bump("customer_issue_reports.assigned_to", tx.update(customerIssueReports).set({ assignedTo: null }).where(eq(customerIssueReports.assignedTo, id)));
      await bump("customer_issue_reports.resolved_by", tx.update(customerIssueReports).set({ resolvedBy: null }).where(eq(customerIssueReports.resolvedBy, id)));
      await bump("protocols.executed_by", tx.update(protocols).set({ executedBy: null }).where(eq(protocols.executedBy, id)));
      await bump("deviation_reports.reported_by", tx.update(deviationReports).set({ reportedBy: null }).where(eq(deviationReports.reportedBy, id)));
      await bump("deviation_reports.resolved_by", tx.update(deviationReports).set({ resolvedBy: null }).where(eq(deviationReports.resolvedBy, id)));
      await bump("qr_code_links.created_by", tx.update(qrCodeLinks).set({ createdBy: null }).where(eq(qrCodeLinks.createdBy, id)));
      await bump("customer_change_requests.reviewed_by", tx.update(customerChangeRequests).set({ reviewedBy: null }).where(eq(customerChangeRequests.reviewedBy, id)));
      await bump("public_issue_reports.reviewed_by", tx.update(publicIssueReports).set({ reviewedBy: null }).where(eq(publicIssueReports.reviewedBy, id)));
      await bump("environmental_data.created_by", tx.update(environmentalData).set({ createdBy: null }).where(eq(environmentalData.createdBy, id)));
      await bump("self_booking_slots.created_by", tx.update(selfBookingSlots).set({ createdBy: null }).where(eq(selfBookingSlots.createdBy, id)));
      await bump("recurring_slot_patterns.created_by", tx.update(recurringSlotPatterns).set({ createdBy: null }).where(eq(recurringSlotPatterns.createdBy, id)));
      await bump("planner_search_filters.created_by", tx.update(plannerSearchFilters).set({ createdBy: null }).where(eq(plannerSearchFilters.createdBy, id)));
      await bump("invoice_recalculation_log.triggered_by", tx.update(invoiceRecalculationLog).set({ triggeredBy: null }).where(eq(invoiceRecalculationLog.triggeredBy, id)));
      // NO ACTION-FK — måste nullas explicit innan DELETE
      await bump("fortnox_contract_suggestions.reviewed_by", tx.update(fortnoxContractSuggestions).set({ reviewedBy: null }).where(eq(fortnoxContractSuggestions.reviewedBy, id)));

      // Töm aktiva sessioner (connect-pg-simple, ingen FK till users)
      const sessRes = await tx.execute(sql`
        DELETE FROM sessions
        WHERE sess->>'userId' = ${id}
           OR sess->'passport'->'user'->'claims'->>'sub' = ${id}
      `);
      const sessDeleted = rowCountOf(sessRes);
      if (sessDeleted) fkImpact["sessions"] = sessDeleted;

      await tx.delete(users).where(eq(users.id, id));
      void utrDeleted;
      return { fkImpact, lostInviterInvitations };
    });
  }

  /**
   * Räknar (utan att modifiera) hur många rader i kritiska tabeller som
   * pekar på en given user. Används av plattformsadmin för att visa
   * "kopplade resurser" innan radering/anonymisering.
   */
  async computeUserResourceImpact(id: string): Promise<Record<string, number>> {
    const countOne = async (label: string, sqlFragment: SQL) => {
      const rows = rowsOf<{ count: number | string }>(await db.execute(sqlFragment));
      const n = Number(rows[0]?.count ?? 0);
      if (n > 0) impact[label] = n;
    };
    const impact: Record<string, number> = {};
    await Promise.all([
      countOne("user_tenant_roles", sql`SELECT COUNT(*)::int AS count FROM user_tenant_roles WHERE user_id = ${id}`),
      countOne("resources.user_id", sql`SELECT COUNT(*)::int AS count FROM resources WHERE user_id = ${id}`),
      countOne("audit_logs.user_id", sql`SELECT COUNT(*)::int AS count FROM audit_logs WHERE user_id = ${id}`),
      countOne("audit_logs.resource_id", sql`SELECT COUNT(*)::int AS count FROM audit_logs WHERE resource_id = ${id}`),
      countOne("invitations.invited_by (pending)", sql`SELECT COUNT(*)::int AS count FROM invitations WHERE invited_by = ${id} AND status = 'pending'`),
      countOne("invitations.invited_by (other)", sql`SELECT COUNT(*)::int AS count FROM invitations WHERE invited_by = ${id} AND status <> 'pending'`),
      countOne("invitations.used_by", sql`SELECT COUNT(*)::int AS count FROM invitations WHERE used_by = ${id}`),
      countOne("protocols.executed_by", sql`SELECT COUNT(*)::int AS count FROM protocols WHERE executed_by = ${id}`),
      countOne("customer_portal_messages.sender_user_id", sql`SELECT COUNT(*)::int AS count FROM customer_portal_messages WHERE sender_user_id = ${id}`),
      countOne("deviation_reports.reported_by", sql`SELECT COUNT(*)::int AS count FROM deviation_reports WHERE reported_by = ${id}`),
      countOne("qr_code_links.created_by", sql`SELECT COUNT(*)::int AS count FROM qr_code_links WHERE created_by = ${id}`),
      countOne("fortnox_contract_suggestions.reviewed_by", sql`SELECT COUNT(*)::int AS count FROM fortnox_contract_suggestions WHERE reviewed_by = ${id}`),
    ]);
    return impact;
  }

  async listAllUsersWithTenants(): Promise<Array<User & { memberships: Array<{ tenantId: string; tenantName: string; role: string; isActive: boolean | null; assignedBy: string | null }> }>> {
    const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
    if (allUsers.length === 0) return [];
    const memberships = await db
      .select({
        userId: userTenantRoles.userId,
        tenantId: userTenantRoles.tenantId,
        tenantName: tenants.name,
        role: userTenantRoles.role,
        isActive: userTenantRoles.isActive,
        assignedBy: userTenantRoles.assignedBy,
      })
      .from(userTenantRoles)
      .innerJoin(tenants, eq(userTenantRoles.tenantId, tenants.id));
    const byUser = new Map<string, Array<{ tenantId: string; tenantName: string; role: string; isActive: boolean | null; assignedBy: string | null }>>();
    for (const m of memberships) {
      const list = byUser.get(m.userId) ?? [];
      list.push({
        tenantId: m.tenantId,
        tenantName: m.tenantName,
        role: m.role,
        isActive: m.isActive,
        assignedBy: m.assignedBy,
      });
      byUser.set(m.userId, list);
    }
    return allUsers.map((u) => ({ ...u, memberships: byUser.get(u.id) ?? [] }));
  }

  /**
   * SQL-paginerad cross-tenant användarlista för plattformsadmin.
   * Filtreringen sker via ILIKE i Postgres (idx_users_email finns), så vi
   * scannar inte hela users-tabellen vid varje sidladdning.
   */
  async listAllUsersWithTenantsPaged(opts: { search?: string; limit: number; offset: number }): Promise<{ users: Array<User & { memberships: Array<{ tenantId: string; tenantName: string; role: string; isActive: boolean | null; assignedBy: string | null }> }>; total: number }> {
    const q = (opts.search ?? "").trim();
    const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;

    // Sökning matchar både user-fält OCH tenant-id/namn — om söksträngen
    // träffar tenant_id eller tenant_name så är användaren med via en
    // EXISTS-subquery mot user_tenant_roles + tenants.
    const baseWhere = like
      ? sql`WHERE u.email ILIKE ${like}
              OR u.first_name ILIKE ${like}
              OR u.last_name ILIKE ${like}
              OR u.id ILIKE ${like}
              OR EXISTS (
                SELECT 1 FROM user_tenant_roles utr
                LEFT JOIN tenants t ON t.id = utr.tenant_id
                WHERE utr.user_id = u.id
                  AND (utr.tenant_id ILIKE ${like} OR t.name ILIKE ${like})
              )`
      : sql``;

    const totalRows = rowsOf<{ total: number | string }>(
      await db.execute(sql`SELECT COUNT(*)::int AS total FROM users u ${baseWhere}`),
    );
    const total = Number(totalRows[0]?.total ?? 0);

    type UserRow = {
      id: string; email: string | null; first_name: string | null; last_name: string | null;
      profile_image_url: string | null; password_hash: string | null; role: string | null;
      resource_id: string | null; is_active: boolean | null; last_login_at: Date | null;
      created_at: Date | null; updated_at: Date | null;
    };
    const page = rowsOf<UserRow>(
      await db.execute(
        sql`SELECT u.* FROM users u ${baseWhere} ORDER BY u.created_at DESC NULLS LAST, u.id ASC LIMIT ${opts.limit} OFFSET ${opts.offset}`,
      ),
    );
    if (page.length === 0) return { users: [], total };

    const ids = page.map((u) => u.id);
    const memberships = await db
      .select({
        userId: userTenantRoles.userId,
        tenantId: userTenantRoles.tenantId,
        tenantName: tenants.name,
        role: userTenantRoles.role,
        isActive: userTenantRoles.isActive,
        assignedBy: userTenantRoles.assignedBy,
      })
      .from(userTenantRoles)
      .innerJoin(tenants, eq(userTenantRoles.tenantId, tenants.id))
      .where(inArray(userTenantRoles.userId, ids));

    const byUser = new Map<string, Array<{ tenantId: string; tenantName: string; role: string; isActive: boolean | null; assignedBy: string | null }>>();
    for (const m of memberships) {
      const list = byUser.get(m.userId) ?? [];
      list.push({
        tenantId: m.tenantId,
        tenantName: m.tenantName,
        role: m.role,
        isActive: m.isActive,
        assignedBy: m.assignedBy,
      });
      byUser.set(m.userId, list);
    }
    const users = page.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      profileImageUrl: u.profile_image_url,
      passwordHash: u.password_hash,
      role: u.role,
      resourceId: u.resource_id,
      isActive: u.is_active,
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
      memberships: byUser.get(u.id) ?? [],
    })) as Array<User & { memberships: Array<{ tenantId: string; tenantName: string; role: string; isActive: boolean | null; assignedBy: string | null }> }>;
    return { users, total };
  }

  async anonymizeUser(id: string): Promise<User | undefined> {
    return db.transaction(async (tx) => {
      const existing = await tx.select().from(users).where(eq(users.id, id)).limit(1);
      if (existing.length === 0) return undefined;
      const placeholder = `anonymized-${id}@deleted.local`;
      const [updated] = await tx
        .update(users)
        .set({
          email: placeholder,
          firstName: "Anonymiserad",
          lastName: "Användare",
          profileImageUrl: null,
          passwordHash: null,
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();
      await tx
        .update(userTenantRoles)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(userTenantRoles.userId, id));
      await tx.execute(sql`
        DELETE FROM sessions
        WHERE sess->>'userId' = ${id}
           OR sess->'passport'->'user'->'claims'->>'sub' = ${id}
      `);
      return updated;
    });
  }

  async upsertUser(userData: Partial<UpsertUser> & { id: string; email: string }): Promise<User> {
    const existing = await this.getUser(userData.id);
    if (existing) {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (userData.firstName !== undefined) updateData.firstName = userData.firstName;
      if (userData.lastName !== undefined) updateData.lastName = userData.lastName;
      if (userData.passwordHash !== undefined) updateData.passwordHash = userData.passwordHash;
      if (userData.profileImageUrl !== undefined) updateData.profileImageUrl = userData.profileImageUrl;
      
      const [updated] = await db.update(users)
        .set(updateData)
        .where(eq(users.id, userData.id))
        .returning();
      return updated;
    }
    const [user] = await db.insert(users).values({
      id: userData.id,
      email: userData.email,
      firstName: userData.firstName || null,
      lastName: userData.lastName || null,
      passwordHash: userData.passwordHash || null,
      profileImageUrl: userData.profileImageUrl || null,
    }).returning();
    return user;
  }

  async getTenant(id: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(and(eq(tenants.id, id), isNull(tenants.deletedAt)));
    return tenant || undefined;
  }

  async getPublicTenants(): Promise<Tenant[]> {
    return db.select().from(tenants).where(isNull(tenants.deletedAt));
  }

  async createTenant(insertTenant: InsertTenant): Promise<Tenant> {
    const [tenant] = await db.insert(tenants).values(insertTenant).returning();

    try {
      await db.insert(tenantFeatures).values({
        tenantId: tenant.id,
        packageTier: "basic",
        enabledModules: ["core", "work_sessions"],
        updatedBy: "system",
      }).onConflictDoNothing();
    } catch (e) {
      console.error("[tenant-features] Failed to create default features for tenant:", tenant.id, e);
    }

    return tenant;
  }

  async ensureTenant(id: string, defaultData: Omit<InsertTenant, 'id'>): Promise<Tenant> {
    // Try to get existing tenant first
    let tenant = await this.getTenant(id);
    if (tenant) return tenant;
    
    // Use upsert with onConflictDoNothing to handle race conditions
    const [newTenant] = await db.insert(tenants)
      .values({ ...defaultData, id } as InsertTenant)
      .onConflictDoNothing({ target: tenants.id })
      .returning();
    
    if (newTenant) {
      console.log("Created tenant:", id);
      return newTenant;
    }
    
    // Another request created it - fetch it
    tenant = await this.getTenant(id);
    if (!tenant) {
      throw new Error(`Failed to ensure tenant ${id}`);
    }
    return tenant;
  }

  async updateTenant(id: string, data: Partial<InsertTenant>): Promise<Tenant | undefined> {
    const { id: _, ...updateData } = data as Partial<InsertTenant> & { id?: string };
    const [tenant] = await db.update(tenants).set(updateData).where(eq(tenants.id, id)).returning();
    return tenant || undefined;
  }

  async updateTenantSettings(id: string, settings: Record<string, unknown>): Promise<Tenant | undefined> {
    const [tenant] = await db.update(tenants).set({ settings }).where(eq(tenants.id, id)).returning();
    return tenant || undefined;
  }

  async updateTenantSmsSettings(id: string, data: { smsEnabled?: boolean; smsProvider?: string; smsFromName?: string }): Promise<Tenant | undefined> {
    const [tenant] = await db.update(tenants).set({
      smsEnabled: data.smsEnabled,
      smsProvider: data.smsProvider,
      smsFromName: data.smsFromName,
    }).where(eq(tenants.id, id)).returning();
    return tenant || undefined;
  }

  async getCustomers(tenantId: string): Promise<Customer[]> {
    return db.select().from(customers).where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
  }

  async getCustomersPaginated(
    tenantId: string,
    limit: number,
    offset: number,
    search?: string,
    filters?: { hierarchyType?: string | "none"; rootsOnly?: boolean },
  ): Promise<{ customers: Customer[]; total: number }> {
    const { count } = await import("drizzle-orm");
    let whereConditions = and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt));
    if (search && search.trim()) {
      const searchTerm = `%${search.toLowerCase()}%`;
      whereConditions = and(
        whereConditions,
        or(
          sql`LOWER(${customers.name}) LIKE ${searchTerm}`,
          sql`LOWER(${customers.customerNumber}) LIKE ${searchTerm}`,
          sql`LOWER(${customers.email}) LIKE ${searchTerm}`,
          sql`LOWER(${customers.city}) LIKE ${searchTerm}`
        )
      );
    }
    if (filters?.hierarchyType) {
      whereConditions = filters.hierarchyType === "none"
        ? and(whereConditions, isNull(customers.hierarchyType))
        : and(whereConditions, eq(customers.hierarchyType, filters.hierarchyType));
    }
    if (filters?.rootsOnly) {
      whereConditions = and(whereConditions, isNull(customers.parentCustomerId));
    }
    const [countResult] = await db.select({ count: count() }).from(customers).where(whereConditions);
    const total = countResult?.count || 0;
    const customersList = await db.select().from(customers).where(whereConditions).orderBy(customers.name).limit(limit).offset(offset);
    return { customers: customersList, total };
  }

  async getCustomer(id: string): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt)));
    return customer || undefined;
  }

  async getCustomersByIds(tenantId: string, ids: string[]): Promise<Customer[]> {
    if (!ids || ids.length === 0) return [];
    const limited = ids.slice(0, 500);
    return db.select()
      .from(customers)
      .where(and(
        eq(customers.tenantId, tenantId),
        isNull(customers.deletedAt),
        inArray(customers.id, limited)
      ));
  }

  async getCustomerAggregates(tenantId: string, customerIds?: string[]): Promise<Array<{ customerId: string; objectCount: number; activeOrders: number }>> {
    if (customerIds && customerIds.length === 0) {
      return [];
    }
    const idFilter = customerIds && customerIds.length > 0
      ? sql` AND c.id IN (${sql.join(customerIds.map(id => sql`${id}`), sql`, `)})`
      : sql``;
    const objIdFilter = customerIds && customerIds.length > 0
      ? sql` AND customer_id IN (${sql.join(customerIds.map(id => sql`${id}`), sql`, `)})`
      : sql``;
    // Etapp 5: objektantal per kund härleds ur Ekonomi-metadatat ("Kund"),
    // inte gamla object_payers-tabellen.
    const result = await db.execute(sql`
      SELECT
        c.id as customer_id,
        COALESCE(o.object_count, 0)::int as object_count,
        COALESCE(wo.active_orders, 0)::int as active_orders
      FROM customers c
      LEFT JOIN (
        SELECT ${primaryPayerCustomerIdSqlFor(sql.raw('"objects"."id"'))} AS customer_id, COUNT(*) as object_count
        FROM objects
        WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
        GROUP BY 1
      ) o ON o.customer_id = c.id
      LEFT JOIN (
        SELECT customer_id, COUNT(*) as active_orders
        FROM work_orders
        WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
          AND order_status NOT IN ('utford', 'fakturerad')${objIdFilter}
        GROUP BY customer_id
      ) wo ON wo.customer_id = c.id
      WHERE c.tenant_id = ${tenantId} AND c.deleted_at IS NULL${idFilter}
    `);
    interface AggRow { customer_id: string; object_count: number; active_orders: number }
    return (result.rows as AggRow[]).map(r => ({
      customerId: r.customer_id,
      objectCount: Number(r.object_count) || 0,
      activeOrders: Number(r.active_orders) || 0,
    }));
  }

  async getCustomerTotals(tenantId: string): Promise<{ customerCount: number; objectCount: number; activeOrders: number }> {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM customers WHERE tenant_id = ${tenantId} AND deleted_at IS NULL) as customer_count,
        (SELECT COUNT(*)::int FROM objects WHERE tenant_id = ${tenantId} AND deleted_at IS NULL) as object_count,
        (SELECT COUNT(*)::int FROM work_orders WHERE tenant_id = ${tenantId} AND deleted_at IS NULL AND order_status NOT IN ('utford', 'fakturerad')) as active_orders
    `);
    interface TotalsRow { customer_count: number; object_count: number; active_orders: number }
    const row = (result.rows as TotalsRow[])[0];
    return {
      customerCount: Number(row?.customer_count) || 0,
      objectCount: Number(row?.object_count) || 0,
      activeOrders: Number(row?.active_orders) || 0,
    };
  }

  async getCustomerStats(tenantId: string, customerId: string) {
    // Kundkoppling läses via Ekonomi-metadatat "Kund", inte legacy
    // objects.customer_id — ADR v3. Snöret/KPI på kundöversikten aggregeras över
    // HELA kund-hierarkin (kund + ättlingar) så att en koncern visar rollup av
    // alla regioners/lokalers objekt, ordrar och abonnemang. Leaf-kund (inga
    // ättlingar) ger oförändrat resultat.
    const descendants = await this.getCustomerDescendants(tenantId, customerId);
    const customerIds = [customerId, ...descendants];
    const customerIdList = sql.join(customerIds.map((id) => sql`${id}`), sql`, `);
    // Etapp 5: kundkopplingen härleds ur Ekonomi-metadatat ("Kund"), inte
    // gamla object_payers-tabellen.
    const objectIsForCustomerSql = sql`(${primaryPayerCustomerIdSqlFor(sql.raw('"objects"."id"'))} IN (${customerIdList}))`;
    const [levelsRes, ordersRes, subsRes, invoicedRes] = await Promise.all([
      db.execute(sql`
        SELECT COALESCE(hierarchy_level, 'fastighet') as level, COUNT(*)::int as count
        FROM objects
        WHERE tenant_id = ${tenantId} AND ${objectIsForCustomerSql} AND deleted_at IS NULL
        GROUP BY COALESCE(hierarchy_level, 'fastighet')
      `),
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE order_status NOT IN ('utford', 'fakturerad'))::int as active_orders,
          COUNT(*) FILTER (WHERE order_status = 'utford')::int as completed_orders,
          COUNT(*) FILTER (WHERE order_status = 'fakturerad')::int as invoiced_orders,
          COUNT(*)::int as total_orders
        FROM work_orders
        WHERE tenant_id = ${tenantId} AND customer_id IN (${customerIdList}) AND deleted_at IS NULL
      `),
      db.execute(sql`
        SELECT COUNT(*)::int as active_subscriptions
        FROM subscriptions
        WHERE tenant_id = ${tenantId} AND customer_id IN (${customerIdList})
          AND (end_date IS NULL OR end_date > NOW())
      `),
      db.execute(sql`
        SELECT COALESCE(SUM(cached_value), 0)::bigint as invoiced_total
        FROM work_orders
        WHERE tenant_id = ${tenantId} AND customer_id IN (${customerIdList}) AND deleted_at IS NULL
          AND order_status = 'fakturerad'
          AND scheduled_date >= NOW() - INTERVAL '12 months'
      `),
    ]);

    interface LevelRow { level: string; count: number }
    interface OrdersRow { active_orders: number; completed_orders: number; invoiced_orders: number; total_orders: number }
    interface SubsRow { active_subscriptions: number }
    interface InvRow { invoiced_total: string | number }

    const objectsByLevel: Record<string, number> = {};
    for (const r of levelsRes.rows as LevelRow[]) {
      objectsByLevel[r.level] = Number(r.count) || 0;
    }
    const orders = (ordersRes.rows as OrdersRow[])[0] || { active_orders: 0, completed_orders: 0, invoiced_orders: 0, total_orders: 0 };
    const subs = (subsRes.rows as SubsRow[])[0] || { active_subscriptions: 0 };
    const inv = (invoicedRes.rows as InvRow[])[0] || { invoiced_total: 0 };
    const totalObjects = Object.values(objectsByLevel).reduce((a, b) => a + b, 0);

    return {
      objectsByLevel,
      totalObjects,
      activeOrders: Number(orders.active_orders) || 0,
      completedOrders: Number(orders.completed_orders) || 0,
      invoicedOrders: Number(orders.invoiced_orders) || 0,
      totalOrders: Number(orders.total_orders) || 0,
      activeSubscriptions: Number(subs.active_subscriptions) || 0,
      invoicedLast12Months: Number(inv.invoiced_total) || 0,
    };
  }

  async createCustomer(insertCustomer: InsertCustomer): Promise<Customer> {
    const [customer] = await db.insert(customers).values(insertCustomer).returning();
    return customer;
  }

  // Enkel uppgift (Task #736): löser ut tenantens interna kund som används som
  // fallback-beställare när en enkel uppgift skapas utan vald kund. Identifieras
  // via det stabila customerNumber-sentinelvärdet "INTERN" (per tenant). Skapar
  // kunden vid första anropet. tenant_id finns i alla predicate (defense-in-depth).
  async resolveInternalCustomer(tenantId: string): Promise<Customer> {
    const [existing] = await db
      .select()
      .from(customers)
      .where(and(
        eq(customers.tenantId, tenantId),
        eq(customers.customerNumber, "INTERN"),
        isNull(customers.deletedAt),
      ))
      .limit(1);
    if (existing) return existing;
    return this.createCustomer({
      tenantId,
      name: "Intern uppgift",
      customerNumber: "INTERN",
    } as InsertCustomer);
  }

  async updateCustomer(id: string, data: Partial<InsertCustomer>): Promise<Customer | undefined> {
    const [customer] = await db.update(customers).set(data).where(eq(customers.id, id)).returning();
    return customer || undefined;
  }

  async deleteCustomer(id: string): Promise<void> {
    await db.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, id));
    // Städa Fortnox-mappningen så att den inte blir föräldralös (Task #468).
    try {
      await this.deleteFortnoxMappingsForEntity("customer", id);
    } catch (e) {
      console.warn("[fortnox-mapping] kunde inte rensa mappning för kund", id, e);
    }
  }

  async restoreCustomer(id: string, tenantId: string): Promise<Customer | undefined> {
    const [restored] = await db
      .update(customers)
      .set({ deletedAt: null })
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))
      .returning();
    return restored;
  }

  // ─── ADR v3 §2.2: Kund-hierarki ─────────────────────────────────────────
  async getCustomerParent(tenantId: string, customerId: string): Promise<Customer | null> {
    const [row] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
    if (!row || !row.parentCustomerId) return null;
    const [parent] = await db
      .select()
      .from(customers)
      .where(and(
        eq(customers.id, row.parentCustomerId),
        eq(customers.tenantId, tenantId),
        isNull(customers.deletedAt),
      ));
    return parent ?? null;
  }

  async getCustomerChildren(tenantId: string, customerId: string): Promise<Customer[]> {
    return db
      .select()
      .from(customers)
      .where(and(
        eq(customers.tenantId, tenantId),
        eq(customers.parentCustomerId, customerId),
        isNull(customers.deletedAt),
      ))
      .orderBy(customers.name);
  }

  async getCustomerAncestors(tenantId: string, customerId: string): Promise<Customer[]> {
    // Iterativ uppåtgång med cykelskydd (max 32 nivåer = max-djup-skydd).
    const seen = new Set<string>([customerId]);
    const result: Customer[] = [];
    let currentId: string | null | undefined = customerId;
    for (let i = 0; i < 32; i++) {
      if (!currentId) break;
      const [row] = await db
        .select()
        .from(customers)
        .where(and(
          eq(customers.id, currentId),
          eq(customers.tenantId, tenantId),
          isNull(customers.deletedAt),
        ));
      if (!row || !row.parentCustomerId) break;
      if (seen.has(row.parentCustomerId)) break; // cykel-skydd
      const [parent] = await db
        .select()
        .from(customers)
        .where(and(
          eq(customers.id, row.parentCustomerId),
          eq(customers.tenantId, tenantId),
          isNull(customers.deletedAt),
        ));
      if (!parent) break;
      result.push(parent);
      seen.add(parent.id);
      currentId = parent.id;
    }
    return result;
  }

  async getCustomerDescendants(tenantId: string, customerId: string): Promise<string[]> {
    const result = await db.execute(sql`
      WITH RECURSIVE subtree AS (
        SELECT id, 0 as depth
        FROM customers
        WHERE id = ${customerId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
        UNION ALL
        SELECT c.id, s.depth + 1
        FROM customers c
        JOIN subtree s ON c.parent_customer_id = s.id
        WHERE c.tenant_id = ${tenantId} AND c.deleted_at IS NULL AND s.depth < 32
      )
      SELECT id FROM subtree WHERE id != ${customerId}
    `);
    return (result.rows as Array<{ id: string }>).map(r => r.id);
  }

  async getCustomerHierarchyStats(tenantId: string, customerId: string): Promise<{
    self: { objectCount: number; activeOrders: number; ordersLast30Days: number; revenueLast30Days: number };
    rollup: { objectCount: number; activeOrders: number; ordersLast30Days: number; revenueLast30Days: number };
    descendantCount: number;
    children: Array<{
      id: string;
      name: string;
      hierarchyType: string | null;
      isReseller: boolean;
      objectCount: number;
      activeOrders: number;
      ordersLast30Days: number;
      revenueLast30Days: number;
      descendantCount: number;
    }>;
  }> {
    const result = await db.execute(sql`
      WITH RECURSIVE subtree AS (
        SELECT id as cid, id as branch_root, 0 as depth
        FROM customers
        WHERE id = ${customerId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
        UNION ALL
        SELECT c.id,
               CASE WHEN s.depth = 0 THEN c.id ELSE s.branch_root END,
               s.depth + 1
        FROM customers c
        JOIN subtree s ON c.parent_customer_id = s.cid
        WHERE c.tenant_id = ${tenantId} AND c.deleted_at IS NULL AND s.depth < 32
      ),
      obj_stats AS (
        SELECT k.customer_id, COUNT(*)::int as object_count
        FROM (
          SELECT ${primaryPayerCustomerIdSqlFor(sql.raw('o.id'))} AS customer_id
          FROM objects o
          WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL
        ) k
        WHERE k.customer_id IN (SELECT cid FROM subtree)
        GROUP BY k.customer_id
      ),
      wo_stats AS (
        SELECT customer_id,
               COUNT(*) FILTER (WHERE order_status NOT IN ('utford','fakturerad'))::int as active_orders,
               COUNT(*) FILTER (WHERE COALESCE(scheduled_date, created_at::date) >= (NOW() - INTERVAL '30 days')::date)::int as orders_30d,
               COALESCE(SUM(cached_value) FILTER (WHERE COALESCE(scheduled_date, created_at::date) >= (NOW() - INTERVAL '30 days')::date), 0)::bigint as revenue_30d
        FROM work_orders
        WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
          AND customer_id IN (SELECT cid FROM subtree)
        GROUP BY customer_id
      )
      SELECT s.branch_root, s.cid, s.depth,
             COALESCE(o.object_count, 0)::int as object_count,
             COALESCE(w.active_orders, 0)::int as active_orders,
             COALESCE(w.orders_30d, 0)::int as orders_30d,
             COALESCE(w.revenue_30d, 0)::bigint as revenue_30d
        FROM subtree s
        LEFT JOIN obj_stats o ON o.customer_id = s.cid
        LEFT JOIN wo_stats w ON w.customer_id = s.cid
    `);

    interface Row {
      branch_root: string; cid: string; depth: number;
      object_count: number | string; active_orders: number | string;
      orders_30d: number | string; revenue_30d: number | string;
    }
    const rows = result.rows as Row[];

    const self = { objectCount: 0, activeOrders: 0, ordersLast30Days: 0, revenueLast30Days: 0 };
    const rollup = { objectCount: 0, activeOrders: 0, ordersLast30Days: 0, revenueLast30Days: 0 };
    const byBranch = new Map<string, { objectCount: number; activeOrders: number; ordersLast30Days: number; revenueLast30Days: number; descendantCount: number }>();
    let descendantCount = 0;

    for (const r of rows) {
      const s = {
        objectCount: Number(r.object_count) || 0,
        activeOrders: Number(r.active_orders) || 0,
        ordersLast30Days: Number(r.orders_30d) || 0,
        revenueLast30Days: Number(r.revenue_30d) || 0,
      };
      rollup.objectCount += s.objectCount;
      rollup.activeOrders += s.activeOrders;
      rollup.ordersLast30Days += s.ordersLast30Days;
      rollup.revenueLast30Days += s.revenueLast30Days;

      if (r.depth === 0) {
        Object.assign(self, s);
      } else {
        descendantCount += 1;
        const existing = byBranch.get(r.branch_root) || { objectCount: 0, activeOrders: 0, ordersLast30Days: 0, revenueLast30Days: 0, descendantCount: 0 };
        existing.objectCount += s.objectCount;
        existing.activeOrders += s.activeOrders;
        existing.ordersLast30Days += s.ordersLast30Days;
        existing.revenueLast30Days += s.revenueLast30Days;
        if (r.cid !== r.branch_root) existing.descendantCount += 1;
        byBranch.set(r.branch_root, existing);
      }
    }

    const childRows = await this.getCustomerChildren(tenantId, customerId);
    const children = childRows.map(c => {
      const b = byBranch.get(c.id) || { objectCount: 0, activeOrders: 0, ordersLast30Days: 0, revenueLast30Days: 0, descendantCount: 0 };
      return {
        id: c.id,
        name: c.name,
        hierarchyType: c.hierarchyType,
        isReseller: c.isReseller,
        ...b,
      };
    });

    return { self, rollup, descendantCount, children };
  }

  async setCustomerParent(tenantId: string, customerId: string, parentId: string | null): Promise<Customer> {
    const [existing] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
    if (!existing) {
      throw new Error("Kund hittades inte");
    }

    if (parentId) {
      if (parentId === customerId) {
        throw new Error("En kund kan inte vara sin egen förälder");
      }
      const [parent] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, parentId), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
      if (!parent) {
        throw new Error("Föräldra-kund hittades inte i denna tenant");
      }
      // Cykelskydd: parentens förfäder får inte innehålla customerId.
      const parentAncestors = await this.getCustomerAncestors(tenantId, parentId);
      if (parentAncestors.some((a) => a.id === customerId)) {
        throw new Error("Cirkulär hierarki — den valda föräldern är redan ett barn till denna kund");
      }
    }

    const [updated] = await db
      .update(customers)
      .set({ parentCustomerId: parentId })
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
      .returning();
    if (!updated) throw new Error("Kunde inte uppdatera kund");
    return updated;
  }

  async getCustomerRelationships(tenantId: string, customerId: string): Promise<{
    outgoing: CustomerRelationship[];
    incoming: CustomerRelationship[];
  }> {
    const [outgoing, incoming] = await Promise.all([
      db.select().from(customerRelationships).where(and(
        eq(customerRelationships.tenantId, tenantId),
        eq(customerRelationships.fromCustomerId, customerId),
      )).orderBy(desc(customerRelationships.createdAt)),
      db.select().from(customerRelationships).where(and(
        eq(customerRelationships.tenantId, tenantId),
        eq(customerRelationships.toCustomerId, customerId),
      )).orderBy(desc(customerRelationships.createdAt)),
    ]);
    return { outgoing, incoming };
  }

  async createCustomerRelationship(data: InsertCustomerRelationship): Promise<CustomerRelationship> {
    // Verifiera att båda kunder tillhör samma tenant.
    const both = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(
        eq(customers.tenantId, data.tenantId),
        isNull(customers.deletedAt),
        inArray(customers.id, [data.fromCustomerId, data.toCustomerId]),
      ));
    if (both.length !== 2 && data.fromCustomerId !== data.toCustomerId) {
      throw new Error("En eller båda kunderna saknas i denna tenant");
    }
    if (data.fromCustomerId === data.toCustomerId) {
      throw new Error("En kund kan inte ha relation till sig själv");
    }
    const [row] = await db.insert(customerRelationships).values(data).returning();
    return row;
  }

  async deleteCustomerRelationship(tenantId: string, id: string): Promise<void> {
    await db.delete(customerRelationships).where(and(
      eq(customerRelationships.id, id),
      eq(customerRelationships.tenantId, tenantId),
    ));
  }

  async getObjects(tenantId: string): Promise<ServiceObject[]> {
    return db.select(objectColumnsWithPrimaryCustomer()).from(objects).where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
  }

  async getObjectsPaginated(tenantId: string, limit: number, offset: number, search?: string, customerIds?: string[], filters?: { objectType?: string; hierarchyLevel?: string; isInterimObject?: boolean; issue?: string; reported?: boolean; locationType?: string; linkedTask?: LinkedTaskFilter }): Promise<{ objects: ServiceObject[]; total: number }> {
    const { sql, count } = await import("drizzle-orm");
    
    let whereConditions = and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt));
    
    if (customerIds && customerIds.length > 0) {
      if (customerIds.length === 1) {
        whereConditions = and(whereConditions, objectHasPrimaryCustomerSql(customerIds[0]));
      } else {
        whereConditions = and(whereConditions, objectPrimaryCustomerInSql(customerIds));
      }
    }
    
    if (filters?.objectType) {
      whereConditions = and(whereConditions, eq(objects.objectType, filters.objectType));
    }
    
    if (filters?.hierarchyLevel) {
      whereConditions = and(whereConditions, eq(objects.hierarchyLevel, filters.hierarchyLevel));
    }
    
    if (filters?.isInterimObject !== undefined) {
      whereConditions = and(whereConditions, eq(objects.isInterimObject, filters.isInterimObject));
    }


    // Task #990: platstyp-filter. Måste spegla resolveEffectiveObjectLocationType
    // exakt — explicit kolumnvärde vinner, annars härleds typen för legacy-rader
    // (location_type NULL). "Användbar" koordinat = ej NULL och ej 0.
    if (filters?.locationType) {
      const anyUsable = sql`(
        (${objects.latitude} IS NOT NULL AND ${objects.latitude} <> 0 AND ${objects.longitude} IS NOT NULL AND ${objects.longitude} <> 0)
        OR (${objects.entranceLatitude} IS NOT NULL AND ${objects.entranceLatitude} <> 0 AND ${objects.entranceLongitude} IS NOT NULL AND ${objects.entranceLongitude} <> 0)
      )`;
      if (filters.locationType === "pinpoint") {
        whereConditions = and(whereConditions, sql`(${objects.locationType} = 'pinpoint' OR (${objects.locationType} IS NULL AND ${anyUsable}))`);
      } else if (filters.locationType === "area") {
        whereConditions = and(whereConditions, sql`(${objects.locationType} = 'area' OR (${objects.locationType} IS NULL AND ${objects.polylineData} IS NOT NULL AND NOT ${anyUsable}))`);
      } else if (filters.locationType === "none") {
        whereConditions = and(whereConditions, sql`(${objects.locationType} = 'none' OR (${objects.locationType} IS NULL AND ${objects.polylineData} IS NULL AND NOT ${anyUsable}))`);
      }
    }

    // Task #1083: sök på kopplade uppgifter (uppgiftstyp / order-kund / utförd
    // tidsperiod). Filtrerar objekt på minst en UTFÖRD work order som matchar.
    // Kunden härleds via work_orders.customer_id (order-/koncept-kund), aldrig
    // via objektets primär-payer. Tenant-scopas i subqueryn (defense-in-depth).
    if (filters?.linkedTask) {
      const linkedTaskSql = objectHasLinkedTaskSql(tenantId, filters.linkedTask);
      if (linkedTaskSql) {
        whereConditions = and(whereConditions, linkedTaskSql);
      }
    }

    // Aktiva avvikelser/incidenter: objekt med minst en öppen rapport i någon av de
    // tre rapport-tabellerna. Tenant-scopas i varje subquery (defense-in-depth).
    if (filters?.reported) {
      whereConditions = and(whereConditions, sql`(
        EXISTS (SELECT 1 FROM deviation_reports dr WHERE dr.object_id = ${objects.id} AND dr.tenant_id = ${tenantId} AND dr.status NOT IN ('resolved', 'cancelled'))
        OR EXISTS (SELECT 1 FROM public_issue_reports pir WHERE pir.object_id = ${objects.id} AND pir.tenant_id = ${tenantId} AND pir.status IN ('new', 'reviewed'))
        OR EXISTS (SELECT 1 FROM customer_issue_reports cir WHERE cir.object_id = ${objects.id} AND cir.tenant_id = ${tenantId} AND cir.status IN ('open', 'in_progress'))
      )`);
    }

    if (filters?.issue) {
      if (filters.issue === "no-coords") {
        whereConditions = and(whereConditions, sql`(${objects.latitude} IS NULL OR ${objects.longitude} IS NULL)`);
      } else if (filters.issue === "no-address") {
        whereConditions = and(whereConditions, sql`(${objects.address} IS NULL OR ${objects.address} = '')`);
      } else if (filters.issue === "no-customer") {
        whereConditions = and(whereConditions, objectHasNoPrimaryCustomerSql(tenantId));
      } else if (filters.issue === "empty-metadata") {
        // Task #992-cleanup: kanoniska svenska metadata_varden (ej mjuk-raderade).
        // "Tomt" = objektet har minst en aktiv värde-rad utan någon typad värde-kolumn satt.
        whereConditions = and(whereConditions, sql`EXISTS (SELECT 1 FROM metadata_varden mv WHERE mv.objekt_id = ${objects.id} AND mv.tenant_id = ${tenantId} AND mv.status = 'aktiv' AND mv.raderad = false AND (mv.varde_string IS NULL OR mv.varde_string = '') AND mv.varde_integer IS NULL AND mv.varde_decimal IS NULL AND mv.varde_boolean IS NULL AND mv.varde_datetime IS NULL AND mv.varde_json IS NULL AND mv.varde_referens IS NULL)`);
      }
    }
    
    if (search && search.trim()) {
      const searchTerm = `%${search.toLowerCase()}%`;
      whereConditions = and(
        whereConditions,
        or(
          sql`LOWER(${objects.name}) LIKE ${searchTerm}`,
          sql`LOWER(${objects.objectNumber}) LIKE ${searchTerm}`,
          sql`LOWER(${objects.address}) LIKE ${searchTerm}`,
          sql`LOWER(${objects.city}) LIKE ${searchTerm}`
        )
      );
    }
    
    const [countResult] = await db.select({ count: count() }).from(objects).where(whereConditions);
    const total = countResult?.count || 0;
    
    const objectsList = await db.select(objectColumnsWithPrimaryCustomer())
      .from(objects)
      .where(whereConditions)
      .orderBy(objects.name)
      .limit(limit)
      .offset(offset);
    
    return { objects: objectsList, total };
  }

  async getObjectsByIds(tenantId: string, ids: string[]): Promise<ServiceObject[]> {
    if (ids.length === 0) return [];
    const { inArray } = await import("drizzle-orm");
    return db.select(objectColumnsWithPrimaryCustomer())
      .from(objects)
      .where(and(
        eq(objects.tenantId, tenantId),
        isNull(objects.deletedAt),
        inArray(objects.id, ids)
      ));
  }

  async getObjectsWithIssues(tenantId: string, options?: { issueType?: string; status?: string; customerId?: string; limit?: number }) {
    const { issueType, status, customerId, limit } = options || {};
    const statusFilter = status ? sql` AND dr.status = ${status}` : sql``;
    const issueTypeFilter = issueType ? sql` AND COALESCE(dr.category, 'other') = ${issueType}` : sql``;
    const customerFilter = customerId
      ? sql` AND (${primaryPayerCustomerIdSqlFor(sql.raw('o.id'))} = ${customerId})`
      : sql``;

    // Aggregate per (object, category) using a single SQL query.
    const aggResult = await db.execute(sql`
      WITH issues AS (
        SELECT
          dr.object_id,
          COALESCE(dr.category, 'other') AS category,
          dr.id,
          dr.title,
          dr.status,
          dr.reported_at,
          dr.severity_level AS severity,
          ROW_NUMBER() OVER (
            PARTITION BY dr.object_id, COALESCE(dr.category, 'other')
            ORDER BY dr.reported_at DESC
          ) AS rn,
          COUNT(*) OVER (PARTITION BY dr.object_id, COALESCE(dr.category, 'other')) AS issue_count,
          MAX(dr.reported_at) OVER (PARTITION BY dr.object_id, COALESCE(dr.category, 'other')) AS latest_issue
        FROM deviation_reports dr
        INNER JOIN objects o ON o.id = dr.object_id AND o.tenant_id = ${tenantId} AND o.deleted_at IS NULL
        WHERE dr.tenant_id = ${tenantId}
          ${statusFilter}
          ${issueTypeFilter}
          ${customerFilter}
      )
      SELECT object_id, category, id, title, status, reported_at, severity, issue_count, latest_issue
      FROM issues
      WHERE rn <= 5
      ORDER BY latest_issue DESC, object_id, rn
    `);

    interface IssueAggRow {
      object_id: string;
      category: string;
      id: string;
      title: string;
      status: string;
      reported_at: Date;
      severity: string | null;
      issue_count: string | number;
      latest_issue: Date | null;
    }

    type GroupKey = string;
    const groups = new Map<GroupKey, {
      objectId: string;
      category: string;
      issueCount: number;
      latestIssue: Date | null;
      severity?: string;
      details: Array<{ id: string; title: string; status: string; reportedAt: Date; severity: string | null }>;
    }>();

    const objectIdSet = new Set<string>();
    for (const row of aggResult.rows as IssueAggRow[]) {
      const key = `${row.object_id}::${row.category}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          objectId: row.object_id,
          category: row.category,
          issueCount: Number(row.issue_count) || 0,
          latestIssue: row.latest_issue ? new Date(row.latest_issue) : null,
          severity: undefined,
          details: [],
        };
        groups.set(key, g);
        objectIdSet.add(row.object_id);
      }
      if (g.details.length === 0 && row.severity) {
        g.severity = row.severity;
      }
      g.details.push({
        id: row.id,
        title: row.title,
        status: row.status,
        reportedAt: new Date(row.reported_at),
        severity: row.severity,
      });
    }

    // Fetch all involved objects in one query.
    const objectIds = Array.from(objectIdSet);
    const objectRows = objectIds.length > 0 ? await this.getObjectsByIds(tenantId, objectIds) : [];
    const objectMap = new Map<string, ServiceObject>();
    for (const obj of objectRows) {
      objectMap.set(obj.id, obj);
    }

    const allItems = Array.from(groups.values())
      .filter(g => objectMap.has(g.objectId))
      .map(g => ({
        object: objectMap.get(g.objectId)!,
        issueType: g.category,
        issueCount: g.issueCount,
        latestIssue: g.latestIssue,
        severity: g.severity,
        details: g.details,
      }));

    allItems.sort((a, b) => {
      if (!a.latestIssue) return 1;
      if (!b.latestIssue) return -1;
      return b.latestIssue.getTime() - a.latestIssue.getTime();
    });

    const issueTypeCounts: Record<string, number> = {};
    for (const item of allItems) {
      issueTypeCounts[item.issueType] = (issueTypeCounts[item.issueType] || 0) + 1;
    }

    // Apply limit *after* totals are computed, so callers still see the full count.
    const limited = limit && limit > 0 ? allItems.slice(0, limit) : allItems;
    return {
      totalObjectsWithIssues: allItems.length,
      issueTypes: issueTypeCounts,
      objects: limited,
    };
  }

  async getObject(id: string): Promise<ServiceObject | undefined> {
    const [object] = await db.select(objectColumnsWithPrimaryCustomer()).from(objects).where(and(eq(objects.id, id), isNull(objects.deletedAt)));
    return object || undefined;
  }

  async getObjectByObjectNumber(tenantId: string, objectNumber: string): Promise<ServiceObject | undefined> {
    const [object] = await db.select(objectColumnsWithPrimaryCustomer()).from(objects).where(
      and(eq(objects.tenantId, tenantId), eq(objects.objectNumber, objectNumber), isNull(objects.deletedAt))
    );
    return object || undefined;
  }

  async getObjectsByCustomer(customerId: string, tenantId?: string): Promise<ServiceObject[]> {
    // Källan för "tillhör kund X" är Ekonomi-metadatat "Kund", inte legacy
    // objects.customer_id. tenantId krävs egentligen för att garantera
    // tenant-isolation; vi tar ändå emot den som optional för bakåtkomp.
    const conditions = [objectHasPrimaryCustomerSql(customerId), isNull(objects.deletedAt)];
    if (tenantId) conditions.push(eq(objects.tenantId, tenantId));
    return db.select(objectColumnsWithPrimaryCustomer()).from(objects).where(and(...conditions));
  }

  async getCustomerObjectTreeRoots(customerId: string, tenantId: string): Promise<CustomerTreeNode[]> {
    const result = await db.execute(sql`
      SELECT
        o.id,
        o.name,
        o.parent_id AS "parentId",
        o.hierarchy_level AS "hierarchyLevel",
        o.address,
        (o.latitude IS NOT NULL AND o.longitude IS NOT NULL) AS "hasCoords",
        (
          SELECT COUNT(*)::int FROM objects c
          WHERE c.parent_id = o.id AND c.deleted_at IS NULL
        ) AS "childCount"
      FROM objects o
      WHERE (${primaryPayerCustomerIdSqlFor(sql.raw('o.id'))} = ${customerId})
        AND o.tenant_id = ${tenantId}
        AND o.deleted_at IS NULL
        AND (
          o.parent_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM objects p
            WHERE p.id = o.parent_id
              AND p.deleted_at IS NULL
              AND ${primaryPayerCustomerIdSqlFor(sql.raw('p.id'))} = ${customerId}
          )
        )
      ORDER BY o.name
    `);
    return (result.rows as unknown as CustomerTreeNode[]) || [];
  }

  async getCustomerObjectTreeChildren(customerId: string, tenantId: string, parentId: string): Promise<CustomerTreeNode[]> {
    const result = await db.execute(sql`
      SELECT
        o.id,
        o.name,
        o.parent_id AS "parentId",
        o.hierarchy_level AS "hierarchyLevel",
        o.address,
        (o.latitude IS NOT NULL AND o.longitude IS NOT NULL) AS "hasCoords",
        (
          SELECT COUNT(*)::int FROM objects c
          WHERE c.parent_id = o.id AND c.deleted_at IS NULL
        ) AS "childCount"
      FROM objects o
      WHERE o.parent_id = ${parentId}
        AND (${primaryPayerCustomerIdSqlFor(sql.raw('o.id'))} = ${customerId})
        AND o.tenant_id = ${tenantId}
        AND o.deleted_at IS NULL
      ORDER BY o.name
    `);
    return (result.rows as unknown as CustomerTreeNode[]) || [];
  }

  async getCustomerObjectMapPoints(
    customerId: string,
    tenantId: string,
    opts?: { bbox?: [number, number, number, number]; limit?: number },
  ): Promise<CustomerMapPoint[]> {
    const limit = Math.max(1, Math.min(5000, opts?.limit ?? 3000));
    const bboxFilter = opts?.bbox
      ? sql`AND o.longitude BETWEEN ${opts.bbox[0]} AND ${opts.bbox[2]} AND o.latitude BETWEEN ${opts.bbox[1]} AND ${opts.bbox[3]}`
      : sql``;
    const result = await db.execute(sql`
      SELECT
        o.id,
        o.name,
        o.address,
        o.latitude,
        o.longitude,
        o.hierarchy_level AS "hierarchyLevel"
      FROM objects o
      WHERE (${primaryPayerCustomerIdSqlFor(sql.raw('o.id'))} = ${customerId})
        AND o.tenant_id = ${tenantId}
        AND o.deleted_at IS NULL
        AND o.latitude IS NOT NULL
        AND o.longitude IS NOT NULL
        ${bboxFilter}
      ORDER BY o.id
      LIMIT ${limit}
    `);
    return (result.rows as unknown as CustomerMapPoint[]) || [];
  }

  async searchCustomerObjects(
    customerId: string,
    tenantId: string,
    query: string,
    limit: number = 50,
  ): Promise<CustomerObjectSearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const safeLimit = Math.max(1, Math.min(100, limit));
    const lower = trimmed.toLowerCase();
    const like = `%${lower}%`;
    const prefix = `${lower}%`;

    // Use LOWER(col) LIKE pattern so the existing 0030 LOWER(...) gin_trgm_ops
    // expression indexes (idx_objects_name_trgm / address_trgm / object_number_trgm)
    // accelerate the search. ILIKE on raw columns would require bare-column
    // GIN trgm indexes which drizzle-kit's introspection cannot represent.
    const matches = await db.execute(sql`
      SELECT
        o.id,
        o.name,
        o.object_number AS "objectNumber",
        o.address,
        o.hierarchy_level AS "hierarchyLevel",
        o.parent_id AS "parentId"
      FROM objects o
      WHERE (${primaryPayerCustomerIdSqlFor(sql.raw('o.id'))} = ${customerId})
        AND o.tenant_id = ${tenantId}
        AND o.deleted_at IS NULL
        AND (
          LOWER(o.name) LIKE ${like}
          OR LOWER(o.address) LIKE ${like}
          OR LOWER(o.object_number) LIKE ${like}
        )
      ORDER BY
        CASE WHEN LOWER(o.name) LIKE ${prefix} THEN 0 ELSE 1 END,
        o.name
      LIMIT ${safeLimit}
    `);

    interface MatchRow {
      id: string;
      name: string;
      objectNumber: string | null;
      address: string | null;
      hierarchyLevel: string | null;
      clusterId: string | null;
      parentId: string | null;
    }
    const matchRows = (matches.rows as unknown as MatchRow[]) || [];
    if (matchRows.length === 0) return [];

    const ids = matchRows.map((r) => r.id);
    const ancestors = await db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT
          o.id AS leaf_id,
          o.id,
          o.name,
          o.parent_id,
          o.hierarchy_level,
          0 AS depth
        FROM objects o
        WHERE o.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
          AND o.tenant_id = ${tenantId}
          AND o.deleted_at IS NULL
        UNION ALL
        SELECT
          c.leaf_id,
          p.id,
          p.name,
          p.parent_id,
          p.hierarchy_level,
          c.depth + 1
        FROM chain c
        JOIN objects p ON p.id = c.parent_id
        WHERE p.tenant_id = ${tenantId}
          AND p.deleted_at IS NULL
          AND (${primaryPayerCustomerIdSqlFor(sql.raw('p.id'))} = ${customerId})
      )
      SELECT leaf_id AS "leafId", id, name, hierarchy_level AS "hierarchyLevel", depth
      FROM chain
      ORDER BY leaf_id, depth DESC
    `);

    interface ChainRow {
      leafId: string;
      id: string;
      name: string;
      hierarchyLevel: string | null;
      depth: number;
    }
    const chainRows = (ancestors.rows as unknown as ChainRow[]) || [];
    const pathByLeaf = new Map<string, Array<{ id: string; name: string; hierarchyLevel: string | null }>>();
    for (const row of chainRows) {
      const arr = pathByLeaf.get(row.leafId) || [];
      arr.push({ id: row.id, name: row.name, hierarchyLevel: row.hierarchyLevel });
      pathByLeaf.set(row.leafId, arr);
    }

    return matchRows.map((m) => ({
      id: m.id,
      name: m.name,
      objectNumber: m.objectNumber,
      address: m.address,
      hierarchyLevel: m.hierarchyLevel,
      clusterId: m.clusterId,
      parentId: m.parentId,
      path: pathByLeaf.get(m.id) || [{ id: m.id, name: m.name, hierarchyLevel: m.hierarchyLevel }],
    }));
  }

  // Sökbar förälder-väljare (Task: "Lägg till förälder"-feedback). Till skillnad
  // från den vanliga /api/objects-sökningen (bara egna fält) matchar denna VARJE
  // sökord mot objektets egna fält ELLER något led i primär-förälderkedjan, så
  // att t.ex. "hemköp hisingen pantrum" hittar ett löv som heter "Pantrum" vars
  // släktnamn innehåller "Hemköp"/"Hisingen". Returnerar hela släktnamnskedjan
  // (rot → löv) för entydig verifiering bland tusentals liknande objekt.
  async searchObjectsForParent(
    tenantId: string,
    query: string,
    opts?: { excludeObjectId?: string; limit?: number },
  ): Promise<ObjectParentSearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const safeLimit = Math.max(1, Math.min(100, opts?.limit ?? 30));
    const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    if (tokens.length === 0) return [];

    const excludeCond = opts?.excludeObjectId
      ? sql`AND o.id <> ${opts.excludeObjectId}`
      : sql``;
    // Varje token måste finnas i den aggregerade sök-texten (egna fält + alla
    // förälder-namn i primärkedjan). AND mellan tokens ⇒ alla ord måste matcha.
    const tokenConds = tokens.map((t) => sql`a.search_text LIKE ${`%${t}%`}`);

    const matches = await db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT o.id AS leaf_id, o.id AS node_id, o.name, o.parent_id, 0 AS depth
        FROM objects o
        WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL
        UNION ALL
        SELECT c.leaf_id, p.id, p.name, p.parent_id, c.depth + 1
        FROM chain c
        JOIN objects p ON p.id = c.parent_id
        WHERE p.tenant_id = ${tenantId} AND p.deleted_at IS NULL AND c.depth < 20
      ),
      agg AS (
        SELECT leaf_id, LOWER(string_agg(COALESCE(name, ''), ' ')) AS ancestor_text
        FROM chain
        GROUP BY leaf_id
      )
      SELECT
        o.id,
        o.name,
        o.object_number AS "objectNumber",
        o.address,
        o.city,
        o.object_type AS "objectType",
        o.hierarchy_level AS "hierarchyLevel"
      FROM objects o
      JOIN agg ag ON ag.leaf_id = o.id
      CROSS JOIN LATERAL (
        SELECT (
          ag.ancestor_text || ' '
          || LOWER(COALESCE(o.object_number, '')) || ' '
          || LOWER(COALESCE(o.address, '')) || ' '
          || LOWER(COALESCE(o.city, ''))
        ) AS search_text
      ) a
      WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL
        ${excludeCond}
        AND ${sql.join(tokenConds, sql` AND `)}
      ORDER BY o.name
      LIMIT ${safeLimit}
    `);

    interface MatchRow {
      id: string;
      name: string;
      objectNumber: string | null;
      address: string | null;
      city: string | null;
      objectType: string | null;
      hierarchyLevel: string | null;
    }
    const matchRows = (matches.rows as unknown as MatchRow[]) || [];
    if (matchRows.length === 0) return [];

    const ids = matchRows.map((r) => r.id);
    const ancestors = await db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT o.id AS leaf_id, o.id AS node_id, o.name, o.parent_id, 0 AS depth
        FROM objects o
        WHERE o.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
          AND o.tenant_id = ${tenantId}
          AND o.deleted_at IS NULL
        UNION ALL
        SELECT c.leaf_id, p.id, p.name, p.parent_id, c.depth + 1
        FROM chain c
        JOIN objects p ON p.id = c.parent_id
        WHERE p.tenant_id = ${tenantId} AND p.deleted_at IS NULL AND c.depth < 20
      )
      SELECT leaf_id AS "leafId", node_id AS "id", name, depth
      FROM chain
      ORDER BY leaf_id, depth DESC
    `);

    interface ChainRow {
      leafId: string;
      id: string;
      name: string;
      depth: number;
    }
    const chainRows = (ancestors.rows as unknown as ChainRow[]) || [];
    const pathByLeaf = new Map<string, Array<{ id: string; name: string }>>();
    for (const row of chainRows) {
      const arr = pathByLeaf.get(row.leafId) || [];
      arr.push({ id: row.id, name: row.name });
      pathByLeaf.set(row.leafId, arr);
    }

    return matchRows.map((m) => ({
      id: m.id,
      name: m.name,
      objectNumber: m.objectNumber,
      address: m.address,
      city: m.city,
      objectType: m.objectType,
      hierarchyLevel: m.hierarchyLevel,
      path: pathByLeaf.get(m.id) || [{ id: m.id, name: m.name }],
    }));
  }

  async getCustomerObjectMapData(
    customerId: string,
    tenantId: string,
    opts: { bbox?: [number, number, number, number]; zoom: number; limit?: number },
  ): Promise<CustomerMapData> {
    const limit = Math.max(1, Math.min(5000, opts.limit ?? 2000));
    const zoom = Math.max(0, Math.min(22, opts.zoom));
    const INDIVIDUAL_ZOOM_THRESHOLD = 14;

    const bboxFilter = opts.bbox
      ? sql`AND o.longitude BETWEEN ${opts.bbox[0]} AND ${opts.bbox[2]} AND o.latitude BETWEEN ${opts.bbox[1]} AND ${opts.bbox[3]}`
      : sql``;

    const totalRow = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM objects o
      WHERE (${primaryPayerCustomerIdSqlFor(sql.raw('o.id'))} = ${customerId})
        AND o.tenant_id = ${tenantId}
        AND o.deleted_at IS NULL
        AND o.latitude IS NOT NULL
        AND o.longitude IS NOT NULL
        ${bboxFilter}
    `);
    const total = Number((totalRow.rows[0] as { total?: number } | undefined)?.total ?? 0);

    if (zoom >= INDIVIDUAL_ZOOM_THRESHOLD && total <= limit) {
      const result = await db.execute(sql`
        SELECT
          o.id,
          o.name,
          o.address,
          o.latitude,
          o.longitude,
          o.hierarchy_level AS "hierarchyLevel"
        FROM objects o
        WHERE (${primaryPayerCustomerIdSqlFor(sql.raw('o.id'))} = ${customerId})
          AND o.tenant_id = ${tenantId}
          AND o.deleted_at IS NULL
          AND o.latitude IS NOT NULL
          AND o.longitude IS NOT NULL
          ${bboxFilter}
          ORDER BY o.id
        LIMIT ${limit}
      `);
      const points = (result.rows as unknown as CustomerMapPoint[]) || [];
      return { mode: "points", points, total };
    }

    // Server-side grid clustering. Cell size in degrees scales with zoom so that
    // clusters roughly correspond to ~60 px on screen at the given zoom. To
    // guarantee that every object is represented (no dropped cells), coarsen
    // the grid by doubling the cell size until the bin count fits within
    // `limit`. We fetch limit+1 rows and detect overflow.
    let cellSize = Math.max(0.00005, (360 / Math.pow(2, zoom)) * (60 / 256));
    let rows: Array<{ gx: number; gy: number; count: number; latitude: number; longitude: number }> = [];
    const fetchLimit = limit + 1;
    for (let attempt = 0; attempt < 12; attempt++) {
      const r = await db.execute(sql`
        WITH binned AS (
          SELECT
            floor(o.longitude / ${cellSize})::int AS gx,
            floor(o.latitude / ${cellSize})::int AS gy,
            o.latitude,
            o.longitude
          FROM objects o
          WHERE (${primaryPayerCustomerIdSqlFor(sql.raw('o.id'))} = ${customerId})
            AND o.tenant_id = ${tenantId}
            AND o.deleted_at IS NULL
            AND o.latitude IS NOT NULL
            AND o.longitude IS NOT NULL
            ${bboxFilter}
            )
        SELECT
          gx,
          gy,
          COUNT(*)::int AS count,
          AVG(latitude)::float AS latitude,
          AVG(longitude)::float AS longitude
        FROM binned
        GROUP BY gx, gy
        LIMIT ${fetchLimit}
      `);
      rows = r.rows as unknown as typeof rows;
      if (rows.length <= limit) break;
      cellSize *= 2;
    }

    const aggregates: CustomerMapAggregate[] = rows.slice(0, limit).map((row) => ({
      cellKey: `${row.gx}:${row.gy}`,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      count: Number(row.count),
    }));

    return { mode: "aggregates", aggregates, total };
  }

  // Task #681: härled nästa lediga sekventiella systemnummer (`OBJ-NNN`) per
  // tenant. Räknar in soft-deletade rader så nummer aldrig återanvänds. Använt
  // både för read-only förhandsvisning i skapa-dialogen och vid faktisk
  // generering (under advisory-lås) i createObject.
  private async computeNextObjectNumber(
    tenantId: string,
    executor: { execute: typeof db.execute } = db,
  ): Promise<string> {
    const result = await executor.execute(sql`
      SELECT COALESCE(MAX(CAST(substring(object_number FROM '^OBJ-([0-9]+)$') AS INTEGER)), 0) AS max_num
      FROM objects
      WHERE tenant_id = ${tenantId} AND object_number ~ '^OBJ-[0-9]+$'
    `);
    const maxNum = Number(rowsOf<{ max_num: number | string }>(result)[0]?.max_num ?? 0);
    const next = maxNum + 1;
    return `OBJ-${String(next).padStart(3, "0")}`;
  }

  async previewNextObjectNumber(tenantId: string): Promise<string> {
    return this.computeNextObjectNumber(tenantId);
  }

  // Snabborder: härled nästa lediga löpande ordernummer (`SO-<n>`, start 1001) per
  // tenant. Speglar computeNextObjectNumber — räknar in soft-deletade rader så
  // nummer aldrig återanvänds. Används både för förhandsvisning och (under
  // advisory-lås) vid faktisk generering i createWorkOrderWithLines.
  private async computeNextWorkOrderNumber(
    tenantId: string,
    executor: { execute: typeof db.execute } = db,
  ): Promise<string> {
    const result = await executor.execute(sql`
      SELECT COALESCE(MAX(CAST(substring(order_number FROM '^SO-([0-9]+)$') AS INTEGER)), 1000) AS max_num
      FROM work_orders
      WHERE tenant_id = ${tenantId} AND order_number ~ '^SO-[0-9]+$'
    `);
    const maxNum = Number(rowsOf<{ max_num: number | string }>(result)[0]?.max_num ?? 1000);
    const next = maxNum + 1;
    return `SO-${next}`;
  }

  async previewNextWorkOrderNumber(tenantId: string): Promise<string> {
    return this.computeNextWorkOrderNumber(tenantId);
  }

  async createObject(insertObject: InsertObject, tx?: DbTransaction): Promise<ServiceObject> {
    // Explicit nummer (import, kopiering med eget nr) respekteras oförändrat.
    if (insertObject.objectNumber && String(insertObject.objectNumber).trim() !== "") {
      const runner = tx ?? db;
      const [object] = await runner.insert(objects).values(insertObject).returning();
      return { ...object, customerId: null };
    }
    // Auto-generera sekventiellt systemnummer concurrency-safe: ett advisory-lås
    // per tenant serialiserar MAX+1-beräkningen så två samtidiga skapanden inte
    // kan landa på samma nummer. Advisory-låset är transaktionsbundet; att ta det
    // flera gånger i samma transaktion (t.ex. vid gren-kopiering) blockerar aldrig.
    const run = async (txn: DbTransaction): Promise<ServiceObject> => {
      await txn.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('object_number'), hashtext(${insertObject.tenantId}))`,
      );
      const objectNumber = await this.computeNextObjectNumber(insertObject.tenantId, txn);
      const [object] = await txn.insert(objects).values({ ...insertObject, objectNumber }).returning();
      return { ...object, customerId: null };
    };
    // Om en yttre transaktion redan finns (t.ex. atomär gren-kopiering) återanvänds
    // den så hela trädet skapas eller rullas tillbaka som en enhet — annars öppnas
    // en egen transaktion för bakåtkompatibilitet med enskilda skapanden.
    if (tx) return run(tx);
    return await db.transaction(run);
  }

  async updateObject(id: string, data: Partial<InsertObject>): Promise<ServiceObject | undefined> {
    const [object] = await db.update(objects).set(data).where(eq(objects.id, id)).returning();
    if (!object) return undefined;
    return { ...object, customerId: await getObjectPrimaryCustomerId(object.id) };
  }

  async deleteObject(id: string): Promise<void> {
    await db.update(objects).set({ deletedAt: new Date() }).where(eq(objects.id, id));
  }

  async getResources(tenantId: string): Promise<Resource[]> {
    return db.select().from(resources).where(and(eq(resources.tenantId, tenantId), isNull(resources.deletedAt)));
  }

  async getResourcesPaginated(tenantId: string, limit: number, offset: number, search?: string): Promise<{ resources: Resource[]; total: number }> {
    const { count } = await import("drizzle-orm");
    let whereConditions = and(eq(resources.tenantId, tenantId), isNull(resources.deletedAt));
    if (search && search.trim()) {
      const searchTerm = `%${search.toLowerCase()}%`;
      whereConditions = and(
        whereConditions,
        or(
          sql`LOWER(${resources.name}) LIKE ${searchTerm}`,
          sql`LOWER(${resources.email}) LIKE ${searchTerm}`,
          sql`LOWER(${resources.phone}) LIKE ${searchTerm}`,
          sql`LOWER(${resources.initials}) LIKE ${searchTerm}`
        )
      );
    }
    const [countResult] = await db.select({ count: count() }).from(resources).where(whereConditions);
    const total = countResult?.count || 0;
    const resourcesList = await db.select().from(resources).where(whereConditions).orderBy(resources.name).limit(limit).offset(offset);
    return { resources: resourcesList, total };
  }

  async getResource(id: string): Promise<Resource | undefined> {
    const [resource] = await db.select().from(resources).where(and(eq(resources.id, id), isNull(resources.deletedAt)));
    return resource || undefined;
  }

  async createResource(insertResource: InsertResource): Promise<Resource> {
    const [resource] = await db.insert(resources).values(insertResource).returning();
    return resource;
  }

  async updateResource(id: string, data: Partial<InsertResource>): Promise<Resource | undefined> {
    const [resource] = await db.update(resources).set(data).where(eq(resources.id, id)).returning();
    return resource || undefined;
  }

  async deleteResource(id: string): Promise<void> {
    await db.update(resources).set({ deletedAt: new Date() }).where(eq(resources.id, id));
    // Städa Fortnox-mappningen så att den inte blir föräldralös (Task #468).
    try {
      await this.deleteFortnoxMappingsForEntity("resource", id);
    } catch (e) {
      console.warn("[fortnox-mapping] kunde inte rensa mappning för resurs", id, e);
    }
  }

  async getWorkOrders(tenantId: string, startDate?: Date, endDate?: Date, includeUnscheduled?: boolean, limit?: number): Promise<WorkOrderWithObject[]> {
    const conditions = [eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt)];
    
    if (startDate && endDate) {
      if (includeUnscheduled) {
        const plannableStatuses = ["skapad", "planerad_pre"];
        conditions.push(
          or(
            isNull(workOrders.scheduledDate),
            and(gte(workOrders.scheduledDate, startDate), lte(workOrders.scheduledDate, endDate)),
            inArray(workOrders.orderStatus, plannableStatuses)
          )!
        );
      } else {
        conditions.push(gte(workOrders.scheduledDate, startDate));
        conditions.push(lte(workOrders.scheduledDate, endDate));
      }
    }
    
    let query = db.select({
      id: workOrders.id,
      tenantId: workOrders.tenantId,
      customerId: workOrders.customerId,
      objectId: workOrders.objectId,
      clusterId: workOrders.clusterId,
      resourceId: workOrders.resourceId,
      teamId: workOrders.teamId,
      title: workOrders.title,
      description: workOrders.description,
      orderType: workOrders.orderType,
      priority: workOrders.priority,
      orderStatus: workOrders.orderStatus,
      scheduledDate: workOrders.scheduledDate,
      scheduledStartTime: workOrders.scheduledStartTime,
      plannedWindowStart: workOrders.plannedWindowStart,
      plannedWindowEnd: workOrders.plannedWindowEnd,
      estimatedDuration: workOrders.estimatedDuration,
      actualDuration: workOrders.actualDuration,
      setupTime: workOrders.setupTime,
      setupReason: workOrders.setupReason,
      lockedAt: workOrders.lockedAt,
      completedAt: workOrders.completedAt,
      invoicedAt: workOrders.invoicedAt,
      cachedValue: workOrders.cachedValue,
      cachedCost: workOrders.cachedCost,
      cachedProductionMinutes: workOrders.cachedProductionMinutes,
      isSimulated: workOrders.isSimulated,
      simulationScenarioId: workOrders.simulationScenarioId,
      plannedBy: workOrders.plannedBy,
      plannedNotes: workOrders.plannedNotes,
      notes: workOrders.notes,
      metadata: workOrders.metadata,
      createdAt: workOrders.createdAt,
      deletedAt: workOrders.deletedAt,
      impossibleReason: workOrders.impossibleReason,
      impossibleReasonText: workOrders.impossibleReasonText,
      impossibleAt: workOrders.impossibleAt,
      impossibleBy: workOrders.impossibleBy,
      impossiblePhotoUrl: workOrders.impossiblePhotoUrl,
      executionStatus: workOrders.executionStatus,
      creationMethod: workOrders.creationMethod,
      structuralArticleId: workOrders.structuralArticleId,
      roughPlannedWeek: workOrders.roughPlannedWeek,
      districtId: workOrders.districtId,

      taskLatitude: workOrders.taskLatitude,
      taskLongitude: workOrders.taskLongitude,
      externalReference: workOrders.externalReference,
      onWayAt: workOrders.onWayAt,
      onSiteAt: workOrders.onSiteAt,
      inspectedAt: workOrders.inspectedAt,
      executionCode: workOrders.executionCode,
      importBatchId: workOrders.importBatchId,
      outsidePreferredWindow: workOrders.outsidePreferredWindow,
      deliveryPreferencePriority: workOrders.deliveryPreferencePriority,
      taskCategory: workOrders.taskCategory,
      locationRequirement: workOrders.locationRequirement,
      status: workOrders.status,
      desiredDeliveryStart: workOrders.desiredDeliveryStart,
      desiredDeliveryEnd: workOrders.desiredDeliveryEnd,
      etaSmsSent: workOrders.etaSmsSent,
      objectName: objects.name,
      objectNameTranslations: objects.nameTranslations,
      objectAddress: objects.address,
      objectAccessCode: objectMetadataTextValueSql("Åtkomstkod"),
      objectKeyNumber: objectMetadataTextValueSql("Nyckelnummer"),
      objectLatitude: objects.latitude,
      objectLongitude: objects.longitude,
      customerName: customers.name,
      stopClusterId: workOrders.stopClusterId,
      routeClusterId: workOrders.routeClusterId,
      stopClusterName: stopClusters.displayName,
      routeClusterName: routeClusters.displayName,
    })
    .from(workOrders)
    .leftJoin(objects, eq(workOrders.objectId, objects.id))
    .leftJoin(customers, eq(workOrders.customerId, customers.id))
    .leftJoin(stopClusters, eq(workOrders.stopClusterId, stopClusters.id))
    .leftJoin(routeClusters, eq(workOrders.routeClusterId, routeClusters.id))
    .where(and(...conditions))
    .orderBy(desc(workOrders.scheduledDate));
    
    if (limit) {
      query = query.limit(limit) as typeof query;
    }
    
    return query;
  }

  async searchActiveWorkOrders(tenantId: string, query: string, limit = 20) {
    const searchTerm = `%${query.trim().toLowerCase()}%`;
    return db.select({
      id: workOrders.id,
      title: workOrders.title,
      objectName: objects.name,
      objectAddress: objects.address,
      customerName: customers.name,
      externalReference: workOrders.externalReference,
      executionCode: workOrders.executionCode,
      scheduledDate: workOrders.scheduledDate,
      resourceId: workOrders.resourceId,
      teamId: workOrders.teamId,
      orderStatus: workOrders.orderStatus,
    })
    .from(workOrders)
    .leftJoin(objects, eq(workOrders.objectId, objects.id))
    .leftJoin(customers, eq(workOrders.customerId, customers.id))
    .where(and(
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      notInArray(workOrders.orderStatus, ['utford', 'fakturerad', 'avbruten', 'omojlig']),
      or(
        sql`LOWER(COALESCE(${workOrders.title}, '')) LIKE ${searchTerm}`,
        sql`LOWER(COALESCE(${objects.name}, '')) LIKE ${searchTerm}`,
        sql`LOWER(COALESCE(${objects.address}, '')) LIKE ${searchTerm}`,
        sql`LOWER(COALESCE(${customers.name}, '')) LIKE ${searchTerm}`,
        sql`LOWER(COALESCE(${workOrders.externalReference}, '')) LIKE ${searchTerm}`,
        sql`LOWER(COALESCE(${workOrders.executionCode}, '')) LIKE ${searchTerm}`
      )
    ))
    .orderBy(desc(workOrders.scheduledDate))
    .limit(limit);
  }

  async getObjectSubtreeIds(tenantId: string, rootObjectId: string): Promise<string[]> {
    // Resolvar objektets subträd (self + alla ättlingar) via rekursiv CTE på
    // parent_id, tenant-scopat och exkl. soft-deletade noder.
    const subtreeRes = await db.execute(sql`
      WITH RECURSIVE subtree AS (
        SELECT id FROM objects
          WHERE id = ${rootObjectId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
        UNION ALL
        SELECT o.id FROM objects o
          INNER JOIN subtree s ON o.parent_id = s.id
          WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL
      )
      SELECT id FROM subtree
    `);
    return rowsOf<{ id: string }>(subtreeRes).map(r => r.id);
  }

  async getObjectSubtreeTimeline(tenantId: string, rootObjectId: string, startDate: Date, endDate: Date): Promise<WorkOrderWithObject[]> {
    const objectIds = await this.getObjectSubtreeIds(tenantId, rootObjectId);
    return this.getWorkOrdersForObjectIds(tenantId, objectIds, startDate, endDate);
  }

  async getWorkOrdersForObjectIds(tenantId: string, objectIds: string[], startDate: Date, endDate: Date): Promise<WorkOrderWithObject[]> {
    if (objectIds.length === 0) return [];

    return db.select({
      id: workOrders.id,
      tenantId: workOrders.tenantId,
      customerId: workOrders.customerId,
      objectId: workOrders.objectId,
      clusterId: workOrders.clusterId,
      resourceId: workOrders.resourceId,
      teamId: workOrders.teamId,
      title: workOrders.title,
      description: workOrders.description,
      orderType: workOrders.orderType,
      priority: workOrders.priority,
      orderStatus: workOrders.orderStatus,
      scheduledDate: workOrders.scheduledDate,
      scheduledStartTime: workOrders.scheduledStartTime,
      plannedWindowStart: workOrders.plannedWindowStart,
      plannedWindowEnd: workOrders.plannedWindowEnd,
      estimatedDuration: workOrders.estimatedDuration,
      actualDuration: workOrders.actualDuration,
      setupTime: workOrders.setupTime,
      setupReason: workOrders.setupReason,
      lockedAt: workOrders.lockedAt,
      completedAt: workOrders.completedAt,
      invoicedAt: workOrders.invoicedAt,
      cachedValue: workOrders.cachedValue,
      cachedCost: workOrders.cachedCost,
      cachedProductionMinutes: workOrders.cachedProductionMinutes,
      isSimulated: workOrders.isSimulated,
      simulationScenarioId: workOrders.simulationScenarioId,
      plannedBy: workOrders.plannedBy,
      plannedNotes: workOrders.plannedNotes,
      notes: workOrders.notes,
      metadata: workOrders.metadata,
      createdAt: workOrders.createdAt,
      deletedAt: workOrders.deletedAt,
      impossibleReason: workOrders.impossibleReason,
      impossibleReasonText: workOrders.impossibleReasonText,
      impossibleAt: workOrders.impossibleAt,
      impossibleBy: workOrders.impossibleBy,
      impossiblePhotoUrl: workOrders.impossiblePhotoUrl,
      executionStatus: workOrders.executionStatus,
      creationMethod: workOrders.creationMethod,
      structuralArticleId: workOrders.structuralArticleId,
      roughPlannedWeek: workOrders.roughPlannedWeek,
      districtId: workOrders.districtId,
      taskLatitude: workOrders.taskLatitude,
      taskLongitude: workOrders.taskLongitude,
      externalReference: workOrders.externalReference,
      onWayAt: workOrders.onWayAt,
      onSiteAt: workOrders.onSiteAt,
      inspectedAt: workOrders.inspectedAt,
      executionCode: workOrders.executionCode,
      importBatchId: workOrders.importBatchId,
      outsidePreferredWindow: workOrders.outsidePreferredWindow,
      deliveryPreferencePriority: workOrders.deliveryPreferencePriority,
      taskCategory: workOrders.taskCategory,
      locationRequirement: workOrders.locationRequirement,
      status: workOrders.status,
      desiredDeliveryStart: workOrders.desiredDeliveryStart,
      desiredDeliveryEnd: workOrders.desiredDeliveryEnd,
      etaSmsSent: workOrders.etaSmsSent,
      objectName: objects.name,
      objectNameTranslations: objects.nameTranslations,
      objectAddress: objects.address,
      objectAccessCode: objectMetadataTextValueSql("Åtkomstkod"),
      objectKeyNumber: objectMetadataTextValueSql("Nyckelnummer"),
      objectLatitude: objects.latitude,
      objectLongitude: objects.longitude,
      customerName: customers.name,
    })
    .from(workOrders)
    .leftJoin(objects, eq(workOrders.objectId, objects.id))
    .leftJoin(customers, eq(workOrders.customerId, customers.id))
    .where(and(
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      inArray(workOrders.objectId, objectIds),
      isNotNull(workOrders.scheduledDate),
      gte(workOrders.scheduledDate, startDate),
      lte(workOrders.scheduledDate, endDate),
    ))
    .orderBy(desc(workOrders.scheduledDate));
  }

  async getRoughPlanningSummary(tenantId: string, week: string, districtId?: string): Promise<RoughPlanningSummary> {
    const conditions = [
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      eq(workOrders.roughPlannedWeek, week),
    ];
    if (districtId) {
      conditions.push(eq(workOrders.districtId, districtId));
    }
    const where = and(...conditions);

    // Behov i timmar = estimated_duration (min) / 60. Värde i öre.
    const demandHoursSql = sql<number>`COALESCE(SUM(${workOrders.estimatedDuration}), 0)::float / 60`;
    const valueOreSql = sql<number>`COALESCE(SUM(${workOrders.cachedValue}), 0)::bigint`;
    const countSql = sql<number>`COUNT(*)::int`;

    const [byTeamRows, byDistrictRows, byStatusRows, capacityRow, centroidRow, districtRows] = await Promise.all([
      db
        .select({
          teamId: workOrders.teamId,
          count: countSql,
          demandHours: demandHoursSql,
          valueOre: valueOreSql,
        })
        .from(workOrders)
        .where(where)
        .groupBy(workOrders.teamId),
      db
        .select({
          districtId: workOrders.districtId,
          count: countSql,
          demandHours: demandHoursSql,
          valueOre: valueOreSql,
        })
        .from(workOrders)
        .where(where)
        .groupBy(workOrders.districtId),
      db
        .select({
          status: workOrders.orderStatus,
          count: countSql,
        })
        .from(workOrders)
        .where(where)
        .groupBy(workOrders.orderStatus),
      db
        .select({
          capacityHours: sql<number>`COALESCE(SUM(${teams.productionHoursTarget}), 0)::float`,
        })
        .from(teams)
        .where(and(eq(teams.tenantId, tenantId), eq(teams.status, "active"), isNull(teams.deletedAt))),
      // Geografisk tyngdpunkt: medel av ordrarnas koordinater. Endast rader med BÅDA
      // koordinaterna räknas så att lat/lng/pointCount kommer från samma radmängd.
      db
        .select({
          lat: sql<number | null>`AVG(${workOrders.taskLatitude})`,
          lng: sql<number | null>`AVG(${workOrders.taskLongitude})`,
          pointCount: sql<number>`COUNT(*)::int`,
        })
        .from(workOrders)
        .where(and(where, isNotNull(workOrders.taskLatitude), isNotNull(workOrders.taskLongitude))),
      // Distriktscentrum för "närmaste ort"-approximation.
      db
        .select({
          id: geographicDistricts.id,
          name: geographicDistricts.name,
          lat: geographicDistricts.centerLat,
          lng: geographicDistricts.centerLng,
        })
        .from(geographicDistricts)
        .where(and(eq(geographicDistricts.tenantId, tenantId), isNull(geographicDistricts.deletedAt))),
    ]);

    const toNum = (v: unknown) => (v == null ? 0 : Number(v));

    const districtCoords: DistrictCoord[] = districtRows
      .filter((d) => d.lat != null && d.lng != null)
      .map((d) => ({ id: d.id, name: d.name, lat: Number(d.lat), lng: Number(d.lng) }));

    const centroidLat = centroidRow[0]?.lat == null ? null : Number(centroidRow[0].lat);
    const centroidLng = centroidRow[0]?.lng == null ? null : Number(centroidRow[0].lng);
    const centroidPoints = toNum(centroidRow[0]?.pointCount);
    const nearest = nearestDistrictLabel(centroidLat, centroidLng, districtCoords);
    const tyngdpunkt =
      centroidLat != null && centroidLng != null && centroidPoints > 0
        ? {
            lat: centroidLat,
            lng: centroidLng,
            pointCount: centroidPoints,
            nearestDistrictId: nearest?.id ?? null,
            nearestDistrictName: nearest?.name ?? null,
          }
        : null;

    const byTeam = byTeamRows.map((r) => ({
      teamId: r.teamId ?? null,
      count: toNum(r.count),
      demandHours: toNum(r.demandHours),
      valueOre: toNum(r.valueOre),
    }));
    const byDistrict = byDistrictRows.map((r) => ({
      districtId: r.districtId ?? null,
      count: toNum(r.count),
      demandHours: toNum(r.demandHours),
      valueOre: toNum(r.valueOre),
    }));
    const statusCounts = byStatusRows.map((r) => ({
      status: r.status ?? "unknown",
      count: toNum(r.count),
    }));

    const totals = byTeam.reduce(
      (acc, r) => {
        acc.count += r.count;
        acc.demandHours += r.demandHours;
        acc.valueOre += r.valueOre;
        return acc;
      },
      { count: 0, demandHours: 0, valueOre: 0 },
    );

    return {
      week,
      districtId: districtId ?? null,
      totals: {
        count: totals.count,
        valueOre: totals.valueOre,
        demandHours: totals.demandHours,
        capacityHours: toNum(capacityRow[0]?.capacityHours),
      },
      byTeam,
      byDistrict,
      statusCounts,
      tyngdpunkt,
    };
  }

  async getRoughPlanningTyngdpunktOverview(
    tenantId: string,
    weeks: string[],
    districtId?: string,
  ): Promise<RoughPlanningTyngdpunktWeek[]> {
    const uniqueWeeks = Array.from(new Set(weeks));
    if (uniqueWeeks.length === 0) return [];

    const conditions = [
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      inArray(workOrders.roughPlannedWeek, uniqueWeeks),
    ];
    if (districtId) conditions.push(eq(workOrders.districtId, districtId));

    const [aggRows, districtRows] = await Promise.all([
      db
        .select({
          week: workOrders.roughPlannedWeek,
          orderCount: sql<number>`COUNT(*)::int`,
          valueOre: sql<number>`COALESCE(SUM(${workOrders.cachedValue}), 0)::bigint`,
          demandHours: sql<number>`COALESCE(SUM(${workOrders.estimatedDuration}), 0)::float / 60`,
          // Tyngdpunkt räknas endast på rader med BÅDA koordinaterna (orderCount avser alla rader).
          lat: sql<number | null>`AVG(${workOrders.taskLatitude}) FILTER (WHERE ${workOrders.taskLatitude} IS NOT NULL AND ${workOrders.taskLongitude} IS NOT NULL)`,
          lng: sql<number | null>`AVG(${workOrders.taskLongitude}) FILTER (WHERE ${workOrders.taskLatitude} IS NOT NULL AND ${workOrders.taskLongitude} IS NOT NULL)`,
          pointCount: sql<number>`COUNT(*) FILTER (WHERE ${workOrders.taskLatitude} IS NOT NULL AND ${workOrders.taskLongitude} IS NOT NULL)::int`,
        })
        .from(workOrders)
        .where(and(...conditions))
        .groupBy(workOrders.roughPlannedWeek),
      db
        .select({
          id: geographicDistricts.id,
          name: geographicDistricts.name,
          lat: geographicDistricts.centerLat,
          lng: geographicDistricts.centerLng,
        })
        .from(geographicDistricts)
        .where(and(eq(geographicDistricts.tenantId, tenantId), isNull(geographicDistricts.deletedAt))),
    ]);

    const toNum = (v: unknown) => (v == null ? 0 : Number(v));
    const districtCoords: DistrictCoord[] = districtRows
      .filter((d) => d.lat != null && d.lng != null)
      .map((d) => ({ id: d.id, name: d.name, lat: Number(d.lat), lng: Number(d.lng) }));

    const byWeek = new Map(aggRows.map((r) => [r.week ?? "", r]));

    return uniqueWeeks.map((week) => {
      const r = byWeek.get(week);
      if (!r) {
        return {
          week,
          lat: null,
          lng: null,
          pointCount: 0,
          orderCount: 0,
          valueOre: 0,
          demandHours: 0,
          nearestDistrictId: null,
          nearestDistrictName: null,
        };
      }
      const lat = r.lat == null ? null : Number(r.lat);
      const lng = r.lng == null ? null : Number(r.lng);
      const nearest = nearestDistrictLabel(lat, lng, districtCoords);
      return {
        week,
        lat,
        lng,
        pointCount: toNum(r.pointCount),
        orderCount: toNum(r.orderCount),
        valueOre: toNum(r.valueOre),
        demandHours: toNum(r.demandHours),
        nearestDistrictId: nearest?.id ?? null,
        nearestDistrictName: nearest?.name ?? null,
      };
    });
  }

  async getRoughPlanningMapPoints(
    tenantId: string,
    week: string,
    districtId?: string,
  ): Promise<RoughPlanningMapPoint[]> {
    const conditions = [
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      eq(workOrders.roughPlannedWeek, week),
      isNotNull(workOrders.taskLatitude),
      isNotNull(workOrders.taskLongitude),
    ];
    if (districtId) conditions.push(eq(workOrders.districtId, districtId));

    const rows = await db
      .select({
        id: workOrders.id,
        lat: workOrders.taskLatitude,
        lng: workOrders.taskLongitude,
        districtId: workOrders.districtId,
        valueOre: workOrders.cachedValue,
        title: workOrders.title,
        objectName: objects.name,
      })
      .from(workOrders)
      .leftJoin(
        objects,
        and(eq(workOrders.objectId, objects.id), eq(objects.tenantId, tenantId), isNull(objects.deletedAt)),
      )
      .where(and(...conditions));

    return rows.map((r) => ({
      id: r.id,
      lat: Number(r.lat),
      lng: Number(r.lng),
      districtId: r.districtId ?? null,
      valueOre: r.valueOre == null ? 0 : Number(r.valueOre),
      title: r.title ?? null,
      objectName: r.objectName ?? null,
    }));
  }

  async getUnplannedRoughWorkOrders(tenantId: string, limit: number, offset: number, search?: string): Promise<{ workOrders: WorkOrderWithObject[]; total: number }> {
    const terminalStatuses = ["utford", "fakturerad", "omojlig", "avbruten"];
    const conditions: SQL[] = [
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      isNull(workOrders.roughPlannedWeek),
      notInArray(workOrders.orderStatus, terminalStatuses),
    ];
    const searchCondition = search ? buildRoughUnplannedSearchCondition(tenantId, search) : undefined;
    if (searchCondition) conditions.push(searchCondition);
    const whereClause = and(...conditions);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(whereClause);

    const data = await db.select(ROUGH_UNPLANNED_SELECT)
    .from(workOrders)
    .leftJoin(objects, eq(workOrders.objectId, objects.id))
    .leftJoin(customers, eq(workOrders.customerId, customers.id))
    .where(whereClause)
    .orderBy(desc(workOrders.createdAt))
    .limit(limit)
    .offset(offset);

    return { workOrders: data as WorkOrderWithObject[], total: countResult?.count || 0 };
  }

  async getUnplannedRoughNearby(tenantId: string, lat: number, lng: number, radiusKm: number, limit: number): Promise<Array<WorkOrderWithObject & { distanceKm: number }>> {
    const terminalStatuses = ["utford", "fakturerad", "omojlig", "avbruten"];
    // Bounding-box-prefilter: ~111 km/grad lat; lng skalas med cos(lat). Skär ner
    // kandidatmängden i SQL innan exakt haversine i JS (Task #899, D11).
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
    const effLat = sql`COALESCE(${workOrders.taskLatitude}, ${objects.latitude})`;
    const effLng = sql`COALESCE(${workOrders.taskLongitude}, ${objects.longitude})`;
    const whereClause = and(
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      isNull(workOrders.roughPlannedWeek),
      notInArray(workOrders.orderStatus, terminalStatuses),
      sql`${effLat} BETWEEN ${lat - latDelta} AND ${lat + latDelta}`,
      sql`${effLng} BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}`,
    );

    const candidates = await db.select(ROUGH_UNPLANNED_SELECT)
      .from(workOrders)
      .leftJoin(objects, eq(workOrders.objectId, objects.id))
      .leftJoin(customers, eq(workOrders.customerId, customers.id))
      .where(whereClause)
      .orderBy(desc(workOrders.createdAt))
      .limit(2000);

    const results = candidates.flatMap((wo) => {
      const la = wo.taskLatitude ?? wo.objectLatitude;
      const lo = wo.taskLongitude ?? wo.objectLongitude;
      if (la == null || lo == null) return [];
      const distanceKm = haversineDistanceKm(lat, lng, Number(la), Number(lo));
      if (distanceKm > radiusKm) return [];
      return [{ ...wo, distanceKm }];
    });
    results.sort((a, b) => a.distanceKm - b.distanceKm);
    return results.slice(0, limit) as Array<WorkOrderWithObject & { distanceKm: number }>;
  }

  async getUnscheduledWorkOrders(tenantId: string, limit: number = 500): Promise<WorkOrderWithObject[]> {
    return db.select({
      id: workOrders.id,
      tenantId: workOrders.tenantId,
      customerId: workOrders.customerId,
      objectId: workOrders.objectId,
      clusterId: workOrders.clusterId,
      resourceId: workOrders.resourceId,
      teamId: workOrders.teamId,
      title: workOrders.title,
      description: workOrders.description,
      orderType: workOrders.orderType,
      priority: workOrders.priority,
      orderStatus: workOrders.orderStatus,
      scheduledDate: workOrders.scheduledDate,
      scheduledStartTime: workOrders.scheduledStartTime,
      plannedWindowStart: workOrders.plannedWindowStart,
      plannedWindowEnd: workOrders.plannedWindowEnd,
      estimatedDuration: workOrders.estimatedDuration,
      actualDuration: workOrders.actualDuration,
      setupTime: workOrders.setupTime,
      setupReason: workOrders.setupReason,
      lockedAt: workOrders.lockedAt,
      completedAt: workOrders.completedAt,
      invoicedAt: workOrders.invoicedAt,
      cachedValue: workOrders.cachedValue,
      cachedCost: workOrders.cachedCost,
      cachedProductionMinutes: workOrders.cachedProductionMinutes,
      isSimulated: workOrders.isSimulated,
      simulationScenarioId: workOrders.simulationScenarioId,
      plannedBy: workOrders.plannedBy,
      plannedNotes: workOrders.plannedNotes,
      notes: workOrders.notes,
      metadata: workOrders.metadata,
      createdAt: workOrders.createdAt,
      deletedAt: workOrders.deletedAt,
      impossibleReason: workOrders.impossibleReason,
      impossibleReasonText: workOrders.impossibleReasonText,
      impossibleAt: workOrders.impossibleAt,
      impossibleBy: workOrders.impossibleBy,
      impossiblePhotoUrl: workOrders.impossiblePhotoUrl,
      executionStatus: workOrders.executionStatus,
      creationMethod: workOrders.creationMethod,
      structuralArticleId: workOrders.structuralArticleId,
      roughPlannedWeek: workOrders.roughPlannedWeek,
      districtId: workOrders.districtId,

      taskLatitude: workOrders.taskLatitude,
      taskLongitude: workOrders.taskLongitude,
      externalReference: workOrders.externalReference,
      onWayAt: workOrders.onWayAt,
      onSiteAt: workOrders.onSiteAt,
      inspectedAt: workOrders.inspectedAt,
      executionCode: workOrders.executionCode,
      importBatchId: workOrders.importBatchId,
      outsidePreferredWindow: workOrders.outsidePreferredWindow,
      deliveryPreferencePriority: workOrders.deliveryPreferencePriority,
      taskCategory: workOrders.taskCategory,
      locationRequirement: workOrders.locationRequirement,
      status: workOrders.status,
      desiredDeliveryStart: workOrders.desiredDeliveryStart,
      desiredDeliveryEnd: workOrders.desiredDeliveryEnd,
      etaSmsSent: workOrders.etaSmsSent,
      objectName: objects.name,
      objectNameTranslations: objects.nameTranslations,
      objectAddress: objects.address,
      objectAccessCode: objectMetadataTextValueSql("Åtkomstkod"),
      objectKeyNumber: objectMetadataTextValueSql("Nyckelnummer"),
      objectLatitude: objects.latitude,
      objectLongitude: objects.longitude,
      customerName: customers.name,
    })
    .from(workOrders)
    .leftJoin(objects, eq(workOrders.objectId, objects.id))
    .leftJoin(customers, eq(workOrders.customerId, customers.id))
    .where(and(
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      notInArray(workOrders.orderStatus, ['utford', 'fakturerad', 'avbruten', 'omojlig']),
      or(isNull(workOrders.scheduledDate), isNull(workOrders.resourceId))
    ))
    .orderBy(workOrders.priority, workOrders.plannedWindowEnd)
    .limit(limit);
  }

  async getUnscheduledWorkOrdersPaginated(tenantId: string, limit: number, offset: number, search?: string, dateFilter?: { field: 'desired' | 'created' | 'sla'; from?: string; to?: string }): Promise<{ workOrders: WorkOrderWithObject[]; total: number; missingDateFieldCount?: number }> {
    const baseConditions: Condition[] = [
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      notInArray(workOrders.orderStatus, ['utford', 'fakturerad', 'avbruten', 'omojlig']),
      or(isNull(workOrders.scheduledDate), isNull(workOrders.resourceId))
    ];

    if (search && search.trim()) {
      const searchTerm = `%${search.trim().toLowerCase()}%`;
      baseConditions.push(
        or(
          sql`LOWER(${workOrders.title}) LIKE ${searchTerm}`,
          sql`${workOrders.objectId} IN (SELECT id FROM ${objects} WHERE ${objects.tenantId} = ${tenantId} AND LOWER(name) LIKE ${searchTerm})`,
          sql`${workOrders.customerId} IN (SELECT id FROM ${customers} WHERE ${customers.tenantId} = ${tenantId} AND LOWER(name) LIKE ${searchTerm})`
        )
      );
    }

    let dateCondition: Condition = undefined;
    let missingFieldCondition: Condition = undefined;
    if (dateFilter && (dateFilter.from || dateFilter.to)) {
      const fromDate = dateFilter.from ? new Date(`${dateFilter.from}T00:00:00.000Z`) : null;
      const toDate = dateFilter.to ? new Date(`${dateFilter.to}T23:59:59.999Z`) : null;
      if (fromDate && !isNaN(fromDate.getTime()) || toDate && !isNaN(toDate.getTime())) {
        if (dateFilter.field === 'desired') {
          const parts: Condition[] = [isNotNull(workOrders.desiredDeliveryStart)];
          if (toDate) parts.push(lte(workOrders.desiredDeliveryStart, toDate));
          if (fromDate) parts.push(sql`COALESCE(${workOrders.desiredDeliveryEnd}, ${workOrders.desiredDeliveryStart}) >= ${fromDate}`);
          dateCondition = and(...parts);
          missingFieldCondition = isNull(workOrders.desiredDeliveryStart);
        } else if (dateFilter.field === 'sla') {
          const parts: Condition[] = [isNotNull(workOrders.plannedWindowEnd)];
          if (fromDate) parts.push(gte(workOrders.plannedWindowEnd, fromDate));
          if (toDate) parts.push(lte(workOrders.plannedWindowEnd, toDate));
          dateCondition = and(...parts);
          missingFieldCondition = isNull(workOrders.plannedWindowEnd);
        } else if (dateFilter.field === 'created') {
          const parts: Condition[] = [];
          if (fromDate) parts.push(gte(workOrders.createdAt, fromDate));
          if (toDate) parts.push(lte(workOrders.createdAt, toDate));
          if (parts.length > 0) dateCondition = and(...parts);
        }
      }
    }

    const conditions = dateCondition ? [...baseConditions, dateCondition] : baseConditions;
    const whereClause = and(...conditions);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(whereClause);

    let missingDateFieldCount: number | undefined;
    if (missingFieldCondition && dateCondition) {
      const [missingResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workOrders)
        .where(and(...baseConditions, missingFieldCondition));
      missingDateFieldCount = missingResult?.count || 0;
    }

    const rows = await db.select({
      id: workOrders.id,
      tenantId: workOrders.tenantId,
      customerId: workOrders.customerId,
      objectId: workOrders.objectId,
      clusterId: workOrders.clusterId,
      resourceId: workOrders.resourceId,
      teamId: workOrders.teamId,
      title: workOrders.title,
      description: workOrders.description,
      orderType: workOrders.orderType,
      priority: workOrders.priority,
      orderStatus: workOrders.orderStatus,
      scheduledDate: workOrders.scheduledDate,
      scheduledStartTime: workOrders.scheduledStartTime,
      plannedWindowStart: workOrders.plannedWindowStart,
      plannedWindowEnd: workOrders.plannedWindowEnd,
      estimatedDuration: workOrders.estimatedDuration,
      actualDuration: workOrders.actualDuration,
      setupTime: workOrders.setupTime,
      setupReason: workOrders.setupReason,
      lockedAt: workOrders.lockedAt,
      completedAt: workOrders.completedAt,
      invoicedAt: workOrders.invoicedAt,
      cachedValue: workOrders.cachedValue,
      cachedCost: workOrders.cachedCost,
      cachedProductionMinutes: workOrders.cachedProductionMinutes,
      isSimulated: workOrders.isSimulated,
      simulationScenarioId: workOrders.simulationScenarioId,
      plannedBy: workOrders.plannedBy,
      plannedNotes: workOrders.plannedNotes,
      notes: workOrders.notes,
      metadata: workOrders.metadata,
      createdAt: workOrders.createdAt,
      deletedAt: workOrders.deletedAt,
      impossibleReason: workOrders.impossibleReason,
      impossibleReasonText: workOrders.impossibleReasonText,
      impossibleAt: workOrders.impossibleAt,
      impossibleBy: workOrders.impossibleBy,
      impossiblePhotoUrl: workOrders.impossiblePhotoUrl,
      executionStatus: workOrders.executionStatus,
      creationMethod: workOrders.creationMethod,
      structuralArticleId: workOrders.structuralArticleId,
      roughPlannedWeek: workOrders.roughPlannedWeek,
      districtId: workOrders.districtId,

      taskLatitude: workOrders.taskLatitude,
      taskLongitude: workOrders.taskLongitude,
      externalReference: workOrders.externalReference,
      onWayAt: workOrders.onWayAt,
      onSiteAt: workOrders.onSiteAt,
      inspectedAt: workOrders.inspectedAt,
      executionCode: workOrders.executionCode,
      importBatchId: workOrders.importBatchId,
      outsidePreferredWindow: workOrders.outsidePreferredWindow,
      deliveryPreferencePriority: workOrders.deliveryPreferencePriority,
      taskCategory: workOrders.taskCategory,
      locationRequirement: workOrders.locationRequirement,
      status: workOrders.status,
      desiredDeliveryStart: workOrders.desiredDeliveryStart,
      desiredDeliveryEnd: workOrders.desiredDeliveryEnd,
      etaSmsSent: workOrders.etaSmsSent,
      objectName: objects.name,
      objectNameTranslations: objects.nameTranslations,
      objectAddress: objects.address,
      objectAccessCode: objectMetadataTextValueSql("Åtkomstkod"),
      objectKeyNumber: objectMetadataTextValueSql("Nyckelnummer"),
      objectLatitude: objects.latitude,
      objectLongitude: objects.longitude,
      customerName: customers.name,
      stopClusterId: workOrders.stopClusterId,
      routeClusterId: workOrders.routeClusterId,
      stopClusterName: stopClusters.displayName,
      routeClusterName: routeClusters.displayName,
    })
    .from(workOrders)
    .leftJoin(objects, eq(workOrders.objectId, objects.id))
    .leftJoin(customers, eq(workOrders.customerId, customers.id))
    .leftJoin(stopClusters, eq(workOrders.stopClusterId, stopClusters.id))
    .leftJoin(routeClusters, eq(workOrders.routeClusterId, routeClusters.id))
    .where(whereClause)
    .orderBy(workOrders.priority, workOrders.plannedWindowEnd)
    .limit(limit)
    .offset(offset);

    return { workOrders: rows, total: countResult?.count || 0, missingDateFieldCount };
  }

  async getUnscheduledMissingDateField(tenantId: string, field: 'desired' | 'sla', search?: string, limit: number = 100): Promise<WorkOrderWithObject[]> {
    const conditions: Condition[] = [
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      notInArray(workOrders.orderStatus, ['utford', 'fakturerad', 'avbruten', 'omojlig']),
      or(isNull(workOrders.scheduledDate), isNull(workOrders.resourceId)),
      field === 'desired' ? isNull(workOrders.desiredDeliveryStart) : isNull(workOrders.plannedWindowEnd),
    ];

    if (search && search.trim()) {
      const searchTerm = `%${search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          sql`LOWER(${workOrders.title}) LIKE ${searchTerm}`,
          sql`${workOrders.objectId} IN (SELECT id FROM ${objects} WHERE ${objects.tenantId} = ${tenantId} AND LOWER(name) LIKE ${searchTerm})`,
          sql`${workOrders.customerId} IN (SELECT id FROM ${customers} WHERE ${customers.tenantId} = ${tenantId} AND LOWER(name) LIKE ${searchTerm})`
        )
      );
    }

    const rows = await db.select({
      id: workOrders.id,
      tenantId: workOrders.tenantId,
      customerId: workOrders.customerId,
      objectId: workOrders.objectId,
      clusterId: workOrders.clusterId,
      resourceId: workOrders.resourceId,
      teamId: workOrders.teamId,
      title: workOrders.title,
      description: workOrders.description,
      orderType: workOrders.orderType,
      priority: workOrders.priority,
      orderStatus: workOrders.orderStatus,
      scheduledDate: workOrders.scheduledDate,
      scheduledStartTime: workOrders.scheduledStartTime,
      plannedWindowStart: workOrders.plannedWindowStart,
      plannedWindowEnd: workOrders.plannedWindowEnd,
      estimatedDuration: workOrders.estimatedDuration,
      actualDuration: workOrders.actualDuration,
      setupTime: workOrders.setupTime,
      setupReason: workOrders.setupReason,
      lockedAt: workOrders.lockedAt,
      completedAt: workOrders.completedAt,
      invoicedAt: workOrders.invoicedAt,
      cachedValue: workOrders.cachedValue,
      cachedCost: workOrders.cachedCost,
      cachedProductionMinutes: workOrders.cachedProductionMinutes,
      isSimulated: workOrders.isSimulated,
      simulationScenarioId: workOrders.simulationScenarioId,
      plannedBy: workOrders.plannedBy,
      plannedNotes: workOrders.plannedNotes,
      notes: workOrders.notes,
      metadata: workOrders.metadata,
      createdAt: workOrders.createdAt,
      deletedAt: workOrders.deletedAt,
      impossibleReason: workOrders.impossibleReason,
      impossibleReasonText: workOrders.impossibleReasonText,
      impossibleAt: workOrders.impossibleAt,
      impossibleBy: workOrders.impossibleBy,
      impossiblePhotoUrl: workOrders.impossiblePhotoUrl,
      executionStatus: workOrders.executionStatus,
      creationMethod: workOrders.creationMethod,
      structuralArticleId: workOrders.structuralArticleId,
      roughPlannedWeek: workOrders.roughPlannedWeek,
      districtId: workOrders.districtId,

      taskLatitude: workOrders.taskLatitude,
      taskLongitude: workOrders.taskLongitude,
      externalReference: workOrders.externalReference,
      onWayAt: workOrders.onWayAt,
      onSiteAt: workOrders.onSiteAt,
      inspectedAt: workOrders.inspectedAt,
      executionCode: workOrders.executionCode,
      importBatchId: workOrders.importBatchId,
      outsidePreferredWindow: workOrders.outsidePreferredWindow,
      deliveryPreferencePriority: workOrders.deliveryPreferencePriority,
      taskCategory: workOrders.taskCategory,
      locationRequirement: workOrders.locationRequirement,
      status: workOrders.status,
      desiredDeliveryStart: workOrders.desiredDeliveryStart,
      desiredDeliveryEnd: workOrders.desiredDeliveryEnd,
      etaSmsSent: workOrders.etaSmsSent,
      objectName: objects.name,
      objectNameTranslations: objects.nameTranslations,
      objectAddress: objects.address,
      objectAccessCode: objectMetadataTextValueSql("Åtkomstkod"),
      objectKeyNumber: objectMetadataTextValueSql("Nyckelnummer"),
      objectLatitude: objects.latitude,
      objectLongitude: objects.longitude,
      customerName: customers.name,
    })
    .from(workOrders)
    .leftJoin(objects, eq(workOrders.objectId, objects.id))
    .leftJoin(customers, eq(workOrders.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(workOrders.priority, workOrders.createdAt)
    .limit(limit);

    return rows;
  }

  async bulkUnscheduleWorkOrders(tenantId: string, startDate: Date, endDate: Date, resourceIds?: string[]): Promise<number> {
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);
    const conditions = [
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      isNotNull(workOrders.scheduledDate),
      gte(workOrders.scheduledDate, startDate),
      lte(workOrders.scheduledDate, endOfDay),
    ];
    if (resourceIds && resourceIds.length > 0) {
      conditions.push(inArray(workOrders.resourceId, resourceIds));
    }
    const result = await db.update(workOrders)
      .set({
        scheduledDate: null,
        scheduledStartTime: null,
        resourceId: null,
        orderStatus: "skapad",
      })
      .where(and(...conditions))
      .returning({ id: workOrders.id });
    if (result.length > 0) invalidateWorkflowCaches(tenantId);
    return result.length;
  }

  async getWorkOrdersPaginated(tenantId: string, limit: number, offset: number, startDate?: Date, endDate?: Date, includeUnscheduled?: boolean, status?: string): Promise<{ workOrders: WorkOrderWithObject[]; total: number }> {
    const conditions: Condition[] = [eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt)];

    if (startDate && endDate) {
      if (includeUnscheduled) {
        const plannableStatuses = ["skapad", "planerad_pre"];
        conditions.push(
          or(
            isNull(workOrders.scheduledDate),
            and(gte(workOrders.scheduledDate, startDate), lte(workOrders.scheduledDate, endDate)),
            inArray(workOrders.orderStatus, plannableStatuses)
          )!
        );
      } else {
        conditions.push(gte(workOrders.scheduledDate, startDate));
        conditions.push(lte(workOrders.scheduledDate, endDate));
      }
    }

    if (status && status !== 'all') {
      conditions.push(eq(workOrders.orderStatus, status));
    }

    const whereClause = and(...conditions);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(whereClause);

    const data = await db.select({
      id: workOrders.id,
      tenantId: workOrders.tenantId,
      customerId: workOrders.customerId,
      objectId: workOrders.objectId,
      clusterId: workOrders.clusterId,
      resourceId: workOrders.resourceId,
      teamId: workOrders.teamId,
      title: workOrders.title,
      description: workOrders.description,
      orderType: workOrders.orderType,
      priority: workOrders.priority,
      orderStatus: workOrders.orderStatus,
      scheduledDate: workOrders.scheduledDate,
      scheduledStartTime: workOrders.scheduledStartTime,
      plannedWindowStart: workOrders.plannedWindowStart,
      plannedWindowEnd: workOrders.plannedWindowEnd,
      estimatedDuration: workOrders.estimatedDuration,
      actualDuration: workOrders.actualDuration,
      setupTime: workOrders.setupTime,
      setupReason: workOrders.setupReason,
      lockedAt: workOrders.lockedAt,
      completedAt: workOrders.completedAt,
      invoicedAt: workOrders.invoicedAt,
      cachedValue: workOrders.cachedValue,
      cachedCost: workOrders.cachedCost,
      cachedProductionMinutes: workOrders.cachedProductionMinutes,
      isSimulated: workOrders.isSimulated,
      simulationScenarioId: workOrders.simulationScenarioId,
      plannedBy: workOrders.plannedBy,
      plannedNotes: workOrders.plannedNotes,
      notes: workOrders.notes,
      metadata: workOrders.metadata,
      createdAt: workOrders.createdAt,
      deletedAt: workOrders.deletedAt,
      impossibleReason: workOrders.impossibleReason,
      impossibleReasonText: workOrders.impossibleReasonText,
      impossibleAt: workOrders.impossibleAt,
      impossibleBy: workOrders.impossibleBy,
      impossiblePhotoUrl: workOrders.impossiblePhotoUrl,
      executionStatus: workOrders.executionStatus,
      creationMethod: workOrders.creationMethod,
      structuralArticleId: workOrders.structuralArticleId,
      roughPlannedWeek: workOrders.roughPlannedWeek,
      districtId: workOrders.districtId,

      taskLatitude: workOrders.taskLatitude,
      taskLongitude: workOrders.taskLongitude,
      externalReference: workOrders.externalReference,
      onWayAt: workOrders.onWayAt,
      onSiteAt: workOrders.onSiteAt,
      inspectedAt: workOrders.inspectedAt,
      executionCode: workOrders.executionCode,
      importBatchId: workOrders.importBatchId,
      outsidePreferredWindow: workOrders.outsidePreferredWindow,
      deliveryPreferencePriority: workOrders.deliveryPreferencePriority,
      taskCategory: workOrders.taskCategory,
      locationRequirement: workOrders.locationRequirement,
      status: workOrders.status,
      desiredDeliveryStart: workOrders.desiredDeliveryStart,
      desiredDeliveryEnd: workOrders.desiredDeliveryEnd,
      etaSmsSent: workOrders.etaSmsSent,
      objectName: objects.name,
      objectNameTranslations: objects.nameTranslations,
      objectAddress: objects.address,
      objectAccessCode: objectMetadataTextValueSql("Åtkomstkod"),
      objectKeyNumber: objectMetadataTextValueSql("Nyckelnummer"),
      objectLatitude: objects.latitude,
      objectLongitude: objects.longitude,
      customerName: customers.name,
    })
    .from(workOrders)
    .leftJoin(objects, eq(workOrders.objectId, objects.id))
    .leftJoin(customers, eq(workOrders.customerId, customers.id))
    .where(whereClause)
    .orderBy(desc(workOrders.scheduledDate))
    .limit(limit)
    .offset(offset);

    return {
      workOrders: data,
      total: countResult?.count || 0
    };
  }

  async getWorkOrder(id: string): Promise<WorkOrder | undefined> {
    const [workOrder] = await db.select().from(workOrders).where(and(eq(workOrders.id, id), isNull(workOrders.deletedAt)));
    return workOrder || undefined;
  }

  async getWorkOrdersByExternalRefs(
    tenantId: string,
    refs: string[],
  ): Promise<Array<{ id: string; externalReference: string | null; modusId: string | null; metadata: unknown }>> {
    if (!refs || refs.length === 0) return [];
    const dedup = Array.from(new Set(refs.filter(Boolean).map(r => String(r))));
    if (dedup.length === 0) return [];
    const CHUNK = 1000;
    const out: Array<{ id: string; externalReference: string | null; modusId: string | null; metadata: unknown }> = [];
    for (let i = 0; i < dedup.length; i += CHUNK) {
      const chunk = dedup.slice(i, i + CHUNK);
      const rows = await db.select({
        id: workOrders.id,
        externalReference: workOrders.externalReference,
        modusId: sql<string | null>`(${workOrders.metadata}->>'modusId')`,
        metadata: workOrders.metadata,
      }).from(workOrders).where(
        and(
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt),
          or(
            inArray(workOrders.externalReference, chunk),
            sql`(${workOrders.metadata}->>'modusId') IN (${sql.join(chunk.map(v => sql`${v}`), sql`, `)})`
          )!
        )
      );
      out.push(...rows);
    }
    return out;
  }

  async getWorkOrdersByResource(resourceId: string, startDate?: Date, endDate?: Date): Promise<WorkOrder[]> {
    let conditions = [eq(workOrders.resourceId, resourceId), isNull(workOrders.deletedAt)];
    if (startDate) conditions.push(gte(workOrders.scheduledDate, startDate));
    if (endDate) conditions.push(lte(workOrders.scheduledDate, endDate));
    return db.select().from(workOrders).where(and(...conditions)).orderBy(workOrders.scheduledDate);
  }

  async getWorkOrdersByDate(tenantId: string, date: Date): Promise<WorkOrder[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    return db.select().from(workOrders).where(
      and(
        eq(workOrders.tenantId, tenantId),
        isNull(workOrders.deletedAt),
        gte(workOrders.scheduledDate, startOfDay),
        lte(workOrders.scheduledDate, endOfDay)
      )
    ).orderBy(workOrders.scheduledStartTime);
  }

  async getRecentWorkOrdersForObject(tenantId: string, objectId: string, excludeId: string, limit: number = 5): Promise<WorkOrder[]> {
    return db.select().from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        eq(workOrders.objectId, objectId),
        isNull(workOrders.deletedAt),
        sql`${workOrders.id} <> ${excludeId}`,
      ))
      .orderBy(desc(sql`coalesce(${workOrders.scheduledDate}, ${workOrders.createdAt})`))
      .limit(limit);
  }

  async getCustomerCommunicationsByWorkOrder(tenantId: string, workOrderId: string, limit: number = 20): Promise<CustomerCommunication[]> {
    return db.select().from(customerCommunications)
      .where(and(
        eq(customerCommunications.tenantId, tenantId),
        eq(customerCommunications.workOrderId, workOrderId),
      ))
      .orderBy(desc(customerCommunications.createdAt))
      .limit(limit);
  }

  async getWorkOrderCounts(tenantId: string): Promise<{ overdue: number; todayPending: number; total: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const overdueFloor = new Date(today);
    overdueFloor.setDate(overdueFloor.getDate() - 90);

    // Count overdue orders (scheduled in the last 90 days before today, not completed/cancelled)
    const [overdueResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        isNull(workOrders.deletedAt),
        gte(workOrders.scheduledDate, overdueFloor),
        lt(workOrders.scheduledDate, today),
        notInArray(workOrders.orderStatus, ['utford', 'fakturerad', 'avbruten', 'omojlig'])
      ));

    // Count today's pending orders
    const [todayResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        isNull(workOrders.deletedAt),
        gte(workOrders.scheduledDate, today),
        lt(workOrders.scheduledDate, tomorrow),
        notInArray(workOrders.orderStatus, ['utford', 'fakturerad', 'avbruten', 'omojlig'])
      ));

    // Count total non-deleted orders
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        isNull(workOrders.deletedAt)
      ));

    return {
      overdue: overdueResult?.count || 0,
      todayPending: todayResult?.count || 0,
      total: totalResult?.count || 0
    };
  }

  async getActiveResourceCount(tenantId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(resources)
      .where(and(
        eq(resources.tenantId, tenantId),
        eq(resources.status, 'active'),
        isNull(resources.deletedAt)
      ));
    return result?.count || 0;
  }

  // Task #1215 (Etapp 3): fyll uppgiftspaketet (arbetskopian) best-effort vid
  // skapande — får ALDRIG blockera inserten. Delas av alla skapande-paths som
  // går via storage; direkta db.insert-callers anropar buildUppgiftspaket själva.
  private async fillWorkOrderUppgiftspaket(values: InsertWorkOrder): Promise<void> {
    if (values.uppgiftspaket || !values.tenantId) return;
    try {
      values.uppgiftspaket = await buildUppgiftspaket({
        tenantId: values.tenantId,
        objectId: values.objectId ?? null,
        tidsfonsterStart: values.plannedWindowStart ?? values.desiredDeliveryStart ?? null,
        tidsfonsterSlut: values.plannedWindowEnd ?? values.desiredDeliveryEnd ?? null,
        antal: values.frozenQuantity ?? null,
        utforandekod: values.executionCode ?? null,
        tidskod: values.frozenTimeCode ?? null,
        kundId: values.customerId ?? null,
        frystFakturamottagareId: values.frozenInvoiceRecipientId ?? null,
      });
    } catch (err) {
      console.error("[uppgiftspaket] fyllnad vid createWorkOrder misslyckades:", err);
    }
  }

  private async fillAssignmentUppgiftspaket(values: InsertAssignmentType): Promise<void> {
    if (values.uppgiftspaket || !values.tenantId) return;
    try {
      values.uppgiftspaket = await buildUppgiftspaket({
        tenantId: values.tenantId,
        objectId: values.objectId ?? null,
        tidsfonsterStart: values.plannedWindowStart ?? null,
        tidsfonsterSlut: values.plannedWindowEnd ?? null,
        antal: values.quantity ?? null,
        utforandekod: values.executionCode ?? null,
        tidskod: values.frozenTimeCode ?? null,
        kundId: values.customerId ?? null,
      });
    } catch (err) {
      console.error("[uppgiftspaket] fyllnad vid createAssignment misslyckades:", err);
    }
  }

  async createWorkOrder(insertWorkOrder: InsertWorkOrder): Promise<WorkOrder> {
    const values = { ...insertWorkOrder };
    if (values.objectId && (values.taskLatitude == null || values.taskLongitude == null)) {
      const [obj] = await db.select({ latitude: objects.latitude, longitude: objects.longitude })
        .from(objects).where(eq(objects.id, values.objectId)).limit(1);
      if (obj) {
        if (values.taskLatitude == null && obj.latitude != null) values.taskLatitude = obj.latitude;
        if (values.taskLongitude == null && obj.longitude != null) values.taskLongitude = obj.longitude;
      }
    }
    // Auto-infer team_id från resursens medlemskap. Triggas ENDAST när:
    //   - resourceId är satt (icke-null) i input,
    //   - teamId-nyckeln saknas helt i input (Object.hasOwn === false), och
    //   - tenantId finns.
    // Respekterar explicita värden (även null) från caller och undviker
    // overhead när jobbet inte har någon resurs. När resursen saknar
    // team-medlemskap sätts teamId explicit till null så att teamId blir
    // en härledd egenskap av resourceId.
    const teamIdProvided = Object.prototype.hasOwnProperty.call(insertWorkOrder, "teamId");
    if (!teamIdProvided && values.tenantId && values.resourceId) {
      const inferred = await inferTeamIdForResource(
        values.tenantId,
        values.resourceId,
        values.clusterId ?? null,
      );
      values.teamId = inferred;
    }
    await this.fillWorkOrderUppgiftspaket(values);
    const [workOrder] = await db.insert(workOrders).values(values).returning();
    if (workOrder?.tenantId) invalidateWorkflowCaches(workOrder.tenantId);
    return workOrder;
  }

  // Skapar en arbetsorder och alla dess rader i EN databastransaktion. Allt eller
  // inget: om någon rad-insert fallerar rullas hela ordern tillbaka så att inga
  // halvfärdiga ordrar (WO utan rader) kan uppstå. Alla read-baserade härledningar
  // (koordinater från objekt, team från resurs) görs före transaktionen — endast
  // skrivningarna är transaktionella. Totaler räknas om inom transaktionen.
  async createWorkOrderWithLines(
    insertWorkOrder: InsertWorkOrder,
    lines: Omit<InsertWorkOrderLine, "workOrderId" | "tenantId">[],
    opts?: { assignOrderNumber?: boolean },
  ): Promise<{ workOrder: WorkOrder; lines: WorkOrderLine[] }> {
    const values = { ...insertWorkOrder };
    if (values.objectId && (values.taskLatitude == null || values.taskLongitude == null)) {
      const [obj] = await db.select({ latitude: objects.latitude, longitude: objects.longitude })
        .from(objects).where(eq(objects.id, values.objectId)).limit(1);
      if (obj) {
        if (values.taskLatitude == null && obj.latitude != null) values.taskLatitude = obj.latitude;
        if (values.taskLongitude == null && obj.longitude != null) values.taskLongitude = obj.longitude;
      }
    }
    const teamIdProvided = Object.prototype.hasOwnProperty.call(insertWorkOrder, "teamId");
    if (!teamIdProvided && values.tenantId && values.resourceId) {
      values.teamId = await inferTeamIdForResource(
        values.tenantId,
        values.resourceId,
        values.clusterId ?? null,
      );
    }
    // Uppgiftspaket-fyllnad är en read-baserad härledning → före transaktionen.
    await this.fillWorkOrderUppgiftspaket(values);

    const result = await db.transaction(async (tx) => {
      // Snabborder: mynta löpande "SO-<n>" per tenant under transaktionsbundet
      // advisory-lås (samma mönster som OBJ-NNN i createObject) så två samtidiga
      // skapanden inte kan landa på samma nummer. Klientsatt orderNumber strippas
      // i route-lagret — här myntas det alltid server-side när flaggan är satt.
      if (opts?.assignOrderNumber && !values.orderNumber && values.tenantId) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('work_order_number'), hashtext(${values.tenantId}))`,
        );
        values.orderNumber = await this.computeNextWorkOrderNumber(values.tenantId, tx);
      }
      const [workOrder] = await tx.insert(workOrders).values(values).returning();

      const insertedLines: WorkOrderLine[] = [];
      for (const line of lines) {
        const [wol] = await tx.insert(workOrderLines).values({
          ...line,
          tenantId: workOrder.tenantId,
          workOrderId: workOrder.id,
        }).returning();
        insertedLines.push(wol);
      }

      // Räkna om totaler från de nyss skapade raderna (samma logik som
      // recalculateWorkOrderTotals men inom transaktionen).
      let totalValue = 0;
      let totalCost = 0;
      let totalMinutes = 0;
      for (const line of insertedLines) {
        if (!line.isOptional) {
          const qty = line.quantity || 1;
          totalValue += (line.resolvedPrice || 0) * qty;
          totalCost += (line.resolvedCost || 0) * qty;
          totalMinutes += (line.resolvedProductionMinutes || 0) * qty;
        }
      }
      const [updated] = await tx.update(workOrders).set({
        cachedValue: totalValue,
        cachedCost: totalCost,
        cachedProductionMinutes: totalMinutes,
      }).where(eq(workOrders.id, workOrder.id)).returning();

      return { workOrder: updated ?? workOrder, lines: insertedLines };
    });

    if (result.workOrder?.tenantId) invalidateWorkflowCaches(result.workOrder.tenantId);
    return result;
  }

  async updateWorkOrder(id: string, data: Partial<InsertWorkOrder>): Promise<WorkOrder | undefined> {
    const updates: Partial<InsertWorkOrder> = { ...data };
    // Auto-fill task_latitude/longitude from object ENDAST när objectId byts till nytt värde
    // och anroparen inte själv anger koordinater. Detta respekterar avsiktliga
    // null-värden ("ingen specifik punkt") och task-specifika overrides.
    const objectIdChanging = Object.prototype.hasOwnProperty.call(updates, "objectId");
    const taskLatProvided = Object.prototype.hasOwnProperty.call(updates, "taskLatitude");
    const taskLngProvided = Object.prototype.hasOwnProperty.call(updates, "taskLongitude");
    if (objectIdChanging && updates.objectId) {
      const [obj] = await db.select({ latitude: objects.latitude, longitude: objects.longitude })
        .from(objects).where(eq(objects.id, updates.objectId)).limit(1);
      if (obj) {
        if (!taskLatProvided && obj.latitude != null) updates.taskLatitude = obj.latitude;
        if (!taskLngProvided && obj.longitude != null) updates.taskLongitude = obj.longitude;
      }
    }
    // Auto-infer team_id på samma villkor som createWorkOrder. Triggas ENDAST
    // när resourceId-nyckeln finns i payloaden (med icke-null värde) och
    // teamId-nyckeln saknas helt. Vi måste läsa befintlig WO för tenantId
    // och clusterId om något av dem inte finns i payloaden. När resursen
    // saknar team-medlemskap sätts teamId explicit till null så att stale
    // team-koppling rensas (teamId blir härledd egenskap av resourceId).
    const teamIdProvided = Object.prototype.hasOwnProperty.call(data, "teamId");
    const resourceIdProvided = Object.prototype.hasOwnProperty.call(data, "resourceId");
    if (!teamIdProvided && resourceIdProvided && updates.resourceId) {
      const clusterIdProvided = Object.prototype.hasOwnProperty.call(data, "clusterId");
      const tenantIdProvided = Object.prototype.hasOwnProperty.call(data, "tenantId");
      let tenantId: string | undefined = tenantIdProvided ? updates.tenantId ?? undefined : undefined;
      let clusterId: string | null | undefined = clusterIdProvided ? updates.clusterId : undefined;
      if (!tenantId || clusterId === undefined) {
        const [existing] = await db
          .select({ tenantId: workOrders.tenantId, clusterId: workOrders.clusterId })
          .from(workOrders)
          .where(eq(workOrders.id, id))
          .limit(1);
        if (existing) {
          if (!tenantId) tenantId = existing.tenantId;
          if (clusterId === undefined) clusterId = existing.clusterId;
        }
      }
      if (tenantId) {
        const inferred = await inferTeamIdForResource(tenantId, updates.resourceId, clusterId ?? null);
        updates.teamId = inferred;
      }
    }
    const [workOrder] = await db.update(workOrders).set(updates).where(eq(workOrders.id, id)).returning();
    if (workOrder?.tenantId) invalidateWorkflowCaches(workOrder.tenantId);
    return workOrder || undefined;
  }

  async deleteWorkOrder(
    id: string,
    opts?: { reason?: string; userId?: string | null },
  ): Promise<void> {
    const updates: Record<string, any> = { deletedAt: new Date() };
    if (opts && (opts.reason || opts.userId)) {
      const cancellation = {
        cancellation: {
          reason: opts.reason ?? null,
          cancelledAt: new Date().toISOString(),
          cancelledBy: opts.userId ?? null,
        },
      };
      updates.metadata = sql`COALESCE(${workOrders.metadata}, '{}'::jsonb) || ${JSON.stringify(cancellation)}::jsonb`;
    }
    const [row] = await db.update(workOrders)
      .set(updates)
      .where(eq(workOrders.id, id))
      .returning({ tenantId: workOrders.tenantId });
    if (row?.tenantId) invalidateWorkflowCaches(row.tenantId);
  }

  async restoreWorkOrder(id: string): Promise<WorkOrder | undefined> {
    // Återställer en soft-deleted work order: nollställer deletedAt och tar
    // bort metadata.cancellation. Idempotent — kör mot redan återställd order
    // returnerar bara uppdaterad rad utan effekt på cancellation-fältet.
    const [workOrder] = await db.update(workOrders)
      .set({
        deletedAt: null,
        metadata: sql`COALESCE(${workOrders.metadata}, '{}'::jsonb) - 'cancellation'`,
      })
      .where(eq(workOrders.id, id))
      .returning();
    if (workOrder?.tenantId) invalidateWorkflowCaches(workOrder.tenantId);
    return workOrder || undefined;
  }

  // Task #716: lista arkiverade (soft-deleted/avbeställda) ordrar för admin-arkivet,
  // berikade med objektnamn. cancellation-metadatan bär orsak/tid/användare.
  async listArchivedWorkOrders(tenantId: string): Promise<Array<WorkOrder & { objectName: string | null; objectNumber: string | null }>> {
    const rows = await db.select({
      workOrder: workOrders,
      objectName: objects.name,
      objectNumber: objects.objectNumber,
    })
      .from(workOrders)
      .leftJoin(objects, eq(workOrders.objectId, objects.id))
      .where(and(
        eq(workOrders.tenantId, tenantId),
        isNotNull(workOrders.deletedAt),
      ))
      .orderBy(desc(workOrders.deletedAt));
    return rows.map(r => ({ ...r.workOrder, objectName: r.objectName, objectNumber: r.objectNumber }));
  }

  async getWorkOrderByModusId(tenantId: string, modusId: string): Promise<WorkOrder | undefined> {
    const [wo] = await db.select().from(workOrders).where(
      and(
        eq(workOrders.tenantId, tenantId),
        sql`${workOrders.metadata}->>'modusId' = ${modusId}`,
        isNull(workOrders.deletedAt)
      )
    );
    return wo || undefined;
  }

  async createSetupTimeLog(insertLog: InsertSetupTimeLog): Promise<SetupTimeLog> {
    const [log] = await db.insert(setupTimeLogs).values(insertLog).returning();
    return log;
  }

  async getSetupTimeLogs(tenantId: string, objectId?: string): Promise<SetupTimeLog[]> {
    if (objectId) {
      return db.select().from(setupTimeLogs).where(
        and(eq(setupTimeLogs.tenantId, tenantId), eq(setupTimeLogs.objectId, objectId))
      ).orderBy(desc(setupTimeLogs.createdAt));
    }
    return db.select().from(setupTimeLogs).where(eq(setupTimeLogs.tenantId, tenantId)).orderBy(desc(setupTimeLogs.createdAt));
  }

  async getProcurements(tenantId: string): Promise<Procurement[]> {
    return db.select().from(procurements).where(and(eq(procurements.tenantId, tenantId), isNull(procurements.deletedAt))).orderBy(desc(procurements.createdAt));
  }

  async getProcurement(id: string): Promise<Procurement | undefined> {
    const [procurement] = await db.select().from(procurements).where(and(eq(procurements.id, id), isNull(procurements.deletedAt)));
    return procurement || undefined;
  }

  async createProcurement(insertProcurement: InsertProcurement): Promise<Procurement> {
    const [procurement] = await db.insert(procurements).values(insertProcurement).returning();
    return procurement;
  }

  async updateProcurement(id: string, data: Partial<InsertProcurement>): Promise<Procurement | undefined> {
    const [procurement] = await db.update(procurements).set(data).where(eq(procurements.id, id)).returning();
    return procurement || undefined;
  }

  async deleteProcurement(id: string): Promise<void> {
    await db.update(procurements).set({ deletedAt: new Date() }).where(eq(procurements.id, id));
  }

  // Articles
  async getArticles(tenantId: string): Promise<Article[]> {
    return db.select().from(articles).where(and(eq(articles.tenantId, tenantId), isNull(articles.deletedAt))).orderBy(articles.articleNumber);
  }

  async getArticlesPaginated(tenantId: string, limit: number, offset: number, search?: string, filters?: { articleType?: string; hookLevel?: string }): Promise<{ articles: Article[]; total: number }> {
    const { count } = await import("drizzle-orm");
    let whereConditions = and(eq(articles.tenantId, tenantId), isNull(articles.deletedAt));
    if (search && search.trim()) {
      const searchTerm = `%${search.toLowerCase()}%`;
      whereConditions = and(
        whereConditions,
        or(
          sql`LOWER(${articles.name}) LIKE ${searchTerm}`,
          sql`LOWER(${articles.articleNumber}) LIKE ${searchTerm}`,
          sql`LOWER(${articles.description}) LIKE ${searchTerm}`
        )
      );
    }
    if (filters?.articleType) {
      whereConditions = and(whereConditions, eq(articles.articleType, filters.articleType));
    }
    if (filters?.hookLevel) {
      whereConditions = and(whereConditions, eq(articles.hookLevel, filters.hookLevel));
    }
    const [countResult] = await db.select({ count: count() }).from(articles).where(whereConditions);
    const total = countResult?.count || 0;
    const articlesList = await db.select().from(articles).where(whereConditions).orderBy(articles.articleNumber).limit(limit).offset(offset);
    return { articles: articlesList, total };
  }

  async getArticle(id: string): Promise<Article | undefined> {
    const [article] = await db.select().from(articles).where(and(eq(articles.id, id), isNull(articles.deletedAt)));
    return article || undefined;
  }

  // Per-tenant uppslag på artikelnummer (case-insensitivt, trimmat). Används för
  // dubblettskydd vid create/update samt realtidsvalidering i artikelformuläret.
  async getArticleByNumber(tenantId: string, articleNumber: string, excludeId?: string): Promise<Article | undefined> {
    const trimmed = articleNumber.trim().toLowerCase();
    if (!trimmed) return undefined;
    const conds = [
      eq(articles.tenantId, tenantId),
      isNull(articles.deletedAt),
      sql`LOWER(${articles.articleNumber}) = ${trimmed}`,
    ];
    if (excludeId) conds.push(sql`${articles.id} <> ${excludeId}`);
    const [article] = await db.select().from(articles).where(and(...conds));
    return article || undefined;
  }

  /**
   * Hämta artiklar som är applicerbara för ett specifikt objekt baserat på hookLevel (Traivo fasthakning)
   * 
   * Fasthakning-logik:
   * - Artikeln matchar om objektets nivå/typ EXAKT motsvarar artikelns hookLevel
   * - hookConditions kan användas för ytterligare filtrering (t.ex. container_type)
   * - "kod"-hook matchar objekt med accessCode satt
   * 
   * Hook-nivåer:
   * - koncern: Endast objekt på koncern-nivå (hierarchyLevel=koncern)
   * - brf: Endast BRF-objekt (hierarchyLevel=brf)
   * - fastighet: Fastighetsobjekt (hierarchyLevel=fastighet eller objectType=fastighet)
   * - rum: Rum-objekt (hierarchyLevel=rum eller objectType rum/soprum/kok)
   * - karl: Alla kärl (objectType matavfall/atervinning/etc eller hierarchyLevel=karl)
   * - karl_mat: Endast matavfallskärl
   * - karl_rest: Endast restavfallskärl
   * - karl_plast: Endast plastkärl
   * - kod: Objekt med accessCode
   */
  async getApplicableArticlesForObject(tenantId: string, objectId: string): Promise<Article[]> {
    const object = await this.getObject(objectId);
    if (!object || object.tenantId !== tenantId) {
      return [];
    }

    const allArticles = await this.getArticles(tenantId);

    // Task #835: konsoliderad matchning via associationRules. Hook-kontexten delas med
    // legacyHookMatch (extraherad ordagrant) → paritet by construction. Artiklar utan regler
    // (ej migrerade) faller tillbaka på legacy hookLevel/hookConditions med samma matchare.
    // Etapp 5: åtkomstkod läses ur metadata (systemområdet Åtkomst).
    const atkomstForHook = await getObjectAtkomstFields(objectId, tenantId);
    const hookCtx: HookObjectContext = {
      objectType: object.objectType || '',
      hierarchyLevel: object.hierarchyLevel || '',
      accessCode: atkomstForHook.portkod,
    };

    // Hämta objektets metadata bara om någon artikel faktiskt har metadata-villkor (perf).
    const needsMeta = allArticles.some(
      (a) =>
        Array.isArray(a.associationRules) &&
        (a.associationRules as AssociationCondition[]).some((c) => c.source === 'metadata'),
    );
    let lookupMeta: (label: string) => string | null = () => null;
    if (needsMeta) {
      const objMeta = await getObjectWithAllMetadata(objectId, tenantId);
      const metaList = objMeta?.metadata ?? [];
      lookupMeta = (label: string) => {
        const m = metaList.find(
          (mm: any) => mm.katalog.beteckning === label || mm.katalog.namn === label,
        );
        return m ? extractMetaDisplayValue(m) : null;
      };
    }

    return allArticles.filter((article) => {
      const rules = (article.associationRules as AssociationCondition[] | null) || [];
      if (rules.length > 0) {
        return evaluateArticleAssociationRules(rules, { hook: hookCtx, lookupMeta });
      }
      // Legacy-fallback: artiklar som ännu inte migrerats till regler.
      if (!article.hookLevel) return false;
      return legacyHookMatch(
        hookCtx,
        article.hookLevel,
        (article.hookConditions as Record<string, unknown> | null) ?? null,
      );
    });
  }

  async createArticle(insertArticle: InsertArticle): Promise<Article> {
    const [article] = await db.insert(articles).values(insertArticle).returning();
    return article;
  }

  async updateArticle(id: string, data: Partial<InsertArticle>): Promise<Article | undefined> {
    const [article] = await db.update(articles).set(data).where(eq(articles.id, id)).returning();
    return article || undefined;
  }

  async deleteArticle(id: string): Promise<void> {
    await db.update(articles).set({ deletedAt: new Date() }).where(eq(articles.id, id));
    // Städa Fortnox-mappningen så att den inte blir föräldralös (Task #468).
    try {
      await this.deleteFortnoxMappingsForEntity("article", id);
    } catch (e) {
      console.warn("[fortnox-mapping] kunde inte rensa mappning för artikel", id, e);
    }
  }

  // ===== Article type registry (Task #834) =====
  // Systemstandard som seedas per tenant. `key` är back-compat med befintlig fri
  // text i articles.articleType (tjanst/vara/kontroll/felanmalan/beroende).
  private static readonly DEFAULT_ARTICLE_TYPES: { key: string; label: string }[] = [
    { key: "tjanst", label: "Tjänst" },
    { key: "vara", label: "Vara" },
    { key: "kontroll", label: "Kontroll" },
    { key: "felanmalan", label: "Felanmälan" },
    { key: "beroende", label: "Beroende" },
  ];

  async getArticleTypeDefinitions(tenantId: string): Promise<ArticleTypeDefinition[]> {
    return db.select().from(articleTypeDefinitions)
      .where(and(eq(articleTypeDefinitions.tenantId, tenantId), isNull(articleTypeDefinitions.deletedAt)))
      .orderBy(articleTypeDefinitions.sortOrder, articleTypeDefinitions.label);
  }

  async getArticleTypeDefinition(id: string, tenantId: string): Promise<ArticleTypeDefinition | undefined> {
    const [row] = await db.select().from(articleTypeDefinitions)
      .where(and(eq(articleTypeDefinitions.id, id), eq(articleTypeDefinitions.tenantId, tenantId)));
    return row || undefined;
  }

  async createArticleTypeDefinition(data: InsertArticleTypeDefinition): Promise<ArticleTypeDefinition> {
    // Återuppliva en arkiverad typ med samma nyckel istället för att krocka mot
    // unik-index (tenantId, key) — annars kan en raderad nyckel aldrig återskapas.
    const [existing] = await db.select().from(articleTypeDefinitions)
      .where(and(eq(articleTypeDefinitions.tenantId, data.tenantId), eq(articleTypeDefinitions.key, data.key)));
    if (existing) {
      const [revived] = await db.update(articleTypeDefinitions)
        .set({ label: data.label, sortOrder: data.sortOrder ?? existing.sortOrder, deletedAt: null })
        .where(eq(articleTypeDefinitions.id, existing.id))
        .returning();
      return revived;
    }
    const [row] = await db.insert(articleTypeDefinitions).values(data).returning();
    return row;
  }

  async updateArticleTypeDefinition(id: string, tenantId: string, patch: Partial<InsertArticleTypeDefinition>): Promise<ArticleTypeDefinition | undefined> {
    // `key`/`tenantId` är immutable efter skapande (key binder data i articles.articleType).
    // `isSystem`/`deletedAt` får aldrig muteras via denna väg — annars kan en systemtyp
    // göras icke-system och sedan raderas (livscykel-tampering). Arkivering sker via
    // archiveArticleTypeDefinition.
    const { key: _k, tenantId: _t, isSystem: _s, deletedAt: _d, ...safe } = patch as any;
    const [row] = await db.update(articleTypeDefinitions)
      .set(safe)
      .where(and(eq(articleTypeDefinitions.id, id), eq(articleTypeDefinitions.tenantId, tenantId)))
      .returning();
    return row || undefined;
  }

  async archiveArticleTypeDefinition(id: string, tenantId: string): Promise<void> {
    await db.update(articleTypeDefinitions)
      .set({ deletedAt: new Date() })
      .where(and(eq(articleTypeDefinitions.id, id), eq(articleTypeDefinitions.tenantId, tenantId)));
  }

  async getArticleTypeUsageCount(tenantId: string, key: string): Promise<number> {
    const { count } = await import("drizzle-orm");
    const [row] = await db.select({ count: count() }).from(articles)
      .where(and(eq(articles.tenantId, tenantId), eq(articles.articleType, key), isNull(articles.deletedAt)));
    return row?.count || 0;
  }

  async seedArticleTypeDefinitions(tenantId: string): Promise<void> {
    // Insert-only: lägg bara till saknade systemnycklar (idempotent). Befintliga
    // (inkl. arkiverade eller omdöpta) lämnas orörda.
    const existing = await db.select({ key: articleTypeDefinitions.key }).from(articleTypeDefinitions)
      .where(eq(articleTypeDefinitions.tenantId, tenantId));
    const existingKeys = new Set(existing.map((r) => r.key));
    const toInsert = DatabaseStorage.DEFAULT_ARTICLE_TYPES
      .map((t, i) => ({ tenantId, key: t.key, label: t.label, sortOrder: i, isSystem: true }))
      .filter((t) => !existingKeys.has(t.key));
    if (toInsert.length > 0) {
      await db.insert(articleTypeDefinitions).values(toInsert);
    }
  }

  // === Execution code registry (Task #942) ===
  // Standardkoder speglar de tidigare hårdkodade EXECUTION_CODE_OPTIONS i frontend.
  private static readonly DEFAULT_EXECUTION_CODES: { key: string; label: string }[] = [
    { key: "sophamtning", label: "Sophämtning" },
    { key: "karltomning", label: "Kärltömning" },
    { key: "matavfall", label: "Matavfall" },
    { key: "tvatt", label: "Tvätt" },
    { key: "kranbil", label: "Kranbil" },
    { key: "sug", label: "Sugbil" },
    { key: "container", label: "Container" },
    { key: "atervinning", label: "Återvinning" },
    { key: "farligt_avfall", label: "Farligt avfall" },
    { key: "kontroll", label: "Kontroll/inspektion" },
    { key: "stadning", label: "Städning" },
    { key: "snorojning", label: "Snöröjning" },
    { key: "transport", label: "Transport" },
    { key: "bygg", label: "Bygg/underhåll" },
  ];

  async getExecutionCodeDefinitions(tenantId: string): Promise<ExecutionCodeDefinition[]> {
    return db.select().from(executionCodeDefinitions)
      .where(and(eq(executionCodeDefinitions.tenantId, tenantId), isNull(executionCodeDefinitions.deletedAt)))
      .orderBy(executionCodeDefinitions.sortOrder, executionCodeDefinitions.label);
  }

  async getExecutionCodeDefinition(id: string, tenantId: string): Promise<ExecutionCodeDefinition | undefined> {
    const [row] = await db.select().from(executionCodeDefinitions)
      .where(and(eq(executionCodeDefinitions.id, id), eq(executionCodeDefinitions.tenantId, tenantId)));
    return row || undefined;
  }

  async createExecutionCodeDefinition(data: InsertExecutionCodeDefinition): Promise<ExecutionCodeDefinition> {
    // Återuppliva en arkiverad kod med samma nyckel istället för att krocka mot
    // unik-index (tenantId, key).
    const [existing] = await db.select().from(executionCodeDefinitions)
      .where(and(eq(executionCodeDefinitions.tenantId, data.tenantId), eq(executionCodeDefinitions.key, data.key)));
    if (existing) {
      const [revived] = await db.update(executionCodeDefinitions)
        .set({ label: data.label, sortOrder: data.sortOrder ?? existing.sortOrder, deletedAt: null })
        .where(eq(executionCodeDefinitions.id, existing.id))
        .returning();
      return revived;
    }
    const [row] = await db.insert(executionCodeDefinitions).values(data).returning();
    return row;
  }

  async updateExecutionCodeDefinition(id: string, tenantId: string, patch: Partial<InsertExecutionCodeDefinition>): Promise<ExecutionCodeDefinition | undefined> {
    // `key`/`tenantId` immutable; `isSystem`/`deletedAt` får aldrig muteras via denna väg.
    const { key: _k, tenantId: _t, isSystem: _s, deletedAt: _d, ...safe } = patch as any;
    const [row] = await db.update(executionCodeDefinitions)
      .set(safe)
      .where(and(eq(executionCodeDefinitions.id, id), eq(executionCodeDefinitions.tenantId, tenantId)))
      .returning();
    return row || undefined;
  }

  async archiveExecutionCodeDefinition(id: string, tenantId: string): Promise<void> {
    await db.update(executionCodeDefinitions)
      .set({ deletedAt: new Date() })
      .where(and(eq(executionCodeDefinitions.id, id), eq(executionCodeDefinitions.tenantId, tenantId)));
  }

  async getExecutionCodeUsageCount(tenantId: string, key: string): Promise<number> {
    const { count } = await import("drizzle-orm");
    // Artiklar med matchande executionCode + resurser/profiler vars executionCodes[] innehåller koden.
    const [art] = await db.select({ count: count() }).from(articles)
      .where(and(eq(articles.tenantId, tenantId), eq(articles.executionCode, key), isNull(articles.deletedAt)));
    const [res] = await db.select({ count: count() }).from(resources)
      .where(and(eq(resources.tenantId, tenantId), sql`${key} = ANY(${resources.executionCodes})`, isNull(resources.deletedAt)));
    const [prof] = await db.select({ count: count() }).from(resourceProfiles)
      .where(and(eq(resourceProfiles.tenantId, tenantId), sql`${key} = ANY(${resourceProfiles.executionCodes})`));
    return (art?.count || 0) + (res?.count || 0) + (prof?.count || 0);
  }

  async seedExecutionCodeDefinitions(tenantId: string): Promise<void> {
    const existing = await db.select({ key: executionCodeDefinitions.key }).from(executionCodeDefinitions)
      .where(eq(executionCodeDefinitions.tenantId, tenantId));
    const existingKeys = new Set(existing.map((r) => r.key));
    // Utförandekoder ska vara helt användarhanterade (Task #1108) — systemet sätter
    // aldrig isSystem självt. Standardkoder seedas som vanliga (raderbara) koder.
    const toInsert = DatabaseStorage.DEFAULT_EXECUTION_CODES
      .map((t, i) => ({ tenantId, key: t.key, label: t.label, sortOrder: i, isSystem: false }))
      .filter((t) => !existingKeys.has(t.key));
    if (toInsert.length > 0) {
      await db.insert(executionCodeDefinitions).values(toInsert);
    }
  }

  // === Time code registry (Tidskoder) ===
  // Standardtidskoder subsumerar de tidigare time_category-värdena (nycklarna bevaras) och
  // lägger till interna koder + ställtid. groupKey driver rapport/lön; priority driver
  // finplaneringens överlapp (1 = aldrig överlapp).
  // Task #1237: regelmotor-defaults. payrollExport/economyExport default true (bakåt-
  // kompatibelt), requiresGps/billable satta konservativt (fältnära produktion/ställtid/
  // resa=true, internt/egentid=false). permissionLevel="all" för alla seed-koder — OB-
  // hantering (t.ex. höja övertids permissionLevel) görs manuellt av admin, ej auto-satt här.
  private static readonly DEFAULT_TIME_CODES: {
    key: string; label: string; groupKey: string; priority: number;
    payrollExport?: boolean; economyExport?: boolean; requiresGps?: boolean;
    permissionLevel?: string; billable?: boolean;
  }[] = [
    { key: "production", label: "Produktionstid", groupKey: "produktion", priority: 1, requiresGps: true, billable: true },
    { key: "overtime", label: "Övertid", groupKey: "produktion", priority: 1, billable: true },
    { key: "travel_between_jobs", label: "Restid mellan jobb", groupKey: "stalltid", priority: 1, requiresGps: true },
    { key: "setup", label: "Ställtid / rigg", groupKey: "stalltid", priority: 1, requiresGps: true },
    { key: "internal_training", label: "Utbildning", groupKey: "internt", priority: 2, economyExport: false },
    { key: "internal_repair", label: "Reparation & underhåll", groupKey: "internt", priority: 2, economyExport: false },
    { key: "internal_cleaning", label: "Städning (intern)", groupKey: "internt", priority: 2, economyExport: false },
    { key: "internal_admin", label: "Administration", groupKey: "internt", priority: 2, economyExport: false },
    { key: "travel_commute", label: "Inställelseresa / pendling", groupKey: "egentid", priority: 3, economyExport: false },
    { key: "break_meal", label: "Rast & lunch", groupKey: "egentid", priority: 3, economyExport: false },
    { key: "personal_time", label: "Egentid", groupKey: "egentid", priority: 3, economyExport: false },
    { key: "rest_night", label: "Nattvila", groupKey: "egentid", priority: 3, economyExport: false },
    { key: "rest_weekend", label: "Helgvila", groupKey: "egentid", priority: 3, economyExport: false },
  ];

  async getTimeCodeDefinitions(tenantId: string): Promise<TimeCodeDefinition[]> {
    return db.select().from(timeCodeDefinitions)
      .where(and(eq(timeCodeDefinitions.tenantId, tenantId), isNull(timeCodeDefinitions.deletedAt)))
      .orderBy(timeCodeDefinitions.sortOrder, timeCodeDefinitions.label);
  }

  async getTimeCodeDefinition(id: string, tenantId: string): Promise<TimeCodeDefinition | undefined> {
    const [row] = await db.select().from(timeCodeDefinitions)
      .where(and(eq(timeCodeDefinitions.id, id), eq(timeCodeDefinitions.tenantId, tenantId)));
    return row || undefined;
  }

  async createTimeCodeDefinition(data: InsertTimeCodeDefinition): Promise<TimeCodeDefinition> {
    // Återuppliva en arkiverad kod med samma nyckel istället för att krocka mot unik-index.
    const [existing] = await db.select().from(timeCodeDefinitions)
      .where(and(eq(timeCodeDefinitions.tenantId, data.tenantId), eq(timeCodeDefinitions.key, data.key)));
    if (existing) {
      const [revived] = await db.update(timeCodeDefinitions)
        .set({
          label: data.label,
          groupKey: data.groupKey ?? existing.groupKey,
          priority: data.priority ?? existing.priority,
          iconKey: data.iconKey ?? existing.iconKey,
          sortOrder: data.sortOrder ?? existing.sortOrder,
          payrollExport: data.payrollExport ?? existing.payrollExport,
          economyExport: data.economyExport ?? existing.economyExport,
          requiresGps: data.requiresGps ?? existing.requiresGps,
          permissionLevel: data.permissionLevel ?? existing.permissionLevel,
          billable: data.billable ?? existing.billable,
          exportRules: data.exportRules ?? existing.exportRules,
          deletedAt: null,
        })
        .where(eq(timeCodeDefinitions.id, existing.id))
        .returning();
      return revived;
    }
    const [row] = await db.insert(timeCodeDefinitions).values(data).returning();
    return row;
  }

  async updateTimeCodeDefinition(id: string, tenantId: string, patch: Partial<InsertTimeCodeDefinition>): Promise<TimeCodeDefinition | undefined> {
    // `key`/`tenantId` immutable; `isSystem`/`deletedAt` får aldrig muteras via denna väg.
    const { key: _k, tenantId: _t, isSystem: _s, deletedAt: _d, ...safe } = patch as any;
    const [row] = await db.update(timeCodeDefinitions)
      .set(safe)
      .where(and(eq(timeCodeDefinitions.id, id), eq(timeCodeDefinitions.tenantId, tenantId)))
      .returning();
    return row || undefined;
  }

  async archiveTimeCodeDefinition(id: string, tenantId: string): Promise<void> {
    await db.update(timeCodeDefinitions)
      .set({ deletedAt: new Date() })
      .where(and(eq(timeCodeDefinitions.id, id), eq(timeCodeDefinitions.tenantId, tenantId)));
  }

  async getTimeCodeUsageCount(tenantId: string, key: string): Promise<number> {
    const { count } = await import("drizzle-orm");
    // Artiklar med matchande timeCodeKey + personliga uppgifter/scheman vars time_category = nyckeln.
    const [art] = await db.select({ count: count() }).from(articles)
      .where(and(eq(articles.tenantId, tenantId), eq(articles.timeCodeKey, key), isNull(articles.deletedAt)));
    const [pt] = await db.select({ count: count() }).from(personalTasks)
      .where(and(eq(personalTasks.tenantId, tenantId), eq(personalTasks.timeCategory, key)));
    const [pts] = await db.select({ count: count() }).from(personalTaskSchedules)
      .where(and(eq(personalTaskSchedules.tenantId, tenantId), eq(personalTaskSchedules.timeCategory, key)));
    return (art?.count || 0) + (pt?.count || 0) + (pts?.count || 0);
  }

  async seedTimeCodeDefinitions(tenantId: string): Promise<void> {
    const existing = await db.select({ key: timeCodeDefinitions.key }).from(timeCodeDefinitions)
      .where(eq(timeCodeDefinitions.tenantId, tenantId));
    const existingKeys = new Set(existing.map((r) => r.key));
    const toInsert = DatabaseStorage.DEFAULT_TIME_CODES
      .map((t, i) => ({
        tenantId,
        key: t.key,
        label: t.label,
        groupKey: t.groupKey,
        priority: t.priority,
        sortOrder: i,
        isSystem: false,
        payrollExport: t.payrollExport ?? true,
        economyExport: t.economyExport ?? true,
        requiresGps: t.requiresGps ?? false,
        permissionLevel: t.permissionLevel ?? "all",
        billable: t.billable ?? false,
      }))
      .filter((t) => !existingKeys.has(t.key));
    if (toInsert.length > 0) {
      await db.insert(timeCodeDefinitions).values(toInsert);
    }
  }

  // === Icon registry (Task #942) ===
  // Standardikoner speglar de tidigare PROFILE_ICON_OPTIONS i frontend.
  private static readonly DEFAULT_ICONS: { key: string; label: string; lucideName: string }[] = [
    { key: "verktyg", label: "Verktyg", lucideName: "wrench" },
    { key: "lastbil", label: "Lastbil", lucideName: "truck" },
    { key: "hjalm", label: "Hjälm", lucideName: "hard-hat" },
    { key: "hammare", label: "Hammare", lucideName: "hammer" },
    { key: "kugghjul", label: "Kugghjul", lucideName: "cog" },
    { key: "plats", label: "Plats", lucideName: "map-pin" },
    { key: "atervinning", label: "Återvinning", lucideName: "recycle" },
    { key: "sno", label: "Snö", lucideName: "snowflake" },
    { key: "vatten", label: "Vatten", lucideName: "droplets" },
    { key: "blixt", label: "Blixt", lucideName: "zap" },
    { key: "paket", label: "Paket", lucideName: "package" },
  ];

  async getIconDefinitions(tenantId: string): Promise<IconDefinition[]> {
    return db.select().from(iconDefinitions)
      .where(and(eq(iconDefinitions.tenantId, tenantId), isNull(iconDefinitions.deletedAt)))
      .orderBy(iconDefinitions.sortOrder, iconDefinitions.label);
  }

  async getIconDefinition(id: string, tenantId: string): Promise<IconDefinition | undefined> {
    const [row] = await db.select().from(iconDefinitions)
      .where(and(eq(iconDefinitions.id, id), eq(iconDefinitions.tenantId, tenantId)));
    return row || undefined;
  }

  async createIconDefinition(data: InsertIconDefinition): Promise<IconDefinition> {
    const [existing] = await db.select().from(iconDefinitions)
      .where(and(eq(iconDefinitions.tenantId, data.tenantId), eq(iconDefinitions.key, data.key)));
    if (existing) {
      const [revived] = await db.update(iconDefinitions)
        .set({
          label: data.label,
          lucideName: data.lucideName ?? existing.lucideName,
          iconType: data.iconType ?? existing.iconType,
          symbol: data.symbol ?? existing.symbol,
          imageUrl: data.imageUrl ?? existing.imageUrl,
          sortOrder: data.sortOrder ?? existing.sortOrder,
          deletedAt: null,
        })
        .where(eq(iconDefinitions.id, existing.id))
        .returning();
      return revived;
    }
    const [row] = await db.insert(iconDefinitions).values(data).returning();
    return row;
  }

  async updateIconDefinition(id: string, tenantId: string, patch: Partial<InsertIconDefinition>): Promise<IconDefinition | undefined> {
    const { key: _k, tenantId: _t, isSystem: _s, deletedAt: _d, ...safe } = patch as any;
    const [row] = await db.update(iconDefinitions)
      .set(safe)
      .where(and(eq(iconDefinitions.id, id), eq(iconDefinitions.tenantId, tenantId)))
      .returning();
    return row || undefined;
  }

  async archiveIconDefinition(id: string, tenantId: string): Promise<void> {
    await db.update(iconDefinitions)
      .set({ deletedAt: new Date() })
      .where(and(eq(iconDefinitions.id, id), eq(iconDefinitions.tenantId, tenantId)));
  }

  async getIconUsageCount(tenantId: string, key: string): Promise<number> {
    const { count } = await import("drizzle-orm");
    const [articleRow] = await db.select({ count: count() }).from(articles)
      .where(and(eq(articles.tenantId, tenantId), eq(articles.iconKey, key), isNull(articles.deletedAt)));
    const [codeRow] = await db.select({ count: count() }).from(executionCodeDefinitions)
      .where(and(eq(executionCodeDefinitions.tenantId, tenantId), eq(executionCodeDefinitions.iconKey, key), isNull(executionCodeDefinitions.deletedAt)));
    return (articleRow?.count || 0) + (codeRow?.count || 0);
  }

  async seedIconDefinitions(tenantId: string): Promise<void> {
    const existing = await db.select({ key: iconDefinitions.key }).from(iconDefinitions)
      .where(eq(iconDefinitions.tenantId, tenantId));
    const existingKeys = new Set(existing.map((r) => r.key));
    const toInsert = DatabaseStorage.DEFAULT_ICONS
      .map((t, i) => ({ tenantId, key: t.key, label: t.label, lucideName: t.lucideName, sortOrder: i, isSystem: true }))
      .filter((t) => !existingKeys.has(t.key));
    if (toInsert.length > 0) {
      await db.insert(iconDefinitions).values(toInsert);
    }
  }

  async getObjectArticles(tenantId: string, objectId: string): Promise<ObjectArticle[]> {
    return db.select().from(objectArticles)
      .where(and(
        eq(objectArticles.tenantId, tenantId),
        eq(objectArticles.objectId, objectId),
      ));
  }

  async addObjectArticle(data: InsertObjectArticle): Promise<ObjectArticle> {
    const [result] = await db.insert(objectArticles).values(data).returning();
    return result;
  }

  async removeObjectArticle(tenantId: string, objectId: string, id: string): Promise<boolean> {
    const result = await db.delete(objectArticles)
      .where(and(
        eq(objectArticles.id, id),
        eq(objectArticles.tenantId, tenantId),
        eq(objectArticles.objectId, objectId),
      ))
      .returning();
    return result.length > 0;
  }

  async updateObjectArticlePrice(tenantId: string, objectId: string, id: string, overridePrice: number | null): Promise<ObjectArticle | undefined> {
    const [result] = await db.update(objectArticles)
      .set({ overridePrice })
      .where(and(
        eq(objectArticles.id, id),
        eq(objectArticles.tenantId, tenantId),
        eq(objectArticles.objectId, objectId),
      ))
      .returning();
    return result || undefined;
  }

  async getResolvedArticlePricesForObject(tenantId: string, objectId: string): Promise<ResolvedArticlePrice[]> {
    const applicableArticles = await this.getApplicableArticlesForObject(tenantId, objectId);
    const manualLinks = await this.getObjectArticles(tenantId, objectId);
    
    const manualArticleIds = new Set(manualLinks.map(m => m.articleId));
    const allPriceLists = await this.getPriceLists(tenantId);
    const activePriceLists = allPriceLists.filter(pl => pl.status === 'active' && !pl.deletedAt);
    
    const object = await this.getObject(objectId);
    const customerId = object?.customerId;
    
    const plIds = activePriceLists.map(pl => pl.id);
    const allPriceListArticles = plIds.length > 0
      ? await db.select().from(priceListArticles).where(inArray(priceListArticles.priceListId, plIds))
      : [];
    
    const plArticleMap = new Map<string, { price: number; productionTime: number | null; priceListName: string; priority: number }>();
    for (const pla of allPriceListArticles) {
      const pl = activePriceLists.find(p => p.id === pla.priceListId);
      if (!pl) continue;
      if (pl.customerId && pl.customerId !== customerId) continue;
      
      const existing = plArticleMap.get(pla.articleId);
      const priority = pl.priority || 1;
      if (!existing || priority > existing.priority) {
        plArticleMap.set(pla.articleId, {
          price: pla.price,
          productionTime: pla.productionTime,
          priceListName: pl.name,
          priority,
        });
      }
    }
    
    const resolvePrice = (article: Article): { resolvedPrice: number; priceSource: string; priceListName: string | null } => {
      const plEntry = plArticleMap.get(article.id);
      if (plEntry) {
        return { resolvedPrice: plEntry.price, priceSource: 'prislista', priceListName: plEntry.priceListName };
      }
      return { resolvedPrice: article.listPrice || 0, priceSource: 'listpris', priceListName: null };
    };
    
    const results: ResolvedArticlePrice[] = [];
    
    for (const article of applicableArticles) {
      const { resolvedPrice, priceSource, priceListName } = resolvePrice(article);
      const manualLink = manualLinks.find(m => m.articleId === article.id);
      results.push({
        articleId: article.id,
        articleNumber: article.articleNumber,
        name: article.name,
        articleType: article.articleType,
        hookLevel: article.hookLevel,
        productionTime: article.productionTime || 0,
        listPrice: article.listPrice || 0,
        resolvedPrice: manualLink?.overridePrice ?? resolvedPrice,
        priceSource: manualLink?.overridePrice != null ? 'objektpris' : priceSource,
        priceListName: manualLink?.overridePrice != null ? null : priceListName,
        isManual: false,
        objectArticleId: manualLink?.id || null,
        overridePrice: manualLink?.overridePrice ?? null,
      });
    }
    
    for (const manual of manualLinks) {
      if (manualArticleIds.has(manual.articleId) && results.some(r => r.articleId === manual.articleId)) {
        continue;
      }
      const article = await this.getArticle(manual.articleId);
      if (!article || article.deletedAt) continue;
      const { resolvedPrice, priceSource, priceListName } = resolvePrice(article);
      results.push({
        articleId: article.id,
        articleNumber: article.articleNumber,
        name: article.name,
        articleType: article.articleType,
        hookLevel: article.hookLevel,
        productionTime: article.productionTime || 0,
        listPrice: article.listPrice || 0,
        resolvedPrice: manual.overridePrice ?? resolvedPrice,
        priceSource: manual.overridePrice != null ? 'objektpris' : priceSource,
        priceListName: manual.overridePrice != null ? null : priceListName,
        isManual: true,
        objectArticleId: manual.id,
        overridePrice: manual.overridePrice ?? null,
      });
    }
    
    return results;
  }

  // Price Lists
  async getPriceLists(tenantId: string): Promise<PriceList[]> {
    return db.select().from(priceLists).where(and(eq(priceLists.tenantId, tenantId), isNull(priceLists.deletedAt))).orderBy(desc(priceLists.priority));
  }

  async getPriceListsPaginated(tenantId: string, limit: number, offset: number, search?: string): Promise<{ priceLists: PriceList[]; total: number }> {
    const { count } = await import("drizzle-orm");
    let whereConditions = and(eq(priceLists.tenantId, tenantId), isNull(priceLists.deletedAt));
    if (search && search.trim()) {
      const searchTerm = `%${search.toLowerCase()}%`;
      whereConditions = and(
        whereConditions,
        sql`LOWER(${priceLists.name}) LIKE ${searchTerm}`
      );
    }
    const [countResult] = await db.select({ count: count() }).from(priceLists).where(whereConditions);
    const total = countResult?.count || 0;
    const priceListsList = await db.select().from(priceLists).where(whereConditions).orderBy(desc(priceLists.priority)).limit(limit).offset(offset);
    return { priceLists: priceListsList, total };
  }

  async getPriceList(id: string): Promise<PriceList | undefined> {
    const [priceList] = await db.select().from(priceLists).where(and(eq(priceLists.id, id), isNull(priceLists.deletedAt)));
    return priceList || undefined;
  }

  async createPriceList(insertPriceList: InsertPriceList): Promise<PriceList> {
    const [priceList] = await db.insert(priceLists).values(insertPriceList).returning();
    return priceList;
  }

  async updatePriceList(id: string, data: Partial<InsertPriceList>): Promise<PriceList | undefined> {
    const [priceList] = await db.update(priceLists).set(data).where(eq(priceLists.id, id)).returning();
    return priceList || undefined;
  }

  async deletePriceList(id: string): Promise<void> {
    await db.update(priceLists).set({ deletedAt: new Date() }).where(eq(priceLists.id, id));
  }

  // Price List Articles
  async getPriceListArticles(priceListId: string): Promise<PriceListArticle[]> {
    return db.select().from(priceListArticles).where(eq(priceListArticles.priceListId, priceListId));
  }

  async getPriceListArticle(id: string): Promise<PriceListArticle | undefined> {
    const [pla] = await db.select().from(priceListArticles).where(eq(priceListArticles.id, id));
    return pla || undefined;
  }

  async createPriceListArticle(insertPriceListArticle: InsertPriceListArticle): Promise<PriceListArticle> {
    const [pla] = await db.insert(priceListArticles).values(insertPriceListArticle).returning();
    return pla;
  }

  async updatePriceListArticle(id: string, data: Partial<InsertPriceListArticle>): Promise<PriceListArticle | undefined> {
    const [pla] = await db.update(priceListArticles).set(data).where(eq(priceListArticles.id, id)).returning();
    return pla || undefined;
  }

  async deletePriceListArticle(id: string): Promise<void> {
    await db.delete(priceListArticles).where(eq(priceListArticles.id, id));
  }

  // Resource Articles (resurskompetenser)
  async getResourceArticles(resourceId: string): Promise<ResourceArticle[]> {
    return db.select().from(resourceArticles).where(eq(resourceArticles.resourceId, resourceId));
  }

  async getResourceArticlesByResourceIds(resourceIds: string[]): Promise<ResourceArticle[]> {
    if (resourceIds.length === 0) return [];
    return db.select().from(resourceArticles).where(inArray(resourceArticles.resourceId, resourceIds));
  }

  async getResourceArticle(id: string): Promise<ResourceArticle | undefined> {
    const [ra] = await db.select().from(resourceArticles).where(eq(resourceArticles.id, id));
    return ra || undefined;
  }

  async createResourceArticle(insertResourceArticle: InsertResourceArticle): Promise<ResourceArticle> {
    const [ra] = await db.insert(resourceArticles).values(insertResourceArticle).returning();
    return ra;
  }

  async updateResourceArticle(id: string, data: Partial<InsertResourceArticle>): Promise<ResourceArticle | undefined> {
    const [ra] = await db.update(resourceArticles).set(data).where(eq(resourceArticles.id, id)).returning();
    return ra || undefined;
  }

  async deleteResourceArticle(id: string): Promise<void> {
    await db.delete(resourceArticles).where(eq(resourceArticles.id, id));
  }

  // Work Order Lines
  async getWorkOrderLines(workOrderId: string): Promise<WorkOrderLine[]> {
    return db.select().from(workOrderLines).where(eq(workOrderLines.workOrderId, workOrderId));
  }

  async getWorkOrderLine(id: string): Promise<WorkOrderLine | undefined> {
    const [line] = await db.select().from(workOrderLines).where(eq(workOrderLines.id, id));
    return line || undefined;
  }

  async createWorkOrderLine(line: InsertWorkOrderLine, options?: { skipRecalc?: boolean }): Promise<WorkOrderLine> {
    const [wol] = await db.insert(workOrderLines).values(line).returning();
    if (!options?.skipRecalc && wol?.workOrderId) {
      await this.recalculateWorkOrderTotals(wol.workOrderId);
    }
    return wol;
  }

  async updateWorkOrderLine(id: string, data: Partial<InsertWorkOrderLine>, options?: { skipRecalc?: boolean }): Promise<WorkOrderLine | undefined> {
    let oldWorkOrderId: string | null = null;
    if (!options?.skipRecalc) {
      const existing = await this.getWorkOrderLine(id);
      oldWorkOrderId = existing?.workOrderId ?? null;
    }
    const [wol] = await db.update(workOrderLines).set(data).where(eq(workOrderLines.id, id)).returning();
    if (!options?.skipRecalc) {
      const ids = new Set<string>();
      if (oldWorkOrderId) ids.add(oldWorkOrderId);
      if (wol?.workOrderId) ids.add(wol.workOrderId);
      for (const woId of ids) {
        await this.recalculateWorkOrderTotals(woId);
      }
    }
    return wol || undefined;
  }

  async deleteWorkOrderLine(id: string, options?: { skipRecalc?: boolean }): Promise<void> {
    let workOrderId: string | null = null;
    if (!options?.skipRecalc) {
      const existing = await this.getWorkOrderLine(id);
      workOrderId = existing?.workOrderId ?? null;
    }
    await db.delete(workOrderLines).where(eq(workOrderLines.id, id));
    if (!options?.skipRecalc && workOrderId) {
      await this.recalculateWorkOrderTotals(workOrderId);
    }
  }

  // Work Order Objects
  async getWorkOrderObjects(workOrderId: string): Promise<WorkOrderObject[]> {
    return db.select().from(workOrderObjects)
      .where(eq(workOrderObjects.workOrderId, workOrderId))
      .orderBy(workOrderObjects.sortOrder);
  }

  async getWorkOrderObject(id: string): Promise<WorkOrderObject | undefined> {
    const [obj] = await db.select().from(workOrderObjects).where(eq(workOrderObjects.id, id));
    return obj || undefined;
  }

  async createWorkOrderObject(data: InsertWorkOrderObject): Promise<WorkOrderObject> {
    const [obj] = await db.insert(workOrderObjects).values(data).returning();
    return obj;
  }

  async deleteWorkOrderObject(id: string): Promise<void> {
    await db.delete(workOrderObjects).where(eq(workOrderObjects.id, id));
  }

  // Simulation Scenarios
  async getSimulationScenarios(tenantId: string): Promise<SimulationScenario[]> {
    return db.select().from(simulationScenarios)
      .where(and(eq(simulationScenarios.tenantId, tenantId), isNull(simulationScenarios.deletedAt)));
  }

  async getSimulationScenario(id: string): Promise<SimulationScenario | undefined> {
    const [scenario] = await db.select().from(simulationScenarios)
      .where(and(eq(simulationScenarios.id, id), isNull(simulationScenarios.deletedAt)));
    return scenario || undefined;
  }

  async createSimulationScenario(scenario: InsertSimulationScenario): Promise<SimulationScenario> {
    const [ss] = await db.insert(simulationScenarios).values(scenario).returning();
    return ss;
  }

  async updateSimulationScenario(id: string, data: Partial<InsertSimulationScenario>): Promise<SimulationScenario | undefined> {
    const [ss] = await db.update(simulationScenarios).set(data).where(eq(simulationScenarios.id, id)).returning();
    return ss || undefined;
  }

  async deleteSimulationScenario(id: string): Promise<void> {
    await db.update(simulationScenarios).set({ deletedAt: new Date() }).where(eq(simulationScenarios.id, id));
  }

  // Order Stock with filters
  async getOrderStock(tenantId: string, options?: {
    includeSimulated?: boolean;
    scenarioId?: string;
    orderStatus?: OrderStatus;
    activeOnly?: boolean;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    pageSize?: number;
    search?: string;
    metadataFilters?: { metadataName: string; operator: string; value: string }[];
    includeCancelled?: boolean;
  }): Promise<{ orders: WorkOrder[]; total: number; byStatus: Record<string, number>; aggregates: { totalValue: number; totalCost: number; totalProductionMinutes: number } }> {
    const completedStatuses: OrderStatus[] = ['utford', 'fakturerad', 'avbruten', 'omojlig'];
    // includeCancelled=true: visa endast soft-deleted ordrar (avbeställda).
    // Default (false): exkludera soft-deleted som tidigare.
    let allStatusBase = options?.includeCancelled
      ? and(eq(workOrders.tenantId, tenantId), isNotNull(workOrders.deletedAt))
      : and(eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt));
    
    if (!options?.includeSimulated) {
      allStatusBase = and(allStatusBase, eq(workOrders.isSimulated, false));
    }
    
    if (options?.scenarioId) {
      allStatusBase = and(allStatusBase, eq(workOrders.simulationScenarioId, options.scenarioId));
    }
    
    let baseConditions = allStatusBase;
    if (options?.activeOnly !== false && !options?.orderStatus) {
      baseConditions = and(baseConditions, notInArray(workOrders.orderStatus, completedStatuses));
    }
    
    // Date filters apply to everything (status counts, aggregates, and paginated results)
    let allStatusDateFiltered = allStatusBase;
    let dateFilteredConditions = baseConditions;
    if (options?.startDate) {
      allStatusDateFiltered = and(allStatusDateFiltered, gte(workOrders.scheduledDate, options.startDate));
      dateFilteredConditions = and(dateFilteredConditions, gte(workOrders.scheduledDate, options.startDate));
    }
    if (options?.endDate) {
      allStatusDateFiltered = and(allStatusDateFiltered, lte(workOrders.scheduledDate, options.endDate));
      dateFilteredConditions = and(dateFilteredConditions, lte(workOrders.scheduledDate, options.endDate));
    }
    
    // Status filter only for paginated results (not for tab counts)
    let paginatedConditions = dateFilteredConditions;
    if (options?.orderStatus) {
      paginatedConditions = and(dateFilteredConditions, eq(workOrders.orderStatus, options.orderStatus));
    }
    
    // Search filter - searches across order title, customer name, and object name
    let searchConditions = paginatedConditions;
    if (options?.search && options.search.trim()) {
      const searchTerm = `%${options.search.trim().toLowerCase()}%`;
      searchConditions = and(paginatedConditions, or(
        sql`lower(${workOrders.title}) LIKE ${searchTerm}`,
        sql`${workOrders.customerId} IN (SELECT id FROM ${customers} WHERE ${customers.tenantId} = ${tenantId} AND lower(name) LIKE ${searchTerm})`,
        sql`${workOrders.objectId} IN (SELECT id FROM ${objects} WHERE ${objects.tenantId} = ${tenantId} AND lower(name) LIKE ${searchTerm})`
      ));
    }
    
    // Metadata filter - filter orders by object metadata values
    if (options?.metadataFilters && options.metadataFilters.length > 0) {
      const validOps = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains']);
      
      for (const mf of options.metadataFilters) {
        if (!validOps.has(mf.operator)) continue;
        
        const metaName = mf.metadataName.toLowerCase();
        const isNumeric = ['gt', 'gte', 'lt', 'lte'].includes(mf.operator);
        const isContains = mf.operator === 'contains';
        
        const baseSubquery = sql`
          SELECT mv.objekt_id FROM metadata_varden mv
          JOIN metadata_katalog mk ON mv.metadata_katalog_id = mk.id
          JOIN ${objects} o ON o.id = mv.objekt_id AND o.tenant_id = ${tenantId}
          WHERE mk.tenant_id = ${tenantId}
            AND lower(mk.namn) = ${metaName}
            AND mv.status = 'aktiv'
            AND mv.raderad = false
        `;
        
        if (isNumeric) {
          const numVal = Number(mf.value);
          const numExpr = sql`(
            CASE 
              WHEN mk.datatyp = 'integer' THEN mv.varde_integer::numeric
              WHEN mk.datatyp = 'decimal' THEN mv.varde_decimal::numeric
              ELSE CASE WHEN mv.varde_string ~ '^[0-9.]+$' THEN mv.varde_string::numeric ELSE NULL END
            END
          )`;
          
          let condition;
          switch (mf.operator) {
            case 'gt': condition = sql`${workOrders.objectId} IN (${baseSubquery} AND ${numExpr} > ${numVal})`; break;
            case 'gte': condition = sql`${workOrders.objectId} IN (${baseSubquery} AND ${numExpr} >= ${numVal})`; break;
            case 'lt': condition = sql`${workOrders.objectId} IN (${baseSubquery} AND ${numExpr} < ${numVal})`; break;
            case 'lte': condition = sql`${workOrders.objectId} IN (${baseSubquery} AND ${numExpr} <= ${numVal})`; break;
          }
          if (condition) searchConditions = and(searchConditions, condition);
        } else {
          const textExpr = sql`COALESCE(mv.varde_string, mv.varde_integer::text, mv.varde_decimal::text, mv.varde_boolean::text, mv.varde_referens, '')`;
          
          let condition;
          switch (mf.operator) {
            case 'eq': condition = sql`${workOrders.objectId} IN (${baseSubquery} AND ${textExpr} = ${mf.value})`; break;
            case 'neq': condition = sql`${workOrders.objectId} IN (${baseSubquery} AND ${textExpr} != ${mf.value})`; break;
            case 'contains': condition = sql`${workOrders.objectId} IN (${baseSubquery} AND ${textExpr} LIKE ${`%${mf.value}%`})`; break;
          }
          if (condition) searchConditions = and(searchConditions, condition);
        }
      }
    }
    
    // Get total count for current view (with status and search filters)
    const countResult = await db.select({ count: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(searchConditions);
    const total = countResult[0]?.count || 0;
    
    // Get status counts for ALL statuses (tab badges always show full picture)
    const statusCountsResult = await db.select({ 
      status: workOrders.orderStatus,
      count: sql<number>`count(*)::int`
    })
      .from(workOrders)
      .where(allStatusDateFiltered)
      .groupBy(workOrders.orderStatus);
    
    const byStatus: Record<string, number> = {};
    for (const row of statusCountsResult) {
      byStatus[row.status || 'skapad'] = row.count;
    }
    
    // Get aggregates for the full filtered dataset (without status filter, same as byStatus)
    const aggregatesResult = await db.select({
      totalValue: sql<number>`coalesce(sum(${workOrders.cachedValue}), 0)::numeric`,
      totalCost: sql<number>`coalesce(sum(${workOrders.cachedCost}), 0)::numeric`,
      totalProductionMinutes: sql<number>`coalesce(sum(${workOrders.cachedProductionMinutes}), 0)::int`
    })
      .from(workOrders)
      .where(dateFilteredConditions);
    
    const aggregates = {
      totalValue: Number(aggregatesResult[0]?.totalValue || 0),
      totalCost: Number(aggregatesResult[0]?.totalCost || 0),
      totalProductionMinutes: Number(aggregatesResult[0]?.totalProductionMinutes || 0)
    };
    
    // Build paginated query
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 50;
    const offset = (page - 1) * pageSize;
    
    const orders = await db.select().from(workOrders)
      .where(searchConditions)
      .orderBy(desc(workOrders.createdAt))
      .limit(pageSize)
      .offset(offset);
    
    return { orders, total, byStatus, aggregates };
  }

  // Price Resolution - implements the price list hierarchy
  async resolveArticlePrice(tenantId: string, articleId: string, customerId: string, date?: Date): Promise<{
    price: number;
    cost: number;
    productionMinutes: number;
    priceListId: string | null;
    source: 'rabattbrev' | 'kundunik' | 'generell' | 'listprice';
  }> {
    const resolveDate = date || new Date();
    
    // Get the article for fallback values
    const article = await this.getArticle(articleId);
    if (!article) {
      return { price: 0, cost: 0, productionMinutes: 0, priceListId: null, source: 'listprice' };
    }
    
    // Get all active price lists for this tenant, ordered by priority (highest first)
    const allPriceLists = await db.select().from(priceLists)
      .where(and(
        eq(priceLists.tenantId, tenantId),
        eq(priceLists.status, 'active'),
        isNull(priceLists.deletedAt),
        or(isNull(priceLists.validFrom), lte(priceLists.validFrom, resolveDate)),
        or(isNull(priceLists.validTo), gte(priceLists.validTo, resolveDate))
      ))
      .orderBy(desc(priceLists.priority));
    
    // Priority order: rabattbrev > kundunik > generell
    // 1. Try rabattbrev for this customer
    for (const pl of allPriceLists) {
      if (pl.priceListType === 'rabattbrev' && pl.customerId === customerId) {
        const [pla] = await db.select().from(priceListArticles)
          .where(and(eq(priceListArticles.priceListId, pl.id), eq(priceListArticles.articleId, articleId)));
        if (pla) {
          return {
            price: pla.price,
            cost: article.cost || 0,
            productionMinutes: pla.productionTime || article.productionTime || 0,
            priceListId: pl.id,
            source: 'rabattbrev'
          };
        }
        // If rabattbrev has discount percent, apply to listprice
        if (pl.discountPercent) {
          const discountedPrice = Math.round((article.listPrice || 0) * (100 - pl.discountPercent) / 100);
          return {
            price: discountedPrice,
            cost: article.cost || 0,
            productionMinutes: article.productionTime || 0,
            priceListId: pl.id,
            source: 'rabattbrev'
          };
        }
      }
    }
    
    // 2. Try kundunik for this customer
    for (const pl of allPriceLists) {
      if (pl.priceListType === 'kundunik' && pl.customerId === customerId) {
        const [pla] = await db.select().from(priceListArticles)
          .where(and(eq(priceListArticles.priceListId, pl.id), eq(priceListArticles.articleId, articleId)));
        if (pla) {
          return {
            price: pla.price,
            cost: article.cost || 0,
            productionMinutes: pla.productionTime || article.productionTime || 0,
            priceListId: pl.id,
            source: 'kundunik'
          };
        }
      }
    }
    
    // 3. Try generell price list
    for (const pl of allPriceLists) {
      if (pl.priceListType === 'generell') {
        const [pla] = await db.select().from(priceListArticles)
          .where(and(eq(priceListArticles.priceListId, pl.id), eq(priceListArticles.articleId, articleId)));
        if (pla) {
          return {
            price: pla.price,
            cost: article.cost || 0,
            productionMinutes: pla.productionTime || article.productionTime || 0,
            priceListId: pl.id,
            source: 'generell'
          };
        }
      }
    }
    
    // 4. Fallback to article list price
    return {
      price: article.listPrice || 0,
      cost: article.cost || 0,
      productionMinutes: article.productionTime || 0,
      priceListId: null,
      source: 'listprice'
    };
  }

  async resolveArticlePriceFromList(tenantId: string, articleId: string, priceListIdParam: string): Promise<{
    price: number;
    cost: number;
    productionMinutes: number;
    priceListId: string | null;
    source: string;
  }> {
    const article = await this.getArticle(articleId);
    if (!article) {
      return { price: 0, cost: 0, productionMinutes: 0, priceListId: null, source: 'listprice' };
    }

    const pl = await this.getPriceList(priceListIdParam);
    if (!pl || pl.tenantId !== tenantId || pl.status !== 'active' || pl.deletedAt) {
      return {
        price: article.listPrice || 0,
        cost: article.cost || 0,
        productionMinutes: article.productionTime || 0,
        priceListId: null,
        source: 'listprice'
      };
    }

    const [pla] = await db.select().from(priceListArticles)
      .where(and(eq(priceListArticles.priceListId, priceListIdParam), eq(priceListArticles.articleId, articleId)));

    if (pla) {
      return {
        price: pla.price,
        cost: article.cost || 0,
        productionMinutes: pla.productionTime || article.productionTime || 0,
        priceListId: priceListIdParam,
        source: 'prislista'
      };
    }

    if (pl.discountPercent) {
      const discountedPrice = Math.round((article.listPrice || 0) * (100 - pl.discountPercent) / 100);
      return {
        price: discountedPrice,
        cost: article.cost || 0,
        productionMinutes: article.productionTime || 0,
        priceListId: priceListIdParam,
        source: 'rabattbrev'
      };
    }

    return {
      price: article.listPrice || 0,
      cost: article.cost || 0,
      productionMinutes: article.productionTime || 0,
      priceListId: null,
      source: 'listprice'
    };
  }

  // Update work order status with timestamp handling
  async updateWorkOrderStatus(id: string, newStatus: OrderStatus): Promise<WorkOrder | undefined> {
    // Get current order to validate transition
    const currentOrder = await this.getWorkOrder(id);
    if (!currentOrder) return undefined;
    
    const currentStatus = (currentOrder.orderStatus || 'skapad') as OrderStatus;
    const terminalStatuses: OrderStatus[] = ['avbruten', 'omojlig'];
    const statusFlow: OrderStatus[] = ['skapad', 'planerad_pre', 'planerad_resurs', 'planerad_las', 'utford', 'fakturerad'];
    const currentIdx = statusFlow.indexOf(currentStatus);
    const newIdx = statusFlow.indexOf(newStatus);
    
    if (terminalStatuses.includes(currentStatus)) {
      throw new Error(`Cannot transition from terminal status ${currentStatus}`);
    }
    
    if (terminalStatuses.includes(newStatus)) {
    } else if (newStatus !== 'skapad' && (newIdx < 0 || newIdx > currentIdx + 1)) {
      throw new Error(`Invalid status transition from ${currentStatus} to ${newStatus}`);
    }
    
    const updates: Partial<InsertWorkOrder> = { orderStatus: newStatus };
    
    // Set appropriate timestamps based on status
    if (newStatus === 'planerad_las') {
      updates.lockedAt = new Date();
    } else if (newStatus === 'utford') {
      updates.completedAt = new Date();
    } else if (newStatus === 'fakturerad') {
      updates.invoicedAt = new Date();
    } else if (newStatus === 'skapad') {
      // Reset timestamps when reverting to skapad
      updates.lockedAt = null;
      updates.completedAt = null;
      updates.invoicedAt = null;
    }
    
    const [wo] = await db.update(workOrders).set(updates).where(eq(workOrders.id, id)).returning();
    if (wo?.tenantId) invalidateWorkflowCaches(wo.tenantId);

    // Task #558: när WO blir 'utford' → markera redo att fakturera.
    // markWorkOrderReadyForInvoice resolverar policy och sätter held/pending.
    // Fail-safe: bryter ALDRIG completion-flödet.
    if (wo && newStatus === 'utford' && wo.tenantId) {
      try {
        const { markWorkOrderReadyForInvoice } = await import("./services/invoice-consolidation");
        await markWorkOrderReadyForInvoice(wo.id, wo.tenantId).catch((err) => {
          console.warn(`[invoice-consolidation] markReady failed for wo=${wo.id}:`, err?.message ?? err);
        });
      } catch (err) {
        console.warn("[invoice-consolidation] import failed:", err);
      }
    }

    // Uppgiftslogik v1 (Fakturalås): när en fakturalåst WO blir terminal-icke-utförd
    // (avbruten/omöjlig) försvinner den ur det öppna segmentet — re-utvärdera gaten så
    // redan-utförda syskon kan släppas. Fail-safe: bryter ALDRIG status-flödet.
    if (wo && (newStatus === 'avbruten' || newStatus === 'omojlig') && wo.tenantId) {
      try {
        const { releaseSegmentGateIfComplete } = await import("./services/invoice-consolidation");
        await releaseSegmentGateIfComplete(wo.id, wo.tenantId).catch((err) => {
          console.warn(`[invoice-consolidation] segment-gate release failed for wo=${wo.id}:`, err?.message ?? err);
        });
      } catch (err) {
        console.warn("[invoice-consolidation] import failed:", err);
      }
    }

    // Task #421 Fas 0: skriv post_completion ML-snapshot vid utförd order.
    // Fail-safe: bryter ALDRIG completion-flödet. Fire-and-forget.
    if (wo && newStatus === 'utford' && wo.tenantId) {
      try {
        const [{ writeMlFeatureSnapshot }, objSrc] = await Promise.all([
          import("./services/mlFeatureSnapshot"),
          wo.objectId ? this.getObject(wo.objectId).catch(() => null) : Promise.resolve(null),
        ]);
        writeMlFeatureSnapshot({
          tenantId: wo.tenantId,
          workOrder: wo,
          object: objSrc ?? null,
          snapshotKind: "post_completion",
        }).catch(() => { /* non-blocking */ });
      } catch {
        // observability får aldrig stoppa completion
      }
    }

    return wo || undefined;
  }

  // Recalculate work order totals from lines
  async recalculateWorkOrderTotals(workOrderId: string): Promise<WorkOrder | undefined> {
    const lines = await this.getWorkOrderLines(workOrderId);
    
    let totalValue = 0;
    let totalCost = 0;
    let totalMinutes = 0;
    
    for (const line of lines) {
      if (!line.isOptional) {
        const qty = line.quantity || 1;
        totalValue += (line.resolvedPrice || 0) * qty;
        totalCost += (line.resolvedCost || 0) * qty;
        totalMinutes += (line.resolvedProductionMinutes || 0) * qty;
      }
    }
    
    const [wo] = await db.update(workOrders).set({
      cachedValue: totalValue,
      cachedCost: totalCost,
      cachedProductionMinutes: totalMinutes
    }).where(eq(workOrders.id, workOrderId)).returning();

    if (wo?.tenantId) {
      invalidateWorkflowCaches(wo.tenantId);
    }

    return wo || undefined;
  }

  // Recalculate work order totals for many orders at once.
  // Använder en enda CTE-baserad UPDATE så även 6000+ ordrar går på sub-sekund.
  // recalculated = antal ordrar som finns i db (alltså processade); changed = antal vars värden faktiskt ändrades.
  async recalculateWorkOrderTotalsBulk(workOrderIds: string[]): Promise<{ recalculated: number; changed: number }> {
    if (workOrderIds.length === 0) {
      return { recalculated: 0, changed: 0 };
    }

    // Postgres ROW-uttryck (som drivern bygger när vi passar JS-array) klarar max
    // 1664 entries per call. Vi chunkar i 500 åt gången så CTE:n blir snabb och säker.
    const CHUNK = 500;
    let totalChanged = 0;
    const tenantsTouched = new Set<string>();

    for (let i = 0; i < workOrderIds.length; i += CHUNK) {
      const chunk = workOrderIds.slice(i, i + CHUNK);
      try {
        const updated = await db.execute<{ id: string; tenant_id: string | null }>(sql`
          WITH new_totals AS (
            SELECT
              w.id,
              COALESCE(SUM(l.quantity * COALESCE(l.resolved_price, 0)), 0)::int AS new_value,
              COALESCE(SUM(l.quantity * COALESCE(l.resolved_cost, 0)), 0)::int AS new_cost,
              COALESCE(SUM(l.quantity * COALESCE(l.resolved_production_minutes, 0)), 0)::int AS new_minutes
            FROM ${workOrders} w
            LEFT JOIN ${workOrderLines} l
              ON l.work_order_id = w.id AND COALESCE(l.is_optional, false) = false
            WHERE w.id IN ${chunk}
            GROUP BY w.id
          )
          UPDATE ${workOrders} w
          SET cached_value = nt.new_value,
              cached_cost = nt.new_cost,
              cached_production_minutes = nt.new_minutes
          FROM new_totals nt
          WHERE w.id = nt.id
            AND (w.cached_value IS DISTINCT FROM nt.new_value
                 OR w.cached_cost IS DISTINCT FROM nt.new_cost
                 OR w.cached_production_minutes IS DISTINCT FROM nt.new_minutes)
          RETURNING w.id, w.tenant_id
        `);

        const rows = (updated as unknown as { rows?: Array<{ id: string; tenant_id: string | null }> }).rows
          ?? (updated as unknown as Array<{ id: string; tenant_id: string | null }>);
        const changedRows = Array.isArray(rows) ? rows : [];

        totalChanged += changedRows.length;
        for (const r of changedRows) {
          if (r.tenant_id) tenantsTouched.add(r.tenant_id);
        }
      } catch (err) {
        console.error(`[recalculateWorkOrderTotalsBulk] CTE chunk failed (chunk ${i / CHUNK + 1}), fallback per-order:`, err);
        for (const id of chunk) {
          try {
            const before = await db.select({
              cachedValue: workOrders.cachedValue,
              cachedCost: workOrders.cachedCost,
              cachedProductionMinutes: workOrders.cachedProductionMinutes,
            }).from(workOrders).where(eq(workOrders.id, id));
            const wo = await this.recalculateWorkOrderTotals(id);
            if (wo) {
              if (wo.tenantId) tenantsTouched.add(wo.tenantId);
              if (
                (before[0]?.cachedValue || 0) !== (wo.cachedValue || 0) ||
                (before[0]?.cachedCost || 0) !== (wo.cachedCost || 0) ||
                (before[0]?.cachedProductionMinutes || 0) !== (wo.cachedProductionMinutes || 0)
              ) {
                totalChanged++;
              }
            }
          } catch (innerErr) {
            console.error(`[recalculateWorkOrderTotalsBulk] per-order fallback failed for ${id}:`, innerErr);
          }
        }
      }
    }

    for (const tenantId of tenantsTouched) {
      invalidateWorkflowCaches(tenantId);
    }

    return { recalculated: workOrderIds.length, changed: totalChanged };
  }

  // ============== VEHICLES ==============
  async getVehicles(tenantId: string): Promise<Vehicle[]> {
    return db.select().from(vehicles).where(and(eq(vehicles.tenantId, tenantId), isNull(vehicles.deletedAt)));
  }

  async getVehicle(id: string): Promise<Vehicle | undefined> {
    const [vehicle] = await db.select().from(vehicles).where(and(eq(vehicles.id, id), isNull(vehicles.deletedAt)));
    return vehicle || undefined;
  }

  async createVehicle(vehicle: InsertVehicle): Promise<Vehicle> {
    const [v] = await db.insert(vehicles).values(vehicle).returning();
    return v;
  }

  async updateVehicle(id: string, data: Partial<InsertVehicle>): Promise<Vehicle | undefined> {
    const [v] = await db.update(vehicles).set(data).where(eq(vehicles.id, id)).returning();
    return v || undefined;
  }

  async deleteVehicle(id: string): Promise<void> {
    await db.update(vehicles).set({ deletedAt: new Date() }).where(eq(vehicles.id, id));
  }

  // ============== EQUIPMENT ==============
  async getEquipment(tenantId: string): Promise<Equipment[]> {
    return db.select().from(equipment).where(and(eq(equipment.tenantId, tenantId), isNull(equipment.deletedAt)));
  }

  async getEquipmentById(id: string): Promise<Equipment | undefined> {
    const [eq_item] = await db.select().from(equipment).where(and(eq(equipment.id, id), isNull(equipment.deletedAt)));
    return eq_item || undefined;
  }

  async createEquipment(eq_data: InsertEquipment): Promise<Equipment> {
    const [e] = await db.insert(equipment).values(eq_data).returning();
    return e;
  }

  async updateEquipment(id: string, data: Partial<InsertEquipment>): Promise<Equipment | undefined> {
    const [e] = await db.update(equipment).set(data).where(eq(equipment.id, id)).returning();
    return e || undefined;
  }

  async deleteEquipment(id: string): Promise<void> {
    await db.update(equipment).set({ deletedAt: new Date() }).where(eq(equipment.id, id));
  }

  // ============== RESOURCE VEHICLES ==============
  async getResourceVehicles(resourceId: string): Promise<ResourceVehicle[]> {
    return db.select().from(resourceVehicles).where(eq(resourceVehicles.resourceId, resourceId));
  }

  async getResourceVehiclesByResourceIds(resourceIds: string[]): Promise<ResourceVehicle[]> {
    if (resourceIds.length === 0) return [];
    return db.select().from(resourceVehicles).where(inArray(resourceVehicles.resourceId, resourceIds));
  }

  async getResourceVehicle(id: string): Promise<ResourceVehicle | undefined> {
    const [rv] = await db.select().from(resourceVehicles).where(eq(resourceVehicles.id, id));
    return rv || undefined;
  }

  async createResourceVehicle(rv: InsertResourceVehicle): Promise<ResourceVehicle> {
    const [result] = await db.insert(resourceVehicles).values(rv).returning();
    return result;
  }

  async updateResourceVehicle(id: string, data: Partial<InsertResourceVehicle>): Promise<ResourceVehicle | undefined> {
    const [result] = await db.update(resourceVehicles).set(data).where(eq(resourceVehicles.id, id)).returning();
    return result || undefined;
  }

  async deleteResourceVehicle(id: string): Promise<void> {
    await db.delete(resourceVehicles).where(eq(resourceVehicles.id, id));
  }

  // ============== RESOURCE EQUIPMENT ==============
  async getResourceEquipment(resourceId: string): Promise<ResourceEquipment[]> {
    return db.select().from(resourceEquipment).where(eq(resourceEquipment.resourceId, resourceId));
  }

  async getResourceEquipmentById(id: string): Promise<ResourceEquipment | undefined> {
    const [re] = await db.select().from(resourceEquipment).where(eq(resourceEquipment.id, id));
    return re || undefined;
  }

  async createResourceEquipment(re: InsertResourceEquipment): Promise<ResourceEquipment> {
    const [result] = await db.insert(resourceEquipment).values(re).returning();
    return result;
  }

  async updateResourceEquipment(id: string, data: Partial<InsertResourceEquipment>): Promise<ResourceEquipment | undefined> {
    const [result] = await db.update(resourceEquipment).set(data).where(eq(resourceEquipment.id, id)).returning();
    return result || undefined;
  }

  async deleteResourceEquipment(id: string): Promise<void> {
    await db.delete(resourceEquipment).where(eq(resourceEquipment.id, id));
  }

  // ============== RESOURCE AVAILABILITY ==============
  async getResourceAvailability(resourceId: string): Promise<ResourceAvailability[]> {
    return db.select().from(resourceAvailability).where(eq(resourceAvailability.resourceId, resourceId));
  }

  async getResourceAvailabilityById(id: string): Promise<ResourceAvailability | undefined> {
    const [ra] = await db.select().from(resourceAvailability).where(eq(resourceAvailability.id, id));
    return ra || undefined;
  }

  async createResourceAvailability(ra: InsertResourceAvailability): Promise<ResourceAvailability> {
    const [result] = await db.insert(resourceAvailability).values(ra).returning();
    return result;
  }

  async updateResourceAvailability(id: string, data: Partial<InsertResourceAvailability>): Promise<ResourceAvailability | undefined> {
    const [result] = await db.update(resourceAvailability).set(data).where(eq(resourceAvailability.id, id)).returning();
    return result || undefined;
  }

  async deleteResourceAvailability(id: string): Promise<void> {
    await db.delete(resourceAvailability).where(eq(resourceAvailability.id, id));
  }

  async getResourceAvailabilityByTenant(tenantId: string): Promise<ResourceAvailability[]> {
    return db.select().from(resourceAvailability).where(eq(resourceAvailability.tenantId, tenantId));
  }

  // ============== VEHICLE SCHEDULE ==============
  async getVehicleSchedule(vehicleId: string): Promise<VehicleSchedule[]> {
    return db.select().from(vehicleSchedule).where(eq(vehicleSchedule.vehicleId, vehicleId));
  }

  async getVehicleScheduleById(id: string): Promise<VehicleSchedule | undefined> {
    const [vs] = await db.select().from(vehicleSchedule).where(eq(vehicleSchedule.id, id));
    return vs || undefined;
  }

  async createVehicleSchedule(vs: InsertVehicleSchedule): Promise<VehicleSchedule> {
    const [result] = await db.insert(vehicleSchedule).values(vs).returning();
    return result;
  }

  async updateVehicleSchedule(id: string, data: Partial<InsertVehicleSchedule>): Promise<VehicleSchedule | undefined> {
    const [result] = await db.update(vehicleSchedule).set(data).where(eq(vehicleSchedule.id, id)).returning();
    return result || undefined;
  }

  async deleteVehicleSchedule(id: string): Promise<void> {
    await db.delete(vehicleSchedule).where(eq(vehicleSchedule.id, id));
  }

  async getVehicleSchedulesByTenant(tenantId: string): Promise<VehicleSchedule[]> {
    return db.select().from(vehicleSchedule).where(eq(vehicleSchedule.tenantId, tenantId));
  }

  // ============== PLANNING DECISION LOG ==============
  async createPlanningDecisionLog(log: {
    tenantId: string;
    userId?: string;
    weekStart: string;
    weekEnd: string;
    summary: unknown;
    moveCount: number;
    violationCount: number;
    riskScore: number;
    totalOrdersScheduled: number;
  }): Promise<void> {
    await db.insert(planningDecisionLog).values(log);
  }

  // ============== SUBSCRIPTIONS ==============
  async getSubscriptions(tenantId: string): Promise<Subscription[]> {
    return db.select().from(subscriptions).where(and(eq(subscriptions.tenantId, tenantId), isNull(subscriptions.deletedAt)));
  }

  async getSubscription(id: string): Promise<Subscription | undefined> {
    const [sub] = await db.select().from(subscriptions).where(and(eq(subscriptions.id, id), isNull(subscriptions.deletedAt)));
    return sub || undefined;
  }

  async createSubscription(sub: InsertSubscription): Promise<Subscription> {
    const [result] = await db.insert(subscriptions).values(sub).returning();
    return result;
  }

  async updateSubscription(id: string, data: Partial<InsertSubscription>): Promise<Subscription | undefined> {
    const [result] = await db.update(subscriptions).set(data).where(eq(subscriptions.id, id)).returning();
    return result || undefined;
  }

  async deleteSubscription(id: string): Promise<void> {
    await db.update(subscriptions).set({ deletedAt: new Date() }).where(eq(subscriptions.id, id));
  }

  // ============== TEAMS ==============
  async getTeams(tenantId: string): Promise<Team[]> {
    return db.select().from(teams).where(and(eq(teams.tenantId, tenantId), isNull(teams.deletedAt)));
  }

  async getTaskTypes(tenantId: string): Promise<TaskType[]> {
    return db
      .select()
      .from(taskTypes)
      .where(and(eq(taskTypes.tenantId, tenantId), eq(taskTypes.isActive, true)))
      .orderBy(taskTypes.sortOrder, taskTypes.label);
  }

  async getTeam(id: string): Promise<Team | undefined> {
    const [team] = await db.select().from(teams).where(and(eq(teams.id, id), isNull(teams.deletedAt)));
    return team || undefined;
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    const [result] = await db.insert(teams).values(team).returning();
    if (result?.tenantId) invalidateTeamInferenceCache(result.tenantId);
    return result;
  }

  async updateTeam(id: string, data: Partial<InsertTeam>): Promise<Team | undefined> {
    const [result] = await db.update(teams).set(data).where(eq(teams.id, id)).returning();
    if (result?.tenantId) invalidateTeamInferenceCache(result.tenantId);
    return result || undefined;
  }

  async deleteTeam(id: string): Promise<void> {
    const [team] = await db.select({ tenantId: teams.tenantId }).from(teams).where(eq(teams.id, id)).limit(1);
    await db.update(teams).set({ deletedAt: new Date() }).where(eq(teams.id, id));
    if (team?.tenantId) invalidateTeamInferenceCache(team.tenantId);
  }

  // ============== TEAM MEMBERS ==============
  async getAllTeamMembers(tenantId: string): Promise<TeamMember[]> {
    return db.select().from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(and(eq(teams.tenantId, tenantId), isNull(teams.deletedAt)))
      .then(rows => rows.map(r => r.team_members));
  }

  async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    return db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
  }

  // Individuella avvikelser i team (Task #1241) — läsande aggregat, se
  // computeTeamMemberDeviations i weeklyPlanEngine.ts för definitionen.
  async getTeamDeviationsForWeek(tenantId: string, teamId: string, weekStart: Date, weekEnd: Date, isoYear: number, isoWeek: number) {
    const [team] = await db.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)));
    if (!team) return undefined;

    const [membersRaw, weekOrders, plans] = await Promise.all([
      db.select({ resourceId: teamMembers.resourceId, resourceName: resources.name })
        .from(teamMembers)
        .innerJoin(resources, eq(teamMembers.resourceId, resources.id))
        .where(and(eq(teamMembers.teamId, teamId), isNotNull(teamMembers.acceptedAt))),
      db.select({
        id: workOrders.id,
        resourceId: workOrders.resourceId,
        title: workOrders.title,
        scheduledDate: workOrders.scheduledDate,
        estimatedDuration: workOrders.estimatedDuration,
      }).from(workOrders)
        .where(and(
          eq(workOrders.tenantId, tenantId),
          eq(workOrders.teamId, teamId),
          isNotNull(workOrders.resourceId),
          gte(workOrders.scheduledDate, weekStart),
          lte(workOrders.scheduledDate, weekEnd),
        )),
      db.select().from(weeklyPlans).where(and(
        eq(weeklyPlans.tenantId, tenantId),
        eq(weeklyPlans.teamId, teamId),
        eq(weeklyPlans.year, isoYear),
        eq(weeklyPlans.weekNumber, isoWeek),
      )),
    ]);

    const plan = plans[0];
    const [teamPersonalTasks, travelEntries] = plan
      ? await Promise.all([
          db.select().from(personalTasks).where(and(eq(personalTasks.tenantId, tenantId), eq(personalTasks.weeklyPlanId, plan.id))),
          db.select().from(travelTimeEntries).where(and(eq(travelTimeEntries.tenantId, tenantId), eq(travelTimeEntries.weeklyPlanId, plan.id))),
        ])
      : [[], []];

    const taskIds = travelEntries.flatMap((e) => [e.fromTaskId, e.toTaskId]).filter((id): id is string => !!id);
    const workOrderResourceMap = new Map<string, string | null>();
    if (taskIds.length > 0) {
      const relatedOrders = await db.select({ id: workOrders.id, resourceId: workOrders.resourceId })
        .from(workOrders)
        .where(and(eq(workOrders.tenantId, tenantId), inArray(workOrders.id, taskIds)));
      for (const o of relatedOrders) workOrderResourceMap.set(o.id, o.resourceId);
    }

    // Individuell frånvaro per medlem (semester/sjuk/utbildning/annat) kommer från
    // resource_availability — den enda platsen i modellen där en avvikelse redan är
    // knuten till en specifik resurs, snarare än teamet i stort.
    const memberResourceIds = membersRaw.map((m) => m.resourceId);
    const memberAbsences = memberResourceIds.length > 0
      ? await db.select().from(resourceAvailability)
          .where(and(
            eq(resourceAvailability.tenantId, tenantId),
            inArray(resourceAvailability.resourceId, memberResourceIds),
            eq(resourceAvailability.isAvailable, false),
            gte(resourceAvailability.date, weekStart),
            lte(resourceAvailability.date, weekEnd),
          ))
      : [];

    const { computeTeamMemberDeviations } = await import("./planning/weeklyPlanEngine");
    return computeTeamMemberDeviations(
      teamId,
      membersRaw,
      weekOrders,
      teamPersonalTasks,
      travelEntries,
      workOrderResourceMap,
      memberAbsences,
    );
  }

  // Task #991: Enhetlig läsmodell för utförarregistret. Aggregerar (utan att fysiskt
  // slå ihop tabeller) personer, fordon/utrustning och team till en hierarkisk vy där
  // team är grupperande förälder. Kostnadsställe + projekt exponeras enhetligt per nod.
  async getExecutorRegister(tenantId: string): Promise<ExecutorRegister> {
    const [allResources, allTeams, allMembers, allVehicles, allEquipment] = await Promise.all([
      this.getResources(tenantId),
      this.getTeams(tenantId),
      this.getAllTeamMembers(tenantId),
      this.getVehicles(tenantId),
      this.getEquipment(tenantId),
    ]);

    const resourceIds = allResources.map(r => r.id);
    const [allResVehicles, allResEquipment] = await Promise.all([
      this.getResourceVehiclesByResourceIds(resourceIds),
      resourceIds.length === 0
        ? Promise.resolve([] as ResourceEquipment[])
        : db.select().from(resourceEquipment).where(inArray(resourceEquipment.resourceId, resourceIds)),
    ]);

    const vehicleById = new Map(allVehicles.map(v => [v.id, v]));
    const equipmentById = new Map(allEquipment.map(e => [e.id, e]));

    const toVehicleAsset = (v: Vehicle, linkId: string | null = null): ExecutorRegisterAsset => ({
      id: v.id,
      name: v.name,
      kind: "vehicle",
      identifier: v.registrationNumber ?? null,
      costCenter: v.costCenter ?? null,
      status: v.status ?? null,
      linkId,
    });
    const toEquipmentAsset = (e: Equipment, linkId: string | null = null): ExecutorRegisterAsset => ({
      id: e.id,
      name: e.name,
      kind: "equipment",
      identifier: e.inventoryNumber ?? null,
      costCenter: e.costCenter ?? null,
      status: e.status ?? null,
      linkId,
    });

    // Resurs -> kopplade fordon/utrustning (linkId = resource_vehicles/-equipment-radens id)
    const vehiclesByResource = new Map<string, ExecutorRegisterAsset[]>();
    for (const rv of allResVehicles) {
      const v = vehicleById.get(rv.vehicleId);
      if (!v) continue;
      const arr = vehiclesByResource.get(rv.resourceId) ?? [];
      arr.push(toVehicleAsset(v, rv.id));
      vehiclesByResource.set(rv.resourceId, arr);
    }
    const equipmentByResource = new Map<string, ExecutorRegisterAsset[]>();
    for (const re of allResEquipment) {
      const e = equipmentById.get(re.equipmentId);
      if (!e) continue;
      const arr = equipmentByResource.get(re.resourceId) ?? [];
      arr.push(toEquipmentAsset(e, re.id));
      equipmentByResource.set(re.resourceId, arr);
    }

    const resourceById = new Map(allResources.map(r => [r.id, r]));
    const buildPerson = (
      resourceId: string,
      teamRole: string | null,
      membershipId: string | null,
    ): ExecutorRegisterPerson | null => {
      const r = resourceById.get(resourceId);
      if (!r) return null;
      return {
        id: r.id,
        name: r.name,
        teamRole,
        status: r.status ?? null,
        costCenter: r.costCenter ?? null,
        projectCode: r.projectCode ?? null,
        membershipId,
        vehicles: vehiclesByResource.get(r.id) ?? [],
        equipment: equipmentByResource.get(r.id) ?? [],
      };
    };

    // Team -> medlemmar (+ aggregerade fordon/utrustning)
    const membersByTeam = new Map<string, TeamMember[]>();
    const assignedResourceIds = new Set<string>();
    for (const tm of allMembers) {
      assignedResourceIds.add(tm.resourceId);
      const arr = membersByTeam.get(tm.teamId) ?? [];
      arr.push(tm);
      membersByTeam.set(tm.teamId, arr);
    }

    const teamsOut: ExecutorRegisterTeam[] = allTeams.map(team => {
      const members = (membersByTeam.get(team.id) ?? [])
        .map(tm => buildPerson(tm.resourceId, tm.role ?? null, tm.id))
        .filter((p): p is ExecutorRegisterPerson => p !== null);

      // Aggregera medlemmarnas fordon/utrustning (deduplicerat) under teamet.
      const teamVehicles = new Map<string, ExecutorRegisterAsset>();
      const teamEquipment = new Map<string, ExecutorRegisterAsset>();
      for (const m of members) {
        for (const v of m.vehicles) teamVehicles.set(v.id, v);
        for (const e of m.equipment) teamEquipment.set(e.id, e);
      }

      return {
        id: team.id,
        name: team.name,
        color: team.color ?? null,
        status: team.status ?? null,
        costCenter: team.costCenter ?? null,
        projectCode: team.projectCode ?? null,
        members,
        vehicles: Array.from(teamVehicles.values()),
        equipment: Array.from(teamEquipment.values()),
      };
    });

    const standalonePersons = allResources
      .filter(r => !assignedResourceIds.has(r.id))
      .map(r => buildPerson(r.id, null, null))
      .filter((p): p is ExecutorRegisterPerson => p !== null);

    const linkedVehicleIds = new Set(allResVehicles.map(rv => rv.vehicleId));
    const linkedEquipmentIds = new Set(allResEquipment.map(re => re.equipmentId));
    const unassignedVehicles = allVehicles.filter(v => !linkedVehicleIds.has(v.id)).map(toVehicleAsset);
    const unassignedEquipment = allEquipment.filter(e => !linkedEquipmentIds.has(e.id)).map(toEquipmentAsset);

    return { teams: teamsOut, standalonePersons, unassignedVehicles, unassignedEquipment };
  }

  async getTeamMember(id: string): Promise<TeamMember | undefined> {
    const [tm] = await db.select().from(teamMembers).where(eq(teamMembers.id, id));
    return tm || undefined;
  }

  async createTeamMember(tm: InsertTeamMember): Promise<TeamMember> {
    const [result] = await db.insert(teamMembers).values(tm).returning();
    // Rensa team-inferens-cachen för tenanten — slå upp via teams-relationen.
    if (result?.teamId) {
      const [team] = await db.select({ tenantId: teams.tenantId }).from(teams).where(eq(teams.id, result.teamId)).limit(1);
      if (team?.tenantId) invalidateTeamInferenceCache(team.tenantId);
    }
    return result;
  }

  async updateTeamMember(id: string, data: Partial<InsertTeamMember>): Promise<TeamMember | undefined> {
    const [result] = await db.update(teamMembers).set(data).where(eq(teamMembers.id, id)).returning();
    if (result?.teamId) {
      const [team] = await db.select({ tenantId: teams.tenantId }).from(teams).where(eq(teams.id, result.teamId)).limit(1);
      if (team?.tenantId) invalidateTeamInferenceCache(team.tenantId);
    }
    return result || undefined;
  }

  async deleteTeamMember(id: string): Promise<void> {
    // Slå upp tenantId via team innan radering så cachen kan invalideras.
    const [tm] = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.id, id)).limit(1);
    let tenantId: string | undefined;
    if (tm?.teamId) {
      const [team] = await db.select({ tenantId: teams.tenantId }).from(teams).where(eq(teams.id, tm.teamId)).limit(1);
      tenantId = team?.tenantId;
    }
    await db.delete(teamMembers).where(eq(teamMembers.id, id));
    if (tenantId) invalidateTeamInferenceCache(tenantId);
  }

  // ============== PLANNING PARAMETERS ==============
  async getPlanningParameters(tenantId: string): Promise<PlanningParameter[]> {
    return db.select().from(planningParameters).where(eq(planningParameters.tenantId, tenantId));
  }

  async getPlanningParameter(id: string): Promise<PlanningParameter | undefined> {
    const [pp] = await db.select().from(planningParameters).where(eq(planningParameters.id, id));
    return pp || undefined;
  }

  async createPlanningParameter(pp: InsertPlanningParameter): Promise<PlanningParameter> {
    const [result] = await db.insert(planningParameters).values(pp).returning();
    return result;
  }

  async updatePlanningParameter(id: string, data: Partial<InsertPlanningParameter>): Promise<PlanningParameter | undefined> {
    const [result] = await db.update(planningParameters).set(data).where(eq(planningParameters.id, id)).returning();
    return result || undefined;
  }

  async deletePlanningParameter(id: string): Promise<void> {
    await db.delete(planningParameters).where(eq(planningParameters.id, id));
  }

  // System Dashboard - Branding Templates
  async getBrandingTemplates(): Promise<BrandingTemplate[]> {
    return db.select().from(brandingTemplates).orderBy(brandingTemplates.name);
  }

  async getBrandingTemplate(id: string): Promise<BrandingTemplate | undefined> {
    const [template] = await db.select().from(brandingTemplates).where(eq(brandingTemplates.id, id));
    return template || undefined;
  }

  async getBrandingTemplateBySlug(slug: string): Promise<BrandingTemplate | undefined> {
    const [template] = await db.select().from(brandingTemplates).where(eq(brandingTemplates.slug, slug));
    return template || undefined;
  }

  async createBrandingTemplate(template: InsertBrandingTemplate): Promise<BrandingTemplate> {
    const [result] = await db.insert(brandingTemplates).values(template).returning();
    return result;
  }

  async updateBrandingTemplate(id: string, data: Partial<InsertBrandingTemplate>): Promise<BrandingTemplate | undefined> {
    const [result] = await db.update(brandingTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(brandingTemplates.id, id))
      .returning();
    return result || undefined;
  }

  async deleteBrandingTemplate(id: string): Promise<void> {
    await db.delete(brandingTemplates).where(eq(brandingTemplates.id, id));
  }

  async incrementTemplateUsage(id: string): Promise<void> {
    await db.update(brandingTemplates)
      .set({ usageCount: sql`COALESCE(usage_count, 0) + 1` })
      .where(eq(brandingTemplates.id, id));
  }

  // System Dashboard - Tenant Branding
  async getTenantBranding(tenantId: string): Promise<TenantBranding | undefined> {
    const [branding] = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId));
    return branding || undefined;
  }

  async createTenantBranding(branding: InsertTenantBranding): Promise<TenantBranding> {
    const [result] = await db.insert(tenantBranding).values(branding).returning();
    return result;
  }

  async updateTenantBranding(tenantId: string, data: Partial<InsertTenantBranding>): Promise<TenantBranding | undefined> {
    const existing = await this.getTenantBranding(tenantId);
    if (!existing) return undefined;
    
    const [result] = await db.update(tenantBranding)
      .set({ 
        ...data, 
        version: (existing.version || 1) + 1,
        updatedAt: new Date() 
      })
      .where(eq(tenantBranding.tenantId, tenantId))
      .returning();
    return result || undefined;
  }

  async publishTenantBranding(tenantId: string): Promise<TenantBranding | undefined> {
    const [result] = await db.update(tenantBranding)
      .set({ 
        isPublished: true, 
        publishedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(tenantBranding.tenantId, tenantId))
      .returning();
    return result || undefined;
  }

  // System Dashboard - User Tenant Roles
  async getUserTenantRoles(tenantId: string): Promise<(UserTenantRole & { user: User | null })[]> {
    const roles = await db.select({
      id: userTenantRoles.id,
      userId: userTenantRoles.userId,
      tenantId: userTenantRoles.tenantId,
      role: userTenantRoles.role,
      permissions: userTenantRoles.permissions,
      isActive: userTenantRoles.isActive,
      assignedBy: userTenantRoles.assignedBy,
      createdAt: userTenantRoles.createdAt,
      updatedAt: userTenantRoles.updatedAt,
      user: {
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        createdAt: users.createdAt,
      }
    })
    .from(userTenantRoles)
    .leftJoin(users, eq(userTenantRoles.userId, users.id))
    .where(eq(userTenantRoles.tenantId, tenantId))
    .orderBy(userTenantRoles.role);
    
    return roles.map(r => ({
      ...r,
      user: r.user?.id ? r.user as User : null
    }));
  }

  async getUserTenantRole(userId: string, tenantId: string): Promise<UserTenantRole | undefined> {
    const [role] = await db.select()
      .from(userTenantRoles)
      .where(and(eq(userTenantRoles.userId, userId), eq(userTenantRoles.tenantId, tenantId)));
    return role || undefined;
  }

  async getUserRolesForUser(userId: string): Promise<UserTenantRole[]> {
    return db.select().from(userTenantRoles).where(eq(userTenantRoles.userId, userId));
  }

  async createUserTenantRole(role: InsertUserTenantRole): Promise<UserTenantRole> {
    const [result] = await db.insert(userTenantRoles).values(role).returning();
    return result;
  }

  async updateUserTenantRole(id: string, data: Partial<InsertUserTenantRole>): Promise<UserTenantRole | undefined> {
    const [result] = await db.update(userTenantRoles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userTenantRoles.id, id))
      .returning();
    return result || undefined;
  }

  async deleteUserTenantRole(id: string): Promise<void> {
    await db.delete(userTenantRoles).where(eq(userTenantRoles.id, id));
  }

  async isOwner(userId: string, tenantId: string): Promise<boolean> {
    const role = await this.getUserTenantRole(userId, tenantId);
    return role?.role === "owner" && role?.isActive === true;
  }

  // System Dashboard - Audit Logs
  async getAuditLogs(tenantId: string, options?: { limit?: number; offset?: number; action?: string; userId?: string; resourceType?: string; resourceId?: string }): Promise<AuditLog[]> {
    const conditions = [eq(auditLogs.tenantId, tenantId)];
    
    if (options?.action) {
      conditions.push(eq(auditLogs.action, options.action));
    }
    if (options?.userId) {
      conditions.push(eq(auditLogs.userId, options.userId));
    }
    if (options?.resourceType) {
      conditions.push(eq(auditLogs.resourceType, options.resourceType));
    }
    if (options?.resourceId) {
      conditions.push(eq(auditLogs.resourceId, options.resourceId));
    }
    
    let query = db.select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt));
    
    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }
    
    return query;
  }

  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [result] = await db.insert(auditLogs).values(log).returning();
    return result;
  }

  // Task #511: GDPR-retention för audit_logs. Login-händelser (action LIKE 'auth.login%')
  // rensas vid sin egen tröskel; övriga audit-rader rensas vid en (oftast längre) tröskel.
  async deleteOldAuditLogs(opts: { loginOlderThanDays: number; otherOlderThanDays: number }): Promise<{ loginDeleted: number; otherDeleted: number }> {
    const loginDays = Math.max(1, Math.floor(opts.loginOlderThanDays));
    const otherDays = Math.max(1, Math.floor(opts.otherOlderThanDays));

    const loginRes = await db.execute(sql`
      DELETE FROM audit_logs
      WHERE action LIKE 'auth.login%'
        AND created_at < NOW() - (${loginDays} || ' days')::interval
    `);
    const otherRes = await db.execute(sql`
      DELETE FROM audit_logs
      WHERE action NOT LIKE 'auth.login%'
        AND created_at < NOW() - (${otherDays} || ' days')::interval
    `);

    return {
      loginDeleted: asExecuteResult(loginRes).rowCount ?? 0,
      otherDeleted: asExecuteResult(otherRes).rowCount ?? 0,
    };
  }

  // Industry Packages
  async getIndustryPackages(): Promise<IndustryPackage[]> {
    return db.select().from(industryPackages).where(eq(industryPackages.isActive, true));
  }

  async getIndustryPackage(id: string): Promise<IndustryPackage | undefined> {
    const [result] = await db.select().from(industryPackages).where(eq(industryPackages.id, id));
    return result || undefined;
  }

  async getIndustryPackageBySlug(slug: string): Promise<IndustryPackage | undefined> {
    const [result] = await db.select().from(industryPackages).where(eq(industryPackages.slug, slug));
    return result || undefined;
  }

  async createIndustryPackage(pkg: InsertIndustryPackage): Promise<IndustryPackage> {
    const [result] = await db.insert(industryPackages).values(pkg).returning();
    return result;
  }

  async getIndustryPackageData(packageId: string): Promise<IndustryPackageData[]> {
    return db.select().from(industryPackageData).where(eq(industryPackageData.packageId, packageId));
  }

  async createIndustryPackageData(data: InsertIndustryPackageData): Promise<IndustryPackageData> {
    const [result] = await db.insert(industryPackageData).values(data).returning();
    return result;
  }

  async getTenantPackageInstallations(tenantId: string): Promise<TenantPackageInstallation[]> {
    return db.select().from(tenantPackageInstallations)
      .where(eq(tenantPackageInstallations.tenantId, tenantId))
      .orderBy(desc(tenantPackageInstallations.installedAt));
  }

  async createTenantPackageInstallation(installation: InsertTenantPackageInstallation): Promise<TenantPackageInstallation> {
    const [result] = await db.insert(tenantPackageInstallations).values(installation).returning();
    return result;
  }

  // Resource Position Tracking
  async updateResourcePosition(resourceId: string, position: { currentLatitude: number; currentLongitude: number; lastPositionUpdate: Date; trackingStatus: string }): Promise<Resource | undefined> {
    const [result] = await db.update(resources)
      .set({
        currentLatitude: position.currentLatitude,
        currentLongitude: position.currentLongitude,
        lastPositionUpdate: position.lastPositionUpdate,
        trackingStatus: position.trackingStatus
      })
      .where(eq(resources.id, resourceId))
      .returning();
    return result || undefined;
  }

  async createResourcePosition(position: InsertResourcePosition): Promise<ResourcePosition> {
    const [result] = await db.insert(resourcePositions).values(position).returning();
    return result;
  }

  async getResourcePositions(resourceId: string, startDate?: Date, endDate?: Date): Promise<ResourcePosition[]> {
    const conditions = [eq(resourcePositions.resourceId, resourceId)];
    
    if (startDate) {
      conditions.push(gte(resourcePositions.recordedAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(resourcePositions.recordedAt, endDate));
    }
    
    return db.select()
      .from(resourcePositions)
      .where(and(...conditions))
      .orderBy(resourcePositions.recordedAt);
  }

  async getActiveResourcePositions(tenantId: string): Promise<Resource[]> {
    // Get resources with recent position updates (within last 5 minutes) for a specific tenant
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return db.select()
      .from(resources)
      .where(and(
        eq(resources.tenantId, tenantId),
        isNull(resources.deletedAt),
        gte(resources.lastPositionUpdate, fiveMinutesAgo)
      ));
  }

  async getAllActiveResourcePositions(): Promise<Resource[]> {
    // Internal server use only: returns active positions across all tenants (e.g. anomaly monitoring)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return db.select()
      .from(resources)
      .where(and(
        isNull(resources.deletedAt),
        gte(resources.lastPositionUpdate, fiveMinutesAgo)
      ));
  }

  // Task #1292: Live-position per aktivt fältteam (utförarläge på kartan).
  // Returnerar alla aktiva team med accepterade medlemmar + den senast
  // rapporterade GPS-positionen bland teamets medlemmar (om någon finns).
  async getTeamLivePositions(tenantId: string): Promise<TeamLivePosition[]> {
    const rows = await db
      .select({
        teamId: teams.id,
        teamName: teams.name,
        teamColor: teams.color,
        resourceId: resources.id,
        resourceName: resources.name,
        latitude: resources.currentLatitude,
        longitude: resources.currentLongitude,
        trackingStatus: resources.trackingStatus,
        lastPositionUpdate: resources.lastPositionUpdate,
      })
      .from(teams)
      .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
      .innerJoin(resources, eq(teamMembers.resourceId, resources.id))
      .where(and(
        eq(teams.tenantId, tenantId),
        isNull(teams.deletedAt),
        eq(teams.status, "active"),
        isNotNull(teamMembers.acceptedAt),
        eq(resources.tenantId, tenantId),
        isNull(resources.deletedAt),
      ));

    const byTeam = new Map<string, TeamLivePosition>();
    for (const r of rows) {
      let entry = byTeam.get(r.teamId);
      if (!entry) {
        entry = { teamId: r.teamId, teamName: r.teamName, teamColor: r.teamColor ?? null, resourceIds: [], position: null, memberPositions: [] };
        byTeam.set(r.teamId, entry);
      }
      entry.resourceIds.push(r.resourceId);
      if (r.latitude != null && r.longitude != null && r.lastPositionUpdate != null) {
        const memberPos = {
          resourceId: r.resourceId,
          resourceName: r.resourceName,
          latitude: r.latitude,
          longitude: r.longitude,
          status: r.trackingStatus ?? null,
          lastUpdate: new Date(r.lastPositionUpdate).toISOString(),
        };
        entry.memberPositions.push(memberPos);
        const ts = new Date(r.lastPositionUpdate).getTime();
        const prev = entry.position;
        if (!prev || ts > new Date(prev.lastUpdate).getTime()) {
          entry.position = memberPos;
        }
      }
    }
    return Array.from(byTeam.values());
  }

  // Task #1298: Dagens färdväg (breadcrumb-spår) per team. Aggregerar
  // resource_positions för teamets accepterade medlemmar inom vald dag,
  // kronologiskt sorterat, tenant-scopat.
  async getTeamPositionTrails(tenantId: string, startDate: Date, endDate: Date): Promise<TeamPositionTrail[]> {
    const rows = await db
      .select({
        teamId: teams.id,
        teamName: teams.name,
        teamColor: teams.color,
        latitude: resourcePositions.latitude,
        longitude: resourcePositions.longitude,
        recordedAt: resourcePositions.recordedAt,
      })
      .from(teams)
      .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
      .innerJoin(resources, eq(teamMembers.resourceId, resources.id))
      .innerJoin(resourcePositions, eq(resourcePositions.resourceId, resources.id))
      .where(and(
        eq(teams.tenantId, tenantId),
        isNull(teams.deletedAt),
        eq(teams.status, "active"),
        isNotNull(teamMembers.acceptedAt),
        eq(resources.tenantId, tenantId),
        isNull(resources.deletedAt),
        gte(resourcePositions.recordedAt, startDate),
        lte(resourcePositions.recordedAt, endDate),
      ))
      .orderBy(resourcePositions.recordedAt);

    const byTeam = new Map<string, TeamPositionTrail>();
    for (const r of rows) {
      let entry = byTeam.get(r.teamId);
      if (!entry) {
        entry = { teamId: r.teamId, teamName: r.teamName, teamColor: r.teamColor ?? null, points: [] };
        byTeam.set(r.teamId, entry);
      }
      entry.points.push({
        latitude: r.latitude,
        longitude: r.longitude,
        recordedAt: new Date(r.recordedAt).toISOString(),
      });
    }
    return Array.from(byTeam.values());
  }

  // Fortnox Config
  async getFortnoxConfig(tenantId: string): Promise<FortnoxConfig | undefined> {
    const [config] = await db.select().from(fortnoxConfig).where(eq(fortnoxConfig.tenantId, tenantId));
    return config || undefined;
  }

  async createFortnoxConfig(config: InsertFortnoxConfig): Promise<FortnoxConfig> {
    const [result] = await db.insert(fortnoxConfig).values(config).returning();
    return result;
  }

  async updateFortnoxConfig(tenantId: string, data: Partial<InsertFortnoxConfig>): Promise<FortnoxConfig | undefined> {
    const [result] = await db.update(fortnoxConfig)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(fortnoxConfig.tenantId, tenantId))
      .returning();
    return result || undefined;
  }

  // Fortnox Mappings
  async getFortnoxMappings(tenantId: string, entityType?: string): Promise<FortnoxMapping[]> {
    const conditions = [eq(fortnoxMappings.tenantId, tenantId)];
    if (entityType) {
      conditions.push(eq(fortnoxMappings.entityType, entityType));
    }
    return db.select().from(fortnoxMappings).where(and(...conditions));
  }

  async getFortnoxMapping(tenantId: string, entityType: string, unicornId: string): Promise<FortnoxMapping | undefined> {
    const [mapping] = await db.select().from(fortnoxMappings)
      .where(and(
        eq(fortnoxMappings.tenantId, tenantId),
        eq(fortnoxMappings.entityType, entityType),
        eq(fortnoxMappings.unicornId, unicornId)
      ));
    return mapping || undefined;
  }

  async createFortnoxMapping(mapping: InsertFortnoxMapping): Promise<FortnoxMapping> {
    const [result] = await db.insert(fortnoxMappings).values(mapping).returning();
    return result;
  }

  async updateFortnoxMapping(id: string, tenantId: string, data: Partial<InsertFortnoxMapping>): Promise<FortnoxMapping | undefined> {
    const [result] = await db.update(fortnoxMappings)
      .set(data)
      .where(and(eq(fortnoxMappings.id, id), eq(fortnoxMappings.tenantId, tenantId)))
      .returning();
    return result || undefined;
  }

  async deleteFortnoxMapping(id: string, tenantId: string): Promise<void> {
    await db.delete(fortnoxMappings).where(and(eq(fortnoxMappings.id, id), eq(fortnoxMappings.tenantId, tenantId)));
  }

  async deleteFortnoxMappingsForEntity(
    entityType: "customer" | "article" | "resource",
    unicornId: string,
  ): Promise<number> {
    const result = await db
      .delete(fortnoxMappings)
      .where(and(eq(fortnoxMappings.entityType, entityType), eq(fortnoxMappings.unicornId, unicornId)))
      .returning({ id: fortnoxMappings.id });
    return Array.isArray(result) ? result.length : 0;
  }

  async cleanupOrphanFortnoxMappings(tenantId?: string): Promise<{ customer: number; article: number; resource: number; total: number }> {
    const tenantClause = tenantId ? sql`AND tenant_id = ${tenantId}` : sql``;
    const stats = { customer: 0, article: 0, resource: 0, total: 0 };

    const variants: Array<{ key: "customer" | "article" | "resource"; table: string }> = [
      { key: "customer", table: "customers" },
      { key: "article", table: "articles" },
      { key: "resource", table: "resources" },
    ];

    for (const v of variants) {
      const tenantTableClause = tenantId ? sql`AND tenant_id = ${tenantId}` : sql``;
      const r = await db.execute(sql`
        DELETE FROM fortnox_mappings
        WHERE entity_type = ${v.key}
          AND unicorn_id NOT IN (SELECT id FROM ${sql.raw(v.table)} WHERE 1=1 ${tenantTableClause})
          ${tenantClause}
      `);
      const n = Number(asExecuteResult(r).rowCount ?? 0);
      stats[v.key] = n;
      stats.total += n;
    }

    return stats;
  }

  // Fortnox Invoice Exports
  async getFortnoxInvoiceExports(tenantId: string, status?: string): Promise<FortnoxInvoiceExport[]> {
    const conditions = [eq(fortnoxInvoiceExports.tenantId, tenantId)];
    if (status) {
      conditions.push(eq(fortnoxInvoiceExports.status, status));
    }
    return db.select().from(fortnoxInvoiceExports).where(and(...conditions)).orderBy(desc(fortnoxInvoiceExports.createdAt));
  }

  async getFortnoxInvoiceExport(id: string): Promise<FortnoxInvoiceExport | undefined> {
    const [result] = await db.select().from(fortnoxInvoiceExports).where(eq(fortnoxInvoiceExports.id, id));
    return result || undefined;
  }

  async createFortnoxInvoiceExport(invoiceExport: InsertFortnoxInvoiceExport): Promise<FortnoxInvoiceExport> {
    const [result] = await db.insert(fortnoxInvoiceExports).values(invoiceExport).returning();
    return result;
  }

  async updateFortnoxInvoiceExport(id: string, tenantId: string, data: Partial<InsertFortnoxInvoiceExport>): Promise<FortnoxInvoiceExport | undefined> {
    const [result] = await db.update(fortnoxInvoiceExports)
      .set(data)
      .where(and(eq(fortnoxInvoiceExports.id, id), eq(fortnoxInvoiceExports.tenantId, tenantId)))
      .returning();
    return result || undefined;
  }

  async claimFortnoxInvoiceExportForProcessing(id: string, tenantId: string): Promise<FortnoxInvoiceExport | undefined> {
    // Task #1243: retryCount ska spegla verkliga OMFÖRSÖK (audit-UI:t visar
    // "antal omförsök"), inte det första försöket. Öka bara när statusen redan
    // var "failed" — dvs vi provar igen efter ett tidigare fel. Ett rent
    // förstaförsök (status="pending") lämnar retryCount vid sitt startvärde (0).
    const [result] = await db.update(fortnoxInvoiceExports)
      .set({
        status: "processing",
        retryCount: sql`CASE WHEN ${fortnoxInvoiceExports.status} = 'failed' THEN ${fortnoxInvoiceExports.retryCount} + 1 ELSE ${fortnoxInvoiceExports.retryCount} END`,
      })
      .where(and(
        eq(fortnoxInvoiceExports.id, id),
        eq(fortnoxInvoiceExports.tenantId, tenantId),
        inArray(fortnoxInvoiceExports.status, ["pending", "failed"]),
      ))
      .returning();
    return result || undefined;
  }

  async createFortnoxExportLogEntry(entry: InsertFortnoxExportLogEntry): Promise<FortnoxExportLogEntry> {
    const [result] = await db.insert(fortnoxExportLogEntries).values(entry).returning();
    return result;
  }

  async getFortnoxExportLogEntries(exportId: string, tenantId: string): Promise<FortnoxExportLogEntry[]> {
    return db.select().from(fortnoxExportLogEntries)
      .where(and(eq(fortnoxExportLogEntries.exportId, exportId), eq(fortnoxExportLogEntries.tenantId, tenantId)))
      .orderBy(fortnoxExportLogEntries.createdAt);
  }

  // ============================================
  // Manual Invoice Lines
  // ============================================

  async getManualInvoiceLines(tenantId: string, customerId?: string, status?: string): Promise<ManualInvoiceLine[]> {
    const conditions = [eq(manualInvoiceLines.tenantId, tenantId)];
    if (customerId) {
      conditions.push(eq(manualInvoiceLines.customerId, customerId));
    }
    if (status) {
      conditions.push(eq(manualInvoiceLines.status, status));
    }
    return db.select().from(manualInvoiceLines).where(and(...conditions)).orderBy(desc(manualInvoiceLines.createdAt));
  }

  async getManualInvoiceLine(id: string): Promise<ManualInvoiceLine | undefined> {
    const [result] = await db.select().from(manualInvoiceLines).where(eq(manualInvoiceLines.id, id));
    return result || undefined;
  }

  async createManualInvoiceLine(line: InsertManualInvoiceLine): Promise<ManualInvoiceLine> {
    const [result] = await db.insert(manualInvoiceLines).values(line).returning();
    return result;
  }

  async updateManualInvoiceLine(id: string, tenantId: string, data: Partial<InsertManualInvoiceLine>): Promise<ManualInvoiceLine | undefined> {
    const [result] = await db.update(manualInvoiceLines)
      .set(data)
      .where(and(eq(manualInvoiceLines.id, id), eq(manualInvoiceLines.tenantId, tenantId)))
      .returning();
    return result || undefined;
  }

  async deleteManualInvoiceLine(id: string, tenantId: string): Promise<void> {
    await db.delete(manualInvoiceLines)
      .where(and(eq(manualInvoiceLines.id, id), eq(manualInvoiceLines.tenantId, tenantId)));
  }

  // ============================================
  // Task Desired Timewindows
  // ============================================
  
  async getAllTaskTimewindows(tenantId: string): Promise<TaskDesiredTimewindow[]> {
    return db.select().from(taskDesiredTimewindows)
      .where(eq(taskDesiredTimewindows.tenantId, tenantId))
      .orderBy(taskDesiredTimewindows.priority);
  }

  async getTaskTimewindows(workOrderId: string): Promise<TaskDesiredTimewindow[]> {
    return db.select().from(taskDesiredTimewindows)
      .where(eq(taskDesiredTimewindows.workOrderId, workOrderId))
      .orderBy(taskDesiredTimewindows.priority);
  }

  async getTaskTimewindowsBatch(workOrderIds: string[]): Promise<Record<string, TaskDesiredTimewindow[]>> {
    if (workOrderIds.length === 0) return {};
    
    const allTimewindows = await db.select().from(taskDesiredTimewindows)
      .where(inArray(taskDesiredTimewindows.workOrderId, workOrderIds))
      .orderBy(taskDesiredTimewindows.priority);
    
    const result: Record<string, TaskDesiredTimewindow[]> = {};
    workOrderIds.forEach(id => { result[id] = []; });
    
    allTimewindows.forEach(tw => {
      if (!result[tw.workOrderId]) result[tw.workOrderId] = [];
      result[tw.workOrderId].push(tw);
    });
    
    return result;
  }

  async createTaskTimewindow(timewindow: InsertTaskDesiredTimewindow): Promise<TaskDesiredTimewindow> {
    const [result] = await db.insert(taskDesiredTimewindows).values(timewindow).returning();
    return result;
  }

  async updateTaskTimewindow(id: string, workOrderId: string, tenantId: string, data: Partial<InsertTaskDesiredTimewindow>): Promise<TaskDesiredTimewindow | undefined> {
    const [result] = await db.update(taskDesiredTimewindows)
      .set(data)
      .where(and(
        eq(taskDesiredTimewindows.id, id),
        eq(taskDesiredTimewindows.workOrderId, workOrderId),
        eq(taskDesiredTimewindows.tenantId, tenantId)
      ))
      .returning();
    return result || undefined;
  }

  async deleteTaskTimewindow(id: string, workOrderId: string, tenantId: string): Promise<void> {
    await db.delete(taskDesiredTimewindows).where(and(
      eq(taskDesiredTimewindows.id, id),
      eq(taskDesiredTimewindows.workOrderId, workOrderId),
      eq(taskDesiredTimewindows.tenantId, tenantId)
    ));
  }

  // ============================================
  // Task Dependencies
  // ============================================
  
  async getTaskDependencies(workOrderId: string): Promise<TaskDependency[]> {
    return db.select().from(taskDependencies)
      .where(eq(taskDependencies.workOrderId, workOrderId));
  }

  async getTaskDependents(workOrderId: string): Promise<TaskDependency[]> {
    return db.select().from(taskDependencies)
      .where(eq(taskDependencies.dependsOnWorkOrderId, workOrderId));
  }

  async getTaskDependenciesBatch(workOrderIds: string[]): Promise<{
    dependencies: Record<string, TaskDependency[]>;
    dependents: Record<string, TaskDependency[]>;
  }> {
    if (workOrderIds.length === 0) {
      return { dependencies: {}, dependents: {} };
    }
    
    const [allDependencies, allDependents] = await Promise.all([
      db.select().from(taskDependencies)
        .where(inArray(taskDependencies.workOrderId, workOrderIds)),
      db.select().from(taskDependencies)
        .where(inArray(taskDependencies.dependsOnWorkOrderId, workOrderIds))
    ]);
    
    const dependencies: Record<string, TaskDependency[]> = {};
    const dependents: Record<string, TaskDependency[]> = {};
    
    workOrderIds.forEach(id => {
      dependencies[id] = [];
      dependents[id] = [];
    });
    
    allDependencies.forEach(dep => {
      if (!dependencies[dep.workOrderId]) dependencies[dep.workOrderId] = [];
      dependencies[dep.workOrderId].push(dep);
    });
    
    allDependents.forEach(dep => {
      if (!dependents[dep.dependsOnWorkOrderId]) dependents[dep.dependsOnWorkOrderId] = [];
      dependents[dep.dependsOnWorkOrderId].push(dep);
    });
    
    return { dependencies, dependents };
  }

  async createTaskDependency(dependency: InsertTaskDependency): Promise<TaskDependency> {
    const [result] = await db.insert(taskDependencies).values(dependency).returning();
    return result;
  }

  async deleteTaskDependency(id: string, tenantId: string): Promise<void> {
    await db.delete(taskDependencies).where(and(
      eq(taskDependencies.id, id),
      eq(taskDependencies.tenantId, tenantId)
    ));
  }

  // ============================================
  // Task Information
  // ============================================
  
  async getTaskInformation(workOrderId: string): Promise<TaskInformation[]> {
    return db.select().from(taskInformation)
      .where(eq(taskInformation.workOrderId, workOrderId));
  }

  async createTaskInformation(info: InsertTaskInformation): Promise<TaskInformation> {
    const [result] = await db.insert(taskInformation).values(info).returning();
    return result;
  }

  async updateTaskInformation(id: string, workOrderId: string, tenantId: string, data: Partial<InsertTaskInformation>): Promise<TaskInformation | undefined> {
    const [result] = await db.update(taskInformation)
      .set(data)
      .where(and(
        eq(taskInformation.id, id),
        eq(taskInformation.workOrderId, workOrderId),
        eq(taskInformation.tenantId, tenantId)
      ))
      .returning();
    return result || undefined;
  }

  async deleteTaskInformation(id: string, workOrderId: string, tenantId: string): Promise<void> {
    await db.delete(taskInformation).where(and(
      eq(taskInformation.id, id),
      eq(taskInformation.workOrderId, workOrderId),
      eq(taskInformation.tenantId, tenantId)
    ));
  }

  // ============================================
  // Object Time Restrictions (C9)
  // ============================================

  // ============================================
  // Structural Articles
  // ============================================
  
  async getStructuralArticles(tenantId: string): Promise<StructuralArticle[]> {
    return db.select().from(structuralArticles)
      .where(eq(structuralArticles.tenantId, tenantId))
      .orderBy(structuralArticles.parentArticleId, structuralArticles.sequenceOrder);
  }

  async getStructuralArticlesByParent(parentArticleId: string): Promise<StructuralArticle[]> {
    return db.select().from(structuralArticles)
      .where(eq(structuralArticles.parentArticleId, parentArticleId))
      .orderBy(structuralArticles.sequenceOrder);
  }

  async createStructuralArticle(article: InsertStructuralArticle): Promise<StructuralArticle> {
    const [result] = await db.insert(structuralArticles).values(article).returning();
    return result;
  }

  async updateStructuralArticle(id: string, tenantId: string, data: Partial<InsertStructuralArticle>): Promise<StructuralArticle | undefined> {
    const [result] = await db.update(structuralArticles)
      .set(data)
      .where(and(
        eq(structuralArticles.id, id),
        eq(structuralArticles.tenantId, tenantId)
      ))
      .returning();
    return result || undefined;
  }

  async deleteStructuralArticle(id: string, tenantId: string): Promise<void> {
    await db.delete(structuralArticles).where(and(
      eq(structuralArticles.id, id),
      eq(structuralArticles.tenantId, tenantId)
    ));
  }

  // ============================================
  // Order Concepts
  // ============================================
  
  async getOrderConcepts(tenantId: string): Promise<OrderConcept[]> {
    return db.select().from(orderConcepts)
      .where(and(
        eq(orderConcepts.tenantId, tenantId),
        isNull(orderConcepts.deletedAt)
      ))
      .orderBy(desc(orderConcepts.createdAt));
  }

  async getOrderConcept(id: string): Promise<OrderConcept | undefined> {
    const [result] = await db.select().from(orderConcepts)
      .where(and(
        eq(orderConcepts.id, id),
        isNull(orderConcepts.deletedAt)
      ));
    return result || undefined;
  }

  async createOrderConcept(concept: InsertOrderConcept): Promise<OrderConcept> {
    const [result] = await db.insert(orderConcepts).values(concept).returning();
    return result;
  }

  async updateOrderConcept(id: string, tenantId: string, data: Partial<InsertOrderConcept>): Promise<OrderConcept | undefined> {
    const [result] = await db.update(orderConcepts)
      .set(data)
      .where(and(
        eq(orderConcepts.id, id),
        eq(orderConcepts.tenantId, tenantId),
        isNull(orderConcepts.deletedAt)
      ))
      .returning();
    return result || undefined;
  }

  async deleteOrderConcept(id: string, tenantId: string): Promise<void> {
    await db.update(orderConcepts)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(orderConcepts.id, id),
        eq(orderConcepts.tenantId, tenantId)
      ));
  }

  // ============================================
  // Concept Filters
  // ============================================
  
  async getConceptFilters(orderConceptId: string): Promise<ConceptFilter[]> {
    return db.select().from(conceptFilters)
      .where(eq(conceptFilters.orderConceptId, orderConceptId))
      .orderBy(desc(conceptFilters.priority));
  }

  async createConceptFilter(filter: InsertConceptFilter): Promise<ConceptFilter> {
    const [result] = await db.insert(conceptFilters).values(filter).returning();
    return result;
  }

  async updateConceptFilter(id: string, orderConceptId: string, data: Partial<InsertConceptFilter>): Promise<ConceptFilter | undefined> {
    const [result] = await db.update(conceptFilters)
      .set(data)
      .where(and(
        eq(conceptFilters.id, id),
        eq(conceptFilters.orderConceptId, orderConceptId)
      ))
      .returning();
    return result || undefined;
  }

  async deleteConceptFilter(id: string, orderConceptId: string): Promise<void> {
    await db.delete(conceptFilters).where(and(
      eq(conceptFilters.id, id),
      eq(conceptFilters.orderConceptId, orderConceptId)
    ));
  }

  // ============================================
  // ADR v3 (F3): Planner Search Filters
  // ============================================
  async getPlannerSearchFilters(tenantId: string, userId?: string): Promise<PlannerSearchFilter[]> {
    const visibility = userId
      ? or(
          eq(plannerSearchFilters.scope, "shared"),
          and(eq(plannerSearchFilters.scope, "personal"), eq(plannerSearchFilters.createdBy, userId))
        )
      : eq(plannerSearchFilters.scope, "shared");
    return db.select().from(plannerSearchFilters)
      .where(and(eq(plannerSearchFilters.tenantId, tenantId), visibility))
      .orderBy(desc(plannerSearchFilters.updatedAt));
  }

  async getPlannerSearchFilter(id: string, tenantId: string): Promise<PlannerSearchFilter | undefined> {
    const [row] = await db.select().from(plannerSearchFilters)
      .where(and(eq(plannerSearchFilters.id, id), eq(plannerSearchFilters.tenantId, tenantId)));
    return row || undefined;
  }

  async createPlannerSearchFilter(filter: InsertPlannerSearchFilter): Promise<PlannerSearchFilter> {
    const [row] = await db.insert(plannerSearchFilters).values(filter).returning();
    return row;
  }

  async updatePlannerSearchFilter(id: string, tenantId: string, data: Partial<InsertPlannerSearchFilter>): Promise<PlannerSearchFilter | undefined> {
    const [row] = await db.update(plannerSearchFilters)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(plannerSearchFilters.id, id), eq(plannerSearchFilters.tenantId, tenantId)))
      .returning();
    return row || undefined;
  }

  async deletePlannerSearchFilter(id: string, tenantId: string): Promise<void> {
    await db.delete(plannerSearchFilters)
      .where(and(eq(plannerSearchFilters.id, id), eq(plannerSearchFilters.tenantId, tenantId)));
  }

  // ============================================
  // ADR v3 (F4): Article Components (BOM)
  // ============================================
  async getArticleComponents(parentArticleId: string, tenantId: string): Promise<ArticleComponent[]> {
    return db.select().from(articleComponents)
      .where(and(
        eq(articleComponents.parentArticleId, parentArticleId),
        eq(articleComponents.tenantId, tenantId)
      ))
      .orderBy(articleComponents.sortOrder, articleComponents.createdAt);
  }

  async getArticleComponent(id: string, tenantId: string): Promise<ArticleComponent | undefined> {
    const [row] = await db.select().from(articleComponents)
      .where(and(eq(articleComponents.id, id), eq(articleComponents.tenantId, tenantId)));
    return row || undefined;
  }

  async createArticleComponent(component: InsertArticleComponent): Promise<ArticleComponent> {
    const [row] = await db.insert(articleComponents).values(component).returning();
    return row;
  }

  async updateArticleComponent(id: string, tenantId: string, data: Partial<InsertArticleComponent>): Promise<ArticleComponent | undefined> {
    const [row] = await db.update(articleComponents)
      .set(data)
      .where(and(eq(articleComponents.id, id), eq(articleComponents.tenantId, tenantId)))
      .returning();
    return row || undefined;
  }

  async deleteArticleComponent(id: string, tenantId: string): Promise<void> {
    await db.delete(articleComponents)
      .where(and(eq(articleComponents.id, id), eq(articleComponents.tenantId, tenantId)));
  }

  // ============================================
  // Session 11 (Register 3): Produktionstidslista
  // ============================================
  async getProductionTimeLists(tenantId: string, articleId?: string): Promise<ProductionTimeList[]> {
    return db.select().from(productionTimeLists)
      .where(articleId
        ? and(eq(productionTimeLists.tenantId, tenantId), eq(productionTimeLists.articleId, articleId))
        : eq(productionTimeLists.tenantId, tenantId))
      .orderBy(desc(productionTimeLists.createdAt));
  }

  async getProductionTimeList(id: string, tenantId: string): Promise<ProductionTimeList | undefined> {
    const [row] = await db.select().from(productionTimeLists)
      .where(and(eq(productionTimeLists.id, id), eq(productionTimeLists.tenantId, tenantId)));
    return row || undefined;
  }

  async createProductionTimeList(data: InsertProductionTimeList): Promise<ProductionTimeList> {
    const [row] = await db.insert(productionTimeLists).values(data).returning();
    return row;
  }

  async updateProductionTimeList(id: string, tenantId: string, data: Partial<InsertProductionTimeList>): Promise<ProductionTimeList | undefined> {
    const [row] = await db.update(productionTimeLists)
      .set(data)
      .where(and(eq(productionTimeLists.id, id), eq(productionTimeLists.tenantId, tenantId)))
      .returning();
    return row || undefined;
  }

  async deleteProductionTimeList(id: string, tenantId: string): Promise<void> {
    await db.delete(productionTimeLists)
      .where(and(eq(productionTimeLists.id, id), eq(productionTimeLists.tenantId, tenantId)));
  }

  // ============================================
  // Session 11 (Register 5): Leverantörsregister
  // ============================================
  async getSuppliers(tenantId: string, opts?: { includeDeleted?: boolean }): Promise<Supplier[]> {
    return db.select().from(suppliers)
      .where(opts?.includeDeleted
        ? eq(suppliers.tenantId, tenantId)
        : and(eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt)))
      .orderBy(suppliers.name);
  }

  async getSupplier(id: string, tenantId: string): Promise<Supplier | undefined> {
    const [row] = await db.select().from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)));
    return row || undefined;
  }

  async createSupplier(data: InsertSupplier): Promise<Supplier> {
    const [row] = await db.insert(suppliers).values(data).returning();
    return row;
  }

  async updateSupplier(id: string, tenantId: string, data: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const [row] = await db.update(suppliers)
      .set(data)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)))
      .returning();
    return row || undefined;
  }

  async deleteSupplier(id: string, tenantId: string): Promise<void> {
    // Soft-delete (bevarar leverantörshistorik för framtida inköpsportal/koppling)
    await db.update(suppliers)
      .set({ deletedAt: new Date() })
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)));
  }

  async getSupplierArticleLinks(tenantId: string, opts?: { articleId?: string; supplierId?: string }): Promise<SupplierArticleLink[]> {
    const conds = [eq(supplierArticleLinks.tenantId, tenantId)];
    if (opts?.articleId) conds.push(eq(supplierArticleLinks.articleId, opts.articleId));
    if (opts?.supplierId) conds.push(eq(supplierArticleLinks.supplierId, opts.supplierId));
    return db.select().from(supplierArticleLinks)
      .where(and(...conds))
      .orderBy(desc(supplierArticleLinks.isPrimary), desc(supplierArticleLinks.createdAt));
  }

  async getSupplierArticleLink(id: string, tenantId: string): Promise<SupplierArticleLink | undefined> {
    const [row] = await db.select().from(supplierArticleLinks)
      .where(and(eq(supplierArticleLinks.id, id), eq(supplierArticleLinks.tenantId, tenantId)));
    return row || undefined;
  }

  async createSupplierArticleLink(data: InsertSupplierArticleLink): Promise<SupplierArticleLink> {
    return db.transaction(async (tx) => {
      const [row] = await tx.insert(supplierArticleLinks).values(data).returning();
      // En primär leverantör per artikel: nollställ övriga om denna är primär
      if (row.isPrimary) {
        await tx.update(supplierArticleLinks)
          .set({ isPrimary: false })
          .where(and(
            eq(supplierArticleLinks.tenantId, row.tenantId),
            eq(supplierArticleLinks.articleId, row.articleId),
            ne(supplierArticleLinks.id, row.id),
          ));
      }
      return row;
    });
  }

  async updateSupplierArticleLink(id: string, tenantId: string, data: Partial<InsertSupplierArticleLink>): Promise<SupplierArticleLink | undefined> {
    return db.transaction(async (tx) => {
      const [row] = await tx.update(supplierArticleLinks)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(supplierArticleLinks.id, id), eq(supplierArticleLinks.tenantId, tenantId)))
        .returning();
      if (row && row.isPrimary) {
        await tx.update(supplierArticleLinks)
          .set({ isPrimary: false })
          .where(and(
            eq(supplierArticleLinks.tenantId, tenantId),
            eq(supplierArticleLinks.articleId, row.articleId),
            ne(supplierArticleLinks.id, row.id),
          ));
      }
      return row || undefined;
    });
  }

  async deleteSupplierArticleLink(id: string, tenantId: string): Promise<void> {
    await db.delete(supplierArticleLinks)
      .where(and(eq(supplierArticleLinks.id, id), eq(supplierArticleLinks.tenantId, tenantId)));
  }

  // ============================================
  // ADR v3 (F6): Index-justering pa prislista
  // ============================================
  async applyIndexAdjustmentToPriceList(
    priceListId: string,
    tenantId: string,
    percentage: number
  ): Promise<{ priceListId: string; percentage: number; updatedArticles: number; indexDate: Date }> {
    if (!isFinite(percentage) || percentage <= -100) {
      throw new Error("Ogiltig procentsats");
    }
    const list = await this.getPriceList(priceListId);
    if (!list || list.tenantId !== tenantId) throw new Error("Prislista hittades inte");
    const factor = 1 + percentage / 100;
    const indexDate = new Date();
    // Atomisk transaktion — alla rader och prislista uppdateras eller ingen.
    // Tenant-skydd: priceListId-WHERE i UPDATE forhindrar cross-tenant-skrivning
    // aven om en rad mot formodan har inkonsistent priceListId-koppling.
    let updated = 0;
    await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        UPDATE price_list_articles
        SET price = ROUND(price * ${factor})
        WHERE price_list_id = ${priceListId}
      `);
      updated = asExecuteResult(result).rowCount ?? 0;
      await tx.update(priceLists).set({
        indexAdjusted: true,
        indexDate,
        indexPercentage: percentage,
      }).where(and(eq(priceLists.id, priceListId), eq(priceLists.tenantId, tenantId)));
    });
    return { priceListId, percentage, updatedArticles: updated, indexDate };
  }

  // ============================================
  // ADR v3 (F5): Frozen WO snapshot + Recalculation Log
  // ============================================
  async freezeWorkOrder(
    workOrderId: string,
    tenantId: string,
    opts: { force?: boolean } = {}
  ) {
    const wo = await this.getWorkOrder(workOrderId);
    if (!wo || wo.tenantId !== tenantId) throw new Error("Arbetsorder hittades inte");
    // Komplett frozen-state kraver alla 5 falten satta (skydd mot partial legacy state)
    const alreadyFrozen =
      wo.frozenUnitPrice != null &&
      wo.frozenQuantity != null &&
      wo.frozenUnitCost != null &&
      wo.frozenUnitTime != null &&
      wo.frozenUnit != null;
    if (alreadyFrozen && !opts.force) {
      return {
        workOrderId,
        frozenUnit: wo.frozenUnit ?? "st",
        frozenQuantity: Number(wo.frozenQuantity ?? 0),
        frozenUnitPrice: Number(wo.frozenUnitPrice ?? 0),
        frozenUnitCost: Number(wo.frozenUnitCost ?? 0),
        frozenUnitTime: Number(wo.frozenUnitTime ?? 0),
        alreadyFrozen: true,
      };
    }
    const lines = await this.getWorkOrderLines(workOrderId);
    const totalQty = lines.reduce((s, l) => s + Number(l.quantity ?? 0), 0);
    const totalPrice = lines.reduce((s, l) => s + Number(l.resolvedPrice ?? 0) * Number(l.quantity ?? 1), 0);
    const totalCost = lines.reduce((s, l) => s + Number(l.resolvedCost ?? 0) * Number(l.quantity ?? 1), 0);
    const totalMin = lines.reduce((s, l) => s + Number(l.resolvedProductionMinutes ?? 0) * Number(l.quantity ?? 1), 0);
    const safeQty = totalQty > 0 ? totalQty : 1;
    const frozenUnit = "st";
    const frozenQuantity = totalQty;
    const frozenUnitPrice = totalPrice / safeQty;
    const frozenUnitCost = totalCost / safeQty;
    const frozenUnitTime = totalMin / safeQty;
    let metadataSnapshot: Record<string, unknown> = {};
    if (wo.objectId) {
      const obj = await this.getObject(wo.objectId);
      const meta = (obj as { metadata?: Record<string, unknown> } | undefined)?.metadata;
      metadataSnapshot = meta ?? {};
    }
    const frozenAt = new Date();

    // ADR v3 §2.3 (Task #556): Frys vinnande fakturamottagare samtidigt.
    // Vi rör inte befintliga frozen_invoice_* om de redan är satta (omfrysning
    // behåller operatorvalet). När inget är satt: kör resolvern och frys det
    // resolvern hittar — eller lämna NULL (Fortnox faller då tillbaka på
    // kund-härledningen via Ekonomi-metadatat).
    const recipientUpdate: Record<string, unknown> = {};
    if (!wo.frozenInvoiceRecipientId && wo.customerId) {
      try {
        const resolved = await this.resolveInvoiceRecipient(tenantId, wo.customerId, { at: frozenAt });
        if (resolved.recipient) {
          recipientUpdate.frozenInvoiceRecipientId = resolved.recipient.id;
          recipientUpdate.frozenInvoiceLevel = resolved.sourceLevel;
          recipientUpdate.frozenInvoiceSourceCustomerId = resolved.sourceCustomerId;
        }
        recipientUpdate.invoiceConflictFlag = resolved.hasConflict;
      } catch {
        // Resolver ska inte blockera frysning — back-compat: lämna NULL.
      }
    }

    await db.update(workOrders).set({
      frozenUnit,
      frozenQuantity,
      frozenUnitPrice,
      frozenUnitCost,
      frozenUnitTime,
      frozenAt,
      metadataSnapshot,
      ...recipientUpdate,
    }).where(and(eq(workOrders.id, workOrderId), eq(workOrders.tenantId, tenantId)));
    return { workOrderId, frozenUnit, frozenQuantity, frozenUnitPrice, frozenUnitCost, frozenUnitTime, frozenAt, alreadyFrozen };
  }

  // ============================================
  // ADR v3 §2.3 (Task #556): Fakturamottagare med arv + konfliktresolver
  // ============================================
  async getInvoiceRecipients(tenantId: string, customerId: string): Promise<InvoiceRecipient[]> {
    return db.select().from(invoiceRecipients).where(and(
      eq(invoiceRecipients.tenantId, tenantId),
      eq(invoiceRecipients.customerId, customerId),
      isNull(invoiceRecipients.deletedAt),
    )).orderBy(desc(invoiceRecipients.priority), desc(invoiceRecipients.createdAt));
  }

  async getInvoiceRecipient(tenantId: string, id: string): Promise<InvoiceRecipient | undefined> {
    const [row] = await db.select().from(invoiceRecipients).where(and(
      eq(invoiceRecipients.id, id),
      eq(invoiceRecipients.tenantId, tenantId),
      isNull(invoiceRecipients.deletedAt),
    ));
    return row;
  }

  async createInvoiceRecipient(data: InsertInvoiceRecipient): Promise<InvoiceRecipient> {
    const [row] = await db.insert(invoiceRecipients).values(data).returning();
    return row;
  }

  async updateInvoiceRecipient(tenantId: string, id: string, data: Partial<InsertInvoiceRecipient>): Promise<InvoiceRecipient | undefined> {
    const { tenantId: _ignoreTenant, customerId: _ignoreCustomer, ...patch } = data as Partial<InsertInvoiceRecipient>;
    const [row] = await db.update(invoiceRecipients)
      .set(patch)
      .where(and(eq(invoiceRecipients.id, id), eq(invoiceRecipients.tenantId, tenantId)))
      .returning();
    return row;
  }

  async deleteInvoiceRecipient(tenantId: string, id: string): Promise<void> {
    // Soft-delete — frysta WO ska kunna läsa historisk mottagare.
    await db.update(invoiceRecipients)
      .set({ deletedAt: new Date() })
      .where(and(eq(invoiceRecipients.id, id), eq(invoiceRecipients.tenantId, tenantId)));
  }

  async resolveInvoiceRecipient(
    tenantId: string,
    customerId: string,
    opts: { hintLevel?: InvoiceRecipientLevel | null; pinnedRecipientId?: string | null; at?: Date } = {},
  ) {
    const at = opts.at ?? new Date();
    const pinnedId = opts.pinnedRecipientId ?? null;

    // 1. Pinnad mottagare vinner alltid (operator har valt).
    if (pinnedId) {
      const pinned = await this.getInvoiceRecipient(tenantId, pinnedId);
      if (pinned) {
        return {
          recipient: pinned,
          sourceCustomerId: pinned.customerId,
          sourceLevel: pinned.level as InvoiceRecipientLevel,
          conflicts: [] as InvoiceRecipient[],
          hintConflict: false,
          hasConflict: false,
          chain: [],
        };
      }
    }

    // 2. Bygg kund-kedja bottom-up: [customer, ...ancestors].
    const [self] = await db.select().from(customers).where(and(
      eq(customers.id, customerId),
      eq(customers.tenantId, tenantId),
      isNull(customers.deletedAt),
    ));
    if (!self) {
      return { recipient: null, sourceCustomerId: null, sourceLevel: null, conflicts: [], hintConflict: false, hasConflict: false, chain: [] };
    }
    const ancestors = await this.getCustomerAncestors(tenantId, customerId);
    const chainCustomers = [self, ...ancestors];

    const isActive = (r: InvoiceRecipient): boolean => {
      if (r.deletedAt) return false;
      if (r.validFrom && new Date(r.validFrom) > at) return false;
      if (r.validTo && new Date(r.validTo) < at) return false;
      return true;
    };

    const chain: Array<{ customerId: string; customerName: string; recipients: InvoiceRecipient[] }> = [];
    let winner: InvoiceRecipient | null = null;
    let sourceCustomerId: string | null = null;
    let conflicts: InvoiceRecipient[] = [];
    let inheritanceBroken = false;

    for (const cust of chainCustomers) {
      const all = await this.getInvoiceRecipients(tenantId, cust.id);
      const active = all.filter(isActive);
      chain.push({ customerId: cust.id, customerName: cust.name, recipients: active });

      if (winner) {
        // Vi har redan en vinnare — fortsätt bara bygga chain för UI.
        continue;
      }

      if (active.length === 0) {
        // Inget på denna kund — om denna kund explicit kapar (via tom rad
        // med breaksInheritance kunde finnas i framtiden) stannar vi. För nu
        // betyder "inga rader" "fortsätt uppåt".
        continue;
      }

      // Hitta högsta priority. Ties → konflikt.
      const maxPriority = Math.max(...active.map(r => r.priority ?? 1));
      const top = active.filter(r => (r.priority ?? 1) === maxPriority);
      winner = top[0];
      sourceCustomerId = cust.id;
      if (top.length > 1) {
        // Samma-nivå-konflikt (F1): operator måste välja explicit.
        conflicts = top;
      }

      // Om någon mottagare på vinnar-kunden kapar arv, är det redundant
      // (vi har redan vinnaren här) — men sätt flagga för audit.
      if (active.some(r => r.breaksInheritance)) {
        inheritanceBroken = true;
      }
      // Vinnaren är funnen — fortsätt bara fylla chain.
    }

    const sourceLevel = winner ? (winner.level as InvoiceRecipientLevel) : null;
    const hintConflict = !!(opts.hintLevel && sourceLevel && opts.hintLevel !== sourceLevel);
    const hasConflict = conflicts.length > 0 || hintConflict;

    // inheritanceBroken används bara för audit — flaggar inte konflikt själv.
    void inheritanceBroken;

    return {
      recipient: winner,
      sourceCustomerId,
      sourceLevel,
      conflicts,
      hintConflict,
      hasConflict,
      chain,
    };
  }

  async recalculateWorkOrder(
    workOrderId: string,
    tenantId: string,
    triggeredBy: string | null,
    reason: string = "manual"
  ) {
    const wo = await this.getWorkOrder(workOrderId);
    if (!wo || wo.tenantId !== tenantId) throw new Error("Arbetsorder hittades inte");
    if (wo.frozenUnitPrice == null) {
      throw new Error("Arbetsordern har ingen frozen-snapshot. Frys den forst.");
    }
    const lines = await this.getWorkOrderLines(workOrderId);
    const currentValue = lines.reduce((s, l) => s + Number(l.resolvedPrice ?? 0) * Number(l.quantity ?? 1), 0);
    const previousValue = Number(wo.frozenUnitPrice ?? 0) * Number(wo.frozenQuantity ?? 0);
    const delta = currentValue - previousValue;
    let logId: string | null = null;
    if (Math.abs(delta) > 0.001) {
      const period = wo.completedAt
        ? new Date(wo.completedAt).toISOString().slice(0, 7)
        : new Date().toISOString().slice(0, 7);
      // Inkludera fryst snapshot i description for fullstandig audit-trail
      const frozenContext = `frozen=${Number(wo.frozenQuantity ?? 0)}${wo.frozenUnit ?? "st"} @ ${Number(wo.frozenUnitPrice ?? 0).toFixed(2)} (cost ${Number(wo.frozenUnitCost ?? 0).toFixed(2)}, time ${Number(wo.frozenUnitTime ?? 0).toFixed(1)}m)`;
      const [logRow] = await db.insert(invoiceRecalculationLog).values({
        tenantId,
        workOrderId,
        recalculationReason: reason,
        description: `Omberakning: ${previousValue.toFixed(2)} -> ${currentValue.toFixed(2)} (delta ${delta.toFixed(2)}) | ${frozenContext}`,
        previousValue,
        newValue: currentValue,
        delta,
        affectedPeriods: [period],
        triggeredBy,
      }).returning();
      logId = logRow.id;
    }
    return { previousValue, newValue: currentValue, delta, logId };
  }

  async getInvoiceRecalculationLogs(
    tenantId: string,
    opts: { workOrderId?: string; limit?: number; offset?: number } = {}
  ): Promise<InvoiceRecalculationLog[]> {
    const conditions = [eq(invoiceRecalculationLog.tenantId, tenantId)];
    if (opts.workOrderId) conditions.push(eq(invoiceRecalculationLog.workOrderId, opts.workOrderId));
    let q = db.select().from(invoiceRecalculationLog)
      .where(and(...conditions))
      .orderBy(desc(invoiceRecalculationLog.triggeredAt));
    const limit = Math.min(opts.limit ?? 100, 500);
    const offset = opts.offset ?? 0;
    return (q as unknown as { limit: (n: number) => { offset: (n: number) => Promise<InvoiceRecalculationLog[]> } }).limit(limit).offset(offset);
  }

  async createInvoiceRecalculationLog(entry: InsertInvoiceRecalculationLog): Promise<InvoiceRecalculationLog> {
    const [row] = await db.insert(invoiceRecalculationLog).values(entry).returning();
    return row;
  }

  // ============================================
  // Assignments
  // ============================================
  
  async getAssignments(tenantId: string, options?: { 
    status?: string; 
    resourceId?: string; 
    clusterId?: string; 
    startDate?: Date; 
    endDate?: Date 
  }): Promise<Assignment[]> {
    const conditions = [
      eq(assignments.tenantId, tenantId),
      isNull(assignments.deletedAt)
    ];
    
    if (options?.status) {
      conditions.push(eq(assignments.status, options.status));
    }
    if (options?.resourceId) {
      conditions.push(eq(assignments.resourceId, options.resourceId));
    }
    if (options?.clusterId) {
      conditions.push(eq(assignments.clusterId, options.clusterId));
    }
    if (options?.startDate) {
      conditions.push(gte(assignments.scheduledDate, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(assignments.scheduledDate, options.endDate));
    }
    
    return db.select().from(assignments)
      .where(and(...conditions))
      .orderBy(desc(assignments.createdAt));
  }

  async getAssignment(id: string): Promise<Assignment | undefined> {
    const [result] = await db.select().from(assignments)
      .where(and(
        eq(assignments.id, id),
        isNull(assignments.deletedAt)
      ));
    return result || undefined;
  }

  async createAssignment(assignment: InsertAssignment): Promise<Assignment> {
    const values = { ...assignment };
    await this.fillAssignmentUppgiftspaket(values);
    const [result] = await db.insert(assignments).values(values).returning();
    if (result?.tenantId) invalidateWorkflowCaches(result.tenantId);
    return result;
  }

  async updateAssignment(id: string, tenantId: string, data: Partial<InsertAssignment>): Promise<Assignment | undefined> {
    const [result] = await db.update(assignments)
      .set(data)
      .where(and(
        eq(assignments.id, id),
        eq(assignments.tenantId, tenantId),
        isNull(assignments.deletedAt)
      ))
      .returning();
    if (result) invalidateWorkflowCaches(tenantId);
    return result || undefined;
  }

  async deleteAssignment(id: string, tenantId: string): Promise<void> {
    await db.update(assignments)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(assignments.id, id),
        eq(assignments.tenantId, tenantId)
      ));
    invalidateWorkflowCaches(tenantId);
  }

  // ============================================
  // Assignment Articles
  // ============================================
  
  async getAssignmentArticles(assignmentId: string): Promise<AssignmentArticle[]> {
    return db.select().from(assignmentArticles)
      .where(eq(assignmentArticles.assignmentId, assignmentId))
      .orderBy(assignmentArticles.sequenceOrder);
  }

  // Bulk-variant för motorer (Task #1038): hämtar artiklar för flera assignments
  // i en query, sorterade så att första raden per assignment är lägsta
  // sequenceOrder (för att härleda primär utförandekod).
  async getAssignmentArticlesForAssignments(assignmentIds: string[]): Promise<AssignmentArticle[]> {
    if (assignmentIds.length === 0) return [];
    return db.select().from(assignmentArticles)
      .where(inArray(assignmentArticles.assignmentId, assignmentIds))
      .orderBy(assignmentArticles.assignmentId, assignmentArticles.sequenceOrder);
  }

  async createAssignmentArticle(article: InsertAssignmentArticle): Promise<AssignmentArticle> {
    const [result] = await db.insert(assignmentArticles).values(article).returning();
    return result;
  }

  async updateAssignmentArticle(id: string, assignmentId: string, data: Partial<InsertAssignmentArticle>): Promise<AssignmentArticle | undefined> {
    const [result] = await db.update(assignmentArticles)
      .set(data)
      .where(and(
        eq(assignmentArticles.id, id),
        eq(assignmentArticles.assignmentId, assignmentId)
      ))
      .returning();
    return result || undefined;
  }

  async deleteAssignmentArticle(id: string, assignmentId: string): Promise<void> {
    await db.delete(assignmentArticles).where(and(
      eq(assignmentArticles.id, id),
      eq(assignmentArticles.assignmentId, assignmentId)
    ));
  }

  // ============================================
  // Subscription Changes
  // ============================================
  
  async getSubscriptionChanges(tenantId: string, conceptId?: string, status?: string): Promise<SubscriptionChange[]> {
    const conditions = [eq(subscriptionChanges.tenantId, tenantId)];
    if (conceptId) conditions.push(eq(subscriptionChanges.orderConceptId, conceptId));
    if (status) conditions.push(eq(subscriptionChanges.approvalStatus, status));
    return db.select().from(subscriptionChanges).where(and(...conditions)).orderBy(desc(subscriptionChanges.detectedAt));
  }

  async createSubscriptionChange(change: InsertSubscriptionChange): Promise<SubscriptionChange> {
    const [result] = await db.insert(subscriptionChanges).values(change).returning();
    return result;
  }

  async updateSubscriptionChangeStatus(id: string, tenantId: string, status: string, approvedBy?: string): Promise<SubscriptionChange | undefined> {
    const [result] = await db.update(subscriptionChanges)
      .set({ 
        approvalStatus: status, 
        approvedBy: approvedBy || null, 
        approvedAt: status === 'approved' || status === 'rejected' ? new Date() : null 
      })
      .where(and(eq(subscriptionChanges.id, id), eq(subscriptionChanges.tenantId, tenantId)))
      .returning();
    return result || undefined;
  }

  // ============================================
  // Task Dependency Templates
  // ============================================

  async getTaskDependencyTemplates(tenantId: string, articleId?: string): Promise<TaskDependencyTemplate[]> {
    const conditions = [eq(taskDependencyTemplates.tenantId, tenantId)];
    if (articleId) conditions.push(eq(taskDependencyTemplates.articleId, articleId));
    return db.select().from(taskDependencyTemplates).where(and(...conditions)).orderBy(taskDependencyTemplates.orderIndex);
  }

  async getTaskDependencyTemplate(id: string): Promise<TaskDependencyTemplate | undefined> {
    const [result] = await db.select().from(taskDependencyTemplates).where(eq(taskDependencyTemplates.id, id));
    return result || undefined;
  }

  async createTaskDependencyTemplate(template: InsertTaskDependencyTemplate): Promise<TaskDependencyTemplate> {
    const [result] = await db.insert(taskDependencyTemplates).values(template).returning();
    return result;
  }

  async updateTaskDependencyTemplate(id: string, tenantId: string, data: Partial<InsertTaskDependencyTemplate>): Promise<TaskDependencyTemplate | undefined> {
    const [result] = await db.update(taskDependencyTemplates)
      .set(data)
      .where(and(eq(taskDependencyTemplates.id, id), eq(taskDependencyTemplates.tenantId, tenantId)))
      .returning();
    return result || undefined;
  }

  async deleteTaskDependencyTemplate(id: string, tenantId: string): Promise<void> {
    await db.delete(taskDependencyTemplates).where(and(
      eq(taskDependencyTemplates.id, id),
      eq(taskDependencyTemplates.tenantId, tenantId)
    ));
  }

  // ============================================
  // Task Dependency Instances
  // ============================================

  async getTaskDependencyInstances(tenantId: string, parentWorkOrderId?: string): Promise<TaskDependencyInstance[]> {
    const conditions = [eq(taskDependencyInstances.tenantId, tenantId)];
    if (parentWorkOrderId) conditions.push(eq(taskDependencyInstances.parentWorkOrderId, parentWorkOrderId));
    return db.select().from(taskDependencyInstances).where(and(...conditions));
  }

  async createTaskDependencyInstance(instance: InsertTaskDependencyInstance): Promise<TaskDependencyInstance> {
    const [result] = await db.insert(taskDependencyInstances).values(instance).returning();
    return result;
  }

  async updateTaskDependencyInstanceCompleted(id: string, tenantId: string, completed: boolean): Promise<TaskDependencyInstance | undefined> {
    const [result] = await db.update(taskDependencyInstances)
      .set({ completed })
      .where(and(eq(taskDependencyInstances.id, id), eq(taskDependencyInstances.tenantId, tenantId)))
      .returning();
    return result || undefined;
  }

  // ============================================
  // Invoice Rules
  // ============================================

  async getInvoiceRules(tenantId: string, orderConceptId?: string): Promise<InvoiceRule[]> {
    const conditions = [eq(invoiceRules.tenantId, tenantId)];
    if (orderConceptId) conditions.push(eq(invoiceRules.orderConceptId, orderConceptId));
    return db.select().from(invoiceRules).where(and(...conditions));
  }

  async getInvoiceRule(id: string): Promise<InvoiceRule | undefined> {
    const [result] = await db.select().from(invoiceRules).where(eq(invoiceRules.id, id));
    return result || undefined;
  }

  async createInvoiceRule(rule: InsertInvoiceRule): Promise<InvoiceRule> {
    const [result] = await db.insert(invoiceRules).values(rule).returning();
    return result;
  }

  async updateInvoiceRule(id: string, tenantId: string, data: Partial<InsertInvoiceRule>): Promise<InvoiceRule | undefined> {
    const [result] = await db.update(invoiceRules)
      .set(data)
      .where(and(eq(invoiceRules.id, id), eq(invoiceRules.tenantId, tenantId)))
      .returning();
    return result || undefined;
  }

  async deleteInvoiceRule(id: string, tenantId: string): Promise<void> {
    await db.delete(invoiceRules).where(and(
      eq(invoiceRules.id, id),
      eq(invoiceRules.tenantId, tenantId)
    ));
  }

  // ============================================
  // Order Concept Run Logs
  // ============================================

  async getOrderConceptRunLogs(tenantId: string, orderConceptId?: string): Promise<OrderConceptRunLog[]> {
    const conditions = [eq(orderConceptRunLogs.tenantId, tenantId)];
    if (orderConceptId) conditions.push(eq(orderConceptRunLogs.orderConceptId, orderConceptId));
    return db.select().from(orderConceptRunLogs).where(and(...conditions)).orderBy(desc(orderConceptRunLogs.runAt));
  }

  async createOrderConceptRunLog(log: InsertOrderConceptRunLog): Promise<OrderConceptRunLog> {
    const [result] = await db.insert(orderConceptRunLogs).values(log).returning();
    return result;
  }

  // ============================================
  // Order Concept Wizard - Objects
  // ============================================

  async getOrderConceptObjects(orderConceptId: string): Promise<OrderConceptObject[]> {
    return db.select().from(orderConceptObjects)
      .where(eq(orderConceptObjects.orderConceptId, orderConceptId))
      .orderBy(orderConceptObjects.sortOrder);
  }

  async addOrderConceptObjects(objs: InsertOrderConceptObject[]): Promise<OrderConceptObject[]> {
    if (objs.length === 0) return [];
    return db.insert(orderConceptObjects).values(objs).onConflictDoNothing().returning();
  }

  async removeOrderConceptObject(orderConceptId: string, objectId: string): Promise<void> {
    await db.delete(orderConceptObjects).where(and(
      eq(orderConceptObjects.orderConceptId, orderConceptId),
      eq(orderConceptObjects.objectId, objectId)
    ));
  }

  // ============================================
  // Order Concept Wizard - Articles
  // ============================================

  async getOrderConceptArticles(orderConceptId: string): Promise<OrderConceptArticle[]> {
    return db.select().from(orderConceptArticles)
      .where(eq(orderConceptArticles.orderConceptId, orderConceptId))
      .orderBy(orderConceptArticles.sortOrder);
  }

  async addOrderConceptArticle(article: InsertOrderConceptArticle): Promise<OrderConceptArticle> {
    const [result] = await db.insert(orderConceptArticles).values(article).returning();
    return result;
  }

  async removeOrderConceptArticle(id: string, orderConceptId: string): Promise<void> {
    await db.delete(orderConceptArticles).where(and(
      eq(orderConceptArticles.id, id),
      eq(orderConceptArticles.orderConceptId, orderConceptId)
    ));
  }

  async updateOrderConceptArticle(id: string, orderConceptId: string, updates: Partial<InsertOrderConceptArticle>): Promise<OrderConceptArticle | undefined> {
    const patch: Partial<InsertOrderConceptArticle> = { ...updates };
    delete (patch as { id?: unknown }).id;
    delete (patch as { orderConceptId?: unknown }).orderConceptId;
    delete (patch as { createdAt?: unknown }).createdAt;
    const [result] = await db.update(orderConceptArticles)
      .set(patch)
      .where(and(
        eq(orderConceptArticles.id, id),
        eq(orderConceptArticles.orderConceptId, orderConceptId)
      ))
      .returning();
    return result;
  }

  // ============================================
  // Order Concept Wizard - Article-Object Mappings
  // ============================================

  async getArticleObjectMappings(orderConceptId: string): Promise<ArticleObjectMapping[]> {
    const conceptArticleIds = await db.select({ id: orderConceptArticles.id })
      .from(orderConceptArticles)
      .where(eq(orderConceptArticles.orderConceptId, orderConceptId));
    if (conceptArticleIds.length === 0) return [];
    return db.select().from(articleObjectMappings)
      .where(inArray(articleObjectMappings.orderConceptArticleId, conceptArticleIds.map(a => a.id)));
  }

  async createArticleObjectMapping(mapping: InsertArticleObjectMapping): Promise<ArticleObjectMapping> {
    const [result] = await db.insert(articleObjectMappings).values(mapping).returning();
    return result;
  }

  async deleteArticleObjectMappings(orderConceptId: string): Promise<void> {
    const conceptArticleIds = await db.select({ id: orderConceptArticles.id })
      .from(orderConceptArticles)
      .where(eq(orderConceptArticles.orderConceptId, orderConceptId));
    if (conceptArticleIds.length === 0) return;
    await db.delete(articleObjectMappings)
      .where(inArray(articleObjectMappings.orderConceptArticleId, conceptArticleIds.map(a => a.id)));
  }

  // ============================================
  // Order Concept Wizard - Invoice Configuration
  // ============================================

  async getInvoiceConfiguration(orderConceptId: string): Promise<InvoiceConfiguration | undefined> {
    const [result] = await db.select().from(invoiceConfigurations)
      .where(eq(invoiceConfigurations.orderConceptId, orderConceptId));
    return result || undefined;
  }

  async upsertInvoiceConfiguration(config: InsertInvoiceConfiguration): Promise<InvoiceConfiguration> {
    const existing = await this.getInvoiceConfiguration(config.orderConceptId);
    if (existing) {
      const [result] = await db.update(invoiceConfigurations)
        .set({ ...config, updatedAt: new Date() })
        .where(eq(invoiceConfigurations.id, existing.id))
        .returning();
      return result;
    }
    const [result] = await db.insert(invoiceConfigurations).values(config).returning();
    return result;
  }

  // ============================================
  // Order Concept Wizard - Document Configurations
  // ============================================

  async getDocumentConfigurations(orderConceptId: string): Promise<DocumentConfiguration[]> {
    return db.select().from(documentConfigurations)
      .where(eq(documentConfigurations.orderConceptId, orderConceptId));
  }

  async upsertDocumentConfigurations(orderConceptId: string, configs: InsertDocumentConfiguration[]): Promise<DocumentConfiguration[]> {
    await db.delete(documentConfigurations).where(eq(documentConfigurations.orderConceptId, orderConceptId));
    if (configs.length === 0) return [];
    return db.insert(documentConfigurations).values(configs).returning();
  }

  // ============================================
  // Order Concept Wizard - Delivery Schedules
  // ============================================

  async getDeliverySchedules(orderConceptId: string): Promise<DeliverySchedule[]> {
    return db.select().from(deliverySchedules)
      .where(eq(deliverySchedules.orderConceptId, orderConceptId));
  }

  async upsertDeliverySchedules(orderConceptId: string, schedules: InsertDeliverySchedule[]): Promise<DeliverySchedule[]> {
    await db.delete(deliverySchedules).where(eq(deliverySchedules.orderConceptId, orderConceptId));
    if (schedules.length === 0) return [];
    return db.insert(deliverySchedules).values(schedules).returning();
  }

  // ============================================
  // Customer Portal Tokens
  // ============================================
  
  async createPortalToken(token: InsertCustomerPortalToken): Promise<CustomerPortalToken> {
    const [result] = await db.insert(customerPortalTokens).values(token).returning();
    return result;
  }

  async getPortalTokenByHash(tokenHash: string): Promise<CustomerPortalToken | undefined> {
    const [token] = await db.select().from(customerPortalTokens)
      .where(eq(customerPortalTokens.tokenHash, tokenHash));
    return token || undefined;
  }

  async deletePortalToken(id: string): Promise<void> {
    await db.delete(customerPortalTokens)
      .where(eq(customerPortalTokens.id, id));
  }

  async markPortalTokenUsed(id: string): Promise<void> {
    await db.update(customerPortalTokens)
      .set({ usedAt: new Date() })
      .where(eq(customerPortalTokens.id, id));
  }

  async getCustomerByEmail(email: string, tenantId: string): Promise<Customer | undefined> {
    const normalized = email.trim().toLowerCase();
    const [customer] = await db.select().from(customers)
      .where(and(
        sql`LOWER(${customers.email}) = ${normalized}`,
        eq(customers.tenantId, tenantId),
        isNull(customers.deletedAt)
      ));
    if (customer) return customer;

    // Fallback: portal_users kan ha registrerats för en kontakt-e-post som
    // skiljer sig från customers.email (t.ex. kund-administratör inbjuden
    // separat). Slå upp via portal_users → customer.
    const [portalUser] = await db.select().from(portalUsers).where(and(
      eq(portalUsers.tenantId, tenantId),
      eq(portalUsers.email, normalized),
    ));
    if (!portalUser) return undefined;

    const [linked] = await db.select().from(customers).where(and(
      eq(customers.id, portalUser.customerId),
      eq(customers.tenantId, tenantId),
      isNull(customers.deletedAt),
    ));
    return linked || undefined;
  }

  // ============================================
  // Customer Portal Sessions
  // ============================================
  
  async createPortalSession(session: InsertCustomerPortalSession): Promise<CustomerPortalSession> {
    const [result] = await db.insert(customerPortalSessions).values(session).returning();
    return result;
  }

  async getPortalSessionByToken(sessionToken: string): Promise<CustomerPortalSession | undefined> {
    const [session] = await db.select().from(customerPortalSessions)
      .where(and(
        eq(customerPortalSessions.sessionToken, sessionToken),
        gte(customerPortalSessions.expiresAt, new Date())
      ));
    return session || undefined;
  }

  async updatePortalSessionAccess(id: string): Promise<void> {
    await db.update(customerPortalSessions)
      .set({ lastAccessedAt: new Date() })
      .where(eq(customerPortalSessions.id, id));
  }

  async deletePortalSession(id: string): Promise<void> {
    await db.delete(customerPortalSessions)
      .where(eq(customerPortalSessions.id, id));
  }

  // ============================================
  // Portal Users (per-objekt-scope)
  // ============================================
  async upsertPortalUser(data: InsertPortalUser): Promise<PortalUser> {
    const normalizedEmail = data.email.trim().toLowerCase();
    const existing = await this.getPortalUserByEmail(data.tenantId, data.customerId, normalizedEmail);
    if (existing) {
      if (data.name && data.name !== existing.name) {
        const [updated] = await db.update(portalUsers)
          .set({ name: data.name })
          .where(eq(portalUsers.id, existing.id))
          .returning();
        return updated;
      }
      return existing;
    }
    const [created] = await db.insert(portalUsers).values({
      ...data,
      email: normalizedEmail,
    }).returning();
    return created;
  }

  async getPortalUser(id: string): Promise<PortalUser | undefined> {
    const [u] = await db.select().from(portalUsers).where(eq(portalUsers.id, id));
    return u || undefined;
  }

  async getPortalUserByEmail(tenantId: string, customerId: string, email: string): Promise<PortalUser | undefined> {
    const [u] = await db.select().from(portalUsers).where(and(
      eq(portalUsers.tenantId, tenantId),
      eq(portalUsers.customerId, customerId),
      eq(portalUsers.email, email.trim().toLowerCase()),
    ));
    return u || undefined;
  }

  async getPortalUsersByCustomer(tenantId: string, customerId: string): Promise<Array<PortalUser & { scopeObjectIds: string[] }>> {
    const users = await db.select().from(portalUsers).where(and(
      eq(portalUsers.tenantId, tenantId),
      eq(portalUsers.customerId, customerId),
    ));
    if (users.length === 0) return [];
    const userIds = users.map(u => u.id);
    const scopes = await db.select().from(portalUserObjectScopes)
      .where(inArray(portalUserObjectScopes.portalUserId, userIds));
    const byUser = new Map<string, string[]>();
    for (const s of scopes) {
      const arr = byUser.get(s.portalUserId) || [];
      arr.push(s.objectId);
      byUser.set(s.portalUserId, arr);
    }
    return users.map(u => ({ ...u, scopeObjectIds: byUser.get(u.id) || [] }));
  }

  async deletePortalUser(id: string): Promise<void> {
    await db.delete(portalUsers).where(eq(portalUsers.id, id));
  }

  async setPortalUserScope(portalUserId: string, objectIds: string[]): Promise<void> {
    const unique = Array.from(new Set(objectIds.filter(Boolean)));
    await db.transaction(async (tx) => {
      await tx.delete(portalUserObjectScopes).where(eq(portalUserObjectScopes.portalUserId, portalUserId));
      if (unique.length > 0) {
        await tx.insert(portalUserObjectScopes).values(unique.map(objectId => ({
          portalUserId,
          objectId,
        })));
      }
    });
  }

  async getPortalUserScopeRaw(portalUserId: string): Promise<string[]> {
    const rows = await db.select({ objectId: portalUserObjectScopes.objectId })
      .from(portalUserObjectScopes)
      .where(eq(portalUserObjectScopes.portalUserId, portalUserId));
    return rows.map(r => r.objectId);
  }

  async resolvePortalUserScopeObjectIds(portalUserId: string, tenantId: string): Promise<Set<string> | null> {
    const rootIds = await this.getPortalUserScopeRaw(portalUserId);
    if (rootIds.length === 0) return null; // null = full access (bakåtkompat)
    const rootList = sql.join(rootIds.map(id => sql`${id}`), sql`, `);
    const rows = await db.execute(sql`
      WITH RECURSIVE scope_tree AS (
        SELECT id FROM objects
        WHERE id IN (${rootList}) AND tenant_id = ${tenantId} AND deleted_at IS NULL
        UNION ALL
        SELECT o.id FROM objects o
        JOIN scope_tree st ON o.parent_id = st.id
        WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL
      )
      SELECT DISTINCT id FROM scope_tree
    `);
    const set = new Set<string>();
    const exec = asExecuteResult(rows);
    const items: unknown[] = exec.rows ?? (Array.isArray(rows) ? (rows as unknown[]) : []);
    for (const r of items) {
      const id = (r as { id?: string }).id;
      if (id) set.add(id);
    }
    return set;
  }

  // ============================================
  // Customer Booking Requests
  // ============================================
  
  async getBookingRequests(tenantId: string, customerId?: string): Promise<CustomerBookingRequest[]> {
    if (customerId) {
      return db.select().from(customerBookingRequests)
        .where(and(
          eq(customerBookingRequests.tenantId, tenantId),
          eq(customerBookingRequests.customerId, customerId)
        ))
        .orderBy(desc(customerBookingRequests.createdAt));
    }
    return db.select().from(customerBookingRequests)
      .where(eq(customerBookingRequests.tenantId, tenantId))
      .orderBy(desc(customerBookingRequests.createdAt));
  }

  async getBookingRequest(id: string): Promise<CustomerBookingRequest | undefined> {
    const [request] = await db.select().from(customerBookingRequests)
      .where(eq(customerBookingRequests.id, id));
    return request || undefined;
  }

  async createBookingRequest(request: InsertCustomerBookingRequest): Promise<CustomerBookingRequest> {
    const [result] = await db.insert(customerBookingRequests).values(request).returning();
    return result;
  }

  async updateBookingRequest(id: string, tenantId: string, data: Partial<InsertCustomerBookingRequest>): Promise<CustomerBookingRequest | undefined> {
    const [result] = await db.update(customerBookingRequests)
      .set({ ...data, updatedAt: new Date() })
      .where(and(
        eq(customerBookingRequests.id, id),
        eq(customerBookingRequests.tenantId, tenantId)
      ))
      .returning();
    return result || undefined;
  }

  async getWorkOrdersByCustomer(customerId: string, tenantId: string): Promise<WorkOrder[]> {
    return db.select().from(workOrders)
      .where(and(
        eq(workOrders.customerId, customerId),
        eq(workOrders.tenantId, tenantId),
        isNull(workOrders.deletedAt)
      ))
      .orderBy(desc(workOrders.scheduledDate));
  }

  // ============================================
  // Customer Portal Messages (Legacy)
  // ============================================
  
  async getLegacyPortalMessages(tenantId: string, customerId: string): Promise<CustomerPortalMessage[]> {
    return db.select().from(customerPortalMessages)
      .where(and(
        eq(customerPortalMessages.tenantId, tenantId),
        eq(customerPortalMessages.customerId, customerId)
      ))
      .orderBy(customerPortalMessages.createdAt);
  }

  async createLegacyPortalMessage(message: InsertCustomerPortalMessage): Promise<CustomerPortalMessage> {
    const [result] = await db.insert(customerPortalMessages).values(message).returning();
    return result;
  }

  async markLegacyPortalMessagesAsRead(tenantId: string, customerId: string): Promise<void> {
    await db.update(customerPortalMessages)
      .set({ readAt: new Date() })
      .where(and(
        eq(customerPortalMessages.tenantId, tenantId),
        eq(customerPortalMessages.customerId, customerId),
        eq(customerPortalMessages.sender, "staff"),
        isNull(customerPortalMessages.readAt)
      ));
  }

  async getLegacyUnreadMessageCount(tenantId: string, customerId?: string): Promise<number> {
    const conditions = [
      eq(customerPortalMessages.tenantId, tenantId),
      isNull(customerPortalMessages.readAt)
    ];
    if (customerId) {
      conditions.push(eq(customerPortalMessages.customerId, customerId));
      conditions.push(eq(customerPortalMessages.sender, "staff"));
    } else {
      conditions.push(eq(customerPortalMessages.sender, "customer"));
    }
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(customerPortalMessages)
      .where(and(...conditions));
    return Number(result[0]?.count || 0);
  }

  async getAllPortalMessagesForStaff(tenantId: string): Promise<CustomerPortalMessage[]> {
    return db.select().from(customerPortalMessages)
      .where(eq(customerPortalMessages.tenantId, tenantId))
      .orderBy(desc(customerPortalMessages.createdAt));
  }

  async getCustomersWithMessages(tenantId: string): Promise<string[]> {
    const result = await db.selectDistinct({ customerId: customerPortalMessages.customerId })
      .from(customerPortalMessages)
      .where(eq(customerPortalMessages.tenantId, tenantId));
    return result.map(r => r.customerId);
  }

  async markPortalMessagesAsRead(tenantId: string, customerId: string): Promise<void> {
    await db.update(customerPortalMessages)
      .set({ readAt: new Date() })
      .where(and(
        eq(customerPortalMessages.tenantId, tenantId),
        eq(customerPortalMessages.customerId, customerId),
        eq(customerPortalMessages.sender, "staff"),
        isNull(customerPortalMessages.readAt)
      ));
  }

  async markStaffMessagesAsRead(tenantId: string, customerId: string): Promise<void> {
    await db.update(customerPortalMessages)
      .set({ readAt: new Date() })
      .where(and(
        eq(customerPortalMessages.tenantId, tenantId),
        eq(customerPortalMessages.customerId, customerId),
        eq(customerPortalMessages.sender, "customer"),
        isNull(customerPortalMessages.readAt)
      ));
  }

  // ============================================
  // CUSTOMER PORTAL - INVOICES
  // ============================================
  
  async getCustomerInvoices(tenantId: string, customerId: string): Promise<CustomerInvoice[]> {
    return db.select().from(customerInvoices)
      .where(and(
        eq(customerInvoices.tenantId, tenantId),
        eq(customerInvoices.customerId, customerId)
      ))
      .orderBy(desc(customerInvoices.invoiceDate));
  }

  async createCustomerInvoice(invoice: InsertCustomerInvoice): Promise<CustomerInvoice> {
    const [result] = await db.insert(customerInvoices).values(invoice).returning();
    return result;
  }

  // ============================================
  // CUSTOMER PORTAL - ISSUE REPORTS
  // ============================================
  
  async getCustomerIssueReports(tenantId: string, customerId: string): Promise<CustomerIssueReport[]> {
    return db.select().from(customerIssueReports)
      .where(and(
        eq(customerIssueReports.tenantId, tenantId),
        eq(customerIssueReports.customerId, customerId)
      ))
      .orderBy(desc(customerIssueReports.createdAt));
  }

  async createCustomerIssueReport(report: InsertCustomerIssueReport): Promise<CustomerIssueReport> {
    const [result] = await db.insert(customerIssueReports).values(report).returning();
    return result;
  }

  async updateCustomerIssueReport(id: string, tenantId: string, data: Partial<InsertCustomerIssueReport>): Promise<CustomerIssueReport | undefined> {
    const [result] = await db.update(customerIssueReports)
      .set({ ...data, updatedAt: new Date() })
      .where(and(
        eq(customerIssueReports.id, id),
        eq(customerIssueReports.tenantId, tenantId)
      ))
      .returning();
    return result;
  }

  // ============================================
  // CUSTOMER PORTAL - SERVICE CONTRACTS
  // ============================================
  
  async getCustomerServiceContracts(tenantId: string, customerId: string): Promise<CustomerServiceContract[]> {
    return db.select().from(customerServiceContracts)
      .where(and(
        eq(customerServiceContracts.tenantId, tenantId),
        eq(customerServiceContracts.customerId, customerId)
      ))
      .orderBy(desc(customerServiceContracts.createdAt));
  }

  async createCustomerServiceContract(contract: InsertCustomerServiceContract): Promise<CustomerServiceContract> {
    const [result] = await db.insert(customerServiceContracts).values(contract).returning();
    return result;
  }

  // ============================================
  // FORTNOX INVOICE → CONTRACT SUGGESTIONS
  // ============================================

  async listFortnoxContractSuggestions(tenantId: string, opts: { status?: string; importBatchId?: string; customerId?: string } = {}): Promise<FortnoxContractSuggestion[]> {
    const conds = [eq(fortnoxContractSuggestions.tenantId, tenantId)];
    if (opts.status) conds.push(eq(fortnoxContractSuggestions.status, opts.status));
    if (opts.importBatchId) conds.push(eq(fortnoxContractSuggestions.importBatchId, opts.importBatchId));
    if (opts.customerId) conds.push(eq(fortnoxContractSuggestions.customerId, opts.customerId));
    return db.select().from(fortnoxContractSuggestions)
      .where(and(...conds))
      .orderBy(desc(fortnoxContractSuggestions.totalRevenue));
  }

  async getFortnoxContractSuggestion(id: string, tenantId: string): Promise<FortnoxContractSuggestion | undefined> {
    const [row] = await db.select().from(fortnoxContractSuggestions)
      .where(and(eq(fortnoxContractSuggestions.id, id), eq(fortnoxContractSuggestions.tenantId, tenantId)));
    return row;
  }

  async createFortnoxContractSuggestions(rows: InsertFortnoxContractSuggestion[]): Promise<FortnoxContractSuggestion[]> {
    if (rows.length === 0) return [];
    return db.insert(fortnoxContractSuggestions).values(rows).returning();
  }

  async updateFortnoxContractSuggestion(id: string, tenantId: string, updates: Partial<FortnoxContractSuggestion>): Promise<FortnoxContractSuggestion | undefined> {
    const [row] = await db.update(fortnoxContractSuggestions)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(fortnoxContractSuggestions.id, id), eq(fortnoxContractSuggestions.tenantId, tenantId)))
      .returning();
    return row;
  }

  async deleteFortnoxContractSuggestionsByBatch(tenantId: string, importBatchId: string): Promise<number> {
    const result = await db.delete(fortnoxContractSuggestions)
      .where(and(eq(fortnoxContractSuggestions.tenantId, tenantId), eq(fortnoxContractSuggestions.importBatchId, importBatchId)))
      .returning({ id: fortnoxContractSuggestions.id });
    return result.length;
  }

  // ============================================
  // CUSTOMER PORTAL - NOTIFICATION SETTINGS
  // ============================================
  
  async getCustomerNotificationSettings(tenantId: string, customerId: string): Promise<CustomerNotificationSettings | undefined> {
    const [result] = await db.select().from(customerNotificationSettings)
      .where(and(
        eq(customerNotificationSettings.tenantId, tenantId),
        eq(customerNotificationSettings.customerId, customerId)
      ));
    return result;
  }

  async upsertCustomerNotificationSettings(settings: InsertCustomerNotificationSettings): Promise<CustomerNotificationSettings> {
    const existing = await this.getCustomerNotificationSettings(settings.tenantId, settings.customerId);
    
    if (existing) {
      const [result] = await db.update(customerNotificationSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(customerNotificationSettings.id, existing.id))
        .returning();
      return result;
    }
    
    const [result] = await db.insert(customerNotificationSettings).values(settings).returning();
    return result;
  }

  // ============================================
  // PROTOCOLS
  // ============================================
  
  async getProtocols(tenantId: string, options?: { workOrderId?: string; objectId?: string; protocolType?: string; status?: string }): Promise<Protocol[]> {
    const conditions = [eq(protocols.tenantId, tenantId)];
    
    if (options?.workOrderId) {
      conditions.push(eq(protocols.workOrderId, options.workOrderId));
    }
    if (options?.objectId) {
      conditions.push(eq(protocols.objectId, options.objectId));
    }
    if (options?.protocolType) {
      conditions.push(eq(protocols.protocolType, options.protocolType));
    }
    if (options?.status) {
      conditions.push(eq(protocols.status, options.status));
    }
    
    return db.select().from(protocols)
      .where(and(...conditions))
      .orderBy(desc(protocols.executedAt));
  }

  async getProtocol(id: string): Promise<Protocol | undefined> {
    const [result] = await db.select().from(protocols).where(eq(protocols.id, id));
    return result;
  }

  async createProtocol(protocol: InsertProtocol): Promise<Protocol> {
    const [result] = await db.insert(protocols).values(protocol).returning();
    return result;
  }

  async updateProtocol(id: string, tenantId: string, data: Partial<InsertProtocol>): Promise<Protocol | undefined> {
    const [result] = await db.update(protocols)
      .set(data)
      .where(and(eq(protocols.id, id), eq(protocols.tenantId, tenantId)))
      .returning();
    return result;
  }

  async deleteProtocol(id: string, tenantId: string): Promise<void> {
    await db.delete(protocols)
      .where(and(eq(protocols.id, id), eq(protocols.tenantId, tenantId)));
  }

  // ============================================
  // DEVIATION REPORTS
  // ============================================
  
  async getDeviationReports(tenantId: string, options?: { objectId?: string; status?: string; category?: string; severity?: string }): Promise<DeviationReport[]> {
    const conditions = [eq(deviationReports.tenantId, tenantId)];
    
    if (options?.objectId) {
      conditions.push(eq(deviationReports.objectId, options.objectId));
    }
    if (options?.status) {
      conditions.push(eq(deviationReports.status, options.status));
    }
    if (options?.category) {
      conditions.push(eq(deviationReports.category, options.category));
    }
    if (options?.severity) {
      conditions.push(eq(deviationReports.severityLevel, options.severity));
    }
    
    return db.select().from(deviationReports)
      .where(and(...conditions))
      .orderBy(desc(deviationReports.reportedAt));
  }

  async getDeviationReport(id: string): Promise<DeviationReport | undefined> {
    const [result] = await db.select().from(deviationReports).where(eq(deviationReports.id, id));
    return result;
  }

  async createDeviationReport(report: InsertDeviationReport): Promise<DeviationReport> {
    const [result] = await db.insert(deviationReports).values(report).returning();
    return result;
  }

  async updateDeviationReport(id: string, tenantId: string, data: Partial<InsertDeviationReport>): Promise<DeviationReport | undefined> {
    const [result] = await db.update(deviationReports)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(deviationReports.id, id), eq(deviationReports.tenantId, tenantId)))
      .returning();
    return result;
  }

  // ============================================
  // QR CODE LINKS
  // ============================================
  
  async getQrCodeLinks(tenantId: string, objectId?: string): Promise<QrCodeLink[]> {
    const conditions = [eq(qrCodeLinks.tenantId, tenantId)];
    if (objectId) {
      conditions.push(eq(qrCodeLinks.objectId, objectId));
    }
    return db.select().from(qrCodeLinks)
      .where(and(...conditions))
      .orderBy(desc(qrCodeLinks.createdAt));
  }

  async getQrCodeLinkByCode(code: string): Promise<QrCodeLink | undefined> {
    const [result] = await db.select().from(qrCodeLinks)
      .where(eq(qrCodeLinks.code, code));
    return result;
  }

  async getQrCodeLink(id: string): Promise<QrCodeLink | undefined> {
    const [result] = await db.select().from(qrCodeLinks).where(eq(qrCodeLinks.id, id));
    return result;
  }

  async createQrCodeLink(link: InsertQrCodeLink): Promise<QrCodeLink> {
    const [result] = await db.insert(qrCodeLinks).values(link).returning();
    return result;
  }

  async updateQrCodeLink(id: string, tenantId: string, data: Partial<InsertQrCodeLink>): Promise<QrCodeLink | undefined> {
    const [result] = await db.update(qrCodeLinks)
      .set(data)
      .where(and(eq(qrCodeLinks.id, id), eq(qrCodeLinks.tenantId, tenantId)))
      .returning();
    return result;
  }

  async incrementQrCodeScanCount(id: string): Promise<void> {
    await db.update(qrCodeLinks)
      .set({ 
        scanCount: sql`${qrCodeLinks.scanCount} + 1`,
        lastScannedAt: new Date()
      })
      .where(eq(qrCodeLinks.id, id));
  }

  async deleteQrCodeLink(id: string, tenantId: string): Promise<void> {
    await db.delete(qrCodeLinks)
      .where(and(eq(qrCodeLinks.id, id), eq(qrCodeLinks.tenantId, tenantId)));
  }

  // ============================================
  // PUBLIC ISSUE REPORTS
  // ============================================
  
  async getPublicIssueReports(tenantId: string, options?: { objectId?: string; status?: string }): Promise<PublicIssueReport[]> {
    const conditions = [eq(publicIssueReports.tenantId, tenantId)];
    if (options?.objectId) {
      conditions.push(eq(publicIssueReports.objectId, options.objectId));
    }
    if (options?.status) {
      conditions.push(eq(publicIssueReports.status, options.status));
    }
    return db.select().from(publicIssueReports)
      .where(and(...conditions))
      .orderBy(desc(publicIssueReports.createdAt));
  }

  async getPublicIssueReport(id: string): Promise<PublicIssueReport | undefined> {
    const [result] = await db.select().from(publicIssueReports).where(eq(publicIssueReports.id, id));
    return result;
  }

  async createPublicIssueReport(report: InsertPublicIssueReport): Promise<PublicIssueReport> {
    const [result] = await db.insert(publicIssueReports).values(report).returning();
    return result;
  }

  async updatePublicIssueReport(id: string, tenantId: string, data: Partial<InsertPublicIssueReport>): Promise<PublicIssueReport | undefined> {
    const [result] = await db.update(publicIssueReports)
      .set(data)
      .where(and(eq(publicIssueReports.id, id), eq(publicIssueReports.tenantId, tenantId)))
      .returning();
    return result;
  }

  // ============================================
  // METADATA EDITORS ("Metadata Lämnare", Task #956)
  // ============================================

  async getMetadataEditors(tenantId: string, options?: { type?: string; isActive?: boolean }): Promise<MetadataEditor[]> {
    const conditions = [eq(metadataEditors.tenantId, tenantId)];
    if (options?.type) conditions.push(eq(metadataEditors.type, options.type));
    if (options?.isActive !== undefined) conditions.push(eq(metadataEditors.isActive, options.isActive));
    return db.select().from(metadataEditors)
      .where(and(...conditions))
      .orderBy(desc(metadataEditors.createdAt));
  }

  async getMetadataEditor(id: string, tenantId: string): Promise<MetadataEditor | undefined> {
    const [result] = await db.select().from(metadataEditors)
      .where(and(eq(metadataEditors.id, id), eq(metadataEditors.tenantId, tenantId)));
    return result;
  }

  async createMetadataEditor(editor: InsertMetadataEditor): Promise<MetadataEditor> {
    const [result] = await db.insert(metadataEditors).values(editor).returning();
    return result;
  }

  async updateMetadataEditor(id: string, tenantId: string, data: Partial<InsertMetadataEditor>): Promise<MetadataEditor | undefined> {
    const [result] = await db.update(metadataEditors)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(metadataEditors.id, id), eq(metadataEditors.tenantId, tenantId)))
      .returning();
    return result;
  }

  async deleteMetadataEditor(id: string, tenantId: string): Promise<void> {
    await db.delete(metadataEditors)
      .where(and(eq(metadataEditors.id, id), eq(metadataEditors.tenantId, tenantId)));
  }

  async getMetadataEditorFields(editorId: string, tenantId: string): Promise<MetadataEditorField[]> {
    return db.select().from(metadataEditorFields)
      .where(and(eq(metadataEditorFields.editorId, editorId), eq(metadataEditorFields.tenantId, tenantId)))
      .orderBy(asc(metadataEditorFields.sortOrder));
  }

  async createMetadataEditorField(field: InsertMetadataEditorField): Promise<MetadataEditorField> {
    const [result] = await db.insert(metadataEditorFields).values(field).returning();
    return result;
  }

  // Ersätt hela fält-uppsättningen atomiskt (used vid editor-spar). Tenant-scoped
  // delete säkrar att vi aldrig rör en annan tenants fält.
  async replaceMetadataEditorFields(editorId: string, tenantId: string, fields: InsertMetadataEditorField[]): Promise<MetadataEditorField[]> {
    return db.transaction(async (tx) => {
      await tx.delete(metadataEditorFields)
        .where(and(eq(metadataEditorFields.editorId, editorId), eq(metadataEditorFields.tenantId, tenantId)));
      if (fields.length === 0) return [];
      const rows = fields.map((f) => ({ ...f, editorId, tenantId }));
      return tx.insert(metadataEditorFields).values(rows).returning();
    });
  }

  async getMetadataEditorSubmissions(tenantId: string, options?: { editorId?: string; objectId?: string; status?: string }): Promise<MetadataEditorSubmission[]> {
    const conditions = [eq(metadataEditorSubmissions.tenantId, tenantId)];
    if (options?.editorId) conditions.push(eq(metadataEditorSubmissions.editorId, options.editorId));
    if (options?.objectId) conditions.push(eq(metadataEditorSubmissions.objectId, options.objectId));
    if (options?.status) conditions.push(eq(metadataEditorSubmissions.status, options.status));
    return db.select().from(metadataEditorSubmissions)
      .where(and(...conditions))
      .orderBy(desc(metadataEditorSubmissions.submittedAt));
  }

  async getMetadataEditorSubmission(id: string, tenantId: string): Promise<MetadataEditorSubmission | undefined> {
    const [result] = await db.select().from(metadataEditorSubmissions)
      .where(and(eq(metadataEditorSubmissions.id, id), eq(metadataEditorSubmissions.tenantId, tenantId)));
    return result;
  }

  async createMetadataEditorSubmission(submission: InsertMetadataEditorSubmission): Promise<MetadataEditorSubmission> {
    const [result] = await db.insert(metadataEditorSubmissions).values(submission).returning();
    return result;
  }

  async updateMetadataEditorSubmission(id: string, tenantId: string, data: Partial<InsertMetadataEditorSubmission>): Promise<MetadataEditorSubmission | undefined> {
    const [result] = await db.update(metadataEditorSubmissions)
      .set(data)
      .where(and(eq(metadataEditorSubmissions.id, id), eq(metadataEditorSubmissions.tenantId, tenantId)))
      .returning();
    return result;
  }

  async getMetadataEditorSubmissionValues(submissionId: string, tenantId: string): Promise<MetadataEditorSubmissionValue[]> {
    return db.select().from(metadataEditorSubmissionValues)
      .where(and(eq(metadataEditorSubmissionValues.submissionId, submissionId), eq(metadataEditorSubmissionValues.tenantId, tenantId)))
      .orderBy(asc(metadataEditorSubmissionValues.createdAt));
  }

  async createMetadataEditorSubmissionValue(value: InsertMetadataEditorSubmissionValue): Promise<MetadataEditorSubmissionValue> {
    const [result] = await db.insert(metadataEditorSubmissionValues).values(value).returning();
    return result;
  }

  async updateMetadataEditorSubmissionValue(id: string, tenantId: string, data: Partial<InsertMetadataEditorSubmissionValue>): Promise<MetadataEditorSubmissionValue | undefined> {
    const [result] = await db.update(metadataEditorSubmissionValues)
      .set(data)
      .where(and(eq(metadataEditorSubmissionValues.id, id), eq(metadataEditorSubmissionValues.tenantId, tenantId)))
      .returning();
    return result;
  }

  // ============================================
  // CUSTOMER CHANGE REQUESTS
  // ============================================

  async getCustomerChangeRequests(options: { tenantId: string; customerId?: string; objectId?: string; status?: string; category?: string; dateFrom?: string; dateTo?: string; createdByResourceId?: string; limit?: number; offset?: number }): Promise<{ items: CustomerChangeRequest[]; total: number }> {
    const conditions = [eq(customerChangeRequests.tenantId, options.tenantId)];
    if (options?.customerId) {
      conditions.push(eq(customerChangeRequests.customerId, options.customerId));
    }
    if (options?.objectId) {
      conditions.push(eq(customerChangeRequests.objectId, options.objectId));
    }
    if (options?.status) {
      conditions.push(eq(customerChangeRequests.status, options.status));
    }
    if (options?.category) {
      conditions.push(eq(customerChangeRequests.category, options.category));
    }
    if (options?.dateFrom) {
      conditions.push(gte(customerChangeRequests.createdAt, new Date(options.dateFrom)));
    }
    if (options?.dateTo) {
      const end = new Date(options.dateTo);
      end.setDate(end.getDate() + 1);
      conditions.push(lte(customerChangeRequests.createdAt, end));
    }
    if (options?.createdByResourceId) {
      conditions.push(eq(customerChangeRequests.createdByResourceId, options.createdByResourceId));
    }
    const whereClause = and(...conditions);
    const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(customerChangeRequests).where(whereClause);
    const total = Number(countResult?.count || 0);
    let query = db.select().from(customerChangeRequests).where(whereClause).orderBy(desc(customerChangeRequests.createdAt));
    if (options?.limit !== undefined) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset !== undefined) {
      query = query.offset(options.offset) as typeof query;
    }
    const items = await query;
    return { items, total };
  }

  async getCustomerChangeRequest(id: string): Promise<CustomerChangeRequest | undefined> {
    const [result] = await db.select().from(customerChangeRequests).where(eq(customerChangeRequests.id, id));
    return result;
  }

  async createCustomerChangeRequest(request: InsertCustomerChangeRequest): Promise<CustomerChangeRequest> {
    const [result] = await db.insert(customerChangeRequests).values(request).returning();
    return result;
  }

  async updateCustomerChangeRequest(id: string, tenantId: string, data: Partial<CustomerChangeRequest>): Promise<CustomerChangeRequest | undefined> {
    const [result] = await db.update(customerChangeRequests)
      .set(data)
      .where(and(eq(customerChangeRequests.id, id), eq(customerChangeRequests.tenantId, tenantId)))
      .returning();
    return result;
  }

  // ============================================
  // ENVIRONMENTAL DATA
  // ============================================
  
  async getEnvironmentalData(tenantId: string, options?: { workOrderId?: string; resourceId?: string; startDate?: Date; endDate?: Date }): Promise<EnvironmentalData[]> {
    const conditions = [eq(environmentalData.tenantId, tenantId)];
    if (options?.workOrderId) {
      conditions.push(eq(environmentalData.workOrderId, options.workOrderId));
    }
    if (options?.resourceId) {
      conditions.push(eq(environmentalData.resourceId, options.resourceId));
    }
    if (options?.startDate) {
      conditions.push(gte(environmentalData.recordedAt, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(environmentalData.recordedAt, options.endDate));
    }
    return db.select().from(environmentalData)
      .where(and(...conditions))
      .orderBy(desc(environmentalData.recordedAt));
  }

  async createEnvironmentalData(data: InsertEnvironmentalData): Promise<EnvironmentalData> {
    const [result] = await db.insert(environmentalData).values(data).returning();
    return result;
  }

  async updateEnvironmentalData(id: string, tenantId: string, data: Partial<InsertEnvironmentalData>): Promise<EnvironmentalData | undefined> {
    const [result] = await db.update(environmentalData)
      .set(data)
      .where(and(eq(environmentalData.id, id), eq(environmentalData.tenantId, tenantId)))
      .returning();
    return result;
  }

  // Customer Portal 2.0 - Visit Confirmations
  async getVisitConfirmations(tenantId: string, options?: { customerId?: string; workOrderId?: string }): Promise<VisitConfirmation[]> {
    const conditions = [eq(visitConfirmations.tenantId, tenantId)];
    if (options?.customerId) {
      conditions.push(eq(visitConfirmations.customerId, options.customerId));
    }
    if (options?.workOrderId) {
      conditions.push(eq(visitConfirmations.workOrderId, options.workOrderId));
    }
    return db.select().from(visitConfirmations)
      .where(and(...conditions))
      .orderBy(desc(visitConfirmations.createdAt));
  }

  async getVisitConfirmation(id: string): Promise<VisitConfirmation | undefined> {
    const [result] = await db.select().from(visitConfirmations).where(eq(visitConfirmations.id, id));
    return result;
  }

  async getVisitConfirmationByWorkOrder(workOrderId: string): Promise<VisitConfirmation | undefined> {
    const [result] = await db.select().from(visitConfirmations).where(eq(visitConfirmations.workOrderId, workOrderId));
    return result;
  }

  async createVisitConfirmation(confirmation: InsertVisitConfirmation): Promise<VisitConfirmation> {
    const [result] = await db.insert(visitConfirmations).values(confirmation).returning();
    return result;
  }

  // Customer Portal 2.0 - Technician Ratings
  async getTechnicianRatings(tenantId: string, options?: { resourceId?: string; customerId?: string; workOrderId?: string }): Promise<TechnicianRating[]> {
    const conditions = [eq(technicianRatings.tenantId, tenantId)];
    if (options?.resourceId) {
      conditions.push(eq(technicianRatings.resourceId, options.resourceId));
    }
    if (options?.customerId) {
      conditions.push(eq(technicianRatings.customerId, options.customerId));
    }
    if (options?.workOrderId) {
      conditions.push(eq(technicianRatings.workOrderId, options.workOrderId));
    }
    return db.select().from(technicianRatings)
      .where(and(...conditions))
      .orderBy(desc(technicianRatings.createdAt));
  }

  async getTechnicianRating(id: string): Promise<TechnicianRating | undefined> {
    const [result] = await db.select().from(technicianRatings).where(eq(technicianRatings.id, id));
    return result;
  }

  async getTechnicianRatingByWorkOrder(workOrderId: string): Promise<TechnicianRating | undefined> {
    const [result] = await db.select().from(technicianRatings).where(eq(technicianRatings.workOrderId, workOrderId));
    return result;
  }

  async createTechnicianRating(rating: InsertTechnicianRating): Promise<TechnicianRating> {
    const [result] = await db.insert(technicianRatings).values(rating).returning();
    return result;
  }

  async getResourceAverageRating(resourceId: string): Promise<{ average: number; count: number }> {
    const ratings = await db.select().from(technicianRatings).where(eq(technicianRatings.resourceId, resourceId));
    if (ratings.length === 0) {
      return { average: 0, count: 0 };
    }
    const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
    return { average: sum / ratings.length, count: ratings.length };
  }

  // Customer Portal 2.0 - Portal Messages (Chat)
  async getPortalMessages(tenantId: string, options?: { workOrderId?: string; customerId?: string; resourceId?: string; unreadOnly?: boolean }): Promise<PortalMessage[]> {
    const conditions = [eq(portalMessages.tenantId, tenantId)];
    if (options?.workOrderId) {
      conditions.push(eq(portalMessages.workOrderId, options.workOrderId));
    }
    if (options?.customerId) {
      conditions.push(eq(portalMessages.customerId, options.customerId));
    }
    if (options?.resourceId) {
      conditions.push(eq(portalMessages.resourceId, options.resourceId));
    }
    if (options?.unreadOnly) {
      conditions.push(eq(portalMessages.isRead, false));
    }
    return db.select().from(portalMessages)
      .where(and(...conditions))
      .orderBy(portalMessages.createdAt);
  }

  async getPortalMessage(id: string): Promise<PortalMessage | undefined> {
    const [result] = await db.select().from(portalMessages).where(eq(portalMessages.id, id));
    return result;
  }

  async createPortalMessage(message: InsertPortalMessage): Promise<PortalMessage> {
    const [result] = await db.insert(portalMessages).values(message).returning();
    return result;
  }

  async markMessageAsRead(id: string): Promise<PortalMessage | undefined> {
    const [result] = await db.update(portalMessages)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(portalMessages.id, id))
      .returning();
    return result;
  }

  async getUnreadMessageCount(tenantId: string, customerId?: string, resourceId?: string): Promise<number> {
    const conditions = [eq(portalMessages.tenantId, tenantId), eq(portalMessages.isRead, false)];
    if (customerId) {
      conditions.push(eq(portalMessages.customerId, customerId));
    }
    if (resourceId) {
      conditions.push(eq(portalMessages.resourceId, resourceId));
    }
    const result = await db.select({ count: sql<number>`count(*)` }).from(portalMessages).where(and(...conditions));
    return Number(result[0]?.count || 0);
  }

  // Customer Portal 2.0 - Self Booking Slots
  async getSelfBookingSlots(tenantId: string, options?: { startDate?: Date; endDate?: Date; serviceType?: string; isActive?: boolean }): Promise<SelfBookingSlot[]> {
    const conditions = [eq(selfBookingSlots.tenantId, tenantId)];
    if (options?.startDate) {
      conditions.push(gte(selfBookingSlots.slotDate, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(selfBookingSlots.slotDate, options.endDate));
    }
    if (options?.isActive !== undefined) {
      conditions.push(eq(selfBookingSlots.isActive, options.isActive));
    }
    return db.select().from(selfBookingSlots)
      .where(and(...conditions))
      .orderBy(selfBookingSlots.slotDate);
  }

  async getSelfBookingSlot(id: string): Promise<SelfBookingSlot | undefined> {
    const [result] = await db.select().from(selfBookingSlots).where(eq(selfBookingSlots.id, id));
    return result;
  }

  async createSelfBookingSlot(slot: InsertSelfBookingSlot): Promise<SelfBookingSlot> {
    const [result] = await db.insert(selfBookingSlots).values(slot).returning();
    return result;
  }

  async updateSelfBookingSlot(id: string, data: Partial<InsertSelfBookingSlot>): Promise<SelfBookingSlot | undefined> {
    const [result] = await db.update(selfBookingSlots)
      .set(data)
      .where(eq(selfBookingSlots.id, id))
      .returning();
    return result;
  }

  async deleteSelfBookingSlot(id: string): Promise<void> {
    await db.delete(selfBookingSlots).where(eq(selfBookingSlots.id, id));
  }

  async incrementSlotBookingCount(slotId: string): Promise<SelfBookingSlot | undefined> {
    const [result] = await db.update(selfBookingSlots)
      .set({ currentBookings: sql`${selfBookingSlots.currentBookings} + 1` })
      .where(eq(selfBookingSlots.id, slotId))
      .returning();
    return result;
  }

  // Customer Portal 2.0 - Self Bookings
  async getSelfBookings(tenantId: string, options?: { customerId?: string; status?: string }): Promise<SelfBooking[]> {
    const conditions = [eq(selfBookings.tenantId, tenantId)];
    if (options?.customerId) {
      conditions.push(eq(selfBookings.customerId, options.customerId));
    }
    if (options?.status) {
      conditions.push(eq(selfBookings.status, options.status));
    }
    return db.select().from(selfBookings)
      .where(and(...conditions))
      .orderBy(desc(selfBookings.createdAt));
  }

  async getSelfBooking(id: string): Promise<SelfBooking | undefined> {
    const [result] = await db.select().from(selfBookings).where(eq(selfBookings.id, id));
    return result;
  }

  async createSelfBooking(booking: InsertSelfBooking): Promise<SelfBooking> {
    const [result] = await db.insert(selfBookings).values(booking).returning();
    return result;
  }

  async updateSelfBooking(id: string, data: Partial<InsertSelfBooking>): Promise<SelfBooking | undefined> {
    const [result] = await db.update(selfBookings)
      .set(data)
      .where(eq(selfBookings.id, id))
      .returning();
    return result;
  }

  async getInspectionMetadata(tenantId: string, objectId?: string): Promise<InspectionMetadata[]> {
    const conditions = [eq(inspectionMetadata.tenantId, tenantId)];
    if (objectId) conditions.push(eq(inspectionMetadata.objectId, objectId));
    return db.select().from(inspectionMetadata).where(and(...conditions)).orderBy(desc(inspectionMetadata.inspectedAt));
  }

  async createInspectionMetadata(data: InsertInspectionMetadata): Promise<InspectionMetadata> {
    const [result] = await db.insert(inspectionMetadata).values(data).returning();
    return result;
  }

  async searchInspectionMetadata(tenantId: string, filters: { inspectionType?: string; status?: string; objectId?: string }): Promise<InspectionMetadata[]> {
    const conditions = [eq(inspectionMetadata.tenantId, tenantId)];
    if (filters.inspectionType) conditions.push(eq(inspectionMetadata.inspectionType, filters.inspectionType));
    if (filters.status) conditions.push(eq(inspectionMetadata.status, filters.status));
    if (filters.objectId) conditions.push(eq(inspectionMetadata.objectId, filters.objectId));
    return db.select().from(inspectionMetadata).where(and(...conditions)).orderBy(desc(inspectionMetadata.inspectedAt));
  }

  async getChecklistTemplates(tenantId: string): Promise<ChecklistTemplate[]> {
    return db.select().from(checklistTemplates).where(eq(checklistTemplates.tenantId, tenantId)).orderBy(checklistTemplates.name);
  }

  async getChecklistTemplate(id: string, tenantId: string): Promise<ChecklistTemplate | undefined> {
    const [result] = await db.select().from(checklistTemplates).where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.tenantId, tenantId)));
    return result || undefined;
  }

  async getChecklistTemplatesByArticleType(tenantId: string, articleType: string): Promise<ChecklistTemplate[]> {
    return db.select().from(checklistTemplates).where(
      and(eq(checklistTemplates.tenantId, tenantId), eq(checklistTemplates.articleType, articleType), eq(checklistTemplates.isActive, true))
    );
  }

  async createChecklistTemplate(template: InsertChecklistTemplate): Promise<ChecklistTemplate> {
    const [result] = await db.insert(checklistTemplates).values(template).returning();
    return result;
  }

  async updateChecklistTemplate(id: string, tenantId: string, data: Partial<InsertChecklistTemplate>): Promise<ChecklistTemplate | undefined> {
    const { tenantId: _stripped, ...safeData } = data as Partial<InsertChecklistTemplate> & { tenantId?: string };
    const [result] = await db.update(checklistTemplates).set({ ...safeData, updatedAt: new Date() }).where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.tenantId, tenantId))).returning();
    return result;
  }

  async deleteChecklistTemplate(id: string, tenantId: string): Promise<void> {
    await db.delete(checklistTemplates).where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.tenantId, tenantId)));
  }

  async getDriverNotifications(resourceId: string, options?: { unreadOnly?: boolean; limit?: number }): Promise<DriverNotification[]> {
    const conditions = [eq(driverNotifications.resourceId, resourceId)];
    if (options?.unreadOnly) conditions.push(eq(driverNotifications.isRead, false));
    let query = db.select().from(driverNotifications).where(and(...conditions)).orderBy(desc(driverNotifications.createdAt));
    if (options?.limit) query = query.limit(options.limit) as typeof query;
    return query;
  }

  async listDriverNotificationsByResource(resourceId: string, tenantId: string, options?: { types?: string[]; limit?: number }): Promise<DriverNotification[]> {
    const conditions = [
      eq(driverNotifications.resourceId, resourceId),
      eq(driverNotifications.tenantId, tenantId),
    ];
    if (options?.types && options.types.length > 0) {
      conditions.push(inArray(driverNotifications.type, options.types));
    }
    const limit = options?.limit ?? 20;
    return db
      .select()
      .from(driverNotifications)
      .where(and(...conditions))
      .orderBy(desc(driverNotifications.createdAt))
      .limit(limit);
  }

  async createDriverNotification(notification: InsertDriverNotification): Promise<DriverNotification> {
    const [result] = await db.insert(driverNotifications).values(notification).returning();
    return result;
  }

  async markDriverNotificationRead(id: string, resourceId: string): Promise<DriverNotification | undefined> {
    const [result] = await db.update(driverNotifications).set({ isRead: true }).where(and(eq(driverNotifications.id, id), eq(driverNotifications.resourceId, resourceId))).returning();
    return result;
  }

  async markAllDriverNotificationsRead(resourceId: string): Promise<number> {
    const result = await db.update(driverNotifications).set({ isRead: true }).where(and(eq(driverNotifications.resourceId, resourceId), eq(driverNotifications.isRead, false))).returning();
    return result.length;
  }

  async getUnreadNotificationCount(resourceId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(driverNotifications).where(and(eq(driverNotifications.resourceId, resourceId), eq(driverNotifications.isRead, false)));
    return Number(result[0]?.count || 0);
  }

  async getUserNotifications(userId: string, tenantId: string, options?: { unreadOnly?: boolean; readOnly?: boolean; limit?: number; offset?: number; type?: string }): Promise<UserNotification[]> {
    const conditions = [eq(userNotifications.userId, userId), eq(userNotifications.tenantId, tenantId)];
    if (options?.unreadOnly) conditions.push(eq(userNotifications.isRead, false));
    if (options?.readOnly) conditions.push(eq(userNotifications.isRead, true));
    if (options?.type) conditions.push(eq(userNotifications.type, options.type));
    return db
      .select()
      .from(userNotifications)
      .where(and(...conditions))
      .orderBy(desc(userNotifications.createdAt))
      .limit(options?.limit ?? 1000)
      .offset(options?.offset ?? 0);
  }

  async getUserNotificationsCount(userId: string, tenantId: string, options?: { unreadOnly?: boolean; readOnly?: boolean; type?: string }): Promise<number> {
    const conditions = [eq(userNotifications.userId, userId), eq(userNotifications.tenantId, tenantId)];
    if (options?.unreadOnly) conditions.push(eq(userNotifications.isRead, false));
    if (options?.readOnly) conditions.push(eq(userNotifications.isRead, true));
    if (options?.type) conditions.push(eq(userNotifications.type, options.type));
    const result = await db.select({ count: sql<number>`count(*)` }).from(userNotifications).where(and(...conditions));
    return Number(result[0]?.count || 0);
  }

  async getUserNotificationTypes(userId: string, tenantId: string): Promise<string[]> {
    const result = await db.selectDistinct({ type: userNotifications.type }).from(userNotifications).where(and(eq(userNotifications.userId, userId), eq(userNotifications.tenantId, tenantId)));
    return result.map((r: { type: string }) => r.type).sort();
  }

  async createUserNotification(notification: InsertUserNotification): Promise<UserNotification> {
    const [result] = await db.insert(userNotifications).values(notification).returning();
    return result;
  }

  async markUserNotificationRead(id: string, userId: string): Promise<UserNotification | undefined> {
    const [result] = await db.update(userNotifications).set({ isRead: true }).where(and(eq(userNotifications.id, id), eq(userNotifications.userId, userId))).returning();
    return result;
  }

  async markAllUserNotificationsRead(userId: string, tenantId: string): Promise<number> {
    const result = await db.update(userNotifications).set({ isRead: true }).where(and(eq(userNotifications.userId, userId), eq(userNotifications.tenantId, tenantId), eq(userNotifications.isRead, false))).returning();
    return result.length;
  }

  async getUnreadUserNotificationCount(userId: string, tenantId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(userNotifications).where(and(eq(userNotifications.userId, userId), eq(userNotifications.tenantId, tenantId), eq(userNotifications.isRead, false)));
    return Number(result[0]?.count || 0);
  }

  async deleteOldUserNotifications(opts: { readOlderThanDays?: number; unreadOlderThanDays?: number; tenantId?: string }): Promise<{ readDeleted: number; unreadDeleted: number }> {
    let readDeleted = 0;
    let unreadDeleted = 0;
    if (opts.readOlderThanDays && opts.readOlderThanDays > 0) {
      const cutoff = new Date(Date.now() - opts.readOlderThanDays * 24 * 60 * 60 * 1000);
      const conditions = [eq(userNotifications.isRead, true), lt(userNotifications.createdAt, cutoff)];
      if (opts.tenantId) conditions.push(eq(userNotifications.tenantId, opts.tenantId));
      const result = await db.delete(userNotifications).where(and(...conditions)).returning({ id: userNotifications.id });
      readDeleted = result.length;
    }
    if (opts.unreadOlderThanDays && opts.unreadOlderThanDays > 0) {
      const cutoff = new Date(Date.now() - opts.unreadOlderThanDays * 24 * 60 * 60 * 1000);
      const conditions = [eq(userNotifications.isRead, false), lt(userNotifications.createdAt, cutoff)];
      if (opts.tenantId) conditions.push(eq(userNotifications.tenantId, opts.tenantId));
      const result = await db.delete(userNotifications).where(and(...conditions)).returning({ id: userNotifications.id });
      unreadDeleted = result.length;
    }
    return { readDeleted, unreadDeleted };
  }

  async getUserNotificationPreference(tenantId: string, userId: string, type: string): Promise<UserNotificationPreference | undefined> {
    const [row] = await db.select().from(userNotificationPreferences)
      .where(and(
        eq(userNotificationPreferences.tenantId, tenantId),
        eq(userNotificationPreferences.userId, userId),
        eq(userNotificationPreferences.type, type),
      ))
      .limit(1);
    return row;
  }

  async getUserNotificationPreferences(userId: string, tenantId: string): Promise<UserNotificationPreference[]> {
    return db.select().from(userNotificationPreferences)
      .where(and(eq(userNotificationPreferences.userId, userId), eq(userNotificationPreferences.tenantId, tenantId)));
  }

  async setUserNotificationPreference(tenantId: string, userId: string, type: string, enabled: boolean): Promise<UserNotificationPreference> {
    const [row] = await db.insert(userNotificationPreferences)
      .values({ tenantId, userId, type, enabled })
      .onConflictDoUpdate({
        target: [userNotificationPreferences.tenantId, userNotificationPreferences.userId, userNotificationPreferences.type],
        set: { enabled, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async createOfflineSyncLog(log: InsertOfflineSyncLog): Promise<OfflineSyncLog> {
    const [result] = await db.insert(offlineSyncLog).values(log).returning();
    return result;
  }

  async getOfflineSyncLogs(resourceId: string, status?: string): Promise<OfflineSyncLog[]> {
    const conditions = [eq(offlineSyncLog.resourceId, resourceId)];
    if (status) conditions.push(eq(offlineSyncLog.status, status));
    return db.select().from(offlineSyncLog).where(and(...conditions)).orderBy(desc(offlineSyncLog.createdAt));
  }

  async updateOfflineSyncLogStatus(id: string, status: string, errorMessage?: string): Promise<OfflineSyncLog | undefined> {
    const [result] = await db.update(offlineSyncLog).set({ status, errorMessage, processedAt: new Date() }).where(eq(offlineSyncLog.id, id)).returning();
    return result;
  }

  // ============== FUEL LOGS ==============
  async getFuelLogs(tenantId: string, vehicleId?: string): Promise<FuelLog[]> {
    const conditions = [eq(fuelLogs.tenantId, tenantId)];
    if (vehicleId) conditions.push(eq(fuelLogs.vehicleId, vehicleId));
    return db.select().from(fuelLogs).where(and(...conditions)).orderBy(desc(fuelLogs.date));
  }

  async createFuelLog(log: InsertFuelLog): Promise<FuelLog> {
    const [result] = await db.insert(fuelLogs).values(log).returning();
    return result;
  }

  async deleteFuelLog(id: string, tenantId: string): Promise<void> {
    await db.delete(fuelLogs).where(and(eq(fuelLogs.id, id), eq(fuelLogs.tenantId, tenantId)));
  }

  // ============== MAINTENANCE LOGS ==============
  async getMaintenanceLogs(tenantId: string, vehicleId?: string): Promise<MaintenanceLog[]> {
    const conditions = [eq(maintenanceLogs.tenantId, tenantId)];
    if (vehicleId) conditions.push(eq(maintenanceLogs.vehicleId, vehicleId));
    return db.select().from(maintenanceLogs).where(and(...conditions)).orderBy(desc(maintenanceLogs.date));
  }

  async createMaintenanceLog(log: InsertMaintenanceLog): Promise<MaintenanceLog> {
    const [result] = await db.insert(maintenanceLogs).values(log).returning();
    return result;
  }

  async deleteMaintenanceLog(id: string, tenantId: string): Promise<void> {
    await db.delete(maintenanceLogs).where(and(eq(maintenanceLogs.id, id), eq(maintenanceLogs.tenantId, tenantId)));
  }

  // ============== OBJECT PARENTS (multi-parent relationships) ==============
  async getObjectParents(objectId: string): Promise<ObjectParent[]> {
    return db.select().from(objectParents).where(eq(objectParents.objectId, objectId)).orderBy(desc(objectParents.isPrimary), objectParents.createdAt);
  }

  // Föräldrarelationer berikade med förälderns namn + fullt släktnamn (rot →
  // förälder), så listan i "Föräldrar"-panelen kan visa entydig parentage utan
  // att hämta hela objekt-listan.
  async getObjectParentsEnriched(objectId: string, tenantId: string): Promise<ObjectParentRelationEnriched[]> {
    const rels = await db
      .select()
      .from(objectParents)
      .where(and(eq(objectParents.objectId, objectId), eq(objectParents.tenantId, tenantId)))
      .orderBy(desc(objectParents.isPrimary), objectParents.createdAt);
    if (rels.length === 0) return [];

    const parentIds = Array.from(new Set(rels.map((r) => r.parentId)));
    const ancestors = await db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT o.id AS leaf_id, o.id AS node_id, o.name, o.parent_id, 0 AS depth
        FROM objects o
        WHERE o.id IN (${sql.join(parentIds.map((id) => sql`${id}`), sql`, `)})
          AND o.tenant_id = ${tenantId}
          AND o.deleted_at IS NULL
        UNION ALL
        SELECT c.leaf_id, p.id, p.name, p.parent_id, c.depth + 1
        FROM chain c
        JOIN objects p ON p.id = c.parent_id
        WHERE p.tenant_id = ${tenantId} AND p.deleted_at IS NULL AND c.depth < 20
      )
      SELECT leaf_id AS "leafId", node_id AS "id", name, depth
      FROM chain
      ORDER BY leaf_id, depth DESC
    `);

    interface ChainRow {
      leafId: string;
      id: string;
      name: string;
      depth: number;
    }
    const chainRows = (ancestors.rows as unknown as ChainRow[]) || [];
    const pathByParent = new Map<string, Array<{ id: string; name: string }>>();
    for (const row of chainRows) {
      const arr = pathByParent.get(row.leafId) || [];
      arr.push({ id: row.id, name: row.name });
      pathByParent.set(row.leafId, arr);
    }

    return rels.map((r) => {
      const path = pathByParent.get(r.parentId) || [];
      return {
        id: r.id,
        objectId: r.objectId,
        parentId: r.parentId,
        isPrimary: r.isPrimary,
        relationContext: r.relationContext,
        createdAt: r.createdAt,
        parentName: path.length > 0 ? path[path.length - 1].name : null,
        parentPath: path,
      };
    });
  }

  async getObjectChildren(parentId: string): Promise<ObjectParent[]> {
    return db.select().from(objectParents).where(eq(objectParents.parentId, parentId)).orderBy(objectParents.createdAt);
  }

  async addObjectParent(data: InsertObjectParent): Promise<ObjectParent> {
    const [result] = await db.insert(objectParents).values(data).returning();
    return result;
  }

  // Kopplar en förälder till objektet på ett invariant-säkert sätt: servern
  // beslutar isPrimary (första föräldern = primär), insertar relationen OCH
  // speglar objects.parentId när den blir primär — allt i EN transaktion.
  // Invariant (replit.md): skriv aldrig object_parents utan att spegla
  // objects.parentId; annars syns kopplingen aldrig i Barn-kort/descendants/arv.
  // Cykel-/dubblett-/ägarskapskontroll görs i routen före anropet.
  async addObjectParentSafe(
    objectId: string,
    parentId: string,
    tenantId: string,
    relationContext?: string | null,
  ): Promise<ObjectParent> {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: objectParents.id })
        .from(objectParents)
        .where(and(eq(objectParents.objectId, objectId), eq(objectParents.tenantId, tenantId)));
      const isPrimary = existing.length === 0;
      const [result] = await tx
        .insert(objectParents)
        .values({
          objectId,
          parentId,
          tenantId,
          isPrimary,
          relationContext: relationContext ?? (isPrimary ? "primary" : "alternate"),
        })
        .returning();
      if (isPrimary) {
        await tx
          .update(objects)
          .set({ parentId })
          .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));
      }
      return result;
    });
  }

  async removeObjectParent(id: string, objectId?: string): Promise<void> {
    const conditions = [eq(objectParents.id, id)];
    if (objectId) {
      conditions.push(eq(objectParents.objectId, objectId));
    }
    // Läs relationen först så vi vet om den var primär. Invariant: objects.parentId
    // speglar alltid den primära föräldern — tas den primära bort måste en annan
    // förälder befordras, annars tappar objektet sin arvskälla/släktnamnskedja.
    // Hela delete→befordra→spegla körs i en transaktion (self-contained write) så
    // en krasch mitt i sekvensen inte kan lämna objektet utan primär/med felaktig parentId.
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(objectParents).where(and(...conditions));
      if (!row) return;
      await tx.delete(objectParents).where(and(...conditions));
      if (!row.isPrimary) return;

      // Befordra äldsta kvarvarande förälder till ny primär och spegla objects.parentId.
      const remaining = await tx
        .select()
        .from(objectParents)
        .where(eq(objectParents.objectId, row.objectId))
        .orderBy(objectParents.createdAt);
      const next = remaining[0];
      if (next) {
        await tx.update(objectParents)
          .set({ isPrimary: false })
          .where(eq(objectParents.objectId, row.objectId));
        await tx.update(objectParents)
          .set({ isPrimary: true })
          .where(eq(objectParents.id, next.id));
        await tx.update(objects)
          .set({ parentId: next.parentId })
          .where(eq(objects.id, row.objectId));
      } else {
        // Ingen förälder kvar → objektet blir ett toppnivåobjekt.
        await tx.update(objects)
          .set({ parentId: null })
          .where(eq(objects.id, row.objectId));
      }
    });
  }

  async setPrimaryParent(objectId: string, parentId: string, tenantId: string): Promise<ObjectParent | undefined> {
    await db.update(objectParents)
      .set({ isPrimary: false })
      .where(and(eq(objectParents.objectId, objectId), eq(objectParents.tenantId, tenantId)));

    const [updated] = await db.update(objectParents)
      .set({ isPrimary: true })
      .where(and(
        eq(objectParents.objectId, objectId),
        eq(objectParents.parentId, parentId),
        eq(objectParents.tenantId, tenantId)
      ))
      .returning();

    if (updated) {
      await db.update(objects)
        .set({ parentId })
        .where(eq(objects.id, objectId));
    }

    return updated || undefined;
  }

  // Returnerar true om det skulle skapa en cykel att sätta objectId:s förälder till
  // candidateParentId. En cykel uppstår om candidateParentId är objectId självt eller
  // en ättling till objectId (dvs objectId finns i candidateParentId:s primära
  // förälder-kedja). Vandrar uppåt via objects.parentId (primärkedjan) med en
  // visited-vakt så pre-existerande korrupt data inte ger oändlig loop.
  async wouldCreateObjectCycle(tenantId: string, objectId: string, candidateParentId: string | null): Promise<boolean> {
    if (!candidateParentId) return false;
    if (candidateParentId === objectId) return true;
    const visited = new Set<string>();
    let current: string | null = candidateParentId;
    while (current) {
      if (current === objectId) return true;
      if (visited.has(current)) break;
      visited.add(current);
      const [row] = await db
        .select({ parentId: objects.parentId })
        .from(objects)
        .where(and(eq(objects.id, current), eq(objects.tenantId, tenantId)));
      current = row?.parentId ?? null;
    }
    return false;
  }

  async moveObject(objectId: string, newParentId: string | null, tenantId: string): Promise<ServiceObject | undefined> {
    if (newParentId && newParentId === objectId) {
      throw new Error("Ett objekt kan inte bli sin egen förälder.");
    }
    if (await this.wouldCreateObjectCycle(tenantId, objectId, newParentId)) {
      throw new Error("Du kan inte flytta ett objekt till ett av sina egna underordnade objekt (skulle skapa en cykel).");
    }
    const [obj] = await db.select().from(objects)
      .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));
    if (!obj) return undefined;

    // Atomiskt: håll objects.parentId och primär object_parents-rad i synk så vi
    // aldrig lämnar ett halvflyttat tillstånd vid fel mitt i.
    await db.transaction(async (tx) => {
      await tx.update(objects)
        .set({ parentId: newParentId })
        .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));

      // Demota alla nuvarande primära relationer för objektet.
      await tx.update(objectParents)
        .set({ isPrimary: false })
        .where(and(eq(objectParents.objectId, objectId), eq(objectParents.tenantId, tenantId)));

      if (newParentId) {
        const existing = await tx.select().from(objectParents)
          .where(and(
            eq(objectParents.objectId, objectId),
            eq(objectParents.parentId, newParentId),
            eq(objectParents.tenantId, tenantId),
          ));
        if (existing.length > 0) {
          await tx.update(objectParents)
            .set({ isPrimary: true })
            .where(and(
              eq(objectParents.objectId, objectId),
              eq(objectParents.parentId, newParentId),
              eq(objectParents.tenantId, tenantId),
            ));
        } else {
          await tx.insert(objectParents).values({
            tenantId,
            objectId,
            parentId: newParentId,
            isPrimary: true,
            relationContext: "primary",
          });
        }
      }
    });

    const [moved] = await db.select().from(objects)
      .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));
    if (!moved) return undefined;
    return { ...moved, customerId: await getObjectPrimaryCustomerId(moved.id) };
  }

  async getResourceProfiles(tenantId: string): Promise<ResourceProfile[]> {
    return db.select().from(resourceProfiles).where(eq(resourceProfiles.tenantId, tenantId)).orderBy(resourceProfiles.name);
  }

  async getResourceProfile(id: string): Promise<ResourceProfile | undefined> {
    const [profile] = await db.select().from(resourceProfiles).where(eq(resourceProfiles.id, id));
    return profile || undefined;
  }

  async createResourceProfile(profile: InsertResourceProfile): Promise<ResourceProfile> {
    const [result] = await db.insert(resourceProfiles).values(profile).returning();
    return result;
  }

  async updateResourceProfile(id: string, data: Partial<Omit<InsertResourceProfile, 'tenantId'>>): Promise<ResourceProfile | undefined> {
    const [result] = await db.update(resourceProfiles).set({ ...data, updatedAt: new Date() }).where(eq(resourceProfiles.id, id)).returning();
    return result || undefined;
  }

  async deleteResourceProfile(id: string, tenantId?: string): Promise<void> {
    const conditions = [eq(resourceProfileAssignments.profileId, id)];
    if (tenantId) conditions.push(eq(resourceProfileAssignments.tenantId, tenantId));
    await db.delete(resourceProfileAssignments).where(and(...conditions));
    const delConditions = [eq(resourceProfiles.id, id)];
    if (tenantId) delConditions.push(eq(resourceProfiles.tenantId, tenantId));
    await db.delete(resourceProfiles).where(and(...delConditions));
  }

  async getResourceProfileAssignments(tenantId: string, profileId?: string, resourceId?: string): Promise<ResourceProfileAssignment[]> {
    const conditions = [eq(resourceProfileAssignments.tenantId, tenantId)];
    if (profileId) conditions.push(eq(resourceProfileAssignments.profileId, profileId));
    if (resourceId) conditions.push(eq(resourceProfileAssignments.resourceId, resourceId));
    return db.select().from(resourceProfileAssignments).where(and(...conditions));
  }

  async assignResourceProfile(data: InsertResourceProfileAssignment): Promise<ResourceProfileAssignment> {
    const [result] = await db.insert(resourceProfileAssignments).values(data).returning();
    return result;
  }

  async removeResourceProfileAssignment(id: string): Promise<void> {
    await db.delete(resourceProfileAssignments).where(eq(resourceProfileAssignments.id, id));
  }

  async removeResourceProfileAssignmentByPair(profileId: string, resourceId: string): Promise<void> {
    await db.delete(resourceProfileAssignments).where(and(eq(resourceProfileAssignments.profileId, profileId), eq(resourceProfileAssignments.resourceId, resourceId)));
  }

  async getWorkSessions(tenantId: string, options?: { resourceId?: string; teamId?: string; startDate?: Date; endDate?: Date; status?: string }): Promise<WorkSession[]> {
    const conditions = [eq(workSessions.tenantId, tenantId)];
    if (options?.resourceId) conditions.push(eq(workSessions.resourceId, options.resourceId));
    if (options?.teamId) conditions.push(eq(workSessions.teamId, options.teamId));
    if (options?.status) conditions.push(eq(workSessions.status, options.status));
    if (options?.startDate) conditions.push(gte(workSessions.date, options.startDate));
    if (options?.endDate) conditions.push(lte(workSessions.date, options.endDate));
    return db.select().from(workSessions).where(and(...conditions)).orderBy(desc(workSessions.date));
  }

  async getWorkSession(id: string): Promise<WorkSession | undefined> {
    const [session] = await db.select().from(workSessions).where(eq(workSessions.id, id));
    return session || undefined;
  }

  async createWorkSession(session: InsertWorkSession): Promise<WorkSession> {
    const [result] = await db.insert(workSessions).values(session).returning();
    return result;
  }

  async updateWorkSession(id: string, data: Partial<InsertWorkSession>): Promise<WorkSession | undefined> {
    const [result] = await db.update(workSessions).set({ ...data, updatedAt: new Date() }).where(eq(workSessions.id, id)).returning();
    return result || undefined;
  }

  async deleteWorkSession(id: string): Promise<void> {
    await db.delete(workEntries).where(eq(workEntries.workSessionId, id));
    await db.delete(workSessions).where(eq(workSessions.id, id));
  }

  async getWorkEntries(workSessionId: string): Promise<WorkEntry[]> {
    return db.select().from(workEntries).where(eq(workEntries.workSessionId, workSessionId)).orderBy(workEntries.startTime);
  }

  async getWorkEntriesByResource(tenantId: string, resourceId: string, startDate?: Date, endDate?: Date): Promise<WorkEntry[]> {
    const conditions = [eq(workEntries.tenantId, tenantId), eq(workEntries.resourceId, resourceId)];
    if (startDate) conditions.push(gte(workEntries.startTime, startDate));
    if (endDate) conditions.push(lte(workEntries.startTime, endDate));
    return db.select().from(workEntries).where(and(...conditions)).orderBy(workEntries.startTime);
  }

  async getWorkEntry(id: string): Promise<WorkEntry | undefined> {
    const [entry] = await db.select().from(workEntries).where(eq(workEntries.id, id));
    return entry || undefined;
  }

  async createWorkEntry(entry: InsertWorkEntry): Promise<WorkEntry> {
    const [result] = await db.insert(workEntries).values(entry).returning();
    return result;
  }

  async updateWorkEntry(id: string, data: Partial<InsertWorkEntry>): Promise<WorkEntry | undefined> {
    const [result] = await db.update(workEntries).set(data).where(eq(workEntries.id, id)).returning();
    return result || undefined;
  }

  async deleteWorkEntry(id: string): Promise<void> {
    await db.delete(workEntries).where(eq(workEntries.id, id));
  }

  async getEquipmentBookings(tenantId: string, options?: { vehicleId?: string; equipmentId?: string; resourceId?: string; teamId?: string; date?: Date; startDate?: Date; endDate?: Date; status?: string }): Promise<EquipmentBooking[]> {
    const conditions = [eq(equipmentBookings.tenantId, tenantId)];
    if (options?.vehicleId) conditions.push(eq(equipmentBookings.vehicleId, options.vehicleId));
    if (options?.equipmentId) conditions.push(eq(equipmentBookings.equipmentId, options.equipmentId));
    if (options?.resourceId) conditions.push(eq(equipmentBookings.resourceId, options.resourceId));
    if (options?.teamId) conditions.push(eq(equipmentBookings.teamId, options.teamId));
    if (options?.status) conditions.push(eq(equipmentBookings.status, options.status));
    if (options?.date) {
      const dayStart = new Date(options.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(options.date);
      dayEnd.setHours(23, 59, 59, 999);
      conditions.push(gte(equipmentBookings.date, dayStart));
      conditions.push(lte(equipmentBookings.date, dayEnd));
    }
    if (options?.startDate) conditions.push(gte(equipmentBookings.date, options.startDate));
    if (options?.endDate) conditions.push(lte(equipmentBookings.date, options.endDate));
    return db.select().from(equipmentBookings).where(and(...conditions)).orderBy(desc(equipmentBookings.date));
  }

  async getEquipmentBooking(id: string): Promise<EquipmentBooking | undefined> {
    const [result] = await db.select().from(equipmentBookings).where(eq(equipmentBookings.id, id));
    return result || undefined;
  }

  async createEquipmentBooking(booking: InsertEquipmentBooking): Promise<EquipmentBooking> {
    const [result] = await db.insert(equipmentBookings).values(booking).returning();
    return result;
  }

  async updateEquipmentBooking(id: string, data: Partial<InsertEquipmentBooking>): Promise<EquipmentBooking | undefined> {
    const [result] = await db.update(equipmentBookings).set(data).where(eq(equipmentBookings.id, id)).returning();
    return result || undefined;
  }

  async deleteEquipmentBooking(id: string): Promise<void> {
    await db.delete(equipmentBookings).where(eq(equipmentBookings.id, id));
  }

  async releaseEquipmentByWorkSession(workSessionId: string): Promise<number> {
    const bySession = await db.update(equipmentBookings)
      .set({ status: "released" })
      .where(and(eq(equipmentBookings.workSessionId, workSessionId), eq(equipmentBookings.status, "active")))
      .returning();

    const session = await this.getWorkSession(workSessionId);
    let byResource = 0;
    if (session && session.resourceId && session.date) {
      const sessionDate = new Date(session.date);
      const dayStart = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const fallback = await db.update(equipmentBookings)
        .set({ status: "released" })
        .where(and(
          eq(equipmentBookings.tenantId, session.tenantId),
          eq(equipmentBookings.resourceId, session.resourceId),
          gte(equipmentBookings.date, dayStart),
          lt(equipmentBookings.date, dayEnd),
          eq(equipmentBookings.status, "active"),
          isNull(equipmentBookings.workSessionId),
        ))
        .returning();
      byResource = fallback.length;
    }
    return bySession.length + byResource;
  }

  async getIotDevices(tenantId: string): Promise<IotDevice[]> {
    return db.select().from(iotDevices).where(eq(iotDevices.tenantId, tenantId)).orderBy(desc(iotDevices.createdAt));
  }

  async getIotDevice(id: string): Promise<IotDevice | undefined> {
    const [result] = await db.select().from(iotDevices).where(eq(iotDevices.id, id));
    return result || undefined;
  }

  async getIotDeviceByExternalId(tenantId: string, externalDeviceId: string): Promise<IotDevice | undefined> {
    const [result] = await db.select().from(iotDevices).where(and(eq(iotDevices.tenantId, tenantId), eq(iotDevices.externalDeviceId, externalDeviceId)));
    return result || undefined;
  }

  async createIotDevice(device: InsertIotDevice): Promise<IotDevice> {
    const [result] = await db.insert(iotDevices).values(device).returning();
    return result;
  }

  async updateIotDevice(id: string, data: Partial<InsertIotDevice>): Promise<IotDevice | undefined> {
    const [result] = await db.update(iotDevices).set(data).where(eq(iotDevices.id, id)).returning();
    return result || undefined;
  }

  async deleteIotDevice(id: string): Promise<void> {
    await db.delete(iotSignals).where(eq(iotSignals.deviceId, id));
    await db.delete(iotDevices).where(eq(iotDevices.id, id));
  }

  async getIotApiKeys(tenantId: string): Promise<IotApiKey[]> {
    return db.select().from(iotApiKeys).where(eq(iotApiKeys.tenantId, tenantId)).orderBy(desc(iotApiKeys.createdAt));
  }

  async getIotApiKeyByKey(apiKey: string): Promise<IotApiKey | undefined> {
    const [result] = await db.select().from(iotApiKeys).where(and(eq(iotApiKeys.apiKey, apiKey), eq(iotApiKeys.status, "active")));
    return result || undefined;
  }

  async createIotApiKey(key: InsertIotApiKey): Promise<IotApiKey> {
    const [result] = await db.insert(iotApiKeys).values(key).returning();
    return result;
  }

  async deleteIotApiKey(id: string): Promise<void> {
    await db.delete(iotApiKeys).where(eq(iotApiKeys.id, id));
  }

  async getIotSignals(tenantId: string, options?: { deviceId?: string; limit?: number }): Promise<IotSignal[]> {
    const conditions = [eq(iotSignals.tenantId, tenantId)];
    if (options?.deviceId) conditions.push(eq(iotSignals.deviceId, options.deviceId));
    const query = db.select().from(iotSignals).where(and(...conditions)).orderBy(desc(iotSignals.createdAt));
    if (options?.limit) return query.limit(options.limit);
    return query.limit(100);
  }

  async createIotSignal(signal: InsertIotSignal): Promise<IotSignal> {
    const [result] = await db.insert(iotSignals).values(signal).returning();
    return result;
  }

  async updateIotSignal(id: string, data: Partial<InsertIotSignal>): Promise<IotSignal | undefined> {
    const [result] = await db.update(iotSignals).set(data).where(eq(iotSignals.id, id)).returning();
    return result || undefined;
  }

  async getRouteFeedback(tenantId: string, options?: { resourceId?: string; startDate?: string; endDate?: string; limit?: number }): Promise<RouteFeedback[]> {
    const conditions = [eq(routeFeedback.tenantId, tenantId)];
    if (options?.resourceId) conditions.push(eq(routeFeedback.resourceId, options.resourceId));
    if (options?.startDate) conditions.push(gte(routeFeedback.date, options.startDate));
    if (options?.endDate) conditions.push(lte(routeFeedback.date, options.endDate));
    const query = db.select().from(routeFeedback).where(and(...conditions)).orderBy(desc(routeFeedback.createdAt));
    return options?.limit ? query.limit(options.limit) : query.limit(200);
  }

  async createRouteFeedback(feedback: InsertRouteFeedback): Promise<RouteFeedback> {
    const [result] = await db.insert(routeFeedback).values(feedback).returning();
    return result;
  }

  async getRouteFeedbackSummary(tenantId: string, options?: { startDate?: string; endDate?: string; resourceIds?: string[] }): Promise<{ avgRating: number; totalCount: number; byCategory: Record<string, number>; byResource: { resourceId: string; avgRating: number; count: number }[]; ratingDistribution: Record<number, number>; byDay: { date: string; avgRating: number; count: number }[] }> {
    const conditions = [eq(routeFeedback.tenantId, tenantId)];
    if (options?.startDate) conditions.push(gte(routeFeedback.date, options.startDate));
    if (options?.endDate) conditions.push(lte(routeFeedback.date, options.endDate));
    if (options?.resourceIds && options.resourceIds.length > 0) {
      conditions.push(inArray(routeFeedback.resourceId, options.resourceIds));
    }

    const rows = await db.select().from(routeFeedback).where(and(...conditions));

    const totalCount = rows.length;
    const avgRating = totalCount > 0 ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / totalCount) * 10) / 10 : 0;

    const byCategory: Record<string, number> = {};
    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const resourceMap = new Map<string, { sum: number; count: number }>();
    const dayMap = new Map<string, { sum: number; count: number }>();

    for (const row of rows) {
      if (row.reasonCategory) byCategory[row.reasonCategory] = (byCategory[row.reasonCategory] || 0) + 1;
      ratingDistribution[row.rating] = (ratingDistribution[row.rating] || 0) + 1;
      const rm = resourceMap.get(row.resourceId) || { sum: 0, count: 0 };
      rm.sum += row.rating;
      rm.count += 1;
      resourceMap.set(row.resourceId, rm);
      const dm = dayMap.get(row.date) || { sum: 0, count: 0 };
      dm.sum += row.rating;
      dm.count += 1;
      dayMap.set(row.date, dm);
    }

    const byResource = Array.from(resourceMap.entries()).map(([resourceId, { sum, count }]) => ({
      resourceId,
      avgRating: Math.round((sum / count) * 10) / 10,
      count,
    }));

    const byDay = Array.from(dayMap.entries())
      .map(([date, { sum, count }]) => ({
        date,
        avgRating: Math.round((sum / count) * 10) / 10,
        count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { avgRating, totalCount, byCategory, byResource, ratingDistribution, byDay };
  }

  // ============== Task #785: Veckoplanering – datafundament ==============
  // Geografiska distrikt
  async getGeographicDistricts(tenantId: string): Promise<GeographicDistrict[]> {
    return db.select().from(geographicDistricts)
      .where(and(eq(geographicDistricts.tenantId, tenantId), isNull(geographicDistricts.deletedAt)))
      .orderBy(geographicDistricts.name);
  }
  async getGeographicDistrict(tenantId: string, id: string): Promise<GeographicDistrict | undefined> {
    const [row] = await db.select().from(geographicDistricts)
      .where(and(eq(geographicDistricts.id, id), eq(geographicDistricts.tenantId, tenantId), isNull(geographicDistricts.deletedAt)));
    return row || undefined;
  }
  async createGeographicDistrict(data: InsertGeographicDistrict): Promise<GeographicDistrict> {
    const [row] = await db.insert(geographicDistricts).values(data).returning();
    return row;
  }
  async updateGeographicDistrict(tenantId: string, id: string, data: Partial<InsertGeographicDistrict>): Promise<GeographicDistrict | undefined> {
    const { tenantId: _t, ...patch } = data as Partial<InsertGeographicDistrict>;
    const [row] = await db.update(geographicDistricts).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(geographicDistricts.id, id), eq(geographicDistricts.tenantId, tenantId))).returning();
    return row || undefined;
  }
  async deleteGeographicDistrict(tenantId: string, id: string): Promise<void> {
    await db.update(geographicDistricts).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(geographicDistricts.id, id), eq(geographicDistricts.tenantId, tenantId)));
  }

  // ============== Task #1240: Delad filtermotor — sparade filter ==============
  // Synliga för en användare inom en yta: egna filter + delade filter (isShared)
  // vars roles-lista är tom eller innehåller inget krav (rollfiltrering görs av
  // anropande route utifrån den inloggades roll, se filterRoutes.ts).
  async getSavedFilters(tenantId: string, scope: string, userId: string): Promise<SavedFilter[]> {
    return db.select().from(savedFilters)
      .where(and(
        eq(savedFilters.tenantId, tenantId),
        eq(savedFilters.scope, scope),
        or(eq(savedFilters.userId, userId), eq(savedFilters.isShared, true)),
      ))
      .orderBy(savedFilters.name);
  }
  async createSavedFilter(tenantId: string, userId: string, data: InsertSavedFilter): Promise<SavedFilter> {
    const [row] = await db.insert(savedFilters).values({ ...data, tenantId, userId }).returning();
    return row;
  }
  async updateSavedFilter(tenantId: string, userId: string, id: string, data: Partial<InsertSavedFilter>): Promise<SavedFilter | undefined> {
    const [row] = await db.update(savedFilters).set({ ...data, updatedAt: new Date() })
      .where(and(eq(savedFilters.id, id), eq(savedFilters.tenantId, tenantId), eq(savedFilters.userId, userId)))
      .returning();
    return row || undefined;
  }
  async deleteSavedFilter(tenantId: string, userId: string, id: string): Promise<void> {
    await db.delete(savedFilters)
      .where(and(eq(savedFilters.id, id), eq(savedFilters.tenantId, tenantId), eq(savedFilters.userId, userId)));
  }

  // Distrikt-zoner
  async getDistrictZones(tenantId: string, districtId?: string): Promise<DistrictZone[]> {
    const conds: Condition[] = [eq(districtZones.tenantId, tenantId)];
    if (districtId) conds.push(eq(districtZones.districtId, districtId));
    return db.select().from(districtZones).where(and(...conds)).orderBy(districtZones.name);
  }
  async getDistrictZone(tenantId: string, id: string): Promise<DistrictZone | undefined> {
    const [row] = await db.select().from(districtZones)
      .where(and(eq(districtZones.id, id), eq(districtZones.tenantId, tenantId)));
    return row || undefined;
  }
  async createDistrictZone(data: InsertDistrictZone): Promise<DistrictZone> {
    const [row] = await db.insert(districtZones).values(data).returning();
    return row;
  }
  async updateDistrictZone(tenantId: string, id: string, data: Partial<InsertDistrictZone>): Promise<DistrictZone | undefined> {
    const { tenantId: _t, ...patch } = data as Partial<InsertDistrictZone>;
    const [row] = await db.update(districtZones).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(districtZones.id, id), eq(districtZones.tenantId, tenantId))).returning();
    return row || undefined;
  }
  async deleteDistrictZone(tenantId: string, id: string): Promise<void> {
    await db.delete(districtZones).where(and(eq(districtZones.id, id), eq(districtZones.tenantId, tenantId)));
  }

  // Veckoplaner
  async getWeeklyPlans(tenantId: string, opts?: { teamId?: string; year?: number; weekNumber?: number; status?: string }): Promise<WeeklyPlan[]> {
    const conds: Condition[] = [eq(weeklyPlans.tenantId, tenantId), isNull(weeklyPlans.deletedAt)];
    if (opts?.teamId) conds.push(eq(weeklyPlans.teamId, opts.teamId));
    if (opts?.year !== undefined) conds.push(eq(weeklyPlans.year, opts.year));
    if (opts?.weekNumber !== undefined) conds.push(eq(weeklyPlans.weekNumber, opts.weekNumber));
    if (opts?.status) conds.push(eq(weeklyPlans.status, opts.status));
    return db.select().from(weeklyPlans).where(and(...conds))
      .orderBy(desc(weeklyPlans.year), desc(weeklyPlans.weekNumber));
  }
  async getWeeklyPlan(tenantId: string, id: string): Promise<WeeklyPlan | undefined> {
    const [row] = await db.select().from(weeklyPlans)
      .where(and(eq(weeklyPlans.id, id), eq(weeklyPlans.tenantId, tenantId), isNull(weeklyPlans.deletedAt)));
    return row || undefined;
  }
  async createWeeklyPlan(data: InsertWeeklyPlan): Promise<WeeklyPlan> {
    // contracted_hours defaultas från team.totalHoursWeek om ej angiven.
    let values = data;
    if (values.contractedHours === undefined || values.contractedHours === null) {
      const [team] = await db.select({ totalHoursWeek: teams.totalHoursWeek }).from(teams)
        .where(and(eq(teams.id, data.teamId), eq(teams.tenantId, data.tenantId)));
      if (team?.totalHoursWeek != null) values = { ...values, contractedHours: team.totalHoursWeek };
    }
    const [row] = await db.insert(weeklyPlans).values(values).returning();
    return row;
  }
  async updateWeeklyPlan(tenantId: string, id: string, data: Partial<InsertWeeklyPlan>): Promise<WeeklyPlan | undefined> {
    const { tenantId: _t, ...patch } = data as Partial<InsertWeeklyPlan>;
    const [row] = await db.update(weeklyPlans).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(weeklyPlans.id, id), eq(weeklyPlans.tenantId, tenantId))).returning();
    return row || undefined;
  }
  async deleteWeeklyPlan(tenantId: string, id: string): Promise<void> {
    await db.update(weeklyPlans).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(weeklyPlans.id, id), eq(weeklyPlans.tenantId, tenantId)));
  }

  // === Task #1037: Slottids-register ===
  // Motorns beräknade slottider per uppgift/klumpuppgift. tenant_id i varje
  // predikat; soft-delete via deletedAt. Storheter (ordervärde/kostnad/
  // produktionstid) bor på assignments (cachedValue/cachedCost/estimatedDuration).
  async getSlotTimes(tenantId: string, opts?: { assignmentId?: string; assignmentGroupKey?: string; status?: string }): Promise<SlotTime[]> {
    const conds: Condition[] = [eq(slotTimes.tenantId, tenantId), isNull(slotTimes.deletedAt)];
    if (opts?.assignmentId) conds.push(eq(slotTimes.assignmentId, opts.assignmentId));
    if (opts?.assignmentGroupKey) conds.push(eq(slotTimes.assignmentGroupKey, opts.assignmentGroupKey));
    if (opts?.status) conds.push(eq(slotTimes.status, opts.status));
    return db.select().from(slotTimes).where(and(...conds))
      .orderBy(slotTimes.rank, slotTimes.windowStart);
  }
  async getSlotTime(tenantId: string, id: string): Promise<SlotTime | undefined> {
    const [row] = await db.select().from(slotTimes)
      .where(and(eq(slotTimes.id, id), eq(slotTimes.tenantId, tenantId), isNull(slotTimes.deletedAt)));
    return row || undefined;
  }
  async createSlotTime(data: InsertSlotTime): Promise<SlotTime> {
    const [row] = await db.insert(slotTimes).values(data).returning();
    return row;
  }
  // Bulk-insert (Task #1038, tidsmotorn). Chunkar för att hålla nere parameter-
  // antalet per sats. Returnerar antal skapade rader.
  async createSlotTimes(rows: InsertSlotTime[]): Promise<number> {
    if (rows.length === 0) return 0;
    const CHUNK = 200;
    let created = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const inserted = await db.insert(slotTimes).values(slice).returning({ id: slotTimes.id });
      created += inserted.length;
    }
    return created;
  }
  // Idempotent rensning av motor-genererade slottider (source-stämplade) inför en
  // omkörning. Soft-delete: task-rader för de bearbetade uppgifterna OCH grupp-
  // rader (assignment_id IS NULL) vars fönster ligger i perioden. tenant_id i
  // varje predikat (defense-in-depth, multi-tenant).
  async clearEngineSlotTimes(
    tenantId: string,
    source: string,
    opts: { assignmentIds?: string[]; windowStart?: Date; windowEnd?: Date },
  ): Promise<number> {
    const stamp = { deletedAt: new Date(), updatedAt: new Date() };
    let count = 0;
    if (opts.assignmentIds && opts.assignmentIds.length > 0) {
      const taskRows = await db.update(slotTimes).set(stamp)
        .where(and(
          eq(slotTimes.tenantId, tenantId),
          eq(slotTimes.source, source),
          isNull(slotTimes.deletedAt),
          inArray(slotTimes.assignmentId, opts.assignmentIds),
        )).returning({ id: slotTimes.id });
      count += taskRows.length;
    }
    if (opts.windowStart && opts.windowEnd) {
      const groupRows = await db.update(slotTimes).set(stamp)
        .where(and(
          eq(slotTimes.tenantId, tenantId),
          eq(slotTimes.source, source),
          isNull(slotTimes.deletedAt),
          isNull(slotTimes.assignmentId),
          gte(slotTimes.windowStart, opts.windowStart),
          lte(slotTimes.windowStart, opts.windowEnd),
        )).returning({ id: slotTimes.id });
      count += groupRows.length;
    }
    return count;
  }
  // Planerarens beslut (accepterad/avvisad/null) på motorns slottider (Task #1043).
  // Stämplar ALLA aktiva tidsmotor-rader för de angivna assignment-id:na och/eller
  // klump-nyckeln. tenant_id i WHERE = tenant-säkert (defense-in-depth).
  async setSlotTimePlannerDecision(
    tenantId: string,
    opts: { assignmentIds?: string[]; assignmentGroupKey?: string; decision: string | null; decidedBy: string | null },
  ): Promise<number> {
    const stamp = {
      plannerDecision: opts.decision,
      decidedAt: opts.decision ? new Date() : null,
      decidedBy: opts.decision ? opts.decidedBy : null,
      updatedAt: new Date(),
    };
    let count = 0;
    if (opts.assignmentIds && opts.assignmentIds.length > 0) {
      const rows = await db.update(slotTimes).set(stamp)
        .where(and(
          eq(slotTimes.tenantId, tenantId),
          eq(slotTimes.source, "tidsmotor"),
          isNull(slotTimes.deletedAt),
          inArray(slotTimes.assignmentId, opts.assignmentIds),
        )).returning({ id: slotTimes.id });
      count += rows.length;
    }
    if (opts.assignmentGroupKey) {
      const rows = await db.update(slotTimes).set(stamp)
        .where(and(
          eq(slotTimes.tenantId, tenantId),
          eq(slotTimes.source, "tidsmotor"),
          isNull(slotTimes.deletedAt),
          isNull(slotTimes.assignmentId),
          eq(slotTimes.assignmentGroupKey, opts.assignmentGroupKey),
        )).returning({ id: slotTimes.id });
      count += rows.length;
    }
    return count;
  }
  // Tenant-default grupperingsradie (meter) från planning_parameters-raden utan
  // kund/objekt-scope (customer_id IS NULL AND object_id IS NULL). null = ej satt.
  async getTenantGroupingRadiusMeters(tenantId: string): Promise<number | null> {
    const [row] = await db.select({ radius: planningParameters.groupingRadiusMeters })
      .from(planningParameters)
      .where(and(
        eq(planningParameters.tenantId, tenantId),
        isNull(planningParameters.customerId),
        isNull(planningParameters.objectId),
      ))
      .limit(1);
    return row?.radius ?? null;
  }

  // Task #1234 (Motor-/regeladministration): den generella tenant-raden
  // (customer_id IS NULL AND object_id IS NULL) bär motor-defaults för
  // klumpmotor/restidsmotor/planeringsmotor. undefined = ingen rad ännu.
  async getTenantEngineDefaults(tenantId: string): Promise<PlanningParameter | undefined> {
    const [row] = await db.select().from(planningParameters)
      .where(and(
        eq(planningParameters.tenantId, tenantId),
        isNull(planningParameters.customerId),
        isNull(planningParameters.objectId),
      ))
      .limit(1);
    return row || undefined;
  }

  // Skapar eller uppdaterar den generella tenant-raden med motor-parametrar.
  // Övriga fält (SLA m.m.) på en redan existerande rad rörs inte.
  async upsertTenantEngineDefaults(
    tenantId: string,
    data: Partial<InsertPlanningParameter>,
  ): Promise<PlanningParameter> {
    const existing = await this.getTenantEngineDefaults(tenantId);
    if (existing) {
      const [result] = await db.update(planningParameters)
        .set(data)
        .where(and(eq(planningParameters.id, existing.id), eq(planningParameters.tenantId, tenantId)))
        .returning();
      return result;
    }
    const [result] = await db.insert(planningParameters)
      .values({ ...data, tenantId, customerId: null, objectId: null })
      .returning();
    return result;
  }
  // Etapp 5: leveranspreferenser bor enbart på kundnivå — batch-läsning för
  // tidsmotorn (rå JSONB; anroparen validerar via deliveryPreferencesSchema).
  async getCustomersDeliveryPreferences(customerIds: string[]): Promise<Map<string, unknown>> {
    const map = new Map<string, unknown>();
    if (customerIds.length === 0) return map;
    const rows = await db
      .select({ id: customers.id, prefs: customers.deliveryPreferences })
      .from(customers)
      .where(inArray(customers.id, customerIds));
    for (const row of rows) map.set(row.id, row.prefs ?? null);
    return map;
  }
  async getObjectsPrimaryCustomerIds(objectIds: string[]): Promise<Map<string, string | null>> {
    const { getObjectsPrimaryCustomerIds } = await import("./services/object-customer");
    return getObjectsPrimaryCustomerIds(objectIds);
  }
  async updateSlotTime(tenantId: string, id: string, data: Partial<InsertSlotTime>): Promise<SlotTime | undefined> {
    const { tenantId: _t, ...patch } = data as Partial<InsertSlotTime>;
    const [row] = await db.update(slotTimes).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(slotTimes.id, id), eq(slotTimes.tenantId, tenantId))).returning();
    return row || undefined;
  }
  async deleteSlotTime(tenantId: string, id: string): Promise<void> {
    await db.update(slotTimes).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(slotTimes.id, id), eq(slotTimes.tenantId, tenantId)));
  }

  // Veckoplan-uppgifter
  async getWeeklyPlanTasks(tenantId: string, weeklyPlanId: string): Promise<WeeklyPlanTask[]> {
    return db.select().from(weeklyPlanTasks)
      .where(and(eq(weeklyPlanTasks.tenantId, tenantId), eq(weeklyPlanTasks.weeklyPlanId, weeklyPlanId)))
      .orderBy(weeklyPlanTasks.plannedDate, weeklyPlanTasks.sequence);
  }
  async getWeeklyPlanTaskFacts(tenantId: string, taskIds: string[]): Promise<WeeklyPlanTaskFact[]> {
    if (taskIds.length === 0) return [];
    const rows = await db
      .select({
        taskId: workOrders.id,
        title: workOrders.title,
        cachedValue: workOrders.cachedValue,
        cachedProductionMinutes: workOrders.cachedProductionMinutes,
        estimatedDuration: workOrders.estimatedDuration,
        taskLat: workOrders.taskLatitude,
        taskLng: workOrders.taskLongitude,
        objectId: workOrders.objectId,
        objectName: objects.name,
        objectCity: objects.city,
        objectLat: objects.latitude,
        objectLng: objects.longitude,
      })
      .from(workOrders)
      .leftJoin(objects, eq(workOrders.objectId, objects.id))
      .where(and(eq(workOrders.tenantId, tenantId), inArray(workOrders.id, taskIds)));
    return rows.map((r) => ({
      taskId: r.taskId,
      name: r.title ?? null,
      value: r.cachedValue ?? 0,
      productionMinutes: r.cachedProductionMinutes ?? r.estimatedDuration ?? 0,
      lat: r.taskLat ?? r.objectLat ?? null,
      lng: r.taskLng ?? r.objectLng ?? null,
      objectId: r.objectId ?? null,
      locationName: r.objectCity ?? r.objectName ?? null,
    }));
  }
  async getWeeklyPlanCandidates(
    tenantId: string,
    planId: string,
    teamId: string,
    week: string,
  ): Promise<WeeklyPlanCandidate[]> {
    const terminalStatuses = ["utford", "fakturerad", "omojlig", "avbruten"];
    // Arbetsorder som redan ligger som block i denna plan ska inte föreslås igen.
    const existing = await db
      .select({ taskId: weeklyPlanTasks.taskId })
      .from(weeklyPlanTasks)
      .where(and(eq(weeklyPlanTasks.tenantId, tenantId), eq(weeklyPlanTasks.weeklyPlanId, planId)));
    const excludeIds = existing.map((r) => r.taskId).filter((id): id is string => !!id);

    const conditions: SQL[] = [
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      eq(workOrders.teamId, teamId),
      eq(workOrders.roughPlannedWeek, week),
      notInArray(workOrders.orderStatus, terminalStatuses),
    ];
    if (excludeIds.length > 0) conditions.push(notInArray(workOrders.id, excludeIds));

    const rows = await db
      .select({
        id: workOrders.id,
        title: workOrders.title,
        orderType: workOrders.orderType,
        cachedValue: workOrders.cachedValue,
        cachedProductionMinutes: workOrders.cachedProductionMinutes,
        estimatedDuration: workOrders.estimatedDuration,
        taskLat: workOrders.taskLatitude,
        taskLng: workOrders.taskLongitude,
        objectId: workOrders.objectId,
        objectName: objects.name,
        objectCity: objects.city,
        objectLat: objects.latitude,
        objectLng: objects.longitude,
      })
      .from(workOrders)
      .leftJoin(objects, eq(workOrders.objectId, objects.id))
      .where(and(...conditions))
      .orderBy(workOrders.title);

    return rows.map((r) => ({
      id: r.id,
      name: r.title ?? null,
      value: r.cachedValue ?? 0,
      productionMinutes: r.cachedProductionMinutes ?? r.estimatedDuration ?? 0,
      lat: r.taskLat ?? r.objectLat ?? null,
      lng: r.taskLng ?? r.objectLng ?? null,
      objectId: r.objectId ?? null,
      locationName: r.objectCity ?? r.objectName ?? null,
      orderType: r.orderType ?? null,
    }));
  }
  async getWeeklyPlanTask(tenantId: string, id: string): Promise<WeeklyPlanTask | undefined> {
    const [row] = await db.select().from(weeklyPlanTasks)
      .where(and(eq(weeklyPlanTasks.id, id), eq(weeklyPlanTasks.tenantId, tenantId)));
    return row || undefined;
  }
  async createWeeklyPlanTask(data: InsertWeeklyPlanTask): Promise<WeeklyPlanTask> {
    const [row] = await db.insert(weeklyPlanTasks).values(data).returning();
    return row;
  }
  async updateWeeklyPlanTask(tenantId: string, id: string, data: Partial<InsertWeeklyPlanTask>): Promise<WeeklyPlanTask | undefined> {
    const { tenantId: _t, ...patch } = data as Partial<InsertWeeklyPlanTask>;
    const [row] = await db.update(weeklyPlanTasks).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(weeklyPlanTasks.id, id), eq(weeklyPlanTasks.tenantId, tenantId))).returning();
    return row || undefined;
  }
  async deleteWeeklyPlanTask(tenantId: string, id: string): Promise<void> {
    await db.delete(weeklyPlanTasks).where(and(eq(weeklyPlanTasks.id, id), eq(weeklyPlanTasks.tenantId, tenantId)));
  }

  // Personliga uppgifter
  async getPersonalTasks(tenantId: string, opts?: { weeklyPlanId?: string; teamId?: string }): Promise<PersonalTask[]> {
    const conds: Condition[] = [eq(personalTasks.tenantId, tenantId)];
    if (opts?.weeklyPlanId) conds.push(eq(personalTasks.weeklyPlanId, opts.weeklyPlanId));
    if (opts?.teamId) conds.push(eq(personalTasks.teamId, opts.teamId));
    return db.select().from(personalTasks).where(and(...conds))
      .orderBy(personalTasks.plannedDate, personalTasks.startAt);
  }
  async getPersonalTask(tenantId: string, id: string): Promise<PersonalTask | undefined> {
    const [row] = await db.select().from(personalTasks)
      .where(and(eq(personalTasks.id, id), eq(personalTasks.tenantId, tenantId)));
    return row || undefined;
  }
  async createPersonalTask(data: InsertPersonalTask): Promise<PersonalTask> {
    const [row] = await db.insert(personalTasks).values(data).returning();
    return row;
  }
  async updatePersonalTask(tenantId: string, id: string, data: Partial<InsertPersonalTask>): Promise<PersonalTask | undefined> {
    const { tenantId: _t, ...patch } = data as Partial<InsertPersonalTask>;
    const [row] = await db.update(personalTasks).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(personalTasks.id, id), eq(personalTasks.tenantId, tenantId))).returning();
    return row || undefined;
  }
  async deletePersonalTask(tenantId: string, id: string): Promise<void> {
    await db.delete(personalTasks).where(and(eq(personalTasks.id, id), eq(personalTasks.tenantId, tenantId)));
  }

  // Personliga-uppgift-scheman
  async getPersonalTaskSchedules(tenantId: string, opts?: { teamId?: string; activeOnly?: boolean }): Promise<PersonalTaskSchedule[]> {
    const conds: Condition[] = [eq(personalTaskSchedules.tenantId, tenantId)];
    if (opts?.teamId) conds.push(eq(personalTaskSchedules.teamId, opts.teamId));
    if (opts?.activeOnly) conds.push(eq(personalTaskSchedules.active, true));
    return db.select().from(personalTaskSchedules).where(and(...conds)).orderBy(personalTaskSchedules.title);
  }
  async getPersonalTaskSchedule(tenantId: string, id: string): Promise<PersonalTaskSchedule | undefined> {
    const [row] = await db.select().from(personalTaskSchedules)
      .where(and(eq(personalTaskSchedules.id, id), eq(personalTaskSchedules.tenantId, tenantId)));
    return row || undefined;
  }
  async createPersonalTaskSchedule(data: InsertPersonalTaskSchedule): Promise<PersonalTaskSchedule> {
    const [row] = await db.insert(personalTaskSchedules).values(data).returning();
    return row;
  }
  async updatePersonalTaskSchedule(tenantId: string, id: string, data: Partial<InsertPersonalTaskSchedule>): Promise<PersonalTaskSchedule | undefined> {
    const { tenantId: _t, ...patch } = data as Partial<InsertPersonalTaskSchedule>;
    const [row] = await db.update(personalTaskSchedules).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(personalTaskSchedules.id, id), eq(personalTaskSchedules.tenantId, tenantId))).returning();
    return row || undefined;
  }
  async deletePersonalTaskSchedule(tenantId: string, id: string): Promise<void> {
    await db.delete(personalTaskSchedules).where(and(eq(personalTaskSchedules.id, id), eq(personalTaskSchedules.tenantId, tenantId)));
  }

  // Restidsposter
  async getTravelTimeEntries(tenantId: string, weeklyPlanId?: string): Promise<TravelTimeEntry[]> {
    const conds: Condition[] = [eq(travelTimeEntries.tenantId, tenantId)];
    if (weeklyPlanId) conds.push(eq(travelTimeEntries.weeklyPlanId, weeklyPlanId));
    return db.select().from(travelTimeEntries).where(and(...conds)).orderBy(travelTimeEntries.plannedDate);
  }
  async getTravelTimeEntry(tenantId: string, id: string): Promise<TravelTimeEntry | undefined> {
    const [row] = await db.select().from(travelTimeEntries)
      .where(and(eq(travelTimeEntries.id, id), eq(travelTimeEntries.tenantId, tenantId)));
    return row || undefined;
  }
  async createTravelTimeEntry(data: InsertTravelTimeEntry): Promise<TravelTimeEntry> {
    const [row] = await db.insert(travelTimeEntries).values(data).returning();
    return row;
  }
  async updateTravelTimeEntry(tenantId: string, id: string, data: Partial<InsertTravelTimeEntry>): Promise<TravelTimeEntry | undefined> {
    const { tenantId: _t, ...patch } = data as Partial<InsertTravelTimeEntry>;
    const [row] = await db.update(travelTimeEntries).set(patch)
      .where(and(eq(travelTimeEntries.id, id), eq(travelTimeEntries.tenantId, tenantId))).returning();
    return row || undefined;
  }
  async deleteTravelTimeEntry(tenantId: string, id: string): Promise<void> {
    await db.delete(travelTimeEntries).where(and(eq(travelTimeEntries.id, id), eq(travelTimeEntries.tenantId, tenantId)));
  }

  // Planeringsreservationer ("reservtid", Task #1238) — INTE riktiga uppgifter.
  async getPlanningReservations(tenantId: string, opts?: { weeklyPlanId?: string; teamId?: string; resourceId?: string }): Promise<PlanningReservation[]> {
    const conds: Condition[] = [eq(planningReservations.tenantId, tenantId)];
    if (opts?.weeklyPlanId) conds.push(eq(planningReservations.weeklyPlanId, opts.weeklyPlanId));
    if (opts?.teamId) conds.push(eq(planningReservations.teamId, opts.teamId));
    if (opts?.resourceId) conds.push(eq(planningReservations.resourceId, opts.resourceId));
    return db.select().from(planningReservations).where(and(...conds))
      .orderBy(planningReservations.plannedDate, planningReservations.startAt);
  }
  async getPlanningReservation(tenantId: string, id: string): Promise<PlanningReservation | undefined> {
    const [row] = await db.select().from(planningReservations)
      .where(and(eq(planningReservations.id, id), eq(planningReservations.tenantId, tenantId)));
    return row || undefined;
  }
  async createPlanningReservation(data: InsertPlanningReservation): Promise<PlanningReservation> {
    const [row] = await db.insert(planningReservations).values(data).returning();
    return row;
  }
  async updatePlanningReservation(tenantId: string, id: string, data: Partial<InsertPlanningReservation>): Promise<PlanningReservation | undefined> {
    const { tenantId: _t, ...patch } = data as Partial<InsertPlanningReservation>;
    const [row] = await db.update(planningReservations).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(planningReservations.id, id), eq(planningReservations.tenantId, tenantId))).returning();
    return row || undefined;
  }
  async deletePlanningReservation(tenantId: string, id: string): Promise<void> {
    await db.delete(planningReservations).where(and(eq(planningReservations.id, id), eq(planningReservations.tenantId, tenantId)));
  }

  // Veckoplan-varningar
  async getWeeklyPlanWarnings(tenantId: string, weeklyPlanId: string): Promise<WeeklyPlanWarning[]> {
    return db.select().from(weeklyPlanWarnings)
      .where(and(eq(weeklyPlanWarnings.tenantId, tenantId), eq(weeklyPlanWarnings.weeklyPlanId, weeklyPlanId)))
      .orderBy(desc(weeklyPlanWarnings.createdAt));
  }
  async getWeeklyPlanWarning(tenantId: string, id: string): Promise<WeeklyPlanWarning | undefined> {
    const [row] = await db.select().from(weeklyPlanWarnings)
      .where(and(eq(weeklyPlanWarnings.id, id), eq(weeklyPlanWarnings.tenantId, tenantId)));
    return row || undefined;
  }
  async createWeeklyPlanWarning(data: InsertWeeklyPlanWarning): Promise<WeeklyPlanWarning> {
    const [row] = await db.insert(weeklyPlanWarnings).values(data).returning();
    return row;
  }
  async updateWeeklyPlanWarning(tenantId: string, id: string, data: Partial<InsertWeeklyPlanWarning>): Promise<WeeklyPlanWarning | undefined> {
    const { tenantId: _t, ...patch } = data as Partial<InsertWeeklyPlanWarning>;
    const [row] = await db.update(weeklyPlanWarnings).set(patch)
      .where(and(eq(weeklyPlanWarnings.id, id), eq(weeklyPlanWarnings.tenantId, tenantId))).returning();
    return row || undefined;
  }
  async deleteWeeklyPlanWarning(tenantId: string, id: string): Promise<void> {
    await db.delete(weeklyPlanWarnings).where(and(eq(weeklyPlanWarnings.id, id), eq(weeklyPlanWarnings.tenantId, tenantId)));
  }
  async deleteWeeklyPlanWarningsByPlan(tenantId: string, weeklyPlanId: string): Promise<void> {
    await db.delete(weeklyPlanWarnings)
      .where(and(eq(weeklyPlanWarnings.tenantId, tenantId), eq(weeklyPlanWarnings.weeklyPlanId, weeklyPlanId)));
  }

  // Pre-tasks
  async getPreTasks(tenantId: string, opts?: { workOrderId?: string; status?: string }): Promise<PreTask[]> {
    const conds: Condition[] = [eq(preTasks.tenantId, tenantId), isNull(preTasks.deletedAt)];
    if (opts?.workOrderId) conds.push(eq(preTasks.workOrderId, opts.workOrderId));
    if (opts?.status) conds.push(eq(preTasks.status, opts.status));
    return db.select().from(preTasks).where(and(...conds)).orderBy(desc(preTasks.createdAt));
  }
  async getPreTask(tenantId: string, id: string): Promise<PreTask | undefined> {
    const [row] = await db.select().from(preTasks)
      .where(and(eq(preTasks.id, id), eq(preTasks.tenantId, tenantId), isNull(preTasks.deletedAt)));
    return row || undefined;
  }
  async createPreTask(data: InsertPreTask): Promise<PreTask> {
    const [row] = await db.insert(preTasks).values(data).returning();
    return row;
  }
  async updatePreTask(tenantId: string, id: string, data: Partial<InsertPreTask>): Promise<PreTask | undefined> {
    const { tenantId: _t, ...patch } = data as Partial<InsertPreTask>;
    const [row] = await db.update(preTasks).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(preTasks.id, id), eq(preTasks.tenantId, tenantId))).returning();
    return row || undefined;
  }
  async deletePreTask(tenantId: string, id: string): Promise<void> {
    await db.update(preTasks).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(preTasks.id, id), eq(preTasks.tenantId, tenantId)));
  }

  // Regler: utförandetyp → pre-task
  async getExecTypePreTaskRules(tenantId: string, opts?: { executionType?: string; activeOnly?: boolean }): Promise<ExecTypePreTaskRule[]> {
    const conds: Condition[] = [eq(execTypePreTaskRules.tenantId, tenantId)];
    if (opts?.executionType) conds.push(eq(execTypePreTaskRules.executionType, opts.executionType));
    if (opts?.activeOnly) conds.push(eq(execTypePreTaskRules.active, true));
    return db.select().from(execTypePreTaskRules).where(and(...conds)).orderBy(execTypePreTaskRules.executionType);
  }
  async getExecTypePreTaskRule(tenantId: string, id: string): Promise<ExecTypePreTaskRule | undefined> {
    const [row] = await db.select().from(execTypePreTaskRules)
      .where(and(eq(execTypePreTaskRules.id, id), eq(execTypePreTaskRules.tenantId, tenantId)));
    return row || undefined;
  }
  async createExecTypePreTaskRule(data: InsertExecTypePreTaskRule): Promise<ExecTypePreTaskRule> {
    const [row] = await db.insert(execTypePreTaskRules).values(data).returning();
    return row;
  }
  async updateExecTypePreTaskRule(tenantId: string, id: string, data: Partial<InsertExecTypePreTaskRule>): Promise<ExecTypePreTaskRule | undefined> {
    const { tenantId: _t, ...patch } = data as Partial<InsertExecTypePreTaskRule>;
    const [row] = await db.update(execTypePreTaskRules).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(execTypePreTaskRules.id, id), eq(execTypePreTaskRules.tenantId, tenantId))).returning();
    return row || undefined;
  }
  async deleteExecTypePreTaskRule(tenantId: string, id: string): Promise<void> {
    await db.delete(execTypePreTaskRules).where(and(eq(execTypePreTaskRules.id, id), eq(execTypePreTaskRules.tenantId, tenantId)));
  }

  // Pågående störningar (persisterade — överlever omstart)
  async getDisruptions(tenantId: string, opts?: { includeResolved?: boolean }): Promise<Disruption[]> {
    const conds: Condition[] = [eq(disruptions.tenantId, tenantId)];
    if (!opts?.includeResolved) conds.push(eq(disruptions.status, "active"));
    return db.select().from(disruptions).where(and(...conds)).orderBy(desc(disruptions.createdAt));
  }
  async getDisruption(tenantId: string, id: string): Promise<Disruption | undefined> {
    const [row] = await db.select().from(disruptions)
      .where(and(eq(disruptions.id, id), eq(disruptions.tenantId, tenantId)));
    return row || undefined;
  }
  async createDisruption(data: InsertDisruption): Promise<Disruption> {
    const [row] = await db.insert(disruptions).values(data).returning();
    // Pruna gamla avslutade störningar per tenant så tabellen inte växer obegränsat
    // (motsvarar den tidigare in-memory-cappningen). Aktiva störningar rörs aldrig.
    const stale = await db.select({ id: disruptions.id }).from(disruptions)
      .where(and(eq(disruptions.tenantId, data.tenantId), ne(disruptions.status, "active")))
      .orderBy(desc(disruptions.createdAt))
      .limit(1000)
      .offset(50);
    if (stale.length > 0) {
      await db.delete(disruptions).where(and(
        eq(disruptions.tenantId, data.tenantId),
        inArray(disruptions.id, stale.map(s => s.id)),
      ));
    }
    return row;
  }
  async updateDisruption(tenantId: string, id: string, data: Partial<InsertDisruption>): Promise<Disruption | undefined> {
    const { tenantId: _t, id: _id, ...patch } = data as Partial<InsertDisruption>;
    const [row] = await db.update(disruptions).set(patch)
      .where(and(eq(disruptions.id, id), eq(disruptions.tenantId, tenantId))).returning();
    return row || undefined;
  }
}

// ============================================
// ADR v3 §2.5 (Task #558): Konsoliderings-policy CRUD
// ============================================
interface InvoiceConsolidationPolicyProto {
  listInvoiceConsolidationPolicies(
    tenantId: string,
    opts?: { customerId?: string; recipientId?: string; activeOnly?: boolean },
  ): Promise<InvoiceConsolidationPolicy[]>;
  getInvoiceConsolidationPolicy(
    tenantId: string,
    id: string,
  ): Promise<InvoiceConsolidationPolicy | undefined>;
  createInvoiceConsolidationPolicy(
    data: InsertInvoiceConsolidationPolicy,
  ): Promise<InvoiceConsolidationPolicy>;
  updateInvoiceConsolidationPolicy(
    tenantId: string,
    id: string,
    data: Partial<InsertInvoiceConsolidationPolicy>,
  ): Promise<InvoiceConsolidationPolicy | undefined>;
  deleteInvoiceConsolidationPolicy(tenantId: string, id: string): Promise<void>;
}
const PROTO = DatabaseStorage.prototype as DatabaseStorage & InvoiceConsolidationPolicyProto;

PROTO.listInvoiceConsolidationPolicies = async function (
  tenantId: string,
  opts: { customerId?: string; recipientId?: string; activeOnly?: boolean } = {},
): Promise<InvoiceConsolidationPolicy[]> {
  const conds = [
    eq(invoiceConsolidationPolicies.tenantId, tenantId),
    isNull(invoiceConsolidationPolicies.deletedAt),
  ];
  if (opts.activeOnly) conds.push(eq(invoiceConsolidationPolicies.active, true));
  if (opts.customerId) conds.push(eq(invoiceConsolidationPolicies.customerId, opts.customerId));
  if (opts.recipientId) conds.push(eq(invoiceConsolidationPolicies.invoiceRecipientId, opts.recipientId));
  return db
    .select()
    .from(invoiceConsolidationPolicies)
    .where(and(...conds))
    .orderBy(desc(invoiceConsolidationPolicies.updatedAt));
};

PROTO.getInvoiceConsolidationPolicy = async function (
  tenantId: string,
  id: string,
): Promise<InvoiceConsolidationPolicy | undefined> {
  const [row] = await db
    .select()
    .from(invoiceConsolidationPolicies)
    .where(and(
      eq(invoiceConsolidationPolicies.id, id),
      eq(invoiceConsolidationPolicies.tenantId, tenantId),
      isNull(invoiceConsolidationPolicies.deletedAt),
    ));
  return row;
};

PROTO.createInvoiceConsolidationPolicy = async function (
  data: InsertInvoiceConsolidationPolicy,
): Promise<InvoiceConsolidationPolicy> {
  const [row] = await db.insert(invoiceConsolidationPolicies).values(data).returning();
  return row;
};

PROTO.updateInvoiceConsolidationPolicy = async function (
  tenantId: string,
  id: string,
  data: Partial<InsertInvoiceConsolidationPolicy>,
): Promise<InvoiceConsolidationPolicy | undefined> {
  const { tenantId: _ignoreTenant, ...patch } = data as Partial<InsertInvoiceConsolidationPolicy>;
  const [row] = await db
    .update(invoiceConsolidationPolicies)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(
      eq(invoiceConsolidationPolicies.id, id),
      eq(invoiceConsolidationPolicies.tenantId, tenantId),
    ))
    .returning();
  return row;
};

PROTO.deleteInvoiceConsolidationPolicy = async function (
  tenantId: string,
  id: string,
): Promise<void> {
  // Soft-delete — historiska held WOs ska kunna länka tillbaka för audit.
  await db
    .update(invoiceConsolidationPolicies)
    .set({ deletedAt: new Date(), active: false, updatedAt: new Date() })
    .where(and(
      eq(invoiceConsolidationPolicies.id, id),
      eq(invoiceConsolidationPolicies.tenantId, tenantId),
    ));
};

export interface InvoiceConsolidationPolicyStorage {
  listInvoiceConsolidationPolicies(tenantId: string, opts?: { customerId?: string; recipientId?: string; activeOnly?: boolean }): Promise<InvoiceConsolidationPolicy[]>;
  getInvoiceConsolidationPolicy(tenantId: string, id: string): Promise<InvoiceConsolidationPolicy | undefined>;
  createInvoiceConsolidationPolicy(data: InsertInvoiceConsolidationPolicy): Promise<InvoiceConsolidationPolicy>;
  updateInvoiceConsolidationPolicy(tenantId: string, id: string, data: Partial<InsertInvoiceConsolidationPolicy>): Promise<InvoiceConsolidationPolicy | undefined>;
  deleteInvoiceConsolidationPolicy(tenantId: string, id: string): Promise<void>;
}

export const storage = new DatabaseStorage() as DatabaseStorage & InvoiceConsolidationPolicyStorage;
