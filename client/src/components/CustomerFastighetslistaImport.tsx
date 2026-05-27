import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Loader2, Upload, CheckCircle2, AlertTriangle, RotateCcw, Building2, ChevronsUpDown, Check,
  Plus, FileWarning, Flag, ArrowRight, Eye, Undo2, Copy,
} from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { Customer } from "@shared/schema";

type Step = "select-customer" | "upload" | "mapping" | "diff" | "importing" | "done";

interface AvailableField { key: string; label: string; required: boolean }

interface PreviewResponse {
  customer: { id: string; name: string };
  columns: string[];
  headerFingerprint: string;
  sampleRows: Record<string, string>[];
  totalRows: number;
  rows: Record<string, string>[];
  savedMapping: null | { columnMap: Record<string, string | null>; label: string | null; updatedAt: string; lastUsedAt: string; usable: boolean; fingerprintMatches: boolean };
  suggestedMapping: Record<string, string | null>;
  availableFields: AvailableField[];
  parseErrors: string[];
}

interface DiffNew { rowIndex: number; key: string; address: string; postalCode: string; city: string; name: string; objectNumber: string }
interface DiffChanged { rowIndex: number; key: string; objectId: string; address: string; postalCode: string; city: string; name: string; objectNumber: string; changes: Record<string, { old: string; new: string }> }
interface DiffMissing { id: string; name: string; address: string | null; postalCode: string | null; city: string | null; objectNumber: string | null; reconciliationFlag: string | null }
interface DiffInvalid { rowIndex: number; reason: string; raw: Record<string, string> }
interface DiffDuplicate { key: string; winnerRowIndex: number; excludedRowIndices: number[]; addressPreview: string }
interface DiffResponse {
  summary: { totalFileRows: number; validFileRows: number; newCount: number; changedCount: number; missingCount: number; unchangedCount: number; duplicateGroupCount: number; duplicateExcludedCount: number; invalidCount: number };
  new: DiffNew[];
  changed: DiffChanged[];
  missing: DiffMissing[];
  duplicates: DiffDuplicate[];
  invalid: DiffInvalid[];
}

interface CommitResponse {
  batchId: string;
  createdCount: number;
  updatedCount: number;
  flaggedCount: number;
  missingTotal: number;
  totalRows: number;
}

const FIELD_LABELS_SV: Record<string, string> = {
  postalCode: "Postnummer",
  city: "Ort",
  name: "Namn",
  objectNumber: "Externt ID",
};

