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
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, or, sql, desc, inArray, isNull } from "drizzle-orm";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError, ConflictError } from "../errors";
import { getTenantIdWithFallback, requireAdmin, requireTenantWithFallback } from "../tenant-middleware";
import { db } from "../db";
import {
  objects,
  objectParents,
  metadataKatalog,
  metadataVarden,
  importBatches,
  importTemplates,
  users,
  type MetadataKatalog,
  type ImportTemplate,
} from "@shared/schema";
import {
  coerceMetadataVardeFromRaw,
  computeImportMetadataStatus,
  writeImportedMetadataValue,
  getDisplayValue,
  getMetadataDefinitionsCompat,
  resolveTemplateFieldHeaders,
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
  parseCompositeRef,
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
// Task #634: ett metadata-referensnamn på rad 1 kan vara
//   • klartext            "Gatuadress"
//   • generisk kod         "22"            (beteckning ELLER visningsnummer)
//   • hybrid               "22:Gatuadress"
// Vi delar på FÖRSTA kolon: vänster = kod, höger = namn. Saknas kolon är hela
// strängen "namnet" (men kan ändå provas som ren kod nedan).
export function parseMetadataRef(refName: string): { raw: string; code: string | null; name: string } {
  const raw = (refName ?? "").trim();
  const idx = raw.indexOf(":");
  if (idx > 0) {
    const code = raw.slice(0, idx).trim();
    const name = raw.slice(idx + 1).trim();
    if (code && name) return { raw, code, name };
  }
  return { raw, code: null, name: raw };
}

// Task #634: språkmärkt namnkolumn, t.ex. "namn_sv", "name-en", "objektnamn fi".
// Returnerar gemen språkkod (2–3 bokstäver) eller null. En enkel "Namn"/"Name"
// utan språk-suffix matchar INTE (det är kolumn E:s rubrik).
export function parseLanguageNameRef(refName: string): string | null {
  const m = (refName ?? "").trim().match(/^(?:namn|name|objektnamn)[ _\-]?([a-z]{2,3})$/i);
  return m ? m[1].toLowerCase() : null;
}

// Task #643: kundens egna butiksnummer/externt ID lagras som en vanlig metadata-
// kolumn (ALDRIG kolumn A, som alltid är Traivos systemnummer). En rad utan
// system-/interimsnummer kan ändå matchas mot ett befintligt objekt via det
// externa ID:t. Vi känner igen externt-ID-kolumner på referensnamnet (namn-delen,
// hybrid "kod:namn" stöds) efter normalisering: gemener utan mellanslag/_/-.
const EXTERNAL_ID_REF_ALIASES = new Set<string>([
  "externtid",
  "externidentitet",
  "externalid",
  "externidentity",
  "butiksnummer",
  "butiksnr",
  "butiksid",
]);

export function normalizeExternalIdToken(s: string): string {
  return (s ?? "").toLowerCase().replace(/[\s_\-]/g, "");
}

// Är en metadata-kolumns referensnamn ett externt-ID-fält (butiksnummer m.fl.)?
export function isExternalIdRef(refName: string): boolean {
  return EXTERNAL_ID_REF_ALIASES.has(normalizeExternalIdToken(parseMetadataRef(refName).name));
}

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
    // Task #634: matcha kända fält mot namn-delen även i hybridform "22:Gatuadress".
    if (val) lowerMap.set(parseMetadataRef(k).name.toLowerCase(), val);
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
  // Task #634: bedöm namn-delen så hybrid "22:Gatuadress" känns igen som känt fält.
  return KNOWN_FIELD_ALIAS_SET.has(parseMetadataRef(refName).name.toLowerCase());
}

// ============================================================
// Mall-generator
// ============================================================
export async function buildTemplateWorkbook(): Promise<Buffer> {
  // Standardmall: exempel-metadata-kolumner (förslag som användaren byter ut).
  return buildObjektmallWorkbook([...OBJEKTMALL_EXAMPLE_METADATA_HEADERS], {
    exampleMetaValues: [
      "Storgatan",
      "5",
      "614 30",
      "Söderköping",
      "Anna Andersson",
      "Platschef",
      "070-123 45 67",
      "BUTIK-4711",
    ],
  });
}

