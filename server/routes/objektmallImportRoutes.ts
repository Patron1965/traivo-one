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
import { and, eq, or, sql, desc, inArray } from "drizzle-orm";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";
import { getTenantIdWithFallback, requireAdmin, requireTenantWithFallback } from "../tenant-middleware";
import { db } from "../db";
import {
  objects,
  objectParents,
  metadataDefinitions,
  importBatches,
  users,
} from "@shared/schema";
import {
  OBJEKTMALL_SHEETS,
  OBJEKTMALL_VERSION,
  OBJEKTMALL_FILENAME,
  OBJEKTMALL_BATCH_PREFIX,
  OBJEKTMALL_INTERIM_PREFIX,
  OBJEKTMALL_INTERIM_FLAG_MARKER,
  OBJEKTMALL_INTERIM_FLAG_LABEL,
  objektmallColumnHeaderAliases,
  getObjektmallSheet,
  type ObjektmallColumn,
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
  readme.columns = [
    { header: "", key: "v", width: 95 },
    { header: "", key: "b", width: 14 },
  ];
  const lines = [
    "TRAIVO – OBJEKTIMPORT FRÅN MALL",
    "",
    "Mallen har fyra flikar utöver denna:",
    "  • Steg 1 — Organisation: toppnoder (koncern/kommun/varumärke) — rotnivå, ingen förälder",
    "  • Steg 2 — Butiker: butiker/platser/fastigheter under en organisation",
    "  • Steg 3 — Kärl per butik: fysiska kärl under en butik",
    "  • Metadatafält (valfri): definitioner av extra fält",
    "",
    "ENHETLIGT NUMMERPROTOKOLL (samma kolumner i Steg 1–3):",
    "  • Systemnummer — fyll i för att UPPDATERA ett befintligt objekt (matchas mot",
    "    Traivos systemnummer/kundens butiksnummer, eller mot Objektnamn = butiksnamn).",
    "  • Interimsnummer — ditt eget löpnummer för NYA objekt; binder ihop nivåerna och möjliggör re-import.",
    "  • Systemföräldranummer — peka om objektet till en BEFINTLIG förälder (system→system).",
    "  • Interimföräldranummer — peka mot en rad i denna fil (ny eller befintlig).",
    "",
    "En och samma fil kan i samma körning: skapa nya (interim), uppdatera befintliga (systemnummer)",
    "och peka om ett objekt till en ny eller befintlig förälder.",
    "",
    "OBLIGATORISKT: endast Objektnamn + förälder (förälder ej på rotnivån, Steg 1).",
    "Allt annat (inkl. adress) är metadata och ärvs från förälder om det lämnas tomt.",
    "",
    "Re-import: samma fil med samma interimsnummer uppdaterar befintliga objekt — inga dubbletter skapas.",
    "Borttagna rader rör INTE redan importerade objekt (ingen automatisk hard-delete).",
    "",
    "Geokodning av adresser sker separat efter import.",
    "Namnet på kärl i Steg 3 genereras automatiskt från Kärltyp + Butiknamn om Objektnamn lämnas tomt.",
  ];
  lines.forEach((l) => readme.addRow([l]));

  // Inställningsrad: interimslist-flagga (ren nyimport). Parsern läser cellen
  // till höger om markör-cellen.
  readme.addRow([]);
  const flagRow = readme.addRow([OBJEKTMALL_INTERIM_FLAG_LABEL, "NEJ"]);
  flagRow.getCell(1).font = { bold: true, color: { argb: "FF1B4B6B" } };
  flagRow.getCell(1).alignment = { wrapText: true, vertical: "middle" };
  flagRow.getCell(2).font = { bold: true, color: { argb: "FFB45309" } };
  flagRow.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
  flagRow.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE8B4" } };
  flagRow.getCell(2).border = {
    top: { style: "thin", color: { argb: "FF1B4B6B" } },
    bottom: { style: "thin", color: { argb: "FF1B4B6B" } },
    left: { style: "thin", color: { argb: "FF1B4B6B" } },
    right: { style: "thin", color: { argb: "FF1B4B6B" } },
  };

  readme.getRow(1).font = { bold: true, size: 14, color: { argb: "FF1B4B6B" } };
  readme.eachRow((row) => {
    row.getCell(1).alignment = { wrapText: true, vertical: row.getCell(1).alignment?.vertical ?? "top" };
  });

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

// Läs interimslist-flaggan ("ren nyimport") från instruktionsfliken. Vi letar
// efter markör-cellen och läser cellen direkt till höger om den.
function readInterimListFlag(wb: ExcelJS.Workbook): boolean {
  const readme = wb.getWorksheet("Läs mig först");
  if (!readme) return false;
  let flag = false;
  readme.eachRow((row) => {
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const txt = cellToStr(cell.value);
      if (txt.includes(OBJEKTMALL_INTERIM_FLAG_MARKER)) {
        const valueCell = cellToStr(row.getCell(col + 1).value);
        if (parseBool(valueCell)) flag = true;
      }
    });
  });
  return flag;
}

