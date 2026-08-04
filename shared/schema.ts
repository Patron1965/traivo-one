import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, serial, timestamp, date, jsonb, boolean, real, doublePrecision, index, unique, uniqueIndex, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { FrozenTimeRulePackage } from "./delivery-restrictions";
import type { Uppgiftspaket } from "./uppgift-contract";

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
  // IANA-tidszon (t.ex. "Europe/Stockholm"). Nullable → applikationen
  // använder default Europe/Stockholm för scheduler-tidpunkter.
  timezone: text("timezone"),
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

// ADR v3 §2.2: hierarchy_type är en self-deklarerad nivå-etikett på en
// kund-nod. NULL = "fristående" (back-compat). Värdena är fria — UI:t
// väljer endast bland CUSTOMER_HIERARCHY_TYPES, men DB:n låser inte
// strängen så framtida nivåer kan läggas till utan migration.
export const CUSTOMER_HIERARCHY_TYPES = ["koncern", "region", "lokal"] as const;
export type CustomerHierarchyType = typeof CUSTOMER_HIERARCHY_TYPES[number];

// ADR v3 §2.2: icke-ägar-relationer mellan kunder. Återförsäljare,
// "beställer-åt", servicepartner. Skild från `parent_customer_id`-trädet.
export const CUSTOMER_RELATIONSHIP_TYPES = [
  "reseller_for",
  "orders_on_behalf",
  "service_partner",
] as const;
export type CustomerRelationshipType = typeof CUSTOMER_RELATIONSHIP_TYPES[number];

export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  customerNumber: text("customer_number"),
  orgNumber: text("org_number"),
  contactPerson: text("contact_person"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  postalCode: text("postal_code"),
  invoiceEmail: text("invoice_email"),
  invoiceAddress: text("invoice_address"),
  invoicePostalCode: text("invoice_postal_code"),
  invoiceCity: text("invoice_city"),
  notes: text("notes"),
  // Stående leveranspreferenser (slottider, blockerade tider, anteckningar) - används som
  // fallback när objekt saknar egen `deliveryPreferences`. Struktur valideras av
  // deliveryPreferencesSchema.
  deliveryPreferences: jsonb("delivery_preferences"),
  // ADR v3 §2.2: kundhierarki (koncern → region → lokal). Self-FK ger
  // strikt träd; NULL = fristående kund (back-compat default).
  // Cykelförbud enforce:as i applikationslagret (server/storage.ts).
  parentCustomerId: varchar("parent_customer_id").references((): any => customers.id),
  hierarchyType: varchar("hierarchy_type", { length: 20 }),
  isReseller: boolean("is_reseller").default(false),
  importBatchId: text("import_batch_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_customers_tenant").on(table.tenantId),
  index("idx_customers_tenant_name").on(table.tenantId, table.name),
  index("idx_customers_tenant_created").on(table.tenantId, table.createdAt),
  index("idx_customers_parent").on(table.tenantId, table.parentCustomerId),
]);

// ADR v3 §2.2: icke-ägar-relationer (återförsäljare, agent, beställer-åt).
// Skild från parent-trädet — en återförsäljare *beställer åt* en kund,
// men *äger inte* kunden i hierarkin. Tidsbestämd via valid_from/valid_to.
export const customerRelationships = pgTable("customer_relationships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  fromCustomerId: varchar("from_customer_id").references(() => customers.id, { onDelete: "cascade" }).notNull(),
  toCustomerId: varchar("to_customer_id").references(() => customers.id, { onDelete: "cascade" }).notNull(),
  relationshipType: varchar("relationship_type", { length: 30 }).notNull(),
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_cust_rel_tenant_from").on(table.tenantId, table.fromCustomerId),
  index("idx_cust_rel_tenant_to").on(table.tenantId, table.toCustomerId),
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

// Task #990: objektets platsmodell. Platstyp styr hur motor/UI behandlar objektet:
//  - "pinpoint": exakt koordinat krävs; objektet är ruttbart.
//  - "area":     område (t.ex. "Söderort"); ev. ungefärlig centroid för kartvisning
//                men ALDRIG ruttbart (motorn ska inte gissa en exakt punkt).
//  - "none":     ingen geografi alls.
// Kolumnen är nullable utan default → legacy-rader (NULL) får effektiv typ härledd i
// server/services/object-location.ts (koordinat⇒pinpoint, polyline⇒area, annars none).
export const OBJECT_LOCATION_TYPES = ["pinpoint", "area", "none"] as const;
export type ObjectLocationType = (typeof OBJECT_LOCATION_TYPES)[number];

// Platskrav (§5 A) — uppgiftens geografiska krav. Härleds från taskCategory när
// kolumnen är NULL (field→obligatorisk, admin/logistics→ingen); 'valfri' är det
// nya uttrycket (t.ex. egentid som ibland har en geo-position). Se
// shared/location-requirement.ts för härledningen.
export const LOCATION_REQUIREMENTS = ["obligatorisk", "valfri", "ingen"] as const;
export type LocationRequirement = (typeof LOCATION_REQUIREMENTS)[number];

export const objects = pgTable("objects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // ADR v3: objekt är kund-neutrala. Den legacy `customer_id`-kolumnen är
  // BORTTAGEN (kontraktsfas) — auktoritativ kundkoppling sker via `object_payers`
  // (primär betalare) / `work_orders.customer_id`. API-kontraktet `object.customerId`
  // bevaras oförändrat som en overlay (se primaryPayerCustomerIdSql /
  // objectColumnsWithPrimaryCustomer i storage-läsvägarna).
  parentId: varchar("parent_id").references((): any => objects.id),
  name: text("name").notNull(),
  // Task #634: språkmärkta visningsnamn (t.ex. {sv,en,fi}) parallellt med det
  // interna namnet ovan. Påverkar ALDRIG `name` (kolumn E) eller släktnamns-
  // genereringen — används enbart för lokaliserat visningsnamn med fallback till
  // `name`. Skrivs av objektmall-importen via `namn_<lang>`-kolumner.
  nameTranslations: jsonb("name_translations"),
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
  // Task #990: platstyp (pinpoint/area/none). Nullable utan default → NULL härleds.
  // Se OBJECT_LOCATION_TYPES ovan och server/services/object-location.ts.
  locationType: text("location_type"),
  
  // Etapp 5 (Task #1217): åtkomst-/tidspreferens-/kärl-/individ-specialkolumnerna
  // är borttagna — informationen bor nu i metadata_katalog/metadata_varden
  // (t.ex. 'Åtkomsttyp', 'Åtkomstkod', 'Nyckelnummer', 'Antal kärl', 'Ställtid').
  articleId: varchar("article_id"), // Kopplad artikeltyp
  // Djup i hierarkin (0 = rot, 1 = barn till rot, etc.)
  hierarchyDepth: integer("hierarchy_depth").default(0),
  // Fullständig sökväg i hierarkin (array av object IDs från rot)
  hierarchyPath: text("hierarchy_path").array().default([]),
  
  isInterimObject: boolean("is_interim_object").default(false).notNull(),
  
  polylineData: jsonb("polyline_data"),
  
  status: text("status").default("active").notNull(),
  lastServiceDate: timestamp("last_service_date"),
  importBatchId: text("import_batch_id"),
  // === RECONCILIATION (årlig kundfastighetslista) ===
  // Sätts av customer-fastighetslista-importen när ett objekt finns i Traivo men
  // saknas i den uppladdade fastighetslistan. Inget ändras automatiskt — bara flagga
  // för manuell granskning. Värde t.ex. "missing_in_fastighetslista".
  reconciliationFlag: text("reconciliation_flag"),
  reconciliationFlaggedAt: timestamp("reconciliation_flagged_at"),
  reconciliationBatchId: text("reconciliation_batch_id"),
  // === ARKIVERING (task #552) ===
  // Vem som arkiverade (user id) och varför. `deletedAt` används fortfarande som
  // soft-delete-markör; dessa fält är metadata på arkiveringen för spårbarhet
  // och för "återställ"-flödet.
  archivedBy: varchar("archived_by"),
  archivedReason: text("archived_reason"),
  // === Task #710: PER-OBJEKT METADATA-SORTERINGSORDNING ===
  // Ordnad lista av metadata_katalog-id:n som styr i vilken ordning metadata-fält
  // visas på just detta objekt (Session 7 §4 steg 3). Sorteringen ärvs NEDÅT:
  // ett barn utan egen ordning använder närmaste förälders ordning i hierarkin,
  // aldrig uppåt. NULL = ingen egen ordning (fall tillbaka på katalog-ordning /
  // ärvd ordning). Expand-contract: nullable.
  metadataFieldOrder: jsonb("metadata_field_order"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_objects_tenant").on(table.tenantId),
  index("idx_objects_parent").on(table.parentId),
  index("idx_objects_object_number").on(table.objectNumber),
  index("idx_objects_interim").on(table.tenantId, table.isInterimObject),
  index("idx_objects_tenant_deleted").on(table.tenantId, table.deletedAt),
  index("idx_objects_tenant_objnumber").on(table.tenantId, table.objectNumber),
  index("idx_objects_tenant_name").on(table.tenantId, table.name),
]);

export const resources = pgTable("resources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'set null' }),
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
  isOnline: boolean("is_online").default(false),
  lastSeenAt: timestamp("last_seen_at"),
  status: text("status").default("active").notNull(),
  // SMS-preferenser (på som default för nya tekniker)
  smsOnScheduleSend: boolean("sms_on_schedule_send").default(true).notNull(),
  smsOnExtraJob: boolean("sms_on_extra_job").default(true).notNull(),
  // Senast publicerade schemaperiod (för att detektera "extrajobb" inom redan publicerad vecka)
  lastSchedulePublishedAt: timestamp("last_schedule_published_at"),
  lastSchedulePeriodStart: text("last_schedule_period_start"),
  lastSchedulePeriodEnd: text("last_schedule_period_end"),
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
  // Objekt som ordern utförs på. Nullable för administrativa uppgifter (task #381)
  // som inte kräver fysiskt objekt (t.ex. förhandsavisering, kodkontroll).
  objectId: varchar("object_id").references(() => objects.id),
  // Uppgiftskategori — styr filtrering i VRP/karta/avstånd. Cachat värde
  // som ärvs från order_concept_articles vid expansion (ändras aldrig efter).
  // Värden: 'field' (fältuppgift, default), 'admin' (administrativ),
  // 'logistics' (logistik utan objekt).
  taskCategory: text("task_category").default("field").notNull(),
  // Platskrav (§5 A) — obligatorisk/valfri/ingen. Nullable (expand-contract):
  // NULL härleds från taskCategory via resolveLocationRequirement(). Ärvs från
  // order_concept_articles vid expansion.
  locationRequirement: text("location_requirement"),
  // Legacy-kluster (Etapp 5: clusters-tabellen borttagen; kolumnen behålls
  // expand-contract för VRP/plumbing — ingen FK längre).
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
  // Task #1205 (fält 54): läsbar matchningsorsak — VARFÖR objektet hakades på ett
  // orderkoncept (vilka villkor som matchade), snapshotad vid expansion. Nullable
  // (expand-contract): historiska/manuella uppgifter saknar värdet och visar "—".
  matchReason: text("match_reason"),
  scheduledDate: timestamp("scheduled_date"),
  scheduledStartTime: text("scheduled_start_time"),
  // Önskad leveransperiod (sätts av planerare/kund — mjuk preferens, ej hårt villkor)
  desiredDeliveryStart: timestamp("desired_delivery_start"),
  desiredDeliveryEnd: timestamp("desired_delivery_end"),
  // Planerat tidsfönster för optimering
  plannedWindowStart: timestamp("planned_window_start"),
  plannedWindowEnd: timestamp("planned_window_end"),
  estimatedDuration: integer("estimated_duration").default(60),
  actualDuration: integer("actual_duration"),
  // Task #1236: verklig tid för en klumpuppgift fördelas proportionerligt (mot
  // estimatedDuration) över uppgifterna i klumpen — se server/services/
  // actual-time-distribution.ts. actualTimeGroupKey är en opak nyckel (samma
  // konvention som slot_times.assignmentGroupKey) som binder ihop uppgifterna i
  // en fördelning; NULL = ej klumpfördelad (oförändrat beteende). manuell=true
  // låser raden mot framtida auto-omfördelning tills fördelningen görs om.
  actualTimeGroupKey: text("actual_time_group_key"),
  actualDurationManual: boolean("actual_duration_manual").default(false).notNull(),
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
  // === Task #941 (GAP-202): Fångad bil/utrustning + deltagare vid klarmarkering ===
  // Sätts vid klarmarkering i fält så att kostnadsställe (bilens/utrustningens
  // costCenter) och projektkod (utförarens projectCode) kan härledas automatiskt
  // till Fortnox-exporten. Alla nullable (expand-contract) — befintliga WO utan
  // fångad data exporteras som idag. Manuell override på exporten kvarstår.
  completedVehicleId: varchar("completed_vehicle_id").references((): any => vehicles.id, { onDelete: "set null" }),
  completedEquipmentId: varchar("completed_equipment_id").references((): any => equipment.id, { onDelete: "set null" }),
  // Registreringsnummer som rapporterats från fält (back-compat/visning även om
  // ingen fordonspost matchar reg.nr).
  completedVehicleRegNo: text("completed_vehicle_reg_no"),
  // Resurs-id:n för de utförare (team/personer) som faktiskt utförde uppgiften.
  completedParticipantIds: text("completed_participant_ids").array(),
  // ============================================
  // UTÖKADE METADATAFÄLT (Fas 1B)
  // ============================================
  // 8-stegs utförandestatus: not_planned, planned_rough, planned_fine, on_way, on_site, completed, inspected, invoiced
  executionStatus: text("execution_status").default("not_planned"),
  // Skapandemetod: manual, import, external_report, performer, automatic
  creationMethod: text("creation_method").default("manual"),
  // Strukturartikel-ID om uppgiften skapades av en strukturartikel
  structuralArticleId: varchar("structural_article_id"),
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
  // Cachat resultat av jämförelsen mellan plannedWindowStart/End och kundens/objektets
  // effektiva leveranspreferens. true = ordern ligger utanför önskat fönster.
  // Beräknas i POST/PATCH /api/work-orders.
  outsidePreferredWindow: boolean("outside_preferred_window").default(false),
  // Cachad priority från effektiv leveranspreferens ("strict" | "preferred").
  // Används av planner-UI för att färgkoda outsidePreferredWindow-badgen
  // (röd för strict, gul för preferred). Skrivs av POST/PATCH /api/work-orders.
  deliveryPreferencePriority: text("delivery_preference_priority"),
  importBatchId: text("import_batch_id"),
  etaSmsSent: boolean("eta_sms_sent").default(false),
  // Mjuk länk till huvudjobbet om denna order är en förberedande/följande offset-uppgift
  // (skapad från artikel med offset_minutes != 0). Sätts vid expand av orderkoncept.
  // Mjuk länk: om huvudjobbet raderas blir parent null (set null), inte cascade.
  parentWorkOrderId: varchar("parent_work_order_id").references((): any => workOrders.id, { onDelete: "set null" }),
  // Task #836 (Fas 3): Kvittens av beroendeuppgift. Sätts när en beroendeartikels
  // tillgänglighet bekräftats; om NULL och artikeln kräver kvittens varnar systemet
  // (och huvuduppgiften bör ej utföras). dependencyCriticality kopieras till WO vid expand.
  dependencyAcknowledgedAt: timestamp("dependency_acknowledged_at"),
  dependencyAcknowledgedBy: varchar("dependency_acknowledged_by"),
  dependencyCriticality: text("dependency_criticality"),
  // Task #989: Logistik-roll på arbetsordern. NULL = vanlig uppgift (oförändrat beteende).
  // "pickup" = hämta på lagerplats, "deliver" = leverera på objekt, "return" = retur till lager.
  // Driver fältappens markeringar och retur-/hämtkedjor (parentWorkOrderId + task_dependencies).
  logisticsRole: text("logistics_role"),
  // Task #989: Fältmarkering "ej utlämnad / ska återtas". Sätts av operatören i fält och
  // triggar skapandet av en retur-uppgift tillbaka till artikelns lagerplats. Default false.
  returnToWarehouse: boolean("return_to_warehouse").default(false),
  // === ADR v3 (F5): Frozen snapshot vid expansion (immutabelt efter sättning) ===
  // Används för per-task-fakturering och retroaktiv omräkning vid metadata-ändring.
  // Befintliga 3 750 WO behåller NULL — fakturas via cachedValue/work_order_lines som idag.
  // Nya WO via expand sätter dessa från artikel + objektmetadata snapshot.
  frozenUnit: text("frozen_unit"),
  frozenQuantity: real("frozen_quantity"),
  frozenUnitPrice: real("frozen_unit_price"),
  frozenUnitCost: real("frozen_unit_cost"),
  frozenUnitTime: real("frozen_unit_time"),
  // Tidskod (time_code_definitions.key) fryst per uppgift vid expansion, kopierad från
  // artikelns timeCodeKey (admin/logistik-vägen; BOM/strukturella deluppgifter ärver
  // från förälder-WO). Grunden för finplanering + lön. Nullable (expand-contract).
  frozenTimeCode: text("frozen_time_code"),
  // Tidpunkt da snapshot las (audit + Traivo Go v2-kontrakt).
  frozenAt: timestamp("frozen_at"),
  // Snapshot av relevanta metadata-värden vid expansion (för audit/omräkning).
  metadataSnapshot: jsonb("metadata_snapshot"),
  // === Task #1215 (Etapp 3): Uppgiftspaketet — operativ arbetskopia ===
  // Fylls vid skapande (server/services/uppgiftspaket.ts) och uppdateras av
  // metadata-propageringen för öppna/framtida uppgifter. Frysta uppgifter
  // (isUppgiftFrozen via deriveUppgiftStatus) röres aldrig. Nullable
  // (expand-contract): legacy-rader utan paket beter sig som idag.
  uppgiftspaket: jsonb("uppgiftspaket").$type<Uppgiftspaket>(),
  // === ADR v3 §2.3 (Task #556): Frozen fakturamottagare ===
  // Vinnande mottagare bestäms vid expansion och fryses här. Fortnox-export
  // läser dessa fält och faller tillbaka till object_payers/objects.customer_id
  // när de är NULL (back-compat). invoice_conflict_flag sätts om resolver
  // upptäckte flera kandidater och operator inte hade pinnat valet.
  frozenInvoiceRecipientId: varchar("frozen_invoice_recipient_id"),
  frozenInvoiceLevel: text("frozen_invoice_level"),
  frozenInvoiceSourceCustomerId: varchar("frozen_invoice_source_customer_id"),
  invoiceConflictFlag: boolean("invoice_conflict_flag").default(false),
  // === ADR v3 §2.5 (Task #558): Konsoliderings-state ===
  // pending = redo att exporteras direkt, held = väntar på periodens stängning,
  // consolidated = har grupperats in i en customer_invoice, exported = skickad
  // till Fortnox. NULL = WO är inte redo att fakturera ännu (default).
  invoiceQueueState: text("invoice_queue_state"),
  invoiceReadyAt: timestamp("invoice_ready_at"),
  invoiceHeldUntil: timestamp("invoice_held_until"),
  consolidationInvoiceId: varchar("consolidation_invoice_id"),
  // === Uppgiftslogik v1: Fakturalås (BY+CE) ===
  // Fryst kopia av orderkonceptets requireCompleteSegmentBeforeInvoice vid expansion.
  // När true hålls WO utanför pending/held tills alla syskon i samma billing-segment
  // (tenant+orderConceptId+billingSegmentKey) är klara. NULL/false = dagens beteende.
  frozenRequireCompleteSegmentBeforeInvoice: boolean("frozen_require_complete_segment_before_invoice").default(false),
  // Synliggör varför en färdig WO ännu inte gått vidare i fakturaflödet (annars tyst).
  invoiceBlockedReason: text("invoice_blocked_reason"),
  invoiceBlockedAt: timestamp("invoice_blocked_at"),
  // === Task #970: Metadatastyrd fakturaflödeslogik ("Faktura från toppen") ===
  // Fryst billing-segment som förfinar konsoliderings-grupperingen ovanpå frozen
  // recipient/customer. Sätts vid markWorkOrderReadyForInvoice (endast held-WO,
  // endast när tenanten aktiverat invoiceFlow). NULL = ingen split = exakt dagens
  // beteende (full back-compat). billingBreakObjectId = närmaste förälder med
  // Fakturastopp=Ja (lokalt, ej ärvt); billingGroupingValue = värdet på det
  // konfigurerade grupperingsfältet (t.ex. Förvaltare) vid objektet. segmentKey är
  // den deterministiska suffix-nyckeln (`b:<id|->|g:<value|->`), NULL när ingen split.
  billingSegmentKey: text("billing_segment_key"),
  billingBreakObjectId: varchar("billing_break_object_id"),
  billingGroupingFieldName: text("billing_grouping_field_name"),
  billingGroupingValue: text("billing_grouping_value"),
  // === Frysta fakturareferenser (huvud) ===
  // Fryses vid markWorkOrderReadyForInvoice tillsammans med billing-segmentet.
  // Vår referens (OurReference), Vår beteckning/Ordernr (Remarks, härledd konceptnr),
  // Er referens (YourReference), Er beteckning/Ert ordernr (YourOrderNumber).
  // NULL = ingen koncept-referens (back-compat → dagens objekt-härledda YourReference).
  // FROM_METADATA-värdena (frozenCustomerReference/InvoiceReference) ingår i
  // billingSegmentKey så att olika värden hamnar på olika konsoliderade fakturor.
  frozenOurReference: text("frozen_our_reference"),
  frozenOurDesignation: text("frozen_our_designation"),
  frozenCustomerReference: text("frozen_customer_reference"),
  frozenCustomerInvoiceReference: text("frozen_customer_invoice_reference"),
  // === Task #1243: frysta fakturahuvud-fält (leveranssätt/transportsätt/valuta/
  // betalningsvillkor/språk) ===
  // Fryses från orderConcepts vid samma tillfälle som referenserna ovan (se
  // freezeReferencesOnWorkOrder) och mappas till Fortnox WayOfDelivery/
  // TermsOfDelivery/Currency/TermsOfPayment/Language vid export. NULL = ingen
  // koncept-konfiguration → Fortnox-default används (back-compat).
  frozenDeliveryMethod: text("frozen_delivery_method"),
  frozenTransportMethod: text("frozen_transport_method"),
  frozenCurrency: text("frozen_currency"),
  frozenPaymentTerms: text("frozen_payment_terms"),
  frozenInvoiceLanguage: text("frozen_invoice_language"),
  // Frysta radreferenser (Fortnox-native rader): { rows: [{label, value}],
  // includeExecutorFreetext }. Resolvas vid skapande (call_off/schedule publish)
  // från konceptets invoiceRowReferenceFields + objektets metadata och fryses här
  // så Fortnox-exporten läser frysta värden (aldrig omläsning, ingen WO→koncept-länk).
  // NULL = konceptet saknade radkonfig → fallback till 200-tecken-berikad beskrivning.
  frozenInvoiceRowReferences: jsonb("frozen_invoice_row_references"),
  // === Task #1124 (Grundbeslut #1): Fakturan utgår från den utförda uppgiften ===
  // En utförd avrops-assignment materialiseras till EN fakturerbar work_order.
  // sourceAssignmentId + orderConceptId bär konceptkopplingen så referenser/fast
  // pris/villkor kan frysas och fakturapipelinen (markWorkOrderReadyForInvoice →
  // konsolidering → Fortnox) återanvänds oförändrad. invoiceSourceType='assignment'
  // markerar materialiserade rader. frozenIsFixedPrice fryser fast-pris-naturen för
  // korrekt radkollaps. Allt nullable/default (expand-contract): legacy-WO oförändrade.
  sourceAssignmentId: varchar("source_assignment_id").references((): any => assignments.id),
  orderConceptId: varchar("order_concept_id").references((): any => orderConcepts.id),
  invoiceSourceType: text("invoice_source_type"),
  frozenIsFixedPrice: boolean("frozen_is_fixed_price").default(false),
  // === Task #1187: Abonnemang 0-faktura & kvittning ===
  // Sätts när en abonnemangstäckt uppgift materialiseras: WO:n har fått en negativ
  // kvittningsrad så att nettot blir 0. Driver "Täckt av abonnemang"-badge i
  // fakturakön, woAmount→0 (ingen positiv cachedValue-fallback) och net-0-invarianten
  // vid Fortnox-export. Fungerar även som idempotens-vakt (kvittningsraden läggs bara
  // en gång). Default false = dagens beteende (expand-contract).
  subscriptionCovered: boolean("subscription_covered").default(false),
  subscriptionCoveredAt: timestamp("subscription_covered_at"),
  // === Task #785: Veckoplanering – datafundament (expand-contract, alla nullable) ===
  // Planeringsinput för grov-/veckoplanering. Rapportens generiska `tasks`-fält
  // införs här eftersom Traivos arbetsenhet är work_orders (ingen tasks-tabell).
  // Skiljer sig från cached*-fälten (som härleds från orderrader): dessa är
  // planerar-styrda värden för motor/regel-lagret (egen task).
  // Planerad produktionstid i minuter (planeringsestimat, ej härlett från rader).
  productionTimeMinutes: integer("production_time_minutes"),
  // Geografiskt distrikt (grovplanering per område).
  districtId: varchar("district_id").references((): any => geographicDistricts.id, { onDelete: "set null" }),
  // Utförandetyp som driver pre-task-regler (exec_type_pre_task_rules).
  executionType: text("execution_type"),
  // Önskad start/slut (mjuk preferens på enskild order, fristående från leveransfönster).
  desiredStartAt: timestamp("desired_start_at"),
  desiredEndAt: timestamp("desired_end_at"),
  // Hårt/halvhårt leveransfönster (t.ex. avtalat intervall).
  deliveryWindowStart: timestamp("delivery_window_start"),
  deliveryWindowEnd: timestamp("delivery_window_end"),
  // Grovplanerad vecka (ISO, format "YYYY-Www", t.ex. "2026-W24").
  roughPlannedWeek: text("rough_planned_week"),
  // Av kund/planerare föredragen vecka (ISO "YYYY-Www").
  preferredWeek: text("preferred_week"),
  // Centroid-koordinat för ordern (cachat för avstånd/klustring i motorn).
  centroidLat: real("centroid_lat"),
  centroidLng: real("centroid_lng"),
  // Uppskattad restid till ordern i minuter (cachat planeringsvärde).
  estimatedTravelMin: integer("estimated_travel_min"),
  // Tillåtet parallell-/samordningsfönster (jsonb, motor-definierat schema).
  parallelWindowJson: jsonb("parallel_window_json"),
  // === Task #997 (Tidsmotor): Fryst viktat tidsregel-paket ===
  // Hela paketet (hårda + mjuka regler med polaritet + vikt) snapshotat vid
  // expansion per objekt. NULL = inga tidsregler gällde objektet → dagens
  // fallback (schemalagt datum) oförändrad. Mjuka regler matas in i optimeraren
  // som viktad preferens; hårda fortsätter begränsa som idag.
  frozenTimeRules: jsonb("frozen_time_rules").$type<FrozenTimeRulePackage>(),
  // === Snabborder (light ordergivare): löpande läsbart ordernummer per tenant ===
  // Format "SO-<n>" (start 1001). Myntas ENDAST för snabborder-flödet (opts-flagga i
  // createWorkOrderWithLines) under transaktionsbundet advisory-lås; övriga WO lämnas
  // NULL (expand-contract, back-compat). Klientsatt värde ignoreras alltid.
  orderNumber: text("order_number"),
  // === Klumpningsmotorer (ADR klumpning v1): dynamisk stopp- och rutt-gruppering ===
  // Alla fält nullable (expand-contract). Uppdateras av klumpningsservicen vid trigger
  // (fältändring i CLUSTERING_TRIGGERS) eller manuell körning av planerare.
  // clusterLockStatus styr om motorns beslut får skrivas över vid omräkning:
  //   auto      = motorns senaste beslut, kan skrivas om
  //   confirmed = planeraren har bekräftat, motorn varnar vid avvikelse
  //   locked    = ändras ALDRIG automatiskt, kräver explicit upplåsning
  stopClusterId: varchar("stop_cluster_id").references((): any => stopClusters.id, { onDelete: "set null" }),
  routeClusterId: varchar("route_cluster_id").references((): any => routeClusters.id, { onDelete: "set null" }),
  stopClusterCalculatedAt: timestamp("stop_cluster_calculated_at"),
  routeClusterCalculatedAt: timestamp("route_cluster_calculated_at"),
  clusterLockStatus: text("cluster_lock_status"),
  clusterExclusionReason: text("cluster_exclusion_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_work_orders_tenant").on(table.tenantId),
  index("idx_work_orders_district").on(table.districtId),
  index("idx_work_orders_rough_week").on(table.tenantId, table.roughPlannedWeek),
  index("idx_work_orders_invoice_queue").on(table.tenantId, table.invoiceQueueState),
  index("idx_work_orders_parent").on(table.parentWorkOrderId),
  index("idx_work_orders_scheduled_date").on(table.scheduledDate),
  index("idx_work_orders_order_status").on(table.orderStatus),
  index("idx_work_orders_object").on(table.objectId),
  index("idx_work_orders_customer").on(table.customerId),
  index("idx_work_orders_resource").on(table.resourceId),
  index("idx_work_orders_cluster").on(table.clusterId),
  index("idx_work_orders_billing_segment").on(table.tenantId, table.billingSegmentKey),
  index("idx_work_orders_segment_gate").on(table.tenantId, table.orderConceptId, table.billingSegmentKey),
  uniqueIndex("uq_work_orders_source_assignment")
    .on(table.tenantId, table.sourceAssignmentId)
    .where(sql`source_assignment_id IS NOT NULL`),
  index("idx_work_orders_order_concept").on(table.tenantId, table.orderConceptId),
  index("idx_work_orders_tenant_status").on(table.tenantId, table.orderStatus),
  index("idx_work_orders_actual_time_group").on(table.tenantId, table.actualTimeGroupKey),
  index("idx_work_orders_tenant_date").on(table.tenantId, table.scheduledDate),
  index("idx_work_orders_resource_date").on(table.resourceId, table.scheduledDate),
  index("idx_work_orders_tenant_deleted").on(table.tenantId, table.deletedAt),
  index("idx_work_orders_tenant_resource_date").on(table.tenantId, table.resourceId, table.scheduledDate),
  index("idx_work_orders_tenant_customer").on(table.tenantId, table.customerId),
  index("idx_work_orders_tenant_desired_start").on(table.tenantId, table.desiredDeliveryStart),
  index("idx_work_orders_tenant_desired_end").on(table.tenantId, table.desiredDeliveryEnd),
  index("idx_work_orders_task_category").on(table.taskCategory),
  uniqueIndex("uq_work_orders_tenant_order_number")
    .on(table.tenantId, table.orderNumber)
    .where(sql`order_number IS NOT NULL`),
  index("idx_work_orders_stop_cluster").on(table.stopClusterId),
  index("idx_work_orders_route_cluster").on(table.routeClusterId),
]);

