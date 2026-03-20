import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ListChecks, Sparkles, Plus, Trash2, Loader2, CheckCircle, Circle, ChevronRight
} from "lucide-react";
import type { OrderChecklistItem } from "@shared/schema";

interface OrderChecklistProps {
  workOrderId: string;
  orderType: string;
}

export function OrderChecklist({ workOrderId, orderType }: OrderChecklistProps) {
  const [expanded, setExpanded] = useState(true);
  const [newStepText, setNewStepText] = useState("");

  const { data: items = [], isLoading } = useQuery<OrderChecklistItem[]>({
    queryKey: ["/api/checklist", workOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/checklist/${workOrderId}`);
      if (!res.ok) throw new Error("Failed to fetch checklist");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/checklist/${workOrderId}/generate`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/checklist", workOrderId] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ itemId, isCompleted }: { itemId: string; isCompleted: boolean }) => {
      const res = await apiRequest("PATCH", `/api/checklist/items/${itemId}`, { isCompleted });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/checklist", workOrderId] });
    },
  });

  const addMutation = useMutation({
    mutationFn: async (stepText: string) => {
      const res = await apiRequest("POST", `/api/checklist/${workOrderId}/items`, {
        stepText,
        isAiGenerated: false,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/checklist", workOrderId] });
      setNewStepText("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (itemId: string) => {
      await apiRequest("DELETE", `/api/checklist/items/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/checklist", workOrderId] });
    },
  });

  const completedCount = items.filter(i => i.isCompleted).length;
  const totalCount = items.length;

  return (
    <Card className="border-violet-200 dark:border-violet-800" data-testid="card-order-checklist">
      <CardHeader
        className="pb-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        data-testid="header-order-checklist"
      >
        <CardTitle className="text-base flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-violet-600" />
            Checklista
            {totalCount > 0 && (
              <Badge variant="secondary" className="text-xs" data-testid="badge-checklist-progress">
                {completedCount}/{totalCount}
              </Badge>
            )}
          </div>
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </CardTitle>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {items.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Ingen checklista ännu. Generera med AI eller lägg till steg manuellt.
                </p>
              )}

              <div className="space-y-1">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 p-2 rounded-md border transition-colors ${
                      item.isCompleted
                        ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                        : "bg-background border-border hover:bg-muted/50"
                    }`}
                    data-testid={`checklist-item-${item.id}`}
                  >
                    <button
                      className="shrink-0"
                      onClick={() => toggleMutation.mutate({ itemId: item.id, isCompleted: !item.isCompleted })}
                      disabled={toggleMutation.isPending}
                      data-testid={`button-toggle-checklist-${item.id}`}
                    >
                      {item.isCompleted ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>
                    <span className={`flex-1 text-sm ${item.isCompleted ? "line-through text-muted-foreground" : ""}`}>
                      {item.stepText}
                    </span>
                    <div className="flex items-center gap-1">
                      {item.isAiGenerated && (
                        <Sparkles className="h-3 w-3 text-violet-400" />
                      )}
                      {!item.isAiGenerated && (
                        <button
                          onClick={() => deleteMutation.mutate(item.id)}
                          disabled={deleteMutation.isPending}
                          className="text-muted-foreground hover:text-destructive"
                          data-testid={`button-delete-checklist-${item.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder="Lägg till eget steg..."
                  value={newStepText}
                  onChange={(e) => setNewStepText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newStepText.trim()) {
                      addMutation.mutate(newStepText.trim());
                    }
                  }}
                  className="h-9 text-sm"
                  data-testid="input-add-checklist-step"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 px-3 shrink-0"
                  onClick={() => {
                    if (newStepText.trim()) addMutation.mutate(newStepText.trim());
                  }}
                  disabled={!newStepText.trim() || addMutation.isPending}
                  data-testid="button-add-checklist-step"
                >
                  {addMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 text-violet-600 border-violet-200 hover:bg-violet-50 dark:text-violet-400 dark:border-violet-800 dark:hover:bg-violet-950/30"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                data-testid="button-generate-checklist"
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {items.length === 0 ? "Generera AI-checklista" : "Föreslå fler steg med AI"}
              </Button>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
