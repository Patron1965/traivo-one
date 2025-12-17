import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, Users, Building2, Truck, Trash2, FileText, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Customer, Resource, ServiceObject } from "@shared/schema";

type ImportType = "customers" | "resources" | "objects";

interface ImportResult {
  imported: number;
  errors: string[];
}

export default function ImportPage() {
  const { toast } = useToast();
  const [selectedType, setSelectedType] = useState<ImportType>("customers");
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);

  const { data: customers = [] } = useQuery<Customer[]>({ queryKey: ["/api/customers"] });
  const { data: resources = [] } = useQuery<Resource[]>({ queryKey: ["/api/resources"] });
  const { data: objects = [] } = useQuery<ServiceObject[]>({ queryKey: ["/api/objects"] });

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      importMutation.mutate({ type: selectedType, file });
    }
    e.target.value = "";
  };

  const importTypes = [
    { 
      type: "customers" as ImportType, 
      label: "Kunder", 
      icon: Users, 
      count: customers.length,
      description: "Bostadsbolag och fastighetsägare",
      columns: "namn, kundnummer, kontaktperson, epost, telefon, adress, stad, postnummer"
    },
    { 
      type: "resources" as ImportType, 
      label: "Resurser", 
      icon: Truck, 
      count: resources.length,
      description: "Chaufförer och tekniker",
      columns: "namn, initialer, telefon, epost, hemort, timmar, kompetenser"
    },
    { 
      type: "objects" as ImportType, 
      label: "Objekt", 
      icon: Building2, 
      count: objects.length,
      description: "Fastigheter, soprum och behållare",
      columns: "kund, namn, objektnummer, typ, nivå, förälder, adress, stad, postnummer, tillgång, portkod, nyckelnummer, kärl, k2, k3, k4"
    },
  ];

  const selectedInfo = importTypes.find(t => t.type === selectedType);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Importera data</h1>
        <p className="text-muted-foreground">Ladda upp CSV-filer med kunder, resurser och objekt</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {importTypes.map(({ type, label, icon: Icon, count, description }) => (
          <Card 
            key={type}
            className={`cursor-pointer hover-elevate ${selectedType === type ? "ring-2 ring-primary" : ""}`}
            onClick={() => setSelectedType(type)}
            data-testid={`select-import-${type}`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-base">{label}</CardTitle>
                </div>
                <Badge variant="secondary">{count}</Badge>
              </div>
              <CardDescription className="text-xs">{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Importera {selectedInfo?.label}
          </CardTitle>
          <CardDescription>
            Ladda upp en CSV-fil med följande kolumner:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-3 rounded-md">
            <code className="text-xs break-all">{selectedInfo?.columns}</code>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <Button 
              disabled={importMutation.isPending}
              onClick={() => document.getElementById("file-input")?.click()}
              data-testid="button-upload-file"
            >
              {importMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Välj CSV-fil
            </Button>
            
            <Button 
              variant="outline" 
              onClick={() => clearMutation.mutate(selectedType)}
              disabled={clearMutation.isPending}
              data-testid="button-clear-data"
            >
              {clearMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Rensa {selectedInfo?.label?.toLowerCase()}
            </Button>

            <input
              id="file-input"
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
              data-testid="input-file"
            />
          </div>

          {lastResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span>{lastResult.imported} poster importerade</span>
              </div>
              
              {lastResult.errors.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-orange-600">
                    <AlertCircle className="h-4 w-4" />
                    <span>{lastResult.errors.length} fel:</span>
                  </div>
                  <ul className="text-xs text-muted-foreground pl-6 space-y-0.5">
                    {lastResult.errors.slice(0, 10).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {lastResult.errors.length > 10 && (
                      <li>... och {lastResult.errors.length - 10} till</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
    </div>
  );
}
