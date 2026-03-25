import { apiRequest } from './query-client';

export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const AVG_SPEED_KMH = 40;

export function estimateTravelMinutes(
  fromLat: number | null | undefined,
  fromLon: number | null | undefined,
  toLat: number | null | undefined,
  toLon: number | null | undefined
): number | null {
  if (fromLat == null || fromLon == null || toLat == null || toLon == null) return null;
  if (fromLat === 0 && fromLon === 0) return null;
  const distKm = haversineDistance(fromLat, fromLon, toLat, toLon);
  if (distKm < 0.1) return 1;
  return Math.round((distKm / AVG_SPEED_KMH) * 60);
}

export function formatTravelTime(minutes: number | null): string | null {
  if (minutes == null) return null;
  if (minutes < 1) return '< 1 min';
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `~${h}h ${m}min` : `~${h}h`;
  }
  return `~${minutes} min`;
}

export interface DistanceResult {
  distanceKm: number;
  durationMin: number;
  source: 'geoapify' | 'haversine';
}

export async function fetchDrivingDistance(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): Promise<DistanceResult> {
  try {
    return await apiRequest('POST', '/api/mobile/distance', {
      fromLat, fromLng, toLat, toLng,
    });
  } catch {
    const distKm = haversineDistance(fromLat, fromLng, toLat, toLng);
    return {
      distanceKm: Math.round(distKm * 10) / 10,
      durationMin: Math.max(1, Math.round((distKm / AVG_SPEED_KMH) * 60)),
      source: 'haversine',
    };
  }
}
