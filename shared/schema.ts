import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean, real, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const tenants = pgTable("tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  orgNumber: text("org_number"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;

export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  customerNumber: text("customer_number"),
  contactPerson: text("contact_person"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  postalCode: text("postal_code"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const objects = pgTable("objects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  parentId: varchar("parent_id").references((): any => objects.id),
  name: text("name").notNull(),
  objectNumber: text("object_number"),
  objectType: text("object_type").default("omrade").notNull(),
  objectLevel: integer("object_level").default(1).notNull(),
  address: text("address"),
  city: text("city"),
  postalCode: text("postal_code"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  accessType: text("access_type").default("open"),
  accessCode: text("access_code"),
  keyNumber: text("key_number"),
  accessInfo: jsonb("access_info").default({}),
  preferredTime1: text("preferred_time_1"),
  preferredTime2: text("preferred_time_2"),
  containerCount: integer("container_count").default(0),
  containerCountK2: integer("container_count_k2").default(0),
  containerCountK3: integer("container_count_k3").default(0),
  containerCountK4: integer("container_count_k4").default(0),
  servicePeriods: jsonb("service_periods").default({}),
  avgSetupTime: integer("avg_setup_time").default(0),
  status: text("status").default("active").notNull(),
  notes: text("notes"),
  lastServiceDate: timestamp("last_service_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const resources = pgTable("resources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  userId: varchar("user_id").references(() => users.id),
  name: text("name").notNull(),
  initials: text("initials"),
  resourceType: text("resource_type").default("person").notNull(),
  phone: text("phone"),
  email: text("email"),
  homeLocation: text("home_location"),
  weeklyHours: integer("weekly_hours").default(40),
  competencies: text("competencies").array().default([]),
  availability: jsonb("availability").default({}),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const workOrders = pgTable("work_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id),
  title: text("title").notNull(),
  description: text("description"),
  orderType: text("order_type").default("service").notNull(),
  priority: text("priority").default("normal").notNull(),
  status: text("status").default("draft").notNull(),
  scheduledDate: timestamp("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  estimatedDuration: integer("estimated_duration").default(60),
  actualDuration: integer("actual_duration"),
  setupTime: integer("setup_time"),
  setupReason: text("setup_reason"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const setupTimeLogs = pgTable("setup_time_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id),
  category: text("category").default("other").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const procurements = pgTable("procurements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id),
  title: text("title").notNull(),
  referenceNumber: text("reference_number"),
  description: text("description"),
  status: text("status").default("draft").notNull(),
  deadline: timestamp("deadline"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  estimatedValue: integer("estimated_value"),
  objectIds: text("object_ids").array().default([]),
  containerCountTotal: integer("container_count_total").default(0),
  estimatedHoursPerWeek: integer("estimated_hours_per_week"),
  notes: text("notes"),
  metadata: jsonb("metadata").default({}),
  submittedAt: timestamp("submitted_at"),
  wonAt: timestamp("won_at"),
  lostAt: timestamp("lost_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  customers: many(customers),
  objects: many(objects),
  resources: many(resources),
  workOrders: many(workOrders),
  procurements: many(procurements),
}));

export const procurementsRelations = relations(procurements, ({ one }) => ({
  tenant: one(tenants, { fields: [procurements.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [procurements.customerId], references: [customers.id] }),
}));


export const customersRelations = relations(customers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [customers.tenantId], references: [tenants.id] }),
  objects: many(objects),
  workOrders: many(workOrders),
}));

export const objectsRelations = relations(objects, ({ one, many }) => ({
  tenant: one(tenants, { fields: [objects.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [objects.customerId], references: [customers.id] }),
  parent: one(objects, { fields: [objects.parentId], references: [objects.id], relationName: "objectHierarchy" }),
  children: many(objects, { relationName: "objectHierarchy" }),
  workOrders: many(workOrders),
}));

export const resourcesRelations = relations(resources, ({ one, many }) => ({
  tenant: one(tenants, { fields: [resources.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [resources.userId], references: [users.id] }),
  workOrders: many(workOrders),
}));

export const workOrdersRelations = relations(workOrders, ({ one }) => ({
  tenant: one(tenants, { fields: [workOrders.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [workOrders.customerId], references: [customers.id] }),
  object: one(objects, { fields: [workOrders.objectId], references: [objects.id] }),
  resource: one(resources, { fields: [workOrders.resourceId], references: [resources.id] }),
}));

export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export const insertObjectSchema = createInsertSchema(objects).omit({ id: true, createdAt: true });
export const insertResourceSchema = createInsertSchema(resources).omit({ id: true, createdAt: true });
export const insertWorkOrderSchema = createInsertSchema(workOrders).omit({ id: true, createdAt: true });
export const insertSetupTimeLogSchema = createInsertSchema(setupTimeLogs).omit({ id: true, createdAt: true });
export const insertProcurementSchema = createInsertSchema(procurements).omit({ id: true, createdAt: true });

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type ServiceObject = typeof objects.$inferSelect;
export type InsertObject = z.infer<typeof insertObjectSchema>;
export type Resource = typeof resources.$inferSelect;
export type InsertResource = z.infer<typeof insertResourceSchema>;
export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;
export type SetupTimeLog = typeof setupTimeLogs.$inferSelect;
export type InsertSetupTimeLog = z.infer<typeof insertSetupTimeLogSchema>;
export type Procurement = typeof procurements.$inferSelect;
export type InsertProcurement = z.infer<typeof insertProcurementSchema>;
