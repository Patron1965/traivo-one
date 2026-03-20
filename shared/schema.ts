import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, serial, timestamp, jsonb, boolean, real, index, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const tenants = pgTable("tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  orgNumber: text("org_number"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  settings: jsonb("settings").default({}),
  customDomain: varchar("custom_domain", { length: 255 }),
  industry: varchar("industry", { length: 50 }),
  smsEnabled: boolean("sms_enabled").default(false),
  smsProvider: varchar("sms_provider", { length: 50 }),
  smsFromName: varchar("sms_from_name", { length: 100 }),
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
  passwordHash: varchar("password_hash"),
  role: varchar("role", { length: 30 }).default("user"),
  resourceId: varchar("resource_id"),
  isActive: boolean("is_active").default(true),
  lastLoginAt: timestamp("last_login_at"),
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
  importBatchId: text("import_batch_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_customers_tenant").on(table.tenantId),
]);

// Hierarkinivåer för objekt (Mats klusterfilosofi)
export const OBJECT_HIERARCHY_LEVELS = [
  "koncern",     // Översta nivå - juridisk koncern
  "brf",         // Bostadsrättsförening
  "fastighet",   // Fysisk fastighet
  "rum",         // Återvinningsrum/område inom fastighet
  "karl"         // Individuellt kärl
] as const;
export type ObjectHierarchyLevel = typeof OBJECT_HIERARCHY_LEVELS[number];

export const objects = pgTable("objects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  // Kluster som objektet tillhör - kundbaserad hierarki
  clusterId: varchar("cluster_id"),
  parentId: varchar("parent_id").references((): any => objects.id),
  name: text("name").notNull(),
  objectNumber: text("object_number"),
  objectType: text("object_type").default("omrade").notNull(),
  // Hierarkinivå: koncern, brf, fastighet, rum, karl
  hierarchyLevel: text("hierarchy_level").default("fastighet"),
  // Legacy - numerisk nivå (1=överst, 5=kärl)
  objectLevel: integer("object_level").default(1).notNull(),
  
  // === ADRESS & POSITION ===
  address: text("address"),
  city: text("city"),
  postalCode: text("postal_code"),
  // GPS-koordinater (läggs till vid geokodning/ruttoptimering)
  latitude: real("latitude"),
  longitude: real("longitude"),
  // Entrékoordinater (Google Geocoding v4 SearchDestinations)
  entranceLatitude: real("entrance_latitude"),
  entranceLongitude: real("entrance_longitude"),
  // Kontextuell adressbeskrivning (t.ex. "Runt hörnet från ICA")
  addressDescriptor: text("address_descriptor"),
  
  // === ÅTKOMSTINFORMATION (kan ärvas) ===
  accessType: text("access_type").default("open"),
  accessCode: text("access_code"),
  keyNumber: text("key_number"),
  accessInfo: jsonb("access_info").default({}),
  // Markerar om värdet är explicit satt eller ärvt från förälder
  accessCodeInherited: boolean("access_code_inherited").default(false),
  keyNumberInherited: boolean("key_number_inherited").default(false),
  accessInfoInherited: boolean("access_info_inherited").default(false),
  
  // === TIDSPREFERENSER (kan ärvas) ===
  preferredTime1: text("preferred_time_1"),
  preferredTime2: text("preferred_time_2"),
  preferredTimeInherited: boolean("preferred_time_inherited").default(false),
  
  // === KÄRLINFORMATION ===
  containerCount: integer("container_count").default(0),
  containerCountK2: integer("container_count_k2").default(0),
  containerCountK3: integer("container_count_k3").default(0),
  containerCountK4: integer("container_count_k4").default(0),
  servicePeriods: jsonb("service_periods").default({}),
  avgSetupTime: integer("avg_setup_time").default(0),
  
  // === INDIVIDHANTERING (för kärl) ===
  serialNumber: text("serial_number"), // Unikt serienummer/individnummer
  articleId: varchar("article_id"), // Kopplad artikeltyp
  manufacturer: text("manufacturer"), // Tillverkare
  purchaseDate: timestamp("purchase_date"), // Inköpsdatum
  warrantyExpiry: timestamp("warranty_expiry"), // Garantiutgång
  lastInspection: timestamp("last_inspection"), // Senaste besiktning
  condition: text("condition").default("good"), // good, fair, poor, damaged
  
  // === RESOLVED/BERÄKNADE VÄRDEN ===
  // Dessa fylls i av ärvningsprocessorn med slutgiltiga värden
  resolvedAccessCode: text("resolved_access_code"),
  resolvedKeyNumber: text("resolved_key_number"),
  resolvedAccessInfo: jsonb("resolved_access_info").default({}),
  resolvedPreferredTime1: text("resolved_preferred_time_1"),
  resolvedPreferredTime2: text("resolved_preferred_time_2"),
  // Djup i hierarkin (0 = rot, 1 = barn till rot, etc.)
  hierarchyDepth: integer("hierarchy_depth").default(0),
  // Fullständig sökväg i hierarkin (array av object IDs från rot)
  hierarchyPath: text("hierarchy_path").array().default([]),
  
  isInterimObject: boolean("is_interim_object").default(false).notNull(),
  
  status: text("status").default("active").notNull(),
  notes: text("notes"),
  lastServiceDate: timestamp("last_service_date"),
  importBatchId: text("import_batch_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_objects_tenant").on(table.tenantId),
  index("idx_objects_customer").on(table.customerId),
  index("idx_objects_cluster").on(table.clusterId),
  index("idx_objects_parent").on(table.parentId),
  index("idx_objects_object_number").on(table.objectNumber),
  index("idx_objects_tenant_customer").on(table.tenantId, table.customerId),
  index("idx_objects_interim").on(table.tenantId, table.isInterimObject),
]);

export const resources = pgTable("resources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  userId: varchar("user_id").references(() => users.id),
  name: text("name").notNull(),
  initials: text("initials"),
  resourceType: text("resource_type").default("person").notNull(),
  phone: text("phone"),
  email: text("email"),
  // PIN-kod för mobilapp-inloggning (4-6 siffror)
  pin: text("pin"),
  homeLocation: text("home_location"),
  // GPS-koordinater för utgångsplats
  homeLatitude: real("home_latitude"),
  homeLongitude: real("home_longitude"),
  // Realtidsposition - senaste rapporterade position
  currentLatitude: real("current_latitude"),
  currentLongitude: real("current_longitude"),
  lastPositionUpdate: timestamp("last_position_update"),
  // Aktuell status för tracking: idle, traveling, on_site, offline
  trackingStatus: text("tracking_status").default("offline"),
  weeklyHours: integer("weekly_hours").default(40),
  competencies: text("competencies").array().default([]),
  // Utförandekoder som resursen kan utföra (C8)
  executionCodes: text("execution_codes").array().default([]),
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
}, (table) => [
  index("idx_resources_tenant").on(table.tenantId),
]);

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
  // Omöjlig order - när order inte kan utföras
  impossibleReason: text("impossible_reason"),        // locked_gate, no_access, etc.
  impossibleReasonText: text("impossible_reason_text"), // Fritext för detaljer
  impossibleAt: timestamp("impossible_at"),           // När markerad som omöjlig
  impossibleBy: varchar("impossible_by").references(() => resources.id), // Vem markerade
  impossiblePhotoUrl: text("impossible_photo_url"),   // Bild som bevis
  // ============================================
  // UTÖKADE METADATAFÄLT (Fas 1B)
  // ============================================
  // 8-stegs utförandestatus: not_planned, planned_rough, planned_fine, on_way, on_site, completed, inspected, invoiced
  executionStatus: text("execution_status").default("not_planned"),
  // Skapandemetod: manual, import, external_report, performer, automatic
  creationMethod: text("creation_method").default("manual"),
  // Strukturartikel-ID om uppgiften skapades av en strukturartikel
  structuralArticleId: varchar("structural_article_id"),
  // What3Words-position (3x3m precision)
  what3words: text("what3words"),
  // GPS-koordinater för uppgiftsspecifik position (om annan än objektets)
  taskLatitude: real("task_latitude"),
  taskLongitude: real("task_longitude"),
  // Utförandekod: matchar resursens kompetens (t.ex. "kranbil", "tvatt", "sug")
  executionCode: text("execution_code"),
  // Extern referens (kundportals-ID, felanmälans-ID etc.)
  externalReference: text("external_reference"),
  // Tidsstämplar för statusflöde
  onWayAt: timestamp("on_way_at"),
  onSiteAt: timestamp("on_site_at"),
  inspectedAt: timestamp("inspected_at"),
  // Planeringsmetadata
  plannedBy: varchar("planned_by"),
  plannedNotes: text("planned_notes"),
  notes: text("notes"),
  metadata: jsonb("metadata").default({}),
  importBatchId: text("import_batch_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_work_orders_tenant").on(table.tenantId),
  index("idx_work_orders_scheduled_date").on(table.scheduledDate),
  index("idx_work_orders_order_status").on(table.orderStatus),
  index("idx_work_orders_object").on(table.objectId),
  index("idx_work_orders_customer").on(table.customerId),
  index("idx_work_orders_resource").on(table.resourceId),
  index("idx_work_orders_cluster").on(table.clusterId),
  index("idx_work_orders_tenant_status").on(table.tenantId, table.orderStatus),
  index("idx_work_orders_tenant_date").on(table.tenantId, table.scheduledDate),
]);

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
  index("idx_work_order_lines_work_order_id").on(table.workOrderId),
  index("idx_work_order_lines_article").on(table.articleId),
  index("idx_work_order_lines_tenant").on(table.tenantId),
]);

// Länkning av flera objekt till en arbetsorder
export const workOrderObjects = pgTable("work_order_objects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  isPrimary: boolean("is_primary").default(false),
  sortOrder: integer("sort_order").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_work_order_objects_work_order_id").on(table.workOrderId),
  index("idx_work_order_objects_object_id").on(table.objectId),
  unique("unq_work_order_objects_tenant_order_object").on(table.tenantId, table.workOrderId, table.objectId)
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

// Hook-nivåer för artikelfasthakning (Kinab-koncept)
export const ARTICLE_HOOK_LEVELS = [
  "koncern",     // Hakar på koncernnivå
  "brf",         // Hakar på BRF-nivå
  "fastighet",   // Hakar på fastighetsnivå
  "rum",         // Hakar på rumsnivå
  "karl",        // Alla kärl (T100 Kärltvätt)
  "karl_mat",    // Endast matavfallskärl (K100 Matavfallsdekal)
  "karl_rest",   // Endast restavfallskärl
  "karl_plast",  // Endast plastkärl
  "kod"          // Objekt med accesskod (KOD10)
] as const;
export type ArticleHookLevel = typeof ARTICLE_HOOK_LEVELS[number];

export const ARTICLE_HOOK_LEVEL_LABELS: Record<ArticleHookLevel, string> = {
  koncern: "Koncern",
  brf: "BRF",
  fastighet: "Fastighet",
  rum: "Rum",
  karl: "Kärl",
  karl_mat: "Matavfall",
  karl_rest: "Restavfall",
  karl_plast: "Plast",
  kod: "Accesskod"
};

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
  // Hook-nivå för artikelfasthakning: karl, karl_mat, rum, fastighet, kod etc.
  hookLevel: text("hook_level"),
  // Villkor för hook (t.ex. {"container_type": "matavfall"})
  hookConditions: jsonb("hook_conditions").default({}),
  // Produktionstid i minuter
  productionTime: integer("production_time").default(0),
  // Kostnad (intern)
  cost: integer("cost").default(0),
  // Listpris (standard)
  listPrice: integer("list_price").default(0),
  // För varor: lagerplats
  stockLocation: text("stock_location"),
  // GPS för lagerplats
  stockLatitude: real("stock_latitude"),
  stockLongitude: real("stock_longitude"),
  // För beroende: antal minuter före huvuduppgift
  dependencyMinutesBefore: integer("dependency_minutes_before"),
  // Utförandekod som krävs (t.ex. "kranbil", "tvatt", "sug")
  executionCode: text("execution_code"),
  // Metadata-koppling (per Mats spec Funktion 3 & 7)
  fetchMetadataCode: text("fetch_metadata_code"),
  leaveMetadataCode: text("leave_metadata_code"),
  leaveMetadataFormat: text("leave_metadata_format"),
  // Associations-kod för artikelhook mot metadata-typ
  associationCode: text("association_code"),
  // Intern beskrivning för utförare
  internalDescription: text("internal_description"),
  // Länk till arbetsbeskrivning
  infoLink: text("info_link"),
  unit: text("unit").default("st"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_articles_tenant").on(table.tenantId),
]);

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
}, (table) => [
  index("idx_price_list_articles_list_article").on(table.priceListId, table.articleId),
]);

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
  // Periodicitet: vecka, varannan_vecka, manad, kvartal, halvar, ar (legacy)
  periodicity: text("periodicity").default("manad").notNull(),
  // Specifik veckodag (0=söndag, 1=måndag, etc.) - legacy
  preferredWeekday: integer("preferred_weekday"),
  // Specifik dag i månaden (1-31) - legacy
  preferredDayOfMonth: integer("preferred_day_of_month"),
  // Föredragen tid på dagen
  preferredTimeSlot: text("preferred_time_slot"),
  
  // === FLEXIBEL SCHEMALÄGGNING (ny) ===
  // Ersätter periodicity för avancerade behov
  flexibleFrequency: jsonb("flexible_frequency"), // FlexibleFrequency JSON
  // Specifika veckodagar (snabbåtkomst för common case)
  allowedWeekdays: integer("allowed_weekdays").array(), // [1,3,5] = Mån, Ons, Fre
  // Exkluderade veckodagar
  excludedWeekdays: integer("excluded_weekdays").array(), // [0,6] = Ej helger
  // Säsong då abonnemanget är aktivt
  activeSeason: text("active_season"),
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

// Resurs-positionshistorik för breadcrumb trail och realtidsspårning
export const resourcePositions = pgTable("resource_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  // Hastighet i km/h (om tillgänglig)
  speed: real("speed"),
  // Riktning i grader (0-360)
  heading: real("heading"),
  // Precision i meter
  accuracy: real("accuracy"),
  // Status vid denna position: traveling, on_site, idle
  status: text("status").default("traveling"),
  // Koppling till aktuell arbetsorder (om på plats)
  workOrderId: varchar("work_order_id"),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (table) => [
  index("idx_resource_positions_resource").on(table.resourceId),
  index("idx_resource_positions_recorded").on(table.recordedAt),
  index("idx_resource_positions_resource_date").on(table.resourceId, table.recordedAt)
]);

// Kluster - kundbaserad hierarki med dataärvning (inte primärt geografiskt)
// Kunden sitter högst upp i trädstrukturen, data ärvs nedåt
export const clusters = pgTable("clusters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Rotkund som äger hierarkin - obligatorisk koppling
  rootCustomerId: varchar("root_customer_id").references(() => customers.id),
  name: text("name").notNull(),
  description: text("description"),
  // Ansvarigt team för klustret
  primaryTeamId: varchar("primary_team_id"),
  // SLA-nivå för klustret: standard, premium, enterprise
  slaLevel: text("sla_level").default("standard"),
  // Planerad servicefrekvens
  defaultPeriodicity: text("default_periodicity").default("vecka"),
  // Färgkod för visualisering
  color: text("color").default("#3B82F6"),
  
  // === ÄRVNINGSKONFIGURATION ===
  // Vilka fält som ärvs nedåt i hierarkin (fallande ärvning)
  inheritableFields: text("inheritable_fields").array().default([
    "accessCode", "keyNumber", "accessInfo", "preferredTime1", "preferredTime2"
  ]),
  // Standardvärden som ärvs om inget annat anges på objektnivå
  defaultAccessInfo: jsonb("default_access_info").default({}),
  defaultPreferredTime: text("default_preferred_time"),
  
  // === GEOGRAFISK DATA (valfritt - för ruttoptimering) ===
  // Dessa fält används endast vid ruttoptimering, inte vid klusterhantering
  geoData: jsonb("geo_data").default({}), // { centerLat, centerLng, radiusKm, postalCodes }
  // Legacy-fält för bakåtkompatibilitet
  centerLatitude: real("center_latitude"),
  centerLongitude: real("center_longitude"),
  radiusKm: real("radius_km").default(5),
  postalCodes: text("postal_codes").array().default([]),
  
  // === CACHADE VÄRDEN ===
  cachedObjectCount: integer("cached_object_count").default(0),
  cachedActiveOrders: integer("cached_active_orders").default(0),
  cachedMonthlyValue: integer("cached_monthly_value").default(0),
  cachedAvgSetupTime: integer("cached_avg_setup_time").default(0),
  // Antal nivåer i hierarkin (beräknas automatiskt)
  cachedHierarchyDepth: integer("cached_hierarchy_depth").default(0),
  
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
  profileIds: text("profile_ids").array().default([]),
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

// Resurskompetenser - vilka artiklar en utförare kan utföra
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
  rootCustomer: one(customers, { fields: [clusters.rootCustomerId], references: [customers.id] }),
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
  objects: many(workOrderObjects),
}));

