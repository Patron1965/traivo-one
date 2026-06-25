import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/hooks/use-language";
import PortalSettingsPage from "@/pages/portal/PortalSettingsPage";
import type { DeliveryPreferences } from "@shared/schema";

// Task #1146: komponenttest för PortalObjectDeliveryPrefs (PortalSettingsPage).
// Verifierar att portalen, när ett objekt saknar egna leveranspreferenser men
// kunden har, visar kundens fallback i READ-ONLY-läge med badgen "Ärvd från kund"
// — och att egna prefs i stället visar "Egen"-badge utan read-only.
//
// OBS: sidan renderar TVÅ DeliveryPreferencesEditor (entityKind="portal"): en
// kund-nivå + en objekt-nivå. Vi skopar därför alla asserts till objekt-editorn
// (kortet som innehåller objekt-väljaren + källbadgen) via `within`.

const OBJECT_ID = "obj-portal-1146";

const CUSTOMER_FALLBACK_PREFS: DeliveryPreferences = {
  weeklyWindows: [{ weekday: 1, start: "08:00", end: "16:00" }],
  blockedHours: [],
  blockedDates: [],
  notes: "Kundens ärvda anteckning",
  priority: "preferred",
};

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
 * så samma rigg kan testa både fallback-läge och egna-prefs-läge.
 */
function installFetch(objectPrefs: {
  deliveryPreferences: DeliveryPreferences | null;
  fallback?: DeliveryPreferences | null;
}) {
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
    // Kund-nivå leveranspreferenser (separat editor) — ingen egen prefs.
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

/** Väljer objektet och returnerar objekt-editorns rot-element (skopat). */
async function selectObjectAndGetEditor(getByTestId: (id: string) => HTMLElement) {
  const select = await waitFor(() => {
    const el = getByTestId("select-portal-object") as HTMLSelectElement;
    if (!el.querySelector(`option[value="${OBJECT_ID}"]`)) throw new Error("option not ready");
    return el;
  });
  fireEvent.change(select, { target: { value: OBJECT_ID } });
  // Objekt-editorn är den enda som innehåller källbadgen → använd den för att
  // hitta rätt editor-instans.
  return waitFor(() => {
    const badge = getByTestId("badge-portal-delivery-prefs-source");
    const editor = badge.closest('[data-testid="delivery-preferences-portal"]') as HTMLElement | null;
    if (!editor) throw new Error("object editor not ready");
    return editor;
  });
}

describe("Portal-inställningar: ärvda leveranspreferenser per objekt", () => {
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

  it("visar kundens fallback read-only med 'Ärvd från kund'-badge när objektet saknar egna prefs", async () => {
    installFetch({ deliveryPreferences: null, fallback: CUSTOMER_FALLBACK_PREFS });
    const { getByTestId } = renderPage();

    const editor = await selectObjectAndGetEditor(getByTestId);
    const scoped = within(editor);

    // "Ärvd från kund"-badge syns.
    expect(getByTestId("badge-portal-delivery-prefs-source").textContent).toContain("Ärvd från kund");
    // Read-only-banner finns i objekt-editorn.
    expect(scoped.getByTestId("banner-inherited-prefs")).toBeTruthy();
    // Read-only-läge: fieldset disabled, "Anpassa för objektet" istället för spara.
    expect(editor.querySelector("fieldset")?.hasAttribute("disabled")).toBe(true);
    expect(scoped.getByTestId("button-customize-preferences")).toBeTruthy();
    expect(scoped.queryByTestId("button-save-preferences")).toBeNull();
  });

  it("visar 'Egen'-badge utan read-only när objektet har egna prefs", async () => {
    installFetch({ deliveryPreferences: OBJECT_OWN_PREFS, fallback: CUSTOMER_FALLBACK_PREFS });
    const { getByTestId } = renderPage();

    const editor = await selectObjectAndGetEditor(getByTestId);
    const scoped = within(editor);

    expect(getByTestId("badge-portal-delivery-prefs-source").textContent).toContain("Egen");
    // Inte read-only: spara-knappen finns, fieldset ej disabled, ingen ärvd-banner.
    expect(scoped.getByTestId("button-save-preferences")).toBeTruthy();
    expect(editor.querySelector("fieldset")?.hasAttribute("disabled")).toBe(false);
    expect(scoped.queryByTestId("banner-inherited-prefs")).toBeNull();
  });
});
