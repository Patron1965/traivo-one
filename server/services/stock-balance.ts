// === Lagermodell (Motor 8): saldo-tjänst ===
// Enda källan för mutation och läsning av lagersaldon (stock_balances).
// Saldot muteras via reconcileWorkOrderLineStock (avdrag för taget/förbrukat,
// återläggning vid retur) samt manuell justering från inköp/planering.
//
// Idempotens: varje orderrad bär stock_applied_quantity = det netto (taget - retur)
// som redan dragits från saldot. Reconcile applicerar ENBART delta:t mellan nytt och
// redan draget netto, så om-registrering/omslutförande aldrig dubbelbokar.
//
// Expand-contract: artiklar utan lagerplats (articles.stockLocation tomt) får aldrig
// någon saldo-rad och rör aldrig något saldo — dagens beteende är oförändrat.
import { db } from "../db";
import { and, eq, sql } from "drizzle-orm";
import { stockBalances, workOrderLines, articles, type Article } from "@shared/schema";

type DbLike = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Justerar (upsertar) saldot för en artikel + lagerplats med `delta` (kan vara
 * negativt = uttag). Skapar raden vid behov och ärver artikelns reorderPoint/
 * safetyStock som per-plats-defaults. Returnerar det nya saldot. */
export async function adjustStockBalance(
  tenantId: string,
  articleId: string,
  location: string,
  delta: number,
  opts: { article?: Article | null; tx?: DbLike } = {},
): Promise<number> {
  const runner = opts.tx ?? db;
  const loc = location.trim();
  if (!loc) throw new Error("location krävs");
  const [row] = await runner
    .insert(stockBalances)
    .values({
      tenantId,
      articleId,
      location: loc,
      balance: delta,
      reorderPoint: opts.article?.reorderPoint ?? null,
      safetyStock: opts.article?.safetyStock ?? null,
    })
    .onConflictDoUpdate({
      target: [stockBalances.tenantId, stockBalances.articleId, stockBalances.location],
      set: {
        balance: sql`${stockBalances.balance} + ${delta}`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row?.balance ?? 0;
}

/** Sätter ett absolut saldo (manuell justering/inventering) och valfria nivåer. */
export async function setStockBalance(
  tenantId: string,
  articleId: string,
  location: string,
  input: { balance: number; reorderPoint?: number | null; safetyStock?: number | null },
): Promise<void> {
  const loc = location.trim();
  if (!loc) throw new Error("location krävs");
  await db
    .insert(stockBalances)
    .values({
      tenantId,
      articleId,
      location: loc,
      balance: Math.round(input.balance),
      reorderPoint: input.reorderPoint ?? null,
      safetyStock: input.safetyStock ?? null,
    })
    .onConflictDoUpdate({
      target: [stockBalances.tenantId, stockBalances.articleId, stockBalances.location],
      set: {
        balance: Math.round(input.balance),
        ...(input.reorderPoint !== undefined ? { reorderPoint: input.reorderPoint } : {}),
        ...(input.safetyStock !== undefined ? { safetyStock: input.safetyStock } : {}),
        updatedAt: new Date(),
      },
    });
}

/** Idempotent avstämning av lagerpåverkan för EN orderrad. Drar netto-förbrukningen
 * (taget - retur) från artikelns lagerplats; återläggning sker automatiskt när retur
 * ökar (delta blir negativt → saldot ökar). No-op när:
 *   - raden saknar artikel eller taget antal aldrig registrerats (takenQuantity=null)
 *   - artikeln saknar lagerplats (stockLocation)
 *   - netto redan är applicerat (delta = 0)
 * Best-effort: fångar aldrig upp fakturering/statusbyte — anropas i try/catch. */
export async function reconcileWorkOrderLineStock(tenantId: string, lineId: string): Promise<void> {
  const [line] = await db
    .select()
    .from(workOrderLines)
    .where(and(eq(workOrderLines.id, lineId), eq(workOrderLines.tenantId, tenantId)));
  if (!line || !line.articleId) return;
  // Ingen plockdata registrerad ⇒ ingen lagerpåverkan (Mats beslut: taget antal styr).
  if (line.takenQuantity == null) return;

  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, line.articleId), eq(articles.tenantId, tenantId)));
  if (!article) return;
  // Informationspaket fält 33 ("Förbrukas ej"): artikeln drar aldrig lagersaldo
  // vid utförande även om en lagerplats är satt (t.ex. verktyg/utrustning).
  if ((article as any).notConsumed === true) return;
  const location = (article.stockLocation ?? "").trim();
  if (!location) return; // Artikel utan lagerplats rör aldrig något saldo.

  const netConsumed = Math.max((line.takenQuantity ?? 0) - (line.returnedQuantity ?? 0), 0);
  const alreadyApplied = line.stockAppliedQuantity ?? 0;
  const delta = netConsumed - alreadyApplied;
  if (delta === 0) return;

  await db.transaction(async (tx) => {
    await adjustStockBalance(tenantId, article.id, location, -delta, { article, tx });
    await tx
      .update(workOrderLines)
      .set({ stockAppliedQuantity: netConsumed })
      .where(and(eq(workOrderLines.id, line.id), eq(workOrderLines.tenantId, tenantId)));
  });
}

