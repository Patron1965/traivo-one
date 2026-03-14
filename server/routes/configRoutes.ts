import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import { insertArticleSchema, insertPriceListSchema, insertPriceListArticleSchema, insertResourceArticleSchema, insertVehicleSchema, insertEquipmentSchema, insertResourceVehicleSchema, insertResourceEquipmentSchema, insertResourceAvailabilitySchema, insertVehicleScheduleSchema, insertSubscriptionSchema, insertTeamSchema, insertTeamMemberSchema, insertPlanningParameterSchema, insertResourceProfileSchema, insertResourceProfileAssignmentSchema, insertWorkSessionSchema, insertWorkEntrySchema, insertFuelLogSchema, insertMaintenanceLogSchema, workSessions, workEntries, timeLogs, equipmentBookings } from "@shared/schema";
import { getISOWeek, getStartOfISOWeek } from "./helpers";
import { notificationService } from "../notifications";

export async function registerConfigRoutes(app: Express) {
// ============== ARTICLES ==============
app.get("/api/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const page = parseInt(req.query.page as string);
    const limit = Math.min(parseInt(req.query.limit as string) || 0, 200);
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const articleType = typeof req.query.articleType === "string" ? req.query.articleType : undefined;
    const hookLevel = typeof req.query.hookLevel === "string" ? req.query.hookLevel : undefined;
    if (page > 0 && limit > 0) {
      const offset = (page - 1) * limit;
      const filters = (articleType || hookLevel) ? { articleType, hookLevel } : undefined;
      const result = await storage.getArticlesPaginated(tenantId, limit, offset, search, filters);
      return res.json({ data: result.articles, total: result.total, page, limit });
    }
    const articles = await storage.getArticles(tenantId);
    res.json(articles);
}));

app.get("/api/articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const article = await storage.getArticle(req.params.id);
    const verified = verifyTenantOwnership(article, tenantId);
    if (!verified) return res.status(404).json({ error: "Article not found" });
    res.json(verified);
}));

app.post("/api/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertArticleSchema.parse({ ...req.body, tenantId });
    const article = await storage.createArticle(data);
    res.status(201).json(article);
}));

app.patch("/api/articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getArticle(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Article not found" });
    }
    const updateSchema = insertArticleSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    const article = await storage.updateArticle(req.params.id, updateData);
    if (!article) return res.status(404).json({ error: "Article not found" });
    res.json(article);
}));

app.delete("/api/articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getArticle(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Article not found" });
    }
    await storage.deleteArticle(req.params.id);
    res.status(204).send();
}));

// Fasthakning: Hämta applicerbara artiklar för ett objekt baserat på hookLevel
app.get("/api/objects/:objectId/applicable-articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const object = await storage.getObject(req.params.objectId);
    if (!verifyTenantOwnership(object, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    const applicableArticles = await storage.getApplicableArticlesForObject(
      tenantId,
      req.params.objectId
    );
    res.json(applicableArticles);
}));

// Resolved article prices for an object (includes auto-hooked + manual + price resolution)
app.get("/api/objects/:objectId/article-prices", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const object = await storage.getObject(req.params.objectId);
    if (!verifyTenantOwnership(object, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    const prices = await storage.getResolvedArticlePricesForObject(tenantId, req.params.objectId);
    res.json(prices);
}));

// Manual object-article links
app.post("/api/objects/:objectId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const object = await storage.getObject(req.params.objectId);
    if (!verifyTenantOwnership(object, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    const { articleId, overridePrice } = req.body;
    if (!articleId) {
      return res.status(400).json({ error: "articleId is required" });
    }
    const article = await storage.getArticle(articleId);
    if (!article || article.tenantId !== tenantId) {
      return res.status(404).json({ error: "Article not found" });
    }
    const existing = await storage.getObjectArticles(tenantId, req.params.objectId);
    if (existing.some(e => e.articleId === articleId)) {
      return res.status(409).json({ error: "Article already linked to this object" });
    }
    const result = await storage.addObjectArticle({
      tenantId,
      objectId: req.params.objectId,
      articleId,
      overridePrice: overridePrice ?? undefined,
    });
    res.json(result);
}));

app.delete("/api/objects/:objectId/articles/:linkId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const object = await storage.getObject(req.params.objectId);
    if (!verifyTenantOwnership(object, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    const deleted = await storage.removeObjectArticle(tenantId, req.params.objectId, req.params.linkId);
    if (!deleted) {
      return res.status(404).json({ error: "Article link not found" });
    }
    res.json({ success: true });
}));

app.patch("/api/objects/:objectId/articles/:linkId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const object = await storage.getObject(req.params.objectId);
    if (!verifyTenantOwnership(object, tenantId)) {
      return res.status(404).json({ error: "Object not found" });
    }
    const { overridePrice } = req.body;
    if (overridePrice !== null && overridePrice !== undefined && typeof overridePrice !== 'number') {
      return res.status(400).json({ error: "overridePrice must be a number or null" });
    }
    const result = await storage.updateObjectArticlePrice(tenantId, req.params.objectId, req.params.linkId, overridePrice ?? null);
    if (!result) {
      return res.status(404).json({ error: "Object article link not found" });
    }
    res.json(result);
}));

// ============== PRICE LISTS ==============
app.get("/api/price-lists", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const page = parseInt(req.query.page as string);
    const limit = Math.min(parseInt(req.query.limit as string) || 0, 200);
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    if (page > 0 && limit > 0) {
      const offset = (page - 1) * limit;
      const result = await storage.getPriceListsPaginated(tenantId, limit, offset, search);
      return res.json({ data: result.priceLists, total: result.total, page, limit });
    }
    const priceLists = await storage.getPriceLists(tenantId);
    res.json(priceLists);
}));

app.get("/api/price-lists/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const priceList = await storage.getPriceList(req.params.id);
    const verified = verifyTenantOwnership(priceList, tenantId);
    if (!verified) return res.status(404).json({ error: "Price list not found" });
    res.json(verified);
}));

app.post("/api/price-lists", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertPriceListSchema.parse({ ...req.body, tenantId });
    const priceList = await storage.createPriceList(data);
    res.status(201).json(priceList);
}));

app.patch("/api/price-lists/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPriceList(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Price list not found" });
    }
    const updateSchema = insertPriceListSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    const priceList = await storage.updatePriceList(req.params.id, updateData);
    if (!priceList) return res.status(404).json({ error: "Price list not found" });
    res.json(priceList);
}));

app.delete("/api/price-lists/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPriceList(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Price list not found" });
    }
    await storage.deletePriceList(req.params.id);
    res.status(204).send();
}));

