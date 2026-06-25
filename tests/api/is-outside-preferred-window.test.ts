import { describe, it, expect } from "vitest";
import {
  isOutsidePreferredWindow,
  EMPTY_DELIVERY_PREFERENCES,
  type DeliveryPreferences,
} from "@shared/schema";

// Task #1147: isOutsidePreferredWindow är konsumenten av de (nu testade)
// resolveDeliveryPreferences-värdena och driver flaggan outsidePreferredWindow i
// backend (workOrderRoutes.computePreferenceFlags) samt UI-förhandsvisningen. En
// tyst regression skulle felaktigt tillåta/blockera tider i planering och VRP.
// Funktionen är ren (ingen DB), så testerna anropar den direkt.
//
// OBS om prioritet: isOutsidePreferredWindow är medvetet priority-agnostisk —
// den avgör BARA om tiden bryter mot fönstret. Skillnaden mellan "strict" och
// "preferred" tillämpas av konsumenterna nedströms (optimization-job-runner.ts
// hård-blockerar vid strict, aiRoutes.ts varnar) baserat på prefs.priority.
// Testerna nedan låser fast att funktionen ger SAMMA resultat oavsett priority.

function prefs(overrides: Partial<DeliveryPreferences>): DeliveryPreferences {
  return { ...EMPTY_DELIVERY_PREFERENCES, ...overrides };
}

// 2026-06-22 är en måndag (weekday=1), 2026-06-24 en onsdag (weekday=3).
// Använd lokala konstruktorer (new Date(år, månadIndex, dag, timme, minut)) så att
// tester blir tidszonsoberoende — funktionen läser getDay()/getHours() lokalt.
const MONDAY = (h: number, m = 0) => new Date(2026, 5, 22, h, m);
const WEDNESDAY = (h: number, m = 0) => new Date(2026, 5, 24, h, m);

describe("isOutsidePreferredWindow — veckofönster", () => {
  const weekly = prefs({
    weeklyWindows: [{ weekday: 1, start: "08:00", end: "12:00" }],
  });

  it("returnerar false när tiden ligger helt inom veckofönstret", () => {
    expect(isOutsidePreferredWindow(weekly, MONDAY(9), MONDAY(11))).toBe(false);
  });

  it("returnerar false när tiden exakt fyller veckofönstret (gränsvärden)", () => {
    expect(isOutsidePreferredWindow(weekly, MONDAY(8), MONDAY(12))).toBe(false);
  });

  it("returnerar true när starten ligger före veckofönstret", () => {
    expect(isOutsidePreferredWindow(weekly, MONDAY(7), MONDAY(9))).toBe(true);
  });

  it("returnerar true när slutet sträcker sig efter veckofönstret", () => {
    expect(isOutsidePreferredWindow(weekly, MONDAY(11), MONDAY(13))).toBe(true);
  });

  it("returnerar false när det inte finns något fönster för veckodagen", () => {
    // Onsdag saknar fönster → ingen begränsning från weeklyWindows.
    expect(isOutsidePreferredWindow(weekly, WEDNESDAY(9), WEDNESDAY(11))).toBe(false);
  });

  it("godkänner tiden om den passar i NÅGOT av flera fönster samma dag", () => {
    const split = prefs({
      weeklyWindows: [
        { weekday: 1, start: "08:00", end: "10:00" },
        { weekday: 1, start: "13:00", end: "16:00" },
      ],
    });
    expect(isOutsidePreferredWindow(split, MONDAY(14), MONDAY(15))).toBe(false);
    // Mitt emellan fönstren (11–12) passar inget → utanför.
    expect(isOutsidePreferredWindow(split, MONDAY(11), MONDAY(12))).toBe(true);
  });
});

describe("isOutsidePreferredWindow — blockerade timmar", () => {
  it("returnerar true när tiden överlappar en blockerad timme (alla veckodagar)", () => {
    const p = prefs({ blockedHours: [{ start: "12:00", end: "13:00" }] });
    expect(isOutsidePreferredWindow(p, MONDAY(12, 30), MONDAY(12, 45))).toBe(true);
  });

  it("returnerar true vid delvis överlapp i kanten av blockerad timme", () => {
    const p = prefs({ blockedHours: [{ start: "12:00", end: "13:00" }] });
    // 11:30–12:30 nuddar 12:00-blocket.
    expect(isOutsidePreferredWindow(p, MONDAY(11, 30), MONDAY(12, 30))).toBe(true);
  });

  it("returnerar false när tiden ligger utanför blockerad timme", () => {
    const p = prefs({ blockedHours: [{ start: "12:00", end: "13:00" }] });
    expect(isOutsidePreferredWindow(p, MONDAY(13), MONDAY(14))).toBe(false);
  });

  it("respekterar weekdays-filtret på en blockerad timme", () => {
    // Blocket gäller bara onsdag (3) → måndag påverkas inte.
    const p = prefs({ blockedHours: [{ start: "12:00", end: "13:00", weekdays: [3] }] });
    expect(isOutsidePreferredWindow(p, MONDAY(12, 30), MONDAY(12, 45))).toBe(false);
    expect(isOutsidePreferredWindow(p, WEDNESDAY(12, 30), WEDNESDAY(12, 45))).toBe(true);
  });
});

