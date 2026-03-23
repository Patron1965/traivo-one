import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTenantBranding } from "@/components/TenantBrandingProvider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, MapPin, Clock, User, LogOut, Plus, Loader2, CalendarDays, History, FileText, MessageCircle, Send, Grid3X3, Truck, AlertCircle, RefreshCw, CheckCircle2, ArrowRight, Sparkles, Package, Phone, Trash2, Recycle, TreeDeciduous, Star, Camera } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, differenceInDays, isAfter } from "date-fns";
import { sv } from "date-fns/locale";
import { VisitFeedback } from "@/components/portal/VisitFeedback";
import { WorkOrderChat } from "@/components/portal/WorkOrderChat";
import { SelfBookingWidget } from "@/components/portal/SelfBookingWidget";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 10) return "God morgon";
  if (hour < 18) return "Hej";
  return "God kväll";
}

const bookingSchema = z.object({
  requestType: z.string().min(1, "Välj typ av förfrågan"),
  objectId: z.string().optional(),
  preferredDate1: z.string().optional(),
  preferredDate2: z.string().optional(),
  preferredTimeSlot: z.string().optional(),
  customerNotes: z.string().optional(),
});

type BookingForm = z.infer<typeof bookingSchema>;

function getSessionToken(): string | null {
  return localStorage.getItem("portal_session");
}

function getCustomer(): { id: string; name: string; email: string } | null {
  const data = localStorage.getItem("portal_customer");
  return data ? JSON.parse(data) : null;
}

function getTenant(): { id: string; name: string } | null {
  const data = localStorage.getItem("portal_tenant");
  return data ? JSON.parse(data) : null;
}

async function portalFetch(url: string, options: RequestInit = {}) {
  const token = getSessionToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
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
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Något gick fel");
  }
  return res.json();
}

function StatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    skapad: { label: "Skapad", variant: "secondary" },
    planerad_pre: { label: "Förplanerad", variant: "secondary" },
    planerad_resurs: { label: "Planerad", variant: "default" },
    planerad_las: { label: "Låst", variant: "default" },
    utford: { label: "Utförd", variant: "outline" },
    fakturerad: { label: "Fakturerad", variant: "outline" },
    omojlig: { label: "Omöjlig", variant: "destructive" },
    avbruten: { label: "Avbruten", variant: "destructive" },
  };

  const config = statusMap[status] || { label: status, variant: "secondary" as const };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function BookingRequestStatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    pending: { label: "Väntar", variant: "secondary" },
    confirmed: { label: "Bekräftad", variant: "default" },
    rejected: { label: "Avvisad", variant: "destructive" },
    cancelled: { label: "Avbokad", variant: "outline" },
  };

  const config = statusMap[status] || { label: status, variant: "secondary" as const };

  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export default function PortalDashboardPage() {
  const { companyName, logoIconUrl, primaryColor } = useTenantBranding();
  const [, setLocation] = useLocation();
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [issueForm, setIssueForm] = useState({
    issueType: "",
    title: "",
    description: "",
    objectId: "",
  });
  const queryClient = useQueryClient();
  const customer = getCustomer();
  const tenant = getTenant();

  const form = useForm<BookingForm>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      requestType: "",
      objectId: "",
      preferredDate1: "",
      preferredDate2: "",
      preferredTimeSlot: "",
      customerNotes: "",
    },
  });

  const ordersQuery = useQuery({
    queryKey: ["/api/portal/orders"],
    queryFn: () => portalFetch("/api/portal/orders"),
    enabled: !!getSessionToken(),
  });

  const objectsQuery = useQuery({
    queryKey: ["/api/portal/objects"],
    queryFn: () => portalFetch("/api/portal/objects"),
    enabled: !!getSessionToken(),
  });

  const bookingRequestsQuery = useQuery({
    queryKey: ["/api/portal/booking-requests"],
    queryFn: () => portalFetch("/api/portal/booking-requests"),
    enabled: !!getSessionToken(),
  });

  const messagesQuery = useQuery<Array<{ id: string; message: string; sender: "customer" | "staff"; createdAt: string }>>({
    queryKey: ["/api/portal/messages"],
    queryFn: () => portalFetch("/api/portal/messages"),
    enabled: !!getSessionToken() && chatOpen,
    refetchInterval: chatOpen ? 10000 : false,
  });

  const sendMessageMutation = useMutation({
    mutationFn: (message: string) =>
      portalFetch("/api/portal/messages", {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/messages"] });
      setChatMessage("");
    },
  });

  const createBookingMutation = useMutation({
    mutationFn: (data: BookingForm) =>
      portalFetch("/api/portal/booking-requests", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/booking-requests"] });
      setBookingDialogOpen(false);
      form.reset();
    },
  });

  const createIssueReportMutation = useMutation({
    mutationFn: (data: typeof issueForm) =>
      portalFetch("/api/portal/issue-reports", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      setIssueDialogOpen(false);
      setIssueForm({ issueType: "", title: "", description: "", objectId: "" });
    },
  });

  const handleLogout = async () => {
    const token = getSessionToken();
    if (token) {
      await fetch("/api/portal/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }
    localStorage.removeItem("portal_session");
    localStorage.removeItem("portal_customer");
    localStorage.removeItem("portal_tenant");
    setLocation("/portal");
  };

  if (!getSessionToken()) {
    setLocation("/portal");
    return null;
  }

  const upcoming = ordersQuery.data?.upcoming || [];
  const history = ordersQuery.data?.history || [];
  const objects = objectsQuery.data || [];
  const bookingRequests = bookingRequestsQuery.data || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-4">
            {logoIconUrl ? (
              <img 
                src={logoIconUrl} 
                alt={companyName} 
                className="h-8 w-8 object-contain"
                data-testid="img-portal-dashboard-logo"
              />
            ) : (
              <div 
                className="h-8 w-8 rounded-md flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: primaryColor }}
                data-testid="img-portal-dashboard-logo-fallback"
              >
                {companyName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex items-center gap-3">
              <User className="h-5 w-5 text-primary" />
              <div>
                <h1 className="text-sm font-semibold leading-none">{customer?.name}</h1>
                <span className="text-xs text-muted-foreground">{tenant?.name}</span>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
            <LogOut className="h-4 w-4 mr-2" />
            Logga ut
          </Button>
        </div>
      </header>

      <main className="container py-8 space-y-8">
        {/* Welcome Hero Section */}
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary/20 via-primary/10 to-background border border-primary/20 p-6 sm:p-8">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium text-primary">{companyName} Kundportal</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold mb-2">{getGreeting()}, {customer?.name?.split(" ")[0]}!</h2>
            <p className="text-muted-foreground max-w-xl">
              Välkommen till {companyName}. Här kan du enkelt hantera dina tjänster, 
              boka extra tömningar och kontakta oss.
            </p>
          </div>
        </div>

        {/* Quick Actions Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card 
            className="hover-elevate cursor-pointer group"
            onClick={() => {
              form.setValue("requestType", "extra_service");
              setBookingDialogOpen(true);
            }}
            data-testid="card-quick-extra"
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <Truck className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Boka extratömning</h3>
                <p className="text-sm text-muted-foreground">Behöver du extra hämtning?</p>
              </div>
            </CardContent>
          </Card>
          
          <Card 
            className="hover-elevate cursor-pointer group"
            onClick={() => {
              form.setValue("requestType", "reschedule");
              setBookingDialogOpen(true);
            }}
            data-testid="card-quick-reschedule"
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-blue-500/10 group-hover:bg-blue-500/20 transition-colors">
                <RefreshCw className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <h3 className="font-semibold">Ändra bokning</h3>
                <p className="text-sm text-muted-foreground">Flytta eller ändra tid</p>
              </div>
            </CardContent>
          </Card>
          
          <Card 
            className="hover-elevate cursor-pointer group"
            onClick={() => setChatOpen(true)}
            data-testid="card-quick-contact"
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-green-500/10 group-hover:bg-green-500/20 transition-colors">
                <MessageCircle className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <h3 className="font-semibold">Kontakta oss</h3>
                <p className="text-sm text-muted-foreground">Chatta med kundtjänst</p>
              </div>
            </CardContent>
          </Card>
          
          <Card 
            className="hover-elevate cursor-pointer group"
            onClick={() => setBookingDialogOpen(true)}
            data-testid="card-quick-new"
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-purple-500/10 group-hover:bg-purple-500/20 transition-colors">
                <Plus className="h-6 w-6 text-purple-500" />
              </div>
              <div>
                <h3 className="font-semibold">Ny förfrågan</h3>
                <p className="text-sm text-muted-foreground">Skicka önskemål till oss</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Statistics Row */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Card className="bg-gradient-to-br from-green-500/10 to-transparent">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{history.length}</div>
                  <div className="text-xs text-muted-foreground">Utförda besök</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-500/10 to-transparent">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <CalendarDays className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{upcoming.length}</div>
                  <div className="text-xs text-muted-foreground">Kommande besök</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Link href="/portal/clusters">
            <Card className="bg-gradient-to-br from-purple-500/10 to-transparent hover-elevate cursor-pointer group" data-testid="card-cluster-overview">
              <CardContent className="p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/20 rounded-lg group-hover:bg-purple-500/30 transition-colors">
                    <TreeDeciduous className="h-5 w-5 text-purple-500" />
                  </div>
                  <div className="flex-1">
                    <div className="text-2xl font-bold">{objects.length}</div>
                    <div className="text-xs text-muted-foreground">Dina platser</div>
                  </div>
                  <div className="flex flex-col items-end">
                    <ArrowRight className="h-4 w-4 text-purple-500" />
                    <span className="text-xs text-purple-500 font-medium">Visa alla</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Card className="bg-gradient-to-br from-orange-500/10 to-transparent">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500/20 rounded-lg">
                  <FileText className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold">
                    {bookingRequests.filter((r: any) => r.status === "pending").length}
                  </div>
                  <div className="text-xs text-muted-foreground">Öppna ärenden</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* AI Insights Card */}
        <Card className="bg-gradient-to-r from-purple-500/10 via-blue-500/5 to-transparent border-purple-500/20" data-testid="card-ai-insights">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              <CardTitle className="text-lg">Smarta tips</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {upcoming.length > 0 && upcoming[0]?.scheduledDate ? (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50" data-testid="insight-next-visit">
                  <div className="p-1.5 bg-blue-500/10 rounded-md">
                    <CalendarDays className="h-4 w-4 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Påminnelse</p>
                    <p className="text-xs text-muted-foreground">
                      Ditt nästa besök är planerat. Se till att kärlen är tillgängliga.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50" data-testid="insight-no-visits">
                  <div className="p-1.5 bg-green-500/10 rounded-md">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Allt klart just nu</p>
                    <p className="text-xs text-muted-foreground">
                      Inga kommande besök bokade. Vill du boka en tjänst?
                    </p>
                  </div>
                </div>
              )}
              {history.length >= 3 ? (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50" data-testid="insight-history">
                  <div className="p-1.5 bg-green-500/10 rounded-md">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Bra samarbete!</p>
                    <p className="text-xs text-muted-foreground">
                      Totalt {history.length} besök har genomförts. Tack för förtroendet!
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50" data-testid="insight-welcome">
                  <div className="p-1.5 bg-primary/10 rounded-md">
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Välkommen!</p>
                    <p className="text-xs text-muted-foreground">
                      Här kan du hantera dina tjänster och se kommande besök.
                    </p>
                  </div>
                </div>
              )}
              {objects.length > 1 && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50" data-testid="insight-objects">
                  <div className="p-1.5 bg-purple-500/10 rounded-md">
                    <Grid3X3 className="h-4 w-4 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Översikt</p>
                    <p className="text-xs text-muted-foreground">
                      Du har {objects.length} registrerade platser. Visa alla i klusteröversikten.
                    </p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50" data-testid="insight-contact">
                <div className="p-1.5 bg-amber-500/10 rounded-md">
                  <Phone className="h-4 w-4 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">Kontaktinfo uppdaterad?</p>
                  <p className="text-xs text-muted-foreground">
                    Kontrollera att din e-post och telefon är korrekt för aviseringar.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Self-Service Navigation */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/portal/invoices">
            <Card className="hover-elevate cursor-pointer group" data-testid="card-invoices">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-amber-500/10 group-hover:bg-amber-500/20 transition-colors">
                  <FileText className="h-6 w-6 text-amber-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">Fakturor</h3>
                  <p className="text-sm text-muted-foreground">Visa och ladda ner</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          
          <Link href="/portal/contracts">
            <Card className="hover-elevate cursor-pointer group" data-testid="card-contracts">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-teal-500/10 group-hover:bg-teal-500/20 transition-colors">
                  <Package className="h-6 w-6 text-teal-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">Tjänsteavtal</h3>
                  <p className="text-sm text-muted-foreground">Dina abonnemang</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          
          <Link href="/portal/issues">
            <Card className="hover-elevate cursor-pointer group" data-testid="card-issues">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-red-500/10 group-hover:bg-red-500/20 transition-colors">
                  <AlertCircle className="h-6 w-6 text-red-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">Mina ärenden</h3>
                  <p className="text-sm text-muted-foreground">Felanmälan och support</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          
          <Link href="/portal/field">
            <Card className="hover-elevate cursor-pointer group" data-testid="card-field-docs">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-teal-500/10 group-hover:bg-teal-500/20 transition-colors">
                  <Camera className="h-6 w-6 text-teal-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">Fältdokumentation</h3>
                  <p className="text-sm text-muted-foreground">QR-skanning, foto & rapporter</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          
          <Link href="/portal/settings">
            <Card className="hover-elevate cursor-pointer group" data-testid="card-settings">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-slate-500/10 group-hover:bg-slate-500/20 transition-colors">
                  <User className="h-6 w-6 text-slate-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">Inställningar</h3>
                  <p className="text-sm text-muted-foreground">Profil och notiser</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Next Visit Highlight Card */}
        {upcoming.length > 0 && (
          <Card className="bg-gradient-to-r from-primary/10 to-transparent border-primary/30">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Truck className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">Nästa planerade besök</CardTitle>
                </div>
                <StatusBadge status={upcoming[0].status} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-full">
                    <CalendarDays className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Datum</div>
                    <div className="font-medium">
                      {upcoming[0].scheduledDate 
                        ? format(new Date(upcoming[0].scheduledDate), "EEEE d MMMM", { locale: sv })
                        : "Ej bestämt"
                      }
                    </div>
                    {upcoming[0].scheduledDate && (
                      <div className="text-xs text-muted-foreground">
                        {(() => {
                          const days = differenceInDays(new Date(upcoming[0].scheduledDate), new Date());
                          if (days === 0) return "Idag!";
                          if (days === 1) return "Imorgon";
                          if (days < 0) return "";
                          return `Om ${days} dagar`;
                        })()}
                      </div>
                    )}
                  </div>
                </div>
                
                {upcoming[0].scheduledTime && (
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <Clock className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Tid</div>
                      <div className="font-medium">{upcoming[0].scheduledTime}</div>
                    </div>
                  </div>
                )}

                {upcoming[0].objectAddress && (
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <MapPin className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Adress</div>
                      <div className="font-medium line-clamp-1">{upcoming[0].objectAddress}</div>
                    </div>
                  </div>
                )}

                {upcoming[0].resourceName && (
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-full">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Tekniker</div>
                      <div className="font-medium">{upcoming[0].resourceName}</div>
                    </div>
                  </div>
                )}
              </div>

              {upcoming[0].title && (
                <div className="mt-4 pt-3 border-t">
                  <span className="text-sm font-medium">{upcoming[0].title}</span>
                  {upcoming[0].description && (
                    <span className="text-sm text-muted-foreground ml-2">— {upcoming[0].description}</span>
                  )}
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    form.setValue("requestType", "reschedule");
                    setBookingDialogOpen(true);
                  }}
                  data-testid="button-reschedule-next"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Ändra tid
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => {
                    form.setValue("requestType", "cancel");
                    setBookingDialogOpen(true);
                  }}
                  data-testid="button-cancel-next"
                >
                  Avboka
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Self-Booking Widget */}
        <SelfBookingWidget portalFetch={portalFetch} objects={objectsQuery.data || []} />

        {/* Main Content - Mina ärenden Section */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <CardTitle className="text-lg">Mina ärenden</CardTitle>
              <div className="flex items-center gap-2">
                <Link href="/portal/clusters">
                  <Button variant="outline" size="sm" data-testid="button-view-clusters">
                    <TreeDeciduous className="h-4 w-4 mr-2" />
                    Visa kluster
                  </Button>
                </Link>
                <Dialog open={bookingDialogOpen} onOpenChange={setBookingDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-new-booking">
                      <Plus className="h-4 w-4 mr-2" />
                      Ny förfrågan
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Ny bokningsförfrågan</DialogTitle>
                <DialogDescription>
                  Skicka en förfrågan om ny bokning, ombokning eller avbokning
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((data) => createBookingMutation.mutate(data))} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="requestType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Typ av förfrågan</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-request-type">
                              <SelectValue placeholder="Välj typ" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="new_booking">Ny bokning</SelectItem>
                            <SelectItem value="reschedule">Omboka befintlig</SelectItem>
                            <SelectItem value="cancel">Avboka</SelectItem>
                            <SelectItem value="extra_service">Extra tjänst</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {objects.length > 0 && (
                    <FormField
                      control={form.control}
                      name="objectId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Objekt (valfritt)</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-object">
                                <SelectValue placeholder="Välj objekt" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {objects.map((obj: any) => (
                                <SelectItem key={obj.id} value={obj.id}>
                                  {obj.name} - {obj.address}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="preferredDate1"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Önskat datum 1</FormLabel>
                          <FormControl>
                            <Input type="date" data-testid="input-date1" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="preferredDate2"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Önskat datum 2</FormLabel>
                          <FormControl>
                            <Input type="date" data-testid="input-date2" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="preferredTimeSlot"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Önskad tid</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-time-slot">
                              <SelectValue placeholder="Välj tidsintervall" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="morning">Förmiddag (08-12)</SelectItem>
                            <SelectItem value="afternoon">Eftermiddag (12-17)</SelectItem>
                            <SelectItem value="any">Spelar ingen roll</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="customerNotes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Meddelande (valfritt)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Beskriv din förfrågan..."
                            data-testid="input-notes"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {createBookingMutation.error && (
                    <p className="text-sm text-destructive">
                      {createBookingMutation.error.message}
                    </p>
                  )}

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setBookingDialogOpen(false)}
                    >
                      Avbryt
                    </Button>
                    <Button
                      type="submit"
                      disabled={createBookingMutation.isPending}
                      data-testid="button-submit-booking"
                    >
                      {createBookingMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Skickar...
                        </>
                      ) : (
                        "Skicka förfrågan"
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
                </Dialog>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="upcoming" className="space-y-4">
              <TabsList>
              <TabsTrigger value="upcoming" data-testid="tab-upcoming">
                <CalendarDays className="h-4 w-4 mr-2" />
                Kommande
              </TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-history">
                <History className="h-4 w-4 mr-2" />
                Historik
              </TabsTrigger>
              <TabsTrigger value="requests" data-testid="tab-requests">
                <FileText className="h-4 w-4 mr-2" />
                Förfrågningar
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upcoming" className="space-y-4">
            {ordersQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : upcoming.length === 0 ? (
              <Card className="bg-gradient-to-br from-muted/30 to-transparent">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="p-4 bg-primary/10 rounded-full mb-4">
                    <Recycle className="h-10 w-10 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Inga kommande besök just nu</h3>
                  <p className="text-muted-foreground max-w-sm mb-6">
                    Det finns inga planerade tömningar. Behöver du boka en extra tömning eller annan tjänst?
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        form.setValue("requestType", "extra_service");
                        setBookingDialogOpen(true);
                      }}
                      data-testid="button-book-empty"
                    >
                      <Truck className="h-4 w-4 mr-2" />
                      Boka extratömning
                    </Button>
                    <Button variant="outline" onClick={() => setChatOpen(true)}>
                      <MessageCircle className="h-4 w-4 mr-2" />
                      Kontakta oss
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {upcoming.map((order: any) => (
                  <Card key={order.id} data-testid={`card-order-${order.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{order.title}</CardTitle>
                        <StatusBadge status={order.status} />
                      </div>
                      {order.description && (
                        <CardDescription className="line-clamp-2">
                          {order.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {order.scheduledDate && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          <span>
                            {format(new Date(order.scheduledDate), "EEEE d MMMM yyyy", { locale: sv })}
                          </span>
                        </div>
                      )}
                      {order.scheduledTime && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          <span>{order.scheduledTime}</span>
                        </div>
                      )}
                      {order.objectAddress && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          <span>{order.objectAddress}</span>
                        </div>
                      )}
                      {order.resourceName && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <User className="h-4 w-4" />
                          <span>{order.resourceName}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            {ordersQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : history.length === 0 ? (
              <Card className="bg-gradient-to-br from-muted/30 to-transparent">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="p-4 bg-green-500/10 rounded-full mb-4">
                    <History className="h-10 w-10 text-green-500" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Ingen historik ännu</h3>
                  <p className="text-muted-foreground max-w-sm">
                    Här visas dina tidigare utförda besök och tömningar när de har slutförts.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {history.map((order: any) => (
                  <Card key={order.id} className="opacity-75" data-testid={`card-history-${order.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{order.title}</CardTitle>
                        <StatusBadge status={order.status} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {order.completedAt && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          <span>
                            Utförd {format(new Date(order.completedAt), "d MMM yyyy", { locale: sv })}
                          </span>
                        </div>
                      )}
                      {order.objectAddress && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          <span>{order.objectAddress}</span>
                        </div>
                      )}
                      {order.resourceName && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Truck className="h-4 w-4" />
                          <span>{order.resourceName}</span>
                        </div>
                      )}
                      <VisitFeedback workOrder={order} portalFetch={portalFetch} />
                      <div className="flex items-center gap-2 pt-2">
                        <WorkOrderChat
                          workOrderId={order.id}
                          workOrderTitle={order.title}
                          portalFetch={portalFetch}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="requests" className="space-y-4">
            {bookingRequestsQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : bookingRequests.length === 0 ? (
              <Card className="bg-gradient-to-br from-muted/30 to-transparent">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="p-4 bg-purple-500/10 rounded-full mb-4">
                    <FileText className="h-10 w-10 text-purple-500" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Inga förfrågningar ännu</h3>
                  <p className="text-muted-foreground max-w-sm mb-6">
                    Här visas dina inskickade önskemål och bokningsförfrågningar.
                  </p>
                  <Button
                    variant="default"
                    className="mt-4"
                    onClick={() => setBookingDialogOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Skapa förfrågan
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {bookingRequests.map((request: any) => (
                  <Card key={request.id} data-testid={`card-request-${request.id}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">
                          {request.requestType === "new_booking" && "Ny bokning"}
                          {request.requestType === "reschedule" && "Ombokning"}
                          {request.requestType === "cancel" && "Avbokning"}
                          {request.requestType === "extra_service" && "Extra tjänst"}
                        </CardTitle>
                        <BookingRequestStatusBadge status={request.status} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span>
                          Skapad {format(new Date(request.createdAt), "d MMM yyyy", { locale: sv })}
                        </span>
                      </div>
                      {request.preferredDate1 && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <CalendarDays className="h-4 w-4" />
                          <span>
                            Önskat: {format(new Date(request.preferredDate1), "d MMM", { locale: sv })}
                          </span>
                        </div>
                      )}
                      {request.customerNotes && (
                        <p className="text-muted-foreground line-clamp-2 pt-2 border-t">
                          {request.customerNotes}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {objects.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Mina platser
              </CardTitle>
              <CardDescription>Dina registrerade objekt och adresser</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {objects.map((obj: any) => {
                  const objectUpcoming = upcoming.filter((o: any) => o.objectId === obj.id || o.objectAddress === obj.address);
                  const objectHistory = history.filter((o: any) => o.objectId === obj.id || o.objectAddress === obj.address);
                  const lastVisit = objectHistory[0];
                  const nextVisit = objectUpcoming[0];
                  
                  return (
                    <div key={obj.id} className="p-4 border rounded-lg space-y-3 hover-elevate" data-testid={`object-${obj.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{obj.name}</p>
                        {obj.type && (
                          <Badge variant="secondary" className="text-xs">{obj.type}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="line-clamp-1">{obj.address}</span>
                      </div>
                      {obj.what3words && (
                        <div className="flex items-center gap-2 text-sm">
                          <Grid3X3 className="h-3 w-3 text-red-500 shrink-0" />
                          <a 
                            href={`https://what3words.com/${obj.what3words}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-red-600 hover:underline font-mono text-xs"
                          >
                            ///{obj.what3words}
                          </a>
                        </div>
                      )}
                      
                      <div className="pt-2 border-t space-y-1">
                        {lastVisit ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                            <span>Senast: {format(new Date(lastVisit.completedAt || lastVisit.scheduledDate), "d MMM", { locale: sv })}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>Inget tidigare besök</span>
                          </div>
                        )}
                        {nextVisit ? (
                          <div className="flex items-center gap-2 text-xs font-medium text-primary">
                            <ArrowRight className="h-3 w-3" />
                            <span>Nästa: {format(new Date(nextVisit.scheduledDate), "d MMM", { locale: sv })}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <CalendarDays className="h-3 w-3" />
                            <span>Inget planerat</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Issue Report Dialog */}
      <Dialog open={issueDialogOpen} onOpenChange={setIssueDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              Felanmälan
            </DialogTitle>
            <DialogDescription>
              Rapportera ett problem med dina kärl eller tjänster
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Typ av fel</label>
              <Select
                value={issueForm.issueType}
                onValueChange={(value) => setIssueForm({ ...issueForm, issueType: value })}
              >
                <SelectTrigger data-testid="select-issue-type">
                  <SelectValue placeholder="Välj typ av fel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="damaged_container">Skadat kärl</SelectItem>
                  <SelectItem value="missed_pickup">Missad hämtning</SelectItem>
                  <SelectItem value="access_problem">Åtkomstproblem</SelectItem>
                  <SelectItem value="wrong_placement">Felplacerat kärl</SelectItem>
                  <SelectItem value="other">Annat</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {objects.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Berörd plats (valfritt)</label>
                <Select
                  value={issueForm.objectId}
                  onValueChange={(value) => setIssueForm({ ...issueForm, objectId: value })}
                >
                  <SelectTrigger data-testid="select-issue-object">
                    <SelectValue placeholder="Välj plats" />
                  </SelectTrigger>
                  <SelectContent>
                    {objects.map((obj: any) => (
                      <SelectItem key={obj.id} value={obj.id}>
                        {obj.name} - {obj.address}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Rubrik</label>
              <Input
                value={issueForm.title}
                onChange={(e) => setIssueForm({ ...issueForm, title: e.target.value })}
                placeholder="Beskriv problemet kort"
                data-testid="input-issue-title"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Detaljerad beskrivning</label>
              <Textarea
                value={issueForm.description}
                onChange={(e) => setIssueForm({ ...issueForm, description: e.target.value })}
                placeholder="Beskriv problemet mer utförligt..."
                rows={3}
                data-testid="input-issue-description"
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setIssueDialogOpen(false)}>
                Avbryt
              </Button>
              <Button
                onClick={() => createIssueReportMutation.mutate(issueForm)}
                disabled={!issueForm.issueType || !issueForm.title || createIssueReportMutation.isPending}
                data-testid="button-submit-issue"
              >
                {createIssueReportMutation.isPending ? "Skickar..." : "Skicka felanmälan"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Floating Chat Button */}
      <Button
        size="icon"
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
        onClick={() => setChatOpen(!chatOpen)}
        data-testid="button-chat"
      >
        <MessageCircle className="h-6 w-6" />
      </Button>

      {/* Chat Panel */}
      {chatOpen && (
        <div className="fixed bottom-24 right-6 w-80 sm:w-96 bg-background border rounded-lg shadow-xl z-50 flex flex-col max-h-[60vh]">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Chatta med oss</h3>
              <p className="text-xs text-muted-foreground">Vi svarar så snart vi kan</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setChatOpen(false)} data-testid="button-close-chat">
              ✕
            </Button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]" data-testid="chat-messages">
            {messagesQuery.isLoading ? (
              <div className="text-center text-muted-foreground py-8">
                <p className="text-sm">Laddar meddelanden...</p>
              </div>
            ) : (messagesQuery.data || []).length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Skriv ett meddelande för att starta en konversation</p>
              </div>
            ) : (
              (messagesQuery.data || []).map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === "customer" ? "justify-end" : "justify-start"}`}
                  data-testid={`message-${msg.id}`}
                >
                  <div
                    className={`max-w-[80%] p-3 rounded-lg text-sm ${
                      msg.sender === "customer"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    {msg.message}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 border-t">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!chatMessage.trim() || sendMessageMutation.isPending) return;
                sendMessageMutation.mutate(chatMessage.trim());
              }}
              className="flex gap-2"
            >
              <Input
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Skriv ditt meddelande..."
                className="flex-1"
                data-testid="input-chat"
                disabled={sendMessageMutation.isPending}
              />
              <Button 
                type="submit" 
                size="icon" 
                data-testid="button-send-chat"
                disabled={sendMessageMutation.isPending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
