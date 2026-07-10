import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { AppError, NotFoundError, ValidationError, ForbiddenError, ConflictError } from "../errors";
import { insertArticleSchema, insertArticleTypeDefinitionSchema, insertExecutionCodeDefinitionSchema, insertTimeCodeDefinitionSchema, insertIconDefinitionSchema, insertArticleComponentSchema, insertPriceListSchema, insertPriceListArticleSchema, insertResourceArticleSchema, insertVehicleSchema, insertEquipmentSchema, insertResourceVehicleSchema, insertResourceEquipmentSchema, insertResourceAvailabilitySchema, insertVehicleScheduleSchema, insertSubscriptionSchema, insertTeamSchema, insertTeamMemberSchema, insertPlanningParameterSchema, insertResourceProfileSchema, insertResourceProfileAssignmentSchema, insertWorkSessionSchema, insertWorkEntrySchema, insertFuelLogSchema, insertMaintenanceLogSchema, workSessions, workEntries, timeLogs, equipmentBookings } from "@shared/schema";
import { getISOWeek, getStartOfISOWeek } from "./helpers";
import { notificationService } from "../notifications";
import { TASK_TYPE_KEYS, TASK_TYPE_LABELS } from "../grovplanering-grid";
import { parseFormula } from "../metadata-formula";
import { getAllMetadataTypes } from "../metadata-queries";

// Validerar artikelns antals-formel (Antalskälla "Formel") vid spara. Kastar
// ValidationError (400, svenska) vid syntaxfel, tom formel, eller referens till ett
// metadatafält som inte finns i tenantens katalog. Saknade VÄRDEN vid utförande
// hanteras mjukt i resolvern (server/article-quantity-resolver.ts) — här fångas bara
// fel som går att upptäcka redan vid konfigurering.
async function validateQuantityFormulaOrThrow(formula: string | null | undefined, tenantId: string): Promise<void> {
  const trimmed = (formula ?? "").trim();
  if (!trimmed) {
    throw new ValidationError("Formel saknas. Ange en formel, t.ex. [Antal kärl] * 2.");
  }
  let refs: string[];
  try {
    ({ refs } = parseFormula(trimmed));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ogiltig formel.";
    throw new ValidationError(`Ogiltig formel: ${msg}`);
  }
  if (refs.length === 0) {
    throw new ValidationError("Formeln måste referera minst ett metadatafält, t.ex. [Antal kärl] * 2.");
  }
  const types = await getAllMetadataTypes(tenantId);
  const known = new Set(types.map((t) => t.namn));
  const unknown = refs.filter((r) => !known.has(r));
  if (unknown.length > 0) {
    throw new ValidationError(
      `Okänt metadatafält i formeln: ${unknown.map((u) => `"${u}"`).join(", ")}. Kontrollera att fältnamnet matchar ett befintligt metadatafält exakt.`,
    );
  }
}

export async function registerConfigRoutes(app: Express) {
// ============== ARTICLES ==============
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Neutralisera formula-injection i Excel/Sheets: prefixa apostrof om värdet
  // börjar med =, +, -, @, TAB eller CR. Apostrofen visas inte i kalkylprogrammet.
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(headers: string[], rows: (unknown[])[]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

app.get("/api/articles/export.csv", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const list = await storage.getArticles(tenantId);
    const headers = ["articleNumber","name","description","articleType","productionTime","cost","listPrice","unit","executionCode","status"];
    const rows = list.map((a: any) => [
      a.articleNumber, a.name, a.description ?? "", a.articleType,
      a.productionTime ?? 0, a.cost ?? 0, a.listPrice ?? 0,
      a.unit ?? "st", a.executionCode ?? "", a.status ?? "active",
    ]);
    const csv = rowsToCsv(headers, rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="artiklar-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
}));

app.get("/api/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const page = parseInt(req.query.page as string);
    const limit = Math.min(parseInt(req.query.limit as string) || 0, 200);
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const articleType = typeof req.query.articleType === "string" ? req.query.articleType : undefined;
    const hookLevel = typeof req.query.hookLevel === "string" ? req.query.hookLevel : undefined;
    if (page > 0 && limit > 0) {
      const offset = (page - 1) * limit;
      const filters = (articleType || hookLevel) ? { articleType, hookLevel } : undefined;
      const result = await storage.getArticlesPaginated(tenantId, limit, offset, search, filters);
      return res.json({ data: result.articles, total: result.total, page, limit });
    }
    const articles = await storage.getArticles(tenantId);
    res.json(articles);
}));

// Realtidsvalidering av artikelnummer (per-tenant dubblettskydd). Måste registreras
// FÖRE "/api/articles/:id" annars skuggas den av :id-routen.
app.get("/api/articles/validate-number", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const number = typeof req.query.number === "string" ? req.query.number.trim() : "";
    const excludeId = typeof req.query.excludeId === "string" ? req.query.excludeId : undefined;
    if (!number) return res.json({ available: false, reason: "empty" });
    const existing = await storage.getArticleByNumber(tenantId, number, excludeId);
    if (existing) {
      return res.json({ available: false, reason: "duplicate", existingId: existing.id, existingName: existing.name });
    }
    return res.json({ available: true });
}));

app.get("/api/articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const article = await storage.getArticle(req.params.id);
    const verified = verifyTenantOwnership(article, tenantId);
    if (!verified) throw new NotFoundError("Artikel hittades inte");
    res.json(verified);
}));

app.post("/api/articles", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertArticleSchema.parse({ ...req.body, tenantId });
    if (data.quantityMode === "formula") {
      await validateQuantityFormulaOrThrow(data.quantityFormula, tenantId);
    }
    if (data.articleNumber && data.articleNumber.trim()) {
      const dup = await storage.getArticleByNumber(tenantId, data.articleNumber);
      if (dup) {
        throw new ConflictError(`Artikelnummer "${data.articleNumber.trim()}" används redan av "${dup.name}".`);
      }
    }
    if (data.replacementArticleId) {
      const repl = await storage.getArticle(data.replacementArticleId);
      if (!verifyTenantOwnership(repl, tenantId)) {
        throw new ValidationError("Ersättningsartikeln hittades inte i denna tenant");
      }
    }
    if (data.defaultSupplierId) {
      const supplier = await storage.getSupplier(data.defaultSupplierId, tenantId);
      if (!supplier) {
        throw new ValidationError("Leverantören hittades inte i denna tenant");
      }
    }
    // Task #837: Fortnox-koppling. Frontend skickar `fortnoxArticleNumber` vid sidan
    // av artikeldatan när användaren valt en artikel ur Fortnox-registret. Kopplingen
    // lagras i fortnox_mappings (entityType="article") och är det Fortnox-export
    // faktiskt läser — inte article.articleNumber.
    const fnxNumber = typeof req.body.fortnoxArticleNumber === "string"
      ? req.body.fortnoxArticleNumber.trim()
      : "";
    if (fnxNumber) {
      const existingMappings = await storage.getFortnoxMappings(tenantId, "article");
      if (existingMappings.some((m) => m.fortnoxId === fnxNumber)) {
        throw new ConflictError(`Fortnox-artikelnumret "${fnxNumber}" är redan kopplat till en annan artikel.`);
      }
    }
    const article = await storage.createArticle(data);
    if (fnxNumber) {
      await storage.createFortnoxMapping({
        tenantId,
        entityType: "article",
        unicornId: article.id,
        fortnoxId: fnxNumber,
      });
    }
    res.status(201).json(article);
}));

app.patch("/api/articles/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getArticle(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Artikel hittades inte");
    }
    const updateSchema = insertArticleSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    // Validera formeln när den sparade artikeln blir/förblir formel-läge.
    const effectiveQuantityMode = updateData.quantityMode ?? existing?.quantityMode;
    if (effectiveQuantityMode === "formula") {
      const effectiveFormula = updateData.quantityFormula ?? existing?.quantityFormula ?? "";
      await validateQuantityFormulaOrThrow(effectiveFormula, tenantId);
    }
    if (typeof updateData.articleNumber === "string" && updateData.articleNumber.trim()) {
      const dup = await storage.getArticleByNumber(tenantId, updateData.articleNumber, req.params.id);
      if (dup) {
        throw new ConflictError(`Artikelnummer "${updateData.articleNumber.trim()}" används redan av "${dup.name}".`);
      }
    }
    if (updateData.replacementArticleId) {
      if (updateData.replacementArticleId === req.params.id) {
        throw new ValidationError("En artikel kan inte vara sin egen ersättning");
      }
      const repl = await storage.getArticle(updateData.replacementArticleId);
      if (!verifyTenantOwnership(repl, tenantId)) {
        throw new ValidationError("Ersättningsartikeln hittades inte i denna tenant");
      }
    }
    if (updateData.defaultSupplierId) {
      const supplier = await storage.getSupplier(updateData.defaultSupplierId, tenantId);
      if (!supplier) {
        throw new ValidationError("Leverantören hittades inte i denna tenant");
      }
    }
    // Task #837: Fortnox-koppling. `fortnoxArticleNumber` skickas bara med när
    // användaren faktiskt rört Fortnox-fältet (val eller fritext som bryter länken).
    // Saknas nyckeln lämnas befintlig koppling orörd; tom sträng/null tar bort den.
    const hasFnxKey = Object.prototype.hasOwnProperty.call(req.body, "fortnoxArticleNumber");
    const fnxNumber = hasFnxKey && typeof req.body.fortnoxArticleNumber === "string"
      ? req.body.fortnoxArticleNumber.trim()
      : "";
    if (hasFnxKey && fnxNumber) {
      const existingMappings = await storage.getFortnoxMappings(tenantId, "article");
      if (existingMappings.some((m) => m.fortnoxId === fnxNumber && m.unicornId !== req.params.id)) {
        throw new ConflictError(`Fortnox-artikelnumret "${fnxNumber}" är redan kopplat till en annan artikel.`);
      }
    }
    const article = await storage.updateArticle(req.params.id, updateData);
    if (!article) throw new NotFoundError("Artikel hittades inte");
    if (hasFnxKey) {
      if (fnxNumber) {
        const current = await storage.getFortnoxMapping(tenantId, "article", req.params.id);
        if (current) {
          if (current.fortnoxId !== fnxNumber) {
            await storage.updateFortnoxMapping(current.id, tenantId, { fortnoxId: fnxNumber, lastSyncedAt: new Date() });
          }
        } else {
          await storage.createFortnoxMapping({
            tenantId,
            entityType: "article",
            unicornId: req.params.id,
            fortnoxId: fnxNumber,
          });
        }
      } else {
        await storage.deleteFortnoxMappingsForEntity("article", req.params.id);
      }
    }
    res.json(article);
}));

