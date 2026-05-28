import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Database, PlusCircle, ChevronRight } from "lucide-react";

export type ImportMode = "migration" | "ongoing";

interface Props {
  value: ImportMode | null;
  onChange: (mode: ImportMode) => void;
}

export function ImportEntryChooser({ value, onChange }: Props) {
  return (
    <Card data-testid="card-import-entry-chooser">
      <CardContent className="pt-6 space-y-3">
        <div>
          <h2 className="text-base font-semibold">Vad vill du göra?</h2>
          <p className="text-sm text-muted-foreground">
            Välj ingång — verktygen nedanför filtreras därefter.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => onChange("migration")}
            className={`text-left rounded-lg border p-4 transition-colors hover-elevate active-elevate-2 ${
              value === "migration" ? "border-primary bg-primary/5" : "border-border"
            }`}
            data-testid="button-mode-migration"
          >
            <div className="flex items-center gap-2 mb-1">
              <Database className="h-4 w-4 text-primary" />
              <span className="font-medium">Förstagångs-migrering</span>
              {value === "migration" && <Badge variant="default" className="ml-auto text-xs">Vald</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              Stora exporter från Modus, Fortnox eller egna XLSX-listor. Stegvis migration med batch, ångra och historik.
            </p>
          </button>
          <button
            type="button"
            onClick={() => onChange("ongoing")}
            className={`text-left rounded-lg border p-4 transition-colors hover-elevate active-elevate-2 ${
              value === "ongoing" ? "border-primary bg-primary/5" : "border-border"
            }`}
            data-testid="button-mode-ongoing"
          >
            <div className="flex items-center gap-2 mb-1">
              <PlusCircle className="h-4 w-4 text-primary" />
              <span className="font-medium">Lägg till löpande</span>
              {value === "ongoing" && <Badge variant="default" className="ml-auto text-xs">Vald</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              Vardagligt underhåll: nya underobjekt, betalare, fakturamottagare, kundlistor — paste eller mindre filer.
            </p>
          </button>
        </div>
        {value && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="text-mode-hint">
            <ChevronRight className="h-3 w-3" />
            Visar verktyg för:{" "}
            <strong>{value === "migration" ? "Förstagångs-migrering" : "Lägg till löpande"}</strong>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
