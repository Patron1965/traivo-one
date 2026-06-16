// Ångra-funktion (Feature 1): endpoints för att rulla tillbaka den senaste
// ångringsbara import-batchen. Båda kräver admin (requireAdmin) — ångring kan
// arkivera objekt och återställa fält, vilket är en privilegierad operation.
import type { Express, Request } from "express";
import { asyncHandler } from "../asyncHandler";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import {
  getLatestReversibleBatch,
  undoImportBatch,
} from "../services/import-undo";

function getUserId(req: Request): string | null {
  return (req as any).user?.claims?.sub ?? (req as any).user?.id ?? null;
}

export function registerImportUndoRoutes(app: Express) {
  // Senaste ångringsbara batchen (för UI-knappens summering). null = inget att ångra.
  app.get(
    "/api/import/undo/latest",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const batch = await getLatestReversibleBatch(tenantId);
      res.json({ batch });
    }),
  );

  // Ångra en batch (default = senaste ångringsbara). Body: { batchId?: string }.
  app.post(
    "/api/import/undo",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const userId = getUserId(req);
      const batchId =
        typeof req.body?.batchId === "string" && req.body.batchId.trim().length > 0
          ? req.body.batchId.trim()
          : undefined;
      const result = await undoImportBatch({ tenantId, userId, batchId });
      res.json(result);
    }),
  );
}
