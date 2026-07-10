import type { Express } from "express";
import { storage } from "../storage";
import { invalidateWorkflowCaches } from "../services/dashboardCache";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, isNotNull, inArray } from "drizzle-orm";
import { primaryPayerCustomerIdSql, objectHasPrimaryCustomerSql, objectPrimaryCustomerInSql, objectHasNoPrimaryCustomerSql, ensurePrimaryPayer } from "../services/object-customer";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { AppError, NotFoundError, ValidationError, ForbiddenError, describeFortnoxMappingConflict } from "../errors";
import multer from "multer";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import { importJobs, notifyImportProgress } from "./helpers";
import { writeSystemMetadataOnObject } from "../metadata-queries";
import { triggerGeocodeIfMissing } from "../services/geocoding";
import { getMapProvider } from "../services/mapProvider";
import { objects, workOrders, customers, workOrderLines, metadataKatalog, fortnoxMappings, customerServiceContracts, importBatches, auditLogs, customerImportMappings, type InsertFortnoxContractSuggestion, type InsertWorkOrder } from "@shared/schema";
import { normalizeAddressKey } from "@shared/address-normalize";
import crypto from "crypto";
import { createMetadata, updateMetadata, getAllMetadataTypes, seedKarlMetadataTypes, KARL_METADATA_DEFINITIONS, buildMetadataTypeLookup, deriveMetadataDotKey } from "../metadata-queries";
import { metadataVarden } from "@shared/schema";
import { restoreEnrichModusBatch } from "../enrich-modus-restore";
import { invalidateAreaSearchCityCache } from "./plannerRoutes";
import { getImportTemplate, IMPORT_TEMPLATES, type ImportTemplateDefinition } from "@shared/import-templates";

async function buildTemplateWorkbook(def: ImportTemplateDefinition): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Traivo";
  wb.created = new Date();

  // Dataflik
  const sheet = wb.addWorksheet(def.sheetName);
  sheet.columns = def.columns.map((c) => {
    const headerLabel = c.label ?? c.name;
    return {
      header: headerLabel,
      key: c.name,
      width: Math.min(Math.max(headerLabel.length + 4, 14), 40),
    };
  });

  // Rubrikrad: obligatoriska kolumner i fet stil + färgad bakgrund (warning)
  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  def.columns.forEach((c, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = c.label ?? c.name;
    cell.font = { bold: true, color: { argb: "FF1B4B6B" } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: c.required ? "FFFDE8B4" : "FFE8F4F8" },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFB9C7D2" } },
      left: { style: "thin", color: { argb: "FFB9C7D2" } },
      bottom: { style: "medium", color: { argb: "FF1B4B6B" } },
      right: { style: "thin", color: { argb: "FFB9C7D2" } },
    };
  });
  sheet.views = [{ state: "frozen", ySplit: 2 }];

  // Exempelrad — visuellt markerad så användaren förstår att ta bort den
  const exampleRow = sheet.addRow(def.columns.map((c) => c.example ?? ""));
  exampleRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { italic: true, color: { argb: "FF6B7C8C" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF5F5F2" },
    };
    cell.alignment = { vertical: "top", wrapText: true };
  });
  // Markör i första kolumnen — gör tydligt att raden ska tas bort
  const firstCell = exampleRow.getCell(1);
  const originalFirst = firstCell.value;
  firstCell.value = `[EXEMPEL – ta bort denna rad] ${originalFirst ?? ""}`.trim();

  // Läs-mig-flik
  const readme = wb.addWorksheet("Läs mig");
  readme.columns = [
    { header: "Kolumn", key: "name", width: 32 },
    { header: "Obligatorisk", key: "required", width: 14 },
    { header: "Beskrivning", key: "description", width: 80 },
    { header: "Exempel", key: "example", width: 40 },
  ];
  // Rubrik
  const introRow = readme.addRow([def.title]);
  introRow.font = { bold: true, size: 14, color: { argb: "FF1B4B6B" } };
  readme.mergeCells(introRow.number, 1, introRow.number, 4);
  const introTextRow = readme.addRow([def.intro]);
  introTextRow.alignment = { wrapText: true, vertical: "top" };
  readme.mergeCells(introTextRow.number, 1, introTextRow.number, 4);
  introTextRow.height = 60;
  readme.addRow([]);
  const note = readme.addRow([
    "Obs: Rader markerade [EXEMPEL ...] i dataflikens första kolumn ska tas bort innan filen laddas upp. Obligatoriska kolumner är markerade med gul rubrikbakgrund.",
  ]);
  note.font = { italic: true, color: { argb: "FF8C6A1B" } };
  readme.mergeCells(note.number, 1, note.number, 4);
  note.alignment = { wrapText: true, vertical: "top" };
  note.height = 40;
  readme.addRow([]);

  // Kolumn-tabellens header
  const tableHeaderRow = readme.addRow(["Kolumn", "Obligatorisk", "Beskrivning", "Exempel"]);
  tableHeaderRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B4B6B" } };
    cell.alignment = { vertical: "middle" };
  });
  for (const c of def.columns) {
    const row = readme.addRow([c.label ?? c.name, c.required ? "Ja" : "Nej", c.description, c.example ?? ""]);
    row.alignment = { wrapText: true, vertical: "top" };
    if (c.required) {
      row.getCell(1).font = { bold: true };
      row.getCell(2).font = { bold: true, color: { argb: "FF8C6A1B" } };
      row.getCell(2).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFDE8B4" },
      };
    }
  }
  readme.views = [{ state: "frozen", ySplit: 6 }];

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req: any, file: any, cb: any) => {
    const name = (file.originalname || "").toLowerCase();
    const isCsv = file.mimetype === 'text/csv' || name.endsWith('.csv');
    const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls') ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel';
    if (isCsv || isXlsx) {
      cb(null, true);
    } else {
      cb(new Error('Endast CSV- eller Excel-filer (xlsx/xls) är tillåtna'));
    }
  }
});

function isXlsxFile(file: Express.Multer.File): boolean {
  const name = (file.originalname || "").toLowerCase();
  return (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    file.mimetype === "application/vnd.ms-excel"
  );
}

function cellValueToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (typeof value === "object") {
    if ("richText" in value) return (value as ExcelJS.CellRichTextValue).richText.map((r) => r.text || "").join("");
    if ("result" in value) return String((value as ExcelJS.CellFormulaValue).result ?? "");
    if ("text" in value) return String((value as ExcelJS.CellHyperlinkValue).text || "");
  }
  return String(value);
}

async function readSheetAOA(buffer: Buffer): Promise<{ sheetName: string | null; aoa: string[][] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return { sheetName: null, aoa: [] };
  const aoa: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const colCount = sheet.columnCount || row.cellCount;
    const rowData: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      rowData.push(cellValueToString(row.getCell(c).value));
    }
    aoa.push(rowData);
  });
  return { sheetName: sheet.name, aoa };
}

// Enhetlig parser för Modus-uppladdningar – stödjer både CSV (semikolon) och XLSX.
// Returnerar { rows, errors } där rows är Record<string,string>[] med tomma celler som "".
async function parseModusUpload(file: Express.Multer.File): Promise<{ rows: Record<string, string>[]; errors: string[] }> {
  if (isXlsxFile(file)) {
    try {
      const { sheetName, aoa } = await readSheetAOA(file.buffer);
      if (!sheetName) return { rows: [], errors: ["Excel-filen saknar blad"] };
      if (aoa.length === 0) return { rows: [], errors: [] };
      const headers = (aoa[0] || []).map((c) => String(c ?? "").trim());
      const out: Record<string, string>[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const row = aoa[i] || [];
        const obj: Record<string, string> = {};
        let hasContent = false;
        for (let j = 0; j < headers.length; j++) {
          const key = headers[j];
          if (!key) continue;
          const val = row[j];
          const str = val == null ? "" : String(val);
          obj[key] = str;
          if (str.trim() !== "") hasContent = true;
        }
        if (hasContent) out.push(obj);
      }
      return { rows: out, errors: [] };
    } catch (err: any) {
      return { rows: [], errors: [`Excel-fel: ${err?.message || String(err)}`] };
    }
  }
  // CSV-fallback
  const csvText = file.buffer.toString("utf-8");
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    delimiter: ";",
  });
  const errors = result.errors.slice(0, 10).map((e) => `${e.type}/${e.code}: ${e.message}`);
  return { rows: result.data || [], errors };
}

const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req: any, file: any, cb: any) => {
    const name = (file.originalname || "").toLowerCase();
    if (
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.mimetype === "application/vnd.ms-excel"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Endast Excel-filer (xlsx/xls) är tillåtna"));
    }
  },
});

async function parseFortnoxXlsx(buffer: Buffer): Promise<Record<string, string>[]> {
  const { aoa } = await readSheetAOA(buffer);
  if (aoa.length === 0) return [];

  // Hitta rubrikraden - den som innehåller "customer_number" eller "name"
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const row = (aoa[i] || []).map((c) => String(c || "").trim().toLowerCase());
    if (row.includes("customer_number") || (row.includes("name") && row.includes("organisation_number"))) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = (aoa[headerRowIdx] || []).map((c) => String(c || "").trim());
  const out: Record<string, string>[] = [];
  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const obj: Record<string, string> = {};
    let hasContent = false;
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      if (!key) continue;
      const val = row[j];
      const str = val == null ? "" : String(val).trim();
      obj[key] = str;
      if (str !== "") hasContent = true;
    }
    if (hasContent) {
      // 1-indexerad faktisk excel-rad (header är på rad headerRowIdx+1)
      obj.__rowNum = String(i + 1);
      out.push(obj);
    }
  }
  return out;
}

function pickField(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v && v.trim() !== "") return v.trim();
  }
  return "";
}

interface FortnoxCustomerRow {
  rowNum: number;
  raw: Record<string, string>;
  name: string;
  customerNumber: string;
  orgNumber: string;
  type: string;
  active: string;
  email: string;
  invoiceEmail: string;
  invoiceAddress: string;
  invoicePostalCode: string;
  invoiceCity: string;
  address: string;
  postalCode: string;
  city: string;
  contactPerson: string;
  phone: string;
  deliveryName: string;
}

function mapFortnoxRow(row: Record<string, string>, rowNum: number): FortnoxCustomerRow {
  const invoiceAddrPart1 = pickField(row, ["invoice_address", "invoice_address1"]);
  const invoiceAddrPart2 = pickField(row, ["invoice_address2"]);
  const invoiceAddress = [invoiceAddrPart1, invoiceAddrPart2].filter(Boolean).join(", ");
  const deliveryAddress = pickField(row, ["delivery_address", "delivery_address1"]);
  const visitAddress = pickField(row, ["visit_address", "visit_address1"]);
  const address = deliveryAddress || visitAddress || invoiceAddrPart1;
  const postalCode =
    pickField(row, ["delivery_zip_code"]) ||
    pickField(row, ["visit_address_zip_code", "visit_zip_code"]) ||
    pickField(row, ["invoice_zip_code"]);
  const city =
    pickField(row, ["delivery_city"]) ||
    pickField(row, ["visit_address_city", "visit_city"]) ||
    pickField(row, ["invoice_city"]);
  const email = pickField(row, ["email"]) || pickField(row, ["email_invoice"]);
  return {
    rowNum,
    raw: row,
    name: pickField(row, ["name"]),
    customerNumber: pickField(row, ["customer_number"]),
    orgNumber: pickField(row, ["organisation_number"]),
    type: pickField(row, ["type"]).toLowerCase(),
    active: pickField(row, ["active"]),
    email,
    invoiceEmail: pickField(row, ["email_invoice"]),
    invoiceAddress,
    invoicePostalCode: pickField(row, ["invoice_zip_code"]),
    invoiceCity: pickField(row, ["invoice_city"]),
    address,
    postalCode,
    city,
    contactPerson: pickField(row, ["your_reference", "our_reference"]),
    phone: pickField(row, ["delivery_phone", "delivery_phone1", "delivery_phone2", "phone1", "phone2", "phone"]) ||
      pickField(row, ["invoice_phone", "invoice_phone1"]),
    deliveryName: pickField(row, ["delivery_name"]),
  };
}

export async function registerImportRoutes(app: Express) {
// Mall-endpoint: GET /api/import/template/:type → returnerar .xlsx-mall för importtypen.
// Single source of truth: kolumndefinitionerna ligger i `shared/import-templates.ts`
// och används både av UI:t (visa förväntade kolumner) och den här genereringen.
app.get("/api/import/template/:type", asyncHandler(async (req, res) => {
  const def = getImportTemplate(req.params.type);
  if (!def) {
    throw new AppError("Okänd importtyp", 404, {
      code: "ERR_NOT_FOUND",
      details: { validTypes: Object.keys(IMPORT_TEMPLATES) },
    });
  }
  const buffer = await buildTemplateWorkbook(def);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${def.fileName}"`);
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.send(buffer);
}));

app.post("/api/import/customers", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }
    
    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    
    if (result.errors.length > 0) {
      throw new ValidationError("CSV-fel", { details: result.errors });
    }
    
    const imported: string[] = [];
    const errors: string[] = [];
    
    for (const row of result.data as Record<string, string>[]) {
      try {
        const tenantId = getTenantIdWithFallback(req);
        const customerData = {
          tenantId,
          name: row.name || row.namn || row.Namn || "",
          customerNumber: row.customerNumber || row.kundnummer || row.Kundnummer || null,
          contactPerson: row.contactPerson || row.kontaktperson || row.Kontaktperson || null,
          email: row.email || row.epost || row.Epost || null,
          phone: row.phone || row.telefon || row.Telefon || null,
          address: row.address || row.adress || row.Adress || null,
          city: row.city || row.stad || row.Stad || null,
          postalCode: row.postalCode || row.postnummer || row.Postnummer || null,
        };
        
        if (!customerData.name) {
          errors.push(`Rad saknar namn`);
          continue;
        }
        
        await storage.createCustomer(customerData);
        imported.push(customerData.name);
      } catch (err) {
        errors.push(`Kunde inte importera: ${row.name || row.namn || "okänd"}`);
      }
    }
    
    res.json({ imported: imported.length, errors });
}));

app.post("/api/import/resources", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }
    
    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    
    if (result.errors.length > 0) {
      throw new ValidationError("CSV-fel", { details: result.errors });
    }
    
    const imported: string[] = [];
    const errors: string[] = [];
    
    for (const row of result.data as Record<string, string>[]) {
      try {
        const tenantId = getTenantIdWithFallback(req);
        const resourceData = {
          tenantId,
          name: row.name || row.namn || row.Namn || "",
          initials: row.initials || row.initialer || row.Initialer || null,
          phone: row.phone || row.telefon || row.Telefon || null,
          email: row.email || row.epost || row.Epost || null,
          homeLocation: row.homeLocation || row.hemort || row.Hemort || null,
          weeklyHours: row.weeklyHours ? parseInt(row.weeklyHours) : (row.timmar ? parseInt(row.timmar) : 40),
          competencies: row.competencies || row.kompetenser ? 
            (row.competencies || row.kompetenser || "").split(",").map((s: string) => s.trim()) : [],
        };
        
        if (!resourceData.name) {
          errors.push(`Rad saknar namn`);
          continue;
        }
        
        await storage.createResource(resourceData);
        imported.push(resourceData.name);
      } catch (err) {
        errors.push(`Kunde inte importera: ${row.name || row.namn || "okänd"}`);
      }
    }
    
    res.json({ imported: imported.length, errors });
}));

app.post("/api/import/objects", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }
    
    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    
    if (result.errors.length > 0) {
      throw new ValidationError("CSV-fel", { details: result.errors });
    }
    
    // First, get all customers to map names to IDs
    const tenantId = getTenantIdWithFallback(req);
    const customers = await storage.getCustomers(tenantId);
    const customerMap = new Map(customers.map(c => [c.name.toLowerCase(), c.id]));
    
    // Track created objects by objectNumber for parent lookups
    const objectNumberMap = new Map<string, string>();
    
    const imported: string[] = [];
    const errors: string[] = [];
    
    // Sort by objectLevel to ensure parents are created first
    const rows = (result.data as Record<string, string>[]).sort((a, b) => {
      const levelA = parseInt(a.objectLevel || a.nivå || a.Nivå || "1");
      const levelB = parseInt(b.objectLevel || b.nivå || b.Nivå || "1");
      return levelA - levelB;
    });
    
    for (const row of rows) {
      try {
        const customerName = row.customer || row.kund || row.Kund || "";
        const customerId = customerMap.get(customerName.toLowerCase());
        
        if (!customerId) {
          errors.push(`Kund "${customerName}" hittades inte för objekt "${row.name || row.namn}"`);
          continue;
        }
        
        const parentNumber = row.parentNumber || row.förälder || row.Förälder || null;
        let parentId = null;
        if (parentNumber) {
          parentId = objectNumberMap.get(parentNumber) || null;
        }
        
        const objectData = {
          tenantId,
          parentId,
          name: row.name || row.namn || row.Namn || "",
          objectNumber: row.objectNumber || row.objektnummer || row.Objektnummer || null,
          objectType: row.objectType || row.typ || row.Typ || "fastighet",
          objectLevel: parseInt(row.objectLevel || row.nivå || row.Nivå || "1"),
          address: row.address || row.adress || row.Adress || null,
          city: row.city || row.stad || row.Stad || null,
          postalCode: row.postalCode || row.postnummer || row.Postnummer || null,
          latitude: row.latitude || row.lat ? parseFloat(row.latitude || row.lat) : null,
          longitude: row.longitude || row.lng || row.lon ? parseFloat(row.longitude || row.lng || row.lon) : null,
        };

        // Etapp 5: åtkomst/kärl skrivs som metadata (systemområdena Åtkomst/Kärl),
        // inte som objektkolumner. Best-effort efter skapandet.
        const metadataWrites: Array<{ namn: string; value: string }> = [];
        const csvAccessType = row.accessType || row.tillgång || row.Tillgång || null;
        const csvAccessCode = row.accessCode || row.portkod || row.Portkod || null;
        const csvKeyNumber = row.keyNumber || row.nyckelnummer || row.Nyckelnummer || null;
        const csvKarl = row.containerCount || row.kärl || null;
        if (csvAccessType) metadataWrites.push({ namn: "Åtkomsttyp", value: String(csvAccessType) });
        if (csvAccessCode) metadataWrites.push({ namn: "Åtkomstkod", value: String(csvAccessCode) });
        if (csvKeyNumber) metadataWrites.push({ namn: "Nyckelnummer", value: String(csvKeyNumber) });
        if (csvKarl && Number.isFinite(parseInt(String(csvKarl)))) metadataWrites.push({ namn: "Antal kärl", value: String(parseInt(String(csvKarl))) });
        
        if (!objectData.name) {
          errors.push(`Rad saknar namn`);
          continue;
        }
        
        const createdObject = await storage.createObject(objectData);
        if (createdObject?.city) invalidateAreaSearchCityCache(tenantId);
        // ADR v3: kund-koppling via primär payer (ej längre objects.customer_id).
        await ensurePrimaryPayer(tenantId, createdObject.id, customerId);

        for (const mw of metadataWrites) {
          try {
            await writeSystemMetadataOnObject(createdObject.id, mw.namn, mw.value, tenantId, "import");
          } catch (metaErr) {
            console.error(`Metadata-skrivning misslyckades (${mw.namn}) för ${createdObject.id}:`, metaErr);
          }
        }

        triggerGeocodeIfMissing(createdObject.id);
        
        if (objectData.objectNumber) {
          objectNumberMap.set(objectData.objectNumber, createdObject.id);
        }
        
        imported.push(objectData.name);
      } catch (err) {
        console.error("Object import error:", err);
        errors.push(`Kunde inte importera: ${row.name || row.namn || "okänd"}`);
      }
    }
    
    res.json({ imported: imported.length, errors });
}));

app.get("/api/tenant", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError("Företag hittades inte");
    }
    res.json(tenant);
}));

app.patch("/api/tenant", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const tenantUpdateSchema = z.object({
      name: z.string().min(1).optional(),
      orgNumber: z.string().optional(),
      contactEmail: z.string().email().optional().or(z.literal("")),
      contactPhone: z.string().optional(),
      industry: z.string().optional(),
    });
    const parseResult = tenantUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw parseResult.error;
    }
    const tenant = await storage.updateTenant(tenantId, parseResult.data);
    if (!tenant) {
      throw new NotFoundError("Företag hittades inte");
    }
    res.json(tenant);
}));

// Tenant settings
app.get("/api/tenant/settings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      throw new NotFoundError("Företag hittades inte");
    }
    res.json({ id: tenant.id, name: tenant.name, settings: tenant.settings || {} });
}));

app.patch("/api/tenant/settings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const settingsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]));
    const parseResult = settingsSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw parseResult.error;
    }
    const tenant = await storage.updateTenantSettings(tenantId, parseResult.data);
    if (!tenant) {
      throw new NotFoundError("Företag hittades inte");
    }
    res.json({ id: tenant.id, name: tenant.name, settings: tenant.settings });
}));

// Export data as CSV
app.get("/api/export/:type", asyncHandler(async (req, res) => {
    const { type } = req.params;
    let data: Record<string, unknown>[] = [];
    let headers: string[] = [];

    const tenantId = getTenantIdWithFallback(req);
    if (type === "customers") {
      const customers = await storage.getCustomers(tenantId);
      headers = ["namn", "kundnummer", "kontaktperson", "epost", "telefon", "adress", "stad", "postnummer"];
      data = customers.map(c => ({
        namn: c.name,
        kundnummer: c.customerNumber || "",
        kontaktperson: c.contactPerson || "",
        epost: c.email || "",
        telefon: c.phone || "",
        adress: c.address || "",
        stad: c.city || "",
        postnummer: c.postalCode || "",
      }));
    } else if (type === "resources") {
      const resources = await storage.getResources(tenantId);
      headers = ["namn", "initialer", "telefon", "epost", "hemort", "timmar", "kompetenser"];
      data = resources.map(r => ({
        namn: r.name,
        initialer: r.initials || "",
        telefon: r.phone || "",
        epost: r.email || "",
        hemort: r.homeLocation || "",
        timmar: r.weeklyHours || 40,
        kompetenser: (r.competencies || []).join(", "),
      }));
    } else if (type === "objects") {
      const objects = await storage.getObjects(tenantId);
      const customers = await storage.getCustomers(tenantId);
      const customerMap = new Map(customers.map(c => [c.id, c.name]));
      
      headers = ["namn", "objektnummer", "typ", "nivå", "kund", "adress", "stad"];
      data = objects.map(o => ({
        namn: o.name,
        objektnummer: o.objectNumber || "",
        typ: o.objectType,
        nivå: o.objectLevel,
        kund: customerMap.get(o.customerId) || "",
        adress: o.address || "",
        stad: o.city || "",
      }));
    } else {
      throw new ValidationError("Okänd exporttyp");
    }

    const csv = [
      headers.join(","),
      ...data.map(row => headers.map(h => `"${(row[h] ?? "").toString().replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${type}_export.csv`);
    res.send("\ufeff" + csv);
}));

app.post("/api/routes/directions", asyncHandler(async (req, res) => {
    const { coordinates } = req.body;
    
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
      throw new ValidationError("At least 2 coordinates required");
    }

    const { osrmRouteMulti, isOSRMEnabled } = await import("../osrm-client");

    if (isOSRMEnabled()) {
      try {
        console.log(`[routing] Trying OSRM segment-by-segment with ${coordinates.length} waypoints`);

        const allCoords: [number, number][] = [];
        let totalDistance = 0;
        let totalDuration = 0;
        let allSuccess = true;

        for (let i = 0; i < coordinates.length - 1; i++) {
          const segCoords = [coordinates[i], coordinates[i + 1]] as [number, number][];
          const segResult = await osrmRouteMulti(segCoords, { overview: "full", geometries: "geojson" });

          if (segResult?.geometry?.coordinates) {
            const segGeoCoords = segResult.geometry.coordinates as [number, number][];

            const startWp = coordinates[i] as [number, number];
            const endWp = coordinates[i + 1] as [number, number];

            if (i === 0) {
              allCoords.push(startWp);
            }
            allCoords.push(...segGeoCoords);
            allCoords.push(endWp);

            totalDistance += segResult.distanceMeters;
            totalDuration += segResult.durationSeconds;
          } else {
            allSuccess = false;
            break;
          }
        }

        if (allSuccess && allCoords.length > 1) {
          console.log(`[routing] OSRM success (${coordinates.length - 1} segments): distance=${Math.round(totalDistance)}m, duration=${Math.round(totalDuration)}s, points=${allCoords.length}`);
          const geojson = {
            type: "FeatureCollection",
            features: [{
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: allCoords,
              },
              properties: {
                distance: totalDistance,
                time: totalDuration,
                source: "osrm",
              },
            }],
          };
          return res.json(geojson);
        }
        console.warn("[routing] OSRM segment routing incomplete, falling back to Geoapify");
      } catch (err) {
        console.warn("[routing] OSRM failed, falling back to Geoapify:", err instanceof Error ? err.message : err);
      }
    }

    const { fetchGeoapifyRouteWithStatus, isGeoapifyRoutingAvailable } = await import("../services/routing");
    if (!isGeoapifyRoutingAvailable()) {
      return res.status(500).json({ error: "Geoapify API-nyckel saknas. Konfigurera den i inställningarna." });
    }

    console.log(`[routing] Requesting Geoapify route with ${coordinates.length} waypoints`);

    const result = await fetchGeoapifyRouteWithStatus(
      (coordinates as [number, number][]).map(([lon, lat]) => ({ lat, lng: lon })),
    );

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error || "Kunde inte beräkna rutten" });
    }

    const data = result.data;
    console.log(`[routing] Got ${data?.features?.length || 0} features, distance: ${data?.features?.[0]?.properties?.distance || 'N/A'}`);
    res.json(data);
}));

app.post("/api/routes/optimize", asyncHandler(async (req, res) => {
    const { jobs, agents, vehicles } = req.body;
    const resolvedAgents = agents || vehicles;

    const { callRoutePlanner } = await import("../services/routing");
    const result = await callRoutePlanner({ jobs, agents: resolvedAgents });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error || "Route optimization failed" });
    }
    res.json(result.data);
}));

app.get("/api/import/progress/:jobId", (req, res) => {
  const { jobId } = req.params;
  const tenantId = getTenantIdWithFallback(req);
  
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  
  const job = importJobs.get(jobId);
  if (!job || job.tenantId !== tenantId) {
    res.write(`data: ${JSON.stringify({ status: "not_found" })}\n\n`);
    res.end();
    return;
  }
  
  job.listeners.add(res);
  notifyImportProgress(jobId);
  
  req.on("close", () => {
    job.listeners.delete(res);
  });
});

app.post("/api/import/modus/validate", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }

    const parsed = await parseModusUpload(req.file);
    if (parsed.errors.length > 0) {
      throw new ValidationError("Filfel", { details: parsed.errors });
    }

    const rows = parsed.rows;
    const totalRows = rows.length;
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    const missingFields: { row: number; fields: string[] }[] = [];
    const duplicateModusIds: { modusId: string; rows: number[] }[] = [];
    const invalidCoordinates: { row: number; lat: string; lng: string }[] = [];
    const warnings: string[] = [];
    const typeStats: Record<string, number> = {};
    let emptyTypeCount = 0;
    let parentWithSpaces = 0;

    const modusIdOccurrences = new Map<string, number[]>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      const missing: string[] = [];
      if (!row["Id"]?.trim()) missing.push("Id");
      if (!row["Namn"]?.trim()) missing.push("Namn");
      if (missing.length > 0) {
        missingFields.push({ row: rowNum, fields: missing });
      }

      const rawModusId = (row["Id"] || "").trim();
      const modusId = rawModusId.replace(/\s/g, "");
      if (modusId) {
        if (!modusIdOccurrences.has(modusId)) {
          modusIdOccurrences.set(modusId, []);
        }
        modusIdOccurrences.get(modusId)!.push(rowNum);
      }

      const typ = (row["Typ"] || "").trim();
      if (typ) {
        typeStats[typ] = (typeStats[typ] || 0) + 1;
      } else {
        emptyTypeCount++;
      }

      const rawParent = (row["Parent"] || "").trim();
      if (rawParent && rawParent !== rawParent.replace(/\s/g, "")) {
        parentWithSpaces++;
      }

      const latStr = (row["Latitud"] || "").trim();
      const lngStr = (row["Longitud"] || "").trim();
      if (latStr || lngStr) {
        const lat = parseFloat(latStr.replace(",", "."));
        const lng = parseFloat(lngStr.replace(",", "."));
        if (latStr && (isNaN(lat) || lat < 55 || lat > 70)) {
          invalidCoordinates.push({ row: rowNum, lat: latStr, lng: lngStr });
        } else if (lngStr && (isNaN(lng) || lng < 10 || lng > 25)) {
          invalidCoordinates.push({ row: rowNum, lat: latStr, lng: lngStr });
        }
      }
    }

    for (const [modusId, rowNums] of modusIdOccurrences) {
      if (rowNums.length > 1) {
        duplicateModusIds.push({ modusId, rows: rowNums });
      }
    }

    const customerNames = new Set<string>();
    for (const row of rows) {
      const kundName = row["Kund"];
      if (kundName) {
        const match = kundName.match(/^(.+?)\s*\(\d+\)$/);
        const cleanName = match ? match[1].trim() : kundName.trim();
        if (cleanName) customerNames.add(cleanName);
      }
    }

    const tenantId = getTenantIdWithFallback(req);
    const existingCustomers = await storage.getCustomers(tenantId);
    const existingCustomerNames = new Set(existingCustomers.map(c => c.name.toLowerCase()));

    const customersExisting: string[] = [];
    const customersNew: string[] = [];
    for (const name of Array.from(customerNames)) {
      if (existingCustomerNames.has(name.toLowerCase())) {
        customersExisting.push(name);
      } else {
        customersNew.push(name);
      }
    }

    const existingObjects = await storage.getObjects(tenantId);
    const existingObjectNumbers = new Set(existingObjects.map(o => o.objectNumber?.toLowerCase()).filter(Boolean));

    let objectsExisting = 0;
    let objectsNew = 0;
    for (const row of rows) {
      const modusId = (row["Id"] || "").trim().replace(/\s/g, "");
      if (modusId) {
        const objNumber = `MODUS-${modusId}`.toLowerCase();
        if (existingObjectNumbers.has(objNumber)) {
          objectsExisting++;
        } else {
          objectsNew++;
        }
      }
    }

    const parentIds = new Set<string>();
    const allIds = new Set<string>();
    for (const row of rows) {
      const id = (row["Id"] || "").trim().replace(/\s/g, "");
      const parent = (row["Parent"] || "").trim().replace(/\s/g, "");
      if (id) allIds.add(id);
      if (parent) parentIds.add(parent);
    }
    const missingParents: string[] = [];
    for (const pid of parentIds) {
      if (!allIds.has(pid)) {
        const existsInDb = existingObjectNumbers.has(`MODUS-${pid}`.toLowerCase());
        if (!existsInDb) {
          missingParents.push(pid);
        }
      }
    }
    if (missingParents.length > 0) {
      warnings.push(`${missingParents.length} föräldra-ID:n refereras men finns varken i CSV:n eller databasen`);
    }
    if (parentWithSpaces > 0) {
      warnings.push(`${parentWithSpaces} föräldra-ID:n innehåller mellanslag (rensas automatiskt vid import)`);
    }
    if (emptyTypeCount > 0) {
      warnings.push(`${emptyTypeCount} objekt saknar typ (importeras som "Område")`);
    }

    const metadataColumns: string[] = [];
    if (rows.length > 0) {
      for (const key of Object.keys(rows[0])) {
        if (key.startsWith("Metadata - ")) {
          metadataColumns.push(key.replace("Metadata - ", "").trim());
        }
      }
    }

    const addressRows: { row: number; name: string; address: string; hasCoords: boolean; issue: string; geocodeStatus?: string }[] = [];
    const requiredFieldRows: { row: number; name: string; missingFields: string[] }[] = [];
    const accessInfoRows: { row: number; name: string; issue: string }[] = [];
    const duplicateRows: { row: number; name: string; modusId: string }[] = [];

    let addressWithCoords = 0;
    let addressWithAddress = 0;
    let addressComplete = 0;
    let geocodedCount = 0;
    let geocodeFailedCount = 0;
    let hasNameCount = 0;
    let hasTypCount = 0;
    let hasIdCount = 0;
    let hasAccessCode = 0;
    let hasKeyNumber = 0;
    let accessRelevantCount = 0;

    const invalidCoordRows = new Set(invalidCoordinates.map(ic => ic.row));
    const duplicateIdSet = new Set<string>();
    for (const dup of duplicateModusIds) {
      duplicateIdSet.add(dup.modusId);
    }

    const rowsNeedingGeocode: { index: number; rowNum: number; address: string; city: string; name: string; id: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const name = (row["Namn"] || "").trim();
      const id = (row["Id"] || "").trim().replace(/\s/g, "");
      const typ = (row["Typ"] || "").trim();
      const address = (row["Adress 1"] || "").trim();
      const city = (row["Ort"] || "").trim();
      const latStr = (row["Latitud"] || "").trim();
      const lngStr = (row["Longitud"] || "").trim();
      const hasLat = latStr.length > 0;
      const hasLng = lngStr.length > 0;
      const hasValidCoords = hasLat && hasLng && !invalidCoordRows.has(rowNum);

      if (hasValidCoords) addressWithCoords++;
      if (address) addressWithAddress++;
      if (hasValidCoords && address) {
        addressComplete++;
      } else if (!hasValidCoords && !address) {
        addressRows.push({ row: rowNum, name: name || id, address: "", hasCoords: false, issue: "Saknar adress och koordinater", geocodeStatus: "missing" });
      } else if (!hasValidCoords && address) {
        rowsNeedingGeocode.push({ index: addressRows.length, rowNum, address, city, name: name || id, id });
        addressRows.push({ row: rowNum, name: name || id, address, hasCoords: false, issue: "Saknar koordinater — geokodas", geocodeStatus: "pending" });
      } else if (!address) {
        addressRows.push({ row: rowNum, name: name || id, address: "", hasCoords: true, issue: "Saknar gatuadress", geocodeStatus: "coords_only" });
      }

      if (name) hasNameCount++;
      if (typ) hasTypCount++;
      if (id) hasIdCount++;
      const missing: string[] = [];
      if (!name) missing.push("Namn");
      if (!id) missing.push("Id");
      if (!typ) missing.push("Typ");
      if (missing.length > 0) {
        requiredFieldRows.push({ row: rowNum, name: name || id || `Rad ${rowNum}`, missingFields: missing });
      }

      const typLower = typ.toLowerCase();
      const needsAccess = typLower.includes("fastighet") || typLower.includes("byggnad") || typLower.includes("rum") || typLower.includes("soprum") || typLower.includes("miljörum");
      if (needsAccess) {
        accessRelevantCount++;
        const nyckelKod = (row["Metadata - Nyckel eller kod"] || "").trim();
        if (nyckelKod) {
          if (nyckelKod.toLowerCase().includes("nyckel")) hasKeyNumber++;
          else hasAccessCode++;
        } else {
          accessInfoRows.push({ row: rowNum, name: name || id, issue: "Saknar accessinfo (nyckel/kod)" });
        }
      }

      if (duplicateIdSet.has(id)) {
        duplicateRows.push({ row: rowNum, name: name || id, modusId: id });
      }
    }

    for (const item of rowsNeedingGeocode) {
      try {
        const fullAddress = item.city ? `${item.address}, ${item.city}, Sverige` : `${item.address}, Sverige`;
        const geoResult = await getMapProvider().geocode(fullAddress, tenantId);
        if (geoResult && geoResult.latitude && geoResult.longitude) {
          geocodedCount++;
          addressRows[item.index].geocodeStatus = "geocoded";
          addressRows[item.index].issue = "Geokodad från adress";
        } else {
          geocodeFailedCount++;
          addressRows[item.index].geocodeStatus = "failed";
          addressRows[item.index].issue = "Kunde inte geokodas";
        }
      } catch {
        geocodeFailedCount++;
        addressRows[item.index].geocodeStatus = "failed";
        addressRows[item.index].issue = "Geokodning misslyckades";
      }
    }
    const geocodeSkipped = 0;

    const addressOk = addressComplete + geocodedCount;
    const addressTotal = totalRows;
    const addressPercent = totalRows > 0 ? Math.round((addressOk / addressTotal) * 100) : 100;

    const requiredOk = totalRows - requiredFieldRows.length;
    const requiredPercent = totalRows > 0 ? Math.round((requiredOk / totalRows) * 100) : 100;

    const accessOk = accessRelevantCount > 0 ? (hasAccessCode + hasKeyNumber) : 0;
    const accessPercent = accessRelevantCount > 0 ? Math.round((accessOk / accessRelevantCount) * 100) : 100;

    const uniqueRowCount = totalRows - duplicateRows.length;
    const duplicatePercent = totalRows > 0 ? Math.round((uniqueRowCount / totalRows) * 100) : 100;

    const overallScore = Math.round((addressPercent + requiredPercent + accessPercent + duplicatePercent) / 4);

    const scorecard = {
      overallScore,
      categories: {
        addresses: {
          label: "Adresser",
          score: addressPercent,
          ok: addressOk,
          total: addressTotal,
          details: { withCoords: addressWithCoords, withAddress: addressWithAddress, complete: addressComplete, geocoded: geocodedCount, geocodeFailed: geocodeFailedCount, geocodeSkipped },
          problemRows: addressRows,
        },
        requiredFields: {
          label: "Obligatoriska fält",
          score: requiredPercent,
          ok: requiredOk,
          total: totalRows,
          details: { hasName: hasNameCount, hasId: hasIdCount, hasType: hasTypCount },
          problemRows: requiredFieldRows,
        },
        accessInfo: {
          label: "Tillgångsinformation",
          score: accessPercent,
          ok: accessOk,
          total: accessRelevantCount,
          details: { withAccessCode: hasAccessCode, withKeyNumber: hasKeyNumber, relevant: accessRelevantCount },
          problemRows: accessInfoRows,
        },
        duplicates: {
          label: "Dubbletter",
          score: duplicatePercent,
          ok: uniqueRowCount,
          total: totalRows,
          details: { uniqueIds: uniqueRowCount, duplicateIds: duplicateRows.length },
          problemRows: duplicateRows,
        },
      },
    };

    res.json({
      totalRows,
      columns,
      missingFields: missingFields.slice(0, 50),
      missingFieldsCount: missingFields.length,
      duplicateModusIds: duplicateModusIds.slice(0, 50),
      duplicateModusIdsCount: duplicateModusIds.length,
      invalidCoordinates: invalidCoordinates.slice(0, 50),
      invalidCoordinatesCount: invalidCoordinates.length,
      customersExisting,
      customersNew,
      objectsExisting,
      objectsNew,
      missingParents: missingParents.slice(0, 20),
      metadataColumns,
      warnings,
      typeStats,
      emptyTypeCount,
      scorecard,
    });
}));

