import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { insertCustomerSchema, insertCustomerRelationshipSchema, insertObjectSchema, objects, objectParents, customers, workOrders, workOrderLines, technicianRatings, resources, teams, assignments, orderConcepts, metadataVarden, metadataKatalog, CUSTOMER_HIERARCHY_TYPES, insertInvoiceRecipientSchema, INVOICE_RECIPIENT_LEVELS, type InvoiceRecipientLevel } from "@shared/schema";
import { formatZodError, verifyTenantOwnership } from "./helpers";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ConflictError } from "../errors";
import { db } from "../db";
import { eq, and, isNull, sql, or, inArray } from "drizzle-orm";
import { primaryPayerCustomerIdSql, primaryPayerCustomerIdSqlFor, getObjectTreeLevel, objectHasPrimaryCustomerSql, ensurePrimaryPayer } from "../services/object-customer";
import { triggerGeocodeIfMissing } from "../services/geocoding";
import { copyObjectTree } from "../services/object-copy";
import { signObjectQrToken } from "../dynamic-qr-token";
import { createInheritanceProcessor } from "../inheritance-processor";

export async function registerCustomerRoutes(app: Express) {

app.get("/api/proactive-sales/inactive", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const months = Math.max(1, Math.min(60, parseInt(req.query.months as string) || 12));
  const search = (req.query.search as string || "").trim();
  const sortBy = (req.query.sortBy as string) === "days" ? "days" : "revenue";
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit as string) || 200));

  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - months);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  const searchCondition = search
    ? sql`AND (c.name ILIKE ${'%' + search + '%'} OR COALESCE(c.email, '') ILIKE ${'%' + search + '%'} OR COALESCE(c.contact_person, '') ILIKE ${'%' + search + '%'})`
    : sql``;

  const orderByClause = sortBy === "revenue"
    ? sql`ORDER BY CASE WHEN agg.order_count IS NULL THEN 1 ELSE 0 END, total_revenue DESC, days_since_last_order DESC`
    : sql`ORDER BY CASE WHEN agg.order_count IS NULL THEN 1 ELSE 0 END, days_since_last_order DESC, total_revenue DESC`;

  const inactiveBase = sql`
    FROM customers c
    LEFT JOIN (
      SELECT
        customer_id,
        MAX(scheduled_date) as last_order_date,
        COUNT(*) as order_count,
        SUM(COALESCE(cached_value, 0)) as total_revenue
      FROM work_orders
      WHERE tenant_id = ${tenantId}
        AND status IN ('completed', 'scheduled', 'in_progress')
        AND deleted_at IS NULL
      GROUP BY customer_id
    ) agg ON agg.customer_id = c.id
    WHERE c.tenant_id = ${tenantId}
      AND c.deleted_at IS NULL
      AND (agg.last_order_date IS NULL OR agg.last_order_date < ${cutoffStr}::date)
      ${searchCondition}
  `;

  const [inactiveRows, summaryResult, totalCustomersResult, totalRevenueResult] = await Promise.all([
    db.execute(sql`
      SELECT
        c.id,
        c.name,
        c.contact_person,
        c.email,
        c.phone,
        c.address,
        c.city,
        agg.last_order_date,
        agg.order_count,
        agg.total_revenue,
        CASE
          WHEN agg.last_order_date IS NULL THEN 9999
          ELSE EXTRACT(DAY FROM NOW() - agg.last_order_date)::int
        END as days_since_last_order
      ${inactiveBase}
      ${orderByClause}
      LIMIT ${limit}
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int as inactive_count,
        COALESCE(SUM(agg.total_revenue), 0)::bigint as lost_revenue
      ${inactiveBase}
    `),
    db.execute(sql`
      SELECT COUNT(*) as count FROM customers WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(cached_value), 0) as total
      FROM work_orders
      WHERE tenant_id = ${tenantId} AND status IN ('completed', 'scheduled', 'in_progress') AND deleted_at IS NULL
    `),
  ]);

  interface InactiveRow {
    id: string;
    name: string;
    contact_person: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    last_order_date: string | null;
    order_count: string;
    total_revenue: string;
    days_since_last_order: string;
  }
  interface SummaryRow { inactive_count: string; lost_revenue: string }
  interface CountRow { count: string }
  interface TotalRow { total: string }

  const totalCustomers = parseInt((totalCustomersResult.rows as unknown as CountRow[])[0]?.count ?? "0");
  const totalRevenueAll = parseInt((totalRevenueResult.rows as unknown as TotalRow[])[0]?.total ?? "0");
  const summaryRow = (summaryResult.rows as unknown as SummaryRow[])[0];
  const inactiveCount = parseInt(summaryRow?.inactive_count ?? "0");
  const totalLostRevenue = parseInt(summaryRow?.lost_revenue ?? "0");

  const rows = inactiveRows.rows as unknown as InactiveRow[];
  const inactiveList = rows.map((r) => ({
    id: r.id,
    name: r.name,
    contactPerson: r.contact_person,
    email: r.email,
    phone: r.phone,
    address: r.address,
    city: r.city,
    lastOrderDate: r.last_order_date ? new Date(r.last_order_date).toISOString().split("T")[0] : null,
    daysSinceLastOrder: parseInt(r.days_since_last_order),
    orderCount: parseInt(r.order_count || "0"),
    totalRevenue: parseInt(r.total_revenue || "0"),
  }));

  res.json({
    customers: inactiveList,
    summary: {
      inactiveCount,
      totalCustomers,
      totalLostRevenue,
      totalRevenueAll,
    },
  });
}));

app.get("/api/customers", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const idsParam = typeof req.query.ids === "string" ? req.query.ids : undefined;
  if (idsParam) {
    const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 500);
    const list = await storage.getCustomersByIds(tenantId, ids);
    return res.json(list);
  }
  const page = parseInt(req.query.page as string);
  const limit = Math.min(parseInt(req.query.limit as string) || 0, 200);
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  if (page > 0 && limit > 0) {
    const offset = (page - 1) * limit;
    const levelQ = typeof req.query.level === "string" ? req.query.level : undefined;
    const validLevel = levelQ && (levelQ === "none" || (CUSTOMER_HIERARCHY_TYPES as readonly string[]).includes(levelQ)) ? levelQ : undefined;
    const rootsOnly = req.query.rootsOnly === "true";
    const result = await storage.getCustomersPaginated(tenantId, limit, offset, search, {
      hierarchyType: validLevel,
      rootsOnly,
    });
    return res.json({ data: result.customers, total: result.total, page, limit });
  }
  const customers = await storage.getCustomers(tenantId);
  res.json(customers);
}));

app.get("/api/customers/aggregates", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const idsParam = typeof req.query.ids === "string" ? req.query.ids : undefined;
  const customerIds = idsParam
    ? idsParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 500)
    : undefined;
  const rows = await storage.getCustomerAggregates(tenantId, customerIds);
  res.json(rows);
}));

app.get("/api/customers/totals", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const totals = await storage.getCustomerTotals(tenantId);
  res.json(totals);
}));

app.get("/api/customers/:id/stats", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(customer, tenantId)) throw new NotFoundError("Kund");
  const stats = await storage.getCustomerStats(tenantId, req.params.id);
  res.json(stats);
}));