// Orderrader - artiklar kopplade till en order med beräknade priser
export const workOrderLines = pgTable("work_order_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id).notNull(),
  // Nullable för fritext-/blindgångar-rader (Enkel uppgift) som saknar artikel.
  // Måste antingen ha articleId ELLER description (valideras i route-lagret).
  articleId: varchar("article_id").references(() => articles.id),
  // Fritext-beskrivning för rader utan artikel (manuellt pris/tid sätts direkt
  // på resolvedPrice/resolvedProductionMinutes). NULL för artikelrader.
  description: text("description"),
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
  // Markerad som utförd/klar i fält eller i planeringsvyn
  isCompleted: boolean("is_completed").default(false).notNull(),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  // === Uppgiftslogik v1 (kolumn T): Taget antal + svinn/retur ===
  // quantity ovan förblir FAKTURERAT/LEVERERAT (rör aldrig). takenQuantity är det
  // verkligt tagna/förbrukade (>= quantity). wasteQuantity = svinn (taget men ej
  // fakturerbart, t.ex. skadat) = max(taken - quantity, 0). returnedQuantity =
  // överskott tillbaka till lager (plockat - fakturerat) när plockdata finns.
  // Allt nullable/default (expand-contract) — påverkar aldrig fakturering.
  takenQuantity: integer("taken_quantity"),
  returnedQuantity: integer("returned_quantity").default(0),
  wasteQuantity: integer("waste_quantity").default(0),
  quantityReconciliationNote: text("quantity_reconciliation_note"),
  // Lagermodell (Motor 8): netto-förbrukning (taget - retur) som REDAN dragits från
  // lagersaldot för denna rad. Idempotens-spärr så att om-registrering/omslutförande
  // bara applicerar DELTAT mot saldot, aldrig hela beloppet på nytt. NULL/0 = inget
  // draget ännu (expand-contract; artiklar utan lagerplats rör aldrig saldo).
  stockAppliedQuantity: integer("stock_applied_quantity").default(0),
  // Lagermodul 2.0: vilken lagerplats radens lagerdrag applicerats mot (bil-lager
  // eller artikelns huvudlagerplats). Sätts vid första draget och används sedan för
  // alla delta (retur läggs tillbaka på samma plats som uttaget). NULL = ej draget.
  stockAppliedLocation: text("stock_applied_location"),
  // Task #1316: teknikerns val av lagerkälla för radens uttag. NULL = automatiskt
  // platsval (bil-lager om saldo finns), 'main' = tvinga artikelns huvudlagerplats.
  // Påverkar bara FÖRSTA draget — redan applicerad plats (stockAppliedLocation)
  // vinner alltid så retur hamnar på samma plats som uttaget.
  stockSourceOverride: text("stock_source_override"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_work_order_lines_work_order_id").on(table.workOrderId),
  index("idx_work_order_lines_article").on(table.articleId),
  index("idx_work_order_lines_tenant").on(table.tenantId),
]);

// === Uppgiftslogik v1: Audit-logg för antalshändelser (taget/svinn/retur) ===
// Append-only händelselogg — INTE en auktoritativ lagerledger. Bär signalen
// "taget antal påverkar ekonomi/lager" (svinn→förbrukning, överskott→återlager)
// utan att hålla saldon. Framtida ekonomi/lager-export läser härifrån.
export const workOrderLineQuantityEvents = pgTable("work_order_line_quantity_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderLineId: varchar("work_order_line_id").references(() => workOrderLines.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id),
  // 'taken' | 'waste' | 'return' | 'adjust'
  eventType: text("event_type").notNull(),
  quantity: integer("quantity").notNull(),
  reason: text("reason"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_wolqe_tenant_line").on(table.tenantId, table.workOrderLineId),
  index("idx_wolqe_tenant_wo").on(table.tenantId, table.workOrderId),
]);

export const insertWorkOrderLineQuantityEventSchema = createInsertSchema(workOrderLineQuantityEvents).omit({
  id: true,
  createdAt: true,
});
export type WorkOrderLineQuantityEvent = typeof workOrderLineQuantityEvents.$inferSelect;
export type InsertWorkOrderLineQuantityEvent = z.infer<typeof insertWorkOrderLineQuantityEventSchema>;

// === Lagermodell (Motor 8): spårat lagersaldo per artikel + lagerplats ===
// Auktoritativ saldo-tabell (till skillnad från articles.stockLocations-jsonb där
// balance var "readonly/beräknat"). Ett saldo per (tenant, artikel, lagerplats).
// `balance` = antal i lager (st, kan bli negativt vid överuttag → synliggör fel).
// reorderPoint/safetyStock är valfria per-plats-nivåer; saknas de faller varnings-
// logiken tillbaka på artikelns egna reorderPoint/safetyStock. Saldot muteras enbart
// via reconcileWorkOrderLineStock (avdrag vid taget/slutförande, återläggning vid
// retur) och manuell justering från inköp/planering. Additivt (expand-contract):
// artiklar utan lagerplats får aldrig någon rad och påverkas aldrig.
export const stockBalances = pgTable("stock_balances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id).notNull(),
  location: text("location").notNull(),
  balance: integer("balance").default(0).notNull(),
  reorderPoint: integer("reorder_point"),
  safetyStock: integer("safety_stock"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_stock_balances_tenant_article_location").on(table.tenantId, table.articleId, table.location),
  index("idx_stock_balances_tenant").on(table.tenantId),
  index("idx_stock_balances_article").on(table.articleId),
]);

export const insertStockBalanceSchema = createInsertSchema(stockBalances).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type StockBalance = typeof stockBalances.$inferSelect;
export type InsertStockBalance = z.infer<typeof insertStockBalanceSchema>;

// === Lagermodul 2.0: lagerplatsregister ===
// Formaliserar lagerplatser (huvudlager + servicebilar) i stället för fri text.
// `name` är nyckeln som matchar stock_balances.location / articles.stockLocation
// (befintliga fritextplatser adopteras bakåtkompatibelt genom att registrera en
// rad med samma namn). kind='vehicle' kan kopplas till resurs och/eller team —
// det styr bil-lager-uttag i fältflödet. Additivt (expand-contract): saldon och
// rörelser fungerar även för platser som inte finns i registret.
export const stockLocations = pgTable("stock_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  // 'main' (huvudlager) | 'vehicle' (servicebil/team-lager)
  kind: text("kind").default("main").notNull(),
  resourceId: varchar("resource_id").references(() => resources.id),
  teamId: varchar("team_id").references(() => teams.id),
  isActive: boolean("is_active").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_stock_locations_tenant_name").on(table.tenantId, table.name),
  index("idx_stock_locations_tenant").on(table.tenantId),
]);

export const insertStockLocationSchema = createInsertSchema(stockLocations).omit({
  id: true,
  createdAt: true,
});
export type StockLocation = typeof stockLocations.$inferSelect;
export type InsertStockLocation = z.infer<typeof insertStockLocationSchema>;

// === Lagermodul 2.0: rörelselogg ===
// Append-only logg över ALLA saldoförändringar i stock_balances — saldot ska
// alltid gå att förklara som summan av sina rörelser. Stämplas uteslutande av
// saldoservicen (server/services/stock-balance.ts); inga direkta saldo-UPDATEs
// utanför den. `delta` = förändringen (+/-), `balanceAfter` = saldot efter.
export const STOCK_MOVEMENT_TYPES = [
  "uttag",        // fältuttag (taget antal, netto)
  "retur",        // återläggning från fält
  "inleverans",   // mottagen leverans
  "overforing_ut",  // överföring: från-sidan
  "overforing_in",  // överföring: till-sidan
  "justering",    // manuell justering (absolut saldo satt)
  "inventering",  // inventeringsdiff
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const stockMovements = pgTable("stock_movements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id).notNull(),
  location: text("location").notNull(),
  movementType: text("movement_type").notNull(),
  delta: integer("delta").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  // Motpartsplats vid överföring (från/till beroende på riktning).
  counterpartLocation: text("counterpart_location"),
  workOrderId: varchar("work_order_id"),
  note: text("note"),
  // Vem: user-id (webb) eller resurs-id (fält) — fritext-label, ingen FK.
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_stock_movements_tenant_article").on(table.tenantId, table.articleId),
  index("idx_stock_movements_tenant_location").on(table.tenantId, table.location),
  index("idx_stock_movements_tenant_created").on(table.tenantId, table.createdAt),
]);

export const insertStockMovementSchema = createInsertSchema(stockMovements).omit({
  id: true,
  createdAt: true,
});
export type StockMovement = typeof stockMovements.$inferSelect;
export type InsertStockMovement = z.infer<typeof insertStockMovementSchema>;

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
  karl: "Objekt",
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
  // ADR v3 (F1): Artikelersättning utan att bryta historik. Self-FK till föregående artikel
  // som denna ersätter (t.ex. ny version av en tjänst). Befintliga work_orders och linjer
  // behåller pekare till original-artikeln; nya WO via expand kan välja ersättaren.
  replacesArticleId: varchar("replaces_article_id").references((): any => articles.id, { onDelete: "set null" }),
  // === ADR v3 (F4): BOM-cachade flaggor ===
  // Sätts av storage när article_components skapas/tas bort.
  // Strukturartikel = parent i BOM (TILG100 → TILG201+TILG202).
  // Komponentartikel = child i BOM.
  isStructure: boolean("is_structure").default(false),
  isComponent: boolean("is_component").default(false),
  // Geografiskt positionsberoende: artikelns tjänst/vara ärver objektets geo-position
  // för planering (default på). Avmarkera för artiklar som inte behöver geopositionering
  // (t.ex. administrativa eller centralt utförda poster).
  isGeoDependent: boolean("is_geo_dependent").default(true),
  // Utförandekod som krävs (t.ex. "kranbil", "tvatt", "sug")
  executionCode: text("execution_code"),
  // Tidskoder: vilken tidskod (time_code_definitions.key) som artikelns utförda tid räknas
  // som (produktion/ställtid/internt/egentid). Nullable/fri text (expand-contract, back-compat).
  // Fryses per uppgift vid orderkoncept-expansion (assignments/work_orders.frozenTimeCode).
  timeCodeKey: text("time_code_key"),
  // Task #1235: artikelbaserad tid. articleType "restid" | "internal_time" gör att
  // artikeln driver kostnad/tid för icke-produktionsuppgifter (resa, vila, lunch,
  // semester, sjukdom, utbildning, administration, egen tid) via samma artikelflöde
  // som produktionsuppgifter — i stället för hårdkodade motorkonstanter.
  // "restid" (Motor 12): cost = öre/km, travelMinutesPerKm = minuter/km. Valfria
  // urvalsvillkor (fordonstyp/vägtyp/hastighetsintervall) avgör bästa artikelmatch
  // för en given resa; ingen matchning ⇒ motorn faller tillbaka på tenant-konfig.
  // "internal_time": cost tolkas som öre/minut (arbetskraftskostnad för tidstypen).
  travelVehicleTypes: text("travel_vehicle_types").array().default([]),
  travelRoadTypes: text("travel_road_types").array().default([]),
  travelMinSpeedKmh: real("travel_min_speed_kmh"),
  travelMaxSpeedKmh: real("travel_max_speed_kmh"),
  travelMinutesPerKm: real("travel_minutes_per_km"),
  // Task #942: Valfri ikon-referens till ikonregistret (icon_definitions.key).
  // Nullable/fri text för back-compat — pekar inte hårt på en FK.
  iconKey: text("icon_key"),
  // Metadata-koppling (per Mats spec Funktion 3 & 7)
  fetchMetadataCode: text("fetch_metadata_code"),
  leaveMetadataCode: text("leave_metadata_code"),
  leaveMetadataFormat: text("leave_metadata_format"),
  // Kap 6 (master-spec): obligatorisk informationslämning. När true måste leave-metadata-värdet
  // (format "value") finnas innan uppgiften kan slutföras. Auto-format (timestamp/boolean_true/
  // counter_increment) uppfyller alltid kravet automatiskt. Expand-contract: default false.
  leaveMetadataRequired: boolean("leave_metadata_required").default(false),
  // Kinab: metadata-etikett-koppling (P4/P7)
  fetchMetadataLabel: text("fetch_metadata_label"),
  fetchMetadataLabelFormat: text("fetch_metadata_label_format"),
  canUpdateMetadata: boolean("can_update_metadata").default(false),
  updateMetadataLabel: text("update_metadata_label"),
  updateMetadataFormat: text("update_metadata_format"),
  showPreviousValue: boolean("show_previous_value").default(false),
  // Blindartikel / informationsbärare (P8)
  isInfoCarrier: boolean("is_info_carrier").default(false),
  // Artikelbegränsning (P11)
  limitationType: text("limitation_type").default("unlimited"),
  // Informationspaket fält 19: begränsningstyp för den numeriska antalsgränsen
  // (maxPerAddress). Avgör VAD taket räknas mot: "address" (default, bakåtkompatibelt),
  // "object" eller "customer". Skild från limitationType (som är "en gång per X" = tak 1).
  // Expand-contract: nullable/default "address" → befintliga rader oförändrade.
  limitationScope: text("limitation_scope").default("address"),
  // Informationspaket fält 33: "Ej förbrukas". När true drar artikeln ALDRIG lagersaldo
  // vid utförande (t.ex. verktyg/utrustning som används men inte förbrukas) — även om en
  // lagerplats är satt. reconcileWorkOrderLineStock hoppar över raden. Default false
  // (oförändrat: förbrukning styrs av taget antal mot lagerplats).
  notConsumed: boolean("not_consumed").default(false),
  // Informationspaket fält 26 & 27: artikel-nivå fakturaflaggor.
  //   showOnInvoice     — artikeln får synas som fakturarad (default true). false ⇒
  //                       raden utelämnas helt ur fakturan (utförs men syns ej för kund).
  //   invoiceToCustomer — artikeln debiteras kunden (default true). false ⇒ raden visas
  //                       (om showOnInvoice) men med pris 0 (intern/ej debiterbar post).
  // Tillämpas vid fakturamaterialisering (Fortnox-radbyggaren). Per-tillfälle-undantag
  // (assignments.exceptionStatus = "ej_fakturerbar") kvarstår som override ovanpå dessa
  // permanenta artikel-defaults. Expand-contract: default true ⇒ oförändrat beteende.
  showOnInvoice: boolean("show_on_invoice").default(true),
  invoiceToCustomer: boolean("invoice_to_customer").default(true),
  // Associations-kod för artikelhook mot metadata-typ (legacy)
  associationCode: text("association_code"),
  // Kinab tvåstegsfilter (legacy enkel-villkor): association via metadata-etikett + värde.
  // Task #835: ersatt av associationRules (multi-AND). Behålls för bakåtkompatibilitet
  // (expand-contract) och migreras in i associationRules.
  associationLabel: text("association_label"),
  associationValue: text("association_value"),
  associationOperator: text("association_operator").default("equals"),
  // Task #835: konsoliderad artikelmatchning. Array av AND-villkor (AssociationCondition).
  // source = "metadata" (etikett+operator+värde), "hook_level" (migrerad fasthakning, evalueras
  // med exakt legacy-matchare → paritet), "object_type" (migrerade objekttyper, påverkar bara
  // mobil-relevans, ej resolvern). Tom array = ingen regelbaserad matchning (fallback till
  // legacy hookLevel/associationLabel under expand-fasen).
  associationRules: jsonb("association_rules").default([]),
  maxPerAddress: integer("max_per_address"),
  // Kvantitetsläge (Task #834): 'per_styck' (default — bas-mängd × objektets antal),
  // 'single_per_task' (alltid 1, t.ex. fotodokumentation). Äldre värden
  // 'use_object_quantity'/'configurable' migreras till 'per_styck' (samma beteende).
  quantityMode: text("quantity_mode").default("per_styck"),
  // Kap 5 (master-spec): antal-behörighet. operatorCanUpdateQuantity = fältarbetaren får ändra
  // antal vid utförande (annars låst). freeMetadataUpdate = när antalet ändras skrivs det nya
  // antalet tillbaka till objektets metadata (quantityMetadataField). Expand-contract: default
  // false (oförändrat beteende).
  operatorCanUpdateQuantity: boolean("operator_can_update_quantity").default(false),
  freeMetadataUpdate: boolean("free_metadata_update").default(false),
  // GAP-106 (Task #939): dölj antalsinmatningen i fältappen för artiklar med fast/härlett
  // antal (t.ex. besiktnings-/kontrollartiklar). När true visas inget redigerbart antalsfält
  // i Traivo Go — det fasta/härledda antalet används automatiskt vid rapportering/klarmarkering.
  // Expand-contract: default false (oförändrat beteende). Ömsesidigt uteslutande med
  // operatorCanUpdateQuantity (ett dolt fält kan inte redigeras av operatören).
  hideQuantityInApp: boolean("hide_quantity_in_app").default(false),
  // Offsettid i minuter (Mats prislista: A100=120, N100=2400). Negativt = före huvudjobbet,
  // 0 = samtidigt, positivt = efter. Används vid expand av orderkoncept för att skapa
  // förberedande work_orders med tidsfönster relativt huvudjobbet (parent_work_order_id).
  offsetMinutes: integer("offset_minutes").default(0).notNull(),
  // Task #836 (Fas 3): Ledtid = leverantörens leveranstid i dagar (skild från offsettid).
  // Tidigare överlastades positiv offsetMinutes som "leveranstid" — det är nu separerat.
  // Migration 0076 flyttar befintlig positiv offsetMinutes hit (behov: material beställs i tid).
  leadTimeDays: integer("lead_time_days"),
  // Task #836 (Fas 3): Beroendeartikel-flaggor. requiresAcknowledgment = artikelns
  // tillgänglighet måste kvitteras innan huvuduppgiften kan utföras.
  requiresAcknowledgment: boolean("requires_acknowledgment").default(false),
  // Kritiskhet — binärt nu ('critical' = blockerar, 'skippable' = kan strykas), text för
  // framtida graderad skala (öppen fråga §13.2 — utbyggbart).
  dependencyCriticality: text("dependency_criticality").default("critical"),
  // Intern beskrivning för utförare
  internalDescription: text("internal_description"),
  // Länk till arbetsbeskrivning
  infoLink: text("info_link"),
  // Session 9B: geotaggad — uppgiften kräver fysisk position (fältarbete på plats)
  isGeotagged: boolean("is_geotagged").default(false),
  // Session 11 (Register 1): filer (PDF-instruktioner, monteringsguider) — array av {name,url,type}
  files: jsonb("files").default([]),
  // Session 11: metadatakorrespondens — VAD artikeln rapporterar tillbaka
  // 'antal' | 'status' | 'foto' | 'fotogalleri' | 'text'
  reportingType: text("reporting_type"),
  reportingMetadataField: text("reporting_metadata_field"),
  // Session 11: framtida — artikeln ska returneras (retur-/pantflöde)
  shouldBeReturned: boolean("should_be_returned").default(false),
  // Session 12 (Steg 6): förvalt metadatafält som föreslås som "Hakar fast på" vid tillägg i orderkoncept
  defaultMetadataAssociation: text("default_metadata_association"),
  // Session 08-15 / Task #834: kvantitetslägen. Legacy 'use_object_quantity'/'configurable'
  // migreras till 'per_styck'. Aktiva lägen:
  //   'per_styck'      = multiplicera med objektets/orderradens basantal (motsv. gamla use_object_quantity)
  //   'single_per_task'= alltid 1 (t.ex. fotodokumentation)
  //   'group'          = fast multipel = groupSize
  //   'matches_field'  = antal från objektets metadatavärde i quantityMetadataField
  // OBS: 'per_styck' returnerade tidigare 1 (= dubblett av single_per_task) — det var en bugg
  // som rättades i Task #834 så att etiketten "multipliceras med objektets antal" stämmer.
  quantityMetadataField: text("quantity_metadata_field"),
  quantityUnit: text("quantity_unit"),
  groupSize: integer("group_size"),
  // Antalskälla "Formel" (Mats Antalslogik): aritmetiskt uttryck som refererar
  // objektets metadatafält via hakparenteser, t.ex. "[Antal kärl] * 2". Endast
  // aktivt när quantityMode = 'formula'. Upplöses ärvningsmedvetet per objekt i
  // callers (parseFormula -> getArticleMetadataForObject -> evaluateFormula, se
  // server/article-quantity-resolver.ts). Expand-contract: nullable, default null.
  quantityFormula: text("quantity_formula"),
  // Session 08-28: leverantörsnummer (flera möjliga, förhindrar parallellköp)
  supplierNumbers: text("supplier_numbers").array().default([]),
  // Session 08-28: utgått artikel pekar framåt på sin ersättare (forward self-FK).
  // OBS skild från replacesArticleId (ADR v3, bakåt-pekare som expand använder).
  replacementArticleId: varchar("replacement_article_id").references((): any => articles.id, { onDelete: "set null" }),
  // Session 08-28: extern informationslänk (säkerhetsblad/monteringsanvisning) + etikett
  externInfoUrl: text("extern_info_url"),
  externInfoDescription: text("extern_info_description"),
  // Task #834: uppladdad extern info-fil (säkerhetsdatablad/produktblad) via Object Storage,
  // lagras som /objects/...-path. Komplement till externInfoUrl (länk).
  externInfoFileUrl: text("extern_info_file_url"),
  // === "Ny artikel"-layoutspec: nya artikelkonfigurationsfält ===
  // Expand-contract: alla nullable/default → befintlig data + integrationer oförändrade.
  // Pris & Ekonomi (öre för prisfält, min för tider):
  purchasePrice: integer("purchase_price"),       // Inköpspris (öre)
  standardCost: integer("standard_cost"),         // Standardkostnad (öre)
  materialCost: integer("material_cost"),          // Materialkostnad (öre)
  // GAP-104 / Task #938: prisuppbyggnad. Självkostnad = inköp + frakt + lager.
  // Expand-contract: nullable så befintliga rader + integrationer (Mobile/VRP/Fortnox) är oförändrade.
  freightCost: integer("freight_cost"),            // Fraktkostnad (öre)
  warehouseCost: integer("warehouse_cost"),        // Lagerkostnad (öre)
  markupPercent: real("markup_percent"),           // Påslag (%)
  chargeModel: text("charge_model"),               // Debiteringsmodell: per_styck/per_timme/fast/per_meter/per_kvm
  travelTime: integer("travel_time"),              // Restid (min)
  // Lager & Inköp:
  defaultSupplierId: varchar("default_supplier_id").references((): any => suppliers.id, { onDelete: "set null" }),
  reorderPoint: integer("reorder_point"),          // Beställningspunkt (st)
  safetyStock: integer("safety_stock"),            // Säkerhetslager (st)
  minOrderQuantity: integer("min_order_quantity"), // Minsta orderantal (st)
  // Lagerplatser — array av {location, balance, minLevel, reorderPoint}. Saldo är readonly/beräknat.
  stockLocations: jsonb("stock_locations").default([]),
  // Informationsinhämtning (sektion 9, LEGACY) — array av {type, required, metadataField}.
  // UI:t ersatt av showMetadataFields/leaveMetadataFields nedan; kolumnen behålls (expand-contract).
  informationRequirements: jsonb("information_requirements").default([]),
  // Sektion "Visa och uppdatera metadata" — två repeterbara listor (expand-contract; ersätter
  // INTE legacy single-value-kolumnerna fetch/leaveMetadataCode m.fl. som lämnas orörda):
  //   showMetadataFields  — metadatafält att VISA för utföraren: {metadataField, clarification?, canUpdate}
  //   leaveMetadataFields — metadatafält att LÄMNA/rapportera:    {metadataField, instruction?, required}
  // metadataField = metadata_katalog.namn (svenska katalogen, samma källa som UI:t).
  showMetadataFields: jsonb("show_metadata_fields").default([]),
  leaveMetadataFields: jsonb("leave_metadata_fields").default([]),
  // Utförarkategori (sektion 10):
  performerCategory: text("performer_category"),
  competencyRequirements: text("competency_requirements").array().default([]),
  unit: text("unit").default("st"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_articles_tenant").on(table.tenantId),
  index("idx_articles_tenant_article_number").on(table.tenantId, table.articleNumber),
  index("idx_articles_tenant_created").on(table.tenantId, table.createdAt),
]);

// Task #834: Per-tenant register över artikeltyper. `key` är det stabila värde som
// lagras i articles.articleType (och i fritext på t.ex. checklist-mallar) — back-compat
// med befintlig fri text. `label` är den svenska visningstexten. Soft-delete via
// deletedAt (arkivering) — typer som används får aldrig hard-deleteas.
export const articleTypeDefinitions = pgTable("article_type_definitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  isSystem: boolean("is_system").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_article_type_defs_tenant").on(table.tenantId),
  uniqueIndex("uq_article_type_defs_tenant_key").on(table.tenantId, table.key),
]);

// Task #942: Per-tenant register över utförandekoder. `key` är det stabila värde som
// lagras i artiklar (articles.executionCode), resurser (resources.executionCodes[]) och
// resursprofiler (resource_profiles.executionCodes[]) — back-compat med befintlig fri text.
// `label` är den svenska visningstexten. Soft-delete via deletedAt (arkivering); koder som
// används får aldrig hard-deleteas (befintlig data behåller en giltig referens).
export const executionCodeDefinitions = pgTable("execution_code_definitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  // Task #1109: valfri koppling till ikonregistret (iconDefinitions.key). Gör att en
  // utförandekod visas med samma ikon överallt (planerare, listor) via det centrala
  // ikonregistret. NULL ⇒ fall tillbaka till textförkortning (EXECUTION_CODE_ICONS).
  iconKey: text("icon_key"),
  sortOrder: integer("sort_order").default(0).notNull(),
  isSystem: boolean("is_system").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_execution_code_defs_tenant").on(table.tenantId),
  uniqueIndex("uq_execution_code_defs_tenant_key").on(table.tenantId, table.key),
]);

// Tidskoder: Per-tenant register över TIDSKODER (time codes). En tidskod klassificerar vad
// utförd/planerad tid räknas som och driver (a) finplaneringens överlapp/pussel via `priority`
// och (b) framtida löne-/tidsredovisning via `groupKey`. `key` är det stabila värde som lagras
// (articles.timeCodeKey, personal_tasks.timeCategory, assignments/work_orders.frozenTimeCode).
// De tidigare hårdkodade time_category-värdena seedas som nycklar (subsumering — ingen
// datamigrering, ingen kolumnomdöpning). Soft-delete via deletedAt.
//   groupKey: produktion | stalltid | internt | egentid
//   priority: 1 = högst (aldrig överlapp, t.ex. produktion/restid) ... 3 = lägst (egentid,
//             får överbokas). En egentid kan höjas till prio 1 (t.ex. läkarbesök).
// Task #1237: tidstypsregistret som regelmotor. permissionLevel = lägsta tenant-roll
// som får REGISTRERA/ÄNDRA tid med denna kod (hierarki technician < planner < admin;
// "all" = ingen begränsning). OB-hantering är UTANFÖR scope — hanteras manuellt genom
// artikel-/tidskodsbyte av behörig användare, ingen automatisk OB-beräkning här.
export const timeCodePermissionLevels = ["all", "technician", "planner", "admin"] as const;
export type TimeCodePermissionLevel = typeof timeCodePermissionLevels[number];

export const timeCodeDefinitions = pgTable("time_code_definitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  // Huvudgrupp för rapportering/löneunderlag (styrd värdelista, se ovan).
  groupKey: text("group_key").default("internt").notNull(),
  // Prioritet för finplaneringens överlapp (1 = högst = aldrig överlapp).
  priority: integer("priority").default(2).notNull(),
  // Valfri koppling till ikonregistret (icon_definitions.key) — NULL ⇒ textfallback.
  iconKey: text("icon_key"),
  sortOrder: integer("sort_order").default(0).notNull(),
  isSystem: boolean("is_system").default(false).notNull(),
  // === Task #1237: regelmotor-flaggor ===
  // Ska tid med denna kod tas med i löneexporten (server/routes/configRoutes.ts
  // GET /api/payroll-export)? true = default (oförändrat beteende för befintliga koder).
  payrollExport: boolean("payroll_export").default(true).notNull(),
  // Ska tid med denna kod tas med i ekonomiexporten (Fortnox-underlag)? true = default.
  economyExport: boolean("economy_export").default(true).notNull(),
  // Kräver registrering av denna tidskod en GPS-position (fältappen)? false = default
  // (bakåtkompatibelt — endast koder som admin uttryckligen märker upp kräver GPS).
  requiresGps: boolean("requires_gps").default(false).notNull(),
  // Lägsta tenant-roll som får registrera/ändra tid med denna kod. "all" = ingen
  // begränsning (default, bakåtkompatibelt).
  permissionLevel: text("permission_level").default("all").notNull(),
  // Är tid med denna kod fakturerbar (styr ev. framtida debitering av internt arbete)?
  // false = default (de flesta interna/egentids-koder är ej fakturerbara).
  billable: boolean("billable").default(false).notNull(),
  // Fritt formulerade export-regler (t.ex. externt lönekonto/kod, mappning mot
  // Fortnox-konto). Nullable — tolkas av export-lagret, ingen hård kontraktsvalidering
  // ännu (expand-contract; strukturen får växa utan schemaändring).
  exportRules: jsonb("export_rules"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_time_code_defs_tenant").on(table.tenantId),
  uniqueIndex("uq_time_code_defs_tenant_key").on(table.tenantId, table.key),
]);

export type TimeCodeDefinition = typeof timeCodeDefinitions.$inferSelect;
export const timeCodeGroupKeys = ["produktion", "stalltid", "internt", "egentid"] as const;
export const insertTimeCodeDefinitionSchema = createInsertSchema(timeCodeDefinitions).omit({ id: true, createdAt: true }).extend({
  key: z.string().trim().min(1, "Nyckel krävs").max(50, "Nyckeln får vara högst 50 tecken"),
  label: z.string().trim().min(1, "Visningsnamn krävs").max(80, "Visningsnamnet får vara högst 80 tecken"),
  groupKey: z.enum(timeCodeGroupKeys).default("internt"),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  payrollExport: z.coerce.boolean().default(true),
  economyExport: z.coerce.boolean().default(true),
  requiresGps: z.coerce.boolean().default(false),
  permissionLevel: z.enum(timeCodePermissionLevels).default("all"),
  billable: z.coerce.boolean().default(false),
  exportRules: z.record(z.unknown()).nullable().optional(),
});
export type InsertTimeCodeDefinition = z.infer<typeof insertTimeCodeDefinitionSchema>;

