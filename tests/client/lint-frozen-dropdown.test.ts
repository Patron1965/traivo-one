/**
 * Regressionstester för del 2 av "frusen knapp"-vakten:
 * findSyncOpenCall ska flagga set*Open(true) som körs synkront i en
 * onSelect-handler, och släppa igenom öppningar som är strukturellt
 * uppskjutna via setTimeout.
 */
import { describe, it, expect } from "vitest";
import {
  findSyncOpenCall,
  blankCommentsAndStrings,
  findBalancedBraceEnd,
  checkSyncOpenInRegion,
} from "../../scripts/lint-frozen-dropdown-dialog";

describe("findSyncOpenCall", () => {
  it("flaggar synkron set*Open(true)", () => {
    expect(findSyncOpenCall("() => setFooOpen(true)")).toBe("setFooOpen(true)");
  });

  it("släpper igenom korrekt uppskjuten öppning", () => {
    expect(
      findSyncOpenCall("() => setTimeout(() => setFooOpen(true), 0)"),
    ).toBeNull();
  });

  it("flaggar synkron öppning trots orelaterad tidigare setTimeout", () => {
    expect(
      findSyncOpenCall(
        "() => { setTimeout(() => track(), 0); setDialogOpen(true); }",
      ),
    ).toBe("setDialogOpen(true)");
  });

  it("flaggar synkron öppning trots setTimeout i kommentar", () => {
    expect(
      findSyncOpenCall("() => { /* setTimeout */ setDialogOpen(true); }"),
    ).toBe("setDialogOpen(true)");
  });

  it("flaggar synkron öppning trots setTimeout i sträng", () => {
    expect(
      findSyncOpenCall('() => { log("setTimeout("); setDialogOpen(true); }'),
    ).toBe("setDialogOpen(true)");
  });

  it("släpper igenom när synkron state sätts men open-flaggan skjuts upp", () => {
    expect(
      findSyncOpenCall(
        "() => { setItemToDelete(item); setTimeout(() => setConfirmOpen(true), 0); }",
      ),
    ).toBeNull();
  });

  it('ignorerar "set*Open(true)" inuti en sträng', () => {
    expect(findSyncOpenCall('() => log("setFooOpen(true)")')).toBeNull();
  });
});

describe("blankCommentsAndStrings", () => {
  it("blankar kommentarer och strängar men bevarar index", () => {
    const src = 'a; // setTimeout(\nb("setTimeout("); /* x */ c;';
    const out = blankCommentsAndStrings(src);
    expect(out.length).toBe(src.length);
    expect(out).not.toContain("setTimeout");
    expect(out.indexOf("c;")).toBe(src.indexOf("c;"));
  });
});

describe("findBalancedBraceEnd", () => {
  it("räknar inte } inuti strängar", () => {
    const src = '{() => { log("}"); setDialogOpen(true); }}rest';
    expect(src.slice(0, findBalancedBraceEnd(src, 0))).toBe(
      '{() => { log("}"); setDialogOpen(true); }}',
    );
  });

  it("räknar inte } inuti blockkommentarer", () => {
    const src = "{() => { /* } */ setDialogOpen(true); }}rest";
    expect(src.slice(0, findBalancedBraceEnd(src, 0))).toBe(
      "{() => { /* } */ setDialogOpen(true); }}",
    );
  });
});

function regionViolations(jsx: string) {
  const violations: Array<{ evidence: string; kind: string }> = [];
  checkSyncOpenInRegion(jsx, 0, jsx.length, "test.tsx", violations as any);
  return violations;
}

describe("checkSyncOpenInRegion (regionnivå)", () => {
  it("flaggar synkron öppning trots } i sträng före settern", () => {
    const jsx = `<DropdownMenuContent>
      <DropdownMenuItem onSelect={() => { log("}"); setDialogOpen(true); }}>x</DropdownMenuItem>
    </DropdownMenuContent>`;
    expect(regionViolations(jsx).map((v) => v.evidence)).toEqual([
      "setDialogOpen(true)",
    ]);
  });

  it("flaggar synkron öppning trots blockkommentar med } före settern", () => {
    const jsx = `<DropdownMenuContent>
      <DropdownMenuItem onSelect={() => { /* } */ setDialogOpen(true); }}>x</DropdownMenuItem>
    </DropdownMenuContent>`;
    expect(regionViolations(jsx)).toHaveLength(1);
  });

  it("släpper igenom uppskjuten öppning på regionnivå", () => {
    const jsx = `<DropdownMenuContent>
      <DropdownMenuItem onSelect={() => setTimeout(() => setDialogOpen(true), 0)}>x</DropdownMenuItem>
    </DropdownMenuContent>`;
    expect(regionViolations(jsx)).toHaveLength(0);
  });

  it("respekterar allow-kommentar på onSelect-raden", () => {
    const jsx = `<DropdownMenuContent>
      {/* lint-allow-modal-dropdown */}
      <DropdownMenuItem onSelect={() => setDialogOpen(true)}>x</DropdownMenuItem>
    </DropdownMenuContent>`;
    expect(regionViolations(jsx)).toHaveLength(0);
  });
});

describe("findSyncOpenCall — setter som setTimeout-ARGUMENT är synkron", () => {
  it("flaggar setTimeout(setDialogOpen(true), 0) — argumentet evalueras direkt", () => {
    expect(
      findSyncOpenCall("() => setTimeout(setDialogOpen(true), 0)"),
    ).toBe("setDialogOpen(true)");
  });

  it("flaggar villkorsuttryck som kör settern vid argumentutvärdering", () => {
    expect(
      findSyncOpenCall(
        "() => setTimeout(cond ? setDialogOpen(true) : noop, 0)",
      ),
    ).toBe("setDialogOpen(true)");
  });

  it("flaggar setter i setTimeouts ANDRA argument", () => {
    expect(
      findSyncOpenCall("() => setTimeout(() => track(), delayFor(setDialogOpen(true)))"),
    ).toBe("setDialogOpen(true)");
  });

  it("släpper igenom function-expression som callback", () => {
    expect(
      findSyncOpenCall("() => setTimeout(function () { setDialogOpen(true); }, 0)"),
    ).toBeNull();
  });

  it("flaggar wrappad callback — setTimeout(wrap(() => setXOpen(true)), 0)", () => {
    expect(
      findSyncOpenCall("() => setTimeout(wrap(() => setDialogOpen(true)), 0)"),
    ).toBe("setDialogOpen(true)");
  });

  it("flaggar setter i template-interpolation", () => {
    expect(
      findSyncOpenCall("() => log(`state: ${setDialogOpen(true)}`)"),
    ).toBe("setDialogOpen(true)");
  });

  it("släpper igenom nästlad arrow inuti setTimeout-callbacken", () => {
    expect(
      findSyncOpenCall(
        "() => setTimeout(() => { items.forEach(() => setDialogOpen(true)); }, 0)",
      ),
    ).toBeNull();
  });
});
