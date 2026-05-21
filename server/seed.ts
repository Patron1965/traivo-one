import { db } from "./db";
import { tenants, customers, objects, resources, workOrders, brandingTemplates, tenantBranding, userTenantRoles, users, metadataKatalog, clusters, teams, tenantFeatures, featureAuditLog } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";
import { getModulesForPackage } from "@shared/modules";

const DEFAULT_TENANT_ID = "kinab";

/**
 * Demo-seeden (demo-kunder, demo-objekt, demo-resurser, demo-work-orders)
 * är AV i produktion by default. Sätt ENABLE_DEMO_SEED=true för att slå på.
 *
 * Systemmetadata (`seedSystemMetadataLabels`) och tenant-migrationen
 * (`migrateDefaultTenantToKinab`) körs alltid — de är prod-säkra och
 * behövs för att appen ska fungera.
 */
const DEMO_SEED_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_DEMO_SEED === "true";

function getCurrentWeekDates() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  const days: Date[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

export async function seedDatabase() {
  console.log(
    `Starting database seed... (demo-seed: ${DEMO_SEED_ENABLED ? "ON" : "OFF"}, NODE_ENV=${process.env.NODE_ENV ?? "unset"})`,
  );

  // Rename legacy "default-tenant" → "kinab" if applicable (production migration).
  await migrateDefaultTenantToKinab();

  // Säkerställ pilot-paket för Kinab (Task #526). Kör endast om kinab är på
  // en system-default-tier (basic/standard) — admins som manuellt valt
  // custom/premium/pilot ska inte revertas.
  await backfillSystemTierModules();
  await ensureKinabPilotFeatures();

  // Skip seed entirely if any tenant already exists (production / customer setup).
  // Demo seed only runs against a completely empty tenants table.
  const defaultRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(sql`id = ${DEFAULT_TENANT_ID}`)
    .limit(1);
  if (defaultRows.length > 0) {
    if (DEMO_SEED_ENABLED) {
      console.log("Default tenant present, refreshing demo dates...");
      await refreshDemoWorkOrderDates();
    } else {
      console.log(
        "Default tenant present, demo-seed disabled (production). Skipping demo refresh.",
      );
    }
    // Systemmetadata är prod-säker och behövs alltid.
    await seedSystemMetadataLabels();
    return;
  }
  const anyTenant = await db.select({ id: tenants.id }).from(tenants).limit(1);
  if (anyTenant.length > 0) {
    console.log("Tenant(s) already exist, skipping demo seed.");
    // Systemmetadata är knuten till DEFAULT_TENANT_ID; kör endast om kinab finns.
    // (Om kinab saknas men annan tenant finns: hoppa — metadata är opt-in per tenant.)
    return;
  }

  if (!DEMO_SEED_ENABLED) {
    console.log(
      "Demo-seed disabled in production and no tenant exists. Skipping full demo bootstrap — create the tenant manually.",
    );
    return;
  }

  const [tenant] = await db.insert(tenants).values({
    id: DEFAULT_TENANT_ID,
    name: "Kinab",
    orgNumber: "556789-1234",
    contactEmail: "info@traivo.se",
    contactPhone: "+46701234567",
    settings: {},
  }).returning();

  console.log("Created tenant:", tenant.name);

  const [telgebostader] = await db.insert(customers).values({
    tenantId: DEFAULT_TENANT_ID,
    name: "Telgebostäder",
    customerNumber: "KUND-001",
    contactPerson: "Anna Johansson",
    email: "avtal@telgebostader.se",
    phone: "+46855512300",
    address: "Nygatan 19",
    city: "Södertälje",
    postalCode: "15189",
  }).returning();

  const [serviceboenden] = await db.insert(customers).values({
    tenantId: DEFAULT_TENANT_ID,
    name: "Södertälje Kommun - Serviceboenden",
    customerNumber: "KUND-002",
    contactPerson: "Erik Lindström",
    email: "serviceboenden@sodertalje.se",
    phone: "+46855512400",
    address: "Campusgatan 26",
    city: "Södertälje",
    postalCode: "15152",
  }).returning();

  console.log("Created customers:", telgebostader.name, serviceboenden.name);

  const [omradeSyd] = await db.insert(objects).values({
    tenantId: DEFAULT_TENANT_ID,
    customerId: telgebostader.id,
    name: "Område syd",
    objectNumber: "OMR-SYD",
    objectType: "omrade",
    objectLevel: 1,
    city: "Södertälje",
    accessType: "open",
    status: "active",
  }).returning();

  const [omradeNord] = await db.insert(objects).values({
    tenantId: DEFAULT_TENANT_ID,
    customerId: telgebostader.id,
    name: "Område nord",
    objectNumber: "OMR-NORD",
    objectType: "omrade",
    objectLevel: 1,
    city: "Södertälje",
    accessType: "open",
    status: "active",
  }).returning();

  const [stensatravagen2] = await db.insert(objects).values({
    tenantId: DEFAULT_TENANT_ID,
    customerId: telgebostader.id,
    parentId: omradeSyd.id,
    name: "Stensätravägen 2",
    objectNumber: "FAST-001",
    objectType: "fastighet",
    objectLevel: 2,
    address: "Stensätravägen 2",
    city: "Södertälje",
    postalCode: "15138",
    latitude: 59.1955,
    longitude: 17.6253,
    accessType: "code",
    accessCode: "1234",
    avgSetupTime: 8,
    status: "active",
  }).returning();

  const [stensatravagen4] = await db.insert(objects).values({
    tenantId: DEFAULT_TENANT_ID,
    customerId: telgebostader.id,
    parentId: omradeSyd.id,
    name: "Stensätravägen 4",
    objectNumber: "FAST-002",
    objectType: "fastighet",
    objectLevel: 2,
    address: "Stensätravägen 4",
    city: "Södertälje",
    postalCode: "15138",
    latitude: 59.1957,
    longitude: 17.6255,
    accessType: "code",
    accessCode: "5678",
    avgSetupTime: 10,
    status: "active",
  }).returning();

  const [kungsgatan3] = await db.insert(objects).values({
    tenantId: DEFAULT_TENANT_ID,
    customerId: telgebostader.id,
    parentId: omradeNord.id,
    name: "Kungsgatan 3",
    objectNumber: "FAST-003",
    objectType: "fastighet",
    objectLevel: 2,
    address: "Kungsgatan 3",
    city: "Södertälje",
    postalCode: "15171",
    latitude: 59.1962,
    longitude: 17.6280,
    accessType: "key",
    keyNumber: "K-2045",
    avgSetupTime: 15,
    status: "active",
  }).returning();

  const [brinken4] = await db.insert(objects).values({
    tenantId: DEFAULT_TENANT_ID,
    customerId: telgebostader.id,
    parentId: omradeNord.id,
    name: "Brinken 4",
    objectNumber: "FAST-004",
    objectType: "fastighet",
    objectLevel: 2,
    address: "Brinken 4",
    city: "Södertälje",
    postalCode: "15172",
    latitude: 59.1970,
    longitude: 17.6290,
    accessType: "code",
    accessCode: "9012",
    avgSetupTime: 12,
    status: "active",
  }).returning();

  await db.insert(objects).values([
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      parentId: stensatravagen2.id,
      name: "Rum 1",
      objectNumber: "RUM-001",
      objectType: "rum",
      objectLevel: 3,
      containerCount: 4,
      containerCountK2: 1,
      status: "active",
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      parentId: stensatravagen2.id,
      name: "Rum 2",
      objectNumber: "RUM-002",
      objectType: "rum",
      objectLevel: 3,
      containerCount: 4,
      containerCountK2: 1,
      status: "active",
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      parentId: stensatravagen2.id,
      name: "Rum 3",
      objectNumber: "RUM-003",
      objectType: "rum",
      objectLevel: 3,
      containerCount: 3,
      status: "active",
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      parentId: stensatravagen2.id,
      name: "UJ Hushållsavfall",
      objectNumber: "UJ-001",
      objectType: "uj_hushallsavfall",
      objectLevel: 3,
      containerCount: 2,
      containerCountK3: 1,
      status: "active",
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      parentId: stensatravagen4.id,
      name: "Rum 1",
      objectNumber: "RUM-004",
      objectType: "rum",
      objectLevel: 3,
      containerCount: 4,
      containerCountK2: 2,
      status: "active",
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      parentId: stensatravagen4.id,
      name: "UJ Hushållsavfall",
      objectNumber: "UJ-002",
      objectType: "uj_hushallsavfall",
      objectLevel: 3,
      containerCount: 2,
      containerCountK3: 2,
      status: "active",
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      parentId: kungsgatan3.id,
      name: "Rum",
      objectNumber: "RUM-005",
      objectType: "rum",
      objectLevel: 3,
      containerCount: 6,
      containerCountK2: 2,
      status: "active",
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      parentId: brinken4.id,
      name: "Matafall, Skåp",
      objectNumber: "MAT-001",
      objectType: "matafall",
      objectLevel: 3,
      containerCountK3: 4,
      status: "active",
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      parentId: brinken4.id,
      name: "Återvinning, Rum",
      objectNumber: "AV-001",
      objectType: "atervinning",
      objectLevel: 3,
      containerCount: 8,
      containerCountK4: 4,
      status: "active",
    },
  ]);

  const [aldregardenSolstralen] = await db.insert(objects).values({
    tenantId: DEFAULT_TENANT_ID,
    customerId: serviceboenden.id,
    name: "Äldregården Solstrålen",
    objectNumber: "SERV-001",
    objectType: "serviceboende",
    objectLevel: 1,
    address: "Solvägen 15",
    city: "Södertälje",
    postalCode: "15145",
    latitude: 59.1980,
    longitude: 17.6310,
    accessType: "meeting",
    accessInfo: { contactPerson: "Maria Svensson", phone: "+46855512450" },
    avgSetupTime: 5,
    status: "active",
  }).returning();

  const [servicehusetGoken] = await db.insert(objects).values({
    tenantId: DEFAULT_TENANT_ID,
    customerId: serviceboenden.id,
    name: "Servicehuset Göken",
    objectNumber: "SERV-002",
    objectType: "serviceboende",
    objectLevel: 1,
    address: "Göksvägen 8",
    city: "Södertälje",
    postalCode: "15146",
    latitude: 59.1990,
    longitude: 17.6320,
    accessType: "key",
    keyNumber: "K-3012",
    avgSetupTime: 8,
    status: "active",
  }).returning();

  await db.insert(objects).values([
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: serviceboenden.id,
      parentId: aldregardenSolstralen.id,
      name: "Köket",
      objectNumber: "KOK-001",
      objectType: "kok",
      objectLevel: 2,
      containerCount: 2,
      containerCountK3: 1,
      status: "active",
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: serviceboenden.id,
      parentId: aldregardenSolstralen.id,
      name: "Soprum 1",
      objectNumber: "SOP-001",
      objectType: "soprum",
      objectLevel: 2,
      containerCount: 6,
      status: "active",
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: serviceboenden.id,
      parentId: aldregardenSolstralen.id,
      name: "Soprum 2",
      objectNumber: "SOP-002",
      objectType: "soprum",
      objectLevel: 2,
      containerCount: 4,
      status: "active",
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: serviceboenden.id,
      parentId: servicehusetGoken.id,
      name: "Köket",
      objectNumber: "KOK-002",
      objectType: "kok",
      objectLevel: 2,
      containerCount: 3,
      containerCountK3: 2,
      status: "active",
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: serviceboenden.id,
      parentId: servicehusetGoken.id,
      name: "Soprum 1",
      objectNumber: "SOP-003",
      objectType: "soprum",
      objectLevel: 2,
      containerCount: 8,
      status: "active",
    },
  ]);

  console.log("Created objects hierarchy");

  const [resource1] = await db.insert(resources).values({
    tenantId: DEFAULT_TENANT_ID,
    name: "Johan Eriksson",
    initials: "JE",
    resourceType: "person",
    phone: "+46701234569",
    email: "johan@traivo.se",
    homeLocation: "Södertälje",
    weeklyHours: 40,
    competencies: ["hamtning", "uj_service", "matavfall"],
    serviceArea: ["15138", "15145", "15189"],
    status: "active",
    homeLatitude: 59.1940,
    homeLongitude: 17.6230,
  }).returning();

  const [resource2] = await db.insert(resources).values({
    tenantId: DEFAULT_TENANT_ID,
    name: "Lisa Andersson",
    initials: "LA",
    resourceType: "person",
    phone: "+46701234570",
    email: "lisa@traivo.se",
    homeLocation: "Södertälje",
    weeklyHours: 40,
    competencies: ["hamtning", "atervinning", "serviceboende"],
    serviceArea: ["15171", "15172", "15146"],
    status: "active",
    homeLatitude: 59.1965,
    homeLongitude: 17.6275,
  }).returning();

  const [resource3] = await db.insert(resources).values({
    tenantId: DEFAULT_TENANT_ID,
    name: "Marcus Pettersson",
    initials: "MP",
    resourceType: "person",
    phone: "+46701234571",
    email: "marcus@traivo.se",
    homeLocation: "Nykvarn",
    weeklyHours: 40,
    competencies: ["hamtning", "uj_service"],
    serviceArea: ["15145", "15146", "15152"],
    status: "active",
    homeLatitude: 59.1820,
    homeLongitude: 17.6150,
  }).returning();

  const [tomasResource] = await db.insert(resources).values({
    id: "res-tomas",
    tenantId: DEFAULT_TENANT_ID,
    name: "Tomas Björnberg",
    initials: "TB",
    resourceType: "person",
    phone: "070-123 45 67",
    email: "tomas@nordicrouting.se",
    homeLocation: "Södertälje",
    weeklyHours: 40,
    competencies: ["tvatt", "besiktning", "hamtning", "kontroll", "service", "etablering"],
    serviceArea: ["15138", "15171", "15172", "15189"],
    status: "active",
    homeLatitude: 59.1955,
    homeLongitude: 17.6253,
  }).returning();

  await db.insert(resources).values({
    id: "res-anna",
    tenantId: DEFAULT_TENANT_ID,
    name: "Anna Lindqvist",
    initials: "AL",
    resourceType: "person",
    phone: "073-456 78 90",
    email: "anna@kinab.se",
    homeLocation: "Huddinge",
    weeklyHours: 40,
    competencies: ["tvatt", "besiktning", "hamtning"],
    serviceArea: ["15138", "15145", "15152"],
    status: "active",
    homeLatitude: 59.2369,
    homeLongitude: 17.9812,
  });

  console.log("Created resources:", resource1.name, resource2.name, resource3.name, tomasResource.name);

  const tomasUser = await db.select().from(users).where(sql`email = 'tomas@nordicrouting.se'`);
  if (tomasUser.length > 0) {
    await db.update(users).set({ resourceId: "res-tomas" }).where(sql`id = ${tomasUser[0].id}`);
    console.log("Linked user Tomas to resource res-tomas");
  }

  await db.insert(clusters).values([
    {
      id: "cluster-telge-syd",
      tenantId: DEFAULT_TENANT_ID,
      rootCustomerId: telgebostader.id,
      name: "Telgebostäder Syd",
      description: "Södra Södertälje — Stensätra, Hovsjö",
      color: "#3B82F6",
      centerLatitude: 59.1956,
      centerLongitude: 17.6254,
      radiusKm: 3,
      postalCodes: ["15138", "15189"],
      cachedObjectCount: 4,
      status: "active",
    },
    {
      id: "cluster-telge-nord",
      tenantId: DEFAULT_TENANT_ID,
      rootCustomerId: telgebostader.id,
      name: "Telgebostäder Nord",
      description: "Norra Södertälje — Centrum, Brinken",
      color: "#EF4444",
      centerLatitude: 59.1966,
      centerLongitude: 17.6285,
      radiusKm: 2,
      postalCodes: ["15171", "15172"],
      cachedObjectCount: 2,
      status: "active",
    },
    {
      id: "cluster-kommun",
      tenantId: DEFAULT_TENANT_ID,
      rootCustomerId: serviceboenden.id,
      name: "Kommun Serviceboenden",
      description: "Kommunala serviceboenden i Södertälje",
      color: "#22C55E",
      centerLatitude: 59.1985,
      centerLongitude: 17.6315,
      radiusKm: 2,
      postalCodes: ["15145", "15146", "15152"],
      cachedObjectCount: 2,
      status: "active",
    },
  ]).onConflictDoNothing();

  console.log("Created clusters");

  await db.update(objects).set({ clusterId: "cluster-telge-syd" }).where(sql`id = ${stensatravagen2.id}`);
  await db.update(objects).set({ clusterId: "cluster-telge-syd" }).where(sql`id = ${stensatravagen4.id}`);
  await db.update(objects).set({ clusterId: "cluster-telge-nord" }).where(sql`id = ${kungsgatan3.id}`);
  await db.update(objects).set({ clusterId: "cluster-telge-nord" }).where(sql`id = ${brinken4.id}`);
  await db.update(objects).set({ clusterId: "cluster-kommun" }).where(sql`id = ${aldregardenSolstralen.id}`);
  await db.update(objects).set({ clusterId: "cluster-kommun" }).where(sql`id = ${servicehusetGoken.id}`);

  const [mon, tue, wed, thu, fri] = getCurrentWeekDates();

  await db.insert(workOrders).values([
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: stensatravagen2.id, clusterId: "cluster-telge-syd", resourceId: resource1.id, title: "Hämtning hushållsavfall", description: "Tömning av kärl i samtliga soprum", orderType: "hamtning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: mon, scheduledStartTime: "07:00", estimatedDuration: 30 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: stensatravagen4.id, clusterId: "cluster-telge-syd", resourceId: resource1.id, title: "Hämtning hushållsavfall", description: "Tömning av kärl", orderType: "hamtning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: mon, scheduledStartTime: "07:45", estimatedDuration: 25 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: kungsgatan3.id, clusterId: "cluster-telge-nord", resourceId: resource2.id, title: "Hämtning + UJ service", description: "Tömning och rengöring av UJ-behållare", orderType: "uj_service", priority: "high", orderStatus: "planerad_resurs", scheduledDate: mon, scheduledStartTime: "08:00", estimatedDuration: 45 },
    { tenantId: DEFAULT_TENANT_ID, customerId: serviceboenden.id, objectId: aldregardenSolstralen.id, clusterId: "cluster-kommun", resourceId: resource3.id, title: "Serviceboende — Alla kärl", description: "Tömning av kök och soprum", orderType: "hamtning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: mon, scheduledStartTime: "09:00", estimatedDuration: 35 },
    { tenantId: DEFAULT_TENANT_ID, customerId: serviceboenden.id, objectId: servicehusetGoken.id, clusterId: "cluster-kommun", resourceId: resource3.id, title: "Serviceboende — Alla kärl", description: "Tömning av kök och soprum", orderType: "hamtning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: mon, scheduledStartTime: "10:00", estimatedDuration: 40 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: stensatravagen2.id, clusterId: "cluster-telge-syd", resourceId: tomasResource.id, title: "Tvätt soprum A", description: "Storstädning och tvätt av soprum inkl. väggar och golv", orderType: "tvatt", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: mon, scheduledStartTime: "07:30", estimatedDuration: 45 },

    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: brinken4.id, clusterId: "cluster-telge-nord", resourceId: resource2.id, title: "Matavfall + Återvinning", description: "Hämtning av matavfall och återvinning", orderType: "hamtning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: tue, scheduledStartTime: "07:00", estimatedDuration: 40 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: kungsgatan3.id, clusterId: "cluster-telge-nord", resourceId: resource1.id, title: "UJ Service Kungsgatan", description: "Rengöring och kontroll av UJ-behållare", orderType: "uj_service", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: tue, scheduledStartTime: "08:30", estimatedDuration: 50 },
    { tenantId: DEFAULT_TENANT_ID, customerId: serviceboenden.id, objectId: aldregardenSolstralen.id, clusterId: "cluster-kommun", resourceId: resource3.id, title: "Kontroll brandskydd", description: "Kontroll av brandskyltning och utrymningsvägar", orderType: "kontroll", priority: "high", orderStatus: "planerad_resurs", scheduledDate: tue, scheduledStartTime: "09:00", estimatedDuration: 60 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: stensatravagen4.id, clusterId: "cluster-telge-syd", resourceId: tomasResource.id, title: "Besiktning fastighet", description: "Årlig besiktning av avfallsutrymmen", orderType: "besiktning", priority: "high", orderStatus: "planerad_resurs", scheduledDate: tue, scheduledStartTime: "08:00", estimatedDuration: 60 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: stensatravagen2.id, clusterId: "cluster-telge-syd", resourceId: "res-anna", title: "Tvätt kärl 240L", description: "Högtryckstvätt av brunt kärl", orderType: "tvatt", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: tue, scheduledStartTime: "08:00", estimatedDuration: 30 },

    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: stensatravagen2.id, clusterId: "cluster-telge-syd", resourceId: resource1.id, title: "Hämtning hushållsavfall", description: "Veckovis hämtning", orderType: "hamtning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: wed, scheduledStartTime: "07:00", estimatedDuration: 30 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: brinken4.id, clusterId: "cluster-telge-nord", resourceId: resource2.id, title: "Kontroll soprum", description: "Kontroll av brandsäkerhet och skyltning", orderType: "kontroll", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: wed, scheduledStartTime: "08:00", estimatedDuration: 40 },
    { tenantId: DEFAULT_TENANT_ID, customerId: serviceboenden.id, objectId: servicehusetGoken.id, clusterId: "cluster-kommun", resourceId: resource3.id, title: "Service ventilation", description: "Ventilationsservice och filterbyte", orderType: "service", priority: "high", orderStatus: "planerad_resurs", scheduledDate: wed, scheduledStartTime: "09:00", estimatedDuration: 90 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: kungsgatan3.id, clusterId: "cluster-telge-nord", resourceId: tomasResource.id, title: "Tvätt container", description: "Invändig tvätt av container", orderType: "tvatt", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: wed, scheduledStartTime: "10:00", estimatedDuration: 35 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: stensatravagen4.id, clusterId: "cluster-telge-syd", resourceId: "res-anna", title: "Besiktning soprum", description: "Statusbesiktning av avfallsutrymme", orderType: "besiktning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: wed, scheduledStartTime: "09:00", estimatedDuration: 45 },

    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: stensatravagen4.id, clusterId: "cluster-telge-syd", resourceId: resource1.id, title: "Hämtning matavfall", description: "Specialhämtning matavfall", orderType: "hamtning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: thu, scheduledStartTime: "07:00", estimatedDuration: 25 },
    { tenantId: DEFAULT_TENANT_ID, customerId: serviceboenden.id, objectId: aldregardenSolstralen.id, clusterId: "cluster-kommun", resourceId: resource3.id, title: "Hämtning serviceende", description: "Tömning alla kärl på serviceboendet", orderType: "hamtning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: thu, scheduledStartTime: "08:00", estimatedDuration: 45 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: brinken4.id, clusterId: "cluster-telge-nord", resourceId: resource2.id, title: "Återvinning sortering", description: "Extra tömning och sorteringskontroll", orderType: "atervinning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: thu, scheduledStartTime: "09:00", estimatedDuration: 35 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: kungsgatan3.id, clusterId: "cluster-telge-nord", resourceId: tomasResource.id, title: "Etablering ny container", description: "Installation av ny 660L container", orderType: "etablering", priority: "high", orderStatus: "planerad_resurs", scheduledDate: thu, scheduledStartTime: "08:00", estimatedDuration: 75 },

    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: stensatravagen2.id, clusterId: "cluster-telge-syd", resourceId: resource1.id, title: "Hämtning hushållsavfall", description: "Fredags-hämtning", orderType: "hamtning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: fri, scheduledStartTime: "07:00", estimatedDuration: 30 },
    { tenantId: DEFAULT_TENANT_ID, customerId: serviceboenden.id, objectId: servicehusetGoken.id, clusterId: "cluster-kommun", resourceId: resource3.id, title: "Fredagskontroll", description: "Veckokontroll av soprum", orderType: "kontroll", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: fri, scheduledStartTime: "08:00", estimatedDuration: 30 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: brinken4.id, clusterId: "cluster-telge-nord", resourceId: "res-anna", title: "Tvätt soprum", description: "Högtryckstvätt soprum", orderType: "tvatt", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: fri, scheduledStartTime: "09:00", estimatedDuration: 40 },
  ]);

  await db.insert(workOrders).values([
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: stensatravagen2.id, clusterId: "cluster-telge-syd", title: "Extra tömning matavfall", description: "Fullständig tömning efter helg", orderType: "hamtning", priority: "urgent", orderStatus: "skapad", estimatedDuration: 35 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: kungsgatan3.id, clusterId: "cluster-telge-nord", title: "Reparation containerlock", description: "Locket på 660L-containern är trasigt", orderType: "service", priority: "high", orderStatus: "skapad", estimatedDuration: 45 },
    { tenantId: DEFAULT_TENANT_ID, customerId: serviceboenden.id, objectId: aldregardenSolstralen.id, clusterId: "cluster-kommun", title: "Storstädning kök", description: "Storstädning av köket efter renovering", orderType: "tvatt", priority: "normal", orderStatus: "skapad", estimatedDuration: 90 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: brinken4.id, clusterId: "cluster-telge-nord", title: "UJ rengöring", description: "Djuprengöring av underjordisk behållare", orderType: "uj_service", priority: "high", orderStatus: "skapad", estimatedDuration: 60 },
    { tenantId: DEFAULT_TENANT_ID, customerId: serviceboenden.id, objectId: servicehusetGoken.id, clusterId: "cluster-kommun", title: "Byte ventilfilter", description: "Filterbyte i soprummets ventilation", orderType: "service", priority: "normal", orderStatus: "skapad", estimatedDuration: 40 },
    { tenantId: DEFAULT_TENANT_ID, customerId: telgebostader.id, objectId: stensatravagen4.id, clusterId: "cluster-telge-syd", title: "Avloppsrensning", description: "Avloppsrensning i soprum efter vattenläcka", orderType: "service", priority: "urgent", orderStatus: "skapad", estimatedDuration: 50 },
  ]);

  console.log("Created 23 scheduled + 6 unscheduled work orders across Mon-Fri");

  const demoCust1 = await db.select().from(customers).where(sql`id = 'cust-telge'`);
  if (demoCust1.length === 0) {
    await seedFieldAppDemoData(tomasResource.id);
  }

  const existingTemplates = await db.select().from(brandingTemplates).limit(1);
  if (existingTemplates.length === 0) {
    await db.insert(brandingTemplates).values([
      {
        name: "HVAC-Tjänster",
        slug: "hvac",
        industry: "HVAC",
        description: "Värme, ventilation, AC-installation och underhåll",
        primaryColor: "#FF6B35",
        primaryLight: "#FF8F66",
        primaryDark: "#CC5529",
        secondaryColor: "#1E3A5F",
        accentColor: "#4ECDC4",
        successColor: "#22C55E",
        errorColor: "#EF4444",
        defaultHeading: "Klimatkontroll för alla miljöer",
        defaultSubheading: "Professionell HVAC-service",
        isSystem: true,
      },
      {
        name: "Eltjänster",
        slug: "electrical",
        industry: "Electrical",
        description: "Kommersiella och bostadselektriker",
        primaryColor: "#FFD700",
        primaryLight: "#FFEB80",
        primaryDark: "#CCA800",
        secondaryColor: "#2D3748",
        accentColor: "#E53E3E",
        successColor: "#22C55E",
        errorColor: "#EF4444",
        defaultHeading: "Säker och pålitlig el",
        defaultSubheading: "Certifierade elektriker",
        isSystem: true,
      },
      {
        name: "VVS-Tjänster",
        slug: "plumbing",
        industry: "Plumbing",
        description: "Akut- och schemalagd VVS",
        primaryColor: "#3182CE",
        primaryLight: "#63B3ED",
        primaryDark: "#2C5282",
        secondaryColor: "#1A365D",
        accentColor: "#48BB78",
        successColor: "#22C55E",
        errorColor: "#EF4444",
        defaultHeading: "VVS-lösningar som fungerar",
        defaultSubheading: "Jour dygnet runt",
        isSystem: true,
      },
      {
        name: "Byggverksamhet",
        slug: "construction",
        industry: "Construction",
        description: "Entreprenörer, renoveringar, specialhantverk",
        primaryColor: "#D69E2E",
        primaryLight: "#ECC94B",
        primaryDark: "#B7791F",
        secondaryColor: "#4A5568",
        accentColor: "#ED8936",
        successColor: "#22C55E",
        errorColor: "#EF4444",
        defaultHeading: "Bygg med kvalitet",
        defaultSubheading: "Erfarna hantverkare",
        isSystem: true,
      },
      {
        name: "Fastighetsförvaltning",
        slug: "property",
        industry: "Property Management",
        description: "Byggnadsunderhållstjänster",
        primaryColor: "#38A169",
        primaryLight: "#68D391",
        primaryDark: "#276749",
        secondaryColor: "#234E52",
        accentColor: "#81E6D9",
        successColor: "#22C55E",
        errorColor: "#EF4444",
        defaultHeading: "Professionell fastighetsförvaltning",
        defaultSubheading: "Vi tar hand om din fastighet",
        isSystem: true,
      },
      {
        name: "Städtjänster",
        slug: "cleaning",
        industry: "Cleaning",
        description: "Kommersiell och bostadsstädning",
        primaryColor: "#00CED1",
        primaryLight: "#5FD9DB",
        primaryDark: "#008B8D",
        secondaryColor: "#2D3748",
        accentColor: "#9F7AEA",
        successColor: "#22C55E",
        errorColor: "#EF4444",
        defaultHeading: "Rent och fräscht",
        defaultSubheading: "Professionell städservice",
        isSystem: true,
      },
      {
        name: "IT-Tjänster",
        slug: "it-services",
        industry: "IT Services",
        description: "Teknisk support på plats",
        primaryColor: "#805AD5",
        primaryLight: "#B794F4",
        primaryDark: "#553C9A",
        secondaryColor: "#1A202C",
        accentColor: "#38B2AC",
        successColor: "#22C55E",
        errorColor: "#EF4444",
        defaultHeading: "IT-support när du behöver det",
        defaultSubheading: "Experthjälp på plats",
        isSystem: true,
      },
      {
        name: "Grön Teknologi",
        slug: "green-tech",
        industry: "Green Technology",
        description: "Solpanel, EV-laddning, värmepumpar",
        primaryColor: "#48BB78",
        primaryLight: "#9AE6B4",
        primaryDark: "#276749",
        secondaryColor: "#1A365D",
        accentColor: "#F6E05E",
        successColor: "#22C55E",
        errorColor: "#EF4444",
        defaultHeading: "Hållbar energi för framtiden",
        defaultSubheading: "Miljövänliga lösningar",
        isSystem: true,
      },
    ]);
    console.log("Created 8 industry branding templates");
  }

  const existingBranding = await db.select().from(tenantBranding).where(sql`tenant_id = ${DEFAULT_TENANT_ID}`);
  if (existingBranding.length === 0) {
    await db.insert(tenantBranding).values({
      tenantId: DEFAULT_TENANT_ID,
      primaryColor: "#3B82F6",
      secondaryColor: "#6366F1",
      accentColor: "#F59E0B",
      companyName: "Kinab",
      headingText: "Kinab Field Service",
      subheadingText: "Planering som funkar",
      isPublished: true,
    });
    console.log("Created default tenant branding");
  }

  const tomasResCheck = await db.select().from(resources).where(sql`email = 'tomas@nordicrouting.se'`);
  if (tomasResCheck.length > 0) {
    const existingUser = await db.select().from(users).where(sql`email = 'tomas@nordicrouting.se'`);
    let userId: string;
    
    if (existingUser.length === 0) {
      const [newUser] = await db.insert(users).values({
        email: "tomas@nordicrouting.se",
        firstName: "Tomas",
        lastName: "Björneberg",
      }).returning();
      userId = newUser.id;
      console.log("Created user for Tomas Björneberg");
    } else {
      userId = existingUser[0].id;
    }
    
    const existingRole = await db.select().from(userTenantRoles).where(sql`user_id = ${userId} AND tenant_id = ${DEFAULT_TENANT_ID}`);
    if (existingRole.length === 0) {
      await db.insert(userTenantRoles).values({
        userId: userId,
        tenantId: DEFAULT_TENANT_ID,
        role: "owner",
        isActive: true,
      });
      console.log("Created owner role for Tomas Björneberg");
    }
  }

  await seedSystemMetadataLabels();
  console.log("Database seeding complete!");
}

