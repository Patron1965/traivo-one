import { useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Settings, Bell, Mail, Phone, Save, Loader2, CalendarClock, Link as LinkIcon } from "lucide-react";
import { DeliveryPreferencesEditor } from "@/components/DeliveryPreferencesEditor";
import type { DeliveryPreferences } from "@shared/schema";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

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
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || error.message || "Kunde inte hämta inställningar");
  }
  return res.json();
}

export default function PortalSettingsPage() {
  const [, setLocation] = useLocation();
  const tenant = getTenant();
  const customer = getCustomer();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [settings, setSettings] = useState({
    emailNotifications: true,
    smsNotifications: false,
    notifyOnTechnicianOnWay: true,
    notifyOnJobCompleted: true,
    notifyOnInvoice: true,
    notifyOnBookingConfirmation: true,
    preferredContactEmail: "",
    preferredContactPhone: "",
  });

  const settingsQuery = useQuery<any>({
    queryKey: ["/api/portal/notification-settings"],
    queryFn: () => portalFetch("/api/portal/notification-settings"),
    enabled: !!getSessionToken(),
  });

  const deliveryPrefsQuery = useQuery<{ deliveryPreferences: DeliveryPreferences | null }>({
    queryKey: ["/api/portal/delivery-preferences"],
    queryFn: () => portalFetch("/api/portal/delivery-preferences"),
    enabled: !!getSessionToken(),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setSettings({
        emailNotifications: settingsQuery.data.emailNotifications ?? true,
        smsNotifications: settingsQuery.data.smsNotifications ?? false,
        notifyOnTechnicianOnWay: settingsQuery.data.notifyOnTechnicianOnWay ?? true,
        notifyOnJobCompleted: settingsQuery.data.notifyOnJobCompleted ?? true,
        notifyOnInvoice: settingsQuery.data.notifyOnInvoice ?? true,
        notifyOnBookingConfirmation: settingsQuery.data.notifyOnBookingConfirmation ?? true,
        preferredContactEmail: settingsQuery.data.preferredContactEmail || customer?.email || "",
        preferredContactPhone: settingsQuery.data.preferredContactPhone || "",
      });
    }
  }, [settingsQuery.data, customer?.email]);

  const saveMutation = useMutation({
    mutationFn: (data: typeof settings) =>
      portalFetch("/api/portal/notification-settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/notification-settings"] });
      toast({
        title: "Inställningar sparade",
        description: "Dina notifieringsinställningar har uppdaterats.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Kunde inte spara inställningar",
        description: error.message || "Försök igen senare.",
        variant: "destructive",
      });
    },
  });

  if (!getSessionToken()) {
    setLocation("/portal");
    return null;
  }

  const handleSave = () => {
    saveMutation.mutate(settings);
  };

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
            <h1 className="text-sm font-semibold">Inställningar</h1>
            <span className="text-xs text-muted-foreground">{tenant?.name}</span>
          </div>
        </div>
      </header>

      <main className="container py-8 space-y-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Kontaktuppgifter
            </CardTitle>
            <CardDescription>Hur vill du att vi kontaktar dig?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                E-postadress
              </Label>
              <Input
                id="email"
                type="email"
                value={settings.preferredContactEmail}
                onChange={(e) => setSettings({ ...settings, preferredContactEmail: e.target.value })}
                placeholder="din@email.se"
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Telefonnummer
              </Label>
              <Input
                id="phone"
                type="tel"
                value={settings.preferredContactPhone}
                onChange={(e) => setSettings({ ...settings, preferredContactPhone: e.target.value })}
                placeholder="070-123 45 67"
                data-testid="input-phone"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notifieringar
            </CardTitle>
            <CardDescription>Välj vilka notifieringar du vill få</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <h4 className="font-medium text-sm">Notifieringsmetod</h4>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="email-notif">E-postnotifieringar</Label>
                  <p className="text-sm text-muted-foreground">Få notifieringar via e-post</p>
                </div>
                <Switch
                  id="email-notif"
                  checked={settings.emailNotifications}
                  onCheckedChange={(checked) => setSettings({ ...settings, emailNotifications: checked })}
                  data-testid="switch-email"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="sms-notif">SMS-notifieringar</Label>
                  <p className="text-sm text-muted-foreground">Få notifieringar via SMS</p>
                </div>
                <Switch
                  id="sms-notif"
                  checked={settings.smsNotifications}
                  onCheckedChange={(checked) => setSettings({ ...settings, smsNotifications: checked })}
                  data-testid="switch-sms"
                />
              </div>
            </div>

            <div className="border-t pt-4 space-y-4">
              <h4 className="font-medium text-sm">Notifieringshändelser</h4>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="tech-onway">Tekniker på väg</Label>
                  <p className="text-sm text-muted-foreground">När teknikern är på väg till dig</p>
                </div>
                <Switch
                  id="tech-onway"
                  checked={settings.notifyOnTechnicianOnWay}
                  onCheckedChange={(checked) => setSettings({ ...settings, notifyOnTechnicianOnWay: checked })}
                  data-testid="switch-tech-onway"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="job-done">Jobb utfört</Label>
                  <p className="text-sm text-muted-foreground">När ett jobb är slutfört</p>
                </div>
                <Switch
                  id="job-done"
                  checked={settings.notifyOnJobCompleted}
                  onCheckedChange={(checked) => setSettings({ ...settings, notifyOnJobCompleted: checked })}
                  data-testid="switch-job-done"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="invoice">Ny faktura</Label>
                  <p className="text-sm text-muted-foreground">När en ny faktura skickas</p>
                </div>
                <Switch
                  id="invoice"
                  checked={settings.notifyOnInvoice}
                  onCheckedChange={(checked) => setSettings({ ...settings, notifyOnInvoice: checked })}
                  data-testid="switch-invoice"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="booking">Bokningsbekräftelse</Label>
                  <p className="text-sm text-muted-foreground">När en bokning bekräftas</p>
                </div>
                <Switch
                  id="booking"
                  checked={settings.notifyOnBookingConfirmation}
                  onCheckedChange={(checked) => setSettings({ ...settings, notifyOnBookingConfirmation: checked })}
                  data-testid="switch-booking"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5" />
              Leveranspreferenser
            </CardTitle>
            <CardDescription>
              Ställ in önskade slottider, blockerade tider och meddelande till föraren.
              Gäller alla era objekt om inget specifikt anges per objekt.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {deliveryPrefsQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Laddar…</div>
            ) : (
              <DeliveryPreferencesEditor
                entityKind="portal"
                initial={deliveryPrefsQuery.data?.deliveryPreferences ?? null}
                invalidateKeys={[["/api/portal/delivery-preferences"]]}
                customTransport={(method, body) =>
                  portalFetch("/api/portal/delivery-preferences", {
                    method,
                    body: JSON.stringify(body),
                  })
                }
              />
            )}
          </CardContent>
        </Card>

        <PortalObjectDeliveryPrefs portalFetch={portalFetch} />

        <Button 
          className="w-full" 
          size="lg" 
          onClick={handleSave}
          disabled={saveMutation.isPending}
          data-testid="button-save"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Spara inställningar
        </Button>
      </main>
    </div>
  );
}