// Lönsamhet per kund: aggregerar work_orders.cachedValue/cachedCost + månadstrend
// Endast admin/owner — innehåller intern kostnadsdata
app.get("/api/customers/:id/profitability", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(customer, tenantId)) throw new NotFoundError("Kund");

  const includeDescendants = req.query.includeDescendants === "true";
  const customerIds = [req.params.id];
  if (includeDescendants) {
    const descendants = await storage.getCustomerDescendants(tenantId, req.params.id);
    customerIds.push(...descendants);
  }
  const customerFilter = customerIds.length === 1
    ? eq(workOrders.customerId, customerIds[0])
    : inArray(workOrders.customerId, customerIds);

  const totalsRow = await db
    .select({
      orderCount: sql<number>`COUNT(*)::int`,
      totalRevenue: sql<string>`COALESCE(SUM(${workOrders.cachedValue}), 0)::bigint`,
      totalCost: sql<string>`COALESCE(SUM(${workOrders.cachedCost}), 0)::bigint`,
    })
    .from(workOrders)
    .where(and(
      eq(workOrders.tenantId, tenantId),
      customerFilter,
      sql`${workOrders.deletedAt} IS NULL`,
    ));

  const t = totalsRow[0] || { orderCount: 0, totalRevenue: 0, totalCost: 0 };
  const totalRevenue = Number(t.totalRevenue) || 0;
  const totalCost = Number(t.totalCost) || 0;
  const totalMargin = totalRevenue - totalCost;

  const monthlyRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', COALESCE(${workOrders.scheduledDate}, ${workOrders.createdAt})), 'YYYY-MM')`,
      revenue: sql<string>`COALESCE(SUM(${workOrders.cachedValue}), 0)::bigint`,
      cost: sql<string>`COALESCE(SUM(${workOrders.cachedCost}), 0)::bigint`,
      orders: sql<number>`COUNT(*)::int`,
    })
    .from(workOrders)
    .where(and(
      eq(workOrders.tenantId, tenantId),
      customerFilter,
      sql`${workOrders.deletedAt} IS NULL`,
      sql`COALESCE(${workOrders.scheduledDate}, ${workOrders.createdAt}) >= NOW() - INTERVAL '12 months'`,
    ))
    .groupBy(sql`date_trunc('month', COALESCE(${workOrders.scheduledDate}, ${workOrders.createdAt}))`)
    .orderBy(sql`date_trunc('month', COALESCE(${workOrders.scheduledDate}, ${workOrders.createdAt}))`);

  res.json({
    customerId: req.params.id,
    orderCount: t.orderCount,
    totalRevenue,
    totalCost,
    totalMargin,
    marginPercent: totalRevenue > 0 ? Math.round((totalMargin / totalRevenue) * 100) : 0,
    monthly: monthlyRows.map(m => {
      const rev = Number(m.revenue) || 0;
      const c = Number(m.cost) || 0;
      return {
        month: m.month,
        revenue: rev,
        cost: c,
        margin: rev - c,
        marginPercent: rev > 0 ? Math.round(((rev - c) / rev) * 100) : 0,
        orders: m.orders,
      };
    }),
  });
}));

// Rollup-stats per koncern: aggregerar objekt, ordrar & intäkt över hela trädet
// per direkt barn-kund (inkl. deras ättlingar) + total inkl. self. Inte requireAdmin
// (matchar /api/customers/:id/stats — innehåller inte kostnadsdata).
app.get("/api/customers/:id/hierarchy/stats", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(customer, tenantId)) throw new NotFoundError("Kund");
  const stats = await storage.getCustomerHierarchyStats(tenantId, req.params.id);
  res.json({ customerId: req.params.id, ...stats });
}));

app.get("/api/customers/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  const verified = verifyTenantOwnership(customer, tenantId);
  if (!verified) throw new NotFoundError("Kund");
  res.json(verified);
}));

app.post("/api/customers", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertCustomerSchema.parse({ ...req.body, tenantId });
  // ADR v3 §2.2: validera parent separat — skapa kunden utan parent först,
  // applicera sedan via setCustomerParent (tenant- och existens-koll).
  const { parentCustomerId, ...createData } = data as typeof data & { parentCustomerId?: string | null };
  const customer = await storage.createCustomer(createData);
  if (parentCustomerId) {
    try {
      const updated = await storage.setCustomerParent(tenantId, customer.id, parentCustomerId);
      return res.status(201).json(updated);
    } catch (e) {
      // Rensa upp halv-skapad kund så vi inte lämnar dangling rader.
      try { await storage.deleteCustomer(customer.id); } catch {}
      throw new ValidationError(e instanceof Error ? e.message : "Kunde inte sätta förälder");
    }
  }
  res.status(201).json(customer);
}));

app.patch("/api/customers/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Kund");
  }
  const updateSchema = insertCustomerSchema.partial().omit({ tenantId: true });
  const parseResult = updateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json(formatZodError(parseResult.error));
  }
  const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, parentCustomerId, ...updateData } = parseResult.data as Record<string, unknown>;

  // ADR v3 §2.2: hantera parent-byte via dedikerad setter (cykel-validering).
  if (parentCustomerId !== undefined && parentCustomerId !== existing!.parentCustomerId) {
    try {
      await storage.setCustomerParent(tenantId, req.params.id, (parentCustomerId as string | null) ?? null);
    } catch (e) {
      throw new ValidationError(e instanceof Error ? e.message : "Kunde inte sätta förälder");
    }
  }

  const customer = Object.keys(updateData).length > 0
    ? await storage.updateCustomer(req.params.id, updateData)
    : await storage.getCustomer(req.params.id);
  if (!customer) throw new NotFoundError("Kund");
  res.json(customer);
}));

// ─── ADR v3 §2.2: Kund-hierarki ────────────────────────────────────────────
app.get("/api/customers/:id/hierarchy", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(customer, tenantId)) throw new NotFoundError("Kund");
  const [parent, children, ancestors] = await Promise.all([
    storage.getCustomerParent(tenantId, req.params.id),
    storage.getCustomerChildren(tenantId, req.params.id),
    storage.getCustomerAncestors(tenantId, req.params.id),
  ]);
  res.json({
    id: customer!.id,
    name: customer!.name,
    hierarchyType: customer!.hierarchyType,
    isReseller: customer!.isReseller,
    parent: parent ? { id: parent.id, name: parent.name, hierarchyType: parent.hierarchyType } : null,
    ancestors: ancestors.map((a) => ({ id: a.id, name: a.name, hierarchyType: a.hierarchyType })),
    children: children.map((c) => ({ id: c.id, name: c.name, hierarchyType: c.hierarchyType, isReseller: c.isReseller })),
  });
}));

app.put("/api/customers/:id/parent", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) throw new NotFoundError("Kund");
  const bodySchema = z.object({ parentCustomerId: z.string().nullable() });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
  try {
    const updated = await storage.setCustomerParent(tenantId, req.params.id, parsed.data.parentCustomerId);
    res.json(updated);
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : "Kunde inte sätta förälder");
  }
}));

app.get("/api/customers/:id/relationships", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(customer, tenantId)) throw new NotFoundError("Kund");
  const rels = await storage.getCustomerRelationships(tenantId, req.params.id);
  res.json(rels);
}));

app.post("/api/customers/:id/relationships", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(customer, tenantId)) throw new NotFoundError("Kund");
  const parsed = insertCustomerRelationshipSchema.safeParse({
    ...req.body,
    tenantId,
    fromCustomerId: req.params.id,
  });
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));
  try {
    const row = await storage.createCustomerRelationship(parsed.data);
    res.status(201).json(row);
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : "Kunde inte skapa relation");
  }
}));

app.delete("/api/customers/:id/relationships/:relId", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(customer, tenantId)) throw new NotFoundError("Kund");
  await storage.deleteCustomerRelationship(tenantId, req.params.relId);
  res.status(204).send();
}));

