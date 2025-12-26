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
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { 
  Palette, 
  Users, 
  FileText, 
  Loader2,
  Save,
  Check,
  RefreshCw,
  Building2,
  Upload,
  Plus,
  Settings,
  Edit,
  Trash2,
  Shield
} from "lucide-react";
import type { BrandingTemplate, TenantBranding, UserTenantRole, AuditLog } from "@shared/schema";

const AVAILABLE_MODULES = [
  { id: "dashboard", label: "Dashboard", description: "KPI:er och nyckeltal" },
  { id: "planner", label: "Veckoplanering", description: "Detaljplanering av arbete" },
  { id: "orders", label: "Orderstock", description: "Orderhantering" },
  { id: "clusters", label: "Kluster", description: "Geografiska arbetsområden" },
  { id: "objects", label: "Objekt", description: "Fastigheter och platser" },
  { id: "resources", label: "Resurser", description: "Personal och kompetenser" },
  { id: "vehicles", label: "Fordon", description: "Fordonsflotta" },
  { id: "routes", label: "Rutter", description: "Ruttoptimering" },
  { id: "economics", label: "Ekonomi", description: "Ekonomisk rapportering" },
  { id: "settings", label: "Inställningar", description: "Systemkonfiguration" },
  { id: "import", label: "Import", description: "Dataimport" },
  { id: "system", label: "System Dashboard", description: "White-label och admin" },
] as const;

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
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<UserTenantRole | null>(null);
  const [newUser, setNewUser] = useState({ email: "", name: "", role: "viewer", permissions: [] as string[] });
  const [importData, setImportData] = useState<Array<{ email: string; name: string; role: string }>>([]);

  const { data: roles, isLoading, refetch } = useQuery<UserTenantRole[]>({
    queryKey: ["/api/system/user-roles"],
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: { email: string; name: string; role: string; permissions: string[] }) => {
      return apiRequest("POST", "/api/system/user-roles", {
        userId: `email:${data.email}`,
        role: data.role,
        permissions: data.permissions,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/user-roles"] });
      toast({ title: "Användare skapad", description: "Användaren har lagts till." });
      setShowAddDialog(false);
      setNewUser({ email: "", name: "", role: "viewer", permissions: [] });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte skapa användare.", variant: "destructive" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { role?: string; permissions?: string[]; isActive?: boolean } }) => {
      return apiRequest("PATCH", `/api/system/user-roles/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/user-roles"] });
      toast({ title: "Användare uppdaterad", description: "Ändringarna har sparats." });
      setEditingUser(null);
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte uppdatera användare.", variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/system/user-roles/${id}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/user-roles"] });
      toast({ title: "Användare borttagen" });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte ta bort användare.", variant: "destructive" });
    },
  });

  const importUsersMutation = useMutation({
    mutationFn: async (users: Array<{ email: string; name: string; role: string }>) => {
      return apiRequest("POST", "/api/system/user-roles/import", { users });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/user-roles"] });
      toast({ title: "Import klar", description: `${data.imported || 0} användare importerade.` });
      setShowImportDialog(false);
      setImportData([]);
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte importera användare.", variant: "destructive" });
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter(line => line.trim());
      const headers = lines[0].toLowerCase().split(/[,;]/).map(h => h.trim());
      
      const emailIdx = headers.findIndex(h => h.includes("email") || h.includes("e-post"));
      const nameIdx = headers.findIndex(h => h.includes("name") || h.includes("namn"));
      const roleIdx = headers.findIndex(h => h.includes("role") || h.includes("roll"));

      const parsed = lines.slice(1).map(line => {
        const cols = line.split(/[,;]/).map(c => c.trim().replace(/^["']|["']$/g, ""));
        return {
          email: cols[emailIdx] || "",
          name: cols[nameIdx] || "",
          role: cols[roleIdx] || "viewer",
        };
      }).filter(u => u.email);

      setImportData(parsed);
    };
    reader.readAsText(file);
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "owner": return "default";
      case "admin": return "secondary";
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

  const togglePermission = (permissions: string[], moduleId: string): string[] => {
    if (permissions.includes(moduleId)) {
      return permissions.filter(p => p !== moduleId);
    }
    return [...permissions, moduleId];
  };

  if (isLoading) {
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
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Användare och behörigheter
              </CardTitle>
              <CardDescription>
                Hantera åtkomst till systemets olika moduler
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" data-testid="button-import-users">
                    <Upload className="h-4 w-4 mr-2" />
                    Importera
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Importera användare</DialogTitle>
                    <DialogDescription>
                      Ladda upp en CSV-fil med användare. Filen ska ha kolumner för e-post, namn och roll.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="border-2 border-dashed border-border rounded-md p-6 text-center">
                      <Input
                        type="file"
                        accept=".csv,.txt"
                        onChange={handleFileUpload}
                        className="hidden"
                        id="csv-upload"
                        data-testid="input-csv-file"
                      />
                      <label htmlFor="csv-upload" className="cursor-pointer">
                        <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          Klicka för att välja fil eller dra hit
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Format: email;namn;roll (CSV)
                        </p>
                      </label>
                    </div>
                    {importData.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">{importData.length} användare hittade:</p>
                        <div className="max-h-40 overflow-auto border rounded-md">
                          {importData.slice(0, 10).map((user, idx) => (
                            <div key={idx} className="flex items-center justify-between p-2 text-sm border-b last:border-0">
                              <span>{user.email}</span>
                              <Badge variant="outline">{getRoleLabel(user.role)}</Badge>
                            </div>
                          ))}
                          {importData.length > 10 && (
                            <p className="p-2 text-xs text-muted-foreground">
                              ... och {importData.length - 10} till
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowImportDialog(false)}>
                      Avbryt
                    </Button>
                    <Button 
                      onClick={() => importUsersMutation.mutate(importData)}
                      disabled={importData.length === 0 || importUsersMutation.isPending}
                      data-testid="button-confirm-import"
                    >
                      {importUsersMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      Importera {importData.length} användare
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-user">
                    <Plus className="h-4 w-4 mr-2" />
                    Lägg till
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Lägg till användare</DialogTitle>
                    <DialogDescription>
                      Ange e-post och välj roll för den nya användaren.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="new-email">E-post</Label>
                      <Input
                        id="new-email"
                        type="email"
                        value={newUser.email}
                        onChange={(e) => setNewUser(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="user@example.com"
                        data-testid="input-new-user-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-name">Namn</Label>
                      <Input
                        id="new-name"
                        value={newUser.name}
                        onChange={(e) => setNewUser(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Förnamn Efternamn"
                        data-testid="input-new-user-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-role">Roll</Label>
                      <Select value={newUser.role} onValueChange={(v) => setNewUser(prev => ({ ...prev, role: v }))}>
                        <SelectTrigger data-testid="select-new-user-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Läsare</SelectItem>
                          <SelectItem value="technician">Tekniker</SelectItem>
                          <SelectItem value="planner">Planerare</SelectItem>
                          <SelectItem value="admin">Administratör</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Modulbehörigheter
                      </Label>
                      <div className="grid grid-cols-2 gap-2 border rounded-md p-3">
                        {AVAILABLE_MODULES.map((mod) => (
                          <div key={mod.id} className="flex items-center gap-2">
                            <Checkbox
                              id={`new-perm-${mod.id}`}
                              checked={newUser.permissions.includes(mod.id)}
                              onCheckedChange={() => setNewUser(prev => ({
                                ...prev,
                                permissions: togglePermission(prev.permissions, mod.id)
                              }))}
                              data-testid={`checkbox-new-perm-${mod.id}`}
                            />
                            <label htmlFor={`new-perm-${mod.id}`} className="text-sm cursor-pointer">
                              {mod.label}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                      Avbryt
                    </Button>
                    <Button 
                      onClick={() => createUserMutation.mutate(newUser)}
                      disabled={!newUser.email || createUserMutation.isPending}
                      data-testid="button-confirm-add-user"
                    >
                      {createUserMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      Lägg till
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {roles && roles.length > 0 ? (
            <div className="space-y-3">
              {roles.map((role) => (
                <div 
                  key={role.id} 
                  className="flex items-center justify-between p-4 rounded-md border border-border"
                  data-testid={`row-user-${role.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <Users className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {role.userId?.startsWith("email:") 
                          ? role.userId.replace("email:", "") 
                          : `Användare #${role.userId?.slice(-6)}`}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Ansluten {role.createdAt ? new Date(role.createdAt).toLocaleDateString('sv-SE') : "-"}</span>
                        {Array.isArray(role.permissions) && role.permissions.length > 0 && (
                          <>
                            <span>|</span>
                            <span>{role.permissions.length} moduler</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={getRoleBadgeVariant(role.role)}>
                      {getRoleLabel(role.role)}
                    </Badge>
                    <Badge variant={role.isActive ? "outline" : "secondary"}>
                      {role.isActive ? "Aktiv" : "Inaktiv"}
                    </Badge>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-edit-user-${role.id}`}>
                          <Edit className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Redigera behörigheter</DialogTitle>
                          <DialogDescription>
                            Ändra roll och modulåtkomst för denna användare.
                          </DialogDescription>
                        </DialogHeader>
                        <EditUserPermissions 
                          role={role} 
                          onSave={(data) => updateUserMutation.mutate({ id: role.id, data })}
                          isPending={updateUserMutation.isPending}
                        />
                      </DialogContent>
                    </Dialog>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => deleteUserMutation.mutate(role.id)}
                      data-testid={`button-delete-user-${role.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Inga användare har tilldelats roller än.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Klicka "Lägg till" för att skapa användare manuellt eller "Importera" för att ladda upp en CSV-fil.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Tillgängliga moduler
          </CardTitle>
          <CardDescription>
            Dessa moduler kan tilldelas till användare
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {AVAILABLE_MODULES.map((mod) => (
              <div 
                key={mod.id} 
                className="flex items-start gap-3 p-3 rounded-md border border-border"
                data-testid={`module-info-${mod.id}`}
              >
                <Settings className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="font-medium text-sm">{mod.label}</p>
                  <p className="text-xs text-muted-foreground">{mod.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EditUserPermissions({ 
  role, 
  onSave, 
  isPending 
}: { 
  role: UserTenantRole; 
  onSave: (data: { role?: string; permissions?: string[]; isActive?: boolean }) => void;
  isPending: boolean;
}) {
  const [editRole, setEditRole] = useState(role.role);
  const [editPermissions, setEditPermissions] = useState<string[]>(
    Array.isArray(role.permissions) ? role.permissions as string[] : []
  );
  const [isActive, setIsActive] = useState(role.isActive ?? true);

  const togglePermission = (moduleId: string) => {
    setEditPermissions(prev => 
      prev.includes(moduleId) 
        ? prev.filter(p => p !== moduleId)
        : [...prev, moduleId]
    );
  };

  const selectAllModules = () => {
    setEditPermissions(AVAILABLE_MODULES.map(m => m.id));
  };

  const clearAllModules = () => {
    setEditPermissions([]);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Roll</Label>
        <Select value={editRole} onValueChange={setEditRole}>
          <SelectTrigger data-testid="select-edit-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="viewer">Läsare</SelectItem>
            <SelectItem value="technician">Tekniker</SelectItem>
            <SelectItem value="planner">Planerare</SelectItem>
            <SelectItem value="admin">Administratör</SelectItem>
            <SelectItem value="owner">Ägare</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Modulbehörigheter
          </Label>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={selectAllModules}>
              Välj alla
            </Button>
            <Button variant="ghost" size="sm" onClick={clearAllModules}>
              Rensa
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border rounded-md p-3 max-h-60 overflow-auto">
          {AVAILABLE_MODULES.map((mod) => (
            <div key={mod.id} className="flex items-center gap-2">
              <Checkbox
                id={`edit-perm-${mod.id}`}
                checked={editPermissions.includes(mod.id)}
                onCheckedChange={() => togglePermission(mod.id)}
                data-testid={`checkbox-edit-perm-${mod.id}`}
              />
              <label htmlFor={`edit-perm-${mod.id}`} className="text-sm cursor-pointer">
                {mod.label}
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="edit-active"
          checked={isActive}
          onCheckedChange={(checked) => setIsActive(checked === true)}
          data-testid="checkbox-edit-active"
        />
        <label htmlFor="edit-active" className="text-sm cursor-pointer">
          Användaren är aktiv
        </label>
      </div>

      <DialogFooter>
        <Button
          onClick={() => onSave({ role: editRole, permissions: editPermissions, isActive })}
          disabled={isPending}
          data-testid="button-save-permissions"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Spara ändringar
        </Button>
      </DialogFooter>
    </div>
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
