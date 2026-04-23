import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, isNotNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError, describeFortnoxMappingConflict } from "../errors";
import multer from "multer";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { importJobs, notifyImportProgress } from "./helpers";
import { geocodeAddress } from "../google-geocoding";
import { triggerGeocodeIfMissing } from "../services/geocoding";
import { objects, workOrders, customers, objectMetadata, workOrderLines, metadataKatalog, fortnoxMappings, customerServiceContracts, type InsertFortnoxContractSuggestion, type InsertWorkOrder } from "@shared/schema";
import { createMetadata, getAllMetadataTypes } from "../metadata-queries";
import { ensureClusterForCustomer, updateClusterCache } from "../auto-cluster";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req: any, file: any, cb: any) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Endast CSV-filer är tillåtna'));
    }
  }
});

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

function parseFortnoxXlsx(buffer: Buffer): Record<string, string>[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
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
app.post("/api/import/customers", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }
    
    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    
    if (result.errors.length > 0) {
      return res.status(400).json({ error: "CSV-fel", details: result.errors });
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
      return res.status(400).json({ error: "CSV-fel", details: result.errors });
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
      return res.status(400).json({ error: "CSV-fel", details: result.errors });
    }
    
    // First, get all customers to map names to IDs
    const tenantId = getTenantIdWithFallback(req);
    const customers = await storage.getCustomers(tenantId);
    const customerMap = new Map(customers.map(c => [c.name.toLowerCase(), c.id]));
    
    // Track created objects by objectNumber for parent lookups
    const objectNumberMap = new Map<string, string>();
    
    const imported: string[] = [];
    const errors: string[] = [];
    const csvImportClusterIds = new Set<string>();
    
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
          customerId,
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
          accessType: row.accessType || row.tillgång || row.Tillgång || "open",
          accessCode: row.accessCode || row.portkod || row.Portkod || null,
          keyNumber: row.keyNumber || row.nyckelnummer || row.Nyckelnummer || null,
          containerCount: row.containerCount || row.kärl ? parseInt(row.containerCount || row.kärl || "0") : 0,
          containerCountK2: row.containerCountK2 || row.k2 ? parseInt(row.containerCountK2 || row.k2 || "0") : 0,
          containerCountK3: row.containerCountK3 || row.k3 ? parseInt(row.containerCountK3 || row.k3 || "0") : 0,
          containerCountK4: row.containerCountK4 || row.k4 ? parseInt(row.containerCountK4 || row.k4 || "0") : 0,
        };
        
        if (!objectData.name) {
          errors.push(`Rad saknar namn`);
          continue;
        }
        
        const createdObject = await storage.createObject(objectData);

        try {
          const clusterId = await ensureClusterForCustomer(tenantId, customerId);
          await storage.updateObject(createdObject.id, { clusterId });
          csvImportClusterIds.add(clusterId);
        } catch (clusterErr) {
          console.error("Auto-cluster error:", clusterErr);
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
    
    for (const cId of csvImportClusterIds) {
      updateClusterCache(cId).catch(e => console.error("Cluster cache update error:", e));
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
      return res.status(400).json({ error: parseResult.error.errors });
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
      return res.status(400).json({ error: parseResult.error.errors });
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
      
      headers = ["namn", "objektnummer", "typ", "nivå", "kund", "adress", "stad", "tillgång", "tillgångskod", "kärl"];
      data = objects.map(o => ({
        namn: o.name,
        objektnummer: o.objectNumber || "",
        typ: o.objectType,
        nivå: o.objectLevel,
        kund: customerMap.get(o.customerId) || "",
        adress: o.address || "",
        stad: o.city || "",
        tillgång: o.accessType || "open",
        tillgångskod: o.accessCode || "",
        kärl: o.containerCount || 0,
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

    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Geoapify API-nyckel saknas. Konfigurera den i inställningarna." });
    }

    const waypoints = coordinates
      .map(([lon, lat]: [number, number]) => `${lat},${lon}`)
      .join("|");

    console.log(`[routing] Requesting Geoapify route with ${coordinates.length} waypoints`);

    const response = await fetch(
      `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&apiKey=${apiKey}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[routing] Geoapify routing error:", response.status, errorText);
      return res.status(response.status).json({ error: "Kunde inte beräkna rutten" });
    }

    const data = await response.json();
    console.log(`[routing] Got ${data?.features?.length || 0} features, distance: ${data?.features?.[0]?.properties?.distance || 'N/A'}`);
    res.json(data);
}));

app.post("/api/routes/optimize", asyncHandler(async (req, res) => {
    const { jobs, agents, vehicles } = req.body;
    const resolvedAgents = agents || vehicles;
    
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Geoapify API-nyckel saknas. Konfigurera den i inställningarna." });
    }

    const response = await fetch(
      `https://api.geoapify.com/v1/routeplanner?apiKey=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "drive",
          jobs,
          agents: resolvedAgents,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Geoapify route planner error:", errorText);
      return res.status(response.status).json({ error: "Route optimization failed" });
    }

    const data = await response.json();
    res.json(data);
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

    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      delimiter: ";",
    });

    if (result.errors.length > 0) {
      return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
    }

    const rows = result.data as Record<string, string>[];
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
        const geoResult = await geocodeAddress(fullAddress, tenantId);
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
app.post("/api/import/modus/objects", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }
    
    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, { 
      header: true, 
      skipEmptyLines: true,
      delimiter: ";",
    });
    
    if (result.errors.length > 0) {
      return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
    }

    const customerNames = new Set<string>();
    for (const row of result.data as Record<string, string>[]) {
      const kundName = row["Kund"];
      if (kundName) {
        const match = kundName.match(/^(.+?)\s*\(\d+\)$/);
        const cleanName = match ? match[1].trim() : kundName.trim();
        if (cleanName) customerNames.add(cleanName);
      }
    }

    const tenantId = getTenantIdWithFallback(req);
    const importBatchId = crypto.randomUUID();
    const totalRows = (result.data as unknown[]).length;
    
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
    
    importJobs.set(importBatchId, { tenantId, status: "running", phase: "kunder", processed: 0, total: totalRows, created: 0, updated: 0, errors: 0, listeners: new Set() });
    
    res.json({ importBatchId, status: "started", totalRows });
    
    // Continue import in background
    
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
      }
    }

    const job = importJobs.get(importBatchId)!;
    job.phase = "objekt";
    notifyImportProgress(importBatchId);
    
    const modusIdMap = new Map<string, string>();
    const modusOldClusterIds = new Set<string>();
    const created: string[] = [];
    const updated: string[] = [];
    const errors: string[] = [];
    const skipped: string[] = [];
    
    for (const row of result.data as Record<string, string>[]) {
      try {
        const modusId = (row["Id"] || "").replace(/\s/g, "");
        const originalName = row["Namn"] || "";
        const name = nameOverrides.objects?.[modusId] || originalName;
        const typ = row["Typ"] || "Område";
        const parent = (row["Parent"] || "").replace(/\s/g, "");
        const kundRaw = row["Kund"] || "";
        
        if (!originalName || !modusId) {
          skipped.push(`Rad utan namn eller ID`);
          continue;
        }
        
        // Extract customer name
        const kundMatch = kundRaw.match(/^(.+?)\s*\(\d+\)$/);
        const kundName = kundMatch ? kundMatch[1].trim() : kundRaw.trim();
        const customerId = customerMap.get(kundName.toLowerCase());
        
        if (!customerId) {
          errors.push(`Kund "${kundName}" hittades inte för "${name}"`);
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
        
        // Determine access type from metadata
        let accessType = "open";
        let accessCode = null;
        let keyNumber = null;
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
        
        // Parse description for contact info
        const beskrivning = row["Beskrivning"] || "";
        let accessInfo = {};
        if (beskrivning) {
          const lines = beskrivning.split("\n");
          if (lines.length >= 2) {
            accessInfo = {
              contactPerson: lines[1]?.trim() || null,
              phone: lines[2]?.trim() || null,
              email: lines[3]?.trim() || null,
            };
          }
        }
        
        // Determine object level based on type hierarchy
        let objectLevel = 1; // Område = top level
        if (objectType === "fastighet") objectLevel = 2;
        else if (objectType === "rum" || objectType === "miljokarl" || objectType === "underjord" || 
                 objectType === "kok" || objectType === "matafall" || objectType === "atervinning" ||
                 objectType === "uj_hushallsavfall") objectLevel = 3;
        else if (objectType === "omrade" && parent) objectLevel = 2;
        
        const objectNumber = `MODUS-${modusId}`;

        const what3words = (row["What3words"] || row["What3Words"] || row["what3words"] || row["W3W"] || "").trim() || null;
        
        const hierarchyLevelMap: Record<number, string> = { 1: "omrade", 2: "fastighet", 3: "serviceenhet" };
        const objectFields = {
          customerId,
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
          accessType,
          accessCode,
          keyNumber,
          accessInfo,
          containerCount,
          ...(what3words ? { notes: `W3W: ${what3words}` } : {}),
        };
        
        const existingObject = await storage.getObjectByObjectNumber(tenantId, objectNumber);
        
        let clusterId: string | undefined;
        try {
          clusterId = await ensureClusterForCustomer(tenantId, customerId);
        } catch (clusterErr) {
          console.error("Auto-cluster error:", clusterErr);
        }

        if (existingObject) {
          if (existingObject.clusterId && existingObject.clusterId !== clusterId) {
            modusOldClusterIds.add(existingObject.clusterId);
          }
          const { parentId: _p, ...updateFields } = objectFields;
          const updatedObject = await storage.updateObject(existingObject.id, {
            ...updateFields,
            ...(clusterId ? { clusterId } : {}),
          });
          if (updatedObject) {
            modusIdMap.set(modusId, updatedObject.id);
            updated.push(name);
            job.updated++;
            if (updatedObject.address && (updatedObject.latitude == null || updatedObject.longitude == null)) {
              triggerGeocodeIfMissing(updatedObject.id);
            }
          }
        } else {
          const createdObject = await storage.createObject({
            tenantId,
            ...objectFields,
            ...(clusterId ? { clusterId } : {}),
            importBatchId,
          });
          modusIdMap.set(modusId, createdObject.id);
          created.push(name);
          job.created++;
          triggerGeocodeIfMissing(createdObject.id);
        }
      } catch (err) {
        console.error("Modus object import error:", err);
        errors.push(`Rad ${row["Id"] || "?"}: ${err}`);
        job.errors++;
      }
      job.processed++;
      if (job.processed % 10 === 0) notifyImportProgress(importBatchId);
    }
    
    job.phase = "hierarki";
    notifyImportProgress(importBatchId);
    
    let parentsUpdated = 0;
    for (const row of result.data as Record<string, string>[]) {
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
    
    const affectedClusterIds = new Set<string>(modusOldClusterIds);
    for (const [, objId] of modusIdMap) {
      const obj = await storage.getObject(objId);
      if (obj?.clusterId) affectedClusterIds.add(obj.clusterId);
    }
    for (const cId of affectedClusterIds) {
      updateClusterCache(cId).catch(e => console.error("Cluster cache update error:", e));
    }

    job.phase = "metadata";
    notifyImportProgress(importBatchId);
    
    let metadataWritten = 0;
    const metadataErrors: string[] = [];
    
    const metadataTypes = await getAllMetadataTypes(tenantId);
    const metadataTypeMap = new Map(metadataTypes.map(t => [t.namn.toLowerCase(), t]));
    
    // Detect all "Metadata - *" columns from first row
    const firstRow = (result.data as Record<string, string>[])[0];
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
    
    if (metadataColumns.length > 0) {
      for (const row of result.data as Record<string, string>[]) {
        const modusId = (row["Id"] || "").replace(/\s/g, "");
        const objectId = modusId ? modusIdMap.get(modusId) : null;
        if (!objectId) continue;
        
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
      }
    }
    
    const responseData = { 
      importBatchId,
      imported: created.length + updated.length,
      created: created.length,
      updated: updated.length,
      parentsUpdated,
      customersCreated: customerNames.size,
      skipped: skipped.length,
      metadataWritten,
      metadataColumns: metadataColumns.map(c => c.metadataName),
      errors: [...errors, ...metadataErrors].slice(0, 50),
      totalRows: (result.data as unknown[]).length,
      scorecardSummary,
    };
    
    try {
      const { importBatches: importBatchesTable } = await import("@shared/schema");
      await db.insert(importBatchesTable).values({
        tenantId,
        batchId: importBatchId,
        totalRows: (result.data as unknown[]).length,
        created: created.length,
        updated: updated.length,
        errors: errors.length + metadataErrors.length,
        scorecardSummary: scorecardSummary || null,
        metadata: {
          metadataWritten,
          metadataColumns: metadataColumns.map(c => c.metadataName),
          parentsUpdated,
          customersCreated: customerNames.size,
          scorecardCategories: scorecardSummary?.categories || null,
        },
      });
    } catch (e) {
      console.error("Failed to persist import batch:", e);
    }

    job.status = "completed";
    job.phase = "klar";
    job.result = responseData;
    notifyImportProgress(importBatchId);
    setTimeout(() => importJobs.delete(importBatchId), 300000);
}));

