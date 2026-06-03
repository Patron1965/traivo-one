import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import { db } from "../db";
import { sql, eq } from "drizzle-orm";
import { workOrders, REQUIRED_FIELDS_BY_ORDER_TYPE } from "@shared/schema";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import {
  resolveOrderTypeMetadataFields,
  getOrderTypeMetadataLinksWithField,
  createOrderTypeMetadataLink,
  deleteOrderTypeMetadataLink,
  getMetadataReferenceLinkUsage,
} from "../metadata-queries";
import { getErrorMessage } from "./helpers";

// Task #665: API för metadata kopplad till ordertyp.
// - GET  /api/order-types                         → kända ordertyper (admin-dropdown)
// - GET  /api/order-type-metadata/:orderType      → fält att visa i orderformuläret
// - GET  /api/order-type-metadata-links/:orderType→ admin: råa kopplingar för en typ
// - POST /api/order-type-metadata-links           → admin: skapa koppling
// - DELETE /api/order-type-metadata-links/:id      → admin: radera koppling
// Config-svar markeras no-cache så admin-ändringar slår igenom direkt.
const NO_CACHE = "no-cache, no-store, must-revalidate";

export function registerOrderTypeMetadataRoutes(app: Express): void {
  // Kända ordertyper: distinkta order_type i work_orders + statiska nycklar ur
  // REQUIRED_FIELDS_BY_ORDER_TYPE. Fri sträng, så admin kan även skriva egen.
  // Tillgänglig för alla tenant-användare (planerare väljer ordertyp i create-
  // formuläret) — listan är icke-känslig och tenant-scopad.
  app.get("/api/order-types", async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!tenantId) return res.status(401).json({ error: "Ingen tenant hittad" });

      const rows = await db
        .selectDistinct({ orderType: workOrders.orderType })
        .from(workOrders)
        .where(eq(workOrders.tenantId, tenantId));

      const set = new Set<string>();
      for (const r of rows) {
        if (r.orderType) set.add(r.orderType);
      }
      for (const key of Object.keys(REQUIRED_FIELDS_BY_ORDER_TYPE)) set.add(key);

      const orderTypes = Array.from(set).sort((a, b) => a.localeCompare(b, "sv"));
      res.setHeader("Cache-Control", NO_CACHE);
      res.json(orderTypes);
    } catch (error) {
      console.error("Error fetching order types:", error);
      res.status(500).json({ error: "Kunde inte hämta ordertyper" });
    }
  });

  // Fält att visa i orderformuläret för en order av angiven typ. Kundlås-filtreras
  // (Task #663) om ?customerId anges. Tillgänglig för alla tenant-användare (planerare
  // skapar ordrar), inte enbart admin.
  app.get("/api/order-type-metadata/:orderType", async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!tenantId) return res.status(401).json({ error: "Ingen tenant hittad" });

      const { orderType } = req.params;
      const customerId = typeof req.query.customerId === "string" && req.query.customerId.length > 0
        ? req.query.customerId
        : undefined;

      const fields = await resolveOrderTypeMetadataFields(tenantId, orderType, customerId);
      res.setHeader("Cache-Control", NO_CACHE);
      res.json(fields);
    } catch (error) {
      console.error("Error resolving order-type metadata fields:", error);
      res.status(500).json({ error: "Kunde inte hämta kopplade metadatafält" });
    }
  });

  // Admin: råa kopplingar för en ordertyp (för koppling-UI).
  app.get("/api/order-type-metadata-links/:orderType", requireAdmin, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!tenantId) return res.status(401).json({ error: "Ingen tenant hittad" });

      const { orderType } = req.params;
      const links = await getOrderTypeMetadataLinksWithField(tenantId, orderType);
      res.setHeader("Cache-Control", NO_CACHE);
      res.json(links);
    } catch (error) {
      console.error("Error fetching order-type metadata links:", error);
      res.status(500).json({ error: "Kunde inte hämta kopplingar" });
    }
  });

  // Task #682: var används en metadatareferens redan? Används av koppling-UI
  // (ordertyp + artikel) för att varna innan en referens kopplas till ytterligare
  // en ordertyp/artikel (undviker generiska fältkollisioner).
  app.get("/api/metadata-link-usage/:metadataKatalogId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!tenantId) return res.status(401).json({ error: "Ingen tenant hittad" });

      const excludeOrderType = typeof req.query.excludeOrderType === "string" && req.query.excludeOrderType.length > 0
        ? req.query.excludeOrderType
        : undefined;

      const usage = await getMetadataReferenceLinkUsage(tenantId, req.params.metadataKatalogId, excludeOrderType);
      res.setHeader("Cache-Control", NO_CACHE);
      res.json(usage);
    } catch (error) {
      console.error("Error fetching metadata link usage:", error);
      res.status(500).json({ error: "Kunde inte hämta användning av metadatareferensen" });
    }
  });

  const createLinkSchema = z.object({
    orderType: z.string().min(1).max(100),
    metadataKatalogId: z.string().min(1),
    sortOrder: z.number().int().optional(),
  });

  // Admin: skapa koppling (idempotent via unikt index).
  app.post("/api/order-type-metadata-links", requireAdmin, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!tenantId) return res.status(401).json({ error: "Ingen tenant hittad" });

      const validated = createLinkSchema.parse(req.body);
      const link = await createOrderTypeMetadataLink({
        tenantId,
        orderType: validated.orderType,
        metadataKatalogId: validated.metadataKatalogId,
        sortOrder: validated.sortOrder,
        createdBy: (req as any).user?.claims?.sub ?? undefined,
      });
      res.setHeader("Cache-Control", NO_CACHE);
      res.status(201).json(link);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: "Valideringsfel", details: error.errors });
      }
      const message = getErrorMessage(error);
      if (message.includes("hittades inte")) {
        return res.status(404).json({ error: message });
      }
      console.error("Error creating order-type metadata link:", error);
      res.status(500).json({ error: "Kunde inte skapa koppling" });
    }
  });

  // Admin: radera koppling.
  app.delete("/api/order-type-metadata-links/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const tenantId = getTenantIdWithFallback(req);
      if (!tenantId) return res.status(401).json({ error: "Ingen tenant hittad" });

      await deleteOrderTypeMetadataLink(req.params.id, tenantId);
      res.status(204).send();
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes("hittades inte")) {
        return res.status(404).json({ error: message });
      }
      console.error("Error deleting order-type metadata link:", error);
      res.status(500).json({ error: "Kunde inte radera koppling" });
    }
  });
}