export const workOrderLinesRelations = relations(workOrderLines, ({ one }) => ({
  tenant: one(tenants, { fields: [workOrderLines.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [workOrderLines.workOrderId], references: [workOrders.id] }),
  article: one(articles, { fields: [workOrderLines.articleId], references: [articles.id] }),
  priceListUsed: one(priceLists, { fields: [workOrderLines.priceListIdUsed], references: [priceLists.id] }),
}));

export const workOrderObjectsRelations = relations(workOrderObjects, ({ one }) => ({
  tenant: one(tenants, { fields: [workOrderObjects.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [workOrderObjects.workOrderId], references: [workOrders.id] }),
  object: one(objects, { fields: [workOrderObjects.objectId], references: [objects.id] }),
}));

export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true });
export const insertObjectSchema = createInsertSchema(objects).omit({ id: true, createdAt: true });
export const insertResourceSchema = createInsertSchema(resources).omit({ id: true, createdAt: true });
export const insertWorkOrderSchema = createInsertSchema(workOrders).omit({ id: true, createdAt: true });
export const insertWorkOrderLineSchema = createInsertSchema(workOrderLines).omit({ id: true, createdAt: true });
export const insertWorkOrderObjectSchema = createInsertSchema(workOrderObjects).omit({ id: true, createdAt: true });
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
export const insertResourcePositionSchema = createInsertSchema(resourcePositions).omit({ id: true, recordedAt: true });

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
  // Åtkomstinformation från objektet
  objectAccessCode: string | null;
  objectKeyNumber: string | null;
  // Kundnamn för snabb referens
  customerName: string | null;
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
export type WorkOrderObject = typeof workOrderObjects.$inferSelect;
export type InsertWorkOrderObject = z.infer<typeof insertWorkOrderObjectSchema>;
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
export type ResourcePosition = typeof resourcePositions.$inferSelect;
export type InsertResourcePosition = z.infer<typeof insertResourcePositionSchema>;

// Order status constants (med "omojlig" för ordrar som inte kan utföras)
export const ORDER_STATUSES = [
  "skapad",
  "planerad_pre", 
  "planerad_resurs",
  "planerad_las",
  "utford",
  "fakturerad",
  "omojlig"      // Order kunde inte utföras (låst port, fel adress, etc.)
] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

// Standardorsaker för omöjliga ordrar
export const IMPOSSIBLE_REASONS = [
  "locked_gate",      // Låst grind/port
  "no_access",        // Ingen tillgång
  "wrong_address",    // Fel adress
  "obstacle",         // Hinder (bil parkerad, etc.)
  "customer_absent",  // Kund ej hemma (krävs närvaro)
  "weather",          // Väderförhållanden
  "equipment_issue",  // Problem med utrustning
  "other"             // Annat (fritext)
] as const;
export type ImpossibleReason = typeof IMPOSSIBLE_REASONS[number];

export const IMPOSSIBLE_REASON_LABELS: Record<ImpossibleReason, string> = {
  locked_gate: "Låst grind/port",
  no_access: "Ingen tillgång",
  wrong_address: "Fel adress",
  obstacle: "Hinder",
  customer_absent: "Kund ej hemma",
  weather: "Väder",
  equipment_issue: "Utrustning",
  other: "Annat"
};

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
  uniqueIndex("idx_user_tenant_roles_unique").on(table.userId, table.tenantId),
]);

// Invitations - Pre-approved user invitations
export const invitations = pgTable("invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email", { length: 255 }).notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  role: varchar("role", { length: 20 }).default("user").notNull(),
  invitedBy: varchar("invited_by").references(() => users.id),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  usedBy: varchar("used_by").references(() => users.id),
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_invitations_email").on(table.email),
  index("idx_invitations_tenant").on(table.tenantId),
  index("idx_invitations_status").on(table.status),
]);

export const invitationsRelations = relations(invitations, ({ one }) => ({
  tenant: one(tenants, { fields: [invitations.tenantId], references: [tenants.id] }),
  invitedByUser: one(users, { fields: [invitations.invitedBy], references: [users.id] }),
}));

export const insertInvitationSchema = createInsertSchema(invitations).omit({ id: true, createdAt: true });
export type Invitation = typeof invitations.$inferSelect;
export type InsertInvitation = z.infer<typeof insertInvitationSchema>;

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
export const USER_ROLES = ["owner", "admin", "planner", "technician", "user", "viewer", "customer", "reporter"] as const;
export type UserRole = typeof USER_ROLES[number];

// ============================================
// INDUSTRY PACKAGES - Predefined templates for different industries
// ============================================

// Branschtyper
export const INDUSTRY_TYPES = ["waste", "cleaning", "property", "generic"] as const;
export type IndustryType = typeof INDUSTRY_TYPES[number];

// Branschpaket - Fördefinierade paket med artiklar, metadatatyper och strukturartiklar
export const industryPackages = pgTable("industry_packages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  name: text("name").notNull(),
  nameEn: text("name_en"),
  description: text("description"),
  descriptionEn: text("description_en"),
  industry: varchar("industry", { length: 50 }).notNull(), // waste, cleaning, property
  icon: varchar("icon", { length: 50 }).default("Package"), // Lucide icon name
  isActive: boolean("is_active").default(true),
  // Färgförslag för branding
  suggestedPrimaryColor: varchar("suggested_primary_color", { length: 7 }).default("#3B82F6"),
  suggestedSecondaryColor: varchar("suggested_secondary_color", { length: 7 }).default("#6366F1"),
  suggestedAccentColor: varchar("suggested_accent_color", { length: 7 }).default("#F59E0B"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Branschpaketdata - JSON-data för varje pakettyp
export const industryPackageData = pgTable("industry_package_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  packageId: varchar("package_id").references(() => industryPackages.id).notNull(),
  // Typ av data: articles, metadataDefinitions, structuralArticles, objectTypes
  dataType: varchar("data_type", { length: 50 }).notNull(),
  // JSON-array med alla poster av denna typ
  data: jsonb("data").notNull(),
  // Versionhantering
  version: integer("version").default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_package_data_package").on(table.packageId),
  index("idx_package_data_type").on(table.dataType),
]);

// Tenant paketinstallation - Spårar vilka paket som installerats per tenant
export const tenantPackageInstallations = pgTable("tenant_package_installations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  packageId: varchar("package_id").references(() => industryPackages.id).notNull(),
  installedAt: timestamp("installed_at").defaultNow().notNull(),
  installedBy: varchar("installed_by").references(() => users.id),
  // Vilka komponenter som installerades
  articlesInstalled: integer("articles_installed").default(0),
  metadataInstalled: integer("metadata_installed").default(0),
  structuralArticlesInstalled: integer("structural_articles_installed").default(0),
  // Status
  status: varchar("status", { length: 20 }).default("completed"), // pending, completed, failed
  errorMessage: text("error_message"),
}, (table) => [
  index("idx_tenant_package_tenant").on(table.tenantId),
  index("idx_tenant_package_package").on(table.packageId),
]);

// Relations
export const industryPackagesRelations = relations(industryPackages, ({ many }) => ({
  packageData: many(industryPackageData),
  installations: many(tenantPackageInstallations),
}));

export const industryPackageDataRelations = relations(industryPackageData, ({ one }) => ({
  package: one(industryPackages, { fields: [industryPackageData.packageId], references: [industryPackages.id] }),
}));

export const tenantPackageInstallationsRelations = relations(tenantPackageInstallations, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantPackageInstallations.tenantId], references: [tenants.id] }),
  package: one(industryPackages, { fields: [tenantPackageInstallations.packageId], references: [industryPackages.id] }),
  installedByUser: one(users, { fields: [tenantPackageInstallations.installedBy], references: [users.id] }),
}));

// Insert schemas
export const insertIndustryPackageSchema = createInsertSchema(industryPackages).omit({ id: true, createdAt: true });
export const insertIndustryPackageDataSchema = createInsertSchema(industryPackageData).omit({ id: true, createdAt: true });
export const insertTenantPackageInstallationSchema = createInsertSchema(tenantPackageInstallations).omit({ id: true, installedAt: true });

// Types
export type IndustryPackage = typeof industryPackages.$inferSelect;
export type InsertIndustryPackage = z.infer<typeof insertIndustryPackageSchema>;
export type IndustryPackageData = typeof industryPackageData.$inferSelect;
export type InsertIndustryPackageData = z.infer<typeof insertIndustryPackageDataSchema>;
export type TenantPackageInstallation = typeof tenantPackageInstallations.$inferSelect;
export type InsertTenantPackageInstallation = z.infer<typeof insertTenantPackageInstallationSchema>;

// ============================================
// FORTNOX INTEGRATION TABLES
// ============================================

// Fortnox-konfiguration per tenant (OAuth-tokens)
export const fortnoxConfig = pgTable("fortnox_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull().unique(),
  clientId: varchar("client_id"),
  clientSecret: varchar("client_secret"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  isActive: boolean("is_active").default(false),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Mappning Unicorn <-> Fortnox entiteter
export const fortnoxMappings = pgTable("fortnox_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // customer, article, costcenter, project
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  unicornId: varchar("unicorn_id").notNull(),
  fortnoxId: varchar("fortnox_id").notNull(),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_fortnox_mappings_tenant").on(table.tenantId),
  index("idx_fortnox_mappings_entity").on(table.entityType, table.unicornId),
]);

// Fakturaexport-logg
export const fortnoxInvoiceExports = pgTable("fortnox_invoice_exports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id).notNull(),
  fortnoxInvoiceNumber: varchar("fortnox_invoice_number"),
  // pending, exported, failed, cancelled
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  costCenter: varchar("cost_center"),
  project: varchar("project"),
  // Vilken betalare (för multi-payer split)
  payerId: varchar("payer_id"),
  totalAmount: integer("total_amount"),
  errorMessage: text("error_message"),
  exportedAt: timestamp("exported_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_fortnox_exports_tenant").on(table.tenantId),
  index("idx_fortnox_exports_work_order").on(table.workOrderId),
  index("idx_fortnox_exports_status").on(table.status),
]);

// ============================================
// MULTIPLA BETALARE PER OBJEKT
// ============================================

// Betalare kopplade till objekt
export const objectPayers = pgTable("object_payers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  // Typ av betalare: primary, secondary, split
  payerType: varchar("payer_type", { length: 20 }).default("primary").notNull(),
  // Andel i procent (för split-betalning)
  sharePercent: integer("share_percent").default(100),
  // Vilka artikeltyper denna betalare ansvarar för (tom = alla)
  articleTypes: text("article_types").array().default([]),
  // Prioritet vid konflikt (högre = prioriteras)
  priority: integer("priority").default(1),
  // Giltighet
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  // Fakturareferens specifik för denna betalare
  invoiceReference: text("invoice_reference"),
  // Fortnox-koppling
  fortnoxCustomerId: varchar("fortnox_customer_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_object_payers_object").on(table.objectId),
  index("idx_object_payers_customer").on(table.customerId),
]);

// ============================================
// MANUELLA ARTIKELKOPPLINGAR PER OBJEKT
// ============================================

export const objectArticles = pgTable("object_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id).notNull(),
  overridePrice: integer("override_price"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_object_articles_object").on(table.objectId),
  index("idx_object_articles_article").on(table.articleId),
  index("idx_object_articles_tenant").on(table.tenantId),
]);

export const objectArticlesRelations = relations(objectArticles, ({ one }) => ({
  tenant: one(tenants, { fields: [objectArticles.tenantId], references: [tenants.id] }),
  object: one(objects, { fields: [objectArticles.objectId], references: [objects.id] }),
  article: one(articles, { fields: [objectArticles.articleId], references: [articles.id] }),
}));

export const insertObjectArticleSchema = createInsertSchema(objectArticles).omit({ id: true, createdAt: true });
export type InsertObjectArticle = z.infer<typeof insertObjectArticleSchema>;
export type ObjectArticle = typeof objectArticles.$inferSelect;

// ============================================
// FLERFÖRÄLDRA-RELATIONER (MULTI-PARENT)
// ============================================

export const OBJECT_RELATION_CONTEXTS = [
  "primary",     // Primär organisatorisk tillhörighet
  "billing",     // Faktureringsrelation
  "operational", // Driftsrelation
  "ownership",   // Ägarrelation
] as const;
export type ObjectRelationContext = typeof OBJECT_RELATION_CONTEXTS[number];

export const objectParents = pgTable("object_parents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  parentId: varchar("parent_id").references(() => objects.id).notNull(),
  isPrimary: boolean("is_primary").default(false).notNull(),
  relationContext: text("relation_context").default("primary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_object_parents_object").on(table.objectId),
  index("idx_object_parents_parent").on(table.parentId),
  index("idx_object_parents_tenant").on(table.tenantId),
]);

export const objectParentsRelations = relations(objectParents, ({ one }) => ({
  tenant: one(tenants, { fields: [objectParents.tenantId], references: [tenants.id] }),
  object: one(objects, { fields: [objectParents.objectId], references: [objects.id] }),
  parent: one(objects, { fields: [objectParents.parentId], references: [objects.id] }),
}));

// ============================================
// METADATA PROPAGATION SYSTEM
// ============================================

// Propagationstyper för metadata
export const METADATA_PROPAGATION_TYPES = [
  "fixed",    // Fast - stannar på nivån där den skapas
  "falling",  // Fallande - ärvs automatiskt nedåt
  "dynamic"   // Dynamisk - ändras över tid och fortsätter falla
] as const;
export type MetadataPropagationType = typeof METADATA_PROPAGATION_TYPES[number];

// Metadatadefinitioner (vilka fält som kan propagera)
export const metadataDefinitions = pgTable("metadata_definitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Unikt namn för metadata-fältet
  fieldKey: varchar("field_key", { length: 100 }).notNull(),
  fieldLabel: text("field_label").notNull(),
  // Datatyp: text, number, date, boolean, json
  dataType: varchar("data_type", { length: 20 }).default("text"),
  // Propagationstyp: fixed, falling, dynamic
  propagationType: varchar("propagation_type", { length: 20 }).default("falling"),
  // Vilka objektnivåer fältet kan appliceras på
  applicableLevels: text("applicable_levels").array().default([]),
  // Standardvärde
  defaultValue: text("default_value"),
  // Valideringsregler (JSON schema)
  validationRules: jsonb("validation_rules").default({}),
  isRequired: boolean("is_required").default(false),
  // Sorteringsordning i UI
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_metadata_definitions_tenant").on(table.tenantId),
  index("idx_metadata_definitions_field").on(table.fieldKey),
]);

// Metadatavärden på objekt
export const objectMetadata = pgTable("object_metadata", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  definitionId: varchar("definition_id").references(() => metadataDefinitions.id).notNull(),
  // Värdet (text för enkla värden)
  value: text("value"),
  // JSON-värde för komplexa strukturer
  valueJson: jsonb("value_json"),
  // Brytlogik: stoppar arv nedåt för detta fält
  breaksInheritance: boolean("breaks_inheritance").default(false),
  // Om ärvt: varifrån kommer värdet?
  inheritedFromObjectId: varchar("inherited_from_object_id"),
  // Giltighet för dynamiska värden
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  // Spårning
  updatedBy: varchar("updated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_object_metadata_object").on(table.objectId),
  index("idx_object_metadata_definition").on(table.definitionId),
]);

// ============================================
// OBJEKTBILDER - Bildgalleri per objekt
// ============================================

export const objectImages = pgTable("object_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  imageUrl: text("image_url").notNull(),
  imageDate: timestamp("image_date").defaultNow().notNull(),
  description: text("description"),
  // Typ: photo, document, drawing, manual
  imageType: varchar("image_type", { length: 50 }).default("photo"),
  uploadedBy: varchar("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_object_images_object").on(table.objectId),
  index("idx_object_images_date").on(table.imageDate),
]);

// ============================================
// OBJEKTKONTAKTER - Kontakter kopplade till objekt med arv
// ============================================

export const objectContacts = pgTable("object_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  // Kontaktperson
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  role: text("role"), // Vaktmästare, Styrelseordförande, etc.
  // Kontakttyp: primary, secondary, billing, technical, emergency
  contactType: varchar("contact_type", { length: 50 }).default("primary"),
  // Ärvd från annat objekt (null om egen)
  inheritedFromObjectId: varchar("inherited_from_object_id").references(() => objects.id),
  // Om true: ärvs till barnobjekt
  isInheritable: boolean("is_inheritable").default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_object_contacts_object").on(table.objectId),
  index("idx_object_contacts_type").on(table.contactType),
]);

// ============================================
// UPPGIFT/ORDER TIDSFÖNSTER - Flera önskade leveranstider
// ============================================

export const taskDesiredTimewindows = pgTable("task_desired_timewindows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id).notNull(),
  // Veckonummer
  weekNumber: integer("week_number"),
  // Veckodag: monday, tuesday, wednesday, thursday, friday, saturday, sunday
  dayOfWeek: varchar("day_of_week", { length: 20 }),
  // Starttid (format: HH:MM)
  startTime: text("start_time"),
  // Sluttid (format: HH:MM)
  endTime: text("end_time"),
  // Prioritet (1 = högst)
  priority: integer("priority").default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_task_timewindows_work_order").on(table.workOrderId),
  index("idx_task_timewindows_week").on(table.weekNumber),
]);

// ============================================
// UPPGIFTSBEROENDEN - Beroendelogik mellan uppgifter
// ============================================

export const TASK_DEPENDENCY_TYPES = [
  "sequential",   // Sekventiell - måste utföras i ordning
  "structural",   // Strukturartikel - del av större struktur
  "automatic"     // Automatisk - systemgenererad
] as const;
export type TaskDependencyType = typeof TASK_DEPENDENCY_TYPES[number];

export const taskDependencies = pgTable("task_dependencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Uppgiften som är beroende
  workOrderId: varchar("work_order_id").references(() => workOrders.id).notNull(),
  // Uppgiften som måste slutföras först
  dependsOnWorkOrderId: varchar("depends_on_work_order_id").references(() => workOrders.id).notNull(),
  // Typ av beroende: sequential, structural, automatic
  dependencyType: varchar("dependency_type", { length: 50 }).default("sequential"),
  // Om strukturartikel: vilken artikel?
  structuralArticleId: varchar("structural_article_id").references(() => articles.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_task_dependencies_work_order").on(table.workOrderId),
  index("idx_task_dependencies_depends_on").on(table.dependsOnWorkOrderId),
]);

// ============================================
// UPPGIFTSINFORMATION - Bilagor och information
// ============================================

export const TASK_INFO_TYPES = [
  "text",         // Fritext
  "image",        // Bild/foto
  "file",         // Dokument
  "article_link"  // Koppling till artikel (med logik)
] as const;
export type TaskInfoType = typeof TASK_INFO_TYPES[number];