// Modus 2.0 Import - Objects (semicolon-separated)
//
// Bakgrundsjobb: validerar fil + skapar import_batches-raden synkront, returnerar
// 202 + batchId, och fortsätter sedan bearbeta i bakgrunden så stora filer (t.ex.
// Kinabs 29 010 kärl) inte triggar proxy-/lastbalanserare-timeouts. UI pollar
// GET /api/import/batches/:batchId för progress – samma mönster som
// /api/import/modus/objects/enrich/apply (runEnrichApplyJob).
app.post("/api/import/modus/objects", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }

    const parsed = await parseModusUpload(req.file);
    if (parsed.errors.length > 0) {
      throw new ValidationError("Filfel", { details: parsed.errors });
    }

    const tenantId = getTenantIdWithFallback(req);
    const importBatchId = crypto.randomUUID();
    const rows = parsed.rows;
    const totalRows = rows.length;

    let scorecardSummary: Record<string, number> | null = null;
    try {
      if (req.body?.scorecardSummary) {
        scorecardSummary = JSON.parse(req.body.scorecardSummary);
      }
    } catch {}

    let nameOverrides: { objects?: Record<string, string>; customers?: Record<string, string>; metadata?: Record<string, string> } = {};
    try {
      if (req.body?.nameOverrides) {
        nameOverrides = JSON.parse(req.body.nameOverrides);
      }
    } catch {}

    const startedAt = new Date().toISOString();
    const baseMetadata = {
      type: "modus-objects" as const,
      startedBy: (req as any).user?.id || null,
      filename: req.file?.originalname || null,
      startedAt,
    };

    // Skapa import_batches-raden direkt så historik och poll-endpoint kan se
    // körningen som "in_progress" innan vi släpper HTTP-anslutningen.
    await db.insert(importBatches).values({
      tenantId,
      batchId: importBatchId,
      totalRows,
      created: 0,
      updated: 0,
      errors: 0,
      scorecardSummary: scorecardSummary || null,
      metadata: {
        ...baseMetadata,
        status: "in_progress",
        phase: "startar",
        rowsProcessed: 0,
        customersCreated: 0,
        parentsUpdated: 0,
        metadataWritten: 0,
        metadataColumns: [],
        sampleErrors: [],
        skipped: 0,
      },
    });

    // Returnera 202 omedelbart – resten körs i bakgrunden så proxy/lastbalanserare
    // inte timeoutar och användaren slipper hålla fliken öppen för en blockerande request.
    res.status(202).json({
      batchId: importBatchId,
      importBatchId, // bibehåll äldre fältnamn för bakåtkompatibilitet med befintlig UI/typ
      status: "in_progress",
      totalRows,
    });

    // Bakgrundsbearbetning – inga undantag får läcka till Express
    runModusObjectsImportJob({
      tenantId,
      importBatchId,
      rows,
      nameOverrides,
      scorecardSummary,
      baseMetadata,
    }).catch((err) => {
      console.error(`[modus-objects ${importBatchId}] bakgrundsjobb kraschade:`, err);
    });
}));

async function runModusObjectsImportJob(params: {
  tenantId: string;
  importBatchId: string;
  rows: Record<string, string>[];
  nameOverrides: { objects?: Record<string, string>; customers?: Record<string, string>; metadata?: Record<string, string> };
  scorecardSummary: Record<string, number> | null;
  baseMetadata: { type: "modus-objects"; startedBy: string | null; startedAt: string };
}) {
  const { tenantId, importBatchId, rows, nameOverrides, scorecardSummary, baseMetadata } = params;
  const totalRows = rows.length;

  const created: string[] = [];
  const updated: string[] = [];
  const errors: string[] = [];
  const skipped: string[] = [];
  const modusIdMap = new Map<string, string>();
  let rowsProcessed = 0;
  let phase: "startar" | "kunder" | "objekt" | "hierarki" | "metadata" | "klar" = "startar";
  let customersCreated = 0;
  let parentsUpdated = 0;
  let metadataWritten = 0;
  let metadataColumnNames: string[] = [];
  const metadataErrors: string[] = [];

  async function updateBatchProgress(extra: Record<string, any> = {}) {
    const allErrors = [...errors, ...metadataErrors];
    await db.update(importBatches).set({
      created: created.length,
      updated: updated.length,
      errors: allErrors.length,
      metadata: {
        ...baseMetadata,
        status: "in_progress",
        phase,
        rowsProcessed,
        totalRows,
        customersCreated,
        parentsUpdated,
        metadataWritten,
        metadataColumns: metadataColumnNames,
        sampleErrors: allErrors.slice(0, 50),
        skipped: skipped.length,
        ...extra,
      },
    }).where(and(
      eq(importBatches.batchId, importBatchId),
      eq(importBatches.tenantId, tenantId),
    ));
  }

  try {
    // Fas 1: skapa/koppla kunder
    phase = "kunder";
    const customerNames = new Set<string>();
    for (const row of rows) {
      const kundName = row["Kund"];
      if (kundName) {
        const match = kundName.match(/^(.+?)\s*\(\d+\)$/);
        const cleanName = match ? match[1].trim() : kundName.trim();
        if (cleanName) customerNames.add(cleanName);
      }
    }
    await updateBatchProgress();

    const existingCustomers = await storage.getCustomers(tenantId);
    const customerMap = new Map(existingCustomers.map(c => [c.name.toLowerCase(), c.id]));

    for (const name of Array.from(customerNames)) {
      const resolvedName = nameOverrides.customers?.[name] || name;
      const existingId = customerMap.get(resolvedName.toLowerCase());
      if (existingId) {
        customerMap.set(name.toLowerCase(), existingId);
      } else {
        const newCustomer = await storage.createCustomer({
          tenantId,
          name: resolvedName,
          importBatchId,
        });
        customerMap.set(name.toLowerCase(), newCustomer.id);
        customerMap.set(resolvedName.toLowerCase(), newCustomer.id);
        customersCreated++;
      }
    }

    // Fas 2: skapa/uppdatera objekt
    phase = "objekt";
    await updateBatchProgress();

    for (const row of rows) {
      try {
        const modusId = (row["Id"] || "").replace(/\s/g, "");
        const originalName = row["Namn"] || "";
        const name = nameOverrides.objects?.[modusId] || originalName;
        const typ = row["Typ"] || "Område";
        const parent = (row["Parent"] || "").replace(/\s/g, "");
        const kundRaw = row["Kund"] || "";

        if (!originalName || !modusId) {
          skipped.push(`Rad utan namn eller ID`);
          rowsProcessed++;
          continue;
        }

        // Extract customer name
        const kundMatch = kundRaw.match(/^(.+?)\s*\(\d+\)$/);
        const kundName = kundMatch ? kundMatch[1].trim() : kundRaw.trim();
        const customerId = customerMap.get(kundName.toLowerCase());

        if (!customerId) {
          errors.push(`Kund "${kundName}" hittades inte för "${name}"`);
          rowsProcessed++;
          continue;
        }
        
        // Parse coordinates
        let latitude = row["Latitud"] ? parseFloat(row["Latitud"].replace(",", ".")) : null;
        let longitude = row["Longitud"] ? parseFloat(row["Longitud"].replace(",", ".")) : null;
        
        // Validate coordinates (Sweden approximate bounds)
        if (latitude && (latitude < 55 || latitude > 70)) latitude = null;
        if (longitude && (longitude < 10 || longitude > 25)) longitude = null;
        
        // Map object type (matches real Modus export: Område, Fastighet / Byggnad, Miljörum, Miljökärl, Underjordsbehållare)
        let objectType = "omrade";
        const typLower = typ.toLowerCase().trim();
        if (typLower.includes("miljökärl") || typLower === "miljokarl") objectType = "miljokarl";
        else if (typLower.includes("miljörum")) objectType = "rum";
        else if (typLower.includes("underjord")) objectType = "underjord";
        else if (typLower.includes("fastighet") || typLower.includes("byggnad") || typLower.includes("adress")) objectType = "fastighet";
        else if (typLower.includes("rum") || typLower.includes("soprum")) objectType = "rum";
        else if (typLower.includes("kök")) objectType = "kok";
        else if (typLower.includes("matavfall")) objectType = "matafall";
        else if (typLower.includes("återvinning")) objectType = "atervinning";
        else if (typLower.includes("uj") || typLower.includes("hushåll")) objectType = "uj_hushallsavfall";
        else if (typLower.includes("serviceboende") || typLower.includes("boende")) objectType = "serviceboende";
        else if (typLower === "område" || typLower === "omrade" || typLower === "") objectType = "omrade";
        
        // Etapp 5: åtkomst/kärl skrivs som metadata (systemområdena Åtkomst/Kärl).
        let accessType: string | null = null;
        let accessCode: string | null = null;
        let keyNumber: string | null = null;
        const nyckelEllerKod = row["Metadata - Nyckel eller kod"] || "";
        if (nyckelEllerKod) {
          if (nyckelEllerKod.toLowerCase().includes("nyckel")) {
            accessType = "key";
            keyNumber = nyckelEllerKod;
          } else if (/^\d+$/.test(nyckelEllerKod.trim())) {
            accessType = "code";
            accessCode = nyckelEllerKod.trim();
          } else {
            accessType = "code";
            accessCode = nyckelEllerKod;
          }
        }
        
        // Parse container counts
        const antalStr = row["Metadata - Antal"] || "0";
        const containerCount = parseInt(antalStr.replace(/\D/g, "") || "0");
        
        // Parse description for contact info (skrivs som Åtkomstinfo-metadata)
        const beskrivning = row["Beskrivning"] || "";
        let accessInfoText: string | null = null;
        if (beskrivning) {
          const lines = beskrivning.split("\n");
          if (lines.length >= 2) {
            accessInfoText = lines.slice(1, 4).map((l: string) => l?.trim()).filter(Boolean).join(" | ") || null;
          }
        }
        const modusMetadataWrites: Array<{ namn: string; value: string }> = [];
        if (accessType) modusMetadataWrites.push({ namn: "Åtkomsttyp", value: accessType });
        if (accessCode) modusMetadataWrites.push({ namn: "Åtkomstkod", value: accessCode });
        if (keyNumber) modusMetadataWrites.push({ namn: "Nyckelnummer", value: keyNumber });
        if (accessInfoText) modusMetadataWrites.push({ namn: "Åtkomstinfo", value: accessInfoText });
        if (containerCount > 0) modusMetadataWrites.push({ namn: "Antal kärl", value: String(containerCount) });
        
        // Determine object level based on type hierarchy
        let objectLevel = 1; // Område = top level
        if (objectType === "fastighet") objectLevel = 2;
        else if (objectType === "rum" || objectType === "miljokarl" || objectType === "underjord" || 
                 objectType === "kok" || objectType === "matafall" || objectType === "atervinning" ||
                 objectType === "uj_hushallsavfall") objectLevel = 3;
        else if (objectType === "omrade" && parent) objectLevel = 2;
        
        const objectNumber = `MODUS-${modusId}`;

        const hierarchyLevelMap: Record<number, string> = { 1: "omrade", 2: "fastighet", 3: "serviceenhet" };
        const objectFields = {
          parentId: null as string | null,
          name,
          objectNumber,
          objectType,
          objectLevel,
          hierarchyLevel: hierarchyLevelMap[objectLevel] || "serviceenhet",
          address: row["Adress 1"] || row["Adress"] || null,
          city: row["Ort"] || null,
          postalCode: row["Postnummer"] || null,
          latitude,
          longitude,
        };
        
        const existingObject = await storage.getObjectByObjectNumber(tenantId, objectNumber);
        
        if (existingObject) {
          const { parentId: _p, ...updateFields } = objectFields;
          const updatedObject = await storage.updateObject(existingObject.id, {
            ...updateFields,
          });
          if (updatedObject) {
            // ADR v3: kund-koppling via primär payer (ej längre objects.customer_id).
            await ensurePrimaryPayer(tenantId, updatedObject.id, customerId);
            for (const mw of modusMetadataWrites) {
              try {
                await writeSystemMetadataOnObject(updatedObject.id, mw.namn, mw.value, tenantId, "import");
              } catch (metaErr) {
                console.error(`Metadata-skrivning misslyckades (${mw.namn}):`, metaErr);
              }
            }
            modusIdMap.set(modusId, updatedObject.id);
            updated.push(name);
            if (updatedObject.address && (updatedObject.latitude == null || updatedObject.longitude == null)) {
              triggerGeocodeIfMissing(updatedObject.id);
            }
          }
        } else {
          const createdObject = await storage.createObject({
            tenantId,
            ...objectFields,
            importBatchId,
          });
          if (createdObject?.city) invalidateAreaSearchCityCache(tenantId);
          // ADR v3: kund-koppling via primär payer (ej längre objects.customer_id).
          await ensurePrimaryPayer(tenantId, createdObject.id, customerId);
          for (const mw of modusMetadataWrites) {
            try {
              await writeSystemMetadataOnObject(createdObject.id, mw.namn, mw.value, tenantId, "import");
            } catch (metaErr) {
              console.error(`Metadata-skrivning misslyckades (${mw.namn}):`, metaErr);
            }
          }
          modusIdMap.set(modusId, createdObject.id);
          created.push(name);
          triggerGeocodeIfMissing(createdObject.id);
        }
      } catch (err) {
        console.error("Modus object import error:", err);
        errors.push(`Rad ${row["Id"] || "?"}: ${err}`);
      }
      rowsProcessed++;
      // Periodisk progress-uppdatering så UI ser rörelse även för stora filer.
      if (rowsProcessed % 50 === 0) {
        await updateBatchProgress();
      }
    }

    // Fas 3: bygg parent-hierarki
    phase = "hierarki";
    await updateBatchProgress();

    for (const row of rows) {
      const modusId = (row["Id"] || "").replace(/\s/g, "");
      const parentModusId = (row["Parent"] || "").replace(/\s/g, "");

      if (modusId && parentModusId) {
        const objectId = modusIdMap.get(modusId);
        const parentId = modusIdMap.get(parentModusId);

        if (objectId && parentId) {
          await storage.updateObject(objectId, { parentId });
          parentsUpdated++;
        }
      }
    }

    // Fas 4: skriv metadata
    phase = "metadata";
    await updateBatchProgress();

    const metadataTypes = await getAllMetadataTypes(tenantId);
    const metadataTypeMap = buildMetadataTypeLookup(metadataTypes);

    // Detect all "Metadata - *" columns from first row
    const firstRow = rows[0];
    const metadataColumns: { csvColumn: string; metadataName: string }[] = [];
    if (firstRow) {
      for (const key of Object.keys(firstRow)) {
        if (key.startsWith("Metadata - ")) {
          const originalMetadataName = key.replace("Metadata - ", "").trim();
          const metadataName = nameOverrides.metadata?.[originalMetadataName] || originalMetadataName;
          metadataColumns.push({ csvColumn: key, metadataName });
        }
      }
    }
    metadataColumnNames = metadataColumns.map(c => c.metadataName);

    if (metadataColumns.length > 0) {
      let metaRowIdx = 0;
      for (const row of rows) {
        const modusId = (row["Id"] || "").replace(/\s/g, "");
        const objectId = modusId ? modusIdMap.get(modusId) : null;
        if (!objectId) { metaRowIdx++; continue; }

        for (const { csvColumn, metadataName } of metadataColumns) {
          const rawValue = (row[csvColumn] || "").trim();
          if (!rawValue) continue;

          try {
            // Find metadata type by name (case-insensitive match)
            const metaType = metadataTypeMap.get(metadataName.toLowerCase());
            if (!metaType) {
              // Auto-create metadata type if not found
              const [newType] = await db.insert(metadataKatalog).values({
                tenantId,
                namn: metadataName,
                datatyp: 'string',
                arLogisk: true,
                standardArvs: false,
                kategori: 'importerad',
                area: 'importerad',
                beskrivning: `Importerad fran Modus CSV (${csvColumn})`,
                sortOrder: 100,
              }).returning();
              metadataTypeMap.set(metadataName.toLowerCase(), newType);
            }

            await createMetadata({
              tenantId,
              objektId: objectId,
              metadataTypNamn: metadataTypeMap.get(metadataName.toLowerCase())!.namn,
              varde: rawValue,
              skapadAv: 'modus-import',
              metod: 'manuell',
            });
            metadataWritten++;
          } catch (metaErr: any) {
            metadataErrors.push(`Metadata "${metadataName}" for "${row["Namn"] || modusId}": ${metaErr.message}`);
          }
        }
        metaRowIdx++;
        // Periodisk progress under metadatafasen så UI inte verkar fryst för stora filer.
        if (metaRowIdx % 100 === 0) {
          await updateBatchProgress();
        }
      }
    }

    // Fas 5: klar – markera completed och spara slutresultatet i batchens metadata
    phase = "klar";
    const finishedAt = new Date().toISOString();
    const allErrors = [...errors, ...metadataErrors];
    await db.update(importBatches).set({
      created: created.length,
      updated: updated.length,
      errors: allErrors.length,
      metadata: {
        ...baseMetadata,
        status: "completed",
        phase: "klar",
        rowsProcessed,
        totalRows,
        customersCreated,
        parentsUpdated,
        metadataWritten,
        metadataColumns: metadataColumnNames,
        sampleErrors: allErrors.slice(0, 50),
        skipped: skipped.length,
        scorecardCategories: scorecardSummary?.categories || null,
        finishedAt,
        // Färdig responsdata speglas hit så UI kan bygga ModusObjectResult från
        // batchen utan att behöva ytterligare endpoints.
        result: {
          importBatchId,
          imported: created.length + updated.length,
          created: created.length,
          updated: updated.length,
          parentsUpdated,
          customersCreated,
          skipped: skipped.length,
          metadataWritten,
          metadataColumns: metadataColumnNames,
          errors: allErrors.slice(0, 50),
          totalRows,
          scorecardSummary,
        },
      },
    }).where(and(
      eq(importBatches.batchId, importBatchId),
      eq(importBatches.tenantId, tenantId),
    ));
  } catch (err: any) {
    // Markera batchen som failed så UI kan stoppa polling och historiken vet.
    console.error(`[modus-objects ${importBatchId}] bakgrundsjobb misslyckades:`, err);
    try {
      const allErrors = [...errors, ...metadataErrors];
      await db.update(importBatches).set({
        created: created.length,
        updated: updated.length,
        errors: allErrors.length,
        metadata: {
          ...baseMetadata,
          status: "failed",
          phase,
          rowsProcessed,
          totalRows,
          customersCreated,
          parentsUpdated,
          metadataWritten,
          metadataColumns: metadataColumnNames,
          sampleErrors: allErrors.slice(0, 50),
          skipped: skipped.length,
          finishedAt: new Date().toISOString(),
          failureReason: err?.message || String(err),
        },
      }).where(and(
        eq(importBatches.batchId, importBatchId),
        eq(importBatches.tenantId, tenantId),
      ));
    } catch (updateErr) {
      console.error(`[modus-objects ${importBatchId}] kunde inte markera batch som failed:`, updateErr);
    }
    throw err;
  }
}

// Modus 2.0 Import - Tasks (uppgifter)
// Preview/validate tasks CSV before import - returns missing objects/customers and duplicates
app.post("/api/import/modus/tasks/validate", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }
    const parsed = await parseModusUpload(req.file);
    if (parsed.errors.length > 0) {
      throw new ValidationError("Filfel", { details: parsed.errors });
    }
    const tenantId = getTenantIdWithFallback(req);
    const rows = parsed.rows;

    const objects = await storage.getObjects(tenantId);
    // Build lookup map tolerant to both "MODUS-12345" and "12345" formats,
    // since some tenants have objects imported without the MODUS- prefix.
    const objectsByNumber = new Map<string, typeof objects[number]>();
    for (const o of objects) {
      if (!o.objectNumber) continue;
      objectsByNumber.set(o.objectNumber, o);
      if (o.objectNumber.startsWith("MODUS-")) {
        objectsByNumber.set(o.objectNumber.substring(6), o);
      } else {
        objectsByNumber.set(`MODUS-${o.objectNumber}`, o);
      }
    }

    const customers = await storage.getCustomers(tenantId);
    const customerNames = new Set(customers.map(c => c.name.toLowerCase()));
    // Build a map from Modus customer-id (from customerNumber or metadata) to known customer
    const customersByModusId = new Map<string, string>();
    for (const c of customers) {
      if (c.customerNumber) customersByModusId.set(c.customerNumber, c.id);
    }

    // Riktad SQL-dedup: hämta endast work orders som matchar uppgiftsId i denna batch
    // (undviker OOM på stora tenants med 100k+ historiska ordrar).
    const candidateRefs: string[] = [];
    for (const row of rows) {
      const u = (row["Uppgifts Id"] || "").trim();
      if (u) candidateRefs.push(u);
    }
    const matchingWorkOrders = await storage.getWorkOrdersByExternalRefs(tenantId, candidateRefs);
    const existingExternalRefs = new Set<string>();
    for (const wo of matchingWorkOrders) {
      if (wo.modusId) existingExternalRefs.add(String(wo.modusId));
      if (wo.externalReference) existingExternalRefs.add(String(wo.externalReference));
    }

    const missingObjects = new Map<string, number>();
    const missingCustomers = new Map<string, { count: number; modusId?: string; suggestedCustomerId?: string }>();
    const duplicateIds = new Map<string, number>();
    const collisionsWithExisting: string[] = [];
    const seenIds = new Set<string>();
    const teams = new Set<string>();
    const statusCounts: Record<string, number> = {};

    for (const row of rows) {
      const uppgiftsId = (row["Uppgifts Id"] || "").trim();
      if (!uppgiftsId) continue;

      if (seenIds.has(uppgiftsId)) {
        duplicateIds.set(uppgiftsId, (duplicateIds.get(uppgiftsId) || 0) + 1);
      }
      seenIds.add(uppgiftsId);

      if (existingExternalRefs.has(uppgiftsId)) {
        collisionsWithExisting.push(uppgiftsId);
      }

      const objekt = (row["Objekt"] || "").replace(/\s/g, "");
      if (objekt) {
        const objectNumber = `MODUS-${objekt}`;
        if (!objectsByNumber.has(objectNumber)) {
          missingObjects.set(objekt, (missingObjects.get(objekt) || 0) + 1);
        }
      }

      const kundRaw = row["Kund"] || "";
      if (kundRaw) {
        const modusIdMatch = kundRaw.match(/\((\d+)\)\s*$/);
        const modusCustomerId = modusIdMatch ? modusIdMatch[1] : undefined;
        const kundName = kundRaw.replace(/\s*\(\d+\)\s*$/, "").trim();
        if (kundName && !customerNames.has(kundName.toLowerCase())) {
          const existing = missingCustomers.get(kundName);
          const suggestedCustomerId = modusCustomerId ? customersByModusId.get(modusCustomerId) : undefined;
          missingCustomers.set(kundName, {
            count: (existing?.count || 0) + 1,
            modusId: modusCustomerId,
            suggestedCustomerId,
          });
        }
      }

      const team = row["Team"] || "";
      if (team) teams.add(team);

      const status = row["Status"] || "unknown";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    res.json({
      totalRows: rows.length,
      uniqueTaskIds: seenIds.size,
      matchingObjects: rows.length - Array.from(missingObjects.values()).reduce((a, b) => a + b, 0),
      missingObjectIds: Array.from(missingObjects.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100)
        .map(([modusId, count]) => ({ modusId, count })),
      missingObjectsCount: missingObjects.size,
      missingObjectRowsTotal: Array.from(missingObjects.values()).reduce((a, b) => a + b, 0),
      missingCustomers: Array.from(missingCustomers.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 100)
        .map(([name, info]) => ({
          name,
          count: info.count,
          modusId: info.modusId,
          suggestedCustomerId: info.suggestedCustomerId,
        })),
      missingCustomersCount: missingCustomers.size,
      duplicatesInFile: Array.from(duplicateIds.entries()).map(([id, count]) => ({ modusId: id, count: count + 1 })),
      duplicatesInFileCount: duplicateIds.size,
      collisionsWithExisting: Array.from(new Set(collisionsWithExisting)).slice(0, 200),
      collisionsWithExistingCount: new Set(collisionsWithExisting).size,
      teams: Array.from(teams),
      statusCounts,
    });
  }));

app.post("/api/import/modus/tasks", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }

    const parsed = await parseModusUpload(req.file);
    if (parsed.errors.length > 0) {
      throw new ValidationError("Filfel", { details: parsed.errors });
    }

    const tenantId = getTenantIdWithFallback(req);
    const taskBatchId = crypto.randomUUID();
    // mode=skip_existing: hoppa över rader vars Uppgifts Id redan finns som arbetsorder.
    // Användbart vid omimport där bara nya uppgifter ska läggas till.
    const skipExisting = (req.query?.mode === "skip_existing") || (req.body?.mode === "skip_existing");

    let resourceNameOverrides: Record<string, string> = {};
    try {
      if (req.body?.resourceNameOverrides) {
        resourceNameOverrides = JSON.parse(req.body.resourceNameOverrides);
      }
    } catch {}
    // Optional customer overrides: map from Modus customer-id (or Kund-name) to our customer.id
    let customerOverrides: Record<string, string> = {};
    try {
      if (req.body?.customerOverrides) {
        customerOverrides = JSON.parse(req.body.customerOverrides);
      }
    } catch {}
    // Policy for rows where Kund in CSV doesn't match any known customer and no override is provided:
    //   "skip" (default) = skip the row, "object" = fall back to object.customerId
    const unresolvedCustomerPolicy: "object" | "skip" = req.body?.unresolvedCustomerPolicy === "object" ? "object" : "skip";

    // Async-flagga: kör jobbet i bakgrund och returnera 202 + batchId omedelbart.
    // Gör det möjligt att köra stora omimporter utan att HTTP-anslutningen timeoutar.
    const asyncMode = (req.query?.async === "1") || (req.body?.async === "1");
    const taskFilename = req.file?.originalname || null;
    const taskStartedBy = (req as any).user?.id || null;
    if (asyncMode) {
      await db.insert(importBatches).values({
        tenantId,
        batchId: taskBatchId,
        totalRows: parsed.rows.length,
        created: 0,
        updated: 0,
        errors: 0,
        metadata: {
          type: "modus-tasks",
          status: "in_progress",
          phase: "startar",
          rowsProcessed: 0,
          mode: skipExisting ? "skip_existing" : "upsert",
          startedAt: new Date().toISOString(),
          startedBy: taskStartedBy,
          filename: taskFilename,
        },
      });
      res.status(202).json({
        batchId: taskBatchId,
        importBatchId: taskBatchId,
        status: "in_progress",
        totalRows: parsed.rows.length,
      });
      runModusTasksImportJob({
        tenantId,
        taskBatchId,
        rows: parsed.rows,
        skipExisting,
        resourceNameOverrides,
        customerOverrides,
        unresolvedCustomerPolicy,
        filename: taskFilename,
        startedBy: taskStartedBy,
      }).catch((err) => {
        console.error(`[modus-tasks ${taskBatchId}] bakgrundsjobb kraschade:`, err);
      });
      return;
    }

    const objects = await storage.getObjects(tenantId);
    // Tolerant lookup: accept both "MODUS-12345" and plain "12345" object numbers,
    // since some tenants imported objects without the MODUS- prefix.
    const objectMap = new Map<string, typeof objects[number]>();
    for (const o of objects) {
      if (!o.objectNumber) continue;
      objectMap.set(o.objectNumber, o);
      if (o.objectNumber.startsWith("MODUS-")) {
        objectMap.set(o.objectNumber.substring(6), o);
      } else {
        objectMap.set(`MODUS-${o.objectNumber}`, o);
      }
    }
    
    const customers = await storage.getCustomers(tenantId);
    const customerMap = new Map(customers.map(c => [c.name.toLowerCase(), c.id]));
    
    const resources = await storage.getResources(tenantId);
    const resourceMap = new Map(resources.map(r => [r.name.toLowerCase(), r.id]));

    // Riktad SQL-hämtning av befintliga ordrar som kan kollidera med batchen.
    // Tidigare laddades hela work_orders-tabellen för tenanten (OOM-risk på 100k+ ordrar).
    const candidateRefs: string[] = [];
    for (const row of parsed.rows) {
      const u = (row["Uppgifts Id"] || "").trim();
      if (u) candidateRefs.push(u);
    }
    const matchingWorkOrders = await storage.getWorkOrdersByExternalRefs(tenantId, candidateRefs);
    const workOrderByModusId = new Map<string, { id: string }>();
    for (const wo of matchingWorkOrders) {
      if (wo.modusId) workOrderByModusId.set(String(wo.modusId), wo);
      if (wo.externalReference) workOrderByModusId.set(String(wo.externalReference), wo);
    }

    const created: string[] = [];
    const updated: string[] = [];
    const errors: string[] = [];
    const skipped: string[] = [];
    let skippedExistingCount = 0;

    for (const row of parsed.rows) {
      try {
        const uppgiftsId = (row["Uppgifts Id"] || "").trim();
        const objekt = (row["Objekt"] || "").replace(/\s/g, "");
        const kundRaw = row["Kund"] || "";
        let uppgiftsnamn = row["Uppgiftsnamn"] || "";
        const uppgiftstyp = row["Uppgiftstyp"] || "";
        const status = row["Status"] || "draft";
        const varaktighet = row["Varaktighet"] || "60";
        const team = row["Team"] || "";
        const planeradDagOTid = row["Planerad dag o tid"] || "";
        const prislista = row["Prislista"] || "";
        const kostnad = row["Kostnad"] || "0";
        const pris = row["Pris"] || "0";
        const fakturerad = row["Fakturerad"] || "0";
        const resultat = row["Resultat"] || "";
        const jobb = row["Jobb"] || "";
        const bestallning = row["Beställning"] || "";
        const starttid = row["Starttid"] || "";
        const sluttid = row["Sluttid"] || "";
        
        if (!uppgiftsId) continue;
        // Skip-existing-läge: hoppa över rader vars Uppgifts Id redan finns som arbetsorder.
        // Snabbare än full upsert-loop när bara nya uppgifter ska importeras.
        if (skipExisting && workOrderByModusId.has(uppgiftsId)) {
          skippedExistingCount++;
          continue;
        }
        if (!uppgiftsnamn) uppgiftsnamn = `Uppgift ${uppgiftsId}`;

        // Resolve customer: prefer override (by Modus customer-id or name), else object.customerId
        let resolvedCustomerId: string | undefined;
        const kundModusIdMatch = kundRaw.match(/\((\d+)\)\s*$/);
        const kundModusId = kundModusIdMatch ? kundModusIdMatch[1] : undefined;
        const kundName = kundRaw.replace(/\s*\(\d+\)\s*$/, "").trim();
        if (kundModusId && customerOverrides[kundModusId]) {
          resolvedCustomerId = customerOverrides[kundModusId];
        } else if (kundName && customerOverrides[kundName]) {
          resolvedCustomerId = customerOverrides[kundName];
        } else if (kundName && customerMap.has(kundName.toLowerCase())) {
          resolvedCustomerId = customerMap.get(kundName.toLowerCase());
        }
        // Track if CSV referenced a customer that can't be resolved
        const kundReferenced = Boolean(kundRaw);
        const kundUnresolved = kundReferenced && !resolvedCustomerId;

        // Find object by Modus ID
        const objectNumber = `MODUS-${objekt}`;
        const object = objectMap.get(objectNumber);
        if (!object) {
          errors.push(`Objekt ${objekt} hittades inte för uppgift ${uppgiftsId}`);
          continue;
        }
        
        // Find or create resource
        let resourceId = null;
        if (team) {
          const resolvedTeamName = resourceNameOverrides[team] || team;
          resourceId = resourceMap.get(team.toLowerCase()) || resourceMap.get(resolvedTeamName.toLowerCase());
          if (!resourceId) {
            const newResource = await storage.createResource({
              tenantId,
              name: resolvedTeamName,
              initials: resolvedTeamName.substring(0, 3).toUpperCase(),
            });
            resourceId = newResource.id;
            resourceMap.set(team.toLowerCase(), resourceId);
            resourceMap.set(resolvedTeamName.toLowerCase(), resourceId);
          }
        }
        
        // Parse scheduled date
        let scheduledDate = null;
        let scheduledStartTime = null;
        if (planeradDagOTid) {
          const dt = new Date(planeradDagOTid);
          if (!isNaN(dt.getTime())) {
            scheduledDate = dt;
            scheduledStartTime = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
          }
        }
        
        // Map status - legacy status field + Modus orderStatus (swedish values)
        let mappedStatus = "draft";
        let mappedOrderStatus: "skapad" | "planerad_pre" | "planerad_resurs" | "planerad_las" | "utford" | "fakturerad" = "skapad";
        let impossibleReason: string | null = null;
        let completedAt: Date | null = null;
        if (status === "done") {
          mappedStatus = "completed";
          mappedOrderStatus = "utford";
          if (sluttid) {
            const dt = new Date(sluttid);
            if (!isNaN(dt.getTime())) completedAt = dt;
          }
        } else if (status === "in_progress") {
          mappedStatus = "in_progress";
          mappedOrderStatus = "planerad_resurs";
        } else if (status === "not_started" || status === "scheduled") {
          mappedStatus = "scheduled";
          mappedOrderStatus = "skapad";
        } else if (status === "not_feasible") {
          mappedStatus = "cancelled";
          mappedOrderStatus = "skapad";
          impossibleReason = "not_feasible";
        }
        if (fakturerad === "1") {
          mappedOrderStatus = "fakturerad";
        }
        
        // Map task type
        const typLower = uppgiftstyp.toLowerCase();
        let orderType = "hamtning";
        if (typLower.includes("kärltvätt") || typLower.includes("karlttvatt")) orderType = "karlttvatt";
        else if (typLower.includes("rumstvätt") || typLower.includes("rumstvatt")) orderType = "rumstvatt";
        else if (typLower.includes("uj") || typLower.includes("underjord")) orderType = "uj_tvatt";
        else if (typLower.includes("tvätt")) orderType = "karlttvatt";
        
        // Parse monetary values (Swedish comma decimals)
        const parsedKostnad = parseFloat(kostnad.replace(",", ".")) || 0;
        const parsedPris = parseFloat(pris.replace(",", ".")) || 0;
        const parsedVaraktighet = parseFloat(varaktighet.replace(",", ".")) || 60;
        
        if (kundUnresolved && unresolvedCustomerPolicy === "skip") {
          skipped.push(`Uppgift ${uppgiftsId} hoppades över: okänd kund "${kundName}"`);
          continue;
        }

        const workOrderFields: Omit<InsertWorkOrder, "tenantId" | "importBatchId"> = {
          customerId: resolvedCustomerId || object.customerId,
          objectId: object.id,
          resourceId,
          title: uppgiftsnamn,
          description: `Modus ID: ${uppgiftsId}, Typ: ${uppgiftstyp}`,
          orderType,
          priority: "normal",
          status: mappedStatus,
          orderStatus: mappedOrderStatus,
          creationMethod: "import_modus",
          externalReference: uppgiftsId,
          scheduledDate,
          scheduledStartTime,
          estimatedDuration: Math.round(parsedVaraktighet),
          cachedCost: Math.round(parsedKostnad * 100),
          cachedValue: Math.round(parsedPris * 100),
          notes: resultat || null,
          completedAt,
          impossibleReason,
          metadata: { 
            modusId: uppgiftsId, 
            prislista: prislista || undefined, 
            jobb: jobb || undefined,
            bestallning: bestallning || undefined,
            fakturerad: fakturerad === "1",
            starttid: starttid || undefined,
            sluttid: sluttid || undefined,
          },
        };
        
        const existingWo = workOrderByModusId.get(uppgiftsId);

        if (existingWo) {
          await storage.updateWorkOrder(existingWo.id, workOrderFields);
          updated.push(uppgiftsnamn);
        } else {
          const newWo = await storage.createWorkOrder({ tenantId, ...workOrderFields, importBatchId: taskBatchId });
          workOrderByModusId.set(uppgiftsId, newWo);
          created.push(uppgiftsnamn);
        }
      } catch (err) {
        errors.push(`Fel vid import av uppgift: ${err}`);
      }
    }
    
    res.json({ 
      importBatchId: taskBatchId,
      imported: created.length + updated.length,
      created: created.length,
      updated: updated.length,
      skipped: skipped.length,
      skippedDetails: skipped.slice(0, 50),
      skippedExisting: skippedExistingCount,
      mode: skipExisting ? "skip_existing" : "upsert",
      errors: errors.slice(0, 50),
      totalRows: parsed.rows.length,
    });
}));

