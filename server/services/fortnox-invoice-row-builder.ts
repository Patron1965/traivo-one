// Task #1124: Delad Fortnox-radbyggare (enskild + samlingsfaktura).
//
// EN sanning för hur en arbetsorders rader blir Fortnox-fakturarader, så att en
// WO som exporteras ENSAM ger byte-identiska rader som samma WO inuti en
// samlingsfaktura (parity — se memory invoice-row-text-parity).
//
// Modell (arkitekt-godkänd):
//   - chargeRow  = debiteringsraden (artikel/fritext) — som tidigare, berikad med
//                  objektreferenser via formatEnrichedDescription.
//   - infoRows   = konceptets frysta radreferenser (informationspaketet) som
//                  SEPARATA Fortnox beskrivnings-rader (utan ArticleNumber/Price/
//                  DeliveredQuantity) EFTER debiteringsraden — "Etikett: värde",
//                  kapade till 50 tecken — plus utförarens fritext (work_orders.notes)
//                  när includeExecutorFreetext är satt. Referenserna bäddas ALDRIG
//                  in i chargeRow.Description; de ingår däremot i kollaps-nyckeln så
//                  att rader med olika referenser aldrig slås ihop.
//
// Radkollaps (collapseFortnoxLogicalRows): rader med identisk debiterings-signatur
// OCH identiska info-rader slås ihop och DeliveredQuantity summeras. Konservativt
// — chargeRow.Description (inkl. objektreferenser) ingår i nyckeln, så bara
// genuint identiska rader slås ihop (aldrig fel-summering, value-dedup-säkert).
// Fast-pris (frozenIsFixedPrice) slås ALDRIG ihop: varje fast-pris-WO är en egen
// debitering (per objekt/uppgift/koncept) → unik intern nyckel.

import {
  buildInvoiceLineBaseText,
  formatEnrichedDescription,
  type ObjectInvoiceRefs,
} from "./invoice-line-enrichment";
import type { FrozenInvoiceRowReferences } from "./invoice-reference-resolver";
import type { Uppgiftsvarden } from "@shared/uppgift-contract";

// Fortnox radbeskrivning är kort — håll info-raderna konservativt korta.
const INFO_ROW_MAX_LENGTH = 50;

export interface FortnoxChargeRow {
  ArticleNumber?: string;
  DeliveredQuantity: number;
  Description?: string;
  Price?: number;
  CostCenter?: string;
  Project?: string;
}

export interface FortnoxInfoRow {
  Description: string;
}

export interface FortnoxLogicalRow {
  chargeRow: FortnoxChargeRow;
  infoRows: FortnoxInfoRow[];
  collapseEligible: boolean;
  collapseKey: string;
}

// Strukturell delmängd av WorkOrderLine — bara det radbyggaren behöver.
interface BuilderLine {
  articleId?: string | null;
  quantity: number;
  resolvedPrice?: number | null;
  /** Task #131: fryst/fakturerbart underlag. Null = legacyrad. */
  frozenQuantity?: number | null;
  frozenValueOre?: number | null;
  billableQuantity?: number | null;
  billableValueOre?: number | null;
  notes?: string | null;
  description?: string | null;
  // Informationspaket fält 26 & 27 (artikel-nivå fakturaflaggor, upplösta av caller).
  //   showOnInvoice=false     ⇒ raden utelämnas HELT ur fakturan (utförs men syns ej).
  //   invoiceToCustomer=false ⇒ raden visas men med pris 0 (intern/ej debiterbar post).
  // Undefined = default true (oförändrat beteende). Den proportionella fryst-pris-
  // skalningen räknas över ALLA rader, så en nollad/dold rad drar bort exakt sin egen
  // andel av frozenTotal utan att blåsa upp övriga rader.
  showOnInvoice?: boolean | null;
  invoiceToCustomer?: boolean | null;
}

// Strukturell delmängd av WorkOrder.
interface BuilderWorkOrder {
  id: string;
  notes?: string | null;
  frozenUnitPrice?: number | null;
  frozenQuantity?: number | null;
  frozenIsFixedPrice?: boolean | null;
  frozenInvoiceRowReferences?: FrozenInvoiceRowReferences | null;
  uppgiftsvarden?: Uppgiftsvarden | null;
}

