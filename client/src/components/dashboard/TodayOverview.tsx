import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  CheckCircle2, Clock, Truck, User, 
  MapPin, ArrowRight, Calendar
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

interface DailyKPIs {
  completedTasks: number;
  remainingTasks: number;
  totalTasks: number;
  completionRate: number;
  avgTimePerTask: number;
  resourceKpis: {
    resourceId: string;
    resourceName: string;
    completed: number;
    remaining: number;
    total: number;
    avgTime: number;
  }[];
}

export function TodayOverview() {
  const today = new Date();
  const dateStr = format(today, "yyyy-MM-dd");

  const { data: kpis, isLoading, error } = useQuery<DailyKPIs>({
    queryKey: [`/api/kpis/daily?date=${dateStr}`],
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-today-loading">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !kpis) return null;

  const completionPercent = kpis.totalTasks > 0 
    ? Math.round((kpis.completedTasks / kpis.totalTasks) * 100) 
    : 0;

  const activeResources = kpis.resourceKpis?.filter(r => r.total > 0) || [];

  return (
    <Card data-testid="card-today-overview">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5 text-primary" />
            Dagens aktivitet
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {format(today, "EEEE d MMMM", { locale: sv })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-green-500/10 p-3 text-center" data-testid="today-completed">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-green-700 dark:text-green-300">{kpis.completedTasks}</div>
            <div className="text-xs text-muted-foreground">Klara</div>
          </div>
          <div className="rounded-lg bg-blue-500/10 p-3 text-center" data-testid="today-remaining">
            <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{kpis.remainingTasks}</div>
            <div className="text-xs text-muted-foreground">Kvar</div>
          </div>
          <div className="rounded-lg bg-purple-500/10 p-3 text-center" data-testid="today-resources">
            <User className="h-5 w-5 text-purple-600 dark:text-purple-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-purple-700 dark:text-purple-300">{activeResources.length}</div>
            <div className="text-xs text-muted-foreground">Resurser ute</div>
          </div>
          <div className="rounded-lg bg-amber-500/10 p-3 text-center" data-testid="today-avg-time">
            <Truck className="h-5 w-5 text-amber-600 dark:text-amber-400 mx-auto mb-1" />
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">{kpis.avgTimePerTask}<span className="text-sm font-normal">min</span></div>
            <div className="text-xs text-muted-foreground">Snittid</div>
          </div>
        </div>

        {kpis.totalTasks > 0 && (
          <div>
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-muted-foreground">Dagsframsteg</span>
              <span className="font-medium">{completionPercent}%</span>
            </div>
            <Progress value={completionPercent} className="h-2.5" />
          </div>
        )}

        {activeResources.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Resurser idag</h4>
            <div className="space-y-2">
              {activeResources.slice(0, 5).map((r) => {
                const resPercent = r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0;
                return (
                  <div key={r.resourceId} className="flex items-center gap-3" data-testid={`today-resource-${r.resourceId}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">{r.resourceName}</span>
                        <span className="text-xs text-muted-foreground ml-2">{r.completed}/{r.total}</span>
                      </div>
                      <Progress value={resPercent} className="h-1.5 mt-1" />
                    </div>
                  </div>
                );
              })}
              {activeResources.length > 5 && (
                <p className="text-xs text-muted-foreground">+ {activeResources.length - 5} till</p>
              )}
            </div>
          </div>
        )}

        {kpis.totalTasks === 0 && (
          <div className="text-center py-4 text-muted-foreground">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Inga schemalagda uppdrag idag</p>
          </div>
        )}

        <Link href="/planner">
          <Button variant="outline" size="sm" className="w-full" data-testid="button-go-planner">
            <MapPin className="h-4 w-4 mr-2" />
            Visa veckoplanering
            <ArrowRight className="h-4 w-4 ml-auto" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
