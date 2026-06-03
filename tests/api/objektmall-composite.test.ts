import { describe, it, expect } from "vitest";
import { parseCompositeRef } from "../../shared/objektmall-template";
import {
  coerceMetadataVardeFromRaw,
  computeImportMetadataStatus,
  mergeCompositeJsonValues,
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

// Task #644: per-underfält-arv för sammansatta (json) fält. Värdelistan ges
// närmast-först (level 0 = lokalt objekt, högre index = längre upp i kedjan).
describe("mergeCompositeJsonValues", () => {
  it("ärver underfält uppifrån när närmaste objekt bara sätter ett", () => {
    // Rum sätter bara gata; fastigheten ovanför har postnummer + ort.
    const merged = mergeCompositeJsonValues([
      { gata: "Storgatan 5" },
      { gata: "Fastighetsvägen 1", postnummer: "614 30", ort: "Söderköping" },
    ]);
    expect(merged).toEqual({
      gata: "Storgatan 5",
      postnummer: "614 30",
      ort: "Söderköping",
    });
  });

  it("närmaste definierade underfält vinner över förälderns", () => {
    const merged = mergeCompositeJsonValues([
      { gata: "Lillgatan 2" },
      { gata: "Storgatan 5", ort: "Norrköping" },
    ]);
    expect(merged).toEqual({ gata: "Lillgatan 2", ort: "Norrköping" });
  });

  it("mergar över flera nivåer (rum → fastighet → koncern)", () => {
    const merged = mergeCompositeJsonValues([
      { gatunummer: "5B" },
      { gata: "Storgatan" },
      { postnummer: "614 30", ort: "Söderköping" },
    ]);
    expect(merged).toEqual({
      gatunummer: "5B",
      gata: "Storgatan",
      postnummer: "614 30",
      ort: "Söderköping",
    });
  });

  it("hanterar olika underfält (kontaktperson) per nivå", () => {
    const merged = mergeCompositeJsonValues([
      { telefon: "070-1234567" },
      { namn: "Anna Andersson", epost: "anna@example.com" },
    ]);
    expect(merged).toEqual({
      telefon: "070-1234567",
      namn: "Anna Andersson",
      epost: "anna@example.com",
    });
  });

  it("behandlar arrayer som atomära — närmaste värdet vinner utan merge", () => {
    const merged = mergeCompositeJsonValues([
      ["a", "b"],
      ["c", "d", "e"],
    ]);
    expect(merged).toEqual(["a", "b"]);
  });

  it("behandlar primitiver som atomära", () => {
    expect(mergeCompositeJsonValues(["lokalt", "ärvt"])).toBe("lokalt");
  });

  it("returnerar null för tom värdelista", () => {
    expect(mergeCompositeJsonValues([])).toBeNull();
  });

  it("hoppar över null/icke-objekt-nivåer vid merge när närmaste är objekt", () => {
    const merged = mergeCompositeJsonValues([
      { gata: "Storgatan" },
      null,
      { postnummer: "614 30" },
    ]);
    expect(merged).toEqual({ gata: "Storgatan", postnummer: "614 30" });
  });

  it("bevarar inte underfält med falsy men definierade värden felaktigt", () => {
    // Ett uttryckligen satt underfält (även 0/"") på närmaste nivå ska vinna.
    const merged = mergeCompositeJsonValues([
      { vaning: 0 },
      { vaning: 3, hiss: true },
    ]);
    expect(merged).toEqual({ vaning: 0, hiss: true });
  });
});
