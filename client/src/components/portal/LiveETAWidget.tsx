import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Truck, Clock, MapPin, Navigation } from "lucide-react";

interface LiveETAData {
  available: boolean;
  etaMinutes?: number;
  etaTime?: string;
  marginMinutes?: number;
  resourceName?: string;
  isEnRoute?: boolean;
  distanceKm?: number;
}

interface LiveETAWidgetProps {
  workOrderId: string;
  objectAddress?: string;
}

function getSessionToken(): string | null {
  return localStorage.getItem("portal_session");
}

export function LiveETAWidget({ workOrderId, objectAddress }: LiveETAWidgetProps) {
  const [eta, setEta] = useState<LiveETAData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    async function fetchETA() {
      try {
        const token = getSessionToken();
        if (!token) return;
        const res = await fetch(`/api/portal/eta/${workOrderId}`, {
          headers: { "x-portal-token": token },
        });
        if (res.ok) {
          setEta(await res.json());
        }
      } catch {
      } finally {
        setLoading(false);
      }
    }

    fetchETA();
    interval = setInterval(fetchETA, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [workOrderId]);

  if (loading || !eta || !eta.available || !eta.isEnRoute) {
    return null;
  }

  return (
    <Card className="border-2 border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20 animate-pulse-slow" data-testid={`eta-widget-${workOrderId}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-green-100 dark:bg-green-800">
            <Truck className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-green-800 dark:text-green-300">
                Tekniker på väg!
              </span>
              <Badge variant="outline" className="border-green-500 text-green-700 dark:text-green-400 text-xs">
                Live
              </Badge>
            </div>

            {eta.resourceName && (
              <p className="text-sm text-muted-foreground mb-2">
                <Navigation className="h-3 w-3 inline mr-1" />
                {eta.resourceName}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 mt-2">
              {eta.etaTime && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-green-600" />
                  <div>
                    <p className="text-lg font-bold text-green-800 dark:text-green-300">
                      {eta.etaTime}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ±{eta.marginMinutes || 15} min
                    </p>
                  </div>
                </div>
              )}

              {eta.etaMinutes !== undefined && (
                <div className="flex items-center gap-1.5">
                  <Truck className="h-4 w-4 text-green-600" />
                  <div>
                    <p className="text-lg font-bold text-green-800 dark:text-green-300">
                      {eta.etaMinutes} min
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {eta.distanceKm ? `${eta.distanceKm} km` : "beräknad tid"}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {objectAddress && (
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {objectAddress}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
