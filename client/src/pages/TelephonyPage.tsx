import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Phone,
  Search,
  User,
  Building2,
  MapPin,
  Clock,
  FileText,
  Loader2,
  ExternalLink,
  Plus,
  Pencil,
  Trash2,
  Eye,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Users,
  Activity,
  MessageSquare,
} from "lucide-react";
import { Link } from "wouter";

interface CustomerResult {
  customer: {
    id: string;
    name: string;
    customerNumber: string | null;
    contactPerson: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
  };
  objects: Array<{
    id: string;
    name: string;
    objectNumber: string | null;
    address: string | null;
    city: string | null;
    objectType: string | null;
    status: string;
    clusterId: string | null;
  }>;
  recentOrders: Array<{
    id: string;
    title: string;
    orderType: string | null;
    status: string;
    orderStatus: string | null;
    scheduledDate: string | null;
    resourceId: string | null;
  }>;
  clusters: Array<{ id: string; name: string; description: string | null }>;
  areas: string[];
}

interface LookupResult {
  found: boolean;
  matchType: "direct" | "metadata" | "none";
  customers: CustomerResult[];
}

interface ResourceAvailability {
  resourceId: string;
  resourceName: string;
  isBusy: boolean;
  currentTask: string | null;
  nextAvailable: string;
  todayOrderCount: number;
  completedOrders: number;
}

interface StatusMessageTemplate {
  id: string;
  tenantId: string;
  name: string;
  triggerType: string;
  templateText: string;
  isActive: boolean;
  priority: number | null;
  createdAt: string;
}

