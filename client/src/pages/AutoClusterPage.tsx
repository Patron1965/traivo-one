import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Loader2, MapPin, Check, AlertTriangle, Target, Globe, Clock, Users, Building2, Hand, BarChart3 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Strategy = "geographic" | "frequency" | "team" | "customer" | "manual";

interface ClusterSuggestion {
  id: string;
  name: string;
  description: string;
  objectIds: string[];
  objectCount: number;
  workOrderCount: number;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusKm: number;
  color: string;
  primaryTeamId?: string | null;
  rootCustomerId?: string | null;
  postalCodes: string[];
}

interface GenerateResult {
  strategy: string;
  suggestions: ClusterSuggestion[];
  summary?: {
    totalSuggested: number;
    totalCoveredObjects: number;
    totalObjects: number;
    coverage: number;
  };
  statistics?: {
    totalObjects: number;
    totalWorkOrders: number;
    totalCustomers: number;
    totalResources: number;
    objectsWithCoordinates: number;
    objectsWithoutCoordinates: number;
    citiesBreakdown: { city: string; count: number }[];
    frequencyBreakdown: { high: number; medium: number; low: number; none: number };
    unclustered: number;
    alreadyClustered: number;
  };
}

interface ApplyResult {
  success: boolean;
  message: string;
  clusters: { id: string; name: string; objectCount: number }[];
  totalObjectsLinked: number;
  totalWorkOrdersLinked: number;
  errors?: string[];
}

const STRATEGY_INFO: Record<Strategy, { label: string; icon: typeof Globe; description: string }> = {
  geographic: { label: "Geografiskt", icon: Globe, description: "Gruppera objekt per stad och postnummer" },
  frequency: { label: "Besöksfrekvens", icon: Clock, description: "Gruppera efter antal arbetsordrar per objekt" },
  team: { label: "Team", icon: Users, description: "Gruppera efter vilken resurs som utför arbetsordrar" },
  customer: { label: "Kund", icon: Building2, description: "Gruppera per kund" },
  manual: { label: "Manuellt", icon: Hand, description: "Visa statistik utan förslag" },
};