// ============== PRICE LIST ARTICLES ==============
app.get("/api/price-lists/:priceListId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const priceList = await storage.getPriceList(req.params.priceListId);
    if (!verifyTenantOwnership(priceList, tenantId)) {
      return res.status(404).json({ error: "Price list not found" });
    }
    const priceListArticles = await storage.getPriceListArticles(req.params.priceListId);
    res.json(priceListArticles);
}));

app.post("/api/price-lists/:priceListId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const priceList = await storage.getPriceList(req.params.priceListId);
    if (!verifyTenantOwnership(priceList, tenantId)) {
      return res.status(404).json({ error: "Price list not found" });
    }
    const data = insertPriceListArticleSchema.parse({ ...req.body, priceListId: req.params.priceListId });
    const priceListArticle = await storage.createPriceListArticle(data);
    res.status(201).json(priceListArticle);
}));

app.patch("/api/price-list-articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPriceListArticle(req.params.id);
    if (!existing) return res.status(404).json({ error: "Price list article not found" });
    
    // Verify the parent price list belongs to the tenant
    const priceList = await storage.getPriceList(existing.priceListId);
    if (!verifyTenantOwnership(priceList, tenantId)) {
      return res.status(404).json({ error: "Price list article not found" });
    }
    
    const updateSchema = insertPriceListArticleSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    const priceListArticle = await storage.updatePriceListArticle(req.params.id, updateData);
    if (!priceListArticle) return res.status(404).json({ error: "Price list article not found" });
    res.json(priceListArticle);
}));

app.delete("/api/price-list-articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPriceListArticle(req.params.id);
    if (!existing) return res.status(404).json({ error: "Price list article not found" });
    
    // Verify the parent price list belongs to the tenant
    const priceList = await storage.getPriceList(existing.priceListId);
    if (!verifyTenantOwnership(priceList, tenantId)) {
      return res.status(404).json({ error: "Price list article not found" });
    }
    
    await storage.deletePriceListArticle(req.params.id);
    res.status(204).send();
}));

// ============== RESOURCE ARTICLES (RESURSKOMPETENSER) ==============
app.get("/api/resources/:resourceId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource not found" });
    }
    const resourceArticles = await storage.getResourceArticles(req.params.resourceId);
    res.json(resourceArticles);
}));

app.post("/api/resources/:resourceId/articles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource not found" });
    }
    const data = insertResourceArticleSchema.parse({ ...req.body, resourceId: req.params.resourceId });
    const resourceArticle = await storage.createResourceArticle(data);
    res.status(201).json(resourceArticle);
}));

app.patch("/api/resource-articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceArticle(req.params.id);
    if (!existing) return res.status(404).json({ error: "Resource article not found" });
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource article not found" });
    }
    
    const updateSchema = insertResourceArticleSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    const resourceArticle = await storage.updateResourceArticle(req.params.id, updateData);
    if (!resourceArticle) return res.status(404).json({ error: "Resource article not found" });
    res.json(resourceArticle);
}));

app.delete("/api/resource-articles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceArticle(req.params.id);
    if (!existing) return res.status(404).json({ error: "Resource article not found" });
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource article not found" });
    }
    
    await storage.deleteResourceArticle(req.params.id);
    res.status(204).send();
}));

// ============== VEHICLES ==============
app.get("/api/vehicles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicles = await storage.getVehicles(tenantId);
    res.json(vehicles);
}));

app.get("/api/vehicles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicle = await storage.getVehicle(req.params.id);
    const verified = verifyTenantOwnership(vehicle, tenantId);
    if (!verified) return res.status(404).json({ error: "Vehicle not found" });
    res.json(verified);
}));

app.post("/api/vehicles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertVehicleSchema.parse({ ...req.body, tenantId });
    const vehicle = await storage.createVehicle(data);
    res.status(201).json(vehicle);
}));

app.patch("/api/vehicles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getVehicle(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Vehicle not found" });
    }
    const updateSchema = insertVehicleSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(formatZodError(parseResult.error));
    }
    const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, ...updateData } = parseResult.data as any;
    const vehicle = await storage.updateVehicle(req.params.id, updateData);
    if (!vehicle) return res.status(404).json({ error: "Vehicle not found" });
    res.json(vehicle);
}));

app.delete("/api/vehicles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getVehicle(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Vehicle not found" });
    }
    await storage.deleteVehicle(req.params.id);
    res.status(204).send();
}));

// ============== EQUIPMENT BOOKINGS ==============
app.get("/api/equipment-bookings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { vehicleId, equipmentId, resourceId, teamId, date, startDate, endDate, status } = req.query;
    const options: any = {};
    if (vehicleId) options.vehicleId = vehicleId;
    if (equipmentId) options.equipmentId = equipmentId;
    if (resourceId) options.resourceId = resourceId;
    if (teamId) options.teamId = teamId;
    if (date) options.date = new Date(date as string);
    if (startDate) options.startDate = new Date(startDate as string);
    if (endDate) options.endDate = new Date(endDate as string);
    if (status) options.status = status;
    const bookings = await storage.getEquipmentBookings(tenantId, options);
    res.json(bookings);
}));

app.get("/api/equipment-bookings/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const booking = await storage.getEquipmentBooking(req.params.id);
    if (!booking || booking.tenantId !== tenantId) return res.status(404).json({ error: "Bokning hittades inte" });
    res.json(booking);
}));

