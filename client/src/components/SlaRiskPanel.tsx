import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { sv } from "date-fns/locale";
import { AlertTriangle, ShieldAlert, ShieldCheck, Clock, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

type RiskLevel = "ok" | "warning" | "critical";

type RiskJob = {
  workOrderId: string;
  title: string;
  riskLevel: RiskLevel;
  daysToBreach: number;
  deadlineAt: string;
  predictedCompletionDate: string;
  reason: string;
  scheduledDate: string | null;
  estimatedDuration: number | null;
  orderStatus: string | null;
  assigned: boolean;
  customerName: string | null;
  objectName: string | null;
};

const RISK_BADGE: Record<RiskLevel, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-chart-2/15 text-chart-2 dark:bg-chart-2/15" },
  warning: { label: "Varning", cls: "bg-warning/15 text-warning dark:bg-warning/15" },
  critical: { label: "Kritisk", cls: "bg-destructive/15 text-destructive dark:bg-destructive/15" },
};

export function SlaRiskJobsList({
  riskLevel = "warning,critical",
  limit = 25,
  onSelectJob,
}: {
  riskLevel?: string;
  limit?: number;
  onSelectJob?: (id: string) => void;
}) {
  const params = new URLSearchParams({ riskLevel, limit: String(limit) });

  const { data, isLoading } = useQuery<{ jobs: RiskJob[] }>({
    queryKey: ["/api/sla-risk/jobs", riskLevel, limit],
    queryFn: async () => {
      const res = await fetch(`/api/sla-risk/jobs?${params.toString()}`);
      if (!res.ok) throw new Error("Kunde inte hämta riskjobb");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32" data-testid="loading-sla-jobs">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const jobs = data?.jobs ?? [];
  if (jobs.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" data-testid="empty-sla-jobs">
        <ShieldCheck className="h-4 w-4 text-chart-2" />
        Inga jobb i risk just nu.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full max-h-[60vh]">
      <div className="space-y-2 pr-2" data-testid="list-sla-jobs">
        {jobs.map(job => {
          const Icon = job.riskLevel === "critical" ? ShieldAlert : AlertTriangle;
          const colorCls = job.riskLevel === "critical"
            ? "border-destructive/30 dark:border-destructive/70 bg-destructive/10 dark:bg-destructive/15"
            : "border-warning/30 dark:border-warning/70 bg-warning/10 dark:bg-warning/15";
          const iconCls = job.riskLevel === "critical" ? "text-destructive" : "text-warning";
          const days = job.daysToBreach;
          const daysLabel = days < 0
            ? `${Math.abs(days).toFixed(1)} dagar över`
            : `${days.toFixed(1)} dagar kvar`;
          return (
            <button
              key={job.workOrderId}
              type="button"
              onClick={() => onSelectJob?.(job.workOrderId)}
              className={`w-full text-left flex gap-2 rounded-lg border p-3 transition hover:ring-2 hover:ring-primary/30 ${colorCls}`}
              data-testid={`sla-job-${job.workOrderId}`}
            >
              <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${iconCls}`} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate" data-testid={`sla-job-title-${job.workOrderId}`}>{job.title}</p>
                  <Badge className={`${RISK_BADGE[job.riskLevel].cls} text-[10px] flex-shrink-0`}>
                    {RISK_BADGE[job.riskLevel].label}
                  </Badge>
                </div>
                {(job.customerName || job.objectName) && (
                  <p className="text-xs text-muted-foreground truncate">
                    {[job.customerName, job.objectName].filter(Boolean).join(" · ")}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {daysLabel}
                  </span>
                  <span>
                    Deadline: {format(parseISO(job.deadlineAt), "d MMM", { locale: sv })}
                  </span>
                  {!job.assigned && (
                    <span className="text-destructive font-medium">Otilldelad</span>
                  )}
                </div>
                <p className="text-[11px] text-foreground/80 leading-snug">{job.reason}</p>
              </div>
              {onSelectJob && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground mt-1 flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

export function SlaRiskSummaryBadge() {
  const { data } = useQuery<{ summary: { ok: number; warning: number; critical: number; total: number }; calculatedAt: string | null }>({
    queryKey: ["/api/sla-risk/summary"],
    queryFn: async () => {
      const res = await fetch("/api/sla-risk/summary");
      if (!res.ok) throw new Error("Kunde inte hämta SLA-summary");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (!data) return null;
  const { summary } = data;
  return (
    <div className="flex items-center gap-1.5 text-xs" data-testid="sla-summary-badge">
      {summary.critical > 0 && (
        <Badge className={`${RISK_BADGE.critical.cls} text-[10px]`} data-testid="badge-critical-count">
          {summary.critical} kritiska
        </Badge>
      )}
      {summary.warning > 0 && (
        <Badge className={`${RISK_BADGE.warning.cls} text-[10px]`} data-testid="badge-warning-count">
          {summary.warning} varning
        </Badge>
      )}
      {summary.critical === 0 && summary.warning === 0 && (
        <Badge className={`${RISK_BADGE.ok.cls} text-[10px]`}>SLA OK</Badge>
      )}
    </div>
  );
}
