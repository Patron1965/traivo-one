import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { DATATYPE_META } from "@/components/ObjectMetadataForm";
import type { MetadataAreaMeta } from "./metadata-carousel-utils";

const NO_AREA = "__ovrigt__";

/**
 * Task #1368: skapa ett nytt katalogfält direkt från objektsidan — namn,
 * datatyp, metadataområde och "Visa i objektvinjett". Skapar fältet i
 * katalogen (POST /api/metadata/types); värdet läggs sedan till via den
 * vanliga "Lägg till"-vägen. Serverns unikhets-/arkivkontroller gäller.
 */
export function MetadataCreateFieldDialog({
  areas,
  objectId,
}: {
  areas: MetadataAreaMeta[];
  objectId: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [namn, setNamn] = useState("");
  const [datatyp, setDatatyp] = useState("string");
  const [area, setArea] = useState<string>(NO_AREA);
  const [visaIVinjett, setVisaIVinjett] = useState(false);

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/metadata/types", {
        namn: namn.trim(),
        datatyp,
        area: area === NO_AREA ? null : area,
        visaIVinjett,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/types"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/areas"] });
      // Object-scoped invalidering: fångar både /api/metadata/objects/:id och
      // .../available-types (prefix-match) så nya fältet syns i "Lägg till" direkt.
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId, "available-types"] });
      toast({ title: "Fält skapat", description: `"${namn.trim()}" finns nu i katalogen — lägg till ett värde via Lägg till.` });
      setOpen(false);
      setNamn("");
      setDatatyp("string");
      setArea(NO_AREA);
      setVisaIVinjett(false);
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte skapa fältet", description: err.message, variant: "destructive" });
    },
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-create-metadata-field"
      >
        <Plus className="h-4 w-4 mr-1.5" /> Nytt fält
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-create-metadata-field">
          <DialogHeader>
            <DialogTitle>Nytt metadatafält</DialogTitle>
            <DialogDescription>
              Fältet skapas i katalogen och blir tillgängligt för alla objekt.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-field-name">Namn</Label>
              <Input
                id="new-field-name"
                value={namn}
                onChange={(e) => setNamn(e.target.value)}
                placeholder="T.ex. Portkod"
                data-testid="input-new-field-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Datatyp</Label>
              <Select value={datatyp} onValueChange={setDatatyp}>
                <SelectTrigger data-testid="select-new-field-datatype">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DATATYPE_META).map(([value, meta]) => (
                    <SelectItem key={value} value={value}>{meta.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Metadataområde</Label>
              <Select value={area} onValueChange={setArea}>
                <SelectTrigger data-testid="select-new-field-area">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_AREA}>Övrigt (inget område)</SelectItem>
                  {areas.map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="new-field-vinjett">Visa i objektvinjett</Label>
                <p className="text-xs text-muted-foreground">
                  Kandidat för vinjettens snabbfält (max tre visas).
                </p>
              </div>
              <Switch
                id="new-field-vinjett"
                checked={visaIVinjett}
                onCheckedChange={setVisaIVinjett}
                data-testid="switch-new-field-vinjett"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-create-field">
              Avbryt
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || namn.trim().length === 0}
              data-testid="button-save-create-field"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Skapa fält
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