// Task #942: Per-tenant ikonregister. Admin lägger upp namngivna ikoner som mappar mot
// en Lucide-ikon (`lucideName`). Artiklar (articles.iconKey) kan välja en ikon från
// registret via `key`. Soft-delete via deletedAt; ikoner som används arkiveras.
export const iconDefinitions = pgTable("icon_definitions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  // Namnet på den Lucide-ikon som ska renderas (t.ex. "truck", "recycle").
  // Används alltid som robust fallback om en egen ikon (symbol/bild) saknas/laddar fel.
  lucideName: text("lucide_name").default("package").notNull(),
  // Task #1109: egna ikoner utöver Lucide. iconType styr renderingen:
  //  - "lucide": rendera Lucide-ikonen ovan
  //  - "emoji": rendera tecknet i `symbol` (emoji eller kort textsymbol)
  //  - "image": rendera bilden i `imageUrl` (uppladdad via object storage)
  iconType: text("icon_type").default("lucide").notNull(),
  symbol: text("symbol"),
  imageUrl: text("image_url"),
  sortOrder: integer("sort_order").default(0).notNull(),
  isSystem: boolean("is_system").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_icon_defs_tenant").on(table.tenantId),
  uniqueIndex("uq_icon_defs_tenant_key").on(table.tenantId, table.key),
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
  // ADR v3 (F1): Indexjustering. Triggas av POST /api/v1/invoicing/index-adjustment
  // (Sprint F6). Sätts vid applicering — påverkar omräkning av framtida fakturor.
  indexAdjusted: boolean("index_adjusted").default(false),
  indexDate: timestamp("index_date"),
  indexPercentage: real("index_percentage"),
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
  index("idx_subscriptions_tenant").on(table.tenantId),
  index("idx_subscriptions_customer").on(table.customerId),
  index("idx_subscriptions_object").on(table.objectId),
  index("idx_subscriptions_next_gen").on(table.nextGenerationDate),
  index("idx_subscriptions_tenant_status").on(table.tenantId, table.status),
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

// Tenant-konfiguration för "släktnamn"/hierarkiskt visningsnamn (task #552).
// Sparas i `tenants.settings.displayNameRules` (jsonb) — ingen separat kolumn.
export const displayNameRulesSchema = z.object({
  enabled: z.boolean().default(false),
  separator: z.string().min(1).max(5).default(" › "),
  maxDepth: z.number().int().min(1).max(6).default(3),
  // Endast objekt med dessa hierarchyLevel-värden räknas in i sökvägen.
  // Tom array = alla nivåer.
  includeLevels: z.array(z.string()).default([]),
  // Hoppa över förälder vars namn är identiskt med barnets (undvika "Foo › Foo").
  skipDuplicateNames: z.boolean().default(true),
});
export type DisplayNameRules = z.infer<typeof displayNameRulesSchema>;

// Team - grupper av resurser
export const teams = pgTable("teams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Kluster som teamet primärt ansvarar för
  clusterId: varchar("cluster_id"),
  name: text("name").notNull(),
  description: text("description"),
  // Teamleadare
  leaderId: varchar("leader_id").references(() => resources.id),
  // Geografiskt område (postnummer)
  serviceArea: text("service_area").array().default([]),
  // Koppling till projekt i ekonomisystem
  projectCode: text("project_code"),
  // Kostnadsställe i ekonomisystem (Task #991: enhetligt utförarregister —
  // kostnadsställe + projekt på team propagerar till genererade uppgifter via
  // deriveFortnoxCodesForWorkOrder). Expand-contract: nullable, ingen regression.
  costCenter: text("cost_center"),
  color: text("color").default("#3B82F6"),
  status: text("status").default("active").notNull(),
  profileIds: text("profile_ids").array().default([]),
  // === ADR v3 (F2): Kapacitetsmål per vecka (Kinab default 28h prod / 12h resa) ===
  // Används av kapacitetsförnsel och planerar-UI för att visa team-belastning.
  // Defaults bevarar nuvarande beteende — ingen befintlig kod ändras automatiskt.
  productionHoursTarget: real("production_hours_target").default(28.0),
  travelHoursTarget: real("travel_hours_target").default(12.0),
  totalHoursWeek: real("total_hours_week").default(40.0),
  // === ADR v3 (F2): Senaste position (uppdateras av Mobile vid completion) ===
  lastPositionLat: real("last_position_lat"),
  lastPositionLng: real("last_position_lng"),
  lastPositionAt: timestamp("last_position_at"),
  // === ADR v3 (F2): Vilohantering ===
  // rest_type: 'none' | 'daily' | 'weekly' — styr om team är tillgängligt
  restType: text("rest_type").default("none"),
  restLocation: text("rest_location"),
  restUntil: timestamp("rest_until"),
  // === Task #1041: Team-/utförarprofilens grupperings- & ruttoptimerings-premisser ===
  // Tillämpas av geo-grupperingen/finplaneringen när teamet är känt; NULL faller
  // tillbaka på tenant-default (planning_parameters) → motorns default. Expand-only.
  // Grupperingsradie (meter) för positionsbaserad klumpning. NULL → tenant/default.
  groupingRadiusMeters: integer("grouping_radius_meters"),
  // Av/på för gatusidesberoende (udda/jämna husnummer var sin grupp). NULL = på (default).
  streetSideGrouping: boolean("street_side_grouping"),
  // Arbetstakt i procent (100 = normal takt). Premiss som finplaneringen konsumerar.
  workPacePercent: integer("work_pace_percent"),
  // Task #1239: Maximal gångsträcka (meter) mellan medlemmar i samma klump/stopp.
  // NULL → tenant-default (planning_parameters) → motorns hårdkodade default.
  // Team-värdet vinner alltid (se resolveTeamGroupingConfig).
  maxWalkingDistanceMeters: integer("max_walking_distance_meters"),
  // === Task #1153: Restidsmotor — tunga fordon & tidskorrigering ===
  // Team-grundparametrar för finplaneringens restidsmotor. Alla nullable/expand-only:
  // NULL → tenant-default (planning_parameters) → motorns default. Team-värdet vinner.
  // Hastighetstak (km/h) på resans medelfart. NULL = inget tak.
  speedCapKmh: real("speed_cap_kmh"),
  // Restidsfaktor (multiplikator på restid). NULL → 1.0. Trim-golv 0.5, tak 3.0.
  travelTimeFactor: real("travel_time_factor"),
  // Produktionstidsfaktor (multiplikator på produktionstid). NULL → 1.0. Golv 0.5, tak 3.0.
  productionTimeFactor: real("production_time_factor"),
  // Vinterfaktor (multiplikator på restid inom vinterperioden). NULL → 1.0. Golv 1.0.
  winterFactor: real("winter_factor"),
  // Vinterperiod som mm-dd-strängar (t.ex. "11-01".."03-31"; årsskifte tillåts när start>slut).
  winterStart: text("winter_start"),
  winterEnd: text("winter_end"),
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
  // NULL = inbjudan väntar på svar; icke-NULL = inbjudan accepterad (eller
  // direkt aktiv, t.ex. teamledaren). Används för att skilja pendande inbjudningar
  // från bekräftade medlemskap (deviationsdata kräver accepterat medlemskap).
  acceptedAt: timestamp("accepted_at"),
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
  // Per-tenant dagsmal (stopp per resurs/dag) for Produktionsledare break-even.
  // Nullable: fallback till resources.weeklyHours * stopsPerHour.
  dailyStopTarget: integer("daily_stop_target"),
  stopsPerHour: real("stops_per_hour"),
  // Task #521: Carry-over-tröskel (procent) för röd-status i daglig notis.
  // Nullable → default 110% i applikationen (gul >100, röd >110).
  carryOverThresholdPercent: real("carry_over_threshold_percent"),
  // Tenant-lokal timme (0–23) då carry-over-notisen ska skickas. Nullable →
  // default 16. Tidszon: Europe/Stockholm (CARRY_OVER_TIMEZONE-env överstyr).
  carryOverNotificationHour: integer("carry_over_notification_hour"),
  // Task #1038 (Tids- & geografimotorn): konfigurerbar grupperingsradie (meter) för
  // geo-gruppering av uppgifter utan gatuadress (positionsbaserad fallback). Nullable
  // → motorn faller tillbaka på DEFAULT_GROUPING_RADIUS_METERS. Tenant-nivå-raden
  // (customer_id IS NULL AND object_id IS NULL) bär defaulten.
  groupingRadiusMeters: integer("grouping_radius_meters"),
  // Task #1153: Restidsmotor-defaults på tenant-nivå (raden med customer_id IS NULL AND
  // object_id IS NULL bär defaulten). Team-parametern vinner; NULL → dessa → motordefault.
  speedCapKmh: real("speed_cap_kmh"),
  travelTimeFactor: real("travel_time_factor"),
  productionTimeFactor: real("production_time_factor"),
  winterFactor: real("winter_factor"),
  winterStart: text("winter_start"),
  winterEnd: text("winter_end"),
  // Task #1234 (Motor-/regeladministration): resterande klumpmotor-defaults på
  // tenant-nivå. Nullable → motorns hårdkodade DEFAULT_*-konstanter
  // (server/services/time-geo-engine.ts) används. Team-profilen vinner alltid
  // (se resolveTeamGroupingConfig), sedan denna tenant-rad, sist motor-defaulten.
  streetSideGrouping: boolean("street_side_grouping"),
  workPacePercent: real("work_pace_percent"),
  dailyCapacityMinutes: integer("daily_capacity_minutes"),
  // Task #1239: Maximal gångsträcka (meter) mellan medlemmar i samma klump/stopp.
  // Tenant-default; team-raden (teams.maxWalkingDistanceMeters) vinner alltid.
  // NULL → motorns hårdkodade DEFAULT_MAX_WALKING_DISTANCE_METERS används.
  maxWalkingDistanceMeters: integer("max_walking_distance_meters"),
  // Task #1239: kompatibla utförandekoder som FÅR klumpas ihop trots olika kod
  // (t.ex. ["klipp","trim"]). Array av grupper (varje grupp = lista med koder som
  // är sinsemellan utbytbara/kompatibla). Koder som inte förekommer i någon grupp
  // klumpas bara med exakt samma kod (nuvarande beteende, back-compat). NULL/[] →
  // ingen tvärkompatibilitet (motorns nuvarande strikta beteende).
  executionCodeCompatibilityGroups: jsonb("execution_code_compatibility_groups").$type<string[][]>(),
  // Task #1239: vikt (0..1) för hur mycket ekonomiskt värde (valueOre) ska styra
  // vilken uppgift som blir ankare/prioriteras vid klumpning och trängd kapacitet.
  // NULL → default 1.0 (ekonomiskt värde avgör ankare vid oavgjort/kapacitetskonflikt,
  // vilket är dagens implicita beteende gjort explicit). 0 = av (ren geografi/ordning).
  economicPriorityWeight: real("economic_priority_weight"),
  // Task #1234: planeringsmotor-defaults på tenant-nivå. Nullable → DEFAULT_
  // PLAN_ENGINE_CONFIG (server/planning/weeklyPlanEngine.ts). Per-plan
  // metadata.config vinner alltid över denna rad.
  costPerKmOre: integer("cost_per_km_ore"),
  co2KgPerKm: real("co2_kg_per_km"),
  defaultSpeedKmh: real("default_speed_kmh"),
  nightRestMinMinutes: integer("night_rest_min_minutes"),
  weekendRestMinMinutes: integer("weekend_rest_min_minutes"),
  travelShareThreshold: real("travel_share_threshold"),
  defaultContractedHours: real("default_contracted_hours"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Task #521: Per-användar opt-out för in-app-notistyper (default ON; en rad =
// explicit val). Generaliserbart men införs först för `carry_over_warning`.
export const userNotificationPreferences = pgTable("user_notification_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uniq_user_notif_pref_tenant_user_type").on(table.tenantId, table.userId, table.type),
  index("idx_user_notif_pref_tenant").on(table.tenantId),
]);

export const insertUserNotificationPreferenceSchema = createInsertSchema(userNotificationPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserNotificationPreference = z.infer<typeof insertUserNotificationPreferenceSchema>;
export type UserNotificationPreference = typeof userNotificationPreferences.$inferSelect;

// Task #522: Manuella bestämpunkter/anteckningar för veckomötesrapporten.
// En rad per (tenant, iso_year, iso_week) — uppdateras (upsert) av planner/admin.
export const weeklyReportNotes = pgTable("weekly_report_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  isoYear: integer("iso_year").notNull(),
  isoWeek: integer("iso_week").notNull(),
  decisions: text("decisions").default("").notNull(),
  actionItems: jsonb("action_items").default([]).notNull(),
  updatedBy: varchar("updated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uniq_weekly_report_notes_tenant_year_week").on(table.tenantId, table.isoYear, table.isoWeek),
  index("idx_weekly_report_notes_tenant").on(table.tenantId),
]);

export const weeklyReportActionItemSchema = z.object({
  text: z.string().min(1),
  owner: z.string().optional().nullable(),
  due: z.string().optional().nullable(),
  done: z.boolean().optional(),
});
export type WeeklyReportActionItem = z.infer<typeof weeklyReportActionItemSchema>;

export const insertWeeklyReportNotesSchema = createInsertSchema(weeklyReportNotes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWeeklyReportNotes = z.infer<typeof insertWeeklyReportNotesSchema>;
export type WeeklyReportNotes = typeof weeklyReportNotes.$inferSelect;

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
  // Notera: ingen direkt `customer`-relation — kundkoppling går via
  // `object_payers` (primary @ tidpunkt). Se `server/services/object-customer.ts`.
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
  priceList: one(priceLists, { fields: [subscriptions.priceListId], references: [priceLists.id] }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  tenant: one(tenants, { fields: [teams.tenantId], references: [tenants.id] }),
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

// ============================================
// Delivery Preferences (slottider per kund/objekt)
// ============================================
// Stående preferenser per veckodag, blockerade tider/datum, anteckningar.
// Lagras som JSONB på objects.deliveryPreferences (primär) och
// customers.deliveryPreferences (fallback). Effektiv preferens beräknas
// runtime av storage.resolveDeliveryPreferences(objectId).
const TIME_HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const weeklyWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start: z.string().regex(TIME_HHMM_RE, "Tid måste vara HH:MM"),
  end: z.string().regex(TIME_HHMM_RE, "Tid måste vara HH:MM"),
});

export const blockedHourSchema = z.object({
  start: z.string().regex(TIME_HHMM_RE, "Tid måste vara HH:MM"),
  end: z.string().regex(TIME_HHMM_RE, "Tid måste vara HH:MM"),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
});

export const deliveryPreferencesSchema = z.object({
  weeklyWindows: z.array(weeklyWindowSchema).default([]),
  blockedHours: z.array(blockedHourSchema).default([]),
  blockedDates: z.array(z.string().regex(ISO_DATE_RE, "Datum måste vara YYYY-MM-DD")).default([]),
  notes: z.string().max(500, "Anteckning får vara max 500 tecken").default(""),
  priority: z.enum(["preferred", "strict"]).default("preferred"),
});

export type WeeklyWindow = z.infer<typeof weeklyWindowSchema>;
export type BlockedHour = z.infer<typeof blockedHourSchema>;
export type DeliveryPreferences = z.infer<typeof deliveryPreferencesSchema>;

export const EMPTY_DELIVERY_PREFERENCES: DeliveryPreferences = {
  weeklyWindows: [],
  blockedHours: [],
  blockedDates: [],
  notes: "",
  priority: "preferred",
};

/**
 * Returnerar true om det givna tidsintervallet (start..end, lokal tid) bryter
 * mot leveranspreferensen. Används av backend (sätter outsidePreferredWindow)
 * och UI för förhandsgranskning.
 */
export function isOutsidePreferredWindow(
  prefs: DeliveryPreferences | null | undefined,
  windowStart: Date | string | null | undefined,
  windowEnd: Date | string | null | undefined,
): boolean {
  if (!prefs || !windowStart) return false;
  const start = windowStart instanceof Date ? windowStart : new Date(windowStart);
  const end = windowEnd ? (windowEnd instanceof Date ? windowEnd : new Date(windowEnd)) : start;
  if (Number.isNaN(start.getTime())) return false;

  const isoDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  if ((prefs.blockedDates || []).includes(isoDate)) return true;

  const weekday = start.getDay();
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = end.getHours() * 60 + end.getMinutes();

  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };

  const dayWindows = (prefs.weeklyWindows || []).filter((w) => w.weekday === weekday);
  if (dayWindows.length > 0) {
    const fits = dayWindows.some((w) => startMin >= toMin(w.start) && endMin <= toMin(w.end));
    if (!fits) return true;
  }

  for (const bh of prefs.blockedHours || []) {
    if (bh.weekdays && bh.weekdays.length > 0 && !bh.weekdays.includes(weekday)) continue;
    const bStart = toMin(bh.start);
    const bEnd = toMin(bh.end);
    if (startMin < bEnd && endMin > bStart) return true;
  }

  return false;
}

export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true })
  .extend({
    deliveryPreferences: deliveryPreferencesSchema.nullish(),
    hierarchyType: z.enum(CUSTOMER_HIERARCHY_TYPES).nullish(),
    parentCustomerId: z.string().nullish(),
    isReseller: z.boolean().optional(),
  });
export const insertCustomerRelationshipSchema = createInsertSchema(customerRelationships)
  .omit({ id: true, createdAt: true })
  .extend({
    relationshipType: z.enum(CUSTOMER_RELATIONSHIP_TYPES),
    validFrom: z.coerce.date().nullish(),
    validTo: z.coerce.date().nullish(),
  });
export const insertObjectSchema = createInsertSchema(objects).omit({ id: true, createdAt: true })
  .extend({
    // Task #634: språkmärkta visningsnamn (lang → namn), aldrig kolumn E.
    nameTranslations: z.record(z.string(), z.string()).nullish(),
    // Task #990: platstyp — endast giltiga enum-värden (legacy NULL tillåts).
    locationType: z.enum(OBJECT_LOCATION_TYPES).nullish(),
  });
export const insertResourceSchema = createInsertSchema(resources).omit({ id: true, createdAt: true });
// OBS: location_requirement lämnas som native nullable text i insert-schemat
// (inte z.enum) — annars smalnar Insert-typen av under select-typens `string | null`
// och bryter befintliga "läs WO-rad → Partial → updateWorkOrder"-anrop (mobile/sync).
// Enum-värdena (§5 A) valideras i stället på route-nivå där klient-input tas emot.
export const insertWorkOrderSchema = createInsertSchema(workOrders).omit({ id: true, createdAt: true });
export const insertWorkOrderLineSchema = createInsertSchema(workOrderLines).omit({ id: true, createdAt: true, completedAt: true });
export const insertWorkOrderObjectSchema = createInsertSchema(workOrderObjects).omit({ id: true, createdAt: true });
export const insertSimulationScenarioSchema = createInsertSchema(simulationScenarios).omit({ id: true, createdAt: true });
export const insertSetupTimeLogSchema = createInsertSchema(setupTimeLogs).omit({ id: true, createdAt: true });
export const insertProcurementSchema = createInsertSchema(procurements).omit({ id: true, createdAt: true });
// Task #835: konsoliderad artikelmatchning. Ett villkor i articles.associationRules.
// AND-kombineras. Bakåtkompatibel back-fill från hookLevel/objectTypes/associationLabel.
export const associationConditionSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("metadata"),
    // Katalogreferens: metadataKatalog.beteckning eller .namn (immutabla nycklar i bruk).
    label: z.string().trim().min(1),
    operator: z.enum([
      "equals", "greater", "less", "has_value",
      // legacy-operatorer behålls för befintliga enkel-villkor
      "contains", "starts_with", "not_equals",
    ]).default("equals"),
    // has_value behöver inget värde
    value: z.string().optional(),
  }),
  z.object({
    source: z.literal("hook_level"),
    level: z.string().trim().min(1),
    conditions: z.object({
      container_type: z.string().optional(),
      min_volume: z.number().optional(),
      requires_access_code: z.boolean().optional(),
    }).partial().optional(),
  }),
  z.object({
    source: z.literal("object_type"),
    types: z.array(z.string()).default([]),
  }),
]);
export type AssociationCondition = z.infer<typeof associationConditionSchema>;

// "Ny artikel"-layoutspec: rad-/kort-scheman för jsonb-fälten på articles.
export const articleFileSchema = z.object({
  name: z.string().trim().min(1),
  url: z.string().trim().min(1),
  size: z.number().nullable().optional(),
});
export const articleStockLocationSchema = z.object({
  location: z.string().trim().min(1, "Lagerplats krävs"),
  balance: z.number().nullable().optional(),
  minLevel: z.number().nullable().optional(),
  reorderPoint: z.number().nullable().optional(),
});
export const articleInformationRequirementSchema = z.object({
  type: z.string().trim().min(1),
  required: z.boolean().default(false),
  metadataField: z.string().nullable().optional(),
});
// Sektion "Visa och uppdatera metadata": rader i de två repeterbara listorna.
export const articleShowMetadataFieldSchema = z.object({
  metadataField: z.string().trim().min(1),
  clarification: z.string().trim().max(120).optional(),
  canUpdate: z.boolean().default(false),
});
export const articleLeaveMetadataFieldSchema = z.object({
  metadataField: z.string().trim().min(1),
  instruction: z.string().trim().max(240).optional(),
  required: z.boolean().default(false),
});

export const insertArticleSchema = createInsertSchema(articles).omit({ id: true, createdAt: true }).extend({
  // Task #834: hård gräns 50 tecken på artikelnamn (validering speglas i frontend-räknaren).
  name: z.string().trim().min(1, "Namn krävs").max(50, "Namnet får vara högst 50 tecken"),
  // Task #835: validera regelarrayen vid skrivning.
  associationRules: z.array(associationConditionSchema).optional(),
  // "Ny artikel"-layoutspec: jsonb-arrayer + valfri FK.
  files: z.array(articleFileSchema).optional(),
  stockLocations: z.array(articleStockLocationSchema).optional(),
  informationRequirements: z.array(articleInformationRequirementSchema).optional(),
  showMetadataFields: z.array(articleShowMetadataFieldSchema).optional(),
  leaveMetadataFields: z.array(articleLeaveMetadataFieldSchema).optional(),
  competencyRequirements: z.array(z.string()).optional(),
  defaultSupplierId: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().nullable().optional()),
  // Valfria FK-kolumner: frontend skickar "" när inget valts. Tom sträng bryter
  // FK-constraints (articles_replaces/replacement_article_id_articles_id_fk → 23503
  // "Key (...)=() is not present"). Tvinga "" → null vid valideringsgränsen så att
  // både POST och PATCH (partial) hanteras korrekt.
  replacesArticleId: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().nullable().optional()),
  replacementArticleId: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().nullable().optional()),
});
export const insertArticleTypeDefinitionSchema = createInsertSchema(articleTypeDefinitions).omit({ id: true, createdAt: true }).extend({
  key: z.string().trim().min(1, "Nyckel krävs").max(50, "Nyckeln får vara högst 50 tecken"),
  label: z.string().trim().min(1, "Visningsnamn krävs").max(80, "Visningsnamnet får vara högst 80 tecken"),
});
export const insertExecutionCodeDefinitionSchema = createInsertSchema(executionCodeDefinitions).omit({ id: true, createdAt: true }).extend({
  key: z.string().trim().min(1, "Nyckel krävs").max(50, "Nyckeln får vara högst 50 tecken"),
  label: z.string().trim().min(1, "Visningsnamn krävs").max(80, "Visningsnamnet får vara högst 80 tecken"),
});
export const insertIconDefinitionSchema = createInsertSchema(iconDefinitions).omit({ id: true, createdAt: true }).extend({
  key: z.string().trim().min(1, "Nyckel krävs").max(50, "Nyckeln får vara högst 50 tecken"),
  label: z.string().trim().min(1, "Visningsnamn krävs").max(80, "Visningsnamnet får vara högst 80 tecken"),
  // lucideName är alltid fallback och behåller sitt default ("package") om utelämnad.
  lucideName: z.string().trim().min(1).max(60).optional(),
  iconType: z.enum(["lucide", "emoji", "image"]).optional(),
  symbol: z.string().trim().max(16, "Symbolen får vara högst 16 tecken").nullish(),
  imageUrl: z.string().trim().max(2048).nullish(),
});
export const insertPriceListSchema = createInsertSchema(priceLists)
  .omit({ id: true, createdAt: true })
  .extend({
    validFrom: z.coerce.date().nullish(),
    validTo: z.coerce.date().nullish(),
  });
export const insertPriceListArticleSchema = createInsertSchema(priceListArticles).omit({ id: true, createdAt: true });
export const insertResourceArticleSchema = createInsertSchema(resourceArticles).omit({ id: true, createdAt: true });
export const insertVehicleSchema = createInsertSchema(vehicles).omit({ id: true, createdAt: true });
export const insertEquipmentSchema = createInsertSchema(equipment).omit({ id: true, createdAt: true });
export const insertResourceVehicleSchema = createInsertSchema(resourceVehicles).omit({ id: true, createdAt: true });
export const insertResourceEquipmentSchema = createInsertSchema(resourceEquipment).omit({ id: true, createdAt: true });
export const insertResourceAvailabilitySchema = createInsertSchema(resourceAvailability).omit({ id: true, createdAt: true });
export const insertVehicleScheduleSchema = createInsertSchema(vehicleSchedule).omit({ id: true, createdAt: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true });
export const insertTeamSchema = createInsertSchema(teams).omit({ id: true, createdAt: true }).extend({
  // Task #1041: sanera ruttoptimerings-premisser. nullish() = valfri + null tillåts
  // (NULL = faller tillbaka på tenant/motor-default).
  groupingRadiusMeters: z.number().int().min(1).max(100000).nullish(),
  workPacePercent: z.number().int().min(1).max(1000).nullish(),
  streetSideGrouping: z.boolean().nullish(),
  maxWalkingDistanceMeters: z.number().int().min(1).max(100000).nullish(),
});
export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({ id: true, createdAt: true });
export const insertPlanningParameterSchema = createInsertSchema(planningParameters).omit({ id: true, createdAt: true });
export const insertResourcePositionSchema = createInsertSchema(resourcePositions).omit({ id: true, recordedAt: true });

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type CustomerRelationship = typeof customerRelationships.$inferSelect;
export type InsertCustomerRelationship = z.infer<typeof insertCustomerRelationshipSchema>;
// ADR v3: objects.customer_id-kolumnen är borttagen, men API-kontraktet exponerar
// fortfarande `customerId` som en overlay härledd från primär object_payers
// (se objectColumnsWithPrimaryCustomer / primaryPayerCustomerIdSql). Intersection-
// typen säkerställer att alla läsare fortsatt ser customerId på ett ServiceObject.
export type ServiceObject = typeof objects.$inferSelect & { customerId: string | null };
export type InsertObject = z.infer<typeof insertObjectSchema>;
export type Resource = typeof resources.$inferSelect;
export type InsertResource = z.infer<typeof insertResourceSchema>;
export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;
export type WorkOrderWithObject = WorkOrder & {
  objectName: string | null;
  // Task #638: språkmärkta visningsnamn för objektet (lang → namn). Påverkar
  // aldrig kolumn E — endast hur namnet renderas i valt UI-språk.
  objectNameTranslations?: Record<string, string> | null;
  objectAddress: string | null;
  // Åtkomstinformation från objektet
  objectAccessCode: string | null;
  objectKeyNumber: string | null;
  // Kundnamn för snabb referens
  customerName: string | null;
  // Objektets koordinater - säkerhetsnät om task_latitude/longitude saknas
  objectLatitude?: number | null;
  objectLongitude?: number | null;
  // Klumpnamn för snabb visning i veckoplaneringen (Task #1271)
  stopClusterName?: string | null;
  routeClusterName?: string | null;
};
// Grovplanering — serveraggregat per vecka (Task #795). Färdiga summor så att
// klienten slipper hämta + summera hela orderlistan.
export type RoughPlanningSummary = {
  week: string;
  districtId: string | null;
  totals: {
    count: number;
    valueOre: number;
    demandHours: number;
    capacityHours: number;
  };
  byTeam: Array<{
    teamId: string | null;
    count: number;
    demandHours: number;
    valueOre: number;
  }>;
  byDistrict: Array<{
    districtId: string | null;
    count: number;
    demandHours: number;
    valueOre: number;
  }>;
  statusCounts: Array<{ status: string; count: number }>;
  // Geografisk tyngdpunkt (Task #877): medel av ordrarnas koordinater för veckan
  // (+ ev. distriktsfilter). "Närmaste ort" approximeras via närmaste distrikts-
  // centrum (haversine) — flyktigt, ingen DB-persistering. null när inga
  // grovplanerade ordrar har koordinater.
  tyngdpunkt: {
    lat: number;
    lng: number;
    pointCount: number;
    nearestDistrictId: string | null;
    nearestDistrictName: string | null;
  } | null;
};

// Flerveckors tyngdpunkts-rad (Task #877). En rad per vecka i ett spann.
export type RoughPlanningTyngdpunktWeek = {
  week: string;
  lat: number | null;
  lng: number | null;
  pointCount: number;
  orderCount: number;
  valueOre: number;
  demandHours: number;
  nearestDistrictId: string | null;
  nearestDistrictName: string | null;
};

// Kart-punkt för grovplanerade ordrar en given vecka (Task #877).
export type RoughPlanningMapPoint = {
  id: string;
  lat: number;
  lng: number;
  districtId: string | null;
  valueOre: number;
  title: string | null;
  objectName: string | null;
};

export type SetupTimeLog = typeof setupTimeLogs.$inferSelect;
export type InsertSetupTimeLog = z.infer<typeof insertSetupTimeLogSchema>;
export type Procurement = typeof procurements.$inferSelect;
export type InsertProcurement = z.infer<typeof insertProcurementSchema>;
export type Article = typeof articles.$inferSelect;
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type ArticleTypeDefinition = typeof articleTypeDefinitions.$inferSelect;
export type InsertArticleTypeDefinition = z.infer<typeof insertArticleTypeDefinitionSchema>;
export type ExecutionCodeDefinition = typeof executionCodeDefinitions.$inferSelect;
export type InsertExecutionCodeDefinition = z.infer<typeof insertExecutionCodeDefinitionSchema>;
export type IconDefinition = typeof iconDefinitions.$inferSelect;
export type InsertIconDefinition = z.infer<typeof insertIconDefinitionSchema>;

export const taskMetadataUpdates = pgTable("task_metadata_updates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id),
  metadataLabel: text("metadata_label").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value").notNull(),
  updatedBy: varchar("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_task_metadata_updates_wo").on(table.workOrderId),
  index("idx_task_metadata_updates_obj").on(table.objectId),
]);

export const insertTaskMetadataUpdateSchema = createInsertSchema(taskMetadataUpdates).omit({ id: true, updatedAt: true });
export type TaskMetadataUpdate = typeof taskMetadataUpdates.$inferSelect;
export type InsertTaskMetadataUpdate = z.infer<typeof insertTaskMetadataUpdateSchema>;

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
  "omojlig",
  "avbruten"
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
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
  publishedAt: timestamp("published_at"),
});

// User Tenant Roles - Links users to tenants with roles
export const userTenantRoles = pgTable("user_tenant_roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Role: owner, admin, user
  role: varchar("role", { length: 20 }).default("user").notNull(),
  // Additional permissions (JSON array)
  permissions: jsonb("permissions").default([]),
  // Status
  isActive: boolean("is_active").default(true),
  // Assigned by
  assignedBy: varchar("assigned_by").references(() => users.id, { onDelete: 'set null' }),
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
  invitedBy: varchar("invited_by").references(() => users.id, { onDelete: 'set null' }),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  usedBy: varchar("used_by").references(() => users.id, { onDelete: 'set null' }),
  usedAt: timestamp("used_at"),
  expiresAt: timestamp("expires_at"),
  // Resend message-id (sätts vid lyckad sendEmail). Används för att korrelera
  // webhook-events (email.delivered/bounced/complained) tillbaka till denna rad.
  resendMessageId: varchar("resend_message_id", { length: 128 }),
  // Leveransstatus från Resend: null (ej skickat), "sent" (200 OK från API),
  // "delivered" (webhook), "bounced", "complained", "failed".
  deliveryStatus: varchar("delivery_status", { length: 20 }),
  deliveryStatusAt: timestamp("delivery_status_at"),
  // Fritext-felmeddelande från Resend (t.ex. "The traivo.se domain is not verified").
  deliveryError: text("delivery_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_invitations_email").on(table.email),
  index("idx_invitations_tenant").on(table.tenantId),
  index("idx_invitations_status").on(table.status),
  index("idx_invitations_resend_message").on(table.resendMessageId),
]);

