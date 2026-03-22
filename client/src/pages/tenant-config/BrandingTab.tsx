import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TenantBranding } from "@shared/schema";
import { Building2, Save, Loader2, Palette, Image, Type, Globe, Search, Check, Upload, X, Eye } from "lucide-react";

export function BrandingTab() {
  const { toast } = useToast();
  const { data: branding, isLoading } = useQuery<TenantBranding | null>({
    queryKey: ["/api/system/tenant-branding"],
  });

  const [form, setForm] = useState({
    companyName: "",
    logoUrl: "",
    primaryColor: "#1B4B6B",
    secondaryColor: "#2C3E50",
    accentColor: "#4A9B9B",
    tagline: "",
  });

  const [showPreview, setShowPreview] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoDragOver, setLogoDragOver] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scrapeResult, setScrapeResult] = useState<{
    companyName: string;
    logos: string[];
    colors: string[];
    sourceUrl: string;
  } | null>(null);

  const scrapeMutation = useMutation({
    mutationFn: async (url: string) => {
      const resp = await apiRequest("POST", "/api/system/scrape-branding", { url });
      return resp.json();
    },
    onSuccess: (data) => {
      setScrapeResult(data);
      if (data.companyName && !form.companyName) {
        setForm(prev => ({ ...prev, companyName: data.companyName }));
      }
      if (data.logos.length > 0 && !form.logoUrl) {
        setForm(prev => ({ ...prev, logoUrl: data.logos[0] }));
      }
      if (data.colors.length >= 1) {
        setForm(prev => ({
          ...prev,
          primaryColor: data.colors[0] || prev.primaryColor,
          secondaryColor: data.colors[1] || prev.secondaryColor,
          accentColor: data.colors[2] || prev.accentColor,
        }));
      }
      setShowPreview(true);
      toast({ title: "Hämtat!", description: `Hittade ${data.logos.length} logotyper och ${data.colors.length} färger från ${data.companyName || data.sourceUrl}` });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte hämta", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (branding) {
      setForm({
        companyName: branding.companyName || "",
        logoUrl: branding.logoUrl || "",
        primaryColor: branding.primaryColor || "#1B4B6B",
        secondaryColor: branding.secondaryColor || "#2C3E50",
        accentColor: branding.accentColor || "#4A9B9B",
        tagline: branding.tagline || "",
      });
    }
  }, [branding]);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      return apiRequest("PUT", "/api/system/tenant-branding", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/tenant-branding"] });
      toast({ title: "Sparat", description: "Varumärkesprofilen har uppdaterats. Ändringarna syns direkt." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte spara varumärkesprofil", description: error.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PUT", "/api/system/tenant-branding", {
        companyName: "",
        logoUrl: "",
        primaryColor: "#1B4B6B",
        secondaryColor: "#2C3E50",
        accentColor: "#4A9B9B",
        tagline: "",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/tenant-branding"] });
      setForm({
        companyName: "",
        logoUrl: "",
        primaryColor: "#1B4B6B",
        secondaryColor: "#2C3E50",
        accentColor: "#4A9B9B",
        tagline: "",
      });
      toast({ title: "Återställt", description: "Varumärkesprofilen har återställts till Traivo-standard." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte återställa varumärkesprofil", description: error.message, variant: "destructive" });
    },
  });

  const handleLogoUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Fel filtyp", description: "Välj en bildfil (PNG, JPG, SVG)", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Filen är för stor", description: "Max 5 MB", variant: "destructive" });
      return;
    }

    setLogoUploading(true);
    try {
      const resp = await apiRequest("POST", "/api/system/tenant-branding/upload-logo", {});
      const { uploadURL, objectPath } = await resp.json();

      await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      const confirmResp = await apiRequest("POST", "/api/system/tenant-branding/confirm-logo", { objectPath });
      const { url } = await confirmResp.json();

      setForm(prev => ({ ...prev, logoUrl: url }));
      toast({ title: "Logotyp uppladdad", description: "Logotypen har laddats upp." });
    } catch (error: any) {
      toast({ title: "Uppladdning misslyckades", description: error.message, variant: "destructive" });
    } finally {
      setLogoUploading(false);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const hasCustomBranding = !!(form.companyName || form.logoUrl);

  const isValidHex = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v);
  const setColor = (field: "primaryColor" | "secondaryColor" | "accentColor", value: string) => {
    if (value.startsWith("#") && value.length <= 7) {
      setForm(prev => ({ ...prev, [field]: value }));
    }
  };

  const darken = (hex: string, amount: number) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return hex;
    const r = Math.max(0, parseInt(result[1], 16) - amount);
    const g = Math.max(0, parseInt(result[2], 16) - amount);
    const b = Math.max(0, parseInt(result[3], 16) - amount);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Snabbkonfiguration — Varumärke
          </CardTitle>
          <CardDescription>
            Anpassa utseendet för demos och säljpresentationer. Konfigurera företagsnamn, logotyp och färger — ändringarna syns direkt i hela systemet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4 space-y-3">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4" />
              Hämta varumärke från webbplats
            </Label>
            <p className="text-xs text-muted-foreground">
              Ange företagets webbadress — logotyp, färger och namn hämtas automatiskt.
            </p>
            <div className="flex gap-2">
              <Input
                data-testid="input-scrape-url"
                value={scrapeUrl}
                onChange={(e) => setScrapeUrl(e.target.value)}
                placeholder="t.ex. lundstams.se"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && scrapeUrl.trim()) {
                    e.preventDefault();
                    scrapeMutation.mutate(scrapeUrl);
                  }
                }}
              />
              <Button
                data-testid="button-scrape-branding"
                onClick={() => scrapeMutation.mutate(scrapeUrl)}
                disabled={scrapeMutation.isPending || !scrapeUrl.trim()}
                variant="default"
                size="default"
              >
                {scrapeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Hämta
              </Button>
            </div>

            {scrapeResult && (
              <div className="space-y-3 pt-2">
                {scrapeResult.logos.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Hittade logotyper (klicka för att välja)</Label>
                    <div className="flex flex-wrap gap-2">
                      {scrapeResult.logos.map((logo, i) => (
                        <button
                          key={i}
                          data-testid={`button-select-logo-${i}`}
                          onClick={() => setForm(prev => ({ ...prev, logoUrl: logo }))}
                          className={`relative border rounded-lg p-2 bg-white dark:bg-gray-800 hover:border-primary transition-colors ${form.logoUrl === logo ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
                          style={{ minWidth: "60px", maxWidth: "140px" }}
                        >
                          <img
                            src={logo}
                            alt={`Logo ${i + 1}`}
                            className="h-10 w-auto object-contain"
                            onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
                          />
                          {form.logoUrl === logo && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                              <Check className="h-2.5 w-2.5 text-white" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {scrapeResult.colors.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Hittade färger (klicka för att använda som primärfärg)</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {scrapeResult.colors.slice(0, 12).map((color, i) => (
                        <button
                          key={i}
                          data-testid={`button-select-color-${i}`}
                          onClick={() => setForm(prev => ({ ...prev, primaryColor: color }))}
                          className={`w-8 h-8 rounded border-2 transition-transform hover:scale-110 ${form.primaryColor === color ? "border-foreground scale-110 ring-2 ring-primary/30" : "border-border"}`}
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <Separator />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="brandCompanyName" className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Företagsnamn
                </Label>
                <Input
                  id="brandCompanyName"
                  data-testid="input-brand-company-name"
                  value={form.companyName}
                  onChange={(e) => setForm(prev => ({ ...prev, companyName: e.target.value }))}
                  placeholder="t.ex. Lundstams Åkeri AB"
                />
                <p className="text-xs text-muted-foreground">Visas i splash-skärmen och navigeringen</p>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Image className="h-4 w-4" />
                  Logotyp
                </Label>
                {form.logoUrl ? (
                  <div className="border rounded-lg p-4 bg-muted/30 relative" data-testid="logo-upload-preview">
                    <div className="flex items-center justify-center">
                      <img
                        src={form.logoUrl}
                        alt="Logotyp"
                        className="h-16 w-auto object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-6 w-6"
                      data-testid="button-remove-logo"
                      onClick={() => setForm(prev => ({ ...prev, logoUrl: "" }))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                    <p className="text-xs text-muted-foreground text-center mt-2">Klicka × för att ta bort och ladda upp en ny</p>
                  </div>
                ) : (
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${logoDragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"} ${logoUploading ? "pointer-events-none opacity-60" : ""}`}
                    data-testid="logo-upload-dropzone"
                    onClick={() => !logoUploading && logoInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setLogoDragOver(true); }}
                    onDragLeave={() => setLogoDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setLogoDragOver(false);
                      const file = e.dataTransfer.files[0];
                      if (file) handleLogoUpload(file);
                    }}
                  >
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      data-testid="input-logo-file"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleLogoUpload(file);
                        e.target.value = "";
                      }}
                    />
                    {logoUploading ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Laddar upp...</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Dra och släpp logotyp här</p>
                        <p className="text-xs text-muted-foreground">eller klicka för att välja fil</p>
                        <p className="text-xs text-muted-foreground/60">PNG, JPG, SVG — max 5 MB, rekommenderad: 200×80px, transparent bakgrund</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="brandTagline" className="flex items-center gap-2">
                  <Type className="h-4 w-4" />
                  Tagline
                </Label>
                <Input
                  id="brandTagline"
                  data-testid="input-brand-tagline"
                  value={form.tagline}
                  onChange={(e) => setForm(prev => ({ ...prev, tagline: e.target.value }))}
                  placeholder="t.ex. Smart avfallshantering"
                />
                <p className="text-xs text-muted-foreground">Visas under logotypen i splash-skärmen</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Palette className="h-4 w-4" />
                  Färgpalett
                </Label>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="brandPrimaryColor" className="text-xs text-muted-foreground">Primärfärg</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        id="brandPrimaryColor"
                        data-testid="input-brand-primary-color"
                        value={isValidHex(form.primaryColor) ? form.primaryColor : "#1B4B6B"}
                        onChange={(e) => setColor("primaryColor", e.target.value)}
                        className="w-10 h-10 rounded cursor-pointer border border-border"
                      />
                      <Input
                        value={form.primaryColor}
                        onChange={(e) => setColor("primaryColor", e.target.value)}
                        className={`font-mono text-xs h-8 ${!isValidHex(form.primaryColor) && form.primaryColor.length === 7 ? "border-destructive" : ""}`}
                        maxLength={7}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="brandSecondaryColor" className="text-xs text-muted-foreground">Sekundärfärg</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        id="brandSecondaryColor"
                        data-testid="input-brand-secondary-color"
                        value={isValidHex(form.secondaryColor) ? form.secondaryColor : "#2C3E50"}
                        onChange={(e) => setColor("secondaryColor", e.target.value)}
                        className="w-10 h-10 rounded cursor-pointer border border-border"
                      />
                      <Input
                        value={form.secondaryColor}
                        onChange={(e) => setColor("secondaryColor", e.target.value)}
                        className={`font-mono text-xs h-8 ${!isValidHex(form.secondaryColor) && form.secondaryColor.length === 7 ? "border-destructive" : ""}`}
                        maxLength={7}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="brandAccentColor" className="text-xs text-muted-foreground">Accentfärg</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        id="brandAccentColor"
                        data-testid="input-brand-accent-color"
                        value={isValidHex(form.accentColor) ? form.accentColor : "#4A9B9B"}
                        onChange={(e) => setColor("accentColor", e.target.value)}
                        className="w-10 h-10 rounded cursor-pointer border border-border"
                      />
                      <Input
                        value={form.accentColor}
                        onChange={(e) => setColor("accentColor", e.target.value)}
                        className={`font-mono text-xs h-8 ${!isValidHex(form.accentColor) && form.accentColor.length === 7 ? "border-destructive" : ""}`}
                        maxLength={7}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="button-preview-branding"
                onClick={() => setShowPreview(!showPreview)}
              >
                <Eye className="h-4 w-4 mr-2" />
                {showPreview ? "Dölj förhandsvisning" : "Visa förhandsvisning"}
              </Button>
              {hasCustomBranding && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="button-reset-branding"
                  onClick={() => resetMutation.mutate()}
                  disabled={resetMutation.isPending}
                >
                  {resetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Återställ till Traivo
                </Button>
              )}
            </div>
            <Button
              data-testid="button-save-branding"
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Spara varumärke
            </Button>
          </div>
        </CardContent>
      </Card>

      {showPreview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Förhandsvisning</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-2">Splash-skärm (inloggning) — smiley + företagsinfo</p>
              <div
                className="rounded-lg overflow-hidden relative flex flex-col items-center justify-center py-10"
                style={{
                  background: `linear-gradient(135deg, ${form.primaryColor} 0%, ${darken(form.primaryColor, 30)} 50%, ${form.primaryColor} 100%)`,
                  minHeight: "220px",
                }}
                data-testid="preview-splash"
              >
                <div className="relative flex flex-col items-center gap-4">
                  <svg width="80" height="80" viewBox="0 0 120 120" className="drop-shadow-2xl">
                    <defs>
                      <radialGradient id="prevFaceGrad" cx="40%" cy="35%">
                        <stop offset="0%" stopColor="#FFE066" />
                        <stop offset="100%" stopColor="#FFD700" />
                      </radialGradient>
                    </defs>
                    <circle cx="60" cy="60" r="55" fill="url(#prevFaceGrad)" stroke="#E6B800" strokeWidth="2" />
                    <ellipse cx="42" cy="45" rx="7" ry="9" fill="#4A3728" />
                    <ellipse cx="78" cy="45" rx="7" ry="9" fill="#4A3728" />
                    <path d="M35 70 Q60 95 85 70" stroke="#4A3728" strokeWidth="4" fill="none" strokeLinecap="round" />
                  </svg>
                  {form.logoUrl && (
                    <img
                      src={form.logoUrl}
                      alt={form.companyName}
                      className="h-12 w-auto object-contain"
                      style={{ filter: "brightness(0) invert(1)" }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  <div className="text-center text-white">
                    <h2 className="text-xl font-bold drop-shadow-md">
                      Välkommen till {form.companyName || "Traivo"}!
                    </h2>
                    {form.tagline && (
                      <p className="text-sm opacity-80 mt-1">{form.tagline}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-2">Navigering — logotyp + företagsnamn</p>
              <div className="border rounded-lg p-3 flex items-center gap-3 bg-background">
                {form.logoUrl ? (
                  <img
                    src={form.logoUrl}
                    alt={form.companyName}
                    className="h-10 w-auto object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="h-10 w-10 rounded bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                    {(form.companyName || "T")[0]}
                  </div>
                )}
                <span className="font-semibold">{form.companyName || "Traivo"}</span>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-2">Färgpalett</p>
              <div className="flex gap-2">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-16 h-16 rounded-lg shadow-sm" style={{ backgroundColor: form.primaryColor }} />
                  <span className="text-xs text-muted-foreground">Primär</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="w-16 h-16 rounded-lg shadow-sm" style={{ backgroundColor: form.secondaryColor }} />
                  <span className="text-xs text-muted-foreground">Sekundär</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="w-16 h-16 rounded-lg shadow-sm" style={{ backgroundColor: form.accentColor }} />
                  <span className="text-xs text-muted-foreground">Accent</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
