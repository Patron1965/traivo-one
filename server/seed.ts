import { db } from "./db";
import { tenants, customers, objects, resources, workOrders } from "@shared/schema";
import { sql } from "drizzle-orm";

const DEFAULT_TENANT_ID = "default-tenant";

export async function seedDatabase() {
  console.log("Starting database seed...");

  const existingTenant = await db.select().from(tenants).where(sql`id = ${DEFAULT_TENANT_ID}`);
  if (existingTenant.length > 0) {
    console.log("Database already seeded, skipping...");
    return;
  }

  const [tenant] = await db.insert(tenants).values({
    id: DEFAULT_TENANT_ID,
    name: "Kinab AB",
    orgNumber: "556789-1234",
    contactEmail: "info@kinab.se",
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
    email: "johan@kinab.se",
    homeLocation: "Södertälje",
    weeklyHours: 40,
    competencies: ["hamtning", "uj_service", "matavfall"],
    status: "active",
  }).returning();

  const [resource2] = await db.insert(resources).values({
    tenantId: DEFAULT_TENANT_ID,
    name: "Lisa Andersson",
    initials: "LA",
    resourceType: "person",
    phone: "+46701234570",
    email: "lisa@kinab.se",
    homeLocation: "Södertälje",
    weeklyHours: 40,
    competencies: ["hamtning", "atervinning", "serviceboende"],
    status: "active",
  }).returning();

  const [resource3] = await db.insert(resources).values({
    tenantId: DEFAULT_TENANT_ID,
    name: "Marcus Pettersson",
    initials: "MP",
    resourceType: "person",
    phone: "+46701234571",
    email: "marcus@kinab.se",
    homeLocation: "Nykvarn",
    weeklyHours: 40,
    competencies: ["hamtning", "uj_service"],
    status: "active",
  }).returning();

  console.log("Created resources:", resource1.name, resource2.name, resource3.name);

  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1);

  await db.insert(workOrders).values([
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      objectId: stensatravagen2.id,
      resourceId: resource1.id,
      title: "Hämtning hushållsavfall",
      description: "Tömning av kärl i samtliga soprum",
      orderType: "hamtning",
      priority: "normal",
      status: "scheduled",
      scheduledDate: monday,
      scheduledStartTime: "07:00",
      estimatedDuration: 30,
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      objectId: stensatravagen4.id,
      resourceId: resource1.id,
      title: "Hämtning hushållsavfall",
      description: "Tömning av kärl",
      orderType: "hamtning",
      priority: "normal",
      status: "scheduled",
      scheduledDate: monday,
      scheduledStartTime: "07:30",
      estimatedDuration: 25,
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      objectId: kungsgatan3.id,
      resourceId: resource2.id,
      title: "Hämtning + UJ service",
      description: "Tömning och rengöring av UJ-behållare",
      orderType: "uj_service",
      priority: "high",
      status: "scheduled",
      scheduledDate: monday,
      scheduledStartTime: "08:00",
      estimatedDuration: 45,
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: telgebostader.id,
      objectId: brinken4.id,
      resourceId: resource2.id,
      title: "Matavfall + Återvinning",
      description: "Hämtning av matavfall och återvinning",
      orderType: "hamtning",
      priority: "normal",
      status: "scheduled",
      scheduledDate: new Date(monday.getTime() + 24 * 60 * 60 * 1000),
      scheduledStartTime: "07:00",
      estimatedDuration: 40,
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: serviceboenden.id,
      objectId: aldregardenSolstralen.id,
      resourceId: resource3.id,
      title: "Serviceboende - Alla kärl",
      description: "Tömning av kök och soprum",
      orderType: "hamtning",
      priority: "normal",
      status: "scheduled",
      scheduledDate: monday,
      scheduledStartTime: "09:00",
      estimatedDuration: 35,
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: serviceboenden.id,
      objectId: servicehusetGoken.id,
      resourceId: resource3.id,
      title: "Serviceboende - Alla kärl",
      description: "Tömning av kök och soprum",
      orderType: "hamtning",
      priority: "normal",
      status: "scheduled",
      scheduledDate: monday,
      scheduledStartTime: "10:00",
      estimatedDuration: 40,
    },
  ]);

  console.log("Created work orders");
  console.log("Database seeding complete!");
}

seedDatabase().catch(console.error);
