import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  History,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  CheckCircle,
  CheckCircle2,
  User,
  FileText,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { BatchDetailsDialog } from "@/components/import/BatchDetailsDialog";

type Batch = {
  id: string;
  batchId: string;
  totalRows: number | null;
  created: number | null;
  updated: number | null;
  errors: number | null;
  createdAt: string;
  metadata?: Record<string, any> | null;
  startedByName?: string | null;
};

interface Props {
  importType: string;
  title?: string;
  description?: string;
  limit?: number;
  testIdPrefix?: string;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("sv-SE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

type ResolvedStatus =
  | "in_progress"
  | "failed"
  | "rolled_back"
  | "restored"
  | "aborted"
  | "validated"
  | "completed_with_errors"
  | "completed";

function resolveStatus(batch: Batch): ResolvedStatus {
  const meta = batch.metadata || {};
  if (meta.rolledBack === true) return "rolled_back";
  if (meta.restored === true) return "restored";
  const status = meta.status as string | undefined;
  if (status === "in_progress") return "in_progress";
  if (status === "failed") return "failed";
  if (status === "aborted" || status === "cancelled") return "aborted";
  if (status === "validated") return "validated";
  if ((batch.errors ?? 0) > 0 || status === "completed_with_errors") return "completed_with_errors";
  return "completed";
}

function StatusBadge({ batch }: { batch: Batch }) {
  const status = resolveStatus(batch);
  switch (status) {
    case "in_progress":
      return (
        <Badge variant="outline" className="text-xs border-chart-1/50 text-chart-1">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Pågår
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="text-xs">
          <AlertCircle className="h-3 w-3 mr-1" />
          Misslyckades
        </Badge>
      );
    case "aborted":
      return (
        <Badge variant="outline" className="text-xs border-destructive/50 text-destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Avbruten
        </Badge>
      );
    case "rolled_back":
      return (
        <Badge variant="outline" className="text-xs text-muted-foreground">
          <RotateCcw className="h-3 w-3 mr-1" />
          Ångrad
        </Badge>
      );
    case "restored":
      return (
        <Badge variant="outline" className="text-xs text-muted-foreground">
          <RotateCcw className="h-3 w-3 mr-1" />
          Återställd
        </Badge>
      );
    case "validated":
      return (
        <Badge variant="outline" className="text-xs border-chart-1/50 text-chart-1">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Validerad
        </Badge>
      );
    case "completed_with_errors":
      return (
        <Badge variant="outline" className="text-xs border-warning/50 text-warning">
          <AlertCircle className="h-3 w-3 mr-1" />
          Klar (fel)
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-xs border-chart-2/50 text-chart-2">
          <CheckCircle className="h-3 w-3 mr-1" />
          Klar
        </Badge>
      );
  }
}

function TrendIcon({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) {
    return <Minus className="h-3 w-3 text-muted-foreground" aria-label="ingen jämförelse" />;
  }
  if (current < previous) {
    return (
      <span className="inline-flex items-center text-chart-2" title={`Färre fel än förra (${previous})`}>
        <TrendingDown className="h-3 w-3" />
      </span>
    );
  }
  if (current > previous) {
    return (
      <span className="inline-flex items-center text-warning" title={`Fler fel än förra (${previous})`}>
        <TrendingUp className="h-3 w-3" />
      </span>
    );
  }
  return <Minus className="h-3 w-3 text-muted-foreground" aria-label="oförändrat" />;
}

export function ImportTypeHistory({
  importType,
  title = "Tidigare uppladdningar",
  description = "Senaste körningarna för den här importtypen.",
  limit = 10,
  testIdPrefix = "import-type-history",
}: Props) {
  const [expanded, setExpanded] = useState(false);
  // Vi öppnar samma BatchDetailsDialog som huvudhistoriken använder så
  // klick→detaljer alltid landar i samma validerings-/progressvy som efter
  // direkt-uppladdning.
  const [detailsBatchId, setDetailsBatchId] = useState<string | null>(null);

  const query = useQuery<Batch[]>({
    queryKey: ["/api/import/history", { importType, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({ importType, limit: String(limit) });
      const res = await fetch(`/api/import/history?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!Array.isArray(data)) return false;
      const hasRunning = data.some((b) => b?.metadata?.status === "in_progress");
      return hasRunning ? 3000 : false;
    },
    refetchOnWindowFocus: true,
  });

  const batches = query.data || [];
  const visible = expanded ? batches : batches.slice(0, 5);

  return (
    <Card data-testid={`${testIdPrefix}-${importType}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4" />
          {title}
          {batches.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">
              {batches.length}
            </Badge>
          )}
        </CardTitle>
        {description && (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {query.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
            <Loader2 className="h-3 w-3 animate-spin" />
            Hämtar historik…
          </div>
        ) : batches.length === 0 ? (
          <div className="text-xs text-muted-foreground py-3" data-testid={`${testIdPrefix}-empty-${importType}`}>
            Ingen tidigare uppladdning hittades för den här typen.
          </div>
        ) : (
          <div className="space-y-1">
            {visible.map((batch, idx) => {
              // För trend jämför vi mot föregående batch i listan (next idx
              // i nyast-först-ordning = "förra"). Saknas förra finns ingen
              // jämförelse att visa.
              const prev = batches[idx + 1] ?? null;
              const meta: any = batch.metadata || {};
              const filename = (meta.filename as string) || null;
              const user = batch.startedByName || (meta.startedBy as string) || null;
              const rowCount = batch.totalRows ?? 0;
              const errorCount = batch.errors ?? 0;
              const prevErrorCount = prev ? prev.errors ?? 0 : null;
              const status = resolveStatus(batch);
              const isRolledBack = status === "rolled_back" || status === "restored";
              return (
                <button
                  key={batch.id}
                  type="button"
                  onClick={() => setDetailsBatchId(batch.batchId)}
                  className={`w-full text-left p-2 rounded border bg-background hover-elevate active-elevate-2 cursor-pointer ${isRolledBack ? "opacity-60" : ""}`}
                  data-testid={`${testIdPrefix}-row-${batch.batchId}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="text-xs text-muted-foreground whitespace-nowrap" data-testid={`${testIdPrefix}-time-${batch.batchId}`}>
                        {formatTime(batch.createdAt)}
                      </div>
                      {user && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                          <User className="h-3 w-3 shrink-0" />
                          <span className="truncate" title={user}>{user}</span>
                        </div>
                      )}
                      {filename && (
                        <div className="flex items-center gap-1 text-xs text-foreground min-w-0">
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate font-mono" title={filename}>{filename}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground" data-testid={`${testIdPrefix}-rows-${batch.batchId}`}>
                        {rowCount} rader
                      </span>
                      <span
                        className={`text-xs flex items-center gap-1 ${errorCount > 0 ? "text-warning font-medium" : "text-muted-foreground"}`}
                        data-testid={`${testIdPrefix}-errors-${batch.batchId}`}
                      >
                        {errorCount} fel
                        <TrendIcon current={errorCount} previous={prevErrorCount} />
                      </span>
                      <StatusBadge batch={batch} />
                    </div>
                  </div>
                </button>
              );
            })}
            {batches.length > 5 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((v) => !v)}
                className="w-full text-xs text-muted-foreground"
                data-testid={`${testIdPrefix}-toggle-expand`}
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" /> Visa färre
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" /> Visa alla {batches.length}
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <BatchDetailsDialog
        batchId={detailsBatchId}
        open={!!detailsBatchId}
        onClose={() => setDetailsBatchId(null)}
      />
    </Card>
  );
}
