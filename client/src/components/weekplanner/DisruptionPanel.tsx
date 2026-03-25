import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, AlertCircle, Info, Check, X, ChevronDown, ChevronRight,
  Zap, UserX, Clock, Coffee, ArrowRight, Activity,
} from "lucide-react";

interface SuggestionAction {
  type: "reassign" | "insert" | "reschedule" | "notify";
  workOrderId: string;
  workOrderTitle?: string;
  targetResourceId?: string;
  targetResourceName?: string;
}

interface DisruptionSuggestion {
  id: string;
  label: string;
  description: string;
  score: number;
  actions: SuggestionAction[];
}

interface DisruptionEvent {
  id: string;
  type: "resource_unavailable" | "emergency_job" | "significant_delay" | "early_completion";
  createdAt: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  affectedWorkOrderIds: string[];
  suggestions: DisruptionSuggestion[];
  status: "active" | "resolved" | "dismissed";
  decisionTrace: Array<{ step: string; detail: string; timestamp: string }>;
}

const typeIcons: Record<string, typeof AlertTriangle> = {
  resource_unavailable: UserX,
  emergency_job: Zap,
  significant_delay: Clock,
  early_completion: Coffee,
};

const severityColors: Record<string, string> = {
  critical: "border-red-500 bg-red-50 dark:bg-red-950/30",
  warning: "border-amber-500 bg-amber-50 dark:bg-amber-950/30",
  info: "border-blue-500 bg-blue-50 dark:bg-blue-950/30",
};

const severityBadge: Record<string, string> = {
  critical: "bg-red-500 text-white",
  warning: "bg-amber-500 text-white",
  info: "bg-blue-500 text-white",
};

export function DisruptionPanel() {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState<string | null>(null);

  const { data: disruptions = [], isLoading } = useQuery<DisruptionEvent[]>({
    queryKey: ["/api/disruptions"],
    refetchInterval: 15000,
  });

  const applyMutation = useMutation({
    mutationFn: async ({ disruptionId, suggestionId }: { disruptionId: string; suggestionId: string }) => {
      const res = await apiRequest("POST", `/api/disruptions/${disruptionId}/apply/${suggestionId}`);
      return res.json();
    },
    onSuccess: (data: { applied: number; details: string[] }) => {
      toast({ title: "Förslag tillämpat", description: `${data.applied} åtgärd(er) utförda` });
      queryClient.invalidateQueries({ queryKey: ["/api/disruptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte tillämpa förslaget", variant: "destructive" });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (disruptionId: string) => {
      const res = await apiRequest("POST", `/api/disruptions/${disruptionId}/dismiss`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/disruptions"] });
    },
  });

  const activeDisruptions = disruptions.filter(d => d.status === "active");

  if (isLoading || activeDisruptions.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="disruption-panel">
      <div className="flex items-center gap-2 px-1">
        <Activity className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium">Störningar</span>
        <Badge variant="secondary" className="text-xs" data-testid="disruption-count">
          {activeDisruptions.length}
        </Badge>
      </div>

      <ScrollArea className="max-h-[300px]">
        <div className="space-y-2">
          {activeDisruptions.map(event => {
            const Icon = typeIcons[event.type] || AlertCircle;
            const isExpanded = expandedId === event.id;
            const isTraceOpen = showTrace === event.id;

            return (
              <Card
                key={event.id}
                className={`border-l-4 ${severityColors[event.severity]}`}
                data-testid={`disruption-card-${event.id}`}
              >
                <Collapsible open={isExpanded} onOpenChange={() => setExpandedId(isExpanded ? null : event.id)}>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                      <div className="flex items-start gap-2">
                        <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-sm font-medium truncate">{event.title}</CardTitle>
                            <Badge className={`text-[10px] px-1.5 py-0 ${severityBadge[event.severity]}`}>
                              {event.severity === "critical" ? "Kritisk" : event.severity === "warning" ? "Varning" : "Info"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.description}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(event.createdAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent className="px-3 pb-3 pt-0 space-y-2">
                      <div className="text-xs text-muted-foreground">
                        {event.affectedWorkOrderIds.length} jobb påverkas
                      </div>

                      {event.suggestions.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-xs font-medium">Förslag:</div>
                          {event.suggestions.map(sug => (
                            <div
                              key={sug.id}
                              className="flex items-start gap-2 p-2 rounded-md bg-background border text-xs"
                              data-testid={`suggestion-${event.id}-${sug.id}`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="font-medium">{sug.label}</div>
                                <div className="text-muted-foreground mt-0.5">{sug.description}</div>
                                {sug.actions.length > 0 && (
                                  <div className="mt-1 space-y-0.5">
                                    {sug.actions.slice(0, 3).map((a, idx) => (
                                      <div key={idx} className="flex items-center gap-1 text-muted-foreground">
                                        <ArrowRight className="h-3 w-3" />
                                        <span className="truncate">
                                          {a.workOrderTitle || a.workOrderId}
                                          {a.targetResourceName ? ` → ${a.targetResourceName}` : ""}
                                        </span>
                                      </div>
                                    ))}
                                    {sug.actions.length > 3 && (
                                      <div className="text-muted-foreground">+{sug.actions.length - 3} till</div>
                                    )}
                                  </div>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 text-xs shrink-0"
                                disabled={applyMutation.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  applyMutation.mutate({ disruptionId: event.id, suggestionId: sug.id });
                                }}
                                data-testid={`apply-suggestion-${event.id}-${sug.id}`}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                Tillämpa
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] text-muted-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowTrace(isTraceOpen ? null : event.id);
                          }}
                          data-testid={`toggle-trace-${event.id}`}
                        >
                          {isTraceOpen ? "Dölj beslutsspår" : "Visa beslutsspår"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            dismissMutation.mutate(event.id);
                          }}
                          data-testid={`dismiss-disruption-${event.id}`}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Avfärda
                        </Button>
                      </div>

                      {isTraceOpen && event.decisionTrace.length > 0 && (
                        <div className="mt-1 p-2 rounded bg-muted/50 text-[10px] space-y-1 font-mono" data-testid={`trace-${event.id}`}>
                          {event.decisionTrace.map((t, i) => (
                            <div key={i} className="flex gap-2">
                              <span className="text-muted-foreground shrink-0">[{t.step}]</span>
                              <span>{t.detail}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
