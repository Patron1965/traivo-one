import { describe, it, expect } from "vitest";
import {
  buildInvoicePatch,
  conceptMatchesScenarioTab,
  isFakturastoppConsolidation,
} from "@shared/order-concept-method";

// Task #1065: Regler från den ihopslagna fakturaskärmen (Task #1056) som lätt går
// sönder tyst vid framtida ändringar. Täcker vad buildConceptPatch persisterar
// (via buildInvoicePatch) samt översiktssidans flikfilter (conceptMatchesScenarioTab).

describe("buildInvoicePatch — metadatabaserad referens (fakturastopp)", () => {
  it("sätter automatiskt invoiceConsolidation = vald frekvens när ett metadatafält valts", () => {
    const patch = buildInvoicePatch({
      invoiceModel: "call_off",
      billingFrequency: "quarterly",
      // Step3 sätter invoiceConsolidation till frekvensen när metadatareferens väljs.
      invoiceConsolidation: "quarterly",
      departmentMetadataField: "fastighet",
    });
    expect(patch.invoiceConsolidation).toBe("quarterly");
    expect(patch.departmentMetadataField).toBe("fastighet");
  });

  it("kundnivå => invoiceConsolidation='customer' och departmentMetadataField nollställs", () => {
    const patch = buildInvoicePatch({
      invoiceModel: "call_off",
      billingFrequency: "monthly",
      invoiceConsolidation: "customer",
      // Skräp från ett tidigare metadataval ska rensas vid spar på kundnivå.
      departmentMetadataField: "fastighet",
    });
    expect(patch.invoiceConsolidation).toBe("customer");
    expect(patch.departmentMetadataField).toBeNull();
  });

  it("per_job behandlas också som ren kundnivå (inget fakturastopp)", () => {
    expect(isFakturastoppConsolidation("per_job")).toBe(false);
    const patch = buildInvoicePatch({
      invoiceModel: "subscription",
      billingFrequency: "yearly",
      invoiceConsolidation: "per_job",
      departmentMetadataField: "omrade",
    });
    expect(patch.invoiceConsolidation).toBe("customer");
    expect(patch.departmentMetadataField).toBeNull();
  });
});

describe("buildInvoicePatch — vald frekvens skrivs till båda frekvensfälten vid spar", () => {
  it("skriver frekvensen till både billingFrequency och invoiceConsolidation vid fakturastopp", () => {
    const patch = buildInvoicePatch({
      invoiceModel: "call_off",
      billingFrequency: "yearly",
      invoiceConsolidation: "fastighet", // valfritt icke-kundnivå-värde = fakturastopp
      departmentMetadataField: "fastighet",
    });
    expect(patch.billingFrequency).toBe("yearly");
    expect(patch.invoiceConsolidation).toBe("yearly");
  });

  it("normaliserar legacy/ogiltiga frekvensvärden till 'monthly' i båda fälten", () => {
    const patch = buildInvoicePatch({
      invoiceModel: "subscription",
      billingFrequency: "weekly", // legacy invoicePeriod-värde
      invoiceConsolidation: "kostnadsstalle",
      departmentMetadataField: "kostnadsstalle",
    });
    expect(patch.billingFrequency).toBe("monthly");
    expect(patch.invoiceConsolidation).toBe("monthly");
  });

  it("på kundnivå styr frekvensen bara billingFrequency (consolidation = customer)", () => {
    const patch = buildInvoicePatch({
      invoiceModel: "call_off",
      billingFrequency: "quarterly",
      invoiceConsolidation: "customer",
      departmentMetadataField: null,
    });
    expect(patch.billingFrequency).toBe("quarterly");
    expect(patch.invoiceConsolidation).toBe("customer");
  });
});

describe("buildInvoicePatch — legacy scenario/deliveryModel write-through", () => {
  it("Efterfakturering (call_off) => scenario 'avrop'", () => {
    const patch = buildInvoicePatch({
      invoiceModel: "call_off",
      billingFrequency: "monthly",
      invoiceConsolidation: "customer",
      departmentMetadataField: null,
    });
    expect(patch.scenario).toBe("avrop");
    expect(patch.deliveryModel).toBe("call_off");
  });

  it("legacy schedule bevaras => scenario 'schema'", () => {
    const patch = buildInvoicePatch({
      invoiceModel: "schedule",
      billingFrequency: "monthly",
      invoiceConsolidation: "customer",
      departmentMetadataField: null,
    });
    expect(patch.scenario).toBe("schema");
    expect(patch.deliveryModel).toBe("schedule");
  });

  it("Abonnemang (subscription) => scenario 'abonnemang'", () => {
    const patch = buildInvoicePatch({
      invoiceModel: "subscription",
      billingFrequency: "monthly",
      invoiceConsolidation: "customer",
      departmentMetadataField: null,
    });
    expect(patch.scenario).toBe("abonnemang");
    expect(patch.deliveryModel).toBe("subscription");
  });

  it("utan invoiceModel utelämnas scenario/deliveryModel (create-default 'avrop' bevaras)", () => {
    const patch = buildInvoicePatch({
      invoiceModel: null,
      billingFrequency: "monthly",
      invoiceConsolidation: "customer",
      departmentMetadataField: null,
    });
    expect(patch.invoiceModel).toBeNull();
    expect(patch.scenario).toBeUndefined();
    expect(patch.deliveryModel).toBeUndefined();
    // JSON.stringify släpper undefined-fälten så hårdkodad create-default rörs ej.
    expect(JSON.parse(JSON.stringify(patch))).not.toHaveProperty("scenario");
    expect(JSON.parse(JSON.stringify(patch))).not.toHaveProperty("deliveryModel");
  });
});

describe("conceptMatchesScenarioTab — översiktssidans flikfilter", () => {
  it("'Efterfakturering' inkluderar avrop, schema OCH tomt/legacy scenario", () => {
    expect(conceptMatchesScenarioTab("avrop", "efterfakturering")).toBe(true);
    expect(conceptMatchesScenarioTab("schema", "efterfakturering")).toBe(true);
    expect(conceptMatchesScenarioTab(null, "efterfakturering")).toBe(true);
    expect(conceptMatchesScenarioTab(undefined, "efterfakturering")).toBe(true);
    expect(conceptMatchesScenarioTab("", "efterfakturering")).toBe(true);
  });

  it("'Efterfakturering' exkluderar abonnemang", () => {
    expect(conceptMatchesScenarioTab("abonnemang", "efterfakturering")).toBe(false);
  });

  it("'Abonnemang' matchar bara abonnemang", () => {
    expect(conceptMatchesScenarioTab("abonnemang", "abonnemang")).toBe(true);
    expect(conceptMatchesScenarioTab("avrop", "abonnemang")).toBe(false);
    expect(conceptMatchesScenarioTab("schema", "abonnemang")).toBe(false);
    expect(conceptMatchesScenarioTab(null, "abonnemang")).toBe(false);
  });

  it("'alla' matchar allt", () => {
    expect(conceptMatchesScenarioTab("avrop", "alla")).toBe(true);
    expect(conceptMatchesScenarioTab("abonnemang", "alla")).toBe(true);
    expect(conceptMatchesScenarioTab(null, "alla")).toBe(true);
  });
});
