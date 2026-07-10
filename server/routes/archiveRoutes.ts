// Task #716: Admin-arkiv. Samlar arkiverade (soft-deleted) poster för fem
// entitetstyper och erbjuder återställning. Alla endpoints kräver admin (requireAdmin).
//
// Listnings-endpoints (GET /api/archive/*):
//   objects, work-orders, images, contacts, metadata-types
// Återställning (POST .../:id/restore):
//   images, contacts, metadata-types
//   (objekt återställs via POST /api/objects/:id/restore,
//    ordrar via POST /api/work-orders/:id/restore — befintliga endpoints)
import type { Express } from "express";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ConflictError } from "../errors";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { storage } from "../storage";
import { listArchivedObjects } from "../services/object-archive";
import { listArchivedMetadataTypes, restoreMetadataType } from "../metadata-queries";

export function registerArchiveRoutes(app: Express): void {
  // === LISTNINGAR ===========================================================
  app.get("/api/archive/objects", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rows = await listArchivedObjects(tenantId, 1000);
    res.json(rows);
  }));

  app.get("/api/archive/work-orders", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rows = await storage.listArchivedWorkOrders(tenantId);
    res.json(rows);
  }));

  app.get("/api/archive/metadata-types", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const rows = await listArchivedMetadataTypes(tenantId);
    res.json(rows);
  }));

  // === ÅTERSTÄLLNING ========================================================
  app.post("/api/archive/metadata-types/:id/restore", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const result = await restoreMetadataType(tenantId, req.params.id);
    if (!result.ok) {
      if (result.reason === "not_found") throw new NotFoundError("Arkiverad metadatatyp");
      // name_collision: en aktiv typ med samma namn/beteckning finns redan.
      throw new ConflictError(
        `Kan inte återställa — en aktiv metadatatyp med ${result.conflict} finns redan. ` +
        `Döp om eller arkivera den aktiva typen först.`,
      );
    }
    res.json(result.type);
  }));
}
