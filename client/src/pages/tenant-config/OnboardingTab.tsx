import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { OnboardingImportPanel } from "@/components/OnboardingImportPanel";
import {
  Rocket,
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
  ExternalLink,
  Package,
  Receipt,
  Car,
  Users,
  UserCircle2,
  Building2,
  MapPin,
  Sparkles,
  Cloud,
} from "lucide-react";

interface OnboardingStatus {
  steps: { key: string; label: string; done: boolean; count: number }[];
  completed: number;
  total: number;
}

interface FortnoxPreview {
  connected: boolean;
  count: number;
  sample: { articleNumber: string; description: string; salesPrice: number; unit: string }[];
  error?: string;
}

const STEP_META: Record<string, { icon: any; href?: string; help: string }> = {
  company: {
    icon: Building2,
    help: "Företagsnamn, organisationsnummer och kontaktuppgifter — fyll i på fliken Företagsinfo.",
  },
  articles: {
    icon: Package,
    href: "/articles",
    help: "Tjänster, varor och kontroller. Hämta från Fortnox eller ladda upp CSV.",
  },
  price_lists: {
    icon: Receipt,
    href: "/price-lists",
    help: "Generella, kundunika prislistor och rabattbrev.",
  },
  vehicles: {
    icon: Car,
    href: "/vehicles",
    help: "Lastbilar, kranbilar och andra fordon med kapacitet och kostnadsställe.",
  },
  resources: {
    icon: UserCircle2,
    href: "/resources",
    help: "Personal/utförare. Importera via Resurshantering eller skapa manuellt.",
  },
  teams: {
    icon: Users,
    href: "/tenant-config?tab=teams",
    help: "Gruppera personal i team som kan tilldelas jobb i veckoplaneraren.",
  },
  customers: {
    icon: Building2,
    href: "/customers",
    help: "Kunder och deras objekt. Importera via Importera-sidan.",
  },
  delivery_preferences: {
    icon: MapPin,
    help: "Tidsfönster när kunder vill (eller inte vill) ha leveranser.",
  },
};

