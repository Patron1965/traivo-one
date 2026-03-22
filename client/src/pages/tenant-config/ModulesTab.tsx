import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";
import { Shield, Crown, Sparkles, Settings2, CheckCircle2, ToggleLeft, Check, Lock, Save, Loader2 } from "lucide-react";

export function ModulesTab() {
  const { data: featureData, isLoading } = useQuery<{
    packageTier: string;
    enabledModules: string[];
    moduleDefinitions: Record<string, { label: string; description: string; icon: string }>;
    packageDefinitions: Record<string, { tier: string; label: string; description: string; modules: string[]; price?: string }>;
  }>({
    queryKey: ["/api/tenant/features"],
  });

  const updateFeatures = useMutation({
    mutationFn: async (body: { packageTier?: string; enabledModules?: string[] }) => {
      const res = await fetch("/api/tenant/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Kunde inte uppdatera");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenant/features"] });
    },
  });

  const [localModules, setLocalModules] = useState<string[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (featureData) {
      setLocalModules(featureData.enabledModules);
      setHasChanges(false);
    }
  }, [featureData]);

  if (isLoading || !featureData) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  const { packageDefinitions, moduleDefinitions } = featureData;
  const currentTier = featureData.packageTier;

  const toggleModule = (key: string) => {
    if (key === "core") return;
    setLocalModules(prev => {
      const next = prev.includes(key) ? prev.filter(m => m !== key) : [...prev, key];
      setHasChanges(true);
      return next;
    });
  };

  const selectPackage = (tier: string) => {
    if (tier === "custom") {
      updateFeatures.mutate({ enabledModules: localModules });
    } else {
      updateFeatures.mutate({ packageTier: tier });
    }
  };

  const saveCustomModules = () => {
    updateFeatures.mutate({ enabledModules: localModules });
  };

  const tierColors: Record<string, string> = {
    basic: "border-gray-300 bg-gray-50 dark:bg-gray-900",
    standard: "border-blue-300 bg-blue-50 dark:bg-blue-900/20",
    premium: "border-amber-300 bg-amber-50 dark:bg-amber-900/20",
    custom: "border-purple-300 bg-purple-50 dark:bg-purple-900/20",
  };

  const tierIcons: Record<string, typeof Crown> = {
    basic: Shield,
    standard: Sparkles,
    premium: Crown,
    custom: Settings2,
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" />
            Paketval
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Object.entries(packageDefinitions).map(([tier, pkg]) => {
              const TierIcon = tierIcons[tier] || Shield;
              const isActive = currentTier === tier;
              return (
                <div
                  key={tier}
                  data-testid={`package-${tier}`}
                  className={`relative rounded-lg border-2 p-4 cursor-pointer transition-all ${isActive ? "ring-2 ring-primary " + tierColors[tier] : "border-muted hover:border-primary/50"}`}
                  onClick={() => selectPackage(tier)}
                >
                  {isActive && (
                    <div className="absolute -top-2 -right-2">
                      <CheckCircle2 className="h-5 w-5 text-primary bg-background rounded-full" />
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-2">
                    <TierIcon className="h-5 w-5" />
                    <span className="font-semibold">{pkg.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{pkg.description}</p>
                  <p className="text-xs font-medium">{pkg.modules.length} moduler</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <ToggleLeft className="h-5 w-5" />
              Aktiverade moduler
            </span>
            {hasChanges && (
              <Button size="sm" onClick={saveCustomModules} disabled={updateFeatures.isPending} data-testid="button-save-modules">
                {updateFeatures.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Spara ändringar
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(moduleDefinitions).map(([key, mod]) => {
              const isEnabled = localModules.includes(key);
              const isCore = key === "core";
              return (
                <div
                  key={key}
                  data-testid={`module-${key}`}
                  className={`flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer ${isEnabled ? "border-primary/50 bg-primary/5" : "border-muted opacity-60"} ${isCore ? "cursor-default" : ""}`}
                  onClick={() => !isCore && toggleModule(key)}
                >
                  <div className={`mt-0.5 h-5 w-5 rounded border flex items-center justify-center flex-shrink-0 ${isEnabled ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                    {isEnabled && <Check className="h-3 w-3 text-primary-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{mod.label}</span>
                      {isCore && <Lock className="h-3 w-3 text-muted-foreground" />}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{mod.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