async function refreshDemoWorkOrderDates() {
  const existingResource = await db.select().from(resources).where(sql`id = 'res-tomas'`);
  if (existingResource.length === 0) {
    await db.insert(resources).values({
      id: "res-tomas",
      tenantId: DEFAULT_TENANT_ID,
      name: "Tomas Björnberg",
      initials: "TB",
      resourceType: "person",
      phone: "070-123 45 67",
      email: "tomas@nordicrouting.se",
      homeLocation: "Södertälje",
      weeklyHours: 40,
      competencies: ["tvatt", "besiktning", "hamtning", "kontroll", "service", "etablering"],
      serviceArea: ["15138", "15171", "15172", "15189"],
      status: "active",
      homeLatitude: 59.1955,
      homeLongitude: 17.6253,
    });
    console.log("Created resource res-tomas");
  }

  const annaRes = await db.select().from(resources).where(sql`id = 'res-anna'`);
  if (annaRes.length === 0) {
    await db.insert(resources).values({
      id: "res-anna",
      tenantId: DEFAULT_TENANT_ID,
      name: "Anna Lindqvist",
      initials: "AL",
      resourceType: "person",
      phone: "073-456 78 90",
      email: "anna@kinab.se",
      homeLocation: "Huddinge",
      weeklyHours: 40,
      competencies: ["tvatt", "besiktning", "hamtning"],
      serviceArea: ["15138", "15145", "15152"],
      status: "active",
      homeLatitude: 59.2369,
      homeLongitude: 17.9812,
      color: "#E74C3C",
    });
    console.log("Created resource res-anna");
  }

  const tomasUser = await db.select().from(users).where(sql`email = 'tomas@nordicrouting.se'`);
  if (tomasUser.length > 0 && !tomasUser[0].resourceId) {
    await db.update(users).set({ resourceId: "res-tomas" }).where(sql`id = ${tomasUser[0].id}`);
    console.log("Linked user Tomas to resource res-tomas");
  }

  const existingDemoCust = await db.select().from(customers).where(sql`id = 'cust-telge'`);
  if (existingDemoCust.length === 0) {
    await seedFieldAppDemoData("res-tomas");
  }

  await db.update(resources).set({
    currentLatitude: 59.1955, currentLongitude: 17.6253,
    trackingStatus: "active", lastPositionUpdate: new Date(),
  }).where(sql`id = 'res-tomas'`);

  await db.update(resources).set({
    currentLatitude: 59.1950, currentLongitude: 17.6400,
    trackingStatus: "active", lastPositionUpdate: new Date(),
  }).where(sql`id = 'res-anna'`);

  await db.update(objects).set({ latitude: 59.2045, longitude: 17.6150, address: "Järnagatan 4", city: "Södertälje", postalCode: "151 04", name: "Järnagatan 4 - Tvättstuga" }).where(sql`id = 'obj-7'`);
  await db.update(objects).set({ latitude: 59.1912, longitude: 17.6380, address: "Turingegatan 10", city: "Södertälje", postalCode: "151 72", name: "Turingegatan 10 - Källare" }).where(sql`id = 'obj-8'`);

  const existingClusters = await db.select({ id: clusters.id }).from(clusters).where(sql`id = 'cluster-telge-syd'`);
  if (existingClusters.length === 0) {
    const telgeCust = await db.select({ id: customers.id }).from(customers).where(sql`customer_number = 'KUND-001' AND tenant_id = ${DEFAULT_TENANT_ID}`).limit(1);
    const kommunCust = await db.select({ id: customers.id }).from(customers).where(sql`customer_number = 'KUND-002' AND tenant_id = ${DEFAULT_TENANT_ID}`).limit(1);
    if (telgeCust.length > 0 && kommunCust.length > 0) {
      await db.insert(clusters).values([
        { id: "cluster-telge-syd", tenantId: DEFAULT_TENANT_ID, rootCustomerId: telgeCust[0].id, name: "Telgebostäder Syd", color: "#3B82F6", centerLatitude: 59.1956, centerLongitude: 17.6254, radiusKm: 3, postalCodes: ["15138", "15189"], cachedObjectCount: 4, status: "active" },
        { id: "cluster-telge-nord", tenantId: DEFAULT_TENANT_ID, rootCustomerId: telgeCust[0].id, name: "Telgebostäder Nord", color: "#EF4444", centerLatitude: 59.1966, centerLongitude: 17.6285, radiusKm: 2, postalCodes: ["15171", "15172"], cachedObjectCount: 2, status: "active" },
        { id: "cluster-kommun", tenantId: DEFAULT_TENANT_ID, rootCustomerId: kommunCust[0].id, name: "Kommun Serviceboenden", color: "#22C55E", centerLatitude: 59.1985, centerLongitude: 17.6315, radiusKm: 2, postalCodes: ["15145", "15146", "15152"], cachedObjectCount: 2, status: "active" },
      ]).onConflictDoNothing();
      console.log("Created clusters in refresh");
    }
  }

  const [mon, tue, wed, thu, fri] = getCurrentWeekDates();

  const dayAssignments: Record<string, Date> = {
    "wo-1": mon, "wo-2": tue, "wo-3": wed, "wo-4": thu,
    "wo-5": mon, "wo-6": wed, "wo-7": thu, "wo-8": fri,
    "wo-anna-1": mon, "wo-anna-2": tue, "wo-anna-3": wed, "wo-anna-4": fri,
  };

  for (const [woId, date] of Object.entries(dayAssignments)) {
    await db.update(workOrders)
      .set({ scheduledDate: date })
      .where(sql`id = ${woId} AND (scheduled_date IS NULL OR scheduled_date != ${date})`);
  }

  const annaOrders = await db.select().from(workOrders).where(sql`id = 'wo-anna-1'`);
  if (annaOrders.length === 0) {
    await db.insert(workOrders).values([
      { id: "wo-anna-1", tenantId: DEFAULT_TENANT_ID, customerId: "cust-telge", objectId: "obj-1", resourceId: "res-anna", title: "Tvätt soprum B", description: "Tvätt av soprum B, Stensätravägen", orderType: "tvatt", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: mon, scheduledStartTime: "08:00", estimatedDuration: 40 },
      { id: "wo-anna-2", tenantId: DEFAULT_TENANT_ID, customerId: "cust-kommun", objectId: "obj-5", resourceId: "res-anna", title: "Kontroll skola", description: "Kontroll av avfallshantering", orderType: "kontroll", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: tue, scheduledStartTime: "09:00", estimatedDuration: 50 },
      { id: "wo-anna-3", tenantId: DEFAULT_TENANT_ID, customerId: "cust-kommun", objectId: "obj-6", resourceId: "res-anna", title: "Tvätt container park", description: "Högtryckstvätt av container", orderType: "tvatt", priority: "high", orderStatus: "planerad_resurs", scheduledDate: wed, scheduledStartTime: "10:30", estimatedDuration: 35 },
      { id: "wo-anna-4", tenantId: DEFAULT_TENANT_ID, customerId: "cust-brf", objectId: "obj-4", resourceId: "res-anna", title: "Service soprum", description: "Service och underhåll", orderType: "service", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: fri, scheduledStartTime: "12:00", estimatedDuration: 60 },
    ]).onConflictDoNothing();
    console.log("Created 4 demo work orders for Anna");
  }

  const scheduled = await db.select({ id: workOrders.id, date: workOrders.scheduledDate }).from(workOrders).where(sql`tenant_id = ${DEFAULT_TENANT_ID} AND scheduled_date IS NOT NULL`);
  const unscheduled = await db.select({ id: workOrders.id }).from(workOrders).where(sql`tenant_id = ${DEFAULT_TENANT_ID} AND scheduled_date IS NULL`);
  const dayCounts: Record<string, number> = {};
  for (const wo of scheduled) {
    if (wo.date) {
      const day = new Date(wo.date).toLocaleDateString("sv-SE", { weekday: "short" });
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    }
  }
  const dayStr = Object.entries(dayCounts).map(([d, c]) => `${d}:${c}`).join(", ");
  console.log(`Refreshed demo work order dates across current week (Mon-Fri) — ${scheduled.length} scheduled [${dayStr}], ${unscheduled.length} unscheduled`);
}

