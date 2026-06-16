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
