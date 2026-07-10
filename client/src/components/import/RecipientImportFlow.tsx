// Task #566 — Frontend för massimport av fakturamottagare (invoice_recipients).
// Återanvänder ChildObjectImportFlow:s paste/CSV-mönster.
// (Etapp 5: betalarimporten (object_payers) borttagen — betalare hanteras via Ekonomi-metadata.)
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Upload, Receipt, FileUp } from "lucide-react";
import Papa from "papaparse";

type PreviewResult = {
  dryRun: true;
  batchId: string;
  valid: number;
  invalid: number;
  errors: Array<{ index: number; message: string }>;
  preview: Array<Record<string, any>>;
};
type CommitResult = {
  dryRun: false;
  batchId: string;
  created: number;
  ids?: string[];
  idempotent?: boolean;
};

const HEADERS = [
  "customerNumber", "level", "recipientName", "recipientEmail",
  "recipientAddress", "recipientPostalCode", "recipientCity", "recipientReference", "fortnoxCustomerId",
  "validFrom", "validTo", "priority", "breaksInheritance", "notes",
] as const;

const HEADER_ALIASES: Record<string, string> = {
  kundnummer: "customerNumber",
  customernumber: "customerNumber",
  niva: "level",
  nivå: "level",
  level: "level",
  namn: "recipientName",
  mottagare: "recipientName",
  recipientname: "recipientName",
  epost: "recipientEmail",
  email: "recipientEmail",
  recipientemail: "recipientEmail",
  adress: "recipientAddress",
  recipientaddress: "recipientAddress",
  postnummer: "recipientPostalCode",
  recipientpostalcode: "recipientPostalCode",
  ort: "recipientCity",
  stad: "recipientCity",
  recipientcity: "recipientCity",
  referens: "recipientReference",
  recipientreference: "recipientReference",
  fortnoxkundid: "fortnoxCustomerId",
  fortnoxcustomerid: "fortnoxCustomerId",
  startdatum: "validFrom",
  validfrom: "validFrom",
  slutdatum: "validTo",
  validto: "validTo",
  prioritet: "priority",
  priority: "priority",
  bryterarv: "breaksInheritance",
  breaksinheritance: "breaksInheritance",
  anteckningar: "notes",
  notes: "notes",
};

const BOOL_FIELDS = new Set(["breaksInheritance"]);
const NUMBER_FIELDS = new Set(["priority"]);

function coerceValue(field: string, value: string): any {
  if (BOOL_FIELDS.has(field)) {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "ja" || v === "yes";
  }
  if (NUMBER_FIELDS.has(field)) {
    const n = Number(value.replace(",", "."));
    return isNaN(n) ? undefined : n;
  }
  return value.trim();
}

function parsePastedRows(text: string): Array<Record<string, any>> {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines
    .map(l => {
      const cells = l.includes("\t") ? l.split("\t") : l.split(",");
      const r: Record<string, any> = {};
      HEADERS.forEach((h, i) => {
        if (cells[i] !== undefined && cells[i] !== "") {
          r[h] = coerceValue(h, cells[i]);
        }
      });
      return r;
    })
    .filter(r => r.customerNumber && r.recipientName);
}

function parseCsvRows(text: string): Array<Record<string, any>> {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  });
  return (parsed.data || [])
    .map(row => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        const key = HEADER_ALIASES[k.toLowerCase().trim()] ?? (HEADERS as readonly string[]).find(h => h.toLowerCase() === k.toLowerCase().trim());
        if (key && v != null && String(v).trim() !== "") {
          out[key] = coerceValue(key, String(v));
        }
      }
      return out;
    })
    .filter(r => r.customerNumber && r.recipientName);
}

