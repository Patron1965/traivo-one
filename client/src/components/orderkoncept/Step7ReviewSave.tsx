import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Save, Copy, PlayCircle, Loader2, CheckCircle2 } from "lucide-react";

interface Step7Props {
  conceptId: string | null;
  conceptName: string;
  customerName?: string;
  clusterCount: number;
  filterCount: number;
  articleCount: number;
  totalValueKr: number;
  totalCostKr: number;
  estimatedHours: number;
  deliveryTimeType: string;
  onBeforeAction: () => Promise<void>;
}

export default function Step7ReviewSave({
  conceptId,
  conceptName,
  customerName,
  clusterCount,
  filterCount,
  articleCount,
  totalValueKr,
  totalCostKr,
  estimatedHours,
  deliveryTimeType,
  onBeforeAction,
}: Step7Props) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [templateName, setTemplateName] = useState("");

  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!conceptId) throw new Error("Spara konceptet först.");
      await onBeforeAction();
      const res = await apiRequest("POST", `/api/order-concepts/${conceptId}/save-as-template`, {
        name: templateName.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      toast({ title: "Mall sparad", description: "Konceptet sparades som mall." });
    },
    onError: (e: Error) => toast({ title: "Kunde inte spara mall", description: e.message, variant: "destructive" }),
  });

  const copyMutation = useMutation({
    mutationFn: async () => {
      if (!conceptId) throw new Error("Spara konceptet först.");
      await onBeforeAction();
      const res = await apiRequest("POST", `/api/order-concepts/${conceptId}/copy`, {});
      return res.json();
    },
    onSuccess: (data: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      toast({ title: "Koncept kopierat" });
      if (data?.id) navigate(`/order-concepts/${data.id}/edit`);
    },
    onError: (e: Error) => toast({ title: "Kunde inte kopiera", description: e.message, variant: "destructive" }),
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      if (!conceptId) throw new Error("Spara konceptet först.");
      await onBeforeAction();
      await apiRequest("PATCH", `/api/order-concepts/${conceptId}`, { status: "active" });
      const res = await apiRequest("POST", `/api/order-concepts/${conceptId}/execute`, {});
      return res.json();
    },
    onSuccess: (data: { created?: number; assignmentsCreated?: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-concepts"] });
      const n = data?.created ?? data?.assignmentsCreated;
      toast({ title: "Order skapad", description: n != null ? `${n} uppdrag genererades.` : "Konceptet kördes." });
      navigate("/order-concepts");
    },
    onError: (e: Error) => toast({ title: "Kunde inte skapa order", description: e.message, variant: "destructive" }),
  });

  const busy = saveTemplateMutation.isPending || copyMutation.isPending || executeMutation.isPending;

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between text-sm py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );

  return (
    <div className="space-y-6" data-testid="step7-review-save">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Sammanfattning
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Namn" value={conceptName || "—"} />
          <Row label="Kund" value={customerName || "Från metadata"} />
          <Row label="Kluster" value={`${clusterCount} st`} />
          <Row label="Villkorsfilter" value={`${filterCount} st`} />
          <Row label="Uppgifter/artiklar" value={`${articleCount} st`} />
          <Row label="Leveranstid" value={deliveryTimeType === "interval" ? "Intervall" : deliveryTimeType === "time_window" ? "Tidsfönster" : "—"} />
          <Separator className="my-2" />
          <Row label="Beräknat ordervärde" value={`${totalValueKr.toLocaleString("sv-SE")} kr`} />
          <Row label="Beräknad kostnad" value={`${totalCostKr.toLocaleString("sv-SE")} kr`} />
          <Row label="Beräknad arbetstid" value={`${estimatedHours.toFixed(1)} h`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Spara som mall</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="template-name" className="text-xs mb-1 block">Mallnamn (valfritt)</Label>
            <Input id="template-name" placeholder={`${conceptName || "Koncept"} (mall)`} value={templateName} onChange={(e) => setTemplateName(e.target.value)} data-testid="input-template-name" />
          </div>
          <Button variant="outline" disabled={busy || !conceptId} onClick={() => saveTemplateMutation.mutate()} data-testid="button-save-template">
            {saveTemplateMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Spara mall
          </Button>
          <Button variant="outline" disabled={busy || !conceptId} onClick={() => copyMutation.mutate()} data-testid="button-copy-concept">
            {copyMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Copy className="h-4 w-4 mr-1" />}
            Kopiera koncept
          </Button>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button size="lg" disabled={busy || !conceptId} onClick={() => executeMutation.mutate()} data-testid="button-create-order">
          {executeMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
          Skapa order
        </Button>
      </div>
    </div>
  );
}
