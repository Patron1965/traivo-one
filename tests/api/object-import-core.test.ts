import { describe, it, expect } from "vitest";
import {
  levenshtein,
  similarity,
  fuzzyMatch,
  autoMatchColumn,
  categoryForTarget,
  buildColumns,
  detectHeaderRows,
  validateValue,
  validateRow,
  resolveRow,
  validateCrossRow,
  buildHierarchyPlan,
  buildCompositeObject,
  groupMetadataForWrite,
  type ResolvedRow,
} from "../../server/services/object-import-core";
import type { ColumnMappings } from "../../shared/object-import-spec";

// Hemköp-liknande fixtur: en kund med butiker (interim-hierarki) och utrustning.
function resolved(
  rowNumber: number,
  fields: Record<string, string>,
  extra: Partial<Omit<ResolvedRow, "rowNumber" | "fields">> = {},
): ResolvedRow {
  return {
    rowNumber,
    raw: extra.raw ?? {},
    fields,
    composite: extra.composite ?? {},
    metadata: extra.metadata ?? {},
  };
}

describe("levenshtein / similarity", () => {
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
  });
  it("similarity is 1 for identical and lower for different", () => {
    expect(similarity("namn", "namn")).toBe(1);
    expect(similarity("objektnamn", "objektnamnn")).toBeGreaterThan(0.8);
    expect(similarity("abc", "xyz")).toBeLessThan(0.5);
  });
});

describe("autoMatchColumn", () => {
  it("matches exact known headers", () => {
    expect(autoMatchColumn("Objektnamn")).toBe("name");
    expect(autoMatchColumn("Systemnummer")).toBe("system_id");
    expect(autoMatchColumn("Interimsnummer")).toBe("interim_id");
    expect(autoMatchColumn("externt_id")).toBe("external_id");
  });
  it("matches address and contact dot-notation", () => {
    expect(autoMatchColumn("adress.gata")).toBe("address.street");
    expect(autoMatchColumn("kontaktperson.epost")).toBe("contact.email");
  });
  it("keeps metadata.* prefix as-is", () => {
    expect(autoMatchColumn("metadata.kärltyp")).toBe("metadata.kärltyp");
  });
  it("fuzzy-matches near misses of API keys", () => {
    expect(autoMatchColumn("contact.emai")).toBe("contact.email");
  });
  it("returns null for empty/unknown", () => {
    expect(autoMatchColumn(null)).toBeNull();
    expect(autoMatchColumn("")).toBeNull();
    expect(autoMatchColumn("totalt-okänd-rubrik-xyz")).toBeNull();
  });
});

describe("fuzzyMatch", () => {
  it("returns best key for a close header", () => {
    const r = fuzzyMatch("names");
    expect(r?.key).toBe("name");
  });
});

describe("categoryForTarget", () => {
  it("derives category from key prefix", () => {
    expect(categoryForTarget("address.street")).toBe("address");
    expect(categoryForTarget("position.lat")).toBe("address");
    expect(categoryForTarget("contact.email")).toBe("contact");
    expect(categoryForTarget("metadata.foo")).toBe("metadata");
    expect(categoryForTarget("name")).toBe("standard");
  });
});

describe("buildColumns", () => {
  it("auto-matches from system header then user header", () => {
    const cols = buildColumns(
      ["Objektnamn", "Systemnummer", null],
      [null, "Butikens kod", "Min rubrik"],
    );
    expect(cols).toHaveLength(3);
    expect(cols[0].autoMatch).toBe("name");
    expect(cols[0].matched).toBe(true);
    expect(cols[1].autoMatch).toBe("system_id");
    expect(cols[2].autoMatch).toBeNull();
    expect(cols[2].matched).toBe(false);
  });
});

describe("detectHeaderRows", () => {
  it("picks the row with most known fields as system header", () => {
    const matrix = [
      ["Systemnummer", "Objektnamn", "Interimsnummer"],
      ["Traivos ID", "Namnet på objektet", "Temporärt nummer"],
      ["OBJ-1", "Hemköp Centrum", "I1"],
    ];
    const d = detectHeaderRows(matrix);
    expect(d.systemHeaderRow).toBe(0);
    expect(d.dataStartRow).toBeGreaterThanOrEqual(1);
  });
  it("falls back to row 0 header when nothing known", () => {
    const matrix = [
      ["foo", "bar"],
      ["1", "2"],
    ];
    const d = detectHeaderRows(matrix);
    expect(d.systemHeaderRow).toBe(0);
    expect(d.dataStartRow).toBe(1);
  });
  it("handles empty matrix", () => {
    const d = detectHeaderRows([]);
    expect(d.dataStartRow).toBe(0);
  });
});

