import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle, AlertCircle, RotateCcw } from "lucide-react";

export interface BatchDetailsStatus {
  id: string;
  batchId: string;
  totalRows: number | null;
  created: number | null;
  updated: number | null;
  errors: number | null;
  metadata: {
    type?: string;
    status?: "in_progress" | "completed" | "completed_with_errors" | "failed" | "aborted" | "cancelled" | "validated";
    rowsProcessed?: number;
    unchanged?: number;
    unmatchedCount?: number;
    invalidIdCount?: number;
    matchedRowCount?: number;
    uniqueMatchedObjectCount?: number;
    sampleErrors?: string[];
    errorSamples?: string[];
    metadataColumns?: string[];
    startedAt?: string;
    finishedAt?: string;
    failureReason?: string;
    rolledBack?: boolean;
    restored?: boolean;
    filename?: string | null;
    customerName?: string | null;
    parentObjectName?: string | null;
  } | null;
  createdAt?: string;
  startedByName?: string | null;
}

/**
 * Delas mellan importhistorik (huvudvy) och `ImportTypeHistory`-panelerna
 * så att klick→detaljer alltid visar samma validerings-/progressvy
 * som efter direkt-uppladdning.
 */
export function BatchDetailsDialog({
  batchId,
  open,
  onClose,
}: {
  batchId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const batchQuery = useQuery<BatchDetailsStatus>({
    queryKey: ["/api/import/batches", batchId],
    enabled: open && !!batchId,
    refetchInterval: (q) => {
      const status = q.state.data?.metadata?.status;
      if (!status || status === "completed" || status === "completed_with_errors" || status === "failed" || status === "aborted" || status === "cancelled") return false;
      return 2000;
    },
    refetchOnWindowFocus: true,
  });

  const phaseRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const phase = batchQuery.data?.metadata?.status;
    if (phaseRef.current === "in_progress" && (phase === "completed" || phase === "completed_with_errors" || phase === "failed")) {
      queryClient.invalidateQueries({ queryKey: ["/api/import/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/import/data-quality"] });
    }
    phaseRef.current = phase;
  }, [batchQuery.data?.metadata?.status]);

  const batch = batchQuery.data;
  const phase = batch?.metadata?.status;
  const isRolledBack = batch?.metadata?.rolledBack === true || batch?.metadata?.restored === true;
  const total = batch?.totalRows ?? 0;
  const done = batch?.metadata?.rowsProcessed ?? 0;
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const samples = batch?.metadata?.sampleErrors || batch?.metadata?.errorSamples || [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-batch-details">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {phase === "in_progress" && <Loader2 className="h-5 w-5 text-chart-1 animate-spin" />}
            {(phase === "completed" || phase === "completed_with_errors") && !isRolledBack && <CheckCircle className="h-5 w-5 text-chart-2" />}
            {(phase === "failed" || phase === "aborted" || phase === "cancelled") && <AlertCircle className="h-5 w-5 text-destructive" />}
            {isRolledBack && <RotateCcw className="h-5 w-5 text-muted-foreground" />}
            {isRolledBack ? "Import återställd / ångrad" :
             phase === "in_progress" ? "Import pågår" :
             phase === "completed" ? "Import klar" :
             phase === "completed_with_errors" ? "Import klar (med fel)" :
             phase === "failed" ? "Import misslyckades" :
             phase === "aborted" ? "Import avbruten" :
             phase === "cancelled" ? "Import avbruten" :
             phase === "validated" ? "Validerad" :
             "Batch-detaljer"}
          </DialogTitle>
          <DialogDescription>
            Batch <code data-testid="text-dialog-batch-id">{batchId}</code>
            {batch?.createdAt && ` — startad ${format(new Date(batch.createdAt), "d MMM yyyy HH:mm", { locale: sv })}`}
            {batch?.startedByName && ` av ${batch.startedByName}`}
            {batch?.metadata?.filename && (
              <>
                <br />
                <span className="font-mono text-xs">{batch.metadata.filename}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {batchQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !batch ? (
          <div className="text-sm text-muted-foreground py-4">Batch hittades inte.</div>
        ) : (
          <div className="space-y-4">
            {phase === "in_progress" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Bearbetade rader:{" "}
                    <strong data-testid="text-dialog-progress-rows">{done.toLocaleString("sv-SE")}</strong> / {total.toLocaleString("sv-SE")}
                  </span>
                  <span className="font-medium" data-testid="text-dialog-progress-pct">{progressPct}%</span>
                </div>
                <Progress value={progressPct} className="h-2" data-testid="progress-dialog-batch" />
                <div className="text-xs text-muted-foreground">Status uppdateras automatiskt var 2:e sekund.</div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="p-3 bg-muted/30 rounded border">
                <div className="text-2xl font-bold text-chart-2" data-testid="text-dialog-created">{batch.created ?? 0}</div>
                <div className="text-xs text-muted-foreground">Nya värden</div>
              </div>
              <div className="p-3 bg-muted/30 rounded border">
                <div className="text-2xl font-bold text-warning" data-testid="text-dialog-updated">{batch.updated ?? 0}</div>
                <div className="text-xs text-muted-foreground">Uppdaterade</div>
              </div>
              <div className="p-3 bg-muted/30 rounded border">
                <div className="text-2xl font-bold text-muted-foreground" data-testid="text-dialog-unchanged">{batch.metadata?.unchanged ?? 0}</div>
                <div className="text-xs text-muted-foreground">Oförändrade</div>
              </div>
              <div className="p-3 bg-muted/30 rounded border">
                <div className="text-2xl font-bold text-warning" data-testid="text-dialog-errors">{batch.errors ?? 0}</div>
                <div className="text-xs text-muted-foreground">Fel</div>
              </div>
            </div>

            {(batch.metadata?.matchedRowCount != null || batch.metadata?.uniqueMatchedObjectCount != null ||
              (batch.metadata?.unmatchedCount ?? 0) > 0 || (batch.metadata?.invalidIdCount ?? 0) > 0) && (
              <div className="text-xs text-muted-foreground space-y-1">
                {batch.metadata?.uniqueMatchedObjectCount != null && (
                  <div>
                    <strong>{batch.metadata.uniqueMatchedObjectCount}</strong> unika objekt påverkades av {batch.metadata.matchedRowCount ?? 0} matchade rader.
                  </div>
                )}
                {(batch.metadata?.unmatchedCount ?? 0) > 0 && (
                  <div>{batch.metadata?.unmatchedCount} omatchade MODUS-id.</div>
                )}
                {(batch.metadata?.invalidIdCount ?? 0) > 0 && (
                  <div>{batch.metadata?.invalidIdCount} rader saknade giltigt MODUS-id.</div>
                )}
              </div>
            )}

            {phase === "failed" && batch.metadata?.failureReason && (
              <div className="text-sm p-3 rounded bg-destructive/10 dark:bg-destructive/15 border border-destructive/20 dark:border-destructive/80" data-testid="text-dialog-failure-reason">
                <strong>Felorsak:</strong> {batch.metadata.failureReason}
              </div>
            )}

            {isRolledBack && (
              <div className="text-sm p-3 rounded bg-muted/40 border" data-testid="text-dialog-rolled-back">
                <strong>Denna import är återställd.</strong> Skapade rader är inaktiverade eller borttagna; tidigare värden återställda från audit-loggen.
              </div>
            )}

            {(batch.errors ?? 0) > 0 && samples.length > 0 && (
              <div className="text-sm p-3 rounded bg-destructive/10 dark:bg-destructive/15 border border-destructive/20 dark:border-destructive/80">
                <strong>Felmeddelanden</strong> (visar första {Math.min(10, samples.length)}):
                <ul className="mt-2 list-disc list-inside text-xs space-y-1">
                  {samples.slice(0, 10).map((e: string, i: number) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}

            {batch.metadata?.metadataColumns && batch.metadata.metadataColumns.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <strong>Metadata-kolumner:</strong> {batch.metadata.metadataColumns.join(", ")}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-close-batch-details">Stäng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
