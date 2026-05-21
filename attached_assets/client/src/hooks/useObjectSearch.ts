import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ServiceObject } from "@shared/schema";

interface UseObjectSearchOptions {
  enabled?: boolean;
  selectedIds?: string[];
  customerId?: string;
  limit?: number;
  debounceMs?: number;
}

interface UseObjectSearchResult {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  searchResults: ServiceObject[];
  selectedObjects: ServiceObject[];
  displayObjects: ServiceObject[];
  objectMap: Map<string, ServiceObject>;
  isLoading: boolean;
  isSearching: boolean;
}

export function useObjectSearch({
  enabled = true,
  selectedIds = [],
  customerId,
  limit = 50,
  debounceMs = 300,
}: UseObjectSearchOptions = {}): UseObjectSearchResult {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [searchTerm, debounceMs]);

  const { data: searchResults = [], isLoading: isSearching } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects/search", debouncedSearch, customerId, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (customerId) params.set("customerId", customerId);
      const res = await fetch(`/api/objects?${params}`);
      return res.json();
    },
    enabled: enabled && debouncedSearch.length > 0,
    staleTime: 30000,
  });

  const { data: selectedObjects = [], isLoading: isLoadingSelected } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects/selected", selectedIds.join(",")],
    queryFn: async () => {
      if (selectedIds.length === 0) return [];
      const params = new URLSearchParams();
      params.set("ids", selectedIds.join(","));
      const res = await fetch(`/api/objects?${params}`);
      return res.json();
    },
    enabled: enabled && selectedIds.length > 0,
    staleTime: 60000,
  });

  const displayObjects = useMemo(() => {
    const combined = new Map<string, ServiceObject>();
    selectedObjects.forEach(o => combined.set(o.id, o));
    searchResults.forEach(o => combined.set(o.id, o));
    return Array.from(combined.values());
  }, [selectedObjects, searchResults]);

  const objectMap = useMemo(() => {
    const map = new Map<string, ServiceObject>();
    selectedObjects.forEach(o => map.set(o.id, o));
    searchResults.forEach(o => map.set(o.id, o));
    return map;
  }, [selectedObjects, searchResults]);

  return {
    searchTerm,
    setSearchTerm,
    searchResults,
    selectedObjects,
    displayObjects,
    objectMap,
    isLoading: isLoadingSelected,
    isSearching,
  };
}

export function useObjectsByIds(objectIds: string[], enabled = true) {
  const uniqueIds = Array.from(new Set(objectIds));
  return useQuery<ServiceObject[]>({
    queryKey: ["/api/objects/byIds", uniqueIds.join(",")],
    queryFn: async () => {
      if (uniqueIds.length === 0) return [];
      const params = new URLSearchParams();
      params.set("ids", uniqueIds.join(","));
      const res = await fetch(`/api/objects?${params}`);
      return res.json();
    },
    enabled: enabled && uniqueIds.length > 0,
    staleTime: 60000,
  });
}
