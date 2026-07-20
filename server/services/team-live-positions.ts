// Task #1292/#1300: Ren grupperingslogik för team-livepositioner.
// Bryts ut ur storage.getTeamLivePositions så den kan enhetstestas utan DB.
import type { TeamLivePosition, TeamMemberLivePosition } from "../storage";

export interface TeamLiveRow {
  teamId: string;
  teamName: string;
  teamColor: string | null;
  // Null när teamet saknar accepterade medlemmar (left join-rad).
  resourceId: string | null;
  resourceName: string | null;
  latitude: number | null;
  longitude: number | null;
  trackingStatus: string | null;
  lastPositionUpdate: Date | string | null;
}

/**
 * Grupperar join-rader (team × accepterad medlem, left join) till en
 * TeamLivePosition per team. Senaste rapporterade positionen bland
 * medlemmarna vinner (position, back-compat); alla medlemmar med känd
 * position samlas i memberPositions (Task #1299). Team utan accepterade
 * medlemmar exkluderas inte utan behålls med resourceIds=[] och
 * position=null.
 */
export function groupTeamLiveRows(rows: TeamLiveRow[]): TeamLivePosition[] {
  const byTeam = new Map<string, TeamLivePosition>();
  for (const r of rows) {
    let entry = byTeam.get(r.teamId);
    if (!entry) {
      entry = {
        teamId: r.teamId,
        teamName: r.teamName,
        teamColor: r.teamColor ?? null,
        resourceIds: [],
        position: null,
        memberPositions: [],
      };
      byTeam.set(r.teamId, entry);
    }
    if (r.resourceId == null) continue;
    entry.resourceIds.push(r.resourceId);
    if (r.latitude != null && r.longitude != null && r.lastPositionUpdate != null) {
      const memberPos: TeamMemberLivePosition = {
        resourceId: r.resourceId,
        resourceName: r.resourceName ?? "",
        latitude: r.latitude,
        longitude: r.longitude,
        status: r.trackingStatus ?? null,
        lastUpdate: new Date(r.lastPositionUpdate).toISOString(),
      };
      entry.memberPositions.push(memberPos);
      const ts = new Date(r.lastPositionUpdate).getTime();
      const prev = entry.position;
      if (!prev || ts > new Date(prev.lastUpdate).getTime()) {
        entry.position = memberPos;
      }
    }
  }
  return Array.from(byTeam.values());
}