// Modus 2.0 Import - Tasks (uppgifter)
// Preview/validate tasks CSV before import - returns missing objects/customers and duplicates
app.post("/api/import/modus/tasks/validate", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }
    const csvText = req.file.buffer.toString("utf-8");
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true, delimiter: ";" });
    if (parsed.errors.length > 0) {
      return res.status(400).json({ error: "CSV-fel", details: parsed.errors.slice(0, 10) });
    }
    const tenantId = getTenantIdWithFallback(req);
    const rows = parsed.data as Record<string, string>[];

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

    const existingWorkOrders = await storage.getWorkOrders(tenantId);
    const existingExternalRefs = new Set<string>();
    for (const wo of existingWorkOrders) {
      const meta = (wo.metadata ?? {}) as { modusId?: string };
      if (meta.modusId) existingExternalRefs.add(String(meta.modusId));
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
    
    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, { 
      header: true, 
      skipEmptyLines: true,
      delimiter: ";",
    });
    
    if (result.errors.length > 0) {
      return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
    }

    const tenantId = getTenantIdWithFallback(req);
    const taskBatchId = crypto.randomUUID();

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

    // Preload existing work orders and index by modusId/externalReference to avoid N queries
    const existingWorkOrders = await storage.getWorkOrders(tenantId);
    const workOrderByModusId = new Map<string, { id: string }>();
    for (const wo of existingWorkOrders) {
      const meta = (wo.metadata ?? {}) as { modusId?: string };
      if (meta.modusId) {
        workOrderByModusId.set(String(meta.modusId), wo);
      }
      if (wo.externalReference) {
        workOrderByModusId.set(String(wo.externalReference), wo);
      }
    }

    const created: string[] = [];
    const updated: string[] = [];
    const errors: string[] = [];
    const skipped: string[] = [];
    
    for (const row of result.data as Record<string, string>[]) {
      try {
        const uppgiftsId = row["Uppgifts Id"];
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
      errors: errors.slice(0, 50),
      totalRows: (result.data as unknown[]).length,
    });
}));

