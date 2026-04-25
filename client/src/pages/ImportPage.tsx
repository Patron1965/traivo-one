import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Upload, Users, Building2, Truck, Trash2, CheckCircle, AlertCircle, 
  Loader2, Download, Eye, X, FileUp, Check, Clock, FileSpreadsheet, Database,
  ArrowRight, Info, Settings, ChevronDown, ChevronUp, ListChecks, History, Undo2,
  SkipForward, Ban, BarChart3, ClipboardList, Tag, AlertTriangle, Merge, Copy, Link2
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ImportSummaryView } from "@/components/ImportSummaryView";
import { ImportHealthOverview } from "@/components/ImportHealthOverview";
import ImportColumnMapper from "@/components/ImportColumnMapper";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Papa from "papaparse";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { Customer, Resource, ServiceObject } from "@shared/schema";
import { ImportPreviewPanel, ResourcePreviewPanel, type NameOverrides } from "@/components/ImportPreviewPanel";
import { DataQualityDashboard } from "@/components/DataQualityDashboard";

type ImportType = "customers" | "resources" | "objects";
type ModusImportType = "objects" | "tasks" | "events" | "invoice-lines";

interface ImportResult {
  imported: number;
  errors: string[];
}

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

interface ImportBatch {
  batchId: string;
  objects: number;
  workOrders: number;
  customers: number;
  importedAt: string | null;
}

