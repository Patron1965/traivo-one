import { describe, it, expect } from "vitest";
import { isCanonicalGeoFieldName, CANONICAL_GEO_FIELD_KEYS } from "../../shared/geo-fields";
import { SYSTEMLASTA_GEO_FALT } from "../../server/metadata-queries";

// Task #1438: kanoniska geografifält får bara visas i den samlade Geografi-
// sektionen — den generiska metadatakarusellen filtrerar bort dem via
// isCanonicalGeoFieldName. Här låses (a) mappningen mot serverns kanoniska
// lista och (b) själva filterlogiken (samma predikat som ObjectMetadataBody).

describe("isCanonicalGeoFieldName", () => {
  it("täcker exakt serverns SYSTEMLASTA_GEO_FALT (ingen drift åt något håll)", () => {
    const serverKeys = new Set(SYSTEMLASTA_GEO_FALT.map((f) => f.key));
    expect(new Set(CANONICAL_GEO_FIELD_KEYS)).toEqual(serverKeys);
    for (const f of SYSTEMLASTA_GEO_FALT) {
      expect(isCanonicalGeoFieldName(f.namn)).toBe(true);
    }
  });

  it("matchar skiftlägesokänsligt och med whitespace", () => {
    expect(isCanonicalGeoFieldName("GATUADRESS")).toBe(true);
    expect(isCanonicalGeoFieldName("  Postort ")).toBe(true);
  });

  it("släpper igenom vanliga fält", () => {
    expect(isCanonicalGeoFieldName("Kontaktperson")).toBe(false);
    expect(isCanonicalGeoFieldName("Adress 2")).toBe(false);
    expect(isCanonicalGeoFieldName(null)).toBe(false);
    expect(isCanonicalGeoFieldName(undefined)).toBe(false);
  });

  it("karusellfiltret visar geo-fält ENBART i geografisektionen (own + inherited)", () => {
    // Samma predikat som ObjectMetadataBody.carouselEntries använder.
    const entries = [
      { katalog: { namn: "Gatuadress", visasIKarusell: true }, metod: "import" }, // importerad
      { katalog: { namn: "Postort", visasIKarusell: true }, metod: "import", inherited: true }, // ärvd
      { katalog: { namn: "Koordinater", visasIKarusell: true }, metod: "auto" }, // geokodad
      { katalog: { namn: "Kontaktperson", visasIKarusell: true }, metod: "manuell" },
    ];
    const carousel = entries.filter(
      (e) => e.katalog?.visasIKarusell !== false && !isCanonicalGeoFieldName(e.katalog?.namn),
    );
    expect(carousel.map((e) => e.katalog.namn)).toEqual(["Kontaktperson"]);
  });
});
