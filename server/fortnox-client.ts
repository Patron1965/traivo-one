import { storage } from "./storage";
import {
  resolveObjectInvoiceRefs,
  buildFortnoxHeaderRefs,
} from "./services/invoice-line-enrichment";
import {
  buildFortnoxLogicalRowsForWorkOrder,
  collapseFortnoxLogicalRows,
  type FortnoxLogicalRow,
} from "./services/fortnox-invoice-row-builder";
import { deriveFortnoxCodesForWorkOrder } from "./services/fortnox-code-derivation";

const FORTNOX_API_BASE = "https://api.fortnox.se/3";
const FORTNOX_AUTH_URL = "https://apps.fortnox.se/oauth-v1/auth";
const FORTNOX_TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";

// Dynamic import for ESM-only packages
let rateLimiter: ReturnType<typeof import("p-limit").default> | null = null;
let pRetryFn: typeof import("p-retry").default | null = null;

async function getRateLimiter() {
  if (!rateLimiter) {
    const pLimitModule = await import("p-limit");
    const pLimit = pLimitModule.default;
    rateLimiter = pLimit(5);
  }
  return rateLimiter;
}

async function getPRetry() {
  if (!pRetryFn) {
    const pRetryModule = await import("p-retry");
    pRetryFn = pRetryModule.default;
  }
  return pRetryFn;
}

interface FortnoxCustomer {
  CustomerNumber: string;
  Name: string;
  Email?: string;
  Phone1?: string;
  Address1?: string;
  ZipCode?: string;
  City?: string;
  OrganisationNumber?: string;
  [key: string]: string | number | boolean | null | undefined;
}

interface FortnoxArticle {
  ArticleNumber: string;
  Description: string;
  SalesPrice?: number;
  Unit?: string;
  Active?: boolean;
  [key: string]: string | number | boolean | null | undefined;
}

interface FortnoxCostCenter {
  Code: string;
  Description: string;
  Active?: boolean;
  [key: string]: string | number | boolean | null | undefined;
}

