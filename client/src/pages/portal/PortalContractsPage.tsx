import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileCheck, Calendar, RefreshCw, Package } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

function getSessionToken(): string | null {
  return localStorage.getItem("portal_session");
}

function getTenant(): { id: string; name: string } | null {
  const data = localStorage.getItem("portal_tenant");
  return data ? JSON.parse(data) : null;
}

async function portalFetch(url: string) {
  const token = getSessionToken();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("portal_session");
    localStorage.removeItem("portal_customer");
    localStorage.removeItem("portal_tenant");
    window.location.href = "/portal";
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error("Något gick fel");
  return res.json();
}

function ContractStatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    active: { label: "Aktiv", variant: "default" },
    paused: { label: "Pausad", variant: "secondary" },
    cancelled: { label: "Avslutad", variant: "outline" },
    expired: { label: "Utgången", variant: "destructive" },
  };
  const config = statusMap[status] || { label: status, variant: "secondary" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function BillingCycleLabel({ cycle }: { cycle: string }) {
  const labels: Record<string, string> = {
    monthly: "Månadsvis",
    quarterly: "Kvartalsvis",
    yearly: "Årsvis",
  };
  return <span>{labels[cycle] || cycle}</span>;
}

export default function PortalContractsPage() {
  const [, setLocation] = useLocation();
  const tenant = getTenant();

  const contractsQuery = useQuery<any[]>({
    queryKey: ["/api/portal/service-contracts"],
    queryFn: () => portalFetch("/api/portal/service-contracts"),
    enabled: !!getSessionToken(),
  });

  if (!getSessionToken()) {
    setLocation("/portal");
    return null;
  }

  const contracts = contractsQuery.data || [];
  const activeContracts = contracts.filter(c => c.status === "active");

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center gap-4">
          <Link href="/portal/dashboard">
            <Button variant="ghost" size="sm" data-testid="button-back">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Tillbaka
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-sm font-semibold">Mina tjänsteavtal</h1>
            <span className="text-xs text-muted-foreground">{tenant?.name}</span>
          </div>
        </div>
      </header>

      <main className="container py-8 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="bg-gradient-to-br from-primary/10 to-transparent">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/20 rounded-lg">
                  <FileCheck className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{activeContracts.length}</div>
                  <div className="text-xs text-muted-foreground">Aktiva avtal</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-500/10 to-transparent">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <Package className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{contracts.length}</div>
                  <div className="text-xs text-muted-foreground">Totalt antal avtal</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              Tjänsteavtal
            </CardTitle>
            <CardDescription>Dina aktiva tjänsteavtal och abonnemang</CardDescription>
          </CardHeader>
          <CardContent>
            {contractsQuery.isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Laddar avtal...</div>
            ) : contracts.length === 0 ? (
              <div className="text-center py-12">
                <FileCheck className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">Inga tjänsteavtal registrerade</p>
                <p className="text-sm text-muted-foreground mt-1">Kontakta oss för att upprätta ett avtal</p>
              </div>
            ) : (
              <div className="space-y-4">
                {contracts.map((contract: any) => (
                  <Card key={contract.id} className={contract.status === "active" ? "border-primary/30" : ""} data-testid={`contract-${contract.id}`}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                        <div>
                          <div className="font-semibold text-lg">{contract.name}</div>
                          {contract.contractNumber && (
                            <div className="text-sm text-muted-foreground">Avtalsnr: {contract.contractNumber}</div>
                          )}
                        </div>
                        <ContractStatusBadge status={contract.status} />
                      </div>
                      
                      {contract.description && (
                        <p className="text-sm text-muted-foreground mb-4">{contract.description}</p>
                      )}

                      <div className="grid gap-4 sm:grid-cols-3 text-sm">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="text-muted-foreground">Startdatum</div>
                            <div>{contract.startDate && format(new Date(contract.startDate), "d MMM yyyy", { locale: sv })}</div>
                          </div>
                        </div>
                        {contract.endDate && (
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="text-muted-foreground">Slutdatum</div>
                              <div>{format(new Date(contract.endDate), "d MMM yyyy", { locale: sv })}</div>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <RefreshCw className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="text-muted-foreground">Fakturering</div>
                            <BillingCycleLabel cycle={contract.billingCycle || "monthly"} />
                          </div>
                        </div>
                      </div>

                      {contract.monthlyValue && (
                        <div className="mt-4 pt-4 border-t">
                          <div className="text-sm text-muted-foreground">Månadskostnad</div>
                          <div className="text-xl font-bold">{contract.monthlyValue.toLocaleString("sv-SE")} kr/mån</div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
