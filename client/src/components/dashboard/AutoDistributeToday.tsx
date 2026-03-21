import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Assignment {
  workOrderId: string;
  workOrderTitle: string;
  resourceId: string;
  resourceName: string;
  scheduledDate: string;
  score: number;
  reasons: string[];
  constraintWarnings?: string[];
}

interface AutoDistributeResult {
  assignments: Assignment[];
  summary: string;
  totalAssigned: number;
  totalUnplanned: number;
}

export function AutoDistributeToday() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [result, setResult] = useState<AutoDistributeResult | null>(null);

  const handleAutoDistribute = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/ai/auto-distribute-today", {});
      const data = res as unknown as AutoDistributeResult;
      setResult(data);
      if (data.assignments.length === 0) {
        toast({ title: "Auto-fördela", description: data.summary });
      } else {
        setPreviewOpen(true);
      }
    } catch {
      toast({ title: "Fel", description: "Kunde inte hämta fördelningsförslag.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!result) return;
    setApplying(true);
    try {
      const assignments = result.assignments.map(a => ({
        workOrderId: a.workOrderId,
        resourceId: a.resourceId,
        scheduledDate: a.scheduledDate,
      }));
      await apiRequest("POST", "/api/ai/auto-distribute-today/apply", { assignments });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      toast({ title: "Klart!", description: `${assignments.length} ordrar har fördelats till resurser.` });
      setPreviewOpen(false);
      setResult(null);
    } catch {
      toast({ title: "Fel", description: "Kunde inte tillämpa fördelningen.", variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleAutoDistribute}
        disabled={loading}
        className="gap-1.5"
        data-testid="button-auto-distribute-today"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Auto-fördela idag
      </Button>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-[550px] max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Förhandsvisning - Auto-fördelning
            </DialogTitle>
            <DialogDescription>
              {result?.summary}
            </DialogDescription>
          </DialogHeader>

          {result && result.assignments.length > 0 && (
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-2 pr-4">
                {result.assignments.map((a, i) => (
                  <Card key={a.workOrderId} className="p-3" data-testid={`auto-distribute-preview-${i}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{a.workOrderTitle}</span>
                          <Badge variant="secondary" className="text-xs shrink-0">
                            Poäng: {a.score}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                          <span className="text-sm text-muted-foreground">{a.resourceName}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {a.reasons.join(" · ")}
                        </div>
                        {a.constraintWarnings && a.constraintWarnings.length > 0 && (
                          <div className="flex items-start gap-1 mt-1 text-xs text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span>{a.constraintWarnings.join("; ")}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}

          {result && result.totalUnplanned > result.totalAssigned && (
            <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              {result.totalUnplanned - result.totalAssigned} order(s) kunde inte fördelas (otillräcklig kapacitet).
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)} data-testid="button-cancel-distribute">
              Avbryt
            </Button>
            <Button onClick={handleApply} disabled={applying} data-testid="button-apply-distribute">
              {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Tillämpa ({result?.totalAssigned || 0} ordrar)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
