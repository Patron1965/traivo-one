import { db } from "./db";
import { tenantFeatures } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { ModuleKey } from "@shared/modules";
import { PACKAGE_DEFINITIONS, getModuleForRoute } from "@shared/modules";
import type { Request, Response, NextFunction } from "express";
import { getTenantIdWithFallback } from "./tenant-middleware";

const featureCache = new Map<string, { modules: ModuleKey[]; tier: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export async function getTenantFeatures(tenantId: string): Promise<{ tier: string; modules: ModuleKey[] }> {
  const cached = featureCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) {
    return { tier: cached.tier, modules: cached.modules };
  }

  const [row] = await db.select().from(tenantFeatures).where(eq(tenantFeatures.tenantId, tenantId));

  if (!row) {
    const defaultModules = PACKAGE_DEFINITIONS.premium.modules;
    featureCache.set(tenantId, { modules: defaultModules, tier: "premium", expiresAt: Date.now() + CACHE_TTL_MS });
    return { tier: "premium", modules: defaultModules };
  }

  const modules = (row.enabledModules || []) as ModuleKey[];
  featureCache.set(tenantId, { modules, tier: row.packageTier, expiresAt: Date.now() + CACHE_TTL_MS });
  return { tier: row.packageTier, modules };
}

export async function isModuleEnabled(tenantId: string, moduleKey: ModuleKey): Promise<boolean> {
  const { modules } = await getTenantFeatures(tenantId);
  return modules.includes(moduleKey);
}

export function invalidateFeatureCache(tenantId: string) {
  featureCache.delete(tenantId);
}

export function clearFeatureCache() {
  featureCache.clear();
}

const API_MODULE_PREFIXES: [string, ModuleKey][] = [
  ["/api/iot", "iot"],
  ["/api/annual-planning", "annual_planning"],
  ["/api/ai", "ai_planning"],
  ["/api/fleet", "fleet"],
  ["/api/vehicles", "fleet"],
  ["/api/environmental", "environmental"],
  ["/api/portal", "customer_portal"],
  ["/api/invoic", "invoicing"],
  ["/api/fortnox", "invoicing"],
  ["/api/predictive", "predictive"],
  ["/api/work-sessions", "work_sessions"],
  ["/api/order-concepts", "order_concepts"],
  ["/api/inspections", "inspections"],
  ["/api/checklist", "inspections"],
  ["/api/sms", "sms"],
  ["/api/route-feedback", "route_feedback"],
  ["/api/equipment", "equipment_sharing"],
  ["/api/reports/roi", "roi_reports"],
];

function getModuleForApiPath(path: string): ModuleKey | null {
  for (const [prefix, mod] of API_MODULE_PREFIXES) {
    if (path.startsWith(prefix)) return mod;
  }
  return null;
}

export function requireModule(moduleKey: ModuleKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      const enabled = await isModuleEnabled(tenantId, moduleKey);
      if (!enabled) {
        return res.status(403).json({
          error: "Modulen är inte aktiverad",
          module: moduleKey,
          message: "Denna funktion ingår inte i ert nuvarande paket.",
        });
      }
      next();
    } catch {
      next();
    }
  };
}

export async function moduleGuardMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method === "OPTIONS") return next();

  const moduleKey = getModuleForApiPath(req.path);
  if (!moduleKey || moduleKey === "core") return next();

  try {
    const tenantId = getTenantIdWithFallback(req);
    const enabled = await isModuleEnabled(tenantId, moduleKey);
    if (!enabled) {
      return res.status(403).json({
        error: "Modulen är inte aktiverad",
        module: moduleKey,
        message: "Denna funktion ingår inte i ert nuvarande paket.",
      });
    }
  } catch {
  }
  next();
}
