import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ObjectCard } from "@/components/ObjectCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Filter, Loader2, ChevronRight, Building2, MapPin, Trash2 } from "lucide-react";
import type { ServiceObject, Customer } from "@shared/schema";

const objectTypeLabels: Record<string, string> = {
  omrade: "Område",
  fastighet: "Fastighet",
  serviceboende: "Serviceboende",
  rum: "Rum",
  soprum: "Soprum",
  kok: "Kök",
  uj_hushallsavfall: "UJ Hushållsavfall",
  matafall: "Matavfall",
  atervinning: "Återvinning",
};

const accessTypeLabels: Record<string, string> = {
  open: "Öppet",
  code: "Kod",
  key: "Nyckel/bricka",
  meeting: "Personligt möte",
};

export default function ObjectsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());

  const { data: objects = [], isLoading } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const customerMap = new Map(customers.map(c => [c.id, c.name]));
  const objectMap = new Map(objects.map(o => [o.id, o]));

  const topLevelObjects = objects.filter(obj => !obj.parentId);

  const getChildren = (parentId: string) => 
    objects.filter(obj => obj.parentId === parentId);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedAreas);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedAreas(newExpanded);
  };

  const filteredTopLevel = topLevelObjects.filter(obj => {
    const customerName = customerMap.get(obj.customerId) || "";
    const matchesSearch = 
      obj.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (obj.objectNumber || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (obj.address || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "all" || obj.objectType === typeFilter;
    const matchesLevel = levelFilter === "all" || obj.objectLevel?.toString() === levelFilter;
    return matchesSearch && matchesType && matchesLevel;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderObjectTree = (obj: ServiceObject, level: number = 0) => {
    const children = getChildren(obj.id);
    const isExpanded = expandedAreas.has(obj.id);
    const hasChildren = children.length > 0;
    const customerName = customerMap.get(obj.customerId) || "";

    return (
      <div key={obj.id} className="border-b last:border-b-0">
        <div 
          className={`flex items-center gap-3 p-3 hover-elevate active-elevate-2 cursor-pointer ${level > 0 ? 'bg-muted/30' : ''}`}
          style={{ paddingLeft: `${12 + level * 24}px` }}
          onClick={() => hasChildren && toggleExpand(obj.id)}
          data-testid={`object-row-${obj.id}`}
        >
          {hasChildren ? (
            <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          ) : (
            <div className="w-4" />
          )}
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{obj.name}</span>
              <Badge variant="secondary" className="text-xs">
                {objectTypeLabels[obj.objectType] || obj.objectType}
              </Badge>
              {obj.accessType && obj.accessType !== "open" && (
                <Badge variant="outline" className="text-xs">
                  {accessTypeLabels[obj.accessType] || obj.accessType}
                  {obj.accessCode && `: ${obj.accessCode}`}
                  {obj.keyNumber && `: ${obj.keyNumber}`}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
              {obj.address && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {obj.address}, {obj.city}
                </span>
              )}
              {level === 0 && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {customerName}
                </span>
              )}
              {(obj.containerCount || 0) > 0 && (
                <span className="flex items-center gap-1">
                  <Trash2 className="h-3 w-3" />
                  {obj.containerCount} kärl
                </span>
              )}
            </div>
          </div>

          {obj.avgSetupTime && obj.avgSetupTime > 0 && (
            <div className="text-right shrink-0">
              <div className="text-sm font-medium">{obj.avgSetupTime} min</div>
              <div className="text-xs text-muted-foreground">ställtid</div>
            </div>
          )}

          {hasChildren && (
            <Badge variant="outline" className="shrink-0">
              {children.length} under
            </Badge>
          )}
        </div>

        {isExpanded && hasChildren && (
          <div>
            {children.map(child => renderObjectTree(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Objekt</h1>
          <p className="text-sm text-muted-foreground">
            {objects.length} objekt totalt, {topLevelObjects.length} toppnivå
          </p>
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
            placeholder="Sök objekt, kund, adress..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-objects"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Objekttyp" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla typer</SelectItem>
            <SelectItem value="omrade">Område</SelectItem>
            <SelectItem value="fastighet">Fastighet</SelectItem>
            <SelectItem value="serviceboende">Serviceboende</SelectItem>
            <SelectItem value="rum">Rum</SelectItem>
            <SelectItem value="soprum">Soprum</SelectItem>
            <SelectItem value="kok">Kök</SelectItem>
            <SelectItem value="uj_hushallsavfall">UJ Hushållsavfall</SelectItem>
            <SelectItem value="matafall">Matavfall</SelectItem>
            <SelectItem value="atervinning">Återvinning</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-md bg-card">
        {filteredTopLevel.length > 0 ? (
          filteredTopLevel.map(obj => renderObjectTree(obj))
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Inga objekt hittades</p>
          </div>
        )}
      </div>
    </div>
  );
}
