// Task #603 / #631: Objektimport från Excel-mall (enflik-mall).
//
// Endpoints (alla kräver admin/owner i tenant):
//   GET    /api/admin/objektmall/template          ladda ner aktuell mall (.xlsx)
//   GET    /api/admin/objektmall/export            exportera befintliga objekt i mallformat
//   POST   /api/admin/objektmall/preview           torrkörning (multipart .xlsx)
//   POST   /api/admin/objektmall/commit            skarp atomär import (multipart .xlsx)
//   GET    /api/admin/objektmall/history           tidigare körningar
//   GET    /api/admin/objektmall/history/:batchId  detaljer för en körning
//
// Mallstruktur (Task #631): EN platt "Import"-flik (utöver "Läs mig först").
//   • Kolumn A–E är fasta (se OBJEKTMALL_FIXED_COLUMNS).
//   • Kolumn F+ är dynamiska metadata-kolumner — rad 1 bär referensnamn, varje
//     rads cell är rådata-värdet. Värdena samlas i en per-rad-karta som visas i
//     förhandsgranskningen. Att PERSISTERA metadata-värdena på objekten (med
//     ersättande/kompletterande-beteende) görs i en separat följd-task — denna
//     fil läser och visar dem men skriver dem inte till objekten.
//   • Objektets nivå (organisation/butik/kärl) härleds från förälderkedjan, inte
//     från vilken flik raden låg i.
//
// Re-import:
//   Befintliga rader identifieras via (tenantId, objectNumber) där
//   objectNumber = OBJEKTMALL_INTERIM_PREFIX + interim. På så vis kan samma
//   mall köras igen utan att skapa dubbletter — ändrade fält uppdateras.

