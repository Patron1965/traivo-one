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

  it("uppdaterar team-metadata från API även när WS-positionen behålls", () => {
    const prev = [team("A", ["r1"], pos("r1", "2026-07-20T12:00:00Z"))];
    const incoming = [
      { ...team("A", ["r1", "r2"], pos("r1", "2026-07-20T11:00:00Z")), teamName: "Nytt namn" },
    ];
    const out = mergeApiTeams(prev, incoming);
    expect(out[0].teamName).toBe("Nytt namn");
    expect(out[0].resourceIds).toEqual(["r1", "r2"]);
    expect(out[0].position?.lastUpdate).toBe("2026-07-20T12:00:00Z");
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

// ---------------------------------------------------------------------------
// Task #1302: groupTrailStops — stopp/pauser längs färdvägen
// ---------------------------------------------------------------------------
import { groupTrailStops, type TrailPointDto } from "../../client/src/components/clustering/TeamLiveLayer";

function pt(
  recordedAt: string,
  status: string | null,
  workOrderId: string | null = null,
  lat = 59.0,
  lng = 18.0,
): TrailPointDto {
  return {
    latitude: lat,
    longitude: lng,
    recordedAt,
    status,
    workOrderId,
    workOrderTitle: workOrderId ? `WO ${workOrderId}` : null,
  };
}

describe("groupTrailStops", () => {
  it("grupperar konsekutiva on_site-punkter till ett stopp med tidsintervall", () => {
    const stops = groupTrailStops([
      pt("2026-07-20T09:00:00Z", "traveling"),
      pt("2026-07-20T09:12:00Z", "on_site", "wo1"),
      pt("2026-07-20T09:30:00Z", "on_site", "wo1"),
      pt("2026-07-20T09:47:00Z", "on_site", "wo1"),
      pt("2026-07-20T10:00:00Z", "traveling"),
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      status: "on_site",
      startedAt: "2026-07-20T09:12:00Z",
      endedAt: "2026-07-20T09:47:00Z",
      workOrderId: "wo1",
      workOrderTitle: "WO wo1",
      pointCount: 3,
    });
  });

  it("bryter stopp när arbetsordern byts", () => {
    const stops = groupTrailStops([
      pt("2026-07-20T09:00:00Z", "on_site", "wo1"),
      pt("2026-07-20T09:10:00Z", "on_site", "wo1"),
      pt("2026-07-20T09:20:00Z", "on_site", "wo2"),
      pt("2026-07-20T09:30:00Z", "on_site", "wo2"),
    ]);
    expect(stops).toHaveLength(2);
    expect(stops[0].workOrderId).toBe("wo1");
    expect(stops[1].workOrderId).toBe("wo2");
  });

  it("idle-punkter blir paus-stopp; enstaka kort punkt filtreras bort", () => {
    const stops = groupTrailStops([
      pt("2026-07-20T09:00:00Z", "traveling"),
      pt("2026-07-20T09:05:00Z", "idle"),
      pt("2026-07-20T09:20:00Z", "traveling"),
      pt("2026-07-20T10:00:00Z", "idle"),
      pt("2026-07-20T10:15:00Z", "idle"),
    ]);
    expect(stops).toHaveLength(1);
    expect(stops[0].status).toBe("idle");
    expect(stops[0].startedAt).toBe("2026-07-20T10:00:00Z");
  });

  it("beräknar stoppets position som medelvärde av punkterna", () => {
    const stops = groupTrailStops([
      pt("2026-07-20T09:00:00Z", "on_site", "wo1", 59.0, 18.0),
      pt("2026-07-20T09:10:00Z", "on_site", "wo1", 59.2, 18.2),
    ]);
    expect(stops[0].latitude).toBeCloseTo(59.1);
    expect(stops[0].longitude).toBeCloseTo(18.1);
  });

  it("tom lista och enbart traveling ger inga stopp", () => {
    expect(groupTrailStops([])).toEqual([]);
    expect(
      groupTrailStops([
        pt("2026-07-20T09:00:00Z", "traveling"),
        pt("2026-07-20T09:10:00Z", null),
      ]),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Task #1308: computeTrailStatusDurations & formatDurationMs
// ---------------------------------------------------------------------------

import {
  computeTrailStatusDurations,
  formatDurationMs,
} from "../../client/src/components/clustering/TeamLiveLayer";

describe("computeTrailStatusDurations", () => {
  it("summerar tid per statuskategori (intervall tillskrivs första punktens status)", () => {
    const d = computeTrailStatusDurations([
      pt("2026-07-20T08:00:00Z", "traveling"),
      pt("2026-07-20T08:10:00Z", "on_site"),
      pt("2026-07-20T08:20:00Z", "on_site"),
      pt("2026-07-20T08:30:00Z", "idle"),
      pt("2026-07-20T08:35:00Z", "traveling"),
      pt("2026-07-20T08:45:00Z", "on_site"),
    ]);
    expect(d.travelingMs).toBe(20 * 60 * 1000);
    expect(d.onSiteMs).toBe(20 * 60 * 1000);
    expect(d.pausedMs).toBe(5 * 60 * 1000);
  });

  it("on_job räknas som på plats och break som paus", () => {
    const d = computeTrailStatusDurations([
      pt("2026-07-20T08:00:00Z", "on_job"),
      pt("2026-07-20T08:05:00Z", "break"),
      pt("2026-07-20T08:10:00Z", "break"),
    ]);
    expect(d.onSiteMs).toBe(5 * 60 * 1000);
    expect(d.pausedMs).toBe(5 * 60 * 1000);
    expect(d.travelingMs).toBe(0);
  });

  it("ignorerar dataluckor > 15 min och okänd/null-status", () => {
    const d = computeTrailStatusDurations([
      pt("2026-07-20T08:00:00Z", "on_site"),
      pt("2026-07-20T08:20:00Z", "on_site"), // 20 min gap → ignoreras
      pt("2026-07-20T08:25:00Z", null),
      pt("2026-07-20T08:30:00Z", "offline"),
      pt("2026-07-20T08:35:00Z", "on_site"),
    ]);
    // Endast 08:20→08:25 (on_site, 5 min) räknas; gapet samt null/offline ignoreras.
    expect(d.onSiteMs).toBe(5 * 60 * 1000);
    expect(d.travelingMs).toBe(0);
    expect(d.pausedMs).toBe(0);
  });

  it("tom lista och en enda punkt ger nollor", () => {
    expect(computeTrailStatusDurations([])).toEqual({
      onSiteMs: 0,
      travelingMs: 0,
      pausedMs: 0,
    });
    expect(computeTrailStatusDurations([pt("2026-07-20T08:00:00Z", "on_site")])).toEqual({
      onSiteMs: 0,
      travelingMs: 0,
      pausedMs: 0,
    });
  });
});

describe("formatDurationMs", () => {
  it("formaterar timmar och minuter", () => {
    expect(formatDurationMs(0)).toBe("<1m");
    expect(formatDurationMs(25 * 60 * 1000)).toBe("25m");
    expect(formatDurationMs(60 * 60 * 1000)).toBe("1h");
    expect(formatDurationMs((3 * 60 + 20) * 60 * 1000)).toBe("3h 20m");
  });
});
