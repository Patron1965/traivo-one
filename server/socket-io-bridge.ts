import type { Server as HttpServer } from "http";
import { Server as IOServer, Socket } from "socket.io";
import { storage } from "./storage";

interface SocketAuthBinding {
  resourceId?: string;
  userId?: string;
  tenantId: string | null;
  teamIds: string[];
}

interface IncomingPositionUpdate {
  resourceId?: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  status?: "traveling" | "on_site" | "idle";
  workOrderId?: string;
}

type TokenValidator = (token: string) => {
  resourceId?: string;
  userId?: string;
  tenantId?: string | null;
} | null;

type PositionHandler = (position: {
  resourceId: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  status?: "traveling" | "on_site" | "idle";
  workOrderId?: string;
}) => Promise<void> | void;

class SocketIoBridge {
  private io: IOServer | null = null;
  private validateToken: TokenValidator | null = null;
  private positionHandler: PositionHandler | null = null;

  initialize(
    httpServer: HttpServer,
    options: {
      validateToken: TokenValidator;
      onPositionUpdate: PositionHandler;
    },
  ) {
    this.validateToken = options.validateToken;
    this.positionHandler = options.onPositionUpdate;

    const io = new IOServer(httpServer, {
      path: "/socket.io",
      cors: {
        origin: true,
        credentials: true,
      },
      transports: ["websocket", "polling"],
      pingInterval: 25_000,
      pingTimeout: 60_000,
    });

    io.use(async (socket, next) => {
      try {
        const token = this.extractToken(socket);
        if (!token) return next(new Error("Authentication token required"));

        if (!this.validateToken) return next(new Error("Bridge not ready"));
        const binding = this.validateToken(token);
        if (!binding || (!binding.resourceId && !binding.userId)) {
          return next(new Error("Invalid or expired token"));
        }

        const auth: SocketAuthBinding = {
          resourceId: binding.resourceId,
          userId: binding.userId,
          tenantId: binding.tenantId ?? null,
          teamIds: [],
        };

        if (!auth.tenantId && auth.resourceId) {
          try {
            const r = await storage.getResource(auth.resourceId);
            if (r?.tenantId) auth.tenantId = r.tenantId;
          } catch (e) {
            console.warn(
              `[socket.io] Could not resolve tenant for resource ${auth.resourceId}`,
              e,
            );
          }
        }

        if (auth.resourceId) {
          try {
            const teamIds = await this.lookupResourceTeams(auth.resourceId);
            auth.teamIds = teamIds;
          } catch (e) {
            console.warn(
              `[socket.io] Could not resolve teams for resource ${auth.resourceId}`,
              e,
            );
          }
        }

        (socket.data as { auth: SocketAuthBinding }).auth = auth;
        next();
      } catch (e) {
        next(new Error(`Auth failed: ${(e as Error).message}`));
      }
    });

    io.on("connection", (socket) => this.handleConnection(socket));

    this.io = io;
    console.log("[socket.io] Server initialized on /socket.io");
  }

