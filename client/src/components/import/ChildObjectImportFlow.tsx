// Task #564: Iterativ underobjekt-import som /import-flöde.
// Lyft upp paste-flödet från SubObjectImportPanel + lägg till parent-väljare
// och CSV/XLSX-stöd. Backend: POST /api/objects/:parentId/import-children.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Upload, FilePlus, Check, ChevronsUpDown, ExternalLink, FileUp } from "lucide-react";
import Papa from "papaparse";
import type { ServiceObject } from "@shared/schema";
import { ImportRowPreview } from "@/components/import/ImportRowPreview";
import { ImportTypeHistory } from "@/components/import/ImportTypeHistory";
import { DownloadTemplateButton } from "@/components/DownloadTemplateButton";

type PreviewResult = {
  dryRun: true;
  valid: number;
  invalid: number;
  errors: Array<{ index: number; message: string }>;
  preview: Array<{ index: number; name: string }>;
};
type CommitResult = { dryRun: false; created: number; ids: string[] };

const HEADER = ["name", "objectNumber", "hierarchyLevel", "address", "city", "postalCode"] as const;
const HEADER_ALIASES: Record<string, (typeof HEADER)[number]> = {
  namn: "name",
  name: "name",
  objektnummer: "objectNumber",
  objectnumber: "objectNumber",
  nummer: "objectNumber",
  niva: "hierarchyLevel",
  nivå: "hierarchyLevel",
  hierarchylevel: "hierarchyLevel",
  hierarki: "hierarchyLevel",
  adress: "address",
  address: "address",
  stad: "city",
  ort: "city",
  city: "city",
  postnummer: "postalCode",
  postalcode: "postalCode",
  zip: "postalCode",
};

function parsePastedRows(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines
    .map(l => {
      const cells = l.includes("\t") ? l.split("\t") : l.split(",");
      const r: Record<string, string> = {};
      HEADER.forEach((h, i) => {
        if (cells[i] !== undefined && cells[i] !== "") r[h] = cells[i].trim();
      });
      return r;
    })
    .filter(r => r.name);
}

function parseCsvRows(text: string): Array<Record<string, string>> {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
  });
  return (parsed.data || [])
    .map(row => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        const key = HEADER_ALIASES[k.toLowerCase().trim()];
        if (key && v != null && String(v).trim() !== "") out[key] = String(v).trim();
      }
      return out;
    })
    .filter(r => r.name);
}

