// Onboarding-wizard endpoints — Task #514
// Komplett första-uppsättning av tenant: artiklar, prislistor, fordon, team,
// leveranspreferenser. CSV-import + Fortnox-pull där det går. Admin/owner-only.
import type { Express } from "express";
import multer from "multer";
import Papa from "papaparse";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, inArray } from "drizzle-orm";
import {
  articles,
  priceLists,
  vehicles,
  teams,
  customers,
  resources,
  deliveryPreferencesSchema,
  type InsertArticle,
  type InsertPriceList,
  type InsertVehicle,
  type InsertTeam,
  fortnoxConfig,
  insertArticleSchema,
  insertPriceListSchema,
  insertVehicleSchema,
  insertTeamSchema,
} from "@shared/schema";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { ValidationError, NotFoundError } from "../errors";
import { createFortnoxClient } from "../fortnox-client";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ---------- Helpers ----------

function parseCsvBuffer(buf: Buffer): Record<string, string>[] {
  // Stödjer både komma och semikolon (Excel sv-SE exporterar semikolon).
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
    {
      key: "company",
      label: "Företagsinformation",
      done: !!(tenant?.name && tenant?.orgNumber && tenant?.contactEmail),
      count: tenant?.name ? 1 : 0,
    },
    { key: "articles", label: "Artiklar", done: articleRows.length > 0, count: articleRows.length },
    { key: "price_lists", label: "Prislistor", done: priceListRows.length > 0, count: priceListRows.length },
    { key: "vehicles", label: "Fordon", done: vehicleRows.length > 0, count: vehicleRows.length },
    { key: "resources", label: "Resurser (personal)", done: resourceRows.length > 0, count: resourceRows.length },
    { key: "teams", label: "Team", done: teamRows.length > 0, count: teamRows.length },
    { key: "customers", label: "Kunder", done: customerRows.length > 0, count: customerRows.length },
    { key: "delivery_preferences", label: "Leveranspreferenser", done: customersWithPrefs > 0, count: customersWithPrefs },
  ];

  const completed = steps.filter((s) => s.done).length;
  return { steps, completed, total: steps.length };
}

// ---------- Routes ----------