// Lista kunder filtrerat på hierarki-nivå (för UI-filter och dropdowns).
app.get("/api/customers-by-hierarchy", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const levelParam = typeof req.query.level === "string" ? req.query.level : undefined;
  const rootsOnly = req.query.rootsOnly === "true";
  const all = await storage.getCustomers(tenantId);
  let filtered = all;
  if (levelParam && (CUSTOMER_HIERARCHY_TYPES as readonly string[]).includes(levelParam)) {
    filtered = filtered.filter((c) => c.hierarchyType === levelParam);
  } else if (levelParam === "null") {
    filtered = filtered.filter((c) => !c.hierarchyType);
  }
  if (rootsOnly) {
    filtered = filtered.filter((c) => !c.parentCustomerId);
  }
  res.json(filtered.map((c) => ({
    id: c.id,
    name: c.name,
    hierarchyType: c.hierarchyType,
    parentCustomerId: c.parentCustomerId,
    isReseller: c.isReseller,
  })));
}));

app.delete("/api/customers/:id", requireAdmin, asyncHandler(async (req: any, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Kund");
  }
  await storage.deleteCustomer(req.params.id);
  try {
    await storage.createAuditLog({
      tenantId,
      userId: req.user?.claims?.sub ?? null,
      action: "customer.delete",
      resourceType: "customer",
      resourceId: req.params.id,
      changes: { name: existing!.name, customerNumber: existing!.customerNumber ?? null },
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    });
  } catch (e) {
    console.warn("[audit] customer.delete kunde inte skrivas", e);
  }
  res.status(204).send();
}));

app.post("/api/customers/:id/restore", requireAdmin, asyncHandler(async (req: any, res) => {
  const tenantId = getTenantIdWithFallback(req);
  // Hämta kunden inklusive soft-deletade (getCustomer filtrerar deletedAt).
  const [existing] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, req.params.id), eq(customers.tenantId, tenantId)));
  if (!existing) {
    throw new NotFoundError("Kund");
  }
  const restored = await storage.restoreCustomer(req.params.id, tenantId);
  if (!restored) {
    throw new NotFoundError("Kund");
  }
  try {
    await storage.createAuditLog({
      tenantId,
      userId: req.user?.claims?.sub ?? null,
      action: "customer.restore",
      resourceType: "customer",
      resourceId: req.params.id,
      changes: { name: restored.name },
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null,
    });
  } catch (e) {
    console.warn("[audit] customer.restore kunde inte skrivas", e);
  }
  res.json(restored);
}));

app.get("/api/objects/lookup", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const rows = await db
    .select({
      id: objects.id,
      name: objects.name,
      objectNumber: objects.objectNumber,
      hierarchyLevel: objects.hierarchyLevel,
      objectType: objects.objectType,
      customerId: primaryPayerCustomerIdSql(),
      parentId: objects.parentId,
    })
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
  res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=180");
  res.setHeader("Vary", "Cookie, Accept-Encoding");
  res.json(rows);
}));

app.get("/api/objects", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const limit = parseInt(req.query.limit as string) || 100;
  const offset = parseInt(req.query.offset as string) || 0;
  const search = req.query.search as string || "";
  const customerIdParam = req.query.customerId as string || undefined;
  const customerIds = customerIdParam ? customerIdParam.split(",").filter(id => id.trim()) : undefined;
  const objectType = req.query.objectType as string || undefined;
  const hierarchyLevel = req.query.hierarchyLevel as string || undefined;
  const ids = req.query.ids as string || undefined;

  if (ids) {
    const idArray = ids.split(",").filter(id => id.trim());
    if (idArray.length > 0) {
      const objects = await storage.getObjectsByIds(tenantId, idArray);
      return res.json(objects);
    }
  }

  const interim = req.query.interim as string || undefined;
  // Task #1357: filtrera på importbatch (objekt stämplas med importBatchId vid Import 2.0).
  const importBatchId = (req.query.importBatchId as string)?.trim() || undefined;
  const issue = req.query.issue as string || undefined;
  const reported = req.query.reported === "true";
  // Task #990: platstyp-filter (pinpoint/area/none). Ogiltig param ignoreras.
  const locationTypeParam = req.query.locationType as string || undefined;
  const locationType = locationTypeParam && ["pinpoint", "area", "none"].includes(locationTypeParam)
    ? locationTypeParam
    : undefined;

  // Task #940: standardiserat villkorsfilter (metadatafält + operator + värde).
  // Körs genom den DELADE `filterObjectsByConditions`/`matchesFilter` så listans
  // resultat alltid matchar orderkoncept-förhandsvisningen. Ogiltig param ignoreras.
  let conditions: { metadataKey: string; operator: string; filterValue: unknown }[] = [];
  const conditionsParam = req.query.conditions as string || undefined;
  if (conditionsParam) {
    try {
      const parsed = JSON.parse(conditionsParam);
      if (Array.isArray(parsed)) {
        conditions = parsed
          .filter((c: any) => c && typeof c.metadataKey === "string" && c.metadataKey.trim() && typeof c.operator === "string")
          .map((c: any) => ({ metadataKey: c.metadataKey, operator: c.operator, filterValue: c.filterValue }));
      }
    } catch { /* ogiltig conditions-param ignoreras */ }
  }
  const hasConditions = conditions.length > 0;

  // Task #1400: legacy-filtret "kopplade uppgifter" (taskType/taskCustomerId/
  // taskCompletedFrom/To) är borttaget — fördjupad filtrering sker via
  // metadatavillkoren (conditions) ovan plus geografiska filter.
  const hasFilters = objectType || hierarchyLevel || interim || issue || reported || locationType || importBatchId;
  const paginated = req.query.paginated === "true";

  // Task #552 (A): Berika listsvar med composed displayName så att alla konsumenter
  // (listor, map-popups, planner) kan visa släktnamn när tenant aktiverat det.
  const enrichWithDisplayName = async (rows: Array<Record<string, unknown>>) => {
    if (rows.length === 0) return rows;
    try {
      const { computeDisplayNamesBatch } = await import("../services/display-name");
      const ids = rows.map(r => String(r.id)).filter(Boolean);
      const map = await computeDisplayNamesBatch(ids, tenantId);
      return rows.map(r => ({ ...r, displayName: map.get(String(r.id)) || (r as any).name }));
    } catch {
      return rows.map(r => ({ ...r, displayName: (r as any).name }));
    }
  };

  if (paginated || req.query.limit || req.query.offset || req.query.search || req.query.customerId || hasFilters || hasConditions) {
    const filters = hasFilters ? { objectType, hierarchyLevel, isInterimObject: interim === "true" ? true : interim === "false" ? false : undefined, issue, reported: reported || undefined, locationType, importBatchId } : undefined;

    if (hasConditions) {
      // Villkorsfilter (Task #1412): strömma bas-filtrerade objekt sida för sida
      // (stabil ordning: name, id) och kör den DELADE matchningen
      // (filterObjectsByConditions — samma som orderkoncept-preview) per batch.
      // Semantiken är per-objekt så batchningen kan inte divergera från den
      // delade matchningen; totalen räknas över hela genomströmningen medan
      // bara den efterfrågade sidan behålls i minnet.
      const { filterObjectsByConditions } = await import("../services/order-concept-targeting");
      const BATCH_SIZE = 1000;
      const page: unknown[] = [];
      let total = 0;
      for (let batchOffset = 0; ; batchOffset += BATCH_SIZE) {
        const batch = await storage.getObjectsPaginated(tenantId, BATCH_SIZE, batchOffset, search, customerIds, filters);
        if (batch.objects.length === 0) break;
        const matched = await filterObjectsByConditions(tenantId, batch.objects as any, conditions);
        for (const obj of matched) {
          if (total >= offset && page.length < limit) page.push(obj);
          total++;
        }
        if (batch.objects.length < BATCH_SIZE) break;
      }
      const enriched = await enrichWithDisplayName(page as Array<Record<string, unknown>>);
      res.json({ objects: enriched, total });
      return;
    }

    const result = await storage.getObjectsPaginated(tenantId, limit, offset, search, customerIds, filters);
    const enriched = await enrichWithDisplayName(result.objects as Array<Record<string, unknown>>);
    res.json({ ...result, objects: enriched });
  } else {
    const objects = await storage.getObjects(tenantId);
    const enriched = await enrichWithDisplayName(objects as unknown as Array<Record<string, unknown>>);
    res.json(enriched);
  }
}));

