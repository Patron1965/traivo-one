// Task #1350: Artikelkalkyl — kostnadskalkyl → självkostnad → separat priskalkyl.
// Verifierar den delade kalkylmotorn i shared/article-pricing.ts:
//  - påslag vs marginal (företagsekonomiskt olika)
//  - auto-tidskostnad (produktionstid/60 × timkostnad)
//  - baklängesräkning (TB/enhet + marginal %) vid manuellt listpris
//  - standardkostnad som explicit alternativ (ersätter kalkylen)
//  - legacy-bakåtkompatibilitet (typ-styrd kostnadsbas, oförändrad utan nya fält)
import { describe, it, expect } from "vitest";
import {
  computeArticlePricing,
  computeArticleSelfCostOre,
  computeTimeCostOre,
  resolveArticleCostBasisOre,
} from "@shared/article-pricing";

describe("computeTimeCostOre", () => {
  it("beräknar produktionstid/60 × timkostnad", () => {
    // 30 min × 600 kr/h = 300 kr
    expect(computeTimeCostOre({ productionTime: 30, hourlyCost: 60000 })).toBe(30000);
  });
  it("avrundar till hela öre", () => {
    // 10 min × 500 kr/h = 83,33... kr → 8333 öre
    expect(computeTimeCostOre({ productionTime: 10, hourlyCost: 50000 })).toBe(8333);
  });
  it("ger 0 utan tid eller timkostnad", () => {
    expect(computeTimeCostOre({ productionTime: 0, hourlyCost: 60000 })).toBe(0);
    expect(computeTimeCostOre({ productionTime: 30, hourlyCost: null })).toBe(0);
  });
});

describe("kostnadskalkyl (costingMethod=calc)", () => {
  it("summerar alla komponenter inkl. auto-tidskostnad", () => {
    const selfCost = computeArticleSelfCostOre({
      costingMethod: "calc",
      purchasePrice: 5000,
      materialCost: 1000,
      freightCost: 500,
      packagingCost: 300,
      environmentalFee: 200,
      productionTime: 30,
      hourlyCost: 60000, // → 30000 öre tidskostnad
      warehouseCost: 400,
      cost: 600,
      otherCost: 100,
    });
    expect(selfCost).toBe(5000 + 1000 + 500 + 300 + 200 + 30000 + 400 + 600 + 100);
  });

  it("räknar ALDRIG in standardkostnad eller listpris i självkostnaden", () => {
    const selfCost = computeArticleSelfCostOre({
      costingMethod: "calc",
      purchasePrice: 10000,
      standardCost: 99999,
      listPrice: 88888,
    });
    expect(selfCost).toBe(10000);
  });
});

describe("standardkostnad som explicit alternativ (costingMethod=standard)", () => {
  it("ersätter kalkylsumman helt med den fasta standardkostnaden", () => {
    const p = computeArticlePricing({
      costingMethod: "standard",
      standardCost: 12800,
      purchasePrice: 5000,
      materialCost: 1000,
      productionTime: 60,
      hourlyCost: 60000,
    });
    expect(p.selfCostOre).toBe(12800);
    expect(p.timeCostOre).toBe(0);
    expect(p.costingMode).toBe("standard");
  });
});

describe("legacy-bakåtkompatibilitet (costingMethod=null)", () => {
  it("vara: kostnadsbas = inköpspris, standardkostnad ignoreras", () => {
    expect(
      computeArticleSelfCostOre({ articleType: "vara", purchasePrice: 5000, standardCost: 7000, freightCost: 500 }),
    ).toBe(5500);
  });
  it("tjänst: kostnadsbas = standardkostnad, inköpspris ignoreras", () => {
    expect(
      computeArticleSelfCostOre({ articleType: "tjanst", purchasePrice: 5000, standardCost: 7000, warehouseCost: 500 }),
    ).toBe(7500);
  });
  it("artikel med bara internkostnad: självkostnad = internkostnad (oförändrat)", () => {
    expect(resolveArticleCostBasisOre({ articleType: "tjanst", cost: 4200 })).toBe(4200);
  });
  it("legacy utan nya fält ger exakt samma marginal som tidigare motor", () => {
    const p = computeArticlePricing({
      articleType: "vara",
      purchasePrice: 10000,
      freightCost: 1000,
      markupPercent: 25,
      listPrice: 0,
    });
    expect(p.selfCostOre).toBe(11000);
    expect(p.computedListPriceOre).toBe(13750);
    expect(p.referenceListPriceOre).toBe(13750);
    expect(p.marginPerUnitOre).toBe(2750);
    expect(p.marginPercent).toBeCloseTo(20, 5);
  });
});

