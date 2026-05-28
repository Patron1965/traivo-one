import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, FileUp, Loader2, Info, RefreshCw, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  DiffImportPreview,
  type DiffImportPreviewData,
} from "@/components/import/DiffImportPreview";
import { ImportTypeHistory } from "@/components/import/ImportTypeHistory";
import type { Customer } from "@shared/schema";

export function ObjectsDiffPanel() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DiffImportPreviewData | null>(null);
  const [applyCreate, setApplyCreate] = useState(true);
  const [applyUpdate, setApplyUpdate] = useState(true);
  const [applyMissing, setApplyMissing] = useState(true);
  const [confirmAllowMassMissing, setConfirmAllowMassMissing] = useState(false);
  const [defaultCustomerId, setDefaultCustomerId] = useState<string>("");

  const customersQuery = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const downloadExport = async () => {
    try {
      const res = await fetch("/api/import/objects-diff/export", {
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Export misslyckades (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const datestamp = new Date().toISOString().slice(0, 10);
      a.download = `traivo-objekt-export-${datestamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: "Export klar",
        description: "Filen har laddats ner. Gör dina ändringar och ladda upp den igen.",
      });
    } catch (err: any) {
      toast({
        title: "Export misslyckades",
        description: err?.message || String(err),
        variant: "destructive",
      });
    }
  };

  const previewMutation = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/import/objects-diff/preview", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Diff misslyckades (${res.status})`);
      }
      return (await res.json()) as DiffImportPreviewData;
    },
    onSuccess: (data) => {
      setPreview(data);
      // Default: stäng av mass-flag automatiskt om uppladdningen ser delvis ut
      if (data.safety?.suspectedPartialUpload) {
        setApplyMissing(false);
        setConfirmAllowMassMissing(false);
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Diff misslyckades",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Ingen fil vald");
      const form = new FormData();
      form.append("file", file);
      form.append("applyCreate", String(applyCreate));
      form.append("applyUpdate", String(applyUpdate));
      form.append("applyMissing", String(applyMissing));
      if (confirmAllowMassMissing) form.append("confirmAllowMassMissing", "true");
      if (defaultCustomerId) form.append("defaultCustomerId", defaultCustomerId);
      const res = await fetch("/api/import/objects-diff/commit", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Bekräftelse misslyckades (${res.status})`);
      }
      return await res.json();
    },
    onSuccess: (data: any) => {
      const a = data.applied || {};
      toast({
        title: "Diff applicerad",
        description: `${a.created || 0} nya, ${a.updated || 0} uppdaterade, ${a.missingMarked || 0} markerade som saknade. (Batch ${data.batchId})`,
      });
      // Rensa state och invalidera relevanta vyer
      setFile(null);
      setPreview(null);
      setConfirmAllowMassMissing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/import/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Bekräftelse misslyckades",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleFile = (f: File | null) => {
    setFile(f);
    setPreview(null);
    if (f) previewMutation.mutate(f);
  };

  return (
    <div className="space-y-6" data-testid="objects-diff-panel">
      <Card className="border-chart-1/20 dark:border-chart-1/80 bg-chart-1/10 dark:bg-chart-1/15">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-chart-1 mt-0.5 shrink-0" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">Uppdatera objektlistan med export → ändra → importera</p>
              <p className="text-muted-foreground">
                Ladda ner en kopia av era nuvarande objekt, ändra fält direkt i Excel, lägg till
                nya rader längst ner eller ta bort rader som inte längre gäller. När ni laddar
                upp filen igen visas en preview med tre sektioner: <strong>Nya</strong>,{" "}
                <strong>Ändrade</strong> (med per-fält-diff) och <strong>Saknade</strong>.
                Inget skrivs förrän ni klickar på Bekräfta. Matchning sker primärt på{" "}
                <code className="text-xs">objectNumber</code>, sekundärt på namn + parent. Saknade
                rader markeras endast — raderas aldrig automatiskt.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4" />
              Steg 1 — Exportera nuvarande
            </CardTitle>
            <CardDescription>
              XLSX med era objekt + <code className="text-xs">objectNumber</code> som matchningsnyckel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={downloadExport}
              data-testid="button-objects-diff-export"
            >
              <Download className="h-4 w-4 mr-2" />
              Ladda ner nuvarande objektlista
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileUp className="h-4 w-4" />
              Steg 2 — Ladda upp ändrad fil
            </CardTitle>
            <CardDescription>
              Vi visar diff innan något skrivs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              id="objects-diff-file-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFile(e.target.files?.[0] || null)}
              className="hidden"
              data-testid="input-objects-diff-file"
            />
            <Button
              variant="secondary"
              className="w-full"
              onClick={() =>
                document.getElementById("objects-diff-file-input")?.click()
              }
              disabled={previewMutation.isPending}
              data-testid="button-objects-diff-select-file"
            >
              {previewMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4 mr-2" />
              )}
              {file ? file.name : "Välj fil"}
            </Button>
            {file && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => previewMutation.mutate(file)}
                disabled={previewMutation.isPending}
                data-testid="button-objects-diff-rerun-preview"
              >
                <RefreshCw className="h-3 w-3 mr-2" />
                Kör diff igen
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {preview && preview.safety?.suspectedPartialUpload && (
        <Card className="border-warning bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-warning">
              Filen ser ut som en delvis lista
            </CardTitle>
            <CardDescription>
              Endast {preview.safety.matchedNumbered} av{" "}
              {preview.safety.numberedCurrent} numrerade objekt matchades (
              {Math.round(preview.safety.matchRatio * 100)} %). Mass-markering av saknade
              objekt är blockerad om ni inte explicit bekräftar det nedan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmAllowMassMissing}
                onChange={(e) => setConfirmAllowMassMissing(e.target.checked)}
                data-testid="checkbox-confirm-mass-missing"
              />
              <span>
                Jag har granskat och vill ändå markera{" "}
                {preview.totals.missing} objekt som saknade i den här filen.
              </span>
            </label>
          </CardContent>
        </Card>
      )}

      {preview && (
        <>
          <DiffImportPreview
            data={preview}
            applyCreate={applyCreate}
            applyUpdate={applyUpdate}
            applyMissing={applyMissing}
            onChangeApply={(next) => {
              setApplyCreate(next.applyCreate);
              setApplyUpdate(next.applyUpdate);
              setApplyMissing(next.applyMissing);
            }}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Steg 3 — Bekräfta</CardTitle>
              <CardDescription>
                Granska valen ovan och bekräfta. En post i importhistoriken skapas så ni kan
                följa upp diffen senare.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {applyCreate && preview.created.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="objects-diff-default-customer" className="text-xs">
                    Standardkund för nya rader utan matchande{" "}
                    <code className="text-xs">customerName</code>
                  </Label>
                  <Select
                    value={defaultCustomerId || "__none__"}
                    onValueChange={(v) =>
                      setDefaultCustomerId(v === "__none__" ? "" : v)
                    }
                  >
                    <SelectTrigger
                      id="objects-diff-default-customer"
                      data-testid="select-objects-diff-default-customer"
                    >
                      <SelectValue placeholder="Ingen — hoppa över rader utan kund" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        Ingen — hoppa över rader utan kund
                      </SelectItem>
                      {(customersQuery.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Rader vars <code className="text-xs">customerName</code> matchar en
                    befintlig kund hänger på den kunden, annars ärvs kunden från föräldraobjektet,
                    och som sista utväg används den här standardkunden.
                  </p>
                </div>
              )}

              <Button
                className="w-full"
                onClick={() => commitMutation.mutate()}
                disabled={
                  commitMutation.isPending ||
                  (!applyCreate && !applyUpdate && !applyMissing)
                }
                data-testid="button-objects-diff-commit"
              >
                {commitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Bekräfta uppdatering ({preview.totals.created +
                  preview.totals.updated +
                  preview.totals.missing}{" "}
                rader påverkas)
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      <ImportTypeHistory importType="objects-diff" title="Historik — diff-uppdateringar" />
    </div>
  );
}
