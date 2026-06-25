/**
 * What3words-resolvering (Task #1118).
 *
 * Fristående klient mot What3words `convert-to-coordinates`-API:t. Anropas ENBART
 * via map-provider-abstraktionen (`getMapProvider().convertWhat3words()`) så att
 * rutt/navigation har en enda ingång — återinför aldrig ad-hoc fetch här utanför.
 *
 * Resolveringen är frivillig: utan `WHAT3WORDS_API_KEY` returnerar
 * `convertWhat3wordsToCoordinates()` alltid `null` och `isWhat3wordsResolutionAvailable()`
 * är `false`. Format-validering sker separat i `shared/what3words.ts` och kräver
 * ingen nyckel.
 */

import { normalizeWhat3words } from "@shared/what3words";

const W3W_API_BASE = "https://api.what3words.com/v3";

export interface What3wordsCoordinates {
  lat: number;
  lng: number;
  /** Närmaste namngivna plats enligt W3W (t.ex. "Stockholm"). */
  nearestPlace?: string;
  /** ISO-landskod (t.ex. "SE"). */
  country?: string;
}

/** True om en What3words-API-nyckel är konfigurerad. */
export function isWhat3wordsResolutionAvailable(): boolean {
  return Boolean(process.env.WHAT3WORDS_API_KEY);
}

/**
 * Resolvar en three-word-adress till lat/lng via What3words-API:t.
 * Returnerar `null` om nyckel saknas, adressen inte hittas eller anropet failar.
 */
export async function convertWhat3wordsToCoordinates(
  words: string,
): Promise<What3wordsCoordinates | null> {
  const apiKey = process.env.WHAT3WORDS_API_KEY;
  if (!apiKey) return null;

  const normalized = normalizeWhat3words(words);
  if (!normalized) return null;

  const url = `${W3W_API_BASE}/convert-to-coordinates?words=${encodeURIComponent(
    normalized,
  )}&key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const data: any = await res.json().catch(() => null);

    if (!res.ok || !data || data.error) {
      const reason = data?.error?.message || data?.error?.code || `HTTP ${res.status}`;
      console.warn(`[what3words] Kunde inte resolva "${normalized}": ${reason}`);
      return null;
    }

    const coords = data.coordinates;
    if (
      !coords ||
      typeof coords.lat !== "number" ||
      typeof coords.lng !== "number"
    ) {
      return null;
    }

    return {
      lat: coords.lat,
      lng: coords.lng,
      nearestPlace: typeof data.nearestPlace === "string" ? data.nearestPlace : undefined,
      country: typeof data.country === "string" ? data.country : undefined,
    };
  } catch (err) {
    console.warn(
      `[what3words] Resolvering av "${normalized}" failade:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
