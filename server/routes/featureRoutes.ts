import type { Express } from "express";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { ValidationError } from "../errors";
import { tenantFeatures, featureAuditLog } from "@shared/schema";
import { getTenantFeatures, invalidateFeatureCache } from "../feature-flags";
import { PACKAGE_DEFINITIONS, MODULE_DEFINITIONS, MODULE_KEYS, getModulesForPackage } from "@shared/modules";
import type { ModuleKey, PackageTier } from "@shared/modules";

const VALID_TIERS: PackageTier[] = ["basic", "standard", "premium", "custom"];

function isValidTier(v: unknown): v is PackageTier {
  return typeof v === "string" && VALID_TIERS.includes(v as PackageTier);
}

function isValidModuleArray(v: unknown): v is ModuleKey[] {
  return Array.isArray(v) && v.every(m => typeof m === "string" && (MODULE_KEYS as readonly string[]).includes(m));
}

function resolveModules(body: { packageTier?: unknown; enabledModules?: unknown }): { tierToSet: PackageTier; modulesToSet: ModuleKey[] } {
  const { packageTier, enabledModules } = body;

  if (packageTier && isValidTier(packageTier) && packageTier !== "custom") {
    return { tierToSet: packageTier, modulesToSet: getModulesForPackage(packageTier) };
  }
  if (enabledModules && isValidModuleArray(enabledModules)) {
    const modules = enabledModules.filter(m => (MODULE_KEYS as readonly string[]).includes(m)) as ModuleKey[];
    if (!modules.includes("core")) modules.unshift("core");
    return { tierToSet: "custom", modulesToSet: modules };
  }
  throw new ValidationError("Ange giltigt packageTier eller enabledModules");
}

async function upsertFeatures(tenantId: string, tierToSet: PackageTier, modulesToSet: ModuleKey[], userId: string) {
  const [existing] = await db.select().from(tenantFeatures).where(eq(tenantFeatures.tenantId, tenantId));

  await db.insert(featureAuditLog).values({
    tenantId,
    action: existing ? "update" : "create",
    previousTier: existing?.packageTier ?? null,
    newTier: tierToSet,
    previousModules: existing?.enabledModules ?? null,
    newModules: modulesToSet,
    changedBy: userId,
  });

  if (existing) {
    await db.update(tenantFeatures)
      .set({
        packageTier: tierToSet,
        enabledModules: modulesToSet,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(tenantFeatures.tenantId, tenantId));
  } else {
    await db.insert(tenantFeatures).values({
      tenantId,
      packageTier: tierToSet,
      enabledModules: modulesToSet,
      updatedBy: userId,
    });
  }

  invalidateFeatureCache(tenantId);
}

export async function registerFeatureRoutes(app: Express) {

  app.get("/api/tenant/features", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const features = await getTenantFeatures(tenantId);

    res.json({
      tenantId,
      packageTier: features.tier,
      enabledModules: features.modules,
      moduleDefinitions: MODULE_DEFINITIONS,
      packageDefinitions: PACKAGE_DEFINITIONS,
    });
  }));

  app.patch("/api/tenant/features/:tenantId", asyncHandler(async (req, res) => {
    const adminTenantId = getTenantIdWithFallback(req);
    const { tenantId } = req.params;

    const role = req.tenantRole;
    if (role !== "owner" && role !== "admin") {
      return res.status(403).json({ error: "Otillräcklig behörighet — kräver admin eller ägare" });
    }
    if (adminTenantId !== tenantId && role !== "owner") {
      return res.status(403).json({ error: "Bara ägare kan ändra andra organisationers moduler" });
    }

    const { packageTier, enabledModules } = req.body;
    if (packageTier && !isValidTier(packageTier)) throw new ValidationError("Ogiltigt paketval");
    if (enabledModules && !isValidModuleArray(enabledModules)) throw new ValidationError("Ogiltiga moduler");

    const { tierToSet, modulesToSet } = resolveModules(req.body);
    const userWithClaims = req.user as { claims?: { sub?: string } } | undefined;
    const userId = userWithClaims?.claims?.sub || "unknown";

    await upsertFeatures(tenantId, tierToSet, modulesToSet, userId);

    res.json({ tenantId, packageTier: tierToSet, enabledModules: modulesToSet });
  }));

  app.patch("/api/tenant/features", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const role = req.tenantRole;

    if (role !== "owner" && role !== "admin") {
      return res.status(403).json({ error: "Bara admin kan ändra moduler" });
    }

    const { packageTier, enabledModules } = req.body;
    if (packageTier && !isValidTier(packageTier)) throw new ValidationError("Ogiltigt paketval");
    if (enabledModules && !isValidModuleArray(enabledModules)) throw new ValidationError("Ogiltiga moduler");

    const { tierToSet, modulesToSet } = resolveModules(req.body);
    const userWithClaims = req.user as { claims?: { sub?: string } } | undefined;
    const userId = userWithClaims?.claims?.sub || "unknown";

    await upsertFeatures(tenantId, tierToSet, modulesToSet, userId);

    res.json({ tenantId, packageTier: tierToSet, enabledModules: modulesToSet });
  }));

  app.get("/api/tenant/features/audit", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const role = req.tenantRole;

    if (role !== "owner" && role !== "admin") {
      return res.status(403).json({ error: "Otillräcklig behörighet" });
    }

    const logs = await db.select().from(featureAuditLog)
      .where(eq(featureAuditLog.tenantId, tenantId))
      .orderBy(featureAuditLog.createdAt);

    res.json(logs);
  }));
}
