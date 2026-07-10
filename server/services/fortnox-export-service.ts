// Task #1243: Fortnox-EXPORT (business-lager). fortnox-client.ts innehåller
// numera enbart rena API-anrop mot Fortnox (auth, createInvoice, getCustomer,
// osv). All affärslogik för att gå från Traivo-domänobjekt (arbetsorder,
// manuell rad, konsoliderad faktura) till en Fortnox-faktura — inklusive
// radbyggnad, kundupplösning, referensfrysning, idempotens och exportlogg —
// bor här.
import { storage } from "../storage";
import {
  FortnoxClient,
  type FortnoxInvoice,
  type FortnoxApiCallMetrics,
} from "../fortnox-client";
import {
  resolveObjectInvoiceRefs,
  buildFortnoxHeaderRefs,
} from "./invoice-line-enrichment";
import {
  buildFortnoxLogicalRowsForWorkOrder,
  collapseFortnoxLogicalRows,
  type FortnoxLogicalRow,
} from "./fortnox-invoice-row-builder";
import { deriveFortnoxCodesForWorkOrder } from "./fortnox-code-derivation";
import { buildTimeCodeRuleMap, resolveTimeCodeRule } from "./time-code-rules";

// Task #1203 (informationspaket fält 26 & 27): berika orderrader med artikelns
// permanenta fakturaflaggor innan de skickas till radbyggaren. showOnInvoice=false
// ⇒ raden utelämnas; invoiceToCustomer=false ⇒ pris 0. Default (kolumn NULL/true)
// ⇒ oförändrat beteende. Unika artikel-ID slås upp en gång var (liten cache-map).
async function enrichLinesWithArticleInvoiceFlags<
  T extends { articleId?: string | null },
>(
  lines: T[],
): Promise<
  Array<T & { showOnInvoice?: boolean | null; invoiceToCustomer?: boolean | null }>
> {
  const uniqueIds = Array.from(
    new Set(lines.map((l) => l.articleId).filter((x): x is string => !!x)),
  );
  const flagMap = new Map<
    string,
    { showOnInvoice?: boolean | null; invoiceToCustomer?: boolean | null }
  >();
  for (const id of uniqueIds) {
    const a = await storage.getArticle(id);
    if (a) {
      flagMap.set(id, {
        showOnInvoice: (a as any).showOnInvoice,
        invoiceToCustomer: (a as any).invoiceToCustomer,
      });
    }
  }
  return lines.map((l) =>
    l.articleId && flagMap.has(l.articleId)
      ? { ...l, ...flagMap.get(l.articleId)! }
      : l,
  );
}

/**
 * Task #1204 (91) — prismaskering på följesedel.
 *
 * En abonnemangstäckt WO (`subscriptionCovered`) exporteras till Fortnox som en
 * 0-netto-FÖLJESEDEL (leverans-/utförandebevis utan debitering) — inte en faktura.
 * På en följesedel får priser inte läcka ut. Vi respekterar konceptets befintliga
 * "visa pris"-inställning per dokumenttyp (`document_configurations.showPrice` för
 * documentType "delivery_note"):
 *   - Ej abonnemangstäckt (vanlig faktura)        → maskera ALDRIG (visa priser).
 *   - Följesedel utan koncept                     → maskera (säker standard).
 *   - Följesedel, ingen delivery_note-inställning → maskera (säker standard).
 *   - Följesedel, showPrice === false             → maskera.
 *   - Följesedel, showPrice === true              → visa priser.
 */
async function shouldMaskPricesForDeliveryNote(
  workOrder: { subscriptionCovered?: boolean | null; orderConceptId?: string | null },
): Promise<boolean> {
  if (workOrder?.subscriptionCovered !== true) return false;
  const conceptId = workOrder?.orderConceptId;
  if (!conceptId) return true;
  try {
    const configs = await storage.getDocumentConfigurations(conceptId);
    const deliveryNote = configs.find((c) => c.documentType === "delivery_note");
    if (!deliveryNote) return true;
    return deliveryNote.showPrice === false;
  } catch (err) {
    // Fail-safe: om inställningen inte kan läsas, maskera hellre än att läcka pris.
    console.warn("[fortnox] kunde inte läsa dokumentinställning för följesedel, maskerar priser:", err);
    return true;
  }
}

// === Task #1243: idempotens + exportlogg-hjälpare ===

function newMetrics(): FortnoxApiCallMetrics {
  return { calls: 0, retries: 0, waitMs: 0 };
}

async function logAttempt(params: {
  tenantId: string;
  exportId: string;
  attemptNumber: number;
  action: string;
  result: "success" | "error" | "retry" | "skipped";
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  waitMs?: number;
  durationMs?: number;
  userId?: string | null;
}): Promise<void> {
  try {
    await storage.createFortnoxExportLogEntry({
      tenantId: params.tenantId,
      exportId: params.exportId,
      attemptNumber: params.attemptNumber,
      action: params.action,
      result: params.result,
      httpStatus: params.httpStatus,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
      waitMs: params.waitMs ?? 0,
      durationMs: params.durationMs,
      userId: params.userId ?? null,
    });
  } catch (err) {
    // Loggen får aldrig blockera själva exporten.
    console.warn("[fortnox-export-log] kunde inte skriva loggrad:", err);
  }
}

