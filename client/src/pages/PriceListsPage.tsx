import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Search,
  Loader2,
  Pencil,
  Trash2,
  Filter,
  DollarSign,
  ChevronDown,
  ChevronUp,
  ListTree,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { PriceList, Customer } from "@shared/schema";

const priceListTypeOptions = [
  { value: "general", label: "Generell" },
  { value: "customer", label: "Kundunik" },
  { value: "discount_letter", label: "Rabattbrev" },
];

const priceListTypeLabels: Record<string, string> = Object.fromEntries(
  priceListTypeOptions.map(t => [t.value, t.label])
);

interface PriceListFormData {
  name: string;
  priceListType: string;
  customerId: string | null;
  priority: number;
  validFrom: string;
  validTo: string;
  status: string;
  discountPercent: number | null;
}

const emptyFormData: PriceListFormData = {
  name: "",
  priceListType: "general",
  customerId: null,
  priority: 1,
  validFrom: "",
  validTo: "",
  status: "active",
  discountPercent: null,
};

export default function PriceListsPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingPriceList, setEditingPriceList] = useState<PriceList | null>(null);
  const [priceListToDelete, setPriceListToDelete] = useState<PriceList | null>(null);
  const [formData, setFormData] = useState<PriceListFormData>(emptyFormData);
  const [showFilters, setShowFilters] = useState(false);

  const { data: priceLists = [], isLoading } = useQuery<PriceList[]>({
    queryKey: ["/api/price-lists"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const customerMap = useMemo(() => {
    return new Map(customers.map(c => [c.id, c]));
  }, [customers]);

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return apiRequest("POST", "/api/price-lists", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-lists"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Prislista skapad", description: "Prislistan har lagts till." });
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      return apiRequest("PATCH", `/api/price-lists/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-lists"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Prislista uppdaterad", description: "Prislistan har uppdaterats." });
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/price-lists/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-lists"] });
      setDeleteDialogOpen(false);
      setPriceListToDelete(null);
      toast({ title: "Prislista borttagen", description: "Prislistan har tagits bort." });
    },
    onError: (error: Error) => {
      toast({ title: "Fel", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData(emptyFormData);
    setEditingPriceList(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (priceList: PriceList) => {
    setEditingPriceList(priceList);
    setFormData({
      name: priceList.name,
      priceListType: priceList.priceListType,
      customerId: priceList.customerId,
      priority: priceList.priority || 1,
      validFrom: priceList.validFrom ? new Date(priceList.validFrom).toISOString().split("T")[0] : "",
      validTo: priceList.validTo ? new Date(priceList.validTo).toISOString().split("T")[0] : "",
      status: priceList.status || "active",
      discountPercent: priceList.discountPercent,
    });
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData = {
      name: formData.name,
      priceListType: formData.priceListType,
      priority: formData.priority,
      status: formData.status,
      discountPercent: formData.discountPercent,
      validFrom: formData.validFrom ? new Date(`${formData.validFrom}T12:00:00Z`) : undefined,
      validTo: formData.validTo ? new Date(`${formData.validTo}T12:00:00Z`) : undefined,
      customerId: formData.priceListType === "general" ? undefined : formData.customerId,
    };
    
    if (editingPriceList) {
      updateMutation.mutate({ id: editingPriceList.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const filteredPriceLists = useMemo(() => {
    return priceLists.filter(priceList => {
      const matchesSearch = priceList.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = typeFilter === "all" || priceList.priceListType === typeFilter;
      
      return matchesSearch && matchesType;
    });
  }, [priceLists, searchQuery, typeFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Prislistor</h1>
            <p className="text-muted-foreground">
              Hantera prislistor och kundpriser
            </p>
          </div>
          <Button onClick={openCreateDialog} data-testid="button-create-price-list">
            <Plus className="h-4 w-4 mr-2" />
            Ny prislista
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-[400px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Sök prislista..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-price-list"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            data-testid="button-toggle-filters"
          >
            <Filter className="h-4 w-4 mr-2" />
            Filter
            {showFilters ? <ChevronUp className="h-4 w-4 ml-2" /> : <ChevronDown className="h-4 w-4 ml-2" />}
          </Button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-center gap-3 p-4 rounded-md bg-muted/50">
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">Typ:</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[150px]" data-testid="select-type-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla typer</SelectItem>
                  {priceListTypeOptions.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <CardTitle className="text-lg">
            {filteredPriceLists.length} prislistor
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Namn</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Kund</TableHead>
                <TableHead className="text-center">Prioritet</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Åtgärder</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPriceLists.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    <ListTree className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>Inga prislistor hittades</p>
                    {searchQuery && <p className="text-sm">Prova att ändra sökningen</p>}
                  </TableCell>
                </TableRow>
              ) : (
                filteredPriceLists.map((priceList) => (
                  <TableRow key={priceList.id} data-testid={`row-price-list-${priceList.id}`}>
                    <TableCell>
                      <div className="font-medium">{priceList.name}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {priceListTypeLabels[priceList.priceListType] || priceList.priceListType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {priceList.customerId ? (
                        <span>{customerMap.get(priceList.customerId)?.name || priceList.customerId}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {priceList.priority}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={priceList.status === "active" ? "default" : "outline"}>
                        {priceList.status === "active" ? "Aktiv" : "Inaktiv"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(priceList)}
                          data-testid={`button-edit-price-list-${priceList.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setPriceListToDelete(priceList);
                            setDeleteDialogOpen(true);
                          }}
                          data-testid={`button-delete-price-list-${priceList.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setDialogOpen(open); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPriceList ? "Redigera prislista" : "Ny prislista"}
            </DialogTitle>
            <DialogDescription>
              {editingPriceList ? "Uppdatera prislistinformation" : "Lägg till en ny prislista"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Namn</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Generell prislista 2024"
                  required
                  data-testid="input-price-list-name"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="priceListType">Typ</Label>
                  <Select
                    value={formData.priceListType}
                    onValueChange={(value) => setFormData({ ...formData, priceListType: value })}
                  >
                    <SelectTrigger data-testid="select-price-list-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {priceListTypeOptions.map(type => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="priority">Prioritet</Label>
                  <Input
                    id="priority"
                    type="number"
                    min="0"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                    data-testid="input-priority"
                  />
                  <p className="text-xs text-muted-foreground">
                    Högre prioritet vinner vid konflikt
                  </p>
                </div>
              </div>

              {formData.priceListType !== "general" && (
                <div className="space-y-2">
                  <Label htmlFor="customerId">Kund</Label>
                  <Select
                    value={formData.customerId || ""}
                    onValueChange={(value) => setFormData({ ...formData, customerId: value || null })}
                  >
                    <SelectTrigger data-testid="select-customer">
                      <SelectValue placeholder="Välj kund" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map(customer => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="validFrom">Giltig från</Label>
                  <Input
                    id="validFrom"
                    type="date"
                    value={formData.validFrom}
                    onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })}
                    data-testid="input-valid-from"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="validTo">Giltig till</Label>
                  <Input
                    id="validTo"
                    type="date"
                    value={formData.validTo}
                    onChange={(e) => setFormData({ ...formData, validTo: e.target.value })}
                    data-testid="input-valid-to"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger data-testid="select-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktiv</SelectItem>
                    <SelectItem value="inactive">Inaktiv</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => { resetForm(); setDialogOpen(false); }}
              >
                Avbryt
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-submit-price-list"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {editingPriceList ? "Spara ändringar" : "Skapa prislista"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort prislista?</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort prislistan "{priceListToDelete?.name}"?
              Denna åtgärd kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => priceListToDelete && deleteMutation.mutate(priceListToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
