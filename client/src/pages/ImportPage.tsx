import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  Upload, Users, Building2, Truck, Trash2, CheckCircle, AlertCircle, 
  Loader2, Download, Eye, X, FileUp, Check, Clock, FileSpreadsheet, Database
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
  imported: number;
  parentsUpdated: number;
  customersCreated: number;
  skipped: number;
  metadataWritten: number;
  metadataColumns: string[];
  errors: string[];
  totalRows: number;
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

export default function ImportPage() {
  const { toast } = useToast();
  const [selectedType, setSelectedType] = useState<ImportType>("customers");
  const [previewType, setPreviewType] = useState<ImportType>("customers");
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [previewData, setPreviewData] = useState<ParsedRow[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const [modusUploading, setModusUploading] = useState<ModusImportType | null>(null);
  const [modusResults, setModusResults] = useState<{
    objects: ModusObjectResult | null;
    tasks: ImportResult | null;
    events: ModusEventsResult | null;
  }>({ objects: null, tasks: null, events: null });

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: workOrders = [] } = useQuery<{ id: string }[]>({ queryKey: ["/api/work-orders"] });
  const { data: resources = [] } = useQuery<Resource[]>({ queryKey: ["/api/resources"] });
  const { data: objects = [] } = useQuery<ServiceObject[]>({ queryKey: ["/api/objects"] });

  const counts = {
    customers: customers.length,
    resources: resources.length,
    objects: objects.length,
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

  const handleModusUpload = async (type: ModusImportType, file: File) => {
    setModusUploading(type);
    const formData = new FormData();
    formData.append("file", file);
    
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
      setModusResults(prev => ({ ...prev, [type]: result }));
      
      if (type === "events") {
        toast({
          title: "Analys klar",
          description: `Analyserade ${(result as ModusEventsResult).totalEvents} händelser`,
        });
      } else {
        toast({
          title: "Import klar",
          description: `${(result as ImportResult).imported} poster importerade`,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/objects"] });
        queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      }
    } catch (error) {
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
        <h1 className="text-2xl font-bold">Importera data</h1>
        <p className="text-muted-foreground">Ladda upp CSV-filer med kunder, resurser och objekt</p>
      </div>

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

      <Card>
        <CardHeader>
          <CardTitle>Importordning</CardTitle>
          <CardDescription>Importera data i rätt ordning för att undvika fel</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li><strong>Kunder först</strong> - Objekt måste kopplas till befintliga kunder</li>
            <li><strong>Resurser</strong> - Kan importeras när som helst</li>
            <li><strong>Objekt sist</strong> - Kräver att kunder redan finns i systemet</li>
          </ol>
        </CardContent>
      </Card>

      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-blue-600" />
            Modus 2.0 Import
          </CardTitle>
          <CardDescription>
            Importera data direkt från Modus 2.0 CSV-exporter (semikolon-separerade)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="text-center">
              <div className="text-lg font-bold">{customers.length}</div>
              <div className="text-xs text-muted-foreground">Kunder</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold">{objects.length}</div>
              <div className="text-xs text-muted-foreground">Objekt</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold">{resources.length}</div>
              <div className="text-xs text-muted-foreground">Resurser</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold">{workOrders.length}</div>
              <div className="text-xs text-muted-foreground">Uppgifter</div>
            </div>
          </div>
          
          <div className="grid md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  1. Objekt
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Importerar objekt-hierarkin och skapar automatiskt kunder
                </p>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  id="modus-objects"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleModusUpload("objects", file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={modusUploading !== null}
                  onClick={() => document.getElementById("modus-objects")?.click()}
                  data-testid="button-modus-objects"
                >
                  {modusUploading === "objects" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Välj objekt.csv
                </Button>
                {modusResults.objects && (
                  <div className="text-xs space-y-1 pt-2 border-t">
                    <div className="flex items-center gap-1 text-green-600">
                      <CheckCircle className="h-3 w-3" />
                      {modusResults.objects.imported} objekt
                    </div>
                    <div className="text-muted-foreground">
                      {modusResults.objects.customersCreated} kunder skapade
                    </div>
                    <div className="text-muted-foreground">
                      {modusResults.objects.parentsUpdated} hierarkiska kopplingar
                    </div>
                    {(modusResults.objects.metadataWritten || 0) > 0 && (
                      <div className="flex items-center gap-1 text-blue-600">
                        <Database className="h-3 w-3" />
                        {modusResults.objects.metadataWritten} metadata-varden
                        {modusResults.objects.metadataColumns?.length > 0 && (
                          <span className="text-muted-foreground">
                            ({modusResults.objects.metadataColumns.join(", ")})
                          </span>
                        )}
                      </div>
                    )}
                    {modusResults.objects.errors.length > 0 && (
                      <div className="text-orange-600">
                        {modusResults.objects.errors.length} varningar
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  2. Uppgifter
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Importerar arbetsordrar och schemaläggning
                </p>
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
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={modusUploading !== null}
                  onClick={() => document.getElementById("modus-tasks")?.click()}
                  data-testid="button-modus-tasks"
                >
                  {modusUploading === "tasks" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Välj uppgifter.csv
                </Button>
                {modusResults.tasks && (
                  <div className="text-xs space-y-1 pt-2 border-t">
                    <div className="flex items-center gap-1 text-green-600">
                      <CheckCircle className="h-3 w-3" />
                      {modusResults.tasks.imported} uppgifter
                    </div>
                    {modusResults.tasks.errors.length > 0 && (
                      <div className="text-orange-600">
                        {modusResults.tasks.errors.length} varningar
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  3. Händelser (analys)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Analyserar händelser för arbetstidsstatistik
                </p>
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
                  size="sm"
                  className="w-full"
                  disabled={modusUploading !== null}
                  onClick={() => document.getElementById("modus-events")?.click()}
                  data-testid="button-modus-events"
                >
                  {modusUploading === "events" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Välj händelser.csv
                </Button>
                {modusResults.events && (
                  <div className="text-xs space-y-1 pt-2 border-t">
                    <div className="flex items-center gap-1 text-blue-600">
                      <CheckCircle className="h-3 w-3" />
                      {modusResults.events.totalEvents} händelser
                    </div>
                    <div className="p-2 bg-blue-50 dark:bg-blue-950 rounded text-center">
                      <div className="text-lg font-bold text-blue-600">
                        {modusResults.events.averageSetupTime} min
                      </div>
                      <div className="text-muted-foreground">snitt arbetstid</div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary" className="text-xs no-default-hover-elevate">
                        {"<"}5: {modusResults.events.setupTimeDistribution.under5min}
                      </Badge>
                      <Badge variant="secondary" className="text-xs no-default-hover-elevate">
                        5-15: {modusResults.events.setupTimeDistribution["5to15min"]}
                      </Badge>
                      <Badge variant="secondary" className="text-xs no-default-hover-elevate">
                        15-30: {modusResults.events.setupTimeDistribution["15to30min"]}
                      </Badge>
                      <Badge variant="secondary" className="text-xs no-default-hover-elevate">
                        {">"}30: {modusResults.events.setupTimeDistribution.over30min}
                      </Badge>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          
          <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded">
            <strong>Tips:</strong> Modus 2.0 exporterar CSV med semikolon (;) som separator. 
            Importen hanterar detta automatiskt. Importera objekt först, sedan uppgifter, och sist händelser för analys.
          </div>
        </CardContent>
      </Card>

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
