import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { deriveUppgiftStatus, UPPGIFT_STATUS_LABELS } from "../../shared/uppgift-contract";

const read = (p: string) => readFileSync(p, "utf8");

// Task #1370: Objektsidan — kopplade order/uppgifter med källa + Systeminformation.
describe("objektsidan: kopplade order/uppgifter + systeminformation (Task #1370)", () => {
  it("assignments-endpointen exponerar sourceType och work-orders-endpointen berikar med orderConceptName", () => {
    const src = read("server/routes/customerRoutes.ts");
    expect(src).toContain("sourceType: assignments.sourceType");
    expect(src).toContain("orderConceptName: wo.orderConceptId ? conceptNames.get(wo.orderConceptId) ?? null : null");
  });

  it("systeminformation byggs enbart av riktiga objekt-kolumner (aldrig fabricerade fält)", () => {
    const src = read("server/services/object-system-metadata.ts");
    expect(src).toContain("export type SystemInfoGroup");
    // Dokumenterat beslut: versionsnummer/ändrad-av utelämnas (ingen backing-kolumn).
    expect(src).toMatch(/MEDVETNA UTELÄMNANDEN/);
    // Inga fabricerade fält i typen.
    expect(src).not.toMatch(/versionNumber|versionsnummer:/i);
    expect(src).not.toMatch(/updatedBy|changedBy/);
  });

  it("kopplade order-tabellen härleder status ENBART via deriveUppgiftStatus", () => {
    const src = read("client/src/components/objects/ObjectLinkedOrdersTable.tsx");
    expect(src).toContain("deriveUppgiftStatus");
    expect(src).toContain("taskSourceLabel");
    // Ingen egen statusmappnings-tabell i komponenten.
    expect(src).not.toMatch(/const\s+\w*STATUS_LABELS\s*[:=]/);
  });

  it("deriveUppgiftStatus-kontraktet ger etikett för alla härledda lägen som tabellen använder", () => {
    // WO-exempel: utförd order i fakturakö → fakturakontroll.
    const s1 = deriveUppgiftStatus({ orderStatus: "utford", invoiceQueueState: "pending" });
    expect(UPPGIFT_STATUS_LABELS[s1]).toBeTruthy();
    // Ren assignment-rad (ej materialiserad) → skapad.
    const s2 = deriveUppgiftStatus({ executionStatus: "not_planned" as any, materialized: false });
    expect(UPPGIFT_STATUS_LABELS[s2]).toBeTruthy();
  });

  it("objektsidan renderar båda nya sektionerna", () => {
    const src = read("client/src/pages/ObjectDetailPage.tsx");
    expect(src).toContain("<ObjectLinkedOrdersTable");
    expect(src).toContain("<ObjectSystemInfoSection");
  });
});
