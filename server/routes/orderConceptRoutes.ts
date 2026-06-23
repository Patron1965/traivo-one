import type { Express } from "express";
import { storage } from "../storage";
import { invalidateWorkflowCaches } from "../services/dashboardCache";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import { objects, workOrders, customerCommunications, objectContacts, orderConceptArticles, orderConceptObjects, articleObjectMappings, conceptFilters, priceLists, objectMetadata, metadataDefinitions, deliverySchedules, assignments as assignmentsTable, articles, type InsertOrderConceptArticle } from "@shared/schema";
import { getISOWeek, getStartOfISOWeek, getDateFromWeekdayInMonth } from "./helpers";
import { getOrderConceptMethod } from "@shared/order-concept-method";
import { computeConceptOrderValue } from "@shared/order-concept-value";
import { buildScheduleDateTargets } from "../services/order-concept-schedule";
import {
  resolveTimeWarningThresholds,
  computeLeadTimeWarnings,
  computeScheduleWarnings,
  type LeadTimeItem,
} from "../services/time-warnings";
import OpenAI from "openai";
import {
  resolveTargetObjects,
  filterObjectsByConditions,
  evaluateConditionsForObject,
  resolveConceptMatchingObjects,
  deriveConceptTargets,
} from "../services/order-concept-targeting";
import {
  buildCustomerLookup,
  resolveConceptCustomerForObject,
} from "../services/concept-customer-resolver";
import {
  resolveActiveArticle,
  resolveConceptArticleHits,
  isFixedPriceConcept,
  computeObjectValueOre,
  fixedPriceWoDivisor,
} from "../services/order-concept-article-hits";
import {
  resolveObjectInvoiceRefs,
  formatEnrichedDescription,
} from "../services/invoice-line-enrichment";

const openaiClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Inpekning (vilka objekt/grenar ett koncept pekar in) + operator-matchning för
// villkorsfilter lever i ../services/order-concept-targeting så förhandsvisning,
// execute och alla körnings-/beräkningsvägar matchar IDENTISKT (ADR v3, steg 4).

export async function registerOrderConceptRoutes(app: Express) {
// ============================================
// ORDER CONCEPT WIZARD API
// ============================================

app.get("/api/order-concepts/:id/wizard", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

    const { orderConceptObjects: oco } = await import("@shared/schema");
    const enrichedConceptObjectsPromise = db
      .select({
        id: oco.id,
        orderConceptId: oco.orderConceptId,
        objectId: oco.objectId,
        metadataSnapshot: oco.metadataSnapshot,
        included: oco.included,
        sortOrder: oco.sortOrder,
        createdAt: oco.createdAt,
        objectName: objects.name,
        objectAddress: objects.address,
        objectType: objects.objectType,
      })
      .from(oco)
      .leftJoin(objects, eq(oco.objectId, objects.id))
      .where(eq(oco.orderConceptId, concept.id))
      .orderBy(oco.sortOrder);
    const [conceptObjects, conceptArticles, mappings, invoiceConfig, documentConfigs, schedules, filters] = await Promise.all([
      enrichedConceptObjectsPromise,
      storage.getOrderConceptArticles(concept.id),
      storage.getArticleObjectMappings(concept.id),
      storage.getInvoiceConfiguration(concept.id),
      storage.getDocumentConfigurations(concept.id),
      storage.getDeliverySchedules(concept.id),
      storage.getConceptFilters(concept.id),
    ]);

    res.json({
      ...concept,
      conceptObjects,
      conceptArticles,
      mappings,
      invoiceConfig,
      documentConfigs,
      schedules,
      filters,
    });
}));

app.get("/api/order-concepts/:id/objects", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const { orderConceptObjects: oco } = await import("@shared/schema");
    const rows = await db
      .select({
        id: oco.id,
        orderConceptId: oco.orderConceptId,
        objectId: oco.objectId,
        metadataSnapshot: oco.metadataSnapshot,
        included: oco.included,
        sortOrder: oco.sortOrder,
        createdAt: oco.createdAt,
        objectName: objects.name,
        objectAddress: objects.address,
        objectType: objects.objectType,
      })
      .from(oco)
      .leftJoin(objects, eq(oco.objectId, objects.id))
      .where(eq(oco.orderConceptId, req.params.id))
      .orderBy(oco.sortOrder);
    res.json(rows);
}));

app.post("/api/order-concepts/:id/objects", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const { objectIds } = req.body;
    if (!Array.isArray(objectIds) || objectIds.length === 0) {
      throw new ValidationError("objectIds krävs");
    }
    const validRows = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(
        eq(objects.tenantId, tenantId),
        isNull(objects.deletedAt),
        inArray(objects.id, objectIds)
      ));
    const validObjectIds = validRows.map(r => r.id);
    if (validObjectIds.length === 0) {
      throw new ValidationError("Inga giltiga objekt hittades");
    }
    const inserts = validObjectIds.map((objectId: string) => ({
      orderConceptId: req.params.id,
      objectId,
    }));
    const result = await storage.addOrderConceptObjects(inserts);
    await storage.updateOrderConcept(req.params.id, tenantId, { totalObjects: (await storage.getOrderConceptObjects(req.params.id)).length });
    res.status(201).json(result);
}));

app.delete("/api/order-concepts/:id/objects/:objectId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    await storage.removeOrderConceptObject(req.params.id, req.params.objectId);
    await storage.updateOrderConcept(req.params.id, tenantId, { totalObjects: (await storage.getOrderConceptObjects(req.params.id)).length });
    res.status(204).send();
}));

app.get("/api/order-concepts/:id/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const arts = await storage.getOrderConceptArticles(req.params.id);
    res.json(arts);
}));

app.post("/api/order-concepts/:id/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const { articleId, quantity, unitPrice, taskCategory, metadataAssociation, metadataCorrespondence, isPreTask, dependencyOffsetMinutes } = req.body;
    if (!articleId || typeof articleId !== "string") {
      throw new ValidationError("articleId krävs");
    }
    const tenantArticles = await storage.getArticles(tenantId);
    if (!tenantArticles.find(a => a.id === articleId)) {
      throw new ValidationError("Artikeln hittades inte");
    }
    // Task #381 — uppgiftskategori styr om artikeln expanderas per objekt eller skapar admin-WO.
    const validCategory = (taskCategory === "admin" || taskCategory === "logistics" || taskCategory === "field")
      ? taskCategory : "field";
    const result = await storage.addOrderConceptArticle({
      orderConceptId: req.params.id,
      articleId,
      quantity: quantity || 1,
      unitPrice: unitPrice ?? null,
      taskCategory: validCategory,
      // Session 9B — metadataassociation/-korrespondens, föruppgift & beroende-offset.
      ...(typeof metadataAssociation === "string" ? { metadataAssociation } : {}),
      ...(typeof metadataCorrespondence === "string" ? { metadataCorrespondence } : {}),
      ...(typeof isPreTask === "boolean" ? { isPreTask } : {}),
      ...(typeof dependencyOffsetMinutes === "number" ? { dependencyOffsetMinutes } : {}),
    });
    const allArticles = await storage.getOrderConceptArticles(req.params.id);
    await storage.updateOrderConcept(req.params.id, tenantId, { totalArticles: allArticles.length });
    res.status(201).json(result);
}));

app.patch("/api/order-concepts/:id/articles/:articleId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const allowed: Partial<InsertOrderConceptArticle> = {};
    if (typeof req.body.quantity === "number") allowed.quantity = req.body.quantity;
    if (req.body.unitPrice === null || typeof req.body.unitPrice === "number") allowed.unitPrice = req.body.unitPrice;
    if (req.body.quantityModeOverride === null || typeof req.body.quantityModeOverride === "string") {
      const v = req.body.quantityModeOverride;
      const ALLOWED_QUANTITY_MODES = new Set([
        "per_styck",
        "single_per_task",
        "group",
        "matches_field",
        "use_object_quantity", // legacy, back-compat
      ]);
      if (v === null || ALLOWED_QUANTITY_MODES.has(v)) {
        allowed.quantityModeOverride = v;
      } else {
        throw new ValidationError("Ogiltigt quantityModeOverride");
      }
    }
    // Session 9B — metadataassociation/-korrespondens, föruppgift & beroende-offset.
    if (req.body.metadataAssociation === null || typeof req.body.metadataAssociation === "string") allowed.metadataAssociation = req.body.metadataAssociation;
    if (req.body.metadataCorrespondence === null || typeof req.body.metadataCorrespondence === "string") allowed.metadataCorrespondence = req.body.metadataCorrespondence;
    if (typeof req.body.isPreTask === "boolean") allowed.isPreTask = req.body.isPreTask;
    if (req.body.dependencyOffsetMinutes === null || typeof req.body.dependencyOffsetMinutes === "number") allowed.dependencyOffsetMinutes = req.body.dependencyOffsetMinutes;
    const updated = await storage.updateOrderConceptArticle(req.params.articleId, req.params.id, allowed);
    if (!updated) throw new NotFoundError("Artikelrad hittades inte");
    res.json(updated);
}));

app.delete("/api/order-concepts/:id/articles/:articleId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    await storage.removeOrderConceptArticle(req.params.articleId, req.params.id);
    const allArticles = await storage.getOrderConceptArticles(req.params.id);
    await storage.updateOrderConcept(req.params.id, tenantId, { totalArticles: allArticles.length });
    res.status(204).send();
}));

app.get("/api/order-concepts/:id/article-mappings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const mappings = await storage.getArticleObjectMappings(req.params.id);
    res.json(mappings);
}));

const articleMappingSchema = z.object({
  orderConceptArticleId: z.string().min(1),
  orderConceptObjectId: z.string().min(1),
  quantity: z.number().positive().optional().default(1),
});

app.post("/api/order-concepts/:id/article-mappings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const parsed = articleMappingSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error));
    const result = await storage.createArticleObjectMapping(parsed.data);
    res.status(201).json(result);
}));

app.post("/api/order-concepts/:id/article-mappings/auto", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");

    const orderConceptId = req.params.id;

    await db.transaction(async (tx) => {
      const artIds = await tx.select({ id: orderConceptArticles.id })
        .from(orderConceptArticles)
        .where(eq(orderConceptArticles.orderConceptId, orderConceptId));
      if (artIds.length > 0) {
        await tx.delete(articleObjectMappings)
          .where(inArray(articleObjectMappings.orderConceptArticleId, artIds.map(a => a.id)));
      }

      // Respektera quantity_mode (artikel eller orderkoncept-override):
      //  - single_per_task → tvingad 1
      //  - group → fast multipel (group_size)
      //  - matches_field → faller tillbaka på a.quantity här (ELSE); det verkliga
      //    metadatavärdet (ärvningsmedvetet) upplöses vid order-expansion, inte i
      //    denna förhandsmappning.
      //  - per_styck (Task #834) / use_object_quantity (legacy) / configurable (legacy)
      //    → a.quantity (bas-kvantitet), i linje med computeArticleQuantity.
      await tx.execute(sql`
        INSERT INTO article_object_mappings (id, order_concept_article_id, order_concept_object_id, quantity, created_at)
        SELECT gen_random_uuid(), a.id, o.id,
          CASE
            WHEN COALESCE(a.quantity_mode_override, art.quantity_mode, 'per_styck') = 'single_per_task' THEN 1
            WHEN COALESCE(a.quantity_mode_override, art.quantity_mode, 'per_styck') = 'group' THEN GREATEST(COALESCE(art.group_size, 1), 1)
            ELSE COALESCE(a.quantity, 1)
          END,
          NOW()
        FROM order_concept_articles a
        INNER JOIN articles art ON art.id = a.article_id
        CROSS JOIN order_concept_objects o
        WHERE a.order_concept_id = ${orderConceptId}
          AND o.order_concept_id = ${orderConceptId}
          AND o.included = true
      `);
    });

    const countResult = await db.execute(sql`
      SELECT count(*)::int as cnt FROM article_object_mappings aom
      INNER JOIN order_concept_articles oca ON aom.order_concept_article_id = oca.id
      WHERE oca.order_concept_id = ${orderConceptId}
    `);
    const mappingsCreated = (countResult.rows as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    res.json({ mappingsCreated });
}));

app.put("/api/order-concepts/:id/invoice-config", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const result = await storage.upsertInvoiceConfiguration({
      orderConceptId: req.params.id,
      ...req.body,
    });
    res.json(result);
}));

app.put("/api/order-concepts/:id/documents", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const { documents } = req.body;
    const configs = (documents || []).map((d: any) => ({
      orderConceptId: req.params.id,
      ...d,
    }));
    const result = await storage.upsertDocumentConfigurations(req.params.id, configs);
    res.json(result);
}));

app.put("/api/order-concepts/:id/delivery", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(rawConcept, tenantId)) throw new NotFoundError("Ej hittad");
    const { deliveryModel, schedules: scheduleData, ...conceptData } = req.body;

    if (deliveryModel) {
      await storage.updateOrderConcept(req.params.id, tenantId, { deliveryModel, ...conceptData });
    }

    if (scheduleData) {
      const schedulesWithId = scheduleData.map((s: any) => ({
        orderConceptId: req.params.id,
        ...s,
      }));
      await storage.upsertDeliverySchedules(req.params.id, schedulesWithId);
    }

    const updatedConcept = await storage.getOrderConcept(req.params.id);
    const updatedSchedules = await storage.getDeliverySchedules(req.params.id);
    res.json({ concept: updatedConcept, schedules: updatedSchedules });
}));