export default function AutoClusterPage() {
  const { toast } = useToast();
  const [strategy, setStrategy] = useState<Strategy>("geographic");
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [targetSize, setTargetSize] = useState(50);
  const [highThreshold, setHighThreshold] = useState(10);
  const [mediumThreshold, setMediumThreshold] = useState(3);
  const [generatedResult, setGeneratedResult] = useState<GenerateResult | null>(null);

  const clusterStatus = useQuery<{ total: number }>({
    queryKey: ["/api/clusters/status"],
    queryFn: async () => {
      const res = await fetch("/api/clusters");
      const clusters = await res.json();
      return { total: Array.isArray(clusters) ? clusters.length : 0 };
    }
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const config: Record<string, unknown> = {};
      if (strategy === "geographic") config.targetSize = targetSize;
      if (strategy === "frequency") {
        config.highThreshold = highThreshold;
        config.mediumThreshold = mediumThreshold;
      }
      const response = await apiRequest("POST", "/api/clusters/auto-generate", { strategy, config });
      return response.json() as Promise<GenerateResult>;
    },
    onSuccess: (result) => {
      setGeneratedResult(result);
      setSelectedSuggestions(new Set());
      if (result.suggestions.length > 0) {
        toast({ title: "Förslag genererade", description: `${result.suggestions.length} kluster föreslagna` });
      }
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte generera klusterförslag.", variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (suggestions: ClusterSuggestion[]) => {
      const response = await apiRequest("POST", "/api/clusters/auto-generate/apply", { suggestions });
      return response.json() as Promise<ApplyResult>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clusters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clusters/status"] });
      toast({ title: "Kluster skapade", description: result.message });
      setSelectedSuggestions(new Set());
      setGeneratedResult(null);
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte skapa kluster.", variant: "destructive" });
    },
  });

  const toggleSuggestion = (id: string) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (generatedResult?.suggestions) {
      setSelectedSuggestions(new Set(generatedResult.suggestions.map(s => s.id)));
    }
  };

  const handleApply = () => {
    if (!generatedResult?.suggestions) return;
    const selected = generatedResult.suggestions.filter(s => selectedSuggestions.has(s.id));
    if (selected.length === 0) {
      toast({ title: "Välj förslag", description: "Markera minst ett klusterförslag.", variant: "destructive" });
      return;
    }
    applyMutation.mutate(selected);
  };

  const handleGenerate = () => {
    setGeneratedResult(null);
    generateMutation.mutate();
  };

  const existingClusters = clusterStatus.data?.total || 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Target className="h-6 w-6 text-primary" />
          Automatisk Klusterbildning
        </h1>
        <p className="text-muted-foreground mt-1">
          Gruppera importerade objekt i kluster med olika strategier
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-existing-clusters">{existingClusters}</div>
            <div className="text-xs text-muted-foreground">Befintliga kluster</div>
          </CardContent>
        </Card>
        {generatedResult?.summary && (
          <>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="text-2xl font-bold" data-testid="text-total-objects">{generatedResult.summary.totalObjects.toLocaleString("sv")}</div>
                <div className="text-xs text-muted-foreground">Totalt objekt</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="text-2xl font-bold" data-testid="text-suggested-clusters">{generatedResult.summary.totalSuggested}</div>
                <div className="text-xs text-muted-foreground">Föreslagna kluster</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="text-2xl font-bold" data-testid="text-coverage">{generatedResult.summary.coverage}%</div>
                <div className="text-xs text-muted-foreground">Täckningsgrad</div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Tabs value={strategy} onValueChange={(v) => { setStrategy(v as Strategy); setGeneratedResult(null); setSelectedSuggestions(new Set()); }}>
        <TabsList className="w-full grid grid-cols-5">
          {(Object.entries(STRATEGY_INFO) as [Strategy, typeof STRATEGY_INFO[Strategy]][]).map(([key, info]) => {
            const Icon = info.icon;
            return (
              <TabsTrigger key={key} value={key} className="flex items-center gap-1.5 text-xs sm:text-sm" data-testid={`tab-${key}`}>
                <Icon className="h-4 w-4 hidden sm:block" />
                {info.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {(Object.entries(STRATEGY_INFO) as [Strategy, typeof STRATEGY_INFO[Strategy]][]).map(([key, info]) => (
          <TabsContent key={key} value={key} className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{info.label}</CardTitle>
                <CardDescription>{info.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {key === "geographic" && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Max objekt per kluster: {targetSize}</label>
                    <Slider
                      value={[targetSize]}
                      onValueChange={(v) => setTargetSize(v[0])}
                      min={20}
                      max={500}
                      step={10}
                      data-testid="slider-target-size"
                    />
                    <p className="text-xs text-muted-foreground">
                      Städer med fler objekt än detta delas upp per postnummerområde
                    </p>
                  </div>
                )}
                {key === "frequency" && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Hög frekvens: ≥{highThreshold} ordrar</label>
                      <Slider
                        value={[highThreshold]}
                        onValueChange={(v) => setHighThreshold(v[0])}
                        min={5}
                        max={50}
                        step={1}
                        data-testid="slider-high-threshold"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Medel frekvens: ≥{mediumThreshold} ordrar</label>
                      <Slider
                        value={[mediumThreshold]}
                        onValueChange={(v) => setMediumThreshold(v[0])}
                        min={1}
                        max={highThreshold - 1}
                        step={1}
                        data-testid="slider-medium-threshold"
                      />
                    </div>
                  </div>
                )}
                {key === "team" && (
                  <p className="text-sm text-muted-foreground">
                    Varje resurs som utfört arbetsordrar blir ett eget kluster. Objekt utan arbetsordrar samlas i "Ej tilldelad".
                  </p>
                )}
                {key === "customer" && (
                  <p className="text-sm text-muted-foreground">
                    Varje kund med minst ett objekt blir ett eget kluster.
                  </p>
                )}
                {key === "manual" && (
                  <p className="text-sm text-muted-foreground">
                    Visa statistik om objekten utan att generera klusterförslag. Använd informationen för att skapa kluster manuellt.
                  </p>
                )}
                <Button onClick={handleGenerate} disabled={generateMutation.isPending} data-testid="button-generate">
                  {generateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <BarChart3 className="h-4 w-4 mr-2" />
                  )}
                  {key === "manual" ? "Visa statistik" : "Generera förslag"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {generateMutation.isPending && (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
            <h3 className="text-lg font-medium mb-2">Analyserar data...</h3>
            <p className="text-muted-foreground">Grupperar objekt enligt vald strategi</p>
          </CardContent>
        </Card>
      )}

      {generatedResult && strategy === "manual" && generatedResult.statistics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Översikt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Totalt objekt</span><span className="font-medium">{generatedResult.statistics.totalObjects.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Med koordinater</span><span className="font-medium">{generatedResult.statistics.objectsWithCoordinates.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Utan koordinater</span><span className="font-medium">{generatedResult.statistics.objectsWithoutCoordinates.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Totalt arbetsordrar</span><span className="font-medium">{generatedResult.statistics.totalWorkOrders.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Kunder</span><span className="font-medium">{generatedResult.statistics.totalCustomers.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Resurser</span><span className="font-medium">{generatedResult.statistics.totalResources}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Redan klustrade</span><span className="font-medium">{generatedResult.statistics.alreadyClustered.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Oklustrade</span><span className="font-medium">{generatedResult.statistics.unclustered.toLocaleString("sv")}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Besöksfrekvens</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Hög (≥10 ordrar)</span><span className="font-medium">{generatedResult.statistics.frequencyBreakdown.high.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Medel (3-9 ordrar)</span><span className="font-medium">{generatedResult.statistics.frequencyBreakdown.medium.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Låg (1-2 ordrar)</span><span className="font-medium">{generatedResult.statistics.frequencyBreakdown.low.toLocaleString("sv")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Inga ordrar</span><span className="font-medium">{generatedResult.statistics.frequencyBreakdown.none.toLocaleString("sv")}</span></div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Objekt per stad (topp 20)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-sm">
                {generatedResult.statistics.citiesBreakdown.slice(0, 20).map((c) => (
                  <div key={c.city} className="flex justify-between gap-2 px-2 py-1 rounded bg-muted/50">
                    <span className="truncate">{c.city}</span>
                    <span className="font-medium shrink-0">{c.count.toLocaleString("sv")}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {generatedResult && generatedResult.suggestions.length > 0 && !generateMutation.isPending && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-lg font-semibold">Föreslagna kluster ({generatedResult.suggestions.length})</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-select-all">
                Markera alla
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedSuggestions(new Set())} data-testid="button-deselect-all">
                Avmarkera
              </Button>
              <Button
                onClick={handleApply}
                disabled={selectedSuggestions.size === 0 || applyMutation.isPending}
                data-testid="button-apply"
              >
                {applyMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Skapa {selectedSuggestions.size} kluster
              </Button>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-3 w-10">
                      <Checkbox
                        checked={selectedSuggestions.size === generatedResult.suggestions.length && generatedResult.suggestions.length > 0}
                        onCheckedChange={(checked) => { if (checked) selectAll(); else setSelectedSuggestions(new Set()); }}
                        data-testid="checkbox-select-all"
                      />
                    </th>
                    <th className="text-left p-3">Färg</th>
                    <th className="text-left p-3">Namn</th>
                    <th className="text-right p-3">Objekt</th>
                    <th className="text-right p-3">Ordrar</th>
                    <th className="text-left p-3 hidden md:table-cell">Beskrivning</th>
                  </tr>
                </thead>
                <tbody>
                  {generatedResult.suggestions.map((s) => (
                    <tr
                      key={s.id}
                      className={`border-t cursor-pointer hover:bg-muted/30 transition-colors ${selectedSuggestions.has(s.id) ? "bg-primary/5" : ""}`}
                      onClick={() => toggleSuggestion(s.id)}
                      data-testid={`row-suggestion-${s.id}`}
                    >
                      <td className="p-3">
                        <Checkbox
                          checked={selectedSuggestions.has(s.id)}
                          onCheckedChange={() => toggleSuggestion(s.id)}
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`checkbox-${s.id}`}
                        />
                      </td>
                      <td className="p-3">
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: s.color }} />
                      </td>
                      <td className="p-3 font-medium max-w-[200px] truncate">{s.name}</td>
                      <td className="p-3 text-right">
                        <Badge variant="secondary">{s.objectCount.toLocaleString("sv")}</Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Badge variant="outline">{s.workOrderCount.toLocaleString("sv")}</Badge>
                      </td>
                      <td className="p-3 text-muted-foreground text-xs hidden md:table-cell max-w-[300px] truncate">{s.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selectedSuggestions.size > 0 && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="text-sm">
                    <span className="font-medium">{selectedSuggestions.size}</span> kluster markerade med totalt{" "}
                    <span className="font-medium">
                      {generatedResult.suggestions
                        .filter(s => selectedSuggestions.has(s.id))
                        .reduce((sum, s) => sum + s.objectCount, 0)
                        .toLocaleString("sv")}
                    </span>{" "}
                    objekt
                  </div>
                  <Button onClick={handleApply} disabled={applyMutation.isPending} data-testid="button-apply-bottom">
                    {applyMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 mr-2" />
                    )}
                    Applicera markerade kluster
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {applyMutation.isSuccess && applyMutation.data && (
        <Card className="border-green-500/20 bg-green-50 dark:bg-green-950/20">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <Check className="h-5 w-5" />
              <span className="font-medium">{applyMutation.data.message}</span>
            </div>
            {applyMutation.data.errors && applyMutation.data.errors.length > 0 && (
              <div className="mt-2 space-y-1">
                {applyMutation.data.errors.map((err, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    {err}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
