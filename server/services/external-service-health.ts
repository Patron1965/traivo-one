import { logger } from "../logger";
import { storage } from "../storage";

export type IntegrationStatus = "ok" | "degraded" | "down" | "not_configured";
export type IntegrationSeverity = "critical" | "important" | "optional";

export interface IntegrationHealth {
  id: string;
  label: string;
  status: IntegrationStatus;
  severity: IntegrationSeverity;
  detail?: string;
  fallback?: string;
  lastCheckedAt: string;
  latencyMs?: number;
}

export interface IntegrationsHealthSnapshot {
  overall: "ok" | "degraded";
  checkedAt: string;
  integrations: IntegrationHealth[];
}

interface Definition {
  id: string;
  label: string;
  severity: IntegrationSeverity;
  fallback: string;
  /** Returnerar status-fält; om null hoppas integrationen över i global snapshot (t.ex. per-tenant Fortnox). */
  check: (tenantId?: string) => Promise<
    Omit<IntegrationHealth, "id" | "label" | "severity" | "fallback" | "lastCheckedAt"> | null
  >;
  /** Per-tenant-integration — körs inte av scheduler, bara per-request med tenantId. */
  perTenant?: boolean;
}

function envOk(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim() !== "";
}

// =============================================================================
// Geoapify liveness — cheapest available endpoint är autocomplete med limit=1.
// 3s timeout för att inte själv bli en latensbov om Geoapify svarar långsamt.
// =============================================================================
async function pingGeoapify(): Promise<{
  status: IntegrationStatus;
  detail?: string;
  latencyMs?: number;
}> {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key || key.trim() === "") {
    return { status: "not_configured", detail: "GEOAPIFY_API_KEY saknas" };
  }
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=stockholm&limit=1&apiKey=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: controller.signal });
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return { status: "ok", latencyMs };
    }
    if (res.status === 401 || res.status === 403) {
      return { status: "down", latencyMs, detail: `Autentiseringsfel HTTP ${res.status}` };
    }
    if (res.status === 429) {
      return { status: "degraded", latencyMs, detail: "Rate-limit (HTTP 429)" };
    }
    if (res.status >= 500) {
      return { status: "down", latencyMs, detail: `Geoapify ${res.status}` };
    }
    return { status: "degraded", latencyMs, detail: `HTTP ${res.status}` };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("aborted") || err instanceof DOMException) {
      return { status: "degraded", latencyMs, detail: "Timeout (>3s)" };
    }
    return { status: "down", latencyMs, detail: msg };
  } finally {
    clearTimeout(timer);
  }
}