app.get("/api/objects/tree", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { customerId, search, parentId, flat } = req.query;
  const searchStr = typeof search === "string" ? search.trim() : "";
  const customerStr = typeof customerId === "string" && customerId.trim() ? customerId.trim() : null;
  const flatRequested = flat === "true" || flat === "1";

  // Defense-in-depth: verifiera att ett kund-förfilter pekar på en kund i denna
  // tenant. Objektfrågorna nedan är redan tenant-scopade (objects.tenantId), men en
  // främmande/ogiltig customerId ska ge tomt resultat — inte tyst falla tillbaka
  // till osökt scope eller läcka via korrupta object_payers-referenser.
  if (customerStr) {
    const customer = await storage.getCustomer(customerStr);
    if (!verifyTenantOwnership(customer, tenantId)) {
      return res.json([]);
    }
  }

  // Platt, sökbar lista för "Välj överordnat objekt"-väljaren. Aktiveras av en
  // fritextsökning (alla anropare — sök har alltid gett en platt lista) ELLER av en
  // explicit flat=true tillsammans med ett kund-förfilter (väljarens kund-scope-läge
  // som listar HELA kundens primär-payer-objekt platt, på alla nivåer). Ett
  // customerId UTAN flat=true behåller den hierarkiska träd-nivå-vyn (med riktig
  // childCount) som andra konsumenter förlitar sig på — annars bryts objektträdet.
  if (searchStr.length > 0 || (flatRequested && customerStr)) {
    const conditions = [
      eq(objects.tenantId, tenantId),
      isNull(objects.deletedAt),
    ];
    if (searchStr.length > 0) {
      const q = `%${searchStr.toLowerCase()}%`;
      conditions.push(or(
        sql`LOWER(${objects.name}) LIKE ${q}`,
        sql`LOWER(${objects.address}) LIKE ${q}`,
        sql`LOWER(${objects.objectNumber}) LIKE ${q}`
      )!);
    }
    if (customerStr) {
      conditions.push(objectHasPrimaryCustomerSql(customerStr));
    }

    const rows = await db
      .select({
        id: objects.id,
        name: objects.name,
        objectNumber: objects.objectNumber,
        objectType: objects.objectType,
        address: objects.address,
        customerId: primaryPayerCustomerIdSql(),
        customerName: customers.name,
      })
      .from(objects)
      .leftJoin(customers, sql`${customers.id} = ${primaryPayerCustomerIdSql()}`)
      .where(and(...conditions))
      .orderBy(objects.name)
      .limit(200);

    // Task #727: berika träffar med släktnamn (displayName) så att en sökbar
    // "Överordnat objekt"-dropdown kan visa hela hierarki-kedjan per träff och
    // användaren inte kopplar mot fel gren när två objekt har samma namn.
    let displayNameMap = new Map<string, string>();
    try {
      const { computeDisplayNamesBatch } = await import("../services/display-name");
      displayNameMap = await computeDisplayNamesBatch(rows.map(r => r.id), tenantId);
    } catch {
      // fallback: displayName = name
    }

    return res.json(rows.map(r => ({
      ...r,
      displayName: displayNameMap.get(r.id) || r.name,
      childCount: 0,
      children: [],
    })));
  }

  const nodes = await getObjectTreeLevel(tenantId, {
    parentId: typeof parentId === "string" ? parentId : null,
    customerId: customerStr,
  });
  res.json(nodes);
}));

// Fullt objektträd för ObjectHierarchyTree (Step4Inspection + ObjectsPage).
// Ersätter gamla /api/clusters/tree (Etapp 5: klustermodellen borttagen).
// scope=top laddar enbart toppnivå-objekt (lättare för stora tenants).
app.get("/api/objects/hierarchy-tree", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const scope = req.query.scope === "top" ? "top" : "all";

  const objRows = await db.select({
    id: objects.id,
    name: objects.name,
    parentId: objects.parentId,
    hierarchyLevel: objects.hierarchyLevel,
    objectType: objects.objectType,
    latitude: objects.latitude,
    longitude: objects.longitude,
    entranceLatitude: objects.entranceLatitude,
    entranceLongitude: objects.entranceLongitude,
    address: objects.address,
    postalCode: objects.postalCode,
    city: objects.city,
    customerId: primaryPayerCustomerIdSql(),
  }).from(objects).where(
    scope === "top"
      ? and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt), isNull(objects.parentId))
      : and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)),
  );

  // I toppnivå-läget begränsas berikningsfrågorna till de laddade rötterna.
  const objIds = objRows.map(o => o.id);
  const topScopeEmpty = scope === "top" && objIds.length === 0;

  // Kundnamn för härledda kund-id:n (Ekonomi-metadatafältet "Kund")
  const customerIds = Array.from(new Set(objRows.map(o => o.customerId).filter((v): v is string => !!v)));
  const customerRows = customerIds.length > 0
    ? await db.select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), inArray(customers.id, customerIds)))
    : [];
  const customerNameById = new Map(customerRows.map(c => [c.id, c.name] as const));

  // Arbetsordrar → utförare + orderstatus per objekt
  const woRows = topScopeEmpty ? [] : await db.select({
    objectId: workOrders.objectId,
    orderStatus: workOrders.orderStatus,
    resourceId: workOrders.resourceId,
    teamId: workOrders.teamId,
  }).from(workOrders).where(
    scope === "top"
      ? and(eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt), inArray(workOrders.objectId, objIds))
      : and(eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt)),
  );

  const resourceRows = await db.select({ id: resources.id, name: resources.name })
    .from(resources).where(eq(resources.tenantId, tenantId));
  const teamRows = await db.select({ id: teams.id, name: teams.name })
    .from(teams).where(eq(teams.tenantId, tenantId));
  const resourceName = new Map(resourceRows.map(r => [r.id, r.name] as const));
  const teamName = new Map(teamRows.map(t => [t.id, t.name] as const));

  const woByObject = new Map<string, { statuses: Set<string>; execIds: Set<string>; execNames: Set<string> }>();
  for (const wo of woRows) {
    if (!wo.objectId) continue;
    let agg = woByObject.get(wo.objectId);
    if (!agg) { agg = { statuses: new Set(), execIds: new Set(), execNames: new Set() }; woByObject.set(wo.objectId, agg); }
    if (wo.orderStatus) agg.statuses.add(wo.orderStatus);
    if (wo.resourceId) { agg.execIds.add(wo.resourceId); const n = resourceName.get(wo.resourceId); if (n) agg.execNames.add(n); }
    if (wo.teamId) { agg.execIds.add(wo.teamId); const n = teamName.get(wo.teamId); if (n) agg.execNames.add(n); }
  }

  // Direkt metadata per objekt (ej mjukraderad)
  const metaRows = topScopeEmpty ? [] : await db.select({
    objektId: metadataVarden.objektId,
    namn: metadataKatalog.namn,
    vardeString: metadataVarden.vardeString,
    vardeInteger: metadataVarden.vardeInteger,
    vardeDecimal: metadataVarden.vardeDecimal,
    vardeBoolean: metadataVarden.vardeBoolean,
    vardeDatetime: metadataVarden.vardeDatetime,
    vardeJson: metadataVarden.vardeJson,
  }).from(metadataVarden)
    .innerJoin(metadataKatalog, and(
      eq(metadataVarden.metadataKatalogId, metadataKatalog.id),
      isNull(metadataKatalog.deletedAt),
    ))
    .where(
      scope === "top"
        ? and(eq(metadataVarden.tenantId, tenantId), eq(metadataVarden.raderad, false), eq(metadataVarden.status, "aktiv"), inArray(metadataVarden.objektId, objIds))
        : and(eq(metadataVarden.tenantId, tenantId), eq(metadataVarden.raderad, false), eq(metadataVarden.status, "aktiv")),
    );

  const metaByObject = new Map<string, Record<string, string>>();
  for (const r of metaRows) {
    if (!r.objektId) continue;
    let v: string | null = null;
    if (r.vardeString != null) v = String(r.vardeString);
    else if (r.vardeInteger != null) v = String(r.vardeInteger);
    else if (r.vardeDecimal != null) v = String(r.vardeDecimal);
    else if (r.vardeBoolean != null) v = r.vardeBoolean ? "Ja" : "Nej";
    else if (r.vardeDatetime != null) v = new Date(r.vardeDatetime).toISOString().slice(0, 10);
    else if (r.vardeJson != null) v = typeof r.vardeJson === "string" ? r.vardeJson : JSON.stringify(r.vardeJson);
    if (v == null) continue;
    let m = metaByObject.get(r.objektId);
    if (!m) { m = {}; metaByObject.set(r.objektId, m); }
    m[r.namn.toLowerCase()] = v;
  }

  // Direkta barn-räknare
  const childCount = new Map<string, number>();
  if (scope === "top") {
    if (!topScopeEmpty) {
      const ccRows = await db.select({
        parentId: objects.parentId,
        c: sql<number>`count(*)::int`,
      }).from(objects)
        .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt), inArray(objects.parentId, objIds)))
        .groupBy(objects.parentId);
      for (const r of ccRows) {
        if (r.parentId) childCount.set(r.parentId, Number(r.c) || 0);
      }
    }
  } else {
    for (const o of objRows) {
      if (o.parentId) childCount.set(o.parentId, (childCount.get(o.parentId) || 0) + 1);
    }
  }

  const nodes = objRows.map(o => {
    const agg = woByObject.get(o.id);
    return {
      id: o.id,
      name: o.name,
      parentId: o.parentId,
      hierarchyLevel: o.hierarchyLevel,
      objectType: o.objectType,
      latitude: o.latitude,
      longitude: o.longitude,
      entranceLatitude: o.entranceLatitude,
      entranceLongitude: o.entranceLongitude,
      address: o.address,
      postalCode: o.postalCode,
      city: o.city,
      childCount: childCount.get(o.id) || 0,
      customerId: o.customerId,
      customerName: o.customerId ? (customerNameById.get(o.customerId) ?? null) : null,
      executorIds: agg ? Array.from(agg.execIds) : [],
      executorNames: agg ? Array.from(agg.execNames) : [],
      orderStatuses: agg ? Array.from(agg.statuses) : [],
      metadata: metaByObject.get(o.id) || {},
    };
  });

  res.json({ nodes });
}));

