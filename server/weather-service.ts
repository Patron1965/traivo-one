import { trackApiUsage } from "./api-usage-tracker";

export interface WeatherForecast {
  date: string;
  temperature: number;
  precipitation: number;
  windSpeed: number;
  weatherCode: number;
  weatherDescription: string;
}

interface WeatherCache {
  result: WeatherForecastResult;
  timestamp: number;
}

const weatherCache = new Map<string, WeatherCache>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const ERROR_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for failed requests

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500; // 1.5 seconds between requests

function getCacheKey(latitude: number, longitude: number, days: number): string {
  return `${latitude.toFixed(2)}_${longitude.toFixed(2)}_${days}`;
}

export interface WeatherImpact {
  date: string;
  impactLevel: "none" | "low" | "medium" | "high" | "severe";
  capacityMultiplier: number;
  reason: string;
  recommendations: string[];
}

export interface WeatherForecastResult {
  location: { latitude: number; longitude: number; name?: string };
  forecasts: WeatherForecast[];
  impacts: WeatherImpact[];
  summary: string;
}

const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: "Klart",
  1: "Mestadels klart",
  2: "Delvis molnigt",
  3: "Molnigt",
  45: "Dimma",
  48: "Rimfrost",
  51: "Lätt duggregn",
  53: "Måttligt duggregn",
  55: "Kraftigt duggregn",
  56: "Lätt underkylt regn",
  57: "Kraftigt underkylt regn",
  61: "Lätt regn",
  63: "Måttligt regn",
  65: "Kraftigt regn",
  66: "Lätt underkylt regn",
  67: "Kraftigt underkylt regn",
  71: "Lätt snöfall",
  73: "Måttligt snöfall",
  75: "Kraftigt snöfall",
  77: "Snökorn",
  80: "Lätta regnskurar",
  81: "Måttliga regnskurar",
  82: "Kraftiga regnskurar",
  85: "Lätta snöbyar",
  86: "Kraftiga snöbyar",
  95: "Åska",
  96: "Åska med lätt hagel",
  99: "Åska med kraftigt hagel",
};

function getWeatherDescription(code: number): string {
  return WEATHER_CODE_DESCRIPTIONS[code] || `Väder kod ${code}`;
}

function calculateWeatherImpact(forecast: WeatherForecast): WeatherImpact {
  let impactLevel: WeatherImpact["impactLevel"] = "none";
  let capacityMultiplier = 1.0;
  const reasons: string[] = [];
  const recommendations: string[] = [];

  if (forecast.precipitation > 20) {
    impactLevel = "severe";
    capacityMultiplier = 0.5;
    reasons.push("Kraftigt regn");
    recommendations.push("Prioritera inomhusuppgifter");
    recommendations.push("Överväg att skjuta upp utomhusarbeten");
  } else if (forecast.precipitation > 10) {
    impactLevel = "high";
    capacityMultiplier = 0.7;
    reasons.push("Regn");
    recommendations.push("Planera för längre körtider");
  } else if (forecast.precipitation > 5) {
    impactLevel = "medium";
    capacityMultiplier = 0.85;
    reasons.push("Lätt regn");
    recommendations.push("Normal planering med viss marginal");
  } else if (forecast.precipitation > 2) {
    impactLevel = "low";
    capacityMultiplier = 0.95;
    reasons.push("Duggregn");
  }

  if (forecast.windSpeed > 60) {
    impactLevel = "severe";
    capacityMultiplier = Math.min(capacityMultiplier, 0.4);
    reasons.push("Storm");
    recommendations.push("Avvakta med utomhusarbete");
  } else if (forecast.windSpeed > 40) {
    if (impactLevel !== "severe") {
      impactLevel = "high";
      capacityMultiplier = Math.min(capacityMultiplier, 0.6);
    }
    reasons.push("Hård vind");
    recommendations.push("Undvik höghöjdsarbete");
  } else if (forecast.windSpeed > 25) {
    if (impactLevel === "none" || impactLevel === "low") {
      impactLevel = "medium";
      capacityMultiplier = Math.min(capacityMultiplier, 0.8);
    }
    reasons.push("Blåsigt");
  }

  if (forecast.temperature < -15) {
    impactLevel = "severe";
    capacityMultiplier = Math.min(capacityMultiplier, 0.5);
    reasons.push("Extrem kyla");
    recommendations.push("Begränsa utomhusvistelse");
    recommendations.push("Kontrollera fordonsstarter");
  } else if (forecast.temperature < -5) {
    if (impactLevel === "none" || impactLevel === "low") {
      impactLevel = "medium";
      capacityMultiplier = Math.min(capacityMultiplier, 0.8);
    }
    reasons.push("Kyla");
    recommendations.push("Extra uppvärmningstid för fordon");
  }

  if ([71, 73, 75, 85, 86].includes(forecast.weatherCode)) {
    if (impactLevel !== "severe") {
      impactLevel = "high";
      capacityMultiplier = Math.min(capacityMultiplier, 0.6);
    }
    reasons.push("Snöfall");
    recommendations.push("Kontrollera framkomlighet");
    recommendations.push("Förläng körtider");
  }

  if ([95, 96, 99].includes(forecast.weatherCode)) {
    impactLevel = "severe";
    capacityMultiplier = 0.4;
    reasons.push("Åskoväder");
    recommendations.push("Avvakta med utomhusarbete under åska");
  }

  return {
    date: forecast.date,
    impactLevel,
    capacityMultiplier,
    reason: reasons.length > 0 ? reasons.join(", ") : "Normala förhållanden",
    recommendations,
  };
}