app.delete("/api/articles/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getArticle(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Artikel hittades inte");
    }
    await storage.deleteArticle(req.params.id);
    res.status(204).send();
}));

// ============== ARTICLE TYPE REGISTRY (Task #834) ==============
// Per-tenant katalog över artikeltyper. `key` är back-compat med fri text i
// articles.articleType. Läsning är öppen för tenant-medlemmar; skrivning kräver admin.
app.get("/api/article-types", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  // Seed-on-read: säkerställ att tenanten alltid har systemstandarderna även
  // innan startup-seedningen hunnit köra (idempotent, insert-only).
  let list = await storage.getArticleTypeDefinitions(tenantId);
  if (list.length === 0) {
    await storage.seedArticleTypeDefinitions(tenantId);
    list = await storage.getArticleTypeDefinitions(tenantId);
  }
  res.json(list);
}));

app.post("/api/article-types", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertArticleTypeDefinitionSchema.parse({ ...req.body, tenantId, isSystem: false });
  const existing = await storage.getArticleTypeDefinitions(tenantId);
  if (existing.some((t) => t.key === data.key)) {
    throw new ConflictError(`Artikeltypen med nyckel "${data.key}" finns redan.`);
  }
  const created = await storage.createArticleTypeDefinition(data);
  res.status(201).json(created);
}));

app.patch("/api/article-types/:id", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getArticleTypeDefinition(req.params.id, tenantId);
  if (!existing) throw new NotFoundError("Artikeltyp hittades inte");
  const patchSchema = insertArticleTypeDefinitionSchema
    .partial()
    .omit({ tenantId: true, key: true, isSystem: true, deletedAt: true });
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
  const updated = await storage.updateArticleTypeDefinition(req.params.id, tenantId, parsed.data);
  res.json(updated);
}));

// Aldrig hard-delete: en typ som används av artiklar arkiveras (soft-delete) så att
// befintlig data behåller en giltig referens. Oanvända typer arkiveras också.
app.delete("/api/article-types/:id", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getArticleTypeDefinition(req.params.id, tenantId);
  if (!existing) throw new NotFoundError("Artikeltyp hittades inte");
  if (existing.isSystem) {
    throw new ConflictError("Systemstandard-artikeltyper kan inte tas bort eller arkiveras.");
  }
  const usage = await storage.getArticleTypeUsageCount(tenantId, existing.key);
  await storage.archiveArticleTypeDefinition(req.params.id, tenantId);
  res.json({ archived: true, usage });
}));

// ============== Task #942: UTFÖRANDEKOD-REGISTER ==============
app.get("/api/execution-codes", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  // Seed-on-read: säkerställ att tenanten alltid har systemstandarderna (idempotent, insert-only).
  let list = await storage.getExecutionCodeDefinitions(tenantId);
  if (list.length === 0) {
    await storage.seedExecutionCodeDefinitions(tenantId);
    list = await storage.getExecutionCodeDefinitions(tenantId);
  }
  res.json(list);
}));

app.post("/api/execution-codes", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertExecutionCodeDefinitionSchema.parse({ ...req.body, tenantId, isSystem: false });
  const existing = await storage.getExecutionCodeDefinitions(tenantId);
  if (existing.some((t) => t.key === data.key)) {
    throw new ConflictError(`Utförandekoden med nyckel "${data.key}" finns redan.`);
  }
  const created = await storage.createExecutionCodeDefinition(data);
  res.status(201).json(created);
}));

app.patch("/api/execution-codes/:id", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getExecutionCodeDefinition(req.params.id, tenantId);
  if (!existing) throw new NotFoundError("Utförandekod hittades inte");
  const patchSchema = insertExecutionCodeDefinitionSchema
    .partial()
    .omit({ tenantId: true, key: true, isSystem: true, deletedAt: true });
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
  const updated = await storage.updateExecutionCodeDefinition(req.params.id, tenantId, parsed.data);
  res.json(updated);
}));

// Aldrig hard-delete: koder som används av artiklar/resurser/profiler arkiveras (soft-delete).
// Task #1108: utförandekoder är helt användarhanterade — ingen kod är låst som "systemgenererad".
app.delete("/api/execution-codes/:id", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getExecutionCodeDefinition(req.params.id, tenantId);
  if (!existing) throw new NotFoundError("Utförandekod hittades inte");
  const usage = await storage.getExecutionCodeUsageCount(tenantId, existing.key);
  await storage.archiveExecutionCodeDefinition(req.params.id, tenantId);
  res.json({ archived: true, usage });
}));

// ============== Tidskoder: TIDSKOD-REGISTER ==============
// Per-tenant register över tidskoder (grupp + prioritet). Läsning öppen för tenant-medlemmar;
// skrivning kräver admin. Nyckeln är immutabel (patch tar bort key) och koder soft-deleteas.
app.get("/api/time-codes", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  // Seed-on-read: säkerställ att tenanten alltid har standardtidskoderna (idempotent, insert-only).
  let list = await storage.getTimeCodeDefinitions(tenantId);
  if (list.length === 0) {
    await storage.seedTimeCodeDefinitions(tenantId);
    list = await storage.getTimeCodeDefinitions(tenantId);
  }
  res.json(list);
}));

app.post("/api/time-codes", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertTimeCodeDefinitionSchema.parse({ ...req.body, tenantId, isSystem: false });
  const existing = await storage.getTimeCodeDefinitions(tenantId);
  if (existing.some((t) => t.key === data.key)) {
    throw new ConflictError(`Tidskoden med nyckel "${data.key}" finns redan.`);
  }
  const created = await storage.createTimeCodeDefinition(data);
  res.status(201).json(created);
}));

app.patch("/api/time-codes/:id", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getTimeCodeDefinition(req.params.id, tenantId);
  if (!existing) throw new NotFoundError("Tidskod hittades inte");
  const patchSchema = insertTimeCodeDefinitionSchema
    .partial()
    .omit({ tenantId: true, key: true, isSystem: true, deletedAt: true });
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
  const updated = await storage.updateTimeCodeDefinition(req.params.id, tenantId, parsed.data);
  res.json(updated);
}));

// Aldrig hard-delete: en tidskod som används av artiklar/personliga uppgifter arkiveras (soft-delete).
app.delete("/api/time-codes/:id", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getTimeCodeDefinition(req.params.id, tenantId);
  if (!existing) throw new NotFoundError("Tidskod hittades inte");
  const usage = await storage.getTimeCodeUsageCount(tenantId, existing.key);
  await storage.archiveTimeCodeDefinition(req.params.id, tenantId);
  res.json({ archived: true, usage });
}));

// ============== Task #942: IKONREGISTER ==============
app.get("/api/icons", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  let list = await storage.getIconDefinitions(tenantId);
  if (list.length === 0) {
    await storage.seedIconDefinitions(tenantId);
    list = await storage.getIconDefinitions(tenantId);
  }
  res.json(list);
}));

app.post("/api/icons", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertIconDefinitionSchema.parse({ ...req.body, tenantId, isSystem: false });
  const existing = await storage.getIconDefinitions(tenantId);
  if (existing.some((t) => t.key === data.key)) {
    throw new ConflictError(`Ikonen med nyckel "${data.key}" finns redan.`);
  }
  const created = await storage.createIconDefinition(data);
  res.status(201).json(created);
}));

app.patch("/api/icons/:id", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getIconDefinition(req.params.id, tenantId);
  if (!existing) throw new NotFoundError("Ikon hittades inte");
  const patchSchema = insertIconDefinitionSchema
    .partial()
    .omit({ tenantId: true, key: true, isSystem: true, deletedAt: true });
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
  const updated = await storage.updateIconDefinition(req.params.id, tenantId, parsed.data);
  res.json(updated);
}));

app.delete("/api/icons/:id", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getIconDefinition(req.params.id, tenantId);
  if (!existing) throw new NotFoundError("Ikon hittades inte");
  if (existing.isSystem) {
    throw new ConflictError("Systemstandard-ikoner kan inte tas bort eller arkiveras.");
  }
  const usage = await storage.getIconUsageCount(tenantId, existing.key);
  await storage.archiveIconDefinition(req.params.id, tenantId);
  res.json({ archived: true, usage });
}));

// ============== ADR v3 (F4): ARTICLE COMPONENTS (BOM) ==============
app.get("/api/articles/:parentId/components", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const parent = await storage.getArticle(req.params.parentId);
  if (!verifyTenantOwnership(parent, tenantId)) throw new NotFoundError("Strukturartikel hittades inte");
  const rows = await storage.getArticleComponents(req.params.parentId, tenantId);
  res.json(rows);
}));

app.post("/api/articles/:parentId/components", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const parent = await storage.getArticle(req.params.parentId);
  if (!verifyTenantOwnership(parent, tenantId)) throw new NotFoundError("Strukturartikel hittades inte");
  const parsed = insertArticleComponentSchema.safeParse({
    ...req.body,
    tenantId,
    parentArticleId: req.params.parentId,
  });
  if (!parsed.success) {
    return res.status(400).json(formatZodError(parsed.error));
  }
  if (parsed.data.childArticleId === req.params.parentId) {
    throw new ValidationError("En artikel kan inte vara komponent av sig själv");
  }
  const child = await storage.getArticle(parsed.data.childArticleId);
  if (!verifyTenantOwnership(child, tenantId)) throw new ValidationError("Komponent-artikel hittades inte i tenant");
  // Server-side nesting-skydd: strukturartiklar far inte vara komponenter (forhindrar cykler)
  if ((child as any).isStructure) {
    throw new ValidationError("Strukturartiklar kan inte anvandas som komponenter (forhindrar nesting/cykler)");
  }
  try {
    const row = await storage.createArticleComponent(parsed.data);
    res.status(201).json(row);
  } catch (err: any) {
    if (err?.code === "23505") throw new ConflictError("Komponenten finns redan i strukturen");
    throw err;
  }
}));

