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
import { and, desc, eq, sql } from "drizzle-orm";
import {
  stockBalances,
  stockLocations,
  stockMovements,
  workOrderLines,
  workOrders,
  articles,
  type Article,
  type StockMovementType,
} from "@shared/schema";

type DbLike = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Rörelse-kontext: när satt stämplar saldoservicen en rad i stock_movements
// (append-only rörelselogg) i samma runner som saldoförändringen.
export interface MovementContext {
  type: StockMovementType;
  workOrderId?: string | null;
  note?: string | null;
  createdBy?: string | null;
  counterpartLocation?: string | null;
}

async function stampMovement(
  runner: DbLike,
  tenantId: string,
  articleId: string,
  location: string,
  delta: number,
  balanceAfter: number,
  movement: MovementContext,
): Promise<void> {
  await runner.insert(stockMovements).values({
    tenantId,
    articleId,
    location,
    movementType: movement.type,
    delta,
    balanceAfter,
    counterpartLocation: movement.counterpartLocation ?? null,
    workOrderId: movement.workOrderId ?? null,
    note: movement.note ?? null,
    createdBy: movement.createdBy ?? null,
  });
}

/** Justerar (upsertar) saldot för en artikel + lagerplats med `delta` (kan vara
 * negativt = uttag). Skapar raden vid behov och ärver artikelns reorderPoint/
 * safetyStock som per-plats-defaults. Stämplar en rörelselogg-rad när
 * `opts.movement` anges. Returnerar det nya saldot. */
export async function adjustStockBalance(
  tenantId: string,
  articleId: string,
  location: string,
  delta: number,
  opts: { article?: Article | null; tx?: DbLike; movement?: MovementContext } = {},
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
  const newBalance = row?.balance ?? 0;
  if (opts.movement && delta !== 0) {
    await stampMovement(runner, tenantId, articleId, loc, delta, newBalance, opts.movement);
  }
  return newBalance;
}

/** Sätter ett absolut saldo (manuell justering/inventering) och valfria nivåer.
 * Stämplar rörelselogg med diffen (delta = nytt − gammalt) när `movement` anges. */
