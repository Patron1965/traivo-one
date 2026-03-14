import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { insertResourceSchema } from "@shared/schema";

export async function registerResourceRoutes(app: Express) {
app.get("/api/resources", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const page = parseInt(req.query.page as string);
    const limit = Math.min(parseInt(req.query.limit as string) || 0, 200);
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    if (page > 0 && limit > 0) {
      const offset = (page - 1) * limit;
      const result = await storage.getResourcesPaginated(tenantId, limit, offset, search);
      return res.json({ data: result.resources, total: result.total, page, limit });
    }
    const resources = await storage.getResources(tenantId);
    res.json(resources);
  } catch (error) {
    console.error("Failed to fetch resources:", error);
    res.status(500).json({ error: "Kunde inte hämta resurser" });
  }
});

// Get all active resource positions (for planner map view) - MUST be before /:id
app.get("/api/resources/active-positions", async (req, res) => {
  try {
    const resources = await storage.getActiveResourcePositions();
    res.json(resources.map(r => ({
      id: r.id,
      name: r.name,
      latitude: r.currentLatitude,
      longitude: r.currentLongitude,
      status: r.trackingStatus,
      lastUpdate: r.lastPositionUpdate
    })));
  } catch (error) {
    console.error("Failed to fetch active positions:", error);
    res.status(500).json({ error: "Failed to fetch positions" });
  }
});

app.get("/api/resources/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.id);
    const verified = verifyTenantOwnership(resource, tenantId);
    if (!verified) return res.status(404).json({ error: "Resource not found" });
    res.json(verified);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch resource" });
  }
});

app.post("/api/resources", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertResourceSchema.parse({ ...req.body, tenantId });
    const resource = await storage.createResource(data);
    res.status(201).json(resource);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to create resource:", error);
    res.status(500).json({ error: "Failed to create resource" });
  }
});

app.patch("/api/resources/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResource(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Resource not found" });
    }
    const updateSchema = insertResourceSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    const resource = await storage.updateResource(req.params.id, updateData);
    if (!resource) return res.status(404).json({ error: "Resource not found" });
    res.json(resource);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(formatZodError(error));
    }
    console.error("Failed to update resource:", error);
    res.status(500).json({ error: "Failed to update resource" });
  }
});

app.delete("/api/resources/:id", async (req, res) => {
  try {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResource(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Resource not found" });
    }
    await storage.deleteResource(req.params.id);
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete resource:", error);
    res.status(500).json({ error: "Failed to delete resource" });
  }
});

}
