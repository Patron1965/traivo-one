import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getISOWeek, getISOWeekYear } from "date-fns";
import { AlertTriangle, Plane, Briefcase } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TeamOption {
  id: string;
  name: string;
}

interface TeamMemberDeviation {
  resourceId: string;
  resourceName: string;
  ownTasks: Array<{ id: string; title: string; scheduledDate: string | null; minutes: number }>;
  ownTasksMinutes: number;
  ownTravelMinutes: number;
  totalDeviationMinutes: number;
  hasDeviation: boolean;
}

interface TeamDeviationSummary {
  teamId: string;
  members: TeamMemberDeviation[];
  teamAbsences: Array<{ id: string; title: string; plannedDate: string | null; minutes: number; timeCategory: string }>;
  teamAbsenceMinutes: number;
  totalCapacityImpactMinutes: number;
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0 min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function TeamDeviationsPanel({ teams, periodAnchor }: { teams: TeamOption[]; periodAnchor?: string }) {
  const [teamId, setTeamId] = useState<string>(teams[0]?.id ?? "");

  // Följer den valda planeringsperioden i Uppgiftsnavets filter (RoughFilterPanel
  // anchor/period), inte "idag" — annars visar panelen fel vecka när planeraren
  // tittar på en annan period.
  const anchorDate = useMemo(() => {
    if (periodAnchor) {
      const parsed = new Date(periodAnchor);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  }, [periodAnchor]);
  const year = getISOWeekYear(anchorDate);
  const week = getISOWeek(anchorDate);

  const { data, isLoading } = useQuery<TeamDeviationSummary>({
    queryKey: [`/api/weekly-plans/team/${teamId}/deviations`, year, week],
    queryFn: async () => {
      const res = await fetch(`/api/weekly-plans/team/${teamId}/deviations?year=${year}&week=${week}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Kunde inte hämta avvikelser");
      return res.json();
    },
    enabled: !!teamId,
  });

  const membersWithDeviation = data?.members.filter((m) => m.hasDeviation) ?? [];
  const hasAnyDeviation = membersWithDeviation.length > 0 || (data?.teamAbsenceMinutes ?? 0) > 0;

  if (teams.length === 0) return null;

  return (
    <Card data-testid="card-team-deviations">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Individuella avvikelser i team
        </CardTitle>
        <Select value={teamId} onValueChange={setTeamId}>
          <SelectTrigger className="w-[220px]" data-testid="select-deviation-team">
            <SelectValue placeholder="Välj team" />
          </SelectTrigger>
          <SelectContent>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id} data-testid={`option-deviation-team-${t.id}`}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          Vecka {week}, {year} — visar när en medlem kör eget jobb, är borta eller har egen resa
          separat från teamets huvudplan, och hur det påverkar teamets kvarvarande kapacitet.
        </p>
        {isLoading && <p className="text-sm text-muted-foreground">Laddar...</p>}
        {!isLoading && !hasAnyDeviation && (
          <p className="text-sm text-muted-foreground" data-testid="text-no-deviations">
            Inga avvikelser från teamplanen denna vecka.
          </p>
        )}
        {!isLoading && hasAnyDeviation && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-warning border-warning" data-testid="badge-capacity-impact">
                Kapacitetspåverkan: {formatMinutes(data?.totalCapacityImpactMinutes ?? 0)}
              </Badge>
            </div>
            {membersWithDeviation.map((m) => (
              <div
                key={m.resourceId}
                className="rounded-md border p-2 space-y-1"
                data-testid={`row-deviation-member-${m.resourceId}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{m.resourceName}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatMinutes(m.totalDeviationMinutes)} avviker
                  </span>
                </div>
                {m.ownTasks.length > 0 && (
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Briefcase className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      Egna uppgifter: {m.ownTasks.map((t) => t.title).join(", ")} (
                      {formatMinutes(m.ownTasksMinutes)})
                    </span>
                  </div>
                )}
                {m.ownTravelMinutes > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Plane className="h-3.5 w-3.5 shrink-0" />
                    <span>Egen resa: {formatMinutes(m.ownTravelMinutes)}</span>
                  </div>
                )}
              </div>
            ))}
            {data && data.teamAbsences.length > 0 && (
              <div className="rounded-md border p-2 space-y-1" data-testid="row-team-absences">
                <span className="text-sm font-medium">Team-nivå frånvaro</span>
                <p className="text-xs text-muted-foreground">
                  {data.teamAbsences.map((a) => a.title).join(", ")} ({formatMinutes(data.teamAbsenceMinutes)})
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