// Bakgrundsjobb för modus-tasks-import. Identisk logik som synkron-handlern ovan,
// men uppdaterar import_batches-raden istället för att anropa res.json. Används bara
// när /api/import/modus/tasks anropas med ?async=1 (admin-batchimporter).
async function runModusTasksImportJob(params: {
  tenantId: string;
  taskBatchId: string;
  rows: Record<string, string>[];
  skipExisting: boolean;
  resourceNameOverrides: Record<string, string>;
  customerOverrides: Record<string, string>;
  unresolvedCustomerPolicy: "object" | "skip";
  filename?: string | null;
  startedBy?: string | null;
}): Promise<void> {
  const { tenantId, taskBatchId, rows, skipExisting, resourceNameOverrides, customerOverrides, unresolvedCustomerPolicy } = params;
  const filename = params.filename ?? null;
  const startedBy = params.startedBy ?? null;
  const totalRows = rows.length;
  try {
    const objects = await storage.getObjects(tenantId);
    const objectMap = new Map<string, typeof objects[number]>();
    for (const o of objects) {
      if (!o.objectNumber) continue;
      objectMap.set(o.objectNumber, o);
      if (o.objectNumber.startsWith("MODUS-")) objectMap.set(o.objectNumber.substring(6), o);
      else objectMap.set(`MODUS-${o.objectNumber}`, o);
    }
    const customers = await storage.getCustomers(tenantId);
    const customerMap = new Map(customers.map(c => [c.name.toLowerCase(), c.id]));
    const resources = await storage.getResources(tenantId);
    const resourceMap = new Map(resources.map(r => [r.name.toLowerCase(), r.id]));
    const candidateRefs: string[] = [];
    for (const row of rows) {
      const u = (row["Uppgifts Id"] || "").trim();
      if (u) candidateRefs.push(u);
    }
    const matchingWorkOrders = await storage.getWorkOrdersByExternalRefs(tenantId, candidateRefs);
    const workOrderByModusId = new Map<string, { id: string }>();
    for (const wo of matchingWorkOrders) {
      if (wo.modusId) workOrderByModusId.set(String(wo.modusId), wo);
      if (wo.externalReference) workOrderByModusId.set(String(wo.externalReference), wo);
    }

    const created: string[] = [];
    const updated: string[] = [];
    const errors: string[] = [];
    const skipped: string[] = [];
    let skippedExistingCount = 0;
    let processed = 0;

    for (const row of rows) {
      processed++;
      try {
        const uppgiftsId = (row["Uppgifts Id"] || "").trim();
        const objekt = (row["Objekt"] || "").replace(/\s/g, "");
        const kundRaw = row["Kund"] || "";
        let uppgiftsnamn = row["Uppgiftsnamn"] || "";
        const uppgiftstyp = row["Uppgiftstyp"] || "";
        const status = row["Status"] || "draft";
        const varaktighet = row["Varaktighet"] || "60";
        const team = row["Team"] || "";
        const planeradDagOTid = row["Planerad dag o tid"] || "";
        const prislista = row["Prislista"] || "";
        const kostnad = row["Kostnad"] || "0";
        const pris = row["Pris"] || "0";
        const fakturerad = row["Fakturerad"] || "0";
        const resultat = row["Resultat"] || "";
        const jobb = row["Jobb"] || "";
        const bestallning = row["Beställning"] || "";
        const starttid = row["Starttid"] || "";
        const sluttid = row["Sluttid"] || "";
        if (!uppgiftsId) continue;
        if (skipExisting && workOrderByModusId.has(uppgiftsId)) {
          skippedExistingCount++;
          continue;
        }
        if (!uppgiftsnamn) uppgiftsnamn = `Uppgift ${uppgiftsId}`;

        let resolvedCustomerId: string | undefined;
        const kundModusIdMatch = kundRaw.match(/\((\d+)\)\s*$/);
        const kundModusId = kundModusIdMatch ? kundModusIdMatch[1] : undefined;
        const kundName = kundRaw.replace(/\s*\(\d+\)\s*$/, "").trim();
        if (kundModusId && customerOverrides[kundModusId]) resolvedCustomerId = customerOverrides[kundModusId];
        else if (kundName && customerOverrides[kundName]) resolvedCustomerId = customerOverrides[kundName];
        else if (kundName && customerMap.has(kundName.toLowerCase())) resolvedCustomerId = customerMap.get(kundName.toLowerCase());
        const kundReferenced = Boolean(kundRaw);
        const kundUnresolved = kundReferenced && !resolvedCustomerId;

        const objectNumber = `MODUS-${objekt}`;
        const object = objectMap.get(objectNumber);
        if (!object) {
          errors.push(`Objekt ${objekt} hittades inte för uppgift ${uppgiftsId}`);
          continue;
        }

        let resourceId: string | null = null;
        if (team) {
          const resolvedTeamName = resourceNameOverrides[team] || team;
          resourceId = resourceMap.get(team.toLowerCase()) || resourceMap.get(resolvedTeamName.toLowerCase()) || null;
          if (!resourceId) {
            const newResource = await storage.createResource({
              tenantId,
              name: resolvedTeamName,
              initials: resolvedTeamName.substring(0, 3).toUpperCase(),
            });
            resourceId = newResource.id;
            resourceMap.set(team.toLowerCase(), resourceId);
            resourceMap.set(resolvedTeamName.toLowerCase(), resourceId);
          }
        }

        let scheduledDate: Date | null = null;
        let scheduledStartTime: string | null = null;
        if (planeradDagOTid) {
          const dt = new Date(planeradDagOTid);
          if (!isNaN(dt.getTime())) {
            scheduledDate = dt;
            scheduledStartTime = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
          }
        }

        let mappedStatus = "draft";
        let mappedOrderStatus: "skapad" | "planerad_pre" | "planerad_resurs" | "planerad_las" | "utford" | "fakturerad" = "skapad";
        let impossibleReason: string | null = null;
        let completedAt: Date | null = null;
        if (status === "done") {
          mappedStatus = "completed";
          mappedOrderStatus = "utford";
          if (sluttid) {
            const dt = new Date(sluttid);
            if (!isNaN(dt.getTime())) completedAt = dt;
          }
        } else if (status === "in_progress") {
          mappedStatus = "in_progress";
          mappedOrderStatus = "planerad_resurs";
        } else if (status === "not_started" || status === "scheduled") {
          mappedStatus = "scheduled";
          mappedOrderStatus = "skapad";
        } else if (status === "not_feasible") {
          mappedStatus = "cancelled";
          mappedOrderStatus = "skapad";
          impossibleReason = "not_feasible";
        }
        if (fakturerad === "1") mappedOrderStatus = "fakturerad";

        const typLower = uppgiftstyp.toLowerCase();
        let orderType = "hamtning";
        if (typLower.includes("kärltvätt") || typLower.includes("karlttvatt")) orderType = "karlttvatt";
        else if (typLower.includes("rumstvätt") || typLower.includes("rumstvatt")) orderType = "rumstvatt";
        else if (typLower.includes("uj") || typLower.includes("underjord")) orderType = "uj_tvatt";
        else if (typLower.includes("tvätt")) orderType = "karlttvatt";

        const parsedKostnad = parseFloat(kostnad.replace(",", ".")) || 0;
        const parsedPris = parseFloat(pris.replace(",", ".")) || 0;
        const parsedVaraktighet = parseFloat(varaktighet.replace(",", ".")) || 60;

        if (kundUnresolved && unresolvedCustomerPolicy === "skip") {
          skipped.push(`Uppgift ${uppgiftsId} hoppades över: okänd kund "${kundName}"`);
          continue;
        }

        const workOrderFields: Omit<InsertWorkOrder, "tenantId" | "importBatchId"> = {
          customerId: resolvedCustomerId || object.customerId,
          objectId: object.id,
          resourceId,
          title: uppgiftsnamn,
          description: `Modus ID: ${uppgiftsId}, Typ: ${uppgiftstyp}`,
          orderType,
          priority: "normal",
          status: mappedStatus,
          orderStatus: mappedOrderStatus,
          creationMethod: "import_modus",
          externalReference: uppgiftsId,
          scheduledDate,
          scheduledStartTime,
          estimatedDuration: Math.round(parsedVaraktighet),
          cachedCost: Math.round(parsedKostnad * 100),
          cachedValue: Math.round(parsedPris * 100),
          notes: resultat || null,
          completedAt,
          impossibleReason,
          metadata: {
            modusId: uppgiftsId,
            prislista: prislista || undefined,
            jobb: jobb || undefined,
            bestallning: bestallning || undefined,
            fakturerad: fakturerad === "1",
            starttid: starttid || undefined,
            sluttid: sluttid || undefined,
          },
        };

        const existingWo = workOrderByModusId.get(uppgiftsId);
        if (existingWo) {
          await storage.updateWorkOrder(existingWo.id, workOrderFields);
          updated.push(uppgiftsnamn);
        } else {
          const newWo = await storage.createWorkOrder({ tenantId, ...workOrderFields, importBatchId: taskBatchId });
          workOrderByModusId.set(uppgiftsId, newWo);
          created.push(uppgiftsnamn);
        }
      } catch (err) {
        errors.push(`Fel vid import av uppgift: ${err}`);
      }
      // Periodisk progress-uppdatering – var 500:e rad räcker för UI-polling.
      if (processed % 500 === 0) {
        try {
          await db.update(importBatches).set({
            metadata: {
              type: "modus-tasks",
              status: "in_progress",
              phase: "uppgifter",
              rowsProcessed: processed,
              created: created.length,
              updated: updated.length,
              skippedExisting: skippedExistingCount,
              skipped: skipped.length,
              errors: errors.length,
              mode: skipExisting ? "skip_existing" : "upsert",
              filename,
              startedBy,
            },
          }).where(eq(importBatches.batchId, taskBatchId));
        } catch {}
      }
    }

    await db.update(importBatches).set({
      created: created.length,
      updated: updated.length,
      errors: errors.length,
      metadata: {
        type: "modus-tasks",
        status: "completed",
        phase: "klar",
        rowsProcessed: totalRows,
        totalRows,
        imported: created.length + updated.length,
        created: created.length,
        updated: updated.length,
        skipped: skipped.length,
        skippedDetails: skipped.slice(0, 50),
        skippedExisting: skippedExistingCount,
        mode: skipExisting ? "skip_existing" : "upsert",
        errorSamples: errors.slice(0, 50),
        sampleErrors: errors.slice(0, 50),
        completedAt: new Date().toISOString(),
        filename,
        startedBy,
      },
    }).where(eq(importBatches.batchId, taskBatchId));
  } catch (err) {
    console.error(`[modus-tasks ${taskBatchId}] kraschade:`, err);
    try {
      await db.update(importBatches).set({
        errors: 1,
        metadata: {
          type: "modus-tasks",
          status: "failed",
          phase: "fel",
          error: String(err),
          failedAt: new Date().toISOString(),
          filename,
          startedBy,
        },
      }).where(eq(importBatches.batchId, taskBatchId));
    } catch {}
  }
}

// Modus 2.0 Import - Task Events (for setup time analysis)
app.post("/api/import/modus/events", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }

    const parsed = await parseModusUpload(req.file);
    if (parsed.errors.length > 0) {
      throw new ValidationError("Filfel", { details: parsed.errors });
    }

    const tenantId = getTenantIdWithFallback(req);
    const totalEvents = parsed.rows.length;
    // Async-flagga: spara analysen i import_batches och returnera 202 + batchId direkt.
    const asyncMode = (req.query?.async === "1") || (req.body?.async === "1");

    if (asyncMode) {
      const eventsBatchId = crypto.randomUUID();
      const evFilename = req.file?.originalname || null;
      const evStartedBy = (req as any).user?.id || null;
      await db.insert(importBatches).values({
        tenantId,
        batchId: eventsBatchId,
        totalRows: totalEvents,
        created: 0,
        updated: 0,
        errors: 0,
        metadata: {
          type: "modus-events",
          status: "in_progress",
          startedAt: new Date().toISOString(),
          filename: evFilename,
          startedBy: evStartedBy,
        },
      });
      res.status(202).json({
        batchId: eventsBatchId,
        importBatchId: eventsBatchId,
        status: "in_progress",
        totalRows: totalEvents,
      });
      runModusEventsAnalysisJob({ tenantId, eventsBatchId, rows: parsed.rows, filename: evFilename, startedBy: evStartedBy }).catch((err) => {
        console.error(`[modus-events ${eventsBatchId}] bakgrundsjobb kraschade:`, err);
      });
      return;
    }

    const summary = analyseModusEvents(parsed.rows);
    res.json({
      totalEvents,
      uniqueTasks: summary.uniqueTasks,
      calculatedSetupTimes: summary.calculatedSetupTimes,
      averageSetupTime: summary.averageSetupTime,
      setupTimeDistribution: summary.setupTimeDistribution,
    });
}));

// Delad analysfunktion för Modus task_events.
function analyseModusEvents(rows: Record<string, string>[]): {
  uniqueTasks: number;
  calculatedSetupTimes: number;
  averageSetupTime: number;
  setupTimeDistribution: { under5min: number; "5to15min": number; "15to30min": number; over30min: number };
} {
  const eventsByTask = new Map<string, Array<{ type: string; time: Date }>>();
  for (const row of rows) {
    const uppgiftsId = row["Uppgifts Id"];
    const eventTyp = row["Event Typ"];
    const tid = row["Tid"];
    if (!uppgiftsId || !tid) continue;
    const time = new Date(tid);
    if (isNaN(time.getTime())) continue;
    if (!eventsByTask.has(uppgiftsId)) eventsByTask.set(uppgiftsId, []);
    eventsByTask.get(uppgiftsId)!.push({ type: eventTyp, time });
  }
  const setupTimes: Array<{ taskId: string; minutes: number }> = [];
  for (const [taskId, events] of Array.from(eventsByTask)) {
    events.sort((a, b) => a.time.getTime() - b.time.getTime());
    for (let i = 0; i < events.length - 1; i++) {
      if (events[i].type === "in_progress" && events[i + 1].type === "done") {
        const duration = (events[i + 1].time.getTime() - events[i].time.getTime()) / (1000 * 60);
        if (duration > 0 && duration < 240) setupTimes.push({ taskId, minutes: Math.round(duration) });
      }
    }
  }
  return {
    uniqueTasks: eventsByTask.size,
    calculatedSetupTimes: setupTimes.length,
    averageSetupTime: setupTimes.length > 0
      ? Math.round(setupTimes.reduce((sum, s) => sum + s.minutes, 0) / setupTimes.length)
      : 0,
    setupTimeDistribution: {
      under5min: setupTimes.filter(s => s.minutes < 5).length,
      "5to15min": setupTimes.filter(s => s.minutes >= 5 && s.minutes < 15).length,
      "15to30min": setupTimes.filter(s => s.minutes >= 15 && s.minutes < 30).length,
      over30min: setupTimes.filter(s => s.minutes >= 30).length,
    },
  };
}

async function runModusEventsAnalysisJob(params: {
  tenantId: string;
  eventsBatchId: string;
  rows: Record<string, string>[];
  filename?: string | null;
  startedBy?: string | null;
}): Promise<void> {
  const { eventsBatchId, rows } = params;
  const filename = params.filename ?? null;
  const startedBy = params.startedBy ?? null;
  try {
    const summary = analyseModusEvents(rows);
    await db.update(importBatches).set({
      metadata: {
        type: "modus-events",
        status: "completed",
        totalEvents: rows.length,
        ...summary,
        completedAt: new Date().toISOString(),
        filename,
        startedBy,
      },
    }).where(eq(importBatches.batchId, eventsBatchId));
  } catch (err) {
    console.error(`[modus-events ${eventsBatchId}] kraschade:`, err);
    try {
      await db.update(importBatches).set({
        errors: 1,
        metadata: {
          type: "modus-events",
          status: "failed",
          error: String(err),
          failedAt: new Date().toISOString(),
          filename,
          startedBy,
        },
      }).where(eq(importBatches.batchId, eventsBatchId));
    } catch {}
  }
}

// Modus 2.0 Import - Invoice Lines (fakturarader)
app.post("/api/import/modus/invoice-lines", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }

    const parsed = await parseModusUpload(req.file);
    if (parsed.errors.length > 0) {
      throw new ValidationError("Filfel", { details: parsed.errors });
    }

    const tenantId = getTenantIdWithFallback(req);
    const invoiceBatchId = crypto.randomUUID();
    // mode=skip_existing: hoppa över rader vars arbetsorder redan har minst en orderrad.
    // Hindrar att fakturarader dubbleras vid omimport.
    const skipExisting = (req.query?.mode === "skip_existing") || (req.body?.mode === "skip_existing");

    // Async-flagga: kör jobbet i bakgrund och returnera 202 + batchId direkt (admin-batch-flöde).
    const asyncMode = (req.query?.async === "1") || (req.body?.async === "1");
    const invFilename = req.file?.originalname || null;
    const invStartedBy = (req as any).user?.id || null;
    if (asyncMode) {
      await db.insert(importBatches).values({
        tenantId,
        batchId: invoiceBatchId,
        totalRows: parsed.rows.length,
        created: 0,
        updated: 0,
        errors: 0,
        metadata: {
          type: "modus-invoice-lines",
          status: "in_progress",
          phase: "startar",
          rowsProcessed: 0,
          mode: skipExisting ? "skip_existing" : "upsert",
          startedAt: new Date().toISOString(),
          filename: invFilename,
          startedBy: invStartedBy,
        },
      });
      res.status(202).json({
        batchId: invoiceBatchId,
        importBatchId: invoiceBatchId,
        status: "in_progress",
        totalRows: parsed.rows.length,
      });
      runModusInvoiceLinesImportJob({
        tenantId,
        invoiceBatchId,
        rows: parsed.rows,
        skipExisting,
        filename: invFilename,
        startedBy: invStartedBy,
      }).catch((err) => {
        console.error(`[modus-invoice-lines ${invoiceBatchId}] bakgrundsjobb kraschade:`, err);
      });
      return;
    }

    // Riktad SQL-hämtning: bara work orders som matchar Uppgift Id i denna fakturarad-batch.
    const candidateRefs: string[] = [];
    for (const row of parsed.rows) {
      const u = (row["Uppgift Id"] || "").replace(/\s/g, "");
      if (u) candidateRefs.push(u);
    }
    const matchingWorkOrders = await storage.getWorkOrdersByExternalRefs(tenantId, candidateRefs);
    const woByModusId = new Map<string, any>();
    const matchedWoIds: string[] = [];
    for (const wo of matchingWorkOrders) {
      if (wo.modusId) woByModusId.set(String(wo.modusId), wo);
      if (wo.externalReference) woByModusId.set(String(wo.externalReference), wo);
      matchedWoIds.push(wo.id);
    }

    // I skip-existing-läget bygger vi en lookup över vilka arbetsordrar som redan
    // har orderrader i DB – då hoppar vi över hela uppgiften (alla dess rader).
    const woIdsWithExistingLines = new Set<string>();
    if (skipExisting && matchedWoIds.length > 0) {
      const existingLines = await db
        .select({ workOrderId: workOrderLines.workOrderId })
        .from(workOrderLines)
        .where(inArray(workOrderLines.workOrderId, matchedWoIds));
      for (const l of existingLines) {
        if (l.workOrderId) woIdsWithExistingLines.add(l.workOrderId);
      }
    }

    const existingArticles = await storage.getArticles(tenantId);
    const articleByFortnox = new Map<string, any>();
    for (const a of existingArticles) {
      if ((a as any).fortnoxId) {
        articleByFortnox.set((a as any).fortnoxId.toLowerCase(), a);
      }
      if (a.name) {
        articleByFortnox.set(a.name.toLowerCase(), a);
      }
    }

    const created: string[] = [];
    const errors: string[] = [];
    let articlesAutoCreated = 0;
    let skippedExistingCount = 0;
    const affectedWorkOrderIds = new Set<string>();

    for (const row of parsed.rows) {
      try {
        const rawUppgiftId = row["Uppgift Id"];
        const rad = row["Rad"] || "1";
        const beskrivning = row["Beskrivning"] || "";
        const antalStr = row["Antal"] || "0";
        const prisStr = row["Pris"] || "0";
        const fortnoxArtikelId = (row["Fortnox Artikel Id"] || "").trim();
        const fortnoxProjekt = (row["Fortnox Projekt"] || "").trim();
        
        if (!rawUppgiftId) continue;
        const uppgiftId = rawUppgiftId.replace(/\s/g, "");
        
        const workOrder = woByModusId.get(uppgiftId);
        if (!workOrder) {
          errors.push(`Uppgift ${uppgiftId} hittades inte i systemet`);
          continue;
        }
        // Skip-existing-läge: hoppa över hela uppgiften om dess arbetsorder
        // redan har minst en orderrad i DB (annars blir det dubbletter vid omimport).
        if (skipExisting && woIdsWithExistingLines.has(workOrder.id)) {
          skippedExistingCount++;
          continue;
        }

        const antal = Math.round(parseFloat(antalStr.replace(",", ".")) || 0);
        const pris = Math.round(parseFloat(prisStr.replace(",", ".")) * 100) || 0;
        
        let article = fortnoxArtikelId ? articleByFortnox.get(fortnoxArtikelId.toLowerCase()) : null;
        
        if (!article && fortnoxArtikelId) {
          let articleName = fortnoxArtikelId;
          if (fortnoxArtikelId === "K100") articleName = "Kärltvätt Standard";
          else if (fortnoxArtikelId === "UJ100") articleName = "Tvätt UJ-behållare";
          
          article = await storage.createArticle({
            tenantId,
            name: articleName,
            articleNumber: fortnoxArtikelId,
            articleType: "tjanst",
            listPrice: pris,
            objectTypes: [],
          });
          articleByFortnox.set(fortnoxArtikelId.toLowerCase(), article);
          articlesAutoCreated++;
        }
        
        if (!article) {
          errors.push(`Ingen artikel kunde skapas för rad ${uppgiftId}/${rad}`);
          continue;
        }
        
        await storage.createWorkOrderLine({
          tenantId,
          workOrderId: workOrder.id,
          articleId: article.id,
          quantity: antal,
          resolvedPrice: pris,
          resolvedCost: 0,
          resolvedProductionMinutes: 0,
          priceSource: "modus_import",
          notes: beskrivning || null,
        }, { skipRecalc: true });
        affectedWorkOrderIds.add(workOrder.id);
        
        created.push(`${uppgiftId}/${rad}: ${beskrivning.substring(0, 40)}`);
      } catch (err) {
        errors.push(`Fel vid import av fakturarad ${row["Uppgift Id"] || "?"}/${row["Rad"] || "?"}: ${err}`);
      }
    }
    
    // Räkna om cachedValue/cachedCost/cachedProductionMinutes på alla berörda ordrar
    // så orderstock-summan stämmer direkt efter importen.
    const recalcResult = await storage.recalculateWorkOrderTotalsBulk(Array.from(affectedWorkOrderIds));

    res.json({ 
      importBatchId: invoiceBatchId,
      imported: created.length,
      created: created.length,
      articlesAutoCreated,
      skippedExisting: skippedExistingCount,
      mode: skipExisting ? "skip_existing" : "upsert",
      errors: errors.slice(0, 50),
      totalRows: parsed.rows.length,
      ordersRecalculated: recalcResult.recalculated,
      ordersValueChanged: recalcResult.changed,
    });
}));

// Bakgrundsjobb för modus-invoice-lines-import. Identisk logik som synkron-handlern,
// men uppdaterar import_batches istället för res.json. Används bara via ?async=1.
async function runModusInvoiceLinesImportJob(params: {
  tenantId: string;
  invoiceBatchId: string;
  rows: Record<string, string>[];
  skipExisting: boolean;
  filename?: string | null;
  startedBy?: string | null;
}): Promise<void> {
  const { tenantId, invoiceBatchId, rows, skipExisting } = params;
  const filename = params.filename ?? null;
  const startedBy = params.startedBy ?? null;
  const totalRows = rows.length;
  try {
    const candidateRefs: string[] = [];
    for (const row of rows) {
      const u = (row["Uppgift Id"] || "").replace(/\s/g, "");
      if (u) candidateRefs.push(u);
    }
    const matchingWorkOrders = await storage.getWorkOrdersByExternalRefs(tenantId, candidateRefs);
    const woByModusId = new Map<string, any>();
    const matchedWoIds: string[] = [];
    for (const wo of matchingWorkOrders) {
      if (wo.modusId) woByModusId.set(String(wo.modusId), wo);
      if (wo.externalReference) woByModusId.set(String(wo.externalReference), wo);
      matchedWoIds.push(wo.id);
    }
    const woIdsWithExistingLines = new Set<string>();
    if (skipExisting && matchedWoIds.length > 0) {
      const existingLines = await db
        .select({ workOrderId: workOrderLines.workOrderId })
        .from(workOrderLines)
        .where(inArray(workOrderLines.workOrderId, matchedWoIds));
      for (const l of existingLines) {
        if (l.workOrderId) woIdsWithExistingLines.add(l.workOrderId);
      }
    }
    const existingArticles = await storage.getArticles(tenantId);
    const articleByFortnox = new Map<string, any>();
    for (const a of existingArticles) {
      if ((a as any).fortnoxId) articleByFortnox.set((a as any).fortnoxId.toLowerCase(), a);
      if (a.name) articleByFortnox.set(a.name.toLowerCase(), a);
    }

    const created: string[] = [];
    const errors: string[] = [];
    let articlesAutoCreated = 0;
    let skippedExistingCount = 0;
    let processed = 0;
    const affectedWorkOrderIds = new Set<string>();

    for (const row of rows) {
      processed++;
      try {
        const rawUppgiftId = row["Uppgift Id"];
        const rad = row["Rad"] || "1";
        const beskrivning = row["Beskrivning"] || "";
        const antalStr = row["Antal"] || "0";
        const prisStr = row["Pris"] || "0";
        const fortnoxArtikelId = (row["Fortnox Artikel Id"] || "").trim();
        if (!rawUppgiftId) continue;
        const uppgiftId = rawUppgiftId.replace(/\s/g, "");

        const workOrder = woByModusId.get(uppgiftId);
        if (!workOrder) {
          errors.push(`Uppgift ${uppgiftId} hittades inte i systemet`);
          continue;
        }
        if (skipExisting && woIdsWithExistingLines.has(workOrder.id)) {
          skippedExistingCount++;
          continue;
        }

        const antal = Math.round(parseFloat(antalStr.replace(",", ".")) || 0);
        const pris = Math.round(parseFloat(prisStr.replace(",", ".")) * 100) || 0;

        let article = fortnoxArtikelId ? articleByFortnox.get(fortnoxArtikelId.toLowerCase()) : null;
        if (!article && fortnoxArtikelId) {
          let articleName = fortnoxArtikelId;
          if (fortnoxArtikelId === "K100") articleName = "Kärltvätt Standard";
          else if (fortnoxArtikelId === "UJ100") articleName = "Tvätt UJ-behållare";
          article = await storage.createArticle({
            tenantId,
            name: articleName,
            articleNumber: fortnoxArtikelId,
            articleType: "tjanst",
            listPrice: pris,
            objectTypes: [],
          });
          articleByFortnox.set(fortnoxArtikelId.toLowerCase(), article);
          articlesAutoCreated++;
        }
        if (!article) {
          errors.push(`Ingen artikel kunde skapas för rad ${uppgiftId}/${rad}`);
          continue;
        }

        await storage.createWorkOrderLine({
          tenantId,
          workOrderId: workOrder.id,
          articleId: article.id,
          quantity: antal,
          resolvedPrice: pris,
          resolvedCost: 0,
          resolvedProductionMinutes: 0,
          priceSource: "modus_import",
          notes: beskrivning || null,
        }, { skipRecalc: true });
        affectedWorkOrderIds.add(workOrder.id);

        created.push(`${uppgiftId}/${rad}: ${beskrivning.substring(0, 40)}`);
      } catch (err) {
        errors.push(`Fel vid import av fakturarad ${row["Uppgift Id"] || "?"}/${row["Rad"] || "?"}: ${err}`);
      }
      if (processed % 500 === 0) {
        try {
          await db.update(importBatches).set({
            metadata: {
              type: "modus-invoice-lines",
              status: "in_progress",
              phase: "rader",
              rowsProcessed: processed,
              created: created.length,
              skippedExisting: skippedExistingCount,
              articlesAutoCreated,
              errors: errors.length,
              mode: skipExisting ? "skip_existing" : "upsert",
              filename,
              startedBy,
            },
          }).where(eq(importBatches.batchId, invoiceBatchId));
        } catch {}
      }
    }

    // Räkna om cachedValue/cachedCost/cachedProductionMinutes på alla berörda ordrar
    // så orderstock-summan stämmer direkt efter importen.
    const recalcResult = await storage.recalculateWorkOrderTotalsBulk(Array.from(affectedWorkOrderIds));

    await db.update(importBatches).set({
      created: created.length,
      errors: errors.length,
      metadata: {
        type: "modus-invoice-lines",
        status: "completed",
        phase: "klar",
        rowsProcessed: totalRows,
        totalRows,
        imported: created.length,
        created: created.length,
        articlesAutoCreated,
        skippedExisting: skippedExistingCount,
        mode: skipExisting ? "skip_existing" : "upsert",
        errorSamples: errors.slice(0, 50),
        sampleErrors: errors.slice(0, 50),
        ordersRecalculated: recalcResult.recalculated,
        ordersValueChanged: recalcResult.changed,
        completedAt: new Date().toISOString(),
        filename,
        startedBy,
      },
    }).where(eq(importBatches.batchId, invoiceBatchId));
  } catch (err) {
    console.error(`[modus-invoice-lines ${invoiceBatchId}] kraschade:`, err);
    try {
      await db.update(importBatches).set({
        errors: 1,
        metadata: {
          type: "modus-invoice-lines",
          status: "failed",
          error: String(err),
          failedAt: new Date().toISOString(),
          filename,
          startedBy,
        },
      }).where(eq(importBatches.batchId, invoiceBatchId));
    } catch {}
  }
}

app.post("/api/import/customers/validate", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }

    const csvText = req.file.buffer.toString("utf-8");
    const delimiter = csvText.includes(";") ? ";" : ",";
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true, delimiter });

    if (result.errors.length > 0) {
      throw new ValidationError("CSV-fel", { details: result.errors.slice(0, 10) });
    }

    const tenantId = getTenantIdWithFallback(req);
    const existingCustomers = await storage.getCustomers(tenantId);
    const existingByName = new Map(existingCustomers.map(c => [c.name.toLowerCase(), c]));
    const existingByNumber = new Map(existingCustomers.filter(c => c.customerNumber).map(c => [c.customerNumber!.toLowerCase(), c]));

    const rows = result.data as Record<string, string>[];
    const preview: Array<{
      row: number;
      name: string;
      customerNumber: string;
      address: string;
      city: string;
      postalCode: string;
      contactPerson: string;
      email: string;
      phone: string;
      invoiceReference: string;
      duplicate: null | { type: string; existingId: string; existingName: string };
      errors: string[];
    }> = [];

    const csvNumbers = new Map<string, number[]>();
    const csvNames = new Map<string, number[]>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const name = (row.namn || row.Namn || row.name || row.Name || "").trim();
      const customerNumber = (row.kundnummer || row.Kundnummer || row.customerNumber || "").trim();
      const address = (row.adress || row.Adress || row.address || "").trim();
      const city = (row.ort || row.Ort || row.stad || row.city || "").trim();
      const postalCode = (row.postnr || row.postnummer || row.Postnummer || row.postalCode || "").trim();
      const contactPerson = (row.kontakt || row.kontaktperson || row.Kontaktperson || row.contactPerson || "").trim();
      const email = (row["e-post"] || row.epost || row.Epost || row.email || "").trim();
      const phone = (row.telefon || row.Telefon || row.phone || "").trim();
      const invoiceReference = (row.fakturareferens || row.Fakturareferens || row.invoiceReference || "").trim();

      const errors: string[] = [];
      if (!name) errors.push("Namn saknas");

      let duplicate: typeof preview[0]["duplicate"] = null;

      if (customerNumber) {
        const existing = existingByNumber.get(customerNumber.toLowerCase());
        if (existing) {
          duplicate = { type: "customerNumber", existingId: existing.id, existingName: existing.name };
        }
        if (!csvNumbers.has(customerNumber.toLowerCase())) csvNumbers.set(customerNumber.toLowerCase(), []);
        csvNumbers.get(customerNumber.toLowerCase())!.push(rowNum);
      }

      if (!duplicate && name) {
        const existing = existingByName.get(name.toLowerCase());
        if (existing) {
          duplicate = { type: "name", existingId: existing.id, existingName: existing.name };
        }
        if (!csvNames.has(name.toLowerCase())) csvNames.set(name.toLowerCase(), []);
        csvNames.get(name.toLowerCase())!.push(rowNum);
      }

      preview.push({ row: rowNum, name, customerNumber, address, city, postalCode, contactPerson, email, phone, invoiceReference, duplicate, errors });
    }

    const csvDuplicates: Array<{ value: string; type: string; rows: number[] }> = [];
    for (const [num, rowNums] of csvNumbers) {
      if (rowNums.length > 1) csvDuplicates.push({ value: num, type: "customerNumber", rows: rowNums });
    }
    for (const [name, rowNums] of csvNames) {
      if (rowNums.length > 1) csvDuplicates.push({ value: name, type: "name", rows: rowNums });
    }

    const totalRows = rows.length;
    const duplicateCount = preview.filter(p => p.duplicate !== null).length;
    const errorCount = preview.filter(p => p.errors.length > 0).length;
    const newCount = preview.filter(p => !p.duplicate && p.errors.length === 0).length;

    res.json({
      totalRows,
      preview: preview.slice(0, 500),
      duplicateCount,
      errorCount,
      newCount,
      csvDuplicates,
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
    });
}));

// === Fortnox-xlsx-import ===

// Stabil nyckel för en leveransadress: lowercase + trim + kollapsa whitespace.
// Används för dedup av leveransadresser inom samma Fortnox-kund och för stabil
// fortnoxId vid re-import (`delivery:<customerNumber>:<key>`).
function deliveryAddressKey(address: string | null, postalCode: string | null, city: string | null): string {
  return [address, postalCode, city]
    .map(s => (s || "").toLowerCase().replace(/\s+/g, " ").trim())
    .join("|");
}

// Filtrerar Fortnox-rader enligt importspec: endast företagskunder (type=company eller tom),
// active != "0", customer_number och name måste finnas.
function isEligibleFortnoxRow(r: FortnoxCustomerRow): { ok: true } | { ok: false; reason: string } {
  if (!r.customerNumber) return { ok: false, reason: "Saknar kundnummer" };
  if (!r.name) return { ok: false, reason: "Saknar namn" };
  // Type: tillåt company eller tom (privatpersoner = "private" hoppas över)
  const t = r.type.toLowerCase().trim();
  if (t && t !== "company") return { ok: false, reason: `Privatperson/okänd typ (${t})` };
  // Active: skippa endast om explicit "0" eller "false"/"nej"
  const a = r.active.toLowerCase().trim();
  if (a === "0" || a === "false" || a === "nej") return { ok: false, reason: "Inaktiv kund" };
  return { ok: true };
}

// Validera uppladdad Fortnox-xlsx-export och returnera förhandsgranskning + dubblettmatchning
app.post("/api/import/fortnox-customers/validate", xlsxUpload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError("Ingen fil uppladdad");
  const tenantId = await getTenantIdWithFallback(req);

  const rawRows = await parseFortnoxXlsx(req.file.buffer);
  if (rawRows.length === 0) throw new ValidationError("Excel-filen är tom eller saknar rubriker");

  const mapped = rawRows.map((r) => mapFortnoxRow(r, parseInt(r.__rowNum || "0", 10)));

  // Eligibility-filter
  const eligible: FortnoxCustomerRow[] = [];
  const errorRows: { rowNum: number; reason: string; name: string }[] = [];
  for (const r of mapped) {
    const check = isEligibleFortnoxRow(r);
    if (check.ok) eligible.push(r);
    else errorRows.push({ rowNum: r.rowNum, reason: check.reason, name: r.name || r.customerNumber });
  }

  // Hämta befintliga Fortnox-mappningar (customer) för dedup primär
  const existingMappings = await storage.getFortnoxMappings(tenantId, "customer");
  const mappedFortnoxIds = new Set(existingMappings.map(m => m.fortnoxId));

  // Hämta befintliga kunder för dubblettmatchning (customer_number primärt + name fallback)
  const existingCustomers = await db
    .select({ id: customers.id, customerNumber: customers.customerNumber, name: customers.name })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
  const customerNumberToCustomer = new Map<string, { id: string; name: string }>();
  const customerNameToCustomer = new Map<string, { id: string; name: string }>();
  for (const c of existingCustomers) {
    if (c.customerNumber) customerNumberToCustomer.set(c.customerNumber, { id: c.id, name: c.name });
    customerNameToCustomer.set(c.name.toLowerCase().trim(), { id: c.id, name: c.name });
  }

  let duplicateCount = 0;
  let newCount = 0;
  const preview = eligible.map(r => {
    const alreadyMapped = mappedFortnoxIds.has(r.customerNumber);
    const matchByNumber = customerNumberToCustomer.get(r.customerNumber) || null;
    const matchByName = !matchByNumber ? (customerNameToCustomer.get(r.name.toLowerCase().trim()) || null) : null;
    const existingMatch = matchByNumber || matchByName;
    const matchType: "fortnox_mapping" | "customer_number" | "name" | null =
      alreadyMapped ? "fortnox_mapping" :
      matchByNumber ? "customer_number" :
      matchByName ? "name" : null;
    const isDuplicate = alreadyMapped || existingMatch !== null;
    if (isDuplicate) duplicateCount++; else newCount++;
    return {
      rowNum: r.rowNum,
      customerNumber: r.customerNumber,
      name: r.name,
      orgNumber: r.orgNumber,
      address: r.address,
      postalCode: r.postalCode,
      city: r.city,
      email: r.email,
      invoiceEmail: r.invoiceEmail,
      phone: r.phone,
      contactPerson: r.contactPerson,
      isDuplicate,
      matchType,
      existingMatch,
    };
  });

  res.json({
    totalRows: rawRows.length,
    preview,
    duplicateCount,
    newCount,
    errorCount: errorRows.length,
    errorRows,
  });
}));

