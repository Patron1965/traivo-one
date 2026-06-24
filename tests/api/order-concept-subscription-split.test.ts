import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Task #1071: Abonnemangsfakturor delas korrekt per nivå
// ============================================================================
// Task #1067 är värde-känsligt: öre-aggregering (exakt fördelning), samma-kund-
// split per metadatavärde (fakturastopp) och preview == execute-invarianten. En
// regression som tappar en split, dubbelräknar öre eller divergerar mellan
// schemaläggare och förhandsvisning skulle vara svår att upptäcka manuellt.
//
// Den kanoniska grupperaren groupSubscriptionInvoices är ENDA källan som BÅDE
// schemaläggaren (runSubscriptionConcept i order-concept-auto-runner) OCH
// förhandsvisningen (buildSubscriptionSegmentsPreview i fortnoxRoutes) delegerar
// till. Att låsa dess beteende här skyddar därför båda konsumenterna samtidigt.

// groupSubscriptionInvoices slår upp fakturastopp-segmentets råvärde via
// getArticleMetadataForObject. Mocka ENBART den funktionen (partiell mock så att
// övriga exporter — som storage/targeting läser vid modul-laddning — bevaras).
vi.mock("../../server/metadata-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/metadata-queries")>();
  return { ...actual, getArticleMetadataForObject: vi.fn() };
});

import {
  groupSubscriptionInvoices,
  distributeOreEvenly,
  isConceptFakturastopp,
  type SubscriptionInvoiceGroup,
} from "../../server/services/order-concept-subscription";
import { getArticleMetadataForObject } from "../../server/metadata-queries";

const mockedMeta = vi.mocked(getArticleMetadataForObject);

// Mappar objekt-id → råvärde på split-fältet (null = objektet saknar värde).
type MetaEntry = { displayValue?: string; value?: any } | null;
function mockMetadata(byObject: Record<string, MetaEntry>) {
  mockedMeta.mockImplementation(async (objId: string) => {
    const entry = byObject[objId];
    if (!entry) return null;
    return {
      value: entry.value ?? null,
      displayValue: entry.displayValue ?? "",
      source: "manual",
      datatype: "text",
      katalogId: "kat-1",
      katalogName: "fastighet",
    } as any;
  });
}

const objs = (...ids: string[]) => ids.map((id) => ({ id }));
const sumOre = (groups: SubscriptionInvoiceGroup[]) =>
  groups.reduce((s, g) => s + g.valueOre, 0);
const byKey = (groups: SubscriptionInvoiceGroup[]) =>
  new Map(groups.map((g) => [g.segmentKey ?? "__customer__", g]));

// Fakturastopp = samma kund, men fakturan delas ORGANISATORISKT per unikt värde i
// ett metadatafält.
const fakturastoppConcept = {
  id: "c-stopp",
  invoiceConsolidation: "monthly",
  departmentMetadataField: "fastighet",
  customerId: "cust-1",
};
// Ren kundnivå = ingen split (dagens back-compat-beteende).
const kundnivaConcept = {
  id: "c-kund",
  invoiceConsolidation: "customer",
  departmentMetadataField: null,
  customerId: "cust-1",
};

beforeEach(() => {
  mockedMeta.mockReset();
});