export const invitationsRelations = relations(invitations, ({ one }) => ({
  tenant: one(tenants, { fields: [invitations.tenantId], references: [tenants.id] }),
  invitedByUser: one(users, { fields: [invitations.invitedBy], references: [users.id] }),
}));

export const insertInvitationSchema = createInsertSchema(invitations).omit({ id: true, createdAt: true });
export type Invitation = typeof invitations.$inferSelect;
export type InsertInvitation = z.infer<typeof insertInvitationSchema>;

// Magic Link Tokens — engångs-tokens för e-postbaserad inloggning.
// Token-värdet lagras som SHA-256-hash; råtoken finns bara i e-postlänken.
// Konsumeras en gång inom expiresAt-fönstret (default 15 min).
export const magicLinkTokens = pgTable("magic_link_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull(),
  // Frivillig koppling till en invitation-rad. Sätts när tokenen utfärdas i samband
  // med en invitation; null för retur-inloggningar av redan medlem.
  invitationId: varchar("invitation_id").references(() => invitations.id, { onDelete: 'set null' }),
  // Frivillig hint om vilken tenant länken hör till (loggning).
  tenantId: varchar("tenant_id").references(() => tenants.id),
  requestedIp: varchar("requested_ip", { length: 45 }),
  requestedUserAgent: text("requested_user_agent"),
  consumedAt: timestamp("consumed_at"),
  consumedIp: varchar("consumed_ip", { length: 45 }),
  consumedUserAgent: text("consumed_user_agent"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_magic_link_tokens_email").on(table.email),
  index("idx_magic_link_tokens_expires").on(table.expiresAt),
]);

export const insertMagicLinkTokenSchema = createInsertSchema(magicLinkTokens).omit({ id: true, createdAt: true });
export type MagicLinkToken = typeof magicLinkTokens.$inferSelect;
export type InsertMagicLinkToken = z.infer<typeof insertMagicLinkTokenSchema>;

// Audit Logs - Track all changes in the system
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'set null' }),
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
  index("idx_audit_logs_tenant_created").on(table.tenantId, table.createdAt),
  // Task #510: snabbare filtrering av platform-logins-vyn (action IN auth.login*)
  index("idx_audit_logs_login_created")
    .on(table.action, table.createdAt.desc())
    .where(sql`action LIKE 'auth.login%'`),
  index("idx_audit_logs_login_method")
    .on(sql`(metadata->>'method')`)
    .where(sql`action LIKE 'auth.login%'`),
  index("idx_audit_logs_login_email")
    .on(sql`(metadata->>'email')`)
    .where(sql`action LIKE 'auth.login%'`),
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

// Task #1188: Uppgiftens tidslogg (händelselogg). Append-only per uppgift —
// varje statusövergång och tidsstämpel (önskad→planerad→verklig, plus studsar
// grov↔fin och ombokningar) skrivs som en NY rad och skrivs ALDRIG över.
// Fristående från audit_logs (generisk fält-diff) och additiv/expand-contract:
// befintliga in-place-fält på work_orders lämnas orörda; detta är en logg vid
// sidan om. Statusvärdena speglar det låsta kontraktet (deriveUppgiftStatus) —
// loggen läser kontraktet, den omdefinierar det aldrig.
export const TASK_EVENT_TYPES = [
  "status_changed",       // kanonisk uppgiftsstatus ändrad (från→till)
  "bounce",               // studs grov↔fin (planned_rough ↔ planned_fine)
  "rescheduled",          // ombokning: schemalagt datum/starttid ändrad
  "resource_reassigned",  // resurs ombokad
  "desired_window_set",   // önskad leveranstid satt/ändrad
  "planned_window_set",   // planerad tid (tidsfönster) satt/ändrad
  "en_route",             // verklig: på väg (onWayAt) — även mobil "dispatched"
  "arrived",              // verklig: på plats (onSiteAt)
  "completed",            // verklig: utförd (completedAt)
  "impossible",           // verklig: omöjlig att utföra (impossibleAt)
  // Task #1236: en aktiv uppgift åt gången + klump-tidsfördelning.
  "auto_completed",       // verklig: auto-avslutad för att en ny uppgift startades (samma resurs)
  "actual_time_distributed", // verklig tid fördelad proportionerligt över klumpens uppgifter
  "actual_time_adjusted", // verklig tid manuellt justerad av behörig användare
] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

// Vilken av tidslinjens tre axlar händelsen hör till.
export const TASK_EVENT_TIME_KINDS = ["onskad", "planerad", "verklig"] as const;
export type TaskEventTimeKind = (typeof TASK_EVENT_TIME_KINDS)[number];

export const taskEvents = pgTable("task_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id, { onDelete: "cascade" }).notNull(),
  // TASK_EVENT_TYPES (otypad text för bakåtkompatibilitet/expand-contract).
  eventType: text("event_type").notNull(),
  // TASK_EVENT_TIME_KINDS — vilken tidslinjeaxel (null för rena statusbyten).
  timeKind: text("time_kind"),
  // Kanonisk uppgiftsstatus (UPPGIFT_STATUSES) före/efter — endast för status_changed.
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  // Aktör: user | resource | system.
  actorType: text("actor_type"),
  actorId: varchar("actor_id"),
  // Fri detalj (gammalt/nytt datum, resurs, orsak, m.m.).
  detail: jsonb("detail").default({}),
  // När händelsen faktiskt inträffade (kan vara en fångad verklig-tidsstämpel).
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_task_events_work_order").on(table.workOrderId, table.occurredAt),
  index("idx_task_events_tenant").on(table.tenantId),
]);

export const taskEventsRelations = relations(taskEvents, ({ one }) => ({
  tenant: one(tenants, { fields: [taskEvents.tenantId], references: [tenants.id] }),
  workOrder: one(workOrders, { fields: [taskEvents.workOrderId], references: [workOrders.id] }),
}));

// Insert schemas
export const insertBrandingTemplateSchema = createInsertSchema(brandingTemplates).omit({ id: true, createdAt: true });
export const insertTenantBrandingSchema = createInsertSchema(tenantBranding).omit({ id: true, createdAt: true });
export const insertUserTenantRoleSchema = createInsertSchema(userTenantRoles).omit({ id: true, createdAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export const insertTaskEventSchema = createInsertSchema(taskEvents)
  .omit({ id: true, createdAt: true })
  .extend({ occurredAt: z.coerce.date().optional() });

// Types
export type BrandingTemplate = typeof brandingTemplates.$inferSelect;
export type InsertBrandingTemplate = z.infer<typeof insertBrandingTemplateSchema>;
export type TenantBranding = typeof tenantBranding.$inferSelect;
export type InsertTenantBranding = z.infer<typeof insertTenantBrandingSchema>;
export type UserTenantRole = typeof userTenantRoles.$inferSelect;
export type InsertUserTenantRole = z.infer<typeof insertUserTenantRoleSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type TaskEvent = typeof taskEvents.$inferSelect;
export type InsertTaskEvent = z.infer<typeof insertTaskEventSchema>;

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
  installedBy: varchar("installed_by").references(() => users.id, { onDelete: 'set null' }),
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

// Task #582: Telink-integrationskonfiguration (per tenant).
// Separat tabell — INTE tenant.settings JSON — så apiKey aldrig
// hamnar i bredare settings-läsningar, loggar eller debug-utskrifter.
export const telinkConfig = pgTable("telink_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  baseUrl: text("base_url").notNull().default(""),
  apiKey: text("api_key").notNull().default(""),
  contactNameFieldKey: varchar("contact_name_field_key", { length: 100 }).notNull().default("kontakt_namn"),
  contactPhoneFieldKey: varchar("contact_phone_field_key", { length: 100 }).notNull().default("kontakt_telefon"),
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
  uniqueIndex("uq_fortnox_mappings_tenant_entity_fortnox").on(table.tenantId, table.entityType, table.fortnoxId),
]);

// Fakturaexport-logg
export const fortnoxInvoiceExports = pgTable("fortnox_invoice_exports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id"),
  fortnoxInvoiceNumber: varchar("fortnox_invoice_number"),
  // pending, processing, exported, failed, cancelled, credited
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  costCenter: varchar("cost_center"),
  project: varchar("project"),
  payerId: varchar("payer_id"),
  totalAmount: integer("total_amount"),
  errorMessage: text("error_message"),
  isCreditInvoice: boolean("is_credit_invoice").default(false),
  originalExportId: varchar("original_export_id"),
  creditedByExportId: varchar("credited_by_export_id"),
  sourceType: varchar("source_type", { length: 20 }).default("work_order"),
  sourceId: varchar("source_id"),
  customerId: varchar("customer_id"),
  exportedAt: timestamp("exported_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // === Task #1243: rikt exportlogg-spårningsfält ===
  // Räknare för hela exportens livstid (kan innehålla flera anrop/attempts).
  // ExternalInvoiceReference2 mot Fortnox = detta exportId (id), vilket
  // gör att en efterföljande retry kan hitta en redan skapad faktura (idempotens).
  retryCount: integer("retry_count").default(0).notNull(),
  apiCallCount: integer("api_call_count").default(0).notNull(),
  totalWaitMs: integer("total_wait_ms").default(0).notNull(),
  errorCode: varchar("error_code", { length: 40 }),
  triggeredByUserId: varchar("triggered_by_user_id"),
}, (table) => [
  index("idx_fortnox_exports_tenant").on(table.tenantId),
  index("idx_fortnox_exports_work_order").on(table.workOrderId),
  index("idx_fortnox_exports_status").on(table.status),
]);

// Task #1243: attempt-nivå audit-logg per export (retries, väntetid, API-anrop,
// felkoder) — en rad per faktiskt HTTP-anrop/försök mot Fortnox, för fullt
// auditerbar spårbarhet i UI utöver summeringsfälten på exportraden ovan.
export const fortnoxExportLogEntries = pgTable("fortnox_export_log_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  exportId: varchar("export_id").references(() => fortnoxInvoiceExports.id).notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  action: varchar("action", { length: 40 }).notNull(), // create_invoice, credit_invoice, idempotency_check, ...
  result: varchar("result", { length: 20 }).notNull(), // success, error, retry, skipped
  httpStatus: integer("http_status"),
  errorCode: varchar("error_code", { length: 40 }),
  errorMessage: text("error_message"),
  waitMs: integer("wait_ms").default(0),
  durationMs: integer("duration_ms"),
  userId: varchar("user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_fortnox_export_log_export").on(table.exportId),
  index("idx_fortnox_export_log_tenant").on(table.tenantId),
]);
export const insertFortnoxExportLogEntrySchema = createInsertSchema(fortnoxExportLogEntries).omit({ id: true, createdAt: true });
export type FortnoxExportLogEntry = typeof fortnoxExportLogEntries.$inferSelect;
export type InsertFortnoxExportLogEntry = z.infer<typeof insertFortnoxExportLogEntrySchema>;

// Manuella fakturarader (ej kopplade till arbetsordrar)
export const manualInvoiceLines = pgTable("manual_invoice_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id),
  description: text("description").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  unitPrice: integer("unit_price").default(0).notNull(),
  costCenter: varchar("cost_center"),
  project: varchar("project"),
  notes: text("notes"),
  invoiceExportId: varchar("invoice_export_id"),
  status: varchar("status", { length: 20 }).default("draft").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_manual_invoice_lines_tenant").on(table.tenantId),
  index("idx_manual_invoice_lines_customer").on(table.customerId),
  index("idx_manual_invoice_lines_status").on(table.status),
]);

// ============================================
// MULTIPLA BETALARE PER OBJEKT
// ============================================

// Betalare kopplade till objekt
// ============================================
// FAKTURAMOTTAGARE PER KUND (ADR v3 §2.3 — Task #556)
// ============================================
// Tre nivåer (central/area/local) bundna till en kund i hierarkin. Resolver
// söker uppåt via parent_customer_id; närmaste nivå vinner. breaks_inheritance
// kapar arv neråt (oavsett om denna nivå har egna rader). priority bryter
// ties på samma nivå/kund. Soft delete via valid_from/valid_to (immutabelt
// efter frysning på WO).
export const INVOICE_RECIPIENT_LEVELS = ["central", "area", "local"] as const;
export type InvoiceRecipientLevel = typeof INVOICE_RECIPIENT_LEVELS[number];
export const INVOICE_RECIPIENT_LEVEL_LABELS: Record<InvoiceRecipientLevel, string> = {
  central: "Central",
  area: "Område",
  local: "Lokal",
};

export const invoiceRecipients = pgTable("invoice_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  level: text("level").notNull(),
  recipientName: text("recipient_name").notNull(),
  recipientEmail: text("recipient_email"),
  recipientAddress: text("recipient_address"),
  recipientPostalCode: text("recipient_postal_code"),
  recipientCity: text("recipient_city"),
  recipientReference: text("recipient_reference"),
  fortnoxCustomerId: varchar("fortnox_customer_id"),
  // True = kapa arv neråt. Lägre kunder ärver inte denna konfiguration.
  breaksInheritance: boolean("breaks_inheritance").default(false).notNull(),
  // Högre = vinner när flera kandidater finns på samma kund/nivå.
  priority: integer("priority").default(1).notNull(),
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  notes: text("notes"),
  // Task #569: spårar vilken import-batch som skapade raden, så rollback kan
  // hitta exakt vilka rader en batch lade till. NULL = ej importerad (manuell).
  importBatchId: text("import_batch_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_invoice_recipients_tenant").on(table.tenantId),
  index("idx_invoice_recipients_customer").on(table.customerId),
  index("idx_invoice_recipients_tenant_customer_level").on(table.tenantId, table.customerId, table.level),
  index("idx_invoice_recipients_import_batch").on(table.importBatchId),
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
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
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

// Etapp 5 (Task #1217): tabellen object_time_restrictions är borttagen.
// Källan är metadata-fältet "Tidsrestriktioner"; motorerna läser vyn
// ObjectTimeRestrictionView (server/services/object-time-restrictions.ts).
// Kompat-typ för klient/planner (speglar den gamla radformen):
export interface ObjectTimeRestriction {
  id: string;
  tenantId: string;
  objectId: string;
  restrictionType: string;
  description: string | null;
  weekdays: number[] | null;
  startTime: string | null;
  endTime: string | null;
  isBlockingAllDay: boolean | null;
  validFromDate: Date | string | null;
  validToDate: Date | string | null;
  recurrenceInterval: number | null;
  recurrenceUnit: string | null;
  preference: string;
  reason: string | null;
  isActive: boolean | null;
  createdAt: Date | string | null;
}
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
  // Task #901 (B8): hämta leveranstid från objektets metadatafält
  // (metadata_katalog.namn) istället för fast deliverySchedule/scheduledDate.
  // NULL/tom = oförändrat beteende. Vid /execute läses värdet per objekt
  // (ärvningsmedvetet via getArticleMetadataForObject) och tolkas som datum/
  // datetime; saknas/ogiltigt ⇒ fallback till scheduledDate.
  deliveryTimeMetadataField: text("delivery_time_metadata_field"),
  
  // === ABONNEMANG (Subscription) ===
  washesPerYear: integer("washes_per_year"),
  pricePerUnit: real("price_per_unit"),
  monthlyFee: real("monthly_fee"), // Fast månadsavgift per enhet
  billingFrequency: text("billing_frequency").default("monthly"), // monthly, quarterly, yearly
  contractLockMonths: integer("contract_lock_months"), // Bindningstid i månader
  contractLock: boolean("contract_lock").default(false),
  subscriptionMetadataField: text("subscription_metadata_field"), // Metadata-nyckel för antal (t.ex. "antal_karl")
  // Task #1187 (Abonnemang 0-faktura & kvittning): kvittningsartikel som pekas ut
  // per abonnemangskoncept. När en abonnemangstäckt uppgift utförs och materialiseras
  // läggs en NEGATIV kvittningsrad (denna artikel, −Σ ordinarie rader) på WO:n så att
  // nettot blir 0 — abonnemangsavgiften bär intäkten, uppgiften dubbelfaktureras aldrig.
  // NULL = ingen kvittningsartikel vald ⇒ täckta uppgifter läggs INTE i fakturakön
  // (fail-closed, se assignment-invoice-materializer). Nullable (expand-contract).
  settlementArticleId: varchar("settlement_article_id").references(() => articles.id),
  
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
  // Task #995: versionsmarkör för wizardens stegnumrering. 1 = ursprunglig ordning
  // (Namn&Kund först, Inpekning på 4). >=2 = ny ordning (Inpekning först, Kund eget
  // steg). Default 1 så befintliga utkast remappas old→new vid laddning; nya/sparade
  // koncept stämplas alltid med aktuell version.
  wizardStepVersion: integer("wizard_step_version").default(1),
  customerMode: text("customer_mode").default("HARDCODED").notNull(),
  customerId: varchar("customer_id"),
  // Steg 1 — metadatafält som bär kundidentitet vid FROM_METADATA-läge
  customerMetadataField: text("customer_metadata_field"),
  invoiceLevel: text("invoice_level"),
  invoiceModel: text("invoice_model"),
  // Task #1064: invoicePeriod (invoice_period) avvecklad — billingFrequency är nu
  // enda sanningskällan för faktureringsfrekvensen (contract-steg av Task #1056).
  invoiceLock: boolean("invoice_lock").default(false),
  invoiceBrake: boolean("invoice_brake").default(false),
  // Uppgiftslogik v1 (kolumn BY+CE sammanslaget): Fakturalås — fakturera först när
  // ALLA uppgifter i fakturasegmentet är klara (ingen delleverans). Distinkt från
  // invoiceLock (=lås fakturamodell) och invoiceBrake (=attest-broms/CF). Utvärderas
  // per faktura-referens/billing-segment (en enda faktura ⇒ hela ordern). Fryses per
  // WO vid expansion. Default false = dagens beteende (expand-contract).
  requireCompleteSegmentBeforeInvoice: boolean("require_complete_segment_before_invoice").default(false),
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

  // === ADR v3 (F1): Periodicitet, fakturering, säsong ===
  // Periodicitetstolerans i dagar — periodicitetsdaemonen accepterar
  // ±tolerans från nextRunDate (Sprint F5). 0 = exakt datum.
  toleranceDays: integer("tolerance_days").default(0),
  // Faktureringsmodell: 'per_task' (default — fakturera vid utförd WO),
  // 'monthly' (annual_planned_value/12 per månad), 'quarterly' (/4).
  // Befintliga koncept = 'per_task' (oförändrat beteende).
  billingMode: text("billing_mode").default("per_task"),
  // Årligt planerat fakturavärde — bas för månads-/kvartalsfakturering
  // när billing_mode != 'per_task'. Sätts manuellt eller via aggregering.
  annualPlannedValue: real("annual_planned_value"),
  // Mänskbar säsongsetikett (t.ex. "Vårtvätt 2026", "Hösttvätt 2026").
  // Inget enum — tenanten väljer terminologi.
  seasonName: text("season_name"),

  // === SESSION 9B: 7-stegs orderkoncept-wizard ===
  // Steg 1 — meddelande till utföraren (beskrivning = befintlig description)
  executorMessage: text("executor_message"),
  // Steg 2 — prislista + prismodell + kundreferenser
  priceListId: varchar("price_list_id").references(() => priceLists.id),
  priceModel: text("price_model").default("running"), // 'running' (löpande) | 'fixed' (fast pris)
  fixedPriceAmount: integer("fixed_price_amount"), // öre, gäller när priceModel='fixed'
  // Task #1055: bas för det fasta priset — styr hur fixedPriceAmount appliceras vid
  // expansion. 'per_object' (default, dagens beteende — fast pris per träffat objekt),
  // 'per_task' (fast pris per genererad uppgift/arbetsorder) eller 'per_concept'
  // (ett fast totalbelopp för hela orderkonceptet, fördelat jämnt). Nullable/default
  // för expand-contract: äldre koncept utan kolumn tolkas som 'per_object'.
  fixedPriceBasis: text("fixed_price_basis").default("per_object"), // 'per_concept' | 'per_task' | 'per_object'
  customerReference: text("customer_reference"), // "Er referens" (hårdkodat värde när customerReferenceMode=HARDCODED)
  customerLabel: text("customer_label"), // "Er beteckning"/"Ert ordernr" (hårdkodat värde när customerLabelMode=HARDCODED)
  // === Fakturareferenser — huvud vs radnivå ===
  // Huvudreferenser styr fakturagränsen (invoice boundary) och fryses per WO vid
  // markWorkOrderReadyForInvoice. "Vår referens" (Fortnox OurReference) — konceptnivå,
  // alltid hårdkodat värde (ingen metadata-variant). "Vår beteckning"/"Ordernr"
  // (Fortnox Remarks) härleds från konceptets nummer/id och har därför ingen egen kolumn.
  ourReference: text("our_reference"),
  // Läge för "Er referens"/"Er beteckning": HARDCODED (använd customerReference/
  // customerLabel-värdet, konstant för hela konceptet) eller FROM_METADATA (läs
  // metadata_katalog.namn per objekt, ärvningsmedvetet). Default HARDCODED = dagens
  // beteende. FROM_METADATA-värden ingår i billing-segmentnyckeln (olika värden ⇒
  // olika fakturor). Nullable/default för expand-contract.
  customerReferenceMode: text("customer_reference_mode").default("HARDCODED").notNull(),
  customerReferenceMetadataField: text("customer_reference_metadata_field"),
  customerLabelMode: text("customer_label_mode").default("HARDCODED").notNull(),
  customerLabelMetadataField: text("customer_label_metadata_field"),
  // Radnivå: ordnad lista av metadata_katalog.namn vars värden renderas som
  // Fortnox-native info-rader (~50 tecken) per orderrad. NULL/tom = inga info-rader.
  invoiceRowReferenceFields: text("invoice_row_reference_fields").array(),
  // Inkludera utförarens fritext (per WO) som egen fakturarad. Default true.
  includeExecutorFreetext: boolean("include_executor_freetext").default(true),
  // === Task #1243: fakturahuvud-fält som fryses per WO vid expansion och
  // skickas till Fortnox (WayOfDelivery/TermsOfDelivery/Currency/TermsOfPayment/
  // Language). Fritext — tenanten anger Fortnox-kodvärden direkt (t.ex.
  // leveranssätt="normal", betalningsvillkor="30", språk="SV"). NULL = Fortnox
  // använder kundens/kontots default (back-compat, dagens beteende).
  deliveryMethod: text("delivery_method"),
  transportMethod: text("transport_method"),
  currency: text("currency"),
  paymentTerms: text("payment_terms"),
  invoiceLanguage: text("invoice_language"),
  // Steg 3 — faktureringsmodell + abonnemangsregler + sampackning
  invoiceMethod: text("invoice_method"), // 'afterwards' | 'scheduled' | 'subscription'
  subscriptionAdjustmentDate: timestamp("subscription_adjustment_date"), // valfritt årligt justeringsdatum (tomt = löpande)
  invoiceConsolidation: text("invoice_consolidation").default("per_job"), // 'per_job' | 'weekly' | 'monthly' | 'department'
  departmentMetadataField: text("department_metadata_field"), // metadatafält för per-avdelning-sampackning
  // Steg 4 (ADR v3) — objekt-/gren-inpekning: lagrar valda gren-ROT-objekt-id:n.
  // Upplöses live till subträd via getObjectSubtreeIds (primär parent_id-kedja,
  // tenant-scopat). Etapp 5: kluster-inpekning (targetClusterId/-Ids) är borttagen.
  targetObjectIds: text("target_object_ids").array(),
  // Steg 5 — leveranstid (tidsfönster eller intervall) + restriktioner
  deliveryTimeType: text("delivery_time_type"), // 'time_window' | 'interval'
  timeWindows: jsonb("time_windows"), // [{ months:[1..12], weekdays:[0..6], timeFrom, timeTo }]
  intervalStartDate: timestamp("interval_start_date"),
  intervalEndDate: timestamp("interval_end_date"),
  intervalFrequencyDays: integer("interval_frequency_days"),
  intervalFlexDays: integer("interval_flex_days"), // ±N dagar flexfönster för ruttoptimering
  // Task #978: Ett eller flera huvudtidsfönster som datum+tid-perioder. Varje fönster
  // bär egen frekvens/flextid. Det FÖRSTA fönstret (primärt) speglas dessutom till
  // legacy interval-kolumnerna ovan så att expansionsmotorn (buildScheduleDateTargets)
  // + simuleringen fungerar oförändrat. Övriga fönster lagras endast som planeringsstöd.
  // [{ startDate, startTime, endDate, endTime, intervalFrequencyDays?, intervalFlexDays? }]
  mainDeliveryWindows: jsonb("main_delivery_windows"),
  // Task #978: utökad form — villkor (metadatafält) + tidsregel (veckodag+start+slut)
  // + polaritet (positive=lämplig / negative=undvik) + enforcement (hard/soft) + fri text.
  // Back-compat: äldre rader har { type:'soft'|'hard', metadataKey, operator, filterValue }
  // (type mappas till enforcement, polarity defaultar till 'negative').
  // [{ metadataKey, operator, filterValue, weekdays:[0..6], timeFrom, timeTo,
  //    polarity:'positive'|'negative', enforcement:'hard'|'soft', description }]
  deliveryRestrictions: jsonb("delivery_restrictions"),

  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_order_concepts_tenant").on(table.tenantId),
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
  // Task #937: Resolverad order-/faktureringskund för uppgiften, snapshotad vid
  // orderkoncept-expansion. FROM_METADATA-koncept härleder kund per objekt från ett
  // metadatafält; HARDCODED stämplar konceptets fasta kund. Nullable (objektlösa/legacy-
  // rader saknar kund). ADR v3: detta är order-/faktureringskund — INTE objektägarskap
  // (object_payers).
  customerId: varchar("customer_id").references(() => customers.id),
  // Kluster för enkel filtrering
  clusterId: varchar("cluster_id"),
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
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
  // Task #836 (Fas 3): Beroendeuppgift-flaggor. Vid orderkoncept-expansion skapas
  // beroendeartiklar (avisering/materialleverans) som egna assignments. requiresAcknowledgment
  // kopieras från artikeln vid expand; om true måste tillgängligheten kvitteras
  // (dependencyAcknowledgedAt) innan huvuduppgiften utförs — annars varnar systemet.
  // dependencyCriticality kopieras från artikeln (binärt: 'critical' | 'skippable').
  requiresAcknowledgment: boolean("requires_acknowledgment").default(false),
  dependencyCriticality: text("dependency_criticality"),
  dependencyAcknowledgedAt: timestamp("dependency_acknowledged_at"),
  dependencyAcknowledgedBy: varchar("dependency_acknowledged_by"),
  // Task #989: Logistik-roll på uppgiften. NULL = vanlig uppgift (oförändrat beteende).
  // "pickup" = hämta på lagerplats, "deliver" = leverera på objekt. Vid orderkoncept-expansion
  // delas en varuartikel med lagerplats i en hämt- + en leverans-uppgift (hämta före leverera).
  logisticsRole: text("logistics_role"),
  // Task #1110 (Informationspaket): Utförandekoden (vem/utförandekategori) stämplas
  // på uppgiften vid orderkoncept-expansion, kopierad från artikelns executionCode.
  // Den är grunden för grovplaneringen (sortera/filtrera jobb per utförandekod över en
  // tidsperiod). Nullable (expand-contract): legacy-rader saknar värdet och faller då
  // tillbaka på derive-at-read via assignment_articles → articles.executionCode.
  executionCode: text("execution_code"),
  // Tidskod (time_code_definitions.key) fryst per uppgift vid orderkoncept-expansion,
  // kopierad från artikelns timeCodeKey. Grunden för finplanering (168h/vecka) + framtida
  // lönerapport. Nullable (expand-contract): legacy-rader saknar värdet.
  frozenTimeCode: text("frozen_time_code"),
  // Task #989: Länk från leverans-uppgiften till dess hämt-uppgift (hämta måste ske före
  // leverera). Mjuk länk: om hämt-uppgiften raderas blir fältet null (set null), inte cascade.
  parentAssignmentId: varchar("parent_assignment_id").references((): any => assignments.id, { onDelete: "set null" }),
  // === Task #997 (Tidsmotor): Fryst viktat tidsregel-paket ===
  // Hela paketet (hårda + mjuka regler med polaritet + vikt) snapshotat vid
  // orderkoncept-expansion per objekt. NULL = inga tidsregler gällde objektet →
  // dagens fallback (schemalagt datum) oförändrad.
  frozenTimeRules: jsonb("frozen_time_rules").$type<FrozenTimeRulePackage>(),
  // === Task #1124 (Informationspaket → faktura): stämplat vid orderkoncept-expansion ===
  // isFixedPrice: fast-pris-natur (snapshot av isFixedPriceConcept) — styr radkollaps
  // när uppgiften materialiseras till en fakturerbar work_order. billingMethod:
  // faktureringstyp (call_off/schedule/subscription) snapshot. exceptionStatus:
  // undantagsstatus (ej_fakturerbar/ej_genomforbar/makulerad); NULL = normal,
  // fakturerbar — styr om uppgiften materialiseras till faktura. Allt nullable
  // (expand-contract): legacy-rader är oförändrade.
  isFixedPrice: boolean("is_fixed_price").default(false),
  billingMethod: text("billing_method"),
  exceptionStatus: text("exception_status"),
  // Task #1205 (fält 54): läsbar matchningsorsak — VARFÖR objektet hakades på
  // konceptet (vilka villkor som matchade), snapshotad vid expansion. Nullable
  // (expand-contract): historiska/manuella uppgifter saknar värdet och visar "—".
  matchReason: text("match_reason"),
  // === Task #1215 (Etapp 3): Uppgiftspaketet — operativ arbetskopia ===
  // Se work_orders.uppgiftspaket. 1 logisk uppgift spänner över assignments +
  // work_orders (uppgiftskontrakt v1) — paketet finns därför på BÅDA lagren.
  uppgiftspaket: jsonb("uppgiftspaket").$type<Uppgiftspaket>(),
  // === Klumpningsmotorer (ADR klumpning v1): Alt B — fält på BÅDA tabellerna ===
  // Täcker koncept-genererade uppgifter (assignments) som ännu ej materialiserats
  // till work_orders. Se work_orders.stopClusterId för kommentarer om lock-semantik.
  stopClusterId: varchar("stop_cluster_id").references((): any => stopClusters.id, { onDelete: "set null" }),
  routeClusterId: varchar("route_cluster_id").references((): any => routeClusters.id, { onDelete: "set null" }),
  stopClusterCalculatedAt: timestamp("stop_cluster_calculated_at"),
  routeClusterCalculatedAt: timestamp("route_cluster_calculated_at"),
  clusterLockStatus: text("cluster_lock_status"),
  clusterExclusionReason: text("cluster_exclusion_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_assignments_tenant").on(table.tenantId),
  index("idx_assignments_object").on(table.objectId),
  index("idx_assignments_cluster").on(table.clusterId),
  index("idx_assignments_resource").on(table.resourceId),
  index("idx_assignments_status").on(table.status),
  index("idx_assignments_scheduled").on(table.scheduledDate),
  index("idx_assignments_tenant_status").on(table.tenantId, table.status),
  index("idx_assignments_tenant_scheduled").on(table.tenantId, table.scheduledDate),
  index("idx_assignments_tenant_resource_date").on(table.tenantId, table.resourceId, table.scheduledDate),
  index("idx_assignments_tenant_deleted").on(table.tenantId, table.deletedAt),
  index("idx_assignments_parent_assignment").on(table.parentAssignmentId),
  index("idx_assignments_stop_cluster").on(table.stopClusterId),
  index("idx_assignments_route_cluster").on(table.routeClusterId),
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
  approvedBy: varchar("approved_by").references(() => users.id, { onDelete: 'set null' }),
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
  runBy: varchar("run_by").references(() => users.id, { onDelete: 'set null' }),
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
  resource: one(resources, { fields: [assignments.resourceId], references: [resources.id] }),
  team: one(teams, { fields: [assignments.teamId], references: [teams.id] }),
  createdByUser: one(users, { fields: [assignments.createdBy], references: [users.id] }),
  articles: many(assignmentArticles),
}));

