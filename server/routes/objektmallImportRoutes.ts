// Task #603: Objektimport från Excel-mall (Steg 1-3 + metadata).
//
// Endpoints (alla kräver admin/owner i tenant):
//   GET    /api/admin/objektmall/template          ladda ner aktuell mall (.xlsx)
//   POST   /api/admin/objektmall/preview           torrkörning (multipart .xlsx)
//   POST   /api/admin/objektmall/commit            skarp atomär import (multipart .xlsx)
//   GET    /api/admin/objektmall/history           tidigare körningar
//   GET    /api/admin/objektmall/history/:batchId  detaljer för en körning
//
// Re-import:
//   Befintliga rader identifieras via (tenantId, objectNumber) där
//   objectNumber = OBJEKTMALL_INTERIM_PREFIX + interim. På så vis kan samma
//   mall köras igen utan att skapa dubbletter — ändrade fält uppdateras.

import type { Express } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { z } from "zod";
import { and, eq, sql, desc, inArray } from "drizzle-orm";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";
import { getTenantIdWithFallback, requireAdmin, requireTenantWithFallback } from "../tenant-middleware";
import { db } from "../db";
import {
  objects,
  metadataDefinitions,
  importBatches,
  users,
} from "@shared/schema";
import {
  OBJEKTMALL_SHEETS,
  OBJEKTMALL_FILENAME,
  OBJEKTMALL_BATCH_PREFIX,
  OBJEKTMALL_INTERIM_PREFIX,
  getObjektmallSheet,
  type ObjektmallSheet,
} from "@shared/objektmall-template";

const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB enligt spec
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || "").toLowerCase();
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      cb(null, true);
    } else {
      cb(new Error("Endast Excel-filer (.xlsx/.xls) är tillåtna"));
    }
  },
});

// ============================================================
// Mall-generator
// ============================================================
export async function buildTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Traivo";
  wb.created = new Date();

  // Instruktionsflik
  const readme = wb.addWorksheet("Läs mig först");
  readme.columns = [{ header: "", key: "v", width: 110 }];
  const lines = [
    "TRAIVO – OBJEKTIMPORT FRÅN MALL",
    "",
    "Mallen har fyra flikar utöver denna:",
    "  • Steg 1 — Organisation: toppnoder (koncern/kommun/varumärke)",
    "  • Steg 2 — Butiker: butiker/platser/fastigheter under en organisation",
    "  • Steg 3 — Kärl per butik: fysiska kärl under en butik",
    "  • Metadatafält (valfri): definitioner av extra fält",
    "",
    "Varje rad har ett INTERIMSNUMMER i kolumn A — ditt eget löpnummer som binder ihop nivåerna.",
    "Steg 2 refererar Steg 1:s interim via 'Föräldra-interimsnummer'. Steg 3 refererar Steg 2 (eller Steg 1).",
    "",
    "Re-import: samma fil med samma interimsnummer uppdaterar befintliga objekt — inga dubbletter skapas.",
    "Borttagna rader rör INTE redan importerade objekt (ingen automatisk hard-delete).",
    "",
    "Geokodning av adresser sker separat efter import.",
    "Namnet på kärl i Steg 3 genereras automatiskt från Kärltyp + Butiknamn.",
  ];
  lines.forEach((l) => readme.addRow([l]));
  readme.getRow(1).font = { bold: true, size: 14, color: { argb: "FF1B4B6B" } };
  readme.eachRow((row) => row.alignment = { wrapText: true });

  for (const sheet of OBJEKTMALL_SHEETS) {
    const ws = wb.addWorksheet(sheet.name);
    ws.columns = sheet.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: Math.min(Math.max(c.header.length + 4, 16), 36),
    }));

    const headerRow = ws.getRow(1);
    headerRow.height = 22;
    sheet.columns.forEach((c, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: "FF1B4B6B" } };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: c.required ? "FFFDE8B4" : "FFE8F4F8" },
      };
      cell.border = {
        bottom: { style: "medium", color: { argb: "FF1B4B6B" } },
      };
    });
    ws.views = [{ state: "frozen", ySplit: 2 }];

    // Beskrivningsrad (rad 2) — italiska beskrivningar per kolumn.
    const descRow = ws.addRow(sheet.columns.map((c) => c.description));
    descRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { italic: true, size: 9, color: { argb: "FF6B7C8C" } };
      cell.alignment = { vertical: "top", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F2" } };
    });
    descRow.height = 32;

    // Exempelrad (rad 3) — markerad så användaren förstår att ta bort den.
    const exampleRow = ws.addRow(
      sheet.columns.map((c, i) => {
        if (i === 0) return `[EXEMPEL – ta bort denna rad] ${c.example ?? ""}`.trim();
        return c.example ?? "";
      }),
    );
    exampleRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { italic: true, color: { argb: "FF6B7C8C" } };
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ============================================================
// Parser
// ============================================================
type ParsedSheets = {
  organisation: Array<Record<string, string>>;
  stores: Array<Record<string, string>>;
  containers: Array<Record<string, string>>;
  metadata: Array<Record<string, string>>;
};