export const taskInformation = pgTable("task_information", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id).notNull(),
  // Typ: text, image, file, article_link
  infoType: varchar("info_type", { length: 50 }).default("text").notNull(),
  // Värde (text, URL, etc.)
  infoValue: text("info_value"),
  // Har logik (för artikel-kopplingar)
  hasLogic: boolean("has_logic").default(false),
  // Kopplad artikel (för article_link typ)
  linkedArticleId: varchar("linked_article_id").references(() => articles.id),
  // Mängd (för artikel-kopplingar)
  quantity: integer("quantity"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_task_info_work_order").on(table.workOrderId),
  index("idx_task_info_type").on(table.infoType),
]);

// ============================================
// TIDSBEGRÄNSNINGAR PÅ OBJEKT (C9)
// ============================================

export const RESTRICTION_TYPES = [
  "parking_ban",      // Parkeringsförbud
  "emptying_day",     // Tömningsdag (bara dessa dagar)
  "quiet_hours",      // Tysta timmar
  "access_restriction", // Åtkomstbegränsning
  "other"             // Annan begränsning
] as const;
export type RestrictionType = typeof RESTRICTION_TYPES[number];

export const RESTRICTION_TYPE_LABELS: Record<string, string> = {
  parking_ban: "Parkeringsförbud",
  emptying_day: "Tömningsdag",
  quiet_hours: "Tysta timmar",
  access_restriction: "Åtkomstbegränsning",
  other: "Annan",
};

export const objectTimeRestrictions = pgTable("object_time_restrictions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  restrictionType: text("restriction_type").notNull(),
  description: text("description"),
  weekdays: integer("weekdays").array().default([]),
  startTime: text("start_time"),
  endTime: text("end_time"),
  isBlockingAllDay: boolean("is_blocking_all_day").default(false),
  validFromDate: timestamp("valid_from_date"),
  validToDate: timestamp("valid_to_date"),
  recurrenceInterval: integer("recurrence_interval"),
  recurrenceUnit: text("recurrence_unit"),
  preference: text("preference").default("unfavorable").notNull(),
  reason: text("reason"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_obj_time_restrictions_object").on(table.objectId),
  index("idx_obj_time_restrictions_tenant").on(table.tenantId),
]);

// ============================================
// STRUKTURARTIKLAR - Artiklar som skapar beroendeuppgifter
// ============================================

export const structuralArticles = pgTable("structural_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Huvudartikeln (strukturartikeln)
  parentArticleId: varchar("parent_article_id").references(() => articles.id).notNull(),
  // Delartikeln
  childArticleId: varchar("child_article_id").references(() => articles.id).notNull(),
  // Ordningsföljd (1 = först)
  sequenceOrder: integer("sequence_order").default(1).notNull(),
  // Namn på steget (t.ex. "Föravisering", "Hämtning")
  stepName: text("step_name"),
  // Typ av uppgift för detta steg
  taskType: text("task_type"),
  
  // === DYNAMISKA VÄRDEN (Fas 1.2) ===
  // Standardkvantitet för denna delåtgärd
  defaultQuantity: integer("default_quantity").default(1),
  // Standardtid i minuter för denna delåtgärd
  defaultDurationMinutes: integer("default_duration_minutes"),
  // Om true: kvantitet kan sättas till 0 (t.ex. snöröjning på sommaren)
  allowZeroQuantity: boolean("allow_zero_quantity").default(false),
  // Säsong då denna delåtgärd är relevant (null = hela året)
  applicableSeason: text("applicable_season"), // Season type
  // Om true: multiplicera med antalet objekt (containerCount, etc.)
  multiplyByObjectCount: boolean("multiply_by_object_count").default(false),
  // Metadatafält att multiplicera med (t.ex. "containerCount")
  multiplyByMetadataField: text("multiply_by_metadata_field"),
  // Om true: kräver individuell hantering (ett jobb per objekt med serienummer)
  requiresIndividualHandling: boolean("requires_individual_handling").default(false),
  // Om true: är valfri åtgärd (kan hoppas över)
  isOptional: boolean("is_optional").default(false),
  // Villkor för när åtgärden ska utföras (JSON-logik)
  conditionalLogic: jsonb("conditional_logic"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_structural_articles_parent").on(table.parentArticleId),
  index("idx_structural_articles_sequence").on(table.parentArticleId, table.sequenceOrder),
]);

// ============================================
// ORDERKONCEPT - Intelligenta arbetsordergeneratorer
// ============================================

export const DEPENDENCY_TYPES = [
  "before",     // Måste göras innan huvuduppgift
  "after",      // Måste göras efter huvuduppgift
  "parallel"    // Kan göras samtidigt
] as const;
export type DependencyType = typeof DEPENDENCY_TYPES[number];

export const orderConcepts = pgTable("order_concepts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  // Kluster som konceptet pekas in på (söker nedåt i hierarkin)
  targetClusterId: varchar("target_cluster_id").references(() => clusters.id),
  // Huvudartikel som ska utföras
  articleId: varchar("article_id").references(() => articles.id),
  // Korsbefruktning: multiplicera med metadata-värde (t.ex. "containerCount")
  crossPollinationField: text("cross_pollination_field"),
  // Aggregera uppgifter per nivå (t.ex. "fastighet" = en uppgift per fastighet)
  aggregationLevel: text("aggregation_level"),
  // Scenario: avrop (on-demand), schema (scheduled), abonnemang (subscription)
  scenario: text("scenario").default("avrop").notNull(),
  // Schematyp: once, recurring, subscription (legacy compat)
  scheduleType: text("schedule_type").default("once").notNull(),
  // För recurring: intervall i dagar (legacy)
  intervalDays: integer("interval_days"),
  
  // === LEVERANSSCHEMA (Delivery Schedule) ===
  deliverySchedule: jsonb("delivery_schedule"), // Array of { month, weekNumber, weekday, timeWindowStart, timeWindowEnd }
  rollingMonths: integer("rolling_months").default(3), // Antal månader att generera framåt
  minDaysBetween: integer("min_days_between"), // Minsta antal dagar mellan besök
  
  // === ABONNEMANG (Subscription) ===
  washesPerYear: integer("washes_per_year"),
  pricePerUnit: real("price_per_unit"),
  monthlyFee: real("monthly_fee"), // Fast månadsavgift per enhet
  billingFrequency: text("billing_frequency").default("monthly"), // monthly, quarterly, yearly
  contractLockMonths: integer("contract_lock_months"), // Bindningstid i månader
  contractLock: boolean("contract_lock").default(false),
  subscriptionMetadataField: text("subscription_metadata_field"), // Metadata-nyckel för antal (t.ex. "antal_karl")
  
  // === FLEXIBEL SCHEMALÄGGNING (ny) ===
  flexibleFrequency: jsonb("flexible_frequency"),
  allowedWeekdays: integer("allowed_weekdays").array(),
  excludedWeekdays: integer("excluded_weekdays").array(),
  activeSeason: text("active_season"),
  timesPerPeriod: integer("times_per_period"),
  periodType: text("period_type"),
  
  // Nästa planerade körning
  nextRunDate: timestamp("next_run_date"),
  // Senaste körning
  lastRunDate: timestamp("last_run_date"),
  // Prioritet vid generering
  priority: text("priority").default("normal"),
  status: text("status").default("active").notNull(),

  // === WIZARD 9-STEG (Orderkoncept-Process) ===
  currentStep: integer("current_step").default(1),
  customerMode: text("customer_mode").default("HARDCODED").notNull(),
  customerId: varchar("customer_id"),
  invoiceLevel: text("invoice_level"),
  invoiceModel: text("invoice_model"),
  invoicePeriod: text("invoice_period"),
  invoiceLock: boolean("invoice_lock").default(false),
  deliveryModel: text("delivery_model"),
  deliveryStart: timestamp("delivery_start"),
  deliveryEnd: timestamp("delivery_end"),
  monthlyFeeCalc: real("monthly_fee_calc"),
  contractLengthMonths: integer("contract_length_months"),
  totalObjects: integer("total_objects").default(0),
  totalArticles: integer("total_articles").default(0),
  totalCost: real("total_cost").default(0),
  totalValue: real("total_value").default(0),
  estimatedHours: real("estimated_hours").default(0),
  orderMetadata: jsonb("order_metadata"),

  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_order_concepts_tenant").on(table.tenantId),
  index("idx_order_concepts_cluster").on(table.targetClusterId),
  index("idx_order_concepts_customer").on(table.customerId),
  index("idx_order_concepts_status").on(table.status),
]);

export const insertOrderConceptSchema = createInsertSchema(orderConcepts).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});

// Filter för orderkoncept - matchar metadata på objekt
export const FILTER_OPERATORS = [
  "equals",       // Exakt matchning
  "not_equals",   // Ej lika med
  "contains",     // Innehåller (text)
  "starts_with",  // Börjar med
  "greater_than", // Större än (numeriskt)
  "less_than",    // Mindre än (numeriskt)
  "in_list",      // Ingår i lista
  "exists",       // Fältet finns
  "not_exists"    // Fältet finns inte
] as const;
export type FilterOperator = typeof FILTER_OPERATORS[number];

export const conceptFilters = pgTable("concept_filters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderConceptId: varchar("order_concept_id").references(() => orderConcepts.id).notNull(),
  // Hierarkinivå som filtret gäller för (koncern, brf, fastighet, rum, karl)
  targetLevel: text("target_level"),
  // Metadata-nyckel att matcha (t.ex. "objectType", "containerType")
  metadataKey: text("metadata_key").notNull(),
  // Operator för matchning
  operator: text("operator").default("equals").notNull(),
  // Värde att matcha mot (JSON för flexibilitet)
  filterValue: jsonb("filter_value").notNull(),
  // Prioritet (högre = viktigare)
  priority: integer("priority").default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_concept_filters_concept").on(table.orderConceptId),
]);

export const insertConceptFilterSchema = createInsertSchema(conceptFilters).omit({
  id: true,
  createdAt: true,
});

// ============================================
// ASSIGNMENTS - Genererade uppgifter från orderkoncept
// ============================================

export const ASSIGNMENT_STATUSES = [
  "not_planned",      // Ej planerad
  "planned_rough",    // Grovplanerad (tilldelad vecka/team)
  "planned_fine",     // Finplanerad (tilldelad resurs)
  "on_way",           // På väg
  "on_site",          // På plats
  "completed",        // Utförd
  "inspected",        // Kontrollerad
  "invoiced"          // Fakturerad
] as const;
export type AssignmentStatus = typeof ASSIGNMENT_STATUSES[number];

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  not_planned: "Ej planerad",
  planned_rough: "Grovplanerad",
  planned_fine: "Finplanerad",
  on_way: "På väg",
  on_site: "På plats",
  completed: "Utförd",
  inspected: "Kontrollerad",
  invoiced: "Fakturerad"
};

export const assignments = pgTable("assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Orderkoncept som genererade uppgiften
  orderConceptId: varchar("order_concept_id").references(() => orderConcepts.id),
  // Objekt som uppgiften gäller
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  // Kluster för enkel filtrering
  clusterId: varchar("cluster_id").references(() => clusters.id),
  // Tilldelad resurs
  resourceId: varchar("resource_id").references(() => resources.id),
  // Team för förplanering
  teamId: varchar("team_id").references(() => teams.id),
  // Rubrik
  title: text("title").notNull(),
  description: text("description"),
  // Status (8-stegs workflow)
  status: text("status").default("not_planned").notNull(),
  // Prioritet
  priority: text("priority").default("normal").notNull(),
  // Planerad tidpunkt
  scheduledDate: timestamp("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  scheduledEndTime: text("scheduled_end_time"),
  // Tidsfönster
  plannedWindowStart: timestamp("planned_window_start"),
  plannedWindowEnd: timestamp("planned_window_end"),
  // Tidsuppskattning (minuter)
  estimatedDuration: integer("estimated_duration").default(60),
  actualDuration: integer("actual_duration"),
  // Etableringstid
  setupTime: integer("setup_time"),
  // Adress (kan vara ärvd eller manuell)
  address: text("address"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  what3words: text("what3words"),
  // Korsbefruktning: antal (t.ex. antal kärl)
  quantity: integer("quantity").default(1),
  // Beräknade värden
  cachedValue: integer("cached_value").default(0),
  cachedCost: integer("cached_cost").default(0),
  // Foton
  photoBeforeId: varchar("photo_before_id"),
  photoAfterId: varchar("photo_after_id"),
  photoBeforeRequired: boolean("photo_before_required").default(true),
  photoAfterRequired: boolean("photo_after_required").default(true),
  // Tidsstämplar
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  invoicedAt: timestamp("invoiced_at"),
  // Skapandemetod
  creationMethod: text("creation_method").default("automatic"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_assignments_tenant").on(table.tenantId),
  index("idx_assignments_object").on(table.objectId),
  index("idx_assignments_cluster").on(table.clusterId),
  index("idx_assignments_resource").on(table.resourceId),
  index("idx_assignments_status").on(table.status),
  index("idx_assignments_scheduled").on(table.scheduledDate),
]);

export const insertAssignmentSchema = createInsertSchema(assignments).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});

// Artiklar kopplade till en assignment
export const assignmentArticles = pgTable("assignment_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assignmentId: varchar("assignment_id").references(() => assignments.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id).notNull(),
  // Antal (t.ex. 10 kärl)
  quantity: integer("quantity").default(1).notNull(),
  // Pris per enhet
  unitPrice: integer("unit_price").default(0),
  // Totalt belopp
  totalPrice: integer("total_price").default(0),
  // Kostnad per enhet
  unitCost: integer("unit_cost").default(0),
  // Total kostnad
  totalCost: integer("total_cost").default(0),
  // Produktionstid per enhet (minuter)
  unitTime: integer("unit_time").default(0),
  // Total produktionstid
  totalTime: integer("total_time").default(0),
  // Beroendetyp (för strukturartiklar)
  dependencyType: text("dependency_type"),
  // Ordningsföljd
  sequenceOrder: integer("sequence_order").default(1),
  // Status för denna delartikel
  status: text("status").default("pending"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_assignment_articles_assignment").on(table.assignmentId),
  index("idx_assignment_articles_article").on(table.articleId),
]);

export const insertAssignmentArticleSchema = createInsertSchema(assignmentArticles).omit({
  id: true,
  createdAt: true,
});

// ============================================
// SUBSCRIPTION CHANGES - Ändringsdetektering för abonnemang
// ============================================

export const subscriptionChanges = pgTable("subscription_changes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  orderConceptId: varchar("order_concept_id").references(() => orderConcepts.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  changeType: text("change_type").notNull(), // 'quantity_change', 'new_object', 'removed_object', 'price_change'
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  monthlyDelta: real("monthly_delta"), // Ändring i månadsavgift (+ eller -)
  approvalStatus: text("approval_status").default("pending").notNull(), // pending, approved, rejected
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_subscription_changes_tenant").on(table.tenantId),
  index("idx_subscription_changes_concept").on(table.orderConceptId),
  index("idx_subscription_changes_status").on(table.approvalStatus),
]);

export const insertSubscriptionChangeSchema = createInsertSchema(subscriptionChanges).omit({
  id: true,
  createdAt: true,
  detectedAt: true,
});

// ============================================
// TASK DEPENDENCY TEMPLATES - Mallar på artikelnivå
// ============================================

export const taskDependencyTemplates = pgTable("task_dependency_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id).notNull(),
  dependentArticleId: varchar("dependent_article_id").references(() => articles.id).notNull(),
  dependencyType: text("dependency_type").notNull(), // 'before' or 'after'
  timeOffsetHours: integer("time_offset_hours").default(0).notNull(), // Negativ = innan, Positiv = efter
  isMandatory: boolean("is_mandatory").default(true).notNull(),
  orderIndex: integer("order_index").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_task_dep_templates_tenant").on(table.tenantId),
  index("idx_task_dep_templates_article").on(table.articleId),
]);

export const insertTaskDependencyTemplateSchema = createInsertSchema(taskDependencyTemplates).omit({
  id: true,
  createdAt: true,
});
export type InsertTaskDependencyTemplate = z.infer<typeof insertTaskDependencyTemplateSchema>;
export type TaskDependencyTemplate = typeof taskDependencyTemplates.$inferSelect;

// ============================================
// TASK DEPENDENCY INSTANCES - Genererade beroendeinstanser
// ============================================

export const taskDependencyInstances = pgTable("task_dependency_instances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  parentWorkOrderId: varchar("parent_work_order_id").references(() => workOrders.id).notNull(),
  childWorkOrderId: varchar("child_work_order_id").references(() => workOrders.id).notNull(),
  dependencyType: text("dependency_type").notNull(), // 'before' or 'after'
  scheduledAt: timestamp("scheduled_at"),
  completed: boolean("completed").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_task_dep_instances_parent").on(table.parentWorkOrderId),
  index("idx_task_dep_instances_child").on(table.childWorkOrderId),
]);

export const insertTaskDependencyInstanceSchema = createInsertSchema(taskDependencyInstances).omit({
  id: true,
  createdAt: true,
});
export type InsertTaskDependencyInstance = z.infer<typeof insertTaskDependencyInstanceSchema>;
export type TaskDependencyInstance = typeof taskDependencyInstances.$inferSelect;

// ============================================
// INVOICE RULES - Faktureringsregler per kund/koncept
// ============================================

export const INVOICE_TYPES = ["per_task", "per_room", "per_area", "monthly"] as const;
export type InvoiceType = typeof INVOICE_TYPES[number];

export const invoiceRules = pgTable("invoice_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  orderConceptId: varchar("order_concept_id").references(() => orderConcepts.id),
  customerId: varchar("customer_id"),
  invoiceType: text("invoice_type").default("per_task").notNull(), // per_task, per_room, per_area, monthly
  metadataOnHeader: jsonb("metadata_on_header"), // ["avdelningsnummer", "kostnadsställe", "referens"]
  metadataOnLine: jsonb("metadata_on_line"), // ["fasadnummer", "klistermärke_status"]
  waitForAll: boolean("wait_for_all").default(false),
  contractLock: boolean("contract_lock").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_invoice_rules_tenant").on(table.tenantId),
  index("idx_invoice_rules_concept").on(table.orderConceptId),
]);