/** Avstämmer alla artikelrader på en arbetsorder (anropas vid slutförande). */
export async function reconcileWorkOrderStock(tenantId: string, workOrderId: string): Promise<void> {
  const lines = await db
    .select({ id: workOrderLines.id })
    .from(workOrderLines)
    .where(and(eq(workOrderLines.workOrderId, workOrderId), eq(workOrderLines.tenantId, tenantId)));
  for (const l of lines) {
    try {
      await reconcileWorkOrderLineStock(tenantId, l.id);
    } catch (e) {
      console.error(`[stock-balance] reconcile misslyckades för rad ${l.id}:`, e);
    }
  }
}

export interface StockBalanceRow {
  id: string;
  articleId: string;
  articleNumber: string;
  articleName: string;
  location: string;
  balance: number;
  effectiveReorderPoint: number | null;
  safetyStock: number | null;
  isLow: boolean;
  updatedAt: Date;
}

function mapRow(r: {
  id: string;
  articleId: string;
  articleNumber: string | null;
  articleName: string | null;
  location: string;
  balance: number;
  rowReorderPoint: number | null;
  articleReorderPoint: number | null;
  safetyStock: number | null;
  articleSafetyStock: number | null;
  updatedAt: Date;
}): StockBalanceRow {
  const effectiveReorderPoint = r.rowReorderPoint ?? r.articleReorderPoint ?? null;
  return {
    id: r.id,
    articleId: r.articleId,
    articleNumber: r.articleNumber ?? "",
    articleName: r.articleName ?? "",
    location: r.location,
    balance: r.balance,
    effectiveReorderPoint,
    safetyStock: r.safetyStock ?? r.articleSafetyStock ?? null,
    isLow: effectiveReorderPoint != null && r.balance <= effectiveReorderPoint,
    updatedAt: r.updatedAt,
  };
}

/** Alla lagersaldon för en tenant, berikade med artikelnamn/-nummer och lågt-flagga. */
export async function listStockBalances(tenantId: string): Promise<StockBalanceRow[]> {
  const rows = await db
    .select({
      id: stockBalances.id,
      articleId: stockBalances.articleId,
      articleNumber: articles.articleNumber,
      articleName: articles.name,
      location: stockBalances.location,
      balance: stockBalances.balance,
      rowReorderPoint: stockBalances.reorderPoint,
      articleReorderPoint: articles.reorderPoint,
      safetyStock: stockBalances.safetyStock,
      articleSafetyStock: articles.safetyStock,
      updatedAt: stockBalances.updatedAt,
    })
    .from(stockBalances)
    .innerJoin(articles, eq(articles.id, stockBalances.articleId))
    .where(eq(stockBalances.tenantId, tenantId))
    .orderBy(articles.name, stockBalances.location);
  return rows.map(mapRow);
}

/** Endast saldon under/på beställningspunkten (för planerare/inköp). */
export async function listLowStockBalances(tenantId: string): Promise<StockBalanceRow[]> {
  return (await listStockBalances(tenantId)).filter((r) => r.isLow);
}

/** Kompakt lågt-saldo-signal för ETT artikel+plats-par (används i mobil-svar). */
export async function getStockSignalForArticleLocation(
  tenantId: string,
  articleId: string,
  location: string,
): Promise<{ balance: number; effectiveReorderPoint: number | null; isLow: boolean } | null> {
  const loc = location.trim();
  if (!loc) return null;
  const [row] = await db
    .select({
      balance: stockBalances.balance,
      rowReorderPoint: stockBalances.reorderPoint,
    })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.tenantId, tenantId),
        eq(stockBalances.articleId, articleId),
        eq(stockBalances.location, loc),
      ),
    );
  if (!row) return null;
  const [article] = await db
    .select({ reorderPoint: articles.reorderPoint })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.tenantId, tenantId)));
  const effectiveReorderPoint = row.rowReorderPoint ?? article?.reorderPoint ?? null;
  return {
    balance: row.balance,
    effectiveReorderPoint,
    isLow: effectiveReorderPoint != null && row.balance <= effectiveReorderPoint,
  };
}
