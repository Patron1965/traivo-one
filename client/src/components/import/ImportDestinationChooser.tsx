import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { FilePlus, RotateCcw, ListChecks, ArrowRight, ChevronRight } from "lucide-react";

interface Props {
  active: boolean;
  onSelectNewData: () => void;
}

export function ImportDestinationChooser({ active, onSelectNewData }: Props) {
  return (
    <Card data-testid="card-import-destination-chooser">
      <CardContent className="pt-6 space-y-3">
        <div>
          <h2 className="text-base font-semibold">Vad vill du göra?</h2>
          <p className="text-sm text-muted-foreground">
            Välj ingång nedan — alla importvägar samlade på ett ställe.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <button
            type="button"
            onClick={onSelectNewData}
            className={`text-left rounded-lg border p-4 transition-colors hover-elevate active-elevate-2 ${
              active ? "border-primary bg-primary/5" : "border-border"
            }`}
            data-testid="button-destination-new-data"
          >
            <div className="flex items-center gap-2 mb-1">
              <FilePlus className="h-4 w-4 text-primary" />
              <span className="font-medium">Importera ny data</span>
              {active && <Badge variant="default" className="ml-auto text-xs">Vald</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              Migrering, löpande tillägg eller den guidade wizarden. Kunder, objekt,
              betalare, fakturarader m.m.
            </p>
          </button>

          <Link
            href="/objektmall-import"
            className="block text-left rounded-lg border border-border p-4 transition-colors hover-elevate active-elevate-2"
            data-testid="link-destination-objektmall"
          >
            <div className="flex items-center gap-2 mb-1">
              <RotateCcw className="h-4 w-4 text-primary" />
              <span className="font-medium">Återimportera objektmall</span>
              <ArrowRight className="h-3 w-3 ml-auto text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              Läs tillbaka en exporterad objektmall (Excel). Skapar, uppdaterar eller
              flyttar objekt.
            </p>
          </Link>

          <Link
            href="/import-templates"
            className="block text-left rounded-lg border border-border p-4 transition-colors hover-elevate active-elevate-2"
            data-testid="link-destination-importmallar"
          >
            <div className="flex items-center gap-2 mb-1">
              <ListChecks className="h-4 w-4 text-primary" />
              <span className="font-medium">Importmallar</span>
              <ArrowRight className="h-3 w-3 ml-auto text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              Spara och hantera kolumnmallar för återkommande importer.
            </p>
          </Link>
        </div>
        {active && (
          <div
            className="flex items-center gap-1 text-xs text-muted-foreground"
            data-testid="text-destination-hint"
          >
            <ChevronRight className="h-3 w-3" />
            Visar verktyg för: <strong>Importera ny data</strong>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