import type { Express } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { and, eq, or, sql, desc, inArray, isNull } from "drizzle-orm";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";
import { getTenantIdWithFallback, requireAdmin, requireTenantWithFallback } from "../tenant-middleware";
import { db } from "../db";
import {
  objects,
  objectParents,
  objectMetadata,
  metadataDefinitions,
  metadataKatalog,
  metadataVarden,
  importBatches,
  users,
  type MetadataKatalog,
} from "@shared/schema";
import {
  coerceMetadataVardeFromRaw,
  computeImportMetadataStatus,
  writeImportedMetadataValue,
  getDisplayValue,
  type ImportMetadataWriteStatus,
} from "../metadata-queries";
import { enqueueMetadataChange } from "../services/metadata-change-jobs";
import {
  OBJEKTMALL_VERSION,
  OBJEKTMALL_FILENAME,
  OBJEKTMALL_BATCH_PREFIX,
  OBJEKTMALL_INTERIM_PREFIX,
  OBJEKTMALL_README_SHEET_NAME,
  OBJEKTMALL_IMPORT_SHEET_NAME,
  OBJEKTMALL_INTERIM_FLAG_MARKER,
  OBJEKTMALL_INTERIM_FLAG_LABEL,
  OBJEKTMALL_FIXED_COLUMNS,
  OBJEKTMALL_EXAMPLE_METADATA_HEADERS,
  objektmallColumnHeaderAliases,
  objektmallFixedHeaderSet,
  type ObjektmallColumn,
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
// Nivåmodell — nivå härleds från djupet i förälderkedjan.
// ============================================================
type ObjLevel = "organisation" | "stores" | "containers";

function levelForDepth(depth: number): ObjLevel {
  return depth <= 0 ? "organisation" : depth === 1 ? "stores" : "containers";
}

const LEVEL_META: Record<ObjLevel, { hierarchyLevel: string; objectType: string; label: string }> = {
  organisation: { hierarchyLevel: "koncern", objectType: "omrade", label: "Organisation" },
  stores: { hierarchyLevel: "fastighet", objectType: "fastighet", label: "Butik/Fastighet" },
  containers: { hierarchyLevel: "karl", objectType: "karl", label: "Kärl" },
};

// Prefix per nivå för auto-genererade interimsnummer i export-interim-läge.
const INTERIM_LEVEL_PREFIX: Record<ObjLevel, string> = {
  organisation: "ORG",
  stores: "BUT",
  containers: "KARL",
};

// ============================================================
// Kända objektfält bland de dynamiska metadata-kolumnerna.
// ------------------------------------------------------------
// I enflik-modellen (Task #631) ligger adress/ort/postnummer/anteckningar/antal
// kärl som dynamiska metadata-kolumner (kolumn F+). De referensnamn som mappar
// direkt mot riktiga `objects`-kolumner skrivs FORTSATT till objektet — detta är
// del av objekt-skrivningen och bevarar tidigare beteende (inkl. adress-arv från
// förälder). Övriga, helt fria metadata-värden persisteras INTE här utan hanteras
// av den separata följd-tasken "Skriv metadata-värden vid import".
//
// Matchningen sker på referensnamnet (rubriken på rad 1), case-insensitivt och
// med svenska/engelska alias. Referensnamnet motsvarar metadata-definitionens
// fieldLabel (samma sträng som export skriver i rubrikraden), så export→reimport
// är konsekvent.
type KnownObjectFields = {
  address?: string;
  city?: string;
  postalCode?: string;
  notes?: string;
  containerCount?: number;
};

const KNOWN_FIELD_ALIASES = {
  address: ["adress", "address", "gatuadress", "besöksadress"],
  city: ["stad", "ort", "city", "postort"],
  postalCode: ["postnummer", "postnr", "postal code", "postalcode", "zip"],
  notes: ["anteckningar", "notering", "noteringar", "notes", "beskrivning", "description", "kommentar"],
  containerCount: ["antal kärl", "antal karl", "antal", "container count", "containercount", "antal behållare", "kärl", "karl"],
} as const;

function extractKnownObjectFields(metadata: Record<string, string>): KnownObjectFields {
  const lowerMap = new Map<string, string>();
  for (const [k, v] of Object.entries(metadata ?? {})) {
    const val = (v ?? "").trim();
    if (val) lowerMap.set(k.trim().toLowerCase(), val);
  }
  const pick = (aliases: readonly string[]): string | undefined => {
    for (const a of aliases) {
      const hit = lowerMap.get(a);
      if (hit) return hit;
    }
    return undefined;
  };
  const out: KnownObjectFields = {};
  const address = pick(KNOWN_FIELD_ALIASES.address);
  const city = pick(KNOWN_FIELD_ALIASES.city);
  const postalCode = pick(KNOWN_FIELD_ALIASES.postalCode);
  const notes = pick(KNOWN_FIELD_ALIASES.notes);
  const ccRaw = pick(KNOWN_FIELD_ALIASES.containerCount);
  if (address !== undefined) out.address = address;
  if (city !== undefined) out.city = city;
  if (postalCode !== undefined) out.postalCode = postalCode;
  if (notes !== undefined) out.notes = notes;
  if (ccRaw !== undefined) {
    const n = parseInt(ccRaw.replace(/[^\d-]/g, ""), 10);
    if (!Number.isNaN(n)) out.containerCount = n;
  }
  return out;
}

// Alla alias som mappar mot riktiga `objects`-kolumner. Sådana kolumner skrivs
// via objekt-skrivningen (extractKnownObjectFields) och ska INTE dubbel-skrivas
// som dynamiska metadatavärden.
const KNOWN_FIELD_ALIAS_SET = new Set<string>(
  Object.values(KNOWN_FIELD_ALIASES).flat().map((a) => a.toLowerCase()),
);

function isKnownObjectFieldRef(refName: string): boolean {
  return KNOWN_FIELD_ALIAS_SET.has(refName.trim().toLowerCase());
}

// ============================================================
// Mall-generator
// ============================================================
export async function buildTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Traivo";
  wb.created = new Date();

  // Instruktionsflik
  const readme = wb.addWorksheet(OBJEKTMALL_README_SHEET_NAME);
  readme.columns = [
    { header: "", key: "v", width: 95 },
    { header: "", key: "b", width: 14 },
  ];
  const lines = [
    "TRAIVO – OBJEKTIMPORT FRÅN MALL",
    "",
    "Mallen har EN enda flik utöver denna: \"Import\".",
    "En rad = ett objekt oavsett nivå (organisation, butik/fastighet eller kärl).",
    "Hierarkin byggs via föräldrakolumnerna — nivån härleds automatiskt från förälderkedjan.",
    "",
    "FASTA KOLUMNER (A–E):",
    "  • Systemnummer — fyll i för att UPPDATERA ett befintligt objekt (matchas mot",
    "    Traivos systemnummer/kundens butiksnummer, eller mot Objektnamn = butiksnamn).",
    "  • Interimsnummer — ditt eget löpnummer för NYA objekt; binder ihop nivåerna och möjliggör re-import.",
    "  • Systemföräldranummer — peka objektet mot en BEFINTLIG förälder (system→system).",
    "  • Interimföräldranummer — peka mot en rad i denna fil (ny eller befintlig). Lämna tomt för rotnivå.",
    "  • Objektnamn — obligatoriskt på varje rad.",
    "",
    "DYNAMISKA METADATA-KOLUMNER (F och framåt):",
    "  • Skriv metadata-referensnamnet på rad 1 (rubrikraden) och värdet på varje objektrad.",
    "  • Du kan lägga till så många metadata-kolumner du vill. Exempelkolumnerna (Adress, Postnummer …)",
    "    är bara förslag — byt ut eller lägg till egna referensnamn.",
    "",
    "En och samma fil kan i samma körning: skapa nya (interim), uppdatera befintliga (systemnummer)",
    "och peka om ett objekt till en ny eller befintlig förälder.",
    "",
    "OBLIGATORISKT: Objektnamn på varje rad, samt förälder för icke-rotnivå (Interim- eller Systemföräldranummer).",
    "",
    "Re-import: samma fil med samma interimsnummer uppdaterar befintliga objekt — inga dubbletter skapas.",
    "Borttagna rader rör INTE redan importerade objekt (ingen automatisk hard-delete).",
    "",
    "Geokodning av adresser sker separat efter import.",
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

  // Import-flik (platt).
  const ws = wb.addWorksheet(OBJEKTMALL_IMPORT_SHEET_NAME);
  const fixedHeaders = OBJEKTMALL_FIXED_COLUMNS.map((c) => c.header);
  const allHeaders = [...fixedHeaders, ...OBJEKTMALL_EXAMPLE_METADATA_HEADERS];
  ws.columns = allHeaders.map((h) => ({
    header: h,
    width: Math.min(Math.max(h.length + 4, 16), 36),
  }));

  // Rad 1 — rubriker (fasta + exempel-metadata).
  const headerRow = ws.getRow(1);
  headerRow.height = 22;
  allHeaders.forEach((h, idx) => {
    const fixedCol = OBJEKTMALL_FIXED_COLUMNS[idx];
    const isMeta = idx >= OBJEKTMALL_FIXED_COLUMNS.length;
    const cell = headerRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: isMeta ? "FF4A9B9B" : "FF1B4B6B" } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: isMeta ? "FFE0F2F1" : fixedCol?.required ? "FFFDE8B4" : "FFE8F4F8" },
    };
    cell.border = { bottom: { style: "medium", color: { argb: "FF1B4B6B" } } };
  });
  ws.views = [{ state: "frozen", ySplit: 2 }];

  // Rad 2 — beskrivningar.
  const descs = [
    ...OBJEKTMALL_FIXED_COLUMNS.map((c) => c.description),
    ...OBJEKTMALL_EXAMPLE_METADATA_HEADERS.map(
      () => "Metadata-referensnamn (byt ut/lägg till egna). Värdet skrivs på varje objektrad.",
    ),
  ];
  const descRow = ws.addRow(descs);
  descRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { italic: true, size: 9, color: { argb: "FF6B7C8C" } };
    cell.alignment = { vertical: "top", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F2" } };
  });
  descRow.height = 36;

  // Rad 3 — exempelrad (markerad så användaren förstår att ta bort den).
  const exampleValues = [
    "[EXEMPEL – ta bort denna rad]",
    "ORG-1",
    "",
    "",
    "KINAB Koncern",
    "Storgatan 5",
    "614 30",
    "Söderköping",
    "Anna Andersson",
  ];
  const exampleRow = ws.addRow(exampleValues);
  exampleRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { italic: true, color: { argb: "FF6B7C8C" } };
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ============================================================
// Export-generator (Task #621, enflik-format Task #631)
// ------------------------------------------------------------
// Exporterar BEFINTLIGA objekt i exakt samma enflik-kolumnprotokoll som mallen, så
// att kunden kan jämföra mot sin egen lista och läsa tillbaka filen via samma import.
//   mode="update":  Systemnummer fylls (= objectNumber), Systemföräldranummer
//                   pekar på förälderns systemnummer → re-import = uppdatering.
//   mode="interim": numren skrivs om till interim (Interimsnummer +
//                   Interimföräldranummer) och interimslist-flaggan sätts till JA
//                   → ren nyimport (separerad från uppdateringslistan).
// Per-objekt-metadatavärden skrivs i dynamiska kolumner (referensnamn = fältets
// visningsnamn) från kolumn F.
// ============================================================
export type ObjektmallExportMode = "update" | "interim";

// Neutralisera formula-injection (memory: csv-export-hardening).
function safeExportCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.length === 0) return s;
  const first = s.charAt(0);
  if (first === "=" || first === "+" || first === "-" || first === "@" || first === "\t" || first === "\r") {
    return "'" + s;
  }
  return s;
}

type ExportObject = {
  id: string;
  objectNumber: string | null;
  name: string;
  parentId: string | null;
  depth: number;
};

