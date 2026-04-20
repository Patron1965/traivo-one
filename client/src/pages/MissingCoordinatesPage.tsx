import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertTriangle, MapPin, Loader2, RefreshCw, Building2, Layers, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

interface MissingItem {
  id: string;
  name: string;
  objectNumber: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  customerId: string | null;
  customerName: string | null;
  clusterId: string | null;
  clusterName: string | null;
}

interface MissingResponse {
  summary: { missingCount: number; totalWithAddress: number; totalObjects: number };
  items: MissingItem[];
  byCustomer: { customerId: string; customerName: string; count: number }[];
  byCluster: { clusterId: string; clusterName: string; count: number }[];
}

interface TrendResponse {
  days: number;
  snapshots: { date: string; missingCount: number; totalWithAddress: number; totalObjects: number }[];
}

interface GeocodeResult {
  objectId: string;
  status: "geocoded" | "skipped" | "no-result" | "error";
  reason?: string;
  latitude?: number;
  longitude?: number;
}

export default function MissingCoordinatesPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<MissingResponse>({
    queryKey: ["/api/objects/missing-coordinates"],
  });

  const { data: trend } = useQuery<TrendResponse>({
    queryKey: ["/api/objects/missing-coordinates/trend"],
  });

  const retryMutation = useMutation({
    mutationFn: async (objectId: string) => {
      const res = await apiRequest("POST", `/api/objects/${objectId}/geocode`, { force: true });
      return (await res.json()) as GeocodeResult;
    },
    onMutate: (id) => setRetryingId(id),
    onSettled: () => setRetryingId(null),
    onSuccess: (result) => {
      if (result.status === "geocoded") {
        toast({ title: "Geokodning lyckades", description: `Koordinater satta (${result.latitude?.toFixed(5)}, ${result.longitude?.toFixed(5)})` });
        queryClient.invalidateQueries({ queryKey: ["/api/objects/missing-coordinates"] });
        queryClient.invalidateQueries({ queryKey: ["/api/objects/missing-coordinates/trend"] });
      } else {
        toast({
          title: result.status === "no-result" ? "Inget träff" : "Geokodning misslyckades",
          description: result.reason || "Försök igen senare eller rätta adressen.",
          variant: "destructive",
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Fel", description: err.message, variant: "destructive" });
    },
  });

  const items = data?.items || [];
  const filtered = items.filter((it) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      it.name.toLowerCase().includes(s) ||
      (it.address || "").toLowerCase().includes(s) ||
      (it.city || "").toLowerCase().includes(s) ||
      (it.customerName || "").toLowerCase().includes(s) ||
      (it.objectNumber || "").toLowerCase().includes(s)
    );
  });

  const trendSnapshots = trend?.snapshots || [];
  const maxTrend = Math.max(1, ...trendSnapshots.map((s) => s.missingCount));
  const previousSnapshot = trendSnapshots.length >= 2 ? trendSnapshots[trendSnapshots.length - 2] : null;
  const currentMissing = data?.summary.missingCount ?? 0;
  const delta = previousSnapshot ? currentMissing - previousSnapshot.missingCount : 0;

  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-6">
      <PageHeader
        title="Objekt utan koordinater"
        description="Lista över objekt som saknar lat/lng. Använd 'Försök igen' för att köra geokodning på nytt eller öppna objektet för att rätta adressen."
        icon={MapPin}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-summary-missing">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Saknar koordinater</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <div>
                <div className="text-3xl font-bold" data-testid="text-missing-count">{currentMissing}</div>
                {previousSnapshot && (
                  <div className={`text-xs ${delta > 0 ? "text-red-500" : delta < 0 ? "text-green-600" : "text-muted-foreground"}`} data-testid="text-missing-delta">
                    {delta > 0 ? `+${delta}` : delta} sedan föregående mätning
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-summary-with-address">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Objekt med adress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-with-address-count">{data?.summary.totalWithAddress ?? 0}</div>
            <div className="text-xs text-muted-foreground">av {data?.summary.totalObjects ?? 0} totalt</div>
          </CardContent>
        </Card>

        <Card data-testid="card-summary-coverage">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Täckning</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-coverage-pct">
              {data && data.summary.totalWithAddress > 0
                ? `${Math.round(((data.summary.totalWithAddress - data.summary.missingCount) / data.summary.totalWithAddress) * 100)}%`
                : "—"}
            </div>
            <div className="text-xs text-muted-foreground">av objekt med adress är geokodade</div>
          </CardContent>
        </Card>
      </div>

      {trendSnapshots.length > 0 && (
        <Card data-testid="card-trend">
          <CardHeader>
            <CardTitle>Trend ({trendSnapshots.length} mätpunkter)</CardTitle>
            <CardDescription>Antal objekt utan koordinater över tid</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-24" data-testid="chart-trend">
              {trendSnapshots.map((s) => (
                <div
                  key={s.date}
                  className="flex-1 bg-amber-500/70 hover:bg-amber-500 rounded-t min-w-[6px]"
                  style={{ height: `${(s.missingCount / maxTrend) * 100}%` }}
                  title={`${s.date}: ${s.missingCount} utan koordinater`}
                  data-testid={`bar-trend-${s.date}`}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>{trendSnapshots[0]?.date}</span>
              <span>{trendSnapshots[trendSnapshots.length - 1]?.date}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list" data-testid="tab-list">Lista ({items.length})</TabsTrigger>
          <TabsTrigger value="byCustomer" data-testid="tab-by-customer">Per kund ({data?.byCustomer.length ?? 0})</TabsTrigger>
          <TabsTrigger value="byCluster" data-testid="tab-by-cluster">Per kluster ({data?.byCluster.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3">
          <Input
            placeholder="Sök på namn, adress, kund eller objektnummer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search"
          />
          {isLoading && (
            <div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
          )}
          {!isLoading && filtered.length === 0 && (
            <Card><CardContent className="p-8 text-center text-muted-foreground" data-testid="text-empty">
              {items.length === 0 ? "Alla objekt med adress har koordinater 🎉" : "Inga träffar för sökningen."}
            </CardContent></Card>
          )}
          {filtered.map((item) => (
            <Card key={item.id} data-testid={`card-missing-${item.id}`}>
              <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium truncate" data-testid={`text-name-${item.id}`}>{item.name}</span>
                    {item.objectNumber && <Badge variant="outline" data-testid={`badge-number-${item.id}`}>#{item.objectNumber}</Badge>}
                    {item.customerName && <Badge variant="secondary" data-testid={`badge-customer-${item.id}`}><Building2 className="h-3 w-3 mr-1" />{item.customerName}</Badge>}
                    {item.clusterName && <Badge variant="secondary" data-testid={`badge-cluster-${item.id}`}><Layers className="h-3 w-3 mr-1" />{item.clusterName}</Badge>}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1" data-testid={`text-address-${item.id}`}>
                    {[item.address, item.postalCode, item.city].filter(Boolean).join(", ") || "(ingen adress)"}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link href={`/objects/${item.id}`}>
                    <Button variant="outline" size="sm" data-testid={`button-edit-${item.id}`}>
                      <ExternalLink className="h-4 w-4 mr-1" />Rätta adress
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    onClick={() => retryMutation.mutate(item.id)}
                    disabled={retryingId === item.id}
                    data-testid={`button-retry-${item.id}`}
                  >
                    {retryingId === item.id ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1" />
                    )}
                    Försök igen
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="byCustomer">
          <Card>
            <CardContent className="p-0">
              {(data?.byCustomer || []).map((g) => (
                <div key={g.customerId} className="flex items-center justify-between p-3 border-b last:border-0" data-testid={`row-customer-${g.customerId}`}>
                  <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />{g.customerName}</div>
                  <Badge variant="outline">{g.count}</Badge>
                </div>
              ))}
              {(data?.byCustomer || []).length === 0 && (
                <div className="p-8 text-center text-muted-foreground">Inga objekt utan koordinater.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="byCluster">
          <Card>
            <CardContent className="p-0">
              {(data?.byCluster || []).map((g) => (
                <div key={g.clusterId} className="flex items-center justify-between p-3 border-b last:border-0" data-testid={`row-cluster-${g.clusterId}`}>
                  <div className="flex items-center gap-2"><Layers className="h-4 w-4 text-muted-foreground" />{g.clusterName}</div>
                  <Badge variant="outline">{g.count}</Badge>
                </div>
              ))}
              {(data?.byCluster || []).length === 0 && (
                <div className="p-8 text-center text-muted-foreground">Inga objekt utan koordinater.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