function cellToStr(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (val instanceof Date) return val.toISOString().split("T")[0];
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if ("richText" in obj) {
      return (obj.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("");
    }
    if ("formula" in obj) return String(obj.result ?? "");
    if ("hyperlink" in obj) return String(obj.text ?? "");
    if ("text" in obj) return String(obj.text ?? "");
  }
  return String(val).trim();
}

async function parseWorkbook(buffer: Buffer): Promise<{ sheets: ParsedSheets; warnings: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const warnings: string[] = [];
  const result: ParsedSheets = { organisation: [], stores: [], containers: [], metadata: [] };

  for (const sheetDef of OBJEKTMALL_SHEETS) {
    const ws = wb.getWorksheet(sheetDef.name);
    if (!ws) {
      if (sheetDef.key === "metadata") {
        warnings.push(`Flik "${sheetDef.name}" saknas — hoppar över (valfri).`);
        continue;
      }
      throw new ValidationError(`Obligatorisk flik saknas: "${sheetDef.name}"`);
    }
    const rows = parseSheet(ws, sheetDef);
    result[sheetDef.key] = rows;
  }

  return { sheets: result, warnings };
}

function parseSheet(ws: ExcelJS.Worksheet, def: ObjektmallSheet): Array<Record<string, string>> {
  // Hitta header-raden (matcha rubrikerna). Tillåt rad 1-5.
  let headerRowIdx = -1;
  const expected = def.columns.map((c) => c.header.toLowerCase());
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const got: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => got.push(cellToStr(cell.value).toLowerCase()));
    // Kräv att minst de obligatoriska kolumnerna finns.
    const required = def.columns.filter((c) => c.required).map((c) => c.header.toLowerCase());
    if (required.every((h) => got.includes(h))) {
      headerRowIdx = r;
      break;
    }
    // Fallback: matcha åtminstone första kolumnen.
    if (got[0] === expected[0]) {
      headerRowIdx = r;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new ValidationError(
      `Hittade ingen rubrikrad i flik "${def.name}". Förväntade kolumner: ${def.columns.map((c) => c.header).join(", ")}`,
    );
  }

  // Bygg kolumn-index-map baserat på header-raden.
  const headerRow = ws.getRow(headerRowIdx);
  const headerByCol: Record<number, string> = {};
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    const txt = cellToStr(cell.value).toLowerCase();
    const colDef = def.columns.find((c) => c.header.toLowerCase() === txt);
    if (colDef) headerByCol[col] = colDef.key;
  });

  const rows: Array<Record<string, string>> = [];
  for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, string> = {};
    let anyValue = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = headerByCol[col];
      if (!key) return;
      const val = cellToStr(cell.value);
      if (val) anyValue = true;
      obj[key] = val;
    });
    if (!anyValue) continue;
    // Hoppa över beskrivnings-/exempel-rader.
    const interim = (obj.interim ?? obj.fieldKey ?? "").trim();
    if (interim.startsWith("[EXEMPEL")) continue;
    // Skippa rad som ser ut som beskrivnings-raden vi själva skriver.
    if (def.columns.length && def.columns[0].description && obj[def.columns[0].key] === def.columns[0].description) continue;
    rows.push(obj);
  }
  return rows;
}

