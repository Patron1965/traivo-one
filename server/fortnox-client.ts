// Task #1243: server/fortnox-client.ts innehåller ENDAST rena API-anrop mot
// Fortnox (auth, HTTP, retries/rate-limit, CRUD mot Fortnox-resurser). All
// affärslogik (radbyggnad, kundupplösning, idempotens, exportlogg) bor i
// server/services/fortnox-export-service.ts.
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

export interface FortnoxInvoice {
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
  // Task #1243: fakturahuvud-fält (leverans/betalning/valuta/språk).
  WayOfDelivery?: string;
  TermsOfDelivery?: string;
  Currency?: string;
  TermsOfPayment?: string;
  Language?: string;
  // Task #1517: strukturerad leveransadress (snabborderns manuella adress,
  // lagrad i work_orders.metadata.deliveryAddress) → Fortnox fakturahuvud.
  DeliveryAddress1?: string;
  DeliveryAddress2?: string;
  DeliveryZipCode?: string;
  DeliveryCity?: string;
  DeliveryCountry?: string;
  // Task #1243 idempotens: exportId speglas hit så en avbruten/omprövad export
  // kan hittas igen via findInvoiceByExternalReference2 innan en dubblett skapas.
  ExternalInvoiceReference2?: string;
}

// Task #1243: mutabel metrics-samlare som apiRequest fyller i under ett anrop.
export interface FortnoxApiCallMetrics {
  calls: number;
  retries: number;
  waitMs: number;
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

  // Task #1243: valfri mutabel metrics-samlare. Business-lagret (fortnox-export-service)
  // skickar in ett objekt som fylls i under anropet — enda källan till API-call-count/
  // retry-count/väntetid för exportloggen. apiRequest är fortfarande den enda platsen
  // som faktiskt pratar med Fortnox, så detta är den naturliga instrumenteringspunkten.
  async apiRequest<T>(
    method: string,
    endpoint: string,
    body?: object,
    metrics?: FortnoxApiCallMetrics,
  ): Promise<T> {
    const limiter = await getRateLimiter();
    const pRetry = await getPRetry();

    return limiter(() =>
      pRetry(
        async () => {
          if (metrics) metrics.calls += 1;
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
            if (metrics) metrics.waitMs += waitMs;
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
          onFailedAttempt: () => {
            if (metrics) metrics.retries += 1;
          },
        }
      )
    );
  }

  async createInvoice(invoice: FortnoxInvoice, metrics?: FortnoxApiCallMetrics): Promise<FortnoxInvoiceResponse> {
    return this.apiRequest<FortnoxInvoiceResponse>("POST", "/invoices", {
      Invoice: invoice,
    }, metrics);
  }

  // Task #1243 idempotens: slå upp faktura via ExternalInvoiceReference2 (=exportId)
  // innan ny skapas, för att upptäcka en tidigare lyckad men obekräftad export
  // (t.ex. timeout efter att Fortnox skapat fakturan men innan svaret nådde oss).
  async findInvoiceByExternalReference2(exportId: string, metrics?: FortnoxApiCallMetrics): Promise<{ DocumentNumber: string } | null> {
    try {
      const response = await this.apiRequest<{ Invoices?: Array<{ DocumentNumber: string }> }>(
        "GET",
        `/invoices?externalinvoicereference2=${encodeURIComponent(exportId)}`,
        undefined,
        metrics,
      );
      const hit = response?.Invoices?.[0];
      return hit ? { DocumentNumber: hit.DocumentNumber } : null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404")) return null;
      throw err;
    }
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

export function createFortnoxClient(tenantId: string): FortnoxClient {
  return new FortnoxClient(tenantId);
}


