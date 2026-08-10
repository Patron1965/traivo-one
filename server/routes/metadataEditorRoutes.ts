// ============================================================================
// Metadata-editor ("Metadata Lämnare") — API-routes (Task #956)
// ----------------------------------------------------------------------------
// Tre ytor:
//   * Admin (requireAdmin): CRUD på editorer + fält, samt mint av publik
//     signerad länk/QR-token.
//   * Planerare (requirePlanner): granskningskö — lista, visa, godkänn, avvisa.
//   * Publik (token-gated, rate-limitad): hämta editor-config, närliggande
//     objekt (GPS), foto-upload, samt inlämning (hamnar som "pending").
//
// Säkerhet: publika routes härleder ALLTID tenant/editor/objekt server-side från
// en HMAC-signerad token (server/dynamic-qr-token.ts) — aldrig från rå id i
// klienten. Inget värde skrivs till ett objekt förrän en planerare godkänner.
// ============================================================================

import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, RateLimitError } from "../errors";
import { formatZodError, verifyTenantOwnership } from "./helpers";
import { requireAdmin, requirePlanner } from "../tenant-middleware";
import {
  reporterConfigSchema,
  editorFieldConfigSchema,
  METADATA_EDITOR_TYPES,
  METADATA_EDITOR_FIELD_KINDS,
  type InsertMetadataEditor,
  type InsertMetadataEditorField,
  type InsertObject,
  type ReporterConfig,
} from "@shared/schema";
import {
  signMetadataEditorToken,
  verifyMetadataEditorToken,
} from "../dynamic-qr-token";
import { checkPublicReportRateLimit, getClientKeyForRequest } from "../public-report-rate-limit";
import { ObjectStorageService, ALLOWED_UPLOAD_MIME_TYPES } from "../replit_integrations/object_storage/objectStorage";
import { MAX_FIELD_PHOTO_SIZE_BYTES, MAX_FIELD_PHOTO_SIZE_MB } from "@shared/upload-limits";
import {
  provisionKatalogField,
  assertKatalogMappable,
  approveSubmission,
  rejectSubmission,
} from "../services/metadata-editor-service";
import { triggerGeocodeIfMissing } from "../services/geocoding";

// ---- Admin input-scheman ---------------------------------------------------

const fieldMappingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), metadataKatalogId: z.string().min(1) }),
  z.object({ mode: z.literal("new"), beteckning: z.string().max(30).optional().nullable() }),
]);

const editorFieldInputSchema = z.object({
  kind: z.enum(METADATA_EDITOR_FIELD_KINDS),
  label: z.string().min(1).max(200),
  helpText: z.string().max(1000).optional().nullable(),
  required: z.boolean().optional().default(false),
  sortOrder: z.number().int().optional(),
  fieldConfig: editorFieldConfigSchema.optional().nullable(),
  mapping: fieldMappingSchema,
});

const editorCreateSchema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(2000).optional().nullable(),
  type: z.enum(METADATA_EDITOR_TYPES),
  isActive: z.boolean().optional().default(true),
  reporterConfig: reporterConfigSchema,
  nearbyRadiusM: z.number().int().min(10).max(5000).optional().default(300),
  fields: z.array(editorFieldInputSchema).max(50).default([]),
});

const editorUpdateSchema = editorCreateSchema.partial();

type EditorFieldInput = z.infer<typeof editorFieldInputSchema>;

// Bygg fält-rader och provisionera nya katalogfält vid behov. Validerar att
// befintliga målfält är mappbara (ej system/beräknat/arkiverat).
async function buildFieldRows(
  tenantId: string,
  editorId: string,
  fields: EditorFieldInput[],
): Promise<InsertMetadataEditorField[]> {
  const rows: InsertMetadataEditorField[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    let metadataKatalogId: string;
    if (f.mapping.mode === "new") {
      const katalog = await provisionKatalogField({
        tenantId,
        label: f.label,
        kind: f.kind,
        beteckning: f.mapping.beteckning ?? null,
      });
      metadataKatalogId = katalog.id;
    } else {
      const katalog = await assertKatalogMappable(f.mapping.metadataKatalogId, tenantId);
      metadataKatalogId = katalog.id;
    }
    rows.push({
      editorId,
      tenantId,
      sortOrder: f.sortOrder ?? i,
      kind: f.kind,
      label: f.label,
      helpText: f.helpText ?? null,
      required: f.required ?? false,
      metadataKatalogId,
      fieldConfig: f.fieldConfig ?? null,
    });
  }
  return rows;
}

