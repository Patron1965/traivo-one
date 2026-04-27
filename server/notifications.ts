import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { WorkOrder, InsertResourcePosition } from "@shared/schema";
import { storage } from "./storage";
import { sendNotification, NotificationType as UnifiedNotificationType } from "./unified-notifications";
import crypto from "crypto";
import {
  validateServerEvent,
  validateClientEvent,
  type WsEventType,
} from "@shared/ws-events";

interface WorkOrderWithDetails extends WorkOrder {
  objectName?: string;
  objectAddress?: string;
}

export interface PositionUpdate {
  resourceId: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  status?: "traveling" | "on_site" | "idle";
  workOrderId?: string;
}

export type NotificationType = WsEventType;

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  orderId?: string;
  resourceId?: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

interface ConnectedClient {
  ws: WebSocket;
  resourceId: string;
  tenantId: string | null;
  connectedAt: Date;
}

interface AuthToken {
  resourceId?: string;
  userId?: string;
  tenantId?: string | null;
  expiresAt: number;
}

interface UserClient {
  ws: WebSocket;
  userId: string;
  tenantId: string | null;
  connectedAt: Date;
}

class NotificationService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ConnectedClient[]> = new Map();
  private userClients: Map<string, UserClient[]> = new Map();
  private validatedResources: Set<string> = new Set();
  private authTokens: Map<string, AuthToken> = new Map();
  private tokenExpiryMs = 5 * 60 * 1000; // 5 minutes
  private lastPositionBroadcast: Map<string, { timestamp: number; pending: PositionUpdate | null }> = new Map();
  private positionBroadcastTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private positionBroadcastIntervalMs = 30_000;

  generateAuthToken(resourceId: string, tenantId?: string | null): string {
    const token = crypto.randomBytes(32).toString("hex");
    this.authTokens.set(token, {
      resourceId,
      tenantId: tenantId ?? null,
      expiresAt: Date.now() + this.tokenExpiryMs,
    });

    // Clean up expired tokens periodically
    this.cleanupExpiredTokens();

    return token;
  }

  generateUserAuthToken(userId: string, tenantId?: string | null): string {
    const token = crypto.randomBytes(32).toString("hex");
    this.authTokens.set(token, {
      userId,
      tenantId: tenantId ?? null,
      expiresAt: Date.now() + this.tokenExpiryMs,
    });
    this.cleanupExpiredTokens();
    return token;
  }

  private cleanupExpiredTokens() {
    const now = Date.now();
    const entries = Array.from(this.authTokens.entries());
    for (const [token, data] of entries) {
      if (data.expiresAt < now) {
        this.authTokens.delete(token);
      }
    }
  }

  private validateAuthToken(token: string): { resourceId?: string; userId?: string; tenantId?: string | null } | null {
    const data = this.authTokens.get(token);
    if (!data) return null;
    if (data.expiresAt < Date.now()) {
      this.authTokens.delete(token);
      return null;
    }
    // Token is single-use - remove after validation
    this.authTokens.delete(token);
    return { resourceId: data.resourceId, userId: data.userId, tenantId: data.tenantId ?? null };
  }
  
  initialize(server: Server) {
    this.wss = new WebSocketServer({ 
      server,
      path: "/ws/notifications"
    });

    this.wss.on("connection", async (ws, req) => {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const token = url.searchParams.get("token");
      
      // Token-based authentication is required
      if (!token) {
        console.log(`[ws] Connection rejected: token required`);
        ws.close(4001, "Authentication token required");
        return;
      }
      
      const binding = this.validateAuthToken(token);
      if (!binding || (!binding.resourceId && !binding.userId)) {
        console.log(`[ws] Invalid or expired token rejected`);
        ws.close(4003, "Invalid or expired token");
        return;
      }

      const resourceId = binding.resourceId;
      const userId = binding.userId;
      let tenantId = binding.tenantId ?? null;

      // Fallback: härled tenantId från resource/user om token saknar det (bakåtkompatibilitet).
      if (!tenantId && resourceId) {
        try {
          const r = await storage.getResource(resourceId);
          if (r?.tenantId) tenantId = r.tenantId;
        } catch (e) {
          console.warn(`[ws] Could not resolve tenant for resource ${resourceId}:`, e);
        }
      }

      if (resourceId) {
        this.addClient(resourceId, ws, tenantId);
        console.log(`[ws] Resource ${resourceId} connected (tenant=${tenantId ?? "?"}). Total clients: ${this.getTotalClients()}`);
      } else if (userId) {
        this.addUserClient(userId, ws, tenantId);
        console.log(`[ws] User ${userId} connected (tenant=${tenantId ?? "?"}). Total user clients: ${this.getTotalUserClients()}`);
      }

      ws.send(JSON.stringify({
        type: "connected",
        message: "Ansluten till notifikationstjänsten",
        timestamp: new Date().toISOString()
      }));

      ws.on("close", () => {
        if (resourceId) {
          this.removeClient(resourceId, ws);
          console.log(`[ws] Resource ${resourceId} disconnected. Total clients: ${this.getTotalClients()}`);
        } else if (userId) {
          this.removeUserClient(userId, ws);
          console.log(`[ws] User ${userId} disconnected. Total user clients: ${this.getTotalUserClients()}`);
        }
      });

      ws.on("error", (error) => {
        if (resourceId) {
          console.error(`[ws] Error for resource ${resourceId}:`, error);
          this.removeClient(resourceId, ws);
        } else if (userId) {
          console.error(`[ws] Error for user ${userId}:`, error);
          this.removeUserClient(userId, ws);
        }
      });

      ws.on("message", async (data) => {
        try {
          const raw = JSON.parse(data.toString());
          const parsed = validateClientEvent(raw);
          if (!parsed) {
            if (raw?.type === "ping") {
              ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
            }
            return;
          }
          if (parsed.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
          } else if (parsed.type === "position_update" && resourceId) {
            const positionData: PositionUpdate = {
              resourceId,
              latitude: parsed.latitude,
              longitude: parsed.longitude,
              speed: parsed.speed,
              heading: parsed.heading,
              accuracy: parsed.accuracy,
              status: parsed.status || "traveling",
              workOrderId: parsed.workOrderId
            };
            await this.handlePositionUpdate(positionData);
          }
        } catch (e) {
          // Ignore invalid messages
        }
      });
    });

    console.log("[ws] Notification service initialized on /ws/notifications");
  }

  private addClient(resourceId: string, ws: WebSocket, tenantId: string | null) {
    const existing = this.clients.get(resourceId) || [];
    existing.push({ ws, resourceId, tenantId, connectedAt: new Date() });
    this.clients.set(resourceId, existing);
  }

  private removeClient(resourceId: string, ws: WebSocket) {
    const existing = this.clients.get(resourceId) || [];
    const filtered = existing.filter(c => c.ws !== ws);
    if (filtered.length === 0) {
      this.clients.delete(resourceId);
    } else {
      this.clients.set(resourceId, filtered);
    }
  }

  private getTotalClients(): number {
    let total = 0;
    this.clients.forEach(clients => total += clients.length);
    return total;
  }

  private addUserClient(userId: string, ws: WebSocket, tenantId: string | null) {
    const existing = this.userClients.get(userId) || [];
    existing.push({ ws, userId, tenantId, connectedAt: new Date() });
    this.userClients.set(userId, existing);
  }

  private removeUserClient(userId: string, ws: WebSocket) {
    const existing = this.userClients.get(userId) || [];
    const filtered = existing.filter(c => c.ws !== ws);
    if (filtered.length === 0) {
      this.userClients.delete(userId);
    } else {
      this.userClients.set(userId, filtered);
    }
  }

  private getTotalUserClients(): number {
    let total = 0;
    this.userClients.forEach(clients => total += clients.length);
    return total;
  }

  isUserConnected(userId: string): boolean {
    const clients = this.userClients.get(userId);
    return clients !== undefined && clients.length > 0;
  }

  /**
   * Push an in-app user notification (matching the user_notifications row that
   * was just persisted) live to that user's connected browser sessions, so the
   * header bell can update without waiting for the 30s polling cycle.
   */
  sendUserNotification(
    userId: string,
    notification: {
      notificationId?: string;
      type: string;
      title: string;
      message: string;
      link?: string | null;
      data?: Record<string, unknown>;
      createdAt?: string;
    },
  ) {
    const clients = this.userClients.get(userId);
    if (!clients || clients.length === 0) return;

    const payload = {
      type: "notification" as const,
      id: notification.notificationId || this.generateId(),
      title: notification.title,
      message: notification.message,
      timestamp: notification.createdAt || new Date().toISOString(),
      data: {
        ...(notification.data || {}),
        notificationType: notification.type,
        link: notification.link ?? undefined,
        userId,
      },
    };

    const validated = validateServerEvent(payload);
    if (!validated) {
      console.warn(`[ws] User notification validation failed for type="${notification.type}", sending anyway`);
    }

    const message = JSON.stringify(payload);
    let sent = 0;
    clients.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
        sent++;
      }
    });
    if (sent > 0) {
      console.log(`[ws] Live notification (${notification.type}) pushed to user ${userId} on ${sent} session(s)`);
    }
  }

  private generateId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async sendToResource(resourceId: string, notification: Omit<Notification, "id" | "timestamp">) {
    const fullNotification: Notification = {
      ...notification,
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      resourceId
    };

    const validated = validateServerEvent(fullNotification);
    if (!validated) {
      console.warn(`[ws] Event validation failed for type="${notification.type}", sending anyway for backward compatibility`);
    }

    try {
      const resource = await storage.getResource(resourceId);
      if (resource) {
        await storage.createDriverNotification({
          tenantId: resource.tenantId,
          resourceId,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          orderId: notification.orderId || null,
          data: notification.data || {},
          isRead: false,
        });
      }
    } catch (e) {
      console.error(`[ws] Failed to persist notification for ${resourceId}:`, e);
    }

    const clients = this.clients.get(resourceId);
    if (!clients || clients.length === 0) {
      console.log(`[ws] No connected clients for resource ${resourceId}, notification persisted for polling`);
      return;
    }

    const message = JSON.stringify(fullNotification);
    
    clients.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
        console.log(`[ws] Sent ${notification.type} to resource ${resourceId}`);
      }
    });
  }

  broadcastToAll(
    notification: Omit<Notification, "id" | "timestamp" | "resourceId">,
    tenantId?: string | null,
  ) {
    const fullNotification = {
      ...notification,
      id: this.generateId(),
      timestamp: new Date().toISOString()
    };

    const validated = validateServerEvent(fullNotification);
    if (!validated) {
      console.warn(`[ws] Broadcast validation failed for type="${notification.type}", sending anyway for backward compatibility`);
    }

    const message = JSON.stringify(fullNotification);
    let sent = 0;

    this.clients.forEach((clients) => {
      clients.forEach(client => {
        if (client.ws.readyState !== WebSocket.OPEN) return;
        // Tenant-isolation: skicka bara om klientens tenant matchar (eller inget filter angetts).
        if (tenantId && client.tenantId !== tenantId) return;
        client.ws.send(message);
        sent++;
      });
    });
    this.userClients.forEach((clients) => {
      clients.forEach(client => {
        if (client.ws.readyState !== WebSocket.OPEN) return;
        if (tenantId && client.tenantId !== tenantId) return;
        client.ws.send(message);
        sent++;
      });
    });

    console.log(`[ws] Broadcast ${notification.type} to ${sent} clients${tenantId ? ` (tenant=${tenantId})` : ""}`);
  }

  async sendCustomerNotification(
    notificationType: UnifiedNotificationType,
    tenantId: string,
    customer: { phone?: string; email?: string; name?: string },
    resourceName: string,
    data: Record<string, unknown>
  ) {
    try {
      if (!customer.phone && !customer.email) {
        console.log(`[notification] No phone/email for customer, skipping external notification`);
        return;
      }
      
      const channel = customer.phone && customer.email ? "both" : (customer.phone ? "sms" : "email");
      
      await sendNotification({
        tenantId,
        recipients: [{ phone: customer.phone, email: customer.email, name: customer.name }],
        notificationType,
        channel,
        data: { ...data, resourceName } as Record<string, any>
      });
      
      console.log(`[notification] External ${notificationType} sent to ${customer.name || customer.phone || customer.email}`);
    } catch (error) {
      console.error(`[notification] Failed to send external notification:`, error);
    }
  }

  notifyJobAssigned(order: WorkOrderWithDetails, resourceId: string) {
    this.sendToResource(resourceId, {
      type: "job_assigned",
      title: "Nytt jobb tilldelat",
      message: `${order.title} har tilldelats dig`,
      orderId: order.id,
      data: {
        scheduledDate: order.scheduledDate,
        scheduledStartTime: order.scheduledStartTime,
        objectName: order.objectName,
        objectAddress: order.objectAddress,
        priority: order.priority
      }
    });
    
  }

  notifyJobUpdated(order: WorkOrderWithDetails, resourceId: string, changeDescription: string) {
    this.sendToResource(resourceId, {
      type: "job_updated",
      title: "Jobb uppdaterat",
      message: changeDescription,
      orderId: order.id,
      data: {
        scheduledDate: order.scheduledDate,
        scheduledStartTime: order.scheduledStartTime,
        status: order.orderStatus
      }
    });
  }

  notifyScheduleChanged(order: WorkOrderWithDetails, resourceId: string, oldDate?: string, newDate?: string) {
    this.sendToResource(resourceId, {
      type: "schedule_changed",
      title: "Schemaändring",
      message: `${order.title} har flyttats${newDate ? ` till ${newDate}` : ""}`,
      orderId: order.id,
      data: {
        oldDate,
        newDate,
        scheduledStartTime: order.scheduledStartTime
      }
    });
    
  }

  notifyJobCancelled(order: WorkOrderWithDetails, resourceId: string) {
    this.sendToResource(resourceId, {
      type: "job_cancelled",
      title: "Jobb avbokat",
      message: `${order.title} har avbokats`,
      orderId: order.id
    });
  }

  notifyPriorityChanged(order: WorkOrderWithDetails, resourceId: string, oldPriority: string) {
    const priorityLabels: Record<string, string> = {
      low: "Låg",
      normal: "Normal",
      high: "Hög",
      urgent: "Brådskande"
    };
    
    this.sendToResource(resourceId, {
      type: "priority_changed",
      title: "Prioritet ändrad",
      message: `${order.title} har nu prioritet: ${priorityLabels[order.priority] || order.priority}`,
      orderId: order.id,
      data: {
        oldPriority,
        newPriority: order.priority
      }
    });
  }

  getConnectedResources(): string[] {
    return Array.from(this.clients.keys());
  }

  isResourceConnected(resourceId: string): boolean {
    const clients = this.clients.get(resourceId);
    return clients !== undefined && clients.length > 0;
  }

  // Handle position update from mobile app
  async handlePositionUpdate(position: PositionUpdate) {
    try {
      // Update resource's current position
      await storage.updateResourcePosition(position.resourceId, {
        currentLatitude: position.latitude,
        currentLongitude: position.longitude,
        lastPositionUpdate: new Date(),
        trackingStatus: position.status || "traveling"
      });

      // Save to position history for breadcrumb trail
      await storage.createResourcePosition({
        resourceId: position.resourceId,
        latitude: position.latitude,
        longitude: position.longitude,
        speed: position.speed,
        heading: position.heading,
        accuracy: position.accuracy,
        status: position.status || "traveling",
        workOrderId: position.workOrderId
      });

      // Broadcast to planners listening for position updates
      this.broadcastPositionUpdate(position);
      
      console.log(`[ws] Position updated for resource ${position.resourceId}: ${position.latitude}, ${position.longitude}`);
    } catch (error) {
      console.error(`[ws] Failed to save position update:`, error);
    }
  }

  private broadcastPositionUpdate(position: PositionUpdate) {
    const now = Date.now();
    const entry = this.lastPositionBroadcast.get(position.resourceId);

    if (entry && (now - entry.timestamp) < this.positionBroadcastIntervalMs) {
      entry.pending = position;
      if (!this.positionBroadcastTimers.has(position.resourceId)) {
        const delay = this.positionBroadcastIntervalMs - (now - entry.timestamp);
        const timerId = setTimeout(() => {
          const current = this.lastPositionBroadcast.get(position.resourceId);
          if (current?.pending) {
            void this.doBroadcastPosition(current.pending);
            current.timestamp = Date.now();
            current.pending = null;
          }
          this.positionBroadcastTimers.delete(position.resourceId);
        }, delay);
        this.positionBroadcastTimers.set(position.resourceId, timerId);
      }
      return;
    }

    void this.doBroadcastPosition(position);
    this.lastPositionBroadcast.set(position.resourceId, { timestamp: now, pending: null });
  }

  private async doBroadcastPosition(position: PositionUpdate) {
    const payload = {
      type: "position_update" as const,
      resourceId: position.resourceId,
      latitude: position.latitude,
      longitude: position.longitude,
      speed: position.speed,
      heading: position.heading,
      status: position.status,
      workOrderId: position.workOrderId,
      timestamp: new Date().toISOString()
    };

    const validated = validateServerEvent(payload);
    if (!validated) {
      console.warn(`[ws] Position broadcast validation failed, sending anyway`);
    }

    const message = JSON.stringify(payload);

    // Härled tenantId från sändarens connectade klient (om vi inte redan vet det).
    let senderTenantId: string | null = null;
    const senderClients = this.clients.get(position.resourceId);
    if (senderClients && senderClients.length > 0) {
      senderTenantId = senderClients[0].tenantId;
    }
    if (!senderTenantId) {
      try {
        const r = await storage.getResource(position.resourceId);
        senderTenantId = r?.tenantId ?? null;
      } catch {
        // tyst — om vi inte kan slå upp tenant skickar vi inte alls (säkrast)
        senderTenantId = null;
      }
    }
    if (!senderTenantId) {
      console.warn(`[ws] Position broadcast skipped: no tenant for resource ${position.resourceId}`);
      return;
    }

    // Skicka bara till klienter inom samma tenant (utom till själva sändaren).
    this.clients.forEach((clients, resourceId) => {
      if (resourceId === position.resourceId) return;
      clients.forEach(client => {
        if (client.ws.readyState !== WebSocket.OPEN) return;
        if (client.tenantId !== senderTenantId) return;
        client.ws.send(message);
      });
    });
    this.userClients.forEach((clients) => {
      clients.forEach(client => {
        if (client.ws.readyState !== WebSocket.OPEN) return;
        if (client.tenantId !== senderTenantId) return;
        client.ws.send(message);
      });
    });
  }

  // Get all connected resource positions (for initial load)
  getConnectedResourcePositions(): string[] {
    return Array.from(this.clients.keys());
  }

  // Broadcast system-wide alert to ALL connected clients (planners + resources)
  // within a tenant. Pass tenantId to isolate; omit only for global system messages.
  broadcastSystemAlert(
    notification: Omit<Notification, "id" | "timestamp">,
    tenantId?: string | null,
  ) {
    const fullNotification: Notification = {
      ...notification,
      id: this.generateId(),
      timestamp: new Date().toISOString()
    };

    const validated = validateServerEvent(fullNotification);
    if (!validated) {
      console.warn(`[ws] System alert validation failed for type="${notification.type}", sending anyway for backward compatibility`);
    }

    const message = JSON.stringify(fullNotification);
    let sentCount = 0;

    this.clients.forEach((clients) => {
      clients.forEach(client => {
        if (client.ws.readyState !== WebSocket.OPEN) return;
        if (tenantId && client.tenantId !== tenantId) return;
        client.ws.send(message);
        sentCount++;
      });
    });
    this.userClients.forEach((clients) => {
      clients.forEach(client => {
        if (client.ws.readyState !== WebSocket.OPEN) return;
        if (tenantId && client.tenantId !== tenantId) return;
        client.ws.send(message);
        sentCount++;
      });
    });

    if (sentCount > 0) {
      console.log(`[ws] System alert broadcasted to ${sentCount} clients${tenantId ? ` (tenant=${tenantId})` : ""}: ${notification.title}`);
    }
    return fullNotification;
  }
}

export const notificationService = new NotificationService();
