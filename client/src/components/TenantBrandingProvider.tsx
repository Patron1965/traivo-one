import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TenantBranding } from "@shared/schema";

interface BrandingContextValue {
  branding: TenantBranding | null;
  isLoading: boolean;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  companyName: string;
}

const BrandingContext = createContext<BrandingContextValue>({
  branding: null,
  isLoading: true,
  primaryColor: "#3B82F6",
  secondaryColor: "#6366F1",
  accentColor: "#F59E0B",
  companyName: "Unicorn",
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
  const [applied, setApplied] = useState(false);

  const { data: branding, isLoading } = useQuery<TenantBranding | null>({
    queryKey: ["/api/system/tenant-branding"],
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!branding || applied) return;

    const root = document.documentElement;

    if (branding.primaryColor) {
      const hsl = hexToHSL(branding.primaryColor);
      root.style.setProperty("--tenant-primary", hsl);
    }

    if (branding.secondaryColor) {
      const hsl = hexToHSL(branding.secondaryColor);
      root.style.setProperty("--tenant-secondary", hsl);
    }

    if (branding.accentColor) {
      const hsl = hexToHSL(branding.accentColor);
      root.style.setProperty("--tenant-accent", hsl);
    }

    if (branding.successColor) {
      const hsl = hexToHSL(branding.successColor);
      root.style.setProperty("--tenant-success", hsl);
    }

    if (branding.errorColor) {
      const hsl = hexToHSL(branding.errorColor);
      root.style.setProperty("--tenant-error", hsl);
    }

    setApplied(true);
  }, [branding, applied]);

  const contextValue: BrandingContextValue = {
    branding: branding ?? null,
    isLoading,
    primaryColor: branding?.primaryColor || "#3B82F6",
    secondaryColor: branding?.secondaryColor || "#6366F1",
    accentColor: branding?.accentColor || "#F59E0B",
    companyName: branding?.companyName || "Unicorn",
  };

  return (
    <BrandingContext.Provider value={contextValue}>
      {children}
    </BrandingContext.Provider>
  );
}