app.post("/api/equipment-bookings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { vehicleId, equipmentId, resourceId, teamId, date, serviceArea, notes, workSessionId } = req.body;
    if (!vehicleId && !equipmentId) return res.status(400).json({ error: "Ange fordon eller utrustning" });
    if (!date) return res.status(400).json({ error: "Datum krävs" });

    const bookingDate = new Date(date);
    const targetId = vehicleId || equipmentId;
    const targetType = vehicleId ? "vehicle" : "equipment";

    if (vehicleId) {
      const vehicle = await storage.getVehicle(vehicleId);
      if (!vehicle || vehicle.tenantId !== tenantId) return res.status(400).json({ error: "Ogiltigt fordon" });
    }
    if (equipmentId) {
      const allEquipment = await storage.getEquipment(tenantId);
      const eq = allEquipment.find(e => e.id === equipmentId);
      if (!eq) return res.status(400).json({ error: "Ogiltig utrustning" });
    }
    if (resourceId) {
      const resource = await storage.getResource(resourceId);
      if (!resource || resource.tenantId !== tenantId) return res.status(400).json({ error: "Ogiltig resurs" });
    }
    if (teamId) {
      const team = await storage.getTeam(teamId);
      if (!team || team.tenantId !== tenantId) return res.status(400).json({ error: "Ogiltigt team" });
    }

    const existingBookings = await storage.getEquipmentBookings(tenantId, {
      ...(vehicleId ? { vehicleId } : { equipmentId }),
      date: bookingDate,
      status: "active",
    });

    const requestAreas = Array.isArray(serviceArea) ? serviceArea : [];
    const conflicts = existingBookings.filter(b => {
      if (b.resourceId === resourceId && b.teamId === teamId) return false;
      if (requestAreas.length === 0) return true;
      const bookingAreas = b.serviceArea || [];
      if (bookingAreas.length === 0) return true;
      const overlap = requestAreas.some((a: string) => bookingAreas.includes(a));
      return !overlap;
    });

    let warning: string | null = null;
    if (conflicts.length > 0) {
      const conflictAreas = conflicts.flatMap(c => c.serviceArea || []);
      warning = `Varning: ${targetType === "vehicle" ? "Fordonet" : "Utrustningen"} är redan bokat ${bookingDate.toISOString().split("T")[0]} i ${conflictAreas.length > 0 ? `annan zon (${conflictAreas.join(", ")})` : "annan tilldelning"}. Dubbelbokning skapad med varning.`;
    }

    const booking = await storage.createEquipmentBooking({
      tenantId,
      vehicleId: vehicleId || null,
      equipmentId: equipmentId || null,
      resourceId: resourceId || null,
      teamId: teamId || null,
      workSessionId: workSessionId || null,
      date: bookingDate,
      serviceArea: requestAreas,
      status: "active",
      notes: notes || null,
    });

    res.status(201).json({ booking, warning });
}));

app.delete("/api/equipment-bookings/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const booking = await storage.getEquipmentBooking(req.params.id);
    if (!booking || booking.tenantId !== tenantId) return res.status(404).json({ error: "Bokning hittades inte" });
    await storage.deleteEquipmentBooking(req.params.id);
    res.status(204).send();
}));

app.post("/api/equipment-bookings/check-collision", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { vehicleId, equipmentId, resourceId, teamId, date, serviceArea } = req.body;
    if (!vehicleId && !equipmentId) return res.status(400).json({ error: "Ange fordon eller utrustning" });
    if (!date) return res.status(400).json({ error: "Datum krävs" });

    const bookingDate = new Date(date);
    const existingBookings = await storage.getEquipmentBookings(tenantId, {
      ...(vehicleId ? { vehicleId } : { equipmentId }),
      date: bookingDate,
      status: "active",
    });

    const requestAreas = Array.isArray(serviceArea) ? serviceArea : [];
    const conflicts = existingBookings.filter(b => {
      if (resourceId && teamId && b.resourceId === resourceId && b.teamId === teamId) return false;
      if (requestAreas.length === 0) return existingBookings.length > 0;
      const bookingAreas = b.serviceArea || [];
      if (bookingAreas.length === 0) return true;
      return !requestAreas.some((a: string) => bookingAreas.includes(a));
    });

    res.json({
      hasConflict: conflicts.length > 0,
      conflicts: conflicts.map(c => ({
        id: c.id,
        resourceId: c.resourceId,
        teamId: c.teamId,
        serviceArea: c.serviceArea,
        date: c.date,
      })),
      existingBookings: existingBookings.length,
    });
}));

// ============== FUEL LOGS ==============
app.get("/api/fuel-logs", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicleId = req.query.vehicleId as string | undefined;
    const logs = await storage.getFuelLogs(tenantId, vehicleId);
    res.json(logs);
}));

app.post("/api/fuel-logs", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicle = await storage.getVehicle(req.body.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      return res.status(404).json({ error: "Vehicle not found" });
    }
    const data = insertFuelLogSchema.parse({ ...req.body, tenantId });
    const log = await storage.createFuelLog(data);
    res.status(201).json(log);
}));

app.delete("/api/fuel-logs/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteFuelLog(req.params.id, tenantId);
    res.status(204).send();
}));

// ============== MAINTENANCE LOGS ==============
app.get("/api/maintenance-logs", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicleId = req.query.vehicleId as string | undefined;
    const logs = await storage.getMaintenanceLogs(tenantId, vehicleId);
    res.json(logs);
}));

app.post("/api/maintenance-logs", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicle = await storage.getVehicle(req.body.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      return res.status(404).json({ error: "Vehicle not found" });
    }
    const data = insertMaintenanceLogSchema.parse({ ...req.body, tenantId });
    const log = await storage.createMaintenanceLog(data);
    res.status(201).json(log);
}));

app.delete("/api/maintenance-logs/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteMaintenanceLog(req.params.id, tenantId);
    res.status(204).send();
}));

// ============== RESOURCE PROFILES (Utföranderoller) ==============
app.get("/api/resource-profiles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const profiles = await storage.getResourceProfiles(tenantId);
    res.json(profiles);
}));

app.get("/api/resource-profiles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const profile = await storage.getResourceProfile(req.params.id);
    if (!profile || profile.tenantId !== tenantId) return res.status(404).json({ error: "Profile not found" });
    res.json(profile);
}));

app.post("/api/resource-profiles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertResourceProfileSchema.parse({ ...req.body, tenantId });
    const profile = await storage.createResourceProfile(data);
    res.status(201).json(profile);
}));

app.put("/api/resource-profiles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceProfile(req.params.id);
    if (!existing || existing.tenantId !== tenantId) return res.status(404).json({ error: "Profile not found" });
    const { tenantId: _, id: __, ...updateData } = req.body;
    const profile = await storage.updateResourceProfile(req.params.id, updateData);
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    res.json(profile);
}));

app.delete("/api/resource-profiles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    await storage.deleteResourceProfile(req.params.id, tenantId);
    res.status(204).send();
}));

app.get("/api/resource-profiles/:id/resources", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const assignments = await storage.getResourceProfileAssignments(tenantId, req.params.id);
    res.json(assignments);
}));