interface FortnoxProject {
  ProjectNumber: string;
  Description: string;
  Status?: string;
  CustomerNumber?: string;
  CustomerName?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface FortnoxDeliveryAddress {
  DeliveryAddressId: string;
  CustomerNumber: string;
  CustomerName?: string;
  Address1?: string;
  Address2?: string;
  ZipCode?: string;
  City?: string;
  Country?: string;
  Comments?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface FortnoxContactPerson {
  ContactPersonId?: string | number;
  ContactPersonName?: string;
  CustomerNumber?: string;
  Email?: string;
  EmailInvoice?: string;
  Phone1?: string;
  Phone2?: string;
  Position?: string;
  Comments?: string;
  [key: string]: string | number | boolean | null | undefined;
}

interface FortnoxPaginatedResponse<T> {
  MetaInformation?: { "@TotalPages": number; "@CurrentPage": number };
  [key: string]: T[] | { "@TotalPages": number; "@CurrentPage": number } | undefined;
}

interface FortnoxTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface FortnoxInvoice {
  CustomerNumber: string;
  InvoiceRows: Array<Record<string, unknown>>;
  CostCenter?: string;
  Project?: string;
  // Task #1025: "Er referens" på fakturahuvudet (Fortnox standardfält, max 50
  // tecken) — bär kundreferens när radmodellen saknar referensfält.
  YourReference?: string;
  // Task #1124: frysta koncept-huvudreferenser (informationspaketet från den
  // utförda uppgiften). Se buildFortnoxHeaderRefs för kanonisk mappning.
  OurReference?: string;
  YourOrderNumber?: string;
  Remarks?: string;
}

interface FortnoxInvoiceResponse {
  Invoice: {
    DocumentNumber: string;
    CustomerNumber: string;
    Total: number;
  };
}

export class FortnoxClient {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  async getAuthorizationUrlWithConfig(redirectUri: string, state: string): Promise<string | null> {
    const config = await storage.getFortnoxConfig(this.tenantId);
    if (!config?.clientId) return null;

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: "invoice customer article costcenter project",
      state: state,
      access_type: "offline",
      response_type: "code",
    });
    return `${FORTNOX_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<boolean> {
    const config = await storage.getFortnoxConfig(this.tenantId);
    if (!config?.clientId || !config?.clientSecret) {
      throw new Error("Fortnox configuration missing");
    }

    const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

    const response = await fetch(FORTNOX_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Fortnox token exchange failed:", errorText);
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const tokenData: FortnoxTokenResponse = await response.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    await storage.updateFortnoxConfig(this.tenantId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: expiresAt,
      isActive: true,
    });

    return true;
  }

  async refreshAccessToken(): Promise<boolean> {
    const config = await storage.getFortnoxConfig(this.tenantId);
    if (!config?.clientId || !config?.clientSecret || !config?.refreshToken) {
      throw new Error("Fortnox refresh token missing");
    }

    const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

    const response = await fetch(FORTNOX_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: config.refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Fortnox token refresh failed:", errorText);
      await storage.updateFortnoxConfig(this.tenantId, {
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        isActive: false,
      });
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const tokenData: FortnoxTokenResponse = await response.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    await storage.updateFortnoxConfig(this.tenantId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: expiresAt,
    });

    return true;
  }

  private async getValidAccessToken(): Promise<string> {
    const config = await storage.getFortnoxConfig(this.tenantId);
    if (!config?.accessToken) {
      throw new Error("No access token available - authorization required");
    }

    if (config.tokenExpiresAt && new Date(config.tokenExpiresAt) <= new Date(Date.now() + 60000)) {
      await this.refreshAccessToken();
      const refreshedConfig = await storage.getFortnoxConfig(this.tenantId);
      if (!refreshedConfig?.accessToken) {
        throw new Error("Failed to refresh access token");
      }
      return refreshedConfig.accessToken;
    }

    return config.accessToken;
  }

  private async apiRequest<T>(
    method: string,
    endpoint: string,
    body?: object
  ): Promise<T> {
    const limiter = await getRateLimiter();
    const pRetry = await getPRetry();
    
    return limiter(() =>
      pRetry(
        async () => {
          const accessToken = await this.getValidAccessToken();

          const response = await fetch(`${FORTNOX_API_BASE}${endpoint}`, {
            method,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: body ? JSON.stringify(body) : undefined,
          });

          if (response.status === 429) {
            const retryAfter = response.headers.get("Retry-After");
            const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            throw new Error("Rate limited");
          }

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Fortnox API error ${response.status}: ${errorText}`);
          }

          return response.json();
        },
        {
          retries: 3,
          minTimeout: 1000,
          maxTimeout: 10000,
        }
      )
    );
  }

  async createInvoice(invoice: FortnoxInvoice): Promise<FortnoxInvoiceResponse> {
    return this.apiRequest<FortnoxInvoiceResponse>("POST", "/invoices", {
      Invoice: invoice,
    });
  }

  async creditInvoice(invoiceNumber: string): Promise<FortnoxInvoiceResponse> {
    return this.apiRequest<FortnoxInvoiceResponse>("PUT", `/invoices/${invoiceNumber}/credit`);
  }

  async getCustomer(customerNumber: string): Promise<{ Customer: FortnoxCustomer }> {
    return this.apiRequest<{ Customer: FortnoxCustomer }>("GET", `/customers/${customerNumber}`);
  }

  async getArticle(articleNumber: string): Promise<{ Article: FortnoxArticle }> {
    return this.apiRequest<{ Article: FortnoxArticle }>("GET", `/articles/${articleNumber}`);
  }

  async getCostCenters(): Promise<FortnoxCostCenter[]> {
    const all: FortnoxCostCenter[] = [];
    let currentPage = 1;
    let totalPages = 1;
    while (currentPage <= totalPages) {
      const response = await this.apiRequest<FortnoxPaginatedResponse<FortnoxCostCenter>>("GET", `/costcenters?limit=500&page=${currentPage}`);
      if (response?.CostCenters) all.push(...(response.CostCenters as FortnoxCostCenter[]));
      if (response?.MetaInformation) totalPages = response.MetaInformation["@TotalPages"] || 1;
      currentPage++;
    }
    return all;
  }

  async getProjects(): Promise<FortnoxProject[]> {
    const all: FortnoxProject[] = [];
    let currentPage = 1;
    let totalPages = 1;
    while (currentPage <= totalPages) {
      const response = await this.apiRequest<FortnoxPaginatedResponse<FortnoxProject>>("GET", `/projects?limit=500&page=${currentPage}`);
      if (response?.Projects) all.push(...(response.Projects as FortnoxProject[]));
      if (response?.MetaInformation) totalPages = response.MetaInformation["@TotalPages"] || 1;
      currentPage++;
    }
    return all;
  }

  async getDeliveryAddresses(): Promise<FortnoxDeliveryAddress[]> {
    const all: FortnoxDeliveryAddress[] = [];
    let currentPage = 1;
    let totalPages = 1;
    while (currentPage <= totalPages) {
      const response = await this.apiRequest<FortnoxPaginatedResponse<FortnoxDeliveryAddress>>("GET", `/deliveryaddresses?limit=500&page=${currentPage}`);
      if (response?.DeliveryAddresses) all.push(...(response.DeliveryAddresses as FortnoxDeliveryAddress[]));
      if (response?.MetaInformation) totalPages = response.MetaInformation["@TotalPages"] || 1;
      currentPage++;
    }
    return all;
  }

  async getArticles(): Promise<FortnoxArticle[]> {
    const all: FortnoxArticle[] = [];
    let currentPage = 1;
    let totalPages = 1;
    while (currentPage <= totalPages) {
      const response = await this.apiRequest<FortnoxPaginatedResponse<FortnoxArticle>>("GET", `/articles?limit=500&page=${currentPage}`);
      if (response?.Articles) all.push(...(response.Articles as FortnoxArticle[]));
      if (response?.MetaInformation) totalPages = response.MetaInformation["@TotalPages"] || 1;
      currentPage++;
    }
    return all;
  }

  async getCustomers(): Promise<FortnoxCustomer[]> {
    const allCustomers: FortnoxCustomer[] = [];
    let currentPage = 1;
    let totalPages = 1;

    while (currentPage <= totalPages) {
      const response = await this.apiRequest<FortnoxPaginatedResponse<FortnoxCustomer>>("GET", `/customers?limit=500&page=${currentPage}`);
      if (response?.Customers) {
        allCustomers.push(...(response.Customers as FortnoxCustomer[]));
      }
      if (response?.MetaInformation) {
        totalPages = response.MetaInformation["@TotalPages"] || 1;
      }
      currentPage++;
    }

    return allCustomers;
  }

  async getCustomerContacts(customerNumber: string): Promise<FortnoxContactPerson[]> {
    try {
      const response = await this.apiRequest<{ ContactPersons?: FortnoxContactPerson[] }>(
        "GET",
        `/customers/${encodeURIComponent(customerNumber)}/contactpersons`
      );
      return response?.ContactPersons || [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404")) return [];
      throw err;
    }
  }

  async getCustomerDetails(customerNumber: string): Promise<FortnoxCustomer | null> {
    const response = await this.apiRequest<{ Customer: FortnoxCustomer }>("GET", `/customers/${customerNumber}`);
    return response?.Customer || null;
  }

  async isConnected(): Promise<boolean> {
    const config = await storage.getFortnoxConfig(this.tenantId);
    return !!(config?.accessToken && config?.isActive);
  }
}