app.post("/api/order-concepts/:id/validate", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Ej hittad");

    const errors: { code: string; message: string }[] = [];
    const warnings: { code: string; message: string }[] = [];

    const conceptArticles = await storage.getOrderConceptArticles(concept.id);

    // Task #1052: "Inga objekt valda" ska spegla VERKLIGHETEN — antalet objekt som
    // faktiskt matchar inpekning + villkorsfilter (samma motor som /execute och
    // sidofältet), inte den avvecklade order_concept_objects-tabellen (tom i ADR v3).
    // fallbackAllObjects:false ⇒ ingen inpekning = 0 träffar = blockerande fel.
    const noObjectFilters = await storage.getConceptFilters(concept.id);
    const noObjectFilterInputs = noObjectFilters.map((f: any) => ({
      metadataKey: f.metadataKey,
      operator: f.operator,
      filterValue: f.filterValue,
    }));
    const { matchingObjects: validateMatchedObjects } = await resolveConceptMatchingObjects(
      tenantId,
      concept as any,
      noObjectFilterInputs,
      { fallbackAllObjects: false },
    );

    if (!concept.name) errors.push({ code: "MISSING_NAME", message: "Namn saknas" });
    if (validateMatchedObjects.length === 0) errors.push({ code: "NO_OBJECTS", message: "Inga objekt valda" });
    if (conceptArticles.length === 0) errors.push({ code: "NO_ARTICLES", message: "Inga artiklar valda" });
    // Task #974: fakturanivå är inte längre ett operatörsval (alltid kundnivå) — ingen
    // NO_INVOICE_LEVEL-varning. Ett ev. fakturastopp delar bara upp fakturan organisatoriskt.

    // Task #934: validera per faktureringsmetod (invoiceModel m. fallback scenario).
    const validateMethod = getOrderConceptMethod(concept);
    if (validateMethod === "schedule") {
      const schedules = await storage.getDeliverySchedules(concept.id);
      const hasInterval = !!concept.intervalStartDate && !!concept.intervalFrequencyDays && Number(concept.intervalFrequencyDays) > 0;
      if (schedules.length === 0 && !hasInterval) {
        warnings.push({ code: "NO_SCHEDULES", message: "Inget leveransschema eller intervall definierat" });
      }
    }

    if (validateMethod === "subscription" && !concept.monthlyFee) {
      warnings.push({ code: "NO_MONTHLY_FEE", message: "Månadsavgift saknas" });
    }

    // ADR v3 §2.3 (Task #556): Konfliktvarning för fakturamottagare.
    // Task #974: fakturanivå är alltid kundnivå — vi skickar ingen nivå-hint längre,
    // så ingen falsk hint-konflikt eller "ingen mottagare hittades"-varning. Resolvern
    // hittar närmaste mottagare i kundhierarkin (Fortnox har dessutom fallback till
    // object_payers/customers.fortnoxCustomerId). Enda kvarvarande blockeraren är en
    // äkta samma-prioritet-konflikt mellan explicita mottagare på samma nivå.
    let invoiceRecipient: { recipient: any; sourceCustomerId: string | null; sourceLevel: string | null; conflicts: any[]; hintConflict: boolean; hasConflict: boolean; chain: any[] } | null = null;
    if (concept.customerId) {
      const resolved = await storage.resolveInvoiceRecipient(tenantId, concept.customerId, {
        hintLevel: null,
      });
      invoiceRecipient = resolved as any;
      if (resolved.conflicts.length > 1) {
        errors.push({
          code: "INVOICE_RECIPIENT_CONFLICT",
          message: `Flera fakturamottagare har samma prioritet på nivån "${resolved.sourceLevel}" (${resolved.conflicts.length} kandidater). Välj en explicit innan konceptet expanderas.`,
        });
      }
    }

    // Task #937: FROM_METADATA — validera att order-/faktureringskund kan härledas
    // per objekt INNAN expansion. Vi kör samma resolver som /execute över exakt samma
    // matchande objekt-mängd (resolveConceptMatchingObjects), så att valideringen speglar
    // vad körningen kommer att göra. Saknat fält/ovärde/omatchat/tvetydigt = errors
    // (blockerar expansion); validering muterar aldrig något.
    // Spegla execution EXAKT: pre-passet körs enbart för icke-subscription
    // (/execute: runPrePass = conceptMethod !== "subscription"). Subscription-koncept
    // får därför aldrig blockeras här på kund-härledning. Fältet trimmas — ett
    // blanksteg-värde räknas som "inget fält valt" (precis som resolverns no_field).
    if (concept.customerMode === "FROM_METADATA" && validateMethod !== "subscription") {
      const customerField = concept.customerMetadataField?.trim();
      if (!customerField) {
        errors.push({
          code: "FROM_METADATA_NO_FIELD",
          message: 'Läget "Från objektets metadata" är valt men inget metadatafält för kund är angivet. Välj fältet i steg 1.',
        });
      } else {
        const filters = await storage.getConceptFilters(concept.id);
        const filterInputs = filters.map((f: any) => ({
          metadataKey: f.metadataKey,
          operator: f.operator,
          filterValue: f.filterValue,
        }));
        const { matchingObjects } = await resolveConceptMatchingObjects(
          tenantId,
          concept as any,
          filterInputs,
          { fallbackAllObjects: true },
        );
        const customers = await storage.getCustomers(tenantId);
        const lookup = buildCustomerLookup(customers);
        let missingValue = 0;
        const unmatched: string[] = [];
        let ambiguous = 0;
        for (const obj of matchingObjects) {
          const r = await resolveConceptCustomerForObject(tenantId, concept, obj.id, lookup);
          if (r.status === "missing_value") missingValue++;
          else if (r.status === "unmatched") unmatched.push(r.rawValue);
          else if (r.status === "ambiguous") ambiguous++;
        }
        if (missingValue > 0) {
          errors.push({
            code: "FROM_METADATA_MISSING_VALUE",
            message: `${missingValue} av ${matchingObjects.length} objekt saknar värde i fältet "${customerField}".`,
          });
        }
        if (unmatched.length > 0) {
          errors.push({
            code: "FROM_METADATA_UNMATCHED",
            message: `${unmatched.length} objekt har ett kundvärde som inte matchar någon kund (t.ex. "${unmatched[0]}"). Kontrollera kundnummer/namn.`,
          });
        }
        if (ambiguous > 0) {
          errors.push({
            code: "FROM_METADATA_AMBIGUOUS",
            message: `${ambiguous} objekt matchar flera kunder på namn (tvetydigt). Använd kundnummer eller unika kundnamn.`,
          });
        }
      }
    }

    // Task #836 (Fas 3): Tidskonflikt-varningar vid validering (före expansion).
    // Här kan vi rimligt kontrollera ledtid mot leveransdatum samt flagga
    // beroendeartiklar som kräver kvittens. Schemaläggnings-varningar (överlapp,
    // restid, okvitterad beroendeuppgift) beräknas på faktiska assignments via
    // GET /api/order-concepts/:id/time-warnings efter expansion.
    const tenant = await storage.getTenant(tenantId);
    const thresholds = resolveTimeWarningThresholds(tenant?.settings);
    const deliveryDate = concept.nextRunDate ?? null;
    const leadItems: LeadTimeItem[] = [];
    for (const ca of conceptArticles) {
      const art = await storage.getArticle(ca.articleId);
      if (!art) continue;
      if (deliveryDate && art.leadTimeDays) {
        leadItems.push({ articleName: art.name, leadTimeDays: art.leadTimeDays, deliveryDate });
      }
      if (art.requiresAcknowledgment) {
        warnings.push({
          code: "DEPENDENCY_REQUIRES_ACK",
          message: `Artikeln "${art.name}" är en beroendeartikel — dess tillgänglighet måste kvitteras innan huvuduppgiften kan utföras.`,
        });
      }
    }
    for (const w of computeLeadTimeWarnings(leadItems, thresholds)) {
      warnings.push({ code: w.code, message: w.message });
    }

    res.json({ valid: errors.length === 0, errors, warnings, invoiceRecipient });
}));

// Task #836 (Fas 3): Schemaläggnings-varningar beräknade på faktiska assignments
// (efter expansion). Upptäcker överlappande tidsfönster, otillräcklig restid och
// okvitterade beroendeuppgifter per resurs. Trösklar konfigureras per tenant via
// `tenants.settings.timeWarnings`.
app.get("/api/order-concepts/:id/time-warnings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Ej hittad");

    const tenant = await storage.getTenant(tenantId);
    const thresholds = resolveTimeWarningThresholds(tenant?.settings);

    const allAssignments = await storage.getAssignments(tenantId);
    const conceptAssignments = allAssignments.filter((a) => a.orderConceptId === concept.id);

    const warnings = computeScheduleWarnings(
      conceptAssignments.map((a) => ({
        id: a.id,
        title: a.title,
        scheduledDate: a.scheduledDate,
        estimatedDuration: a.estimatedDuration,
        resourceId: a.resourceId,
        requiresAcknowledgment: a.requiresAcknowledgment,
        dependencyAcknowledgedAt: a.dependencyAcknowledgedAt,
        dependencyCriticality: a.dependencyCriticality,
      })),
      thresholds,
    );

    res.json({ thresholds, warnings, taskCount: conceptAssignments.length });
}));

// ============================================
// TASK DEPENDENCY TEMPLATES API
// ============================================

app.get("/api/task-dependency-templates", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { articleId } = req.query;
    const templates = await storage.getTaskDependencyTemplates(tenantId, articleId as string | undefined);
    res.json(templates);
}));

app.get("/api/task-dependency-templates/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const template = await storage.getTaskDependencyTemplate(req.params.id);
    if (!template || template.tenantId !== tenantId) {
      throw new NotFoundError("Beroendemall hittades inte");
    }
    res.json(template);
}));

app.post("/api/task-dependency-templates", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const template = await storage.createTaskDependencyTemplate({ ...req.body, tenantId });
    res.status(201).json(template);
}));

app.put("/api/task-dependency-templates/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const updated = await storage.updateTaskDependencyTemplate(req.params.id, tenantId, req.body);
    if (!updated) throw new NotFoundError("Beroendemall hittades inte");
    res.json(updated);
}));

app.delete("/api/task-dependency-templates/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteTaskDependencyTemplate(req.params.id, tenantId);
    res.json({ success: true });
}));

app.post("/api/work-orders/:id/generate-dependent-tasks", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const workOrder = await storage.getWorkOrder(req.params.id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    const templates = await storage.getTaskDependencyTemplates(tenantId, workOrder.articleId || undefined);
    if (templates.length === 0) {
      return res.json({ created: 0, message: "Inga beroendemallar konfigurerade för denna artikel" });
    }

    const created = [];
    for (const template of templates) {
      const scheduledDate = workOrder.scheduledDate ? new Date(workOrder.scheduledDate) : new Date();
      const offsetMs = (template.timeOffsetHours || 0) * 60 * 60 * 1000;
      const childScheduled = new Date(scheduledDate.getTime() + offsetMs);

      const childWo = await storage.createWorkOrder({
        tenantId,
        articleId: template.dependentArticleId,
        objectId: workOrder.objectId,
        customerId: workOrder.customerId,
        scheduledDate: childScheduled,
        status: template.dependencyType === "before" ? "pending" : "locked",
        executionStatus: "not_started",
        priority: workOrder.priority,
        description: `Beroende uppgift (${template.dependencyType === "before" ? "före" : "efter"})`,
        creationMethod: "auto_dependency",
      });

      const instance = await storage.createTaskDependencyInstance({
        tenantId,
        parentWorkOrderId: workOrder.id,
        childWorkOrderId: childWo.id,
        dependencyType: template.dependencyType,
        scheduledAt: childScheduled,
        completed: false,
      });

      created.push({ workOrder: childWo, instance });
    }

    res.json({ created: created.length, tasks: created });
}));

app.get("/api/task-dependency-instances", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { parentWorkOrderId } = req.query;
    const instances = await storage.getTaskDependencyInstances(tenantId, parentWorkOrderId as string | undefined);
    res.json(instances);
}));

// ============================================
// INVOICE RULES API
// ============================================

app.get("/api/invoice-rules", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { orderConceptId } = req.query;
    const rules = await storage.getInvoiceRules(tenantId, orderConceptId as string | undefined);
    res.json(rules);
}));

app.post("/api/invoice-rules", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rule = await storage.createInvoiceRule({ ...req.body, tenantId });
    res.status(201).json(rule);
}));

app.put("/api/invoice-rules/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const updated = await storage.updateInvoiceRule(req.params.id, tenantId, req.body);
    if (!updated) throw new NotFoundError("Faktureringsregel hittades inte");
    res.json(updated);
}));

app.delete("/api/invoice-rules/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteInvoiceRule(req.params.id, tenantId);
    res.json({ success: true });
}));

// ============================================
// INVOICE PREVIEW/GENERATION
// ============================================