// Modus 2.0 Import - Task Events (for setup time analysis)
app.post("/api/import/modus/events", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }
    
    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, { 
      header: true, 
      skipEmptyLines: true,
      delimiter: ";",
    });
    
    if (result.errors.length > 0) {
      return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
    }

    // Group events by Uppgifts Id to calculate setup times
    const eventsByTask = new Map<string, Array<{ type: string; time: Date }>>();
    
    for (const row of result.data as Record<string, string>[]) {
      const uppgiftsId = row["Uppgifts Id"];
      const eventTyp = row["Event Typ"];
      const tid = row["Tid"];
      
      if (!uppgiftsId || !tid) continue;
      
      const time = new Date(tid);
      if (isNaN(time.getTime())) continue;
      
      if (!eventsByTask.has(uppgiftsId)) {
        eventsByTask.set(uppgiftsId, []);
      }
      eventsByTask.get(uppgiftsId)!.push({ type: eventTyp, time });
    }
    
    // Calculate setup times (time between in_progress events on same task)
    // This approximates setup time as the gap between consecutive task starts
    const setupTimes: Array<{ taskId: string; minutes: number }> = [];
    
    for (const [taskId, events] of Array.from(eventsByTask)) {
      // Sort by time
      events.sort((a: { type: string; time: Date }, b: { type: string; time: Date }) => a.time.getTime() - b.time.getTime());
      
      // Find in_progress -> done pairs
      for (let i = 0; i < events.length - 1; i++) {
        if (events[i].type === "in_progress" && events[i + 1].type === "done") {
          const duration = (events[i + 1].time.getTime() - events[i].time.getTime()) / (1000 * 60);
          if (duration > 0 && duration < 240) { // Max 4 hours
            setupTimes.push({ taskId, minutes: Math.round(duration) });
          }
        }
      }
    }
    
    res.json({ 
      totalEvents: (result.data as unknown[]).length,
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
    });
}));

