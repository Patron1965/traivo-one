import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "../../server/storage";
import { apiGet, apiPost, apiDelete, randomId } from "./helpers";
import type { InsertObject } from "../../shared/schema";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";
const TEST_TENANT = "default-tenant";

describe("IoT API", () => {
  let apiKeyValue: string;
  let apiKeyId: string;
  let deviceId: string;
  let objectId: string;

  beforeAll(async () => {
    const customer = await storage.createCustomer({
      tenantId: TEST_TENANT,
      name: `IoT Test Kund ${randomId()}`,
      customerNumber: randomId(),
    });

    const obj = await storage.createObject({
      tenantId: TEST_TENANT,
      name: `IoT Kärl ${randomId()}`,
      objectNumber: randomId(),
      objectType: "container",
      objectLevel: 2,
      customerId: customer.id,
    } as InsertObject);
    objectId = obj.id;
  });

  describe("Storage: API Key CRUD", () => {
    it("should create an API key via storage", async () => {
      const key = await storage.createIotApiKey({
        tenantId: TEST_TENANT,
        apiKey: `iot_test_${randomId()}`,
        name: "Test IoT Key",
        status: "active",
      });
      expect(key.id).toBeDefined();
      expect(key.apiKey.startsWith("iot_")).toBe(true);
      expect(key.name).toBe("Test IoT Key");
      apiKeyValue = key.apiKey;
      apiKeyId = key.id;
    });

    it("should look up API key by value", async () => {
      const found = await storage.getIotApiKeyByKey(apiKeyValue);
      expect(found).toBeDefined();
      expect(found!.id).toBe(apiKeyId);
      expect(found!.tenantId).toBe(TEST_TENANT);
    });

    it("should not find inactive API key", async () => {
      const inactive = await storage.createIotApiKey({
        tenantId: TEST_TENANT,
        apiKey: `iot_inactive_${randomId()}`,
        name: "Inactive Key",
        status: "inactive",
      });
      const found = await storage.getIotApiKeyByKey(inactive.apiKey);
      expect(found).toBeUndefined();
      await storage.deleteIotApiKey(inactive.id);
    });

    it("should list API keys for tenant", async () => {
      const keys = await storage.getIotApiKeys(TEST_TENANT);
      expect(keys.some(k => k.id === apiKeyId)).toBe(true);
    });
  });

  describe("Storage: Device CRUD", () => {
    it("should create an IoT device via storage", async () => {
      const device = await storage.createIotDevice({
        tenantId: TEST_TENANT,
        objectId,
        deviceType: "fill_sensor",
        externalDeviceId: `SEN-${randomId()}`,
      });
      expect(device.id).toBeDefined();
      expect(device.deviceType).toBe("fill_sensor");
      expect(device.objectId).toBe(objectId);
      deviceId = device.id;
    });

    it("should find device by external ID", async () => {
      const device = await storage.getIotDevice(deviceId);
      expect(device).toBeDefined();
      const byExternal = await storage.getIotDeviceByExternalId(TEST_TENANT, device!.externalDeviceId!);
      expect(byExternal).toBeDefined();
      expect(byExternal!.id).toBe(deviceId);
    });

    it("should list devices for tenant", async () => {
      const devices = await storage.getIotDevices(TEST_TENANT);
      expect(devices.some(d => d.id === deviceId)).toBe(true);
    });

    it("should update device", async () => {
      const updated = await storage.updateIotDevice(deviceId, { status: "inactive" });
      expect(updated).toBeDefined();
      expect(updated!.status).toBe("inactive");
      await storage.updateIotDevice(deviceId, { status: "active" });
    });
  });

  describe("HTTP: IoT admin endpoints require auth", () => {
    it("GET /api/iot/devices returns 401 without auth", async () => {
      const res = await apiGet("/api/iot/devices");
      expect(res.status).toBe(401);
    });

    it("POST /api/iot/api-keys returns 401 without auth", async () => {
      const res = await apiPost("/api/iot/api-keys", { name: "should fail" });
      expect(res.status).toBe(401);
    });

    it("GET /api/iot/signals returns 401 without auth", async () => {
      const res = await apiGet("/api/iot/signals");
      expect(res.status).toBe(401);
    });
  });

  describe("HTTP: Signal processing via API key", () => {
    it("should reject signal without API key header", async () => {
      const res = await apiPost("/api/iot/signals", { deviceId, signalType: "full" });
      expect(res.status).toBe(401);
    });

    it("should reject signal with invalid API key", async () => {
      const res = await fetch(`${BASE_URL}/api/iot/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": "invalid_key" },
        body: JSON.stringify({ deviceId, signalType: "full" }),
      });
      expect(res.status).toBe(401);
    });

    it("should process 'full' signal and auto-create work order", async () => {
      const res = await fetch(`${BASE_URL}/api/iot/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKeyValue },
        body: JSON.stringify({ deviceId, signalType: "full", batteryLevel: 85 }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.processed).toBe(true);
      expect(body.workOrderCreated).toBe(true);
      expect(body.workOrderId).toBeDefined();
    });

    it("should process 'low_battery' signal and auto-create work order", async () => {
      const res = await fetch(`${BASE_URL}/api/iot/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKeyValue },
        body: JSON.stringify({ deviceId, signalType: "low_battery", batteryLevel: 10 }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.processed).toBe(true);
      expect(body.workOrderCreated).toBe(true);
      expect(body.workOrderId).toBeDefined();
    });

    it("should process signal by externalDeviceId", async () => {
      const device = await storage.getIotDevice(deviceId);
      const res = await fetch(`${BASE_URL}/api/iot/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKeyValue },
        body: JSON.stringify({ externalDeviceId: device!.externalDeviceId, signalType: "damaged" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.workOrderCreated).toBe(true);
    });

    it("should update device state after signals", async () => {
      const dev = await storage.getIotDevice(deviceId);
      expect(dev).toBeDefined();
      expect(dev!.lastSignal).toBe("damaged");
      expect(dev!.batteryLevel).toBe(10);
    });

    it("should return 404 for unknown device", async () => {
      const res = await fetch(`${BASE_URL}/api/iot/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKeyValue },
        body: JSON.stringify({ deviceId: "nonexistent-id", signalType: "full" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("Storage: Signal records", () => {
    it("should list signal records", async () => {
      const signals = await storage.getIotSignals(TEST_TENANT, { deviceId });
      expect(signals.length).toBeGreaterThanOrEqual(3);
      expect(signals.every(s => s.deviceId === deviceId)).toBe(true);
    });

    it("should have work order IDs on auto-order signals", async () => {
      const signals = await storage.getIotSignals(TEST_TENANT, { deviceId });
      const fullSignal = signals.find(s => s.signalType === "full");
      expect(fullSignal).toBeDefined();
      expect(fullSignal!.workOrderId).toBeDefined();
      expect(fullSignal!.processed).toBe(true);
    });
  });

  describe("Configurable IoT rules", () => {
    it("should skip auto-order when rules are disabled via tenant settings", async () => {
      await storage.updateTenantSettings(TEST_TENANT, {
        iotRules: { enabled: false },
      });

      const res = await fetch(`${BASE_URL}/api/iot/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKeyValue },
        body: JSON.stringify({ deviceId, signalType: "full" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.workOrderCreated).toBe(false);

      await storage.updateTenantSettings(TEST_TENANT, {});
    });

    it("should respect custom autoOrderTypes list", async () => {
      await storage.updateTenantSettings(TEST_TENANT, {
        iotRules: { enabled: true, autoOrderTypes: ["full"] },
      });

      const resLowBat = await fetch(`${BASE_URL}/api/iot/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKeyValue },
        body: JSON.stringify({ deviceId, signalType: "low_battery", batteryLevel: 5 }),
      });
      expect(resLowBat.status).toBe(201);
      const bodyLowBat = await (resLowBat).json();
      expect(bodyLowBat.workOrderCreated).toBe(false);

      const resFull = await fetch(`${BASE_URL}/api/iot/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKeyValue },
        body: JSON.stringify({ deviceId, signalType: "full" }),
      });
      expect(resFull.status).toBe(201);
      const bodyFull = await (resFull).json();
      expect(bodyFull.workOrderCreated).toBe(true);

      await storage.updateTenantSettings(TEST_TENANT, {});
    });
  });

  describe("Cleanup", () => {
    it("should delete IoT device (cascade signals)", async () => {
      await storage.deleteIotDevice(deviceId);
      const dev = await storage.getIotDevice(deviceId);
      expect(dev).toBeUndefined();
    });

    it("should delete API key", async () => {
      await storage.deleteIotApiKey(apiKeyId);
      const found = await storage.getIotApiKeyByKey(apiKeyValue);
      expect(found).toBeUndefined();
    });
  });
});
