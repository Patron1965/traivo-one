import { describe, it, expect } from "vitest";
import { parseFormula, evaluateFormula } from "../../server/metadata-formula";

// Antalslogik (Antalskälla "Formel"): enhetstester för den säkra formelmotorn.
// parseFormula validerar syntaxen och returnerar refererade fältnamn (unika).
// evaluateFormula räknar ut resultatet mot ett namn->nummer-värdesmappning.
// Motorn kör ALDRIG godtycklig kod och felmeddelandena är på svenska.

describe("parseFormula", () => {
  it("läser fältnamn inom hakparenteser (mellanslag tillåtna)", () => {
    expect(parseFormula("[Antal kärl] * 2").refs).toEqual(["Antal kärl"]);
  });

  it("läser bara-identifierare utan hakparenteser", () => {
    expect(parseFormula("bredd * höjd").refs.sort()).toEqual(["bredd", "höjd"]);
  });

  it("returnerar unika referenser även vid upprepning", () => {
    expect(parseFormula("[Antal kärl] + [Antal kärl]").refs).toEqual(["Antal kärl"]);
  });

  it("returnerar tom referenslista för en ren konstant", () => {
    expect(parseFormula("2 * 3").refs).toEqual([]);
  });

  it("kastar svenskt fel för saknad höger-hakparentes", () => {
    expect(() => parseFormula("[Antal kärl * 2")).toThrowError(/hakparentes/i);
  });

  it("kastar svenskt fel för tomt fältnamn inom hakparenteser", () => {
    expect(() => parseFormula("[] * 2")).toThrowError(/Tomt fältnamn/i);
  });

  it("kastar fel för ogiltigt tecken", () => {
    expect(() => parseFormula("[a] % 2")).toThrowError(/Ogiltigt tecken/i);
  });

  it("kastar fel för ofullständig formel", () => {
    expect(() => parseFormula("[a] +")).toThrowError();
  });

  it("kastar fel för saknad högerparentes", () => {
    expect(() => parseFormula("([a] + 1")).toThrowError(/högerparentes/i);
  });
});

describe("evaluateFormula", () => {
  it("räknar ut hakparentes-referens mot värden", () => {
    expect(evaluateFormula("[Antal kärl] * 2", { "Antal kärl": 3 })).toBe(6);
  });

  it("respekterar operatorprecedens", () => {
    expect(evaluateFormula("a + b * c", { a: 2, b: 3, c: 4 })).toBe(14);
  });

  it("respekterar parenteser", () => {
    expect(evaluateFormula("(a + b) * c", { a: 2, b: 3, c: 4 })).toBe(20);
  });

  it("hanterar unärt minus", () => {
    expect(evaluateFormula("-a + 5", { a: 2 })).toBe(3);
  });

  it("hanterar decimaltal", () => {
    expect(evaluateFormula("a * 1.5", { a: 2 })).toBe(3);
  });

  it("kastar svenskt fel vid division med noll", () => {
    expect(() => evaluateFormula("a / 0", { a: 4 })).toThrowError(/Division med noll/i);
  });

  it("kastar fel för okänt fält", () => {
    expect(() => evaluateFormula("[Antal kärl] * 2", {})).toThrowError(/Okänt fält/i);
  });

  it("kastar fel när ett fält saknar numeriskt värde", () => {
    // @ts-expect-error medvetet icke-numeriskt värde för att testa skyddet
    expect(() => evaluateFormula("a + 1", { a: "x" })).toThrowError(/numeriskt/i);
  });
});
