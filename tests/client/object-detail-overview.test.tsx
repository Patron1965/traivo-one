import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/hooks/use-language";
import ObjectDetailPage from "@/pages/ObjectDetailPage";
import { ObjectMetadataBody } from "@/components/objects/ObjectMetadataBody";
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

  // Objektvyn är omstrukturerad (Etapp 5) till en snabbmeny
  // ("object-detail-quicknav") och tre ankarsektioner: huvud, metadata och
  // linked-tasks. De gamla testerna mot sticky-nav/deep-tools/"Objektfält
  // (under migrering)" är ersatta nedan — de ytorna finns inte längre.
  async function mountAndWaitForNav(path = `/objects/${OBJECT_ID}`) {
    installFetchMock(makeResolvedObject());
    const utils = renderObjectDetail(path);
    await waitFor(() => {
      expect(utils.queryByTestId("object-detail-quicknav")).toBeTruthy();
    });
    return utils;
  }

  it("renderar snabbmenyn och de tre ankarsektionerna", async () => {
    await mountAndWaitForNav();
    for (const id of [
      "object-section-huvud",
      "object-section-metadata",
      "object-section-linked-tasks",
    ]) {
      expect(document.getElementById(id), `${id} saknas i DOM`).toBeTruthy();
    }
  });

  it("varje snabbmeny-knapp scrollar till motsvarande sektion", async () => {
    const { getByTestId } = await mountAndWaitForNav();
    const scroll = installScrollSpy();

    const navToSection: Array<[string, string]> = [
      ["nav-metadata", "object-section-metadata"],
      ["nav-linked-tasks", "object-section-linked-tasks"],
    ];

    for (const [navId, sectionId] of navToSection) {
      // Sektionen måste finnas i DOM:en för att scrollas till.
      expect(document.getElementById(sectionId), `${sectionId} saknas i DOM`).toBeTruthy();
      fireEvent.click(getByTestId(navId));
      expect(scroll.lastScrolledId(), `${navId} scrollade inte till ${sectionId}`).toBe(sectionId);
    }
  });

  it("header-pennan (button-edit-parent) scrollar till huvud-sektionen (hierarki)", async () => {
    const { getByTestId } = await mountAndWaitForNav();
    const scroll = installScrollSpy();
    // scrollToSection("hierarchy") mappas via TAB_TO_SECTION till "huvud".
    fireEvent.click(getByTestId("button-edit-parent"));
    expect(scroll.lastScrolledId()).toBe("object-section-huvud");
  });

  it("bakåtkompatibel ?tab=ekonomi-djuplänk scrollar till huvud-sektionen", async () => {
    installFetchMock(makeResolvedObject());
    // ?tab-effekten läser window.location.search direkt (inte wouters
    // memory-location), så jsdom-URL:en måste sättas innan montering.
    window.history.replaceState(null, "", `/objects/${OBJECT_ID}?tab=ekonomi`);
    const scroll = installScrollSpy();
    const { queryByTestId } = renderObjectDetail(`/objects/${OBJECT_ID}?tab=ekonomi`);
    await waitFor(() => {
      expect(queryByTestId("object-detail-quicknav")).toBeTruthy();
    });
    await waitFor(() => {
      expect(scroll.lastScrolledId()).toBe("object-section-huvud");
    });
  });

  it("bakåtkompatibel ?tab=access-djuplänk scrollar till metadata-sektionen", async () => {
    installFetchMock(makeResolvedObject());
    // ?tab-effekten läser window.location.search direkt; sätt jsdom-URL:en före montering.
    window.history.replaceState(null, "", `/objects/${OBJECT_ID}?tab=access`);
    const scroll = installScrollSpy();
    const { queryByTestId } = renderObjectDetail(`/objects/${OBJECT_ID}?tab=access`);
    await waitFor(() => {
      expect(queryByTestId("object-detail-quicknav")).toBeTruthy();
    });
    await waitFor(() => {
      expect(scroll.lastScrolledId()).toBe("object-section-metadata");
    });
  });

  it("fabricerar inte 'Tillgångstyp' från DB-defaulten accessType='open'", async () => {
    // accessType har DB-default "open" — det får INTE räknas som ett riktigt värde,
    // annars fabriceras "Tillgångstyp: Öppet" på nästan alla objekt.
    installFetchMock(makeResolvedObject({ accessType: "open" }));
    const { queryByTestId, container } = renderObjectDetail(`/objects/${OBJECT_ID}`);
    await waitFor(() => {
      expect(queryByTestId("object-detail-quicknav")).toBeTruthy();
    });
    expect(container.textContent).not.toContain("Tillgångstyp");
  });

  it("renderar inga råa tomma objekt ('{}') i översikten", async () => {
    const { container } = await mountAndWaitForNav();
    expect(container.textContent).not.toContain("{}");
    expect(container.textContent).not.toContain("[object Object]");
  });

  it("regression: ObjectMetadataBody renderar utan legacy-props (kraschen som sköts till prod)", async () => {
    // Ursprungsbuggen: Etapp 5 tog bort legacyEntries/onEditLegacyField ur
    // call-siten men inte ur ObjectMetadataBody → `legacyEntries.length` på
    // undefined kraschade hela objektsidan. Detta test monterar komponenten
    // direkt med det NYA prop-kontraktet och låser att den inte kastar.
    installFetchMock(makeResolvedObject());
    const { hook } = memoryLocation({ path: `/objects/${OBJECT_ID}` });
    expect(() =>
      render(
        <QueryClientProvider client={makeClient()}>
          <LanguageProvider>
            <TooltipProvider>
              <Router hook={hook}>
                <ObjectMetadataBody
                  objectId={OBJECT_ID}
                  entries={[]}
                  types={[]}
                  onAdd={() => {}}
                  isAdding={false}
                  onSoftDelete={() => {}}
                  onRestore={() => {}}
                  softDeletePending={false}
                  restorePending={false}
                  objectAssignments={[]}
                  navigate={() => {}}
                />
              </Router>
            </TooltipProvider>
          </LanguageProvider>
        </QueryClientProvider>,
      ),
    ).not.toThrow();
  });
});