export const assignmentArticlesRelations = relations(assignmentArticles, ({ one }) => ({
  assignment: one(assignments, { fields: [assignmentArticles.assignmentId], references: [assignments.id] }),
  article: one(articles, { fields: [assignmentArticles.articleId], references: [articles.id] }),
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

// ============================================
// INSERT SCHEMAS FOR NEW TABLES
// ============================================

export const insertFortnoxConfigSchema = createInsertSchema(fortnoxConfig).omit({ id: true, createdAt: true });
export const insertFortnoxMappingSchema = createInsertSchema(fortnoxMappings).omit({ id: true, createdAt: true });
export const insertFortnoxInvoiceExportSchema = createInsertSchema(fortnoxInvoiceExports).omit({ id: true, createdAt: true });
export const insertManualInvoiceLineSchema = createInsertSchema(manualInvoiceLines).omit({ id: true, createdAt: true });
export const insertInvoiceRecipientSchema = createInsertSchema(invoiceRecipients).omit({ id: true, createdAt: true, deletedAt: true });
export const insertTaskDesiredTimewindowSchema = createInsertSchema(taskDesiredTimewindows).omit({ id: true, createdAt: true });
export const insertTaskDependencySchema = createInsertSchema(taskDependencies).omit({ id: true, createdAt: true });
export const insertTaskInformationSchema = createInsertSchema(taskInformation).omit({ id: true, createdAt: true });
export const insertObjectParentSchema = createInsertSchema(objectParents).omit({ id: true, createdAt: true });
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
export type ManualInvoiceLine = typeof manualInvoiceLines.$inferSelect;
export type InsertManualInvoiceLine = z.infer<typeof insertManualInvoiceLineSchema>;
export type InvoiceRecipient = typeof invoiceRecipients.$inferSelect;
export type InsertInvoiceRecipient = z.infer<typeof insertInvoiceRecipientSchema>;
// Task #992-cleanup: den engelska metadata_definitions/object_metadata-modellen är
// borttagen. MetadataDefinition behålls som fristående interface (ingen tabell bakom)
// eftersom /api/metadata-definitions-kompatvyn och frontend projicerar en svensk
// katalograd (metadata_katalog) till denna form. server/metadata-queries.ts aliasar
// den som MetadataDefinitionCompat.
export interface MetadataDefinition {
  id: string;
  tenantId: string;
  fieldKey: string;
  fieldLabel: string;
  dataType: string;
  propagationType: string;
  applicableLevels: string[];
  defaultValue: string | null;
  validationRules: Record<string, unknown>;
  isRequired: boolean;
  sortOrder: number;
  createdAt: Date;
  deletedAt: Date | null;
  replacedByDefinitionId: string | null;
}
export type TaskDesiredTimewindow = typeof taskDesiredTimewindows.$inferSelect;
export type InsertTaskDesiredTimewindow = z.infer<typeof insertTaskDesiredTimewindowSchema>;
export type TaskDependency = typeof taskDependencies.$inferSelect;
export type InsertTaskDependency = z.infer<typeof insertTaskDependencySchema>;
export type TaskInformation = typeof taskInformation.$inferSelect;
export type InsertTaskInformation = z.infer<typeof insertTaskInformationSchema>;
export type ObjectParent = typeof objectParents.$inferSelect;
export type InsertObjectParent = z.infer<typeof insertObjectParentSchema>;
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
// Task #381 — uppgiftskategorier för work_orders och order_concept_articles.
// 'admin'/'logistics' filtreras bort från VRP/karta/avstånd och kan saknas object_id.
export const TASK_CATEGORIES = ["field", "admin", "logistics"] as const;
export type TaskCategory = typeof TASK_CATEGORIES[number];
export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  field: "Fältuppgift",
  admin: "Administrativ",
  logistics: "Logistik",
};

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
  schedule: "Schema (periodisk)",
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
  // Uppgiftskategori (task #381) — källan för work_orders.task_category vid expansion.
  // 'field' (default) skapar en uppgift per objekt; 'admin'/'logistics' skapar
  // en uppgift per koncept-körning utan object_id.
  taskCategory: text("task_category").default("field").notNull(),
  // Platskrav (§5 A) — obligatorisk/valfri/ingen; källan för
  // work_orders.location_requirement vid expansion. NULL = härled från taskCategory.
  locationRequirement: text("location_requirement"),
  sortOrder: integer("sort_order").default(0),
  // Override för artikelns quantityMode på just denna orderkoncept-rad.
  // null = använd artikelns inställning. Värden: 'use_object_quantity' | 'single_per_task'
  quantityModeOverride: text("quantity_mode_override"),
  // Session 9B — uppgiftsrad (steg 6)
  metadataAssociation: text("metadata_association"), // var artikeln hakar fast (metadatafält)
  metadataCorrespondence: text("metadata_correspondence"), // vilket metadatafält styr antal
  isPreTask: boolean("is_pre_task").default(false), // föruppgift (plocka/beställ/föravisering)
  dependencyOffsetMinutes: integer("dependency_offset_minutes"), // negativt = före huvuduppgift (t.ex. föravisering −2 dagar)
  // Uppgiftslogik v1 (kolumn W): artikeln ingår i ett abonnemang. Ingen motor i v1 —
  // enbart en tagg som framtida abonnemangsmotor konsumerar. Statistik/räkning sker
  // oavsett flaggan. Default false (expand-contract).
  isSubscriptionArticle: boolean("is_subscription_article").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_oca_order_concept").on(table.orderConceptId),
  index("idx_oca_article").on(table.articleId),
]);

// location_requirement lämnas som native nullable text (se not vid insertWorkOrderSchema);
// enum-värdena (§5 A) valideras på route-nivå (orderConceptRoutes add/patch).
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
// UPPGIFTSTYP-REGISTER (Mats Uppdateringar 2026-06-12)
// ============================================
// Per-tenant register över uppgiftstyper som driver Uppgiftstyp-filtret i
// Grovplaneringen. `key` är den normaliserade nyckeln (se normalizeTaskType i
// server/grovplanering-grid.ts) och är JOIN-punkten mot work_orders.orderType.
// Att lagra `key` explicit gör att filtreringen fungerar UTAN att peka om
// work_orders till ett taskTypeId (expand-contract). `key` ska därför behandlas
// som IMMUTABLE när typen är i bruk (jfr metadata_katalog.namn).
export const taskTypes = pgTable("task_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_task_types_tenant_key").on(table.tenantId, table.key),
]);

export const insertTaskTypeSchema = createInsertSchema(taskTypes).omit({
  id: true,
  createdAt: true,
});
export type InsertTaskType = z.infer<typeof insertTaskTypeSchema>;
export type TaskType = typeof taskTypes.$inferSelect;

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

export const portalUsers = pgTable("portal_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  email: text("email").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqEmail: uniqueIndex("portal_users_tenant_customer_email_unique").on(t.tenantId, t.customerId, t.email),
  byCustomer: index("portal_users_customer_idx").on(t.tenantId, t.customerId),
}));

// Tomt scope (inga rader) = portal-användaren ser allt under sin kund (bakåtkompat).
// Annars: scope = listan av root-objekt (descendants ingår automatiskt vid resolve).
export const portalUserObjectScopes = pgTable("portal_user_object_scopes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portalUserId: varchar("portal_user_id").references(() => portalUsers.id, { onDelete: 'cascade' }).notNull(),
  objectId: varchar("object_id").references(() => objects.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniq: uniqueIndex("portal_user_scope_unique").on(t.portalUserId, t.objectId),
  byUser: index("portal_user_scope_user_idx").on(t.portalUserId),
}));

export const customerPortalSessions = pgTable("customer_portal_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  portalUserId: varchar("portal_user_id").references(() => portalUsers.id, { onDelete: 'cascade' }),
  sessionToken: text("session_token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastAccessedAt: timestamp("last_accessed_at").defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

// Tracks every file that a portal customer has confirmed (ACL-bound) in object
// storage.  Used for durable, cross-restart upload-quota enforcement and for
// periodic cleanup of confirmed-but-orphaned objects (files never attached to
// a change request or report).
export const portalConfirmedUploads = pgTable("portal_confirmed_uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  objectPath: text("object_path").notNull(),
  confirmedAt: timestamp("confirmed_at").defaultNow().notNull(),
}, (t) => ({
  byCustomer: index("pcu_customer_idx").on(t.tenantId, t.customerId),
  byConfirmedAt: index("pcu_confirmed_at_idx").on(t.confirmedAt),
}));

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
  handledBy: varchar("handled_by").references(() => users.id, { onDelete: 'set null' }),
  handledAt: timestamp("handled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const customerPortalMessages = pgTable("customer_portal_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  sender: text("sender").notNull(), // "customer" or "staff"
  senderUserId: varchar("sender_user_id").references(() => users.id, { onDelete: 'set null' }),
  message: text("message").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCustomerPortalTokenSchema = createInsertSchema(customerPortalTokens).omit({ id: true, requestedAt: true });
export const insertCustomerPortalSessionSchema = createInsertSchema(customerPortalSessions).omit({ id: true, createdAt: true, lastAccessedAt: true });
export const insertPortalUserSchema = createInsertSchema(portalUsers).omit({ id: true, createdAt: true });
export const insertPortalUserObjectScopeSchema = createInsertSchema(portalUserObjectScopes).omit({ id: true, createdAt: true });
export type PortalUser = typeof portalUsers.$inferSelect;
export type InsertPortalUser = z.infer<typeof insertPortalUserSchema>;
export type PortalUserObjectScope = typeof portalUserObjectScopes.$inferSelect;
export type InsertPortalUserObjectScope = z.infer<typeof insertPortalUserObjectScopeSchema>;
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
  // === ADR v3 §2.5 (Task #558): Konsoliderings-livscykel ===
  // Separat från payment-status: pending | held | consolidated | sent | cancelled.
  // pending = klar att exporteras till Fortnox direkt (policy=immediate)
  // held    = bromsad, väntar på periodens stängning
  // consolidated = WO-batch grupperad, klar för export
  // sent    = exporterad till Fortnox
  // cancelled = avbruten innan export
  state: text("state").default("pending").notNull(),
  invoiceRecipientId: varchar("invoice_recipient_id"),
  consolidationPolicyId: varchar("consolidation_policy_id"),
  consolidationPeriodStart: timestamp("consolidation_period_start"),
  consolidationPeriodEnd: timestamp("consolidation_period_end"),
  heldUntil: timestamp("held_until"),
  releasedBy: varchar("released_by"),
  releasedAt: timestamp("released_at"),
  releasedReason: text("released_reason"),
  // === Task #970: Metadatastyrd fakturaflödeslogik (audit/visning) ===
  // Speglar den vinnande WO-segmenteringen så att UI/export kan förklara varför
  // en konsoliderad faktura splittrades. NULL = ingen split (back-compat).
  billingSegmentKey: text("billing_segment_key"),
  billingBreakObjectId: varchar("billing_break_object_id"),
  billingGroupingFieldName: text("billing_grouping_field_name"),
  billingGroupingValue: text("billing_grouping_value"),
  // === Frysta fakturareferenser (audit/visning) ===
  // Speglar den vinnande WO-batchens huvudreferenser. Alla WO i en konsoliderad
  // faktura delar samma referenser eftersom FROM_METADATA-referenser ingår i
  // billingSegmentKey (HARDCODED är konstant per koncept). NULL = back-compat.
  ourReference: text("our_reference"),
  ourDesignation: text("our_designation"),
  customerReference: text("customer_reference"),
  customerInvoiceReference: text("customer_invoice_reference"),
  // === Task #1243: samma fakturahuvud-fält som work_orders.frozen* (se där) —
  // speglar den vinnande WO-batchens värden för konsoliderad export/audit.
  deliveryMethod: text("delivery_method"),
  transportMethod: text("transport_method"),
  invoiceCurrency: text("invoice_currency"),
  paymentTerms: text("payment_terms"),
  invoiceLanguage: text("invoice_language"),
}, (table) => [
  index("idx_customer_invoices_tenant_state").on(table.tenantId, table.state),
  index("idx_customer_invoices_recipient").on(table.invoiceRecipientId),
]);

export const insertCustomerInvoiceSchema = createInsertSchema(customerInvoices).omit({ id: true });
export type CustomerInvoice = typeof customerInvoices.$inferSelect;
export type InsertCustomerInvoice = z.infer<typeof insertCustomerInvoiceSchema>;

// === Konsoliderings-policy per mottagare/kund (Task #558) ===
export const INVOICE_CONSOLIDATION_PERIODS = ["immediate", "daily", "weekly", "monthly"] as const;
export type InvoiceConsolidationPeriod = typeof INVOICE_CONSOLIDATION_PERIODS[number];

export const invoiceConsolidationPolicies = pgTable("invoice_consolidation_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Antingen kund eller specifik mottagare (recipient vinner om båda satta).
  customerId: varchar("customer_id").references(() => customers.id),
  invoiceRecipientId: varchar("invoice_recipient_id").references(() => invoiceRecipients.id),
  period: text("period").notNull(), // immediate|daily|weekly|monthly
  // För weekly: 0=söndag..6=lördag (anchor day). För monthly: dag-i-månaden (1..28).
  // För daily/immediate: ignoreras.
  periodAnchor: integer("period_anchor"),
  // Skickar tidigast detta klockslag den dag perioden stänger ("HH:MM", 24h).
  releaseAtHour: integer("release_at_hour").default(6),
  active: boolean("active").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_invoice_consolidation_policies_tenant").on(table.tenantId),
  index("idx_invoice_consolidation_policies_recipient").on(table.invoiceRecipientId),
  index("idx_invoice_consolidation_policies_customer").on(table.customerId),
]);

export const insertInvoiceConsolidationPolicySchema = createInsertSchema(invoiceConsolidationPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});
export type InvoiceConsolidationPolicy = typeof invoiceConsolidationPolicies.$inferSelect;
export type InsertInvoiceConsolidationPolicy = z.infer<typeof insertInvoiceConsolidationPolicySchema>;

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
  assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: 'set null' }),
  linkedWorkOrderId: varchar("linked_work_order_id"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by").references(() => users.id, { onDelete: 'set null' }),
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

// === FORTNOX FAKTURAHISTORIK → AVTALSFÖRSLAG ===
// Återkommande artiklar härleds från historiska Fortnox-fakturor och blir förslag på tjänsteavtal
export const fortnoxContractSuggestions = pgTable("fortnox_contract_suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  importBatchId: varchar("import_batch_id").notNull(),
  customerId: varchar("customer_id").references(() => customers.id),
  fortnoxCustomerNumber: text("fortnox_customer_number").notNull(),
  customerName: text("customer_name").notNull(),
  articleNumber: text("article_number"),
  articleDescription: text("article_description").notNull(),
  occurrenceCount: integer("occurrence_count").notNull(),
  firstSeen: timestamp("first_seen").notNull(),
  lastSeen: timestamp("last_seen").notNull(),
  avgIntervalDays: real("avg_interval_days"),
  suggestedBillingCycle: text("suggested_billing_cycle").notNull(),
  avgPrice: real("avg_price"),
  avgQuantity: real("avg_quantity"),
  totalRevenue: real("total_revenue").notNull(),
  monthlyValue: real("monthly_value"),
  confidence: real("confidence"),
  status: text("status").default("pending").notNull(),
  createdContractId: varchar("created_contract_id").references(() => customerServiceContracts.id),
  rawSamples: jsonb("raw_samples").default([]),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index("idx_fortnox_contract_suggestions_tenant").on(table.tenantId),
  statusIdx: index("idx_fortnox_contract_suggestions_status").on(table.status),
  batchIdx: index("idx_fortnox_contract_suggestions_batch").on(table.importBatchId),
}));

export const insertFortnoxContractSuggestionSchema = createInsertSchema(fortnoxContractSuggestions).omit({ id: true, createdAt: true, updatedAt: true });
export type FortnoxContractSuggestion = typeof fortnoxContractSuggestions.$inferSelect;
export type InsertFortnoxContractSuggestion = z.infer<typeof insertFortnoxContractSuggestionSchema>;

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
// Detta är det ENDA kanoniska metadata-systemet — det tidigare engelska
// metadata_definitions/object_metadata-systemet är borttaget (kontraktsfas).
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
  'interval',   // Tid/Intervall (TID) - t.ex. "var 5:e månad"
  'rubrik'      // Rubrik/samlingsfält - gruppfält utan eget värde (bara en rubrik som grupperar underfält)
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
  // Visningsnamn: fritt redigerbart presentationsnamn (rätt versalisering/stavning).
  // `namn` förblir den IMMUTABLA universella matchningsnyckeln (import/order-koncept/
  // villkorsfilter/sök, skiftlägeskänslig); `visningsnamn` påverkar ENDAST UI-rendering
  // och får aldrig användas i matchning/lookup. NULL = visa `namn`. Additivt (expand-contract).
  visningsnamn: varchar("visningsnamn", { length: 100 }),
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
  
  // === KINAB ETIKETT-NAMN SYSTEM ===
  // Kort beteckningskod (t.ex. "LEV", "ANT", "KUND") — Kinab metadata designation
  beteckning: varchar("beteckning", { length: 30 }),
  // Systemmetadata som inte kan raderas (KUND, PARENT, TYP, etc.)
  isSystem: boolean("is_system").default(false).notNull(),
  // Systemlåst STRUKTUR (≠ isSystem). isSystem gör fältet read-only för VÄRDEN
  // (auto-ursprung sätter dem). systemlast låser istället DEFINITIONEN — namn/
  // beteckning/datatyp/sortOrder/parent kan ej ändras och fältet kan ej raderas —
  // men VÄRDEN är fritt redigerbara per objekt. Används för kanoniska fält som
  // alltid måste finnas i fast ordning (t.ex. geografigruppen: Standardadress +
  // Fördjupad position). Återanvändbar för fler systemlåsta fält framöver.
  // Additivt (expand-contract): default false, befintliga fält opåverkade.
  systemlast: boolean("systemlast").default(false).notNull(),
  // Obligatorisk metadata vid objektskapande
  isRequired: boolean("is_required").default(false).notNull(),
  // Tillåtna värden (dropdown) — null = fritext
  allowedValues: text("allowed_values").array(),
  // Vilken nivå som får ändra (null = alla)
  editableByLevel: varchar("editable_by_level", { length: 50 }),

  // === PDF §7/§14: Områden, presentationsnummer, dubbletter ===
  // Område för UI-gruppering: grunduppgifter, produktion, status, ekonomi
  area: text("area"),
  // Visningsnummer för ordning inom område (1, 3, 6, 9, ... — luft mellan för insättning)
  displayNumber: integer("display_number"),
  // Tillåt flera värden på samma objekt (t.ex. flera Yta-värden 90 m² + 250 m²)
  allowDuplicates: boolean("allow_duplicates").default(false).notNull(),

  // Task #579: aktivera kronologisk historik-tidslinje för detta fält
  // (Lyftkrok, Antal, Kontakt etc — PDF §14.3 + §3.2).
  kronologiskVisning: boolean("kronologisk_visning").default(false).notNull(),

  // Task #662: Metadata-familjer via överordnat fält. Nullable självreferens till
  // förälder-katalogposten — ett underfält (t.ex. kontakt.fornamn) pekar på sitt
  // gruppfält (kontakt). Punktnotation härleds i koden som förälder.namn + "." +
  // barn.namn. API:t tillåter endast EN nivå (föräldern måste vara ett rotfält).
  // FK hanteras separat (jfr koppladTillMetadataId) via migrations/0056.
  parentMetadataId: varchar("parent_metadata_id"),

  // Task #666: Beräknade metadatafält. Ett fält kan markeras som beräknat och ges
  // en formel som refererar syskonfält inom samma familj (t.ex. "langd * bredd").
  // Endast de fyra räknesätten + parenteser. Värdet härleds vid läsning (lagras
  // ej) och visas readonly. Nullable/default = back-compat (expand-contract).
  arBeraknad: boolean("ar_beraknad").default(false).notNull(),
  formel: text("formel"),

  // Task #1213: förberedd egenskap för framtida uppåt-/syskon-synk av värden.
  // INERT i v1 — ingen runtime läser den ännu; exponeras endast (avstängd) i
  // kataloginställningarna. Expand-contract: default false, befintliga fält
  // opåverkade. När motorstödet byggs (senare etapp) styr flaggan om en ändring
  // på ett barn får propageras uppåt till förälder/syskon.
  tillatUppdateringUppat: boolean("tillat_uppdatering_uppat").default(false).notNull(),

  // Task #1218 (Etapp 6): styr om fältet visas i metadata-karusellen på
  // objekt-360/mobil/export. Default true (back-compat: allt syns). Fältet
  // finns alltid kvar i admin/katalog oavsett flaggan.
  visasIKarusell: boolean("visas_i_karusell").default(true).notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),

  // Task #716: arkivering (soft-delete) istället för permanent radering.
  // NULL = aktiv metadatatyp; satt = arkiverad (dold från katalog/objektvyer,
  // återställbar via admin-arkivet). Historiska metadata_snapshot/varden påverkas ej.
  deletedAt: timestamp("deleted_at"),
  archivedBy: varchar("archived_by"),
  archivedReason: text("archived_reason"),
}, (table) => [
  index("idx_metadata_katalog_tenant_namn").on(table.tenantId, table.namn),
  index("idx_metadata_katalog_tenant_beteckning").on(table.tenantId, table.beteckning),
  index("idx_metadata_katalog_parent").on(table.parentMetadataId),
]);

// Task #663: Kundlåsta metadatafält. Ett katalogfält kan begränsas till en eller
// flera kunder via denna m2m-koppling. INGEN koppling = generellt fält (gäller
// alla kunder, back-compat). En eller flera kopplingar = kundlåst: fältet visas
// endast för objekt vars kund är en kopplad kund ELLER en ättling till en kopplad
// kund (kundhierarkin agerar "kategori" — koppling mot ett koncern/region-nav
// täcker hela undergrenen). Scope-upplösning sker i koden (metadata-queries).
export const metadataKatalogKunder = pgTable("metadata_katalog_customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  metadataKatalogId: varchar("metadata_katalog_id")
    .references(() => metadataKatalog.id, { onDelete: "cascade" })
    .notNull(),
  customerId: varchar("customer_id")
    .references(() => customers.id, { onDelete: "cascade" })
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_metadata_katalog_customers_unique").on(table.metadataKatalogId, table.customerId),
  index("idx_metadata_katalog_customers_tenant").on(table.tenantId),
  index("idx_metadata_katalog_customers_customer").on(table.tenantId, table.customerId),
]);
export type MetadataKatalogKund = typeof metadataKatalogKunder.$inferSelect;
export const insertMetadataKatalogKundSchema = createInsertSchema(metadataKatalogKunder).omit({
  id: true,
  createdAt: true,
});
export type InsertMetadataKatalogKund = z.infer<typeof insertMetadataKatalogKundSchema>;

// Objektöversikt Fas 1: konfigurerbara header-fält per objekttyp. Admin pekar in
// upp till tre metadatafält (field1..3KatalogId → metadata_katalog.id) samt
// bild-/kart-brickor som visas överst på objektsidan. Konfig gäller per
// (tenant, objectType) — objectType är samma fria sträng som objects.object_type.
// Additivt (expand-contract); saknad rad ⇒ standard-fallback i klienten
// (objekttyp + serienummer). FK ON DELETE SET NULL så att ett borttaget
// katalogfält bara nollar slotten (konfigen överlever).
export const objectHeaderConfigs = pgTable("object_header_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectType: text("object_type").notNull(),
  showImage: boolean("show_image").default(true).notNull(),
  // 'vignette' (aktuell vinjettbild) | 'latest_image' (senaste objektbild) |
  // 'metadata' (valfritt bild-metadatafält, se imageMetadataKatalogId)
  imageSource: varchar("image_source", { length: 20 }).default("vignette").notNull(),
  // Endast satt när imageSource='metadata' — pekar in ett metadata_katalog-fält
  // med datatyp='image' vars värde (vardeString) visas som objekthuvudets bild.
  imageMetadataKatalogId: varchar("image_metadata_katalog_id").references(() => metadataKatalog.id, { onDelete: "set null" }),
  showMap: boolean("show_map").default(true).notNull(),
  field1KatalogId: varchar("field1_katalog_id").references(() => metadataKatalog.id, { onDelete: "set null" }),
  field2KatalogId: varchar("field2_katalog_id").references(() => metadataKatalog.id, { onDelete: "set null" }),
  field3KatalogId: varchar("field3_katalog_id").references(() => metadataKatalog.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_object_header_config_tenant_type").on(table.tenantId, table.objectType),
  index("idx_object_header_config_tenant").on(table.tenantId),
]);
export type ObjectHeaderConfig = typeof objectHeaderConfigs.$inferSelect;
export const insertObjectHeaderConfigSchema = createInsertSchema(objectHeaderConfigs).omit({
  id: true,
  updatedAt: true,
});
export type InsertObjectHeaderConfig = z.infer<typeof insertObjectHeaderConfigSchema>;

// Objektvy 360 (P1): PER-OBJEKT snabbfälts-konfiguration. Skiljer sig från
// objectHeaderConfigs (per objekttyp, tenant-omfattande admin-default) genom att
// gälla ETT objekt och ÄRVAS NEDÅT genom den PRIMÄRA förälderkedjan
// (närmast-vinner), åsidosättbar på lägre nivå — samma arvsmodell som
// objekt-metadata. En rad = objektet definierar sin egen konfig (även tom rad =
// medvetet inga snabbfält här); ingen rad = ärv från närmaste förfader, annars
// fall tillbaka på objectHeaderConfigs för objektets objectType. Upp till tre
// inpekade katalogfält. Additivt/expand-contract (nullable slots). objectId
// kaskad-raderas med objektet (ren presentationskonfig, ingen affärsdata).
export const objectQuickFieldConfigs = pgTable("object_quick_field_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id, { onDelete: "cascade" }).notNull(),
  field1KatalogId: varchar("field1_katalog_id").references(() => metadataKatalog.id, { onDelete: "set null" }),
  field2KatalogId: varchar("field2_katalog_id").references(() => metadataKatalog.id, { onDelete: "set null" }),
  field3KatalogId: varchar("field3_katalog_id").references(() => metadataKatalog.id, { onDelete: "set null" }),
  updatedBy: varchar("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_object_quick_field_config_object").on(table.tenantId, table.objectId),
  index("idx_object_quick_field_config_tenant").on(table.tenantId),
]);
export type ObjectQuickFieldConfig = typeof objectQuickFieldConfigs.$inferSelect;
export const insertObjectQuickFieldConfigSchema = createInsertSchema(objectQuickFieldConfigs).omit({
  id: true,
  updatedAt: true,
});
export type InsertObjectQuickFieldConfig = z.infer<typeof insertObjectQuickFieldConfigSchema>;

// Task #675: Redigerbara metadata-kategorier ("områden"). Område är det enda
// grupperingsfältet i det svenska metadata-systemet (metadataKatalog.area). Tidigare
// var listan hårdkodad och gemensam för alla tenants (shared/metadata-areas.ts).
// Denna tenant-scopade tabell gör den redigerbar per kund: standardlistan seedas
// (isSystem=true, kan ej tas bort), kunder kan lägga till egna kategorier
// (isSystem=false) och ta bort dem så länge inget metadatafält använder dem. De
// hårdkodade konstanterna behålls som fallback (expand-contract).
export const metadataAreas = pgTable("metadata_areas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Stabil nyckel som lagras i metadata_katalog.area (slug, t.ex. "grunduppgifter").
  value: varchar("value", { length: 50 }).notNull(),
  // Visningsetikett (t.ex. "Grunduppgifter").
  label: varchar("label", { length: 100 }).notNull(),
  // Visnings-/väljarordning.
  sortOrder: integer("sort_order").default(0).notNull(),
  // Standardkategori seedad från konstantlistan — kan inte tas bort av användaren.
  isSystem: boolean("is_system").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_metadata_areas_tenant_value").on(table.tenantId, table.value),
  index("idx_metadata_areas_tenant").on(table.tenantId),
]);
export type MetadataArea = typeof metadataAreas.$inferSelect;
export const insertMetadataAreaSchema = createInsertSchema(metadataAreas).omit({
  id: true,
  createdAt: true,
});
export type InsertMetadataArea = z.infer<typeof insertMetadataAreaSchema>;

