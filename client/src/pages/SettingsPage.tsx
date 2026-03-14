import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Settings, 
  User, 
  Building2, 
  Clock, 
  Bell, 
  Download, 
  Database,
  Loader2,
  Save,
  Target,
  Timer,
  Calendar,
  AlertTriangle
} from "lucide-react";

interface TenantSettings {
  setupTimeTarget: number;
  slaThresholdMinutes: number;
  workdayStart: string;
  workdayEnd: string;
  defaultJobDuration: number;
  bufferBetweenJobs: number;
  emailNotifications: boolean;
  scheduleNotifications: boolean;
  urgentNotifications: boolean;
}

const DEFAULT_SETTINGS: TenantSettings = {
  setupTimeTarget: 5,
  slaThresholdMinutes: 15,
  workdayStart: "07:00",
  workdayEnd: "16:00",
  defaultJobDuration: 30,
  bufferBetweenJobs: 10,
  emailNotifications: true,
  scheduleNotifications: true,
  urgentNotifications: true,
};

export default function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<TenantSettings>(DEFAULT_SETTINGS);
  const [profile, setProfile] = useState({
    firstName: "Anna",
    lastName: "Andersson",
    email: "anna@kinab.se",
    phone: "+46701234568",
  });

  const { data: tenant, isLoading } = useQuery<{ id: string; name: string; settings: Partial<TenantSettings> }>({
    queryKey: ["/api/tenant/settings"],
  });

  useEffect(() => {
    if (tenant?.settings) {
      setSettings(prev => ({ ...DEFAULT_SETTINGS, ...prev, ...tenant.settings }));
    }
  }, [tenant]);

  const settingsMutation = useMutation({
    mutationFn: async (newSettings: TenantSettings) => {
      return apiRequest("PATCH", "/api/tenant/settings", newSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/settings"] });
      toast({ title: "Inställningar sparade", description: "Dina ändringar har sparats." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte spara inställningar.", variant: "destructive" });
    },
  });

  const exportMutation = useMutation({
    mutationFn: async (type: string) => {
      const res = await fetch(`/api/export/${type}`);
      if (!res.ok) {
        throw new Error("Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}_export_${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      toast({ title: "Export klar", description: "Filen har laddats ner." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte exportera data.", variant: "destructive" });
    },
  });

  const handleSaveSettings = () => {
    settingsMutation.mutate(settings);
  };

  const updateSetting = <K extends keyof TenantSettings>(key: K, value: TenantSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Settings className="h-6 w-6" />
            Inställningar
          </h1>
          <p className="text-sm text-muted-foreground">Hantera ditt konto, företag och systempreferenser</p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Building2 className="h-3 w-3" />
          Traivo
        </Badge>
      </div>

      <Tabs defaultValue="company" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="company" className="flex items-center gap-2" data-testid="tab-settings-company">
            <Building2 className="h-4 w-4" />
            Företag
          </TabsTrigger>
          <TabsTrigger value="planning" className="flex items-center gap-2" data-testid="tab-settings-planning">
            <Calendar className="h-4 w-4" />
            Planering
          </TabsTrigger>
          <TabsTrigger value="profile" className="flex items-center gap-2" data-testid="tab-settings-profile">
            <User className="h-4 w-4" />
            Profil
          </TabsTrigger>
          <TabsTrigger value="data" className="flex items-center gap-2" data-testid="tab-settings-data">
            <Database className="h-4 w-4" />
            Data
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4" />
                Ställtidsmål
              </CardTitle>
              <CardDescription>
                Målvärden för att mäta effektivitet i fältarbetet
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="setupTimeTarget">Målställtid (minuter)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="setupTimeTarget"
                      type="number"
                      min={1}
                      max={30}
                      value={settings.setupTimeTarget}
                      onChange={(e) => updateSetting("setupTimeTarget", parseInt(e.target.value) || 5)}
                      className="w-24"
                      data-testid="input-setup-time-target"
                    />
                    <span className="text-sm text-muted-foreground">min</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Genomsnittlig målställtid per jobb
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slaThreshold">SLA-tröskel (minuter)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="slaThreshold"
                      type="number"
                      min={5}
                      max={60}
                      value={settings.slaThresholdMinutes}
                      onChange={(e) => updateSetting("slaThresholdMinutes", parseInt(e.target.value) || 15)}
                      className="w-24"
                      data-testid="input-sla-threshold"
                    />
                    <span className="text-sm text-muted-foreground">min</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Maximal ställtid innan varning visas
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Arbetstider
              </CardTitle>
              <CardDescription>
                Standardarbetstider för resursplanering
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="workdayStart">Arbetsdag startar</Label>
                  <Input
                    id="workdayStart"
                    type="time"
                    value={settings.workdayStart}
                    onChange={(e) => updateSetting("workdayStart", e.target.value)}
                    data-testid="input-workday-start"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workdayEnd">Arbetsdag slutar</Label>
                  <Input
                    id="workdayEnd"
                    type="time"
                    value={settings.workdayEnd}
                    onChange={(e) => updateSetting("workdayEnd", e.target.value)}
                    data-testid="input-workday-end"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Notifikationer
              </CardTitle>
              <CardDescription>
                Hantera systemnotifikationer
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label>E-postnotifikationer</Label>
                  <p className="text-sm text-muted-foreground">Ta emot uppdateringar via e-post</p>
                </div>
                <Switch 
                  checked={settings.emailNotifications}
                  onCheckedChange={(v) => updateSetting("emailNotifications", v)}
                  data-testid="switch-email-notifications" 
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label>Schemaändringar</Label>
                  <p className="text-sm text-muted-foreground">Notifiera vid ändringar i veckoplaneringen</p>
                </div>
                <Switch 
                  checked={settings.scheduleNotifications}
                  onCheckedChange={(v) => updateSetting("scheduleNotifications", v)}
                  data-testid="switch-schedule-notifications" 
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label className="flex items-center gap-2">
                    Akuta jobb
                    <AlertTriangle className="h-3 w-3 text-orange-500" />
                  </Label>
                  <p className="text-sm text-muted-foreground">Notifiera omedelbart vid akuta jobb</p>
                </div>
                <Switch 
                  checked={settings.urgentNotifications}
                  onCheckedChange={(v) => updateSetting("urgentNotifications", v)}
                  data-testid="switch-urgent-notifications" 
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSaveSettings} disabled={settingsMutation.isPending} data-testid="button-save-company">
              {settingsMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Spara företagsinställningar
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="planning" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Timer className="h-4 w-4" />
                Jobbstandard
              </CardTitle>
              <CardDescription>
                Standardvärden för nya jobb i veckoplaneringen
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="defaultJobDuration">Standardlängd per jobb</Label>
                  <Select
                    value={settings.defaultJobDuration.toString()}
                    onValueChange={(v) => updateSetting("defaultJobDuration", parseInt(v))}
                  >
                    <SelectTrigger data-testid="select-job-duration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minuter</SelectItem>
                      <SelectItem value="30">30 minuter</SelectItem>
                      <SelectItem value="45">45 minuter</SelectItem>
                      <SelectItem value="60">60 minuter</SelectItem>
                      <SelectItem value="90">90 minuter</SelectItem>
                      <SelectItem value="120">2 timmar</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Används som förvalt värde vid skapande av nya jobb
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bufferBetweenJobs">Bufferttid mellan jobb</Label>
                  <Select
                    value={settings.bufferBetweenJobs.toString()}
                    onValueChange={(v) => updateSetting("bufferBetweenJobs", parseInt(v))}
                  >
                    <SelectTrigger data-testid="select-buffer-time">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Ingen buffert</SelectItem>
                      <SelectItem value="5">5 minuter</SelectItem>
                      <SelectItem value="10">10 minuter</SelectItem>
                      <SelectItem value="15">15 minuter</SelectItem>
                      <SelectItem value="30">30 minuter</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Extra tid mellan jobb för förflyttning
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Beräknade värden</CardTitle>
              <CardDescription>
                Baserat på dina inställningar
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-3 bg-muted rounded-md">
                  <p className="text-2xl font-bold">
                    {Math.floor((parseInt(settings.workdayEnd.split(":")[0]) - parseInt(settings.workdayStart.split(":")[0])) * 60 / (settings.defaultJobDuration + settings.bufferBetweenJobs))}
                  </p>
                  <p className="text-xs text-muted-foreground">Jobb per dag</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-md">
                  <p className="text-2xl font-bold">
                    {parseInt(settings.workdayEnd.split(":")[0]) - parseInt(settings.workdayStart.split(":")[0])}h
                  </p>
                  <p className="text-xs text-muted-foreground">Arbetstid</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-md">
                  <p className="text-2xl font-bold">{settings.defaultJobDuration}m</p>
                  <p className="text-xs text-muted-foreground">Per jobb</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-md">
                  <p className="text-2xl font-bold">{settings.bufferBetweenJobs}m</p>
                  <p className="text-xs text-muted-foreground">Buffert</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSaveSettings} disabled={settingsMutation.isPending} data-testid="button-save-planning">
              {settingsMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Spara planeringsinställningar
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Din profil
              </CardTitle>
              <CardDescription>
                Personlig kontoinformation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">Förnamn</Label>
                  <Input 
                    id="firstName" 
                    value={profile.firstName}
                    onChange={(e) => setProfile(p => ({ ...p, firstName: e.target.value }))}
                    data-testid="input-first-name" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Efternamn</Label>
                  <Input 
                    id="lastName" 
                    value={profile.lastName}
                    onChange={(e) => setProfile(p => ({ ...p, lastName: e.target.value }))}
                    data-testid="input-last-name" 
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-post</Label>
                <Input 
                  id="email" 
                  type="email" 
                  value={profile.email}
                  onChange={(e) => setProfile(p => ({ ...p, email: e.target.value }))}
                  data-testid="input-email" 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefon</Label>
                <Input 
                  id="phone" 
                  value={profile.phone}
                  onChange={(e) => setProfile(p => ({ ...p, phone: e.target.value }))}
                  data-testid="input-phone" 
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Utseende</CardTitle>
              <CardDescription>Anpassa hur applikationen ser ut</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label>Tema</Label>
                  <p className="text-sm text-muted-foreground">Välj mellan ljust och mörkt tema</p>
                </div>
                <ThemeToggle />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button data-testid="button-save-profile">
              <Save className="h-4 w-4 mr-2" />
              Spara profil
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="data" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Download className="h-4 w-4" />
                Exportera data
              </CardTitle>
              <CardDescription>
                Ladda ner data som CSV-filer
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Button 
                  variant="outline" 
                  onClick={() => exportMutation.mutate("customers")}
                  disabled={exportMutation.isPending}
                  className="justify-start"
                  data-testid="button-export-customers"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Exportera kunder
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => exportMutation.mutate("objects")}
                  disabled={exportMutation.isPending}
                  className="justify-start"
                  data-testid="button-export-objects"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Exportera objekt
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => exportMutation.mutate("resources")}
                  disabled={exportMutation.isPending}
                  className="justify-start"
                  data-testid="button-export-resources"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Exportera resurser
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4" />
                Företagsinformation
              </CardTitle>
              <CardDescription>Information om Traivo</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Företagsnamn</span>
                <span>Traivo</span>
              </div>
              <Separator />
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Plan</span>
                <Badge variant="secondary">Pro (Prototyp)</Badge>
              </div>
              <Separator />
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Användare</span>
                <span>4 av 10</span>
              </div>
              <Separator />
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Datalagring</span>
                <span>Sverige (EU)</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
