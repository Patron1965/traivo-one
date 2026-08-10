import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "../../server/storage";
import {
  ensureResourceInTenant,
  ensureTeamInTenant,
  ensureCustomerInTenant,
  ensureObjectInTenant,
  ensureResourceIdsInTenant,
} from "../../server/routes/helpers";
import { NotFoundError } from "../../server/errors";
import { randomId } from "./helpers";
import type { InsertObject } from "@shared/schema";

const TENANT_A = "default-tenant";
const TENANT_B = "test-tenant-b";

describe("Tenant ownership-helpers — cross-tenant id:n avvisas", () => {
  let resourceA: string;
  let resourceB: string;
  let teamA: string;
  let teamB: string;
  let customerA: string;
  let customerB: string;
  let objectA: string;
  let objectB: string;

  beforeAll(async () => {
    // Båda tenants måste finnas i databasen så foreign key-villkor inte stoppar
    // setup-skapandet. ensureTenant är idempotent.
    await storage.ensureTenant(TENANT_A, { name: "Default tenant (test)" });
    await storage.ensureTenant(TENANT_B, { name: "Tenant B (test)" });

    const rA = await storage.createResource({
      tenantId: TENANT_A,
      name: `TO-ResA ${randomId()}`,
      resourceType: "person",
      serviceArea: ["zon-A"],
    });
    resourceA = rA.id;

    const rB = await storage.createResource({
      tenantId: TENANT_B,
      name: `TO-ResB ${randomId()}`,
      resourceType: "person",
      serviceArea: ["zon-B"],
    });
    resourceB = rB.id;

    const tA = await storage.createTeam({
      tenantId: TENANT_A,
      name: `TO-TeamA ${randomId()}`,
    });
    teamA = tA.id;

    const tB = await storage.createTeam({
      tenantId: TENANT_B,
      name: `TO-TeamB ${randomId()}`,
    });
    teamB = tB.id;

    const cA = await storage.createCustomer({
      tenantId: TENANT_A,
      name: `TO-CustA ${randomId()}`,
      customerNumber: randomId(),
    });
    customerA = cA.id;

    const cB = await storage.createCustomer({
      tenantId: TENANT_B,
      name: `TO-CustB ${randomId()}`,
      customerNumber: randomId(),
    });
    customerB = cB.id;

    const oA = await storage.createObject({
      tenantId: TENANT_A,
      customerId: customerA,
      name: `TO-ObjA ${randomId()}`,
      objectNumber: randomId(),
    } as InsertObject);
    objectA = oA.id;

    const oB = await storage.createObject({
      tenantId: TENANT_B,
      customerId: customerB,
      name: `TO-ObjB ${randomId()}`,
      objectNumber: randomId(),
    } as InsertObject);
    objectB = oB.id;
  });

  describe("ensureResourceInTenant", () => {
    it("returnerar resursen när id tillhör tenant", async () => {
      const r = await ensureResourceInTenant(resourceA, TENANT_A);
      expect(r.id).toBe(resourceA);
      expect(r.tenantId).toBe(TENANT_A);
    });

    it("kastar NotFoundError för cross-tenant id (tenant A frågar efter id i tenant B)", async () => {
      await expect(ensureResourceInTenant(resourceB, TENANT_A)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("kastar NotFoundError för null/undefined/okänt id", async () => {
      await expect(ensureResourceInTenant(null, TENANT_A)).rejects.toBeInstanceOf(NotFoundError);
      await expect(ensureResourceInTenant(undefined, TENANT_A)).rejects.toBeInstanceOf(NotFoundError);
      await expect(ensureResourceInTenant("does-not-exist-xyz", TENANT_A)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("ensureTeamInTenant", () => {
    it("returnerar teamet när id tillhör tenant", async () => {
      const t = await ensureTeamInTenant(teamA, TENANT_A);
      expect(t.id).toBe(teamA);
    });

    it("avvisar cross-tenant team-id", async () => {
      await expect(ensureTeamInTenant(teamB, TENANT_A)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("ensureCustomerInTenant", () => {
    it("returnerar kunden när id tillhör tenant", async () => {
      const c = await ensureCustomerInTenant(customerA, TENANT_A);
      expect(c.id).toBe(customerA);
    });

    it("avvisar cross-tenant kund-id", async () => {
      await expect(ensureCustomerInTenant(customerB, TENANT_A)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("ensureObjectInTenant", () => {
    it("returnerar objektet när id tillhör tenant", async () => {
      const o = await ensureObjectInTenant(objectA, TENANT_A);
      expect(o.id).toBe(objectA);
    });

    it("avvisar cross-tenant objekt-id", async () => {
      await expect(ensureObjectInTenant(objectB, TENANT_A)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("ensureResourceIdsInTenant (bulk)", () => {
    it("släpper igenom när alla id tillhör tenant", async () => {
      await expect(ensureResourceIdsInTenant([resourceA], TENANT_A)).resolves.toBeUndefined();
    });

    it("släpper igenom tom/odefinierad lista (inget filter aktivt)", async () => {
      await expect(ensureResourceIdsInTenant([], TENANT_A)).resolves.toBeUndefined();
      await expect(ensureResourceIdsInTenant(undefined, TENANT_A)).resolves.toBeUndefined();
      await expect(ensureResourceIdsInTenant(null, TENANT_A)).resolves.toBeUndefined();
    });

    it("avvisar listor som blandar resurser från olika tenants", async () => {
      await expect(
        ensureResourceIdsInTenant([resourceA, resourceB], TENANT_A),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("avvisar listor med okända id", async () => {
      await expect(
        ensureResourceIdsInTenant([resourceA, "ghost-id-xyz"], TENANT_A),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // Verifierar att den specifika auto-fill / send-schedule-flow:n nu skyddas
  // av samma helper. Tidigare filtrerade /api/auto-plan-week tyst bort
  // främmande id:n, vilket kunde dölja tenant-läckage.
  describe("auto-plan-week pre-check (samma helper som /api/auto-plan-week kör först i request-flödet)", () => {
    it("avvisar request där resourceIds blandar in en resurs från annan tenant", async () => {
      const requestPayload = {
        weekStartDate: "2026-04-27",
        resourceIds: [resourceA, resourceB], // resourceB tillhör TENANT_B
      };
      await expect(
        ensureResourceIdsInTenant(requestPayload.resourceIds, TENANT_A),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("släpper igenom request där alla resourceIds tillhör tenanten", async () => {
      const requestPayload = {
        weekStartDate: "2026-04-27",
        resourceIds: [resourceA],
      };
      await expect(
        ensureResourceIdsInTenant(requestPayload.resourceIds, TENANT_A),
      ).resolves.toBeUndefined();
    });
  });

  // /api/auto-plan-week/apply verkställer assignments. Tidigare hoppades
  // cross-tenant assignments tyst över; nu pre-checkas alla resource-id:n
  // i bulk via samma helper.
  describe("auto-plan-week/apply pre-check (samma helper som /api/auto-plan-week/apply kör först i request-flödet)", () => {
    it("avvisar assignments som innehåller resurs från annan tenant", async () => {
      const assignments = [
        { workOrderId: "wo-1", resourceId: resourceA, scheduledDate: "2026-04-27", scheduledStartTime: "08:00" },
        { workOrderId: "wo-2", resourceId: resourceB, scheduledDate: "2026-04-27", scheduledStartTime: "09:00" },
      ];
      const ids = assignments.map(a => a.resourceId).filter((id): id is string => !!id);
      await expect(
        ensureResourceIdsInTenant(ids, TENANT_A),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("släpper igenom assignments där alla resurs-id tillhör tenanten", async () => {
      const assignments = [
        { workOrderId: "wo-1", resourceId: resourceA, scheduledDate: "2026-04-27", scheduledStartTime: "08:00" },
      ];
      const ids = assignments.map(a => a.resourceId).filter((id): id is string => !!id);
      await expect(
        ensureResourceIdsInTenant(ids, TENANT_A),
      ).resolves.toBeUndefined();
    });
  });
});