export async function buildExportWorkbook(
  tenantId: string,
  mode: ObjektmallExportMode,
): Promise<Buffer> {
  // 1. Ladda alla icke-raderade objekt för tenant.
  const raw = await db
    .select({
      id: objects.id,
      objectNumber: objects.objectNumber,
      name: objects.name,
      parentId: objects.parentId,
    })
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));

  const byId = new Map<string, (typeof raw)[number]>();
  for (const r of raw) byId.set(r.id, r);

  // Djup = antal förälder-hopp upp till roten (med skydd mot cykler).
  function depthOf(id: string): number {
    let d = 0;
    let cur = byId.get(id);
    const seen = new Set<string>();
    while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      d++;
      cur = byId.get(cur.parentId);
      if (d > 50) break;
    }
    return d;
  }

  const objs: ExportObject[] = raw.map((r) => ({
    id: r.id,
    objectNumber: r.objectNumber ?? null,
    name: r.name ?? "",
    parentId: r.parentId ?? null,
    depth: depthOf(r.id),
  }));
  // Stabil ordning: djup först (föräldrar före barn), sedan namn.
  objs.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name, "sv"));

  // 2. Per-objekt-metadatavärden + definitioner (för dynamiska kolumner).
  const defs = await db
    .select()
    .from(metadataDefinitions)
    .where(and(eq(metadataDefinitions.tenantId, tenantId), isNull(metadataDefinitions.deletedAt)))
    .orderBy(metadataDefinitions.sortOrder);
  const defById = new Map(defs.map((d) => [d.id, d]));

  // objectId -> (definitionId -> värde)
  const valuesByObject = new Map<string, Map<string, string>>();
  if (objs.length > 0) {
    const metaRows = await db
      .select({
        objectId: objectMetadata.objectId,
        definitionId: objectMetadata.definitionId,
        value: objectMetadata.value,
        valueJson: objectMetadata.valueJson,
      })
      .from(objectMetadata)
      .where(eq(objectMetadata.tenantId, tenantId));
    for (const m of metaRows) {
      if (!defById.has(m.definitionId)) continue;
      const val = m.value ?? (m.valueJson != null ? JSON.stringify(m.valueJson) : "");
      if (!val) continue;
      let inner = valuesByObject.get(m.objectId);
      if (!inner) {
        inner = new Map();
        valuesByObject.set(m.objectId, inner);
      }
      inner.set(m.definitionId, val);
    }
  }

  // Endast definitioner som har minst ett värde på något objekt får en kolumn.
  const metaDefsWithValues = defs.filter((d) =>
    objs.some((o) => valuesByObject.get(o.id)?.has(d.id)),
  );

  // Interim-läge: tilldela varje objekt ett interimsnummer (stabilt per nivå).
  const interimById = new Map<string, string>();
  if (mode === "interim") {
    const counters: Record<ObjLevel, number> = { organisation: 0, stores: 0, containers: 0 };
    for (const o of objs) {
      const lvl = levelForDepth(o.depth);
      counters[lvl]++;
      interimById.set(o.id, `${INTERIM_LEVEL_PREFIX[lvl]}-${counters[lvl]}`);
    }
  }

  // 3. Bygg arbetsbok.
  const wb = new ExcelJS.Workbook();
  wb.creator = "Traivo";
  wb.created = new Date();

  // Läs-mig-flik med interimslist-flaggan (sätts till JA i interim-läge).
  const readme = wb.addWorksheet(OBJEKTMALL_README_SHEET_NAME);
  readme.columns = [
    { header: "", key: "v", width: 95 },
    { header: "", key: "b", width: 14 },
  ];
  const introLines =
    mode === "interim"
      ? [
          "TRAIVO – EXPORT AV BEFINTLIGA OBJEKT (INTERIM / REN NYIMPORT)",
          "",
          "Den här filen är en kopia av era nuvarande objekt OMSKRIVEN till interimsnummer.",
          "Den är avsedd för ren nyimport (t.ex. till en ny tenant) — interimslist-flaggan är PÅ.",
          "VARNING: läses filen tillbaka i SAMMA tenant skapas NYA objekt (MALL-<interim>) — dubbletter.",
          "Använd 'Exportera för uppdatering' om ni vill ändra befintliga objekt.",
        ]
      : [
          "TRAIVO – EXPORT AV BEFINTLIGA OBJEKT (FÖR UPPDATERING)",
          "",
          "Den här filen är en kopia av era nuvarande objekt i importmallens enflik-format.",
          "Systemnummer är ifyllt på varje rad — ändra fält direkt och läs tillbaka filen via",
          "objektimporten för att UPPDATERA befintliga objekt. Lägg nya objekt i en separat",
          "interimslista (se 'Exportera som interim-mall') enligt principen att inte blanda listor.",
          "Rader utan systemnummer kan inte matchas automatiskt — ge dem ett interimsnummer.",
        ];
  introLines.forEach((l) => readme.addRow([l]));
  readme.addRow([]);
  const flagRow = readme.addRow([OBJEKTMALL_INTERIM_FLAG_LABEL, mode === "interim" ? "JA" : "NEJ"]);
  flagRow.getCell(1).font = { bold: true, color: { argb: "FF1B4B6B" } };
  flagRow.getCell(1).alignment = { wrapText: true, vertical: "middle" };
  flagRow.getCell(2).font = { bold: true, color: { argb: "FFB45309" } };
  flagRow.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
  flagRow.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE8B4" } };
  readme.getRow(1).font = { bold: true, size: 14, color: { argb: "FF1B4B6B" } };
  readme.eachRow((row) => {
    row.getCell(1).alignment = { wrapText: true, vertical: row.getCell(1).alignment?.vertical ?? "top" };
  });

  // Import-flik (platt): fasta kolumner A–E + dynamiska metadata-kolumner.
  const ws = wb.addWorksheet(OBJEKTMALL_IMPORT_SHEET_NAME);
  const fixedHeaders = OBJEKTMALL_FIXED_COLUMNS.map((c) => c.header);
  const metaHeaders = metaDefsWithValues.map((d) => d.fieldLabel);
  const allHeaders = [...fixedHeaders, ...metaHeaders];
  ws.columns = allHeaders.map((h) => ({
    header: h,
    width: Math.min(Math.max((h ?? "").length + 4, 16), 36),
  }));

  const headerRow = ws.getRow(1);
  headerRow.height = 22;
  allHeaders.forEach((h, idx) => {
    const fixedCol = OBJEKTMALL_FIXED_COLUMNS[idx];
    const isMeta = idx >= OBJEKTMALL_FIXED_COLUMNS.length;
    const cell = headerRow.getCell(idx + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: isMeta ? "FF4A9B9B" : "FF1B4B6B" } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: isMeta ? "FFE0F2F1" : fixedCol?.required ? "FFFDE8B4" : "FFE8F4F8" },
    };
    cell.border = { bottom: { style: "medium", color: { argb: "FF1B4B6B" } } };
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const o of objs) {
    const cells: string[] = [];
    // Nummerprotokoll (A–D)
    if (mode === "interim") {
      cells.push(""); // Systemnummer
      cells.push(interimById.get(o.id) ?? ""); // Interimsnummer
      cells.push(""); // Systemföräldranummer
      cells.push(o.parentId ? interimById.get(o.parentId) ?? "" : ""); // Interimföräldranummer
    } else {
      cells.push(safeExportCell(o.objectNumber)); // Systemnummer
      cells.push(""); // Interimsnummer
      const parent = o.parentId ? byId.get(o.parentId) : undefined;
      cells.push(safeExportCell(parent?.objectNumber ?? "")); // Systemföräldranummer
      cells.push(""); // Interimföräldranummer
    }
    // Objektnamn (E)
    cells.push(safeExportCell(o.name));
    // Dynamiska metadata-kolumner (F+)
    const vals = valuesByObject.get(o.id);
    for (const d of metaDefsWithValues) {
      cells.push(safeExportCell(vals?.get(d.id) ?? ""));
    }
    ws.addRow(cells);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ============================================================
// Parser
// ============================================================
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

// En rad i den platta Import-fliken.
type FlatRow = {
  rowNumber: number; // 1-indexerat radnummer (efter rubrikrad)
  data: Record<string, string>; // fasta kolumnvärden per key
  metadata: Record<string, string>; // dynamiska metadata-värden (referensnamn -> värde)
};

// Läs interimslist-flaggan ("ren nyimport") från instruktionsfliken. Vi letar
// efter markör-cellen och läser cellen direkt till höger om den.
function readInterimListFlag(wb: ExcelJS.Workbook): boolean {
  const readme = wb.getWorksheet(OBJEKTMALL_README_SHEET_NAME);
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
): Promise<{ rows: FlatRow[]; metadataColumns: string[]; warnings: string[]; interimListFlag: boolean }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const warnings: string[] = [];

  // Hitta Import-fliken (efter namn, annars första icke-readme-fliken).
  let ws = wb.getWorksheet(OBJEKTMALL_IMPORT_SHEET_NAME);
  if (!ws) {
    ws = wb.worksheets.find((w) => w.name !== OBJEKTMALL_README_SHEET_NAME);
  }
  if (!ws) {
    throw new ValidationError(`Obligatorisk flik saknas: "${OBJEKTMALL_IMPORT_SHEET_NAME}"`);
  }

  const { rows, metadataColumns } = parseImportSheet(ws);

  const interimListFlag = readInterimListFlag(wb);
  if (interimListFlag) {
    warnings.push(
      "Interimslist-läge är PÅ — hela filen tolkas som ren nyimport (system-/uppdateringsmatchning hoppas över).",
    );
  }

  return { rows, metadataColumns, warnings, interimListFlag };
}

