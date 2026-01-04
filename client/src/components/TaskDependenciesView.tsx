import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, ArrowRight, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskDependency, WorkOrder } from "@shared/schema";

interface TaskDependenciesViewProps {
  workOrderId: string;
  className?: string;
}

const DEPENDENCY_TYPE_LABELS: Record<string, string> = {
  sequential: "Sekventiell",
  structural: "Strukturartikel",
  automatic: "Automatisk",
};

const DEPENDENCY_TYPE_COLORS: Record<string, string> = {
  sequential: "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700",
  structural: "bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-700",
  automatic: "bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700",
};

interface DependencyWithOrder extends TaskDependency {
  dependsOnOrder?: WorkOrder;
}

export function TaskDependenciesView({ workOrderId, className }: TaskDependenciesViewProps) {
  const { data: dependencies = [], isLoading } = useQuery<DependencyWithOrder[]>({
    queryKey: ["/api/work-orders", workOrderId, "dependencies"],
    queryFn: async () => {
      const deps = await fetch(`/api/work-orders/${workOrderId}/dependencies`).then(r => r.json());
      const enriched = await Promise.all(
        deps.map(async (dep: TaskDependency) => {
          try {
            const order = await fetch(`/api/work-orders/${dep.dependsOnWorkOrderId}`).then(r => r.json());
            return { ...dep, dependsOnOrder: order };
          } catch {
            return dep;
          }
        })
      );
      return enriched;
    },
  });

  const { data: dependents = [] } = useQuery<DependencyWithOrder[]>({
    queryKey: ["/api/work-orders", workOrderId, "dependents"],
    queryFn: async () => {
      const deps = await fetch(`/api/work-orders/${workOrderId}/dependents`).then(r => r.json());
      const enriched = await Promise.all(
        deps.map(async (dep: TaskDependency) => {
          try {
            const order = await fetch(`/api/work-orders/${dep.workOrderId}`).then(r => r.json());
            return { ...dep, dependsOnOrder: order };
          } catch {
            return dep;
          }
        })
      );
      return enriched;
    },
  });

  const getOrderStatusIcon = (status?: string) => {
    switch (status) {
      case "completed":
      case "utford":
      case "fakturerad":
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case "on_way":
      case "on_site":
        return <Clock className="h-4 w-4 text-amber-600 animate-pulse" />;
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const isOrderComplete = (order?: WorkOrder) => {
    const status = order?.executionStatus || order?.status;
    return ["completed", "inspected", "invoiced", "utford", "fakturerad"].includes(status || "");
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Beroenden
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-8 bg-muted rounded" />
            <div className="h-8 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (dependencies.length === 0 && dependents.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Beroenden
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Inga beroenden registrerade
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          Beroenden
          <Badge variant="secondary" className="ml-1">
            {dependencies.length + dependents.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {dependencies.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Väntar på:
            </p>
            {dependencies.map((dep) => {
              const isComplete = isOrderComplete(dep.dependsOnOrder);
              return (
                <div
                  key={dep.id}
                  className={cn(
                    "flex items-center gap-2 p-2 rounded-md border",
                    isComplete
                      ? "bg-green-50/50 dark:bg-green-950/30 border-green-200 dark:border-green-800"
                      : "bg-muted/50 border-muted-foreground/20"
                  )}
                  data-testid={`dependency-item-${dep.id}`}
                >
                  {getOrderStatusIcon(dep.dependsOnOrder?.executionStatus || dep.dependsOnOrder?.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {dep.dependsOnOrder?.title || "Uppgift #" + dep.dependsOnWorkOrderId.slice(-6)}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("text-xs", DEPENDENCY_TYPE_COLORS[dep.dependencyType || "sequential"])}
                  >
                    {DEPENDENCY_TYPE_LABELS[dep.dependencyType || "sequential"]}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}

        {dependents.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Blockerar:
            </p>
            {dependents.map((dep) => (
              <div
                key={dep.id}
                className="flex items-center gap-2 p-2 rounded-md bg-muted/50 border border-muted-foreground/20"
                data-testid={`dependent-item-${dep.id}`}
              >
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {dep.dependsOnOrder?.title || "Uppgift #" + dep.workOrderId.slice(-6)}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn("text-xs", DEPENDENCY_TYPE_COLORS[dep.dependencyType || "sequential"])}
                >
                  {DEPENDENCY_TYPE_LABELS[dep.dependencyType || "sequential"]}
                </Badge>
              </div>
            ))}
          </div>
        )}

        {dependencies.length > 0 && (
          <div className="pt-2 border-t">
            <div className="flex items-center gap-2 text-xs">
              {dependencies.every(d => isOrderComplete(d.dependsOnOrder)) ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-green-700 dark:text-green-400">
                    Alla beroenden uppfyllda
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span className="text-muted-foreground">
                    {dependencies.filter(d => !isOrderComplete(d.dependsOnOrder)).length} beroenden kvar
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
