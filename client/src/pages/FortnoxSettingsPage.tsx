import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ExternalLink,
  Link2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Settings,
  Users,
  Package,
  Building,
  FolderKanban,
  Loader2,
  AlertTriangle,
  FileText,
  Clock,
  Trash2,
  Plus,
  Download,
  Search,
  CheckCheck,
  Ban,
} from "lucide-react";
import type { Customer, Article, Resource, Team } from "@shared/schema";

interface FortnoxConfig {
  id: string;
  tenantId: string;
  clientId: string | null;
  clientSecret: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface FortnoxMapping {
  id: string;
  tenantId: string;
  entityType: string;
  unicornId: string;
  fortnoxId: string;
  lastSyncedAt: string | null;
  createdAt: string;
}

interface FortnoxInvoiceExport {
  id: string;
  tenantId: string;
  workOrderId: string;
  fortnoxInvoiceNumber: string | null;
  status: string;
  costCenter: string | null;
  project: string | null;
  payerId: string | null;
  totalAmount: number | null;
  errorMessage: string | null;
  exportedAt: string | null;
  createdAt: string;
}

interface FortnoxCustomer {
  customerNumber: string;
  name: string;
  organisationNumber: string;
  address1: string;
  address2: string;
  zipCode: string;
  city: string;
  phone: string;
  email: string;
  contactPerson: string;
  active: boolean;
  alreadyImported: boolean;
  existingMatch: { id: string; name: string } | null;
}

const ENTITY_TYPES = [
  { value: "customer", label: "Kunder", icon: Users },
  { value: "article", label: "Artiklar", icon: Package },
  { value: "costcenter", label: "Kostnadsställen", icon: Building },
  { value: "project", label: "Projekt", icon: FolderKanban },
];

export default function FortnoxSettingsPage() {
  const { toast } = useToast();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [selectedEntityType, setSelectedEntityType] = useState("customer");
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [fortnoxIdInput, setFortnoxIdInput] = useState("");
  const [fortnoxCustomers, setFortnoxCustomers] = useState<FortnoxCustomer[]>([]);
  const [selectedForImport, setSelectedForImport] = useState<Set<string>>(new Set());
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState<"all" | "new" | "imported">("all");
  const [importComplete, setImportComplete] = useState<{ created: number; skipped: number; errors: number } | null>(null);

  const { data: config, isLoading: configLoading } = useQuery<FortnoxConfig>({
    queryKey: ["/api/fortnox/config"],
  });

  const { data: mappings = [], isLoading: mappingsLoading } = useQuery<FortnoxMapping[]>({
    queryKey: ["/api/fortnox/mappings"],
  });

  const { data: exports = [], isLoading: exportsLoading } = useQuery<FortnoxInvoiceExport[]>({
    queryKey: ["/api/fortnox/exports"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const saveConfigMutation = useMutation({
    mutationFn: (data: { clientId: string; clientSecret: string }) =>
      apiRequest("POST", "/api/fortnox/config", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fortnox/config"] });
      setConnectDialogOpen(false);
      toast({ title: "Fortnox-konfiguration sparad" });
    },
    onError: () => toast({ title: "Kunde inte spara konfiguration", variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      apiRequest("PATCH", "/api/fortnox/config", { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fortnox/config"] });
      toast({ title: "Integrationsstatus uppdaterad" });
    },
    onError: () => toast({ title: "Kunde inte uppdatera status", variant: "destructive" }),
  });

  const createMappingMutation = useMutation({
    mutationFn: (data: { entityType: string; unicornId: string; fortnoxId: string }) =>
      apiRequest("POST", "/api/fortnox/mappings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fortnox/mappings"] });
      setMappingDialogOpen(false);
      setSelectedEntityId("");
      setFortnoxIdInput("");
      toast({ title: "Koppling skapad" });
    },
    onError: () => toast({ title: "Kunde inte skapa koppling", variant: "destructive" }),
  });

  const deleteMappingMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/fortnox/mappings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fortnox/mappings"] });
      toast({ title: "Koppling borttagen" });
    },
    onError: () => toast({ title: "Kunde inte ta bort koppling", variant: "destructive" }),
  });

  const fetchFortnoxCustomersMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/fortnox/customers/fetch");
      return res.json();
    },
    onSuccess: (data: { total: number; customers: FortnoxCustomer[] }) => {
      setFortnoxCustomers(data.customers);
      const newCustomers = data.customers.filter(c => !c.alreadyImported);
      setSelectedForImport(new Set(newCustomers.map(c => c.customerNumber)));
      setImportComplete(null);
      toast({ title: `${data.total} kunder hämtade från Fortnox` });
    },
    onError: () => toast({ title: "Kunde inte hämta kunder från Fortnox", variant: "destructive" }),
  });

  const importCustomersMutation = useMutation({
    mutationFn: async (customerList: FortnoxCustomer[]) => {
      const res = await apiRequest("POST", "/api/fortnox/customers/import", { customers: customerList });
      return res.json();
    },
    onSuccess: (data: { summary: { created: number; skipped: number; errors: number } }) => {
      setImportComplete(data.summary);
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fortnox/mappings"] });
      toast({ title: `${data.summary.created} kunder importerade` });
    },
    onError: () => toast({ title: "Import misslyckades", variant: "destructive" }),
  });

  const isConnected = config?.isActive && config?.accessToken;

  const getEntityOptions = () => {
    switch (selectedEntityType) {
      case "customer":
        return customers.map(c => ({ id: c.id, name: c.name }));
      case "article":
        return articles.map(a => ({ id: a.id, name: `${a.articleNumber} - ${a.name}` }));
      case "costcenter":
        return resources.map(r => ({ id: r.id, name: r.name }));
      case "project":
        return teams.map(t => ({ id: t.id, name: t.name }));
      default:
        return [];
    }
  };

  const getEntityName = (entityType: string, entityId: string) => {
    switch (entityType) {
      case "customer":
        return customers.find(c => c.id === entityId)?.name || entityId;
      case "article":
        const article = articles.find(a => a.id === entityId);
        return article ? `${article.articleNumber} - ${article.name}` : entityId;
      case "costcenter":
        return resources.find(r => r.id === entityId)?.name || entityId;
      case "project":
        return teams.find(t => t.id === entityId)?.name || entityId;
      default:
        return entityId;
    }
  };

  const filteredMappings = mappings.filter(m => m.entityType === selectedEntityType);

  const filteredFortnoxCustomers = fortnoxCustomers.filter(c => {
    if (customerFilter === "new" && c.alreadyImported) return false;
    if (customerFilter === "imported" && !c.alreadyImported) return false;
    if (customerSearch) {
      const q = customerSearch.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.customerNumber.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const selectableCustomers = filteredFortnoxCustomers.filter(c => !c.alreadyImported);
  const allSelectableSelected = selectableCustomers.length > 0 && selectableCustomers.every(c => selectedForImport.has(c.customerNumber));

  const toggleCustomer = (customerNumber: string) => {
    setSelectedForImport(prev => {
      const next = new Set(prev);
      if (next.has(customerNumber)) {
        next.delete(customerNumber);
      } else {
        next.add(customerNumber);
      }
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedForImport(prev => {
      const next = new Set(prev);
      if (allSelectableSelected) {
        selectableCustomers.forEach(c => next.delete(c.customerNumber));
      } else {
        selectableCustomers.forEach(c => next.add(c.customerNumber));
      }
      return next;
    });
  };

  const removeSelected = () => {
    setFortnoxCustomers(prev => prev.filter(c => !selectedForImport.has(c.customerNumber)));
    setSelectedForImport(new Set());
  };

  const handleImport = () => {
    const toImport = fortnoxCustomers.filter(c => selectedForImport.has(c.customerNumber) && !c.alreadyImported);
    if (toImport.length === 0) return;
    importCustomersMutation.mutate(toImport);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Fortnox-integration</h1>
        <p className="text-muted-foreground">
          Anslut till Fortnox för att synkronisera fakturor och kunddata
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                  <Link2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Anslutningsstatus</CardTitle>
                  <CardDescription>OAuth 2.0-anslutning till Fortnox API</CardDescription>
                </div>
              </div>
              <Badge variant={isConnected ? "default" : "secondary"} className="gap-1">
                {isConnected ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    Ansluten
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3" />
                    Ej ansluten
                  </>
                )}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {configLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : config?.clientId ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Client ID:</span>
                    <p className="font-mono">{config.clientId.slice(0, 8)}...</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Senast synkad:</span>
                    <p>{config.lastSyncAt ? new Date(config.lastSyncAt).toLocaleString("sv-SE") : "Aldrig"}</p>
                  </div>
                </div>
                {config.tokenExpiresAt && (
                  <Alert variant={new Date(config.tokenExpiresAt) < new Date() ? "destructive" : "default"}>
                    <Clock className="h-4 w-4" />
                    <AlertTitle>Token-status</AlertTitle>
                    <AlertDescription>
                      {new Date(config.tokenExpiresAt) < new Date()
                        ? "Access token har gått ut. Återanslut för att förnya."
                        : `Giltig till ${new Date(config.tokenExpiresAt).toLocaleString("sv-SE")}`}
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={config.isActive || false}
                      onCheckedChange={(checked) => toggleActiveMutation.mutate(checked)}
                      disabled={toggleActiveMutation.isPending}
                      data-testid="switch-fortnox-active"
                    />
                    <Label>Integration aktiv</Label>
                  </div>
                  <Button variant="outline" onClick={() => setConnectDialogOpen(true)} data-testid="button-reconfigure">
                    <Settings className="h-4 w-4 mr-2" />
                    Konfigurera om
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">
                  Ingen Fortnox-anslutning konfigurerad
                </p>
                <Button onClick={() => setConnectDialogOpen(true)} data-testid="button-connect-fortnox">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Anslut till Fortnox
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Fortnox-integrationen synkroniserar kunder, artiklar och fakturor mellan Traivo och Fortnox.
            </p>
            <div className="space-y-2">
              <h4 className="font-medium text-foreground">Mappningar:</h4>
              <ul className="list-disc list-inside space-y-1">
                <li>Kostnadsställen = Fordon (registreringsnummer)</li>
                <li>Projekt = Team (teamnamn)</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium text-foreground">Begränsningar:</h4>
              <ul className="list-disc list-inside space-y-1">
                <li>Max 25 anrop/5 sekunder</li>
                <li>Access token: 1 timme</li>
                <li>Refresh token: 45 dagar</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="mappings" className="w-full">
        <TabsList>
          <TabsTrigger value="mappings" className="gap-1" data-testid="tab-mappings">
            <Link2 className="h-4 w-4" />
            Entitetskopplingar
          </TabsTrigger>
          <TabsTrigger value="exports" className="gap-1" data-testid="tab-exports">
            <FileText className="h-4 w-4" />
            Fakturaexporter
          </TabsTrigger>
          <TabsTrigger value="import-customers" className="gap-1" data-testid="tab-import-customers">
            <Download className="h-4 w-4" />
            Importera kunder
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mappings" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-lg">Entitetskopplingar</CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={selectedEntityType} onValueChange={setSelectedEntityType}>
                    <SelectTrigger className="w-[180px]" data-testid="select-entity-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENTITY_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>
                          <div className="flex items-center gap-2">
                            <t.icon className="h-4 w-4" />
                            {t.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={() => setMappingDialogOpen(true)} data-testid="button-add-mapping">
                    <Plus className="h-4 w-4 mr-2" />
                    Lägg till
                  </Button>
                </div>
              </div>
              <CardDescription>
                Koppla Traivo-entiteter till motsvarande Fortnox-ID:n
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mappingsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredMappings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Link2 className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p>Inga kopplingar för {ENTITY_TYPES.find(t => t.value === selectedEntityType)?.label.toLowerCase()}</p>
                </div>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {filteredMappings.map(mapping => (
                      <div
                        key={mapping.id}
                        className="flex items-center justify-between p-3 rounded-md border"
                        data-testid={`mapping-${mapping.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {getEntityName(mapping.entityType, mapping.unicornId)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Fortnox ID: <span className="font-mono">{mapping.fortnoxId}</span>
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMappingMutation.mutate(mapping.id)}
                          disabled={deleteMappingMutation.isPending}
                          data-testid={`button-delete-mapping-${mapping.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exports" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Fakturaexporter</CardTitle>
              <CardDescription>
                Historik över fakturor exporterade till Fortnox
              </CardDescription>
            </CardHeader>
            <CardContent>
              {exportsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : exports.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p>Inga fakturaexporter ännu</p>
                </div>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {exports.slice(0, 20).map(exp => (
                      <div
                        key={exp.id}
                        className="flex items-center justify-between p-3 rounded-md border"
                        data-testid={`export-${exp.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">Order: {exp.workOrderId.slice(0, 8)}...</span>
                            <Badge
                              variant={
                                exp.status === "exported" ? "default" :
                                exp.status === "failed" ? "destructive" :
                                "secondary"
                              }
                            >
                              {exp.status === "exported" ? "Exporterad" :
                               exp.status === "failed" ? "Misslyckades" :
                               exp.status === "pending" ? "Väntar" : exp.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {exp.fortnoxInvoiceNumber && `Faktura: ${exp.fortnoxInvoiceNumber} | `}
                            {exp.totalAmount && `${exp.totalAmount.toLocaleString()} kr | `}
                            {new Date(exp.createdAt).toLocaleDateString("sv-SE")}
                          </p>
                          {exp.errorMessage && (
                            <p className="text-sm text-destructive mt-1">{exp.errorMessage}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import-customers" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="text-lg">Importera kunder från Fortnox</CardTitle>
                  <CardDescription>
                    Hämta kundregistret från Fortnox, granska och välj vilka kunder som ska importeras till Traivo
                  </CardDescription>
                </div>
                <Button
                  onClick={() => fetchFortnoxCustomersMutation.mutate()}
                  disabled={!isConnected || fetchFortnoxCustomersMutation.isPending}
                  data-testid="button-fetch-fortnox-customers"
                >
                  {fetchFortnoxCustomersMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Hämta kunder från Fortnox
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!isConnected && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Fortnox ej anslutet</AlertTitle>
                  <AlertDescription>
                    Anslut till Fortnox först under "Anslutningsstatus" ovan för att kunna importera kunder.
                  </AlertDescription>
                </Alert>
              )}

              {importComplete && (
                <Alert className="mb-4">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>Import klar</AlertTitle>
                  <AlertDescription>
                    {importComplete.created} kunder importerade
                    {importComplete.skipped > 0 && `, ${importComplete.skipped} hoppades över (redan importerade)`}
                    {importComplete.errors > 0 && `, ${importComplete.errors} fel`}
                  </AlertDescription>
                </Alert>
              )}

              {fortnoxCustomers.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Sök namn, kundnummer, stad, e-post..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        className="pl-9"
                        data-testid="input-customer-search"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant={customerFilter === "all" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCustomerFilter("all")}
                        data-testid="filter-all"
                      >
                        Alla ({fortnoxCustomers.length})
                      </Button>
                      <Button
                        variant={customerFilter === "new" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCustomerFilter("new")}
                        data-testid="filter-new"
                      >
                        Nya ({fortnoxCustomers.filter(c => !c.alreadyImported).length})
                      </Button>
                      <Button
                        variant={customerFilter === "imported" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCustomerFilter("imported")}
                        data-testid="filter-imported"
                      >
                        Redan importerade ({fortnoxCustomers.filter(c => c.alreadyImported).length})
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{selectedForImport.size} markerade för import</span>
                      <span>·</span>
                      <span>{filteredFortnoxCustomers.length} visas</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedForImport.size > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={removeSelected}
                          className="text-destructive border-destructive/30 hover:bg-destructive/10"
                          data-testid="button-remove-selected"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Ta bort markerade ({selectedForImport.size})
                        </Button>
                      )}
                      <Button
                        onClick={handleImport}
                        disabled={selectedForImport.size === 0 || importCustomersMutation.isPending}
                        data-testid="button-import-customers"
                      >
                        {importCustomersMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCheck className="h-4 w-4 mr-2" />
                        )}
                        Importera markerade ({selectedForImport.size})
                      </Button>
                    </div>
                  </div>

                  <ScrollArea className="h-[500px] border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[40px]">
                            <Checkbox
                              checked={allSelectableSelected}
                              onCheckedChange={toggleAllVisible}
                              data-testid="checkbox-select-all"
                            />
                          </TableHead>
                          <TableHead>Kundnr</TableHead>
                          <TableHead>Namn</TableHead>
                          <TableHead className="hidden md:table-cell">Org.nr</TableHead>
                          <TableHead className="hidden md:table-cell">Ort</TableHead>
                          <TableHead className="hidden lg:table-cell">E-post</TableHead>
                          <TableHead className="hidden lg:table-cell">Telefon</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredFortnoxCustomers.map((c) => (
                          <TableRow
                            key={c.customerNumber}
                            className={c.alreadyImported ? "opacity-50" : selectedForImport.has(c.customerNumber) ? "bg-primary/5" : ""}
                            data-testid={`row-customer-${c.customerNumber}`}
                          >
                            <TableCell>
                              <Checkbox
                                checked={selectedForImport.has(c.customerNumber)}
                                onCheckedChange={() => toggleCustomer(c.customerNumber)}
                                disabled={c.alreadyImported}
                                data-testid={`checkbox-customer-${c.customerNumber}`}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-sm">{c.customerNumber}</TableCell>
                            <TableCell>
                              <div>
                                <span className="font-medium">{c.name}</span>
                                {c.contactPerson && (
                                  <p className="text-xs text-muted-foreground">{c.contactPerson}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-sm">{c.organisationNumber || "–"}</TableCell>
                            <TableCell className="hidden md:table-cell text-sm">
                              {c.city || "–"}
                              {c.zipCode && <span className="text-muted-foreground ml-1">({c.zipCode})</span>}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell text-sm">{c.email || "–"}</TableCell>
                            <TableCell className="hidden lg:table-cell text-sm">{c.phone || "–"}</TableCell>
                            <TableCell>
                              {c.alreadyImported ? (
                                <Badge variant="secondary" className="gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Importerad
                                </Badge>
                              ) : c.existingMatch ? (
                                <Badge variant="outline" className="gap-1 text-yellow-600 border-yellow-300">
                                  <AlertTriangle className="h-3 w-3" />
                                  Namnmatchning
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="gap-1 text-green-600 border-green-300">
                                  <Plus className="h-3 w-3" />
                                  Ny
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              )}

              {fortnoxCustomers.length === 0 && isConnected && !fetchFortnoxCustomersMutation.isPending && (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
                  <p className="font-medium">Inga kunder hämtade ännu</p>
                  <p className="text-sm mt-1">Klicka "Hämta kunder från Fortnox" för att ladda kundregistret</p>
                </div>
              )}

              {fetchFortnoxCustomersMutation.isPending && (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                  <p className="text-muted-foreground">Hämtar kunder från Fortnox...</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anslut till Fortnox</DialogTitle>
            <DialogDescription>
              Ange dina Fortnox API-uppgifter för att aktivera integrationen.
              Hämta dessa från Fortnox Developer Portal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clientId">Client ID</Label>
              <Input
                id="clientId"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Din Fortnox Client ID"
                data-testid="input-client-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientSecret">Client Secret</Label>
              <Input
                id="clientSecret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Din Fortnox Client Secret"
                data-testid="input-client-secret"
              />
            </div>
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>OAuth 2.0-flöde</AlertTitle>
              <AlertDescription>
                Efter att du sparat uppgifterna kommer du att omdirigeras till Fortnox för att godkänna åtkomst.
                Detta är för närvarande en förberedelse - full OAuth-implementation kommer när API-nycklar är tillgängliga.
              </AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectDialogOpen(false)}>
              Avbryt
            </Button>
            <Button
              onClick={() => saveConfigMutation.mutate({ clientId, clientSecret })}
              disabled={!clientId || !clientSecret || saveConfigMutation.isPending}
              data-testid="button-save-config"
            >
              {saveConfigMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Spara och anslut
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mappingDialogOpen} onOpenChange={setMappingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lägg till koppling</DialogTitle>
            <DialogDescription>
              Koppla en Traivo-entitet till ett Fortnox-ID
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Entitetstyp</Label>
              <Select value={selectedEntityType} onValueChange={setSelectedEntityType}>
                <SelectTrigger data-testid="dialog-select-entity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      <div className="flex items-center gap-2">
                        <t.icon className="h-4 w-4" />
                        {t.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Traivo-entitet</Label>
              <Select value={selectedEntityId} onValueChange={setSelectedEntityId}>
                <SelectTrigger data-testid="dialog-select-entity">
                  <SelectValue placeholder="Välj entitet" />
                </SelectTrigger>
                <SelectContent>
                  {getEntityOptions().slice(0, 50).map(opt => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fortnoxId">Fortnox-ID</Label>
              <Input
                id="fortnoxId"
                value={fortnoxIdInput}
                onChange={(e) => setFortnoxIdInput(e.target.value)}
                placeholder="ID från Fortnox"
                data-testid="input-fortnox-id"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMappingDialogOpen(false)}>
              Avbryt
            </Button>
            <Button
              onClick={() => createMappingMutation.mutate({
                entityType: selectedEntityType,
                unicornId: selectedEntityId,
                fortnoxId: fortnoxIdInput,
              })}
              disabled={!selectedEntityId || !fortnoxIdInput || createMappingMutation.isPending}
              data-testid="button-create-mapping"
            >
              {createMappingMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Skapa koppling
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