function parseImportSheet(ws: ExcelJS.Worksheet): { rows: FlatRow[]; metadataColumns: string[] } {
  const fixedHeaderSet = objektmallFixedHeaderSet();
  const matchFixed = (txt: string): ObjektmallColumn | undefined =>
    OBJEKTMALL_FIXED_COLUMNS.find((c) => objektmallColumnHeaderAliases(c).includes(txt));

  // Hitta rubrikraden (rad 1–5). Kräv att den obligatoriska "Objektnamn"-kolumnen finns.
  const requiredCols = OBJEKTMALL_FIXED_COLUMNS.filter((c) => c.required);
  let headerRowIdx = -1;
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const got: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => got.push(cellToStr(cell.value).toLowerCase()));
    const allRequiredFound = requiredCols.every((c) =>
      objektmallColumnHeaderAliases(c).some((h) => got.includes(h)),
    );
    if (allRequiredFound) {
      headerRowIdx = r;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new ValidationError(
      `Hittade ingen rubrikrad i flik "${ws.name}". Förväntade minst kolumnen "Objektnamn" samt nummerkolumnerna A–D.`,
    );
  }

  // Bygg kolumn-index-map: fasta kolumner (per key) + dynamiska metadata-kolumner
  // (per referensnamn på rubrikraden).
  const headerRow = ws.getRow(headerRowIdx);
  const fixedByCol: Record<number, string> = {}; // col -> fast key
  const metaByCol: Record<number, string> = {}; // col -> referensnamn
  const metadataColumns: string[] = [];
  const seenMeta = new Set<string>();
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    const raw = cellToStr(cell.value);
    if (!raw) return;
    const lower = raw.toLowerCase();
    const fixed = matchFixed(lower);
    if (fixed) {
      fixedByCol[col] = fixed.key;
      return;
    }
    // Dynamisk metadata-kolumn — bevara referensnamnet exakt som skrivet.
    if (fixedHeaderSet.has(lower)) return; // skydd: alias som ej fångats ovan
    const refName = raw.trim();
    if (!refName) return;
    metaByCol[col] = refName;
    if (!seenMeta.has(refName.toLowerCase())) {
      seenMeta.add(refName.toLowerCase());
      metadataColumns.push(refName);
    }
  });

  const firstFixedKey = OBJEKTMALL_FIXED_COLUMNS[0].key;
  const firstDesc = (OBJEKTMALL_FIXED_COLUMNS[0].description ?? "").trim();
  const rows: FlatRow[] = [];
  let dataRowNo = 0;
  for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const data: Record<string, string> = {};
    const metadata: Record<string, string> = {};
    let anyValue = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const val = cellToStr(cell.value);
      const fixedKey = fixedByCol[col];
      if (fixedKey) {
        if (val) anyValue = true;
        data[fixedKey] = val;
        return;
      }
      const metaName = metaByCol[col];
      if (metaName) {
        if (val) {
          anyValue = true;
          metadata[metaName] = val;
        }
      }
    });
    if (!anyValue) continue;
    // Hoppa över exempel-raden (markerad i första kolumnen).
    const firstVal = (data[firstFixedKey] ?? "").trim();
    if (firstVal.startsWith("[EXEMPEL")) continue;
    // Skippa beskrivnings-raden vi själva skriver (rad 2 i tom mall): dess
    // första cell är exakt den fasta kolumnens beskrivningstext.
    if (firstDesc && firstVal === firstDesc) continue;
    dataRowNo++;
    rows.push({ rowNumber: dataRowNo, data, metadata });
  }

  return { rows, metadataColumns };
}

// ============================================================
// Validering
// ============================================================
type ParentRef =
  | { mode: "interim"; key: string }
  | { mode: "system"; objectId: string };

// Task #627: per-fält-diff på en uppdaterad rad (gammalt → nytt).
type ChangedField = { field: string; label: string; from: string; to: string };

// Task #632: hur en metadata-kolumn (referensnamn på rad 1) tolkas.
//   known      → mappar mot en riktig objects-kolumn (adress m.fl.), skrivs via
//                objekt-skrivningen, inte som dynamiskt metadatavärde.
//   definition → matchar en metadata_katalog-definition (på namn eller beteckning).
//   unknown    → ingen matchning; värdena hoppas över (varnas i valideringen).
type MetaColumnResolution =
  | { kind: "known" }
  | { kind: "definition"; katalog: MetadataKatalog }
  | { kind: "unknown" };

// Task #632: per-rad-status för ett dynamiskt metadatavärde i förhandsvisningen.
type MetadataChange = {
  refName: string;
  label: string; // katalog.namn
  beteckning: string | null;
  value: string; // rådata-värdet
  status: ImportMetadataWriteStatus; // create | replace | add | unchanged
  allowDuplicates: boolean;
};

