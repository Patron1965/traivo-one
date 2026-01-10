import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Download, CreditCard, Calendar, AlertCircle } from "lucide-react";
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

function InvoiceStatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    paid: { label: "Betald", variant: "default" },
    unpaid: { label: "Obetald", variant: "secondary" },
    overdue: { label: "Förfallen", variant: "destructive" },
    cancelled: { label: "Makulerad", variant: "outline" },
  };
  const config = statusMap[status] || { label: status, variant: "secondary" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export default function PortalInvoicesPage() {
  const [, setLocation] = useLocation();
  const tenant = getTenant();

  const invoicesQuery = useQuery<any[]>({
    queryKey: ["/api/portal/invoices"],
    queryFn: () => portalFetch("/api/portal/invoices"),
    enabled: !!getSessionToken(),
  });

  if (!getSessionToken()) {
    setLocation("/portal");
    return null;
  }

  const invoices = invoicesQuery.data || [];
  const unpaidCount = invoices.filter(i => i.status === "unpaid" || i.status === "overdue").length;
  const totalUnpaid = invoices
    .filter(i => i.status === "unpaid" || i.status === "overdue")
    .reduce((sum, i) => sum + (i.totalAmount || 0), 0);

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
            <h1 className="text-sm font-semibold">Mina fakturor</h1>
            <span className="text-xs text-muted-foreground">{tenant?.name}</span>
          </div>
        </div>
      </header>

      <main className="container py-8 space-y-6">
        {unpaidCount > 0 && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-amber-500/10">
                <AlertCircle className="h-6 w-6 text-amber-500" />
              </div>
              <div>
                <h3 className="font-semibold">Obetalda fakturor</h3>
                <p className="text-sm text-muted-foreground">
                  Du har {unpaidCount} obetald{unpaidCount > 1 ? "a" : ""} faktura{unpaidCount > 1 ? "or" : ""} på totalt {totalUnpaid.toLocaleString("sv-SE")} kr
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Fakturor
            </CardTitle>
            <CardDescription>Dina fakturor och betalningshistorik</CardDescription>
          </CardHeader>
          <CardContent>
            {invoicesQuery.isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Laddar fakturor...</div>
            ) : invoices.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">Inga fakturor ännu</p>
              </div>
            ) : (
              <div className="space-y-3">
                {invoices.map((invoice: any) => (
                  <Card key={invoice.id} className="hover-elevate" data-testid={`invoice-${invoice.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-muted rounded-lg">
                            <FileText className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <div className="font-medium">Faktura {invoice.invoiceNumber}</div>
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                              <Calendar className="h-3 w-3" />
                              {invoice.invoiceDate && format(new Date(invoice.invoiceDate), "d MMM yyyy", { locale: sv })}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="font-semibold">{invoice.totalAmount?.toLocaleString("sv-SE")} {invoice.currency || "SEK"}</div>
                            <InvoiceStatusBadge status={invoice.status} />
                          </div>
                          {invoice.pdfUrl && (
                            <Button variant="outline" size="sm" asChild>
                              <a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer">
                                <Download className="h-4 w-4 mr-1" />
                                PDF
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                      {invoice.description && (
                        <p className="text-sm text-muted-foreground mt-2">{invoice.description}</p>
                      )}
                      {invoice.dueDate && invoice.status !== "paid" && (
                        <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                          <CreditCard className="h-3 w-3" />
                          Förfaller: {format(new Date(invoice.dueDate), "d MMM yyyy", { locale: sv })}
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
