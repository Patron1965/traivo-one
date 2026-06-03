import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { MetadataKatalog } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Link2, Search, Layers, Tag } from "lucide-react";

// Task #665: Admin-sida för att koppla metadatafält/familjer till en ordertyp.
// Kopplingsnyckel = work_orders.order_type (fri sträng). Familj-förälder kan kopplas
// och expanderas till sina underfält i orderformuläret. Värden sparas som
// work-order-metadata via befintlig väg.

interface OrderTypeMetadataLink {
  id: string;
  tenantId: string;
  orderType: string;
  metadataKatalogId: string;
  sortOrder: number | null;
  createdBy: string | null;
  createdAt: string;
  katalog: MetadataKatalog | null;
}

const ALL_ORDER_TYPES_PLACEHOLDER = "__custom__";

export default function OrderTypeMetadataPage() {
  const { toast } = useToast();
  const [selectedOrderType, setSelectedOrderType] = useState<string>("");
  const [customOrderType, setCustomOrderType] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data: orderTypes, isLoading: orderTypesLoading } = useQuery<string[]>({
    queryKey: ["/api/order-types"],
  });

  const { data: metadataTypes, isLoading: typesLoading } = useQuery<MetadataKatalog[]>({
    queryKey: ["/api/metadata/types"],
  });

  const effectiveOrderType =
    selectedOrderType === ALL_ORDER_TYPES_PLACEHOLDER
      ? customOrderType.trim()
      : selectedOrderType;

  const { data: links, isLoading: linksLoading } = useQuery<OrderTypeMetadataLink[]>({
    queryKey: ["/api/order-type-metadata-links", effectiveOrderType],
    queryFn: async () => {
      // Egen queryFn: ordertypen är fri sträng (mellanslag, å/ä/ö m.m.) och måste
      // URL-kodas — standard-fetchern joinar query-key:n rått utan encoding.
      const res = await fetch(`/api/order-type-metadata-links/${encodeURIComponent(effectiveOrderType)}`);
      if (!res.ok) throw new Error("Kunde inte hämta kopplingar");
      return res.json();
    },
    enabled: !!effectiveOrderType,
  });

  const linkedIds = useMemo(() => {
    const map = new Map<string, string>();
    (links || []).forEach((l) => map.set(l.metadataKatalogId, l.id));
    return map;
  }, [links]);

  const createMutation = useMutation({
    mutationFn: async (metadataKatalogId: string) => {
      return apiRequest("POST", "/api/order-type-metadata-links", {
        orderType: effectiveOrderType,
        metadataKatalogId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-type-metadata-links", effectiveOrderType] });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte koppla fält", description: err?.message ?? "Okänt fel", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (linkId: string) => {
      return apiRequest("DELETE", `/api/order-type-metadata-links/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-type-metadata-links", effectiveOrderType] });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte ta bort koppling", description: err?.message ?? "Okänt fel", variant: "destructive" });
    },
  });

  const toggleLink = (katalogId: string) => {
    if (!effectiveOrderType) {
      toast({ title: "Välj ordertyp först", variant: "destructive" });
      return;
    }
    const existing = linkedIds.get(katalogId);
    if (existing) {
      deleteMutation.mutate(existing);
    } else {
      createMutation.mutate(katalogId);
    }
  };

  // Gruppera katalogen: familje-föräldrar med sina underfält, sedan fristående fält.
  const grouped = useMemo(() => {
    const all = metadataTypes || [];
    const q = search.trim().toLowerCase();
    const matches = (t: MetadataKatalog) =>
      !q ||
      t.namn.toLowerCase().includes(q) ||
      (t.beteckning?.toLowerCase().includes(q) ?? false) ||
      (t.beskrivning?.toLowerCase().includes(q) ?? false);

    const childrenByParent = new Map<string, MetadataKatalog[]>();
    const parents: MetadataKatalog[] = [];
    const standalone: MetadataKatalog[] = [];

    for (const t of all) {
      if (t.parentMetadataId) {
        const arr = childrenByParent.get(t.parentMetadataId);
        if (arr) arr.push(t);
        else childrenByParent.set(t.parentMetadataId, [t]);
      }
    }
    const parentIds = new Set(Array.from(childrenByParent.keys()));
    for (const t of all) {
      if (parentIds.has(t.id)) parents.push(t);
      else if (!t.parentMetadataId) standalone.push(t);
    }

    const sortFn = (a: MetadataKatalog, b: MetadataKatalog) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.namn.localeCompare(b.namn, "sv");

    childrenByParent.forEach((arr) => arr.sort(sortFn));
    parents.sort(sortFn);
    standalone.sort(sortFn);

    // Filtrera: en familj visas om föräldern matchar eller något barn matchar.
    const visibleFamilies = parents
      .map((parent) => {
        const children = childrenByParent.get(parent.id) || [];
        if (matches(parent)) return { parent, children };
        const matchingChildren = children.filter(matches);
        if (matchingChildren.length > 0) return { parent, children: matchingChildren };
        return null;
      })
      .filter((x): x is { parent: MetadataKatalog; children: MetadataKatalog[] } => x !== null);

    const visibleStandalone = standalone.filter(matches);

    return { visibleFamilies, visibleStandalone };
  }, [metadataTypes, search]);

  const mutating = createMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Metadata per ordertyp"
        description="Koppla metadatafält eller familjer till en ordertyp. Kopplade fält visas automatiskt i orderformuläret för ordrar av den typen."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" />
            Välj ordertyp
          </CardTitle>
          <CardDescription>
            Välj en känd ordertyp eller skriv in en egen. Ordertypen motsvarar arbetsorderns typ.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="order-type-select">Ordertyp</Label>
              <Select
                value={selectedOrderType}
                onValueChange={(v) => {
                  setSelectedOrderType(v);
                  if (v !== ALL_ORDER_TYPES_PLACEHOLDER) setCustomOrderType("");
                }}
              >
                <SelectTrigger id="order-type-select" data-testid="select-order-type">
                  <SelectValue placeholder={orderTypesLoading ? "Laddar..." : "Välj ordertyp..."} />
                </SelectTrigger>
                <SelectContent>
                  {(orderTypes || []).map((ot) => (
                    <SelectItem key={ot} value={ot} data-testid={`option-order-type-${ot}`}>
                      {ot}
                    </SelectItem>
                  ))}
                  <SelectItem value={ALL_ORDER_TYPES_PLACEHOLDER} data-testid="option-order-type-custom">
                    Egen ordertyp...
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {selectedOrderType === ALL_ORDER_TYPES_PLACEHOLDER && (
              <div className="space-y-2">
                <Label htmlFor="custom-order-type">Egen ordertyp</Label>
                <Input
                  id="custom-order-type"
                  placeholder="t.ex. besiktning"
                  value={customOrderType}
                  onChange={(e) => setCustomOrderType(e.target.value)}
                  data-testid="input-custom-order-type"
                />
              </div>
            )}
          </div>
          {effectiveOrderType && (
            <div className="text-sm text-muted-foreground" data-testid="text-selected-order-type">
              Redigerar kopplingar för ordertyp:{" "}
              <Badge variant="secondary">{effectiveOrderType}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {effectiveOrderType && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tillgängliga metadatafält</CardTitle>
            <CardDescription>
              Bocka i fält eller familjer att koppla till ordertypen. En familj expanderas till
              sina underfält i orderformuläret.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Sök fält..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-fields"
              />
            </div>

            {typesLoading || linksLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                {grouped.visibleFamilies.length === 0 && grouped.visibleStandalone.length === 0 && (
                  <div className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-fields">
                    Inga metadatafält matchar sökningen.
                  </div>
                )}

                {grouped.visibleFamilies.map(({ parent, children }) => (
                  <div key={parent.id} className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span>{parent.namn}</span>
                      <span className="text-xs text-muted-foreground">(familj)</span>
                    </div>
                    <div className="pl-6 space-y-1">
                      <FieldRow
                        field={parent}
                        checked={linkedIds.has(parent.id)}
                        disabled={mutating}
                        onToggle={() => toggleLink(parent.id)}
                        isFamilyParent
                      />
                      {children.map((child) => (
                        <FieldRow
                          key={child.id}
                          field={child}
                          checked={linkedIds.has(child.id)}
                          disabled={mutating}
                          onToggle={() => toggleLink(child.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {grouped.visibleStandalone.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      <span>Fristående fält</span>
                    </div>
                    <div className="space-y-1">
                      {grouped.visibleStandalone.map((field) => (
                        <FieldRow
                          key={field.id}
                          field={field}
                          checked={linkedIds.has(field.id)}
                          disabled={mutating}
                          onToggle={() => toggleLink(field.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FieldRow({
  field,
  checked,
  disabled,
  onToggle,
  isFamilyParent,
}: {
  field: MetadataKatalog;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  isFamilyParent?: boolean;
}) {
  return (
    <label
      className="flex items-center gap-3 rounded-md border px-3 py-2 hover-elevate cursor-pointer"
      data-testid={`field-row-${field.id}`}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
        data-testid={`checkbox-field-${field.id}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{field.namn}</span>
          {field.beteckning && (
            <Badge variant="outline" className="text-[10px]">
              {field.beteckning}
            </Badge>
          )}
          {isFamilyParent && (
            <Badge variant="secondary" className="text-[10px]">
              hela familjen
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{field.datatyp}</span>
        </div>
        {field.beskrivning && (
          <div className="text-xs text-muted-foreground truncate">{field.beskrivning}</div>
        )}
      </div>
    </label>
  );
}
