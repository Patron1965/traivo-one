import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Guardrail för Task #1514: kund↔objekt-integritet i POST /api/work-orders/with-lines.
// När klienten explicit anger BÅDE customerId och objectId måste objektets
// auktoritativa kund (primär betalare i object_payers, via
// getObjectPrimaryCustomerId — ALDRIG raw-objektets customerId som är ett
// read-model-overlay och inte ifyllt av storage.getObject) matcha den valda
// kunden. Annars kan en planerare skapa en order fakturerad kund B mot
// kund A:s objekt.
//
// Statisk guardrail (samma stil som task-source-immutability): tas raderna
// bort ur routen regressar testet.

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("snabborder kund↔objekt-integritet (Task #1514)", () => {
  const src = read("server/routes/workOrderRoutes.ts");
  // Isolera with-lines-routens kropp (fram till nästa route-registrering).
  const start = src.indexOf('"/api/work-orders/with-lines"');
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.indexOf("app.", 10);
  const routeBody = rest.slice(0, end === -1 ? undefined : end);

  it("with-lines validerar objektets primära betalare mot explicit angiven kund", () => {
    expect(routeBody).toContain("getObjectPrimaryCustomerId");
    expect(routeBody).toContain("primaryCustomerId !== data.customerId");
    expect(routeBody).toContain("Objektet tillhör inte den valda kunden");
  });

  it("kontrollen gate:as på att klienten själv skickade customerId (intern-kund-fallback undantas)", () => {
    expect(routeBody).toContain("parsedBody.data.workOrder.customerId");
  });

  it("kontrollen läser INTE raw-objektets customerId-overlay", () => {
    // Matcha bara integritetsblocket: obj.customerId får inte användas i villkoret.
    expect(routeBody).not.toMatch(/obj\.customerId\s*!==\s*data\.customerId/);
  });

  it("objekt utan primär betalare avvisas inte (null ⇒ ingen mismatch)", () => {
    // Villkoret kräver truthy primaryCustomerId före jämförelsen.
    expect(routeBody).toMatch(/primaryCustomerId\s*&&\s*primaryCustomerId\s*!==\s*data\.customerId/);
  });
});
