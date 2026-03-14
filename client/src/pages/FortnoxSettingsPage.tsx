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
  nordfieldId: string;
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
  const [selectedNordnavOneId, setSelectedNordnavOneId] = useState("");
  const [fortnoxIdInput, setFortnoxIdInput] = useState("");

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
    mutationFn: (data: { entityType: string; nordfieldId: string; fortnoxId: string }) =>
      apiRequest("POST", "/api/fortnox/mappings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fortnox/mappings"] });
      setMappingDialogOpen(false);
      setSelectedNordnavOneId("");
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

  const getEntityName = (entityType: string, nordfieldId: string) => {
    switch (entityType) {
      case "customer":
        return customers.find(c => c.id === nordfieldId)?.name || nordfieldId;
      case "article":
        const article = articles.find(a => a.id === nordfieldId);
        return article ? `${article.articleNumber} - ${article.name}` : nordfieldId;
      case "costcenter":
        return resources.find(r => r.id === nordfieldId)?.name || nordfieldId;
      case "project":
        return teams.find(t => t.id === nordfieldId)?.name || nordfieldId;
      default:
        return nordfieldId;
    }
  };

  const filteredMappings = mappings.filter(m => m.entityType === selectedEntityType);

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
                            {getEntityName(mapping.entityType, mapping.nordfieldId)}
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
              <Select value={selectedNordnavOneId} onValueChange={setSelectedNordnavOneId}>
                <SelectTrigger data-testid="dialog-select-nordfield-entity">
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
                nordfieldId: selectedNordnavOneId,
                fortnoxId: fortnoxIdInput,
              })}
              disabled={!selectedNordnavOneId || !fortnoxIdInput || createMappingMutation.isPending}
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
