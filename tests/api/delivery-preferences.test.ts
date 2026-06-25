import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Request, Response, NextFunction, Express } from "express";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { tenants, customers, objects, objectPayers } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import type { InsertObject, DeliveryPreferences } from "@shared/schema";
import { AppError } from "../../server/errors";
import { registerObjectRoutes } from "../../server/routes/objectRoutes";

// Task #1143: arvet av leveranspreferenser (objekt → kund → ingen) i
// storage.resolveDeliveryPreferences är affärskritiskt för planering/VRP men
// saknade tester. Fallback-kedjan kan tyst gå sönder (t.ex. om parseSafe slutar
// fånga korrupt JSON eller kund-fallbacken tappas). Dessa tester kör mot riktig
// DB (samma mönster som object-primary-parent.test.ts) och täcker dessutom att
// GET /api/objects/:id/delivery-preferences respekterar tenant-ägarskap.

const NS = `dprefs-${Date.now()}`;
const TENANT_A = `${NS}-tenant-a`;
const TENANT_B = `${NS}-tenant-b`;

let customerWithPrefs = "";
let customerNoPrefs = "";

const CUSTOMER_PREFS: DeliveryPreferences = {
  weeklyWindows: [{ weekday: 1, start: "08:00", end: "12:00" }],
  blockedHours: [],
  blockedDates: [],
  notes: "Kundens fallback-fönster",
  priority: "preferred",
};

const OBJECT_PREFS: DeliveryPreferences = {
  weeklyWindows: [{ weekday: 3, start: "13:00", end: "16:00" }],
  blockedHours: [],
  blockedDates: ["2026-12-24"],
  notes: "Objektets egna fönster",
  priority: "strict",
};

function makeObject(
  tenantId: string,
  overrides: Partial<InsertObject> & Pick<InsertObject, "name">,
): InsertObject {
  return {
    tenantId,
    objectType: "karl",
    objectLevel: 2,
    status: "active",
    ...overrides,
  } as InsertObject;
}

// Kund-kopplingen som resolveDeliveryPreferences läser kommer från object_payers
// (primary), inte legacy objects.customer_id. Den här helpern skapar objektet och
// — om customerId anges — en primär betalare så att fallbacken till kundens prefs
// blir testbar via samma väg som produktion använder.
async function createObjectWithPrimaryCustomer(
  tenantId: string,
  customerId: string | null,
  overrides: Partial<InsertObject> & Pick<InsertObject, "name">,
) {
  const obj = await storage.createObject(makeObject(tenantId, overrides));
  if (customerId) {
    await storage.createObjectPayer({
      tenantId,
      objectId: obj.id,
      customerId,
      payerType: "primary",
      isPrimary: true,
    } as any);
  }
  return obj;
}

beforeAll(async () => {
  await storage.ensureTenant(TENANT_A, { name: "Delivery Prefs A" });
  await storage.ensureTenant(TENANT_B, { name: "Delivery Prefs B" });

  const cPrefs = await storage.createCustomer({
    tenantId: TENANT_A,
    name: `${NS} Kund med prefs`,
    customerNumber: `${NS}-P`,
    deliveryPreferences: CUSTOMER_PREFS,
  } as any);
  customerWithPrefs = cPrefs.id;

  const cNoPrefs = await storage.createCustomer({
    tenantId: TENANT_A,
    name: `${NS} Kund utan prefs`,
    customerNumber: `${NS}-N`,
  });
  customerNoPrefs = cNoPrefs.id;
}, 30000);

afterAll(async () => {
  try {
    await db.delete(objectPayers).where(inArray(objectPayers.tenantId, [TENANT_A, TENANT_B]));
    await db.delete(objects).where(inArray(objects.tenantId, [TENANT_A, TENANT_B]));
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT_A, TENANT_B]));
    await db.delete(tenants).where(inArray(tenants.id, [TENANT_A, TENANT_B]));
  } catch (err) {
    console.warn("Cleanup (delivery-preferences.test) ofullständig:", err);
  }
}, 30000);