export async function setStockBalance(
  tenantId: string,
  articleId: string,
  location: string,
  input: { balance: number; reorderPoint?: number | null; safetyStock?: number | null },
  movement?: MovementContext,
): Promise<void> {
  const loc = location.trim();
  if (!loc) throw new Error("location krävs");
  const newBalance = Math.round(input.balance);
  await db.transaction(async (tx) => {
    // Samtidighetssäkert: se till att raden finns, lås den (FOR UPDATE) och läs
    // prev-saldot under låset så deltat i rörelseloggen alltid stämmer även vid
    // parallella set/count-anrop.
    await tx
      .insert(stockBalances)
      .values({
        tenantId,
        articleId,
        location: loc,
        balance: 0,
        reorderPoint: input.reorderPoint ?? null,
        safetyStock: input.safetyStock ?? null,
      })
      .onConflictDoNothing({
        target: [stockBalances.tenantId, stockBalances.articleId, stockBalances.location],
      });
    const [before] = await tx
      .select({ balance: stockBalances.balance })
      .from(stockBalances)
      .where(and(
        eq(stockBalances.tenantId, tenantId),
        eq(stockBalances.articleId, articleId),
        eq(stockBalances.location, loc),
      ))
      .for("update");
    const prevBalance = before?.balance ?? 0;
    await tx
      .update(stockBalances)
      .set({
        balance: newBalance,
        ...(input.reorderPoint !== undefined ? { reorderPoint: input.reorderPoint } : {}),
        ...(input.safetyStock !== undefined ? { safetyStock: input.safetyStock } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(stockBalances.tenantId, tenantId),
        eq(stockBalances.articleId, articleId),
        eq(stockBalances.location, loc),
      ));
    const delta = newBalance - prevBalance;
    if (movement && delta !== 0) {
      await stampMovement(tx, tenantId, articleId, loc, delta, newBalance, movement);
    }
  });
}

/** Bil-lager: hitta den aktiva lagerplats (kind='vehicle') som hör till orderns
 * utförare (resurs) eller team. Resurs-koppling vinner över team-koppling.
 * Returnerar platsnamnet, eller null om ingen bil-lagerplats finns. */
export async function resolveVehicleLocationForWorkOrder(
  tenantId: string,
  workOrderId: string,
): Promise<string | null> {
  const [order] = await db
    .select({ resourceId: workOrders.resourceId, teamId: workOrders.teamId })
    .from(workOrders)
    .where(and(eq(workOrders.id, workOrderId), eq(workOrders.tenantId, tenantId)));
  if (!order) return null;
  const rows = await db
    .select({ name: stockLocations.name, resourceId: stockLocations.resourceId, teamId: stockLocations.teamId })
    .from(stockLocations)
    .where(and(
      eq(stockLocations.tenantId, tenantId),
      eq(stockLocations.kind, "vehicle"),
      eq(stockLocations.isActive, true),
    ));
  if (order.resourceId) {
    const byResource = rows.find((r) => r.resourceId === order.resourceId);
    if (byResource) return byResource.name;
  }
  if (order.teamId) {
    const byTeam = rows.find((r) => r.teamId === order.teamId);
    if (byTeam) return byTeam.name;
  }
  return null;
}

/** Idempotent avstämning av lagerpåverkan för EN orderrad. Drar netto-förbrukningen
 * (taget - retur) från radens lagerplats; återläggning sker automatiskt när retur
 * ökar (delta blir negativt → saldot ökar).
 *
 * Platsval (Lagermodul 2.0): första draget avgör plats — utförarens bil-lager om
 * en aktiv vehicle-lagerplats finns kopplad till orderns resurs/team OCH den redan
 * bär ett saldo för artikeln; annars artikelns huvudlagerplats (dagens beteende).
 * Platsen stämplas på raden (stockAppliedLocation) och används sedan för ALLA
 * delta, så retur alltid läggs tillbaka på samma plats som uttaget. No-op när:
 *   - raden saknar artikel eller taget antal aldrig registrerats (takenQuantity=null)
 *   - artikeln saknar lagerplats (stockLocation) och ingen plats redan stämplats
 *   - netto redan är applicerat (delta = 0)
 * Best-effort: fångar aldrig upp fakturering/statusbyte — anropas i try/catch. */
export async function reconcileWorkOrderLineStock(tenantId: string, lineId: string): Promise<void> {
  // Samtidighetssäkert: hela avstämningen körs i EN tx med radlås (FOR UPDATE)
  // på orderraden — delta beräknas under låset så två parallella reconcile-anrop
  // aldrig kan dubbelboka samma delta.
  await db.transaction(async (tx) => {
    const [line] = await tx
      .select()
      .from(workOrderLines)
      .where(and(eq(workOrderLines.id, lineId), eq(workOrderLines.tenantId, tenantId)))
      .for("update");
    if (!line || !line.articleId) return;
    // Ingen plockdata registrerad ⇒ ingen lagerpåverkan (Mats beslut: taget antal styr).
    if (line.takenQuantity == null) return;

    const [article] = await tx
      .select()
      .from(articles)
      .where(and(eq(articles.id, line.articleId), eq(articles.tenantId, tenantId)));
    if (!article) return;
    // Informationspaket fält 33 ("Förbrukas ej"): artikeln drar aldrig lagersaldo
    // vid utförande även om en lagerplats är satt (t.ex. verktyg/utrustning).
    if ((article as any).notConsumed === true) return;

    // Redan applicerad plats vinner alltid (idempotens: retur → samma plats).
    let location = (line.stockAppliedLocation ?? "").trim();
    if (!location) {
      const articleLocation = (article.stockLocation ?? "").trim();
      if (!articleLocation) return; // Artikel utan lagerplats rör aldrig något saldo.
      location = articleLocation;
      // Bil-lager: dra från utförarens servicebil om den har ett saldo för artikeln.
      try {
        const vehicleLocation = await resolveVehicleLocationForWorkOrder(tenantId, line.workOrderId);
        if (vehicleLocation) {
          const [vehicleBalance] = await tx
            .select({ id: stockBalances.id })
            .from(stockBalances)
            .where(and(
              eq(stockBalances.tenantId, tenantId),
              eq(stockBalances.articleId, article.id),
              eq(stockBalances.location, vehicleLocation),
            ));
          if (vehicleBalance) location = vehicleLocation;
        }
      } catch (e) {
        console.error("[stock-balance] bil-lager-uppslag misslyckades, faller tillbaka på artikelns lagerplats:", e);
      }
    }

    const netConsumed = Math.max((line.takenQuantity ?? 0) - (line.returnedQuantity ?? 0), 0);
    const alreadyApplied = line.stockAppliedQuantity ?? 0;
    const delta = netConsumed - alreadyApplied;
    if (delta === 0) {
      // Stämpla platsen även utan delta så framtida retur hamnar rätt.
      if (!line.stockAppliedLocation && (line.stockAppliedQuantity ?? 0) !== 0) {
        await tx
          .update(workOrderLines)
          .set({ stockAppliedLocation: location })
          .where(and(eq(workOrderLines.id, line.id), eq(workOrderLines.tenantId, tenantId)));
      }
      return;
    }

    await adjustStockBalance(tenantId, article.id, location, -delta, {
      article,
      tx,
      movement: {
        type: delta > 0 ? "uttag" : "retur",
        workOrderId: line.workOrderId,
      },
    });
    await tx
      .update(workOrderLines)
      .set({ stockAppliedQuantity: netConsumed, stockAppliedLocation: location })
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

// === Lagermodul 2.0: operativa lagerflöden ===

/** Överföring mellan två lagerplatser — atomiskt (båda sidor i samma tx) med
 * spegel-rörelser (overforing_ut/overforing_in). Saldot får gå negativt på
 * från-sidan (samma designbeslut som fältuttag). */
export async function transferStock(
  tenantId: string,
  articleId: string,
  fromLocation: string,
  toLocation: string,
  quantity: number,
  opts: { article?: Article | null; note?: string | null; createdBy?: string | null } = {},
): Promise<{ fromBalance: number; toBalance: number }> {
  const from = fromLocation.trim();
  const to = toLocation.trim();
  const qty = Math.round(quantity);
  if (!from || !to) throw new Error("Både från- och till-plats krävs");
  if (from === to) throw new Error("Från- och till-plats kan inte vara samma");
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("Antal måste vara > 0");
  return db.transaction(async (tx) => {
    const fromBalance = await adjustStockBalance(tenantId, articleId, from, -qty, {
      article: opts.article,
      tx,
      movement: { type: "overforing_ut", counterpartLocation: to, note: opts.note, createdBy: opts.createdBy },
    });
    const toBalance = await adjustStockBalance(tenantId, articleId, to, qty, {
      article: opts.article,
      tx,
      movement: { type: "overforing_in", counterpartLocation: from, note: opts.note, createdBy: opts.createdBy },
    });
    return { fromBalance, toBalance };
  });
}

/** Inleverans: ökar saldot på en plats med mottaget antal. */
export async function receiveStock(
  tenantId: string,
  articleId: string,
  location: string,
  quantity: number,
  opts: { article?: Article | null; note?: string | null; createdBy?: string | null } = {},
): Promise<number> {
  const qty = Math.round(quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("Antal måste vara > 0");
  return adjustStockBalance(tenantId, articleId, location, qty, {
    article: opts.article,
    movement: { type: "inleverans", note: opts.note, createdBy: opts.createdBy },
  });
}

/** Inventering: sätter räknat saldo; diffen (räknat − bokfört) stämplas som
 * inventering-rörelse. Returnerar diffen. */
export async function countStock(
  tenantId: string,
  articleId: string,
  location: string,
  countedBalance: number,
  opts: { note?: string | null; createdBy?: string | null } = {},
): Promise<{ delta: number; balance: number }> {
  const counted = Math.round(countedBalance);
  const loc = location.trim();
  if (!loc) throw new Error("location krävs");
  const [before] = await db
    .select({ balance: stockBalances.balance })
    .from(stockBalances)
    .where(and(
      eq(stockBalances.tenantId, tenantId),
      eq(stockBalances.articleId, articleId),
      eq(stockBalances.location, loc),
    ));
  const prev = before?.balance ?? 0;
  await setStockBalance(tenantId, articleId, loc, { balance: counted }, {
    type: "inventering",
    note: opts.note,
    createdBy: opts.createdBy,
  });
  return { delta: counted - prev, balance: counted };
}

export interface StockMovementRow {
  id: string;
  articleId: string;
  articleNumber: string;
  articleName: string;
  location: string;
  movementType: string;
  delta: number;
  balanceAfter: number;
  counterpartLocation: string | null;
  workOrderId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/** Rörelselogg (senaste först) med valfria filter, berikad med artikelinfo. */
export async function listStockMovements(
  tenantId: string,
  filter: { articleId?: string; location?: string; limit?: number } = {},
): Promise<StockMovementRow[]> {
  const conditions = [eq(stockMovements.tenantId, tenantId)];
  if (filter.articleId) conditions.push(eq(stockMovements.articleId, filter.articleId));
  if (filter.location) conditions.push(eq(stockMovements.location, filter.location));
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
  const rows = await db
    .select({
      id: stockMovements.id,
      articleId: stockMovements.articleId,
      articleNumber: articles.articleNumber,
      articleName: articles.name,
      location: stockMovements.location,
      movementType: stockMovements.movementType,
      delta: stockMovements.delta,
      balanceAfter: stockMovements.balanceAfter,
      counterpartLocation: stockMovements.counterpartLocation,
      workOrderId: stockMovements.workOrderId,
      note: stockMovements.note,
      createdBy: stockMovements.createdBy,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .innerJoin(articles, eq(articles.id, stockMovements.articleId))
    .where(and(...conditions))
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    articleNumber: r.articleNumber ?? "",
    articleName: r.articleName ?? "",
  }));
}

export interface ReplenishmentSuggestion {
  locationName: string;
  locationKind: string;
  articleId: string;
  articleNumber: string;
  articleName: string;
  balance: number;
  effectiveReorderPoint: number;
  safetyStock: number | null;
  suggestedQuantity: number;
  sourceLocation: string | null;
}

/** Påfyllnadsförslag per servicebil: artiklar på aktiva vehicle-lagerplatser vars
 * saldo ligger på/under beställningspunkten. Föreslagen påfyllnad fyller upp till
 * beställningspunkt + säkerhetslager. Källa = artikelns huvudlagerplats. */
export async function listReplenishmentSuggestions(tenantId: string): Promise<ReplenishmentSuggestion[]> {
  const vehicleLocations = await db
    .select({ name: stockLocations.name, kind: stockLocations.kind })
    .from(stockLocations)
    .where(and(
      eq(stockLocations.tenantId, tenantId),
      eq(stockLocations.kind, "vehicle"),
      eq(stockLocations.isActive, true),
    ));
  if (vehicleLocations.length === 0) return [];
  const locationNames = new Set(vehicleLocations.map((l) => l.name));
  const balances = await db
    .select({
      articleId: stockBalances.articleId,
      articleNumber: articles.articleNumber,
      articleName: articles.name,
      articleStockLocation: articles.stockLocation,
      location: stockBalances.location,
      balance: stockBalances.balance,
      rowReorderPoint: stockBalances.reorderPoint,
      articleReorderPoint: articles.reorderPoint,
      safetyStock: stockBalances.safetyStock,
      articleSafetyStock: articles.safetyStock,
    })
    .from(stockBalances)
    .innerJoin(articles, eq(articles.id, stockBalances.articleId))
    .where(eq(stockBalances.tenantId, tenantId));
  const out: ReplenishmentSuggestion[] = [];
  for (const b of balances) {
    if (!locationNames.has(b.location)) continue;
    const reorderPoint = b.rowReorderPoint ?? b.articleReorderPoint;
    if (reorderPoint == null || b.balance > reorderPoint) continue;
    const safety = b.safetyStock ?? b.articleSafetyStock ?? null;
    const target = reorderPoint + (safety ?? 0);
    const sourceLocation = (b.articleStockLocation ?? "").trim() || null;
    out.push({
      locationName: b.location,
      locationKind: "vehicle",
      articleId: b.articleId,
      articleNumber: b.articleNumber ?? "",
      articleName: b.articleName ?? "",
      balance: b.balance,
      effectiveReorderPoint: reorderPoint,
      safetyStock: safety,
      suggestedQuantity: Math.max(target - b.balance, 1),
      sourceLocation: sourceLocation === b.location ? null : sourceLocation,
    });
  }
  out.sort((a, z) => a.locationName.localeCompare(z.locationName, "sv") || a.articleName.localeCompare(z.articleName, "sv"));
  return out;
}