app.post("/api/resources/:id/profiles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resourceId = req.params.id;
    const { profileId, applyProfile } = req.body;
    const profile = await storage.getResourceProfile(profileId);
    if (!profile || profile.tenantId !== tenantId) return res.status(404).json({ error: "Profile not found" });
    const resource = await storage.getResource(resourceId);
    if (!resource || resource.tenantId !== tenantId) return res.status(404).json({ error: "Resource not found" });
    const data = insertResourceProfileAssignmentSchema.parse({ tenantId, resourceId, profileId });
    const assignment = await storage.assignResourceProfile(data);
    if (applyProfile !== false && profile && resource) {
      const updates: Record<string, any> = {};
      if (profile.executionCodes && profile.executionCodes.length > 0) {
        const existingCodes = resource.executionCodes || [];
        const merged = [...new Set([...existingCodes, ...profile.executionCodes])];
        updates.executionCodes = merged;
      }
      if (profile.defaultCostCenter) updates.costCenter = profile.defaultCostCenter;
      if (profile.projectCode) updates.projectCode = profile.projectCode;
      if (profile.serviceArea && profile.serviceArea.length > 0) updates.serviceArea = profile.serviceArea;
      if (Object.keys(updates).length > 0) {
        await storage.updateResource(resourceId, updates);
      }
    }
    res.status(201).json(assignment);
}));

app.delete("/api/resources/:id/profiles/:profileId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const profile = await storage.getResourceProfile(req.params.profileId);
    if (!profile || profile.tenantId !== tenantId) return res.status(404).json({ error: "Profile not found" });
    const resource = await storage.getResource(req.params.id);
    if (!resource || resource.tenantId !== tenantId) return res.status(404).json({ error: "Resource not found" });
    await storage.removeResourceProfileAssignmentByPair(req.params.profileId, req.params.id);
    res.status(204).send();
}));

// ============== WORK SESSIONS & ENTRIES (Snöret) ==============
app.get("/api/work-sessions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { resourceId, teamId, startDate, endDate, status } = req.query;
    const options: any = {};
    if (resourceId) options.resourceId = resourceId as string;
    if (teamId) options.teamId = teamId as string;
    if (startDate) options.startDate = new Date(startDate as string);
    if (endDate) options.endDate = new Date(endDate as string);
    if (status) options.status = status as string;
    const sessions = await storage.getWorkSessions(tenantId, options);
    res.json(sessions);
}));

app.get("/api/work-sessions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const session = await storage.getWorkSession(req.params.id);
    if (!session || session.tenantId !== tenantId) return res.status(404).json({ error: "Session not found" });
    res.json(session);
}));

app.post("/api/work-sessions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.body.resourceId);
    if (!resource || resource.tenantId !== tenantId) return res.status(400).json({ error: "Ogiltig resurs" });
    if (req.body.teamId) {
      const team = await storage.getTeam(req.body.teamId);
      if (!team || team.tenantId !== tenantId) return res.status(400).json({ error: "Ogiltigt team" });
    }
    const startTime = new Date(req.body.startTime);
    const endTime = req.body.endTime ? new Date(req.body.endTime) : undefined;
    if (endTime && endTime <= startTime) return res.status(400).json({ error: "Sluttid måste vara efter starttid" });
    const data = insertWorkSessionSchema.parse({ ...req.body, tenantId, date: new Date(req.body.date), startTime, endTime });
    const session = await storage.createWorkSession(data);
    res.status(201).json(session);
}));

app.put("/api/work-sessions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWorkSession(req.params.id);
    if (!existing || existing.tenantId !== tenantId) return res.status(404).json({ error: "Session not found" });
    const { tenantId: _, id: __, ...updateData } = req.body;
    if (updateData.status && !["active", "paused", "completed"].includes(updateData.status)) return res.status(400).json({ error: "Ogiltig status" });
    if (updateData.resourceId) {
      const resource = await storage.getResource(updateData.resourceId);
      if (!resource || resource.tenantId !== tenantId) return res.status(400).json({ error: "Ogiltig resurs" });
    }
    if (updateData.teamId) {
      const team = await storage.getTeam(updateData.teamId);
      if (!team || team.tenantId !== tenantId) return res.status(400).json({ error: "Ogiltigt team" });
    }
    if (updateData.endTime) updateData.endTime = new Date(updateData.endTime);
    if (updateData.startTime) updateData.startTime = new Date(updateData.startTime);
    if (updateData.date) updateData.date = new Date(updateData.date);
    const session = await storage.updateWorkSession(req.params.id, updateData);
    if (session && session.status === "completed" && existing.status !== "completed") {
      try {
        await storage.releaseEquipmentByWorkSession(req.params.id);
      } catch (releaseErr) {
        console.error("Failed to auto-release equipment on session completion:", releaseErr);
      }
    }
    res.json(session);
}));

app.delete("/api/work-sessions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWorkSession(req.params.id);
    if (!existing || existing.tenantId !== tenantId) return res.status(404).json({ error: "Session not found" });
    await storage.deleteWorkSession(req.params.id);
    res.status(204).send();
}));

app.post("/api/work-sessions/:id/check-in", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWorkSession(req.params.id);
    if (!existing || existing.tenantId !== tenantId) return res.status(404).json({ error: "Session not found" });
    const session = await storage.updateWorkSession(req.params.id, { status: "active", startTime: new Date() });
    res.json(session);
}));

app.post("/api/work-sessions/:id/check-out", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWorkSession(req.params.id);
    if (!existing || existing.tenantId !== tenantId) return res.status(404).json({ error: "Session not found" });
    const session = await storage.updateWorkSession(req.params.id, { status: "completed", endTime: new Date() });
    const released = await storage.releaseEquipmentByWorkSession(req.params.id);
    res.json({ ...session, releasedBookings: released });
}));

app.get("/api/work-sessions/:id/entries", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const session = await storage.getWorkSession(req.params.id);
    if (!session || session.tenantId !== tenantId) return res.status(404).json({ error: "Session not found" });
    const entries = await storage.getWorkEntries(req.params.id);
    res.json(entries);
}));

app.get("/api/work-entries/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const entry = await storage.getWorkEntry(req.params.id);
    if (!entry || entry.tenantId !== tenantId) return res.status(404).json({ error: "Entry not found" });
    res.json(entry);
}));

app.post("/api/work-entries", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const session = await storage.getWorkSession(req.body.workSessionId);
    if (!session || session.tenantId !== tenantId) return res.status(400).json({ error: "Ogiltigt arbetspass" });
    const resource = await storage.getResource(req.body.resourceId || session.resourceId);
    if (!resource || resource.tenantId !== tenantId) return res.status(400).json({ error: "Ogiltig resurs" });
    const validTypes = ["work", "travel", "setup", "break", "rest"];
    if (!validTypes.includes(req.body.entryType)) return res.status(400).json({ error: "Ogiltig posttyp" });
    const startTime = new Date(req.body.startTime);
    const endTime = req.body.endTime ? new Date(req.body.endTime) : undefined;
    if (endTime && endTime <= startTime) return res.status(400).json({ error: "Sluttid måste vara efter starttid" });
    const data = insertWorkEntrySchema.parse({ ...req.body, tenantId, resourceId: resource.id, startTime, endTime });
    const entry = await storage.createWorkEntry(data);
    res.status(201).json(entry);
}));

