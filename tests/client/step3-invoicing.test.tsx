import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Step3Invoicing from "@/components/orderkoncept/Step3Invoicing";
import type { InvoiceModel } from "@shared/schema";

// Task #1065: Step3Invoicing (Task #1056) exponerar bara TVÅ faktureringsmetoder.
// Dessa tester låser mappningen samt referensläges-växlingen som annars lätt går
// sönder tyst.

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity, queryFn: async () => [] },
      mutations: { retry: false },
    },
  });
}

const BASE_PROPS = {
  invoiceModel: "call_off" as InvoiceModel | null,
  invoiceFrequency: "monthly" as string | null,
  invoiceLock: false,
  invoiceBrake: false,
  subscriptionAdjustmentDate: "",
  invoiceConsolidation: "customer",
  departmentMetadataField: null as string | null,
  monthlyFee: null as number | null,
  subscriptionStartDate: "",
  customerReference: "",
  customerLabel: "",
  conceptId: null as string | null,
};

function renderStep3(overrides: Partial<typeof BASE_PROPS> = {}) {
  const onUpdate = vi.fn();
  const utils = render(
    <QueryClientProvider client={makeClient()}>
      <Step3Invoicing {...BASE_PROPS} {...overrides} onUpdate={onUpdate} />
    </QueryClientProvider>,
  );
  return { ...utils, onUpdate };
}

describe("Step3Invoicing — tvåvalsmetoden mappar korrekt", () => {
  afterEach(() => cleanup());

  it("'Abonnemang' => invoiceModel subscription", () => {
    const { getByTestId, onUpdate } = renderStep3({ invoiceModel: "call_off" });
    fireEvent.click(getByTestId("radio-method-abonnemang"));
    expect(onUpdate).toHaveBeenCalledWith({ invoiceModel: "subscription" });
  });

  it("'Efterfakturering' från abonnemang => invoiceModel call_off", () => {
    const { getByTestId, onUpdate } = renderStep3({ invoiceModel: "subscription" });
    fireEvent.click(getByTestId("radio-method-efterfakturering"));
    expect(onUpdate).toHaveBeenCalledWith({ invoiceModel: "call_off" });
  });

  it("legacy schedule visas som Efterfakturering (abonnemang ej förvalt)", () => {
    const { getByTestId } = renderStep3({ invoiceModel: "schedule" });
    expect(getByTestId("radio-method-efterfakturering").getAttribute("data-state")).toBe("checked");
    expect(getByTestId("radio-method-abonnemang").getAttribute("data-state")).toBe("unchecked");
  });
});

describe("Step3Invoicing — metadatabaserad referens blir ett fakturastopp", () => {
  afterEach(() => cleanup());

  it("växling till metadatareferens sätter invoiceConsolidation = vald frekvens och rensar fast referens", () => {
    const { getByTestId, onUpdate } = renderStep3({
      invoiceFrequency: "quarterly",
      invoiceConsolidation: "customer",
      customerReference: "Beställaren",
      customerLabel: "PROJ-1",
    });
    fireEvent.click(getByTestId("radio-reference-metadata"));
    expect(onUpdate).toHaveBeenCalledWith({
      invoiceConsolidation: "quarterly",
      customerReference: "",
      customerLabel: "",
    });
  });

  it("växling tillbaka till fast referens återställer kundnivå och nollar metadatafältet", () => {
    const { getByTestId, onUpdate } = renderStep3({
      invoiceConsolidation: "fastighet",
      departmentMetadataField: "fastighet",
    });
    fireEvent.click(getByTestId("radio-reference-fixed"));
    expect(onUpdate).toHaveBeenCalledWith({
      invoiceConsolidation: "customer",
      departmentMetadataField: null,
    });
  });
});
