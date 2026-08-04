// Task #1345: djuplänkar (?tab=), legacy-länkar (?mode=) och sparad sektion
// (traivo-import-section-v2) får aldrig öppna fel importflöde. Testerna låser
// mappningen TAB_SECTION/SECTION_DEFAULT_TAB och init-logiken i
// client/src/lib/import-page-init.ts (används av ImportPage).
import { describe, it, expect } from "vitest";
import {
  TAB_SECTION,
  SECTION_DEFAULT_TAB,
  SECTION_STORAGE_KEY,
  LEGACY_STORAGE_KEYS,
  isValidTab,
  isValidSection,
  resolveInitialSection,
  resolveInitialTab,
  type ActiveTab,
} from "@/lib/import-page-init";
import type { ImportSection } from "@/components/import/ImportHub";

const ALL_TABS = Object.keys(TAB_SECTION) as ActiveTab[];
const ALL_SECTIONS: ImportSection[] = ["objects", "system", "history", "advanced"];

describe("TAB_SECTION / SECTION_DEFAULT_TAB", () => {
  it("mappar varje flik till exakt en giltig sektion", () => {
    for (const tab of ALL_TABS) {
      expect(ALL_SECTIONS).toContain(TAB_SECTION[tab]);
    }
  });

  it("täcker alla kända flikar (regression-lås)", () => {
    expect(ALL_TABS.sort()).toEqual(
      [
        "modus", "enrich", "manual", "fortnox", "mapped",
        "customerlist", "children", "recipients", "diff",
        "wizard", "objectsv2", "history", "quality",
      ].sort(),
    );
  });

  it("har en default-flik för varje sektion som hör hemma i samma sektion", () => {
    for (const section of ALL_SECTIONS) {
      const tab = SECTION_DEFAULT_TAB[section];
      expect(TAB_SECTION[tab]).toBe(section);
    }
  });

  it("låser de exakta sektions-tillhörigheterna", () => {
    expect(TAB_SECTION).toEqual({
      objectsv2: "objects",
      modus: "system",
      enrich: "system",
      fortnox: "system",
      customerlist: "system",
      children: "system",
      recipients: "system",
      diff: "system",
      manual: "advanced",
      mapped: "advanced",
      wizard: "advanced",
      history: "history",
      quality: "history",
    });
    expect(SECTION_DEFAULT_TAB).toEqual({
      objects: "objectsv2",
      system: "customerlist",
      advanced: "manual",
      history: "history",
    });
  });
});

describe("isValidTab / isValidSection", () => {
  it("accepterar alla kända flikar och avvisar okända", () => {
    for (const tab of ALL_TABS) expect(isValidTab(tab)).toBe(true);
    expect(isValidTab(null)).toBe(false);
    expect(isValidTab("")).toBe(false);
    expect(isValidTab("nonsense")).toBe(false);
    expect(isValidTab("OBJECTSV2")).toBe(false); // case-känsligt
  });

  it("accepterar alla sektioner och avvisar okända", () => {
    for (const s of ALL_SECTIONS) expect(isValidSection(s)).toBe(true);
    expect(isValidSection(null)).toBe(false);
    expect(isValidSection("nonsense")).toBe(false);
  });
});

describe("resolveInitialSection — djuplänkar ?tab=", () => {
  it("härleder rätt sektion för varje giltigt ?tab=-värde", () => {
    for (const tab of ALL_TABS) {
      expect(resolveInitialSection(tab, null, null)).toBe(TAB_SECTION[tab]);
    }
  });

  it("?tab= vinner över både ?mode= och sparad sektion", () => {
    expect(resolveInitialSection("history", "wizard", "objects")).toBe("history");
    expect(resolveInitialSection("objectsv2", "migration", "advanced")).toBe("objects");
  });

  it("ogiltigt ?tab= ignoreras och faller vidare till mode/sparat", () => {
    expect(resolveInitialSection("nonsense", "wizard", null)).toBe("advanced");
    expect(resolveInitialSection("nonsense", null, "history")).toBe("history");
    expect(resolveInitialSection("nonsense", null, null)).toBeNull();
  });
});