async function seedFieldAppDemoData(tomasResourceId: string) {
  const [mon, tue, wed, thu, fri] = getCurrentWeekDates();

  await db.insert(customers).values([
    { id: "cust-telge", tenantId: DEFAULT_TENANT_ID, name: "Telgebostäder AB", customerNumber: "K001", contactPerson: "Erik Svensson", email: "erik@telgebostader.se", phone: "08-550 123 00", address: "Storgatan 1", city: "Södertälje", postalCode: "151 72" },
    { id: "cust-brf", tenantId: DEFAULT_TENANT_ID, name: "BRF Strandhöjden", customerNumber: "K002", contactPerson: "Maria Johansson", email: "maria@strandhojden.se", phone: "08-523 456 00", address: "Strandvägen 15", city: "Södertälje", postalCode: "151 38" },
    { id: "cust-kommun", tenantId: DEFAULT_TENANT_ID, name: "Södertälje Kommun", customerNumber: "K003", contactPerson: "Anders Nilsson", email: "anders@sodertalje.se", phone: "08-550 200 00", address: "Campusgatan 26", city: "Södertälje", postalCode: "151 87" },
    { id: "cust-fastighet", tenantId: DEFAULT_TENANT_ID, name: "Förvaltaren Fastigheter", customerNumber: "K004", contactPerson: "Karin Ström", email: "karin@forvaltaren.se", phone: "08-588 100 00", address: "Centralgatan 8", city: "Sundbyberg", postalCode: "172 68" },
  ]);

  await db.insert(objects).values([
    { id: "obj-1", tenantId: DEFAULT_TENANT_ID, customerId: "cust-telge", name: "Stensätravägen 2 - Soprum A", objectNumber: "OBJ-001", objectType: "rum", objectLevel: 3, address: "Stensätravägen 2", city: "Södertälje", postalCode: "151 57", latitude: 59.1876, longitude: 17.6432, accessType: "code", accessCode: "1234", hierarchyLevel: "rum", avgSetupTime: 5 },
    { id: "obj-2", tenantId: DEFAULT_TENANT_ID, customerId: "cust-telge", name: "Oxbacksleden 12 - Fastighet", objectNumber: "OBJ-002", objectType: "fastighet", objectLevel: 2, address: "Oxbacksleden 12", city: "Södertälje", postalCode: "151 42", latitude: 59.1923, longitude: 17.6198, accessType: "key", hierarchyLevel: "fastighet", avgSetupTime: 10 },
    { id: "obj-3", tenantId: DEFAULT_TENANT_ID, customerId: "cust-brf", name: "Strandvägen 15 - Kärl 240L", objectNumber: "OBJ-003", objectType: "karl", objectLevel: 4, address: "Strandvägen 15", city: "Södertälje", postalCode: "151 38", latitude: 59.1978, longitude: 17.6345, accessType: "open", hierarchyLevel: "karl", avgSetupTime: 3 },
    { id: "obj-4", tenantId: DEFAULT_TENANT_ID, customerId: "cust-brf", name: "Strandvägen 17 - Soprum", objectNumber: "OBJ-004", objectType: "rum", objectLevel: 3, address: "Strandvägen 17", city: "Södertälje", postalCode: "151 38", latitude: 59.1981, longitude: 17.6351, accessType: "code", accessCode: "4567", hierarchyLevel: "rum", avgSetupTime: 8 },
    { id: "obj-5", tenantId: DEFAULT_TENANT_ID, customerId: "cust-kommun", name: "Torekällbergets Skola", objectNumber: "OBJ-005", objectType: "fastighet", objectLevel: 2, address: "Torekällgatan 40", city: "Södertälje", postalCode: "151 72", latitude: 59.2012, longitude: 17.6287, accessType: "key", hierarchyLevel: "fastighet", avgSetupTime: 15 },
    { id: "obj-6", tenantId: DEFAULT_TENANT_ID, customerId: "cust-kommun", name: "Brunnsängsparken - Container", objectNumber: "OBJ-006", objectType: "karl", objectLevel: 4, address: "Brunnsängsvägen 8", city: "Södertälje", postalCode: "151 45", latitude: 59.1834, longitude: 17.6512, accessType: "open", hierarchyLevel: "karl", avgSetupTime: 5 },
    { id: "obj-7", tenantId: DEFAULT_TENANT_ID, customerId: "cust-fastighet", name: "Järnagatan 4 - Tvättstuga", objectNumber: "OBJ-007", objectType: "rum", objectLevel: 3, address: "Järnagatan 4", city: "Södertälje", postalCode: "151 04", latitude: 59.2045, longitude: 17.6150, accessType: "code", accessCode: "8901", hierarchyLevel: "rum", avgSetupTime: 10 },
    { id: "obj-8", tenantId: DEFAULT_TENANT_ID, customerId: "cust-fastighet", name: "Turingegatan 10 - Källare", objectNumber: "OBJ-008", objectType: "rum", objectLevel: 3, address: "Turingegatan 10", city: "Södertälje", postalCode: "151 72", latitude: 59.1912, longitude: 17.6380, accessType: "key", hierarchyLevel: "rum", avgSetupTime: 12 },
  ]);

  await db.insert(workOrders).values([
    { id: "wo-1", tenantId: DEFAULT_TENANT_ID, customerId: "cust-telge", objectId: "obj-1", resourceId: tomasResourceId, title: "Tvätt soprum A", description: "Storstädning och tvätt av soprum inkl. väggar och golv", orderType: "tvatt", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: mon, scheduledStartTime: "07:30", estimatedDuration: 45 },
    { id: "wo-2", tenantId: DEFAULT_TENANT_ID, customerId: "cust-telge", objectId: "obj-2", resourceId: tomasResourceId, title: "Besiktning fastighet", description: "Årlig besiktning av avfallsutrymmen och behållare", orderType: "besiktning", priority: "high", orderStatus: "planerad_resurs", scheduledDate: tue, scheduledStartTime: "08:30", estimatedDuration: 60 },
    { id: "wo-3", tenantId: DEFAULT_TENANT_ID, customerId: "cust-brf", objectId: "obj-3", resourceId: tomasResourceId, title: "Tvätt kärl 240L", description: "Högtryckstvätt av brunt kärl vid Strandvägen 15", orderType: "tvatt", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: wed, scheduledStartTime: "09:45", estimatedDuration: 30 },
    { id: "wo-4", tenantId: DEFAULT_TENANT_ID, customerId: "cust-brf", objectId: "obj-4", resourceId: tomasResourceId, title: "Kontroll soprum", description: "Kontroll av brandsäkerhet och skyltning i soprum", orderType: "kontroll", priority: "normal", orderStatus: "paborjad", scheduledDate: thu, scheduledStartTime: "10:30", estimatedDuration: 40 },
    { id: "wo-5", tenantId: DEFAULT_TENANT_ID, customerId: "cust-kommun", objectId: "obj-5", resourceId: tomasResourceId, title: "Service ventilation skola", description: "Ventilationsservice och filterbyte i soprummet", orderType: "service", priority: "high", orderStatus: "planerad_resurs", scheduledDate: mon, scheduledStartTime: "11:30", estimatedDuration: 90 },
    { id: "wo-6", tenantId: DEFAULT_TENANT_ID, customerId: "cust-kommun", objectId: "obj-6", resourceId: tomasResourceId, title: "Tvätt container", description: "Invändig tvätt av 660L container vid Brunnsängsparken", orderType: "tvatt", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: wed, scheduledStartTime: "13:30", estimatedDuration: 35 },
    { id: "wo-7", tenantId: DEFAULT_TENANT_ID, customerId: "cust-fastighet", objectId: "obj-7", resourceId: tomasResourceId, title: "Etablering tvättstuga", description: "Ny etablering av avfallshantering i tvättstuga", orderType: "etablering", priority: "high", orderStatus: "planerad_resurs", scheduledDate: thu, scheduledStartTime: "14:30", estimatedDuration: 75 },
    { id: "wo-8", tenantId: DEFAULT_TENANT_ID, customerId: "cust-fastighet", objectId: "obj-8", resourceId: tomasResourceId, title: "Besiktning källare", description: "Statusbesiktning av avfallsutrymme i källare", orderType: "besiktning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: fri, scheduledStartTime: "16:00", estimatedDuration: 45 },
  ]);

  console.log("Created SimpleFieldApp demo data: 4 customers, 8 objects, 8 work orders across week");
}

async function seedSystemMetadataLabels() {
  const systemLabels = [
    { namn: "Kundkoppling", beteckning: "KUND", kategori: "administrativ", datatyp: "referens", isSystem: true, isRequired: false, standardArvs: true, beskrivning: "Vilken kund objektet tillhör", icon: "Users" },
    { namn: "Förälder", beteckning: "PARENT", kategori: "administrativ", datatyp: "referens", isSystem: true, isRequired: false, standardArvs: false, beskrivning: "Överordnat objekt i hierarkin", icon: "GitFork" },
    { namn: "Objekttyp", beteckning: "TYP", kategori: "administrativ", datatyp: "string", isSystem: true, isRequired: false, standardArvs: false, beskrivning: "Typ av objekt (t.ex. bök, RBK)", icon: "Package" },
    { namn: "Område", beteckning: "OMR", kategori: "geografi", datatyp: "string", isSystem: true, isRequired: false, standardArvs: true, beskrivning: "Geografiskt område", icon: "MapPin" },
    { namn: "Antal", beteckning: "ANT", kategori: "produktion", datatyp: "integer", isSystem: true, isRequired: false, standardArvs: false, beskrivning: "Antal enheter (kärl, containrar etc.)", icon: "Hash" },
    { namn: "Önskad leveransperiod", beteckning: "LEV", kategori: "leverans", datatyp: "string", isSystem: true, isRequired: false, standardArvs: true, beskrivning: "Önskad leveransperiod (t.ex. '0201-0430' eller 'Torsdag EM')", icon: "Calendar" },
    { namn: "Oönskad leveransperiod", beteckning: "LEV NEJ", kategori: "leverans", datatyp: "string", isSystem: true, isRequired: false, standardArvs: true, beskrivning: "Tider som inte passar (t.ex. 'Mån-Tisdag')", icon: "CalendarX" },
    { namn: "Leveransintervall", beteckning: "LEVPERIOD", kategori: "leverans", datatyp: "string", isSystem: true, isRequired: false, standardArvs: true, beskrivning: "Leveransintervall (t.ex. '2-3 månader')", icon: "Clock" },
    { namn: "Fastighetsbeteckning", beteckning: "FASBET", kategori: "kundreferens", datatyp: "string", isSystem: true, isRequired: false, standardArvs: true, beskrivning: "Fastighetsbeteckning (t.ex. 'STORA ORMEN 2')", icon: "Building" },
    { namn: "Fakturareferens", beteckning: "REF", kategori: "kundreferens", datatyp: "string", isSystem: true, isRequired: false, standardArvs: true, beskrivning: "Kundens fakturareferens", icon: "FileText" },
    { namn: "Fasadnummer", beteckning: "FASNR", kategori: "kundreferens", datatyp: "string", isSystem: true, isRequired: false, standardArvs: false, beskrivning: "Fasadnummer på byggnaden", icon: "Hash" },
    { namn: "Butiksnummer", beteckning: "NUTNR", kategori: "kundreferens", datatyp: "string", isSystem: true, isRequired: false, standardArvs: false, beskrivning: "Butiks- eller enhetsnummer", icon: "Store" },
    { namn: "Association", beteckning: "ASSOC", kategori: "artikel", datatyp: "string", isSystem: true, isRequired: false, standardArvs: false, beskrivning: "Koppling artikel → objekt (t.ex. 'Matavfallskärl 125 liter')", icon: "Link" },
    { namn: "Avdelning", beteckning: "AVD", kategori: "kundreferens", datatyp: "string", isSystem: true, isRequired: false, standardArvs: true, beskrivning: "Avdelning hos kund", icon: "Building2" },
    { namn: "Uppdragsbild", beteckning: "BILD", kategori: "produktion", datatyp: "image", isSystem: true, isRequired: false, standardArvs: false, beskrivning: "Foto på kärlet/objektet", icon: "Camera" },
    { namn: "Visningsbild", beteckning: "ICON", kategori: "produktion", datatyp: "image", isSystem: true, isRequired: false, standardArvs: false, beskrivning: "Visningsbild/ikon för objektet", icon: "Image" },
  ];

  let created = 0;
  for (const label of systemLabels) {
    const existing = await db.select({ id: metadataKatalog.id })
      .from(metadataKatalog)
      .where(and(
        eq(metadataKatalog.tenantId, DEFAULT_TENANT_ID),
        eq(metadataKatalog.beteckning, label.beteckning)
      ))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(metadataKatalog).values({
        tenantId: DEFAULT_TENANT_ID,
        ...label,
      });
      created++;
    } else if (label.isSystem) {
      await db.update(metadataKatalog)
        .set({ isSystem: true })
        .where(and(
          eq(metadataKatalog.tenantId, DEFAULT_TENANT_ID),
          eq(metadataKatalog.beteckning, label.beteckning)
        ));
    }
  }

  if (created > 0) {
    console.log(`Seeded ${created} system metadata labels (etiketter)`);
  }
}

