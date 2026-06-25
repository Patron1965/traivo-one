import { describe, it, expect, vi, beforeEach } from "vitest";

// Task #1124: Fakturareferenser — huvud vs radnivå. Rena tester med mockad
// metadata-läsare (getArticleMetadataForObject) så HARDCODED- och
// FROM_METADATA-vägarna kan verifieras utan DB. Honorera memories
// order-concept-customer-resolution (svensk katalog-namn, exakt match) +
// metadata-display-vs-matching-key.

vi.mock("../../server/metadata-queries", () => ({
  getArticleMetadataForObject: vi.fn(),
}));

import { getArticleMetadataForObject } from "../../server/metadata-queries";
import {
  resolveInvoiceReferencesForObject,
  buildFrozenRowReferences,
  conceptHasRowConfig,
  type ReferenceConceptLike,
  type ResolvedInvoiceReferences,
} from "../../server/services/invoice-reference-resolver";

const mockGet = vi.mocked(getArticleMetadataForObject);

beforeEach(() => {
  mockGet.mockReset();
});

describe("resolveInvoiceReferencesForObject — HARDCODED", () => {
  it("returnerar rena värden utan metadata-uppslag och utan varningar", async () => {
    const concept: ReferenceConceptLike = {
      name: "Veckotömning",
      ourReference: "Anna Andersson",
      customerReference: "Beställning 42",
      customerReferenceMode: "HARDCODED",
      customerLabel: "PO-100",
      customerLabelMode: "HARDCODED",
    };
    const r = await resolveInvoiceReferencesForObject("t1", concept, "obj-1");
    expect(r.ourReference).toBe("Anna Andersson");
    expect(r.ourDesignation).toBe("Veckotömning");
    expect(r.customerReference).toBe("Beställning 42");
    expect(r.customerInvoiceReference).toBe("PO-100");
    expect(r.warnings).toHaveLength(0);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("trimmar/nollställer tomma värden", async () => {
    const r = await resolveInvoiceReferencesForObject(
      "t1",
      { name: "  ", ourReference: "   ", customerReference: "" },
      "obj-1",
    );
    expect(r.ourReference).toBeNull();
    expect(r.ourDesignation).toBeNull();
    expect(r.customerReference).toBeNull();
  });
});

describe("resolveInvoiceReferencesForObject — FROM_METADATA", () => {
  it("läser metadatafältet och prioriterar displayValue", async () => {
    mockGet.mockResolvedValue({ displayValue: "Kostnadsställe 7", value: "cc7" } as any);
    const concept: ReferenceConceptLike = {
      name: "K",
      customerReferenceMode: "FROM_METADATA",
      customerReferenceMetadataField: "Kostnadsställe",
    };
    const r = await resolveInvoiceReferencesForObject("t1", concept, "obj-1");
    expect(r.customerReference).toBe("Kostnadsställe 7");
    expect(mockGet).toHaveBeenCalledWith("obj-1", "Kostnadsställe", "t1");
    expect(r.warnings).toHaveLength(0);
  });

  it("varnar (utan att stoppa) när inget metadatafält valts", async () => {
    const r = await resolveInvoiceReferencesForObject(
      "t1",
      { name: "K", customerReferenceMode: "FROM_METADATA", customerReferenceMetadataField: null },
      "obj-1",
    );
    expect(r.customerReference).toBeNull();
    expect(r.warnings.some((w) => w.includes("Er referens"))).toBe(true);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("varnar när FROM_METADATA saknar objekt", async () => {
    const r = await resolveInvoiceReferencesForObject(
      "t1",
      { name: "K", customerLabelMode: "FROM_METADATA", customerLabelMetadataField: "Ordernr" },
      null,
    );
    expect(r.customerInvoiceReference).toBeNull();
    expect(r.warnings.some((w) => w.includes("Ert ordernr"))).toBe(true);
  });

  it("varnar när fältet saknar värde på objektet", async () => {
    mockGet.mockResolvedValue(null as any);
    const r = await resolveInvoiceReferencesForObject(
      "t1",
      { name: "K", customerReferenceMode: "FROM_METADATA", customerReferenceMetadataField: "Ref" },
      "obj-1",
    );
    expect(r.customerReference).toBeNull();
    expect(r.warnings.some((w) => w.includes('"Ref" saknar värde'))).toBe(true);
  });
});

describe("resolveInvoiceReferencesForObject — radreferenser", () => {
  it("en rad per fält med värde; tomma/saknade hoppas över", async () => {
    mockGet.mockImplementation(async (_objId: any, field: any) => {
      if (field === "Portkod") return { displayValue: "1234", value: "1234" } as any;
      return null as any; // Våning saknar värde
    });
    const concept: ReferenceConceptLike = {
      name: "K",
      invoiceRowReferenceFields: ["Portkod", "Våning"],
    };
    const r = await resolveInvoiceReferencesForObject("t1", concept, "obj-1");
    expect(r.rowReferences).toEqual([{ label: "Portkod", value: "1234" }]);
  });

  it("varnar när radfält finns men objekt saknas", async () => {
    const r = await resolveInvoiceReferencesForObject(
      "t1",
      { name: "K", invoiceRowReferenceFields: ["Portkod"] },
      null,
    );
    expect(r.rowReferences).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes("Radreferenser"))).toBe(true);
  });

  it("includeExecutorFreetext defaultar till true men respekteras när satt", async () => {
    const r1 = await resolveInvoiceReferencesForObject("t1", { name: "K" }, "obj-1");
    expect(r1.includeExecutorFreetext).toBe(true);
    const r2 = await resolveInvoiceReferencesForObject(
      "t1",
      { name: "K", includeExecutorFreetext: false },
      "obj-1",
    );
    expect(r2.includeExecutorFreetext).toBe(false);
  });
});

describe("buildFrozenRowReferences + conceptHasRowConfig", () => {
  const resolved: ResolvedInvoiceReferences = {
    ourReference: null,
    ourDesignation: null,
    customerReference: null,
    customerInvoiceReference: null,
    rowReferences: [{ label: "Portkod", value: "1234" }],
    includeExecutorFreetext: true,
    warnings: [],
  };

  it("buildFrozenRowReferences: null när ingen radkonfig finns", () => {
    expect(buildFrozenRowReferences(resolved, false)).toBeNull();
  });

  it("buildFrozenRowReferences: fryser rader + fritext-flagga när radkonfig finns", () => {
    expect(buildFrozenRowReferences(resolved, true)).toEqual({
      rows: [{ label: "Portkod", value: "1234" }],
      includeExecutorFreetext: true,
    });
  });

  it("conceptHasRowConfig: true för radfält ELLER utförar-fritext (default på)", () => {
    // Radfält → alltid radkonfig (oavsett fritext-flaggan).
    expect(conceptHasRowConfig({ invoiceRowReferenceFields: ["A"] })).toBe(true);
    expect(
      conceptHasRowConfig({
        invoiceRowReferenceFields: ["A"],
        includeExecutorFreetext: false,
      }),
    ).toBe(true);
    // Inga radfält men utförar-fritext PÅ (default när flaggan saknas/null/true)
    // → radkonfig finns, annars tappas utförarens fritext tyst (regression #1124).
    expect(conceptHasRowConfig({})).toBe(true);
    expect(conceptHasRowConfig({ invoiceRowReferenceFields: [] })).toBe(true);
    expect(conceptHasRowConfig({ invoiceRowReferenceFields: ["   "] })).toBe(true);
    expect(conceptHasRowConfig({ includeExecutorFreetext: true })).toBe(true);
    expect(conceptHasRowConfig({ includeExecutorFreetext: null })).toBe(true);
    // Inga radfält OCH utförar-fritext explicit AV → ingen radkonfig (fallback).
    expect(conceptHasRowConfig({ includeExecutorFreetext: false })).toBe(false);
    expect(
      conceptHasRowConfig({
        invoiceRowReferenceFields: [],
        includeExecutorFreetext: false,
      }),
    ).toBe(false);
  });

  it("regression #1124: utförar-fritext utan radfält fryses (inte null)", () => {
    // Koncept med fritext PÅ men inga radfält: tidigare gav conceptHasRowConfig
    // false → frozenInvoiceRowReferences=null → utförarens fritext nådde aldrig
    // fakturan. Nu fryses {rows:[], includeExecutorFreetext:true}.
    const freetextOnly: ResolvedInvoiceReferences = {
      ourReference: null,
      ourDesignation: null,
      customerReference: null,
      customerInvoiceReference: null,
      rowReferences: [],
      includeExecutorFreetext: true,
      warnings: [],
    };
    const concept = { name: "Avrop", includeExecutorFreetext: true };
    const frozen = buildFrozenRowReferences(
      freetextOnly,
      conceptHasRowConfig(concept),
    );
    expect(frozen).toEqual({ rows: [], includeExecutorFreetext: true });
  });

  it("fritext explicit AV utan radfält → null (fallback till berikad beskrivning)", () => {
    const noConfig: ResolvedInvoiceReferences = {
      ourReference: null,
      ourDesignation: null,
      customerReference: null,
      customerInvoiceReference: null,
      rowReferences: [],
      includeExecutorFreetext: false,
      warnings: [],
    };
    const concept = { name: "Avrop", includeExecutorFreetext: false };
    expect(
      buildFrozenRowReferences(noConfig, conceptHasRowConfig(concept)),
    ).toBeNull();
  });
});
