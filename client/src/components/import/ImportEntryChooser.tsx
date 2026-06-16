import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, PlusCircle, ChevronRight, ListOrdered } from "lucide-react";

export type ImportMode = "migration" | "ongoing" | "wizard";

interface Props {
  value: ImportMode | null;
  onChange: (mode: ImportMode) => void;
}

interface ModeOption {
  key: ImportMode;
  icon: typeof Database;
  title: string;
  description: string;
  testId: string;
}

const MODES: ModeOption[] = [
  {
    key: "migration",
    icon: Database,
    title: "Förstagångs-migrering",
    description:
      "Stora exporter från Modus, Fortnox eller egna XLSX-listor. Stegvis migration med batch, ångra och historik.",
    testId: "button-mode-migration",
  },
  {
    key: "ongoing",
    icon: PlusCircle,
    title: "Lägg till löpande",
    description:
      "Vardagligt underhåll: nya underobjekt, betalare, fakturamottagare, kundlistor — paste eller mindre filer.",
    testId: "button-mode-ongoing",
  },
  {
    key: "wizard",
    icon: ListOrdered,
    title: "Tre-stegs import-wizard",
    description:
      "Guidat onboarding-flöde: Organisation → Butiker → Fysiska objekt. Interimnummer kopplar stegen.",
    testId: "button-mode-wizard",
  },
];

const MODE_LABELS: Record<ImportMode, string> = {
  migration: "Förstagångs-migrering",
  ongoing: "Lägg till löpande",
  wizard: "Tre-stegs import-wizard",
};

export function ImportEntryChooser({ value, onChange }: Props) {
  return (
    <Card data-testid="card-import-entry-chooser">
      <CardContent className="pt-6 space-y-3">
        <div>
          <h2 className="text-base font-semibold">Vilken typ av import?</h2>
          <p className="text-sm text-muted-foreground">
            Välj typ — verktygen nedanför filtreras därefter.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {MODES.map((m) => {
            const Icon = m.icon;
            const selected = value === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onChange(m.key)}
                className={`text-left rounded-lg border p-4 transition-colors hover-elevate active-elevate-2 ${
                  selected ? "border-primary bg-primary/5" : "border-border"
                }`}
                data-testid={m.testId}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="font-medium">{m.title}</span>
                  {selected && <Badge variant="default" className="ml-auto text-xs">Vald</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{m.description}</p>
              </button>
            );
          })}
        </div>
        {value && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="text-mode-hint">
            <ChevronRight className="h-3 w-3" />
            Visar verktyg för: <strong>{MODE_LABELS[value]}</strong>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