// Per-rad upplöst åtgärd som commit-steget återanvänder utan att räkna om.
type RowResolution = {
  action: "create" | "update" | "repoint";
  targetObjectId: string | null; // för update/repoint
  interimNo: string; // "" om ingen
  systemNumber: string; // "" om ingen
  parentRef: ParentRef | null; // null = ingen förälder (rot) / bevaras vid update
  name: string;
  level: ObjLevel; // härledd från djupet i förälderkedjan
  depth: number;
  changed: boolean;
  changedFields: ChangedField[];
  metadata: Record<string, string>; // dynamiska metadata-värden (för förhandsvisning)
  metadataChanges: MetadataChange[]; // Task #632: per-värde-status (create/replace/add)
};

type ValRow = {
  rowNumber: number;
  data: Record<string, string>;
  metadata: Record<string, string>;
  errors: string[];
  // Mellanlagring under upplösning.
  target?: ExistingObject;
  parentRef?: ParentRef | null;
  res?: RowResolution;
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
  notes: string | null;
  containerCount: number | null;
};

interface ImportSheetReport {
  name: string;
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  toRepoint: number;
  errorRows: number;
  errors: Array<{ row: number; messages: string[] }>;
  actions: Array<{
    row: number;
    action: "create" | "update" | "repoint";
    name: string;
    level: ObjLevel;
    levelLabel: string;
    detail: string;
    changed: boolean;
    changedFields: ChangedField[];
    metadata: Record<string, string>;
    metadataChanges: MetadataChange[];
  }>;
}

interface ValidationReport {
  import: ImportSheetReport;
  metadataColumns: string[];
  warnings: string[];
  hasBlockingErrors: boolean;
  interimListFlag: boolean;
}

function parseBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "ja" || s === "yes" || s === "true" || s === "1" || s === "x";
}

