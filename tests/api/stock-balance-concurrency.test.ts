// === Task: Säkra att lagersaldon aldrig dubbelbokas vid samtidiga slutföranden ===
// Bevisar att radlåsen (FOR UPDATE) i stock-balance.ts håller under verklig
// parallellism mot databasen:
//   1. Parallella reconcileWorkOrderLineStock-anrop mot SAMMA orderrad ger exakt
//      EN rörelse och exakt ETT saldodrag (aldrig dubbelbokning).
//   2. Parallella setStockBalance/countStock-anrop ger en rörelselogg vars
//      delta-summa exakt matchar saldoförändringen och vars balanceAfter-kedja
//      är seriellt konsistent (varje steg = föregående + delta).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../server/db";
import {
  articles,
  customers,
  stockBalances,
  stockMovements,
  tenants,
  workOrderLines,
  workOrders,
} from "../../shared/schema";
import {
  countStock,
  reconcileWorkOrderLineStock,
  setStockBalance,
} from "../../server/services/stock-balance";
import { randomId } from "./helpers";

const TEST_TENANT = `stocktest-${Date.now()}-tenant`;

let customerId: string;
let articleId: string;
let workOrderId: string;
let lineId: string;
let location: string;

async function getBalance(loc: string): Promise<number> {
  const [row] = await db
    .select({ balance: stockBalances.balance })
    .from(stockBalances)
    .where(and(
      eq(stockBalances.tenantId, TEST_TENANT),
      eq(stockBalances.articleId, articleId),
      eq(stockBalances.location, loc),
    ));
  return row?.balance ?? 0;
}

async function getMovements(loc: string) {
  return db
    .select()
    .from(stockMovements)
    .where(and(
      eq(stockMovements.tenantId, TEST_TENANT),
      eq(stockMovements.articleId, articleId),
      eq(stockMovements.location, loc),
    ));
}

/** Verifierar att rörelserna kan ordnas till en seriell kedja från startsaldot:
 * det finns en permutation där varje stegs balanceAfter = föregående + delta. */
function isSerialChain(
  movements: { delta: number; balanceAfter: number }[],
  start: number,
): boolean {
  const remaining = [...movements];
  let current = start;
  while (remaining.length > 0) {
    const idx = remaining.findIndex((m) => current + m.delta === m.balanceAfter);
    if (idx === -1) return false;
    current = remaining[idx].balanceAfter;
    remaining.splice(idx, 1);
  }
  return true;
}

beforeAll(async () => {
  location = `TESTLAGER-${randomId()}`;
  await db.insert(tenants).values({ id: TEST_TENANT, name: "Lagertest-tenant" }).onConflictDoNothing();
  const [customer] = await db.insert(customers).values({
    tenantId: TEST_TENANT,
    name: `Lagertest Kund ${randomId()}`,
    customerNumber: randomId(),
  }).returning();
  customerId = customer.id;

  const [article] = await db.insert(articles).values({
    tenantId: TEST_TENANT,
    articleNumber: `LAGER-${randomId()}`,
    name: "Lagertest-artikel",
    articleType: "vara",
    stockLocation: location,
  }).returning();
  articleId = article.id;

  const [wo] = await db.insert(workOrders).values({
    tenantId: TEST_TENANT,
    customerId,
    title: "Lagertest-order",
  }).returning();
  workOrderId = wo.id;

  const [line] = await db.insert(workOrderLines).values({
    tenantId: TEST_TENANT,
    workOrderId,
    articleId,
    quantity: 5,
    takenQuantity: 5,
    returnedQuantity: 0,
  }).returning();
  lineId = line.id;
});

afterAll(async () => {
  await db.delete(stockMovements).where(and(
    eq(stockMovements.tenantId, TEST_TENANT),
    eq(stockMovements.articleId, articleId),
  ));
  await db.delete(stockBalances).where(and(
    eq(stockBalances.tenantId, TEST_TENANT),
    eq(stockBalances.articleId, articleId),
  ));
  await db.delete(workOrderLines).where(eq(workOrderLines.id, lineId));
  await db.delete(workOrders).where(eq(workOrders.id, workOrderId));
  await db.delete(articles).where(eq(articles.id, articleId));
  await db.delete(customers).where(eq(customers.id, customerId));
  await db.delete(tenants).where(eq(tenants.id, TEST_TENANT));
});

