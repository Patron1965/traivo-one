import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ObjectTasksNav } from "@/components/objects/ObjectLinkedOrdersTable";

// Task #1476: uppgiftsnavet på objektsidan har subträds-växel + status-, typ-
// och tidsperiodfilter. Query-nyckeln separerar self/subtree — testerna nedan
// vaktar att (1) en scope-växling aldrig visar fel scope-data (cache-blandning),
// (2) objektkolumnen bara syns i subtree-läge, (3) kombinerade filter ger rätt
// delmängd och (4) sökfältet matchar även objektnamn och källa.

const OBJECT_ID = "obj-nav-test";

const daysFromNow = (d: number) => new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();

// --- self-scope: två WO + en assignment på objektet självt -----------------
const SELF_RESPONSE = {
  scope: "self",
  workOrders: [
    {
      id: "wo-self-1",
      orderNumber: "SO-101",
      title: "Servicebesök tak",
      orderType: "service",
      sourceType: "snabborder",
      orderStatus: null,
      executionStatus: null, // → i_masterplanering (ej_gjord)
      scheduledDate: daysFromNow(-10),
    },
    {
      id: "wo-self-2",
      orderNumber: "SO-102",
      title: "Gammal installation",
      orderType: "installation",
      sourceType: "import",
      executionStatus: "completed", // → utford (gjord)
      scheduledDate: daysFromNow(-100),
    },
  ],
  assignments: [
    {
      id: "asg-self-1",
      title: "Avropsuppgift vår",
      sourceType: "orderkoncept",
      status: null, // materialized:false → skapad (ej_gjord)
      scheduledDate: daysFromNow(14), // kommande
    },
  ],
  truncated: { workOrders: false, assignments: false },
};

// --- subtree-scope: self-raderna + en rad från ett underordnat objekt -------
const SUBTREE_RESPONSE = {
  scope: "subtree",
  workOrders: [
    ...SELF_RESPONSE.workOrders,
    {
      id: "wo-child-1",
      orderNumber: "SO-201",
      title: "Barnuppgift städ",
      orderType: "service",
      sourceType: "felanmalan",
      executionStatus: "completed", // → utford (gjord)
      scheduledDate: daysFromNow(-5),
      objectId: "child-obj-1",
      objectName: "Barnobjekt A",
    },
  ],
  assignments: SELF_RESPONSE.assignments,
  truncated: { workOrders: false, assignments: false },
};

function mockLinkedWorkFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("scope=subtree") ? SUBTREE_RESPONSE : SELF_RESPONSE;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

function renderNav() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ObjectTasksNav objectId={OBJECT_ID} />
    </QueryClientProvider>,
  );
}

const nav = () => screen.getByTestId("card-object-tasks-nav");
const rowIds = () =>
  within(nav())
    .queryAllByTestId(/^row-tasks-nav-/)
    .map((el) => el.getAttribute("data-testid"));