// Bulk-import av Fortnox-kunder från xlsx → skapar/uppdaterar kund + fastighet-objekt + fortnox_mappings
app.post("/api/import/fortnox-customers/bulk", xlsxUpload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError("Ingen fil uppladdad");
  const tenantId = await getTenantIdWithFallback(req);
  const importBatchId = crypto.randomUUID();

  // mode=merge => uppdatera befintliga kunder; default = skip
  const mode = ((req.body?.mode as string) || "skip").toLowerCase();
  const merge = mode === "merge";

  // Valbart: lista över customer_number som ska importeras (default: alla berättigade)
  const selectedRaw = (req.body?.selectedCustomerNumbers as string) || "";
  const selectedSet = selectedRaw
    ? new Set(selectedRaw.split(",").map(s => s.trim()).filter(Boolean))
    : null;

  const rawRows = await parseFortnoxXlsx(req.file.buffer);
  if (rawRows.length === 0) throw new ValidationError("Excel-filen är tom");
  const mapped = rawRows.map((r) => mapFortnoxRow(r, parseInt(r.__rowNum || "0", 10)));

  const existingCustomerMappings = await storage.getFortnoxMappings(tenantId, "customer");
  const customerFortnoxIdToUnicornId = new Map(existingCustomerMappings.map(m => [m.fortnoxId, m.unicornId]));
  const existingObjectMappings = await storage.getFortnoxMappings(tenantId, "object");
  const objectFortnoxIdToUnicornId = new Map(existingObjectMappings.map(m => [m.fortnoxId, m.unicornId]));

  // För namn-fallback i bulk
  const existingCustomers = await db
    .select({ id: customers.id, customerNumber: customers.customerNumber, name: customers.name })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
  const customerNumberToId = new Map<string, string>();
  const customerNameToId = new Map<string, string>();
  for (const c of existingCustomers) {
    if (c.customerNumber) customerNumberToId.set(c.customerNumber, c.id);
    customerNameToId.set(c.name.toLowerCase().trim(), c.id);
  }

  // För backwards-kompatibilitet: hämta adress för befintliga objekt mappade
  // via fortnoxId = customerNumber (legacy single-object-per-customer).
  // Detta används för att undvika att skapa ett "delivery:" duplikat för en
  // adress som redan finns som legacy-objekt.
  const legacyObjectIds = existingObjectMappings
    .filter(m => !m.fortnoxId.includes(":"))
    .map(m => m.unicornId);
  const legacyObjectAddressByFortnoxId = new Map<string, string>();
  if (legacyObjectIds.length > 0) {
    const legacyObjects = await db
      .select({ id: objects.id, address: objects.address, postalCode: objects.postalCode, city: objects.city })
      .from(objects)
      .where(inArray(objects.id, legacyObjectIds));
    const idToObj = new Map(legacyObjects.map(o => [o.id, o]));
    for (const m of existingObjectMappings) {
      if (m.fortnoxId.includes(":")) continue;
      const o = idToObj.get(m.unicornId);
      if (o) legacyObjectAddressByFortnoxId.set(m.fortnoxId, deliveryAddressKey(o.address, o.postalCode, o.city));
    }
  }

  const summary = {
    customers: { created: 0, merged: 0, skipped: 0 },
    objects: { created: 0, geocodingQueued: 0 },
  };
  let errorCount = 0;
  const errors: string[] = [];
  const newObjectIdsForGeocoding: string[] = [];

  // Gruppera berättigade rader per customer_number så att flera leveransadress-
  // rader för samma kund kan bli flera fastighet-objekt.
  const rowsByCustomer = new Map<string, FortnoxCustomerRow[]>();
  for (const r of mapped) {
    const check = isEligibleFortnoxRow(r);
    if (!check.ok) continue;
    if (selectedSet && !selectedSet.has(r.customerNumber)) continue;
    const arr = rowsByCustomer.get(r.customerNumber) || [];
    arr.push(r);
    rowsByCustomer.set(r.customerNumber, arr);
  }

  for (const [customerNumber, rows] of rowsByCustomer) {
    // Välj en "primary" som föredrar rader med ifylld leveransadress, så att
    // single-object-fallbacken inte plockar en tom adress när en ifylld finns.
    const primary = rows.find(r => r.address && r.address.trim() !== "") || rows[0];

    // Bygg unika leveransadresser inom samma kund (deduplicera identiska rader)
    const uniqueDeliveryRows = new Map<string, FortnoxCustomerRow>();
    for (const r of rows) {
      const key = deliveryAddressKey(r.address, r.postalCode, r.city);
      if (!uniqueDeliveryRows.has(key)) uniqueDeliveryRows.set(key, r);
    }
    const deliveryRowsWithAddress = Array.from(uniqueDeliveryRows.entries())
      .filter(([, r]) => r.address && r.address.trim() !== "");
    const useMultiDelivery = deliveryRowsWithAddress.length > 1;

    // Hitta befintlig kund: 1) Fortnox-mappning, 2) customer_number, 3) namn
    const existingCustomerId: string | null =
      customerFortnoxIdToUnicornId.get(customerNumber) ||
      customerNumberToId.get(customerNumber) ||
      customerNameToId.get(primary.name.toLowerCase().trim()) ||
      null;

    try {
      await db.transaction(async (tx) => {
        let customerId: string;
        if (existingCustomerId && !merge) {
          summary.customers.skipped++;
          customerId = existingCustomerId;
          if (!customerFortnoxIdToUnicornId.has(customerNumber)) {
            await tx.insert(fortnoxMappings).values({
              tenantId, entityType: "customer", unicornId: existingCustomerId, fortnoxId: customerNumber,
            });
            customerFortnoxIdToUnicornId.set(customerNumber, existingCustomerId);
          }
        } else if (existingCustomerId) {
          await tx.update(customers).set({
            name: primary.name,
            customerNumber: customerNumber,
            ...(primary.orgNumber && { orgNumber: primary.orgNumber }),
            ...(primary.contactPerson && { contactPerson: primary.contactPerson }),
            ...(primary.email && { email: primary.email }),
            ...(primary.phone && { phone: primary.phone }),
            ...(primary.address && { address: primary.address }),
            ...(primary.city && { city: primary.city }),
            ...(primary.postalCode && { postalCode: primary.postalCode }),
            ...(primary.invoiceEmail && { invoiceEmail: primary.invoiceEmail }),
            ...(primary.invoiceAddress && { invoiceAddress: primary.invoiceAddress }),
            ...(primary.invoicePostalCode && { invoicePostalCode: primary.invoicePostalCode }),
            ...(primary.invoiceCity && { invoiceCity: primary.invoiceCity }),
          }).where(and(eq(customers.id, existingCustomerId), eq(customers.tenantId, tenantId)));
          customerId = existingCustomerId;
          summary.customers.merged++;
          if (!customerFortnoxIdToUnicornId.has(customerNumber)) {
            await tx.insert(fortnoxMappings).values({
              tenantId, entityType: "customer", unicornId: customerId, fortnoxId: customerNumber,
            });
            customerFortnoxIdToUnicornId.set(customerNumber, customerId);
          }
        } else {
          const [createdCustomer] = await tx.insert(customers).values({
            tenantId,
            name: primary.name,
            customerNumber: customerNumber,
            orgNumber: primary.orgNumber || null,
            contactPerson: primary.contactPerson || null,
            email: primary.email || null,
            phone: primary.phone || null,
            address: primary.address || null,
            city: primary.city || null,
            postalCode: primary.postalCode || null,
            invoiceEmail: primary.invoiceEmail || null,
            invoiceAddress: primary.invoiceAddress || null,
            invoicePostalCode: primary.invoicePostalCode || null,
            invoiceCity: primary.invoiceCity || null,
            notes: "Importerat från Fortnox-xlsx",
            importBatchId,
          }).returning();
          customerId = createdCustomer.id;
          await tx.insert(fortnoxMappings).values({
            tenantId, entityType: "customer", unicornId: customerId, fortnoxId: customerNumber,
          });
          customerFortnoxIdToUnicornId.set(customerNumber, customerId);
          customerNumberToId.set(customerNumber, customerId);
          customerNameToId.set(primary.name.toLowerCase().trim(), customerId);
          summary.customers.created++;
        }

        // Skapa fastighet-objekt: en per unik leveransadress vid flera, annars
        // ett enstaka standardobjekt (legacy-beteende).
        const legacyAddressKey = legacyObjectAddressByFortnoxId.get(customerNumber);

        if (useMultiDelivery) {
          for (const [addrKey, r] of deliveryRowsWithAddress) {
            const objectFortnoxId = `delivery:${customerNumber}:${addrKey}`;
            if (objectFortnoxIdToUnicornId.has(objectFortnoxId)) continue;
            // Hoppa över om legacy-objekt redan finns för exakt samma adress
            if (legacyAddressKey && legacyAddressKey === addrKey) continue;

            const objectName = r.deliveryName
              || (r.city ? `${primary.name} – ${r.city}` : `${primary.name} – ${r.address}`);
            const [createdObject] = await tx.insert(objects).values({
              tenantId,
              customerId,
              name: objectName,
              objectNumber: `${customerNumber}-${addrKey.slice(0, 16)}`,
              objectType: "fastighet",
              hierarchyLevel: "fastighet",
              objectLevel: 1,
              address: r.address || null,
              city: r.city || null,
              postalCode: r.postalCode || null,
              status: "active",
              notes: "Skapad automatiskt vid Fortnox-xlsx-import (leveransadress)",
              importBatchId,
            }).returning();
            await tx.insert(fortnoxMappings).values({
              tenantId, entityType: "object", unicornId: createdObject.id, fortnoxId: objectFortnoxId,
            });
            objectFortnoxIdToUnicornId.set(objectFortnoxId, createdObject.id);
            summary.objects.created++;
            if (r.address && r.address.trim() !== "") {
              newObjectIdsForGeocoding.push(createdObject.id);
            }
          }
        } else {
          // Fallback: ett standardobjekt per kund (befintligt beteende).
          const objectFortnoxId = customerNumber;
          if (!objectFortnoxIdToUnicornId.has(objectFortnoxId)) {
            const objectName = primary.deliveryName || primary.name;
            const [createdObject] = await tx.insert(objects).values({
              tenantId,
              customerId,
              name: objectName,
              objectNumber: customerNumber,
              objectType: "fastighet",
              hierarchyLevel: "fastighet",
              objectLevel: 1,
              address: primary.address || null,
              city: primary.city || null,
              postalCode: primary.postalCode || null,
              status: "active",
              notes: "Skapad automatiskt vid Fortnox-xlsx-import",
              importBatchId,
            }).returning();
            await tx.insert(fortnoxMappings).values({
              tenantId, entityType: "object", unicornId: createdObject.id, fortnoxId: objectFortnoxId,
            });
            objectFortnoxIdToUnicornId.set(objectFortnoxId, createdObject.id);
            summary.objects.created++;
            if (primary.address && primary.address.trim() !== "") {
              newObjectIdsForGeocoding.push(createdObject.id);
            }
          }
        }
      });
    } catch (err) {
      errorCount++;
      const friendly = describeFortnoxMappingConflict(err);
      const detail = friendly || (err instanceof Error ? err.message : String(err));
      errors.push(`Kund ${customerNumber} (${primary.name}): ${detail}`);
    }
  }

  // Fire-and-forget geokodning (triggerGeocodeIfMissing returnerar void och hanterar egna fel)
  for (const objId of newObjectIdsForGeocoding) {
    triggerGeocodeIfMissing(objId);
  }
  summary.objects.geocodingQueued = newObjectIdsForGeocoding.length;

  res.json({
    success: true,
    importBatchId,
    customers: summary.customers,
    objects: summary.objects,
    errorCount,
    errors: errors.slice(0, 50),
  });
}));

// ============================================================================
// FORTNOX FAKTURAHISTORIK → AVTALSFÖRSLAG
// Identifierar återkommande artiklar per kund från historiska fakturor
// och föreslår tjänsteavtal som måste godkännas innan de blir skarpa.
// ============================================================================

interface FortnoxInvoiceLine {
  invoiceNumber: string;
  invoiceDate: Date | null;
  customerNumber: string;
  customerName: string;
  articleNumber: string;
  description: string;
  quantity: number;
  price: number;
  total: number;
  rowNum: number;
}

function pickAny(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    // case-insensitive
    const found = Object.keys(row).find(rk => rk.toLowerCase() === k.toLowerCase());
    if (found) {
      const v = row[found];
      if (v && String(v).trim() !== "") return String(v).trim();
    }
  }
  return "";
}

function parseSwedishNumber(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/\s/g, "").replace(/[^\d.,-]/g, "").replace(/,/g, ".");
  // If multiple dots remain, keep only the last as decimal separator
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastDot >= 0 && cleaned.indexOf(".") !== lastDot) {
    normalized = cleaned.substring(0, lastDot).replace(/\./g, "") + cleaned.substring(lastDot);
  }
  const n = parseFloat(normalized);
  return isFinite(n) ? n : 0;
}

function parseInvoiceDate(s: string): Date | null {
  if (!s) return null;
  const trimmed = s.trim();
  // ISO YYYY-MM-DD
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`);
    if (!isNaN(d.getTime())) return d;
  }
  // DD/MM/YYYY or DD.MM.YYYY
  const eu = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (eu) {
    const d = new Date(`${eu[3]}-${eu[2].padStart(2, "0")}-${eu[1].padStart(2, "0")}`);
    if (!isNaN(d.getTime())) return d;
  }
  // Try Excel serial number
  const num = parseFloat(trimmed);
  if (!isNaN(num) && num > 25569 && num < 80000) {
    const ms = (num - 25569) * 86400 * 1000;
    return new Date(ms);
  }
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

function parseFortnoxInvoiceXlsx(buffer: Buffer): FortnoxInvoiceLine[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
  if (aoa.length === 0) return [];

  // Locate header row (within first 15 rows) – look for common Fortnox columns
  const candidates = ["invoicenumber", "invoice_number", "fakturanummer", "invoicedate", "customernumber", "customer_number", "kundnummer", "articlenumber", "artikelnummer"];
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const row = (aoa[i] || []).map((c) => String(c || "").trim().toLowerCase().replace(/\s+/g, ""));
    if (candidates.some(c => row.includes(c))) {
      headerRowIdx = i;
      break;
    }
  }
  const headers = (aoa[headerRowIdx] || []).map((c) => String(c || "").trim());
  const out: FortnoxInvoiceLine[] = [];
  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    const arr = aoa[i] || [];
    const row: Record<string, string> = {};
    let hasContent = false;
    for (let j = 0; j < headers.length; j++) {
      const k = headers[j];
      if (!k) continue;
      const v = arr[j];
      const s = v == null ? "" : String(v).trim();
      row[k] = s;
      if (s !== "") hasContent = true;
    }
    if (!hasContent) continue;

    const invoiceNumber = pickAny(row, ["InvoiceNumber", "Invoice_Number", "Fakturanummer", "DocumentNumber"]);
    const invoiceDateStr = pickAny(row, ["InvoiceDate", "Invoice_Date", "Fakturadatum", "Datum"]);
    const customerNumber = pickAny(row, ["CustomerNumber", "Customer_Number", "Kundnummer"]);
    const customerName = pickAny(row, ["CustomerName", "Customer_Name", "Kundnamn", "Kund", "Name"]);
    const articleNumber = pickAny(row, ["ArticleNumber", "Article_Number", "Artikelnummer", "Article"]);
    const description = pickAny(row, ["Description", "Beskrivning", "ArticleDescription", "Artikelbeskrivning", "Benämning"]);
    const quantityStr = pickAny(row, ["DeliveredQuantity", "Quantity", "Antal", "Delivered_Quantity"]);
    const priceStr = pickAny(row, ["Price", "Pris", "UnitPrice", "Unit_Price", "Á-pris", "À-pris"]);
    const totalStr = pickAny(row, ["Total", "Summa", "RowSum", "Belopp"]);

    if (!customerNumber || (!articleNumber && !description)) continue;

    const quantity = parseSwedishNumber(quantityStr) || 1;
    const price = parseSwedishNumber(priceStr);
    const total = parseSwedishNumber(totalStr) || price * quantity;

    out.push({
      invoiceNumber,
      invoiceDate: parseInvoiceDate(invoiceDateStr),
      customerNumber,
      customerName,
      articleNumber: articleNumber || "",
      description: description || articleNumber || "",
      quantity,
      price,
      total,
      rowNum: i + 1,
    });
  }
  return out;
}

interface RecurrenceGroup {
  customerNumber: string;
  customerName: string;
  articleNumber: string;
  articleDescription: string;
  invoices: { invoiceNumber: string; date: Date; total: number; quantity: number; price: number }[];
}

function inferBillingCycle(avgIntervalDays: number): { cycle: string; monthly: number } {
  if (avgIntervalDays < 10) return { cycle: "weekly", monthly: 30 / Math.max(avgIntervalDays, 1) };
  if (avgIntervalDays < 45) return { cycle: "monthly", monthly: 1 };
  if (avgIntervalDays < 135) return { cycle: "quarterly", monthly: 1 / 3 };
  if (avgIntervalDays < 270) return { cycle: "biannual", monthly: 1 / 6 };
  return { cycle: "yearly", monthly: 1 / 12 };
}

function analyzeRecurrence(
  lines: FortnoxInvoiceLine[],
  opts: { minOccurrences: number; minSpanDays: number }
): {
  suggestions: Omit<InsertFortnoxContractSuggestion, "tenantId" | "importBatchId" | "customerId">[];
  totalGroups: number;
  totalLines: number;
  uniqueCustomers: number;
} {
  const grouped = new Map<string, RecurrenceGroup>();
  for (const l of lines) {
    if (!l.invoiceDate) continue;
    const key = `${l.customerNumber}::${(l.articleNumber || l.description).toLowerCase().trim()}`;
    let g = grouped.get(key);
    if (!g) {
      g = {
        customerNumber: l.customerNumber,
        customerName: l.customerName,
        articleNumber: l.articleNumber,
        articleDescription: l.description,
        invoices: [],
      };
      grouped.set(key, g);
    }
    g.invoices.push({
      invoiceNumber: l.invoiceNumber,
      date: l.invoiceDate,
      total: l.total,
      quantity: l.quantity,
      price: l.price,
    });
  }

  const suggestions: Omit<InsertFortnoxContractSuggestion, "tenantId" | "importBatchId" | "customerId">[] = [];
  const uniqueCustomers = new Set<string>();
  for (const g of grouped.values()) {
    uniqueCustomers.add(g.customerNumber);
    // Dedup by invoiceNumber (one line per invoice for this article)
    const byInvoice = new Map<string, { date: Date; total: number; quantity: number; price: number }>();
    for (const inv of g.invoices) {
      const existing = byInvoice.get(inv.invoiceNumber);
      if (!existing) {
        byInvoice.set(inv.invoiceNumber, { date: inv.date, total: inv.total, quantity: inv.quantity, price: inv.price });
      } else {
        existing.total += inv.total;
        existing.quantity += inv.quantity;
      }
    }
    const arr = Array.from(byInvoice.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    if (arr.length < opts.minOccurrences) continue;
    const first = arr[0].date;
    const last = arr[arr.length - 1].date;
    const spanDays = (last.getTime() - first.getTime()) / 86400000;
    if (spanDays < opts.minSpanDays) continue;

    // Average interval between consecutive invoices
    let totalGap = 0;
    for (let i = 1; i < arr.length; i++) {
      totalGap += (arr[i].date.getTime() - arr[i - 1].date.getTime()) / 86400000;
    }
    const avgIntervalDays = totalGap / (arr.length - 1);
    const { cycle, monthly: cyclesPerMonth } = inferBillingCycle(avgIntervalDays);
    const totalRevenue = arr.reduce((s, x) => s + x.total, 0);
    const avgPrice = arr.reduce((s, x) => s + x.price, 0) / arr.length;
    const avgQuantity = arr.reduce((s, x) => s + x.quantity, 0) / arr.length;
    const avgInvoiceTotal = totalRevenue / arr.length;
    const monthlyValue = avgInvoiceTotal * cyclesPerMonth;

    // Confidence: more invoices, longer span, smaller variance => higher
    const intervals: number[] = [];
    for (let i = 1; i < arr.length; i++) intervals.push((arr[i].date.getTime() - arr[i - 1].date.getTime()) / 86400000);
    const meanI = avgIntervalDays;
    const variance = intervals.length > 0 ? intervals.reduce((s, v) => s + (v - meanI) ** 2, 0) / intervals.length : 0;
    const stdDev = Math.sqrt(variance);
    const cv = meanI > 0 ? stdDev / meanI : 1;
    let confidence = Math.min(1, arr.length / 12) * Math.max(0, 1 - cv);
    confidence = Math.max(0.05, Math.min(1, confidence));

    suggestions.push({
      fortnoxCustomerNumber: g.customerNumber,
      customerName: g.customerName || g.customerNumber,
      articleNumber: g.articleNumber || null,
      articleDescription: g.articleDescription,
      occurrenceCount: arr.length,
      firstSeen: first,
      lastSeen: last,
      avgIntervalDays,
      suggestedBillingCycle: cycle,
      avgPrice,
      avgQuantity,
      totalRevenue,
      monthlyValue,
      confidence,
      status: "pending",
      rawSamples: arr.slice(0, 10).map(x => ({
        date: x.date.toISOString().slice(0, 10),
        quantity: x.quantity,
        price: x.price,
        total: x.total,
      })),
    });
  }

  return {
    suggestions,
    totalGroups: grouped.size,
    totalLines: lines.length,
    uniqueCustomers: uniqueCustomers.size,
  };
}

// Validate + analyze – returns preview (does not persist)
app.post("/api/import/fortnox-invoices/analyze", xlsxUpload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError("Ingen fil uppladdad");
  const tenantId = await getTenantIdWithFallback(req);

  const minOccurrences = Math.max(2, parseInt(String(req.body?.minOccurrences || "3"), 10));
  const minSpanDays = Math.max(0, parseInt(String(req.body?.minSpanDays || "60"), 10));
  const persist = String(req.body?.persist || "false").toLowerCase() === "true";

  const lines = parseFortnoxInvoiceXlsx(req.file.buffer);
  if (lines.length === 0) throw new ValidationError("Filen innehåller inga fakturarader vi kunde tolka. Kontrollera att kolumner som InvoiceDate, CustomerNumber och ArticleNumber finns.");

  const { suggestions, totalGroups, totalLines, uniqueCustomers } = analyzeRecurrence(lines, { minOccurrences, minSpanDays });

  // Map fortnoxCustomerNumber → existing customer
  const customerNumbers = Array.from(new Set(suggestions.map(s => s.fortnoxCustomerNumber)));
  let customerLookup = new Map<string, { id: string; name: string }>();
  if (customerNumbers.length > 0) {
    const rows = await db.select({ id: customers.id, customerNumber: customers.customerNumber, name: customers.name })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt), inArray(customers.customerNumber, customerNumbers as string[])));
    for (const r of rows) {
      if (r.customerNumber) customerLookup.set(r.customerNumber, { id: r.id, name: r.name });
    }
  }

  const enriched = suggestions.map(s => {
    const match = customerLookup.get(s.fortnoxCustomerNumber);
    return { ...s, customerId: match?.id || null, matchedCustomerName: match?.name || null };
  });

  let importBatchId: string | null = null;
  if (persist && enriched.length > 0) {
    importBatchId = crypto.randomUUID();
    const toInsert: InsertFortnoxContractSuggestion[] = enriched.map(s => ({
      tenantId,
      importBatchId: importBatchId!,
      customerId: s.customerId,
      fortnoxCustomerNumber: s.fortnoxCustomerNumber,
      customerName: s.customerName,
      articleNumber: s.articleNumber,
      articleDescription: s.articleDescription,
      occurrenceCount: s.occurrenceCount,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      avgIntervalDays: s.avgIntervalDays,
      suggestedBillingCycle: s.suggestedBillingCycle,
      avgPrice: s.avgPrice,
      avgQuantity: s.avgQuantity,
      totalRevenue: s.totalRevenue,
      monthlyValue: s.monthlyValue,
      confidence: s.confidence,
      status: "pending",
      rawSamples: s.rawSamples,
    }));
    await storage.createFortnoxContractSuggestions(toInsert);
  }

  res.json({
    importBatchId,
    persisted: persist,
    totalLines,
    totalGroups,
    uniqueCustomers,
    suggestionsCount: enriched.length,
    matchedCustomers: enriched.filter(s => s.customerId).length,
    unmatchedCustomers: enriched.filter(s => !s.customerId).length,
    suggestions: enriched.map(s => ({
      fortnoxCustomerNumber: s.fortnoxCustomerNumber,
      customerName: s.customerName,
      matchedCustomerId: s.customerId,
      matchedCustomerName: s.matchedCustomerName,
      articleNumber: s.articleNumber,
      articleDescription: s.articleDescription,
      occurrenceCount: s.occurrenceCount,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      avgIntervalDays: s.avgIntervalDays,
      suggestedBillingCycle: s.suggestedBillingCycle,
      avgPrice: s.avgPrice,
      avgQuantity: s.avgQuantity,
      totalRevenue: s.totalRevenue,
      monthlyValue: s.monthlyValue,
      confidence: s.confidence,
      rawSamples: s.rawSamples,
    })),
  });
}));

// List persisted suggestions (for the review UI)
app.get("/api/import/fortnox-invoices/suggestions", asyncHandler(async (req, res) => {
  const tenantId = await getTenantIdWithFallback(req);
  const status = (req.query.status as string) || undefined;
  const importBatchId = (req.query.importBatchId as string) || undefined;
  const customerId = (req.query.customerId as string) || undefined;
  const rows = await storage.listFortnoxContractSuggestions(tenantId, { status, importBatchId, customerId });
  res.json({ suggestions: rows });
}));

// Approve a suggestion → create a real customerServiceContract
app.post("/api/import/fortnox-invoices/suggestions/:id/approve", asyncHandler(async (req, res) => {
  const tenantId = await getTenantIdWithFallback(req);
  const suggestion = await storage.getFortnoxContractSuggestion(req.params.id, tenantId);
  if (!suggestion) throw new NotFoundError("Förslag hittades inte");
  if (suggestion.status !== "pending") {
    throw new ValidationError(`Förslag är redan ${suggestion.status}`);
  }

  // Allow override values from body
  const overrides = (req.body || {}) as {
    customerId?: string;
    name?: string;
    monthlyValue?: number;
    billingCycle?: string;
    startDate?: string;
    notes?: string;
  };

  const customerId = overrides.customerId || suggestion.customerId;
  if (!customerId) {
    throw new ValidationError("Förslaget har ingen kopplad kund. Importera Fortnox-kunder eller ange customerId i begäran.");
  }
  // Verify customer belongs to tenant
  const cust = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
  if (cust.length === 0) throw new ValidationError("Kund tillhör inte denna tenant");

  const created = await storage.createCustomerServiceContract({
    tenantId,
    customerId,
    contractNumber: null,
    name: overrides.name || suggestion.articleDescription,
    description: `Härlett från Fortnox-fakturahistorik (${suggestion.occurrenceCount} fakturor ${new Date(suggestion.firstSeen).toISOString().slice(0,10)}–${new Date(suggestion.lastSeen).toISOString().slice(0,10)})`,
    status: "active",
    startDate: overrides.startDate ? new Date(overrides.startDate) : new Date(),
    endDate: null,
    renewalType: "auto",
    billingCycle: overrides.billingCycle || suggestion.suggestedBillingCycle,
    monthlyValue: overrides.monthlyValue ?? suggestion.monthlyValue ?? null,
    objectIds: [],
    services: [{
      articleNumber: suggestion.articleNumber,
      description: suggestion.articleDescription,
      avgQuantity: suggestion.avgQuantity,
      avgPrice: suggestion.avgPrice,
    }],
    notes: overrides.notes || `Genererat förslag (konfidens ${(Math.round((suggestion.confidence || 0) * 100))}%) från Fortnox-import ${suggestion.importBatchId}`,
  });

  const reviewerId = (req.user as { claims?: { sub?: string } } | undefined)?.claims?.sub || null;
  const updated = await storage.updateFortnoxContractSuggestion(suggestion.id, tenantId, {
    status: "approved",
    createdContractId: created.id,
    reviewedAt: new Date(),
    reviewedBy: reviewerId,
  });

  res.json({ success: true, contract: created, suggestion: updated });
}));

// Reject a suggestion
app.post("/api/import/fortnox-invoices/suggestions/:id/reject", asyncHandler(async (req, res) => {
  const tenantId = await getTenantIdWithFallback(req);
  const suggestion = await storage.getFortnoxContractSuggestion(req.params.id, tenantId);
  if (!suggestion) throw new NotFoundError("Förslag hittades inte");
  const reviewerId = (req.user as { claims?: { sub?: string } } | undefined)?.claims?.sub || null;
  const updated = await storage.updateFortnoxContractSuggestion(suggestion.id, tenantId, {
    status: "rejected",
    reviewedAt: new Date(),
    reviewedBy: reviewerId,
  });
  res.json({ success: true, suggestion: updated });
}));

// Delete a whole suggestion batch (cleanup)
app.delete("/api/import/fortnox-invoices/suggestions/batch/:batchId", asyncHandler(async (req, res) => {
  const tenantId = await getTenantIdWithFallback(req);
  const removed = await storage.deleteFortnoxContractSuggestionsByBatch(tenantId, req.params.batchId);
  res.json({ success: true, removed });
}));

app.post("/api/import/customers/bulk", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }

    const csvText = req.file.buffer.toString("utf-8");
    const delimiter = csvText.includes(";") ? ";" : ",";
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true, delimiter });

    if (result.errors.length > 0) {
      throw new ValidationError("CSV-fel", { details: result.errors.slice(0, 10) });
    }

    const tenantId = getTenantIdWithFallback(req);
    let duplicateAction = "skip";
    try {
      if (req.body?.duplicateAction) duplicateAction = req.body.duplicateAction;
    } catch {}

    const existingCustomers = await storage.getCustomers(tenantId);
    const existingByName = new Map(existingCustomers.map(c => [c.name.toLowerCase(), c]));
    const existingByNumber = new Map(existingCustomers.filter(c => c.customerNumber).map(c => [c.customerNumber!.toLowerCase(), c]));

    const rows = result.data as Record<string, string>[];
    const imported: string[] = [];
    const merged: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const name = (row.namn || row.Namn || row.name || row.Name || "").trim();
        const customerNumber = (row.kundnummer || row.Kundnummer || row.customerNumber || "").trim();
        if (!name) { errors.push("Rad saknar namn"); continue; }

        const existingByNum = customerNumber ? existingByNumber.get(customerNumber.toLowerCase()) : undefined;
        const existingByN = existingByName.get(name.toLowerCase());
        const existing = existingByNum || existingByN;

        const customerData = {
          name,
          customerNumber: customerNumber || null,
          contactPerson: (row.kontakt || row.kontaktperson || row.Kontaktperson || row.contactPerson || "").trim() || null,
          email: (row["e-post"] || row.epost || row.Epost || row.email || "").trim() || null,
          phone: (row.telefon || row.Telefon || row.phone || "").trim() || null,
          address: (row.adress || row.Adress || row.address || "").trim() || null,
          city: (row.ort || row.Ort || row.stad || row.city || "").trim() || null,
          postalCode: (row.postnr || row.postnummer || row.Postnummer || row.postalCode || "").trim() || null,
        };

        if (existing) {
          if (duplicateAction === "merge") {
            const updates: Record<string, string | null> = {};
            for (const [key, val] of Object.entries(customerData)) {
              if (val && !(existing as any)[key]) {
                updates[key] = val;
              }
            }
            if (Object.keys(updates).length > 0) {
              await storage.updateCustomer(existing.id, updates);
            }
            merged.push(name);
          } else if (duplicateAction === "create") {
            await storage.createCustomer({ tenantId, ...customerData });
            imported.push(name);
          } else {
            skipped.push(name);
          }
        } else {
          await storage.createCustomer({ tenantId, ...customerData });
          imported.push(name);
        }
      } catch (err) {
        errors.push(`Kunde inte importera: ${row.namn || row.Namn || "okänd"}`);
      }
    }

    res.json({ imported: imported.length, merged: merged.length, skipped: skipped.length, errors });
}));

app.post("/api/import/metadata/bulk", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { objectIds, metadataLabel, metadataValue, method } = req.body;

    if (!objectIds || !Array.isArray(objectIds) || objectIds.length === 0) {
      throw new ValidationError("Inga objekt valda");
    }
    if (!metadataLabel || !metadataValue) {
      throw new ValidationError("Etikett och värde krävs");
    }

    let written = 0;
    const errors: string[] = [];

    for (const objectId of objectIds) {
      try {
        await createMetadata({
          tenantId,
          objektId: objectId,
          metadataTypNamn: metadataLabel,
          varde: metadataValue,
          skapadAv: "bulk-import",
          metod: method || "manuell",
        });
        written++;
      } catch (err: any) {
        errors.push(`Objekt ${objectId}: ${err.message}`);
      }
    }

    res.json({ written, errors: errors.slice(0, 50) });
}));

app.post("/api/import/metadata/csv", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }

    const csvText = req.file.buffer.toString("utf-8");
    const delimiter = csvText.includes(";") ? ";" : ",";
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true, delimiter });

    if (result.errors.length > 0) {
      throw new ValidationError("CSV-fel", { details: result.errors.slice(0, 10) });
    }

    const tenantId = getTenantIdWithFallback(req);
    const existingObjects = await storage.getObjects(tenantId);
    const objectByNumber = new Map(existingObjects.map(o => [o.objectNumber?.toLowerCase() || "", o]));
    const objectByName = new Map(existingObjects.map(o => [o.name.toLowerCase(), o]));

    const rows = result.data as Record<string, string>[];
    const metadataTypes = await getAllMetadataTypes(tenantId);
    const metadataTypeMap = buildMetadataTypeLookup(metadataTypes);

    const metadataCols = rows.length > 0
      ? Object.keys(rows[0]).filter(k => !["objektnummer", "objektnamn", "objekt", "id", "namn", "name", "objectnumber"].includes(k.toLowerCase()))
      : [];

    let written = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const objKey = (row.objektnummer || row.Objektnummer || row.id || row.Id || row.objekt || row.Objekt || "").trim();
      const objName = (row.objektnamn || row.Objektnamn || row.namn || row.Namn || row.name || "").trim();

      let obj = objKey ? objectByNumber.get(objKey.toLowerCase()) || objectByNumber.get(`modus-${objKey}`.toLowerCase()) : null;
      if (!obj && objName) obj = objectByName.get(objName.toLowerCase());

      if (!obj) {
        errors.push(`Objekt "${objKey || objName}" hittades inte`);
        continue;
      }

      for (const col of metadataCols) {
        const value = (row[col] || "").trim();
        if (!value) continue;

        try {
          let metaType = metadataTypeMap.get(col.toLowerCase());
          if (!metaType) {
            const [newType] = await db.insert(metadataKatalog).values({
              tenantId,
              namn: col,
              datatyp: "string",
              arLogisk: true,
              standardArvs: false,
              kategori: "importerad",
              area: "importerad",
              beskrivning: `Importerad via metadata-CSV`,
              sortOrder: 100,
            }).returning();
            metadataTypeMap.set(col.toLowerCase(), newType);
            metaType = newType;
          }

          await createMetadata({
            tenantId,
            objektId: obj.id,
            metadataTypNamn: metaType.namn,
            varde: value,
            skapadAv: "csv-metadata-import",
            metod: "manuell",
          });
          written++;
        } catch (err: any) {
          errors.push(`${col} för "${obj.name}": ${err.message}`);
        }
      }
    }

    res.json({ written, totalRows: rows.length, metadataColumns: metadataCols, errors: errors.slice(0, 50) });
}));

app.post("/api/import/objects/detect-duplicates", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { objectData } = req.body;

    if (!objectData || !Array.isArray(objectData)) {
      throw new ValidationError("objectData krävs som array");
    }

    const existingObjects = await storage.getObjects(tenantId);
    const existingByNumber = new Map(existingObjects.map(o => [o.objectNumber?.toLowerCase() || "", o]));
    const existingByNameAddr = new Map(existingObjects.map(o => [`${o.name.toLowerCase()}|${(o.address || "").toLowerCase()}`, o]));

    const duplicates: Array<{
      rowIndex: number;
      name: string;
      matchType: string;
      existingId: string;
      existingName: string;
      existingObjectNumber: string | null;
    }> = [];

    for (let i = 0; i < objectData.length; i++) {
      const item = objectData[i];
      const name = (item.name || "").trim();
      const objectNumber = (item.objectNumber || "").trim();
      const address = (item.address || "").trim();
      const lat = parseFloat(item.latitude) || null;
      const lng = parseFloat(item.longitude) || null;

      if (objectNumber) {
        const existing = existingByNumber.get(objectNumber.toLowerCase()) || existingByNumber.get(`modus-${objectNumber}`.toLowerCase());
        if (existing) {
          duplicates.push({ rowIndex: i, name, matchType: "objectNumber", existingId: existing.id, existingName: existing.name, existingObjectNumber: existing.objectNumber });
          continue;
        }
      }

      if (name && address) {
        const key = `${name.toLowerCase()}|${address.toLowerCase()}`;
        const existing = existingByNameAddr.get(key);
        if (existing) {
          duplicates.push({ rowIndex: i, name, matchType: "nameAddress", existingId: existing.id, existingName: existing.name, existingObjectNumber: existing.objectNumber });
          continue;
        }
      }

      if (lat && lng) {
        for (const obj of existingObjects) {
          if (obj.latitude && obj.longitude) {
            const dlat = Math.abs(obj.latitude - lat);
            const dlng = Math.abs(obj.longitude - lng);
            if (dlat < 0.0001 && dlng < 0.0001) {
              duplicates.push({ rowIndex: i, name, matchType: "gps", existingId: obj.id, existingName: obj.name, existingObjectNumber: obj.objectNumber });
              break;
            }
          }
        }
      }
    }

    res.json({ duplicates, totalChecked: objectData.length });
}));

app.get("/api/import/health-stats", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);

    const [
      totalObjectsResult,
      noCoordinatesResult,
      noAddressResult,
      noCustomerLinkResult,
      totalWorkOrdersResult,
      noResourceResult,
      totalCustomersResult,
      totalMetadataResult,
      emptyMetadataResult,
      totalInvoiceLinesResult,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` })
        .from(objects)
        .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt))),
      db.select({ count: sql<number>`count(*)::int` })
        .from(objects)
        .where(and(
          eq(objects.tenantId, tenantId),
          isNull(objects.deletedAt),
          sql`(${objects.latitude} IS NULL OR ${objects.longitude} IS NULL)`,
        )),
      db.select({ count: sql<number>`count(*)::int` })
        .from(objects)
        .where(and(
          eq(objects.tenantId, tenantId),
          isNull(objects.deletedAt),
          sql`(${objects.address} IS NULL OR ${objects.address} = '')`,
        )),
      db.select({ count: sql<number>`count(*)::int` })
        .from(objects)
        .where(and(
          eq(objects.tenantId, tenantId),
          isNull(objects.deletedAt),
          objectHasNoPrimaryCustomerSql(tenantId),
        )),
      db.select({ count: sql<number>`count(*)::int` })
        .from(workOrders)
        .where(and(eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt))),
      db.select({ count: sql<number>`count(*)::int` })
        .from(workOrders)
        .where(and(
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt),
          isNull(workOrders.resourceId),
        )),
      db.select({ count: sql<number>`count(*)::int` })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt))),
      // Task #992: kvalitetsräkningar mot kanoniska metadata_varden (ej mjuk-
      // raderade) i stället för engelska object_metadata. "Tomt" = ingen typad
      // värde-kolumn satt på en aktiv rad.
      db.select({ count: sql<number>`count(*)::int` })
        .from(metadataVarden)
        .where(and(
          eq(metadataVarden.tenantId, tenantId),
          eq(metadataVarden.raderad, false),
          eq(metadataVarden.status, "aktiv"),
          sql`${metadataVarden.objektId} IS NOT NULL`,
        )),
      db.select({ count: sql<number>`count(*)::int` })
        .from(metadataVarden)
        .where(and(
          eq(metadataVarden.tenantId, tenantId),
          eq(metadataVarden.raderad, false),
          eq(metadataVarden.status, "aktiv"),
          sql`${metadataVarden.objektId} IS NOT NULL`,
          sql`(${metadataVarden.vardeString} IS NULL OR ${metadataVarden.vardeString} = '')`,
          isNull(metadataVarden.vardeInteger),
          isNull(metadataVarden.vardeDecimal),
          isNull(metadataVarden.vardeBoolean),
          isNull(metadataVarden.vardeDatetime),
          isNull(metadataVarden.vardeJson),
          isNull(metadataVarden.vardeReferens),
        )),
      db.select({ count: sql<number>`count(*)::int` })
        .from(workOrderLines)
        .where(eq(workOrderLines.tenantId, tenantId)),
    ]);

    res.json({
      tenantId,
      totalObjects: totalObjectsResult[0]?.count || 0,
      objectsWithoutCoordinates: noCoordinatesResult[0]?.count || 0,
      objectsWithoutAddress: noAddressResult[0]?.count || 0,
      objectsWithoutCustomer: noCustomerLinkResult[0]?.count || 0,
      totalWorkOrders: totalWorkOrdersResult[0]?.count || 0,
      workOrdersWithoutResource: noResourceResult[0]?.count || 0,
      totalCustomers: totalCustomersResult[0]?.count || 0,
      totalMetadata: totalMetadataResult[0]?.count || 0,
      emptyMetadata: emptyMetadataResult[0]?.count || 0,
      totalInvoiceLines: totalInvoiceLinesResult[0]?.count || 0,
    });
}));