export default function CustomerFastighetslistaImport() {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("select-customer");
  const [customerId, setCustomerId] = useState<string>("");
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string | null>>({});
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [selectedNew, setSelectedNew] = useState<Set<number>>(new Set());
  // Per-fält-godkännande: objectId → Set(fieldName). Förvald: alla fält i alla
  // changed-rader markerade.
  const [selectedFields, setSelectedFields] = useState<Record<string, Set<string>>>({});
  const [flagMissing, setFlagMissing] = useState(true);
  const [saveMapping, setSaveMapping] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CommitResponse | null>(null);

  const customersQuery = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const selectedCustomer = useMemo(() => customersQuery.data?.find(c => c.id === customerId) || null, [customersQuery.data, customerId]);

  // Antal valda changed-rader (rader där minst ett fält är ikryssat)
  const selectedChangedCount = useMemo(
    () => Object.values(selectedFields).filter(s => s.size > 0).length,
    [selectedFields]
  );

  const runDiff = useCallback(async (currentColumnMap?: Record<string, string | null>, currentPreview?: PreviewResponse) => {
    const p = currentPreview ?? preview;
    const cm = currentColumnMap ?? columnMap;
    if (!p) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/import/customer-fastighetslista/diff", {
        customerId,
        columnMap: cm,
        rows: p.rows,
      });
      const data: DiffResponse = await res.json();
      setDiff(data);
      setSelectedNew(new Set(data.new.map(n => n.rowIndex)));
      // Förvald: alla fält i alla rader
      const fields: Record<string, Set<string>> = {};
      for (const c of data.changed) {
        fields[c.objectId] = new Set(Object.keys(c.changes));
      }
      setSelectedFields(fields);
      setStep("diff");
    } catch (err: any) {
      toast({ title: "Fel vid avstämning", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [preview, columnMap, customerId, toast]);

  const handleFileChange = useCallback(async (selected: File) => {
    if (!customerId) return;
    setFile(selected);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", selected);
      fd.append("customerId", customerId);
      const res = await fetch("/api/import/customer-fastighetslista/preview", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte läsa filen");
      const data: PreviewResponse = await res.json();
      setPreview(data);

      // Förvald mappning: sparad om användbar, annars AI-förslag
      const initial: Record<string, string | null> = {};
      const useSaved = data.savedMapping?.usable;
      for (const f of data.availableFields) {
        initial[f.key] = useSaved
          ? ((data.savedMapping!.columnMap[f.key] as string | null) ?? null)
          : (data.suggestedMapping[f.key] ?? null);
      }
      setColumnMap(initial);

      // Auto-hoppa direkt till diff om filens kolumn-layout är identisk
      // med när mappningen senast sparades (fingerprint-match).
      if (data.savedMapping?.fingerprintMatches && data.savedMapping?.usable && initial.address) {
        toast({
          title: "Identisk filstruktur upptäckt",
          description: `Hoppar direkt till avstämning — sparad mappning från ${format(new Date(data.savedMapping.lastUsedAt), "yyyy-MM-dd", { locale: sv })} används.`,
        });
        await runDiff(initial, data);
        return;
      }

      setStep("mapping");
      if (useSaved) {
        toast({ title: "Sparad mappning hittades", description: `Använder mappningen som sparades ${data.savedMapping!.lastUsedAt ? format(new Date(data.savedMapping!.lastUsedAt), "yyyy-MM-dd", { locale: sv }) : "tidigare"} för ${data.customer.name}` });
      }
    } catch (err: any) {
      toast({ title: "Fel vid uppladdning", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [customerId, toast, runDiff]);

  const runCommit = useCallback(async () => {
    if (!preview || !diff) return;
    setStep("importing");
    setLoading(true);
    try {
      // Serialisera per-fält-map till { [objectId]: [fieldName, ...] }
      const approvedChangedFields: Record<string, string[]> = {};
      for (const [oid, fset] of Object.entries(selectedFields)) {
        if (fset.size > 0) approvedChangedFields[oid] = Array.from(fset);
      }
      const res = await apiRequest("POST", "/api/import/customer-fastighetslista/commit", {
        customerId,
        columnMap,
        rows: preview.rows,
        headers: preview.columns,
        headerFingerprint: preview.headerFingerprint,
        approvedNewIndices: Array.from(selectedNew),
        approvedChangedFields,
        flagMissing,
        saveMapping,
      });
      const data: CommitResponse = await res.json();
      setResult(data);
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/import/batches"] });
      toast({ title: "Avstämning klar", description: `${data.createdCount} skapade, ${data.updatedCount} uppdaterade, ${data.flaggedCount} flaggade` });
    } catch (err: any) {
      toast({ title: "Importfel", description: err.message, variant: "destructive" });
      setStep("diff");
    } finally {
      setLoading(false);
    }
  }, [preview, diff, customerId, columnMap, selectedNew, selectedFields, flagMissing, saveMapping, toast]);

  const undoBatch = useCallback(async () => {
    if (!result?.batchId) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/import/customer-fastighetslista/undo", { batchId: result.batchId });
      const data = await res.json();
      toast({ title: "Avstämningen är backad", description: `${data.removedCount} borttagna, ${data.revertedCount} återställda, ${data.unflaggedCount} avflaggade` });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      handleReset();
    } catch (err: any) {
      toast({ title: "Kunde inte backa", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [result, toast]);

  const handleReset = useCallback(() => {
    setStep("select-customer");
    setCustomerId("");
    setFile(null);
    setPreview(null);
    setColumnMap({});
    setDiff(null);
    setSelectedNew(new Set());
    setSelectedFields({});
    setFlagMissing(true);
    setSaveMapping(true);
    setResult(null);
  }, []);

  // Hjälpare: toggle ett enskilt fält
  const toggleField = useCallback((objectId: string, field: string, on: boolean) => {
    setSelectedFields(prev => {
      const next = { ...prev };
      const set = new Set(next[objectId] || []);
      if (on) set.add(field); else set.delete(field);
      next[objectId] = set;
      return next;
    });
  }, []);

  // Hjälpare: toggle alla fält i en rad
  const toggleAllFieldsForRow = useCallback((cr: DiffChanged, on: boolean) => {
    setSelectedFields(prev => ({
      ...prev,
      [cr.objectId]: on ? new Set(Object.keys(cr.changes)) : new Set(),
    }));
  }, []);

  // Hjälpare: räkna alla individuella fält-checkboxar (för "Markera alla")
  const totalChangedFields = useMemo(() => {
    if (!diff) return 0;
    return diff.changed.reduce((acc, c) => acc + Object.keys(c.changes).length, 0);
  }, [diff]);
  const selectedFieldsTotal = useMemo(
    () => Object.values(selectedFields).reduce((acc, s) => acc + s.size, 0),
    [selectedFields]
  );

  const steps = ["select-customer", "upload", "mapping", "diff", "done"] as const;
  const stepLabels = ["Kund", "Ladda fil", "Mappning", "Granska", "Klart"];
  const stepIdx = steps.indexOf(step === "importing" ? "diff" : step);

  return (
    <div className="space-y-4" data-testid="customer-fastighetslista-import">
      <Card className="border-chart-1/20 dark:border-chart-1/80 bg-chart-1/10 dark:bg-chart-1/15">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Building2 className="h-5 w-5 text-chart-1 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Årlig fastighetslista från kund</p>
              <p className="text-sm text-muted-foreground">
                Ladda upp Excel/CSV med kundens fastigheter (1-2 ggr/år). Systemet matchar på <strong>adress + ort</strong> och visar
                nya, ändrade och saknade objekt. Saknade objekt flaggas — inget tas bort automatiskt. Kolumnmappningen sparas per kund och återanvänds nästa år.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Steg-indikator */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              i === stepIdx ? "bg-primary text-primary-foreground" :
              i < stepIdx ? "bg-chart-2 text-white" :
              "bg-muted text-muted-foreground"
            }`}>
              {i < stepIdx ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <span className="text-sm font-medium hidden sm:inline">{label}</span>
            {i < stepLabels.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Steg 1: Välj kund */}
      {step === "select-customer" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Välj kund</CardTitle>
            <CardDescription>Välj vilken kunds fastighetslista du laddar upp.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Popover open={customerSearchOpen} onOpenChange={setCustomerSearchOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between" data-testid="button-select-customer">
                  {selectedCustomer ? selectedCustomer.name : "Sök kund..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Sök kund..." data-testid="input-customer-search" />
                  <CommandList>
                    <CommandEmpty>Ingen kund hittades.</CommandEmpty>
                    <CommandGroup>
                      {(customersQuery.data || []).map(c => (
                        <CommandItem key={c.id} value={c.name} onSelect={() => { setCustomerId(c.id); setCustomerSearchOpen(false); }} data-testid={`option-customer-${c.id}`}>
                          <Check className={`mr-2 h-4 w-4 ${customerId === c.id ? "opacity-100" : "opacity-0"}`} />
                          {c.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <div className="flex justify-end">
              <Button disabled={!customerId} onClick={() => setStep("upload")} data-testid="button-customer-continue">
                Fortsätt
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Steg 2: Upload */}
      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Ladda upp fastighetslista</CardTitle>
            <CardDescription>Excel (.xlsx) eller CSV. Första raden ska vara kolumnrubriker.</CardDescription>
          </CardHeader>
          <CardContent className="text-center py-8">
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <input
              type="file" accept=".xlsx,.xls,.csv" className="hidden" id="fl-upload"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChange(f); }}
            />
            <label htmlFor="fl-upload">
              <Button asChild disabled={loading} data-testid="button-upload-fl">
                <span>{loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}Välj fil</span>
              </Button>
            </label>
            <div className="mt-4">
              <Button variant="ghost" size="sm" onClick={() => setStep("select-customer")}>
                <RotateCcw className="h-3 w-3 mr-2" />Byt kund
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Steg 3: Mappning */}
      {step === "mapping" && preview && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Kolumnmappning för {preview.customer.name}</CardTitle>
              <CardDescription>
                {preview.savedMapping?.usable
                  ? <>Sparad mappning från {format(new Date(preview.savedMapping.lastUsedAt), "yyyy-MM-dd", { locale: sv })} förvald. Justera vid behov.</>
                  : preview.savedMapping
                    ? <>Sparad mappning finns men en kolumn saknas i denna fil — använder AI-förslag istället.</>
                    : <>Ingen sparad mappning. AI-förslag förvalt. Mappningen sparas automatiskt när du bekräftar.</>}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {preview.availableFields.map(field => (
                <div key={field.key} className="flex items-center gap-3" data-testid={`mapping-${field.key}`}>
                  <Label className="w-64 shrink-0 text-sm">
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  <Select
                    value={columnMap[field.key] || "_none"}
                    onValueChange={(v) => setColumnMap(m => ({ ...m, [field.key]: v === "_none" ? null : v }))}
                  >
                    <SelectTrigger className="flex-1" data-testid={`select-${field.key}`}>
                      <SelectValue placeholder="— Omappad —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">— Omappad —</SelectItem>
                      {preview.columns.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Förhandsgranskning ({preview.sampleRows.length} av {preview.totalRows} rader)</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-48">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      {preview.columns.slice(0, 8).map(col => (
                        <th key={col} className="p-1 text-left font-medium">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {preview.columns.slice(0, 8).map(c => (
                          <td key={c} className="p-1 truncate max-w-32">{row[c] || ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("upload")} data-testid="button-back-upload"><RotateCcw className="h-4 w-4 mr-2" />Ladda annan fil</Button>
            <Button onClick={() => runDiff()} disabled={loading || !columnMap.address} data-testid="button-run-diff">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
              Stäm av mot Traivo
            </Button>
          </div>
        </div>
      )}

      {/* Steg 4: Diff */}
      {step === "diff" && diff && preview && (
        <div className="space-y-4">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <Card><CardContent className="p-3"><div className="text-2xl font-bold">{diff.summary.totalFileRows}</div><div className="text-xs text-muted-foreground">Rader i fil</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-2xl font-bold text-chart-2" data-testid="text-new-count">{diff.summary.newCount}</div><div className="text-xs text-muted-foreground">Nya</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-2xl font-bold text-chart-4" data-testid="text-changed-count">{diff.summary.changedCount}</div><div className="text-xs text-muted-foreground">Ändrade</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className={`text-2xl font-bold ${diff.summary.missingCount > 0 ? "text-warning" : ""}`} data-testid="text-missing-count">{diff.summary.missingCount}</div><div className="text-xs text-muted-foreground">Saknas i fil</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className={`text-2xl font-bold ${diff.summary.invalidCount > 0 ? "text-destructive" : "text-chart-2"}`}>{diff.summary.invalidCount}</div><div className="text-xs text-muted-foreground">Felaktiga</div></CardContent></Card>
          </div>

          {diff.summary.duplicateGroupCount > 0 && (
            <Card className="border-warning/30 bg-warning/10">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Copy className="h-4 w-4 text-warning mt-0.5" />
                  <div className="text-sm flex-1">
                    <strong>{diff.summary.duplicateGroupCount} adresser förekommer flera gånger.</strong>{" "}
                    <span className="text-muted-foreground">
                      Första raden i varje grupp används (winner) — {diff.summary.duplicateExcludedCount} duplikat-rad{diff.summary.duplicateExcludedCount === 1 ? "" : "er"} hoppas över.
                      Om fel rad valts: redigera filen så att önskad rad ligger först och ladda upp igen.
                    </span>
                  </div>
                </div>
                <ScrollArea className="max-h-32 border rounded bg-background/50 p-2">
                  <div className="space-y-1 text-xs">
                    {diff.duplicates.slice(0, 50).map(d => (
                      <div key={d.key} data-testid={`duplicate-group-${d.key}`}>
                        <span className="font-medium">{d.addressPreview || d.key}</span> —{" "}
                        <span className="text-chart-2">rad {d.winnerRowIndex + 2} används</span>,{" "}
                        <span className="text-muted-foreground">hoppar över rad {d.excludedRowIndices.map(i => i + 2).join(", ")}</span>
                      </div>
                    ))}
                    {diff.duplicates.length > 50 && (
                      <div className="text-muted-foreground">…och {diff.duplicates.length - 50} till</div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="new">
            <TabsList>
              <TabsTrigger value="new" data-testid="tab-diff-new"><Plus className="h-3 w-3 mr-1" />Nya ({diff.new.length})</TabsTrigger>
              <TabsTrigger value="changed" data-testid="tab-diff-changed">Ändrade ({diff.changed.length})</TabsTrigger>
              <TabsTrigger value="missing" data-testid="tab-diff-missing"><Flag className="h-3 w-3 mr-1" />Saknas ({diff.missing.length})</TabsTrigger>
              {diff.invalid.length > 0 && <TabsTrigger value="invalid" data-testid="tab-diff-invalid"><FileWarning className="h-3 w-3 mr-1" />Fel ({diff.invalid.length})</TabsTrigger>}
            </TabsList>

            <TabsContent value="new">
              <Card><CardContent className="p-2">
                {diff.new.length === 0 ? <p className="text-sm text-muted-foreground p-4 text-center">Inga nya objekt — alla i filen finns redan i Traivo.</p> :
                <>
                  <div className="flex items-center justify-between p-2 border-b">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selectedNew.size === diff.new.length}
                        onCheckedChange={(c) => setSelectedNew(c ? new Set(diff.new.map(n => n.rowIndex)) : new Set())}
                        data-testid="checkbox-select-all-new"
                      />
                      <Label className="text-sm">Markera alla</Label>
                    </div>
                    <Badge variant="secondary">{selectedNew.size} valda</Badge>
                  </div>
                  <ScrollArea className="h-80">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Adress</TableHead>
                        <TableHead>Postnr</TableHead>
                        <TableHead>Ort</TableHead>
                        <TableHead>Namn</TableHead>
                        <TableHead>Externt ID</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {diff.new.map(n => (
                          <TableRow key={n.rowIndex} data-testid={`row-new-${n.rowIndex}`}>
                            <TableCell><Checkbox
                              checked={selectedNew.has(n.rowIndex)}
                              onCheckedChange={(c) => setSelectedNew(s => { const next = new Set(s); if (c) next.add(n.rowIndex); else next.delete(n.rowIndex); return next; })}
                            /></TableCell>
                            <TableCell className="text-sm">{n.address}</TableCell>
                            <TableCell className="text-xs">{n.postalCode}</TableCell>
                            <TableCell className="text-xs">{n.city}</TableCell>
                            <TableCell className="text-xs">{n.name}</TableCell>
                            <TableCell className="text-xs">{n.objectNumber}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </>}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="changed">
              <Card><CardContent className="p-2">
                {diff.changed.length === 0 ? <p className="text-sm text-muted-foreground p-4 text-center">Inga ändringar att granska.</p> :
                <>
                  <div className="flex items-center justify-between p-2 border-b">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={selectedFieldsTotal === totalChangedFields && totalChangedFields > 0}
                        onCheckedChange={(c) => {
                          if (c) {
                            const all: Record<string, Set<string>> = {};
                            for (const cr of diff.changed) all[cr.objectId] = new Set(Object.keys(cr.changes));
                            setSelectedFields(all);
                          } else {
                            setSelectedFields({});
                          }
                        }}
                        data-testid="checkbox-select-all-changed"
                      />
                      <Label className="text-sm">Markera alla fält</Label>
                    </div>
                    <Badge variant="secondary">{selectedFieldsTotal} av {totalChangedFields} fält valda</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground p-2 border-b">
                    Per-fält-granskning — välj exakt vilka fält som ska skrivas över. Avmarkera enskilda fält du vill behålla orörda.
                  </p>
                  <ScrollArea className="h-96">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Adress</TableHead>
                        <TableHead>Ändringar (markera per fält)</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {diff.changed.map(cr => {
                          const fieldSet = selectedFields[cr.objectId] || new Set<string>();
                          const allFieldsForRow = Object.keys(cr.changes);
                          const allSelected = allFieldsForRow.length > 0 && allFieldsForRow.every(f => fieldSet.has(f));
                          const someSelected = allFieldsForRow.some(f => fieldSet.has(f));
                          return (
                            <TableRow key={cr.key} data-testid={`row-changed-${cr.objectId}`}>
                              <TableCell className="align-top pt-3">
                                <Checkbox
                                  checked={allSelected ? true : (someSelected ? "indeterminate" : false)}
                                  onCheckedChange={(v) => toggleAllFieldsForRow(cr, !!v)}
                                  data-testid={`checkbox-row-changed-${cr.objectId}`}
                                />
                              </TableCell>
                              <TableCell className="text-sm align-top pt-3">{cr.address}{cr.city ? `, ${cr.city}` : ""}</TableCell>
                              <TableCell className="text-xs">
                                <div className="space-y-1.5">
                                  {Object.entries(cr.changes).map(([field, ch]) => {
                                    const checked = fieldSet.has(field);
                                    return (
                                      <label key={field} className="flex items-center gap-2 cursor-pointer">
                                        <Checkbox
                                          checked={checked}
                                          onCheckedChange={(v) => toggleField(cr.objectId, field, !!v)}
                                          data-testid={`checkbox-field-${cr.objectId}-${field}`}
                                        />
                                        <span className="font-medium w-24 shrink-0">{FIELD_LABELS_SV[field] || field}:</span>
                                        <span className={`text-muted-foreground line-through ${!checked ? "opacity-50" : ""}`}>{ch.old || "—"}</span>
                                        <ArrowRight className="h-3 w-3 inline shrink-0 text-muted-foreground" />
                                        <span className={checked ? "text-chart-2" : "text-muted-foreground line-through opacity-50"}>{ch.new}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </>}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="missing">
              <Card>
                <CardContent className="p-2">
                  <div className="flex items-center gap-2 p-2 border-b">
                    <Checkbox checked={flagMissing} onCheckedChange={(c) => setFlagMissing(!!c)} data-testid="checkbox-flag-missing" />
                    <Label className="text-sm">Flagga dessa objekt som "saknas i fastighetslista" för manuell granskning</Label>
                  </div>
                  {diff.missing.length === 0 ? <p className="text-sm text-muted-foreground p-4 text-center">Inga saknade objekt.</p> :
                  <ScrollArea className="h-80">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Namn</TableHead>
                        <TableHead>Adress</TableHead>
                        <TableHead>Externt ID</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {diff.missing.map(m => (
                          <TableRow key={m.id} data-testid={`row-missing-${m.id}`}>
                            <TableCell className="text-sm">{m.name}</TableCell>
                            <TableCell className="text-xs">{[m.address, m.postalCode, m.city].filter(Boolean).join(", ") || "—"}</TableCell>
                            <TableCell className="text-xs">{m.objectNumber || "—"}</TableCell>
                            <TableCell>{m.reconciliationFlag ? <Badge variant="outline" className="text-xs">Redan flaggad</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>}
                </CardContent>
              </Card>
            </TabsContent>

            {diff.invalid.length > 0 && (
              <TabsContent value="invalid">
                <Card><CardContent className="p-2">
                  <ScrollArea className="h-80">
                    <Table>
                      <TableHeader><TableRow><TableHead>Rad</TableHead><TableHead>Orsak</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {diff.invalid.map(i => (
                          <TableRow key={i.rowIndex}>
                            <TableCell className="text-xs">{i.rowIndex + 2}</TableCell>
                            <TableCell className="text-xs text-destructive">{i.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent></Card>
              </TabsContent>
            )}
          </Tabs>

          <Card>
            <CardContent className="p-3 flex items-center gap-3">
              <Checkbox checked={saveMapping} onCheckedChange={(c) => setSaveMapping(!!c)} data-testid="checkbox-save-mapping" />
              <Label className="text-sm">Spara kolumnmappningen för {preview.customer.name} (återanvänds nästa gång)</Label>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("mapping")}><RotateCcw className="h-4 w-4 mr-2" />Tillbaka till mappning</Button>
            <Button onClick={runCommit} disabled={loading || (selectedNew.size === 0 && selectedChangedCount === 0 && !flagMissing)} data-testid="button-commit-import">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Genomför avstämning
            </Button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <Card><CardContent className="p-8 text-center">
          <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
          <h3 className="text-lg font-semibold">Avstämning pågår...</h3>
        </CardContent></Card>
      )}

      {step === "done" && result && (
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 mx-auto text-chart-2" />
            <h3 className="text-lg font-semibold">Avstämning klar!</h3>
            <div className="grid gap-2 grid-cols-3 max-w-md mx-auto">
              <div><div className="text-2xl font-bold text-chart-2" data-testid="result-created">{result.createdCount}</div><div className="text-xs text-muted-foreground">Skapade</div></div>
              <div><div className="text-2xl font-bold text-chart-4" data-testid="result-updated">{result.updatedCount}</div><div className="text-xs text-muted-foreground">Uppdaterade</div></div>
              <div><div className="text-2xl font-bold text-warning" data-testid="result-flagged">{result.flaggedCount}</div><div className="text-xs text-muted-foreground">Flaggade</div></div>
            </div>
            <p className="text-xs text-muted-foreground">Batch-ID: <code>{result.batchId}</code></p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={undoBatch} disabled={loading} data-testid="button-undo-batch">
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Undo2 className="h-4 w-4 mr-2" />}
                Backa avstämningen
              </Button>
              <Button onClick={handleReset} data-testid="button-new-import"><Plus className="h-4 w-4 mr-2" />Ny avstämning</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
