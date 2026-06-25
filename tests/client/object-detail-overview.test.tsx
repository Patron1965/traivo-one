import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/hooks/use-language";
import ObjectDetailPage from "@/pages/ObjectDetailPage";
import { getQueryFn } from "@/lib/queryClient";

// Task #1134: e2e/runTest-rökning av den nya en-sidiga Objektöversikten (#1128)
// blockeras av appens externa Replit-OAuth-consent (se memory
// `testing-replit-auth-blocked.md`). Denna jsdom-integrationstest monterar hela
// sidan med mockad fetch och låser navigeringsbeteendet i stället: jump-nav
// scrollar till rätt sektion, "Avancerat" öppnas via nav och ?tab, header-pennan
// scrollar till hierarki-sektionen, sticky-nav-klassen finns, och inga råa "{}"
// renderas.

const OBJECT_ID = "obj-test-1134";

interface ResolvedObjectOverrides {
  [key: string]: unknown;
}

function makeResolvedObject(overrides: ResolvedObjectOverrides = {}) {
  return {
    id: OBJECT_ID,
    name: "Testobjekt 1134",
    objectNumber: "OBJ-1134",
    status: "active",
    address: "Testgatan 1",
    postalCode: "12345",
    city: "Teststad",
    // Avsiktligt inga koordinater → MapContainer (react-leaflet) renderas inte i jsdom.
    latitude: null,
    longitude: null,
    parentId: null,
    inheritanceSources: [],
    ...overrides,
  };
}

const USER = {
  id: "user-1",
  email: "tester@example.com",
  role: "admin",
  accessGranted: true,
  tenantId: "tenant-1",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Mockad fetch som svarar per URL. Sidan blandar default-fetchern (queryClient)
 * och flera egna `queryFn` med rå `fetch`, så vi måste täcka global fetch.
 */
function installFetchMock(resolved: ReturnType<typeof makeResolvedObject>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    // OBS: matcha objektets resolve-endpoint EXAKT (slutar på "/resolved")
    // så att "resolved-invoice-recipient" inte fångas av misstag.
    if (/\/resolved(\?|$)/.test(url)) return jsonResponse(resolved);
    if (url.includes("resolved-invoice-recipient")) {
      return jsonResponse({ recipient: null, chain: [], conflicts: [] });
    }
    if (url.includes("/api/auth/user")) return jsonResponse(USER);
    // available-types ligger under /api/metadata/objects/ men returnerar en lista,
    // så den måste matchas FÖRE metadata-objektsvaret (som är ett objekt).
    if (url.includes("/available-types")) return jsonResponse([]);
    if (url.includes("/display-names")) {
      return jsonResponse({ primary: "", chains: [], rulesEnabled: true });
    }
    if (url.includes("/api/metadata/objects/")) return jsonResponse({ metadata: [] });
    if (url.includes("/system-generated-metadata")) {
      return jsonResponse({
        address: { gatuadress: null, postnummer: null, ort: null },
        position: {
          latitude: null,
          longitude: null,
          entranceLatitude: null,
          entranceLongitude: null,
          locationType: null,
          geocoded: false,
          what3words: null,
        },
        pointedInConcepts: [],
        tasksHistory: [],
        tasksFuture: [],
        images: [],
        issueReports: [],
        ratings: [],
      });
    }
    if (url.includes("/api/system/map-config")) {
      return jsonResponse({
        tileUrl: "https://example.test/{z}/{x}/{y}.png",
        attribution: "test",
        maxZoom: 19,
      });
    }
    if (url.includes("/api/customers/")) return jsonResponse({ id: "cust-1", name: "Kund AB" });
    // Allt annat (descendants, ancestors, work-orders, assignments, contacts,
    // images, restrictions m.fl.) returnerar en tom lista.
    return jsonResponse([]);
  });
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        // Använd appens riktiga default-fetcher så att queries utan egen
        // queryFn (t.ex. system-generated-metadata) routas genom vår
        // URL-baserade fetch-mock med rätt svarsform.
        queryFn: getQueryFn({ on401: "returnNull" }),
      },
      mutations: { retry: false },
    },
  });
}

