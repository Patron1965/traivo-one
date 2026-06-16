// Ångra-funktion (Feature 1): återanvändbar knapp som rullar tillbaka den
// senaste ångringsbara import-batchen. Visas i import-wizardens + Import 2.0:s
// slutförandevyer. Kräver admin server-side (requireAdmin) — knappen är extra
// UX, inte säkerhetsgräns. Visar summering före + resultat/guardrail efter.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Loader2, RotateCcw, CheckCircle2 } from "lucide-react";

type ReversibleBatch = {
  batchId: string;
  sourceFlow: string | null;
  createdAt: string;
  totalRows: number | null;
  created: number | null;
  updated: number | null;
  actionCount: number;
  undoExpiresAt: string | null;
  expired: boolean;
};

type UndoResult = {
  batchId: string;
  sourceFlow: string | null;
  undoStatus: "undone" | "partially_undone" | "blocked";
  archived: number;
  restored: number;
  metadataRemoved: number;
  blocked: { entityId: string | null; actionType: string; reason: string }[];
};

const FLOW_LABELS: Record<string, string> = {
  wizard: "Import-wizard (3 steg)",
  "objects-v2": "Import 2.0",
  "metadata-job": "Massuppdatering av metadata",
};

function flowLabel(flow: string | null): string {
  return (flow && FLOW_LABELS[flow]) || "Senaste importen";
}

export function ImportUndoButton({
  invalidateKeys = [["/api/objects"]],
}: {
  invalidateKeys?: (string | (string | number)[])[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<UndoResult | null>(null);

  const { data, isLoading } = useQuery<{ batch: ReversibleBatch | null }>({
    queryKey: ["/api/import/undo/latest"],
    staleTime: 0,
  });

  const undo = useMutation({
    mutationFn: async (batchId: string) => {
      const res = await apiRequest("POST", "/api/import/undo", { batchId });
      return (await res.json()) as UndoResult;
    },
    onSuccess: (res) => {
      setResult(res);
      setConfirmOpen(false);
      // Invalidera relevanta listor + själva undo-statusen.
      queryClient.invalidateQueries({ queryKey: ["/api/import/undo/latest"] });
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] });
      }
      if (res.undoStatus === "undone") {
        toast({
          title: "Importen ångrades",
          description: `${res.archived} arkiverade, ${res.restored} återställda, ${res.metadataRemoved} metadatavärden borttagna.`,
        });
      } else if (res.undoStatus === "partially_undone") {
        toast({
          title: "Importen delvis ångrad",
          description: `${res.blocked.length} åtgärd(er) kunde inte ångras automatiskt.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Kunde inte ångra importen",
          description: "Inga åtgärder kunde rullas tillbaka — se detaljerna.",
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      setConfirmOpen(false);
      toast({
        title: "Ångra misslyckades",
        description: err?.message ?? "Okänt fel.",
        variant: "destructive",
      });
    },
  });

  const batch = data?.batch ?? null;

  // Visa resultat-panelen även om batchen redan är borta efter ångring.
  if (result) {
    const blockedShown = result.blocked.slice(0, 5);
    return (
      <Alert
        variant={result.undoStatus === "undone" ? "default" : "destructive"}
        data-testid="alert-undo-result"
      >
        {result.undoStatus === "undone" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <AlertTriangle className="h-4 w-4" />
        )}
        <AlertTitle>
          {result.undoStatus === "undone"
            ? "Importen har ångrats"
            : result.undoStatus === "partially_undone"
              ? "Importen delvis ångrad"
              : "Importen kunde inte ångras"}
        </AlertTitle>
        <AlertDescription>
          <div className="text-sm">
            {result.archived} objekt arkiverade · {result.restored} återställda ·{" "}
            {result.metadataRemoved} metadatavärden borttagna.
          </div>
          {result.blocked.length > 0 && (
            <div className="mt-2 text-sm">
              <p className="font-medium">
                {result.blocked.length} åtgärd(er) blockerades:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {blockedShown.map((b, i) => (
                  <li key={i} data-testid={`undo-blocked-${i}`}>
                    {b.reason}
                  </li>
                ))}
                {result.blocked.length > blockedShown.length && (
                  <li>… och {result.blocked.length - blockedShown.length} till.</li>
                )}
              </ul>
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading || !batch || batch.actionCount === 0) {
    return null;
  }

  const created = batch.created ?? 0;
  const updated = batch.updated ?? 0;

  return (
    <>
      <div
        className="rounded-md border border-warning/40 bg-warning/10 p-3"
        data-testid="panel-import-undo"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium text-foreground">Ångra senaste importen</p>
            <p className="text-muted-foreground">
              {flowLabel(batch.sourceFlow)} — {created} skapade, {updated} uppdaterade
              {batch.expired ? " (utanför ångringsfönstret)" : ""}.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={undo.isPending}
            data-testid="button-undo-import"
          >
            {undo.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            Ångra importen
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dialog-confirm-undo">
          <AlertDialogHeader>
            <AlertDialogTitle>Ångra senaste importen?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Objekt som skapades i importen arkiveras och ändrade fält
                  återställs. Objekt som fått nya kopplingar efter importen (barn,
                  ordrar, koncept m.m.) lämnas orörda och rapporteras som
                  blockerade.
                </p>
                <p className="text-muted-foreground">
                  {flowLabel(batch.sourceFlow)} — {created} skapade, {updated}{" "}
                  uppdaterade, {batch.actionCount} åtgärder totalt.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-undo">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                undo.mutate(batch.batchId);
              }}
              data-testid="button-confirm-undo"
            >
              {undo.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Ja, ångra importen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
