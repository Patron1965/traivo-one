// Task #552 (B) + (C): Historik-fönster + arkivera-knapp för enskilt objekt.
// Historik hämtas från befintlig endpoint /api/metadata/objects/:id/historik.
// Arkivering körs mot ny endpoint med preflight-dialog.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Archive, RotateCcw, History } from "lucide-react";

type HistoryEntry = {
  id: string;
  gammaltVarde: string | null;
  nyttVarde: string | null;
  andradAv: string | null;
  andradVid: string;
  andringsMetod: string | null;
  metadataNamn?: string | null;
  metadataKatalogNamn?: string | null;
};

type Preflight = {
  hasDescendants: number;
  activeWorkOrders: number;
  totalWorkOrders: number;
  activeSubscriptions: number;
  blockers: string[];
  warnings: string[];
};

export function ObjectHistoryArchiveTab({ objectId, isArchived }: { objectId: string; isArchived?: boolean }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");

  const { data: history = [] } = useQuery<HistoryEntry[]>({
    queryKey: ["/api/metadata/objects", objectId, "historik"],
    enabled: !!objectId,
  });

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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-4 w-4" /> Metadata-historik
          </CardTitle>
          <CardDescription>Alla metadata-ändringar för detta objekt, senaste först.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen historik ännu.</p>
          ) : (
            <div className="space-y-2 max-h-[480px] overflow-y-auto">
              {history.map(h => (
                <div key={h.id} className="border rounded p-3 text-sm" data-testid={`row-history-${h.id}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{h.metadataNamn ?? h.metadataKatalogNamn ?? "-"}</Badge>
                      <Badge variant="secondary" className="text-xs">{h.andringsMetod ?? "manuell"}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(h.andradVid).toLocaleString("sv-SE")} · {h.andradAv ?? "-"}
                    </span>
                  </div>
                  <div className="mt-2 text-xs font-mono">
                    <span className="text-muted-foreground">{h.gammaltVarde ?? "(tomt)"}</span>
                    <span className="mx-2">→</span>
                    <span>{h.nyttVarde ?? "(tomt)"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Archive className="h-4 w-4" /> Arkivering
          </CardTitle>
          <CardDescription>
            Arkivering ersätter radering. Objektet döljs men data och historik bevaras.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isArchived ? (
            <>
              <p className="text-sm">Detta objekt är arkiverat.</p>
              <Button
                variant="outline"
                onClick={() => restoreMut.mutate()}
                disabled={restoreMut.isPending}
                data-testid="button-restore-object"
              >
                <RotateCcw className="h-4 w-4 mr-2" /> Återställ
              </Button>
            </>
          ) : (
            <Button
              variant="destructive"
              onClick={() => setDialogOpen(true)}
              data-testid="button-open-archive-dialog"
            >
              <Archive className="h-4 w-4 mr-2" /> Arkivera objekt
            </Button>
          )}
        </CardContent>
      </Card>

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
    </div>
  );
}