app.get("/api/objects/tree/:parentId/children", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { parentId } = req.params;
  const { customerId } = req.query;

  const nodes = await getObjectTreeLevel(tenantId, {
    parentId,
    customerId: typeof customerId === "string" ? customerId : null,
  });
  res.json(nodes);
}));

app.get("/api/objects/tree/:parentId/descendants", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { parentId } = req.params;
  const { customerId } = req.query;

  // Kundkoppling härleds ur Ekonomi-metadatat 'Kund' (Etapp 5).
  const customerClause = (customerId && typeof customerId === "string")
    ? sql` AND ${primaryPayerCustomerIdSqlFor(sql.raw("objects.id"))} = ${customerId}`
    : sql``;
  const customerClauseR = (customerId && typeof customerId === "string")
    ? sql` AND ${primaryPayerCustomerIdSqlFor(sql.raw("o.id"))} = ${customerId}`
    : sql``;

  const result = await db.execute(sql`
    WITH RECURSIVE tree AS (
      SELECT id FROM objects WHERE id = ${parentId} AND tenant_id = ${tenantId} AND deleted_at IS NULL${customerClause}
      UNION ALL
      SELECT o.id FROM objects o INNER JOIN tree t ON o.parent_id = t.id WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL${customerClauseR}
    )
    SELECT id FROM tree
  `);
  const ids = (result.rows as Array<{ id: string }>).map(r => r.id);
  res.json(ids);
}));

app.get("/api/objects/with-issues", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { issueType, status, customerId, limit } = req.query;
  const parsedLimit = limit ? Math.max(1, Math.min(1000, parseInt(limit as string) || 0)) : undefined;

  const result = await storage.getObjectsWithIssues(tenantId, {
    issueType: typeof issueType === "string" ? issueType : undefined,
    status: typeof status === "string" ? status : undefined,
    customerId: typeof customerId === "string" ? customerId : undefined,
    limit: parsedLimit,
  });

  res.json(result);
}));

app.get("/api/objects/:id/work-orders", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const object = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(object, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  // Task #1370: direkt tenant+objekt-scopad DB-query (tidigare filtrerades en
  // tenant-vid 500-lista i minnet — objektets ordrar kunde falla utanför capen).
  // Fulla work_orders-rader behålls (inkl. sourceType/orderConceptId/orderNumber/
  // invoiceQueueState som "Kopplade order och uppgifter"-tabellen konsumerar).
  const objectOrders = await db
    .select()
    .from(workOrders)
    .where(and(
      eq(workOrders.tenantId, tenantId),
      eq(workOrders.objectId, req.params.id),
      isNull(workOrders.deletedAt),
    ))
    .orderBy(sql`${workOrders.createdAt} DESC`)
    .limit(50);

  // Task #714: berika varje order med antal orderrader ("antal") för korten.
  const orderIds = objectOrders.map(wo => wo.id);
  const lineCounts = new Map<string, number>();
  if (orderIds.length > 0) {
    const rows = await db
      .select({ workOrderId: workOrderLines.workOrderId, count: sql<number>`count(*)::int` })
      .from(workOrderLines)
      .where(and(eq(workOrderLines.tenantId, tenantId), inArray(workOrderLines.workOrderId, orderIds)))
      .groupBy(workOrderLines.workOrderId);
    for (const r of rows) lineCounts.set(r.workOrderId, Number(r.count) || 0);
  }
  // Task #1370: berika med orderkonceptets namn för "Kopplade order och
  // uppgifter"-tabellen (källa + klickbar konceptlänk). Tenant-scopad lookup.
  const conceptIds = Array.from(new Set(objectOrders.map(wo => wo.orderConceptId).filter((v): v is string => !!v)));
  const conceptNames = new Map<string, string>();
  if (conceptIds.length > 0) {
    const rows = await db
      .select({ id: orderConcepts.id, name: orderConcepts.name })
      .from(orderConcepts)
      .where(and(eq(orderConcepts.tenantId, tenantId), inArray(orderConcepts.id, conceptIds)));
    for (const r of rows) if (r.name) conceptNames.set(r.id, r.name);
  }
  const enriched = objectOrders.map(wo => ({
    ...wo,
    lineCount: lineCounts.get(wo.id) ?? 0,
    orderConceptName: wo.orderConceptId ? conceptNames.get(wo.orderConceptId) ?? null : null,
  }));
  res.json(enriched);
}));

// Task #857: planeringslager-uppgifter (assignments) kopplade till ett objekt,
// berikade med orderkoncept-namn samt kund (via koncept) för djuplänkning
// objekt → uppgift → orderkoncept → kund. Tenant-scopad — cross-tenant ger 404.
app.get("/api/objects/:id/assignments", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const object = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(object, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const rows = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      status: assignments.status,
      priority: assignments.priority,
      scheduledDate: assignments.scheduledDate,
      quantity: assignments.quantity,
      createdAt: assignments.createdAt,
      // Task #1370: uppgiftens ursprung (stämplas vid skapandet, Task #1369).
      sourceType: assignments.sourceType,
      orderConceptId: assignments.orderConceptId,
      orderConceptName: orderConcepts.name,
      customerId: orderConcepts.customerId,
      customerName: customers.name,
    })
    .from(assignments)
    .leftJoin(orderConcepts, and(
      eq(assignments.orderConceptId, orderConcepts.id),
      eq(orderConcepts.tenantId, tenantId),
    ))
    .leftJoin(customers, and(
      eq(orderConcepts.customerId, customers.id),
      eq(customers.tenantId, tenantId),
    ))
    .where(and(
      eq(assignments.tenantId, tenantId),
      eq(assignments.objectId, req.params.id),
      isNull(assignments.deletedAt),
    ))
    .orderBy(sql`${assignments.createdAt} DESC`)
    .limit(100);
  res.json(rows);
}));

