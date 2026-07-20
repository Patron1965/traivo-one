/**
 * Regressionstest för vecko-synk karta ↔ rutnät (GrovplaneringPage).
 *
 * handleWeekChange skriver kartans veckoval till filtrets anchor som
 * "yyyy-MM-dd" och synk-effekten läser tillbaka det via new Date(anchor).
 * Roundtrippen får inte skifta vecka (off-by-one) för lokala midnatts-datum
 * (MapTimeline emittar startOfISOWeek/addDays = lokal midnatt).
 */
import { describe, expect, it } from "vitest";
import { addDays, format, isSameWeek, startOfISOWeek } from "date-fns";

/** Speglar serialiseringen i GrovplaneringPage.handleWeekChange. */
function anchorFromWeekChange(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Speglar synk-effekten (draft.anchor → weekRef). */
function weekRefFromAnchor(anchor: string): Date {
  return new Date(anchor);
}

describe("Grovplanering vecko-synk: anchor-roundtrip", () => {
  it("måndag (ISO-veckostart, lokal midnatt) behåller samma vecka efter roundtrip", () => {
    // Måndagar över årsskifte, DST-övergångar och mitt i året.
    const samples = [
      new Date(2026, 0, 5), // v.2 2026
      new Date(2026, 2, 30), // veckan efter DST-start (CEST)
      new Date(2026, 9, 26), // veckan efter DST-slut (CET)
      new Date(2026, 11, 28), // ISO-vecka 53/1-gränsen
    ];
    for (const base of samples) {
      const monday = startOfISOWeek(base);
      const anchor = anchorFromWeekChange(monday);
      const roundtripped = weekRefFromAnchor(anchor);
      expect(
        isSameWeek(roundtripped, monday, { weekStartsOn: 1 }),
        `anchor ${anchor} ska ligga i samma ISO-vecka som ${monday.toString()}`,
      ).toBe(true);
    }
  });

  it("dagval (lokal midnatt, varje veckodag) behåller sin kalenderdag i anchor", () => {
    const monday = startOfISOWeek(new Date(2026, 6, 20));
    for (let i = 0; i < 7; i++) {
      const day = addDays(monday, i);
      expect(anchorFromWeekChange(day)).toBe(format(day, "yyyy-MM-dd"));
      // Aldrig UTC-serialisering: i CET/CEST skiftar toISOString lokal
      // midnatt till föregående dag — det får inte hända för anchor.
      if (day.getTimezoneOffset() < 0) {
        expect(anchorFromWeekChange(day)).not.toBe(day.toISOString().slice(0, 10));
      }
    }
  });
});
