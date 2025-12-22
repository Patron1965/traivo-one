export interface WeatherForecast {
  date: string;
  temperature: number;
  precipitation: number;
  windSpeed: number;
  weatherCode: number;
  weatherDescription: string;
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
    reasons.push("Mycket kraftig nederbörd");
    recommendations.push("Överväg att skjuta upp icke-akuta ordrar");
    recommendations.push("Prioritera inomhusarbeten");
  } else if (forecast.precipitation > 10) {
    impactLevel = "high";
    capacityMultiplier = 0.7;
    reasons.push("Kraftig nederbörd");
    recommendations.push("Planera för längre ställtider");
    recommendations.push("Ta med extra regnskydd");
  } else if (forecast.precipitation > 5) {
    impactLevel = "medium";
    capacityMultiplier = 0.85;
    reasons.push("Måttlig nederbörd");
    recommendations.push("Förläng tidsuppskattningar med 15%");
  } else if (forecast.precipitation > 1) {
    impactLevel = "low";
    capacityMultiplier = 0.95;
    reasons.push("Lätt nederbörd");
  }

  if (forecast.windSpeed > 15) {
    if (impactLevel === "none" || impactLevel === "low") {
      impactLevel = "high";
      capacityMultiplier = Math.min(capacityMultiplier, 0.7);
    }
    reasons.push("Kraftig vind");
    recommendations.push("Undvik arbete på höjd");
    recommendations.push("Säkra lösa material");
  } else if (forecast.windSpeed > 10) {
    if (impactLevel === "none") {
      impactLevel = "low";
      capacityMultiplier = Math.min(capacityMultiplier, 0.9);
    }
    reasons.push("Blåsigt");
  }

  if (forecast.temperature < -10) {
    if (impactLevel === "none" || impactLevel === "low") {
      impactLevel = "medium";
      capacityMultiplier = Math.min(capacityMultiplier, 0.8);
    }
    reasons.push("Extrem kyla");
    recommendations.push("Planera för uppvärmning av fordon");
    recommendations.push("Kortare arbetspass utomhus");
  } else if (forecast.temperature < 0) {
    reasons.push("Frostgradigt");
    recommendations.push("Kontrollera halkrisker");
  } else if (forecast.temperature > 30) {
    if (impactLevel === "none") {
      impactLevel = "low";
      capacityMultiplier = Math.min(capacityMultiplier, 0.9);
    }
    reasons.push("Extrem värme");
    recommendations.push("Planera fler pauser");
    recommendations.push("Se till att personal har vatten");
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

export async function fetchWeatherForecast(
  latitude: number,
  longitude: number,
  days: number = 7
): Promise<WeatherForecastResult> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code&timezone=Europe/Stockholm&forecast_days=${Math.min(days, 16)}`;

    const response = await fetch(url);
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

    return {
      location: { latitude, longitude },
      forecasts,
      impacts,
      summary,
    };
  } catch (error) {
    console.error("Weather fetch error:", error);
    return {
      location: { latitude, longitude },
      forecasts: [],
      impacts: [],
      summary: "Kunde inte hämta väderprognos. Kontrollera internetanslutning.",
    };
  }
}

export function getCapacityAdjustmentForDate(impacts: WeatherImpact[], date: string): number {
  const impact = impacts.find(i => i.date === date);
  return impact?.capacityMultiplier ?? 1.0;
}
