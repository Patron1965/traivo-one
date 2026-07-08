import type { Express } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { getTenantIdWithFallback, requirePlanner } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { articles } from "@shared/schema";
import { isActiveArticleStatus } from "../article-quantity";
import {
  listStockBalances,
  listLowStockBalances,
  setStockBalance,
} from "../services/stock-balance";

// === Lagermodell (Motor 8): planerar-/inköpsvänd läs- och justerings-yta ===
// Ligger under den vanliga /api-tenant-middleware (till skillnad från /api/mobile/*).
// Saldon muteras automatiskt av fältflödet (reconcileWorkOrderLineStock); dessa
// endpoints ger översikt + manuell justering/inventering för planerare (requirePlanner).

const setBalanceSchema = z.object({
  articleId: z.string().min(1),
  location: z.string().trim().min(1, "Lagerplats krävs"),
  balance: z.coerce.number().int(),
  reorderPoint: z.coerce.number().int().nullable().optional(),
  safetyStock: z.coerce.number().int().nullable().optional(),
});

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

  // Manuell justering/inventering av ett absolut saldo (+ valfria nivåer).
  app.put("/api/inventory/balances", requirePlanner, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsed = setBalanceSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Ogiltiga fält");
    const { articleId, location, balance, reorderPoint, safetyStock } = parsed.data;

    // Verifiera att artikeln tillhör tenanten och är aktiv (aldrig rå articleId).
    const [article] = await db
      .select()
      .from(articles)
      .where(and(eq(articles.id, articleId), eq(articles.tenantId, tenantId)));
    if (!article) throw new NotFoundError("Artikel hittades inte");
    if (!isActiveArticleStatus(article.status)) throw new ForbiddenError("Saldo kan inte sättas för en inaktiv artikel");

    await setStockBalance(tenantId, articleId, location, { balance, reorderPoint, safetyStock });
    res.json({ success: true });
  }));
}