function PhoneLookupSection() {
  const { toast } = useToast();
  const [phoneInput, setPhoneInput] = useState("");
  const [searchPhone, setSearchPhone] = useState<string | null>(null);

  const { data: lookupResult, isLoading: isSearching, isError } = useQuery<LookupResult>({
    queryKey: ["/api/telephony/lookup", { phone: searchPhone }],
    queryFn: async () => {
      const res = await fetch(`/api/telephony/lookup?phone=${encodeURIComponent(searchPhone!)}`);
      if (!res.ok) {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          throw new Error(json.error || "Sökning misslyckades");
        } catch {
          throw new Error("Sökning misslyckades");
        }
      }
      return res.json();
    },
    enabled: !!searchPhone && searchPhone.length >= 5,
  });

  const handleSearch = () => {
    const cleaned = phoneInput.replace(/[\s\-\(\)]/g, "");
    if (cleaned.length < 5) {
      toast({ title: "Ange minst 5 siffror", variant: "destructive" });
      return;
    }
    setSearchPhone(cleaned);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök på telefonnummer..."
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-10"
            data-testid="input-phone-search"
          />
        </div>
        <Button onClick={handleSearch} disabled={isSearching} data-testid="button-phone-search">
          {isSearching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
          Sök
        </Button>
      </div>

      {isSearching && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">Söker...</span>
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="py-8 text-center">
            <XCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
            <p className="text-destructive" data-testid="text-search-error">Sökningen misslyckades. Kontrollera numret och försök igen.</p>
          </CardContent>
        </Card>
      )}

      {lookupResult && !lookupResult.found && (
        <Card>
          <CardContent className="py-8 text-center">
            <XCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground" data-testid="text-no-results">Ingen kund hittades för {searchPhone}</p>
          </CardContent>
        </Card>
      )}

      {lookupResult?.found && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant={lookupResult.matchType === "direct" ? "default" : "secondary"} data-testid="badge-match-type">
              {lookupResult.matchType === "direct" ? "Direkt matchning" : "Matchning via metadata"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {lookupResult.customers.length} kund{lookupResult.customers.length !== 1 ? "er" : ""} hittade
            </span>
          </div>

          {lookupResult.customers.map((result, idx) => (
            <CustomerCard key={result.customer.id} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}

function CustomerCard({ result }: { result: CustomerResult }) {
  const { customer, objects, recentOrders, clusters, areas } = result;

  return (
    <Card data-testid={`card-customer-${customer.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-5 w-5" />
              <span data-testid={`text-customer-name-${customer.id}`}>{customer.name}</span>
            </CardTitle>
            {customer.customerNumber && (
              <p className="text-sm text-muted-foreground mt-1">Kundnr: {customer.customerNumber}</p>
            )}
          </div>
          <Link href={`/objects?customerId=${customer.id}`}>
            <Button variant="outline" size="sm" data-testid={`link-customer-${customer.id}`}>
              <ExternalLink className="h-3 w-3 mr-1" />
              Visa kund
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            {customer.contactPerson && (
              <div className="flex items-center gap-2 text-sm">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span data-testid={`text-contact-${customer.id}`}>{customer.contactPerson}</span>
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{customer.phone}</span>
              </div>
            )}
            {customer.email && (
              <div className="flex items-center gap-2 text-sm">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{customer.email}</span>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {(customer.address || customer.city) && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{[customer.address, customer.city].filter(Boolean).join(", ")}</span>
              </div>
            )}
            {clusters.length > 0 && (
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                {clusters.map((c) => (
                  <Link key={c.id} href={`/clusters/${c.id}`}>
                    <Badge variant="outline" className="cursor-pointer hover:bg-accent" data-testid={`badge-cluster-${c.id}`}>
                      {c.name}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
            {areas.length > 0 && (
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                {areas.map((area) => (
                  <Badge key={area} variant="secondary">{area}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {objects.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <Building2 className="h-4 w-4" />
                Objekt ({objects.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {objects.map((obj) => (
                  <Link key={obj.id} href={`/objects/${obj.id}`}>
                    <div className="rounded-md border p-2 hover:bg-accent cursor-pointer transition-colors" data-testid={`link-object-${obj.id}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{obj.name}</span>
                        <Badge variant={obj.status === "active" ? "default" : "secondary"} className="text-xs">
                          {obj.status === "active" ? "Aktiv" : obj.status}
                        </Badge>
                      </div>
                      {obj.address && <p className="text-xs text-muted-foreground mt-0.5">{obj.address}{obj.city ? `, ${obj.city}` : ""}</p>}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}

        {recentOrders.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <FileText className="h-4 w-4" />
                Senaste ordrar ({recentOrders.length})
              </h4>
              <div className="space-y-1.5">
                {recentOrders.map((order) => (
                  <div key={order.id} className="flex items-center justify-between rounded-md border p-2 text-sm" data-testid={`row-order-${order.id}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{order.title}</span>
                      {order.orderType && <Badge variant="outline" className="text-xs">{order.orderType}</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      {order.scheduledDate && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(order.scheduledDate).toLocaleDateString("sv-SE")}
                        </span>
                      )}
                      <Badge
                        variant={order.orderStatus === "utford" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {order.orderStatus === "utford" ? "Utförd" : order.orderStatus === "planerad" ? "Planerad" : order.orderStatus || order.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AvailabilitySection() {
  const { data: availability = [], isLoading, refetch } = useQuery<ResourceAvailability[]>({
    queryKey: ["/api/resources/availability"],
    refetchInterval: 30000,
  });

  const busyCount = availability.filter((r) => r.isBusy).length;
  const freeCount = availability.filter((r) => !r.isBusy).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
            <span className="text-sm" data-testid="text-free-count">Lediga: {freeCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
            <span className="text-sm" data-testid="text-busy-count">Upptagna: {busyCount}</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-availability">
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Uppdatera
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : availability.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Inga aktiva resurser hittades
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {availability.map((r) => (
            <ResourceAvailabilityCard key={r.resourceId} resource={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResourceAvailabilityCard({ resource }: { resource: ResourceAvailability }) {
  const [showMessage, setShowMessage] = useState(false);

  const { data: statusMsg, isLoading: msgLoading } = useQuery<{ message: string | null }>({
    queryKey: ["/api/resources", resource.resourceId, "status-message"],
    queryFn: async () => {
      const res = await fetch(`/api/resources/${resource.resourceId}/status-message`);
      if (!res.ok) throw new Error("Kunde inte hämta statusmeddelande");
      return res.json();
    },
    enabled: showMessage,
  });

  return (
    <Card data-testid={`card-resource-${resource.resourceId}`}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`h-3 w-3 rounded-full ${resource.isBusy ? "bg-red-500" : "bg-green-500"}`} />
            <span className="font-medium text-sm" data-testid={`text-resource-name-${resource.resourceId}`}>
              {resource.resourceName}
            </span>
          </div>
          <Badge variant={resource.isBusy ? "destructive" : "default"} className="text-xs" data-testid={`badge-status-${resource.resourceId}`}>
            {resource.isBusy ? "Upptagen" : "Ledig"}
          </Badge>
        </div>

        {resource.isBusy && resource.currentTask && (
          <p className="text-xs text-muted-foreground mb-1.5 truncate" data-testid={`text-task-${resource.resourceId}`}>
            Pågående: {resource.currentTask}
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {resource.isBusy ? `Ledig kl ${resource.nextAvailable}` : "Tillgänglig nu"}
          </span>
          <span>{resource.completedOrders}/{resource.todayOrderCount} klara</span>
        </div>

        <div className="mt-2 pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs h-7"
            onClick={() => setShowMessage(!showMessage)}
            data-testid={`button-status-msg-${resource.resourceId}`}
          >
            <MessageSquare className="h-3 w-3 mr-1" />
            {showMessage ? "Dölj meddelande" : "Visa statusmeddelande"}
          </Button>
          {showMessage && (
            <div className="mt-2 p-2 rounded bg-muted text-xs" data-testid={`text-status-msg-${resource.resourceId}`}>
              {msgLoading ? (
                <Loader2 className="h-3 w-3 animate-spin mx-auto" />
              ) : statusMsg?.message ? (
                statusMsg.message
              ) : (
                <span className="text-muted-foreground italic">Inget meddelande konfigurerat</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TemplateEditorSection() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<StatusMessageTemplate | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<StatusMessageTemplate | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    templateText: "",
    triggerType: "incoming_call",
    isActive: true,
    priority: 0,
  });

  const { data: templates = [], isLoading } = useQuery<StatusMessageTemplate[]>({
    queryKey: ["/api/status-message-templates"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return apiRequest("POST", "/api/status-message-templates", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/status-message-templates"] });
      toast({ title: "Mall skapad" });
      closeDialog();
    },
    onError: (e: Error) => {
      toast({ title: "Kunde inte skapa mall", description: e.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      return apiRequest("PATCH", `/api/status-message-templates/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/status-message-templates"] });
      toast({ title: "Mall uppdaterad" });
      closeDialog();
    },
    onError: (e: Error) => {
      toast({ title: "Kunde inte uppdatera mall", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/status-message-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/status-message-templates"] });
      toast({ title: "Mall borttagen" });
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
    },
    onError: (e: Error) => {
      toast({ title: "Kunde inte ta bort mall", description: e.message, variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingTemplate(null);
    setFormData({ name: "", templateText: "", triggerType: "incoming_call", isActive: true, priority: 0 });
  };

  const openCreate = () => {
    setEditingTemplate(null);
    setFormData({ name: "", templateText: "", triggerType: "incoming_call", isActive: true, priority: 0 });
    setDialogOpen(true);
  };

  const openEdit = (t: StatusMessageTemplate) => {
    setEditingTemplate(t);
    setFormData({
      name: t.name,
      templateText: t.templateText,
      triggerType: t.triggerType,
      isActive: t.isActive,
      priority: t.priority ?? 0,
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.name.trim() || !formData.templateText.trim()) {
      toast({ title: "Namn och malltext krävs", variant: "destructive" });
      return;
    }
    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const sampleVariables: Record<string, string> = {
    "resource.name": "Anna Andersson",
    "resource.nextAvailable": "14:30",
    "resource.isBusy": "upptagen",
    "resource.currentTask": "Kärltömning Storgatan 5",
    "resource.todayOrderCount": "8",
    "resource.completedOrders": "5",
  };

  const previewText = useMemo(() => {
    let text = formData.templateText;
    for (const [key, value] of Object.entries(sampleVariables)) {
      text = text.replace(new RegExp(`\\{${key.replace(".", "\\.")}\\}`, "g"), value);
    }
    return text;
  }, [formData.templateText]);

  const triggerLabels: Record<string, string> = {
    incoming_call: "Inkommande samtal",
    portal_chat: "Portalchatt",
    manual: "Manuell",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Mallar för automatiska statusmeddelanden med variabelsubstitution.
        </p>
        <Button onClick={openCreate} data-testid="button-create-template">
          <Plus className="h-4 w-4 mr-2" />
          Ny mall
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Inga mallar skapade ännu. Klicka "Ny mall" för att skapa en.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <Card key={t.id} data-testid={`card-template-${t.id}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm" data-testid={`text-template-name-${t.id}`}>{t.name}</span>
                      <Badge variant={t.isActive ? "default" : "secondary"} className="text-xs">
                        {t.isActive ? "Aktiv" : "Inaktiv"}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {triggerLabels[t.triggerType] || t.triggerType}
                      </Badge>
                      {t.priority !== null && t.priority > 0 && (
                        <Badge variant="outline" className="text-xs">Prio: {t.priority}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{t.templateText}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)} data-testid={`button-edit-template-${t.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => { setTemplateToDelete(t); setDeleteDialogOpen(true); }}
                      data-testid={`button-delete-template-${t.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Redigera mall" : "Ny statusmeddelandemall"}</DialogTitle>
            <DialogDescription>
              Använd variabler som {"{resource.name}"}, {"{resource.nextAvailable}"} etc.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="template-name">Namn</Label>
              <Input
                id="template-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="T.ex. Standard upptagen-svar"
                data-testid="input-template-name"
              />
            </div>
            <div>
              <Label htmlFor="template-trigger">Triggertyp</Label>
              <Select value={formData.triggerType} onValueChange={(v) => setFormData({ ...formData, triggerType: v })}>
                <SelectTrigger data-testid="select-trigger-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incoming_call">Inkommande samtal</SelectItem>
                  <SelectItem value="portal_chat">Portalchatt</SelectItem>
                  <SelectItem value="manual">Manuell</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="template-text">Malltext</Label>
              <Textarea
                id="template-text"
                value={formData.templateText}
                onChange={(e) => setFormData({ ...formData, templateText: e.target.value })}
                placeholder="{resource.name} är {resource.isBusy} just nu och beräknas vara ledig kl {resource.nextAvailable}."
                rows={3}
                className="font-mono text-sm"
                data-testid="input-template-text"
              />
              <div className="flex flex-wrap gap-1 mt-1.5">
                {Object.keys(sampleVariables).map((v) => (
                  <Badge
                    key={v}
                    variant="outline"
                    className="text-xs cursor-pointer hover:bg-accent"
                    onClick={() => setFormData({ ...formData, templateText: formData.templateText + `{${v}}` })}
                  >
                    {`{${v}}`}
                  </Badge>
                ))}
              </div>
            </div>
            {formData.templateText && (
              <div>
                <Label>Förhandsvisning</Label>
                <div className="rounded-md bg-muted p-3 text-sm" data-testid="text-template-preview">
                  <Eye className="h-3.5 w-3.5 inline mr-1.5 text-muted-foreground" />
                  {previewText}
                </div>
              </div>
            )}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="template-priority">Prioritet</Label>
                <Input
                  id="template-priority"
                  type="number"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                  className="w-20"
                  data-testid="input-template-priority"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="template-active"
                  checked={formData.isActive}
                  onCheckedChange={(v) => setFormData({ ...formData, isActive: v })}
                  data-testid="switch-template-active"
                />
                <Label htmlFor="template-active">Aktiv</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Avbryt</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-template"
            >
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingTemplate ? "Uppdatera" : "Skapa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort mall</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort mallen "{templateToDelete?.name}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => templateToDelete && deleteMutation.mutate(templateToDelete.id)}
              data-testid="button-confirm-delete-template"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function TelephonyPage() {
  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Phone className="h-6 w-6" />
          Växel & Tillgänglighet
        </h1>
        <p className="text-muted-foreground mt-1">
          Sök kunder via telefonnummer, se resurstillgänglighet och hantera statusmeddelanden.
        </p>
      </div>

      <Tabs defaultValue="lookup" className="w-full">
        <TabsList className="grid w-full grid-cols-3" data-testid="tabs-telephony">
          <TabsTrigger value="lookup" data-testid="tab-lookup">
            <Search className="h-4 w-4 mr-1.5" />
            Telefonsökning
          </TabsTrigger>
          <TabsTrigger value="availability" data-testid="tab-availability">
            <Activity className="h-4 w-4 mr-1.5" />
            Tillgänglighet
          </TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates">
            <MessageSquare className="h-4 w-4 mr-1.5" />
            Meddelandemallar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lookup" className="mt-4">
          <PhoneLookupSection />
        </TabsContent>

        <TabsContent value="availability" className="mt-4">
          <AvailabilitySection />
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <TemplateEditorSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
