import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Guardrail för Task #1538: objekt är ALDRIG kopplade till kund — kund gäller
// uppgiften; objektets kundinfo är enbart metadata (förslag i UI). Den gamla
// kund↔objekt-mismatch-spärren (Task #1514, "Objektet tillhör inte den valda
// kunden") är medvetet borttagen ur POST /api/work-orders/with-lines och får
// inte återinföras. Tenant-validering av kund- och objekt-id var för sig
// (ensureCustomerInTenant/ensureObjectInTenant) MÅSTE dock finnas kvar.
//
// Statisk guardrail (samma stil som task-source-immutability).

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("snabborder objekt/kund-frikoppling (Task #1538)", () => {
  const src = read("server/routes/workOrderRoutes.ts");
  // Isolera with-lines-routens kropp (fram till nästa route-registrering).
  const start = src.indexOf('"/api/work-orders/with-lines"');
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.indexOf("app.", 10);
  const routeBody = rest.slice(0, end === -1 ? undefined : end);

  it("with-lines blockerar INTE på objektets metadata-härledda kund", () => {
    expect(routeBody).not.toContain("Objektet tillhör inte den valda kunden");
    expect(routeBody).not.toContain("getObjectPrimaryCustomerId");
  });

  it("tenant-validering av kund och objekt kvarstår var för sig", () => {
    expect(routeBody).toContain("ensureCustomerInTenant(data.customerId, tenantId)");
    expect(routeBody).toContain("ensureObjectInTenant(data.objectId, tenantId)");
    expect(routeBody).toContain("ensureObjectNotArchived(obj)");
  });
});