app.get("/api/invoice-preview", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { orderConceptId, customerId, fromDate, toDate } = req.query;
    
    const allOrders = await storage.getWorkOrders(tenantId);
    const completedOrders = allOrders.filter(wo => {
      const isCompleted = wo.orderStatus === "utford" || wo.executionStatus === "completed";
      if (!isCompleted) return false;
      
      if (customerId && wo.customerId !== customerId) return false;
      
      if (fromDate) {
        const from = new Date(fromDate as string);
        const woDate = wo.completedAt ? new Date(wo.completedAt) : wo.scheduledDate ? new Date(wo.scheduledDate) : null;
        if (woDate && woDate < from) return false;
      }
      if (toDate) {
        const to = new Date(toDate as string);
        const woDate = wo.completedAt ? new Date(wo.completedAt) : wo.scheduledDate ? new Date(wo.scheduledDate) : null;
        if (woDate && woDate > to) return false;
      }
      
      return true;
    });
    
    // Get invoice rules
    const rules = await storage.getInvoiceRules(tenantId, orderConceptId as string | undefined);
    
    // Group orders by invoice stop-level (or customer as fallback)
    const ordersByInvoiceTarget: Record<string, { customerId: string; stopObjectName: string | null; invoiceReference: string | null; orders: typeof completedOrders }> = {};
    for (const order of completedOrders) {
      let targetKey = order.customerId || 'unknown';
      let stopObjectName: string | null = null;
      let invoiceReference: string | null = null;
      
      if (order.objectId) {
        const stopLevel = await storage.findInvoiceStopLevel(order.objectId, tenantId);
        if (stopLevel) {
          targetKey = stopLevel.customerId;
          stopObjectName = stopLevel.objectName;
          invoiceReference = stopLevel.invoiceReference;
        }
      }
      
      if (!ordersByInvoiceTarget[targetKey]) {
        ordersByInvoiceTarget[targetKey] = { customerId: targetKey, stopObjectName, invoiceReference, orders: [] };
      }
      ordersByInvoiceTarget[targetKey].orders.push(order);
    }
    
    const ordersByCustomer: Record<string, typeof completedOrders> = {};
    const invoiceStopInfo: Record<string, { stopObjectName: string | null; invoiceReference: string | null }> = {};
    for (const [key, target] of Object.entries(ordersByInvoiceTarget)) {
      ordersByCustomer[target.customerId] = [...(ordersByCustomer[target.customerId] || []), ...target.orders];
      if (!invoiceStopInfo[target.customerId] && target.stopObjectName) {
        invoiceStopInfo[target.customerId] = { stopObjectName: target.stopObjectName, invoiceReference: target.invoiceReference };
      }
    }
    
    // Get all customers for name lookup
    const customers = await storage.getCustomers(tenantId);
    const customerMap = new Map(customers.map(c => [c.id, c]));
    
    // Generate invoice previews
    const invoicePreviews = [];
    
    for (const [cid, orders] of Object.entries(ordersByCustomer)) {
      const customer = customerMap.get(cid);
      const rule = rules.find(r => r.customerId === cid) || rules[0];
      const invoiceType = rule?.invoiceType || 'per_task';
      const metadataOnHeader = (rule?.metadataOnHeader as string[]) || [];
      const metadataOnLine = (rule?.metadataOnLine as string[]) || [];
      
      const lines = [];
      
      if (invoiceType === 'per_task') {
        for (const order of orders) {
          const orderMeta = (order.metadata as Record<string, unknown>) || {};
          const lineMetadata: Record<string, string> = {};
          for (const key of metadataOnLine) {
            if (orderMeta[key]) lineMetadata[key] = String(orderMeta[key]);
          }
          
          // Task #1025: spegla exakt den berikade radtext som skickas till
          // Fortnox. Förhandsvisningen är en per-WO-summering, men referens-
          // texten byggs med SAMMA delade resolver + formatterare som exporten
          // så formatet aldrig kan drifta mellan vy och utskick.
          const refs = await resolveObjectInvoiceRefs(tenantId, order);
          const enrichedDescription =
            formatEnrichedDescription(order.title, refs) ?? order.title;

          lines.push({
            workOrderId: order.id,
            description: enrichedDescription,
            // Dölj den separata adress-underraden ENBART när adressen faktiskt
            // bakats in i den berikade radtexten (refs.adress kommer från metadata
            // medan objectAddress kommer från objektets adress-kolumn — de kan
            // skilja sig, så göm aldrig en adress som inte redan visas).
            enriched: Boolean(refs.adress),
            objectName: order.objectName,
            objectAddress: order.objectAddress,
            quantity: 1,
            unitPrice: order.estimatedCost || 0,
            total: order.estimatedCost || 0,
            completedAt: order.completedAt,
            metadata: lineMetadata,
          });
        }
      } else if (invoiceType === 'per_room' || invoiceType === 'per_area') {
        // Group by object
        const byObject: Record<string, typeof orders> = {};
        for (const order of orders) {
          const oid = order.objectId || 'unknown';
          if (!byObject[oid]) byObject[oid] = [];
          byObject[oid].push(order);
        }
        
        for (const [oid, objOrders] of Object.entries(byObject)) {
          const firstOrder = objOrders[0];
          const totalCost = objOrders.reduce((sum, o) => sum + (o.estimatedCost || 0), 0);
          
          lines.push({
            workOrderId: objOrders.map(o => o.id).join(','),
            description: `${invoiceType === 'per_room' ? 'Rum' : 'Område'}: ${firstOrder.objectName}`,
            objectName: firstOrder.objectName,
            objectAddress: firstOrder.objectAddress,
            quantity: objOrders.length,
            unitPrice: totalCost / objOrders.length,
            total: totalCost,
            completedAt: objOrders[objOrders.length - 1].completedAt,
            metadata: {},
          });
        }
      } else if (invoiceType === 'monthly') {
        // Monthly flat fee
        lines.push({
          workOrderId: orders.map(o => o.id).join(','),
          description: 'Månadsavgift',
          objectName: null,
          objectAddress: null,
          quantity: 1,
          unitPrice: 0,
          total: 0,
          completedAt: null,
          metadata: {},
        });
      }
      
      const totalExVat = lines.reduce((sum, l) => sum + l.total, 0);
      const vat = totalExVat * 0.25;
      
      // Build header metadata
      const headerMetadata: Record<string, string> = {};
      // Try to get header metadata from the customer or first order
      for (const key of metadataOnHeader) {
        const customerData = customer as Record<string, unknown> | undefined;
        if (customerData && customerData[key]) {
          headerMetadata[key] = String(customerData[key]);
        }
      }
      
      const stopInfo = invoiceStopInfo[cid];
      invoicePreviews.push({
        customerId: cid,
        customerName: customer?.name || 'Okänd kund',
        invoiceStopObject: stopInfo?.stopObjectName || null,
        invoiceReference: stopInfo?.invoiceReference || null,
        invoiceType,
        headerMetadata,
        lines,
        summary: {
          totalExVat: Math.round(totalExVat * 100) / 100,
          vat: Math.round(vat * 100) / 100,
          totalInclVat: Math.round((totalExVat + vat) * 100) / 100,
          orderCount: orders.length,
        },
        waitForAll: rule?.waitForAll || false,
      });
    }
    
    const manualLines = await storage.getManualInvoiceLines(tenantId, customerId as string | undefined, "draft");
    const manualByCustomer: Record<string, typeof manualLines> = {};
    for (const ml of manualLines) {
      if (!manualByCustomer[ml.customerId]) manualByCustomer[ml.customerId] = [];
      manualByCustomer[ml.customerId].push(ml);
    }

    for (const [cid, lines] of Object.entries(manualByCustomer)) {
      const existing = invoicePreviews.find(ip => ip.customerId === cid);
      const manualLineItems = lines.map(ml => ({
        workOrderId: `manual:${ml.id}`,
        description: ml.description,
        objectName: null,
        objectAddress: null,
        quantity: ml.quantity,
        unitPrice: ml.unitPrice,
        total: ml.quantity * ml.unitPrice,
        completedAt: ml.createdAt,
        metadata: { typ: "Manuell rad" } as Record<string, string>,
      }));

      if (existing) {
        existing.lines.push(...manualLineItems);
        const addedTotal = manualLineItems.reduce((s, l) => s + l.total, 0);
        existing.summary.totalExVat = Math.round((existing.summary.totalExVat + addedTotal) * 100) / 100;
        existing.summary.vat = Math.round(existing.summary.totalExVat * 0.25 * 100) / 100;
        existing.summary.totalInclVat = Math.round((existing.summary.totalExVat + existing.summary.vat) * 100) / 100;
      } else {
        const customer = customerMap.get(cid);
        const totalExVat = manualLineItems.reduce((s, l) => s + l.total, 0);
        const vat = totalExVat * 0.25;
        invoicePreviews.push({
          customerId: cid,
          customerName: customer?.name || 'Okänd kund',
          invoiceStopObject: null,
          invoiceReference: null,
          invoiceType: 'per_task',
          headerMetadata: {},
          lines: manualLineItems,
          summary: {
            totalExVat: Math.round(totalExVat * 100) / 100,
            vat: Math.round(vat * 100) / 100,
            totalInclVat: Math.round((totalExVat + vat) * 100) / 100,
            orderCount: 0,
          },
          waitForAll: false,
        });
      }
    }

    res.json(invoicePreviews);
}));

// ============================================
// ORDER CONCEPT RERUN & RUN LOGS API
// ============================================

app.get("/api/order-concept-run-logs", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { orderConceptId } = req.query;
    const logs = await storage.getOrderConceptRunLogs(tenantId, orderConceptId as string | undefined);
    res.json(logs);
}));

app.post("/api/order-concepts/:id/rerun", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

    let tasksCreated = 0;
    let tasksSkipped = 0;
    let changesDetected = 0;
    const details: any[] = [];

    const filters = await storage.getConceptFilters(concept.id);
    const filterInputs = filters.map((f: any) => ({
      metadataKey: f.metadataKey,
      operator: f.operator,
      filterValue: f.filterValue,
    }));
    // Resolva mål (gren-subträd → legacy kluster → alla) och matcha via delad
    // modul — batch-laddar metadata (tidigare inline-switch matchade aldrig
    // metadata-filter eftersom obj.metadata saknas i detta flöde).
    const { matchingObjects } = await resolveConceptMatchingObjects(
      tenantId,
      concept as any,
      filterInputs,
      { fallbackAllObjects: true },
    );

    const existingAssignments = await storage.getAssignments(tenantId, {});
    const conceptAssignments = existingAssignments.filter(a => a.orderConceptId === concept.id);
    const assignedObjectIds = new Set(conceptAssignments.map(a => a.objectId));

    for (const obj of matchingObjects) {
      if (!assignedObjectIds.has(obj.id)) {
        changesDetected++;
        details.push({ type: "new_object", objectId: obj.id, objectName: obj.name || obj.id });
      }
    }

    for (const objectId of assignedObjectIds) {
      if (!matchingObjects.find(o => o.id === objectId)) {
        changesDetected++;
        details.push({ type: "removed_object", objectId });
      }
    }

    if (concept.subscriptionMetadataField) {
      for (const obj of matchingObjects) {
        if (assignedObjectIds.has(obj.id)) {
          const objWithMeta = obj as typeof obj & { metadata?: Record<string, unknown> };
          const currentUnits = Number(objWithMeta.metadata?.[concept.subscriptionMetadataField] || 0);
          const assignment = conceptAssignments.find(a => a.objectId === obj.id);
          const previousUnits = assignment?.quantity || 0;
          if (currentUnits !== previousUnits) {
            changesDetected++;
            details.push({ 
              type: "quantity_changed", 
              objectId: obj.id, 
              objectName: obj.name || obj.id,
              previousValue: previousUnits, 
              newValue: currentUnits 
            });
          }
        }
      }
    }

    if (getOrderConceptMethod(concept) === "schedule" && concept.deliverySchedule) {
      const schedule = concept.deliverySchedule as any[];
      const now = new Date();
      const futureDate = new Date();
      futureDate.setMonth(futureDate.getMonth() + (concept.rollingMonths || 3));

      for (const entry of schedule) {
        const targetMonth = entry.month;
        for (let year = now.getFullYear(); year <= futureDate.getFullYear(); year++) {
          const entryDate = new Date(year, targetMonth - 1, 1);
          if (entryDate >= now && entryDate <= futureDate) {
            const existingForMonth = conceptAssignments.find(a => {
              if (!a.scheduledDate) return false;
              const d = new Date(a.scheduledDate);
              return d.getMonth() + 1 === targetMonth && d.getFullYear() === year;
            });
            if (!existingForMonth) {
              tasksCreated++;
              details.push({ type: "new_schedule_entry", month: targetMonth, year });
            } else {
              tasksSkipped++;
            }
          }
        }
      }
    }

    const log = await storage.createOrderConceptRunLog({
      tenantId,
      orderConceptId: concept.id,
      runType: "rerun",
      status: "completed",
      tasksCreated,
      tasksSkipped,
      changesDetected,
      details,
      runBy: userId,
    });

    await storage.updateOrderConcept(concept.id, tenantId, { lastRunDate: new Date() });

    res.json({
      log,
      summary: {
        tasksCreated,
        tasksSkipped,
        changesDetected,
        details,
      },
    });
}));

app.post("/api/order-concepts/:id/validate-min-days", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

    const minDays = concept.minDaysBetween || 60;
    const { proposedDate } = req.body;
    if (!proposedDate) throw new ValidationError("proposedDate krävs");

    const existingAssignments = await storage.getAssignments(tenantId, {});
    const conceptAssignments = existingAssignments.filter(a => a.orderConceptId === concept.id);
    const proposedDateObj = new Date(proposedDate);

    let valid = true;
    let conflictingTask = null;

    for (const assignment of conceptAssignments) {
      if (!assignment.scheduledDate) continue;
      const assignDate = new Date(assignment.scheduledDate);
      const diffMs = Math.abs(proposedDateObj.getTime() - assignDate.getTime());
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays < minDays) {
        valid = false;
        conflictingTask = {
          id: assignment.id,
          scheduledDate: assignment.scheduledDate,
          daysDiff: Math.round(diffDays),
        };
        break;
      }
    }

    res.json({ valid, minDays, conflictingTask });
}));

// ============================================
// SCHEDULE API (Week Planning)
// ============================================

app.get("/api/schedule", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new ValidationError("startDate och endDate krävs");
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    // Get all resources
    const resources = await storage.getResources(tenantId);
    const activeResources = resources.filter(r => r.status === "active");

    // Get all assignments in date range
    const assignments = await storage.getAssignments(tenantId, {
      startDate: start,
      endDate: end
    });

    // Build schedule data per resource per day
    const schedule = await Promise.all(activeResources.map(async (resource) => {
      // Get availability entries for this resource
      const availabilityEntries = await storage.getResourceAvailability(resource.id);

      // Group assignments by date
      const resourceAssignments = assignments.filter(a => a.resourceId === resource.id);
      const assignmentsByDate: Record<string, typeof assignments> = {};
      
      resourceAssignments.forEach(a => {
        if (a.scheduledDate) {
          const dateKey = new Date(a.scheduledDate).toISOString().split("T")[0];
          if (!assignmentsByDate[dateKey]) assignmentsByDate[dateKey] = [];
          assignmentsByDate[dateKey].push(a);
        }
      });

      // Build daily data
      const days: Array<{
        date: string;
        available: boolean;
        availabilityType?: string;
        assignments: typeof assignments;
        totalTime: number;
        totalValue: number;
      }> = [];

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        
        // Check availability
        let available = true;
        let availabilityType = "available";
        
        // Check resource.availability JSON field
        if (resource.availability) {
          const dayAvail = (resource.availability as Record<string, string>)[dateStr];
          if (dayAvail && dayAvail !== "available") {
            available = false;
            availabilityType = dayAvail;
          }
        }

        // Check resource_availability table
        const blockingEntry = availabilityEntries.find(entry => {
          if (entry.date) {
            const entryDate = new Date(entry.date).toISOString().split("T")[0];
            return entryDate === dateStr && !entry.isAvailable;
          }
          return false;
        });
        if (blockingEntry) {
          available = false;
          availabilityType = blockingEntry.availabilityType || "blocked";
        }

        const dayAssignments = assignmentsByDate[dateStr] || [];
        const totalTime = dayAssignments.reduce((sum, a) => sum + (a.estimatedDuration || 60), 0);
        const totalValue = dayAssignments.reduce((sum, a) => sum + (a.cachedValue || 0), 0);

        days.push({
          date: dateStr,
          available,
          availabilityType,
          assignments: dayAssignments,
          totalTime,
          totalValue
        });
      }

      return {
        resource,
        days
      };
    }));

    // Also return unassigned assignments in the date range
    const unassignedAssignments = assignments.filter(a => !a.resourceId);

    res.json({
      schedule,
      unassignedAssignments,
      dateRange: { start: start.toISOString(), end: end.toISOString() }
    });
}));

