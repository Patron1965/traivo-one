import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, ClipboardList, Target, DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import type { Customer, WorkOrder, Resource, Cluster } from "@shared/schema";

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
  const { data: customers, isLoading: loadingCustomers } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: workOrders, isLoading: loadingOrders } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const { data: resources, isLoading: loadingResources } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const { data: clusters, isLoading: loadingClusters } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const isLoading = loadingCustomers || loadingOrders || loadingResources || loadingClusters;

  const activeCustomers = customers?.length ?? 0;
  const pendingOrders = workOrders?.filter((o) => o.status !== "completed" && o.status !== "cancelled")?.length ?? 0;
  const scheduledOrders = workOrders?.filter((o) => o.scheduledDate)?.length ?? 0;
  const activeResources = resources?.filter((r) => r.status === "active")?.length ?? 0;
  const activeClusters = clusters?.filter((c) => c.status === "active")?.length ?? 0;

  const totalOrderValue = workOrders?.reduce((sum, o) => sum + (o.cachedValue || 0), 0) ?? 0;
  const formattedValue = totalOrderValue >= 1000000
    ? `${(totalOrderValue / 1000000).toFixed(1)}M kr`
    : totalOrderValue >= 1000
    ? `${(totalOrderValue / 1000).toFixed(0)}K kr`
    : `${totalOrderValue} kr`;

  const hasCustomerData = customers && customers.length > 0;
  const hasOrderData = workOrders && workOrders.length > 0;
  const hasResourceData = resources && resources.length > 0;
  const hasClusterData = clusters && clusters.length > 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Aktiva kunder"
        value={activeCustomers}
        icon={Users}
        iconColor="text-blue-600 dark:text-blue-400"
        iconBg="bg-blue-500/10"
        trend={hasCustomerData ? { value: `${activeCustomers} totalt`, up: true } : undefined}
        isLoading={isLoading}
      />
      <StatCard
        title="Pågående ordrar"
        value={pendingOrders}
        icon={ClipboardList}
        iconColor="text-green-600 dark:text-green-400"
        iconBg="bg-green-500/10"
        trend={hasOrderData && scheduledOrders > 0 ? { value: `${scheduledOrders} schemalagda`, up: true } : undefined}
        isLoading={isLoading}
      />
      <StatCard
        title="Aktiva kluster"
        value={activeClusters}
        icon={Target}
        iconColor="text-amber-600 dark:text-amber-400"
        iconBg="bg-amber-500/10"
        trend={hasResourceData && activeResources > 0 ? { value: `${activeResources} resurser`, up: true } : undefined}
        isLoading={isLoading}
      />
      <StatCard
        title="Ordervärde"
        value={formattedValue}
        icon={DollarSign}
        iconColor="text-purple-600 dark:text-purple-400"
        iconBg="bg-purple-500/10"
        trend={hasOrderData && totalOrderValue > 0 ? { value: `${workOrders.length} ordrar`, up: true } : undefined}
        isLoading={isLoading}
      />
    </div>
  );
}