/**
 * Idempotent migration: renames the legacy "default-tenant" row to "kinab".
 *
 * Handles all idempotency states:
 *   - Only "default-tenant" exists → insert "kinab", move children, delete old.
 *   - Both exist (partial/aborted prior run) → move remaining children, delete old.
 *   - Only "kinab" exists, no orphans → no-op.
 *   - Neither exists → no-op.
 *
 * Uses a transaction-scoped advisory lock to prevent races on concurrent startups.
 */
async function migrateDefaultTenantToKinab() {
  const OLD_ID = "default-tenant";
  const NEW_ID = "kinab";
  const LOCK_KEY = 7349821; // arbitrary constant for this migration

  const colRes = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants'
    ORDER BY ordinal_position
  `);
  const tenantCols = ((colRes as any).rows ?? []).map((r: any) => r.column_name as string);
  if (tenantCols.length === 0) {
    console.warn("[migration] tenants table has no columns, aborting");
    return;
  }
  const colList = tenantCols.map((c: string) => `"${c}"`).join(", ");
  const selectList = tenantCols
    .map((c: string) => (c === "id" ? `'${NEW_ID}'` : `"${c}"`))
    .join(", ");

  const childRes = await db.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'tenant_id' AND table_schema = 'public'
  `);
  const childTables = ((childRes as any).rows ?? []).map((r: any) => r.table_name as string);

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);

    const oldRow = await tx.execute(sql`SELECT 1 FROM tenants WHERE id = ${OLD_ID} LIMIT 1`);
    const oldExists = ((oldRow as any).rows?.length ?? 0) > 0;
    const newRow = await tx.execute(sql`SELECT 1 FROM tenants WHERE id = ${NEW_ID} LIMIT 1`);
    const newExists = ((newRow as any).rows?.length ?? 0) > 0;

    if (!oldExists && newExists) return;

    if (!oldExists && !newExists) {
      let orphans = 0;
      for (const table of childTables) {
        // nosemgrep: javascript.drizzle-orm.security.audit.ban-drizzle-sql-raw
        // childTables ar hardkodad lista, OLD_ID ar konstant fran denna fil.
        const r = await tx.execute(sql.raw(
          `SELECT 1 FROM "${table}" WHERE tenant_id = '${OLD_ID}' LIMIT 1`
        ));
        if (((r as any).rows?.length ?? 0) > 0) orphans++;
      }
      if (orphans > 0) {
        console.warn(`[migration] WARNING: ${orphans} child tables still reference '${OLD_ID}' but no parent row exists. Manual cleanup required.`);
      }
      return;
    }

    console.log(`[migration] Renaming tenant '${OLD_ID}' → '${NEW_ID}' (oldExists=${oldExists}, newExists=${newExists})`);

    if (oldExists && !newExists) {
      // nosemgrep: javascript.drizzle-orm.security.audit.ban-drizzle-sql-raw
      // colList/selectList genereras fran Drizzle-schema-introspektion (interna identifierare),
      // OLD_ID ar konstant. Ingen user-input.
      await tx.execute(sql.raw(`
        INSERT INTO tenants (${colList})
        SELECT ${selectList} FROM tenants WHERE id = '${OLD_ID}'
      `));
    }

    let totalRows = 0;
    for (const table of childTables) {
      // nosemgrep: javascript.drizzle-orm.security.audit.ban-drizzle-sql-raw
      // childTables hardkodad, OLD_ID/NEW_ID konstanter i denna fil. Ingen user-input.
      const result = await tx.execute(sql.raw(
        `UPDATE "${table}" SET tenant_id = '${NEW_ID}' WHERE tenant_id = '${OLD_ID}'`
      ));
      const rows = (result as any).rowCount ?? 0;
      if (rows > 0) {
        totalRows += rows;
        console.log(`[migration]   updated ${rows} rows in ${table}`);
      }
    }

    await tx.execute(sql`DELETE FROM tenants WHERE id = ${OLD_ID}`);
    console.log(`[migration] Tenant rename complete — ${totalRows} child rows moved across ${childTables.length} tables`);
  });

  await rebrandPlannixToKinab();
}

