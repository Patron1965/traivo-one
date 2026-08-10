/**
 * Tenant-isolering för POST /api/mobile/login (kräver körande dev-server).
 *
 * Endpointen ligger utanför den globala tenant-middlewaren och får INTE
 * använda någon fallback-tenant (prod kastade tidigare 500). Tenant härleds
 * numera från den matchade resursen; tvetydiga träffar över flera tenants
 * nekas (401) istället för att gissas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import { resources, tenants } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const BASE = "http://localhost:5000";
const RUN = `mobtenant${Date.now()}`;
const PIN = String(100000 + Math.floor(Math.random() * 899999));
const RES_A = `${RUN}-a`;
const RES_B = `${RUN}-b`;
const EMAIL_A = `${RUN}-a@test.local`;
const EMAIL_B = `${RUN}-b@test.local`;

let tenantA: string;
let tenantB: string;

async function login(body: Record<string, string>) {
  return fetch(`${BASE}/api/mobile/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const allTenants = await db.select().from(tenants).limit(2);
  expect(allTenants.length, "minst 2 tenants krävs i dev-DB").toBeGreaterThanOrEqual(2);
  tenantA = allTenants[0].id;
  tenantB = allTenants[1].id;

  await db.insert(resources).values([
    { id: RES_A, tenantId: tenantA, name: `${RUN} A`, email: EMAIL_A, pin: PIN, status: "active", resourceType: "driver" },
    { id: RES_B, tenantId: tenantB, name: `${RUN} B`, email: EMAIL_B, pin: PIN, status: "active", resourceType: "driver" },
  ]);
});

afterAll(async () => {
  await db.delete(resources).where(inArray(resources.id, [RES_A, RES_B]));
});

describe("Mobile login tenant-isolering (ingen fallback-tenant)", () => {
  it("e-post + PIN loggar in rätt resurs och rätt tenant", async () => {
    const res = await login({ email: EMAIL_A, pin: PIN });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.resourceId).toBe(RES_A);
    expect(data.user.tenantId).toBe(tenantA);
  });

  it("samma PIN i annan tenant ger den tenantens resurs (ingen läcka)", async () => {
    const res = await login({ email: EMAIL_B, pin: PIN });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.resourceId).toBe(RES_B);
    expect(data.user.tenantId).toBe(tenantB);
  });

  it("PIN-only som matchar flera tenants nekas (tvetydig)", async () => {
    const res = await login({ pin: PIN });
    expect(res.status).toBe(401);
  });

  it("fel PIN nekas", async () => {
    const res = await login({ email: EMAIL_A, pin: "000000" });
    expect(res.status).toBe(401);
  });
});
