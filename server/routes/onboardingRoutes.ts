// Onboarding-wizard endpoints — Task #514
// Komplett första-uppsättning av tenant: artiklar, prislistor, fordon, team,
// leveranspreferenser. CSV-import + Fortnox-pull. Admin/owner-only.
//
// Varje import-batch körs inom db.transaction() — om något oväntat fel
// inträffar rullas hela batchen tillbaka. Per-rad-valideringsfel räknas men
// avbryter inte transaktionen om inte ?strict=true (då rullas hela tillbaka
// om något rad-fel finns). Duplikathantering på naturlig nyckel
// (articleNumber / registrationNumber / namn) styrs av ?mode=update|skip|create_only.
// Default = update. Resultat skrivs som rad i import_batches och audit_logs.
import type { Express, Request } from "express";
import multer from "multer";
import Papa from "papaparse";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import {
  articles,
  priceLists,
  vehicles,
  teams,
  customers,
  resources,
  deliveryPreferencesSchema,
  fortnoxConfig,
  insertArticleSchema,
  insertPriceListSchema,
  insertVehicleSchema,
  insertTeamSchema,
  importBatches,
  auditLogs,
} from "@shared/schema";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { ValidationError } from "../errors";
import { createFortnoxClient } from "../fortnox-client";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ---------- CSV-helpers ----------

function parseCsvBuffer(buf: Buffer): Record<string, string>[] {
  let text = buf.toString("utf-8").replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/)[0] || "";
  const delimiter = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  return (result.data || []).map((row) => {
    const clean: Record<string, string> = {};
    for (const k of Object.keys(row)) clean[k] = (row[k] ?? "").toString().trim();
    return clean;
  });
}

function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k.toLowerCase()];
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

function pickNum(row: Record<string, string>, ...keys: string[]): number | undefined {
  const raw = pick(row, ...keys);
  if (!raw) return undefined;
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return isNaN(n) ? undefined : n;
}

// ---------- Onboarding-status ----------

export async function getOnboardingStatus(tenantId: string) {
  const [
    tenant,
    articleRows,
    priceListRows,
    vehicleRows,
    teamRows,
    customerRows,
    resourceRows,
  ] = await Promise.all([
    storage.getTenant(tenantId),
    db.select({ id: articles.id }).from(articles).where(eq(articles.tenantId, tenantId)),
    db.select({ id: priceLists.id }).from(priceLists).where(eq(priceLists.tenantId, tenantId)),
    db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.tenantId, tenantId)),
    db.select({ id: teams.id }).from(teams).where(eq(teams.tenantId, tenantId)),
    db.select({ id: customers.id, dp: customers.deliveryPreferences })
      .from(customers).where(eq(customers.tenantId, tenantId)),
    db.select({ id: resources.id }).from(resources).where(eq(resources.tenantId, tenantId)),
  ]);

  const customersWithPrefs = customerRows.filter((c) => {
    const raw = c.dp as any;
    if (!raw) return false;
    return Array.isArray(raw.weeklyWindows) && raw.weeklyWindows.length > 0;
  }).length;

  const steps = [
    { key: "company", label: "Företagsinformation", done: !!(tenant?.name && tenant?.orgNumber && tenant?.contactEmail), count: tenant?.name ? 1 : 0 },
    { key: "articles", label: "Artiklar", done: articleRows.length > 0, count: articleRows.length },
    { key: "price_lists", label: "Prislistor", done: priceListRows.length > 0, count: priceListRows.length },
    { key: "vehicles", label: "Fordon", done: vehicleRows.length > 0, count: vehicleRows.length },
    { key: "resources", label: "Resurser (personal)", done: resourceRows.length > 0, count: resourceRows.length },
    { key: "teams", label: "Team", done: teamRows.length > 0, count: teamRows.length },
    { key: "customers", label: "Kunder", done: customerRows.length > 0, count: customerRows.length },
    { key: "delivery_preferences", label: "Leveranspreferenser", done: customersWithPrefs > 0, count: customersWithPrefs },
  ];

  return { steps, completed: steps.filter((s) => s.done).length, total: steps.length };
}

