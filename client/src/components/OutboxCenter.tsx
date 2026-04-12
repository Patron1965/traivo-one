import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  CloudUpload,
  RefreshCw,
  AlertTriangle,
  Clock,
  CheckCircle,
  Trash2,
  WifiOff,
  Loader2,
  FileText,
  Camera,
  AlertCircle,
  Package,
  Pencil,
  StickyNote,
} from "lucide-react";
import { getOutboxItems, removeFromOutbox, type OutboxItem } from "@/lib/offlineDatabase";
import { processOutbox } from "@/lib/offlineSync";
import { useToast } from "@/hooks/use-toast";

const MAX_RETRY_COUNT = 5;

interface OutboxCenterProps {
  onBack: () => void;
}

type OutboxStatus = "pending" | "retrying" | "failed";

function getItemStatus(item: OutboxItem): OutboxStatus {
  if (item.retryCount >= MAX_RETRY_COUNT) return "failed";
  if (item.retryCount > 0) return "retrying";
  return "pending";
}

const TYPE_LABELS: Record<string, string> = {
  status_update: "Statusändring",
  photo_upload: "Foto",
  deviation: "Avvikelse",
  material_log: "Material",
  signature: "Signatur",
  note: "Anteckning",
};

const TYPE_ICONS: Record<string, typeof FileText> = {
  status_update: Pencil,
  photo_upload: Camera,
  deviation: AlertTriangle,
  material_log: Package,
  signature: FileText,
  note: StickyNote,
};

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just nu";
  if (minutes < 60) return `${minutes} min sedan`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} tim sedan`;
  return `${Math.floor(hours / 24)} dagar sedan`;
}

export function OutboxCenter({ onBack }: OutboxCenterProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const loadItems = useCallback(async () => {
    try {
      const outboxItems = await getOutboxItems();
      outboxItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setItems(outboxItems);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
    const interval = setInterval(loadItems, 3000);
    return () => clearInterval(interval);
  }, [loadItems]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleSyncNow = async () => {
    if (!navigator.onLine) {
      toast({
        title: "Offline",
        description: "Du måste vara ansluten för att synkronisera.",
        variant: "destructive",
      });
      return;
    }
    setSyncing(true);
    try {
      const result = await processOutbox();
      await loadItems();
      if (result.synced > 0) {
        toast({
          title: "Synkroniserat",
          description: `${result.synced} poster synkroniserade.`,
        });
      } else if (result.failed > 0) {
        toast({
          title: "Synkproblem",
          description: `${result.failed} poster misslyckades.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Inga poster att synka",
          description: "Allt är redan synkroniserat.",
        });
      }
    } catch {
      toast({
        title: "Synkfel",
        description: "Kunde inte synkronisera. Försök igen.",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleRemoveItem = async (id: string) => {
    await removeFromOutbox(id);
    await loadItems();
    toast({ title: "Borttagen", description: "Posten har tagits bort från kön." });
  };

  const pendingItems = items.filter((i) => getItemStatus(i) === "pending");
  const retryingItems = items.filter((i) => getItemStatus(i) === "retrying");
  const failedItems = items.filter((i) => getItemStatus(i) === "failed");

  return (
    <div className="flex flex-col h-full bg-background" data-testid="outbox-center">
      <div className="p-4 border-b bg-card flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          data-testid="button-outbox-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold" data-testid="text-outbox-title">Synkstatus</h1>
          <p className="text-xs text-muted-foreground">
            {items.length === 0
              ? "Inga väntande poster"
              : `${items.length} poster i kön`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isOnline && (
            <Badge variant="destructive" className="gap-1" data-testid="badge-offline">
              <WifiOff className="h-3 w-3" />
              Offline
            </Badge>
          )}
          <Button
            size="sm"
            onClick={handleSyncNow}
            disabled={syncing || items.length === 0}
            data-testid="button-sync-now"
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <CloudUpload className="h-4 w-4 mr-1.5" />
            )}
            {syncing ? "Synkar..." : "Synka nu"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="outbox-empty">
            <CheckCircle className="h-12 w-12 text-green-500 dark:text-green-400 mb-3" />
            <h3 className="text-lg font-medium">Allt synkroniserat</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Det finns inga väntande ändringar i kön.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Card className="border-yellow-200 dark:border-yellow-800" data-testid="stat-pending">
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{pendingItems.length}</div>
                  <div className="text-xs text-muted-foreground">Väntande</div>
                </CardContent>
              </Card>
              <Card className="border-orange-200 dark:border-orange-800" data-testid="stat-retrying">
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{retryingItems.length}</div>
                  <div className="text-xs text-muted-foreground">Försöker igen</div>
                </CardContent>
              </Card>
              <Card className="border-red-200 dark:border-red-800" data-testid="stat-failed">
                <CardContent className="p-3 text-center">
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">{failedItems.length}</div>
                  <div className="text-xs text-muted-foreground">Misslyckade</div>
                </CardContent>
              </Card>
            </div>

            {failedItems.length > 0 && (
              <OutboxGroup
                title="Misslyckade"
                items={failedItems}
                status="failed"
                onRemove={handleRemoveItem}
              />
            )}

            {retryingItems.length > 0 && (
              <OutboxGroup
                title="Försöker igen"
                items={retryingItems}
                status="retrying"
                onRemove={handleRemoveItem}
              />
            )}

            {pendingItems.length > 0 && (
              <OutboxGroup
                title="Väntande"
                items={pendingItems}
                status="pending"
                onRemove={handleRemoveItem}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OutboxGroup({
  title,
  items,
  status,
  onRemove,
}: {
  title: string;
  items: OutboxItem[];
  status: OutboxStatus;
  onRemove: (id: string) => void;
}) {
  const statusConfig = {
    pending: {
      icon: Clock,
      color: "text-yellow-600 dark:text-yellow-400",
      bg: "bg-yellow-50 dark:bg-yellow-900/20",
      border: "border-yellow-200 dark:border-yellow-800",
    },
    retrying: {
      icon: RefreshCw,
      color: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-50 dark:bg-orange-900/20",
      border: "border-orange-200 dark:border-orange-800",
    },
    failed: {
      icon: AlertCircle,
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-900/20",
      border: "border-red-200 dark:border-red-800",
    },
  };

  const config = statusConfig[status];
  const StatusIcon = config.icon;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <StatusIcon className={`h-4 w-4 ${config.color}`} />
        <h3 className="text-sm font-semibold">{title} ({items.length})</h3>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const TypeIcon = TYPE_ICONS[item.type] || FileText;
          return (
            <Card key={item.id} className={config.border} data-testid={`outbox-item-${item.id}`}>
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${config.bg}`}>
                    <TypeIcon className={`h-4 w-4 ${config.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{TYPE_LABELS[item.type] || item.type}</span>
                      {item.retryCount > 0 && (
                        <Badge variant="outline" className="text-[10px] gap-0.5" data-testid={`retry-count-${item.id}`}>
                          <RefreshCw className="h-2.5 w-2.5" />
                          {item.retryCount}/{MAX_RETRY_COUNT}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatTimeAgo(item.createdAt)}
                      {item.workOrderId && ` · Order ${item.workOrderId.slice(0, 8)}...`}
                    </p>
                    {item.lastError && (
                      <div className="mt-1.5 p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" data-testid={`error-msg-${item.id}`}>
                        <p className="text-xs text-red-700 dark:text-red-300 flex items-start gap-1.5">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                          {item.lastError}
                        </p>
                        {item.lastAttemptAt && (
                          <p className="text-[10px] text-red-500 dark:text-red-400 mt-1">
                            Senaste försök: {formatTimeAgo(item.lastAttemptAt)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {status === "failed" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => onRemove(item.id)}
                      data-testid={`button-remove-${item.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
