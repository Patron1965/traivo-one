import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Minus, Trash2, Check, X, Loader2 } from "lucide-react";
import { useMetadataAreas } from "@/hooks/use-metadata-areas";
import type { MetadataArea } from "@shared/schema";

interface MetadataAreaSelectProps {
  // '' (tom sträng) = inget område valt.
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}

// Task #675: Område-väljare med inline plus/minus-kontroller för att skapa och ta
// bort egna kategorier. Listan läses tenant-scopat via useMetadataAreas (fallback
// till hårdkodade konstanter). Plus öppnar ett litet fält för nytt namn; minus
// växlar ett borttagningsläge där egna (icke-system) kategorier får en papperskorg.
// Borttagning blockeras av servern om kategorin är i bruk — felet visas som toast.
export function MetadataAreaSelect({
  value,
  onChange,
  testId = "select-type-area",
}: MetadataAreaSelectProps) {
  const { toast } = useToast();
  const { options, rawAreas } = useMetadataAreas();

  const [addMode, setAddMode] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [removeMode, setRemoveMode] = useState(false);

  const createMutation = useMutation({
    mutationFn: async (label: string) => {
      const res = await apiRequest("POST", "/api/metadata/areas", { label });
      return (await res.json()) as MetadataArea;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/areas"] });
      onChange(created.value);
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
    onSuccess: (id) => {
      const removed = rawAreas.find((a) => a.id === id);
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/areas"] });
      if (removed && removed.value === value) onChange("");
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

  const removableAreas = rawAreas.filter((a) => !a.isSystem);

  const handleSaveNew = () => {
    const label = newLabel.trim();
    if (!label) return;
    createMutation.mutate(label);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Select
          value={value || "none"}
          onValueChange={(v) => onChange(v === "none" ? "" : v)}
        >
          <SelectTrigger data-testid={testId} className="flex-1">
            <SelectValue placeholder="Välj område" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Inget område</SelectItem>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label="Lägg till kategori"
          data-testid="button-add-area"
          onClick={() => {
            setAddMode((v) => !v);
            setRemoveMode(false);
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label="Ta bort kategori"
          data-testid="button-remove-area-mode"
          disabled={removableAreas.length === 0}
          onClick={() => {
            setRemoveMode((v) => !v);
            setAddMode(false);
          }}
        >
          <Minus className="h-4 w-4" />
        </Button>
      </div>

      {addMode && (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Ny kategori..."
            data-testid="input-new-area"
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
            size="icon"
            className="shrink-0"
            aria-label="Spara kategori"
            data-testid="button-save-area"
            disabled={!newLabel.trim() || createMutation.isPending}
            onClick={handleSaveNew}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label="Avbryt"
            data-testid="button-cancel-area"
            onClick={() => {
              setAddMode(false);
              setNewLabel("");
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {removeMode && (
        <div className="rounded-md border border-border p-2 space-y-1">
          <p className="text-xs text-muted-foreground px-1">
            Ta bort en egen kategori. Standardkategorier kan inte tas bort.
          </p>
          {removableAreas.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1">Inga egna kategorier ännu.</p>
          ) : (
            removableAreas.map((area) => (
              <div
                key={area.id}
                className="flex items-center justify-between gap-2 rounded px-2 py-1 hover-elevate"
                data-testid={`row-area-${area.value}`}
              >
                <span className="text-sm">{area.label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={`Ta bort ${area.label}`}
                  data-testid={`button-delete-area-${area.value}`}
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(area.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
