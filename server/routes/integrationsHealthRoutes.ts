import type { Express, Request, Response } from "express";
import { getIntegrationsHealth } from "../services/external-service-health";
import { logger } from "../logger";

export function registerIntegrationsHealthRoutes(app: Express): void {
  app.get("/api/system/integrations/health", async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).tenantId as string | undefined;
      const snapshot = await getIntegrationsHealth(tenantId);
      res.status(200).json(snapshot);
    } catch (err) {
      logger.error({ err }, "integrations health endpoint failed");
      res.status(500).json({
        error: "Kunde inte hämta integrationsstatus",
        requestId: (req as any).requestId,
      });
    }
  });
}
