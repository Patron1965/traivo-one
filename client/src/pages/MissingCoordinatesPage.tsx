import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertTriangle, MapPin, Loader2, RefreshCw, Building2, Layers, ExternalLink, Save, X, Play, Bell, Plus, Trash2, Check } from "lucide-react";
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
  latitude?: number;
  longitude?: number;
}

interface AddressSuggestion {
  formattedAddress: string;
  street?: string;
  houseNumber?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  latitude: number;
  longitude: number;
  placeId?: string;
  resultType?: string;
}

interface SuggestionState {
  items: AddressSuggestion[];
  loading: boolean;
  open: boolean;
  query: string;
}

interface NotificationSettings {
  enabled: boolean;
  recipients: string[];
  defaultRecipients: string[];
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
  const [newRecipient, setNewRecipient] = useState("");
  const [suggestState, setSuggestState] = useState<Record<string, SuggestionState>>({});
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const suggestRequestSeq = useRef<Record<string, number>>({});

  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  const { data, isLoading } = useQuery<MissingResponse>({
    queryKey: ["/api/objects/missing-coordinates"],
  });

  const { data: trend } = useQuery<TrendResponse>({
    queryKey: ["/api/objects/missing-coordinates/trend"],
  });

  const { data: notifSettings, isLoading: notifLoading } = useQuery<NotificationSettings>({
    queryKey: ["/api/objects/missing-coordinates/notification-settings"],
  });

  const saveNotifMutation = useMutation({
    mutationFn: async (next: { enabled: boolean; recipients: string[] }) => {
      const res = await apiRequest("PUT", "/api/objects/missing-coordinates/notification-settings", next);
      return (await res.json()) as NotificationSettings;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/objects/missing-coordinates/notification-settings"], data);
      toast({ title: "Sparat", description: "Notisinställningar uppdaterade." });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte spara", description: err.message, variant: "destructive" });
    },
  });

  const updateNotif = (patch: Partial<{ enabled: boolean; recipients: string[] }>) => {
    if (!notifSettings) return;
    saveNotifMutation.mutate({
      enabled: patch.enabled ?? notifSettings.enabled,
      recipients: patch.recipients ?? notifSettings.recipients,
    });
  };