// ============================================
// P20: COLUMN MAPPING SUGGESTIONS
// ============================================
const SYSTEM_FIELDS: Record<string, { label: string; aliases: string[] }> = {
  name: { label: "Namn", aliases: ["namn", "name", "benämning", "benamning", "objektnamn"] },
  objectNumber: { label: "Objektnummer", aliases: ["id", "nummer", "objectnumber", "objektnummer", "modus_id", "modusid"] },
  objectType: { label: "Typ", aliases: ["typ", "type", "kategori", "objekttyp", "object_type"] },
  parentId: { label: "Parent (förälder)", aliases: ["parent", "parent_id", "förälder", "foralder", "overordnad"] },
  customerId: { label: "Kund", aliases: ["kund", "customer", "kundnamn", "customer_name", "kundnummer"] },
  address: { label: "Adress", aliases: ["adress", "address", "gatuadress", "adress 1", "adress1"] },
  city: { label: "Stad", aliases: ["stad", "city", "ort", "postort"] },
  postalCode: { label: "Postnummer", aliases: ["postnummer", "postalcode", "postal_code", "zip"] },
  latitude: { label: "Latitud", aliases: ["latitud", "latitude", "lat"] },
  longitude: { label: "Longitud", aliases: ["longitud", "longitude", "lng", "lon"] },
  description: { label: "Beskrivning", aliases: ["beskrivning", "description", "kommentar", "notering"] },
  accessInfo: { label: "Tillträdesinformation", aliases: ["tillträde", "access", "portkod", "tilltrade", "accessinfo"] },
};

app.post("/api/import/suggest-mapping", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError("Ingen fil uppladdad");
    
    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true, preview: 5 });
    
    if (!result.meta?.fields?.length) {
      throw new ValidationError("Kunde inte läsa kolumnnamn från CSV");
    }
    
    const tenantId = getTenantIdWithFallback(req);
    const metadataTypes = await getAllMetadataTypes(tenantId);
    // Task #662: case-insensitivt uppslag som även matchar punktnotation
    // (kontakt.fornamn) för metadata-familjer, utöver `namn`/`beteckning`.
    const metaLookup = buildMetadataTypeLookup(metadataTypes);
    const metaById = new Map(metadataTypes.map((m: any) => [m.id, m]));
    
    const suggestions: Array<{
      csvColumn: string;
      suggestedField: string | null;
      suggestedMetadata: string | null;
      confidence: number;
      sampleValues: string[];
    }> = [];
    
    for (const col of result.meta.fields) {
      const colLower = col.toLowerCase().trim();
      let bestField: string | null = null;
      let bestMeta: string | null = null;
      let confidence = 0;
      
      if (colLower.startsWith("metadata - ") || colLower.startsWith("metadata-")) {
        const metaName = col.replace(/^metadata\s*-\s*/i, "").trim();
        bestMeta = metaName;
        confidence = 0.95;
      } else {
        for (const [field, info] of Object.entries(SYSTEM_FIELDS)) {
          for (const alias of info.aliases) {
            if (colLower === alias || colLower.replace(/[\s_-]/g, "") === alias.replace(/[\s_-]/g, "")) {
              bestField = field;
              confidence = 1.0;
              break;
            }
          }
          if (bestField) break;
          
          for (const alias of info.aliases) {
            if (colLower.includes(alias) || alias.includes(colLower)) {
              if (!bestField || alias.length > (SYSTEM_FIELDS[bestField]?.aliases[0]?.length || 0)) {
                bestField = field;
                confidence = 0.7;
              }
            }
          }
        }
        
        if (!bestField) {
          // Matcha mot namn / punktnotation (kontakt.fornamn) via lookup, samt
          // beteckning som fallback. Punktnotation visas som förslag för underfält.
          let matchingMeta: any = metaLookup.get(colLower);
          if (!matchingMeta) {
            matchingMeta = metadataTypes.find((m: any) => m.beteckning?.toLowerCase() === colLower);
          }
          if (matchingMeta) {
            const dot = deriveMetadataDotKey(matchingMeta, metaById);
            bestMeta = dot || matchingMeta.beteckning || matchingMeta.namn;
            confidence = 0.8;
          }
        }
      }
      
      const sampleValues = (result.data as Record<string, string>[])
        .slice(0, 3)
        .map(row => row[col] || "")
        .filter(Boolean);
      
      suggestions.push({
        csvColumn: col,
        suggestedField: bestField,
        suggestedMetadata: bestMeta,
        confidence,
        sampleValues,
      });
    }
    
    res.json({ 
      columns: result.meta.fields,
      suggestions,
      availableFields: Object.entries(SYSTEM_FIELDS).map(([key, val]) => ({ key, label: val.label })),
      availableMetadataTypes: metadataTypes.map((m: any) => ({ 
        beteckning: m.beteckning, 
        name: m.name 
      })),
      previewRows: (result.data as Record<string, string>[]).slice(0, 5),
    });
}));

// P20: Save column mapping for a batch
app.post("/api/import/column-mappings", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { importColumnMappings } = await import("@shared/schema");
    const { batchId, mappings } = req.body;
    
    if (!batchId || !Array.isArray(mappings)) {
      throw new ValidationError("batchId och mappings krävs");
    }
    
    const saved = [];
    for (const m of mappings) {
      const [row] = await db.insert(importColumnMappings).values({
        tenantId,
        batchId,
        csvColumn: m.csvColumn,
        systemField: m.systemField || null,
        metadataType: m.metadataType || null,
        isIgnored: m.isIgnored || false,
      }).returning();
      saved.push(row);
    }
    
    res.json(saved);
}));

// P20: Hierarchy preview from CSV
app.post("/api/import/hierarchy-preview", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError("Ingen fil uppladdad");
    
    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const tenantId = getTenantIdWithFallback(req);
    
    const mappingStr = req.body.columnMapping;
    const columnMapping: Record<string, string> = mappingStr ? JSON.parse(mappingStr) : {};
    
    const getField = (row: Record<string, string>, field: string): string => {
      if (columnMapping[field]) return row[columnMapping[field]] || "";
      const aliases = SYSTEM_FIELDS[field]?.aliases || [];
      for (const alias of aliases) {
        for (const col of Object.keys(row)) {
          if (col.toLowerCase().trim() === alias) return row[col] || "";
        }
      }
      return "";
    };
    
    interface TreeNode {
      id: string;
      name: string;
      parentId: string;
      children: TreeNode[];
      rowIndex: number;
      hasParentMatch: boolean;
      isExistingInDb: boolean;
    }
    
    const rows = result.data as Record<string, string>[];
    const nodeMap = new Map<string, TreeNode>();
    const allIds = new Set<string>();
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = getField(row, "objectNumber") || getField(row, "name") || `row-${i}`;
      const name = getField(row, "name") || id;
      const parentId = getField(row, "parentId") || "";
      
      allIds.add(id);
      nodeMap.set(id, {
        id,
        name,
        parentId,
        children: [],
        rowIndex: i + 1,
        hasParentMatch: true,
        isExistingInDb: false,
      });
    }
    
    const existingObjects = await db.select({ objectNumber: objects.objectNumber, id: objects.id })
      .from(objects)
      .where(eq(objects.tenantId, tenantId));
    const existingIds = new Set(existingObjects.map(o => o.objectNumber).filter(Boolean));
    
    for (const node of nodeMap.values()) {
      if (node.parentId && !allIds.has(node.parentId) && !existingIds.has(node.parentId)) {
        node.hasParentMatch = false;
      }
      if (existingIds.has(node.id)) {
        node.isExistingInDb = true;
      }
    }
    
    const roots: TreeNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    
    const orphanCount = Array.from(nodeMap.values()).filter(n => !n.hasParentMatch && n.parentId).length;
    const updateCount = Array.from(nodeMap.values()).filter(n => n.isExistingInDb).length;
    
    res.json({
      tree: roots,
      totalRows: rows.length,
      orphanCount,
      updateCount,
      newCount: rows.length - updateCount,
    });
}));

// P20: Batch rollback (soft delete)
app.post("/api/import/rollback/:batchId", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { batchId } = req.params;
    const { importBatches } = await import("@shared/schema");
    
    const [batch] = await db.select().from(importBatches)
      .where(and(eq(importBatches.batchId, batchId), eq(importBatches.tenantId, tenantId)));
    if (!batch) throw new NotFoundError("Import-batch hittades inte");

    // Cleanup-batches får INTE rollas tillbaka via delete — de hanteras av separat restore-endpoint
    if (batchId.startsWith("cleanup-")) {
      throw new ValidationError("Sanering-batches kan inte ångras via radering. Använd 'Återställ sanering' istället för att läsa tillbaka från audit-loggen.");
    }
    // Enrich-modus-batches får INTE heller rollas tillbaka via delete — de skapar inga objekt,
    // bara metadata-värden. Använd /api/import/enrich-modus/restore/:batchId.
    if (batchId.startsWith("enrich-modus-")) {
      throw new ValidationError("Berikning-batches kan inte ångras via radering. Använd 'Återställ berikning' istället för att återskapa metadata från audit-loggen.");
    }
    
    const deletedObjects = await db.execute(sql`
      UPDATE objects SET deleted_at = NOW(), status = 'deleted'
      WHERE import_batch_id = ${batchId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
      RETURNING id
    `);
    
    const deletedOrders = await db.execute(sql`
      UPDATE work_orders SET deleted_at = NOW(), status = 'avbruten'
      WHERE import_batch_id = ${batchId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
      RETURNING id
    `);
    
    const deletedCustomers = await db.execute(sql`
      UPDATE customers SET is_active = false, deleted_at = NOW()
      WHERE import_batch_id = ${batchId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
      RETURNING id
    `);

    // Task #569: invoice_recipients importeras via /api/invoice-recipients/import
    // och stämplas med import_batch_id; de har deleted_at och soft-deletas så
    // ev. frusna WO som refererar id:t behåller läsbar historik.
    // (object_payers är borttagen i Etapp 5 — kund bärs av Ekonomi-metadatat.)
    const deletedRecipients = await db.execute(sql`
      UPDATE invoice_recipients SET deleted_at = NOW()
      WHERE import_batch_id = ${batchId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
      RETURNING id
    `);

    const recipientIds = ((deletedRecipients as any).rows || deletedRecipients).map((r: any) => r.id);
    const userId = (req as any).user?.id ?? null;
    const auditEntries: any[] = [];
    for (const id of recipientIds) {
      auditEntries.push({
        tenantId, userId, action: "rollback_import", resourceType: "invoice_recipients", resourceId: id,
        changes: { before: { rolledBack: false }, after: { rolledBack: true, softDeleted: true } },
        metadata: { batchId, source: "import-rollback", batchType: "invoice-recipients" },
      });
    }
    if (auditEntries.length > 0) {
      await db.insert(auditLogs).values(auditEntries);
    }

    await db.update(importBatches)
      .set({ metadata: sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{rolledBack}', 'true')` })
      .where(eq(importBatches.batchId, batchId));
    
    res.json({
      success: true,
      rolledBack: {
        objects: (deletedObjects.rows || deletedObjects).length,
        workOrders: (deletedOrders.rows || deletedOrders).length,
        customers: (deletedCustomers.rows || deletedCustomers).length,
        invoiceRecipients: recipientIds.length,
      },
    });
}));

// P20: Import with custom column mapping
app.post("/api/import/modus/objects-mapped", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError("Ingen fil uppladdad");
    
    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const tenantId = getTenantIdWithFallback(req);
    
    const mappingStr = req.body.columnMapping;
    const columnMapping: Record<string, string> = mappingStr ? JSON.parse(mappingStr) : {};
    
    const getVal = (row: Record<string, string>, field: string): string => {
      if (columnMapping[field]) return row[columnMapping[field]] || "";
      const aliases = SYSTEM_FIELDS[field]?.aliases || [];
      for (const alias of aliases) {
        for (const col of Object.keys(row)) {
          if (col.toLowerCase().trim() === alias) return row[col] || "";
        }
      }
      return "";
    };
    
    const batchId = `mapped-${Date.now()}`;
    const rows = result.data as Record<string, string>[];
    const imported: string[] = [];
    const errors: Array<{ row: number; column: string; error: string }> = [];
    
    const metadataMappings = Object.entries(columnMapping)
      .filter(([key]) => key.startsWith("meta:"))
      .map(([key, csvCol]) => ({ metaType: key.replace("meta:", ""), csvCol }));
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const name = getVal(row, "name");
        if (!name) {
          errors.push({ row: i + 2, column: "name", error: "Namn saknas" });
          continue;
        }
        
        const customerName = getVal(row, "customerId") || "";
        let customerId: string | null = null;
        if (customerName) {
          const [existingCustomer] = await db.select().from(customers)
            .where(and(eq(customers.tenantId, tenantId), eq(customers.name, customerName)));
          if (existingCustomer) {
            customerId = existingCustomer.id;
          } else {
            const [newCustomer] = await db.insert(customers).values({
              tenantId,
              name: customerName,
              importBatchId: batchId,
            }).returning();
            customerId = newCustomer.id;
          }
        }
        
        if (!customerId) {
          const [defaultCustomer] = await db.select().from(customers)
            .where(eq(customers.tenantId, tenantId));
          if (defaultCustomer) {
            customerId = defaultCustomer.id;
          } else {
            errors.push({ row: i + 2, column: "customerName", error: "Ingen kund hittades eller angiven" });
            continue;
          }
        }
        
        const objData: any = {
          tenantId,
          customerId,
          name,
          objectNumber: getVal(row, "objectNumber") || null,
          objectType: getVal(row, "objectType") || getVal(row, "type") || "omrade",
          address: getVal(row, "address") || null,
          city: getVal(row, "city") || null,
          postalCode: getVal(row, "postalCode") || null,
          latitude: getVal(row, "latitude") ? parseFloat(getVal(row, "latitude")) : null,
          longitude: getVal(row, "longitude") ? parseFloat(getVal(row, "longitude")) : null,
          description: getVal(row, "description") || null,
          importBatchId: batchId,
        };
        
        const existing = objData.objectNumber 
          ? await db.select().from(objects).where(and(
              eq(objects.tenantId, tenantId),
              eq(objects.objectNumber, objData.objectNumber)
            ))
          : [];
        
        let objId: string;
        if (existing.length > 0) {
          await db.update(objects).set(objData).where(eq(objects.id, existing[0].id));
          objId = existing[0].id;
        } else {
          const [created] = await db.insert(objects).values(objData).returning();
          objId = created.id;
        }
        
        for (const mm of metadataMappings) {
          const val = row[mm.csvCol];
          if (val) {
            await createMetadata(tenantId, mm.metaType, objId, val);
          }
        }
        
        imported.push(name);
      } catch (err: any) {
        errors.push({ row: i + 2, column: "", error: err.message || "Okänt fel" });
      }
    }
    
    const { importBatches } = await import("@shared/schema");
    await db.insert(importBatches).values({
      tenantId,
      batchId,
      totalRows: rows.length,
      created: imported.length,
      updated: 0,
      errors: errors.length,
      metadata: { source: "mapped-import", mappings: columnMapping },
    });
    
    res.json({
      batchId,
      imported: imported.length,
      errors,
      total: rows.length,
    });
}));

// P20: Import history with rollback status.
// Stödjer filtrering på importType (per panel) och limit (Task #574 — varje
// importpanel visar bara de senaste N körningarna för sin egen typ, så
// Modus-objekt och Fortnox-kunder inte blandas ihop).
app.get("/api/import/history", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { importBatches } = await import("@shared/schema");

    const importType = typeof req.query.importType === "string" ? req.query.importType.trim() : "";
    const rawLimit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 50;

    // Fortnox-fakturaexport saknar import_batches-rader (varje export är
    // per-WO). Vi syntetiserar batches per dag från fortnox_invoice_exports
    // så historikpanelen kan visa "denna dagens export" och trend mot förra.
    if (importType === "fortnox-invoices") {
      const { fortnoxInvoiceExports } = await import("@shared/schema");
      const rows = await db.select({
        day: sql<string>`to_char(${fortnoxInvoiceExports.createdAt} AT TIME ZONE 'Europe/Stockholm', 'YYYY-MM-DD')`,
        total: sql<number>`count(*)::int`,
        exported: sql<number>`sum(case when ${fortnoxInvoiceExports.status} = 'exported' then 1 else 0 end)::int`,
        failed: sql<number>`sum(case when ${fortnoxInvoiceExports.status} = 'failed' then 1 else 0 end)::int`,
        cancelled: sql<number>`sum(case when ${fortnoxInvoiceExports.status} = 'cancelled' then 1 else 0 end)::int`,
        pending: sql<number>`sum(case when ${fortnoxInvoiceExports.status} = 'pending' then 1 else 0 end)::int`,
        latestAt: sql<string>`max(${fortnoxInvoiceExports.createdAt})`,
      })
        .from(fortnoxInvoiceExports)
        .where(eq(fortnoxInvoiceExports.tenantId, tenantId))
        .groupBy(sql`to_char(${fortnoxInvoiceExports.createdAt} AT TIME ZONE 'Europe/Stockholm', 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${fortnoxInvoiceExports.createdAt} AT TIME ZONE 'Europe/Stockholm', 'YYYY-MM-DD') DESC`)
        .limit(limit);

      const synthesized = rows.map((r: any) => ({
        id: `fortnox-invoices-${r.day}`,
        batchId: `fortnox-invoices-${r.day}`,
        totalRows: r.total,
        created: r.exported,
        updated: 0,
        errors: r.failed,
        createdAt: r.latestAt,
        startedByName: null,
        metadata: {
          type: "fortnox-invoices",
          status: r.pending > 0 ? "in_progress"
                : r.failed > 0 ? "completed_with_errors"
                : r.cancelled > 0 && r.exported === 0 ? "aborted"
                : "completed",
          day: r.day,
          pending: r.pending,
          cancelled: r.cancelled,
        },
      }));
      res.json(synthesized);
      return;
    }

    // importType-filtret matchar både metadata.type och äldre batchId-prefix
    // (kfl-, enrich-modus-, cleanup-, fortnox-) så historik från innan vi
    // började stämpla metadata.type fortfarande hittas.
    const typeFilter = importType
      ? sql`(${importBatches.metadata}->>'type' = ${importType}
              OR (${importType} = 'customer-fastighetslista' AND ${importBatches.batchId} LIKE 'kfl-%')
              OR (${importType} = 'enrich-modus' AND ${importBatches.batchId} LIKE 'enrich-modus-%')
              OR (${importType} = 'cleanup' AND ${importBatches.batchId} LIKE 'cleanup-%')
              OR (${importType} = 'fortnox-customers' AND ${importBatches.batchId} LIKE 'fortnox-%'))`
      : undefined;

    const batches = await db.select().from(importBatches)
      .where(typeFilter ? and(eq(importBatches.tenantId, tenantId), typeFilter) : eq(importBatches.tenantId, tenantId))
      .orderBy(desc(importBatches.createdAt))
      .limit(limit);

    // Berika rader med användarnamn (slå upp en gång i batch) så historiklistan
    // kan visa "Anna Andersson" istället för bara user-id.
    const userIds = Array.from(new Set(
      batches
        .map(b => {
          const m = (b.metadata as any) || {};
          return typeof m.startedBy === "string" ? m.startedBy : null;
        })
        .filter((v): v is string => !!v)
    ));
    let userNameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { users } = await import("@shared/schema");
      const userRows = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      }).from(users).where(inArray(users.id, userIds));
      for (const u of userRows) {
        const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || u.id;
        userNameMap.set(u.id, name);
      }
    }
    const enriched = batches.map(b => {
      const m = (b.metadata as any) || {};
      const startedBy = typeof m.startedBy === "string" ? m.startedBy : null;
      return {
        ...b,
        startedByName: startedBy ? (userNameMap.get(startedBy) || null) : null,
      };
    });

    res.json(enriched);
}));

app.get("/api/import/data-quality", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);

    const [noCoords] = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(and(eq(objects.tenantId, tenantId), sql`(${objects.latitude} IS NULL OR ${objects.longitude} IS NULL)`));
    const [noAddress] = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(and(eq(objects.tenantId, tenantId), sql`(${objects.address} IS NULL OR ${objects.address} = '')`));
    const [noParent] = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(and(eq(objects.tenantId, tenantId), isNull(objects.parentId), sql`${objects.objectLevel} > 1`));
    const [totalObjects] = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(eq(objects.tenantId, tenantId));
    const [custNoAddr] = await db.select({ count: sql<number>`count(*)` }).from(customers)
      .where(and(eq(customers.tenantId, tenantId), sql`(${customers.address} IS NULL OR ${customers.address} = '')`));
    const [totalCustomers] = await db.select({ count: sql<number>`count(*)` }).from(customers)
      .where(eq(customers.tenantId, tenantId));
    const [woNoResource] = await db.select({ count: sql<number>`count(*)` }).from(workOrders)
      .where(and(eq(workOrders.tenantId, tenantId), isNull(workOrders.resourceId), isNull(workOrders.deletedAt)));
    const [totalWo] = await db.select({ count: sql<number>`count(*)` }).from(workOrders)
      .where(and(eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt)));
    const [woPastStillCreated] = await db.select({ count: sql<number>`count(*)` }).from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt),
        eq(workOrders.orderStatus, "skapad"),
        sql`${workOrders.scheduledDate} < NOW()`,
      ));
    const [woNoDateCreated] = await db.select({ count: sql<number>`count(*)` }).from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt),
        eq(workOrders.orderStatus, "skapad"),
        isNull(workOrders.scheduledDate),
      ));

    // Namn-skräp på kärl-nivå (Task #240)
    const karlBase = and(
      eq(objects.tenantId, tenantId),
      isNull(objects.deletedAt),
      eq(objects.hierarchyLevel, "karl"),
    );
    const [karlTotal] = await db.select({ count: sql<number>`count(*)` }).from(objects).where(karlBase);
    const [karlPhone] = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(and(karlBase, sql`${objects.name} ~ '^[\\d\\s\\-+()]{6,}$'`));
    const [karlNumeric] = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(and(karlBase, sql`${objects.name} ~ '^\\d{1,5}$'`));
    const [karlPerson] = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(and(karlBase, sql`${objects.name} ~ '^[A-ZÅÄÖ][a-zåäöé]+ [A-ZÅÄÖ][a-zåäöé]+$'`));
    const [karlInstruction] = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(and(karlBase, sql`${objects.name} ~* '(ring|kontakta|fastighetssk|skicka|tillträde|innan|nyckel|portkod|hämta)'`));

    // Kärl-scopade kvalitetsstats (Task #240) — visar saneringens faktiska påverkan
    const [karlNoAddress] = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(and(karlBase, sql`(${objects.address} IS NULL OR ${objects.address} = '')`));
    const [karlNoParent] = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(and(karlBase, isNull(objects.parentId)));
    const [karlNoCoords] = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(and(karlBase, sql`(${objects.latitude} IS NULL OR ${objects.longitude} IS NULL)`));

    res.json({
      objects: {
        total: Number(totalObjects.count),
        missingCoordinates: Number(noCoords.count),
        missingAddress: Number(noAddress.count),
        missingParent: Number(noParent.count),
      },
      customers: {
        total: Number(totalCustomers.count),
        missingAddress: Number(custNoAddr.count),
      },
      workOrders: {
        total: Number(totalWo.count),
        missingResource: Number(woNoResource.count),
        pastStillCreated: Number(woPastStillCreated.count),
        noDateStillCreated: Number(woNoDateCreated.count),
      },
      containerNames: {
        total: Number(karlTotal.count),
        phone: Number(karlPhone.count),
        person: Number(karlPerson.count),
        instruction: Number(karlInstruction.count),
        numeric: Number(karlNumeric.count),
      },
      containers: {
        total: Number(karlTotal.count),
        missingAddress: Number(karlNoAddress.count),
        missingParent: Number(karlNoParent.count),
        missingCoordinates: Number(karlNoCoords.count),
      },
    });
}));

app.post("/api/import/repair/hierarchy", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);

    const orphanCount = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(and(eq(objects.tenantId, tenantId), isNull(objects.parentId), sql`${objects.objectLevel} > 1`));

    const totalCount = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(eq(objects.tenantId, tenantId));

    const alreadyLinkedCount = await db.select({ count: sql<number>`count(*)` }).from(objects)
      .where(and(eq(objects.tenantId, tenantId), isNotNull(objects.parentId)));

    res.json({
      orphans: Number(orphanCount[0].count),
      alreadyLinked: Number(alreadyLinkedCount[0].count),
      total: Number(totalCount[0].count),
      message: "Ladda upp objektfilen (CSV) med Parent-kolumnen för att bygga hierarkin.",
    });
}));

app.post("/api/import/repair/hierarchy-csv", requireAdmin, upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }

    const tenantId = getTenantIdWithFallback(req);
    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true, delimiter: ";" });

    if (result.errors.length > 0) {
      throw new ValidationError("CSV-fel", { details: result.errors.slice(0, 10) });
    }

    const allObjects = await db.select({
      id: objects.id,
      objectNumber: objects.objectNumber,
      parentId: objects.parentId,
    }).from(objects).where(eq(objects.tenantId, tenantId));

    const modusIdToDbId = new Map<string, string>();
    for (const obj of allObjects) {
      if (obj.objectNumber) {
        modusIdToDbId.set(obj.objectNumber, obj.id);
        if (obj.objectNumber.startsWith("MODUS-")) {
          modusIdToDbId.set(obj.objectNumber.replace("MODUS-", ""), obj.id);
        } else {
          modusIdToDbId.set("MODUS-" + obj.objectNumber, obj.id);
        }
      }
    }

    const firstRow = (result.data as Record<string, string>[])[0];
    if (!firstRow || !("Id" in firstRow) || !("Parent" in firstRow)) {
      throw new ValidationError("CSV måste ha kolumnerna 'Id' och 'Parent'", {
        columns: firstRow ? Object.keys(firstRow) : [],
      });
    }

    const objectIdToObj = new Map(allObjects.map(o => [o.id, o]));

    let linked = 0;
    let parentNotFound = 0;
    let noParentColumn = 0;
    let alreadyLinked = 0;
    const rows = result.data as Record<string, string>[];

    for (const row of rows) {
      const rawId = (row["Id"] || "").replace(/\s/g, "");
      const rawParent = (row["Parent"] || "").replace(/\s/g, "");

      if (!rawId || !rawParent) { noParentColumn++; continue; }

      const objectId = modusIdToDbId.get(rawId);
      const parentId = modusIdToDbId.get(rawParent);

      if (!objectId) { parentNotFound++; continue; }

      const existingObj = objectIdToObj.get(objectId);
      if (existingObj?.parentId) { alreadyLinked++; continue; }

      if (parentId) {
        await db.update(objects).set({ parentId }).where(eq(objects.id, objectId));
        linked++;
      } else {
        parentNotFound++;
      }
    }

    res.json({ linked, parentNotFound, noParentColumn, alreadyLinked, total: rows.length });
}));

app.post("/api/import/repair/geocode", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const parsedLimit = parseInt(req.body?.limit || "200");
    const limit = Math.min(Number.isNaN(parsedLimit) ? 200 : parsedLimit, 500);

    const objectsToGeocode = await db.select({
      id: objects.id,
      address: objects.address,
      city: objects.city,
      name: objects.name,
    }).from(objects).where(and(
      eq(objects.tenantId, tenantId),
      sql`(${objects.latitude} IS NULL OR ${objects.longitude} IS NULL)`,
      sql`${objects.address} IS NOT NULL AND ${objects.address} != ''`,
    )).limit(limit);

    let geocoded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const obj of objectsToGeocode) {
      try {
        const fullAddress = obj.city
          ? `${obj.address}, ${obj.city}, Sverige`
          : `${obj.address}, Sverige`;

        const geoResult = await getMapProvider().geocode(fullAddress, tenantId);
        if (geoResult && geoResult.latitude && geoResult.longitude) {
          await db.update(objects).set({
            latitude: geoResult.latitude,
            longitude: geoResult.longitude,
          }).where(eq(objects.id, obj.id));
          geocoded++;
        } else {
          failed++;
        }

        await new Promise(r => setTimeout(r, 200));
      } catch (err: any) {
        failed++;
        errors.push(`${obj.name}: ${err.message}`);
      }
    }

    res.json({ geocoded, failed, total: objectsToGeocode.length, errors: errors.slice(0, 20) });
}));

app.get("/api/import/data-quality/details", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const issueType = req.query.type as string;
    const page = parseInt(req.query.page as string || "1");
    const pageSize = Math.min(parseInt(req.query.pageSize as string || "50"), 100);
    const offset = (page - 1) * pageSize;

    if (issueType === "missing-coordinates") {
      const rows = await db.select({
        id: objects.id, name: objects.name, objectNumber: objects.objectNumber,
        address: objects.address, city: objects.city, objectType: objects.objectType,
      }).from(objects).where(and(
        eq(objects.tenantId, tenantId),
        sql`(${objects.latitude} IS NULL OR ${objects.longitude} IS NULL)`,
      )).limit(pageSize).offset(offset);
      res.json({ rows, page, pageSize });
    } else if (issueType === "missing-address") {
      const rows = await db.select({
        id: objects.id, name: objects.name, objectNumber: objects.objectNumber,
        address: objects.address, city: objects.city,
        latitude: objects.latitude, longitude: objects.longitude, objectType: objects.objectType,
      }).from(objects).where(and(
        eq(objects.tenantId, tenantId),
        sql`(${objects.address} IS NULL OR ${objects.address} = '')`,
      )).limit(pageSize).offset(offset);
      res.json({ rows, page, pageSize });
    } else if (issueType === "missing-parent") {
      const rows = await db.select({
        id: objects.id, name: objects.name, objectNumber: objects.objectNumber,
        objectLevel: objects.objectLevel, objectType: objects.objectType,
      }).from(objects).where(and(
        eq(objects.tenantId, tenantId),
        isNull(objects.parentId),
        sql`${objects.objectLevel} > 1`,
      )).limit(pageSize).offset(offset);
      res.json({ rows, page, pageSize });
    } else if (issueType === "customer-missing-address") {
      const rows = await db.select({
        id: customers.id, name: customers.name,
      }).from(customers).where(and(
        eq(customers.tenantId, tenantId),
        sql`(${customers.address} IS NULL OR ${customers.address} = '')`,
      )).limit(pageSize).offset(offset);
      res.json({ rows, page, pageSize });
    } else {
      res.json({ rows: [], page, pageSize });
    }
}));

app.patch("/api/import/data-quality/object/:id", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const objectId = req.params.id;
    const { address, city, latitude, longitude } = req.body;

    const [existing] = await db.select({ id: objects.id }).from(objects)
      .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));

    if (!existing) {
      throw new NotFoundError("Objektet hittades inte");
    }

    const updates: Record<string, string | number | null> = {};
    if (address !== undefined) updates.address = address;
    if (city !== undefined) updates.city = city;
    if (latitude !== undefined) {
      const lat = latitude !== null ? Number(latitude) : null;
      if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) {
        throw new ValidationError("Ogiltig latitud (måste vara -90 till 90)");
      }
      updates.latitude = lat;
    }
    if (longitude !== undefined) {
      const lng = longitude !== null ? Number(longitude) : null;
      if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) {
        throw new ValidationError("Ogiltig longitud (måste vara -180 till 180)");
      }
      updates.longitude = lng;
    }

    if (Object.keys(updates).length === 0) {
      throw new ValidationError("Inga fält att uppdatera");
    }

    await db.update(objects).set(updates).where(eq(objects.id, objectId));
    res.json({ updated: true });
}));

app.post("/api/import/repair/work-order-status", requireAdmin, asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);

    const [pastWithDate] = await db.select({ count: sql<number>`count(*)` }).from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        isNull(workOrders.deletedAt),
        eq(workOrders.orderStatus, "skapad"),
        sql`${workOrders.scheduledDate} < NOW()`,
      ));

    const [noDate] = await db.select({ count: sql<number>`count(*)` }).from(workOrders)
      .where(and(
        eq(workOrders.tenantId, tenantId),
        isNull(workOrders.deletedAt),
        eq(workOrders.orderStatus, "skapad"),
        isNull(workOrders.scheduledDate),
      ));

    const pastCount = Number(pastWithDate.count);
    const noDateCount = Number(noDate.count);

    const result1 = await db.update(workOrders).set({
      orderStatus: "utford",
      completedAt: sql`COALESCE(${workOrders.scheduledDate}, NOW())`,
    }).where(and(
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      eq(workOrders.orderStatus, "skapad"),
      sql`${workOrders.scheduledDate} < NOW()`,
    ));

    const result2 = await db.update(workOrders).set({
      orderStatus: "utford",
      completedAt: sql`NOW()`,
    }).where(and(
      eq(workOrders.tenantId, tenantId),
      isNull(workOrders.deletedAt),
      eq(workOrders.orderStatus, "skapad"),
      isNull(workOrders.scheduledDate),
    ));

    if (pastCount > 0 || noDateCount > 0) {
      invalidateWorkflowCaches(tenantId);
    }

    res.json({
      pastOrdersUpdated: pastCount,
      noDateOrdersUpdated: noDateCount,
      totalUpdated: pastCount + noDateCount,
    });
}));

