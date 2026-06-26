import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/hooks/use-language";
import PortalSettingsPage from "@/pages/portal/PortalSettingsPage";
import type { DeliveryPreferences } from "@shared/schema";

// Komponenttest för PortalObjectDeliveryPrefs (PortalSettingsPage).
// Leveranspreferenser är objekt-EGNA (ADR v3) — det finns INGET kund-arv. Detta
// test låser fast att objekt-editorn:
//   - ALLTID är redigerbar (ingen read-only, ingen "Ärvd från kund"-badge, ingen
//     ärvd-banner, ingen "Anpassa för objektet"-knapp) oavsett om objektet har
//     egna prefs eller ej
//   - visar ett tomt formulär när objektet saknar egna prefs
//   - visar objektets egna prefs när de finns
//
// OBS: sidan renderar TVÅ DeliveryPreferencesEditor (entityKind="portal"): en
// kund-nivå (renderas först) + en objekt-nivå (renderas sist, efter objekt-
// väljaren). Vi skopar därför asserts till den SISTA editorn (objekt-editorn).

const OBJECT_ID = "obj-portal-1146";

const OBJECT_OWN_PREFS: DeliveryPreferences = {
  weeklyWindows: [{ weekday: 2, start: "09:00", end: "12:00" }],
  blockedHours: [],
  blockedDates: [],
  notes: "Objektets egna anteckning",
  priority: "strict",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Mockad fetch som svarar per URL. Objekt-prefs-svaret styrs av `objectPrefs`
 * så samma rigg kan testa både tomt-formulär-läge och egna-prefs-läge. Svaret
 * innehåller ALDRIG någon `fallback` — den modellen finns inte längre.
 */
function installFetch(objectPrefs: { deliveryPreferences: DeliveryPreferences | null }) {
  (globalThis as any).fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes(`/api/portal/objects/${OBJECT_ID}/delivery-preferences`)) {
      return jsonResponse(objectPrefs);
    }
    if (url.endsWith("/api/portal/objects")) {
      return jsonResponse([{ id: OBJECT_ID, name: "Portalobjekt 1146", address: "Testgatan 1" }]);
    }
    if (url.includes("/api/portal/notification-settings")) {
      return jsonResponse({
        emailNotifications: true,
        smsNotifications: false,
        preferredContactEmail: "kund@test.local",
        preferredContactPhone: "",
      });
    }
    // Kund-nivå leveranspreferenser (separat editor) — inga egna prefs.
    if (url.includes("/api/portal/delivery-preferences")) {
      return jsonResponse({ deliveryPreferences: null });
    }
    return jsonResponse({});
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const { hook } = memoryLocation({ path: "/portal/settings" });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <TooltipProvider>
          <Router hook={hook}>
            <PortalSettingsPage />
          </Router>
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

/**
 * Väljer objektet och returnerar objekt-editorns rot-element. Objekt-editorn
 * renderas EFTER kund-editorn, så den är den sista "delivery-preferences-portal".
 */
async function selectObjectAndGetEditor(
  getByTestId: (id: string) => HTMLElement,
  getAllByTestId: (id: string) => HTMLElement[],
) {
  const select = await waitFor(() => {
    const el = getByTestId("select-portal-object") as HTMLSelectElement;
    if (!el.querySelector(`option[value="${OBJECT_ID}"]`)) throw new Error("option not ready");
    return el;
  });
  fireEvent.change(select, { target: { value: OBJECT_ID } });
  return waitFor(() => {
    const editors = getAllByTestId("delivery-preferences-portal");
    if (editors.length < 2) throw new Error("object editor not ready");
    return editors[editors.length - 1];
  });
}

describe("Portal-inställningar: objekt-egna leveranspreferenser (inget kund-arv)", () => {
  beforeEach(() => {
    localStorage.setItem("portal_session", "test-token-1146");
    localStorage.setItem(
      "portal_customer",
      JSON.stringify({ id: "cust-1146", name: "Testkund", email: "kund@test.local" }),
    );
    localStorage.setItem("portal_tenant", JSON.stringify({ id: "tenant-1146", name: "Testtenant" }));
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("visar ett redigerbart tomt formulär (ingen arv-badge/banner) när objektet saknar egna prefs", async () => {
    installFetch({ deliveryPreferences: null });
    const { getByTestId, getAllByTestId } = renderPage();

    const editor = await selectObjectAndGetEditor(getByTestId, getAllByTestId);
    const scoped = within(editor);

    // Alltid redigerbar: spara-knapp finns, fieldset ej disabled.
    expect(scoped.getByTestId("button-save-preferences")).toBeTruthy();
    expect(editor.querySelector("fieldset")?.hasAttribute("disabled")).toBe(false);

    // Tomt formulär: anteckningsfältet är tomt.
    expect((scoped.getByTestId("input-pref-notes") as HTMLTextAreaElement).value).toBe("");

    // Inga arv-artefakter kvar (borttagen modell).
    expect(scoped.queryByTestId("banner-inherited-prefs")).toBeNull();
    expect(scoped.queryByTestId("button-customize-preferences")).toBeNull();
    expect(scoped.queryByTestId("badge-portal-delivery-prefs-source")).toBeNull();
    expect(editor.textContent).not.toContain("Ärvd från kund");
  });

  it("visar objektets egna prefs i ett redigerbart formulär när de finns", async () => {
    installFetch({ deliveryPreferences: OBJECT_OWN_PREFS });
    const { getByTestId, getAllByTestId } = renderPage();

    const editor = await selectObjectAndGetEditor(getByTestId, getAllByTestId);
    const scoped = within(editor);

    // Redigerbar med spara-knapp, ingen arv-banner.
    expect(scoped.getByTestId("button-save-preferences")).toBeTruthy();
    expect(editor.querySelector("fieldset")?.hasAttribute("disabled")).toBe(false);
    expect(scoped.queryByTestId("banner-inherited-prefs")).toBeNull();

    // Objektets egna anteckning förifylls i formuläret.
    expect((scoped.getByTestId("input-pref-notes") as HTMLTextAreaElement).value).toBe(
      OBJECT_OWN_PREFS.notes,
    );
  });
});