describe("validateValue", () => {
  it("validates text / text_id", () => {
    expect(validateValue("text", "Hemköp")).toBe(true);
    expect(validateValue("text", "  ")).toBe(false);
    expect(validateValue("text_id", "OBJ-1_2")).toBe(true);
    expect(validateValue("text_id", "bad id!")).toBe(false);
  });
  it("validates integer / decimal", () => {
    expect(validateValue("integer", "41")).toBe(true);
    expect(validateValue("integer", "4.5")).toBe(false);
    expect(validateValue("decimal", "4,5")).toBe(true);
  });
  it("validates gps within range", () => {
    expect(validateValue("gps", "59,33")).toBe(true);
    expect(validateValue("gps", "200")).toBe(false);
  });
  it("validates email / phone", () => {
    expect(validateValue("email", "a@b.se")).toBe(true);
    expect(validateValue("email", "nope")).toBe(false);
    expect(validateValue("phone", "+46 70-123 45 67")).toBe(true);
    expect(validateValue("phone", "abc")).toBe(false);
  });
});

describe("validateRow", () => {
  const mappings: ColumnMappings = {
    "0": { target: "name", type: "standard", required: true },
    "1": { target: "system_id", type: "standard" },
    "2": { target: "contact.email", type: "contact" },
  };
  it("flags missing required name as invalid", () => {
    const v = validateRow(1, { "0": "", "1": "OBJ-1", "2": "" }, mappings);
    expect(v.status).toBe("invalid");
    expect(v.issues.some((i) => i.field === "name" && i.severity === "error")).toBe(true);
  });
  it("flags bad optional value as warning", () => {
    const v = validateRow(2, { "0": "Hemköp", "1": "OBJ-1", "2": "not-an-email" }, mappings);
    expect(v.status).toBe("warning");
    expect(v.issues.some((i) => i.field === "contact.email" && i.severity === "warning")).toBe(true);
  });
  it("passes a clean row", () => {
    const v = validateRow(3, { "0": "Hemköp", "1": "OBJ-1", "2": "a@b.se" }, mappings);
    expect(v.status).toBe("valid");
    expect(v.issues).toHaveLength(0);
  });
});

describe("resolveRow", () => {
  it("splits standard, composite and metadata fields", () => {
    const mappings: ColumnMappings = {
      "0": { target: "name", type: "standard" },
      "1": { target: "address.street", type: "address" },
      "2": { target: "metadata.kärltyp", type: "metadata" },
      "3": { target: "__empty", type: "standard" },
    };
    const r = resolveRow(7, { "0": "Hemköp", "1": "Storgatan", "2": "Kärl 660L", "3": "skräp" }, mappings);
    expect(r.fields.name).toBe("Hemköp");
    expect(r.composite.address.street).toBe("Storgatan");
    expect(r.metadata["kärltyp"]).toBe("Kärl 660L");
    expect(r.fields.__empty).toBeUndefined();
  });
});

describe("validateCrossRow", () => {
  it("varnar (topphierarki) för okänd interimförälder — inte blockerande fel", () => {
    // Task #1356: saknad interimförälder ⇒ raden blir rot, med varning.
    const rows = [resolved(1, { interim_id: "I1", interim_parent_id: "MISSING" })];
    const issues = validateCrossRow(rows);
    const issue = issues.find((i) => i.field === "interim_parent_id");
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toContain("topphierarki");
  });
  it("detects self-parent and circular references", () => {
    const self = validateCrossRow([resolved(1, { interim_id: "I1", interim_parent_id: "I1" })]);
    expect(self.some((i) => i.message.includes("egen förälder"))).toBe(true);

    const cyc = validateCrossRow([
      resolved(1, { interim_id: "A", interim_parent_id: "B" }),
      resolved(2, { interim_id: "B", interim_parent_id: "A" }),
    ]);
    expect(cyc.some((i) => i.message.includes("Cirkulärreferens"))).toBe(true);
  });
  it("warns on duplicate external_id", () => {
    const issues = validateCrossRow([
      resolved(1, { external_id: "EXT-9" }),
      resolved(2, { external_id: "EXT-9" }),
    ]);
    expect(issues.some((i) => i.field === "external_id" && i.severity === "warning")).toBe(true);
  });
  it("is clean for a valid hierarchy", () => {
    const issues = validateCrossRow([
      resolved(1, { interim_id: "ROOT" }),
      resolved(2, { interim_id: "STORE", interim_parent_id: "ROOT" }),
    ]);
    expect(issues).toHaveLength(0);
  });
});