  const addRecipient = () => {
    const email = newRecipient.trim().toLowerCase();
    if (!email || !notifSettings) return;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(email)) {
      toast({ title: "Ogiltig e-post", description: email, variant: "destructive" });
      return;
    }
    if (notifSettings.recipients.includes(email)) {
      setNewRecipient("");
      return;
    }
    updateNotif({ recipients: [...notifSettings.recipients, email] });
    setNewRecipient("");
  };

  const removeRecipient = (email: string) => {
    if (!notifSettings) return;
    updateNotif({ recipients: notifSettings.recipients.filter((r) => r !== email) });
  };

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

  const buildSavePayload = (draft: EditDraft): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      address: draft.address || null,
      postalCode: draft.postalCode || null,
      city: draft.city || null,
    };
    if (
      typeof draft.latitude === "number" &&
      typeof draft.longitude === "number" &&
      Number.isFinite(draft.latitude) &&
      Number.isFinite(draft.longitude)
    ) {
      payload.latitude = draft.latitude;
      payload.longitude = draft.longitude;
    }
    return payload;
  };

  const saveAddressMutation = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: EditDraft }) => {
      const res = await apiRequest("PATCH", `/api/objects/${id}`, buildSavePayload(draft));
      return await res.json();
    },
    onMutate: ({ id }) => setSavingId(id),
    onSettled: () => setSavingId(null),
    onSuccess: (_res, { id, draft }) => {
      const usedSuggestion =
        typeof draft.latitude === "number" && typeof draft.longitude === "number";
      toast({
        title: "Adress sparad",
        description: usedSuggestion
          ? "Koordinater satta direkt från valt förslag."
          : "Geokodning körs i bakgrunden.",
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setSuggestState((prev) => {
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
    if (
      typeof d.latitude === "number" &&
      typeof d.longitude === "number" &&
      Number.isFinite(d.latitude) &&
      Number.isFinite(d.longitude)
    ) {
      return true;
    }
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

  const fetchSuggestionsFor = (id: string, text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      setSuggestState((prev) => ({
        ...prev,
        [id]: { items: [], loading: false, open: false, query: trimmed },
      }));
      return;
    }
    const seq = (suggestRequestSeq.current[id] ?? 0) + 1;
    suggestRequestSeq.current[id] = seq;
    setSuggestState((prev) => ({
      ...prev,
      [id]: {
        items: prev[id]?.items ?? [],
        loading: true,
        open: true,
        query: trimmed,
      },
    }));
    fetch(`/api/geocode/autocomplete?text=${encodeURIComponent(trimmed)}&limit=6`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { suggestions: AddressSuggestion[] };
      })
      .then((data) => {
        if (suggestRequestSeq.current[id] !== seq) return;
        setSuggestState((prev) => ({
          ...prev,
          [id]: {
            items: data.suggestions || [],
            loading: false,
            open: true,
            query: trimmed,
          },
        }));
      })
      .catch(() => {
        if (suggestRequestSeq.current[id] !== seq) return;
        setSuggestState((prev) => ({
          ...prev,
          [id]: { items: [], loading: false, open: false, query: trimmed },
        }));
      });
  };

  const handleAddressInputChange = (item: MissingItem, value: string) => {
    updateDraft(item, {
      address: value,
      latitude: undefined,
      longitude: undefined,
    });
    if (debounceTimers.current[item.id]) {
      clearTimeout(debounceTimers.current[item.id]);
    }
    debounceTimers.current[item.id] = setTimeout(() => {
      fetchSuggestionsFor(item.id, value);
    }, 250);
  };

  const selectSuggestion = (item: MissingItem, suggestion: AddressSuggestion) => {
    if (debounceTimers.current[item.id]) {
      clearTimeout(debounceTimers.current[item.id]);
    }
    suggestRequestSeq.current[item.id] = (suggestRequestSeq.current[item.id] ?? 0) + 1;
    const street = suggestion.address || suggestion.street || suggestion.formattedAddress.split(",")[0]?.trim() || "";
    updateDraft(item, {
      address: street,
      postalCode: suggestion.postalCode ?? "",
      city: suggestion.city ?? "",
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
    });
    setSuggestState((prev) => ({
      ...prev,
      [item.id]: { items: [], loading: false, open: false, query: street },
    }));
  };

  const closeSuggestions = (id: string) => {
    setSuggestState((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, open: false } };
    });
  };

  const cancelDraft = (id: string) => {
    if (debounceTimers.current[id]) {
      clearTimeout(debounceTimers.current[id]);
    }
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSuggestState((prev) => {
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
    const dirtyWithCoords = new Set<string>();
    if (dirtyTargets.length > 0) {
      setBulkProgress({ done: 0, total: targets.length + dirtyTargets.length });
      let saveFailed = 0;
      for (const t of dirtyTargets) {
        const draft = drafts[t.id];
        try {
          if (draft) {
            await apiRequest("PATCH", `/api/objects/${t.id}`, buildSavePayload(draft));
            if (typeof draft.latitude === "number" && typeof draft.longitude === "number") {
              dirtyWithCoords.add(t.id);
            }
          }
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
    let skippedFromSuggestion = 0;
    const concurrency = 4;
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const idx = cursor++;
        const id = ids[idx];
        if (dirtyWithCoords.has(id)) {
          skippedFromSuggestion++;
          success++;
          setBulkProgress((p) => p ? { ...p, done: p.done + 1 } : p);
          continue;
        }
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
    const skippedSuffix = skippedFromSuggestion > 0
      ? ` (${skippedFromSuggestion} satt direkt från valt förslag)`
      : "";
    toast({
      title: "Massgeokodning klar",
      description: `${success} lyckades, ${failed} misslyckades av ${ids.length}.${skippedSuffix}`,
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
          <TabsTrigger value="notifications" data-testid="tab-notifications">
            <Bell className="h-4 w-4 mr-1" />Notiser
          </TabsTrigger>
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
            const sugg = suggestState[item.id];
            const hasCoords = typeof draft.latitude === "number" && typeof draft.longitude === "number";
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
                        {hasCoords && (
                          <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700" data-testid={`badge-suggestion-${item.id}`}>
                            <Check className="h-3 w-3 mr-1" />Förslag valt
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
                    <div className="relative">
                      <label className="text-xs text-muted-foreground">Adress</label>
                      <Input
                        value={draft.address}
                        onChange={(e) => handleAddressInputChange(item, e.target.value)}
                        onFocus={() => {
                          if ((suggestState[item.id]?.items.length ?? 0) > 0) {
                            setSuggestState((prev) => ({
                              ...prev,
                              [item.id]: { ...prev[item.id], open: true } as SuggestionState,
                            }));
                          }
                        }}
                        onBlur={() => {
                          setTimeout(() => closeSuggestions(item.id), 150);
                        }}
                        placeholder="Gatuadress"
                        autoComplete="off"
                        data-testid={`input-address-${item.id}`}
                      />
                      {sugg?.open && (sugg.loading || sugg.items.length > 0) && (
                        <div
                          className="absolute z-30 mt-1 w-full max-w-[480px] rounded-md border bg-popover text-popover-foreground shadow-lg"
                          data-testid={`suggestions-${item.id}`}
                        >
                          {sugg.loading && sugg.items.length === 0 ? (
                            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground" data-testid={`suggestions-loading-${item.id}`}>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Söker adresser…
                            </div>
                          ) : (
                            <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
                              {sugg.items.map((s, idx) => (
                                <li key={`${s.placeId ?? idx}-${s.formattedAddress}`}>
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => selectSuggestion(item, s)}
                                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover-elevate active-elevate-2"
                                    data-testid={`suggestion-${item.id}-${idx}`}
                                  >
                                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 flex-1">
                                      <div className="font-medium truncate">{s.address || s.formattedAddress.split(",")[0]}</div>
                                      <div className="text-xs text-muted-foreground truncate">
                                        {[s.postalCode, s.city].filter(Boolean).join(" ") || s.formattedAddress}
                                      </div>
                                    </div>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Postnummer</label>
                      <Input
                        value={draft.postalCode}
                        onChange={(e) => updateDraft(item, {
                          postalCode: e.target.value,
                          latitude: undefined,
                          longitude: undefined,
                        })}
                        placeholder="123 45"
                        data-testid={`input-postal-${item.id}`}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Ort</label>
                      <Input
                        value={draft.city}
                        onChange={(e) => updateDraft(item, {
                          city: e.target.value,
                          latitude: undefined,
                          longitude: undefined,
                        })}
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

        <TabsContent value="notifications" className="space-y-4">
          <Card data-testid="card-notification-settings">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                E-postnotiser för saknade koordinater
              </CardTitle>
              <CardDescription>
                Välj vilka som ska få e-post när antalet objekt utan koordinater ökar. Lämnar du listan tom skickas notisen automatiskt till alla owners/admins (eller tenantens kontakt-e-post).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {notifLoading || !notifSettings ? (
                <div className="flex items-center justify-center p-6">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-4 p-3 rounded-md border">
                    <div className="space-y-1">
                      <Label htmlFor="notif-enabled" className="text-base">
                        Skicka notiser
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Stäng av om du inte vill att Traivo skickar e-post om koordinatkvalitet för denna tenant.
                      </p>
                    </div>
                    <Switch
                      id="notif-enabled"
                      checked={notifSettings.enabled}
                      onCheckedChange={(v) => updateNotif({ enabled: v })}
                      disabled={saveNotifMutation.isPending}
                      data-testid="switch-notif-enabled"
                    />
                  </div>

                  <div className="space-y-3">
                    <div>
                      <Label className="text-base">Mottagare</Label>
                      <p className="text-sm text-muted-foreground">
                        Lägg till specifika e-postadresser som ska få notiserna. Är listan tom används standardmottagarna nedan.
                      </p>
                    </div>

                    {notifSettings.recipients.length === 0 ? (
                      <div className="text-sm text-muted-foreground italic" data-testid="text-no-custom-recipients">
                        Inga specifika mottagare valda – standardmottagare används.
                      </div>
                    ) : (
                      <ul className="space-y-2" data-testid="list-recipients">
                        {notifSettings.recipients.map((email) => (
                          <li
                            key={email}
                            className="flex items-center justify-between gap-2 p-2 rounded-md border bg-muted/30"
                            data-testid={`row-recipient-${email}`}
                          >
                            <span className="text-sm font-mono truncate">{email}</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeRecipient(email)}
                              disabled={saveNotifMutation.isPending}
                              data-testid={`button-remove-recipient-${email}`}
                              aria-label={`Ta bort ${email}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="flex gap-2">
                      <Input
                        type="email"
                        placeholder="namn@foretag.se"
                        value={newRecipient}
                        onChange={(e) => setNewRecipient(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addRecipient();
                          }
                        }}
                        disabled={saveNotifMutation.isPending}
                        data-testid="input-new-recipient"
                      />
                      <Button
                        onClick={addRecipient}
                        disabled={saveNotifMutation.isPending || !newRecipient.trim()}
                        data-testid="button-add-recipient"
                      >
                        <Plus className="h-4 w-4 mr-1" />Lägg till
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">
                      Standardmottagare (owners/admins)
                    </Label>
                    {notifSettings.defaultRecipients.length === 0 ? (
                      <p className="text-sm text-amber-600" data-testid="text-no-default-recipients">
                        Inga owners/admins eller kontakt-e-post hittades. Lägg till minst en mottagare ovan, annars skickas inga notiser.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2" data-testid="list-default-recipients">
                        {notifSettings.defaultRecipients.map((email) => (
                          <Badge key={email} variant="outline" data-testid={`badge-default-${email}`}>
                            {email}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </>
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