/**
 * Idempotent: rewrite any leftover "Plannix" labels (tenant name + branding)
 * for the kinab tenant so the visible UI matches the tenant rename.
 */
async function rebrandPlannixToKinab() {
  const NEW_ID = "kinab";
  try {
    const tenantRes = await db.execute(sql`
      UPDATE tenants SET name = 'Kinab' WHERE id = ${NEW_ID} AND name = 'Plannix'
    `);
    if (((tenantRes as any).rowCount ?? 0) > 0) {
      console.log(`[migration] Renamed tenant '${NEW_ID}' display name 'Plannix' → 'Kinab'`);
    }

    const brandingRes = await db.execute(sql`
      UPDATE tenant_branding
      SET company_name = 'Kinab',
          heading_text = CASE WHEN heading_text = 'Plannix Field Service' THEN 'Kinab Field Service' ELSE heading_text END
      WHERE tenant_id = ${NEW_ID} AND company_name = 'Plannix'
    `);
    if (((brandingRes as any).rowCount ?? 0) > 0) {
      console.log(`[migration] Rebranded tenant_branding for '${NEW_ID}' from 'Plannix' to 'Kinab'`);
    }
  } catch (err) {
    console.warn(`[migration] rebrandPlannixToKinab skipped:`, err);
  }
}

