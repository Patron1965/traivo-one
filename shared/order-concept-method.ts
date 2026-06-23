import { INVOICE_MODELS, type InvoiceModel } from "./schema";

// Task #934: Centraliserad metod-resolver för orderkoncept.
// Konceptets faktureringsmetod (`invoiceModel`: call_off/schedule/subscription)
// är den kanoniska källan. Legacy-fältet `scenario` (avrop/schema/abonnemang)
// behålls (expand-contract) och write-through:as från wizarden, men all
// exekverings-/preview-/validerings-logik ska gå via getOrderConceptMethod()
// så att de tre metoderna behandlas distinkt oavsett hur konceptet skapades.

export const SCENARIO_VALUES = ["avrop", "schema", "abonnemang"] as const;
export type ScenarioValue = typeof SCENARIO_VALUES[number];

export const SCENARIO_TO_INVOICE_MODEL: Record<ScenarioValue, InvoiceModel> = {
  avrop: "call_off",
  schema: "schedule",
  abonnemang: "subscription",
};

export const INVOICE_MODEL_TO_SCENARIO: Record<InvoiceModel, ScenarioValue> = {
  call_off: "avrop",
  schedule: "schema",
  subscription: "abonnemang",
};

/**
 * Härleder konceptets faktureringsmetod. Föredrar `invoiceModel`; faller
 * tillbaka på en mappning av legacy-`scenario` för koncept som skapats innan
 * invoiceModel skrevs (eller via den äldre OrderConceptsPage-vyn). Default är
 * "call_off" (engångs-avrop) om ingetdera är satt.
 */
export function getOrderConceptMethod(
  concept: { invoiceModel?: string | null; scenario?: string | null } | null | undefined,
): InvoiceModel {
  const model = concept?.invoiceModel;
  if (model && (INVOICE_MODELS as readonly string[]).includes(model)) {
    return model as InvoiceModel;
  }
  const scenario = concept?.scenario;
  if (scenario && scenario in SCENARIO_TO_INVOICE_MODEL) {
    return SCENARIO_TO_INVOICE_MODEL[scenario as ScenarioValue];
  }
  return "call_off";
}

// Task #1056: UI exponerar bara TVÅ faktureringsmetoder — Efterfakturering och
// Abonnemang. Internt behålls dock alla tre invoiceModel-värden (expand-contract):
// "schedule" finns kvar i befintliga koncept och fortsätter auto-genereras i
// runtime, men kan inte längre VÄLJAS i wizarden. "Efterfakturering" mappar mot
// call_off för nya val; "Abonnemang" mappar mot subscription. Legacy schedule
// visas under "Efterfakturering" men bevaras vid spar (se Step3Invoicing).
export const UI_INVOICE_METHODS = ["efterfakturering", "abonnemang"] as const;
export type UiInvoiceMethod = typeof UI_INVOICE_METHODS[number];

export const UI_INVOICE_METHOD_LABELS: Record<UiInvoiceMethod, string> = {
  efterfakturering: "Efterfakturering",
  abonnemang: "Abonnemang",
};

// Mappar ett internt invoiceModel (call_off/schedule/subscription) till det
// tvåval-UI:t. Allt utom subscription visas som "Efterfakturering".
export function invoiceModelToUiMethod(model: string | null | undefined): UiInvoiceMethod {
  return model === "subscription" ? "abonnemang" : "efterfakturering";
}

// Task #1056: EN faktureringsfrekvens för hela konceptet (ersätter det tidigare
// dubbla invoicePeriod + billingFrequency). Värdet skrivs till BÅDA kolumnerna
// vid spar så att runtime (abonnemangs-/schemamotorn) fortsätter fungera.
export const INVOICE_FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;
export type InvoiceFrequency = typeof INVOICE_FREQUENCIES[number];

export const INVOICE_FREQUENCY_LABELS: Record<InvoiceFrequency, string> = {
  monthly: "Månadsvis",
  quarterly: "Kvartalsvis",
  yearly: "Årsvis",
};

// Klampar godtyckliga/legacy-frekvensvärden (t.ex. invoicePeriod "daily"/"weekly")
// till det unifierade settet; default "monthly".
export function normalizeInvoiceFrequency(v: string | null | undefined): InvoiceFrequency {
  return v === "quarterly" || v === "yearly" ? v : "monthly";
}
