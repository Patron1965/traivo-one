import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, AlertCircle, Info, Lightbulb, X } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

interface ProactiveTip {
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  action?: string;
}

const severityConfig = {
  info: {
    icon: Info,
    bgClass: "bg-chart-1/10 dark:bg-chart-1/15",
    borderClass: "border-chart-1/20 dark:border-chart-1/80",
    iconClass: "text-chart-1",
  },
  warning: {
    icon: AlertTriangle,
    bgClass: "bg-chart-4/10 dark:bg-chart-4/15",
    borderClass: "border-chart-4/20 dark:border-chart-4/80",
    iconClass: "text-chart-4",
  },
  critical: {
    icon: AlertCircle,
    bgClass: "bg-destructive/10 dark:bg-destructive/15",
    borderClass: "border-destructive/20 dark:border-destructive/80",
    iconClass: "text-destructive",
  },
};

const actionRoutes: Record<string, string> = {
  "Se veckoplanering": "/veckoplan",
  "Granska planeringen": "/veckoplan",
  "Se omöjliga ordrar": "/orders",
  "Tilldela resurser": "/veckoplan",
};

export function ProactiveTips() {
  const [dismissed, setDismissed] = useState<string[]>([]);

  const { data, isLoading } = useQuery<{ tips: ProactiveTip[] }>({
    queryKey: ["/api/ai/proactive-tips"],
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const tips = data?.tips?.filter(tip => !dismissed.includes(tip.type)) || [];

  if (tips.length === 0) {
    return null;
  }

  return (
    <Card className="border-l-4 border-l-primary" data-testid="card-proactive-tips">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Kollen tipsar</span>
        </div>
        <div className="space-y-2">
          {tips.map((tip) => {
            const config = severityConfig[tip.severity];
            const Icon = config.icon;
            const route = tip.action ? actionRoutes[tip.action] : undefined;

            return (
              <div
                key={tip.type}
                className={`flex items-start gap-3 p-3 rounded-md border ${config.bgClass} ${config.borderClass}`}
                data-testid={`tip-${tip.type}`}
              >
                <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${config.iconClass}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{tip.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{tip.message}</p>
                  {tip.action && route && (
                    <Link href={route}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0 mt-1 text-xs underline"
                        data-testid={`button-tip-action-${tip.type}`}
                      >
                        {tip.action}
                      </Button>
                    </Link>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => setDismissed((prev) => [...prev, tip.type])}
                  data-testid={`button-dismiss-tip-${tip.type}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
