import { describe, it, expect } from "vitest";
import {
  coerceMetadataVardeFromRaw,
  computeImportMetadataStatus,
} from "../../server/metadata-queries";
import type { MetadataKatalog } from "../../shared/schema";

// Task #632: enhetstest för de rena hjälparna som driver objektmall-importens
// metadata-skrivning. Validering (datatyp + allowedValues) och förhandsstatus
// (skapa/ersätt/lägg till/oförändrad) enligt post-it-modellen §6.12.

function kat(overrides: Partial<MetadataKatalog>): MetadataKatalog {
  return {
    datatyp: "string",
    allowedValues: null,
    namn: "Testfält",
    allowDuplicates: false,
    standardArvs: false,
    ...overrides,
  } as MetadataKatalog;
}

describe("coerceMetadataVardeFromRaw", () => {
  it("normaliserar heltal och decimaler", () => {
    expect(coerceMetadataVardeFromRaw(kat({ datatyp: "integer" }), "42").vardeFields.vardeInteger).toBe(42);
    expect(coerceMetadataVardeFromRaw(kat({ datatyp: "decimal" }), "3,5").vardeFields.vardeDecimal).toBe(3.5);
  });

  it("tolkar svenska ja/nej till boolean", () => {
    expect(coerceMetadataVardeFromRaw(kat({ datatyp: "boolean" }), "ja").vardeFields.vardeBoolean).toBe(true);
    expect(coerceMetadataVardeFromRaw(kat({ datatyp: "boolean" }), "nej").vardeFields.vardeBoolean).toBe(false);
  });

  it("kastar på ogiltigt heltal", () => {
    expect(() => coerceMetadataVardeFromRaw(kat({ datatyp: "integer" }), "abc")).toThrow();
  });

  it("validerar mot allowedValues", () => {
    const k = kat({ allowedValues: ["A", "B"] });
    expect(coerceMetadataVardeFromRaw(k, "A").displayValue).toBe("A");
    expect(() => coerceMetadataVardeFromRaw(k, "C")).toThrow(/Tillåtna värden/);
  });
});

describe("computeImportMetadataStatus", () => {
  it("ersättande (allowDuplicates=false): skapa/ersätt/oförändrad", () => {
    expect(computeImportMetadataStatus(false, [], "X")).toBe("create");
    expect(computeImportMetadataStatus(false, ["gammalt"], "nytt")).toBe("replace");
    expect(computeImportMetadataStatus(false, ["samma"], "samma")).toBe("unchanged");
  });

  it("kompletterande (allowDuplicates=true): lägg till/oförändrad", () => {
    expect(computeImportMetadataStatus(true, [], "X")).toBe("add");
    expect(computeImportMetadataStatus(true, ["A"], "B")).toBe("add");
    expect(computeImportMetadataStatus(true, ["A", "B"], "B")).toBe("unchanged");
  });
});
