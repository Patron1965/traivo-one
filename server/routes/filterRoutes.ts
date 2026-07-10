/**
 * Task #1240 — Delad filtermotor: CRUD för sparade/delade/roll-scopade filter.
 *
 * Filtren själva (villkorsträd) är opaka jsonb på servern — evaluering sker
 * klient-/servicesidan via shared/filter-engine.ts mot respektive ytas
 * fältkatalog. Denna route äger bara persistens + roll-/tenant-scoping.
 */
import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { asyncHandler } from "../asyncHandler";
import { ValidationError } from "../errors";
import { formatZodError } from "./helpers";
import { getTenantIdWithFallback, requireTenantWithFallback } from "../tenant-middleware";
import { insertSavedFilterSchema } from "@shared/schema";
import { savedFilterScopeValues } from "@shared/filter-engine";

function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const formatted = formatZodError(result.error);
    throw new ValidationError(formatted.error, formatted.details);
  }
  return result.data;
}

const scopeQuerySchema = z.object({
  scope: z.enum(savedFilterScopeValues),
});

export function registerFilterRoutes(app: Express) {
  const guard: RequestHandler[] = [requireTenantWithFallback];

  app.get("/api/saved-filters", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.user!.claims.sub as string;
    const parsed = scopeQuerySchema.safeParse({ scope: req.query.scope });
    if (!parsed.success) {
      const formatted = formatZodError(parsed.error);
      throw new ValidationError(formatted.error, formatted.details);
    }
    const role = req.tenantRole ?? null;
    const rows = await storage.getSavedFilters(tenantId, parsed.data.scope, userId);
    // Roll-scoping: ett delat filter med icke-tom roles-lista syns bara för de rollerna
    // (utöver skaparen, som alltid ser sina egna). Tillämpas server-side som defense-in-depth.
    const visible = rows.filter((f) => {
      if (f.userId === userId) return true;
      if (!f.isShared) return false;
      if (!f.roles || f.roles.length === 0) return true;
      return role ? f.roles.includes(role) : false;
    });
    res.json(visible);
  }));

  app.post("/api/saved-filters", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.user!.claims.sub as string;
    const data = parseBody(insertSavedFilterSchema, req.body);
    const row = await storage.createSavedFilter(tenantId, userId, data);
    res.status(201).json(row);
  }));

  app.patch("/api/saved-filters/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.user!.claims.sub as string;
    const data = parseBody(insertSavedFilterSchema.partial(), req.body);
    const row = await storage.updateSavedFilter(tenantId, userId, req.params.id, data);
    if (!row) {
      res.status(404).json({ message: "Filtret hittades inte" });
      return;
    }
    res.json(row);
  }));

  app.delete("/api/saved-filters/:id", ...guard, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const userId = req.user!.claims.sub as string;
    await storage.deleteSavedFilter(tenantId, userId, req.params.id);
    res.status(204).end();
  }));
}