  private extractToken(socket: Socket): string | null {
    const fromAuth =
      (socket.handshake.auth as { token?: string } | undefined)?.token ??
      undefined;
    if (fromAuth) return fromAuth;
    const fromQuery = socket.handshake.query?.token;
    if (typeof fromQuery === "string") return fromQuery;
    if (Array.isArray(fromQuery) && fromQuery.length > 0) return fromQuery[0];
    const authHeader = socket.handshake.headers["authorization"];
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }
    return null;
  }

  private async lookupResourceTeams(resourceId: string): Promise<string[]> {
    const { db } = await import("./db");
    const { teamMembers, teams } = await import("@shared/schema");
    const { eq, and, isNull } = await import("drizzle-orm");
    const rows = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(
        and(eq(teamMembers.resourceId, resourceId), isNull(teams.deletedAt)),
      );
    return rows.map((r) => r.teamId);
  }

  private handleConnection(socket: Socket) {
    const auth = (socket.data as { auth?: SocketAuthBinding }).auth;
    if (!auth) {
      socket.disconnect(true);
      return;
    }

    const rooms: string[] = [];
    if (auth.resourceId) rooms.push(`resource:${auth.resourceId}`);
    if (auth.tenantId) rooms.push(`tenant:${auth.tenantId}`);
    if (auth.userId) rooms.push(`user:${auth.userId}`);
    for (const teamId of auth.teamIds) rooms.push(`team:${teamId}`);
    if (rooms.length > 0) socket.join(rooms);

    console.log(
      `[socket.io] Client connected (${auth.resourceId ? `resource=${auth.resourceId}` : `user=${auth.userId}`} tenant=${auth.tenantId ?? "?"} teams=${auth.teamIds.length}). Rooms: ${rooms.join(", ")}`,
    );

    socket.emit("connected", {
      message: "Ansluten till notifikationstjänsten",
      timestamp: new Date().toISOString(),
      rooms,
    });

    socket.on("ping", () => {
      socket.emit("pong", { timestamp: new Date().toISOString() });
    });

    socket.on("join", (payload: { rooms?: string[] } | undefined) => {
      // Client may request additional rooms; only allow rooms the client is
      // already authorised for (resource:self / tenant:self / team:any-of-mine).
      if (!payload || !Array.isArray(payload.rooms)) return;
      const allowed = new Set(rooms);
      const requested = payload.rooms.filter((r) => allowed.has(r));
      if (requested.length > 0) socket.join(requested);
    });

    socket.on("position_update", async (payload: IncomingPositionUpdate) => {
      try {
        if (!auth.resourceId) return;
        if (
          typeof payload?.latitude !== "number" ||
          typeof payload?.longitude !== "number"
        ) {
          return;
        }
        const handler = this.positionHandler;
        if (!handler) return;
        await handler({
          resourceId: auth.resourceId,
          latitude: payload.latitude,
          longitude: payload.longitude,
          speed: payload.speed,
          heading: payload.heading,
          accuracy: payload.accuracy,
          status: payload.status ?? "traveling",
          workOrderId: payload.workOrderId,
        });
      } catch (e) {
        console.error(`[socket.io] position_update handler failed:`, e);
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(
        `[socket.io] Client disconnected (${auth.resourceId ?? auth.userId ?? "unknown"}): ${reason}`,
      );
    });
  }

  isReady(): boolean {
    return this.io !== null;
  }

  emitToResource(resourceId: string, event: string, payload: unknown) {
    const room = this.io?.to(`resource:${resourceId}`);
    for (const name of canonicalEventNames(event)) room?.emit(name, payload);
  }

  emitToTenant(tenantId: string, event: string, payload: unknown) {
    const room = this.io?.to(`tenant:${tenantId}`);
    for (const name of canonicalEventNames(event)) room?.emit(name, payload);
  }

  emitToTeam(teamId: string, event: string, payload: unknown) {
    const room = this.io?.to(`team:${teamId}`);
    for (const name of canonicalEventNames(event)) room?.emit(name, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    const room = this.io?.to(`user:${userId}`);
    for (const name of canonicalEventNames(event)) room?.emit(name, payload);
  }

  // Force any open Socket.io connections for `resourceId` to leave the
  // `team:<teamId>` room, so that a member who just left a team stops
  // receiving that team's events without waiting for reconnect.
  evictResourceFromTeam(resourceId: string, teamId: string) {
    if (!this.io) return;
    const room = `team:${teamId}`;
    const sockets = this.io.sockets.sockets;
    for (const socket of sockets.values()) {
      const auth = (socket.data as { auth?: SocketAuthBinding }).auth;
      if (!auth || auth.resourceId !== resourceId) continue;
      if (socket.rooms.has(room)) {
        socket.leave(room);
        auth.teamIds = auth.teamIds.filter((t) => t !== teamId);
      }
    }
  }

  // Add `resourceId` to `team:<teamId>` room on currently-open sockets so
  // a newly accepted invite/added member receives team events immediately.
  joinResourceToTeam(resourceId: string, teamId: string) {
    if (!this.io) return;
    const room = `team:${teamId}`;
    const sockets = this.io.sockets.sockets;
    for (const socket of sockets.values()) {
      const auth = (socket.data as { auth?: SocketAuthBinding }).auth;
      if (!auth || auth.resourceId !== resourceId) continue;
      if (!socket.rooms.has(room)) {
        socket.join(room);
        if (!auth.teamIds.includes(teamId)) auth.teamIds.push(teamId);
      }
    }
  }
}

// Map a single logical event name to all the variants we want to emit so
// Go clients can listen on either naming convention. The Traivo Go report
// (Section 14) lists `order:assigned, order:updated, job_assigned,
// job_updated, job_cancelled, schedule_changed, priority_changed,
// anomaly_alert, notification, position_update, team:order_updated,
// team:material_logged, team:member_left, team:invite, pong`. We additionally
// publish colon-style aliases (`order:status_changed`, `position:updated`,
// `team:invitation`, `notification:new`) so consumers wired to either
// convention receive the same payload.
function canonicalEventNames(event: string): string[] {
  switch (event) {
    case "order:updated":
      return ["order:updated", "order:status_changed"];
    case "position_update":
      return ["position_update", "position:updated"];
    case "team:invite":
      return ["team:invite", "team:invitation"];
    case "notification":
      return ["notification", "notification:new"];
    default:
      return [event];
  }
}

export const socketIoBridge = new SocketIoBridge();