// ============================================
// ASSIGNMENTS API
// ============================================

app.get("/api/assignments", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { status, resourceId, clusterId, startDate, endDate } = req.query;
    
    const assignments = await storage.getAssignments(tenantId, {
      status: status as string | undefined,
      resourceId: resourceId as string | undefined,
      clusterId: clusterId as string | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    });
    res.json(assignments);
}));

// Task #836 (Fas 3): Schemaläggnings-varningar över ALLA tenantens uppgifter
// (överlapp, otillräcklig restid, okvitterade beroenden per resurs). Surfas i
// AssignmentsPage så planeraren ser konflikter i sitt faktiska arbetsflöde.
// OBS: måste registreras före "/api/assignments/:id" så "schedule-warnings" inte
// tolkas som ett id.
app.get("/api/assignments/schedule-warnings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    const thresholds = resolveTimeWarningThresholds(tenant?.settings);

    const assignments = await storage.getAssignments(tenantId);
    const warnings = computeScheduleWarnings(
      assignments.map((a) => ({
        id: a.id,
        title: a.title,
        scheduledDate: a.scheduledDate,
        estimatedDuration: a.estimatedDuration,
        resourceId: a.resourceId,
        requiresAcknowledgment: a.requiresAcknowledgment,
        dependencyAcknowledgedAt: a.dependencyAcknowledgedAt,
        dependencyCriticality: a.dependencyCriticality,
      })),
      thresholds,
    );

    res.json({ thresholds, warnings, taskCount: assignments.length });
}));

app.get("/api/assignments/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignment = await storage.getAssignment(req.params.id);
    if (!verifyTenantOwnership(assignment, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    const articles = await storage.getAssignmentArticles(assignment!.id);

    // Task #857: berika med orderkoncept- och objektnamn för korsnavigering
    // uppgift → orderkoncept / objekt i uppgiftsdetaljen.
    let orderConceptName: string | null = null;
    let objectName: string | null = null;
    if (assignment!.orderConceptId) {
      const concept = await storage.getOrderConcept(assignment!.orderConceptId);
      if (concept && concept.tenantId === tenantId) orderConceptName = concept.name;
    }
    if (assignment!.objectId) {
      const obj = await storage.getObject(assignment!.objectId);
      if (obj && obj.tenantId === tenantId) objectName = obj.name;
    }
    res.json({ ...assignment, articles, orderConceptName, objectName });
}));

// Task #857: alla uppgifter (assignments) som ett orderkoncept har genererat,
// plus de objekt de hänger på — för djuplänkning orderkoncept → uppgift → objekt.
// Tenant-scopad — cross-tenant koncept ger 404.
app.get("/api/order-concepts/:id/assignments", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const concept = await storage.getOrderConcept(req.params.id);
    if (!verifyTenantOwnership(concept, tenantId)) {
      throw new NotFoundError("Orderkoncept hittades inte");
    }

    const rows = await db
      .select({
        id: assignmentsTable.id,
        title: assignmentsTable.title,
        status: assignmentsTable.status,
        priority: assignmentsTable.priority,
        scheduledDate: assignmentsTable.scheduledDate,
        quantity: assignmentsTable.quantity,
        createdAt: assignmentsTable.createdAt,
        objectId: assignmentsTable.objectId,
        objectName: objects.name,
        objectAddress: objects.address,
        objectNumber: objects.objectNumber,
      })
      .from(assignmentsTable)
      .leftJoin(objects, eq(assignmentsTable.objectId, objects.id))
      .where(and(
        eq(assignmentsTable.tenantId, tenantId),
        eq(assignmentsTable.orderConceptId, req.params.id),
        isNull(assignmentsTable.deletedAt),
      ))
      .orderBy(desc(assignmentsTable.createdAt))
      .limit(200);

    // Distinkta objekt (ett objekt kan ha flera uppgifter från samma koncept).
    const objectMap = new Map<string, { id: string; name: string | null; address: string | null; objectNumber: string | null; assignmentCount: number }>();
    for (const r of rows) {
      if (!r.objectId) continue;
      const existing = objectMap.get(r.objectId);
      if (existing) {
        existing.assignmentCount += 1;
      } else {
        objectMap.set(r.objectId, {
          id: r.objectId,
          name: r.objectName,
          address: r.objectAddress,
          objectNumber: r.objectNumber,
          assignmentCount: 1,
        });
      }
    }

    res.json({ assignments: rows, objects: Array.from(objectMap.values()) });
}));

app.post("/api/assignments", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    
    const assignment = await storage.createAssignment({
      ...req.body,
      tenantId,
      createdBy: userId,
      creationMethod: req.body.creationMethod || "manual"
    });
    res.status(201).json(assignment);
}));

app.patch("/api/assignments/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getAssignment(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    const assignment = await storage.updateAssignment(req.params.id, tenantId, req.body);
    res.json(assignment);
}));

app.delete("/api/assignments/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getAssignment(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    await storage.deleteAssignment(req.params.id, tenantId);
    res.status(204).send();
}));

// Task #836 (Fas 3): Kvittera en beroendeuppgift. Stämplar dependencyAcknowledgedAt/By
// så att huvuduppgiften kan utföras och okvitterad-beroende-varningen släcks.
app.post("/api/assignments/:id/acknowledge-dependency", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getAssignment(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    if (!existing!.requiresAcknowledgment) {
      throw new ValidationError("Uppgiften kräver ingen kvittens");
    }
    const userId = (req as any).user?.claims?.sub ?? null;
    const assignment = await storage.updateAssignment(req.params.id, tenantId, {
      dependencyAcknowledgedAt: new Date(),
      dependencyAcknowledgedBy: userId,
    });
    res.json(assignment);
}));

// Get candidate resources for an assignment
app.get("/api/assignments/:id/candidates", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignment = await storage.getAssignment(req.params.id);
    if (!verifyTenantOwnership(assignment, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }

    // Get all active resources for the tenant
    const allResources = await storage.getResources(tenantId);
    const activeResources = allResources.filter(r => r.status === "active");

    // Get the scheduled date from assignment or query param
    const targetDate = req.query.date 
      ? new Date(req.query.date as string)
      : assignment!.scheduledDate;
    const dateStr = targetDate ? targetDate.toISOString().split("T")[0] : null;

    // Score each resource
    const candidates = await Promise.all(activeResources.map(async (resource) => {
      let score = 50; // Base score
      let available = true;
      let reasons: string[] = [];

      // Check availability from resource's availability field (JSON)
      if (dateStr && resource.availability) {
        const dayAvailability = (resource.availability as Record<string, string>)[dateStr];
        if (dayAvailability && dayAvailability !== "available") {
          available = false;
          reasons.push(`Ej tillgänglig: ${dayAvailability}`);
          score -= 100;
        }
      }

      // Check resource_availability table entries
      if (dateStr) {
        const availabilityEntries = await storage.getResourceAvailability(resource.id);
        const dateConflict = availabilityEntries.find(entry => {
          if (entry.date) {
            const entryDate = new Date(entry.date).toISOString().split("T")[0];
            return entryDate === dateStr && !entry.isAvailable;
          }
          return false;
        });
        if (dateConflict) {
          available = false;
          reasons.push(`Blockerad: ${dateConflict.notes || dateConflict.availabilityType}`);
          score -= 100;
        }
      }

      // Check existing assignments for the date (workload)
      if (dateStr) {
        const resourceAssignments = await storage.getAssignments(tenantId, {
          resourceId: resource.id,
          startDate: new Date(dateStr),
          endDate: new Date(dateStr)
        });
        const workload = resourceAssignments.length;
        if (workload > 0) {
          reasons.push(`${workload} uppgifter redan planerade`);
          score -= workload * 5; // Reduce score per existing assignment
        }
        if (workload >= 10) {
          available = false;
          reasons.push("Fullbokat");
          score -= 50;
        }
      }

      // Bonus for matching cluster/area
      if (assignment!.clusterId && resource.serviceArea) {
        // Simple check if service area matches cluster
        score += 10;
      }

      return {
        resource,
        score: Math.max(0, score),
        available,
        reasons
      };
    }));

    // Sort by score (highest first), then by availability
    candidates.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return b.score - a.score;
    });

    res.json(candidates);
}));

// Assign resource to assignment
app.post("/api/assignments/:id/assign", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignment = await storage.getAssignment(req.params.id);
    if (!verifyTenantOwnership(assignment, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }

    const { resourceId, scheduledDate, scheduledStartTime, scheduledEndTime } = req.body;
    
    if (!resourceId) {
      throw new ValidationError("ResourceId krävs");
    }

    // Verify resource exists and belongs to tenant
    const resource = await storage.getResource(resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurs hittades inte");
    }

    // Update assignment with resource and scheduling info
    const updatedAssignment = await storage.updateAssignment(req.params.id, tenantId, {
      resourceId,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : assignment!.scheduledDate,
      scheduledStartTime: scheduledStartTime || undefined,
      scheduledEndTime: scheduledEndTime || undefined,
      status: scheduledDate ? "planned_fine" : "planned_rough"
    });

    res.json(updatedAssignment);
}));

// Assignment Articles
app.get("/api/assignments/:assignmentId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignment = await storage.getAssignment(req.params.assignmentId);
    if (!verifyTenantOwnership(assignment, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    const articles = await storage.getAssignmentArticles(req.params.assignmentId);
    res.json(articles);
}));

app.post("/api/assignments/:assignmentId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignment = await storage.getAssignment(req.params.assignmentId);
    if (!verifyTenantOwnership(assignment, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    const article = await storage.createAssignmentArticle({
      ...req.body,
      assignmentId: req.params.assignmentId
    });
    res.status(201).json(article);
}));

app.delete("/api/assignments/:assignmentId/articles/:articleId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignment = await storage.getAssignment(req.params.assignmentId);
    if (!verifyTenantOwnership(assignment, tenantId)) {
      throw new NotFoundError("Uppgift hittades inte");
    }
    
    await storage.deleteAssignmentArticle(req.params.articleId, req.params.assignmentId);
    res.status(204).send();
}));

// ============================================
// CUSTOMER NOTIFICATIONS - E-post notifieringar till kunder
// ============================================

app.post("/api/notifications/send", asyncHandler(async (req, res) => {
    const { sendCustomerNotification } = await import("../customer-notifications");
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId, notificationType, estimatedArrivalMinutes, customMessage } = req.body;
    
    if (!workOrderId || !notificationType) {
      throw new ValidationError("workOrderId och notificationType krävs");
    }
    
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    
    const results = await sendCustomerNotification(tenantId, {
      workOrderId,
      notificationType,
      estimatedArrivalMinutes,
      customMessage,
    });
    
    const successCount = results.filter(r => r.success).length;
    res.json({
      success: successCount > 0,
      sent: successCount,
      total: results.length,
      results,
      message: successCount > 0 
        ? `Notifiering skickad till ${successCount} mottagare`
        : "Kunde inte skicka notifiering",
    });
}));

app.post("/api/notifications/technician-on-way/:workOrderId", asyncHandler(async (req, res) => {
    const { notifyTechnicianOnWay } = await import("../customer-notifications");
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId } = req.params;
    const { estimatedMinutes } = req.body;
    
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    
    const results = await notifyTechnicianOnWay(tenantId, workOrderId, estimatedMinutes);
    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: successCount > 0,
      sent: successCount,
      results,
      message: successCount > 0 
        ? `Kunden notifierad om att tekniker är på väg`
        : "Kunde inte skicka notifiering",
    });
}));

app.post("/api/notifications/job-completed/:workOrderId", asyncHandler(async (req, res) => {
    const { notifyJobCompleted } = await import("../customer-notifications");
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId } = req.params;
    
    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }
    
    const results = await notifyJobCompleted(tenantId, workOrderId);
    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: successCount > 0,
      sent: successCount,
      results,
    });
}));

app.post("/api/notifications/send-schedule/:resourceId", asyncHandler(async (req, res) => {
    const { sendScheduleToResource } = await import("../customer-notifications");
    const tenantId = getTenantIdWithFallback(req);
    const { resourceId } = req.params;
    const { dateRange, fieldAppUrl, channels } = req.body as {
      dateRange: { start: string; end: string };
      fieldAppUrl: string;
      channels?: { email?: boolean; sms?: boolean };
    };

    if (!dateRange || typeof dateRange.start !== "string" || typeof dateRange.end !== "string") {
      throw new ValidationError("Ogiltig datumperiod");
    }
    const parseStrictDate = (s: string): number | null => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return null;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
      return dt.getTime();
    };
    const startMs = parseStrictDate(dateRange.start);
    const endMs = parseStrictDate(dateRange.end);
    if (startMs === null || endMs === null) {
      throw new ValidationError("Ogiltigt datumformat (YYYY-MM-DD)");
    }
    if (startMs > endMs) {
      throw new ValidationError("Startdatum måste vara före eller lika med slutdatum");
    }
    const dayMs = 24 * 60 * 60 * 1000;
    const daysInclusive = Math.round((endMs - startMs) / dayMs) + 1;
    if (daysInclusive > 31) {
      throw new ValidationError("Perioden får inte överstiga 31 dagar");
    }

    const resource = await storage.getResource(resourceId);
    if (!resource || !verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurs hittades inte");
    }

    const requestedChannels = channels && (channels.email !== undefined || channels.sms !== undefined)
      ? { email: channels.email === true, sms: channels.sms === true }
      : { email: true, sms: false };

    if (!requestedChannels.email && !requestedChannels.sms) {
      throw new ValidationError("Minst en kanal (e-post eller SMS) måste väljas");
    }
    if (requestedChannels.email && !resource.email) {
      throw new ValidationError("Resursen har ingen e-postadress registrerad");
    }
    if (requestedChannels.sms && !resource.phone) {
      throw new ValidationError("Resursen har inget telefonnummer registrerat");
    }

    // Hämta jobben server-side så att klienten inte kan manipulera periodgränser
    // eller smyga in jobb från andra resurser/tenants.
    const dbWorkOrders = await storage.getWorkOrdersByResource(
      resourceId,
      new Date(startMs),
      new Date(endMs + dayMs - 1)
    );
    const safeJobs = await Promise.all(
      dbWorkOrders
        .filter((wo) => wo.tenantId === tenantId && wo.scheduledDate)
        .map(async (wo) => {
          let objectName: string | undefined;
          let objectAddress: string | undefined;
          let accessCode: string | undefined;
          let keyNumber: string | undefined;
          if (wo.objectId) {
            try {
              const obj = await storage.getObject(wo.objectId);
              if (obj) {
                objectName = obj.name || undefined;
                objectAddress = obj.address || undefined;
                accessCode = obj.accessCode || undefined;
                keyNumber = obj.keyNumber || undefined;
              }
            } catch { /* ignore */ }
          }
          const sd = wo.scheduledDate as Date | string;
          const scheduledDate = typeof sd === "string"
            ? sd.substring(0, 10)
            : new Date(sd).toISOString().substring(0, 10);
          return {
            id: wo.id,
            title: wo.title,
            objectName,
            objectAddress,
            scheduledDate,
            scheduledStartTime: wo.scheduledStartTime || undefined,
            estimatedDuration: wo.estimatedDuration || undefined,
            accessCode,
            keyNumber,
          };
        })
    );

    const result = await sendScheduleToResource(
      tenantId,
      resourceId,
      resource.name,
      resource.email,
      safeJobs,
      dateRange,
      fieldAppUrl,
      {
        channels: requestedChannels,
        resourcePhone: resource.phone,
        smsAllowed: resource.smsOnScheduleSend !== false,
      }
    );

    res.json(result);
}));

