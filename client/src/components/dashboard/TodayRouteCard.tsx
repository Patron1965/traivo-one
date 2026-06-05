import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getISOWeek, getISOWeekYear, format } from "date-fns";
import { sv } from "date-fns/locale";
import { Briefcase, CalendarRange, Clock, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RouteDayMap, type RouteMapJob } from "@/components/ui/map";
import type { WeeklyPlan } from "@shared/schema";

interface Team {
  id: string;
  name: string;
  color: string | null;
}

/** Minimal vy av de uppgiftsfält Dashboard-kortet behöver (samma endpoint som veckoschemat). */
interface RouteTask {
  id: string;
  name: string | null;
  plannedDate: string | null;
  plannedStartTime: string | null;
  sequence: number | null;
  lat: number | null;
  lng: number | null;
  locationName: string | null;
}

interface WeeklyPlanDetail extends WeeklyPlan {
  tasks: RouteTask[];
}

function localDateString(value: string | Date): string {
  const d = new Date(value);
  return format(d, "yyyy-MM-dd");
}

function startMinutes(t: RouteTask): number {
  if (t.plannedStartTime) {
    const d = new Date(t.plannedStartTime);
    return d.getHours() * 60 + d.getMinutes();
  }
  return t.sequence ?? 0;
}

export function TodayRouteCard() {
  const [, setLocation] = useLocation();
  const now = useMemo(() => new Date(), []);
  const year = getISOWeekYear(now);
  const week = getISOWeek(now);
  const todayStr = localDateString(now);

  const [teamId, setTeamId] = useState<string>("");

  const { data: teams = [], isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const effectiveTeamId = teamId || teams[0]?.id || "";

  const listKey = `/api/weekly-plans?teamId=${effectiveTeamId}&year=${year}&week=${week}`;
  const { data: planList, isLoading: listLoading } = useQuery<WeeklyPlan[]>({
    queryKey: [listKey],
    enabled: !!effectiveTeamId,
  });

  const planId = planList?.[0]?.id;
  const detailKey = planId ? `/api/weekly-plans/${planId}` : "";
  const { data: plan, isLoading: detailLoading } = useQuery<WeeklyPlanDetail>({
    queryKey: [detailKey],
    enabled: !!planId,
  });

  // Dagens produktionsuppgifter i tidsordning (samma härledning som veckoschemat).
  const dayTasks = useMemo<RouteTask[]>(() => {
    if (!plan) return [];
    return (plan.tasks ?? [])
      .filter((t) => {
        const d = t.plannedDate ?? (t.plannedStartTime ? localDateString(t.plannedStartTime) : null);
        return d === todayStr;
      })
      .sort((a, b) => startMinutes(a) - startMinutes(b));
  }, [plan, todayStr]);

  const mapJobs = useMemo<RouteMapJob[]>(
    () =>
      dayTasks
        .filter((t) => t.lat != null && t.lng != null)
        .map((t) => ({
          id: t.id,
          lat: t.lat as number,
          lng: t.lng as number,
          label: t.name?.trim() || "Produktion",
          locationName: t.locationName,
          timeLabel: t.plannedStartTime ? format(new Date(t.plannedStartTime), "HH:mm") : null,
        })),
    [dayTasks],
  );

  const jobNumberById = useMemo(() => {
    const m = new Map<string, number>();
    mapJobs.forEach((j, i) => m.set(j.id, i + 1));
    return m;
  }, [mapJobs]);

  const isLoading = teamsLoading || (!!effectiveTeamId && listLoading) || (!!planId && detailLoading);

  const goToWeekly = () =>
    setLocation(effectiveTeamId ? `/veckoplan?teamId=${effectiveTeamId}` : "/veckoplan");

  return (
    <Card data-testid="card-today-route">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarRange className="h-5 w-5 text-primary" />
            Dagens översikt
          </CardTitle>
          {teams.length > 1 && (
            <Select value={effectiveTeamId} onValueChange={setTeamId}>
              <SelectTrigger className="h-8 w-[160px] text-xs" data-testid="select-today-route-team">
                <SelectValue placeholder="Välj team" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((tm) => (
                  <SelectItem key={tm.id} value={tm.id} data-testid={`option-team-${tm.id}`}>
                    {tm.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <p className="text-xs text-muted-foreground" data-testid="text-today-route-date">
          {format(now, "EEEE d MMMM", { locale: sv })}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3" data-testid="today-route-loading">
            <Skeleton className="h-[240px] w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            <RouteDayMap
              jobs={mapJobs}
              height={240}
              showLegend={false}
              testId="map-today-route"
              emptyLabel="Inga koordinater för dagens jobb."
            />

            {dayTasks.length > 0 ? (
              <ol className="space-y-2" data-testid="list-today-route-jobs">
                {dayTasks.map((t) => {
                  const num = jobNumberById.get(t.id);
                  return (
                    <li
                      key={t.id}
                      className="flex items-start gap-2.5 rounded-md border border-border p-2.5"
                      data-testid={`today-route-job-${t.id}`}
                    >
                      {num != null ? (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums">
                          {num}
                        </span>
                      ) : (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Briefcase className="h-3 w-3" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" data-testid={`text-today-route-job-name-${t.id}`}>
                          {t.name?.trim() || "Produktion"}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {t.plannedStartTime && (
                            <span className="flex items-center gap-1 tabular-nums">
                              <Clock className="h-3 w-3 shrink-0" />
                              {format(new Date(t.plannedStartTime), "HH:mm")}
                            </span>
                          )}
                          {t.locationName && (
                            <span className="flex min-w-0 items-center gap-1">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{t.locationName}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div
                className="flex flex-col items-center justify-center gap-1 py-6 text-center text-muted-foreground"
                data-testid="today-route-empty"
              >
                <CalendarRange className="h-8 w-8 opacity-50" />
                <p className="text-sm">Inga planerade jobb idag.</p>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={goToWeekly}
              data-testid="button-open-weekly-schedule"
            >
              <CalendarRange className="mr-2 h-4 w-4" />
              Öppna veckoschema
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