async function openSelect(testId: string) {
  const trigger = within(nav()).getByTestId(testId);
  fireEvent.pointerDown(
    trigger,
    new (window as any).PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
  );
  fireEvent.click(trigger);
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("ObjectTasksNav — subträds-växel & scope-cache", () => {
  it("self-läge visar bara objektets egna rader, utan objektkolumn", async () => {
    const fetchMock = mockLinkedWorkFetch();
    renderNav();

    await waitFor(() => expect(rowIds()).toContain("row-tasks-nav-wo-wo-self-1"));
    expect(rowIds().sort()).toEqual([
      "row-tasks-nav-asg-asg-self-1",
      "row-tasks-nav-wo-wo-self-1",
      "row-tasks-nav-wo-wo-self-2",
    ]);
    // Barnobjektets rad får INTE synas i self-läge.
    expect(rowIds()).not.toContain("row-tasks-nav-wo-wo-child-1");
    // Objektkolumnen är dold i self-läge.
    expect(within(nav()).queryByText("Objekt", { selector: "th" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/objects/${OBJECT_ID}/linked-work?scope=self`),
      expect.anything(),
    );
  });

  it("växling till subtree visar barn-raden + objektkolumn; tillbaka till self tar bort den (ingen cache-blandning)", async () => {
    const fetchMock = mockLinkedWorkFetch();
    renderNav();
    await waitFor(() => expect(rowIds()).toContain("row-tasks-nav-wo-wo-self-1"));

    const toggle = within(nav()).getByTestId("switch-tasks-nav-subtree");
    fireEvent.click(toggle);

    // Subtree-läge: barn-raden dyker upp och objektkolumnen visas.
    await waitFor(() => expect(rowIds()).toContain("row-tasks-nav-wo-wo-child-1"));
    expect(rowIds()).toHaveLength(4);
    expect(within(nav()).getByText("Objekt", { selector: "th" })).toBeTruthy();
    expect(within(nav()).getByTestId("link-object-wo-wo-child-1").textContent).toBe("Barnobjekt A");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("scope=subtree"),
      expect.anything(),
    );

    // Tillbaka till self: barn-raden och objektkolumnen försvinner igen.
    fireEvent.click(toggle);
    await waitFor(() => expect(rowIds()).not.toContain("row-tasks-nav-wo-wo-child-1"));
    expect(rowIds()).toHaveLength(3);
    expect(within(nav()).queryByText("Objekt", { selector: "th" })).toBeNull();

    // Och en tredje växling ger subtree-datat igen (cache per scope-nyckel).
    fireEvent.click(toggle);
    await waitFor(() => expect(rowIds()).toContain("row-tasks-nav-wo-wo-child-1"));
    expect(rowIds()).toHaveLength(4);
  });
});

describe("ObjectTasksNav — kombinerade filter", () => {
  it("status 'Gjord' + typ 'Service' + period 30d ger exakt barn-raden (subtree)", async () => {
    mockLinkedWorkFetch();
    renderNav();
    await waitFor(() => expect(rowIds()).toContain("row-tasks-nav-wo-wo-self-1"));
    fireEvent.click(within(nav()).getByTestId("switch-tasks-nav-subtree"));
    await waitFor(() => expect(rowIds()).toHaveLength(4));

    // Statusfilter: Gjord → wo-self-2 (utford) + wo-child-1 (utford).
    fireEvent.click(within(nav()).getByTestId("button-tasks-nav-filter-gjord"));
    await waitFor(() =>
      expect(rowIds().sort()).toEqual([
        "row-tasks-nav-wo-wo-child-1",
        "row-tasks-nav-wo-wo-self-2",
      ]),
    );

    // Typfilter: Service → wo-self-2 (installation) faller bort.
    await openSelect("select-tasks-nav-type");
    fireEvent.click(await screen.findByText("Service", { selector: "[role=option] *" }));
    await waitFor(() => expect(rowIds()).toEqual(["row-tasks-nav-wo-wo-child-1"]));

    // Periodfilter: Senaste 30 dagarna → barn-raden (-5d) kvar.
    await openSelect("select-tasks-nav-period");
    fireEvent.click(await screen.findByText("Senaste 30 dagarna", { selector: "[role=option] *" }));
    await waitFor(() => expect(rowIds()).toEqual(["row-tasks-nav-wo-wo-child-1"]));
  });

  it("period 'Kommande' visar bara framtida rader", async () => {
    mockLinkedWorkFetch();
    renderNav();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    await openSelect("select-tasks-nav-period");
    fireEvent.click(await screen.findByText("Kommande", { selector: "[role=option] *" }));
    await waitFor(() => expect(rowIds()).toEqual(["row-tasks-nav-asg-asg-self-1"]));
  });

  it("tom delmängd visar 'matchar inte'-tomstate, inte 'inga uppgifter'", async () => {
    mockLinkedWorkFetch();
    renderNav();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    // Pågående finns inte i fixturen → 0 rader men datat finns.
    fireEvent.click(within(nav()).getByTestId("button-tasks-nav-filter-pagaende"));
    await waitFor(() => expect(rowIds()).toHaveLength(0));
    expect(within(nav()).getByTestId("empty-tasks-nav").textContent).toContain(
      "matchar sökningen/filtret",
    );
  });
});

describe("ObjectTasksNav — sökfältet", () => {
  it("matchar objektnamn (subtree-läge)", async () => {
    mockLinkedWorkFetch();
    renderNav();
    await waitFor(() => expect(rowIds()).toHaveLength(3));
    fireEvent.click(within(nav()).getByTestId("switch-tasks-nav-subtree"));
    await waitFor(() => expect(rowIds()).toHaveLength(4));

    fireEvent.change(within(nav()).getByTestId("input-tasks-nav-search"), {
      target: { value: "barnobjekt" },
    });
    await waitFor(() => expect(rowIds()).toEqual(["row-tasks-nav-wo-wo-child-1"]));
  });

  it("matchar källa (t.ex. 'snabborder')", async () => {
    mockLinkedWorkFetch();
    renderNav();
    await waitFor(() => expect(rowIds()).toHaveLength(3));

    fireEvent.change(within(nav()).getByTestId("input-tasks-nav-search"), {
      target: { value: "snabborder" },
    });
    await waitFor(() => expect(rowIds()).toEqual(["row-tasks-nav-wo-wo-self-1"]));

    // Och orderkoncept-källan matchar assignment-raden.
    fireEvent.change(within(nav()).getByTestId("input-tasks-nav-search"), {
      target: { value: "orderkoncept" },
    });
    await waitFor(() => expect(rowIds()).toEqual(["row-tasks-nav-asg-asg-self-1"]));
  });
});
