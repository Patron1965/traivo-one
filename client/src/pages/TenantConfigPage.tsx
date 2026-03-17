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
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import type { Article, Resource, PriceList, Tenant, ResourceProfile, ResourceProfileAssignment, IotDevice, IotApiKey, IotSignal, ServiceObject } from "@shared/schema";
import { DEFAULT_TERMINOLOGY, INDUSTRY_TERMINOLOGY } from "@shared/schema";
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
  Plus,
  Pencil,
  Trash2,
  UserPlus,
  Wrench,
  Palette,
  Truck,
  HardHat,
  Hammer,
  Cog,
  MapPin,
  Recycle,
  Snowflake,
  Droplets,
  Wifi,
  Radio,
  Key,
  Copy,
  Battery,
  Signal,
  type LucideIcon,
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
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
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
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
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

  const { data: profiles = [] } = useQuery<ResourceProfile[]>({ queryKey: ["/api/resource-profiles"] });
  const { data: rpAssignments = [] } = useQuery<ResourceProfileAssignment[]>({
    queryKey: ["/api/resource-profiles", "all-assignments-res"],
    queryFn: async () => {
      if (!profiles.length) return [];
      const results = await Promise.all(profiles.map(p => fetch(`/api/resource-profiles/${p.id}/resources`).then(r => r.json())));
      return results.flat();
    },
    enabled: profiles.length > 0,
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
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
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
                        <div className="flex items-center gap-1">
                          <p className="text-sm text-muted-foreground">{resource.phone || resource.email || resource.resourceType}</p>
                          {rpAssignments.filter(a => a.resourceId === resource.id).map(a => {
                            const prof = profiles.find(p => p.id === a.profileId);
                            if (!prof) return null;
                            const PIcon = getProfileIcon(prof.icon || "wrench");
                            return <Badge key={a.id} variant="outline" className="text-[10px] px-1 py-0 h-4 gap-0.5" style={{ borderColor: prof.color || undefined }} data-testid={`badge-resource-profile-${resource.id}-${prof.id}`}><PIcon className="h-2.5 w-2.5" style={{ color: prof.color || "#3B82F6" }} />{prof.name}</Badge>;
                          })}
                        </div>
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

const PROFILE_COLORS = [
  { value: "#3B82F6", label: "Blå" },
  { value: "#10B981", label: "Grön" },
  { value: "#F59E0B", label: "Gul" },
  { value: "#EF4444", label: "Röd" },
  { value: "#8B5CF6", label: "Lila" },
  { value: "#EC4899", label: "Rosa" },
  { value: "#4A9B9B", label: "Teal" },
  { value: "#6B7C8C", label: "Grå" },
];

const PROFILE_ICON_OPTIONS: { value: string; label: string; Icon: LucideIcon }[] = [
  { value: "wrench", label: "Verktyg", Icon: Wrench },
  { value: "truck", label: "Lastbil", Icon: Truck },
  { value: "hard-hat", label: "Hjälm", Icon: HardHat },
  { value: "hammer", label: "Hammare", Icon: Hammer },
  { value: "cog", label: "Kugghjul", Icon: Cog },
  { value: "map-pin", label: "Plats", Icon: MapPin },
  { value: "recycle", label: "Återvinning", Icon: Recycle },
  { value: "snowflake", label: "Snö", Icon: Snowflake },
  { value: "droplets", label: "Vatten", Icon: Droplets },
  { value: "zap", label: "Blixt", Icon: Zap },
];

const getProfileIcon = (iconName: string): LucideIcon => {
  return PROFILE_ICON_OPTIONS.find(o => o.value === iconName)?.Icon || Wrench;
};

const EQUIPMENT_TYPE_OPTIONS = [
  { value: "baklastarebil", label: "Baklastare" },
  { value: "frontlastarebil", label: "Frontlastare" },
  { value: "kranbil", label: "Kranbil" },
  { value: "sugbil", label: "Sugbil" },
  { value: "containerbil", label: "Containerbil" },
  { value: "personbil", label: "Personbil" },
  { value: "liten_lastbil", label: "Liten lastbil" },
  { value: "traktor", label: "Traktor" },
  { value: "slapvagn", label: "Släpvagn" },
];

function ResourceProfilesTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ResourceProfile | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    executionCodes: [] as string[],
    equipmentTypes: [] as string[],
    defaultCostCenter: "",
    projectCode: "",
    serviceArea: [] as string[],
    color: "#3B82F6",
    icon: "wrench",
  });
  const [serviceAreaInput, setServiceAreaInput] = useState("");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const { data: profiles = [], isLoading } = useQuery<ResourceProfile[]>({
    queryKey: ["/api/resource-profiles"],
  });

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: allAssignments = [] } = useQuery<ResourceProfileAssignment[]>({
    queryKey: ["/api/resource-profiles", "assignments"],
    queryFn: async () => {
      if (!profiles.length) return [];
      const results = await Promise.all(
        profiles.map(p => fetch(`/api/resource-profiles/${p.id}/resources`).then(r => r.json()))
      );
      return results.flat();
    },
    enabled: profiles.length > 0,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/resource-profiles", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resource-profiles"] });
      toast({ title: "Profil skapad" });
      closeDialog();
    },
    onError: () => toast({ title: "Kunde inte skapa profil", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const res = await apiRequest("PUT", `/api/resource-profiles/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resource-profiles"] });
      toast({ title: "Profil uppdaterad" });
      closeDialog();
    },
    onError: () => toast({ title: "Kunde inte uppdatera profil", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/resource-profiles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resource-profiles"] });
      toast({ title: "Profil borttagen" });
    },
    onError: () => toast({ title: "Kunde inte ta bort profil", variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: async ({ resourceId, profileId }: { resourceId: string; profileId: string }) => {
      const res = await apiRequest("POST", `/api/resources/${resourceId}/profiles`, { profileId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resource-profiles"] });
      toast({ title: "Resurs kopplad" });
    },
    onError: () => toast({ title: "Kunde inte koppla resurs", variant: "destructive" }),
  });

  const unassignMutation = useMutation({
    mutationFn: async ({ resourceId, profileId }: { resourceId: string; profileId: string }) => {
      await apiRequest("DELETE", `/api/resources/${resourceId}/profiles/${profileId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resource-profiles"] });
      toast({ title: "Resurs bortkopplad" });
    },
    onError: () => toast({ title: "Kunde inte koppla bort resurs", variant: "destructive" }),
  });

  function closeDialog() {
    setDialogOpen(false);
    setEditingProfile(null);
    setFormData({ name: "", description: "", executionCodes: [], equipmentTypes: [], defaultCostCenter: "", projectCode: "", serviceArea: [], color: "#3B82F6", icon: "wrench" });
    setServiceAreaInput("");
  }

  function openEditDialog(profile: ResourceProfile) {
    setEditingProfile(profile);
    setFormData({
      name: profile.name,
      description: profile.description || "",
      executionCodes: profile.executionCodes || [],
      equipmentTypes: profile.equipmentTypes || [],
      defaultCostCenter: profile.defaultCostCenter || "",
      projectCode: profile.projectCode || "",
      serviceArea: profile.serviceArea || [],
      color: profile.color || "#3B82F6",
      icon: profile.icon || "wrench",
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (!formData.name.trim()) {
      toast({ title: "Namn krävs", variant: "destructive" });
      return;
    }
    if (editingProfile) {
      updateMutation.mutate({ id: editingProfile.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  }

  function toggleCode(code: string) {
    setFormData(prev => ({
      ...prev,
      executionCodes: prev.executionCodes.includes(code)
        ? prev.executionCodes.filter(c => c !== code)
        : [...prev.executionCodes, code],
    }));
  }

  function toggleEquipment(eq: string) {
    setFormData(prev => ({
      ...prev,
      equipmentTypes: prev.equipmentTypes.includes(eq)
        ? prev.equipmentTypes.filter(e => e !== eq)
        : [...prev.equipmentTypes, eq],
    }));
  }

  function addServiceArea() {
    const area = serviceAreaInput.trim();
    if (area && !formData.serviceArea.includes(area)) {
      setFormData(prev => ({ ...prev, serviceArea: [...prev.serviceArea, area] }));
      setServiceAreaInput("");
    }
  }

  function removeServiceArea(area: string) {
    setFormData(prev => ({ ...prev, serviceArea: prev.serviceArea.filter(a => a !== area) }));
  }

  const getAssignedResources = (profileId: string) =>
    allAssignments.filter(a => a.profileId === profileId);

  const getUnassignedResources = (profileId: string) => {
    const assignedIds = allAssignments.filter(a => a.profileId === profileId).map(a => a.resourceId);
    return resources.filter(r => r.status === "active" && !assignedIds.includes(r.id));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle data-testid="text-profiles-title">Utföranderoller / Resursprofiler</CardTitle>
            <CardDescription>Definiera profiler som beskriver kapacitet, utrustning och serviceområden för era resurser</CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); else setDialogOpen(true); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-profile" onClick={() => { setEditingProfile(null); setDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                Ny profil
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingProfile ? "Redigera profil" : "Skapa ny profil"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Namn *</Label>
                    <Input data-testid="input-profile-name" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder="t.ex. Baklastare Syd" />
                  </div>
                  <div className="space-y-2">
                    <Label>Färg</Label>
                    <div className="flex gap-2 flex-wrap">
                      {PROFILE_COLORS.map(c => (
                        <button key={c.value} data-testid={`button-color-${c.value}`} className={`w-8 h-8 rounded-full border-2 transition-all ${formData.color === c.value ? "border-foreground scale-110" : "border-transparent"}`} style={{ backgroundColor: c.value }} onClick={() => setFormData(p => ({ ...p, color: c.value }))} title={c.label} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Ikon</Label>
                  <div className="flex gap-2 flex-wrap">
                    {PROFILE_ICON_OPTIONS.map(opt => {
                      const IconComp = opt.Icon;
                      return (
                        <button key={opt.value} data-testid={`button-icon-${opt.value}`} className={`w-9 h-9 rounded-md border-2 flex items-center justify-center transition-all ${formData.icon === opt.value ? "border-foreground bg-accent" : "border-muted hover:border-muted-foreground"}`} onClick={() => setFormData(p => ({ ...p, icon: opt.value }))} title={opt.label}>
                          <IconComp className="h-4 w-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Beskrivning</Label>
                  <Textarea data-testid="input-profile-description" value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} placeholder="Beskriv profilens syfte..." rows={2} />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>Utförandekoder</Label>
                  <div className="flex flex-wrap gap-2">
                    {EXECUTION_CODE_OPTIONS.map(opt => {
                      const active = formData.executionCodes.includes(opt.value);
                      return (
                        <Badge key={opt.value} variant={active ? "default" : "outline"} className={`cursor-pointer transition-colors ${active ? "" : "opacity-50 hover:opacity-80"}`} onClick={() => toggleCode(opt.value)} data-testid={`badge-profile-code-${opt.value}`}>
                          {active && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {opt.label}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Utrustningstyper</Label>
                  <div className="flex flex-wrap gap-2">
                    {EQUIPMENT_TYPE_OPTIONS.map(opt => {
                      const active = formData.equipmentTypes.includes(opt.value);
                      return (
                        <Badge key={opt.value} variant={active ? "default" : "outline"} className={`cursor-pointer transition-colors ${active ? "" : "opacity-50 hover:opacity-80"}`} onClick={() => toggleEquipment(opt.value)} data-testid={`badge-profile-equip-${opt.value}`}>
                          {active && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {opt.label}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Kostnadsställe</Label>
                    <Input data-testid="input-profile-cost-center" value={formData.defaultCostCenter} onChange={e => setFormData(p => ({ ...p, defaultCostCenter: e.target.value }))} placeholder="t.ex. KS-100" />
                  </div>
                  <div className="space-y-2">
                    <Label>Projektkod</Label>
                    <Input data-testid="input-profile-project-code" value={formData.projectCode} onChange={e => setFormData(p => ({ ...p, projectCode: e.target.value }))} placeholder="t.ex. PRJ-2025-01" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Serviceområden</Label>
                  <div className="flex gap-2">
                    <Input data-testid="input-service-area" value={serviceAreaInput} onChange={e => setServiceAreaInput(e.target.value)} placeholder="t.ex. Malmö Syd" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addServiceArea(); }}} />
                    <Button variant="outline" onClick={addServiceArea} data-testid="button-add-service-area">Lägg till</Button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {formData.serviceArea.map(area => (
                      <Badge key={area} variant="secondary" className="gap-1">
                        {area}
                        <button onClick={() => removeServiceArea(area)} className="ml-1 hover:text-destructive" data-testid={`button-remove-area-${area}`}>&times;</button>
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-profile">Avbryt</Button>
                <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-profile">
                  {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editingProfile ? "Uppdatera" : "Skapa"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {profiles.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <Wrench className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Inga utföranderoller skapade ännu</p>
              <p className="text-sm mt-1">Skapa en profil för att definiera kapacitet och serviceområden</p>
            </div>
          ) : (
            <div className="space-y-4">
              {profiles.map(profile => {
                const assigned = getAssignedResources(profile.id);
                const unassigned = getUnassignedResources(profile.id);
                return (
                  <Card key={profile.id} className="border" data-testid={`card-profile-${profile.id}`}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          {(() => { const ProfileIcon = getProfileIcon(profile.icon || "wrench"); return <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: (profile.color || "#3B82F6") + "20" }}><ProfileIcon className="h-4 w-4" style={{ color: profile.color || "#3B82F6" }} /></div>; })()}
                          <div>
                            <h3 className="font-semibold text-base" data-testid={`text-profile-name-${profile.id}`}>{profile.name}</h3>
                            {profile.description && <p className="text-sm text-muted-foreground">{profile.description}</p>}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(profile)} data-testid={`button-edit-profile-${profile.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(profile.id)} data-testid={`button-delete-profile-${profile.id}`}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-4 text-sm">
                        {(profile.executionCodes?.length ?? 0) > 0 && (
                          <div>
                            <span className="text-muted-foreground">Koder: </span>
                            {profile.executionCodes!.map(code => {
                              const label = EXECUTION_CODE_OPTIONS.find(o => o.value === code)?.label || code;
                              return <Badge key={code} variant="outline" className="mr-1">{label}</Badge>;
                            })}
                          </div>
                        )}
                        {(profile.equipmentTypes?.length ?? 0) > 0 && (
                          <div>
                            <span className="text-muted-foreground">Utrustning: </span>
                            {profile.equipmentTypes!.map(eq => {
                              const label = EQUIPMENT_TYPE_OPTIONS.find(o => o.value === eq)?.label || eq;
                              return <Badge key={eq} variant="secondary" className="mr-1">{label}</Badge>;
                            })}
                          </div>
                        )}
                        {profile.defaultCostCenter && <div><span className="text-muted-foreground">KS: </span>{profile.defaultCostCenter}</div>}
                        {profile.projectCode && <div><span className="text-muted-foreground">Projekt: </span>{profile.projectCode}</div>}
                        {(profile.serviceArea?.length ?? 0) > 0 && (
                          <div>
                            <span className="text-muted-foreground">Områden: </span>
                            {profile.serviceArea!.map(a => <Badge key={a} variant="secondary" className="mr-1">{a}</Badge>)}
                          </div>
                        )}
                      </div>
                      <Separator className="my-3" />
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">Kopplade resurser ({assigned.length})</span>
                          <Dialog open={assignDialogOpen && selectedProfileId === profile.id} onOpenChange={(open) => { setAssignDialogOpen(open); if (open) setSelectedProfileId(profile.id); }}>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm" data-testid={`button-assign-resource-${profile.id}`}>
                                <UserPlus className="h-3 w-3 mr-1" />
                                Koppla resurs
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Koppla resurs till {profile.name}</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-2 max-h-60 overflow-y-auto py-2">
                                {unassigned.length === 0 ? (
                                  <p className="text-sm text-muted-foreground text-center py-4">Alla resurser är redan kopplade</p>
                                ) : (
                                  unassigned.map(r => (
                                    <div key={r.id} className="flex items-center justify-between p-2 rounded hover:bg-accent">
                                      <span className="text-sm">{r.name}</span>
                                      <Button size="sm" variant="outline" onClick={() => { assignMutation.mutate({ resourceId: r.id, profileId: profile.id }); }} disabled={assignMutation.isPending} data-testid={`button-assign-${r.id}-${profile.id}`}>
                                        <Plus className="h-3 w-3 mr-1" />
                                        Koppla
                                      </Button>
                                    </div>
                                  ))
                                )}
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {assigned.map(a => {
                            const resource = resources.find(r => r.id === a.resourceId);
                            return (
                              <Badge key={a.id} variant="default" className="gap-1" data-testid={`badge-assigned-${a.id}`}>
                                {resource?.name || a.resourceId}
                                <button onClick={() => unassignMutation.mutate({ resourceId: a.resourceId, profileId: a.profileId })} className="ml-1 hover:text-destructive" data-testid={`button-unassign-${a.id}`}>&times;</button>
                              </Badge>
                            );
                          })}
                          {assigned.length === 0 && <span className="text-sm text-muted-foreground">Inga resurser kopplade</span>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function IoTTab() {
  const { toast } = useToast();
  const { data: devices = [], isLoading: devicesLoading } = useQuery<IotDevice[]>({ queryKey: ["/api/iot/devices"] });
  const { data: apiKeys = [], isLoading: keysLoading } = useQuery<IotApiKey[]>({ queryKey: ["/api/iot/api-keys"] });
  const { data: signals = [] } = useQuery<IotSignal[]>({ queryKey: ["/api/iot/signals"] });
  const { data: allObjects = [] } = useQuery<ServiceObject[]>({ queryKey: ["/api/objects"] });

  const [newDeviceOpen, setNewDeviceOpen] = useState(false);
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deviceForm, setDeviceForm] = useState({ objectId: "", deviceType: "fill_sensor", externalDeviceId: "" });

  const createDeviceMutation = useMutation({
    mutationFn: async (data: typeof deviceForm) => {
      const body: Record<string, string> = { objectId: data.objectId, deviceType: data.deviceType };
      if (data.externalDeviceId) body.externalDeviceId = data.externalDeviceId;
      return apiRequest("POST", "/api/iot/devices", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/iot/devices"] });
      toast({ title: "Skapad", description: "IoT-enhet registrerad." });
      setNewDeviceOpen(false);
      setDeviceForm({ objectId: "", deviceType: "fill_sensor", externalDeviceId: "" });
    },
    onError: (e: Error) => toast({ title: "Fel", description: e.message, variant: "destructive" }),
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/iot/devices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/iot/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/iot/signals"] });
      toast({ title: "Borttagen", description: "IoT-enhet borttagen." });
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/iot/api-keys", { name });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/iot/api-keys"] });
      setCreatedKey(data.apiKey);
      setNewKeyName("");
      toast({ title: "Skapad", description: "API-nyckel skapad. Kopiera den nu — den visas bara en gång." });
    },
    onError: (e: Error) => toast({ title: "Fel", description: e.message, variant: "destructive" }),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/iot/api-keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/iot/api-keys"] });
      toast({ title: "Borttagen", description: "API-nyckel borttagen." });
    },
  });

  const objectMap = new Map(allObjects.map(o => [o.id, o.name]));

  if (devicesLoading || keysLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-900">
                <Radio className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-iot-device-count">{devices.length}</p>
                <p className="text-sm text-muted-foreground">Registrerade enheter</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <Key className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-iot-key-count">{apiKeys.length}</p>
                <p className="text-sm text-muted-foreground">API-nycklar</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900">
                <Signal className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-iot-signal-count">{signals.length}</p>
                <p className="text-sm text-muted-foreground">Senaste signaler</p>
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
                <Radio className="h-5 w-5" />
                IoT-enheter
              </CardTitle>
              <CardDescription>Registrera sensorer kopplade till era objekt</CardDescription>
            </div>
            <Dialog open={newDeviceOpen} onOpenChange={setNewDeviceOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-iot-device"><Plus className="h-4 w-4 mr-2" />Lägg till enhet</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Registrera IoT-enhet</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Objekt</Label>
                    <Select value={deviceForm.objectId} onValueChange={v => setDeviceForm(p => ({ ...p, objectId: v }))}>
                      <SelectTrigger data-testid="select-iot-object"><SelectValue placeholder="Välj objekt" /></SelectTrigger>
                      <SelectContent>
                        {allObjects.slice(0, 100).map(o => (
                          <SelectItem key={o.id} value={o.id}>{o.name} ({o.objectNumber || "—"})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Enhetstyp</Label>
                    <Select value={deviceForm.deviceType} onValueChange={v => setDeviceForm(p => ({ ...p, deviceType: v }))}>
                      <SelectTrigger data-testid="select-iot-device-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fill_sensor">Fyllnadssensor</SelectItem>
                        <SelectItem value="temperature">Temperatursensor</SelectItem>
                        <SelectItem value="weight">Viktsensor</SelectItem>
                        <SelectItem value="gps_tracker">GPS-tracker</SelectItem>
                        <SelectItem value="tilt_sensor">Lutningssensor</SelectItem>
                        <SelectItem value="fire_sensor">Brandsensor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Externt enhets-ID (valfritt)</Label>
                    <Input
                      data-testid="input-iot-external-id"
                      value={deviceForm.externalDeviceId}
                      onChange={e => setDeviceForm(p => ({ ...p, externalDeviceId: e.target.value }))}
                      placeholder="t.ex. SEN-001-ABC"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    data-testid="button-save-iot-device"
                    onClick={() => createDeviceMutation.mutate(deviceForm)}
                    disabled={!deviceForm.objectId || createDeviceMutation.isPending}
                  >
                    {createDeviceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Registrera
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Objekt</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Externt ID</TableHead>
                <TableHead>Senaste signal</TableHead>
                <TableHead>Batteri</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map(d => (
                <TableRow key={d.id} data-testid={`row-iot-device-${d.id}`}>
                  <TableCell className="font-medium">{objectMap.get(d.objectId) || d.objectId}</TableCell>
                  <TableCell><Badge variant="outline">{d.deviceType}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{d.externalDeviceId || "—"}</TableCell>
                  <TableCell>
                    {d.lastSignal ? (
                      <span className="text-sm">{d.lastSignal} — {d.lastSignalAt ? new Date(d.lastSignalAt).toLocaleString("sv-SE") : ""}</span>
                    ) : <span className="text-muted-foreground text-sm">Ingen</span>}
                  </TableCell>
                  <TableCell>
                    {d.batteryLevel !== null && d.batteryLevel !== undefined ? (
                      <div className="flex items-center gap-1">
                        <Battery className={`h-4 w-4 ${d.batteryLevel < 20 ? "text-red-500" : d.batteryLevel < 50 ? "text-amber-500" : "text-green-500"}`} />
                        <span className="text-sm">{d.batteryLevel}%</span>
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={d.status === "active" ? "default" : "secondary"}>{d.status === "active" ? "Aktiv" : d.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" data-testid={`button-delete-device-${d.id}`} onClick={() => deleteDeviceMutation.mutate(d.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {devices.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Inga IoT-enheter registrerade</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                API-nycklar
              </CardTitle>
              <CardDescription>Nycklar för att skicka IoT-signaler via POST /api/iot/signals</CardDescription>
            </div>
            <Dialog open={newKeyOpen} onOpenChange={(open) => { setNewKeyOpen(open); if (!open) setCreatedKey(null); }}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-iot-key"><Plus className="h-4 w-4 mr-2" />Skapa nyckel</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{createdKey ? "API-nyckel skapad" : "Skapa API-nyckel"}</DialogTitle></DialogHeader>
                {createdKey ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">Kopiera nyckeln nu. Den visas bara en gång.</p>
                    <div className="flex items-center gap-2">
                      <Input value={createdKey} readOnly className="font-mono text-xs" data-testid="input-created-api-key" />
                      <Button variant="outline" size="sm" data-testid="button-copy-api-key" onClick={() => { navigator.clipboard.writeText(createdKey); toast({ title: "Kopierad" }); }}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Namn</Label>
                      <Input data-testid="input-iot-key-name" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="t.ex. Produktionssensorer" />
                    </div>
                  </div>
                )}
                <DialogFooter>
                  {!createdKey && (
                    <Button data-testid="button-save-iot-key" onClick={() => createKeyMutation.mutate(newKeyName)} disabled={!newKeyName || createKeyMutation.isPending}>
                      {createKeyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Skapa
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Namn</TableHead>
                <TableHead>Nyckel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Senast använd</TableHead>
                <TableHead>Skapad</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map(k => (
                <TableRow key={k.id} data-testid={`row-iot-key-${k.id}`}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs">{k.apiKey}</TableCell>
                  <TableCell><Badge variant={k.status === "active" ? "default" : "secondary"}>{k.status === "active" ? "Aktiv" : k.status}</Badge></TableCell>
                  <TableCell className="text-sm">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("sv-SE") : "Aldrig"}</TableCell>
                  <TableCell className="text-sm">{new Date(k.createdAt).toLocaleDateString("sv-SE")}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" data-testid={`button-delete-key-${k.id}`} onClick={() => deleteKeyMutation.mutate(k.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {apiKeys.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Inga API-nycklar</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {signals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Signal className="h-5 w-5" />
              Senaste signaler
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tid</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Enhet</TableHead>
                  <TableHead>Order skapad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.slice(0, 20).map(s => (
                  <TableRow key={s.id} data-testid={`row-iot-signal-${s.id}`}>
                    <TableCell className="text-sm">{new Date(s.createdAt).toLocaleString("sv-SE")}</TableCell>
                    <TableCell><Badge variant="outline">{s.signalType}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{s.deviceId.slice(0, 8)}...</TableCell>
                    <TableCell>
                      {s.workOrderId ? (
                        <Badge variant="default" className="text-xs">Ja</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">Nej</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const LABEL_KEY_DESCRIPTIONS: Record<string, string> = {
  object_singular: "Objekt (singular) — t.ex. \"Kärl\", \"Fastighet\", \"Aggregat\"",
  object_plural: "Objekt (plural) — t.ex. \"Kärl\", \"Fastigheter\", \"Aggregat\"",
  work_order_singular: "Uppgift (singular) — t.ex. \"Ärende\", \"Order\"",
  work_order_plural: "Uppgifter (plural) — t.ex. \"Ärenden\", \"Ordrar\"",
  resource_singular: "Resurs (singular) — t.ex. \"Tekniker\", \"Förare\"",
  resource_plural: "Resurser (plural) — t.ex. \"Tekniker\", \"Förare\"",
  customer_singular: "Kund (singular)",
  customer_plural: "Kunder (plural)",
  cluster_singular: "Kluster (singular) — t.ex. \"Område\", \"Distrikt\"",
  cluster_plural: "Kluster (plural) — t.ex. \"Områden\", \"Distrikt\"",
  article_singular: "Artikel (singular) — t.ex. \"Tjänst\", \"Produkt\"",
  article_plural: "Artiklar (plural) — t.ex. \"Tjänster\", \"Produkter\"",
  vehicle_singular: "Fordon (singular)",
  vehicle_plural: "Fordon (plural)",
  container_singular: "Kärl (singular) — t.ex. \"Enhet\", \"Behållare\"",
  container_plural: "Kärl (plural) — t.ex. \"Enheter\", \"Behållare\"",
  route_singular: "Rutt (singular) — t.ex. \"Tur\", \"Slinga\"",
  route_plural: "Rutter (plural) — t.ex. \"Turer\", \"Slingor\"",
  asset_type: "Objekttyp — t.ex. \"Kärltyp\", \"Fastighetstyp\"",
  service_area: "Serviceområde — t.ex. \"Hämtområde\", \"Förvaltningsområde\"",
  inspection_singular: "Besiktning (singular) — t.ex. \"Kontroll\"",
  inspection_plural: "Besiktningar (plural) — t.ex. \"Kontroller\"",
};

function TerminologyTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ labels: Record<string, string>; customized: string[]; industry: string }>({
    queryKey: ["/api/terminology"],
  });

  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (data?.labels) {
      setEditValues(data.labels);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const industry = data?.industry || "waste_management";
      const industryDefaults = INDUSTRY_TERMINOLOGY[industry as keyof typeof INDUSTRY_TERMINOLOGY] || {};
      const baseline = { ...DEFAULT_TERMINOLOGY, ...industryDefaults };
      const overrides: Record<string, string> = {};
      for (const key of Object.keys(DEFAULT_TERMINOLOGY)) {
        const val = values[key] || "";
        const base = baseline[key] || "";
        if (val && val !== base) {
          overrides[key] = val;
        }
      }
      return apiRequest("PUT", "/api/terminology", { labels: overrides });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/terminology"] });
      setHasChanges(false);
      toast({ title: "Sparat", description: "Terminologin har uppdaterats." });
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const customized = data?.customized || [];

  const previewItems = [
    { key: "object_plural", context: "Meny: " },
    { key: "work_order_plural", context: "Meny: " },
    { key: "resource_plural", context: "Meny: " },
    { key: "customer_plural", context: "Meny: " },
    { key: "cluster_plural", context: "Meny: " },
    { key: "article_plural", context: "Meny: " },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" data-testid="text-terminology-title">
            <Palette className="h-5 w-5" />
            Branschanpassad terminologi
          </CardTitle>
          <CardDescription>
            Anpassa termer i gränssnittet så att de matchar er bransch. Lämna fältet tomt för att använda standardvärdet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[300px]">Nyckel</TableHead>
                    <TableHead>Värde</TableHead>
                    <TableHead className="w-[80px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.keys(LABEL_KEY_DESCRIPTIONS).map(key => (
                    <TableRow key={key} data-testid={`row-label-${key}`}>
                      <TableCell>
                        <div>
                          <span className="font-mono text-xs text-muted-foreground">{key}</span>
                          <p className="text-xs text-muted-foreground mt-0.5">{LABEL_KEY_DESCRIPTIONS[key]}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          data-testid={`input-label-${key}`}
                          value={editValues[key] || ""}
                          onChange={(e) => {
                            setEditValues(prev => ({ ...prev, [key]: e.target.value }));
                            setHasChanges(true);
                          }}
                          placeholder={data?.labels[key] || key}
                          className="max-w-[250px]"
                        />
                      </TableCell>
                      <TableCell>
                        {customized.includes(key) ? (
                          <Badge variant="default" className="text-xs">Anpassad</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Standard</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div>
              <Card className="sticky top-4">
                <CardHeader>
                  <CardTitle className="text-sm">Förhandsvisning</CardTitle>
                  <CardDescription className="text-xs">Så här ser termerna ut i navigeringen</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2" data-testid="terminology-preview">
                    {previewItems.map(item => (
                      <div key={item.key} className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 text-sm">
                        <span className="text-muted-foreground">{item.context}</span>
                        <span className="font-medium">{editValues[item.key] || data?.labels[item.key] || item.key}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <Separator />
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              data-testid="button-reset-terminology"
              onClick={() => {
                if (data?.labels) {
                  setEditValues(data.labels);
                  setHasChanges(false);
                }
              }}
              disabled={!hasChanges}
            >
              Återställ
            </Button>
            <Button
              data-testid="button-save-terminology"
              onClick={() => saveMutation.mutate(editValues)}
              disabled={!hasChanges || saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Spara terminologi
            </Button>
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
          <h1 className="text-2xl font-bold">Företagsinställningar</h1>
          <p className="text-muted-foreground">Konfigurera {tenant?.name || "ert företag"} med rätt inställningar före dataimport</p>
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
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="company" data-testid="tab-company" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Företagsinfo</span>
          </TabsTrigger>
          <TabsTrigger value="terminology" data-testid="tab-terminology" className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            <span className="hidden sm:inline">Terminologi</span>
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
          <TabsTrigger value="profiles" data-testid="tab-profiles" className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            <span className="hidden sm:inline">Utföranderoller</span>
          </TabsTrigger>
          <TabsTrigger value="iot" data-testid="tab-iot" className="flex items-center gap-2">
            <Wifi className="h-4 w-4" />
            <span className="hidden sm:inline">IoT</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company">
          <CompanyInfoTab />
        </TabsContent>
        <TabsContent value="terminology">
          <TerminologyTab />
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
        <TabsContent value="profiles">
          <ResourceProfilesTab />
        </TabsContent>
        <TabsContent value="iot">
          <IoTTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
