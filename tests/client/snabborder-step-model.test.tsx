import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, render, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SnabborderPage from "@/pages/SnabborderPage";

// Task #1523: Snabbordern (Task #1522) visar steg 1+2 som EN gemensam
// redigeringssida. Dessa tester låser stegmodellen så att stegindikatorn,
// "Tillbaka" från Bekräfta och återupptagna utkast (localStorage-nyckeln
// snabborder-utkast-v1) aldrig hamnar i osynk med vad som faktiskt renderas.

const DRAFT_STORAGE_KEY = "snabborder-utkast-v1";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <SnabborderPage />
    </QueryClientProvider>,
  );
}

/** Ett utkast i samma form som sidan sparar (DraftState). */
function makeDraft(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    step: 1,
    customer: { id: "cust-1", name: "Testkund AB", customerNumber: "K100" },
    deliveryDate: "",
    deliveryTimeFrom: "",
    deliveryTimeTo: "",
    kundreferens: "",
    varReferens: "",
    fakturaref1: "",
    fakturaref2: "",
    ovrigReferens: "",
    fakturatext: "",
    internKommentar: "",
    principle: "objekt",
    adressrad1: "",
    adressrad2: "",
    postnummer: "",
    ort: "",
    land: "Sverige",
    groups: [
      {
        id: "__order-level__",
        objectId: null,
        label: "Orderrad (utan objekt)",
        lines: [
          {
            id: "line-1",
            articleId: "art-1",
            label: "Testartikel",
            articleNumber: "A-1",
            unit: "st",
            listPriceOre: 10000,
            description: "",
            unitPriceKr: 0,
            quantity: 1,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function seedDraft(overrides: Partial<Record<string, unknown>> = {}) {
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(makeDraft(overrides)));
}

function resumeDraft(utils: ReturnType<typeof renderPage>) {
  const { getByTestId } = utils;
  fireEvent.click(within(getByTestId("banner-snabborder-draft")).getByTestId("button-resume-draft"));
}

/** Redigeringssidan (steg 1+2) känns igen på orderbyggarens tabellhuvud. */
function expectEditPage(utils: ReturnType<typeof renderPage>) {
  expect(utils.getByTestId("orderbuilder-table-header")).toBeTruthy();
  expect(utils.getByTestId("button-next-step3")).toBeTruthy();
  expect(utils.queryByTestId("button-back-step2")).toBeNull();
}

/** Bekräfta-läget (steg 3) känns igen på Tillbaka-knappen. */
function expectConfirmPage(utils: ReturnType<typeof renderPage>) {
  expect(utils.getByTestId("button-back-step2")).toBeTruthy();
  expect(utils.queryByTestId("orderbuilder-table-header")).toBeNull();
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/snabborder");
});

afterEach(() => cleanup());

describe("Snabborder — stegvisning (steg 1+2 = en gemensam redigeringssida)", () => {
  it("visar redigeringssidan initialt och klick på steg 1/2 behåller den", () => {
    const utils = renderPage();
    expectEditPage(utils);

    fireEvent.click(utils.getByTestId("step-1"));
    expectEditPage(utils);

    fireEvent.click(utils.getByTestId("step-2"));
    expectEditPage(utils);
  });

  it("spärrar steg 3 tills orderhuvud + innehåll är giltiga", () => {
    const utils = renderPage();
    const step3 = utils.getByTestId("step-3") as HTMLButtonElement;
    expect(step3.disabled).toBe(true);

    // Klick på spärrat steg 3 får inte byta vy.
    fireEvent.click(step3);
    expectEditPage(utils);

    // "Nästa: Bekräfta" är spärrad av samma villkor.
    expect((utils.getByTestId("button-next-step3") as HTMLButtonElement).disabled).toBe(true);
  });

  it("öppnar steg 3 när utkastet är giltigt (kund + princip + rad)", () => {
    seedDraft();
    const utils = renderPage();
    resumeDraft(utils);

    const step3 = utils.getByTestId("step-3") as HTMLButtonElement;
    expect(step3.disabled).toBe(false);
    fireEvent.click(step3);
    expectConfirmPage(utils);
  });

  it("håller steg 3 spärrat när innehåll saknas trots giltigt orderhuvud", () => {
    seedDraft({
      groups: [{ id: "__order-level__", objectId: null, label: "Orderrad (utan objekt)", lines: [] }],
    });
    const utils = renderPage();
    resumeDraft(utils);

    expect((utils.getByTestId("step-3") as HTMLButtonElement).disabled).toBe(true);
    expectEditPage(utils);
  });

  it("'Tillbaka' från Bekräfta återgår till redigeringssidan", () => {
    seedDraft({ step: 3 });
    const utils = renderPage();
    resumeDraft(utils);
    expectConfirmPage(utils);

    fireEvent.click(utils.getByTestId("button-back-step2"));
    expectEditPage(utils);
  });

  it("klick på steg 1 eller 2 från Bekräfta återgår till redigeringssidan", () => {
    seedDraft({ step: 3 });
    const utils = renderPage();
    resumeDraft(utils);
    expectConfirmPage(utils);

    fireEvent.click(utils.getByTestId("step-2"));
    expectEditPage(utils);

    fireEvent.click(utils.getByTestId("step-3"));
    expectConfirmPage(utils);
    fireEvent.click(utils.getByTestId("step-1"));
    expectEditPage(utils);
  });
});

describe("Snabborder — utkast-normalisering (snabborder-utkast-v1)", () => {
  it("normaliserar gammalt utkast med step=2 till redigeringsläget", () => {
    seedDraft({ step: 2 });
    const utils = renderPage();
    resumeDraft(utils);

    expectEditPage(utils);
    // Utkastets data är återställd (kunden visas i orderhuvudet).
    expect(within(utils.getByTestId("selected-customer")).getByText("Testkund AB")).toBeTruthy();
  });

  it("återupptar utkast med step=3 direkt i Bekräfta-läget", () => {
    seedDraft({ step: 3 });
    const utils = renderPage();
    resumeDraft(utils);
    expectConfirmPage(utils);
  });

  it("normaliserar saknat/ogiltigt step-värde till redigeringsläget", () => {
    seedDraft({ step: undefined });
    const utils = renderPage();
    resumeDraft(utils);
    expectEditPage(utils);
  });
});
