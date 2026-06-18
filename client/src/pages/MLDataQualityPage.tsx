import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

interface TenantQuality {
  tenantId: string;
  totalCompletedWO: number;
  withActualDuration: number;
  withValidActualDuration: number;
  withScheduledDate: number;
  withExecutionCode: number;
  withCoordinates: number;
  withSetupLogLink: number;
  qualityScore: number;
  passes70Gate: boolean;
}

interface ExecutionCodeStat {
  executionCode: string;
  sampleCount: number;
  meanActualMin: number | null;
  hasEnoughSamples: boolean;
}

type MlReadinessLevel = "not_ready" | "shadow_only" | "production_eligible";

interface QualityReport {
  generatedAt: string;
  windowDays: number;
  globalValidActualRatio?: number;
  readinessLevel?: MlReadinessLevel;
  totalCompletedWO: number;
  passesVolumeGate: boolean;
  passesQualityGate: boolean;
  goNoGoRecommendation: "GO" | "NO_GO" | "WARN";
  reasoning: string[];
  tenants: TenantQuality[];
  perExecutionCode: ExecutionCodeStat[];
  snapshotStats: {
    preOptimization: number;
    postCompletion: number;
    last7Days: number;
  };
}

interface ModelsResponse {
  models: Array<{
    id: string;
    modelType: string;
    version: string;
    status: string;
    trainedAt: string | null;
    trainingRows: number | null;
    metrics: Record<string, unknown>;
  }>;
  mlPredictionEnabled: boolean;
}

const recommendationStyle: Record<QualityReport["goNoGoRecommendation"], { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  GO: { label: "Klart — redo att aktivera", cls: "bg-chart-2/15 text-chart-2 border-chart-2/30", Icon: CheckCircle2 },
  WARN: { label: "Vänta — samla mer data", cls: "bg-warning/15 text-warning border-warning/30", Icon: AlertTriangle },
  NO_GO: { label: "Inte redo — för lite data", cls: "bg-destructive/15 text-destructive border-destructive/30", Icon: XCircle },
};

