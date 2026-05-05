import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import {
  ALL_NAMED_EVENTS,
  BASE,
  TENANT_ID,
  TOMAS_ID,
  captureSocket,
  connectSocket,
  createTeam,
  deleteTeam,
  emitTest,
  loginMobile,
  mintShortLivedSocketToken,
  mintSocketToken,
} from "./socket-io-helpers";

// Verifies that the Socket.io bridge rejects connection attempts that present
// an *expired* (or otherwise invalid) auth token. Complements
// `socket-io-reconnect.test.ts`, which only covers the happy path of
// disconnect → mint a fresh token → reconnect.
//
// What's covered:
//   1. A token whose 5-minute TTL has elapsed is rejected with a
//      `connect_error` carrying the bridge's "Invalid or expired token"
//      message — the same surface a mobile client would see.
//   2. A garbage / unknown token is rejected the same way (sanity check
//      that the path isn't accidentally permissive).
//   3. After a connection is rejected, the underlying socket joins no rooms
//      and receives no events — even when the server fires events that the
//      same resource *would* have received with a valid token.

describe("Socket.io token expiry on reconnect", () => {
  let tomasMobile: string;
  let teamId: string;

  beforeAll(async () => {
    tomasMobile = await loginMobile("tomas@nordicrouting.se");
    teamId = await createTeam(tomasMobile, `rc-expiry-${Date.now()}`);
  }, 15_000);

  afterAll(async () => {
    if (teamId) await deleteTeam(tomasMobile, teamId);
  });

  it("rejects an expired Socket.io token on reconnect with a meaningful error", async () => {
    // First connect successfully with a short-lived token to prove the
    // token *was* valid before expiry — this models the realistic flow:
    // mobile client connects, suspends/loses signal, comes back later
    // with a now-expired token.
    const shortToken = await mintShortLivedSocketToken(tomasMobile, 1500);
    const { socket: liveSock, rooms } = await connectSocket(shortToken);
    expect(rooms).toContain(`resource:${TOMAS_ID}`);
    expect(rooms).toContain(`tenant:${TENANT_ID}`);
    liveSock.disconnect();

    // Wait past the TTL so the same token is now expired. Using a 1.5s TTL
    // and a 1.8s wait keeps timing slack large enough to absorb CI jitter
    // without making the test slow.
    await new Promise((r) => setTimeout(r, 1800));

    const result = await new Promise<{
      ok: boolean;
      message?: string;
      socket: Socket;
    }>((resolve) => {
      const sock = io(BASE, {
        path: "/socket.io",
        auth: { token: shortToken },
        transports: ["polling"],
        reconnection: false,
        forceNew: true,
        timeout: 4000,
      });
      const timer = setTimeout(() => {
        resolve({ ok: false, message: "no response", socket: sock });
      }, 5000);
      sock.once("connect", () => {
        clearTimeout(timer);
        resolve({ ok: true, socket: sock });
      });
      sock.once("connect_error", (e: Error) => {
        clearTimeout(timer);
        resolve({ ok: false, message: e.message, socket: sock });
      });
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
    // Bridge surfaces the rejection as "Invalid or expired token". The
    // socket.io-client may prefix it ("Auth failed: ..." is also tolerated
    // since the bridge wraps unexpected errors that way), so accept either.
    expect(result.message).toMatch(/invalid or expired token/i);
    expect(result.socket.connected).toBe(false);
    result.socket.disconnect();
  });

  it("rejects a garbage / unknown Socket.io token", async () => {
    const garbage = "deadbeef".repeat(8); // 64 hex chars, not in token store

    const result = await new Promise<{ ok: boolean; message?: string; socket: Socket }>(
      (resolve) => {
        const sock = io(BASE, {
          path: "/socket.io",
          auth: { token: garbage },
          transports: ["polling"],
          reconnection: false,
          forceNew: true,
          timeout: 4000,
        });
        const timer = setTimeout(
          () => resolve({ ok: false, message: "no response", socket: sock }),
          5000,
        );
        sock.once("connect", () => {
          clearTimeout(timer);
          resolve({ ok: true, socket: sock });
        });
        sock.once("connect_error", (e: Error) => {
          clearTimeout(timer);
          resolve({ ok: false, message: e.message, socket: sock });
        });
      },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/invalid or expired token/i);
    expect(result.socket.connected).toBe(false);
    result.socket.disconnect();
  });

  it("rejected socket joins no rooms and receives no events", async () => {
    // Mint a short-lived token, let it expire, then attach an event listener
    // BEFORE attempting to connect. We also keep a separate, validly
    // connected socket alive so we know the server is actively fanning out
    // the test event — if the rejected socket's listener stays empty while
    // the valid socket's listener fires, we've proved the rejected socket
    // is fully isolated.
    const expiringToken = await mintShortLivedSocketToken(tomasMobile, 1000);
    await new Promise((r) => setTimeout(r, 1300));

    // Valid control socket — proves the test event actually fires.
    const validToken = await mintSocketToken(tomasMobile);
    const { socket: validSock, rooms: validRooms } = await connectSocket(validToken);
    expect(validRooms).toContain(`resource:${TOMAS_ID}`);
    const validEvents = captureSocket(validSock, ALL_NAMED_EVENTS);

    // Rejected socket — should never fire `connected`, never join rooms,
    // never receive named events.
    const rejected = io(BASE, {
      path: "/socket.io",
      auth: { token: expiringToken },
      transports: ["polling"],
      reconnection: false,
      forceNew: true,
      timeout: 4000,
    });
    const rejectedRooms: string[] = [];
    let rejectedConnected = false;
    let rejectedError: string | null = null;
    rejected.on("connected", (payload: { rooms?: string[] }) => {
      rejectedConnected = true;
      if (payload?.rooms) rejectedRooms.push(...payload.rooms);
    });
    rejected.on("connect_error", (e: Error) => {
      rejectedError = e.message;
    });
    const rejectedEvents = captureSocket(rejected, ALL_NAMED_EVENTS);

    // Wait briefly for the connect attempt to fail.
    await new Promise((r) => setTimeout(r, 800));
    expect(rejectedConnected).toBe(false);
    expect(rejectedRooms).toHaveLength(0);
    expect(rejectedError).toMatch(/invalid or expired token/i);

    // Fire a job_assigned that targets the same resource; the valid socket
    // should see it. The rejected one should not.
    await emitTest(tomasMobile, "job_assigned", {
      resourceId: TOMAS_ID,
      teamId,
      orderId: `wo-rc-expired-${Date.now()}`,
    });

    // Give the server time to fan out.
    const deadline = Date.now() + 3000;
    while (
      Date.now() < deadline &&
      !validEvents.some((e) => e.event === "job_assigned")
    ) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(validEvents.some((e) => e.event === "job_assigned")).toBe(true);

    // Buffer to be sure no late delivery sneaks in.
    await new Promise((r) => setTimeout(r, 300));
    expect(rejectedEvents).toHaveLength(0);

    rejected.disconnect();
    validSock.disconnect();
  });
});
