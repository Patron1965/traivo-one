import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Search, TrendingDown, Users, DollarSign, AlertTriangle, Phone, Mail, UserCircle, ArrowUpDown, ArrowUp, ArrowDown, Target } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";

interface InactiveCustomer {
  id: string;
  name: string;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  lastOrderDate: string | null;
  daysSinceLastOrder: number;
  totalRevenue: number;
  orderCount: number;
}

interface ProactiveSalesResponse {
  customers: InactiveCustomer[];
  summary: {
    inactiveCount: number;
    totalCustomers: number;
    totalLostRevenue: number;
    totalRevenueAll: number;
  };
}

type SortField = "name" | "lastOrderDate" | "daysSinceLastOrder" | "orderCount" | "totalRevenue";
type SortDir = "asc" | "desc";

export default function ProactiveSalesPage() {
  const [search, setSearch] = useState("");
  const [monthsThreshold, setMonthsThreshold] = useState("12");
  const [sortField, setSortField] = useState<SortField>("totalRevenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const debouncedSearch = useDebounce(search, 300);

  const queryParams = new URLSearchParams({ months: monthsThreshold });
  if (debouncedSearch) queryParams.set("search", debouncedSearch);
  const queryUrl = `/api/proactive-sales/inactive?${queryParams}`;

  const { data, isLoading } = useQuery<ProactiveSalesResponse>({
    queryKey: [queryUrl],
  });

  const inactiveCustomers = data?.customers ?? [];
  const summary = data?.summary ?? { inactiveCount: 0, totalCustomers: 0, totalLostRevenue: 0, totalRevenueAll: 0 };

  const sortedCustomers = useMemo(() => {
    const sorted = [...inactiveCustomers];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name, "sv");
          break;
        case "lastOrderDate":
          cmp = (a.lastOrderDate ?? "").localeCompare(b.lastOrderDate ?? "");
          break;
        case "daysSinceLastOrder":
          cmp = a.daysSinceLastOrder - b.daysSinceLastOrder;
          break;
        case "orderCount":
          cmp = a.orderCount - b.orderCount;
          break;
        case "totalRevenue":
          cmp = a.totalRevenue - b.totalRevenue;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [inactiveCustomers, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "name" ? "asc" : "desc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="h-3.5 w-3.5 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3.5 w-3.5 ml-1 text-chart-1" />
      : <ArrowDown className="h-3.5 w-3.5 ml-1 text-chart-1" />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader icon={Target} title="Proaktiv försäljning" description="Identifiera inaktiva kunder och potentiella försäljningsmöjligheter" testId="heading-proactive-sales" />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-chart-4/15 dark:bg-chart-4/15">
                <AlertTriangle className="h-5 w-5 text-chart-4" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="stat-inactive-count">{summary.inactiveCount}</p>
                <p className="text-xs text-muted-foreground">Inaktiva kunder</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-chart-1/15 dark:bg-chart-1/15">
                <Users className="h-5 w-5 text-chart-1" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.totalCustomers}</p>
                <p className="text-xs text-muted-foreground">Totalt antal kunder</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/15 dark:bg-destructive/15">
                <TrendingDown className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="stat-lost-revenue">
                  {(summary.totalLostRevenue / 100).toLocaleString("sv-SE")} kr
                </p>
                <p className="text-xs text-muted-foreground">Historisk intäkt (inaktiva)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-chart-2/15 dark:bg-chart-2/15">
                <DollarSign className="h-5 w-5 text-chart-2" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {(summary.totalRevenueAll / 100).toLocaleString("sv-SE")} kr
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
          </div>

          {sortedCustomers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Inga inaktiva kunder hittades med nuvarande filter</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-auto dark:border-gray-700">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <button
                        className="flex items-center hover:text-foreground transition-colors cursor-pointer"
                        onClick={() => toggleSort("name")}
                        data-testid="sort-name"
                      >
                        Kund
                        <SortIcon field="name" />
                      </button>
                    </TableHead>
                    <TableHead className="hidden md:table-cell">Kontaktperson</TableHead>
                    <TableHead className="hidden md:table-cell">Kontakt</TableHead>
                    <TableHead className="text-right">
                      <button
                        className="flex items-center justify-end w-full hover:text-foreground transition-colors cursor-pointer"
                        onClick={() => toggleSort("lastOrderDate")}
                        data-testid="sort-last-order"
                      >
                        Senaste order
                        <SortIcon field="lastOrderDate" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button
                        className="flex items-center justify-end w-full hover:text-foreground transition-colors cursor-pointer"
                        onClick={() => toggleSort("daysSinceLastOrder")}
                        data-testid="sort-days-since"
                      >
                        Dagar sedan
                        <SortIcon field="daysSinceLastOrder" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right hidden lg:table-cell">
                      <button
                        className="flex items-center justify-end w-full hover:text-foreground transition-colors cursor-pointer"
                        onClick={() => toggleSort("orderCount")}
                        data-testid="sort-orders"
                      >
                        Ordrar
                        <SortIcon field="orderCount" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button
                        className="flex items-center justify-end w-full hover:text-foreground transition-colors cursor-pointer"
                        onClick={() => toggleSort("totalRevenue")}
                        data-testid="sort-revenue"
                      >
                        Historisk intäkt
                        <SortIcon field="totalRevenue" />
                      </button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedCustomers.map((cust) => (
                    <TableRow key={cust.id} data-testid={`row-inactive-customer-${cust.id}`}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{cust.name}</p>
                          {(cust.address || cust.city) && (
                            <p className="text-xs text-muted-foreground">
                              {[cust.address, cust.city].filter(Boolean).join(", ")}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {cust.contactPerson ? (
                          <div className="flex items-center gap-1.5 text-sm text-foreground">
                            <UserCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            {cust.contactPerson}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-col gap-1">
                          {cust.phone && (
                            <a href={`tel:${cust.phone}`} className="text-chart-1 hover:underline text-sm flex items-center gap-1" data-testid={`link-phone-${cust.id}`}>
                              <Phone className="h-3 w-3" />{cust.phone}
                            </a>
                          )}
                          {cust.email && (
                            <a href={`mailto:${cust.email}`} className="text-chart-1 hover:underline text-sm flex items-center gap-1" data-testid={`link-email-${cust.id}`}>
                              <Mail className="h-3 w-3" />{cust.email}
                            </a>
                          )}
                          {!cust.phone && !cust.email && (
                            <span className="text-xs text-muted-foreground">—</span>
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
                      <TableCell className="text-right text-sm hidden lg:table-cell">{cust.orderCount}</TableCell>
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

function useDebounce(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}
