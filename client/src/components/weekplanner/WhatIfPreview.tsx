import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, XCircle, ArrowRight, Clock, Loader2, ShieldAlert, Info } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export interface WhatIfViolation {
  type: "hard" | "soft";
  category: string;
  severity: "critical" | "warning";
  workOrderId: string;
  resourceId?: string;
  description: string;
}

export interface WhatIfCapacityTarget {
  resourceId: string;
  resourceName: string;
  date: string;
  currentHours: number;
  newHours: number;
  maxHours: number;
  overbooked: boolean;
}

export interface WhatIfCapacitySource {
  resourceId: string;
  resourceName: string;
  date: string;
  currentHours: number;
  newHours: number;
  maxHours: number;
  freed: number;
}

export interface WhatIfSlaRisk {
  workOrderId: string;
  title: string;
  deadline: string;
  daysRemaining: number;
  risk: "high" | "medium" | "low";
}

export interface WhatIfResult {
  violations: WhatIfViolation[];
  capacityImpact: {
    target: WhatIfCapacityTarget;
    source: WhatIfCapacitySource | null;
  };
  affectedOrders: Array<{
    id: string;
    title: string;
    scheduledStartTime: string | null;
    estimatedDuration: number;
    etaDeltaMinutes: number | null;
  }>;
  slaRisks: WhatIfSlaRisk[];
  jobDuration: number;
  scheduledStartTime: string | null;
}

