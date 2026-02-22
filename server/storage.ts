import { 
  type User, type InsertUser, type UpsertUser,
  type Tenant, type InsertTenant,
  type Customer, type InsertCustomer,
  type ServiceObject, type InsertObject,
  type Resource, type InsertResource,
  type WorkOrder, type InsertWorkOrder, type WorkOrderWithObject,
  type SetupTimeLog, type InsertSetupTimeLog,
  type Procurement, type InsertProcurement,
  type Article, type InsertArticle,
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
  type Team, type InsertTeam,
  type TeamMember, type InsertTeamMember,
  type PlanningParameter, type InsertPlanningParameter,
  type Cluster, type InsertCluster,
  type ResourcePosition, type InsertResourcePosition,
  type OrderStatus,
  type BrandingTemplate, type InsertBrandingTemplate,
  type TenantBranding, type InsertTenantBranding,
  type UserTenantRole, type InsertUserTenantRole,
  type AuditLog, type InsertAuditLog,
  type IndustryPackage, type InsertIndustryPackage,
  type IndustryPackageData, type InsertIndustryPackageData,
  type TenantPackageInstallation, type InsertTenantPackageInstallation,
  type MetadataDefinition, type InsertMetadataDefinition,
  type ObjectMetadata, type InsertObjectMetadata,
  type ObjectPayer, type InsertObjectPayer,
  type FortnoxConfig, type InsertFortnoxConfig,
  type FortnoxMapping, type InsertFortnoxMapping,
  type FortnoxInvoiceExport, type InsertFortnoxInvoiceExport,
  type ObjectImage, type InsertObjectImage,
  type ObjectContact, type InsertObjectContact,
  type TaskDesiredTimewindow, type InsertTaskDesiredTimewindow,
  type TaskDependency, type InsertTaskDependency,
  type TaskInformation, type InsertTaskInformation,
  type ObjectTimeRestriction, type InsertObjectTimeRestriction,
  type StructuralArticle, type InsertStructuralArticle,
  type OrderConcept, type InsertOrderConcept,
  type ConceptFilter, type InsertConceptFilter,
  type Assignment, type InsertAssignment,
  type AssignmentArticle, type InsertAssignmentArticle,
  type SubscriptionChange, type InsertSubscriptionChange,
  type TaskDependencyTemplate, type InsertTaskDependencyTemplate,
  type TaskDependencyInstance, type InsertTaskDependencyInstance,
  type InvoiceRule, type InsertInvoiceRule,
  type OrderConceptRunLog, type InsertOrderConceptRunLog,
  type CustomerPortalToken, type InsertCustomerPortalToken,
  type CustomerPortalSession, type InsertCustomerPortalSession,
  type CustomerBookingRequest, type InsertCustomerBookingRequest,
  type CustomerPortalMessage, type InsertCustomerPortalMessage,
  type CustomerInvoice, type InsertCustomerInvoice,
  type CustomerIssueReport, type InsertCustomerIssueReport,
  type CustomerServiceContract, type InsertCustomerServiceContract,
  type CustomerNotificationSettings, type InsertCustomerNotificationSettings,
  type Protocol, type InsertProtocol,
  type DeviationReport, type InsertDeviationReport,
  type QrCodeLink, type InsertQrCodeLink,
  type PublicIssueReport, type InsertPublicIssueReport,
  type EnvironmentalData, type InsertEnvironmentalData,
  type VisitConfirmation, type InsertVisitConfirmation,
  type TechnicianRating, type InsertTechnicianRating,
  type PortalMessage, type InsertPortalMessage,
  type SelfBookingSlot, type InsertSelfBookingSlot,
  type SelfBooking, type InsertSelfBooking,
  type InspectionMetadata, type InsertInspectionMetadata,
  type ChecklistTemplate, type InsertChecklistTemplate,
  type DriverNotification, type InsertDriverNotification,
  type OfflineSyncLog, type InsertOfflineSyncLog,
  inspectionMetadata, checklistTemplates, driverNotifications, offlineSyncLog,
  fortnoxConfig, fortnoxMappings, fortnoxInvoiceExports,
  users, tenants, customers, objects, resources, workOrders, setupTimeLogs, procurements,
  articles, priceLists, priceListArticles, resourceArticles, workOrderLines, simulationScenarios,
  vehicles, equipment, resourceVehicles, resourceEquipment, resourceAvailability,
  vehicleSchedule, subscriptions, teams, teamMembers, planningParameters, clusters,
  resourcePositions,
  brandingTemplates, tenantBranding, userTenantRoles, auditLogs,
  industryPackages, industryPackageData, tenantPackageInstallations,
  metadataDefinitions, objectMetadata, objectPayers,
  objectImages, objectContacts, taskDesiredTimewindows, taskDependencies, taskInformation, objectTimeRestrictions, structuralArticles,
  orderConcepts, conceptFilters, assignments, assignmentArticles, subscriptionChanges,
  taskDependencyTemplates, taskDependencyInstances, invoiceRules, orderConceptRunLogs,
  customerPortalTokens, customerPortalSessions, customerBookingRequests, customerPortalMessages,
  customerInvoices, customerIssueReports, customerServiceContracts, customerNotificationSettings,
  protocols, deviationReports, qrCodeLinks, publicIssueReports, environmentalData,
  visitConfirmations, technicianRatings, portalMessages, selfBookingSlots, selfBookings
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, isNull, desc, gte, lte, lt, sql, inArray, notInArray } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  upsertUser(user: Partial<UpsertUser> & { id: string; email: string }): Promise<User>;
  
  getTenant(id: string): Promise<Tenant | undefined>;
  getPublicTenants(): Promise<Tenant[]>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  ensureTenant(id: string, defaultData: Omit<InsertTenant, 'id'>): Promise<Tenant>;
  updateTenantSettings(id: string, settings: Record<string, unknown>): Promise<Tenant | undefined>;
  updateTenantSmsSettings(id: string, data: { smsEnabled?: boolean; smsProvider?: string; smsFromName?: string }): Promise<Tenant | undefined>;
  
  getCustomers(tenantId: string): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: string, customer: Partial<InsertCustomer>): Promise<Customer | undefined>;
  deleteCustomer(id: string): Promise<void>;
  
  getObjects(tenantId: string): Promise<ServiceObject[]>;
  getObjectsPaginated(tenantId: string, limit: number, offset: number, search?: string, customerId?: string): Promise<{ objects: ServiceObject[]; total: number }>;
  getObjectsByIds(tenantId: string, ids: string[]): Promise<ServiceObject[]>;
  getObject(id: string): Promise<ServiceObject | undefined>;
  getObjectsByCustomer(customerId: string): Promise<ServiceObject[]>;
  createObject(object: InsertObject): Promise<ServiceObject>;
  updateObject(id: string, object: Partial<InsertObject>): Promise<ServiceObject | undefined>;
  deleteObject(id: string): Promise<void>;
  
  getResources(tenantId: string): Promise<Resource[]>;
  getResource(id: string): Promise<Resource | undefined>;
  createResource(resource: InsertResource): Promise<Resource>;
  updateResource(id: string, resource: Partial<InsertResource>): Promise<Resource | undefined>;
  deleteResource(id: string): Promise<void>;
  
  getWorkOrders(tenantId: string, startDate?: Date, endDate?: Date, includeUnscheduled?: boolean, limit?: number): Promise<WorkOrderWithObject[]>;
  getWorkOrdersPaginated(tenantId: string, limit: number, offset: number, startDate?: Date, endDate?: Date, includeUnscheduled?: boolean, status?: string): Promise<{ workOrders: WorkOrderWithObject[]; total: number }>;
  getWorkOrder(id: string): Promise<WorkOrder | undefined>;
  getWorkOrdersByResource(resourceId: string, startDate?: Date, endDate?: Date): Promise<WorkOrder[]>;
  getWorkOrdersByDate(tenantId: string, date: Date): Promise<WorkOrder[]>;
  getWorkOrderCounts(tenantId: string): Promise<{ overdue: number; todayPending: number; total: number }>;
  getActiveResourceCount(tenantId: string): Promise<number>;
  createWorkOrder(workOrder: InsertWorkOrder): Promise<WorkOrder>;
  updateWorkOrder(id: string, workOrder: Partial<InsertWorkOrder>): Promise<WorkOrder | undefined>;
  deleteWorkOrder(id: string): Promise<void>;
  
  createSetupTimeLog(log: InsertSetupTimeLog): Promise<SetupTimeLog>;
  getSetupTimeLogs(tenantId: string, objectId?: string): Promise<SetupTimeLog[]>;
  
  getProcurements(tenantId: string): Promise<Procurement[]>;
  getProcurement(id: string): Promise<Procurement | undefined>;
  createProcurement(procurement: InsertProcurement): Promise<Procurement>;
  updateProcurement(id: string, procurement: Partial<InsertProcurement>): Promise<Procurement | undefined>;
  deleteProcurement(id: string): Promise<void>;
  
  // Articles
  getArticles(tenantId: string): Promise<Article[]>;
  getArticle(id: string): Promise<Article | undefined>;
  getApplicableArticlesForObject(tenantId: string, objectId: string): Promise<Article[]>;
  createArticle(article: InsertArticle): Promise<Article>;
  updateArticle(id: string, article: Partial<InsertArticle>): Promise<Article | undefined>;
  deleteArticle(id: string): Promise<void>;
  
  // Price Lists
  getPriceLists(tenantId: string): Promise<PriceList[]>;
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
  
  // Resource Articles (tidsverk)
  getResourceArticles(resourceId: string): Promise<ResourceArticle[]>;
  getResourceArticle(id: string): Promise<ResourceArticle | undefined>;
  createResourceArticle(resourceArticle: InsertResourceArticle): Promise<ResourceArticle>;
  updateResourceArticle(id: string, data: Partial<InsertResourceArticle>): Promise<ResourceArticle | undefined>;
  deleteResourceArticle(id: string): Promise<void>;
  
  // Work Order Lines
  getWorkOrderLines(workOrderId: string): Promise<WorkOrderLine[]>;
  createWorkOrderLine(line: InsertWorkOrderLine): Promise<WorkOrderLine>;
  updateWorkOrderLine(id: string, data: Partial<InsertWorkOrderLine>): Promise<WorkOrderLine | undefined>;
  deleteWorkOrderLine(id: string): Promise<void>;
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
  
  // Update work order status
  updateWorkOrderStatus(id: string, newStatus: OrderStatus): Promise<WorkOrder | undefined>;
  
  // Recalculate work order totals from lines
  recalculateWorkOrderTotals(workOrderId: string): Promise<WorkOrder | undefined>;
  
  // Clusters - navet i verksamheten
  getClusters(tenantId: string): Promise<Cluster[]>;
  getCluster(id: string): Promise<Cluster | undefined>;
  getClusterWithStats(id: string): Promise<Cluster & { 
    objectCount: number; 
    activeOrders: number; 
    monthlyValue: number;
    avgSetupTime: number;
  } | undefined>;
  createCluster(cluster: InsertCluster): Promise<Cluster>;
  updateCluster(id: string, cluster: Partial<InsertCluster>): Promise<Cluster | undefined>;
  deleteCluster(id: string): Promise<void>;
  
  // Cluster aggregations
  getClusterObjects(clusterId: string): Promise<ServiceObject[]>;
  getClusterWorkOrders(clusterId: string, options?: { startDate?: Date; endDate?: Date }): Promise<WorkOrder[]>;
  getClusterSubscriptions(clusterId: string): Promise<Subscription[]>;
  updateClusterCaches(clusterId: string): Promise<Cluster | undefined>;
  
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
  getAuditLogs(tenantId: string, options?: { limit?: number; offset?: number; action?: string; userId?: string }): Promise<AuditLog[]>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  
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
  updateResourcePosition(resourceId: string, position: { currentLatitude: number; currentLongitude: number; lastPositionUpdate: Date; trackingStatus: string }): Promise<Resource | undefined>;
  createResourcePosition(position: InsertResourcePosition): Promise<ResourcePosition>;
  getResourcePositions(resourceId: string, startDate?: Date, endDate?: Date): Promise<ResourcePosition[]>;
  getActiveResourcePositions(): Promise<Resource[]>;
  
  // Metadata Definitions
  getMetadataDefinitions(tenantId: string): Promise<MetadataDefinition[]>;
  getMetadataDefinition(id: string): Promise<MetadataDefinition | undefined>;
  createMetadataDefinition(definition: InsertMetadataDefinition): Promise<MetadataDefinition>;
  updateMetadataDefinition(id: string, data: Partial<InsertMetadataDefinition>): Promise<MetadataDefinition | undefined>;
  deleteMetadataDefinition(id: string): Promise<void>;
  
  // Object Metadata
  getObjectMetadata(objectId: string): Promise<ObjectMetadata[]>;
  getObjectMetadataByDefinition(objectId: string, definitionId: string): Promise<ObjectMetadata | undefined>;
  createObjectMetadata(metadata: InsertObjectMetadata): Promise<ObjectMetadata>;
  updateObjectMetadata(id: string, objectId: string, tenantId: string, data: Partial<InsertObjectMetadata>): Promise<ObjectMetadata | undefined>;
  deleteObjectMetadata(id: string, objectId: string, tenantId: string): Promise<void>;
  getEffectiveMetadata(objectId: string, tenantId: string): Promise<Record<string, unknown>>;
  
  // Object Payers
  getObjectPayers(objectId: string): Promise<ObjectPayer[]>;
  getObjectPayer(id: string): Promise<ObjectPayer | undefined>;
  createObjectPayer(payer: InsertObjectPayer): Promise<ObjectPayer>;
  updateObjectPayer(id: string, objectId: string, tenantId: string, data: Partial<InsertObjectPayer>): Promise<ObjectPayer | undefined>;
  deleteObjectPayer(id: string, objectId: string, tenantId: string): Promise<void>;
  
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
  
  // Fortnox Invoice Exports
  getFortnoxInvoiceExports(tenantId: string, status?: string): Promise<FortnoxInvoiceExport[]>;
  getFortnoxInvoiceExport(id: string): Promise<FortnoxInvoiceExport | undefined>;
  createFortnoxInvoiceExport(invoiceExport: InsertFortnoxInvoiceExport): Promise<FortnoxInvoiceExport>;
  updateFortnoxInvoiceExport(id: string, tenantId: string, data: Partial<InsertFortnoxInvoiceExport>): Promise<FortnoxInvoiceExport | undefined>;
  
  // Object Images
  getObjectImages(objectId: string): Promise<ObjectImage[]>;
  getObjectImage(id: string): Promise<ObjectImage | undefined>;
  createObjectImage(image: InsertObjectImage): Promise<ObjectImage>;
  deleteObjectImage(id: string, objectId: string, tenantId: string): Promise<void>;
  
  // Object Contacts (with inheritance support)
  getObjectContacts(objectId: string): Promise<ObjectContact[]>;
  getObjectContactsWithInheritance(objectId: string, tenantId: string): Promise<ObjectContact[]>;
  createObjectContact(contact: InsertObjectContact): Promise<ObjectContact>;
  updateObjectContact(id: string, objectId: string, tenantId: string, data: Partial<InsertObjectContact>): Promise<ObjectContact | undefined>;
  deleteObjectContact(id: string, objectId: string, tenantId: string): Promise<void>;
  
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
  
  // Object Time Restrictions (C9)
  getObjectTimeRestrictions(objectId: string): Promise<ObjectTimeRestriction[]>;
  getObjectTimeRestrictionsByTenant(tenantId: string): Promise<ObjectTimeRestriction[]>;
  getObjectTimeRestrictionsByObjectIds(tenantId: string, objectIds: string[]): Promise<ObjectTimeRestriction[]>;
  createObjectTimeRestriction(restriction: InsertObjectTimeRestriction): Promise<ObjectTimeRestriction>;
  updateObjectTimeRestriction(id: string, tenantId: string, data: Partial<InsertObjectTimeRestriction>): Promise<ObjectTimeRestriction | undefined>;
  deleteObjectTimeRestriction(id: string, tenantId: string): Promise<void>;

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
  
  // Assignments
  getAssignments(tenantId: string, options?: { status?: string; resourceId?: string; clusterId?: string; startDate?: Date; endDate?: Date }): Promise<Assignment[]>;
  getAssignment(id: string): Promise<Assignment | undefined>;
  createAssignment(assignment: InsertAssignment): Promise<Assignment>;
  updateAssignment(id: string, tenantId: string, data: Partial<InsertAssignment>): Promise<Assignment | undefined>;
  deleteAssignment(id: string, tenantId: string): Promise<void>;
  
  // Assignment Articles
  getAssignmentArticles(assignmentId: string): Promise<AssignmentArticle[]>;
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

  // Customer Portal - Tokens and Sessions
  createPortalToken(token: InsertCustomerPortalToken): Promise<CustomerPortalToken>;
  getPortalTokenByHash(tokenHash: string): Promise<CustomerPortalToken | undefined>;
  deletePortalToken(id: string): Promise<void>;
  createPortalSession(session: InsertCustomerPortalSession): Promise<CustomerPortalSession>;
  getPortalSessionByToken(sessionToken: string): Promise<CustomerPortalSession | undefined>;
  updatePortalSessionAccess(id: string): Promise<void>;
  deletePortalSession(id: string): Promise<void>;
  
  // Customer Portal - Booking Requests
  getBookingRequests(tenantId: string, customerId?: string): Promise<CustomerBookingRequest[]>;
  getBookingRequest(id: string): Promise<CustomerBookingRequest | undefined>;
  createBookingRequest(request: InsertCustomerBookingRequest): Promise<CustomerBookingRequest>;
  updateBookingRequest(id: string, tenantId: string, data: Partial<InsertCustomerBookingRequest>): Promise<CustomerBookingRequest | undefined>;
  getWorkOrdersByCustomer(customerId: string, tenantId: string): Promise<WorkOrder[]>;
  
  // Customer Portal - Messages
  getPortalMessages(tenantId: string, customerId: string): Promise<CustomerPortalMessage[]>;
  createPortalMessage(message: InsertCustomerPortalMessage): Promise<CustomerPortalMessage>;
  markPortalMessagesAsRead(tenantId: string, customerId: string): Promise<void>;
  getUnreadMessageCount(tenantId: string, customerId?: string): Promise<number>;
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
  getChecklistTemplate(id: string): Promise<ChecklistTemplate | undefined>;
  getChecklistTemplatesByArticleType(tenantId: string, articleType: string): Promise<ChecklistTemplate[]>;
  createChecklistTemplate(template: InsertChecklistTemplate): Promise<ChecklistTemplate>;
  updateChecklistTemplate(id: string, data: Partial<InsertChecklistTemplate>): Promise<ChecklistTemplate | undefined>;
  deleteChecklistTemplate(id: string): Promise<void>;

  // Driver Notifications
  getDriverNotifications(resourceId: string, options?: { unreadOnly?: boolean; limit?: number }): Promise<DriverNotification[]>;
  createDriverNotification(notification: InsertDriverNotification): Promise<DriverNotification>;
  markDriverNotificationRead(id: string, resourceId: string): Promise<DriverNotification | undefined>;
  markAllDriverNotificationsRead(resourceId: string): Promise<number>;
  getUnreadNotificationCount(resourceId: string): Promise<number>;

  // Offline Sync Log
  createOfflineSyncLog(log: InsertOfflineSyncLog): Promise<OfflineSyncLog>;
  getOfflineSyncLogs(resourceId: string, status?: string): Promise<OfflineSyncLog[]>;
  updateOfflineSyncLogStatus(id: string, status: string, errorMessage?: string): Promise<OfflineSyncLog | undefined>;
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

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
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

  async getCustomer(id: string): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt)));
    return customer || undefined;
  }

  async createCustomer(insertCustomer: InsertCustomer): Promise<Customer> {
    const [customer] = await db.insert(customers).values(insertCustomer).returning();
    return customer;
  }

  async updateCustomer(id: string, data: Partial<InsertCustomer>): Promise<Customer | undefined> {
    const [customer] = await db.update(customers).set(data).where(eq(customers.id, id)).returning();
    return customer || undefined;
  }

  async deleteCustomer(id: string): Promise<void> {
    await db.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, id));
  }

  async getObjects(tenantId: string): Promise<ServiceObject[]> {
    return db.select().from(objects).where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
  }

  async getObjectsPaginated(tenantId: string, limit: number, offset: number, search?: string, customerId?: string): Promise<{ objects: ServiceObject[]; total: number }> {
    const { sql, count } = await import("drizzle-orm");
    
    let whereConditions = and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt));
    
    if (customerId) {
      whereConditions = and(whereConditions, eq(objects.customerId, customerId));
    }
    
    if (search && search.trim()) {
      const searchTerm = `%${search.toLowerCase()}%`;
      whereConditions = and(
        whereConditions,
        or(
          sql`LOWER(${objects.name}) LIKE ${searchTerm}`,
          sql`LOWER(${objects.objectNumber}) LIKE ${searchTerm}`,
          sql`LOWER(${objects.address}) LIKE ${searchTerm}`
        )
      );
    }
    
    const [countResult] = await db.select({ count: count() }).from(objects).where(whereConditions);
    const total = countResult?.count || 0;
    
    const objectsList = await db.select()
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
    return db.select()
      .from(objects)
      .where(and(
        eq(objects.tenantId, tenantId),
        isNull(objects.deletedAt),
        inArray(objects.id, ids)
      ));
  }

  async getObject(id: string): Promise<ServiceObject | undefined> {
    const [object] = await db.select().from(objects).where(and(eq(objects.id, id), isNull(objects.deletedAt)));
    return object || undefined;
  }

  async getObjectsByCustomer(customerId: string): Promise<ServiceObject[]> {
    return db.select().from(objects).where(and(eq(objects.customerId, customerId), isNull(objects.deletedAt)));
  }

  async createObject(insertObject: InsertObject): Promise<ServiceObject> {
    const [object] = await db.insert(objects).values(insertObject).returning();
    return object;
  }

  async updateObject(id: string, data: Partial<InsertObject>): Promise<ServiceObject | undefined> {
    const [object] = await db.update(objects).set(data).where(eq(objects.id, id)).returning();
    return object || undefined;
  }

  async deleteObject(id: string): Promise<void> {
    await db.update(objects).set({ deletedAt: new Date() }).where(eq(objects.id, id));
  }

  async getResources(tenantId: string): Promise<Resource[]> {
    return db.select().from(resources).where(and(eq(resources.tenantId, tenantId), isNull(resources.deletedAt)));
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
  }

  async getWorkOrders(tenantId: string, startDate?: Date, endDate?: Date, includeUnscheduled?: boolean, limit?: number): Promise<WorkOrderWithObject[]> {
    const conditions = [eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt)];
    
    if (startDate && endDate) {
      if (includeUnscheduled) {
        conditions.push(
          or(
            isNull(workOrders.scheduledDate),
            and(gte(workOrders.scheduledDate, startDate), lte(workOrders.scheduledDate, endDate))
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
      status: workOrders.status,
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
      what3words: workOrders.what3words,
      taskLatitude: workOrders.taskLatitude,
      taskLongitude: workOrders.taskLongitude,
      externalReference: workOrders.externalReference,
      onWayAt: workOrders.onWayAt,
      onSiteAt: workOrders.onSiteAt,
      inspectedAt: workOrders.inspectedAt,
      executionCode: workOrders.executionCode,
      objectName: objects.name,
      objectAddress: objects.address,
      objectAccessCode: objects.resolvedAccessCode,
      objectKeyNumber: objects.resolvedKeyNumber,
      customerName: customers.name,
    })
    .from(workOrders)
    .leftJoin(objects, eq(workOrders.objectId, objects.id))
    .leftJoin(customers, eq(workOrders.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(workOrders.scheduledDate));
    
    if (limit) {
      query = query.limit(limit) as typeof query;
    }
    
    return query;
  }

  async getWorkOrdersPaginated(tenantId: string, limit: number, offset: number, startDate?: Date, endDate?: Date, includeUnscheduled?: boolean, status?: string): Promise<{ workOrders: WorkOrderWithObject[]; total: number }> {
    const conditions: any[] = [eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt)];

    if (startDate && endDate) {
      if (includeUnscheduled) {
        conditions.push(
          or(
            isNull(workOrders.scheduledDate),
            and(gte(workOrders.scheduledDate, startDate), lte(workOrders.scheduledDate, endDate))
          )!
        );
      } else {
        conditions.push(gte(workOrders.scheduledDate, startDate));
        conditions.push(lte(workOrders.scheduledDate, endDate));
      }
    }

    if (status && status !== 'all') {
      conditions.push(eq(workOrders.status, status));
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
      status: workOrders.status,
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
      what3words: workOrders.what3words,
      taskLatitude: workOrders.taskLatitude,
      taskLongitude: workOrders.taskLongitude,
      externalReference: workOrders.externalReference,
      onWayAt: workOrders.onWayAt,
      onSiteAt: workOrders.onSiteAt,
      inspectedAt: workOrders.inspectedAt,
      executionCode: workOrders.executionCode,
      objectName: objects.name,
      objectAddress: objects.address,
      objectAccessCode: objects.resolvedAccessCode,
      objectKeyNumber: objects.resolvedKeyNumber,
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
        notInArray(workOrders.status, ['completed', 'cancelled'])
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
        notInArray(workOrders.status, ['completed', 'cancelled'])
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

  async createWorkOrder(insertWorkOrder: InsertWorkOrder): Promise<WorkOrder> {
    const [workOrder] = await db.insert(workOrders).values(insertWorkOrder).returning();
    return workOrder;
  }

  async updateWorkOrder(id: string, data: Partial<InsertWorkOrder>): Promise<WorkOrder | undefined> {
    const [workOrder] = await db.update(workOrders).set(data).where(eq(workOrders.id, id)).returning();
    return workOrder || undefined;
  }

  async deleteWorkOrder(id: string): Promise<void> {
    await db.update(workOrders).set({ deletedAt: new Date() }).where(eq(workOrders.id, id));
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

  async getArticle(id: string): Promise<Article | undefined> {
    const [article] = await db.select().from(articles).where(and(eq(articles.id, id), isNull(articles.deletedAt)));
    return article || undefined;
  }

  /**
   * Hämta artiklar som är applicerbara för ett specifikt objekt baserat på hookLevel (Kinab fasthakning)
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
    const objectType = object.objectType?.toLowerCase() || '';
    const hierarchyLevel = object.hierarchyLevel?.toLowerCase() || '';
    
    // Kärltypsmappning
    const karlTypes = ['matavfall', 'atervinning', 'uj_hushallsavfall', 'plastemballage', 'restavfall'];
    const isKarl = karlTypes.includes(objectType) || hierarchyLevel === 'karl';
    const isMatKarl = objectType === 'matavfall' || objectType.includes('mat');
    const isRestKarl = objectType === 'restavfall' || objectType.includes('rest');
    const isPlastKarl = objectType === 'plastemballage' || objectType.includes('plast');
    
    // Hierarkinivåer
    const isFastighet = objectType === 'fastighet' || hierarchyLevel === 'fastighet';
    const isRum = ['rum', 'soprum', 'kok'].includes(objectType) || hierarchyLevel === 'rum';
    const isBrf = hierarchyLevel === 'brf';
    const isKoncern = hierarchyLevel === 'koncern';
    
    // Kolla om objektet har accesskod direkt på objektet
    const hasAccessCode = !!(object.accessCode && object.accessCode.trim() !== '');

    // Hierarkiordning för propagering nedåt
    // Koncern → BRF → Fastighet → Rum → Kärl
    // Artiklar som är fasthakade på högre nivå propagerar nedåt till alla undernivåer
    const hierarchyOrder = ['koncern', 'brf', 'fastighet', 'rum', 'karl'];
    
    const getHierarchyPosition = (level: string): number => {
      if (level === 'koncern') return 0;
      if (level === 'brf') return 1;
      if (level === 'fastighet') return 2;
      if (level === 'rum') return 3;
      if (level === 'karl' || level === 'karl_mat' || level === 'karl_rest' || level === 'karl_plast') return 4;
      if (level === 'kod') return -1; // Specialfall - hanteras separat
      return -1;
    };
    
    const getCurrentObjectLevel = (): number => {
      if (isKoncern) return 0;
      if (isBrf) return 1;
      if (isFastighet) return 2;
      if (isRum) return 3;
      if (isKarl) return 4;
      return -1;
    };
    
    const currentLevel = getCurrentObjectLevel();
    
    return allArticles.filter(article => {
      if (!article.hookLevel) return false;
      
      const hookLevel = article.hookLevel.toLowerCase();
      const hookConditions = (article.hookConditions as Record<string, unknown>) || {};
      
      // Matchningslogik med hierarkisk propagering nedåt
      let levelMatches = false;
      
      // Specialfall: kod-hook (matchar om objektet har accesskod)
      if (hookLevel === 'kod') {
        levelMatches = hasAccessCode;
      }
      // Specialfall: kärl-subtyper (exakt matchning)
      else if (hookLevel === 'karl_mat') {
        levelMatches = isMatKarl;
      }
      else if (hookLevel === 'karl_rest') {
        levelMatches = isRestKarl;
      }
      else if (hookLevel === 'karl_plast') {
        levelMatches = isPlastKarl;
      }
      // Hierarkisk propagering: artikel-hook på högre nivå matchar alla undernivåer
      else {
        const hookPosition = getHierarchyPosition(hookLevel);
        if (hookPosition >= 0 && currentLevel >= 0) {
          // Artikeln matchar om objektets nivå är samma eller djupare i hierarkin
          levelMatches = currentLevel >= hookPosition;
        }
      }
      
      if (!levelMatches) return false;
      
      // Kontrollera hookConditions om de finns
      if (Object.keys(hookConditions).length > 0) {
        // container_type-villkor
        if (hookConditions.container_type && hookConditions.container_type !== objectType) {
          return false;
        }
        // Kan utökas med fler villkor (waste_fraction, etc.)
      }
      
      return true;
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
  }

  // Price Lists
  async getPriceLists(tenantId: string): Promise<PriceList[]> {
    return db.select().from(priceLists).where(and(eq(priceLists.tenantId, tenantId), isNull(priceLists.deletedAt))).orderBy(desc(priceLists.priority));
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

  // Resource Articles (tidsverk)
  async getResourceArticles(resourceId: string): Promise<ResourceArticle[]> {
    return db.select().from(resourceArticles).where(eq(resourceArticles.resourceId, resourceId));
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

  async createWorkOrderLine(line: InsertWorkOrderLine): Promise<WorkOrderLine> {
    const [wol] = await db.insert(workOrderLines).values(line).returning();
    return wol;
  }

  async updateWorkOrderLine(id: string, data: Partial<InsertWorkOrderLine>): Promise<WorkOrderLine | undefined> {
    const [wol] = await db.update(workOrderLines).set(data).where(eq(workOrderLines.id, id)).returning();
    return wol || undefined;
  }

  async deleteWorkOrderLine(id: string): Promise<void> {
    await db.delete(workOrderLines).where(eq(workOrderLines.id, id));
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
    startDate?: Date;
    endDate?: Date;
    page?: number;
    pageSize?: number;
    search?: string;
    metadataFilters?: { metadataName: string; operator: string; value: string }[];
  }): Promise<{ orders: WorkOrder[]; total: number; byStatus: Record<string, number>; aggregates: { totalValue: number; totalCost: number; totalProductionMinutes: number } }> {
    // Base conditions (tenant, not deleted, simulated filter)
    let baseConditions = and(eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt));
    
    if (!options?.includeSimulated) {
      baseConditions = and(baseConditions, eq(workOrders.isSimulated, false));
    }
    
    if (options?.scenarioId) {
      baseConditions = and(baseConditions, eq(workOrders.simulationScenarioId, options.scenarioId));
    }
    
    // Date filters apply to everything (status counts, aggregates, and paginated results)
    let dateFilteredConditions = baseConditions;
    if (options?.startDate) {
      dateFilteredConditions = and(dateFilteredConditions, gte(workOrders.scheduledDate, options.startDate));
    }
    if (options?.endDate) {
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
        sql`${workOrders.customerId} IN (SELECT id FROM ${customers} WHERE lower(name) LIKE ${searchTerm})`,
        sql`${workOrders.objectId} IN (SELECT id FROM ${objects} WHERE lower(name) LIKE ${searchTerm})`
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
    
    // Get status counts (with date filters but without orderStatus filter for tab badges)
    const statusCountsResult = await db.select({ 
      status: workOrders.orderStatus,
      count: sql<number>`count(*)::int`
    })
      .from(workOrders)
      .where(dateFilteredConditions)
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

  // Update work order status with timestamp handling
  async updateWorkOrderStatus(id: string, newStatus: OrderStatus): Promise<WorkOrder | undefined> {
    // Get current order to validate transition
    const currentOrder = await this.getWorkOrder(id);
    if (!currentOrder) return undefined;
    
    const currentStatus = (currentOrder.orderStatus || 'skapad') as OrderStatus;
    const statusFlow: OrderStatus[] = ['skapad', 'planerad_pre', 'planerad_resurs', 'planerad_las', 'utford', 'fakturerad'];
    const currentIdx = statusFlow.indexOf(currentStatus);
    const newIdx = statusFlow.indexOf(newStatus);
    
    // Validate sequential progression (allow forward only, max 1 step at a time or reset to skapad)
    if (newStatus !== 'skapad' && (newIdx < 0 || newIdx > currentIdx + 1)) {
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
    
    return wo || undefined;
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

  async getTeam(id: string): Promise<Team | undefined> {
    const [team] = await db.select().from(teams).where(and(eq(teams.id, id), isNull(teams.deletedAt)));
    return team || undefined;
  }

  async createTeam(team: InsertTeam): Promise<Team> {
    const [result] = await db.insert(teams).values(team).returning();
    return result;
  }

  async updateTeam(id: string, data: Partial<InsertTeam>): Promise<Team | undefined> {
    const [result] = await db.update(teams).set(data).where(eq(teams.id, id)).returning();
    return result || undefined;
  }

  async deleteTeam(id: string): Promise<void> {
    await db.update(teams).set({ deletedAt: new Date() }).where(eq(teams.id, id));
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

  async getTeamMember(id: string): Promise<TeamMember | undefined> {
    const [tm] = await db.select().from(teamMembers).where(eq(teamMembers.id, id));
    return tm || undefined;
  }

  async createTeamMember(tm: InsertTeamMember): Promise<TeamMember> {
    const [result] = await db.insert(teamMembers).values(tm).returning();
    return result;
  }

  async updateTeamMember(id: string, data: Partial<InsertTeamMember>): Promise<TeamMember | undefined> {
    const [result] = await db.update(teamMembers).set(data).where(eq(teamMembers.id, id)).returning();
    return result || undefined;
  }

  async deleteTeamMember(id: string): Promise<void> {
    await db.delete(teamMembers).where(eq(teamMembers.id, id));
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

  // ============== CLUSTERS - NAVET I VERKSAMHETEN ==============
  async getClusters(tenantId: string): Promise<Cluster[]> {
    return db.select().from(clusters).where(and(eq(clusters.tenantId, tenantId), isNull(clusters.deletedAt)));
  }

  async getCluster(id: string): Promise<Cluster | undefined> {
    const [cluster] = await db.select().from(clusters).where(and(eq(clusters.id, id), isNull(clusters.deletedAt)));
    return cluster || undefined;
  }

  async getClusterWithStats(id: string): Promise<Cluster & { 
    objectCount: number; 
    activeOrders: number; 
    monthlyValue: number;
    avgSetupTime: number;
  } | undefined> {
    const cluster = await this.getCluster(id);
    if (!cluster) return undefined;

    // Count objects in cluster
    const objectsInCluster = await db.select().from(objects)
      .where(and(eq(objects.clusterId, id), isNull(objects.deletedAt)));
    
    // Count active orders (not completed or invoiced)
    const activeOrdersList = await db.select().from(workOrders)
      .where(and(
        eq(workOrders.clusterId, id),
        isNull(workOrders.deletedAt),
        or(
          eq(workOrders.orderStatus, 'skapad'),
          eq(workOrders.orderStatus, 'planerad_pre'),
          eq(workOrders.orderStatus, 'planerad_resurs'),
          eq(workOrders.orderStatus, 'planerad_las')
        )
      ));
    
    // Sum monthly value from subscriptions
    const subs = await db.select().from(subscriptions)
      .where(and(eq(subscriptions.clusterId, id), isNull(subscriptions.deletedAt), eq(subscriptions.status, 'active')));
    const monthlyValue = subs.reduce((sum, s) => sum + (s.cachedMonthlyValue || 0), 0);
    
    // Calculate average setup time from logs
    const setupLogs = await db.select().from(setupTimeLogs)
      .where(sql`${setupTimeLogs.objectId} IN (SELECT id FROM objects WHERE cluster_id = ${id})`);
    const avgSetupTime = setupLogs.length > 0 
      ? Math.round(setupLogs.reduce((sum, l) => sum + l.durationMinutes, 0) / setupLogs.length)
      : 0;

    return {
      ...cluster,
      objectCount: objectsInCluster.length,
      activeOrders: activeOrdersList.length,
      monthlyValue,
      avgSetupTime
    };
  }

  async createCluster(cluster: InsertCluster): Promise<Cluster> {
    const [result] = await db.insert(clusters).values(cluster).returning();
    return result;
  }

  async updateCluster(id: string, data: Partial<InsertCluster>): Promise<Cluster | undefined> {
    const [result] = await db.update(clusters).set(data).where(eq(clusters.id, id)).returning();
    return result || undefined;
  }

  async deleteCluster(id: string): Promise<void> {
    await db.update(clusters).set({ deletedAt: new Date() }).where(eq(clusters.id, id));
  }

  async getClusterObjects(clusterId: string): Promise<ServiceObject[]> {
    return db.select().from(objects).where(and(eq(objects.clusterId, clusterId), isNull(objects.deletedAt)));
  }

  async getClusterWorkOrders(clusterId: string, options?: { startDate?: Date; endDate?: Date }): Promise<WorkOrder[]> {
    const conditions = [eq(workOrders.clusterId, clusterId), isNull(workOrders.deletedAt)];
    if (options?.startDate) {
      conditions.push(gte(workOrders.scheduledDate, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(workOrders.scheduledDate, options.endDate));
    }
    return db.select().from(workOrders).where(and(...conditions));
  }

  async getClusterSubscriptions(clusterId: string): Promise<Subscription[]> {
    return db.select().from(subscriptions).where(and(eq(subscriptions.clusterId, clusterId), isNull(subscriptions.deletedAt)));
  }

  async updateClusterCaches(clusterId: string): Promise<Cluster | undefined> {
    const stats = await this.getClusterWithStats(clusterId);
    if (!stats) return undefined;
    
    return this.updateCluster(clusterId, {
      cachedObjectCount: stats.objectCount,
      cachedActiveOrders: stats.activeOrders,
      cachedMonthlyValue: stats.monthlyValue,
      cachedAvgSetupTime: stats.avgSetupTime
    });
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
  async getAuditLogs(tenantId: string, options?: { limit?: number; offset?: number; action?: string; userId?: string }): Promise<AuditLog[]> {
    const conditions = [eq(auditLogs.tenantId, tenantId)];
    
    if (options?.action) {
      conditions.push(eq(auditLogs.action, options.action));
    }
    if (options?.userId) {
      conditions.push(eq(auditLogs.userId, options.userId));
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

  async getActiveResourcePositions(): Promise<Resource[]> {
    // Get resources with recent position updates (within last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return db.select()
      .from(resources)
      .where(and(
        isNull(resources.deletedAt),
        gte(resources.lastPositionUpdate, fiveMinutesAgo)
      ));
  }

  // Metadata Definitions
  async getMetadataDefinitions(tenantId: string): Promise<MetadataDefinition[]> {
    return db.select()
      .from(metadataDefinitions)
      .where(eq(metadataDefinitions.tenantId, tenantId))
      .orderBy(metadataDefinitions.fieldKey);
  }

  async getMetadataDefinition(id: string): Promise<MetadataDefinition | undefined> {
    const [definition] = await db.select()
      .from(metadataDefinitions)
      .where(eq(metadataDefinitions.id, id));
    return definition || undefined;
  }

  async createMetadataDefinition(definition: InsertMetadataDefinition): Promise<MetadataDefinition> {
    const [result] = await db.insert(metadataDefinitions).values(definition).returning();
    return result;
  }

  async updateMetadataDefinition(id: string, data: Partial<InsertMetadataDefinition>): Promise<MetadataDefinition | undefined> {
    const [result] = await db.update(metadataDefinitions)
      .set(data)
      .where(eq(metadataDefinitions.id, id))
      .returning();
    return result || undefined;
  }

  async deleteMetadataDefinition(id: string): Promise<void> {
    await db.delete(metadataDefinitions).where(eq(metadataDefinitions.id, id));
  }

  // Object Metadata
  async getObjectMetadata(objectId: string): Promise<ObjectMetadata[]> {
    return db.select()
      .from(objectMetadata)
      .where(eq(objectMetadata.objectId, objectId));
  }

  async getObjectMetadataByDefinition(objectId: string, definitionId: string): Promise<ObjectMetadata | undefined> {
    const [result] = await db.select()
      .from(objectMetadata)
      .where(and(
        eq(objectMetadata.objectId, objectId),
        eq(objectMetadata.definitionId, definitionId)
      ));
    return result || undefined;
  }

  async createObjectMetadata(metadata: InsertObjectMetadata): Promise<ObjectMetadata> {
    const [result] = await db.insert(objectMetadata).values(metadata).returning();
    return result;
  }

  async updateObjectMetadata(id: string, objectId: string, tenantId: string, data: Partial<InsertObjectMetadata>): Promise<ObjectMetadata | undefined> {
    // Validate metadata belongs to the specified object and tenant before updating
    const [result] = await db.update(objectMetadata)
      .set(data)
      .where(and(
        eq(objectMetadata.id, id),
        eq(objectMetadata.objectId, objectId),
        eq(objectMetadata.tenantId, tenantId)
      ))
      .returning();
    return result || undefined;
  }

  async deleteObjectMetadata(id: string, objectId: string, tenantId: string): Promise<void> {
    // Validate metadata belongs to the specified object and tenant before deleting
    await db.delete(objectMetadata)
      .where(and(
        eq(objectMetadata.id, id),
        eq(objectMetadata.objectId, objectId),
        eq(objectMetadata.tenantId, tenantId)
      ));
  }

  async getEffectiveMetadata(objectId: string, tenantId: string): Promise<Record<string, unknown>> {
    // Get metadata definitions scoped to tenant
    const definitions = await db.select()
      .from(metadataDefinitions)
      .where(eq(metadataDefinitions.tenantId, tenantId));
    const result: Record<string, unknown> = {};
    
    // Build the ancestor chain once - cache object lookups
    const ancestorChain: string[] = [];
    let currentObj = await this.getObject(objectId);
    while (currentObj?.parentId) {
      ancestorChain.push(currentObj.parentId);
      currentObj = await this.getObject(currentObj.parentId);
    }
    
    // For each definition, try to get the effective value
    for (const def of definitions) {
      // First check if the object has its own value
      const [ownMeta] = await db.select()
        .from(objectMetadata)
        .where(and(
          eq(objectMetadata.objectId, objectId),
          eq(objectMetadata.definitionId, def.id)
        ));
      
      if (ownMeta) {
        // Prefer valueJson for structured data, fall back to value string
        if (ownMeta.valueJson !== null) {
          result[def.fieldKey] = ownMeta.valueJson;
        } else {
          result[def.fieldKey] = ownMeta.value;
        }
        continue;
      }
      
      // If no own value and propagation is 'fixed', skip inheritance
      if (def.propagationType === 'fixed') {
        result[def.fieldKey] = null;
        continue;
      }
      
      // Walk up the pre-built ancestor chain looking for inherited value
      let inheritedValue: unknown = null;
      
      for (const ancestorId of ancestorChain) {
        const [ancestorMeta] = await db.select()
          .from(objectMetadata)
          .where(and(
            eq(objectMetadata.objectId, ancestorId),
            eq(objectMetadata.definitionId, def.id)
          ));
        
        if (ancestorMeta) {
          // Found metadata at this ancestor - check if it has a concrete value
          const hasValue = ancestorMeta.value !== null || ancestorMeta.valueJson !== null;
          
          if (hasValue) {
            // Prefer valueJson for structured data, fall back to value string
            if (ancestorMeta.valueJson !== null) {
              inheritedValue = ancestorMeta.valueJson;
            } else {
              inheritedValue = ancestorMeta.value;
            }
            break;
          }
          
          // Metadata record exists but has no value - if it breaks inheritance, stop
          if (ancestorMeta.breaksInheritance) {
            break;
          }
        }
        
        // No value at this ancestor - continue searching up the chain
      }
      
      result[def.fieldKey] = inheritedValue;
    }
    
    return result;
  }

  // Object Payers
  async getObjectPayers(objectId: string): Promise<ObjectPayer[]> {
    return db.select()
      .from(objectPayers)
      .where(eq(objectPayers.objectId, objectId));
  }

  async getObjectPayer(id: string): Promise<ObjectPayer | undefined> {
    const [payer] = await db.select()
      .from(objectPayers)
      .where(eq(objectPayers.id, id));
    return payer || undefined;
  }

  async createObjectPayer(payer: InsertObjectPayer): Promise<ObjectPayer> {
    const [result] = await db.insert(objectPayers).values(payer).returning();
    return result;
  }

  async updateObjectPayer(id: string, objectId: string, tenantId: string, data: Partial<InsertObjectPayer>): Promise<ObjectPayer | undefined> {
    const [result] = await db.update(objectPayers)
      .set(data)
      .where(and(
        eq(objectPayers.id, id),
        eq(objectPayers.objectId, objectId),
        eq(objectPayers.tenantId, tenantId)
      ))
      .returning();
    return result || undefined;
  }

  async deleteObjectPayer(id: string, objectId: string, tenantId: string): Promise<void> {
    await db.delete(objectPayers)
      .where(and(
        eq(objectPayers.id, id),
        eq(objectPayers.objectId, objectId),
        eq(objectPayers.tenantId, tenantId)
      ));
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

  // ============================================
  // Object Images
  // ============================================
  
  async getObjectImages(objectId: string): Promise<ObjectImage[]> {
    return db.select().from(objectImages)
      .where(eq(objectImages.objectId, objectId))
      .orderBy(desc(objectImages.imageDate));
  }

  async getObjectImage(id: string): Promise<ObjectImage | undefined> {
    const [image] = await db.select().from(objectImages).where(eq(objectImages.id, id));
    return image || undefined;
  }

  async createObjectImage(image: InsertObjectImage): Promise<ObjectImage> {
    const [result] = await db.insert(objectImages).values(image).returning();
    return result;
  }

  async deleteObjectImage(id: string, objectId: string, tenantId: string): Promise<void> {
    await db.delete(objectImages).where(and(
      eq(objectImages.id, id),
      eq(objectImages.objectId, objectId),
      eq(objectImages.tenantId, tenantId)
    ));
  }

  // ============================================
  // Object Contacts (with inheritance support)
  // ============================================
  
  async getObjectContacts(objectId: string): Promise<ObjectContact[]> {
    return db.select().from(objectContacts).where(eq(objectContacts.objectId, objectId));
  }

  async getObjectContactsWithInheritance(objectId: string, tenantId: string): Promise<ObjectContact[]> {
    const result: ObjectContact[] = [];
    const seenTypes = new Set<string>();
    
    const ancestorChain: string[] = [objectId];
    let currentObj = await this.getObject(objectId);
    
    if (currentObj?.tenantId !== tenantId) {
      return [];
    }
    
    while (currentObj?.parentId) {
      const parentObj = await this.getObject(currentObj.parentId);
      if (!parentObj || parentObj.tenantId !== tenantId) {
        break;
      }
      ancestorChain.push(currentObj.parentId);
      currentObj = parentObj;
    }
    
    for (const ancestorId of ancestorChain) {
      const contacts = await db.select().from(objectContacts)
        .where(and(
          eq(objectContacts.objectId, ancestorId),
          eq(objectContacts.tenantId, tenantId)
        ));
      
      for (const contact of contacts) {
        const typeKey = contact.contactType || 'primary';
        if (!seenTypes.has(typeKey)) {
          if (ancestorId === objectId) {
            result.push(contact);
          } else if (contact.isInheritable) {
            result.push({ ...contact, inheritedFromObjectId: ancestorId });
          }
          seenTypes.add(typeKey);
        }
      }
    }
    
    return result;
  }

  async createObjectContact(contact: InsertObjectContact): Promise<ObjectContact> {
    const [result] = await db.insert(objectContacts).values(contact).returning();
    return result;
  }

  async updateObjectContact(id: string, objectId: string, tenantId: string, data: Partial<InsertObjectContact>): Promise<ObjectContact | undefined> {
    const [result] = await db.update(objectContacts)
      .set(data)
      .where(and(
        eq(objectContacts.id, id),
        eq(objectContacts.objectId, objectId),
        eq(objectContacts.tenantId, tenantId)
      ))
      .returning();
    return result || undefined;
  }

  async deleteObjectContact(id: string, objectId: string, tenantId: string): Promise<void> {
    await db.delete(objectContacts).where(and(
      eq(objectContacts.id, id),
      eq(objectContacts.objectId, objectId),
      eq(objectContacts.tenantId, tenantId)
    ));
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

  async getObjectTimeRestrictions(objectId: string): Promise<ObjectTimeRestriction[]> {
    return db.select().from(objectTimeRestrictions)
      .where(eq(objectTimeRestrictions.objectId, objectId));
  }

  async getObjectTimeRestrictionsByTenant(tenantId: string): Promise<ObjectTimeRestriction[]> {
    return db.select().from(objectTimeRestrictions)
      .where(eq(objectTimeRestrictions.tenantId, tenantId));
  }

  async getObjectTimeRestrictionsByObjectIds(tenantId: string, objectIds: string[]): Promise<ObjectTimeRestriction[]> {
    if (objectIds.length === 0) return [];
    return db.select().from(objectTimeRestrictions)
      .where(and(
        eq(objectTimeRestrictions.tenantId, tenantId),
        inArray(objectTimeRestrictions.objectId, objectIds),
        eq(objectTimeRestrictions.isActive, true)
      ));
  }

  async createObjectTimeRestriction(restriction: InsertObjectTimeRestriction): Promise<ObjectTimeRestriction> {
    const [result] = await db.insert(objectTimeRestrictions).values(restriction).returning();
    return result;
  }

  async updateObjectTimeRestriction(id: string, tenantId: string, data: Partial<InsertObjectTimeRestriction>): Promise<ObjectTimeRestriction | undefined> {
    const [result] = await db.update(objectTimeRestrictions)
      .set(data)
      .where(and(
        eq(objectTimeRestrictions.id, id),
        eq(objectTimeRestrictions.tenantId, tenantId)
      ))
      .returning();
    return result || undefined;
  }

  async deleteObjectTimeRestriction(id: string, tenantId: string): Promise<void> {
    await db.delete(objectTimeRestrictions).where(and(
      eq(objectTimeRestrictions.id, id),
      eq(objectTimeRestrictions.tenantId, tenantId)
    ));
  }

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
    const [result] = await db.insert(assignments).values(assignment).returning();
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
    return result || undefined;
  }

  async deleteAssignment(id: string, tenantId: string): Promise<void> {
    await db.update(assignments)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(assignments.id, id),
        eq(assignments.tenantId, tenantId)
      ));
  }

  // ============================================
  // Assignment Articles
  // ============================================
  
  async getAssignmentArticles(assignmentId: string): Promise<AssignmentArticle[]> {
    return db.select().from(assignmentArticles)
      .where(eq(assignmentArticles.assignmentId, assignmentId))
      .orderBy(assignmentArticles.sequenceOrder);
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
    const [customer] = await db.select().from(customers)
      .where(and(
        eq(customers.email, email),
        eq(customers.tenantId, tenantId),
        isNull(customers.deletedAt)
      ));
    return customer || undefined;
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

  async getChecklistTemplate(id: string): Promise<ChecklistTemplate | undefined> {
    const [result] = await db.select().from(checklistTemplates).where(eq(checklistTemplates.id, id));
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

  async updateChecklistTemplate(id: string, data: Partial<InsertChecklistTemplate>): Promise<ChecklistTemplate | undefined> {
    const [result] = await db.update(checklistTemplates).set({ ...data, updatedAt: new Date() }).where(eq(checklistTemplates.id, id)).returning();
    return result;
  }

  async deleteChecklistTemplate(id: string): Promise<void> {
    await db.delete(checklistTemplates).where(eq(checklistTemplates.id, id));
  }

  async getDriverNotifications(resourceId: string, options?: { unreadOnly?: boolean; limit?: number }): Promise<DriverNotification[]> {
    const conditions = [eq(driverNotifications.resourceId, resourceId)];
    if (options?.unreadOnly) conditions.push(eq(driverNotifications.isRead, false));
    let query = db.select().from(driverNotifications).where(and(...conditions)).orderBy(desc(driverNotifications.createdAt));
    if (options?.limit) query = query.limit(options.limit) as any;
    return query;
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
}

export const storage = new DatabaseStorage();
