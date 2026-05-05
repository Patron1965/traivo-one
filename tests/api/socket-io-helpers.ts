import { io, type Socket } from "socket.io-client";

export const BASE = "http://localhost:5000";
export const TENANT_ID = "kinab";
export const TOMAS_ID = "res-tomas";
export const ANNA_ID = "res-anna";

export interface Captured {
  event: string;
  payload: any;
  at: number;
}

export function captureSocket(socket: Socket, names: string[]): Captured[] {
  const captured: Captured[] = [];
  for (const name of names) {
    socket.on(name, (payload: any) => {
      captured.push({ event: name, payload, at: Date.now() });
    });
  }
  return captured;
}

export async function waitFor<T>(
  predicate: () => T | undefined,
  timeoutMs = 4000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = predicate();
    if (v !== undefined && v !== null && v !== false) return v as T;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

export async function loginMobile(email: string, pin = "1234"): Promise<string> {
  const res = await fetch(`${BASE}/api/mobile/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, pin }),
  });
  if (!res.ok) {
    throw new Error(`Mobile login failed for ${email}: ${res.status}`);
  }
  const data = await res.json();
  return data.token as string;
}

export async function mintSocketToken(mobileToken: string): Promise<string> {
  const res = await fetch(`${BASE}/api/mobile/notifications/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${mobileToken}` },
  });
  if (!res.ok) {
    throw new Error(`Socket token mint failed: ${res.status}`);
  }
  const data = await res.json();
  return data.token as string;
}

// Mint a Socket.io auth token with a caller-controlled TTL via the test-only
// `mint_socket_token` event. Used by the token-expiry test so we can wait a
// few hundred milliseconds for expiry instead of 5 minutes.
export async function mintShortLivedSocketToken(
  mobileToken: string,
  ttlMs: number,
): Promise<string> {
  const res = await fetch(`${BASE}/api/mobile/__test/realtime/emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mobileToken}`,
    },
    body: JSON.stringify({ event: "mint_socket_token", params: { ttlMs } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`mintShortLivedSocketToken failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  if (!data?.token) {
    throw new Error(`mintShortLivedSocketToken: no token in response`);
  }
  return data.token as string;
}

export async function emitTest(
  mobileToken: string,
  event: string,
  params: Record<string, unknown> = {},
) {
  const res = await fetch(`${BASE}/api/mobile/__test/realtime/emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mobileToken}`,
    },
    body: JSON.stringify({ event, params }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`emitTest(${event}) failed: ${res.status} ${text}`);
  }
}

export async function createTeam(
  mobileToken: string,
  name: string,
): Promise<string> {
  const res = await fetch(`${BASE}/api/mobile/teams`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mobileToken}`,
    },
    body: JSON.stringify({ name, description: "realtime-test" }),
  });
  if (!res.ok) throw new Error(`Create team failed: ${res.status}`);
  const data = await res.json();
  return data.teamId as string;
}

export async function deleteTeam(mobileToken: string, teamId: string) {
  await fetch(`${BASE}/api/mobile/teams/${teamId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${mobileToken}` },
  }).catch(() => undefined);
}

export async function inviteToTeam(
  mobileToken: string,
  teamId: string,
  resourceId: string,
) {
  const res = await fetch(`${BASE}/api/mobile/teams/${teamId}/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${mobileToken}`,
    },
    body: JSON.stringify({ resourceId }),
  });
  if (!res.ok) throw new Error(`Invite failed: ${res.status}`);
}

export async function leaveTeam(mobileToken: string, teamId: string) {
  const res = await fetch(`${BASE}/api/mobile/teams/${teamId}/leave`, {
    method: "POST",
    headers: { Authorization: `Bearer ${mobileToken}` },
  });
  if (!res.ok) throw new Error(`Leave failed: ${res.status}`);
}

export async function connectSocket(token: string): Promise<{
  socket: Socket;
  rooms: string[];
}> {
  const socket = io(BASE, {
    path: "/socket.io",
    auth: { token },
    transports: ["polling"],
    reconnection: false,
    forceNew: true,
    timeout: 4000,
  });

  const rooms: string[] = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("socket connect timeout")),
      5000,
    );
    socket.once("connected", (payload: { rooms?: string[] }) => {
      clearTimeout(timer);
      resolve(payload?.rooms || []);
    });
    socket.once("connect_error", (e) => {
      clearTimeout(timer);
      reject(new Error(`connect_error: ${e.message}`));
    });
  });

  return { socket, rooms };
}

export const ALL_NAMED_EVENTS = [
  "order:assigned",
  "order:updated",
  "order:status_changed",
  "job_assigned",
  "job_updated",
  "job_cancelled",
  "schedule_changed",
  "priority_changed",
  "anomaly_alert",
  "notification",
  "notification:new",
  "position_update",
  "position:updated",
  "team:order_updated",
  "team:material_logged",
  "team:member_left",
  "team:invite",
  "team:invitation",
];