app.post("/api/work-orders/:workOrderId/send-sms", asyncHandler(async (req, res) => {
    const { sendSms, isTwilioConfigured } = await import("../replit_integrations/twilio");
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId } = req.params;
    const { message, recipientPhone } = req.body;

    if (!message || typeof message !== "string" || !recipientPhone || typeof recipientPhone !== "string") {
      throw new ValidationError("Meddelande och telefonnummer krävs");
    }

    if (message.length > 320) {
      throw new ValidationError("Meddelandet får inte vara längre än 320 tecken");
    }

    const phoneRegex = /^[\d\s\-+()]{7,20}$/;
    if (!phoneRegex.test(recipientPhone.trim())) {
      throw new ValidationError("Ogiltigt telefonnummerformat");
    }

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    const twilioConfigured = await isTwilioConfigured();
    if (!twilioConfigured) {
      throw new ValidationError("SMS-tjänsten (Twilio) är inte konfigurerad");
    }

    let cleaned = recipientPhone.replace(/[\s\-()]/g, "");
    if (cleaned.startsWith("07") || cleaned.startsWith("08") || cleaned.startsWith("0")) {
      cleaned = "+46" + cleaned.substring(1);
    } else if (!cleaned.startsWith("+")) {
      cleaned = "+46" + cleaned;
    }

    const smsResult = await sendSms({ to: cleaned, body: message });

    const customer = await storage.getCustomer(workOrder.customerId);

    await db.insert(customerCommunications).values({
      tenantId,
      workOrderId,
      customerId: workOrder.customerId,
      objectId: workOrder.objectId,
      channel: "sms",
      notificationType: "manual_sms",
      recipientName: customer?.contactPerson || customer?.name || null,
      recipientEmail: null,
      recipientPhone: recipientPhone,
      subject: null,
      message,
      aiGenerated: false,
      status: smsResult.success ? "sent" : "failed",
      errorMessage: smsResult.error || null,
      sentAt: smsResult.success ? new Date() : null,
    });

    res.json({
      success: smsResult.success,
      messageId: smsResult.messageId,
      error: smsResult.error,
    });
}));

app.get("/api/work-orders/:workOrderId/communications", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId } = req.params;

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    const logs = await db.select()
      .from(customerCommunications)
      .where(and(
        eq(customerCommunications.tenantId, tenantId),
        eq(customerCommunications.workOrderId, workOrderId)
      ))
      .orderBy(desc(customerCommunications.createdAt));

    res.json(logs);
}));

app.post("/api/work-orders/:workOrderId/auto-eta-sms", asyncHandler(async (req, res) => {
    const { sendSms, isTwilioConfigured } = await import("../replit_integrations/twilio");
    const { trackApiUsage } = await import("../api-usage-tracker");
    const tenantId = getTenantIdWithFallback(req);
    const { workOrderId } = req.params;
    const { technicianLat, technicianLng } = req.body;

    const workOrder = await storage.getWorkOrder(workOrderId);
    if (!verifyTenantOwnership(workOrder, tenantId)) {
      throw new NotFoundError("Arbetsorder hittades inte");
    }

    if (workOrder.etaSmsSent) {
      res.json({ success: true, skipped: true, reason: "ETA SMS redan skickat för denna order" });
      return;
    }

    const tenant = await storage.getTenant(tenantId);
    if (!tenant?.smsEnabled) {
      res.json({ success: false, reason: "SMS inte aktiverat" });
      return;
    }

    const twilioConfigured = await isTwilioConfigured();
    if (!twilioConfigured) {
      res.json({ success: false, reason: "Twilio inte konfigurerat" });
      return;
    }

    const obj = await storage.getObject(workOrder.objectId);
    if (!obj) {
      throw new NotFoundError("Objekt hittades inte");
    }

    const customer = await storage.getCustomer(workOrder.customerId);
    const contacts = await db.select().from(objectContacts)
      .where(and(
        eq(objectContacts.objectId, workOrder.objectId),
        eq(objectContacts.tenantId, tenantId)
      ));

    const primaryContacts = contacts.filter(c => c.contactType === "primary");
    const recipientContacts = primaryContacts.length > 0 ? primaryContacts : contacts;
    const phoneRecipients: { name: string; phone: string }[] = [];

    for (const contact of recipientContacts) {
      if (contact.phone) {
        phoneRecipients.push({ name: contact.name || "", phone: contact.phone });
      }
    }

    if (phoneRecipients.length === 0 && customer?.phone) {
      phoneRecipients.push({ name: customer.contactPerson || customer.name, phone: customer.phone });
    }

    if (phoneRecipients.length === 0) {
      res.json({ success: false, reason: "Inget telefonnummer för mottagare" });
      return;
    }

    let etaMinutes: number | null = null;
    const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
    if (GEOAPIFY_API_KEY && technicianLat && technicianLng && obj.latitude && obj.longitude) {
      try {
        const waypoints = `${technicianLat},${technicianLng}|${obj.latitude},${obj.longitude}`;
        const startTime = Date.now();
        const geoRes = await fetch(
          `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&apiKey=${GEOAPIFY_API_KEY}`
        );
        trackApiUsage({
          service: "geoapify",
          method: "routing",
          endpoint: "/v1/routing",
          units: 1,
          statusCode: geoRes.status,
          durationMs: Date.now() - startTime,
        });
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          const props = geoData.features?.[0]?.properties;
          if (props?.time) {
            etaMinutes = Math.round(props.time / 60);
          }
        }
      } catch (err) {
        console.error("[auto-eta-sms] Geoapify routing error:", err);
      }
    }

    if (!etaMinutes) {
      etaMinutes = 30;
    }

    const resource = workOrder.resourceId ? await storage.getResource(workOrder.resourceId) : null;
    const companyName = tenant?.smsFromName || tenant?.name || "Traivo";
    const resourceName = resource?.name || "Vår tekniker";

    let sentCount = 0;
    for (const recipient of phoneRecipients) {
      let cleaned = recipient.phone.replace(/[\s\-()]/g, "");
      if (cleaned.startsWith("0")) {
        cleaned = "+46" + cleaned.substring(1);
      } else if (!cleaned.startsWith("+")) {
        cleaned = "+46" + cleaned;
      }

      const smsBody = `${companyName}: ${resourceName} är på väg till ${obj.address || obj.name}. Beräknad ankomst: ca ${etaMinutes} min.`;
      const smsResult = await sendSms({ to: cleaned, body: smsBody });

      await db.insert(customerCommunications).values({
        tenantId,
        workOrderId,
        customerId: workOrder.customerId,
        objectId: workOrder.objectId,
        channel: "sms",
        notificationType: "technician_on_way",
        recipientName: recipient.name || null,
        recipientEmail: null,
        recipientPhone: recipient.phone,
        subject: null,
        message: smsBody,
        aiGenerated: false,
        status: smsResult.success ? "sent" : "failed",
        errorMessage: smsResult.error || null,
        sentAt: smsResult.success ? new Date() : null,
      });

      if (smsResult.success) sentCount++;
    }

    if (sentCount > 0) {
      await db.update(workOrders)
        .set({ etaSmsSent: true })
        .where(eq(workOrders.id, workOrderId));
      invalidateWorkflowCaches(tenantId);
    }

    res.json({
      success: sentCount > 0,
      sent: sentCount,
      total: phoneRecipients.length,
      etaMinutes,
    });
}));

// ============================================
// SESSION 9B — 7-stegs wizard (Task #738)
// ============================================

// Steg 2: Föreslå prislista för vald kund (kundunik > rabattbrev > generell)
app.get("/api/order-concepts/price-lists/for-customer/:customerId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { customerId } = req.params;
    const all = await storage.getPriceLists(tenantId);
    const active = all.filter(pl => pl.status === "active" && !pl.deletedAt);
    const byPriority = (a: typeof active[number], b: typeof active[number]) => (b.priority ?? 1) - (a.priority ?? 1);

    const kundunik = active.filter(pl => pl.priceListType === "kundunik" && pl.customerId === customerId).sort(byPriority);
    const rabattbrev = active.filter(pl => pl.priceListType === "rabattbrev" && pl.customerId === customerId).sort(byPriority);
    const generell = active.filter(pl => pl.priceListType === "generell").sort(byPriority);

    let suggestedPriceListId: string | null = null;
    let suggestedSource: "kundunik" | "rabattbrev" | "generell" | null = null;
    if (kundunik.length > 0) { suggestedPriceListId = kundunik[0].id; suggestedSource = "kundunik"; }
    else if (rabattbrev.length > 0) { suggestedPriceListId = rabattbrev[0].id; suggestedSource = "rabattbrev"; }
    else if (generell.length > 0) { suggestedPriceListId = generell[0].id; suggestedSource = "generell"; }

    res.json({ suggestedPriceListId, suggestedSource, priceLists: active });
}));

// Steg 4: Förhandsvisa villkorsfilter mot valda kluster (X av Y matchar).
// Tar clusterIds + filter i body så förhandsvisning fungerar innan konceptet sparats.
app.post("/api/order-concepts/condition-preview", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      // ADR v3: objectIds = valda gren-ROT-objekt-id:n (föredras). clusterIds
      // behålls för bakåtkompatibilitet (legacy kluster-koncept).
      objectIds: z.array(z.string()).default([]),
      clusterIds: z.array(z.string()).default([]),
      filters: z.array(z.object({
        metadataKey: z.string(),
        operator: z.string(),
        filterValue: z.any().optional(),
      })).default([]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);
    const { objectIds, clusterIds, filters } = parsed.data;

    // Resolva målobjekten (gren-subträd ELLER legacy kluster) och applicera
    // villkoren via den delade modulen — identiskt med execute.
    const objectList = await resolveTargetObjects({ tenantId, objectIds, clusterIds });
    const total = objectList.length;
    // Strukturuppdelning för steg 4 (inpekning): hur många av de valda gren-rötterna
    // som faktiskt upplöstes (stale/borttagna id:n räknas inte) och hur många objekt
    // som ligger UNDER dem. Beräknas serverside där subträdet redan är upplöst så att
    // siffran är korrekt även vid nästlade selektioner och inaktuella id:n.
    const idSet = new Set(objectList.map((o) => o.id));
    const rootCount = objectIds.filter((id) => idSet.has(id)).length;
    const descendants = Math.max(0, total - rootCount);
    const matchedObjects = await filterObjectsByConditions(tenantId, objectList, filters);

    res.json({
      total,
      rootCount,
      descendants,
      matched: matchedObjects.length,
      // Task #1052: hela träff-mängden (id:n) så klienten kan dimma trädet live i
      // steg 1. Begränsad av subträdet för de valda grenarna (ej hela tenanten).
      matchedIds: matchedObjects.map((o) => o.id),
      sample: matchedObjects.slice(0, 50).map(o => ({
        id: o.id,
        name: o.name,
        objectNumber: o.objectNumber ?? null,
        address: o.address ?? null,
      })),
    });
}));

// Task #995: Förhandsvisa vilka kunder som härleds ur objektens metadata för de valda
// objekten (kund-steget i wizarden, FROM_METADATA-läge). Använder samma resolver-kedja
// som /validate och /execute (resolveTargetObjects → filterObjectsByConditions →
// resolveConceptCustomerForObject) så förhandsvisningen speglar vad körningen gör.
app.post("/api/order-concepts/customer-preview", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      objectIds: z.array(z.string()).default([]),
      clusterIds: z.array(z.string()).default([]),
      filters: z.array(z.object({
        metadataKey: z.string(),
        operator: z.string(),
        filterValue: z.any().optional(),
      })).default([]),
      customerMetadataField: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);
    const { objectIds, clusterIds, filters, customerMetadataField } = parsed.data;

    const objectList = await resolveTargetObjects({ tenantId, objectIds, clusterIds });
    const activeFilters = filters.filter((f) => f.metadataKey);
    const matchedObjects = await filterObjectsByConditions(tenantId, objectList, activeFilters);

    const customers = await storage.getCustomers(tenantId);
    const lookup = buildCustomerLookup(customers);
    const conceptLike = { customerMode: "FROM_METADATA", customerMetadataField };

    const resolvedMap = new Map<string, { customerId: string; customerName: string; count: number }>();
    const unmatchedMap = new Map<string, number>();
    let missingValue = 0;
    let ambiguous = 0;
    for (const obj of matchedObjects) {
      const r = await resolveConceptCustomerForObject(tenantId, conceptLike, obj.id, lookup);
      if (r.status === "ok") {
        const e = resolvedMap.get(r.customerId) ?? { customerId: r.customerId, customerName: r.customerName, count: 0 };
        e.count++;
        resolvedMap.set(r.customerId, e);
      } else if (r.status === "missing_value") {
        missingValue++;
      } else if (r.status === "unmatched") {
        unmatchedMap.set(r.rawValue, (unmatchedMap.get(r.rawValue) ?? 0) + 1);
      } else if (r.status === "ambiguous") {
        ambiguous++;
      }
    }

    res.json({
      totalObjects: matchedObjects.length,
      resolved: Array.from(resolvedMap.values()).sort((a, b) => b.count - a.count),
      missingValue,
      unmatched: Array.from(unmatchedMap.entries())
        .map(([rawValue, count]) => ({ rawValue, count }))
        .sort((a, b) => b.count - a.count),
      ambiguous,
    });
}));

