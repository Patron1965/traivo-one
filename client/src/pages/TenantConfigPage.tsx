import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Article, Resource, PriceList, Tenant } from "@shared/schema";
import {
  Building2,
  Package,
  Users,
  Receipt,
  Settings2,
  CheckCircle2,
  Wrench,
  Palette,
  Wifi,
  ToggleLeft,
  Zap,
} from "lucide-react";
import {
  CompanyInfoTab,
  ArticlesExecutionTab,
  PriceListsTab,
  ResourcesExecutionTab,
  ResourceProfilesTab,
  IoTTab,
  TerminologyTab,
  BrandingTab,
  ModulesTab,
} from "./tenant-config";

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
        <TabsList className="grid w-full grid-cols-9">
          <TabsTrigger value="company" data-testid="tab-company" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Företagsinfo</span>
          </TabsTrigger>
          <TabsTrigger value="branding" data-testid="tab-branding" className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            <span className="hidden sm:inline">Varumärke</span>
          </TabsTrigger>
          <TabsTrigger value="terminology" data-testid="tab-terminology" className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
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
          <TabsTrigger value="modules" data-testid="tab-modules" className="flex items-center gap-2">
            <ToggleLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Moduler</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company">
          <CompanyInfoTab />
        </TabsContent>
        <TabsContent value="branding">
          <BrandingTab />
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
        <TabsContent value="modules">
          <ModulesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