// ---------- Import-batch + audit helper ----------

type DupMode = "update" | "skip" | "create_only";

interface BatchOutcome {
  created: number;
  updated: number;
  skipped: number;
  total: number;
  errors: { row: number; message: string }[];
}

function parseMode(req: Request): DupMode {
  const raw = String((req.query.mode || req.body?.mode || "update")).toLowerCase();
  if (raw === "skip" || raw === "create_only") return raw;
  return "update";
}

function getUserId(req: Request): string | null {
  return ((req as any).user?.claims?.sub as string | undefined) || null;
}

async function recordBatch(opts: {
  tenantId: string;
  userId: string | null;
  batchId: string;
  action: string;
  resourceType: string;
  outcome: BatchOutcome;
  mode: DupMode;
  rolledBack: boolean;
  filename?: string;
}) {
  await db.insert(importBatches).values({
    tenantId: opts.tenantId,
    batchId: opts.batchId,
    totalRows: opts.outcome.total,
    created: opts.outcome.created,
    updated: opts.outcome.updated,
    errors: opts.outcome.errors.length,
    scorecardSummary: {
      skipped: opts.outcome.skipped,
      mode: opts.mode,
      status: opts.rolledBack ? "rolled_back" : "completed",
    } as any,
    metadata: {
      action: opts.action,
      filename: opts.filename || null,
      sampleErrors: opts.outcome.errors.slice(0, 10),
    } as any,
  });
  await db.insert(auditLogs).values({
    tenantId: opts.tenantId,
    userId: opts.userId,
    action: opts.action,
    resourceType: opts.resourceType,
    resourceId: opts.batchId,
    changes: {
      created: opts.outcome.created,
      updated: opts.outcome.updated,
      skipped: opts.outcome.skipped,
      errors: opts.outcome.errors.length,
      rolledBack: opts.rolledBack,
    } as any,
    metadata: { mode: opts.mode, totalRows: opts.outcome.total, filename: opts.filename || null } as any,
  });
}

/**
 * Kör en import-batch inom en db.transaction. Per-rad-valideringsfel räknas i
 * `errors`; om ?strict=true så rullas hela batchen tillbaka vid första felet.
 * Annars rullas bara tillbaka vid oväntade undantag (DB-fel etc).
 */
async function runBatch(
  req: Request,
  opts: { action: string; resourceType: string; filename?: string },
  processor: (tx: any, ctx: { tenantId: string; mode: DupMode }) => Promise<BatchOutcome>,
): Promise<{ batchId: string; outcome: BatchOutcome; rolledBack: boolean }> {
  const tenantId = getTenantIdWithFallback(req);
  const userId = getUserId(req);
  const mode = parseMode(req);
  const strict = String(req.query.strict || req.body?.strict || "").toLowerCase() === "true";
  const batchId = randomUUID();

  let outcome: BatchOutcome = { created: 0, updated: 0, skipped: 0, total: 0, errors: [] };
  let rolledBack = false;

  try {
    outcome = await db.transaction(async (tx) => {
      const r = await processor(tx, { tenantId, mode });
      if (strict && r.errors.length > 0) {
        const err = new Error(`Strict mode: avbryter pga ${r.errors.length} valideringsfel`);
        (err as any)._batchOutcome = r;
        throw err;
      }
      return r;
    });
  } catch (err: any) {
    rolledBack = true;
    if (err?._batchOutcome) outcome = err._batchOutcome;
    await recordBatch({
      tenantId, userId, batchId, action: opts.action,
      resourceType: opts.resourceType, outcome, mode, rolledBack: true,
      filename: opts.filename,
    });
    if (err?._batchOutcome) {
      // Hanterat strict-läge — returnera vanlig respons (HTTP 200) men rolledBack=true
      return { batchId, outcome, rolledBack: true };
    }
    throw err;
  }

  await recordBatch({
    tenantId, userId, batchId, action: opts.action,
    resourceType: opts.resourceType, outcome, mode, rolledBack: false,
    filename: opts.filename,
  });
  return { batchId, outcome, rolledBack };
}

// ---------- Routes ----------

