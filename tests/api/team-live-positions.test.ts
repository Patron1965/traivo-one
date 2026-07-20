import { describe, it, expect } from "vitest";
import {
  groupTeamLiveRows,
  type TeamLiveRow,
} from "../../server/services/team-live-positions";

// Task #1300: getTeamLivePositions-grupperingen (utbruten till ren funktion).

function row(partial: Partial<TeamLiveRow>): TeamLiveRow {
  return {
    teamId: "team-1",
    teamName: "Team Nord",
    teamColor: "#4A9B9B",
    resourceId: "res-1",
    resourceName: "Anna",
    latitude: null,
    longitude: null,
    trackingStatus: null,
    lastPositionUpdate: null,
    ...partial,
  };
}

describe("groupTeamLiveRows", () => {
  it("returnerar tom lista för tomma rader", () => {
    expect(groupTeamLiveRows([])).toEqual([]);
  });

  it("flera medlemmar med position → senaste positionen vinner", () => {
    const teams = groupTeamLiveRows([
      row({
        resourceId: "res-1",
        resourceName: "Anna",
        latitude: 59.33,
        longitude: 18.06,
        trackingStatus: "traveling",
        lastPositionUpdate: new Date("2026-07-20T08:00:00.000Z"),
      }),
      row({
        resourceId: "res-2",
        resourceName: "Bertil",
        latitude: 59.34,
        longitude: 18.07,
        trackingStatus: "on_job",
        lastPositionUpdate: new Date("2026-07-20T09:30:00.000Z"),
      }),
      row({
        resourceId: "res-3",
        resourceName: "Cecilia",
        latitude: 59.35,
        longitude: 18.08,
        trackingStatus: "idle",
        lastPositionUpdate: new Date("2026-07-20T07:00:00.000Z"),
      }),
    ]);

    expect(teams).toHaveLength(1);
    expect(teams[0].resourceIds).toEqual(["res-1", "res-2", "res-3"]);
    expect(teams[0].position).toMatchObject({
      resourceId: "res-2",
      resourceName: "Bertil",
      latitude: 59.34,
      longitude: 18.07,
      status: "on_job",
      lastUpdate: "2026-07-20T09:30:00.000Z",
    });
  });

  it("ordningen på raderna påverkar inte vem som vinner", () => {
    const newest = row({
      resourceId: "res-2",
      latitude: 1,
      longitude: 2,
      lastPositionUpdate: new Date("2026-07-20T10:00:00.000Z"),
    });
    const older = row({
      resourceId: "res-1",
      latitude: 3,
      longitude: 4,
      lastPositionUpdate: new Date("2026-07-20T09:00:00.000Z"),
    });
    const a = groupTeamLiveRows([newest, older]);
    const b = groupTeamLiveRows([older, newest]);
    expect(a[0].position?.resourceId).toBe("res-2");
    expect(b[0].position?.resourceId).toBe("res-2");
  });

  it("team utan accepterade medlemmar exkluderas ej — resourceIds=[] och position=null", () => {
    // Left join-rad: teamet finns men saknar accepterade medlemmar.
    const teams = groupTeamLiveRows([
      row({
        teamId: "team-empty",
        teamName: "Tomt team",
        resourceId: null,
        resourceName: null,
        latitude: null,
        longitude: null,
        lastPositionUpdate: null,
      }),
      row({
        teamId: "team-1",
        resourceId: "res-1",
        latitude: 59.3,
        longitude: 18.0,
        lastPositionUpdate: new Date("2026-07-20T08:00:00.000Z"),
      }),
    ]);
    expect(teams).toHaveLength(2);
    const empty = teams.find((t) => t.teamId === "team-empty")!;
    expect(empty.resourceIds).toEqual([]);
    expect(empty.position).toBeNull();
    expect(teams.find((t) => t.teamId === "team-1")!.position).not.toBeNull();
  });

  it("team utan position bland medlemmarna behålls med position=null", () => {
    const teams = groupTeamLiveRows([
      row({ resourceId: "res-1" }),
      row({ resourceId: "res-2" }),
    ]);
    expect(teams).toHaveLength(1);
    expect(teams[0].position).toBeNull();
    expect(teams[0].resourceIds).toEqual(["res-1", "res-2"]);
  });

  it("rad med koordinater men utan lastPositionUpdate räknas inte som position", () => {
    const teams = groupTeamLiveRows([
      row({ resourceId: "res-1", latitude: 59.3, longitude: 18.0, lastPositionUpdate: null }),
    ]);
    expect(teams[0].position).toBeNull();
  });

  it("rad med bara ena koordinaten ignoreras som position", () => {
    const teams = groupTeamLiveRows([
      row({
        resourceId: "res-1",
        latitude: 59.3,
        longitude: null,
        lastPositionUpdate: new Date("2026-07-20T08:00:00.000Z"),
      }),
    ]);
    expect(teams[0].position).toBeNull();
  });

  it("grupperar flera team separat och bevarar teamColor null-fallback", () => {
    const teams = groupTeamLiveRows([
      row({ teamId: "team-1", teamName: "Nord", resourceId: "res-1" }),
      row({
        teamId: "team-2",
        teamName: "Syd",
        teamColor: null,
        resourceId: "res-2",
        latitude: 55.6,
        longitude: 13.0,
        lastPositionUpdate: "2026-07-20T08:15:00.000Z",
      }),
    ]);
    expect(teams).toHaveLength(2);
    const syd = teams.find((t) => t.teamId === "team-2")!;
    expect(syd.teamColor).toBeNull();
    expect(syd.position?.lastUpdate).toBe("2026-07-20T08:15:00.000Z");
    expect(teams.find((t) => t.teamId === "team-1")!.position).toBeNull();
  });
});
