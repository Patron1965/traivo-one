import type { Resource, Team, TeamMember, WorkOrder } from "@shared/schema";
import { buildStartTaskPointMap } from "@shared/start-task";

/**
 * Task #1216: Bygger startpunkts-kartan (teamId/resourceId → lat/lng) från
 * startuppgifter (orderType="startpunkt") för en given dag. Startuppgifter är
 * den ENDA planeringsgrunden för fordonets startposition — team-/teamledar-/
 * medlems-/GPS- och klustercentrum-positioner används aldrig.
 */
export function buildStartPointsForDate(
  workOrders: Pick<WorkOrder, "orderType" | "teamId" | "resourceId" | "taskLatitude" | "taskLongitude" | "scheduledStartTime" | "scheduledDate">[],
  date?: string | null,
): Map<string, { lat: number; lng: number }> {
  const relevant = date
    ? workOrders.filter((wo) => {
        if (!wo.scheduledDate) return false;
        const d = wo.scheduledDate instanceof Date
          ? wo.scheduledDate.toISOString().split("T")[0]
          : String(wo.scheduledDate).split("T")[0];
        return d === date;
      })
    : workOrders;
  return buildStartTaskPointMap(relevant);
}

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
 *   - location     = teamets STARTUPPGIFT för dagen (Task #1216) — aldrig
 *                    teamledarens/medlemmens hem, team-GPS eller klustercentrum
 *   - executionCodes = unionen av alla aktiva medlemmars koder
 *
 * Team utan startuppgift med position hoppas över (loggas) — de kan inte
 * ruttberäknas. GPS-positioner är enbart realtidsinformation.
 */
export function buildTeamVehicles(
  teams: Team[],
  teamMembers: TeamMember[],
  resources: Resource[],
  startPoints: Map<string, { lat: number; lng: number }> = new Map(),
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

    // Task #1216: fordonets position kommer ENBART från teamets startuppgift.
    // Inga fallbackar till teamledar-/medlemshem, team-GPS eller klustercentrum.
    const startPoint = startPoints.get(team.id) ?? null;
    if (!startPoint) {
      console.log(
        `[team-vehicles] Team "${team.name}" (${team.id}) saknar startuppgift med position — hoppas över i VRP`,
      );
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
      homeLatitude: startPoint.lat,
      homeLongitude: startPoint.lng,
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
      // Task #1216: startuppgiftens position är fordonets startpunkt —
      // representantens hemkoordinater används ALDRIG som planeringsgrund.
      homeLatitude: startPoint.lat,
      homeLongitude: startPoint.lng,
      // GPS är enbart realtidsinformation — nollställ på det syntetiska fordonet.
      currentLatitude: null,
      currentLongitude: null,
    };

    teamVehicles.push(teamVehicle);
  }

  return teamVehicles;
}