app.patch("/api/articles/:parentId/components/:id", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const parent = await storage.getArticle(req.params.parentId);
  if (!verifyTenantOwnership(parent, tenantId)) throw new NotFoundError("Strukturartikel hittades inte");
  const existing = await storage.getArticleComponent(req.params.id, tenantId);
  if (!existing || existing.parentArticleId !== req.params.parentId) throw new NotFoundError("Komponent hittades inte");
  const partial = insertArticleComponentSchema.partial().safeParse(req.body);
  if (!partial.success) return res.status(400).json(formatZodError(partial.error));
  const { tenantId: _t, parentArticleId: _p, childArticleId: _c, ...patch } = partial.data;
  try {
    const row = await storage.updateArticleComponent(req.params.id, tenantId, patch);
    res.json(row);
  } catch (err: any) {
    if (err?.code === "23505") throw new ConflictError("Komponenten finns redan i strukturen");
    throw err;
  }
}));

app.delete("/api/articles/:parentId/components/:id", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const parent = await storage.getArticle(req.params.parentId);
  if (!verifyTenantOwnership(parent, tenantId)) throw new NotFoundError("Strukturartikel hittades inte");
  const existing = await storage.getArticleComponent(req.params.id, tenantId);
  if (!existing || existing.parentArticleId !== req.params.parentId) throw new NotFoundError("Komponent hittades inte");
  await storage.deleteArticleComponent(req.params.id, tenantId);
  res.status(204).send();
}));

// Fasthakning: Hämta applicerbara artiklar för ett objekt baserat på hookLevel
app.get("/api/objects/:objectId/applicable-articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const object = await storage.getObject(req.params.objectId);
    if (!verifyTenantOwnership(object, tenantId)) {
      throw new NotFoundError("Objekt hittades inte");
    }
    const applicableArticles = await storage.getApplicableArticlesForObject(
      tenantId,
      req.params.objectId
    );
    res.json(applicableArticles);
}));

// Resolved article prices for an object (includes auto-hooked + manual + price resolution)
app.get("/api/objects/:objectId/article-prices", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const object = await storage.getObject(req.params.objectId);
    if (!verifyTenantOwnership(object, tenantId)) {
      throw new NotFoundError("Objekt hittades inte");
    }
    const prices = await storage.getResolvedArticlePricesForObject(tenantId, req.params.objectId);
    res.json(prices);
}));

// Manual object-article links
app.post("/api/objects/:objectId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const object = await storage.getObject(req.params.objectId);
    if (!verifyTenantOwnership(object, tenantId)) {
      throw new NotFoundError("Objekt hittades inte");
    }
    const { articleId, overridePrice } = req.body;
    if (!articleId) {
      throw new ValidationError("articleId is required");
    }
    const article = await storage.getArticle(articleId);
    if (!article || article.tenantId !== tenantId) {
      throw new NotFoundError("Artikel hittades inte");
    }
    const existing = await storage.getObjectArticles(tenantId, req.params.objectId);
    if (existing.some(e => e.articleId === articleId)) {
      throw new ConflictError("Artikeln är redan länkad till detta objekt");
    }
    const result = await storage.addObjectArticle({
      tenantId,
      objectId: req.params.objectId,
      articleId,
      overridePrice: overridePrice ?? undefined,
    });
    res.json(result);
}));

app.delete("/api/objects/:objectId/articles/:linkId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const object = await storage.getObject(req.params.objectId);
    if (!verifyTenantOwnership(object, tenantId)) {
      throw new NotFoundError("Objekt hittades inte");
    }
    const deleted = await storage.removeObjectArticle(tenantId, req.params.objectId, req.params.linkId);
    if (!deleted) {
      throw new NotFoundError("Artikellänk hittades inte");
    }
    res.json({ success: true });
}));

app.patch("/api/objects/:objectId/articles/:linkId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const object = await storage.getObject(req.params.objectId);
    if (!verifyTenantOwnership(object, tenantId)) {
      throw new NotFoundError("Objekt hittades inte");
    }
    const { overridePrice } = req.body;
    if (overridePrice !== null && overridePrice !== undefined && typeof overridePrice !== 'number') {
      throw new ValidationError("overridePrice must be a number or null");
    }
    const result = await storage.updateObjectArticlePrice(tenantId, req.params.objectId, req.params.linkId, overridePrice ?? null);
    if (!result) {
      throw new NotFoundError("Object article link not found");
    }
    res.json(result);
}));

// ============== PRICE LISTS ==============
app.get("/api/price-lists/export.csv", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const lists = await storage.getPriceLists(tenantId);
    const headers = ["name","priceListType","customerId","discountPercent","priority","validFrom","validTo","status"];
    const rows = lists.map((p: any) => [
      p.name, p.priceListType, p.customerId ?? "", p.discountPercent ?? "",
      p.priority ?? 1,
      p.validFrom ? new Date(p.validFrom).toISOString().slice(0, 10) : "",
      p.validTo ? new Date(p.validTo).toISOString().slice(0, 10) : "",
      p.status ?? "active",
    ]);
    const csv = rowsToCsv(headers, rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="prislistor-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
}));

app.get("/api/price-lists", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const page = parseInt(req.query.page as string);
    const limit = Math.min(parseInt(req.query.limit as string) || 0, 200);
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    if (page > 0 && limit > 0) {
      const offset = (page - 1) * limit;
      const result = await storage.getPriceListsPaginated(tenantId, limit, offset, search);
      return res.json({ data: result.priceLists, total: result.total, page, limit });
    }
    const priceLists = await storage.getPriceLists(tenantId);
    res.json(priceLists);
}));

app.get("/api/price-lists/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const priceList = await storage.getPriceList(req.params.id);
    const verified = verifyTenantOwnership(priceList, tenantId);
    if (!verified) throw new NotFoundError("Prislista hittades inte");
    res.json(verified);
}));

app.post("/api/price-lists", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertPriceListSchema.parse({ ...req.body, tenantId });
    const priceList = await storage.createPriceList(data);
    res.status(201).json(priceList);
}));

app.patch("/api/price-lists/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPriceList(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Prislista hittades inte");
    }
    const updateSchema = insertPriceListSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    const priceList = await storage.updatePriceList(req.params.id, updateData);
    if (!priceList) throw new NotFoundError("Prislista hittades inte");
    res.json(priceList);
}));

// ADR v3 (F6): Index-justering — applicerar % uppdatering pa alla rader i en prislista
app.post("/api/price-lists/:id/apply-index-adjustment", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({ percentage: z.number().gt(-100).lt(1000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
    try {
      const result = await storage.applyIndexAdjustmentToPriceList(req.params.id, tenantId, parsed.data.percentage);
      res.json(result);
    } catch (err: any) {
      throw new AppError(err.message || "Kunde inte indexjustera", 404, { code: "ERR_NOT_FOUND" });
    }
}));

app.delete("/api/price-lists/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPriceList(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Prislista hittades inte");
    }
    await storage.deletePriceList(req.params.id);
    res.status(204).send();
}));

// ============== PRICE LIST ARTICLES ==============
app.get("/api/price-lists/:priceListId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const priceList = await storage.getPriceList(req.params.priceListId);
    if (!verifyTenantOwnership(priceList, tenantId)) {
      throw new NotFoundError("Prislista hittades inte");
    }
    const priceListArticles = await storage.getPriceListArticles(req.params.priceListId);
    res.json(priceListArticles);
}));

app.post("/api/price-lists/:priceListId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const priceList = await storage.getPriceList(req.params.priceListId);
    if (!verifyTenantOwnership(priceList, tenantId)) {
      throw new NotFoundError("Prislista hittades inte");
    }
    const data = insertPriceListArticleSchema.parse({ ...req.body, priceListId: req.params.priceListId });
    const priceListArticle = await storage.createPriceListArticle(data);
    res.status(201).json(priceListArticle);
}));

app.patch("/api/price-list-articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPriceListArticle(req.params.id);
    if (!existing) throw new NotFoundError("Prislisteartikel hittades inte");
    
    // Verify the parent price list belongs to the tenant
    const priceList = await storage.getPriceList(existing.priceListId);
    if (!verifyTenantOwnership(priceList, tenantId)) {
      throw new NotFoundError("Prislisteartikel hittades inte");
    }
    
    const updateSchema = insertPriceListArticleSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    const priceListArticle = await storage.updatePriceListArticle(req.params.id, updateData);
    if (!priceListArticle) throw new NotFoundError("Prislisteartikel hittades inte");
    res.json(priceListArticle);
}));

app.delete("/api/price-list-articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPriceListArticle(req.params.id);
    if (!existing) throw new NotFoundError("Prislisteartikel hittades inte");
    
    // Verify the parent price list belongs to the tenant
    const priceList = await storage.getPriceList(existing.priceListId);
    if (!verifyTenantOwnership(priceList, tenantId)) {
      throw new NotFoundError("Prislisteartikel hittades inte");
    }
    
    await storage.deletePriceListArticle(req.params.id);
    res.status(204).send();
}));

// ============== RESOURCE ARTICLES (RESURSKOMPETENSER) ==============
app.get("/api/resources/:resourceId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurs hittades inte");
    }
    const resourceArticles = await storage.getResourceArticles(req.params.resourceId);
    res.json(resourceArticles);
}));

app.post("/api/resources/:resourceId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurs hittades inte");
    }
    const data = insertResourceArticleSchema.parse({ ...req.body, resourceId: req.params.resourceId });
    const resourceArticle = await storage.createResourceArticle(data);
    res.status(201).json(resourceArticle);
}));

app.patch("/api/resource-articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceArticle(req.params.id);
    if (!existing) throw new NotFoundError("Resursartikel hittades inte");
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resursartikel hittades inte");
    }
    
    const updateSchema = insertResourceArticleSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    const resourceArticle = await storage.updateResourceArticle(req.params.id, updateData);
    if (!resourceArticle) throw new NotFoundError("Resursartikel hittades inte");
    res.json(resourceArticle);
}));

