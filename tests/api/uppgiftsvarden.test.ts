import { describe, expect, it } from "vitest";
import {
  createUppgiftsvarden,
  freezeUppgiftsvarden,
  distributeActualMinutes,
  assertUppgiftQuantity,
  updateOpenUppgiftsvarden,
} from "@shared/uppgiftsvarden";

describe("uppgiftsvarden (Task #131)", () => {
  const source = { antal: 1, tidMinuter: 20, vardeOre: 10_000 };
  const revised = { antal: 3, tidMinuter: 75, vardeOre: 36_000 };

  it("bevarar källa/plan men uppdaterar öppet värde", () => {
    const initial = createUppgiftsvarden(source, "2026-01-01T00:00:00.000Z");
    const updated = updateOpenUppgiftsvarden(initial, revised, "2026-01-02T00:00:00.000Z");
    expect(updated.kallaLive).toMatchObject(source);
    expect(updated.planerat).toMatchObject(source);
    expect(updated.uppdaterat).toMatchObject(revised);
  });

  it("överlever JSON-omladdning och är immutable efter frysning", () => {
    const open = updateOpenUppgiftsvarden(
      createUppgiftsvarden(source, "2026-01-01T00:00:00.000Z"),
      revised,
      "2026-01-02T00:00:00.000Z",
    );
    const reloaded = JSON.parse(JSON.stringify(open));
    const frozen = freezeUppgiftsvarden(
      reloaded,
      revised,
      { antal: 3, tidMinuter: 37, vardeOre: 36_000 },
      revised,
      "2026-01-03T00:00:00.000Z",
    );
    const afterLiveDrift = updateOpenUppgiftsvarden(
      frozen,
      { antal: 9, tidMinuter: 891, vardeOre: 891_000 },
      "2026-01-04T00:00:00.000Z",
    );
    expect(afterLiveDrift).toBe(frozen);
    expect(afterLiveDrift.frystSnapshot).toMatchObject(revised);
    expect(afterLiveDrift.faktisktUtfall).toMatchObject({ antal: 3, tidMinuter: 37 });
    expect(afterLiveDrift.fakturerbart).toMatchObject(revised);
    // Idempotent winner: ett senare freeze-försök kan inte ersätta historiken.
    expect(freezeUppgiftsvarden(
      frozen,
      { antal: 9, tidMinuter: 9, vardeOre: 9 },
      { antal: 9, tidMinuter: 9, vardeOre: 9 },
      { antal: 9, tidMinuter: 9, vardeOre: 9 },
      "2026-01-05T00:00:00.000Z",
    )).toBe(frozen);
  });
});

describe("distributeActualMinutes", () => {
  it("använder kumulativ avrundning: aldrig negativt och exakt totalsumma", () => {
    const parts = distributeActualMinutes(2, [1, 1, 1, 1, 1]);
    expect(parts.every((part) => part >= 0)).toBe(true);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(2);
  });

  it("lägger hela utfallet på sista raden när alla planvikter är noll", () => {
    expect(distributeActualMinutes(7, [0, 0, 0])).toEqual([0, 0, 7]);
  });
});

describe("uppgiftsantal", () => {
  it("accepterar noll och heltal men avvisar negativa och decimala antal", () => {
    expect(() => assertUppgiftQuantity(0)).not.toThrow();
    expect(() => assertUppgiftQuantity(3)).not.toThrow();
    expect(() => assertUppgiftQuantity(-1)).toThrow(/icke-negativt heltal/);
    expect(() => assertUppgiftQuantity(1.5)).toThrow(/icke-negativt heltal/);
  });
});