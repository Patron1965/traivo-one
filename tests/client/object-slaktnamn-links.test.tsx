import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider } from "@/hooks/use-language";
import ObjectDetailPage from "@/pages/ObjectDetailPage";
import { ObjectDisplayNames } from "@/components/ObjectDisplayNames";
import { getQueryFn } from "@/lib/queryClient";

// Task #1419: jsdom-tester för Task #1418 — klickbara släktnamnsled och
// barn-indikationen i objektvyn. E2E i förhandsvisningen blockeras av extern
// Replit-OAuth (memory: testing-replit-auth-blocked.md), så beteendet låses här:
// 1) PathBreadcrumb: förälder-led = länkar till rätt objekt, sista ledet = text.
// 2) "N underordnade"-knappen i sidhuvudet: visas bara vid direkta barn,
//    räknar descendants filtrerat på parentId, klick scrollar till hierarkin.
// 3) Redigera-dialogens släktnamnsled stänger dialogen och navigerar.

const OBJECT_ID = "obj-1419";

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

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        queryFn: getQueryFn({ on401: "returnNull" }),
      },
      mutations: { retry: false },
    },
  });
}

function makeResolvedObject() {
  return {
    id: OBJECT_ID,
    name: "Testobjekt 1419",
    objectNumber: "OBJ-1419",
    status: "active",
    address: "Testgatan 1",
    latitude: null,
    longitude: null,
    parentId: null,
    inheritanceSources: [],
  };
}

interface FetchOverrides {
  descendants?: unknown[];
  ancestors?: unknown[];
  displayNames?: unknown;
}

/** URL-baserad fetch-mock; samma mönster som object-detail-overview.test.tsx. */
function installFetchMock(overrides: FetchOverrides = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (/\/resolved(\?|$)/.test(url)) return jsonResponse(makeResolvedObject());
    if (url.includes("resolved-invoice-recipient")) {
      return jsonResponse({ recipient: null, chain: [], conflicts: [] });
    }
    if (url.includes("/api/auth/user")) return jsonResponse(USER);
    if (url.includes("/available-types")) return jsonResponse([]);
    if (url.includes("/display-names")) {
      return jsonResponse(
        overrides.displayNames ?? { primary: "", chains: [], rulesEnabled: true },
      );
    }
    if (url.includes("/api/metadata/objects/")) return jsonResponse({ metadata: [] });
    if (url.includes("/descendants")) return jsonResponse(overrides.descendants ?? []);
    if (url.includes("/ancestors")) return jsonResponse(overrides.ancestors ?? []);
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
    return jsonResponse([]);
  });
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