app.delete("/api/resource-articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceArticle(req.params.id);
    if (!existing) throw new NotFoundError("Resursartikel hittades inte");
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resursartikel hittades inte");
    }
    
    await storage.deleteResourceArticle(req.params.id);
    res.status(204).send();
}));

// ============== VEHICLES ==============
app.get("/api/vehicles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicles = await storage.getVehicles(tenantId);
    res.json(vehicles);
}));

app.get("/api/vehicles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicle = await storage.getVehicle(req.params.id);
    const verified = verifyTenantOwnership(vehicle, tenantId);
    if (!verified) throw new NotFoundError("Fordon hittades inte");
    res.json(verified);
}));

app.post("/api/vehicles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertVehicleSchema.parse({ ...req.body, tenantId });
    const vehicle = await storage.createVehicle(data);
    res.status(201).json(vehicle);
}));

app.patch("/api/vehicles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getVehicle(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Fordon hittades inte");
    }
    const updateSchema = insertVehicleSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    const vehicle = await storage.updateVehicle(req.params.id, updateData);
    if (!vehicle) throw new NotFoundError("Fordon hittades inte");
    res.json(vehicle);
}));

app.delete("/api/vehicles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getVehicle(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Fordon hittades inte");
    }
    await storage.deleteVehicle(req.params.id);
    res.status(204).send();
}));

// ============== EQUIPMENT BOOKINGS ==============
app.get("/api/equipment-bookings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { vehicleId, equipmentId, resourceId, teamId, date, startDate, endDate, status } = req.query;
    const options: any = {};
    if (vehicleId) options.vehicleId = vehicleId;
    if (equipmentId) options.equipmentId = equipmentId;
    if (resourceId) options.resourceId = resourceId;
    if (teamId) options.teamId = teamId;
    if (date) options.date = new Date(date as string);
    if (startDate) options.startDate = new Date(startDate as string);
    if (endDate) options.endDate = new Date(endDate as string);
    if (status) options.status = status;
    const bookings = await storage.getEquipmentBookings(tenantId, options);
    res.json(bookings);
}));

app.get("/api/equipment-bookings/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const booking = await storage.getEquipmentBooking(req.params.id);
    if (!booking || booking.tenantId !== tenantId) throw new NotFoundError("Bokning hittades inte");
    res.json(booking);
}));

app.post("/api/equipment-bookings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { vehicleId, equipmentId, resourceId, teamId, date, serviceArea, notes, workSessionId } = req.body;
    if (!vehicleId && !equipmentId) throw new ValidationError("Ange fordon eller utrustning");
    if (!date) throw new ValidationError("Datum krävs");

    const bookingDate = new Date(date);
    const targetId = vehicleId || equipmentId;
    const targetType = vehicleId ? "vehicle" : "equipment";

    if (vehicleId) {
      const vehicle = await storage.getVehicle(vehicleId);
      if (!vehicle || vehicle.tenantId !== tenantId) throw new ValidationError("Ogiltigt fordon");
    }
    if (equipmentId) {
      const allEquipment = await storage.getEquipment(tenantId);
      const eq = allEquipment.find(e => e.id === equipmentId);
      if (!eq) throw new ValidationError("Ogiltig utrustning");
    }
    if (resourceId) {
      const resource = await storage.getResource(resourceId);
      if (!resource || resource.tenantId !== tenantId) throw new ValidationError("Ogiltig resurs");
    }
    if (teamId) {
      const team = await storage.getTeam(teamId);
      if (!team || team.tenantId !== tenantId) throw new ValidationError("Ogiltigt team");
    }

    const existingBookings = await storage.getEquipmentBookings(tenantId, {
      ...(vehicleId ? { vehicleId } : { equipmentId }),
      date: bookingDate,
      status: "active",
    });

    const requestAreas = Array.isArray(serviceArea) ? serviceArea : [];
    const conflicts = existingBookings.filter(b => {
      if (b.resourceId === resourceId && b.teamId === teamId) return false;
      if (requestAreas.length === 0) return true;
      const bookingAreas = b.serviceArea || [];
      if (bookingAreas.length === 0) return true;
      const overlap = requestAreas.some((a: string) => bookingAreas.includes(a));
      return !overlap;
    });

    let warning: string | null = null;
    if (conflicts.length > 0) {
      const conflictAreas = conflicts.flatMap(c => c.serviceArea || []);
      warning = `Varning: ${targetType === "vehicle" ? "Fordonet" : "Utrustningen"} är redan bokat ${bookingDate.toISOString().split("T")[0]} i ${conflictAreas.length > 0 ? `annan zon (${conflictAreas.join(", ")})` : "annan tilldelning"}. Dubbelbokning skapad med varning.`;
    }

    const booking = await storage.createEquipmentBooking({
      tenantId,
      vehicleId: vehicleId || null,
      equipmentId: equipmentId || null,
      resourceId: resourceId || null,
      teamId: teamId || null,
      workSessionId: workSessionId || null,
      date: bookingDate,
      serviceArea: requestAreas,
      status: "active",
      notes: notes || null,
    });

    res.status(201).json({ booking, warning });
}));

app.delete("/api/equipment-bookings/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const booking = await storage.getEquipmentBooking(req.params.id);
    if (!booking || booking.tenantId !== tenantId) throw new NotFoundError("Bokning hittades inte");
    await storage.deleteEquipmentBooking(req.params.id);
    res.status(204).send();
}));

app.post("/api/equipment-bookings/check-collision", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { vehicleId, equipmentId, resourceId, teamId, date, serviceArea } = req.body;
    if (!vehicleId && !equipmentId) throw new ValidationError("Ange fordon eller utrustning");
    if (!date) throw new ValidationError("Datum krävs");

    const bookingDate = new Date(date);
    const existingBookings = await storage.getEquipmentBookings(tenantId, {
      ...(vehicleId ? { vehicleId } : { equipmentId }),
      date: bookingDate,
      status: "active",
    });

    const requestAreas = Array.isArray(serviceArea) ? serviceArea : [];
    const conflicts = existingBookings.filter(b => {
      if (resourceId && teamId && b.resourceId === resourceId && b.teamId === teamId) return false;
      if (requestAreas.length === 0) return existingBookings.length > 0;
      const bookingAreas = b.serviceArea || [];
      if (bookingAreas.length === 0) return true;
      return !requestAreas.some((a: string) => bookingAreas.includes(a));
    });

    res.json({
      hasConflict: conflicts.length > 0,
      conflicts: conflicts.map(c => ({
        id: c.id,
        resourceId: c.resourceId,
        teamId: c.teamId,
        serviceArea: c.serviceArea,
        date: c.date,
      })),
      existingBookings: existingBookings.length,
    });
}));

// ============== FUEL LOGS ==============
app.get("/api/fuel-logs", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicleId = req.query.vehicleId as string | undefined;
    const logs = await storage.getFuelLogs(tenantId, vehicleId);
    res.json(logs);
}));

app.post("/api/fuel-logs", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicle = await storage.getVehicle(req.body.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      throw new NotFoundError("Fordon hittades inte");
    }
    const data = insertFuelLogSchema.parse({ ...req.body, tenantId });
    const log = await storage.createFuelLog(data);
    res.status(201).json(log);
}));

app.delete("/api/fuel-logs/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteFuelLog(req.params.id, tenantId);
    res.status(204).send();
}));

// ============== MAINTENANCE LOGS ==============
app.get("/api/maintenance-logs", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicleId = req.query.vehicleId as string | undefined;
    const logs = await storage.getMaintenanceLogs(tenantId, vehicleId);
    res.json(logs);
}));

app.post("/api/maintenance-logs", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicle = await storage.getVehicle(req.body.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      throw new NotFoundError("Fordon hittades inte");
    }
    const data = insertMaintenanceLogSchema.parse({ ...req.body, tenantId });
    const log = await storage.createMaintenanceLog(data);
    res.status(201).json(log);
}));

app.delete("/api/maintenance-logs/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteMaintenanceLog(req.params.id, tenantId);
    res.status(204).send();
}));

// ============== RESOURCE PROFILES (Utföranderoller) ==============
app.get("/api/resource-profiles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const profiles = await storage.getResourceProfiles(tenantId);
    res.json(profiles);
}));

app.get("/api/resource-profiles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const profile = await storage.getResourceProfile(req.params.id);
    if (!profile || profile.tenantId !== tenantId) throw new NotFoundError("Profil hittades inte");
    res.json(profile);
}));

app.post("/api/resource-profiles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertResourceProfileSchema.parse({ ...req.body, tenantId });
    const profile = await storage.createResourceProfile(data);
    res.status(201).json(profile);
}));

app.put("/api/resource-profiles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceProfile(req.params.id);
    if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Profil hittades inte");
    const { tenantId: _, id: __, ...updateData } = req.body;
    const profile = await storage.updateResourceProfile(req.params.id, updateData);
    if (!profile) throw new NotFoundError("Profil hittades inte");
    res.json(profile);
}));

app.delete("/api/resource-profiles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteResourceProfile(req.params.id, tenantId);
    res.status(204).send();
}));

app.get("/api/resource-profiles/:id/resources", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignments = await storage.getResourceProfileAssignments(tenantId, req.params.id);
    res.json(assignments);
}));

app.post("/api/resources/:id/profiles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resourceId = req.params.id;
    const { profileId, applyProfile } = req.body;
    const profile = await storage.getResourceProfile(profileId);
    if (!profile || profile.tenantId !== tenantId) throw new NotFoundError("Profil hittades inte");
    const resource = await storage.getResource(resourceId);
    if (!resource || resource.tenantId !== tenantId) throw new NotFoundError("Resurs hittades inte");
    const data = insertResourceProfileAssignmentSchema.parse({ tenantId, resourceId, profileId });
    const assignment = await storage.assignResourceProfile(data);
    if (applyProfile !== false && profile && resource) {
      const updates: Record<string, any> = {};
      if (profile.executionCodes && profile.executionCodes.length > 0) {
        const existingCodes = resource.executionCodes || [];
        const merged = [...new Set([...existingCodes, ...profile.executionCodes])];
        updates.executionCodes = merged;
      }
      if (profile.defaultCostCenter) updates.costCenter = profile.defaultCostCenter;
      if (profile.projectCode) updates.projectCode = profile.projectCode;
      if (profile.serviceArea && profile.serviceArea.length > 0) updates.serviceArea = profile.serviceArea;
      if (Object.keys(updates).length > 0) {
        await storage.updateResource(resourceId, updates);
      }
    }
    res.status(201).json(assignment);
}));