async function fetchWithRateLimit(url: string): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
  return fetch(url);
}

export async function fetchWeatherForecast(
  latitude: number,
  longitude: number,
  days: number = 7
): Promise<WeatherForecastResult> {
  const cacheKey = getCacheKey(latitude, longitude, days);
  const cached = weatherCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.result;
  }

  if (cached && cached.result.forecasts.length === 0 && Date.now() - cached.timestamp < ERROR_CACHE_TTL) {
    return cached.result;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code&timezone=Europe/Stockholm&forecast_days=${Math.min(days, 16)}`;

    const startTime = Date.now();
    const response = await fetchWithRateLimit(url);
    trackApiUsage({
      service: "open-meteo",
      method: "forecast",
      endpoint: "/v1/forecast",
      units: 1,
      statusCode: response.status,
      durationMs: Date.now() - startTime,
    });

    if (response.status === 429) {
      console.warn("[weather] Rate limited by Open-Meteo API, using cached data if available");
      if (cached) {
        cached.timestamp = Date.now() - CACHE_TTL + ERROR_CACHE_TTL;
        return cached.result;
      }
      const errorResult: WeatherForecastResult = {
        location: { latitude, longitude },
        forecasts: [],
        impacts: [],
        summary: "Väder-API:et är tillfälligt överbelastat. Försök igen om några minuter.",
      };
      weatherCache.set(cacheKey, { result: errorResult, timestamp: Date.now() });
      return errorResult;
    }

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.daily || !data.daily.time) {
      throw new Error("Invalid weather data format");
    }

    const forecasts: WeatherForecast[] = data.daily.time.map((date: string, i: number) => ({
      date,
      temperature: (data.daily.temperature_2m_max[i] + data.daily.temperature_2m_min[i]) / 2,
      precipitation: data.daily.precipitation_sum[i] || 0,
      windSpeed: data.daily.wind_speed_10m_max[i] || 0,
      weatherCode: data.daily.weather_code[i] || 0,
      weatherDescription: getWeatherDescription(data.daily.weather_code[i] || 0),
    }));

    const impacts = forecasts.map(calculateWeatherImpact);

    const severeCount = impacts.filter(i => i.impactLevel === "severe" || i.impactLevel === "high").length;
    const summary = severeCount > 0
      ? `Väderavvikelser förväntas ${severeCount} av ${impacts.length} dagar. Planera kapacitet därefter.`
      : "Normala väderförhållanden förväntas. Inga justeringar behövs.";

    const result: WeatherForecastResult = {
      location: { latitude, longitude },
      forecasts,
      impacts,
      summary,
    };

    weatherCache.set(cacheKey, { result, timestamp: Date.now() });

    return result;
  } catch (error) {
    console.error("Weather fetch error:", error);
    if (cached && cached.result.forecasts.length > 0) {
      console.log("[weather] Using stale cache after fetch error");
      cached.timestamp = Date.now() - CACHE_TTL + ERROR_CACHE_TTL;
      return cached.result;
    }
    const errorResult: WeatherForecastResult = {
      location: { latitude, longitude },
      forecasts: [],
      impacts: [],
      summary: "Kunde inte hämta väderprognos just nu. Försök igen om en stund.",
    };
    weatherCache.set(cacheKey, { result: errorResult, timestamp: Date.now() });
    return errorResult;
  }
}

export function getCapacityAdjustmentForDate(impacts: WeatherImpact[], date: string): number {
  const impact = impacts.find(i => i.date === date);
  return impact?.capacityMultiplier ?? 1.0;
}