// Task #664: Namngivna importmallar (Excel-mall-builder). Admin bockar i vilka
// metadata-katalogfält som ska ingå → en namngiven, tenant-scopad mall som
// genererar en Excel-fil med de fasta systemkolumnerna (A–E enligt
// OBJEKTMALL_FIXED_COLUMNS) plus en dynamisk kolumn per valt fält. `fieldIds`
// är en ORDNAD lista av metadata_katalog-ID:n; headern (punktnotation för
// underfält, annars `namn`) härleds vid generering så att den alltid matchar
// importens uppslag (buildMetadataTypeLookup). Fält som hunnit raderas filtreras
// bort vid generering. Ingen FK på fieldIds (text[] kan ej referera).
export const importTemplates = pgTable("import_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  fieldIds: text("field_ids").array().notNull().default([]),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_import_templates_tenant").on(table.tenantId),
  uniqueIndex("idx_import_templates_tenant_name").on(table.tenantId, table.name),
]);
export type ImportTemplate = typeof importTemplates.$inferSelect;
export const insertImportTemplateSchema = createInsertSchema(importTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertImportTemplate = z.infer<typeof insertImportTemplateSchema>;

// Task #665: Metadata kopplad till uppgift/order. En koppling = (ordertyp →
// metadata_katalog-fält). metadataKatalogId kan peka på ett rotfält ELLER ett
// familj-förälder-fält; vid läsning expanderas en familj-förälder till sina
// underfält. orderType matchar work_orders.order_type (fri sträng). Tenant-scopad,
// expand-contract (endast ny tabell). Inga FK på order_type (fri sträng).
export const orderTypeMetadataLinks = pgTable("order_type_metadata_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  orderType: varchar("order_type", { length: 100 }).notNull(),
  metadataKatalogId: varchar("metadata_katalog_id")
    .references(() => metadataKatalog.id, { onDelete: "cascade" })
    .notNull(),
  sortOrder: integer("sort_order").default(0),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_order_type_metadata_links_tenant").on(table.tenantId),
  index("idx_order_type_metadata_links_tenant_type").on(table.tenantId, table.orderType),
  uniqueIndex("idx_order_type_metadata_links_unique").on(
    table.tenantId,
    table.orderType,
    table.metadataKatalogId,
  ),
]);
export type OrderTypeMetadataLink = typeof orderTypeMetadataLinks.$inferSelect;
export const insertOrderTypeMetadataLinkSchema = createInsertSchema(orderTypeMetadataLinks).omit({
  id: true,
  createdAt: true,
});
export type InsertOrderTypeMetadataLink = z.infer<typeof insertOrderTypeMetadataLinkSchema>;

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

  // === Task #710: MJUK-RADERING (SOFT DELETE) AV METADATA-VÄRDEN ===
  // En rad kan mjuk-raderas i stället för att tas bort hårt (Session 7 §4).
  // Två fall:
  //  1) Eget värde: `raderad=true` döljer värdet men bevarar raden + historik.
  //  2) Ärvt värde som tas bort på barnnivå: en lokal "tombstone"-rad (utan eget
  //     värde) med `raderad=true` skapas som negativ markering — den ärvda
  //     värdet visas som "struken" och flödar inte ned vidare. Återställning tar
  //     bort tombstonen (ärvt återkommer) eller nollar `raderad` (eget värde).
  // Expand-contract: nullable/default så befintliga rader är oförändrade.
  raderad: boolean("raderad").default(false).notNull(),
  raderadAv: varchar("raderad_av", { length: 100 }),
  raderadVid: timestamp("raderad_vid"),

  // === Task #1213: LOGISK STATUS (Aktiv/Arkiverad/Anonymiserad) ===
  // Varje metadatapost har exakt EN logisk status:
  //  - 'aktiv'        = gällande värde (default)
  //  - 'arkiverad'    = fullvärdig arkiverad post (ersatt värde på enkelvärdes-
  //                     fält, mjuk-borttaget eget värde, eller konverterad
  //                     historikrad). Arkiverade poster deltar ALDRIG i
  //                     arvsupplösning eller närmaste-värde-visning.
  //  - 'anonymiserad' = värdet är avpersonifierat (Etapp 6 bygger UI; statusen
  //                     finns i datamodellen redan nu).
  // `raderad`-flaggan behålls som TEKNISK mekanik för brutet arv (tombstone som
  // stryker ett ärvt värde) och för struken-visning av mjuk-borttagna egna
  // värden — men användarens terminologi är status (ordet "raderad" borta ur UI).
  status: varchar("status", { length: 20 }).default("aktiv").notNull(),
  arkiveradAv: varchar("arkiverad_av", { length: 100 }),
  arkiveradVid: timestamp("arkiverad_vid"),
  // Task #1218 (Etapp 6): GDPR-anonymisering — loggar VEM/NÄR, aldrig VAD.
  // Värdefälten nollas oåterkalleligt när status='anonymiserad'.
  anonymiseradAv: varchar("anonymiserad_av", { length: 100 }),
  anonymiseradVid: timestamp("anonymiserad_vid"),
  // Idempotens-spår för historik→arkiverad-post-konverteringen (migration 0127):
  // satt = raden skapades från metadata_historik-raden med detta id.
  konverteradFranHistorikId: varchar("konverterad_fran_historik_id"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_metadata_varden_objekt").on(table.objektId),
  index("idx_metadata_varden_katalog").on(table.metadataKatalogId),
  index("idx_metadata_varden_objekt_katalog").on(table.objektId, table.metadataKatalogId),
  index("idx_metadata_varden_koppling").on(table.koppladTillMetadataId),
  index("idx_metadata_varden_work_order").on(table.workOrderId),
  index("idx_metadata_varden_work_order_katalog").on(table.workOrderId, table.metadataKatalogId),
  index("idx_metadata_varden_status").on(table.objektId, table.status),
  uniqueIndex("uq_metadata_varden_konv_historik").on(table.konverteradFranHistorikId),
]);

// Task #1213: giltiga logiska statusar för metadata-poster.
export const METADATA_VARDE_STATUS = ["aktiv", "arkiverad", "anonymiserad"] as const;
export type MetadataVardeStatus = typeof METADATA_VARDE_STATUS[number];

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
  // Task #579: nullable + SET NULL så att raderings-event överlever cascade
  // när själva metadata_varden-raden tas bort. Tidslinjen läses per
  // (objekt, katalog) — inte per varden-id — så pekaren är icke-kritisk.
  metadataVardenId: varchar("metadata_varden_id").references(() => metadataVarden.id, { onDelete: "set null" }),
  objektId: varchar("objekt_id").references(() => objects.id),
  metadataKatalogId: varchar("metadata_katalog_id").references(() => metadataKatalog.id),
  gammaltVarde: text("gammalt_varde"),
  nyttVarde: text("nytt_varde"),
  andradAv: varchar("andrad_av", { length: 100 }),
  andradVid: timestamp("andrad_vid").defaultNow().notNull(),
  andringsMetod: varchar("andrings_metod", { length: 50 }),
  // Ångra-funktion: spårbarhet till import-batchen (icke-auktoritativ; import_actions är källan).
  importBatchId: varchar("import_batch_id"),
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
  source: 'local' | 'inherited' | 'computed';
  fromObject?: {
    id: string;
    namn: string;
    level: number;
  };
  // Task #666: beräknade fält. För syntetiska computed-rader sätts `computed` och
  // antingen ett räknat värde (i vardeInteger/vardeDecimal) eller `computedError`
  // (svenskt felmeddelande) när formeln inte kunde utvärderas (okänt fält,
  // division med noll, cirkelreferens). Ordinarie rader lämnar fälten odefinierade.
  computed?: boolean;
  computedError?: string | null;
  // === Task #710: ursprung, override & mjuk-radering (Session 7 §4) ===
  // overridden: ett eget värde skuggar ett ärvbart förälder-värde ("Ärvd, men ändrad").
  overridden?: boolean;
  // Visningsvärdet för det ärvda värdet som skuggas/togs bort (för UI-text).
  inheritedValue?: string | null;
  // Namnet på objektet det ärvda värdet kommer ifrån (närmaste förälder med värde).
  inheritedFromName?: string | null;
  // softDeleted: värdet är mjuk-raderat (eget värde dolt, eller ärvt fält struket
  // via en tombstone-rad på barnnivå). Visas överstruket med Återställ-möjlighet.
  softDeleted?: boolean;
  // OBS: `raderad` (raw tombstone/mjuk-raderings-flagga) ärvs från MetadataVarden
  // (notNull boolean) och får inte redeklareras som optional här.
  // Resolverad per-objekt sorteringsindex (lägre = högre upp). Saknas → katalog-ordning.
  sortIndex?: number | null;
  // Multi-instans: alla värden i katalog-gruppen (endast satt för allowDuplicates-
  // fält). Nearest/collapse för skalära fält är oförändrat; detta är ett additivt
  // fält så klienten kan bläddra flera värden (t.ex. flera kontakter) i karusell.
  instances?: MetadataInstance[];
  // === Task #1213: multi-förälder-arv (object_parents) ===
  // inheritanceConflict: flera föräldrar på samma (närmaste) nivå har OLIKA
  // ärvbara värden för fältet — primär gren vinner i visningen men UI:t varnar.
  inheritanceConflict?: boolean;
  // Källorna som krockar (objektnamn + visningsvärde), för konflikt-tooltip.
  conflictSources?: { fromObjectName: string | null; value: string | null }[];
}

// Multi-instans-rad för ett duplicerbart katalogfält (för karusell-bläddring).
export interface MetadataInstance {
  id: string;
  objektId: string;
  source: 'local' | 'inherited';
  fromObjectName: string | null;
  level: number;
  metod: string;
  displayValue: string | null;
  vardeJson: unknown;
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
  typ: 'GPS' | 'Adress';
  precision: 'exakt' | 'grov';
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
  executedBy: varchar("executed_by").references(() => users.id, { onDelete: 'set null' }),
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
  reportedBy: varchar("reported_by").references(() => users.id, { onDelete: 'set null' }),
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
  resolvedBy: varchar("resolved_by").references(() => users.id, { onDelete: 'set null' }),
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
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
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
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: 'set null' }),
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

// ============================================================================
// METADATA-EDITOR ("Metadata Lämnare") — publika insamlingsformulär (Task #956)
// ----------------------------------------------------------------------------
// Admin bygger konfigurerbara publika formulär som triggas via QR/GPS utan
// inloggning. Tre typer: objektspecifik (objqr per objekt), GPS-baserad (dynqr
// tenant-token → välj närliggande objekt) och objektskapande (interim
// "Rapporterat objekt"). Inlämningar hamnar i en GRANSKNINGSKÖ (pending) och
// skrivs ALDRIG direkt till objektet — en planerare godkänner/avvisar, och först
// vid godkännande skrivs värdena via den svenska katalog-vägen (flervärde).
// ============================================================================

export const METADATA_EDITOR_TYPES = ["object_specific", "gps", "object_creating"] as const;
export type MetadataEditorType = (typeof METADATA_EDITOR_TYPES)[number];

export const METADATA_EDITOR_FIELD_KINDS = ["rating", "text", "photo"] as const;
export type MetadataEditorFieldKind = (typeof METADATA_EDITOR_FIELD_KINDS)[number];

export const METADATA_EDITOR_SUBMISSION_STATUSES = ["pending", "approved", "rejected"] as const;
export type MetadataEditorSubmissionStatus = (typeof METADATA_EDITOR_SUBMISSION_STATUSES)[number];

// Avsändarfält-konfiguration: vilka fält som visas och om de är obligatoriska.
export const reporterFieldConfigSchema = z.object({
  shown: z.boolean().default(false),
  required: z.boolean().default(false),
});
export const reporterConfigSchema = z.object({
  name: reporterFieldConfigSchema,
  title: reporterFieldConfigSchema,
  organization: reporterFieldConfigSchema,
  email: reporterFieldConfigSchema,
  phone: reporterFieldConfigSchema,
});
export type ReporterConfig = z.infer<typeof reporterConfigSchema>;

// Fältkonfiguration per fält-kind (rating-skala, fritext-längd, max foton).
export const editorFieldConfigSchema = z
  .object({
    ratingMin: z.number().int(),
    ratingMax: z.number().int(),
    ratingStyle: z.enum(["stars", "numbers"]),
    maxLength: z.number().int().positive(),
    multiline: z.boolean(),
    maxPhotos: z.number().int().positive(),
  })
  .partial();
export type EditorFieldConfig = z.infer<typeof editorFieldConfigSchema>;

export const metadataEditors = pgTable("metadata_editors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  description: text("description"),
  type: text("type").notNull(), // object_specific | gps | object_creating
  isActive: boolean("is_active").default(true).notNull(),
  // Avsändarfält-krav (vilka som visas/krävs) — JSONB (fast form, ingen ordning/FK).
  reporterConfig: jsonb("reporter_config").$type<ReporterConfig>().notNull(),
  // Sökradie i meter för GPS-typ (närliggande objekt).
  nearbyRadiusM: integer("nearby_radius_m").default(300).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_metadata_editors_tenant").on(table.tenantId),
]);

export const metadataEditorFields = pgTable("metadata_editor_fields", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  editorId: varchar("editor_id").references(() => metadataEditors.id, { onDelete: "cascade" }).notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  kind: text("kind").notNull(), // rating | text | photo
  label: varchar("label", { length: 200 }).notNull(),
  helpText: text("help_text"),
  required: boolean("required").default(false).notNull(),
  // Målfält i metadata-katalogen (skapas ivrigt vid editor-spar om "skapa nytt").
  metadataKatalogId: varchar("metadata_katalog_id").references(() => metadataKatalog.id, { onDelete: "set null" }),
  fieldConfig: jsonb("field_config").$type<EditorFieldConfig>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_metadata_editor_fields_editor").on(table.editorId),
  index("idx_metadata_editor_fields_tenant").on(table.tenantId),
]);

export const metadataEditorSubmissions = pgTable("metadata_editor_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  editorId: varchar("editor_id").references(() => metadataEditors.id, { onDelete: "cascade" }).notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Nullable tills objekt valts/skapats; måste vara satt före godkännande.
  objectId: varchar("object_id").references(() => objects.id),
  status: text("status").default("pending").notNull(), // pending | approved | rejected
  // Avsändaruppgifter (krav styrs av reporterConfig vid inlämning).
  reporterName: text("reporter_name"),
  reporterTitle: text("reporter_title"),
  reporterOrganization: text("reporter_organization"),
  reporterEmail: text("reporter_email"),
  reporterPhone: text("reporter_phone"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  // True om inlämningen skapade ett interim-objekt (objektskapande editor).
  createdInterimObject: boolean("created_interim_object").default(false).notNull(),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
}, (table) => [
  index("idx_metadata_editor_submissions_tenant_status").on(table.tenantId, table.status),
  index("idx_metadata_editor_submissions_editor").on(table.editorId),
  index("idx_metadata_editor_submissions_object").on(table.objectId),
]);

export const metadataEditorSubmissionValues = pgTable("metadata_editor_submission_values", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  submissionId: varchar("submission_id").references(() => metadataEditorSubmissions.id, { onDelete: "cascade" }).notNull(),
  fieldId: varchar("field_id").references(() => metadataEditorFields.id, { onDelete: "set null" }),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Snapshot av målfältet vid inlämning (fältet kan ändras senare).
  metadataKatalogId: varchar("metadata_katalog_id"),
  // Råvärdet: rating-tal eller fritext lagras i value_json; foto i photo_paths.
  valueJson: jsonb("value_json"),
  photoPaths: text("photo_paths").array(),
  // Sätts efter godkännande → länk till skapad metadata_varden-rad (idempotens).
  writtenMetadataValueId: varchar("written_metadata_value_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_metadata_editor_submission_values_submission").on(table.submissionId),
  index("idx_metadata_editor_submission_values_tenant").on(table.tenantId),
]);

export const insertMetadataEditorSchema = createInsertSchema(metadataEditors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type MetadataEditor = typeof metadataEditors.$inferSelect;
export type InsertMetadataEditor = z.infer<typeof insertMetadataEditorSchema>;

export const insertMetadataEditorFieldSchema = createInsertSchema(metadataEditorFields).omit({
  id: true,
  createdAt: true,
});
export type MetadataEditorField = typeof metadataEditorFields.$inferSelect;
export type InsertMetadataEditorField = z.infer<typeof insertMetadataEditorFieldSchema>;

export const insertMetadataEditorSubmissionSchema = createInsertSchema(metadataEditorSubmissions).omit({
  id: true,
  submittedAt: true,
});
export type MetadataEditorSubmission = typeof metadataEditorSubmissions.$inferSelect;
export type InsertMetadataEditorSubmission = z.infer<typeof insertMetadataEditorSubmissionSchema>;

export const insertMetadataEditorSubmissionValueSchema = createInsertSchema(metadataEditorSubmissionValues).omit({
  id: true,
  createdAt: true,
});
export type MetadataEditorSubmissionValue = typeof metadataEditorSubmissionValues.$inferSelect;
export type InsertMetadataEditorSubmissionValue = z.infer<typeof insertMetadataEditorSubmissionValueSchema>;

export const customerChangeRequests = pgTable("customer_change_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  objectId: varchar("object_id").references(() => objects.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  photos: text("photos").array(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  status: text("status").default("new").notNull(),
  severity: text("severity"),
  createdByResourceId: varchar("created_by_resource_id").references(() => resources.id),
  linkedDeviationId: varchar("linked_deviation_id").references(() => deviationReports.id),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  linkedWorkOrderId: varchar("linked_work_order_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_ccr_object").on(table.objectId),
  index("idx_ccr_customer").on(table.customerId),
  index("idx_ccr_tenant_status").on(table.tenantId, table.status),
  index("idx_ccr_linked_deviation").on(table.linkedDeviationId),
]);

export const customerChangeRequestsRelations = relations(customerChangeRequests, ({ one }) => ({
  tenant: one(tenants, { fields: [customerChangeRequests.tenantId], references: [tenants.id] }),
  object: one(objects, { fields: [customerChangeRequests.objectId], references: [objects.id] }),
  customer: one(customers, { fields: [customerChangeRequests.customerId], references: [customers.id] }),
  reviewedByUser: one(users, { fields: [customerChangeRequests.reviewedBy], references: [users.id] }),
}));

export const insertCustomerChangeRequestSchema = createInsertSchema(customerChangeRequests).omit({ id: true, createdAt: true, reviewedBy: true, reviewedAt: true, reviewNotes: true, linkedWorkOrderId: true });
export type CustomerChangeRequest = typeof customerChangeRequests.$inferSelect;
export type InsertCustomerChangeRequest = z.infer<typeof insertCustomerChangeRequestSchema>;

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
  workOrderId: varchar("work_order_id").references(() => workOrders.id, { onDelete: 'set null' }),
  resourceId: varchar("resource_id").references(() => resources.id),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id, { onDelete: 'set null' }),
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
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
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
  workOrderId: varchar("work_order_id").references(() => workOrders.id, { onDelete: 'set null' }),
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
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
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

export const userNotifications = pgTable("user_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  link: text("link"),
  data: jsonb("data").default({}),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_user_notif_user").on(table.userId, table.isRead),
  index("idx_user_notif_tenant").on(table.tenantId),
  index("idx_user_notif_created_read").on(table.createdAt, table.isRead),
]);

export const insertUserNotificationSchema = createInsertSchema(userNotifications).omit({ id: true, createdAt: true });
export type InsertUserNotification = z.infer<typeof insertUserNotificationSchema>;
export type UserNotification = typeof userNotifications.$inferSelect;

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
// SLA RISK FORECASTING (Task #171)
// ============================================
export const SLA_RISK_LEVELS = ["ok", "warning", "critical"] as const;
export type SlaRiskLevel = typeof SLA_RISK_LEVELS[number];

export const slaRiskSnapshots = pgTable("sla_risk_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").notNull(),
  clusterId: varchar("cluster_id"),
  calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
  predictedCompletionDate: timestamp("predicted_completion_date"),
  deadlineAt: timestamp("deadline_at"),
  riskLevel: text("risk_level").default("ok").notNull(),
  daysToBreach: real("days_to_breach"),
  reason: text("reason"),
  previousRiskLevel: text("previous_risk_level"),
}, (table) => [
  index("idx_sla_risk_tenant_level").on(table.tenantId, table.riskLevel),
  index("idx_sla_risk_workorder").on(table.workOrderId),
  index("idx_sla_risk_cluster").on(table.tenantId, table.clusterId),
  index("idx_sla_risk_calculated").on(table.tenantId, table.calculatedAt),
]);

export const slaRiskSettings = pgTable("sla_risk_settings", {
  tenantId: varchar("tenant_id").primaryKey().references(() => tenants.id),
  warningDaysToBreach: integer("warning_days_to_breach").default(3).notNull(),
  criticalDaysToBreach: integer("critical_days_to_breach").default(1).notNull(),
  backlogOverloadFactor: real("backlog_overload_factor").default(1.0).notNull(),
  defaultMaxDaysToComplete: integer("default_max_days_to_complete").default(14).notNull(),
  notifyOnWarningToCritical: boolean("notify_on_warning_to_critical").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSlaRiskSnapshotSchema = createInsertSchema(slaRiskSnapshots).omit({ id: true, calculatedAt: true });
export type InsertSlaRiskSnapshot = z.infer<typeof insertSlaRiskSnapshotSchema>;
export type SlaRiskSnapshot = typeof slaRiskSnapshots.$inferSelect;

export const insertSlaRiskSettingsSchema = createInsertSchema(slaRiskSettings).omit({ updatedAt: true });
export type InsertSlaRiskSettings = z.infer<typeof insertSlaRiskSettingsSchema>;
export type SlaRiskSettings = typeof slaRiskSettings.$inferSelect;

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
  // Import-sessions-id som batchen hör till. Historiskt FK → import_sessions
  // (tre-stegs-wizarden, migration 0049); FK:n är borttagen i migration 0142
  // tillsammans med tabellen. Kolumnen BEHÅLLS medvetet utan FK: Import 2.0
  // (objectImportV2Routes, sourceFlow="objects-v2") stämplar den med
  // object_import_sessions-id för Ångra-spårbarhet.
  sessionId: varchar("session_id"),
  // Ångra-funktion (Task #930+): vilket importflöde batchen kom från och om den
  // fortfarande går att rulla tillbaka. Additivt/expand-contract — nullable/default.
  sourceFlow: varchar("source_flow", { length: 32 }),
  undoStatus: varchar("undo_status", { length: 16 }).default("reversible"),
  undoExpiresAt: timestamp("undo_expires_at"),
  undoneAt: timestamp("undone_at"),
  undoneBy: varchar("undone_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_import_batches_tenant").on(table.tenantId),
  uniqueIndex("idx_import_batches_batch_id").on(table.batchId),
  index("idx_import_batches_session").on(table.sessionId),
]);

export const insertImportBatchSchema = createInsertSchema(importBatches).omit({ id: true, createdAt: true });
export type InsertImportBatch = z.infer<typeof insertImportBatchSchema>;
export type ImportBatch = typeof importBatches.$inferSelect;

// ============================================
// Reversible import actions (Ångra-funktion) — per-entitet before/after-snapshot
// så att en hel import-batch eller massuppdatering kan rullas tillbaka i ett klick.
// Additivt/expand-contract. Auktoritativ källa för undo: objects.import_batch_id
// + metadata_historik räcker inte för uppdateringar/repoint utan snapshot.
// ============================================
export const importActions = pgTable("import_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  batchId: varchar("batch_id").notNull(),
  sessionId: varchar("session_id"),
  // wizard | objects-v2 | metadata-job
  sourceFlow: varchar("source_flow", { length: 32 }).notNull(),
  rowNumber: integer("row_number"),
  // create_object | update_object | metadata_write
  actionType: varchar("action_type", { length: 32 }).notNull(),
  // object | metadata_varden
  entityType: varchar("entity_type", { length: 32 }).notNull(),
  entityId: varchar("entity_id"),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  // applied | undone | blocked
  status: varchar("status", { length: 16 }).default("applied").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  undoneAt: timestamp("undone_at"),
  undoneBy: varchar("undone_by"),
  undoError: text("undo_error"),
}, (table) => [
  index("idx_import_actions_tenant").on(table.tenantId),
  index("idx_import_actions_batch").on(table.batchId),
  index("idx_import_actions_tenant_status").on(table.tenantId, table.status),
]);

export const insertImportActionSchema = createInsertSchema(importActions).omit({ id: true, createdAt: true });
export type InsertImportAction = z.infer<typeof insertImportActionSchema>;
export type ImportAction = typeof importActions.$inferSelect;

// ============================================
// Import 2.0 — objektimport-sessioner (session-baserat 5-stegsflöde)
// (Tre-stegs-wizardens `import_sessions` är borttagen — contract-fas, task #1348,
// migration 0142.) Här hålls hela sessionens tillstånd som JSONB:
// detekterade kolumner, rårader, mappningar, valideringsresultat och slutresultat.
// ============================================
export const objectImportSessions = pgTable("object_import_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  fileName: text("file_name"),
  // draft → mapping → validating → importing → completed | failed
  status: text("status").default("draft").notNull(),
  progress: integer("progress").default(0).notNull(),
  columns: jsonb("columns").default([]).notNull(),
  rawRows: jsonb("raw_rows").default([]).notNull(),
  mappings: jsonb("mappings").default({}).notNull(),
  validation: jsonb("validation"),
  result: jsonb("result"),
  error: text("error"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_object_import_sessions_tenant").on(table.tenantId),
  index("idx_object_import_sessions_tenant_status").on(table.tenantId, table.status),
]);

export type ObjectImportSession = typeof objectImportSessions.$inferSelect;
export type InsertObjectImportSession = typeof objectImportSessions.$inferInsert;

// Import 2.0 — persistent per-rad-livscykel (spec §6.1 ImportRow). En rad per
// datarad i sessionen; statusen vandrar pending → valid/invalid (validering) →
// imported/skipped (execute). validationMsgs + objectId ger durabel spårbarhet.
export const objectImportRows = pgTable("object_import_rows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id")
    .references(() => objectImportSessions.id, { onDelete: "cascade" })
    .notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  rowNumber: integer("row_number").notNull(),
  rawData: jsonb("raw_data").default({}).notNull(),
  // pending | valid | invalid | imported | skipped
  status: text("status").default("pending").notNull(),
  validationMsgs: jsonb("validation_msgs").default([]).notNull(),
  objectId: varchar("object_id"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_object_import_rows_session").on(table.sessionId),
  index("idx_object_import_rows_tenant").on(table.tenantId),
  uniqueIndex("uniq_object_import_rows_session_row").on(table.sessionId, table.rowNumber),
]);

export type ObjectImportRow = typeof objectImportRows.$inferSelect;
export type InsertObjectImportRow = typeof objectImportRows.$inferInsert;

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
    object_singular: "Objekt",
    object_plural: "Objekt",
    container_singular: "Kärl",
    container_plural: "Kärl",
    asset_type: "Objekttyp",
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
]);

export const annualGoalsRelations = relations(annualGoals, ({ one }) => ({
  tenant: one(tenants, { fields: [annualGoals.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [annualGoals.customerId], references: [customers.id] }),
  object: one(objects, { fields: [annualGoals.objectId], references: [objects.id] }),
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
  uniqueIndex("uq_budget_alert_dedup").on(table.tenantId, table.monthKey, table.thresholdPercent),
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

export const orderChecklistItems = pgTable("order_checklist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workOrderId: varchar("work_order_id").references(() => workOrders.id).notNull(),
  stepText: text("step_text").notNull(),
  isAiGenerated: boolean("is_ai_generated").default(false).notNull(),
  isCompleted: boolean("is_completed").default(false).notNull(),
  completedAt: timestamp("completed_at"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_order_checklist_work_order").on(table.workOrderId),
]);

export const insertOrderChecklistItemSchema = createInsertSchema(orderChecklistItems).omit({
  id: true,
  createdAt: true,
});

export type OrderChecklistItem = typeof orderChecklistItems.$inferSelect;
export type InsertOrderChecklistItem = z.infer<typeof insertOrderChecklistItemSchema>;

export const REQUIRED_FIELDS_BY_ORDER_TYPE: Record<string, { field: string; label: string }[]> = {
  service: [
    { field: "description", label: "Beskrivning" },
  ],
  installation: [
    { field: "description", label: "Beskrivning" },
    { field: "photos", label: "Foton (minst 1)" },
    { field: "signature", label: "Kundsignatur" },
  ],
  inspection: [
    { field: "description", label: "Beskrivning" },
    { field: "inspection", label: "Besiktningsprotokoll" },
    { field: "photos", label: "Foton (minst 1)" },
  ],
  repair: [
    { field: "description", label: "Beskrivning" },
    { field: "photos", label: "Foton (minst 1)" },
    { field: "materials", label: "Materiallogg" },
  ],
  delivery: [
    { field: "signature", label: "Kundsignatur" },
  ],
  default: [],
};

// Svenska visningsetiketter för de kända (statiska) ordertyps-nycklarna ovan.
// VIKTIGT: nycklarna (service/installation/... ) är de kanoniska fri-sträng-värden
// som lagras i work_orders.order_type och matchas av REQUIRED_FIELDS_BY_ORDER_TYPE
// samt order-typ-kopplingar — döp ALDRIG om nycklarna, bara etiketterna. Egna
// (kund-skapade) ordertyper saknar etikett och visas som sitt råa värde.
export const ORDER_TYPE_LABELS: Record<string, string> = {
  default: "Standard",
  service: "Service",
  installation: "Installation",
  inspection: "Besiktning",
  repair: "Reparation",
  delivery: "Leverans",
};

// Returnerar svensk etikett för en ordertyp, annars råvärdet (egen ordertyp).
export function getOrderTypeLabel(value: string | null | undefined): string {
  if (!value) return "";
  return ORDER_TYPE_LABELS[value] ?? value;
}

// === STATUS MESSAGE TEMPLATES (Statusmeddelanden) ===
export const statusMessageTemplates = pgTable("status_message_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  triggerType: text("trigger_type").notNull(), // "incoming_call", "portal_chat", "manual"
  templateText: text("template_text").notNull(), // e.g. "{resource.name} är ledig kl {resource.nextAvailable}"
  isActive: boolean("is_active").default(true).notNull(),
  priority: integer("priority").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_status_msg_templates_tenant").on(table.tenantId),
]);

export const insertStatusMessageTemplateSchema = createInsertSchema(statusMessageTemplates).omit({ id: true, createdAt: true });
export type StatusMessageTemplate = typeof statusMessageTemplates.$inferSelect;
export type InsertStatusMessageTemplate = z.infer<typeof insertStatusMessageTemplateSchema>;

export const recurringSlotPatterns = pgTable("recurring_slot_patterns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  maxBookings: integer("max_bookings").default(1),
  serviceTypes: jsonb("service_types").default([]),
  resourceId: varchar("resource_id").references(() => resources.id),
  isActive: boolean("is_active").default(true),
  generatedUntil: timestamp("generated_until"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
}, (table) => [
  index("idx_recurring_slot_tenant").on(table.tenantId),
]);

export const insertRecurringSlotPatternSchema = createInsertSchema(recurringSlotPatterns).omit({ id: true, createdAt: true });
export type RecurringSlotPattern = typeof recurringSlotPatterns.$inferSelect;
export type InsertRecurringSlotPattern = z.infer<typeof insertRecurringSlotPatternSchema>;

export const importColumnMappings = pgTable("import_column_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  batchId: varchar("batch_id").notNull(),
  csvColumn: text("csv_column").notNull(),
  systemField: text("system_field"),
  metadataType: text("metadata_type"),
  isIgnored: boolean("is_ignored").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_import_col_map_batch").on(table.batchId),
]);

// ============================================
// Customer Import Mappings — sparad kolumnmappning per kund för årlig
// fastighetslista-avstämning. En rad per (tenant, customer) — uppdateras när
// planerare bekräftar mappning. columnMap = { systemField: csvColumn, ... }.
// ============================================
export const customerImportMappings = pgTable("customer_import_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  label: text("label"),
  columnMap: jsonb("column_map").notNull(),
  // MD5-hash av sorterade lowercase-headers i den uppladdade filen — används
  // för att avgöra om filens kolumn-layout är identisk med när mappningen
  // sparades. Vid match kan UI auto-hoppa förbi mappnings-steget.
  sourceFingerprint: text("source_fingerprint"),
  lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_customer_import_mappings_tenant_customer").on(table.tenantId, table.customerId),
]);

export type CustomerImportMapping = typeof customerImportMappings.$inferSelect;

export const etaNotifications = pgTable("eta_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id).notNull(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id),
  channel: text("channel").notNull(),
  notificationType: text("notification_type").notNull(),
  recipientEmail: text("recipient_email"),
  recipientPhone: text("recipient_phone"),
  etaMinutes: integer("eta_minutes"),
  etaTime: text("eta_time"),
  marginMinutes: integer("margin_minutes").default(15),
  status: text("status").default("sent").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_eta_notif_tenant").on(table.tenantId),
  index("idx_eta_notif_customer").on(table.customerId),
  index("idx_eta_notif_order").on(table.workOrderId),
]);