// Steg 4: Villkorstest mot ETT enskilt objekt. Visar per-villkor pass/fail med
// objektets faktiska metadatavärde + om objektet ingår i de valda grenarna.
// Använder samma resolver (resolveTargetObjects) och matchesFilter
// (via evaluateConditionsForObject) som förhandsvisning/expansion, så resultatet
// är konsekvent med "X av Y matchar" och med vad expansionen faktiskt skapar.
app.post("/api/order-concepts/condition-test", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      objectId: z.string().min(1),
      // ADR v3: objectIds = valda gren-ROT-objekt-id:n. clusterIds = legacy.
      // Skickas in för scope-kontroll ("ingår objektet i vald inpekning?").
      objectIds: z.array(z.string()).default([]),
      clusterIds: z.array(z.string()).default([]),
      filters: z.array(z.object({
        metadataKey: z.string(),
        operator: z.string(),
        filterValue: z.any().optional(),
      })).default([]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);
    const { objectId, objectIds, clusterIds, filters } = parsed.data;

    // Tenant-scopad uppslagning (storage.getObject är INTE tenant-filtrerad).
    const object = await storage.getObject(objectId);
    if (!object || object.tenantId !== tenantId || object.deletedAt) {
      throw new NotFoundError("Objektet hittades inte");
    }

    // Ingår objektet i de valda grenarna? Resolvas bara när targeting angetts —
    // annars är scope-frågan inte tillämplig (null). Samma resolver som preview.
    let inTargetScope: boolean | null = null;
    if (objectIds.length > 0 || clusterIds.length > 0) {
      const targets = await resolveTargetObjects({ tenantId, objectIds, clusterIds });
      inTargetScope = targets.some((o) => o.id === objectId);
    }

    // Strippar tomma metadatanycklar (precis som klientens förhandsvisning).
    const activeFilters = filters.filter((f) => f.metadataKey);
    const { matched, results } = await evaluateConditionsForObject(tenantId, object, activeFilters);

    res.json({
      objectId,
      objectName: object.name,
      objectNumber: object.objectNumber ?? null,
      address: object.address ?? null,
      matched,
      inTargetScope,
      // Skulle objektet faktiskt expanderas? Kräver BÅDE scope OCH villkorsmatch
      // (när targeting saknas avgör enbart villkoren).
      wouldExpand: inTargetScope === null ? matched : inTargetScope && matched,
      results,
    });
}));

// Steg 5: AI-hjälp för leveranstid — tolkar mjuka villkor/restriktioner.
app.post("/api/order-concepts/:id/delivery-ai-help", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const concept = verifyTenantOwnership(await storage.getOrderConcept(req.params.id), tenantId);
    if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

    const userText: string = typeof req.body?.prompt === "string" ? req.body.prompt : "";
    const context = {
      deliveryTimeType: (concept as any).deliveryTimeType ?? null,
      timeWindows: (concept as any).timeWindows ?? null,
      intervalFrequencyDays: (concept as any).intervalFrequencyDays ?? null,
      deliveryRestrictions: (concept as any).deliveryRestrictions ?? null,
    };

    const completion = await openaiClient.chat.completions.create({
      model: "gpt-5-mini",
      max_tokens: 600,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Du är en planeringsassistent för fältservice (avfallshantering). Tolka användarens mjuka leveransvillkor och föreslå strukturerade leveranstidsinställningar. Svara ENDAST med JSON på svenska enligt formatet: {\"summary\": string, \"suggestions\": [{\"title\": string, \"detail\": string}], \"restrictions\": [{\"type\": string, \"description\": string}]}.",
        },
        {
          role: "user",
          content: `Befintlig kontext: ${JSON.stringify(context)}\n\nAnvändarens beskrivning: ${userText || "(ingen text angiven, ge generella råd baserat på kontexten)"}`,
        },
      ],
    });

    const { trackApiUsage } = await import("../api-usage-tracker");
    trackApiUsage({ service: "openai", method: "chat.completions.create", endpoint: "/v1/chat/completions", model: "gpt-5-mini", units: 1, metadata: { feature: "delivery-ai-help" } });

    let result: unknown;
    try {
      result = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    } catch {
      result = { summary: completion.choices[0]?.message?.content ?? "", suggestions: [], restrictions: [] };
    }
    res.json(result);
}));

// Steg 7: Konkret granskningssammanfattning — matchade objekt per kluster,
// aggregerade artikeltotaler, schema och estimerad ställtid från geografisk spridning.
app.get("/api/order-concepts/:id/review-summary", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const rawConcept = await storage.getOrderConcept(req.params.id);
  const concept = verifyTenantOwnership(rawConcept, tenantId);
  if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

  // --- Artikelrader med ekonomisk nedbrytning ---
  const conceptArticleRows = await storage.getOrderConceptArticles(concept.id);
  const tenantArticles = await storage.getArticles(tenantId);
  const articleMap = new Map(tenantArticles.map((a: any) => [a.id, a]));

  const articleLines = conceptArticleRows.map((ca: any) => {
    const art: any = articleMap.get(ca.articleId);
    const unitPriceOre = ca.unitPrice ?? art?.listPrice ?? 0;
    const qty = ca.quantity || 1;
    return {
      id: ca.id,
      articleId: ca.articleId,
      name: art?.name ?? "Okänd artikel",
      articleNumber: art?.articleNumber ?? "",
      quantity: qty,
      unitPriceKr: unitPriceOre / 100,
      lineTotalKr: (unitPriceOre * qty) / 100,
      costKr: ((art?.cost ?? 0) * qty) / 100,
      productionMinutes: (art?.productionTime ?? 0) * qty,
    };
  });

  // --- Inpekade grenar/kluster med matchade objekt ---
  // ADR v3: objekt-/gren-inpekning föredras; legacy kluster är fallback.
  const { objectIds: targetObjectIds, clusterIds: targetClusterIds } = deriveConceptTargets(concept as any);

  const conceptFiltersRows = await storage.getConceptFilters(concept.id);
  const conceptFilterInputs = conceptFiltersRows.map((f: any) => ({
    metadataKey: f.metadataKey,
    operator: f.operator,
    filterValue: f.filterValue,
  }));

  // En sammanfattnings-"grupp" per inpekad gren-rot resp. kluster. clusterId/
  // clusterName behålls som fältnamn för bakåtkomp med Step7-frontend (visas
  // som "grenar" i objekt-läge).
  const clusterSummaries: any[] = [];
  // Task #1052: totalMatchedObjects MÅSTE vara den DEDUPLICERADE unionen av
  // matchade objekt (samma som sidofältet via condition-preview/resolveTargetObjects),
  // inte en summa per gren. Annars dubbelräknas överlappande val (barn + förfader)
  // och Granska-värdet divergerar från sidofältet. Per-gren-summorna i
  // clusterSummaries är enbart informativ nedbrytning.
  const matchedIdSet = new Set<string>();
  let totalMatchedObjects = 0;

  if (targetObjectIds.length > 0) {
    // Objekt-/gren-inpekning: en sammanfattning per vald gren-rot (subträd).
    const allObjects = await storage.getObjects(tenantId);
    const byId = new Map(allObjects.map((o) => [o.id, o]));
    for (const rootId of targetObjectIds) {
      const root = byId.get(rootId);
      if (!root) continue; // rot borttagen eller utanför tenant
      const branchObjects = await resolveTargetObjects({ tenantId, objectIds: [rootId] });
      const matchedObjects = await filterObjectsByConditions(tenantId, branchObjects, conceptFilterInputs);

      for (const o of matchedObjects) matchedIdSet.add((o as any).id);
      clusterSummaries.push({
        clusterId: rootId,
        clusterName: (root as any).name ?? rootId,
        totalObjects: branchObjects.length,
        matchedObjects: matchedObjects.length,
        samples: matchedObjects.slice(0, 8).map((o: any) => ({
          id: o.id,
          name: o.name,
          address: o.address ?? null,
        })),
      });
    }
  } else {
    // Legacy kluster-inpekning (bakåtkomp, oförändrat beteende).
    for (const clusterId of targetClusterIds) {
      const cluster = await storage.getCluster(clusterId);
      if (!cluster || (cluster as any).tenantId !== tenantId) continue;

      const clusterObjects = await storage.getClusterObjects(clusterId);
      const tenantObjects = clusterObjects.filter((o: any) => o.tenantId === tenantId);
      const matchedObjects = await filterObjectsByConditions(tenantId, tenantObjects as any, conceptFilterInputs);

      for (const o of matchedObjects) matchedIdSet.add((o as any).id);
      clusterSummaries.push({
        clusterId,
        clusterName: (cluster as any).name,
        totalObjects: tenantObjects.length,
        matchedObjects: matchedObjects.length,
        samples: matchedObjects.slice(0, 8).map((o: any) => ({
          id: o.id,
          name: o.name,
          address: o.address ?? null,
        })),
      });
    }
  }

  // Deduplicerad union (== sidofältets condition-preview-count) — driver ordervärdet.
  totalMatchedObjects = matchedIdSet.size;

  // --- Schema ---
  const schedule = {
    type: (concept as any).deliveryTimeType ?? null,
    intervalStartDate: (concept as any).intervalStartDate ?? null,
    intervalEndDate: (concept as any).intervalEndDate ?? null,
    intervalFrequencyDays: (concept as any).intervalFrequencyDays ?? null,
    // Task #978: ± härleds från intervalFlexDays (det wizard faktiskt sparar); legacy
    // `toleranceDays` behålls enbart som fallback för äldre koncept (fixar "var 16:e dag").
    toleranceDays: (concept as any).intervalFlexDays ?? (concept as any).toleranceDays ?? 0,
    timeWindows: (concept as any).timeWindows ?? [],
    mainDeliveryWindows: (concept as any).mainDeliveryWindows ?? [],
    deliveryRestrictions: (concept as any).deliveryRestrictions ?? null,
  };

  // --- Artikelträffar (delad källa, beräknas EN gång) ---
  // Task #979: samma upplösning som /article-hit-summary och /execute så att
  // detaljlistan, sammanfattningen och fasta priset speglar exakt vad expansionen
  // skapar. Länkad aktiv artikel (utgått→ersättning) + enhetspris (öre).
  let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined = undefined;
  let unitPriceOre = 0;
  let linkedArticleName: string | null = null;
  if (concept.articleId) {
    linkedArticle = await resolveActiveArticle(tenantId, await storage.getArticle(concept.articleId));
    if (linkedArticle) {
      linkedArticleName = linkedArticle.name;
      if (concept.customerId) {
        const info = await storage.resolveArticlePrice(tenantId, linkedArticle.id, concept.customerId);
        unitPriceOre = info.price;
      } else {
        unitPriceOre = linkedArticle.listPrice || 0;
      }
    }
  }

  const { matchingObjects: hitMatchObjects } = await resolveConceptMatchingObjects(
    tenantId,
    concept as any,
    conceptFilterInputs,
    { fallbackAllObjects: true },
  );
  const hits = await resolveConceptArticleHits({
    tenantId,
    concept: concept as any,
    linkedArticle,
    matchingObjects: hitMatchObjects,
  });

  // Task #1052: ordervärde = per-objekt-värde × antal matchande objekt, via den
  // DELADE motorn (samma som sidofältet) så Granska och sidofältet alltid är lika.
  // 0 kr när inget matchar. Fast pris (priceModel='fixed') ⇒ per-objekt = fasta
  // priset; annars Σ(enhetspris × antal) över artiklarna.
  const valueArticleInputs = conceptArticleRows.map((ca: any) => {
    const art: any = articleMap.get(ca.articleId);
    return {
      unitPriceOre: ca.unitPrice ?? art?.listPrice ?? 0,
      quantity: ca.quantity || 1,
      costOre: art?.cost ?? 0,
      productionTimeMinutes: art?.productionTime ?? 0,
    };
  });
  const fixedPrice = isFixedPriceConcept(concept as any);

  // --- Repetition (Task #979) ---
  // call_off = engångskörning (avrop), schedule = återkommande, subscription =
  // abonnemang (fakturering, ingen uppgiftsgenerering). Antal generationer kommer
  // från den DELADE buildScheduleDateTargets så preview ≡ körning.
  const method = getOrderConceptMethod(concept as any);
  const scheduleTargets = method === "schedule" ? buildScheduleDateTargets(concept as any) : null;
  const generations =
    method === "schedule" ? (scheduleTargets?.length ?? 0)
    : method === "call_off" ? 1
    : null;
  const generationFactor = generations ?? 1;

  // Task #1055: ordervärdet speglar konceptets fast pris-bas. Vid fast pris baseras
  // totalen på TRÄFF-objekt (hits.hitCount) — inte alla matchade — så Granska
  // stämmer med detaljlistan och expansion. per_task multiplicerar dessutom med
  // antalet generationer (hitCount × generationFactor).
  const orderValue = computeConceptOrderValue({
    matchedCount: totalMatchedObjects,
    articles: valueArticleInputs,
    priceModel: (concept as any).priceModel,
    fixedPriceAmountOre: (concept as any).fixedPriceAmount ?? null,
    fixedPriceBasis: (concept as any).fixedPriceBasis ?? null,
    fixedPriceUnitCount: hits.hitCount,
    taskCount: hits.hitCount * generationFactor,
  });
  const totalValueKr = orderValue.totalValueOre / 100;
  const frequencyDays = (concept as any).intervalFrequencyDays ?? null;
  const flexDays = (concept as any).intervalFlexDays ?? 0;
  let validUntil: string | null = null;
  if (method === "schedule") {
    if (scheduleTargets && scheduleTargets.length > 0) {
      validUntil = scheduleTargets[scheduleTargets.length - 1].date.toISOString();
    } else if ((concept as any).intervalEndDate) {
      validUntil = new Date((concept as any).intervalEndDate).toISOString();
    }
  }
  const freqLabel = frequencyDays && Number(frequencyDays) > 0
    ? (Number(frequencyDays) % 7 === 0 ? `Var ${Number(frequencyDays) / 7}:e vecka` : `Var ${frequencyDays}:e dag`)
    : null;
  let repetitionLabel: string;
  if (method === "subscription") {
    repetitionLabel = "Abonnemang (återkommande fakturering)";
  } else if (method === "call_off") {
    repetitionLabel = "Engångskörning (avrop)";
  } else {
    const parts: string[] = [];
    if (freqLabel) parts.push(freqLabel);
    if (generations != null) parts.push(`${generations} generation${generations === 1 ? "" : "er"}`);
    if (validUntil) parts.push(`giltig t.o.m. ${new Date(validUntil).toLocaleDateString("sv-SE")}`);
    repetitionLabel = parts.length > 0 ? parts.join(", ") : "Återkommande schema";
  }
  const repetition = {
    sourceConceptName: concept.name ?? null,
    method,
    isRecurring: method !== "call_off",
    frequencyDays: frequencyDays != null ? Number(frequencyDays) : null,
    flexDays: Number(flexDays) || 0,
    generations,
    validUntil,
    label: repetitionLabel,
  };

  // --- Detaljlista (Objekt | Uppgift | Antal) + sammanfattning (Task #979) ---
  // Fältuppgifter = en assignment per träffobjekt (→ grovplanering). Admin/logistik
  // + föruppgifter skapas ENBART i avrop-vägen (schema/abonnemang returnerar tidigt
  // i /execute) — speglas här så listan inte överskattar.
  const detailRows: Array<{
    kind: "field" | "pretask" | "admin";
    objectId: string | null;
    objectName: string | null;
    objectNumber: string | null;
    taskName: string;
    quantity: number;
    valueKr: number | null;
    destination: "grovplanering" | "admin";
  }> = [];

  const fieldTaskName = linkedArticleName ?? concept.name ?? "Uppgift";
  // Task #1055: detaljlistan visar en rad per träff-objekt (en generation) ⇒
  // per_concept fördelar det fasta beloppet över träff-objekten; per_object/per_task
  // = fullt belopp per rad.
  const detailFixedDivisor = fixedPriceWoDivisor(concept as any, {
    objectCount: hits.hitCount,
    occurrences: 1,
  });
  let totalFieldQty = 0;
  for (const r of hits.rows) {
    if (!r.isHit) continue;
    const valueOre = computeObjectValueOre(concept as any, unitPriceOre, r.quantity, detailFixedDivisor);
    totalFieldQty += r.quantity;
    detailRows.push({
      kind: "field",
      objectId: r.objectId,
      objectName: r.objectName,
      objectNumber: r.objectNumber,
      taskName: fieldTaskName,
      quantity: r.quantity,
      valueKr: valueOre / 100,
      destination: "grovplanering",
    });
  }

  const materialLines: Array<{ name: string; totalQuantity: number; unit: string }> = [];
  if (linkedArticle) {
    materialLines.push({
      name: linkedArticle.name,
      totalQuantity: totalFieldQty * generationFactor,
      unit: (linkedArticle as any).unit ?? "st",
    });
  }

  let preTaskArticleCount = 0;
  if (method === "call_off") {
    for (const ca of conceptArticleRows) {
      const art: any = articleMap.get(ca.articleId);
      const cat = (ca as any).taskCategory ?? art?.taskCategory ?? "field";
      const isPre = (ca as any).isPreTask === true;
      const qty = ca.quantity ?? 1;
      if (cat && cat !== "field") {
        detailRows.push({
          kind: "admin",
          objectId: null,
          objectName: null,
          objectNumber: null,
          taskName: `${art?.name ?? "Administrativ uppgift"} (administrativ)`,
          quantity: qty,
          valueKr: null,
          destination: "admin",
        });
        materialLines.push({ name: art?.name ?? "Artikel", totalQuantity: qty, unit: art?.unit ?? "st" });
      } else if (isPre) {
        preTaskArticleCount++;
        detailRows.push({
          kind: "pretask",
          objectId: null,
          objectName: null,
          objectNumber: null,
          taskName: `${art?.name ?? "Föruppgift"} (föruppgift, per träffobjekt)`,
          quantity: qty,
          valueKr: null,
          destination: "grovplanering",
        });
        materialLines.push({ name: art?.name ?? "Artikel", totalQuantity: qty * hits.hitCount, unit: art?.unit ?? "st" });
      }
    }
  }

  const summaryMetrics = {
    objectsHit: hits.hitCount,
    objectsMissed: hits.missCount,
    inpekadeCount: hits.inpekadeCount,
    // Fältuppgifter som skickas till grovplaneringen (per träffobjekt × generationer).
    taskCount: hits.hitCount * generationFactor,
    adminTaskCount: detailRows.filter((d) => d.kind === "admin").length,
    preTaskCount: preTaskArticleCount * hits.hitCount,
    // Display-aggregat: länkad artikels produktionstid × träff-antal × generationer.
    productionMinutesActual: (linkedArticle?.productionTime ?? 0) * totalFieldQty * generationFactor,
    materialLines,
  };

  res.json({
    clusterSummaries,
    totalMatchedObjects,
    articleLines,
    totalValueKr,
    totalCostKr: orderValue.totalCostOre / 100,
    totalProductionMinutes: orderValue.productionMinutes,
    schedule,
    isFixedPrice: fixedPrice,
    fixedPriceAmountKr: fixedPrice ? (concept.fixedPriceAmount ?? 0) / 100 : null,
    detailRows,
    summaryMetrics,
    repetition,
  });
}));

