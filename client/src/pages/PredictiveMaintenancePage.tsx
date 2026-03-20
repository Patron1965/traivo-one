import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Activity,
  AlertTriangle,
  Calendar,
  Clock,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Wrench,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Forecast {
  objectId: string;
  objectName: string;
  customerName: string | null;
  deviceId: string;
  deviceType: string;
  predictedDate: string;
  daysUntilService: number;
  confidence: number;
  confidenceLevel: "high" | "medium" | "low";
  avgIntervalDays: number;
  signalCount: number;
  lastSignalAt: string | null;
  reasoning: string;
}

interface AnalyzeResult {
  forecasts: Forecast[];
  summary: string;
  dataQuality: "high" | "medium" | "low";
  totalDevices: number;
  analyzedObjects: number;
  urgentCount: number;
  upcomingCount: number;
}

const CONFIDENCE_CONFIG = {
  high: { label: "H\u00f6g", color: "bg-green-500/10 text-green-600 border-green-500/20", icon: ShieldCheck },
  medium: { label: "Medel", color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20", icon: Shield },
  low: { label: "L\u00e5g", color: "bg-red-500/10 text-red-600 border-red-500/20", icon: ShieldAlert },
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("sv-SE", { year: "numeric", month: "short", day: "numeric" });
}

function DaysUntilBadge({ days }: { days: number }) {
  if (days <= 0) {
    return <Badge variant="destructive" data-testid="badge-overdue">\u00d6verskriden</Badge>;
  }
  if (days <= 7) {
    return <Badge variant="destructive" data-testid="badge-urgent">{days} dagar</Badge>;
  }
  if (days <= 30) {
    return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20" variant="outline" data-testid="badge-upcoming">{days} dagar</Badge>;
  }
  return <Badge variant="outline" data-testid="badge-normal">{days} dagar</Badge>;
}

export default function PredictiveMaintenancePage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [createOrderDialog, setCreateOrderDialog] = useState<Forecast | null>(null);

  const { data: cachedForecasts, isLoading: cacheLoading } = useQuery<Forecast[]>({
    queryKey: ["/api/predictive/forecasts"],
  });

  const analyzeMutation = useMutation({
    mutationFn: (params: { monthsBack: number; useAI: boolean }) =>
      apiRequest("POST", "/api/predictive/analyze", params),
    onSuccess: async (response) => {
      const result: AnalyzeResult = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/predictive/forecasts"] });
      toast({
        title: "Analys klar",
        description: `${result.analyzedObjects} objekt analyserade. ${result.urgentCount} kr\u00e4ver service inom 7 dagar.`,
      });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte k\u00f6ra prediktiv analys", variant: "destructive" });
    },
  });

  const createOrderMutation = useMutation({
    mutationFn: (data: { objectId: string; scheduledDate: string; description?: string }) =>
      apiRequest("POST", "/api/predictive/create-order", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/predictive/forecasts"] });
      setCreateOrderDialog(null);
      toast({ title: "Arbetsorder skapad", description: "En ny arbetsorder har skapats fr\u00e5n prognosen." });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte skapa arbetsorder", variant: "destructive" });
    },
  });

  const forecasts = cachedForecasts || [];

  const filtered = forecasts.filter(f => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!f.objectName.toLowerCase().includes(q) && !(f.customerName || "").toLowerCase().includes(q)) return false;
    }
    if (urgencyFilter === "urgent" && f.daysUntilService > 7) return false;
    if (urgencyFilter === "upcoming" && (f.daysUntilService <= 7 || f.daysUntilService > 30)) return false;
    if (urgencyFilter === "later" && f.daysUntilService <= 30) return false;
    if (confidenceFilter !== "all" && f.confidenceLevel !== confidenceFilter) return false;
    return true;
  });

  const urgentCount = forecasts.filter(f => f.daysUntilService <= 7).length;
  const upcomingCount = forecasts.filter(f => f.daysUntilService > 7 && f.daysUntilService <= 30).length;
  const laterCount = forecasts.filter(f => f.daysUntilService > 30).length;
  const avgConfidence = forecasts.length > 0 ? Math.round(forecasts.reduce((s, f) => s + f.confidence, 0) / forecasts.length * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-predictive-title">
            <Activity className="h-6 w-6 text-primary" />
            Prediktivt underh\u00e5ll
          </h1>
          <p className="text-muted-foreground">
            AI-driven prognos f\u00f6r n\u00e4sta servicebehov baserat p\u00e5 IoT-signalhistorik
          </p>
        </div>
        <Button
          onClick={() => analyzeMutation.mutate({ monthsBack: 12, useAI: true })}
          disabled={analyzeMutation.isPending}
          data-testid="button-run-analysis"
        >
          {analyzeMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 mr-2" />
          )}
          K\u00f6r analys
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-total-forecasts">{forecasts.length}</div>
            <div className="text-xs text-muted-foreground">Objekt analyserade</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-red-600" data-testid="text-urgent-count">{urgentCount}</div>
            <div className="text-xs text-muted-foreground">Inom 7 dagar</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-yellow-600" data-testid="text-upcoming-count">{upcomingCount}</div>
            <div className="text-xs text-muted-foreground">Inom 30 dagar</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-green-600" data-testid="text-later-count">{laterCount}</div>
            <div className="text-xs text-muted-foreground">Senare</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-avg-confidence">{avgConfidence}%</div>
            <div className="text-xs text-muted-foreground">Snittkonfidens</div>
          </CardContent>
        </Card>
      </div>

      {analyzeMutation.isPending && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="font-medium">AI analyserar IoT-signalhistorik...</p>
            <p className="text-sm text-muted-foreground">Ber\u00e4knar optimala serviceintervall per objekt</p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="S\u00f6k objekt eller kund..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-forecasts"
          />
        </div>
        <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
          <SelectTrigger className="w-[150px]" data-testid="select-urgency-filter">
            <Clock className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla</SelectItem>
            <SelectItem value="urgent">Br\u00e5dskande (7d)</SelectItem>
            <SelectItem value="upcoming">Kommande (30d)</SelectItem>
            <SelectItem value="later">Senare</SelectItem>
          </SelectContent>
        </Select>
        <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
          <SelectTrigger className="w-[150px]" data-testid="select-confidence-filter">
            <Shield className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla</SelectItem>
            <SelectItem value="high">H\u00f6g konfidens</SelectItem>
            <SelectItem value="medium">Medel</SelectItem>
            <SelectItem value="low">L\u00e5g</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {cacheLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="font-medium mb-2">Inga prognoser</p>
            <p className="text-sm">Klicka &quot;K\u00f6r analys&quot; f\u00f6r att analysera IoT-signalhistorik och generera serviceprognoser</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Objekt</TableHead>
                <TableHead>Enhetstyp</TableHead>
                <TableHead className="text-center">N\u00e4sta service</TableHead>
                <TableHead className="text-center">Tid kvar</TableHead>
                <TableHead className="text-center">Konfidens</TableHead>
                <TableHead className="text-center">Intervall</TableHead>
                <TableHead className="text-center">Signaler</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((f) => {
                const confCfg = CONFIDENCE_CONFIG[f.confidenceLevel];
                const ConfIcon = confCfg.icon;
                return (
                  <TableRow key={`${f.objectId}-${f.deviceId}`} data-testid={`row-forecast-${f.objectId}`}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{f.objectName}</div>
                        {f.customerName && (
                          <div className="text-sm text-muted-foreground">{f.customerName}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{f.deviceType}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm">{formatDate(f.predictedDate)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <DaysUntilBadge days={f.daysUntilService} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={confCfg.color}>
                        <ConfIcon className="h-3 w-3 mr-1" />
                        {confCfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {f.avgIntervalDays}d
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {f.signalCount}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCreateOrderDialog(f)}
                        data-testid={`button-create-order-${f.objectId}`}
                      >
                        <Wrench className="h-4 w-4 mr-1" />
                        Order
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!createOrderDialog} onOpenChange={() => setCreateOrderDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Skapa arbetsorder</DialogTitle>
            <DialogDescription>
              Skapa en arbetsorder fr\u00e5n prediktiv prognos f\u00f6r {createOrderDialog?.objectName}
            </DialogDescription>
          </DialogHeader>
          {createOrderDialog && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                <p><strong>Objekt:</strong> {createOrderDialog.objectName}</p>
                <p><strong>Prognostiserat datum:</strong> {formatDate(createOrderDialog.predictedDate)}</p>
                <p><strong>Konfidens:</strong> {Math.round(createOrderDialog.confidence * 100)}%</p>
                <p><strong>Snittintervall:</strong> {createOrderDialog.avgIntervalDays} dagar</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOrderDialog(null)}>Avbryt</Button>
                <Button
                  onClick={() => {
                    createOrderMutation.mutate({
                      objectId: createOrderDialog.objectId,
                      scheduledDate: createOrderDialog.predictedDate,
                      description: `Prediktivt underh\u00e5ll \u2014 ${createOrderDialog.objectName} (konfidens: ${Math.round(createOrderDialog.confidence * 100)}%)`,
                    });
                  }}
                  disabled={createOrderMutation.isPending}
                  data-testid="button-confirm-create-order"
                >
                  {createOrderMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Skapa order
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
