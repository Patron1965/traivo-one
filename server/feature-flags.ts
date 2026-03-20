import { db } from "./db";
import { tenantFeatures } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { ModuleKey } from "@shared/modules";
import { PACKAGE_DEFINITIONS } from "@shared/modules";

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