// ============================================================
// SANERING — Task #240: Namn-rensning, föräldra-koppling, adress-backfill
// Alla endpoints följer dryrun (preview) + commit (apply) mönster
// med audit-logg och eget importBatchId så det går att rollback
// ============================================================

type ContaminationKind = "phone" | "person" | "instruction" | "numeric";

function classifyName(name: string): ContaminationKind | null {
  const trimmed = (name || "").trim();
  if (!trimmed) return null;
  if (/^[\d\s\-+()]{6,}$/.test(trimmed)) return "phone";
  if (/^\d{1,5}$/.test(trimmed)) return "numeric";
  if (/^[A-ZÅÄÖ][a-zåäöé]+ [A-ZÅÄÖ][a-zåäöé]+$/.test(trimmed)) return "person";
  if (/(ring|kontakta|fastighetssk|skicka|tillträde|innan|nyckel|portkod|hämta)/i.test(trimmed)) return "instruction";
  return null;
}

function suggestNewName(obj: { address: string | null; objectNumber: string | null; parentName?: string | null }): string {
  if (obj.address) return `Kärl – ${obj.address}`;
  if (obj.parentName) return `Kärl – ${obj.parentName}`;
  if (obj.objectNumber) return `Kärl ${obj.objectNumber}`;
  return "Kärl (namn saknas)";
}

// Steg 2: Namn-rensning — preview
app.get("/api/import/cleanup/names/preview", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const kindFilter = (req.query.kind as string) || "all";
  const limit = Math.min(parseInt((req.query.limit as string) || "200"), 1000);

  const candidates = await db.select({
    id: objects.id,
    name: objects.name,
    objectNumber: objects.objectNumber,
    address: objects.address,
    parentId: objects.parentId,
  }).from(objects).where(and(
    eq(objects.tenantId, tenantId),
    isNull(objects.deletedAt),
    eq(objects.hierarchyLevel, "karl"),
    sql`(${objects.name} ~ '^[\\d\\s\\-+()]{6,}$' OR ${objects.name} ~ '^\\d{1,5}$' OR ${objects.name} ~ '^[A-ZÅÄÖ][a-zåäöé]+ [A-ZÅÄÖ][a-zåäöé]+$' OR ${objects.name} ~* '(ring|kontakta|fastighetssk|skicka|tillträde|innan|nyckel|portkod|hämta)')`,
  )).limit(limit);

  const parentIds = Array.from(new Set(candidates.map(c => c.parentId).filter((p): p is string => !!p)));
  const parentRows = parentIds.length > 0
    ? await db.select({ id: objects.id, name: objects.name, address: objects.address })
        .from(objects).where(and(
          eq(objects.tenantId, tenantId),
          inArray(objects.id, parentIds),
          isNull(objects.deletedAt),
        ))
    : [];
  const parentMap = new Map(parentRows.map(p => [p.id, p]));

  const proposals = candidates.map(c => {
    const kind = classifyName(c.name);
    if (!kind) return null;
    if (kindFilter !== "all" && kindFilter !== kind) return null;
    const parent = c.parentId ? parentMap.get(c.parentId) : null;
    // Etapp 5: specialkolumnerna accessInfo/notes borttagna — all flyttad
    // information hamnar i metadatafältet 'Åtkomstinfo'.
    const targetField = kind === "phone" || kind === "person" || kind === "instruction"
      ? "metadata.Åtkomstinfo"
      : "discard";
    return {
      id: c.id,
      kind,
      currentName: c.name,
      objectNumber: c.objectNumber,
      address: c.address,
      parentName: parent?.name || null,
      suggestedName: suggestNewName({ address: c.address, objectNumber: c.objectNumber, parentName: parent?.name }),
      moveTo: targetField,
    };
  }).filter((p): p is NonNullable<typeof p> => p !== null);

  res.json({
    total: proposals.length,
    proposals,
    truncated: candidates.length === limit,
  });
}));

// Steg 2: Namn-rensning — commit (transaktionellt + state-guard)
app.post("/api/import/cleanup/names/apply", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const userId = (req as any).user?.id || null;
  const rawIds: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = Array.from(new Set(rawIds.filter(x => typeof x === "string" && x.length > 0)));
  if (ids.length === 0) throw new ValidationError("Inga objekt valda");
  if (ids.length > 5000) throw new ValidationError("Max 5000 objekt per körning");

  const batchId = `cleanup-names-${Date.now()}`;

  const result = await db.transaction(async (tx) => {
    // Hämta endast kärl tillhörande denna tenant — låser raderna under transaktionen
    const targets = await tx.select({
      id: objects.id, name: objects.name, objectNumber: objects.objectNumber,
      address: objects.address, parentId: objects.parentId,
    }).from(objects).where(and(
      eq(objects.tenantId, tenantId),
      eq(objects.hierarchyLevel, "karl"),
      inArray(objects.id, ids),
      isNull(objects.deletedAt),
    ));

    const parentIds = Array.from(new Set(targets.map(t => t.parentId).filter((p): p is string => !!p)));
    const parentRows = parentIds.length > 0
      ? await tx.select({ id: objects.id, name: objects.name })
          .from(objects).where(and(
            eq(objects.tenantId, tenantId),
            inArray(objects.id, parentIds),
          ))
      : [];
    const parentMap = new Map(parentRows.map(p => [p.id, p.name]));

    const auditEntries: any[] = [];
    // Etapp 5: flyttad info skrivs som metadata ('Åtkomstinfo') EFTER commit —
    // metadata-skrivaren får aldrig tx-wrappas.
    const metadataWrites: { objectId: string; text: string }[] = [];
    let updated = 0;
    let skipped = 0;

    for (const t of targets) {
      const kind = classifyName(t.name);
      if (!kind) { skipped++; continue; }

      const parentName = t.parentId ? parentMap.get(t.parentId) || null : null;
      const newName = suggestNewName({ address: t.address, objectNumber: t.objectNumber, parentName });
      const updates: Record<string, any> = { name: newName, importBatchId: batchId };

      if (kind === "phone" || kind === "person" || kind === "instruction") {
        metadataWrites.push({ objectId: t.id, text: t.name });
      }

      // State-guard: uppdatera bara om namnet är oförändrat sedan vi läste det
      const upd = await tx.update(objects).set(updates).where(and(
        eq(objects.id, t.id),
        eq(objects.tenantId, tenantId),
        eq(objects.hierarchyLevel, "karl"),
        eq(objects.name, t.name),
        isNull(objects.deletedAt),
      )).returning({ id: objects.id });

      if (upd.length === 0) { skipped++; continue; }

      auditEntries.push({
        tenantId, userId, action: "cleanup_names", resourceType: "objects", resourceId: t.id,
        changes: {
          before: { name: t.name },
          after: { name: newName, kind, moveTo: "metadata.Åtkomstinfo" },
        },
        metadata: { batchId, source: "cleanup-names" },
      });
      updated++;
    }

    if (auditEntries.length > 0) {
      await tx.insert(auditLogs).values(auditEntries);
    }

    await tx.insert(importBatches).values({
      tenantId, batchId, totalRows: targets.length, created: 0, updated, errors: 0,
      metadata: { source: "cleanup-names", userId, skipped },
    });

    return { updated, skipped, total: targets.length, metadataWrites };
  });

  // Etapp 5: skriv flyttad info som metadata EFTER commit (best-effort, aldrig i tx).
  for (const mw of result.metadataWrites) {
    try {
      await writeSystemMetadataOnObject(mw.objectId, "Åtkomstinfo", mw.text, tenantId, "import");
    } catch (err) {
      console.error(`[cleanup-names] metadata-skrivning misslyckades för ${mw.objectId}:`, err);
    }
  }
  const { metadataWrites: _mw, ...summary } = result;

  res.json({ batchId, ...summary });
}));

// Steg 3: Föräldra-koppling — preview (förslag baserat på samma kund + adress + koordinat)
app.get("/api/import/cleanup/parents/preview", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const limit = Math.min(parseInt((req.query.limit as string) || "200"), 1000);

  const orphans = await db.select({
    id: objects.id, name: objects.name, customerId: primaryPayerCustomerIdSql(),
    address: objects.address, city: objects.city,
    latitude: objects.latitude, longitude: objects.longitude,
  }).from(objects).where(and(
    eq(objects.tenantId, tenantId),
    isNull(objects.deletedAt),
    eq(objects.hierarchyLevel, "karl"),
    isNull(objects.parentId),
  )).limit(limit);

  // Hämta alla möjliga föräldra-kandidater (rum) per kund
  const customerIds = Array.from(new Set(orphans.map(o => o.customerId).filter((c): c is string => !!c)));
  const candidates = customerIds.length > 0
    ? await db.select({
        id: objects.id, name: objects.name, customerId: primaryPayerCustomerIdSql(),
        address: objects.address, city: objects.city,
        latitude: objects.latitude, longitude: objects.longitude,
      }).from(objects).where(and(
        eq(objects.tenantId, tenantId),
        isNull(objects.deletedAt),
        objectPrimaryCustomerInSql(customerIds),
        sql`${objects.hierarchyLevel} IN ('rum','fastighet','brf')`,
      ))
    : [];

  const candidatesByCustomer = new Map<string, typeof candidates>();
  for (const c of candidates) {
    if (!c.customerId) continue;
    const list = candidatesByCustomer.get(c.customerId) || [];
    list.push(c);
    candidatesByCustomer.set(c.customerId, list);
  }

  const norm = (s: string | null) => (s || "").toLowerCase().replace(/[^\wåäö]/g, " ").replace(/\s+/g, " ").trim();
  const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371, toRad = (x: number) => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  const proposals = orphans.map(o => {
    const pool = candidatesByCustomer.get(o.customerId || "") || [];
    if (pool.length === 0) return null;
    const orphanAddr = norm(o.address);
    const scored = pool.map(p => {
      let score = 0;
      const reasons: string[] = [];
      if (orphanAddr && norm(p.address) && norm(p.address) === orphanAddr) {
        score += 100; reasons.push("samma adress");
      } else if (orphanAddr && norm(p.address) && (norm(p.address).includes(orphanAddr) || orphanAddr.includes(norm(p.address)))) {
        score += 60; reasons.push("liknande adress");
      }
      if (o.latitude && o.longitude && p.latitude && p.longitude) {
        const dist = haversineKm(o.latitude, o.longitude, p.latitude, p.longitude);
        if (dist < 0.05) { score += 40; reasons.push(`${Math.round(dist * 1000)} m`); }
        else if (dist < 0.5) { score += 20; reasons.push(`${dist.toFixed(2)} km`); }
        else if (dist < 2) { score += 5; reasons.push(`${dist.toFixed(1)} km`); }
      }
      return { id: p.id, name: p.name, address: p.address, score, reasons };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);

    if (scored.length === 0) return null;
    return {
      id: o.id,
      name: o.name,
      address: o.address,
      city: o.city,
      candidates: scored,
    };
  }).filter((p): p is NonNullable<typeof p> => p !== null);

  res.json({
    total: proposals.length,
    proposals,
    truncated: orphans.length === limit,
    orphansAnalyzed: orphans.length,
  });
}));

// Steg 3: Föräldra-koppling — commit (transaktionellt + dedupe + guard)
app.post("/api/import/cleanup/parents/apply", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const userId = (req as any).user?.id || null;
  const raw: Array<{ objectId: string; parentId: string }> = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
  // Dedupe: en objectId får bara en parentId per request (sista vinner ersätts av första)
  const seen = new Set<string>();
  const assignments = raw.filter(a => {
    if (!a || typeof a.objectId !== "string" || typeof a.parentId !== "string") return false;
    if (a.objectId === a.parentId) return false; // self-parent
    if (seen.has(a.objectId)) return false;
    seen.add(a.objectId);
    return true;
  });
  if (assignments.length === 0) throw new ValidationError("Inga giltiga kopplingar");
  if (assignments.length > 5000) throw new ValidationError("Max 5000 kopplingar per körning");

  const batchId = `cleanup-parents-${Date.now()}`;
  const objIds = assignments.map(a => a.objectId);
  const parentIds = Array.from(new Set(assignments.map(a => a.parentId)));

  const result = await db.transaction(async (tx) => {
    const objs = await tx.select({
      id: objects.id, parentId: objects.parentId, customerId: primaryPayerCustomerIdSql(),
      hierarchyLevel: objects.hierarchyLevel,
    }).from(objects).where(and(
      eq(objects.tenantId, tenantId),
      inArray(objects.id, objIds),
      isNull(objects.deletedAt),
    ));
    const objMap = new Map(objs.map(o => [o.id, o]));

    const parents = await tx.select({
      id: objects.id, customerId: primaryPayerCustomerIdSql(), hierarchyLevel: objects.hierarchyLevel,
    }).from(objects).where(and(
      eq(objects.tenantId, tenantId),
      inArray(objects.id, parentIds),
      isNull(objects.deletedAt),
    ));
    const parentMap = new Map(parents.map(p => [p.id, p]));
    const ALLOWED_PARENT_LEVELS = new Set(["rum", "fastighet", "brf"]);

    const auditEntries: any[] = [];
    let updated = 0;
    let skipped = 0;

    for (const a of assignments) {
      const obj = objMap.get(a.objectId);
      if (!obj) { skipped++; continue; }
      if (obj.hierarchyLevel !== "karl") { skipped++; continue; } // bara kärl får ny parent här
      if (obj.parentId) { skipped++; continue; }

      const parent = parentMap.get(a.parentId);
      if (!parent) { skipped++; continue; }
      if (parent.customerId !== obj.customerId) { skipped++; continue; }
      if (!ALLOWED_PARENT_LEVELS.has(parent.hierarchyLevel || "")) { skipped++; continue; }

      // State-guard: ta bara om parent_id fortfarande är null
      const upd = await tx.update(objects).set({
        parentId: a.parentId,
        importBatchId: batchId,
      }).where(and(
        eq(objects.id, a.objectId),
        eq(objects.tenantId, tenantId),
        eq(objects.hierarchyLevel, "karl"),
        isNull(objects.parentId),
        isNull(objects.deletedAt),
      )).returning({ id: objects.id });

      if (upd.length === 0) { skipped++; continue; }

      auditEntries.push({
        tenantId, userId, action: "cleanup_parents", resourceType: "objects", resourceId: a.objectId,
        changes: { before: { parentId: null }, after: { parentId: a.parentId } },
        metadata: { batchId, source: "cleanup-parents" },
      });
      updated++;
    }

    if (auditEntries.length > 0) {
      await tx.insert(auditLogs).values(auditEntries);
    }

    await tx.insert(importBatches).values({
      tenantId, batchId, totalRows: assignments.length, created: 0, updated, errors: 0,
      metadata: { source: "cleanup-parents", userId, skipped },
    });

    return { updated, skipped, total: assignments.length };
  });

  res.json({ batchId, ...result });
}));

// Steg 4: Adress-backfill — preview
app.get("/api/import/cleanup/address/preview", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const limit = Math.min(parseInt((req.query.limit as string) || "100"), 500);

  const missing = await db.select({
    id: objects.id, name: objects.name, parentId: objects.parentId,
    latitude: objects.latitude, longitude: objects.longitude,
  }).from(objects).where(and(
    eq(objects.tenantId, tenantId),
    isNull(objects.deletedAt),
    eq(objects.hierarchyLevel, "karl"),
    sql`(${objects.address} IS NULL OR ${objects.address} = '')`,
  )).limit(limit);

  const parentIds = Array.from(new Set(missing.map(m => m.parentId).filter((p): p is string => !!p)));
  const parents = parentIds.length > 0
    ? await db.select({
        id: objects.id, address: objects.address, city: objects.city, postalCode: objects.postalCode,
      }).from(objects).where(and(
        eq(objects.tenantId, tenantId),
        inArray(objects.id, parentIds),
        isNull(objects.deletedAt),
      ))
    : [];
  const parentMap = new Map(parents.map(p => [p.id, p]));

  const proposals: any[] = [];
  let reverseGeocoded = 0;
  for (const m of missing) {
    const parent = m.parentId ? parentMap.get(m.parentId) : null;
    if (parent && parent.address) {
      proposals.push({
        id: m.id, name: m.name, source: "parent",
        suggestedAddress: parent.address,
        suggestedCity: parent.city,
        suggestedPostalCode: parent.postalCode,
      });
    } else if (m.latitude && m.longitude && reverseGeocoded < 25) {
      // Begränsa omvänd-geokod till max 25 per preview för att skona API:t
      const result = await getMapProvider().reverseGeocode(m.latitude, m.longitude, tenantId);
      reverseGeocoded++;
      if (result?.city) {
        proposals.push({
          id: m.id, name: m.name, source: "reverse-geocode",
          suggestedAddress: result.address || null,
          suggestedCity: result.city,
          suggestedPostalCode: result.postalCode || null,
        });
      }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  res.json({
    total: proposals.length,
    proposals,
    truncated: missing.length === limit,
    note: reverseGeocoded > 0 ? `Omvänd-geokod begränsad till 25 per förhandsgranskning. Kör flera gånger om fler behövs.` : null,
  });
}));

// Steg 4: Adress-backfill — commit
app.post("/api/import/cleanup/address/apply", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const userId = (req as any).user?.id || null;
  const raw: Array<{ id: string; address?: string | null; city?: string | null; postalCode?: string | null }> = Array.isArray(req.body?.items) ? req.body.items : [];
  const seenIds = new Set<string>();
  const items = raw.filter(i => {
    if (!i || typeof i.id !== "string") return false;
    if (seenIds.has(i.id)) return false;
    seenIds.add(i.id);
    return true;
  });
  if (items.length === 0) throw new ValidationError("Inga adresser att skriva");
  if (items.length > 5000) throw new ValidationError("Max 5000 per körning");

  const batchId = `cleanup-address-${Date.now()}`;
  const ids = items.map(i => i.id);

  const result = await db.transaction(async (tx) => {
    const existing = await tx.select({
      id: objects.id, address: objects.address, city: objects.city, postalCode: objects.postalCode,
      hierarchyLevel: objects.hierarchyLevel,
    }).from(objects).where(and(
      eq(objects.tenantId, tenantId),
      inArray(objects.id, ids),
      isNull(objects.deletedAt),
    ));
    const existingMap = new Map(existing.map(e => [e.id, e]));

    const auditEntries: any[] = [];
    let updated = 0;
    let skipped = 0;

    for (const item of items) {
      const before = existingMap.get(item.id);
      if (!before) { skipped++; continue; }
      if (before.hierarchyLevel !== "karl") { skipped++; continue; }
      if (before.address && before.address.trim() !== "") { skipped++; continue; }

      const updates: Record<string, any> = { importBatchId: batchId };
      if (item.address !== undefined && item.address !== null) updates.address = item.address;
      if (item.city !== undefined && item.city !== null) updates.city = item.city;
      if (item.postalCode !== undefined && item.postalCode !== null) updates.postalCode = item.postalCode;
      if (Object.keys(updates).length === 1) { skipped++; continue; }

      // State-guard: bara om adress fortfarande är tom/null
      const upd = await tx.update(objects).set(updates).where(and(
        eq(objects.id, item.id),
        eq(objects.tenantId, tenantId),
        eq(objects.hierarchyLevel, "karl"),
        sql`(${objects.address} IS NULL OR ${objects.address} = '')`,
        isNull(objects.deletedAt),
      )).returning({ id: objects.id });

      if (upd.length === 0) { skipped++; continue; }

      auditEntries.push({
        tenantId, userId, action: "cleanup_address", resourceType: "objects", resourceId: item.id,
        changes: {
          before: { address: before.address, city: before.city, postalCode: before.postalCode },
          after: { address: updates.address, city: updates.city, postalCode: updates.postalCode },
        },
        metadata: { batchId, source: "cleanup-address" },
      });
      updated++;
    }

    if (auditEntries.length > 0) {
      await tx.insert(auditLogs).values(auditEntries);
    }

    await tx.insert(importBatches).values({
      tenantId, batchId, totalRows: items.length, created: 0, updated, errors: 0,
      metadata: { source: "cleanup-address", userId, skipped },
    });

    return { updated, skipped, total: items.length };
  });

  res.json({ batchId, ...result });
}));

// Återställ en sanering-batch via audit-loggen (inverse restore — INTE delete)
app.post("/api/import/cleanup/restore/:batchId", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const userId = (req as any).user?.id || null;
  const { batchId } = req.params;

  if (!batchId.startsWith("cleanup-")) {
    throw new ValidationError("Endast sanering-batches kan återställas via denna endpoint");
  }

  const [batch] = await db.select().from(importBatches)
    .where(and(eq(importBatches.batchId, batchId), eq(importBatches.tenantId, tenantId)));
  if (!batch) throw new NotFoundError("Sanering-batch hittades inte");

  const action = batchId.startsWith("cleanup-names-") ? "cleanup_names"
    : batchId.startsWith("cleanup-parents-") ? "cleanup_parents"
    : batchId.startsWith("cleanup-address-") ? "cleanup_address"
    : null;
  if (!action) throw new ValidationError("Okänd sanering-typ");

  const result = await db.transaction(async (tx) => {
    const entries = await tx.select().from(auditLogs).where(and(
      eq(auditLogs.tenantId, tenantId),
      eq(auditLogs.action, action),
      sql`${auditLogs.metadata}->>'batchId' = ${batchId}`,
    ));

    let restored = 0;
    let skipped = 0;
    const restoreAudit: any[] = [];

    for (const entry of entries) {
      const before = (entry.changes as any)?.before;
      if (!before || !entry.resourceId) { skipped++; continue; }

      const restoreFields: Record<string, any> = {};
      if ("name" in before) restoreFields.name = before.name;
      if ("parentId" in before) restoreFields.parentId = before.parentId;
      if ("address" in before) restoreFields.address = before.address;
      if ("city" in before) restoreFields.city = before.city;
      if ("postalCode" in before) restoreFields.postalCode = before.postalCode;

      if (Object.keys(restoreFields).length === 0) { skipped++; continue; }

      const upd = await tx.update(objects).set(restoreFields).where(and(
        eq(objects.id, entry.resourceId),
        eq(objects.tenantId, tenantId),
        eq(objects.importBatchId, batchId),
        isNull(objects.deletedAt),
      )).returning({ id: objects.id });

      if (upd.length === 0) { skipped++; continue; }

      restoreAudit.push({
        tenantId, userId, action: `${action}_restore`, resourceType: "objects", resourceId: entry.resourceId,
        changes: { before: (entry.changes as any)?.after, after: before },
        metadata: { batchId, restoredFromBatch: batchId, source: "cleanup-restore" },
      });
      restored++;
    }

    if (restoreAudit.length > 0) {
      await tx.insert(auditLogs).values(restoreAudit);
    }

    // Markera batchen som återställd så historik-UI vet det
    const existingMeta = (batch.metadata as Record<string, any>) || {};
    await tx.update(importBatches).set({
      metadata: {
        ...existingMeta,
        restored: true,
        restoredAt: new Date().toISOString(),
        restoredBy: userId,
        restoredCount: restored,
      },
    }).where(and(
      eq(importBatches.batchId, batchId),
      eq(importBatches.tenantId, tenantId),
    ));

    return { restored, skipped, total: entries.length };
  });

  res.json({ batchId, ...result });
}));

// ============================================================================
// BERIKA BEFINTLIGA KÄRL MED METADATA FRÅN MODUS OBJEKT-EXPORT (Task #241)
// Matchar på MODUS-id, uppdaterar endast metadata_varden, skapar inga objekt.
// ============================================================================

// Återställ en enrich-modus-batch via audit-loggen (inverse restore — INTE delete)
// Tar bort metadata-värden som skapades av batchen och återställer befintliga
// värden till sitt before-värde från audit-posten.
app.post("/api/import/enrich-modus/restore/:batchId", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const userId = (req as any).user?.id || null;
  const { batchId } = req.params;

  const result = await restoreEnrichModusBatch({ batchId, tenantId, userId });

  res.json({ batchId, ...result });
}));

// Säkerställer de 7 standardmetadatatyperna för kärl
app.post("/api/import/modus/objects/enrich/seed-types", requireAdmin, asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  if (!tenantId) throw new ValidationError("Ingen tenant");
  const result = await seedKarlMetadataTypes(tenantId);
  res.json({
    ...result,
    definitions: KARL_METADATA_DEFINITIONS.map(d => ({ namn: d.namn, datatyp: d.datatyp, beskrivning: d.beskrivning })),
  });
}));

// Hjälpare: parsa CSV-fil från multipart-request (semikolonseparerad)
function parseEnrichCsv(buffer: Buffer): Record<string, string>[] {
  const csvText = buffer.toString("utf-8");
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    delimiter: ";",
  });
  if (result.errors.length > 0) {
    throw new ValidationError(`CSV-fel: ${result.errors[0].message}`);
  }
  return result.data;
}

// Hjälpare: identifiera Metadata-kolumner och valfri columnMapping från body
// Returnerar lista av { csvColumn, metadataName } – metadataName är det målnamn vi
// ska skriva mot i metadataKatalog (case-insensitive matchning).
function resolveMetadataColumns(
  rows: Record<string, string>[],
  body: any,
): Array<{ csvColumn: string; metadataName: string }> {
  const cols: Array<{ csvColumn: string; metadataName: string }> = [];
  const seen = new Set<string>();
  const firstRow = rows[0];
  if (!firstRow) return cols;

  // Auto-detect "Metadata - X" kolumner
  for (const key of Object.keys(firstRow)) {
    if (key.startsWith("Metadata - ")) {
      const name = key.replace("Metadata - ", "").trim();
      if (name && !seen.has(name.toLowerCase())) {
        cols.push({ csvColumn: key, metadataName: name });
        seen.add(name.toLowerCase());
      }
    }
  }

  // Explicit columnMapping i body: { "CSV-kolumnnamn": "MetadataNamn" }
  let columnMapping: Record<string, string> = {};
  try {
    if (body?.columnMapping) {
      columnMapping = typeof body.columnMapping === "string" ? JSON.parse(body.columnMapping) : body.columnMapping;
    }
  } catch {}
  for (const [csvColumn, metadataName] of Object.entries(columnMapping)) {
    if (typeof metadataName !== "string" || !metadataName.trim()) continue;
    if (!(csvColumn in firstRow)) continue;
    const lc = metadataName.toLowerCase();
    if (seen.has(lc)) continue;
    cols.push({ csvColumn, metadataName: metadataName.trim() });
    seen.add(lc);
  }

  return cols;
}

// Förhandsvisning av berikning – inga ändringar görs
app.post("/api/import/modus/objects/enrich/preview", requireAdmin, upload.single("file"), asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  if (!tenantId) throw new ValidationError("Ingen tenant");
  if (!req.file) throw new ValidationError("Ingen fil uppladdad");

  const rows = parseEnrichCsv(req.file.buffer);
  if (rows.length === 0) {
    return res.json({ totalRows: 0, matchedCount: 0, unmatchedCount: 0, unmatchedSample: [], metadataColumns: [], perField: {}, missingMetadataTypes: [] });
  }

  const metadataColumns = resolveMetadataColumns(rows, req.body);
  if (metadataColumns.length === 0) {
    return res.json({
      totalRows: rows.length,
      matchedCount: 0,
      unmatchedCount: 0,
      unmatchedSample: [],
      metadataColumns: [],
      perField: {},
      missingMetadataTypes: [],
      warning: "Hittade inga 'Metadata - *'-kolumner i CSV och ingen columnMapping skickades.",
    });
  }

  // Hämta alla MODUS-ider från CSV
  const modusIds = new Set<string>();
  for (const row of rows) {
    const modusId = (row["Id"] || "").replace(/\s/g, "");
    if (modusId) modusIds.add(modusId);
  }
  if (modusIds.size === 0) {
    return res.json({ totalRows: rows.length, matchedCount: 0, unmatchedCount: 0, unmatchedSample: [], metadataColumns: metadataColumns.map(c => c.metadataName), perField: {}, missingMetadataTypes: [], warning: "Inga rader har giltigt Id." });
  }

  // Tolerant uppslag: vissa tenants har objekt importerade som "MODUS-12345",
  // andra som rakt nummer "12345". Sök båda formerna och chunka in-listan så
  // vi inte träffar Postgres parameter-tak (~65k) vid stora filer.
  const objectNumbersToSearch = Array.from(modusIds).flatMap(id => [`MODUS-${id}`, id]);
  const LOOKUP_CHUNK = 5000;
  const matchedObjs: Array<{ id: string; objectNumber: string | null; hierarchyLevel: string | null }> = [];
  for (let i = 0; i < objectNumbersToSearch.length; i += LOOKUP_CHUNK) {
    const slice = objectNumbersToSearch.slice(i, i + LOOKUP_CHUNK);
    const partial = await db.select({
      id: objects.id,
      objectNumber: objects.objectNumber,
      hierarchyLevel: objects.hierarchyLevel,
    }).from(objects).where(and(
      eq(objects.tenantId, tenantId),
      inArray(objects.objectNumber, slice),
      isNull(objects.deletedAt),
    ));
    matchedObjs.push(...partial);
  }

  // Bygg map MODUS-id → object (normalisera bort ev. "MODUS-"-prefix)
  const modusToObject = new Map<string, { id: string; hierarchyLevel: string | null }>();
  for (const o of matchedObjs) {
    if (!o.objectNumber) continue;
    const normalized = o.objectNumber.replace(/^MODUS-/, "");
    modusToObject.set(normalized, { id: o.id, hierarchyLevel: o.hierarchyLevel });
  }

  // Hämta existerande metadata för matchade objekt + våra metadatatyper
  const matchedObjectIds = matchedObjs.map(o => o.id);
  const allTypes = await getAllMetadataTypes(tenantId);
  const typeByName = buildMetadataTypeLookup(allTypes);

  const missingMetadataTypes = metadataColumns
    .filter(c => !typeByName.has(c.metadataName.toLowerCase()))
    .map(c => c.metadataName);

  let existingValues = new Map<string, Map<string, string | null>>(); // objectId -> (typeId -> displayValue)
  if (matchedObjectIds.length > 0) {
    const typeIds = metadataColumns
      .map(c => typeByName.get(c.metadataName.toLowerCase())?.id)
      .filter((x): x is string => !!x);
    if (typeIds.length > 0) {
      const existing = await db.select().from(metadataVarden).where(and(
        eq(metadataVarden.tenantId, tenantId),
        eq(metadataVarden.status, "aktiv"),
        inArray(metadataVarden.objektId, matchedObjectIds),
        inArray(metadataVarden.metadataKatalogId, typeIds),
      ));
      for (const v of existing) {
        if (!v.objektId) continue;
        let inner = existingValues.get(v.objektId);
        if (!inner) { inner = new Map(); existingValues.set(v.objektId, inner); }
        const display = v.vardeString ??
          (v.vardeInteger != null ? String(v.vardeInteger) : null) ??
          (v.vardeDecimal != null ? String(v.vardeDecimal) : null) ??
          (v.vardeBoolean != null ? String(v.vardeBoolean) : null) ??
          (v.vardeReferens ?? null);
        inner.set(v.metadataKatalogId, display);
      }
    }
  }

  // Räkna per fält och hela
  type FieldStats = { wouldCreate: number; wouldUpdate: number; unchanged: number; missingType: boolean };
  const perField: Record<string, FieldStats> = {};
  for (const c of metadataColumns) {
    perField[c.metadataName] = {
      wouldCreate: 0,
      wouldUpdate: 0,
      unchanged: 0,
      missingType: !typeByName.has(c.metadataName.toLowerCase()),
    };
  }

  let matchedCount = 0;
  const unmatched: string[] = [];

  for (const row of rows) {
    const modusId = (row["Id"] || "").replace(/\s/g, "");
    if (!modusId) continue;
    const obj = modusToObject.get(modusId);
    if (!obj) {
      unmatched.push(modusId);
      continue;
    }
    matchedCount++;

    for (const c of metadataColumns) {
      const stats = perField[c.metadataName];
      const type = typeByName.get(c.metadataName.toLowerCase());
      if (!type) continue;
      const raw = (row[c.csvColumn] || "").trim();
      if (!raw) continue;

      const existingDisplay = existingValues.get(obj.id)?.get(type.id) ?? null;
      if (existingDisplay == null) {
        stats.wouldCreate++;
      } else if (existingDisplay.trim() !== raw) {
        stats.wouldUpdate++;
      } else {
        stats.unchanged++;
      }
    }
  }

  res.json({
    totalRows: rows.length,
    matchedCount,
    unmatchedCount: unmatched.length,
    unmatchedSample: unmatched.slice(0, 50),
    metadataColumns: metadataColumns.map(c => ({ csvColumn: c.csvColumn, metadataName: c.metadataName })),
    perField,
    missingMetadataTypes,
  });
}));