export const insertInvoiceRuleSchema = createInsertSchema(invoiceRules).omit({
  id: true,
  createdAt: true,
});
export type InsertInvoiceRule = z.infer<typeof insertInvoiceRuleSchema>;
export type InvoiceRule = typeof invoiceRules.$inferSelect;

// ============================================
// ORDERKONCEPT RUN LOG - Omkörningslogg
// ============================================

export const orderConceptRunLogs = pgTable("order_concept_run_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  orderConceptId: varchar("order_concept_id").references(() => orderConcepts.id).notNull(),
  runType: text("run_type").notNull(), // 'manual', 'rolling', 'rerun'
  status: text("status").default("completed").notNull(), // 'completed', 'failed', 'partial'
  tasksCreated: integer("tasks_created").default(0),
  tasksSkipped: integer("tasks_skipped").default(0),
  changesDetected: integer("changes_detected").default(0),
  details: jsonb("details"), // JSON with detailed changes
  runBy: varchar("run_by").references(() => users.id),
  runAt: timestamp("run_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_run_logs_tenant").on(table.tenantId),
  index("idx_run_logs_concept").on(table.orderConceptId),
]);

export const insertOrderConceptRunLogSchema = createInsertSchema(orderConceptRunLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertOrderConceptRunLog = z.infer<typeof insertOrderConceptRunLogSchema>;
export type OrderConceptRunLog = typeof orderConceptRunLogs.$inferSelect;

// ============================================
// RELATIONS FOR NEW TABLES
// ============================================

export const orderConceptsRelations = relations(orderConcepts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [orderConcepts.tenantId], references: [tenants.id] }),
  targetCluster: one(clusters, { fields: [orderConcepts.targetClusterId], references: [clusters.id] }),
  article: one(articles, { fields: [orderConcepts.articleId], references: [articles.id] }),
  createdByUser: one(users, { fields: [orderConcepts.createdBy], references: [users.id] }),
  filters: many(conceptFilters),
  assignments: many(assignments),
}));

export const conceptFiltersRelations = relations(conceptFilters, ({ one }) => ({
  orderConcept: one(orderConcepts, { fields: [conceptFilters.orderConceptId], references: [orderConcepts.id] }),
}));

export const assignmentsRelations = relations(assignments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [assignments.tenantId], references: [tenants.id] }),
  orderConcept: one(orderConcepts, { fields: [assignments.orderConceptId], references: [orderConcepts.id] }),
  object: one(objects, { fields: [assignments.objectId], references: [objects.id] }),
  cluster: one(clusters, { fields: [assignments.clusterId], references: [clusters.id] }),
  resource: one(resources, { fields: [assignments.resourceId], references: [resources.id] }),
  team: one(teams, { fields: [assignments.teamId], references: [teams.id] }),
  createdByUser: one(users, { fields: [assignments.createdBy], references: [users.id] }),
  articles: many(assignmentArticles),
}));

export const assignmentArticlesRelations = relations(assignmentArticles, ({ one }) => ({
  assignment: one(assignments, { fields: [assignmentArticles.assignmentId], references: [assignments.id] }),
  article: one(articles, { fields: [assignmentArticles.articleId], references: [articles.id] }),
}));

export const objectImagesRelations = relations(objectImages, ({ one }) => ({
  tenant: one(tenants, { fields: [objectImages.tenantId], references: [tenants.id] }),
  object: one(objects, { fields: [objectImages.objectId], references: [objects.id] }),
  uploadedByUser: one(users, { fields: [objectImages.uploadedBy], references: [users.id] }),
}));

export const objectContactsRelations = relations(objectContacts, ({ one }) => ({
  tenant: one(tenants, { fields: [objectContacts.tenantId], references: [tenants.id] }),
  object: one(objects, { fields: [objectContacts.objectId], references: [objects.id] }),
  inheritedFromObject: one(objects, { fields: [objectContacts.inheritedFromObjectId], references: [objects.id] }),
}));

export const taskDesiredTimewindowsRelations = relations(taskDesiredTimewindows, ({ one }) => ({
  tenant: one(tenants, { fields: [taskDesiredTimewindows.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [taskDesiredTimewindows.workOrderId], references: [workOrders.id] }),
}));

export const taskDependenciesRelations = relations(taskDependencies, ({ one }) => ({
  tenant: one(tenants, { fields: [taskDependencies.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [taskDependencies.workOrderId], references: [workOrders.id] }),
  dependsOnWorkOrder: one(workOrders, { fields: [taskDependencies.dependsOnWorkOrderId], references: [workOrders.id] }),
  structuralArticle: one(articles, { fields: [taskDependencies.structuralArticleId], references: [articles.id] }),
}));

export const taskInformationRelations = relations(taskInformation, ({ one }) => ({
  tenant: one(tenants, { fields: [taskInformation.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [taskInformation.workOrderId], references: [workOrders.id] }),
  linkedArticle: one(articles, { fields: [taskInformation.linkedArticleId], references: [articles.id] }),
  createdByUser: one(users, { fields: [taskInformation.createdBy], references: [users.id] }),
}));

export const objectTimeRestrictionsRelations = relations(objectTimeRestrictions, ({ one }) => ({
  tenant: one(tenants, { fields: [objectTimeRestrictions.tenantId], references: [tenants.id] }),
  object: one(objects, { fields: [objectTimeRestrictions.objectId], references: [objects.id] }),
}));

export const structuralArticlesRelations = relations(structuralArticles, ({ one }) => ({
  tenant: one(tenants, { fields: [structuralArticles.tenantId], references: [tenants.id] }),
  parentArticle: one(articles, { fields: [structuralArticles.parentArticleId], references: [articles.id] }),
  childArticle: one(articles, { fields: [structuralArticles.childArticleId], references: [articles.id] }),
}));

export const fortnoxConfigRelations = relations(fortnoxConfig, ({ one }) => ({
  tenant: one(tenants, { fields: [fortnoxConfig.tenantId], references: [tenants.id] }),
}));

export const fortnoxMappingsRelations = relations(fortnoxMappings, ({ one }) => ({
  tenant: one(tenants, { fields: [fortnoxMappings.tenantId], references: [tenants.id] }),
}));

export const fortnoxInvoiceExportsRelations = relations(fortnoxInvoiceExports, ({ one }) => ({
  tenant: one(tenants, { fields: [fortnoxInvoiceExports.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [fortnoxInvoiceExports.workOrderId], references: [workOrders.id] }),
}));

export const objectPayersRelations = relations(objectPayers, ({ one }) => ({
  tenant: one(tenants, { fields: [objectPayers.tenantId], references: [tenants.id] }),
  object: one(objects, { fields: [objectPayers.objectId], references: [objects.id] }),
  customer: one(customers, { fields: [objectPayers.customerId], references: [customers.id] }),
}));

export const metadataDefinitionsRelations = relations(metadataDefinitions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [metadataDefinitions.tenantId], references: [tenants.id] }),
  objectMetadata: many(objectMetadata),
}));

export const objectMetadataRelations = relations(objectMetadata, ({ one }) => ({
  tenant: one(tenants, { fields: [objectMetadata.tenantId], references: [tenants.id] }),
  object: one(objects, { fields: [objectMetadata.objectId], references: [objects.id] }),
  definition: one(metadataDefinitions, { fields: [objectMetadata.definitionId], references: [metadataDefinitions.id] }),
}));

// ============================================
// INSERT SCHEMAS FOR NEW TABLES
// ============================================

export const insertFortnoxConfigSchema = createInsertSchema(fortnoxConfig).omit({ id: true, createdAt: true });
export const insertFortnoxMappingSchema = createInsertSchema(fortnoxMappings).omit({ id: true, createdAt: true });
export const insertFortnoxInvoiceExportSchema = createInsertSchema(fortnoxInvoiceExports).omit({ id: true, createdAt: true });
export const insertObjectPayerSchema = createInsertSchema(objectPayers).omit({ id: true, createdAt: true });
export const insertMetadataDefinitionSchema = createInsertSchema(metadataDefinitions).omit({ id: true, createdAt: true });
export const insertObjectMetadataSchema = createInsertSchema(objectMetadata).omit({ id: true, createdAt: true });
export const insertObjectImageSchema = createInsertSchema(objectImages).omit({ id: true, createdAt: true });
export const insertObjectContactSchema = createInsertSchema(objectContacts).omit({ id: true, createdAt: true });
export const insertTaskDesiredTimewindowSchema = createInsertSchema(taskDesiredTimewindows).omit({ id: true, createdAt: true });
export const insertTaskDependencySchema = createInsertSchema(taskDependencies).omit({ id: true, createdAt: true });
export const insertTaskInformationSchema = createInsertSchema(taskInformation).omit({ id: true, createdAt: true });
export const insertObjectParentSchema = createInsertSchema(objectParents).omit({ id: true, createdAt: true });
export const insertObjectTimeRestrictionSchema = createInsertSchema(objectTimeRestrictions).omit({ id: true, createdAt: true });
export const insertStructuralArticleSchema = createInsertSchema(structuralArticles).omit({ id: true, createdAt: true });

// ============================================
// TYPES FOR NEW TABLES
// ============================================

export type FortnoxConfig = typeof fortnoxConfig.$inferSelect;
export type InsertFortnoxConfig = z.infer<typeof insertFortnoxConfigSchema>;
export type FortnoxMapping = typeof fortnoxMappings.$inferSelect;
export type InsertFortnoxMapping = z.infer<typeof insertFortnoxMappingSchema>;
export type FortnoxInvoiceExport = typeof fortnoxInvoiceExports.$inferSelect;
export type InsertFortnoxInvoiceExport = z.infer<typeof insertFortnoxInvoiceExportSchema>;
export type ObjectPayer = typeof objectPayers.$inferSelect;
export type InsertObjectPayer = z.infer<typeof insertObjectPayerSchema>;
export type MetadataDefinition = typeof metadataDefinitions.$inferSelect;
export type InsertMetadataDefinition = z.infer<typeof insertMetadataDefinitionSchema>;
export type ObjectMetadata = typeof objectMetadata.$inferSelect;
export type InsertObjectMetadata = z.infer<typeof insertObjectMetadataSchema>;
export type ObjectImage = typeof objectImages.$inferSelect;
export type InsertObjectImage = z.infer<typeof insertObjectImageSchema>;
export type ObjectContact = typeof objectContacts.$inferSelect;
export type InsertObjectContact = z.infer<typeof insertObjectContactSchema>;
export type TaskDesiredTimewindow = typeof taskDesiredTimewindows.$inferSelect;
export type InsertTaskDesiredTimewindow = z.infer<typeof insertTaskDesiredTimewindowSchema>;
export type TaskDependency = typeof taskDependencies.$inferSelect;
export type InsertTaskDependency = z.infer<typeof insertTaskDependencySchema>;
export type TaskInformation = typeof taskInformation.$inferSelect;
export type InsertTaskInformation = z.infer<typeof insertTaskInformationSchema>;
export type ObjectParent = typeof objectParents.$inferSelect;
export type InsertObjectParent = z.infer<typeof insertObjectParentSchema>;
export type ObjectTimeRestriction = typeof objectTimeRestrictions.$inferSelect;
export type InsertObjectTimeRestriction = z.infer<typeof insertObjectTimeRestrictionSchema>;
export type StructuralArticle = typeof structuralArticles.$inferSelect;
export type InsertStructuralArticle = z.infer<typeof insertStructuralArticleSchema>;

// Order concepts and assignments types
export type OrderConcept = typeof orderConcepts.$inferSelect;
export type InsertOrderConcept = z.infer<typeof insertOrderConceptSchema>;
export type ConceptFilter = typeof conceptFilters.$inferSelect;
export type InsertConceptFilter = z.infer<typeof insertConceptFilterSchema>;
export type Assignment = typeof assignments.$inferSelect;
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type AssignmentArticle = typeof assignmentArticles.$inferSelect;
export type InsertAssignmentArticle = z.infer<typeof insertAssignmentArticleSchema>;
export type SubscriptionChange = typeof subscriptionChanges.$inferSelect;
export type InsertSubscriptionChange = z.infer<typeof insertSubscriptionChangeSchema>;

export const CUSTOMER_MODES = ["HARDCODED", "FROM_METADATA"] as const;
export type CustomerMode = typeof CUSTOMER_MODES[number];

// Scenario types for order concepts
export const ORDER_CONCEPT_SCENARIOS = [
  "avrop",        // Engångs-/behovsbaserat (on-demand)
  "schema",       // Schemalagd med leveransschema
  "abonnemang"    // Abonnemang med fast avgift
] as const;
export type OrderConceptScenario = typeof ORDER_CONCEPT_SCENARIOS[number];

export const ORDER_CONCEPT_SCENARIO_LABELS: Record<OrderConceptScenario, string> = {
  avrop: "Avrop (engång)",
  schema: "Schema (återkommande)",
  abonnemang: "Abonnemang (fast avgift)"
};

// ============================================
// WIZARD TABLES - Orderkoncept 9-stegs process
// ============================================

export const INVOICE_LEVELS = ["customer", "area", "property", "object"] as const;
export type InvoiceLevel = typeof INVOICE_LEVELS[number];
export const INVOICE_LEVEL_LABELS: Record<InvoiceLevel, string> = {
  customer: "Kundnivå",
  area: "Områdesnivå",
  property: "Fastighetsnivå",
  object: "Objektnivå"
};

export const INVOICE_MODELS = ["call_off", "schedule", "subscription"] as const;
export type InvoiceModel = typeof INVOICE_MODELS[number];
export const INVOICE_MODEL_LABELS: Record<InvoiceModel, string> = {
  call_off: "Avrop (efterfakturering)",
  schedule: "Schema (efterfakturering)",
  subscription: "Abonnemang (månadsfakturering)"
};

export const INVOICE_PERIODS = ["daily", "weekly", "monthly", "quarterly"] as const;
export type InvoicePeriod = typeof INVOICE_PERIODS[number];
export const INVOICE_PERIOD_LABELS: Record<InvoicePeriod, string> = {
  daily: "Dagligen",
  weekly: "Veckovis",
  monthly: "Månadsvis",
  quarterly: "Kvartalsvis"
};

export const DELIVERY_MODELS = ["call_off", "schedule", "subscription"] as const;
export type DeliveryModel = typeof DELIVERY_MODELS[number];
export const DELIVERY_MODEL_LABELS: Record<DeliveryModel, string> = {
  call_off: "Avrop (engångsbeställning)",
  schedule: "Schema (återkommande enligt plan)",
  subscription: "Abonnemang (fast månadsavgift)"
};

export const DELIVERY_SEASONS = ["spring", "summer", "fall", "winter"] as const;
export type DeliverySeason = typeof DELIVERY_SEASONS[number];
export const DELIVERY_SEASON_LABELS: Record<DeliverySeason, string> = {
  spring: "Vår (feb-apr)",
  summer: "Sommar (maj-jul)",
  fall: "Höst (sep-nov)",
  winter: "Vinter (dec-jan)"
};

export const DOCUMENT_TYPES = ["order_confirmation", "delivery_note", "invoice"] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  order_confirmation: "Orderbekräftelse",
  delivery_note: "Följesedel",
  invoice: "Faktura"
};

export const DISTRIBUTION_CHANNELS = ["email", "portal", "sms", "print"] as const;
export type DistributionChannel = typeof DISTRIBUTION_CHANNELS[number];
export const DISTRIBUTION_CHANNEL_LABELS: Record<DistributionChannel, string> = {
  email: "E-post",
  portal: "Kundportal",
  sms: "SMS",
  print: "Utskrift"
};

export const orderConceptObjects = pgTable("order_concept_objects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderConceptId: varchar("order_concept_id").references(() => orderConcepts.id, { onDelete: "cascade" }).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  metadataSnapshot: jsonb("metadata_snapshot"),
  included: boolean("included").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_oco_order_concept").on(table.orderConceptId),
  index("idx_oco_object").on(table.objectId),
]);

export const insertOrderConceptObjectSchema = createInsertSchema(orderConceptObjects).omit({
  id: true,
  createdAt: true,
});
export type OrderConceptObject = typeof orderConceptObjects.$inferSelect;
export type InsertOrderConceptObject = z.infer<typeof insertOrderConceptObjectSchema>;

export const orderConceptArticles = pgTable("order_concept_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderConceptId: varchar("order_concept_id").references(() => orderConcepts.id, { onDelete: "cascade" }).notNull(),
  articleId: varchar("article_id").references(() => articles.id).notNull(),
  quantity: integer("quantity").default(1),
  unitPrice: real("unit_price"),
  priceOverride: boolean("price_override").default(false),
  metadataRules: jsonb("metadata_rules"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_oca_order_concept").on(table.orderConceptId),
  index("idx_oca_article").on(table.articleId),
]);

export const insertOrderConceptArticleSchema = createInsertSchema(orderConceptArticles).omit({
  id: true,
  createdAt: true,
});
export type OrderConceptArticle = typeof orderConceptArticles.$inferSelect;
export type InsertOrderConceptArticle = z.infer<typeof insertOrderConceptArticleSchema>;

export const articleObjectMappings = pgTable("article_object_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderConceptArticleId: varchar("order_concept_article_id").references(() => orderConceptArticles.id, { onDelete: "cascade" }).notNull(),
  orderConceptObjectId: varchar("order_concept_object_id").references(() => orderConceptObjects.id, { onDelete: "cascade" }).notNull(),
  quantity: integer("quantity").default(1),
  metadataRead: jsonb("metadata_read"),
  metadataCreate: jsonb("metadata_create"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_aom_article").on(table.orderConceptArticleId),
  index("idx_aom_object").on(table.orderConceptObjectId),
]);

