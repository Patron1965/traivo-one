import { useState, useEffect, useCallback, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  validateServerEvent,
  type ServerEvent,
  type WsEventType,
} from "@shared/ws-events";

export interface Notification {
  id: string;
  type: WsEventType;
  title: string;
  message: string;
  workOrderId?: string;
  timestamp: Date;
  read: boolean;
  data?: Record<string, unknown>;
}

interface UseNotificationsOptions {
  resourceId: string;
  onNotification?: (notification: Notification) => void;
  autoConnect?: boolean;
}

interface UseNotificationsResult {
  notifications: Notification[];
  unreadCount: number;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  markAsRead: (notificationId: string) => void;
  clearAll: () => void;
}

function isNotifiableEvent(event: ServerEvent): event is Exclude<ServerEvent, { type: "connected" | "pong" | "position_update" }> {
  return event.type !== "connected" && event.type !== "pong" && event.type !== "position_update";
}

function extractNotification(event: ServerEvent): Notification | null {
  if (!isNotifiableEvent(event)) return null;

  return {
    id: "id" in event ? event.id : crypto.randomUUID(),
    type: event.type,
    title: "title" in event ? event.title : "",
    message: "message" in event ? event.message : "",
    workOrderId: "orderId" in event ? event.orderId : undefined,
    timestamp: new Date(),
    read: false,
    data: "data" in event && event.data ? event.data as Record<string, unknown> : undefined,
  };
}

function handleOptimizationEvent(event: ServerEvent) {
  if (event.type === "optimization_complete" || event.type === "route_optimized") {
    const jobId = event.data?.jobId;
    window.dispatchEvent(new CustomEvent("traivo:optimization_complete", {
      detail: { jobId },
    }));
  }
}

export function useNotifications({
  resourceId,
  onNotification,
  autoConnect = true,
}: UseNotificationsOptions): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<string | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const connect = useCallback(async () => {
    if (!resourceId || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const response = await apiRequest("POST", "/api/notifications/token", {
        resourceId,
      });
      
      if (!response.ok) {
        console.error("[Notifications] Token request failed:", response.status);
        return;
      }
      
      const data = await response.json();
      tokenRef.current = data.token;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws/notifications?token=${data.token}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        console.log("[Notifications] WebSocket connected");
      };

      ws.onmessage = (event) => {
        try {
          const raw = JSON.parse(event.data);
          const validated = validateServerEvent(raw);

          if (validated) {
            handleOptimizationEvent(validated);
            const notification = extractNotification(validated);
            if (notification) {
              setNotifications((prev) => [notification, ...prev].slice(0, 50));
              onNotification?.(notification);
            }
          } else {
            if (raw?.type === "optimization_complete" || raw?.type === "route_optimized") {
              window.dispatchEvent(new CustomEvent("traivo:optimization_complete", {
                detail: { jobId: raw?.data?.jobId },
              }));
            }
            if (raw?.type && raw?.title) {
              const fallbackNotification: Notification = {
                id: raw.id || crypto.randomUUID(),
                type: raw.type,
                title: raw.title,
                message: raw.message || "",
                workOrderId: raw.orderId,
                timestamp: new Date(),
                read: false,
                data: raw.data,
              };
              setNotifications((prev) => [fallbackNotification, ...prev].slice(0, 50));
              onNotification?.(fallbackNotification);
            }
          }
        } catch (err) {
          console.error("[Notifications] Failed to parse message:", err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        console.log("[Notifications] WebSocket disconnected");
        
        if (autoConnect && resourceId) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 10000);
        }
      };

      ws.onerror = (error) => {
        console.error("[Notifications] WebSocket error:", error);
      };
    } catch (err) {
      console.error("[Notifications] Failed to get token:", err);
      setIsConnected(false);
    }
  }, [resourceId, onNotification, autoConnect]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const markAsRead = useCallback((notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    );
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  useEffect(() => {
    if (autoConnect && resourceId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [resourceId, autoConnect, connect, disconnect]);

  return {
    notifications,
    unreadCount,
    isConnected,
    connect,
    disconnect,
    markAsRead,
    clearAll,
  };
}