describe("isOutsidePreferredWindow — blockerade datum", () => {
  it("returnerar true när startdatumet är blockerat", () => {
    const p = prefs({ blockedDates: ["2026-06-22"] });
    expect(isOutsidePreferredWindow(p, MONDAY(9), MONDAY(11))).toBe(true);
  });

  it("returnerar false för ett datum som inte är blockerat", () => {
    const p = prefs({ blockedDates: ["2026-06-22"] });
    expect(isOutsidePreferredWindow(p, WEDNESDAY(9), WEDNESDAY(11))).toBe(false);
  });

  it("blockerar datumet även om tiden ligger inom ett giltigt veckofönster", () => {
    const p = prefs({
      weeklyWindows: [{ weekday: 1, start: "08:00", end: "12:00" }],
      blockedDates: ["2026-06-22"],
    });
    expect(isOutsidePreferredWindow(p, MONDAY(9), MONDAY(11))).toBe(true);
  });
});

describe("isOutsidePreferredWindow — tomma/null-preferenser", () => {
  it("returnerar false för null prefs", () => {
    expect(isOutsidePreferredWindow(null, MONDAY(9), MONDAY(11))).toBe(false);
  });

  it("returnerar false för undefined prefs", () => {
    expect(isOutsidePreferredWindow(undefined, MONDAY(9), MONDAY(11))).toBe(false);
  });

  it("returnerar false för tomma preferenser (inga fönster/block)", () => {
    expect(isOutsidePreferredWindow(EMPTY_DELIVERY_PREFERENCES, MONDAY(9), MONDAY(11))).toBe(false);
  });

  it("returnerar false när windowStart saknas", () => {
    const p = prefs({ weeklyWindows: [{ weekday: 1, start: "08:00", end: "12:00" }] });
    expect(isOutsidePreferredWindow(p, null, null)).toBe(false);
    expect(isOutsidePreferredWindow(p, undefined, undefined)).toBe(false);
  });

  it("returnerar false för ogiltigt datum-input", () => {
    const p = prefs({ weeklyWindows: [{ weekday: 1, start: "08:00", end: "12:00" }] });
    expect(isOutsidePreferredWindow(p, "inte-ett-datum", null)).toBe(false);
  });
});

describe("isOutsidePreferredWindow — strict vs preferred (priority-agnostisk)", () => {
  // Funktionen ska ge identiskt resultat oavsett priority; prioriteten används
  // bara av konsumenterna för att bestämma hård blockering vs mjuk varning.
  const inside = (priority: "preferred" | "strict") =>
    isOutsidePreferredWindow(
      prefs({ weeklyWindows: [{ weekday: 1, start: "08:00", end: "12:00" }], priority }),
      MONDAY(9),
      MONDAY(11),
    );
  const outside = (priority: "preferred" | "strict") =>
    isOutsidePreferredWindow(
      prefs({ weeklyWindows: [{ weekday: 1, start: "08:00", end: "12:00" }], priority }),
      MONDAY(13),
      MONDAY(14),
    );

  it("flaggar tid inom fönstret som ok för både preferred och strict", () => {
    expect(inside("preferred")).toBe(false);
    expect(inside("strict")).toBe(false);
  });

  it("flaggar tid utanför fönstret som utanför för både preferred och strict", () => {
    expect(outside("preferred")).toBe(true);
    expect(outside("strict")).toBe(true);
  });

  it("ger samma resultat oavsett priority (ingen priority-beroende gren)", () => {
    expect(inside("preferred")).toBe(inside("strict"));
    expect(outside("preferred")).toBe(outside("strict"));
  });
});

describe("isOutsidePreferredWindow — ISO-sträng-input", () => {
  it("hanterar ISO-strängar för windowStart/windowEnd", () => {
    const p = prefs({ weeklyWindows: [{ weekday: 1, start: "08:00", end: "12:00" }] });
    // Bygg ISO-strängar från lokala Date så testet förblir tidszonsoberoende.
    const startInside = MONDAY(9).toISOString();
    const endInside = MONDAY(11).toISOString();
    expect(isOutsidePreferredWindow(p, startInside, endInside)).toBe(false);

    const startOutside = MONDAY(13).toISOString();
    const endOutside = MONDAY(14).toISOString();
    expect(isOutsidePreferredWindow(p, startOutside, endOutside)).toBe(true);
  });
});
