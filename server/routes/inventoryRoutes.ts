import type { Express, Request } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { getTenantIdWithFallback, requirePlanner } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { articles, stockLocations, resources, teams } from "@shared/schema";
import { isActiveArticleStatus } from "../article-quantity";
import {
  listStockBalances,
  listLowStockBalances,
  setStockBalance,
  transferStock,
  receiveStock,
  countStock,
  listStockMovements,
  listReplenishmentSuggestions,
} from "../services/stock-balance";

// === Lagermodul 2.0: planerar-/inköpsvänd lager-yta ===
// Ligger under den vanliga /api-tenant-middleware (till skillnad från /api/mobile/*).
// Saldon muteras automatiskt av fältflödet (reconcileWorkOrderLineStock) samt via
// de operativa flödena här (inleverans/överföring/inventering/justering). Alla
// saldoförändringar går genom saldoservicen som stämplar rörelseloggen.

const setBalanceSchema = z.object({
  articleId: z.string().min(1),
  location: z.string().trim().min(1, "Lagerplats krävs"),
  balance: z.coerce.number().int(),
  reorderPoint: z.coerce.number().int().nullable().optional(),
  safetyStock: z.coerce.number().int().nullable().optional(),
});

const transferSchema = z.object({
  articleId: z.string().min(1),
  fromLocation: z.string().trim().min(1, "Från-plats krävs"),
  toLocation: z.string().trim().min(1, "Till-plats krävs"),
  quantity: z.coerce.number().int().positive("Antal måste vara > 0"),
  note: z.string().trim().max(500).optional(),
});

const receiveSchema = z.object({
  articleId: z.string().min(1),
  location: z.string().trim().min(1, "Lagerplats krävs"),
  quantity: z.coerce.number().int().positive("Antal måste vara > 0"),
  note: z.string().trim().max(500).optional(),
});

const countSchema = z.object({
  articleId: z.string().min(1),
  location: z.string().trim().min(1, "Lagerplats krävs"),
  countedBalance: z.coerce.number().int(),
  note: z.string().trim().max(500).optional(),
});

const locationSchema = z.object({
  name: z.string().trim().min(1, "Namn krävs").max(200),
  kind: z.enum(["main", "vehicle"]).default("main"),
  resourceId: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

function actorFromRequest(req: Request): string | null {
  return (req as any).user?.claims?.sub ?? null;
}

/** Verifiera att artikeln tillhör tenanten och är aktiv (aldrig rå articleId). */
async function requireActiveArticle(tenantId: string, articleId: string) {
  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.tenantId, tenantId)));
  if (!article) throw new NotFoundError("Artikel hittades inte");
  if (!isActiveArticleStatus(article.status)) {
    throw new ForbiddenError("Åtgärden kan inte utföras för en inaktiv artikel");
  }
  return article;
}

/** Verifiera att ev. resurs-/team-koppling tillhör tenanten (aldrig rå id). */
async function validateLocationLinks(
  tenantId: string,
  input: { kind?: string; resourceId?: string | null; teamId?: string | null },
): Promise<void> {
  if (input.resourceId) {
    const [r] = await db
      .select({ id: resources.id })
      .from(resources)
      .where(and(eq(resources.id, input.resourceId), eq(resources.tenantId, tenantId)));
    if (!r) throw new ValidationError("Resursen hittades inte");
  }
  if (input.teamId) {
    const [t] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, input.teamId), eq(teams.tenantId, tenantId)));
    if (!t) throw new ValidationError("Teamet hittades inte");
  }
}