// ---------------------------------------------------------------------------
// storage.resolveDeliveryPreferences — fallback-kedjan objekt → kund → ingen
// ---------------------------------------------------------------------------

describe("storage.resolveDeliveryPreferences — fallback-kedja", () => {
  it("returnerar objektets egna prefs (source=object) när de är satta", async () => {
    const obj = await createObjectWithPrimaryCustomer(TENANT_A, customerWithPrefs, {
      name: `${NS} egna-prefs`,
      deliveryPreferences: OBJECT_PREFS,
    } as Partial<InsertObject> & Pick<InsertObject, "name">);

    const resolved = await storage.resolveDeliveryPreferences(obj.id);
    expect(resolved.source).toBe("object");
    expect(resolved.effective.notes).toBe(OBJECT_PREFS.notes);
    expect(resolved.effective.priority).toBe("strict");
    expect(resolved.effective.weeklyWindows).toEqual(OBJECT_PREFS.weeklyWindows);
    expect(resolved.effective.blockedDates).toEqual(["2026-12-24"]);
  });

  it("ärver kundens prefs (source=customer) när objektet saknar egna", async () => {
    const obj = await createObjectWithPrimaryCustomer(TENANT_A, customerWithPrefs, {
      name: `${NS} arv-fran-kund`,
    } as Partial<InsertObject> & Pick<InsertObject, "name">);

    const resolved = await storage.resolveDeliveryPreferences(obj.id);
    expect(resolved.source).toBe("customer");
    expect(resolved.effective.notes).toBe(CUSTOMER_PREFS.notes);
    expect(resolved.effective.weeklyWindows).toEqual(CUSTOMER_PREFS.weeklyWindows);
  });

  it("returnerar tomt (source=none) när objektet saknar kundkoppling", async () => {
    const obj = await createObjectWithPrimaryCustomer(TENANT_A, null, {
      name: `${NS} ingen-kund`,
    } as Partial<InsertObject> & Pick<InsertObject, "name">);

    const resolved = await storage.resolveDeliveryPreferences(obj.id);
    expect(resolved.source).toBe("none");
    expect(resolved.effective.weeklyWindows).toEqual([]);
    expect(resolved.effective.notes).toBe("");
    expect(resolved.effective.priority).toBe("preferred");
  });

  it("returnerar tomt (source=none) när kunden finns men saknar prefs", async () => {
    const obj = await createObjectWithPrimaryCustomer(TENANT_A, customerNoPrefs, {
      name: `${NS} kund-utan-prefs`,
    } as Partial<InsertObject> & Pick<InsertObject, "name">);

    const resolved = await storage.resolveDeliveryPreferences(obj.id);
    expect(resolved.source).toBe("none");
    expect(resolved.effective).toEqual({
      weeklyWindows: [],
      blockedHours: [],
      blockedDates: [],
      notes: "",
      priority: "preferred",
    });
  });

  it("faller tillbaka till kund när objektets prefs är korrupt JSON (parseSafe)", async () => {
    const obj = await createObjectWithPrimaryCustomer(TENANT_A, customerWithPrefs, {
      name: `${NS} korrupt-objekt-prefs`,
    } as Partial<InsertObject> & Pick<InsertObject, "name">);

    // Skriv in en strukturellt ogiltig payload direkt i kolumnen (kringgår
    // insert-validering) för att simulera korrupt/legacy data. parseSafe ska
    // returnera null och fallbacken ska gå vidare till kunden.
    await db
      .update(objects)
      .set({ deliveryPreferences: { priority: "bogus", weeklyWindows: "inte-en-array" } as any })
      .where(eq(objects.id, obj.id));

    const resolved = await storage.resolveDeliveryPreferences(obj.id);
    expect(resolved.source).toBe("customer");
    expect(resolved.effective.notes).toBe(CUSTOMER_PREFS.notes);
  });

  it("returnerar tomt (source=none) när BÅDE objekt och kund har korrupt JSON", async () => {
    const obj = await createObjectWithPrimaryCustomer(TENANT_A, customerNoPrefs, {
      name: `${NS} korrupt-bada`,
    } as Partial<InsertObject> & Pick<InsertObject, "name">);

    await db
      .update(objects)
      .set({ deliveryPreferences: { weeklyWindows: 42 } as any })
      .where(eq(objects.id, obj.id));
    await db
      .update(customers)
      .set({ deliveryPreferences: { priority: 123 } as any })
      .where(eq(customers.id, customerNoPrefs));

    const resolved = await storage.resolveDeliveryPreferences(obj.id);
    expect(resolved.source).toBe("none");
    expect(resolved.effective.notes).toBe("");

    // Återställ kunden så övriga tester inte påverkas (körordning oberoende).
    await db
      .update(customers)
      .set({ deliveryPreferences: null })
      .where(eq(customers.id, customerNoPrefs));
  });

  it("returnerar tomt (source=none) för okänt objekt-id", async () => {
    const resolved = await storage.resolveDeliveryPreferences("finns-inte-12345");
    expect(resolved.source).toBe("none");
    expect(resolved.effective).toEqual({
      weeklyWindows: [],
      blockedHours: [],
      blockedDates: [],
      notes: "",
      priority: "preferred",
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/objects/:id/delivery-preferences — tenant-ägarskap
// ---------------------------------------------------------------------------

async function buildAppForTenant(tenantId: string): Promise<Express> {
  const expressMod = await import("express");
  const expressFn = (expressMod as unknown as { default?: typeof import("express").default }).default
    ?? (expressMod as unknown as typeof import("express").default);
  const app = expressFn();
  app.use(expressFn.json());
  // Injicera tenant-kontexten som tenant-middleware annars skulle sätta, så att
  // getTenantIdWithFallback(req) returnerar test-tenanten i stället för fallback.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { tenantId: string }).tenantId = tenantId;
    next();
  });
  await registerObjectRoutes(app);
  // Spegla den globala error-middleware:n i server/index.ts så AppError-kastande
  // routes får sin status-kod i stället för att bubbla upp till 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status = err instanceof AppError
      ? err.statusCode
      : (err as { status?: number; statusCode?: number })?.status
        ?? (err as { status?: number; statusCode?: number })?.statusCode
        ?? 500;
    const message = err instanceof Error ? err.message : "Ett oväntat serverfel uppstod";
    res.status(status).json({ error: message });
  });
  return app;
}

interface GetResult {
  status: number;
  body: Record<string, unknown>;
}

async function getRoute(app: Express, path: string): Promise<GetResult> {
  const http = await import("http");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Could not allocate test port");
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`);
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("GET /api/objects/:id/delivery-preferences — tenant-ägarskap", () => {
  let objectId = "";

  beforeAll(async () => {
    const obj = await createObjectWithPrimaryCustomer(TENANT_A, customerWithPrefs, {
      name: `${NS} route-obj`,
      deliveryPreferences: OBJECT_PREFS,
    } as Partial<InsertObject> & Pick<InsertObject, "name">);
    objectId = obj.id;
  }, 30000);

  it("returnerar resolved prefs för rätt tenant", async () => {
    const app = await buildAppForTenant(TENANT_A);
    const res = await getRoute(app, `/api/objects/${objectId}/delivery-preferences`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("object");
    expect((res.body.effective as DeliveryPreferences).notes).toBe(OBJECT_PREFS.notes);
  });

  it("svarar 404 när objektet tillhör en annan tenant", async () => {
    const app = await buildAppForTenant(TENANT_B);
    const res = await getRoute(app, `/api/objects/${objectId}/delivery-preferences`);
    expect(res.status).toBe(404);
  });

  it("svarar 404 för okänt objekt-id", async () => {
    const app = await buildAppForTenant(TENANT_A);
    const res = await getRoute(app, `/api/objects/finns-inte-99999/delivery-preferences`);
    expect(res.status).toBe(404);
  });
});