function publicEditorUrl(token: string): string {
  return `/metadata-form/${token}`;
}

export function registerMetadataEditorRoutes(app: Express) {
  // ==========================================================================
  // PLANERARE — granskningskö (registreras FÖRE /:id så "submissions" ej fångas)
  // ==========================================================================

  app.get("/api/metadata-editors/submissions", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = req.tenantId as string;
    const { editorId, objectId, status } = req.query as Record<string, string | undefined>;
    const submissions = await storage.getMetadataEditorSubmissions(tenantId, {
      editorId: editorId || undefined,
      objectId: objectId || undefined,
      status: status || undefined,
    });

    // Berika med editor- och objektnamn (batchade uppslag).
    const editors = await storage.getMetadataEditors(tenantId);
    const editorNameById = new Map(editors.map((e) => [e.id, e.name]));
    const objects = await storage.getObjects(tenantId);
    const objectNameById = new Map(objects.map((o) => [o.id, o.name]));

    res.json(submissions.map((s) => ({
      ...s,
      editorName: editorNameById.get(s.editorId) ?? null,
      objectName: s.objectId ? (objectNameById.get(s.objectId) ?? null) : null,
    })));
  }));

  app.get("/api/metadata-editors/submissions/:id", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = req.tenantId as string;
    const submission = await storage.getMetadataEditorSubmission(req.params.id, tenantId);
    if (!submission) throw new NotFoundError("Inlämningen hittades inte");

    const values = await storage.getMetadataEditorSubmissionValues(submission.id, tenantId);
    const fields = await storage.getMetadataEditorFields(submission.editorId, tenantId);
    const fieldById = new Map(fields.map((f) => [f.id, f]));
    const object = submission.objectId ? await storage.getObject(submission.objectId) : undefined;
    const editor = await storage.getMetadataEditor(submission.editorId, tenantId);

    res.json({
      submission,
      editor: editor ? { id: editor.id, name: editor.name, type: editor.type } : null,
      object: object ? { id: object.id, name: object.name, address: object.address } : null,
      values: values.map((v) => {
        const field = v.fieldId ? fieldById.get(v.fieldId) : undefined;
        return {
          ...v,
          fieldLabel: field?.label ?? null,
          fieldKind: field?.kind ?? null,
        };
      }),
    });
  }));

  app.post("/api/metadata-editors/submissions/:id/approve", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = req.tenantId as string;
    const reviewerId = (req as any).user?.claims?.sub ?? null;
    const reviewNotes = typeof req.body?.reviewNotes === "string" ? req.body.reviewNotes.slice(0, 2000) : null;
    const result = await approveSubmission({ submissionId: req.params.id, tenantId, reviewerId, reviewNotes });
    res.json({ ok: true, ...result });
  }));

  app.post("/api/metadata-editors/submissions/:id/reject", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = req.tenantId as string;
    const reviewerId = (req as any).user?.claims?.sub ?? null;
    const reviewNotes = typeof req.body?.reviewNotes === "string" ? req.body.reviewNotes.slice(0, 2000) : null;
    await rejectSubmission({ submissionId: req.params.id, tenantId, reviewerId, reviewNotes });
    res.json({ ok: true });
  }));

  // ==========================================================================
  // ADMIN — CRUD editorer + fält
  // ==========================================================================

  app.get("/api/metadata-editors", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = req.tenantId as string;
    const editors = await storage.getMetadataEditors(tenantId);
    res.json(editors);
  }));

  app.get("/api/metadata-editors/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = req.tenantId as string;
    const editor = await storage.getMetadataEditor(req.params.id, tenantId);
    if (!editor) throw new NotFoundError("Metadata-lämnaren hittades inte");
    const fields = await storage.getMetadataEditorFields(editor.id, tenantId);
    res.json({ editor, fields });
  }));

  app.post("/api/metadata-editors", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = req.tenantId as string;
    const createdBy = (req as any).user?.claims?.sub ?? null;
    const parsed = editorCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      const formatted = formatZodError(parsed.error);
      throw new ValidationError(formatted.error, formatted.details);
    }
    const data = parsed.data;

    const editorInsert: InsertMetadataEditor = {
      tenantId,
      name: data.name,
      description: data.description ?? null,
      type: data.type,
      isActive: data.isActive ?? true,
      reporterConfig: data.reporterConfig as ReporterConfig,
      nearbyRadiusM: data.nearbyRadiusM ?? 300,
      createdBy,
    };
    const editor = await storage.createMetadataEditor(editorInsert);

    const fieldRows = await buildFieldRows(tenantId, editor.id, data.fields ?? []);
    const fields = fieldRows.length > 0
      ? await storage.replaceMetadataEditorFields(editor.id, tenantId, fieldRows)
      : [];

    res.status(201).json({ editor, fields });
  }));

  app.patch("/api/metadata-editors/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = req.tenantId as string;
    const existing = await storage.getMetadataEditor(req.params.id, tenantId);
    if (!existing) throw new NotFoundError("Metadata-lämnaren hittades inte");

    const parsed = editorUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const formatted = formatZodError(parsed.error);
      throw new ValidationError(formatted.error, formatted.details);
    }
    const data = parsed.data;

    const patch: Partial<InsertMetadataEditor> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description ?? null;
    if (data.type !== undefined) patch.type = data.type;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    if (data.reporterConfig !== undefined) patch.reporterConfig = data.reporterConfig as ReporterConfig;
    if (data.nearbyRadiusM !== undefined) patch.nearbyRadiusM = data.nearbyRadiusM;

    const editor = Object.keys(patch).length > 0
      ? await storage.updateMetadataEditor(existing.id, tenantId, patch)
      : existing;

    let fields = await storage.getMetadataEditorFields(existing.id, tenantId);
    if (data.fields !== undefined) {
      const fieldRows = await buildFieldRows(tenantId, existing.id, data.fields);
      fields = await storage.replaceMetadataEditorFields(existing.id, tenantId, fieldRows);
    }

    res.json({ editor, fields });
  }));

  app.delete("/api/metadata-editors/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = req.tenantId as string;
    const existing = await storage.getMetadataEditor(req.params.id, tenantId);
    if (!existing) throw new NotFoundError("Metadata-lämnaren hittades inte");
    await storage.deleteMetadataEditor(existing.id, tenantId);
    res.json({ ok: true });
  }));

  // Mint publik signerad länk/QR-token. För object_specific krävs ?objectId=.
  app.get("/api/metadata-editors/:id/public-link", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = req.tenantId as string;
    const editor = await storage.getMetadataEditor(req.params.id, tenantId);
    if (!editor) throw new NotFoundError("Metadata-lämnaren hittades inte");

    let objectId: string | null = null;
    if (editor.type === "object_specific") {
      const requested = (req.query.objectId as string) || "";
      if (!requested) throw new ValidationError("objectId krävs för objektspecifika lämnare");
      const object = await storage.getObject(requested);
      if (!verifyTenantOwnership(object, tenantId)) throw new NotFoundError("Objektet hittades inte");
      objectId = requested;
    }

    const token = signMetadataEditorToken(tenantId, editor.id, objectId);
    res.json({ token, url: publicEditorUrl(token), objectId });
  }));

  // ==========================================================================
  // PUBLIK — token-gated (bypassar tenant-middleware via /api/public/-prefix)
  // ==========================================================================

  // GET config för publikt formulär.
  app.get("/api/public/metadata-editor", asyncHandler(async (req, res) => {
    const decoded = verifyMetadataEditorToken(req.query.t as string);
    if (!decoded) throw new NotFoundError("Ogiltig länk");
    const { tenantId, editorId, objectId } = decoded;

    const editor = await storage.getMetadataEditor(editorId, tenantId);
    if (!editor || !editor.isActive) return res.status(410).json({ error: "Denna länk är inte längre aktiv" });

    const fields = await storage.getMetadataEditorFields(editor.id, tenantId);

    let object: { id: string; name: string; address: string | null } | null = null;
    if (editor.type === "object_specific" && objectId) {
      const obj = await storage.getObject(objectId);
      if (verifyTenantOwnership(obj, tenantId) && obj) {
        object = { id: obj.id, name: obj.name, address: obj.address ?? null };
      }
    }

    // Branding för rubrik/logga.
    let branding: { companyName: string; primaryColor: string } | null = null;
    try {
      const { db } = await import("../db");
      const { tenantBranding } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [b] = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId));
      branding = { companyName: b?.companyName || "Fältservice", primaryColor: b?.primaryColor || "#1B4B6B" };
    } catch {
      branding = { companyName: "Fältservice", primaryColor: "#1B4B6B" };
    }

    res.json({
      editor: {
        id: editor.id,
        name: editor.name,
        description: editor.description,
        type: editor.type,
        reporterConfig: editor.reporterConfig,
        nearbyRadiusM: editor.nearbyRadiusM,
      },
      object,
      branding,
      fields: fields.map((f) => ({
        id: f.id,
        kind: f.kind,
        label: f.label,
        helpText: f.helpText,
        required: f.required,
        fieldConfig: f.fieldConfig,
      })),
    });
  }));

  // GET närliggande objekt (endast GPS-typ).
  app.get("/api/public/metadata-editor/nearby", asyncHandler(async (req, res) => {
    const decoded = verifyMetadataEditorToken(req.query.t as string);
    if (!decoded) throw new NotFoundError("Ogiltig länk");
    const { tenantId, editorId } = decoded;

    const editor = await storage.getMetadataEditor(editorId, tenantId);
    if (!editor || !editor.isActive) return res.status(410).json({ error: "Denna länk är inte längre aktiv" });
    if (editor.type !== "gps") throw new ValidationError("Denna lämnare stödjer inte platssökning");

    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new ValidationError("Giltig position (lat/lng) krävs");
    }
    const radiusMeters = editor.nearbyRadiusM || 300;

    const { haversineDistanceKm } = await import("../distance-matrix-service");
    const objects = await storage.getObjects(tenantId);
    const nearby = objects
      .filter((o) => typeof o.latitude === "number" && typeof o.longitude === "number")
      .map((o) => ({
        id: o.id,
        name: o.name,
        address: o.address,
        distanceMeters: Math.round(haversineDistanceKm(lat, lng, o.latitude as number, o.longitude as number) * 1000),
      }))
      .filter((o) => o.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 25);

    res.json({ radiusMeters, objects: nearby });
  }));

  // POST foto-upload-URL (token-gated + rate-limitad).
  app.post("/api/public/metadata-editor/upload-url", asyncHandler(async (req, res) => {
    const rateCheck = checkPublicReportRateLimit(getClientKeyForRequest(req));
    if (!rateCheck.allowed) {
      res.set("Retry-After", String(rateCheck.retryAfterSeconds || 60));
      throw new RateLimitError("För många uppladdningar från denna enhet. Vänta en stund och försök igen.");
    }
    const decoded = verifyMetadataEditorToken(req.body?.t);
    if (!decoded) throw new NotFoundError("Ogiltig länk");

    const schema = z.object({
      t: z.string().min(1),
      name: z.string().min(1).max(255),
      size: z.number().int().positive().optional(),
      contentType: z.string().min(1).max(100),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const formatted = formatZodError(parsed.error);
      throw new ValidationError(formatted.error, formatted.details);
    }
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(parsed.data.contentType)) {
      throw new ValidationError("Filtypen tillåts inte. Endast bilder och PDF är tillåtna.");
    }
    if (parsed.data.size !== undefined && parsed.data.size > MAX_FIELD_PHOTO_SIZE_BYTES) {
      res.status(413).json({ error: `Bilden är för stor. Maxgräns är ${MAX_FIELD_PHOTO_SIZE_MB} MB.` });
      return;
    }

    const objectStorageService = new ObjectStorageService();
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json({ uploadURL, objectPath });
  }));

  // POST bekräfta uppladdning → sätt tenant-ACL (härledd server-side från token).
  app.post("/api/public/metadata-editor/confirm-upload", asyncHandler(async (req, res) => {
    const decoded = verifyMetadataEditorToken(req.body?.t);
    if (!decoded) throw new NotFoundError("Ogiltig länk");

    const objectPath = req.body?.objectPath;
    if (!objectPath || typeof objectPath !== "string") throw new ValidationError("objectPath krävs");
    if (!/^\/objects\/[a-zA-Z0-9/_-]+$/.test(objectPath)) throw new ValidationError("Ogiltig objektsökväg");

    const objectStorageService = new ObjectStorageService();
    await objectStorageService.validateUploadedFileAndSetAcl(
      objectPath,
      `tenant:${decoded.tenantId}`,
      "private",
      MAX_FIELD_PHOTO_SIZE_BYTES,
    );
    res.json({ confirmed: true, objectPath });
  }));

  // POST inlämning → skapas som "pending" i granskningskön. Inget skrivs till
  // objektet förrän en planerare godkänner.
  app.post("/api/public/metadata-editor/submit", asyncHandler(async (req, res) => {
    const rateCheck = checkPublicReportRateLimit(getClientKeyForRequest(req));
    if (!rateCheck.allowed) {
      res.set("Retry-After", String(rateCheck.retryAfterSeconds || 60));
      throw new RateLimitError("För många inlämningar från denna enhet. Vänta en stund och försök igen.");
    }

    const submitSchema = z.object({
      t: z.string().min(1),
      objectId: z.string().optional().nullable(),
      newObject: z.object({
        name: z.string().min(1).max(200),
        address: z.string().max(500).optional().nullable(),
        latitude: z.number().min(-90).max(90).optional().nullable(),
        longitude: z.number().min(-180).max(180).optional().nullable(),
      }).optional().nullable(),
      reporter: z.object({
        name: z.string().max(200).optional().nullable(),
        title: z.string().max(200).optional().nullable(),
        organization: z.string().max(200).optional().nullable(),
        email: z.string().max(200).optional().nullable(),
        phone: z.string().max(50).optional().nullable(),
      }).optional().default({}),
      latitude: z.number().min(-90).max(90).optional().nullable(),
      longitude: z.number().min(-180).max(180).optional().nullable(),
      values: z.array(z.object({
        fieldId: z.string().min(1),
        valueText: z.string().max(5000).optional().nullable(),
        valueNumber: z.number().optional().nullable(),
        photoPaths: z.array(z.string().max(2048)).max(20).optional(),
      })).max(50).default([]),
    });
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      const formatted = formatZodError(parsed.error);
      throw new ValidationError(formatted.error, formatted.details);
    }
    const body = parsed.data;

    const decoded = verifyMetadataEditorToken(body.t);
    if (!decoded) throw new NotFoundError("Ogiltig länk");
    const { tenantId, editorId, objectId: tokenObjectId } = decoded;

    const editor = await storage.getMetadataEditor(editorId, tenantId);
    if (!editor || !editor.isActive) return res.status(410).json({ error: "Denna länk är inte längre aktiv" });

    const fields = await storage.getMetadataEditorFields(editor.id, tenantId);
    const fieldById = new Map(fields.map((f) => [f.id, f]));

    // --- Validera avsändarfält mot reporterConfig ---
    const rc = editor.reporterConfig as ReporterConfig;
    const reporter = body.reporter ?? {};
    const reporterKeyMap: Record<keyof ReporterConfig, string | null | undefined> = {
      name: reporter.name,
      title: reporter.title,
      organization: reporter.organization,
      email: reporter.email,
      phone: reporter.phone,
    };
    for (const key of Object.keys(rc) as (keyof ReporterConfig)[]) {
      const cfg = rc[key];
      const value = reporterKeyMap[key];
      if (cfg?.required && (!value || !value.trim())) {
        throw new ValidationError(`Avsändarfältet "${key}" är obligatoriskt`);
      }
    }

    // --- Bestäm objekt ---
    let objectId: string;
    let createdInterimObject = false;
    if (editor.type === "object_specific") {
      if (!tokenObjectId) throw new ValidationError("Länken saknar objektkoppling");
      objectId = tokenObjectId;
    } else if (editor.type === "gps") {
      if (!body.objectId) throw new ValidationError("Du måste välja ett objekt");
      const obj = await storage.getObject(body.objectId);
      if (!verifyTenantOwnership(obj, tenantId)) throw new NotFoundError("Objektet hittades inte");
      objectId = body.objectId;
    } else {
      // object_creating → skapa interim-objekt ("Rapporterat objekt")
      if (!body.newObject?.name) throw new ValidationError("Objektnamn krävs");
      const insertData: InsertObject = {
        tenantId,
        parentId: null,
        name: body.newObject.name,
        address: body.newObject.address ?? null,
        latitude: body.newObject.latitude ?? body.latitude ?? null,
        longitude: body.newObject.longitude ?? body.longitude ?? null,
        isInterimObject: true,
        status: "active",
      };
      const interim = await storage.createObject(insertData);
      objectId = interim.id;
      createdInterimObject = true;
      // Task #1486: klassificering skrivs som metadata (kolumnerna är rivna).
      const { scheduleClassificationMirror } = await import("../services/object-classification");
      scheduleClassificationMirror(tenantId, interim.id, { objectType: "fastighet" });
      triggerGeocodeIfMissing(interim.id);
    }

    // --- Validera + bygg värden ---
    for (const field of fields) {
      if (!field.required) continue;
      const v = body.values.find((x) => x.fieldId === field.id);
      const hasValue =
        (field.kind === "photo" && (v?.photoPaths?.length ?? 0) > 0) ||
        (field.kind === "rating" && v?.valueNumber !== undefined && v?.valueNumber !== null) ||
        (field.kind === "text" && !!v?.valueText && v.valueText.trim().length > 0);
      if (!hasValue) throw new ValidationError(`Fältet "${field.label}" är obligatoriskt`);
    }

    const submission = await storage.createMetadataEditorSubmission({
      editorId: editor.id,
      tenantId,
      objectId,
      status: "pending",
      reporterName: reporter.name ?? null,
      reporterTitle: reporter.title ?? null,
      reporterOrganization: reporter.organization ?? null,
      reporterEmail: reporter.email ?? null,
      reporterPhone: reporter.phone ?? null,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      ipAddress: getClientKeyForRequest(req),
      userAgent: (req.headers["user-agent"] as string)?.slice(0, 500) ?? null,
      createdInterimObject,
    });

    for (const v of body.values) {
      const field = fieldById.get(v.fieldId);
      if (!field) continue; // okänt fält → ignorera
      let valueJson: unknown = null;
      let photoPaths: string[] | null = null;
      if (field.kind === "photo") {
        photoPaths = (v.photoPaths ?? []).filter((p) => /^\/objects\/[a-zA-Z0-9/_-]+$/.test(p));
        if (photoPaths.length === 0) continue;
      } else if (field.kind === "rating") {
        if (v.valueNumber === undefined || v.valueNumber === null) continue;
        valueJson = v.valueNumber;
      } else {
        if (!v.valueText || !v.valueText.trim()) continue;
        valueJson = v.valueText.trim();
      }
      await storage.createMetadataEditorSubmissionValue({
        submissionId: submission.id,
        fieldId: field.id,
        tenantId,
        metadataKatalogId: field.metadataKatalogId ?? null,
        valueJson: valueJson as string | number | null,
        photoPaths,
      });
    }

    res.status(201).json({ ok: true, submissionId: submission.id });
  }));
}