describe("Lagersaldo: samtidighetssäkerhet (FOR UPDATE)", () => {
  it("parallella reconcile-anrop mot samma rad drar saldot exakt EN gång", async () => {
    // Startsaldo 100 på artikelns lagerplats (via setStockBalance, utan rörelse).
    await setStockBalance(TEST_TENANT, articleId, location, { balance: 100 });

    // 8 samtidiga reconcile-anrop — som om flera slutföranden/synkar racear.
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => reconcileWorkOrderLineStock(TEST_TENANT, lineId)),
    );
    const failures = results.filter((r) => r.status === "rejected");
    expect(failures, JSON.stringify(failures)).toHaveLength(0);

    // Exakt ETT drag: 100 - 5 = 95, aldrig 100 - 5*n.
    expect(await getBalance(location)).toBe(95);

    // Exakt EN uttag-rörelse med delta -5 och korrekt balanceAfter.
    const movements = (await getMovements(location)).filter((m) => m.movementType === "uttag");
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(-5);
    expect(movements[0].balanceAfter).toBe(95);
    expect(movements[0].workOrderId).toBe(workOrderId);

    // Idempotens-stämpeln på raden = netto som dragits.
    const [line] = await db
      .select({ applied: workOrderLines.stockAppliedQuantity, loc: workOrderLines.stockAppliedLocation })
      .from(workOrderLines)
      .where(eq(workOrderLines.id, lineId));
    expect(line.applied).toBe(5);
    expect(line.loc).toBe(location);
  });

  it("parallell reconcile efter retur-ändring applicerar retur-deltat exakt en gång", async () => {
    // Retur registreras: netto blir 5 - 3 = 2, dvs 3 st ska tillbaka till lagret.
    await db
      .update(workOrderLines)
      .set({ returnedQuantity: 3 })
      .where(eq(workOrderLines.id, lineId));

    const before = await getBalance(location);
    await Promise.all(
      Array.from({ length: 6 }, () => reconcileWorkOrderLineStock(TEST_TENANT, lineId)),
    );

    expect(await getBalance(location)).toBe(before + 3);
    const returns = (await getMovements(location)).filter((m) => m.movementType === "retur");
    expect(returns).toHaveLength(1);
    expect(returns[0].delta).toBe(3);
  });

  it("parallella setStockBalance-anrop: delta-summan i rörelseloggen matchar saldoförändringen", async () => {
    const loc = `TESTLAGER-SET-${randomId()}`;
    const start = 0;
    const targets = [10, 25, 7, 40, 3, 18];

    await Promise.all(
      targets.map((balance) =>
        setStockBalance(TEST_TENANT, articleId, loc, { balance }, { type: "justering" }),
      ),
    );

    const finalBalance = await getBalance(loc);
    expect(targets).toContain(finalBalance);

    const movements = await getMovements(loc);
    // Delta-summan förklarar exakt saldoförändringen — inget dubbelbokat/tappat.
    const deltaSum = movements.reduce((s, m) => s + m.delta, 0);
    expect(deltaSum).toBe(finalBalance - start);
    // balanceAfter-kedjan är seriellt konsistent (radlåset serialiserar skrivningarna).
    expect(isSerialChain(movements, start)).toBe(true);
  });

  it("parallella countStock-anrop: inventeringsrörelser bildar konsistent kedja", async () => {
    const loc = `TESTLAGER-COUNT-${randomId()}`;
    await setStockBalance(TEST_TENANT, articleId, loc, { balance: 50 });

    const counts = [42, 55, 48, 60];
    const results = await Promise.all(
      counts.map((counted) => countStock(TEST_TENANT, articleId, loc, counted)),
    );
    for (const r of results) expect(counts).toContain(r.balance);

    const finalBalance = await getBalance(loc);
    expect(counts).toContain(finalBalance);

    const movements = (await getMovements(loc)).filter((m) => m.movementType === "inventering");
    const deltaSum = movements.reduce((s, m) => s + m.delta, 0);
    expect(deltaSum).toBe(finalBalance - 50);
    expect(isSerialChain(movements, 50)).toBe(true);
  });
});
