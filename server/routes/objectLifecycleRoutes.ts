// Endpoints för task #552: objekt-livscykel v2.
// (A) släktnamn:  GET/PUT /api/tenants/me/display-name-rules, GET /api/objects/:id/display-name
// (C) arkivering: GET /api/objects/:id/archive-preflight, POST /api/objects/:id/archive,
//                 POST /api/objects/:id/restore, GET /api/objects/archived
// (E) dynamiska kluster: GET/PUT /api/clusters/:id/dynamic-rules,
//                 POST /api/clusters/:id/apply-dynamic-rules
import type { Express } from "express";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { storage } from "../storage";
import { verifyTenantOwnership, formatZodError } from "./helpers";
import { z } from "zod";
import { db } from "../db";
import { clusters, displayNameRulesSchema, clusterDynamicRulesSchema } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import {
  computeDisplayName,
  computeDisplayNamesBatch,
  getDisplayNameRules,
  saveDisplayNameRules,
} from "../services/display-name";
import {
  archivePreflight,
  archiveObject,
  restoreObject,
  listArchivedObjects,
} from "../services/object-archive";
import { evaluateDynamicCluster } from "../services/dynamic-clusters";

export function registerObjectLifecycleRoutes(app: Express): void {
  // === (A) DISPLAY NAME / SLÄKTNAMN =========================================
  app.get("/api/tenants/me/display-name-rules", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rules = await getDisplayNameRules(tenantId);
    res.set("Cache-Control", "no-cache, must-revalidate");
    res.json(rules);
  }));

  app.put("/api/tenants/me/display-name-rules", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = displayNameRulesSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message ?? "Ogiltiga regler");
    const saved = await saveDisplayNameRules(tenantId, parsed.data);
    res.json(saved);
  }));

  app.get("/api/objects/:id/display-name", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const obj = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(obj, tenantId)) throw new NotFoundError("Objekt");
    const name = await computeDisplayName(req.params.id, tenantId);
    res.json({ id: req.params.id, displayName: name });
  }));

  app.post("/api/objects/display-names/batch", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({ ids: z.array(z.string()).min(1).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message ?? "Ogiltig input");
    const map = await computeDisplayNamesBatch(parsed.data.ids, tenantId);
    res.json(Object.fromEntries(map));
  }));

  // === (C) ARKIVERING =======================================================
  app.get("/api/objects/archived", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rows = await listArchivedObjects(tenantId);
    res.json(rows);
  }));

  app.get("/api/objects/:id/archive-preflight", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const obj = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(obj, tenantId)) throw new NotFoundError("Objekt");
    const result = await archivePreflight(req.params.id, tenantId);
    res.json(result);
  }));

  app.post("/api/objects/:id/archive", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const obj = await storage.getObject(req.params.id);
    if (!verifyTenantOwnership(obj, tenantId)) throw new NotFoundError("Objekt");
    const schema = z.object({
      reason: z.string().max(500).optional(),
      force: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message ?? "Ogiltig input");
    const userId = (req as any).user?.claims?.sub ?? (req as any).user?.id ?? null;
    const result = await archiveObject(req.params.id, tenantId, {
      archivedBy: userId,
      archivedReason: parsed.data.reason,
      force: parsed.data.force,
    });
    if (!result.ok) {
      return res.status(409).json({ error: "archive_blocked", preflight: result.preflight });
    }
    res.json({ ok: true, preflight: result.preflight });
  }));

  app.post("/api/objects/:id/restore", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    // Hämta inkl arkiverade — storage.getObject filtrerar bort dem.
    const archived = await listArchivedObjects(tenantId, 10000);
    const found = archived.find((r: any) => r.id === req.params.id);
    if (!found) throw new NotFoundError("Arkiverat objekt");
    await restoreObject(req.params.id, tenantId);
    res.json({ ok: true });
  }));

  // === (E) DYNAMISKA KLUSTER ================================================
  app.get("/api/clusters/:id/dynamic-rules", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const [c] = await db.select().from(clusters).where(and(eq(clusters.id, req.params.id), eq(clusters.tenantId, tenantId)));
    if (!c) throw new NotFoundError("Kluster");
    res.set("Cache-Control", "no-cache, must-revalidate");
    res.json({
      dynamicRules: c.dynamicRules ?? null,
      lastAppliedAt: c.dynamicRulesLastAppliedAt ?? null,
    });
  }));

  app.put("/api/clusters/:id/dynamic-rules", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const [c] = await db.select().from(clusters).where(and(eq(clusters.id, req.params.id), eq(clusters.tenantId, tenantId)));
    if (!c) throw new NotFoundError("Kluster");
    const schema = z.object({ dynamicRules: clusterDynamicRulesSchema.nullable() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message ?? "Ogiltiga regler");
    await db.update(clusters).set({ dynamicRules: parsed.data.dynamicRules as any }).where(and(eq(clusters.id, req.params.id), eq(clusters.tenantId, tenantId)));
    res.json({ ok: true });
  }));

  app.post("/api/clusters/:id/apply-dynamic-rules", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const [c] = await db.select().from(clusters).where(and(eq(clusters.id, req.params.id), eq(clusters.tenantId, tenantId)));
    if (!c) throw new NotFoundError("Kluster");
    if (!c.dynamicRules) throw new ValidationError("Klustret saknar dynamiska regler");
    const parsed = clusterDynamicRulesSchema.safeParse(c.dynamicRules);
    if (!parsed.success) throw new ValidationError("Sparade regler är ogiltiga");
    const dryRun = req.query.dryRun === "true" || req.body?.dryRun === true;
    const result = await evaluateDynamicCluster(c.id, tenantId, parsed.data, { dryRun });
    res.json({ dryRun, ...result });
  }));
}
