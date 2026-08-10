import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { DATATYPE_META, type MetadataFormType } from "@/components/ObjectMetadataForm";
import type { MetadataAreaMeta } from "./metadata-carousel-utils";
import { MetadataAreaCombobox, NO_AREA } from "./MetadataAreaCombobox";

/**
 * Task #1368: fältinställningar direkt från objektsidan — byta metadataområde,
 * ändra datatyp och slå på/av "Visa i objektvinjett". Skriver till katalogen
 * (PUT /api/metadata/types/:id); serverns guards (systemlås, rubrik-med-värden,
 * namn-/strukturlås) gäller oförändrat. Systemlåsta fält är read-only här.
 */
export function MetadataFieldSettingsDialog({
  type,
  areas,
  objectId,
  open,
  onOpenChange,
}: {
  type: MetadataFormType;
  areas: MetadataAreaMeta[];
  objectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [area, setArea] = useState<string>(type.area || NO_AREA);
  const [datatyp, setDatatyp] = useState<string>(type.datatyp || "string");
  const [visaIVinjett, setVisaIVinjett] = useState<boolean>(!!type.visaIVinjett);

  // Återställ formuläret till fältets aktuella värden varje gång dialogen öppnas.
  useEffect(() => {
    if (open) {
      setArea(type.area || NO_AREA);
      setDatatyp(type.datatyp || "string");
      setVisaIVinjett(!!type.visaIVinjett);
    }
  }, [open, type.area, type.datatyp, type.visaIVinjett]);

  const isSystemLocked = !!type.systemlast;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { visaIVinjett };
      if (!isSystemLocked) {
        payload.area = area === NO_AREA ? null : area;
        payload.datatyp = datatyp;
      }
      return apiRequest("PUT", `/api/metadata/types/${type.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/areas"] });
      // Object-scoped invalidering: fångar både /api/metadata/objects/:id och
      // .../available-types (prefix-match) så "Lägg till"-väljaren uppdateras direkt.
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId, "available-types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "system-generated-metadata"] });
      toast({ title: "Fältinställningar sparade" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte spara", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid={`dialog-field-settings-${type.id}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Fältinställningar — {type.visningsnamn || type.namn}
            {isSystemLocked && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <Lock className="h-3 w-3" /> Systemlåst
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Gäller fältet i hela katalogen (alla objekt), inte bara detta objekt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Metadataområde</Label>
            {/* Task #1443: sökbar områdesväljare (case-insensitiv filtrering + tomt-läge). */}
            <MetadataAreaCombobox
              value={area}
              onValueChange={setArea}
              areas={areas}
              disabled={isSystemLocked}
              triggerTestId="select-field-area"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Datatyp</Label>
            <Select value={datatyp} onValueChange={setDatatyp} disabled={isSystemLocked}>
              <SelectTrigger data-testid="select-field-datatype">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DATATYPE_META).map(([value, meta]) => (
                  <SelectItem key={value} value={value}>{meta.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isSystemLocked && datatyp !== type.datatyp && (
              <p className="text-xs text-muted-foreground">
                Byte av datatyp påverkar hur nya värden tolkas. Befintliga värden ändras inte.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor={`vinjett-${type.id}`}>Visa i objektvinjett</Label>
              <p className="text-xs text-muted-foreground">
                Kandidat för vinjettens snabbfält (max tre visas).
              </p>
            </div>
            <Switch
              id={`vinjett-${type.id}`}
              checked={visaIVinjett}
              onCheckedChange={setVisaIVinjett}
              data-testid="switch-field-vinjett"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-field-settings">
            Avbryt
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save-field-settings"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Spara
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
