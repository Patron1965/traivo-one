// Arkivera/återställ-åtgärd flyttad till objekthuvudet (ersätter tidigare
// separata "Arkivering"-kort). Behåller preflight-dialog + orsak + force-flöde.
// Återställ-knappen gate:as till admin/owner eftersom POST /restore = requireAdmin.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Archive, RotateCcw } from "lucide-react";

type Preflight = {
  hasDescendants: number;
  activeWorkOrders: number;
  totalWorkOrders: number;
  activeSubscriptions: number;
  blockers: string[];
  warnings: string[];
};

export function ObjectArchiveControl({
  objectId,
  isArchived,
  canRestore,
}: {
  objectId: string;
  isArchived?: boolean;
  canRestore?: boolean;
}) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");

  const preflightQ = useQuery<Preflight>({
    queryKey: ["/api/objects", objectId, "archive-preflight"],
    enabled: dialogOpen,
  });

  const archiveMut = useMutation({
    mutationFn: async ({ force }: { force?: boolean } = {}) => {
      const res = await apiRequest("POST", `/api/objects/${objectId}/archive`, { reason, force });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error === "archive_blocked" ? "Arkivering blockerad av regelsats" : body?.message ?? "Fel");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Arkiverat", description: "Objektet har arkiverats." });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      setDialogOpen(false);
      setLocation("/objects");
    },
    onError: (e: any) => toast({ title: "Fel", description: e?.message ?? "Kunde inte arkivera", variant: "destructive" }),
  });

  const restoreMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/objects/${objectId}/restore`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Återställt", description: "Objektet är aktivt igen." });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
    },
    onError: (e: any) => toast({ title: "Fel", description: e?.message ?? "Kunde inte återställa", variant: "destructive" }),
  });

  const pre = preflightQ.data;
  const blocked = (pre?.blockers.length ?? 0) > 0;

  if (isArchived) {
    if (!canRestore) return null;
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5"
        onClick={() => restoreMut.mutate()}
        disabled={restoreMut.isPending}
        data-testid="button-restore-object"
      >
        <RotateCcw className="h-3.5 w-3.5" /> Återställ
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-muted-foreground"
        onClick={() => setDialogOpen(true)}
        data-testid="button-open-archive-dialog"
      >
        <Archive className="h-3.5 w-3.5" /> Arkivera
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Arkivera objekt</DialogTitle>
            <DialogDescription>Granska konsekvenser innan du arkiverar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {preflightQ.isLoading && <p className="text-sm text-muted-foreground">Kontrollerar...</p>}
            {pre && (
              <>
                {pre.blockers.map((b, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 bg-destructive/10 text-destructive rounded text-sm" data-testid={`text-blocker-${i}`}>
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{b}</span>
                  </div>
                ))}
                {pre.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 bg-warning/10 rounded text-sm" data-testid={`text-warning-${i}`}>
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
                    <span>{w}</span>
                  </div>
                ))}
                <div className="text-xs text-muted-foreground">
                  Underobjekt: {pre.hasDescendants} · Aktiva ordrar: {pre.activeWorkOrders}
                  {" · "}Totalt ordrar: {pre.totalWorkOrders} · Aktiva abonnemang: {pre.activeSubscriptions}
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label>Anledning (valfri)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="Ex: Kund har sagt upp avtal"
                data-testid="input-archive-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-archive">
              Avbryt
            </Button>
            {blocked ? (
              <Button
                variant="destructive"
                onClick={() => archiveMut.mutate({ force: true })}
                disabled={archiveMut.isPending}
                data-testid="button-force-archive"
                title="Arkivera trots blockerande beroenden"
              >
                <Archive className="h-4 w-4 mr-2" /> Arkivera ändå
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => archiveMut.mutate({ force: false })}
                disabled={archiveMut.isPending}
                data-testid="button-confirm-archive"
              >
                <Archive className="h-4 w-4 mr-2" /> Arkivera
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
