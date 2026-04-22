import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/PageHeader";
import { Building2, Search, Layers, Package, ClipboardList, ArrowRight, Users } from "lucide-react";
import type { Customer } from "@shared/schema";

interface CustomerAggregate {
  customerId: string;
  clusterCount: number;
  objectCount: number;
  activeOrders: number;
}

export default function CustomersPage() {
  const [search, setSearch] = useState("");

  const { data: customers, isLoading: customersLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: aggregates, isLoading: aggLoading } = useQuery<CustomerAggregate[]>({
    queryKey: ["/api/customers/aggregates"],
  });

  const aggMap = useMemo(() => {
    const map = new Map<string, CustomerAggregate>();
    (aggregates || []).forEach((a) => map.set(a.customerId, a));
    return map;
  }, [aggregates]);

  const filtered = useMemo(() => {
    const list = customers || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      return (
        c.name?.toLowerCase().includes(q) ||
        c.customerNumber?.toLowerCase().includes(q) ||
        c.orgNumber?.toLowerCase().includes(q) ||
        c.contactPerson?.toLowerCase().includes(q) ||
        c.city?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
      );
    });
  }, [customers, search]);

  const totals = useMemo(() => {
    const list = aggregates || [];
    return list.reduce(
      (acc, a) => {
        acc.clusters += a.clusterCount;
        acc.objects += a.objectCount;
        acc.activeOrders += a.activeOrders;
        return acc;
      },
      { clusters: 0, objects: 0, activeOrders: 0 },
    );
  }, [aggregates]);

  const isLoading = customersLoading || aggLoading;
  const customerCount = customers?.length || 0;

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
              {totals.clusters}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Objekt</div>
            <div className="text-2xl font-semibold mt-1" data-testid="stat-object-total">
              {totals.objects}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">Aktiva ordrar</div>
            <div className="text-2xl font-semibold mt-1" data-testid="stat-active-orders-total">
              {totals.activeOrders}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Sök kund, kundnummer, kontaktperson, ort eller e-post..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
              data-testid="input-customer-search"
            />
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : customerCount === 0 ? (
            <div className="py-12 text-center text-muted-foreground space-y-2" data-testid="text-empty-customers">
              <Building2 className="h-12 w-12 mx-auto text-muted-foreground/40" />
              <p>Inga kunder ännu.</p>
              <p className="text-sm">
                Gå till <Link href="/import" className="text-primary underline">Import</Link> för att importera kunder från Fortnox eller fil.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground" data-testid="text-no-search-results">
              Inga kunder matchar "{search}".
            </div>
          ) : (
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
                  {filtered.map((c) => {
                    const agg = aggMap.get(c.id);
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
                            {agg?.clusterCount ?? 0}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="gap-1" data-testid={`badge-objects-${c.id}`}>
                            <Package className="h-3 w-3" />
                            {agg?.objectCount ?? 0}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={agg && agg.activeOrders > 0 ? "default" : "outline"}
                            className="gap-1"
                            data-testid={`badge-active-orders-${c.id}`}
                          >
                            <ClipboardList className="h-3 w-3" />
                            {agg?.activeOrders ?? 0}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