// Task #664: Parametriserad objektmall-generator. Bygger samma enflik-mall
// (README "Läs mig först" + "Import"-flik med fasta kolumner A–E) men låter
// anroparen injicera de dynamiska metadata-kolumnerna (kolumn F+) via en
// header-lista. Används både av standardmallen ovan (exempel-headers) och av
// de namngivna importmallarna (valda katalogfälts härledda headers).
export async function buildObjektmallWorkbook(
  metadataHeaders: string[],
  opts?: { exampleMetaValues?: string[]; readmeTitle?: string },
): Promise<Buffer> {
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
    "  • Systemnummer — Traivos eget systemnummer för ett BEFINTLIGT objekt (unikt ID som",
    "    systemet skapar). Fyll i för att UPPDATERA. Kundens egna butiksnummer läggs i en",
    "    separat metadata-kolumn (t.ex. 'externt_id') — inte i kolumn A.",
    "  • Interimsnummer — ditt eget löpnummer för NYA objekt; binder ihop nivåerna och möjliggör re-import.",
    "  • Systemföräldranummer — peka objektet mot en BEFINTLIG förälder (system→system).",
    "  • Interimföräldranummer — peka mot en rad i denna fil (ny eller befintlig). Lämna tomt för rotnivå.",
    "  • Objektnamn — obligatoriskt på varje rad.",
    "",
    "DYNAMISKA METADATA-KOLUMNER (F och framåt):",
    "  • Skriv metadata-referensnamnet på rad 1 (rubrikraden) och värdet på varje objektrad.",
    "  • Du kan lägga till så många metadata-kolumner du vill. Exempelkolumnerna (Adress, Postnummer …)",
    "    är bara förslag — byt ut eller lägg till egna referensnamn.",
    "  • Referensnamnet kan skrivas på tre sätt: klartext (Gatuadress), generisk kod (22 = beteckning",
    "    eller visningsnummer) eller hybrid (22:Gatuadress). Alla tre mappas till samma definition;",
    "    okända koder rapporteras som varning i torrkörningen.",
    "",
    "SPRÅKMÄRKTA NAMN (valfritt):",
    "  • Lägg till kolumner som namn_sv, namn_en, namn_fi för att ge objektet visningsnamn per språk.",
    "  • Dessa påverkar INTE kolumn E (det interna namnet) eller släktnamnen — de används bara som",
    "    lokaliserat visningsnamn med fallback till det interna namnet.",
    "",
    "SAMMANSATTA METADATAFÄLT (punktnotation \"fält.underfält\"):",
    "  • Vissa fält har underfält. Skriv dem som \"fält.underfält\" så grupperas kolumner med",
    "    samma prefix (delen före punkten) ihop till ETT logiskt fält som lagras strukturerat.",
    "  • Exempel adress: kolumnerna \"adress.gata\", \"adress.gatunummer\", \"adress.postnummer\"",
    "    och \"adress.ort\" slås ihop till ett sammansatt värde på fältet \"adress\".",
    "  • Samma logik gäller kontaktpersoner: \"kontaktperson.namn\", \"kontaktperson.titel\",",
    "    \"kontaktperson.telefon\" slås ihop till ett sammansatt fält \"kontaktperson\".",
    "  • Prefixet (t.ex. \"adress\") måste matcha en metadata-definition precis som vanliga kolumner.",
    "",
    "PROPAGERING AV SAMMANSATTA FÄLT:",
    "  • Om ett sammansatt fält (t.ex. \"adress\") flödar nedåt i hierarkin kan enskilda underfält",
    "    överskuggas på lägre nivåer. T.ex. postnummer och ort ärvs nedåt, medan gatuadress sätts",
    "    per objekt. Ett underfält som har eget värde på en lägre nivå vinner över det ärvda.",
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
  const allHeaders = [...fixedHeaders, ...metadataHeaders];
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
    ...metadataHeaders.map((h) => {
      const composite = parseCompositeRef(h);
      return composite
        ? `Underfält "${composite.subfield}" till det sammansatta fältet "${composite.prefix}" (punktnotation). Grupperas ihop med övriga "${composite.prefix}.*"-kolumner.`
        : "Metadata-referensnamn (byt ut/lägg till egna). Värdet skrivs på varje objektrad.";
    }),
  ];
  const descRow = ws.addRow(descs);
  descRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { italic: true, size: 9, color: { argb: "FF6B7C8C" } };
    cell.alignment = { vertical: "top", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F2" } };
  });
  descRow.height = 36;

  // Rad 3 — exempelrad (markerad så användaren förstår att ta bort den). Fasta
  // kolumner A–E har konstant exempel; metadata-kolumnerna fylls med anroparens
  // exempelvärden (tomma för namngivna mallar).
  const fixedExampleValues = [
    "[EXEMPEL – ta bort denna rad]",
    "ORG-1",
    "",
    "",
    "KINAB Koncern",
  ];
  const metaExampleValues =
    opts?.exampleMetaValues ?? metadataHeaders.map(() => "");
  const exampleValues = [...fixedExampleValues, ...metaExampleValues];
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
  // Task #992: läs från den kanoniska svenska modellen (metadata_katalog via
  // compat-vyn + metadata_varden) så att exporten round-trippar med importerade
  // värden. defs[].id === katalog.id === metadata_varden.metadataKatalogId.
  const defs = await getMetadataDefinitionsCompat(tenantId);
  const defById = new Map(defs.map((d) => [d.id, d]));

  // objectId -> (katalogId -> värde)
  const valuesByObject = new Map<string, Map<string, string>>();
  if (objs.length > 0) {
    const metaRows = await db
      .select()
      .from(metadataVarden)
      .where(and(eq(metadataVarden.tenantId, tenantId), eq(metadataVarden.raderad, false)));
    for (const m of metaRows) {
      if (!m.objektId || !defById.has(m.metadataKatalogId)) continue;
      const val = getDisplayValue(m);
      if (!val) continue;
      let inner = valuesByObject.get(m.objektId);
      if (!inner) {
        inner = new Map();
        valuesByObject.set(m.objektId, inner);
      }
      inner.set(m.metadataKatalogId, val);
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
          "Systemnummer (kolumn A) är Traivos eget ID och är ifyllt på varje rad — ändra fält",
          "direkt och läs tillbaka filen via objektimporten för att UPPDATERA befintliga objekt.",
          "Använd kolumn A för att kartlägga era egna butiksnummer/externt ID (en egen metadata-",
          "kolumn, t.ex. Butiksnummer) mot Traivos systemnummer. En rad utan systemnummer kan",
          "ändå matchas om dess externt-ID-värde är unikt — annars ge raden ett interimsnummer.",
          "Lägg nya objekt i en separat interimslista (se 'Exportera som interim-mall') enligt",
          "principen att inte blanda listor.",
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
  // Task #992: kolumnrubrik = fieldKey (deriveMetadataDotKey ?? namn) — samma
  // nyckel som den svenska import-matchningen (buildMetadataTypeLookup) resolvar
  // mot, så att exporterade värden round-trippar vid återimport (inkl. punkt-
  // notation för sammansatta fält).
  const metaHeaders = metaDefsWithValues.map((d) => d.fieldKey);
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
  // Sammansatta metadatafält (Task #633): prefix -> { underfält -> värde }.
  // Kolumner med punktnotation ("adress.gata") grupperas hit, ALDRIG i `metadata`.
  composite: Record<string, Record<string, string>>;
};

// En sammansatt metadata-kolumngrupp som hittats i rubrikraden (Task #633).
type CompositeColumn = { prefix: string; subfields: string[] };

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
): Promise<{
  rows: FlatRow[];
  metadataColumns: string[];
  compositeColumns: CompositeColumn[];
  warnings: string[];
  interimListFlag: boolean;
}> {
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

  const { rows, metadataColumns, compositeColumns } = parseImportSheet(ws);

  const interimListFlag = readInterimListFlag(wb);
  if (interimListFlag) {
    warnings.push(
      "Interimslist-läge är PÅ — hela filen tolkas som ren nyimport (system-/uppdateringsmatchning hoppas över).",
    );
  }

  return { rows, metadataColumns, compositeColumns, warnings, interimListFlag };
}

