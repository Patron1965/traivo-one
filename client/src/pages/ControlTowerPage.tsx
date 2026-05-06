import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Gauge, AlertTriangle, Users, ClipboardList, TrendingUp, ChevronLeft, ChevronRight, ShieldAlert, Eye, EyeOff } from "lucide-react";
import { SlaRiskClusterGrid, SlaRiskJobsList } from "@/components/SlaRiskPanel";
import { format, parseISO } from "date-fns";
import { sv } from "date-fns/locale";

type CellOrder = {
  id: string;
  title: string;
  status: string;
  estimatedDuration: number;
  plannedWindowEnd: string | null;
  slaAtRisk: boolean;
};

type HeatmapCell = {
  date: string;
  orderCount: number;
  totalMinutes: number;
  capacityPercent: number;
  slaAtRisk: number;
  deviationCount: number;
  completedCount: number;
  level: "empty" | "low" | "medium" | "high" | "overloaded";
  orders: CellOrder[];
};

type HeatmapRow = {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  weeklyHours: number;
  teamId: string | null;
  cells: HeatmapCell[];
};

type TeamOption = { id: string; name: string };

type HeatmapData = {
  dates: string[];
  rows: HeatmapRow[];
  summary: {
    totalResources: number;
    totalOrders: number;
    avgCapacity: number;
    overloadedCells: number;
    slaRiskTotal: number;
    slaUnassigned: number;
  };
  weeks: number;
  teamOptions: TeamOption[];
  unassignedSlaByDate: Record<string, number>;
};

const LEVEL_COLORS: Record<HeatmapCell["level"], string> = {
  empty: "bg-gray-100 dark:bg-gray-800",
  low: "bg-chart-2/15 dark:bg-chart-2/15",
  medium: "bg-chart-4/15 dark:bg-chart-4/15",
  high: "bg-chart-4/20 dark:bg-chart-4/15",
  overloaded: "bg-destructive/30 dark:bg-destructive/15",
};

const LEVEL_BORDERS: Record<HeatmapCell["level"], string> = {
  empty: "border-gray-200 dark:border-gray-700",
  low: "border-chart-2/30 dark:border-chart-2/70",
  medium: "border-chart-4/30 dark:border-chart-4/70",
  high: "border-chart-4/40 dark:border-chart-4/70",
  overloaded: "border-destructive/50 dark:border-destructive/60",
};

const LEVEL_LABELS: Record<HeatmapCell["level"], string> = {
  empty: "Ledig",
  low: "Låg (≤50%)",
  medium: "Normal (51-80%)",
  high: "Hög (81-100%)",
  overloaded: "Överbelastad (>100%)",
};

