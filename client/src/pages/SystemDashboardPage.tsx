import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Palette, 
  Users, 
  FileText, 
  Loader2,
  Save,
  Check,
  RefreshCw,
  Building2
} from "lucide-react";
import type { BrandingTemplate, TenantBranding, UserTenantRole, AuditLog } from "@shared/schema";

function ColorPreview({ color, label }: { color: string | null | undefined; label: string }) {
  if (!color) return null;
  return (
    <div className="flex items-center gap-2">
      <div 
        className="w-6 h-6 rounded-md border border-border" 
        style={{ backgroundColor: color }}
        data-testid={`color-preview-${label.toLowerCase().replace(/\s/g, '-')}`}
      />
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-xs font-mono">{color}</span>
    </div>
  );
}

function BrandingTab() {
  const { toast } = useToast();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [customBranding, setCustomBranding] = useState({
    companyName: "",
    headingText: "",
    subheadingText: "",
    primaryColor: "",
    secondaryColor: "",
    accentColor: "",
  });

  const { data: templates, isLoading: templatesLoading } = useQuery<BrandingTemplate[]>({
    queryKey: ["/api/system/branding-templates"],
  });

  const { data: currentBranding, isLoading: brandingLoading } = useQuery<TenantBranding | null>({
    queryKey: ["/api/system/tenant-branding"],
  });

  const updateBrandingMutation = useMutation({
    mutationFn: async (data: Partial<TenantBranding> & { templateId?: string }) => {
      return apiRequest("PUT", "/api/system/tenant-branding", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/tenant-branding"] });
      toast({ title: "Varumärke uppdaterat", description: "Ändringarna har sparats." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte spara ändringar.", variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/system/tenant-branding/publish", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/tenant-branding"] });
      toast({ title: "Publicerat", description: "Varumärket är nu live." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte publicera.", variant: "destructive" });
    },
  });

  const handleApplyTemplate = (template: BrandingTemplate) => {
    setSelectedTemplateId(template.id);
    setCustomBranding({
      companyName: currentBranding?.companyName || "",
      headingText: template.defaultHeading || "",
      subheadingText: template.defaultSubheading || "",
      primaryColor: template.primaryColor,
      secondaryColor: template.secondaryColor,
      accentColor: template.accentColor,
    });
  };

  const handleSave = () => {
    updateBrandingMutation.mutate({
      templateId: selectedTemplateId || undefined,
      companyName: customBranding.companyName || undefined,
      headingText: customBranding.headingText || undefined,
      subheadingText: customBranding.subheadingText || undefined,
      primaryColor: customBranding.primaryColor || undefined,
      secondaryColor: customBranding.secondaryColor || undefined,
      accentColor: customBranding.accentColor || undefined,
    });
  };

  if (templatesLoading || brandingLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Aktuellt varumärke
          </CardTitle>
          <CardDescription>
            Nuvarande varumärkesinställningar för din organisation
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currentBranding ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Företagsnamn</Label>
                  <p className="font-medium" data-testid="text-company-name">{currentBranding.companyName || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="flex items-center gap-2">
                    <Badge variant={currentBranding.isPublished ? "default" : "secondary"}>
                      {currentBranding.isPublished ? "Publicerad" : "Utkast"}
                    </Badge>
                    <span className="text-sm text-muted-foreground">v{currentBranding.version}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Rubrik</Label>
                  <p className="font-medium">{currentBranding.headingText || "-"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Underrubrik</Label>
                  <p className="font-medium">{currentBranding.subheadingText || "-"}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 pt-2">
                <ColorPreview color={currentBranding.primaryColor} label="Primär" />
                <ColorPreview color={currentBranding.secondaryColor} label="Sekundär" />
                <ColorPreview color={currentBranding.accentColor} label="Accent" />
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Ingen varumärkesprofil konfigurerad än.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Branschmallar
          </CardTitle>
          <CardDescription>
            Välj en fördefinierad mall baserad på din bransch
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {templates?.map((template) => (
              <Card 
                key={template.id}
                className={`cursor-pointer transition-all hover-elevate ${selectedTemplateId === template.id ? "ring-2 ring-primary" : ""}`}
                onClick={() => handleApplyTemplate(template)}
                data-testid={`card-template-${template.slug}`}
              >
                <CardContent className="p-4">
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <div 
                      className="w-5 h-5 rounded-sm" 
                      style={{ backgroundColor: template.primaryColor }}
                    />
                    <div 
                      className="w-5 h-5 rounded-sm" 
                      style={{ backgroundColor: template.secondaryColor }}
                    />
                    <div 
                      className="w-5 h-5 rounded-sm" 
                      style={{ backgroundColor: template.accentColor }}
                    />
                  </div>
                  <h4 className="font-medium text-sm">{template.name}</h4>
                  <p className="text-xs text-muted-foreground">{template.industry}</p>
                  {selectedTemplateId === template.id && (
                    <Badge variant="outline" className="mt-2">
                      <Check className="h-3 w-3 mr-1" />
                      Vald
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Anpassa</CardTitle>
          <CardDescription>
            Finjustera ditt varumärke med egna inställningar
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">Företagsnamn</Label>
              <Input
                id="companyName"
                value={customBranding.companyName}
                onChange={(e) => setCustomBranding(prev => ({ ...prev, companyName: e.target.value }))}
                placeholder="Ditt företagsnamn"
                data-testid="input-company-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="headingText">Rubrik</Label>
              <Input
                id="headingText"
                value={customBranding.headingText}
                onChange={(e) => setCustomBranding(prev => ({ ...prev, headingText: e.target.value }))}
                placeholder="Huvudrubrik"
                data-testid="input-heading-text"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="subheadingText">Underrubrik</Label>
            <Input
              id="subheadingText"
              value={customBranding.subheadingText}
              onChange={(e) => setCustomBranding(prev => ({ ...prev, subheadingText: e.target.value }))}
              placeholder="Slogan eller tagline"
              data-testid="input-subheading-text"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="primaryColor">Primärfärg</Label>
              <div className="flex gap-2">
                <Input
                  id="primaryColor"
                  type="color"
                  value={customBranding.primaryColor || "#3B82F6"}
                  onChange={(e) => setCustomBranding(prev => ({ ...prev, primaryColor: e.target.value }))}
                  className="w-12 h-9 p-1"
                  data-testid="input-primary-color"
                />
                <Input
                  value={customBranding.primaryColor}
                  onChange={(e) => setCustomBranding(prev => ({ ...prev, primaryColor: e.target.value }))}
                  placeholder="#3B82F6"
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="secondaryColor">Sekundärfärg</Label>
              <div className="flex gap-2">
                <Input
                  id="secondaryColor"
                  type="color"
                  value={customBranding.secondaryColor || "#6366F1"}
                  onChange={(e) => setCustomBranding(prev => ({ ...prev, secondaryColor: e.target.value }))}
                  className="w-12 h-9 p-1"
                  data-testid="input-secondary-color"
                />
                <Input
                  value={customBranding.secondaryColor}
                  onChange={(e) => setCustomBranding(prev => ({ ...prev, secondaryColor: e.target.value }))}
                  placeholder="#6366F1"
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="accentColor">Accentfärg</Label>
              <div className="flex gap-2">
                <Input
                  id="accentColor"
                  type="color"
                  value={customBranding.accentColor || "#F59E0B"}
                  onChange={(e) => setCustomBranding(prev => ({ ...prev, accentColor: e.target.value }))}
                  className="w-12 h-9 p-1"
                  data-testid="input-accent-color"
                />
                <Input
                  value={customBranding.accentColor}
                  onChange={(e) => setCustomBranding(prev => ({ ...prev, accentColor: e.target.value }))}
                  placeholder="#F59E0B"
                  className="flex-1"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={updateBrandingMutation.isPending}
              data-testid="button-save-branding"
            >
              {updateBrandingMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Spara utkast
            </Button>
            <Button
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
              data-testid="button-publish-branding"
            >
              {publishMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Publicera
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UsersTab() {
  const { data: roles, isLoading } = useQuery<UserTenantRole[]>({
    queryKey: ["/api/system/user-roles"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "owner": return "default";
      case "admin": return "secondary";
      case "planner": return "outline";
      case "technician": return "outline";
      default: return "outline";
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "owner": return "Ägare";
      case "admin": return "Administratör";
      case "planner": return "Planerare";
      case "technician": return "Tekniker";
      case "viewer": return "Läsare";
      default: return role;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Användare och roller
        </CardTitle>
        <CardDescription>
          Hantera vem som har åtkomst till systemet och deras behörigheter
        </CardDescription>
      </CardHeader>
      <CardContent>
        {roles && roles.length > 0 ? (
          <div className="space-y-3">
            {roles.map((role) => (
              <div 
                key={role.id} 
                className="flex items-center justify-between p-3 rounded-md border border-border"
                data-testid={`row-user-${role.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">Användare #{role.userId?.slice(-6)}</p>
                    <p className="text-xs text-muted-foreground">
                      Ansluten {role.createdAt ? new Date(role.createdAt).toLocaleDateString('sv-SE') : "-"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={getRoleBadgeVariant(role.role)}>
                    {getRoleLabel(role.role)}
                  </Badge>
                  <Badge variant={role.isActive ? "outline" : "secondary"}>
                    {role.isActive ? "Aktiv" : "Inaktiv"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Inga användare har tilldelats roller än.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Användare får automatiskt roller när de loggar in med Replit-autentisering.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AuditLogsTab() {
  const { data: logs, isLoading, refetch } = useQuery<AuditLog[]>({
    queryKey: ["/api/system/audit-logs"],
  });

  const getActionLabel = (action: string) => {
    switch (action) {
      case "create_branding": return "Skapade varumärke";
      case "update_branding": return "Uppdaterade varumärke";
      case "publish_branding": return "Publicerade varumärke";
      case "create_user_role": return "Skapade användarroll";
      case "update_user_role": return "Uppdaterade användarroll";
      case "delete_user_role": return "Tog bort användarroll";
      default: return action;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Aktivitetslogg
            </CardTitle>
            <CardDescription>
              Historik över ändringar i systemet
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetch()}
            data-testid="button-refresh-logs"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Uppdatera
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {logs && logs.length > 0 ? (
          <div className="space-y-2">
            {logs.map((log) => (
              <div 
                key={log.id} 
                className="flex items-start justify-between p-3 rounded-md border border-border text-sm"
                data-testid={`row-log-${log.id}`}
              >
                <div>
                  <p className="font-medium">{getActionLabel(log.action)}</p>
                  <p className="text-muted-foreground text-xs">
                    {log.resourceType} {log.resourceId ? `#${log.resourceId.slice(-6)}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">
                    {log.createdAt ? new Date(log.createdAt).toLocaleString('sv-SE') : "-"}
                  </p>
                  {log.ipAddress && (
                    <p className="text-xs text-muted-foreground">{log.ipAddress}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Inga loggar att visa.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Aktiviteter loggas automatiskt när ändringar görs.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SystemDashboardPage() {
  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">System Dashboard</h1>
        <p className="text-muted-foreground">
          Konfigurera varumärke, hantera användare och granska aktivitetsloggar
        </p>
      </div>

      <Tabs defaultValue="branding" className="space-y-6">
        <TabsList data-testid="tabs-system-dashboard">
          <TabsTrigger value="branding" data-testid="tab-branding">
            <Palette className="h-4 w-4 mr-2" />
            Varumärke
          </TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">
            <Users className="h-4 w-4 mr-2" />
            Användare
          </TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">
            <FileText className="h-4 w-4 mr-2" />
            Loggar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="branding">
          <BrandingTab />
        </TabsContent>

        <TabsContent value="users">
          <UsersTab />
        </TabsContent>

        <TabsContent value="logs">
          <AuditLogsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
