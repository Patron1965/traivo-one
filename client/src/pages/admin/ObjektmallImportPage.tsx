import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Download,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  History as HistoryIcon,
  PlayCircle,
  RotateCcw,
  FileDown,
} from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { OBJEKTMALL_SHEETS, OBJEKTMALL_FILENAME } from "@shared/objektmall-template";

type RowAction = "create" | "update" | "repoint";
interface SheetReport {
  name: string;
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  toRepoint: number;
  errorRows: number;
  errors: Array<{ row: number; messages: string[] }>;
  actions: Array<{ row: number; action: RowAction; name: string; detail: string; changed: boolean }>;
}
interface PreviewResponse {
  ok: boolean;
  dryRun: boolean;
  fileName: string;
  templateVersion: string;
  interimListFlag: boolean;
  report: {
    sheets: Record<string, SheetReport>;
    warnings: string[];
    hasBlockingErrors: boolean;
    interimListFlag: boolean;
    metadata: Array<{ fieldKey: string; action: string; reason?: string }>;
  };
}
interface CommitResponse {
  ok: boolean;
  fileName: string;
  batchId: string;
  created: Record<string, number>;
  updated: Record<string, number>;
  repointed: Record<string, number>;
  report: PreviewResponse["report"];
  message?: string;
}
interface HistoryItem {
  id: string;
  batchId: string;
  totalRows: number;
  created: number;
  updated: number;
  errors: number;
  createdAt: string;
  fileName: string | null;
  userName: string | null;
  perLevel: { created: Record<string, number>; updated: Record<string, number>; repointed?: Record<string, number> } | null;
}

const SHEET_ORDER = ["organisation", "stores", "containers", "metadata"] as const;