function SummaryCard({ icon: Icon, label, value, color }: {
  icon: typeof Gauge;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <Card data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

const STATUS_LABELS: Record<string, string> = {
  ny: "Ny", planerad: "Planerad", planerad_resurs: "Planerad", paborjad: "Påbörjad",
  utford: "Utförd", avslutad: "Avslutad", completed: "Klar", cancelled: "Avbruten",
  in_progress: "Pågår", draft: "Utkast",
};

function CellDetailDialog({ cell, resourceName, open, onClose }: {
  cell: HeatmapCell;
  resourceName: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="dialog-cell-detail">
        <DialogHeader>
          <DialogTitle className="text-base">
            {resourceName} — {format(parseISO(cell.date), "EEEE d MMMM", { locale: sv })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3 dark:border-gray-700">
              <p className="text-[10px] uppercase text-muted-foreground">Beläggning</p>
              <p className="text-xl font-bold">{cell.capacityPercent}%</p>
              <p className="text-xs text-muted-foreground">{cell.totalMinutes} min</p>
            </div>
            <div className="rounded-lg border p-3 dark:border-gray-700">
              <p className="text-[10px] uppercase text-muted-foreground">Ordrar</p>
              <p className="text-xl font-bold">{cell.orderCount}</p>
              <p className="text-xs text-muted-foreground">{cell.completedCount} klara</p>
            </div>
          </div>
          {cell.slaAtRisk > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 dark:border-destructive/70 bg-destructive/10 dark:bg-destructive/15 p-3">
              <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-destructive">SLA-risk</p>
                <p className="text-xs text-destructive">{cell.slaAtRisk} ordrar nära deadline</p>
              </div>
            </div>
          )}
          {cell.deviationCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-chart-4/30 dark:border-chart-4/70 bg-chart-4/10 dark:bg-chart-4/15 p-3">
              <AlertTriangle className="h-4 w-4 text-chart-4 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-chart-4">Avvikelser</p>
                <p className="text-xs text-chart-4">{cell.deviationCount} rapporterade avvikelser</p>
              </div>
            </div>
          )}
          {cell.orders.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Schemalagda ordrar</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {cell.orders.map(order => (
                  <div
                    key={order.id}
                    className={`flex items-center justify-between rounded border p-2 text-xs dark:border-gray-700 ${order.slaAtRisk ? "border-destructive/30 dark:border-destructive/70 bg-destructive/10 dark:bg-destructive/15" : ""}`}
                    data-testid={`order-row-${order.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{order.title}</p>
                      <p className="text-muted-foreground">{order.estimatedDuration} min · {STATUS_LABELS[order.status] || order.status}</p>
                    </div>
                    {order.slaAtRisk && (
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive flex-shrink-0 ml-2" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className={`rounded-lg border p-3 ${LEVEL_COLORS[cell.level]} ${LEVEL_BORDERS[cell.level]}`}>
            <p className="text-xs font-medium">Nivå: {LEVEL_LABELS[cell.level]}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HeatmapCellComponent({ cell, onClick }: { cell: HeatmapCell; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={`relative w-full h-10 rounded border cursor-pointer transition-colors hover:ring-2 hover:ring-primary/40 ${LEVEL_COLORS[cell.level]} ${LEVEL_BORDERS[cell.level]}`}
          data-testid={`heatmap-cell-${cell.date}`}
        >
          <div className="flex items-center justify-center h-full">
            {cell.orderCount > 0 && (
              <span className="text-xs font-medium text-foreground/80">{cell.capacityPercent}%</span>
            )}
          </div>
          {cell.slaAtRisk > 0 && (
            <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-destructive/15 flex items-center justify-center">
              <span className="text-[8px] text-white font-bold">{cell.slaAtRisk}</span>
            </div>
          )}
          {cell.deviationCount > 0 && (
            <div className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-chart-4/15 flex items-center justify-center">
              <span className="text-[8px] text-white font-bold">{cell.deviationCount}</span>
            </div>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1">
          <p className="font-medium">{format(parseISO(cell.date), "EEEE d MMM", { locale: sv })}</p>
          <p className="text-xs">Ordrar: {cell.orderCount} ({cell.completedCount} klara)</p>
          <p className="text-xs">Beläggning: {cell.capacityPercent}% ({cell.totalMinutes} min)</p>
          {cell.slaAtRisk > 0 && (
            <p className="text-xs text-destructive">SLA-risk: {cell.slaAtRisk} ordrar</p>
          )}
          {cell.deviationCount > 0 && (
            <p className="text-xs text-chart-4">Avvikelser: {cell.deviationCount}</p>
          )}
          <p className="text-[10px] text-muted-foreground italic">Klicka för detaljer</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default function ControlTowerPage() {
  const [weeks, setWeeks] = useState<number>(2);
  const [filterType, setFilterType] = useState<string>("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [selectedCell, setSelectedCell] = useState<{ cell: HeatmapCell; resourceName: string } | null>(null);
  const [showRiskLayer, setShowRiskLayer] = useState<boolean>(true);

  const queryParams = new URLSearchParams({ weeks: String(weeks) });
  if (teamFilter !== "all") queryParams.set("teamId", teamFilter);
  if (filterType !== "all") queryParams.set("resourceType", filterType);

  const { data, isLoading, isError } = useQuery<HeatmapData>({
    queryKey: ["/api/planning/heatmap", weeks, teamFilter, filterType],
    queryFn: async () => {
      const res = await fetch(`/api/planning/heatmap?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Kunde inte hämta heatmap-data");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const filteredRows = data?.rows || [];

  const weekGroups: { weekLabel: string; dates: string[] }[] = [];
  if (data?.dates) {
    let currentWeek: string[] = [];
    let currentWeekNum = -1;
    for (const dateStr of data.dates) {
      const d = parseISO(dateStr);
      const weekNum = getISOWeek(d);
      if (weekNum !== currentWeekNum) {
        if (currentWeek.length > 0) {
          weekGroups.push({ weekLabel: `V${currentWeekNum}`, dates: currentWeek });
        }
        currentWeek = [dateStr];
        currentWeekNum = weekNum;
      } else {
        currentWeek.push(dateStr);
      }
    }
    if (currentWeek.length > 0) {
      weekGroups.push({ weekLabel: `V${currentWeekNum}`, dates: currentWeek });
    }
  }

  const dayHeaders = data?.dates.map(dateStr => {
    const d = parseISO(dateStr);
    return {
      date: dateStr,
      dayName: format(d, "EEE", { locale: sv }),
      dayNum: format(d, "d"),
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    };
  }) || [];

  const handleCellClick = useCallback((cell: HeatmapCell, resourceName: string) => {
    setSelectedCell({ cell, resourceName });
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
    <div className="p-6 space-y-6">
      <PageHeader
        icon={Gauge}
        title="Kontrollpanel"
        description="Beläggning, SLA-risk och avvikelser per resurs och dag"
        testId="text-control-tower-title"
      >
        <div className="flex items-center gap-2 flex-wrap">
          {data?.teamOptions && data.teamOptions.length > 0 && (
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger className="w-[140px]" data-testid="select-team-filter">
                <SelectValue placeholder="Team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla team</SelectItem>
                {data.teamOptions.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[140px]" data-testid="select-resource-type">
              <SelectValue placeholder="Resurstyp" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla resurser</SelectItem>
              <SelectItem value="person">Personal</SelectItem>
              <SelectItem value="vehicle">Fordon</SelectItem>
              <SelectItem value="team">Team</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={showRiskLayer ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setShowRiskLayer(v => !v)}
            data-testid="button-toggle-risk-layer"
          >
            {showRiskLayer ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            Risk-lager
          </Button>
          <div className="flex items-center gap-1 bg-muted rounded-md px-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setWeeks(w => Math.max(1, w - 1))}
              disabled={weeks <= 1}
              data-testid="button-fewer-weeks"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium px-2" data-testid="text-weeks-count">{weeks}v</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setWeeks(w => Math.min(8, w + 1))}
              disabled={weeks >= 8}
              data-testid="button-more-weeks"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </PageHeader>

      {data?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="summary-cards">
          <SummaryCard icon={Users} label="Resurser" value={data.summary.totalResources} color="bg-[#1B4B6B]" />
          <SummaryCard icon={ClipboardList} label="Ordrar" value={data.summary.totalOrders} color="bg-[#4A9B9B]" />
          <SummaryCard icon={TrendingUp} label="Snittbeläggning" value={`${data.summary.avgCapacity}%`} color="bg-[#7DBFB0]" />
          <SummaryCard icon={AlertTriangle} label="Överbelastade" value={data.summary.overloadedCells} color="bg-chart-4/15" />
          <SummaryCard icon={AlertTriangle} label="SLA-risk" value={data.summary.slaRiskTotal} color="bg-destructive/15" />
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isError ? (
            <div className="flex items-center justify-center h-48" data-testid="error-heatmap">
              <div className="flex flex-col items-center gap-2 text-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
                <p className="text-sm text-muted-foreground">Kunde inte ladda heatmap-data</p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-48" data-testid="loading-heatmap">
              <div className="flex flex-col items-center gap-2">
                <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground">Laddar heatmap...</p>
              </div>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex items-center justify-center h-48" data-testid="empty-heatmap">
              <p className="text-sm text-muted-foreground">Inga resurser att visa</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[700px]">
                <thead>
                  <tr className="border-b dark:border-gray-700">
                    <th className="sticky left-0 z-10 bg-background p-2 text-left text-xs font-medium text-muted-foreground w-[160px] min-w-[160px]">
                      Resurs
                    </th>
                    {weekGroups.map(wg => (
                      <th
                        key={wg.weekLabel}
                        colSpan={wg.dates.length}
                        className="p-1 text-center text-xs font-semibold text-muted-foreground border-l dark:border-gray-700"
                      >
                        {wg.weekLabel}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b dark:border-gray-700">
                    <th className="sticky left-0 z-10 bg-background" />
                    {dayHeaders.map(dh => {
                      const unassignedSla = data?.unassignedSlaByDate?.[dh.date] || 0;
                      return (
                        <th
                          key={dh.date}
                          className={`p-1 text-center text-[10px] font-normal ${dh.isWeekend ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          <div>{dh.dayName}</div>
                          <div className="font-medium">{dh.dayNum}</div>
                          {unassignedSla > 0 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="mx-auto mt-0.5 w-4 h-4 rounded-full bg-destructive/15 flex items-center justify-center cursor-help" data-testid={`unassigned-sla-${dh.date}`}>
                                  <span className="text-[8px] text-white font-bold">{unassignedSla}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                <p className="text-xs">{unassignedSla} ej tilldelade ordrar med SLA-risk</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(row => (
                    <tr key={row.resourceId} className="border-b dark:border-gray-800 hover:bg-muted/30" data-testid={`heatmap-row-${row.resourceId}`}>
                      <td className="sticky left-0 z-10 bg-background p-2">
                        <div className="flex items-center gap-2 min-w-[140px]">
                          <div className="w-7 h-7 rounded-full bg-[#1B4B6B] dark:bg-[#4A9B9B] flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                            {row.resourceName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate" data-testid={`text-resource-name-${row.resourceId}`}>{row.resourceName}</p>
                            <p className="text-[10px] text-muted-foreground">{row.weeklyHours}h/v</p>
                          </div>
                        </div>
                      </td>
                      {row.cells.map(cell => (
                        <td key={cell.date} className="p-0.5">
                          <HeatmapCellComponent
                            cell={cell}
                            onClick={() => handleCellClick(cell, row.resourceName)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {showRiskLayer && (
        <div className="space-y-3" data-testid="sla-risk-layer">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-semibold">SLA-tidigvarning — kommande 7 dagar</h3>
            <span className="text-xs text-muted-foreground">Aggregerad risk per kluster och topp-25 risker</span>
          </div>
          <Card>
            <CardContent className="p-4">
              <SlaRiskClusterGrid days={7} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase text-muted-foreground font-semibold mb-3">Topp-25 risker</p>
              <SlaRiskJobsList riskLevel="warning,critical" limit={25} />
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" data-testid="heatmap-legend">
        <span className="font-medium">Beläggning:</span>
        {(Object.keys(LEVEL_COLORS) as HeatmapCell["level"][]).map(level => (
          <div key={level} className="flex items-center gap-1.5">
            <div className={`w-4 h-4 rounded border ${LEVEL_COLORS[level]} ${LEVEL_BORDERS[level]}`} />
            <span>{LEVEL_LABELS[level]}</span>
          </div>
        ))}
        <span className="ml-2">|</span>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-destructive/15" />
          <span>SLA-risk</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-chart-4/15" />
          <span>Avvikelser</span>
        </div>
      </div>
    </div>

    {selectedCell && (
      <CellDetailDialog
        cell={selectedCell.cell}
        resourceName={selectedCell.resourceName}
        open={!!selectedCell}
        onClose={() => setSelectedCell(null)}
      />
    )}

    </TooltipProvider>
  );
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
