import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, RefreshCw } from "lucide-react";

interface TelinkSyncResult {
  batchId: string;
  fetched: number;
  matched: number;
  updated: number;
  unchanged: number;
  unmatched: number;
  issuesCreated: number;
  errors: string[];
}

interface Props {
  objectId: string;
  size?: "sm" | "default";
}

export function TelinkSyncButton({ objectId, size = "sm" }: Props) {
  const { toast } = useToast();
  const [lastResult, setLastResult] = useState<TelinkSyncResult | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/telink/sync/object/${objectId}`);
      return (await res.json()) as TelinkSyncResult;
    },
    onSuccess: (result) => {
      setLastResult(result);
      const parts: string[] = [];
      parts.push(`${result.matched} matchade`);
      if (result.updated) parts.push(`${result.updated} uppdaterade`);
      if (result.issuesCreated) parts.push(`${result.issuesCreated} nya ärenden`);
      if (result.errors.length) parts.push(`${result.errors.length} fel`);
      toast({
        title: result.errors.length ? "Telink-synk klar med varningar" : "Telink-synk klar",
        description: parts.join(", ") || "Inga ändringar",
        variant: result.errors.length ? "destructive" : "default",
      });
      // Invalidera metadata + issue-listor som kan ha påverkats
      queryClient.invalidateQueries({ queryKey: [`/api/objects/${objectId}/metadata`] });
      queryClient.invalidateQueries({ queryKey: ["/api/customer-issue-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/telink/history"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Kunde inte synka från Telink",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size={size}
        variant="outline"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        data-testid="button-telink-sync-object"
      >
        {mutation.isPending ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4 mr-2" />
        )}
        Synka från Telink
      </Button>
      {lastResult && !mutation.isPending && (
        <span className="text-[11px] text-muted-foreground" data-testid="text-telink-last-result">
          Senaste: {lastResult.matched} matchade · {lastResult.updated} uppdaterade
          {lastResult.issuesCreated ? ` · ${lastResult.issuesCreated} ärenden` : ""}
        </span>
      )}
    </div>
  );
}
