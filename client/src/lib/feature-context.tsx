import { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ModuleKey, PackageTier } from "@shared/modules";
import { MODULE_DEFINITIONS, PACKAGE_DEFINITIONS } from "@shared/modules";

interface FeatureContextType {
  enabledModules: ModuleKey[];
  packageTier: PackageTier;
  isModuleEnabled: (moduleKey: ModuleKey) => boolean;
  isNavItemEnabled: (url: string) => boolean;
  isLoading: boolean;
}

const FeatureContext = createContext<FeatureContextType>({
  enabledModules: [],
  packageTier: "premium",
  isModuleEnabled: () => true,
  isNavItemEnabled: () => true,
  isLoading: true,
});

function getModuleForUrl(url: string): ModuleKey | null {
  const basePath = "/" + url.split("/").filter(Boolean)[0];
  if (!basePath || basePath === "/") return "core";
  for (const [key, def] of Object.entries(MODULE_DEFINITIONS)) {
    if (def.routes.includes(basePath)) return key as ModuleKey;
  }
  return null;
}

export function FeatureProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery<{
    enabledModules: ModuleKey[];
    packageTier: PackageTier;
  }>({
    queryKey: ["/api/tenant/features"],
    staleTime: 60_000,
    retry: 1,
  });

  const value = useMemo<FeatureContextType>(() => {
    const modules = data?.enabledModules ?? ["core" as ModuleKey];
    const tier = data?.packageTier ?? "premium";
    return {
      enabledModules: modules,
      packageTier: tier,
      isModuleEnabled: (key: ModuleKey) => {
        if (isLoading) return true;
        return modules.includes(key);
      },
      isNavItemEnabled: (url: string) => {
        if (isLoading) return true;
        const mod = getModuleForUrl(url);
        if (!mod) return true;
        return modules.includes(mod);
      },
      isLoading,
    };
  }, [data, isLoading]);

  return (
    <FeatureContext.Provider value={value}>
      {children}
    </FeatureContext.Provider>
  );
}

export function useFeatures() {
  return useContext(FeatureContext);
}