function classifyErrorCode(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const statusMatch = msg.match(/Fortnox API error (\d+)/);
  if (statusMatch) return `HTTP_${statusMatch[1]}`;
  if (/rate limit/i.test(msg)) return "RATE_LIMITED";
  if (/not connected|authorization required/i.test(msg)) return "NOT_CONNECTED";
  if (/timeout/i.test(msg)) return "TIMEOUT";
  return "UNKNOWN";
}

async function persistMetrics(
  tenantId: string,
  exportId: string,
  metrics: FortnoxApiCallMetrics,
): Promise<void> {
  try {
    const current = await storage.getFortnoxInvoiceExport(exportId);
    await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
      apiCallCount: (current?.apiCallCount ?? 0) + metrics.calls,
      totalWaitMs: (current?.totalWaitMs ?? 0) + metrics.waitMs,
    });
  } catch (err) {
    console.warn("[fortnox-export-log] kunde inte skriva metrics-summering:", err);
  }
}

// Task #1243 idempotens: försök hitta en tidigare, obekräftad-men-lyckad export
// via ExternalInvoiceReference2 (=exportId) innan en ny faktura skapas. Detta
// täcker fallet där Fortnox skapade fakturan men svaret aldrig nådde oss
// (timeout/nätverksfel) och exporten sedan görs om.
async function findExistingInvoiceForExport(
  client: FortnoxClient,
  exportId: string,
  metrics: FortnoxApiCallMetrics,
): Promise<string | null> {
  try {
    const hit = await client.findInvoiceByExternalReference2(exportId, metrics);
    return hit?.DocumentNumber ?? null;
  } catch (err) {
    // Idempotenskontrollen är best-effort — om Fortnox inte stöder filtret eller
    // svarar med fel, fortsätter vi till vanlig createInvoice (fail-open här är
    // säkert eftersom claim-steget redan förhindrar samtidiga körningar).
    console.warn("[fortnox-idempotency] kunde inte slå upp ExternalInvoiceReference2:", err);
    return null;
  }
}

