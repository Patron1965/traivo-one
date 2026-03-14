import { createContext, useContext, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TenantBranding } from "@shared/schema";

interface BrandingContextValue {
  branding: TenantBranding | null;
  isLoading: boolean;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  companyName: string;
  logoUrl: string | null;
  logoIconUrl: string | null;
  fontFamily: string;
}

const BrandingContext = createContext<BrandingContextValue>({
  branding: null,
  isLoading: true,
  primaryColor: "#EA580C",
  secondaryColor: "#991B1B",
  accentColor: "#F59E0B",
  companyName: "Traivo",
  logoUrl: null,
  logoIconUrl: null,
  fontFamily: "Inter",
});

export function useTenantBranding() {
  return useContext(BrandingContext);
}

function hexToHSL(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "0 0% 50%";
  
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function TenantBrandingProvider({ children }: { children: React.ReactNode }) {
  const lastVersionRef = useRef<number | null>(null);

  const { data: branding, isLoading } = useQuery<TenantBranding | null>({
    queryKey: ["/api/system/tenant-branding"],
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!branding) return;
    
    if (lastVersionRef.current === branding.version) return;
    lastVersionRef.current = branding.version;

    const root = document.documentElement;

    if (branding.primaryColor) {
      const hsl = hexToHSL(branding.primaryColor);
      root.style.setProperty("--primary", hsl);
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", hsl);
    }

    if (branding.secondaryColor) {
      const hsl = hexToHSL(branding.secondaryColor);
      root.style.setProperty("--secondary", hsl);
      root.style.setProperty("--secondary-foreground", "0 0% 100%");
    }

    if (branding.accentColor) {
      const hsl = hexToHSL(branding.accentColor);
      root.style.setProperty("--accent", hsl);
      root.style.setProperty("--accent-foreground", "0 0% 100%");
    }

    if (branding.successColor) {
      const hsl = hexToHSL(branding.successColor);
      root.style.setProperty("--success", hsl);
    }

    if (branding.errorColor) {
      const hsl = hexToHSL(branding.errorColor);
      root.style.setProperty("--destructive", hsl);
    }

    if (branding.fontFamily) {
      document.body.style.fontFamily = `'${branding.fontFamily}', system-ui, sans-serif`;
    }

    if (branding.faviconUrl) {
      const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null;
      if (link) {
        link.href = branding.faviconUrl;
      } else {
        const newLink = document.createElement('link');
        newLink.rel = 'icon';
        newLink.href = branding.faviconUrl;
        document.head.appendChild(newLink);
      }
    }

    if (branding.companyName) {
      document.title = `${branding.companyName} - Fältservice`;
    }
  }, [branding]);

  const contextValue: BrandingContextValue = {
    branding: branding ?? null,
    isLoading,
    primaryColor: branding?.primaryColor || "#EA580C",
    secondaryColor: branding?.secondaryColor || "#991B1B",
    accentColor: branding?.accentColor || "#F59E0B",
    companyName: branding?.companyName || "Traivo",
    logoUrl: branding?.logoUrl || null,
    logoIconUrl: (branding?.logoIconUrl && !branding.logoIconUrl.includes("traivo-logo")) ? branding.logoIconUrl : null,
    fontFamily: branding?.fontFamily || "Inter",
  };

  return (
    <BrandingContext.Provider value={contextValue}>
      {children}
    </BrandingContext.Provider>
  );
}
