import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Search, ChevronRight, ChevronDown, Building2, Clock, Users, Loader2 } from "lucide-react";
import type { Customer, ObjectTimeRestriction, CustomerMode } from "@shared/schema";

interface AggregatedSlotPreference extends ObjectTimeRestriction {
  objectName: string;
}

interface LazyTreeNode {
  id: string;
  name: string;
  objectNumber?: string | null;
  objectType?: string | null;
  address?: string | null;
  customerId?: string;
  customerName?: string | null;
  childCount: number;
  children: LazyTreeNode[];
}

interface FlatRow {
  node: LazyTreeNode;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  isLoading: boolean;
}

interface Step1Props {
  selectedObjectIds: Set<string>;
  onToggleObject: (id: string) => void;
  onToggleAll: (ids: string[], selected: boolean) => void;
  selectedCustomerId: string | null;
  onSelectCustomer: (id: string | null) => void;
  customerMode: CustomerMode;
  onCustomerModeChange: (mode: CustomerMode) => void;
}

export default function Step1ObjectSelection({
  selectedObjectIds,
  onToggleObject,
  onToggleAll,
  selectedCustomerId,
  onSelectCustomer,
  customerMode,
  onCustomerModeChange,
}: Step1Props) {
  const [customerSearch, setCustomerSearch] = useState("");
  const [objectSearch, setObjectSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [childrenCache, setChildrenCache] = useState<Map<string, LazyTreeNode[]>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(objectSearch), 300);
    return () => clearTimeout(timer);
  }, [objectSearch]);

  useEffect(() => {
    setExpandedIds(new Set());
    setChildrenCache(new Map());
  }, [selectedCustomerId, customerMode]);

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const isSearching = debouncedSearch.trim().length > 0;
  const effectiveCustomerId = customerMode === "FROM_METADATA" ? null : selectedCustomerId;

  const { data: rootNodes = [], isLoading: treeLoading } = useQuery<LazyTreeNode[]>({
    queryKey: ["/api/objects/tree", "roots", effectiveCustomerId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (effectiveCustomerId) params.set("customerId", effectiveCustomerId);
      const res = await fetch(`/api/objects/tree?${params}`);
      if (!res.ok) throw new Error("Failed to fetch tree");
      return res.json();
    },
    enabled: !isSearching,
  });

  const { data: searchResults = [], isLoading: searchLoading } = useQuery<LazyTreeNode[]>({
    queryKey: ["/api/objects/tree", "search", debouncedSearch],
    queryFn: async () => {
      const res = await fetch(`/api/objects/tree?search=${encodeURIComponent(debouncedSearch.trim())}`);
      if (!res.ok) throw new Error("Failed to search objects");
      return res.json();
    },
    enabled: isSearching,
  });

  const loadChildren = useCallback(async (parentId: string): Promise<LazyTreeNode[]> => {
    if (childrenCache.has(parentId)) return childrenCache.get(parentId)!;
    if (loadingIds.has(parentId)) return [];
    setLoadingIds(prev => new Set(prev).add(parentId));
    try {
      const params = new URLSearchParams({ parentId });
      if (effectiveCustomerId) params.set("customerId", effectiveCustomerId);
      const res = await fetch(`/api/objects/tree?${params}`);
      if (res.ok) {
        const children: LazyTreeNode[] = await res.json();
        setChildrenCache(prev => new Map(prev).set(parentId, children));
        return children;
      }
      return [];
    } finally {
      setLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
  }, [childrenCache, loadingIds, effectiveCustomerId]);

  const toggleExpand = useCallback((nodeId: string, hasChildren: boolean) => {
    if (!hasChildren) return;
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
        loadChildren(nodeId);
      }
      return next;
    });
  }, [loadChildren]);

  const flatRows = useMemo((): FlatRow[] => {
    if (isSearching) return [];
    const rows: FlatRow[] = [];
    function flatten(nodes: LazyTreeNode[], depth: number) {
      for (const node of nodes) {
        const hasChildren = node.childCount > 0;
        const isExpanded = expandedIds.has(node.id);
        const isLoading2 = loadingIds.has(node.id);
        rows.push({ node, depth, isExpanded, hasChildren, isLoading: isLoading2 });
        if (isExpanded && hasChildren) {
          const cached = childrenCache.get(node.id);
          if (cached) {
            flatten(cached, depth + 1);
          }
        }
      }
    }
    flatten(rootNodes, 0);
    return rows;
  }, [rootNodes, expandedIds, childrenCache, loadingIds, isSearching]);

  const collectDescendantIds = useCallback((nodeId: string, cacheOverride?: Map<string, LazyTreeNode[]>): string[] => {
    const cache = cacheOverride || childrenCache;
    const ids = [nodeId];
    const children = cache.get(nodeId);
    if (children) {
      for (const child of children) {
        ids.push(...collectDescendantIds(child.id, cache));
      }
    }
    return ids;
  }, [childrenCache]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers.slice(0, 20);
    const q = customerSearch.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.customerNumber && c.customerNumber.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [customers, customerSearch]);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  const loading = isSearching ? searchLoading : treeLoading;

  const selectedIdsArray = useMemo(() => Array.from(selectedObjectIds), [selectedObjectIds]);

  const { data: slotPreferences = [] } = useQuery<AggregatedSlotPreference[]>({
    queryKey: ["/api/slot-preferences/aggregate", selectedIdsArray.join(",")],
    queryFn: async () => {
      if (selectedIdsArray.length === 0) return [];
      const res = await fetch(`/api/slot-preferences/aggregate?objectIds=${selectedIdsArray.join(",")}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: selectedIdsArray.length > 0,
  });

  const WEEKDAY_SHORT = [
    { value: 1, label: "Mån" },
    { value: 2, label: "Tis" },
    { value: 3, label: "Ons" },
    { value: 4, label: "Tor" },
    { value: 5, label: "Fre" },
    { value: 6, label: "Lör" },
    { value: 0, label: "Sön" },
  ];

  return (
    <div className="space-y-4" data-testid="step1-object-selection">
      <div className="border rounded-md p-3 space-y-2" data-testid="customer-mode-section">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <Label className="text-sm font-medium">Kundidentifiering</Label>
        </div>
        <Select value={customerMode} onValueChange={(v) => onCustomerModeChange(v as CustomerMode)}>
          <SelectTrigger className="w-full" data-testid="select-customer-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="HARDCODED">Hårdkodad kund — samma kund för alla objekt</SelectItem>
            <SelectItem value="FROM_METADATA">Från metadata — hämta kund från varje objekts data</SelectItem>
          </SelectContent>
        </Select>
        {customerMode === "FROM_METADATA" && (
          <p className="text-xs text-muted-foreground">
            Systemet hämtar kundkoppling direkt från varje objekt. Objekt som saknar kundkoppling markeras med varning i steg 2.
          </p>
        )}
      </div>

      {customerMode === "HARDCODED" && (
      <div>
        <label className="text-sm font-medium mb-1 block">Sök kund</label>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök kund efter namn eller kundnummer..."
            value={customerSearch}
            onChange={e => setCustomerSearch(e.target.value)}
            className="pl-9"
            data-testid="input-customer-search"
          />
        </div>
        {customerSearch && filteredCustomers.length > 0 && !selectedCustomerId && (
          <div className="border rounded-md mt-1 max-h-48 overflow-y-auto bg-popover">
            {filteredCustomers.map(c => (
              <button
                key={c.id}
                className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center gap-2"
                onClick={() => {
                  onSelectCustomer(c.id);
                  setCustomerSearch("");
                }}
                data-testid={`customer-option-${c.id}`}
              >
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span>{c.name}</span>
                {c.customerNumber && (
                  <span className="text-xs text-muted-foreground">({c.customerNumber})</span>
                )}
              </button>
            ))}
          </div>
        )}
        {selectedCustomer && (
          <div className="mt-2 flex items-center gap-2 p-2 bg-accent/50 rounded-md">
            <Building2 className="h-4 w-4" />
            <span className="text-sm font-medium">{selectedCustomer.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSelectCustomer(null)}
              className="ml-auto h-6 px-2 text-xs"
              data-testid="button-clear-customer"
            >
              Rensa
            </Button>
          </div>
        )}
      </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium">Objekthierarki</label>
          <span className="text-xs text-muted-foreground" data-testid="text-selected-count">
            {selectedObjectIds.size} objekt valda
          </span>
        </div>
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök objekt bland alla kunder..."
            value={objectSearch}
            onChange={e => setObjectSearch(e.target.value)}
            className="pl-9"
            data-testid="input-object-filter"
          />
        </div>
        {isSearching && (
          <p className="text-xs text-muted-foreground mb-1" data-testid="text-search-hint">
            Söker bland alla kunder — {searchResults.length} träffar
          </p>
        )}
        <div className="h-[400px] border rounded-md p-2 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Laddar objekt...
            </div>
          ) : isSearching ? (
            searchResults.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Inga objekt hittades
              </div>
            ) : (
              searchResults.map(node => (
                <div key={node.id} className="flex items-center gap-2 py-1.5 px-2 hover:bg-accent/50 rounded" data-testid={`search-result-${node.id}`}>
                  <Checkbox
                    checked={selectedObjectIds.has(node.id)}
                    onCheckedChange={() => onToggleObject(node.id)}
                    data-testid={`search-checkbox-${node.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{node.name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {node.customerName && (
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {node.customerName}
                        </span>
                      )}
                      {node.address && <span className="truncate">{node.address}</span>}
                    </div>
                  </div>
                  {node.objectType && (
                    <span className="text-xs text-muted-foreground shrink-0">{node.objectType}</span>
                  )}
                </div>
              ))
            )
          ) : flatRows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Inga objekt hittades
            </div>
          ) : (
            flatRows.map(({ node, depth, isExpanded, hasChildren, isLoading: rowLoading }) => {
              const isSelected = selectedObjectIds.has(node.id);
              const descendantIds = collectDescendantIds(node.id);
              const allSelected = descendantIds.every(id => selectedObjectIds.has(id));
              const someSelected = !allSelected && descendantIds.some(id => selectedObjectIds.has(id));

              return (
                <div key={node.id} style={{ paddingLeft: depth * 16 }}>
                  <div className="flex items-center gap-1 py-1 hover:bg-accent/50 rounded px-1 group" data-testid={`tree-node-${node.id}`}>
                    {hasChildren ? (
                      <button
                        onClick={() => toggleExpand(node.id, hasChildren)}
                        className="p-0.5 rounded hover:bg-accent"
                        data-testid={`tree-expand-${node.id}`}
                      >
                        {rowLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="w-5" />
                    )}
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={async () => {
                        if (hasChildren) {
                          let freshCache = childrenCache;
                          if (!childrenCache.has(node.id)) {
                            const loaded = await loadChildren(node.id);
                            freshCache = new Map(childrenCache).set(node.id, loaded);
                          }
                          const freshIds = collectDescendantIds(node.id, freshCache);
                          onToggleAll(freshIds, !allSelected);
                        } else {
                          onToggleObject(node.id);
                        }
                      }}
                      data-testid={`tree-checkbox-${node.id}`}
                    />
                    <span className="text-sm truncate flex-1">{node.name}</span>
                    {hasChildren && (
                      <Badge variant="secondary" className="text-[10px] h-4 px-1">
                        {node.childCount}
                      </Badge>
                    )}
                    {node.objectType && (
                      <span className="text-xs text-muted-foreground">{node.objectType}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {selectedObjectIds.size > 0 && slotPreferences.length > 0 && (
        <div className="border rounded-md p-3" data-testid="aggregated-slot-preferences">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Samlade tidsregler för valda objekt</span>
            <Badge variant="secondary" className="text-xs">{slotPreferences.length}</Badge>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAY_SHORT.map(day => (
              <div key={day.value} className="text-center">
                <div className="text-[10px] font-medium mb-0.5">{day.label}</div>
                {(() => {
                  const daySlots = slotPreferences.filter((s) =>
                    s.weekdays && Array.isArray(s.weekdays) && s.weekdays.includes(day.value)
                  );
                  const favorable = daySlots.filter((s) => s.preference === "favorable");
                  const unfavorable = daySlots.filter((s) => s.preference !== "favorable");
                  if (daySlots.length === 0) {
                    return <div className="h-8 rounded border border-dashed border-muted-foreground/20 flex items-center justify-center text-[9px] text-muted-foreground">—</div>;
                  }
                  return (
                    <div className="space-y-0.5">
                      {favorable.length > 0 && (
                        <div className="bg-green-100 dark:bg-green-900/40 border border-green-300 dark:border-green-700 rounded px-0.5 py-0.5">
                          <div className="text-[9px] font-medium text-green-800 dark:text-green-300">{favorable.length}</div>
                        </div>
                      )}
                      {unfavorable.length > 0 && (
                        <div className="bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 rounded px-0.5 py-0.5">
                          <div className="text-[9px] font-medium text-red-800 dark:text-red-300">{unfavorable.length}</div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {slotPreferences.map((sp) => (
              <div key={sp.id} className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${sp.preference === "favorable" ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"}`} data-testid={`agg-slot-${sp.id}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${sp.preference === "favorable" ? "bg-green-500" : "bg-red-500"}`} />
                <span className="font-medium truncate">{sp.objectName}</span>
                {sp.reason && <span className="text-muted-foreground truncate italic">{sp.reason}</span>}
                {sp.startTime && <span className="text-muted-foreground">{sp.startTime}{sp.endTime ? `–${sp.endTime}` : ""}</span>}
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-2">
            <div className="flex items-center gap-1 text-[10px]">
              <span className="w-2 h-2 rounded-full bg-green-500" /> Fördelaktig
            </div>
            <div className="flex items-center gap-1 text-[10px]">
              <span className="w-2 h-2 rounded-full bg-red-500" /> Ofördelaktig
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