export async function registerOnboardingRoutes(app: Express) {
  // === Status ===
  app.get("/api/onboarding/status", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const result = await getOnboardingStatus(tenantId);
    res.json(result);
  }));

  // === Artiklar — CSV-import ===
  app.post(
    "/api/onboarding/import/articles",
    requireAdmin,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new ValidationError("Ingen fil uppladdad");
      const tenantId = getTenantIdWithFallback(req);
      const rows = parseCsvBuffer(req.file.buffer);
      const imported: string[] = [];
      const errors: { row: number; message: string }[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const articleNumber = pick(row, "articlenumber", "artikelnummer", "artnr", "nr");
          const name = pick(row, "name", "namn", "benämning");
          if (!articleNumber || !name) {
            errors.push({ row: i + 2, message: "Saknar artikelnummer eller namn" });
            continue;
          }
          const data = insertArticleSchema.parse({
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
          });
          await storage.createArticle(data);
          imported.push(articleNumber);
        } catch (err: any) {
          errors.push({ row: i + 2, message: err?.message || "Okänt fel" });
        }
      }
      res.json({ imported: imported.length, total: rows.length, errors });
    }),
  );

  // === Prislistor — CSV-import (en rad = en prislista) ===
  app.post(
    "/api/onboarding/import/price-lists",
    requireAdmin,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new ValidationError("Ingen fil uppladdad");
      const tenantId = getTenantIdWithFallback(req);
      const rows = parseCsvBuffer(req.file.buffer);
      const customerList = await storage.getCustomers(tenantId);
      const customerByNumber = new Map(
        customerList.filter((c) => c.customerNumber).map((c) => [c.customerNumber!.toLowerCase(), c.id]),
      );
      const customerByName = new Map(customerList.map((c) => [c.name.toLowerCase(), c.id]));

      const imported: string[] = [];
      const errors: { row: number; message: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const name = pick(row, "name", "namn");
          if (!name) {
            errors.push({ row: i + 2, message: "Saknar namn" });
            continue;
          }
          const type = pick(row, "type", "pricelisttype", "typ") || "generell";
          const custKey = pick(row, "customer", "kund", "customernumber", "kundnummer");
          let customerId: string | null = null;
          if (custKey) {
            customerId =
              customerByNumber.get(custKey.toLowerCase()) ||
              customerByName.get(custKey.toLowerCase()) ||
              null;
            if (!customerId && type !== "generell") {
              errors.push({ row: i + 2, message: `Kunde inte hitta kund "${custKey}"` });
              continue;
            }
          }
          const data = insertPriceListSchema.parse({
            tenantId,
            name,
            priceListType: type,
            customerId,
            discountPercent: pickNum(row, "discount", "rabatt", "discountpercent") ?? null,
            priority: pickNum(row, "priority", "prioritet") ?? 1,
            status: "active",
          });
          await storage.createPriceList(data);
          imported.push(name);
        } catch (err: any) {
          errors.push({ row: i + 2, message: err?.message || "Okänt fel" });
        }
      }
      res.json({ imported: imported.length, total: rows.length, errors });
    }),
  );

  // === Fordon — CSV-import ===
  app.post(
    "/api/onboarding/import/vehicles",
    requireAdmin,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new ValidationError("Ingen fil uppladdad");
      const tenantId = getTenantIdWithFallback(req);
      const rows = parseCsvBuffer(req.file.buffer);
      const imported: string[] = [];
      const errors: { row: number; message: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const registrationNumber = pick(row, "registrationnumber", "regnr", "registreringsnummer");
          const name = pick(row, "name", "namn") || registrationNumber;
          if (!registrationNumber) {
            errors.push({ row: i + 2, message: "Saknar registreringsnummer" });
            continue;
          }
          const data = insertVehicleSchema.parse({
            tenantId,
            registrationNumber,
            name,
            vehicleType: pick(row, "vehicletype", "fordonstyp", "typ") || "bil",
            capacityTons: pickNum(row, "capacitytons", "kapacitet_ton", "ton") ?? null,
            capacityVolume: pickNum(row, "capacityvolume", "volym", "kbm") ?? null,
            costCenter: pick(row, "costcenter", "kostnadsställe") || null,
            status: "active",
          });
          await storage.createVehicle(data);
          imported.push(registrationNumber);
        } catch (err: any) {
          errors.push({ row: i + 2, message: err?.message || "Okänt fel" });
        }
      }
      res.json({ imported: imported.length, total: rows.length, errors });
    }),
  );

  // === Team — CSV-import ===
  app.post(
    "/api/onboarding/import/teams",
    requireAdmin,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new ValidationError("Ingen fil uppladdad");
      const tenantId = getTenantIdWithFallback(req);
      const rows = parseCsvBuffer(req.file.buffer);
      const imported: string[] = [];
      const errors: { row: number; message: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const name = pick(row, "name", "namn", "teamnamn");
          if (!name) {
            errors.push({ row: i + 2, message: "Saknar namn" });
            continue;
          }
          const data = insertTeamSchema.parse({
            tenantId,
            name,
            description: pick(row, "description", "beskrivning") || null,
            color: pick(row, "color", "färg") || "#3B82F6",
            projectCode: pick(row, "projectcode", "projektkod") || null,
            status: "active",
          });
          await storage.createTeam(data);
          imported.push(name);
        } catch (err: any) {
          errors.push({ row: i + 2, message: err?.message || "Okänt fel" });
        }
      }
      res.json({ imported: imported.length, total: rows.length, errors });
    }),
  );

  // === Leveranspreferenser — CSV-import (på kund-nivå) ===
  // Kolumner: customer/kundnummer, weekday (0-6), starttime (HH:MM), endtime (HH:MM), notes, priority
  app.post(
    "/api/onboarding/import/delivery-preferences",
    requireAdmin,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new ValidationError("Ingen fil uppladdad");
      const tenantId = getTenantIdWithFallback(req);
      const rows = parseCsvBuffer(req.file.buffer);
      const customerList = await storage.getCustomers(tenantId);
      const byNumber = new Map(
        customerList.filter((c) => c.customerNumber).map((c) => [c.customerNumber!.toLowerCase(), c]),
      );
      const byName = new Map(customerList.map((c) => [c.name.toLowerCase(), c]));

      // Aggregera windows per kund
      const perCustomer = new Map<string, any>();
      const errors: { row: number; message: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const key = pick(row, "customer", "kund", "customernumber", "kundnummer");
        if (!key) {
          errors.push({ row: i + 2, message: "Saknar kund" });
          continue;
        }
        const cust =
          byNumber.get(key.toLowerCase()) || byName.get(key.toLowerCase());
        if (!cust) {
          errors.push({ row: i + 2, message: `Kund "${key}" hittades inte` });
          continue;
        }
        const weekday = pickNum(row, "weekday", "veckodag");
        const start = pick(row, "starttime", "starttid", "från");
        const end = pick(row, "endtime", "sluttid", "till");
        const notes = pick(row, "notes", "anteckning");
        const priority = pick(row, "priority", "prioritet") === "strict" ? "strict" : "preferred";

        if (!perCustomer.has(cust.id)) {
          perCustomer.set(cust.id, {
            weeklyWindows: [],
            blockedHours: [],
            blockedDates: [],
            notes: "",
            priority,
          });
        }
        const prefs = perCustomer.get(cust.id);
        prefs.priority = priority;
        if (notes && !prefs.notes) prefs.notes = notes.slice(0, 500);
        if (weekday !== undefined && weekday >= 0 && weekday <= 6 && start && end) {
          prefs.weeklyWindows.push({ weekday, start, end });
        }
      }

      // Validera + spara
      let imported = 0;
      for (const [customerId, raw] of Array.from(perCustomer.entries())) {
        const parsed = deliveryPreferencesSchema.safeParse(raw);
        if (!parsed.success) {
          errors.push({ row: 0, message: `Kund ${customerId}: ${parsed.error.errors[0]?.message || "ogiltig"}` });
          continue;
        }
        await storage.updateCustomer(customerId, { deliveryPreferences: parsed.data } as any);
        imported++;
      }
      res.json({ imported, total: perCustomer.size, errors });
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

  // === Fortnox — sync artiklar (skapa eller uppdatera per artikelnummer) ===
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
      const existing = await storage.getArticles(tenantId);
      const existingByNumber = new Map(existing.map((a) => [a.articleNumber, a]));

      let created = 0;
      let updated = 0;
      const errors: { articleNumber: string; message: string }[] = [];
      const updateSchema = insertArticleSchema.partial().omit({ tenantId: true });
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
          const found = existingByNumber.get(articleNumber);
          if (found) {
            const validated = updateSchema.parse(payload);
            await storage.updateArticle(found.id, validated);
            updated++;
          } else {
            const validated = insertArticleSchema.parse({ tenantId, ...payload });
            await storage.createArticle(validated);
            created++;
          }
        } catch (err: any) {
          errors.push({ articleNumber: String(a.ArticleNumber || "?"), message: err?.message || "Okänt fel" });
        }
      }
      res.json({ created, updated, total: list.length, errors });
    }),
  );
}