const DEFINITIONS: Definition[] = [
  {
    id: "geoapify",
    label: "Geoapify (routing, geokod, kart-tiles, VRP)",
    severity: "critical",
    fallback:
      "OSRM (om OSRM_BASE_URL satt) för rutter; Haversine för avstånd; OSM-tiles. VRP/Route Planner är inte tillgängligt — optimering måste köras via OR-Tools eller manuell planering.",
    check: async () => pingGeoapify(),
  },
  {
    id: "openai",
    label: "OpenAI (AI-förslag, protokoll, chat)",
    severity: "important",
    fallback:
      "AI-genererade förslag, sammanfattningar och chat-svar avaktiveras tillfälligt. Manuell planering och redigering fungerar.",
    check: async () => {
      if (!envOk("AI_INTEGRATIONS_OPENAI_API_KEY")) {
        return { status: "not_configured", detail: "AI_INTEGRATIONS_OPENAI_API_KEY saknas" };
      }
      return { status: "ok" };
    },
  },
  {
    id: "twilio",
    label: "Twilio (SMS-notiser)",
    severity: "important",
    fallback:
      "SMS-utskick köas/utelämnas. E-postnotiser via Resend fortsätter. Kunder informeras via portal i stället.",
    check: async () => {
      try {
        const mod = await import("../replit_integrations/twilio");
        const ok = await mod.isTwilioConfigured();
        return ok
          ? { status: "ok" }
          : { status: "not_configured", detail: "Twilio-koppling saknas" };
      } catch (err) {
        return {
          status: "down",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  },
  {
    id: "resend",
    label: "Resend (e-post, magic-link)",
    severity: "important",
    fallback:
      "Transaktionsmail och magic-link-inbjudningar går inte ut. Befintliga sessioner påverkas inte. Använd Replit-login som backup.",
    check: async () => {
      if (!envOk("RESEND_API_KEY")) {
        return { status: "not_configured", detail: "RESEND_API_KEY saknas" };
      }
      return { status: "ok" };
    },
  },
  {
    id: "object_storage",
    label: "Object Storage (filuppladdningar, foton, signaturer)",
    severity: "critical",
    fallback:
      "Nya bilder/signaturer/dokument kan inte laddas upp. Befintliga filer visas fortsatt. Tekniker kan slutföra jobb men foto-bevis saknas tills tjänsten är uppe.",
    check: async () => {
      if (!envOk("PRIVATE_OBJECT_DIR")) {
        return { status: "not_configured", detail: "PRIVATE_OBJECT_DIR saknas" };
      }
      return { status: "ok" };
    },
  },
  {
    id: "fortnox",
    label: "Fortnox (fakturaexport, kund/artikel-sync)",
    severity: "important",
    fallback:
      "Manuell fakturaexport pausas; arbetsordrar markeras som färdiga men export-kön byggs upp. Kör om export när tjänsten återställts.",
    perTenant: true,
    check: async (tenantId?: string) => {
      if (!tenantId) {
        return null; // Skippas i global snapshot
      }
      try {
        const config = await storage.getFortnoxConfig(tenantId);
        if (!config?.isActive || !config?.accessToken) {
          return { status: "not_configured", detail: "Fortnox-OAuth ej kopplad för denna tenant" };
        }
        return { status: "ok" };
      } catch (err) {
        return {
          status: "down",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  },
  {
    id: "osrm",
    label: "OSRM (fallback för rutter)",
    severity: "optional",
    fallback:
      "Haversine-beräkning används som sista utväg. Restider/avstånd blir grova uppskattningar.",
    check: async () => {
      try {
        const mod = await import("../osrm-client");
        if (!mod.isOSRMEnabled()) {
          return { status: "not_configured", detail: "OSRM ej aktiverad (OSRM_BASE_URL saknas)" };
        }
        const ok = await mod.isOSRMAvailable();
        return ok
          ? { status: "ok" }
          : { status: "down", detail: "OSRM svarar inte" };
      } catch (err) {
        return {
          status: "down",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  },
];

// =============================================================================
// Snapshot-state + scheduler. Global snapshot refreshas av in-process-scheduler;
// per-tenant-integrationer (Fortnox) körs on-demand i `getIntegrationsHealth`.
// =============================================================================

let globalSnapshot: IntegrationHealth[] | null = null;
let lastRefreshAt = 0;
let refreshInFlight: Promise<void> | null = null;
let schedulerTimer: NodeJS.Timeout | null = null;

const SCHEDULER_INTERVAL_MS = parseInt(
  process.env.INTEGRATIONS_HEALTH_INTERVAL_MS || `${2 * 60 * 1000}`,
  10,
);
const STALE_FALLBACK_MS = 6 * 60 * 1000;

async function runDefinition(def: Definition, tenantId?: string): Promise<IntegrationHealth | null> {
  try {
    const partial = await def.check(tenantId);
    if (!partial) return null;
    return {
      id: def.id,
      label: def.label,
      severity: def.severity,
      fallback: def.fallback,
      lastCheckedAt: new Date().toISOString(),
      ...partial,
    };
  } catch (err) {
    logger.warn({ integration: def.id, err }, "external integration health check threw");
    return {
      id: def.id,
      label: def.label,
      severity: def.severity,
      fallback: def.fallback,
      status: "down",
      detail: err instanceof Error ? err.message : String(err),
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

async function refreshGlobalSnapshot(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const globalDefs = DEFINITIONS.filter((d) => !d.perTenant);
    const results = await Promise.all(globalDefs.map((d) => runDefinition(d)));
    globalSnapshot = results.filter((r): r is IntegrationHealth => r !== null);
    lastRefreshAt = Date.now();
    const degraded = globalSnapshot.filter(
      (i) => i.status === "down" || i.status === "degraded",
    );
    if (degraded.length > 0) {
      logger.warn(
        { degraded: degraded.map((d) => ({ id: d.id, status: d.status, detail: d.detail })) },
        "integrations health snapshot has degraded services",
      );
    }
  })()
    .catch((err) => {
      logger.error({ err }, "refreshGlobalSnapshot failed");
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export function startIntegrationsHealthScheduler(): void {
  if (schedulerTimer) return;
  // Första körning direkt (icke-blockerande)
  void refreshGlobalSnapshot();
  schedulerTimer = setInterval(() => {
    void refreshGlobalSnapshot();
  }, SCHEDULER_INTERVAL_MS);
  if (typeof schedulerTimer.unref === "function") schedulerTimer.unref();
  logger.info(
    { intervalMs: SCHEDULER_INTERVAL_MS },
    "[integrations-health] scheduler started",
  );
}

export function stopIntegrationsHealthScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

function computeOverall(integrations: IntegrationHealth[]): "ok" | "degraded" {
  return integrations.some(
    (i) =>
      (i.severity === "critical" || i.severity === "important") &&
      (i.status === "down" || i.status === "degraded" || i.status === "not_configured"),
  )
    ? "degraded"
    : "ok";
}

export async function getIntegrationsHealth(
  tenantId?: string,
): Promise<IntegrationsHealthSnapshot> {
  // Säkerställ att vi har en snapshot även om scheduler inte hunnit köra ännu.
  if (!globalSnapshot) {
    await refreshGlobalSnapshot();
  } else if (Date.now() - lastRefreshAt > STALE_FALLBACK_MS) {
    // Snapshot gammal (t.ex. scheduler-error) — kick off refresh i bakgrunden.
    void refreshGlobalSnapshot();
  }

  const perTenantDefs = DEFINITIONS.filter((d) => d.perTenant);
  const perTenantResults = await Promise.all(
    perTenantDefs.map((d) => runDefinition(d, tenantId)),
  );

  const integrations = [
    ...(globalSnapshot || []),
    ...perTenantResults.filter((r): r is IntegrationHealth => r !== null),
  ];

  return {
    overall: computeOverall(integrations),
    checkedAt: new Date().toISOString(),
    integrations,
  };
}

/** Test-/admin-hook: tvinga omedelbar refresh av global snapshot. */
export async function refreshIntegrationsHealthNow(): Promise<void> {
  await refreshGlobalSnapshot();
}
