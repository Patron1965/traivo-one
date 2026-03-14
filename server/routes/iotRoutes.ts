import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import crypto from "crypto";
import { insertIotDeviceSchema, insertIotApiKeySchema, iotApiKeys } from "@shared/schema";

export async function registerIoTRoutes(app: Express) {
// ========== IoT API — API key auth, bypasses tenant middleware ==========

const SIGNAL_TYPE_TO_ORDER_DESCRIPTION: Record<string, string> = {
  full: "Behållare full — automatisk tömningsorder",
  damaged: "Skada rapporterad av sensor",
  low_battery: "Lågt batteri på IoT-sensor",
  overflow: "Överfull behållare — brådskande tömning",
  tilt: "Behållare har vält",
  fire: "Brandvarning från sensor",
};

async function authenticateIotApiKey(req: ExpressRequest, res: ExpressResponse): Promise<{ tenantId: string } | null> {
  const authHeader = req.headers["x-api-key"] as string | undefined;
  if (!authHeader) {
    res.status(401).json({ error: "API-nyckel saknas. Skicka header X-Api-Key." });
    return null;
  }
  const keyRecord = await storage.getIotApiKeyByKey(authHeader);
  if (!keyRecord) {
    res.status(401).json({ error: "Ogiltig API-nyckel." });
    return null;
  }
  await db.update(iotApiKeys).set({ lastUsedAt: new Date() }).where(eq(iotApiKeys.id, keyRecord.id));
  return { tenantId: keyRecord.tenantId };
}

app.post("/api/iot/signals", asyncHandler(async (req, res) => {
    const auth = await authenticateIotApiKey(req, res);
    if (!auth) return;

    const VALID_SIGNAL_TYPES = ["full", "damaged", "low_battery", "overflow", "tilt", "fire", "heartbeat", "temperature", "weight", "gps"] as const;
    const schema = z.object({
      deviceId: z.string().optional(),
      externalDeviceId: z.string().optional(),
      signalType: z.enum(VALID_SIGNAL_TYPES),
      payload: z.string().optional(),
      batteryLevel: z.number().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
    const { deviceId, externalDeviceId, signalType, payload, batteryLevel } = parsed.data;

    if (!deviceId && !externalDeviceId) {
      throw new ValidationError("Ange antingen deviceId eller externalDeviceId.");
    }

    let device;
    if (deviceId) {
      device = await storage.getIotDevice(deviceId);
    } else if (externalDeviceId) {
      device = await storage.getIotDeviceByExternalId(auth.tenantId, externalDeviceId);
    }
    if (!device) throw new NotFoundError("Enhet hittades inte.");
    if (device.tenantId !== auth.tenantId) throw new ForbiddenError("Enheten tillhör inte denna tenant.");

    await storage.updateIotDevice(device.id, {
      lastSignal: signalType,
      lastSignalAt: new Date(),
      ...(batteryLevel !== undefined ? { batteryLevel } : {}),
    });

    const signal = await storage.createIotSignal({
      tenantId: auth.tenantId,
      deviceId: device.id,
      signalType,
      payload: payload || null,
      processed: false,
    });

    let createdWorkOrder = null;
    const DEFAULT_AUTO_ORDER_TYPES = ["full", "damaged", "low_battery", "overflow", "tilt", "fire"];
    const DEFAULT_PRIORITY_MAP: Record<string, string> = {
      fire: "urgent", overflow: "urgent", tilt: "high", damaged: "high", full: "normal", low_battery: "low",
    };

    const tenant = await storage.getTenant(auth.tenantId);
    const tenantSettings = (tenant?.settings || {}) as Record<string, unknown>;
    const iotRules = tenantSettings.iotRules as { autoOrderTypes?: string[]; priorityOverrides?: Record<string, string>; enabled?: boolean } | undefined;

    const rulesEnabled = iotRules?.enabled !== false;
    const autoOrderTypes = iotRules?.autoOrderTypes || DEFAULT_AUTO_ORDER_TYPES;
    const priorityOverrides = iotRules?.priorityOverrides || {};

    if (rulesEnabled && autoOrderTypes.includes(signalType)) {
      const obj = await storage.getObject(device.objectId);
      if (obj) {
        const description = SIGNAL_TYPE_TO_ORDER_DESCRIPTION[signalType] || `IoT-signal: ${signalType}`;
        const priority = priorityOverrides[signalType] || DEFAULT_PRIORITY_MAP[signalType] || "normal";
        const wo = await storage.createWorkOrder({
          tenantId: auth.tenantId,
          objectId: device.objectId,
          customerId: obj.customerId,
          title: description,
          orderType: "iot_auto",
          orderStatus: "skapad",
          description,
          priority,
          source: "iot",
        });
        createdWorkOrder = wo;
        await storage.updateIotSignal(signal.id, { processed: true, workOrderId: wo.id });
      }
    } else {
      await storage.updateIotSignal(signal.id, { processed: true });
    }

    res.status(201).json({
      signalId: signal.id,
      processed: true,
      workOrderCreated: !!createdWorkOrder,
      workOrderId: createdWorkOrder?.id || null,
    });
}));

app.get("/api/iot/rules", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    const settings = (tenant?.settings || {}) as Record<string, unknown>;
    const iotRules = settings.iotRules || {
      enabled: true,
      autoOrderTypes: ["full", "damaged", "low_battery", "overflow", "tilt", "fire"],
      priorityOverrides: {},
    };
    res.json(iotRules);
}));

app.put("/api/iot/rules", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rulesSchema = z.object({
      enabled: z.boolean().optional(),
      autoOrderTypes: z.array(z.string()).optional(),
      priorityOverrides: z.record(z.string()).optional(),
    });
    const parsed = rulesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

    const tenant = await storage.getTenant(tenantId);
    const existingSettings = (tenant?.settings || {}) as Record<string, unknown>;
    const updatedSettings = { ...existingSettings, iotRules: parsed.data };
    await storage.updateTenantSettings(tenantId, updatedSettings);
    res.json(parsed.data);
}));

