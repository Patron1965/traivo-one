// Task #1346: Resurs-import via CSV. Lyft ur den borttagna "Manuell CSV"-fliken
// eftersom resurser (chaufförer/tekniker) inte täcks av matchningsimporten
// (objekt) eller Kundlistan (kunder). Använder samma endpoint som tidigare:
// POST /api/import/resources.
import { useCallback, useMemo, useState } from "react";
import Papa from "papaparse";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertCircle, Check, CheckCircle, Download, FileUp, Loader2, Truck, Upload, X,
} from "lucide-react";

const HEADERS = ["namn", "initialer", "telefon", "epost", "hemort", "timmar", "kompetenser"];
const EXAMPLE_ROWS = [
  ["Anders Andersson", "AA", "070-1234567", "anders@kinab.se", "Södertälje", "40", "sophamtning,tungt"],
  ["Bella Bengtsson", "BB", "070-7654321", "bella@kinab.se", "Stockholm", "40", "sophamtning,matafall"],
];

interface ParsedRow {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
  isValid: boolean;
}

interface ImportResult {
  imported: number;
  errors: string[];
}

export function ResourceCsvImport() {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<ParsedRow[]>([]);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const previewStats = useMemo(() => {
    const valid = previewData.filter(r => r.isValid).length;
    return { valid, invalid: previewData.length - valid, total: previewData.length };
  }, [previewData]);

  const downloadTemplate = () => {
    const rows = [HEADERS, ...EXAMPLE_ROWS];
    const csv = rows.map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mall_resources.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Mall nedladdad", description: "mall_resources.csv" });
  };

  const parseFile = useCallback((file: File) => {
    setSelectedFile(file);
    setLastResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = results.data.map((row, index) => {
          const errors: string[] = [];
          if (!row.namn?.trim() && !row.name?.trim()) errors.push("Namn saknas");
          return { rowNumber: index + 2, data: row, errors, isValid: errors.length === 0 };
        });
        setPreviewData(parsed);
      },
      error: (error) => {
        toast({ title: "Kunde inte läsa fil", description: error.message, variant: "destructive" });
        setSelectedFile(null);
      },
    });
  }, [toast]);

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/import/resources", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Import misslyckades");
      }
      return response.json() as Promise<ImportResult>;
    },
    onSuccess: (result) => {
      setLastResult(result);
      setSelectedFile(null);
      setPreviewData([]);
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      toast({
        title: "Import klar",
        description: `${result.imported} resurser importerade${result.errors.length > 0 ? `, ${result.errors.length} fel` : ""}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Import misslyckades", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Importera resurser (CSV)
          </CardTitle>
          <CardDescription>
            Chaufförer och tekniker. Ladda ner mallen, fyll i en rad per resurs och ladda upp filen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" onClick={downloadTemplate} data-testid="button-download-template-resources">
            <Download className="h-4 w-4 mr-2" />
            Ladda ner mall_resources.csv
          </Button>

          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file && file.name.endsWith(".csv")) parseFile(file);
              else toast({ title: "Ogiltig fil", description: "Endast CSV-filer stöds", variant: "destructive" });
            }}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
            onClick={() => document.getElementById("file-input-resources")?.click()}
            data-testid="dropzone-resources"
          >
            <FileUp className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium mb-1">
              {isDragging ? "Släpp filen här" : "Dra och släpp CSV-fil här"}
            </p>
            <p className="text-xs text-muted-foreground mb-3">eller klicka för att välja fil</p>
            <Button variant="secondary" size="sm" data-testid="button-select-file-resources">
              Välj fil
            </Button>
            <input
              id="file-input-resources"
              type="file"
              accept=".csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) parseFile(file);
                e.target.value = "";
              }}
              className="hidden"
            />
          </div>

          <div className="bg-muted p-3 rounded-md">
            <p className="text-xs font-medium mb-1">Förväntade kolumner:</p>
            <code className="text-xs break-all text-muted-foreground">{HEADERS.join(", ")}</code>
          </div>
        </CardContent>
      </Card>

      {selectedFile && previewData.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Förhandsgranskning — {selectedFile.name}</CardTitle>
            <div className="flex items-center gap-3 pt-1">
              <Badge variant="secondary">Totalt: {previewStats.total} rader</Badge>
              <Badge variant="default" className="gap-1 bg-chart-2/15">
                <Check className="h-3 w-3" />
                Giltiga: {previewStats.valid}
              </Badge>
              {previewStats.invalid > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <X className="h-3 w-3" />
                  Ogiltiga: {previewStats.invalid}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ScrollArea className="max-h-64 border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Rad</TableHead>
                    <TableHead className="w-16">Status</TableHead>
                    {HEADERS.slice(0, 6).map((header) => (
                      <TableHead key={header} className="min-w-[100px]">{header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.slice(0, 100).map((row) => (
                    <TableRow key={row.rowNumber} className={!row.isValid ? "bg-destructive/10 dark:bg-destructive/15" : ""}>
                      <TableCell className="font-mono text-xs">{row.rowNumber}</TableCell>
                      <TableCell>
                        {row.isValid ? <Check className="h-4 w-4 text-chart-2" /> : <X className="h-4 w-4 text-destructive" />}
                      </TableCell>
                      {HEADERS.slice(0, 6).map((header) => (
                        <TableCell key={header} className="text-xs max-w-[150px] truncate">
                          {row.data[header] || "-"}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {previewData.length > 100 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        ... och {previewData.length - 100} fler rader
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setSelectedFile(null); setPreviewData([]); }}
                data-testid="button-cancel-resource-import"
              >
                Avbryt
              </Button>
              <Button
                onClick={() => selectedFile && importMutation.mutate(selectedFile)}
                disabled={importMutation.isPending || previewStats.valid === 0}
                data-testid="button-confirm-resource-import"
              >
                {importMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Importera {previewStats.valid} rader
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {lastResult && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {lastResult.errors.length === 0 ? (
                <CheckCircle className="h-4 w-4 text-chart-2" />
              ) : (
                <AlertCircle className="h-4 w-4 text-warning" />
              )}
              Senaste import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-chart-2" />
              <span>{lastResult.imported} resurser importerade</span>
            </div>
            {lastResult.errors.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-warning">
                  <AlertCircle className="h-4 w-4" />
                  <span>{lastResult.errors.length} fel:</span>
                </div>
                <ScrollArea className="h-32">
                  <ul className="text-xs text-muted-foreground pl-6 space-y-0.5">
                    {lastResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
