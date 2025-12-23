import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { WorkOrder } from "@shared/schema";
import { storage } from "./storage";
import crypto from "crypto";

interface WorkOrderWithDetails extends WorkOrder {
  objectName?: string;
  objectAddress?: string;
}

export type NotificationType = 
  | "job_assigned" 
  | "job_updated" 
  | "job_cancelled" 
  | "schedule_changed"
  | "priority_changed";

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
  connectedAt: Date;
}

interface AuthToken {
  resourceId: string;
  expiresAt: number;
}

class NotificationService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ConnectedClient[]> = new Map();
  private validatedResources: Set<string> = new Set();
  private authTokens: Map<string, AuthToken> = new Map();
  private tokenExpiryMs = 5 * 60 * 1000; // 5 minutes

  generateAuthToken(resourceId: string): string {
    const token = crypto.randomBytes(32).toString("hex");
    this.authTokens.set(token, {
      resourceId,
      expiresAt: Date.now() + this.tokenExpiryMs,
    });
    
    // Clean up expired tokens periodically
    this.cleanupExpiredTokens();
    
    return token;
  }

  private cleanupExpiredTokens() {
    const now = Date.now();
    for (const [token, data] of this.authTokens.entries()) {
      if (data.expiresAt < now) {
        this.authTokens.delete(token);
      }
    }
  }

  private validateAuthToken(token: string): string | null {
    const data = this.authTokens.get(token);
    if (!data) return null;
    if (data.expiresAt < Date.now()) {
      this.authTokens.delete(token);
      return null;
    }
    // Token is single-use - remove after validation
    this.authTokens.delete(token);
    return data.resourceId;
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
      
      const resourceId = this.validateAuthToken(token);
      if (!resourceId) {
        console.log(`[ws] Invalid or expired token rejected`);
        ws.close(4003, "Invalid or expired token");
        return;
      }

      this.addClient(resourceId, ws);
      console.log(`[ws] Resource ${resourceId} connected (token auth). Total clients: ${this.getTotalClients()}`);

      ws.send(JSON.stringify({
        type: "connected",
        message: "Ansluten till notifikationstjänsten",
        timestamp: new Date().toISOString()
      }));

      ws.on("close", () => {
        this.removeClient(resourceId, ws);
        console.log(`[ws] Resource ${resourceId} disconnected. Total clients: ${this.getTotalClients()}`);
      });

      ws.on("error", (error) => {
        console.error(`[ws] Error for resource ${resourceId}:`, error);
        this.removeClient(resourceId, ws);
      });

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
          }
        } catch (e) {
          // Ignore invalid messages
        }
      });
    });

    console.log("[ws] Notification service initialized on /ws/notifications");
  }

  private addClient(resourceId: string, ws: WebSocket) {
    const existing = this.clients.get(resourceId) || [];
    existing.push({ ws, resourceId, connectedAt: new Date() });
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

  private generateId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  sendToResource(resourceId: string, notification: Omit<Notification, "id" | "timestamp">) {
    const clients = this.clients.get(resourceId);
    if (!clients || clients.length === 0) {
      console.log(`[ws] No connected clients for resource ${resourceId}`);
      return;
    }

    const fullNotification: Notification = {
      ...notification,
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      resourceId
    };

    const message = JSON.stringify(fullNotification);
    
    clients.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
        console.log(`[ws] Sent ${notification.type} to resource ${resourceId}`);
      }
    });
  }

  broadcastToAll(notification: Omit<Notification, "id" | "timestamp" | "resourceId">) {
    const fullNotification = {
      ...notification,
      id: this.generateId(),
      timestamp: new Date().toISOString()
    };

    const message = JSON.stringify(fullNotification);
    
    this.clients.forEach((clients, resourceId) => {
      clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(message);
        }
      });
    });
    
    console.log(`[ws] Broadcast ${notification.type} to ${this.getTotalClients()} clients`);
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
        status: order.status
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
}

export const notificationService = new NotificationService();