/**
 * Realigna enabled_modules för tenants på system-managed tiers (basic/standard)
 * så att modul-omstruktureringen i Task #526 (kpi_analytics + customer_mgmt
 * adderade, core slimmad) inte tappar bort dashboard/economics/reporting för
 * existerande tenants. Tenants på custom/premium/pilot lämnas orörda.
 */
async function backfillSystemTierModules() {
  try {
    const rows = await db.select().from(tenantFeatures);
    for (const row of rows) {
      if (row.packageTier !== "basic" && row.packageTier !== "standard") continue;
      const expected = getModulesForPackage(row.packageTier as any);
      const current = (row.enabledModules || []) as string[];
      const currentSet = new Set(current);
      const expectedSet = new Set(expected);
      const same =
        current.length === expected.length &&
        expected.every((m) => currentSet.has(m));
      if (same) continue;

      const added = expected.filter((m) => !currentSet.has(m));
      const removed = current.filter((m) => !expectedSet.has(m));

      await db.update(tenantFeatures)
        .set({
          enabledModules: expected,
          updatedAt: new Date(),
          updatedBy: "system",
        })
        .where(eq(tenantFeatures.tenantId, row.tenantId));
      await db.insert(featureAuditLog).values({
        tenantId: row.tenantId,
        action: "update",
        previousTier: row.packageTier,
        newTier: row.packageTier,
        previousModules: current,
        newModules: expected,
        changedBy: "system",
      });
      console.log(
        `[seed] tenantFeatures backfill ${row.tenantId} (${row.packageTier}): +[${added.join(",")}] -[${removed.join(",")}]`,
      );
    }
  } catch (err) {
    console.warn("[seed] backfillSystemTierModules hoppades över:", err);
  }
}