// Task #714: kronologisk lista över felanmälningar på ett objekt (för galleri
// med bläddringsbara foton). Tenant-scopad — cross-tenant ger 404.
app.get("/api/objects/:id/issue-reports", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const object = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(object, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const reports = await storage.getPublicIssueReports(tenantId, { objectId: req.params.id });
  res.json(reports);
}));

// Task #727: kronologisk lista över technician-ratings per objekt. technician_ratings
// har inget objectId — vi joinar via work_orders.objectId. Tenant-scopad i alla
// predikat (cross-tenant ger tom lista).
app.get("/api/objects/:id/ratings", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const object = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(object, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const rows = await db
    .select({
      id: technicianRatings.id,
      workOrderId: technicianRatings.workOrderId,
      resourceId: technicianRatings.resourceId,
      resourceName: resources.name,
      rating: technicianRatings.rating,
      comment: technicianRatings.comment,
      categories: technicianRatings.categories,
      createdAt: technicianRatings.createdAt,
    })
    .from(technicianRatings)
    .innerJoin(workOrders, eq(technicianRatings.workOrderId, workOrders.id))
    .leftJoin(resources, eq(technicianRatings.resourceId, resources.id))
    .where(and(
      eq(technicianRatings.tenantId, tenantId),
      eq(workOrders.tenantId, tenantId),
      eq(workOrders.objectId, req.params.id),
    ))
    .orderBy(sql`${technicianRatings.createdAt} DESC`)
    .limit(100);
  res.json(rows);
}));

// Task #714: signerad, objekt-bunden QR-token för kundbetyg/feedback. Token
// härleds server-side (HMAC) — klienten bygger /feedback/:token-URL:en.
app.get("/api/objects/:id/feedback-token", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const object = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(object, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const token = signObjectQrToken(tenantId, req.params.id);
  res.json({ token });
}));

// Task #681: read-only förhandsvisning av nästa systemnummer för skapa-dialogen.
// Måste ligga FÖRE "/api/objects/:id" annars matchar :id "next-number".
app.get("/api/objects/next-number", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const objectNumber = await storage.previewNextObjectNumber(tenantId);
  res.json({ objectNumber });
}));

// Task #1426: batchade uppgiftsräknare för objektlistan — antal kopplade
// uppgifter (work_orders + assignments via object_id, ej soft-deletade) per
// objekt. Klienten skickar synliga objekt-id:n i ETT anrop (ingen N+1).
// Måste ligga FÖRE "/api/objects/:id" annars matchar :id "task-counts".
app.get("/api/objects/task-counts", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const idsParam = (req.query.ids as string) || "";
  // Cap: en listsida är max några hundra rader — skydda mot orimliga anrop.
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (ids.length === 0) return res.json({});

  const counts: Record<string, number> = {};
  const [woRows, asgRows] = await Promise.all([
    db
      .select({ objectId: workOrders.objectId, count: sql<number>`count(*)::int` })
      .from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        inArray(workOrders.objectId, ids),
        isNull(workOrders.deletedAt),
      ))
      .groupBy(workOrders.objectId),
    db
      .select({ objectId: assignments.objectId, count: sql<number>`count(*)::int` })
      .from(assignments)
      .where(and(
        eq(assignments.tenantId, tenantId),
        inArray(assignments.objectId, ids),
        isNull(assignments.deletedAt),
      ))
      .groupBy(assignments.objectId),
  ]);
  for (const r of woRows) {
    if (r.objectId) counts[r.objectId] = (counts[r.objectId] ?? 0) + (Number(r.count) || 0);
  }
  for (const r of asgRows) {
    if (r.objectId) counts[r.objectId] = (counts[r.objectId] ?? 0) + (Number(r.count) || 0);
  }
  res.json(counts);
}));

app.get("/api/objects/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const object = await storage.getObject(req.params.id);
  const verified = verifyTenantOwnership(object, tenantId);
  if (!verified) throw new NotFoundError("Objekt");
  res.json(verified);
}));

// Task #681 / #713: klona ett objekt — nytt systemnummer, "(kopia)"-namn och
// metadata kopierade (båda metadata-systemen). mode="single" (default) kopierar
// bara objektet; mode="branch" kopierar hela grenen (objekt + alla barnobjekt)
// med bevarad intern hierarki. Se server/services/object-copy.ts.
app.post("/api/objects/:id/copy", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const source = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(source, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const mode = req.body?.mode === "branch" ? "branch" : "single";
  const requestedName = typeof req.body?.name === "string" ? req.body.name : undefined;

  const result = await copyObjectTree(req.params.id, tenantId, mode, { name: requestedName });

  const updated = await storage.getObject(result.rootId);
  res.status(201).json({
    ...(updated || result.rootClone),
    copiedMetadata: result.copiedMetadata,
    metadataCopyError: result.metadataCopyError,
    createdCount: result.createdIds.length,
    createdIds: result.createdIds,
    mode,
  });
}));

app.get("/api/customers/:customerId/objects", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.customerId);
  if (!verifyTenantOwnership(customer, tenantId)) {
    throw new NotFoundError("Kund");
  }
  const objects = await storage.getObjectsByCustomer(req.params.customerId, tenantId);
  res.json(objects);
}));

app.get("/api/customers/:customerId/objects/tree-roots", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.customerId);
  if (!verifyTenantOwnership(customer, tenantId)) {
    throw new NotFoundError("Kund");
  }
  const roots = await storage.getCustomerObjectTreeRoots(req.params.customerId, tenantId);
  res.json(roots);
}));

app.get("/api/customers/:customerId/objects/tree-children", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.customerId);
  if (!verifyTenantOwnership(customer, tenantId)) {
    throw new NotFoundError("Kund");
  }
  const parentId = (req.query.parentId as string | undefined)?.trim();
  if (!parentId) {
    throw new ValidationError("parentId krävs");
  }
  const children = await storage.getCustomerObjectTreeChildren(req.params.customerId, tenantId, parentId);
  res.json(children);
}));

app.get("/api/customers/:customerId/objects/search", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.customerId);
  if (!verifyTenantOwnership(customer, tenantId)) {
    throw new NotFoundError("Kund");
  }
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 50));
  if (!q.trim()) {
    return res.json([]);
  }
  const hits = await storage.searchCustomerObjects(req.params.customerId, tenantId, q, limit);
  res.json(hits);
}));

app.get("/api/customers/:customerId/objects/coordinates", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.customerId);
  if (!verifyTenantOwnership(customer, tenantId)) {
    throw new NotFoundError("Kund");
  }
  let bbox: [number, number, number, number] | undefined;
  if (typeof req.query.bbox === "string") {
    const parts = req.query.bbox.split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      bbox = [parts[0], parts[1], parts[2], parts[3]];
    }
  }
  const limit = Math.max(1, Math.min(5000, parseInt(req.query.limit as string) || 2000));
  const zoomRaw = parseFloat(req.query.zoom as string);
  if (!Number.isFinite(zoomRaw)) {
    // Backward compatible: no zoom = legacy point list
    const points = await storage.getCustomerObjectMapPoints(req.params.customerId, tenantId, { bbox, limit });
    return res.json(points);
  }
  const data = await storage.getCustomerObjectMapData(req.params.customerId, tenantId, { bbox, zoom: zoomRaw, limit });
  res.json(data);
}));

