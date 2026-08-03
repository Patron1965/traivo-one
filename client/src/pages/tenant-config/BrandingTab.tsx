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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Building2, Save, Loader2, Palette, Image as ImageIcon, Type, Globe, Search, Check, Upload, X, Eye, AlertTriangle } from "lucide-react";
import {
  ACCEPTED_IMAGE_FORMATS_LABEL,
  IMAGE_REJECT_TOAST,
  getEffectiveContentType,
  isAcceptableImage,
} from "@/lib/file-mime";

// Konvertera #rrggbb → HSL-komponenter och tillbaka, så vi kan härleda en
// sammanhängande palett från en enda källfärg (vanligt när scrape bara hittar
// theme-color). Sekundär = mörkare/desaturerad variant, accent = komplement.
const hexToHsl = (hex: string): { h: number; s: number; l: number } | null => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
};

const hslToHex = (h: number, s: number, l: number): string => {
  const hh = ((h % 360) + 360) % 360 / 360;
  const ss = Math.max(0, Math.min(1, s / 100));
  const ll = Math.max(0, Math.min(1, l / 100));
  let r: number; let g: number; let b: number;
  if (ss === 0) { r = g = b = ll; }
  else {
    const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    const p = 2 * ll - q;
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    r = hue2rgb(p, q, hh + 1/3);
    g = hue2rgb(p, q, hh);
    b = hue2rgb(p, q, hh - 1/3);
  }
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
};

// Härleder en harmonisk palett från en primärfärg när scrape bara gav en.
// Sekundär = djupare/mörkare variant (för rubriker/navigering).
// Accent = analog (hue +35°) med lite mer mättnad (för CTA/badges).
const derivePalette = (primary: string): { secondary: string; accent: string } | null => {
  const hsl = hexToHsl(primary);
  if (!hsl) return null;
  // Gråskaligt primär (vit/svart/grå) — behåll neutralt utan att hitta på en hue.
  if (hsl.s < 5) {
    const secondary = hslToHex(0, 0, Math.max(15, hsl.l * 0.35));
    const accent = hslToHex(0, 0, Math.max(35, Math.min(60, hsl.l)));
    return { secondary, accent };
  }
  const secondary = hslToHex(hsl.h, Math.max(20, hsl.s * 0.55), Math.max(18, hsl.l * 0.4));
  const accent = hslToHex(hsl.h + 35, Math.min(80, hsl.s + 10), Math.min(60, Math.max(40, hsl.l)));
  return { secondary, accent };
};

