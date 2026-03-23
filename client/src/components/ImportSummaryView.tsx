import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Building2, Truck, FileSpreadsheet, Clock, CheckCircle, AlertCircle,
  ArrowRight, ClipboardList, Ban, Undo2
} from "lucide-react";

interface ModusObjectResult {
  importBatchId: string;
  imported: number;
  created: number;
  updated: number;
  parentsUpdated: number;
  customersCreated: number;
  skipped: number;
  metadataWritten: number;
  metadataColumns: string[];
  errors: string[];
  totalRows: number;
}

interface ImportResult {
  imported: number;
  errors: string[];
}

interface ModusEventsResult {
  totalEvents: number;
  uniqueTasks: number;
  calculatedSetupTimes: number;
  averageSetupTime: number;
  setupTimeDistribution: {
    under5min: number;
    "5to15min": number;
    "15to30min": number;
    over30min: number;
  };
}

interface ImportSummaryViewProps {
  completedSteps: Set<number>;
  skippedSteps: Set<number>;
  modusResults: {
    objects: ModusObjectResult | null;
    tasks: ImportResult | null;
    events: ModusEventsResult | null;
    "invoice-lines": ImportResult | null;
  };
  firstSkippedStep: number | null;
  onGoToStep: (step: number) => void;
  onReset: () => void;
}

export function ImportSummaryView({
  completedSteps,
  skippedSteps,
  modusResults,
  firstSkippedStep,
  onGoToStep,
  onReset,
}: ImportSummaryViewProps) {
  const allWarnings: string[] = [];
  if (modusResults.objects?.errors?.length) {
    allWarnings.push(...modusResults.objects.errors.slice(0, 10).map(e => `[Objekt] ${e}`));
    if (modusResults.objects.errors.length > 10) allWarnings.push(`[Objekt] ... och ${modusResults.objects.errors.length - 10} till`);
  }
  if (modusResults.tasks?.errors?.length) {
    allWarnings.push(...modusResults.tasks.errors.slice(0, 10).map(e => `[Uppgifter] ${e}`));
    if (modusResults.tasks.errors.length > 10) allWarnings.push(`[Uppgifter] ... och ${modusResults.tasks.errors.length - 10} till`);
  }
  if (modusResults["invoice-lines"]?.errors?.length) {
    allWarnings.push(...modusResults["invoice-lines"].errors.slice(0, 10).map(e => `[Fakturarader] ${e}`));
  }

  const stepConfig = [
    { step: 2, label: "Objekt", icon: <Building2 className="h-4 w-4" />, count: modusResults.objects ? `${modusResults.objects.created} skapade, ${modusResults.objects.updated} uppdaterade` : null, errorCount: modusResults.objects?.errors?.length || 0 },
    { step: 3, label: "Uppgifter", icon: <Truck className="h-4 w-4" />, count: modusResults.tasks ? `${modusResults.tasks.imported} importerade` : null, errorCount: modusResults.tasks?.errors?.length || 0 },
    { step: 4, label: "Fakturarader", icon: <FileSpreadsheet className="h-4 w-4" />, count: modusResults["invoice-lines"] ? `${modusResults["invoice-lines"].imported} importerade` : null, errorCount: modusResults["invoice-lines"]?.errors?.length || 0 },
    { step: 5, label: "Händelser", icon: <Clock className="h-4 w-4" />, count: modusResults.events ? `${modusResults.events.totalEvents} analyserade` : null, errorCount: 0 },
  ];

  return (
    <Card data-testid="card-import-summary-final">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-green-600 text-white text-sm font-bold">
            <ClipboardList className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base">Sammanfattning</CardTitle>
            <CardDescription>Översikt av importerade och överhoppade steg</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stepConfig.map(({ step, label, icon, count, errorCount }) => (
            <div key={step} className={`p-3 rounded-lg border text-center ${
              completedSteps.has(step) ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800" :
              skippedSteps.has(step) ? "bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700" :
              "bg-muted/30 border-transparent"
            }`} data-testid={`summary-step-${step}`}>
              <div className="flex items-center justify-center gap-2 mb-1">
                {icon}
                <span className="text-sm font-medium">{label}</span>
              </div>
              {completedSteps.has(step) ? (
                <div>
                  <Badge variant="default" className={`text-xs ${errorCount > 0 ? "bg-amber-600" : "bg-green-600"}`}>
                    {errorCount > 0 ? (
                      <><AlertCircle className="h-3 w-3 mr-1" />Med varningar</>
                    ) : (
                      <><CheckCircle className="h-3 w-3 mr-1" />Importerad</>
                    )}
                  </Badge>
                  {count && <p className="text-xs text-muted-foreground mt-1">{count}</p>}
                  {errorCount > 0 && <p className="text-xs text-orange-600 mt-0.5">{errorCount} varningar</p>}
                </div>
              ) : skippedSteps.has(step) ? (
                <Badge variant="secondary" className="text-xs">
                  <Ban className="h-3 w-3 mr-1" />
                  Överhoppad
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">Ej påbörjad</Badge>
              )}
            </div>
          ))}
        </div>

        {skippedSteps.size > 0 && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-md text-sm text-amber-700 dark:text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{skippedSteps.size} steg hoppades över.</span>
            {firstSkippedStep && (
              <Button variant="outline" size="sm" className="ml-auto" onClick={() => onGoToStep(firstSkippedStep)} data-testid="button-import-remaining">
                <ArrowRight className="h-3 w-3 mr-1" />
                Importera resten
              </Button>
            )}
          </div>
        )}

        {skippedSteps.size === 0 && completedSteps.size >= 4 && (
          <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-md text-sm text-green-700 dark:text-green-300">
            <CheckCircle className="h-4 w-4 shrink-0" />
            Alla steg har genomförts. Importen är komplett.
          </div>
        )}

        {allWarnings.length > 0 && (
          <details className="border rounded-md p-3" data-testid="summary-warnings">
            <summary className="text-sm font-medium text-orange-600 cursor-pointer flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {allWarnings.length} varningar/problem
            </summary>
            <ScrollArea className="h-40 mt-2">
              <ul className="text-xs text-muted-foreground space-y-1 ml-4 list-disc">
                {allWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </ScrollArea>
          </details>
        )}

        <Button variant="outline" size="sm" onClick={onReset} data-testid="button-reset-import">
          <Undo2 className="h-4 w-4 mr-1" />
          Börja om
        </Button>
      </CardContent>
    </Card>
  );
}