app.post("/api/objects/coordinates", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { objectIds } = req.body as { objectIds: string[] };
  if (!Array.isArray(objectIds) || objectIds.length === 0) {
    return res.json([]);
  }
  const limited = objectIds.slice(0, 3000);
  const matchedObjects = await storage.getObjectsByIds(tenantId, limited);
  const coords = matchedObjects
    .filter(o => o.latitude && o.longitude)
    .map(o => ({ id: o.id, latitude: o.latitude, longitude: o.longitude }));
  res.json(coords);
}));

app.post("/api/objects", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const data = insertObjectSchema.parse({ ...req.body, tenantId });

  // Task #681: defense-in-depth — verifiera att refererad förälder/kund
  // tillhör samma tenant innan objektet skapas (cross-tenant-skydd).
  if (data.parentId) {
    const parent = await storage.getObject(data.parentId);
    if (!verifyTenantOwnership(parent, tenantId)) {
      throw new NotFoundError("Förälderobjekt");
    }
  }
  // ADR v3 (Task #560): objekt är kund-neutrala. Body-fältet `customerId` stöds
  // fortfarande (API-kontrakt) men materialiseras som en primär payer i stället
  // för en kolumn på objekt-raden. insertObjectSchema strippar bort det (ingen
  // kolumn längre), så läs det direkt från body och validera tenant-ägarskap.
  const bodyCustomerId =
    typeof req.body?.customerId === "string" && req.body.customerId.trim()
      ? req.body.customerId.trim()
      : null;
  if (bodyCustomerId) {
    const customer = await storage.getCustomer(bodyCustomerId);
    if (!verifyTenantOwnership(customer, tenantId)) {
      throw new NotFoundError("Kund");
    }
  }

  const object = await storage.createObject(data);

  if (bodyCustomerId) {
    await ensurePrimaryPayer(tenantId, object.id, bodyCustomerId, "user-explicit");
  }

  triggerGeocodeIfMissing(object.id);

  const updated = await storage.getObject(object.id);
  res.status(201).json(updated || object);
}));

app.patch("/api/objects/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  if ((existing as any).deletedAt) {
    throw new ValidationError("Objektet är arkiverat och kan inte redigeras. Återställ objektet först.");
  }
  const updateSchema = insertObjectSchema.partial().omit({ tenantId: true });
  const parseResult = updateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json(formatZodError(parseResult.error));
  }
  // ADR v3 (Task #560): objekt är kund-neutrala. `customerId` finns inte längre
  // som kolumn — insertObjectSchema strippar bort det, så en PATCH med customerId
  // blir en no-op här. Ändra kund via object_payers (ObjectPayersPanel-endpoints).
  const { tenantId: _t, id: _id, createdAt: _c, deletedAt: _d, customerId: _cust, ...updateData } = parseResult.data as Record<string, unknown>;

  // Task #727: repoint (byt överordnat objekt) ska hålla object_parents primär-
  // relation i synk med legacy objects.parentId (invariant: skriv aldrig den ena
  // utan den andra). Validera att den nya föräldern tillhör samma tenant, blockera
  // självkoppling, och kör objects.parentId + object_parents atomiskt i en transaktion.
  const isRepoint = "parentId" in updateData;
  let newParentId: string | null = null;
  if (isRepoint) {
    newParentId = (updateData.parentId as string | null) ?? null;
    if (newParentId && newParentId === req.params.id) {
      throw new ValidationError("Ett objekt kan inte vara sitt eget överordnade objekt.");
    }
    if (newParentId) {
      const parent = await storage.getObject(newParentId);
      if (!verifyTenantOwnership(parent, tenantId)) {
        throw new NotFoundError("Förälderobjekt");
      }
      if (await storage.wouldCreateObjectCycle(tenantId, req.params.id, newParentId)) {
        throw new ValidationError("Du kan inte flytta ett objekt till ett av sina egna underordnade objekt (skulle skapa en cykel).");
      }
    }
  }

  // Skriv allt utom parentId via storage; parentId hanteras atomiskt nedan så att
  // legacy-kolumnen och object_parents aldrig kan hamna i otakt vid fel/race.
  const { parentId: _p, ...nonParentUpdate } = updateData as Record<string, unknown>;
  let object = await storage.updateObject(req.params.id, nonParentUpdate);
  if (!object) throw new NotFoundError("Objekt");

  if (isRepoint) {
    await db.transaction(async (tx) => {
      await tx.update(objects)
        .set({ parentId: newParentId })
        .where(and(eq(objects.id, req.params.id), eq(objects.tenantId, tenantId)));

      const existingPrimary = await tx
        .select({ id: objectParents.id, parentId: objectParents.parentId })
        .from(objectParents)
        .where(and(
          eq(objectParents.objectId, req.params.id),
          eq(objectParents.tenantId, tenantId),
          eq(objectParents.isPrimary, true),
        ));
      const primary = existingPrimary[0];
      if (!newParentId) {
        if (primary) {
          await tx.delete(objectParents).where(and(eq(objectParents.id, primary.id), eq(objectParents.tenantId, tenantId)));
        }
      } else if (primary) {
        if (primary.parentId !== newParentId) {
          await tx.update(objectParents)
            .set({ parentId: newParentId, relationContext: "primary" })
            .where(and(eq(objectParents.id, primary.id), eq(objectParents.tenantId, tenantId)));
        }
      } else {
        const same = await tx
          .select({ id: objectParents.id })
          .from(objectParents)
          .where(and(
            eq(objectParents.objectId, req.params.id),
            eq(objectParents.tenantId, tenantId),
            eq(objectParents.parentId, newParentId),
          ));
        if (same[0]) {
          await tx.update(objectParents).set({ isPrimary: true }).where(and(eq(objectParents.id, same[0].id), eq(objectParents.tenantId, tenantId)));
        } else {
          await tx.insert(objectParents).values({
            tenantId,
            objectId: req.params.id,
            parentId: newParentId,
            isPrimary: true,
            relationContext: "primary",
          });
        }
      }
    });
    object = (await storage.getObject(req.params.id)) ?? object;
  }

  // Task #1165: spårbarhet för objektets driftstatus. När status ändras skriver vi
  // en audit-rad (aktör + tidpunkt) via befintligt audit_logs-mönster. Best-effort:
  // ett fel i loggningen får aldrig fälla själva statusuppdateringen.
  if ("status" in updateData && updateData.status !== existing!.status) {
    try {
      await storage.createAuditLog({
        tenantId,
        userId: (req as any).user?.claims?.sub ?? null,
        action: "object.status_change",
        resourceType: "object",
        resourceId: req.params.id,
        changes: { from: existing!.status ?? null, to: (updateData.status as string) ?? null },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
      });
    } catch (e) {
      console.warn("[audit] object.status_change kunde inte skrivas", e);
    }
  }

  const addressChanged = "address" in updateData && updateData.address !== existing!.address;
  const coordsExplicitlyProvided = "latitude" in updateData || "longitude" in updateData;
  if (addressChanged && !coordsExplicitlyProvided && object.address) {
    triggerGeocodeIfMissing(object.id, { force: true });
  } else if (object.address && (object.latitude == null || object.longitude == null)) {
    triggerGeocodeIfMissing(object.id);
  }

  res.json(object);
}));