// Task #976: Resultat av artikelträffar — vilka inpekade objekt den länkade artikeln
// FAKTISKT träffar (metadata-/formeldrivet antal > 0), per-objekt-värde med konceptets
// fasta pris och aggregerade totaler. Delad källa med execute/preview/run-rolling via
// resolveConceptArticleHits. Driver <ArticleHitResult> i wizardens steg 7.
app.get("/api/order-concepts/:id/article-hit-summary", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const rawConcept = await storage.getOrderConcept(req.params.id);
  const concept = verifyTenantOwnership(rawConcept, tenantId);
  if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

  // Länkad aktiv artikel (utgått→ersättning) + löpande enhetspris (öre).
  let linkedArticle: Awaited<ReturnType<typeof storage.getArticle>> | undefined = undefined;
  let unitPriceOre = 0;
  let articleName: string | null = null;
  if (concept.articleId) {
    linkedArticle = await resolveActiveArticle(tenantId, await storage.getArticle(concept.articleId));
    if (linkedArticle) {
      articleName = linkedArticle.name;
      if (concept.customerId) {
        const info = await storage.resolveArticlePrice(tenantId, linkedArticle.id, concept.customerId);
        unitPriceOre = info.price;
      } else {
        unitPriceOre = linkedArticle.listPrice || 0;
      }
    }
  }

  const filters = await storage.getConceptFilters(concept.id);
  const filterInputs = filters.map((f: any) => ({
    metadataKey: f.metadataKey,
    operator: f.operator,
    filterValue: f.filterValue,
  }));
  const { matchingObjects } = await resolveConceptMatchingObjects(
    tenantId,
    concept as any,
    filterInputs,
    { fallbackAllObjects: true },
  );

  const hits = await resolveConceptArticleHits({
    tenantId,
    concept: concept as any,
    linkedArticle,
    matchingObjects,
  });

  const fixed = isFixedPriceConcept(concept as any);
  // Task #1055: en rad per träff-objekt (en generation) ⇒ per_concept fördelar fasta
  // beloppet över träff-objekten; per_object/per_task = fullt belopp.
  const summaryFixedDivisor = fixedPriceWoDivisor(concept as any, {
    objectCount: hits.hitCount,
    occurrences: 1,
  });
  const rows = hits.rows.map((r) => {
    const valueOre = r.isHit ? computeObjectValueOre(concept as any, unitPriceOre, r.quantity, summaryFixedDivisor) : 0;
    return {
      objectId: r.objectId,
      objectName: r.objectName,
      objectNumber: r.objectNumber,
      address: r.address,
      isHit: r.isHit,
      quantity: r.quantity,
      metadataValue: r.metadataValue,
      formulaValue: r.formulaValue,
      valueOre,
      valueKr: valueOre / 100,
    };
  });
  const totalValueOre = rows.reduce((s, r) => s + r.valueOre, 0);

  res.json({
    conceptId: concept.id,
    articleId: linkedArticle?.id ?? null,
    articleName,
    priceModel: concept.priceModel ?? "running",
    isFixedPrice: fixed,
    fixedPriceAmountOre: fixed ? (concept.fixedPriceAmount ?? null) : null,
    unitPriceOre,
    isMetadataDriven: hits.isMetadataDriven,
    quantityFieldLabel: hits.quantityFieldLabel,
    inpekadeCount: hits.inpekadeCount,
    hitCount: hits.hitCount,
    missCount: hits.missCount,
    totalValueOre,
    totalValueKr: totalValueOre / 100,
    rows,
  });
}));

// ============================================
// PDF-EXPORT
// ============================================

app.get("/api/order-concepts/:id/export-pdf", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

    const { jsPDF } = await import("jspdf");

    const customer = concept.customerId ? await storage.getCustomer(concept.customerId) : null;

    const [conceptObjectRows, conceptArticles, schedules, filters] = await Promise.all([
      db
        .select({
          objectName: objects.name,
          objectAddress: objects.address,
          objectType: objects.objectType,
          included: orderConceptObjects.included,
        })
        .from(orderConceptObjects)
        .leftJoin(objects, eq(orderConceptObjects.objectId, objects.id))
        .where(and(
          eq(orderConceptObjects.orderConceptId, concept.id),
          eq(orderConceptObjects.included, true),
        ))
        .orderBy(orderConceptObjects.sortOrder),
      db
        .select({
          articleName: articles.name,
          articleNumber: articles.articleNumber,
          quantity: orderConceptArticles.quantity,
          unitPrice: orderConceptArticles.unitPrice,
          taskCategory: orderConceptArticles.taskCategory,
        })
        .from(orderConceptArticles)
        .leftJoin(articles, eq(orderConceptArticles.articleId, articles.id))
        .where(eq(orderConceptArticles.orderConceptId, concept.id))
        .orderBy(orderConceptArticles.sortOrder),
      storage.getDeliverySchedules(concept.id),
      storage.getConceptFilters(concept.id),
    ]);

    // Använd sparade ekonomifält från konceptet (sätts av wizarden, stored i kr/h).
    const storedTotalValue = concept.totalValue ?? 0;
    const storedTotalCost = concept.totalCost ?? 0;
    const storedEstimatedHours = concept.estimatedHours ?? 0;

    const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const W = 210;
    const margin = 18;
    const contentW = W - margin * 2;
    let y = 18;

    const COLOR_HEADER = [27, 75, 107] as [number, number, number];   // Deep Ocean Blue
    const COLOR_ROW_ALT = [232, 244, 248] as [number, number, number]; // Arctic Ice
    const COLOR_TEXT = [44, 62, 80] as [number, number, number];       // Midnight Navy
    const COLOR_MUTED = [107, 124, 140] as [number, number, number];   // Mountain Gray

    // ---- Header ----
    doc.setFillColor(...COLOR_HEADER);
    doc.rect(0, 0, W, 30, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Orderkoncept — sammanfattning", margin, 13);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Exporterat ${new Date().toLocaleDateString("sv-SE")}`, margin, 20);
    if (concept.name) {
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(concept.name, margin, 27);
    }
    y = 38;

    // ---- Helper functions ----
    const sectionTitle = (title: string) => {
      doc.setFillColor(...COLOR_HEADER);
      doc.rect(margin, y, contentW, 7, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(title, margin + 2, y + 5);
      y += 9;
    };

    const kv = (label: string, value: string, col = 0) => {
      const colW = contentW / 2;
      const x = margin + col * colW;
      doc.setTextColor(...COLOR_MUTED);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(label, x, y);
      doc.setTextColor(...COLOR_TEXT);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text(value || "—", x, y + 4);
    };

    // ---- Sammanfattning ----
    sectionTitle("Sammanfattning");
    kv("Namn", concept.name || "—", 0);
    kv("Kund", customer?.name || (concept.customerId ? `(id: ${concept.customerId.slice(0, 8)})` : "Från metadata"), 1);
    y += 10;
    kv("Matchade objekt", String(conceptObjectRows.length), 0);
    kv("Villkorsfilter", String(filters.length), 1);
    y += 10;
    kv("Artiklar/uppgifter", String(conceptArticles.length), 0);
    kv("Faktureringsmetod", { call_off: "Efterfakturering", schedule: "Efterfakturering (schemalagd)", subscription: "Abonnemang" }[getOrderConceptMethod(concept)], 1);
    y += 10;
    kv("Beräknat ordervärde", `${storedTotalValue.toLocaleString("sv-SE")} kr`, 0);
    kv("Beräknad kostnad", `${storedTotalCost.toLocaleString("sv-SE")} kr`, 1);
    y += 10;
    kv("Beräknad arbetstid", `${storedEstimatedHours.toFixed(1)} h`, 0);
    kv("Scheman", String(schedules.length), 1);
    y += 14;

    // ---- Objekt ----
    if (conceptObjectRows.length > 0) {
      if (y > 240) { doc.addPage(); y = 18; }
      sectionTitle(`Matchade objekt (${conceptObjectRows.length})`);

      const cols = [contentW * 0.45, contentW * 0.35, contentW * 0.2];
      const headers = ["Namn", "Adress", "Typ"];
      doc.setFillColor(...COLOR_HEADER);
      doc.rect(margin, y, contentW, 6, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      let cx = margin + 2;
      headers.forEach((h, i) => { doc.text(h, cx, y + 4); cx += cols[i]; });
      y += 6;

      conceptObjectRows.slice(0, 80).forEach((obj, idx) => {
        if (y > 270) { doc.addPage(); y = 18; }
        if (idx % 2 === 0) {
          doc.setFillColor(...COLOR_ROW_ALT);
          doc.rect(margin, y, contentW, 6, "F");
        }
        doc.setTextColor(...COLOR_TEXT);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        cx = margin + 2;
        const cells = [
          doc.splitTextToSize(obj.objectName || "—", cols[0] - 4)[0],
          doc.splitTextToSize(obj.objectAddress || "—", cols[1] - 4)[0],
          obj.objectType || "—",
        ];
        cells.forEach((cell, i) => { doc.text(String(cell), cx, y + 4); cx += cols[i]; });
        y += 6;
      });
      if (conceptObjectRows.length > 80) {
        doc.setTextColor(...COLOR_MUTED);
        doc.setFontSize(8);
        doc.text(`… och ${conceptObjectRows.length - 80} till.`, margin + 2, y + 4);
        y += 8;
      }
      y += 4;
    }

    // ---- Artiklar ----
    if (conceptArticles.length > 0) {
      if (y > 230) { doc.addPage(); y = 18; }
      sectionTitle(`Artiklar / uppgifter (${conceptArticles.length})`);

      const cols2 = [contentW * 0.15, contentW * 0.45, contentW * 0.15, contentW * 0.15, contentW * 0.1];
      const headers2 = ["Art.nr", "Namn", "Antal", "À-pris (kr)", "Typ"];
      doc.setFillColor(...COLOR_HEADER);
      doc.rect(margin, y, contentW, 6, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      let cx2 = margin + 2;
      headers2.forEach((h, i) => { doc.text(h, cx2, y + 4); cx2 += cols2[i]; });
      y += 6;

      const categoryLabel: Record<string, string> = {
        field: "Fält",
        admin: "Admin",
        logistics: "Logistik",
      };

      conceptArticles.forEach((art, idx) => {
        if (y > 270) { doc.addPage(); y = 18; }
        if (idx % 2 === 0) {
          doc.setFillColor(...COLOR_ROW_ALT);
          doc.rect(margin, y, contentW, 6, "F");
        }
        doc.setTextColor(...COLOR_TEXT);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        cx2 = margin + 2;
        const unitPriceKr = art.unitPrice != null ? (art.unitPrice / 100).toLocaleString("sv-SE") : "—";
        const cells2 = [
          art.articleNumber || "—",
          doc.splitTextToSize(art.articleName || "—", cols2[1] - 4)[0],
          String(art.quantity ?? 1),
          unitPriceKr,
          categoryLabel[art.taskCategory || "field"] || art.taskCategory || "—",
        ];
        cells2.forEach((cell, i) => { doc.text(String(cell), cx2, y + 4); cx2 += cols2[i]; });
        y += 6;
      });
      y += 4;
    }

    // ---- Scheman ----
    if (schedules.length > 0) {
      if (y > 240) { doc.addPage(); y = 18; }
      sectionTitle(`Leveransscheman (${schedules.length})`);
      const weekdayNames = ["Sön", "Mån", "Tis", "Ons", "Tor", "Fre", "Lör"];
      const periodicityLabel: Record<string, string> = {
        days: "dagar",
        weeks: "veckor",
        months: "månader",
        years: "år",
      };
      schedules.forEach((s, idx) => {
        if (y > 270) { doc.addPage(); y = 18; }
        if (idx % 2 === 0) {
          doc.setFillColor(...COLOR_ROW_ALT);
          doc.rect(margin, y, contentW, 6, "F");
        }
        doc.setTextColor(...COLOR_TEXT);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        const freq = `${s.periodicityValue ?? 1} ${periodicityLabel[s.periodicityUnit ?? "months"] ?? s.periodicityUnit}`;
        const weekday = s.preferredWeekday != null ? weekdayNames[s.preferredWeekday] : "—";
        const time = s.preferredTimeFrom ? `${s.preferredTimeFrom}–${s.preferredTimeTo ?? ""}` : "—";
        const line = `Intervall: ${freq}  |  Dag: ${weekday}  |  Tid: ${time}${s.season ? `  |  Säsong: ${s.season}` : ""}`;
        doc.text(line, margin + 2, y + 4);
        y += 6;
      });
      y += 4;
    }

    // ---- Footer ----
    const pageCount = (doc as any).getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFillColor(...COLOR_HEADER);
      doc.rect(0, 290, W, 10, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text("Traivo — konfidentiellt dokument", margin, 296);
      doc.text(`Sida ${i} / ${pageCount}`, W - margin - 15, 296);
    }

    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    const safeName = (concept.name || "orderkoncept").replace(/[^a-zA-Z0-9_\- åäöÅÄÖ]/g, "_").slice(0, 60);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeName)}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
}));


