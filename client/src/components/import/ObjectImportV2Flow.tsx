// Import 2.0 — session-baserat 5-stegsflöde för objektimport.
// Steg: Ladda upp → Förhandsgranska → Matcha → Validera → Importera & bygg hierarki.
// Additivt; pratar med /api/import/objects-v2/*. Klientsidig xlsx/csv-parsning.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ImportUndoButton } from "@/components/import/ImportUndoButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Layers,
  ListChecks,
  Loader2,
  RotateCcw,
  Upload,
} from "lucide-react";
import Papa from "papaparse";
import type { Customer } from "@shared/schema";

type StepNum = 1 | 2 | 3 | 4 | 5;

interface DetectedColumn {
  index: number;
  header: string | null;
  userHeader: string | null;
  autoMatch: string | null;
  matched: boolean;
}

interface FieldDef {
  key: string;
  label: string;
  description?: string;
  category: "standard" | "address" | "contact" | "metadata";
  type: string;
  required?: boolean;
}

interface Mapping {
  target: string;
  type: "standard" | "address" | "contact" | "metadata";
  required?: boolean;
}
type Mappings = Record<string, Mapping>;

interface UploadResponse {
  session_id: string;
  status: string;
  file_name: string | null;
  columns: DetectedColumn[];
  total_rows: number;
  preview_rows: Record<string, string>[];
  mappings: Mappings;
}

interface RowIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
}
interface ValidatedRow {
  rowNumber: number;
  status: "valid" | "warning" | "invalid";
  issues: RowIssue[];
}
interface DuplicateWarning {
  name: string;
  address: string | null;
  rowNumbers: number[];
  existing: Array<{ id: string; objectNumber: string | null; name: string; address: string | null }>;
}
interface ValidationResponse {
  summary: { total_rows: number; valid: number; warning: number; invalid: number } | null;
  rows: ValidatedRow[];
  duplicateWarnings?: DuplicateWarning[];
}

interface ExecuteResponse {
  status: string;
  summary: { total_rows: number; created: number; updated: number; skipped: number; errors: number };
  hierarchy: { root_objects: number; total_levels: number; total_objects: number };
  customer_id: string;
  cluster_id: string;
}

const STEPS: { num: StepNum; label: string; icon: typeof Upload }[] = [
  { num: 1, label: "Ladda upp", icon: Upload },
  { num: 2, label: "Förhandsgranska", icon: FileUp },
  { num: 3, label: "Matcha data", icon: ListChecks },
  { num: 4, label: "Validera", icon: CheckCircle2 },
  { num: 5, label: "Importera", icon: Layers },
];

const TARGET_NONE = "__empty";

// Senaste kolumnmatchning sparas lokalt (per webbläsare) så att samma
// filstruktur slipper matchas om vid nästa import. En signatur av
// kolumnrubrikerna avgör om strukturen är densamma; matchningen lagras
// per kolumnindex.
const LAST_MAPPING_KEY = "traivo:import-v2:last-mapping";

interface SavedMapping {
  signature: string;
  byIndex: Record<string, Mapping>;
}

function headerSignature(cols: DetectedColumn[]): string {
  return cols.map((c) => c.userHeader || c.header || "").join("|");
}

function loadSavedMapping(): SavedMapping | null {
  try {
    const raw = localStorage.getItem(LAST_MAPPING_KEY);
    return raw ? (JSON.parse(raw) as SavedMapping) : null;
  } catch {
    return null;
  }
}

function persistMapping(cols: DetectedColumn[], mappings: Mappings) {
  try {
    // Lagra per kolumnindex (inte rubriktext) så att dubblettrubriker inte
    // skriver över varandra. Signaturen garanterar att index matchar exakt
    // vid återanvändning av samma filstruktur.
    const byIndex: Record<string, Mapping> = {};
    for (const c of cols) {
      const m = mappings[String(c.index)];
      if (m) byIndex[String(c.index)] = m;
    }
    localStorage.setItem(
      LAST_MAPPING_KEY,
      JSON.stringify({ signature: headerSignature(cols), byIndex } satisfies SavedMapping),
    );
  } catch {
    // localStorage kan vara otillgängligt (privat läge) — ignorera tyst.
  }
}