// ============================================================================
// distributeOreEvenly — exakt heltals-fördelning (största-rest-metoden)
// ============================================================================
describe("distributeOreEvenly — exakt öre-fördelning", () => {
  it("jämn delning ger lika andelar och Σ == total", () => {
    const out = distributeOreEvenly(1000, 4);
    expect(out).toEqual([250, 250, 250, 250]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("ojämn delning lägger restören på de FÖRSTA posterna (största-rest)", () => {
    const out = distributeOreEvenly(10, 3);
    expect(out).toEqual([4, 3, 3]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it("Σ == total även för stora ojämna belopp (ingen avrundningstapp)", () => {
    const out = distributeOreEvenly(10001, 3);
    expect(out).toEqual([3334, 3334, 3333]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(10001);
  });

  it("count 0 ger tom array; count 1 ger hela beloppet", () => {
    expect(distributeOreEvenly(500, 0)).toEqual([]);
    expect(distributeOreEvenly(777, 1)).toEqual([777]);
  });

  it("Σ == total för en svit av icke-jämna kombinationer", () => {
    for (const [total, count] of [
      [1, 7],
      [99, 4],
      [12345, 7],
      [1000003, 11],
    ] as const) {
      const out = distributeOreEvenly(total, count);
      expect(out).toHaveLength(count);
      expect(out.reduce((a, b) => a + b, 0)).toBe(total);
      // Max 1 öre skillnad mellan största och minsta post.
      expect(Math.max(...out) - Math.min(...out)).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================================
// isConceptFakturastopp — när är split aktiv?
// ============================================================================
describe("isConceptFakturastopp — split-detektion", () => {
  it("kundnivå (customer / per_job) => false", () => {
    expect(isConceptFakturastopp({ invoiceConsolidation: "customer", departmentMetadataField: "fastighet" })).toBe(false);
    expect(isConceptFakturastopp({ invoiceConsolidation: "per_job", departmentMetadataField: "fastighet" })).toBe(false);
  });

  it("metadatafält saknas => false även med icke-kundnivå-konsolidering", () => {
    expect(isConceptFakturastopp({ invoiceConsolidation: "monthly", departmentMetadataField: "" })).toBe(false);
    expect(isConceptFakturastopp({ invoiceConsolidation: "monthly", departmentMetadataField: null })).toBe(false);
  });

  it("icke-kundnivå-konsolidering + valt metadatafält => true", () => {
    expect(isConceptFakturastopp({ invoiceConsolidation: "monthly", departmentMetadataField: "fastighet" })).toBe(true);
    expect(isConceptFakturastopp({ invoiceConsolidation: "quarterly", departmentMetadataField: "omrade" })).toBe(true);
  });

  it("tomma/saknade fält => false (defensivt mot null/undefined)", () => {
    expect(isConceptFakturastopp({})).toBe(false);
    expect(isConceptFakturastopp({ invoiceConsolidation: "  ", departmentMetadataField: "  " })).toBe(false);
  });
});

// ============================================================================
// groupSubscriptionInvoices — kärnan: split per nivå + öre-bevarande
// ============================================================================
describe("groupSubscriptionInvoices — fakturastopp (samma kund, split per metadatavärde)", () => {
  it("objekt med olika metadatavärden => ett segment per värde, Σ per segment exakt", async () => {
    mockMetadata({
      o1: { displayValue: "Fastighet A" },
      o2: { displayValue: "Fastighet A" },
      o3: { displayValue: "Fastighet B" },
      o4: { displayValue: "Fastighet B" },
    });
    const perObjectValuesOre = distributeOreEvenly(10000, 4); // [2500,2500,2500,2500]

    const groups = await groupSubscriptionInvoices({
      tenantId: "t1",
      concept: fakturastoppConcept,
      matchingObjects: objs("o1", "o2", "o3", "o4"),
      perObjectValuesOre,
      customerIdForObject: () => "cust-1",
    });

    expect(groups).toHaveLength(2);
    // Samma kund hela vägen (fakturastopp = organisatorisk split, inte kundbyte).
    expect(groups.every((g) => g.customerId === "cust-1")).toBe(true);

    const m = byKey(groups);
    const a = m.get("fastighet=fastighet a")!;
    const b = m.get("fastighet=fastighet b")!;
    expect(a.valueOre).toBe(5000);
    expect(a.objectIds).toEqual(["o1", "o2"]);
    expect(a.groupingFieldName).toBe("fastighet");
    expect(a.groupingValue).toBe("Fastighet A"); // råvärdet bevaras (visning)
    expect(b.valueOre).toBe(5000);
    expect(b.objectIds).toEqual(["o3", "o4"]);

    // Öre-bevarande: Σ per segment == kanonisk total.
    expect(sumOre(groups)).toBe(10000);
  });

  it("objekt utan värde på split-fältet => kundnivå-roll-up (segmentKey null)", async () => {
    mockMetadata({
      o1: { displayValue: "Fastighet A" },
      o2: null, // saknar värde => degenererar till kundnivå
      o3: { displayValue: "Fastighet A" },
    });
    const perObjectValuesOre = distributeOreEvenly(9999, 3); // [3333,3333,3333]

    const groups = await groupSubscriptionInvoices({
      tenantId: "t1",
      concept: fakturastoppConcept,
      matchingObjects: objs("o1", "o2", "o3"),
      perObjectValuesOre,
      customerIdForObject: () => "cust-1",
    });

    expect(groups).toHaveLength(2);
    const m = byKey(groups);
    const seg = m.get("fastighet=fastighet a")!;
    const kund = m.get("__customer__")!;

    expect(seg.objectIds).toEqual(["o1", "o3"]);
    expect(seg.valueOre).toBe(6666);
    expect(kund.segmentKey).toBeNull();
    expect(kund.groupingFieldName).toBeNull();
    expect(kund.groupingValue).toBeNull();
    expect(kund.objectIds).toEqual(["o2"]);
    expect(kund.valueOre).toBe(3333);

    expect(sumOre(groups)).toBe(9999);
  });

  it("normaliserar skiftläge/whitespace => samma segment, men behåller råvärdet från första objektet", async () => {
    mockMetadata({
      o1: { displayValue: "Fastighet A" },
      o2: { displayValue: "  fastighet   a " },
    });
    const groups = await groupSubscriptionInvoices({
      tenantId: "t1",
      concept: fakturastoppConcept,
      matchingObjects: objs("o1", "o2"),
      perObjectValuesOre: [600, 400],
      customerIdForObject: () => "cust-1",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].segmentKey).toBe("fastighet=fastighet a");
    expect(groups[0].groupingValue).toBe("Fastighet A");
    expect(groups[0].valueOre).toBe(1000);
  });

  it("faller tillbaka på value när displayValue är tomt", async () => {
    mockMetadata({
      o1: { displayValue: "", value: 42 },
    });
    const groups = await groupSubscriptionInvoices({
      tenantId: "t1",
      concept: fakturastoppConcept,
      matchingObjects: objs("o1"),
      perObjectValuesOre: [1234],
      customerIdForObject: () => "cust-1",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].segmentKey).toBe("fastighet=42");
    expect(groups[0].groupingValue).toBe("42");
  });

  it("ett metadata-uppslagsfel tappar inte objektet (degenererar till kundnivå)", async () => {
    // Felet loggas avsiktligt av grupperaren — dämpa det så testutskriften blir ren.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedMeta.mockImplementation(async (objId: string) => {
      if (objId === "o2") throw new Error("uppslag misslyckades");
      return { value: null, displayValue: "Fastighet A", source: "manual", datatype: "text", katalogId: "k", katalogName: "fastighet" } as any;
    });
    const groups = await groupSubscriptionInvoices({
      tenantId: "t1",
      concept: fakturastoppConcept,
      matchingObjects: objs("o1", "o2"),
      perObjectValuesOre: [700, 300],
      customerIdForObject: () => "cust-1",
    });
    // o1 → segment, o2 → kundnivå (fel ⇒ inget värde), inget objekt tappas.
    expect(sumOre(groups)).toBe(1000);
    const m = byKey(groups);
    expect(m.get("fastighet=fastighet a")!.objectIds).toEqual(["o1"]);
    expect(m.get("__customer__")!.objectIds).toEqual(["o2"]);
    errSpy.mockRestore();
  });
});

describe("groupSubscriptionInvoices — kundnivå & flera fakturakunder", () => {
  it("utan fakturastopp => EN grupp per kund oavsett metadata (inget uppslag görs)", async () => {
    const groups = await groupSubscriptionInvoices({
      tenantId: "t1",
      concept: kundnivaConcept,
      matchingObjects: objs("o1", "o2", "o3"),
      perObjectValuesOre: distributeOreEvenly(3000, 3),
      customerIdForObject: () => "cust-1",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].segmentKey).toBeNull();
    expect(groups[0].objectIds).toEqual(["o1", "o2", "o3"]);
    expect(groups[0].valueOre).toBe(3000);
    // Kundnivå ⇒ ingen metadata-uppslagning alls.
    expect(mockedMeta).not.toHaveBeenCalled();
  });

  it("FROM_METADATA: olika fakturakunder => en grupp per kund (delning på lägre nivåer)", async () => {
    const customerByObject: Record<string, string> = { o1: "cust-A", o2: "cust-A", o3: "cust-B" };
    const groups = await groupSubscriptionInvoices({
      tenantId: "t1",
      concept: kundnivaConcept, // ingen fakturastopp; split sker på kundnivå
      matchingObjects: objs("o1", "o2", "o3"),
      perObjectValuesOre: distributeOreEvenly(9000, 3), // [3000,3000,3000]
      customerIdForObject: (id) => customerByObject[id],
    });
    expect(groups).toHaveLength(2);
    const a = groups.find((g) => g.customerId === "cust-A")!;
    const b = groups.find((g) => g.customerId === "cust-B")!;
    expect(a.valueOre).toBe(6000);
    expect(a.objectIds).toEqual(["o1", "o2"]);
    expect(b.valueOre).toBe(3000);
    expect(b.objectIds).toEqual(["o3"]);
    expect(sumOre(groups)).toBe(9000);
  });

  it("FROM_METADATA + fakturastopp: grupperar per (kund × segment)", async () => {
    mockMetadata({
      o1: { displayValue: "Fastighet A" },
      o2: { displayValue: "Fastighet B" },
      o3: { displayValue: "Fastighet A" },
    });
    const customerByObject: Record<string, string> = { o1: "cust-A", o2: "cust-A", o3: "cust-B" };
    const groups = await groupSubscriptionInvoices({
      tenantId: "t1",
      concept: fakturastoppConcept,
      matchingObjects: objs("o1", "o2", "o3"),
      perObjectValuesOre: [1000, 2000, 3000],
      customerIdForObject: (id) => customerByObject[id],
    });
    // (A, Fast A), (A, Fast B), (B, Fast A) ⇒ 3 fakturor.
    expect(groups).toHaveLength(3);
    const find = (c: string, seg: string) => groups.find((g) => g.customerId === c && g.segmentKey === seg)!;
    expect(find("cust-A", "fastighet=fastighet a").valueOre).toBe(1000);
    expect(find("cust-A", "fastighet=fastighet b").valueOre).toBe(2000);
    expect(find("cust-B", "fastighet=fastighet a").valueOre).toBe(3000);
    expect(sumOre(groups)).toBe(6000);
  });

  it("objekt utan upplöst fakturakund hoppas över (ingår inte i någon faktura)", async () => {
    const customerByObject: Record<string, string | null> = { o1: "cust-1", o2: null, o3: "cust-1" };
    const groups = await groupSubscriptionInvoices({
      tenantId: "t1",
      concept: kundnivaConcept,
      matchingObjects: objs("o1", "o2", "o3"),
      perObjectValuesOre: [100, 200, 300],
      customerIdForObject: (id) => customerByObject[id],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].objectIds).toEqual(["o1", "o3"]);
    // o2 (saknar kund) bidrar INTE ⇒ Σ = 100 + 300.
    expect(sumOre(groups)).toBe(400);
  });
});

// ============================================================================
// preview == execute — delad kanonisk grupperare
// ============================================================================
// Både schemaläggaren (runSubscriptionConcept) och förhandsvisningen
// (buildSubscriptionSegmentsPreview) anropar groupSubscriptionInvoices med
// samma indata (matchingObjects + fee.perObjectValuesOre + customerIdForObject).
// Eftersom grupperingen är centraliserad här ger identiska indata identiska
// segment åt båda hållen. Dessa tester låser den invarianten + öre-bevarandet
// som båda konsumenterna förlitar sig på (förhandsvisningen aggregerar per
// segmentKey; schemaläggaren skapar en faktura per grupp).
describe("preview == execute (delad kanonisk grupperare)", () => {
  const setup = () => {
    mockMetadata({
      o1: { displayValue: "Fastighet A" },
      o2: { displayValue: "Fastighet B" },
      o3: { displayValue: "Fastighet A" },
      o4: null,
    });
    return {
      tenantId: "t1",
      concept: fakturastoppConcept,
      matchingObjects: objs("o1", "o2", "o3", "o4"),
      perObjectValuesOre: distributeOreEvenly(10000, 4), // [2500,2500,2500,2500]
      customerIdForObject: () => "cust-1" as string,
    };
  };

  it("båda produktionsanroparna delegerar till samma kanoniska grupperare (statisk vakt)", async () => {
    // Enda enhetsnivå-garantin för preview == execute: om en framtida ändring
    // bygger egen segmentering i schemaläggaren ELLER förhandsvisningen i stället
    // för att anropa groupSubscriptionInvoices, divergerar de — denna vakt fångar det.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = process.cwd();
    const runner = fs.readFileSync(
      path.join(root, "server/services/order-concept-auto-runner.ts"),
      "utf8",
    );
    const preview = fs.readFileSync(
      path.join(root, "server/routes/fortnoxRoutes.ts"),
      "utf8",
    );
    expect(runner).toMatch(/groupSubscriptionInvoices\(/);
    expect(preview).toMatch(/groupSubscriptionInvoices\(/);
  });

  it("identiska indata ger identiska grupper (deterministiskt)", async () => {
    const first = await groupSubscriptionInvoices(setup());
    const second = await groupSubscriptionInvoices(setup());
    expect(second).toEqual(first);
  });

  it("Σ av grupp-värden == kanonisk total (öre-bevarande som båda konsumenterna kräver)", async () => {
    const groups = await groupSubscriptionInvoices(setup());
    // Fast A = o1+o3 (5000), Fast B = o2 (2500), kundnivå = o4 (2500).
    expect(sumOre(groups)).toBe(10000);
  });

  it("antal segment == antal unika nivåer som förhandsvisningen visar", async () => {
    const groups = await groupSubscriptionInvoices(setup());
    // Förhandsvisningens reduktion: aggregera per segmentKey.
    const segments = new Map<string, number>();
    for (const g of groups) {
      const k = g.segmentKey ?? "__customer__";
      segments.set(k, (segments.get(k) ?? 0) + g.valueOre);
    }
    expect(segments.size).toBe(3); // Fast A, Fast B, kundnivå
    expect(segments.get("fastighet=fastighet a")).toBe(5000);
    expect(segments.get("fastighet=fastighet b")).toBe(2500);
    expect(segments.get("__customer__")).toBe(2500);
    // Aggregeringen bevarar totalen (samma summa som schemaläggaren fakturerar).
    expect([...segments.values()].reduce((a, b) => a + b, 0)).toBe(sumOre(groups));
  });
});