type PortalObject = { id: string; name: string; address: string | null; city: string | null };

function PortalObjectDeliveryPrefs({
  portalFetch,
}: {
  portalFetch: (url: string, options?: RequestInit) => Promise<any>;
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const objectsQuery = useQuery<PortalObject[]>({
    queryKey: ["/api/portal/objects"],
    queryFn: () => portalFetch("/api/portal/objects"),
    enabled: !!getSessionToken(),
  });
  const prefsQuery = useQuery<{
    deliveryPreferences: DeliveryPreferences | null;
    fallback?: DeliveryPreferences | null;
  }>({
    queryKey: ["/api/portal/objects", selectedId, "delivery-preferences"],
    queryFn: () => portalFetch(`/api/portal/objects/${selectedId}/delivery-preferences`),
    enabled: !!selectedId,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          Leveranspreferenser per objekt
        </CardTitle>
        <CardDescription>
          Sätt specifika slottider och blockerade tider per objekt. Objektets inställningar går
          före kundens när de finns.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="portal-object-select">Välj objekt</Label>
          <select
            id="portal-object-select"
            data-testid="select-portal-object"
            className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-foreground"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">— Välj ett objekt —</option>
            {(objectsQuery.data || []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} {o.address ? `· ${o.address}` : ""}
              </option>
            ))}
          </select>
        </div>
        {selectedId && prefsQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Laddar…</div>
        ) : selectedId ? (
          (() => {
            const ownPrefs = prefsQuery.data?.deliveryPreferences ?? null;
            // Task #1142: visa kundens faktiska ärvda värden read-only när objektet
            // saknar egna, så arvet blir tydligt för kunden (samma UX som interna
            // objektsidan).
            const fallbackPrefs = !ownPrefs ? prefsQuery.data?.fallback ?? null : null;
            const sourceBadge = ownPrefs ? (
              <Badge variant="secondary" className="text-[10px]" data-testid="badge-portal-delivery-prefs-source">
                Egen
              </Badge>
            ) : fallbackPrefs ? (
              <Badge
                variant="outline"
                className="text-[10px] inline-flex items-center gap-1"
                data-testid="badge-portal-delivery-prefs-source"
              >
                <LinkIcon className="h-3 w-3" /> Ärvd från kund
              </Badge>
            ) : undefined;
            return (
              <DeliveryPreferencesEditor
                entityKind="portal"
                initial={ownPrefs}
                fallback={fallbackPrefs}
                sourceBadge={sourceBadge}
                invalidateKeys={[["/api/portal/objects", selectedId, "delivery-preferences"]]}
                customTransport={(method, body) =>
                  portalFetch(`/api/portal/objects/${selectedId}/delivery-preferences`, {
                    method,
                    body: JSON.stringify(body),
                  })
                }
              />
            );
          })()
        ) : null}
      </CardContent>
    </Card>
  );
}