// Parsa uppladdad fil till en matris (alla rader inkl. headers).
async function fileToMatrix(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const ExcelJS = (await import("exceljs")).default;
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error("Hittade inget kalkylblad i Excel-filen");
    const cellToString = (val: unknown): string => {
      if (val === null || val === undefined) return "";
      if (val instanceof Date) return val.toISOString().split("T")[0];
      if (typeof val === "object" && val !== null) {
        if ("richText" in val) {
          return (val as { richText: Array<{ text?: string }> }).richText.map((r) => r.text ?? "").join("");
        }
        if ("formula" in val) return String((val as { result?: unknown }).result ?? "");
        if ("hyperlink" in val) return String((val as { text?: unknown }).text ?? "");
      }
      return String(val);
    };
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const rowData: string[] = [];
      const colCount = sheet.columnCount || row.cellCount;
      for (let c = 1; c <= colCount; c++) rowData.push(cellToString(row.getCell(c).value));
      rows.push(rowData);
    });
    return rows;
  }
  // CSV — auto-detektera avgränsare via Papa.
  const text = await file.text();
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  return (parsed.data as string[][]).map((r) => r.map((c) => String(c ?? "")));
}

// Tre-fils-export (Task #1176), Fil 3 – Metadata: långformat med en rad per
// objekt + metadatafält (Objektnummer, Objektnamn, [Släktnamn,] Metadatafält,
// Data). Matchningsimporten arbetar i brett format (en rad per objekt), så vi
// pivoterar långformatet → brett format innan uppladdning: identitetskolumner
// (Objektnummer/Objektnamn) behålls och varje distinkt Metadatafält blir en
// egen "metadata.<namn>"-kolumn. Returnerar null om matrisen inte är långformat.
export function pivotLongMetadataMatrix(matrix: string[][]): string[][] | null {
  if (matrix.length < 2) return null;
  const header = matrix[0].map((c) => (c ?? "").trim().toLowerCase());
  const idxOf = (...names: string[]) => header.findIndex((h) => names.includes(h));

  const objIdx = idxOf("objektnummer", "systemnummer", "huvudobjekt");
  const fieldIdx = idxOf("metadatafält", "metadatafalt", "metadatafält");
  const dataIdx = idxOf("data", "värde", "varde");
  if (objIdx < 0 || fieldIdx < 0 || dataIdx < 0) return null;

  const nameIdx = idxOf("objektnamn", "namn");

  // Samla identiteter + värden per objekt, och alla förekommande fältnamn.
  const objOrder: string[] = [];
  const byObj = new Map<string, { name: string; values: Map<string, string> }>();
  const fieldOrder: string[] = [];
  const fieldSeen = new Set<string>();

  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r];
    const objNo = (row[objIdx] ?? "").trim();
    const field = (row[fieldIdx] ?? "").trim();
    if (!objNo || !field) continue;
    const data = (row[dataIdx] ?? "").trim();
    let entry = byObj.get(objNo);
    if (!entry) {
      entry = { name: nameIdx >= 0 ? (row[nameIdx] ?? "").trim() : "", values: new Map() };
      byObj.set(objNo, entry);
      objOrder.push(objNo);
    } else if (!entry.name && nameIdx >= 0) {
      entry.name = (row[nameIdx] ?? "").trim();
    }
    entry.values.set(field, data); // sista värdet vinner (multivärde → senaste)
    if (!fieldSeen.has(field)) {
      fieldSeen.add(field);
      fieldOrder.push(field);
    }
  }
  if (objOrder.length === 0) return null;

  const outHeader = ["Objektnummer", "Objektnamn", ...fieldOrder.map((f) => `metadata.${f}`)];
  const out: string[][] = [outHeader];
  for (const objNo of objOrder) {
    const entry = byObj.get(objNo)!;
    out.push([objNo, entry.name, ...fieldOrder.map((f) => entry.values.get(f) ?? "")]);
  }
  return out;
}

