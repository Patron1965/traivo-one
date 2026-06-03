import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Trash2,
  Check,
  X,
  Loader2,
  Pencil,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Lock,
  Layers,
} from "lucide-react";
import { useMetadataAreas } from "@/hooks/use-metadata-areas";
import type { MetadataArea } from "@shared/schema";

// Task #678: Dedikerad, rymligare hantering av metadataområden (kategorier).
// Flyttar ut skapa / byt namn / ändra ordning / ta bort ur den trånga inline-
// väljaren (MetadataAreaSelect) till en egen panel som kan visas i en dialog från
// metadatainställningssidan. Standardområden (isSystem) kan flyttas och döpas om
// men inte tas bort. All persistering går via /api/metadata/areas.
export function MetadataAreaManager() {
  const { toast } = useToast();
  const { rawAreas } = useMetadataAreas();

  const [addMode, setAddMode] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");

  const createMutation = useMutation({
    mutationFn: async (label: string) => {
      const res = await apiRequest("POST", "/api/metadata/areas", { label });
      return (await res.json()) as MetadataArea;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/areas"] });
      setNewLabel("");
      setAddMode(false);
      toast({ title: "Kategori tillagd", description: created.label });
    },
    onError: (error: Error) => {
      toast({
        title: "Kunde inte lägga till kategori",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/metadata/areas/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/areas"] });
      toast({ title: "Kategori borttagen" });
    },
    onError: (error: Error) => {
      toast({
        title: "Kunde inte ta bort kategori",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // `value` (grupperingsnyckeln) är immutable på servern — vi skickar bara label
  // och/eller sortOrder.
  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; label?: string; sortOrder?: number }) => {
      const { id, ...body } = vars;
      const res = await apiRequest("PATCH", `/api/metadata/areas/${id}`, body);
      return (await res.json()) as MetadataArea;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/areas"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Kunde inte uppdatera kategori",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Batch-omordning vid drag-släpp (en skrivning per släpp). Hela den nya ordningen
  // skickas som lista av id:n; servern sätter sortOrder = index.
  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const res = await apiRequest("PATCH", "/api/metadata/areas/reorder", { orderedIds });
      return (await res.json()) as MetadataArea[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/areas"] });
    },
    onError: (error: Error) => {
      setOrderIds(null);
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/areas"] });
      toast({
        title: "Kunde inte ändra ordningen",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const sortedAreas = [...rawAreas].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.label.localeCompare(b.label),
  );

  // Optimistisk lokal ordning under/efter ett drag-släpp (innan servern svarat).
  // null = följ serverns ordning. Synka tillbaka när serverdatan ändras.
  const [orderIds, setOrderIds] = useState<string[] | null>(null);
  const serverOrderKey = sortedAreas.map((a) => a.id).join(",");
  useEffect(() => {
    setOrderIds(null);
  }, [serverOrderKey]);

  const areaById = new Map(sortedAreas.map((a) => [a.id, a] as const));
  const orderedAreas: MetadataArea[] =
    orderIds !== null
      ? orderIds.map((id) => areaById.get(id)).filter((a): a is MetadataArea => Boolean(a))
      : sortedAreas;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleSaveNew = () => {
    const label = newLabel.trim();
    if (!label) return;
    createMutation.mutate(label);
  };

  const handleStartEdit = (area: MetadataArea) => {
    setEditingId(area.id);
    setEditingLabel(area.label);
  };

  const handleSaveEdit = (area: MetadataArea) => {
    const label = editingLabel.trim();
    if (!label || label === area.label) {
      setEditingId(null);
      return;
    }
    updateMutation.mutate(
      { id: area.id, label },
      {
        onSuccess: () => {
          setEditingId(null);
          toast({ title: "Kategori omdöpt", description: label });
        },
      },
    );
  };

  const applyOrder = (next: MetadataArea[]) => {
    setOrderIds(next.map((a) => a.id));
    reorderMutation.mutate(next.map((a) => a.id));
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedAreas.length) return;
    applyOrder(arrayMove(orderedAreas, index, target));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedAreas.findIndex((a) => a.id === active.id);
    const newIndex = orderedAreas.findIndex((a) => a.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    applyOrder(arrayMove(orderedAreas, oldIndex, newIndex));
  };

  const isBusy = updateMutation.isPending || reorderMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Dra för att ändra ordning, byt namn eller ta bort egna kategorier.
          Standardkategorier kan flyttas och döpas om men inte tas bort.
        </p>
        {!addMode && (
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            data-testid="button-manager-add-area"
            onClick={() => setAddMode(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Ny kategori
          </Button>
        )}
      </div>

      {addMode && (
        <div className="flex items-center gap-2 rounded-md border border-border p-2">
          <Input
            autoFocus
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Namn på ny kategori..."
            data-testid="input-manager-new-area"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSaveNew();
              } else if (e.key === "Escape") {
                setAddMode(false);
                setNewLabel("");
              }
            }}
          />
          <Button
            type="button"
            className="shrink-0"
            aria-label="Spara kategori"
            data-testid="button-manager-save-area"
            disabled={!newLabel.trim() || createMutation.isPending}
            onClick={handleSaveNew}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Check className="h-4 w-4 mr-1" />
            )}
            Spara
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label="Avbryt"
            data-testid="button-manager-cancel-area"
            onClick={() => {
              setAddMode(false);
              setNewLabel("");
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {orderedAreas.length === 0 ? (
        <div className="rounded-md border border-dashed border-border py-10 text-center">
          <Layers className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Inga kategorier ännu.</p>
        </div>
      ) : (
        <div className="rounded-md border border-border divide-y divide-border">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedAreas.map((a) => a.id)}
              strategy={verticalListSortingStrategy}
            >
              {orderedAreas.map((area, index) => (
                <ManagerAreaRow
                  key={area.id}
                  area={area}
                  index={index}
                  total={orderedAreas.length}
                  isEditing={editingId === area.id}
                  editingLabel={editingLabel}
                  setEditingLabel={setEditingLabel}
                  onStartEdit={() => handleStartEdit(area)}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveEdit={() => handleSaveEdit(area)}
                  onMove={handleMove}
                  onDelete={() => deleteMutation.mutate(area.id)}
                  isBusy={isBusy}
                  isDeleting={deleteMutation.isPending}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}

interface MetadataAreaManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Dialog-wrapper så väljaren och inställningssidan kan öppna samma rymliga panel.
export function MetadataAreaManagerDialog({
  open,
  onOpenChange,
}: MetadataAreaManagerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Hantera områden</DialogTitle>
          <DialogDescription>
            Områden grupperar metadatatyperna. Skapa egna kategorier, byt namn
            eller ändra visningsordningen.
          </DialogDescription>
        </DialogHeader>
        <MetadataAreaManager />
      </DialogContent>
    </Dialog>
  );
}

interface ManagerAreaRowProps {
  area: MetadataArea;
  index: number;
  total: number;
  isEditing: boolean;
  editingLabel: string;
  setEditingLabel: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onDelete: () => void;
  isBusy: boolean;
  isDeleting: boolean;
}

// En dragbar rad i hanteringspanelen. Drag-handtaget (GripVertical) bär dnd-kit-
// lyssnarna; upp/ned-knapparna kvarstår som tangentbordstillgänglig fallback.
function ManagerAreaRow({
  area,
  index,
  total,
  isEditing,
  editingLabel,
  setEditingLabel,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onMove,
  onDelete,
  isBusy,
  isDeleting,
}: ManagerAreaRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: area.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-3 py-2 bg-background hover-elevate"
      data-testid={`row-manage-area-${area.value}`}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Dra för att flytta ${area.label}`}
        data-testid={`drag-handle-manage-area-${area.value}`}
        disabled={isBusy && !isDragging}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex flex-col shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-6"
          aria-label={`Flytta upp ${area.label}`}
          data-testid={`button-move-up-manage-area-${area.value}`}
          disabled={index === 0 || isBusy}
          onClick={() => onMove(index, -1)}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-6"
          aria-label={`Flytta ned ${area.label}`}
          data-testid={`button-move-down-manage-area-${area.value}`}
          disabled={index === total - 1 || isBusy}
          onClick={() => onMove(index, 1)}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isEditing ? (
        <>
          <Input
            autoFocus
            value={editingLabel}
            onChange={(e) => setEditingLabel(e.target.value)}
            className="h-8 flex-1"
            data-testid={`input-edit-manage-area-${area.value}`}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSaveEdit();
              } else if (e.key === "Escape") {
                onCancelEdit();
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Spara namn"
            data-testid={`button-save-edit-manage-area-${area.value}`}
            disabled={!editingLabel.trim() || isBusy}
            onClick={onSaveEdit}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Avbryt namnbyte"
            data-testid={`button-cancel-edit-manage-area-${area.value}`}
            onClick={onCancelEdit}
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      ) : (
        <>
          <span className="text-sm flex-1 truncate" data-testid={`text-manage-area-${area.value}`}>
            {area.label}
          </span>
          {area.isSystem && (
            <Badge variant="secondary" className="text-[10px] gap-1 shrink-0">
              <Lock className="h-3 w-3" />
              Standard
            </Badge>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={`Byt namn på ${area.label}`}
            data-testid={`button-edit-manage-area-${area.value}`}
            disabled={isBusy}
            onClick={onStartEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={`Ta bort ${area.label}`}
            data-testid={`button-delete-manage-area-${area.value}`}
            disabled={area.isSystem || isDeleting}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </>
      )}
    </div>
  );
}