// Modus 2.0 Import - Invoice Lines (fakturarader)
app.post("/api/import/modus/invoice-lines", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }
    
    const csvText = req.file.buffer.toString("utf-8");
    const result = Papa.parse(csvText, { 
      header: true, 
      skipEmptyLines: true,
      delimiter: ";",
    });
    
    if (result.errors.length > 0) {
      return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
    }

    const tenantId = getTenantIdWithFallback(req);
    const invoiceBatchId = crypto.randomUUID();
    
    const allWorkOrders = await storage.getWorkOrders(tenantId);
    const woByModusId = new Map<string, any>();
    for (const wo of allWorkOrders) {
      const meta = wo.metadata as any;
      if (meta?.modusId) {
        woByModusId.set(String(meta.modusId), wo);
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
    
    for (const row of result.data as Record<string, string>[]) {
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
        });
        
        created.push(`${uppgiftId}/${rad}: ${beskrivning.substring(0, 40)}`);
      } catch (err) {
        errors.push(`Fel vid import av fakturarad ${row["Uppgift Id"] || "?"}/${row["Rad"] || "?"}: ${err}`);
      }
    }
    
    res.json({ 
      importBatchId: invoiceBatchId,
      imported: created.length,
      created: created.length,
      articlesAutoCreated,
      errors: errors.slice(0, 50),
      totalRows: (result.data as unknown[]).length,
    });
}));