export function ObjectImportV2Flow() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Vilken rubriksignatur restore-effekten redan hanterat (en gång per uppladdning).
  const restoredSigRef = useRef<string | null>(null);

  const [step, setStep] = useState<StepNum>(1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [columns, setColumns] = useState<DetectedColumn[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [mappings, setMappings] = useState<Mappings>({});
  const [autoMappings, setAutoMappings] = useState<Mappings>({});
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [result, setResult] = useState<ExecuteResponse | null>(null);
  const [customerId, setCustomerId] = useState<string>("");
  const [skippedRows, setSkippedRows] = useState<Set<number>>(new Set());
  const [overwriteMetadata, setOverwriteMetadata] = useState(false);
  const [importing, setImporting] = useState(false);

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: fieldsData } = useQuery<{ fields: FieldDef[] }>({
    queryKey: ["/api/import/objects-v2/fields"],
  });
  const fields = fieldsData?.fields ?? [];

  const groupedFields = useMemo(() => {
    const groups: Record<string, FieldDef[]> = { standard: [], address: [], contact: [], metadata: [] };
    for (const f of fields) (groups[f.category] ??= []).push(f);
    return groups;
  }, [fields]);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const rawMatrix = await fileToMatrix(file);
      if (rawMatrix.length === 0) throw new Error("Filen är tom.");
      // Fil 3 (metadata-långformat) pivoteras till brett format innan uppladdning.
      const matrix = pivotLongMetadataMatrix(rawMatrix) ?? rawMatrix;
      const res = await apiRequest("POST", "/api/import/objects-v2/upload", {
        fileName: file.name,
        matrix,
      });
      return (await res.json()) as UploadResponse;
    },
    onSuccess: (data) => {
      setSessionId(data.session_id);
      setFileName(data.file_name);
      setColumns(data.columns);
      setPreviewRows(data.preview_rows);
      setTotalRows(data.total_rows);
      setAutoMappings(data.mappings);
      setMappings(data.mappings);
      // Låt restore-effekten köra för denna (ev. nya) filstruktur.
      restoredSigRef.current = null;
      setStep(2);
    },
    onError: (err: Error) => toast({ title: "Uppladdning misslyckades", description: err.message, variant: "destructive" }),
  });

  const saveMappingsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/import/objects-v2/${sessionId}/mappings`, { mappings });
      return await res.json();
    },
    onSuccess: () => {
      // Spara matchningen som användaren faktiskt bekräftat (inte mellanlägen).
      persistMapping(columns, mappings);
      setStep(4);
    },
    onError: (err: Error) => toast({ title: "Kunde inte spara mappning", description: err.message, variant: "destructive" }),
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/import/objects-v2/${sessionId}/validate`, {});
      return (await res.json()) as ValidationResponse;
    },
    onSuccess: (data) => setValidation(data),
    onError: (err: Error) => toast({ title: "Validering misslyckades", description: err.message, variant: "destructive" }),
  });

  // Steg 5 körs som bakgrundsjobb på servern: execute svarar 202, sedan pollar
  // vi status tills completed/failed och hämtar slutresultatet.
  const executeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/import/objects-v2/${sessionId}/execute`, {
        customerId: customerId || undefined,
        skipRowNumbers: Array.from(skippedRows),
        overwriteMetadata,
      });
      return (await res.json()) as { session_id: string; status: string };
    },
    onSuccess: () => setImporting(true),
    onError: (err: Error) => toast({ title: "Import misslyckades", description: err.message, variant: "destructive" }),
  });

  const statusQuery = useQuery<{ status: string; progress: number; error: string | null }>({
    queryKey: ["/api/import/objects-v2", sessionId, "status"],
    enabled: importing && !!sessionId,
    refetchInterval: 1500,
  });

  useEffect(() => {
    if (!importing) return;
    const st = statusQuery.data?.status;
    if (st === "completed") {
      setImporting(false);
      apiRequest("GET", `/api/import/objects-v2/${sessionId}/result`)
        .then((r) => r.json())
        .then((data: ExecuteResponse | null) => {
          if (!data) return;
          setResult(data);
          toast({
            title: "Import klar",
            description: `${data.summary.created} skapade, ${data.summary.updated} uppdaterade.`,
          });
        })
        .catch((err: Error) =>
          toast({ title: "Kunde inte hämta resultat", description: err.message, variant: "destructive" }),
        );
    } else if (st === "failed") {
      setImporting(false);
      toast({
        title: "Import misslyckades",
        description: statusQuery.data?.error ?? "Okänt fel under import.",
        variant: "destructive",
      });
    }
  }, [importing, statusQuery.data, sessionId, toast]);

  // Återanvänd senaste sparade matchning när en fil med samma rubrikstruktur
  // laddas upp. Körs först när fältkatalogen finns så att ogiltiga targets
  // (t.ex. borttagna metadatafält) kan filtreras bort och falla till auto.
  useEffect(() => {
    if (columns.length === 0 || fields.length === 0) return;
    const sig = headerSignature(columns);
    if (restoredSigRef.current === sig) return;
    restoredSigRef.current = sig;
    const saved = loadSavedMapping();
    if (!saved || saved.signature !== sig) return;
    const validKeys = new Set(fields.map((f) => f.key));
    const restored: Mappings = {};
    for (const c of columns) {
      const m = saved.byIndex[String(c.index)];
      if (m && validKeys.has(m.target)) restored[String(c.index)] = m;
    }
    if (Object.keys(restored).length === 0) return;
    setMappings(restored);
    toast({
      title: "Senaste matchning återanvänd",
      description: "Din tidigare kolumnmatchning för samma filstruktur har återställts.",
    });
  }, [columns, fields, toast]);

  const toggleSkipRow = (rowNumber: number) => {
    setSkippedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  };

  const setColumnTarget = (colIndex: number, target: string) => {
    setMappings((prev) => {
      const next = { ...prev };
      if (target === TARGET_NONE) {
        delete next[String(colIndex)];
      } else {
        const field = fields.find((f) => f.key === target);
        next[String(colIndex)] = {
          target,
          type: field?.category ?? "metadata",
          required: target === "name",
        };
      }
      return next;
    });
  };

  const resetMappings = () => {
    setMappings(autoMappings);
    toast({
      title: "Matchning återställd",
      description: "Kolumnmatchningen är återställd till systemets förslag.",
    });
  };

  const resetFlow = () => {
    setStep(1);
    setSessionId(null);
    setFileName(null);
    setColumns([]);
    setPreviewRows([]);
    setTotalRows(0);
    setMappings({});
    setValidation(null);
    setResult(null);
    setCustomerId("");
    setSkippedRows(new Set());
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const mappedCount = Object.keys(mappings).length;
  const hasNameMapping = Object.values(mappings).some((m) => m.target === "name");
  const hasCustomerMapping = Object.values(mappings).some(
    (m) => m.target === "customer_name" || m.target === "customer_ref",
  );

  return (
    <div className="space-y-6" data-testid="object-import-v2-flow">
      {/* Stegindikator */}
      <div className="flex items-center justify-between gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = s.num === step;
          const done = s.num < step;
          return (
            <div key={s.num} className="flex flex-1 items-center gap-2" data-testid={`step-indicator-${s.num}`}>
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground"
                }`}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span className={`text-sm ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && <div className="mx-1 hidden h-px flex-1 bg-border sm:block" />}
            </div>
          );
        })}
      </div>

      {/* Steg 1 — Ladda upp */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Ladda upp fil</CardTitle>
            <CardDescription>
              Ladda upp en Excel- (.xlsx/.xls) eller CSV-fil med objekt. Systemet upptäcker kolumner och
              föreslår automatiskt matchningar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,text/csv"
              className="hidden"
              data-testid="input-object-import-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMutation.mutate(file);
              }}
            />
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-10 text-center">
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Välj en fil att importera</p>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                data-testid="button-choose-file"
              >
                {uploadMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Bearbetar…
                  </>
                ) : (
                  <>
                    <FileUp className="mr-2 h-4 w-4" /> Välj fil
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Steg 2 — Förhandsgranska */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Förhandsgranska</CardTitle>
            <CardDescription>
              {fileName} — {totalRows} rader, {columns.length} kolumner upptäckta.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((c) => (
                      <TableHead key={c.index} data-testid={`preview-header-${c.index}`}>
                        {c.userHeader || c.header || `Kolumn ${c.index + 1}`}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, ri) => (
                    <TableRow key={ri} data-testid={`preview-row-${ri}`}>
                      {columns.map((c) => (
                        <TableCell key={c.index} className="whitespace-nowrap text-sm">
                          {row[String(c.index)] ?? ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={resetFlow} data-testid="button-back-to-upload">
                Börja om
              </Button>
              <Button onClick={() => setStep(3)} data-testid="button-to-mapping">
                Fortsätt till matchning
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Steg 3 — Matcha data */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Matcha data</CardTitle>
            <CardDescription>
              Koppla varje kolumn till ett fält i systemet. {mappedCount} av {columns.length} kolumner matchade.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!hasNameMapping && (
              <div className="flex items-center gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning-foreground">
                <AlertCircle className="h-4 w-4 text-warning" />
                Minst en kolumn måste matchas till <strong>Objektnamn</strong>.
              </div>
            )}
            <div className="space-y-3">
              {columns.map((c) => {
                const current = mappings[String(c.index)]?.target ?? TARGET_NONE;
                return (
                  <div
                    key={c.index}
                    className="grid grid-cols-1 items-center gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
                    data-testid={`mapping-row-${c.index}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {c.userHeader || c.header || `Kolumn ${c.index + 1}`}
                      </p>
                      {c.header && c.userHeader && c.header !== c.userHeader && (
                        <p className="truncate text-xs text-muted-foreground">{c.header}</p>
                      )}
                      {previewRows[0]?.[String(c.index)] && (
                        <p className="truncate text-xs text-muted-foreground">
                          t.ex. {previewRows[0][String(c.index)]}
                        </p>
                      )}
                    </div>
                    <Select value={current} onValueChange={(v) => setColumnTarget(c.index, v)}>
                      <SelectTrigger data-testid={`select-mapping-${c.index}`}>
                        <SelectValue placeholder="Välj fält…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TARGET_NONE}>— Ignorera kolumn —</SelectItem>
                        {(["standard", "address", "contact", "metadata"] as const).map((cat) =>
                          (groupedFields[cat]?.length ?? 0) > 0 ? (
                            <SelectGroup key={cat}>
                              <SelectLabel>
                                {cat === "standard"
                                  ? "Standardfält"
                                  : cat === "address"
                                  ? "Adress"
                                  : cat === "contact"
                                  ? "Kontakt"
                                  : "Metadata"}
                              </SelectLabel>
                              {groupedFields[cat].map((f) => (
                                <SelectItem key={f.key} value={f.key}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ) : null,
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(2)} data-testid="button-back-to-preview">
                  Tillbaka
                </Button>
                <Button variant="ghost" onClick={resetMappings} data-testid="button-reset-mappings">
                  <RotateCcw className="mr-2 h-4 w-4" /> Återställ matchning
                </Button>
              </div>
              <Button
                onClick={() => saveMappingsMutation.mutate()}
                disabled={!hasNameMapping || saveMappingsMutation.isPending}
                data-testid="button-save-mappings"
              >
                {saveMappingsMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sparar…
                  </>
                ) : (
                  "Validera"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Steg 4 — Validera */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Validera</CardTitle>
            <CardDescription>Kontrollera rader innan import. Ogiltiga rader hoppas över.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!validation && (
              <Button
                onClick={() => validateMutation.mutate()}
                disabled={validateMutation.isPending}
                data-testid="button-run-validation"
              >
                {validateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Validerar…
                  </>
                ) : (
                  "Kör validering"
                )}
              </Button>
            )}
            {validation?.summary && (
              <>
                {validation.duplicateWarnings && validation.duplicateWarnings.length > 0 && (
                  <div
                    className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
                    data-testid="banner-duplicate-warnings"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-warning" />
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">
                          Möjliga dubbletter — samma namn och adress finns redan
                        </p>
                        <p className="text-muted-foreground">
                          {validation.duplicateWarnings.length} rad(er) matchar befintliga aktiva
                          objekt. Berörda rader är flaggade nedan — överväg att arkivera eller slå
                          ihop dubbletter i efterhand.
                        </p>
                      </div>
                    </div>
                    <ul className="ml-7 list-disc space-y-1 text-muted-foreground">
                      {validation.duplicateWarnings.map((w, i) => (
                        <li key={`${w.name}-${i}`} data-testid={`duplicate-warning-${i}`}>
                          <span className="text-foreground">{w.name}</span>
                          {w.address ? ` · ${w.address}` : ""} — rad {w.rowNumbers.join(", ")} (finns
                          som {w.existing.map((e) => e.objectNumber ?? e.name).join(", ")})
                        </li>
                      ))}
                    </ul>
                    <a
                      href="/objects/duplicates"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-7 inline-block font-medium text-primary underline-offset-2 hover:underline"
                      data-testid="link-duplicate-management"
                    >
                      Öppna dubbletthantering →
                    </a>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-md border border-border p-3" data-testid="summary-total">
                    <p className="text-2xl font-semibold">{validation.summary.total_rows}</p>
                    <p className="text-xs text-muted-foreground">Rader</p>
                  </div>
                  <div className="rounded-md border border-border p-3" data-testid="summary-valid">
                    <p className="text-2xl font-semibold text-primary">{validation.summary.valid}</p>
                    <p className="text-xs text-muted-foreground">Giltiga</p>
                  </div>
                  <div className="rounded-md border border-border p-3" data-testid="summary-warning">
                    <p className="text-2xl font-semibold text-warning">{validation.summary.warning}</p>
                    <p className="text-xs text-muted-foreground">Varningar</p>
                  </div>
                  <div className="rounded-md border border-border p-3" data-testid="summary-invalid">
                    <p className="text-2xl font-semibold text-destructive">{validation.summary.invalid}</p>
                    <p className="text-xs text-muted-foreground">Ogiltiga</p>
                  </div>
                </div>
                {validation.rows.filter((r) => r.issues.length > 0).length > 0 && (
                  <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rad</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Problem</TableHead>
                          <TableHead className="text-right">Hoppa över</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {validation.rows
                          .filter((r) => r.issues.length > 0)
                          .map((r) => (
                            <TableRow key={r.rowNumber} data-testid={`validation-row-${r.rowNumber}`}>
                              <TableCell>{r.rowNumber}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={r.status === "invalid" ? "destructive" : "secondary"}
                                  className={r.status === "warning" ? "bg-warning/15 text-warning-foreground" : ""}
                                >
                                  {r.status === "invalid" ? "Ogiltig" : r.status === "warning" ? "Varning" : "Giltig"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {r.issues.map((i) => i.message).join("; ")}
                              </TableCell>
                              <TableCell className="text-right">
                                <Checkbox
                                  checked={r.status === "invalid" || skippedRows.has(r.rowNumber)}
                                  disabled={r.status === "invalid"}
                                  onCheckedChange={() => toggleSkipRow(r.rowNumber)}
                                  data-testid={`checkbox-skip-${r.rowNumber}`}
                                  aria-label={`Hoppa över rad ${r.rowNumber}`}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Ogiltiga rader hoppas alltid över. Bocka i ytterligare rader för att utesluta dem från importen.
                </p>
              </>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(3)} data-testid="button-back-to-mapping">
                Tillbaka
              </Button>
              <Button
                onClick={() => setStep(5)}
                disabled={!validation?.summary}
                data-testid="button-to-import"
              >
                Fortsätt till import
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Steg 5 — Importera */}
      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle>Importera & bygg hierarki</CardTitle>
            <CardDescription>
              Objekt skapas/uppdateras och hierarkin byggs utifrån förälder-relationer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!result && (
              <>
                <div className="max-w-md space-y-2">
                  <Label htmlFor="customer-select">
                    {hasCustomerMapping ? "Standardkund (fallback)" : "Kund (valfritt)"}
                  </Label>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger id="customer-select" data-testid="select-import-customer">
                      <SelectValue placeholder="Första kunden (standard)" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {hasCustomerMapping
                      ? "Du har mappat en kund-kolumn — varje objekt kopplas till kunden i sin rad. Den här kunden används bara som fallback för rader vars kund inte kan hittas. Lämna tomt för tenantens första kund."
                      : "Objekten kopplas till kunden för klustring. Lämna tomt för tenantens första kund. Tips: mappa en kolumn till \u201eKund (namn)\u201d eller \u201eKund (kundnummer)\u201d för att koppla varje objekt till olika kunder."}
                  </p>
                </div>
                <div className="flex max-w-md items-start gap-2">
                  <Checkbox
                    id="overwrite-metadata"
                    checked={overwriteMetadata}
                    onCheckedChange={(v) => setOverwriteMetadata(v === true)}
                    data-testid="checkbox-overwrite-metadata"
                  />
                  <div className="space-y-1">
                    <Label htmlFor="overwrite-metadata" className="cursor-pointer">
                      Skriv över befintliga metadatavärden
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Uppdaterar redan lagrade metadatafält på befintliga objekt med värdena i filen
                      (t.ex. en redigerad export). Lämna av för att bevara befintliga värden och bara
                      lägga till fält som saknas.
                    </p>
                  </div>
                </div>
                {(executeMutation.isPending || importing) && (
                  <Progress
                    value={importing ? statusQuery.data?.progress ?? 0 : 10}
                    data-testid="import-progress"
                  />
                )}
                <div className="flex justify-between">
                  <Button
                    variant="outline"
                    onClick={() => setStep(4)}
                    disabled={executeMutation.isPending || importing}
                    data-testid="button-back-to-validate"
                  >
                    Tillbaka
                  </Button>
                  <Button
                    onClick={() => executeMutation.mutate()}
                    disabled={executeMutation.isPending || importing}
                    data-testid="button-execute-import"
                  >
                    {executeMutation.isPending || importing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importerar…
                      </>
                    ) : (
                      "Starta import"
                    )}
                  </Button>
                </div>
              </>
            )}
            {result && (
              <div className="space-y-4" data-testid="import-result">
                <div className="flex items-center gap-2 rounded-md bg-primary/10 p-3 text-sm text-primary">
                  <CheckCircle2 className="h-5 w-5" />
                  Importen är klar.
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-md border border-border p-3" data-testid="result-created">
                    <p className="text-2xl font-semibold text-primary">{result.summary.created}</p>
                    <p className="text-xs text-muted-foreground">Skapade</p>
                  </div>
                  <div className="rounded-md border border-border p-3" data-testid="result-updated">
                    <p className="text-2xl font-semibold">{result.summary.updated}</p>
                    <p className="text-xs text-muted-foreground">Uppdaterade</p>
                  </div>
                  <div className="rounded-md border border-border p-3" data-testid="result-skipped">
                    <p className="text-2xl font-semibold text-muted-foreground">{result.summary.skipped}</p>
                    <p className="text-xs text-muted-foreground">Överhoppade</p>
                  </div>
                  <div className="rounded-md border border-border p-3" data-testid="result-errors">
                    <p className="text-2xl font-semibold text-destructive">{result.summary.errors}</p>
                    <p className="text-xs text-muted-foreground">Fel</p>
                  </div>
                </div>
                <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
                  Hierarki: {result.hierarchy.root_objects} rotobjekt, {result.hierarchy.total_levels} nivåer,{" "}
                  {result.hierarchy.total_objects} objekt totalt.
                </div>
                <ImportUndoButton />
                <Button onClick={resetFlow} data-testid="button-new-import">
                  Ny import
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