app.put("/api/work-entries/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWorkEntry(req.params.id);
    if (!existing || existing.tenantId !== tenantId) return res.status(404).json({ error: "Entry not found" });
    const { tenantId: _, id: __, workSessionId: ___, ...updateData } = req.body;
    const validTypes = ["work", "travel", "setup", "break", "rest"];
    if (updateData.entryType && !validTypes.includes(updateData.entryType)) return res.status(400).json({ error: "Ogiltig posttyp" });
    if (updateData.resourceId) {
      const resource = await storage.getResource(updateData.resourceId);
      if (!resource || resource.tenantId !== tenantId) return res.status(400).json({ error: "Ogiltig resurs" });
    }
    if (updateData.workOrderId) {
      const wo = await storage.getWorkOrder(updateData.workOrderId);
      if (!wo || wo.tenantId !== tenantId) return res.status(400).json({ error: "Ogiltig arbetsorder" });
    }
    if (updateData.startTime) updateData.startTime = new Date(updateData.startTime);
    if (updateData.endTime) updateData.endTime = new Date(updateData.endTime);
    const start = updateData.startTime || existing.startTime;
    const end = updateData.endTime || existing.endTime;
    if (end && start && new Date(end) <= new Date(start)) return res.status(400).json({ error: "Sluttid måste vara efter starttid" });
    const entry = await storage.updateWorkEntry(req.params.id, updateData);
    res.json(entry);
}));

app.delete("/api/work-entries/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getWorkEntry(req.params.id);
    if (!existing || existing.tenantId !== tenantId) return res.status(404).json({ error: "Entry not found" });
    await storage.deleteWorkEntry(req.params.id);
    res.status(204).send();
}));

app.get("/api/time-summary", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { resourceId, weekNumber, year } = req.query;
    const y = parseInt(year as string) || new Date().getFullYear();
    const w = parseInt(weekNumber as string) || getISOWeek(new Date());

    const weekStart = getStartOfISOWeek(y, w);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const options: any = { startDate: weekStart, endDate: weekEnd };
    if (resourceId) options.resourceId = resourceId as string;

    const sessions = await storage.getWorkSessions(tenantId, options);
    const allResources = await storage.getResources(tenantId);
    const resourceMap = new Map(allResources.map(r => [r.id, r]));

    const summaryByResource = new Map<string, { work: number; travel: number; setup: number; break_time: number; rest: number; total: number; budgetHours: number; resourceName: string; resourceId: string }>();

    for (const session of sessions) {
      const entries = await storage.getWorkEntries(session.id);
      const resource = resourceMap.get(session.resourceId);
      if (!summaryByResource.has(session.resourceId)) {
        summaryByResource.set(session.resourceId, {
          work: 0, travel: 0, setup: 0, break_time: 0, rest: 0, total: 0,
          budgetHours: resource?.weeklyHours || 40,
          resourceName: resource?.name || "Okänd",
          resourceId: session.resourceId,
        });
      }
      const s = summaryByResource.get(session.resourceId)!;
      for (const entry of entries) {
        const mins = entry.durationMinutes || (entry.endTime && entry.startTime ? Math.round((new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime()) / 60000) : 0);
        switch (entry.entryType) {
          case "work": s.work += mins; break;
          case "travel": s.travel += mins; break;
          case "setup": s.setup += mins; break;
          case "break": s.break_time += mins; break;
          case "rest": s.rest += mins; break;
        }
        s.total += mins;
      }
    }

    const nightRestViolations: Array<{ resourceId: string; resourceName: string; date: string; restHours: number }> = [];
    const weeklyRestViolations: Array<{ resourceId: string; resourceName: string; totalRestHours: number }> = [];

    for (const [rId, summary] of summaryByResource) {
      const rSessions = sessions.filter(s => s.resourceId === rId).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      for (let i = 1; i < rSessions.length; i++) {
        const prevEnd = rSessions[i - 1].endTime;
        const currStart = rSessions[i].startTime;
        if (prevEnd && currStart) {
          const restHours = (new Date(currStart).getTime() - new Date(prevEnd).getTime()) / 3600000;
          if (restHours < 11) {
            nightRestViolations.push({
              resourceId: rId,
              resourceName: summary.resourceName,
              date: new Date(currStart).toISOString().split("T")[0],
              restHours: Math.round(restHours * 10) / 10,
            });
          }
        }
      }

      let maxContinuousRestHours = 0;
      if (rSessions.length === 0) {
        maxContinuousRestHours = 168;
      } else {
        const firstStart = rSessions[0].startTime ? new Date(rSessions[0].startTime).getTime() : weekStart.getTime();
        const restBeforeFirst = (firstStart - weekStart.getTime()) / 3600000;
        maxContinuousRestHours = Math.max(maxContinuousRestHours, restBeforeFirst);

        for (let i = 1; i < rSessions.length; i++) {
          const prevEnd = rSessions[i - 1].endTime;
          const currStart = rSessions[i].startTime;
          if (prevEnd && currStart) {
            const gap = (new Date(currStart).getTime() - new Date(prevEnd).getTime()) / 3600000;
            maxContinuousRestHours = Math.max(maxContinuousRestHours, gap);
          }
        }

        const lastEnd = rSessions[rSessions.length - 1].endTime;
        if (lastEnd) {
          const restAfterLast = (weekEnd.getTime() - new Date(lastEnd).getTime()) / 3600000;
          maxContinuousRestHours = Math.max(maxContinuousRestHours, restAfterLast);
        }
      }

      if (maxContinuousRestHours < 36) {
        weeklyRestViolations.push({
          resourceId: rId,
          resourceName: summary.resourceName,
          totalRestHours: Math.round(maxContinuousRestHours * 10) / 10,
        });
      }
    }

    const summariesArr = Array.from(summaryByResource.values());
    for (const s of summariesArr) {
      const existing = await db.select().from(timeLogs).where(
        and(eq(timeLogs.tenantId, tenantId), eq(timeLogs.resourceId, s.resourceId), eq(timeLogs.year, y), eq(timeLogs.week, w))
      );
      const logData = { tenantId, resourceId: s.resourceId, week: w, year: y, work: s.work, travel: s.travel, setup: s.setup, breakTime: s.break_time, rest: s.rest, total: s.total, budgetHours: s.budgetHours, resourceName: s.resourceName };
      if (existing.length > 0) {
        await db.update(timeLogs).set({ ...logData, updatedAt: new Date() }).where(eq(timeLogs.id, existing[0].id));
      } else {
        await db.insert(timeLogs).values(logData);
      }
    }

    res.json({
      week: w,
      year: y,
      summaries: summariesArr,
      nightRestViolations,
      weeklyRestViolations,
    });
}));

