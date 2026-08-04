import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Socket } from "socket.io-client";
import {
  TENANT_ID, TOMAS_ID, ANNA_ID,
  type Captured,
  captureSocket, waitFor, loginMobile, mintSocketToken, emitTest,
  createTeam, deleteTeam, inviteToTeam, acceptTeamInvite, leaveTeam, connectSocket,
  ALL_NAMED_EVENTS,
} from "./socket-io-helpers";

// End-to-end test for the Traivo Go Socket.io realtime channel.
//
// Flow under test:
//   1. POST /api/mobile/login              → mobile bearer token
//   2. POST /api/mobile/notifications/token → short-lived Socket.io token
//   3. socket.io-client → /socket.io with that token
//   4. assert auto-joined rooms (resource:/tenant:/team:)
//   5. trigger every named event the bridge fans out and assert it lands
//      in the right rooms (and only there).
//
// This covers the 13/14 named events listed in Section 14 of the Traivo Go
// report: order:assigned, order:updated, job_assigned, job_updated,
// job_cancelled, schedule_changed, priority_changed, anomaly_alert,
// notification, position_update, team:order_updated, team:material_logged,
// team:member_left, team:invite.

describe("Socket.io realtime channel (Traivo Go)", () => {
  let tomasMobile: string;
  let annaMobile: string;
  let tomasSock: Socket;
  let annaSock: Socket;
  let tomasRooms: string[] = [];
  let annaRooms: string[] = [];
  let tomasEvents: Captured[] = [];
  let annaEvents: Captured[] = [];
  let teamId: string;

  beforeAll(async () => {
    tomasMobile = await loginMobile("tomas@nordicrouting.se");
    annaMobile = await loginMobile("anna@kinab.se");

    teamId = await createTeam(tomasMobile, `rt-test-${Date.now()}`);

    const tomasSocketToken = await mintSocketToken(tomasMobile);
    const annaSocketToken = await mintSocketToken(annaMobile);

    const t = await connectSocket(tomasSocketToken);
    tomasSock = t.socket;
    tomasRooms = t.rooms;
    tomasEvents = captureSocket(tomasSock, ALL_NAMED_EVENTS);

    const a = await connectSocket(annaSocketToken);
    annaSock = a.socket;
    annaRooms = a.rooms;
    annaEvents = captureSocket(annaSock, ALL_NAMED_EVENTS);
  }, 20_000);

  afterAll(async () => {
    try {
      tomasSock?.disconnect();
    } catch {}
    try {
      annaSock?.disconnect();
    } catch {}
    if (teamId) await deleteTeam(tomasMobile, teamId);
  });

  it("auto-joins resource:/tenant:/team: rooms based on the mobile token", () => {
    expect(tomasRooms).toContain(`resource:${TOMAS_ID}`);
    expect(tomasRooms).toContain(`tenant:${TENANT_ID}`);
    expect(tomasRooms).toContain(`team:${teamId}`);

    expect(annaRooms).toContain(`resource:${ANNA_ID}`);
    expect(annaRooms).toContain(`tenant:${TENANT_ID}`);
    // Anna has not joined the team yet — must NOT be in team:teamId.
    expect(annaRooms).not.toContain(`team:${teamId}`);
    // Cross-resource isolation: Anna must never auto-join Tomas's resource room.
    expect(annaRooms).not.toContain(`resource:${TOMAS_ID}`);
  });

  it("emits order:assigned, job_assigned and team:order_updated for notifyJobAssigned", async () => {
    tomasEvents.length = 0;
    annaEvents.length = 0;

    await emitTest(tomasMobile, "job_assigned", {
      resourceId: TOMAS_ID,
      teamId,
      orderId: `wo-rt-${Date.now()}`,
    });

    await waitFor(() =>
      tomasEvents.some((e) => e.event === "order:assigned") &&
      tomasEvents.some((e) => e.event === "job_assigned") &&
      tomasEvents.some((e) => e.event === "team:order_updated"),
    );

    const tomasOrderAssigned = tomasEvents.find(
      (e) => e.event === "order:assigned",
    );
    expect(tomasOrderAssigned?.payload?.event).toBe("order:assigned");
    expect(tomasOrderAssigned?.payload?.tenantId).toBe(TENANT_ID);
    expect(tomasOrderAssigned?.payload?.resourceId).toBe(TOMAS_ID);
    expect(tomasOrderAssigned?.payload?.teamId).toBe(teamId);

    // Anna shares the tenant room → receives order:assigned + job_assigned
    // (tenant fan-out) but NOT team:order_updated (she's not in the team).
    await waitFor(() =>
      annaEvents.some((e) => e.event === "order:assigned") &&
      annaEvents.some((e) => e.event === "job_assigned"),
    );
    expect(annaEvents.some((e) => e.event === "team:order_updated")).toBe(
      false,
    );
  });

  it("emits order:updated (+ alias order:status_changed), job_updated for notifyJobUpdated", async () => {
    tomasEvents.length = 0;
    annaEvents.length = 0;

    await emitTest(tomasMobile, "job_updated", {
      resourceId: TOMAS_ID,
      teamId,
    });

    await waitFor(() =>
      tomasEvents.some((e) => e.event === "order:updated") &&
      tomasEvents.some((e) => e.event === "order:status_changed") &&
      tomasEvents.some((e) => e.event === "job_updated"),
    );
    const upd = tomasEvents.find((e) => e.event === "order:updated");
    expect(upd?.payload?.changeDescription).toBe("Testbeskrivning");
  });

  it("emits job_cancelled for notifyJobCancelled", async () => {
    tomasEvents.length = 0;

    await emitTest(tomasMobile, "job_cancelled", {
      resourceId: TOMAS_ID,
      teamId,
    });

    await waitFor(() =>
      tomasEvents.some((e) => e.event === "job_cancelled"),
    );
    const cancelled = tomasEvents.find((e) => e.event === "job_cancelled");
    expect(cancelled?.payload?.event).toBe("job_cancelled");
  });

  it("emits schedule_changed for notifyScheduleChanged", async () => {
    tomasEvents.length = 0;

    await emitTest(tomasMobile, "schedule_changed", {
      resourceId: TOMAS_ID,
      teamId,
    });

    const sched = await waitFor(() =>
      tomasEvents.find((e) => e.event === "schedule_changed"),
    );
    expect(sched.payload?.oldDate).toBe("2026-04-30");
    expect(sched.payload?.newDate).toBe("2026-05-01");
  });

  it("emits priority_changed for notifyPriorityChanged", async () => {
    tomasEvents.length = 0;

    await emitTest(tomasMobile, "priority_changed", {
      resourceId: TOMAS_ID,
      teamId,
    });

    const prio = await waitFor(() =>
      tomasEvents.find((e) => e.event === "priority_changed"),
    );
    expect(prio.payload?.oldPriority).toBe("normal");
    expect(prio.payload?.newPriority).toBe("urgent");
  });

  it("fans anomaly_alert to every socket in the tenant room", async () => {
    tomasEvents.length = 0;
    annaEvents.length = 0;

    await emitTest(tomasMobile, "anomaly_alert");

    const tomasAlert = await waitFor(() =>
      tomasEvents.find((e) => e.event === "anomaly_alert"),
    );
    const annaAlert = await waitFor(() =>
      annaEvents.find((e) => e.event === "anomaly_alert"),
    );
    expect(tomasAlert.payload?.title).toBe("Test-anomali");
    expect(annaAlert.payload?.title).toBe("Test-anomali");
  });

  it("delivers notification (and alias notification:new) to the resource room only", async () => {
    tomasEvents.length = 0;
    annaEvents.length = 0;

    await emitTest(tomasMobile, "resource_notification", {
      resourceId: TOMAS_ID,
    });

    await waitFor(() =>
      tomasEvents.some((e) => e.event === "notification") &&
      tomasEvents.some((e) => e.event === "notification:new"),
    );

    // Must NOT leak to other resource rooms in the same tenant.
    await new Promise((r) => setTimeout(r, 250));
    expect(annaEvents.some((e) => e.event === "notification")).toBe(false);
    expect(annaEvents.some((e) => e.event === "notification:new")).toBe(false);
  });

  it("broadcasts position_update (+ alias position:updated) to the tenant room", async () => {
    tomasEvents.length = 0;
    annaEvents.length = 0;

    // Reset Anna's 30s position-broadcast throttle so this test is
    // deterministic across repeated runs against the same dev process.
    await emitTest(annaMobile, "reset_position_throttle", {
      resourceId: ANNA_ID,
    });

    annaSock.emit("position_update", {
      latitude: 59.1955,
      longitude: 17.6253,
      speed: 12,
      heading: 90,
      accuracy: 5,
      status: "traveling",
    });

    await waitFor(() =>
      tomasEvents.some(
        (e) =>
          e.event === "position_update" &&
          e.payload?.resourceId === ANNA_ID,
      ),
    );
    const annaPos = tomasEvents.find(
      (e) =>
        e.event === "position_update" && e.payload?.resourceId === ANNA_ID,
    );
    expect(annaPos?.payload?.latitude).toBeCloseTo(59.1955, 3);
    expect(annaPos?.payload?.longitude).toBeCloseTo(17.6253, 3);

    // Alias is emitted in the same fan-out.
    await waitFor(() =>
      tomasEvents.some(
        (e) =>
          e.event === "position:updated" &&
          e.payload?.resourceId === ANNA_ID,
      ),
    );
  });

  it("emits team:invite (+ alias team:invitation) to the team room and to the invited resource", async () => {
    tomasEvents.length = 0;
    annaEvents.length = 0;

    await inviteToTeam(tomasMobile, teamId, ANNA_ID);

    // Tomas is in team:teamId — receives team:invite there.
    const tomasInvite = await waitFor(() =>
      tomasEvents.find((e) => e.event === "team:invite"),
    );
    expect(tomasInvite.payload?.teamId).toBe(teamId);
    expect(tomasInvite.payload?.invitedResourceId).toBe(ANNA_ID);

    // Anna receives team:invite via her resource room.
    const annaInvite = await waitFor(() =>
      annaEvents.find((e) => e.event === "team:invite"),
    );
    expect(annaInvite.payload?.invitedResourceId).toBe(ANNA_ID);

    // Alias is delivered identically.
    await waitFor(() =>
      tomasEvents.some((e) => e.event === "team:invitation"),
    );

    // Inbjudan är numera väntande (acceptedAt=null) — Anna live-joinas i
    // team-rummet först när hon accepterar. Efter accept emittas en syntetisk
    // team:order_updated (memberJoined) som båda teammedlemmarna ser.
    await acceptTeamInvite(annaMobile, teamId);
    await waitFor(() =>
      tomasEvents.some(
        (e) =>
          e.event === "team:order_updated" &&
          (e.payload?.memberJoined === ANNA_ID ||
            e.payload?.teamId === teamId),
      ),
    );
    await waitFor(() =>
      annaEvents.some(
        (e) =>
          e.event === "team:order_updated" &&
          (e.payload?.memberJoined === ANNA_ID ||
            e.payload?.teamId === teamId),
      ),
    );
  });

  it("emits team:material_logged to every socket in the team room", async () => {
    tomasEvents.length = 0;
    annaEvents.length = 0;

    await emitTest(tomasMobile, "team_material_logged", {
      teamId,
      orderId: "wo-rt-material",
    });

    const tomasMat = await waitFor(() =>
      tomasEvents.find((e) => e.event === "team:material_logged"),
    );
    const annaMat = await waitFor(() =>
      annaEvents.find((e) => e.event === "team:material_logged"),
    );
    expect(tomasMat.payload?.orderId).toBe("wo-rt-material");
    expect(annaMat.payload?.orderId).toBe("wo-rt-material");
  });

  it("emits team:member_left and evicts the leaver from the team room", async () => {
    tomasEvents.length = 0;
    annaEvents.length = 0;

    await leaveTeam(annaMobile, teamId);

    // Both Anna (until evicted, which happens AFTER the emit) and Tomas see
    // the team:member_left event.
    const tomasLeft = await waitFor(() =>
      tomasEvents.find((e) => e.event === "team:member_left"),
    );
    expect(tomasLeft.payload?.teamId).toBe(teamId);
    expect(tomasLeft.payload?.memberId).toBe(ANNA_ID);

    const annaLeft = await waitFor(() =>
      annaEvents.find((e) => e.event === "team:member_left"),
    );
    expect(annaLeft.payload?.memberId).toBe(ANNA_ID);

    // After eviction Anna must no longer receive team-room events.
    tomasEvents.length = 0;
    annaEvents.length = 0;
    await emitTest(tomasMobile, "team_material_logged", {
      teamId,
      orderId: "wo-rt-after-leave",
    });
    await waitFor(() =>
      tomasEvents.find((e) => e.event === "team:material_logged"),
    );
    await new Promise((r) => setTimeout(r, 250));
    expect(annaEvents.some((e) => e.event === "team:material_logged")).toBe(
      false,
    );
  });
});