// Task #1165: senaste driftstatus-ändring för ett objekt (aktör + tidpunkt).
// Används av objekt-huvudet för att visa "Senast ändrad av X <datum>" nära
// status-väljaren. Tenant-scopad via getAuditLogs.
app.get("/api/objects/:id/status-history", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  // Task #1172: full livscykel-historik (statusändringar + arkivering/
  // återställning) för objekt-huvudets utfällbara vy. Bakåtkompatibelt:
  // `latest` (senaste statusändringen) behålls för "Senast ändrad av"-etiketten.
  const LIFECYCLE_ACTIONS = new Set([
    "object.status_change",
    "object.archive",
    "object.restore",
  ]);
  const logs = await storage.getAuditLogs(tenantId, {
    resourceType: "object",
    resourceId: req.params.id,
    limit: 200,
  });
  const lifecycleLogs = logs.filter((l) => LIFECYCLE_ACTIONS.has(l.action));

  // Lös aktörsnamn via en Map (undvik N+1 mot users).
  const actorIds = Array.from(
    new Set(lifecycleLogs.map((l) => l.userId).filter((v): v is string => !!v)),
  );
  const nameById = new Map<string, string | null>();
  await Promise.all(
    actorIds.map(async (uid) => {
      const user = await storage.getUser(uid);
      if (user) {
        nameById.set(
          uid,
          [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || null,
        );
      }
    }),
  );
  const resolveActor = (userId: string | null): string | null =>
    userId ? nameById.get(userId) ?? null : null;

  const entries = lifecycleLogs.map((l) => ({
    id: l.id,
    action: l.action,
    changedAt: l.createdAt,
    actorName: resolveActor(l.userId),
    changes: (l.changes as Record<string, unknown> | null) ?? null,
  }));

  const latestStatus = lifecycleLogs.find((l) => l.action === "object.status_change");
  res.json({
    latest: latestStatus
      ? {
          changedAt: latestStatus.createdAt,
          actorName: resolveActor(latestStatus.userId),
          changes: (latestStatus.changes as Record<string, unknown> | null) ?? null,
        }
      : null,
    entries,
  });
}));

app.put("/api/objects/:id/verify", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  if (!existing!.isInterimObject) {
    throw new ValidationError("Objektet är inte ett rapporterat objekt");
  }
  const object = await storage.updateObject(req.params.id, { isInterimObject: false });
  res.json(object);
}));

app.put("/api/objects/:id/reject", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  if (!existing!.isInterimObject) {
    throw new ValidationError("Objektet är inte ett rapporterat objekt");
  }
  const object = await storage.updateObject(req.params.id, { deletedAt: new Date(), status: "rejected" });
  res.json(object);
}));

// Raderingsregeln (Etapp 5, Task #1217): hård preflight — objekt raderas
// (hard delete) ENDAST om helt oanvänt (inga uppgifter, ingen historik,
// inga barn, inga abonnemang). Annars 409 med hänvisning till arkivering
// (POST /api/objects/:id/archive).
// Task #1428: massradering som EN batch-operation. Samma raderingsregler som
// enkelradering, men batchad preflight, topologisk ordning (barn före
// föräldrar inom urvalet) och per-objekt-resultat med läsbar orsak.
app.post("/api/objects/bulk-delete", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).filter((v): v is string => typeof v === "string" && v.length > 0)
    : null;
  if (!ids || ids.length === 0) {
    throw new ValidationError("ids måste vara en icke-tom lista med objekt-id");
  }
  if (ids.length > 1000) {
    throw new ValidationError("Max 1000 objekt per massradering");
  }
  const { bulkDeleteObjects } = await import("../services/object-archive");
  const result = await bulkDeleteObjects(ids, tenantId);
  res.json(result);
}));

app.delete("/api/objects/:id", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(existing, tenantId)) {
    throw new NotFoundError("Objekt");
  }
  const { deleteObjectPreflight, hardDeleteUnusedObject } = await import("../services/object-archive");
  const preflight = await deleteObjectPreflight(req.params.id, tenantId);
  if (preflight.blockers.length > 0) {
    throw new ConflictError(
      `Objektet kan inte raderas — det används av ${preflight.blockers.join(", ")}. Arkivera objektet istället.`,
      { code: "delete_blocked", preflight },
    );
  }
  try {
    await hardDeleteUnusedObject(req.params.id, tenantId);
  } catch (err: any) {
    // FK-konflikt från kringdata som inte täcks av preflight → hänvisa till arkivering.
    if (err?.code === "23503" || err?.cause?.code === "23503") {
      throw new ConflictError(
        "Objektet kan inte raderas — det refereras av annan data. Arkivera objektet istället.",
        { code: "delete_blocked" },
      );
    }
    throw err;
  }
  res.status(204).send();
}));

// ============================================
// ADR v3 §2.3 (Task #556): Fakturamottagare per kund
// ============================================

const invoiceRecipientPatchSchema = insertInvoiceRecipientSchema
  .partial()
  .omit({ tenantId: true, customerId: true });

app.get("/api/customers/:id/invoice-recipients", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(customer, tenantId)) throw new NotFoundError("Kund");
  const rows = await storage.getInvoiceRecipients(tenantId, req.params.id);
  res.json(rows);
}));

app.post("/api/customers/:id/invoice-recipients", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(customer, tenantId)) throw new NotFoundError("Kund");
  const parsed = insertInvoiceRecipientSchema.safeParse({
    ...req.body,
    tenantId,
    customerId: req.params.id,
  });
  if (!parsed.success) throw parsed.error;
  if (!INVOICE_RECIPIENT_LEVELS.includes(parsed.data.level as InvoiceRecipientLevel)) {
    throw new ValidationError(`Ogiltig nivå (måste vara en av ${INVOICE_RECIPIENT_LEVELS.join(", ")})`);
  }
  const row = await storage.createInvoiceRecipient(parsed.data);
  res.status(201).json(row);
}));

app.patch("/api/customers/:id/invoice-recipients/:recipientId", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getInvoiceRecipient(tenantId, req.params.recipientId);
  if (!existing || existing.customerId !== req.params.id) throw new NotFoundError("Fakturamottagare");
  const parsed = invoiceRecipientPatchSchema.safeParse(req.body);
  if (!parsed.success) throw parsed.error;
  if (parsed.data.level && !INVOICE_RECIPIENT_LEVELS.includes(parsed.data.level as InvoiceRecipientLevel)) {
    throw new ValidationError(`Ogiltig nivå`);
  }
  const updated = await storage.updateInvoiceRecipient(tenantId, req.params.recipientId, parsed.data);
  res.json(updated);
}));

app.delete("/api/customers/:id/invoice-recipients/:recipientId", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const existing = await storage.getInvoiceRecipient(tenantId, req.params.recipientId);
  if (!existing || existing.customerId !== req.params.id) throw new NotFoundError("Fakturamottagare");
  await storage.deleteInvoiceRecipient(tenantId, req.params.recipientId);
  res.status(204).send();
}));

app.get("/api/customers/:id/resolved-invoice-recipient", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customer = await storage.getCustomer(req.params.id);
  if (!verifyTenantOwnership(customer, tenantId)) throw new NotFoundError("Kund");
  const hintLevel = typeof req.query.hintLevel === "string" ? req.query.hintLevel as InvoiceRecipientLevel : null;
  const resolved = await storage.resolveInvoiceRecipient(tenantId, req.params.id, { hintLevel });
  res.json(resolved);
}));

app.get("/api/objects/:id/resolved-invoice-recipient", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const obj = await storage.getObject(req.params.id);
  if (!verifyTenantOwnership(obj, tenantId)) throw new NotFoundError("Objekt");
  if (!obj!.customerId) {
    return res.json({ recipient: null, sourceCustomerId: null, sourceLevel: null, conflicts: [], hintConflict: false, hasConflict: false, chain: [] });
  }
  const hintLevel = typeof req.query.hintLevel === "string" ? req.query.hintLevel as InvoiceRecipientLevel : null;
  const resolved = await storage.resolveInvoiceRecipient(tenantId, obj!.customerId, { hintLevel });
  res.json(resolved);
}));

}
