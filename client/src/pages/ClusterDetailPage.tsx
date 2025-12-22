import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Package,
  FileText,
  CheckCircle2,
  Receipt,
  Clock,
  MapPin,
  Users,
  RefreshCw,
  Loader2,
  Building2,
  DollarSign,
  Target,
} from "lucide-react";
import { QueryErrorState } from "@/components/ErrorBoundary";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import type { Cluster, ServiceObject, WorkOrder, Subscription } from "@shared/schema";

interface ClusterWithStats extends Cluster {
  objectCount: number;
  activeOrders: number;
  monthlyValue: number;
  avgSetupTime: number;
}

const SLA_LEVELS: Record<string, { label: string; color: string }> = {
  standard: { label: "Standard", color: "bg-muted text-muted-foreground" },
  premium: { label: "Premium", color: "bg-blue-500/20 text-blue-700 dark:text-blue-300" },
  enterprise: { label: "Enterprise", color: "bg-purple-500/20 text-purple-700 dark:text-purple-300" },
};

const ORDER_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  skapad: { label: "Skapad", color: "bg-gray-500/20 text-gray-700 dark:text-gray-300" },
  planerad_pre: { label: "Förplanerad", color: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300" },
  planerad_resurs: { label: "Resurs tilldelad", color: "bg-blue-500/20 text-blue-700 dark:text-blue-300" },
  planerad_las: { label: "Låst", color: "bg-purple-500/20 text-purple-700 dark:text-purple-300" },
  utford: { label: "Utförd", color: "bg-green-500/20 text-green-700 dark:text-green-300" },
  fakturerad: { label: "Fakturerad", color: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" },
};

export default function ClusterDetailPage() {
  const [, navigate] = useLocation();
  const [match, params] = useRoute("/clusters/:id");
  const clusterId = params?.id;

  const { data: cluster, isLoading: clusterLoading, error: clusterError } = useQuery<ClusterWithStats>({
    queryKey: ["/api/clusters", clusterId],
    enabled: !!clusterId,
  });

  const { data: clusterObjects = [], isLoading: objectsLoading } = useQuery<ServiceObject[]>({
    queryKey: ["/api/clusters", clusterId, "objects"],
    enabled: !!clusterId,
  });

  const { data: workOrders = [], isLoading: ordersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/clusters", clusterId, "work-orders"],
    enabled: !!clusterId,
  });

  const { data: subscriptions = [], isLoading: subsLoading } = useQuery<Subscription[]>({
    queryKey: ["/api/clusters", clusterId, "subscriptions"],
    enabled: !!clusterId,
  });

  if (!match || !clusterId) {
    return (
      <div className="p-6">
        <QueryErrorState message="Kluster hittades inte" />
      </div>
    );
  }

  if (clusterError) {
    return (
      <div className="p-6">
        <QueryErrorState message="Kunde inte ladda kluster" />
      </div>
    );
  }

  if (clusterLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!cluster) {
    return (
      <div className="p-6">
        <QueryErrorState message="Kluster hittades inte" />
      </div>
    );
  }

  const sla = SLA_LEVELS[cluster.slaLevel || "standard"] || SLA_LEVELS.standard;

  const completedOrders = workOrders.filter((o) => o.orderStatus === "utford");
  const invoicedOrders = workOrders.filter((o) => o.orderStatus === "fakturerad");
  const activeOrders = workOrders.filter(
    (o) =>
      o.orderStatus &&
      !["utford", "fakturerad"].includes(o.orderStatus)
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/clusters")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">{cluster.name}</h1>
            <Badge className={sla.color} variant="secondary">
              {sla.label}
            </Badge>
          </div>
          {cluster.description && (
            <p className="text-muted-foreground mt-1">{cluster.description}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-md bg-blue-500/10">
                <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Objekt</p>
                <p className="text-2xl font-semibold">{cluster.objectCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-md bg-yellow-500/10">
                <FileText className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Aktiva ordrar</p>
                <p className="text-2xl font-semibold">{cluster.activeOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-md bg-green-500/10">
                <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Månadsvärde</p>
                <p className="text-2xl font-semibold">
                  {cluster.monthlyValue.toLocaleString("sv-SE")} kr
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-md bg-purple-500/10">
                <Clock className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Snitt ställtid</p>
                <p className="text-2xl font-semibold">{cluster.avgSetupTime} min</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Snöret - Flödet genom klustret
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4 overflow-x-auto pb-2">
            <div className="flex flex-col items-center min-w-[120px]">
              <div className="p-4 rounded-full bg-blue-500/10 mb-2">
                <Building2 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <p className="font-medium">{clusterObjects.length}</p>
              <p className="text-sm text-muted-foreground">Objekt</p>
            </div>

            <div className="h-px flex-1 bg-border min-w-[40px]" />

            <div className="flex flex-col items-center min-w-[120px]">
              <div className="p-4 rounded-full bg-orange-500/10 mb-2">
                <RefreshCw className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
              <p className="font-medium">{subscriptions.length}</p>
              <p className="text-sm text-muted-foreground">Abonnemang</p>
            </div>

            <div className="h-px flex-1 bg-border min-w-[40px]" />

            <div className="flex flex-col items-center min-w-[120px]">
              <div className="p-4 rounded-full bg-yellow-500/10 mb-2">
                <FileText className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
              </div>
              <p className="font-medium">{activeOrders.length}</p>
              <p className="text-sm text-muted-foreground">Aktiva ordrar</p>
            </div>

            <div className="h-px flex-1 bg-border min-w-[40px]" />

            <div className="flex flex-col items-center min-w-[120px]">
              <div className="p-4 rounded-full bg-green-500/10 mb-2">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="font-medium">{completedOrders.length}</p>
              <p className="text-sm text-muted-foreground">Utförda</p>
            </div>

            <div className="h-px flex-1 bg-border min-w-[40px]" />

            <div className="flex flex-col items-center min-w-[120px]">
              <div className="p-4 rounded-full bg-emerald-500/10 mb-2">
                <Receipt className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="font-medium">{invoicedOrders.length}</p>
              <p className="text-sm text-muted-foreground">Fakturerade</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="objects" className="space-y-4">
        <TabsList>
          <TabsTrigger value="objects" data-testid="tab-objects">
            Objekt ({clusterObjects.length})
          </TabsTrigger>
          <TabsTrigger value="subscriptions" data-testid="tab-subscriptions">
            Abonnemang ({subscriptions.length})
          </TabsTrigger>
          <TabsTrigger value="orders" data-testid="tab-orders">
            Ordrar ({workOrders.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="objects">
          <Card>
            <CardContent className="p-0">
              {objectsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : clusterObjects.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  Inga objekt i detta kluster
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Namn</TableHead>
                      <TableHead>Typ</TableHead>
                      <TableHead>Adress</TableHead>
                      <TableHead>Tillgång</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clusterObjects.slice(0, 20).map((obj) => (
                      <TableRow key={obj.id} data-testid={`row-object-${obj.id}`}>
                        <TableCell className="font-medium">{obj.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{obj.objectType}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {obj.address || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{obj.accessType || "open"}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {clusterObjects.length > 20 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          ... och {clusterObjects.length - 20} till
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subscriptions">
          <Card>
            <CardContent className="p-0">
              {subsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : subscriptions.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  Inga abonnemang i detta kluster
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Namn</TableHead>
                      <TableHead>Periodicitet</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Månadsvärde</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscriptions.map((sub) => (
                      <TableRow key={sub.id} data-testid={`row-subscription-${sub.id}`}>
                        <TableCell className="font-medium">{sub.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{sub.periodicity}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={sub.status === "active" ? "default" : "secondary"}
                          >
                            {sub.status === "active" ? "Aktiv" : sub.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {(sub.cachedMonthlyValue || 0).toLocaleString("sv-SE")} kr
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card>
            <CardContent className="p-0">
              {ordersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : workOrders.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  Inga ordrar i detta kluster
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Titel</TableHead>
                      <TableHead>Datum</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Värde</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workOrders.slice(0, 30).map((order) => {
                      const statusInfo =
                        ORDER_STATUS_LABELS[order.orderStatus || "skapad"] ||
                        ORDER_STATUS_LABELS.skapad;
                      return (
                        <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                          <TableCell className="font-medium">{order.title}</TableCell>
                          <TableCell>
                            {order.scheduledDate
                              ? format(new Date(order.scheduledDate), "d MMM yyyy", {
                                  locale: sv,
                                })
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <Badge className={statusInfo.color} variant="secondary">
                              {statusInfo.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {(order.cachedValue || 0).toLocaleString("sv-SE")} kr
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {workOrders.length > 30 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          ... och {workOrders.length - 30} till
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
