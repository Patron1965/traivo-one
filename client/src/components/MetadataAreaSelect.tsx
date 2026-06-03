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
import { Plus, Check, X, Loader2, Settings2 } from "lucide-react";
import { useMetadataAreas } from "@/hooks/use-metadata-areas";
import { MetadataAreaManagerDialog } from "@/components/MetadataAreaManager";
import type { MetadataArea } from "@shared/schema";

interface MetadataAreaSelectProps {
  // '' (tom sträng) = inget område valt.
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}

// Task #678: Kompakt område-väljare för formulär. Innehåller bara valet plus en
// snabb "+"-genväg för att skapa en kategori inline och en "hantera"-knapp som
// öppnar den rymliga hanteringspanelen (MetadataAreaManagerDialog) där namnbyte,
// omordning och borttagning sker. Listan läses tenant-scopat via useMetadataAreas.
export function MetadataAreaSelect({
  value,
  onChange,
  testId = "select-type-area",
}: MetadataAreaSelectProps) {
  const { toast } = useToast();
  const { options } = useMetadataAreas();

  const [addMode, setAddMode] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [managerOpen, setManagerOpen] = useState(false);

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
          onClick={() => setAddMode((v) => !v)}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label="Hantera kategorier"
          data-testid="button-manage-areas"
          onClick={() => setManagerOpen(true)}
        >
          <Settings2 className="h-4 w-4" />
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

      <MetadataAreaManagerDialog open={managerOpen} onOpenChange={setManagerOpen} />
    </div>
  );
}