// Apply: skarpkörning av berikning. Körs som bakgrundsjobb för att undvika
// HTTP-timeouts vid stora filer (t.ex. 29 010 kärl × 7 metadatafält). Endpointen
// validerar fil + skapar import_batches-raden synkront, returnerar 202 + batchId,
// och fortsätter sedan bearbeta i bakgrunden. UI pollar
// GET /api/import/batches/:batchId för progress.
app.post("/api/import/modus/objects/enrich/apply", requireAdmin, upload.single("file"), asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  if (!tenantId) throw new ValidationError("Ingen tenant");
  if (!req.file) throw new ValidationError("Ingen fil uppladdad");
  const userId = (req as any).user?.id || null;

  // Synkron validering så att uppenbara fel returneras direkt (utan att behöva polla).
  const rows = parseEnrichCsv(req.file.buffer);
  if (rows.length === 0) throw new ValidationError("CSV är tom");

  const metadataColumns = resolveMetadataColumns(rows, req.body);
  if (metadataColumns.length === 0) {
    throw new ValidationError("Inga metadata-kolumner att importera (varken 'Metadata - *' eller columnMapping)");
  }

  // OBS: Prefixet "enrich-modus-" är ett kontrakt med
  // server/import-batch-watchdog.ts — watchdogen filtrerar på
  // `batch_id LIKE 'enrich-modus-%'` för att bara markera berikningskörningar
  // som failed efter omstart/hängning. Byt INTE prefix utan att samtidigt
  // uppdatera watchdogens filter (annars slutar automatisk återhämtning
  // fungera tyst).
  const batchId = `enrich-modus-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const baseMetadata = {
    type: "enrich-modus" as const,
    metadataColumns: metadataColumns.map(c => c.metadataName),
    startedBy: userId,
    startedAt,
  };

  // Skapa import_batches-raden direkt så historik och poll-endpoint kan se körningen
  // som "in_progress" innan vi släpper HTTP-anslutningen.
  await db.insert(importBatches).values({
    tenantId,
    batchId,
    totalRows: rows.length,
    created: 0,
    updated: 0,
    errors: 0,
    metadata: {
      ...baseMetadata,
      status: "in_progress",
      rowsProcessed: 0,
      // Heartbeat-stämpel så watchdog kan upptäcka batches som aldrig hann
      // skriva en första progress-rapport innan de övergavs.
      lastProgressAt: new Date().toISOString(),
    },
  });

  // Returnera 202 omedelbart - resten körs i bakgrunden så proxy/lastbalanserare
  // inte timeoutar och användaren slipper hålla fliken öppen för en blockerande request.
  res.status(202).json({
    batchId,
    totalRows: rows.length,
    status: "in_progress",
    metadataColumns: metadataColumns.map(c => c.metadataName),
  });

  // Bakgrundsbearbetning - inga undantag får läcka till Express
  runEnrichApplyJob({
    tenantId,
    userId,
    batchId,
    rows,
    metadataColumns,
    baseMetadata,
  }).catch((err) => {
    console.error(`[enrich-apply ${batchId}] bakgrundsjobb kraschade:`, err);
  });
}));

// Hämta status för en pågående/avslutad import-batch (används av UI för progress-polling)
app.get("/api/import/batches/:batchId", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { batchId } = req.params;

  // Syntetiserade fortnox-invoices-batcher per dag har ingen rad i
  // import_batches; vi bygger detalj-vyn on-the-fly från fortnox_invoice_exports
  // så klick→detaljer ger samma vy som för riktiga batcher.
  const fxMatch = batchId.match(/^fortnox-invoices-(\d{4}-\d{2}-\d{2})$/);
  if (fxMatch) {
    const day = fxMatch[1];
    const { fortnoxInvoiceExports } = await import("@shared/schema");
    const rows = await db.select().from(fortnoxInvoiceExports)
      .where(and(
        eq(fortnoxInvoiceExports.tenantId, tenantId),
        sql`to_char(${fortnoxInvoiceExports.createdAt} AT TIME ZONE 'Europe/Stockholm', 'YYYY-MM-DD') = ${day}`,
      ))
      .orderBy(desc(fortnoxInvoiceExports.createdAt));

    const exported = rows.filter(r => r.status === "exported").length;
    const failed = rows.filter(r => r.status === "failed");
    const cancelled = rows.filter(r => r.status === "cancelled").length;
    const pending = rows.filter(r => r.status === "pending").length;
    const sampleErrors = failed.slice(0, 20).map(r =>
      `${r.fortnoxInvoiceNumber || r.workOrderId || r.id}: ${r.errorMessage || "okänt fel"}`
    );
    res.json({
      id: batchId,
      batchId,
      totalRows: rows.length,
      created: exported,
      updated: 0,
      errors: failed.length,
      createdAt: rows[0]?.createdAt || null,
      metadata: {
        type: "fortnox-invoices",
        status: pending > 0 ? "in_progress"
              : failed.length > 0 ? "completed_with_errors"
              : cancelled > 0 && exported === 0 ? "aborted"
              : "completed",
        day,
        pending,
        cancelled,
        sampleErrors,
      },
    });
    return;
  }

  const [batch] = await db.select().from(importBatches)
    .where(and(eq(importBatches.batchId, batchId), eq(importBatches.tenantId, tenantId)));
  if (!batch) throw new NotFoundError("Import-batch hittades inte");
  res.json(batch);
}));

async function runEnrichApplyJob(params: {
  tenantId: string;
  userId: string | null;
  batchId: string;
  rows: Record<string, string>[];
  metadataColumns: { csvColumn: string; metadataName: string }[];
  baseMetadata: {
    type: "enrich-modus";
    metadataColumns: string[];
    startedBy: string | null;
    startedAt: string;
  };
}) {
  const { tenantId, userId, batchId, rows, metadataColumns, baseMetadata } = params;

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const errors: string[] = [];
  let unmatchedCount = 0;
  let invalidIdCount = 0;
  let matchedRowCount = 0;
  let rowsProcessed = 0;
  const uniqueMatchedObjects = new Set<string>();

  // Audit-batch deklareras här så även catch-grenen kan flusha väntande audits
  // innan batchen markeras failed - annars tappas in-memory audit-rader för
  // de delvis-skrivna metadata-ändringarna och rollback/återställning förlorar spårbarhet.
  const auditBatch: any[] = [];
  const flushAudit = async () => {
    if (auditBatch.length === 0) return;
    await db.insert(auditLogs).values(auditBatch.splice(0, auditBatch.length));
  };

  async function updateBatchProgress(status: "in_progress" | "completed" | "failed", extra: Record<string, any> = {}) {
    await db.update(importBatches).set({
      created,
      updated,
      errors: errors.length,
      metadata: {
        ...baseMetadata,
        status,
        rowsProcessed,
        unchanged,
        unmatchedCount,
        invalidIdCount,
        matchedRowCount,
        uniqueMatchedObjectCount: uniqueMatchedObjects.size,
        sampleErrors: errors.slice(0, 50),
        // Heartbeat så watchdog kan upptäcka hängda jobb även utan omstart.
        // Vid in_progress räcker det att vi rapporterar; vid completed/failed
        // skrivs samma stämpel för enkel diagnostik.
        lastProgressAt: new Date().toISOString(),
        ...extra,
      },
    }).where(and(
      eq(importBatches.batchId, batchId),
      eq(importBatches.tenantId, tenantId),
    ));
  }

  try {
    // Auto-seed standard kärl-metadatatyper innan import
    await seedKarlMetadataTypes(tenantId);

    const allTypes = await getAllMetadataTypes(tenantId);
    const typeByName = buildMetadataTypeLookup(allTypes);

    const modusIds = new Set<string>();
    for (const row of rows) {
      const modusId = (row["Id"] || "").replace(/\s/g, "");
      if (modusId) modusIds.add(modusId);
    }

    // Tolerant uppslag: stöder både "MODUS-12345" och rakt "12345" som
    // object_number (några tenants, t.ex. Kinab, har historiskt importerats
    // utan MODUS-prefix). Chunka för att hålla oss under Postgres parameter-
    // tak vid stora filer (45k rader × 2 varianter > 65k).
    const objectNumbersToSearch = Array.from(modusIds).flatMap(id => [`MODUS-${id}`, id]);
    const APPLY_LOOKUP_CHUNK = 5000;
    const matchedObjs: Array<{ id: string; objectNumber: string | null }> = [];
    for (let i = 0; i < objectNumbersToSearch.length; i += APPLY_LOOKUP_CHUNK) {
      const slice = objectNumbersToSearch.slice(i, i + APPLY_LOOKUP_CHUNK);
      const partial = await db.select({ id: objects.id, objectNumber: objects.objectNumber })
        .from(objects).where(and(
          eq(objects.tenantId, tenantId),
          inArray(objects.objectNumber, slice),
          isNull(objects.deletedAt),
        ));
      matchedObjs.push(...partial);
    }

    const modusToObjectId = new Map<string, string>();
    for (const o of matchedObjs) {
      if (!o.objectNumber) continue;
      const modusId = o.objectNumber.replace(/^MODUS-/, "");
      modusToObjectId.set(modusId, o.id);
    }

    // Ladda existerande värden så vi kan välja create vs update + capture before-värdet
    const matchedObjectIds = Array.from(new Set(Array.from(modusToObjectId.values())));
    const typeIds = metadataColumns
      .map(c => typeByName.get(c.metadataName.toLowerCase())?.id)
      .filter((x): x is string => !!x);

    type ExistingRow = { id: string; objektId: string; metadataKatalogId: string; display: string | null };
    const existingByKey = new Map<string, ExistingRow>(); // objectId+typeId -> row
    if (matchedObjectIds.length > 0 && typeIds.length > 0) {
      const existing = await db.select().from(metadataVarden).where(and(
        eq(metadataVarden.tenantId, tenantId),
        eq(metadataVarden.status, "aktiv"),
        inArray(metadataVarden.objektId, matchedObjectIds),
        inArray(metadataVarden.metadataKatalogId, typeIds),
      ));
      for (const v of existing) {
        if (!v.objektId) continue;
        const display = v.vardeString ??
          (v.vardeInteger != null ? String(v.vardeInteger) : null) ??
          (v.vardeDecimal != null ? String(v.vardeDecimal) : null) ??
          (v.vardeBoolean != null ? String(v.vardeBoolean) : null) ??
          (v.vardeReferens ?? null);
        existingByKey.set(`${v.objektId}::${v.metadataKatalogId}`, {
          id: v.id, objektId: v.objektId, metadataKatalogId: v.metadataKatalogId, display,
        });
      }
    }

    // Skriv en första progress-rapport efter setup så UI ser att lookup-fasen är klar.
    await updateBatchProgress("in_progress");

    // Bearbeta rad-för-rad. Audit-loggar samlas och skrivs i batch.
    // Varje skrivning av createMetadata/updateMetadata är atomär per anrop.
    // auditBatch + flushAudit är hoistade till funktionsnivå så catch-grenen
    // kan flusha väntande audits innan failed-status skrivs.
    const FLUSH_AT = 200;
    const PROGRESS_EVERY_ROWS = 250; // periodisk progress även när inga audits skapas

    for (const row of rows) {
      rowsProcessed++;
      const modusId = (row["Id"] || "").replace(/\s/g, "");
      if (!modusId) { invalidIdCount++; }
      else {
        const objectId = modusToObjectId.get(modusId);
        if (!objectId) { unmatchedCount++; }
        else {
          matchedRowCount++;
          uniqueMatchedObjects.add(objectId);

          for (const c of metadataColumns) {
            const type = typeByName.get(c.metadataName.toLowerCase());
            if (!type) {
              if (errors.length < 1000) errors.push(`Saknad metadata-typ för "${c.metadataName}"`);
              continue;
            }
            const raw = (row[c.csvColumn] || "").trim();
            if (!raw) continue;

            const key = `${objectId}::${type.id}`;
            const existing = existingByKey.get(key);

            try {
              if (!existing) {
                const newRow = await createMetadata({
                  tenantId,
                  objektId: objectId,
                  metadataTypNamn: type.namn,
                  varde: raw,
                  skapadAv: userId || "modus-enrich",
                  metod: "modus-enrich",
                });
                existingByKey.set(key, {
                  id: newRow.id, objektId: objectId, metadataKatalogId: type.id, display: raw,
                });
                created++;
                auditBatch.push({
                  tenantId, userId, action: "enrich_modus", resourceType: "object_metadata", resourceId: newRow.id,
                  changes: { before: null, after: { metadataKatalogId: type.id, metadataNamn: type.namn, value: raw } },
                  metadata: { batchId, objectId, source: "modus-enrich" },
                });
              } else if ((existing.display ?? "").trim() === raw) {
                unchanged++;
              } else {
                const beforeValue = existing.display;
                await updateMetadata(existing.id, raw, tenantId, userId || "modus-enrich", "modus-enrich");
                existing.display = raw;
                updated++;
                auditBatch.push({
                  tenantId, userId, action: "enrich_modus", resourceType: "object_metadata", resourceId: existing.id,
                  changes: { before: { value: beforeValue }, after: { metadataKatalogId: type.id, metadataNamn: type.namn, value: raw } },
                  metadata: { batchId, objectId, source: "modus-enrich" },
                });
              }
            } catch (err: any) {
              if (errors.length < 1000) {
                errors.push(`"${c.metadataName}" (MODUS-${modusId}): ${err.message || err}`);
              }
            }

            if (auditBatch.length >= FLUSH_AT) {
              await flushAudit();
              await updateBatchProgress("in_progress");
            }
          }
        }
      }

      // Periodisk progress även om vi inte hunnit fylla auditBatch (t.ex. när majoriteten
      // av raderna är omatchade eller tomma). Säkerställer att UI ser rörelse.
      if (rowsProcessed % PROGRESS_EVERY_ROWS === 0) {
        await updateBatchProgress("in_progress");
      }
    }
    await flushAudit();
    await updateBatchProgress("completed", { finishedAt: new Date().toISOString() });
  } catch (err: any) {
    // Flusha väntande audit-rader innan vi markerar failed så vi inte tappar
    // spårbarhet för de metadata-skrivningar som hann gå igenom innan felet.
    try {
      await flushAudit();
    } catch (flushErr) {
      console.error(`[enrich-apply ${batchId}] kunde inte flusha audit-rader vid fel:`, flushErr);
    }
    // Markera batchen som failed så historik vet
    try {
      await updateBatchProgress("failed", {
        finishedAt: new Date().toISOString(),
        failureReason: err?.message || String(err),
      });
    } catch (updateErr) {
      console.error(`[enrich-apply ${batchId}] kunde inte markera batch som failed:`, updateErr);
    }
    throw err;
  }
}

// ============================================================================
// OBJEKT SOM SAKNAS I MODUS-EXPORTEN (Task #250)
// Användaren laddar upp den senaste Modus Objekt-exporten (samma fil-format som
// enrich-flödet) och får tillbaka listan över kärl som finns i vår DB men INTE
// i exporten. Tre kategorier rapporteras:
//   - "missing"        — objektnummer matchar Modus-format men finns inte i CSV
//   - "non_standard"   — objektnummer har inte Modus-format (varken "MODUS-{n}"
//                        eller rent numeriskt) — sannolikt lokalt skapat hos oss
//   - "no_object_number" — kärl utan objektnummer (kan inte matchas alls)
// ============================================================================

// Hjälpare: bestäm om ett object_number ser ut som ett Modus-id
function classifyModusIdFormat(objectNumber: string | null | undefined):
  "modus_prefixed" | "numeric" | "non_standard" | "missing" {
  if (!objectNumber) return "missing";
  const trimmed = objectNumber.trim();
  if (trimmed === "") return "missing";
  if (/^MODUS-\d+$/i.test(trimmed)) return "modus_prefixed";
  if (/^\d+$/.test(trimmed)) return "numeric";
  return "non_standard";
}

type NotInExportRow = {
  id: string;
  objectNumber: string | null;
  name: string;
  address: string | null;
  city: string | null;
  customerId: string | null;
  customerName: string | null;
  createdAt: string | null;
  format: "modus_prefixed" | "numeric" | "non_standard" | "missing";
};

async function computeObjectsNotInExport(params: {
  tenantId: string;
  csvBuffer: Buffer;
}): Promise<{
  totalRows: number;
  csvIdCount: number;
  totalContainers: number;
  inExportCount: number;
  notInExportCount: number;
  nonStandardFormatCount: number;
  noObjectNumberCount: number;
  rows: NotInExportRow[];
}> {
  const { tenantId, csvBuffer } = params;

  const csvRows = parseEnrichCsv(csvBuffer);
  const csvIds = new Set<string>();
  for (const row of csvRows) {
    const raw = (row["Id"] || "").replace(/\s/g, "");
    if (!raw) continue;
    csvIds.add(raw);
  }

  // Hämta alla kärl i tenantens DB (icke borttagna). Vi behöver objectNumber
  // och en kort beskrivning för rapporten. Joina mot customers för läsbarhet.
  const dbRows = await db.select({
    id: objects.id,
    objectNumber: objects.objectNumber,
    name: objects.name,
    address: objects.address,
    city: objects.city,
    customerId: primaryPayerCustomerIdSql(),
    customerName: customers.name,
    createdAt: objects.createdAt,
  })
    .from(objects)
    .leftJoin(customers, sql`${customers.id} = ${primaryPayerCustomerIdSql()}`)
    .where(and(
      eq(objects.tenantId, tenantId),
      isNull(objects.deletedAt),
      eq(objects.hierarchyLevel, "karl"),
    ));

  const totalContainers = dbRows.length;
  let inExportCount = 0;
  const notInExport: NotInExportRow[] = [];
  let nonStandardFormatCount = 0;
  let noObjectNumberCount = 0;

  for (const r of dbRows) {
    const fmt = classifyModusIdFormat(r.objectNumber);
    if (fmt === "modus_prefixed" || fmt === "numeric") {
      const normalized = (r.objectNumber || "").replace(/^MODUS-/i, "").trim();
      if (csvIds.has(normalized)) {
        inExportCount++;
        continue;
      }
    } else if (fmt === "missing") {
      noObjectNumberCount++;
    } else {
      nonStandardFormatCount++;
    }

    notInExport.push({
      id: r.id,
      objectNumber: r.objectNumber,
      name: r.name,
      address: r.address,
      city: r.city,
      customerId: r.customerId,
      customerName: r.customerName,
      createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      format: fmt,
    });
  }

  // Sortera: mest "deletbara" (matchar Modus-format men saknas) först,
  // sen non_standard, sen missing.
  const formatRank: Record<NotInExportRow["format"], number> = {
    modus_prefixed: 0,
    numeric: 1,
    non_standard: 2,
    missing: 3,
  };
  notInExport.sort((a, b) => {
    const r = formatRank[a.format] - formatRank[b.format];
    if (r !== 0) return r;
    return (a.objectNumber || "").localeCompare(b.objectNumber || "", "sv");
  });

  return {
    totalRows: csvRows.length,
    csvIdCount: csvIds.size,
    totalContainers,
    inExportCount,
    notInExportCount: notInExport.length,
    nonStandardFormatCount,
    noObjectNumberCount,
    rows: notInExport,
  };
}

// Diff-rapport: vilka kärl finns hos oss men inte i den uppladdade Modus-exporten?
// JSON som default, ?format=csv för nedladdning.
app.post(
  "/api/import/modus/objects/objects-not-in-export",
  requireAdmin,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) throw new ValidationError("Ingen tenant");
    if (!req.file) throw new ValidationError("Ingen fil uppladdad");

    const result = await computeObjectsNotInExport({
      tenantId,
      csvBuffer: req.file.buffer,
    });

    const wantCsv = String(req.query.format || "").toLowerCase() === "csv";
    if (wantCsv) {
      const header = [
        "objectNumber", "id", "name", "format",
        "customerName", "address", "city", "createdAt",
      ];
      const escape = (v: unknown) => {
        const s = v == null ? "" : String(v);
        if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const lines = [header.join(";")];
      for (const r of result.rows) {
        lines.push([
          r.objectNumber, r.id, r.name, r.format,
          r.customerName, r.address, r.city, r.createdAt,
        ].map(escape).join(";"));
      }
      const csv = "\uFEFF" + lines.join("\n") + "\n";
      const filename = `objects-not-in-modus-export-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    // Begränsa rader i JSON-svar för att hålla payload rimlig (rapporten är
    // typiskt ~100 rader för Kinab, men vi vill inte krascha frontend om någon
    // tenant har 50k saknade kärl).
    const MAX_ROWS_JSON = 5000;
    res.json({
      totalRows: result.totalRows,
      csvIdCount: result.csvIdCount,
      totalContainers: result.totalContainers,
      inExportCount: result.inExportCount,
      notInExportCount: result.notInExportCount,
      nonStandardFormatCount: result.nonStandardFormatCount,
      noObjectNumberCount: result.noObjectNumberCount,
      truncated: result.rows.length > MAX_ROWS_JSON,
      rows: result.rows.slice(0, MAX_ROWS_JSON),
    });
  }),
);

// Bulk-borttagning av kärl som identifierats som saknade i Modus-exporten.
// Soft-delete (sätter deleted_at) + audit-logg per objekt så ändringen kan
// granskas och vid behov backas i framtiden.
app.post(
  "/api/import/modus/objects/objects-not-in-export/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    if (!tenantId) throw new ValidationError("Ingen tenant");
    const userId = (req as any).user?.id || null;

    const schema = z.object({
      objectIds: z.array(z.string().min(1)).min(1).max(2000),
      reason: z.string().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);
    const { objectIds, reason } = parsed.data;

    // Verifiera att alla objekt tillhör tenant och är karl-nivå innan delete
    const existing = await db.select({
      id: objects.id,
      objectNumber: objects.objectNumber,
      name: objects.name,
      hierarchyLevel: objects.hierarchyLevel,
      deletedAt: objects.deletedAt,
    })
      .from(objects)
      .where(and(
        eq(objects.tenantId, tenantId),
        inArray(objects.id, objectIds),
      ));

    const eligible = existing.filter(o =>
      o.hierarchyLevel === "karl" && o.deletedAt == null
    );
    const ineligibleCount = existing.length - eligible.length;
    const notFoundCount = objectIds.length - existing.length;

    if (eligible.length === 0) {
      return res.json({
        deleted: 0,
        ineligible: ineligibleCount,
        notFound: notFoundCount,
      });
    }

    const eligibleIds = eligible.map(o => o.id);
    const now = new Date();
    await db.update(objects)
      .set({ deletedAt: now })
      .where(and(
        eq(objects.tenantId, tenantId),
        inArray(objects.id, eligibleIds),
      ));

    // Audit per objekt så vi kan spåra/backa per id
    const auditRows = eligible.map(o => ({
      tenantId,
      userId,
      action: "delete_missing_in_modus" as const,
      resourceType: "object" as const,
      resourceId: o.id,
      changes: {
        before: { deletedAt: null, objectNumber: o.objectNumber, name: o.name },
        after: { deletedAt: now.toISOString() },
      },
      metadata: {
        source: "modus-objects-not-in-export",
        reason: reason || null,
      },
    }));
    if (auditRows.length > 0) {
      await db.insert(auditLogs).values(auditRows);
    }

    res.json({
      deleted: eligible.length,
      ineligible: ineligibleCount,
      notFound: notFoundCount,
    });
  }),
);

// ============================================================
// Customer Fastighetslista — årlig avstämning av kundens fastighetslista
// mot Traivos objekt. Matchning sker på normaliserad adress + ort.
// ============================================================

const FL_FIELDS: Record<string, { label: string; aliases: string[]; required?: boolean }> = {
  address: { label: "Adress (gata + nummer)", required: true, aliases: ["adress", "address", "gatuadress", "gata", "besoksadress", "besöksadress", "street", "leveransadress", "delivery_address", "adress 1", "adress1"] },
  postalCode: { label: "Postnummer", aliases: ["postnummer", "postnr", "zip", "zip_code", "postal_code", "postalcode"] },
  city: { label: "Ort / Postort", aliases: ["ort", "stad", "city", "postort"] },
  name: { label: "Objektnamn (valfritt)", aliases: ["namn", "name", "objektnamn", "fastighet", "fastighetsnamn", "benamning", "benämning"] },
  objectNumber: { label: "Externt ID / Fastighetsbeteckning (valfritt)", aliases: ["fastighetsbeteckning", "beteckning", "externt id", "externid", "kundens id", "kundnummer", "objektnummer", "objectnumber", "id"] },
};

function computeHeaderFingerprint(headers: string[]): string {
  // Stabil fingerprint = sorterade, lowercase, trimmade rubriker joinade med "|"
  // (md5 för kortare lagring). Två filer med exakt samma kolumn-set ger samma
  // fingerprint oavsett kolumnordning.
  const normalized = headers.map(h => String(h || "").trim().toLowerCase()).filter(Boolean).sort();
  return crypto.createHash("md5").update(normalized.join("|")).digest("hex");
}

function autoSuggestFlMapping(headers: string[]): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  const usedCols = new Set<string>();
  for (const [field, info] of Object.entries(FL_FIELDS)) {
    let match: string | null = null;
    // Exakt först
    for (const h of headers) {
      if (usedCols.has(h)) continue;
      const hLower = h.toLowerCase().trim();
      const hNorm = hLower.replace(/[\s_-]/g, "");
      if (info.aliases.some(a => hLower === a || hNorm === a.replace(/[\s_-]/g, ""))) {
        match = h;
        break;
      }
    }
    // Fuzzy fallback
    if (!match) {
      for (const h of headers) {
        if (usedCols.has(h)) continue;
        const hLower = h.toLowerCase().trim();
        if (info.aliases.some(a => hLower.includes(a) || a.includes(hLower))) {
          match = h;
          break;
        }
      }
    }
    if (match) usedCols.add(match);
    result[field] = match;
  }
  return result;
}

interface FlDiffSummary {
  totalFileRows: number;
  validFileRows: number;
  newCount: number;
  changedCount: number;
  missingCount: number;
  unchangedCount: number;
  duplicateGroupCount: number;
  duplicateExcludedCount: number;
  invalidCount: number;
}

interface FlNewRow { rowIndex: number; key: string; address: string; postalCode: string; city: string; name: string; objectNumber: string; }
interface FlChangedRow { rowIndex: number; key: string; objectId: string; address: string; postalCode: string; city: string; name: string; objectNumber: string; changes: Record<string, { old: string; new: string }>; }
interface FlMissingRow { id: string; name: string; address: string | null; postalCode: string | null; city: string | null; objectNumber: string | null; reconciliationFlag: string | null; }
interface FlInvalidRow { rowIndex: number; reason: string; raw: Record<string, string>; }
// duplicate group: winnerRowIndex är den enda raden som tas med i new/changed;
// excludedRowIndices listas explicit så UI kan visa "rad N hoppas över".
interface FlDuplicateGroup { key: string; winnerRowIndex: number; excludedRowIndices: number[]; addressPreview: string; }

interface FlDiff {
  summary: FlDiffSummary;
  new: FlNewRow[];
  changed: FlChangedRow[];
  missing: FlMissingRow[];
  duplicates: FlDuplicateGroup[];
  invalid: FlInvalidRow[];
}

interface ParsedFlRow { rowIndex: number; key: string; address: string; postalCode: string; city: string; name: string; objectNumber: string; }

async function computeFlDiff(
  tenantId: string,
  customerId: string,
  columnMap: Record<string, string | null | undefined>,
  rows: Record<string, string>[],
  // Planner-valda vinnar-rader per nyckel. Om en nyckel inte finns här används
  // första förekomsten. Ogiltigt rad-index (utanför gruppen) ignoreras tyst.
  duplicateWinners?: Record<string, number> | null,
): Promise<FlDiff> {
  if (!columnMap?.address) throw new ValidationError("Adress-kolumnen måste mappas");

  const existing = await db.select().from(objects).where(and(
    eq(objects.tenantId, tenantId),
    objectHasPrimaryCustomerSql(customerId),
    isNull(objects.deletedAt),
  ));

  const existingByKey = new Map<string, typeof existing[number]>();
  for (const o of existing) {
    const k = normalizeAddressKey({ address: o.address, postalCode: o.postalCode, city: o.city });
    if (k && !existingByKey.has(k)) existingByKey.set(k, o);
  }

  const fAddr = columnMap.address as string;
  const fPost = columnMap.postalCode || null;
  const fCity = columnMap.city || null;
  const fName = columnMap.name || null;
  const fObjNum = columnMap.objectNumber || null;

  // Pre-pass: parsa varje rad och samla per-nyckel-index. Vi processar diff:en
  // i en andra-pass efter att vinnare per duplicate-grupp valts.
  const parsedByIndex: Array<ParsedFlRow | null> = new Array(rows.length).fill(null);
  const invalid: FlInvalidRow[] = [];
  const occurrencesByKey = new Map<string, number[]>();
  const previewByKey = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const address = (r[fAddr] || "").trim();
    if (!address) { invalid.push({ rowIndex: i, reason: "Adress saknas", raw: r }); continue; }
    const postalCode = fPost ? (r[fPost] || "").trim() : "";
    const city = fCity ? (r[fCity] || "").trim() : "";
    const name = fName ? (r[fName] || "").trim() : "";
    const objectNumber = fObjNum ? (r[fObjNum] || "").trim() : "";

    const key = normalizeAddressKey({ address, postalCode, city });
    if (!key) { invalid.push({ rowIndex: i, reason: "Adress kan inte normaliseras", raw: r }); continue; }

    parsedByIndex[i] = { rowIndex: i, key, address, postalCode, city, name, objectNumber };
    if (!occurrencesByKey.has(key)) {
      occurrencesByKey.set(key, []);
      previewByKey.set(key, [address, city].filter(Boolean).join(", "));
    }
    occurrencesByKey.get(key)!.push(i);
  }

  const newRows: FlNewRow[] = [];
  const changedRows: FlChangedRow[] = [];
  const matchedKeys = new Set<string>();
  const duplicates: FlDuplicateGroup[] = [];
  let unchangedCount = 0;
  let duplicateExcludedCount = 0;

  for (const [key, indices] of Array.from(occurrencesByKey.entries())) {
    // Välj vinnare: planner-valt rad-index om giltigt, annars första.
    let winnerIdx = indices[0];
    const requested = duplicateWinners?.[key];
    if (typeof requested === "number" && indices.includes(requested)) {
      winnerIdx = requested;
    }
    const winnerRow = parsedByIndex[winnerIdx]!;

    if (indices.length > 1) {
      const excluded = indices.filter(i => i !== winnerIdx);
      duplicateExcludedCount += excluded.length;
      duplicates.push({
        key,
        winnerRowIndex: winnerIdx,
        excludedRowIndices: excluded,
        addressPreview: previewByKey.get(key) || key,
      });
    }

    const match = existingByKey.get(key);
    if (match) {
      matchedKeys.add(key);
      const changes: Record<string, { old: string; new: string }> = {};
      if (winnerRow.postalCode && (match.postalCode || "").trim() !== winnerRow.postalCode) changes.postalCode = { old: match.postalCode || "", new: winnerRow.postalCode };
      if (winnerRow.city && (match.city || "").trim() !== winnerRow.city) changes.city = { old: match.city || "", new: winnerRow.city };
      if (winnerRow.name && (match.name || "").trim() !== winnerRow.name) changes.name = { old: match.name || "", new: winnerRow.name };
      if (winnerRow.objectNumber && (match.objectNumber || "").trim() !== winnerRow.objectNumber) changes.objectNumber = { old: match.objectNumber || "", new: winnerRow.objectNumber };
      if (Object.keys(changes).length > 0) {
        changedRows.push({ rowIndex: winnerIdx, key, objectId: match.id, address: winnerRow.address, postalCode: winnerRow.postalCode, city: winnerRow.city, name: winnerRow.name, objectNumber: winnerRow.objectNumber, changes });
      } else {
        unchangedCount++;
      }
    } else {
      newRows.push({ rowIndex: winnerIdx, key, address: winnerRow.address, postalCode: winnerRow.postalCode, city: winnerRow.city, name: winnerRow.name, objectNumber: winnerRow.objectNumber });
    }
  }

  const missing: FlMissingRow[] = existing
    .filter(o => {
      const k = normalizeAddressKey({ address: o.address, postalCode: o.postalCode, city: o.city });
      return k && !matchedKeys.has(k);
    })
    .map(o => ({ id: o.id, name: o.name, address: o.address, postalCode: o.postalCode, city: o.city, objectNumber: o.objectNumber, reconciliationFlag: o.reconciliationFlag }));

  const validFileRows = rows.length - invalid.length;
  return {
    summary: {
      totalFileRows: rows.length,
      validFileRows,
      newCount: newRows.length,
      changedCount: changedRows.length,
      missingCount: missing.length,
      unchangedCount,
      duplicateGroupCount: duplicates.length,
      duplicateExcludedCount,
      invalidCount: invalid.length,
    },
    new: newRows,
    changed: changedRows,
    missing,
    duplicates,
    invalid,
  };
}

// GET — hämta sparad mappning för en kund
app.get("/api/import/customer-fastighetslista/mapping", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customerId = String(req.query.customerId || "");
  if (!customerId) throw new ValidationError("customerId krävs");
  const [row] = await db.select().from(customerImportMappings).where(and(
    eq(customerImportMappings.tenantId, tenantId),
    eq(customerImportMappings.customerId, customerId),
  )).limit(1);
  if (!row) return res.json({ mapping: null });
  res.json({ mapping: { columnMap: row.columnMap, label: row.label, updatedAt: row.updatedAt, lastUsedAt: row.lastUsedAt } });
}));

// POST /preview — ladda upp fil, returnera kolumner + sparad/föreslagen mappning + parsade rader
app.post("/api/import/customer-fastighetslista/preview", upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError("Ingen fil uppladdad");
  const customerId = String(req.body.customerId || "");
  if (!customerId) throw new ValidationError("customerId krävs");
  const tenantId = getTenantIdWithFallback(req);

  const [cust] = await db.select().from(customers).where(and(
    eq(customers.id, customerId),
    eq(customers.tenantId, tenantId),
    isNull(customers.deletedAt),
  )).limit(1);
  if (!cust) throw new NotFoundError("Kunden hittades inte i denna tenant");

  const { rows, errors } = await parseModusUpload(req.file);
  if (rows.length === 0) {
    throw new ValidationError("Filen verkar tom" + (errors.length ? `: ${errors.slice(0,3).join("; ")}` : ""));
  }

  const headers = Object.keys(rows[0]);
  const headerFingerprint = computeHeaderFingerprint(headers);

  const [saved] = await db.select().from(customerImportMappings).where(and(
    eq(customerImportMappings.tenantId, tenantId),
    eq(customerImportMappings.customerId, customerId),
  )).limit(1);

  const savedColumnMap = saved?.columnMap as Record<string, string | null> | undefined;
  // Verifiera att sparade kolumner finns kvar i filen
  let savedMappingUsable = false;
  if (savedColumnMap) {
    const headerSet = new Set(headers);
    savedMappingUsable = !!(savedColumnMap.address && headerSet.has(savedColumnMap.address as string));
  }
  // Fingerprint-match: om filens kolumn-layout är identisk med när
  // mappningen sparades senast kan UI auto-hoppa förbi mappnings-steget.
  const fingerprintMatches = !!(saved?.sourceFingerprint && saved.sourceFingerprint === headerFingerprint);

  const suggested = autoSuggestFlMapping(headers);

  res.json({
    customer: { id: cust.id, name: cust.name },
    columns: headers,
    headerFingerprint,
    sampleRows: rows.slice(0, 5),
    totalRows: rows.length,
    rows,
    savedMapping: saved ? {
      columnMap: savedColumnMap,
      label: saved.label,
      updatedAt: saved.updatedAt,
      lastUsedAt: saved.lastUsedAt,
      usable: savedMappingUsable,
      fingerprintMatches,
    } : null,
    suggestedMapping: suggested,
    availableFields: Object.entries(FL_FIELDS).map(([key, val]) => ({ key, label: val.label, required: !!val.required })),
    parseErrors: errors,
  });
}));

// POST /diff — kör avstämning utan att skriva
app.post("/api/import/customer-fastighetslista/diff", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const { customerId, columnMap, rows, duplicateWinners } = req.body || {};
  if (!customerId || typeof customerId !== "string") throw new ValidationError("customerId krävs");
  if (!columnMap || typeof columnMap !== "object") throw new ValidationError("columnMap krävs");
  if (!Array.isArray(rows)) throw new ValidationError("rows måste vara en array");

  const [cust] = await db.select().from(customers).where(and(
    eq(customers.id, customerId),
    eq(customers.tenantId, tenantId),
    isNull(customers.deletedAt),
  )).limit(1);
  if (!cust) throw new NotFoundError("Kunden hittades inte i denna tenant");

  const diff = await computeFlDiff(tenantId, customerId, columnMap, rows, duplicateWinners || null);
  res.json(diff);
}));

