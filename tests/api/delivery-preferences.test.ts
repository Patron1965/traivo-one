import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Request, Response, NextFunction, Express } from "express";
import { storage } from "../../server/storage";
import { db } from "../../server/db";
import { tenants, customers } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import type { DeliveryPreferences } from "@shared/schema";
import { AppError } from "../../server/errors";
import { registerCustomerRoutes } from "../../server/routes/customerRoutes";

// Etapp 5 (Rensningen): objekt-egna leveranspreferenser är BORTTAGNA ur
// datamodellen (objects.delivery_preferences finns inte längre). Leverans-
// preferenser bor numera enbart på kunden (customers.deliveryPreferences).
// Dessa tester låser fast skriv-vägen PATCH /api/customers/:id: giltig payload
// round-trippar, ogiltiga payloads (fel tid-format, okänd priority) avvisas
// med 400 UTAN att skriva.

const NS = `dprefs-${Date.now()}`;
const TENANT_A = `${NS}-tenant-a`;

beforeAll(async () => {
  await storage.ensureTenant(TENANT_A, { name: "Delivery Prefs A" });
}, 30000);

afterAll(async () => {
  try {
    await db.delete(customers).where(inArray(customers.tenantId, [TENANT_A]));
    await db.delete(tenants).where(eq(tenants.id, TENANT_A));
  } catch (err) {
    console.warn("Cleanup (delivery-preferences.test) ofullständig:", err);
  }
}, 30000);

async function buildCustomerRoutesApp(tenantId: string): Promise<Express> {
  const expressMod = await import("express");
  const expressFn = (expressMod as unknown as { default?: typeof import("express").default }).default
    ?? (expressMod as unknown as typeof import("express").default);
  const app = expressFn();
  app.use(expressFn.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { tenantId: string }).tenantId = tenantId;
    next();
  });
  await registerCustomerRoutes(app);
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

interface PatchResult {
  status: number;
  body: Record<string, unknown>;
}

async function patchRoute(app: Express, path: string, payload: unknown): Promise<PatchResult> {
  const http = await import("http");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Could not allocate test port");
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
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

const VALID_WRITE_PREFS: DeliveryPreferences = {
  weeklyWindows: [{ weekday: 2, start: "07:30", end: "11:45" }],
  blockedHours: [{ start: "12:00", end: "13:00", weekdays: [2] }],
  blockedDates: ["2026-06-06"],
  notes: "Sparad via PATCH-vägen",
  priority: "strict",
};

describe("PATCH /api/customers/:id — leveranspreferenser skriv-väg", () => {
  it("sparar en giltig payload som kan läsas tillbaka på kunden", async () => {
    const c = await storage.createCustomer({
      tenantId: TENANT_A,
      name: `${NS} Kund skriv-väg`,
      customerNumber: `${NS}-W`,
    });

    const app = await buildCustomerRoutesApp(TENANT_A);
    const res = await patchRoute(app, `/api/customers/${c.id}`, {
      deliveryPreferences: VALID_WRITE_PREFS,
    });
    expect(res.status).toBe(200);

    const savedCustomer = await storage.getCustomer(c.id);
    const saved = savedCustomer?.deliveryPreferences as DeliveryPreferences | null;
    expect(saved?.notes).toBe(VALID_WRITE_PREFS.notes);
    expect(saved?.priority).toBe("strict");
    expect(saved?.weeklyWindows).toEqual(VALID_WRITE_PREFS.weeklyWindows);
    expect(saved?.blockedHours).toEqual(VALID_WRITE_PREFS.blockedHours);
    expect(saved?.blockedDates).toEqual(["2026-06-06"]);
  });

  it("avvisar fel tid-format med 400 utan att skriva", async () => {
    const c = await storage.createCustomer({
      tenantId: TENANT_A,
      name: `${NS} Kund badtime`,
      customerNumber: `${NS}-WT`,
    });

    const app = await buildCustomerRoutesApp(TENANT_A);
    const res = await patchRoute(app, `/api/customers/${c.id}`, {
      deliveryPreferences: {
        ...VALID_WRITE_PREFS,
        weeklyWindows: [{ weekday: 1, start: "08:00", end: "24:30" }],
      },
    });
    expect(res.status).toBe(400);

    const [row] = await db
      .select({ dp: customers.deliveryPreferences })
      .from(customers)
      .where(eq(customers.id, c.id));
    expect(row.dp).toBeNull();
  });

  it("avvisar okänd priority med 400 utan att skriva", async () => {
    const c = await storage.createCustomer({
      tenantId: TENANT_A,
      name: `${NS} Kund badprio`,
      customerNumber: `${NS}-WP`,
    });

    const app = await buildCustomerRoutesApp(TENANT_A);
    const res = await patchRoute(app, `/api/customers/${c.id}`, {
      deliveryPreferences: { ...VALID_WRITE_PREFS, priority: "akut" },
    });
    expect(res.status).toBe(400);

    const [row] = await db
      .select({ dp: customers.deliveryPreferences })
      .from(customers)
      .where(eq(customers.id, c.id));
    expect(row.dp).toBeNull();
  });
});