// ============================================================
// Validering
// ============================================================
type ValRow = {
  sheet: ObjektmallSheet["key"];
  rowNumber: number; // 1-indexerat radnummer i fliken (efter header)
  data: Record<string, string>;
  errors: string[];
};

type InterimEntry = {
  level: "organisation" | "stores" | "containers";
  interim: string;
  name: string;
  rowNumber: number;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  existingObjectId: string | null;
};

type MetaDefDecision = {
  fieldKey: string;
  fieldLabel: string;
  dataType: string;
  propagationType: string;
  applicableLevels: string[];
  defaultValue: string | null;
  isRequired: boolean;
  sortOrder: number;
  action: "create" | "update" | "skip" | "blocked";
  reason?: string;
  existingId?: string;
};

interface ValidationReport {
  sheets: Record<string, {
    name: string;
    totalRows: number;
    toCreate: number;
    toUpdate: number;
    errorRows: number;
    errors: Array<{ row: number; messages: string[] }>;
  }>;
  warnings: string[];
  hasBlockingErrors: boolean;
  metadata: MetaDefDecision[];
}

const VALID_DATA_TYPES = ["text", "number", "date", "boolean", "json"] as const;
const VALID_PROPAGATIONS = ["fixed", "falling", "dynamic"] as const;
const VALID_LEVELS = ["koncern", "brf", "fastighet", "rum", "karl"] as const;

function parseBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "ja" || s === "yes" || s === "true" || s === "1" || s === "x";
}

