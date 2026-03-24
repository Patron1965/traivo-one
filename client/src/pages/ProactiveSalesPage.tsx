import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Search, TrendingDown, Users, DollarSign, AlertTriangle, Phone, Mail } from "lucide-react";
import type { Customer, WorkOrder } from "@shared/schema";

interface InactiveCustomer {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  lastOrderDate: string | null;
  daysSinceLastOrder: number;
  totalRevenue: number;
  orderCount: number;
}

export default function ProactiveSalesPage() {
  const [search, setSearch] = useState("");
  const [monthsThreshold, setMonthsThreshold] = useState("12");
  const [sortBy, setSortBy] = useState<"days" | "revenue">("days");

  const { data: customers = [], isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: workOrders = [], isLoading: ordersLoading } = useQuery<WorkOrder[]>({
    queryKey: ["/api/work-orders"],
  });

  const inactiveCustomers = useMemo(() => {
    const now = new Date();
    const thresholdMs = parseInt(monthsThreshold) * 30 * 24 * 60 * 60 * 1000;

    const customerOrderData = new Map<string, { lastDate: Date | null; total: number; count: number }>();

    for (const wo of workOrders) {
      if (!wo.customerId) continue;
      const existing = customerOrderData.get(wo.customerId) || { lastDate: null, total: 0, count: 0 };
      
      if (wo.scheduledDate) {
        const d = new Date(wo.scheduledDate);
        if (!existing.lastDate || d > existing.lastDate) existing.lastDate = d;
      }
      existing.total += (wo.cachedValue || 0);
      existing.count++;
      customerOrderData.set(wo.customerId, existing);
    }

    const results: InactiveCustomer[] = [];

    for (const cust of customers) {
      const data = customerOrderData.get(cust.id);
      const lastDate = data?.lastDate || null;
      const daysSince = lastDate ? Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)) : 9999;
      
      if (daysSince * 24 * 60 * 60 * 1000 < thresholdMs && data) continue;

      if (search) {
        const q = search.toLowerCase();
        if (!cust.name.toLowerCase().includes(q) && !(cust.email || "").toLowerCase().includes(q)) continue;
      }

      results.push({
        id: cust.id,
        name: cust.name,
        email: cust.email,
        phone: cust.phone,
        address: cust.address,
        lastOrderDate: lastDate ? lastDate.toISOString().split("T")[0] : null,
        daysSinceLastOrder: daysSince,
        totalRevenue: data?.total || 0,
        orderCount: data?.count || 0,
      });
    }

    results.sort((a, b) => sortBy === "days" 
      ? b.daysSinceLastOrder - a.daysSinceLastOrder
      : b.totalRevenue - a.totalRevenue
    );

    return results;
  }, [customers, workOrders, monthsThreshold, search, sortBy]);

  const totalLostRevenue = useMemo(() => 
    inactiveCustomers.reduce((sum, c) => sum + c.totalRevenue, 0), 
    [inactiveCustomers]
  );

  const isLoading = customersLoading || ordersLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="heading-proactive-sales">Proaktiv försäljning</h1>
        <p className="text-muted-foreground">Identifiera inaktiva kunder och potentiella försäljningsmöjligheter</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="stat-inactive-count">{inactiveCustomers.length}</p>
                <p className="text-xs text-muted-foreground">Inaktiva kunder</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{customers.length}</p>
                <p className="text-xs text-muted-foreground">Totalt antal kunder</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <TrendingDown className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="stat-lost-revenue">
                  {(totalLostRevenue / 100).toLocaleString("sv-SE")} kr
                </p>
                <p className="text-xs text-muted-foreground">Historisk intäkt (inaktiva)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {((workOrders.reduce((s, wo) => s + (wo.cachedValue || 0), 0)) / 100).toLocaleString("sv-SE")} kr
                </p>
                <p className="text-xs text-muted-foreground">Total intäkt (alla)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Inaktiva kunder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Sök kund..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-inactive"
              />
            </div>
            <Select value={monthsThreshold} onValueChange={setMonthsThreshold}>
              <SelectTrigger className="w-[200px]" data-testid="select-months-threshold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Inaktiv &gt; 3 månader</SelectItem>
                <SelectItem value="6">Inaktiv &gt; 6 månader</SelectItem>
                <SelectItem value="12">Inaktiv &gt; 12 månader</SelectItem>
                <SelectItem value="24">Inaktiv &gt; 24 månader</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as "days" | "revenue")}>
              <SelectTrigger className="w-[180px]" data-testid="select-sort-by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="days">Längst sedan aktivitet</SelectItem>
                <SelectItem value="revenue">Högst intäkt</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {inactiveCustomers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Inga inaktiva kunder hittades med nuvarande filter</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kund</TableHead>
                    <TableHead>Kontakt</TableHead>
                    <TableHead className="text-right">Senaste order</TableHead>
                    <TableHead className="text-right">Dagar sedan</TableHead>
                    <TableHead className="text-right">Ordrar</TableHead>
                    <TableHead className="text-right">Historisk intäkt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inactiveCustomers.slice(0, 100).map((cust) => (
                    <TableRow key={cust.id} data-testid={`row-inactive-customer-${cust.id}`}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{cust.name}</p>
                          {cust.address && <p className="text-xs text-muted-foreground">{cust.address}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {cust.phone && (
                            <a href={`tel:${cust.phone}`} className="text-blue-600 hover:underline text-sm flex items-center gap-1" data-testid={`link-phone-${cust.id}`}>
                              <Phone className="h-3 w-3" />{cust.phone}
                            </a>
                          )}
                          {cust.email && (
                            <a href={`mailto:${cust.email}`} className="text-blue-600 hover:underline text-sm flex items-center gap-1" data-testid={`link-email-${cust.id}`}>
                              <Mail className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {cust.lastOrderDate || "Aldrig"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={cust.daysSinceLastOrder > 365 ? "destructive" : cust.daysSinceLastOrder > 180 ? "default" : "secondary"}>
                          {cust.daysSinceLastOrder >= 9999 ? "—" : `${cust.daysSinceLastOrder}d`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">{cust.orderCount}</TableCell>
                      <TableCell className="text-right font-medium text-sm">
                        {(cust.totalRevenue / 100).toLocaleString("sv-SE")} kr
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
