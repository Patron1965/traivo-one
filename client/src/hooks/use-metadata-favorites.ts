import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const FAVORITES_KEY = ["/api/metadata/favorites"] as const;

/**
 * Favoritmarkerade metadatatyper i typ-väljaren ("Lägg till metadata").
 * Persisteras server-side per användare + tenant som en lista av
 * metadata_katalog.namn (matchningsnyckeln). Optimistisk uppdatering med
 * invalidate vid fel.
 */
export function useMetadataFavorites() {
  const queryClient = useQueryClient();

  const { data } = useQuery<{ favorites: string[] }>({
    queryKey: [...FAVORITES_KEY],
    staleTime: 60_000,
  });

  const favorites = useMemo(
    () => (Array.isArray(data?.favorites) ? data!.favorites : []),
    [data],
  );
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const mutation = useMutation({
    mutationFn: async (next: string[]) => {
      await apiRequest("PUT", "/api/metadata/favorites", { favorites: next });
      return next;
    },
    onMutate: async (next: string[]) => {
      await queryClient.cancelQueries({ queryKey: [...FAVORITES_KEY] });
      queryClient.setQueryData([...FAVORITES_KEY], { favorites: next });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: [...FAVORITES_KEY] });
    },
  });

  const toggleFavorite = (namn: string) => {
    const next = favoriteSet.has(namn)
      ? favorites.filter((n) => n !== namn)
      : [...favorites, namn];
    mutation.mutate(next);
  };

  return { favorites, favoriteSet, toggleFavorite };
}