export const insertArticleObjectMappingSchema = createInsertSchema(articleObjectMappings).omit({
  id: true,
  createdAt: true,
});
export type ArticleObjectMapping = typeof articleObjectMappings.$inferSelect;
export type InsertArticleObjectMapping = z.infer<typeof insertArticleObjectMappingSchema>;

export const invoiceConfigurations = pgTable("invoice_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderConceptId: varchar("order_concept_id").references(() => orderConcepts.id, { onDelete: "cascade" }).notNull(),
  headerMetadata: jsonb("header_metadata"),
  lineMetadata: jsonb("line_metadata"),
  recipients: jsonb("recipients"),
  showPrices: boolean("show_prices").default(true),
  paymentTermsDays: integer("payment_terms_days").default(30),
  fortnoxExportEnabled: boolean("fortnox_export_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_ic_order_concept").on(table.orderConceptId),
]);

export const insertInvoiceConfigurationSchema = createInsertSchema(invoiceConfigurations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InvoiceConfiguration = typeof invoiceConfigurations.$inferSelect;
export type InsertInvoiceConfiguration = z.infer<typeof insertInvoiceConfigurationSchema>;

export const documentConfigurations = pgTable("document_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderConceptId: varchar("order_concept_id").references(() => orderConcepts.id, { onDelete: "cascade" }).notNull(),
  documentType: text("document_type").notNull(),
  enabled: boolean("enabled").default(true),
  metadataFields: jsonb("metadata_fields"),
  showPrice: boolean("show_price").default(true),
  recipients: jsonb("recipients"),
  distributionChannels: jsonb("distribution_channels"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_dc_order_concept").on(table.orderConceptId),
]);

export const insertDocumentConfigurationSchema = createInsertSchema(documentConfigurations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type DocumentConfiguration = typeof documentConfigurations.$inferSelect;
export type InsertDocumentConfiguration = z.infer<typeof insertDocumentConfigurationSchema>;

export const deliverySchedules = pgTable("delivery_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderConceptId: varchar("order_concept_id").references(() => orderConcepts.id, { onDelete: "cascade" }).notNull(),
  season: text("season"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  periodicityValue: integer("periodicity_value").default(1),
  periodicityUnit: text("periodicity_unit").default("months"),
  minDaysBetween: integer("min_days_between").default(60),
  preferredWeekday: integer("preferred_weekday"),
  preferredTimeFrom: text("preferred_time_from"),
  preferredTimeTo: text("preferred_time_to"),
  rollingExtension: boolean("rolling_extension").default(true),
  rollingMonths: integer("rolling_months").default(12),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_ds_order_concept").on(table.orderConceptId),
]);

export const insertDeliveryScheduleSchema = createInsertSchema(deliverySchedules).omit({
  id: true,
  createdAt: true,
});
export type DeliverySchedule = typeof deliverySchedules.$inferSelect;
export type InsertDeliverySchedule = z.infer<typeof insertDeliveryScheduleSchema>;

export const orderConceptObjectsRelations = relations(orderConceptObjects, ({ one }) => ({
  orderConcept: one(orderConcepts, { fields: [orderConceptObjects.orderConceptId], references: [orderConcepts.id] }),
  object: one(objects, { fields: [orderConceptObjects.objectId], references: [objects.id] }),
}));

export const orderConceptArticlesRelations = relations(orderConceptArticles, ({ one, many }) => ({
  orderConcept: one(orderConcepts, { fields: [orderConceptArticles.orderConceptId], references: [orderConcepts.id] }),
  article: one(articles, { fields: [orderConceptArticles.articleId], references: [articles.id] }),
  mappings: many(articleObjectMappings),
}));

export const articleObjectMappingsRelations = relations(articleObjectMappings, ({ one }) => ({
  conceptArticle: one(orderConceptArticles, { fields: [articleObjectMappings.orderConceptArticleId], references: [orderConceptArticles.id] }),
  conceptObject: one(orderConceptObjects, { fields: [articleObjectMappings.orderConceptObjectId], references: [orderConceptObjects.id] }),
}));

export const invoiceConfigurationsRelations = relations(invoiceConfigurations, ({ one }) => ({
  orderConcept: one(orderConcepts, { fields: [invoiceConfigurations.orderConceptId], references: [orderConcepts.id] }),
}));

export const documentConfigurationsRelations = relations(documentConfigurations, ({ one }) => ({
  orderConcept: one(orderConcepts, { fields: [documentConfigurations.orderConceptId], references: [orderConcepts.id] }),
}));

export const deliverySchedulesRelations = relations(deliverySchedules, ({ one }) => ({
  orderConcept: one(orderConcepts, { fields: [deliverySchedules.orderConceptId], references: [orderConcepts.id] }),
}));

// Delivery schedule entry type
export interface DeliveryScheduleEntry {
  month: number; // 1-12
  weekNumber: number; // 1-5 (week within month)
  weekday: number; // 0-6 (0=Sunday)
  timeWindowStart?: string; // "08:00"
  timeWindowEnd?: string; // "12:00"
}

// Billing frequency options
export const BILLING_FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export type BillingFrequency = typeof BILLING_FREQUENCIES[number];
export const BILLING_FREQUENCY_LABELS: Record<BillingFrequency, string> = {
  monthly: "Månadsvis",
  quarterly: "Kvartalsvis",
  yearly: "Årsvis"
};

// ============================================
// UTÖKADE ORDER STATUSAR (8 nivåer enligt spec)
// ============================================

export const EXECUTION_STATUSES = [
  "not_planned",      // Ej planerad
  "planned_rough",    // Grovplanerad (tilldelad vecka/team)
  "planned_fine",     // Finplanerad (tilldelad resurs)
  "on_way",           // På väg
  "on_site",          // På plats
  "completed",        // Utförd
  "inspected",        // Kontrollerad
  "invoiced"          // Fakturerad
] as const;
export type ExecutionStatus = typeof EXECUTION_STATUSES[number];

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  not_planned: "Ej planerad",
  planned_rough: "Grovplanerad",
  planned_fine: "Finplanerad",
  on_way: "På väg",
  on_site: "På plats",
  completed: "Utförd",
  inspected: "Kontrollerad",
  invoiced: "Fakturerad"
};

// ============================================
// UTFÖRANDEKODER (C8)
// ============================================

export const EXECUTION_CODES = [
  "kranbil",
  "tvatt",
  "sug",
  "service",
  "besiktning",
  "transport",
  "manuell",
] as const;
export type ExecutionCodeType = typeof EXECUTION_CODES[number];

export const EXECUTION_CODE_LABELS: Record<string, string> = {
  kranbil: "Kranbil",
  tvatt: "Tvätt",
  sug: "Sugbil",
  service: "Service",
  besiktning: "Besiktning",
  transport: "Transport",
  manuell: "Manuellt arbete",
};

export const EXECUTION_CODE_ICONS: Record<string, string> = {
  kranbil: "KB",
  tvatt: "TV",
  sug: "SB",
  service: "SV",
  besiktning: "BS",
  transport: "TR",
  manuell: "MA",
};

// ============================================
// UPPGIFTSSKAPANDEMETODER
// ============================================

export const TASK_CREATION_METHODS = [
  "manual",           // Manuellt skapad
  "import",           // Importerad (från Modus etc.)
  "external_report",  // Extern felanmälan (kundportal)
  "performer",        // Utförare-skapad
  "automatic"         // Automatik (abonnemang, strukturartikel)
] as const;
export type TaskCreationMethod = typeof TASK_CREATION_METHODS[number];

export const TASK_CREATION_METHOD_LABELS: Record<TaskCreationMethod, string> = {
  manual: "Manuell",
  import: "Import",
  external_report: "Extern felanmälan",
  performer: "Utförare",
  automatic: "Automatik"
};

// ============================================
// CUSTOMER PORTAL (Kundportal)
// ============================================

export const customerPortalTokens = pgTable("customer_portal_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  tokenHash: text("token_hash").notNull(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

export const customerPortalSessions = pgTable("customer_portal_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  sessionToken: text("session_token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastAccessedAt: timestamp("last_accessed_at").defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

export const BOOKING_REQUEST_STATUSES = [
  "pending",      // Väntar på handläggning
  "confirmed",    // Bekräftad
  "rejected",     // Avvisad
  "cancelled"     // Avbokad av kund
] as const;
export type BookingRequestStatus = typeof BOOKING_REQUEST_STATUSES[number];

export const BOOKING_REQUEST_TYPES = [
  "new_booking",      // Ny bokning
  "reschedule",       // Omboka befintlig
  "cancel",           // Avboka
  "extra_service"     // Extra tjänst
] as const;
export type BookingRequestType = typeof BOOKING_REQUEST_TYPES[number];

export const customerBookingRequests = pgTable("customer_booking_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id),
  workOrderId: varchar("work_order_id").references(() => workOrders.id),
  requestType: text("request_type").notNull(),
  status: text("status").default("pending").notNull(),
  preferredDate1: timestamp("preferred_date_1"),
  preferredDate2: timestamp("preferred_date_2"),
  preferredTimeSlot: text("preferred_time_slot"),
  customerNotes: text("customer_notes"),
  staffNotes: text("staff_notes"),
  handledBy: varchar("handled_by").references(() => users.id),
  handledAt: timestamp("handled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const customerPortalMessages = pgTable("customer_portal_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  sender: text("sender").notNull(), // "customer" or "staff"
  senderUserId: varchar("sender_user_id").references(() => users.id),
  message: text("message").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCustomerPortalTokenSchema = createInsertSchema(customerPortalTokens).omit({ id: true, requestedAt: true });
export const insertCustomerPortalSessionSchema = createInsertSchema(customerPortalSessions).omit({ id: true, createdAt: true, lastAccessedAt: true });
export const insertCustomerBookingRequestSchema = createInsertSchema(customerBookingRequests).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCustomerPortalMessageSchema = createInsertSchema(customerPortalMessages).omit({ id: true, createdAt: true });

export type CustomerPortalToken = typeof customerPortalTokens.$inferSelect;
export type InsertCustomerPortalToken = z.infer<typeof insertCustomerPortalTokenSchema>;
export type CustomerPortalSession = typeof customerPortalSessions.$inferSelect;
export type InsertCustomerPortalSession = z.infer<typeof insertCustomerPortalSessionSchema>;
export type CustomerBookingRequest = typeof customerBookingRequests.$inferSelect;
export type InsertCustomerBookingRequest = z.infer<typeof insertCustomerBookingRequestSchema>;
export type CustomerPortalMessage = typeof customerPortalMessages.$inferSelect;
export type InsertCustomerPortalMessage = z.infer<typeof insertCustomerPortalMessageSchema>;

// === KUNDFAKTUROR (Customer Invoices) ===
export const customerInvoices = pgTable("customer_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: timestamp("invoice_date").notNull(),
  dueDate: timestamp("due_date").notNull(),
  amount: real("amount").notNull(),
  vatAmount: real("vat_amount").default(0),
  totalAmount: real("total_amount").notNull(),
  currency: text("currency").default("SEK"),
  status: text("status").default("unpaid").notNull(), // unpaid, paid, overdue, cancelled
  paidAt: timestamp("paid_at"),
  pdfUrl: text("pdf_url"),
  fortnoxInvoiceId: text("fortnox_invoice_id"),
  description: text("description"),
  workOrderIds: text("work_order_ids").array().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCustomerInvoiceSchema = createInsertSchema(customerInvoices).omit({ id: true, createdAt: true });
export type CustomerInvoice = typeof customerInvoices.$inferSelect;
export type InsertCustomerInvoice = z.infer<typeof insertCustomerInvoiceSchema>;

// === FELANMÄLNINGAR (Issue Reports) ===
export const customerIssueReports = pgTable("customer_issue_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id),
  issueType: text("issue_type").notNull(), // damaged_container, missed_pickup, access_problem, other
  priority: text("priority").default("normal"), // low, normal, high, urgent
  status: text("status").default("open").notNull(), // open, in_progress, resolved, closed
  title: text("title").notNull(),
  description: text("description"),
  customerContact: text("customer_contact"),
  imageUrls: text("image_urls").array().default([]),
  staffNotes: text("staff_notes"),
  assignedTo: varchar("assigned_to").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by").references(() => users.id),
  resolution: text("resolution"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCustomerIssueReportSchema = createInsertSchema(customerIssueReports).omit({ id: true, createdAt: true, updatedAt: true });
export type CustomerIssueReport = typeof customerIssueReports.$inferSelect;
export type InsertCustomerIssueReport = z.infer<typeof insertCustomerIssueReportSchema>;

// === TJÄNSTEAVTAL/ABONNEMANG (Service Contracts) ===
export const customerServiceContracts = pgTable("customer_service_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  contractNumber: text("contract_number"),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").default("active").notNull(), // active, paused, cancelled, expired
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date"),
  renewalType: text("renewal_type").default("auto"), // auto, manual, none
  billingCycle: text("billing_cycle").default("monthly"), // monthly, quarterly, yearly
  monthlyValue: real("monthly_value"),
  objectIds: text("object_ids").array().default([]),
  services: jsonb("services").default([]), // Array of service items included
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCustomerServiceContractSchema = createInsertSchema(customerServiceContracts).omit({ id: true, createdAt: true, updatedAt: true });
export type CustomerServiceContract = typeof customerServiceContracts.$inferSelect;
export type InsertCustomerServiceContract = z.infer<typeof insertCustomerServiceContractSchema>;

// === KUNDPROFIL/NOTIFIERINGSINSTÄLLNINGAR ===
export const customerNotificationSettings = pgTable("customer_notification_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  emailNotifications: boolean("email_notifications").default(true),
  smsNotifications: boolean("sms_notifications").default(false),
  notifyOnTechnicianOnWay: boolean("notify_on_technician_on_way").default(true),
  notifyOnJobCompleted: boolean("notify_on_job_completed").default(true),
  notifyOnInvoice: boolean("notify_on_invoice").default(true),
  notifyOnBookingConfirmation: boolean("notify_on_booking_confirmation").default(true),
  preferredContactEmail: text("preferred_contact_email"),
  preferredContactPhone: text("preferred_contact_phone"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCustomerNotificationSettingsSchema = createInsertSchema(customerNotificationSettings).omit({ id: true, updatedAt: true });
export type CustomerNotificationSettings = typeof customerNotificationSettings.$inferSelect;
export type InsertCustomerNotificationSettings = z.infer<typeof insertCustomerNotificationSettingsSchema>;

// ============================================================================
// MATS VISION: OBJEKTDATA & METADATA-SYSTEM (EAV-modell)
// Separerar objektdata (minimalistisk container) från metadata (flexibel EAV)
// Kompletterar det befintliga metadataDefinitions/objectMetadata-systemet
// ============================================================================

// Tillåtna datatyper för metadata (utökade per Mats spec)
export const METADATA_DATA_TYPES = [
  'string',     // Textvärden
  'integer',    // Heltal (ANTAL)
  'decimal',    // Decimaltal
  'boolean',    // Sant/falskt (STATUS)
  'datetime',   // Datum/tid
  'json',       // JSON-objekt
  'referens',   // Referens till annan tabell (KUND, PRISLISTA)
  'image',      // Bild (BILD) - URL/filreferens
  'file',       // Fil (FIL) - URL/filreferens
  'code',       // Kod (KOD) - text, ev. numerisk
  'location',   // Plats (PLATS) - GPS lat/long
  'interval'    // Tid/Intervall (TID) - t.ex. "var 5:e månad"
] as const;
export type MetadataDataType = typeof METADATA_DATA_TYPES[number];

// Metoder för hur metadata skapades/uppdaterades
export const METADATA_METHODS = [
  'manuell',      // Skapad manuellt av planerare
  'automatisk',   // Automatiskt genererad av system
  'extern',       // Importerad från extern källa (CSV, API)
  'utforande',    // Uppdaterad vid utförande av fältarbetare
  'arvd'          // Ärvd från förälderobjekt
] as const;
export type MetadataMethod = typeof METADATA_METHODS[number];

// Metadatakatalog - utökad katalog över metadatatyper (Mats vision)
export const metadataKatalog = pgTable("metadata_katalog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  namn: varchar("namn", { length: 100 }).notNull(),
  beskrivning: text("beskrivning"),
  datatyp: text("datatyp").notNull(), // string, integer, decimal, boolean, datetime, json, referens
  
  // För referens-datatyper: vilken tabell pekar de på?
  referensTabell: varchar("referens_tabell", { length: 100 }),
  
  // Är denna metadata logisk (används i systemlogik) eller ologisk (bara info)?
  arLogisk: boolean("ar_logisk").default(true).notNull(),
  
  // Standardvärde för om metadata ska ärvas nedåt i hierarkin
  standardArvs: boolean("standard_arvs").default(false).notNull(),
  
  // Kategori för gruppering i UI: geografi, kontakt, artikel, administrativ, beskrivning
  kategori: text("kategori").default("annat"),
  
  // Ordning i UI
  sortOrder: integer("sort_order").default(0),
  
  // Ikon för visualisering
  icon: text("icon"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_metadata_katalog_tenant_namn").on(table.tenantId, table.namn)
]);

// Metadatavärden - EAV-modell med typade värdefält och korsbefruktning
// Supports both objects (objektId) and work orders (workOrderId) as targets
export const metadataVarden = pgTable("metadata_varden", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objektId: varchar("objekt_id").references(() => objects.id), // Nullable - either objektId or workOrderId should be set
  workOrderId: varchar("work_order_id").references(() => workOrders.id), // Nullable - for work order metadata
  metadataKatalogId: varchar("metadata_katalog_id").references(() => metadataKatalog.id).notNull(),
  
  // Värdefält - endast ett ska ha värde baserat på datatyp
  vardeString: text("varde_string"),
  vardeInteger: integer("varde_integer"),
  vardeDecimal: real("varde_decimal"),
  vardeBoolean: boolean("varde_boolean"),
  vardeDatetime: timestamp("varde_datetime"),
  vardeJson: jsonb("varde_json"),
  vardeReferens: varchar("varde_referens", { length: 255 }),
  
  // === ÄRVNINGSKONFIGURATION ===
  // Ska denna metadata ärvas nedåt till barn i hierarkin?
  arvsNedat: boolean("arvs_nedat").default(false).notNull(),
  // Stoppa vidare ärvning (överskriver förälderns värde men ärver inte vidare)
  stoppaVidareArvning: boolean("stoppa_vidare_arvning").default(false).notNull(),
  // Nivå-lås: metadata stannar på denna nivå, ärvs INTE nedåt (per Mats spec level_lock)
  nivaLas: boolean("niva_las").default(false).notNull(),
  
  // === KORSBEFRUKTNING ===
  // Kan denna metadata kopplas till annan metadata? (t.ex. Antal kopplad till Artikel)
  koppladTillMetadataId: varchar("kopplad_till_metadata_id"),
  
  // Vem skapade/uppdaterade
  skapadAv: varchar("skapad_av", { length: 100 }),
  uppdateradAv: varchar("uppdaterad_av", { length: 100 }),
  // Metod: manuell, automatisk, extern, utforande, arvd
  metod: varchar("metod", { length: 50 }).default("manuell"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_metadata_varden_objekt").on(table.objektId),
  index("idx_metadata_varden_katalog").on(table.metadataKatalogId),
  index("idx_metadata_varden_objekt_katalog").on(table.objektId, table.metadataKatalogId),
  index("idx_metadata_varden_koppling").on(table.koppladTillMetadataId),
  index("idx_metadata_varden_work_order").on(table.workOrderId),
  index("idx_metadata_varden_work_order_katalog").on(table.workOrderId, table.metadataKatalogId)
]);

// Relationer för det nya metadata-systemet
export const metadataKatalogRelations = relations(metadataKatalog, ({ one, many }) => ({
  tenant: one(tenants, { fields: [metadataKatalog.tenantId], references: [tenants.id] }),
  varden: many(metadataVarden),
}));

export const metadataVardenRelations = relations(metadataVarden, ({ one, many }) => ({
  tenant: one(tenants, { fields: [metadataVarden.tenantId], references: [tenants.id] }),
  objekt: one(objects, { fields: [metadataVarden.objektId], references: [objects.id] }),
  workOrder: one(workOrders, { fields: [metadataVarden.workOrderId], references: [workOrders.id] }),
  katalog: one(metadataKatalog, { fields: [metadataVarden.metadataKatalogId], references: [metadataKatalog.id] }),
  // Korsbefruktning via koppladTillMetadataId (self-reference handled separately)
}));

// ============================================================================
// METADATA-HISTORIK (per Mats spec Funktion 5)
// Sparar gamla värden vid uppdatering för spårbarhet
// ============================================================================

export const metadataHistorik = pgTable("metadata_historik", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  metadataVardenId: varchar("metadata_varden_id").references(() => metadataVarden.id, { onDelete: "cascade" }).notNull(),
  objektId: varchar("objekt_id").references(() => objects.id),
  metadataKatalogId: varchar("metadata_katalog_id").references(() => metadataKatalog.id),
  gammaltVarde: text("gammalt_varde"),
  nyttVarde: text("nytt_varde"),
  andradAv: varchar("andrad_av", { length: 100 }),
  andradVid: timestamp("andrad_vid").defaultNow().notNull(),
  andringsMetod: varchar("andrings_metod", { length: 50 }),
}, (table) => [
  index("idx_metadata_historik_varden").on(table.metadataVardenId),
  index("idx_metadata_historik_objekt").on(table.objektId),
  index("idx_metadata_historik_tid").on(table.andradVid),
]);

export const metadataHistorikRelations = relations(metadataHistorik, ({ one }) => ({
  tenant: one(tenants, { fields: [metadataHistorik.tenantId], references: [tenants.id] }),
  metadataVarden: one(metadataVarden, { fields: [metadataHistorik.metadataVardenId], references: [metadataVarden.id] }),
  objekt: one(objects, { fields: [metadataHistorik.objektId], references: [objects.id] }),
  katalog: one(metadataKatalog, { fields: [metadataHistorik.metadataKatalogId], references: [metadataKatalog.id] }),
}));

// Schemas och types för det nya metadata-systemet
export const insertMetadataKatalogSchema = createInsertSchema(metadataKatalog).omit({ id: true, createdAt: true });
export type MetadataKatalog = typeof metadataKatalog.$inferSelect;
export type InsertMetadataKatalog = z.infer<typeof insertMetadataKatalogSchema>;

export const insertMetadataVardenSchema = createInsertSchema(metadataVarden).omit({ id: true, createdAt: true, updatedAt: true });
export type MetadataVarden = typeof metadataVarden.$inferSelect;
export type InsertMetadataVarden = z.infer<typeof insertMetadataVardenSchema>;

export const insertMetadataHistorikSchema = createInsertSchema(metadataHistorik).omit({ id: true });
export type MetadataHistorik = typeof metadataHistorik.$inferSelect;
export type InsertMetadataHistorik = z.infer<typeof insertMetadataHistorikSchema>;

// Utökade typer för metadata med ärvningsinformation
export interface MetadataVardenWithKatalog extends MetadataVarden {
  katalog: MetadataKatalog;
  source: 'local' | 'inherited';
  fromObject?: {
    id: string;
    namn: string;
    level: number;
  };
}

export interface ObjectWithAllMetadataEAV {
  id: string;
  name: string;
  objectType: string;
  parentId: string | null;
  metadata: MetadataVardenWithKatalog[];
}

// Geografisk position med prioriteringsordning
export interface GeographicPosition {
  typ: 'GPS' | 'What3words' | 'Adress';
  precision: 'exakt' | 'medel' | 'grov';
  varde: string;
  fromObject?: {
    id: string;
    namn: string;
  };
}

// ============================================
// FLEXIBEL SCHEMALÄGGNING - Frekvenstyper
// ============================================

// Veckodagar för schemaläggning (0=söndag, 1=måndag, ..., 6=lördag)
export const WEEKDAYS = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
} as const;

export const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Söndag',
  1: 'Måndag',
  2: 'Tisdag',
  3: 'Onsdag',
  4: 'Torsdag',
  5: 'Fredag',
  6: 'Lördag',
};

// Frekvenstyper för flexibel schemaläggning
export const FREQUENCY_TYPES = [
  'specific_weekdays',    // Specifika veckodagar (Mån, Ons, Fre)
  'interval_days',        // Fast intervall i dagar
  'times_per_week',       // X gånger per vecka (flexibel placering)
  'times_per_month',      // X gånger per månad
  'times_per_year',       // X gånger per år (årsstädning, etc.)
  'on_demand',            // Vid behov
] as const;
export type FrequencyType = typeof FREQUENCY_TYPES[number];

// Säsonger för säsongsbaserad schemaläggning
export const SEASONS = [
  'all_year',     // Hela året
  'spring',       // Vår (mars-maj)
  'summer',       // Sommar (juni-augusti)
  'autumn',       // Höst (september-november)
  'winter',       // Vinter (december-februari)
  'not_winter',   // Ej vinter (mars-november)
  'not_summer',   // Ej sommar
] as const;
export type Season = typeof SEASONS[number];

// Flexibel frekvenskonfiguration - JSON-struktur för subscription/orderConcept
export interface FlexibleFrequency {
  type: FrequencyType;
  
  // För specific_weekdays: lista av veckodagar (0-6)
  weekdays?: number[];
  
  // För interval_days: antal dagar mellan besök
  intervalDays?: number;
  
  // För times_per_week/month/year: antal gånger
  timesPerPeriod?: number;
  
  // Minimum dagar mellan besök (för times_per_week etc.)
  minDaysBetween?: number;
  
  // Maximum dagar mellan besök
  maxDaysBetween?: number;
  
  // Inkludera vardagar (måndag-fredag)
  includeWeekdays?: boolean;
  
  // Inkludera helger (lördag-söndag)
  includeWeekends?: boolean;
  
  // Exkludera specifika veckodagar
  excludeWeekdays?: number[];
  
  // Önskade månader för årliga uppgifter
  preferredMonths?: number[]; // 1-12
  
  // Föredraget tidsfönster
  preferredTimeWindow?: {
    start: string;  // "06:00"
    end: string;    // "10:00"
  };
  
  // Säsong då frekvensen gäller
  season?: Season;
  
  // Prioritet för flexibel planering (1=hög, 3=låg)
  flexibility?: 1 | 2 | 3;
}

// Zod-schema för validering av flexibel frekvens
export const flexibleFrequencySchema = z.object({
  type: z.enum(FREQUENCY_TYPES),
  weekdays: z.array(z.number().min(0).max(6)).optional(),
  intervalDays: z.number().positive().optional(),
  timesPerPeriod: z.number().positive().optional(),
  minDaysBetween: z.number().min(0).optional(),
  maxDaysBetween: z.number().positive().optional(),
  includeWeekdays: z.boolean().optional(),
  includeWeekends: z.boolean().optional(),
  excludeWeekdays: z.array(z.number().min(0).max(6)).optional(),
  preferredMonths: z.array(z.number().min(1).max(12)).optional(),
  preferredTimeWindow: z.object({
    start: z.string(),
    end: z.string(),
  }).optional(),
  season: z.enum(SEASONS).optional(),
  flexibility: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

// ============================================
// PROTOKOLL OCH RAPPORTER - Fas 1.3
// ============================================

// Protokolltyper
export const PROTOCOL_TYPES = [
  'cleaning',         // Städprotokoll
  'inspection',       // Besiktningsprotokoll
  'maintenance',      // Underhållsprotokoll
  'container_wash',   // Behållartvätt
  'annual_service',   // Årsstädning
] as const;
export type ProtocolType = typeof PROTOCOL_TYPES[number];

export const PROTOCOL_TYPE_LABELS: Record<ProtocolType, string> = {
  cleaning: 'Städprotokoll',
  inspection: 'Besiktningsprotokoll',
  maintenance: 'Underhållsprotokoll',
  container_wash: 'Tvättprotokoll',
  annual_service: 'Årsstädningsprotokoll',
};

// Avvikelsekategorier
export const DEVIATION_CATEGORIES = [
  'graffiti',         // Klotter
  'damage',           // Skada
  'spill',            // Spill/utsläpp
  'lighting',         // Belysning
  'fence',            // Inhägnad
  'large_items',      // Stora föremål
  'safety',           // Säkerhetsproblem
  'functionality',    // Funktionsproblem
  'other',            // Övrigt
] as const;
export type DeviationCategory = typeof DEVIATION_CATEGORIES[number];

export const DEVIATION_CATEGORY_LABELS: Record<DeviationCategory, string> = {
  graffiti: 'Klotter',
  damage: 'Skada',
  spill: 'Spill/utsläpp',
  lighting: 'Belysning',
  fence: 'Inhägnad',
  large_items: 'Stora föremål',
  safety: 'Säkerhetsproblem',
  functionality: 'Funktionsproblem',
  other: 'Övrigt',
};

// Allvarlighetsgrad
export const SEVERITY_LEVELS = [
  'low',       // Låg - kan vänta
  'medium',    // Medel - bör åtgärdas snart
  'high',      // Hög - bör åtgärdas inom kort
  'critical',  // Kritisk - omedelbar åtgärd krävs
] as const;
export type SeverityLevel = typeof SEVERITY_LEVELS[number];

export const SEVERITY_LEVEL_LABELS: Record<SeverityLevel, string> = {
  low: 'Låg',
  medium: 'Medel',
  high: 'Hög',
  critical: 'Kritisk',
};

// Besiktningsgrader / Assessment ratings
export const ASSESSMENT_RATINGS = [
  'rent',              // Rent och prydligt
  'ok',                // Acceptabelt
  'lite_skrapigt',     // Lite skräpigt
  'skrapigt',          // Skräpigt
  'mycket_skrapigt',   // Mycket skräpigt
  'behover_atgard',    // Behöver åtgärd
] as const;
export type AssessmentRating = typeof ASSESSMENT_RATINGS[number];

export const ASSESSMENT_RATING_LABELS: Record<AssessmentRating, string> = {
  rent: 'Rent och prydligt',
  ok: 'Acceptabelt',
  lite_skrapigt: 'Lite skräpigt',
  skrapigt: 'Skräpigt',
  mycket_skrapigt: 'Mycket skräpigt',
  behover_atgard: 'Behöver åtgärd',
};

export const ASSESSMENT_RATING_SCORES: Record<AssessmentRating, number> = {
  rent: 5,
  ok: 4,
  lite_skrapigt: 3,
  skrapigt: 2,
  mycket_skrapigt: 1,
  behover_atgard: 0,
};

// Protokolltabell - städprotokoll, besiktningsprotokoll, etc.
export const protocols = pgTable("protocols", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Koppling till arbetsorder
  workOrderId: varchar("work_order_id").references(() => workOrders.id).notNull(),
  // Koppling till objekt
  objectId: varchar("object_id").references(() => objects.id),
  // Protokolltyp
  protocolType: text("protocol_type").notNull(), // ProtocolType
  // Protokollnummer (för referens)
  protocolNumber: text("protocol_number"),
  
  // Utförande
  executedAt: timestamp("executed_at").notNull(),
  executedBy: varchar("executed_by").references(() => users.id),
  executedByName: text("executed_by_name"),
  
  // Utförda åtgärder (JSON array)
  executedActions: jsonb("executed_actions").default([]),
  // Beskrivning av utfört arbete
  workDescription: text("work_description"),
  
  // Bedömning/rating (för besiktningar)
  assessmentRating: text("assessment_rating"), // t.ex. "lite_skrapigt", "skrapigt", "mycket_skrapigt"
  assessmentNotes: text("assessment_notes"),
  
  // Bilder
  beforePhotoUrl: text("before_photo_url"),
  afterPhotoUrl: text("after_photo_url"),
  additionalPhotos: text("additional_photos").array(),
  
  // Total tid
  totalDurationMinutes: integer("total_duration_minutes"),
  
  // Signatur (base64 eller URL)
  signature: text("signature"),
  signedAt: timestamp("signed_at"),
  
  // PDF-generering
  pdfUrl: text("pdf_url"),
  pdfGeneratedAt: timestamp("pdf_generated_at"),
  
  // Skickad till kund
  sentToCustomer: boolean("sent_to_customer").default(false),
  sentAt: timestamp("sent_at"),
  
  status: text("status").default("draft").notNull(), // draft, completed, sent
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_protocols_work_order").on(table.workOrderId),
  index("idx_protocols_object").on(table.objectId),
  index("idx_protocols_type").on(table.protocolType),
]);

// Avvikelserapporter
export const deviationReports = pgTable("deviation_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Kan kopplas till antingen arbetsorder eller protokoll
  workOrderId: varchar("work_order_id").references(() => workOrders.id),
  protocolId: varchar("protocol_id").references(() => protocols.id),
  // Objekt där avvikelsen upptäcktes
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  
  // Avvikelseinformation
  category: text("category").notNull(), // DeviationCategory
  title: text("title").notNull(),
  description: text("description"),
  severityLevel: text("severity_level").default("medium").notNull(), // SeverityLevel
  
  // Vem upptäckte
  reportedBy: varchar("reported_by").references(() => users.id),
  reportedByName: text("reported_by_name"),
  reportedAt: timestamp("reported_at").defaultNow().notNull(),
  
  // GPS-position vid upptäckt
  latitude: real("latitude"),
  longitude: real("longitude"),
  
  // Bilder
  photos: text("photos").array(),
  
  // Föreslagen åtgärd
  suggestedAction: text("suggested_action"),
  estimatedCost: integer("estimated_cost"), // SEK
  
  // Kräver omedelbar åtgärd?
  requiresImmediateAction: boolean("requires_immediate_action").default(false),
  // Tidsfrist för åtgärd (om kund har krav)
  actionDeadline: timestamp("action_deadline"),
  
  // Status och åtgärdshantering
  status: text("status").default("reported").notNull(), // reported, acknowledged, in_progress, resolved, cancelled
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by").references(() => users.id),
  resolutionNotes: text("resolution_notes"),
  
  // Kopplad order för åtgärd (om en separat order skapas)
  linkedActionOrderId: varchar("linked_action_order_id"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_deviation_object").on(table.objectId),
  index("idx_deviation_status").on(table.status),
  index("idx_deviation_category").on(table.category),
  index("idx_deviation_severity").on(table.severityLevel),
]);

// Relation för protokoll och avvikelser
export const protocolsRelations = relations(protocols, ({ one, many }) => ({
  tenant: one(tenants, { fields: [protocols.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [protocols.workOrderId], references: [workOrders.id] }),
  object: one(objects, { fields: [protocols.objectId], references: [objects.id] }),
  executedByUser: one(users, { fields: [protocols.executedBy], references: [users.id] }),
  deviations: many(deviationReports),
}));

export const deviationReportsRelations = relations(deviationReports, ({ one }) => ({
  tenant: one(tenants, { fields: [deviationReports.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [deviationReports.workOrderId], references: [workOrders.id] }),
  protocol: one(protocols, { fields: [deviationReports.protocolId], references: [protocols.id] }),
  object: one(objects, { fields: [deviationReports.objectId], references: [objects.id] }),
  reportedByUser: one(users, { fields: [deviationReports.reportedBy], references: [users.id] }),
  resolvedByUser: one(users, { fields: [deviationReports.resolvedBy], references: [users.id] }),
}));

// Insert schemas och typer
export const insertProtocolSchema = createInsertSchema(protocols).omit({ id: true, createdAt: true });
export type Protocol = typeof protocols.$inferSelect;
export type InsertProtocol = z.infer<typeof insertProtocolSchema>;

export const insertDeviationReportSchema = createInsertSchema(deviationReports).omit({ id: true, createdAt: true, updatedAt: true });
export type DeviationReport = typeof deviationReports.$inferSelect;
export type InsertDeviationReport = z.infer<typeof insertDeviationReportSchema>;

// ============================================
// QR-KOD FELANMÄLAN - Fas 2.1
// ============================================

// QR-kod länkade till objekt för publik felanmälan
export const qrCodeLinks = pgTable("qr_code_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  // Unik kod för QR-URL
  code: text("code").notNull().unique(),
  // Beskrivning (visas för användaren)
  label: text("label"),
  // Aktiv/inaktiv
  isActive: boolean("is_active").default(true).notNull(),
  // Statistik
  scanCount: integer("scan_count").default(0),
  lastScannedAt: timestamp("last_scanned_at"),
  // Skapad
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: varchar("created_by").references(() => users.id),
}, (table) => [
  index("idx_qr_code_object").on(table.objectId),
  index("idx_qr_code_code").on(table.code),
]);

// Publika felanmälningar via QR-kod
export const publicIssueReports = pgTable("public_issue_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Koppling till QR-kod och objekt
  qrCodeLinkId: varchar("qr_code_link_id").references(() => qrCodeLinks.id),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  // Anmälarens uppgifter (frivilligt)
  reporterName: text("reporter_name"),
  reporterEmail: text("reporter_email"),
  reporterPhone: text("reporter_phone"),
  // Problemkategori
  category: text("category").notNull(), // Same as DeviationCategory
  // Beskrivning
  title: text("title").notNull(),
  description: text("description"),
  // Bilder (URLs eller base64)
  photos: text("photos").array(),
  // GPS-position vid anmälan
  latitude: real("latitude"),
  longitude: real("longitude"),
  // IP-adress för spårning (GDPR-godkänd lagring)
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  // Status
  status: text("status").default("new").notNull(), // new, reviewed, converted, rejected
  // Om konverterad till avvikelse eller arbetsorder
  linkedDeviationId: varchar("linked_deviation_id").references(() => deviationReports.id),
  linkedWorkOrderId: varchar("linked_work_order_id"),
  // Granskad av
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_public_issue_object").on(table.objectId),
  index("idx_public_issue_status").on(table.status),
  index("idx_public_issue_qr").on(table.qrCodeLinkId),
]);

export const qrCodeLinksRelations = relations(qrCodeLinks, ({ one, many }) => ({
  tenant: one(tenants, { fields: [qrCodeLinks.tenantId], references: [tenants.id] }),
  object: one(objects, { fields: [qrCodeLinks.objectId], references: [objects.id] }),
  createdByUser: one(users, { fields: [qrCodeLinks.createdBy], references: [users.id] }),
  issueReports: many(publicIssueReports),
}));

export const publicIssueReportsRelations = relations(publicIssueReports, ({ one }) => ({
  tenant: one(tenants, { fields: [publicIssueReports.tenantId], references: [tenants.id] }),
  qrCodeLink: one(qrCodeLinks, { fields: [publicIssueReports.qrCodeLinkId], references: [qrCodeLinks.id] }),
  object: one(objects, { fields: [publicIssueReports.objectId], references: [objects.id] }),
  linkedDeviation: one(deviationReports, { fields: [publicIssueReports.linkedDeviationId], references: [deviationReports.id] }),
  reviewedByUser: one(users, { fields: [publicIssueReports.reviewedBy], references: [users.id] }),
}));

export const insertQrCodeLinkSchema = createInsertSchema(qrCodeLinks).omit({ id: true, createdAt: true, scanCount: true });
export type QrCodeLink = typeof qrCodeLinks.$inferSelect;
export type InsertQrCodeLink = z.infer<typeof insertQrCodeLinkSchema>;

export const insertPublicIssueReportSchema = createInsertSchema(publicIssueReports).omit({ id: true, createdAt: true });
export type PublicIssueReport = typeof publicIssueReports.$inferSelect;
export type InsertPublicIssueReport = z.infer<typeof insertPublicIssueReportSchema>;

// Utförd åtgärd-struktur (för protocols.executedActions)
export interface ExecutedAction {
  articleId?: string;
  articleName: string;
  stepName?: string;
  quantity: number;
  durationMinutes: number;
  status: 'completed' | 'skipped' | 'not_applicable';
  notes?: string;
}

// ============================================
// MILJÖSTATISTIK - Fas 3.1
// ============================================

// Miljödata per arbetsorder - körsträcka, bränsle, kemikalier
export const environmentalData = pgTable("environmental_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").notNull(),
  resourceId: varchar("resource_id").references(() => resources.id),
  vehicleId: varchar("vehicle_id"),
  // Körsträcka
  distanceKm: real("distance_km"),
  odometerStart: integer("odometer_start"),
  odometerEnd: integer("odometer_end"),
  // Bränsle
  fuelLiters: real("fuel_liters"),
  fuelType: text("fuel_type"), // diesel, gasoline, electric, hybrid
  // CO2 (automatberäknat eller manuellt)
  co2Kg: real("co2_kg"),
  co2CalculationMethod: text("co2_calculation_method").default("auto"), // auto, manual
  // Kemikalier
  chemicalsUsed: jsonb("chemicals_used").default([]), // [{name, quantity, unit}]
  // Vikt (avfallsmängd)
  wasteCollectedKg: real("waste_collected_kg"),
  wasteType: text("waste_type"),
  // Datum
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  createdBy: varchar("created_by").references(() => users.id),
}, (table) => [
  index("idx_env_work_order").on(table.workOrderId),
  index("idx_env_resource").on(table.resourceId),
  index("idx_env_date").on(table.recordedAt),
]);

// CO2-emissionsfaktorer per bränsletyp (kg CO2 per liter)
export const CO2_EMISSION_FACTORS: Record<string, number> = {
  diesel: 2.68,      // kg CO2 per liter
  gasoline: 2.31,    // kg CO2 per liter
  hvo100: 0.27,      // Förnybar diesel (ca 90% lägre)
  electric: 0,       // Laddas separat per kWh
  hybrid: 1.5,       // Ungefärligt genomsnitt
};

// CO2 per km för olika fordonstyper (default-värden)
export const CO2_PER_KM_DEFAULTS: Record<string, number> = {
  compact_truck: 0.25,   // kg CO2/km
  medium_truck: 0.35,    // kg CO2/km
  large_truck: 0.50,     // kg CO2/km
  pickup: 0.20,          // kg CO2/km
  van: 0.18,             // kg CO2/km
  electric_van: 0.03,    // kg CO2/km (endast produktion)
};

export const insertEnvironmentalDataSchema = createInsertSchema(environmentalData).omit({ id: true, recordedAt: true });
export type EnvironmentalData = typeof environmentalData.$inferSelect;
export type InsertEnvironmentalData = z.infer<typeof insertEnvironmentalDataSchema>;

// Kemikalie-användning struktur
export interface ChemicalUsage {
  name: string;
  quantity: number;
  unit: string; // liters, kg, ml, g
  hazardClass?: string; // UN-klass eller liknande
}

// ============================================
// KUNDPORTAL 2.0 - Besökskvittering, Betyg, Chatt
// ============================================

// Besökskvitteringar - kunden bekräftar att jobbet är utfört
export const visitConfirmations = pgTable("visit_confirmations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  confirmedAt: timestamp("confirmed_at").defaultNow().notNull(),
  confirmationStatus: text("confirmation_status").default("confirmed").notNull(), // confirmed, disputed
  disputeReason: text("dispute_reason"),
  customerComment: text("customer_comment"),
  signatureUrl: text("signature_url"),
  confirmedByName: text("confirmed_by_name"),
  confirmedByEmail: text("confirmed_by_email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_visit_confirm_work_order").on(table.workOrderId),
  index("idx_visit_confirm_customer").on(table.customerId),
]);

export const insertVisitConfirmationSchema = createInsertSchema(visitConfirmations).omit({ id: true, createdAt: true });
export type VisitConfirmation = typeof visitConfirmations.$inferSelect;
export type InsertVisitConfirmation = z.infer<typeof insertVisitConfirmationSchema>;

// Teknikerbetyg - kunden betygsätter teknikern efter utfört jobb
export const technicianRatings = pgTable("technician_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id),
  rating: integer("rating").notNull(), // 1-5 stjärnor
  comment: text("comment"),
  categories: jsonb("categories").default({}), // {punctuality: 5, quality: 4, professionalism: 5}
  isAnonymous: boolean("is_anonymous").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_rating_work_order").on(table.workOrderId),
  index("idx_rating_resource").on(table.resourceId),
  index("idx_rating_customer").on(table.customerId),
]);

export const insertTechnicianRatingSchema = createInsertSchema(technicianRatings).omit({ id: true, createdAt: true });
export type TechnicianRating = typeof technicianRatings.$inferSelect;
export type InsertTechnicianRating = z.infer<typeof insertTechnicianRatingSchema>;

// Kundportal-meddelanden - chatt mellan kund och tekniker
export const portalMessages = pgTable("portal_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id"),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id),
  senderType: text("sender_type").notNull(), // customer, technician, system
  senderId: varchar("sender_id"),
  senderName: text("sender_name"),
  message: text("message").notNull(),
  messageType: text("message_type").default("text"), // text, image, file, eta_update
  attachmentUrl: text("attachment_url"),
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_portal_msg_work_order").on(table.workOrderId),
  index("idx_portal_msg_customer").on(table.customerId),
  index("idx_portal_msg_resource").on(table.resourceId),
]);

export const insertPortalMessageSchema = createInsertSchema(portalMessages).omit({ id: true, createdAt: true });
export type PortalMessage = typeof portalMessages.$inferSelect;
export type InsertPortalMessage = z.infer<typeof insertPortalMessageSchema>;

// Tidsfönster för självbokning - tillgängliga tider för kunder att boka
export const selfBookingSlots = pgTable("self_booking_slots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id),
  teamId: varchar("team_id").references(() => teams.id),
  slotDate: timestamp("slot_date").notNull(),
  startTime: text("start_time").notNull(), // "08:00"
  endTime: text("end_time").notNull(), // "10:00"
  maxBookings: integer("max_bookings").default(1),
  currentBookings: integer("current_bookings").default(0),
  serviceTypes: jsonb("service_types").default([]), // ["extra_tomning", "container_byte"]
  areaZones: jsonb("area_zones").default([]), // Geografiska zoner som täcks
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: varchar("created_by").references(() => users.id),
}, (table) => [
  index("idx_booking_slot_date").on(table.slotDate),
  index("idx_booking_slot_resource").on(table.resourceId),
  index("idx_booking_slot_team").on(table.teamId),
]);