/**
 * Säkerställ Kinab-pilot-paket (Task #526). Idempotent: kör endast om
 * tenantFeatures-raden för kinab saknas, eller om den är på en
 * system-default-tier (basic/standard). Custom/premium/pilot-tenants
 * lämnas i fred — admins som manuellt valt en annan nivå ska inte revertas.
 */
async function ensureKinabPilotFeatures() {
  const TENANT_ID = "kinab";
  try {
    const tenantRow = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, TENANT_ID))
      .limit(1);
    if (tenantRow.length === 0) return; // ingen kinab-tenant — inget att göra

    const pilotModules = getModulesForPackage("pilot");
    const [existing] = await db
      .select()
      .from(tenantFeatures)
      .where(eq(tenantFeatures.tenantId, TENANT_ID));

    if (!existing) {
      await db.insert(tenantFeatures).values({
        tenantId: TENANT_ID,
        packageTier: "pilot",
        enabledModules: pilotModules,
        updatedBy: "system",
      }).onConflictDoNothing();
      await db.insert(featureAuditLog).values({
        tenantId: TENANT_ID,
        action: "create",
        previousTier: null,
        newTier: "pilot",
        previousModules: null,
        newModules: pilotModules,
        changedBy: "system",
      });
      console.log("[seed] Kinab tenantFeatures: skapade pilot-paket");
      return;
    }

    const systemDefaults = new Set(["basic", "standard"]);
    if (!systemDefaults.has(existing.packageTier)) {
      console.log(
        `[seed] Kinab tenantFeatures: bevarar manuellt valt paket "${existing.packageTier}" (ingen revert)`,
      );
      return;
    }

    await db.update(tenantFeatures)
      .set({
        packageTier: "pilot",
        enabledModules: pilotModules,
        updatedAt: new Date(),
        updatedBy: "system",
      })
      .where(eq(tenantFeatures.tenantId, TENANT_ID));
    await db.insert(featureAuditLog).values({
      tenantId: TENANT_ID,
      action: "update",
      previousTier: existing.packageTier,
      newTier: "pilot",
      previousModules: existing.enabledModules ?? null,
      newModules: pilotModules,
      changedBy: "system",
    });
    console.log(
      `[seed] Kinab tenantFeatures: uppgraderade ${existing.packageTier} → pilot`,
    );
  } catch (err) {
    console.warn("[seed] ensureKinabPilotFeatures hoppades över:", err);
  }
}
