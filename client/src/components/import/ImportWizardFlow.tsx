// Task #578: Tre-stegs import-wizard (Organisation → Butiker → Fysiska objekt).
// Guidat onboarding-flöde där interimnummer kopplar stegen.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Eye, FileUp, ListOrdered, Lock, RefreshCw, Upload, X } from "lucide-react";
import Papa from "papaparse";
import { ImportRowPreview } from "@/components/import/ImportRowPreview";
import { DownloadTemplateButton } from "@/components/DownloadTemplateButton";
import { IMPORT_TEMPLATES, type ImportTemplateKey } from "@shared/import-templates";

type StepNum = 1 | 2 | 3;

interface SessionDTO {
  id: string;
  tenantId: string;
  customerId?: string | null;
  status: "in_progress" | "completed" | "abandoned";
  stepCompleted: number;
  interimMap: Record<string, { objectId: string; step: number; name: string }>;
  createdCounts: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

interface PreviewItem {
  index: number;
  name: string;
  interim: string | null;
  resolvedParentName?: string | null;
  inheritedAddress?: boolean;
}

interface PreviewResponse {
  dryRun: true;
  step: StepNum;
  valid: number;
  invalid: number;
  duplicates: number;
  errors: Array<{ index: number; message: string }>;
  preview: PreviewItem[];
}

interface CommitResponse {
  ok: boolean;
  step: StepNum;
  created: number;
  ids: string[];
  batchId: string;
  failures: Array<{ index: number; message: string }>;
  metadataWarnings?: string[];
  session: SessionDTO;
}

interface MetaType {
  namn: string;
  beteckning: string | null;
  beskrivning: string | null;
}

interface StepField {
  name: string;
  label: string;
  required: boolean;
}

interface ParsedTable {
  columns: string[];
  rows: Array<Record<string, string>>;
}

// Mappnings-mål per källkolumn: "field:<canonical>", "meta:<katalog.namn>" eller "ignore".
const IGNORE = "ignore";

// Svenska etiketter för wizardens systemfält (canonical-namn → UI-text).
const FIELD_LABELS: Record<string, string> = {
  interim: "Interim-ID",
  name: "Namn",
  parentInterim: "Förälder (interim-ID)",
  objectNumber: "Objektnummer",
  hierarchyLevel: "Hierarkinivå",
  address: "Adress",
  city: "Ort",
  postalCode: "Postnummer",
};

const STEP_TEMPLATES: Record<StepNum, ImportTemplateKey> = {
  1: "wizard-organisation",
  2: "wizard-stores",
  3: "wizard-equipment",
};

const STEP_LABELS: Record<StepNum, string> = {
  1: "Organisation",
  2: "Butiker",
  3: "Fysiska objekt",
};

const STORAGE_KEY = "traivo-import-wizard-session";

// === Parsning + mappning ====================================================
// Wizardens flexibla mappnings-UI låter användaren peka varje källkolumn mot ett
// systemfält, en befintlig metadatatyp (metadata_katalog.namn) eller "ignorera".
// Backend validerar alltid nycklarna mot katalogen — klienten är bara UX.

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[\s_\-().]/g, "");
}