function renderObjectDetail(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <QueryClientProvider client={makeClient()}>
      <LanguageProvider>
        <TooltipProvider>
          <Router hook={hook}>
            <ObjectDetailPage />
          </Router>
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

/**
 * Fångar vilket sektions-id som senast scrollades till. scrollToSection() i sidan
 * anropar getElementById(`object-section-<key>`).scrollIntoView(); vi spionerar på
 * prototypen och läser av `this.id`.
 */
function installScrollSpy(): { lastScrolledId: () => string | null; ids: string[] } {
  const ids: string[] = [];
  const spy = vi
    .spyOn(Element.prototype, "scrollIntoView")
    .mockImplementation(function (this: Element) {
      if (this.id) ids.push(this.id);
    });
  return {
    lastScrolledId: () => (ids.length ? ids[ids.length - 1] : null),
    ids,
    // expose for cleanup via afterEach restoreAllMocks
    _spy: spy,
  } as any;
}

describe("ObjectDetailPage — översikt: navigering & sektioner", () => {
  let originalRAF: typeof requestAnimationFrame;

  beforeEach(() => {
    // scrollToSection() lindar icke-deep-tools-scroll i requestAnimationFrame.
    // Kör callbacken synkront så testerna slipper vänta på nästa frame.
    originalRAF = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
  });

  afterEach(() => {
    (globalThis as any).requestAnimationFrame = originalRAF;
    // ?tab-testet sätter jsdom-URL:en; nollställ så den inte läcker.
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    cleanup();
  });

  async function mountAndWaitForNav(path = `/objects/${OBJECT_ID}`) {
    installFetchMock(makeResolvedObject());
    const utils = renderObjectDetail(path);
    await waitFor(() => {
      expect(utils.queryByTestId("object-detail-section-nav")).toBeTruthy();
    });
    return utils;
  }

  it("renderar snabbnavigeringen som en sticky topbar", async () => {
    const { getByTestId } = await mountAndWaitForNav();
    const nav = getByTestId("object-detail-section-nav");
    expect(nav.className).toContain("sticky");
    expect(nav.className).toContain("top-0");
  });

  it("varje jump-nav-knapp scrollar till motsvarande sektion", async () => {
    const { getByTestId } = await mountAndWaitForNav();
    const scroll = installScrollSpy();

    const navToSection: Array<[string, string]> = [
      ["nav-overview", "object-section-overview"],
      ["nav-location", "object-section-location"],
      ["nav-access", "object-section-access"],
      ["nav-equipment", "object-section-equipment"],
      ["nav-hierarchy", "object-section-hierarchy"],
      ["nav-metadata", "object-section-metadata"],
      ["nav-contacts", "object-section-contacts"],
      ["nav-images", "object-section-images"],
      ["nav-info-packages", "object-section-info-packages"],
      ["nav-restrictions", "object-section-restrictions"],
    ];

    for (const [navId, sectionId] of navToSection) {
      // Sektionen måste finnas i DOM:en för att scrollas till.
      expect(document.getElementById(sectionId), `${sectionId} saknas i DOM`).toBeTruthy();
      fireEvent.click(getByTestId(navId));
      expect(scroll.lastScrolledId(), `${navId} scrollade inte till ${sectionId}`).toBe(sectionId);
    }
  });

  it("header-pennan (button-edit-parent) scrollar till hierarki-sektionen", async () => {
    const { getByTestId } = await mountAndWaitForNav();
    const scroll = installScrollSpy();
    fireEvent.click(getByTestId("button-edit-parent"));
    expect(scroll.lastScrolledId()).toBe("object-section-hierarchy");
  });

  it("'Avancerat'-navknappen öppnar deep-tools-collapsiblen och scrollar dit", async () => {
    const { getByTestId } = await mountAndWaitForNav();
    const scroll = installScrollSpy();

    // Collapsiblen är stängd från början → innehåll dolt.
    const toggle = getByTestId("button-toggle-deep-tools");
    expect(toggle.getAttribute("data-state")).toBe("closed");

    fireEvent.click(getByTestId("nav-deep-tools"));

    await waitFor(() => {
      expect(getByTestId("button-toggle-deep-tools").getAttribute("data-state")).toBe("open");
    });
    await waitFor(() => {
      expect(scroll.lastScrolledId()).toBe("object-section-deep-tools");
    });
  });

  it("?tab=ekonomi-djuplänk öppnar deep-tools automatiskt efter att objektet laddats", async () => {
    installFetchMock(makeResolvedObject());
    // ?tab-effekten läser window.location.search direkt (inte wouters
    // memory-location), så jsdom-URL:en måste sättas innan montering.
    window.history.replaceState(null, "", `/objects/${OBJECT_ID}?tab=ekonomi`);
    const { queryByTestId, getByTestId } = renderObjectDetail(
      `/objects/${OBJECT_ID}?tab=ekonomi`,
    );
    await waitFor(() => {
      expect(queryByTestId("object-detail-section-nav")).toBeTruthy();
    });
    await waitFor(() => {
      expect(getByTestId("button-toggle-deep-tools").getAttribute("data-state")).toBe("open");
    });
  });

  it("renderar inga råa tomma objekt ('{}') i översikten", async () => {
    const { container } = await mountAndWaitForNav();
    expect(container.textContent).not.toContain("{}");
    expect(container.textContent).not.toContain("[object Object]");
  });
});
