// Startvy för importen (Task #1344): EN tydlig huvudingång (matchningsimporten)
// plus grupperade sekundära ingångar. Ersätter de tidigare två väljarna
// (ImportDestinationChooser + ImportEntryChooser) som skapade tre konkurrerande
// ingångar utan förklaring.
// Task #1346: Avancerat-sektionen (Manuell CSV, Mappad import, Tre-stegs wizard)
// är borttagen — de vägarna täcks av matchningsimporten, Kundlistan och mallspåret.
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Layers,
  Database,
  History as HistoryIcon,
  FileSpreadsheet,
  ListChecks,
  ArrowRight,
  Info,
} from "lucide-react";

export type ImportSection = "objects" | "system" | "history";

interface Props {
  section: ImportSection | null;
  onSelect: (section: ImportSection) => void;
}

const MAIN_CHOICES: Array<{
  key: ImportSection;
  icon: typeof Layers;
  title: string;
  description: string;
  testId: string;
  primary?: boolean;
}> = [
  {
    key: "objects",
    icon: Layers,
    title: "Importera/uppdatera objekt",
    description:
      "Huvudflödet: ladda upp Excel/CSV, matcha kolumnerna mot rätt fält och metadatafält, validera och importera. Skapar nya objekt (inkl. hierarki) och uppdaterar befintliga.",
    testId: "button-section-objects",
    primary: true,
  },
  {
    key: "system",
    icon: Database,
    title: "Systemspecifika importer",
    description:
      "Modus 2.0, Fortnox, kundlistor, resurser, underobjekt, fakturamottagare, berika kärl samt diff & uppdatera.",
    testId: "button-section-system",
  },
  {
    key: "history",
    icon: HistoryIcon,
    title: "Historik & datakvalitet",
    description:
      "Se tidigare importer, följ pågående körningar, ångra batcher och granska datakvalitet.",
    testId: "button-section-history",
  },
];

export function ImportHub({ section, onSelect }: Props) {
  return (
    <Card data-testid="card-import-hub">
      <CardContent className="pt-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold">Vad vill du göra?</h2>
          <p className="text-sm text-muted-foreground">
            Excel (.xlsx) och CSV stöds. För objekt gäller ett sammanhängande flöde:{" "}
            <span className="font-medium text-foreground">
              exportera från Objekt-sidan → redigera/komplettera i Excel → läs tillbaka här med kolumnmatchning
            </span>
            . Samma flöde skapar även helt nya objekt och bygger hierarkin.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {MAIN_CHOICES.map((c) => {
            const Icon = c.icon;
            const selected = section === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onSelect(c.key)}
                className={`text-left rounded-lg border p-4 transition-colors hover-elevate active-elevate-2 ${
                  selected ? "border-primary bg-primary/5" : c.primary ? "border-primary/40" : "border-border"
                }`}
                data-testid={c.testId}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="font-medium">{c.title}</span>
                  {selected ? (
                    <Badge variant="default" className="ml-auto text-xs">Vald</Badge>
                  ) : c.primary ? (
                    <Badge variant="secondary" className="ml-auto text-xs">Rekommenderad</Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{c.description}</p>
              </button>
            );
          })}
        </div>

        {/* Mallspåret: fasta Excel-mallar (objektmall + namngivna importmallar) */}
        <div className="rounded-lg border border-border p-3 space-y-2" data-testid="section-mall-track">
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              <span className="font-medium text-foreground">Mallspåret</span> är ett alternativ för fasta
              Excel-mallar: bygg strukturen med <span className="font-medium text-foreground">interimnummer</span> för
              helt nya listor, eller uppdatera via systemnummer — utan kolumnmatchning (kolumnerna följer mallen).
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/objektmall-import"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover-elevate active-elevate-2"
              data-testid="link-mall-objektmall"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Objektmall-import
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </Link>
            <Link
              href="/import-templates"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover-elevate active-elevate-2"
              data-testid="link-mall-importmallar"
            >
              <ListChecks className="h-3.5 w-3.5" />
              Importmallar (bygg egna mallar)
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
