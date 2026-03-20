import type { Express } from "express";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { ValidationError } from "../errors";
import { tenantFeatures } from "@shared/schema";
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

  app.patch("/api/admin/tenant-features/:tenantId", asyncHandler(async (req, res) => {
    const adminTenantId = getTenantIdWithFallback(req);
    const { tenantId } = req.params;

    if (adminTenantId !== tenantId && req.tenantRole !== "owner") {
      return res.status(403).json({ error: "Otillräcklig behörighet" });
    }

    const { packageTier, enabledModules } = req.body;

    if (packageTier && !isValidTier(packageTier)) {
      throw new ValidationError("Ogiltigt paketval");
    }
    if (enabledModules && !isValidModuleArray(enabledModules)) {
      throw new ValidationError("Ogiltiga moduler");
    }
    if (!packageTier && !enabledModules) {
      throw new ValidationError("Ange packageTier eller enabledModules");
    }

    let modulesToSet: ModuleKey[];
    let tierToSet: PackageTier;

    if (packageTier && packageTier !== "custom") {
      tierToSet = packageTier;
      modulesToSet = getModulesForPackage(packageTier);
    } else if (enabledModules) {
      tierToSet = "custom";
      modulesToSet = enabledModules.filter(m => MODULE_KEYS.includes(m));
      if (!modulesToSet.includes("core")) modulesToSet.unshift("core");
    } else {
      tierToSet = packageTier || "premium";
      modulesToSet = getModulesForPackage(tierToSet);
    }

    const userWithClaims = req.user as { claims?: { sub?: string } } | undefined;
    const userId = userWithClaims?.claims?.sub || "unknown";

    const [existing] = await db.select().from(tenantFeatures).where(eq(tenantFeatures.tenantId, tenantId));

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

    res.json({
      tenantId,
      packageTier: tierToSet,
      enabledModules: modulesToSet,
    });
  }));

  app.patch("/api/tenant/features", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const role = req.tenantRole;

    if (role !== "owner" && role !== "admin") {
      return res.status(403).json({ error: "Bara admin kan ändra moduler" });
    }

    const { packageTier, enabledModules } = req.body;

    if (packageTier && !isValidTier(packageTier)) {
      throw new ValidationError("Ogiltigt paketval");
    }
    if (enabledModules && !isValidModuleArray(enabledModules)) {
      throw new ValidationError("Ogiltiga moduler");
    }

    let modulesToSet: ModuleKey[];
    let tierToSet: PackageTier;

    if (packageTier && packageTier !== "custom") {
      tierToSet = packageTier;
      modulesToSet = getModulesForPackage(packageTier);
    } else if (enabledModules) {
      tierToSet = "custom";
      modulesToSet = enabledModules.filter(m => MODULE_KEYS.includes(m));
      if (!modulesToSet.includes("core")) modulesToSet.unshift("core");
    } else {
      throw new ValidationError("Ange packageTier eller enabledModules");
    }

    const userWithClaims = req.user as { claims?: { sub?: string } } | undefined;
    const userId = userWithClaims?.claims?.sub || "unknown";

    const [existing] = await db.select().from(tenantFeatures).where(eq(tenantFeatures.tenantId, tenantId));

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

    res.json({
      tenantId,
      packageTier: tierToSet,
      enabledModules: modulesToSet,
    });
  }));
}