interface SSEProgress {
  status: "running" | "completed" | "failed" | "not_found";
  phase: string;
  processed: number;
  total: number;
  created: number;
  updated: number;
  errors: number;
  result?: ModusObjectResult;
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

interface ScorecardProblemRow {
  row: number;
  name: string;
  issue?: string;
  missingFields?: string[];
  modusId?: string;
  address?: string;
  hasCoords?: boolean;
}

interface ScorecardCategory {
  label: string;
  score: number;
  ok: number;
  total: number;
  details: Record<string, number>;
  problemRows: ScorecardProblemRow[];
}

interface DataHealthScorecard {
  overallScore: number;
  categories: {
    addresses: ScorecardCategory;
    requiredFields: ScorecardCategory;
    accessInfo: ScorecardCategory;
    duplicates: ScorecardCategory;
  };
}

interface ModusValidationResult {
  totalRows: number;
  columns: string[];
  missingFields: { row: number; fields: string[] }[];
  missingFieldsCount: number;
  duplicateModusIds: { modusId: string; rows: number[] }[];
  duplicateModusIdsCount: number;
  invalidCoordinates: { row: number; lat: string; lng: string }[];
  invalidCoordinatesCount: number;
  customersExisting: string[];
  customersNew: string[];
  objectsExisting: number;
  objectsNew: number;
  missingParents: string[];
  metadataColumns: string[];
  warnings: string[];
  scorecard: DataHealthScorecard;
}

interface CustomerValidationResult {
  totalRows: number;
  preview: Array<{
    row: number;
    name: string;
    customerNumber: string;
    address: string;
    city: string;
    postalCode: string;
    contactPerson: string;
    email: string;
    phone: string;
    invoiceReference: string;
    duplicate: null | { type: string; existingId: string; existingName: string };
    errors: string[];
  }>;
  duplicateCount: number;
  errorCount: number;
  newCount: number;
  csvDuplicates: Array<{ value: string; type: string; rows: number[] }>;
  columns: string[];
}

interface ParsedRow {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
  isValid: boolean;
}

const CSV_TEMPLATES: Record<ImportType, { headers: string[]; example: string[][] }> = {
  customers: {
    headers: ["namn", "kundnummer", "kontaktperson", "epost", "telefon", "adress", "stad", "postnummer"],
    example: [
      ["Telgebostäder AB", "TELGE001", "Anna Andersson", "anna@telge.se", "08-123456", "Storgatan 1", "Södertälje", "15130"],
      ["Serviceboendet Linden", "LINDEN01", "Erik Eriksson", "erik@linden.se", "08-654321", "Lindvägen 5", "Stockholm", "11234"],
    ],
  },
  resources: {
    headers: ["namn", "initialer", "telefon", "epost", "hemort", "timmar", "kompetenser"],
    example: [
      ["Anders Andersson", "AA", "070-1234567", "anders@kinab.se", "Södertälje", "40", "sophamtning,tungt"],
      ["Bella Bengtsson", "BB", "070-7654321", "bella@kinab.se", "Stockholm", "40", "sophamtning,matafall"],
    ],
  },
  objects: {
    headers: ["kund", "namn", "objektnummer", "typ", "niva", "foralder", "adress", "stad", "postnummer", "tillgang", "portkod", "nyckelnummer", "karl", "k2", "k3", "k4"],
    example: [
      ["Telgebostäder AB", "Grönområdet", "GRN001", "omrade", "1", "", "Grönvägen", "Södertälje", "15130", "open", "", "", "0", "0", "0", "0"],
      ["Telgebostäder AB", "Grönvägen 1", "GRN001-1", "fastighet", "2", "Grönområdet", "Grönvägen 1", "Södertälje", "15130", "code", "1234", "", "4", "2", "1", "0"],
      ["Telgebostäder AB", "Soprum A", "GRN001-1-A", "soprum", "3", "Grönvägen 1", "Grönvägen 1", "Södertälje", "15130", "key", "", "N-14", "8", "4", "2", "0"],
    ],
  },
};

const IMPORT_TYPES_INFO = [
  { 
    type: "customers" as ImportType, 
    label: "Kunder", 
    icon: Users, 
    description: "Bostadsbolag och fastighetsägare",
  },
  { 
    type: "resources" as ImportType, 
    label: "Resurser", 
    icon: Truck, 
    description: "Chaufförer och tekniker",
  },
  { 
    type: "objects" as ImportType, 
    label: "Objekt", 
    icon: Building2, 
    description: "Fastigheter, soprum och behållare",
  },
];

const MODUS_OBJECT_COLUMNS = [
  { name: "Id", required: true, description: "Unikt Modus-ID för objektet" },
  { name: "Namn", required: true, description: "Objektets namn (t.ex. fastighetsnamn)" },
  { name: "Typ", required: true, description: "Objekttyp: Fastighet, Adress, Soprum, etc." },
  { name: "Parent", required: false, description: "ID för överordnat objekt (hierarki)" },
  { name: "Kund", required: false, description: "Kundnamn, ofta i format 'Namn (ID)'" },
  { name: "Latitud", required: false, description: "GPS-koordinat (komma ersätts automatiskt med punkt)" },
  { name: "Longitud", required: false, description: "GPS-koordinat (komma ersätts automatiskt med punkt)" },
  { name: "Adress 1", required: false, description: "Gatuadress" },
  { name: "Ort", required: false, description: "Ort/stad" },
  { name: "Postnummer", required: false, description: "Postnummer" },
  { name: "Beskrivning", required: false, description: "Rad 2=Kontaktperson, Rad 3=Telefon, Rad 4=E-post" },
  { name: "Metadata - *", required: false, description: "Alla kolumner som börjar med 'Metadata - ' importeras automatiskt" },
];

const MODUS_TASK_COLUMNS = [
  { name: "Uppgifts Id", required: true, description: "Unikt ID för uppgiften" },
  { name: "Objekt", required: true, description: "Referens till Modus objekt-ID" },
  { name: "Kund", required: false, description: "Kundnamn i format 'Namn (ID)'" },
  { name: "Uppgiftsnamn", required: false, description: "Titel på arbetsorderna" },
  { name: "Uppgiftstyp", required: false, description: "Kärltvätt, Rumstvätt, Tvätt UJ-behållare" },
  { name: "Jobb", required: false, description: "Jobbgruppering, format 'Namn (ID)'" },
  { name: "Beställning", required: false, description: "Beställningsnummer" },
  { name: "Prislista", required: false, description: "Prislistans namn (t.ex. Vafab Miljö)" },
  { name: "Varaktighet", required: false, description: "Uppskattad tid i minuter" },
  { name: "Kostnad", required: false, description: "Beräknad kostnad (komma-decimal)" },
  { name: "Pris", required: false, description: "Beräknat pris (komma-decimal)" },
  { name: "Status", required: false, description: "done, not_started, in_progress, not_feasible" },
  { name: "Resultat", required: false, description: "Anteckningar/kommentarer från fältarbetare" },
  { name: "Fakturerad", required: false, description: "1 = fakturerad, 0 = ej fakturerad" },
  { name: "Starttid", required: false, description: "Startdatum i ISO-format" },
  { name: "Sluttid", required: false, description: "Slutdatum i ISO-format" },
  { name: "Planerad år", required: false, description: "Planerat år (t.ex. 2024)" },
  { name: "Planerad vecka", required: false, description: "Planerad vecka (1-52)" },
  { name: "Planerad dag o tid", required: false, description: "Datum och tid i ISO-format" },
  { name: "Team", required: false, description: "Resursnamn/fordons-ID (skapas automatiskt)" },
];

const MODUS_INVOICE_COLUMNS = [
  { name: "Uppgift Id", required: true, description: "Kopplar fakturaraden till en uppgift" },
  { name: "Rad", required: false, description: "Radnummer inom uppgiften" },
  { name: "Beskrivning", required: false, description: "Beskrivning: 'Adress: Tjänstetyp'" },
  { name: "Antal", required: false, description: "Antal enheter" },
  { name: "Pris", required: false, description: "Styckpris (komma-decimal, t.ex. 156,56)" },
  { name: "Fortnox Artikel Id", required: false, description: "Artikelkod: K100 (kärltvätt), UJ100 (underjord)" },
  { name: "Fortnox Kostnadsställe", required: false, description: "Kostnadsställe i Fortnox" },
  { name: "Fortnox Projekt", required: false, description: "Projektkod/team-referens" },
];

const MODUS_EVENT_COLUMNS = [
  { name: "Event Id", required: false, description: "Löpnummer för händelsen" },
  { name: "Uppgifts Id", required: true, description: "Kopplar händelsen till en uppgift" },
  { name: "Event Typ", required: true, description: "in_progress, done, not_started, not_feasible" },
  { name: "Beskrivning", required: false, description: "Statusbeskrivning" },
  { name: "Tid", required: true, description: "Tidsstämpel för händelsen" },
];

function ImportHistorySection() {
  const { toast } = useToast();
  const historyQuery = useQuery<any[]>({
    queryKey: ["/api/import/history"],
  });

  const rollbackMutation = useMutation({
    mutationFn: (batchId: string) => {
      // Sanering-batches återställs via separat restore-endpoint som läser
      // audit-loggens before-värden istället för att radera objekten
      const url = batchId.startsWith("cleanup-")
        ? `/api/import/cleanup/restore/${batchId}`
        : `/api/import/rollback/${batchId}`;
      return apiRequest("POST", url);
    },
    onSuccess: (data: any, batchId) => {
      if (typeof batchId === "string" && batchId.startsWith("cleanup-")) {
        toast({
          title: "Sanering återställd",
          description: `${data.restored || 0} objekt återställda från audit-loggen.`,
        });
      } else {
        toast({
          title: "Import ångrad",
          description: `${data.rolledBack?.objects || 0} objekt, ${data.rolledBack?.workOrders || 0} ordrar, ${data.rolledBack?.customers || 0} kunder inaktiverade.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/import/history"] });
    },
    onError: (err: Error) => {
      toast({ title: "Fel vid ångring", description: err.message, variant: "destructive" });
    },
  });

  const [confirmBatchId, setConfirmBatchId] = useState<string | null>(null);
  const batches = historyQuery.data || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <History className="h-5 w-5" />
            Importhistorik
          </CardTitle>
          <CardDescription>Visa och hantera tidigare importer. Du kan ångra en import genom att inaktivera alla poster i batchen.</CardDescription>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : batches.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Ingen importhistorik hittades.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {batches.map((batch: any) => {
                const isRolledBack = batch.metadata?.rolledBack === true;
                return (
                  <div key={batch.id} className={`flex items-center justify-between p-3 rounded-lg border ${isRolledBack ? "bg-muted/50 opacity-60" : "bg-background"}`} data-testid={`history-batch-${batch.batchId}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${isRolledBack ? "bg-gray-400" : batch.errors > 0 ? "bg-amber-500" : "bg-green-500"}`} />
                      <div>
                        <div className="font-medium text-sm">
                          {batch.batchId}
                          {isRolledBack && <Badge variant="outline" className="ml-2 text-xs">Ångrad</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {batch.createdAt ? format(new Date(batch.createdAt), "d MMM yyyy HH:mm", { locale: sv }) : ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right text-xs">
                        <span className="text-green-600 font-medium">{batch.created || 0} nya</span>
                        <span className="text-muted-foreground mx-1">|</span>
                        <span className="text-orange-500 dark:text-orange-400">{batch.updated || 0} uppdaterade</span>
                        <span className="text-muted-foreground mx-1">|</span>
                        <span className={batch.errors > 0 ? "text-destructive font-medium" : "text-muted-foreground"}>{batch.errors || 0} fel</span>
                      </div>
                      {!isRolledBack && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setConfirmBatchId(batch.batchId)}
                          disabled={rollbackMutation.isPending}
                          data-testid={`button-rollback-${batch.batchId}`}
                        >
                          <Undo2 className="h-3 w-3 mr-1" />
                          Ångra
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmBatchId} onOpenChange={(open) => { if (!open) setConfirmBatchId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ångra import?</AlertDialogTitle>
            <AlertDialogDescription>
              Alla objekt, ordrar och kunder som importerades i denna batch kommer att inaktiveras. 
              Data raderas inte permanent men syns inte längre i systemet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-rollback">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmBatchId) {
                  rollbackMutation.mutate(confirmBatchId);
                  setConfirmBatchId(null);
                }
              }}
              data-testid="button-confirm-rollback"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Undo2 className="h-4 w-4 mr-1" />
              Ångra import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StepIndicator({ step, title, active, completed, skipped, onClick }: {
  step: number; title: string; active: boolean; completed: boolean; skipped?: boolean; onClick?: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
        active ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800" :
        completed ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800" :
        skipped ? "bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700 opacity-60" :
        "bg-muted/30 border border-transparent"
      } ${onClick ? "cursor-pointer hover:shadow-sm" : ""}`}
      onClick={onClick}
      data-testid={`step-indicator-${step}`}
    >
      <div className={`flex items-center justify-center h-8 w-8 rounded-full text-sm font-bold ${
        completed ? "bg-green-600 text-white" :
        skipped ? "bg-gray-400 text-white" :
        active ? "bg-blue-600 text-white" :
        "bg-muted text-muted-foreground"
      }`}>
        {completed ? <Check className="h-4 w-4" /> : skipped ? <Ban className="h-4 w-4" /> : step}
      </div>
      <div className="flex flex-col">
        <span className={`text-sm font-medium ${
          active ? "text-blue-700 dark:text-blue-300" :
          completed ? "text-green-700 dark:text-green-300" :
          skipped ? "text-gray-400 dark:text-gray-500" :
          "text-muted-foreground"
        }`}>{title}</span>
        {skipped && <span className="text-[10px] text-gray-400">Ej importerat</span>}
      </div>
    </div>
  );
}

function getScorecardColor(score: number): string {
  if (score > 90) return "text-green-600";
  if (score >= 70) return "text-yellow-600";
  return "text-red-600";
}

function getScorecardBg(score: number): string {
  if (score > 90) return "bg-green-100 dark:bg-green-950/30 border-green-200 dark:border-green-800";
  if (score >= 70) return "bg-yellow-100 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800";
  return "bg-red-100 dark:bg-red-950/30 border-red-200 dark:border-red-800";
}

function getScorecardProgressColor(score: number): string {
  if (score > 90) return "bg-green-500";
  if (score >= 70) return "bg-yellow-500";
  return "bg-red-500";
}

function getScorecardLabel(score: number): string {
  if (score > 90) return "Utmärkt";
  if (score >= 70) return "Acceptabel";
  return "Behöver åtgärdas";
}

function getScorecardIcon(score: number) {
  if (score > 90) return <CheckCircle className="h-4 w-4 text-green-600" />;
  if (score >= 70) return <AlertCircle className="h-4 w-4 text-yellow-600" />;
  return <X className="h-4 w-4 text-red-600" />;
}

function DataHealthScorecardView({ scorecard, validation, onExportProblems }: { 
  scorecard: DataHealthScorecard; 
  validation: ModusValidationResult;
  onExportProblems: () => void;
}) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const categories = Object.entries(scorecard.categories) as [string, ScorecardCategory][];

  return (
    <div className="space-y-4" data-testid="data-health-scorecard">
      <div className={`flex items-center gap-4 p-4 rounded-lg border ${getScorecardBg(scorecard.overallScore)}`}>
        <div className="flex flex-col items-center justify-center min-w-[80px]">
          <div className={`text-3xl font-bold ${getScorecardColor(scorecard.overallScore)}`} data-testid="text-scorecard-overall">
            {scorecard.overallScore}%
          </div>
          <div className={`text-xs font-medium ${getScorecardColor(scorecard.overallScore)}`}>
            {getScorecardLabel(scorecard.overallScore)}
          </div>
        </div>
        <div className="flex-1 space-y-1">
          <div className="text-sm font-medium">Data Health Score</div>
          <div className="text-xs text-muted-foreground">
            Sammanfattning av datakvaliteten i {validation.totalRows} rader
          </div>
          <div className="w-full bg-muted rounded-full h-2 mt-2">
            <div
              className={`h-2 rounded-full transition-all ${getScorecardProgressColor(scorecard.overallScore)}`}
              style={{ width: `${scorecard.overallScore}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {categories.map(([key, cat]) => (
          <button
            key={key}
            onClick={() => setExpandedCategory(expandedCategory === key ? null : key)}
            className={`text-left p-3 rounded-lg border transition-all hover:shadow-sm ${
              expandedCategory === key ? "ring-2 ring-blue-400" : ""
            } ${cat.score > 90 ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800" : 
                cat.score >= 70 ? "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800" : 
                "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"}`}
            data-testid={`scorecard-category-${key}`}
          >
            <div className="flex items-center gap-2 mb-1">
              {getScorecardIcon(cat.score)}
              <span className="text-xs font-medium truncate">{cat.label}</span>
            </div>
            <div className={`text-xl font-bold ${getScorecardColor(cat.score)}`}>{cat.score}%</div>
            <div className="text-xs text-muted-foreground">{cat.ok} / {cat.total}</div>
            <div className="w-full bg-muted rounded-full h-1.5 mt-2">
              <div
                className={`h-1.5 rounded-full ${getScorecardProgressColor(cat.score)}`}
                style={{ width: `${cat.score}%` }}
              />
            </div>
          </button>
        ))}
      </div>

      {expandedCategory && scorecard.categories[expandedCategory as keyof typeof scorecard.categories] && (() => {
        const cat = scorecard.categories[expandedCategory as keyof typeof scorecard.categories];
        return (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/30" data-testid={`scorecard-detail-${expandedCategory}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {getScorecardIcon(cat.score)}
                <span className="font-medium text-sm">{cat.label} — detaljer</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setExpandedCategory(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>

            <div className="flex flex-wrap gap-3 text-xs">
              {Object.entries(cat.details).map(([k, v]) => (
                <div key={k} className="px-2 py-1 bg-background rounded border">
                  <span className="text-muted-foreground">{
                    k === "withCoords" ? "Med koordinater" :
                    k === "withAddress" ? "Med adress" :
                    k === "complete" ? "Komplett" :
                    k === "geocoded" ? "Geokodade" :
                    k === "geocodeFailed" ? "Geokodning misslyckad" :
                    k === "geocodeSkipped" ? "Ej testade" :
                    k === "hasName" ? "Har namn" :
                    k === "hasId" ? "Har ID" :
                    k === "hasType" ? "Har typ" :
                    k === "withAccessCode" ? "Med portkod" :
                    k === "withKeyNumber" ? "Med nyckel" :
                    k === "relevant" ? "Relevanta" :
                    k === "uniqueIds" ? "Unika" :
                    k === "duplicateIds" ? "Dubbletter" :
                    k
                  }: </span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
            </div>

            {cat.problemRows.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Rader med problem ({cat.problemRows.length}{cat.problemRows.length >= 100 ? "+" : ""})
                </p>
                <ScrollArea className="h-40 border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16 text-xs">Rad</TableHead>
                        <TableHead className="text-xs">Namn</TableHead>
                        <TableHead className="text-xs">Problem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cat.problemRows.map((pr, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{pr.row}</TableCell>
                          <TableCell className="text-xs">{pr.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {pr.issue || pr.missingFields?.join(", ") || pr.modusId || ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            )}
          </div>
        );
      })()}

      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onExportProblems} data-testid="button-export-problems">
          <Download className="h-4 w-4 mr-2" />
          Exportera problemrader (CSV)
        </Button>
      </div>
    </div>
  );
}

function ColumnTable({ columns }: { columns: { name: string; required: boolean; description: string }[] }) {
  return (
    <div className="border rounded-md overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[160px]">Kolumn</TableHead>
            <TableHead className="w-[80px]">Krävs</TableHead>
            <TableHead>Beskrivning</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {columns.map((col) => (
            <TableRow key={col.name}>
              <TableCell className="font-mono text-xs">{col.name}</TableCell>
              <TableCell>
                {col.required ? (
                  <Badge variant="default" className="text-xs">Ja</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">Nej</Badge>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{col.description}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface FortnoxXlsxPreviewCustomer {
  rowNum: number;
  customerNumber: string;
  name: string;
  orgNumber: string;
  address: string;
  postalCode: string;
  city: string;
  email: string;
  invoiceEmail: string;
  phone: string;
  contactPerson: string;
  isDuplicate: boolean;
  matchType: "fortnox_mapping" | "customer_number" | "name" | null;
  existingMatch: { id: string; name: string } | null;
}

interface FortnoxXlsxValidateResponse {
  totalRows: number;
  preview: FortnoxXlsxPreviewCustomer[];
  duplicateCount: number;
  newCount: number;
  errorCount: number;
  errorRows: { rowNum: number; reason: string; name: string }[];
}

interface FortnoxXlsxBulkResponse {
  success: boolean;
  importBatchId: string;
  customers: { created: number; merged: number; skipped: number };
  objects: { created: number; geocodingQueued: number };
  errorCount: number;
  errors: string[];
}

function FortnoxXlsxImportPanel() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FortnoxXlsxValidateResponse | null>(null);
  const [bulkResult, setBulkResult] = useState<FortnoxXlsxBulkResponse | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateMutation = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/import/fortnox-customers/validate", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Kunde inte läsa filen");
      }
      return res.json() as Promise<FortnoxXlsxValidateResponse>;
    },
    onSuccess: (data) => {
      setPreview(data);
      setBulkResult(null);
      toast({ title: `${data.preview.length} företagskunder hittades (${data.newCount} nya, ${data.duplicateCount} dubbletter)` });
    },
    onError: (e: Error) => toast({ title: "Validering misslyckades", description: e.message, variant: "destructive" }),
  });

  const bulkMutation = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("mode", mergeMode ? "merge" : "skip");
      const res = await fetch("/api/import/fortnox-customers/bulk", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Import misslyckades");
      }
      return res.json() as Promise<FortnoxXlsxBulkResponse>;
    },
    onSuccess: (data) => {
      setBulkResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fortnox/mappings"] });
      toast({
        title: `Import klar – ${data.customers.created} nya, ${data.customers.merged} uppdaterade, ${data.customers.skipped} hoppade`,
        description: `${data.objects.created} fastighet-objekt skapade, ${data.objects.geocodingQueued} köade för geokodning`,
      });
    },
    onError: (e: Error) => toast({ title: "Import misslyckades", description: e.message, variant: "destructive" }),
  });

  const handleFileChange = (f: File | null) => {
    setFile(f);
    setPreview(null);
    setBulkResult(null);
    if (f) validateMutation.mutate(f);
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setBulkResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="space-y-2 text-sm">
              <p className="font-medium">Importera kunder från Fortnox-utdrag (xlsx)</p>
              <p className="text-muted-foreground">
                Ladda upp en Fortnox-export (xlsx) av kundregistret. Systemet skapar automatiskt en
                kund + ett fastighet-objekt per rad och kopplar dem mot Fortnox via kundnummer.
                Adresser geokodas i bakgrunden. Befintliga kunder med samma Fortnox-kundnummer hoppas över.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileUp className="h-4 w-4" />
            Steg 1 – Ladda upp xlsx-fil
          </CardTitle>
          <CardDescription>Excel-export från Fortnox med kolumner som customer_number, name, delivery_address, …</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            disabled={validateMutation.isPending || bulkMutation.isPending}
            data-testid="input-fortnox-xlsx-file"
          />
          {file && (
            <div className="text-sm text-muted-foreground" data-testid="text-fortnox-file-info">
              {file.name} ({(file.size / 1024).toFixed(1)} kB)
            </div>
          )}
          {validateMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Läser och validerar …
            </div>
          )}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Steg 2 – Förhandsgranskning
            </CardTitle>
            <CardDescription>
              {preview.totalRows} rader totalt, {preview.preview.length} företagskunder
              ({preview.newCount} nya, {preview.duplicateCount} dubbletter, {preview.errorCount} hoppade)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md border p-3" data-testid="stat-total-rows">
                <div className="text-xs text-muted-foreground">Totalt rader</div>
                <div className="text-2xl font-semibold">{preview.totalRows}</div>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-new-rows">
                <div className="text-xs text-muted-foreground">Nya att importera</div>
                <div className="text-2xl font-semibold text-green-600">{preview.newCount}</div>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-duplicates">
                <div className="text-xs text-muted-foreground">Dubbletter</div>
                <div className="text-2xl font-semibold text-amber-600">{preview.duplicateCount}</div>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-errors">
                <div className="text-xs text-muted-foreground">Fel/hoppade</div>
                <div className="text-2xl font-semibold text-muted-foreground">{preview.errorCount}</div>
              </div>
            </div>

            {preview.duplicateCount > 0 && (
              <div className="flex items-center gap-2 rounded-md border p-3 bg-muted/30">
                <Checkbox
                  id="merge-mode"
                  checked={mergeMode}
                  onCheckedChange={(c) => setMergeMode(c === true)}
                  data-testid="checkbox-merge-mode"
                />
                <label htmlFor="merge-mode" className="text-sm cursor-pointer">
                  <span className="font-medium">Uppdatera befintliga kunder (merge)</span>
                  <span className="text-muted-foreground ml-2">– annars hoppas dubbletter över</span>
                </label>
              </div>
            )}

            {preview.errorRows.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 text-sm">
                <div className="font-medium mb-1 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  {preview.errorRows.length} rader hoppas över
                </div>
                <ul className="text-xs text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
                  {preview.errorRows.slice(0, 20).map((s) => (
                    <li key={s.rowNum}>Rad {s.rowNum}: {s.reason} – {s.name || "(utan namn)"}</li>
                  ))}
                  {preview.errorRows.length > 20 && <li>… och {preview.errorRows.length - 20} till</li>}
                </ul>
              </div>
            )}

            <ScrollArea className="h-72 border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Kundnr</TableHead>
                    <TableHead>Namn</TableHead>
                    <TableHead>Adress</TableHead>
                    <TableHead>Ort</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.preview.slice(0, 200).map((c) => {
                    const dupLabel = c.matchType === "fortnox_mapping" ? "Fortnox-koppling"
                      : c.matchType === "customer_number" ? "Kundnr"
                      : c.matchType === "name" ? "Namn"
                      : null;
                    return (
                      <TableRow key={c.customerNumber} data-testid={`row-fortnox-${c.customerNumber}`}>
                        <TableCell className="text-xs text-muted-foreground">{c.rowNum}</TableCell>
                        <TableCell className="font-mono text-xs">{c.customerNumber}</TableCell>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-xs">{c.address || "-"}</TableCell>
                        <TableCell className="text-xs">{[c.postalCode, c.city].filter(Boolean).join(" ") || "-"}</TableCell>
                        <TableCell>
                          {c.isDuplicate ? (
                            <Badge variant="secondary" className="text-xs" title={`Match via ${dupLabel}`}>
                              Dubblett ({dupLabel})
                            </Badge>
                          ) : (
                            <Badge className="text-xs bg-green-600">Ny</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {preview.preview.length > 200 && (
                <div className="p-2 text-center text-xs text-muted-foreground">
                  Visar 200 av {preview.preview.length} – alla bearbetas
                </div>
              )}
            </ScrollArea>

            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" onClick={reset} data-testid="button-fortnox-reset">
                <X className="h-4 w-4 mr-1" /> Rensa
              </Button>
              <Button
                onClick={() => file && bulkMutation.mutate(file)}
                disabled={!file || bulkMutation.isPending || (preview.newCount === 0 && !mergeMode)}
                data-testid="button-fortnox-import"
              >
                {bulkMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importerar …</>
                ) : mergeMode ? (
                  <><Check className="h-4 w-4 mr-1" /> Importera {preview.newCount} nya + uppdatera {preview.duplicateCount}</>
                ) : (
                  <><Check className="h-4 w-4 mr-1" /> Importera {preview.newCount} nya kunder</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {bulkResult && (
        <Card className="border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/10">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Import klar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-md border p-3" data-testid="stat-imported-customers">
                <div className="text-xs text-muted-foreground">Kunder skapade</div>
                <div className="text-2xl font-semibold text-green-600">{bulkResult.customers.created}</div>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-merged-customers">
                <div className="text-xs text-muted-foreground">Kunder uppdaterade</div>
                <div className="text-2xl font-semibold text-blue-600">{bulkResult.customers.merged}</div>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-skipped">
                <div className="text-xs text-muted-foreground">Hoppade över</div>
                <div className="text-2xl font-semibold">{bulkResult.customers.skipped}</div>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-imported-objects">
                <div className="text-xs text-muted-foreground">Objekt skapade</div>
                <div className="text-2xl font-semibold text-green-600">{bulkResult.objects.created}</div>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-geocoding">
                <div className="text-xs text-muted-foreground">Geokodning köad</div>
                <div className="text-2xl font-semibold">{bulkResult.objects.geocodingQueued}</div>
              </div>
            </div>
            {bulkResult.errorCount > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30 p-3 text-sm">
                <div className="font-medium mb-1 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  {bulkResult.errorCount} fel
                </div>
                <ul className="text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
                  {bulkResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="outline" onClick={reset} data-testid="button-fortnox-done">Stäng</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// FORTNOX FAKTURAHISTORIK → AVTALSFÖRSLAG
// ============================================================================

interface FortnoxInvoiceSuggestion {
  fortnoxCustomerNumber: string;
  customerName: string;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  articleNumber: string | null;
  articleDescription: string;
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  avgIntervalDays: number | null;
  suggestedBillingCycle: string;
  avgPrice: number | null;
  avgQuantity: number | null;
  totalRevenue: number;
  monthlyValue: number | null;
  confidence: number | null;
  rawSamples: Array<{ date: string; quantity: number; price: number; total: number }>;
}

interface FortnoxInvoiceAnalyzeResponse {
  importBatchId: string | null;
  persisted: boolean;
  totalLines: number;
  totalGroups: number;
  uniqueCustomers: number;
  suggestionsCount: number;
  matchedCustomers: number;
  unmatchedCustomers: number;
  suggestions: FortnoxInvoiceSuggestion[];
}

interface PersistedSuggestion {
  id: string;
  importBatchId: string;
  customerId: string | null;
  fortnoxCustomerNumber: string;
  customerName: string;
  articleNumber: string | null;
  articleDescription: string;
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  avgIntervalDays: number | null;
  suggestedBillingCycle: string;
  avgPrice: number | null;
  avgQuantity: number | null;
  totalRevenue: number;
  monthlyValue: number | null;
  confidence: number | null;
  status: string;
  createdContractId: string | null;
  createdAt: string;
}

function billingCycleLabel(cycle: string): string {
  switch (cycle) {
    case "weekly": return "Vecka";
    case "monthly": return "Månad";
    case "quarterly": return "Kvartal";
    case "biannual": return "Halvår";
    case "yearly": return "År";
    default: return cycle;
  }
}

function FortnoxInvoiceImportPanel() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [minOccurrences, setMinOccurrences] = useState(3);
  const [minSpanDays, setMinSpanDays] = useState(60);
  const [analysis, setAnalysis] = useState<FortnoxInvoiceAnalyzeResponse | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const persistedQuery = useQuery<{ suggestions: PersistedSuggestion[] }>({
    queryKey: ["/api/import/fortnox-invoices/suggestions", { status: "pending" }],
    queryFn: async () => {
      const res = await fetch("/api/import/fortnox-invoices/suggestions?status=pending", { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta förslag");
      return res.json();
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async (params: { file: File; persist: boolean }) => {
      const fd = new FormData();
      fd.append("file", params.file);
      fd.append("minOccurrences", String(minOccurrences));
      fd.append("minSpanDays", String(minSpanDays));
      fd.append("persist", String(params.persist));
      const res = await fetch("/api/import/fortnox-invoices/analyze", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Analys misslyckades");
      }
      return res.json() as Promise<FortnoxInvoiceAnalyzeResponse>;
    },
    onSuccess: (data, vars) => {
      setAnalysis(data);
      setBatchId(data.importBatchId);
      toast({
        title: vars.persist
          ? `${data.suggestionsCount} förslag sparade för granskning`
          : `${data.suggestionsCount} förslag (förhandsgranskning)`,
        description: `${data.totalLines} fakturarader, ${data.uniqueCustomers} kunder. ${data.matchedCustomers} matchade kunder, ${data.unmatchedCustomers} omatchade.`,
      });
      if (vars.persist) {
        queryClient.invalidateQueries({ queryKey: ["/api/import/fortnox-invoices/suggestions"] });
      }
    },
    onError: (e: Error) => toast({ title: "Analys misslyckades", description: e.message, variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/import/fortnox-invoices/suggestions/${id}/approve`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Avtal skapat" });
      queryClient.invalidateQueries({ queryKey: ["/api/import/fortnox-invoices/suggestions"] });
    },
    onError: (e: Error) => toast({ title: "Kunde inte godkänna", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/import/fortnox-invoices/suggestions/${id}/reject`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Förslag avvisat" });
      queryClient.invalidateQueries({ queryKey: ["/api/import/fortnox-invoices/suggestions"] });
    },
    onError: (e: Error) => toast({ title: "Kunde inte avvisa", description: e.message, variant: "destructive" }),
  });

  const handleFileChange = (f: File | null) => {
    setFile(f);
    setAnalysis(null);
    setBatchId(null);
  };

  const reset = () => {
    setFile(null);
    setAnalysis(null);
    setBatchId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const persisted = persistedQuery.data?.suggestions || [];

  return (
    <div className="space-y-4">
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="space-y-2 text-sm">
              <p className="font-medium">Importera Fortnox-fakturahistorik → avtalsförslag</p>
              <p className="text-muted-foreground">
                Ladda upp en Fortnox-export (xlsx) av historiska fakturor. Systemet identifierar
                återkommande artiklar per kund (t.ex. samma städning varje månad) och föreslår
                tjänsteavtal. Förslag måste godkännas innan de blir skarpa avtal.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileUp className="h-4 w-4" />
            Steg 1 – Ladda upp fakturaexport
          </CardTitle>
          <CardDescription>
            Excel med kolumner som InvoiceNumber, InvoiceDate, CustomerNumber, ArticleNumber/Description, Quantity, Price.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            disabled={analyzeMutation.isPending}
            data-testid="input-fortnox-invoice-file"
          />
          {file && (
            <div className="text-sm text-muted-foreground" data-testid="text-fortnox-invoice-file-info">
              {file.name} ({(file.size / 1024).toFixed(1)} kB)
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Min antal fakturor per artikel</label>
              <Input
                type="number"
                min={2}
                max={50}
                value={minOccurrences}
                onChange={(e) => setMinOccurrences(parseInt(e.target.value || "3", 10))}
                data-testid="input-min-occurrences"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Min tidsspann (dagar)</label>
              <Input
                type="number"
                min={0}
                max={3650}
                value={minSpanDays}
                onChange={(e) => setMinSpanDays(parseInt(e.target.value || "60", 10))}
                data-testid="input-min-span-days"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => file && analyzeMutation.mutate({ file, persist: false })}
              disabled={!file || analyzeMutation.isPending}
              variant="outline"
              data-testid="button-analyze-preview"
            >
              {analyzeMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
              Förhandsgranska
            </Button>
            <Button
              onClick={() => file && analyzeMutation.mutate({ file, persist: true })}
              disabled={!file || analyzeMutation.isPending}
              data-testid="button-analyze-persist"
            >
              {analyzeMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              Spara förslag för granskning
            </Button>
            {(file || analysis) && (
              <Button variant="ghost" onClick={reset} data-testid="button-fortnox-invoice-reset">
                Återställ
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {analysis && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Steg 2 – Analysresultat</CardTitle>
            <CardDescription>
              {analysis.totalLines} fakturarader · {analysis.uniqueCustomers} kunder · {analysis.suggestionsCount} förslag
              {batchId && <> · batch <code className="text-xs">{batchId.slice(0, 8)}</code></>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md border p-3" data-testid="stat-invoice-lines">
                <div className="text-xs text-muted-foreground">Fakturarader</div>
                <div className="text-2xl font-semibold">{analysis.totalLines}</div>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-invoice-suggestions">
                <div className="text-xs text-muted-foreground">Avtalsförslag</div>
                <div className="text-2xl font-semibold text-green-600">{analysis.suggestionsCount}</div>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-invoice-matched">
                <div className="text-xs text-muted-foreground">Matchade kunder</div>
                <div className="text-2xl font-semibold">{analysis.matchedCustomers}</div>
              </div>
              <div className="rounded-md border p-3" data-testid="stat-invoice-unmatched">
                <div className="text-xs text-muted-foreground">Omatchade kunder</div>
                <div className="text-2xl font-semibold text-amber-600">{analysis.unmatchedCustomers}</div>
              </div>
            </div>

            <ScrollArea className="h-80 border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kund</TableHead>
                    <TableHead>Artikel</TableHead>
                    <TableHead className="text-right">Antal</TableHead>
                    <TableHead>Cykel</TableHead>
                    <TableHead className="text-right">Snitt á-pris</TableHead>
                    <TableHead className="text-right">Mån.värde</TableHead>
                    <TableHead className="text-right">Totalt</TableHead>
                    <TableHead className="text-right">Konfidens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.suggestions.slice(0, 200).map((s, idx) => (
                    <TableRow key={`${s.fortnoxCustomerNumber}-${s.articleNumber}-${idx}`} data-testid={`row-preview-${idx}`}>
                      <TableCell>
                        <div className="text-sm font-medium">{s.customerName}</div>
                        <div className="text-xs text-muted-foreground">
                          #{s.fortnoxCustomerNumber}
                          {s.matchedCustomerId ? (
                            <Badge variant="outline" className="ml-2 text-xs">Kopplad</Badge>
                          ) : (
                            <Badge variant="secondary" className="ml-2 text-xs">Saknar kund</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs truncate" title={s.articleDescription}>
                        {s.articleNumber && <span className="text-xs text-muted-foreground mr-1">{s.articleNumber}</span>}
                        {s.articleDescription}
                      </TableCell>
                      <TableCell className="text-right">{s.occurrenceCount}</TableCell>
                      <TableCell>{billingCycleLabel(s.suggestedBillingCycle)}</TableCell>
                      <TableCell className="text-right">{s.avgPrice?.toFixed(0) ?? "-"}</TableCell>
                      <TableCell className="text-right">{s.monthlyValue?.toFixed(0) ?? "-"}</TableCell>
                      <TableCell className="text-right">{s.totalRevenue.toFixed(0)}</TableCell>
                      <TableCell className="text-right">
                        {s.confidence != null ? `${Math.round(s.confidence * 100)}%` : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
            {analysis.suggestions.length > 200 && (
              <div className="text-xs text-muted-foreground">Visar 200 av {analysis.suggestions.length} förslag</div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="h-4 w-4" />
            Sparade förslag (väntar på granskning)
          </CardTitle>
          <CardDescription>
            Godkänn för att skapa skarpa tjänsteavtal, eller avvisa för att ta bort förslaget.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {persistedQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Hämtar förslag …
            </div>
          ) : persisted.length === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-no-pending-suggestions">
              Inga väntande förslag. Spara förslag från en analys ovan för att granska dem här.
            </div>
          ) : (
            <ScrollArea className="h-96 border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kund</TableHead>
                    <TableHead>Artikel</TableHead>
                    <TableHead>Cykel</TableHead>
                    <TableHead className="text-right">Mån.värde</TableHead>
                    <TableHead className="text-right">Konfidens</TableHead>
                    <TableHead className="text-right">Åtgärder</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {persisted.map((s) => (
                    <TableRow key={s.id} data-testid={`row-suggestion-${s.id}`}>
                      <TableCell>
                        <div className="text-sm font-medium">{s.customerName}</div>
                        <div className="text-xs text-muted-foreground">
                          #{s.fortnoxCustomerNumber}
                          {!s.customerId && (
                            <Badge variant="secondary" className="ml-2 text-xs">Saknar kund</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs truncate" title={s.articleDescription}>
                        {s.articleNumber && <span className="text-xs text-muted-foreground mr-1">{s.articleNumber}</span>}
                        {s.articleDescription}
                      </TableCell>
                      <TableCell>{billingCycleLabel(s.suggestedBillingCycle)}</TableCell>
                      <TableCell className="text-right">{s.monthlyValue?.toFixed(0) ?? "-"}</TableCell>
                      <TableCell className="text-right">
                        {s.confidence != null ? `${Math.round(s.confidence * 100)}%` : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!s.customerId || approveMutation.isPending}
                            onClick={() => approveMutation.mutate(s.id)}
                            data-testid={`button-approve-suggestion-${s.id}`}
                          >
                            <Check className="h-3 w-3 mr-1" />
                            Godkänn
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={rejectMutation.isPending}
                            onClick={() => rejectMutation.mutate(s.id)}
                            data-testid={`button-reject-suggestion-${s.id}`}
                          >
                            <X className="h-3 w-3 mr-1" />
                            Avvisa
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CustomerCombobox({
  customers,
  value,
  onChange,
  testId,
}: {
  customers: Customer[];
  value: string;
  onChange: (id: string) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value && value !== "__unresolved__"
    ? customers.find(c => c.id === value)
    : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className="w-56 h-8 justify-between text-xs font-normal"
          data-testid={testId}
        >
          <span className="truncate">{selected ? selected.name : "Välj kund..."}</span>
          <ChevronDown className="h-3 w-3 ml-1 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        {open && (
          <Command>
            <CommandInput placeholder="Sök kund..." className="h-8" />
            <CommandEmpty>Ingen kund hittades.</CommandEmpty>
            <CommandList className="max-h-64">
              <CommandGroup>
                <CommandItem
                  value="__ej_mappad__"
                  onSelect={() => { onChange("__unresolved__"); setOpen(false); }}
                >
                  Ej mappad
                </CommandItem>
                {customers.map(c => (
                  <CommandItem
                    key={c.id}
                    value={c.name}
                    onSelect={() => { onChange(c.id); setOpen(false); }}
                  >
                    {c.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function ImportPage() {
  const { toast } = useToast();
  const { t: tl } = useLanguage();
  const [selectedType, setSelectedType] = useState<ImportType>("customers");
  const [previewType, setPreviewType] = useState<ImportType>("customers");
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [previewData, setPreviewData] = useState<ParsedRow[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"modus" | "manual" | "fortnox" | "mapped" | "history" | "quality">("modus");
  const [showObjectColumns, setShowObjectColumns] = useState(false);
  const [showTaskColumns, setShowTaskColumns] = useState(false);
  const [showEventColumns, setShowEventColumns] = useState(false);
  
  const [modusUploading, setModusUploading] = useState<ModusImportType | null>(null);
  const [showInvoiceColumns, setShowInvoiceColumns] = useState(false);

  const STORAGE_KEY = "traivo-import-progress";
  const STORAGE_VERSION = 3;
  const savedProgress = useMemo(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.version !== STORAGE_VERSION) {
          localStorage.removeItem(STORAGE_KEY);
          return null;
        }
        return parsed as {
          version: number;
          skipped: number[];
          completed: number[];
          activeStep: number;
          results?: {
            objects: ModusObjectResult | null;
            tasks: ImportResult | null;
            events: ModusEventsResult | null;
            "invoice-lines": ImportResult | null;
          };
        };
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    return null;
  }, []);

  const [modusResults, setModusResults] = useState<{
    objects: ModusObjectResult | null;
    tasks: ImportResult | null;
    events: ModusEventsResult | null;
    "invoice-lines": ImportResult | null;
  }>(() => {
    if (savedProgress?.results) return savedProgress.results;
    return { objects: null, tasks: null, events: null, "invoice-lines": null };
  });
  const [skippedSteps, setSkippedSteps] = useState<Set<number>>(new Set(savedProgress?.skipped || []));
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set(savedProgress?.completed || []));
  const [activeModusStep, setActiveModusStep] = useState<number>(savedProgress?.activeStep || 2);
  const [skipConfirmStep, setSkipConfirmStep] = useState<number | null>(null);

  const [modusObjectFile, setModusObjectFile] = useState<File | null>(null);
  const [modusValidation, setModusValidation] = useState<ModusValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [importProgress, setImportProgress] = useState<SSEProgress | null>(null);
  const [undoBatchId, setUndoBatchId] = useState<string | null>(null);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [previewObjectRows, setPreviewObjectRows] = useState<{ modusId: string; originalName: string; type: string; customer: string }[]>([]);
  const [nameOverrides, setNameOverrides] = useState<NameOverrides>({ objects: {}, customers: {}, metadata: {}, resources: {} });
  const [showTaskPreview, setShowTaskPreview] = useState(false);
  const [taskPreviewFile, setTaskPreviewFile] = useState<File | null>(null);
  const [taskPreviewResources, setTaskPreviewResources] = useState<string[]>([]);
  const [taskResourceOverrides, setTaskResourceOverrides] = useState<Record<string, string>>({});
  const [taskCustomerOverrides, setTaskCustomerOverrides] = useState<Record<string, string>>({});
  const [taskUnresolvedPolicy, setTaskUnresolvedPolicy] = useState<"skip" | "object">("skip");
  const [taskPreviewTotalRows, setTaskPreviewTotalRows] = useState(0);
  const [taskValidation, setTaskValidation] = useState<null | {
    totalRows: number;
    uniqueTaskIds: number;
    matchingObjects: number;
    missingObjectIds: { modusId: string; count: number }[];
    missingObjectsCount: number;
    missingObjectRowsTotal: number;
    missingCustomers: { name: string; count: number; modusId?: string; suggestedCustomerId?: string }[];
    missingCustomersCount: number;
    duplicatesInFile: { modusId: string; count: number }[];
    duplicatesInFileCount: number;
    collisionsWithExisting: string[];
    collisionsWithExistingCount: number;
    statusCounts: Record<string, number>;
  }>(null);
  const [isValidatingTasks, setIsValidatingTasks] = useState(false);
  const [showMissingCustomers, setShowMissingCustomers] = useState(false);
  const [showMissingObjects, setShowMissingObjects] = useState(false);
  const [showDuplicatesInFile, setShowDuplicatesInFile] = useState(false);

  const [customerValidation, setCustomerValidation] = useState<CustomerValidationResult | null>(null);
  const [customerFile, setCustomerFile] = useState<File | null>(null);
  const [isValidatingCustomers, setIsValidatingCustomers] = useState(false);
  const [customerDuplicateAction, setCustomerDuplicateAction] = useState<"skip" | "merge" | "create">("skip");
  const [isImportingCustomers, setIsImportingCustomers] = useState(false);
  const [customerImportResult, setCustomerImportResult] = useState<{ imported: number; merged: number; skipped: number; errors: string[] } | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);

  const [metadataLabel, setMetadataLabel] = useState("");
  const [metadataValue, setMetadataValue] = useState("");
  const [selectedMetadataObjects, setSelectedMetadataObjects] = useState<Set<string>>(new Set());
  const [metadataSelectAll, setMetadataSelectAll] = useState(false);
  const [isAssigningMetadata, setIsAssigningMetadata] = useState(false);
  const [metadataAssignResult, setMetadataAssignResult] = useState<{ written: number; errors: string[] } | null>(null);
  const [metadataCsvResult, setMetadataCsvResult] = useState<{ written: number; totalRows: number; metadataColumns: string[]; errors: string[] } | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      skipped: Array.from(skippedSteps),
      completed: Array.from(completedSteps),
      activeStep: activeModusStep,
      results: modusResults,
    }));
  }, [skippedSteps, completedSteps, activeModusStep, modusResults]);

  const eventSourceRef = useRef<EventSource | null>(null);

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: workOrders = [] } = useQuery<{ id: string }[]>({ queryKey: ["/api/work-orders"] });
  const { data: resources = [] } = useQuery<Resource[]>({ queryKey: ["/api/resources"] });
  const { data: objects = [] } = useQuery<ServiceObject[]>({ queryKey: ["/api/objects"] });
  const { data: importBatches = [], isLoading: batchesLoading } = useQuery<ImportBatch[]>({ queryKey: ["/api/import/batches"] });

  useEffect(() => {
    let changed = false;
    const next = new Set(completedSteps);
    if (objects.length > 0 && !next.has(2)) { next.add(2); changed = true; }
    if (workOrders.length > 0 && !next.has(3)) { next.add(3); changed = true; }
    if (changed) {
      setCompletedSteps(next);
      if (objects.length > 0 && !completedSteps.has(2) && activeModusStep === 2) {
        setActiveModusStep(3);
      }
    }
  }, [objects.length, workOrders.length]);

  const undoBatchMutation = useMutation({
    mutationFn: async (batchId: string) => {
      return apiRequest("DELETE", `/api/import/batch/${batchId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/import/batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      setUndoBatchId(null);
      toast({ title: "Import ångrad", description: "All data från denna import har tagits bort." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte ångra importen", description: error.message || "Ett oväntat fel uppstod. Försök igen.", variant: "destructive" });
      setUndoBatchId(null);
    },
  });

  const sseRetryCountRef = useRef(0);
  const sseRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (sseRetryTimerRef.current) {
        clearTimeout(sseRetryTimerRef.current);
      }
    };
  }, []);

  const connectSSE = useCallback((jobId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (sseRetryTimerRef.current) {
      clearTimeout(sseRetryTimerRef.current);
      sseRetryTimerRef.current = null;
    }
    sseJobIdRef.current = jobId;
    const es = new EventSource(`/api/import/progress/${jobId}`);
    eventSourceRef.current = es;
    es.onopen = () => {
      sseRetryCountRef.current = 0;
    };
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SSEProgress;
        setImportProgress(data);
        if (data.status === "completed") {
          es.close();
          eventSourceRef.current = null;
          sseJobIdRef.current = null;
          if (data.result) {
            setModusResults(prev => ({ ...prev, objects: data.result as ModusObjectResult }));
            markStepCompleted(2);
          }
          setModusUploading(null);
          queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
          queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
          queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
          queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
          queryClient.invalidateQueries({ queryKey: ["/api/import/batches"] });
        } else if (data.status === "failed" || data.status === "not_found") {
          es.close();
          eventSourceRef.current = null;
          sseJobIdRef.current = null;
          setModusUploading(null);
        }
      } catch {}
    };
    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      const currentJobId = sseJobIdRef.current;
      if (!currentJobId) return;
      const maxRetries = 5;
      if (sseRetryCountRef.current < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, sseRetryCountRef.current), 30000);
        sseRetryCountRef.current += 1;
        sseRetryTimerRef.current = setTimeout(() => {
          if (sseJobIdRef.current === currentJobId) {
            connectSSE(currentJobId);
          }
        }, delay);
      } else {
        sseJobIdRef.current = null;
        setModusUploading(null);
        toast({
          title: "Anslutningen till servern tappades",
          description: "Importstatusen kunde inte uppdateras. Kontrollera din nätverksanslutning och försök igen.",
          variant: "destructive",
        });
      }
    };
  }, []);

  const counts = {
    customers: customers.length,
    resources: resources.length,
    objects: objects.length,
  };

  const importStep = useMemo(() => {
    if (objects.length > 0 && workOrders.length > 0 && modusResults["invoice-lines"]) return 5;
    if (objects.length > 0 && workOrders.length > 0) return 4;
    if (objects.length > 0) return 3;
    return 1;
  }, [objects.length, workOrders.length, modusResults]);

  const markStepCompleted = useCallback((step: number) => {
    setCompletedSteps(prev => { const next = new Set(prev); next.add(step); return next; });
    setSkippedSteps(prev => { const next = new Set(prev); next.delete(step); return next; });
    const nextStep = step + 1;
    if (nextStep <= 7) setActiveModusStep(nextStep);
  }, []);

  const skipStep = useCallback((step: number) => {
    setSkippedSteps(prev => { const next = new Set(prev); next.add(step); return next; });
    const nextStep = step + 1;
    if (nextStep <= 7) setActiveModusStep(nextStep);
    setSkipConfirmStep(null);
  }, []);

  const goToStep = useCallback((step: number) => {
    setActiveModusStep(step);
  }, []);

  const firstSkippedStep = useMemo(() => {
    for (let i = 2; i <= 6; i++) {
      if (skippedSteps.has(i)) return i;
    }
    return null;
  }, [skippedSteps]);

  const allStepsDone = useMemo(() => {
    for (let i = 2; i <= 6; i++) {
      if (!completedSteps.has(i) && !skippedSteps.has(i)) return false;
    }
    return true;
  }, [completedSteps, skippedSteps]);

  const handleCustomerValidate = async (file: File) => {
    setCustomerFile(file);
    setCustomerValidation(null);
    setCustomerImportResult(null);
    setIsValidatingCustomers(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch("/api/import/customers/validate", { method: "POST", body: formData, credentials: "include" });
      if (!response.ok) throw new Error((await response.json()).error || "Validering misslyckades");
      const result = await response.json() as CustomerValidationResult;
      setCustomerValidation(result);
      if (result.duplicateCount > 0) setShowDuplicateDialog(true);
      toast({ title: "Kundlista validerad", description: `${result.totalRows} rader, ${result.duplicateCount} dubbletter, ${result.newCount} nya` });
    } catch (err) {
      toast({ title: "Validering misslyckades", description: err instanceof Error ? err.message : "Okänt fel", variant: "destructive" });
      setCustomerFile(null);
    } finally {
      setIsValidatingCustomers(false);
    }
  };

  const handleCustomerImport = async () => {
    if (!customerFile) return;
    setIsImportingCustomers(true);
    const formData = new FormData();
    formData.append("file", customerFile);
    formData.append("duplicateAction", customerDuplicateAction);
    try {
      const response = await fetch("/api/import/customers/bulk", { method: "POST", body: formData, credentials: "include" });
      if (!response.ok) throw new Error((await response.json()).error || "Import misslyckades");
      const result = await response.json();
      setCustomerImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({ title: "Kundimport klar", description: `${result.imported} importerade, ${result.merged} sammanslagna, ${result.skipped} hoppade över` });
    } catch (err) {
      toast({ title: "Import misslyckades", description: err instanceof Error ? err.message : "Okänt fel", variant: "destructive" });
    } finally {
      setIsImportingCustomers(false);
      setShowDuplicateDialog(false);
    }
  };

  const handleMetadataBulkAssign = async () => {
    if (selectedMetadataObjects.size === 0 || !metadataLabel || !metadataValue) return;
    setIsAssigningMetadata(true);
    try {
      const response = await fetch("/api/import/metadata/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectIds: Array.from(selectedMetadataObjects), metadataLabel, metadataValue }),
        credentials: "include",
      });
      if (!response.ok) throw new Error((await response.json()).error || "Tilldelning misslyckades");
      const result = await response.json();
      setMetadataAssignResult(result);
      toast({ title: "Metadata tilldelad", description: `${result.written} objekt uppdaterade` });
    } catch (err) {
      toast({ title: "Tilldelning misslyckades", description: err instanceof Error ? err.message : "Okänt fel", variant: "destructive" });
    } finally {
      setIsAssigningMetadata(false);
    }
  };

  const handleMetadataCsvUpload = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch("/api/import/metadata/csv", { method: "POST", body: formData, credentials: "include" });
      if (!response.ok) throw new Error((await response.json()).error || "CSV-import misslyckades");
      const result = await response.json();
      setMetadataCsvResult(result);
      toast({ title: "Metadata-CSV importerad", description: `${result.written} värden skrivna för ${result.metadataColumns.length} kolumner` });
    } catch (err) {
      toast({ title: "CSV-import misslyckades", description: err instanceof Error ? err.message : "Okänt fel", variant: "destructive" });
    }
  };

  const importMutation = useMutation({
    mutationFn: async ({ type, file }: { type: ImportType; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch(`/api/import/${type}`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Import misslyckades");
      }
      
      return response.json() as Promise<ImportResult>;
    },
    onSuccess: (result) => {
      setLastResult(result);
      setShowPreview(false);
      setSelectedFile(null);
      setPreviewData([]);
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      
      toast({
        title: "Import klar",
        description: `${result.imported} poster importerade${result.errors.length > 0 ? `, ${result.errors.length} fel` : ""}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Import misslyckades",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async (type: ImportType) => {
      return apiRequest("DELETE", `/api/import/clear/${type}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
      setLastResult(null);
      
      toast({
        title: "Data rensad",
        description: "All data av vald typ har tagits bort.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Kunde inte rensa data",
        description: error.message || "Ett oväntat fel uppstod. Försök igen.",
        variant: "destructive",
      });
    },
  });

  const downloadTemplate = (type: ImportType) => {
    const template = CSV_TEMPLATES[type];
    const rows = [template.headers, ...template.example];
    const csv = rows.map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mall_${type}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Mall nedladdad", description: `mall_${type}.csv` });
  };

  const validateRow = useCallback((type: ImportType, data: Record<string, string>, rowNumber: number): ParsedRow => {
    const errors: string[] = [];
    
    if (type === "customers") {
      if (!data.namn?.trim()) errors.push("Namn saknas");
    } else if (type === "resources") {
      if (!data.namn?.trim()) errors.push("Namn saknas");
    } else if (type === "objects") {
      if (!data.namn?.trim()) errors.push("Namn saknas");
      if (!data.typ?.trim()) errors.push("Typ saknas");
    }
    
    return {
      rowNumber,
      data,
      errors,
      isValid: errors.length === 0,
    };
  }, []);

  const parseFile = useCallback((file: File, type: ImportType) => {
    setSelectedFile(file);
    setPreviewType(type);
    
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = results.data.map((row, index) => 
          validateRow(type, row, index + 2)
        );
        setPreviewData(parsed);
        setShowPreview(true);
      },
      error: (error) => {
        toast({
          title: "Kunde inte läsa fil",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  }, [validateRow, toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: ImportType) => {
    const file = e.target.files?.[0];
    if (file) {
      parseFile(file, type);
    }
    e.target.value = "";
  };

  const createDropHandler = useCallback((type: ImportType) => (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".csv")) {
      parseFile(file, type);
    } else {
      toast({
        title: "Ogiltig fil",
        description: "Endast CSV-filer stöds",
        variant: "destructive",
      });
    }
  }, [parseFile, toast]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const confirmImport = () => {
    if (selectedFile) {
      importMutation.mutate({ type: previewType, file: selectedFile });
    }
  };

  const exportProblemRows = useCallback(() => {
    if (!modusValidation?.scorecard) return;
    const sc = modusValidation.scorecard;
    const csvRows: string[][] = [["Rad", "Namn", "Kategori", "Problem"]];
    
    for (const [key, cat] of Object.entries(sc.categories)) {
      for (const pr of cat.problemRows) {
        csvRows.push([
          String(pr.row),
          String(pr.name),
          cat.label,
          String(pr.issue || pr.missingFields?.join(", ") || pr.modusId || ""),
        ]);
      }
    }
    
    const csv = csvRows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "problemrader_import.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exporterat", description: "Problemrader exporterade till CSV" });
  }, [modusValidation, toast]);

  const handleModusValidate = async (file: File) => {
    setModusObjectFile(file);
    setModusValidation(null);
    setIsValidating(true);
    setShowImportPreview(false);
    setPreviewObjectRows([]);
    setNameOverrides({ objects: {}, customers: {}, metadata: {}, resources: {} });
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/import/modus/validate", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Validering misslyckades");
      }

      const result = await response.json() as ModusValidationResult;
      setModusValidation(result);

      toast({
        title: "Validering klar",
        description: `${result.totalRows} rader analyserade`,
      });
    } catch (error) {
      toast({
        title: "Validering misslyckades",
        description: error instanceof Error ? error.message : "Okänt fel",
        variant: "destructive",
      });
      setModusObjectFile(null);
    } finally {
      setIsValidating(false);
    }
  };

  const openImportPreview = useCallback(() => {
    if (!modusObjectFile || !modusValidation) return;
    Papa.parse<Record<string, string>>(modusObjectFile, {
      header: true,
      skipEmptyLines: true,
      delimiter: ";",
      complete: (results) => {
        const rows = results.data.map((row) => {
          const modusId = (row["Id"] || "").replace(/\s/g, "");
          const originalName = row["Namn"] || "";
          const type = row["Typ"] || "";
          const kundRaw = row["Kund"] || "";
          const match = kundRaw.match(/^(.+?)\s*\(\d+\)$/);
          const customer = match ? match[1].trim() : kundRaw.trim();
          return { modusId, originalName, type, customer };
        }).filter(r => r.modusId && r.originalName);
        setPreviewObjectRows(rows);
        setNameOverrides({ objects: {}, customers: {}, metadata: {}, resources: {} });
        setShowImportPreview(true);
      },
    });
  }, [modusObjectFile, modusValidation]);

  const handleModusImportAfterValidation = async () => {
    if (!modusObjectFile) return;
    setImportProgress(null);
    const scorecardSummary = modusValidation?.scorecard ? {
      overallScore: modusValidation.scorecard.overallScore,
      addresses: modusValidation.scorecard.categories.addresses.score,
      requiredFields: modusValidation.scorecard.categories.requiredFields.score,
      accessInfo: modusValidation.scorecard.categories.accessInfo.score,
      duplicates: modusValidation.scorecard.categories.duplicates.score,
      categories: {
        addresses: { score: modusValidation.scorecard.categories.addresses.score, ok: modusValidation.scorecard.categories.addresses.ok, total: modusValidation.scorecard.categories.addresses.total, details: modusValidation.scorecard.categories.addresses.details },
        requiredFields: { score: modusValidation.scorecard.categories.requiredFields.score, ok: modusValidation.scorecard.categories.requiredFields.ok, total: modusValidation.scorecard.categories.requiredFields.total, details: modusValidation.scorecard.categories.requiredFields.details },
        accessInfo: { score: modusValidation.scorecard.categories.accessInfo.score, ok: modusValidation.scorecard.categories.accessInfo.ok, total: modusValidation.scorecard.categories.accessInfo.total, details: modusValidation.scorecard.categories.accessInfo.details },
        duplicates: { score: modusValidation.scorecard.categories.duplicates.score, ok: modusValidation.scorecard.categories.duplicates.ok, total: modusValidation.scorecard.categories.duplicates.total, details: modusValidation.scorecard.categories.duplicates.details },
      },
    } : null;
    await handleModusUpload("objects", modusObjectFile, scorecardSummary);
    setShowImportPreview(false);
    setModusObjectFile(null);
    setModusValidation(null);
  };

  const handleModusUpload = async (type: ModusImportType, file: File, scorecardSummary?: Record<string, number> | null) => {
    setModusUploading(type);
    const formData = new FormData();
    formData.append("file", file);
    if (scorecardSummary) {
      formData.append("scorecardSummary", JSON.stringify(scorecardSummary));
    }

    if (type === "objects") {
      const hasOverrides = Object.keys(nameOverrides.objects).length > 0 ||
        Object.keys(nameOverrides.customers).length > 0 ||
        Object.keys(nameOverrides.metadata).length > 0;
      if (hasOverrides) {
        formData.append("nameOverrides", JSON.stringify(nameOverrides));
      }
    }

    if (type === "tasks" && Object.keys(taskResourceOverrides).length > 0) {
      formData.append("resourceNameOverrides", JSON.stringify(taskResourceOverrides));
    }
    if (type === "tasks") {
      if (Object.keys(taskCustomerOverrides).length > 0) {
        formData.append("customerOverrides", JSON.stringify(taskCustomerOverrides));
      }
      formData.append("unresolvedCustomerPolicy", taskUnresolvedPolicy);
    }
    
    if (type === "objects") {
      setImportProgress({ status: "running", phase: "startar", processed: 0, total: 0, created: 0, updated: 0, errors: 0 });
    }
    
    try {
      const response = await fetch(`/api/import/modus/${type}`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Import misslyckades");
      }
      
      const result = await response.json();
      
      if (type === "objects" && result.importBatchId && result.status === "started") {
        connectSSE(result.importBatchId);
        return;
      }
      
      setModusResults(prev => ({ ...prev, [type]: result }));

      const stepMap: Record<string, number> = { tasks: 3, "invoice-lines": 4, events: 5 };
      if (stepMap[type]) markStepCompleted(stepMap[type]);
      
      if (type === "events") {
        toast({
          title: "Analys klar",
          description: `Analyserade ${(result as ModusEventsResult).totalEvents} händelser`,
        });
      } else if (type === "invoice-lines") {
        toast({
          title: "Fakturarader importerade",
          description: `${result.imported} rader importerade${result.articlesAutoCreated ? `, ${result.articlesAutoCreated} artiklar skapade` : ""}`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
        queryClient.invalidateQueries({ queryKey: ["/api/import/batches"] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
        queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/import/batches"] });
      }
    } catch (error) {
      setImportProgress(null);
      toast({
        title: "Import misslyckades",
        description: error instanceof Error ? error.message : "Okänt fel",
        variant: "destructive",
      });
    } finally {
      setModusUploading(null);
    }
  };

  const previewStats = useMemo(() => {
    const valid = previewData.filter(r => r.isValid).length;
    const invalid = previewData.filter(r => !r.isValid).length;
    return { valid, invalid, total: previewData.length };
  }, [previewData]);

  const previewTemplate = CSV_TEMPLATES[previewType];

  return (
    <div className="p-6 space-y-6">
      <PageHeader icon={Upload} title={tl("page.import.title")} description={tl("page.import.description")} testId="text-import-title" />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "modus" | "manual" | "fortnox" | "mapped" | "history" | "quality")}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="modus" className="flex items-center gap-2" data-testid="tab-modus-import">
            <FileSpreadsheet className="h-4 w-4" />
            Modus 2.0
          </TabsTrigger>
          <TabsTrigger value="manual" className="flex items-center gap-2" data-testid="tab-manual-import">
            <Upload className="h-4 w-4" />
            Manuell CSV
          </TabsTrigger>
          <TabsTrigger value="fortnox" className="flex items-center gap-2" data-testid="tab-fortnox-import">
            <Link2 className="h-4 w-4" />
            Fortnox-export
          </TabsTrigger>
          <TabsTrigger value="mapped" className="flex items-center gap-2" data-testid="tab-mapped-import">
            <Database className="h-4 w-4" />
            Mappad import
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2" data-testid="tab-import-history">
            <History className="h-4 w-4" />
            Historik
          </TabsTrigger>
          <TabsTrigger value="quality" className="flex items-center gap-2" data-testid="tab-data-quality">
            <BarChart3 className="h-4 w-4" />
            Datakvalitet
          </TabsTrigger>
        </TabsList>

        <TabsContent value="modus" className="space-y-6">
          <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p className="text-sm font-medium">Importera riktig data från Modus 2.0</p>
                  <p className="text-sm text-muted-foreground">
                    Följ stegen nedan för att migrera er data från Modus 2.0 till Plannix. 
                    Modus exporterar CSV-filer med semikolon (;) som separator — detta hanteras automatiskt.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-muted/50 rounded-lg">
            <div className="text-center">
              <div className="text-2xl font-bold">{customers.length}</div>
              <div className="text-xs text-muted-foreground">Kunder</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{objects.length}</div>
              <div className="text-xs text-muted-foreground">Objekt</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{resources.length}</div>
              <div className="text-xs text-muted-foreground">Resurser</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{workOrders.length}</div>
              <div className="text-xs text-muted-foreground">Arbetsordrar</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <StepIndicator step={1} title="Företagsinställningar" active={activeModusStep === 1} completed={importStep > 1} />
            <ArrowRight className="h-5 w-5 text-muted-foreground self-center hidden md:block" />
            {[2, 3, 4, 5, 6].map(s => {
              const priorResolved = Array.from({length: s - 2}, (_, i) => i + 2).every(p => completedSteps.has(p) || skippedSteps.has(p));
              const canNavigate = !completedSteps.has(s) && (skippedSteps.has(s) || priorResolved);
              return (
                <span key={s} className="contents">
                  <StepIndicator step={s} title={[, , "Importera objekt", "Importera uppgifter", "Fakturarader", "Analysera händelser", "Metadata"][s]!} active={activeModusStep === s} completed={completedSteps.has(s)} skipped={skippedSteps.has(s)} onClick={canNavigate ? () => goToStep(s) : undefined} />
                  {s < 6 && <ArrowRight className="h-5 w-5 text-muted-foreground self-center hidden md:block" />}
                </span>
              );
            })}
            <ArrowRight className="h-5 w-5 text-muted-foreground self-center hidden md:block" />
            <StepIndicator step={7} title="Sammanfattning" active={activeModusStep === 7} completed={false} onClick={allStepsDone ? () => setActiveModusStep(7) : undefined} />
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-600 text-white text-sm font-bold">1</div>
                <div>
                  <CardTitle className="text-base">Förbered — Företagsinställningar</CardTitle>
                  <CardDescription>Konfigurera ert företag innan ni importerar data</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Innan import, kontrollera att följande är klart under <strong>Företagsinställningar</strong>:
                </p>
                <div className="grid md:grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 text-sm p-2 bg-muted/50 rounded">
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    Företagsinfo (namn, org.nr, kontaktuppgifter)
                  </div>
                  <div className="flex items-center gap-2 text-sm p-2 bg-muted/50 rounded">
                    <ListChecks className="h-4 w-4 text-muted-foreground" />
                    Artiklar & exekveringskoder
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild data-testid="button-goto-tenant-config">
                  <a href="/tenant-config">
                    <Settings className="h-4 w-4 mr-2" />
                    Gå till Företagsinställningar
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-customer-import">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-teal-600 text-white text-sm font-bold">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Steg 0: Kundlista-import (valfritt)
                      {customerImportResult && (
                        <Badge variant="outline" className="text-xs ml-2 bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800" data-testid="badge-customer-import-done">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {customerImportResult.imported} importerade
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      Importera kundlista från CSV innan objektimport — dubbletter detekteras automatiskt
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-teal-50 dark:bg-teal-950/20 p-3 rounded-md text-sm space-y-1">
                <p className="font-medium text-teal-700 dark:text-teal-300">Förväntade kolumner (semikolon- eller komma-separerad CSV):</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {["namn", "kundnummer", "adress", "postnr", "ort", "kontakt", "e-post", "telefon", "fakturareferens"].map(col => (
                    <Badge key={col} variant="secondary" className="text-xs font-mono">{col}</Badge>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  id="customer-csv-import"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleCustomerValidate(file);
                    e.target.value = "";
                  }}
                  data-testid="input-customer-csv"
                />
                <Button
                  variant="outline"
                  disabled={isValidatingCustomers || isImportingCustomers}
                  onClick={() => document.getElementById("customer-csv-import")?.click()}
                  data-testid="button-customer-csv-upload"
                >
                  {isValidatingCustomers ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Välj kundlista-CSV
                </Button>
                {customerFile && !customerImportResult && (
                  <span className="text-xs text-muted-foreground">{customerFile.name}</span>
                )}
              </div>

              {customerValidation && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3 p-3 border rounded-lg bg-muted/30">
                    <div className="text-center">
                      <div className="text-lg font-bold text-green-600" data-testid="text-customer-new">{customerValidation.newCount}</div>
                      <div className="text-xs text-muted-foreground">Nya kunder</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-orange-500 dark:text-orange-400" data-testid="text-customer-duplicates">{customerValidation.duplicateCount}</div>
                      <div className="text-xs text-muted-foreground">Dubbletter</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-red-600" data-testid="text-customer-errors">{customerValidation.errorCount}</div>
                      <div className="text-xs text-muted-foreground">Fel</div>
                    </div>
                  </div>

                  {customerValidation.duplicateCount > 0 && (
                    <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded-md text-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="h-4 w-4 text-orange-500 dark:text-orange-400" />
                        <span className="font-medium text-amber-700 dark:text-amber-300">
                          {customerValidation.duplicateCount} dubbletter hittade
                        </span>
                      </div>
                      <div className="max-h-32 overflow-y-auto">
                        <ul className="text-xs space-y-1 text-amber-600 dark:text-amber-400">
                          {customerValidation.preview.filter(p => p.duplicate).slice(0, 20).map((p, i) => (
                            <li key={i}>
                              Rad {p.row}: <strong>{p.name}</strong> — matchar {p.duplicate!.type === "customerNumber" ? "kundnummer" : "namn"} "{p.duplicate!.existingName}"
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium text-xs">
                      Visa förhandsgranskning ({customerValidation.preview.length} rader)
                    </summary>
                    <div className="max-h-48 overflow-y-auto mt-2">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Rad</TableHead>
                            <TableHead className="text-xs">Namn</TableHead>
                            <TableHead className="text-xs">Kundnr</TableHead>
                            <TableHead className="text-xs">Adress</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {customerValidation.preview.slice(0, 50).map((p, i) => (
                            <TableRow key={i} className={p.duplicate ? "bg-amber-50/50 dark:bg-amber-950/10" : p.errors.length > 0 ? "bg-red-50/50 dark:bg-red-950/10" : ""}>
                              <TableCell className="text-xs">{p.row}</TableCell>
                              <TableCell className="text-xs font-medium">{p.name || "—"}</TableCell>
                              <TableCell className="text-xs font-mono">{p.customerNumber || "—"}</TableCell>
                              <TableCell className="text-xs">{[p.address, p.postalCode, p.city].filter(Boolean).join(", ") || "—"}</TableCell>
                              <TableCell className="text-xs">
                                {p.duplicate ? (
                                  <Badge variant="outline" className="text-xs bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800">
                                    <AlertTriangle className="h-3 w-3 mr-1 text-orange-500 dark:text-orange-400" /> Dubblett
                                  </Badge>
                                ) : p.errors.length > 0 ? (
                                  <Badge variant="outline" className="text-xs bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800">
                                    <AlertCircle className="h-3 w-3 mr-1" /> Fel
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800">
                                    <CheckCircle className="h-3 w-3 mr-1" /> Ny
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </details>

                  <div className="flex items-center gap-3">
                    {customerValidation.duplicateCount > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Dubbletthantering:</span>
                        <Select value={customerDuplicateAction} onValueChange={(v) => setCustomerDuplicateAction(v as "skip" | "merge" | "create")}>
                          <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="select-duplicate-action">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="skip">Hoppa över dubbletter</SelectItem>
                            <SelectItem value="merge">Sammanfoga (fyll i tomma fält)</SelectItem>
                            <SelectItem value="create">Skapa ändå (tillåt dubbletter)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <Button
                      variant="default"
                      disabled={isImportingCustomers || customerValidation.newCount === 0 && customerDuplicateAction === "skip"}
                      onClick={handleCustomerImport}
                      data-testid="button-customer-import-confirm"
                    >
                      {isImportingCustomers ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      Importera kunder
                    </Button>
                  </div>
                </div>
              )}

              {customerImportResult && (
                <div className="grid grid-cols-4 gap-3 p-3 border rounded-lg bg-muted/30">
                  <div className="text-center">
                    <div className="text-lg font-bold text-green-600">{customerImportResult.imported}</div>
                    <div className="text-xs text-muted-foreground">Importerade</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-blue-600">{customerImportResult.merged}</div>
                    <div className="text-xs text-muted-foreground">Sammanfogade</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-500">{customerImportResult.skipped}</div>
                    <div className="text-xs text-muted-foreground">Hoppade över</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-red-500">{customerImportResult.errors.length}</div>
                    <div className="text-xs text-muted-foreground">Fel</div>
                  </div>
                  {customerImportResult.errors.length > 0 && (
                    <div className="col-span-full">
                      <details className="text-xs">
                        <summary className="text-red-600 cursor-pointer font-medium">Visa fel</summary>
                        <ul className="text-muted-foreground space-y-0.5 ml-4 list-disc mt-1">
                          {customerImportResult.errors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {activeModusStep === 2 && !completedSteps.has(2) && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-600 text-white text-sm font-bold">2</div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      Importera objekt från Modus 2.0
                      {modusValidation?.scorecard && (
                        <Badge variant="outline" className={`text-xs ml-2 ${getScorecardBg(modusValidation.scorecard.overallScore)}`} data-testid="badge-quality-step-2">
                          <BarChart3 className="h-3 w-3 mr-1" />
                          {modusValidation.scorecard.overallScore}%
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      Objekt-hierarkin (fastigheter, rum, kärl) — kunder skapas automatiskt
                    </CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSkipConfirmStep(2)} data-testid="button-skip-step-2">
                  <SkipForward className="h-4 w-4 mr-1" />
                  Hoppa över
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-green-50 dark:bg-green-950/20 p-3 rounded-md text-sm space-y-1">
                <p className="font-medium text-green-700 dark:text-green-300">Vad händer automatiskt:</p>
                <ul className="text-green-600 dark:text-green-400 text-xs space-y-0.5 ml-4 list-disc">
                  <li>Kunder extraheras från "Kund"-kolumnen och skapas automatiskt</li>
                  <li>Koordinater rensas (komma → punkt) och valideras för Sverige</li>
                  <li>Objekthierarki byggs via "Parent"-kolumnen</li>
                  <li>Alla "Metadata - *" kolumner importeras till metadata-systemet</li>
                  <li>Kontaktinfo extraheras från beskrivningsfältet</li>
                </ul>
              </div>

              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowObjectColumns(!showObjectColumns)}
                  className="text-xs text-muted-foreground"
                  data-testid="button-toggle-object-columns"
                >
                  {showObjectColumns ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                  {showObjectColumns ? "Dölj" : "Visa"} förväntade kolumner
                </Button>
                {showObjectColumns && <ColumnTable columns={MODUS_OBJECT_COLUMNS} />}
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  id="modus-objects"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleModusValidate(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  disabled={modusUploading !== null || isValidating}
                  onClick={() => document.getElementById("modus-objects")?.click()}
                  data-testid="button-modus-objects-validate"
                >
                  {isValidating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4 mr-2" />
                  )}
                  {isValidating ? "Validerar..." : "Välj & validera objekt-CSV"}
                </Button>
                {modusValidation && !modusResults.objects && (
                  <Badge variant="secondary">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Validerad
                  </Badge>
                )}
                {modusResults.objects && (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Importerad
                  </Badge>
                )}
              </div>

              {modusValidation && !modusResults.objects && (
                <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-sm">Data Health Scorecard</span>
                    <Badge variant="secondary" className="text-xs">{modusObjectFile?.name}</Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="text-center p-2 bg-background rounded-md">
                      <div className="text-lg font-bold" data-testid="text-validation-total">{modusValidation.totalRows}</div>
                      <div className="text-xs text-muted-foreground">Totalt rader</div>
                    </div>
                    <div className="text-center p-2 bg-background rounded-md">
                      <div className="text-lg font-bold text-green-600" data-testid="text-validation-new-objects">{modusValidation.objectsNew}</div>
                      <div className="text-xs text-muted-foreground">Nya objekt</div>
                    </div>
                    <div className="text-center p-2 bg-background rounded-md">
                      <div className="text-lg font-bold text-blue-600" data-testid="text-validation-existing-objects">{modusValidation.objectsExisting}</div>
                      <div className="text-xs text-muted-foreground">Redan finns (uppdateras)</div>
                    </div>
                  </div>

                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2" data-testid="text-validation-customers">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {modusValidation.customersNew.length + modusValidation.customersExisting.length} kunder identifierade
                        {modusValidation.customersExisting.length > 0 && (
                          <span className="text-muted-foreground"> ({modusValidation.customersExisting.length} redan finns)</span>
                        )}
                        {modusValidation.customersNew.length > 0 && (
                          <span className="text-green-600"> ({modusValidation.customersNew.length} nya)</span>
                        )}
                      </span>
                    </div>
                    {modusValidation.metadataColumns.length > 0 && (
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-muted-foreground" />
                        <span>{modusValidation.metadataColumns.length} metadata-kolumner: {modusValidation.metadataColumns.join(", ")}</span>
                      </div>
                    )}
                  </div>

                  {modusValidation.scorecard && (
                    <DataHealthScorecardView
                      scorecard={modusValidation.scorecard}
                      validation={modusValidation}
                      onExportProblems={exportProblemRows}
                    />
                  )}

                  {modusValidation.warnings.length > 0 && (
                    <div className="space-y-2 border-t pt-3">
                      <p className="text-xs font-medium text-orange-600 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Övriga varningar
                      </p>
                      {modusValidation.warnings.map((w, i) => (
                        <div key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                          <AlertCircle className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!showImportPreview && (
                    <div className="flex items-center gap-3 pt-2 border-t">
                      <Button
                        variant="default"
                        disabled={modusUploading !== null}
                        onClick={openImportPreview}
                        data-testid="button-modus-start-import"
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        {modusValidation.scorecard && modusValidation.scorecard.overallScore < 70
                          ? "Granska & importera ändå"
                          : `Granska & döp om (${modusValidation.totalRows} objekt)`}
                      </Button>
                      {modusValidation.scorecard && modusValidation.scorecard.overallScore < 70 && (
                        <Badge variant="destructive" className="text-xs">
                          Låg datakvalitet — överväg att åtgärda först
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => { setModusValidation(null); setModusObjectFile(null); }}
                        data-testid="button-modus-cancel-validation"
                      >
                        {modusValidation.scorecard && modusValidation.scorecard.overallScore < 70
                          ? "Åtgärda först"
                          : "Avbryt"}
                      </Button>
                    </div>
                  )}

                  {showImportPreview && (
                    <ImportPreviewPanel
                      objectRows={previewObjectRows}
                      customerNames={[...modusValidation.customersNew, ...modusValidation.customersExisting]}
                      existingCustomerNames={modusValidation.customersExisting}
                      metadataColumns={modusValidation.metadataColumns}
                      nameOverrides={nameOverrides}
                      onNameOverridesChange={setNameOverrides}
                      onConfirmImport={handleModusImportAfterValidation}
                      onCancel={() => { setShowImportPreview(false); }}
                      isImporting={modusUploading === "objects"}
                      totalRows={modusValidation.totalRows}
                    />
                  )}
                </div>
              )}

              {importProgress && importProgress.status === "running" && (
                <Card className="border-blue-200 dark:border-blue-800" data-testid="card-import-progress">
                  <CardContent className="pt-6 space-y-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                      <span className="text-sm font-medium">Importerar...</span>
                      <Badge variant="secondary" className="text-xs">
                        {importProgress.phase === "kunder" && "Skapar kunder"}
                        {importProgress.phase === "objekt" && "Importerar objekt"}
                        {importProgress.phase === "hierarki" && "Bygger hierarki"}
                        {importProgress.phase === "metadata" && "Skriver metadata"}
                        {importProgress.phase === "klar" && "Klar"}
                        {importProgress.phase === "startar" && "Startar"}
                      </Badge>
                    </div>
                    <Progress 
                      value={importProgress.total > 0 ? (importProgress.processed / importProgress.total) * 100 : 0} 
                      data-testid="progress-import"
                    />
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{importProgress.processed} / {importProgress.total} rader</span>
                      <span className="text-green-600">{importProgress.created} skapade</span>
                      <span className="text-blue-600">{importProgress.updated} uppdaterade</span>
                      {importProgress.errors > 0 && (
                        <span className="text-orange-600">{importProgress.errors} fel</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {modusResults.objects && (
                <Card className="border-green-200 dark:border-green-800" data-testid="card-import-summary">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      Import slutförd
                    </CardTitle>
                    {modusResults.objects.importBatchId && (
                      <CardDescription className="font-mono text-xs">
                        Batch: {modusResults.objects.importBatchId.slice(0, 8)}...
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="text-center p-2 bg-green-50 dark:bg-green-950/20 rounded-md">
                        <div className="text-lg font-bold text-green-600" data-testid="text-summary-created">{modusResults.objects.created || 0}</div>
                        <div className="text-xs text-muted-foreground">Objekt skapade</div>
                      </div>
                      <div className="text-center p-2 bg-blue-50 dark:bg-blue-950/20 rounded-md">
                        <div className="text-lg font-bold text-blue-600" data-testid="text-summary-updated">{modusResults.objects.updated || 0}</div>
                        <div className="text-xs text-muted-foreground">Objekt uppdaterade</div>
                      </div>
                      <div className="text-center p-2 bg-purple-50 dark:bg-purple-950/20 rounded-md">
                        <div className="text-lg font-bold text-purple-600" data-testid="text-summary-customers">{modusResults.objects.customersCreated}</div>
                        <div className="text-xs text-muted-foreground">Kunder</div>
                      </div>
                      <div className="text-center p-2 rounded-md" style={{ background: modusResults.objects.errors.length > 0 ? undefined : undefined }}>
                        <div className={`text-lg font-bold ${modusResults.objects.errors.length > 0 ? "text-orange-600" : "text-muted-foreground"}`} data-testid="text-summary-errors">
                          {modusResults.objects.errors.length}
                        </div>
                        <div className="text-xs text-muted-foreground">Fel</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span>{modusResults.objects.parentsUpdated} hierarkiska kopplingar</span>
                      <span>{modusResults.objects.metadataWritten || 0} metadata-värden</span>
                      {(modusResults.objects.metadataColumns?.length || 0) > 0 && (
                        <span>Kolumner: {modusResults.objects.metadataColumns.join(", ")}</span>
                      )}
                    </div>

                    {modusResults.objects.errors.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-orange-600 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {modusResults.objects.errors.length} fel vid import
                        </p>
                        <ScrollArea className="h-40 border rounded-md">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-12 text-xs">#</TableHead>
                                <TableHead className="text-xs">Felmeddelande</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {modusResults.objects.errors.map((err, i) => (
                                <TableRow key={i}>
                                  <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                                  <TableCell className="text-xs">{err}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
          )}

          {activeModusStep === 3 && !completedSteps.has(3) && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-600 text-white text-sm font-bold">3</div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Truck className="h-4 w-4" />
                      Importera uppgifter (arbetsordrar)
                      {objects.length === 0 && !completedSteps.has(2) && (
                        <Badge variant="outline" className="text-xs ml-2 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800" data-testid="badge-quality-step-3">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Importera objekt först
                        </Badge>
                      )}
                      {objects.length === 0 && completedSteps.has(2) && (
                        <Badge variant="outline" className="text-xs ml-2 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800" data-testid="badge-quality-step-3">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          {modusResults.objects?.errors?.length ? `${modusResults.objects.errors.length} varningar` : "0 objekt"}
                        </Badge>
                      )}
                      {objects.length > 0 && (
                        <Badge variant="outline" className="text-xs ml-2 bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800" data-testid="badge-quality-step-3">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {objects.length} objekt redo
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      Arbetsordrar med schemaläggning — resurser skapas automatiskt
                    </CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSkipConfirmStep(3)} data-testid="button-skip-step-3">
                  <SkipForward className="h-4 w-4 mr-1" />
                  Hoppa över
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-green-50 dark:bg-green-950/20 p-3 rounded-md text-sm space-y-1">
                <p className="font-medium text-green-700 dark:text-green-300">Vad händer automatiskt:</p>
                <ul className="text-green-600 dark:text-green-400 text-xs space-y-0.5 ml-4 list-disc">
                  <li>Uppgifter kopplas till importerade objekt via Modus objekt-ID</li>
                  <li>Resurser (team/chaufförer) skapas automatiskt om de inte redan finns</li>
                  <li>Uppgiftstyper mappas automatiskt till interna artikeltyper</li>
                  <li>Status konverteras (done → slutförd, etc.)</li>
                </ul>
              </div>

              {objects.length === 0 && (
                <div className="flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-950/20 rounded-md text-sm text-orange-700 dark:text-orange-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Importera objekt först (steg 2) innan uppgifter kan kopplas korrekt.
                </div>
              )}

              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowTaskColumns(!showTaskColumns)}
                  className="text-xs text-muted-foreground"
                  data-testid="button-toggle-task-columns"
                >
                  {showTaskColumns ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                  {showTaskColumns ? "Dölj" : "Visa"} förväntade kolumner
                </Button>
                {showTaskColumns && <ColumnTable columns={MODUS_TASK_COLUMNS} />}
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  id="modus-tasks"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      Papa.parse<Record<string, string>>(file, {
                        header: true,
                        skipEmptyLines: true,
                        delimiter: ";",
                        complete: async (results) => {
                          const teamSet = new Set<string>();
                          const existingResourceNames = new Set(resources.map(r => r.name.toLowerCase()));
                          for (const row of results.data) {
                            const team = (row["Team"] || "").trim();
                            if (team && !existingResourceNames.has(team.toLowerCase())) {
                              teamSet.add(team);
                            }
                          }
                          setTaskPreviewFile(file);
                          setTaskPreviewResources(Array.from(teamSet).sort());
                          setTaskResourceOverrides({});
                          setTaskCustomerOverrides({});
                          setTaskUnresolvedPolicy("skip");
                          setTaskPreviewTotalRows(results.data.length);
                          setShowTaskPreview(true);
                          setTaskValidation(null);
                          setIsValidatingTasks(true);
                          try {
                            const fd = new FormData();
                            fd.append("file", file);
                            const resp = await fetch("/api/import/modus/tasks/validate", {
                              method: "POST",
                              body: fd,
                              credentials: "include",
                            });
                            if (resp.ok) {
                              const data = await resp.json();
                              setTaskValidation(data);
                              // Pre-seed customer overrides with any auto-suggested matches
                              const seeded: Record<string, string> = {};
                              for (const mc of (data.missingCustomers || []) as { name: string; modusId?: string; suggestedCustomerId?: string }[]) {
                                if (mc.suggestedCustomerId) {
                                  seeded[mc.modusId || mc.name] = mc.suggestedCustomerId;
                                }
                              }
                              if (Object.keys(seeded).length > 0) {
                                setTaskCustomerOverrides(seeded);
                              }
                            }
                          } catch {} finally {
                            setIsValidatingTasks(false);
                          }
                        },
                      });
                    }
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="default"
                  disabled={modusUploading !== null || showTaskPreview || objects.length === 0}
                  onClick={() => document.getElementById("modus-tasks")?.click()}
                  data-testid="button-modus-tasks"
                >
                  {modusUploading === "tasks" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Välj uppgifter-CSV från Modus
                </Button>
                {modusResults.tasks && (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Importerad
                  </Badge>
                )}
              </div>

              {showTaskPreview && taskPreviewFile && (
                <>
                  <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Eye className="h-4 w-4" />
                        Förhandsgranskning av uppgifter
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Kontrollera matchningar mot befintliga objekt och kunder innan import.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {isValidatingTasks ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-validating-tasks">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Analyserar uppgifter-fil...
                        </div>
                      ) : taskValidation ? (
                        <>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="p-2 rounded border bg-background">
                              <div className="text-xs text-muted-foreground">Totalt</div>
                              <div className="text-lg font-bold" data-testid="text-task-total-rows">{taskValidation.totalRows}</div>
                              <div className="text-xs text-muted-foreground">{taskValidation.uniqueTaskIds} unika ID</div>
                            </div>
                            <div className="p-2 rounded border bg-background">
                              <div className="text-xs text-muted-foreground">Saknade objekt</div>
                              <div className={`text-lg font-bold ${taskValidation.missingObjectsCount > 0 ? "text-amber-600" : "text-green-600"}`} data-testid="text-task-missing-objects">
                                {taskValidation.missingObjectsCount}
                              </div>
                              <div className="text-xs text-muted-foreground">{taskValidation.missingObjectRowsTotal} rader</div>
                            </div>
                            <div className="p-2 rounded border bg-background">
                              <div className="text-xs text-muted-foreground">Saknade kunder</div>
                              <div className={`text-lg font-bold ${taskValidation.missingCustomersCount > 0 ? "text-amber-600" : "text-green-600"}`} data-testid="text-task-missing-customers">
                                {taskValidation.missingCustomersCount}
                              </div>
                            </div>
                            <div className="p-2 rounded border bg-background">
                              <div className="text-xs text-muted-foreground">Dubbletter / kollisioner</div>
                              <div className={`text-lg font-bold ${(taskValidation.duplicatesInFileCount + taskValidation.collisionsWithExistingCount) > 0 ? "text-amber-600" : "text-green-600"}`} data-testid="text-task-duplicates">
                                {taskValidation.duplicatesInFileCount} / {taskValidation.collisionsWithExistingCount}
                              </div>
                              <div className="text-xs text-muted-foreground">i fil / mot befintlig</div>
                            </div>
                          </div>

                          {Object.keys(taskValidation.statusCounts).length > 0 && (
                            <div className="text-xs">
                              <span className="text-muted-foreground">Status-fördelning: </span>
                              {Object.entries(taskValidation.statusCounts).map(([s, c]) => (
                                <Badge key={s} variant="outline" className="ml-1">{s}: {c}</Badge>
                              ))}
                            </div>
                          )}

                          {taskValidation.missingObjectIds.length > 0 && (
                            <div className="text-xs">
                              <button
                                type="button"
                                onClick={() => setShowMissingObjects(o => !o)}
                                className="cursor-pointer font-medium text-amber-700 dark:text-amber-300 hover:underline"
                                data-testid="button-toggle-missing-objects"
                              >
                                {showMissingObjects ? "Dölj" : "Visa"} saknade objekt-ID ({taskValidation.missingObjectsCount})
                              </button>
                              {showMissingObjects && (
                                <ScrollArea className="h-32 mt-2 border rounded p-2">
                                  <ul className="space-y-0.5">
                                    {taskValidation.missingObjectIds.map(({ modusId, count }) => (
                                      <li key={modusId} className="font-mono">
                                        <span className="text-foreground">{modusId}</span>
                                        <span className="text-muted-foreground ml-2">({count} rader)</span>
                                      </li>
                                    ))}
                                  </ul>
                                </ScrollArea>
                              )}
                            </div>
                          )}

                          {taskValidation.missingCustomers.length > 0 && (
                            <div className="text-xs">
                              <button
                                type="button"
                                onClick={() => setShowMissingCustomers(o => !o)}
                                className="cursor-pointer font-medium text-amber-700 dark:text-amber-300 hover:underline"
                                data-testid="button-toggle-missing-customers"
                              >
                                {showMissingCustomers ? "Dölj" : "Visa"} saknade kunder ({taskValidation.missingCustomersCount})
                              </button>
                              {showMissingCustomers && (
                                <>
                                  <ScrollArea className="h-64 mt-2 border rounded p-2">
                                    <div className="space-y-2">
                                      {taskValidation.missingCustomers.map(({ name, count, modusId, suggestedCustomerId }) => {
                                        const key = modusId || name;
                                        const currentValue = taskCustomerOverrides[key] || suggestedCustomerId || "";
                                        return (
                                          <div key={key} className="flex items-center gap-2 text-xs" data-testid={`row-missing-customer-${key}`}>
                                            <div className="flex-1 min-w-0">
                                              <div className="truncate">
                                                <span className="text-foreground font-medium">{name}</span>
                                                {modusId && <span className="text-muted-foreground ml-1">[{modusId}]</span>}
                                              </div>
                                              <div className="text-muted-foreground">{count} rader</div>
                                            </div>
                                            <CustomerCombobox
                                              customers={customers}
                                              value={currentValue}
                                              onChange={(v) => {
                                                setTaskCustomerOverrides(prev => {
                                                  const next = { ...prev };
                                                  if (v === "__unresolved__") delete next[key];
                                                  else next[key] = v;
                                                  return next;
                                                });
                                              }}
                                              testId={`select-customer-map-${key}`}
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </ScrollArea>
                                  <div className="mt-2 flex items-center gap-3 text-xs">
                                    <label className="flex items-center gap-1">
                                      <input
                                        type="radio"
                                        name="task-unresolved-policy"
                                        checked={taskUnresolvedPolicy === "skip"}
                                        onChange={() => setTaskUnresolvedPolicy("skip")}
                                        data-testid="radio-policy-skip"
                                      />
                                      Hoppa över omappade rader (rekommenderat)
                                    </label>
                                    <label className="flex items-center gap-1">
                                      <input
                                        type="radio"
                                        name="task-unresolved-policy"
                                        checked={taskUnresolvedPolicy === "object"}
                                        onChange={() => setTaskUnresolvedPolicy("object")}
                                        data-testid="radio-policy-object"
                                      />
                                      Använd objektets kund som fallback
                                    </label>
                                  </div>
                                </>
                              )}
                            </div>
                          )}

                          {taskValidation.duplicatesInFile.length > 0 && (
                            <div className="text-xs">
                              <button
                                type="button"
                                onClick={() => setShowDuplicatesInFile(o => !o)}
                                className="cursor-pointer font-medium text-amber-700 dark:text-amber-300 hover:underline"
                                data-testid="button-toggle-duplicates"
                              >
                                {showDuplicatesInFile ? "Dölj" : "Visa"} dubbletter i fil ({taskValidation.duplicatesInFileCount})
                              </button>
                              {showDuplicatesInFile && (
                                <ScrollArea className="h-24 mt-2 border rounded p-2">
                                  <ul className="space-y-0.5 font-mono">
                                    {taskValidation.duplicatesInFile.slice(0, 200).map(({ modusId, count }) => (
                                      <li key={modusId}>{modusId} ({count} gånger)</li>
                                    ))}
                                  </ul>
                                </ScrollArea>
                              )}
                            </div>
                          )}

                          {taskValidation.collisionsWithExistingCount > 0 && (
                            <div className="text-xs p-2 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200">
                              <Info className="h-3 w-3 inline mr-1" />
                              {taskValidation.collisionsWithExistingCount} uppgifter finns redan (uppdateras via externalReference).
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground">Ingen server-validering tillgänglig.</div>
                      )}
                    </CardContent>
                  </Card>
                <ResourcePreviewPanel
                  resourceNames={taskPreviewResources}
                  resourceOverrides={taskResourceOverrides}
                  onOverridesChange={setTaskResourceOverrides}
                  onConfirmImport={() => {
                    handleModusUpload("tasks", taskPreviewFile);
                    setShowTaskPreview(false);
                    setTaskPreviewFile(null);
                  }}
                  onCancel={() => {
                    setShowTaskPreview(false);
                    setTaskPreviewFile(null);
                  }}
                  isImporting={modusUploading === "tasks"}
                  totalRows={taskPreviewTotalRows}
                />
                </>
              )}

              {modusResults.tasks && (
                <div className="grid grid-cols-2 gap-3 p-3 border rounded-lg bg-muted/30">
                  <div className="text-center">
                    <div className="text-lg font-bold text-green-600">{modusResults.tasks.imported}</div>
                    <div className="text-xs text-muted-foreground">Uppgifter importerade</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-orange-600">{modusResults.tasks.errors.length}</div>
                    <div className="text-xs text-muted-foreground">Varningar</div>
                  </div>
                  {modusResults.tasks.errors.length > 0 && (
                    <div className="col-span-full">
                      <details className="text-xs">
                        <summary className="text-orange-600 cursor-pointer font-medium">
                          Visa varningar
                        </summary>
                        <ScrollArea className="h-24 mt-1">
                          <ul className="text-muted-foreground space-y-0.5 ml-4 list-disc">
                            {modusResults.tasks.errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </ScrollArea>
                      </details>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {activeModusStep === 4 && !completedSteps.has(4) && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-amber-600 text-white text-sm font-bold">4</div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4" />
                      Importera fakturarader (valfritt)
                      {completedSteps.has(3) && modusResults.tasks ? (
                        <Badge variant="outline" className="text-xs ml-2 bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800" data-testid="badge-quality-step-4">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {modusResults.tasks.imported} uppgifter att koppla
                        </Badge>
                      ) : !completedSteps.has(3) ? (
                        <Badge variant="outline" className="text-xs ml-2 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800" data-testid="badge-quality-step-4">
                          <Info className="h-3 w-3 mr-1" />
                          Kräver uppgifter
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs ml-2 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800" data-testid="badge-quality-step-4">
                          <Info className="h-3 w-3 mr-1" />
                          Valfritt
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      Kopplar Fortnox-artiklar och priser till importerade uppgifter
                    </CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSkipConfirmStep(4)} data-testid="button-skip-step-4">
                  <SkipForward className="h-4 w-4 mr-1" />
                  Hoppa över
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded-md text-sm space-y-1">
                <p className="font-medium text-amber-700 dark:text-amber-300">Vad händer:</p>
                <ul className="text-amber-600 dark:text-amber-400 text-xs space-y-0.5 ml-4 list-disc">
                  <li>Kopplar fakturarader till importerade uppgifter via Uppgift Id</li>
                  <li>Skapar artiklar automatiskt baserat på Fortnox Artikel Id (K100, UJ100)</li>
                  <li>Importerar priser med korrekt hantering av komma-decimaler</li>
                </ul>
              </div>

              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowInvoiceColumns(!showInvoiceColumns)}
                  className="text-xs text-muted-foreground"
                  data-testid="button-toggle-invoice-columns"
                >
                  {showInvoiceColumns ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                  {showInvoiceColumns ? "Dölj" : "Visa"} förväntade kolumner
                </Button>
                {showInvoiceColumns && <ColumnTable columns={MODUS_INVOICE_COLUMNS} />}
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  id="modus-invoice-lines"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleModusUpload("invoice-lines", file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  disabled={modusUploading !== null}
                  onClick={() => document.getElementById("modus-invoice-lines")?.click()}
                  data-testid="button-modus-invoice-lines"
                >
                  {modusUploading === "invoice-lines" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Välj fakturarader-CSV från Modus
                </Button>
                {modusResults["invoice-lines"] && (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {modusResults["invoice-lines"].imported} rader
                  </Badge>
                )}
              </div>

              {modusResults["invoice-lines"] && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3 border rounded-lg bg-muted/30">
                  <div className="text-center">
                    <div className="text-lg font-bold text-orange-500 dark:text-orange-400">{modusResults["invoice-lines"].imported}</div>
                    <div className="text-xs text-muted-foreground">Fakturarader importerade</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-orange-500 dark:text-orange-400">{(modusResults["invoice-lines"] as any).articlesAutoCreated || 0}</div>
                    <div className="text-xs text-muted-foreground">Artiklar skapade</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-red-500">{modusResults["invoice-lines"].errors?.length || 0}</div>
                    <div className="text-xs text-muted-foreground">Fel</div>
                  </div>
                  {modusResults["invoice-lines"].errors && modusResults["invoice-lines"].errors.length > 0 && (
                    <div className="col-span-full">
                      <details>
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                          Visa felmeddelanden ({modusResults["invoice-lines"].errors.length})
                        </summary>
                        <div className="max-h-32 overflow-y-auto mt-2">
                          <ul className="text-xs text-red-500 space-y-0.5 ml-4 list-disc">
                            {modusResults["invoice-lines"].errors.map((e: string, i: number) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {activeModusStep === 5 && !completedSteps.has(5) && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-600 text-white text-sm font-bold">5</div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      Analysera händelser (valfritt)
                      {completedSteps.has(3) && modusResults.tasks ? (
                        <Badge variant="outline" className="text-xs ml-2 bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800" data-testid="badge-quality-step-5">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {modusResults.tasks.imported} uppgifter att analysera
                        </Badge>
                      ) : !completedSteps.has(3) ? (
                        <Badge variant="outline" className="text-xs ml-2 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800" data-testid="badge-quality-step-5">
                          <Info className="h-3 w-3 mr-1" />
                          Kräver uppgifter
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs ml-2 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800" data-testid="badge-quality-step-5">
                          <Info className="h-3 w-3 mr-1" />
                          Valfritt
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      Beräknar arbetstider och ställtider baserat på historiska händelser
                    </CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSkipConfirmStep(5)} data-testid="button-skip-step-5">
                  <SkipForward className="h-4 w-4 mr-1" />
                  Hoppa över
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-md text-sm space-y-1">
                <p className="font-medium text-blue-700 dark:text-blue-300">Vad händer:</p>
                <ul className="text-blue-600 dark:text-blue-400 text-xs space-y-0.5 ml-4 list-disc">
                  <li>Beräknar tid mellan "in_progress" och "done" för varje uppgift</li>
                  <li>Filtrerar bort extremvärden (över 4 timmar)</li>
                  <li>Skapar statistik och tidsfördelning som underlag för planering</li>
                </ul>
              </div>

              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowEventColumns(!showEventColumns)}
                  className="text-xs text-muted-foreground"
                  data-testid="button-toggle-event-columns"
                >
                  {showEventColumns ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                  {showEventColumns ? "Dölj" : "Visa"} förväntade kolumner
                </Button>
                {showEventColumns && <ColumnTable columns={MODUS_EVENT_COLUMNS} />}
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  id="modus-events"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleModusUpload("events", file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  disabled={modusUploading !== null}
                  onClick={() => document.getElementById("modus-events")?.click()}
                  data-testid="button-modus-events"
                >
                  {modusUploading === "events" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Välj händelser-CSV från Modus
                </Button>
                {modusResults.events && (
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Analyserad
                  </Badge>
                )}
              </div>

              {modusResults.events && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3 border rounded-lg bg-muted/30">
                  <div className="text-center">
                    <div className="text-lg font-bold text-blue-600">{modusResults.events.totalEvents}</div>
                    <div className="text-xs text-muted-foreground">Händelser analyserade</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-blue-600">{modusResults.events.uniqueTasks}</div>
                    <div className="text-xs text-muted-foreground">Unika uppgifter</div>
                  </div>
                  <div className="text-center col-span-2 md:col-span-1">
                    <div className="text-2xl font-bold text-green-600">{modusResults.events.averageSetupTime} min</div>
                    <div className="text-xs text-muted-foreground">Snitt arbetstid</div>
                  </div>
                  <div className="col-span-full flex flex-wrap gap-2 justify-center pt-2 border-t">
                    <Badge variant="secondary" className="text-xs">
                      {"<"}5 min: {modusResults.events.setupTimeDistribution.under5min}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      5-15 min: {modusResults.events.setupTimeDistribution["5to15min"]}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      15-30 min: {modusResults.events.setupTimeDistribution["15to30min"]}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {">"}30 min: {modusResults.events.setupTimeDistribution.over30min}
                    </Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {activeModusStep === 6 && !completedSteps.has(6) && (
          <Card data-testid="card-metadata-step">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-purple-600 text-white text-sm font-bold">6</div>
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Tag className="h-4 w-4" />
                      Metadata-tilldelning (valfritt)
                      {objects.length > 0 ? (
                        <Badge variant="outline" className="text-xs ml-2 bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800" data-testid="badge-quality-step-6">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {objects.length} objekt tillgängliga
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs ml-2 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800" data-testid="badge-quality-step-6">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Importera objekt först
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription>
                      Tilldela metadata till importerade objekt — manuellt eller via CSV
                    </CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSkipConfirmStep(6)} data-testid="button-skip-step-6">
                  <SkipForward className="h-4 w-4 mr-1" />
                  Hoppa över
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs defaultValue="bulk" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="bulk" data-testid="tab-metadata-bulk">Manuell tilldelning</TabsTrigger>
                  <TabsTrigger value="csv" data-testid="tab-metadata-csv">CSV-import</TabsTrigger>
                </TabsList>

                <TabsContent value="bulk" className="space-y-4 mt-4">
                  <div className="bg-purple-50 dark:bg-purple-950/20 p-3 rounded-md text-sm space-y-1">
                    <p className="font-medium text-purple-700 dark:text-purple-300">Välj objekt och tilldela en metadata-etikett med ett värde:</p>
                    <ul className="text-purple-600 dark:text-purple-400 text-xs space-y-0.5 ml-4 list-disc">
                      <li>Markera objekt i listan nedan</li>
                      <li>Ange etikett (t.ex. "Kärlstorlek") och värde (t.ex. "370L")</li>
                      <li>Klicka "Tilldela metadata" för att skriva till alla valda objekt</li>
                    </ul>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Metadata-etikett</label>
                      <Input
                        placeholder="t.ex. Kärlstorlek, Material, Typ"
                        value={metadataLabel}
                        onChange={(e) => setMetadataLabel(e.target.value)}
                        className="h-8 text-sm"
                        data-testid="input-metadata-label"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">Värde</label>
                      <Input
                        placeholder="t.ex. 370L, Plast, Underjord"
                        value={metadataValue}
                        onChange={(e) => setMetadataValue(e.target.value)}
                        className="h-8 text-sm"
                        data-testid="input-metadata-value"
                      />
                    </div>
                  </div>

                  {objects.length > 0 && (
                    <div className="border rounded-md">
                      <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
                        <Checkbox
                          checked={metadataSelectAll}
                          onCheckedChange={(checked) => {
                            setMetadataSelectAll(!!checked);
                            if (checked) {
                              setSelectedMetadataObjects(new Set(objects.map(o => o.id)));
                            } else {
                              setSelectedMetadataObjects(new Set());
                            }
                          }}
                          data-testid="checkbox-metadata-select-all"
                        />
                        <span className="text-xs font-medium text-muted-foreground">
                          Markera alla ({objects.length} objekt) — {selectedMetadataObjects.size} valda
                        </span>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        <div className="divide-y">
                          {objects.slice(0, 200).map(obj => (
                            <div key={obj.id} className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/30">
                              <Checkbox
                                checked={selectedMetadataObjects.has(obj.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedMetadataObjects(prev => {
                                    const next = new Set(prev);
                                    if (checked) next.add(obj.id); else next.delete(obj.id);
                                    return next;
                                  });
                                }}
                                data-testid={`checkbox-metadata-obj-${obj.id.slice(0, 8)}`}
                              />
                              <span className="font-medium">{obj.name}</span>
                              {obj.objectNumber && <span className="text-muted-foreground font-mono">({obj.objectNumber})</span>}
                              {obj.address && <span className="text-muted-foreground ml-auto">{obj.address}</span>}
                            </div>
                          ))}
                          {objects.length > 200 && (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground text-center">
                              ... och {objects.length - 200} fler objekt
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <Button
                      variant="default"
                      disabled={isAssigningMetadata || selectedMetadataObjects.size === 0 || !metadataLabel || !metadataValue}
                      onClick={handleMetadataBulkAssign}
                      data-testid="button-metadata-assign"
                    >
                      {isAssigningMetadata ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Tag className="h-4 w-4 mr-2" />
                      )}
                      Tilldela metadata ({selectedMetadataObjects.size} objekt)
                    </Button>
                  </div>

                  {metadataAssignResult && (
                    <div className="grid grid-cols-2 gap-3 p-3 border rounded-lg bg-muted/30">
                      <div className="text-center">
                        <div className="text-lg font-bold text-green-600">{metadataAssignResult.written}</div>
                        <div className="text-xs text-muted-foreground">Objekt uppdaterade</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-red-500">{metadataAssignResult.errors.length}</div>
                        <div className="text-xs text-muted-foreground">Fel</div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="csv" className="space-y-4 mt-4">
                  <div className="bg-purple-50 dark:bg-purple-950/20 p-3 rounded-md text-sm space-y-1">
                    <p className="font-medium text-purple-700 dark:text-purple-300">CSV med metadata per objekt:</p>
                    <ul className="text-purple-600 dark:text-purple-400 text-xs space-y-0.5 ml-4 list-disc">
                      <li>Kolumn "objektnummer" eller "objektnamn" identifierar objektet</li>
                      <li>Övriga kolumner blir metadata-etiketter med cellvärden som metadata-värden</li>
                      <li>Nya metadata-typer skapas automatiskt</li>
                    </ul>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {["objektnummer", "Kärlstorlek", "Material", "Frekvens"].map(col => (
                        <Badge key={col} variant="secondary" className="text-xs font-mono">{col}</Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      accept=".csv"
                      className="hidden"
                      id="metadata-csv-import"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleMetadataCsvUpload(file);
                        e.target.value = "";
                      }}
                      data-testid="input-metadata-csv"
                    />
                    <Button
                      variant="outline"
                      disabled={objects.length === 0}
                      onClick={() => document.getElementById("metadata-csv-import")?.click()}
                      data-testid="button-metadata-csv-upload"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Välj metadata-CSV
                    </Button>
                  </div>

                  {metadataCsvResult && (
                    <div className="grid grid-cols-3 gap-3 p-3 border rounded-lg bg-muted/30">
                      <div className="text-center">
                        <div className="text-lg font-bold text-green-600">{metadataCsvResult.written}</div>
                        <div className="text-xs text-muted-foreground">Värden skrivna</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-purple-600">{metadataCsvResult.metadataColumns.length}</div>
                        <div className="text-xs text-muted-foreground">Metadata-kolumner</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-red-500">{metadataCsvResult.errors.length}</div>
                        <div className="text-xs text-muted-foreground">Fel</div>
                      </div>
                      {metadataCsvResult.metadataColumns.length > 0 && (
                        <div className="col-span-full flex flex-wrap gap-1">
                          {metadataCsvResult.metadataColumns.map(col => (
                            <Badge key={col} variant="secondary" className="text-xs">{col}</Badge>
                          ))}
                        </div>
                      )}
                      {metadataCsvResult.errors.length > 0 && (
                        <div className="col-span-full">
                          <details className="text-xs">
                            <summary className="text-red-600 cursor-pointer font-medium">Visa fel ({metadataCsvResult.errors.length})</summary>
                            <div className="max-h-24 overflow-y-auto mt-1">
                              <ul className="text-muted-foreground space-y-0.5 ml-4 list-disc">
                                {metadataCsvResult.errors.map((err, i) => <li key={i}>{err}</li>)}
                              </ul>
                            </div>
                          </details>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              <div className="flex justify-end">
                <Button variant="default" onClick={() => markStepCompleted(6)} data-testid="button-complete-step-6">
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Markera som klar
                </Button>
              </div>
            </CardContent>
          </Card>
          )}

          {activeModusStep === 7 && (
            <ImportSummaryView
              completedSteps={completedSteps}
              skippedSteps={skippedSteps}
              modusResults={modusResults}
              firstSkippedStep={firstSkippedStep}
              onGoToStep={goToStep}
              onReset={() => {
                setSkippedSteps(new Set());
                setCompletedSteps(new Set());
                setActiveModusStep(2);
                setModusResults({ objects: null, tasks: null, events: null, "invoice-lines": null });
                localStorage.removeItem(STORAGE_KEY);
              }}
            />
          )}

          <ImportHealthOverview />

          {importBatches.length > 0 && (
            <Card data-testid="card-import-history">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Importhistorik
                </CardTitle>
                <CardDescription>Tidigare importer med möjlighet att ångra</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-60 overflow-y-auto">
                  <div className="space-y-2">
                    {importBatches.map((batch) => (
                      <div 
                        key={batch.batchId} 
                        className="flex items-center justify-between gap-4 p-3 border rounded-md"
                        data-testid={`batch-row-${batch.batchId.slice(0, 8)}`}
                      >
                        <div className="flex items-center gap-4 flex-wrap text-sm">
                          <span className="text-muted-foreground text-xs">
                            {batch.importedAt ? new Date(batch.importedAt).toLocaleString("sv-SE") : "Okänt datum"}
                          </span>
                          <div className="flex items-center gap-3 flex-wrap">
                            {batch.objects > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                <Building2 className="h-3 w-3 mr-1" />
                                {batch.objects} objekt
                              </Badge>
                            )}
                            {batch.workOrders > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                <Truck className="h-3 w-3 mr-1" />
                                {batch.workOrders} ordrar
                              </Badge>
                            )}
                            {batch.customers > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                <Users className="h-3 w-3 mr-1" />
                                {batch.customers} kunder
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setUndoBatchId(batch.batchId)}
                          disabled={undoBatchMutation.isPending}
                          data-testid={`button-undo-batch-${batch.batchId.slice(0, 8)}`}
                        >
                          <Undo2 className="h-3 w-3 mr-1" />
                          Ångra import
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-green-700 dark:text-green-300">Efter import — verifiera</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>Gå till <a href="/planner" className="text-blue-600 underline">Veckoplanering</a> och kontrollera att objekt och resurser syns</li>
                    <li>Kontrollera att kundlistan under <a href="/customers" className="text-blue-600 underline">Kunder</a> ser korrekt ut</li>
                    <li>Verifiera att hierarkin (Fastighet → Rum → Objekt) stämmer under <a href="/objects" className="text-blue-600 underline">Objekt</a></li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Importordning</CardTitle>
              <CardDescription>Importera data i rätt ordning för att undvika fel</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li><strong>Kunder först</strong> — Objekt måste kopplas till befintliga kunder</li>
                <li><strong>Resurser</strong> — Kan importeras när som helst</li>
                <li><strong>Objekt</strong> — Kräver att kunder redan finns i systemet</li>
              </ol>
              <p className="text-xs text-muted-foreground mt-3">
                Tips: Via Modus 2.0-fliken skapas kunder automatiskt vid objektimport — då behövs ingen separat kundfil.
              </p>
            </CardContent>
          </Card>

          <Tabs value={selectedType} onValueChange={(v) => setSelectedType(v as ImportType)}>
            <TabsList className="grid w-full grid-cols-3">
              {IMPORT_TYPES_INFO.map(({ type, label, icon: Icon }) => (
                <TabsTrigger 
                  key={type} 
                  value={type}
                  className="flex items-center gap-2"
                  data-testid={`tab-import-${type}`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  <Badge variant="secondary" className="ml-1">{counts[type]}</Badge>
                </TabsTrigger>
              ))}
            </TabsList>

            {IMPORT_TYPES_INFO.map(({ type }) => (
              <TabsContent key={type} value={type} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Download className="h-4 w-4" />
                        Ladda ner mall
                      </CardTitle>
                      <CardDescription>
                        Ladda ner en CSV-mall med rätt kolumner och exempeldata
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button 
                        variant="outline" 
                        onClick={() => downloadTemplate(type)}
                        className="w-full"
                        data-testid={`button-download-template-${type}`}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Ladda ner mall_{type}.csv
                      </Button>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Trash2 className="h-4 w-4" />
                        Rensa data
                      </CardTitle>
                      <CardDescription>
                        Ta bort all befintlig data av denna typ
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button 
                        variant="outline"
                        onClick={() => clearMutation.mutate(type)}
                        disabled={clearMutation.isPending}
                        className="w-full"
                        data-testid={`button-clear-${type}`}
                      >
                        {clearMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-2" />
                        )}
                        Rensa {IMPORT_TYPES_INFO.find(t => t.type === type)?.label.toLowerCase()}
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Upload className="h-5 w-5" />
                      Ladda upp fil
                    </CardTitle>
                    <CardDescription>
                      Dra och släpp en CSV-fil eller klicka för att välja
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div
                      className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                        isDragging 
                          ? "border-primary bg-primary/5" 
                          : "border-muted-foreground/25 hover:border-muted-foreground/50"
                      }`}
                      onDrop={createDropHandler(type)}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onClick={() => document.getElementById(`file-input-${type}`)?.click()}
                      data-testid={`dropzone-${type}`}
                    >
                      <FileUp className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                      <p className="text-sm font-medium mb-1">
                        {isDragging ? "Släpp filen här" : "Dra och släpp CSV-fil här"}
                      </p>
                      <p className="text-xs text-muted-foreground mb-3">
                        eller klicka för att välja fil
                      </p>
                      <Button variant="secondary" size="sm" data-testid={`button-select-file-${type}`}>
                        Välj fil
                      </Button>
                      <input
                        id={`file-input-${type}`}
                        type="file"
                        accept=".csv"
                        onChange={(e) => handleFileSelect(e, type)}
                        className="hidden"
                      />
                    </div>

                    <div className="bg-muted p-3 rounded-md">
                      <p className="text-xs font-medium mb-1">Förväntade kolumner:</p>
                      <code className="text-xs break-all text-muted-foreground">
                        {CSV_TEMPLATES[type].headers.join(", ")}
                      </code>
                    </div>
                  </CardContent>
                </Card>

                {lastResult && selectedType === type && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        {lastResult.errors.length === 0 ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-orange-500" />
                        )}
                        Senaste import
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-green-600" />
                        <span>{lastResult.imported} poster importerade</span>
                      </div>
                      
                      {lastResult.errors.length > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm text-orange-600">
                            <AlertCircle className="h-4 w-4" />
                            <span>{lastResult.errors.length} fel:</span>
                          </div>
                          <ScrollArea className="h-32">
                            <ul className="text-xs text-muted-foreground pl-6 space-y-0.5">
                              {lastResult.errors.map((err, i) => (
                                <li key={i}>{err}</li>
                              ))}
                            </ul>
                          </ScrollArea>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>

        <TabsContent value="fortnox" className="space-y-6">
          <Tabs defaultValue="customers" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="customers" data-testid="tab-fortnox-customers">
                Kunder & objekt
              </TabsTrigger>
              <TabsTrigger value="invoices" data-testid="tab-fortnox-invoices">
                Fakturahistorik → avtalsförslag
              </TabsTrigger>
            </TabsList>
            <TabsContent value="customers" className="space-y-4 mt-4">
              <FortnoxXlsxImportPanel />
            </TabsContent>
            <TabsContent value="invoices" className="space-y-4 mt-4">
              <FortnoxInvoiceImportPanel />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="mapped" className="space-y-6">
          <Card className="border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Database className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p className="text-sm font-medium">Mappad import med kolumnmappning</p>
                  <p className="text-sm text-muted-foreground">
                    Ladda upp en CSV-fil och mappa kolumner till systemfält manuellt. 
                    Bra för filer som inte följer Modus-standarden. Systemet föreslår mappning automatiskt.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <ImportColumnMapper />
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <ImportHistorySection />
        </TabsContent>

        <TabsContent value="quality" className="space-y-6">
          <DataQualityDashboard />
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!undoBatchId} onOpenChange={(open) => { if (!open) setUndoBatchId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ångra import</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ångra denna import? Alla objekt, arbetsordrar och kunder som skapades i denna import kommer att tas bort permanent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-undo">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (undoBatchId) undoBatchMutation.mutate(undoBatchId); }}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-undo"
            >
              {undoBatchMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Ja, ångra import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Förhandsgranska import
            </DialogTitle>
            <DialogDescription>
              Kontrollera datan innan du importerar. {selectedFile?.name}
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex items-center gap-4 py-2">
            <Badge variant="secondary" className="gap-1">
              Totalt: {previewStats.total} rader
            </Badge>
            <Badge variant="default" className="gap-1 bg-green-600">
              <Check className="h-3 w-3" />
              Giltiga: {previewStats.valid}
            </Badge>
            {previewStats.invalid > 0 && (
              <Badge variant="destructive" className="gap-1">
                <X className="h-3 w-3" />
                Ogiltiga: {previewStats.invalid}
              </Badge>
            )}
          </div>

          <ScrollArea className="flex-1 border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Rad</TableHead>
                  <TableHead className="w-16">Status</TableHead>
                  {previewTemplate.headers.slice(0, 6).map((header) => (
                    <TableHead key={header} className="min-w-[100px]">{header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewData.slice(0, 100).map((row) => (
                  <TableRow 
                    key={row.rowNumber}
                    className={!row.isValid ? "bg-red-50 dark:bg-red-950/20" : ""}
                  >
                    <TableCell className="font-mono text-xs">{row.rowNumber}</TableCell>
                    <TableCell>
                      {row.isValid ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <X className="h-4 w-4 text-red-500" />
                      )}
                    </TableCell>
                    {previewTemplate.headers.slice(0, 6).map((header) => (
                      <TableCell key={header} className="text-xs max-w-[150px] truncate">
                        {row.data[header] || "-"}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {previewData.length > 100 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      ... och {previewData.length - 100} fler rader
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>

          {previewStats.invalid > 0 && (
            <div className="bg-orange-50 dark:bg-orange-950/20 p-3 rounded-md">
              <p className="text-sm font-medium text-orange-700 dark:text-orange-300 mb-1">
                Ogiltiga rader (importeras inte):
              </p>
              <ScrollArea className="h-24">
                <ul className="text-xs space-y-1">
                  {previewData.filter(r => !r.isValid).slice(0, 20).map((row) => (
                    <li key={row.rowNumber} className="text-orange-600 dark:text-orange-400">
                      Rad {row.rowNumber}: {row.errors.join(", ")}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          )}

          <DialogFooter className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setShowPreview(false)} data-testid="button-cancel-preview">
              Avbryt
            </Button>
            <Button 
              onClick={confirmImport}
              disabled={importMutation.isPending || previewStats.valid === 0}
              data-testid="button-confirm-import"
            >
              {importMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Importera {previewStats.valid} rader
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={skipConfirmStep !== null} onOpenChange={(open) => { if (!open) setSkipConfirmStep(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hoppa över detta steg?</AlertDialogTitle>
            <AlertDialogDescription>
              Du kan alltid gå tillbaka och importera detta steg senare genom att klicka på steget i stegöversikten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-skip">Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => skipConfirmStep && skipStep(skipConfirmStep)} data-testid="button-confirm-skip">
              <SkipForward className="h-4 w-4 mr-1" />
              Hoppa över
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
