import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import type { Article, Resource, PriceList, Tenant } from "@shared/schema";
import {
  Building2,
  Save,
  Loader2,
  Package,
  Users,
  Receipt,
  Settings2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Tag,
  Shield,
  Zap,
} from "lucide-react";

const EXECUTION_CODE_OPTIONS = [
  { value: "sophamtning", label: "Sophämtning" },
  { value: "karltomning", label: "Kärltömning" },
  { value: "matavfall", label: "Matavfall" },
  { value: "tvatt", label: "Tvätt" },
  { value: "kranbil", label: "Kranbil" },
  { value: "sug", label: "Sugbil" },
  { value: "container", label: "Container" },
  { value: "atervinning", label: "Återvinning" },
  { value: "farligt_avfall", label: "Farligt avfall" },
  { value: "kontroll", label: "Kontroll/inspektion" },
  { value: "stadning", label: "Städning" },
  { value: "snorojning", label: "Snöröjning" },
  { value: "transport", label: "Transport" },
  { value: "bygg", label: "Bygg/underhåll" },
];

function CompanyInfoTab() {
  const { toast } = useToast();
  const { data: tenant, isLoading } = useQuery<Tenant>({
    queryKey: ["/api/tenant"],
  });

  const [form, setForm] = useState({
    name: "",
    orgNumber: "",
    contactEmail: "",
    contactPhone: "",
    industry: "waste_management",
  });

  useEffect(() => {
    if (tenant) {
      setForm({
        name: tenant.name || "",
        orgNumber: tenant.orgNumber || "",
        contactEmail: tenant.contactEmail || "",
        contactPhone: tenant.contactPhone || "",
        industry: tenant.industry || "waste_management",
      });
    }
  }, [tenant]);

  const updateMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      return apiRequest("PATCH", "/api/tenant", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant"] });
      toast({ title: "Sparat", description: "Företagsinformation uppdaterad." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte spara.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Företagsinformation
          </CardTitle>
          <CardDescription>Grundläggande uppgifter om er tenant/företag</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Företagsnamn</Label>
              <Input
                id="name"
                data-testid="input-company-name"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orgNumber">Organisationsnummer</Label>
              <Input
                id="orgNumber"
                data-testid="input-org-number"
                value={form.orgNumber}
                onChange={(e) => setForm(prev => ({ ...prev, orgNumber: e.target.value }))}
                placeholder="556xxx-xxxx"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Kontakt-epost</Label>
              <Input
                id="contactEmail"
                data-testid="input-contact-email"
                type="email"
                value={form.contactEmail}
                onChange={(e) => setForm(prev => ({ ...prev, contactEmail: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactPhone">Kontakttelefon</Label>
              <Input
                id="contactPhone"
                data-testid="input-contact-phone"
                value={form.contactPhone}
                onChange={(e) => setForm(prev => ({ ...prev, contactPhone: e.target.value }))}
                placeholder="+46..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Bransch</Label>
              <Select value={form.industry} onValueChange={(v) => setForm(prev => ({ ...prev, industry: v }))}>
                <SelectTrigger data-testid="select-industry">
                  <SelectValue placeholder="Välj bransch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="waste_management">Avfallshantering</SelectItem>
                  <SelectItem value="property_maintenance">Fastighetsunderhåll</SelectItem>
                  <SelectItem value="cleaning">Städning</SelectItem>
                  <SelectItem value="snow_removal">Snöröjning</SelectItem>
                  <SelectItem value="combined">Kombinerad service</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <div className="flex justify-end">
            <Button
              data-testid="button-save-company"
              onClick={() => updateMutation.mutate(form)}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Spara företagsinformation
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenant-ID</CardTitle>
          <CardDescription>Teknisk identifierare för er tenant</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-sm px-3 py-1">{tenant?.id}</Badge>
            <span className="text-sm text-muted-foreground">Skapades: {tenant?.createdAt ? new Date(tenant.createdAt).toLocaleDateString("sv-SE") : "-"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ArticlesExecutionTab() {
  const { toast } = useToast();
  const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: ["/api/articles"],
  });

  const [editingCodes, setEditingCodes] = useState<Record<string, string>>({});

  const updateArticleMutation = useMutation({
    mutationFn: async ({ id, executionCode }: { id: string; executionCode: string }) => {
      return apiRequest("PATCH", `/api/articles/${id}`, { executionCode: executionCode || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      toast({ title: "Sparat", description: "Exekveringskod uppdaterad." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte spara.", variant: "destructive" });
    },
  });

  const activeArticles = articles.filter(a => a.status === "active");
  const withCode = activeArticles.filter(a => a.executionCode);
  const withoutCode = activeArticles.filter(a => !a.executionCode);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeArticles.length}</p>
                <p className="text-sm text-muted-foreground">Aktiva artiklar</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{withCode.length}</p>
                <p className="text-sm text-muted-foreground">Med exekveringskod</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{withoutCode.length}</p>
                <p className="text-sm text-muted-foreground">Saknar exekveringskod</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5" />
                Artiklar & exekveringskoder
              </CardTitle>
              <CardDescription>Tilldela exekveringskoder till artiklar för att styra vilka resurser som kan utföra dem</CardDescription>
            </div>
            <Link href="/articles">
              <Button variant="outline" size="sm" data-testid="link-articles-page">
                <ExternalLink className="h-4 w-4 mr-2" />
                Fullständig artikelvy
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artikelnr</TableHead>
                <TableHead>Namn</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Prod.tid</TableHead>
                <TableHead>Listpris</TableHead>
                <TableHead>Exekveringskod</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeArticles.map(article => {
                const currentCode = editingCodes[article.id] !== undefined
                  ? editingCodes[article.id]
                  : (article.executionCode || "");
                const hasChanged = editingCodes[article.id] !== undefined && editingCodes[article.id] !== (article.executionCode || "");

                return (
                  <TableRow key={article.id} data-testid={`row-article-${article.id}`}>
                    <TableCell className="font-mono text-sm">{article.articleNumber}</TableCell>
                    <TableCell className="font-medium">{article.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{article.articleType}</Badge>
                    </TableCell>
                    <TableCell>{article.productionTime} min</TableCell>
                    <TableCell>{article.listPrice} kr</TableCell>
                    <TableCell>
                      <Select
                        value={currentCode || "none"}
                        onValueChange={(v) => setEditingCodes(prev => ({ ...prev, [article.id]: v === "none" ? "" : v }))}
                      >
                        <SelectTrigger className="w-[180px]" data-testid={`select-exec-code-${article.id}`}>
                          <SelectValue placeholder="Välj kod" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Ingen kod</SelectItem>
                          {EXECUTION_CODE_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {hasChanged && (
                        <Button
                          size="sm"
                          data-testid={`button-save-exec-${article.id}`}
                          onClick={() => {
                            updateArticleMutation.mutate({
                              id: article.id,
                              executionCode: editingCodes[article.id],
                            });
                            setEditingCodes(prev => {
                              const next = { ...prev };
                              delete next[article.id];
                              return next;
                            });
                          }}
                          disabled={updateArticleMutation.isPending}
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PriceListsTab() {
  const { data: priceLists = [], isLoading } = useQuery<PriceList[]>({
    queryKey: ["/api/price-lists"],
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const activeLists = priceLists.filter(p => p.status === "active");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900">
                <Receipt className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeLists.length}</p>
                <p className="text-sm text-muted-foreground">Aktiva prislistor</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <Receipt className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeLists.filter(p => p.priceListType === "generell").length}</p>
                <p className="text-sm text-muted-foreground">Generella</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900">
                <Receipt className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeLists.filter(p => p.priceListType !== "generell").length}</p>
                <p className="text-sm text-muted-foreground">Kundspecifika</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Prislistor
              </CardTitle>
              <CardDescription>Översikt över konfigurerade prislistor</CardDescription>
            </div>
            <Link href="/price-lists">
              <Button variant="outline" size="sm" data-testid="link-price-lists-page">
                <ExternalLink className="h-4 w-4 mr-2" />
                Hantera prislistor
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Namn</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Prioritet</TableHead>
                <TableHead>Giltig från</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeLists.map(pl => (
                <TableRow key={pl.id} data-testid={`row-pricelist-${pl.id}`}>
                  <TableCell className="font-medium">{pl.name}</TableCell>
                  <TableCell>
                    <Badge variant={pl.priceListType === "generell" ? "default" : "secondary"}>
                      {pl.priceListType === "generell" ? "Generell" : pl.priceListType === "kundunik" ? "Kundpris" : "Rabattbrev"}
                    </Badge>
                  </TableCell>
                  <TableCell>{pl.priority}</TableCell>
                  <TableCell>{pl.validFrom ? new Date(pl.validFrom).toLocaleDateString("sv-SE") : "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-green-600">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Aktiv
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {activeLists.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Inga prislistor konfigurerade
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ResourcesExecutionTab() {
  const { toast } = useToast();
  const { data: resources = [], isLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const [editingCodes, setEditingCodes] = useState<Record<string, string[]>>({});

  const updateResourceMutation = useMutation({
    mutationFn: async ({ id, executionCodes }: { id: string; executionCodes: string[] }) => {
      return apiRequest("PATCH", `/api/resources/${id}`, { executionCodes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resources"] });
      toast({ title: "Sparat", description: "Behörigheter uppdaterade." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte spara.", variant: "destructive" });
    },
  });

  const activeResources = resources.filter(r => r.status === "active");
  const withCodes = activeResources.filter(r => r.executionCodes && r.executionCodes.length > 0);

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const toggleCode = (resourceId: string, code: string) => {
    const current = editingCodes[resourceId] ?? (resources.find(r => r.id === resourceId)?.executionCodes || []);
    const next = current.includes(code) ? current.filter(c => c !== code) : [...current, code];
    setEditingCodes(prev => ({ ...prev, [resourceId]: next }));
  };

  const getCodesForResource = (r: Resource) => {
    return editingCodes[r.id] !== undefined ? editingCodes[r.id] : (r.executionCodes || []);
  };

  const hasChanged = (r: Resource) => {
    if (editingCodes[r.id] === undefined) return false;
    const original = r.executionCodes || [];
    const edited = editingCodes[r.id];
    return JSON.stringify([...original].sort()) !== JSON.stringify([...edited].sort());
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900">
                <Users className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeResources.length}</p>
                <p className="text-sm text-muted-foreground">Aktiva resurser</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900">
                <Shield className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{withCodes.length}</p>
                <p className="text-sm text-muted-foreground">Med exekveringskoder</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeResources.length - withCodes.length}</p>
                <p className="text-sm text-muted-foreground">Saknar exekveringskoder</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Resurser & exekveringskoder
              </CardTitle>
              <CardDescription>Definiera vilka tjänstetyper varje resurs har behörighet att utföra</CardDescription>
            </div>
            <Link href="/resources">
              <Button variant="outline" size="sm" data-testid="link-resources-page">
                <ExternalLink className="h-4 w-4 mr-2" />
                Resurshantering
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {activeResources.map(resource => {
              const codes = getCodesForResource(resource);
              const changed = hasChanged(resource);

              return (
                <div key={resource.id} className="border rounded-lg p-4" data-testid={`card-resource-${resource.id}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-sm">
                        {resource.initials || resource.name.substring(0, 2)}
                      </div>
                      <div>
                        <p className="font-medium">{resource.name}</p>
                        <p className="text-sm text-muted-foreground">{resource.phone || resource.email || resource.resourceType}</p>
                      </div>
                    </div>
                    {changed && (
                      <Button
                        size="sm"
                        data-testid={`button-save-resource-codes-${resource.id}`}
                        onClick={() => {
                          updateResourceMutation.mutate({
                            id: resource.id,
                            executionCodes: editingCodes[resource.id],
                          });
                          setEditingCodes(prev => {
                            const next = { ...prev };
                            delete next[resource.id];
                            return next;
                          });
                        }}
                        disabled={updateResourceMutation.isPending}
                      >
                        <Save className="h-3 w-3 mr-1" />
                        Spara
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {EXECUTION_CODE_OPTIONS.map(opt => {
                      const isActive = codes.includes(opt.value);
                      return (
                        <Badge
                          key={opt.value}
                          variant={isActive ? "default" : "outline"}
                          className={`cursor-pointer transition-colors ${isActive ? "" : "opacity-50 hover:opacity-80"} ${updateResourceMutation.isPending ? "pointer-events-none opacity-60" : ""}`}
                          onClick={() => toggleCode(resource.id, opt.value)}
                          data-testid={`badge-code-${resource.id}-${opt.value}`}
                        >
                          {isActive && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {opt.label}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {activeResources.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                Inga resurser hittade
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TenantConfigPage() {
  const { data: tenant } = useQuery<Tenant>({ queryKey: ["/api/tenant"] });
  const { data: articles = [] } = useQuery<Article[]>({ queryKey: ["/api/articles"] });
  const { data: resources = [] } = useQuery<Resource[]>({ queryKey: ["/api/resources"] });
  const { data: priceLists = [] } = useQuery<PriceList[]>({ queryKey: ["/api/price-lists"] });

  const activeArticles = articles.filter(a => a.status === "active");
  const articlesWithCode = activeArticles.filter(a => a.executionCode);
  const activeResources = resources.filter(r => r.status === "active");
  const resourcesWithCodes = activeResources.filter(r => r.executionCodes && r.executionCodes.length > 0);
  const activePriceLists = priceLists.filter(p => p.status === "active");

  const completionSteps = [
    { label: "Företagsinfo", done: !!(tenant?.name && tenant?.orgNumber && tenant?.contactEmail) },
    { label: "Artiklar", done: activeArticles.length > 0 },
    { label: "Exekveringskoder på artiklar", done: articlesWithCode.length > 0 },
    { label: "Prislistor", done: activePriceLists.length > 0 },
    { label: "Resurser med behörigheter", done: resourcesWithCodes.length > 0 },
  ];
  const completedCount = completionSteps.filter(s => s.done).length;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tenant-konfiguration</h1>
          <p className="text-muted-foreground">Konfigurera {tenant?.name || "er tenant"} med rätt inställningar före dataimport</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={completedCount === completionSteps.length ? "default" : "secondary"} className="text-sm px-3 py-1">
            <Zap className="h-4 w-4 mr-1" />
            {completedCount}/{completionSteps.length} klart
          </Badge>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            {completionSteps.map((step, i) => (
              <div key={i} className="flex items-center gap-2">
                {step.done ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                )}
                <span className={`text-sm ${step.done ? "text-foreground" : "text-muted-foreground"}`}>{step.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="company" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="company" data-testid="tab-company" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Företagsinfo</span>
          </TabsTrigger>
          <TabsTrigger value="articles" data-testid="tab-articles" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Artiklar & koder</span>
          </TabsTrigger>
          <TabsTrigger value="pricelists" data-testid="tab-pricelists" className="flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            <span className="hidden sm:inline">Prislistor</span>
          </TabsTrigger>
          <TabsTrigger value="resources" data-testid="tab-resources" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Resurser</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company">
          <CompanyInfoTab />
        </TabsContent>
        <TabsContent value="articles">
          <ArticlesExecutionTab />
        </TabsContent>
        <TabsContent value="pricelists">
          <PriceListsTab />
        </TabsContent>
        <TabsContent value="resources">
          <ResourcesExecutionTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