export function registerInventoryRoutes(app: Express): void {
  // Alla lagersaldon (berikade med artikelnamn/-nummer + lågt-flagga).
  app.get("/api/inventory/balances", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    res.json(await listStockBalances(tenantId));
  }));

  // Endast saldon på/under beställningspunkten (varningslista för inköp/planering).
  app.get("/api/inventory/low-stock", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    res.json(await listLowStockBalances(tenantId));
  }));

  // Manuell justering av ett absolut saldo (+ valfria nivåer). Stämplas som
  // 'justering' i rörelseloggen.
  app.put("/api/inventory/balances", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = setBalanceSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Ogiltiga fält");
    const { articleId, location, balance, reorderPoint, safetyStock } = parsed.data;
    await requireActiveArticle(tenantId, articleId);
    await setStockBalance(tenantId, articleId, location, { balance, reorderPoint, safetyStock }, {
      type: "justering",
      createdBy: actorFromRequest(req),
    });
    res.json({ success: true });
  }));

  // === Rörelselogg ===
  app.get("/api/inventory/movements", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const articleId = typeof req.query.articleId === "string" ? req.query.articleId : undefined;
    const location = typeof req.query.location === "string" ? req.query.location : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    res.json(await listStockMovements(tenantId, { articleId, location, limit }));
  }));

  // === Överföring mellan lagerplatser (atomisk, spegel-rörelser) ===
  app.post("/api/inventory/transfer", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Ogiltiga fält");
    const { articleId, fromLocation, toLocation, quantity, note } = parsed.data;
    if (fromLocation.trim() === toLocation.trim()) {
      throw new ValidationError("Från- och till-plats kan inte vara samma");
    }
    const article = await requireActiveArticle(tenantId, articleId);
    const result = await transferStock(tenantId, articleId, fromLocation, toLocation, quantity, {
      article,
      note: note ?? null,
      createdBy: actorFromRequest(req),
    });
    res.json({ success: true, ...result });
  }));

  // === Inleverans (mottagen leverans ökar saldot) ===
  app.post("/api/inventory/receive", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = receiveSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Ogiltiga fält");
    const { articleId, location, quantity, note } = parsed.data;
    const article = await requireActiveArticle(tenantId, articleId);
    const balance = await receiveStock(tenantId, articleId, location, quantity, {
      article,
      note: note ?? null,
      createdBy: actorFromRequest(req),
    });
    res.json({ success: true, balance });
  }));

  // === Inventering (räknat saldo; diffen stämplas som inventering-rörelse) ===
  app.post("/api/inventory/count", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = countSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Ogiltiga fält");
    const { articleId, location, countedBalance, note } = parsed.data;
    await requireActiveArticle(tenantId, articleId);
    const result = await countStock(tenantId, articleId, location, countedBalance, {
      note: note ?? null,
      createdBy: actorFromRequest(req),
    });
    res.json({ success: true, ...result });
  }));

  // === Lagerplatsregister ===
  app.get("/api/inventory/locations", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rows = await db
      .select({
        id: stockLocations.id,
        name: stockLocations.name,
        kind: stockLocations.kind,
        resourceId: stockLocations.resourceId,
        teamId: stockLocations.teamId,
        isActive: stockLocations.isActive,
        notes: stockLocations.notes,
        resourceName: resources.name,
        teamName: teams.name,
      })
      .from(stockLocations)
      .leftJoin(resources, eq(resources.id, stockLocations.resourceId))
      .leftJoin(teams, eq(teams.id, stockLocations.teamId))
      .where(eq(stockLocations.tenantId, tenantId))
      .orderBy(stockLocations.name);
    res.json(rows);
  }));

  app.post("/api/inventory/locations", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = locationSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Ogiltiga fält");
    const input = parsed.data;
    await validateLocationLinks(tenantId, input);
    // Unik per tenant (app-level pre-check + DB-unikindex som sista vakt).
    const [existing] = await db
      .select({ id: stockLocations.id })
      .from(stockLocations)
      .where(and(eq(stockLocations.tenantId, tenantId), eq(stockLocations.name, input.name)));
    if (existing) throw new ValidationError("En lagerplats med det namnet finns redan");
    const [row] = await db
      .insert(stockLocations)
      .values({
        tenantId,
        name: input.name,
        kind: input.kind,
        resourceId: input.resourceId ?? null,
        teamId: input.teamId ?? null,
        isActive: input.isActive ?? true,
        notes: input.notes ?? null,
      })
      .returning();
    res.status(201).json(row);
  }));

  app.patch("/api/inventory/locations/:id", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = locationSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Ogiltiga fält");
    const input = parsed.data;
    const [existing] = await db
      .select()
      .from(stockLocations)
      .where(and(eq(stockLocations.id, req.params.id), eq(stockLocations.tenantId, tenantId)));
    if (!existing) throw new NotFoundError("Lagerplatsen hittades inte");
    await validateLocationLinks(tenantId, input);
    if (input.name && input.name !== existing.name) {
      const [dup] = await db
        .select({ id: stockLocations.id })
        .from(stockLocations)
        .where(and(eq(stockLocations.tenantId, tenantId), eq(stockLocations.name, input.name)));
      if (dup) throw new ValidationError("En lagerplats med det namnet finns redan");
    }
    const [row] = await db
      .update(stockLocations)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
        ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })
      .where(and(eq(stockLocations.id, req.params.id), eq(stockLocations.tenantId, tenantId)))
      .returning();
    res.json(row);
  }));

  // === Påfyllnadsförslag per servicebil ===
  app.get("/api/inventory/replenishment", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    res.json(await listReplenishmentSuggestions(tenantId));
  }));
}
