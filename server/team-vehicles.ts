import type { Cluster, Resource, Team, TeamMember } from "@shared/schema";

/**
 * Bygger en map från teamId → lista av aktiva medlemmars resourceIds.
 *
 * Används för att aggregera resurs-baserad data (fordonskapacitet,
 * artikel-effektivitet etc.) per team i ruttoptimeringen, eftersom
 * det syntetiska "team-fordonet" har id = teamId och inga egna kopplingar
 * till resource_articles / resource_vehicles.
 *
 * Filtrerar samma teams/medlemmar som buildTeamVehicles (status=active,
 * validFrom/validTo-fönster).
 */
export function buildTeamMemberMap(
  teams: Team[],
  teamMembers: TeamMember[],
): Map<string, string[]> {
  const now = new Date();
  const activeTeamIds = new Set(
    teams.filter((t) => !t.status || t.status === "active").map((t) => t.id),
  );

  const map = new Map<string, string[]>();
  for (const m of teamMembers) {
    if (!activeTeamIds.has(m.teamId)) continue;
    if (m.validFrom && new Date(m.validFrom) > now) continue;
    if (m.validTo && new Date(m.validTo) < now) continue;
    const list = map.get(m.teamId) ?? [];
    list.push(m.resourceId);
    map.set(m.teamId, list);
  }
  return map;
}

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
  clusters: Cluster[] = [],
): Resource[] {
  const resourceMap = new Map(resources.map((r) => [r.id, r]));
  const clusterMap = new Map(clusters.map((c) => [c.id, c]));
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
    if (team.deletedAt) continue;

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

    // Fallback: hämta hem-koordinater från team.lastPosition eller cluster center
    // så att teams utan medlemmar/leader fortfarande kan vara fordon i VRP.
    let fallbackLat: number | null = null;
    let fallbackLng: number | null = null;
    const teamAny = team as any;
    if (typeof teamAny.lastPositionLat === "number" && typeof teamAny.lastPositionLng === "number") {
      fallbackLat = teamAny.lastPositionLat;
      fallbackLng = teamAny.lastPositionLng;
    } else if (team.clusterId) {
      const cluster = clusterMap.get(team.clusterId);
      const geo = (cluster?.geoData as any) || {};
      const lat = cluster?.centerLatitude ?? geo.centerLat ?? null;
      const lng = (cluster as any)?.centerLongitude ?? geo.centerLng ?? null;
      if (typeof lat === "number" && typeof lng === "number") {
        fallbackLat = lat;
        fallbackLng = lng;
      }
    }

    if (!representative && (fallbackLat === null || fallbackLng === null)) {
      // Team saknar både medlem/leader och fallback-koordinater — kan inte ruttas
      continue;
    }

    const allCodes = new Set<string>();
    for (const r of memberResources) {
      for (const code of r.executionCodes ?? []) allCodes.add(code);
    }
    if (representative && !memberResources.includes(representative)) {
      for (const code of representative.executionCodes ?? []) allCodes.add(code);
    }

    const baseTemplate: Resource = representative ?? ({
      id: team.id,
      tenantId: team.tenantId,
      userId: null,
      name: team.name,
      initials: null,
      resourceType: "team",
      phone: null,
      email: null,
      pin: null,
      homeLocation: null,
      homeLatitude: fallbackLat,
      homeLongitude: fallbackLng,
      currentLatitude: null,
      currentLongitude: null,
      lastPositionUpdate: null,
      trackingStatus: "offline",
      weeklyHours: 40,
      competencies: [],
      executionCodes: [],
      availability: {},
      serviceArea: [],
      efficiencyFactor: 1.0,
      drivingFactor: 1.0,
      costCenter: null,
      status: "active",
    } as unknown as Resource);

    const teamVehicle: Resource = {
      ...baseTemplate,
      id: team.id,
      name: team.name,
      executionCodes: Array.from(allCodes),
      // Använd fallback-koordinater om representanten saknar koordinater
      homeLatitude: representative?.homeLatitude ?? fallbackLat,
      homeLongitude: representative?.homeLongitude ?? fallbackLng,
    };

    teamVehicles.push(teamVehicle);
  }

  return teamVehicles;
}
