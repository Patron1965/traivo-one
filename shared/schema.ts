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
  // Kluster som objektet tillhör - navet i verksamheten
  clusterId: varchar("cluster_id"),
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
  // GPS-koordinater för utgångsplats
  homeLatitude: real("home_latitude"),
  homeLongitude: real("home_longitude"),
  weeklyHours: integer("weekly_hours").default(40),
  competencies: text("competencies").array().default([]),
  availability: jsonb("availability").default({}),
  // Geografiskt område (postnummer för normalt verksamhetsområde)
  serviceArea: text("service_area").array().default([]),
  // Effektivitetsfaktor övergripande (1.0 = normal)
  efficiencyFactor: real("efficiency_factor").default(1.0),
  // Körtempo-faktor (1.0 = normal)
  drivingFactor: real("driving_factor").default(1.0),
  // Kostnadsställe i ekonomisystem
  costCenter: text("cost_center"),
  // Projekt i ekonomisystem
  projectCode: text("project_code"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

// Simuleringsscenarier för att testa ordrar utan att de blir skarpa
export const simulationScenarios = pgTable("simulation_scenarios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  // draft, active, archived
  status: text("status").default("draft").notNull(),
  createdBy: varchar("created_by"),
  baselineSnapshot: jsonb("baseline_snapshot").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const workOrders = pgTable("work_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  // Kluster som ordern tillhör (ärvs från objekt eller sätts manuellt)
  clusterId: varchar("cluster_id"),
  resourceId: varchar("resource_id").references(() => resources.id),
  // Team för förplanering (innan specifik resurs är tilldelad)
  teamId: varchar("team_id").references(() => teams.id),
  title: text("title").notNull(),
  description: text("description"),
  orderType: text("order_type").default("service").notNull(),
  priority: text("priority").default("normal").notNull(),
  // Legacy status field - use orderStatus for new Modus flow
  status: text("status").default("draft").notNull(),
  // Modus-style order status: skapad, planerad_pre, planerad_resurs, planerad_las, utford, fakturerad
  orderStatus: text("order_status").default("skapad").notNull(),
  scheduledDate: timestamp("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  // Planerat tidsfönster för optimering
  plannedWindowStart: timestamp("planned_window_start"),
  plannedWindowEnd: timestamp("planned_window_end"),
  estimatedDuration: integer("estimated_duration").default(60),
  actualDuration: integer("actual_duration"),
  setupTime: integer("setup_time"),
  setupReason: text("setup_reason"),
  // Tidsstämplar för statusflöde
  lockedAt: timestamp("locked_at"),
  completedAt: timestamp("completed_at"),
  invoicedAt: timestamp("invoiced_at"),
  // Cachade beräknade värden från orderrader
  cachedValue: integer("cached_value").default(0),
  cachedCost: integer("cached_cost").default(0),
  cachedProductionMinutes: integer("cached_production_minutes").default(0),
  // Simulering
  isSimulated: boolean("is_simulated").default(false),
  simulationScenarioId: varchar("simulation_scenario_id").references(() => simulationScenarios.id),
  // Planeringsmetadata
  plannedBy: varchar("planned_by"),
  plannedNotes: text("planned_notes"),
  notes: text("notes"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

// Orderrader - artiklar kopplade till en order med beräknade priser
export const workOrderLines = pgTable("work_order_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id).notNull(),
  quantity: integer("quantity").default(1).notNull(),
  // Beräknat pris (från prislisthierarkin vid skapande)
  resolvedPrice: integer("resolved_price").default(0),
  // Beräknad kostnad
  resolvedCost: integer("resolved_cost").default(0),
  // Beräknad produktionstid i minuter
  resolvedProductionMinutes: integer("resolved_production_minutes").default(0),
  // Vilken prislista som användes
  priceListIdUsed: varchar("price_list_id_used").references(() => priceLists.id),
  // Priskälla (rabattbrev, kundunik, generell, listprice)
  priceSource: varchar("price_source"),
  // Ev rabatt i procent
  discountPercent: integer("discount_percent").default(0),
  // Valfri rad (kan tas bort utan att påverka ordern)
  isOptional: boolean("is_optional").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_work_order_lines_work_order_id").on(table.workOrderId)
]);

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

// Artiklar - tjänster, varor, kontroller etc.
export const articles = pgTable("articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  articleNumber: text("article_number").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  // felanmalan, tjanst, kontroll, vara, beroende
  articleType: text("article_type").default("tjanst").notNull(),
  // Vilka objekttyper artikeln kan kopplas till (t.ex. ["matavfall", "atervinning"])
  objectTypes: text("object_types").array().default([]),
  // Produktionstid i minuter
  productionTime: integer("production_time").default(0),
  // Kostnad (intern)
  cost: integer("cost").default(0),
  // Listpris (standard)
  listPrice: integer("list_price").default(0),
  // För varor: lagerplats
  stockLocation: text("stock_location"),
  // För beroende: antal minuter före huvuduppgift
  dependencyMinutesBefore: integer("dependency_minutes_before"),
  unit: text("unit").default("st"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

// Prislistor - generella, kundunikt eller rabattbrev
export const priceLists = pgTable("price_lists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  // generell, kundunik, rabattbrev
  priceListType: text("price_list_type").default("generell").notNull(),
  // Om kundunik eller rabattbrev, koppla till kund
  customerId: varchar("customer_id").references(() => customers.id),
  // För rabattbrev: procentuell rabatt
  discountPercent: integer("discount_percent"),
  // Prioritet (högre = överskrider lägre)
  priority: integer("priority").default(1),
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

// Koppling prislista <-> artikel med specifikt pris
export const priceListArticles = pgTable("price_list_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  priceListId: varchar("price_list_id").references(() => priceLists.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id).notNull(),
  // Nettopris i denna prislista (överskrider listPrice)
  price: integer("price").notNull(),
  // Ev justerad produktionstid för denna prislista
  productionTime: integer("production_time"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Fordon - kopplade till resurser
export const vehicles = pgTable("vehicles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Registreringsnummer
  registrationNumber: text("registration_number").notNull(),
  name: text("name").notNull(),
  // Fordonstyp: bil, lastbil, minibuss, etc.
  vehicleType: text("vehicle_type").default("bil").notNull(),
  // Kapacitet i ton
  capacityTons: real("capacity_tons"),
  // Volym i kubikmeter
  capacityVolume: real("capacity_volume"),
  // Koppling till kostnadsställe i ekonomisystem
  costCenter: text("cost_center"),
  // Service-intervall i dagar
  serviceIntervalDays: integer("service_interval_days").default(90),
  // Senaste service
  lastServiceDate: timestamp("last_service_date"),
  // Nästa planerade service
  nextServiceDate: timestamp("next_service_date"),
  // Mätarställning vid senaste service
  mileageAtLastService: integer("mileage_at_last_service"),
  // Aktuell mätarställning
  currentMileage: integer("current_mileage"),
  // Drivmedel: diesel, bensin, el, hybrid
  fuelType: text("fuel_type").default("diesel"),
  // Försäkringsnummer
  insuranceNumber: text("insurance_number"),
  // Besiktningsdatum
  inspectionDate: timestamp("inspection_date"),
  notes: text("notes"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

// Utrustning - verktyg och maskiner
export const equipment = pgTable("equipment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  // Inventarienummer
  inventoryNumber: text("inventory_number"),
  // Typ: verktyg, maskin, fordonsutrustning, säkerhet
  equipmentType: text("equipment_type").default("verktyg").notNull(),
  // Tillverkare
  manufacturer: text("manufacturer"),
  // Modell
  model: text("model"),
  // Inköpsdatum
  purchaseDate: timestamp("purchase_date"),
  // Inköpspris
  purchasePrice: integer("purchase_price"),
  // Garantidatum
  warrantyUntil: timestamp("warranty_until"),
  // Senaste inspektion/service
  lastInspectionDate: timestamp("last_inspection_date"),
  // Koppling till kostnadsställe
  costCenter: text("cost_center"),
  notes: text("notes"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

// Koppling resurs <-> fordon (vilka fordon en resurs kan/får köra)
export const resourceVehicles = pgTable("resource_vehicles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id).notNull(),
  // Primärt fordon för resursen
  isPrimary: boolean("is_primary").default(false),
  // Giltigt från/till
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Koppling resurs <-> utrustning
export const resourceEquipment = pgTable("resource_equipment", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  equipmentId: varchar("equipment_id").references(() => equipment.id).notNull(),
  // Tilldelad från/till
  assignedFrom: timestamp("assigned_from"),
  assignedTo: timestamp("assigned_to"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Tillgänglighetsschema för resurser (arbetstider, ledighet, semester, etc.)
export const resourceAvailability = pgTable("resource_availability", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  // Typ: arbetstid, semester, sjuk, utbildning, rast, service, annat
  availabilityType: text("availability_type").notNull(),
  // Datum
  date: timestamp("date").notNull(),
  // Starttid (för arbetstid/rast)
  startTime: text("start_time"),
  // Sluttid
  endTime: text("end_time"),
  // Heldag (t.ex. semester)
  isFullDay: boolean("is_full_day").default(false),
  // Tillgänglig eller ej tillgänglig
  isAvailable: boolean("is_available").default(true),
  // Återkommande: once, weekly, daily
  recurrence: text("recurrence").default("once"),
  // Notering
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_resource_availability_resource_date").on(table.resourceId, table.date)
]);

// Fordonsschema (när fordon är tillgängliga/i service)
export const vehicleSchedule = pgTable("vehicle_schedule", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id).notNull(),
  // Typ: tillganglig, service, reparation, besiktning
  scheduleType: text("schedule_type").notNull(),
  date: timestamp("date").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  isFullDay: boolean("is_full_day").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Abonnemang - periodiska tjänster
export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  // Kluster som abonnemanget tillhör (ärvs från objekt)
  clusterId: varchar("cluster_id"),
  name: text("name").notNull(),
  description: text("description"),
  // Artiklar som ingår i abonnemanget (JSON array av article IDs med kvantitet)
  articleIds: jsonb("article_ids").default([]),
  // Periodicitet: vecka, varannan_vecka, manad, kvartal, halvar, ar
  periodicity: text("periodicity").default("manad").notNull(),
  // Specifik veckodag (0=söndag, 1=måndag, etc.)
  preferredWeekday: integer("preferred_weekday"),
  // Specifik dag i månaden (1-31)
  preferredDayOfMonth: integer("preferred_day_of_month"),
  // Föredragen tid på dagen
  preferredTimeSlot: text("preferred_time_slot"),
  // Startdatum
  startDate: timestamp("start_date").notNull(),
  // Slutdatum (null = tillsvidare)
  endDate: timestamp("end_date"),
  // Senast genererad order
  lastGeneratedDate: timestamp("last_generated_date"),
  // Nästa planerade generering
  nextGenerationDate: timestamp("next_generation_date"),
  // Generera ordrar automatiskt
  autoGenerate: boolean("auto_generate").default(true),
  // Dagar i förväg att generera ordrar
  generateDaysAhead: integer("generate_days_ahead").default(14),
  // Prislista för abonnemanget
  priceListId: varchar("price_list_id").references(() => priceLists.id),
  // Cachade värden
  cachedMonthlyValue: integer("cached_monthly_value").default(0),
  notes: text("notes"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_subscriptions_customer").on(table.customerId),
  index("idx_subscriptions_object").on(table.objectId),
  index("idx_subscriptions_next_gen").on(table.nextGenerationDate)
]);

// Kluster - kärnan i verksamheten, samlar objekt, team, resurser och flöden
export const clusters = pgTable("clusters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  // Geografiskt centrum
  centerLatitude: real("center_latitude"),
  centerLongitude: real("center_longitude"),
  // Geografisk radie i km
  radiusKm: real("radius_km").default(5),
  // Postnummerområden som ingår i klustret
  postalCodes: text("postal_codes").array().default([]),
  // Ansvarigt team för klustret
  primaryTeamId: varchar("primary_team_id"),
  // SLA-nivå för klustret: standard, premium, express
  slaLevel: text("sla_level").default("standard"),
  // Planerad servicefrekvens
  defaultPeriodicity: text("default_periodicity").default("vecka"),
  // Färgkod för visualisering
  color: text("color").default("#3B82F6"),
  // Cachade värden för snabb uppföljning
  cachedObjectCount: integer("cached_object_count").default(0),
  cachedActiveOrders: integer("cached_active_orders").default(0),
  cachedMonthlyValue: integer("cached_monthly_value").default(0),
  cachedAvgSetupTime: integer("cached_avg_setup_time").default(0),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

// Team - grupper av resurser
export const teams = pgTable("teams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Kluster som teamet primärt ansvarar för
  clusterId: varchar("cluster_id").references(() => clusters.id),
  name: text("name").notNull(),
  description: text("description"),
  // Teamleadare
  leaderId: varchar("leader_id").references(() => resources.id),
  // Geografiskt område (postnummer)
  serviceArea: text("service_area").array().default([]),
  // Koppling till projekt i ekonomisystem
  projectCode: text("project_code"),
  color: text("color").default("#3B82F6"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

// Koppling team <-> resurser
export const teamMembers = pgTable("team_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  teamId: varchar("team_id").references(() => teams.id).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  // Roll: medlem, ledare, vikarie
  role: text("role").default("medlem"),
  // Giltigt från/till
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Planeringsparametrar per objekt (SLA, tidsfönster, etc.)
export const planningParameters = pgTable("planning_parameters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Kan kopplas till kund, objekt eller vara generell
  customerId: varchar("customer_id").references(() => customers.id),
  objectId: varchar("object_id").references(() => objects.id),
  // SLA-nivå: standard, premium, express
  slaLevel: text("sla_level").default("standard"),
  // Max antal dagar från begäran till utförande
  maxDaysToComplete: integer("max_days_to_complete").default(14),
  // Tidsfönster: morgon, formiddag, eftermiddag, kväll, heldag
  allowedTimeSlots: text("allowed_time_slots").array().default([]),
  // Tillåtna veckodagar (1-7)
  allowedWeekdays: integer("allowed_weekdays").array().default([]),
  // Kräver avisering i förväg (dagar)
  advanceNotificationDays: integer("advance_notification_days").default(0),
  // Kräver bekräftelse
  requiresConfirmation: boolean("requires_confirmation").default(false),
  // Prioritetsfaktor (1.0 = normal, högre = högre prio)
  priorityFactor: real("priority_factor").default(1.0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Utförare tidsverk - vilka artiklar en utförare kan utföra
export const resourceArticles = pgTable("resource_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id).notNull(),
  // Justerad produktionstid för denna utförare
  productionTime: integer("production_time"),
  // Effektivitetsfaktor (1.0 = normal, 0.8 = snabbare, 1.2 = långsammare)
  efficiencyFactor: real("efficiency_factor").default(1.0),
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
  cluster: one(clusters, { fields: [objects.clusterId], references: [clusters.id] }),
  parent: one(objects, { fields: [objects.parentId], references: [objects.id], relationName: "objectHierarchy" }),
  children: many(objects, { relationName: "objectHierarchy" }),
  workOrders: many(workOrders),
}));

export const resourcesRelations = relations(resources, ({ one, many }) => ({
  tenant: one(tenants, { fields: [resources.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [resources.userId], references: [users.id] }),
  workOrders: many(workOrders),
  resourceArticles: many(resourceArticles),
  resourceVehicles: many(resourceVehicles),
  resourceEquipment: many(resourceEquipment),
  availability: many(resourceAvailability),
  teamMemberships: many(teamMembers),
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [vehicles.tenantId], references: [tenants.id] }),
  resourceVehicles: many(resourceVehicles),
  schedule: many(vehicleSchedule),
}));

export const equipmentRelations = relations(equipment, ({ one, many }) => ({
  tenant: one(tenants, { fields: [equipment.tenantId], references: [tenants.id] }),
  resourceEquipment: many(resourceEquipment),
}));

export const resourceVehiclesRelations = relations(resourceVehicles, ({ one }) => ({
  resource: one(resources, { fields: [resourceVehicles.resourceId], references: [resources.id] }),
  vehicle: one(vehicles, { fields: [resourceVehicles.vehicleId], references: [vehicles.id] }),
}));

export const resourceEquipmentRelations = relations(resourceEquipment, ({ one }) => ({
  resource: one(resources, { fields: [resourceEquipment.resourceId], references: [resources.id] }),
  equipment: one(equipment, { fields: [resourceEquipment.equipmentId], references: [equipment.id] }),
}));

export const resourceAvailabilityRelations = relations(resourceAvailability, ({ one }) => ({
  tenant: one(tenants, { fields: [resourceAvailability.tenantId], references: [tenants.id] }),
  resource: one(resources, { fields: [resourceAvailability.resourceId], references: [resources.id] }),
}));

export const vehicleScheduleRelations = relations(vehicleSchedule, ({ one }) => ({
  tenant: one(tenants, { fields: [vehicleSchedule.tenantId], references: [tenants.id] }),
  vehicle: one(vehicles, { fields: [vehicleSchedule.vehicleId], references: [vehicles.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  tenant: one(tenants, { fields: [subscriptions.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [subscriptions.customerId], references: [customers.id] }),
  object: one(objects, { fields: [subscriptions.objectId], references: [objects.id] }),
  cluster: one(clusters, { fields: [subscriptions.clusterId], references: [clusters.id] }),
  priceList: one(priceLists, { fields: [subscriptions.priceListId], references: [priceLists.id] }),
}));

export const clustersRelations = relations(clusters, ({ one, many }) => ({
  tenant: one(tenants, { fields: [clusters.tenantId], references: [tenants.id] }),
  objects: many(objects),
  teams: many(teams),
  workOrders: many(workOrders),
  subscriptions: many(subscriptions),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  tenant: one(tenants, { fields: [teams.tenantId], references: [tenants.id] }),
  cluster: one(clusters, { fields: [teams.clusterId], references: [clusters.id] }),
  leader: one(resources, { fields: [teams.leaderId], references: [resources.id] }),
  members: many(teamMembers),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  resource: one(resources, { fields: [teamMembers.resourceId], references: [resources.id] }),
}));

export const planningParametersRelations = relations(planningParameters, ({ one }) => ({
  tenant: one(tenants, { fields: [planningParameters.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [planningParameters.customerId], references: [customers.id] }),
  object: one(objects, { fields: [planningParameters.objectId], references: [objects.id] }),
}));

export const articlesRelations = relations(articles, ({ one, many }) => ({
  tenant: one(tenants, { fields: [articles.tenantId], references: [tenants.id] }),
  priceListArticles: many(priceListArticles),
  resourceArticles: many(resourceArticles),
}));

export const priceListsRelations = relations(priceLists, ({ one, many }) => ({
  tenant: one(tenants, { fields: [priceLists.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [priceLists.customerId], references: [customers.id] }),
  priceListArticles: many(priceListArticles),
}));

export const priceListArticlesRelations = relations(priceListArticles, ({ one }) => ({
  priceList: one(priceLists, { fields: [priceListArticles.priceListId], references: [priceLists.id] }),
  article: one(articles, { fields: [priceListArticles.articleId], references: [articles.id] }),
}));

export const resourceArticlesRelations = relations(resourceArticles, ({ one }) => ({
  resource: one(resources, { fields: [resourceArticles.resourceId], references: [resources.id] }),
  article: one(articles, { fields: [resourceArticles.articleId], references: [articles.id] }),
}));

export const simulationScenariosRelations = relations(simulationScenarios, ({ one, many }) => ({
  tenant: one(tenants, { fields: [simulationScenarios.tenantId], references: [tenants.id] }),
  workOrders: many(workOrders),
}));

export const workOrdersRelations = relations(workOrders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workOrders.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [workOrders.customerId], references: [customers.id] }),
  object: one(objects, { fields: [workOrders.objectId], references: [objects.id] }),
  cluster: one(clusters, { fields: [workOrders.clusterId], references: [clusters.id] }),
  resource: one(resources, { fields: [workOrders.resourceId], references: [resources.id] }),
  team: one(teams, { fields: [workOrders.teamId], references: [teams.id] }),
  simulationScenario: one(simulationScenarios, { fields: [workOrders.simulationScenarioId], references: [simulationScenarios.id] }),
  lines: many(workOrderLines),
}));

export const workOrderLinesRelations = relations(workOrderLines, ({ one }) => ({
  tenant: one(tenants, { fields: [workOrderLines.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [workOrderLines.workOrderId], references: [workOrders.id] }),
  article: one(articles, { fields: [workOrderLines.articleId], references: [articles.id] }),
  priceListUsed: one(priceLists, { fields: [workOrderLines.priceListIdUsed], references: [priceLists.id] }),
}));

export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export const insertObjectSchema = createInsertSchema(objects).omit({ id: true, createdAt: true });
export const insertResourceSchema = createInsertSchema(resources).omit({ id: true, createdAt: true });
export const insertWorkOrderSchema = createInsertSchema(workOrders).omit({ id: true, createdAt: true });
export const insertWorkOrderLineSchema = createInsertSchema(workOrderLines).omit({ id: true, createdAt: true });
export const insertSimulationScenarioSchema = createInsertSchema(simulationScenarios).omit({ id: true, createdAt: true });
export const insertSetupTimeLogSchema = createInsertSchema(setupTimeLogs).omit({ id: true, createdAt: true });
export const insertProcurementSchema = createInsertSchema(procurements).omit({ id: true, createdAt: true });
export const insertArticleSchema = createInsertSchema(articles).omit({ id: true, createdAt: true });
export const insertPriceListSchema = createInsertSchema(priceLists).omit({ id: true, createdAt: true });
export const insertPriceListArticleSchema = createInsertSchema(priceListArticles).omit({ id: true, createdAt: true });
export const insertResourceArticleSchema = createInsertSchema(resourceArticles).omit({ id: true, createdAt: true });
export const insertVehicleSchema = createInsertSchema(vehicles).omit({ id: true, createdAt: true });
export const insertEquipmentSchema = createInsertSchema(equipment).omit({ id: true, createdAt: true });
export const insertResourceVehicleSchema = createInsertSchema(resourceVehicles).omit({ id: true, createdAt: true });
export const insertResourceEquipmentSchema = createInsertSchema(resourceEquipment).omit({ id: true, createdAt: true });
export const insertResourceAvailabilitySchema = createInsertSchema(resourceAvailability).omit({ id: true, createdAt: true });
export const insertVehicleScheduleSchema = createInsertSchema(vehicleSchedule).omit({ id: true, createdAt: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true });
export const insertTeamSchema = createInsertSchema(teams).omit({ id: true, createdAt: true });
export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({ id: true, createdAt: true });
export const insertPlanningParameterSchema = createInsertSchema(planningParameters).omit({ id: true, createdAt: true });
export const insertClusterSchema = createInsertSchema(clusters).omit({ id: true, createdAt: true });

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
export type WorkOrderWithObject = WorkOrder & {
  objectName: string | null;
  objectAddress: string | null;
};
export type SetupTimeLog = typeof setupTimeLogs.$inferSelect;
export type InsertSetupTimeLog = z.infer<typeof insertSetupTimeLogSchema>;
export type Procurement = typeof procurements.$inferSelect;
export type InsertProcurement = z.infer<typeof insertProcurementSchema>;
export type Article = typeof articles.$inferSelect;
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type PriceList = typeof priceLists.$inferSelect;
export type InsertPriceList = z.infer<typeof insertPriceListSchema>;
export type PriceListArticle = typeof priceListArticles.$inferSelect;
export type InsertPriceListArticle = z.infer<typeof insertPriceListArticleSchema>;
export type ResourceArticle = typeof resourceArticles.$inferSelect;
export type InsertResourceArticle = z.infer<typeof insertResourceArticleSchema>;
export type WorkOrderLine = typeof workOrderLines.$inferSelect;
export type InsertWorkOrderLine = z.infer<typeof insertWorkOrderLineSchema>;
export type SimulationScenario = typeof simulationScenarios.$inferSelect;
export type InsertSimulationScenario = z.infer<typeof insertSimulationScenarioSchema>;
export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Equipment = typeof equipment.$inferSelect;
export type InsertEquipment = z.infer<typeof insertEquipmentSchema>;
export type ResourceVehicle = typeof resourceVehicles.$inferSelect;
export type InsertResourceVehicle = z.infer<typeof insertResourceVehicleSchema>;
export type ResourceEquipment = typeof resourceEquipment.$inferSelect;
export type InsertResourceEquipment = z.infer<typeof insertResourceEquipmentSchema>;
export type ResourceAvailability = typeof resourceAvailability.$inferSelect;
export type InsertResourceAvailability = z.infer<typeof insertResourceAvailabilitySchema>;
export type VehicleSchedule = typeof vehicleSchedule.$inferSelect;
export type InsertVehicleSchedule = z.infer<typeof insertVehicleScheduleSchema>;
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type TeamMember = typeof teamMembers.$inferSelect;
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type PlanningParameter = typeof planningParameters.$inferSelect;
export type InsertPlanningParameter = z.infer<typeof insertPlanningParameterSchema>;
export type Cluster = typeof clusters.$inferSelect;
export type InsertCluster = z.infer<typeof insertClusterSchema>;

// Order status constants
export const ORDER_STATUSES = [
  "skapad",
  "planerad_pre", 
  "planerad_resurs",
  "planerad_las",
  "utford",
  "fakturerad"
] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

// AI Chat tables for planning assistant
export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

// ============================================
// SYSTEM DASHBOARD - Branding & User Management
// ============================================

// Branding Templates - Predefined industry templates
export const brandingTemplates = pgTable("branding_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  industry: text("industry").notNull(),
  description: text("description"),
  // Color configuration (7 key colors)
  primaryColor: varchar("primary_color", { length: 7 }).notNull(),
  primaryLight: varchar("primary_light", { length: 7 }),
  primaryDark: varchar("primary_dark", { length: 7 }),
  secondaryColor: varchar("secondary_color", { length: 7 }).notNull(),
  accentColor: varchar("accent_color", { length: 7 }).notNull(),
  successColor: varchar("success_color", { length: 7 }).default("#22C55E"),
  errorColor: varchar("error_color", { length: 7 }).default("#EF4444"),
  // Default texts
  defaultHeading: text("default_heading"),
  defaultSubheading: text("default_subheading"),
  // Preview image
  previewImageUrl: varchar("preview_image_url", { length: 500 }),
  // System template (cannot be deleted)
  isSystem: boolean("is_system").default(true),
  usageCount: integer("usage_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Tenant Branding - Per-tenant branding configuration
export const tenantBranding = pgTable("tenant_branding", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull().unique(),
  // Version control
  version: integer("version").default(1),
  isPublished: boolean("is_published").default(false),
  // Template used (if any)
  templateId: varchar("template_id").references(() => brandingTemplates.id),
  // Colors (7 key colors for MVP)
  primaryColor: varchar("primary_color", { length: 7 }).default("#3B82F6"),
  primaryLight: varchar("primary_light", { length: 7 }),
  primaryDark: varchar("primary_dark", { length: 7 }),
  secondaryColor: varchar("secondary_color", { length: 7 }).default("#6366F1"),
  accentColor: varchar("accent_color", { length: 7 }).default("#F59E0B"),
  successColor: varchar("success_color", { length: 7 }).default("#22C55E"),
  errorColor: varchar("error_color", { length: 7 }).default("#EF4444"),
  // Typography
  fontFamily: varchar("font_family", { length: 100 }).default("Inter"),
  // Logos
  logoUrl: varchar("logo_url", { length: 500 }),
  logoIconUrl: varchar("logo_icon_url", { length: 500 }),
  faviconUrl: varchar("favicon_url", { length: 500 }),
  // Texts
  companyName: text("company_name"),
  tagline: text("tagline"),
  headingText: text("heading_text"),
  subheadingText: text("subheading_text"),
  // Dark mode
  darkModeEnabled: boolean("dark_mode_enabled").default(true),
  // Metadata
  createdBy: varchar("created_by").references(() => users.id),
  updatedBy: varchar("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
  publishedAt: timestamp("published_at"),
});

// User Tenant Roles - Links users to tenants with roles
export const userTenantRoles = pgTable("user_tenant_roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Role: owner, admin, user
  role: varchar("role", { length: 20 }).default("user").notNull(),
  // Additional permissions (JSON array)
  permissions: jsonb("permissions").default([]),
  // Status
  isActive: boolean("is_active").default(true),
  // Assigned by
  assignedBy: varchar("assigned_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_user_tenant_roles_user").on(table.userId),
  index("idx_user_tenant_roles_tenant").on(table.tenantId),
]);

// Audit Logs - Track all changes in the system
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  userId: varchar("user_id").references(() => users.id),
  // Action: create, update, delete, login, logout, etc.
  action: varchar("action", { length: 100 }).notNull(),
  // Resource type: users, branding, tenants, etc.
  resourceType: varchar("resource_type", { length: 50 }),
  resourceId: varchar("resource_id"),
  // Changes (before/after values)
  changes: jsonb("changes"),
  // Request metadata
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_logs_tenant").on(table.tenantId),
  index("idx_audit_logs_user").on(table.userId),
  index("idx_audit_logs_action").on(table.action),
  index("idx_audit_logs_created").on(table.createdAt),
]);

// Relations
export const brandingTemplatesRelations = relations(brandingTemplates, ({ many }) => ({
  tenantBrandings: many(tenantBranding),
}));

export const tenantBrandingRelations = relations(tenantBranding, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantBranding.tenantId], references: [tenants.id] }),
  template: one(brandingTemplates, { fields: [tenantBranding.templateId], references: [brandingTemplates.id] }),
  createdByUser: one(users, { fields: [tenantBranding.createdBy], references: [users.id] }),
  updatedByUser: one(users, { fields: [tenantBranding.updatedBy], references: [users.id] }),
}));

export const userTenantRolesRelations = relations(userTenantRoles, ({ one }) => ({
  user: one(users, { fields: [userTenantRoles.userId], references: [users.id] }),
  tenant: one(tenants, { fields: [userTenantRoles.tenantId], references: [tenants.id] }),
  assignedByUser: one(users, { fields: [userTenantRoles.assignedBy], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [auditLogs.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

// Insert schemas
export const insertBrandingTemplateSchema = createInsertSchema(brandingTemplates).omit({ id: true, createdAt: true });
export const insertTenantBrandingSchema = createInsertSchema(tenantBranding).omit({ id: true, createdAt: true });
export const insertUserTenantRoleSchema = createInsertSchema(userTenantRoles).omit({ id: true, createdAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });

// Types
export type BrandingTemplate = typeof brandingTemplates.$inferSelect;
export type InsertBrandingTemplate = z.infer<typeof insertBrandingTemplateSchema>;
export type TenantBranding = typeof tenantBranding.$inferSelect;
export type InsertTenantBranding = z.infer<typeof insertTenantBrandingSchema>;
export type UserTenantRole = typeof userTenantRoles.$inferSelect;
export type InsertUserTenantRole = z.infer<typeof insertUserTenantRoleSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

// Role constants
export const USER_ROLES = ["owner", "admin", "user"] as const;
export type UserRole = typeof USER_ROLES[number];