export const insertSelfBookingSlotSchema = createInsertSchema(selfBookingSlots).omit({ id: true, createdAt: true });
export type SelfBookingSlot = typeof selfBookingSlots.$inferSelect;
export type InsertSelfBookingSlot = z.infer<typeof insertSelfBookingSlotSchema>;

// Självbokningar - bokningar gjorda av kunder
export const selfBookings = pgTable("self_bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  slotId: varchar("slot_id").references(() => selfBookingSlots.id),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id),
  serviceType: text("service_type").notNull(),
  status: text("status").default("pending").notNull(), // pending, confirmed, cancelled, completed
  workOrderId: varchar("work_order_id"),
  customerNotes: text("customer_notes"),
  confirmedAt: timestamp("confirmed_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_self_booking_customer").on(table.customerId),
  index("idx_self_booking_slot").on(table.slotId),
  index("idx_self_booking_status").on(table.status),
]);

export const insertSelfBookingSchema = createInsertSchema(selfBookings).omit({ id: true, createdAt: true });
export type SelfBooking = typeof selfBookings.$inferSelect;
export type InsertSelfBooking = z.infer<typeof insertSelfBookingSchema>;

// Betygskategorier för teknikerbetyg
export const RATING_CATEGORIES = [
  "punctuality",    // Punktlighet
  "quality",        // Arbetskvalitet
  "professionalism", // Professionalism
  "communication",  // Kommunikation
  "cleanliness"     // Städning efter sig
] as const;
export type RatingCategory = typeof RATING_CATEGORIES[number];

