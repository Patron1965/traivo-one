import { describe, it, expect } from "vitest";
import { deriveMetadataOriginBadge, METADATA_ORIGIN_BADGE_LABELS } from "../../shared/metadata-origin";

// Task #1438: kanonisk mappning metod → KÄLLA/ARV-badge.
//   import → Importerad, auto/geokodning → Systemgenererad, manuell → Egen,
//   ärvt värde → Ärvd (oavsett källradens metod, utom read-only-system).

describe("deriveMetadataOriginBadge", () => {
  it("importerade värden badges som Importerad", () => {
    expect(deriveMetadataOriginBadge("import", false)).toBe("importerad");
  });

  it("auto-härledda (geokodade) värden badges som Systemgenererad", () => {
    expect(deriveMetadataOriginBadge("auto", false)).toBe("systemgenererad");
    expect(deriveMetadataOriginBadge("automatisk", false)).toBe("systemgenererad");
    expect(deriveMetadataOriginBadge("berakning", false)).toBe("systemgenererad");
  });

  it("read-only-systemursprung badges som Systemgenererad (även vid arv)", () => {
    expect(deriveMetadataOriginBadge("system", false)).toBe("systemgenererad");
    expect(deriveMetadataOriginBadge("tjanst", false)).toBe("systemgenererad");
    expect(deriveMetadataOriginBadge("utforande", true)).toBe("systemgenererad");
  });

  it("ärvda värden badges som Ärvd — även när källan är importerad/auto", () => {
    expect(deriveMetadataOriginBadge("import", true)).toBe("arvd");
    expect(deriveMetadataOriginBadge("auto", true)).toBe("arvd");
    expect(deriveMetadataOriginBadge("manuell", true)).toBe("arvd");
  });

  it("Egen endast för användarskapade fält", () => {
    expect(deriveMetadataOriginBadge("manuell", false)).toBe("egen");
    expect(deriveMetadataOriginBadge(null, false)).toBe("egen");
    expect(deriveMetadataOriginBadge(undefined, false)).toBe("egen");
  });

  it("etiketterna är de kanoniska svenska", () => {
    expect(METADATA_ORIGIN_BADGE_LABELS).toEqual({
      systemgenererad: "Systemgenererad",
      arvd: "Ärvd",
      importerad: "Importerad",
      egen: "Egen",
    });
  });
});
