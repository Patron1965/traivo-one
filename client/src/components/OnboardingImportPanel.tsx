import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Upload, FileSpreadsheet, Download, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

export interface OnboardingImportPanelProps {
  testId: string;
  endpoint: string;
  templateFilename: string;
  templateHeaders: string[];
  templateSample?: string[][];
  invalidateKeys?: string[];
  description?: string;
}

interface ImportResult {
  imported: number;
  total: number;
  errors: { row: number; message: string }[];
}

export function OnboardingImportPanel({
  testId,
  endpoint,
  templateFilename,
  templateHeaders,
  templateSample = [],
  invalidateKeys = [],
  description,
}: OnboardingImportPanelProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const downloadTemplate = () => {
    const lines = [templateHeaders.join(";"), ...templateSample.map((r) => r.join(";"))];
    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = templateFilename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File) => {
    setUploading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch(endpoint, { method: "POST", body: fd, credentials: "include" });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `HTTP ${resp.status}`);
      }
      const data: ImportResult = await resp.json();
      setResult(data);
      for (const k of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: [k] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      const errCount = data.errors?.length ?? 0;
      toast({
        title: errCount === 0 ? "Import klar" : "Import klar (med varningar)",
        description: `${data.imported} av ${data.total} rader importerade${errCount ? `, ${errCount} fel` : ""}`,
        variant: errCount === 0 ? "default" : "destructive",
      });
    } catch (err: any) {
      toast({ title: "Importen misslyckades", description: err?.message || "Okänt fel", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card data-testid={`panel-${testId}`}>
      <CardContent className="pt-6 space-y-3">
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={downloadTemplate}
            data-testid={`button-template-${testId}`}
          >
            <Download className="h-4 w-4 mr-2" />
            Ladda ner CSV-mall
          </Button>
          <Badge variant="outline" className="font-mono text-[10px]">
            {templateHeaders.join(", ")}
          </Badge>
        </div>

        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
          } ${uploading ? "pointer-events-none opacity-60" : ""}`}
          data-testid={`dropzone-${testId}`}
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) upload(file);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            data-testid={`input-file-${testId}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Importerar…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm">
                <span className="font-medium">Dra in en CSV-fil</span> eller klicka för att välja
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <FileSpreadsheet className="h-3 w-3" />
                Semikolon eller komma som avgränsare
              </p>
            </div>
          )}
        </div>

        {result && (
          <div className="rounded-md bg-muted/50 p-3 space-y-2" data-testid={`result-${testId}`}>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-chart-2" />
              <span className="font-medium">{result.imported}</span>
              <span className="text-muted-foreground">av {result.total} rader importerade</span>
            </div>
            {result.errors && result.errors.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-warning">
                  <AlertTriangle className="h-3 w-3" />
                  {result.errors.length} fel
                </div>
                <div className="max-h-32 overflow-y-auto text-xs space-y-0.5">
                  {result.errors.slice(0, 20).map((e, i) => (
                    <div key={i} className="font-mono text-muted-foreground">
                      Rad {e.row}: {e.message}
                    </div>
                  ))}
                  {result.errors.length > 20 && (
                    <div className="text-muted-foreground italic">…och {result.errors.length - 20} till</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
