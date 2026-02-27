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
import { 
  Upload, Users, Building2, Truck, Trash2, CheckCircle, AlertCircle, 
  Loader2, Download, Eye, X, FileUp, Check, Clock, FileSpreadsheet, Database,
  ArrowRight, Info, Settings, ChevronDown, ChevronUp, ListChecks, History, Undo2
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Papa from "papaparse";
import type { Customer, Resource, ServiceObject } from "@shared/schema";

type ImportType = "customers" | "resources" | "objects";
type ModusImportType = "objects" | "tasks" | "events";

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
  { name: "Uppgiftsnamn", required: false, description: "Titel på arbetsorderna" },
  { name: "Uppgiftstyp", required: false, description: "Typ: karlttvatt, rumstvatt, hamtning etc." },
  { name: "Status", required: false, description: "Status: done → slutförd, etc." },
  { name: "Team", required: false, description: "Resursnamn (skapas automatiskt om den saknas)" },
  { name: "Planerad dag o tid", required: false, description: "Datum i ISO-format eller standardformat" },
];

const MODUS_EVENT_COLUMNS = [
  { name: "Uppgifts Id", required: true, description: "Kopplar händelsen till en uppgift" },
  { name: "Event Typ", required: true, description: "Typ av händelse: in_progress, done" },
  { name: "Tid", required: true, description: "Tidsstämpel för händelsen" },
];

