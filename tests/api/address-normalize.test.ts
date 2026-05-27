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

describe("normalizeCity", () => {
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
