import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  Package, 
  Trash2, 
  Sparkles, 
  Building2, 
  Check, 
  AlertCircle,
  Download,
  FileText,
  Database,
  CheckCircle2,
  Loader2,
  RefreshCw
} from "lucide-react";
import type { IndustryPackage, TenantPackageInstallation } from "@shared/schema";

const industryIcons: Record<string, typeof Package> = {
  waste: Trash2,
  cleaning: Sparkles,
  property: Building2,
  generic: Package,
};

const industryLabels: Record<string, string> = {
  waste: "Avfallshantering",
  cleaning: "Städtjänster",
  property: "Fastighetsservice",
  generic: "Generellt",
};

interface PackageWithData extends IndustryPackage {
  data?: Array<{
    dataType: string;
    data: unknown[];
  }>;
}

export default function IndustryPackagesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [installingPackageId, setInstallingPackageId] = useState<string | null>(null);

  const { data: packages, isLoading: packagesLoading } = useQuery<IndustryPackage[]>({
    queryKey: ["/api/system/industry-packages"],
  });

  const { data: installations, isLoading: installationsLoading } = useQuery<TenantPackageInstallation[]>({
    queryKey: ["/api/system/industry-packages/installations"],
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/system/industry-packages/seed");
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/industry-packages"] });
      toast({
        title: "Branschpaket skapade",
        description: `${data.results?.filter((r: any) => r.status === "created").length || 0} paket skapades`,
      });
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte skapa branschpaket",
        variant: "destructive",
      });
    },
  });

  const installMutation = useMutation({
    mutationFn: async (packageId: string) => {
      setInstallingPackageId(packageId);
      return apiRequest("POST", `/api/system/industry-packages/${packageId}/install`);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/industry-packages/installations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/metadata-definitions"] });
      toast({
        title: "Paket installerat",
        description: `${data.summary?.articlesInstalled || 0} artiklar och ${data.summary?.metadataInstalled || 0} metadatatyper installerades`,
      });
      setInstallingPackageId(null);
    },
    onError: () => {
      toast({
        title: "Installationsfel",
        description: "Kunde inte installera paketet",
        variant: "destructive",
      });
      setInstallingPackageId(null);
    },
  });

  const getInstallationForPackage = (packageId: string) => {
    return installations?.find(i => i.packageId === packageId);
  };

  if (packagesLoading || installationsLoading) {
    return (
      <div className="container py-8 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Branschpaket</h1>
          <p className="text-muted-foreground mt-1">
            Installera fördefinierade mallar med artiklar och metadatatyper för din bransch
          </p>
        </div>
        {(!packages || packages.length === 0) && (
          <Button
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            data-testid="button-seed-packages"
          >
            {seedMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Skapa branschpaket
          </Button>
        )}
      </div>

      {(!packages || packages.length === 0) && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Inga branschpaket tillgängliga</AlertTitle>
          <AlertDescription>
            Klicka på &quot;Skapa branschpaket&quot; för att initiera standardpaketen för Avfall, Städning och Fastighetsservice.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {packages?.map((pkg) => {
          const Icon = industryIcons[pkg.industry] || Package;
          const installation = getInstallationForPackage(pkg.id);
          const isInstalled = !!installation;
          const isInstalling = installingPackageId === pkg.id;

          return (
            <Card 
              key={pkg.id} 
              className={`relative overflow-hidden ${isInstalled ? "border-green-500/50" : ""}`}
              data-testid={`card-package-${pkg.slug}`}
            >
              {isInstalled && (
                <div className="absolute top-3 right-3">
                  <Badge variant="default" className="bg-green-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Installerat
                  </Badge>
                </div>
              )}
              
              <CardHeader>
                <div className="flex items-start gap-4">
                  <div 
                    className="h-12 w-12 rounded-lg flex items-center justify-center text-white"
                    style={{ backgroundColor: pkg.suggestedPrimaryColor || "#3B82F6" }}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-lg">{pkg.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {industryLabels[pkg.industry] || pkg.industry}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {pkg.description}
                </p>

                <div className="flex items-center gap-3 text-sm">
                  <div className="flex items-center gap-1">
                    <div 
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: pkg.suggestedPrimaryColor || "#3B82F6" }}
                    />
                    <span className="text-muted-foreground">Primär</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div 
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: pkg.suggestedSecondaryColor || "#6366F1" }}
                    />
                    <span className="text-muted-foreground">Sekundär</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div 
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: pkg.suggestedAccentColor || "#F59E0B" }}
                    />
                    <span className="text-muted-foreground">Accent</span>
                  </div>
                </div>

                {isInstalled && installation && (
                  <div className="flex items-center gap-4 text-sm border-t pt-4 flex-wrap">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <FileText className="h-4 w-4" />
                      <span>{installation.articlesInstalled} artiklar</span>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Database className="h-4 w-4" />
                      <span>{installation.metadataInstalled} metadata</span>
                    </div>
                    {(installation.structuralArticlesInstalled ?? 0) > 0 && (
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Package className="h-4 w-4" />
                        <span>{installation.structuralArticlesInstalled} strukturartiklar</span>
                      </div>
                    )}
                  </div>
                )}

                <Button
                  className="w-full"
                  variant={isInstalled ? "outline" : "default"}
                  disabled={isInstalling || isInstalled}
                  onClick={() => installMutation.mutate(pkg.id)}
                  data-testid={`button-install-${pkg.slug}`}
                >
                  {isInstalling ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Installerar...
                    </>
                  ) : isInstalled ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Redan installerat
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Installera paket
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {installations && installations.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Installationshistorik</h2>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Paket</th>
                  <th className="text-left p-3 font-medium">Artiklar</th>
                  <th className="text-left p-3 font-medium">Metadata</th>
                  <th className="text-left p-3 font-medium">Strukturartiklar</th>
                  <th className="text-left p-3 font-medium">Installerat</th>
                  <th className="text-left p-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {installations.map((installation) => {
                  const pkg = packages?.find(p => p.id === installation.packageId);
                  return (
                    <tr key={installation.id} className="border-t" data-testid={`row-installation-${installation.id}`}>
                      <td className="p-3">{pkg?.name || "Okänt paket"}</td>
                      <td className="p-3">{installation.articlesInstalled}</td>
                      <td className="p-3">{installation.metadataInstalled}</td>
                      <td className="p-3">{installation.structuralArticlesInstalled ?? 0}</td>
                      <td className="p-3">
                        {new Date(installation.installedAt).toLocaleString("sv-SE")}
                      </td>
                      <td className="p-3">
                        <Badge variant={installation.status === "completed" ? "default" : "destructive"}>
                          {installation.status === "completed" ? "Slutförd" : installation.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