describe("priskalkyl — referenspris vid automatisk metod", () => {
  it("påslag med gammalt sparat listpris: referens = beräknat, inte det sparade", () => {
    const p = computeArticlePricing({
      costingMethod: "calc",
      purchasePrice: 10000,
      pricingMethod: "markup",
      markupPercent: 25,
      listPrice: 99900, // gammalt sparat pris får inte styra marginalen
    });
    expect(p.computedListPriceOre).toBe(12500);
    expect(p.referenceListPriceOre).toBe(12500);
    expect(p.marginPerUnitOre).toBe(2500);
    expect(p.marginPercent).toBeCloseTo(20, 5);
  });

  it("marginal med gammalt sparat listpris: referens = beräknat", () => {
    const p = computeArticlePricing({
      costingMethod: "calc",
      purchasePrice: 10000,
      pricingMethod: "margin",
      desiredMarginPercent: 20,
      listPrice: 5000,
    });
    expect(p.computedListPriceOre).toBe(12500);
    expect(p.referenceListPriceOre).toBe(12500);
    expect(p.marginPercent).toBeCloseTo(20, 5);
  });

  it("manuell metod: sparat listpris förblir referensen", () => {
    const p = computeArticlePricing({
      costingMethod: "calc",
      purchasePrice: 12800,
      pricingMethod: "manual",
      listPrice: 17500,
    });
    expect(p.referenceListPriceOre).toBe(17500);
    expect(p.marginPerUnitOre).toBe(4700);
  });
});

describe("priskalkyl — påslag vs marginal", () => {
  it("påslag: 100 kr självkostnad + 25 % påslag = 125 kr", () => {
    const p = computeArticlePricing({ costingMethod: "calc", purchasePrice: 10000, pricingMethod: "markup", markupPercent: 25 });
    expect(p.computedListPriceOre).toBe(12500);
  });
  it("marginal: 100 kr självkostnad och 25 % önskad marginal = 133,33 kr", () => {
    const p = computeArticlePricing({ costingMethod: "calc", purchasePrice: 10000, pricingMethod: "margin", desiredMarginPercent: 25 });
    expect(p.computedListPriceOre).toBe(13333);
    // Kontroll: marginalen mot det beräknade priset blir ~25 %
    expect(p.marginPercent).toBeCloseTo(25, 1);
  });
  it("marginal ≥ 100 % eller ej satt → ingen uppräkning (listpris = självkostnad)", () => {
    expect(
      computeArticlePricing({ costingMethod: "calc", purchasePrice: 10000, pricingMethod: "margin", desiredMarginPercent: 100 }).computedListPriceOre,
    ).toBe(10000);
    expect(
      computeArticlePricing({ costingMethod: "calc", purchasePrice: 10000, pricingMethod: "margin", desiredMarginPercent: null }).computedListPriceOre,
    ).toBe(10000);
  });
});

describe("priskalkyl — manuellt listpris räknas baklänges", () => {
  it("TB/enhet = listpris − självkostnad och marginal % = TB/listpris × 100", () => {
    // Exemplet från instruktionsfilen: självkostnad 128 kr, listpris 175 kr
    const p = computeArticlePricing({
      costingMethod: "standard",
      standardCost: 12800,
      pricingMethod: "manual",
      listPrice: 17500,
    });
    expect(p.marginPerUnitOre).toBe(4700); // TB 47 kr
    expect(p.marginPercent).toBeCloseTo(26.857, 2); // ≈ 26,9 %
  });
  it("negativt TB när listpriset understiger självkostnaden", () => {
    const p = computeArticlePricing({ costingMethod: "calc", purchasePrice: 20000, pricingMethod: "manual", listPrice: 15000 });
    expect(p.marginPerUnitOre).toBe(-5000);
    expect(p.marginPercent).toBeCloseTo(-33.33, 1);
  });
  it("utan listpris finns ingen marginal att visa", () => {
    const p = computeArticlePricing({ costingMethod: "calc", purchasePrice: 10000, pricingMethod: "manual", listPrice: 0 });
    expect(p.referenceListPriceOre).toBe(0);
    expect(p.marginPercent).toBeNull();
  });
});