async function validateAll(
  flatRows: FlatRow[],
  metadataColumns: string[],
  tenantId: string,
  warnings: string[],
  interimListFlag: boolean = false,
): Promise<{
  report: ValidationReport;
  rows: ValRow[];
  metaResolution: Map<string, MetaColumnResolution>;
}> {
  const trim = (data: Record<string, string>, key: string) => (data[key] ?? "").trim();

  const valRows: ValRow[] = flatRows.map((r) => ({
    rowNumber: r.rowNumber,
    data: r.data,
    metadata: r.metadata,
    errors: [],
  }));

  // Task #632: lös upp varje dynamisk metadata-kolumn (referensnamn på rad 1)
  // mot en metadata_katalog-definition (match på namn ELLER beteckning, case-
  // insensitivt). Kända objektfält (adress m.fl.) skrivs via objekt-skrivningen
  // och klassas som "known". Okända referensnamn varnas och hoppas över.
  const metaResolution = new Map<string, MetaColumnResolution>();
  {
    const katalogDefs = metadataColumns.length
      ? await db.select().from(metadataKatalog).where(eq(metadataKatalog.tenantId, tenantId))
      : [];
    const katByNamn = new Map<string, MetadataKatalog>();
    const katByBeteckning = new Map<string, MetadataKatalog>();
    for (const k of katalogDefs) {
      katByNamn.set(k.namn.trim().toLowerCase(), k);
      if (k.beteckning) katByBeteckning.set(k.beteckning.trim().toLowerCase(), k);
    }
    for (const refName of metadataColumns) {
      if (isKnownObjectFieldRef(refName)) {
        metaResolution.set(refName, { kind: "known" });
        continue;
      }
      const lower = refName.trim().toLowerCase();
      const kat = katByNamn.get(lower) ?? katByBeteckning.get(lower);
      if (kat) {
        metaResolution.set(refName, { kind: "definition", katalog: kat });
      } else {
        metaResolution.set(refName, { kind: "unknown" });
        warnings.push(
          `Metadata-kolumnen "${refName}" matchar ingen metadata-definition (varken namn eller beteckning) — dess värden hoppas över. Skapa en definition i metadata-katalogen för att importera värdena.`,
        );
      }
    }
  }

  // 1. Interim-unikhet över hela fliken.
  const interimToRow = new Map<string, ValRow>();
  {
    const seen = new Set<string>();
    for (const row of valRows) {
      const interimNo = trim(row.data, "interim");
      if (!interimNo) continue;
      if (seen.has(interimNo)) {
        row.errors.push(`Dubblett av interimsnummer "${interimNo}"`);
        continue;
      }
      seen.add(interimNo);
      interimToRow.set(interimNo, row);
    }
  }

  // 2. Förladda befintliga objekt för matchning (systemnummer/butiksnummer + namn).
  const numberLookup = new Set<string>();
  const nameLookup = new Set<string>();
  for (const row of valRows) {
    const sysNo = interimListFlag ? "" : trim(row.data, "systemNumber");
    const sysParent = interimListFlag ? "" : trim(row.data, "systemParentNumber");
    const interimNo = trim(row.data, "interim");
    const name = trim(row.data, "name");
    if (sysNo) numberLookup.add(sysNo);
    if (sysParent) numberLookup.add(sysParent);
    if (interimNo) numberLookup.add(OBJEKTMALL_INTERIM_PREFIX + interimNo);
    if (sysNo && name) nameLookup.add(name.toLowerCase());
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
        notes: objects.notes,
        containerCount: objects.containerCount,
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
        notes: e.notes ?? null,
        containerCount: e.containerCount ?? null,
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

  // Lättvikts id->parentId-karta för hela tenant — används för att räkna djup på
  // system-föräldrar (som kan ligga utanför filen).
  const parentIdMap = new Map<string, string | null>();
  {
    const all = await db
      .select({ id: objects.id, parentId: objects.parentId })
      .from(objects)
      .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
    for (const r of all) parentIdMap.set(r.id, r.parentId ?? null);
  }
  const systemDepthCache = new Map<string, number>();
  function systemDepth(id: string): number {
    if (systemDepthCache.has(id)) return systemDepthCache.get(id)!;
    let d = 0;
    let cur: string = id;
    const seen = new Set<string>();
    while (!seen.has(cur)) {
      seen.add(cur);
      const p: string | null = parentIdMap.get(cur) ?? null;
      if (!p) break;
      d++;
      cur = p;
      if (d > 50) break;
    }
    systemDepthCache.set(id, d);
    return d;
  }

  // 3. Klassificera varje rad (skapa/uppdatera) + matcha mot befintligt objekt.
  for (const row of valRows) {
    if (row.errors.length) continue;
    const data = row.data;
    const interimNo = trim(data, "interim");
    const sysNo = interimListFlag ? "" : trim(data, "systemNumber");
    const name = trim(data, "name");

    if (!sysNo && !interimNo) {
      row.errors.push(
        interimListFlag
          ? "Interimsnummer krävs i interimslist-läge (ren nyimport)."
          : "Raden saknar både Systemnummer (uppdatering) och Interimsnummer (nytt objekt).",
      );
      continue;
    }
    if (!name) {
      row.errors.push('Saknat värde: "Objektnamn"');
      continue;
    }

    let target: ExistingObject | undefined;
    if (sysNo) {
      target = byObjNum.get(sysNo);
      if (!target) {
        const matches = byNameLower.get(name.toLowerCase()) ?? [];
        if (matches.length === 1) {
          target = matches[0];
        } else if (matches.length > 1) {
          row.errors.push(
            `Flera befintliga objekt har namnet "${name}". Ange ett exakt Systemnummer för att peka ut rätt objekt.`,
          );
          continue;
        } else {
          row.errors.push(
            `Systemnummer "${sysNo}" (eller namn "${name}") matchade inget befintligt objekt.`,
          );
          continue;
        }
      }
    } else {
      // Endast interim → re-import uppdaterar om MALL-<interim> redan finns.
      target = byObjNum.get(OBJEKTMALL_INTERIM_PREFIX + interimNo);
    }
    row.target = target;
  }

  // 4. Lös upp förälder per rad (ordnings-oberoende).
  for (const row of valRows) {
    if (row.errors.length) continue;
    const data = row.data;
    const sysParent = interimListFlag ? "" : trim(data, "systemParentNumber");
    const parentInterim = trim(data, "parentInterim");
    let parentRef: ParentRef | null = null;

    if (parentInterim) {
      const pr = interimToRow.get(parentInterim);
      if (!pr) {
        row.errors.push(`Interimföräldranummer "${parentInterim}" hittades inte i filen.`);
        continue;
      }
      if (pr === row) {
        row.errors.push("En rad kan inte vara sin egen förälder.");
        continue;
      }
      parentRef = { mode: "interim", key: parentInterim };
    } else if (sysParent) {
      const pObj = byObjNum.get(sysParent);
      if (!pObj) {
        row.errors.push(`Systemföräldranummer "${sysParent}" matchade inget befintligt objekt.`);
        continue;
      }
      parentRef = { mode: "system", objectId: pObj.id };
    }
    row.parentRef = parentRef;
  }

  // 5. Härled djup (och därmed nivå) per rad via förälderkedjan. Cykler flaggas.
  const depthCache = new Map<ValRow, number>();
  function rowDepth(row: ValRow, stack: Set<ValRow>): number | null {
    if (depthCache.has(row)) return depthCache.get(row)!;
    const parentRef = row.parentRef ?? null;
    if (!parentRef) {
      depthCache.set(row, 0);
      return 0;
    }
    if (parentRef.mode === "system") {
      const d = systemDepth(parentRef.objectId) + 1;
      depthCache.set(row, d);
      return d;
    }
    // interim-förälder i filen
    const pr = interimToRow.get(parentRef.key);
    if (!pr) {
      // Bör redan ha flaggats i steg 4, men var defensiv.
      return null;
    }
    if (stack.has(pr)) {
      return null; // cykel
    }
    stack.add(pr);
    const pd = rowDepth(pr, stack);
    stack.delete(pr);
    if (pd === null) return null;
    const d = pd + 1;
    depthCache.set(row, d);
    return d;
  }

  for (const row of valRows) {
    if (row.errors.length) continue;
    const d = rowDepth(row, new Set([row]));
    if (d === null) {
      row.errors.push("Cyklisk förälderkedja upptäckt (en rad är förälder till sig själv via interimsnummer).");
    }
  }

  // Task #632: förladda befintliga metadatavärden för alla mål-objekt (update/
  // repoint) per definitions-katalog, så att förhandsvisningens status (ersätt vs
  // lägg-till vs oförändrad) matchar exakt vad commit-steget gör.
  const existingMetaValues = new Map<string, Map<string, string[]>>(); // objektId -> katalogId -> displayValues
  {
    const definitionKatalogIds = Array.from(
      new Set(
        Array.from(metaResolution.values())
          .filter((r): r is { kind: "definition"; katalog: MetadataKatalog } => r.kind === "definition")
          .map((r) => r.katalog.id),
      ),
    );
    const targetIds = Array.from(
      new Set(valRows.filter((r) => r.target).map((r) => r.target!.id)),
    );
    if (definitionKatalogIds.length && targetIds.length) {
      const existingRows = await db
        .select()
        .from(metadataVarden)
        .where(
          and(
            eq(metadataVarden.tenantId, tenantId),
            inArray(metadataVarden.objektId, targetIds),
            inArray(metadataVarden.metadataKatalogId, definitionKatalogIds),
          ),
        );
      for (const ev of existingRows) {
        if (!ev.objektId) continue;
        const dv = getDisplayValue(ev);
        if (dv === null) continue;
        let perObj = existingMetaValues.get(ev.objektId);
        if (!perObj) {
          perObj = new Map<string, string[]>();
          existingMetaValues.set(ev.objektId, perObj);
        }
        const arr = perObj.get(ev.metadataKatalogId) ?? [];
        arr.push(dv);
        perObj.set(ev.metadataKatalogId, arr);
      }
    }
  }

  // 6. Bygg RowResolution: nivå, repekning, namn-diff, metadata-karta.
  for (const row of valRows) {
    if (row.errors.length) continue;
    const data = row.data;
    const interimNo = trim(data, "interim");
    const sysNo = interimListFlag ? "" : trim(data, "systemNumber");
    const name = trim(data, "name");
    const target = row.target;
    const parentRef = row.parentRef ?? null;
    const depth = depthCache.get(row) ?? 0;
    const level = levelForDepth(depth);

    let action: RowResolution["action"] = target ? "update" : "create";

    // Repekning: uppdatering där angiven förälder skiljer sig från nuvarande.
    if (action === "update" && parentRef && target) {
      let newParentId: string | null;
      if (parentRef.mode === "interim") {
        const pr = interimToRow.get(parentRef.key);
        newParentId = pr?.target?.id ?? `NEW:${parentRef.key}`;
      } else {
        newParentId = parentRef.objectId;
      }
      if (newParentId !== target.parentId) action = "repoint";
    }

    // Diffen speglar exakt vad commit-steget skriver: namn samt de kända
    // objektfält (adress/ort/postnummer/anteckningar/antal kärl) som ligger bland
    // de dynamiska metadata-kolumnerna. Fria metadata-värden (definitions-kolumner)
    // persisteras via metadataChanges nedan.
    const changedFields: ChangedField[] = [];
    if (target && (action === "update" || action === "repoint")) {
      if (name && name !== (target.name ?? "")) {
        changedFields.push({ field: "name", label: "Namn", from: target.name ?? "", to: name });
      }
      const known = extractKnownObjectFields(row.metadata);
      if (known.address !== undefined && known.address !== (target.address ?? "")) {
        changedFields.push({ field: "address", label: "Adress", from: target.address ?? "", to: known.address });
      }
      if (known.city !== undefined && known.city !== (target.city ?? "")) {
        changedFields.push({ field: "city", label: "Ort", from: target.city ?? "", to: known.city });
      }
      if (known.postalCode !== undefined && known.postalCode !== (target.postalCode ?? "")) {
        changedFields.push({ field: "postalCode", label: "Postnummer", from: target.postalCode ?? "", to: known.postalCode });
      }
      if (known.notes !== undefined && known.notes !== (target.notes ?? "")) {
        changedFields.push({ field: "notes", label: "Anteckningar", from: target.notes ?? "", to: known.notes });
      }
      if (known.containerCount !== undefined && known.containerCount !== (target.containerCount ?? 0)) {
        changedFields.push({
          field: "containerCount",
          label: "Antal kärl",
          from: String(target.containerCount ?? 0),
          to: String(known.containerCount),
        });
      }
    }
    // Task #632: validera och statusbedöm dynamiska metadata-värden (definitions-
    // kolumner). Ogiltiga värden (datatyp/allowedValues) blockerar raden.
    const metadataChanges: MetadataChange[] = [];
    for (const [refName, rawVal] of Object.entries(row.metadata)) {
      const value = (rawVal ?? "").trim();
      if (!value) continue;
      const resn = metaResolution.get(refName);
      if (!resn || resn.kind !== "definition") continue; // known/unknown hanteras separat
      const kat = resn.katalog;
      let displayValue: string;
      try {
        displayValue = coerceMetadataVardeFromRaw(kat, value).displayValue;
      } catch (e) {
        row.errors.push(
          `Ogiltigt metadata-värde i kolumnen "${refName}": ${(e as Error).message}`,
        );
        continue;
      }
      const existingForObj = target
        ? existingMetaValues.get(target.id)?.get(kat.id) ?? []
        : [];
      const status = computeImportMetadataStatus(
        kat.allowDuplicates ?? false,
        existingForObj,
        displayValue,
      );
      metadataChanges.push({
        refName,
        label: kat.namn,
        beteckning: kat.beteckning ?? null,
        value,
        status,
        allowDuplicates: kat.allowDuplicates ?? false,
      });
    }
    // Ogiltiga metadata-värden ska blockera raden från commit.
    if (row.errors.length) continue;

    const changed =
      action === "create" ||
      action === "repoint" ||
      changedFields.length > 0 ||
      metadataChanges.some((m) => m.status !== "unchanged");

    row.res = {
      action,
      targetObjectId: target?.id ?? null,
      interimNo,
      systemNumber: sysNo,
      parentRef,
      name,
      level,
      depth,
      changed,
      changedFields,
      metadata: row.metadata,
      metadataChanges,
    };
  }

  // 7. Bygg rapport.
  const errors: Array<{ row: number; messages: string[] }> = [];
  const actions: ImportSheetReport["actions"] = [];
  let toCreate = 0;
  let toUpdate = 0;
  let toRepoint = 0;
  let errorRows = 0;
  for (const row of valRows) {
    if (row.errors.length || !row.res) {
      if (row.errors.length) {
        errorRows++;
        errors.push({ row: row.rowNumber, messages: row.errors });
      }
      continue;
    }
    const res = row.res;
    if (res.action === "create") toCreate++;
    else if (res.action === "repoint") toRepoint++;
    else toUpdate++;

    if (actions.length < 500) {
      const detail =
        res.action === "create"
          ? "Skapar nytt objekt"
          : res.action === "repoint"
            ? "Uppdaterar + pekar om till ny förälder"
            : "Uppdaterar befintligt objekt";
      actions.push({
        row: row.rowNumber,
        action: res.action,
        name: res.name,
        level: res.level,
        levelLabel: LEVEL_META[res.level].label,
        detail,
        changed: res.changed,
        changedFields: res.changedFields,
        metadata: res.metadata,
        metadataChanges: res.metadataChanges,
      });
    }
  }

  const report: ValidationReport = {
    import: {
      name: OBJEKTMALL_IMPORT_SHEET_NAME,
      totalRows: valRows.length,
      toCreate,
      toUpdate,
      toRepoint,
      errorRows,
      errors: errors.slice(0, 500),
      actions,
    },
    metadataColumns,
    warnings,
    hasBlockingErrors: errorRows > 0,
    interimListFlag,
  };

  return { report, rows: valRows, metaResolution };
}

// ============================================================
// Commit
// ============================================================
async function commitImport(
  tenantId: string,
  userId: string | null,
  fileName: string,
  validation: Awaited<ReturnType<typeof validateAll>>,
): Promise<{ batchId: string; created: Record<string, number>; updated: Record<string, number>; repointed: Record<string, number>; metadataValuesWritten: number }> {
  if (validation.report.hasBlockingErrors) {
    throw new ValidationError("Importen har valideringsfel — fixa fel och kör torrkörning igen innan skarp import.");
  }
  const batchId = `${OBJEKTMALL_BATCH_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created: Record<ObjLevel, number> = { organisation: 0, stores: 0, containers: 0 };
  const updated: Record<ObjLevel, number> = { organisation: 0, stores: 0, containers: 0 };
  const repointed: Record<ObjLevel, number> = { organisation: 0, stores: 0, containers: 0 };

  // Task #632: dynamiska metadata-värden som skrivs i samma transaktion.
  const metaResolution = validation.metaResolution;
  let metadataValuesWritten = 0;
  // Objekt vars metadata ändrats — efter commit triggar vi prisräkning/kluster.
  const metadataAffectedObjectIds = new Set<string>();

  // Bearbeta rader i djup-ordning så att en interim-förälder alltid finns
  // (skapas/upplöses) innan dess barn.
  const ordered = validation.rows
    .filter((r) => !r.errors.length && r.res)
    .sort((a, b) => (a.res!.depth - b.res!.depth));

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

    // Cache av (resolverad) adress-triplett per objekt-id, så att barn som skapas
    // senare i samma körning kan ärva förälderns adress utan extra DB-frågor.
    const addrCache = new Map<string, { address: string | null; city: string | null; postalCode: string | null }>();

    async function getInheritedAddress(
      parentId: string | null | undefined,
    ): Promise<{ address: string | null; city: string | null; postalCode: string | null }> {
      if (!parentId) return { address: null, city: null, postalCode: null };
      const cached = addrCache.get(parentId);
      if (cached) return cached;
      const [p] = await tx
        .select({ address: objects.address, city: objects.city, postalCode: objects.postalCode })
        .from(objects)
        .where(and(eq(objects.id, parentId), eq(objects.tenantId, tenantId)));
      const v = { address: p?.address ?? null, city: p?.city ?? null, postalCode: p?.postalCode ?? null };
      addrCache.set(parentId, v);
      return v;
    }

    function resolveParentId(parentRef: ParentRef | null): string | null | undefined {
      if (!parentRef) return undefined;
      if (parentRef.mode === "interim") return interimToObjectId.get(parentRef.key) ?? null;
      return parentRef.objectId;
    }

    // Task #632: skriv dynamiska metadata-värden (definitions-kolumner) för ett
    // objekt enligt post-it-modellen (§6.12): Ersättande (allowDuplicates=false)
    // uppdaterar + arkiverar gammalt värde i historiken; Kompletterande
    // (allowDuplicates=true) lägger till parallellt. Identiska värden = oförändrat.
    async function writeRowMetadata(objId: string, res: RowResolution): Promise<void> {
      for (const [refName, rawVal] of Object.entries(res.metadata)) {
        const value = (rawVal ?? "").trim();
        if (!value) continue;
        const resn = metaResolution.get(refName);
        if (!resn || resn.kind !== "definition") continue; // known/unknown skrivs ej här
        const status = await writeImportedMetadataValue(tx, {
          tenantId,
          objektId: objId,
          katalog: resn.katalog,
          rawValue: value,
          andradAv: userId,
        });
        if (status !== "unchanged") {
          metadataValuesWritten++;
          metadataAffectedObjectIds.add(objId);
        }
      }
    }

    // Task #619: håll object_parents i synk med objektets primära förälder.
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

    for (const row of ordered) {
      const res = row.res!;
      const level = res.level;
      const meta = LEVEL_META[level];
      const parentObjectId = resolveParentId(res.parentRef);

      // Kända objektfält bland de dynamiska metadata-kolumnerna (adress m.fl.).
      const known = extractKnownObjectFields(res.metadata);

      if (res.action === "create") {
        let address = known.address ?? null;
        let city = known.city ?? null;
        let postalCode = known.postalCode ?? null;
        // Ärv adress från förälder när raden saknar egen adress (t.ex. kärl).
        if (!address && !city && !postalCode && parentObjectId) {
          const inh = await getInheritedAddress(parentObjectId);
          address = inh.address;
          city = inh.city;
          postalCode = inh.postalCode;
        }
        const [inserted] = await tx
          .insert(objects)
          .values({
            tenantId,
            customerId,
            parentId: parentObjectId ?? null,
            name: res.name,
            objectNumber: OBJEKTMALL_INTERIM_PREFIX + res.interimNo,
            objectType: meta.objectType,
            hierarchyLevel: meta.hierarchyLevel,
            address,
            city,
            postalCode,
            notes: known.notes ?? null,
            ...(known.containerCount !== undefined ? { containerCount: known.containerCount } : {}),
            importBatchId: batchId,
          } as any)
          .returning({ id: objects.id });
        if (res.interimNo) interimToObjectId.set(res.interimNo, inserted.id);
        addrCache.set(inserted.id, { address, city, postalCode });
        await syncPrimaryObjectParent(inserted.id, parentObjectId ?? null);
        await writeRowMetadata(inserted.id, res);
        created[level]++;
      } else if (res.targetObjectId) {
        const set: Record<string, unknown> = { name: res.name, importBatchId: batchId };
        // Förälder sätts enbart när den uttryckligen angetts (peka-om), annars bevaras.
        if (parentObjectId !== undefined) set.parentId = parentObjectId;
        // Partiell uppdatering av kända objektfält — utelämnade fält bevaras.
        if (known.address !== undefined) set.address = known.address;
        if (known.city !== undefined) set.city = known.city;
        if (known.postalCode !== undefined) set.postalCode = known.postalCode;
        if (known.notes !== undefined) set.notes = known.notes;
        if (known.containerCount !== undefined) set.containerCount = known.containerCount;
        // Vid peka-om: ärv adress från den nya föräldern om raden inte själv anger adress.
        if (
          res.action === "repoint" &&
          parentObjectId &&
          known.address === undefined &&
          known.city === undefined &&
          known.postalCode === undefined
        ) {
          const inh = await getInheritedAddress(parentObjectId);
          if (inh.address || inh.city || inh.postalCode) {
            set.address = inh.address;
            set.city = inh.city;
            set.postalCode = inh.postalCode;
          }
        }
        await tx
          .update(objects)
          .set(set)
          .where(and(eq(objects.id, res.targetObjectId), eq(objects.tenantId, tenantId)));
        if (res.interimNo) interimToObjectId.set(res.interimNo, res.targetObjectId);
        // Invalidera adress-cachen så ev. barn senare i körningen ärver färska värden.
        addrCache.delete(res.targetObjectId);
        if (parentObjectId !== undefined) await syncPrimaryObjectParent(res.targetObjectId, parentObjectId);
        await writeRowMetadata(res.targetObjectId, res);
        if (res.action === "repoint") repointed[level]++;
        else updated[level]++;
      }
    }

    // Spara batch-spår
    const totalCreated = Object.values(created).reduce((a, b) => a + b, 0);
    const totalUpdated = Object.values(updated).reduce((a, b) => a + b, 0);
    const totalRepointed = Object.values(repointed).reduce((a, b) => a + b, 0);
    await tx.insert(importBatches).values({
      tenantId,
      batchId,
      totalRows: validation.report.import.totalRows,
      created: totalCreated,
      // Repekningar räknas som uppdateringar i batch-sammandraget.
      updated: totalUpdated + totalRepointed,
      errors: 0,
      metadata: {
        source: "objektmall",
        fileName,
        userId,
        createdBy: userId,
        interimListFlag: validation.report.interimListFlag,
        metadataColumns: validation.report.metadataColumns,
        metadataValuesWritten,
        perLevel: {
          created,
          updated,
          repointed,
        },
      } as any,
    } as any);
  });

  // Efter commit: trigga prisräkning/kluster-utvärdering för objekt vars metadata
  // ändrats (debouncad, fire-and-forget). force=true för bulk-import.
  metadataAffectedObjectIds.forEach((objId) => {
    enqueueMetadataChange(tenantId, objId, { force: true });
  });

  return { batchId, created, updated, repointed, metadataValuesWritten };
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

  // === Export befintliga objekt (Task #621) =================================
  app.get(
    "/api/admin/objektmall/export",
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const mode: ObjektmallExportMode = req.query.mode === "interim" ? "interim" : "update";
      const buf = await buildExportWorkbook(tenantId, mode);
      const datestamp = new Date().toISOString().slice(0, 10);
      const fileName = `traivo-objektexport-${mode === "interim" ? "interim" : "uppdatering"}-${datestamp}.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
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

      const { rows, metadataColumns, warnings, interimListFlag } = await parseWorkbook(file.buffer);
      const validation = await validateAll(rows, metadataColumns, tenantId, warnings, interimListFlag);
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

      const { rows, metadataColumns, warnings, interimListFlag } = await parseWorkbook(file.buffer);
      const validation = await validateAll(rows, metadataColumns, tenantId, warnings, interimListFlag);
      if (validation.report.hasBlockingErrors) {
        return res.status(400).json({
          ok: false,
          fileName: file.originalname,
          report: validation.report,
          message: "Valideringsfel — fixa fel och försök igen.",
        });
      }

      const result = await commitImport(tenantId, userId, file.originalname, validation);
      res.json({
        ok: true,
        fileName: file.originalname,
        templateVersion: OBJEKTMALL_VERSION,
        batchId: result.batchId,
        created: result.created,
        updated: result.updated,
        repointed: result.repointed,
        metadataValuesWritten: result.metadataValuesWritten,
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
