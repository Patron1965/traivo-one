import { describe, it, expect } from "vitest";
import { parseCompositeRef } from "../../shared/objektmall-template";
import {
  coerceMetadataVardeFromRaw,
  computeImportMetadataStatus,
} from "../../server/metadata-queries";
import type { MetadataKatalog } from "../../shared/schema";

// Task #633: enhetstest för sammansatta metadatafält (punktnotation `fält.underfält`).
// Konventionsparsning (parseCompositeRef) samt strukturerad JSON-lagring via samma
// coerce-/status-väg som vanliga definitionskolumner men tvingad till json-datatyp.

function jsonKat(overrides: Partial<MetadataKatalog> = {}): MetadataKatalog {
  return {
    datatyp: "json",
    allowedValues: null,
    namn: "Adress",
    allowDuplicates: false,
    standardArvs: false,
    ...overrides,
  } as MetadataKatalog;
}

describe("parseCompositeRef", () => {
  it("delar upp giltig punktnotation i prefix + underfält", () => {
    expect(parseCompositeRef("adress.gata")).toEqual({ prefix: "adress", subfield: "gata" });
    expect(parseCompositeRef("adress.postnummer")).toEqual({ prefix: "adress", subfield: "postnummer" });
  });

  it("trimmar mellanslag runt prefix och underfält", () => {
    expect(parseCompositeRef(" adress . ort ")).toEqual({ prefix: "adress", subfield: "ort" });
  });

  it("splittar vid första punkten (underfält får innehålla punkt)", () => {
    expect(parseCompositeRef("adress.geo.lat")).toEqual({ prefix: "adress", subfield: "geo.lat" });
  });

  it("returnerar null för icke-sammansatta referensnamn", () => {
    expect(parseCompositeRef("Kontaktperson")).toBeNull();
  });

  it("returnerar null för punkt först/sist eller tomma delar", () => {
    expect(parseCompositeRef(".gata")).toBeNull();
    expect(parseCompositeRef("adress.")).toBeNull();
    expect(parseCompositeRef("adress. ")).toBeNull();
  });
});

describe("sammansatt JSON-lagring via coerceMetadataVardeFromRaw", () => {
  it("lagrar strukturerat objekt i varde_json", () => {
    const obj = { gata: "Storgatan", gatunummer: "5", postnummer: "614 30", ort: "Söderköping" };
    const res = coerceMetadataVardeFromRaw(jsonKat(), JSON.stringify(obj));
    expect(res.vardeFields.vardeJson).toEqual(obj);
  });

  it("ger oförändrad-status när samma JSON skrivs igen", () => {
    const obj = { gata: "Storgatan", ort: "Söderköping" };
    const display = coerceMetadataVardeFromRaw(jsonKat(), JSON.stringify(obj)).displayValue;
    expect(computeImportMetadataStatus(false, [display], display)).toBe("unchanged");
  });

  it("ger ersätt-status när JSON skiljer sig från befintligt värde", () => {
    const a = coerceMetadataVardeFromRaw(jsonKat(), JSON.stringify({ gata: "Storgatan" })).displayValue;
    const b = coerceMetadataVardeFromRaw(jsonKat(), JSON.stringify({ gata: "Lillgatan" })).displayValue;
    expect(computeImportMetadataStatus(false, [a], b)).toBe("replace");
  });
});
