import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, AlertTriangle } from "lucide-react";
import type { ServiceObject } from "@shared/schema";

interface Step2Props {
  selectedObjectIds: Set<string>;
  onToggleObject: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export default function Step2ObjectConfirmation({
  selectedObjectIds,
  onToggleObject,
  onSelectAll,
  onDeselectAll,
}: Step2Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: allObjects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

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
            </tr>
          </thead>
          <tbody>
            {filteredObjects.map(obj => (
              <tr key={obj.id} className="border-t hover:bg-accent/30" data-testid={`row-object-${obj.id}`}>
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