// POST /commit — skapa nya, uppdatera ändrade, flagga saknade
app.post("/api/import/customer-fastighetslista/commit", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const userId = (req as any).user?.id || (req as any).user?.claims?.sub || null;
  const {
    customerId,
    columnMap,
    rows,
    approvedNewIndices,
    // Per-fält-godkännande: { [objectId]: [fieldName, ...] }. Endast fält
    // som listas under sitt objectId skrivs. Tom array = inget skrivs för
    // det objektet. Bakåtkompat: om `approvedChangedKeys` (gamla formatet)
    // skickas in tolkas det som "alla fält för dessa rader".
    approvedChangedFields,
    approvedChangedKeys,
    // Per-rad-val för "saknade" objekt. Endast id:n i denna array flaggas.
    // Bakåtkompat: om bara `flagMissing: true` skickas in flaggas ALLA
    // saknade objekt (gamla beteendet).
    flagMissingIds,
    flagMissing,
    // Planner-valda vinnare per duplicate-grupp (samma format som /diff).
    duplicateWinners,
    saveMapping,
    mappingLabel,
  } = req.body || {};

  if (!customerId || typeof customerId !== "string") throw new ValidationError("customerId krävs");
  if (!columnMap || typeof columnMap !== "object") throw new ValidationError("columnMap krävs");
  if (!Array.isArray(rows)) throw new ValidationError("rows måste vara en array");

  const [cust] = await db.select().from(customers).where(and(
    eq(customers.id, customerId),
    eq(customers.tenantId, tenantId),
    isNull(customers.deletedAt),
  )).limit(1);
  if (!cust) throw new NotFoundError("Kunden hittades inte i denna tenant");

  // Räkna ut diff på nytt på server-sidan — vi litar aldrig på klient-listor.
  const diff = await computeFlDiff(tenantId, customerId, columnMap, rows, duplicateWinners || null);

  // Per-rad-val för saknade: om `flagMissingIds` skickas in används den som
  // whitelist (även en tom array = inga flaggor). Faller tillbaka till
  // gamla all-eller-inget-beteendet via `flagMissing: true`.
  const useExplicitMissing = Array.isArray(flagMissingIds);
  const missingIdsToFlag = useExplicitMissing
    ? new Set<string>((flagMissingIds as unknown[]).filter((x): x is string => typeof x === "string"))
    : (flagMissing ? new Set<string>(diff.missing.map(m => m.id)) : new Set<string>());

  const batchId = `kfl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  const selectedNew = new Set<number>(Array.isArray(approvedNewIndices) ? approvedNewIndices : []);
  // Bygg per-fält map: objectId → Set(fältnamn). Whitelist tillåtna fält
  // för att klient aldrig kan trigga en update på fält utanför det som
  // diff:en faktiskt jämför (t.ex. tenantId eller hierarchyLevel).
  const ALLOWED_FL_FIELDS = new Set(["postalCode", "city", "name", "objectNumber"]);
  const fieldsByObject = new Map<string, Set<string>>();
  if (approvedChangedFields && typeof approvedChangedFields === "object") {
    for (const [oid, fields] of Object.entries(approvedChangedFields)) {
      if (!Array.isArray(fields)) continue;
      const filtered = (fields as string[]).filter(f => ALLOWED_FL_FIELDS.has(f));
      if (filtered.length > 0) fieldsByObject.set(oid, new Set(filtered));
    }
  } else if (Array.isArray(approvedChangedKeys)) {
    // Bakåtkompat: rad-nivå godkännande → ta alla fält i varje matchad rad
    const keys = new Set<string>(approvedChangedKeys);
    for (const cr of diff.changed) {
      if (keys.has(cr.key)) fieldsByObject.set(cr.objectId, new Set(Object.keys(cr.changes)));
    }
  }

  // All skriv-aktivitet sker i en transaktion så att en partiell krasch
  // (t.ex. nätverksfel mitt under loopen) inte lämnar halv-applicerade
  // diff:ar i DB. Audit + batch-rad commit:as tillsammans med själva datat.
  const result = await db.transaction(async (tx) => {
    const auditRows: any[] = [];
    const createdIds: string[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    let flaggedCount = 0;

    for (const nr of diff.new) {
      if (!selectedNew.has(nr.rowIndex)) continue;
      const [created] = await tx.insert(objects).values({
        tenantId,
        customerId,
        name: nr.name || nr.address,
        address: nr.address,
        postalCode: nr.postalCode || null,
        city: nr.city || null,
        objectNumber: nr.objectNumber || null,
        objectType: "fastighet",
        hierarchyLevel: "fastighet",
        importBatchId: batchId,
      }).returning();
      createdIds.push(created.id);
      createdCount++;
    }

    for (const cr of diff.changed) {
      const allowedFields = fieldsByObject.get(cr.objectId);
      if (!allowedFields || allowedFields.size === 0) continue;
      const update: Record<string, any> = {};
      const before: Record<string, any> = {};
      for (const [field, ch] of Object.entries(cr.changes)) {
        if (!allowedFields.has(field)) continue;
        update[field] = ch.new;
        before[field] = ch.old;
      }
      if (Object.keys(update).length === 0) continue;
      await tx.update(objects).set(update).where(and(
        eq(objects.id, cr.objectId),
        eq(objects.tenantId, tenantId),
      ));
      auditRows.push({
        tenantId,
        userId,
        action: "update_from_fastighetslista",
        resourceType: "object",
        resourceId: cr.objectId,
        changes: { before, after: update },
        metadata: { source: "customer-fastighetslista", batchId, customerId },
      });
      updatedCount++;
    }

    if (missingIdsToFlag.size > 0) {
      for (const m of diff.missing) {
        if (!missingIdsToFlag.has(m.id)) continue;
        await tx.update(objects).set({
          reconciliationFlag: "missing_in_fastighetslista",
          reconciliationFlaggedAt: now,
          reconciliationBatchId: batchId,
        }).where(and(eq(objects.id, m.id), eq(objects.tenantId, tenantId)));
        auditRows.push({
          tenantId,
          userId,
          action: "flag_missing_in_fastighetslista",
          resourceType: "object",
          resourceId: m.id,
          changes: {
            before: { reconciliationFlag: m.reconciliationFlag || null },
            after: { reconciliationFlag: "missing_in_fastighetslista", reconciliationBatchId: batchId },
          },
          metadata: { source: "customer-fastighetslista", batchId, customerId },
        });
        flaggedCount++;
      }
    }

    if (auditRows.length > 0) {
      await tx.insert(auditLogs).values(auditRows);
    }

    await tx.insert(importBatches).values({
      tenantId,
      batchId,
      totalRows: rows.length,
      created: createdCount,
      updated: updatedCount,
      errors: diff.summary.invalidCount,
      metadata: {
        type: "customer-fastighetslista",
        source: "customer-fastighetslista",
        status: "completed",
        customerId,
        customerName: cust.name,
        columnMap,
        flagMissing: !!flagMissing || useExplicitMissing,
        flagMissingIds: useExplicitMissing ? Array.from(missingIdsToFlag) : null,
        flaggedCount,
        summary: diff.summary,
        filename: typeof req.body?.filename === "string" ? req.body.filename : ((req as any).file?.originalname || null),
        startedBy: userId,
        completedAt: new Date().toISOString(),
      },
    });

    // Spara/uppdatera kolumnmappning för kunden (default på). Sparar även
    // sourceFingerprint — vid identiskt kolumn-set i framtida uppladdningar
    // kan UI auto-hoppa direkt till diff-steget.
    if (saveMapping !== false) {
      const fingerprint = Array.isArray(req.body?.headers)
        ? computeHeaderFingerprint(req.body.headers)
        : (typeof req.body?.headerFingerprint === "string" ? req.body.headerFingerprint : null);
      const existingMap = await tx.select().from(customerImportMappings).where(and(
        eq(customerImportMappings.tenantId, tenantId),
        eq(customerImportMappings.customerId, customerId),
      )).limit(1);
      if (existingMap.length > 0) {
        await tx.update(customerImportMappings).set({
          columnMap,
          label: mappingLabel || existingMap[0].label,
          sourceFingerprint: fingerprint ?? existingMap[0].sourceFingerprint,
          lastUsedAt: now,
          updatedAt: now,
        }).where(eq(customerImportMappings.id, existingMap[0].id));
      } else {
        await tx.insert(customerImportMappings).values({
          tenantId, customerId, columnMap, label: mappingLabel || null,
          sourceFingerprint: fingerprint, lastUsedAt: now,
        });
      }
    }

    return { createdCount, updatedCount, flaggedCount, createdIds };
  });

  // Geo-trigger körs utanför transaktionen — den är best-effort och får inte
  // rulla tillbaka commit:en om geokodningen misslyckas.
  for (const id of result.createdIds) triggerGeocodeIfMissing(id);

  invalidateWorkflowCaches(tenantId);

  // Hämta skapade objekt så done-steget kan länka till dem och visa
  // "Geokoda nu"-knapp för de som saknar koordinater.
  let createdObjectsResp: Array<{ id: string; name: string; address: string; hasCoords: boolean }> = [];
  if (result.createdIds.length > 0) {
    const createdRows = await db.select().from(objects).where(and(
      eq(objects.tenantId, tenantId),
      inArray(objects.id, result.createdIds),
    ));
    createdObjectsResp = createdRows.map(o => ({
      id: o.id,
      name: o.name,
      address: o.address,
      hasCoords: o.latitude != null && o.longitude != null,
    }));
  }

  res.json({
    batchId,
    createdCount: result.createdCount,
    updatedCount: result.updatedCount,
    flaggedCount: result.flaggedCount,
    missingTotal: diff.missing.length,
    totalRows: rows.length,
    summary: diff.summary,
    createdObjects: createdObjectsResp,
  });
}));

// POST /undo — backa en commit: ta bort skapade, återställ ändrade, rensa flaggor
app.post("/api/import/customer-fastighetslista/undo", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const userId = (req as any).user?.id || (req as any).user?.claims?.sub || null;
  const { batchId } = req.body || {};
  if (!batchId || typeof batchId !== "string") throw new ValidationError("batchId krävs");
  if (!batchId.startsWith("kfl-")) throw new ValidationError("Endast kund-fastighetslista-batchar kan backas här");

  const [batch] = await db.select().from(importBatches).where(and(
    eq(importBatches.tenantId, tenantId),
    eq(importBatches.batchId, batchId),
  )).limit(1);
  if (!batch) throw new NotFoundError("Batch hittades inte");

  // Hela undo körs i en transaktion — delvis rollback (vissa objekt
  // återställda, vissa flaggor kvar) skulle vara värre än ingen rollback.
  const undoResult = await db.transaction(async (tx) => {
    // 1) Soft-delete objekt som skapades i denna batch
    const createdObjects = await tx.select().from(objects).where(and(
      eq(objects.tenantId, tenantId),
      eq(objects.importBatchId, batchId),
      isNull(objects.deletedAt),
    ));
    const now = new Date();
    let removedCount = 0;
    if (createdObjects.length > 0) {
      await tx.update(objects).set({ deletedAt: now }).where(and(
        eq(objects.tenantId, tenantId),
        eq(objects.importBatchId, batchId),
        isNull(objects.deletedAt),
      ));
      removedCount = createdObjects.length;
    }

    // 2) Återställ ändrade objekt från audit_logs
    const updateAudits = await tx.select().from(auditLogs).where(and(
      eq(auditLogs.tenantId, tenantId),
      eq(auditLogs.action, "update_from_fastighetslista"),
      sql`${auditLogs.metadata}->>'batchId' = ${batchId}`,
    ));
    let revertedCount = 0;
    for (const a of updateAudits) {
      const changes = a.changes as any;
      const before = changes?.before;
      if (!before || typeof before !== "object") continue;
      const revertSet: Record<string, any> = {};
      for (const [k, v] of Object.entries(before)) {
        revertSet[k] = v === "" ? null : v;
      }
      if (Object.keys(revertSet).length > 0) {
        await tx.update(objects).set(revertSet).where(and(
          eq(objects.id, a.resourceId!),
          eq(objects.tenantId, tenantId),
        ));
        revertedCount++;
      }
    }

    // 3) Rensa reconciliationFlag på objekt som flaggades av denna batch
    const unflagResult = await tx.update(objects).set({
      reconciliationFlag: null,
      reconciliationFlaggedAt: null,
      reconciliationBatchId: null,
    }).where(and(
      eq(objects.tenantId, tenantId),
      eq(objects.reconciliationBatchId, batchId),
    )).returning({ id: objects.id });
    const unflaggedCount = unflagResult.length;

    // 4) Spåra själva undo-operationen
    await tx.insert(auditLogs).values({
      tenantId,
      userId,
      action: "undo_customer_fastighetslista",
      resourceType: "import_batch",
      resourceId: batchId,
      changes: { before: { batchId, created: removedCount, updated: revertedCount, flagged: unflaggedCount }, after: { undone: true } },
      metadata: { source: "customer-fastighetslista-undo", batchId },
    });

    return { removedCount, revertedCount, unflaggedCount };
  });

  invalidateWorkflowCaches(tenantId);

  res.json({ batchId, ...undoResult });
}));

// GET — lista objekt som flaggats som saknade
app.get("/api/import/customer-fastighetslista/flagged-objects", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const customerId = req.query.customerId ? String(req.query.customerId) : null;
  const whereParts = [
    eq(objects.tenantId, tenantId),
    isNull(objects.deletedAt),
    isNotNull(objects.reconciliationFlag),
  ];
  if (customerId) whereParts.push(objectHasPrimaryCustomerSql(customerId));
  const rows = await db.select({
    id: objects.id,
    name: objects.name,
    address: objects.address,
    postalCode: objects.postalCode,
    city: objects.city,
    objectNumber: objects.objectNumber,
    customerId: primaryPayerCustomerIdSql(),
    reconciliationFlag: objects.reconciliationFlag,
    reconciliationFlaggedAt: objects.reconciliationFlaggedAt,
    reconciliationBatchId: objects.reconciliationBatchId,
  }).from(objects).where(and(...whereParts)).orderBy(desc(objects.reconciliationFlaggedAt));
  res.json({ objects: rows });
}));

// POST — rensa flagga (planerare har granskat manuellt)
app.post("/api/import/customer-fastighetslista/clear-flag", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const userId = (req as any).user?.id || (req as any).user?.claims?.sub || null;
  const { objectId } = req.body || {};
  if (!objectId || typeof objectId !== "string") throw new ValidationError("objectId krävs");
  const [obj] = await db.select().from(objects).where(and(
    eq(objects.id, objectId),
    eq(objects.tenantId, tenantId),
  )).limit(1);
  if (!obj) throw new NotFoundError("Objektet hittades inte");
  if (!obj.reconciliationFlag) return res.json({ ok: true, alreadyCleared: true });

  await db.update(objects).set({
    reconciliationFlag: null,
    reconciliationFlaggedAt: null,
    reconciliationBatchId: null,
  }).where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)));

  await db.insert(auditLogs).values({
    tenantId,
    userId,
    action: "clear_reconciliation_flag",
    resourceType: "object",
    resourceId: objectId,
    changes: { before: { reconciliationFlag: obj.reconciliationFlag, reconciliationBatchId: obj.reconciliationBatchId }, after: { reconciliationFlag: null } },
    metadata: { source: "customer-fastighetslista" },
  });

  res.json({ ok: true });
}));

// ============================================================================
// Task #581 — Export → Excel-diff → reimport för uppdateringar (PDF §5.1)
// ----------------------------------------------------------------------------
// Generisk export-diff-reimport för `objects`-tabellen. Användaren kan:
//   1) GET  /api/import/objects-diff/export   → XLSX med nuvarande objekt
//   2) POST /api/import/objects-diff/preview  → diff-vy {created, updated, missing}
//   3) POST /api/import/objects-diff/commit   → applicerar diffen och registrerar
//      en import_batches-rad (metadata.type = "objects-diff") så #574-historiken
//      visar resultatet.
// Matchning: primärt på `objectNumber` (trim + case-insensitive), sekundärt på
// (name + parentObjectNumber) när objectNumber saknas på uppladdad rad.
// Säkerhet: alla queries är tenant-scopade (defense-in-depth) + commit kräver
// admin. XLSX-export neutraliserar formula-injection (memory: csv-export-hardening).
// ============================================================================

interface ObjectsDiffColumn {
  key: string;            // intern fältnyckel
  header: string;         // XLSX rubrik (svensk)
  readOnly?: boolean;     // visas i export men hanteras särskilt i diff
}

const OBJECTS_DIFF_COLUMNS: ObjectsDiffColumn[] = [
  { key: "objectNumber", header: "objectNumber" },
  { key: "name", header: "name" },
  { key: "hierarchyLevel", header: "hierarchyLevel" },
  { key: "parentObjectNumber", header: "parentObjectNumber" },
  { key: "customerName", header: "customerName", readOnly: true },
  { key: "address", header: "address" },
  { key: "city", header: "city" },
  { key: "postalCode", header: "postalCode" },
];

// Neutralisera formula-injection: prefixa farliga ledande tecken med apostrof.
function safeCellValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.length === 0) return s;
  const first = s.charAt(0);
  if (first === "=" || first === "+" || first === "-" || first === "@" || first === "\t" || first === "\r") {
    return "'" + s;
  }
  return s;
}

function normalizeKey(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

async function loadObjectsForDiff(tenantId: string) {
  const rows = await db
    .select({
      id: objects.id,
      objectNumber: objects.objectNumber,
      name: objects.name,
      hierarchyLevel: objects.hierarchyLevel,
      parentId: objects.parentId,
      // Etapp 5: primär kund härleds ur Ekonomi-metadatat 'Kund'.
      customerId: primaryPayerCustomerIdSql(),
      address: objects.address,
      city: objects.city,
      postalCode: objects.postalCode,
    })
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));

  // Bygg parent objectNumber-uppslag i en enda extra query
  const parentIds = Array.from(
    new Set(rows.map((r) => r.parentId).filter((p): p is string => !!p)),
  );
  const parentMap = new Map<string, string | null>();
  if (parentIds.length > 0) {
    const parents = await db
      .select({ id: objects.id, objectNumber: objects.objectNumber })
      .from(objects)
      .where(and(eq(objects.tenantId, tenantId), inArray(objects.id, parentIds)));
    for (const p of parents) parentMap.set(p.id, p.objectNumber);
  }

  // Kundnamn-uppslag (för export-kolumnen "customerName")
  const customerIds = Array.from(new Set(rows.map((r) => r.customerId).filter((c): c is string => !!c)));
  const customerMap = new Map<string, string>();
  if (customerIds.length > 0) {
    const custs = await db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), inArray(customers.id, customerIds)));
    for (const c of custs) customerMap.set(c.id, c.name);
  }

  return rows.map((r) => ({
    id: r.id,
    objectNumber: r.objectNumber,
    name: r.name,
    hierarchyLevel: r.hierarchyLevel,
    parentObjectNumber: r.parentId ? parentMap.get(r.parentId) ?? null : null,
    parentId: r.parentId,
    customerId: r.customerId,
    customerName: r.customerId ? customerMap.get(r.customerId) ?? "" : "",
    address: r.address,
    city: r.city,
    postalCode: r.postalCode,
  }));
}

// GET /api/import/objects-diff/export  → XLSX med nuvarande objektlista
app.get("/api/import/objects-diff/export", asyncHandler(async (req, res) => {
  const tenantId = getTenantIdWithFallback(req);
  const current = await loadObjectsForDiff(tenantId);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Traivo";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Objekt");
  sheet.columns = OBJECTS_DIFF_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: Math.min(Math.max(c.header.length + 4, 16), 36),
  }));
  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  OBJECTS_DIFF_COLUMNS.forEach((c, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FF1B4B6B" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: c.readOnly ? "FFE8F4F8" : "FFFDE8B4" },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFB9C7D2" } },
      left: { style: "thin", color: { argb: "FFB9C7D2" } },
      bottom: { style: "medium", color: { argb: "FF1B4B6B" } },
      right: { style: "thin", color: { argb: "FFB9C7D2" } },
    };
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const r of current) {
    const row: Record<string, string> = {};
    for (const c of OBJECTS_DIFF_COLUMNS) {
      row[c.key] = safeCellValue((r as any)[c.key]);
    }
    sheet.addRow(row);
  }

  // Läs-mig-flik
  const readme = wb.addWorksheet("Läs mig");
  readme.columns = [
    { header: "Kolumn", key: "name", width: 28 },
    { header: "Beskrivning", key: "description", width: 80 },
  ];
  const intro = readme.addRow(["Export-diff-reimport för objektlistan"]);
  intro.font = { bold: true, size: 14, color: { argb: "FF1B4B6B" } };
  readme.mergeCells(intro.number, 1, intro.number, 2);
  const body = readme.addRow([
    "Den här filen innehåller en kopia av era nuvarande objekt. " +
      "Ändra fält direkt i kolumnerna, lägg till nya rader längst ner eller " +
      "ta bort rader som inte längre gäller. När ni laddar upp filen igen visas en " +
      "preview med tre sektioner: Nya, Ändrade och Saknade. Inget skrivs förrän ni " +
      "klickar på 'Bekräfta uppdatering'. Saknade rader markeras med " +
      "reconciliation-flagga — de raderas aldrig automatiskt. " +
      "Matchning sker primärt på kolumnen 'objectNumber'.",
  ]);
  body.alignment = { wrapText: true, vertical: "top" };
  readme.mergeCells(body.number, 1, body.number, 2);
  body.height = 100;
  readme.addRow([]);
  const tableHeader = readme.addRow(["Kolumn", "Beskrivning"]);
  tableHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B4B6B" } };
  });
  const colDocs: Record<string, string> = {
    objectNumber: "Unikt externt objektnummer. Primär matchningsnyckel — lämna orört på befintliga rader.",
    name: "Objektets namn.",
    hierarchyLevel: "Hierarkinivå (t.ex. koncern, brf, fastighet, rum, karl).",
    parentObjectNumber: "Föräldraobjektets objectNumber (för att uttrycka hierarki).",
    customerName: "Kundnamn (read-only — visas för referens; ändras inte vid reimport).",
    address: "Gatuadress.",
    city: "Ort/stad.",
    postalCode: "Postnummer.",
  };
  for (const c of OBJECTS_DIFF_COLUMNS) {
    readme.addRow([c.header, colDocs[c.key] ?? ""]).alignment = { wrapText: true, vertical: "top" };
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  const buf = Buffer.from(arrayBuffer as ArrayBuffer);
  const datestamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="traivo-objekt-export-${datestamp}.xlsx"`,
  );
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.send(buf);
}));

// Gemensam parsning + diff-beräkning för preview/commit. Returnerar fullständig
// diff plus rådata för apply-fasen.
interface UploadedObjectsDiffRow {
  rowNumber: number;
  objectNumber: string;
  name: string;
  hierarchyLevel: string;
  parentObjectNumber: string;
  customerName: string;
  address: string;
  city: string;
  postalCode: string;
  errors: string[];
}

interface ObjectsDiffFieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

interface ObjectsDiffPreview {
  totals: {
    totalUploaded: number;
    totalCurrent: number;
    created: number;
    updated: number;
    missing: number;
    unchanged: number;
    errors: number;
  };
  created: Array<{
    row: number;
    objectNumber: string;
    name: string;
    customerName: string;
    hierarchyLevel: string;
    parentObjectNumber: string;
    address: string;
    city: string;
    postalCode: string;
  }>;
  updated: Array<{
    id: string;
    objectNumber: string | null;
    name: string;
    customerName: string;
    fieldDiffs: ObjectsDiffFieldChange[];
  }>;
  missing: Array<{
    id: string;
    objectNumber: string | null;
    name: string;
    customerName: string;
  }>;
  errors: Array<{ row: number; message: string }>;
}

function normalizeStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function fieldsEqual(a: unknown, b: unknown): boolean {
  return normalizeStr(a) === normalizeStr(b);
}

async function parseObjectsDiffUpload(
  file: Express.Multer.File,
): Promise<UploadedObjectsDiffRow[]> {
  const { rows } = await parseModusUpload(file);
  const out: UploadedObjectsDiffRow[] = [];
  rows.forEach((r, idx) => {
    const errors: string[] = [];
    // Hoppa över ev. exempelrader som ligger kvar från export
    const objNum = normalizeStr(r.objectNumber);
    const name = normalizeStr(r.name);
    if (!objNum && !name) return;
    if (!name) errors.push("Saknar namn");
    out.push({
      rowNumber: idx + 2, // +1 header, +1 till 1-indexerat
      objectNumber: objNum,
      name,
      hierarchyLevel: normalizeStr(r.hierarchyLevel),
      parentObjectNumber: normalizeStr(r.parentObjectNumber),
      customerName: normalizeStr(r.customerName),
      address: normalizeStr(r.address),
      city: normalizeStr(r.city),
      postalCode: normalizeStr(r.postalCode),
      errors,
    });
  });
  return out;
}

function computeObjectsDiff(
  uploaded: UploadedObjectsDiffRow[],
  current: Awaited<ReturnType<typeof loadObjectsForDiff>>,
): {
  preview: ObjectsDiffPreview;
  createRows: UploadedObjectsDiffRow[];
  updateOps: Array<{
    id: string;
    uploaded: UploadedObjectsDiffRow;
    fieldDiffs: ObjectsDiffFieldChange[];
  }>;
  missingIds: string[];
} {
  // Indexera nuvarande
  const byNumber = new Map<string, typeof current[number]>();
  const byNameParent = new Map<string, typeof current[number]>();
  for (const c of current) {
    if (c.objectNumber) byNumber.set(normalizeKey(c.objectNumber), c);
    const k = `${normalizeKey(c.name)}|${normalizeKey(c.parentObjectNumber || "")}`;
    if (!byNameParent.has(k)) byNameParent.set(k, c);
  }

  const matchedCurrentIds = new Set<string>();
  const created: ObjectsDiffPreview["created"] = [];
  const updated: ObjectsDiffPreview["updated"] = [];
  const errors: ObjectsDiffPreview["errors"] = [];
  const createRows: UploadedObjectsDiffRow[] = [];
  const updateOps: Array<{
    id: string;
    uploaded: UploadedObjectsDiffRow;
    fieldDiffs: ObjectsDiffFieldChange[];
  }> = [];
  let unchanged = 0;

  for (const row of uploaded) {
    if (row.errors.length > 0) {
      for (const m of row.errors) errors.push({ row: row.rowNumber, message: m });
      continue;
    }
    let match: typeof current[number] | undefined;
    if (row.objectNumber) {
      match = byNumber.get(normalizeKey(row.objectNumber));
    }
    if (!match) {
      const k = `${normalizeKey(row.name)}|${normalizeKey(row.parentObjectNumber)}`;
      match = byNameParent.get(k);
    }

    if (!match) {
      created.push({
        row: row.rowNumber,
        objectNumber: row.objectNumber,
        name: row.name,
        customerName: row.customerName,
        hierarchyLevel: row.hierarchyLevel,
        parentObjectNumber: row.parentObjectNumber,
        address: row.address,
        city: row.city,
        postalCode: row.postalCode,
      });
      createRows.push(row);
      continue;
    }

    if (matchedCurrentIds.has(match.id)) {
      errors.push({
        row: row.rowNumber,
        message: `Dubblett: flera rader matchar samma objekt (${match.objectNumber || match.name})`,
      });
      continue;
    }
    matchedCurrentIds.add(match.id);

    // Beräkna fält-diff. customerName är read-only och ingår inte i diff.
    const diffs: ObjectsDiffFieldChange[] = [];
    const compareFields: Array<{ field: keyof UploadedObjectsDiffRow; currentVal: unknown }> = [
      { field: "name", currentVal: match.name },
      { field: "hierarchyLevel", currentVal: match.hierarchyLevel },
      { field: "parentObjectNumber", currentVal: match.parentObjectNumber },
      { field: "address", currentVal: match.address },
      { field: "city", currentVal: match.city },
      { field: "postalCode", currentVal: match.postalCode },
    ];
    for (const f of compareFields) {
      const after = row[f.field] as string;
      if (!fieldsEqual(f.currentVal, after)) {
        diffs.push({
          field: String(f.field),
          before: normalizeStr(f.currentVal),
          after: normalizeStr(after),
        });
      }
    }

    if (diffs.length === 0) {
      unchanged++;
    } else {
      updated.push({
        id: match.id,
        objectNumber: match.objectNumber,
        name: match.name,
        customerName: match.customerName,
        fieldDiffs: diffs,
      });
      updateOps.push({ id: match.id, uploaded: row, fieldDiffs: diffs });
    }
  }

  const missing: ObjectsDiffPreview["missing"] = [];
  const missingIds: string[] = [];
  for (const c of current) {
    if (matchedCurrentIds.has(c.id)) continue;
    // Endast objekt med objectNumber räknas som "saknade" — interim/orefererade
    // objekt utan nummer ska inte plötsligt flaggas bara för att de inte är med
    // i en uppladdad partiell lista.
    if (!c.objectNumber) continue;
    missing.push({
      id: c.id,
      objectNumber: c.objectNumber,
      name: c.name,
      customerName: c.customerName,
    });
    missingIds.push(c.id);
  }

  return {
    preview: {
      totals: {
        totalUploaded: uploaded.length,
        totalCurrent: current.length,
        created: created.length,
        updated: updated.length,
        missing: missing.length,
        unchanged,
        errors: errors.length,
      },
      created,
      updated,
      missing,
      errors,
    },
    createRows,
    updateOps,
    missingIds,
  };
}

// POST /api/import/objects-diff/preview — analyserar utan att skriva
app.post(
  "/api/import/objects-diff/preview",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError("Ingen fil uppladdad");
    const tenantId = getTenantIdWithFallback(req);
    const uploaded = await parseObjectsDiffUpload(req.file);
    if (uploaded.length === 0) {
      throw new ValidationError(
        "Filen verkar tom eller har fel kolumnrubriker. " +
          "Förväntade rubriker: " +
          OBJECTS_DIFF_COLUMNS.map((c) => c.header).join(", ") +
          ". Ladda ner mallen via 'Exportera nuvarande' och ändra direkt i den.",
      );
    }
    const current = await loadObjectsForDiff(tenantId);
    const { preview } = computeObjectsDiff(uploaded, current);

    // Safety: om filen matchar väldigt lite av aktuell data är det troligen
    // ett misstag (delvis lista, fel fil). Vi flaggar detta så UI:t kan visa
    // varning innan användaren bekräftar mass-flag av saknade.
    const numberedCurrent = current.filter((c) => c.objectNumber).length;
    const matchedNumbered = numberedCurrent - preview.totals.missing;
    const matchRatio = numberedCurrent > 0 ? matchedNumbered / numberedCurrent : 1;
    res.json({
      ...preview,
      safety: {
        numberedCurrent,
        matchedNumbered,
        matchRatio,
        suspectedPartialUpload: numberedCurrent >= 5 && matchRatio < 0.5,
      },
    });
  }),
);

// POST /api/import/objects-diff/commit — applicerar diffen.
// Form-fält:
//   file:            den ifyllda XLSX/CSV-filen
//   defaultCustomerId (valfri): kund som nya rader hängs på om customerName
//     inte matchar någon befintlig kund. Utan denna hoppas create-rader över.
//   applyCreate, applyUpdate, applyMissing: "true"/"false" — låter användaren
//     välja vilka kategorier som ska tillämpas (default: alla tre).
app.post(
  "/api/import/objects-diff/commit",
  requireAdmin,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError("Ingen fil uppladdad");
    const tenantId = getTenantIdWithFallback(req);
    const userId = (req as any).user?.claims?.sub || (req as any).user?.id || null;

    const flag = (v: unknown, def = true): boolean => {
      if (v === undefined || v === null || v === "") return def;
      const s = String(v).toLowerCase();
      return s === "true" || s === "1" || s === "yes" || s === "on";
    };
    const applyCreate = flag(req.body?.applyCreate);
    const applyUpdate = flag(req.body?.applyUpdate);
    const applyMissing = flag(req.body?.applyMissing);
    const confirmAllowMassMissing = flag(req.body?.confirmAllowMassMissing, false);
    const defaultCustomerId =
      typeof req.body?.defaultCustomerId === "string" && req.body.defaultCustomerId.trim()
        ? req.body.defaultCustomerId.trim()
        : null;

    if (defaultCustomerId) {
      // Defense-in-depth: verifiera att vald standardkund tillhör tenanten
      const [owned] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, defaultCustomerId), eq(customers.tenantId, tenantId)))
        .limit(1);
      if (!owned) throw new ForbiddenError("defaultCustomerId tillhör inte din tenant");
    }

    const uploaded = await parseObjectsDiffUpload(req.file);
    if (uploaded.length === 0) {
      throw new ValidationError(
        "Filen verkar tom eller har fel kolumnrubriker. " +
          "Förväntade rubriker: " +
          OBJECTS_DIFF_COLUMNS.map((c) => c.header).join(", ") +
          ". Ladda ner mallen via 'Exportera nuvarande' och ändra direkt i den.",
      );
    }
    const current = await loadObjectsForDiff(tenantId);
    const { preview, createRows, updateOps, missingIds } = computeObjectsDiff(uploaded, current);

    // Safety-grind: om uppladdad fil matchar väldigt lite av aktuell data är
    // det nästan alltid ett misstag (delvis lista, fel fil, fel-formatterad
    // export). Mass-flag av saknade kan då felaktigt påverka hundratals
    // objekt — kräv explicit bekräftelse-flagga från klienten i så fall.
    const numberedCurrent = current.filter((c) => c.objectNumber).length;
    const matchedNumbered = numberedCurrent - missingIds.length;
    const matchRatio = numberedCurrent > 0 ? matchedNumbered / numberedCurrent : 1;
    const suspectedPartialUpload = numberedCurrent >= 5 && matchRatio < 0.5;
    if (applyMissing && suspectedPartialUpload && !confirmAllowMassMissing) {
      throw new ValidationError(
        `Säkerhetsstopp: filen matchar bara ${matchedNumbered} av ${numberedCurrent} ` +
          `numrerade objekt (${Math.round(matchRatio * 100)}%). Detta ser ut som en ` +
          `delvis lista — mass-markering av saknade objekt är blockerad. Avmarkera ` +
          `'Markera saknade' eller ladda upp den fullständiga listan.`,
      );
    }

    const batchId = `objects-diff-${Date.now()}`;
    const now = new Date();
    const customerByName = new Map<string, string>();
    for (const c of current) {
      if (c.customerId && c.customerName) {
        customerByName.set(normalizeKey(c.customerName), c.customerId);
      }
    }
    // Komplett kundlista som fallback för rader vars customerName inte matchar
    // ett befintligt objekts kund (t.ex. första gången en kund får ett objekt).
    const allCustomers = await storage.getCustomers(tenantId);
    for (const c of allCustomers) {
      const k = normalizeKey(c.name);
      if (!customerByName.has(k)) customerByName.set(k, c.id);
    }

    let appliedCreated = 0;
    let appliedUpdated = 0;
    let appliedMissingMarked = 0;
    const applyErrors: Array<{ row: number; message: string }> = [];
    const createdIds: string[] = [];
    const updatedIds: string[] = [];

    // Indexera nuvarande objects efter objectNumber för parent-resolution
    const idByObjectNumber = new Map<string, string>();
    for (const c of current) {
      if (c.objectNumber) idByObjectNumber.set(normalizeKey(c.objectNumber), c.id);
    }

    if (applyUpdate) {
      for (const op of updateOps) {
        try {
          // Bygg patch atomiskt — om något fält inte kan resolvas (t.ex. parent
          // saknas) hoppar vi över HELA raden istället för att applicera en
          // partiell uppdatering som missvisar operatören.
          const patch: Partial<typeof objects.$inferInsert> = {};
          let skipRow = false;
          for (const d of op.fieldDiffs) {
            const after = d.after ?? "";
            switch (d.field) {
              case "name":
                patch.name = after;
                break;
              case "hierarchyLevel":
                patch.hierarchyLevel = after || null;
                break;
              case "parentObjectNumber": {
                if (after === "") {
                  patch.parentId = null;
                } else {
                  const pid = idByObjectNumber.get(normalizeKey(after));
                  if (!pid) {
                    applyErrors.push({
                      row: op.uploaded.rowNumber,
                      message:
                        `Parent-objectNumber "${after}" hittades inte — hela raden hoppades över`,
                    });
                    skipRow = true;
                    break;
                  }
                  patch.parentId = pid;
                }
                break;
              }
              case "address":
                patch.address = after || null;
                break;
              case "city":
                patch.city = after || null;
                break;
              case "postalCode":
                patch.postalCode = after || null;
                break;
            }
          }
          if (skipRow) continue;
          if (Object.keys(patch).length === 0) continue;
          // Defense-in-depth: tenant_id i WHERE även om vi redan slagit upp via tenant
          const result = await db
            .update(objects)
            .set({ ...patch, importBatchId: batchId })
            .where(
              and(
                eq(objects.id, op.id),
                eq(objects.tenantId, tenantId),
                isNull(objects.deletedAt),
              ),
            )
            .returning({ id: objects.id });
          if (result.length > 0) {
            appliedUpdated++;
            updatedIds.push(op.id);
            await db.insert(auditLogs).values({
              tenantId,
              userId,
              action: "objects_diff_update",
              resourceType: "object",
              resourceId: op.id,
              changes: {
                before: Object.fromEntries(op.fieldDiffs.map((d) => [d.field, d.before])),
                after: Object.fromEntries(op.fieldDiffs.map((d) => [d.field, d.after])),
              },
              metadata: { batchId, source: "objects-diff" },
            });
          }
        } catch (err: any) {
          applyErrors.push({
            row: op.uploaded.rowNumber,
            message: `Uppdatering misslyckades: ${err?.message || String(err)}`,
          });
        }
      }
    }

    if (applyCreate) {
      // Sortera create-rader så föräldrar (utan parent) skapas före barn när
      // möjligt. Vi gör flera pass tills inget mer kan skapas.
      const remaining = [...createRows];
      const localCreated = new Map<string, string>(); // objectNumber → newId
      const localCustomerById = new Map<string, string>(); // newId → customerId (för kund-arv till barn-rader)
      let progress = true;
      while (remaining.length > 0 && progress) {
        progress = false;
        for (let i = remaining.length - 1; i >= 0; i--) {
          const row = remaining[i];
          let parentId: string | null = null;
          if (row.parentObjectNumber) {
            const pid =
              idByObjectNumber.get(normalizeKey(row.parentObjectNumber)) ||
              localCreated.get(normalizeKey(row.parentObjectNumber));
            if (!pid) continue; // försök i nästa pass
            parentId = pid;
          }
          // Resolva customerId
          let customerId: string | null = null;
          if (row.customerName) {
            customerId = customerByName.get(normalizeKey(row.customerName)) || null;
          }
          if (!customerId && parentId) {
            const parent = current.find((c) => c.id === parentId);
            if (parent?.customerId) customerId = parent.customerId;
            else if (localCustomerById.has(parentId)) {
              // Föräldern skapades i denna körning — ärv dess kund
              customerId = localCustomerById.get(parentId) || null;
            }
          }
          if (!customerId && defaultCustomerId) customerId = defaultCustomerId;
          if (!customerId) {
            applyErrors.push({
              row: row.rowNumber,
              message:
                "Kund kunde inte härledas (ange customerName som matchar befintlig kund, eller välj en standardkund)",
            });
            remaining.splice(i, 1);
            progress = true;
            continue;
          }
          try {
            const created = await storage.createObject({
              tenantId,
              customerId,
              parentId: parentId || undefined,
              name: row.name,
              objectNumber: row.objectNumber || null,
              hierarchyLevel: row.hierarchyLevel || undefined,
              address: row.address || null,
              city: row.city || null,
              postalCode: row.postalCode || null,
              importBatchId: batchId,
            } as any);
            appliedCreated++;
            createdIds.push(created.id);
            localCustomerById.set(created.id, customerId);
            if (row.objectNumber) {
              localCreated.set(normalizeKey(row.objectNumber), created.id);
              idByObjectNumber.set(normalizeKey(row.objectNumber), created.id);
            }
            await db.insert(auditLogs).values({
              tenantId,
              userId,
              action: "objects_diff_create",
              resourceType: "object",
              resourceId: created.id,
              changes: { after: { name: row.name, objectNumber: row.objectNumber } },
              metadata: { batchId, source: "objects-diff" },
            });
          } catch (err: any) {
            applyErrors.push({
              row: row.rowNumber,
              message: `Skapande misslyckades: ${err?.message || String(err)}`,
            });
          }
          remaining.splice(i, 1);
          progress = true;
        }
      }
      // Rader kvar = oresolverbara parent-referenser
      for (const row of remaining) {
        applyErrors.push({
          row: row.rowNumber,
          message: `parentObjectNumber "${row.parentObjectNumber}" hittades inte (varken befintligt objekt eller nyskapad rad i denna fil)`,
        });
      }
    }

    if (applyMissing && missingIds.length > 0) {
      // Markera saknade rader med reconciliationFlag (raderas aldrig automatiskt)
      const upd = await db
        .update(objects)
        .set({
          reconciliationFlag: "missing_in_diff_reimport",
          reconciliationFlaggedAt: now,
          reconciliationBatchId: batchId,
        })
        .where(
          and(
            eq(objects.tenantId, tenantId),
            inArray(objects.id, missingIds),
            isNull(objects.deletedAt),
          ),
        )
        .returning({ id: objects.id });
      appliedMissingMarked = upd.length;
      if (upd.length > 0) {
        await db.insert(auditLogs).values(
          upd.map((u) => ({
            tenantId,
            userId,
            action: "objects_diff_mark_missing",
            resourceType: "object",
            resourceId: u.id,
            changes: { after: { reconciliationFlag: "missing_in_diff_reimport" } },
            metadata: { batchId, source: "objects-diff" },
          })),
        );
      }
    }

    await db.insert(importBatches).values({
      tenantId,
      batchId,
      totalRows: uploaded.length,
      created: appliedCreated,
      updated: appliedUpdated,
      errors: applyErrors.length + preview.errors.length,
      metadata: {
        type: "objects-diff",
        source: "objects-diff",
        status: "completed",
        startedBy: userId,
        applyCreate,
        applyUpdate,
        applyMissing,
        defaultCustomerId,
        missingMarked: appliedMissingMarked,
        unchanged: preview.totals.unchanged,
        previewTotals: preview.totals,
        applyErrors: applyErrors.slice(0, 100),
        parseErrors: preview.errors.slice(0, 100),
      },
    });

    // Invalidera vyer som beror på objektlistan
    try {
      invalidateWorkflowCaches(tenantId);
    } catch {
      /* cache är best-effort */
    }
    try {
      invalidateAreaSearchCityCache(tenantId);
    } catch {
      /* cache är best-effort */
    }

    res.json({
      batchId,
      applied: {
        created: appliedCreated,
        updated: appliedUpdated,
        missingMarked: appliedMissingMarked,
      },
      skipped: {
        create: !applyCreate,
        update: !applyUpdate,
        missing: !applyMissing,
      },
      errors: [...preview.errors, ...applyErrors],
      preview: preview.totals,
    });
  }),
);

}
