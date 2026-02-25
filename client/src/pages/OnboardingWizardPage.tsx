import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, User, Package, CheckCircle, ArrowRight, ArrowLeft,
  Loader2, Eye, EyeOff, Sparkles, Copy, ExternalLink
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface IndustryPackage {
  id: string;
  slug: string;
  name: string;
  industry: string;
  description: string;
  icon: string;
}

interface OnboardingResult {
  success: boolean;
  tenant: { id: string; name: string; orgNumber: string | null; industry: string | null };
  adminUser: { id: string; email: string; firstName: string | null; lastName: string | null };
  packageSummary: { packageName: string; articlesInstalled: number; metadataInstalled: number; structuralArticlesInstalled: number } | null;
}

const INDUSTRIES = [
  { value: "waste", label: "Avfallshantering" },
  { value: "cleaning", label: "Städtjänster" },
  { value: "property", label: "Fastighetsservice" },
  { value: "other", label: "Annat" },
];

const STEPS = [
  { label: "Företagsinfo", icon: Building2 },
  { label: "Branschpaket", icon: Package },
  { label: "Admin-användare", icon: User },
  { label: "Sammanfattning", icon: CheckCircle },
];

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center gap-1 mb-8">
      {STEPS.map((step, index) => {
        const Icon = step.icon;
        const isActive = index === currentStep;
        const isCompleted = index < currentStep;
        return (
          <div key={index} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              isActive ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300" :
              isCompleted ? "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300" :
              "bg-muted text-muted-foreground"
            }`}>
              <div className={`flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold ${
                isCompleted ? "bg-green-600 text-white" :
                isActive ? "bg-blue-600 text-white" :
                "bg-muted-foreground/30 text-muted-foreground"
              }`}>
                {isCompleted ? <CheckCircle className="h-3.5 w-3.5" /> : index + 1}
              </div>
              <Icon className="h-4 w-4 hidden sm:block" />
              <span className="text-xs font-medium hidden md:block">{step.label}</span>
            </div>
            {index < STEPS.length - 1 && (
              <ArrowRight className="h-4 w-4 text-muted-foreground mx-1" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function OnboardingWizardPage() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [copied, setCopied] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [orgNumber, setOrgNumber] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [industry, setIndustry] = useState("");

  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);

  const [adminFirstName, setAdminFirstName] = useState("");
  const [adminLastName, setAdminLastName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const { data: packages = [] } = useQuery<IndustryPackage[]>({
    queryKey: ["/api/system/industry-packages"],
  });

  const onboardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/system/onboard-tenant", {
        company: {
          name: companyName,
          orgNumber: orgNumber || undefined,
          contactEmail: contactEmail || undefined,
          contactPhone: contactPhone || undefined,
          industry: industry || undefined,
        },
        industryPackageId: selectedPackageId || undefined,
        adminUser: {
          email: adminEmail,
          password: adminPassword,
          firstName: adminFirstName || undefined,
          lastName: adminLastName || undefined,
        },
      });
      return res.json() as Promise<OnboardingResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      toast({
        title: "Företagskonto skapat",
        description: `${data.tenant.name} har skapats framgångsrikt`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Fel vid skapande",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const canProceed = () => {
    switch (currentStep) {
      case 0: return companyName.trim().length > 0;
      case 1: return true;
      case 2: return adminEmail.trim().length > 0 && adminPassword.length >= 6;
      case 3: return true;
      default: return false;
    }
  };

  const handleNext = () => {
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    } else {
      onboardMutation.mutate();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const copyCredentials = () => {
    const text = `Företag: ${result?.tenant.name}\nE-post: ${adminEmail}\nLösenord: ${adminPassword}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Kopierat", description: "Inloggningsuppgifter kopierade till urklipp" });
  };

  const resetWizard = () => {
    setCurrentStep(0);
    setResult(null);
    setCompanyName("");
    setOrgNumber("");
    setContactEmail("");
    setContactPhone("");
    setIndustry("");
    setSelectedPackageId(null);
    setAdminFirstName("");
    setAdminLastName("");
    setAdminEmail("");
    setAdminPassword("");
  };

  if (result) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center h-16 w-16 rounded-full bg-green-100 dark:bg-green-950 mx-auto">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold" data-testid="text-onboarding-success">Företagskonto skapat!</h1>
          <p className="text-muted-foreground">{result.tenant.name} är redo att användas</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Företagsinfo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Företagsnamn</span>
              <span className="font-medium">{result.tenant.name}</span>
            </div>
            {result.tenant.orgNumber && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Org.nr</span>
                <span className="font-medium">{result.tenant.orgNumber}</span>
              </div>
            )}
            {result.tenant.industry && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bransch</span>
                <span className="font-medium">{INDUSTRIES.find(i => i.value === result.tenant.industry)?.label || result.tenant.industry}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inloggningsuppgifter</CardTitle>
            <CardDescription>Skicka dessa till kundens administratör</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-muted p-4 rounded-lg space-y-2 font-mono text-sm">
              <div><span className="text-muted-foreground">E-post:</span> {adminEmail}</div>
              <div><span className="text-muted-foreground">Lösenord:</span> {adminPassword}</div>
            </div>
            <Button variant="outline" size="sm" onClick={copyCredentials} data-testid="button-copy-credentials">
              {copied ? <CheckCircle className="h-4 w-4 mr-2 text-green-600" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? "Kopierat!" : "Kopiera inloggningsuppgifter"}
            </Button>
          </CardContent>
        </Card>

        {result.packageSummary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Installerat branschpaket</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-lg font-bold text-blue-600">{result.packageSummary.articlesInstalled}</div>
                  <div className="text-xs text-muted-foreground">Artiklar</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-purple-600">{result.packageSummary.metadataInstalled}</div>
                  <div className="text-xs text-muted-foreground">Metadata-fält</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-green-600">{result.packageSummary.structuralArticlesInstalled}</div>
                  <div className="text-xs text-muted-foreground">Strukturartiklar</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="pt-6">
            <p className="text-sm font-medium mb-3">Nästa steg</p>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>1. Skicka inloggningsuppgifterna till kunden</p>
              <p>2. Kunden loggar in och importerar sin data via Modus 2.0-importen</p>
              <p>3. Konfigurera eventuella ytterligare inställningar under Företagsinställningar</p>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button variant="outline" onClick={resetWizard} data-testid="button-create-another">
            Skapa ytterligare företag
          </Button>
          <Button asChild data-testid="button-goto-import">
            <a href="/import">
              <ExternalLink className="h-4 w-4 mr-2" />
              Gå till dataimport
            </a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-onboarding-title">Nytt företagskonto</h1>
        <p className="text-muted-foreground">Skapa ett nytt företagskonto med branschpaket och admin-användare</p>
      </div>

      <StepIndicator currentStep={currentStep} />

      {currentStep === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Företagsinformation
            </CardTitle>
            <CardDescription>Grundläggande information om det nya företaget</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company-name">Företagsnamn *</Label>
              <Input
                id="company-name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="t.ex. Städservice Stockholm AB"
                data-testid="input-company-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-number">Organisationsnummer</Label>
              <Input
                id="org-number"
                value={orgNumber}
                onChange={(e) => setOrgNumber(e.target.value)}
                placeholder="t.ex. 556123-4567"
                data-testid="input-org-number"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contact-email">Kontakt-epost</Label>
                <Input
                  id="contact-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="info@foretag.se"
                  data-testid="input-contact-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-phone">Kontakttelefon</Label>
                <Input
                  id="contact-phone"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="08-123 456"
                  data-testid="input-contact-phone"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Bransch</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger id="industry" data-testid="select-industry">
                  <SelectValue placeholder="Välj bransch" />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((ind) => (
                    <SelectItem key={ind.value} value={ind.value}>{ind.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Välj branschpaket
            </CardTitle>
            <CardDescription>
              Branschpaket installerar fördefinierade artiklar, metadata och inställningar. Du kan hoppa över detta steg.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {packages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Inga branschpaket tillgängliga.</p>
                <p className="text-xs mt-1">Skapa branschpaket under Branschpaket-sidan först.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {packages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      selectedPackageId === pkg.id
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                        : "hover:border-muted-foreground/50"
                    }`}
                    onClick={() => setSelectedPackageId(selectedPackageId === pkg.id ? null : pkg.id)}
                    data-testid={`card-package-${pkg.slug}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`flex items-center justify-center h-10 w-10 rounded-lg text-lg ${
                        selectedPackageId === pkg.id ? "bg-blue-100 dark:bg-blue-900" : "bg-muted"
                      }`}>
                        {pkg.icon || "📦"}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{pkg.name}</h3>
                          <Badge variant="secondary" className="text-xs">
                            {INDUSTRIES.find(i => i.value === pkg.industry)?.label || pkg.industry}
                          </Badge>
                          {selectedPackageId === pkg.id && (
                            <Badge variant="default" className="text-xs bg-blue-600">Vald</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{pkg.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedPackageId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPackageId(null)}
                className="text-muted-foreground"
                data-testid="button-clear-package"
              >
                Avmarkera paket (hoppa över)
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {currentStep === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Skapa admin-användare
            </CardTitle>
            <CardDescription>
              Företagets första inloggning — denna användare blir ägare av kontot
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="admin-first-name">Förnamn</Label>
                <Input
                  id="admin-first-name"
                  value={adminFirstName}
                  onChange={(e) => setAdminFirstName(e.target.value)}
                  placeholder="Anna"
                  data-testid="input-admin-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-last-name">Efternamn</Label>
                <Input
                  id="admin-last-name"
                  value={adminLastName}
                  onChange={(e) => setAdminLastName(e.target.value)}
                  placeholder="Andersson"
                  data-testid="input-admin-last-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-email">E-postadress *</Label>
              <Input
                id="admin-email"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@foretag.se"
                data-testid="input-admin-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-password">Lösenord * (minst 6 tecken)</Label>
              <div className="relative">
                <Input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Välj ett säkert lösenord"
                  data-testid="input-admin-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-7 w-7 p-0"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {adminPassword.length > 0 && adminPassword.length < 6 && (
                <p className="text-xs text-red-500">Lösenordet måste vara minst 6 tecken</p>
              )}
            </div>
            <div className="bg-muted/50 p-3 rounded-md text-xs text-muted-foreground">
              Användaren skapas med rollen <strong>Ägare</strong> och får fullständig åtkomst till företagskontot.
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              Bekräfta och skapa
            </CardTitle>
            <CardDescription>
              Kontrollera att allt stämmer innan du skapar företagskontot
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="p-3 bg-muted/50 rounded-lg space-y-1">
                <p className="text-xs text-muted-foreground font-medium">FÖRETAG</p>
                <p className="font-medium">{companyName}</p>
                {orgNumber && <p className="text-sm text-muted-foreground">Org.nr: {orgNumber}</p>}
                {industry && <p className="text-sm text-muted-foreground">Bransch: {INDUSTRIES.find(i => i.value === industry)?.label}</p>}
                {contactEmail && <p className="text-sm text-muted-foreground">{contactEmail}</p>}
                {contactPhone && <p className="text-sm text-muted-foreground">{contactPhone}</p>}
              </div>

              <div className="p-3 bg-muted/50 rounded-lg space-y-1">
                <p className="text-xs text-muted-foreground font-medium">BRANSCHPAKET</p>
                {selectedPackageId ? (
                  <p className="font-medium flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-blue-600" />
                    {packages.find(p => p.id === selectedPackageId)?.name || "Valt paket"}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Inget paket valt — kan installeras senare</p>
                )}
              </div>

              <div className="p-3 bg-muted/50 rounded-lg space-y-1">
                <p className="text-xs text-muted-foreground font-medium">ADMIN-ANVÄNDARE</p>
                <p className="font-medium">
                  {adminFirstName || adminLastName ? `${adminFirstName} ${adminLastName}`.trim() : adminEmail}
                </p>
                <p className="text-sm text-muted-foreground">{adminEmail}</p>
                <p className="text-sm text-muted-foreground">Roll: Ägare</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 0}
          data-testid="button-wizard-back"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Tillbaka
        </Button>

        <Button
          onClick={handleNext}
          disabled={!canProceed() || onboardMutation.isPending}
          data-testid="button-wizard-next"
        >
          {onboardMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Skapar...
            </>
          ) : currentStep === 3 ? (
            <>
              <CheckCircle className="h-4 w-4 mr-2" />
              Skapa företagskonto
            </>
          ) : (
            <>
              Nästa
              <ArrowRight className="h-4 w-4 ml-2" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
