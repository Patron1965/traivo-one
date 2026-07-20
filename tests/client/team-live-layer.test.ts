import { describe, it, expect } from "vitest";
import {
  mergeApiTeams,
  applyPositionUpdate,
  type TeamLivePositionDto,
  type PositionUpdateMsg,
} from "../../client/src/components/clustering/TeamLiveLayer";

function team(
  teamId: string,
  resourceIds: string[],
  position: TeamLivePositionDto["position"] = null,
): TeamLivePositionDto {
  return { teamId, teamName: `Team ${teamId}`, teamColor: null, resourceIds, position };
}

function pos(
  resourceId: string,
  lastUpdate: string,
  lat = 59.0,
  lng = 18.0,
): NonNullable<TeamLivePositionDto["position"]> {
  return {
    resourceId,
    resourceName: `Resurs ${resourceId}`,
    latitude: lat,
    longitude: lng,
    status: null,
    lastUpdate,
  };
}

const lookup = new Map<string, string>([
  ["r1", "A"],
  ["r2", "A"],
  ["r3", "B"],
]);

function msg(overrides: Partial<PositionUpdateMsg>): PositionUpdateMsg {
  return {
    type: "position_update",
    resourceId: "r1",
    latitude: 59.5,
    longitude: 17.5,
    timestamp: "2026-07-20T12:00:00Z",
    ...overrides,
  };
}

describe("applyPositionUpdate", () => {
  it("uppdaterar rätt teams position från en position_update", () => {
    const teams = [team("A", ["r1", "r2"]), team("B", ["r3"])];
    const out = applyPositionUpdate(teams, msg({}), lookup);
    expect(out[0].position).toMatchObject({
      resourceId: "r1",
      latitude: 59.5,
      longitude: 17.5,
      lastUpdate: "2026-07-20T12:00:00Z",
    });
    expect(out[1].position).toBeNull();
  });

  it("ignorerar händelser för okända resurser", () => {
    const teams = [team("A", ["r1"])];
    const out = applyPositionUpdate(teams, msg({ resourceId: "unknown" }), lookup);
    expect(out).toBe(teams);
  });

  it("ignorerar meddelanden som inte är position_update eller saknar koordinater", () => {
    const teams = [team("A", ["r1"])];
    expect(applyPositionUpdate(teams, msg({ type: "connected" }), lookup)).toBe(teams);
    expect(applyPositionUpdate(teams, msg({ latitude: null }), lookup)).toBe(teams);
  });

  it("ersätter inte en nyare position från en annan medlem med en äldre", () => {
    const teams = [team("A", ["r1", "r2"], pos("r2", "2026-07-20T13:00:00Z"))];
    const out = applyPositionUpdate(
      teams,
      msg({ resourceId: "r1", timestamp: "2026-07-20T12:00:00Z" }),
      lookup,
    );
    expect(out[0].position?.resourceId).toBe("r2");
  });

  it("nyare position från annan medlem tar över", () => {
    const teams = [team("A", ["r1", "r2"], pos("r2", "2026-07-20T11:00:00Z"))];
    const out = applyPositionUpdate(
      teams,
      msg({ resourceId: "r1", timestamp: "2026-07-20T12:00:00Z" }),
      lookup,
    );
    expect(out[0].position?.resourceId).toBe("r1");
  });

  it("behåller resursnamnet vid uppdatering från samma resurs", () => {
    const teams = [team("A", ["r1"], pos("r1", "2026-07-20T11:00:00Z"))];
    const out = applyPositionUpdate(teams, msg({}), lookup);
    expect(out[0].position?.resourceName).toBe("Resurs r1");
    expect(out[0].position?.lastUpdate).toBe("2026-07-20T12:00:00Z");
  });
});

describe("mergeApiTeams", () => {
  it("behåller nyare WS-position när API-svaret är äldre", () => {
    const prev = [team("A", ["r1"], pos("r1", "2026-07-20T12:00:00Z", 59.5, 17.5))];
    const incoming = [team("A", ["r1"], pos("r1", "2026-07-20T11:00:00Z"))];
    const out = mergeApiTeams(prev, incoming);
    expect(out[0].position?.lastUpdate).toBe("2026-07-20T12:00:00Z");
    expect(out[0].position?.latitude).toBe(59.5);
  });

  it("tar API-positionen när den är nyare", () => {
    const prev = [team("A", ["r1"], pos("r1", "2026-07-20T11:00:00Z"))];
    const incoming = [team("A", ["r1"], pos("r1", "2026-07-20T12:00:00Z", 60, 18.5))];
    const out = mergeApiTeams(prev, incoming);
    expect(out[0].position?.latitude).toBe(60);
  });

  it("behåller WS-position när API saknar position", () => {
    const prev = [team("A", ["r1"], pos("r1", "2026-07-20T12:00:00Z"))];
    const incoming = [team("A", ["r1"], null)];
    const out = mergeApiTeams(prev, incoming);
    expect(out[0].position?.resourceId).toBe("r1");
  });

  it("nya team från API läggs till, borttagna försvinner", () => {
    const prev = [team("A", ["r1"])];
    const incoming = [team("B", ["r3"])];
    const out = mergeApiTeams(prev, incoming);
    expect(out.map((t) => t.teamId)).toEqual(["B"]);
  });
});
