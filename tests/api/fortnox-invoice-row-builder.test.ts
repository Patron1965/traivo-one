import { describe, it, expect } from "vitest";
import {
  buildFortnoxLogicalRowsForWorkOrder,
  collapseFortnoxLogicalRows,
  type BuildLogicalRowsParams,
} from "../../server/services/fortnox-invoice-row-builder";

// Task #1124: Delad Fortnox-radbyggare (enskild + samlingsfaktura).
// Rena enhetstester (ingen DB) — resolveArticleNumber injiceras. Verifierar
// kärnkraven från memory invoice-row-text-parity + order-concept-value-dedup:
//   - radkollaps summerar DeliveredQuantity för genuint identiska rader,
//   - rader med OLIKA frysta referenser kollapsar ALDRIG (value-dedup-säkert),
//   - fast-pris (frozenIsFixedPrice) kollapsar ALDRIG,
//   - info-rader byggs ur frozenInvoiceRowReferences + utförar-fritext, kapade
//     till 50 tecken,
//   - enskild == konsoliderad radtext (paritet),
//   - frozenUnitPrice skalar radpriserna proportionellt,
//   - artikelfilter + saknad Fortnox-mapping hoppar rader.

type Params = BuildLogicalRowsParams;

function makeParams(p: {
  workOrder: Params["workOrder"];
  lines: Params["lines"];
  objectRefs?: Params["objectRefs"];
  costCenter?: string | null;
  project?: string | null;
  payerPercentage?: number;
  articleFilter?: string[];
  resolveArticleNumber?: Params["resolveArticleNumber"];
}): Params {
  return {
    tenantId: "t1",
    workOrder: p.workOrder,
    lines: p.lines,
    objectRefs: p.objectRefs ?? {},
    costCenter: p.costCenter,
    project: p.project,
    payerPercentage: p.payerPercentage,
    articleFilter: p.articleFilter,
    // Default: stabil 1:1-mapping artikel-ID → Fortnox-nummer.
    resolveArticleNumber: p.resolveArticleNumber ?? (async (id: string) => `FX-${id}`),
  };
}

function chargeRows(flat: Array<Record<string, unknown>>) {
  return flat.filter((r) => r.ArticleNumber !== undefined || r.DeliveredQuantity !== undefined);
}

describe("collapseFortnoxLogicalRows — radkollaps", () => {
  it("summerar DeliveredQuantity för genuint identiska rader (olika WO)", async () => {
    const lines = (qty: number) => [
      { articleId: "art-1", quantity: qty, resolvedPrice: 10000, notes: "Tömning" },
    ];
    const a = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({ workOrder: { id: "wo-a" }, lines: lines(2) }),
    );
    const b = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({ workOrder: { id: "wo-b" }, lines: lines(3) }),
    );
    const flat = collapseFortnoxLogicalRows([...a, ...b]);
    expect(flat).toHaveLength(1);
    expect(flat[0].DeliveredQuantity).toBe(5);
    expect(flat[0].ArticleNumber).toBe("FX-art-1");
    expect(flat[0].Price).toBe(10000);
  });

  it("rader med OLIKA frysta radreferenser kollapsar ALDRIG (value-dedup-säkert)", async () => {
    const lines = [{ articleId: "art-1", quantity: 1, resolvedPrice: 10000, notes: "Tömning" }];
    const a = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({
        workOrder: {
          id: "wo-a",
          frozenInvoiceRowReferences: {
            rows: [{ label: "Portkod", value: "1234" }],
            includeExecutorFreetext: false,
          },
        },
        lines,
      }),
    );
    const b = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({
        workOrder: {
          id: "wo-b",
          frozenInvoiceRowReferences: {
            rows: [{ label: "Portkod", value: "9999" }],
            includeExecutorFreetext: false,
          },
        },
        lines,
      }),
    );
    const flat = collapseFortnoxLogicalRows([...a, ...b]);
    // 2 debiteringsrader (ej ihopslagna) + 2 info-rader.
    expect(chargeRows(flat)).toHaveLength(2);
    const descriptions = flat.map((r) => r.Description);
    expect(descriptions).toContain("Portkod: 1234");
    expect(descriptions).toContain("Portkod: 9999");
  });

  it("fast-pris (frozenIsFixedPrice) kollapsar ALDRIG även vid identiska rader", async () => {
    const lines = [{ articleId: "art-1", quantity: 1, resolvedPrice: 5000, notes: "Fast" }];
    const a = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({ workOrder: { id: "wo-a", frozenIsFixedPrice: true }, lines }),
    );
    const b = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({ workOrder: { id: "wo-b", frozenIsFixedPrice: true }, lines }),
    );
    const flat = collapseFortnoxLogicalRows([...a, ...b]);
    expect(chargeRows(flat)).toHaveLength(2);
    for (const r of chargeRows(flat)) expect(r.DeliveredQuantity).toBe(1);
  });
});