export interface BuildLogicalRowsParams {
  tenantId: string;
  workOrder: BuilderWorkOrder;
  lines: BuilderLine[];
  objectRefs: ObjectInvoiceRefs;
  costCenter?: string | null;
  project?: string | null;
  /** Enskild export skickar payer.sharePercent; samlingsfaktura använder default 100. */
  payerPercentage?: number;
  /** Enskild export skickar payer.articleTypes (artikel-IDn) för att begränsa rader. */
  articleFilter?: string[];
  /** Slår upp Fortnox-artikelnummer för ett artikel-ID (null = saknar mapping → hoppa). */
  resolveArticleNumber: (articleId: string) => Promise<string | null>;
  /**
   * Task #1187: abonnemangstäckt WO — de byggda raderna MÅSTE netta 0 (ordinarie
   * rader + kvittningsrad). Kastar om nettot ≠ 0 (t.ex. payer-artikelfilter eller
   * saknad Fortnox-mapping som tappat kvittningsraden) → fail-closed export.
   */
  enforceNetZero?: boolean;
  /**
   * Task #1204 (91) — prismaskering på följesedel. När true utelämnas pris/summa
   * på ALLA debiteringsrader (Price = undefined). Styrs av dokumenttypens
   * "visa pris"-inställning (delivery_note) i callern; saknad inställning ⇒ maskera
   * (säker standard). Priset ingår i kollaps-nyckeln → maskade rader kollapsar på "∅".
   */
  maskPrices?: boolean;
}

function compactWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Bygg WO:ns frysta info-rader: en rad per radreferens med värde ("Etikett: värde")
// + ev. utförarens fritext (work_orders.notes). Tomma referenser hoppas över.
function buildInfoRows(workOrder: BuilderWorkOrder): FortnoxInfoRow[] {
  const frozen = workOrder.frozenInvoiceRowReferences;
  if (!frozen) return [];
  const rows: FortnoxInfoRow[] = [];
  for (const r of frozen.rows ?? []) {
    const label = (r?.label ?? "").toString().trim();
    const value = (r?.value ?? "").toString().trim();
    if (!value) continue;
    const text = compactWhitespace(label ? `${label}: ${value}` : value).slice(
      0,
      INFO_ROW_MAX_LENGTH,
    );
    if (text) rows.push({ Description: text });
  }
  if (frozen.includeExecutorFreetext) {
    const note = compactWhitespace((workOrder.notes ?? "").toString());
    if (note) rows.push({ Description: note.slice(0, INFO_ROW_MAX_LENGTH) });
  }
  return rows;
}

/**
 * Bygg logiska rader (debitering + info) för EN arbetsorder. Anropas IDENTISKT av
 * enskild och konsoliderad export — caller skiljer sig bara i payerPercentage,
 * articleFilter och kostnadsställe/projekt-källa.
 */
