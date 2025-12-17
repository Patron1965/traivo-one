import { useState } from "react";
import { ObjectCard } from "@/components/ObjectCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Filter } from "lucide-react";

// todo: remove mock functionality
const mockObjects = [
  {
    id: "1",
    name: "Brunn 1 - Skogsbacken",
    objectNumber: "OBJ-001",
    objectType: "well",
    customerName: "Villa Skogsbacken AB",
    address: "Skogsbacken 12, Stockholm",
    avgSetupTime: 12,
    lastServiceDate: "2024-11-15",
    status: "active" as const,
  },
  {
    id: "2",
    name: "Pump Station - Skogsbacken",
    objectNumber: "OBJ-002",
    objectType: "station",
    customerName: "Villa Skogsbacken AB",
    address: "Skogsbacken 12, Stockholm",
    avgSetupTime: 18,
    lastServiceDate: "2024-10-20",
    status: "active" as const,
  },
  {
    id: "3",
    name: "Huvudbrunn - Norrtull",
    objectNumber: "OBJ-003",
    objectType: "well",
    customerName: "Fastighets AB Norrtull",
    address: "Norrtullsgatan 5, Stockholm",
    avgSetupTime: 22,
    lastServiceDate: "2024-09-05",
    status: "active" as const,
  },
  {
    id: "4",
    name: "Privatbrunn - Täby",
    objectNumber: "OBJ-004",
    objectType: "well",
    customerName: "Lars Larsson",
    address: "Björkvägen 3, Täby",
    avgSetupTime: 8,
    lastServiceDate: "2024-12-01",
    status: "active" as const,
  },
];

export default function ObjectsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const filteredObjects = mockObjects.filter(obj => {
    const matchesSearch = obj.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         obj.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         obj.objectNumber.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "all" || obj.objectType === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Objekt</h1>
          <p className="text-sm text-muted-foreground">{mockObjects.length} objekt registrerade</p>
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
            {...obj} 
            onClick={() => console.log("Object clicked:", obj.name)}
          />
        ))}
      </div>

      {filteredObjects.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Inga objekt hittades</p>
        </div>
      )}
    </div>
  );
}