describe("resolveInitialSection — legacy ?mode=", () => {
  it("mode=migration och mode=ongoing öppnar systemsektionen", () => {
    expect(resolveInitialSection(null, "migration", null)).toBe("system");
    expect(resolveInitialSection(null, "ongoing", null)).toBe("system");
  });

  it("mode=wizard öppnar avancerat-sektionen", () => {
    expect(resolveInitialSection(null, "wizard", null)).toBe("advanced");
  });

  it("legacy-mode vinner över sparad sektion", () => {
    expect(resolveInitialSection(null, "migration", "history")).toBe("system");
  });

  it("okänt mode ignoreras", () => {
    expect(resolveInitialSection(null, "nonsense", null)).toBeNull();
    expect(resolveInitialSection(null, "nonsense", "objects")).toBe("objects");
  });
});

describe("resolveInitialSection — sparad sektion (traivo-import-section-v2)", () => {
  it("använder rätt localStorage-nyckel", () => {
    expect(SECTION_STORAGE_KEY).toBe("traivo-import-section-v2");
  });

  it("giltigt sparat värde återställs", () => {
    for (const s of ALL_SECTIONS) {
      expect(resolveInitialSection(null, null, s)).toBe(s);
    }
  });

  it("ogiltigt eller saknat sparat värde ger startvyn (null)", () => {
    expect(resolveInitialSection(null, null, "nonsense")).toBeNull();
    expect(resolveInitialSection(null, null, "")).toBeNull();
    expect(resolveInitialSection(null, null, null)).toBeNull();
  });
});

describe("resolveInitialTab", () => {
  it("giltigt ?tab= används direkt", () => {
    for (const tab of ALL_TABS) {
      expect(resolveInitialTab(tab, null, TAB_SECTION[tab])).toBe(tab);
    }
  });

  it("?tab= vinner över ?mode=wizard", () => {
    expect(resolveInitialTab("modus", "wizard", "system")).toBe("modus");
  });

  it("legacy ?mode=wizard öppnar tre-stegs-wizarden", () => {
    expect(resolveInitialTab(null, "wizard", "advanced")).toBe("wizard");
    // Även om ingen sektion härletts än.
    expect(resolveInitialTab(null, "wizard", null)).toBe("wizard");
  });

  it("mode=migration/ongoing ger sektionens default-flik", () => {
    expect(resolveInitialTab(null, "migration", "system")).toBe("customerlist");
    expect(resolveInitialTab(null, "ongoing", "system")).toBe("customerlist");
  });

  it("utan tab/mode ges sektionens default-flik, med objects som fallback", () => {
    for (const section of ALL_SECTIONS) {
      expect(resolveInitialTab(null, null, section)).toBe(SECTION_DEFAULT_TAB[section]);
    }
    expect(resolveInitialTab(null, null, null)).toBe("objectsv2");
  });

  it("ogiltigt ?tab= faller tillbaka till sektionens default", () => {
    expect(resolveInitialTab("nonsense", null, "history")).toBe("history");
  });

  it("init-flik och init-sektion är alltid konsistenta (flik ∈ sektion)", () => {
    // Simulerar hela init-flödet för alla kombinationer av tab/mode/saved.
    const tabInputs = [null, "nonsense", ...ALL_TABS];
    const modeInputs = [null, "migration", "ongoing", "wizard", "nonsense"];
    const savedInputs = [null, "nonsense", ...ALL_SECTIONS];
    for (const tab of tabInputs) {
      for (const mode of modeInputs) {
        for (const saved of savedInputs) {
          const section = resolveInitialSection(tab, mode, saved);
          const activeTab = resolveInitialTab(tab, mode, section);
          if (section) {
            expect(TAB_SECTION[activeTab]).toBe(section);
          }
        }
      }
    }
  });
});

describe("städning av gamla localStorage-nycklar", () => {
  it("listan täcker båda nycklarna från före Task #1344", () => {
    expect([...LEGACY_STORAGE_KEYS].sort()).toEqual([
      "traivo-import-mode",
      "traivo-import-section",
    ]);
  });

  it("nya nyckeln ingår INTE i städlistan", () => {
    expect(LEGACY_STORAGE_KEYS).not.toContain(SECTION_STORAGE_KEY);
  });
});