describe("buildHierarchyPlan", () => {
  it("orders parents before children topologically", () => {
    const rows = [
      resolved(1, { interim_id: "STORE", interim_parent_id: "ORG", name: "Hemköp Centrum" }),
      resolved(2, { interim_id: "ORG", name: "Hemköp AB" }),
    ];
    const plan = buildHierarchyPlan(rows);
    expect(plan.cycleRowNumbers).toHaveLength(0);
    const orgIdx = plan.ordered.findIndex((p) => p.interimId === "ORG");
    const storeIdx = plan.ordered.findIndex((p) => p.interimId === "STORE");
    expect(orgIdx).toBeLessThan(storeIdx);
    expect(plan.ordered.every((p) => p.kind === "primary")).toBe(true);
  });

  it("groups equipment rows under the primary store", () => {
    const rows = [
      resolved(1, { interim_id: "STORE", interim_parent_id: "ORG", name: "Butik" }),
      resolved(2, { interim_id: "STORE", name: "Kärl 1" }),
      resolved(3, { interim_id: "STORE", name: "Kärl 2" }),
      resolved(4, { interim_id: "ORG", name: "Org" }),
    ];
    const plan = buildHierarchyPlan(rows);
    const equipment = plan.ordered.filter((p) => p.kind === "equipment");
    expect(equipment).toHaveLength(2);
    expect(equipment.every((p) => p.interimId === "STORE")).toBe(true);
    // Primär kommer före utrustningen i ordningen.
    const lastPrimary = plan.ordered.findIndex((p) => p.interimId === "STORE" && p.kind === "primary");
    expect(lastPrimary).toBeGreaterThanOrEqual(0);
    expect(plan.ordered.indexOf(equipment[0])).toBeGreaterThan(lastPrimary);
  });

  it("picks the parent-positioned row as primary even when equipment is listed first", () => {
    const rows = [
      resolved(1, { interim_id: "STORE", name: "Pantkärl" }), // utrustning (tom förälder), listad först
      resolved(2, { interim_id: "STORE", interim_parent_id: "ORG", name: "Butik" }), // butik = primär
      resolved(3, { interim_id: "ORG", name: "Org" }),
    ];
    const plan = buildHierarchyPlan(rows);
    const primaryStore = plan.ordered.find((p) => p.interimId === "STORE" && p.kind === "primary");
    expect(primaryStore?.row.fields.name).toBe("Butik");
    const equip = plan.ordered.filter((p) => p.kind === "equipment");
    expect(equip).toHaveLength(1);
    expect(equip[0].row.fields.name).toBe("Pantkärl");
  });

  it("marks update vs create based on existing keys", () => {
    const rows = [
      resolved(1, { system_id: "OBJ-100", name: "Befintlig" }),
      resolved(2, { external_id: "EXT-5", name: "Via externt id" }),
      resolved(3, { name: "Ny" }),
    ];
    const plan = buildHierarchyPlan(rows, new Set(["OBJ-100"]), new Set(["EXT-5"]));
    const byRow = Object.fromEntries(plan.ordered.map((p) => [p.rowNumber, p.action]));
    expect(byRow[1]).toBe("update");
    expect(byRow[2]).toBe("update");
    expect(byRow[3]).toBe("create");
  });

  it("marks update when interim id matches an existing interim object", () => {
    const rows = [
      resolved(1, { interim_id: "I-1", name: "Befintlig interim" }),
      resolved(2, { interim_id: "I-2", name: "Ny interim" }),
    ];
    const plan = buildHierarchyPlan(rows, new Set(), new Set(), new Set(["I-1"]));
    const byRow = Object.fromEntries(plan.ordered.map((p) => [p.rowNumber, p.action]));
    expect(byRow[1]).toBe("update");
    expect(byRow[2]).toBe("create");
  });

  it("reports cycle row numbers", () => {
    const rows = [
      resolved(1, { interim_id: "A", interim_parent_id: "B", name: "A" }),
      resolved(2, { interim_id: "B", interim_parent_id: "A", name: "B" }),
    ];
    const plan = buildHierarchyPlan(rows);
    expect(plan.cycleRowNumbers.length).toBeGreaterThan(0);
  });
});

describe("buildCompositeObject", () => {
  it("drops empty subfields and trims", () => {
    const obj = buildCompositeObject({ street: " Storgatan ", city: "", postal_code: "12345" });
    expect(obj).toEqual({ street: "Storgatan", postal_code: "12345" });
  });
});