export async function buildFortnoxLogicalRowsForWorkOrder(
  params: BuildLogicalRowsParams,
): Promise<FortnoxLogicalRow[]> {
  const {
    workOrder,
    lines,
    objectRefs,
    costCenter,
    project,
    payerPercentage = 100,
    articleFilter,
    resolveArticleNumber,
    enforceNetZero = false,
    maskPrices = false,
  } = params;

  // ADR v3 (F6): frozenUnitPrice är ett WO-nivå-genomsnitt (totalPrice/totalQty).
  // Skala varje rads pris proportionellt så fakturasumman exakt matchar
  // frozenUnitPrice * frozenQuantity men artikel-granulariteten bevaras.
  const useFrozen =
    workOrder.frozenUnitPrice != null &&
    workOrder.frozenQuantity != null &&
    Number(workOrder.frozenQuantity) > 0;
  let scale = 1;
  if (useFrozen) {
    const currentTotal = lines.reduce(
      (s, l) => s + Number(l.resolvedPrice ?? 0) * Number(l.quantity ?? 1),
      0,
    );
    const frozenTotal =
      Number(workOrder.frozenUnitPrice) * Number(workOrder.frozenQuantity);
    scale = currentTotal > 0 ? frozenTotal / currentTotal : 1;
  }

  const isFixedPrice = workOrder.frozenIsFixedPrice === true;
  const infoRows = buildInfoRows(workOrder);
  const cc = costCenter || undefined;
  const proj = project || undefined;

  const out: FortnoxLogicalRow[] = [];
  // En Task #131-fryst WO är aldrig legacy: saknat radunderlag är ett datafel,
  // inte en anledning att läsa föränderliga resolved*-värden.
  if (workOrder.uppgiftsvarden?.frystSnapshot) {
    const incomplete = lines.find((line) =>
      line.frozenQuantity == null || line.frozenValueOre == null ||
      line.billableQuantity == null || line.billableValueOre == null,
    );
    if (incomplete) {
      throw new Error(
        `[fortnox] Fryst arbetsorder ${workOrder.id} saknar frozen/billable-radunderlag (${incomplete.articleId ?? "fritext"}); exporten avbryts.`,
      );
    }
  }
  let lineIndex = -1;
  for (const line of lines) {
    lineIndex++;

    // Artikelfilter (enskild export: payer.articleTypes). Matchar dagens beteende
    // exakt: när ett filter är satt hoppas BÅDE icke-matchande artiklar OCH
    // fritextrader (articleId=null) över.
    if (
      articleFilter &&
      articleFilter.length > 0 &&
      (!line.articleId || !articleFilter.includes(line.articleId))
    ) {
      continue;
    }

    // Informationspaket fält 26: "Visa på faktura" = false ⇒ utelämna raden helt.
    // (Skalningen ovan räknades över alla rader, så övriga rader behåller sin andel;
    // den utelämnade radens andel av frozenTotal försvinner ur fakturasumman.)
    if (line.showOnInvoice === false) {
      continue;
    }

    // Nya rader faktureras uteslutande från billable/frozen-snapshoten. Endast
    // legacyrader där båda saknas faller tillbaka på de gamla live-kolumnerna.
    const invoiceQuantity =
      line.billableQuantity ?? line.frozenQuantity ?? line.quantity;
    const quantity = Number(invoiceQuantity) * (payerPercentage / 100);
    const basePrice = Number(line.resolvedPrice ?? 0);
    const frozenLineValue = line.billableValueOre ?? line.frozenValueOre;
    const deterministicUnitPrice =
      frozenLineValue != null
        ? Number(invoiceQuantity) !== 0
          ? Number(frozenLineValue) / Number(invoiceQuantity)
          // Ett explicit fryst värde med antal noll får aldrig läcka ett senare
          // resolvedPrice. Price=0 gör den deterministiska nollraden tydlig.
          : 0
        : null;
    // Informationspaket fält 27: "Fakturera till kund" = false ⇒ pris 0 (raden visas
    // men debiteras inte). Sätts efter fryst-skalningen så andelen dras bort från summan.
    const notCharged = line.invoiceToCustomer === false;
    const price = notCharged
      ? 0
      : deterministicUnitPrice != null
        ? deterministicUnitPrice
        : useFrozen
        ? Math.round(basePrice * scale * 100) / 100
        : line.resolvedPrice || undefined;

    let chargeRow: FortnoxChargeRow;
    if (!line.articleId) {
      // Fritext-/blindgångar-rad utan artikel (Task #736).
      chargeRow = {
        DeliveredQuantity: quantity,
        Description: formatEnrichedDescription(
          buildInvoiceLineBaseText(line),
          objectRefs,
        ),
        Price: price ?? undefined,
        CostCenter: cc,
        Project: proj,
      };
    } else {
      const fortnoxArticle = await resolveArticleNumber(line.articleId);
      if (!fortnoxArticle) {
        console.warn(
          `[fortnox-invoice-row-builder] artikel ${line.articleId} saknar Fortnox-mapping (WO ${workOrder.id}), hoppar rad`,
        );
        continue;
      }
      chargeRow = {
        ArticleNumber: fortnoxArticle,
        DeliveredQuantity: quantity,
        Description: formatEnrichedDescription(
          buildInvoiceLineBaseText(line, { useFrozen }),
          objectRefs,
        ),
        Price: price ?? undefined,
        CostCenter: cc,
        Project: proj,
      };
    }

    // Task #1204 (91): följesedel-maskering — utelämna pris/summa helt. Görs FÖRE
    // kollaps-nyckeln så maskade rader kollapsar på "∅" och net-0-kontrollen (om
    // aktiv) trivialt håller (alla priser = 0).
    if (maskPrices) {
      chargeRow.Price = undefined;
    }

    const collapseEligible = !isFixedPrice;
    const baseKey = [
      chargeRow.ArticleNumber ?? "∅",
      chargeRow.Price ?? "∅",
      chargeRow.CostCenter ?? "∅",
      chargeRow.Project ?? "∅",
      chargeRow.Description ?? "∅",
      infoRows.map((r) => r.Description).join("⟂"),
    ].join("¦");
    // Fast-pris: unik nyckel (WO + radindex) så raderna ALDRIG kollapsar. Den
    // interna nyckeln syns aldrig i exporterad text.
    const collapseKey = collapseEligible
      ? baseKey
      : `${baseKey}¦__fixed__:${workOrder.id}:${lineIndex}`;

    out.push({ chargeRow, infoRows, collapseEligible, collapseKey });
  }

  // Task #1187 — net-0-invariant för abonnemangstäckt WO. De byggda debiteringsrad-
  // erna (ordinarie + kvittning) måste summera till 0. Om ett payer-artikelfilter
  // eller en saknad Fortnox-mapping tappat kvittningsraden (men behållit den positiva)
  // skulle uppgiften dubbelfaktureras — kasta i stället (fail-closed export).
  if (enforceNetZero) {
    const netExport = out.reduce(
      (s, lr) =>
        s + Number(lr.chargeRow.Price ?? 0) * Number(lr.chargeRow.DeliveredQuantity ?? 0),
      0,
    );
    if (Math.abs(netExport) > 0.01) {
      throw new Error(
        `[fortnox] Abonnemangstäckt arbetsorder ${workOrder.id} nettar ${netExport.toFixed(2)} ≠ 0 vid export ` +
          `— kvittningsraden saknas eller filtrerades bort (artikelfilter/Fortnox-mapping). Exporten avbryts.`,
      );
    }
  }

  return out;
}

