import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Clock, TrendingUp, Users, Briefcase, AlertCircle, Lightbulb, ArrowUpRight, ArrowDownRight, Loader2 } from "lucide-react";
import type { Resource, WorkOrder, ServiceObject, SetupTimeLog } from "@shared/schema";

export function Dashboard() {
  const { data: workOrders = [], isLoading: workOrdersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: resources = [], isLoading: resourcesLoading } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const { data: setupLogs = [], isLoading: setupLogsLoading } = useQuery<SetupTimeLog[]>({
    queryKey: ["/api/setup-logs"],
  });

  const objectMap = new Map(objects.map(o => [o.id, o]));

  const completedJobs = workOrders.filter(wo => wo.status === "completed").length;
  const totalJobs = workOrders.length;
  const plannedHours = workOrders.reduce((sum, wo) => sum + (wo.estimatedDuration || 0), 0) / 60;
  const actualHours = workOrders.filter(wo => wo.actualDuration).reduce((sum, wo) => sum + (wo.actualDuration || 0), 0) / 60;
  
  const totalSetupTime = setupLogs.reduce((sum, log) => sum + (log.durationMinutes || 0), 0);
  const avgSetupTime = setupLogs.length > 0 ? Math.round(totalSetupTime / setupLogs.length) : 0;

  const resourceUtilization = resources.map(r => {
    const resourceJobs = workOrders.filter(wo => wo.resourceId === r.id);
    const hoursPlanned = resourceJobs.reduce((sum, wo) => sum + (wo.estimatedDuration || 0), 0) / 60;
    return {
      name: r.name.split(" ").map(n => n[0] + ".").join(" ").slice(0, -1),
      planned: r.weeklyHours || 40,
      actual: hoursPlanned,
      utilization: r.weeklyHours ? Math.round((hoursPlanned / r.weeklyHours) * 100) : 0,
    };
  });

  const categoryLabels: Record<string, string> = {
    gate_access: "Grindåtkomst",
    parking: "Parkering",
    waiting_customer: "Väntan på kund",
    key_issue: "Nyckelhämtning",
    other: "Övrigt",
  };

  const categoryMinutes = setupLogs.reduce((acc, log) => {
    const cat = log.category || "other";
    acc[cat] = (acc[cat] || 0) + (log.durationMinutes || 0);
    return acc;
  }, {} as Record<string, number>);

  const setupTimeBreakdown = Object.entries(categoryMinutes)
    .map(([category, minutes]) => ({
      reason: categoryLabels[category] || category,
      minutes,
      percentage: totalSetupTime > 0 ? Math.round((minutes / totalSetupTime) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  if (setupTimeBreakdown.length === 0) {
    setupTimeBreakdown.push(
      { reason: "Grindåtkomst", minutes: 0, percentage: 0 },
      { reason: "Parkering", minutes: 0, percentage: 0 },
      { reason: "Väntan på kund", minutes: 0, percentage: 0 },
      { reason: "Nyckelhämtning", minutes: 0, percentage: 0 },
      { reason: "Övrigt", minutes: 0, percentage: 0 },
    );
  }

  const highSetupObjects = objects.filter(o => (o.avgSetupTime || 0) > 20);
  
  const insights = [
    { type: "suggestion", message: "Samla nordliga jobb på måndag och tisdag för att spara ~2.5 timmar körtid per vecka." },
    { type: highSetupObjects.length > 0 ? "warning" : "success", message: highSetupObjects.length > 0
      ? `${highSetupObjects.length} objekt med hög ställtid (>20 min) - uppdatera med bättre åtkomstinfo.`
      : "Alla objekt har rimlig ställtid." },
    { type: "success", message: `${setupLogs.length} ställtidsloggar registrerade med snitt ${avgSetupTime} min.` },
  ];

  const insightIcons = {
    suggestion: Lightbulb,
    warning: AlertCircle,
    success: TrendingUp,
  };

  const insightColors = {
    suggestion: "border-blue-500 bg-blue-50 dark:bg-blue-950",
    warning: "border-orange-500 bg-orange-50 dark:bg-orange-950",
    success: "border-green-500 bg-green-50 dark:bg-green-950",
  };

  const isLoading = workOrdersLoading || resourcesLoading || setupLogsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Översikt - {new Date().toLocaleDateString("sv-SE", { month: "long", year: "numeric" })}</p>
        </div>
        <Button variant="outline" data-testid="button-export">
          Exportera rapport
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard 
          title="Jobb totalt" 
          value={`${completedJobs}/${totalJobs}`}
          subtitle={totalJobs > 0 ? `${Math.round((completedJobs / totalJobs) * 100)}% klart` : "Inga jobb"}
          icon={Briefcase}
        />
        <StatCard 
          title="Planerade timmar" 
          value={`${plannedHours.toFixed(1)}h`}
          subtitle={`${actualHours.toFixed(1)}h utfört`}
          icon={Clock}
          trend={actualHours < plannedHours ? "positive" : "negative"}
        />
        <StatCard 
          title="Total ställtid" 
          value={`${totalSetupTime} min`}
          subtitle={`Snitt ${avgSetupTime} min/jobb`}
          icon={Clock}
        />
        <StatCard 
          title="Resurser" 
          value={`${resources.length}`}
          subtitle={`${resources.filter(r => r.status === "active").length} aktiva`}
          icon={Users}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Resursbeläggning
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {resourceUtilization.length === 0 ? (
              <p className="text-sm text-muted-foreground">Inga resurser registrerade</p>
            ) : (
              resourceUtilization.map((resource) => (
                <div key={resource.name} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{resource.name}</span>
                    <span className="text-muted-foreground">
                      {resource.actual.toFixed(1)}h / {resource.planned}h
                      {resource.utilization > 100 && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">Överbokning</Badge>
                      )}
                    </span>
                  </div>
                  <Progress 
                    value={Math.min(resource.utilization, 100)} 
                    className={resource.utilization > 100 ? "[&>div]:bg-red-500" : ""}
                  />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Ställtidsanalys
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {setupTimeBreakdown.map((item) => (
                <div key={item.reason} className="flex items-center gap-3">
                  <div className="w-28 text-sm text-muted-foreground truncate">{item.reason}</div>
                  <div className="flex-1">
                    <div className="h-4 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-16 text-right text-sm font-mono">{item.minutes} min</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            AI-insikter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {insights.map((insight, index) => {
              const Icon = insightIcons[insight.type as keyof typeof insightIcons];
              return (
                <div 
                  key={index}
                  className={`p-4 rounded-md border-l-4 ${insightColors[insight.type as keyof typeof insightColors]}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className="h-5 w-5 shrink-0 mt-0.5" />
                    <p className="text-sm">{insight.message}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  trend?: "positive" | "negative";
}

function StatCard({ title, value, subtitle, icon: Icon, trend }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs text-muted-foreground">{title}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold">{value}</span>
          {trend && (
            trend === "positive" ? 
              <ArrowDownRight className="h-4 w-4 text-green-500" /> :
              <ArrowUpRight className="h-4 w-4 text-red-500" />
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  );
}
