import { storage } from "./storage";

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

    const workOrderLines = await storage.getWorkOrderLines(invoiceExport.workOrderId);
    if (!workOrderLines.length) {
      return { success: false, error: "No work order lines to invoice" };
    }

    const objectPayers = invoiceExport.payerId 
      ? [await storage.getObjectPayer(invoiceExport.payerId)]
      : await storage.getObjectPayers(workOrder.objectId);

    const validPayers = objectPayers.filter(Boolean);
    
    let fallbackCustomerMapping: { fortnoxId: string } | null = null;
    if (!validPayers.length) {
      const obj = await storage.getObject(workOrder.objectId);
      if (!obj?.customerId) {
        return { success: false, error: "No payer or customer found for work order" };
      }
      fallbackCustomerMapping = await storage.getFortnoxMapping(tenantId, "customer", obj.customerId) || null;
      if (!fallbackCustomerMapping) {
        return { success: false, error: "Customer not mapped to Fortnox" };
      }
    }

    const client = new FortnoxClient(tenantId);
    const isConnected = await client.isConnected();
    if (!isConnected) {
      return { success: false, error: "Fortnox not connected - authorization required" };
    }

    let totalInvoiced = 0;
    const invoiceNumbers: string[] = [];

    for (const payer of validPayers.length ? validPayers : [null]) {
      const payerPercentage = payer?.sharePercent || 100;
      let customerFortnoxId: string;
      
      if (payer?.customerId) {
        const customerMapping = await storage.getFortnoxMapping(tenantId, "customer", payer.customerId);
        if (!customerMapping) {
          console.warn(`Payer ${payer.id} customer not mapped to Fortnox, skipping`);
          continue;
        }
        customerFortnoxId = customerMapping.fortnoxId;
      } else if (fallbackCustomerMapping) {
        customerFortnoxId = fallbackCustomerMapping.fortnoxId;
      } else {
        console.warn("No customer mapping available, skipping");
        continue;
      }

      const invoiceRows = [];
      // ADR v3 (F6): Anvand frozen-snapshot om WO ar fryst.
      // frozenUnitPrice ar ett WO-niva-genomsnitt (totalPrice / totalQty),
      // sa att applicera det per rad ger fel summa. Lasningen: skala varje
      // rads pris proportionellt sa att fakturasumman exakt matchar
      // frozenUnitPrice * frozenQuantity (audit-snapshotet) men artikel-
      // granulariteten bevaras.
      const useFrozen =
        (workOrder as any).frozenUnitPrice != null &&
        (workOrder as any).frozenQuantity != null &&
        Number((workOrder as any).frozenQuantity) > 0;
      let scale = 1;
      if (useFrozen) {
        const currentTotal = workOrderLines.reduce(
          (s, l) => s + Number(l.resolvedPrice ?? 0) * Number(l.quantity ?? 1),
          0
        );
        const frozenTotal =
          Number((workOrder as any).frozenUnitPrice) *
          Number((workOrder as any).frozenQuantity);
        scale = currentTotal > 0 ? frozenTotal / currentTotal : 1;
      }
      for (const line of workOrderLines) {
        if (payer?.articleTypes?.length && !payer.articleTypes.includes(line.articleId)) {
          continue;
        }

        const articleMapping = await storage.getFortnoxMapping(tenantId, "article", line.articleId);
        if (!articleMapping) {
          console.warn(`Article ${line.articleId} not mapped to Fortnox, skipping line`);
          continue;
        }

        const quantity = line.quantity * (payerPercentage / 100);
        const basePrice = Number(line.resolvedPrice ?? 0);
        const price = useFrozen
          ? Math.round(basePrice * scale * 100) / 100
          : (line.resolvedPrice || undefined);
        invoiceRows.push({
          ArticleNumber: articleMapping.fortnoxId,
          DeliveredQuantity: quantity,
          Description: line.notes || (useFrozen ? "Fryst pris (audit-snapshot)" : undefined),
          Price: price,
          CostCenter: invoiceExport.costCenter || undefined,
          Project: invoiceExport.project || undefined,
        });
      }

      if (!invoiceRows.length) continue;

      const fortnoxInvoice: FortnoxInvoice = {
        CustomerNumber: customerFortnoxId,
        InvoiceRows: invoiceRows,
        CostCenter: invoiceExport.costCenter || undefined,
        Project: invoiceExport.project || undefined,
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