describe("buildFortnoxLogicalRowsForWorkOrder — info-rader", () => {
  it("bygger 'Etikett: värde' kapad till 50 tecken", async () => {
    const rows = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({
        workOrder: {
          id: "wo",
          frozenInvoiceRowReferences: {
            rows: [{ label: "Notering", value: "X".repeat(80) }],
            includeExecutorFreetext: false,
          },
        },
        lines: [{ articleId: "art-1", quantity: 1, resolvedPrice: 100, notes: "Rad" }],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].infoRows).toHaveLength(1);
    expect(rows[0].infoRows[0].Description.length).toBe(50);
    expect(rows[0].infoRows[0].Description.startsWith("Notering: ")).toBe(true);
  });

  it("hoppar tomma referensvärden men tar med utförar-fritext (kapad)", async () => {
    const rows = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({
        workOrder: {
          id: "wo",
          notes: "Y".repeat(80),
          frozenInvoiceRowReferences: {
            rows: [{ label: "Tom", value: "" }],
            includeExecutorFreetext: true,
          },
        },
        lines: [{ articleId: "art-1", quantity: 1, resolvedPrice: 100, notes: "Rad" }],
      }),
    );
    // Tom referens hoppas → bara utförar-fritexten blir en info-rad.
    expect(rows[0].infoRows).toHaveLength(1);
    expect(rows[0].infoRows[0].Description.length).toBe(50);
    expect(rows[0].infoRows[0].Description.startsWith("Y")).toBe(true);
  });

  it("ingen radkonfig (frozenInvoiceRowReferences null) → inga info-rader", async () => {
    const rows = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({
        workOrder: { id: "wo" },
        lines: [{ articleId: "art-1", quantity: 1, resolvedPrice: 100, notes: "Rad" }],
      }),
    );
    expect(rows[0].infoRows).toHaveLength(0);
  });

  it("regression #1124: tom rows + includeExecutorFreetext → utförar-fritext blir info-rad", async () => {
    // Koncept med fritext PÅ men inga radfält fryser {rows:[], includeExecutorFreetext:true}.
    // Utförarens fritext (work_orders.notes) MÅSTE då nå fakturan som info-rad.
    const rows = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({
        workOrder: {
          id: "wo",
          notes: "Bom trasig, bytte fjäder",
          frozenInvoiceRowReferences: { rows: [], includeExecutorFreetext: true },
        },
        lines: [{ articleId: "art-1", quantity: 1, resolvedPrice: 100, notes: "Rad" }],
      }),
    );
    expect(rows[0].infoRows).toHaveLength(1);
    expect(rows[0].infoRows[0].Description).toBe("Bom trasig, bytte fjäder");
  });

  it("tom rows + includeExecutorFreetext men inga notes → inga info-rader", async () => {
    const rows = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({
        workOrder: {
          id: "wo",
          notes: null,
          frozenInvoiceRowReferences: { rows: [], includeExecutorFreetext: true },
        },
        lines: [{ articleId: "art-1", quantity: 1, resolvedPrice: 100, notes: "Rad" }],
      }),
    );
    expect(rows[0].infoRows).toHaveLength(0);
  });
});

describe("buildFortnoxLogicalRowsForWorkOrder — paritet enskild vs konsoliderad", () => {
  it("samma WO ger BYTE-identisk radtext ensam och inuti en samlingsfaktura", async () => {
    const objectRefs = { objektnamn: "Nord", adress: "Storgatan 1" };
    const woA = { id: "wo-a" };
    const linesA = [{ articleId: "art-1", quantity: 2, resolvedPrice: 10000, notes: "Tömning" }];

    const single = collapseFortnoxLogicalRows(
      await buildFortnoxLogicalRowsForWorkOrder(
        makeParams({ workOrder: woA, lines: linesA, objectRefs }),
      ),
    );
    const consolidated = collapseFortnoxLogicalRows([
      ...(await buildFortnoxLogicalRowsForWorkOrder(
        makeParams({ workOrder: woA, lines: linesA, objectRefs }),
      )),
      ...(await buildFortnoxLogicalRowsForWorkOrder(
        makeParams({
          workOrder: { id: "wo-b" },
          lines: [{ articleId: "art-2", quantity: 1, resolvedPrice: 5000, notes: "Annat" }],
          objectRefs,
        }),
      )),
    ]);

    const singleDesc = single.find((r) => r.ArticleNumber === "FX-art-1")?.Description;
    const consDesc = consolidated.find((r) => r.ArticleNumber === "FX-art-1")?.Description;
    expect(singleDesc).toBe("Tömning · Objekt: Nord · Adress: Storgatan 1");
    expect(consDesc).toBe(singleDesc);
  });
});

