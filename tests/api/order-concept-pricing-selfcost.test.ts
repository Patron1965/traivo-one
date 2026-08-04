// Task #1350: koncept-expansionens kostnads-snapshot måste använda den delade
// självkostnadsmotorn (shared/article-pricing) — även i no-customer-fallbacken
// (listPriceFor) och i storage.resolveArticlePrice-vägen. Verifierar calc-,
// standard- och legacy-lägena mot riktig dev-DB (samma mönster som övriga
// order-concept-tester; städar upp i afterAll).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../../server/db";
import { tenants, customers, articles } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { prepareConceptCustomerPricing } from "../../server/routes/fortnoxRoutes";
import { conceptArticleCostOre } from "../../server/routes/orderConceptRoutes";
import { computeConceptOrderValue } from "@shared/order-concept-value";
import { storage } from "../../server/storage";

const NS = `calc-${Date.now()}`;
const TENANT = `${NS}-t`;
let custId: string;
let calcArtId: string;
let stdArtId: string;
let legacyArtId: string;

beforeAll(async () => {
  await db.insert(tenants).values({ id: TENANT, name: "Kalkyltest", slug: TENANT });
  const [cust] = await db
    .insert(customers)
    .values({ tenantId: TENANT, customerNumber: `${NS}-c1`, name: "Kalkylkund" } as any)
    .returning();
  custId = cust.id;

  // calc: 50 kr inköp + 5 kr frakt + (30/60 × 600 kr/h = 300 kr tidskostnad) + 6 kr intern = 361 kr
  const [calcArt] = await db.insert(articles).values({
    tenantId: TENANT,
    articleNumber: `${NS}-calc`,
    name: "Kalkylartikel",
    articleType: "vara",
    costingMethod: "calc",
    purchasePrice: 5000,
    freightCost: 500,
    productionTime: 30,
    hourlyCost: 60000,
    cost: 600,
    listPrice: 50000,
  } as any).returning();
  calcArtId = calcArt.id;

  // standard: fast 128 kr ersätter kalkylen (inköpspris ignoreras)
  const [stdArt] = await db.insert(articles).values({
    tenantId: TENANT,
    articleNumber: `${NS}-std`,
    name: "Standardkostnadsartikel",
    articleType: "tjanst",
    costingMethod: "standard",
    standardCost: 12800,
    purchasePrice: 99999,
    listPrice: 17500,
  } as any).returning();
  stdArtId = stdArt.id;

  // legacy (costingMethod null): tjänst → standardkostnad som bas + material
  const [legacyArt] = await db.insert(articles).values({
    tenantId: TENANT,
    articleNumber: `${NS}-legacy`,
    name: "Legacyartikel",
    articleType: "tjanst",
    standardCost: 7000,
    materialCost: 500,
    listPrice: 10000,
  } as any).returning();
  legacyArtId = legacyArt.id;
});

afterAll(async () => {
  await db.delete(articles).where(inArray(articles.id, [calcArtId, stdArtId, legacyArtId]));
  await db.delete(customers).where(eq(customers.tenantId, TENANT));
  await db.delete(tenants).where(eq(tenants.id, TENANT));
});

describe("koncept-prissättning: självkostnad via delad motor", () => {
  it("no-customer-fallbacken snapshotar kalkylens självkostnad (calc)", async () => {
    const { resolvePrice } = await prepareConceptCustomerPricing({
      concept: { customerMode: "HARDCODED", customerId: null },
      tenantId: TENANT,
      matchingObjects: [],
      runPrePass: false,
    });
    const art = await storage.getArticle(calcArtId);
    const memo = await resolvePrice(art, calcArtId, null);
    expect(memo.cost).toBe(5000 + 500 + 30000 + 600); // 361 kr
    expect(memo.price).toBe(50000);
  });

  it("no-customer-fallbacken respekterar fast standardkostnad (standard)", async () => {
    const { resolvePrice } = await prepareConceptCustomerPricing({
      concept: { customerMode: "HARDCODED", customerId: null },
      tenantId: TENANT,
      matchingObjects: [],
      runPrePass: false,
    });
    const art = await storage.getArticle(stdArtId);
    const memo = await resolvePrice(art, stdArtId, null);
    expect(memo.cost).toBe(12800); // ersätter kalkylen — inköpspriset ingår ej
  });

  it("legacy-artiklar utan kostnadsläge behåller typ-styrd kostnadsbas", async () => {
    const { resolvePrice } = await prepareConceptCustomerPricing({
      concept: { customerMode: "HARDCODED", customerId: null },
      tenantId: TENANT,
      matchingObjects: [],
      runPrePass: false,
    });
    const art = await storage.getArticle(legacyArtId);
    const memo = await resolvePrice(art, legacyArtId, null);
    expect(memo.cost).toBe(7000 + 500); // standardkostnad + material (oförändrat)
  });

  it("review-summary-kostnaden (conceptArticleCostOre) följer calc/standard/legacy", async () => {
    const calcArt = await storage.getArticle(calcArtId);
    const stdArt = await storage.getArticle(stdArtId);
    const legacyArt = await storage.getArticle(legacyArtId);
    expect(conceptArticleCostOre(calcArt)).toBe(5000 + 500 + 30000 + 600);
    expect(conceptArticleCostOre(stdArt)).toBe(12800);
    expect(conceptArticleCostOre(legacyArt)).toBe(7000 + 500);
    expect(conceptArticleCostOre(undefined)).toBe(0);

    // totalCostKr i review-summary drivs av valueArticleInputs.costOre → totalCostOre
    const value = computeConceptOrderValue({
      matchedCount: 1,
      articles: [
        { unitPriceOre: 50000, quantity: 2, costOre: conceptArticleCostOre(calcArt), productionTimeMinutes: 30 },
        { unitPriceOre: 17500, quantity: 1, costOre: conceptArticleCostOre(stdArt), productionTimeMinutes: 0 },
      ],
    });
    expect(value.totalCostOre).toBe(36100 * 2 + 12800);
  });

  it("wizardens sidofälts-kostnad == review-summary (delad resolver, ingen drift)", async () => {
    // Wizarden (klient) bygger valueArticleInputs med
    // `art ? resolveArticleCostBasisOre(art) : 0`; servern via conceptArticleCostOre.
    // Båda måste vara identiska för calc/standard/legacy.
    const { resolveArticleCostBasisOre } = await import("@shared/article-pricing");
    for (const id of [calcArtId, stdArtId, legacyArtId]) {
      const art = await storage.getArticle(id);
      const wizardCost = art ? resolveArticleCostBasisOre(art) : 0;
      expect(wizardCost).toBe(conceptArticleCostOre(art));
    }
  });

  it("kund-vägen (storage.resolveArticlePrice) ger samma självkostnad som fallbacken", async () => {
    const info = await storage.resolveArticlePrice(TENANT, calcArtId, custId);
    expect(info.cost).toBe(5000 + 500 + 30000 + 600);
    const infoStd = await storage.resolveArticlePrice(TENANT, stdArtId, custId);
    expect(infoStd.cost).toBe(12800);
  });
});
