import { useQuery } from "@tanstack/react-query";

interface MapConfig {
  tileUrl: string;
  attribution: string;
}

const FALLBACK: MapConfig = {
  tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};

export function useMapConfig(): MapConfig {
  const { data } = useQuery<MapConfig>({
    queryKey: ["/api/system/map-config"],
    staleTime: Infinity,
  });
  return data ?? FALLBACK;
}
