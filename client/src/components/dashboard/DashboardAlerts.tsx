import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Clock,
  UserX,
  Layers,
  ChevronRight,
  CalendarX,
  RefreshCw,
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { queryClient } from "@/lib/queryClient";

interface OverdueAlert {
  id: string;
  title: string;
  scheduledDate: string;
  resourceId: string | null;
}

interface IdleResource {
  id: string;
  name: string;
}

interface DoubleBooking {
  resourceId: string;
  resourceName: string;
  orderA: { id: string; title: string; startTime: string };
  orderB: { id: string; title: string; startTime: string };
}

interface AlertsData {
  overdue: OverdueAlert[];
  idleResources: IdleResource[];
  doubleBookings: DoubleBooking[];
  totalAlerts: number;
}

export function DashboardAlerts() {
  const { data, isLoading, isError } = useQuery<AlertsData>({
    queryKey: ["/api/dashboard/alerts"],
    staleTime: 60000,
  });

  if (isError) {
    return (
      <Card data-testid="card-alerts-error">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Kräver uppmärksamhet
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground text-sm space-y-2">
            <p>Kunde inte hämta alerts</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/dashboard/alerts"] })}
              data-testid="button-retry-alerts"
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
      <Card data-testid="card-alerts-loading">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  const overdue = data?.overdue || [];
  const idle = data?.idleResources || [];
  const doubles = data?.doubleBookings || [];
  const total = data?.totalAlerts || 0;

  if (total === 0) {
    return (
      <Card data-testid="card-alerts-empty">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            Kräver uppmärksamhet
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground text-sm">
            <CalendarX className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Inga problem att visa — allt ser bra ut!
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-orange-500/30" data-testid="card-dashboard-alerts">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            Kräver uppmärksamhet
            <Badge variant="destructive" className="ml-1" data-testid="badge-alerts-count">
              {total}
            </Badge>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="max-h-[320px]">
          <div className="space-y-4">
            {overdue.length > 0 && (
              <div data-testid="alerts-section-overdue">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium">Försenade ordrar</span>
                  <Badge variant="outline" className="text-xs border-red-500/50 text-red-600">
                    {overdue.length}
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  {overdue.slice(0, 5).map((alert) => {
                    const scheduledDate = alert.scheduledDate
                      ? format(new Date(alert.scheduledDate), "d MMM", { locale: sv })
                      : "";
                    return (
                      <Link
                        key={alert.id}
                        href="/planner"
                      >
                        <div
                          className="flex items-center justify-between p-2.5 rounded-md border bg-red-500/5 border-red-500/20 cursor-pointer hover:bg-red-500/10 transition-colors"
                          data-testid={`alert-overdue-${alert.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium truncate block">
                              {alert.title}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Försenad sedan {scheduledDate}
                            </span>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        </div>
                      </Link>
                    );
                  })}
                  {overdue.length > 5 && (
                    <Link href="/planner">
                      <Button variant="ghost" size="sm" className="w-full text-xs" data-testid="button-view-all-overdue">
                        +{overdue.length - 5} fler försenade
                        <ChevronRight className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            )}

            {idle.length > 0 && (
              <div data-testid="alerts-section-idle">
                <div className="flex items-center gap-2 mb-2">
                  <UserX className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium">Utan jobb idag</span>
                  <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-600">
                    {idle.length}
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  {idle.slice(0, 5).map((r) => (
                    <Link key={r.id} href="/planner">
                      <div
                        className="flex items-center justify-between p-2.5 rounded-md border bg-amber-500/5 border-amber-500/20 cursor-pointer hover:bg-amber-500/10 transition-colors"
                        data-testid={`alert-idle-${r.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium truncate block">
                            {r.name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Ingen tilldelad order idag
                          </span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      </div>
                    </Link>
                  ))}
                  {idle.length > 5 && (
                    <p className="text-xs text-center text-muted-foreground">
                      +{idle.length - 5} fler utan jobb
                    </p>
                  )}
                </div>
              </div>
            )}

            {doubles.length > 0 && (
              <div data-testid="alerts-section-double-bookings">
                <div className="flex items-center gap-2 mb-2">
                  <Layers className="h-4 w-4 text-purple-500" />
                  <span className="text-sm font-medium">Dubbelbokningar</span>
                  <Badge variant="outline" className="text-xs border-purple-500/50 text-purple-600">
                    {doubles.length}
                  </Badge>
                </div>
                <div className="space-y-1.5">
                  {doubles.slice(0, 5).map((db, i) => (
                    <Link key={i} href="/planner">
                      <div
                        className="flex items-center justify-between p-2.5 rounded-md border bg-purple-500/5 border-purple-500/20 cursor-pointer hover:bg-purple-500/10 transition-colors"
                        data-testid={`alert-double-${i}`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium truncate block">
                            {db.resourceName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {db.orderA.title} ({db.orderA.startTime}) &amp; {db.orderB.title} ({db.orderB.startTime})
                          </span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
