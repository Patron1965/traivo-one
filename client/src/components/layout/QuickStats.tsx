import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, ClipboardList, Target, DollarSign, TrendingUp, TrendingDown, AlertTriangle, CheckCircle } from "lucide-react";

interface DashboardStats {
  completedOrders: number;
  pendingOrders: number;
  impossibleOrders: number;
  scheduledOrders: number;
  totalOrderValue: number;
  totalOrders: number;
  activeCustomers: number;
  activeResources: number;
  activeClusters: number;
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  trend?: { value: string; up: boolean };
  isLoading?: boolean;
}

function StatCard({ title, value, icon: Icon, iconColor, iconBg, trend, isLoading }: StatCardProps) {
  if (isLoading) {
    return (
      <Card className="hover-elevate">
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-12 w-12 rounded-xl" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover-elevate" data-testid={`stat-card-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground font-medium">{title}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
            {trend && (
              <div
                className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md mt-2 ${
                  trend.up
                    ? "bg-green-500/10 text-green-600 dark:text-green-400"
                    : "bg-red-500/10 text-red-600 dark:text-red-400"
                }`}
              >
                {trend.up ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                <span>{trend.value}</span>
              </div>
            )}
          </div>
          <div
            className={`h-12 w-12 rounded-xl flex items-center justify-center ${iconBg}`}
          >
            <Icon className={`h-6 w-6 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function QuickStats() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const completedOrders = stats?.completedOrders ?? 0;
  const pendingOrders = stats?.pendingOrders ?? 0;
  const impossibleOrders = stats?.impossibleOrders ?? 0;
  const scheduledOrders = stats?.scheduledOrders ?? 0;
  const totalOrderValue = stats?.totalOrderValue ?? 0;
  const totalOrders = stats?.totalOrders ?? 0;
  const activeCustomers = stats?.activeCustomers ?? 0;
  const activeResources = stats?.activeResources ?? 0;
  const activeClusters = stats?.activeClusters ?? 0;

  const formattedValue = totalOrderValue >= 1000000
    ? `${(totalOrderValue / 1000000).toFixed(1)}M kr`
    : totalOrderValue >= 1000
    ? `${(totalOrderValue / 1000).toFixed(0)}K kr`
    : `${totalOrderValue} kr`;

  const hasData = !!stats;
  const completionRate = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;
  const impossibleRate = totalOrders > 0 ? Math.round((impossibleOrders / totalOrders) * 100) : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      <StatCard
        title="Utförda ordrar"
        value={completedOrders}
        icon={CheckCircle}
        iconColor="text-green-600 dark:text-green-400"
        iconBg="bg-green-500/10"
        trend={hasData ? { value: `${completionRate}% av alla`, up: true } : undefined}
        isLoading={isLoading}
      />
      <StatCard
        title="Pågående ordrar"
        value={pendingOrders}
        icon={ClipboardList}
        iconColor="text-blue-600 dark:text-blue-400"
        iconBg="bg-blue-500/10"
        trend={hasData && scheduledOrders > 0 ? { value: `${scheduledOrders} schemalagda`, up: true } : undefined}
        isLoading={isLoading}
      />
      <StatCard
        title="Omöjliga ordrar"
        value={impossibleOrders}
        icon={AlertTriangle}
        iconColor="text-orange-600 dark:text-orange-400"
        iconBg="bg-orange-500/10"
        trend={hasData && impossibleOrders > 0 ? { value: `${impossibleRate}% av alla`, up: false } : undefined}
        isLoading={isLoading}
      />
      <StatCard
        title="Aktiva resurser"
        value={activeResources}
        icon={Users}
        iconColor="text-cyan-600 dark:text-cyan-400"
        iconBg="bg-cyan-500/10"
        trend={hasData ? { value: `${activeClusters} kluster`, up: true } : undefined}
        isLoading={isLoading}
      />
      <StatCard
        title="Aktiva kunder"
        value={activeCustomers}
        icon={Target}
        iconColor="text-amber-600 dark:text-amber-400"
        iconBg="bg-amber-500/10"
        isLoading={isLoading}
      />
      <StatCard
        title="Ordervärde"
        value={formattedValue}
        icon={DollarSign}
        iconColor="text-purple-600 dark:text-purple-400"
        iconBg="bg-purple-500/10"
        trend={hasData && totalOrderValue > 0 ? { value: `${totalOrders} ordrar`, up: true } : undefined}
        isLoading={isLoading}
      />
    </div>
  );
}
