import type { Express } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, sql, desc, and, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatZodError, verifyTenantOwnership, DEFAULT_TENANT_ID } from "./helpers";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import multer from "multer";
import Papa from "papaparse";
import { importJobs, notifyImportProgress } from "./helpers";
import { geocodeAddress } from "../google-geocoding";

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
        
        // Store mapping for parent lookups
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

    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Geoapify API key not configured" });
    }

    const waypoints = coordinates
      .map(([lon, lat]: [number, number]) => `${lat},${lon}`)
      .join("|");

    const response = await fetch(
      `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&apiKey=${apiKey}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Geoapify routing error:", errorText);
      return res.status(response.status).json({ error: "Route calculation failed" });
    }

    const data = await response.json();
    res.json(data);
}));

app.post("/api/routes/optimize", asyncHandler(async (req, res) => {
    const { jobs, agents, vehicles } = req.body;
    const resolvedAgents = agents || vehicles;
    
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Geoapify API key not configured" });
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

    const GEOCODE_BATCH_LIMIT = 50;
    const geocodeBatch = rowsNeedingGeocode.slice(0, GEOCODE_BATCH_LIMIT);
    for (const item of geocodeBatch) {
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
    const geocodeSkipped = rowsNeedingGeocode.length - geocodeBatch.length;
    for (let j = GEOCODE_BATCH_LIMIT; j < rowsNeedingGeocode.length; j++) {
      addressRows[rowsNeedingGeocode[j].index].geocodeStatus = "skipped";
      addressRows[rowsNeedingGeocode[j].index].issue = "Ej geokodad (batchgräns)";
    }

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
    
    importJobs.set(importBatchId, { tenantId, status: "running", phase: "kunder", processed: 0, total: totalRows, created: 0, updated: 0, errors: 0, listeners: new Set() });
    
    res.json({ importBatchId, status: "started", totalRows });
    
    // Continue import in background
    
    const existingCustomers = await storage.getCustomers(tenantId);
    const customerMap = new Map(existingCustomers.map(c => [c.name.toLowerCase(), c.id]));
    
    for (const name of Array.from(customerNames)) {
      if (!customerMap.has(name.toLowerCase())) {
        const newCustomer = await storage.createCustomer({
          tenantId,
          name: name,
          importBatchId,
        });
        customerMap.set(name.toLowerCase(), newCustomer.id);
      }
    }

    const job = importJobs.get(importBatchId)!;
    job.phase = "objekt";
    notifyImportProgress(importBatchId);
    
    const modusIdMap = new Map<string, string>();
    const created: string[] = [];
    const updated: string[] = [];
    const errors: string[] = [];
    const skipped: string[] = [];
    
    for (const row of result.data as Record<string, string>[]) {
      try {
        const modusId = (row["Id"] || "").replace(/\s/g, "");
        const name = row["Namn"] || "";
        const typ = row["Typ"] || "Område";
        const parent = (row["Parent"] || "").replace(/\s/g, "");
        const kundRaw = row["Kund"] || "";
        
        if (!name || !modusId) {
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
        
        const objectFields = {
          customerId,
          parentId: null as string | null,
          name,
          objectNumber,
          objectType,
          objectLevel,
          address: row["Adress 1"] || null,
          city: row["Ort"] || null,
          postalCode: row["Postnummer"] || null,
          latitude,
          longitude,
          accessType,
          accessCode,
          keyNumber,
          accessInfo,
          containerCount,
        };
        
        const existingObject = await storage.getObjectByObjectNumber(tenantId, objectNumber);
        
        if (existingObject) {
          const { parentId: _p, ...updateFields } = objectFields;
          const updatedObject = await storage.updateObject(existingObject.id, updateFields);
          if (updatedObject) {
            modusIdMap.set(modusId, updatedObject.id);
            updated.push(name);
            job.updated++;
          }
        } else {
          const createdObject = await storage.createObject({ tenantId, ...objectFields, importBatchId });
          modusIdMap.set(modusId, createdObject.id);
          created.push(name);
          job.created++;
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
          const metadataName = key.replace("Metadata - ", "").trim();
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
              const { metadataKatalog: mkSchema } = await import("@shared/schema");
              const [newType] = await db.insert(mkSchema).values({
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
    const objects = await storage.getObjects(tenantId);
    const objectMap = new Map(objects.map(o => [o.objectNumber, o]));
    
    const customers = await storage.getCustomers(tenantId);
    const customerMap = new Map(customers.map(c => [c.name.toLowerCase(), c.id]));
    
    const resources = await storage.getResources(tenantId);
    const resourceMap = new Map(resources.map(r => [r.name.toLowerCase(), r.id]));
    
    const created: string[] = [];
    const updated: string[] = [];
    const errors: string[] = [];
    
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
          resourceId = resourceMap.get(team.toLowerCase());
          if (!resourceId) {
            const newResource = await storage.createResource({
              tenantId,
              name: team,
              initials: team.substring(0, 3).toUpperCase(),
            });
            resourceId = newResource.id;
            resourceMap.set(team.toLowerCase(), resourceId);
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
        
        // Map status
        let mappedStatus = "draft";
        if (status === "done") mappedStatus = "completed";
        else if (status === "in_progress") mappedStatus = "in_progress";
        else if (status === "not_started" || status === "scheduled") mappedStatus = "scheduled";
        else if (status === "not_feasible") mappedStatus = "cancelled";
        
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
        
        const workOrderFields = {
          customerId: object.customerId,
          objectId: object.id,
          resourceId,
          title: uppgiftsnamn,
          description: `Modus ID: ${uppgiftsId}, Typ: ${uppgiftstyp}`,
          orderType,
          priority: "normal",
          status: mappedStatus,
          scheduledDate,
          scheduledStartTime,
          estimatedDuration: Math.round(parsedVaraktighet),
          cachedCost: Math.round(parsedKostnad * 100),
          cachedValue: Math.round(parsedPris * 100),
          notes: resultat || null,
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
        
        const existingWo = await storage.getWorkOrderByModusId(tenantId, uppgiftsId);
        
        if (existingWo) {
          await storage.updateWorkOrder(existingWo.id, workOrderFields);
          updated.push(uppgiftsnamn);
        } else {
          await storage.createWorkOrder({ tenantId, ...workOrderFields, importBatchId: taskBatchId });
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

}