app.get("/api/iot/devices", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const devices = await storage.getIotDevices(tenantId);
    res.json(devices);
}));

app.post("/api/iot/devices", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertIotDeviceSchema.parse({ ...req.body, tenantId });
    const obj = await storage.getObject(data.objectId);
    if (!obj || obj.tenantId !== tenantId) {
      throw new ValidationError("Objektet hittades inte eller tillhör inte er tenant.");
    }
    const device = await storage.createIotDevice(data);
    res.status(201).json(device);
}));

app.patch("/api/iot/devices/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getIotDevice(req.params.id);
    if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Enhet hittades inte.");
    const updateSchema = z.object({
      deviceType: z.string().optional(),
      externalDeviceId: z.string().nullable().optional(),
      status: z.string().optional(),
    });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
    const device = await storage.updateIotDevice(req.params.id, parsed.data);
    res.json(device);
}));

app.delete("/api/iot/devices/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getIotDevice(req.params.id);
    if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Enhet hittades inte.");
    await storage.deleteIotDevice(req.params.id);
    res.status(204).send();
}));

app.get("/api/iot/api-keys", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const keys = await storage.getIotApiKeys(tenantId);
    const masked = keys.map(k => ({ ...k, apiKey: k.apiKey.slice(0, 8) + "..." }));
    res.json(masked);
}));

app.post("/api/iot/api-keys", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const nameSchema = z.object({ name: z.string().min(1) });
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
    const apiKey = `iot_${crypto.randomBytes(32).toString("hex")}`;
    const key = await storage.createIotApiKey({ tenantId, apiKey, name: parsed.data.name, status: "active" });
    res.status(201).json(key);
}));

app.delete("/api/iot/api-keys/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const keys = await storage.getIotApiKeys(tenantId);
    const key = keys.find(k => k.id === req.params.id);
    if (!key) throw new NotFoundError("API-nyckel hittades inte.");
    await storage.deleteIotApiKey(req.params.id);
    res.status(204).send();
}));

app.get("/api/iot/signals", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const deviceId = req.query.deviceId as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const signals = await storage.getIotSignals(tenantId, { deviceId, limit });
    res.json(signals);
}));

}