describe("buildFortnoxLogicalRowsForWorkOrder — pris/antal/filter", () => {
  it("payerPercentage skalar DeliveredQuantity", async () => {
    const rows = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({
        workOrder: { id: "wo" },
        lines: [{ articleId: "art-1", quantity: 4, resolvedPrice: 1000 }],
        payerPercentage: 50,
      }),
    );
    expect(rows[0].chargeRow.DeliveredQuantity).toBe(2);
  });

  it("frozenUnitPrice skalar radpriserna proportionellt (summa = frozenUnitPrice*frozenQuantity)", async () => {
    // currentTotal = 100 + 300 = 400; frozenTotal = 200*4 = 800; scale = 2.
    const rows = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({
        workOrder: { id: "wo", frozenUnitPrice: 200, frozenQuantity: 4 },
        lines: [
          { articleId: "art-1", quantity: 1, resolvedPrice: 100 },
          { articleId: "art-2", quantity: 1, resolvedPrice: 300 },
        ],
      }),
    );
    expect(rows[0].chargeRow.Price).toBe(200);
    expect(rows[1].chargeRow.Price).toBe(600);
  });

  it("saknad Fortnox-mapping (resolveArticleNumber null) hoppar raden", async () => {
    const rows = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({
        workOrder: { id: "wo" },
        lines: [{ articleId: "art-x", quantity: 1, resolvedPrice: 1000 }],
        resolveArticleNumber: async () => null,
      }),
    );
    expect(rows).toHaveLength(0);
  });

  it("artikelfilter hoppar icke-matchande artiklar OCH fritextrader", async () => {
    const rows = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({
        workOrder: { id: "wo" },
        lines: [
          { articleId: "art-1", quantity: 1, resolvedPrice: 1000 },
          { articleId: "art-2", quantity: 1, resolvedPrice: 2000 },
          { articleId: null, description: "Fritext", quantity: 1, resolvedPrice: 500 },
        ],
        articleFilter: ["art-1"],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].chargeRow.ArticleNumber).toBe("FX-art-1");
  });
});

describe("buildFortnoxLogicalRowsForWorkOrder — enforceNetZero (Task #1187)", () => {
  // Abonnemangstäckt WO: debiteringsrad + negativ kvittningsrad. Net-0-invarianten
  // vid export skyddar mot dubbelfakturering om kvittningsraden tappas.
  const covered = {
    workOrder: { id: "wo-sub" },
    lines: [
      { articleId: "art-1", quantity: 1, resolvedPrice: 10000, notes: "Tömning" },
      { articleId: "settle", quantity: 1, resolvedPrice: -10000, notes: "Kvittning – ingår i abonnemang" },
    ],
  };

  it("passerar utan kast när debiterings- + kvittningsrad nettar till 0", async () => {
    const rows = await buildFortnoxLogicalRowsForWorkOrder({
      ...makeParams(covered),
      enforceNetZero: true,
    });
    expect(rows).toHaveLength(2);
    const net = rows.reduce(
      (s, r) => s + Number(r.chargeRow.Price ?? 0) * Number(r.chargeRow.DeliveredQuantity ?? 0),
      0,
    );
    expect(net).toBe(0);
  });

  it("kastar när kvittningsraden filtrerats bort men den positiva raden finns kvar", async () => {
    // Ett payer-artikelfilter som bara släpper igenom debiteringsartikeln tappar
    // kvittningsraden → net ≠ 0 → export måste avbrytas (fail-closed).
    await expect(
      buildFortnoxLogicalRowsForWorkOrder({
        ...makeParams({ ...covered, articleFilter: ["art-1"] }),
        enforceNetZero: true,
      }),
    ).rejects.toThrow(/nettar/);
  });

  it("utan enforceNetZero kastar det aldrig (invarianten är opt-in)", async () => {
    const rows = await buildFortnoxLogicalRowsForWorkOrder(
      makeParams({ ...covered, articleFilter: ["art-1"] }),
    );
    expect(rows).toHaveLength(1);
  });
});
