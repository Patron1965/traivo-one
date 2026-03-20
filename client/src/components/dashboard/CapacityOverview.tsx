import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BarChart3, User, RefreshCw } from "lucide-react";
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

function getUtilizationColor(utilization: number) {
  if (utilization > 90) return { bar: "bg-red-500", text: "text-red-600 dark:text-red-400", bg: "bg-red-500/10" };
  if (utilization >= 60) return { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10" };
  return { bar: "bg-green-500", text: "text-green-600 dark:text-green-400", bg: "bg-green-500/10" };
}

export function CapacityOverview() {
  const today = new Date();
  const dateStr = format(today, "yyyy-MM-dd");

  const { data, isLoading, isError } = useQuery<CapacityData>({
    queryKey: ["/api/dashboard/capacity", dateStr],
    staleTime: 60000,
  });

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
  const avgColor = getUtilizationColor(avgUtilization);

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
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">Snittbeläggning:</span>
          <Badge className={`text-xs ${avgColor.bg} ${avgColor.text} border-0`} data-testid="badge-avg-utilization">
            {avgUtilization}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="max-h-[320px]">
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
                            ? "border-red-500/50 text-red-600"
                            : r.utilization >= 60
                              ? "border-amber-500/50 text-amber-600"
                              : "border-green-500/50 text-green-600"
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
        </ScrollArea>

        <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
            <span className="text-xs text-muted-foreground">&lt;60%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            <span className="text-xs text-muted-foreground">60–90%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
            <span className="text-xs text-muted-foreground">&gt;90%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