export async function exportWorkOrderToFortnox(
  tenantId: string,
  exportId: string,
  triggeredByUserId?: string | null,
): Promise<{ success: boolean; invoiceNumber?: string; error?: string }> {
  // Task #1243: atomisk claim förhindrar dubbel-export om två anrop (t.ex. en
  // ursprunglig request och en retry efter klient-timeout) kör samtidigt.
  const claimed = await storage.claimFortnoxInvoiceExportForProcessing(exportId, tenantId);
  if (!claimed) {
    const existing = await storage.getFortnoxInvoiceExport(exportId);
    if (existing?.status === "exported") {
      return { success: true, invoiceNumber: existing.fortnoxInvoiceNumber ?? undefined };
    }
    return { success: false, error: `Exporten hanteras redan (status="${existing?.status ?? "okänd"}").` };
  }
  if (triggeredByUserId) {
    await storage.updateFortnoxInvoiceExport(exportId, tenantId, { triggeredByUserId }).catch(() => {});
  }
  const attemptNumber = claimed.retryCount;
  const metrics = newMetrics();
  try {
    const invoiceExport = claimed;

    if (invoiceExport.sourceType === "manual") {
      return await exportManualLineToFortnox(tenantId, exportId, invoiceExport, attemptNumber, metrics);
    }

    if (invoiceExport.isCreditInvoice && invoiceExport.originalExportId) {
      return await exportCreditInvoiceToFortnox(
        tenantId,
        exportId,
        invoiceExport as InvoiceExportRecord & { originalExportId: string },
        attemptNumber,
        metrics,
      );
    }

    if (!invoiceExport.workOrderId) {
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "failed", errorMessage: "No work order ID for this export", errorCode: "MISSING_WORK_ORDER" });
      return { success: false, error: "No work order ID for this export" };
    }

    const workOrder = await storage.getWorkOrder(invoiceExport.workOrderId);
    if (!workOrder) {
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "failed", errorMessage: "Work order not found", errorCode: "MISSING_WORK_ORDER" });
      return { success: false, error: "Work order not found" };
    }

    // Task #558: Fortnox-export refuserar `held` och `consolidated` WOs.
    // - `held`: vänta på periodstängning eller släpp via Fakturakö.
    // - `consolidated`: redan länkad till en customer_invoice — den ska
    //   exporteras som sammanslagen post, inte som enskild WO-rad.
    const queueState = (workOrder as any).invoiceQueueState as string | null | undefined;
    if (queueState === "held") {
      const error = "Arbetsordern är bromsad i konsolideringskön. Släpp den via Fakturakö eller vänta tills perioden stänger.";
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "failed", errorMessage: error, errorCode: "HELD" });
      return { success: false, error };
    }
    if (queueState === "consolidated") {
      const error = "Arbetsordern ingår i en konsoliderad samlingsfaktura och får inte exporteras enskilt. Exportera den konsoliderade fakturan istället.";
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "failed", errorMessage: error, errorCode: "ALREADY_CONSOLIDATED" });
      return { success: false, error };
    }

    // Uppgiftslogik v1 (Fakturalås) — defense-in-depth: en fakturalåst WO som ännu
    // inte släppts genom segment-gaten (queueState=NULL eller kvarstående blockering)
    // får aldrig exporteras enskilt. Passerad gate ⇒ pending/held/consolidated (fångas
    // ovan / nedan), aldrig NULL med kvar blockering.
    if (
      (workOrder as any).frozenRequireCompleteSegmentBeforeInvoice &&
      (queueState == null || (workOrder as any).invoiceBlockedReason)
    ) {
      const error = "Arbetsordern är fakturalåst: alla uppgifter i fakturasegmentet måste vara utförda innan den kan faktureras.";
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "failed", errorMessage: error, errorCode: "INVOICE_LOCKED" });
      return { success: false, error };
    }

    // Task #1237: tidskodregistrets economyExport-flagga styr om en tidsbaserad WO
    // (frozenTimeCode satt från artikelns timeCodeKey vid frysning) får ekonomiexporteras.
    const frozenTimeCodeKey = (workOrder as any).frozenTimeCode as string | null | undefined;
    if (frozenTimeCodeKey) {
      const timeCodeDefs = await storage.getTimeCodeDefinitions(tenantId);
      const timeCodeRule = resolveTimeCodeRule(buildTimeCodeRuleMap(timeCodeDefs), frozenTimeCodeKey);
      if (!timeCodeRule.economyExport) {
        const error = `Tidskoden "${frozenTimeCodeKey}" är markerad utan ekonomiexport och kan inte faktureras.`;
        await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "failed", errorMessage: error, errorCode: "TIME_CODE_NO_EXPORT" });
        return { success: false, error };
      }
    }

    const workOrderLines = await enrichLinesWithArticleInvoiceFlags(
      await storage.getWorkOrderLines(invoiceExport.workOrderId),
    );
    if (!workOrderLines.length) {
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "failed", errorMessage: "No work order lines to invoice", errorCode: "NO_LINES" });
      return { success: false, error: "No work order lines to invoice" };
    }

    // ADR v3 §2.3: Om WO har frusen fakturamottagare vinner den över den
    // metadata-härledda kunden. Frozen-kedjan är orörd i Etapp 5.
    let frozenRecipientFortnoxId: string | null = null;
    if ((workOrder as any).frozenInvoiceRecipientId) {
      const frozenRec = await storage.getInvoiceRecipient(
        tenantId,
        (workOrder as any).frozenInvoiceRecipientId,
      );
      if (frozenRec?.fortnoxCustomerId) {
        frozenRecipientFortnoxId = frozenRec.fortnoxCustomerId;
      } else if (frozenRec?.customerId) {
        const mapping = await storage.getFortnoxMapping(tenantId, "customer", frozenRec.customerId);
        if (mapping) frozenRecipientFortnoxId = mapping.fortnoxId;
      }
    }

    // Etapp 5: betalarkällan är Ekonomi-metadatat 'Kund' (arvs-medvetet via
    // primär förälder) — object_payers är borttagen. En (1) payer per objekt.
    const validPayers: Array<{ id: string; customerId: string; sharePercent: number; articleTypes: string[] }> = [];
    if (frozenRecipientFortnoxId) {
      // Frusen fakturamottagare overridar den metadata-härledda kunden.
      validPayers.push({
        id: `frozen-recipient:${(workOrder as any).frozenInvoiceRecipientId}`,
        customerId: (workOrder as any).frozenInvoiceSourceCustomerId || workOrder.customerId,
        sharePercent: 100,
        articleTypes: [],
        _frozenFortnoxId: frozenRecipientFortnoxId,
      } as any);
    } else if (workOrder.objectId) {
      const { getObjectPrimaryCustomerId } = await import("./object-customer");
      const derivedCustomerId = await getObjectPrimaryCustomerId(workOrder.objectId);
      if (derivedCustomerId) {
        validPayers.push({
          id: `kund-metadata:${workOrder.objectId}`,
          customerId: derivedCustomerId,
          sharePercent: 100,
          articleTypes: [],
        });
      }
    }

    // Saknas kund i metadatat är det ett konfigurationsfel som måste åtgärdas
    // explicit (sätt Ekonomi-metadatat 'Kund' på objektet eller en gren ovanför,
    // eller frys fakturamottagare på ordern) innan WO kan faktureras.
    if (!validPayers.length) {
      const error = "Ingen kund kopplad till objektet. Sätt Ekonomi-metadatat 'Kund' på objektet (eller frys fakturamottagare på ordern) innan fakturering.";
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "failed", errorMessage: error, errorCode: "NO_CUSTOMER" });
      return { success: false, error };
    }

    const client = new FortnoxClient(tenantId);
    const isConnected = await client.isConnected();
    if (!isConnected) {
      const error = "Fortnox not connected - authorization required";
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "failed", errorMessage: error, errorCode: "NOT_CONNECTED" });
      return { success: false, error };
    }

    // Task #1243 idempotens: kolla om denna export redan finns i Fortnox (t.ex.
    // en tidigare timad-ut createInvoice som ändå gick igenom).
    const existingInvoiceNumber = await findExistingInvoiceForExport(client, exportId, metrics);
    if (existingInvoiceNumber) {
      await logAttempt({ tenantId, exportId, attemptNumber, action: "idempotency_check", result: "skipped", errorMessage: "Fanns redan i Fortnox" });
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
        status: "exported",
        fortnoxInvoiceNumber: existingInvoiceNumber,
        exportedAt: new Date(),
      });
      await persistMetrics(tenantId, exportId, metrics);
      return { success: true, invoiceNumber: existingInvoiceNumber };
    }

    let totalInvoiced = 0;
    const invoiceNumbers: string[] = [];

    // Task #1025: objektreferenser är WO-nivå (samma för alla payers) — lös en gång.
    const objectRefs = await resolveObjectInvoiceRefs(tenantId, workOrder);

    for (const payer of validPayers) {
      const payerPercentage = payer?.sharePercent || 100;
      let customerFortnoxId: string;

      if (!payer?.customerId) {
        console.warn(`Payer ${payer?.id} has no customerId, skipping`);
        continue;
      }
      // Frusen fakturamottagare: hoppa över customer-mapping och routa direkt
      // till mottagarens Fortnox-kundnummer (löst ovan).
      const frozenFortnoxId = (payer as any)?._frozenFortnoxId as string | undefined;
      if (frozenFortnoxId) {
        customerFortnoxId = frozenFortnoxId;
      } else {
        const customerMapping = await storage.getFortnoxMapping(tenantId, "customer", payer.customerId);
        if (!customerMapping) {
          console.warn(`Payer ${payer.id} customer not mapped to Fortnox, skipping`);
          continue;
        }
        customerFortnoxId = customerMapping.fortnoxId;
      }

      // Task #1124: bygg fakturarader via den DELADE radbyggaren (parity enskild
      // ⇄ samlingsfaktura). Frysta koncept-radreferenser blir separata info-rader,
      // radkollaps summerar identiska rader och fast-pris hålls isär. payer styr
      // andel (payerPercentage) + artikelfilter (articleTypes).
      const logicalRows = await buildFortnoxLogicalRowsForWorkOrder({
        tenantId,
        workOrder: workOrder as any,
        lines: workOrderLines,
        objectRefs,
        costCenter: invoiceExport.costCenter ?? null,
        project: invoiceExport.project ?? null,
        payerPercentage,
        articleFilter: payer?.articleTypes ?? undefined,
        resolveArticleNumber: async (articleId) =>
          (await storage.getFortnoxMapping(tenantId, "article", articleId))?.fortnoxId ?? null,
        enforceNetZero: (workOrder as any).subscriptionCovered === true,
        // Task #1204 (91): maskera priser när WO exporteras som följesedel.
        maskPrices: await shouldMaskPricesForDeliveryNote(workOrder as any),
      });
      const invoiceRows = collapseFortnoxLogicalRows(logicalRows);

      if (!invoiceRows.length) continue;

      // Task #1124/#1243: frysta koncept-huvudreferenser + fakturahuvud-fält →
      // Fortnox-huvudet. Frusna värden vinner över objekt-härledd kundreferens
      // (fallback).
      const headerRefs = buildFortnoxHeaderRefs({
        ourReference: (workOrder as any).frozenOurReference,
        ourDesignation: (workOrder as any).frozenOurDesignation,
        customerReference: (workOrder as any).frozenCustomerReference,
        customerInvoiceReference: (workOrder as any).frozenCustomerInvoiceReference,
        fallbackYourReference: objectRefs.kundreferens,
        deliveryMethod: (workOrder as any).frozenDeliveryMethod,
        transportMethod: (workOrder as any).frozenTransportMethod,
        currency: (workOrder as any).frozenCurrency,
        paymentTerms: (workOrder as any).frozenPaymentTerms,
        invoiceLanguage: (workOrder as any).frozenInvoiceLanguage,
      });

      const fortnoxInvoice: FortnoxInvoice = {
        CustomerNumber: customerFortnoxId,
        InvoiceRows: invoiceRows,
        CostCenter: invoiceExport.costCenter || undefined,
        Project: invoiceExport.project || undefined,
        ExternalInvoiceReference2: exportId,
        ...headerRefs,
      };

      try {
        const started = Date.now();
        const response = await client.createInvoice(fortnoxInvoice, metrics);
        await logAttempt({ tenantId, exportId, attemptNumber, action: "create_invoice", result: "success", durationMs: Date.now() - started, userId: triggeredByUserId });
        invoiceNumbers.push(response.Invoice.DocumentNumber);
        totalInvoiced += response.Invoice.Total;
      } catch (error) {
        console.error("Failed to create Fortnox invoice:", error);
        const errorCode = classifyErrorCode(error);
        await logAttempt({ tenantId, exportId, attemptNumber, action: "create_invoice", result: "error", errorCode, errorMessage: error instanceof Error ? error.message : "Unknown error", userId: triggeredByUserId });
        await persistMetrics(tenantId, exportId, metrics);
        await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
          errorCode,
        });
        return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
      }
    }

    await persistMetrics(tenantId, exportId, metrics);

    if (!invoiceNumbers.length) {
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "failed", errorMessage: "No invoice rows could be created", errorCode: "NO_ROWS" });
      return { success: false, error: "No invoice rows could be created" };
    }

    await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
      status: "exported",
      fortnoxInvoiceNumber: invoiceNumbers.join(", "),
      exportedAt: new Date(),
    });

    // Task #558: canonical state-transition för enskild WO efter Fortnox-export.
    // Endast pending → exported är möjlig här; held/consolidated har redan
    // refuserats ovan, så detta är inte en gren för konsoliderade fakturor —
    // dessa exporteras via exportConsolidatedInvoiceToFortnox.
    try {
      const { db } = await import("../db");
      const { workOrders } = await import("@shared/schema");
      const { and, eq } = await import("drizzle-orm");
      await db.update(workOrders)
        .set({ invoiceQueueState: "exported" })
        .where(and(
          eq(workOrders.id, invoiceExport.workOrderId),
          eq(workOrders.tenantId, tenantId),
        ));
    } catch (err) {
      console.warn("[invoice-queue] post-export state transition failed:", err);
    }

    // Task #693: systemgenererad, read-only metadata på objektet — "Senast
    // fakturerad order". Best-effort; ett misslyckande får aldrig bryta exporten.
    try {
      if (workOrder.objectId) {
        const { writeSystemMetadataOnObject } = await import("../metadata-queries");
        await writeSystemMetadataOnObject(
          workOrder.objectId,
          "Senast fakturerad order",
          `${workOrder.title ?? "Arbetsorder"} (${new Date().toISOString().slice(0, 10)})`,
          tenantId,
          `system:wo-invoiced:${workOrder.id}`,
        );
      }
    } catch (err) {
      console.warn("[task-693] writeSystemMetadataOnObject (Senast fakturerad order) failed:", err);
    }

    return { success: true, invoiceNumber: invoiceNumbers.join(", ") };
  } catch (error) {
    console.error("Export to Fortnox failed:", error);
    await persistMetrics(tenantId, exportId, metrics);
    await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      errorCode: classifyErrorCode(error),
    }).catch(() => {});
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