const isExternallyHostedLogo = (url: string): boolean => {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    const sameOrigin =
      typeof window !== "undefined" && parsed.origin === window.location.origin;
    if (!sameOrigin) return true;
    return !parsed.pathname.startsWith("/api/storage/serve");
  } catch {
    return false;
  }
};

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

  const mirrorExternalLogo = async (sourceUrl: string): Promise<string> => {
    if (!sourceUrl || sourceUrl.startsWith("data:") || sourceUrl.startsWith("/")) {
      return sourceUrl;
    }
    try {
      const resp = await apiRequest("POST", "/api/system/tenant-branding/mirror-logo", { sourceUrl });
      const data = await resp.json();
      if (data?.url) return data.url;
      throw new Error("Tomt svar från speglingen");
    } catch (err: any) {
      toast({
        title: "Logon kunde inte sparas i molnet",
        description: `Använder den externa länken istället. ${err?.message || ""}`.trim(),
        variant: "destructive",
      });
      return sourceUrl;
    }
  };

  const selectLogo = async (sourceUrl: string) => {
    setForm(prev => ({ ...prev, logoUrl: sourceUrl }));
    if (sourceUrl.startsWith("data:") || sourceUrl.startsWith("/")) return;
    setLogoUploading(true);
    try {
      const finalUrl = await mirrorExternalLogo(sourceUrl);
      setForm(prev => (prev.logoUrl === sourceUrl ? { ...prev, logoUrl: finalUrl } : prev));
    } finally {
      setLogoUploading(false);
    }
  };

  const scrapeMutation = useMutation({
    mutationFn: async (url: string) => {
      const resp = await apiRequest("POST", "/api/system/scrape-branding", { url });
      return resp.json();
    },
    onSuccess: async (data) => {
      setScrapeResult(data);
      if (data.companyName && !form.companyName) {
        setForm(prev => ({ ...prev, companyName: data.companyName }));
      }
      if (data.logos.length > 0) {
        // Always pre-select the best (top-ranked) logo from the scrape, even if a
        // logo was previously saved. Mirror it into our object storage so the
        // asset survives even if the source site goes down or changes layout.
        const top = data.logos[0];
        setForm(prev => ({ ...prev, logoUrl: top }));
        if (!top.startsWith("data:") && !top.startsWith("/")) {
          setLogoUploading(true);
          try {
            const mirrored = await mirrorExternalLogo(top);
            setForm(prev => (prev.logoUrl === top ? { ...prev, logoUrl: mirrored } : prev));
          } finally {
            setLogoUploading(false);
          }
        }
      }
      if (data.colors.length >= 1) {
        const primary = data.colors[0];
        // Om scrape bara hittade 1–2 färger, härled resten ur primärfärgen
        // så att paletten alltid är komplett efter Hämta.
        const derived = derivePalette(primary);
        setForm(prev => ({
          ...prev,
          primaryColor: primary || prev.primaryColor,
          secondaryColor: data.colors[1] || derived?.secondary || prev.secondaryColor,
          accentColor: data.colors[2] || derived?.accent || prev.accentColor,
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
      const res = await apiRequest("PUT", "/api/system/tenant-branding", data);
      return res.json() as Promise<TenantBranding>;
    },
    onSuccess: (updated) => {
      // Skriv in serverresponse direkt i cachen så TenantBrandingProvider och
      // formuläret reagerar omedelbart — invalideringen bekräftar i bakgrunden.
      queryClient.setQueryData(["/api/system/tenant-branding"], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/system/tenant-branding"] });
      toast({ title: "Sparat", description: "Varumärkesprofilen har uppdaterats. Ändringarna syns direkt." });
    },
    onError: (error: Error) => {
      toast({ title: "Kunde inte spara varumärkesprofil", description: error.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/system/tenant-branding", {
        companyName: "",
        logoUrl: "",
        primaryColor: "#1B4B6B",
        secondaryColor: "#2C3E50",
        accentColor: "#4A9B9B",
        tagline: "",
      });
      return res.json() as Promise<TenantBranding>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["/api/system/tenant-branding"], updated);
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
    if (!isAcceptableImage(file)) {
      toast({
        ...IMAGE_REJECT_TOAST,
        variant: "destructive",
        duration: 6000,
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "Filen är för stor",
        description: "Max 5 MB.",
        variant: "destructive",
        duration: 6000,
      });
      return;
    }

    const effectiveContentType = getEffectiveContentType(file);

    setLogoUploading(true);
    try {
      // apiRequest extraherar serverns JSON-error så att 413
      // "Logotypen är för stor. Maxgräns är 5 MB." surfaceas direkt i toasten.
      const resp = await apiRequest("POST", "/api/system/tenant-branding/upload-logo", {
        contentType: effectiveContentType,
        size: file.size,
      });
      const { uploadURL, objectPath } = await resp.json();

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": effectiveContentType },
      });
      if (!putRes.ok) {
        throw new Error("Kunde inte ladda upp logotypen till lagringen.");
      }

      // Confirm-rutten raderar filen och returnerar 4xx + svenskt error
      // om den faktiska blob-storleken översteg 5 MB.
      const confirmResp = await apiRequest("POST", "/api/system/tenant-branding/confirm-logo", { objectPath });
      const { url } = await confirmResp.json();

      // Uppdatera formulär omedelbart för lokal preview.
      setForm(prev => ({ ...prev, logoUrl: url }));

      // Auto-spara så att TopNav, Splash och övriga konsumenter får den nya
      // logotypen direkt — annars måste användaren komma ihåg att klicka Spara
      // efter upload, vilket upplevs som att uppladdningen "inte gör något".
      try {
        const saveRes = await apiRequest("PUT", "/api/system/tenant-branding", {
          ...form,
          logoUrl: url,
        });
        const updated = (await saveRes.json()) as TenantBranding;
        queryClient.setQueryData(["/api/system/tenant-branding"], updated);
        queryClient.invalidateQueries({ queryKey: ["/api/system/tenant-branding"] });
        toast({ title: "Logotyp uppladdad", description: "Logotypen har laddats upp och syns nu i hela systemet." });
      } catch (saveErr: any) {
        toast({
          title: "Logotyp uppladdad — men inte sparad",
          description: saveErr?.message || "Klicka Spara för att aktivera den.",
          variant: "destructive",
          duration: 6000,
        });
      }
    } catch (error: any) {
      toast({
        title: "Logotypen kunde inte laddas upp",
        description: error?.message || "Försök igen.",
        variant: "destructive",
        duration: 6000,
      });
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
                          onClick={() => selectLogo(logo)}
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
                  <ImageIcon className="h-4 w-4" />
                  Logotyp
                </Label>
                {isExternallyHostedLogo(form.logoUrl) && (
                  <Alert
                    variant="destructive"
                    data-testid="alert-external-logo-warning"
                    className="border-chart-4/50 text-chart-4 [&>svg]:text-chart-4 dark:[&>svg]:text-chart-4"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Logon är hostad externt</AlertTitle>
                    <AlertDescription>
                      Den nuvarande logotypen ligger på en extern webbadress och kan sluta fungera om källan ändras eller tas bort. Spara om varumärkesprofilen eller välj en ny logotyp för att flytta in den i Traivo.
                    </AlertDescription>
                  </Alert>
                )}
                {form.logoUrl ? (
                  <div
                    className={`border rounded-lg p-4 bg-muted/30 relative group cursor-pointer transition-colors ${logoDragOver ? "border-primary bg-primary/10" : "hover:border-primary/50"} ${logoUploading ? "pointer-events-none opacity-60" : ""}`}
                    data-testid="logo-upload-preview"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("[data-testid='button-remove-logo']")) return;
                      if (!logoUploading) logoInputRef.current?.click();
                    }}
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
                    <div className="flex items-center justify-center min-h-16">
                      {logoUploading ? (
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                          <p className="text-xs text-muted-foreground">Laddar upp...</p>
                        </div>
                      ) : (
                        <img
                          src={form.logoUrl}
                          alt="Logotyp"
                          className="h-16 w-auto object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      )}
                    </div>
                    {!logoUploading && (
                      <div className={`absolute inset-0 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm transition-opacity ${logoDragOver ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                        <div className="flex flex-col items-center gap-1 text-center pointer-events-none">
                          <Upload className="h-6 w-6 text-primary" />
                          <p className="text-xs font-medium">Dra in ny logotyp eller klicka för att byta</p>
                        </div>
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-6 w-6 z-10 bg-background/80 hover:bg-background"
                      data-testid="button-remove-logo"
                      onClick={(e) => {
                        e.stopPropagation();
                        setForm(prev => ({ ...prev, logoUrl: "" }));
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
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
                        <p className="text-xs text-muted-foreground/60">{ACCEPTED_IMAGE_FORMATS_LABEL} — max 5 MB, rekommenderad: 200×80px, transparent bakgrund</p>
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
              disabled={saveMutation.isPending || logoUploading}
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