app.post("/api/order-concepts/:id/save-as-template", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    const source = verifyTenantOwnership(await storage.getOrderConcept(req.params.id), tenantId);
    if (!source) throw new NotFoundError("Orderkoncept hittades inte");

    const templateName: string = typeof req.body?.name === "string" && req.body.name.trim()
      ? req.body.name.trim()
      : `${source.name} (mall)`;

    const created = await copyConcept(source, tenantId, userId, {
      name: templateName,
      status: "template",
      copyObjects: false,
    });
    res.status(201).json(created);
}));

// Steg 7 & list: Kopiera koncept (valfritt peka om till andra kluster/grenar).
app.post("/api/order-concepts/:id/copy", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.session?.user?.id;
    const source = verifyTenantOwnership(await storage.getOrderConcept(req.params.id), tenantId);
    if (!source) throw new NotFoundError("Orderkoncept hittades inte");

    const targetClusterIds: string[] | undefined = Array.isArray(req.body?.targetClusterIds)
      ? req.body.targetClusterIds
      : undefined;
    const name: string = typeof req.body?.name === "string" && req.body.name.trim()
      ? req.body.name.trim()
      : `${source.name} (kopia)`;
    const asTemplate = req.body?.asTemplate === true;

    const created = await copyConcept(source, tenantId, userId, {
      name,
      status: asTemplate ? "template" : "draft",
      targetClusterIds,
      copyObjects: !targetClusterIds,
    });
    res.status(201).json(created);
}));

// ============================================
// FAS 4: SIMULERING, AUTO-UPPDATERING & FAKTURERINGSSYNK
// ============================================

// Simulering: Beräknar uppskattat antal jobb per månad de nästa 12 månaderna.
app.get("/api/order-concepts/:id/simulate", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

    const conceptObjectRows = await storage.getOrderConceptObjects(concept.id);
    const objectCount = conceptObjectRows.length || (concept as any).totalObjects || 0;

    const deliveryTimeType = (concept as any).deliveryTimeType as string | null;
    const timeWindows = (concept as any).timeWindows as Array<{ months: number[]; weekdays: number[] }> | null;
    const intervalFrequencyDays = (concept as any).intervalFrequencyDays as number | null;

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
    const now = new Date();
    const periods: Array<{ year: number; month: number; label: string; jobCount: number; weeklyAvg: number }> = [];

    for (let m = 0; m < 12; m++) {
        const date = new Date(now.getFullYear(), now.getMonth() + m, 1);
        const year = date.getFullYear();
        const month = date.getMonth() + 1; // 1-indexerat
        const daysInMonth = new Date(year, month, 0).getDate();
        const label = `${monthNames[month - 1]} ${year}`;
        let jobCount = 0;

        if (deliveryTimeType === "interval" && intervalFrequencyDays && intervalFrequencyDays > 0) {
            jobCount = Math.ceil(daysInMonth / intervalFrequencyDays) * objectCount;
        } else if (deliveryTimeType === "time_window" && Array.isArray(timeWindows) && timeWindows.length > 0) {
            for (const tw of timeWindows) {
                if (!Array.isArray(tw.months) || !Array.isArray(tw.weekdays)) continue;
                if (!tw.months.includes(month)) continue;
                let matchingDays = 0;
                for (let d = 1; d <= daysInMonth; d++) {
                    const wd = new Date(year, month - 1, d).getDay();
                    if (tw.weekdays.includes(wd)) matchingDays++;
                }
                jobCount += matchingDays * objectCount;
            }
        } else if (concept.deliverySchedule) {
            const schedule = concept.deliverySchedule as any[];
            const monthEntries = schedule.filter((s: any) => s.month === 0 || s.month === month);
            jobCount = monthEntries.length * objectCount;
        } else if (getOrderConceptMethod(concept) === "schedule" && concept.intervalDays && concept.intervalDays > 0) {
            jobCount = Math.ceil(daysInMonth / concept.intervalDays) * objectCount;
        } else if (getOrderConceptMethod(concept) === "subscription") {
            jobCount = objectCount;
        }

        const weeksInMonth = daysInMonth / 7;
        periods.push({ year, month, label, jobCount, weeklyAvg: Math.round((jobCount / weeksInMonth) * 10) / 10 });
    }

    const totalJobs = periods.reduce((s, p) => s + p.jobCount, 0);
    res.json({
        objectCount,
        periods,
        summary: {
            totalJobs,
            monthlyAvg: Math.round((totalJobs / 12) * 10) / 10,
            weeklyAvg: Math.round((totalJobs / 52) * 10) / 10,
        },
    });
}));

// Auto-uppdatering: Detekterar förändringar i underliggande data (objekt, metadata).
app.post("/api/order-concepts/:id/detect-changes", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

    const filters = await storage.getConceptFilters(concept.id);
    const filterInputs = filters.map((f: any) => ({
        metadataKey: f.metadataKey,
        operator: f.operator,
        filterValue: f.filterValue,
    }));
    // Resolva mål (gren-subträd → legacy kluster → alla) + matcha via delad
    // modul, identiskt med execute/preview.
    const { matchingObjects: nowMatchingObjects } = await resolveConceptMatchingObjects(
        tenantId,
        concept as any,
        filterInputs,
        { fallbackAllObjects: true },
    );

    const currentObjectRows = await storage.getOrderConceptObjects(concept.id);
    const currentObjectIds = new Set(currentObjectRows.map((r: any) => r.objectId));
    const nowMatchingIds = new Set(nowMatchingObjects.map((o: any) => o.id));

    const addedObjects = nowMatchingObjects
        .filter((o: any) => !currentObjectIds.has(o.id))
        .map((o: any) => ({ id: o.id, name: o.name, address: o.address }));

    const removedObjects = currentObjectRows
        .filter((r: any) => !nowMatchingIds.has(r.objectId))
        .map((r: any) => ({ id: r.objectId, name: (r as any).objectName || r.objectId }));

    const unchangedCount = currentObjectRows.filter((r: any) => nowMatchingIds.has(r.objectId)).length;

    res.json({
        hasChanges: addedObjects.length > 0 || removedObjects.length > 0,
        added: addedObjects.slice(0, 100),
        removed: removedObjects.slice(0, 100),
        unchangedCount,
        totalMatchingNow: nowMatchingObjects.length,
        totalInConcept: currentObjectRows.length,
        summary: { addedCount: addedObjects.length, removedCount: removedObjects.length, unchangedCount },
    });
}));

// Faktureringssynk: Hämtar faktureringsstatus för konceptets genererade uppdrag.
app.get("/api/order-concepts/:id/invoicing-status", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rawConcept = await storage.getOrderConcept(req.params.id);
    const concept = verifyTenantOwnership(rawConcept, tenantId);
    if (!concept) throw new NotFoundError("Orderkoncept hittades inte");

    const rows = await db.select({
        id: assignmentsTable.id,
        status: assignmentsTable.status,
        completedAt: assignmentsTable.completedAt,
        invoicedAt: assignmentsTable.invoicedAt,
        scheduledDate: assignmentsTable.scheduledDate,
    })
    .from(assignmentsTable)
    .where(and(
        eq(assignmentsTable.tenantId, tenantId),
        eq(assignmentsTable.orderConceptId, concept.id),
        isNull(assignmentsTable.deletedAt),
    ));

    const statusCounts: Record<string, number> = {};
    let invoicedCount = 0;
    let completedNotInvoiced = 0;
    for (const row of rows) {
        statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
        if (row.invoicedAt) invoicedCount++;
        if (row.completedAt && !row.invoicedAt) completedNotInvoiced++;
    }

    const fortnoxConfig = await storage.getFortnoxConfig(tenantId);
    const fortnoxConnected = !!(fortnoxConfig?.accessToken && fortnoxConfig?.isActive);

    res.json({
        totalAssignments: rows.length,
        statusCounts,
        invoicedCount,
        completedNotInvoiced,
        fortnoxConnected,
        priceListId: (concept as any).priceListId || null,
        invoiceLevel: (concept as any).invoiceLevel || null,
        customerId: (concept as any).customerId || null,
    });
}));

// Hjälpfunktion: djupkopiera ett koncept med filter, artiklar, scheman och konfig.
async function copyConcept(
  source: any,
  tenantId: string,
  userId: string | undefined,
  opts: { name: string; status: string; targetClusterIds?: string[]; copyObjects?: boolean },
) {
    const { id, createdAt, updatedAt, createdBy, ...rest } = source;
    const newConcept = await storage.createOrderConcept({
      ...rest,
      tenantId,
      createdBy: userId,
      name: opts.name,
      status: opts.status,
      ...(opts.targetClusterIds ? { targetClusterIds: opts.targetClusterIds } : {}),
    });

    // Kopiera villkorsfilter.
    const filters = await storage.getConceptFilters(source.id);
    for (const f of filters) {
      const { id: _fid, orderConceptId: _ocid, createdAt: _fca, ...frest } = f as any;
      await storage.createConceptFilter({ ...frest, orderConceptId: newConcept.id });
    }

    // Kopiera artiklar.
    const articleRows = await storage.getOrderConceptArticles(source.id);
    if (articleRows.length > 0) {
      await db.insert(orderConceptArticles).values(
        articleRows.map((a: any) => {
          const { id: _aid, orderConceptId: _aocid, createdAt: _aca, ...arest } = a;
          return { ...arest, orderConceptId: newConcept.id };
        }),
      );
    }

    // Kopiera leveransscheman, fakturakonfig och dokumentkonfig.
    const schedules = await storage.getDeliverySchedules(source.id);
    if (schedules.length > 0) {
      await storage.upsertDeliverySchedules(newConcept.id, schedules.map((s: any) => {
        const { id: _sid, orderConceptId: _socid, createdAt: _sca, ...srest } = s;
        return { ...srest, orderConceptId: newConcept.id };
      }));
    }
    const invoiceConfig = await storage.getInvoiceConfiguration(source.id);
    if (invoiceConfig) {
      const { id: _iid, orderConceptId: _iocid, createdAt: _ica, ...irest } = invoiceConfig as any;
      await storage.upsertInvoiceConfiguration({ ...irest, orderConceptId: newConcept.id });
    }
    const docConfigs = await storage.getDocumentConfigurations(source.id);
    if (docConfigs.length > 0) {
      await storage.upsertDocumentConfigurations(newConcept.id, docConfigs.map((d: any) => {
        const { id: _did, orderConceptId: _docid, createdAt: _dca, ...drest } = d;
        return { ...drest, orderConceptId: newConcept.id };
      }));
    }

    // Kopiera objekt om vi inte pekar om till andra grenar.
    if (opts.copyObjects) {
      const conceptObjects = await storage.getOrderConceptObjects(source.id);
      if (conceptObjects.length > 0) {
        await storage.addOrderConceptObjects(conceptObjects.map((o: any) => ({
          orderConceptId: newConcept.id,
          objectId: o.objectId,
        })));
      }
    }

    return newConcept;
}

}