export default function MLDataQualityPage() {
  const { data: report, isLoading, isFetching, refetch } = useQuery<QualityReport>({
    queryKey: ["/api/ml/data-quality"],
  });

  const { data: modelsData } = useQuery<ModelsResponse>({
    queryKey: ["/api/ml/models"],
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/ml/data-quality"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ml/models"] });
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96" data-testid="loader-ml-quality">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Kunde inte ladda datakvalitetsrapport.</p>
      </div>
    );
  }

  const rec = recommendationStyle[report.goNoGoRecommendation];
  const RecIcon = rec.Icon;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Datakvalitet för tidsberäkning</h1>
          <p className="text-muted-foreground mt-1">
            Visar om datan räcker för att slå på automatisk tidsberäkning. Mätfönster: senaste {report.windowDays} dagarna.
          </p>
        </div>
        <Button onClick={handleRefresh} variant="outline" disabled={isFetching} data-testid="button-refresh">
          {isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Kör om kontroll
        </Button>
      </div>

      <Card className={`border-2 ${rec.cls}`}>
        <CardHeader className="flex flex-row items-center gap-4">
          <RecIcon className="h-8 w-8" />
          <div>
            <CardTitle data-testid="text-recommendation">{rec.label}</CardTitle>
            <CardDescription>Genererad: {new Date(report.generatedAt).toLocaleString("sv-SE")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {report.reasoning.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-muted-foreground">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {report.readinessLevel && (
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Beredskapsnivå</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Badge
                variant={
                  report.readinessLevel === "production_eligible" ? "default"
                  : report.readinessLevel === "shadow_only" ? "secondary"
                  : "destructive"
                }
                className="text-base px-3 py-1"
                data-testid="badge-readiness"
              >
                {report.readinessLevel === "production_eligible" ? "Redo för användning (≥85%)"
                  : report.readinessLevel === "shadow_only" ? "Endast testkörning (70–85%)"
                  : "Ej redo (<70%)"}
              </Badge>
              {typeof report.globalValidActualRatio === "number" && (
                <span className="text-sm text-muted-foreground" data-testid="text-valid-ratio">
                  Andel giltig data: {(report.globalValidActualRatio * 100).toFixed(1)}%
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <strong>Ej redo:</strong> automatisk tidsberäkning är av — fasta tider används. <strong>Endast testkörning:</strong> systemet beräknar tider i bakgrunden men de används inte i planeringen ännu. <strong>Redo för användning:</strong> automatisk tidsberäkning kan slås på när träffsäkerheten är godkänd.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Utförda ordrar totalt</CardDescription></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-total-wo">{report.totalCompletedWO}</div>
            <Badge variant={report.passesVolumeGate ? "default" : "destructive"} className="mt-2">
              Kräver: ≥500 {report.passesVolumeGate ? "✓" : "✗"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Ögonblicksbilder före optimering</CardDescription></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-pre-snapshots">{report.snapshotStats.preOptimization}</div>
            <p className="text-xs text-muted-foreground mt-2">Senaste 7 dagar: {report.snapshotStats.last7Days}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Ögonblicksbilder efter slutförande</CardDescription></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-post-snapshots">{report.snapshotStats.postCompletion}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per organisation</CardTitle>
          <CardDescription>Datakvalitet per organisation. Kräver: ≥70% komplett data.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left text-muted-foreground">
                  <th className="py-2 px-2">Organisation</th>
                  <th className="py-2 px-2 text-right">Ordrar totalt</th>
                  <th className="py-2 px-2 text-right">Giltig faktisk tid (5min–12h)</th>
                  <th className="py-2 px-2 text-right">Med kod</th>
                  <th className="py-2 px-2 text-right">Med koord</th>
                  <th className="py-2 px-2 text-right">Med tidslogg</th>
                  <th className="py-2 px-2 text-right">Kvalitet</th>
                  <th className="py-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {report.tenants.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">Ingen utförd data i mätfönstret.</td></tr>
                )}
                {report.tenants.map(t => (
                  <tr key={t.tenantId} className="border-b" data-testid={`row-tenant-${t.tenantId}`}>
                    <td className="py-2 px-2 font-mono text-xs">{t.tenantId}</td>
                    <td className="py-2 px-2 text-right">{t.totalCompletedWO}</td>
                    <td className="py-2 px-2 text-right">{t.withValidActualDuration}</td>
                    <td className="py-2 px-2 text-right">{t.withExecutionCode}</td>
                    <td className="py-2 px-2 text-right">{t.withCoordinates}</td>
                    <td className="py-2 px-2 text-right">{t.withSetupLogLink}</td>
                    <td className="py-2 px-2 text-right">{(t.qualityScore * 100).toFixed(0)}%</td>
                    <td className="py-2 px-2">
                      <Badge variant={t.passes70Gate ? "default" : "destructive"} data-testid={`badge-status-${t.tenantId}`}>
                        {t.passes70Gate ? "Passerar" : "Under tröskel"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {report.perExecutionCode.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Per utförandekod</CardTitle>
            <CardDescription>Underlag per utförandekod. Krav: ≥30 prov per kod.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 px-2">Kod</th>
                    <th className="py-2 px-2 text-right">Prov</th>
                    <th className="py-2 px-2 text-right">Snitt (min)</th>
                    <th className="py-2 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.perExecutionCode.slice(0, 20).map(c => (
                    <tr key={c.executionCode} className="border-b" data-testid={`row-code-${c.executionCode}`}>
                      <td className="py-2 px-2 font-mono text-xs">{c.executionCode}</td>
                      <td className="py-2 px-2 text-right">{c.sampleCount}</td>
                      <td className="py-2 px-2 text-right">{c.meanActualMin ?? "—"}</td>
                      <td className="py-2 px-2">
                        <Badge variant={c.hasEnoughSamples ? "default" : "outline"}>
                          {c.hasEnoughSamples ? "Tillräckligt underlag" : "För få prov"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {modelsData && (
        <Card>
          <CardHeader>
            <CardTitle>Prognosmodeller</CardTitle>
            <CardDescription>
              Automatisk tidsberäkning: {modelsData.mlPredictionEnabled
                ? <Badge variant="default">AKTIVERAD</Badge>
                : <Badge variant="outline">Avstängd (standard)</Badge>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {modelsData.models.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-models">
                Inga modeller tränade ännu. Vänta på "Klart" i kontrollen ovan, kör sedan <code className="px-1 bg-muted rounded">scripts/train_duration_model.py</code>.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left text-muted-foreground">
                    <th className="py-2 px-2">Typ</th>
                    <th className="py-2 px-2">Version</th>
                    <th className="py-2 px-2">Status</th>
                    <th className="py-2 px-2 text-right">Tränad</th>
                    <th className="py-2 px-2 text-right">Rader</th>
                  </tr>
                </thead>
                <tbody>
                  {modelsData.models.map(m => (
                    <tr key={m.id} className="border-b">
                      <td className="py-2 px-2 font-mono text-xs">{m.modelType}</td>
                      <td className="py-2 px-2">{m.version}</td>
                      <td className="py-2 px-2"><Badge variant="outline">{m.status}</Badge></td>
                      <td className="py-2 px-2 text-right">{m.trainedAt ? new Date(m.trainedAt).toLocaleDateString("sv-SE") : "—"}</td>
                      <td className="py-2 px-2 text-right">{m.trainingRows ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
