import { describe, it, expect } from "vitest";
import {
  computeArticleQuantity,
  usesQuantityFormula,
  usesQuantityMetadata,
  metadataValueToNumber,
} from "../../server/article-quantity";

// Antalslogik: enhetstester för den rena kvantitetstolkningen. computeArticleQuantity
// tar redan upplösta värden (metadataValue/formulaValue) och tolkar quantityMode
// identiskt för alla callers. Den gör ALDRIG egna DB-uppslagningar.

describe("usesQuantityMetadata / usesQuantityFormula", () => {
  it("känner igen metadata-drivna lägen", () => {
    expect(usesQuantityMetadata("per_styck")).toBe(true);
    expect(usesQuantityMetadata("matches_field")).toBe(true);
    expect(usesQuantityMetadata("group")).toBe(false);
    expect(usesQuantityMetadata("formula")).toBe(false);
  });

  it("känner igen formel-läget", () => {
    expect(usesQuantityFormula("formula")).toBe(true);
    expect(usesQuantityFormula("per_styck")).toBe(false);
    expect(usesQuantityFormula(null)).toBe(false);
  });
});

describe("computeArticleQuantity", () => {
  it("group -> fast multipel (groupSize)", () => {
    expect(computeArticleQuantity({ quantityMode: "group", baseQuantity: 5, groupSize: 3 })).toBe(3);
  });

  it("group utan groupSize -> 1", () => {
    expect(computeArticleQuantity({ quantityMode: "group", baseQuantity: 5 })).toBe(1);
  });

  it("single_per_task -> alltid 1", () => {
    expect(computeArticleQuantity({ quantityMode: "single_per_task", baseQuantity: 9 })).toBe(1);
  });

  it("per_styck med metadatavärde > 0 styr antalet", () => {
    expect(computeArticleQuantity({ quantityMode: "per_styck", baseQuantity: 2, metadataValue: 7 })).toBe(7);
  });

  it("per_styck utan metadatavärde faller tillbaka på basantal", () => {
    expect(computeArticleQuantity({ quantityMode: "per_styck", baseQuantity: 4, metadataValue: null })).toBe(4);
  });

  it("formula med positivt formelresultat styr antalet", () => {
    expect(computeArticleQuantity({ quantityMode: "formula", baseQuantity: 2, formulaValue: 6 })).toBe(6);
  });

  it("formula utan formelresultat (null) faller tillbaka på basantal", () => {
    expect(computeArticleQuantity({ quantityMode: "formula", baseQuantity: 3, formulaValue: null })).toBe(3);
  });

  it("formula med icke-positivt resultat faller tillbaka på basantal", () => {
    expect(computeArticleQuantity({ quantityMode: "formula", baseQuantity: 3, formulaValue: 0 })).toBe(3);
    expect(computeArticleQuantity({ quantityMode: "formula", baseQuantity: 3, formulaValue: -2 })).toBe(3);
  });

  it("formula avrundar ett decimalresultat", () => {
    expect(computeArticleQuantity({ quantityMode: "formula", baseQuantity: 1, formulaValue: 4.6 })).toBe(5);
  });

  it("okänt/legacy läge -> basantal (avrundat, minst 1)", () => {
    expect(computeArticleQuantity({ quantityMode: "use_object_quantity", baseQuantity: 8 })).toBe(8);
    expect(computeArticleQuantity({ quantityMode: undefined, baseQuantity: 0 })).toBe(1);
  });
});

describe("metadataValueToNumber", () => {
  it("tolkar nummer och numeriska strängar (komma -> punkt)", () => {
    expect(metadataValueToNumber(5)).toBe(5);
    expect(metadataValueToNumber("3,5")).toBe(3.5);
    expect(metadataValueToNumber(" 12 ")).toBe(12);
  });

  it("returnerar null för icke-numeriska värden", () => {
    expect(metadataValueToNumber(null)).toBeNull();
    expect(metadataValueToNumber(true)).toBeNull();
    expect(metadataValueToNumber("abc")).toBeNull();
  });
});
