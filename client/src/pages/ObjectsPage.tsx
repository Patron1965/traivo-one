import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ObjectCard } from "@/components/ObjectCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Filter, Loader2 } from "lucide-react";
import type { ServiceObject } from "@shared/schema";

export default function ObjectsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: objects = [], isLoading } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const { data: customers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/customers"],
  });

  const customerMap = new Map(customers.map(c => [c.id, c.name]));

  const filteredObjects = objects.filter(obj => {
    const customerName = customerMap.get(obj.customerId) || "";
    const matchesSearch = obj.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (obj.objectNumber || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "all" || obj.objectType === typeFilter;
    return matchesSearch && matchesType;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Objekt</h1>
          <p className="text-sm text-muted-foreground">{objects.length} objekt registrerade</p>
        </div>
        <Button onClick={() => console.log("Add object clicked")} data-testid="button-add-object">
          <Plus className="h-4 w-4 mr-2" />
          Lägg till objekt
        </Button>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Sök objekt, kund eller nummer..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-objects"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Typ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla typer</SelectItem>
            <SelectItem value="well">Brunnar</SelectItem>
            <SelectItem value="station">Stationer</SelectItem>
            <SelectItem value="property">Fastigheter</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredObjects.map((obj) => (
          <ObjectCard 
            key={obj.id} 
            id={obj.id}
            name={obj.name}
            objectNumber={obj.objectNumber || ""}
            objectType={obj.objectType}
            customerName={customerMap.get(obj.customerId) || "Okänd kund"}
            address={`${obj.address || ""}, ${obj.city || ""}`}
            avgSetupTime={obj.avgSetupTime || 0}
            lastServiceDate={obj.lastServiceDate ? new Date(obj.lastServiceDate).toLocaleDateString("sv-SE") : undefined}
            status={obj.status as "active" | "inactive"}
            onClick={() => console.log("Object clicked:", obj.name)}
          />
        ))}
      </div>

      {filteredObjects.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Inga objekt hittades</p>
        </div>
      )}
    </div>
  );
}