async function parseWorkbook(
  buffer: Buffer,
): Promise<{ sheets: ParsedSheets; warnings: string[]; interimListFlag: boolean }> {
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

  const interimListFlag = readInterimListFlag(wb);
  if (interimListFlag) {
    warnings.push(
      "Interimslist-läge är PÅ — hela filen tolkas som ren nyimport (system-/uppdateringsmatchning hoppas över).",
    );
  }

  return { sheets: result, warnings, interimListFlag };
}

function parseSheet(ws: ExcelJS.Worksheet, def: ObjektmallSheet): Array<Record<string, string>> {
  // Hitta header-raden (matcha rubrikerna). Tillåt rad 1-5.
  let headerRowIdx = -1;
  // Matchar en cell-rubrik mot en kolumndefinition (huvudrubrik eller alias).
  const matchColumn = (txt: string): ObjektmallColumn | undefined =>
    def.columns.find((c) => objektmallColumnHeaderAliases(c).includes(txt));

  const firstColAliases = objektmallColumnHeaderAliases(def.columns[0]);
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const got: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => got.push(cellToStr(cell.value).toLowerCase()));
    // Kräv att minst de obligatoriska kolumnerna finns (huvudrubrik eller alias).
    const requiredCols = def.columns.filter((c) => c.required);
    const allRequiredFound = requiredCols.every((c) =>
      objektmallColumnHeaderAliases(c).some((h) => got.includes(h)),
    );
    if (allRequiredFound) {
      headerRowIdx = r;
      break;
    }
    // Fallback: matcha åtminstone första kolumnen (huvudrubrik eller alias).
    if (firstColAliases.includes(got[0] ?? "")) {
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
    const colDef = matchColumn(txt);
    if (colDef) headerByCol[col] = colDef.key;
  });

  const firstKey = def.columns[0].key;
  const firstDesc = def.columns[0].description;
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
    // Hoppa över exempel-raden (markerad i första kolumnen).
    const firstVal = (obj[firstKey] ?? "").trim();
    if (firstVal.startsWith("[EXEMPEL")) continue;
    // Skippa rad som ser ut som beskrivnings-raden vi själva skriver.
    if (firstDesc && obj[firstKey] === firstDesc) continue;
    rows.push(obj);
  }
  return rows;
}

// ============================================================
// Validering
// ============================================================
type ParentRef =
  | { mode: "interim"; key: string }
  | { mode: "system"; objectId: string };

// Per-rad upplöst åtgärd som commit-steget återanvänder utan att räkna om.
type RowResolution = {
  action: "create" | "update" | "repoint";
  targetObjectId: string | null; // för update/repoint
  interimNo: string; // "" om ingen
  systemNumber: string; // "" om ingen
  parentRef: ParentRef | null; // null = förälder ej angiven (bevaras vid update)
  name: string; // upplöst namn (Objektnamn eller genererat för kärl)
};

