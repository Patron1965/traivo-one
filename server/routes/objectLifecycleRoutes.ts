// Endpoints för task #552: objekt-livscykel v2.
// (A) släktnamn:  GET/PUT /api/tenants/me/display-name-rules, GET /api/objects/:id/display-name
// (C) arkivering: GET /api/objects/:id/archive-preflight, POST /api/objects/:id/archive,
//                 POST /api/objects/:id/restore, GET /api/objects/archived
// (E) dynamiska kluster: GET/PUT /api/clusters/:id/dynamic-rules,
//                 POST /api/clusters/:id/apply-dynamic-rules
import type { Express } from "express";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ConflictError } from "../errors";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { storage } from "../storage";
import { verifyTenantOwnership, formatZodError } from "./helpers";
import { z } from "zod";
import { db } from "../db";
import { clusters, objects, importBatches, displayNameRulesSchema, clusterDynamicRulesSchema } from "@shared/schema";
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
    const language = typeof req.query.language === "string" ? req.query.language : undefined;
    const name = await computeDisplayName(req.params.id, tenantId, undefined, language);
    res.json({ id: req.params.id, displayName: name });
  }));

  app.post("/api/objects/display-names/batch", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({ ids: z.array(z.string()).min(1).max(500), language: z.string().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message ?? "Ogiltig input");
    const map = await computeDisplayNamesBatch(parsed.data.ids, tenantId, undefined, parsed.data.language);
    res.json(Object.fromEntries(map));
  }));

  // === (C) ARKIVERING =======================================================
  // Task #716: arkiv-listning/återställning är admin-only (konsekvent med /api/archive/*).
  app.get("/api/objects/archived", requireAdmin, asyncHandler(async (req, res) => {
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
      throw new ConflictError("archive_blocked", { preflight: result.preflight });
    }
    res.json({ ok: true, preflight: result.preflight });
  }));

  app.post("/api/objects/:id/restore", requireAdmin, asyncHandler(async (req, res) => {
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

  // Dynamiska kluster-regler är avvecklade (Task #856). Automatisk om-tilldelning
  // av objekt till kluster via regler körs inte längre. Endpointen behålls för
  // bakåtkompatibilitet men returnerar ett avvecklat-svar utan att ändra data.
  app.post("/api/clusters/:id/apply-dynamic-rules", asyncHandler(async (req, res) => {
    throw new ValidationError("Dynamiska kluster-regler är avvecklade och utvärderas inte längre.");
  }));

  // === (F) ITERATIV UNDEROBJEKT-IMPORT ======================================
  // Lägg till barnobjekt under en befintlig parent i en omgång.
  // Body: { rows: [...], dryRun?: boolean }
  // Validerar varje rad, returnerar preview vid dryRun annars commit-resultat.
  const childRowSchema = z.object({
    name: z.string().min(1).max(200),
    hierarchyLevel: z.string().max(64).optional(),
    objectType: z.string().max(64).optional(),
    objectNumber: z.string().max(64).optional(),
    address: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    postalCode: z.string().max(20).optional(),
    accessType: z.string().max(32).optional(),
    accessCode: z.string().max(32).optional(),
  });
  const importChildrenSchema = z.object({
    rows: z.array(childRowSchema).min(1).max(500),
    dryRun: z.boolean().optional(),
  });

  app.post("/api/objects/:parentId/import-children", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const [parent] = await db
      .select()
      .from(objects)
      .where(and(eq(objects.id, req.params.parentId), eq(objects.tenantId, tenantId)));
    if (!parent) throw new NotFoundError("Parent-objekt");
    const parsed = importChildrenSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).message ?? "Ogiltig payload");

    const dryRun = parsed.data.dryRun === true;
    const errors: Array<{ index: number; message: string }> = [];
    const preview: Array<{ index: number; name: string }> = [];

    // Konfliktcheck: object_number-dubletter inom tenant
    const newObjectNumbers = parsed.data.rows.map(r => r.objectNumber).filter((v): v is string => !!v);
    let existingNumbers = new Set<string>();
    if (newObjectNumbers.length > 0) {
      const ex = await db
        .select({ n: objects.objectNumber })
        .from(objects)
        .where(eq(objects.tenantId, tenantId));
      existingNumbers = new Set(ex.map(r => r.n).filter((v): v is string => !!v));
    }

    parsed.data.rows.forEach((r, i) => {
      if (r.objectNumber && existingNumbers.has(r.objectNumber)) {
        errors.push({ index: i, message: `Objektnummer "${r.objectNumber}" finns redan` });
      } else {
        preview.push({ index: i, name: r.name });
      }
    });

    if (dryRun) {
      return res.json({ dryRun: true, valid: preview.length, invalid: errors.length, errors, preview });
    }
    if (errors.length > 0) {
      throw new ValidationError(`${errors.length} rader har fel — kör dryRun för detaljer`);
    }

    const childBatchId = `child-objects-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const childStartedBy = (req as any).user?.id || null;
    const created: string[] = [];
    const failures: Array<{ index: number; message: string }> = [];
    for (let i = 0; i < parsed.data.rows.length; i++) {
      const r = parsed.data.rows[i];
      try {
        const obj = await storage.createObject({
          tenantId,
          customerId: parent.customerId,
          parentId: parent.id,
          clusterId: parent.clusterId ?? null,
          name: r.name,
          objectNumber: r.objectNumber ?? null,
          objectType: r.objectType ?? parent.objectType ?? "byggnad",
          hierarchyLevel: r.hierarchyLevel ?? null,
          address: r.address ?? parent.address ?? null,
          city: r.city ?? parent.city ?? null,
          postalCode: r.postalCode ?? parent.postalCode ?? null,
          accessType: (r.accessType as any) ?? parent.accessType ?? null,
          accessCode: r.accessCode ?? parent.accessCode ?? null,
          importBatchId: childBatchId,
        } as any);
        created.push(obj.id);
      } catch (err: any) {
        failures.push({ index: i, message: err?.message || String(err) });
      }
    }

    // Skriv import_batches-rad så historikpanelen (Task #574) kan visa
    // föregående underobjekt-importer per parent-objekt.
    try {
      await db.insert(importBatches).values({
        tenantId,
        batchId: childBatchId,
        totalRows: parsed.data.rows.length,
        created: created.length,
        updated: 0,
        errors: failures.length,
        metadata: {
          type: "child-objects",
          status: failures.length > 0 ? "completed_with_errors" : "completed",
          parentObjectId: parent.id,
          parentObjectName: parent.name,
          startedBy: childStartedBy,
          filename: null,
          completedAt: new Date().toISOString(),
          sampleErrors: failures.slice(0, 20).map(f => `Rad ${f.index + 1}: ${f.message}`),
        },
      });
    } catch (err) {
      console.error(`[child-objects ${childBatchId}] kunde inte skriva import_batches-rad:`, err);
    }

    res.json({ dryRun: false, created: created.length, ids: created, batchId: childBatchId, errors: failures });
  }));
}
