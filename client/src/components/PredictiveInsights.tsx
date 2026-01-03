import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, AlertTriangle, TrendingUp, Calendar } from "lucide-react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { sv } from "date-fns/locale";

interface PredictionItem {
  objectId: string;
  objectName: string;
  predictedDate: string;
  daysUntil: number;
  confidence: number;
  avgInterval: number;
}

interface PredictiveData {
  overdue: PredictionItem[];
  upcoming: PredictionItem[];
  totalPredicted: number;
  summary: string;
}

export function PredictiveInsights() {
  const { data, isLoading, error } = useQuery<PredictiveData>({
    queryKey: ["/api/ai/predictive-maintenance"],
    staleTime: 300000,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-predictive-insights-loading">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return null;
  }

  const hasData = data.overdue.length > 0 || data.upcoming.length > 0;

  if (!hasData) {
    return null;
  }

  return (
    <Card data-testid="card-predictive-insights">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Prediktiva insikter
          </CardTitle>
          <CardDescription className="mt-1">
            {data.summary}
          </CardDescription>
        </div>
        <Badge variant="outline" className="shrink-0">
          AI-analys
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.overdue.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-destructive mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Passerat förväntat servicedatum
            </h4>
            <div className="space-y-2">
              {data.overdue.map((item) => (
                <div
                  key={item.objectId}
                  className="flex items-center justify-between p-3 rounded-md bg-destructive/10 border border-destructive/20"
                  data-testid={`prediction-overdue-${item.objectId}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.objectName}</p>
                    <p className="text-xs text-muted-foreground">
                      Förväntades {format(parseISO(item.predictedDate), "d MMM", { locale: sv })} ({Math.abs(item.daysUntil)} dagar sedan)
                    </p>
                  </div>
                  <Badge variant="destructive">
                    {item.confidence}% säker
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.upcoming.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Kommande servicebehov
            </h4>
            <div className="space-y-2">
              {data.upcoming.slice(0, 5).map((item) => (
                <div
                  key={item.objectId}
                  className="flex items-center justify-between p-3 rounded-md bg-muted/50"
                  data-testid={`prediction-upcoming-${item.objectId}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.objectName}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {item.daysUntil === 0 
                        ? "Idag" 
                        : item.daysUntil === 1 
                        ? "Imorgon" 
                        : `Om ${item.daysUntil} dagar`} 
                      ({format(parseISO(item.predictedDate), "d MMM", { locale: sv })})
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {item.confidence}%
                  </Badge>
                </div>
              ))}
            </div>
            {data.upcoming.length > 5 && (
              <p className="text-xs text-muted-foreground mt-2">
                + {data.upcoming.length - 5} till
              </p>
            )}
          </div>
        )}

        <div className="pt-2 border-t">
          <Link href="/planner">
            <Button variant="outline" size="sm" className="w-full" data-testid="button-view-predictions">
              Se veckoplanering
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