function parseImportSheet(ws: ExcelJS.Worksheet): {
  rows: FlatRow[];
  metadataColumns: string[];
  compositeColumns: CompositeColumn[];
} {
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
  // Sammansatta kolumner: col -> { prefix, subfield } (punktnotation, Task #633).
  const compositeByCol: Record<number, { prefix: string; subfield: string }> = {};
  const metadataColumns: string[] = [];
  const seenMeta = new Set<string>();
  // prefix (gemener) -> { prefix (orig), subfields i kolumnordning }
  const compositeGroups = new Map<string, { prefix: string; subfields: string[]; seen: Set<string> }>();
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
    // Sammansatt kolumn (punktnotation) grupperas separat — aldrig som platt metadata.
    const composite = parseCompositeRef(refName);
    if (composite) {
      compositeByCol[col] = composite;
      const groupKey = composite.prefix.toLowerCase();
      let group = compositeGroups.get(groupKey);
      if (!group) {
        group = { prefix: composite.prefix, subfields: [], seen: new Set() };
        compositeGroups.set(groupKey, group);
      }
      const subKey = composite.subfield.toLowerCase();
      if (!group.seen.has(subKey)) {
        group.seen.add(subKey);
        group.subfields.push(composite.subfield);
      }
      return;
    }
    metaByCol[col] = refName;
    if (!seenMeta.has(refName.toLowerCase())) {
      seenMeta.add(refName.toLowerCase());
      metadataColumns.push(refName);
    }
  });
  const compositeColumns: CompositeColumn[] = Array.from(compositeGroups.values()).map((g) => ({
    prefix: g.prefix,
    subfields: g.subfields,
  }));

  const firstFixedKey = OBJEKTMALL_FIXED_COLUMNS[0].key;
  const firstDesc = (OBJEKTMALL_FIXED_COLUMNS[0].description ?? "").trim();
  const rows: FlatRow[] = [];
  let dataRowNo = 0;
  for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const data: Record<string, string> = {};
    const metadata: Record<string, string> = {};
    const composite: Record<string, Record<string, string>> = {};
    let anyValue = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const val = cellToStr(cell.value);
      const fixedKey = fixedByCol[col];
      if (fixedKey) {
        if (val) anyValue = true;
        data[fixedKey] = val;
        return;
      }
      const comp = compositeByCol[col];
      if (comp) {
        if (val) {
          anyValue = true;
          const groupKey = comp.prefix.toLowerCase();
          (composite[groupKey] ??= {})[comp.subfield] = val;
        }
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
    rows.push({ rowNumber: dataRowNo, data, metadata, composite });
  }

  return { rows, metadataColumns, compositeColumns };
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
//   nameTranslation → språkmärkt namnkolumn (namn_sv …); skrivs till
//                objects.nameTranslations, aldrig kolumn E eller som EAV-värde.
type MetaColumnResolution =
  | { kind: "known" }
  | { kind: "definition"; katalog: MetadataKatalog }
  | { kind: "nameTranslation"; lang: string }
  | { kind: "unknown" };

// Task #632: per-rad-status för ett dynamiskt metadatavärde i förhandsvisningen.
type MetadataChange = {
  refName: string;
  label: string; // katalog.namn
  beteckning: string | null;
  value: string; // rådata-värdet
  status: ImportMetadataWriteStatus; // create | replace | add | unchanged
  allowDuplicates: boolean;
  // Feature 3 (Bekräfta överskrivning): tidigare visningsvärde när status ===
  // "replace" (värdet som kommer att skrivas över). null i övriga fall.
  fromValue: string | null;
};

// Task #633: per-rad-status för ett sammansatt metadatavärde i förhandsvisningen.
// Underfälten visas grupperade under huvudfältet (prefixet).
type CompositeChange = {
  prefix: string; // referensnamn-prefixet, t.ex. "adress"
  label: string; // katalog.namn
  beteckning: string | null;
  subfields: Array<{ key: string; value: string }>; // ifyllda underfält i kolumnordning
  status: ImportMetadataWriteStatus; // create | replace | add | unchanged
  allowDuplicates: boolean;
  // Feature 3 (Bekräfta överskrivning): tidigare visningsvärde när status ===
  // "replace" (värdet som kommer att skrivas över). null i övriga fall.
  fromValue: string | null;
};

// Per-rad upplöst åtgärd som commit-steget återanvänder utan att räkna om.
type RowResolution = {
  action: "create" | "update" | "repoint";
  targetObjectId: string | null; // för update/repoint
  matchKey: RowMatchKey | null; // Task #643: hur target matchades (null = create)
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
  nameTranslations: Record<string, string>; // Task #634: lang → namn (objects.nameTranslations)
  // Task #633: sammansatta värden (prefix -> { underfält -> värde }) + per-värde-status.
  composite: Record<string, Record<string, string>>;
  compositeChanges: CompositeChange[];
};

type ValRow = {
  rowNumber: number;
  data: Record<string, string>;
  metadata: Record<string, string>;
  composite: Record<string, Record<string, string>>; // Task #633
  errors: string[];
  // Mellanlagring under upplösning.
  target?: ExistingObject;
  matchKey?: RowMatchKey; // Task #643: hur target matchades (för förhandsvisning)
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
  nameTranslations: Record<string, string> | null; // Task #634
};

// Rå objektrad så som den selekteras från DB inför matchning.
type ExistingObjectRow = {
  id: string;
  objectNumber: string | null;
  name: string | null;
  parentId: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  notes: string | null;
  containerCount: number | null;
  nameTranslations: unknown;
};

function toExistingObject(e: ExistingObjectRow): ExistingObject {
  return {
    id: e.id,
    objectNumber: e.objectNumber ?? null,
    name: e.name ?? "",
    parentId: e.parentId ?? null,
    address: e.address ?? null,
    city: e.city ?? null,
    postalCode: e.postalCode ?? null,
    notes: e.notes ?? null,
    containerCount: e.containerCount ?? null,
    nameTranslations: (e.nameTranslations as Record<string, string> | null) ?? null,
  };
}

// Task #643: hur en uppdaterad/repekad rad matchades mot sitt befintliga objekt.
//   systemNumber → kolumn A (Traivos systemnummer, objectNumber)
//   name         → fallback på unikt objektnamn när systemnummer ej fanns
//   externalId   → kundens butiksnummer/externt ID i en metadata-kolumn
//   interim      → re-import av tidigare interim-skapat objekt (MALL-<interim>)
type RowMatchKey = "systemNumber" | "name" | "externalId" | "interim";

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
    matchKey: RowMatchKey | null; // Task #643
    name: string;
    level: ObjLevel;
    levelLabel: string;
    detail: string;
    changed: boolean;
    changedFields: ChangedField[];
    metadata: Record<string, string>;
    metadataChanges: MetadataChange[];
    compositeChanges: CompositeChange[]; // Task #633
  }>;
}

