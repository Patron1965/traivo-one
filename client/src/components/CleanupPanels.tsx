import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Phone, User, MessageSquare, Hash, GitBranch, MapPinned,
  Loader2, Eye, CheckCircle2, AlertTriangle, Sparkles
} from "lucide-react";

type CleanupType = "names" | "parents" | "address";

interface NameProposal {
  id: string;
  kind: "phone" | "person" | "instruction" | "numeric";
  currentName: string;
  objectNumber: string | null;
  address: string | null;
  parentName: string | null;
  suggestedName: string;
  moveTo: string;
}

interface ParentCandidate {
  id: string;
  name: string;
  address: string | null;
  score: number;
  reasons: string[];
}

interface ParentProposal {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  candidates: ParentCandidate[];
}

interface AddressProposal {
  id: string;
  name: string;
  source: "parent" | "reverse-geocode";
  suggestedAddress: string | null;
  suggestedCity: string | null;
  suggestedPostalCode: string | null;
}

interface NamePreviewResp { total: number; proposals: NameProposal[]; truncated: boolean }
interface ParentPreviewResp { total: number; proposals: ParentProposal[]; truncated: boolean; orphansAnalyzed: number }
interface AddressPreviewResp { total: number; proposals: AddressProposal[]; truncated: boolean; note: string | null }

const KIND_META: Record<NameProposal["kind"], { label: string; icon: typeof Phone; color: string }> = {
  phone: { label: "Telefonnummer", icon: Phone, color: "text-blue-600" },
  person: { label: "Personnamn", icon: User, color: "text-purple-600" },
  instruction: { label: "Instruktion", icon: MessageSquare, color: "text-amber-600" },
  numeric: { label: "Siffror", icon: Hash, color: "text-slate-600" },
};

export function CleanupPanels() {
  const { toast } = useToast();
  const [open, setOpen] = useState<CleanupType | null>(null);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/import/data-quality"] });
    queryClient.invalidateQueries({ queryKey: ["/api/import/data-quality/details"] });
    queryClient.invalidateQueries({ queryKey: ["/api/import/history"] });
  };

  return (
    <>
      <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-600" />
            Sanering av kärl-data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Förhandsgranska och godkänn ändringar på kärl-nivå. Allt sparas med eget batch-id i Importhistoriken så det går att ångra.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button
              variant="outline"
              onClick={() => setOpen("names")}
              className="justify-start h-auto py-3"
              data-testid="button-open-cleanup-names"
            >
              <div className="flex items-start gap-3 text-left">
                <div className="mt-0.5"><Phone className="h-4 w-4 text-blue-600" /></div>
                <div>
                  <div className="font-medium text-sm">Namn-rensning</div>
                  <div className="text-xs text-muted-foreground">Telefonnummer, personnamn och instruktioner i namn-fältet</div>
                </div>
              </div>
            </Button>
            <Button
              variant="outline"
              onClick={() => setOpen("parents")}
              className="justify-start h-auto py-3"
              data-testid="button-open-cleanup-parents"
            >
              <div className="flex items-start gap-3 text-left">
                <div className="mt-0.5"><GitBranch className="h-4 w-4 text-purple-600" /></div>
                <div>
                  <div className="font-medium text-sm">Föräldra-koppling</div>
                  <div className="text-xs text-muted-foreground">Föreslå rum/fastighet för föräldralösa kärl</div>
                </div>
              </div>
            </Button>
            <Button
              variant="outline"
              onClick={() => setOpen("address")}
              className="justify-start h-auto py-3"
              data-testid="button-open-cleanup-address"
            >
              <div className="flex items-start gap-3 text-left">
                <div className="mt-0.5"><MapPinned className="h-4 w-4 text-orange-600" /></div>
                <div>
                  <div className="font-medium text-sm">Adress-backfill</div>
                  <div className="text-xs text-muted-foreground">Ärv adress från förälder eller omvänd-geokoda</div>
                </div>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>

      <NameCleanupDialog open={open === "names"} onClose={() => setOpen(null)} onApplied={refreshAll} toast={toast} />
      <ParentCleanupDialog open={open === "parents"} onClose={() => setOpen(null)} onApplied={refreshAll} toast={toast} />
      <AddressCleanupDialog open={open === "address"} onClose={() => setOpen(null)} onApplied={refreshAll} toast={toast} />
    </>
  );
}

