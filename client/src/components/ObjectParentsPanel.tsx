import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ServiceObject } from "@shared/schema";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { GitFork, Plus, Trash2, Star, StarOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ObjectDisplayNames } from "@/components/ObjectDisplayNames";

interface ObjectParentRelation {
  id: string;
  objectId: string;
  parentId: string;
  isPrimary: boolean;
  relationContext: string | null;
  createdAt: string;
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

const RELATION_CONTEXTS = [
  { value: "primary", label: "Primär" },
  { value: "billing", label: "Fakturering" },
  { value: "operational", label: "Drift" },
  { value: "ownership", label: "Ägare" },
];

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
  const [selectedParentId, setSelectedParentId] = useState("");
  const [selectedContext, setSelectedContext] = useState("primary");

  const { data: parents = [], isLoading } = useQuery<ObjectParentRelation[]>({
    queryKey: ["/api/objects", object.id, "parents"],
    queryFn: async () => {
      const res = await fetch(`/api/objects/${object.id}/parents`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled,
  });

  const { data: allObjects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
    enabled: showAddDialog,
  });

  const availableParents = allObjects.filter(
    o => o.id !== object.id && !parents.some(p => p.parentId === o.id)
  );

  const addParentMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/objects/${object.id}/parents`, {
        parentId: selectedParentId,
        isPrimary: parents.length === 0,
        relationContext: selectedContext,
        tenantId: object.tenantId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", object.id, "parents"] });
      setShowAddDialog(false);
      setSelectedParentId("");
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

  const getObjectName = (id: string) => {
    const obj = allObjects.find(o => o.id === id);
    return obj?.name || id.slice(0, 8);
  };

  const getContextLabel = (ctx: string | null) => {
    return RELATION_CONTEXTS.find(c => c.value === ctx)?.label || ctx || "Primär";
  };

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
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{getObjectName(p.parentId)}</span>
                  {p.isPrimary && (
                    <Badge variant="outline" className="text-chart-3 border-chart-3/50 text-xs">
                      Primär
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    {getContextLabel(p.relationContext)}
                  </Badge>
                </div>
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

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lägg till förälder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Förälder-objekt</Label>
              <Select value={selectedParentId} onValueChange={setSelectedParentId}>
                <SelectTrigger data-testid="select-parent-object">
                  <SelectValue placeholder="Välj objekt..." />
                </SelectTrigger>
                <SelectContent>
                  {availableParents.map(o => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name} ({o.hierarchyLevel || o.objectType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Relationstyp</Label>
              <Select value={selectedContext} onValueChange={setSelectedContext}>
                <SelectTrigger data-testid="select-relation-context">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATION_CONTEXTS.map(c => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Avbryt</Button>
            <Button
              onClick={() => addParentMutation.mutate()}
              disabled={!selectedParentId || addParentMutation.isPending}
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
