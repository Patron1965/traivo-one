import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Sparkles, MapPin, Check, AlertTriangle, Target } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ClusterSuggestion {
  id: string;
  suggestedName: string;
  postalCodes: string[];
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
  objectCount: number;
  estimatedMonthlyOrders: number;
  rationale: string;
  color: string;
}

interface AutoClusterResult {
  suggestions: ClusterSuggestion[];
  unclusteredObjects: { id: string; name: string; postalCode: string }[];
  summary: string;
  coverage: number;
}

export default function AutoClusterPage() {
  const { toast } = useToast();
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());

  const { data, isLoading, refetch, isFetching } = useQuery<AutoClusterResult>({
    queryKey: ["/api/ai/auto-cluster"],
    enabled: false,
  });

  const applyMutation = useMutation({
    mutationFn: async (suggestions: ClusterSuggestion[]) => {
      const response = await apiRequest("POST", "/api/ai/auto-cluster/apply", { suggestions });
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clusters"] });
      toast({ 
        title: "Kluster skapade", 
        description: result.message 
      });
      setSelectedSuggestions(new Set());
      refetch();
    },
    onError: () => {
      toast({ 
        title: "Fel", 
        description: "Kunde inte skapa kluster.", 
        variant: "destructive" 
      });
    },
  });

  const handleAnalyze = () => {
    refetch();
  };

  const toggleSuggestion = (id: string) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (data?.suggestions) {
      setSelectedSuggestions(new Set(data.suggestions.map(s => s.id)));
    }
  };

  const deselectAll = () => {
    setSelectedSuggestions(new Set());
  };

  const handleApply = () => {
    if (!data?.suggestions) return;
    const selected = data.suggestions.filter(s => selectedSuggestions.has(s.id));
    if (selected.length === 0) {
      toast({ title: "Välj förslag", description: "Markera minst ett klusterförslag att skapa.", variant: "destructive" });
      return;
    }
    applyMutation.mutate(selected);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Automatisk Klusterbildning
          </h1>
          <p className="text-muted-foreground mt-1">
            AI analyserar objektens geografi och föreslår optimala klustergränser
          </p>
        </div>
        <Button onClick={handleAnalyze} disabled={isLoading || isFetching} data-testid="button-analyze">
          {(isLoading || isFetching) ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Target className="h-4 w-4 mr-2" />
          )}
          Analysera objekt
        </Button>
      </div>

      {!data && !isLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Ingen analys gjord</h3>
            <p className="text-muted-foreground mb-4">
              Klicka på "Analysera objekt" för att låta AI föreslå optimala kluster baserat på geografisk data.
            </p>
          </CardContent>
        </Card>
      )}

      {(isLoading || isFetching) && (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
            <h3 className="text-lg font-medium mb-2">Analyserar geografi...</h3>
            <p className="text-muted-foreground">
              AI undersöker objektens postnummer och koordinater för att hitta optimala kluster.
            </p>
          </CardContent>
        </Card>
      )}

      {data && !isLoading && !isFetching && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Sammanfattning</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-primary" />
                  <span className="text-sm">{data.summary}</span>
                </div>
                <Badge variant="outline" className="text-sm">
                  Täckningsgrad: {data.coverage}%
                </Badge>
              </div>
            </CardContent>
          </Card>

          {data.suggestions.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h2 className="text-lg font-semibold">Föreslagna kluster ({data.suggestions.length})</h2>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-select-all">
                    Markera alla
                  </Button>
                  <Button variant="outline" size="sm" onClick={deselectAll} data-testid="button-deselect-all">
                    Avmarkera alla
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

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.suggestions.map((suggestion) => (
                  <Card 
                    key={suggestion.id} 
                    className={`cursor-pointer transition-all ${selectedSuggestions.has(suggestion.id) ? "ring-2 ring-primary" : ""}`}
                    onClick={() => toggleSuggestion(suggestion.id)}
                    data-testid={`card-suggestion-${suggestion.id}`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-4 h-4 rounded-full shrink-0" 
                            style={{ backgroundColor: suggestion.color }} 
                          />
                          <CardTitle className="text-base">{suggestion.suggestedName}</CardTitle>
                        </div>
                        <Checkbox 
                          checked={selectedSuggestions.has(suggestion.id)}
                          onCheckedChange={() => toggleSuggestion(suggestion.id)}
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`checkbox-${suggestion.id}`}
                        />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">Objekt</span>
                        <Badge variant="secondary">{suggestion.objectCount}</Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">Uppsk. ordrar/mån</span>
                        <Badge variant="secondary">{suggestion.estimatedMonthlyOrders}</Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">Radie</span>
                        <span>{suggestion.radiusKm} km</span>
                      </div>
                      <div className="text-xs text-muted-foreground pt-2 border-t">
                        <span className="font-medium">Postnummer:</span>{" "}
                        {suggestion.postalCodes.slice(0, 5).join(", ")}
                        {suggestion.postalCodes.length > 5 && ` +${suggestion.postalCodes.length - 5} fler`}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {data.unclusteredObjects.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Objekt utan klustertillhörighet ({data.unclusteredObjects.length})
                </CardTitle>
                <CardDescription>
                  Dessa objekt kunde inte tilldelas något kluster. Kontrollera att de har korrekta postnummer.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {data.unclusteredObjects.slice(0, 50).map((obj) => (
                    <div 
                      key={obj.id} 
                      className="flex items-center justify-between gap-2 py-1 px-2 rounded bg-muted/50 text-sm"
                    >
                      <span className="truncate">{obj.name}</span>
                      <span className="text-muted-foreground shrink-0">
                        {obj.postalCode || "Inget postnummer"}
                      </span>
                    </div>
                  ))}
                  {data.unclusteredObjects.length > 50 && (
                    <p className="text-sm text-muted-foreground pt-2">
                      ...och {data.unclusteredObjects.length - 50} fler
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