function renderWithProviders(ui: React.ReactElement, path = "/") {
  const loc = memoryLocation({ path, record: true });
  const utils = render(
    <QueryClientProvider client={makeClient()}>
      <LanguageProvider>
        <TooltipProvider>
          <Router hook={loc.hook}>{ui}</Router>
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return { ...utils, loc };
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("PathBreadcrumb (ObjectDisplayNames) — klickbara förälder-led", () => {
  it("förälder-led är länkar till /objects/<id>; sista ledet är text utan länk", async () => {
    installFetchMock({
      displayNames: {
        primary: "Roten Mitten Bladet",
        rulesEnabled: true,
        chains: [
          {
            parentId: "p-mitten",
            relationContext: null,
            isPrimary: true,
            name: "Roten Mitten Bladet",
            path: [
              { id: "p-roten", name: "Roten", level: "1" },
              { id: "p-mitten", name: "Mitten", level: "2" },
              { id: "self-blad", name: "Bladet", level: "3" },
            ],
          },
        ],
      },
    });

    const { queryByTestId, getByTestId } = renderWithProviders(
      <ObjectDisplayNames objectId="self-blad" enabled />,
    );

    await waitFor(() => {
      expect(queryByTestId("display-name-path")).toBeTruthy();
    });

    // Förälder-leden är riktiga länkar med rätt mål.
    const rootLink = getByTestId("link-path-segment-p-roten");
    const midLink = getByTestId("link-path-segment-p-mitten");
    expect(rootLink.tagName).toBe("A");
    expect(midLink.tagName).toBe("A");
    expect(rootLink.getAttribute("href")).toBe("/objects/p-roten");
    expect(midLink.getAttribute("href")).toBe("/objects/p-mitten");
    expect(rootLink.textContent).toBe("Roten");
    expect(midLink.textContent).toBe("Mitten");

    // Sista ledet (objektet självt) är INTE en länk.
    expect(queryByTestId("link-path-segment-self-blad")).toBeNull();
    const path = getByTestId("display-name-path");
    expect(path.textContent).toContain("Bladet");
    // Inga <a>-element pekar på objektet självt inuti brödsmulan.
    const anchors = Array.from(path.querySelectorAll("a"));
    expect(anchors.map((a) => a.getAttribute("href"))).toEqual([
      "/objects/p-roten",
      "/objects/p-mitten",
    ]);
  });
});

describe("ObjectDetailPage — barn-indikationen i sidhuvudet", () => {
  async function mountDetail(overrides: FetchOverrides = {}) {
    installFetchMock(overrides);
    const utils = renderWithProviders(<ObjectDetailPage />, `/objects/${OBJECT_ID}`);
    await waitFor(() => {
      expect(utils.queryByTestId("text-object-name")).toBeTruthy();
    });
    return utils;
  }

  it("visas med antal DIREKTA barn (descendants filtrerat på parentId)", async () => {
    const { getByTestId } = await mountDetail({
      descendants: [
        { id: "child-1", name: "Barn 1", parentId: OBJECT_ID },
        { id: "child-2", name: "Barn 2", parentId: OBJECT_ID },
        // Barnbarn ska INTE räknas.
        { id: "grandchild-1", name: "Barnbarn", parentId: "child-1" },
      ],
    });

    await waitFor(() => {
      expect(getByTestId("button-header-child-count")).toBeTruthy();
    });
    expect(getByTestId("button-header-child-count").textContent).toContain("2 underordnade");
  });

  it("klick scrollar till hierarki-sektionen (huvud)", async () => {
    const ids: string[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      if (this.id) ids.push(this.id);
    });
    const originalRAF = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    try {
      const { getByTestId } = await mountDetail({
        descendants: [{ id: "child-1", name: "Barn 1", parentId: OBJECT_ID }],
      });
      await waitFor(() => {
        expect(getByTestId("button-header-child-count")).toBeTruthy();
      });
      fireEvent.click(getByTestId("button-header-child-count"));
      // scrollToSection("hierarchy") mappar till sektionen "huvud".
      expect(ids[ids.length - 1]).toBe("object-section-huvud");
    } finally {
      (globalThis as any).requestAnimationFrame = originalRAF;
    }
  });

  it("visas INTE när det saknas direkta barn (även om djupare ättlingar finns)", async () => {
    const { queryByTestId } = await mountDetail({
      // Enbart icke-direkta rader (t.ex. felaktig/annan parentId) → ingen chip.
      descendants: [{ id: "other", name: "Annan", parentId: "someone-else" }],
    });
    // Ge queries en tick att landa.
    await waitFor(() => {
      expect(queryByTestId("button-header-child-count")).toBeNull();
    });
  });
});

describe("ObjectDetailPage — redigera-dialogens släktnamnsled", () => {
  it("klick på ett förälder-led stänger dialogen och navigerar till objektet", async () => {
    installFetchMock({
      ancestors: [
        { id: "anc-root", name: "Roten", objectNumber: "OBJ-1" },
        { id: OBJECT_ID, name: "Testobjekt 1419", objectNumber: "OBJ-1419" },
      ],
    });
    const { getByTestId, queryByTestId, loc } = renderWithProviders(
      <ObjectDetailPage />,
      `/objects/${OBJECT_ID}`,
    );
    await waitFor(() => {
      expect(queryByTestId("button-edit-object")).toBeTruthy();
    });

    fireEvent.click(getByTestId("button-edit-object"));
    await waitFor(() => {
      expect(queryByTestId("text-slaktnamn")).toBeTruthy();
    });

    // Förälder-ledet är en knapp; objektet självt renderas som text utan knapp.
    expect(queryByTestId(`link-edit-slaktnamn-${OBJECT_ID}`)).toBeNull();
    const parentSegment = getByTestId("link-edit-slaktnamn-anc-root");
    expect(parentSegment.textContent).toBe("Roten");

    fireEvent.click(parentSegment);

    // Navigering till förälderns objektvy...
    await waitFor(() => {
      expect(loc.history[loc.history.length - 1]).toBe("/objects/anc-root");
    });
    // ...och dialogen är stängd.
    await waitFor(() => {
      expect(queryByTestId("text-slaktnamn")).toBeNull();
    });
  });
});