export async function exportWorkOrderToFortnox(
  tenantId: string,
  exportId: string
): Promise<{ success: boolean; invoiceNumber?: string; error?: string }> {
  try {
    const invoiceExport = await storage.getFortnoxInvoiceExport(exportId);
    if (!invoiceExport || invoiceExport.tenantId !== tenantId) {
      return { success: false, error: "Export not found" };
    }

    if (invoiceExport.sourceType === "manual") {
      return await exportManualLineToFortnox(tenantId, exportId, invoiceExport);
    }

    if (invoiceExport.isCreditInvoice && invoiceExport.originalExportId) {
      return await exportCreditInvoiceToFortnox(tenantId, exportId, invoiceExport);
    }

    if (!invoiceExport.workOrderId) {
      return { success: false, error: "No work order ID for this export" };
    }

    const workOrder = await storage.getWorkOrder(invoiceExport.workOrderId);
    if (!workOrder) {
      return { success: false, error: "Work order not found" };
    }

    // Task #558: Fortnox-export refuserar `held` och `consolidated` WOs.
    // - `held`: vänta på periodstängning eller släpp via Fakturakö.
    // - `consolidated`: redan länkad till en customer_invoice — den ska
    //   exporteras som sammanslagen post, inte som enskild WO-rad.
    const queueState = (workOrder as any).invoiceQueueState as string | null | undefined;
    if (queueState === "held") {
      return {
        success: false,
        error:
          "Arbetsordern är bromsad i konsolideringskön. Släpp den via Fakturakö eller vänta tills perioden stänger.",
      };
    }
    if (queueState === "consolidated") {
      return {
        success: false,
        error:
          "Arbetsordern ingår i en konsoliderad samlingsfaktura och får inte exporteras enskilt. Exportera den konsoliderade fakturan istället.",
      };
    }

    const workOrderLines = await storage.getWorkOrderLines(invoiceExport.workOrderId);
    if (!workOrderLines.length) {
      return { success: false, error: "No work order lines to invoice" };
    }

    // ADR v3 §2.3 (Task #556): Om WO har frusen fakturamottagare vinner den
    // över object_payers/objects.customer_id. payerId-override på exporten
    // (manuell split) går alltid först. NULL = back-compat (gammalt beteende).
    let frozenRecipientFortnoxId: string | null = null;
    if (!invoiceExport.payerId && (workOrder as any).frozenInvoiceRecipientId) {
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

    const objectPayers = invoiceExport.payerId 
      ? [await storage.getObjectPayer(invoiceExport.payerId)]
      : (workOrder.objectId ? await storage.getObjectPayers(workOrder.objectId) : []);

    const validPayers = objectPayers.filter(Boolean);

    // ADR v3 §2.3 (Task #556): När WO har frusen fakturamottagare overridar
    // den object_payers — vi byter ut payer-listan mot en syntetisk payer
    // som routas till mottagarens Fortnox-kund. payerId-override (manuell
    // split) går alltid först och har redan begränsat validPayers ovan.
    if (frozenRecipientFortnoxId && !invoiceExport.payerId) {
      validPayers.length = 0;
      validPayers.push({
        id: `frozen-recipient:${(workOrder as any).frozenInvoiceRecipientId}`,
        customerId: (workOrder as any).frozenInvoiceSourceCustomerId || workOrder.customerId,
        sharePercent: 100,
        articleTypes: [],
        _frozenFortnoxId: frozenRecipientFortnoxId,
      } as any);
    }

    // Tidigare fanns en fallback som plockade `obj.customerId` från legacy
    // objects.customer_id-kolumnen om inga object_payers hittades. Den
    // kolumnen är på väg ut (ADR v3 — objekt är neutrala) och får inte
    // längre läsas. Saknas payer är det ett konfigurationsfel som måste
    // åtgärdas explicit via object_payers (eller via frusen fakturamottagare
    // på WO) innan WO kan faktureras.
    if (!validPayers.length) {
      return {
        success: false,
        error:
          "Ingen payer registrerad för objektet. Lägg till minst en betalare i object_payers innan fakturering.",
      };
    }

    const client = new FortnoxClient(tenantId);
    const isConnected = await client.isConnected();
    if (!isConnected) {
      return { success: false, error: "Fortnox not connected - authorization required" };
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
      });
      const invoiceRows = collapseFortnoxLogicalRows(logicalRows);

      if (!invoiceRows.length) continue;

      // Task #1124: frysta koncept-huvudreferenser → Fortnox-huvudet. Frusna
      // värden vinner över objekt-härledd kundreferens (fallback).
      const headerRefs = buildFortnoxHeaderRefs({
        ourReference: (workOrder as any).frozenOurReference,
        ourDesignation: (workOrder as any).frozenOurDesignation,
        customerReference: (workOrder as any).frozenCustomerReference,
        customerInvoiceReference: (workOrder as any).frozenCustomerInvoiceReference,
        fallbackYourReference: objectRefs.kundreferens,
      });

      const fortnoxInvoice: FortnoxInvoice = {
        CustomerNumber: customerFortnoxId,
        InvoiceRows: invoiceRows,
        CostCenter: invoiceExport.costCenter || undefined,
        Project: invoiceExport.project || undefined,
        ...headerRefs,
      };

      try {
        const response = await client.createInvoice(fortnoxInvoice);
        invoiceNumbers.push(response.Invoice.DocumentNumber);
        totalInvoiced += response.Invoice.Total;
      } catch (error) {
        console.error("Failed to create Fortnox invoice:", error);
        await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        });
        return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
      }
    }

    if (!invoiceNumbers.length) {
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
      const { db } = await import("./db");
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
        const { writeSystemMetadataOnObject } = await import("./metadata-queries");
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
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

interface InvoiceExportRecord {
  sourceId?: string | null;
  customerId?: string | null;
  costCenter?: string | null;
  project?: string | null;
  [key: string]: string | number | boolean | null | undefined;
}

async function exportManualLineToFortnox(
  tenantId: string,
  exportId: string,
  invoiceExport: InvoiceExportRecord
): Promise<{ success: boolean; invoiceNumber?: string; error?: string }> {
  try {
    const manualLine = invoiceExport.sourceId ? await storage.getManualInvoiceLine(invoiceExport.sourceId) : null;
    if (!manualLine) {
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
        status: "failed",
        errorMessage: "Manuell fakturarad hittades inte (kan ha raderats)",
      });
      return { success: false, error: "Manual invoice line not found" };
    }

    const customerMapping = invoiceExport.customerId
      ? await storage.getFortnoxMapping(tenantId, "customer", invoiceExport.customerId)
      : await storage.getFortnoxMapping(tenantId, "customer", manualLine.customerId);
    if (!customerMapping) {
      return { success: false, error: "Customer not mapped to Fortnox" };
    }

    const client = new FortnoxClient(tenantId);
    const isConnected = await client.isConnected();
    if (!isConnected) {
      return { success: false, error: "Fortnox not connected - authorization required" };
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
    };

    const response = await client.createInvoice(fortnoxInvoice);
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
    await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
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
  invoiceExport: InvoiceExportRecord & { originalExportId?: string }
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
      const creditResponse = await client.creditInvoice(originalExport.fortnoxInvoiceNumber);

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
      await storage.updateFortnoxInvoiceExport(exportId, tenantId, {
        status: "failed",
        errorMessage: apiError instanceof Error ? apiError.message : "Fortnox credit API error",
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
    });
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export function createFortnoxClient(tenantId: string): FortnoxClient {
  return new FortnoxClient(tenantId);
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
    const { db } = await import("./db");
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

    const client = new FortnoxClient(tenantId);
    if (!(await client.isConnected())) {
      return { success: false, error: "Fortnox är inte ansluten — auktorisering krävs." };
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
    for (const woId of woIds) {
      const wo = await storage.getWorkOrder(woId);
      if (!wo || wo.tenantId !== tenantId) continue;
      if (wo.objectId) {
        invoicedObjects.push({ objectId: wo.objectId, title: wo.title ?? "Arbetsorder" });
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
      const lines = await storage.getWorkOrderLines(woId);
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
    const invoiceRows = collapseFortnoxLogicalRows(allLogicalRows);
    if (!invoiceRows.length) {
      return { success: false, error: "Inga fakturarader kunde byggas från konsoliderade WOs." };
    }

    // Task #1124: frysta koncept-huvudreferenser (persisterade på fakturan från
    // wos[0]) → Fortnox-huvudet. Frusna värden vinner; objekt-härledd kundreferens
    // (consolidatedYourReference) är back-compat-fallback för "Er referens".
    const headerRefs = buildFortnoxHeaderRefs({
      ourReference: invoice.ourReference,
      ourDesignation: invoice.ourDesignation,
      customerReference: invoice.customerReference,
      customerInvoiceReference: invoice.customerInvoiceReference,
      fallbackYourReference: consolidatedYourReference,
    });

    const fortnoxInvoice: FortnoxInvoice = {
      CustomerNumber: customerFortnoxId,
      InvoiceRows: invoiceRows,
      ...headerRefs,
    };

    const response = await client.createInvoice(fortnoxInvoice);
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
      const { writeSystemMetadataOnObject } = await import("./metadata-queries");
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
