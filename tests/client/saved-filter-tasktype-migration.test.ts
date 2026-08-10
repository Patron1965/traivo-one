import { describe, it, expect } from "vitest";
import { migrateLegacyTaskTypes } from "@/components/grovplanering/SavedFilterLibrary";

// ---------------------------------------------------------------------------
// Task #1485: sparade panel-filter med det avvecklade uppgiftstyp-registrets
// nycklar (taskTypes) migreras vid apply till utförandekod/artikeltyp.
// Migreringen sker mot GARANTERAT hämtade register (fetchQuery i applyRow) —
// den här sviten låser den rena mappningslogiken: nyckel- och etikett-match
// (case-insensitive), prioritet utförandekod före artikeltyp, och att
// omappbara nycklar rapporteras (aldrig tyst tappade).
// ---------------------------------------------------------------------------

const toKeyMap = (defs: { key: string; label: string }[]) => {
  const m = new Map<string, string>();
  for (const d of defs) {
    m.set(d.key.toLowerCase(), d.key);
    m.set(d.label.trim().toLowerCase(), d.key);
  }
  return m;
};

const execCodes = toKeyMap([
  { key: "bok", label: "BÖK" },
  { key: "rbk", label: "RBK" },
]);
const articleTypes = toKeyMap([
  { key: "tjanst", label: "Tjänst" },
  { key: "tvatt", label: "Tvätt" },
]);

describe("migrateLegacyTaskTypes", () => {
  it("mappar nycklar till utförandekod resp. artikeltyp", () => {
    const r = migrateLegacyTaskTypes(["bok", "tvatt"], execCodes, articleTypes);
    expect(r.executionCodes).toEqual(["bok"]);
    expect(r.articleTypes).toEqual(["tvatt"]);
    expect(r.unmapped).toEqual([]);
  });

  it("matchar även etiketter case-insensitive", () => {
    const r = migrateLegacyTaskTypes(["BÖK", " tjänst "], execCodes, articleTypes);
    expect(r.executionCodes).toEqual(["bok"]);
    expect(r.articleTypes).toEqual(["tjanst"]);
  });

  it("utförandekod vinner före artikeltyp vid krock", () => {
    const both = toKeyMap([{ key: "bok", label: "BÖK" }]);
    const r = migrateLegacyTaskTypes(["bok"], both, both);
    expect(r.executionCodes).toEqual(["bok"]);
    expect(r.articleTypes).toEqual([]);
  });

  it("omappbara nycklar rapporteras — tappas aldrig tyst", () => {
    const r = migrateLegacyTaskTypes(
      ["bok", "okand-typ"],
      execCodes,
      articleTypes,
    );
    expect(r.executionCodes).toEqual(["bok"]);
    expect(r.unmapped).toEqual(["okand-typ"]);
  });

  it("tomma register ⇒ allt rapporteras som omappbart (inte tomt resultat i tysthet)", () => {
    const r = migrateLegacyTaskTypes(["bok"], new Map(), new Map());
    expect(r.unmapped).toEqual(["bok"]);
  });
});
