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
  check: (tenantId?: string) => Promise<Omit<IntegrationHealth, "id" | "label" | "severity" | "fallback" | "lastCheckedAt">>;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; result: IntegrationHealth }>();

function envOk(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim() !== "";
}

const DEFINITIONS: Definition[] = [
  {
    id: "geoapify",
    label: "Geoapify (routing, geokod, kart-tiles, VRP)",
    severity: "critical",
    fallback:
      "OSRM (om OSRM_BASE_URL satt) för rutter; Haversine för avstånd; OSM-tiles. VRP/Route Planner är inte tillgängligt — optimering måste köras via OR-Tools eller manuell planering.",
    check: async () => {
      if (!envOk("GEOAPIFY_API_KEY")) {
        return { status: "not_configured", detail: "GEOAPIFY_API_KEY saknas" };
      }
      return { status: "ok" };
    },
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
    check: async (tenantId?: string) => {
      if (!tenantId) {
        return { status: "not_configured", detail: "Tenant-kontext saknas (per-tenant-integration)" };
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

async function runCheck(def: Definition, tenantId?: string): Promise<IntegrationHealth> {
  const cacheKey = `${def.id}:${tenantId ?? "_"}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }
  try {
    const partial = await def.check(tenantId);
    const result: IntegrationHealth = {
      id: def.id,
      label: def.label,
      severity: def.severity,
      fallback: def.fallback,
      lastCheckedAt: new Date().toISOString(),
      ...partial,
    };
    cache.set(cacheKey, { at: now, result });
    return result;
  } catch (err) {
    const result: IntegrationHealth = {
      id: def.id,
      label: def.label,
      severity: def.severity,
      fallback: def.fallback,
      status: "down",
      detail: err instanceof Error ? err.message : String(err),
      lastCheckedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, { at: now, result });
    logger.warn({ integration: def.id, err }, "external integration health check failed");
    return result;
  }
}

export async function getIntegrationsHealth(tenantId?: string): Promise<IntegrationsHealthSnapshot> {
  const integrations = await Promise.all(DEFINITIONS.map((d) => runCheck(d, tenantId)));
  const overall = integrations.some(
    (i) => i.severity === "critical" && (i.status === "down" || i.status === "degraded")
  )
    ? "degraded"
    : "ok";
  return {
    overall,
    checkedAt: new Date().toISOString(),
    integrations,
  };
}

export function invalidateIntegrationsHealthCache(): void {
  cache.clear();
}
