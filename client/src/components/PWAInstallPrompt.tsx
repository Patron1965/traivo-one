import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Download, X, Share, PlusSquare } from 'lucide-react';
import { usePWAInstall } from '@/hooks/usePWAInstall';

export function PWAInstallPrompt() {
  const { isInstallable, isInstalled, promptInstall, showIOSInstructions } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);

  if (isInstalled || dismissed) return null;
  if (!isInstallable && !showIOSInstructions) return null;

  const handleInstall = async () => {
    const success = await promptInstall();
    if (!success) {
      setDismissed(true);
    }
  };

  return (
    <Card className="fixed bottom-4 left-4 right-4 z-50 shadow-lg border-primary/20 mx-auto max-w-md">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Download className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm">Installera Unicorn</h3>
            {showIOSInstructions ? (
              <p className="text-xs text-muted-foreground mt-1">
                Tryck på <Share className="inline h-3 w-3" /> och sedan "Lägg till på hemskärmen" <PlusSquare className="inline h-3 w-3" />
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                Lägg till appen på din hemskärm för snabb åtkomst
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => setDismissed(true)}
            data-testid="button-dismiss-pwa-prompt"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {!showIOSInstructions && (
          <Button
            className="w-full mt-3"
            size="sm"
            onClick={handleInstall}
            data-testid="button-install-pwa"
          >
            <Download className="h-4 w-4 mr-2" />
            Installera nu
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
