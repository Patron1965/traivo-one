import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, ArrowRight, Clock, Check, X, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PlanningSuggestion {
  id: string;
  type: "move" | "swap" | "balance" | "warning";
  title: string;
  description: string;
  impact: string;
  workOrderId?: string;
  fromResourceId?: string;
  toResourceId?: string;
  fromDate?: string;
  toDate?: string;
  estimatedTimeSaved?: number;
  priority: "high" | "medium" | "low";
}

interface AISuggestionsPanelProps {
  weekStart: string;
  weekEnd: string;
  onApplySuggestion?: (suggestion: PlanningSuggestion) => void;
}

const priorityColors: Record<string, string> = {
  high: "bg-red-500/20 text-red-700 dark:text-red-300",
  medium: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
  low: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
};

const typeIcons: Record<string, string> = {
  move: "Flytta",
  swap: "Byt",
  balance: "Balansera",
  warning: "Varning",
};

export function AISuggestionsPanel({ weekStart, weekEnd, onApplySuggestion }: AISuggestionsPanelProps) {
  const [suggestions, setSuggestions] = useState<PlanningSuggestion[]>([]);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/planning-suggestions", {
        weekStart,
        weekEnd,
      });
      return response.json();
    },
    onSuccess: (data: PlanningSuggestion[]) => {
      setSuggestions(data);
      setAppliedIds(new Set());
      if (data.length === 0) {
        toast({
          title: "Inga förslag",
          description: "Planeringen ser bra ut just nu!",
        });
      }
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte generera AI-förslag. Försök igen.",
        variant: "destructive",
      });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (suggestion: PlanningSuggestion) => {
      if (suggestion.workOrderId && suggestion.toResourceId && suggestion.toDate) {
        await apiRequest("PATCH", `/api/work-orders/${suggestion.workOrderId}`, {
          resourceId: suggestion.toResourceId,
          scheduledDate: suggestion.toDate,
        });
      }
      return suggestion;
    },
    onSuccess: (suggestion) => {
      setAppliedIds((prev) => new Set(Array.from(prev).concat(suggestion.id)));
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({
        title: "Förslag tillämpat",
        description: suggestion.title,
      });
      onApplySuggestion?.(suggestion);
    },
    onError: () => {
      toast({
        title: "Fel",
        description: "Kunde inte tillämpa förslaget.",
        variant: "destructive",
      });
    },
  });

  const dismissSuggestion = (id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-purple-500" />
            AI Planeringsassistent
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            data-testid="button-generate-ai-suggestions"
          >
            {generateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Analysera
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.length === 0 && !generateMutation.isPending && (
          <div className="text-center py-6 text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Klicka "Analysera" för att få AI-drivna planeringsförslag</p>
          </div>
        )}

        {generateMutation.isPending && (
          <div className="text-center py-6">
            <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-purple-500" />
            <p className="text-sm text-muted-foreground">Analyserar planering...</p>
          </div>
        )}

        {suggestions.map((suggestion) => {
          const isApplied = appliedIds.has(suggestion.id);
          const canApply = suggestion.workOrderId && suggestion.toResourceId && suggestion.toDate;

          return (
            <Card
              key={suggestion.id}
              className={`p-3 ${isApplied ? "opacity-50" : ""}`}
              data-testid={`ai-suggestion-${suggestion.id}`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      {typeIcons[suggestion.type]}
                    </Badge>
                    <Badge className={`text-xs ${priorityColors[suggestion.priority]}`}>
                      {suggestion.priority === "high" ? "Hög" : suggestion.priority === "medium" ? "Medium" : "Låg"}
                    </Badge>
                  </div>
                  {!isApplied && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={() => dismissSuggestion(suggestion.id)}
                      data-testid={`button-dismiss-${suggestion.id}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>

                <div>
                  <h4 className="font-medium text-sm">{suggestion.title}</h4>
                  <p className="text-xs text-muted-foreground mt-1">{suggestion.description}</p>
                </div>

                {suggestion.impact && (
                  <div className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                    <Clock className="h-3 w-3" />
                    {suggestion.impact}
                  </div>
                )}

                {suggestion.fromDate && suggestion.toDate && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span>{suggestion.fromDate}</span>
                    <ArrowRight className="h-3 w-3" />
                    <span>{suggestion.toDate}</span>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  {isApplied ? (
                    <Badge variant="secondary" className="text-xs">
                      <Check className="h-3 w-3 mr-1" />
                      Tillämpat
                    </Badge>
                  ) : canApply ? (
                    <Button
                      size="sm"
                      onClick={() => applyMutation.mutate(suggestion)}
                      disabled={applyMutation.isPending}
                      data-testid={`button-apply-${suggestion.id}`}
                    >
                      {applyMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Check className="h-3 w-3 mr-1" />
                      )}
                      Tillämpa
                    </Button>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      Manuell åtgärd krävs
                    </Badge>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </CardContent>
    </Card>
  );
}