export const insertEtaNotificationSchema = createInsertSchema(etaNotifications).omit({ id: true, createdAt: true });
export type EtaNotification = typeof etaNotifications.$inferSelect;
export type InsertEtaNotification = z.infer<typeof insertEtaNotificationSchema>;

export const pushTokens = pgTable("push_tokens", {
  id: serial("id").primaryKey(),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  expoPushToken: text("expo_push_token").notNull(),
  platform: text("platform").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_push_tokens_resource").on(table.resourceId),
]);

export const insertPushTokenSchema = createInsertSchema(pushTokens).omit({ id: true, createdAt: true, updatedAt: true });
export type PushToken = typeof pushTokens.$inferSelect;
export type InsertPushToken = z.infer<typeof insertPushTokenSchema>;

export const distanceCache = pgTable("distance_cache", {
  id: varchar("id").primaryKey(),
  fromLat: real("from_lat").notNull(),
  fromLng: real("from_lng").notNull(),
  toLat: real("to_lat").notNull(),
  toLng: real("to_lng").notNull(),
  distanceKm: real("distance_km").notNull(),
  durationMin: real("duration_min").notNull(),
  source: varchar("source", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_distance_cache_created").on(table.createdAt),
]);

export type DistanceCacheEntry = typeof distanceCache.$inferSelect;

// Task #472 (Google Maps Fas 1) — shadow-jämförelse mellan primär och
// alternativ map-provider. En rad per loggad jämförelse (sample-rate-styrt).
// Skrivning sker fail-safe via setImmediate så att shadow-anrop aldrig
// blockerar primär-pathen. Aggregeras av `scripts/shadow-comparison-report.ts`.
export const mapShadowComparisons = pgTable("map_shadow_comparisons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id"),
  // 'geocode' | 'route' | 'matrix' | 'vrp'
  operation: varchar("operation", { length: 20 }).notNull(),
  primaryProvider: varchar("primary_provider", { length: 20 }).notNull(),
  shadowProvider: varchar("shadow_provider", { length: 20 }).notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  request: jsonb("request"),
  primaryResult: jsonb("primary_result"),
  shadowResult: jsonb("shadow_result"),
  // Beräknade absoluta + relativa deltan: { distanceKmDelta, durationMinDelta, distanceKmRelPct, durationMinRelPct, ... }
  deltas: jsonb("deltas"),
  primaryDurationMs: integer("primary_duration_ms"),
  shadowDurationMs: integer("shadow_duration_ms"),
  primaryOk: boolean("primary_ok"),
  shadowOk: boolean("shadow_ok"),
  shadowError: text("shadow_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_map_shadow_op").on(table.operation),
  index("idx_map_shadow_created").on(table.createdAt),
  index("idx_map_shadow_tenant").on(table.tenantId),
]);

export type MapShadowComparison = typeof mapShadowComparisons.$inferSelect;
export const insertMapShadowComparisonSchema = createInsertSchema(mapShadowComparisons).omit({ id: true, createdAt: true });
export type InsertMapShadowComparison = z.infer<typeof insertMapShadowComparisonSchema>;

export const optimizationJobs = pgTable("optimization_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  status: varchar("status", { length: 20 }).default("queued").notNull(),
  input: jsonb("input").notNull(),
  result: jsonb("result"),
  error: text("error"),
  progress: integer("progress").default(0).notNull(),
  attempts: integer("attempts").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_optimization_jobs_tenant").on(table.tenantId),
  index("idx_optimization_jobs_status").on(table.status),
  index("idx_optimization_jobs_created").on(table.createdAt),
]);

export const insertOptimizationJobSchema = createInsertSchema(optimizationJobs).omit({ id: true, createdAt: true, startedAt: true, completedAt: true });
export type OptimizationJob = typeof optimizationJobs.$inferSelect;
export type InsertOptimizationJob = z.infer<typeof insertOptimizationJobSchema>;

export const mobileUserPreferences = pgTable("mobile_user_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  darkMode: boolean("dark_mode").default(false).notNull(),
  fontSize: varchar("font_size", { length: 20 }).default("medium").notNull(),
  hapticFeedback: boolean("haptic_feedback").default(true).notNull(),
  pushEnabled: boolean("push_enabled").default(true).notNull(),
  pushCategories: jsonb("push_categories").default({ orders: true, team: true, system: true }).notNull(),
  mapType: varchar("map_type", { length: 20 }).default("standard").notNull(),
  showTraffic: boolean("show_traffic").default(true).notNull(),
  breakReminders: boolean("break_reminders").default(true).notNull(),
  menuOrder: jsonb("menu_order").default(["ai", "notifications", "team", "statistics", "settings"]).notNull(),
  language: varchar("language", { length: 10 }).default("sv").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_mobile_prefs_resource").on(table.resourceId),
  index("idx_mobile_prefs_tenant").on(table.tenantId),
]);

export const insertMobileUserPreferencesSchema = createInsertSchema(mobileUserPreferences).omit({ id: true, updatedAt: true });
export type MobileUserPreference = typeof mobileUserPreferences.$inferSelect;
export type InsertMobileUserPreference = z.infer<typeof insertMobileUserPreferencesSchema>;

export const urgentJobAssignments = pgTable("urgent_job_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").references(() => workOrders.id),
  resourceId: varchar("resource_id").references(() => resources.id).notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  jobType: text("job_type"),
  address: text("address"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  notes: text("notes"),
  articles: text("articles"),
  deadline: timestamp("deadline"),
  declineReason: text("decline_reason"),
  startNavigation: boolean("start_navigation").default(false),
  assignedBy: varchar("assigned_by"),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  acceptedAt: timestamp("accepted_at"),
  declinedAt: timestamp("declined_at"),
  arrivedAt: timestamp("arrived_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_urgent_jobs_resource").on(table.resourceId, table.status),
  index("idx_urgent_jobs_tenant").on(table.tenantId, table.status),
]);

export const insertUrgentJobAssignmentSchema = createInsertSchema(urgentJobAssignments).omit({ id: true, createdAt: true, updatedAt: true });
export type UrgentJobAssignment = typeof urgentJobAssignments.$inferSelect;
export type InsertUrgentJobAssignment = z.infer<typeof insertUrgentJobAssignmentSchema>;

export type UrgentJobStatus = "pending" | "accepted" | "en_route" | "arrived" | "in_progress" | "completed" | "declined" | "reassigned" | "issue_reported";

export const geocodingMissingSnapshots = pgTable("geocoding_missing_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  date: text("date").notNull(),
  missingCount: integer("missing_count").notNull(),
  totalWithAddress: integer("total_with_address").notNull(),
  totalObjects: integer("total_objects").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_geocoding_missing_snap_tenant_date").on(table.tenantId, table.date),
]);

export type GeocodingMissingSnapshot = typeof geocodingMissingSnapshots.$inferSelect;

export const weatherForecastCache = pgTable("weather_forecast_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  cacheKey: text("cache_key").notNull(),
  forecastDate: text("forecast_date").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  days: integer("days").notNull(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_weather_cache_tenant_key").on(table.tenantId, table.cacheKey, table.forecastDate),
]);

export type WeatherForecastCache = typeof weatherForecastCache.$inferSelect;

export const missingCoordinatesNotificationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  recipients: z
    .array(z.string().trim().email("Ogiltig e-postadress"))
    .max(50, "Max 50 mottagare")
    .default([]),
});
export type MissingCoordinatesNotificationConfig = z.infer<
  typeof missingCoordinatesNotificationConfigSchema
>;


// ============================================
// ADR v3 (F3): Sparade sökmönster för planeraren
// ============================================
export const plannerSearchFilters = pgTable("planner_search_filters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  // Filterkriterier (JSONB för flexibilitet):
  // { executionTypes?: string[], postalCodes?: string[], geographicArea?: {lat,lng,radiusKm},
  //   articleAssociations?: string[], status?: string[], dateRange?: {from,to} }
  filterCriteria: jsonb("filter_criteria").default({}).notNull(),
  // Frivilligt kopplad till team (delade filter inom team)
  teamId: varchar("team_id").references(() => teams.id, { onDelete: "set null" }),
  // 'personal' | 'shared' (synligt för hela tenanten)
  scope: text("scope").default("personal").notNull(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_planner_search_filters_tenant").on(table.tenantId),
  index("idx_planner_search_filters_team").on(table.teamId),
  index("idx_planner_search_filters_creator").on(table.createdBy),
]);

export const insertPlannerSearchFilterSchema = createInsertSchema(plannerSearchFilters).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertPlannerSearchFilter = z.infer<typeof insertPlannerSearchFilterSchema>;
export type PlannerSearchFilter = typeof plannerSearchFilters.$inferSelect;

// ============================================
// ADR v3 (F4): BOM-komponenter (article_components)
// Strukturartikel TILG100 → komponentrader (TILG201, TILG202)
// ============================================
export const articleComponents = pgTable("article_components", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  parentArticleId: varchar("parent_article_id").references(() => articles.id, { onDelete: "cascade" }).notNull(),
  childArticleId: varchar("child_article_id").references(() => articles.id, { onDelete: "restrict" }).notNull(),
  sortOrder: integer("sort_order").default(0),
  // Antal av komponenten per parent (default 1)
  quantity: real("quantity").default(1.0).notNull(),
  // Session 11 (Register 4): kvantitetsformel för skalning, t.ex. "metadata.antal"
  quantityFormula: text("quantity_formula"),
  // Session 11 (Register 4): EGEN metadatakorrespondens per underartikel (VAD den rapporterar)
  reportingType: text("reporting_type"),
  reportingMetadataField: text("reporting_metadata_field"),
  // Obligatorisk komponent (false = valfri sub-task)
  isMandatory: boolean("is_mandatory").default(true),
  // Anteckning för utförare
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_article_components_parent").on(table.parentArticleId),
  index("idx_article_components_child").on(table.childArticleId),
  unique("unq_article_components_parent_child").on(table.parentArticleId, table.childArticleId),
]);

export const insertArticleComponentSchema = createInsertSchema(articleComponents).omit({
  id: true, createdAt: true,
});
export type InsertArticleComponent = z.infer<typeof insertArticleComponentSchema>;
export type ArticleComponent = typeof articleComponents.$inferSelect;

// ============================================
// Session 11 (Register 3): Produktionstidslista
// Produktionstid per artikel × utförare (resurs)/utrustning — kan variera.
// Kompletterar articles.productionTime (behålls som fallback/bakåtkomp).
// ============================================
export const productionTimeLists = pgTable("production_time_lists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id, { onDelete: "cascade" }).notNull(),
  // Specifik utförare (resurs) om tiden är utförarunik
  performerResourceId: varchar("performer_resource_id").references(() => resources.id, { onDelete: "set null" }),
  // Specifik utrustning om tiden är utrustningsunik
  equipmentId: varchar("equipment_id").references(() => equipment.id, { onDelete: "set null" }),
  productionTimeMinutes: integer("production_time_minutes").notNull(),
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_production_time_lists_tenant").on(table.tenantId),
  index("idx_production_time_lists_article").on(table.articleId),
]);
export const insertProductionTimeListSchema = createInsertSchema(productionTimeLists).omit({ id: true, createdAt: true });
export type InsertProductionTimeList = z.infer<typeof insertProductionTimeListSchema>;
export type ProductionTimeList = typeof productionTimeLists.$inferSelect;

// ============================================
// Session 11 (Register 5): Leverantörsregister
// Leverantörsföretag + koppling av flera leverantörer per artikel (lev.artikelnr,
// leveranstid, inköpspris). Data för framtida inköpsportal — struktur finns från start.
// ============================================
export const suppliers = pgTable("suppliers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  contact: text("contact"),
  phone: text("phone"),
  email: text("email"),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_suppliers_tenant").on(table.tenantId),
]);
export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true, createdAt: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliers.$inferSelect;

// Leverantörskoppling: artikel × leverantör
export const supplierArticleLinks = pgTable("supplier_article_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id, { onDelete: "cascade" }).notNull(),
  supplierId: varchar("supplier_id").references(() => suppliers.id, { onDelete: "cascade" }).notNull(),
  // Leverantörens eget artikelnummer för denna artikel
  supplierArticleNumber: text("supplier_article_number"),
  // Leveranstid i dagar från denna leverantör
  leadTimeDays: integer("lead_time_days"),
  // Inköpspris i öre (DB-prisfält är öre)
  purchasePrice: integer("purchase_price"),
  currency: text("currency").default("SEK").notNull(),
  isPrimary: boolean("is_primary").default(false),
  active: boolean("active").default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_supplier_article_links_tenant").on(table.tenantId),
  index("idx_supplier_article_links_article").on(table.articleId),
  index("idx_supplier_article_links_supplier").on(table.supplierId),
  unique("unq_supplier_article_links_article_supplier").on(table.articleId, table.supplierId),
]);
export const insertSupplierArticleLinkSchema = createInsertSchema(supplierArticleLinks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupplierArticleLink = z.infer<typeof insertSupplierArticleLinkSchema>;
export type SupplierArticleLink = typeof supplierArticleLinks.$inferSelect;

// ============================================
// ADR v3 (F4): Beroende-graf mellan work_orders (instans-nivå)
// task_dependency_templates används för mall, denna för instans.
// ============================================
export const workOrderDependencies = pgTable("work_order_dependencies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id, { onDelete: "cascade" }).notNull(),
  dependsOnWorkOrderId: varchar("depends_on_work_order_id").references(() => workOrders.id, { onDelete: "cascade" }).notNull(),
  // 'must_complete_first' (default) | 'must_start_first' | 'soft_preference'
  dependencyType: text("dependency_type").default("must_complete_first").notNull(),
  // Cachad — sätts till true när dependsOn-WO når completed
  isSatisfied: boolean("is_satisfied").default(false).notNull(),
  satisfiedAt: timestamp("satisfied_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_wod_work_order").on(table.workOrderId),
  index("idx_wod_depends_on").on(table.dependsOnWorkOrderId),
  index("idx_wod_tenant_satisfied").on(table.tenantId, table.isSatisfied),
  unique("unq_wod_pair").on(table.workOrderId, table.dependsOnWorkOrderId),
]);

export const insertWorkOrderDependencySchema = createInsertSchema(workOrderDependencies).omit({
  id: true, createdAt: true, satisfiedAt: true,
});
export type InsertWorkOrderDependency = z.infer<typeof insertWorkOrderDependencySchema>;
export type WorkOrderDependency = typeof workOrderDependencies.$inferSelect;

// ============================================
// ADR v3 (F5/F6): Logg över omräknade fakturor (bokföringslagen)
// ============================================
export const invoiceRecalculationLog = pgTable("invoice_recalculation_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Vilken WO eller koncept omräkningen gäller
  workOrderId: varchar("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
  orderConceptId: varchar("order_concept_id").references(() => orderConcepts.id, { onDelete: "set null" }),
  // 'metadata_change' | 'index_adjustment' | 'price_change' | 'manual'
  recalculationReason: text("recalculation_reason").notNull(),
  // Beskrivning av ändringen
  description: text("description"),
  // Tidigare och nya värden för audit
  previousValue: real("previous_value"),
  newValue: real("new_value"),
  delta: real("delta"),
  // Vilka månader/perioder som påverkades (JSONB array av YYYY-MM)
  affectedPeriods: jsonb("affected_periods").default([]),
  // Trigger
  triggeredBy: varchar("triggered_by").references(() => users.id, { onDelete: "set null" }),
  triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_irl_tenant").on(table.tenantId),
  index("idx_irl_work_order").on(table.workOrderId),
  index("idx_irl_concept").on(table.orderConceptId),
  index("idx_irl_triggered_at").on(table.triggeredAt),
]);

export const insertInvoiceRecalculationLogSchema = createInsertSchema(invoiceRecalculationLog).omit({
  id: true, createdAt: true, triggeredAt: true,
});
export type InsertInvoiceRecalculationLog = z.infer<typeof insertInvoiceRecalculationLogSchema>;
export type InvoiceRecalculationLog = typeof invoiceRecalculationLog.$inferSelect;

// ============================================
// Task #421: ML duration-prediktion (Fas 0 + Fas 1)
// ============================================
export const mlFeatureSnapshots = pgTable("ml_feature_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  workOrderId: varchar("work_order_id").references(() => workOrders.id, { onDelete: "cascade" }).notNull(),
  resourceId: varchar("resource_id").references(() => resources.id, { onDelete: "set null" }),
  objectId: varchar("object_id").references(() => objects.id, { onDelete: "set null" }),
  // 'pre_optimization' | 'post_completion'
  snapshotKind: text("snapshot_kind").notNull(),
  snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
  estimatedDurationMin: integer("estimated_duration_min"),
  actualDurationMin: integer("actual_duration_min"),
  setupMinutes: integer("setup_minutes"),
  executionCode: text("execution_code"),
  taskCategory: text("task_category"),
  weekday: integer("weekday"),
  hourOfDay: integer("hour_of_day"),
  month: integer("month"),
  isWeekend: boolean("is_weekend"),
  objectPostalCode: text("object_postal_code"),
  objectLat: real("object_lat"),
  objectLng: real("object_lng"),
  resourceExperienceDays: integer("resource_experience_days"),
  rawFeatures: jsonb("raw_features").default({}).notNull(),
  qualityScore: real("quality_score"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_ml_snapshots_tenant").on(table.tenantId),
  index("idx_ml_snapshots_kind_created").on(table.snapshotKind, table.createdAt),
  index("idx_ml_snapshots_wo").on(table.workOrderId),
  index("idx_ml_snapshots_tenant_kind_created").on(table.tenantId, table.snapshotKind, table.createdAt),
]);

export type MlFeatureSnapshot = typeof mlFeatureSnapshots.$inferSelect;
export const insertMlFeatureSnapshotSchema = createInsertSchema(mlFeatureSnapshots).omit({ id: true, createdAt: true, snapshotAt: true });
export type InsertMlFeatureSnapshot = z.infer<typeof insertMlFeatureSnapshotSchema>;

export const mlModels = pgTable("ml_models", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // 'duration_p10' | 'duration_p50' | 'duration_p75' | 'duration_p90'
  modelType: text("model_type").notNull(),
  version: text("version").notNull(),
  // Lifecycle: 'training' | 'shadow' | 'canary' | 'active' | 'deprecated' | 'rolled_back'
  status: text("status").default("training").notNull(),
  // Blue-green: andel trafik (0–100) som routas till modellen vid canary
  rolloutPercentage: integer("rollout_percentage").default(0).notNull(),
  // Föregående aktiv modell (för rollback)
  previousModelId: varchar("previous_model_id"),
  promotedAt: timestamp("promoted_at"),
  rollbackReason: text("rollback_reason"),
  artifactPath: text("artifact_path"),
  trainedAt: timestamp("trained_at"),
  trainingRows: integer("training_rows"),
  trainingTenants: text("training_tenants").array(),
  metrics: jsonb("metrics").default({}).notNull(),
  featureNames: text("feature_names").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("uq_ml_models_type_version").on(table.modelType, table.version),
  index("idx_ml_models_type_status").on(table.modelType, table.status),
]);

export type MlModel = typeof mlModels.$inferSelect;
export const insertMlModelSchema = createInsertSchema(mlModels).omit({ id: true, createdAt: true });
export type InsertMlModel = z.infer<typeof insertMlModelSchema>;

export const replanningDecisions = pgTable("replanning_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull(),
  decidedAt: timestamp("decided_at").defaultNow().notNull(),
  // 'eta_slip' | 'no_show' | 'traffic' | 'manual' | 'capacity_breach'
  triggerKind: text("trigger_kind").notNull(),
  context: jsonb("context").default({}).notNull(),
  ruleBasedAction: jsonb("rule_based_action").notNull(),
  mlCounterfactualAction: jsonb("ml_counterfactual_action"),
  mlCounterfactualScore: doublePrecision("ml_counterfactual_score"),
  // 'rule_based' | 'ml' | 'manual_override'
  executedActionSource: text("executed_action_source").default("rule_based").notNull(),
  outcome: jsonb("outcome"),
  outcomeMeasuredAt: timestamp("outcome_measured_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_replanning_tenant_decided").on(table.tenantId, table.decidedAt),
  index("idx_replanning_trigger").on(table.triggerKind),
]);

export type ReplanningDecision = typeof replanningDecisions.$inferSelect;
export const insertReplanningDecisionSchema = createInsertSchema(replanningDecisions).omit({ id: true, createdAt: true, decidedAt: true });
export type InsertReplanningDecision = z.infer<typeof insertReplanningDecisionSchema>;

// Task #426 — Daglig hälsokoll på prod-data efter Modus-parallelldrift
// Lagrar en rad per körning av prodHealthCheckService så drift kan upptäckas
// över tid (t.ex. plötsligt tapp av kunder, orphans som dyker upp).
export const prodHealthCheckRuns = pgTable("prod_health_check_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id", { length: 255 }).notNull(),
  ranAt: timestamp("ran_at").defaultNow().notNull(),
  // 'PASS' | 'WARN' | 'FAIL'
  status: varchar("status", { length: 10 }).notNull(),
  passCount: integer("pass_count").notNull().default(0),
  warnCount: integer("warn_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  // Räknesatser per nyckeltabell, t.ex. { "customers (aktiva)": 486, ... }
  counts: jsonb("counts").notNull().default({}),
  // Alla individuella checkar: [{ name, status, detail }, ...]
  checks: jsonb("checks").notNull().default([]),
  // Tröskelvärden som användes vid körningen (för senare rotorsaksanalys)
  thresholds: jsonb("thresholds").notNull().default({}),
  // 'sent' | 'skipped' | 'failed' | null (för WARN/FAIL-notiser)
  alertStatus: varchar("alert_status", { length: 20 }),
  alertDetail: text("alert_detail"),
  errorMessage: text("error_message"),
}, (table) => [
  index("idx_prod_health_tenant_ran").on(table.tenantId, table.ranAt),
  index("idx_prod_health_status").on(table.status),
]);

export type ProdHealthCheckRun = typeof prodHealthCheckRuns.$inferSelect;
export const insertProdHealthCheckRunSchema = createInsertSchema(prodHealthCheckRuns).omit({ id: true, ranAt: true });
export type InsertProdHealthCheckRun = z.infer<typeof insertProdHealthCheckRunSchema>;

// Task #534 — Automatiserad GitHub-mirror.
// Persisterar varje schemalagd/manuell körning av mirror-pushen så vi kan
// visa "senaste lyckade push" i admin-UI / healthz och upptäcka om
// schemaläggaren slutat fungera. Se docs/disaster-recovery.md §10.
export const githubMirrorRuns = pgTable("github_mirror_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ranAt: timestamp("ran_at").defaultNow().notNull(),
  // 'success' | 'tripwire_blocked' | 'push_failed' | 'skipped' | 'error'
  status: varchar("status", { length: 32 }).notNull(),
  // 'scheduled' | 'manual' | 'startup'
  trigger: varchar("trigger", { length: 16 }).notNull().default("scheduled"),
  branch: varchar("branch", { length: 128 }).notNull().default("main"),
  localSha: varchar("local_sha", { length: 64 }),
  remoteSha: varchar("remote_sha", { length: 64 }),
  fastForward: boolean("fast_forward"),
  tripwireCommitsScanned: integer("tripwire_commits_scanned"),
  tripwireThreshold: integer("tripwire_threshold"),
  tripwireSuspicious: jsonb("tripwire_suspicious"),
  durationMs: integer("duration_ms").notNull().default(0),
  alertStatus: varchar("alert_status", { length: 20 }),
  alertDetail: text("alert_detail"),
  errorMessage: text("error_message"),
}, (table) => [
  index("idx_github_mirror_runs_ran_at").on(table.ranAt),
  index("idx_github_mirror_runs_status_ran_at").on(table.status, table.ranAt),
]);

export type GithubMirrorRun = typeof githubMirrorRuns.$inferSelect;

// =====================================================================
// Task #785 — Veckoplanering: datafundament
// =====================================================================
// Grunden för grov-/veckoplanering per team. Veckoplanen är den centrala
// planeringsentiteten; stödtabeller hanterar tidsblock, vila, resor,
// distrikt, pre-tasks och varningar. Beräkningslogik (KPI/168h/varningar/
// resekostnad), API och UI ligger i separata tasks.
//
// Styrda värdelistor (textkolumner med tillåtna värden enligt projektets
// konvention — ej pg-enum):
//   time_category: production | travel_between_jobs | travel_commute |
//                  break_meal | personal_time | rest_night | rest_weekend |
//                  overtime
//   weekly_plan_status: draft | proposed | approved | in_progress | completed
//   warning_severity: error | warning | info | ok
// =====================================================================

// Geografiska distrikt — grovplaneringens översta geografiska indelning.
export const geographicDistricts = pgTable("geographic_districts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  // Kort beteckning/kod (valfri, t.ex. "NORR").
  code: text("code"),
  description: text("description"),
  color: text("color").default("#3B82F6"),
  // Distriktets centroid (för karta/avstånd).
  centerLat: real("center_lat"),
  centerLng: real("center_lng"),
  status: text("status").default("active").notNull(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_geographic_districts_tenant").on(table.tenantId),
  index("idx_geographic_districts_tenant_deleted").on(table.tenantId, table.deletedAt),
]);

