import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

import { BarChart3, User, RefreshCw, CloudRain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { queryClient } from "@/lib/queryClient";

interface ResourceCapacity {
  resourceId: string;
  resourceName: string;
  bookedMinutes: number;
  availableMinutes: number;
  utilization: number;
}

interface CapacityData {
  date: string;
  resources: ResourceCapacity[];
}

interface WeatherForecastResp {
  forecasts?: Array<{ date: string; temperature: number; precipitation: number; windSpeed: number; weatherCode: number; weatherDescription: string }>;
  impacts?: Array<{ date: string; impactLevel: "none" | "low" | "medium" | "high" | "severe"; capacityMultiplier: number; reason: string }>;
  disabled?: boolean;
}

function getUtilizationColor(utilization: number) {
  if (utilization > 90) return { bar: "bg-destructive/15", text: "text-destructive", bg: "bg-destructive/15" };
  if (utilization >= 60) return { bar: "bg-chart-4/15", text: "text-chart-4", bg: "bg-chart-4/15" };
  return { bar: "bg-chart-2/15", text: "text-chart-2", bg: "bg-chart-2/15" };
}

export function CapacityOverview() {
  const today = new Date();
  const dateStr = format(today, "yyyy-MM-dd");

  const { data, isLoading, isError } = useQuery<CapacityData>({
    queryKey: ["/api/dashboard/capacity", dateStr],
    staleTime: 60000,
  });

  const { data: weather } = useQuery<WeatherForecastResp>({
    queryKey: ["/api/weather/forecast"],
    staleTime: 30 * 60 * 1000,
  });

  const todayImpact = weather?.impacts?.find(i => i.date === dateStr);
  const weatherMultiplier = todayImpact?.capacityMultiplier ?? 1.0;
  const weatherActive = !weather?.disabled && weatherMultiplier < 1.0;

  if (isError) {
    return (
      <Card data-testid="card-capacity-error">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5 text-destructive" />
            Kapacitetsöversikt
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground text-sm space-y-2">
            <p>Kunde inte hämta kapacitetsdata</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/dashboard/capacity", dateStr] })}
              data-testid="button-retry-capacity"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Försök igen
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card data-testid="card-capacity-loading">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  const resources = data?.resources || [];

  if (resources.length === 0) {
    return (
      <Card data-testid="card-capacity-empty">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            Kapacitetsöversikt
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground text-sm">
            <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Inga aktiva resurser
          </div>
        </CardContent>
      </Card>
    );
  }

  const sorted = [...resources].sort((a, b) => b.utilization - a.utilization);
  const avgUtilization = resources.length > 0
    ? Math.round(resources.reduce((sum, r) => sum + r.utilization, 0) / resources.length)
    : 0;
  const adjustedAvgUtilization = weatherActive
    ? Math.min(999, Math.round(avgUtilization / weatherMultiplier))
    : avgUtilization;
  const avgColor = getUtilizationColor(adjustedAvgUtilization);
  const weatherPctIncrease = weatherActive ? Math.round((1 / weatherMultiplier - 1) * 100) : 0;

  return (
    <Card data-testid="card-capacity-overview">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5 text-primary" />
            Kapacitetsöversikt
          </CardTitle>
          <Badge variant="outline" className="text-xs" data-testid="badge-capacity-date">
            {format(today, "EEEE d MMMM", { locale: sv })}
          </Badge>
        </div>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <div className="flex items-center gap-1.5" data-testid="capacity-theoretical">
            <span className="text-xs text-muted-foreground">Teoretisk:</span>
            <Badge variant="outline" className="text-xs" data-testid="badge-theoretical-utilization">
              {avgUtilization}%
            </Badge>
          </div>
          <div className="flex items-center gap-1.5" data-testid="capacity-weather-adjusted">
            <span className="text-xs text-muted-foreground">Väderjusterad:</span>
            <Badge className={`text-xs ${avgColor.bg} ${avgColor.text} border-0`} data-testid="badge-avg-utilization">
              {weatherActive ? adjustedAvgUtilization : avgUtilization}%
            </Badge>
          </div>
          {weatherActive && (
            <Badge variant="outline" className="text-xs gap-1 border-chart-4/50 text-chart-4" data-testid="badge-weather-impact">
              <CloudRain className="h-3 w-3" />
              Väder +{weatherPctIncrease}% tid
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="max-h-[320px] overflow-y-auto">
          <div className="space-y-3">
            {sorted.map((r) => {
              const color = getUtilizationColor(r.utilization);
              const cappedWidth = Math.min(r.utilization, 100);

              return (
                <div key={r.resourceId} data-testid={`capacity-resource-${r.resourceId}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate flex-1">{r.resourceName}</span>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className="text-xs text-muted-foreground">
                        {Math.round(r.bookedMinutes / 60 * 10) / 10}h / {Math.round(r.availableMinutes / 60 * 10) / 10}h
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-xs min-w-[52px] justify-center ${
                          r.utilization > 90
                            ? "border-destructive/50 text-destructive"
                            : r.utilization >= 60
                              ? "border-chart-4/50 text-chart-4"
                              : "border-chart-2/50 text-chart-2"
                        }`}
                        data-testid={`badge-utilization-${r.resourceId}`}
                      >
                        {r.utilization}%
                      </Badge>
                    </div>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${color.bar}`}
                      style={{ width: `${cappedWidth}%` }}
                      data-testid={`bar-utilization-${r.resourceId}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-chart-2/15" />
            <span className="text-xs text-muted-foreground">&lt;60%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-chart-4/15" />
            <span className="text-xs text-muted-foreground">60–90%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-destructive/15" />
            <span className="text-xs text-muted-foreground">&gt;90%</span>
          </div>
        </div>

        {!weather?.disabled && (weather?.impacts?.length ?? 0) > 0 && (
          <div className="mt-4 pt-3 border-t" data-testid="capacity-horizon">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">Kapacitet kommande dagar</span>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-3 rounded-sm border border-muted-foreground/40" />
                  Teoretisk
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-3 rounded-sm bg-chart-4/15" />
                  Väderjusterad
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              {(weather?.impacts ?? []).slice(0, 7).map((imp) => {
                const adj = Math.round(imp.capacityMultiplier * 100);
                const theo = 100;
                const dayLabel = (() => {
                  try { return format(new Date(imp.date), "EEE d/M", { locale: sv }); }
                  catch { return imp.date; }
                })();
                const adjColor = imp.impactLevel === "severe" || imp.impactLevel === "high"
                  ? "bg-destructive/15"
                  : imp.impactLevel === "medium"
                    ? "bg-chart-4/15"
                    : imp.impactLevel === "low"
                      ? "bg-chart-3/15"
                      : "bg-chart-2/15";
                return (
                  <div key={imp.date} className="flex items-center gap-2" data-testid={`horizon-day-${imp.date}`}>
                    <span className="text-[11px] w-14 text-muted-foreground capitalize">{dayLabel}</span>
                    <div className="flex-1 space-y-0.5">
                      <div className="h-1.5 rounded-sm bg-muted overflow-hidden" title={`Teoretisk ${theo}%`}>
                        <div className="h-full bg-muted-foreground/40" style={{ width: `${theo}%` }} />
                      </div>
                      <div className="h-1.5 rounded-sm bg-muted overflow-hidden" title={`Väderjusterad ${adj}% – ${imp.reason}`}>
                        <div className={`h-full ${adjColor}`} style={{ width: `${adj}%` }} data-testid={`horizon-bar-adjusted-${imp.date}`} />
                      </div>
                    </div>
                    <span className="text-[10px] tabular-nums text-muted-foreground w-20 text-right" data-testid={`horizon-values-${imp.date}`}>
                      {theo}% / {adj}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
