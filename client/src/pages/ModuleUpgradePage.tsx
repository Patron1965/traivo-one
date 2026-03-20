import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, ArrowLeft, Sparkles } from "lucide-react";
import { useFeatures } from "@/lib/feature-context";
import { MODULE_DEFINITIONS, PACKAGE_DEFINITIONS, getModuleForRoute } from "@shared/modules";

export default function ModuleUpgradePage() {
  const [location, setLocation] = useLocation();
  const { packageTier } = useFeatures();
  const moduleKey = getModuleForRoute(location);
  const moduleDef = moduleKey ? MODULE_DEFINITIONS[moduleKey] : null;

  const currentPackage = PACKAGE_DEFINITIONS[packageTier] || PACKAGE_DEFINITIONS.basic;

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6" data-testid="module-upgrade-page">
      <Card className="max-w-lg w-full">
        <CardContent className="p-8 text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Lock className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold" data-testid="text-module-name">
              {moduleDef?.label || "Modul"} \u00e4r inte aktiverad
            </h2>
            <p className="text-muted-foreground text-sm">
              Denna funktion ing\u00e5r inte i ditt nuvarande paket ({currentPackage.label}).
              Kontakta din administrat\u00f6r f\u00f6r att uppgradera.
            </p>
          </div>

          {moduleDef && (
            <div className="bg-muted/50 rounded-lg p-4 text-left">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium">{moduleDef.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{moduleDef.description}</p>
            </div>
          )}

          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-back-home">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Tillbaka
            </Button>
            <Button onClick={() => setLocation("/tenant-config")} data-testid="button-go-settings">
              Företagsinställningar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