// Metadata-grupperingen som execute-steget använder för att skriva
// metadata.<grupp>.<underfält> som ETT json-fält per grupp.
describe("groupMetadataForWrite", () => {
  it("groups dot-keys into one json field per group and keeps flat keys as strings", () => {
    const { strings, jsonGroups } = groupMetadataForWrite({
      "kontakt.namn": "Anna",
      "kontakt.tel": "070-1234567",
      "fakturering.epost": "faktura@hemkop.se",
      portkod: "1234",
    });
    expect(strings).toEqual([{ namn: "portkod", varde: "1234" }]);
    const byName = new Map(jsonGroups.map((g) => [g.namn, g.varde]));
    expect(byName.get("kontakt")).toEqual({ namn: "Anna", tel: "070-1234567" });
    expect(byName.get("fakturering")).toEqual({ epost: "faktura@hemkop.se" });
  });

  it("splits on the FIRST dot so deeper subpaths are preserved intact", () => {
    const { jsonGroups } = groupMetadataForWrite({ "grupp.sub.djup": "x", "grupp.platt": "y" });
    const grupp = jsonGroups.find((g) => g.namn === "grupp")!;
    expect(grupp.varde).toEqual({ "sub.djup": "x", platt: "y" });
  });

  it("skips the reserved 'typ' key (caller writes it separately)", () => {
    const { strings, jsonGroups } = groupMetadataForWrite({ typ: "butik", färg: "blå" });
    expect(strings).toEqual([{ namn: "färg", varde: "blå" }]);
    expect(jsonGroups).toHaveLength(0);
  });
});

// Hela kedjan (§6): rå matris med 3 header-rader → detectHeaderRows → slice data
// → resolveRow → validateRow → buildHierarchyPlan. Hemköp-liknande interim-träd:
// org → kedja → distrikt → butik, plus utrustning som delar butikens interim.
describe("import 2.0 end-to-end chain", () => {
  const mappings: ColumnMappings = {
    "0": { target: "system_id", type: "standard" },
    "1": { target: "name", type: "standard", required: true },
    "2": { target: "interim_id", type: "standard" },
    "3": { target: "interim_parent_id", type: "standard" },
  };

  // 3 header-rader (system + lång beskrivning + användarrubriker) följt av data.
  const matrix: string[][] = [
    ["Systemnummer", "Objektnamn", "Interimsnummer", "Interims-förälder"],
    [
      "Traivos unika identifierare för objektet i systemet",
      "Det fullständiga namnet på objektet som visas i appen",
      "Temporärt importnummer som används för nya objekt",
      "Temporärt nummer för det överordnade objektet i hierarkin",
    ],
    [
      "Butikens systemidentifierare i Traivo",
      "Butikens fullständiga visningsnamn",
      "Temporärt interimsnummer vid import",
      "Överordnat temporärt interimsnummer",
    ],
    ["", "Hemköp Sverige AB", "1000", ""],
    ["", "Hemköp Kedja", "2000", "1000"],
    ["", "Distrikt Väst", "3000", "2000"],
    ["", "Hemköp Centrum", "10", "3000"],
    ["", "Pantkärl", "10", ""],
    ["", "Matavfallskärl", "10", ""],
  ];

  it("detects 3 header rows and builds a 5-level hierarchy with equipment grouping", () => {
    const detection = detectHeaderRows(matrix);
    expect(detection.systemHeaderRow).toBe(0);
    expect(detection.dataStartRow).toBe(3);

    const dataRows = matrix.slice(detection.dataStartRow);
    const resolved: ResolvedRow[] = dataRows.map((cells, i) => {
      const raw: Record<string, string> = {};
      cells.forEach((c, idx) => (raw[String(idx)] = c));
      return resolveRow(i + 1, raw, mappings);
    });
    expect(resolved).toHaveLength(6);

    // Validering: alla rader giltiga (namn finns, inga typfel).
    for (const r of resolved) {
      const v = validateRow(r.rowNumber, r.raw as Record<string, string>, mappings);
      expect(v.status).not.toBe("invalid");
    }

    const plan = buildHierarchyPlan(resolved, new Set(), new Set(), new Set());
    expect(plan.cycleRowNumbers).toHaveLength(0);

    const primaries = plan.ordered.filter((p) => p.kind === "primary");
    const equipment = plan.ordered.filter((p) => p.kind === "equipment");
    expect(primaries).toHaveLength(4); // org, kedja, distrikt, butik
    expect(equipment).toHaveLength(2); // pantkärl, matavfall
    expect(equipment.every((e) => e.interimId === "10")).toBe(true);
    expect(plan.ordered.every((p) => p.action === "create")).toBe(true);

    // Grupp interim 10 = exakt en primär (butik, har interim_parent) + 2 utrustning.
    const group10 = plan.ordered.filter((p) => p.interimId === "10");
    expect(group10.filter((p) => p.kind === "primary")).toHaveLength(1);
    expect(group10.filter((p) => p.kind === "equipment")).toHaveLength(2);
    const butik = group10.find((p) => p.kind === "primary")!;
    expect(butik.row.fields.name).toBe("Hemköp Centrum");
    expect(butik.row.fields.interim_parent_id).toBe("3000");

    // Topologisk ordning: förälder före barn.
    const idxOf = (interimId: string) =>
      plan.ordered.findIndex((p) => p.kind === "primary" && p.interimId === interimId);
    expect(idxOf("1000")).toBeLessThan(idxOf("2000"));
    expect(idxOf("2000")).toBeLessThan(idxOf("3000"));
    expect(idxOf("3000")).toBeLessThan(idxOf("10"));

    // Exakt en rot (org saknar interim-förälder).
    const primaryByInterim = new Map(
      primaries.filter((p) => p.interimId).map((p) => [p.interimId as string, p]),
    );
    const roots = primaries.filter((p) => {
      const pid = p.row.fields.interim_parent_id;
      return !pid || !primaryByInterim.has(pid);
    });
    expect(roots).toHaveLength(1);
    expect(roots[0].row.fields.name).toBe("Hemköp Sverige AB");

    // 5 nivåer: org(0) → kedja(1) → distrikt(2) → butik(3) → utrustning(4).
    const depthOf = (interimId: string): number => {
      const item = primaryByInterim.get(interimId);
      const pid = item?.row.fields.interim_parent_id;
      return pid && primaryByInterim.has(pid) ? 1 + depthOf(pid) : 0;
    };
    const maxPrimaryDepth = Math.max(...Array.from(primaryByInterim.keys()).map(depthOf));
    const totalLevels = maxPrimaryDepth + 1 + 1; // primärnivåer + utrustningsnivå
    expect(totalLevels).toBe(5);
  });
});

