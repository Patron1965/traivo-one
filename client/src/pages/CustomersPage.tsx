import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/PageHeader";
import { Building2, Search, Layers, Package, ClipboardList, ArrowRight, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { versionedUrl } from "@/lib/queryClient";
import type { Customer } from "@shared/schema";

interface CustomerAggregate {
  customerId: string;
  clusterCount: number;
  objectCount: number;
  activeOrders: number;
}

interface CustomersPage {
  data: Customer[];
  total: number;
  page: number;
  limit: number;
}

interface CustomerTotals {
  customerCount: number;
  clusterCount: number;
  objectCount: number;
  activeOrders: number;
}

const PAGE_SIZE = 50;

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data: customersPage, isLoading: customersLoading, isFetching: customersFetching } = useQuery<CustomersPage>({
    queryKey: ["/api/customers", { page, limit: PAGE_SIZE, search: debouncedSearch }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      const res = await fetch(versionedUrl(`/api/customers?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
    placeholderData: keepPreviousData,
  });

  const visibleCustomers = customersPage?.data ?? [];
  const total = customersPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const visibleIds = useMemo(() => visibleCustomers.map((c) => c.id), [visibleCustomers]);
  const visibleIdsKey = visibleIds.join(",");

  const { data: aggregates, isLoading: aggLoading } = useQuery<CustomerAggregate[]>({
    queryKey: ["/api/customers/aggregates", visibleIdsKey],
    queryFn: async () => {
      if (!visibleIdsKey) return [];
      const res = await fetch(versionedUrl(`/api/customers/aggregates?ids=${encodeURIComponent(visibleIdsKey)}`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
    enabled: visibleIds.length > 0,
    placeholderData: keepPreviousData,
  });

  const { data: totals } = useQuery<CustomerTotals>({
    queryKey: ["/api/customers/totals"],
  });

  const aggMap = useMemo(() => {
    const map = new Map<string, CustomerAggregate>();
    (aggregates || []).forEach((a) => map.set(a.customerId, a));
    return map;
  }, [aggregates]);

  const isLoading = customersLoading;
  const customerCount = totals?.customerCount ?? 0;
  const showSpinner = customersFetching && !customersLoading;
  const hasSearch = debouncedSearch.trim().length > 0;
  const tenantHasNoCustomers = !hasSearch && total === 0 && customersPage !== undefined;

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Kunder"
        description="Översikt över alla kunder, deras kluster och objekt"
        icon={Users}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Kunder</div>
            <div className="text-2xl font-semibold mt-1" data-testid="stat-customer-count">
              {customerCount}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Kluster</div>
            <div className="text-2xl font-semibold mt-1" data-testid="stat-cluster-total">
              {totals?.clusterCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Objekt</div>
            <div className="text-2xl font-semibold mt-1" data-testid="stat-object-total">
              {totals?.objectCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Aktiva ordrar</div>
            <div className="text-2xl font-semibold mt-1" data-testid="stat-active-orders-total">
              {totals?.activeOrders ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Sök kund, kundnummer, e-post eller ort..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
              data-testid="input-customer-search"
            />
            {showSpinner && (
              <span className="text-xs text-muted-foreground" data-testid="text-loading-indicator">
                Laddar...
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : tenantHasNoCustomers ? (
            <div className="py-12 text-center text-muted-foreground space-y-2" data-testid="text-empty-customers">
              <Building2 className="h-12 w-12 mx-auto text-muted-foreground/40" />
              <p>Inga kunder ännu.</p>
              <p className="text-sm">
                Gå till <Link href="/import" className="text-primary underline">Import</Link> för att importera kunder från Fortnox eller fil.
              </p>
            </div>
          ) : visibleCustomers.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground" data-testid="text-no-search-results">
              Inga kunder matchar "{debouncedSearch}".
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kund</TableHead>
                      <TableHead>Org-nr</TableHead>
                      <TableHead>Kundnummer</TableHead>
                      <TableHead>Ort</TableHead>
                      <TableHead className="text-right">Kluster</TableHead>
                      <TableHead className="text-right">Objekt</TableHead>
                      <TableHead className="text-right">Aktiva ordrar</TableHead>
                      <TableHead className="text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleCustomers.map((c) => {
                      const agg = aggMap.get(c.id);
                      const aggReady = !aggLoading && aggregates !== undefined;
                      return (
                        <TableRow key={c.id} data-testid={`row-customer-${c.id}`} className="hover-elevate">
                          <TableCell>
                            <Link href={`/customers/${c.id}`} className="font-medium hover:underline" data-testid={`link-customer-${c.id}`}>
                              {c.name}
                            </Link>
                            {c.contactPerson && (
                              <div className="text-xs text-muted-foreground">{c.contactPerson}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground font-mono" data-testid={`text-org-number-${c.id}`}>
                            {c.orgNumber || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground" data-testid={`text-customer-number-${c.id}`}>
                            {c.customerNumber || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{c.city || "—"}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="gap-1" data-testid={`badge-clusters-${c.id}`}>
                              <Layers className="h-3 w-3" />
                              {aggReady ? (agg?.clusterCount ?? 0) : "…"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="gap-1" data-testid={`badge-objects-${c.id}`}>
                              <Package className="h-3 w-3" />
                              {aggReady ? (agg?.objectCount ?? 0) : "…"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={agg && agg.activeOrders > 0 ? "default" : "outline"}
                              className="gap-1"
                              data-testid={`badge-active-orders-${c.id}`}
                            >
                              <ClipboardList className="h-3 w-3" />
                              {aggReady ? (agg?.activeOrders ?? 0) : "…"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Link href={`/customers/${c.id}`}>
                              <Button variant="ghost" size="sm" data-testid={`button-open-customer-${c.id}`}>
                                Öppna
                                <ArrowRight className="h-3.5 w-3.5 ml-1" />
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-xs text-muted-foreground" data-testid="text-pagination-info">
                  Visar {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} av {total}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Föregående
                  </Button>
                  <span className="text-xs text-muted-foreground" data-testid="text-page-indicator">
                    Sida {page} av {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    data-testid="button-next-page"
                  >
                    Nästa
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
