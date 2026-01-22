import { useState, useEffect } from 'react';
import { WifiOff, Wifi, CloudUpload, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useCacheStats } from '@/hooks/useOfflineData';

interface OfflineIndicatorProps {
  isOnline: boolean;
  isSyncing: boolean;
  pendingChanges: number;
  lastSyncAt: Date | null;
  onSyncNow?: () => void;
}

export function OfflineIndicator({
  isOnline,
  isSyncing,
  pendingChanges,
  lastSyncAt,
  onSyncNow,
}: OfflineIndicatorProps) {
  const cacheStats = useCacheStats();
  const [justSynced, setJustSynced] = useState(false);

  useEffect(() => {
    if (lastSyncAt) {
      setJustSynced(true);
      const timer = setTimeout(() => setJustSynced(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [lastSyncAt]);

  const getStatusIcon = () => {
    if (isSyncing) {
      return <Loader2 className="h-4 w-4 animate-spin" />;
    }
    if (justSynced) {
      return <Check className="h-4 w-4 text-green-500" />;
    }
    if (!isOnline) {
      return <WifiOff className="h-4 w-4 text-destructive" />;
    }
    if (pendingChanges > 0) {
      return <CloudUpload className="h-4 w-4 text-yellow-500" />;
    }
    return <Wifi className="h-4 w-4 text-green-500" />;
  };

  const getStatusText = () => {
    if (isSyncing) return 'Synkroniserar...';
    if (justSynced) return 'Synkroniserat';
    if (!isOnline) return 'Offline';
    if (pendingChanges > 0) return `${pendingChanges} väntande`;
    return 'Online';
  };

  const getStatusVariant = (): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (!isOnline) return 'destructive';
    if (pendingChanges > 0) return 'secondary';
    return 'outline';
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge 
          variant={getStatusVariant()}
          className="cursor-pointer gap-1.5 px-2 py-1"
          data-testid="badge-offline-status"
        >
          {getStatusIcon()}
          <span className="text-xs">{getStatusText()}</span>
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Wifi className="h-5 w-5 text-green-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-destructive" />
            )}
            <span className="font-medium">
              {isOnline ? 'Ansluten' : 'Frånkopplad'}
            </span>
          </div>
          
          {!isOnline && (
            <p className="text-xs text-muted-foreground">
              Du arbetar offline. Ändringar sparas lokalt och synkroniseras när du är online igen.
            </p>
          )}

          {pendingChanges > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <span>{pendingChanges} ändringar väntar på synkronisering</span>
            </div>
          )}

          {lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              Senast synkroniserat: {lastSyncAt.toLocaleTimeString('sv-SE')}
            </p>
          )}

          {cacheStats && (
            <div className="border-t pt-2 mt-2">
              <p className="text-xs font-medium mb-1">Cachad data</p>
              <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                <span>Arbetsordrar:</span>
                <span>{cacheStats.workOrderCount}</span>
                <span>Objekt:</span>
                <span>{cacheStats.objectCount}</span>
                <span>Artiklar:</span>
                <span>{cacheStats.articleCount}</span>
                <span>Foton (lokala):</span>
                <span>{cacheStats.pendingPhotos}</span>
              </div>
            </div>
          )}

          {isOnline && pendingChanges > 0 && onSyncNow && (
            <Button 
              size="sm" 
              className="w-full" 
              onClick={onSyncNow}
              disabled={isSyncing}
              data-testid="button-sync-now"
            >
              {isSyncing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Synkroniserar...
                </>
              ) : (
                <>
                  <CloudUpload className="h-4 w-4 mr-2" />
                  Synkronisera nu
                </>
              )}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function OfflineBanner({ isOnline }: { isOnline: boolean }) {
  if (isOnline) return null;

  return (
    <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-2 flex items-center gap-2 text-sm">
      <WifiOff className="h-4 w-4 text-destructive" />
      <span className="text-destructive font-medium">Du är offline</span>
      <span className="text-muted-foreground">
        - Ändringar sparas lokalt och synkroniseras automatiskt
      </span>
    </div>
  );
}
