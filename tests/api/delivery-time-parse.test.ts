import { describe, it, expect } from "vitest";
import { parseDeliveryDate } from "../../server/routes/fortnoxRoutes";

// Task #910: enhetstest för parseDeliveryDate (Task #901 B8). Parsern tolkar ett
// metadatavärde till ett leveransdatum vid orderkoncept-expansion. Den får ENBART
// acceptera Date-instanser och datum-/datetime-strängar; allt annat (nummer,
// boolean, null, skräp) måste ge null så att /execute kan falla tillbaka på det
// schemalagda datumet utan att krascha.
describe("parseDeliveryDate (Task #901 B8)", () => {
  it("accepterar en giltig Date-instans oförändrad", () => {
    const d = new Date("2026-08-15T10:30:00Z");
    expect(parseDeliveryDate(d)).toBe(d);
  });

  it("avvisar en Invalid Date", () => {
    expect(parseDeliveryDate(new Date("inte-ett-datum"))).toBeNull();
  });

  it("tolkar en ISO-sträng", () => {
    const result = parseDeliveryDate("2026-08-15T10:30:00Z");
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2026-08-15T10:30:00.000Z");
  });

  it('tolkar "YYYY-MM-DD HH:mm" (mellanslag normaliseras till T)', () => {
    const result = parseDeliveryDate("2026-08-15 10:30");
    expect(result).toBeInstanceOf(Date);
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(7); // augusti (0-indexerat)
    expect(result?.getDate()).toBe(15);
    expect(result?.getHours()).toBe(10);
    expect(result?.getMinutes()).toBe(30);
  });

  it('tolkar "YYYY-MM-DD HH:mm:ss"', () => {
    const result = parseDeliveryDate("2026-08-15 10:30:45");
    expect(result).toBeInstanceOf(Date);
    expect(result?.getSeconds()).toBe(45);
  });

  it("tolkar ett rent datum (YYYY-MM-DD) som midnatt i Europe/Stockholm", () => {
    // Task #911: datum-only förankras till lokal midnatt i Europe/Stockholm,
    // inte UTC-midnatt. I augusti (CEST, UTC+2) blir det 22:00 UTC dagen innan.
    const result = parseDeliveryDate("2026-08-15");
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2026-08-14T22:00:00.000Z");
    const stockholm = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Stockholm",
      dateStyle: "short",
      timeStyle: "short",
    }).format(result!);
    expect(stockholm).toBe("2026-08-15 00:00");
  });

  it("trimmar omgivande blanksteg", () => {
    const result = parseDeliveryDate("  2026-08-15  ");
    expect(result).toBeInstanceOf(Date);
    expect(result?.getUTCFullYear()).toBe(2026);
  });

  it("ger null för tom sträng", () => {
    expect(parseDeliveryDate("")).toBeNull();
    expect(parseDeliveryDate("   ")).toBeNull();
  });

  it("ger null för skräpsträng", () => {
    expect(parseDeliveryDate("inte-ett-datum")).toBeNull();
    expect(parseDeliveryDate("abc123")).toBeNull();
  });

  it("avvisar nummer (skulle annars tolkas som epoch-skräp)", () => {
    expect(parseDeliveryDate(0)).toBeNull();
    expect(parseDeliveryDate(1734000000000)).toBeNull();
    expect(parseDeliveryDate(2026)).toBeNull();
  });

  it("avvisar boolean", () => {
    expect(parseDeliveryDate(true)).toBeNull();
    expect(parseDeliveryDate(false)).toBeNull();
  });

  it("ger null för null och undefined", () => {
    expect(parseDeliveryDate(null)).toBeNull();
    expect(parseDeliveryDate(undefined)).toBeNull();
  });

  it("avvisar objekt och arrayer", () => {
    expect(parseDeliveryDate({})).toBeNull();
    expect(parseDeliveryDate([])).toBeNull();
    expect(parseDeliveryDate({ date: "2026-08-15" })).toBeNull();
  });
});