export type GeographicDistrict = typeof geographicDistricts.$inferSelect;
export const insertGeographicDistrictSchema = createInsertSchema(geographicDistricts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertGeographicDistrict = z.infer<typeof insertGeographicDistrictSchema>;

// Distrikt-zoner — finare indelning inom ett distrikt (postnummer/polygon).
export const districtZones = pgTable("district_zones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  districtId: varchar("district_id").references(() => geographicDistricts.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  code: text("code"),
  // Postnummer som ingår i zonen.
  postalCodes: text("postal_codes").array().default([]),
  // GeoJSON-polygon (valfri) som definierar zonens gränser.
  polygon: jsonb("polygon"),
  centerLat: real("center_lat"),
  centerLng: real("center_lng"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_district_zones_tenant").on(table.tenantId),
  index("idx_district_zones_district").on(table.districtId),
]);

export type DistrictZone = typeof districtZones.$inferSelect;
export const insertDistrictZoneSchema = createInsertSchema(districtZones).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDistrictZone = z.infer<typeof insertDistrictZoneSchema>;

// Veckoplan — central planeringsentitet per team och ISO-vecka.
// Summerings-/KPI-fälten fylls av motor-lagret (egen task); här definieras
// endast strukturen. contracted_hours defaultas från team.totalHoursWeek i
// storage-lagret vid skapande.
export const weeklyPlans = pgTable("weekly_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  teamId: varchar("team_id").references(() => teams.id).notNull(),
  // ISO-år + ISO-veckonummer (1-53).
  year: integer("year").notNull(),
  weekNumber: integer("week_number").notNull(),
  // weekly_plan_status: draft | proposed | approved | in_progress | completed
  status: text("status").default("draft").notNull(),
  // Avtalade timmar för veckan (defaultas från team.totalHoursWeek i storage).
  contractedHours: real("contracted_hours"),
  // === Summeringar (minuter) — fylls av motor-lagret ===
  totalProductionMinutes: integer("total_production_minutes").default(0),
  totalTravelMinutes: integer("total_travel_minutes").default(0),
  totalCommuteMinutes: integer("total_commute_minutes").default(0),
  totalBreakMinutes: integer("total_break_minutes").default(0),
  totalPersonalMinutes: integer("total_personal_minutes").default(0),
  totalRestMinutes: integer("total_rest_minutes").default(0),
  totalOvertimeMinutes: integer("total_overtime_minutes").default(0),
  // === KPI (härleds) ===
  utilizationRate: real("utilization_rate"),
  totalPlannedHours: real("total_planned_hours"),
  // Värde (öre) och resekostnad (öre) — summeras av motorn.
  totalValue: integer("total_value").default(0),
  totalTravelCost: integer("total_travel_cost").default(0),
  taskCount: integer("task_count").default(0),
  // === Vila & plats ===
  // team.restType speglas hit vid plan-skapande; planen kan ha egen plats.
  restType: text("rest_type"),
  restLocation: text("rest_location"),
  startLocationLat: real("start_location_lat"),
  startLocationLng: real("start_location_lng"),
  endLocationLat: real("end_location_lat"),
  endLocationLng: real("end_location_lng"),
  // === Godkännande ===
  approvedBy: varchar("approved_by"),
  approvedAt: timestamp("approved_at"),
  notes: text("notes"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_weekly_plans_tenant").on(table.tenantId),
  index("idx_weekly_plans_team").on(table.teamId),
  index("idx_weekly_plans_tenant_week").on(table.tenantId, table.year, table.weekNumber),
  index("idx_weekly_plans_tenant_deleted").on(table.tenantId, table.deletedAt),
  unique("unq_weekly_plans_team_week").on(table.tenantId, table.teamId, table.year, table.weekNumber),
]);

export type WeeklyPlan = typeof weeklyPlans.$inferSelect;
export const insertWeeklyPlanSchema = createInsertSchema(weeklyPlans).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWeeklyPlan = z.infer<typeof insertWeeklyPlanSchema>;

// Veckoplan-uppgift — binder en work_order till en veckoplan med planerat
// datum/tid, sekvens och lås. task_id refererar work_orders (Traivos arbetsenhet).
export const weeklyPlanTasks = pgTable("weekly_plan_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  weeklyPlanId: varchar("weekly_plan_id").references(() => weeklyPlans.id, { onDelete: "cascade" }).notNull(),
  // Refererar work_orders.id (rapportens generiska `tasks` = Traivos work_orders).
  taskId: varchar("task_id").references(() => workOrders.id, { onDelete: "cascade" }).notNull(),
  teamId: varchar("team_id").references(() => teams.id),
  plannedDate: date("planned_date"),
  plannedStartTime: timestamp("planned_start_time"),
  plannedEndTime: timestamp("planned_end_time"),
  // Sekvens inom dagen/veckan (sorteringsordning).
  sequence: integer("sequence").default(0),
  // Lås mot omplanering av motorn.
  locked: boolean("locked").default(false).notNull(),
  // Cachade tidsvärden (fylls av motorn).
  productionMinutes: integer("production_minutes"),
  travelMinutes: integer("travel_minutes"),
  notes: text("notes"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_weekly_plan_tasks_tenant").on(table.tenantId),
  index("idx_weekly_plan_tasks_plan").on(table.weeklyPlanId),
  index("idx_weekly_plan_tasks_task").on(table.taskId),
  index("idx_weekly_plan_tasks_plan_date").on(table.weeklyPlanId, table.plannedDate),
  unique("unq_weekly_plan_tasks_plan_task").on(table.weeklyPlanId, table.taskId),
]);

export type WeeklyPlanTask = typeof weeklyPlanTasks.$inferSelect;
export const insertWeeklyPlanTaskSchema = createInsertSchema(weeklyPlanTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWeeklyPlanTask = z.infer<typeof insertWeeklyPlanTaskSchema>;

// Personliga uppgifter — alla icke-produktionsblock (vila, rast, personlig
// tid, inställelse-/återresa). Bär plats samt från/till-plats för restid.
export const personalTasks = pgTable("personal_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  weeklyPlanId: varchar("weekly_plan_id").references(() => weeklyPlans.id, { onDelete: "cascade" }),
  teamId: varchar("team_id").references(() => teams.id),
  // time_category (se värdelista) — production exkluderas här.
  timeCategory: text("time_category").notNull(),
  // Prioritets-override för finplaneringens överlapp (1=högst/aldrig överlapp ... 3=lägst).
  // NULL = härled från tidskod-registret via timeCategory (time_code_definitions.priority).
  // Sätts explicit för att t.ex. höja en egentid (läkarbesök) till prio 1 så den beter sig
  // som ett jobb och blockerar överlapp. Nullable (expand-contract).
  priority: integer("priority"),
  title: text("title").notNull(),
  description: text("description"),
  plannedDate: date("planned_date"),
  startAt: timestamp("start_at"),
  endAt: timestamp("end_at"),
  durationMinutes: integer("duration_minutes"),
  // Plats där blocket utförs (t.ex. rastplats).
  locationLat: real("location_lat"),
  locationLng: real("location_lng"),
  locationName: text("location_name"),
  // Från-/till-plats för inställelse-/återresa (is_commute=true).
  fromLat: real("from_lat"),
  fromLng: real("from_lng"),
  toLat: real("to_lat"),
  toLng: real("to_lng"),
  isCommute: boolean("is_commute").default(false).notNull(),
  // true = autogenererad av en regel (personal_task_schedules/source_rule).
  isGenerated: boolean("is_generated").default(false).notNull(),
  sourceRule: text("source_rule"),
  // Task #1235: artikelkoppling. Icke-produktionstid (vila/lunch/semester/sjukdom/
  // utbildning/administration/egen tid) blir en "riktig" artikelbaserad uppgift genom
  // att peka på en articleType="internal_time"-artikel (matchad via timeCodeKey===
  // timeCategory). cachedCostOre speglar work_orders.cachedCost-mönstret så kostnads-
  // beräkning/lön/fakturering/statistik kan läsa samma fält oavsett uppgiftstyp.
  // Nullable (expand-contract): saknad koppling = fristående tidspost som tidigare.
  articleId: varchar("article_id").references(() => articles.id, { onDelete: "set null" }),
  cachedCostOre: integer("cached_cost_ore"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_personal_tasks_tenant").on(table.tenantId),
  index("idx_personal_tasks_article").on(table.articleId),
  index("idx_personal_tasks_plan").on(table.weeklyPlanId),
  index("idx_personal_tasks_team").on(table.teamId),
  index("idx_personal_tasks_plan_date").on(table.weeklyPlanId, table.plannedDate),
]);

export type PersonalTask = typeof personalTasks.$inferSelect;
export const insertPersonalTaskSchema = createInsertSchema(personalTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPersonalTask = z.infer<typeof insertPersonalTaskSchema>;

// Personliga-uppgift-scheman — återkommande regler som genererar personal_tasks
// (t.ex. daglig lunchrast, inställelse-/återresa per arbetsdag).
export const personalTaskSchedules = pgTable("personal_task_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Null = gäller alla team i tenanten.
  teamId: varchar("team_id").references(() => teams.id),
  timeCategory: text("time_category").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  // Veckodag 0-6 (mån=0 ... sön=6). Null = alla arbetsdagar.
  dayOfWeek: integer("day_of_week"),
  // Starttid "HH:MM" (lokal) och längd i minuter.
  startTime: text("start_time"),
  durationMinutes: integer("duration_minutes"),
  isCommute: boolean("is_commute").default(false).notNull(),
  locationLat: real("location_lat"),
  locationLng: real("location_lng"),
  locationName: text("location_name"),
  active: boolean("active").default(true).notNull(),
  sourceRule: text("source_rule"),
  // Task #1242 (Kalendereditor): generaliserad återkommande-modell. Nullable/expand-contract
  // — null bevarar legacy-beteendet (dayOfWeek styr ensam, null=alla arbetsdagar mån-fre).
  // "daily" = alla 7 dagar. "weekly" = de dagar som anges i daysOfWeek (0=mån..6=sön).
  recurrenceType: text("recurrence_type"),
  daysOfWeek: integer("days_of_week").array(),
  // Valfritt datumintervall som avgränsar när regeln gäller (inclusive). Null = ingen gräns.
  startDate: date("start_date"),
  endDate: date("end_date"),
  // Task #1242: låter en regel peka direkt på en artikel (allmän uppgiftseditor) i stället
  // för att enbart matchas indirekt via timeCategory===article.timeCodeKey. Nullable —
  // saknas koppling faller materialiseringen tillbaka på timeCategory-matchning som idag.
  articleId: varchar("article_id").references(() => articles.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_personal_task_schedules_tenant").on(table.tenantId),
  index("idx_personal_task_schedules_team").on(table.teamId),
  index("idx_personal_task_schedules_article").on(table.articleId),
]);

export type PersonalTaskSchedule = typeof personalTaskSchedules.$inferSelect;
export const insertPersonalTaskScheduleSchema = createInsertSchema(personalTaskSchedules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPersonalTaskSchedule = z.infer<typeof insertPersonalTaskScheduleSchema>;

// Restidsposter — beräknade resor mellan uppgifter / inställelse-/återresor.
export const travelTimeEntries = pgTable("travel_time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  weeklyPlanId: varchar("weekly_plan_id").references(() => weeklyPlans.id, { onDelete: "cascade" }),
  // Från-/till-uppgift (work_orders). Null vid inställelse/återresa till bas.
  fromTaskId: varchar("from_task_id").references(() => workOrders.id, { onDelete: "set null" }),
  toTaskId: varchar("to_task_id").references(() => workOrders.id, { onDelete: "set null" }),
  fromLat: real("from_lat"),
  fromLng: real("from_lng"),
  toLat: real("to_lat"),
  toLng: real("to_lng"),
  travelMinutes: integer("travel_minutes"),
  distanceKm: real("distance_km"),
  // Resekostnad i öre (beräknas av motor-lagret).
  travelCost: integer("travel_cost"),
  // Färdsätt (t.ex. "driving").
  mode: text("mode").default("driving"),
  isCommute: boolean("is_commute").default(false).notNull(),
  // Datakälla: osrm | geoapify | estimate.
  source: text("source"),
  plannedDate: date("planned_date"),
  // Task #1153: Tidskod (time_code_definitions.key) för resemomentet. Auto-klassas av
  // motorn (dagens första resa = inställelse/travel_commute, övriga = ställtid/setup),
  // men kan override:as manuellt. Omräkningen skriver aldrig över en manuell tidskod.
  timeCategory: text("time_category"),
  timeCategoryManual: boolean("time_category_manual").default(false).notNull(),
  // True = auto-genererad job→job-post (rebuildTravelEntriesForPlan). Manuella ad-hoc-poster
  // (false) rörs aldrig av omräkning/rebuild.
  isAuto: boolean("is_auto").default(false).notNull(),
  // Task #1235 (Motor 12/restidsmotor): artikeln (articleType="restid") som drev
  // travelMinutes/travelCost för denna resa via resolveTravelArticle() i
  // weeklyPlanEngine.ts. Null = ingen matchande tenant-artikel — motorn föll tillbaka
  // på legacy config.costPerKmOre + haversine/routing-tid (oförändrat beteende).
  articleId: varchar("article_id").references(() => articles.id, { onDelete: "set null" }),
  // Framkalkylering (transparens, display-only): rå tid/källa + tillämpat hastighetstak,
  // restidsfaktor och vinterfaktor. Se applyTravelCorrection i weeklyPlanEngine.
  correction: jsonb("correction"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_travel_time_entries_tenant").on(table.tenantId),
  index("idx_travel_time_entries_plan").on(table.weeklyPlanId),
]);

export type TravelTimeEntry = typeof travelTimeEntries.$inferSelect;
export const insertTravelTimeEntrySchema = createInsertSchema(travelTimeEntries).omit({ id: true, createdAt: true });
export type InsertTravelTimeEntry = z.infer<typeof insertTravelTimeEntrySchema>;

// Task #1238: Planeringsreservationer ("reservtid") — en reserverad tidslucka i
// 168h-vyn (t.ex. "förbehåll för OB-jobb torsdag kväll"). INTE en riktig uppgift:
// skapar aldrig work_orders/personal_tasks-rader och syns aldrig i produktions-,
// löne- eller faktureringsflöden. Renderas som en overlay/reservation-band i
// kalendern och krymper automatiskt när riktiga uppgifter (weekly_plan_tasks/
// personal_tasks) läggs in i fönstret — se computeReservationConsumption i
// weeklyPlanEngine.ts (beräknas on-read, lagras aldrig som "förbrukat").
export const planningReservations = pgTable("planning_reservations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  weeklyPlanId: varchar("weekly_plan_id").references(() => weeklyPlans.id, { onDelete: "cascade" }).notNull(),
  teamId: varchar("team_id").references(() => teams.id),
  resourceId: varchar("resource_id").references(() => resources.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  plannedDate: date("planned_date"),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  notes: text("notes"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_planning_reservations_tenant").on(table.tenantId),
  index("idx_planning_reservations_plan").on(table.weeklyPlanId),
  index("idx_planning_reservations_resource").on(table.resourceId),
  index("idx_planning_reservations_plan_date").on(table.weeklyPlanId, table.plannedDate),
]);

export type PlanningReservation = typeof planningReservations.$inferSelect;
export const insertPlanningReservationSchema = createInsertSchema(planningReservations)
  .omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlanningReservation = z.infer<typeof insertPlanningReservationSchema>;

// Veckoplan-varningar — strukturerade varningar/avvikelser från motor-lagret.
export const weeklyPlanWarnings = pgTable("weekly_plan_warnings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  weeklyPlanId: varchar("weekly_plan_id").references(() => weeklyPlans.id, { onDelete: "cascade" }).notNull(),
  // warning_severity: error | warning | info | ok
  severity: text("severity").default("warning").notNull(),
  // Maskinläsbar kod (t.ex. "OVER_CAPACITY", "REST_VIOLATION").
  code: text("code"),
  // Kategori (t.ex. capacity | rest | travel | sla).
  category: text("category"),
  message: text("message").notNull(),
  // Relaterad work_order / personal_task (valfritt).
  relatedTaskId: varchar("related_task_id").references(() => workOrders.id, { onDelete: "cascade" }),
  relatedPersonalTaskId: varchar("related_personal_task_id").references(() => personalTasks.id, { onDelete: "cascade" }),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolved_at"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_weekly_plan_warnings_tenant").on(table.tenantId),
  index("idx_weekly_plan_warnings_plan").on(table.weeklyPlanId),
  index("idx_weekly_plan_warnings_severity").on(table.weeklyPlanId, table.severity),
]);

export type WeeklyPlanWarning = typeof weeklyPlanWarnings.$inferSelect;
export const insertWeeklyPlanWarningSchema = createInsertSchema(weeklyPlanWarnings).omit({ id: true, createdAt: true });
export type InsertWeeklyPlanWarning = z.infer<typeof insertWeeklyPlanWarningSchema>;

// Pre-tasks — föruppgifter (plocka/beställ/föravisering) kopplade till en order.
export const preTasks = pgTable("pre_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Order som pre-tasken förbereder (valfri för fristående förberedelser).
  workOrderId: varchar("work_order_id").references(() => workOrders.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  // Typ (t.ex. plocka | bestall | foravisering).
  preTaskType: text("pre_task_type"),
  // status: pending | done (fritt textfält).
  status: text("status").default("pending").notNull(),
  // Antal dagar före jobbet pre-tasken bör vara klar.
  dueOffsetDays: integer("due_offset_days"),
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by"),
  // true = autogenererad via exec_type_pre_task_rules.
  isGenerated: boolean("is_generated").default(false).notNull(),
  sourceRule: text("source_rule"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_pre_tasks_tenant").on(table.tenantId),
  index("idx_pre_tasks_work_order").on(table.workOrderId),
  index("idx_pre_tasks_tenant_status").on(table.tenantId, table.status),
]);

export type PreTask = typeof preTasks.$inferSelect;
export const insertPreTaskSchema = createInsertSchema(preTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPreTask = z.infer<typeof insertPreTaskSchema>;

// Regler som mappar utförandetyp (work_orders.execution_type) → pre-tasks
// som ska autogenereras.
export const execTypePreTaskRules = pgTable("exec_type_pre_task_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Matchar work_orders.execution_type.
  executionType: text("execution_type").notNull(),
  preTaskType: text("pre_task_type"),
  title: text("title").notNull(),
  description: text("description"),
  // Antal dagar före jobbet som pre-tasken förfaller.
  offsetDays: integer("offset_days").default(0),
  autoGenerate: boolean("auto_generate").default(true).notNull(),
  active: boolean("active").default(true).notNull(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_exec_type_pre_task_rules_tenant").on(table.tenantId),
  index("idx_exec_type_pre_task_rules_exec_type").on(table.tenantId, table.executionType),
]);

export type ExecTypePreTaskRule = typeof execTypePreTaskRules.$inferSelect;
export const insertExecTypePreTaskRuleSchema = createInsertSchema(execTypePreTaskRules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertExecTypePreTaskRule = z.infer<typeof insertExecTypePreTaskRuleSchema>;

// Pågående störningar (resursbortfall, akutjobb, försening, ledig tid) med sina
// förslag och beslutsspår. Persisteras (i stället för en process-lokal Map) så att
// aktiva störningar och deras förslag överlever serveromstart / flerinstans-deploy.
// `id` är tjänst-genererad ("dis-...") så ingen DB-default. Nästlade strukturer
// (förslag, beslutsspår, nedströms-ETA, påverkade order-id:n) lagras som jsonb.
export const disruptions = pgTable("disruptions", {
  id: varchar("id").primaryKey(),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  type: text("type").notNull(),
  status: text("status").default("active").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  affectedResourceId: varchar("affected_resource_id"),
  affectedWorkOrderIds: jsonb("affected_work_order_ids").default([]).notNull(),
  suggestions: jsonb("suggestions").default([]).notNull(),
  decisionTrace: jsonb("decision_trace").default([]).notNull(),
  downstreamEta: jsonb("downstream_eta"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_disruptions_tenant").on(table.tenantId),
  index("idx_disruptions_tenant_status").on(table.tenantId, table.status),
]);

export type Disruption = typeof disruptions.$inferSelect;
export const insertDisruptionSchema = createInsertSchema(disruptions);
export type InsertDisruption = z.infer<typeof insertDisruptionSchema>;

// =====================================================================
// Task #1037 — Slottids-register (Tids- & geografimotor, datafundament)
// =====================================================================
// Registret håller motorns BERÄKNADE slottider (möjliga tidsfönster) per
// uppgift (assignment) eller per en grupp av uppgifter (klumpuppgift). Flera
// kandidater kan finnas per uppgift/grupp; motorn (separat task #1038) rankar
// dem. Allt här är expand-only och additivt: ingen befintlig tabell ändras och
// inga befintliga flöden (import/VRP/Fortnox/mobil) påverkas.
//
// Uppgiftens STORHETER (ordervärde, kostnad, produktionstid) lagras INTE här —
// de återanvänds från befintliga fält på `assignments`:
//   ordervärde     = assignments.cachedValue        (öre)
//   kostnad        = assignments.cachedCost          (öre)
//   produktionstid = assignments.estimatedDuration   (minuter)
// med drill-down per artikel i assignment_articles.totalPrice/totalCost/totalTime.
// Motorn (#1038) summerar dessa vid gruppering till klumpuppgifter.
//
// Styrda värdelistor (textkolumner enligt projektkonvention — ej pg-enum):
//   slot_type:   onskad | kravd | fordelaktig
//   slot_status: forslag | vald
//
// `assignment_group_key` är en opak, tenant-scopead nyckel som låter motorn binda
// en slottid till en klumpuppgift utan att en grupp-tabell behöver finnas ännu
// (#1038 äger klumpuppgift-modellen och kan senare lägga till en riktig grupp-
// tabell + nullbar FK utan att bryta detta register). En rad måste peka på minst
// en uppgift ELLER en grupp (CHECK).
// =====================================================================
export const slotTimes = pgTable("slot_times", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Uppgiften slottiden gäller (task-nivå). NULL för rena grupp-slottider.
  assignmentId: varchar("assignment_id").references(() => assignments.id, { onDelete: "cascade" }),
  // Opak grupp-nyckel för klumpuppgift (grupp-nivå). NULL för rena uppgifts-slottider.
  assignmentGroupKey: text("assignment_group_key"),
  // Tidsfönstrets start/slut (motorns kandidat).
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  // slot_type: onskad | kravd | fordelaktig
  slotType: text("slot_type").notNull(),
  // slot_status: forslag | vald
  status: text("status").default("forslag").notNull(),
  // Rang/ordning bland flera kandidater (motorn sätter; lägre = högre prioritet).
  rank: integer("rank").default(0).notNull(),
  // Valfri poäng från motorn (för sortering/förklaring).
  score: real("score"),
  // Ursprung, t.ex. "tidsmotor".
  source: text("source"),
  // Planerarens beslut om motorns förslag (Task #1043): NULL = obeslutat,
  // "accepterad" = förs vidare till finplanering/ruttoptimering, "avvisad" = avfärdat.
  plannerDecision: text("planner_decision"),
  decidedAt: timestamp("decided_at"),
  decidedBy: varchar("decided_by"),
  // Förklaring/extra (motivering, viktning) — fri jsonb.
  metadata: jsonb("metadata").default({}),
  // Task #1239: klumpens/stoppets EGEN primära navigeringsposition — skild från
  // varje medlemsuppgifts egen position. NULL för rena uppgifts-slottider (bara
  // relevant på grupp-rader, dvs assignmentGroupKey satt). Sätts av motorn till
  // "ankarets" (högst ekonomiskt värde) position, om ingen manuell override finns.
  primaryLatitude: real("primary_latitude"),
  primaryLongitude: real("primary_longitude"),
  primaryAddress: text("primary_address"),
  // Vilken medlemsuppgift som gav upphov till primärpositionen (ankaret).
  primaryAssignmentId: varchar("primary_assignment_id").references(() => assignments.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("idx_slot_times_tenant").on(table.tenantId),
  index("idx_slot_times_tenant_assignment").on(table.tenantId, table.assignmentId),
  index("idx_slot_times_tenant_group").on(table.tenantId, table.assignmentGroupKey),
  index("idx_slot_times_tenant_status").on(table.tenantId, table.status),
  index("idx_slot_times_tenant_window_start").on(table.tenantId, table.windowStart),
  index("idx_slot_times_tenant_deleted").on(table.tenantId, table.deletedAt),
  index("idx_slot_times_tenant_decision").on(table.tenantId, table.plannerDecision),
  check("chk_slot_times_target", sql`${table.assignmentId} IS NOT NULL OR ${table.assignmentGroupKey} IS NOT NULL`),
  check("chk_slot_times_window_order", sql`${table.windowEnd} >= ${table.windowStart}`),
]);

export type SlotTime = typeof slotTimes.$inferSelect;
export const insertSlotTimeSchema = createInsertSchema(slotTimes).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true });
export type InsertSlotTime = z.infer<typeof insertSlotTimeSchema>;

// ============================================================================
// Task #1240: Delad filtermotor — sparade/delade/roll-scopade filter.
// Ett filter (villkorsträd, se shared/filter-engine.ts) sparat mot en yta
// (uppgiftsnav/objektnav/portal/utforarapp/administration). isShared=true gör
// filtret synligt för alla i tenanten (inte bara skaparen); roles begränsar
// vilka roller som får se det delade filtret (tom lista = alla roller).
// ============================================================================
export const savedFilters = pgTable("saved_filters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  userId: varchar("user_id").notNull(),
  scope: text("scope").notNull(),
  name: text("name").notNull(),
  definition: jsonb("definition").notNull(),
  isShared: boolean("is_shared").default(false).notNull(),
  roles: text("roles").array().default(sql`'{}'::text[]`).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_saved_filters_tenant_scope").on(table.tenantId, table.scope),
  index("idx_saved_filters_tenant_user").on(table.tenantId, table.userId),
]);

export type SavedFilter = typeof savedFilters.$inferSelect;
export const insertSavedFilterSchema = createInsertSchema(savedFilters)
  .omit({ id: true, tenantId: true, userId: true, createdAt: true, updatedAt: true })
  .extend({
    definition: z.record(z.any()),
    roles: z.array(z.string()).optional().default([]),
  });
export type InsertSavedFilter = z.infer<typeof insertSavedFilterSchema>;

// ============================================================================
// ADR Klumpning v1: Dynamiska stopp- och ruttklumpar
//
// STOPPKLUMP = dynamisk grupp av uppgifter som kan utföras vid samma fysiska stopp
// (t.ex. "Mekanivägen 2C, Tullinge"). Operativ horisont 1–2 veckor.
//
// RUTTKLUMP = dynamisk grupp av stopp som bör utföras under samma produktionsdag
// (t.ex. "Nynäshamn", "Södertälje–Nynäshamn"). Strategisk horisont upp till 1 år.
//
// Skiljer sig från `clusters` (permanent organisationsstruktur, ingen FK längre
// i UI men kolumner bevarade för VRP/plumbing expand-contract).
//
// Klump-ID:n finns på BÅDA work_orders OCH assignments (Alt B — se ADR §3):
//   work_orders  → manuella/snabborder-uppgifter + materialiserade call_off
//   assignments  → koncept-genererade uppgifter som ej ännu materialiserats
//
// Status-flöde: active → confirmed → locked → dissolved
//   active    = motorns aktuella beslut
//   confirmed = planeraren har bekräftat
//   locked    = låst för manuell planering (motorn rör ej)
//   dissolved = klumpen är upplöst (historik bevaras)
// ============================================================================

export const stopClusters = pgTable("stop_clusters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Löpande referensnummer per tenant, format "SC-NNN" (myntas server-side).
  referenceNumber: text("reference_number"),
  // Visningsnamn: "{Gatuadress}, {Stad}" eller "{Gatuadress} – {Extra info}".
  displayName: text("display_name").notNull(),
  normalizedAddress: text("normalized_address"),
  city: text("city"),
  // Geografisk tyngdpunkt för klumpen (WGS-84, haversine v1 — PostGIS framtida beslut).
  latitude: real("latitude"),
  longitude: real("longitude"),
  // Klumpens effektiva geografi-radie (default 30m per konfiguration).
  radiusMeters: real("radius_meters").default(30),
  // Utförandekod — lagras som text (soft-ref till execution_code_definitions.key, codebase-konvention)
  // OCH som UUID FK för referensintegritet. NULL = ingen utförandekod specificerad för klumpen.
  executionCode: text("execution_code"),
  executionCodeDefinitionId: varchar("execution_code_definition_id").references(
    () => executionCodeDefinitions.id, { onDelete: "set null" }
  ),
  // Tidsfönster för klumpen (union av alla ingående uppgifters tidsfönster).
  earliestDeliveryAt: timestamp("earliest_delivery_at"),
  latestDeliveryAt: timestamp("latest_delivery_at"),
  // Beräknad total produktionstid (summa av estimatedDuration på ingående uppgifter).
  calculatedDurationMinutes: integer("calculated_duration_minutes"),
  // Status-flöde (se kommentar ovan).
  status: text("status").default("active").notNull(),
  // Versionsmärkning av den regelkonfiguration som skapade klumpen (för omräkningskoll).
  clusteringRuleVersion: text("clustering_rule_version"),
  lastCalculatedAt: timestamp("last_calculated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  dissolvedAt: timestamp("dissolved_at"),
}, (table) => [
  index("idx_stop_clusters_tenant").on(table.tenantId),
  index("idx_stop_clusters_tenant_status").on(table.tenantId, table.status),
  index("idx_stop_clusters_tenant_execution_code").on(table.tenantId, table.executionCode),
  uniqueIndex("uq_stop_clusters_reference_number")
    .on(table.tenantId, table.referenceNumber)
    .where(sql`reference_number IS NOT NULL`),
]);

export type StopCluster = typeof stopClusters.$inferSelect;
export const insertStopClusterSchema = createInsertSchema(stopClusters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  dissolvedAt: true,
});
export type InsertStopCluster = z.infer<typeof insertStopClusterSchema>;

// ============================================================================

export const routeClusters = pgTable("route_clusters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  // Löpande referensnummer per tenant, format "RC-NNN" (myntas server-side).
  referenceNumber: text("reference_number"),
  // Visningsnamn sätts via reverse geocoding av tyngdpunkten (getMapProvider()).
  // Flerortiga klumpar: "Stad1–Stad2". Fallback: "Ruttförslag YYYY-MM-DD".
  displayName: text("display_name").notNull(),
  routeDescription: text("route_description"),
  // Geografisk tyngdpunkt (viktat medelvärde av ingående stopp).
  centerLatitude: real("center_latitude"),
  centerLongitude: real("center_longitude"),
  // Klumpens effektiva geografi-radie (default 40 km per konfiguration).
  radiusKilometers: real("radius_kilometers").default(40),
  // Utförandekod — lagras som text (soft-ref, codebase-konvention) OCH som UUID FK.
  // NULL = blandad klump (ingen homogen utförandekod), konfigurationsval.
  executionCode: text("execution_code"),
  executionCodeDefinitionId: varchar("execution_code_definition_id").references(
    () => executionCodeDefinitions.id, { onDelete: "set null" }
  ),
  // Tidsfönster för hela ruttklumpen (union av ingående stoppklumpars tidsfönster).
  earliestDeliveryAt: timestamp("earliest_delivery_at"),
  latestDeliveryAt: timestamp("latest_delivery_at"),
  // Beräknad produktionstid (summa) och restid (uppskattad via haversine-kedja).
  calculatedWorkMinutes: integer("calculated_work_minutes"),
  calculatedTravelMinutes: integer("calculated_travel_minutes"),
  // Precisionsindikator: high (≤30d), medium (30–90d), low (90–365d).
  precisionLevel: text("precision_level").default("high"),
  // Status-flöde (se kommentar ovan vid stopClusters).
  status: text("status").default("active").notNull(),
  // Versionsmärkning av regelkonfigurationen.
  clusteringRuleVersion: text("clustering_rule_version"),
  lastCalculatedAt: timestamp("last_calculated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  dissolvedAt: timestamp("dissolved_at"),
}, (table) => [
  index("idx_route_clusters_tenant").on(table.tenantId),
  index("idx_route_clusters_tenant_status").on(table.tenantId, table.status),
  index("idx_route_clusters_tenant_execution_code").on(table.tenantId, table.executionCode),
  uniqueIndex("uq_route_clusters_reference_number")
    .on(table.tenantId, table.referenceNumber)
    .where(sql`reference_number IS NOT NULL`),
]);

export type RouteCluster = typeof routeClusters.$inferSelect;
export const insertRouteClusterSchema = createInsertSchema(routeClusters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  dissolvedAt: true,
});
export type InsertRouteCluster = z.infer<typeof insertRouteClusterSchema>;

// ============================================================================
// Klump-membership-historik (append-only)
//
// Spårar varje tilldelning och borttagning av uppgifter från klumpar.
// taskId refererar till work_order.id (för manuella) eller assignment.id (för
// koncept-genererade). taskTable = 'work_orders' | 'assignments' skiljer källa.
// assigned_at / removed_at + removal_reason ger full audit trail.
// ============================================================================

export const stopClusterMemberships = pgTable("stop_cluster_memberships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  stopClusterId: varchar("stop_cluster_id").references(() => stopClusters.id).notNull(),
  // Uppgiftens id (work_order eller assignment — se taskTable).
  taskId: varchar("task_id").notNull(),
  // Vilken tabell uppgiften bor i: 'work_orders' | 'assignments'.
  taskTable: text("task_table").notNull(),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  // NULL = fortfarande aktiv i klumpen.
  removedAt: timestamp("removed_at"),
  // Anledning till borttagning: recluster | manual | dissolved | status_change.
  removalReason: text("removal_reason"),
}, (table) => [
  index("idx_stop_cluster_memberships_cluster").on(table.stopClusterId),
  index("idx_stop_cluster_memberships_task").on(table.taskId, table.taskTable),
  index("idx_stop_cluster_memberships_tenant_active").on(table.tenantId, table.removedAt),
]);

export type StopClusterMembership = typeof stopClusterMemberships.$inferSelect;

export const routeClusterMemberships = pgTable("route_cluster_memberships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  routeClusterId: varchar("route_cluster_id").references(() => routeClusters.id).notNull(),
  taskId: varchar("task_id").notNull(),
  taskTable: text("task_table").notNull(),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  removedAt: timestamp("removed_at"),
  removalReason: text("removal_reason"),
}, (table) => [
  index("idx_route_cluster_memberships_cluster").on(table.routeClusterId),
  index("idx_route_cluster_memberships_task").on(table.taskId, table.taskTable),
  index("idx_route_cluster_memberships_tenant_active").on(table.tenantId, table.removedAt),
]);

export type RouteClusterMembership = typeof routeClusterMemberships.$inferSelect;

// ============================================================================
// Task #991: Enhetligt utförarregister (läsmodell)
// En samlad vy där personer, fordon/utrustning och team visas tillsammans, med
// team som grupperande förälder. Ren läs-/aggregeringsmodell — inga nya tabeller,
// ingen fysisk sammanslagning. Kostnadsställe + projekt exponeras enhetligt per nod.
// ============================================================================
export interface ExecutorRegisterAsset {
  id: string;
  name: string;
  kind: "vehicle" | "equipment";
  identifier: string | null; // regnr (fordon) / inventarienr (utrustning)
  costCenter: string | null;
  status: string | null;
  // resource_vehicles/resource_equipment-radens id — behövs för att koppla loss från
  // en person. null för team-aggregat och oanslutna fordon/utrustning.
  linkId: string | null;
}

export interface ExecutorRegisterPerson {
  id: string;
  name: string;
  teamRole: string | null; // roll i teamet (medlem/ledare/vikarie) — null om fristående
  status: string | null;
  costCenter: string | null;
  projectCode: string | null;
  // team_members-radens id för medlemskapet i detta team — behövs för att ta bort
  // personen ur teamet. null om personen är fristående (utan team).
  membershipId: string | null;
  vehicles: ExecutorRegisterAsset[];
  equipment: ExecutorRegisterAsset[];
}

export interface ExecutorRegisterTeam {
  id: string;
  name: string;
  color: string | null;
  status: string | null;
  costCenter: string | null;
  projectCode: string | null;
  members: ExecutorRegisterPerson[];
  // Aggregerat: fordon/utrustning som teamets medlemmar har kopplade till sig.
  vehicles: ExecutorRegisterAsset[];
  equipment: ExecutorRegisterAsset[];
}

export interface ExecutorRegister {
  teams: ExecutorRegisterTeam[];
  standalonePersons: ExecutorRegisterPerson[]; // personer utan team
  unassignedVehicles: ExecutorRegisterAsset[]; // fordon ej kopplade till någon resurs
  unassignedEquipment: ExecutorRegisterAsset[]; // utrustning ej kopplad till någon resurs
}
