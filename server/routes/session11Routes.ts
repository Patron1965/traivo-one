import type { Express } from "express";
import { storage } from "../storage";
import { formatZodError, verifyTenantOwnership } from "./helpers";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ConflictError } from "../errors";
import {
  insertSupplierSchema,
  insertSupplierArticleLinkSchema,
  insertProductionTimeListSchema,
} from "@shared/schema";

export async function registerSession11Routes(app: Express) {
  // ============================================
  // Register 5: Leverantörsregister
  // ============================================
  app.get("/api/suppliers", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const includeDeleted = req.query.includeDeleted === "true";
    const list = await storage.getSuppliers(tenantId, { includeDeleted });
    res.json(list);
  }));

  app.get("/api/suppliers/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const supplier = await storage.getSupplier(req.params.id, tenantId);
    if (!supplier) throw new NotFoundError("Leverantör hittades inte");
    res.json(supplier);
  }));

  app.post("/api/suppliers", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = insertSupplierSchema.safeParse({ ...req.body, tenantId });
    if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
    const supplier = await storage.createSupplier(parsed.data);
    res.status(201).json(supplier);
  }));

  app.patch("/api/suppliers/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getSupplier(req.params.id, tenantId);
    if (!existing) throw new NotFoundError("Leverantör hittades inte");
    const partial = insertSupplierSchema.partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json(formatZodError(partial.error));
    const { tenantId: _t, ...patch } = partial.data as any;
    const supplier = await storage.updateSupplier(req.params.id, tenantId, patch);
    res.json(supplier);
  }));

  app.delete("/api/suppliers/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getSupplier(req.params.id, tenantId);
    if (!existing) throw new NotFoundError("Leverantör hittades inte");
    await storage.deleteSupplier(req.params.id, tenantId);
    res.status(204).send();
  }));

  // Leverantörskopplingar per leverantör
  app.get("/api/suppliers/:id/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const supplier = await storage.getSupplier(req.params.id, tenantId);
    if (!supplier) throw new NotFoundError("Leverantör hittades inte");
    const links = await storage.getSupplierArticleLinks(tenantId, { supplierId: req.params.id });
    res.json(links);
  }));

  // ============================================
  // Leverantörskopplingar per artikel (flera leverantörer per artikel)
  // ============================================
  app.get("/api/articles/:articleId/suppliers", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const article = await storage.getArticle(req.params.articleId);
    if (!verifyTenantOwnership(article, tenantId)) throw new NotFoundError("Artikel hittades inte");
    const links = await storage.getSupplierArticleLinks(tenantId, { articleId: req.params.articleId });
    res.json(links);
  }));

  app.post("/api/articles/:articleId/suppliers", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const article = await storage.getArticle(req.params.articleId);
    if (!verifyTenantOwnership(article, tenantId)) throw new NotFoundError("Artikel hittades inte");
    const parsed = insertSupplierArticleLinkSchema.safeParse({
      ...req.body,
      tenantId,
      articleId: req.params.articleId,
    });
    if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
    if (parsed.data.purchasePrice != null && parsed.data.purchasePrice < 0) {
      throw new ValidationError("Inköpspris kan inte vara negativt");
    }
    if (parsed.data.leadTimeDays != null && parsed.data.leadTimeDays < 0) {
      throw new ValidationError("Leveranstid kan inte vara negativ");
    }
    const supplier = await storage.getSupplier(parsed.data.supplierId, tenantId);
    if (!supplier) throw new ValidationError("Leverantör hittades inte i tenant");
    try {
      const link = await storage.createSupplierArticleLink(parsed.data);
      res.status(201).json(link);
    } catch (err: any) {
      if (err?.code === "23505") throw new ConflictError("Leverantören är redan kopplad till artikeln");
      throw err;
    }
  }));

  app.patch("/api/supplier-article-links/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getSupplierArticleLink(req.params.id, tenantId);
    if (!existing) throw new NotFoundError("Leverantörskoppling hittades inte");
    const partial = insertSupplierArticleLinkSchema.partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json(formatZodError(partial.error));
    const { tenantId: _t, articleId: _a, supplierId: _s, ...patch } = partial.data as any;
    if (patch.purchasePrice != null && patch.purchasePrice < 0) {
      throw new ValidationError("Inköpspris kan inte vara negativt");
    }
    if (patch.leadTimeDays != null && patch.leadTimeDays < 0) {
      throw new ValidationError("Leveranstid kan inte vara negativ");
    }
    const link = await storage.updateSupplierArticleLink(req.params.id, tenantId, patch);
    res.json(link);
  }));

  app.delete("/api/supplier-article-links/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getSupplierArticleLink(req.params.id, tenantId);
    if (!existing) throw new NotFoundError("Leverantörskoppling hittades inte");
    await storage.deleteSupplierArticleLink(req.params.id, tenantId);
    res.status(204).send();
  }));

  // ============================================
  // Register 3: Produktionstidslista
  // ============================================
  app.get("/api/production-time-lists", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const articleId = typeof req.query.articleId === "string" ? req.query.articleId : undefined;
    const list = await storage.getProductionTimeLists(tenantId, articleId);
    res.json(list);
  }));

  app.get("/api/production-time-lists/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const row = await storage.getProductionTimeList(req.params.id, tenantId);
    if (!row) throw new NotFoundError("Produktionstid hittades inte");
    res.json(row);
  }));

  // Validera att ev. utförare/utrustning tillhör tenant (förhindrar
  // korstenant-referensinjektion via FK utan tenant-villkor).
  async function assertProductionRefsInTenant(
    tenantId: string,
    performerResourceId?: string | null,
    equipmentId?: string | null,
  ) {
    if (performerResourceId) {
      const resource = await storage.getResource(performerResourceId);
      if (!verifyTenantOwnership(resource, tenantId)) {
        throw new ValidationError("Utförare (resurs) hittades inte i tenant");
      }
    }
    if (equipmentId) {
      const equipmentList = await storage.getEquipment(tenantId);
      if (!equipmentList.some((e) => e.id === equipmentId)) {
        throw new ValidationError("Utrustning hittades inte i tenant");
      }
    }
  }

  app.post("/api/production-time-lists", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = insertProductionTimeListSchema.safeParse({ ...req.body, tenantId });
    if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
    if (parsed.data.productionTimeMinutes <= 0) {
      throw new ValidationError("Produktionstid måste vara större än 0");
    }
    const article = await storage.getArticle(parsed.data.articleId);
    if (!verifyTenantOwnership(article, tenantId)) throw new ValidationError("Artikel hittades inte i tenant");
    await assertProductionRefsInTenant(tenantId, parsed.data.performerResourceId, parsed.data.equipmentId);
    const row = await storage.createProductionTimeList(parsed.data);
    res.status(201).json(row);
  }));

  app.patch("/api/production-time-lists/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getProductionTimeList(req.params.id, tenantId);
    if (!existing) throw new NotFoundError("Produktionstid hittades inte");
    const partial = insertProductionTimeListSchema.partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json(formatZodError(partial.error));
    const { tenantId: _t, articleId: _a, ...patch } = partial.data as any;
    if (patch.productionTimeMinutes !== undefined && patch.productionTimeMinutes <= 0) {
      throw new ValidationError("Produktionstid måste vara större än 0");
    }
    await assertProductionRefsInTenant(tenantId, patch.performerResourceId, patch.equipmentId);
    const row = await storage.updateProductionTimeList(req.params.id, tenantId, patch);
    res.json(row);
  }));

  app.delete("/api/production-time-lists/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getProductionTimeList(req.params.id, tenantId);
    if (!existing) throw new NotFoundError("Produktionstid hittades inte");
    await storage.deleteProductionTimeList(req.params.id, tenantId);
    res.status(204).send();
  }));

  // ============================================
  // Register 4: Strukturartikelregister (eget register-yta över
  // befintliga articles(isStructure) + article_components — en källa till sanning).
  // ============================================
  app.get("/api/structure-articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const all = await storage.getArticles(tenantId);
    const structures = all.filter((a: any) => a.isStructure);
    const withCounts = await Promise.all(structures.map(async (a: any) => {
      const components = await storage.getArticleComponents(a.id, tenantId);
      return { ...a, componentCount: components.length };
    }));
    res.json(withCounts);
  }));

  app.get("/api/structure-articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const article = await storage.getArticle(req.params.id);
    if (!verifyTenantOwnership(article, tenantId) || !(article as any).isStructure) {
      throw new NotFoundError("Strukturartikel hittades inte");
    }
    const components = await storage.getArticleComponents(req.params.id, tenantId);
    const all = await storage.getArticles(tenantId);
    const byId = new Map(all.map((a: any) => [a.id, a]));
    const enriched = components.map((c: any) => ({ ...c, childArticle: byId.get(c.childArticleId) }));
    res.json({ ...article, components: enriched });
  }));
}
