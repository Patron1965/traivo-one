import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Search, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { ServiceObject, CustomerMode } from "@shared/schema";

interface MissingCustomerObj {
  id: string;
  name: string;
  objectNumber: string | null;
  customerId: string | null;
}

interface WithCustomerObj {
  id: string;
  name: string;
  customerId: string;
  customerName: string | null;
}

interface Step2Props {
  selectedObjectIds: Set<string>;
  onToggleObject: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  customerMode: CustomerMode;
}

export default function Step2ObjectConfirmation({
  selectedObjectIds,
  onToggleObject,
  onSelectAll,
  onDeselectAll,
  customerMode,
}: Step2Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: allObjects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const selectedIdsArray = useMemo(() => Array.from(selectedObjectIds), [selectedObjectIds]);

  const { data: customerMetadataCheck } = useQuery<{ missingCustomer: MissingCustomerObj[]; withCustomer: WithCustomerObj[]; total: number }>({
    queryKey: ["/api/order-concepts/check-customer-metadata", selectedIdsArray.join(",")],
    queryFn: async () => {
      if (selectedIdsArray.length === 0) return { missingCustomer: [], withCustomer: [], total: 0 };
      const res = await apiRequest("POST", "/api/order-concepts/check-customer-metadata", { objectIds: selectedIdsArray });
      return res.json();
    },
    enabled: customerMode === "FROM_METADATA" && selectedIdsArray.length > 0,
  });

  const missingCustomerIds = useMemo(() => {
    if (!customerMetadataCheck) return new Set<string>();
    return new Set(customerMetadataCheck.missingCustomer.map(o => o.id));
  }, [customerMetadataCheck]);

  const selectedObjects = useMemo(() => {
    return allObjects.filter(obj => selectedObjectIds.has(obj.id));
  }, [allObjects, selectedObjectIds]);

  const objectTypes = useMemo(() => {
    const types = new Set(selectedObjects.map(o => o.objectType).filter(Boolean));
    return Array.from(types);
  }, [selectedObjects]);

  const filteredObjects = useMemo(() => {
    return selectedObjects.filter(obj => {
      if (search) {
        const q = search.toLowerCase();
        if (
          !obj.name.toLowerCase().includes(q) &&
          !(obj.address && obj.address.toLowerCase().includes(q)) &&
          !(obj.objectNumber && obj.objectNumber.toLowerCase().includes(q))
        ) return false;
      }
      if (typeFilter !== "all" && obj.objectType !== typeFilter) return false;
      if (statusFilter !== "all" && obj.status !== statusFilter) return false;
      return true;
    });
  }, [selectedObjects, search, typeFilter, statusFilter]);

  return (
    <div className="space-y-4" data-testid="step2-confirmation">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök objekt..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-object-search"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-type-filter">
            <SelectValue placeholder="Alla typer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla typer</SelectItem>
            {objectTypes.map(t => (
              <SelectItem key={t} value={t!}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
            <SelectValue placeholder="Alla status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla status</SelectItem>
            <SelectItem value="active">Aktiv</SelectItem>
            <SelectItem value="inactive">Inaktiv</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {customerMode === "FROM_METADATA" && customerMetadataCheck && customerMetadataCheck.missingCustomer.length > 0 && (
        <Alert variant="destructive" data-testid="alert-missing-customer">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>{customerMetadataCheck.missingCustomer.length} objekt</strong> saknar kundkoppling.
            Dessa objekt kan inte faktureras automatiskt vid FROM_METADATA-läge.
          </AlertDescription>
        </Alert>
      )}

      <ScrollArea className="h-[420px] border rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="p-2 text-left w-10">
                <Checkbox
                  checked={selectedObjectIds.size > 0 && filteredObjects.every(o => selectedObjectIds.has(o.id))}
                  onCheckedChange={(checked) => checked ? onSelectAll() : onDeselectAll()}
                  data-testid="checkbox-select-all"
                />
              </th>
              <th className="p-2 text-left font-medium">Objekt</th>
              <th className="p-2 text-left font-medium">Typ</th>
              <th className="p-2 text-left font-medium">Adress</th>
              <th className="p-2 text-left font-medium">Status</th>
              {customerMode === "FROM_METADATA" && (
                <th className="p-2 text-left font-medium">Kund</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredObjects.map(obj => (
              <tr key={obj.id} className={`border-t hover:bg-accent/30 ${customerMode === "FROM_METADATA" && missingCustomerIds.has(obj.id) ? "bg-red-50 dark:bg-red-900/10" : ""}`} data-testid={`row-object-${obj.id}`}>
                <td className="p-2">
                  <Checkbox
                    checked={selectedObjectIds.has(obj.id)}
                    onCheckedChange={() => onToggleObject(obj.id)}
                    data-testid={`checkbox-object-${obj.id}`}
                  />
                </td>
                <td className="p-2">
                  <div className="font-medium">{obj.name}</div>
                  {obj.objectNumber && (
                    <div className="text-xs text-muted-foreground">{obj.objectNumber}</div>
                  )}
                </td>
                <td className="p-2">
                  <Badge variant="outline" className="text-xs">{obj.objectType || "—"}</Badge>
                </td>
                <td className="p-2 text-muted-foreground">{obj.address || "—"}</td>
                <td className="p-2">
                  {obj.status === "active" ? (
                    <Badge variant="default" className="text-xs">Aktiv</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      {obj.status || "Okänd"}
                    </Badge>
                  )}
                </td>
                {customerMode === "FROM_METADATA" && (
                  <td className="p-2">
                    {missingCustomerIds.has(obj.id) ? (
                      <Badge variant="destructive" className="text-xs" data-testid={`badge-missing-customer-${obj.id}`}>
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Saknar kund
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-green-700 dark:text-green-400" data-testid={`badge-has-customer-${obj.id}`}>
                        OK
                      </Badge>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {filteredObjects.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Inga objekt matchar filtret
          </div>
        )}
      </ScrollArea>

      <div className="flex items-center justify-between text-sm">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onSelectAll} data-testid="button-select-all">
            Välj alla
          </Button>
          <Button variant="outline" size="sm" onClick={onDeselectAll} data-testid="button-deselect-all">
            Avmarkera alla
          </Button>
        </div>
        <span className="text-muted-foreground" data-testid="text-showing-count">
          Visar {filteredObjects.length} av {selectedObjects.length} objekt
        </span>
      </div>
    </div>
  );
}