/**
 * Kollapsa logiska rader till en platt Fortnox InvoiceRows-array. Rader med samma
 * collapseKey slås ihop och DeliveredQuantity summeras (endast debiteringsraden);
 * info-raderna är per definition identiska för ihopslagna rader och emitteras en
 * gång. Körs för enskild export (oftast no-op) OCH en gång över ALLA WOs i en
 * samlingsfaktura. Insättningsordning bevaras (Map).
 */
export function collapseFortnoxLogicalRows(
  logicalRows: FortnoxLogicalRow[],
): Array<Record<string, unknown>> {
  const groups = new Map<
    string,
    { chargeRow: FortnoxChargeRow; infoRows: FortnoxInfoRow[] }
  >();

  for (const lr of logicalRows) {
    const existing = groups.get(lr.collapseKey);
    if (existing && lr.collapseEligible) {
      existing.chargeRow.DeliveredQuantity =
        Number(existing.chargeRow.DeliveredQuantity) +
        Number(lr.chargeRow.DeliveredQuantity);
      continue;
    }
    if (!existing) {
      groups.set(lr.collapseKey, {
        chargeRow: { ...lr.chargeRow },
        infoRows: lr.infoRows,
      });
    }
    // existing && !collapseEligible kan inte inträffa: ineligibla nycklar är unika.
  }

  const out: Array<Record<string, unknown>> = [];
  for (const g of Array.from(groups.values())) {
    out.push(g.chargeRow as unknown as Record<string, unknown>);
    for (const ir of g.infoRows) {
      out.push({ Description: ir.Description });
    }
  }
  return out;
}
