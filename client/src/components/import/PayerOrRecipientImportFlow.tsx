// Task #566 — Frontend för massimport av betalare (object_payers) och
// fakturamottagare (invoice_recipients). Återanvänder ChildObjectImportFlow:s
// paste/CSV-mönster men kallar två separata endpoints.
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Upload, Wallet, Receipt, FileUp } from "lucide-react";
import Papa from "papaparse";

type ImportKind = "payers" | "recipients";

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

const HEADERS: Record<ImportKind, readonly string[]> = {
  payers: [
    "objectNumber", "customerNumber", "payerType", "isPrimary",
    "sharePercent", "validFrom", "validTo", "invoiceReference",
    "fortnoxCustomerId", "notes",
  ] as const,
  recipients: [
    "customerNumber", "level", "recipientName", "recipientEmail",
    "recipientAddress", "recipientPostalCode", "recipientCity", "recipientReference", "fortnoxCustomerId",
    "validFrom", "validTo", "priority", "breaksInheritance", "notes",
  ] as const,
};

const HEADER_ALIASES: Record<ImportKind, Record<string, string>> = {
  payers: {
    objektnummer: "objectNumber",
    objectnumber: "objectNumber",
    kundnummer: "customerNumber",
    customernumber: "customerNumber",
    typ: "payerType",
    payertype: "payerType",
    primar: "isPrimary",
    primär: "isPrimary",
    isprimary: "isPrimary",
    andel: "sharePercent",
    sharepercent: "sharePercent",
    startdatum: "validFrom",
    validfrom: "validFrom",
    slutdatum: "validTo",
    validto: "validTo",
    fakturareferens: "invoiceReference",
    invoicereference: "invoiceReference",
    fortnoxkundid: "fortnoxCustomerId",
    fortnoxcustomerid: "fortnoxCustomerId",
    anteckningar: "notes",
    notes: "notes",
  },
  recipients: {
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
  },
};

const BOOL_FIELDS: Record<ImportKind, Set<string>> = {
  payers: new Set(["isPrimary"]),
  recipients: new Set(["breaksInheritance"]),
};
const NUMBER_FIELDS: Record<ImportKind, Set<string>> = {
  payers: new Set(["sharePercent"]),
  recipients: new Set(["priority"]),
};

function coerceValue(field: string, value: string, kind: ImportKind): any {
  if (BOOL_FIELDS[kind].has(field)) {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "ja" || v === "yes";
  }
  if (NUMBER_FIELDS[kind].has(field)) {
    const n = Number(value.replace(",", "."));
    return isNaN(n) ? undefined : n;
  }
  return value.trim();
}

function parsePastedRows(text: string, kind: ImportKind): Array<Record<string, any>> {
  const headers = HEADERS[kind];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines
    .map(l => {
      const cells = l.includes("\t") ? l.split("\t") : l.split(",");
      const r: Record<string, any> = {};
      headers.forEach((h, i) => {
        if (cells[i] !== undefined && cells[i] !== "") {
          r[h] = coerceValue(h, cells[i], kind);
        }
      });
      return r;
    })
    .filter(r => kind === "payers" ? r.objectNumber && r.customerNumber : r.customerNumber && r.recipientName);
}

function parseCsvRows(text: string, kind: ImportKind): Array<Record<string, any>> {
  const aliases = HEADER_ALIASES[kind];
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  });
  return (parsed.data || [])
    .map(row => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        const key = aliases[k.toLowerCase().trim()] ?? (HEADERS[kind] as readonly string[]).find(h => h.toLowerCase() === k.toLowerCase().trim());
        if (key && v != null && String(v).trim() !== "") {
          out[key] = coerceValue(key, String(v), kind);
        }
      }
      return out;
    })
    .filter(r => kind === "payers" ? r.objectNumber && r.customerNumber : r.customerNumber && r.recipientName);
}

export function PayerOrRecipientImportFlow({ kind }: { kind: ImportKind }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [text, setText] = useState("");
  const [fileRows, setFileRows] = useState<Array<Record<string, any>> | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const endpoint = kind === "payers"
    ? "/api/object-payers/import"
    : "/api/invoice-recipients/import";

  const title = kind === "payers" ? "Importera betalare" : "Importera fakturamottagare";
  const description = kind === "payers"
    ? "Massimport av betalare per objekt (ADR v3 — object_payers). Validerar att objekt och kund finns, samt att primär betalare inte överlappar med befintlig period."
    : "Massimport av fakturamottagare (ADR v3 — invoice_recipients). Validerar att kunden redan är registrerad som betalare i systemet.";
  const Icon = kind === "payers" ? Wallet : Receipt;
  const testIdRoot = kind === "payers" ? "payers" : "recipients";

  const headers = HEADERS[kind];
  const currentRows = useMemo(
    () => (mode === "paste" ? parsePastedRows(text, kind) : fileRows ?? []),
    [mode, text, fileRows, kind],
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
        if (kind === "payers") {
          queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
        }
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
    const rows = parseCsvRows(text, kind);
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
            <Icon className="h-4 w-4" /> {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
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
                <code className="px-1 bg-muted rounded">{headers.join(", ")}</code>
              </div>
              <Textarea
                value={text}
                onChange={e => {
                  setText(e.target.value);
                  setPreview(null);
                }}
                rows={8}
                placeholder={kind === "payers"
                  ? "GRN001-1\tTELGE001\tprimary\ttrue\t100\t2026-01-01"
                  : "TELGE001\tcentral\tTelge Ekonomi\tekonomi@telge.se"}
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
                <code className="px-1 bg-muted rounded">{headers.join(", ")}</code>{" "}
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
                      {kind === "payers"
                        ? `${p.objectNumber} → ${p.customerNumber}${p.isPrimary ? " (primär)" : ""}`
                        : `${p.customerNumber} · ${p.level} · ${p.recipientName}`}
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