export function ChildObjectImportFlow({
  initialParentId,
  onParentChanged,
}: {
  initialParentId?: string;
  onParentChanged?: (id: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [parentId, setParentId] = useState<string>(initialParentId ?? "");
  const [parentOpen, setParentOpen] = useState(false);
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [text, setText] = useState("");
  const [fileRows, setFileRows] = useState<Array<Record<string, string>> | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  useEffect(() => {
    if (initialParentId) setParentId(initialParentId);
  }, [initialParentId]);

  const objectsQuery = useQuery<ServiceObject[]>({ queryKey: ["/api/objects", "lookup"] });
  const parent = useMemo(
    () => objectsQuery.data?.find(o => o.id === parentId) || null,
    [objectsQuery.data, parentId],
  );

  const currentRows = useMemo(
    () => (mode === "paste" ? parsePastedRows(text) : fileRows ?? []),
    [mode, text, fileRows],
  );

  const mut = useMutation({
    mutationFn: async (dryRun: boolean) => {
      if (!parentId) throw new Error("Välj ett föräldraobjekt först");
      const rows = currentRows;
      if (rows.length === 0) throw new Error("Inga rader hittades");
      const res = await apiRequest("POST", `/api/objects/${parentId}/import-children`, { rows, dryRun });
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
        toast({ title: "Importerat", description: `${r.created} underobjekt skapade.` });
        setText("");
        setFileRows(null);
        setFileName("");
        setPreview(null);
        queryClient.invalidateQueries({ queryKey: ["/api/objects", parentId, "descendants"] });
        queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      }
    },
    onError: (e: any) => toast({ title: "Fel", description: e?.message ?? "Kunde inte importera", variant: "destructive" }),
  });

  const onFile = async (f: File) => {
    setFileName(f.name);
    const name = f.name.toLowerCase();
    const isXlsx = name.endsWith(".xlsx") || name.endsWith(".xls");
    try {
      let rows: Array<Record<string, string>> = [];
      if (isXlsx) {
        const ExcelJS = (await import("exceljs")).default;
        const buf = await f.arrayBuffer();
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const sheet = wb.worksheets[0];
        if (!sheet) throw new Error("Hittade inget kalkylblad");
        const cellToString = (val: unknown): string => {
          if (val === null || val === undefined) return "";
          if (val instanceof Date) return val.toISOString().split("T")[0];
          if (typeof val === "object" && val !== null) {
            if ("richText" in val) {
              return (val as { richText: Array<{ text?: string }> }).richText
                .map(r => r.text ?? "")
                .join("");
            }
            if ("formula" in val) {
              return String((val as { result?: unknown }).result ?? "");
            }
            if ("hyperlink" in val) {
              return (val as { text: string }).text;
            }
          }
          return String(val);
        };
        const aoa: string[][] = [];
        sheet.eachRow({ includeEmpty: false }, (row) => {
          const rowData: string[] = [];
          const colCount = sheet.columnCount || row.cellCount;
          for (let c = 1; c <= colCount; c++) {
            rowData.push(cellToString(row.getCell(c).value));
          }
          aoa.push(rowData);
        });
        // Filtrera bort vår markerade exempelrad om den finns kvar
        const filtered = aoa.filter(
          (r, idx) => idx === 0 || !(r[0] ?? "").startsWith("[EXEMPEL"),
        );
        if (filtered.length === 0) {
          rows = [];
        } else {
          const headers = filtered[0].map(h => h.trim());
          rows = filtered.slice(1).map(cells => {
            const out: Record<string, string> = {};
            headers.forEach((h, i) => {
              const key = HEADER_ALIASES[h.toLowerCase().trim()];
              const v = cells[i];
              if (key && v != null && String(v).trim() !== "") {
                out[key] = String(v).trim();
              }
            });
            return out;
          }).filter(r => r.name);
        }
      } else {
        const text = await f.text();
        rows = parseCsvRows(text);
      }
      setFileRows(rows);
      setPreview(null);
      if (rows.length === 0) {
        toast({
          title: "Inga giltiga rader",
          description: "Filen verkar tom eller saknar 'namn'-kolumn.",
          variant: "destructive",
        });
      }
    } catch (e: any) {
      setFileRows(null);
      toast({
        title: "Kunde inte läsa filen",
        description: e?.message ?? "Filen kunde inte tolkas.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <ImportTypeHistory
        importType="child-objects"
        description="Senaste underobjekt-importer per föräldraobjekt."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FilePlus className="h-4 w-4" /> Importera underobjekt
          </CardTitle>
          <CardDescription>
            Lägg till nya underobjekt under ett befintligt objekt. Adress, ort och postnummer
            ärvs från föräldraobjektet om de utelämnas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Föräldraobjekt</Label>
            <Popover open={parentOpen} onOpenChange={setParentOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between"
                  data-testid="button-select-parent"
                >
                  {parent ? (
                    <span className="truncate">
                      {parent.name}
                      {parent.objectNumber ? <span className="text-muted-foreground"> · {parent.objectNumber}</span> : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Välj objekt...</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Sök på namn eller objektnummer..." />
                  <CommandList>
                    <CommandEmpty>Inget objekt hittades.</CommandEmpty>
                    <CommandGroup>
                      {(objectsQuery.data || []).slice(0, 200).map(o => (
                        <CommandItem
                          key={o.id}
                          value={`${o.name} ${o.objectNumber ?? ""}`}
                          onSelect={() => {
                            setParentId(o.id);
                            setParentOpen(false);
                            onParentChanged?.(o.id);
                          }}
                          data-testid={`option-parent-${o.id}`}
                        >
                          <Check className={`mr-2 h-4 w-4 ${parentId === o.id ? "opacity-100" : "opacity-0"}`} />
                          <span className="truncate">
                            {o.name}
                            {o.objectNumber && <span className="text-muted-foreground"> · {o.objectNumber}</span>}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {parent && (
              <a
                href={`/objects/${parent.id}`}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                data-testid="link-open-parent"
              >
                <ExternalLink className="h-3 w-3" />
                Öppna föräldraobjekt
              </a>
            )}
          </div>

          <Tabs value={mode} onValueChange={v => setMode(v as "paste" | "file")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="paste" data-testid="tab-child-import-paste">Klistra in</TabsTrigger>
              <TabsTrigger value="file" data-testid="tab-child-import-file">CSV/Excel-fil</TabsTrigger>
            </TabsList>
            <TabsContent value="paste" className="space-y-2 mt-3">
              <div className="text-xs text-muted-foreground">
                Kolumner i ordning:{" "}
                <code className="px-1 bg-muted rounded">{HEADER.join(", ")}</code>
              </div>
              <Textarea
                value={text}
                onChange={e => {
                  setText(e.target.value);
                  setPreview(null);
                }}
                rows={8}
                placeholder={"Källare 1\t10101\tutrymme\nKällare 2\t10102\tutrymme"}
                className="font-mono text-xs"
                data-testid="input-child-import-rows"
              />
              <div className="text-xs text-muted-foreground">
                {parsePastedRows(text).length} rad(er) tolkade
              </div>
            </TabsContent>
            <TabsContent value="file" className="space-y-2 mt-3">
              <div className="text-xs text-muted-foreground">
                Förväntade kolumner (header):{" "}
                <code className="px-1 bg-muted rounded">{HEADER.join(", ")}</code>{" "}
                eller svenska motsvarigheter (namn, objektnummer, niva, adress, ort, postnummer).
              </div>
              <div className="flex justify-end">
                <DownloadTemplateButton type="barnobjekt" />
              </div>
              <div className="rounded-lg border border-dashed p-6 text-center">
                <FileUp className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <input
                  id="child-import-file"
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                  }}
                  data-testid="input-child-import-file"
                />
                <label htmlFor="child-import-file">
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
              onClick={() => mut.mutate(true)}
              disabled={mut.isPending || !parentId || currentRows.length === 0}
              data-testid="button-preview-children"
            >
              <Eye className="h-4 w-4 mr-2" /> Förhandsvisa
            </Button>
            <Button
              onClick={() => mut.mutate(false)}
              disabled={
                mut.isPending ||
                !parentId ||
                currentRows.length === 0 ||
                (preview ? preview.invalid > 0 : false)
              }
              data-testid="button-import-children"
            >
              <Upload className="h-4 w-4 mr-2" /> Importera {currentRows.length || ""}
            </Button>
          </div>

          {preview && (
            <ImportRowPreview
              valid={preview.valid}
              invalid={preview.invalid}
              errors={preview.errors}
              preview={preview.preview}
              testId="text-import-preview"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
