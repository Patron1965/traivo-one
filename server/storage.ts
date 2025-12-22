import { 
  type User, type InsertUser,
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
  type OrderStatus,
  users, tenants, customers, objects, resources, workOrders, setupTimeLogs, procurements,
  articles, priceLists, priceListArticles, resourceArticles, workOrderLines, simulationScenarios,
  vehicles, equipment, resourceVehicles, resourceEquipment, resourceAvailability,
  vehicleSchedule, subscriptions, teams, teamMembers, planningParameters
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, isNull, desc, gte, lte, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getTenant(id: string): Promise<Tenant | undefined>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  updateTenantSettings(id: string, settings: Record<string, unknown>): Promise<Tenant | undefined>;
  
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
  getWorkOrder(id: string): Promise<WorkOrder | undefined>;
  getWorkOrdersByResource(resourceId: string, startDate?: Date, endDate?: Date): Promise<WorkOrder[]>;
  getWorkOrdersByDate(tenantId: string, date: Date): Promise<WorkOrder[]>;
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
  createPriceListArticle(priceListArticle: InsertPriceListArticle): Promise<PriceListArticle>;
  updatePriceListArticle(id: string, data: Partial<InsertPriceListArticle>): Promise<PriceListArticle | undefined>;
  deletePriceListArticle(id: string): Promise<void>;
  
  // Resource Articles (tidsverk)
  getResourceArticles(resourceId: string): Promise<ResourceArticle[]>;
  createResourceArticle(resourceArticle: InsertResourceArticle): Promise<ResourceArticle>;
  updateResourceArticle(id: string, data: Partial<InsertResourceArticle>): Promise<ResourceArticle | undefined>;
  deleteResourceArticle(id: string): Promise<void>;
  
  // Work Order Lines
  getWorkOrderLines(workOrderId: string): Promise<WorkOrderLine[]>;
  createWorkOrderLine(line: InsertWorkOrderLine): Promise<WorkOrderLine>;
  updateWorkOrderLine(id: string, data: Partial<InsertWorkOrderLine>): Promise<WorkOrderLine | undefined>;
  deleteWorkOrderLine(id: string): Promise<void>;
  
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

  async getTenant(id: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(and(eq(tenants.id, id), isNull(tenants.deletedAt)));
    return tenant || undefined;
  }

  async createTenant(insertTenant: InsertTenant): Promise<Tenant> {
    const [tenant] = await db.insert(tenants).values(insertTenant).returning();
    return tenant;
  }

  async updateTenantSettings(id: string, settings: Record<string, unknown>): Promise<Tenant | undefined> {
    const [tenant] = await db.update(tenants).set({ settings }).where(eq(tenants.id, id)).returning();
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
      objectName: objects.name,
      objectAddress: objects.address,
    })
    .from(workOrders)
    .leftJoin(objects, eq(workOrders.objectId, objects.id))
    .where(and(...conditions))
    .orderBy(desc(workOrders.scheduledDate));
    
    if (limit) {
      query = query.limit(limit) as typeof query;
    }
    
    return query;
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
}

export const storage = new DatabaseStorage();
