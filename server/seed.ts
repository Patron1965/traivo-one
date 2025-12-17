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

  const [customer1] = await db.insert(customers).values({
    tenantId: DEFAULT_TENANT_ID,
    name: "Villa Skogsbacken AB",
    customerNumber: "KUND-001",
    contactPerson: "Erik Eriksson",
    email: "erik@skogsbacken.se",
    phone: "+46701111111",
    address: "Skogsbacken 12",
    city: "Stockholm",
    postalCode: "11122",
  }).returning();

  const [customer2] = await db.insert(customers).values({
    tenantId: DEFAULT_TENANT_ID,
    name: "Fastighets AB Norrtull",
    customerNumber: "KUND-002",
    contactPerson: "Maria Nilsson",
    email: "maria@norrtull.se",
    phone: "+46702222222",
    address: "Norrtullsgatan 5",
    city: "Stockholm",
    postalCode: "11333",
  }).returning();

  const [customer3] = await db.insert(customers).values({
    tenantId: DEFAULT_TENANT_ID,
    name: "Lars Larsson",
    customerNumber: "KUND-003",
    contactPerson: "Lars Larsson",
    email: "lars.larsson@gmail.com",
    phone: "+46703333333",
    address: "Björkvägen 3",
    city: "Täby",
    postalCode: "18345",
  }).returning();

  console.log("Created customers:", customer1.name, customer2.name, customer3.name);

  const [object1] = await db.insert(objects).values({
    tenantId: DEFAULT_TENANT_ID,
    customerId: customer1.id,
    name: "Brunn 1 - Skogsbacken",
    objectNumber: "OBJ-001",
    objectType: "well",
    address: "Skogsbacken 12",
    city: "Stockholm",
    postalCode: "11122",
    latitude: 59.3293,
    longitude: 18.0686,
    accessInfo: { gateCode: "1234", parking: "På gården", keyLocation: "Under mattan" },
    avgSetupTime: 12,
    status: "active",
  }).returning();

  const [object2] = await db.insert(objects).values({
    tenantId: DEFAULT_TENANT_ID,
    customerId: customer1.id,
    name: "Pump Station - Skogsbacken",
    objectNumber: "OBJ-002",
    objectType: "station",
    address: "Skogsbacken 14",
    city: "Stockholm",
    postalCode: "11122",
    latitude: 59.3295,
    longitude: 18.0688,
    accessInfo: { gateCode: "1234", parking: "Baksidan" },
    avgSetupTime: 18,
    status: "active",
  }).returning();

  const [object3] = await db.insert(objects).values({
    tenantId: DEFAULT_TENANT_ID,
    customerId: customer2.id,
    name: "Huvudbrunn - Norrtull",
    objectNumber: "OBJ-003",
    objectType: "well",
    address: "Norrtullsgatan 5",
    city: "Stockholm",
    postalCode: "11333",
    latitude: 59.3450,
    longitude: 18.0550,
    accessInfo: { gateCode: "5678", parking: "Gatuparkering, 100m till objekt", specialInstructions: "Ring före besök" },
    avgSetupTime: 22,
    status: "active",
  }).returning();

  const [object4] = await db.insert(objects).values({
    tenantId: DEFAULT_TENANT_ID,
    customerId: customer3.id,
    name: "Privatbrunn - Täby",
    objectNumber: "OBJ-004",
    objectType: "well",
    address: "Björkvägen 3",
    city: "Täby",
    postalCode: "18345",
    latitude: 59.4440,
    longitude: 18.0730,
    accessInfo: { parking: "I uppfarten", keyLocation: "Nyckellåda vid entrén, kod 9876" },
    avgSetupTime: 8,
    status: "active",
  }).returning();

  console.log("Created objects:", object1.name, object2.name, object3.name, object4.name);

  const [resource1] = await db.insert(resources).values({
    tenantId: DEFAULT_TENANT_ID,
    name: "Bengt Bengtsson",
    initials: "BB",
    resourceType: "person",
    phone: "+46701234569",
    email: "bengt@kinab.se",
    homeLocation: "Stockholm",
    weeklyHours: 40,
    competencies: ["well_service", "pump_repair", "installation"],
    status: "active",
  }).returning();

  const [resource2] = await db.insert(resources).values({
    tenantId: DEFAULT_TENANT_ID,
    name: "Carina Carlsson",
    initials: "CC",
    resourceType: "person",
    phone: "+46701234570",
    email: "carina@kinab.se",
    homeLocation: "Täby",
    weeklyHours: 40,
    competencies: ["well_service", "emergency_certified"],
    status: "active",
  }).returning();

  console.log("Created resources:", resource1.name, resource2.name);

  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1);

  await db.insert(workOrders).values([
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: customer1.id,
      objectId: object1.id,
      resourceId: resource1.id,
      title: "Årlig service",
      description: "Genomföra årlig service av brunn enligt avtal",
      orderType: "service",
      priority: "normal",
      status: "scheduled",
      scheduledDate: monday,
      scheduledStartTime: "08:00",
      estimatedDuration: 120,
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: customer1.id,
      objectId: object2.id,
      resourceId: resource1.id,
      title: "Reparation pump",
      description: "Pumpen har minskat tryck, behöver inspekteras",
      orderType: "repair",
      priority: "high",
      status: "scheduled",
      scheduledDate: new Date(monday.getTime() + 24 * 60 * 60 * 1000),
      scheduledStartTime: "10:00",
      estimatedDuration: 90,
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: customer2.id,
      objectId: object3.id,
      resourceId: resource2.id,
      title: "Akut - Vattenläckage",
      description: "Kunden rapporterar vattenläckage vid brunnen",
      orderType: "emergency",
      priority: "urgent",
      status: "scheduled",
      scheduledDate: monday,
      scheduledStartTime: "07:00",
      estimatedDuration: 60,
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: customer3.id,
      objectId: object4.id,
      resourceId: resource2.id,
      title: "Filterinstallation",
      description: "Installation av nytt vattenfilter",
      orderType: "installation",
      priority: "normal",
      status: "scheduled",
      scheduledDate: new Date(monday.getTime() + 2 * 24 * 60 * 60 * 1000),
      scheduledStartTime: "09:00",
      estimatedDuration: 180,
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      customerId: customer1.id,
      objectId: object1.id,
      resourceId: resource1.id,
      title: "Kvartalsservice",
      description: "Kvartalskontroll av brunn",
      orderType: "service",
      priority: "low",
      status: "draft",
      scheduledDate: new Date(monday.getTime() + 3 * 24 * 60 * 60 * 1000),
      scheduledStartTime: "08:00",
      estimatedDuration: 150,
    },
  ]);

  console.log("Created work orders");
  console.log("Database seeding complete!");
}

seedDatabase().catch(console.error);