function StepIndicator({ step, title, active, completed }: { step: number; title: string; active: boolean; completed: boolean }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
      active ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800" :
      completed ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800" :
      "bg-muted/30 border border-transparent"
    }`}>
      <div className={`flex items-center justify-center h-8 w-8 rounded-full text-sm font-bold ${
        completed ? "bg-green-600 text-white" :
        active ? "bg-blue-600 text-white" :
        "bg-muted text-muted-foreground"
      }`}>
        {completed ? <Check className="h-4 w-4" /> : step}
      </div>
      <span className={`text-sm font-medium ${
        active ? "text-blue-700 dark:text-blue-300" :
        completed ? "text-green-700 dark:text-green-300" :
        "text-muted-foreground"
      }`}>{title}</span>
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

export default function ImportPage() {
  const { toast } = useToast();
  const [selectedType, setSelectedType] = useState<ImportType>("customers");
  const [previewType, setPreviewType] = useState<ImportType>("customers");
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [previewData, setPreviewData] = useState<ParsedRow[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"modus" | "manual">("modus");
  const [showObjectColumns, setShowObjectColumns] = useState(false);
  const [showTaskColumns, setShowTaskColumns] = useState(false);
  const [showEventColumns, setShowEventColumns] = useState(false);
  
  const [modusUploading, setModusUploading] = useState<ModusImportType | null>(null);
  const [modusResults, setModusResults] = useState<{
    objects: ModusObjectResult | null;
    tasks: ImportResult | null;
    events: ModusEventsResult | null;
  }>({ objects: null, tasks: null, events: null });
  const [modusObjectFile, setModusObjectFile] = useState<File | null>(null);
  const [modusValidation, setModusValidation] = useState<ModusValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [importProgress, setImportProgress] = useState<SSEProgress | null>(null);
  const [undoBatchId, setUndoBatchId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: workOrders = [] } = useQuery<{ id: string }[]>({ queryKey: ["/api/work-orders"] });
  const { data: resources = [] } = useQuery<Resource[]>({ queryKey: ["/api/resources"] });
  const { data: objects = [] } = useQuery<ServiceObject[]>({ queryKey: ["/api/objects"] });
  const { data: importBatches = [], isLoading: batchesLoading } = useQuery<ImportBatch[]>({ queryKey: ["/api/import/batches"] });

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
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte ångra importen.", variant: "destructive" });
      setUndoBatchId(null);
    },
  });

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const connectSSE = useCallback((jobId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    const es = new EventSource(`/api/import/progress/${jobId}`);
    eventSourceRef.current = es;
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SSEProgress;
        setImportProgress(data);
        if (data.status === "completed") {
          es.close();
          eventSourceRef.current = null;
          if (data.result) {
            setModusResults(prev => ({ ...prev, objects: data.result as ModusObjectResult }));
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
          setModusUploading(null);
        }
      } catch {}
    };
    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  const counts = {
    customers: customers.length,
    resources: resources.length,
    objects: objects.length,
  };

  const importStep = useMemo(() => {
    if (objects.length > 0 && workOrders.length > 0) return 4;
    if (objects.length > 0) return 3;
    return 1;
  }, [objects.length, workOrders.length]);

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
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte rensa data.",
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

  const handleModusValidate = async (file: File) => {
    setModusObjectFile(file);
    setModusValidation(null);
    setIsValidating(true);
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

  const handleModusImportAfterValidation = async () => {
    if (!modusObjectFile) return;
    setImportProgress(null);
    await handleModusUpload("objects", modusObjectFile);
    setModusObjectFile(null);
    setModusValidation(null);
  };

  const handleModusUpload = async (type: ModusImportType, file: File) => {
    setModusUploading(type);
    const formData = new FormData();
    formData.append("file", file);
    
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
      
      if (type === "events") {
        toast({
          title: "Analys klar",
          description: `Analyserade ${(result as ModusEventsResult).totalEvents} händelser`,
        });
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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-import-title">Importera data</h1>
        <p className="text-muted-foreground">Importera kunddata, objekt och arbetsordrar från Modus 2.0 eller CSV-filer</p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "modus" | "manual")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="modus" className="flex items-center gap-2" data-testid="tab-modus-import">
            <FileSpreadsheet className="h-4 w-4" />
            Modus 2.0 Import
          </TabsTrigger>
          <TabsTrigger value="manual" className="flex items-center gap-2" data-testid="tab-manual-import">
            <Upload className="h-4 w-4" />
            Manuell CSV-import
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
                    Följ stegen nedan för att migrera er data från Modus 2.0 till Unicorn. 
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
            <StepIndicator step={1} title="Företagsinställningar" active={importStep === 1} completed={importStep > 1} />
            <ArrowRight className="h-5 w-5 text-muted-foreground self-center hidden md:block" />
            <StepIndicator step={2} title="Importera objekt" active={importStep === 2 || importStep === 1} completed={importStep >= 3} />
            <ArrowRight className="h-5 w-5 text-muted-foreground self-center hidden md:block" />
            <StepIndicator step={3} title="Importera uppgifter" active={importStep === 3} completed={importStep >= 4} />
            <ArrowRight className="h-5 w-5 text-muted-foreground self-center hidden md:block" />
            <StepIndicator step={4} title="Analysera händelser" active={importStep === 4} completed={false} />
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

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-600 text-white text-sm font-bold">2</div>
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Importera objekt från Modus 2.0
                  </CardTitle>
                  <CardDescription>
                    Objekt-hierarkin (fastigheter, rum, kärl) — kunder skapas automatiskt
                  </CardDescription>
                </div>
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
                <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-sm">Valideringsresultat</span>
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

                  {(modusValidation.missingFieldsCount > 0 || modusValidation.duplicateModusIdsCount > 0 || modusValidation.invalidCoordinatesCount > 0 || modusValidation.missingParents.length > 0 || modusValidation.warnings.length > 0) && (
                    <div className="space-y-2 border-t pt-3">
                      <p className="text-xs font-medium text-orange-600 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Varningar
                      </p>
                      {modusValidation.missingFieldsCount > 0 && (
                        <div className="text-xs text-muted-foreground flex items-start gap-2">
                          <X className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                          <span>{modusValidation.missingFieldsCount} rader saknar obligatoriska fält (Id eller Namn)</span>
                        </div>
                      )}
                      {modusValidation.duplicateModusIdsCount > 0 && (
                        <div className="text-xs text-muted-foreground flex items-start gap-2">
                          <AlertCircle className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" />
                          <span>{modusValidation.duplicateModusIdsCount} duplicerade Modus-ID i filen</span>
                        </div>
                      )}
                      {modusValidation.invalidCoordinatesCount > 0 && (
                        <div className="text-xs text-muted-foreground flex items-start gap-2">
                          <AlertCircle className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" />
                          <span>{modusValidation.invalidCoordinatesCount} rader med ogiltiga koordinater (utanför Sverige)</span>
                        </div>
                      )}
                      {modusValidation.missingParents.length > 0 && (
                        <div className="text-xs text-muted-foreground flex items-start gap-2">
                          <AlertCircle className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" />
                          <span>{modusValidation.missingParents.length} saknade föräldra-ID:n</span>
                        </div>
                      )}
                      {modusValidation.warnings.map((w, i) => (
                        <div key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                          <AlertCircle className="h-3 w-3 text-orange-500 mt-0.5 shrink-0" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-2 border-t">
                    <Button
                      variant="default"
                      disabled={modusUploading !== null}
                      onClick={handleModusImportAfterValidation}
                      data-testid="button-modus-start-import"
                    >
                      {modusUploading === "objects" ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      Starta import ({modusValidation.totalRows} objekt)
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => { setModusValidation(null); setModusObjectFile(null); }}
                      data-testid="button-modus-cancel-validation"
                    >
                      Avbryt
                    </Button>
                  </div>
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

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-600 text-white text-sm font-bold">3</div>
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Truck className="h-4 w-4" />
                    Importera uppgifter (arbetsordrar)
                  </CardTitle>
                  <CardDescription>
                    Arbetsordrar med schemaläggning — resurser skapas automatiskt
                  </CardDescription>
                </div>
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
                    if (file) handleModusUpload("tasks", file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="default"
                  disabled={modusUploading !== null}
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

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-600 text-white text-sm font-bold">4</div>
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Analysera händelser (valfritt)
                  </CardTitle>
                  <CardDescription>
                    Beräknar arbetstider och ställtider baserat på historiska händelser
                  </CardDescription>
                </div>
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
                <ScrollArea className="max-h-60">
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
                </ScrollArea>
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
                    <li>Verifiera att hierarkin (Fastighet → Rum → Kärl) stämmer under <a href="/objects" className="text-blue-600 underline">Objekt</a></li>
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
                <li><strong>Objekt sist</strong> — Kräver att kunder redan finns i systemet</li>
              </ol>
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
    </div>
  );
}