export function RecipientImportFlow() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [text, setText] = useState("");
  const [fileRows, setFileRows] = useState<Array<Record<string, any>> | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const endpoint = "/api/invoice-recipients/import";
  const testIdRoot = "recipients";

  const currentRows = useMemo(
    () => (mode === "paste" ? parsePastedRows(text) : fileRows ?? []),
    [mode, text, fileRows],
  );

  const mut = useMutation({
    mutationFn: async (dryRun: boolean) => {
      if (currentRows.length === 0) throw new Error("Inga rader hittades");
      const res = await apiRequest("POST", endpoint, { rows: currentRows, dryRun });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Importfel");
      }
      return res.json() as Promise<PreviewResult | CommitResult>;
    },
    onSuccess: r => {
      if (r.dryRun) {
        setPreview(r);
        toast({ title: "Förhandsvisning", description: `${r.valid} OK, ${r.invalid} fel.` });
      } else {
        toast({ title: "Importerat", description: `${r.created} rader skapade.` });
        setText("");
        setFileRows(null);
        setFileName("");
        setPreview(null);
        queryClient.invalidateQueries({ queryKey: ["/api/import/history"] });
      }
    },
    onError: (e: any) => toast({
      title: "Fel",
      description: e?.message ?? "Kunde inte importera",
      variant: "destructive",
    }),
  });

  const onFile = async (f: File) => {
    setFileName(f.name);
    const text = await f.text();
    const rows = parseCsvRows(text);
    setFileRows(rows);
    setPreview(null);
    if (rows.length === 0) {
      toast({
        title: "Inga giltiga rader",
        description: "Filen verkar tom eller saknar obligatoriska kolumner.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Importera fakturamottagare
          </CardTitle>
          <CardDescription>
            Massimport av fakturamottagare (ADR v3 — invoice_recipients). Validerar att kunden redan finns registrerad i systemet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={mode} onValueChange={v => setMode(v as "paste" | "file")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="paste" data-testid={`tab-${testIdRoot}-import-paste`}>Klistra in</TabsTrigger>
              <TabsTrigger value="file" data-testid={`tab-${testIdRoot}-import-file`}>CSV-fil</TabsTrigger>
            </TabsList>
            <TabsContent value="paste" className="space-y-2 mt-3">
              <div className="text-xs text-muted-foreground">
                Kolumner i ordning:{" "}
                <code className="px-1 bg-muted rounded">{HEADERS.join(", ")}</code>
              </div>
              <Textarea
                value={text}
                onChange={e => {
                  setText(e.target.value);
                  setPreview(null);
                }}
                rows={8}
                placeholder={"TELGE001\tcentral\tTelge Ekonomi\tekonomi@telge.se"}
                className="font-mono text-xs"
                data-testid={`input-${testIdRoot}-import-rows`}
              />
              <div className="text-xs text-muted-foreground">
                {currentRows.length} rad(er) tolkade
              </div>
            </TabsContent>
            <TabsContent value="file" className="space-y-2 mt-3">
              <div className="text-xs text-muted-foreground">
                Förväntade kolumner (header):{" "}
                <code className="px-1 bg-muted rounded">{HEADERS.join(", ")}</code>{" "}
                eller svenska motsvarigheter.
              </div>
              <div className="rounded-lg border border-dashed p-6 text-center">
                <FileUp className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <input
                  id={`${testIdRoot}-import-file`}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                  }}
                  data-testid={`input-${testIdRoot}-import-file`}
                />
                <label htmlFor={`${testIdRoot}-import-file`}>
                  <Button asChild variant="outline" size="sm">
                    <span>Välj CSV-fil</span>
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
              onClick={() => mut.mutate(true)}
              disabled={mut.isPending || currentRows.length === 0}
              data-testid={`button-preview-${testIdRoot}`}
            >
              <Eye className="h-4 w-4 mr-2" /> Förhandsvisa
            </Button>
            <Button
              onClick={() => mut.mutate(false)}
              disabled={
                mut.isPending ||
                currentRows.length === 0 ||
                (preview ? preview.invalid > 0 : false)
              }
              data-testid={`button-import-${testIdRoot}`}
            >
              <Upload className="h-4 w-4 mr-2" /> Importera {currentRows.length || ""}
            </Button>
          </div>

          {preview && (
            <div className="space-y-2 text-sm" data-testid={`text-${testIdRoot}-preview`}>
              <div className="flex flex-wrap gap-2">
                <Badge variant="default" className="bg-chart-2/15">{preview.valid} OK</Badge>
                {preview.invalid > 0 && <Badge variant="destructive">{preview.invalid} fel</Badge>}
              </div>
              {preview.errors.length > 0 && (
                <div className="border rounded p-2 bg-destructive/10 max-h-40 overflow-y-auto">
                  {preview.errors.map((e, i) => (
                    <div key={i} className="text-xs text-destructive">
                      Rad {e.index + 1}: {e.message}
                    </div>
                  ))}
                </div>
              )}
              {preview.preview.length > 0 && (
                <div className="border rounded p-2 max-h-40 overflow-y-auto">
                  {preview.preview.slice(0, 20).map((p, i) => (
                    <div key={i} className="text-xs">
                      {`${p.customerNumber} · ${p.level} · ${p.recipientName}`}
                    </div>
                  ))}
                  {preview.preview.length > 20 && (
                    <div className="text-xs text-muted-foreground">
                      … och {preview.preview.length - 20} till
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
