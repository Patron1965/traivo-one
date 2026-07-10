import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CUSTOMER_HIERARCHY_TYPES } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/layout/PageHeader";
import { Search, Package, ClipboardList, ArrowRight, Users, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Trash2, ExternalLink, Loader2, Plus } from "lucide-react";
import { versionedUrl, apiRequest, queryClient } from "@/lib/queryClient";
import { QueryState } from "@/components/QueryState";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import type { Customer } from "@shared/schema";

interface CustomerAggregate {
  customerId: string;
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
  objectCount: number;
  activeOrders: number;
}

const PAGE_SIZE = 50;

const customerFormSchema = z.object({
  name: z.string().trim().min(1, "Namn krävs"),
  customerNumber: z.string().optional(),
  orgNumber: z.string().optional(),
  contactPerson: z.string().optional(),
  email: z.string().email("Ogiltig e-postadress").or(z.literal("")).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  notes: z.string().optional(),
});
type CustomerFormValues = z.infer<typeof customerFormSchema>;

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
  const [hierarchyFilter, setHierarchyFilter] = useState<string>("all");
  const [rootsOnly, setRootsOnly] = useState<boolean>(false);

  type SortField = "name" | "orgNumber" | "customerNumber" | "city" | "objects" | "activeOrders";
  const [sortConfig, setSortConfig] = useState<{ field: SortField; direction: "asc" | "desc" }>({ field: "name", direction: "asc" });
  const toggleSort = (field: SortField) => {
    setSortConfig(prev => prev.field === field
      ? { field, direction: prev.direction === "asc" ? "desc" : "asc" }
      : { field, direction: "asc" });
  };
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortConfig.field !== field) return <ArrowUpDown className="h-4 w-4 opacity-50 inline ml-1.5 stroke-[2.25]" />;
    return sortConfig.direction === "asc"
      ? <ArrowUp className="h-4 w-4 inline ml-1.5 stroke-[2.75] text-primary" />
      : <ArrowDown className="h-4 w-4 inline ml-1.5 stroke-[2.75] text-primary" />;
  };

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, hierarchyFilter, rootsOnly]);

  const { data: customersPage, isLoading: customersLoading, isFetching: customersFetching, isError: customersIsError, error: customersError, refetch: customersRefetch } = useQuery<CustomersPage>({
    queryKey: ["/api/customers", { page, limit: PAGE_SIZE, search: debouncedSearch, hierarchyFilter, rootsOnly }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (hierarchyFilter !== "all") params.set("level", hierarchyFilter);
      if (rootsOnly) params.set("rootsOnly", "true");
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

  const sortedCustomers = useMemo(() => {
    const dir = sortConfig.direction === "asc" ? 1 : -1;
    const arr = [...visibleCustomers];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortConfig.field) {
        case "name":
          cmp = (a.name || "").localeCompare(b.name || "", "sv", { numeric: true, sensitivity: "base" });
          break;
        case "orgNumber":
          cmp = (a.orgNumber || "").localeCompare(b.orgNumber || "", "sv", { numeric: true });
          break;
        case "customerNumber":
          cmp = (a.customerNumber || "").localeCompare(b.customerNumber || "", "sv", { numeric: true });
          break;
        case "city":
          cmp = (a.city || "").localeCompare(b.city || "", "sv", { sensitivity: "base" });
          break;
        case "objects":
          cmp = (aggMap.get(a.id)?.objectCount ?? 0) - (aggMap.get(b.id)?.objectCount ?? 0);
          break;
        case "activeOrders":
          cmp = (aggMap.get(a.id)?.activeOrders ?? 0) - (aggMap.get(b.id)?.activeOrders ?? 0);
          break;
      }
      return cmp * dir;
    });
    return arr;
  }, [visibleCustomers, sortConfig, aggMap]);

  const isLoading = customersLoading;
  const customerCount = totals?.customerCount ?? 0;
  const showSpinner = customersFetching && !customersLoading;
  const hasSearch = debouncedSearch.trim().length > 0;
  const tenantHasNoCustomers = !hasSearch && total === 0 && customersPage !== undefined;

  const { user } = useAuth();
  const canDelete = user?.role === "owner" || user?.role === "admin";
  const { toast } = useToast();

  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!deleteTarget) setConfirmText("");
  }, [deleteTarget]);

  const invalidateCustomers = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/customers/totals"] });
    queryClient.invalidateQueries({ queryKey: ["/api/customers/aggregates"] });
  };

  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const createForm = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: {
      name: "", customerNumber: "", orgNumber: "", contactPerson: "",
      email: "", phone: "", address: "", postalCode: "", city: "", notes: "",
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("create") === "true") {
      setCreateDialogOpen(true);
      params.delete("create");
      const remaining = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (remaining ? `?${remaining}` : ""));
    }
  }, []);

  const createMutation = useMutation({
    mutationFn: async (data: CustomerFormValues) => {
      const payload: Record<string, string> = { name: data.name.trim() };
      (["customerNumber", "orgNumber", "contactPerson", "email", "phone", "address", "postalCode", "city", "notes"] as const).forEach((k) => {
        const v = data[k]?.trim();
        if (v) payload[k] = v;
      });
      const res = await apiRequest("POST", "/api/customers", payload);
      return res.json() as Promise<Customer>;
    },
    onSuccess: (created) => {
      invalidateCustomers();
      setCreateDialogOpen(false);
      createForm.reset();
      toast({ title: "Kund skapad", description: `${created.name} har lagts till.` });
    },
    onError: (err) => {
      toast({
        title: "Kunde inte skapa kund",
        description: err instanceof Error ? err.message : "Okänt fel",
        variant: "destructive",
      });
    },
  });

  const restoreCustomer = async (c: Customer) => {
    try {
      await apiRequest("POST", `/api/customers/${c.id}/restore`);
      invalidateCustomers();
      toast({ title: "Kunden återställd", description: `${c.name} är aktiv igen.` });
    } catch (err) {
      toast({
        title: "Kunde inte ångra",
        description: err instanceof Error ? err.message : "Okänt fel",
        variant: "destructive",
      });
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (c: Customer) => {
      await apiRequest("DELETE", `/api/customers/${c.id}`);
      return c;
    },
    onSuccess: (c) => {
      invalidateCustomers();
      setDeleteTarget(null);
      toast({
        title: "Kunden borttagen",
        description: `${c.name} har tagits bort. Du kan ångra inom kort.`,
        duration: 15000,
        action: (
          <ToastAction altText="Ångra borttagning" onClick={() => restoreCustomer(c)}>
            Ångra
          </ToastAction>
        ),
      });
    },
    onError: (err) => {
      toast({
        title: "Kunde inte radera",
        description: err instanceof Error ? err.message : "Okänt fel",
        variant: "destructive",
      });
    },
  });

  const impersonateCustomer = async (c: Customer) => {
    setImpersonatingId(c.id);
    try {
      const res = await apiRequest("POST", `/api/customers/${c.id}/portal-impersonate`);
      const data = (await res.json()) as { token?: string; verifyPath?: string };
      if (!data.token || !data.verifyPath) throw new Error("Tomt svar från servern");
      const url = `${data.verifyPath}?token=${encodeURIComponent(data.token)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({
        title: "Kunde inte öppna portal",
        description: err instanceof Error ? err.message : "Okänt fel",
        variant: "destructive",
      });
    } finally {
      setImpersonatingId(null);
    }
  };

  const nameMatches = deleteTarget ? confirmText.trim() === deleteTarget.name.trim() : false;
  const deleteAgg = deleteTarget ? aggMap.get(deleteTarget.id) : undefined;

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Kunder"
        description="Översikt över alla kunder och objekt"
        icon={Users}
      >
        <Button
          onClick={() => { createForm.reset(); setCreateDialogOpen(true); }}
          data-testid="button-new-customer"
        >
          <Plus className="h-4 w-4 mr-2" />
          Ny kund
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Sök kund, kundnummer, e-post eller ort..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-md"
                data-testid="input-customer-search"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Nivå:</span>
              <Select value={hierarchyFilter} onValueChange={setHierarchyFilter}>
                <SelectTrigger className="w-36 h-8" data-testid="select-hierarchy-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla</SelectItem>
                  <SelectItem value="none">Ej satt</SelectItem>
                  {CUSTOMER_HIERARCHY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <Switch checked={rootsOnly} onCheckedChange={setRootsOnly} data-testid="switch-roots-only" />
              Endast rotkunder
            </label>
            {showSpinner && (
              <span className="text-xs text-muted-foreground" data-testid="text-loading-indicator">
                Laddar...
              </span>
            )}
          </div>

          <QueryState
            isLoading={isLoading}
            isError={customersIsError}
            isEmpty={tenantHasNoCustomers || (visibleCustomers.length === 0)}
            error={customersError instanceof Error ? customersError : null}
            onRetry={() => customersRefetch()}
            loadingVariant="skeleton-rows"
            skeletonRows={6}
            emptyTitle={tenantHasNoCustomers ? "Inga kunder ännu" : `Inga kunder matchar "${debouncedSearch}"`}
            emptyDescription={tenantHasNoCustomers ? "Gå till Import för att importera kunder från Fortnox eller fil." : undefined}
            emptyAction={tenantHasNoCustomers ? (
              <Link href="/import" className="text-primary underline text-sm" data-testid="link-import-customers">Öppna Import</Link>
            ) : undefined}
          >
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <button onClick={() => toggleSort("name")} className="flex items-center hover:text-foreground" data-testid="button-sort-name">
                          Kund <SortIcon field="name" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button onClick={() => toggleSort("orgNumber")} className="flex items-center hover:text-foreground" data-testid="button-sort-org">
                          Org-nr <SortIcon field="orgNumber" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button onClick={() => toggleSort("customerNumber")} className="flex items-center hover:text-foreground" data-testid="button-sort-customernumber">
                          Kundnummer <SortIcon field="customerNumber" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button onClick={() => toggleSort("city")} className="flex items-center hover:text-foreground" data-testid="button-sort-city">
                          Ort <SortIcon field="city" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button onClick={() => toggleSort("objects")} className="flex items-center hover:text-foreground ml-auto" data-testid="button-sort-objects">
                          Objekt <SortIcon field="objects" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button onClick={() => toggleSort("activeOrders")} className="flex items-center hover:text-foreground ml-auto" data-testid="button-sort-activeorders">
                          Aktiva ordrar <SortIcon field="activeOrders" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedCustomers.map((c) => {
                      const agg = aggMap.get(c.id);
                      const aggReady = !aggLoading && aggregates !== undefined;
                      return (
                        <TableRow key={c.id} data-testid={`row-customer-${c.id}`} className="hover-elevate">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Link href={`/customers/${c.id}`} className="font-medium hover:underline" data-testid={`link-customer-${c.id}`}>
                                {c.name}
                              </Link>
                              {c.hierarchyType && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4" data-testid={`badge-hierarchy-${c.id}`}>
                                  {c.hierarchyType.charAt(0).toUpperCase() + c.hierarchyType.slice(1)}
                                </Badge>
                              )}
                            </div>
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
                            <TooltipProvider delayDuration={200}>
                              <div className="flex items-center justify-end gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => impersonateCustomer(c)}
                                      disabled={impersonatingId === c.id}
                                      data-testid={`button-portal-${c.id}`}
                                    >
                                      {impersonatingId === c.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <ExternalLink className="h-3.5 w-3.5" />
                                      )}
                                      <span className="ml-1 hidden sm:inline">Portal</span>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Öppna kundens portalvy i ny flik
                                  </TooltipContent>
                                </Tooltip>

                                {canDelete && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setDeleteTarget(c)}
                                        className="text-destructive hover:text-destructive"
                                        data-testid={`button-delete-customer-${c.id}`}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Radera kund</TooltipContent>
                                  </Tooltip>
                                )}

                                <Link href={`/customers/${c.id}`}>
                                  <Button variant="ghost" size="sm" data-testid={`button-open-customer-${c.id}`}>
                                    Öppna
                                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                                  </Button>
                                </Link>
                              </div>
                            </TooltipProvider>
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
          </QueryState>
        </CardContent>
      </Card>

      <Dialog open={createDialogOpen} onOpenChange={(open) => { setCreateDialogOpen(open); if (!open) createForm.reset(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ny kund</DialogTitle>
            <DialogDescription>
              Lägg till en ny kund i registret. Endast namn är obligatoriskt.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Namn *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Företagsnamn" data-testid="input-customer-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={createForm.control}
                  name="customerNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kundnummer</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="t.ex. 1001" data-testid="input-customer-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="orgNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Org.nummer</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="556xxx-xxxx" data-testid="input-customer-orgnumber" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={createForm.control}
                name="contactPerson"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kontaktperson</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="För- och efternamn" data-testid="input-customer-contact" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={createForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-post</FormLabel>
                      <FormControl>
                        <Input {...field} type="email" placeholder="kund@exempel.se" data-testid="input-customer-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefon</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="070-123 45 67" data-testid="input-customer-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={createForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Adress</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Gatuadress" data-testid="input-customer-address" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={createForm.control}
                  name="postalCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Postnummer</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="123 45" data-testid="input-customer-postalcode" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ort</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Stad" data-testid="input-customer-city" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={createForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Anteckningar</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={3} placeholder="Valfria interna anteckningar" data-testid="input-customer-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)} data-testid="button-cancel-create-customer">
                  Avbryt
                </Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-create-customer">
                  {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Skapa kund
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Radera kund permanent?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Du är på väg att radera <strong>{deleteTarget?.name}</strong>
                  {deleteTarget?.customerNumber ? ` (kundnr ${deleteTarget.customerNumber})` : ""}.
                </p>
                {deleteAgg && (deleteAgg.objectCount > 0 || deleteAgg.activeOrders > 0) && (
                  <div className="rounded-md border border-warning bg-warning/10 p-3 text-sm">
                    <div className="font-medium text-foreground">Kunden har kopplad data:</div>
                    <ul className="mt-1 list-disc pl-5 text-foreground">
                      {deleteAgg.objectCount > 0 && <li>{deleteAgg.objectCount} objekt</li>}
                      {deleteAgg.activeOrders > 0 && <li>{deleteAgg.activeOrders} aktiva ordrar</li>}
                    </ul>
                  </div>
                )}
                <p className="text-sm">
                  Skriv kundens namn exakt för att bekräfta: <span className="font-mono">{deleteTarget?.name}</span>
                </p>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={deleteTarget?.name ?? ""}
                  autoFocus
                  data-testid="input-confirm-delete-name"
                />
                <p className="text-xs text-muted-foreground">
                  Du kan ångra raderingen direkt efteråt via knappen i meddelandet (15 sek).
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-customer">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget && nameMatches) deleteMutation.mutate(deleteTarget);
              }}
              disabled={!nameMatches || deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-customer"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Radera permanent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