// Regression: equipment-rader delar butikens interim_id. Vid RE-IMPORT (interim
// finns redan i DB) får utrustningen ALDRIG klassas som "update" — då skulle den
// uppdatera butiks-objektet istället för att skapas som eget barn.
describe("buildHierarchyPlan — equipment never matches shared interim on re-import", () => {
  it("marks store primary as update but keeps equipment as create when interim already exists", () => {
    const rows: ResolvedRow[] = [
      resolved(1, { name: "Hemköp Centrum", interim_id: "10", interim_parent_id: "3000" }),
      resolved(2, { name: "Pantkärl", interim_id: "10" }),
      resolved(3, { name: "Matavfallskärl", interim_id: "10" }),
    ];
    // Interim "10" finns redan (butiken skapad i tidigare import via MALL-10).
    const plan = buildHierarchyPlan(rows, new Set(), new Set(), new Set(["10"]));

    const primary = plan.ordered.find((p) => p.kind === "primary" && p.interimId === "10")!;
    const equipment = plan.ordered.filter((p) => p.kind === "equipment");
    expect(primary.action).toBe("update"); // butiken uppdateras
    expect(equipment).toHaveLength(2);
    expect(equipment.every((e) => e.action === "create")).toBe(true); // utrustning skapas, ej update
  });

  it("equipment with its OWN system_id still updates via system match, not interim", () => {
    const rows: ResolvedRow[] = [
      resolved(1, { name: "Butik", interim_id: "20" }),
      resolved(2, { name: "Kärl A", interim_id: "20", system_id: "OBJ-500" }),
    ];
    const plan = buildHierarchyPlan(rows, new Set(["OBJ-500"]), new Set(), new Set(["20"]));
    const equip = plan.ordered.find((p) => p.kind === "equipment")!;
    expect(equip.action).toBe("update"); // eget systemnummer matchar → laglig update
  });
});

// Regression: en fil med EN header-rad får inte tappa sin första datarad bara för
// att raden råkar innehålla ett långt namn/adress-värde.
describe("detectHeaderRows — single header with long-value data row", () => {
  it("keeps the first data row when only one cell is long", () => {
    const matrix: string[][] = [
      ["Objektnamn", "Systemnummer", "Postnummer"],
      ["Hemköp Centrum Stora Torget Stockholm City", "OBJ-1", "11122"],
      ["ICA Maxi", "OBJ-2", "22233"],
    ];
    const detection = detectHeaderRows(matrix);
    expect(detection.systemHeaderRow).toBe(0);
    expect(detection.dataStartRow).toBe(1); // ingen datarad klassas som header
  });
});