export async function registerOnboardingRoutes(app: Express) {
  // === Status (admin/owner-only) ===
  app.get("/api/onboarding/status", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    res.json(await getOnboardingStatus(tenantId));
  }));

  // === Artiklar — CSV-import ===
  app.post(
    "/api/onboarding/import/articles",
    requireAdmin,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new ValidationError("Ingen fil uppladdad");
      const rows = parseCsvBuffer(req.file.buffer);

      const result = await runBatch(
        req,
        { action: "onboarding.import.articles", resourceType: "articles", filename: req.file.originalname },
        async (tx, { tenantId, mode }) => {
          const outcome: BatchOutcome = { created: 0, updated: 0, skipped: 0, total: rows.length, errors: [] };
          // Förladda existerande artiklar i tenant för naturlig-nyckel-lookup
          const existing = await tx.select().from(articles).where(eq(articles.tenantId, tenantId));
          const byNumber = new Map<string, any>(existing.map((a: any) => [a.articleNumber, a]));

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
              const articleNumber = pick(row, "articlenumber", "artikelnummer", "artnr", "nr");
              const name = pick(row, "name", "namn", "benämning");
              if (!articleNumber || !name) {
                outcome.errors.push({ row: i + 2, message: "Saknar artikelnummer eller namn" });
                continue;
              }
              const payload = {
                tenantId,
                articleNumber,
                name,
                description: pick(row, "description", "beskrivning") || null,
                articleType: pick(row, "articletype", "typ") || "tjanst",
                productionTime: pickNum(row, "productiontime", "produktionstid", "tid") ?? 0,
                cost: Math.round(pickNum(row, "cost", "kostnad") ?? 0),
                listPrice: Math.round(pickNum(row, "listprice", "listpris", "pris") ?? 0),
                unit: pick(row, "unit", "enhet") || "st",
                executionCode: pick(row, "executioncode", "exekveringskod", "kod") || null,
              };
              const validated = insertArticleSchema.parse(payload);
              const found = byNumber.get(articleNumber);
              if (found) {
                if (mode === "skip" || mode === "create_only") {
                  outcome.skipped++;
                  continue;
                }
                const { tenantId: _t, ...updateFields } = validated as any;
                await tx.update(articles).set(updateFields).where(eq(articles.id, found.id));
                outcome.updated++;
              } else {
                const [inserted] = await tx.insert(articles).values(validated).returning();
                byNumber.set(articleNumber, inserted);
                outcome.created++;
              }
            } catch (err: any) {
              outcome.errors.push({ row: i + 2, message: err?.message || "Okänt fel" });
            }
          }
          return outcome;
        },
      );

      res.json({ batchId: result.batchId, rolledBack: result.rolledBack, ...result.outcome });
    }),
  );

  // === Prislistor — CSV-import ===
  app.post(
    "/api/onboarding/import/price-lists",
    requireAdmin,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new ValidationError("Ingen fil uppladdad");
      const rows = parseCsvBuffer(req.file.buffer);

      const result = await runBatch(
        req,
        { action: "onboarding.import.price-lists", resourceType: "price_lists", filename: req.file.originalname },
        async (tx, { tenantId, mode }) => {
          const outcome: BatchOutcome = { created: 0, updated: 0, skipped: 0, total: rows.length, errors: [] };
          const customerList = await tx.select().from(customers).where(eq(customers.tenantId, tenantId));
          const byNumber = new Map(
            customerList.filter((c: any) => c.customerNumber).map((c: any) => [c.customerNumber!.toLowerCase(), c.id]),
          );
          const byName = new Map(customerList.map((c: any) => [c.name.toLowerCase(), c.id]));
          const existing = await tx.select().from(priceLists).where(eq(priceLists.tenantId, tenantId));
          const byPlName = new Map<string, any>(existing.map((p: any) => [p.name.toLowerCase(), p]));

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
              const name = pick(row, "name", "namn");
              if (!name) {
                outcome.errors.push({ row: i + 2, message: "Saknar namn" });
                continue;
              }
              const type = pick(row, "type", "pricelisttype", "typ") || "generell";
              const custKey = pick(row, "customer", "kund", "customernumber", "kundnummer");
              let customerId: string | null = null;
              if (custKey) {
                customerId =
                  (byNumber.get(custKey.toLowerCase()) as string | undefined) ||
                  (byName.get(custKey.toLowerCase()) as string | undefined) ||
                  null;
                if (!customerId && type !== "generell") {
                  outcome.errors.push({ row: i + 2, message: `Kunde inte hitta kund "${custKey}"` });
                  continue;
                }
              }
              const payload = {
                tenantId, name, priceListType: type, customerId,
                discountPercent: pickNum(row, "discount", "rabatt", "discountpercent") ?? null,
                priority: pickNum(row, "priority", "prioritet") ?? 1,
                status: "active",
              };
              const validated = insertPriceListSchema.parse(payload);
              const found = byPlName.get(name.toLowerCase());
              if (found) {
                if (mode === "skip" || mode === "create_only") { outcome.skipped++; continue; }
                const { tenantId: _t, ...updateFields } = validated as any;
                await tx.update(priceLists).set(updateFields).where(eq(priceLists.id, found.id));
                outcome.updated++;
              } else {
                const [inserted] = await tx.insert(priceLists).values(validated).returning();
                byPlName.set(name.toLowerCase(), inserted);
                outcome.created++;
              }
            } catch (err: any) {
              outcome.errors.push({ row: i + 2, message: err?.message || "Okänt fel" });
            }
          }
          return outcome;
        },
      );

      res.json({ batchId: result.batchId, rolledBack: result.rolledBack, ...result.outcome });
    }),
  );

  // === Fordon — CSV-import ===
  app.post(
    "/api/onboarding/import/vehicles",
    requireAdmin,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new ValidationError("Ingen fil uppladdad");
      const rows = parseCsvBuffer(req.file.buffer);

      const result = await runBatch(
        req,
        { action: "onboarding.import.vehicles", resourceType: "vehicles", filename: req.file.originalname },
        async (tx, { tenantId, mode }) => {
          const outcome: BatchOutcome = { created: 0, updated: 0, skipped: 0, total: rows.length, errors: [] };
          const existing = await tx.select().from(vehicles).where(eq(vehicles.tenantId, tenantId));
          const byReg = new Map<string, any>(existing.map((v: any) => [v.registrationNumber.toLowerCase(), v]));

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
              const registrationNumber = pick(row, "registrationnumber", "regnr", "registreringsnummer");
              const name = pick(row, "name", "namn") || registrationNumber;
              if (!registrationNumber) {
                outcome.errors.push({ row: i + 2, message: "Saknar registreringsnummer" });
                continue;
              }
              const payload = {
                tenantId, registrationNumber, name,
                vehicleType: pick(row, "vehicletype", "fordonstyp", "typ") || "bil",
                capacityTons: pickNum(row, "capacitytons", "kapacitet_ton", "ton") ?? null,
                capacityVolume: pickNum(row, "capacityvolume", "volym", "kbm") ?? null,
                costCenter: pick(row, "costcenter", "kostnadsställe") || null,
                status: "active",
              };
              const validated = insertVehicleSchema.parse(payload);
              const found = byReg.get(registrationNumber.toLowerCase());
              if (found) {
                if (mode === "skip" || mode === "create_only") { outcome.skipped++; continue; }
                const { tenantId: _t, ...updateFields } = validated as any;
                await tx.update(vehicles).set(updateFields).where(eq(vehicles.id, found.id));
                outcome.updated++;
              } else {
                const [inserted] = await tx.insert(vehicles).values(validated).returning();
                byReg.set(registrationNumber.toLowerCase(), inserted);
                outcome.created++;
              }
            } catch (err: any) {
              outcome.errors.push({ row: i + 2, message: err?.message || "Okänt fel" });
            }
          }
          return outcome;
        },
      );

      res.json({ batchId: result.batchId, rolledBack: result.rolledBack, ...result.outcome });
    }),
  );

  // === Team — CSV-import ===
  app.post(
    "/api/onboarding/import/teams",
    requireAdmin,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new ValidationError("Ingen fil uppladdad");
      const rows = parseCsvBuffer(req.file.buffer);

      const result = await runBatch(
        req,
        { action: "onboarding.import.teams", resourceType: "teams", filename: req.file.originalname },
        async (tx, { tenantId, mode }) => {
          const outcome: BatchOutcome = { created: 0, updated: 0, skipped: 0, total: rows.length, errors: [] };
          const existing = await tx.select().from(teams).where(eq(teams.tenantId, tenantId));
          const byName = new Map<string, any>(existing.map((t: any) => [t.name.toLowerCase(), t]));

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
              const name = pick(row, "name", "namn", "teamnamn");
              if (!name) {
                outcome.errors.push({ row: i + 2, message: "Saknar namn" });
                continue;
              }
              const payload = {
                tenantId, name,
                description: pick(row, "description", "beskrivning") || null,
                color: pick(row, "color", "färg") || "#3B82F6",
                projectCode: pick(row, "projectcode", "projektkod") || null,
                status: "active",
              };
              const validated = insertTeamSchema.parse(payload);
              const found = byName.get(name.toLowerCase());
              if (found) {
                if (mode === "skip" || mode === "create_only") { outcome.skipped++; continue; }
                const { tenantId: _t, ...updateFields } = validated as any;
                await tx.update(teams).set(updateFields).where(eq(teams.id, found.id));
                outcome.updated++;
              } else {
                const [inserted] = await tx.insert(teams).values(validated).returning();
                byName.set(name.toLowerCase(), inserted);
                outcome.created++;
              }
            } catch (err: any) {
              outcome.errors.push({ row: i + 2, message: err?.message || "Okänt fel" });
            }
          }
          return outcome;
        },
      );

      res.json({ batchId: result.batchId, rolledBack: result.rolledBack, ...result.outcome });
    }),
  );

  // === Leveranspreferenser — CSV-import (på kund-nivå) ===
  app.post(
    "/api/onboarding/import/delivery-preferences",
    requireAdmin,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new ValidationError("Ingen fil uppladdad");
      const rows = parseCsvBuffer(req.file.buffer);

      const result = await runBatch(
        req,
        { action: "onboarding.import.delivery-preferences", resourceType: "customer_delivery_preferences", filename: req.file.originalname },
        async (tx, { tenantId, mode }) => {
          const customerList = await tx.select().from(customers).where(eq(customers.tenantId, tenantId));
          const byNumber = new Map(
            customerList.filter((c: any) => c.customerNumber).map((c: any) => [c.customerNumber!.toLowerCase(), c]),
          );
          const byName = new Map(customerList.map((c: any) => [c.name.toLowerCase(), c]));

          const outcome: BatchOutcome = { created: 0, updated: 0, skipped: 0, total: 0, errors: [] };
          const perCustomer = new Map<string, any>();

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const key = pick(row, "customer", "kund", "customernumber", "kundnummer");
            if (!key) {
              outcome.errors.push({ row: i + 2, message: "Saknar kund" });
              continue;
            }
            const cust: any = byNumber.get(key.toLowerCase()) || byName.get(key.toLowerCase());
            if (!cust) {
              outcome.errors.push({ row: i + 2, message: `Kund "${key}" hittades inte` });
              continue;
            }
            const weekday = pickNum(row, "weekday", "veckodag");
            const start = pick(row, "starttime", "starttid", "från");
            const end = pick(row, "endtime", "sluttid", "till");
            const notes = pick(row, "notes", "anteckning");
            const priority = pick(row, "priority", "prioritet") === "strict" ? "strict" : "preferred";

            if (!perCustomer.has(cust.id)) {
              perCustomer.set(cust.id, { weeklyWindows: [], blockedHours: [], blockedDates: [], notes: "", priority, _existing: cust.deliveryPreferences });
            }
            const prefs = perCustomer.get(cust.id);
            prefs.priority = priority;
            if (notes && !prefs.notes) prefs.notes = notes.slice(0, 500);
            if (weekday !== undefined && weekday >= 0 && weekday <= 6 && start && end) {
              prefs.weeklyWindows.push({ weekday, start, end });
            }
          }

          outcome.total = perCustomer.size;
          for (const [customerId, raw] of Array.from(perCustomer.entries())) {
            const { _existing, ...candidate } = raw;
            const parsed = deliveryPreferencesSchema.safeParse(candidate);
            if (!parsed.success) {
              outcome.errors.push({ row: 0, message: `Kund ${customerId}: ${parsed.error.errors[0]?.message || "ogiltig"}` });
              continue;
            }
            if (_existing && mode === "skip") { outcome.skipped++; continue; }
            if (_existing && mode === "create_only") { outcome.skipped++; continue; }
            await tx.update(customers).set({ deliveryPreferences: parsed.data as any }).where(eq(customers.id, customerId));
            if (_existing) outcome.updated++;
            else outcome.created++;
          }
          return outcome;
        },
      );

      res.json({ batchId: result.batchId, rolledBack: result.rolledBack, ...result.outcome });
    }),
  );

  // === Fortnox — preview artiklar ===
  app.get(
    "/api/onboarding/fortnox/articles/preview",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const [integration] = await db
        .select()
        .from(fortnoxConfig)
        .where(eq(fortnoxConfig.tenantId, tenantId));
      if (!integration || !integration.refreshToken) {
        return res.json({ connected: false, count: 0, sample: [] });
      }
      try {
        const client = createFortnoxClient(tenantId);
        const list = await client.getArticles();
        return res.json({
          connected: true,
          count: list.length,
          sample: list.slice(0, 10).map((a: any) => ({
            articleNumber: a.ArticleNumber,
            description: a.Description,
            salesPrice: a.SalesPrice,
            unit: a.Unit,
          })),
        });
      } catch (err: any) {
        return res.status(502).json({ connected: true, count: 0, sample: [], error: err?.message || "Fortnox-fel" });
      }
    }),
  );

  // === Fortnox — sync artiklar (skapa/uppdatera/skip per articleNumber) ===
  app.post(
    "/api/onboarding/fortnox/articles/sync",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const [integration] = await db
        .select()
        .from(fortnoxConfig)
        .where(eq(fortnoxConfig.tenantId, tenantId));
      if (!integration || !integration.refreshToken) {
        throw new ValidationError("Fortnox är inte anslutet för detta företag");
      }
      const client = createFortnoxClient(tenantId);
      const list = await client.getArticles();

      const result = await runBatch(
        req,
        { action: "onboarding.fortnox.articles.sync", resourceType: "articles", filename: "fortnox" },
        async (tx, { tenantId, mode }) => {
          const outcome: BatchOutcome = { created: 0, updated: 0, skipped: 0, total: list.length, errors: [] };
          const updateSchema = insertArticleSchema.partial().omit({ tenantId: true });
          const existing = await tx.select().from(articles).where(eq(articles.tenantId, tenantId));
          const byNumber = new Map<string, any>(existing.map((a: any) => [a.articleNumber, a]));

          for (const a of list as any[]) {
            try {
              const articleNumber = String(a.ArticleNumber || "").trim();
              if (!articleNumber) continue;
              const payload = {
                articleNumber,
                name: (a.Description || articleNumber).toString().slice(0, 255),
                listPrice: Math.round(Number(a.SalesPrice ?? 0)),
                cost: Math.round(Number(a.PurchasePrice ?? 0)),
                unit: (a.Unit || "st").toString().slice(0, 32),
              };
              const found = byNumber.get(articleNumber);
              if (found) {
                if (mode === "skip" || mode === "create_only") { outcome.skipped++; continue; }
                const validated = updateSchema.parse(payload);
                await tx.update(articles).set(validated).where(eq(articles.id, found.id));
                outcome.updated++;
              } else {
                const validated = insertArticleSchema.parse({ tenantId, ...payload });
                const [inserted] = await tx.insert(articles).values(validated).returning();
                byNumber.set(articleNumber, inserted);
                outcome.created++;
              }
            } catch (err: any) {
              outcome.errors.push({ row: 0, message: `${a.ArticleNumber || "?"}: ${err?.message || "Okänt fel"}` });
            }
          }
          return outcome;
        },
      );

      res.json({ batchId: result.batchId, rolledBack: result.rolledBack, ...result.outcome });
    }),
  );
}
