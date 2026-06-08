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
  it("errors on unknown interim parent", () => {
    const rows = [resolved(1, { interim_id: "I1", interim_parent_id: "MISSING" })];
    const issues = validateCrossRow(rows);
    expect(issues.some((i) => i.field === "interim_parent_id" && i.severity === "error")).toBe(true);
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
