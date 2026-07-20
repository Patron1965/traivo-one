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
  memberPositions?: TeamLivePositionDto["memberPositions"],
): TeamLivePositionDto {
  return {
    teamId,
    teamName: `Team ${teamId}`,
    teamColor: null,
    resourceIds,
    position,
    memberPositions: memberPositions ?? (position ? [position] : []),
  };
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

  it("mergar memberPositions per medlem — nyare WS-medlem behålls", () => {
    const prev = [
      team("A", ["r1", "r2"], pos("r1", "2026-07-20T12:00:00Z", 59.9, 17.9), [
        pos("r1", "2026-07-20T12:00:00Z", 59.9, 17.9),
        pos("r2", "2026-07-20T12:30:00Z", 59.1, 18.1),
      ]),
    ];
    const incoming = [
      team("A", ["r1", "r2"], pos("r2", "2026-07-20T11:00:00Z"), [
        pos("r1", "2026-07-20T12:30:00Z", 60, 18.5),
        pos("r2", "2026-07-20T11:00:00Z"),
      ]),
    ];
    const out = mergeApiTeams(prev, incoming);
    const byId = new Map(out[0].memberPositions.map((m) => [m.resourceId, m]));
    // r1: API nyare → tas
    expect(byId.get("r1")?.latitude).toBe(60);
    // r2: WS nyare → behålls
    expect(byId.get("r2")?.lastUpdate).toBe("2026-07-20T12:30:00Z");
  });

  it("behåller WS-medlem som API ännu inte sett, om den är kvar i teamet", () => {
    const prev = [
      team("A", ["r1", "r2"], pos("r2", "2026-07-20T12:00:00Z"), [
        pos("r2", "2026-07-20T12:00:00Z"),
      ]),
    ];
    const incoming = [
      team("A", ["r1", "r2"], pos("r1", "2026-07-20T11:00:00Z"), [
        pos("r1", "2026-07-20T11:00:00Z"),
      ]),
    ];
    const out = mergeApiTeams(prev, incoming);
    expect(out[0].memberPositions.map((m) => m.resourceId).sort()).toEqual(["r1", "r2"]);
  });
});

describe("applyPositionUpdate — memberPositions (Task #1299)", () => {
  it("routar WS-uppdatering till rätt medlem i memberPositions", () => {
    const teams = [
      team("A", ["r1", "r2"], pos("r2", "2026-07-20T11:30:00Z"), [
        pos("r1", "2026-07-20T11:00:00Z"),
        pos("r2", "2026-07-20T11:30:00Z"),
      ]),
    ];
    const out = applyPositionUpdate(teams, msg({ resourceId: "r1" }), lookup);
    const r1 = out[0].memberPositions.find((m) => m.resourceId === "r1");
    const r2 = out[0].memberPositions.find((m) => m.resourceId === "r2");
    expect(r1).toMatchObject({ latitude: 59.5, lastUpdate: "2026-07-20T12:00:00Z" });
    // r2 orörd
    expect(r2?.lastUpdate).toBe("2026-07-20T11:30:00Z");
    // teamposition tar den nyaste
    expect(out[0].position?.resourceId).toBe("r1");
  });

  it("lägger till ny medlem i memberPositions vid första positionen", () => {
    const teams = [team("A", ["r1", "r2"], pos("r2", "2026-07-20T11:00:00Z"))];
    const out = applyPositionUpdate(teams, msg({ resourceId: "r1" }), lookup);
    expect(out[0].memberPositions.map((m) => m.resourceId).sort()).toEqual(["r1", "r2"]);
  });

  it("äldre händelse än medlemmens befintliga position ignoreras", () => {
    const teams = [
      team("A", ["r1"], pos("r1", "2026-07-20T13:00:00Z", 59.9, 17.9)),
    ];
    const out = applyPositionUpdate(
      teams,
      msg({ resourceId: "r1", timestamp: "2026-07-20T12:00:00Z" }),
      lookup,
    );
    expect(out[0].memberPositions[0].lastUpdate).toBe("2026-07-20T13:00:00Z");
    expect(out[0].position?.latitude).toBe(59.9);
  });

  it("äldre händelse från annan medlem uppdaterar medlemmen men inte teampositionen", () => {
    const teams = [
      team("A", ["r1", "r2"], pos("r2", "2026-07-20T13:00:00Z"), [
        pos("r2", "2026-07-20T13:00:00Z"),
      ]),
    ];
    const out = applyPositionUpdate(
      teams,
      msg({ resourceId: "r1", timestamp: "2026-07-20T12:00:00Z" }),
      lookup,
    );
    expect(out[0].position?.resourceId).toBe("r2");
    expect(out[0].memberPositions.map((m) => m.resourceId).sort()).toEqual(["r1", "r2"]);
  });
});
