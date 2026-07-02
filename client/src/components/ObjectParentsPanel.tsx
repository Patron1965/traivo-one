import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ServiceObject } from "@shared/schema";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { GitFork, Plus, Trash2, Star, StarOff, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ObjectDisplayNames } from "@/components/ObjectDisplayNames";

interface ObjectParentRelation {
  id: string;
  objectId: string;
  parentId: string;
  isPrimary: boolean;
  relationContext: string | null;
  createdAt: string;
  parentName: string | null;
  parentPath: Array<{ id: string; name: string }>;
}

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

interface ObjectParentsManagerProps {
  object: ServiceObject;
  /** Kör queries bara när panelen faktiskt visas (sheet stängd = false). Default true. */
  enabled?: boolean;
}

interface ObjectParentsPanelProps {
  object: ServiceObject;
  controlled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Task #1086: multi-förälder + släktnamn integreras direkt i det enhetliga
 * objektformuläret (ObjectDetailPage → Hierarki-fliken). Tidigare låg detta i en
 * separat "kryptisk flik" (Sheet). Denna manager renderas inline; Sheet-varianten
 * (ObjectParentsPanel nedan) finns kvar som tunn wrapper för objektlistans
 * snabbåtkomst.
 */
export function ObjectParentsManager({ object, enabled = true }: ObjectParentsManagerProps) {
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedParent, setSelectedParent] = useState<ObjectParentSearchHit | null>(null);
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: parents = [], isLoading } = useQuery<ObjectParentRelation[]>({
    queryKey: ["/api/objects", object.id, "parents"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${object.id}/parents`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled,
  });

  const trimmedSearch = debouncedSearch.trim();
  const { data: searchResults = [], isFetching: searchLoading } = useQuery<ObjectParentSearchHit[]>({
    queryKey: ["/api/objects/parent-search", { q: trimmedSearch, exclude: object.id }],
    queryFn: async () => {
      const params = new URLSearchParams({ q: trimmedSearch, exclude: object.id });
      const res = await fetch(`/api/objects/parent-search?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showAddDialog && trimmedSearch.length >= 2,
  });

  const existingParentIds = new Set(parents.map(p => p.parentId));
  const filteredResults = searchResults.filter(hit => !existingParentIds.has(hit.id));

  const formatPath = (path: Array<{ id: string; name: string }>) =>
    path.map(p => p.name).join(" › ");

  const closeAddDialog = () => {
    setShowAddDialog(false);
    setSelectedParent(null);
    setParentPickerOpen(false);
    setSearch("");
    setDebouncedSearch("");
  };

  const addParentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedParent) return;
      await apiRequest("POST", `/api/objects/${object.id}/parents`, {
        parentId: selectedParent.id,
        isPrimary: parents.length === 0,
        relationContext: "primary",
        tenantId: object.tenantId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", object.id, "parents"] });
      closeAddDialog();
      toast({ title: "Förälder tillagd" });
    },
    onError: () => {
      toast({ title: "Kunde inte lägga till förälder", variant: "destructive" });
    },
  });

  const removeParentMutation = useMutation({
    mutationFn: async (relationId: string) => {
      await apiRequest("DELETE", `/api/objects/${object.id}/parents/${relationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", object.id, "parents"] });
      toast({ title: "Förälder borttagen" });
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (relationId: string) => {
      await apiRequest("PATCH", `/api/objects/${object.id}/parents/${relationId}/primary`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", object.id, "parents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      toast({ title: "Primär förälder uppdaterad" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <GitFork className="h-4 w-4" />
          Förälder-relationer
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowAddDialog(true)}
          data-testid="button-add-parent"
        >
          <Plus className="h-3 w-3 mr-1" />
          Lägg till förälder
        </Button>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Ett objekt kan tillhöra flera föräldrar. Den primära föräldern styr adress- och
        metadata-arv samt släktnamnets standardkedja.
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Laddar...</p>
      ) : parents.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-no-parents">
          Inga förälder-relationer — detta är ett toppnivåobjekt.
        </p>
      ) : (
        <div className="space-y-2">
          {parents.map(p => (
            <div
              key={p.id}
              className={`flex items-center justify-between p-3 rounded-lg border ${p.isPrimary ? "border-chart-3/50 bg-chart-3/10 dark:bg-chart-3/15" : ""}`}
              data-testid={`parent-relation-${p.id}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate" data-testid={`text-parent-name-${p.id}`}>
                    {p.parentName || p.parentId.slice(0, 8)}
                  </span>
                  {p.isPrimary && (
                    <Badge variant="outline" className="text-chart-3 border-chart-3/50 text-xs shrink-0">
                      Primär
                    </Badge>
                  )}
                </div>
                {p.parentPath && p.parentPath.length > 1 && (
                  <span className="text-xs text-muted-foreground" data-testid={`text-parent-path-${p.id}`}>
                    {formatPath(p.parentPath)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!p.isPrimary && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setPrimaryMutation.mutate(p.id)}
                    title="Gör till primär förälder"
                    data-testid={`button-set-primary-${p.id}`}
                  >
                    <StarOff className="h-3 w-3" />
                  </Button>
                )}
                {p.isPrimary && <Star className="h-3 w-3 text-chart-3 mr-1" />}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => removeParentMutation.mutate(p.id)}
                  title="Ta bort förälder"
                  data-testid={`button-remove-parent-${p.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 pt-2 border-t">
        <h3 className="text-sm font-medium">Släktnamn</h3>
        <ObjectDisplayNames objectId={object.id} enabled={enabled} allowSetPrimary showSettingsLink />
      </div>

      <Dialog open={showAddDialog} onOpenChange={(o) => (o ? setShowAddDialog(true) : closeAddDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lägg till förälder</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Förälder-objekt</Label>
            <Popover open={parentPickerOpen} onOpenChange={setParentPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={parentPickerOpen}
                  className="w-full justify-between font-normal"
                  data-testid="button-parent-picker"
                >
                  <span className="truncate text-left">
                    {selectedParent ? formatPath(selectedParent.path) : "Sök förälder-objekt..."}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Sök på namn, adress eller släktnamn..."
                    value={search}
                    onValueChange={setSearch}
                    data-testid="input-parent-search"
                  />
                  <CommandList>
                    {trimmedSearch.length < 2 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        Skriv minst 2 tecken för att söka…
                      </div>
                    ) : searchLoading ? (
                      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Söker…
                      </div>
                    ) : filteredResults.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        Inga objekt hittades.
                      </div>
                    ) : (
                      <CommandGroup>
                        {filteredResults.map(hit => (
                          <CommandItem
                            key={hit.id}
                            value={hit.id}
                            onSelect={() => {
                              setSelectedParent(hit);
                              setParentPickerOpen(false);
                            }}
                            data-testid={`option-parent-${hit.id}`}
                            className="flex flex-col items-start gap-0.5"
                          >
                            <div className="flex w-full items-center gap-2">
                              <Check className={`h-4 w-4 shrink-0 ${selectedParent?.id === hit.id ? "opacity-100" : "opacity-0"}`} />
                              <span className="font-medium">{formatPath(hit.path)}</span>
                            </div>
                            {(hit.objectNumber || hit.address || hit.city) && (
                              <span className="pl-6 text-xs text-muted-foreground">
                                {[hit.objectNumber, hit.address, hit.city].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              Sök på objektets namn, adress eller något led i släktnamnet — t.ex. "Hemköp Hisingen pantrum".
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAddDialog}>Avbryt</Button>
            <Button
              onClick={() => addParentMutation.mutate()}
              disabled={!selectedParent || addParentMutation.isPending}
              data-testid="button-confirm-add-parent"
            >
              Lägg till
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ObjectParentsPanel({ object, controlled, open: controlledOpen, onOpenChange: controlledOnOpenChange }: ObjectParentsPanelProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlled ? (controlledOpen ?? false) : internalOpen;
  const setOpen = controlled ? (controlledOnOpenChange ?? (() => {})) : setInternalOpen;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!controlled && (
        <SheetTrigger asChild>
          <Button size="icon" variant="ghost" data-testid={`button-parents-${object.id}`}>
            <GitFork className="h-4 w-4" />
          </Button>
        </SheetTrigger>
      )}
      <SheetContent className="w-[400px] sm:w-[450px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <GitFork className="h-5 w-5" />
            Föräldrar — {object.name}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4">
          <ObjectParentsManager object={object} enabled={open} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
