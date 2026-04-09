import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle, Clock, MapPin, AlertTriangle, Camera, FileSignature,
  Package, ArrowLeft, FileText, TrendingUp, Truck, Coffee, Timer,
  Download, ChevronDown, ChevronUp,
} from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { WorkOrderWithObject } from "@shared/schema";

interface DayReportProps {
  workOrders: WorkOrderWithObject[];
  resourceId: string;
  onBack: () => void;
}

export function DayReport({ workOrders, resourceId, onBack }: DayReportProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

  const todaysOrders = useMemo(() => {
    return workOrders.filter(wo => {
      if (!wo.scheduledDate) return false;
      if (resourceId && wo.resourceId !== resourceId) return false;
      const scheduled = new Date(wo.scheduledDate);
      return scheduled >= todayStart && scheduled <= todayEnd;
    });
  }, [workOrders, resourceId]);

  const completedStatuses = new Set(["utford", "fakturerad"]);
  const terminalStatuses = new Set(["utford", "fakturerad", "omojlig", "avbruten"]);
  const completedOrders = todaysOrders.filter(wo => completedStatuses.has(wo.orderStatus));
  const pendingOrders = todaysOrders.filter(wo => !terminalStatuses.has(wo.orderStatus));
  const impossibleOrders = todaysOrders.filter(wo => wo.orderStatus === "omojlig");
  const totalOrders = todaysOrders.length;
  const completionRate = totalOrders > 0 ? Math.round((completedOrders.length / totalOrders) * 100) : 0;

  const totalEstimatedMinutes = todaysOrders.reduce((sum, wo) => sum + (wo.estimatedDuration || 0), 0);
  const totalActualMinutes = completedOrders.reduce((sum, wo) => {
    const meta = (wo.metadata as Record<string, unknown>) || {};
    return sum + (typeof meta.actualDuration === "number" ? meta.actualDuration : (wo.estimatedDuration || 0));
  }, 0);

  const ordersWithPhotos = todaysOrders.filter(wo => {
    const meta = (wo.metadata as Record<string, unknown>) || {};
    const photos = meta.photos as string[] | undefined;
    return photos && photos.length > 0;
  });
  const totalPhotos = todaysOrders.reduce((sum, wo) => {
    const meta = (wo.metadata as Record<string, unknown>) || {};
    const photos = meta.photos as string[] | undefined;
    return sum + (photos?.length || 0);
  }, 0);

  const ordersWithSignature = todaysOrders.filter(wo => {
    const meta = (wo.metadata as Record<string, unknown>) || {};
    return !!meta.signaturePath;
  });

  const ordersWithMaterials = todaysOrders.filter(wo => {
    const meta = (wo.metadata as Record<string, unknown>) || {};
    const materials = meta.materials as Array<unknown> | undefined;
    return materials && materials.length > 0;
  });
  const totalMaterialItems = todaysOrders.reduce((sum, wo) => {
    const meta = (wo.metadata as Record<string, unknown>) || {};
    const materials = meta.materials as Array<unknown> | undefined;
    return sum + (materials?.length || 0);
  }, 0);

  const typeBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const wo of todaysOrders) {
      const type = wo.orderType || "service";
      counts[type] = (counts[type] || 0) + 1;
    }
    const labels: Record<string, string> = {
      service: "Service", tvatt: "Tvätt", besiktning: "Besiktning",
      kontroll: "Kontroll", etablering: "Etablering", tomning: "Tömning",
      reparation: "Reparation", installation: "Installation",
    };
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, label: labels[type] || type, count }));
  }, [todaysOrders]);

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  const handleExportText = () => {
    const lines: string[] = [];
    lines.push(`DAGSRAPPORT — ${format(today, "EEEE d MMMM yyyy", { locale: sv })}`);
    lines.push(`Resurs: ${resourceId}`);
    lines.push("");
    lines.push(`Utförda: ${completedOrders.length}/${totalOrders}`);
    lines.push(`Omöjliga: ${impossibleOrders.length}`);
    lines.push(`Slutförandegrad: ${completionRate}%`);
    lines.push(`Beräknad tid: ${totalEstimatedMinutes} min`);
    lines.push(`Faktisk tid: ${totalActualMinutes} min`);
    lines.push(`Foton: ${totalPhotos}`);
    lines.push(`Signaturer: ${ordersWithSignature.length}`);
    lines.push(`Material: ${totalMaterialItems} poster`);
    lines.push("");
    lines.push("JOBB:");
    for (const wo of todaysOrders) {
      const status = completedStatuses.has(wo.orderStatus) ? "✓" : wo.orderStatus === "omojlig" ? "✗" : wo.orderStatus === "avbruten" ? "—" : "○";
      lines.push(`  ${status} ${wo.title} — ${wo.objectAddress || wo.objectName || ""}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dagsrapport_${format(today, "yyyy-MM-dd")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-background" data-testid="day-report-view">
      <div className="flex items-center gap-3 p-4 border-b bg-card">
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-from-report">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold">Dagsrapport</h1>
          <p className="text-sm text-muted-foreground">
            {format(today, "EEEE d MMMM yyyy", { locale: sv })}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExportText} data-testid="button-export-report" className="gap-1.5">
          <Download className="h-4 w-4" />
          Exportera
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm text-muted-foreground">Slutförande</p>
                <p className="text-3xl font-bold" data-testid="text-completion-rate">{completionRate}%</p>
              </div>
              <div className="h-16 w-16 rounded-full border-4 border-primary flex items-center justify-center">
                <span className="text-lg font-bold" data-testid="text-completed-count">{completedOrders.length}/{totalOrders}</span>
              </div>
            </div>
            <Progress value={completionRate} className="h-2" />
            <div className="flex items-center gap-4 mt-3 text-sm">
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle className="h-3.5 w-3.5" />
                {completedOrders.length} klara
              </span>
              {pendingOrders.length > 0 && (
                <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                  <Clock className="h-3.5 w-3.5" />
                  {pendingOrders.length} kvar
                </span>
              )}
              {impossibleOrders.length > 0 && (
                <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {impossibleOrders.length} omöjliga
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Timer className="h-4 w-4 text-blue-500" />
                <p className="text-xs text-muted-foreground">Beräknad tid</p>
              </div>
              <p className="text-lg font-semibold" data-testid="text-estimated-time">
                {Math.floor(totalEstimatedMinutes / 60)}h {totalEstimatedMinutes % 60}m
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-green-500" />
                <p className="text-xs text-muted-foreground">Faktisk tid</p>
              </div>
              <p className="text-lg font-semibold" data-testid="text-actual-time">
                {Math.floor(totalActualMinutes / 60)}h {totalActualMinutes % 60}m
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <Camera className="h-4 w-4 text-purple-500" />
                <p className="text-xs text-muted-foreground">Foton</p>
              </div>
              <p className="text-lg font-semibold" data-testid="text-photo-count">{totalPhotos}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2 mb-1">
                <FileSignature className="h-4 w-4 text-teal-500" />
                <p className="text-xs text-muted-foreground">Signaturer</p>
              </div>
              <p className="text-lg font-semibold" data-testid="text-signature-count">{ordersWithSignature.length}</p>
            </CardContent>
          </Card>
        </div>

        {typeBreakdown.length > 0 && (
          <Card>
            <CardHeader
              className="py-3 px-4 cursor-pointer"
              onClick={() => toggleSection("types")}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Jobbtyper
                </CardTitle>
                {expandedSection === "types" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {expandedSection === "types" && (
              <CardContent className="py-2 px-4 space-y-2">
                {typeBreakdown.map(({ type, label, count }) => (
                  <div key={type} className="flex items-center justify-between">
                    <span className="text-sm">{label}</span>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        )}

        {ordersWithMaterials.length > 0 && (
          <Card>
            <CardHeader
              className="py-3 px-4 cursor-pointer"
              onClick={() => toggleSection("materials")}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Material ({totalMaterialItems} poster)
                </CardTitle>
                {expandedSection === "materials" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {expandedSection === "materials" && (
              <CardContent className="py-2 px-4 space-y-2">
                {ordersWithMaterials.map(wo => {
                  const meta = (wo.metadata as Record<string, unknown>) || {};
                  const materials = (meta.materials as Array<{ name: string; quantity: number; unit: string }>) || [];
                  return (
                    <div key={wo.id} className="border-l-2 border-primary/30 pl-3">
                      <p className="text-xs font-medium text-muted-foreground mb-1">{wo.title}</p>
                      {materials.map((m, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span>{m.name}</span>
                          <span className="text-muted-foreground">{m.quantity} {m.unit}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </CardContent>
            )}
          </Card>
        )}

        <Card>
          <CardHeader
            className="py-3 px-4 cursor-pointer"
            onClick={() => toggleSection("jobs")}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Alla jobb ({totalOrders})
              </CardTitle>
              {expandedSection === "jobs" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </CardHeader>
          {expandedSection === "jobs" && (
            <CardContent className="py-2 px-4 space-y-2">
              {todaysOrders.map(wo => {
                const meta = (wo.metadata as Record<string, unknown>) || {};
                const photos = (meta.photos as string[]) || [];
                const hasSig = !!meta.signaturePath;
                const materials = (meta.materials as Array<unknown>) || [];
                return (
                  <div
                    key={wo.id}
                    className="flex items-start gap-3 py-2 border-b last:border-b-0"
                    data-testid={`report-job-${wo.id}`}
                  >
                    <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${
                      completedStatuses.has(wo.orderStatus)
                        ? "bg-green-100 dark:bg-green-900/30"
                        : wo.orderStatus === "omojlig"
                        ? "bg-red-100 dark:bg-red-900/30"
                        : "bg-muted"
                    }`}>
                      {completedStatuses.has(wo.orderStatus) ? (
                        <CheckCircle className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                      ) : wo.orderStatus === "omojlig" ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{wo.title}</p>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {wo.objectAddress || wo.objectName}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {wo.scheduledStartTime && (
                          <Badge variant="outline" className="text-[10px]">{wo.scheduledStartTime}</Badge>
                        )}
                        {photos.length > 0 && (
                          <Badge variant="secondary" className="text-[10px] gap-0.5">
                            <Camera className="h-2.5 w-2.5" />{photos.length}
                          </Badge>
                        )}
                        {hasSig && (
                          <Badge variant="secondary" className="text-[10px] gap-0.5">
                            <FileSignature className="h-2.5 w-2.5" />
                          </Badge>
                        )}
                        {materials.length > 0 && (
                          <Badge variant="secondary" className="text-[10px] gap-0.5">
                            <Package className="h-2.5 w-2.5" />{materials.length}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
