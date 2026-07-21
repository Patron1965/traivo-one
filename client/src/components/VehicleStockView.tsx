// === Bil-lager (Lagermodul 2.0) — teknikerns saldo-vy i Traivo Go ===
// Läser GET /api/mobile/stock/my-vehicle (bearer-auth) och visar saldot per
// artikel för teknikerns bil-lagerplats, med lågt-saldo-varningar.
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Truck, AlertTriangle, PackageOpen, RefreshCw } from "lucide-react";

interface VehicleStockBalance {
  id: string;
  articleId: string;
  articleNumber: string;
  articleName: string;
  location: string;
  balance: number;
  effectiveReorderPoint: number | null;
  safetyStock: number | null;
  isLow: boolean;
}

interface VehicleStockResponse {
  hasVehicleLocation: boolean;
  location: string | null;
  balances: VehicleStockBalance[];
  lowCount: number;
}

interface VehicleStockViewProps {
  onBack: () => void;
  mobileApiCall: (method: string, url: string, body?: unknown) => Promise<Response>;
}

export function VehicleStockView({ onBack, mobileApiCall }: VehicleStockViewProps) {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery<VehicleStockResponse>({
    queryKey: ["mobile-vehicle-stock"],
    queryFn: async () => {
      const res = await mobileApiCall("GET", "/api/mobile/stock/my-vehicle");
      return res.json();
    },
    staleTime: 30_000,
  });

  const lowItems = (data?.balances ?? []).filter((b) => b.isLow);
  const okItems = (data?.balances ?? []).filter((b) => !b.isLow);

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-4 border-b bg-card flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-from-stock">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Truck className="h-5 w-5 text-chart-2" />
            Bil-lager
          </h1>
          {data?.location && (
            <p className="text-sm text-muted-foreground truncate" data-testid="text-vehicle-location">
              {data.location}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          disabled={isRefetching}
          data-testid="button-refresh-stock"
        >
          <RefreshCw className={`h-5 w-5 ${isRefetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && (
          <p className="text-center text-muted-foreground py-8" data-testid="text-stock-loading">
            Hämtar bilsaldo…
          </p>
        )}

        {isError && (
          <p className="text-center text-destructive py-8" data-testid="text-stock-error">
            Kunde inte hämta bilsaldot. Försök igen.
          </p>
        )}

        {!isLoading && !isError && data && !data.hasVehicleLocation && (
          <div className="text-center py-12 space-y-2" data-testid="text-no-vehicle-location">
            <PackageOpen className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="font-medium">Ingen bil-lagerplats kopplad</p>
            <p className="text-sm text-muted-foreground">
              Din resurs eller ditt team har ingen aktiv bil-lagerplats. Kontakta planeringen.
            </p>
          </div>
        )}

        {!isLoading && !isError && data?.hasVehicleLocation && data.balances.length === 0 && (
          <div className="text-center py-12 space-y-2" data-testid="text-stock-empty">
            <PackageOpen className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="font-medium">Inga saldon ännu</p>
            <p className="text-sm text-muted-foreground">
              Bilen har inga registrerade artikelsaldon.
            </p>
          </div>
        )}

        {lowItems.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 flex items-center gap-2" data-testid="banner-low-stock">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <p className="text-sm font-medium">
              {lowItems.length} artikel{lowItems.length === 1 ? "" : "ar"} på eller under beställningspunkten
            </p>
          </div>
        )}

        {[...lowItems, ...okItems].map((b) => (
          <Card key={b.id} data-testid={`card-stock-${b.id}`}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate" data-testid={`text-stock-article-${b.id}`}>
                  {b.articleName || b.articleNumber || "Okänd artikel"}
                </p>
                {b.articleNumber && (
                  <p className="text-xs text-muted-foreground">{b.articleNumber}</p>
                )}
                {b.effectiveReorderPoint != null && (
                  <p className="text-xs text-muted-foreground">
                    Beställningspunkt: {b.effectiveReorderPoint}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className={`text-xl font-bold ${b.isLow ? "text-warning" : ""}`} data-testid={`text-stock-balance-${b.id}`}>
                  {b.balance}
                </p>
                {b.isLow && (
                  <Badge variant="outline" className="border-warning text-warning gap-1" data-testid={`badge-low-${b.id}`}>
                    <AlertTriangle className="h-3 w-3" />
                    Lågt
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
