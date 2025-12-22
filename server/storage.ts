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
  users, tenants, customers, objects, resources, workOrders, setupTimeLogs, procurements,
  articles, priceLists, priceListArticles, resourceArticles
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, isNull, desc, gte, lte } from "drizzle-orm";

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
      title: workOrders.title,
      description: workOrders.description,
      orderType: workOrders.orderType,
      priority: workOrders.priority,
      status: workOrders.status,
      scheduledDate: workOrders.scheduledDate,
      scheduledStartTime: workOrders.scheduledStartTime,
      estimatedDuration: workOrders.estimatedDuration,
      actualDuration: workOrders.actualDuration,
      setupTime: workOrders.setupTime,
      setupReason: workOrders.setupReason,
      completedAt: workOrders.completedAt,
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
}

export const storage = new DatabaseStorage();
