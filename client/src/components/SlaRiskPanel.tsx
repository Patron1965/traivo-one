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
  cluster: { id: string; name: string; color: string | null } | null;
};

type ClusterAgg = {
  clusterId: string | null;
  name: string;
  color: string | null;
  slaLevel: string | null;
  ok: number;
  warning: number;
  critical: number;
  total: number;
  worst: RiskLevel;
};

const RISK_BADGE: Record<RiskLevel, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-chart-2/15 text-chart-2 dark:bg-chart-2/15" },
  warning: { label: "Varning", cls: "bg-warning/15 text-warning dark:bg-warning/15" },
  critical: { label: "Kritisk", cls: "bg-destructive/15 text-destructive dark:bg-destructive/15" },
};

export function SlaRiskClusterGrid({ days = 7 }: { days?: number }) {
  const { data, isLoading } = useQuery<{ clusters: ClusterAgg[]; days: number; horizon: string }>({
    queryKey: ["/api/sla-risk/clusters", days],
    queryFn: async () => {
      const res = await fetch(`/api/sla-risk/clusters?days=${days}`);
      if (!res.ok) throw new Error("Kunde inte hämta klusterrisker");
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32" data-testid="loading-sla-clusters">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const clusters = data?.clusters ?? [];
  if (clusters.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" data-testid="empty-sla-clusters">
        <ShieldCheck className="h-4 w-4 text-chart-2" />
        Inga SLA-risker upptäckta för kommande {days} dagar.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" data-testid="grid-sla-clusters">
      {clusters.map(c => {
        const borderClass =
          c.worst === "critical" ? "border-destructive/40 dark:border-destructive/70"
          : c.worst === "warning" ? "border-warning/40 dark:border-warning/70"
          : "border-chart-2/30 dark:border-chart-2/70";
        const bgClass =
          c.worst === "critical" ? "bg-destructive/10 dark:bg-destructive/15"
          : c.worst === "warning" ? "bg-warning/10 dark:bg-warning/15"
          : "bg-chart-2/10 dark:bg-chart-2/15";
        return (
          <div
            key={c.clusterId || "_none"}
            className={`rounded-lg border p-3 ${borderClass} ${bgClass}`}
            data-testid={`cluster-risk-${c.clusterId || "none"}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                {c.color && (
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                )}
                <p className="text-sm font-medium truncate" data-testid={`cluster-name-${c.clusterId || "none"}`}>{c.name}</p>
              </div>
              <Badge className={`${RISK_BADGE[c.worst].cls} text-[10px]`} data-testid={`cluster-worst-${c.clusterId || "none"}`}>
                {RISK_BADGE[c.worst].label}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-destructive/15" />
                <span className="font-semibold">{c.critical}</span>
                <span className="text-muted-foreground">krit.</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-warning/15" />
                <span className="font-semibold">{c.warning}</span>
                <span className="text-muted-foreground">varn.</span>
              </div>
              <div className="flex items-center gap-1 text-muted-foreground">
                <span>av {c.total}</span>
              </div>
            </div>
            {c.slaLevel && (
              <p className="mt-1.5 text-[10px] uppercase text-muted-foreground">SLA: {c.slaLevel}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SlaRiskJobsList({
  riskLevel = "warning,critical",
  clusterId,
  limit = 25,
  onSelectJob,
}: {
  riskLevel?: string;
  clusterId?: string;
  limit?: number;
  onSelectJob?: (id: string) => void;
}) {
  const params = new URLSearchParams({ riskLevel, limit: String(limit) });
  if (clusterId) params.set("clusterId", clusterId);

  const { data, isLoading } = useQuery<{ jobs: RiskJob[] }>({
    queryKey: ["/api/sla-risk/jobs", riskLevel, clusterId, limit],
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
                  {job.cluster && (
                    <span className="inline-flex items-center gap-1">
                      {job.cluster.color && (
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: job.cluster.color }} />
                      )}
                      {job.cluster.name}
                    </span>
                  )}
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
