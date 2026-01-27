import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Cloud, CloudRain, Sun, Wind, Snowflake, AlertTriangle, Thermometer, Droplets, Zap } from "lucide-react";
import { format, parseISO } from "date-fns";
import { sv } from "date-fns/locale";
import type { Cluster } from "@shared/schema";

interface WeatherForecast {
  date: string;
  temperature: number;
  precipitation: number;
  windSpeed: number;
  weatherCode: number;
  weatherDescription: string;
}

interface WeatherImpact {
  date: string;
  impactLevel: "none" | "low" | "medium" | "high" | "severe";
  capacityMultiplier: number;
  reason: string;
  recommendations: string[];
}

interface WeatherForecastResult {
  location: { latitude: number; longitude: number; name?: string };
  forecasts: WeatherForecast[];
  impacts: WeatherImpact[];
  summary: string;
}

const impactColors: Record<string, string> = {
  none: "bg-green-500",
  low: "bg-blue-500",
  medium: "bg-yellow-500",
  high: "bg-orange-500",
  severe: "bg-red-500",
};

const impactLabels: Record<string, string> = {
  none: "Ingen påverkan",
  low: "Liten påverkan",
  medium: "Måttlig påverkan",
  high: "Stor påverkan",
  severe: "Kraftig påverkan",
};

function getWeatherIcon(weatherCode: number) {
  if ([0, 1].includes(weatherCode)) return <Sun className="h-6 w-6 text-yellow-500" />;
  if ([2, 3].includes(weatherCode)) return <Cloud className="h-6 w-6 text-gray-500" />;
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weatherCode)) return <CloudRain className="h-6 w-6 text-blue-500" />;
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return <Snowflake className="h-6 w-6 text-blue-300" />;
  if ([95, 96, 99].includes(weatherCode)) return <Zap className="h-6 w-6 text-yellow-600" />;
  return <Cloud className="h-6 w-6 text-gray-500" />;
}

export default function WeatherPlanningPage() {
  const [selectedClusterId, setSelectedClusterId] = useState<string>("default");

  const { data: clusters = [] } = useQuery<Cluster[]>({
    queryKey: ["/api/clusters"],
  });

  const weatherUrl = selectedClusterId === "default"
    ? "/api/weather/forecast"
    : `/api/weather/cluster/${selectedClusterId}`;

  const { data: weatherData, isLoading, error } = useQuery<WeatherForecastResult>({
    queryKey: [weatherUrl],
  });

  const severeImpacts = weatherData?.impacts?.filter(i => i.impactLevel === "high" || i.impactLevel === "severe") || [];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cloud className="h-6 w-6 text-primary" />
            Väderplanering
          </h1>
          <p className="text-muted-foreground mt-1">
            Väderprognos med kapacitetsjusteringar för fältservice
          </p>
        </div>
        <Select value={selectedClusterId} onValueChange={setSelectedClusterId}>
          <SelectTrigger className="w-[220px]" data-testid="select-cluster">
            <SelectValue placeholder="Välj kluster" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Stockholm (standard)</SelectItem>
            {clusters.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Hämtar väderprognos...</p>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <p className="text-destructive">Kunde inte hämta väderprognos</p>
          </CardContent>
        </Card>
      )}

      {weatherData && !isLoading && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Sammanfattning</CardTitle>
              <CardDescription>
                {weatherData?.location?.name || "Vald plats"} • {weatherData?.forecasts?.length || 0} dagars prognos
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{weatherData?.summary}</p>
              {severeImpacts.length > 0 && (
                <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <div className="flex items-center gap-2 text-destructive font-medium mb-2">
                    <AlertTriangle className="h-4 w-4" />
                    Varning: {severeImpacts.length} dagar med stor väderpåverkan
                  </div>
                  <ul className="text-sm text-destructive/80 space-y-1">
                    {severeImpacts.slice(0, 3).map(impact => (
                      <li key={impact.date}>
                        {format(parseISO(impact.date), "EEEE d MMMM", { locale: sv })}: {impact.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {(weatherData?.forecasts || []).map((forecast, index) => {
              const impact = weatherData?.impacts?.[index];
              return (
                <Card key={forecast.date} data-testid={`card-forecast-${forecast.date}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm font-medium">
                        {format(parseISO(forecast.date), "EEEE", { locale: sv })}
                      </CardTitle>
                      {getWeatherIcon(forecast.weatherCode)}
                    </div>
                    <CardDescription>
                      {format(parseISO(forecast.date), "d MMMM", { locale: sv })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-center py-2">
                      <p className="text-2xl font-bold">{Math.round(forecast.temperature)}°C</p>
                      <p className="text-sm text-muted-foreground">{forecast.weatherDescription}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-1">
                        <Droplets className="h-3 w-3 text-blue-500" />
                        <span>{forecast.precipitation} mm</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Wind className="h-3 w-3 text-gray-500" />
                        <span>{Math.round(forecast.windSpeed)} m/s</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">Påverkan</span>
                        <Badge 
                          variant="secondary" 
                          className={`${impactColors[impact?.impactLevel || "none"]} text-white text-xs`}
                        >
                          {impactLabels[impact?.impactLevel || "none"]}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">Kapacitet</span>
                        <span className="text-sm font-medium">
                          {Math.round((impact?.capacityMultiplier || 1) * 100)}%
                        </span>
                      </div>
                    </div>

                    {impact?.recommendations && impact.recommendations.length > 0 && (
                      <div className="pt-2 border-t">
                        <p className="text-xs text-muted-foreground mb-1">Rekommendationer:</p>
                        <ul className="text-xs space-y-0.5">
                          {impact.recommendations.slice(0, 2).map((rec, i) => (
                            <li key={i} className="text-muted-foreground">• {rec}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Thermometer className="h-5 w-5" />
                Kapacitetsöversikt per dag
              </CardTitle>
              <CardDescription>
                Rekommenderad kapacitetsjustering baserat på väderprognos
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {weatherData.impacts.map(impact => (
                  <div 
                    key={impact.date} 
                    className="flex items-center gap-4 p-3 rounded-lg bg-muted/50"
                  >
                    <div className="w-28 shrink-0">
                      <p className="text-sm font-medium">
                        {format(parseISO(impact.date), "EEE d/M", { locale: sv })}
                      </p>
                    </div>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div 
                          className={`h-full ${impactColors[impact.impactLevel]} transition-all`}
                          style={{ width: `${impact.capacityMultiplier * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-16 text-right">
                      <span className="text-sm font-medium">
                        {Math.round(impact.capacityMultiplier * 100)}%
                      </span>
                    </div>
                    <div className="w-32 shrink-0">
                      <Badge 
                        variant="outline" 
                        className="text-xs"
                      >
                        {impact.reason.split(",")[0]}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