app.delete("/api/resources/:id/profiles/:profileId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const profile = await storage.getResourceProfile(req.params.profileId);
    if (!profile || profile.tenantId !== tenantId) throw new NotFoundError("Profil hittades inte");
    const resource = await storage.getResource(req.params.id);
    if (!resource || resource.tenantId !== tenantId) throw new NotFoundError("Resurs hittades inte");
    await storage.removeResourceProfileAssignmentByPair(req.params.profileId, req.params.id);
    res.status(204).send();
}));

// ============== WORK SESSIONS & ENTRIES (Snöret) ==============
app.get("/api/work-sessions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { resourceId, teamId, startDate, endDate, status } = req.query;
    const options: any = {};
    if (resourceId) options.resourceId = resourceId as string;
    if (teamId) options.teamId = teamId as string;
    if (startDate) options.startDate = new Date(startDate as string);
    if (endDate) options.endDate = new Date(endDate as string);
    if (status) options.status = status as string;
    const sessions = await storage.getWorkSessions(tenantId, options);
    res.json(sessions);
}));

app.get("/api/work-sessions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const session = await storage.getWorkSession(req.params.id);
    if (!session || session.tenantId !== tenantId) throw new NotFoundError("Arbetspass hittades inte");
    res.json(session);
}));

app.post("/api/work-sessions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.body.resourceId);
    if (!resource || resource.tenantId !== tenantId) throw new ValidationError("Ogiltig resurs");
    if (req.body.teamId) {
      const team = await storage.getTeam(req.body.teamId);
      if (!team || team.tenantId !== tenantId) throw new ValidationError("Ogiltigt team");
    }
    const startTime = new Date(req.body.startTime);
    const endTime = req.body.endTime ? new Date(req.body.endTime) : undefined;
    if (endTime && endTime <= startTime) throw new ValidationError("Sluttid måste vara efter starttid");
    const data = insertWorkSessionSchema.parse({ ...req.body, tenantId, date: new Date(req.body.date), startTime, endTime });
    const session = await storage.createWorkSession(data);
    res.status(201).json(session);
}));

app.put("/api/work-sessions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWorkSession(req.params.id);
    if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Arbetspass hittades inte");
    const { tenantId: _, id: __, ...updateData } = req.body;
    if (updateData.status && !["active", "paused", "completed"].includes(updateData.status)) throw new ValidationError("Ogiltig status");
    if (updateData.resourceId) {
      const resource = await storage.getResource(updateData.resourceId);
      if (!resource || resource.tenantId !== tenantId) throw new ValidationError("Ogiltig resurs");
    }
    if (updateData.teamId) {
      const team = await storage.getTeam(updateData.teamId);
      if (!team || team.tenantId !== tenantId) throw new ValidationError("Ogiltigt team");
    }
    if (updateData.endTime) updateData.endTime = new Date(updateData.endTime);
    if (updateData.startTime) updateData.startTime = new Date(updateData.startTime);
    if (updateData.date) updateData.date = new Date(updateData.date);
    const session = await storage.updateWorkSession(req.params.id, updateData);
    if (session && session.status === "completed" && existing.status !== "completed") {
      try {
        await storage.releaseEquipmentByWorkSession(req.params.id);
      } catch (releaseErr) {
        console.error("Failed to auto-release equipment on session completion:", releaseErr);
      }
    }
    res.json(session);
}));

app.delete("/api/work-sessions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWorkSession(req.params.id);
    if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Arbetspass hittades inte");
    await storage.deleteWorkSession(req.params.id);
    res.status(204).send();
}));

app.post("/api/work-sessions/:id/check-in", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWorkSession(req.params.id);
    if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Arbetspass hittades inte");
    const session = await storage.updateWorkSession(req.params.id, { status: "active", startTime: new Date() });
    res.json(session);
}));

app.post("/api/work-sessions/:id/check-out", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWorkSession(req.params.id);
    if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Arbetspass hittades inte");
    const session = await storage.updateWorkSession(req.params.id, { status: "completed", endTime: new Date() });
    const released = await storage.releaseEquipmentByWorkSession(req.params.id);
    res.json({ ...session, releasedBookings: released });
}));

app.get("/api/work-sessions/:id/entries", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const session = await storage.getWorkSession(req.params.id);
    if (!session || session.tenantId !== tenantId) throw new NotFoundError("Arbetspass hittades inte");
    const entries = await storage.getWorkEntries(req.params.id);
    res.json(entries);
}));

app.get("/api/work-entries/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const entry = await storage.getWorkEntry(req.params.id);
    if (!entry || entry.tenantId !== tenantId) throw new NotFoundError("Post hittades inte");
    res.json(entry);
}));

app.post("/api/work-entries", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const session = await storage.getWorkSession(req.body.workSessionId);
    if (!session || session.tenantId !== tenantId) throw new ValidationError("Ogiltigt arbetspass");
    const resource = await storage.getResource(req.body.resourceId || session.resourceId);
    if (!resource || resource.tenantId !== tenantId) throw new ValidationError("Ogiltig resurs");
    const validTypes = ["work", "travel", "setup", "break", "rest"];
    if (!validTypes.includes(req.body.entryType)) throw new ValidationError("Ogiltig posttyp");
    const startTime = new Date(req.body.startTime);
    const endTime = req.body.endTime ? new Date(req.body.endTime) : undefined;
    if (endTime && endTime <= startTime) throw new ValidationError("Sluttid måste vara efter starttid");
    const data = insertWorkEntrySchema.parse({ ...req.body, tenantId, resourceId: resource.id, startTime, endTime });
    const entry = await storage.createWorkEntry(data);
    res.status(201).json(entry);
}));

app.put("/api/work-entries/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWorkEntry(req.params.id);
    if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Post hittades inte");
    const { tenantId: _, id: __, workSessionId: ___, ...updateData } = req.body;
    const validTypes = ["work", "travel", "setup", "break", "rest"];
    if (updateData.entryType && !validTypes.includes(updateData.entryType)) throw new ValidationError("Ogiltig posttyp");
    if (updateData.resourceId) {
      const resource = await storage.getResource(updateData.resourceId);
      if (!resource || resource.tenantId !== tenantId) throw new ValidationError("Ogiltig resurs");
    }
    if (updateData.workOrderId) {
      const wo = await storage.getWorkOrder(updateData.workOrderId);
      if (!wo || wo.tenantId !== tenantId) throw new ValidationError("Ogiltig arbetsorder");
    }
    if (updateData.startTime) updateData.startTime = new Date(updateData.startTime);
    if (updateData.endTime) updateData.endTime = new Date(updateData.endTime);
    const start = updateData.startTime || existing.startTime;
    const end = updateData.endTime || existing.endTime;
    if (end && start && new Date(end) <= new Date(start)) throw new ValidationError("Sluttid måste vara efter starttid");
    const entry = await storage.updateWorkEntry(req.params.id, updateData);
    res.json(entry);
}));

app.delete("/api/work-entries/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWorkEntry(req.params.id);
    if (!existing || existing.tenantId !== tenantId) throw new NotFoundError("Post hittades inte");
    await storage.deleteWorkEntry(req.params.id);
    res.status(204).send();
}));

app.get("/api/time-summary", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { resourceId, weekNumber, year } = req.query;
    const y = parseInt(year as string) || new Date().getFullYear();
    const w = parseInt(weekNumber as string) || getISOWeek(new Date());

    const weekStart = getStartOfISOWeek(y, w);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const options: any = { startDate: weekStart, endDate: weekEnd };
    if (resourceId) options.resourceId = resourceId as string;

    const sessions = await storage.getWorkSessions(tenantId, options);
    const allResources = await storage.getResources(tenantId);
    const resourceMap = new Map(allResources.map(r => [r.id, r]));

    const summaryByResource = new Map<string, { work: number; travel: number; setup: number; break_time: number; rest: number; total: number; budgetHours: number; resourceName: string; resourceId: string }>();

    for (const session of sessions) {
      const entries = await storage.getWorkEntries(session.id);
      const resource = resourceMap.get(session.resourceId);
      if (!summaryByResource.has(session.resourceId)) {
        summaryByResource.set(session.resourceId, {
          work: 0, travel: 0, setup: 0, break_time: 0, rest: 0, total: 0,
          budgetHours: resource?.weeklyHours || 40,
          resourceName: resource?.name || "Okänd",
          resourceId: session.resourceId,
        });
      }
      const s = summaryByResource.get(session.resourceId)!;
      for (const entry of entries) {
        const mins = entry.durationMinutes || (entry.endTime && entry.startTime ? Math.round((new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime()) / 60000) : 0);
        switch (entry.entryType) {
          case "work": s.work += mins; break;
          case "travel": s.travel += mins; break;
          case "setup": s.setup += mins; break;
          case "break": s.break_time += mins; break;
          case "rest": s.rest += mins; break;
        }
        s.total += mins;
      }
    }

    const nightRestViolations: Array<{ resourceId: string; resourceName: string; date: string; restHours: number }> = [];
    const weeklyRestViolations: Array<{ resourceId: string; resourceName: string; totalRestHours: number }> = [];

    for (const [rId, summary] of summaryByResource) {
      const rSessions = sessions.filter(s => s.resourceId === rId).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      for (let i = 1; i < rSessions.length; i++) {
        const prevEnd = rSessions[i - 1].endTime;
        const currStart = rSessions[i].startTime;
        if (prevEnd && currStart) {
          const restHours = (new Date(currStart).getTime() - new Date(prevEnd).getTime()) / 3600000;
          if (restHours < 11) {
            nightRestViolations.push({
              resourceId: rId,
              resourceName: summary.resourceName,
              date: new Date(currStart).toISOString().split("T")[0],
              restHours: Math.round(restHours * 10) / 10,
            });
          }
        }
      }

      let maxContinuousRestHours = 0;
      if (rSessions.length === 0) {
        maxContinuousRestHours = 168;
      } else {
        const firstStart = rSessions[0].startTime ? new Date(rSessions[0].startTime).getTime() : weekStart.getTime();
        const restBeforeFirst = (firstStart - weekStart.getTime()) / 3600000;
        maxContinuousRestHours = Math.max(maxContinuousRestHours, restBeforeFirst);

        for (let i = 1; i < rSessions.length; i++) {
          const prevEnd = rSessions[i - 1].endTime;
          const currStart = rSessions[i].startTime;
          if (prevEnd && currStart) {
            const gap = (new Date(currStart).getTime() - new Date(prevEnd).getTime()) / 3600000;
            maxContinuousRestHours = Math.max(maxContinuousRestHours, gap);
          }
        }

        const lastEnd = rSessions[rSessions.length - 1].endTime;
        if (lastEnd) {
          const restAfterLast = (weekEnd.getTime() - new Date(lastEnd).getTime()) / 3600000;
          maxContinuousRestHours = Math.max(maxContinuousRestHours, restAfterLast);
        }
      }

      if (maxContinuousRestHours < 36) {
        weeklyRestViolations.push({
          resourceId: rId,
          resourceName: summary.resourceName,
          totalRestHours: Math.round(maxContinuousRestHours * 10) / 10,
        });
      }
    }

    const summariesArr = Array.from(summaryByResource.values());
    for (const s of summariesArr) {
      const existing = await db.select().from(timeLogs).where(
        and(eq(timeLogs.tenantId, tenantId), eq(timeLogs.resourceId, s.resourceId), eq(timeLogs.year, y), eq(timeLogs.week, w))
      );
      const logData = { tenantId, resourceId: s.resourceId, week: w, year: y, work: s.work, travel: s.travel, setup: s.setup, breakTime: s.break_time, rest: s.rest, total: s.total, budgetHours: s.budgetHours, resourceName: s.resourceName };
      if (existing.length > 0) {
        await db.update(timeLogs).set({ ...logData, updatedAt: new Date() }).where(eq(timeLogs.id, existing[0].id));
      } else {
        await db.insert(timeLogs).values(logData);
      }
    }

    res.json({
      week: w,
      year: y,
      summaries: summariesArr,
      nightRestViolations,
      weeklyRestViolations,
    });
}));