type ValRow = {
  sheet: ObjektmallSheet["key"];
  rowNumber: number; // 1-indexerat radnummer i fliken (efter header)
  data: Record<string, string>;
  errors: string[];
  res?: RowResolution;
};

type InterimEntry = {
  level: "organisation" | "stores" | "containers";
  interim: string;
  name: string;
  rowNumber: number;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  // Befintligt objekt-id om interimet pekar på en uppdatering/re-import, annars null (skapas).
  targetObjectId: string | null;
};

// Lättviktig vy av ett befintligt objekt vi slår upp för matchning.
type ExistingObject = {
  id: string;
  objectNumber: string | null;
  name: string;
  parentId: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
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
    toRepoint: number;
    errorRows: number;
    errors: Array<{ row: number; messages: string[] }>;
    actions: Array<{ row: number; action: "create" | "update" | "repoint"; name: string; detail: string }>;
  }>;
  warnings: string[];
  hasBlockingErrors: boolean;
  interimListFlag: boolean;
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
  interimListFlag: boolean = false,
): Promise<{ report: ValidationReport; rows: Map<string, ValRow[]>; interim: Map<string, InterimEntry>; metaDecisions: MetaDefDecision[] }> {
  const interim = new Map<string, InterimEntry>();
  const allRows = new Map<string, ValRow[]>();
  const errorsBySheet: Record<string, Array<{ row: number; messages: string[] }>> = {};
  const actionsBySheet: Record<string, Array<{ row: number; action: "create" | "update" | "repoint"; name: string; detail: string }>> = {};
  const countersBySheet: Record<string, { toCreate: number; toUpdate: number; toRepoint: number; errorRows: number; totalRows: number }> = {};

  for (const def of OBJEKTMALL_SHEETS) {
    countersBySheet[def.key] = { toCreate: 0, toUpdate: 0, toRepoint: 0, errorRows: 0, totalRows: 0 };
    errorsBySheet[def.key] = [];
    actionsBySheet[def.key] = [];
    allRows.set(def.key, []);
  }

  const objectSheetKeys = ["organisation", "stores", "containers"] as const;
  const trimVal = (data: Record<string, string>, key: string) => (data[key] ?? "").trim();

  // 1. Bygg ValRow-poster + interim-unikhet per flik (ingen tung validering än).
  for (const def of OBJEKTMALL_SHEETS) {
    if (def.key === "metadata") continue;
    const rows = sheets[def.key];
    countersBySheet[def.key].totalRows = rows.length;
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const data = rows[i];
      const rowNumber = i + 1;
      const errs: string[] = [];

      const localInterim = trimVal(data, "interim");
      if (localInterim) {
        if (seen.has(localInterim)) {
          errs.push(`Dubblett av interimsnummer "${localInterim}" inom samma flik`);
        }
        seen.add(localInterim);
      }

      allRows.get(def.key)!.push({ sheet: def.key as any, rowNumber, data, errors: errs });
    }
  }

  // 2. Förladda befintliga objekt för matchning (systemnummer/butiksnummer + butiksnamn).
  const numberLookup = new Set<string>();
  const nameLookup = new Set<string>();
  for (const key of objectSheetKeys) {
    for (const row of allRows.get(key)!) {
      const sysNo = interimListFlag ? "" : trimVal(row.data, "systemNumber");
      const sysParent = interimListFlag ? "" : trimVal(row.data, "systemParentNumber");
      const interimNo = trimVal(row.data, "interim");
      const name = trimVal(row.data, "name");
      if (sysNo) numberLookup.add(sysNo);
      if (sysParent) numberLookup.add(sysParent);
      if (interimNo) numberLookup.add(OBJEKTMALL_INTERIM_PREFIX + interimNo);
      if (sysNo && name) nameLookup.add(name.toLowerCase());
    }
  }

  const byObjNum = new Map<string, ExistingObject>();
  const byNameLower = new Map<string, ExistingObject[]>();
  const numberArr = Array.from(numberLookup);
  const nameArr = Array.from(nameLookup);
  if (numberArr.length > 0 || nameArr.length > 0) {
    const cond =
      numberArr.length > 0 && nameArr.length > 0
        ? or(inArray(objects.objectNumber, numberArr), inArray(sql`lower(${objects.name})`, nameArr))
        : numberArr.length > 0
          ? inArray(objects.objectNumber, numberArr)
          : inArray(sql`lower(${objects.name})`, nameArr);
    const existing = await db
      .select({
        id: objects.id,
        objectNumber: objects.objectNumber,
        name: objects.name,
        parentId: objects.parentId,
        address: objects.address,
        city: objects.city,
        postalCode: objects.postalCode,
      })
      .from(objects)
      .where(and(eq(objects.tenantId, tenantId), cond));
    for (const e of existing) {
      const obj: ExistingObject = {
        id: e.id,
        objectNumber: e.objectNumber ?? null,
        name: e.name ?? "",
        parentId: e.parentId ?? null,
        address: e.address ?? null,
        city: e.city ?? null,
        postalCode: e.postalCode ?? null,
      };
      if (obj.objectNumber) byObjNum.set(obj.objectNumber, obj);
      const nl = obj.name.toLowerCase();
      if (nl) {
        const arr = byNameLower.get(nl) ?? [];
        arr.push(obj);
        byNameLower.set(nl, arr);
      }
    }
  }

  // 3. Lös upp varje rad: klassificera skapa/uppdatera/peka-om + förälder.
  //    Bearbetas i nivåordning så att interim-map är komplett uppåt när barn löses.
  for (const def of OBJEKTMALL_SHEETS) {
    if (def.key === "metadata") continue;
    const isRoot = def.key === "organisation";
    for (const row of allRows.get(def.key)!) {
      if (row.errors.length) continue;
      const data = row.data;
      const interimNo = trimVal(data, "interim");
      const sysNo = interimListFlag ? "" : trimVal(data, "systemNumber");
      const sysParent = interimListFlag ? "" : trimVal(data, "systemParentNumber");
      const parentInterim = trimVal(data, "parentInterim");
      const rawName = trimVal(data, "name");

      // 3a. Nummer-krav
      if (!sysNo && !interimNo) {
        row.errors.push(
          interimListFlag
            ? "Interimsnummer krävs i interimslist-läge (ren nyimport)."
            : "Raden saknar både Systemnummer (uppdatering) och Interimsnummer (nytt objekt).",
        );
        continue;
      }

      // 3b. Namn-krav (kärl får auto-genereras från Kärltyp)
      const containerType = trimVal(data, "containerType");
      if (def.key !== "containers" && !rawName) {
        row.errors.push('Saknat värde: "Objektnamn"');
        continue;
      }
      if (def.key === "containers" && !rawName && !containerType) {
        row.errors.push('Kärl kräver antingen "Objektnamn" eller "Kärltyp" (för auto-genererat namn).');
        continue;
      }

      // 3c. Matcha mot befintligt objekt (uppdatering) eller skapa nytt.
      let target: ExistingObject | undefined;
      if (sysNo) {
        target = byObjNum.get(sysNo);
        if (!target) {
          const matches = byNameLower.get(rawName.toLowerCase()) ?? [];
          if (matches.length === 1) {
            target = matches[0];
          } else if (matches.length > 1) {
            row.errors.push(
              `Flera befintliga objekt har namnet "${rawName}". Ange ett exakt Systemnummer för att peka ut rätt objekt.`,
            );
            continue;
          } else {
            row.errors.push(
              `Systemnummer "${sysNo}"${rawName ? ` (eller namn "${rawName}")` : ""} matchade inget befintligt objekt.`,
            );
            continue;
          }
        }
      } else {
        // Endast interim → re-import uppdaterar om MALL-<interim> redan finns.
        target = byObjNum.get(OBJEKTMALL_INTERIM_PREFIX + interimNo);
      }
      let action: RowResolution["action"] = target ? "update" : "create";

      // 3d. Förälder-upplösning (utom rotnivå).
      let parentRef: ParentRef | null = null;
      let parentNameForGen: string | null = null;
      let inheritedAddress: { address: string | null; city: string | null; postalCode: string | null } = {
        address: null,
        city: null,
        postalCode: null,
      };

      if (isRoot) {
        if (parentInterim || sysParent) {
          warnings.push(
            `Steg 1 rad ${row.rowNumber}: förälder anges på rotnivå (organisation) och ignoreras.`,
          );
        }
      } else if (parentInterim) {
        const pe = interim.get(parentInterim);
        if (!pe) {
          row.errors.push(
            `Interimföräldranummer "${parentInterim}" hittades inte tidigare i filen (måste vara en rad ovanför i Steg 1${def.key === "containers" ? "/2" : ""}).`,
          );
          continue;
        }
        if (def.key === "stores" && pe.level !== "organisation") {
          row.errors.push(`Interimföräldranummer "${parentInterim}" är inte en organisation (Steg 1).`);
          continue;
        }
        if (def.key === "containers" && pe.level === "containers") {
          row.errors.push(`Interimföräldranummer "${parentInterim}" är ett kärl — välj en butik eller organisation.`);
          continue;
        }
        parentRef = { mode: "interim", key: parentInterim };
        parentNameForGen = pe.name;
        inheritedAddress = { address: pe.address, city: pe.city, postalCode: pe.postalCode };
      } else if (sysParent) {
        const pObj = byObjNum.get(sysParent);
        if (!pObj) {
          row.errors.push(`Systemföräldranummer "${sysParent}" matchade inget befintligt objekt.`);
          continue;
        }
        parentRef = { mode: "system", objectId: pObj.id };
        parentNameForGen = pObj.name;
        inheritedAddress = { address: pObj.address, city: pObj.city, postalCode: pObj.postalCode };
      }

      // Nya objekt (utom rot) måste ha en förälder.
      if (!isRoot && action === "create" && !parentRef) {
        row.errors.push("Förälder krävs för nytt objekt — ange Interimföräldranummer eller Systemföräldranummer.");
        continue;
      }

      // 3e. Repekning: uppdatering där angiven förälder skiljer sig från nuvarande.
      if (action === "update" && parentRef && target) {
        let newParentId: string | null;
        if (parentRef.mode === "interim") {
          const pe = interim.get(parentRef.key);
          newParentId = pe?.targetObjectId ?? `NEW:${parentRef.key}`;
        } else {
          newParentId = parentRef.objectId;
        }
        if (newParentId !== target.parentId) action = "repoint";
      }

      // 3f. Upplöst namn (kärl auto-genereras vid behov).
      const resolvedName =
        rawName ||
        (def.key === "containers"
          ? `${containerType || "Kärl"} — ${parentNameForGen ?? "okänd"}`
          : rawName);

      row.res = {
        action,
        targetObjectId: target?.id ?? null,
        interimNo,
        systemNumber: sysNo,
        parentRef,
        name: resolvedName,
      };

      // 3g. Registrera interim-entry så barn kan referera detta som förälder.
      if (interimNo) {
        const entryAddress =
          def.key === "stores"
            ? { address: trimVal(data, "address") || target?.address || null, city: trimVal(data, "city") || target?.city || null, postalCode: trimVal(data, "postalCode") || target?.postalCode || null }
            : def.key === "containers"
              ? inheritedAddress
              : { address: null, city: null, postalCode: null };
        interim.set(interimNo, {
          level: def.key as InterimEntry["level"],
          interim: interimNo,
          name: resolvedName,
          rowNumber: row.rowNumber,
          address: entryAddress.address,
          city: entryAddress.city,
          postalCode: entryAddress.postalCode,
          targetObjectId: target?.id ?? null,
        });
      }
    }
  }

  // 4. Räkna och bygg per-rad-åtgärdslista per flik.
  for (const def of OBJEKTMALL_SHEETS) {
    if (def.key === "metadata") continue;
    for (const row of allRows.get(def.key)!) {
      if (row.errors.length || !row.res) {
        if (row.errors.length) {
          countersBySheet[def.key].errorRows++;
          errorsBySheet[def.key].push({ row: row.rowNumber, messages: row.errors });
        }
        continue;
      }
      const res = row.res;
      if (res.action === "create") {
        countersBySheet[def.key].toCreate++;
      } else if (res.action === "repoint") {
        countersBySheet[def.key].toRepoint++;
      } else {
        countersBySheet[def.key].toUpdate++;
      }
      if (actionsBySheet[def.key].length < 200) {
        const detail =
          res.action === "create"
            ? "Skapar nytt objekt"
            : res.action === "repoint"
              ? "Uppdaterar + pekar om till ny förälder"
              : "Uppdaterar befintligt objekt";
        actionsBySheet[def.key].push({ row: row.rowNumber, action: res.action, name: res.name, detail });
      }
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
      toRepoint: c.toRepoint,
      errorRows: c.errorRows,
      errors: errorsBySheet[def.key].slice(0, 200),
      actions: actionsBySheet[def.key] ?? [],
    };
  }

  return {
    report: { sheets: reportSheets, warnings, hasBlockingErrors: blocking, interimListFlag, metadata: metaDecisions },
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
): Promise<{ batchId: string; created: Record<string, number>; updated: Record<string, number>; repointed: Record<string, number> }> {
  if (validation.report.hasBlockingErrors) {
    throw new ValidationError("Importen har valideringsfel — fixa fel och kör torrkörning igen innan skarp import.");
  }
  const batchId = `${OBJEKTMALL_BATCH_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created: Record<string, number> = { organisation: 0, stores: 0, containers: 0, metadata: 0 };
  const updated: Record<string, number> = { organisation: 0, stores: 0, containers: 0, metadata: 0 };
  const repointed: Record<string, number> = { organisation: 0, stores: 0, containers: 0, metadata: 0 };
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

    // Lös upp en RowResolution.parentRef till ett faktiskt objekt-id.
    //   undefined  = förälder ej angiven (bevaras vid uppdatering)
    //   string|null = upplöst förälder (eller rot)
    function resolveParentId(parentRef: ParentRef | null): string | null | undefined {
      if (!parentRef) return undefined;
      if (parentRef.mode === "interim") return interimToObjectId.get(parentRef.key) ?? null;
      return parentRef.objectId;
    }

    // Task #619: håll object_parents i synk med objektets primära förälder.
    // Importen sätter alltid den primära relationen (parallellt med parentId)
    // så att multi-förälder-UI:t och släktnamns-genereringen ser föräldern.
    // Idempotent: re-import/peka-om uppdaterar befintlig primärrad istället för
    // att skapa dubbletter. Ytterligare (icke-primära) föräldrar hanteras via UI.
    async function syncPrimaryObjectParent(objectId: string, parentId: string | null) {
      if (!parentId) return; // rot/ingen förälder → ingen relation
      const existing = await tx
        .select({ id: objectParents.id, parentId: objectParents.parentId })
        .from(objectParents)
        .where(and(eq(objectParents.objectId, objectId), eq(objectParents.isPrimary, true)));
      const primary = existing[0];
      if (primary) {
        if (primary.parentId !== parentId) {
          await tx
            .update(objectParents)
            .set({ parentId, relationContext: "primary" })
            .where(eq(objectParents.id, primary.id));
        }
        return;
      }
      // Ev. befintlig icke-primär rad mot samma förälder → uppgradera till primär.
      const sameParent = await tx
        .select({ id: objectParents.id })
        .from(objectParents)
        .where(and(eq(objectParents.objectId, objectId), eq(objectParents.parentId, parentId)));
      if (sameParent[0]) {
        await tx.update(objectParents).set({ isPrimary: true }).where(eq(objectParents.id, sameParent[0].id));
        return;
      }
      await tx.insert(objectParents).values({
        tenantId,
        objectId,
        parentId,
        isPrimary: true,
        relationContext: "primary",
      });
    }

    // Skapar nytt objekt (objectNumber = MALL-<interim>).
    async function createObject(
      level: "organisation" | "stores" | "containers",
      interimKey: string,
      values: {
        name: string;
        parentObjectId: string | null;
        address: string | null;
        city: string | null;
        postalCode: string | null;
        hierarchyLevel: string;
        objectType: string;
        notes: string | null;
        containerCount: number;
      },
    ) {
      const [inserted] = await tx
        .insert(objects)
        .values({
          tenantId,
          customerId,
          parentId: values.parentObjectId,
          name: values.name,
          objectNumber: OBJEKTMALL_INTERIM_PREFIX + interimKey,
          objectType: values.objectType,
          hierarchyLevel: values.hierarchyLevel,
          address: values.address,
          city: values.city,
          postalCode: values.postalCode,
          notes: values.notes,
          containerCount: values.containerCount,
          importBatchId: batchId,
        } as any)
        .returning({ id: objects.id });
      if (interimKey) interimToObjectId.set(interimKey, inserted.id);
      await syncPrimaryObjectParent(inserted.id, values.parentObjectId);
      created[level]++;
    }

    // Partiell uppdatering: sätter endast angivna fält + namn. Förälder sätts
    // enbart när den uttryckligen angetts (peka-om), annars bevaras nuvarande.
    async function updateObject(
      level: "organisation" | "stores" | "containers",
      targetId: string,
      interimKey: string,
      patch: Record<string, unknown>,
      parentObjectId: string | null | undefined,
      isRepoint: boolean,
    ) {
      const set: Record<string, unknown> = { ...patch, importBatchId: batchId };
      if (parentObjectId !== undefined) set.parentId = parentObjectId;
      await tx
        .update(objects)
        .set(set)
        .where(and(eq(objects.id, targetId), eq(objects.tenantId, tenantId)));
      if (interimKey) interimToObjectId.set(interimKey, targetId);
      // Synka primär object_parents endast när förälder uttryckligen angetts.
      if (parentObjectId !== undefined) await syncPrimaryObjectParent(targetId, parentObjectId);
      if (isRepoint) repointed[level]++;
      else updated[level]++;
    }

    // Steg 1: Organisation (rotnivå)
    for (const row of validation.rows.get("organisation")!) {
      if (row.errors.length || !row.res) continue;
      const res = row.res;
      const description = (row.data.description ?? "").trim();
      if (res.action === "create") {
        await createObject("organisation", res.interimNo, {
          name: res.name,
          parentObjectId: null,
          address: null,
          city: null,
          postalCode: null,
          hierarchyLevel: "koncern",
          objectType: "omrade",
          notes: description || null,
          containerCount: 0,
        });
      } else if (res.targetObjectId) {
        const patch: Record<string, unknown> = { name: res.name };
        if (description) patch.notes = description;
        await updateObject("organisation", res.targetObjectId, res.interimNo, patch, undefined, false);
      }
    }

    // Steg 2: Butiker
    for (const row of validation.rows.get("stores")!) {
      if (row.errors.length || !row.res) continue;
      const res = row.res;
      const parentObjectId = resolveParentId(res.parentRef);
      const contactNotes = [
        row.data.contactName && `Kontakt: ${row.data.contactName}`,
        row.data.contactPhone && `Tel: ${row.data.contactPhone}`,
        row.data.contactEmail && `E-post: ${row.data.contactEmail}`,
      ].filter(Boolean).join("\n");
      const address = (row.data.address ?? "").trim();
      const city = (row.data.city ?? "").trim();
      const postalCode = (row.data.postalCode ?? "").trim();

      if (res.action === "create") {
        await createObject("stores", res.interimNo, {
          name: res.name,
          parentObjectId: parentObjectId ?? null,
          address: address || null,
          city: city || null,
          postalCode: postalCode || null,
          hierarchyLevel: "fastighet",
          objectType: "fastighet",
          notes: contactNotes || null,
          containerCount: 0,
        });
      } else if (res.targetObjectId) {
        const patch: Record<string, unknown> = { name: res.name };
        if (address) patch.address = address;
        if (city) patch.city = city;
        if (postalCode) patch.postalCode = postalCode;
        if (contactNotes) patch.notes = contactNotes;
        await updateObject(
          "stores",
          res.targetObjectId,
          res.interimNo,
          patch,
          parentObjectId,
          res.action === "repoint",
        );
      }
    }

    // Steg 3: Kärl
    for (const row of validation.rows.get("containers")!) {
      if (row.errors.length || !row.res) continue;
      const res = row.res;
      const parentObjectId = resolveParentId(res.parentRef);
      const entry = res.interimNo ? interim.get(res.interimNo) : undefined;
      const notesParts = [
        row.data.volumeLiters && `Volym: ${row.data.volumeLiters} L`,
        row.data.emptyingDay && `Tömningsdag: ${row.data.emptyingDay}`,
        row.data.notes,
      ].filter(Boolean).join("\n");
      const containerCount = parseInt0(row.data.count);
      // Adressärv från förälder (butik) — beräknad i valideringen.
      const inh = { address: entry?.address ?? null, city: entry?.city ?? null, postalCode: entry?.postalCode ?? null };

      if (res.action === "create") {
        await createObject("containers", res.interimNo, {
          name: res.name,
          parentObjectId: parentObjectId ?? null,
          address: inh.address,
          city: inh.city,
          postalCode: inh.postalCode,
          hierarchyLevel: "karl",
          objectType: "karl",
          notes: notesParts || null,
          containerCount,
        });
      } else if (res.targetObjectId) {
        const patch: Record<string, unknown> = { name: res.name };
        if (notesParts) patch.notes = notesParts;
        if (containerCount > 0) patch.containerCount = containerCount;
        // Vid peka-om ärvs adressen från den nya föräldern.
        if (res.action === "repoint" && (inh.address || inh.city || inh.postalCode)) {
          patch.address = inh.address;
          patch.city = inh.city;
          patch.postalCode = inh.postalCode;
        }
        await updateObject(
          "containers",
          res.targetObjectId,
          res.interimNo,
          patch,
          parentObjectId,
          res.action === "repoint",
        );
      }
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
    const totalRepointed = Object.values(repointed).reduce((a, b) => a + b, 0);
    const totalRows = ["organisation", "stores", "containers", "metadata"].reduce(
      (sum, k) => sum + (validation.report.sheets[k]?.totalRows ?? 0),
      0,
    );
    await tx.insert(importBatches).values({
      tenantId,
      batchId,
      totalRows,
      // Repekningar räknas som uppdateringar i batch-sammandraget.
      created: totalCreated,
      updated: totalUpdated + totalRepointed,
      errors: 0,
      metadata: {
        source: "objektmall",
        fileName,
        userId,
        createdBy: userId,
        interimListFlag: validation.report.interimListFlag,
        perLevel: {
          created,
          updated,
          repointed,
        },
        sheetSummary: validation.report.sheets,
      } as any,
    } as any);
  });

  return { batchId, created, updated, repointed };
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

      const { sheets, warnings, interimListFlag } = await parseWorkbook(file.buffer);
      const validation = await validateAll(sheets, tenantId, warnings, interimListFlag);
      res.json({
        ok: !validation.report.hasBlockingErrors,
        dryRun: true,
        fileName: file.originalname,
        templateVersion: OBJEKTMALL_VERSION,
        interimListFlag,
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

      const { sheets, warnings, interimListFlag } = await parseWorkbook(file.buffer);
      const validation = await validateAll(sheets, tenantId, warnings, interimListFlag);
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
        templateVersion: OBJEKTMALL_VERSION,
        batchId: result.batchId,
        created: result.created,
        updated: result.updated,
        repointed: result.repointed,
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