// Feature 3 (Bekräfta överskrivning): en post per metadatavärde som kommer att
// SKRIVAS ÖVER (status "replace") vid skarp import.
interface OverwriteItem {
  row: number; // radnummer i mallen
  refName: string; // metadata-kolumnens referensnamn (sammansatt: "prefix.*")
  label: string; // katalog.namn
  from: string; // tidigare visningsvärde (skrivs över)
  to: string; // nytt värde
}
// Sammanställning av alla överskrivningar + en deterministisk signatur. Commit
// avvisar en bekräftelse vars signatur inte matchar den om-validerade (DB hann
// ändras mellan torrkörning och skarp import → inaktuell bekräftelse).
interface OverwriteSummary {
  count: number;
  signature: string;
  items: OverwriteItem[];
}

interface ValidationReport {
  import: ImportSheetReport;
  metadataColumns: string[];
  compositeColumns: CompositeColumn[]; // Task #633
  warnings: string[];
  hasBlockingErrors: boolean;
  interimListFlag: boolean;
  // Feature 3: alla metadatavärden som skrivs över vid skarp import.
  overwriteSummary: OverwriteSummary;
}

// Deterministisk signatur över överskrivningarna (sorterad på rad + referens).
// Tom lista ⇒ tom signatur. Måste beräknas identiskt i torrkörning och commit.
function buildOverwriteSummary(items: OverwriteItem[]): OverwriteSummary {
  const sorted = [...items].sort(
    (a, b) => a.row - b.row || a.refName.localeCompare(b.refName),
  );
  const signature =
    sorted.length === 0
      ? ""
      : createHash("sha256")
          .update(sorted.map((i) => `${i.row}|${i.refName}|${i.from}|${i.to}`).join("\n"))
          .digest("hex");
  return { count: sorted.length, signature, items: sorted };
}

function parseBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "ja" || s === "yes" || s === "true" || s === "1" || s === "x";
}

// Task #633: bygg ett strukturerat objekt av ett sammansatt fälts underfält.
// Tomma underfält utelämnas; nyckelordningen följer kolumnordningen (insättning).
function buildCompositeObject(subvals: Record<string, string>): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [k, v] of Object.entries(subvals ?? {})) {
    const val = (v ?? "").trim();
    if (val) obj[k] = val;
  }
  return obj;
}

// Task #633: sammansatta fält lagras ALLTID strukturerat i `varde_json`. Vi tvingar
// därför JSON-datatyp (och nollar allowedValues) oavsett definitionens deklarerade
// datatyp, så att den befintliga skriv-/coerce-vägen lägger värdet i varde_json.
function asJsonKatalog(kat: MetadataKatalog): MetadataKatalog {
  return { ...kat, datatyp: "json", allowedValues: null } as MetadataKatalog;
}

