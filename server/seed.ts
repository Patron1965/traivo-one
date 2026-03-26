import { db } from "./db";
import { tenants, customers, objects, resources, workOrders, brandingTemplates, tenantBranding, userTenantRoles, users, metadataKatalog } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";

const DEFAULT_TENANT_ID = "default-tenant";

export async function seedDatabase() {
  console.log("Starting database seed...");

  const existingTenant = await db.select().from(tenants).where(sql`id = ${DEFAULT_TENANT_ID}`);
  if (existingTenant.length > 0) {
    console.log("Database already seeded, refreshing demo work order dates...");
    await refreshDemoWorkOrderDates();
    await seedSystemMetadataLabels();
    return;
  }

  const [tenant] = await db.insert(tenants).values({
    id: DEFAULT_TENANT_ID,
    name: "Traivo",
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
    status: "active",
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
    status: "active",
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
    status: "active",
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
      orderStatus: "planerad_resurs",
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
      orderStatus: "planerad_resurs",
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
      orderStatus: "planerad_resurs",
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
      orderStatus: "planerad_resurs",
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
      orderStatus: "planerad_resurs",
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
      orderStatus: "planerad_resurs",
      scheduledDate: monday,
      scheduledStartTime: "10:00",
      estimatedDuration: 40,
    },
  ]);

  console.log("Created work orders");

  const demoCust1 = await db.select().from(customers).where(sql`id = 'cust-telge'`);
  if (demoCust1.length === 0) {
    await seedFieldAppDemoData(tomasResource.id);
  }

  // Seed branding templates (8 industry templates)
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

  // Create default branding for tenant
  const existingBranding = await db.select().from(tenantBranding).where(sql`tenant_id = ${DEFAULT_TENANT_ID}`);
  if (existingBranding.length === 0) {
    await db.insert(tenantBranding).values({
      tenantId: DEFAULT_TENANT_ID,
      primaryColor: "#3B82F6",
      secondaryColor: "#6366F1",
      accentColor: "#F59E0B",
      companyName: "Traivo",
      headingText: "Traivo Field Service",
      subheadingText: "Planering som funkar",
      isPublished: true,
    });
    console.log("Created default tenant branding");
  }

  const tomasResCheck = await db.select().from(resources).where(sql`email = 'tomas@nordicrouting.se'`);
  if (tomasResCheck.length > 0) {
    // Check if user exists in users table
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
    
    // Create owner role
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

  const annaOrders = await db.select().from(workOrders).where(sql`id = 'wo-anna-1'`);
  if (annaOrders.length === 0) {
    const today2 = new Date();
    today2.setHours(0, 0, 0, 0);
    await db.insert(workOrders).values([
      { id: "wo-anna-1", tenantId: DEFAULT_TENANT_ID, customerId: "cust-telge", objectId: "obj-1", resourceId: "res-anna", title: "Tvätt soprum B", description: "Tvätt av soprum B, Stensätravägen", orderType: "tvatt", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: today2, scheduledStartTime: "08:00", estimatedDuration: 40 },
      { id: "wo-anna-2", tenantId: DEFAULT_TENANT_ID, customerId: "cust-kommun", objectId: "obj-5", resourceId: "res-anna", title: "Kontroll skola", description: "Kontroll av avfallshantering", orderType: "kontroll", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: today2, scheduledStartTime: "09:00", estimatedDuration: 50 },
      { id: "wo-anna-3", tenantId: DEFAULT_TENANT_ID, customerId: "cust-kommun", objectId: "obj-6", resourceId: "res-anna", title: "Tvätt container park", description: "Högtryckstvätt av container", orderType: "tvatt", priority: "high", orderStatus: "planerad_resurs", scheduledDate: today2, scheduledStartTime: "10:30", estimatedDuration: 35 },
      { id: "wo-anna-4", tenantId: DEFAULT_TENANT_ID, customerId: "cust-brf", objectId: "obj-4", resourceId: "res-anna", title: "Service soprum", description: "Service och underhåll", orderType: "service", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: today2, scheduledStartTime: "12:00", estimatedDuration: 60 },
    ]).onConflictDoNothing();
    console.log("Created 4 demo work orders for Anna");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const result = await db.update(workOrders)
    .set({ scheduledDate: today })
    .where(sql`id IN ('wo-1','wo-2','wo-3','wo-4','wo-5','wo-6','wo-7','wo-8','wo-anna-1','wo-anna-2','wo-anna-3','wo-anna-4') AND (scheduled_date IS NULL OR scheduled_date != ${today})`)
    .returning({ id: workOrders.id });
  
  if (result.length > 0) {
    console.log(`Updated ${result.length} demo work orders to today's date`);
  }
}

async function seedFieldAppDemoData(tomasResourceId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
    { id: "wo-1", tenantId: DEFAULT_TENANT_ID, customerId: "cust-telge", objectId: "obj-1", resourceId: tomasResourceId, title: "Tvätt soprum A", description: "Storstädning och tvätt av soprum inkl. väggar och golv", orderType: "tvatt", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: today, scheduledStartTime: "07:30", estimatedDuration: 45 },
    { id: "wo-2", tenantId: DEFAULT_TENANT_ID, customerId: "cust-telge", objectId: "obj-2", resourceId: tomasResourceId, title: "Besiktning fastighet", description: "Årlig besiktning av avfallsutrymmen och behållare", orderType: "besiktning", priority: "high", orderStatus: "planerad_resurs", scheduledDate: today, scheduledStartTime: "08:30", estimatedDuration: 60 },
    { id: "wo-3", tenantId: DEFAULT_TENANT_ID, customerId: "cust-brf", objectId: "obj-3", resourceId: tomasResourceId, title: "Tvätt kärl 240L", description: "Högtryckstvätt av brunt kärl vid Strandvägen 15", orderType: "tvatt", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: today, scheduledStartTime: "09:45", estimatedDuration: 30 },
    { id: "wo-4", tenantId: DEFAULT_TENANT_ID, customerId: "cust-brf", objectId: "obj-4", resourceId: tomasResourceId, title: "Kontroll soprum", description: "Kontroll av brandsäkerhet och skyltning i soprum", orderType: "kontroll", priority: "normal", orderStatus: "paborjad", scheduledDate: today, scheduledStartTime: "10:30", estimatedDuration: 40 },
    { id: "wo-5", tenantId: DEFAULT_TENANT_ID, customerId: "cust-kommun", objectId: "obj-5", resourceId: tomasResourceId, title: "Service ventilation skola", description: "Ventilationsservice och filterbyte i soprummet", orderType: "service", priority: "high", orderStatus: "planerad_resurs", scheduledDate: today, scheduledStartTime: "11:30", estimatedDuration: 90 },
    { id: "wo-6", tenantId: DEFAULT_TENANT_ID, customerId: "cust-kommun", objectId: "obj-6", resourceId: tomasResourceId, title: "Tvätt container", description: "Invändig tvätt av 660L container vid Brunnsängsparken", orderType: "tvatt", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: today, scheduledStartTime: "13:30", estimatedDuration: 35 },
    { id: "wo-7", tenantId: DEFAULT_TENANT_ID, customerId: "cust-fastighet", objectId: "obj-7", resourceId: tomasResourceId, title: "Etablering tvättstuga", description: "Ny etablering av avfallshantering i tvättstuga", orderType: "etablering", priority: "high", orderStatus: "planerad_resurs", scheduledDate: today, scheduledStartTime: "14:30", estimatedDuration: 75 },
    { id: "wo-8", tenantId: DEFAULT_TENANT_ID, customerId: "cust-fastighet", objectId: "obj-8", resourceId: tomasResourceId, title: "Besiktning källare", description: "Statusbesiktning av avfallsutrymme i källare", orderType: "besiktning", priority: "normal", orderStatus: "planerad_resurs", scheduledDate: today, scheduledStartTime: "16:00", estimatedDuration: 45 },
  ]);

  console.log("Created SimpleFieldApp demo data: 4 customers, 8 objects, 8 work orders for today");
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