export const RATING_CATEGORY_LABELS: Record<RatingCategory, string> = {
  punctuality: "Punktlighet",
  quality: "Arbetskvalitet",
  professionalism: "Professionalism",
  communication: "Kommunikation",
  cleanliness: "Städning efter sig"
};

export const apiUsageLogs = pgTable("api_usage_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id"),
  service: varchar("service", { length: 50 }).notNull(),
  endpoint: varchar("endpoint", { length: 200 }),
  method: varchar("method", { length: 50 }),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  units: integer("units").default(1),
  estimatedCostUsd: real("estimated_cost_usd"),
  model: varchar("model", { length: 100 }),
  statusCode: integer("status_code"),
  durationMs: integer("duration_ms"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_api_usage_tenant").on(table.tenantId),
  index("idx_api_usage_service").on(table.service),
  index("idx_api_usage_created").on(table.createdAt),
]);

export const insertApiUsageLogSchema = createInsertSchema(apiUsageLogs).omit({ id: true, createdAt: true });
export type InsertApiUsageLog = z.infer<typeof insertApiUsageLogSchema>;
export type ApiUsageLog = typeof apiUsageLogs.$inferSelect;

export const apiBudgets = pgTable("api_budgets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id"),
  service: varchar("service", { length: 50 }).notNull(),
  monthlyBudgetUsd: real("monthly_budget_usd").notNull(),
  alertThresholdPercent: integer("alert_threshold_percent").default(80),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertApiBudgetSchema = createInsertSchema(apiBudgets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApiBudget = z.infer<typeof insertApiBudgetSchema>;
export type ApiBudget = typeof apiBudgets.$inferSelect;

export const INSPECTION_TYPES = ["door", "lock", "window", "lighting", "floor", "ceiling", "ventilation", "other"] as const;
export type InspectionType = typeof INSPECTION_TYPES[number];

export const INSPECTION_STATUSES = ["ok", "warning", "error"] as const;
export type InspectionStatus = typeof INSPECTION_STATUSES[number];

export const INSPECTION_TYPE_LABELS: Record<string, string> = {
  door: 'Dörr',
  lock: 'Lås',
  window: 'Fönster',
  lighting: 'Belysning',
  floor: 'Golv',
  ceiling: 'Tak',
  ventilation: 'Ventilation',
  other: 'Övrigt',
};

export const INSPECTION_STATUS_LABELS: Record<string, string> = {
  ok: 'OK',
  warning: 'Varning',
  error: 'Fel',
};

export const inspectionMetadata = pgTable("inspection_metadata", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  inspectionType: text("inspection_type").notNull(),
  status: text("status").notNull(),
  issues: jsonb("issues").default([]),
  comment: text("comment"),
  photoUrls: jsonb("photo_urls").default([]),
  inspectedBy: varchar("inspected_by"),
  inspectedAt: timestamp("inspected_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_inspection_meta_tenant").on(table.tenantId),
  index("idx_inspection_meta_object").on(table.objectId),
  index("idx_inspection_meta_type").on(table.inspectionType),
]);

export const insertInspectionMetadataSchema = createInsertSchema(inspectionMetadata).omit({ id: true, createdAt: true });
export type InsertInspectionMetadata = z.infer<typeof insertInspectionMetadataSchema>;
export type InspectionMetadata = typeof inspectionMetadata.$inferSelect;

export const customerCommunications = pgTable("customer_communications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id),
  customerId: varchar("customer_id").references(() => customers.id),
  objectId: varchar("object_id").references(() => objects.id),
  channel: text("channel").notNull(),
  notificationType: text("notification_type").notNull(),
  recipientName: text("recipient_name"),
  recipientEmail: text("recipient_email"),
  recipientPhone: text("recipient_phone"),
  subject: text("subject"),
  message: text("message").notNull(),
  aiGenerated: boolean("ai_generated").default(false),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_customer_comm_tenant").on(table.tenantId),
  index("idx_customer_comm_work_order").on(table.workOrderId),
]);

export const insertCustomerCommunicationSchema = createInsertSchema(customerCommunications).omit({ id: true, createdAt: true });
export type InsertCustomerCommunication = z.infer<typeof insertCustomerCommunicationSchema>;
export type CustomerCommunication = typeof customerCommunications.$inferSelect;

export const checklistTemplates = pgTable("checklist_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  articleType: text("article_type").notNull(),
  questions: jsonb("questions").default([]).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_checklist_tpl_tenant").on(table.tenantId),
  index("idx_checklist_tpl_article_type").on(table.tenantId, table.articleType),
]);

export const insertChecklistTemplateSchema = createInsertSchema(checklistTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChecklistTemplate = z.infer<typeof insertChecklistTemplateSchema>;
export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;

export const driverNotifications = pgTable("driver_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  resourceId: varchar("resource_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  orderId: varchar("order_id"),
  data: jsonb("data").default({}),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_driver_notif_resource").on(table.resourceId, table.isRead),
  index("idx_driver_notif_tenant").on(table.tenantId),
]);

export const insertDriverNotificationSchema = createInsertSchema(driverNotifications).omit({ id: true, createdAt: true });
export type InsertDriverNotification = z.infer<typeof insertDriverNotificationSchema>;
export type DriverNotification = typeof driverNotifications.$inferSelect;

export const offlineSyncLog = pgTable("offline_sync_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  resourceId: varchar("resource_id").notNull(),
  clientId: text("client_id").notNull(),
  actionType: text("action_type").notNull(),
  payload: jsonb("payload").default({}).notNull(),
  status: text("status").default("pending").notNull(),
  errorMessage: text("error_message"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_sync_log_resource").on(table.resourceId, table.status),
  index("idx_sync_log_tenant").on(table.tenantId),
]);

export const insertOfflineSyncLogSchema = createInsertSchema(offlineSyncLog).omit({ id: true, createdAt: true, processedAt: true });
export type InsertOfflineSyncLog = z.infer<typeof insertOfflineSyncLogSchema>;
export type OfflineSyncLog = typeof offlineSyncLog.$inferSelect;

// ============================================
// FLEET MANAGEMENT - Bränslelogg & Underhållslogg
// ============================================

