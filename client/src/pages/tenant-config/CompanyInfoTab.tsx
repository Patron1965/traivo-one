import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Tenant } from "@shared/schema";
import { Building2, Save, Loader2 } from "lucide-react";

export function CompanyInfoTab() {
  const { toast } = useToast();
  const { data: tenant, isLoading } = useQuery<Tenant>({
    queryKey: ["/api/tenant"],
  });

  const [form, setForm] = useState({
    name: "",
    orgNumber: "",
    contactEmail: "",
    contactPhone: "",
    industry: "waste_management",
  });

  useEffect(() => {
    if (tenant) {
      setForm({
        name: tenant.name || "",
        orgNumber: tenant.orgNumber || "",
        contactEmail: tenant.contactEmail || "",
        contactPhone: tenant.contactPhone || "",
        industry: tenant.industry || "waste_management",
      });
    }
  }, [tenant]);

  const updateMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      return apiRequest("PATCH", "/api/tenant", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant"] });
      toast({ title: "Sparat", description: "Företagsinformation uppdaterad." });
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Företagsinformation
          </CardTitle>
          <CardDescription>Grundläggande uppgifter om er tenant/företag</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Företagsnamn</Label>
              <Input
                id="name"
                data-testid="input-company-name"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orgNumber">Organisationsnummer</Label>
              <Input
                id="orgNumber"
                data-testid="input-org-number"
                value={form.orgNumber}
                onChange={(e) => setForm(prev => ({ ...prev, orgNumber: e.target.value }))}
                placeholder="556xxx-xxxx"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Kontakt-epost</Label>
              <Input
                id="contactEmail"
                data-testid="input-contact-email"
                type="email"
                value={form.contactEmail}
                onChange={(e) => setForm(prev => ({ ...prev, contactEmail: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactPhone">Kontakttelefon</Label>
              <Input
                id="contactPhone"
                data-testid="input-contact-phone"
                value={form.contactPhone}
                onChange={(e) => setForm(prev => ({ ...prev, contactPhone: e.target.value }))}
                placeholder="+46..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Bransch</Label>
              <Select value={form.industry} onValueChange={(v) => setForm(prev => ({ ...prev, industry: v }))}>
                <SelectTrigger data-testid="select-industry">
                  <SelectValue placeholder="Välj bransch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="waste_management">Avfallshantering</SelectItem>
                  <SelectItem value="property_maintenance">Fastighetsunderhåll</SelectItem>
                  <SelectItem value="cleaning">Städning</SelectItem>
                  <SelectItem value="snow_removal">Snöröjning</SelectItem>
                  <SelectItem value="combined">Kombinerad service</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Separator />
          <div className="flex justify-end">
            <Button
              data-testid="button-save-company"
              onClick={() => updateMutation.mutate(form)}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Spara företagsinformation
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenant-ID</CardTitle>
          <CardDescription>Teknisk identifierare för er tenant</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-sm px-3 py-1">{tenant?.id}</Badge>
            <span className="text-sm text-muted-foreground">Skapades: {tenant?.createdAt ? new Date(tenant.createdAt).toLocaleDateString("sv-SE") : "-"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