app.post("/api/import/customers/validate", upload.single("file"), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError("Ingen fil uppladdad");
    }

    const csvText = req.file.buffer.toString("utf-8");
    const delimiter = csvText.includes(";") ? ";" : ",";
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true, delimiter });

    if (result.errors.length > 0) {
      return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
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

  const rawRows = parseFortnoxXlsx(req.file.buffer);
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

  const rawRows = parseFortnoxXlsx(req.file.buffer);
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
      return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
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
      return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
    }

    const tenantId = getTenantIdWithFallback(req);
    const existingObjects = await storage.getObjects(tenantId);
    const objectByNumber = new Map(existingObjects.map(o => [o.objectNumber?.toLowerCase() || "", o]));
    const objectByName = new Map(existingObjects.map(o => [o.name.toLowerCase(), o]));

    const rows = result.data as Record<string, string>[];
    const metadataTypes = await getAllMetadataTypes(tenantId);
    const metadataTypeMap = new Map(metadataTypes.map(t => [t.namn.toLowerCase(), t]));

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
          sql`(${objects.customerId} IS NULL OR NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = ${objects.customerId} AND c.tenant_id = ${tenantId} AND c.deleted_at IS NULL))`,
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
      db.select({ count: sql<number>`count(*)::int` })
        .from(objectMetadata)
        .where(eq(objectMetadata.tenantId, tenantId)),
      db.select({ count: sql<number>`count(*)::int` })
        .from(objectMetadata)
        .where(and(
          eq(objectMetadata.tenantId, tenantId),
          sql`(${objectMetadata.value} IS NULL OR ${objectMetadata.value} = '')`,
          isNull(objectMetadata.valueJson),
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
          const matchingMeta = metadataTypes.find((m: any) => 
            m.beteckning?.toLowerCase() === colLower || m.name?.toLowerCase() === colLower
          );
          if (matchingMeta) {
            bestMeta = matchingMeta.beteckning || matchingMeta.name;
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
    
    await db.update(importBatches)
      .set({ metadata: sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{rolledBack}', 'true')` })
      .where(eq(importBatches.batchId, batchId));
    
    res.json({
      success: true,
      rolledBack: {
        objects: (deletedObjects.rows || deletedObjects).length,
        workOrders: (deletedOrders.rows || deletedOrders).length,
        customers: (deletedCustomers.rows || deletedCustomers).length,
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
    const mappedOldClusterIds = new Set<string>();
    
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
        
        let clusterId: string | undefined;
        try {
          clusterId = await ensureClusterForCustomer(tenantId, customerId);
        } catch (clusterErr) {
          console.error("Auto-cluster error (mapped import):", clusterErr);
        }
        if (clusterId) objData.clusterId = clusterId;

        let objId: string;
        if (existing.length > 0) {
          if (existing[0].clusterId && existing[0].clusterId !== clusterId) {
            mappedOldClusterIds.add(existing[0].clusterId);
          }
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
    
    const affectedClusterIdsMapped = new Set<string>(mappedOldClusterIds);
    const allMappedObjs = await db.select({ id: objects.id, clusterId: objects.clusterId })
      .from(objects).where(and(eq(objects.tenantId, tenantId), eq(objects.importBatchId, batchId)));
    for (const o of allMappedObjs) {
      if (o.clusterId) {
        affectedClusterIdsMapped.add(o.clusterId);
      }
    }
    for (const cId of affectedClusterIdsMapped) {
      updateClusterCache(cId).catch(e => console.error("Cluster cache update error:", e));
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

// P20: Import history with rollback status
app.get("/api/import/history", asyncHandler(async (req, res) => {
    const tenantId = getTenantIdWithFallback(req);
    const { importBatches } = await import("@shared/schema");
    
    const batches = await db.select().from(importBatches)
      .where(eq(importBatches.tenantId, tenantId))
      .orderBy(desc(importBatches.createdAt))
      .limit(50);
    
    res.json(batches);
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
      return res.status(400).json({ error: "CSV-fel", details: result.errors.slice(0, 10) });
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
      return res.status(400).json({
        error: "CSV måste ha kolumnerna 'Id' och 'Parent'",
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

        const geoResult = await geocodeAddress(fullAddress, tenantId);
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
        return res.status(400).json({ error: "Ogiltig latitud (måste vara -90 till 90)" });
      }
      updates.latitude = lat;
    }
    if (longitude !== undefined) {
      const lng = longitude !== null ? Number(longitude) : null;
      if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) {
        return res.status(400).json({ error: "Ogiltig longitud (måste vara -180 till 180)" });
      }
      updates.longitude = lng;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Inga fält att uppdatera" });
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

    res.json({
      pastOrdersUpdated: pastCount,
      noDateOrdersUpdated: noDateCount,
      totalUpdated: pastCount + noDateCount,
    });
}));

}
