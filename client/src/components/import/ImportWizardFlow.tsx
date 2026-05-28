// Task #578: Tre-stegs import-wizard (Organisation → Butiker → Fysiska objekt).
// Guidat onboarding-flöde där interimnummer kopplar stegen.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Eye, FileUp, ListOrdered, Lock, RefreshCw, Upload } from "lucide-react";
import Papa from "papaparse";
import type { Customer } from "@shared/schema";
import { ImportRowPreview } from "@/components/import/ImportRowPreview";
import { DownloadTemplateButton } from "@/components/DownloadTemplateButton";
import { IMPORT_TEMPLATES, type ImportTemplateKey } from "@shared/import-templates";

type StepNum = 1 | 2 | 3;

interface SessionDTO {
  id: string;
  tenantId: string;
  customerId: string;
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
  session: SessionDTO;
}

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

function parseRowsFromText(text: string, columns: string[]): Array<Record<string, string>> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // Försök CSV-header först
  const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
  const headerLooksLikeColumns = columns.some(c => firstLine.toLowerCase().includes(c.toLowerCase()));
  if (headerLooksLikeColumns) {
    const delim = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
    const parsed = Papa.parse<Record<string, string>>(trimmed, {
      header: true,
      skipEmptyLines: true,
      delimiter: delim,
      transformHeader: h => h.trim(),
    });
    return (parsed.data || [])
      .map(r => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) {
          if (v == null) continue;
          const str = String(v).trim();
          if (str !== "") out[k.trim()] = str;
        }
        return out;
      })
      .filter(r => Object.keys(r).length > 0);
  }
  // Annars: kolumn-ordning från template
  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines
    .map(line => {
      const cells = line.includes("\t") ? line.split("\t") : line.split(",");
      const out: Record<string, string> = {};
      columns.forEach((c, i) => {
        if (cells[i] != null && cells[i].trim() !== "") out[c] = cells[i].trim();
      });
      return out;
    })
    .filter(r => Object.keys(r).length > 0);
}

async function parseFileRows(file: File, columns: string[]): Promise<Array<Record<string, string>>> {
  const name = file.name.toLowerCase();
  const isXlsx = name.endsWith(".xlsx") || name.endsWith(".xls");
  if (!isXlsx) {
    const text = await file.text();
    return parseRowsFromText(text, columns);
  }
  const ExcelJS = (await import("exceljs")).default;
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
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
  const filtered = aoa.filter((r, idx) => idx === 0 || !(r[0] ?? "").startsWith("[EXEMPEL"));
  if (filtered.length === 0) return [];
  const headers = filtered[0].map(h => h.trim());
  return filtered.slice(1).map(cells => {
    const out: Record<string, string> = {};
    headers.forEach((h, i) => {
      const v = cells[i];
      if (v != null && String(v).trim() !== "") out[h] = String(v).trim();
    });
    return out;
  }).filter(r => Object.keys(r).length > 0);
}

interface StepEditorProps {
  step: StepNum;
  locked: boolean;
  onCommitDone: () => void;
  sessionId: string;
}