interface InvoiceExportRecord {
  sourceId?: string | null;
  customerId?: string | null;
  costCenter?: string | null;
  project?: string | null;
  [key: string]: unknown;
}

async function exportManualLineToFortnox(
  tenantId: string,
  exportId: string,
  invoiceExport: InvoiceExportRecord,
  attemptNumber: number,
  metrics: FortnoxApiCallMetrics,
): Promise<{ success: boolean; invoiceNumber?: string; error?: string }> {
  try {
    const manualLine = invoiceExport.sourceId ? await storage.getManualInvoiceLine(invoiceExport.sourceId) : null;
    if (!manualLine) {
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
        status: "failed",
        errorMessage: "Manuell fakturarad hittades inte (kan ha raderats)",
        errorCode: "MANUAL_LINE_MISSING",
      });
      return { success: false, error: "Manual invoice line not found" };
    }

    const customerMapping = invoiceExport.customerId
      ? await storage.getFortnoxMapping(tenantId, "customer", invoiceExport.customerId)
      : await storage.getFortnoxMapping(tenantId, "customer", manualLine.customerId);
    if (!customerMapping) {
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "failed", errorMessage: "Customer not mapped to Fortnox", errorCode: "NO_CUSTOMER_MAPPING" });
      return { success: false, error: "Customer not mapped to Fortnox" };
    }

    const client = new FortnoxClient(tenantId);
    const isConnected = await client.isConnected();
    if (!isConnected) {
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "failed", errorMessage: "Fortnox not connected - authorization required", errorCode: "NOT_CONNECTED" });
      return { success: false, error: "Fortnox not connected - authorization required" };
    }

    // Task #1243 idempotens.
    const existingInvoiceNumber = await findExistingInvoiceForExport(client, exportId, metrics);
    if (existingInvoiceNumber) {
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, { status: "exported", fortnoxInvoiceNumber: existingInvoiceNumber, exportedAt: new Date() });
      await persistMetrics(tenantId, exportId, metrics);
      return { success: true, invoiceNumber: existingInvoiceNumber };
    }

    const invoiceRow: Record<string, unknown> = {
      Description: manualLine.description,
      DeliveredQuantity: manualLine.quantity,
      Price: manualLine.unitPrice,
      CostCenter: invoiceExport.costCenter || manualLine.costCenter || undefined,
      Project: invoiceExport.project || manualLine.project || undefined,
    };

    if (manualLine.articleId) {
      const articleMapping = await storage.getFortnoxMapping(tenantId, "article", manualLine.articleId);
      if (articleMapping) {
        invoiceRow.ArticleNumber = articleMapping.fortnoxId;
      }
    }

    const fortnoxInvoice: FortnoxInvoice = {
      CustomerNumber: customerMapping.fortnoxId,
      InvoiceRows: [invoiceRow],
      CostCenter: invoiceExport.costCenter || manualLine.costCenter || undefined,
      Project: invoiceExport.project || manualLine.project || undefined,
      ExternalInvoiceReference2: exportId,
    };

    const started = Date.now();
    const response = await client.createInvoice(fortnoxInvoice, metrics);
    await logAttempt({ tenantId, exportId, attemptNumber, action: "create_invoice", result: "success", durationMs: Date.now() - started });
    await persistMetrics(tenantId, exportId, metrics);
    await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
      status: "exported",
      fortnoxInvoiceNumber: response.Invoice.DocumentNumber,
      totalAmount: Math.round(response.Invoice.Total || 0),
      exportedAt: new Date(),
    });

    if (invoiceExport.sourceId) {
      await storage.updateManualInvoiceLine(invoiceExport.sourceId, tenantId, {
        status: "invoiced",
      });
    }

    return { success: true, invoiceNumber: response.Invoice.DocumentNumber };
  } catch (error) {
    console.error("Manual line export to Fortnox failed:", error);
    const errorCode = classifyErrorCode(error);
    await logAttempt({ tenantId, exportId, attemptNumber, action: "create_invoice", result: "error", errorCode, errorMessage: error instanceof Error ? error.message : "Unknown error" });
    await persistMetrics(tenantId, exportId, metrics);
    await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      errorCode,
    });

    if (invoiceExport.sourceId) {
      await storage.updateManualInvoiceLine(invoiceExport.sourceId, tenantId, {
        status: "draft",
        invoiceExportId: null,
      });
    }

    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function exportCreditInvoiceToFortnox(
  tenantId: string,
  exportId: string,
  invoiceExport: InvoiceExportRecord & { originalExportId?: string },
  attemptNumber: number,
  metrics: FortnoxApiCallMetrics,
): Promise<{ success: boolean; invoiceNumber?: string; error?: string }> {
  try {
    const originalExport = await storage.getFortnoxInvoiceExport(invoiceExport.originalExportId as string);
    if (!originalExport) {
      return { success: false, error: "Original export not found for credit" };
    }

    if (!originalExport.fortnoxInvoiceNumber) {
      return { success: false, error: "Original invoice has no Fortnox invoice number - cannot create credit" };
    }

    const client = new FortnoxClient(tenantId);
    const isConnected = await client.isConnected();
    if (!isConnected) {
      return { success: false, error: "Fortnox not connected - authorization required" };
    }

    try {
      const started = Date.now();
      const creditResponse = await client.creditInvoice(originalExport.fortnoxInvoiceNumber);
      await logAttempt({ tenantId, exportId, attemptNumber, action: "credit_invoice", result: "success", durationMs: Date.now() - started });

      const creditInvoiceNumber = creditResponse?.Invoice?.DocumentNumber || "CREDIT-" + originalExport.fortnoxInvoiceNumber;

      await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
        status: "exported",
        fortnoxInvoiceNumber: creditInvoiceNumber,
        exportedAt: new Date(),
      });

      await storage.updateFortnoxInvoiceExport(invoiceExport.originalExportId!, tenantId, {
        status: "credited",
      });

      return { success: true, invoiceNumber: creditInvoiceNumber };
    } catch (apiError) {
      const errorCode = classifyErrorCode(apiError);
      await logAttempt({ tenantId, exportId, attemptNumber, action: "credit_invoice", result: "error", errorCode, errorMessage: apiError instanceof Error ? apiError.message : "Fortnox credit API error" });
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
        status: "failed",
        errorMessage: apiError instanceof Error ? apiError.message : "Fortnox credit API error",
        errorCode,
      });

      await storage.updateFortnoxInvoiceExport(invoiceExport.originalExportId!, tenantId, {
        creditedByExportId: null,
      });

      return { success: false, error: apiError instanceof Error ? apiError.message : "Fortnox credit API error" };
    }
  } catch (error) {
    console.error("Credit invoice export to Fortnox failed:", error);
    await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      errorCode: classifyErrorCode(error),
    });
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// ============================================
// Task #558: Export av KONSOLIDERAD samlingsfaktura
// ============================================
// Exporterar en customer_invoices-rad (state="consolidated") till Fortnox som
// EN sammanslagen faktura. Iterar workOrderIds, bygger invoiceRows från varje
// WO:s lines (med samma frozen-pris-skalning som per-WO-exporten) och postar
// ett enda createInvoice-anrop. Vid framgång: customer_invoice.state="sent" +
// fortnoxInvoiceId, samt alla WOs.invoiceQueueState="exported" — i en
// transaktion så ingen halv-uppdatering blir kvar vid fel.
export async function exportConsolidatedInvoiceToFortnox(
  tenantId: string,
  invoiceId: string,
): Promise<{ success: boolean; invoiceNumber?: string; error?: string }> {
  try {
    const { db } = await import("../db");
    const { customerInvoices, workOrders, invoiceRecipients } = await import("@shared/schema");
    const { and, eq, inArray } = await import("drizzle-orm");

    const [invoice] = await db
      .select()
      .from(customerInvoices)
      .where(and(
        eq(customerInvoices.id, invoiceId),
        eq(customerInvoices.tenantId, tenantId),
      ));
    if (!invoice) return { success: false, error: "Konsoliderad faktura hittades inte" };
    if (invoice.state !== "consolidated") {
      return { success: false, error: `Fakturan har state="${invoice.state}" — endast 'consolidated' kan exporteras här.` };
    }
    if (invoice.fortnoxInvoiceId) {
      return { success: false, error: "Fakturan är redan exporterad till Fortnox." };
    }

    const woIds = (invoice.workOrderIds as string[] | null) ?? [];
    if (!woIds.length) return { success: false, error: "Inga arbetsorder kopplade till fakturan." };

    // Task #1243 idempotens: samma ExternalInvoiceReference2-mönster som för
    // enskild export — invoiceId används som exportnyckel för konsoliderade
    // fakturor (det finns ingen separat fortnox_invoice_exports-rad här).
    const client = new FortnoxClient(tenantId);
    const metrics = newMetrics();

    // Resolva Fortnox-kundnummer: recipient.fortnoxCustomerId vinner,
    // annars recipient.customerId-mapping, annars invoice.customerId-mapping.
    let customerFortnoxId: string | null = null;
    if (invoice.invoiceRecipientId) {
      const [rec] = await db
        .select()
        .from(invoiceRecipients)
        .where(and(
          eq(invoiceRecipients.id, invoice.invoiceRecipientId),
          eq(invoiceRecipients.tenantId, tenantId),
        ));
      if (rec?.fortnoxCustomerId) {
        customerFortnoxId = rec.fortnoxCustomerId;
      } else if (rec?.customerId) {
        const m = await storage.getFortnoxMapping(tenantId, "customer", rec.customerId);
        if (m) customerFortnoxId = m.fortnoxId;
      }
    }
    if (!customerFortnoxId) {
      const m = await storage.getFortnoxMapping(tenantId, "customer", invoice.customerId);
      if (m) customerFortnoxId = m.fortnoxId;
    }
    if (!customerFortnoxId) {
      return { success: false, error: "Kund/mottagare saknar Fortnox-koppling." };
    }

    if (!(await client.isConnected())) {
      return { success: false, error: "Fortnox är inte ansluten — auktorisering krävs." };
    }

    // Task #1243 idempotens: om en tidigare körning skapade fakturan i Fortnox
    // men uppdateringen av customer_invoices aldrig genomfördes (timeout mellan
    // createInvoice och transaktionen nedan), återanvänd den istället för att
    // skapa en dubblett.
    const existingInvoiceNumber = await findExistingInvoiceForExport(client, invoiceId, metrics);
    if (existingInvoiceNumber) {
      await db.transaction(async (tx) => {
        await tx.update(customerInvoices)
          .set({ state: "sent", fortnoxInvoiceId: existingInvoiceNumber })
          .where(and(eq(customerInvoices.id, invoiceId), eq(customerInvoices.tenantId, tenantId)));
        await tx.update(workOrders)
          .set({ invoiceQueueState: "exported" })
          .where(and(inArray(workOrders.id, woIds), eq(workOrders.tenantId, tenantId)));
      });
      return { success: true, invoiceNumber: existingInvoiceNumber };
    }

    // Bygg invoiceRows från alla WOs via den DELADE radbyggaren. Logiska rader
    // ackumuleras per WO och kollapsas EN gång efter loopen (parity med enskild
    // export + radkollaps över hela samlingsfakturan).
    const allLogicalRows: FortnoxLogicalRow[] = [];
    // Task #693: samla objekt-koppling per WO för "Senast fakturerad order".
    const invoicedObjects: Array<{ objectId: string; title: string }> = [];
    // Task #1025: fakturahuvudet bär EN kundreferens — ta första icke-tomma
    // över de konsoliderade arbetsordrarna (samma helper som enskild export).
    let consolidatedYourReference: string | undefined;
    // Task #1124: defensiv referens-integritetskontroll. Segment-nyckeln
    // (composeSegmentKeyWithReferences) garanterar redan att bara arbetsordrar med
    // identiska frysta huvudreferenser konsolideras ihop — denna vakt fångar en
    // ev. integritetsbrist innan en felaktig referens skickas till Fortnox.
    const referenceMismatches: string[] = [];
    const economyExportBlocked: string[] = [];
    const timeCodeDefs = await storage.getTimeCodeDefinitions(tenantId);
    const timeCodeRuleMap = buildTimeCodeRuleMap(timeCodeDefs);
    for (const woId of woIds) {
      const wo = await storage.getWorkOrder(woId);
      if (!wo || wo.tenantId !== tenantId) continue;
      if (wo.objectId) {
        invoicedObjects.push({ objectId: wo.objectId, title: wo.title ?? "Arbetsorder" });
      }

      // Task #1237: tidskodregistrets economyExport-flagga gäller även samlingsfakturor.
      const frozenTimeCodeKey = (wo as any).frozenTimeCode as string | null | undefined;
      if (frozenTimeCodeKey) {
        const timeCodeRule = resolveTimeCodeRule(timeCodeRuleMap, frozenTimeCodeKey);
        if (!timeCodeRule.economyExport) {
          economyExportBlocked.push(`${woId} (tidskod "${frozenTimeCodeKey}")`);
        }
      }

      const woRefPairs: Array<[string, string | null | undefined, string | null | undefined]> = [
        ["Vår referens", invoice.ourReference, (wo as any).frozenOurReference],
        ["Vår beteckning", invoice.ourDesignation, (wo as any).frozenOurDesignation],
        ["Er referens", invoice.customerReference, (wo as any).frozenCustomerReference],
        ["Ert ordernr", invoice.customerInvoiceReference, (wo as any).frozenCustomerInvoiceReference],
      ];
      for (const [label, invVal, woVal] of woRefPairs) {
        const a = (invVal ?? "").toString().trim();
        const b = (woVal ?? "").toString().trim();
        // Fail-closed: exakt likhet krävs. "faktura tom / WO ifylld" (och tvärtom)
        // är också en konflikt — segment-nyckeln ska redan ha hållit isär dem, så
        // varje avvikelse är en integritetsbrist värd att stoppa. Helt tomma
        // (legacy utan referenser) förblir OK eftersom ""==="".
        if (a !== b) {
          referenceMismatches.push(`${label}: faktura "${a}" ≠ WO ${woId} "${b}"`);
        }
      }
      // Task #1025: berika rader med objektreferenser + per-rad kostnadsställe/
      // projekt (samlingsfakturor saknade dessa). Beräknas en gång per WO.
      const objectRefs = await resolveObjectInvoiceRefs(tenantId, wo);
      if (!consolidatedYourReference && objectRefs.kundreferens) {
        consolidatedYourReference = objectRefs.kundreferens.slice(0, 50);
      }
      const derivedCodes = await deriveFortnoxCodesForWorkOrder(tenantId, wo);
      const lines = await enrichLinesWithArticleInvoiceFlags(
        await storage.getWorkOrderLines(woId),
      );
      if (!lines.length) continue;
      // Task #1124: ackumulera logiska rader (kollaps körs en gång efter loopen).
      // Frozen-skalning, fritextrader, info-rader och fast-pris hanteras inuti
      // radbyggaren — IDENTISKT med enskild export.
      allLogicalRows.push(
        ...(await buildFortnoxLogicalRowsForWorkOrder({
          tenantId,
          workOrder: wo as any,
          lines,
          objectRefs,
          costCenter: derivedCodes.costCenter ?? null,
          project: derivedCodes.project ?? null,
          resolveArticleNumber: async (articleId) =>
            (await storage.getFortnoxMapping(tenantId, "article", articleId))?.fortnoxId ?? null,
          enforceNetZero: (wo as any).subscriptionCovered === true,
          // Task #1204 (91): maskera priser när WO exporteras som följesedel.
          maskPrices: await shouldMaskPricesForDeliveryNote(wo as any),
        })),
      );
    }
    if (referenceMismatches.length > 0) {
      return {
        success: false,
        error:
          "Referens-konflikt i samlingsfaktura (frysta huvudreferenser skiljer mellan arbetsordrar): " +
          referenceMismatches.join("; "),
      };
    }
    if (economyExportBlocked.length > 0) {
      return {
        success: false,
        error:
          "Samlingsfakturan innehåller arbetsordrar med tidskod utan ekonomiexport: " +
          economyExportBlocked.join("; "),
      };
    }
    const invoiceRows = collapseFortnoxLogicalRows(allLogicalRows);
    if (!invoiceRows.length) {
      return { success: false, error: "Inga fakturarader kunde byggas från konsoliderade WOs." };
    }

    // Task #1124/#1243: frysta koncept-huvudreferenser (persisterade på fakturan
    // från wos[0]) → Fortnox-huvudet. Frusna värden vinner; objekt-härledd
    // kundreferens (consolidatedYourReference) är back-compat-fallback för
    // "Er referens". Fakturahuvud-fälten speglas från customer_invoices (frysta
    // i samma steg som referenserna, se assignment-invoice-materializer).
    const headerRefs = buildFortnoxHeaderRefs({
      ourReference: invoice.ourReference,
      ourDesignation: invoice.ourDesignation,
      customerReference: invoice.customerReference,
      customerInvoiceReference: invoice.customerInvoiceReference,
      fallbackYourReference: consolidatedYourReference,
      deliveryMethod: (invoice as any).deliveryMethod,
      transportMethod: (invoice as any).transportMethod,
      currency: (invoice as any).invoiceCurrency,
      paymentTerms: (invoice as any).paymentTerms,
      invoiceLanguage: (invoice as any).invoiceLanguage,
    });

    const fortnoxInvoice: FortnoxInvoice = {
      CustomerNumber: customerFortnoxId,
      InvoiceRows: invoiceRows,
      ExternalInvoiceReference2: invoiceId,
      ...headerRefs,
    };

    const response = await client.createInvoice(fortnoxInvoice, metrics);
    const fortnoxNumber = response.Invoice.DocumentNumber;

    // Atomisk state-transition: invoice → sent, alla WOs → exported.
    await db.transaction(async (tx) => {
      await tx.update(customerInvoices)
        .set({
          state: "sent",
          fortnoxInvoiceId: fortnoxNumber,
          totalAmount: Math.round(response.Invoice.Total ?? invoice.totalAmount ?? 0),
        })
        .where(and(
          eq(customerInvoices.id, invoiceId),
          eq(customerInvoices.tenantId, tenantId),
        ));
      await tx.update(workOrders)
        .set({ invoiceQueueState: "exported" })
        .where(and(
          inArray(workOrders.id, woIds),
          eq(workOrders.tenantId, tenantId),
        ));
    });

    // Task #693: systemgenererad, read-only metadata per objekt — "Senast
    // fakturerad order". Best-effort; ett misslyckande får aldrig bryta exporten.
    try {
      const { writeSystemMetadataOnObject } = await import("../metadata-queries");
      const stamp = new Date().toISOString().slice(0, 10);
      for (const obj of invoicedObjects) {
        await writeSystemMetadataOnObject(
          obj.objectId,
          "Senast fakturerad order",
          `${obj.title} (${stamp})`,
          tenantId,
          `system:wo-invoiced-consolidated:${invoiceId}`,
        ).catch((err) =>
          console.warn(`[task-693] writeSystemMetadataOnObject (consolidated) failed for object ${obj.objectId}:`, err),
        );
      }
    } catch (err) {
      console.warn("[task-693] writeSystemMetadataOnObject (Senast fakturerad order, consolidated) failed:", err);
    }

    return { success: true, invoiceNumber: fortnoxNumber };
  } catch (error) {
    console.error("[consolidated-export] Fortnox-export misslyckades:", error);
    return { success: false, error: error instanceof Error ? error.message : "Okänt fel" };
  }
}