export default function ObjektmallImportPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);

  const historyQuery = useQuery<HistoryItem[]>({
    queryKey: ["/api/admin/objektmall/history"],
  });

  const previewMutation = useMutation<PreviewResponse, Error, File>({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/objektmall/preview", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          throw new Error(j.message || j.error || text);
        } catch {
          throw new Error(text || `HTTP ${res.status}`);
        }
      }
      return res.json();
    },
    onSuccess: (data) => {
      setPreview(data);
      setCommitResult(null);
      if (data.report.hasBlockingErrors) {
        toast({
          title: "Torrkörning klar — valideringsfel hittades",
          description: "Granska felmeddelandena nedan, korrigera mallen och kör igen.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Torrkörning klar",
          description: "Inga fel hittades. Du kan nu köra skarp import.",
        });
      }
    },
    onError: (err) => {
      toast({ title: "Kunde inte tolka mallen", description: err.message, variant: "destructive" });
    },
  });

  const commitMutation = useMutation<CommitResponse, Error, File>({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/objektmall/commit", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.message || json.error || `HTTP ${res.status}`);
      }
      return json as CommitResponse;
    },
    onSuccess: (data) => {
      setCommitResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/objektmall/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metadata-definitions"] });
      toast({
        title: "Import slutförd",
        description: `Batch-ID: ${data.batchId}`,
      });
    },
    onError: (err) => {
      toast({ title: "Import misslyckades", description: err.message, variant: "destructive" });
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setSelectedFile(f);
    setPreview(null);
    setCommitResult(null);
    previewMutation.mutate(f);
  }

  function reset() {
    setSelectedFile(null);
    setPreview(null);
    setCommitResult(null);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6" data-testid="page-objektmall-import">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileSpreadsheet className="h-6 w-6" />
          Importera objekt från Excel-mall
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Ladda upp en ifylld <code className="text-xs bg-muted px-1 py-0.5 rounded">{OBJEKTMALL_FILENAME}</code> för
          att i ett enda svep <span className="font-medium">skapa nya</span> (via interimsnummer),{" "}
          <span className="font-medium">uppdatera befintliga</span> (via systemnummer eller butiksnummer/butiksnamn) och{" "}
          <span className="font-medium">flytta objekt till ny förälder</span>. Endast Objektnamn och Förälder krävs
          (förälder utelämnas bara för roten); allt annat — inklusive adress — är metadata som ärvs nedåt från
          föräldern. Re-import av samma fil uppdaterar befintliga objekt — inga dubbletter skapas.
        </p>
      </div>

      {/* Mall + upload */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card data-testid="card-template-download">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4" />
              Steg 1 — Ladda ner mall
            </CardTitle>
            <CardDescription>
              Den senaste mallen med fyra flikar (Steg 1, Steg 2, Steg 3, Metadatafält) och instruktioner.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" data-testid="button-download-template">
              <a href="/api/admin/objektmall/template" download={OBJEKTMALL_FILENAME}>
                <Download className="h-4 w-4 mr-2" />
                Ladda ner tom mall ({OBJEKTMALL_FILENAME})
              </a>
            </Button>

            <Separator className="my-3" />

            <div className="space-y-2">
              <p className="text-xs font-medium">
                Exportera <span className="font-semibold">befintliga objekt</span> i samma kolumnformat
              </p>
              <p className="text-xs text-muted-foreground">
                Få ut nuvarande objekt med metadata för att jämföra mot din egen lista, redigera och
                läsa tillbaka via importen.
              </p>
              <div className="flex flex-col gap-2">
                <Button asChild variant="outline" size="sm" data-testid="button-export-update">
                  <a href="/api/admin/objektmall/export?mode=update">
                    <FileDown className="h-4 w-4 mr-2" />
                    Exportera för uppdatering (systemnummer)
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" data-testid="button-export-interim">
                  <a href="/api/admin/objektmall/export?mode=interim">
                    <FileDown className="h-4 w-4 mr-2" />
                    Exportera som interim-mall (ny lista)
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Tips: håll uppdaterings- och nyimportlistor åtskilda — blanda inte befintliga
                (systemnummer) med helt nya rader (interimsnummer) i samma fil.
              </p>
            </div>

            <Separator className="my-3" />

            <ul className="text-xs text-muted-foreground space-y-1 list-disc ml-5">
              {OBJEKTMALL_SHEETS.map((s) => (
                <li key={s.key}>
                  <span className="font-medium">{s.name}:</span> {s.intro.split(".")[0]}.
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card data-testid="card-upload">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" />
              Steg 2 — Ladda upp ifylld mall
            </CardTitle>
            <CardDescription>
              Filen valideras direkt (torrkörning). Inget skrivs till databasen i detta steg.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={handleFileChange}
              data-testid="input-file"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={previewMutation.isPending || commitMutation.isPending}
                data-testid="button-upload"
              >
                {previewMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Välj fil och kör torrkörning
              </Button>
              {selectedFile && (
                <Button variant="ghost" size="sm" onClick={reset} data-testid="button-reset">
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Rensa
                </Button>
              )}
            </div>
            {selectedFile && (
              <p className="text-xs text-muted-foreground" data-testid="text-filename">
                Vald fil: <span className="font-mono">{selectedFile.name}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Preview-rapport */}
      {preview && (
        <Card data-testid="card-preview">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {preview.report.hasBlockingErrors ? (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-chart-2" />
              )}
              Torrkörningsrapport — {preview.fileName}
            </CardTitle>
            <CardDescription>
              Sammanställning per flik. {preview.report.hasBlockingErrors
                ? "Fixa fel innan skarp import."
                : "Allt ser bra ut. Du kan köra skarp import nedan."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.interimListFlag && (
              <Alert className="bg-chart-4/10 border-chart-4/40" data-testid="alert-interim-list">
                <FileSpreadsheet className="h-4 w-4 text-chart-4" />
                <AlertTitle>Interimslista</AlertTitle>
                <AlertDescription className="text-xs">
                  Den här filen är markerad som en ren interimslista. Nummerkolumnerna tolkas som interimsnummer och
                  rader matchas mot tidigare interim-import — befintliga systemobjekt uppdateras inte av misstag.
                </AlertDescription>
              </Alert>
            )}
            {preview.report.warnings.length > 0 && (
              <Alert variant="default" className="bg-warning/10 border-warning/40">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <AlertTitle>Varningar</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc ml-4 text-xs space-y-0.5">
                    {preview.report.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {SHEET_ORDER.map((k) => {
                const s = preview.report.sheets[k];
                if (!s) return null;
                return (
                  <div key={k} className="border rounded p-3 space-y-1" data-testid={`stat-${k}`}>
                    <div className="text-xs text-muted-foreground">{s.name}</div>
                    <div className="text-2xl font-bold">{s.totalRows}</div>
                    <div className="flex gap-2 flex-wrap text-xs">
                      <Badge variant="outline" className="bg-chart-2/10">Ny: {s.toCreate}</Badge>
                      <Badge variant="outline" className="bg-chart-1/10">Uppd: {s.toUpdate}</Badge>
                      {(s.toRepoint ?? 0) > 0 && (
                        <Badge variant="outline" className="bg-chart-4/10">Flyttad: {s.toRepoint}</Badge>
                      )}
                      {s.errorRows > 0 && (
                        <Badge variant="destructive">Fel: {s.errorRows}</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {SHEET_ORDER.some((k) => (preview.report.sheets[k]?.errors.length ?? 0) > 0) && (
              <div className="space-y-2">
                <Separator />
                <h3 className="text-sm font-semibold text-destructive">Valideringsfel</h3>
                {SHEET_ORDER.map((k) => {
                  const s = preview.report.sheets[k];
                  if (!s || s.errors.length === 0) return null;
                  return (
                    <div key={k} data-testid={`errors-${k}`}>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1">{s.name}</h4>
                      <ScrollArea className="h-40 border rounded">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-16">Rad</TableHead>
                              <TableHead>Meddelande</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {s.errors.map((e) => (
                              <TableRow key={e.row}>
                                <TableCell className="font-mono">{e.row}</TableCell>
                                <TableCell className="text-xs">
                                  <ul className="list-disc ml-4">
                                    {e.messages.map((m, i) => <li key={i}>{m}</li>)}
                                  </ul>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </div>
                  );
                })}
              </div>
            )}

            {SHEET_ORDER.some((k) => (preview.report.sheets[k]?.actions?.length ?? 0) > 0) && (
              <div className="space-y-2">
                <Separator />
                <h3 className="text-sm font-semibold">Planerade åtgärder per rad</h3>
                {SHEET_ORDER.map((k) => {
                  const s = preview.report.sheets[k];
                  if (!s || (s.actions?.length ?? 0) === 0) return null;
                  return (
                    <div key={k} data-testid={`actions-${k}`}>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1">{s.name}</h4>
                      <ScrollArea className="h-44 border rounded">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-16">Rad</TableHead>
                              <TableHead className="w-28">Åtgärd</TableHead>
                              <TableHead>Objekt</TableHead>
                              <TableHead>Detalj</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {s.actions.map((a) => (
                              <TableRow
                                key={a.row}
                                data-testid={`action-row-${k}-${a.row}`}
                                data-changed={a.changed ? "true" : "false"}
                                className={a.changed ? "border-l-4 border-l-destructive bg-destructive/5" : undefined}
                              >
                                <TableCell className="font-mono text-xs">{a.row}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={
                                      a.action === "create"
                                        ? "bg-chart-2/10"
                                        : a.action === "repoint"
                                          ? "bg-chart-4/10"
                                          : "bg-chart-1/10"
                                    }
                                  >
                                    {a.action === "create" ? "Ny" : a.action === "repoint" ? "Flyttad" : "Uppdaterad"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs">
                                  <span className="flex items-center gap-1.5">
                                    {a.name}
                                    {a.changed && (
                                      <Badge
                                        variant="outline"
                                        className="border-destructive/40 text-destructive bg-destructive/5 text-[10px] px-1 py-0"
                                        data-testid={`badge-changed-${k}-${a.row}`}
                                      >
                                        {a.action === "create" ? "Ny" : "Ändrad"}
                                      </Badge>
                                    )}
                                  </span>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{a.detail}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </div>
                  );
                })}
              </div>
            )}

            <Separator />

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="default"
                disabled={
                  preview.report.hasBlockingErrors ||
                  !selectedFile ||
                  commitMutation.isPending ||
                  !!commitResult
                }
                onClick={() => selectedFile && commitMutation.mutate(selectedFile)}
                data-testid="button-commit"
              >
                {commitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4 mr-2" />
                )}
                Kör skarp import
              </Button>
              {preview.report.hasBlockingErrors && (
                <span className="text-xs text-destructive">
                  Skarp import blockerad — fixa fel ovan först.
                </span>
              )}
              {commitResult && (
                <Badge variant="default" className="bg-chart-2 text-white">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Slutförd ({commitResult.batchId})
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Commit-resultat */}
      {commitResult && (
        <Alert className="bg-chart-2/10 border-chart-2/40" data-testid="alert-commit-success">
          <CheckCircle2 className="h-4 w-4 text-chart-2" />
          <AlertTitle>Import slutförd</AlertTitle>
          <AlertDescription>
            <div className="text-sm">
              Batch-ID: <span className="font-mono">{commitResult.batchId}</span>
            </div>
            <div className="mt-2 grid sm:grid-cols-3 gap-2 text-xs">
              <div>
                <div className="font-semibold mb-0.5">Skapade</div>
                <ul className="ml-3">
                  {Object.entries(commitResult.created).map(([k, v]) => (
                    <li key={k}>{k}: <span className="font-mono">{v}</span></li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-semibold mb-0.5">Uppdaterade</div>
                <ul className="ml-3">
                  {Object.entries(commitResult.updated).map(([k, v]) => (
                    <li key={k}>{k}: <span className="font-mono">{v}</span></li>
                  ))}
                </ul>
              </div>
              {commitResult.repointed && (
                <div>
                  <div className="font-semibold mb-0.5">Flyttade</div>
                  <ul className="ml-3">
                    {Object.entries(commitResult.repointed).map(([k, v]) => (
                      <li key={k}>{k}: <span className="font-mono">{v}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Historik */}
      <Card data-testid="card-history">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HistoryIcon className="h-4 w-4" />
            Importhistorik
          </CardTitle>
          <CardDescription>De senaste 100 körningarna via Excel-mallen.</CardDescription>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Laddar...
            </div>
          ) : historyQuery.isError ? (
            <Alert variant="destructive">
              <AlertDescription>Kunde inte ladda historiken.</AlertDescription>
            </Alert>
          ) : (historyQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Inga tidigare körningar.</p>
          ) : (
            <ScrollArea className="max-h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tidpunkt</TableHead>
                    <TableHead>Fil</TableHead>
                    <TableHead>Användare</TableHead>
                    <TableHead className="text-right">Totalt</TableHead>
                    <TableHead className="text-right">Skapade</TableHead>
                    <TableHead className="text-right">Uppdaterade</TableHead>
                    <TableHead className="font-mono text-xs">Batch</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyQuery.data!.map((h) => (
                    <TableRow key={h.id} data-testid={`row-history-${h.batchId}`}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(h.createdAt).toLocaleString("sv-SE")}
                      </TableCell>
                      <TableCell className="text-xs">{h.fileName ?? "—"}</TableCell>
                      <TableCell className="text-xs">{h.userName ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{h.totalRows}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-chart-2">{h.created}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{h.updated}</TableCell>
                      <TableCell className="font-mono text-xs">{h.batchId}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