export function OnboardingTab() {
  const { toast } = useToast();
  const [activeStep, setActiveStep] = useState<string>("articles");

  const { data: status, isLoading } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
  });

  const { data: fortnox, refetch: refetchFortnox } = useQuery<FortnoxPreview>({
    queryKey: ["/api/onboarding/fortnox/articles/preview"],
    staleTime: 60_000,
  });

  const fortnoxSyncMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/onboarding/fortnox/articles/sync", {});
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      toast({
        title: "Fortnox-synk klar",
        description: `${data.created} nya, ${data.updated} uppdaterade av ${data.total} artiklar.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Fortnox-synk misslyckades", description: err?.message, variant: "destructive" });
    },
  });

  if (isLoading || !status) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pct = Math.round((status.completed / status.total) * 100);

  return (
    <div className="space-y-6">
      {/* Översikt */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Rocket className="h-5 w-5 text-primary" />
                Kom igång med Traivo
              </CardTitle>
              <CardDescription className="mt-1">
                Steg-för-steg setup för nya företag. Hämta data från Fortnox eller importera via CSV.
              </CardDescription>
            </div>
            <Badge
              variant={status.completed === status.total ? "default" : "secondary"}
              className="text-sm px-3 py-1"
              data-testid="badge-onboarding-progress"
            >
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              {status.completed}/{status.total} klart
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Progress value={pct} className="h-2 mb-4" data-testid="progress-onboarding" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {status.steps.map((step) => {
              const meta = STEP_META[step.key];
              const Icon = meta?.icon ?? Circle;
              return (
                <button
                  key={step.key}
                  onClick={() => setActiveStep(step.key)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    activeStep === step.key
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/40 hover:bg-muted/50"
                  }`}
                  data-testid={`step-button-${step.key}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {step.done ? (
                      <CheckCircle2 className="h-4 w-4 text-chart-2 flex-shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-xs font-medium">{step.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {step.count} {step.count === 1 ? "post" : "poster"}
                  </p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Aktivt steg */}
      {(() => {
        const step = status.steps.find((s) => s.key === activeStep);
        const meta = STEP_META[activeStep];
        if (!step) return null;
        const Icon = meta?.icon ?? Circle;

        return (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{step.label}</CardTitle>
                    <CardDescription className="mt-0.5">{meta?.help}</CardDescription>
                  </div>
                </div>
                {meta?.href && (
                  <Link href={meta.href}>
                    <Button variant="outline" size="sm" data-testid={`button-open-${activeStep}`}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Öppna sida
                    </Button>
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <StepContent
                stepKey={activeStep}
                fortnox={fortnox}
                refetchFortnox={refetchFortnox}
                fortnoxSyncMutation={fortnoxSyncMutation}
              />
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}

function StepContent({
  stepKey,
  fortnox,
  refetchFortnox,
  fortnoxSyncMutation,
}: {
  stepKey: string;
  fortnox?: FortnoxPreview;
  refetchFortnox: () => void;
  fortnoxSyncMutation: any;
}) {
  switch (stepKey) {
    case "company":
      return (
        <Alert>
          <Building2 className="h-4 w-4" />
          <AlertTitle>Gå till fliken Företagsinfo</AlertTitle>
          <AlertDescription>
            Fyll i företagsnamn, organisationsnummer, kontakt-e-post och telefon på fliken{" "}
            <strong>Företagsinfo</strong> ovan.
          </AlertDescription>
        </Alert>
      );

    case "articles":
      return (
        <Tabs defaultValue="fortnox" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="fortnox" data-testid="tab-articles-fortnox">
              <Cloud className="h-4 w-4 mr-2" /> Fortnox
            </TabsTrigger>
            <TabsTrigger value="csv" data-testid="tab-articles-csv">
              CSV-import
            </TabsTrigger>
          </TabsList>
          <TabsContent value="fortnox" className="space-y-3 pt-4">
            {fortnox?.connected === false ? (
              <Alert>
                <Cloud className="h-4 w-4" />
                <AlertTitle>Fortnox är inte anslutet</AlertTitle>
                <AlertDescription>
                  Anslut Fortnox i fliken <strong>Moduler</strong> eller via Fortnox-inställningarna för att hämta
                  artiklar automatiskt.
                </AlertDescription>
              </Alert>
            ) : fortnox?.error ? (
              <Alert variant="destructive">
                <AlertTitle>Kunde inte läsa Fortnox</AlertTitle>
                <AlertDescription>{fortnox.error}</AlertDescription>
              </Alert>
            ) : fortnox ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <p className="text-sm font-medium">{fortnox.count} artiklar finns i Fortnox</p>
                    <p className="text-xs text-muted-foreground">Synkronisering skapar eller uppdaterar artiklar i Traivo per artikelnummer.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchFortnox()}
                      data-testid="button-refresh-fortnox"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => fortnoxSyncMutation.mutate()}
                      disabled={fortnoxSyncMutation.isPending}
                      data-testid="button-sync-fortnox-articles"
                    >
                      {fortnoxSyncMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Cloud className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Synka alla artiklar
                    </Button>
                  </div>
                </div>
                {fortnox.sample.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2">Artikelnr</th>
                          <th className="text-left p-2">Beskrivning</th>
                          <th className="text-right p-2">Pris</th>
                          <th className="text-left p-2">Enhet</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fortnox.sample.map((a) => (
                          <tr key={a.articleNumber} className="border-t">
                            <td className="p-2 font-mono">{a.articleNumber}</td>
                            <td className="p-2">{a.description}</td>
                            <td className="p-2 text-right">{a.salesPrice} kr</td>
                            <td className="p-2">{a.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {fortnox.count > fortnox.sample.length && (
                      <p className="text-xs text-muted-foreground p-2 text-center">
                        Förhandsvisar {fortnox.sample.length} av {fortnox.count} artiklar
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
          </TabsContent>
          <TabsContent value="csv" className="pt-4">
            <OnboardingImportPanel
              testId="import-articles"
              endpoint="/api/onboarding/import/articles"
              templateFilename="artiklar-mall.csv"
              templateHeaders={[
                "articleNumber",
                "name",
                "articleType",
                "productionTime",
                "listPrice",
                "cost",
                "unit",
                "executionCode",
              ]}
              templateSample={[
                ["TJ100", "Sluttömning", "tjanst", "30", "650", "300", "st", ""],
                ["VARA01", "Plastsäck 240L", "vara", "0", "120", "60", "st", ""],
              ]}
              invalidateKeys={["/api/articles"]}
              description="Stöder svenska kolumnnamn (artikelnummer, namn, typ, produktionstid, listpris). Pris i kronor."
            />
          </TabsContent>
        </Tabs>
      );

    case "price_lists":
      return (
        <OnboardingImportPanel
          testId="import-price-lists"
          endpoint="/api/onboarding/import/price-lists"
          templateFilename="prislistor-mall.csv"
          templateHeaders={["name", "type", "customer", "discount", "priority"]}
          templateSample={[
            ["Generell prislista 2026", "generell", "", "", "1"],
            ["Stockholms Stad", "kundunik", "12345", "", "10"],
            ["Volymrabatt 15%", "rabattbrev", "12345", "15", "5"],
          ]}
          invalidateKeys={["/api/price-lists"]}
          description="Typ: generell, kundunik eller rabattbrev. Kund kan anges via kundnummer eller namn."
        />
      );

    case "vehicles":
      return (
        <OnboardingImportPanel
          testId="import-vehicles"
          endpoint="/api/onboarding/import/vehicles"
          templateFilename="fordon-mall.csv"
          templateHeaders={[
            "registrationNumber",
            "name",
            "vehicleType",
            "capacityTons",
            "capacityVolume",
            "costCenter",
          ]}
          templateSample={[
            ["ABC123", "Lastbil 1", "lastbil", "12", "20", "100"],
            ["DEF456", "Servicebil", "bil", "1.5", "5", "200"],
          ]}
          invalidateKeys={["/api/vehicles"]}
          description="Fordonstyp: bil, lastbil, minibuss, kranbil. Kapacitet i ton och kubikmeter."
        />
      );

    case "resources":
      return (
        <Alert>
          <UserCircle2 className="h-4 w-4" />
          <AlertTitle>Importera personal via Resurshantering</AlertTitle>
          <AlertDescription>
            Resurser (personal/utförare) hanteras separat. Klicka på <strong>Öppna sida</strong> ovan och använd
            importfunktionen där, eller skapa resurser manuellt.
          </AlertDescription>
        </Alert>
      );

    case "teams":
      return (
        <div className="space-y-4">
          <OnboardingImportPanel
            testId="import-teams"
            endpoint="/api/onboarding/import/teams"
            templateFilename="team-mall.csv"
            templateHeaders={["name", "description", "color", "projectCode"]}
            templateSample={[
              ["Team Nord", "Norra distriktet", "#1B4B6B", "P-NORD"],
              ["Team Syd", "Södra distriktet", "#4A9B9B", "P-SYD"],
            ]}
            invalidateKeys={["/api/teams"]}
            description="Färg som HEX-kod (t.ex. #1B4B6B). Koppla medlemmar på fliken Team efter import."
          />
          <Separator />
          <p className="text-xs text-muted-foreground">
            Efter att team importerats, gå till fliken <strong>Team</strong> ovan för att koppla resurser till varje
            team.
          </p>
        </div>
      );

    case "customers":
      return (
        <Alert>
          <Building2 className="h-4 w-4" />
          <AlertTitle>Importera kunder via Importera-sidan</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Kunder importeras via huvud-importfunktionen som även hanterar objekt och hierarkier (Modus
              2.0-format).
            </p>
            <Link href="/import">
              <Button variant="outline" size="sm" data-testid="button-go-import">
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Öppna Importera-sidan
              </Button>
            </Link>
          </AlertDescription>
        </Alert>
      );

    case "delivery_preferences":
      return (
        <OnboardingImportPanel
          testId="import-delivery-preferences"
          endpoint="/api/onboarding/import/delivery-preferences"
          templateFilename="leveranspreferenser-mall.csv"
          templateHeaders={["customer", "weekday", "starttime", "endtime", "priority", "notes"]}
          templateSample={[
            ["12345", "1", "07:00", "16:00", "preferred", "Måndag tom fredag dagtid"],
            ["12345", "2", "07:00", "16:00", "preferred", ""],
            ["67890", "3", "06:00", "10:00", "strict", "Endast morgon"],
          ]}
          invalidateKeys={["/api/customers"]}
          description="Veckodag 0=söndag…6=lördag. Flera rader per kund aggregeras till ett preferensobjekt. Priority: preferred eller strict."
        />
      );

    default:
      return null;
  }
}
