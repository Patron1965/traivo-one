import { describe, it, expect } from "vitest";
import {
  deriveUppgiftStatus,
  isUppgiftFrozen,
  UPPGIFT_STATUSES,
  UPPGIFTSPAKET_VERSION,
} from "@shared/uppgift-contract";

// Task #1215 (Etapp 3): frysta fakta-gaten som styr uppgiftspaket-propageringen.
// Frysta = utford eller senare (inkl. terminala lägen). Gaten går ALLTID via
// deriveUppgiftStatus (den enda status-mappningen).
describe("isUppgiftFrozen", () => {
  it("fryser utford och senare + terminala lägen", () => {
    const frozen = UPPGIFT_STATUSES.filter((s) => isUppgiftFrozen(s));
    expect(frozen.sort()).toEqual(
      ["utford", "fakturakontroll", "fakturerad", "omojlig_att_utfora", "avbruten"].sort(),
    );
  });

  it("öppna/framtida statusar är INTE frysta", () => {
    for (const s of [
      "vantar_pa_avrop",
      "redo_for_planering",
      "i_masterplanering",
      "grovplanerad",
      "finplanerad",
      "pa_vag",
      "pa_plats",
    ] as const) {
      expect(isUppgiftFrozen(s)).toBe(false);
    }
  });

  it("gate:ar work_orders korrekt via deriveUppgiftStatus", () => {
    // Öppen WO → propagering tillåten
    expect(
      isUppgiftFrozen(
        deriveUppgiftStatus({ orderStatus: "skapad", executionStatus: "not_planned" }),
      ),
    ).toBe(false);
    // Pågående arbete → fortfarande öppen (paketet ska följa med ut i fält)
    expect(
      isUppgiftFrozen(deriveUppgiftStatus({ orderStatus: "planerad_resurs", executionStatus: "on_site" })),
    ).toBe(false);
    // Utförd → fryst
    expect(
      isUppgiftFrozen(deriveUppgiftStatus({ orderStatus: "utford", executionStatus: "completed" })),
    ).toBe(true);
    // I fakturakö → fryst
    expect(
      isUppgiftFrozen(
        deriveUppgiftStatus({
          orderStatus: "utford",
          executionStatus: "completed",
          invoiceQueueState: "held",
        }),
      ),
    ).toBe(true);
    // Fakturerad/omöjlig/avbruten → frysta
    expect(isUppgiftFrozen(deriveUppgiftStatus({ orderStatus: "fakturerad" }))).toBe(true);
    expect(isUppgiftFrozen(deriveUppgiftStatus({ orderStatus: "omojlig" }))).toBe(true);
    expect(isUppgiftFrozen(deriveUppgiftStatus({ orderStatus: "avbruten" }))).toBe(true);
    expect(isUppgiftFrozen(deriveUppgiftStatus({ impossible: true }))).toBe(true);
  });

  it("gate:ar assignments korrekt via deriveUppgiftStatus (exec-axeln)", () => {
    expect(
      isUppgiftFrozen(deriveUppgiftStatus({ executionStatus: "not_planned", materialized: false })),
    ).toBe(false);
    expect(
      isUppgiftFrozen(deriveUppgiftStatus({ executionStatus: "planned_fine", materialized: false })),
    ).toBe(false);
    expect(
      isUppgiftFrozen(deriveUppgiftStatus({ executionStatus: "completed", materialized: false })),
    ).toBe(true);
    expect(
      isUppgiftFrozen(deriveUppgiftStatus({ executionStatus: "invoiced", materialized: false })),
    ).toBe(true);
  });

  it("paketversionen är 1", () => {
    expect(UPPGIFTSPAKET_VERSION).toBe(1);
  });
});
