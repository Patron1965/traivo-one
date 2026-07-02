import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Link2, Check, Search } from "lucide-react";

interface ObjectParentSearchHit {
  id: string;
  name: string;
  objectNumber: string | null;
  address: string | null;
  city: string | null;
  objectType: string | null;
  hierarchyLevel: string | null;
  path: Array<{ id: string; name: string }>;
}

export interface KopplaObjektDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "parent" = vald blir förälder (överordnad) till objektet; "child" = vald blir barn (underordnad) till objektet. */
  mode: "parent" | "child";
  objectId: string;
  objectName: string;
  /** Objekt-id:n som inte får väljas (self + descendants + ancestors [+ befintliga föräldrar]). */
  excludeIds: string[];
  onLinked?: () => void;
}

/**
 * Återanvändbar dialog för att koppla ihop objekt i hierarkin. Både förälder-
 * och barnläge postar mot samma endpoint (POST /api/objects/:childId/parents) —
 * skillnaden är bara vilket id som är barn och vilket som är förälder. Servern
 * beslutar isPrimary, speglar objects.parentId och gör cykel-/dubblettkontroll,
 * så klienten behöver bara skicka parentId och visa serverns svenska felmeddelande.
 */
export function KopplaObjektDialog({
  open,
  onOpenChange,
  mode,
  objectId,
  objectName,
  excludeIds,
  onLinked,
}: KopplaObjektDialogProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<ObjectParentSearchHit | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setDebounced("");
      setSelected(null);
    }
  }, [open]);

  const trimmed = debounced.trim();
  const { data: results = [], isFetching } = useQuery<ObjectParentSearchHit[]>({
    queryKey: ["/api/objects/parent-search", { q: trimmed, exclude: objectId }],
    queryFn: async () => {
      const params = new URLSearchParams({ q: trimmed, exclude: objectId });
      const res = await fetch(`/api/objects/parent-search?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && trimmed.length >= 2,
  });

  const excludeSet = new Set(excludeIds);
  const filtered = results.filter((hit) => !excludeSet.has(hit.id));

  const formatPath = (path: Array<{ id: string; name: string }>) =>
    path.map((p) => p.name).join(" › ");

  const linkMutation = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      // parent-mode: objektet är barn, vald blir förälder.
      // child-mode: vald är barn, objektet blir förälder.
      const childId = mode === "parent" ? objectId : selected.id;
      const parentId = mode === "parent" ? selected.id : objectId;
      // Rå fetch (inte apiRequest) så vi kan läsa serverns strukturerade
      // svenska felmeddelande (cykel/dubblett) i stället för ett opakt kast.
      const res = await fetch(`/api/objects/${childId}/parents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ parentId }),
      });
      if (!res.ok) {
        let msg = "Kunde inte koppla objektet.";
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* ignorera parse-fel, använd fallback */
        }
        throw new Error(msg);
      }
    },
    onSuccess: () => {
      // Föräldraändring påverkar släktnamn/ancestors/descendants + listan för
      // båda objekten. Prefix ["/api/objects"] träffar allt utom parent-search.
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({ title: mode === "parent" ? "Överordnat objekt kopplat" : "Underordnat objekt kopplat" });
      onLinked?.();
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte koppla", description: err.message, variant: "destructive" });
    },
  });

  const title = mode === "parent" ? "Koppla överordnat objekt" : "Koppla underordnat objekt";
  const desc =
    mode === "parent"
      ? `Sök och välj ett objekt som ska bli förälder (överordnad) till ${objectName}.`
      : `Sök och välj ett objekt som ska bli barn (underordnad) till ${objectName}.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-koppla-objekt">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> {title}
          </DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök på namn, adress eller släktnamn…"
              className="pl-8"
              data-testid="input-koppla-search"
            />
          </div>

          <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {trimmed.length < 2 ? (
              <p className="p-3 text-sm text-muted-foreground">Skriv minst 2 tecken för att söka.</p>
            ) : isFetching ? (
              <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Söker…
              </p>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground" data-testid="text-koppla-no-results">
                Inga träffar. Objekt som skulle skapa en cykel eller redan är kopplade visas inte.
              </p>
            ) : (
              filtered.map((hit) => {
                const isSel = selected?.id === hit.id;
                return (
                  <button
                    type="button"
                    key={hit.id}
                    onClick={() => setSelected(hit)}
                    className={`flex w-full items-start gap-2 p-2.5 text-left hover:bg-muted/50 ${
                      isSel ? "bg-muted" : ""
                    }`}
                    data-testid={`option-koppla-${hit.id}`}
                  >
                    <div className="mt-0.5 h-4 w-4 shrink-0">
                      {isSel && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {hit.name || hit.objectNumber}
                      </div>
                      {hit.path.length > 0 && (
                        <div className="truncate text-xs text-muted-foreground">
                          {formatPath(hit.path)}
                        </div>
                      )}
                      {(hit.address || hit.city) && (
                        <div className="truncate text-xs text-muted-foreground">
                          {[hit.address, hit.city].filter(Boolean).join(", ")}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-koppla-cancel"
          >
            Avbryt
          </Button>
          <Button
            onClick={() => linkMutation.mutate()}
            disabled={!selected || linkMutation.isPending}
            data-testid="button-koppla-confirm"
          >
            {linkMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="mr-2 h-4 w-4" />
            )}
            Koppla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