export const fuelLogs = pgTable("fuel_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id).notNull(),
  date: timestamp("date").notNull(),
  liters: real("liters").notNull(),
  costSek: real("cost_sek"),
  pricePerLiter: real("price_per_liter"),
  fuelType: text("fuel_type").default("diesel"),
  odometerReading: integer("odometer_reading"),
  fullTank: boolean("full_tank").default(true),
  station: text("station"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_fuel_logs_vehicle").on(table.vehicleId),
  index("idx_fuel_logs_date").on(table.date),
]);

export const insertFuelLogSchema = createInsertSchema(fuelLogs).omit({ id: true, createdAt: true });
export type FuelLog = typeof fuelLogs.$inferSelect;
export type InsertFuelLog = z.infer<typeof insertFuelLogSchema>;

export const maintenanceLogs = pgTable("maintenance_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id).notNull(),
  date: timestamp("date").notNull(),
  maintenanceType: text("maintenance_type").notNull(),
  description: text("description").notNull(),
  costSek: real("cost_sek"),
  odometerReading: integer("odometer_reading"),
  workshop: text("workshop"),
  nextMaintenanceDate: timestamp("next_maintenance_date"),
  nextMaintenanceOdometer: integer("next_maintenance_odometer"),
  status: text("status").default("completed").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_maintenance_logs_vehicle").on(table.vehicleId),
  index("idx_maintenance_logs_date").on(table.date),
]);

export const MAINTENANCE_TYPES = [
  "service", "reparation", "besiktning", "dack", "olja", "bromsar", "annat"
] as const;

export const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
  service: "Service",
  reparation: "Reparation",
  besiktning: "Besiktning",
  dack: "Däckbyte",
  olja: "Oljebyte",
  bromsar: "Bromsar",
  annat: "Annat",
};

export const insertMaintenanceLogSchema = createInsertSchema(maintenanceLogs).omit({ id: true, createdAt: true });
export type MaintenanceLog = typeof maintenanceLogs.$inferSelect;
export type InsertMaintenanceLog = z.infer<typeof insertMaintenanceLogSchema>;

export const resourceProfiles = pgTable("resource_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  executionCodes: text("execution_codes").array().default([]),
  equipmentTypes: text("equipment_types").array().default([]),
  defaultCostCenter: text("default_cost_center"),
  projectCode: text("project_code"),
  serviceArea: text("service_area").array().default([]),
  color: text("color").default("#3B82F6"),
  icon: text("icon").default("wrench"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_resource_profiles_tenant").on(table.tenantId),
]);

export const insertResourceProfileSchema = createInsertSchema(resourceProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertResourceProfile = z.infer<typeof insertResourceProfileSchema>;
export type ResourceProfile = typeof resourceProfiles.$inferSelect;

export const resourceProfileAssignments = pgTable("resource_profile_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  profileId: varchar("profile_id").references(() => resourceProfiles.id).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_rpa_tenant").on(table.tenantId),
  index("idx_rpa_profile").on(table.profileId),
  index("idx_rpa_resource").on(table.resourceId),
]);

export const insertResourceProfileAssignmentSchema = createInsertSchema(resourceProfileAssignments).omit({ id: true, createdAt: true });
export type InsertResourceProfileAssignment = z.infer<typeof insertResourceProfileAssignmentSchema>;
export type ResourceProfileAssignment = typeof resourceProfileAssignments.$inferSelect;

export const WORK_SESSION_STATUSES = ["active", "paused", "completed"] as const;
export type WorkSessionStatus = typeof WORK_SESSION_STATUSES[number];

export const WORK_ENTRY_TYPES = ["work", "travel", "setup", "break", "rest"] as const;
export type WorkEntryType = typeof WORK_ENTRY_TYPES[number];

export const workSessions = pgTable("work_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  teamId: varchar("team_id").references(() => teams.id),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  date: timestamp("date").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  status: text("status").default("active").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_work_sessions_tenant").on(table.tenantId),
  index("idx_work_sessions_resource").on(table.resourceId),
  index("idx_work_sessions_date").on(table.date),
  index("idx_work_sessions_team").on(table.teamId),
]);

export const insertWorkSessionSchema = createInsertSchema(workSessions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkSession = z.infer<typeof insertWorkSessionSchema>;
export type WorkSession = typeof workSessions.$inferSelect;

export const workEntries = pgTable("work_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workSessionId: varchar("work_session_id").references(() => workSessions.id).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  entryType: text("entry_type").default("work").notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  durationMinutes: integer("duration_minutes"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_work_entries_session").on(table.workSessionId),
  index("idx_work_entries_resource").on(table.resourceId),
  index("idx_work_entries_type").on(table.entryType),
]);

export const insertWorkEntrySchema = createInsertSchema(workEntries).omit({ id: true, createdAt: true });
export type InsertWorkEntry = z.infer<typeof insertWorkEntrySchema>;
export type WorkEntry = typeof workEntries.$inferSelect;

export const timeLogs = pgTable("time_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  week: integer("week").notNull(),
  year: integer("year").notNull(),
  work: integer("work").default(0).notNull(),
  travel: integer("travel").default(0).notNull(),
  setup: integer("setup").default(0).notNull(),
  breakTime: integer("break_time").default(0).notNull(),
  rest: integer("rest").default(0).notNull(),
  total: integer("total").default(0).notNull(),
  budgetHours: integer("budget_hours").default(40).notNull(),
  resourceName: varchar("resource_name", { length: 255 }).default("").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_time_logs_tenant").on(table.tenantId),
  index("idx_time_logs_resource_week").on(table.resourceId, table.year, table.week),
]);

export const insertTimeLogSchema = createInsertSchema(timeLogs).omit({ id: true, updatedAt: true });
export type InsertTimeLog = z.infer<typeof insertTimeLogSchema>;
export type TimeLog = typeof timeLogs.$inferSelect;

export const equipmentBookings = pgTable("equipment_bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id),
  equipmentId: varchar("equipment_id").references(() => equipment.id),
  resourceId: varchar("resource_id").references(() => resources.id),
  teamId: varchar("team_id").references(() => teams.id),
  workSessionId: varchar("work_session_id").references(() => workSessions.id),
  date: timestamp("date").notNull(),
  serviceArea: text("service_area").array().default([]),
  status: text("status").default("active").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_equipment_bookings_tenant_date").on(table.tenantId, table.date),
  index("idx_equipment_bookings_vehicle").on(table.vehicleId, table.date),
  index("idx_equipment_bookings_equipment").on(table.equipmentId, table.date),
]);

export const insertEquipmentBookingSchema = createInsertSchema(equipmentBookings).omit({ id: true, createdAt: true });
export type InsertEquipmentBooking = z.infer<typeof insertEquipmentBookingSchema>;
export type EquipmentBooking = typeof equipmentBookings.$inferSelect;

export const iotDevices = pgTable("iot_devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  deviceType: text("device_type").notNull(),
  externalDeviceId: varchar("external_device_id", { length: 255 }),
  lastSignal: text("last_signal"),
  lastSignalAt: timestamp("last_signal_at"),
  batteryLevel: integer("battery_level"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_iot_devices_tenant").on(table.tenantId),
  index("idx_iot_devices_object").on(table.objectId),
  uniqueIndex("idx_iot_devices_external").on(table.tenantId, table.externalDeviceId),
]);

export const insertIotDeviceSchema = createInsertSchema(iotDevices).omit({ id: true, createdAt: true });
export type InsertIotDevice = z.infer<typeof insertIotDeviceSchema>;
export type IotDevice = typeof iotDevices.$inferSelect;

export const iotApiKeys = pgTable("iot_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  apiKey: varchar("api_key", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  status: text("status").default("active").notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_iot_api_keys_tenant").on(table.tenantId),
  index("idx_iot_api_keys_key").on(table.apiKey),
]);

export const insertIotApiKeySchema = createInsertSchema(iotApiKeys).omit({ id: true, createdAt: true, lastUsedAt: true });
export type InsertIotApiKey = z.infer<typeof insertIotApiKeySchema>;
export type IotApiKey = typeof iotApiKeys.$inferSelect;

export const iotSignals = pgTable("iot_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  deviceId: varchar("device_id").references(() => iotDevices.id).notNull(),
  signalType: text("signal_type").notNull(),
  payload: text("payload"),
  processed: boolean("processed").default(false).notNull(),
  workOrderId: varchar("work_order_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_iot_signals_device").on(table.deviceId),
  index("idx_iot_signals_tenant").on(table.tenantId, table.createdAt),
]);

export const insertIotSignalSchema = createInsertSchema(iotSignals).omit({ id: true, createdAt: true });
export type InsertIotSignal = z.infer<typeof insertIotSignalSchema>;
export type IotSignal = typeof iotSignals.$inferSelect;

// ============================================
// Route Feedback — drivers rate daily routes
// ============================================
export const routeFeedback = pgTable("route_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  resourceId: varchar("resource_id").notNull(),
  date: varchar("date").notNull(),
  rating: integer("rating").notNull(),
  reasonCategory: varchar("reason_category"),
  freeText: text("free_text"),
  workSessionId: varchar("work_session_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_route_feedback_tenant").on(table.tenantId, table.date),
  index("idx_route_feedback_resource").on(table.resourceId, table.date),
  uniqueIndex("idx_route_feedback_unique_daily").on(table.tenantId, table.resourceId, table.date),
]);

export const insertRouteFeedbackSchema = createInsertSchema(routeFeedback).omit({ id: true, createdAt: true });
export type InsertRouteFeedback = z.infer<typeof insertRouteFeedbackSchema>;
export type RouteFeedback = typeof routeFeedback.$inferSelect;

// ============================================
// Import Batches — persist import history with scorecard metadata
// ============================================
export const importBatches = pgTable("import_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  batchId: varchar("batch_id").notNull(),
  totalRows: integer("total_rows").default(0),
  created: integer("created").default(0),
  updated: integer("updated").default(0),
  errors: integer("errors").default(0),
  scorecardSummary: jsonb("scorecard_summary"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_import_batches_tenant").on(table.tenantId),
  uniqueIndex("idx_import_batches_batch_id").on(table.batchId),
]);

export const insertImportBatchSchema = createInsertSchema(importBatches).omit({ id: true, createdAt: true });
export type InsertImportBatch = z.infer<typeof insertImportBatchSchema>;
export type ImportBatch = typeof importBatches.$inferSelect;

// ============================================
// Tenant Labels — branschanpassad terminologi
// ============================================
export const tenantLabels = pgTable("tenant_labels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  labelKey: varchar("label_key", { length: 100 }).notNull(),
  labelValue: text("label_value").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_tenant_labels_tenant").on(table.tenantId),
  uniqueIndex("idx_tenant_labels_unique").on(table.tenantId, table.labelKey),
]);

export const insertTenantLabelSchema = createInsertSchema(tenantLabels).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenantLabel = z.infer<typeof insertTenantLabelSchema>;
export type TenantLabel = typeof tenantLabels.$inferSelect;

export const DEFAULT_TERMINOLOGY: Record<string, string> = {
  object_singular: "Objekt",
  object_plural: "Objekt",
  work_order_singular: "Uppgift",
  work_order_plural: "Uppgifter",
  resource_singular: "Resurs",
  resource_plural: "Resurser",
  customer_singular: "Kund",
  customer_plural: "Kunder",
  cluster_singular: "Kluster",
  cluster_plural: "Kluster",
  article_singular: "Artikel",
  article_plural: "Artiklar",
  vehicle_singular: "Fordon",
  vehicle_plural: "Fordon",
  container_singular: "Kärl",
  container_plural: "Kärl",
  route_singular: "Rutt",
  route_plural: "Rutter",
  asset_type: "Objekttyp",
  service_area: "Serviceområde",
  inspection_singular: "Besiktning",
  inspection_plural: "Besiktningar",
};

export const INDUSTRY_TERMINOLOGY: Record<string, Record<string, string>> = {
  waste_management: {
    object_singular: "Kärl",
    object_plural: "Kärl",
    container_singular: "Kärl",
    container_plural: "Kärl",
    asset_type: "Kärltyp",
    service_area: "Hämtområde",
    inspection_singular: "Kontroll",
    inspection_plural: "Kontroller",
  },
  property_maintenance: {
    object_singular: "Fastighet",
    object_plural: "Fastigheter",
    container_singular: "Enhet",
    container_plural: "Enheter",
    asset_type: "Fastighetstyp",
    service_area: "Förvaltningsområde",
    work_order_singular: "Ärende",
    work_order_plural: "Ärenden",
    inspection_singular: "Besiktning",
    inspection_plural: "Besiktningar",
  },
  cleaning: {
    object_singular: "Lokal",
    object_plural: "Lokaler",
    container_singular: "Yta",
    container_plural: "Ytor",
    asset_type: "Lokaltyp",
    service_area: "Städområde",
    work_order_singular: "Uppdrag",
    work_order_plural: "Uppdrag",
    inspection_singular: "Kvalitetskontroll",
    inspection_plural: "Kvalitetskontroller",
  },
};

// Annual Goals - Årsmål per kund/objekt
export const annualGoals = pgTable("annual_goals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id),
  objectId: varchar("object_id").references(() => objects.id),
  clusterId: varchar("cluster_id").references(() => clusters.id),
  articleType: text("article_type").notNull(),
  targetCount: integer("target_count").notNull(),
  year: integer("year").notNull(),
  notes: text("notes"),
  sourceType: text("source_type").default("manual"),
  sourceId: varchar("source_id"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_annual_goals_tenant").on(table.tenantId),
  index("idx_annual_goals_tenant_year").on(table.tenantId, table.year),
  index("idx_annual_goals_customer").on(table.customerId),
  index("idx_annual_goals_object").on(table.objectId),
  index("idx_annual_goals_cluster").on(table.clusterId),
]);

export const annualGoalsRelations = relations(annualGoals, ({ one }) => ({
  tenant: one(tenants, { fields: [annualGoals.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [annualGoals.customerId], references: [customers.id] }),
  object: one(objects, { fields: [annualGoals.objectId], references: [objects.id] }),
  cluster: one(clusters, { fields: [annualGoals.clusterId], references: [clusters.id] }),
}));

export const insertAnnualGoalSchema = createInsertSchema(annualGoals).omit({ id: true, createdAt: true });
export type AnnualGoal = typeof annualGoals.$inferSelect;
export type InsertAnnualGoal = z.infer<typeof insertAnnualGoalSchema>;

export const predictiveForecasts = pgTable("predictive_forecasts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  deviceId: varchar("device_id").references(() => iotDevices.id),
  predictedDate: timestamp("predicted_date").notNull(),
  confidence: real("confidence").notNull(),
  avgIntervalDays: real("avg_interval_days"),
  signalCount: integer("signal_count").default(0),
  lastSignalAt: timestamp("last_signal_at"),
  reasoning: text("reasoning"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_predictive_forecasts_tenant").on(table.tenantId),
  index("idx_predictive_forecasts_object").on(table.objectId),
  index("idx_predictive_forecasts_date").on(table.predictedDate),
]);

export const insertPredictiveForecastSchema = createInsertSchema(predictiveForecasts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPredictiveForecast = z.infer<typeof insertPredictiveForecastSchema>;
export type PredictiveForecast = typeof predictiveForecasts.$inferSelect;

export type TimeSummaryResponse = {
  week: number;
  year: number;
  summaries: Array<{
    resourceId: string;
    resourceName: string;
    work: number;
    travel: number;
    setup: number;
    break_time: number;
    rest: number;
    total: number;
    budgetHours: number;
  }>;
  nightRestViolations: Array<{ resourceId: string; resourceName: string; date: string; restHours: number }>;
  weeklyRestViolations: Array<{ resourceId: string; resourceName: string; totalRestHours: number }>;
};

export const tenantFeatures = pgTable("tenant_features", {
  tenantId: varchar("tenant_id", { length: 255 }).primaryKey().references(() => tenants.id),
  packageTier: varchar("package_tier", { length: 50 }).notNull().default("premium"),
  enabledModules: text("enabled_modules").array().notNull().default(sql`ARRAY['core','iot','annual_planning','ai_planning','fleet','environmental','customer_portal','invoicing','predictive','work_sessions','order_concepts','inspections','sms','route_feedback','equipment_sharing','roi_reports']::text[]`),
  customOverrides: jsonb("custom_overrides").default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: varchar("updated_by", { length: 255 }),
});

export const featureAuditLog = pgTable("feature_audit_log", {
  id: serial("id").primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  previousTier: varchar("previous_tier", { length: 50 }),
  newTier: varchar("new_tier", { length: 50 }).notNull(),
  previousModules: text("previous_modules").array(),
  newModules: text("new_modules").array().notNull(),
  changedBy: varchar("changed_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const planningDecisionLog = pgTable("planning_decision_log", {
  id: serial("id").primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 255 }),
  weekStart: varchar("week_start", { length: 10 }).notNull(),
  weekEnd: varchar("week_end", { length: 10 }).notNull(),
  summary: jsonb("summary").notNull(),
  moveCount: integer("move_count").notNull().default(0),
  violationCount: integer("violation_count").notNull().default(0),
  riskScore: real("risk_score").default(0),
  totalOrdersScheduled: integer("total_orders_scheduled").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PlanningDecisionLog = typeof planningDecisionLog.$inferSelect;

export const budgetAlertLog = pgTable("budget_alert_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  thresholdPercent: integer("threshold_percent").notNull(),
  currentUsageUsd: real("current_usage_usd").notNull(),
  monthlyBudgetUsd: real("monthly_budget_usd").notNull(),
  percentUsed: real("percent_used").notNull(),
  monthKey: varchar("month_key", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_budget_alert_tenant_month").on(table.tenantId, table.monthKey),
]);

export type BudgetAlertLog = typeof budgetAlertLog.$inferSelect;

export const schedulingLocks = pgTable("scheduling_locks", {
  tenantId: varchar("tenant_id").primaryKey(),
  acquiredAt: timestamp("acquired_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const roiShareTokens = pgTable("roi_share_tokens", {
  token: varchar("token", { length: 64 }).primaryKey(),
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  customerId: varchar("customer_id", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
