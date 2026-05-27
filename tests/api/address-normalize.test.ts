import { describe, it, expect } from "vitest";
import { normalizeAddressKey, normalizeStreetAddress, normalizeCity, normalizePostalCode } from "@shared/address-normalize";

describe("normalizeStreetAddress", () => {
  it("lowercases and trims", () => {
    expect(normalizeStreetAddress("  Storgatan 5  ")).toBe("storgatan 5");
  });
  it("removes diacritics (Å,Ä,Ö)", () => {
    expect(normalizeStreetAddress("Köpmangatan 12")).toBe("kopmangatan 12");
    expect(normalizeStreetAddress("Storå Gatan 1")).toBe("stora gatan 1");
  });
  it("expands street abbreviations as separate tokens", () => {
    expect(normalizeStreetAddress("Stor g. 5")).toBe("stor gatan 5");
    expect(normalizeStreetAddress("Lugna v. 7B")).toBe("lugna vagen 7b");
    // Suffix-fastsittande förkortning ("Storg.") splittas också till "stor gatan"
    expect(normalizeStreetAddress("Storg. 5")).toBe("stor gatan 5");
  });
  it("preserves house number suffixes", () => {
    expect(normalizeStreetAddress("Storgatan 12B")).toBe("storgatan 12b");
    expect(normalizeStreetAddress("Storgatan 12-14")).toBe("storgatan 12-14");
  });
  it("matches '12 A' with '12A' (space between number and letter suffix collapses)", () => {
    expect(normalizeStreetAddress("Storgatan 12 A")).toBe("storgatan 12a");
    expect(normalizeStreetAddress("Storgatan 12A")).toBe("storgatan 12a");
    expect(normalizeStreetAddress("Storgatan 12 a")).toBe("storgatan 12a");
  });
  it("normalises hyphen number ranges with extra spaces", () => {
    expect(normalizeStreetAddress("Storgatan 12 - 14")).toBe("storgatan 12-14");
    expect(normalizeStreetAddress("Storgatan 12 -14")).toBe("storgatan 12-14");
  });
});

describe("normalizeAddressKey — real-world variants (15+)", () => {
  const equalCases: Array<[string, string, string]> = [
    ["plain", "Storgatan 5", "storgatan 5"],
    ["whitespace", "  Storgatan   5  ", "storgatan 5"],
    ["uppercase", "STORGATAN 5", "storgatan 5"],
    ["mixed case", "StorGatan 5", "storgatan 5"],
    ["trailing dot", "Storgatan 5.", "storgatan 5"],
    ["trailing comma", "Storgatan 5,", "storgatan 5"],
    ["paren noise", "Storgatan 5 (huvudentré)", "storgatan 5 huvudentre"],
    ["diacritics ö", "Köpmansgatan 7", "kopmansgatan 7"],
    ["diacritics å", "Långgatan 3", "langgatan 3"],
    ["suffix letter spaced", "Storgatan 12 A", "storgatan 12a"],
    ["suffix letter glued", "Storgatan 12A", "storgatan 12a"],
    ["suffix letter spaced lowercase", "storgatan 12 a", "storgatan 12a"],
    ["range with spaces", "Storgatan 12 - 14", "storgatan 12-14"],
    ["range glued", "Storgatan 12-14", "storgatan 12-14"],
    ["abbrev g.", "Stor g. 5", "stor gatan 5"],
    ["abbrev v.", "Lugna v. 7", "lugna vagen 7"],
    ["abbrev suffix-glued", "Storg. 5", "stor gatan 5"],
    ["norwegian ø", "Sørgatan 1", "sorgatan 1"],
  ];
  for (const [label, input, expected] of equalCases) {
    it(`normalizes "${input}" → "${expected}" (${label})`, () => {
      expect(normalizeStreetAddress(input)).toBe(expected);
    });
  }
  it("collapses extra whitespace and punctuation", () => {
    expect(normalizeStreetAddress("Stor-Gatan, 5.")).toBe("stor-gatan 5");
    expect(normalizeStreetAddress("Stor   gatan    5")).toBe("stor gatan 5");
  });
  it("returns empty on empty/null", () => {
    expect(normalizeStreetAddress("")).toBe("");
    expect(normalizeStreetAddress(null)).toBe("");
    expect(normalizeStreetAddress(undefined)).toBe("");
  });
});

describe("normalizeCity_extra", () => {
  it("lowercases, strips diacritics", () => {
    expect(normalizeCity("Malmö")).toBe("malmo");
    expect(normalizeCity("Örebro")).toBe("orebro");
    expect(normalizeCity("  GÖTEBORG ")).toBe("goteborg");
  });
});

describe("normalizePostalCode", () => {
  it("strips non-digits", () => {
    expect(normalizePostalCode("123 45")).toBe("12345");
    expect(normalizePostalCode("SE-123 45")).toBe("12345");
    expect(normalizePostalCode(null)).toBe("");
  });
});

describe("normalizeAddressKey", () => {
  it("returns empty when address missing", () => {
    expect(normalizeAddressKey({ city: "Malmö" })).toBe("");
  });
  it("includes city in key when present", () => {
    const k = normalizeAddressKey({ address: "Storgatan 5", city: "Malmö" });
    expect(k).toBe("storgatan 5|malmo");
  });
  it("matches same address with different casing/spacing", () => {
    const a = normalizeAddressKey({ address: "Storgatan  5", city: "MALMÖ" });
    const b = normalizeAddressKey({ address: "storgatan 5", city: "Malmö" });
    expect(a).toBe(b);
  });
  it("matches expanded vs abbreviated street form", () => {
    // "Stor g." och "Stor gatan" → samma nyckel
    const a = normalizeAddressKey({ address: "Stor g. 5", city: "Malmö" });
    const b = normalizeAddressKey({ address: "Stor gatan 5", city: "Malmö" });
    expect(a).toBe(b);
  });
  it("falls back to postal code when city missing", () => {
    const k = normalizeAddressKey({ address: "Storgatan 5", postalCode: "211 20" });
    expect(k).toBe("storgatan 5|zip:21120");
  });
  it("falls back to just address when no city/zip", () => {
    expect(normalizeAddressKey({ address: "Storgatan 5" })).toBe("storgatan 5");
  });
});
