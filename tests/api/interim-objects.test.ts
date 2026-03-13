import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "../../server/storage";
import { apiGet, apiPut, apiPost, randomId } from "./helpers";

const TEST_TENANT = "default-tenant";

let testCustomerId: string;
let testObjectId: string;

describe("Interim Objects & Object Verification", () => {
  beforeAll(async () => {
    const customer = await storage.createCustomer({
      tenantId: TEST_TENANT,
      name: `Interim-Test Kund ${randomId()}`,
      customerNumber: randomId(),
    });
    testCustomerId = customer.id;

    const obj = await storage.createObject({
      tenantId: TEST_TENANT,
      customerId: testCustomerId,
      name: "Befintligt objekt",
      objectType: "fastighet",
      objectLevel: 1,
      status: "active",
    } as any);
    testObjectId = obj.id;
  });

  describe("Storage: isInterimObject default value", () => {
    it("skapar objekt med isInterimObject=false som standard", async () => {
      const obj = await storage.createObject({
        tenantId: TEST_TENANT,
        customerId: testCustomerId,
        name: "Vanligt objekt",
        objectType: "karl",
        objectLevel: 2,
      } as any);
      expect(obj.isInterimObject).toBe(false);
    });

    it("skapar objekt med isInterimObject=true", async () => {
      const obj = await storage.createObject({
        tenantId: TEST_TENANT,
        customerId: testCustomerId,
        name: "Interim test-objekt",
        objectType: "karl",
        objectLevel: 2,
        isInterimObject: true,
        status: "active",
      } as any);
      expect(obj.isInterimObject).toBe(true);
    });
  });

  describe("Storage: getObjectsPaginated interim filter", () => {
    it("filtrerar på isInterimObject=true", async () => {
      const result = await storage.getObjectsPaginated(TEST_TENANT, 100, 0, undefined, undefined, { isInterimObject: true });
      expect(result.objects.length).toBeGreaterThan(0);
      for (const obj of result.objects) {
        expect(obj.isInterimObject).toBe(true);
      }
    });

    it("filtrerar på isInterimObject=false", async () => {
      const result = await storage.getObjectsPaginated(TEST_TENANT, 100, 0, undefined, undefined, { isInterimObject: false });
      for (const obj of result.objects) {
        expect(obj.isInterimObject).toBe(false);
      }
    });

    it("returnerar korrekt total count med interim-filter", async () => {
      const result = await storage.getObjectsPaginated(TEST_TENANT, 0, 0, undefined, undefined, { isInterimObject: true });
      expect(result.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Storage: verify interim object", () => {
    let verifyTargetId: string;

    beforeAll(async () => {
      const obj = await storage.createObject({
        tenantId: TEST_TENANT,
        customerId: testCustomerId,
        name: "Verify-target interim",
        objectType: "karl",
        objectLevel: 2,
        isInterimObject: true,
        status: "active",
      } as any);
      verifyTargetId = obj.id;
    });

    it("verifierar interimobjekt via updateObject", async () => {
      const updated = await storage.updateObject(verifyTargetId, { isInterimObject: false });
      expect(updated!.isInterimObject).toBe(false);
    });

    it("verifierat objekt syns inte i interim-filter", async () => {
      const result = await storage.getObjectsPaginated(TEST_TENANT, 100, 0, undefined, undefined, { isInterimObject: true });
      const found = result.objects.find(o => o.id === verifyTargetId);
      expect(found).toBeUndefined();
    });
  });

  describe("Storage: reject interim object (soft-delete)", () => {
    let rejectTargetId: string;

    beforeAll(async () => {
      const obj = await storage.createObject({
        tenantId: TEST_TENANT,
        customerId: testCustomerId,
        name: "Reject-target interim",
        objectType: "karl",
        objectLevel: 2,
        isInterimObject: true,
        status: "active",
      } as any);
      rejectTargetId = obj.id;
    });

    it("avvisar interimobjekt med soft-delete och status rejected", async () => {
      const updated = await storage.updateObject(rejectTargetId, { deletedAt: new Date(), status: "rejected" });
      expect(updated!.status).toBe("rejected");
      expect(updated!.deletedAt).toBeTruthy();
    });
  });

  describe("Storage: create interim object from issue report", () => {
    let issueReportId: string;

    beforeAll(async () => {
      const report = await storage.createPublicIssueReport({
        tenantId: TEST_TENANT,
        objectId: testObjectId,
        category: "damage",
        title: "Skadad container",
        description: "Container vid entrén är trasig",
        latitude: 59.3293,
        longitude: 18.0686,
      } as any);
      issueReportId = report.id;
    });

    it("skapar interimobjekt med data från felanmälan", async () => {
      const interimObj = await storage.createObject({
        tenantId: TEST_TENANT,
        customerId: testCustomerId,
        name: "Interimobjekt från felanmälan",
        objectType: "karl",
        objectLevel: 1,
        isInterimObject: true,
        status: "active",
        latitude: 59.3293,
        longitude: 18.0686,
        notes: "Skapat från felanmälan: Skadad container",
      } as any);
      expect(interimObj.isInterimObject).toBe(true);
      expect(interimObj.name).toBe("Interimobjekt från felanmälan");
      expect(interimObj.latitude).toBeCloseTo(59.3293, 2);

      const updatedReport = await storage.updatePublicIssueReport(issueReportId, TEST_TENANT, {
        objectId: interimObj.id,
      });
      expect(updatedReport!.objectId).toBe(interimObj.id);
    });
  });

  describe("HTTP API — Auth-protected endpoints return 401", () => {
    it("PUT /api/objects/:id/verify returnerar 401 utan auth", async () => {
      const res = await apiPut(`/api/objects/${testObjectId}/verify`);
      expect(res.status).toBe(401);
    });

    it("PUT /api/objects/:id/reject returnerar 401 utan auth", async () => {
      const res = await apiPut(`/api/objects/${testObjectId}/reject`);
      expect(res.status).toBe(401);
    });

    it("POST /api/public-issue-reports/:id/create-interim-object returnerar 401 utan auth", async () => {
      const res = await apiPost("/api/public-issue-reports/some-id/create-interim-object", { customerId: "test" });
      expect(res.status).toBe(401);
    });

    it("GET /api/objects?interim=true returnerar 401 utan auth", async () => {
      const res = await apiGet("/api/objects?interim=true&limit=10&offset=0");
      expect(res.status).toBe(401);
    });
  });
});