function StepEditor({ step, locked, onCommitDone, sessionId }: StepEditorProps) {
  const { toast } = useToast();
  const tplKey = STEP_TEMPLATES[step];
  const tpl = IMPORT_TEMPLATES[tplKey];
  const columns = useMemo(() => tpl.columns.map(c => c.name), [tpl]);
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [text, setText] = useState("");
  const [fileRows, setFileRows] = useState<Array<Record<string, string>> | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const currentRows = useMemo(
    () => (mode === "paste" ? parseRowsFromText(text, columns) : fileRows ?? []),
    [mode, text, fileRows, columns],
  );

  const mut = useMutation({
    mutationFn: async (commit: boolean) => {
      if (currentRows.length === 0) throw new Error("Inga rader hittades");
      const path = commit
        ? `/api/import/wizard/sessions/${sessionId}/commit`
        : `/api/import/wizard/sessions/${sessionId}/preview`;
      const res = await apiRequest("POST", path, { step, rows: currentRows });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && !commit) {
        throw new Error(body?.message ?? "Förhandsgranskning misslyckades");
      }
      return body as PreviewResponse | CommitResponse;
    },
    onSuccess: (r) => {
      if ("dryRun" in r) {
        setPreview(r);
        toast({ title: "Förhandsvisning", description: `${r.valid} OK, ${r.invalid} fel.` });
      } else {
        if (r.ok) {
          toast({ title: `Steg ${step} klart`, description: `${r.created} objekt skapade.` });
          setText("");
          setFileRows(null);
          setFileName("");
          setPreview(null);
          onCommitDone();
        } else {
          toast({
            title: "Commit misslyckades",
            description: `${r.failures.length} rader gick inte att skapa.`,
            variant: "destructive",
          });
        }
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
        Kolumner: <code className="px-1 bg-muted rounded">{columns.join(", ")}</code>
      </div>
      <div className="flex justify-end">
        <DownloadTemplateButton type={tplKey} />
      </div>

      <Tabs value={mode} onValueChange={v => setMode(v as "paste" | "file")}>
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
            placeholder={`En rad per objekt. Klistra in från Excel (Tab-separerat) eller CSV.\nKolumner: ${columns.join(", ")}`}
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
                  const rows = await parseFileRows(f, columns);
                  setFileRows(rows);
                  setPreview(null);
                  if (rows.length === 0) {
                    toast({ title: "Inga giltiga rader", variant: "destructive" });
                  }
                } catch (err: any) {
                  setFileRows(null);
                  toast({
                    title: "Kunde inte läsa filen",
                    description: err?.message ?? "Filen kunde inte tolkas.",
                    variant: "destructive",
                  });
                }
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
                {fileName} — {fileRows?.length ?? 0} rad(er) tolkade
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => mut.mutate(false)}
          disabled={mut.isPending || currentRows.length === 0}
          data-testid={`button-wizard-preview-${step}`}
        >
          <Eye className="h-4 w-4 mr-2" /> Förhandsvisa
        </Button>
        <Button
          onClick={() => mut.mutate(true)}
          disabled={
            mut.isPending ||
            currentRows.length === 0 ||
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
  const [customerId, setCustomerId] = useState<string>("");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<StepNum>(1);

  const customersQuery = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const customer = useMemo(
    () => customersQuery.data?.find(c => c.id === customerId) || null,
    [customersQuery.data, customerId],
  );

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
      if (!customerId) throw new Error("Välj en kund först");
      const res = await apiRequest("POST", "/api/import/wizard/sessions", { customerId });
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
            Guidat onboarding för en kund: Organisation → Butiker → Fysiska objekt.
            Interimnummer (t.ex. ORG-1) kopplar stegen så du kan referera tidigare rader.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Kund</Label>
            <Popover open={customerPickerOpen} onOpenChange={setCustomerPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                  data-testid="button-wizard-select-customer"
                >
                  {customer ? (
                    <span className="truncate">{customer.name}</span>
                  ) : (
                    <span className="text-muted-foreground">Välj kund...</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Sök kund..." />
                  <CommandList>
                    <CommandEmpty>Ingen kund hittades.</CommandEmpty>
                    <CommandGroup>
                      {(customersQuery.data || []).slice(0, 200).map(c => (
                        <CommandItem
                          key={c.id}
                          value={c.name}
                          onSelect={() => {
                            setCustomerId(c.id);
                            setCustomerPickerOpen(false);
                          }}
                          data-testid={`option-wizard-customer-${c.id}`}
                        >
                          <Check className={`mr-2 h-4 w-4 ${customerId === c.id ? "opacity-100" : "opacity-0"}`} />
                          <span className="truncate">{c.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <Button
            onClick={() => createMut.mutate()}
            disabled={!customerId || createMut.isPending}
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
              onCommitDone={() => {
                qc.invalidateQueries({ queryKey: ["/api/import/wizard/sessions", sessionId] });
                queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
              }}
            />
          </TabsContent>
        ))}
      </Tabs>

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
