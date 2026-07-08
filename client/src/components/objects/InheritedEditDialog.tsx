import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Link as LinkIcon, Plus, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { rawDisplayValue, type MetadataFormEntry } from "@/components/ObjectMetadataForm";
import { isCompositeValue } from "./metadata-carousel-utils";

type EditAction = "source" | "instance";

function initialValueFor(entry: MetadataFormEntry): string {
  return rawDisplayValue(entry) ?? entry.inheritedValue ?? "";
}

/** Värdesinmatning som speglar katalog-datatypen (fasta val / tal / datum / bool / text). */
function ValueInput({
  datatyp,
  allowedValues,
  value,
  onChange,
}: {
  datatyp: string;
  allowedValues: string[] | null;
  value: string;
  onChange: (v: string) => void;
}) {
  if (allowedValues && allowedValues.length > 0) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid="select-edit-metadata-value">
          <SelectValue placeholder="Välj värde..." />
        </SelectTrigger>
        <SelectContent>
          {allowedValues.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (datatyp === "boolean") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid="select-edit-metadata-value">
          <SelectValue placeholder="Välj..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Ja</SelectItem>
          <SelectItem value="false">Nej</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  const numberInput = datatyp === "integer" || datatyp === "decimal" || datatyp === "interval";
  const dateInput = datatyp === "datetime";
  return (
    <Input
      type={dateInput ? "date" : numberInput ? "number" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Ange värde"
      data-testid="input-edit-metadata-value"
    />
  );
}

export interface InheritedEditDialogProps {
  objectId: string;
  entry: MetadataFormEntry;
  datatyp: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Redigeringsdialog för ett metadatafält.
 * - Direkt värde (source==="direct"): redigerar posten direkt (edit-source).
 * - Ärvt värde (source==="inherited"): två val — redigera källan (propagerar
 *   nedåt) eller skapa en ny lokal instans här. "Ny instans" är avstängd när
 *   katalogfältet inte tillåter dubbletter (servern avvisar annars med 400).
 */
export function InheritedEditDialog({
  objectId,
  entry,
  datatyp,
  open,
  onOpenChange,
}: InheritedEditDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isInherited = entry.source === "inherited";
  const allowedValues = entry.katalog?.allowedValues ?? null;
  const allowDuplicates = !!entry.katalog?.allowDuplicates;
  const katalogNamn = entry.katalog?.namn ?? "";

  const [action, setAction] = useState<EditAction | null>(null);
  const [value, setValue] = useState("");
  // Kompositfält (t.ex. Kontakt = namn/titel/tel/e-post): redigera per medlem
  // och skriv tillbaka som ETT JSON-värde (servern JSON.parse:ar json-datatyp).
  const compositeObj =
    datatyp === "json" && isCompositeValue(entry.vardeJson)
      ? (entry.vardeJson as Record<string, unknown>)
      : null;
  const isComposite = !!compositeObj;
  const compositeKeys = compositeObj ? Object.keys(compositeObj) : [];
  const [compositeValues, setCompositeValues] = useState<Record<string, string>>({});

  // Återställ vid öppning: direkt → hoppa direkt till redigering; ärvt → visa val.
  useEffect(() => {
    if (open) {
      setValue(initialValueFor(entry));
      setAction(isInherited ? null : "source");
      if (compositeObj) {
        const seed: Record<string, string> = {};
        for (const [k, v] of Object.entries(compositeObj)) {
          seed[k] = v == null ? "" : String(v);
        }
        setCompositeValues(seed);
      } else {
        setCompositeValues({});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry, isInherited]);

  const mutation = useMutation({
    mutationFn: async () => {
      const varde = isComposite
        ? JSON.stringify(
            compositeKeys.reduce<Record<string, string>>((acc, k) => {
              acc[k] = compositeValues[k] ?? "";
              return acc;
            }, {}),
          )
        : value;
      if (action === "instance") {
        await apiRequest("POST", `/api/objects/${objectId}/metadata/new-instance`, {
          metadataTypNamn: katalogNamn,
          varde,
          level: objectId,
        });
      } else {
        await apiRequest("PATCH", `/api/objects/${objectId}/metadata/edit-source`, {
          vardeId: entry.id,
          varde,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/objects", objectId] });
      toast({
        title: action === "instance" ? "Ny instans skapad" : "Värde uppdaterat",
      });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Kunde inte spara",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    },
  });

  const showChoice = isInherited && action === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Redigera {katalogNamn || "metadata"}</DialogTitle>
          <DialogDescription>
            {showChoice
              ? "Detta värde ärvs från en förälder. Välj hur du vill ändra det."
              : action === "instance"
                ? "Lägg till ett nytt värde direkt på detta objekt."
                : "Ändra värdet. Ärvda värden uppdateras på källan och slår igenom nedåt."}
          </DialogDescription>
        </DialogHeader>

        {showChoice ? (
          <div className="space-y-3 py-2">
            <Button
              variant="outline"
              className="h-auto w-full justify-start gap-3 py-3 text-left"
              onClick={() => setAction("source")}
              data-testid="button-edit-source-choice"
            >
              <Pencil className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">Redigera källan</span>
                <span className="block text-xs text-muted-foreground">
                  Ändrar det ärvda värdet där det sattes — slår igenom på alla objekt som ärver det.
                </span>
              </span>
            </Button>

            {allowDuplicates ? (
              <Button
                variant="outline"
                className="h-auto w-full justify-start gap-3 py-3 text-left"
                onClick={() => setAction("instance")}
                data-testid="button-new-instance-choice"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Ny instans här</span>
                  <span className="block text-xs text-muted-foreground">
                    Lägger till ett eget värde på detta objekt utan att röra källan.
                  </span>
                </span>
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="outline"
                      className="h-auto w-full justify-start gap-3 py-3 text-left"
                      disabled
                      data-testid="button-new-instance-choice"
                    >
                      <Plus className="h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">Ny instans här</span>
                        <span className="block text-xs text-muted-foreground">
                          Fältet tillåter inte flera värden.
                        </span>
                      </span>
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Katalogfältet tillåter inte dubbletter — det går bara att redigera källan.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {action === "instance" && (
              <div className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-muted-foreground">
                <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                Ny lokal instans — källvärdet lämnas orört.
              </div>
            )}
            {isComposite ? (
              <div className="space-y-3" data-testid="edit-composite-fields">
                {compositeKeys.map((k) => (
                  <div key={k} className="space-y-1.5">
                    <Label className="text-xs capitalize">{k}</Label>
                    <Input
                      value={compositeValues[k] ?? ""}
                      onChange={(e) =>
                        setCompositeValues((prev) => ({ ...prev, [k]: e.target.value }))
                      }
                      placeholder="Ange värde"
                      data-testid={`input-edit-composite-${k}`}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Värde</Label>
                <ValueInput
                  datatyp={datatyp}
                  allowedValues={allowedValues}
                  value={value}
                  onChange={setValue}
                />
              </div>
            )}
          </div>
        )}

        {!showChoice && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => (isInherited ? setAction(null) : onOpenChange(false))}
              data-testid="button-cancel-edit-metadata"
            >
              {isInherited ? "Tillbaka" : "Avbryt"}
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={
                (isComposite
                  ? !compositeKeys.some((k) => (compositeValues[k] ?? "").trim() !== "")
                  : !value) || mutation.isPending
              }
              data-testid="button-save-edit-metadata"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Pencil className="h-4 w-4 mr-1" />
              )}
              Spara
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