app.get("/api/payroll-export", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { weekNumber, year } = req.query;
    const y = parseInt(year as string) || new Date().getFullYear();
    const w = parseInt(weekNumber as string) || getISOWeek(new Date());

    const weekStart = getStartOfISOWeek(y, w);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const sessions = await storage.getWorkSessions(tenantId, { startDate: weekStart, endDate: weekEnd });
    const allResources = await storage.getResources(tenantId);
    const resourceMap = new Map(allResources.map(r => [r.id, r]));

    const rows: string[] = ["Resurs;Vecka;År;Arbetstid (min);Restid (min);Ställtid (min);Rast (min);Vila (min);Total (min);Total (h);Budgettimmar;Anställningstyp"];

    const byResource = new Map<string, { work: number; travel: number; setup: number; break_time: number; rest: number; total: number }>();
    for (const session of sessions) {
      if (!byResource.has(session.resourceId)) byResource.set(session.resourceId, { work: 0, travel: 0, setup: 0, break_time: 0, rest: 0, total: 0 });
      const entries = await storage.getWorkEntries(session.id);
      const s = byResource.get(session.resourceId)!;
      for (const entry of entries) {
        const mins = entry.durationMinutes || (entry.endTime && entry.startTime ? Math.round((new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime()) / 60000) : 0);
        switch (entry.entryType) {
          case "work": s.work += mins; break;
          case "travel": s.travel += mins; break;
          case "setup": s.setup += mins; break;
          case "break": s.break_time += mins; break;
          case "rest": s.rest += mins; break;
        }
        s.total += mins;
      }
    }

    for (const [rId, data] of byResource) {
      const resource = resourceMap.get(rId);
      const name = resource?.name || "Okänd";
      const budget = resource?.weeklyHours || 40;
      const employmentType = budget >= 35 ? "Månadsanställd" : "Timanställd";
      const safeName = name.replace(/^[=+\-@\t\r]/g, "'$&").replace(/;/g, ",");
      rows.push(`${safeName};${w};${y};${data.work};${data.travel};${data.setup};${data.break_time};${data.rest};${data.total};${(data.total / 60).toFixed(1)};${budget};${employmentType}`);
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=loneunderlag_v${w}_${y}.csv`);
    res.send("\uFEFF" + rows.join("\n"));
}));

// ============== EQUIPMENT ==============
app.get("/api/equipment", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const equipment = await storage.getEquipment(tenantId);
    res.json(equipment);
}));

app.get("/api/equipment/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const equipment = await storage.getEquipmentById(req.params.id);
    const verified = verifyTenantOwnership(equipment, tenantId);
    if (!verified) throw new NotFoundError("Utrustning hittades inte");
    res.json(verified);
}));

app.post("/api/equipment", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertEquipmentSchema.parse({ ...req.body, tenantId });
    const equipment = await storage.createEquipment(data);
    res.status(201).json(equipment);
}));

app.patch("/api/equipment/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getEquipmentById(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Utrustning hittades inte");
    }
    const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
    const equipment = await storage.updateEquipment(req.params.id, updateData);
    if (!equipment) throw new NotFoundError("Utrustning hittades inte");
    res.json(equipment);
}));

app.delete("/api/equipment/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getEquipmentById(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Utrustning hittades inte");
    }
    await storage.deleteEquipment(req.params.id);
    res.status(204).send();
}));

// ============== RESOURCE AVAILABILITY ==============
app.get("/api/resource-availability/:resourceId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurs hittades inte");
    }
    const availability = await storage.getResourceAvailability(req.params.resourceId);
    res.json(availability);
}));

app.get("/api/resource-availability-item/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const item = await storage.getResourceAvailabilityById(req.params.id);
    if (!item) throw new NotFoundError("Resurstillgänglighet hittades inte");
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(item.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurstillgänglighet hittades inte");
    }
    res.json(item);
}));

app.post("/api/resource-availability/:resourceId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurs hittades inte");
    }
    const data = insertResourceAvailabilitySchema.parse({ 
      ...req.body, 
      tenantId, 
      resourceId: req.params.resourceId 
    });
    const item = await storage.createResourceAvailability(data);
    res.status(201).json(item);
}));

app.patch("/api/resource-availability-item/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceAvailabilityById(req.params.id);
    if (!existing) throw new NotFoundError("Resurstillgänglighet hittades inte");
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurstillgänglighet hittades inte");
    }
    
    const { tenantId: _, id, resourceId, createdAt, ...updateData } = req.body;
    const item = await storage.updateResourceAvailability(req.params.id, updateData);
    if (!item) throw new NotFoundError("Resurstillgänglighet hittades inte");
    res.json(item);
}));

app.delete("/api/resource-availability-item/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceAvailabilityById(req.params.id);
    if (!existing) throw new NotFoundError("Resurstillgänglighet hittades inte");
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurstillgänglighet hittades inte");
    }
    
    await storage.deleteResourceAvailability(req.params.id);
    res.status(204).send();
}));

// ============== VEHICLE SCHEDULE ==============
app.get("/api/vehicle-schedule/:vehicleId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicle = await storage.getVehicle(req.params.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      throw new NotFoundError("Fordon hittades inte");
    }
    const schedule = await storage.getVehicleSchedule(req.params.vehicleId);
    res.json(schedule);
}));

app.get("/api/vehicle-schedule-item/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const item = await storage.getVehicleScheduleById(req.params.id);
    if (!item) throw new NotFoundError("Fordonsschema hittades inte");
    
    const vehicle = await storage.getVehicle(item.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      throw new NotFoundError("Fordonsschema hittades inte");
    }
    res.json(item);
}));

app.post("/api/vehicle-schedule/:vehicleId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicle = await storage.getVehicle(req.params.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      throw new NotFoundError("Fordon hittades inte");
    }
    const data = insertVehicleScheduleSchema.parse({ 
      ...req.body, 
      tenantId, 
      vehicleId: req.params.vehicleId 
    });
    const item = await storage.createVehicleSchedule(data);
    res.status(201).json(item);
}));

app.patch("/api/vehicle-schedule-item/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getVehicleScheduleById(req.params.id);
    if (!existing) throw new NotFoundError("Fordonsschema hittades inte");
    
    const vehicle = await storage.getVehicle(existing.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      throw new NotFoundError("Fordonsschema hittades inte");
    }
    
    const { tenantId: _, id, vehicleId, createdAt, ...updateData } = req.body;
    const item = await storage.updateVehicleSchedule(req.params.id, updateData);
    if (!item) throw new NotFoundError("Fordonsschema hittades inte");
    res.json(item);
}));

app.delete("/api/vehicle-schedule-item/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getVehicleScheduleById(req.params.id);
    if (!existing) throw new NotFoundError("Fordonsschema hittades inte");
    
    const vehicle = await storage.getVehicle(existing.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      throw new NotFoundError("Fordonsschema hittades inte");
    }
    
    await storage.deleteVehicleSchedule(req.params.id);
    res.status(204).send();
}));

// ============== SUBSCRIPTIONS ==============
app.get("/api/subscriptions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const subscriptions = await storage.getSubscriptions(tenantId);
    res.json(subscriptions);
}));

app.get("/api/subscriptions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const subscription = await storage.getSubscription(req.params.id);
    const verified = verifyTenantOwnership(subscription, tenantId);
    if (!verified) throw new NotFoundError("Prenumeration hittades inte");
    res.json(verified);
}));

app.post("/api/subscriptions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertSubscriptionSchema.parse({ ...req.body, tenantId });
    const subscription = await storage.createSubscription(data);
    res.status(201).json(subscription);
}));

app.patch("/api/subscriptions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getSubscription(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Prenumeration hittades inte");
    }
    const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
    const subscription = await storage.updateSubscription(req.params.id, updateData);
    if (!subscription) throw new NotFoundError("Prenumeration hittades inte");
    res.json(subscription);
}));

app.delete("/api/subscriptions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getSubscription(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Prenumeration hittades inte");
    }
    await storage.deleteSubscription(req.params.id);
    res.status(204).send();
}));

// Preview scheduled dates based on flexible frequency
app.post("/api/scheduling/preview-dates", asyncHandler(async (req, res) => {
    const { frequency, startDate, endDate } = req.body;
    
    if (!frequency || !startDate || !endDate) {
      throw new ValidationError("frequency, startDate, and endDate are required");
    }
    
    const { generateScheduleDates, formatFrequencyDescription } = await import('../scheduling-utils');
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    const dates = generateScheduleDates(frequency, start, end);
    const description = formatFrequencyDescription(frequency);
    
    res.json({
      dates: dates.map(d => d.toISOString()),
      count: dates.length,
      description,
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
      }
    });
}));

// Generate orders from active subscriptions
app.post("/api/subscriptions/generate-orders", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const subscriptions = await storage.getSubscriptions(tenantId);
    const now = new Date();
    let generatedCount = 0;

    const { generateScheduleDates, convertLegacyPeriodicity } = await import('../scheduling-utils');

    for (const sub of subscriptions) {
      if (sub.status !== "active" || !sub.autoGenerate) continue;
      if (!sub.nextGenerationDate) continue;
      
      const nextGenDate = new Date(sub.nextGenerationDate);
      const generateAheadDays = sub.generateDaysAhead || 14;
      const generateThreshold = new Date(now.getTime() + generateAheadDays * 24 * 60 * 60 * 1000);
      
      // Generate if nextGenerationDate is within the generate-ahead window
      if (nextGenDate <= generateThreshold) {
        // Create work order from subscription
        const workOrder = await storage.createWorkOrder({
          tenantId,
          customerId: sub.customerId,
          objectId: sub.objectId,
          title: sub.name,
          description: `Genererad från abonnemang: ${sub.name}`,
          orderStatus: "skapad",
          priority: "normal",
          estimatedDuration: 60,
          scheduledDate: nextGenDate,
          isSimulated: false,
        });

        generatedCount++;

        // Calculate next generation date - use flexible frequency if available
        let nextDate: Date;
        
        if (sub.flexibleFrequency) {
          // Use new flexible frequency system
          const frequency = sub.flexibleFrequency as any;
          const dates = generateScheduleDates(frequency, nextGenDate, generateThreshold);
          // Find the next date after the current one
          const futureDates = dates.filter(d => d > nextGenDate);
          nextDate = futureDates.length > 0 ? futureDates[0] : new Date(nextGenDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        } else {
          // Fallback to legacy periodicity
          nextDate = new Date(nextGenDate);
          switch (sub.periodicity) {
            case "vecka":
              nextDate.setDate(nextDate.getDate() + 7);
              break;
            case "varannan_vecka":
              nextDate.setDate(nextDate.getDate() + 14);
              break;
            case "manad":
              nextDate.setMonth(nextDate.getMonth() + 1);
              break;
            case "kvartal":
              nextDate.setMonth(nextDate.getMonth() + 3);
              break;
            case "halvar":
              nextDate.setMonth(nextDate.getMonth() + 6);
              break;
            case "ar":
              nextDate.setFullYear(nextDate.getFullYear() + 1);
              break;
            default:
              nextDate.setMonth(nextDate.getMonth() + 1);
          }
        }

        // Check if we've passed endDate
        if (sub.endDate && nextDate > new Date(sub.endDate)) {
          await storage.updateSubscription(sub.id, {
            status: "completed",
            lastGeneratedDate: now,
          });
        } else {
          await storage.updateSubscription(sub.id, {
            lastGeneratedDate: now,
            nextGenerationDate: nextDate,
          });
        }
      }
    }

    res.json({ success: true, generatedCount });
}));

// ============== REFERENS: UPPGIFTSTYP-REGISTER ==============
// Dynamiskt, per-tenant register som driver Uppgiftstyp-filtret i Grovplaneringen.
// Tenant härleds server-side (aldrig från klient-angiven ?tenantId — threat-model).
// Saknar tenant register-rader (ny tenant innan seed) → syntetisera de 8 standardtyperna.
app.get("/api/reference/task-types", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const types = await storage.getTaskTypes(tenantId);
    if (types.length > 0) {
      res.json(types.map((t) => ({ key: t.key, label: t.label })));
      return;
    }
    res.json(
      TASK_TYPE_KEYS.map((k) => ({ key: k, label: TASK_TYPE_LABELS[k] ?? k })),
    );
}));

// ============== TEAMS ==============
app.get("/api/teams", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const teams = await storage.getTeams(tenantId);
    res.json(teams);
}));

app.get("/api/teams/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const team = await storage.getTeam(req.params.id);
    const verified = verifyTenantOwnership(team, tenantId);
    if (!verified) throw new NotFoundError("Team hittades inte");
    res.json(verified);
}));

app.post("/api/teams", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (req.body.profileIds && Array.isArray(req.body.profileIds) && req.body.profileIds.length > 0) {
      const tenantProfiles = await storage.getResourceProfiles(tenantId);
      const tenantProfileIds = new Set(tenantProfiles.map(p => p.id));
      for (const pid of req.body.profileIds) {
        if (!tenantProfileIds.has(pid)) {
          throw new ValidationError(`Profilen ${pid} tillhör inte detta företag`);
        }
      }
    }
    const data = insertTeamSchema.parse({ ...req.body, tenantId });
    const team = await storage.createTeam(data);
    res.status(201).json(team);
}));

app.patch("/api/teams/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getTeam(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Team hittades inte");
    }
    if (req.body.profileIds && Array.isArray(req.body.profileIds) && req.body.profileIds.length > 0) {
      const tenantProfiles = await storage.getResourceProfiles(tenantId);
      const tenantProfileIds = new Set(tenantProfiles.map(p => p.id));
      for (const pid of req.body.profileIds) {
        if (!tenantProfileIds.has(pid)) {
          throw new ValidationError(`Profilen ${pid} tillhör inte detta företag`);
        }
      }
    }
    const updateSchema = insertTeamSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw parseResult.error;
    }
    const team = await storage.updateTeam(req.params.id, parseResult.data);
    if (!team) throw new NotFoundError("Team hittades inte");
    res.json(team);
}));

app.delete("/api/teams/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getTeam(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Team hittades inte");
    }
    await storage.deleteTeam(req.params.id);
    res.status(204).send();
}));

// ============== TEAM MEMBERS ==============
app.get("/api/team-members/:teamId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const team = await storage.getTeam(req.params.teamId);
    if (!verifyTenantOwnership(team, tenantId)) {
      throw new NotFoundError("Team hittades inte");
    }
    const members = await storage.getTeamMembers(req.params.teamId);
    res.json(members);
}));

app.get("/api/team-members", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const members = await storage.getAllTeamMembers(tenantId);
    res.json(members);
}));

app.get("/api/team-member/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const member = await storage.getTeamMember(req.params.id);
    if (!member) throw new NotFoundError("Team member not found");
    
    const team = await storage.getTeam(member.teamId);
    if (!verifyTenantOwnership(team, tenantId)) {
      throw new NotFoundError("Team member not found");
    }
    res.json(member);
}));

app.post("/api/team-members/:teamId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const team = await storage.getTeam(req.params.teamId);
    if (!verifyTenantOwnership(team, tenantId)) {
      throw new NotFoundError("Team hittades inte");
    }
    const data = insertTeamMemberSchema.parse({ ...req.body, teamId: req.params.teamId });
    const member = await storage.createTeamMember(data);
    res.status(201).json(member);
}));

app.patch("/api/team-member/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getTeamMember(req.params.id);
    if (!existing) throw new NotFoundError("Team member not found");
    
    const team = await storage.getTeam(existing.teamId);
    if (!verifyTenantOwnership(team, tenantId)) {
      throw new NotFoundError("Team member not found");
    }
    
    const { id, teamId, resourceId, createdAt, ...updateData } = req.body;
    const member = await storage.updateTeamMember(req.params.id, updateData);
    if (!member) throw new NotFoundError("Team member not found");
    res.json(member);
}));

app.delete("/api/team-member/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getTeamMember(req.params.id);
    if (!existing) throw new NotFoundError("Team member not found");
    
    const team = await storage.getTeam(existing.teamId);
    if (!verifyTenantOwnership(team, tenantId)) {
      throw new NotFoundError("Team member not found");
    }
    
    await storage.deleteTeamMember(req.params.id);
    res.status(204).send();
}));

// ============== PLANNING PARAMETERS ==============
app.get("/api/planning-parameters", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const params = await storage.getPlanningParameters(tenantId);
    res.json(params);
}));

app.get("/api/planning-parameters/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const param = await storage.getPlanningParameter(req.params.id);
    const verified = verifyTenantOwnership(param, tenantId);
    if (!verified) throw new NotFoundError("Planeringsparameter hittades inte");
    res.json(verified);
}));

app.post("/api/planning-parameters", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertPlanningParameterSchema.parse({ ...req.body, tenantId });
    const param = await storage.createPlanningParameter(data);
    res.status(201).json(param);
}));

app.patch("/api/planning-parameters/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPlanningParameter(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Planeringsparameter hittades inte");
    }
    const updateSchema = insertPlanningParameterSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw parseResult.error;
    }
    const param = await storage.updatePlanningParameter(req.params.id, parseResult.data);
    if (!param) throw new NotFoundError("Planeringsparameter hittades inte");
    res.json(param);
}));

app.delete("/api/planning-parameters/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPlanningParameter(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      throw new NotFoundError("Planeringsparameter hittades inte");
    }
    await storage.deletePlanningParameter(req.params.id);
    res.status(204).send();
}));

// ============== MOTOR-/REGELADMINISTRATION (Task #1234) ==============
// Samlad admin-yta för klumpmotor/restidsmotor/planeringsmotor-defaults.
// Bär endast den generella tenant-raden i planning_parameters (customer_id
// IS NULL AND object_id IS NULL) — SLA/kund-/objekt-scopade rader hanteras
// via /api/planning-parameters ovan och rörs inte här. Motorernas hårdkodade
// defaults (time-geo-engine.ts, weeklyPlanEngine.ts) exponeras read-only så
// UI:t kan visa vad som gäller när ett fält är tomt.
const ENGINE_CONFIG_DEFAULTS = {
  groupingRadiusMeters: 30,
  streetSideGrouping: true,
  workPacePercent: 100,
  dailyCapacityMinutes: 8 * 60,
  speedCapKmh: null as number | null,
  travelTimeFactor: null as number | null,
  productionTimeFactor: null as number | null,
  winterFactor: null as number | null,
  winterStart: null as string | null,
  winterEnd: null as string | null,
  costPerKmOre: 250,
  co2KgPerKm: 0.25,
  defaultSpeedKmh: 50,
  nightRestMinMinutes: 11 * 60,
  weekendRestMinMinutes: 36 * 60,
  travelShareThreshold: 0.35,
  defaultContractedHours: 40,
};

const engineConfigFieldSchema = z.object({
  groupingRadiusMeters: z.coerce.number().int().min(1).max(5000).nullable().optional(),
  streetSideGrouping: z.boolean().nullable().optional(),
  workPacePercent: z.coerce.number().min(1).max(500).nullable().optional(),
  dailyCapacityMinutes: z.coerce.number().int().min(1).max(1440).nullable().optional(),
  speedCapKmh: z.coerce.number().min(1).max(300).nullable().optional(),
  travelTimeFactor: z.coerce.number().min(0.1).max(10).nullable().optional(),
  productionTimeFactor: z.coerce.number().min(0.1).max(10).nullable().optional(),
  winterFactor: z.coerce.number().min(0.1).max(10).nullable().optional(),
  winterStart: z.string().max(10).nullable().optional(),
  winterEnd: z.string().max(10).nullable().optional(),
  costPerKmOre: z.coerce.number().int().min(0).max(100000).nullable().optional(),
  co2KgPerKm: z.coerce.number().min(0).max(50).nullable().optional(),
  defaultSpeedKmh: z.coerce.number().min(1).max(300).nullable().optional(),
  nightRestMinMinutes: z.coerce.number().int().min(0).max(10080).nullable().optional(),
  weekendRestMinMinutes: z.coerce.number().int().min(0).max(10080).nullable().optional(),
  travelShareThreshold: z.coerce.number().min(0).max(1).nullable().optional(),
  defaultContractedHours: z.coerce.number().min(0).max(168).nullable().optional(),
});

app.get("/api/engine-config", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const row = await storage.getTenantEngineDefaults(tenantId);
  res.json({
    id: row?.id ?? null,
    values: {
      groupingRadiusMeters: row?.groupingRadiusMeters ?? null,
      streetSideGrouping: row?.streetSideGrouping ?? null,
      workPacePercent: row?.workPacePercent ?? null,
      dailyCapacityMinutes: row?.dailyCapacityMinutes ?? null,
      speedCapKmh: row?.speedCapKmh ?? null,
      travelTimeFactor: row?.travelTimeFactor ?? null,
      productionTimeFactor: row?.productionTimeFactor ?? null,
      winterFactor: row?.winterFactor ?? null,
      winterStart: row?.winterStart ?? null,
      winterEnd: row?.winterEnd ?? null,
      costPerKmOre: row?.costPerKmOre ?? null,
      co2KgPerKm: row?.co2KgPerKm ?? null,
      defaultSpeedKmh: row?.defaultSpeedKmh ?? null,
      nightRestMinMinutes: row?.nightRestMinMinutes ?? null,
      weekendRestMinMinutes: row?.weekendRestMinMinutes ?? null,
      travelShareThreshold: row?.travelShareThreshold ?? null,
      defaultContractedHours: row?.defaultContractedHours ?? null,
    },
    defaults: ENGINE_CONFIG_DEFAULTS,
  });
}));

app.put("/api/engine-config", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const parseResult = engineConfigFieldSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw parseResult.error;
  }
  const row = await storage.upsertTenantEngineDefaults(tenantId, parseResult.data);
  res.json(row);
}));

// ============== RESOURCE VEHICLES ==============
app.get("/api/resources/:resourceId/vehicles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurs hittades inte");
    }
    const resourceVehicles = await storage.getResourceVehicles(req.params.resourceId);
    res.json(resourceVehicles);
}));

app.post("/api/resources/:resourceId/vehicles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurs hittades inte");
    }
    const data = insertResourceVehicleSchema.parse({ ...req.body, resourceId: req.params.resourceId });
    const rv = await storage.createResourceVehicle(data);
    res.status(201).json(rv);
}));

app.patch("/api/resource-vehicles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceVehicle(req.params.id);
    if (!existing) throw new NotFoundError("Resursfordon hittades inte");
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resursfordon hittades inte");
    }
    
    const { id, resourceId, vehicleId, createdAt, ...updateData } = req.body;
    const rv = await storage.updateResourceVehicle(req.params.id, updateData);
    if (!rv) throw new NotFoundError("Resursfordon hittades inte");
    res.json(rv);
}));

app.delete("/api/resource-vehicles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceVehicle(req.params.id);
    if (!existing) throw new NotFoundError("Resursfordon hittades inte");
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resursfordon hittades inte");
    }
    
    await storage.deleteResourceVehicle(req.params.id);
    res.status(204).send();
}));

// ============== RESOURCE EQUIPMENT ==============
app.get("/api/resources/:resourceId/equipment", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurs hittades inte");
    }
    const resourceEquipment = await storage.getResourceEquipment(req.params.resourceId);
    res.json(resourceEquipment);
}));

app.post("/api/resources/:resourceId/equipment", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resurs hittades inte");
    }
    const data = insertResourceEquipmentSchema.parse({ ...req.body, resourceId: req.params.resourceId });
    const re = await storage.createResourceEquipment(data);
    res.status(201).json(re);
}));

app.patch("/api/resource-equipment/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceEquipmentById(req.params.id);
    if (!existing) throw new NotFoundError("Resursutrustning hittades inte");
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resursutrustning hittades inte");
    }
    
    const { id, resourceId, equipmentId, createdAt, ...updateData } = req.body;
    const re = await storage.updateResourceEquipment(req.params.id, updateData);
    if (!re) throw new NotFoundError("Resursutrustning hittades inte");
    res.json(re);
}));

app.delete("/api/resource-equipment/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceEquipmentById(req.params.id);
    if (!existing) throw new NotFoundError("Resursutrustning hittades inte");
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      throw new NotFoundError("Resursutrustning hittades inte");
    }
    
    await storage.deleteResourceEquipment(req.params.id);
    res.status(204).send();
}));

// ============== TERMINOLOGY (Tenant Labels) ==============
app.get("/api/terminology", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { tenantLabels, DEFAULT_TERMINOLOGY, INDUSTRY_TERMINOLOGY } = await import("@shared/schema");
    const labels = await db.select().from(tenantLabels).where(eq(tenantLabels.tenantId, tenantId));
    const tenant = await storage.getTenant(tenantId);
    const industry = tenant?.industry || "waste_management";
    const industryDefaults = INDUSTRY_TERMINOLOGY[industry] || {};
    const merged: Record<string, string> = { ...DEFAULT_TERMINOLOGY, ...industryDefaults };
    for (const label of labels) {
      merged[label.labelKey] = label.labelValue;
    }
    res.setHeader("Cache-Control", "private, max-age=300, stale-while-revalidate=600");
    res.setHeader("Vary", "Cookie, Accept-Encoding");
    res.json({ labels: merged, customized: labels.map(l => l.labelKey), industry });
}));

app.put("/api/terminology", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { tenantLabels, DEFAULT_TERMINOLOGY } = await import("@shared/schema");
    const updates = req.body.labels as Record<string, string>;
    if (!updates || typeof updates !== "object") {
      throw new ValidationError("labels krävs som objekt");
    }
    const allowedKeys = new Set(Object.keys(DEFAULT_TERMINOLOGY));
    await db.transaction(async (tx) => {
      await tx.delete(tenantLabels).where(eq(tenantLabels.tenantId, tenantId));
      for (const [key, value] of Object.entries(updates)) {
        if (typeof key !== "string" || typeof value !== "string") continue;
        if (!allowedKeys.has(key)) continue;
        const trimmedValue = value.trim();
        if (trimmedValue && trimmedValue.length <= 100) {
          await tx.insert(tenantLabels).values({ tenantId, labelKey: key, labelValue: trimmedValue });
        }
      }
    });
    res.json({ success: true });
}));

app.get("/api/break-config", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    const settings = (tenant?.settings as Record<string, any>) || {};
    const raw = settings.breakConfig || {
      enabled: true,
      durationMinutes: 30,
      earliestStart: 11 * 3600,
      latestEnd: 13 * 3600,
    };
    const earliestSec = raw.earliestStart ?? raw.earliestSeconds ?? 11 * 3600;
    const latestSec = raw.latestEnd ?? raw.latestSeconds ?? 13 * 3600;
    const toHHMM = (s: number) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
    res.json({
      ...raw,
      earliestStart: earliestSec,
      latestEnd: latestSec,
      earliestSeconds: earliestSec,
      latestSeconds: latestSec,
      earliestTime: toHHMM(earliestSec),
      latestTime: toHHMM(latestSec),
    });
}));

app.patch("/api/break-config", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const schema = z.object({
      enabled: z.boolean().optional(),
      durationMinutes: z.number().min(15).max(120).optional(),
      earliestStart: z.number().optional(),
      latestEnd: z.number().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Ogiltig rastkonfiguration");
    }
    const tenant = await storage.getTenant(tenantId);
    const currentSettings = (tenant?.settings as Record<string, any>) || {};
    const currentBreak = currentSettings.breakConfig || {
      enabled: true,
      durationMinutes: 30,
      earliestStart: 11 * 3600,
      latestEnd: 13 * 3600,
    };
    const updatedBreak = { ...currentBreak, ...parsed.data };
    await storage.updateTenantSettings(tenantId, { ...currentSettings, breakConfig: updatedBreak });
    res.json(updatedBreak);
}));



}
