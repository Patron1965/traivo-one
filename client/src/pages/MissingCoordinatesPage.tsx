import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertTriangle, MapPin, Loader2, RefreshCw, Building2, Layers, ExternalLink, Save, X, Play } from "lucide-react";
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

interface EditDraft {
  address: string;
  postalCode: string;
  city: string;
}

export default function MissingCoordinatesPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EditDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const { data, isLoading } = useQuery<MissingResponse>({
    queryKey: ["/api/objects/missing-coordinates"],
  });

  const { data: trend } = useQuery<TrendResponse>({
    queryKey: ["/api/objects/missing-coordinates/trend"],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/objects/missing-coordinates"] });
    queryClient.invalidateQueries({ queryKey: ["/api/objects/missing-coordinates/trend"] });
  };

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
        invalidate();
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

  const saveAddressMutation = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: EditDraft }) => {
      const res = await apiRequest("PATCH", `/api/objects/${id}`, {
        address: draft.address || null,
        postalCode: draft.postalCode || null,
        city: draft.city || null,
      });
      return await res.json();
    },
    onMutate: ({ id }) => setSavingId(id),
    onSettled: () => setSavingId(null),
    onSuccess: (_res, { id }) => {
      toast({ title: "Adress sparad", description: "Geokodning körs i bakgrunden." });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte spara", description: err.message, variant: "destructive" });
    },
  });

  const items = data?.items || [];
  const filtered = useMemo(() => items.filter((it) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      it.name.toLowerCase().includes(s) ||
      (it.address || "").toLowerCase().includes(s) ||
      (it.city || "").toLowerCase().includes(s) ||
      (it.customerName || "").toLowerCase().includes(s) ||
      (it.objectNumber || "").toLowerCase().includes(s)
    );
  }), [items, search]);

  const trendSnapshots = trend?.snapshots || [];
  const maxTrend = Math.max(1, ...trendSnapshots.map((s) => s.missingCount));
  const previousSnapshot = trendSnapshots.length >= 2 ? trendSnapshots[trendSnapshots.length - 2] : null;
  const currentMissing = data?.summary.missingCount ?? 0;
  const delta = previousSnapshot ? currentMissing - previousSnapshot.missingCount : 0;

  const getDraft = (item: MissingItem): EditDraft =>
    drafts[item.id] ?? {
      address: item.address ?? "",
      postalCode: item.postalCode ?? "",
      city: item.city ?? "",
    };

  const isDirty = (item: MissingItem): boolean => {
    const d = drafts[item.id];
    if (!d) return false;
    return (
      d.address !== (item.address ?? "") ||
      d.postalCode !== (item.postalCode ?? "") ||
      d.city !== (item.city ?? "")
    );
  };

  const updateDraft = (item: MissingItem, patch: Partial<EditDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [item.id]: { ...getDraft(item), ...patch },
    }));
  };

  const cancelDraft = (id: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const toggleSelected = (id: string, value: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (value) next.add(id); else next.delete(id);
      return next;
    });
  };

  const toggleSelectAll = (value: boolean) => {
    if (!value) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(filtered.map((i) => i.id)));
  };

  const filteredSelected = useMemo(
    () => filtered.filter((i) => selected.has(i.id)),
    [filtered, selected],
  );
  const selectedInViewCount = filteredSelected.length;
  const allSelected = filtered.length > 0 && filteredSelected.length === filtered.length;
  const someSelected = selectedInViewCount > 0 && !allSelected;

  const runBulkGeocode = async () => {
    const targets = filteredSelected;
    if (targets.length === 0) return;
    setBulkRunning(true);

    const dirtyTargets = targets.filter((t) => isDirty(t));
    if (dirtyTargets.length > 0) {
      setBulkProgress({ done: 0, total: targets.length + dirtyTargets.length });
      let saveFailed = 0;
      for (const t of dirtyTargets) {
        try {
          await apiRequest("PATCH", `/api/objects/${t.id}`, {
            address: drafts[t.id]?.address || null,
            postalCode: drafts[t.id]?.postalCode || null,
            city: drafts[t.id]?.city || null,
          });
          setDrafts((prev) => {
            const next = { ...prev };
            delete next[t.id];
            return next;
          });
        } catch {
          saveFailed++;
        }
        setBulkProgress((p) => p ? { ...p, done: p.done + 1 } : p);
      }
      if (saveFailed > 0) {
        toast({
          title: "Kunde inte spara alla ändringar",
          description: `${saveFailed} adress(er) sparades inte och hoppas över.`,
          variant: "destructive",
        });
      }
    } else {
      setBulkProgress({ done: 0, total: targets.length });
    }

    const ids = targets.map((t) => t.id);
    let success = 0;
    let failed = 0;
    const concurrency = 4;
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const idx = cursor++;
        const id = ids[idx];
        try {
          const res = await apiRequest("POST", `/api/objects/${id}/geocode`, { force: true });
          const result = (await res.json()) as GeocodeResult;
          if (result.status === "geocoded") success++; else failed++;
        } catch {
          failed++;
        }
        setBulkProgress((p) => p ? { ...p, done: p.done + 1 } : p);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
    setBulkRunning(false);
    setBulkProgress(null);
    setSelected(new Set());
    invalidate();
    toast({
      title: "Massgeokodning klar",
      description: `${success} lyckades, ${failed} misslyckades av ${ids.length}.`,
      variant: failed > 0 && success === 0 ? "destructive" : "default",
    });
  };

  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-6">
      <PageHeader
        title="Objekt utan koordinater"
        description="Lista över objekt som saknar lat/lng. Redigera adresser inline och kör geokodning på flera markerade rader samtidigt."
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

          {filtered.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 p-3 rounded-md border bg-muted/30" data-testid="bulk-toolbar">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(v) => toggleSelectAll(v === true)}
                  data-testid="checkbox-select-all"
                  aria-label="Markera alla"
                />
                <span className="text-sm text-muted-foreground" data-testid="text-selected-count">
                  {selectedInViewCount} av {filtered.length} markerade
                </span>
              </div>
              <div className="flex-1" />
              {bulkProgress && (
                <span className="text-xs text-muted-foreground" data-testid="text-bulk-progress">
                  {bulkProgress.done}/{bulkProgress.total} klara…
                </span>
              )}
              <Button
                size="sm"
                onClick={runBulkGeocode}
                disabled={bulkRunning || selectedInViewCount === 0}
                data-testid="button-bulk-geocode"
              >
                {bulkRunning ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-1" />
                )}
                Geokoda valda ({selectedInViewCount})
              </Button>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
          )}
          {!isLoading && filtered.length === 0 && (
            <Card><CardContent className="p-8 text-center text-muted-foreground" data-testid="text-empty">
              {items.length === 0 ? "Alla objekt med adress har koordinater 🎉" : "Inga träffar för sökningen."}
            </CardContent></Card>
          )}
          {filtered.map((item) => {
            const draft = getDraft(item);
            const dirty = isDirty(item);
            const isSaving = savingId === item.id;
            return (
              <Card key={item.id} data-testid={`card-missing-${item.id}`}>
                <CardContent className="p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      className="mt-1"
                      checked={selected.has(item.id)}
                      onCheckedChange={(v) => toggleSelected(item.id, v === true)}
                      data-testid={`checkbox-select-${item.id}`}
                      aria-label={`Markera ${item.name}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium truncate" data-testid={`text-name-${item.id}`}>{item.name}</span>
                        {item.objectNumber && <Badge variant="outline" data-testid={`badge-number-${item.id}`}>#{item.objectNumber}</Badge>}
                        {item.customerName && <Badge variant="secondary" data-testid={`badge-customer-${item.id}`}><Building2 className="h-3 w-3 mr-1" />{item.customerName}</Badge>}
                        {item.clusterName && <Badge variant="secondary" data-testid={`badge-cluster-${item.id}`}><Layers className="h-3 w-3 mr-1" />{item.clusterName}</Badge>}
                        {dirty && <Badge variant="destructive" data-testid={`badge-dirty-${item.id}`}>Ändrad</Badge>}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
                    <div>
                      <label className="text-xs text-muted-foreground">Adress</label>
                      <Input
                        value={draft.address}
                        onChange={(e) => updateDraft(item, { address: e.target.value })}
                        placeholder="Gatuadress"
                        data-testid={`input-address-${item.id}`}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Postnummer</label>
                      <Input
                        value={draft.postalCode}
                        onChange={(e) => updateDraft(item, { postalCode: e.target.value })}
                        placeholder="123 45"
                        data-testid={`input-postal-${item.id}`}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Ort</label>
                      <Input
                        value={draft.city}
                        onChange={(e) => updateDraft(item, { city: e.target.value })}
                        placeholder="Ort"
                        data-testid={`input-city-${item.id}`}
                      />
                    </div>
                    <div className="flex gap-2">
                      {dirty ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => saveAddressMutation.mutate({ id: item.id, draft })}
                            disabled={isSaving}
                            data-testid={`button-save-${item.id}`}
                          >
                            {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                            Spara
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => cancelDraft(item.id)}
                            disabled={isSaving}
                            data-testid={`button-cancel-${item.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Link href={`/objects/${item.id}`}>
                            <Button variant="outline" size="sm" data-testid={`button-edit-${item.id}`}>
                              <ExternalLink className="h-4 w-4 mr-1" />Öppna
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
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
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