// Dubbletthuvuden får ett suffix så varje kolumn blir unik (annars skulle två
// likadana rubriker krocka i mapping-state och en av dem tappas tyst).
function disambiguateHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h, i) => {
    const base = (h ?? "").trim() || `Kolumn ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });
}

function rowFromCells(columns: string[], cells: Array<string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  columns.forEach((col, i) => {
    const v = (cells[i] ?? "").toString().trim();
    if (v !== "") out[col] = v;
  });
  return out;
}

function parseMatrixFromText(text: string): string[][] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
  const delim = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
  const parsed = Papa.parse<string[]>(trimmed, {
    header: false,
    skipEmptyLines: true,
    delimiter: delim,
  });
  return (parsed.data || []).filter(r => Array.isArray(r)) as string[][];
}

// Gissar om matrisens första rad är en rubrikrad: sant om någon cell matchar ett
// känt mål (systemfält eller metadatatyp). Används bara som DEFAULT — användaren
// kan alltid tvinga läget via "Första raden är rubrikrad"-växeln i UI:t.
function detectHeader(matrix: string[][], knownTargets: Set<string>): boolean {
  if (matrix.length === 0) return false;
  const firstCells = matrix[0].map(c => (c ?? "").trim());
  return firstCells.some(c => c !== "" && knownTargets.has(normalizeKey(c)));
}

// Bygger {columns, rows} från en matris. När `hasHeader` är sant används rad 0 som
// rubriker; annars positionell fallback till mallens kolumnordning.
function buildTable(
  matrix: string[][],
  templateColumns: string[],
  hasHeader: boolean,
): ParsedTable {
  if (matrix.length === 0) return { columns: [], rows: [] };
  const headerCells = hasHeader ? matrix[0].map(c => (c ?? "").trim()) : templateColumns;
  const columns = disambiguateHeaders(headerCells);
  const dataRows = hasHeader ? matrix.slice(1) : matrix;
  const rows = dataRows
    .map(cells => rowFromCells(columns, cells))
    .filter(r => Object.keys(r).length > 0);
  return { columns, rows };
}

async function parseMatrixFromFile(
  file: File,
): Promise<{ matrix: string[][]; assumeHeader: boolean }> {
  const name = file.name.toLowerCase();
  const isXlsx = name.endsWith(".xlsx") || name.endsWith(".xls");
  if (!isXlsx) {
    // CSV/TXT-filer har i praktiken nästan alltid en rubrikrad → anta header
    // (användaren kan stänga av växeln om filen saknar rubriker).
    const text = await file.text();
    return { matrix: parseMatrixFromText(text), assumeHeader: true };
  }
  const ExcelJS = (await import("exceljs")).default;
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];
  if (!sheet) return { matrix: [], assumeHeader: true };
  const cellToString = (val: unknown): string => {
    if (val == null) return "";
    if (val instanceof Date) return val.toISOString().split("T")[0];
    if (typeof val === "object" && val !== null) {
      if ("richText" in val) {
        return (val as { richText: Array<{ text?: string }> }).richText.map(r => r.text ?? "").join("");
      }
      if ("formula" in val) return String((val as { result?: unknown }).result ?? "");
      if ("hyperlink" in val) return (val as unknown as { text: string }).text;
    }
    return String(val);
  };
  const aoa: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const rowData: string[] = [];
    const colCount = sheet.columnCount || row.cellCount;
    for (let c = 1; c <= colCount; c++) rowData.push(cellToString(row.getCell(c).value));
    aoa.push(rowData);
  });
  // Behåll rubrikraden (idx 0); droppa mallens [EXEMPEL…]-exempelrader.
  const filtered = aoa.filter((r, idx) => idx === 0 || !(r[0] ?? "").startsWith("[EXEMPEL"));
  return { matrix: filtered, assumeHeader: true };
}

// Föreslår ett mål för en kolumn. Ordning: exakt systemfält → "metadata - X"-prefix
// → exakt metadatatyp → partiellt systemfält → ignorera.
function autoMatchTarget(column: string, fields: StepField[], metaTypes: MetaType[]): string {
  const c = normalizeKey(column);
  if (!c) return IGNORE;
  for (const f of fields) {
    if (normalizeKey(f.name) === c || normalizeKey(f.label) === c) return `field:${f.name}`;
  }
  const m = column.match(/^\s*metadata\s*[-:]\s*(.+)$/i);
  if (m) {
    const want = normalizeKey(m[1]);
    const hit = metaTypes.find(
      t => normalizeKey(t.namn) === want || (t.beteckning != null && normalizeKey(t.beteckning) === want),
    );
    if (hit) return `meta:${hit.namn}`;
  }
  for (const t of metaTypes) {
    if (normalizeKey(t.namn) === c || (t.beteckning != null && normalizeKey(t.beteckning) === c)) {
      return `meta:${t.namn}`;
    }
  }
  for (const f of fields) {
    const fn = normalizeKey(f.name);
    if (fn.length >= 4 && (c.includes(fn) || fn.includes(c))) return `field:${f.name}`;
  }
  return IGNORE;
}

// Auto-mappar alla kolumner och säkerställer att två kolumner aldrig pekar på
// samma systemfält (första vinner; resten faller till ignorera).
function autoMapColumns(
  columns: string[],
  fields: StepField[],
  metaTypes: MetaType[],
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedFields = new Set<string>();
  for (const col of columns) {
    let t = autoMatchTarget(col, fields, metaTypes);
    if (t.startsWith("field:")) {
      const f = t.slice("field:".length);
      if (usedFields.has(f)) t = IGNORE;
      else usedFields.add(f);
    }
    mapping[col] = t;
  }
  return mapping;
}

// Omvandlar tolkade rader till backendens kanoniska form {…systemfält, metadata}.
// Tomma celler hoppas; första värdet vinner vid kollision på samma fält.
function applyMapping(
  table: ParsedTable,
  mapping: Record<string, string>,
): Array<Record<string, unknown>> {
  return table.rows
    .map(r => {
      const out: Record<string, unknown> = {};
      const meta: Record<string, string> = {};
      for (const col of table.columns) {
        const target = mapping[col] ?? IGNORE;
        const val = (r[col] ?? "").trim();
        if (!val) continue;
        if (target.startsWith("field:")) {
          const f = target.slice("field:".length);
          if (!(f in out)) out[f] = val;
        } else if (target.startsWith("meta:")) {
          const k = target.slice("meta:".length);
          if (!(k in meta)) meta[k] = val;
        }
      }
      if (Object.keys(meta).length > 0) out.metadata = meta;
      return out;
    })
    .filter(r => Object.keys(r).length > 0);
}

function sampleValue(table: ParsedTable, col: string): string {
  for (const r of table.rows) {
    const v = r[col];
    if (v) return v;
  }
  return "";
}

interface StepEditorProps {
  step: StepNum;
  locked: boolean;
  onCommitDone: (metadataWarnings: string[]) => void;
  sessionId: string;
}

function StepEditor({ step, locked, onCommitDone, sessionId }: StepEditorProps) {
  const { toast } = useToast();
  const tplKey = STEP_TEMPLATES[step];
  const tpl = IMPORT_TEMPLATES[tplKey];
  const templateColumns = useMemo(() => tpl.columns.map(c => c.name), [tpl]);
  const fields = useMemo<StepField[]>(
    () => tpl.columns.map(c => ({ name: c.name, label: FIELD_LABELS[c.name] ?? c.name, required: c.required })),
    [tpl],
  );

  const metaTypesQuery = useQuery<{ types: MetaType[] }>({
    queryKey: ["/api/import/wizard/metadata-types"],
  });
  const metaTypes = metaTypesQuery.data?.types ?? [];

  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [text, setText] = useState("");
  const [fileMatrix, setFileMatrix] = useState<string[][] | null>(null);
  const [fileAssumeHeader, setFileAssumeHeader] = useState(false);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // null = använd auto-detektering; true/false = användaren har tvingat läget.
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);

  // Kända mål för header-detektion: systemfältens namn/etikett + metadatatypernas namn/beteckning.
  const knownTargets = useMemo(() => {
    const s = new Set<string>();
    for (const f of fields) {
      s.add(normalizeKey(f.name));
      s.add(normalizeKey(f.label));
    }
    for (const t of metaTypes) {
      s.add(normalizeKey(t.namn));
      if (t.beteckning) s.add(normalizeKey(t.beteckning));
    }
    return s;
  }, [fields, metaTypes]);

  // Råmatris från källan (paste eller fil). Header-läget avgörs separat så att
  // en användarväxel kan tvinga det oberoende av auto-detekteringen.
  const rawMatrix = useMemo<string[][]>(() => {
    if (mode === "paste") return parseMatrixFromText(text);
    return fileMatrix ?? [];
  }, [mode, text, fileMatrix]);

  // Auto-default: filer antar rubrik (fileAssumeHeader), paste detekteras via kända mål.
  const autoHeader = useMemo(() => {
    if (mode === "file") return fileMatrix ? fileAssumeHeader : false;
    return detectHeader(rawMatrix, knownTargets);
  }, [mode, fileMatrix, fileAssumeHeader, rawMatrix, knownTargets]);

  const hasHeader = headerOverride ?? autoHeader;

  const table = useMemo<ParsedTable>(
    () => buildTable(rawMatrix, templateColumns, hasHeader),
    [rawMatrix, templateColumns, hasHeader],
  );

  // Auto-mappa om när kolumnuppsättningen ändras eller metadatatyperna laddats in.
  const columnsKey = table.columns.join("\u0001");
  const metaTypesCount = metaTypes.length;
  useEffect(() => {
    setMapping(autoMapColumns(table.columns, fields, metaTypes));
    setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsKey, metaTypesCount, fields]);

  const currentRows = useMemo(() => applyMapping(table, mapping), [table, mapping]);

  const mappedFieldNames = useMemo(() => {
    const s = new Set<string>();
    for (const t of Object.values(mapping)) if (t.startsWith("field:")) s.add(t.slice("field:".length));
    return s;
  }, [mapping]);
  const missingRequired = fields.filter(f => f.required && !mappedFieldNames.has(f.name));

  function setColumnTarget(col: string, target: string) {
    setMapping(prev => {
      const next = { ...prev, [col]: target };
      // Ett systemfält kan bara ta emot EN kolumn — rensa tidigare kolumn med samma mål.
      if (target.startsWith("field:")) {
        for (const other of Object.keys(next)) {
          if (other !== col && next[other] === target) next[other] = IGNORE;
        }
      }
      return next;
    });
    setPreview(null);
  }

  const mut = useMutation({
    mutationFn: async (commit: boolean) => {
      if (currentRows.length === 0) throw new Error("Inga rader hittades");
      const path = commit
        ? `/api/import/wizard/sessions/${sessionId}/commit`
        : `/api/import/wizard/sessions/${sessionId}/preview`;
      const res = await apiRequest("POST", path, { step, rows: currentRows });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Backend kan svara med {errors:[...]} (validering före commit) eller
        // {failures:[...]} (transaktion rullades tillbaka). Båda ska visa
        // åtgärdbar feedback istället för att kasta runtime-undantag.
        const errArr: Array<{ index: number; message: string }> = Array.isArray(body?.errors)
          ? body.errors
          : Array.isArray(body?.failures)
            ? body.failures
            : [];
        const first = errArr[0]?.message ?? body?.message ?? body?.error;
        const summary = errArr.length > 0
          ? `${errArr.length} rad(er) blockerade: ${first}`
          : (first ?? (commit ? "Commit misslyckades" : "Förhandsgranskning misslyckades"));
        if (!commit && Array.isArray(body?.errors)) {
          setPreview(body as PreviewResponse);
        }
        throw new Error(summary);
      }
      return body as PreviewResponse | CommitResponse;
    },
    onSuccess: (r) => {
      if ("dryRun" in r) {
        setPreview(r);
        toast({ title: "Förhandsvisning", description: `${r.valid} OK, ${r.invalid} fel.` });
      } else {
        const warnings = r.metadataWarnings ?? [];
        toast({
          title: `Steg ${step} klart`,
          description: warnings.length > 0
            ? `${r.created} objekt skapade. ${warnings.length} metadata-varning(ar).`
            : `${r.created} objekt skapade.`,
        });
        setText("");
        setFileMatrix(null);
        setFileName("");
        setPreview(null);
        onCommitDone(warnings);
      }
    },
    onError: (e: any) =>
      toast({ title: "Fel", description: e?.message ?? "Kunde inte köra steget", variant: "destructive" }),
  });

  if (locked) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        <Lock className="h-5 w-5 mx-auto mb-2" />
        Steget är låst (committat). Gå vidare till nästa steg.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Mall-kolumner (kan döpas om eller utökas med metadata):{" "}
        <code className="px-1 bg-muted rounded">{templateColumns.join(", ")}</code>
      </div>
      <div className="flex justify-end">
        <DownloadTemplateButton type={tplKey} />
      </div>

      <Tabs
        value={mode}
        onValueChange={v => {
          setMode(v as "paste" | "file");
          setHeaderOverride(null);
          setPreview(null);
        }}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="paste" data-testid={`tab-wizard-paste-${step}`}>Klistra in</TabsTrigger>
          <TabsTrigger value="file" data-testid={`tab-wizard-file-${step}`}>CSV/Excel-fil</TabsTrigger>
        </TabsList>
        <TabsContent value="paste" className="space-y-2 mt-3">
          <Textarea
            value={text}
            onChange={e => {
              setText(e.target.value);
              setPreview(null);
            }}
            rows={8}
            placeholder={`En rad per objekt. Klistra in från Excel (Tab-separerat) eller CSV.\nKolumner kan heta vad som helst — du mappar dem nedan.`}
            className="font-mono text-xs"
            data-testid={`input-wizard-paste-${step}`}
          />
          <div className="text-xs text-muted-foreground">{currentRows.length} rad(er) tolkade</div>
        </TabsContent>
        <TabsContent value="file" className="space-y-2 mt-3">
          <div className="rounded-lg border border-dashed p-6 text-center">
            <FileUp className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <input
              id={`wizard-file-${step}`}
              type="file"
              accept=".csv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={async e => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFileName(f.name);
                try {
                  const { matrix, assumeHeader } = await parseMatrixFromFile(f);
                  setFileAssumeHeader(assumeHeader);
                  setFileMatrix(matrix);
                  setHeaderOverride(null);
                  setPreview(null);
                  if (matrix.length === 0) {
                    toast({ title: "Inga giltiga rader", variant: "destructive" });
                  }
                } catch (err: any) {
                  setFileMatrix(null);
                  toast({
                    title: "Kunde inte läsa filen",
                    description: err?.message ?? "Filen kunde inte tolkas.",
                    variant: "destructive",
                  });
                }
                // Tillåt omval av samma fil.
                e.target.value = "";
              }}
              data-testid={`input-wizard-file-${step}`}
            />
            <label htmlFor={`wizard-file-${step}`}>
              <Button asChild variant="outline" size="sm">
                <span>Välj fil (CSV eller Excel)</span>
              </Button>
            </label>
            {fileName && (
              <div className="mt-2 text-xs text-muted-foreground">
                {fileName} — {currentRows.length} rad(er) tolkade
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {rawMatrix.length > 0 && (
        <label
          className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none"
          data-testid={`label-has-header-${step}`}
        >
          <Checkbox
            checked={hasHeader}
            onCheckedChange={c => {
              setHeaderOverride(c === true);
              setPreview(null);
            }}
            data-testid={`checkbox-has-header-${step}`}
          />
          Första raden är rubrikrad (avmarkera om din data saknar rubriker)
        </label>
      )}

      {table.columns.length > 0 && (
        <div className="rounded-lg border" data-testid={`mapping-table-${step}`}>
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
            <span className="text-xs font-medium">Kolumn-mappning ({table.columns.length} kolumner)</span>
            <span className="text-xs text-muted-foreground">{currentRows.length} rad(er)</span>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">Källkolumn</th>
                  <th className="px-3 py-1.5 font-medium">Exempel</th>
                  <th className="px-3 py-1.5 font-medium">Mappas till</th>
                </tr>
              </thead>
              <tbody>
                {table.columns.map(col => {
                  const sample = sampleValue(table, col);
                  return (
                    <tr key={col} className="border-t" data-testid={`row-mapping-${step}-${col}`}>
                      <td className="px-3 py-1.5 font-mono align-top">{col}</td>
                      <td className="px-3 py-1.5 text-muted-foreground align-top max-w-[160px] truncate" title={sample}>
                        {sample || "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <Select value={mapping[col] ?? IGNORE} onValueChange={v => setColumnTarget(col, v)}>
                          <SelectTrigger className="h-7 w-full" data-testid={`select-mapping-${step}-${col}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={IGNORE}>— Ignorera —</SelectItem>
                            <SelectGroup>
                              <SelectLabel>Systemfält</SelectLabel>
                              {fields.map(f => (
                                <SelectItem key={f.name} value={`field:${f.name}`}>
                                  {f.label}{f.required ? " *" : ""}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                            {metaTypes.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Metadata</SelectLabel>
                                {metaTypes.map(t => (
                                  <SelectItem key={t.namn} value={`meta:${t.namn}`}>
                                    {t.namn}{t.beteckning ? ` (${t.beteckning})` : ""}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {missingRequired.length > 0 && table.columns.length > 0 && (
        <div
          className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-foreground"
          data-testid={`warning-missing-required-${step}`}
        >
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <span>Obligatoriska fält saknar mappning: {missingRequired.map(f => f.label).join(", ")}.</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => mut.mutate(false)}
          disabled={mut.isPending || currentRows.length === 0 || missingRequired.length > 0}
          data-testid={`button-wizard-preview-${step}`}
        >
          <Eye className="h-4 w-4 mr-2" /> Förhandsvisa
        </Button>
        <Button
          onClick={() => mut.mutate(true)}
          disabled={
            mut.isPending ||
            currentRows.length === 0 ||
            missingRequired.length > 0 ||
            (preview ? preview.invalid > 0 : false)
          }
          data-testid={`button-wizard-commit-${step}`}
        >
          <Upload className="h-4 w-4 mr-2" /> Commit steg {step}
        </Button>
      </div>

      {preview && (
        <ImportRowPreview
          valid={preview.valid}
          invalid={preview.invalid}
          duplicates={preview.duplicates}
          errors={preview.errors}
          preview={preview.preview.map(p => ({
            name: p.interim
              ? `${p.interim} — ${p.name}${p.resolvedParentName ? ` (under ${p.resolvedParentName})` : ""}${p.inheritedAddress ? " ⤴ ärvd adress" : ""}`
              : `${p.name}${p.resolvedParentName ? ` (under ${p.resolvedParentName})` : ""}${p.inheritedAddress ? " ⤴ ärvd adress" : ""}`,
          }))}
          testId={`preview-wizard-${step}`}
        />
      )}
    </div>
  );
}

export function ImportWizardFlow() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [activeStep, setActiveStep] = useState<StepNum>(1);
  const [metadataWarnings, setMetadataWarnings] = useState<string[]>([]);

  const sessionQuery = useQuery<SessionDTO>({
    queryKey: ["/api/import/wizard/sessions", sessionId],
    enabled: !!sessionId,
  });

  useEffect(() => {
    if (sessionQuery.data) {
      const next = Math.min(3, (sessionQuery.data.stepCompleted ?? 0) + 1) as StepNum;
      setActiveStep(next);
    }
  }, [sessionQuery.data?.stepCompleted]);

  useEffect(() => {
    if (sessionId) localStorage.setItem(STORAGE_KEY, sessionId);
    else localStorage.removeItem(STORAGE_KEY);
  }, [sessionId]);

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/import/wizard/sessions", {});
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Kunde inte skapa session");
      }
      return res.json() as Promise<SessionDTO>;
    },
    onSuccess: s => {
      setSessionId(s.id);
      setActiveStep(1);
      toast({ title: "Session startad", description: `Wizard-session ${s.id.slice(0, 8)} skapad.` });
    },
    onError: (e: any) => toast({ title: "Fel", description: e?.message, variant: "destructive" }),
  });

  const abandonMut = useMutation({
    mutationFn: async () => {
      if (!sessionId) return;
      await apiRequest("POST", `/api/import/wizard/sessions/${sessionId}/abandon`, {});
    },
    onSuccess: () => {
      setSessionId(null);
      qc.removeQueries({ queryKey: ["/api/import/wizard/sessions"] });
      toast({ title: "Session avslutad" });
    },
  });

  const session = sessionQuery.data;
  const stepCompleted = session?.stepCompleted ?? 0;
  const interimEntries = Object.entries(session?.interimMap ?? {});

  // === UI: ingen session ====================================================
  if (!sessionId) {
    return (
      <Card data-testid="card-wizard-start">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ListOrdered className="h-4 w-4" /> Starta tre-stegs import-wizard
          </CardTitle>
          <CardDescription>
            Guidat onboarding: Organisation → Butiker → Fysiska objekt.
            Interimnummer (t.ex. ORG-1) kopplar stegen så du kan referera tidigare rader.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p
            className="text-sm text-muted-foreground rounded-md border bg-muted/40 p-3"
            data-testid="text-wizard-customer-agnostic"
          >
            Wizard importerar objekt oberoende av kund. Objekten skapas neutrala och
            kopplas till kund senare via orderkoncept.
          </p>
          <Button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            data-testid="button-wizard-create-session"
          >
            Starta wizard
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (sessionQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Laddar session…</div>;
  }

  if (sessionQuery.isError || !session) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-2">
          <div className="text-sm text-destructive">Kunde inte ladda sessionen.</div>
          <Button variant="outline" size="sm" onClick={() => setSessionId(null)}>Börja om</Button>
        </CardContent>
      </Card>
    );
  }

  // === UI: aktiv session ====================================================
  const steps: StepNum[] = [1, 2, 3];

  return (
    <div className="space-y-4" data-testid="wizard-active-session">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ListOrdered className="h-4 w-4" /> Tre-stegs import-wizard
              </CardTitle>
              <CardDescription>
                Session {session.id.slice(0, 8)} • {session.status === "completed" ? "Slutförd" : "Pågående"}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => qc.invalidateQueries({ queryKey: ["/api/import/wizard/sessions", sessionId] })}
                data-testid="button-wizard-refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm("Avbryta sessionen? Skapade objekt påverkas inte.")) abandonMut.mutate();
                }}
                data-testid="button-wizard-abandon"
              >
                Avbryt session
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2 text-xs">
            {steps.map(s => {
              const done = stepCompleted >= s;
              const active = activeStep === s;
              return (
                <Badge
                  key={s}
                  variant={done ? "default" : active ? "outline" : "secondary"}
                  className={done ? "bg-chart-2/20 text-foreground" : ""}
                  data-testid={`badge-wizard-step-${s}`}
                >
                  Steg {s}: {STEP_LABELS[s]} {done && "✓"}
                </Badge>
              );
            })}
            <Badge variant="outline" data-testid="badge-wizard-counts">
              Skapade: {Object.entries(session.createdCounts ?? {})
                .map(([k, v]) => `${k.replace("step", "S")}=${v}`)
                .join(", ") || "–"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs value={String(activeStep)} onValueChange={v => setActiveStep(Number(v) as StepNum)}>
        <TabsList className="grid grid-cols-3 w-full">
          {steps.map(s => (
            <TabsTrigger
              key={s}
              value={String(s)}
              data-testid={`tab-wizard-step-${s}`}
              disabled={s > stepCompleted + 1}
            >
              {s}. {STEP_LABELS[s]}
            </TabsTrigger>
          ))}
        </TabsList>
        {steps.map(s => (
          <TabsContent key={s} value={String(s)} className="mt-4">
            <StepEditor
              step={s}
              locked={stepCompleted >= s}
              sessionId={session.id}
              onCommitDone={(warnings) => {
                setMetadataWarnings(warnings);
                qc.invalidateQueries({ queryKey: ["/api/import/wizard/sessions", sessionId] });
                queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
              }}
            />
          </TabsContent>
        ))}
      </Tabs>

      {metadataWarnings.length > 0 && (
        <Card className="border-warning/40" data-testid="card-metadata-warnings">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-sm flex items-center gap-2 text-foreground">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Metadata-varningar ({metadataWarnings.length})
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setMetadataWarnings([])}
                data-testid="button-dismiss-metadata-warnings"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <CardDescription>
              Objekten skapades, men viss metadata kunde inte skrivas. Skapa saknade
              metadatatyper under Metadata och importera dem igen vid behov.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 space-y-1 text-xs text-foreground">
              {metadataWarnings.map((w, i) => (
                <li key={i} data-testid={`text-metadata-warning-${i}`}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {interimEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Interim-mapping ({interimEntries.length})</CardTitle>
            <CardDescription>
              Interim-IDn som har resolvats till permanenta objekt. Använd dessa som
              <code className="px-1 mx-1 bg-muted rounded">parentInterim</code>
              i kommande steg.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 overflow-y-auto border rounded text-xs">
              <table className="w-full">
                <thead className="bg-muted text-left">
                  <tr>
                    <th className="px-2 py-1">Interim</th>
                    <th className="px-2 py-1">Steg</th>
                    <th className="px-2 py-1">Namn</th>
                  </tr>
                </thead>
                <tbody>
                  {interimEntries.map(([interim, entry]) => (
                    <tr key={interim} className="border-t" data-testid={`row-interim-${interim}`}>
                      <td className="px-2 py-1 font-mono">{interim}</td>
                      <td className="px-2 py-1">S{entry.step}</td>
                      <td className="px-2 py-1">{entry.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
