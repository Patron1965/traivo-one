import type { Resource, Team, TeamMember } from "@shared/schema";

/**
 * Bygger en lista av "team-fordon" från teams + teammedlemmar + resurser.
 *
 * I ruttoptimeringen är det teamet som är fordonet — alla i teamet åker
 * tillsammans i samma bil och delar samma rutt. Vi syntetiserar därför en
 * Resource per team där:
 *   - id           = team.id  (så att VRP-resultatet refererar till teamet)
 *   - name         = team.name
 *   - location     = teamledarens hem (eller första aktiva medlemmens)
 *   - executionCodes = unionen av alla aktiva medlemmars koder
 *
 * Team utan aktiva medlemmar hoppas över.
 */
export function buildTeamVehicles(
  teams: Team[],
  teamMembers: TeamMember[],
  resources: Resource[],
): Resource[] {
  const resourceMap = new Map(resources.map((r) => [r.id, r]));
  const now = new Date();

  const membersByTeam = new Map<string, TeamMember[]>();
  for (const m of teamMembers) {
    if (m.validFrom && new Date(m.validFrom) > now) continue;
    if (m.validTo && new Date(m.validTo) < now) continue;
    const list = membersByTeam.get(m.teamId) ?? [];
    list.push(m);
    membersByTeam.set(m.teamId, list);
  }

  const teamVehicles: Resource[] = [];

  for (const team of teams) {
    if (team.status && team.status !== "active") continue;

    const teamMemberRows = membersByTeam.get(team.id) ?? [];
    const memberResources = teamMemberRows
      .map((tm) => resourceMap.get(tm.resourceId))
      .filter((r): r is Resource => Boolean(r));

    let representative: Resource | undefined;
    if (team.leaderId) {
      representative = resourceMap.get(team.leaderId);
    }
    if (!representative) {
      representative = memberResources[0];
    }
    if (!representative) {
      // Team utan aktiva medlemmar — inget fordon
      continue;
    }

    const allCodes = new Set<string>();
    for (const r of memberResources) {
      for (const code of r.executionCodes ?? []) allCodes.add(code);
    }
    if (!memberResources.includes(representative)) {
      for (const code of representative.executionCodes ?? []) allCodes.add(code);
    }

    const teamVehicle: Resource = {
      ...representative,
      id: team.id,
      name: team.name,
      executionCodes: Array.from(allCodes),
    };

    teamVehicles.push(teamVehicle);
  }

  return teamVehicles;
}
