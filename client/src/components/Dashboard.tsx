import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Clock, TrendingUp, TrendingDown, Users, Briefcase, AlertCircle, Lightbulb, ArrowUpRight, ArrowDownRight } from "lucide-react";

// todo: remove mock functionality
const mockStats = {
  totalJobs: 24,
  completedJobs: 18,
  plannedHours: 42,
  actualHours: 38,
  totalSetupTime: 156,
  avgSetupTime: 13,
  setupTimeChange: -12,
};

// todo: remove mock functionality
const mockResourceUtilization = [
  { name: "Bengt B.", planned: 40, actual: 36, utilization: 90 },
  { name: "Carina C.", planned: 40, actual: 42, utilization: 105 },
];

// todo: remove mock functionality
const mockSetupTimeBreakdown = [
  { reason: "Grindåtkomst", minutes: 48, percentage: 31 },
  { reason: "Parkering", minutes: 42, percentage: 27 },
  { reason: "Väntan på kund", minutes: 35, percentage: 22 },
  { reason: "Nyckelhämtning", minutes: 18, percentage: 12 },
  { reason: "Övrigt", minutes: 13, percentage: 8 },
];

// todo: remove mock functionality
const mockInsights = [
  { type: "suggestion", message: "Samla nordliga jobb på måndag och tisdag för att spara ~2.5 timmar körtid per vecka." },
  { type: "warning", message: "Objekt OBJ-003 har 3x högre ställtid än genomsnittet. Uppdatera åtkomstinformation?" },
  { type: "success", message: "Ställtiden minskade med 12% jämfört med förra veckan!" },
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

export function Dashboard() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Vecka 50 - December 2024</p>
        </div>
        <Button variant="outline" data-testid="button-export">
          Exportera rapport
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard 
          title="Jobb slutförda" 
          value={`${mockStats.completedJobs}/${mockStats.totalJobs}`}
          subtitle={`${Math.round((mockStats.completedJobs / mockStats.totalJobs) * 100)}% klart`}
          icon={Briefcase}
        />
        <StatCard 
          title="Arbetade timmar" 
          value={`${mockStats.actualHours}h`}
          subtitle={`av ${mockStats.plannedHours}h planerat`}
          icon={Clock}
          trend={mockStats.actualHours < mockStats.plannedHours ? "positive" : "negative"}
        />
        <StatCard 
          title="Total ställtid" 
          value={`${mockStats.totalSetupTime} min`}
          subtitle={`Snitt ${mockStats.avgSetupTime} min/jobb`}
          icon={Clock}
        />
        <StatCard 
          title="Ställtidsförändring" 
          value={`${mockStats.setupTimeChange}%`}
          subtitle="vs förra veckan"
          icon={mockStats.setupTimeChange < 0 ? TrendingDown : TrendingUp}
          trend={mockStats.setupTimeChange < 0 ? "positive" : "negative"}
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
            {mockResourceUtilization.map((resource) => (
              <div key={resource.name} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{resource.name}</span>
                  <span className="text-muted-foreground">
                    {resource.actual}h / {resource.planned}h
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
            ))}
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
              {mockSetupTimeBreakdown.map((item) => (
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
            {mockInsights.map((insight, index) => {
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
