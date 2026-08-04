import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Guardrail för Task #1369: uppgiftens ursprung (source_type + order_concept_id)
// stämplas vid skapandet och är oföränderligt. Klient-payload får ALDRIG kunna
// mynta "orderkoncept"/"import" eller ändra/fabricera konceptreferensen.
//
// Statisk guardrail (samma stil som admin-route-tenant-guard Del B): verifierar
// att varje klient-vänd write-route som spreadar request-body också strippar/
// whitelistar provenance-fälten. Tas en rad bort regressar testet.

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("task-source immutability guardrail (Task #1369)", () => {
  it("workOrderRoutes: POST + with-lines whitelistar sourceType och strippar orderConceptId", () => {
    const src = read("server/routes/workOrderRoutes.ts");
    // Två skapande-routes (POST /api/work-orders + /with-lines) sanerar båda.
    const sanitizeCount = src.match(/CLIENT_ALLOWED_TASK_SOURCES\.includes\(bodyData\.sourceType/g)?.length ?? 0;
    expect(sanitizeCount).toBeGreaterThanOrEqual(2);
    const conceptStrips = src.match(/delete bodyData\.orderConceptId/g)?.length ?? 0;
    expect(conceptStrips).toBeGreaterThanOrEqual(2);
  });

  it("workOrderRoutes: quick-bulk stämplar snabborder", () => {
    const src = read("server/routes/workOrderRoutes.ts");
    expect(src).toContain('sourceType: "snabborder"');
  });

  it("generiska skapande-routes defaultar utelämnad källa till manuell (aldrig NULL på nya rader)", () => {
    const wo = read("server/routes/workOrderRoutes.ts");
    expect(wo.match(/bodyData\.sourceType = "manuell"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const oc = read("server/routes/orderConceptRoutes.ts");
    expect(oc).toContain('bodyData.sourceType = "manuell"');
  });

  it("workOrderRoutes: PATCH /api/work-orders/:id strippar sourceType + orderConceptId", () => {
    const src = read("server/routes/workOrderRoutes.ts");
    expect(src).toContain("delete updateData.sourceType;");
    expect(src).toContain("delete updateData.orderConceptId;");
  });

  it("orderConceptRoutes: POST /api/assignments whitelistar sourceType och strippar orderConceptId", () => {
    const src = read("server/routes/orderConceptRoutes.ts");
    expect(src).toContain("CLIENT_ALLOWED_TASK_SOURCES.includes(bodyData.sourceType)");
    expect(src).toContain("delete bodyData.orderConceptId;");
  });

  it("orderConceptRoutes: PATCH /api/assignments/:id strippar sourceType + orderConceptId", () => {
    const src = read("server/routes/orderConceptRoutes.ts");
    expect(src).toContain("delete patchBody.sourceType;");
    expect(src).toContain("delete patchBody.orderConceptId;");
  });

  it("server-side stämpling finns för koncept-expansion, import och materialisering", () => {
    const fortnox = read("server/routes/fortnoxRoutes.ts");
    // 4 assignment-vägar + admin/logistik-WO stämplar "orderkoncept".
    const stamps = fortnox.match(/sourceType: "orderkoncept"/g)?.length ?? 0;
    expect(stamps).toBeGreaterThanOrEqual(5);

    const imports = read("server/routes/importRoutes.ts");
    expect(imports.match(/sourceType: "import"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);

    const mat = read("server/services/assignment-invoice-materializer.ts");
    expect(mat).toContain("sourceType: assignment.sourceType ??");

    // Ärende → ad-hoc orderkoncept (extendedRoutes) stämplar också.
    const ext = read("server/routes/extendedRoutes.ts");
    expect(ext).toContain('sourceType: "orderkoncept"');
  });

  it("ärende-/automatik-vägar stämplar felanmalan/automatisk och derivat ärver föräldern", () => {
    // Felanmälan/kundrapport/avvikelse → åtgärdsorder.
    expect(read("server/routes/portalRoutes.ts")).toContain('sourceType: "felanmalan"');
    expect(read("server/routes/extendedRoutes.ts")).toContain('sourceType: "felanmalan"');
    // Automatiska motorer.
    expect(read("server/routes/configRoutes.ts")).toContain('sourceType: "automatisk"');
    expect(read("server/routes/iotRoutes.ts")).toContain('sourceType: "automatisk"');
    expect(read("server/routes/annualGoalRoutes.ts")).toContain('sourceType: "automatisk"');
    expect(read("server/routes/predictiveRoutes.ts")).toContain('sourceType: "automatisk"');
    // Derivat/barn ärver förälderns ursprung + konceptreferens.
    expect(read("server/routes/orderConceptRoutes.ts")).toContain("sourceType: workOrder.sourceType");
    expect(read("server/ai-planner.ts")).toContain("sourceType: parentWorkOrder.sourceType");
    expect(read("server/routes/workOrderRoutes.ts")).toContain("sourceType: original.sourceType");
    expect(read("server/routes/mobile/orders.ts")).toContain("sourceType: order.sourceType");
    const fortnox = read("server/routes/fortnoxRoutes.ts");
    expect(fortnox).toContain("sourceType: mainWorkOrder.sourceType");
    expect(fortnox).toContain("sourceType: workOrder.sourceType");
  });

  it("storage-lagret strippar provenance-fälten i alla update-vägar", () => {
    const src = read("server/storage.ts");
    expect(src).toContain("delete updates.sourceType;");
    expect(src.match(/delete updates\.sourceType;/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(src.match(/delete updates\.orderConceptId;/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
