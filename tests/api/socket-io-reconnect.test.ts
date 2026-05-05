import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TENANT_ID, TOMAS_ID,
  captureSocket, waitFor, loginMobile, mintSocketToken, emitTest,
  createTeam, deleteTeam, connectSocket,
  ALL_NAMED_EVENTS,
} from "./socket-io-helpers";

describe("Socket.io reconnect after disconnect (mobile cellular flap)", () => {
  let tomasMobile: string;
  let annaMobile: string;
  let teamId: string;

  beforeAll(async () => {
    tomasMobile = await loginMobile("tomas@nordicrouting.se");
    annaMobile = await loginMobile("anna@kinab.se");
    teamId = await createTeam(tomasMobile, `rc-test-${Date.now()}`);
  }, 15_000);

  afterAll(async () => {
    if (teamId) await deleteTeam(tomasMobile, teamId);
  });

  it("reconnects with a fresh token and re-joins resource + team rooms", async () => {
    const socketToken1 = await mintSocketToken(tomasMobile);
    const { socket: sock1, rooms: rooms1 } = await connectSocket(socketToken1);

    expect(rooms1).toContain(`resource:${TOMAS_ID}`);
    expect(rooms1).toContain(`tenant:${TENANT_ID}`);
    expect(rooms1).toContain(`team:${teamId}`);

    sock1.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    expect(sock1.connected).toBe(false);

    const socketToken2 = await mintSocketToken(tomasMobile);
    expect(socketToken2).not.toBe(socketToken1);

    const { socket: sock2, rooms: rooms2 } = await connectSocket(socketToken2);

    expect(rooms2).toContain(`resource:${TOMAS_ID}`);
    expect(rooms2).toContain(`tenant:${TENANT_ID}`);
    expect(rooms2).toContain(`team:${teamId}`);

    sock2.disconnect();
  });

  it("receives job_assigned on the resource room after reconnect", async () => {
    const token1 = await mintSocketToken(tomasMobile);
    const { socket: sock1 } = await connectSocket(token1);
    const events1 = captureSocket(sock1, ALL_NAMED_EVENTS);

    await emitTest(tomasMobile, "job_assigned", {
      resourceId: TOMAS_ID,
      teamId,
      orderId: `wo-rc-pre-${Date.now()}`,
    });
    await waitFor(() => events1.some((e) => e.event === "job_assigned"));

    sock1.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const token2 = await mintSocketToken(tomasMobile);
    const { socket: sock2 } = await connectSocket(token2);
    const events2 = captureSocket(sock2, ALL_NAMED_EVENTS);

    const postOrderId = `wo-rc-post-${Date.now()}`;
    await emitTest(tomasMobile, "job_assigned", {
      resourceId: TOMAS_ID,
      teamId,
      orderId: postOrderId,
    });

    const hit = await waitFor(() =>
      events2.find((e) => e.event === "job_assigned"),
    );
    expect(hit.payload?.event).toBe("order:assigned");
    expect(hit.payload?.resourceId).toBe(TOMAS_ID);

    const orderAssigned = await waitFor(() =>
      events2.find((e) => e.event === "order:assigned"),
    );
    expect(orderAssigned.payload?.tenantId).toBe(TENANT_ID);

    sock2.disconnect();
  });

  it("receives team:order_updated on the team room after reconnect", async () => {
    const token1 = await mintSocketToken(tomasMobile);
    const { socket: sock1, rooms: rooms1 } = await connectSocket(token1);
    expect(rooms1).toContain(`team:${teamId}`);

    sock1.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const token2 = await mintSocketToken(tomasMobile);
    const { socket: sock2, rooms: rooms2 } = await connectSocket(token2);
    expect(rooms2).toContain(`team:${teamId}`);

    const events2 = captureSocket(sock2, ALL_NAMED_EVENTS);

    await emitTest(tomasMobile, "job_assigned", {
      resourceId: TOMAS_ID,
      teamId,
      orderId: `wo-rc-team-${Date.now()}`,
    });

    const teamEvt = await waitFor(() =>
      events2.find((e) => e.event === "team:order_updated"),
    );
    expect(teamEvt.payload?.teamId).toBe(teamId);

    sock2.disconnect();
  });

  it("receives anomaly_alert on the tenant room after reconnect", async () => {
    const token1 = await mintSocketToken(annaMobile);
    const { socket: sock1 } = await connectSocket(token1);

    sock1.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const token2 = await mintSocketToken(annaMobile);
    const { socket: sock2, rooms: rooms2 } = await connectSocket(token2);
    expect(rooms2).toContain(`tenant:${TENANT_ID}`);

    const events2 = captureSocket(sock2, ALL_NAMED_EVENTS);

    await emitTest(tomasMobile, "anomaly_alert");

    const alert = await waitFor(() =>
      events2.find((e) => e.event === "anomaly_alert"),
    );
    expect(alert.payload?.title).toBe("Test-anomali");

    sock2.disconnect();
  });

  it("old socket receives nothing after disconnect + reconnect cycle", async () => {
    const token1 = await mintSocketToken(tomasMobile);
    const { socket: sock1 } = await connectSocket(token1);
    const staleEvents = captureSocket(sock1, ALL_NAMED_EVENTS);

    sock1.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const token2 = await mintSocketToken(tomasMobile);
    const { socket: sock2 } = await connectSocket(token2);
    const freshEvents = captureSocket(sock2, ALL_NAMED_EVENTS);

    await emitTest(tomasMobile, "job_assigned", {
      resourceId: TOMAS_ID,
      teamId,
      orderId: `wo-rc-stale-${Date.now()}`,
    });

    await waitFor(() => freshEvents.some((e) => e.event === "job_assigned"));

    await new Promise((r) => setTimeout(r, 300));
    expect(staleEvents.length).toBe(0);

    sock2.disconnect();
  });

  it("delivers client-emitted position_update to other tenant clients after reconnect", async () => {
    // Observer (Anna) stays connected throughout in the same tenant room.
    const annaToken = await mintSocketToken(annaMobile);
    const { socket: annaSock, rooms: annaRooms } = await connectSocket(annaToken);
    expect(annaRooms).toContain(`tenant:${TENANT_ID}`);
    const annaEvents = captureSocket(annaSock, ALL_NAMED_EVENTS);

    // Tomas connects, then disconnects (simulating cellular flap).
    const tomasToken1 = await mintSocketToken(tomasMobile);
    const { socket: tomasSock1 } = await connectSocket(tomasToken1);
    tomasSock1.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    expect(tomasSock1.connected).toBe(false);

    // Tomas reconnects with a fresh token.
    const tomasToken2 = await mintSocketToken(tomasMobile);
    const { socket: tomasSock2, rooms: tomasRooms2 } = await connectSocket(tomasToken2);
    expect(tomasRooms2).toContain(`resource:${TOMAS_ID}`);
    expect(tomasRooms2).toContain(`tenant:${TENANT_ID}`);

    // Reset the per-resource 30s position-broadcast throttle so the fan-out is
    // deterministic across repeated runs against the same dev process.
    await emitTest(tomasMobile, "reset_position_throttle", {
      resourceId: TOMAS_ID,
    });

    // Emit position_update from the *reconnected* socket. The bridge handler
    // must still be wired and fan out to tenant:<id>.
    tomasSock2.emit("position_update", {
      latitude: 59.3293,
      longitude: 18.0686,
      speed: 25,
      heading: 180,
      accuracy: 4,
      status: "traveling",
    });

    // Anna (other client in the same tenant) receives the broadcast.
    const annaPos = await waitFor(() =>
      annaEvents.find(
        (e) =>
          e.event === "position_update" &&
          e.payload?.resourceId === TOMAS_ID,
      ),
    );
    expect(annaPos.payload?.latitude).toBeCloseTo(59.3293, 3);
    expect(annaPos.payload?.longitude).toBeCloseTo(18.0686, 3);

    // Alias position:updated is emitted in the same fan-out.
    await waitFor(() =>
      annaEvents.some(
        (e) =>
          e.event === "position:updated" &&
          e.payload?.resourceId === TOMAS_ID,
      ),
    );

    tomasSock2.disconnect();
    annaSock.disconnect();
  });

  it("handles multiple rapid disconnect-reconnect cycles", async () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      const token = await mintSocketToken(tomasMobile);
      const { socket, rooms } = await connectSocket(token);

      expect(rooms).toContain(`resource:${TOMAS_ID}`);
      expect(rooms).toContain(`tenant:${TENANT_ID}`);
      expect(rooms).toContain(`team:${teamId}`);

      const events = captureSocket(socket, ALL_NAMED_EVENTS);

      await emitTest(tomasMobile, "job_assigned", {
        resourceId: TOMAS_ID,
        teamId,
        orderId: `wo-rc-cycle-${cycle}-${Date.now()}`,
      });

      await waitFor(() => events.some((e) => e.event === "job_assigned"));

      socket.disconnect();
      await new Promise((r) => setTimeout(r, 50));
    }
  });
});