async function validateAll(
  flatRows: FlatRow[],
  metadataColumns: string[],
  tenantId: string,
  warnings: string[],
  interimListFlag: boolean = false,
  compositeColumns: CompositeColumn[] = [],
): Promise<{
  report: ValidationReport;
  rows: ValRow[];
  metaResolution: Map<string, MetaColumnResolution>;
  // Task #633: prefix (gemener) -> upplöst sammansatt-definition.
  compositeResolution: Map<string, MetaColumnResolution>;
}> {
  const trim = (data: Record<string, string>, key: string) => (data[key] ?? "").trim();

  const valRows: ValRow[] = flatRows.map((r) => ({
    rowNumber: r.rowNumber,
    data: r.data,
    metadata: r.metadata,
    composite: r.composite,
    errors: [],
  }));

  // Task #632: lös upp varje dynamisk metadata-kolumn (referensnamn på rad 1)
  // mot en metadata_katalog-definition (match på namn ELLER beteckning, case-
  // insensitivt). Kända objektfält (adress m.fl.) skrivs via objekt-skrivningen
  // och klassas som "known". Okända referensnamn varnas och hoppas över.
  const metaResolution = new Map<string, MetaColumnResolution>();
  // Task #633: prefix (gemener) -> upplöst sammansatt-definition. Sammansatta
  // kolumner ("adress.gata") går ALLTID via metadata-skrivvägen — aldrig som
  // kända objektfält — och lagras strukturerat (JSON).
  const compositeResolution = new Map<string, MetaColumnResolution>();
  {
    const katalogDefs = metadataColumns.length || compositeColumns.length
      ? await db.select().from(metadataKatalog).where(eq(metadataKatalog.tenantId, tenantId))
      : [];
    const katByNamn = new Map<string, MetadataKatalog>();
    const katByBeteckning = new Map<string, MetadataKatalog>();
    const katByDisplayNumber = new Map<string, MetadataKatalog>();
    for (const k of katalogDefs) {
      katByNamn.set(k.namn.trim().toLowerCase(), k);
      if (k.beteckning) katByBeteckning.set(k.beteckning.trim().toLowerCase(), k);
      if (k.displayNumber !== null && k.displayNumber !== undefined) {
        katByDisplayNumber.set(String(k.displayNumber), k);
      }
    }
    for (const refName of metadataColumns) {
      // Task #634: språkmärkt namnkolumn (namn_sv …) — skrivs till objects.nameTranslations.
      const lang = parseLanguageNameRef(refName);
      if (lang) {
        metaResolution.set(refName, { kind: "nameTranslation", lang });
        continue;
      }
      // Kända objektfält (adress m.fl.) — även i hybridform "22:Gatuadress".
      if (isKnownObjectFieldRef(refName)) {
        metaResolution.set(refName, { kind: "known" });
        continue;
      }
      // Task #634: klartext / generisk kod / hybrid → metadata-definition.
      // Koden matchas mot beteckning ELLER visningsnummer; namnet mot namn/beteckning
      // (och, utan kod, även visningsnummer). Koden vinner om båda matchar.
      const parsed = parseMetadataRef(refName);
      const codeMatch = parsed.code
        ? (katByBeteckning.get(parsed.code.toLowerCase()) ?? katByDisplayNumber.get(parsed.code))
        : undefined;
      const nameMatch =
        katByNamn.get(parsed.name.toLowerCase()) ??
        katByBeteckning.get(parsed.name.toLowerCase()) ??
        (parsed.code ? undefined : katByDisplayNumber.get(parsed.name));
      const kat = codeMatch ?? nameMatch;
      if (kat) {
        metaResolution.set(refName, { kind: "definition", katalog: kat });
        if (codeMatch && nameMatch && codeMatch.id !== nameMatch.id) {
          warnings.push(
            `Metadata-kolumnen "${refName}": koden "${parsed.code}" och namnet "${parsed.name}" pekar på olika definitioner — använder koden (${codeMatch.namn}).`,
          );
        }
        continue;
      }
      // Ingen matchning — skilj okänd kod från okänt namn i varningen.
      metaResolution.set(refName, { kind: "unknown" });
      const looksLikeCode = parsed.code !== null || /^\d+$/.test(parsed.name);
      if (looksLikeCode) {
        const codeToken = parsed.code ?? parsed.name;
        warnings.push(
          `Metadata-kolumnen "${refName}": koden "${codeToken}" matchar ingen metadata-definition (varken beteckning eller visningsnummer) — dess värden hoppas över. Kontrollera koden eller skapa en definition i metadata-katalogen.`,
        );
      } else {
        warnings.push(
          `Metadata-kolumnen "${refName}" matchar ingen metadata-definition (varken namn eller beteckning) — dess värden hoppas över. Skapa en definition i metadata-katalogen för att importera värdena.`,
        );
      }
    }
    // Lös upp sammansatta prefix (t.ex. "adress" från "adress.gata"/"adress.ort").
    for (const comp of compositeColumns) {
      const lower = comp.prefix.trim().toLowerCase();
      const kat = katByNamn.get(lower) ?? katByBeteckning.get(lower);
      const subList = comp.subfields.map((s) => `${comp.prefix}.${s}`).join(", ");
      if (kat) {
        compositeResolution.set(lower, { kind: "definition", katalog: kat });
      } else {
        compositeResolution.set(lower, { kind: "unknown" });
        warnings.push(
          `Det sammansatta fältet "${comp.prefix}" (kolumnerna ${subList}) matchar ingen metadata-definition (varken namn eller beteckning) — dess värden hoppas över. Skapa en definition i metadata-katalogen för att importera värdena.`,
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

  // 2. Förladda befintliga objekt för matchning (systemnummer + namn).
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

  const EXISTING_OBJECT_SELECT = {
    id: objects.id,
    objectNumber: objects.objectNumber,
    name: objects.name,
    parentId: objects.parentId,
    address: objects.address,
    city: objects.city,
    postalCode: objects.postalCode,
    notes: objects.notes,
    containerCount: objects.containerCount,
    nameTranslations: objects.nameTranslations,
  } as const;

  const byObjNum = new Map<string, ExistingObject>();
  const byNameLower = new Map<string, ExistingObject[]>();
  const byId = new Map<string, ExistingObject>(); // Task #643: id → objekt (externt-ID-matchning)
  const indexExisting = (obj: ExistingObject) => {
    byId.set(obj.id, obj);
    if (obj.objectNumber) byObjNum.set(obj.objectNumber, obj);
    const nl = obj.name.toLowerCase();
    if (nl) {
      const arr = byNameLower.get(nl) ?? [];
      arr.push(obj);
      byNameLower.set(nl, arr);
    }
  };
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
      .select(EXISTING_OBJECT_SELECT)
      .from(objects)
      .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt), cond));
    for (const e of existing) indexExisting(toExistingObject(e));
  }

  // 2b. Task #643: externt-ID-matchning. Rader utan system-/interimsnummer kan
  // matchas mot ett befintligt objekt via kundens egna butiksnummer/externt ID
  // (lagrat som metadata-värde). Förladda befintliga objekts externt-ID-värden →
  // objekt-id, så att klassificeringen i steg 3 kan slå upp rätt mål (unik match
  // krävs; flera träffar = tvetydigt och blockerar raden).
  const externalIdRefNames: string[] = [];
  const externalIdKatalogIds = new Set<string>();
  if (!interimListFlag) {
    for (const refName of metadataColumns) {
      if (!isExternalIdRef(refName)) continue;
      externalIdRefNames.push(refName);
      const resn = metaResolution.get(refName);
      if (resn?.kind === "definition") externalIdKatalogIds.add(resn.katalog.id);
    }
  }
  const extIdToObjectIds = new Map<string, string[]>(); // normaliserat värde → objekt-id:n
  if (externalIdRefNames.length > 0 && externalIdKatalogIds.size > 0) {
    const wanted = new Set<string>();
    for (const row of valRows) {
      if (row.errors.length) continue;
      if (trim(row.data, "systemNumber") || trim(row.data, "interim")) continue;
      for (const refName of externalIdRefNames) {
        const v = (row.metadata[refName] ?? "").trim();
        if (v) {
          wanted.add(v.toLowerCase());
          break;
        }
      }
    }
    if (wanted.size > 0) {
      const evRows = await db
        .select()
        .from(metadataVarden)
        .where(
          and(
            eq(metadataVarden.tenantId, tenantId),
            inArray(metadataVarden.metadataKatalogId, Array.from(externalIdKatalogIds)),
          ),
        );
      const matchedIds = new Set<string>();
      const tmp = new Map<string, Set<string>>();
      for (const ev of evRows) {
        if (!ev.objektId) continue;
        const dv = getDisplayValue(ev);
        if (dv === null) continue;
        const norm = dv.trim().toLowerCase();
        if (!wanted.has(norm)) continue;
        let s = tmp.get(norm);
        if (!s) {
          s = new Set<string>();
          tmp.set(norm, s);
        }
        s.add(ev.objektId);
        matchedIds.add(ev.objektId);
      }
      // Ladda objekt-detaljer för matchade id:n som inte redan finns i byId.
      const missing = Array.from(matchedIds).filter((id) => !byId.has(id));
      if (missing.length > 0) {
        const extra = await db
          .select(EXISTING_OBJECT_SELECT)
          .from(objects)
          .where(
            and(eq(objects.tenantId, tenantId), inArray(objects.id, missing), isNull(objects.deletedAt)),
          );
        for (const e of extra) indexExisting(toExistingObject(e));
      }
      // Endast objekt som fortfarande finns (ej soft-deletade) räknas som träff.
      for (const [norm, set] of Array.from(tmp.entries())) {
        const ids = Array.from(set).filter((id) => byId.has(id));
        if (ids.length > 0) extIdToObjectIds.set(norm, ids);
      }
    }
  }

  // Slå upp en rads externt-ID-värde (första ifyllda externt-ID-kolumnen) och
  // de objekt-id:n det matchar. Tomt värde → null.
  const resolveExternalIdMatch = (
    row: ValRow,
  ): { value: string; objectIds: string[] } | null => {
    if (interimListFlag || externalIdRefNames.length === 0) return null;
    for (const refName of externalIdRefNames) {
      const v = (row.metadata[refName] ?? "").trim();
      if (v) return { value: v, objectIds: extIdToObjectIds.get(v.toLowerCase()) ?? [] };
    }
    return null;
  };

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

    if (!name) {
      row.errors.push('Saknat värde: "Objektnamn"');
      continue;
    }

    let target: ExistingObject | undefined;
    let matchKey: RowMatchKey | undefined;
    if (sysNo) {
      target = byObjNum.get(sysNo);
      if (target) {
        matchKey = "systemNumber";
      } else {
        const matches = byNameLower.get(name.toLowerCase()) ?? [];
        if (matches.length === 1) {
          target = matches[0];
          matchKey = "name";
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
    } else if (interimNo) {
      // Endast interim → re-import uppdaterar om MALL-<interim> redan finns.
      target = byObjNum.get(OBJEKTMALL_INTERIM_PREFIX + interimNo);
      if (target) matchKey = "interim";
    } else {
      // Task #643: varken systemnummer eller interimsnummer — försök matcha mot
      // ett befintligt objekt via kundens externt ID (butiksnummer m.fl.).
      const ext = resolveExternalIdMatch(row);
      if (!ext) {
        row.errors.push(
          interimListFlag
            ? "Interimsnummer krävs i interimslist-läge (ren nyimport)."
            : "Raden saknar Systemnummer, Interimsnummer och Externt ID. Ange Interimsnummer för nytt objekt, Systemnummer för uppdatering, eller fyll i en externt-ID-kolumn (t.ex. Butiksnummer) för att matcha via metadata.",
        );
        continue;
      }
      if (ext.objectIds.length === 0) {
        row.errors.push(
          `Externt ID "${ext.value}" matchade inget befintligt objekt. Kontrollera värdet eller ange Systemnummer.`,
        );
        continue;
      }
      if (ext.objectIds.length > 1) {
        row.errors.push(
          `Externt ID "${ext.value}" matchar flera befintliga objekt. Ange ett exakt Systemnummer för att peka ut rätt objekt.`,
        );
        continue;
      }
      target = byId.get(ext.objectIds[0]);
      matchKey = "externalId";
    }
    row.target = target;
    row.matchKey = matchKey;
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
        [...Array.from(metaResolution.values()), ...Array.from(compositeResolution.values())]
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
    // Task #634: samla språkmärkta visningsnamn (namn_sv …) → objects.nameTranslations.
    // Påverkar aldrig kolumn E (interna namnet) eller släktnamns-genereringen.
    const nameTranslations: Record<string, string> = {};
    for (const [refName, rawVal] of Object.entries(row.metadata)) {
      const resn = metaResolution.get(refName);
      if (!resn || resn.kind !== "nameTranslation") continue;
      const v = (rawVal ?? "").trim();
      if (v) nameTranslations[resn.lang] = v;
    }

    const changedFields: ChangedField[] = [];
    if (target && (action === "update" || action === "repoint")) {
      if (name && name !== (target.name ?? "")) {
        changedFields.push({ field: "name", label: "Namn", from: target.name ?? "", to: name });
      }
      for (const [lang, v] of Object.entries(nameTranslations)) {
        const cur = target.nameTranslations?.[lang] ?? "";
        if (v !== cur) {
          changedFields.push({ field: `nameTranslation:${lang}`, label: `Namn (${lang})`, from: cur, to: v });
        }
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
        fromValue: status === "replace" ? existingForObj[0] ?? null : null,
      });
    }
    // Task #633: validera och statusbedöm sammansatta fält (punktnotation). Varje
    // grupp byggs till ett strukturerat JSON-värde och skrivs via samma väg som
    // vanliga definitions-kolumner men tvingad till JSON-lagring (varde_json).
    const compositeChanges: CompositeChange[] = [];
    for (const [prefix, subvals] of Object.entries(row.composite ?? {})) {
      const obj = buildCompositeObject(subvals);
      const subfields = Object.entries(obj).map(([key, value]) => ({ key, value }));
      if (subfields.length === 0) continue; // inga ifyllda underfält
      const resn = compositeResolution.get(prefix);
      if (!resn || resn.kind !== "definition") continue; // okänt prefix hanteras via varning
      const kat = asJsonKatalog(resn.katalog);
      let displayValue: string;
      try {
        displayValue = coerceMetadataVardeFromRaw(kat, JSON.stringify(obj)).displayValue;
      } catch (e) {
        row.errors.push(
          `Ogiltigt sammansatt värde i fältet "${resn.katalog.namn}" (${prefix}.*): ${(e as Error).message}`,
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
      compositeChanges.push({
        prefix,
        label: resn.katalog.namn,
        beteckning: resn.katalog.beteckning ?? null,
        subfields,
        status,
        allowDuplicates: kat.allowDuplicates ?? false,
        fromValue: status === "replace" ? existingForObj[0] ?? null : null,
      });
    }
    // Ogiltiga metadata-värden ska blockera raden från commit.
    if (row.errors.length) continue;

    const changed =
      action === "create" ||
      action === "repoint" ||
      changedFields.length > 0 ||
      metadataChanges.some((m) => m.status !== "unchanged") ||
      compositeChanges.some((m) => m.status !== "unchanged");

    row.res = {
      action,
      targetObjectId: target?.id ?? null,
      matchKey: action === "create" ? null : row.matchKey ?? null,
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
      nameTranslations,
      composite: row.composite,
      compositeChanges,
    };
  }

  // 7. Bygg rapport.
  const errors: Array<{ row: number; messages: string[] }> = [];
  const actions: ImportSheetReport["actions"] = [];
  // Feature 3: samla ALLA överskrivningar (även för rader bortom 500-taket på
  // `actions`) så att räkningen och signaturen är fullständiga.
  const overwriteItems: OverwriteItem[] = [];
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

    for (const mc of res.metadataChanges) {
      if (mc.status === "replace") {
        overwriteItems.push({
          row: row.rowNumber,
          refName: mc.refName,
          label: mc.label,
          from: mc.fromValue ?? "",
          to: mc.value,
        });
      }
    }
    for (const cc of res.compositeChanges) {
      if (cc.status === "replace") {
        overwriteItems.push({
          row: row.rowNumber,
          refName: `${cc.prefix}.*`,
          label: cc.label,
          from: cc.fromValue ?? "",
          to: cc.subfields.map((s) => `${s.key}=${s.value}`).join("; "),
        });
      }
    }

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
        matchKey: res.matchKey,
        name: res.name,
        level: res.level,
        levelLabel: LEVEL_META[res.level].label,
        detail,
        changed: res.changed,
        changedFields: res.changedFields,
        metadata: res.metadata,
        metadataChanges: res.metadataChanges,
        compositeChanges: res.compositeChanges,
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
    compositeColumns,
    warnings,
    hasBlockingErrors: errorRows > 0,
    interimListFlag,
    overwriteSummary: buildOverwriteSummary(overwriteItems),
  };

  return { report, rows: valRows, metaResolution, compositeResolution };
}

// ============================================================
// Commit
// ============================================================

// Feature 3 (Bekräfta överskrivning): kastas inifrån commit-transaktionen om ett
// metadatavärde som ska skrivas över inte längre matchar det användaren bekräftade
// (DB ändrades mellan torrkörning och skarp import). Aborterar hela importen och
// översätts till 409 staleConfirmation i route-lagret.
class OverwriteStaleError extends Error {
  constructor() {
    super(
      "Underlaget har ändrats sedan torrkörningen. Kör en ny torrkörning och bekräfta överskrivningen igen.",
    );
    this.name = "OverwriteStaleError";
  }
}

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
  const compositeResolution = validation.compositeResolution;
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
    // Feature 3: TOCTOU-skydd. Läs om nuvarande visningsvärden för (objekt,
    // katalog) INNE i transaktionen med radlås (FOR UPDATE), och verifiera att
    // värdet som ska skrivas över fortfarande matchar det användaren bekräftade
    // i torrkörningen. Om någon hunnit ändra värdet sedan dess avbryts hela
    // importen (rullas tillbaka) och route-lagret svarar 409 staleConfirmation.
    async function assertOverwriteStillConfirmed(
      objId: string,
      katId: string,
      confirmedFrom: string | null,
    ): Promise<void> {
      const rows = await tx
        .select()
        .from(metadataVarden)
        .where(
          and(
            eq(metadataVarden.tenantId, tenantId),
            eq(metadataVarden.objektId, objId),
            eq(metadataVarden.metadataKatalogId, katId),
          ),
        )
        .for("update");
      const current: string[] = [];
      for (const ev of rows) {
        const dv = getDisplayValue(ev);
        if (dv !== null) current.push(dv);
      }
      // "replace" har enkelvärdes-semantik (allowDuplicates=false). Bekräftelsen
      // gäller exakt ett befintligt värde; allt annat = underlaget har ändrats.
      if (current.length !== 1 || current[0] !== confirmedFrom) {
        throw new OverwriteStaleError();
      }
    }

    async function writeRowMetadata(objId: string, res: RowResolution): Promise<void> {
      for (const [refName, rawVal] of Object.entries(res.metadata)) {
        const value = (rawVal ?? "").trim();
        if (!value) continue;
        const resn = metaResolution.get(refName);
        if (!resn || resn.kind !== "definition") continue; // known/unknown skrivs ej här
        const change = res.metadataChanges.find((c) => c.refName === refName);
        if (change?.status === "replace") {
          await assertOverwriteStillConfirmed(objId, resn.katalog.id, change.fromValue);
        }
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
      // Task #633: skriv sammansatta fält (punktnotation) som strukturerad JSON
      // via samma post-it-modell, men tvinga JSON-lagring (varde_json).
      for (const [prefix, subvals] of Object.entries(res.composite ?? {})) {
        const obj = buildCompositeObject(subvals);
        if (Object.keys(obj).length === 0) continue; // inga ifyllda underfält
        const resn = compositeResolution.get(prefix);
        if (!resn || resn.kind !== "definition") continue; // okänt prefix skrivs ej här
        const change = res.compositeChanges.find((c) => c.prefix === prefix);
        if (change?.status === "replace") {
          await assertOverwriteStillConfirmed(objId, resn.katalog.id, change.fromValue);
        }
        const status = await writeImportedMetadataValue(tx, {
          tenantId,
          objektId: objId,
          katalog: asJsonKatalog(resn.katalog),
          rawValue: JSON.stringify(obj),
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
            // Task #634: språkmärkta visningsnamn (om angivna) — aldrig kolumn E.
            ...(Object.keys(res.nameTranslations).length ? { nameTranslations: res.nameTranslations } : {}),
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
        // Task #634: merge språkmärkta visningsnamn — endast angivna språk skrivs över,
        // övriga befintliga bevaras (partiell uppdatering).
        if (Object.keys(res.nameTranslations).length) {
          set.nameTranslations = { ...(row.target?.nameTranslations ?? {}), ...res.nameTranslations };
        }
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

      const { rows, metadataColumns, compositeColumns, warnings, interimListFlag } = await parseWorkbook(file.buffer);
      const validation = await validateAll(rows, metadataColumns, tenantId, warnings, interimListFlag, compositeColumns);
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

      const { rows, metadataColumns, compositeColumns, warnings, interimListFlag } = await parseWorkbook(file.buffer);
      const validation = await validateAll(rows, metadataColumns, tenantId, warnings, interimListFlag, compositeColumns);
      if (validation.report.hasBlockingErrors) {
        return res.status(400).json({
          ok: false,
          fileName: file.originalname,
          report: validation.report,
          message: "Valideringsfel — fixa fel och försök igen.",
        });
      }

      // Feature 3 (Bekräfta överskrivning): blockera skarp import som skriver över
      // befintliga metadatavärden tills användaren uttryckligen bekräftat. Commit
      // om-validerar mot aktuell DB; en bekräftelse vars signatur inte matchar den
      // nyberäknade (DB hann ändras sedan torrkörningen) avvisas som inaktuell.
      const overwrite = validation.report.overwriteSummary;
      if (overwrite.count > 0) {
        const confirmOverwrites =
          parseBool(String((req.body as any)?.confirmMetadataOverwrites ?? ""));
        const confirmedSignature = String((req.body as any)?.confirmedOverwriteSignature ?? "");
        if (!confirmOverwrites) {
          return res.status(409).json({
            ok: false,
            needsOverwriteConfirmation: true,
            fileName: file.originalname,
            overwriteSummary: overwrite,
            report: validation.report,
            message: `${overwrite.count} befintliga metadatavärden kommer att skrivas över. Bekräfta överskrivningen innan importen körs.`,
          });
        }
        if (confirmedSignature !== overwrite.signature) {
          return res.status(409).json({
            ok: false,
            needsOverwriteConfirmation: true,
            staleConfirmation: true,
            fileName: file.originalname,
            overwriteSummary: overwrite,
            report: validation.report,
            message:
              "Underlaget har ändrats sedan torrkörningen. Kör en ny torrkörning och bekräfta överskrivningen igen.",
          });
        }
      }

      let result: Awaited<ReturnType<typeof commitImport>>;
      try {
        result = await commitImport(tenantId, userId, file.originalname, validation);
      } catch (e) {
        // Feature 3: TOCTOU-skydd inifrån transaktionen — värdet ändrades mellan
        // torrkörning och skriv. Hela importen rullades tillbaka; be om ny torrkörning.
        if (e instanceof OverwriteStaleError) {
          return res.status(409).json({
            ok: false,
            needsOverwriteConfirmation: true,
            staleConfirmation: true,
            fileName: file.originalname,
            overwriteSummary: overwrite,
            report: validation.report,
            message: e.message,
          });
        }
        throw e;
      }
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

  // === Namngivna importmallar (Task #664) ===================================
  const templateBodySchema = z.object({
    name: z
      .string()
      .trim()
      .min(1, "Namn krävs.")
      .max(120, "Namnet får vara högst 120 tecken."),
    description: z.string().trim().max(2000).optional().nullable(),
    fieldIds: z.array(z.string()).default([]),
  });

  function templateExcelFilename(name: string): string {
    const slug =
      name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "mall";
    return `traivo-importmall-${slug}.xlsx`;
  }

  async function buildTemplateExcel(tenantId: string, fieldIds: string[]): Promise<Buffer> {
    const headers = await resolveTemplateFieldHeaders(tenantId, fieldIds);
    return buildObjektmallWorkbook(headers.map((h) => h.header));
  }

  // Lista sparade mallar (tenant-scopad).
  app.get(
    "/api/import-templates",
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const rows = await db
        .select()
        .from(importTemplates)
        .where(eq(importTemplates.tenantId, tenantId))
        .orderBy(desc(importTemplates.updatedAt));
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.json(rows);
    }),
  );

  // Skapa ny mall.
  app.post(
    "/api/import-templates",
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const userId = (req as any).user?.claims?.sub ?? (req as any).user?.id ?? null;
      const body = templateBodySchema.parse(req.body);
      const [clash] = await db
        .select({ id: importTemplates.id })
        .from(importTemplates)
        .where(and(eq(importTemplates.tenantId, tenantId), eq(importTemplates.name, body.name)));
      if (clash) throw new ConflictError(`En mall med namnet "${body.name}" finns redan.`);
      const [row] = await db
        .insert(importTemplates)
        .values({
          tenantId,
          name: body.name,
          description: body.description ?? null,
          fieldIds: body.fieldIds,
          createdBy: userId,
        })
        .returning();
      res.status(201).json(row);
    }),
  );

  // Uppdatera mall.
  app.put(
    "/api/import-templates/:id",
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const body = templateBodySchema.parse(req.body);
      const [existing] = await db
        .select({ id: importTemplates.id })
        .from(importTemplates)
        .where(and(eq(importTemplates.tenantId, tenantId), eq(importTemplates.id, req.params.id)));
      if (!existing) throw new NotFoundError("Importmall");
      const [clash] = await db
        .select({ id: importTemplates.id })
        .from(importTemplates)
        .where(
          and(
            eq(importTemplates.tenantId, tenantId),
            eq(importTemplates.name, body.name),
            sql`${importTemplates.id} <> ${req.params.id}`,
          ),
        );
      if (clash) throw new ConflictError(`En mall med namnet "${body.name}" finns redan.`);
      const [row] = await db
        .update(importTemplates)
        .set({
          name: body.name,
          description: body.description ?? null,
          fieldIds: body.fieldIds,
          updatedAt: new Date(),
        })
        .where(and(eq(importTemplates.tenantId, tenantId), eq(importTemplates.id, req.params.id)))
        .returning();
      res.json(row);
    }),
  );

  // Radera mall.
  app.delete(
    "/api/import-templates/:id",
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const result = await db
        .delete(importTemplates)
        .where(and(eq(importTemplates.tenantId, tenantId), eq(importTemplates.id, req.params.id)))
        .returning({ id: importTemplates.id });
      if (result.length === 0) throw new NotFoundError("Importmall");
      res.json({ ok: true });
    }),
  );

  // Generera & ladda ner Excel för en sparad mall.
  app.get(
    "/api/import-templates/:id/excel",
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const [row] = await db
        .select()
        .from(importTemplates)
        .where(and(eq(importTemplates.tenantId, tenantId), eq(importTemplates.id, req.params.id)));
      if (!row) throw new NotFoundError("Importmall");
      const buf = await buildTemplateExcel(tenantId, row.fieldIds ?? []);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${templateExcelFilename(row.name)}"`,
      );
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.send(buf);
    }),
  );

  // Ad-hoc generering från en fält-lista (utan att spara mallen).
  app.post(
    "/api/import-templates/excel",
    requireTenantWithFallback,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const body = z
        .object({
          name: z.string().trim().max(120).optional(),
          fieldIds: z.array(z.string()).default([]),
        })
        .parse(req.body);
      const buf = await buildTemplateExcel(tenantId, body.fieldIds);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${templateExcelFilename(body.name ?? "forhandsvisning")}"`,
      );
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.send(buf);
    }),
  );
}
