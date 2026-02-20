import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Database, ArrowDownToLine, ArrowUpFromLine, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface MetadataPreview {
  metadataCode: string;
  currentValue: string | null;
  datatype: string;
  katalogId: string;
  katalogName: string;
}

interface WorkOrderMetadataPanelProps {
  workOrderId: string;
  objectId: string;
  executionStatus?: string;
  compact?: boolean;
}

export function WorkOrderMetadataPanel({
  workOrderId,
  objectId,
  executionStatus,
  compact = false,
}: WorkOrderMetadataPanelProps) {
  const { toast } = useToast();
  const [leaveValue, setLeaveValue] = useState("");
  const [writebackDone, setWritebackDone] = useState(false);

  const { data: workOrderLines = [] } = useQuery<{ articleId: string }[]>({
    queryKey: ["/api/work-orders", workOrderId, "lines"],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${workOrderId}/lines`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!workOrderId,
  });

  const firstArticleId = workOrderLines.length > 0 ? workOrderLines[0].articleId : null;

  const { data: metadataPreview, isLoading } = useQuery<{
    fetch: MetadataPreview | null;
    leave: MetadataPreview | null;
    leaveFormat: string | null;
  }>({
    queryKey: ["/api/metadata/article-preview", objectId, firstArticleId],
    queryFn: async () => {
      if (!firstArticleId) return { fetch: null, leave: null, leaveFormat: null };
      const res = await fetch(`/api/metadata/article-preview/${objectId}/${firstArticleId}`);
      if (!res.ok) return { fetch: null, leave: null, leaveFormat: null };
      return res.json();
    },
    enabled: !!objectId && !!firstArticleId,
  });

  const writebackMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/metadata/article-writeback/${objectId}/${firstArticleId}`, {
        value: leaveValue,
      });
    },
    onSuccess: () => {
      toast({ title: "Metadata sparad", description: "Metadata har skrivits tillbaka till objektet" });
      setWritebackDone(true);
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/article-preview", objectId, firstArticleId] });
      queryClient.invalidateQueries({ queryKey: ["/api/metadata/object", objectId] });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte spara metadata", variant: "destructive" });
    },
  });

  if (!firstArticleId || isLoading) return null;
  if (!metadataPreview?.fetch && !metadataPreview?.leave) return null;

  const isOnSiteOrLater = ["on_site", "completed", "inspected", "invoiced"].includes(executionStatus || "");

  if (compact) {
    return (
      <div className="flex items-center gap-1 flex-wrap mt-0.5" data-testid={`wo-metadata-compact-${workOrderId}`}>
        {metadataPreview.fetch && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="gap-0.5 text-[10px] h-4 px-1">
                <ArrowDownToLine className="h-2.5 w-2.5" />
                {metadataPreview.fetch.katalogName}: {metadataPreview.fetch.currentValue ?? "—"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Hämtad metadata från objektet</TooltipContent>
          </Tooltip>
        )}
        {metadataPreview.leave && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="gap-0.5 text-[10px] h-4 px-1">
                <ArrowUpFromLine className="h-2.5 w-2.5" />
                {metadataPreview.leave.katalogName}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Metadata att skriva tillbaka vid utförande</TooltipContent>
          </Tooltip>
        )}
        {writebackDone && (
          <Badge variant="outline" className="gap-0.5 text-[10px] h-4 px-1 text-green-600 border-green-300">
            <CheckCircle2 className="h-2.5 w-2.5" />
            Sparad
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Card className="border-dashed" data-testid={`wo-metadata-panel-${workOrderId}`}>
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Database className="h-4 w-4" />
          Metadata-koppling
        </CardTitle>
      </CardHeader>
      <CardContent className="py-2 px-3 space-y-3">
        {metadataPreview.fetch && (
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1">
              <ArrowDownToLine className="h-3 w-3" />
              Hämta: {metadataPreview.fetch.katalogName}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                value={metadataPreview.fetch.currentValue || ""}
                readOnly
                className="h-7 text-xs bg-muted"
                data-testid={`input-fetch-metadata-${workOrderId}`}
              />
              <Badge variant="secondary" className="text-xs shrink-0">
                {metadataPreview.fetch.datatype}
              </Badge>
            </div>
          </div>
        )}

        {metadataPreview.leave && isOnSiteOrLater && !writebackDone && (
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1">
              <ArrowUpFromLine className="h-3 w-3" />
              Lämna: {metadataPreview.leave.katalogName}
              {metadataPreview.leaveFormat && (
                <span className="text-muted-foreground">({metadataPreview.leaveFormat})</span>
              )}
            </Label>
            {metadataPreview.leaveFormat === "timestamp" ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs w-full"
                onClick={() => {
                  setLeaveValue(new Date().toISOString());
                  writebackMutation.mutate();
                }}
                disabled={writebackMutation.isPending}
                data-testid={`button-writeback-timestamp-${workOrderId}`}
              >
                {writebackMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Registrera tidsstämpel
              </Button>
            ) : metadataPreview.leaveFormat === "boolean_true" ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs w-full"
                onClick={() => {
                  setLeaveValue("true");
                  writebackMutation.mutate();
                }}
                disabled={writebackMutation.isPending}
                data-testid={`button-writeback-boolean-${workOrderId}`}
              >
                {writebackMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Markera som utförd
              </Button>
            ) : metadataPreview.leaveFormat === "counter_increment" ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs w-full"
                onClick={() => {
                  const current = parseInt(metadataPreview.leave!.currentValue || "0") || 0;
                  setLeaveValue(String(current + 1));
                  writebackMutation.mutate();
                }}
                disabled={writebackMutation.isPending}
                data-testid={`button-writeback-counter-${workOrderId}`}
              >
                {writebackMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Öka räknare (+1)
              </Button>
            ) : (
              <div className="flex gap-1">
                <Input
                  value={leaveValue}
                  onChange={(e) => setLeaveValue(e.target.value)}
                  placeholder="Ange värde..."
                  className="h-7 text-xs"
                  data-testid={`input-leave-metadata-${workOrderId}`}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs shrink-0"
                  onClick={() => writebackMutation.mutate()}
                  disabled={writebackMutation.isPending || !leaveValue}
                  data-testid={`button-writeback-value-${workOrderId}`}
                >
                  {writebackMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Spara"}
                </Button>
              </div>
            )}
          </div>
        )}

        {writebackDone && (
          <div className="flex items-center gap-1 text-xs text-green-600" data-testid={`text-writeback-done-${workOrderId}`}>
            <CheckCircle2 className="h-3 w-3" />
            Metadata sparad
          </div>
        )}
      </CardContent>
    </Card>
  );
}