app.get("/api/payroll-export", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { weekNumber, year } = req.query;
    const y = parseInt(year as string) || new Date().getFullYear();
    const w = parseInt(weekNumber as string) || getISOWeek(new Date());

    const weekStart = getStartOfISOWeek(y, w);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const sessions = await storage.getWorkSessions(tenantId, { startDate: weekStart, endDate: weekEnd });
    const allResources = await storage.getResources(tenantId);
    const resourceMap = new Map(allResources.map(r => [r.id, r]));

    const rows: string[] = ["Resurs;Vecka;År;Arbetstid (min);Restid (min);Ställtid (min);Rast (min);Vila (min);Total (min);Total (h);Budgettimmar;Anställningstyp"];

    const byResource = new Map<string, { work: number; travel: number; setup: number; break_time: number; rest: number; total: number }>();
    for (const session of sessions) {
      if (!byResource.has(session.resourceId)) byResource.set(session.resourceId, { work: 0, travel: 0, setup: 0, break_time: 0, rest: 0, total: 0 });
      const entries = await storage.getWorkEntries(session.id);
      const s = byResource.get(session.resourceId)!;
      for (const entry of entries) {
        const mins = entry.durationMinutes || (entry.endTime && entry.startTime ? Math.round((new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime()) / 60000) : 0);
        switch (entry.entryType) {
          case "work": s.work += mins; break;
          case "travel": s.travel += mins; break;
          case "setup": s.setup += mins; break;
          case "break": s.break_time += mins; break;
          case "rest": s.rest += mins; break;
        }
        s.total += mins;
      }
    }

    for (const [rId, data] of byResource) {
      const resource = resourceMap.get(rId);
      const name = resource?.name || "Okänd";
      const budget = resource?.weeklyHours || 40;
      const employmentType = budget >= 35 ? "Månadsanställd" : "Timanställd";
      const safeName = name.replace(/^[=+\-@\t\r]/g, "'$&").replace(/;/g, ",");
      rows.push(`${safeName};${w};${y};${data.work};${data.travel};${data.setup};${data.break_time};${data.rest};${data.total};${(data.total / 60).toFixed(1)};${budget};${employmentType}`);
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=loneunderlag_v${w}_${y}.csv`);
    res.send("\uFEFF" + rows.join("\n"));
}));

// ============== EQUIPMENT ==============
app.get("/api/equipment", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const equipment = await storage.getEquipment(tenantId);
    res.json(equipment);
}));

app.get("/api/equipment/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const equipment = await storage.getEquipmentById(req.params.id);
    const verified = verifyTenantOwnership(equipment, tenantId);
    if (!verified) return res.status(404).json({ error: "Equipment not found" });
    res.json(verified);
}));

app.post("/api/equipment", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertEquipmentSchema.parse({ ...req.body, tenantId });
    const equipment = await storage.createEquipment(data);
    res.status(201).json(equipment);
}));

app.patch("/api/equipment/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getEquipmentById(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Equipment not found" });
    }
    const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
    const equipment = await storage.updateEquipment(req.params.id, updateData);
    if (!equipment) return res.status(404).json({ error: "Equipment not found" });
    res.json(equipment);
}));

app.delete("/api/equipment/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getEquipmentById(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Equipment not found" });
    }
    await storage.deleteEquipment(req.params.id);
    res.status(204).send();
}));

// ============== RESOURCE AVAILABILITY ==============
app.get("/api/resource-availability/:resourceId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource not found" });
    }
    const availability = await storage.getResourceAvailability(req.params.resourceId);
    res.json(availability);
}));

app.get("/api/resource-availability-item/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const item = await storage.getResourceAvailabilityById(req.params.id);
    if (!item) return res.status(404).json({ error: "Resource availability not found" });
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(item.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource availability not found" });
    }
    res.json(item);
}));

app.post("/api/resource-availability/:resourceId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource not found" });
    }
    const data = insertResourceAvailabilitySchema.parse({ 
      ...req.body, 
      tenantId, 
      resourceId: req.params.resourceId 
    });
    const item = await storage.createResourceAvailability(data);
    res.status(201).json(item);
}));

app.patch("/api/resource-availability-item/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceAvailabilityById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Resource availability not found" });
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource availability not found" });
    }
    
    const { tenantId: _, id, resourceId, createdAt, ...updateData } = req.body;
    const item = await storage.updateResourceAvailability(req.params.id, updateData);
    if (!item) return res.status(404).json({ error: "Resource availability not found" });
    res.json(item);
}));

app.delete("/api/resource-availability-item/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceAvailabilityById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Resource availability not found" });
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource availability not found" });
    }
    
    await storage.deleteResourceAvailability(req.params.id);
    res.status(204).send();
}));

// ============== VEHICLE SCHEDULE ==============
app.get("/api/vehicle-schedule/:vehicleId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicle = await storage.getVehicle(req.params.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      return res.status(404).json({ error: "Vehicle not found" });
    }
    const schedule = await storage.getVehicleSchedule(req.params.vehicleId);
    res.json(schedule);
}));

app.get("/api/vehicle-schedule-item/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const item = await storage.getVehicleScheduleById(req.params.id);
    if (!item) return res.status(404).json({ error: "Vehicle schedule not found" });
    
    const vehicle = await storage.getVehicle(item.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      return res.status(404).json({ error: "Vehicle schedule not found" });
    }
    res.json(item);
}));

app.post("/api/vehicle-schedule/:vehicleId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const vehicle = await storage.getVehicle(req.params.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      return res.status(404).json({ error: "Vehicle not found" });
    }
    const data = insertVehicleScheduleSchema.parse({ 
      ...req.body, 
      tenantId, 
      vehicleId: req.params.vehicleId 
    });
    const item = await storage.createVehicleSchedule(data);
    res.status(201).json(item);
}));

app.patch("/api/vehicle-schedule-item/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getVehicleScheduleById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Vehicle schedule not found" });
    
    const vehicle = await storage.getVehicle(existing.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      return res.status(404).json({ error: "Vehicle schedule not found" });
    }
    
    const { tenantId: _, id, vehicleId, createdAt, ...updateData } = req.body;
    const item = await storage.updateVehicleSchedule(req.params.id, updateData);
    if (!item) return res.status(404).json({ error: "Vehicle schedule not found" });
    res.json(item);
}));

app.delete("/api/vehicle-schedule-item/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getVehicleScheduleById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Vehicle schedule not found" });
    
    const vehicle = await storage.getVehicle(existing.vehicleId);
    if (!verifyTenantOwnership(vehicle, tenantId)) {
      return res.status(404).json({ error: "Vehicle schedule not found" });
    }
    
    await storage.deleteVehicleSchedule(req.params.id);
    res.status(204).send();
}));

// ============== SUBSCRIPTIONS ==============
app.get("/api/subscriptions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const subscriptions = await storage.getSubscriptions(tenantId);
    res.json(subscriptions);
}));

app.get("/api/subscriptions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const subscription = await storage.getSubscription(req.params.id);
    const verified = verifyTenantOwnership(subscription, tenantId);
    if (!verified) return res.status(404).json({ error: "Subscription not found" });
    res.json(verified);
}));

app.post("/api/subscriptions", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertSubscriptionSchema.parse({ ...req.body, tenantId });
    const subscription = await storage.createSubscription(data);
    res.status(201).json(subscription);
}));

app.patch("/api/subscriptions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getSubscription(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Subscription not found" });
    }
    const { tenantId: _, id, createdAt, deletedAt, ...updateData } = req.body;
    const subscription = await storage.updateSubscription(req.params.id, updateData);
    if (!subscription) return res.status(404).json({ error: "Subscription not found" });
    res.json(subscription);
}));

app.delete("/api/subscriptions/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getSubscription(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Subscription not found" });
    }
    await storage.deleteSubscription(req.params.id);
    res.status(204).send();
}));

// Preview scheduled dates based on flexible frequency
app.post("/api/scheduling/preview-dates", asyncHandler(async (req, res) => {
    const { frequency, startDate, endDate } = req.body;
    
    if (!frequency || !startDate || !endDate) {
      return res.status(400).json({ error: "frequency, startDate, and endDate are required" });
    }
    
    const { generateScheduleDates, formatFrequencyDescription } = await import('./scheduling-utils');
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    const dates = generateScheduleDates(frequency, start, end);
    const description = formatFrequencyDescription(frequency);
    
    res.json({
      dates: dates.map(d => d.toISOString()),
      count: dates.length,
      description,
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
      }
    });
}));

// Generate orders from active subscriptions
app.post("/api/subscriptions/generate-orders", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const subscriptions = await storage.getSubscriptions(tenantId);
    const now = new Date();
    let generatedCount = 0;

    const { generateScheduleDates, convertLegacyPeriodicity } = await import('./scheduling-utils');

    for (const sub of subscriptions) {
      if (sub.status !== "active" || !sub.autoGenerate) continue;
      if (!sub.nextGenerationDate) continue;
      
      const nextGenDate = new Date(sub.nextGenerationDate);
      const generateAheadDays = sub.generateDaysAhead || 14;
      const generateThreshold = new Date(now.getTime() + generateAheadDays * 24 * 60 * 60 * 1000);
      
      // Generate if nextGenerationDate is within the generate-ahead window
      if (nextGenDate <= generateThreshold) {
        // Create work order from subscription
        const workOrder = await storage.createWorkOrder({
          tenantId,
          customerId: sub.customerId,
          objectId: sub.objectId,
          title: sub.name,
          description: `Genererad från abonnemang: ${sub.name}`,
          orderStatus: "skapad",
          priority: "normal",
          estimatedDuration: 60,
          scheduledDate: nextGenDate,
          isSimulated: false,
        });

        generatedCount++;

        // Calculate next generation date - use flexible frequency if available
        let nextDate: Date;
        
        if (sub.flexibleFrequency) {
          // Use new flexible frequency system
          const frequency = sub.flexibleFrequency as any;
          const dates = generateScheduleDates(frequency, nextGenDate, generateThreshold);
          // Find the next date after the current one
          const futureDates = dates.filter(d => d > nextGenDate);
          nextDate = futureDates.length > 0 ? futureDates[0] : new Date(nextGenDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        } else {
          // Fallback to legacy periodicity
          nextDate = new Date(nextGenDate);
          switch (sub.periodicity) {
            case "vecka":
              nextDate.setDate(nextDate.getDate() + 7);
              break;
            case "varannan_vecka":
              nextDate.setDate(nextDate.getDate() + 14);
              break;
            case "manad":
              nextDate.setMonth(nextDate.getMonth() + 1);
              break;
            case "kvartal":
              nextDate.setMonth(nextDate.getMonth() + 3);
              break;
            case "halvar":
              nextDate.setMonth(nextDate.getMonth() + 6);
              break;
            case "ar":
              nextDate.setFullYear(nextDate.getFullYear() + 1);
              break;
            default:
              nextDate.setMonth(nextDate.getMonth() + 1);
          }
        }

        // Check if we've passed endDate
        if (sub.endDate && nextDate > new Date(sub.endDate)) {
          await storage.updateSubscription(sub.id, {
            status: "completed",
            lastGeneratedDate: now,
          });
        } else {
          await storage.updateSubscription(sub.id, {
            lastGeneratedDate: now,
            nextGenerationDate: nextDate,
          });
        }
      }
    }

    res.json({ success: true, generatedCount });
}));

// ============== TEAMS ==============
app.get("/api/teams", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const teams = await storage.getTeams(tenantId);
    res.json(teams);
}));

app.get("/api/teams/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const team = await storage.getTeam(req.params.id);
    const verified = verifyTenantOwnership(team, tenantId);
    if (!verified) return res.status(404).json({ error: "Team not found" });
    res.json(verified);
}));

app.post("/api/teams", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (req.body.profileIds && Array.isArray(req.body.profileIds) && req.body.profileIds.length > 0) {
      const tenantProfiles = await storage.getResourceProfiles(tenantId);
      const tenantProfileIds = new Set(tenantProfiles.map(p => p.id));
      for (const pid of req.body.profileIds) {
        if (!tenantProfileIds.has(pid)) {
          return res.status(400).json({ error: `Profile ${pid} does not belong to this tenant` });
        }
      }
    }
    const data = insertTeamSchema.parse({ ...req.body, tenantId });
    const team = await storage.createTeam(data);
    res.status(201).json(team);
}));

app.patch("/api/teams/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getTeam(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Team not found" });
    }
    if (req.body.profileIds && Array.isArray(req.body.profileIds) && req.body.profileIds.length > 0) {
      const tenantProfiles = await storage.getResourceProfiles(tenantId);
      const tenantProfileIds = new Set(tenantProfiles.map(p => p.id));
      for (const pid of req.body.profileIds) {
        if (!tenantProfileIds.has(pid)) {
          return res.status(400).json({ error: `Profile ${pid} does not belong to this tenant` });
        }
      }
    }
    const updateSchema = insertTeamSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors });
    }
    const team = await storage.updateTeam(req.params.id, parseResult.data);
    if (!team) return res.status(404).json({ error: "Team not found" });
    res.json(team);
}));

app.delete("/api/teams/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getTeam(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Team not found" });
    }
    await storage.deleteTeam(req.params.id);
    res.status(204).send();
}));

// ============== TEAM MEMBERS ==============
app.get("/api/team-members/:teamId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const team = await storage.getTeam(req.params.teamId);
    if (!verifyTenantOwnership(team, tenantId)) {
      return res.status(404).json({ error: "Team not found" });
    }
    const members = await storage.getTeamMembers(req.params.teamId);
    res.json(members);
}));

app.get("/api/team-members", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const members = await storage.getAllTeamMembers(tenantId);
    res.json(members);
}));

app.get("/api/team-member/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const member = await storage.getTeamMember(req.params.id);
    if (!member) return res.status(404).json({ error: "Team member not found" });
    
    const team = await storage.getTeam(member.teamId);
    if (!verifyTenantOwnership(team, tenantId)) {
      return res.status(404).json({ error: "Team member not found" });
    }
    res.json(member);
}));

app.post("/api/team-members/:teamId", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const team = await storage.getTeam(req.params.teamId);
    if (!verifyTenantOwnership(team, tenantId)) {
      return res.status(404).json({ error: "Team not found" });
    }
    const data = insertTeamMemberSchema.parse({ ...req.body, teamId: req.params.teamId });
    const member = await storage.createTeamMember(data);
    res.status(201).json(member);
}));

app.patch("/api/team-member/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getTeamMember(req.params.id);
    if (!existing) return res.status(404).json({ error: "Team member not found" });
    
    const team = await storage.getTeam(existing.teamId);
    if (!verifyTenantOwnership(team, tenantId)) {
      return res.status(404).json({ error: "Team member not found" });
    }
    
    const { id, teamId, resourceId, createdAt, ...updateData } = req.body;
    const member = await storage.updateTeamMember(req.params.id, updateData);
    if (!member) return res.status(404).json({ error: "Team member not found" });
    res.json(member);
}));

app.delete("/api/team-member/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getTeamMember(req.params.id);
    if (!existing) return res.status(404).json({ error: "Team member not found" });
    
    const team = await storage.getTeam(existing.teamId);
    if (!verifyTenantOwnership(team, tenantId)) {
      return res.status(404).json({ error: "Team member not found" });
    }
    
    await storage.deleteTeamMember(req.params.id);
    res.status(204).send();
}));

// ============== PLANNING PARAMETERS ==============
app.get("/api/planning-parameters", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const params = await storage.getPlanningParameters(tenantId);
    res.json(params);
}));

app.get("/api/planning-parameters/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const param = await storage.getPlanningParameter(req.params.id);
    const verified = verifyTenantOwnership(param, tenantId);
    if (!verified) return res.status(404).json({ error: "Planning parameter not found" });
    res.json(verified);
}));

app.post("/api/planning-parameters", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const data = insertPlanningParameterSchema.parse({ ...req.body, tenantId });
    const param = await storage.createPlanningParameter(data);
    res.status(201).json(param);
}));

app.patch("/api/planning-parameters/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPlanningParameter(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Planning parameter not found" });
    }
    const updateSchema = insertPlanningParameterSchema.partial().omit({ tenantId: true });
    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors });
    }
    const param = await storage.updatePlanningParameter(req.params.id, parseResult.data);
    if (!param) return res.status(404).json({ error: "Planning parameter not found" });
    res.json(param);
}));

app.delete("/api/planning-parameters/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getPlanningParameter(req.params.id);
    if (!verifyTenantOwnership(existing, tenantId)) {
      return res.status(404).json({ error: "Planning parameter not found" });
    }
    await storage.deletePlanningParameter(req.params.id);
    res.status(204).send();
}));

// ============== RESOURCE VEHICLES ==============
app.get("/api/resources/:resourceId/vehicles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource not found" });
    }
    const resourceVehicles = await storage.getResourceVehicles(req.params.resourceId);
    res.json(resourceVehicles);
}));

app.post("/api/resources/:resourceId/vehicles", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource not found" });
    }
    const data = insertResourceVehicleSchema.parse({ ...req.body, resourceId: req.params.resourceId });
    const rv = await storage.createResourceVehicle(data);
    res.status(201).json(rv);
}));

app.patch("/api/resource-vehicles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceVehicle(req.params.id);
    if (!existing) return res.status(404).json({ error: "Resource vehicle not found" });
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource vehicle not found" });
    }
    
    const { id, resourceId, vehicleId, createdAt, ...updateData } = req.body;
    const rv = await storage.updateResourceVehicle(req.params.id, updateData);
    if (!rv) return res.status(404).json({ error: "Resource vehicle not found" });
    res.json(rv);
}));

app.delete("/api/resource-vehicles/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceVehicle(req.params.id);
    if (!existing) return res.status(404).json({ error: "Resource vehicle not found" });
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource vehicle not found" });
    }
    
    await storage.deleteResourceVehicle(req.params.id);
    res.status(204).send();
}));

// ============== RESOURCE EQUIPMENT ==============
app.get("/api/resources/:resourceId/equipment", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource not found" });
    }
    const resourceEquipment = await storage.getResourceEquipment(req.params.resourceId);
    res.json(resourceEquipment);
}));

app.post("/api/resources/:resourceId/equipment", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const resource = await storage.getResource(req.params.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource not found" });
    }
    const data = insertResourceEquipmentSchema.parse({ ...req.body, resourceId: req.params.resourceId });
    const re = await storage.createResourceEquipment(data);
    res.status(201).json(re);
}));

app.patch("/api/resource-equipment/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceEquipmentById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Resource equipment not found" });
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource equipment not found" });
    }
    
    const { id, resourceId, equipmentId, createdAt, ...updateData } = req.body;
    const re = await storage.updateResourceEquipment(req.params.id, updateData);
    if (!re) return res.status(404).json({ error: "Resource equipment not found" });
    res.json(re);
}));

app.delete("/api/resource-equipment/:id", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const existing = await storage.getResourceEquipmentById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Resource equipment not found" });
    
    // Verify the parent resource belongs to the tenant
    const resource = await storage.getResource(existing.resourceId);
    if (!verifyTenantOwnership(resource, tenantId)) {
      return res.status(404).json({ error: "Resource equipment not found" });
    }
    
    await storage.deleteResourceEquipment(req.params.id);
    res.status(204).send();
}));

}