// ============== Namn-rensning ==============
function NameCleanupDialog({ open, onClose, onApplied, toast }: { open: boolean; onClose: () => void; onApplied: () => void; toast: ReturnType<typeof useToast>["toast"] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, isFetching, refetch } = useQuery<NamePreviewResp>({
    queryKey: ["/api/import/cleanup/names/preview"],
    enabled: open,
    staleTime: 0,
  });

  const apply = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/import/cleanup/names/apply", { ids });
      return res.json() as Promise<{ batchId: string; updated: number; skipped: number }>;
    },
    onSuccess: (resp) => {
      toast({
        title: "Namn-rensning klar",
        description: `${resp.updated} kärl uppdaterade. Batch: ${resp.batchId}. Kan ångras under Importhistorik.`,
      });
      setSelected(new Set());
      onApplied();
      refetch();
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte tillämpa", description: err.message, variant: "destructive" });
    },
  });

  const proposals = data?.proposals || [];
  const allSelected = proposals.length > 0 && selected.size === proposals.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(proposals.map(p => p.id)));
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl" data-testid="dialog-cleanup-names">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Namn-rensning
          </DialogTitle>
          <DialogDescription>
            Förhandsgranskning. Telefon → <code>accessInfo.phone</code>. Person → <code>accessInfo.contactPerson</code>. Instruktioner → <code>notes</code>. Inget tas bort.
          </DialogDescription>
        </DialogHeader>

        {isLoading || isFetching ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : proposals.length === 0 ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>Inga namn-problem hittades på kärl-nivå.</AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {proposals.length} förslag{data?.truncated ? " (visar max 200, kör igen efter tillämpning)" : ""}
              </p>
              <Badge variant="secondary">{selected.size} valda</Badge>
            </div>
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} data-testid="checkbox-select-all-names" />
                    </TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead>Nuvarande namn</TableHead>
                    <TableHead>Flyttas till</TableHead>
                    <TableHead>Nytt namn (förslag)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposals.map(p => {
                    const meta = KIND_META[p.kind];
                    const Icon = meta.icon;
                    return (
                      <TableRow key={p.id} data-testid={`row-name-proposal-${p.id}`}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(p.id)}
                            onCheckedChange={() => toggleOne(p.id)}
                            data-testid={`checkbox-name-${p.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="gap-1">
                            <Icon className={`h-3 w-3 ${meta.color}`} />
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[200px] truncate" title={p.currentName}>
                          {p.currentName}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.moveTo === "discard" ? "—" : p.moveTo}</TableCell>
                        <TableCell className="text-sm">{p.suggestedName}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="button-close-names">Stäng</Button>
          <Button
            onClick={() => apply.mutate(Array.from(selected))}
            disabled={selected.size === 0 || apply.isPending}
            data-testid="button-apply-names"
          >
            {apply.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Tillämpa {selected.size} ändringar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============== Föräldra-koppling ==============
function ParentCleanupDialog({ open, onClose, onApplied, toast }: { open: boolean; onClose: () => void; onApplied: () => void; toast: ReturnType<typeof useToast>["toast"] }) {
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const { data, isLoading, isFetching, refetch } = useQuery<ParentPreviewResp>({
    queryKey: ["/api/import/cleanup/parents/preview"],
    enabled: open,
    staleTime: 0,
  });

  const apply = useMutation({
    mutationFn: async (assignments: { objectId: string; parentId: string }[]) => {
      const res = await apiRequest("POST", "/api/import/cleanup/parents/apply", { assignments });
      return res.json() as Promise<{ batchId: string; updated: number; skipped: number }>;
    },
    onSuccess: (resp) => {
      toast({
        title: "Föräldra-koppling klar",
        description: `${resp.updated} kärl länkade. Batch: ${resp.batchId}. Kan ångras under Importhistorik.`,
      });
      setChosen({});
      onApplied();
      refetch();
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte tillämpa", description: err.message, variant: "destructive" });
    },
  });

  const proposals = data?.proposals || [];
  const acceptTopAll = () => {
    const next: Record<string, string> = {};
    for (const p of proposals) {
      if (p.candidates[0]) next[p.id] = p.candidates[0].id;
    }
    setChosen(next);
  };

  const assignments = Object.entries(chosen).map(([objectId, parentId]) => ({ objectId, parentId }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl" data-testid="dialog-cleanup-parents">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Föräldra-koppling — föräldralösa kärl
          </DialogTitle>
          <DialogDescription>
            Förslag baserat på samma kund + adresslikhet + koordinatavstånd. Toppförslaget är ofta korrekt men välj manuellt vid osäkerhet.
          </DialogDescription>
        </DialogHeader>

        {isLoading || isFetching ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : proposals.length === 0 ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Inga föräldra-förslag hittades. {data && data.orphansAnalyzed > 0 ? `${data.orphansAnalyzed} föräldralösa kärl analyserade men inga matchande rum/fastigheter hittades.` : "Inga föräldralösa kärl att koppla."}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {proposals.length} förslag{data?.truncated ? " (visar max 200)" : ""}
              </p>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{Object.keys(chosen).length} valda</Badge>
                <Button size="sm" variant="outline" onClick={acceptTopAll} data-testid="button-accept-top-parents">
                  Acceptera toppförslag (alla)
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Föräldralöst kärl</TableHead>
                    <TableHead>Adress</TableHead>
                    <TableHead>Bästa förälder-kandidater</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposals.map(p => (
                    <TableRow key={p.id} data-testid={`row-parent-proposal-${p.id}`}>
                      <TableCell className="text-sm font-medium">{p.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.address || "—"} {p.city ? `, ${p.city}` : ""}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {p.candidates.map(c => (
                            <label
                              key={c.id}
                              className={`flex items-start gap-2 p-2 rounded border cursor-pointer hover-elevate ${chosen[p.id] === c.id ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20" : "border-border"}`}
                              data-testid={`label-parent-candidate-${p.id}-${c.id}`}
                            >
                              <input
                                type="radio"
                                name={`parent-${p.id}`}
                                checked={chosen[p.id] === c.id}
                                onChange={() => setChosen({ ...chosen, [p.id]: c.id })}
                                className="mt-1"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium">{c.name}</div>
                                <div className="text-xs text-muted-foreground truncate">{c.address || "ingen adress"}</div>
                                <div className="flex gap-1 mt-1 flex-wrap">
                                  {c.reasons.map((r, i) => (
                                    <Badge key={i} variant="outline" className="text-[10px] px-1 py-0">{r}</Badge>
                                  ))}
                                  <Badge variant="secondary" className="text-[10px] px-1 py-0">poäng {c.score}</Badge>
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="button-close-parents">Stäng</Button>
          <Button
            onClick={() => apply.mutate(assignments)}
            disabled={assignments.length === 0 || apply.isPending}
            data-testid="button-apply-parents"
          >
            {apply.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Tillämpa {assignments.length} kopplingar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============== Adress-backfill ==============
function AddressCleanupDialog({ open, onClose, onApplied, toast }: { open: boolean; onClose: () => void; onApplied: () => void; toast: ReturnType<typeof useToast>["toast"] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, isFetching, refetch } = useQuery<AddressPreviewResp>({
    queryKey: ["/api/import/cleanup/address/preview"],
    enabled: open,
    staleTime: 0,
  });

  const apply = useMutation({
    mutationFn: async (items: AddressProposal[]) => {
      const payload = items.map(i => ({
        id: i.id,
        address: i.suggestedAddress,
        city: i.suggestedCity,
        postalCode: i.suggestedPostalCode,
      }));
      const res = await apiRequest("POST", "/api/import/cleanup/address/apply", { items: payload });
      return res.json() as Promise<{ batchId: string; updated: number; skipped: number }>;
    },
    onSuccess: (resp) => {
      toast({
        title: "Adress-backfill klar",
        description: `${resp.updated} kärl uppdaterade. Batch: ${resp.batchId}. Kan ångras under Importhistorik.`,
      });
      setSelected(new Set());
      onApplied();
      refetch();
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte tillämpa", description: err.message, variant: "destructive" });
    },
  });

  const proposals = data?.proposals || [];
  const allSelected = proposals.length > 0 && selected.size === proposals.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(proposals.map(p => p.id)));
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const selectedItems = proposals.filter(p => selected.has(p.id));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl" data-testid="dialog-cleanup-address">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPinned className="h-5 w-5" />
            Adress-backfill — kärl utan adress
          </DialogTitle>
          <DialogDescription>
            Förslag ärvs från förälder om möjligt, annars omvänd-geokodas från koordinater (max 25 per förhandsgranskning).
          </DialogDescription>
        </DialogHeader>

        {isLoading || isFetching ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : proposals.length === 0 ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>Inga adress-förslag möjliga just nu (saknar både förälder med adress och koordinater).</AlertDescription>
          </Alert>
        ) : (
          <>
            {data?.note && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">{data.note}</AlertDescription>
              </Alert>
            )}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {proposals.length} förslag{data?.truncated ? " (visar max 100)" : ""}
              </p>
              <Badge variant="secondary">{selected.size} valda</Badge>
            </div>
            <ScrollArea className="h-[400px] border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} data-testid="checkbox-select-all-address" />
                    </TableHead>
                    <TableHead>Kärl</TableHead>
                    <TableHead>Källa</TableHead>
                    <TableHead>Föreslagen adress</TableHead>
                    <TableHead>Ort</TableHead>
                    <TableHead>Postnr</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposals.map(p => (
                    <TableRow key={p.id} data-testid={`row-address-proposal-${p.id}`}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(p.id)}
                          onCheckedChange={() => toggleOne(p.id)}
                          data-testid={`checkbox-address-${p.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm">{p.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {p.source === "parent" ? "från förälder" : "omvänd-geokod"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{p.suggestedAddress || <span className="text-muted-foreground italic">(endast ort)</span>}</TableCell>
                      <TableCell className="text-sm">{p.suggestedCity || "—"}</TableCell>
                      <TableCell className="text-sm">{p.suggestedPostalCode || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="button-close-address">Stäng</Button>
          <Button
            onClick={() => apply.mutate(selectedItems)}
            disabled={selectedItems.length === 0 || apply.isPending}
            data-testid="button-apply-address"
          >
            {apply.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Tillämpa {selectedItems.length} adresser
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