interface WhatIfPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: WhatIfResult | null;
  loading: boolean;
  jobTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function CapacityBar({ label, current, max, isNew }: { label: string; current: number; max: number; isNew?: boolean }) {
  const pct = Math.min((current / max) * 100, 150);
  const overbooked = current > max;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${overbooked ? "text-destructive" : isNew ? "text-chart-1" : "text-muted-foreground"}`}>
          {current.toFixed(1)}h / {max}h
        </span>
      </div>
      <Progress
        value={Math.min(pct, 100)}
        className={`h-2 ${overbooked ? "[&>div]:bg-destructive/15" : pct > 85 ? "[&>div]:bg-chart-4/15" : pct > 65 ? "[&>div]:bg-chart-3/15" : "[&>div]:bg-chart-2/15"}`}
      />
    </div>
  );
}

export function WhatIfPreview({ open, onOpenChange, result, loading, jobTitle, onConfirm, onCancel }: WhatIfPreviewProps) {
  const hasHardViolations = result?.violations.some(v => v.type === "hard") ?? false;
  const softViolations = result?.violations.filter(v => v.type === "soft") ?? [];
  const hardViolations = result?.violations.filter(v => v.type === "hard") ?? [];
  const noIssues = !loading && result && result.violations.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="what-if-preview-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="what-if-title">
            <Info className="h-5 w-5 text-chart-1" />
            Konsekvensanalys
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Vad händer om du flyttar <span className="font-medium text-foreground">{jobTitle}</span>?
          </p>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8 gap-2" data-testid="what-if-loading">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Analyserar konsekvenser...</span>
          </div>
        )}

        {!loading && result && (
          <div className="space-y-4" data-testid="what-if-results">
            {noIssues && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-chart-2/10 dark:bg-chart-2/15 border border-chart-2/20 dark:border-chart-2/80" data-testid="what-if-no-issues">
                <CheckCircle2 className="h-5 w-5 text-chart-2 shrink-0" />
                <span className="text-sm text-chart-2">Inga konflikter — flytten ser bra ut!</span>
              </div>
            )}

            {hardViolations.length > 0 && (
              <div className="space-y-2" data-testid="what-if-hard-violations">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium text-destructive">Hårda begränsningar ({hardViolations.length})</span>
                </div>
                <div className="space-y-1.5">
                  {hardViolations.map((v, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded bg-destructive/10 dark:bg-destructive/15 border border-destructive/20 dark:border-destructive/80" data-testid={`what-if-violation-hard-${i}`}>
                      <ShieldAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <span className="text-xs text-destructive">{v.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {softViolations.length > 0 && (
              <div className="space-y-2" data-testid="what-if-soft-violations">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-chart-4" />
                  <span className="text-sm font-medium text-chart-4">Varningar ({softViolations.length})</span>
                </div>
                <div className="space-y-1.5">
                  {softViolations.map((v, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded bg-chart-4/10 dark:bg-chart-4/15 border border-chart-4/20 dark:border-chart-4/80" data-testid={`what-if-violation-soft-${i}`}>
                      <AlertTriangle className="h-4 w-4 text-chart-4 shrink-0 mt-0.5" />
                      <span className="text-xs text-chart-4">{v.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 p-3 rounded-lg bg-muted/50 border" data-testid="what-if-capacity">
              <div className="text-sm font-medium">Kapacitetspåverkan</div>

              {result.capacityImpact.source && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="text-xs bg-chart-2/10 dark:bg-chart-2/15 border-chart-2/30 dark:border-chart-2/70 text-chart-2">
                      Frigör {result.capacityImpact.source.freed.toFixed(1)}h
                    </Badge>
                    <span className="text-muted-foreground">{result.capacityImpact.source.resourceName} ({result.capacityImpact.source.date})</span>
                  </div>
                  <CapacityBar
                    label={`${result.capacityImpact.source.resourceName} — efter`}
                    current={result.capacityImpact.source.newHours}
                    max={result.capacityImpact.source.maxHours}
                  />
                </div>
              )}

              <div className="space-y-2">
                {result.capacityImpact.source && (
                  <div className="flex items-center justify-center">
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className={`text-xs ${result.capacityImpact.target.overbooked
                    ? "bg-destructive/10 dark:bg-destructive/15 border-destructive/30 dark:border-destructive/70 text-destructive"
                    : "bg-chart-1/10 dark:bg-chart-1/15 border-chart-1/30 dark:border-chart-1/70 text-chart-1"
                  }`}>
                    +{result.jobDuration.toFixed(1)}h
                  </Badge>
                  <span className="text-muted-foreground">{result.capacityImpact.target.resourceName} ({result.capacityImpact.target.date})</span>
                </div>
                <CapacityBar
                  label={`${result.capacityImpact.target.resourceName} — efter`}
                  current={result.capacityImpact.target.newHours}
                  max={result.capacityImpact.target.maxHours}
                  isNew
                />
              </div>
            </div>

            {result.affectedOrders.length > 0 && (
              <div className="space-y-2" data-testid="what-if-affected-orders">
                <div className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Redan planerade jobb hos {result.capacityImpact.target.resourceName} ({result.affectedOrders.length})
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {result.affectedOrders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between text-xs p-1.5 rounded bg-background border" data-testid={`what-if-affected-${o.id}`}>
                      <span className="truncate mr-2">{o.title}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {o.scheduledStartTime && <span className="text-muted-foreground">{o.scheduledStartTime}</span>}
                        <span className="text-muted-foreground">{(o.estimatedDuration / 60).toFixed(1)}h</span>
                        {o.etaDeltaMinutes !== null && o.etaDeltaMinutes > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 bg-chart-4/10 dark:bg-chart-4/15 border-chart-4/30 dark:border-chart-4/70 text-chart-4" data-testid={`what-if-eta-delta-${o.id}`}>
                            +{o.etaDeltaMinutes}min
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.slaRisks && result.slaRisks.length > 0 && (
              <div className="space-y-2" data-testid="what-if-sla-risks">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-chart-4" />
                  <span className="text-sm font-medium text-chart-4">SLA-risker ({result.slaRisks.length})</span>
                </div>
                <div className="space-y-1.5">
                  {result.slaRisks.map((r) => (
                    <div key={r.workOrderId} className={`flex items-center justify-between text-xs p-2 rounded border ${
                      r.risk === "high"
                        ? "bg-destructive/10 dark:bg-destructive/15 border-destructive/20 dark:border-destructive/80"
                        : "bg-chart-4/10 dark:bg-chart-4/15 border-chart-4/20 dark:border-chart-4/80"
                    }`} data-testid={`what-if-sla-risk-${r.workOrderId}`}>
                      <span className="truncate mr-2">{r.title}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-muted-foreground">Deadline: {r.deadline}</span>
                        <Badge variant="outline" className={`text-[10px] px-1 py-0 ${
                          r.risk === "high"
                            ? "bg-destructive/15 dark:bg-destructive/15 border-destructive/40 dark:border-destructive/60 text-destructive"
                            : "bg-chart-4/15 dark:bg-chart-4/15 border-chart-4/40 dark:border-chart-4/60 text-chart-4"
                        }`}>
                          {r.daysRemaining < 0 ? `${Math.abs(r.daysRemaining)}d försenad` : `${r.daysRemaining}d kvar`}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel} data-testid="what-if-cancel">
            Avbryt
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading || !result || hasHardViolations}
            variant={hasHardViolations ? "destructive" : softViolations.length > 0 ? "default" : "default"}
            className={!hasHardViolations && softViolations.length === 0 && result ? "bg-chart-2/15 hover:bg-chart-2/15 dark:bg-chart-2/15 dark:hover:bg-chart-2/15" : ""}
            data-testid="what-if-confirm"
          >
            {loading ? "Analyserar..." : !result ? "Väntar..." : hasHardViolations ? "Blockerad" : softViolations.length > 0 ? "Flytta ändå" : "Bekräfta flytt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