function parseInt0(v: string | undefined): number {
  if (!v) return 0;
  const n = parseInt(v.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

async function validateAll(
  sheets: ParsedSheets,
  tenantId: string,
  warnings: string[],
): Promise<{ report: ValidationReport; rows: Map<string, ValRow[]>; interim: Map<string, InterimEntry>; metaDecisions: MetaDefDecision[] }> {
  const interim = new Map<string, InterimEntry>();
  const allRows = new Map<string, ValRow[]>();
  const errorsBySheet: Record<string, Array<{ row: number; messages: string[] }>> = {};
  const countersBySheet: Record<string, { toCreate: number; toUpdate: number; errorRows: number; totalRows: number }> = {};

  for (const def of OBJEKTMALL_SHEETS) {
    countersBySheet[def.key] = { toCreate: 0, toUpdate: 0, errorRows: 0, totalRows: 0 };
    errorsBySheet[def.key] = [];
    allRows.set(def.key, []);
  }

  // 1. Validera obligatoriska fält + interim-unikhet per flik
  for (const def of OBJEKTMALL_SHEETS) {
    if (def.key === "metadata") continue;
    const rows = sheets[def.key];
    countersBySheet[def.key].totalRows = rows.length;
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const data = rows[i];
      const rowNumber = i + 1;
      const errs: string[] = [];

      for (const col of def.columns) {
        if (col.required && !data[col.key]) {
          errs.push(`Saknat värde: "${col.header}"`);
        }
      }

      const localInterim = (data.interim ?? "").trim();
      if (localInterim) {
        if (seen.has(localInterim)) {
          errs.push(`Dubblett av interimsnummer "${localInterim}" inom samma flik`);
        }
        seen.add(localInterim);
      }

      const rec: ValRow = { sheet: def.key as any, rowNumber, data, errors: errs };
      allRows.get(def.key)!.push(rec);
    }
  }

  // 2. Lös upp parent-relationer och bygg interim-map
  // Steg 1
  for (const row of allRows.get("organisation")!) {
    if (row.errors.length) continue;
    const key = row.data.interim;
    interim.set(key, {
      level: "organisation",
      interim: key,
      name: row.data.name,
      rowNumber: row.rowNumber,
      address: null,
      city: null,
      postalCode: null,
      existingObjectId: null,
    });
  }
  // Steg 2
  for (const row of allRows.get("stores")!) {
    if (row.errors.length) continue;
    const parentKey = row.data.parentInterim;
    if (!parentKey || !interim.has(parentKey)) {
      row.errors.push(`Föräldra-interimsnummer "${parentKey}" hittades inte i Steg 1`);
      continue;
    }
    const parent = interim.get(parentKey)!;
    if (parent.level !== "organisation") {
      row.errors.push(`Föräldra-interimsnummer "${parentKey}" är inte en organisation (Steg 1)`);
      continue;
    }
    interim.set(row.data.interim, {
      level: "stores",
      interim: row.data.interim,
      name: row.data.name,
      rowNumber: row.rowNumber,
      address: row.data.address || null,
      city: row.data.city || null,
      postalCode: row.data.postalCode || null,
      existingObjectId: null,
    });
  }
  // Steg 3
  for (const row of allRows.get("containers")!) {
    if (row.errors.length) continue;
    const parentKey = row.data.parentInterim;
    if (!parentKey || !interim.has(parentKey)) {
      row.errors.push(`Föräldra-interimsnummer "${parentKey}" hittades inte i Steg 1 eller Steg 2`);
      continue;
    }
    interim.set(row.data.interim, {
      level: "containers",
      interim: row.data.interim,
      name: `${row.data.containerType} — ${interim.get(parentKey)!.name}`,
      rowNumber: row.rowNumber,
      address: null,
      city: null,
      postalCode: null,
      existingObjectId: null,
    });
  }

  // 3. Slå upp befintliga objekt för att avgöra skapa vs uppdatera
  const allInterims = Array.from(interim.keys());
  const objectNumbers = allInterims.map((i) => OBJEKTMALL_INTERIM_PREFIX + i);
  if (objectNumbers.length > 0) {
    const existing = await db
      .select({ id: objects.id, objectNumber: objects.objectNumber })
      .from(objects)
      .where(and(eq(objects.tenantId, tenantId), inArray(objects.objectNumber, objectNumbers)));
    const byObjNum = new Map(existing.map((e) => [e.objectNumber ?? "", e.id]));
    interim.forEach((entry, key) => {
      const objNum = OBJEKTMALL_INTERIM_PREFIX + key;
      const existingId = byObjNum.get(objNum);
      if (existingId) entry.existingObjectId = existingId;
    });
  }

  // 4. Räkna toCreate/toUpdate per flik
  for (const def of OBJEKTMALL_SHEETS) {
    if (def.key === "metadata") continue;
    for (const row of allRows.get(def.key)!) {
      if (row.errors.length) {
        countersBySheet[def.key].errorRows++;
        errorsBySheet[def.key].push({ row: row.rowNumber, messages: row.errors });
        continue;
      }
      const key = row.data.interim;
      const entry = interim.get(key);
      if (entry?.existingObjectId) countersBySheet[def.key].toUpdate++;
      else countersBySheet[def.key].toCreate++;
    }
  }

  // 5. Metadata-validering
  const metaDecisions: MetaDefDecision[] = [];
  const metaRows = sheets.metadata;
  countersBySheet.metadata.totalRows = metaRows.length;

  const existingDefs = metaRows.length
    ? await db
        .select()
        .from(metadataDefinitions)
        .where(and(eq(metadataDefinitions.tenantId, tenantId)))
    : [];
  const existingByKey = new Map(existingDefs.map((d) => [d.fieldKey, d]));

  for (let i = 0; i < metaRows.length; i++) {
    const r = metaRows[i];
    const rowNumber = i + 1;
    const errs: string[] = [];
    const fieldKey = (r.fieldKey ?? "").trim();
    const fieldLabel = (r.fieldLabel ?? "").trim();
    if (!fieldKey) errs.push('Saknat värde: "Fältnyckel"');
    if (!fieldLabel) errs.push('Saknat värde: "Visningsnamn"');
    if (fieldKey && !/^[a-z0-9_]+$/i.test(fieldKey)) {
      errs.push(`Fältnyckel "${fieldKey}" får endast innehålla bokstäver, siffror och understreck`);
    }

    const dataType = ((r.dataType ?? "text").trim() || "text").toLowerCase();
    if (!VALID_DATA_TYPES.includes(dataType as any)) {
      errs.push(`Ogiltig datatyp "${r.dataType}". Tillåtna: ${VALID_DATA_TYPES.join(", ")}`);
    }
    const propagationType = ((r.propagationType ?? "falling").trim() || "falling").toLowerCase();
    if (!VALID_PROPAGATIONS.includes(propagationType as any)) {
      errs.push(`Ogiltig propagering "${r.propagationType}". Tillåtna: ${VALID_PROPAGATIONS.join(", ")}`);
    }
    const levelsRaw = (r.applicableLevels ?? "").trim();
    const applicableLevels = levelsRaw
      ? levelsRaw.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [];
    const invalidLevels = applicableLevels.filter((l) => !VALID_LEVELS.includes(l as any));
    if (invalidLevels.length > 0) {
      errs.push(`Okända nivåer: ${invalidLevels.join(", ")}. Tillåtna: ${VALID_LEVELS.join(", ")}`);
    }

    if (errs.length > 0) {
      countersBySheet.metadata.errorRows++;
      errorsBySheet.metadata.push({ row: rowNumber, messages: errs });
      continue;
    }

    const decision: MetaDefDecision = {
      fieldKey,
      fieldLabel,
      dataType,
      propagationType,
      applicableLevels,
      defaultValue: (r.defaultValue ?? "").trim() || null,
      isRequired: parseBool(r.isRequired),
      sortOrder: parseInt0(r.sortOrder),
      action: "create",
    };

    const existing = existingByKey.get(fieldKey);
    if (existing) {
      // Strukturella fält får ej ändras om definition redan finns och används.
      // För enkelhet: tillåt PATCH av icke-strukturella fält (label, default, required, sortOrder).
      // Om strukturella fält ändras flaggar vi varning men ändrar inte dem.
      const structuralChanged =
        (existing.dataType ?? "text") !== dataType ||
        (existing.propagationType ?? "falling") !== propagationType ||
        JSON.stringify((existing.applicableLevels ?? []).slice().sort()) !==
          JSON.stringify(applicableLevels.slice().sort());
      decision.existingId = existing.id;
      decision.action = "update";
      if (structuralChanged) {
        // Använd central usage-räknare för att veta om vi får blockera ändringen.
        const { storage } = await import("../storage");
        const usage = await storage.getMetadataDefinitionUsage(existing.id);
        if (usage.total > 0) {
          decision.action = "blocked";
          decision.reason = `Strukturell ändring blockerad — fältet används på ${usage.total} ställen. Ändra dataType/propagering/nivåer via metadata-vyn.`;
          countersBySheet.metadata.errorRows++;
          errorsBySheet.metadata.push({ row: rowNumber, messages: [decision.reason] });
          metaDecisions.push(decision);
          continue;
        }
      }
      countersBySheet.metadata.toUpdate++;
    } else {
      countersBySheet.metadata.toCreate++;
    }
    metaDecisions.push(decision);
  }

  const reportSheets: ValidationReport["sheets"] = {};
  let blocking = false;
  for (const def of OBJEKTMALL_SHEETS) {
    const c = countersBySheet[def.key];
    if (c.errorRows > 0) blocking = true;
    reportSheets[def.key] = {
      name: def.name,
      totalRows: c.totalRows,
      toCreate: c.toCreate,
      toUpdate: c.toUpdate,
      errorRows: c.errorRows,
      errors: errorsBySheet[def.key].slice(0, 200),
    };
  }

  return {
    report: { sheets: reportSheets, warnings, hasBlockingErrors: blocking, metadata: metaDecisions },
    rows: allRows,
    interim,
    metaDecisions,
  };
}

// ============================================================
// Commit
// ============================================================
async function commitImport(
  parsedSheets: ParsedSheets,
  tenantId: string,
  userId: string | null,
  fileName: string,
  validation: Awaited<ReturnType<typeof validateAll>>,
): Promise<{ batchId: string; created: Record<string, number>; updated: Record<string, number> }> {
  if (validation.report.hasBlockingErrors) {
    throw new ValidationError("Importen har valideringsfel — fixa fel och kör torrkörning igen innan skarp import.");
  }
  const batchId = `${OBJEKTMALL_BATCH_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created: Record<string, number> = { organisation: 0, stores: 0, containers: 0, metadata: 0 };
  const updated: Record<string, number> = { organisation: 0, stores: 0, containers: 0, metadata: 0 };
  const interim = validation.interim;

  await db.transaction(async (tx) => {
    // Behöver en kund att hänga objekten på. Objekt-tabellen kräver customer_id NOT NULL.
    // Vi lägger objekten på första aktiva kund i tenant (interim-objekten ska ändå
    // omfördelas via object_payers senare — se ADR v3). Saknas kund: kasta fel.
    const customerRows = await tx.execute(sql`SELECT id FROM customers WHERE tenant_id = ${tenantId} AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`);
    const firstCustomer = (customerRows as any).rows?.[0] ?? (Array.isArray(customerRows) ? customerRows[0] : null);
    if (!firstCustomer?.id) {
      throw new ValidationError("Tenant saknar kunder — skapa minst en kund innan objektimport.");
    }
    const customerId = firstCustomer.id as string;

    const interimToObjectId = new Map<string, string>();

    // Hjälpfunktion för upsert.
    async function upsertObject(
      level: "organisation" | "stores" | "containers",
      interimKey: string,
      values: {
        name: string;
        parentObjectId: string | null;
        address?: string | null;
        city?: string | null;
        postalCode?: string | null;
        hierarchyLevel: string;
        objectType: string;
        notes?: string | null;
        containerCount?: number;
      },
      existingId: string | null,
    ) {
      const objectNumber = OBJEKTMALL_INTERIM_PREFIX + interimKey;
      if (existingId) {
        await tx
          .update(objects)
          .set({
            name: values.name,
            parentId: values.parentObjectId,
            address: values.address ?? null,
            city: values.city ?? null,
            postalCode: values.postalCode ?? null,
            hierarchyLevel: values.hierarchyLevel,
            objectType: values.objectType,
            notes: values.notes ?? null,
            containerCount: values.containerCount ?? 0,
            importBatchId: batchId,
          })
          .where(and(eq(objects.id, existingId), eq(objects.tenantId, tenantId)));
        interimToObjectId.set(interimKey, existingId);
        updated[level]++;
      } else {
        const [row] = await tx
          .insert(objects)
          .values({
            tenantId,
            customerId,
            parentId: values.parentObjectId,
            name: values.name,
            objectNumber,
            objectType: values.objectType,
            hierarchyLevel: values.hierarchyLevel,
            address: values.address ?? null,
            city: values.city ?? null,
            postalCode: values.postalCode ?? null,
            notes: values.notes ?? null,
            containerCount: values.containerCount ?? 0,
            importBatchId: batchId,
          } as any)
          .returning({ id: objects.id });
        interimToObjectId.set(interimKey, row.id);
        created[level]++;
      }
    }

    // Steg 1: Organisation
    for (const row of validation.rows.get("organisation")!) {
      if (row.errors.length) continue;
      const k = row.data.interim;
      const entry = interim.get(k)!;
      await upsertObject(
        "organisation",
        k,
        {
          name: row.data.name,
          parentObjectId: null,
          hierarchyLevel: "koncern",
          objectType: "omrade",
          notes: row.data.description || null,
        },
        entry.existingObjectId,
      );
    }

    // Steg 2: Butiker
    for (const row of validation.rows.get("stores")!) {
      if (row.errors.length) continue;
      const k = row.data.interim;
      const entry = interim.get(k)!;
      const parentId = interimToObjectId.get(row.data.parentInterim) ?? null;
      const contactNotes = [
        row.data.contactName && `Kontakt: ${row.data.contactName}`,
        row.data.contactPhone && `Tel: ${row.data.contactPhone}`,
        row.data.contactEmail && `E-post: ${row.data.contactEmail}`,
      ].filter(Boolean).join("\n");
      await upsertObject(
        "stores",
        k,
        {
          name: row.data.name,
          parentObjectId: parentId,
          address: row.data.address || null,
          city: row.data.city || null,
          postalCode: row.data.postalCode || null,
          hierarchyLevel: "fastighet",
          objectType: "fastighet",
          notes: contactNotes || null,
        },
        entry.existingObjectId,
      );
    }

    // Steg 3: Kärl
    for (const row of validation.rows.get("containers")!) {
      if (row.errors.length) continue;
      const k = row.data.interim;
      const entry = interim.get(k)!;
      const parentId = interimToObjectId.get(row.data.parentInterim) ?? null;
      const parentEntry = interim.get(row.data.parentInterim);
      const generatedName = `${row.data.containerType} — ${parentEntry?.name ?? "okänd butik"}`;
      const notesParts = [
        row.data.volumeLiters && `Volym: ${row.data.volumeLiters} L`,
        row.data.emptyingDay && `Tömningsdag: ${row.data.emptyingDay}`,
        row.data.notes,
      ].filter(Boolean).join("\n");
      await upsertObject(
        "containers",
        k,
        {
          name: generatedName,
          parentObjectId: parentId,
          // Adressärv från butik:
          address: parentEntry?.address ?? null,
          city: parentEntry?.city ?? null,
          postalCode: parentEntry?.postalCode ?? null,
          hierarchyLevel: "karl",
          objectType: "karl",
          notes: notesParts || null,
          containerCount: parseInt0(row.data.count),
        },
        entry.existingObjectId,
      );
    }

    // Metadata-definitioner
    for (const dec of validation.metaDecisions) {
      if (dec.action === "blocked" || dec.action === "skip") continue;
      if (dec.action === "create") {
        await tx.insert(metadataDefinitions).values({
          tenantId,
          fieldKey: dec.fieldKey,
          fieldLabel: dec.fieldLabel,
          dataType: dec.dataType,
          propagationType: dec.propagationType,
          applicableLevels: dec.applicableLevels,
          defaultValue: dec.defaultValue,
          isRequired: dec.isRequired,
          sortOrder: dec.sortOrder,
        } as any);
        created.metadata++;
      } else if (dec.action === "update" && dec.existingId) {
        await tx
          .update(metadataDefinitions)
          .set({
            fieldLabel: dec.fieldLabel,
            defaultValue: dec.defaultValue,
            isRequired: dec.isRequired,
            sortOrder: dec.sortOrder,
          })
          .where(and(
            eq(metadataDefinitions.id, dec.existingId),
            eq(metadataDefinitions.tenantId, tenantId),
          ));
        updated.metadata++;
      }
    }

    // Spara batch-spår
    const totalCreated = Object.values(created).reduce((a, b) => a + b, 0);
    const totalUpdated = Object.values(updated).reduce((a, b) => a + b, 0);
    const totalRows = ["organisation", "stores", "containers", "metadata"].reduce(
      (sum, k) => sum + (validation.report.sheets[k]?.totalRows ?? 0),
      0,
    );
    await tx.insert(importBatches).values({
      tenantId,
      batchId,
      totalRows,
      created: totalCreated,
      updated: totalUpdated,
      errors: 0,
      metadata: {
        source: "objektmall",
        fileName,
        userId,
        createdBy: userId,
        perLevel: {
          created,
          updated,
        },
        sheetSummary: validation.report.sheets,
      } as any,
    } as any);
  });

  return { batchId, created, updated };
}

// ============================================================
// Route registration
// ============================================================
export function registerObjektmallImportRoutes(app: Express): void {
  // === Template download ====================================================
  app.get(
    "/api/admin/objektmall/template",
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (_req, res) => {
      const buf = await buildTemplateWorkbook();
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${OBJEKTMALL_FILENAME}"`);
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.send(buf);
    }),
  );

  // === Preview (dry-run) ====================================================
  app.post(
    "/api/admin/objektmall/preview",
    requireTenantWithFallback,
    requireAdmin,
    xlsxUpload.single("file"),
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
      if (!file?.buffer) throw new ValidationError("Ingen fil bifogad. Ladda upp en ifylld mall (.xlsx).");

      const { sheets, warnings } = await parseWorkbook(file.buffer);
      const validation = await validateAll(sheets, tenantId, warnings);
      res.json({
        ok: !validation.report.hasBlockingErrors,
        dryRun: true,
        fileName: file.originalname,
        templateVersion: "v1",
        report: validation.report,
      });
    }),
  );

  // === Commit ===============================================================
  app.post(
    "/api/admin/objektmall/commit",
    requireTenantWithFallback,
    requireAdmin,
    xlsxUpload.single("file"),
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const userId = (req as any).user?.claims?.sub ?? (req as any).user?.id ?? null;
      const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
      if (!file?.buffer) throw new ValidationError("Ingen fil bifogad. Ladda upp en ifylld mall (.xlsx).");

      const { sheets, warnings } = await parseWorkbook(file.buffer);
      const validation = await validateAll(sheets, tenantId, warnings);
      if (validation.report.hasBlockingErrors) {
        return res.status(400).json({
          ok: false,
          fileName: file.originalname,
          report: validation.report,
          message: "Valideringsfel — fixa fel och försök igen.",
        });
      }

      const result = await commitImport(sheets, tenantId, userId, file.originalname, validation);
      res.json({
        ok: true,
        fileName: file.originalname,
        batchId: result.batchId,
        created: result.created,
        updated: result.updated,
        report: validation.report,
      });
    }),
  );

  // === History (lista) ======================================================
  app.get(
    "/api/admin/objektmall/history",
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const rows = await db
        .select({
          id: importBatches.id,
          batchId: importBatches.batchId,
          totalRows: importBatches.totalRows,
          created: importBatches.created,
          updated: importBatches.updated,
          errors: importBatches.errors,
          metadata: importBatches.metadata,
          createdAt: importBatches.createdAt,
        })
        .from(importBatches)
        .where(and(
          eq(importBatches.tenantId, tenantId),
          sql`${importBatches.batchId} LIKE ${OBJEKTMALL_BATCH_PREFIX + "%"}`,
        ))
        .orderBy(desc(importBatches.createdAt))
        .limit(100);

      // Berika med användarnamn när vi kan
      const userIds = Array.from(new Set(
        rows.map((r) => (r.metadata as any)?.userId).filter(Boolean),
      )) as string[];
      const userMap = new Map<string, { email: string | null; firstName: string | null; lastName: string | null }>();
      if (userIds.length > 0) {
        const us = await db.select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, userIds));
        for (const u of us) userMap.set(u.id, { email: u.email, firstName: u.firstName, lastName: u.lastName });
      }

      const enriched = rows.map((r) => {
        const meta = (r.metadata as any) ?? {};
        const u = meta.userId ? userMap.get(meta.userId) : null;
        return {
          ...r,
          fileName: meta.fileName ?? null,
          userName: u ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email : null,
          perLevel: meta.perLevel ?? null,
        };
      });
      res.set("Cache-Control", "no-cache, must-revalidate");
      res.json(enriched);
    }),
  );

  // === History detail =======================================================
  app.get(
    "/api/admin/objektmall/history/:batchId",
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const [row] = await db
        .select()
        .from(importBatches)
        .where(and(
          eq(importBatches.tenantId, tenantId),
          eq(importBatches.batchId, req.params.batchId),
        ));
      if (!row) throw new NotFoundError("Importkörning");
      res.json(row);
    }),
  );
}
