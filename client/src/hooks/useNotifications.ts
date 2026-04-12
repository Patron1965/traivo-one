import { useState, useEffect, useCallback, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import type { ServerEvent, WsEventType } from "@shared/ws-events";
import { validateServerEvent, WS_EVENT_TYPES } from "@shared/ws-events";

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

const NOTIFICATION_TYPES_WITH_UI: ReadonlySet<string> = new Set([
  "job_assigned",
  "job_updated",
  "job_cancelled",
  "schedule_changed",
  "priority_changed",
  "order:updated",
  "anomaly_alert",
  "route_update",
  "route_optimized",
  "notification",
]);

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
          const eventData = validated || raw;
          const eventType: string = eventData.type;

          if (eventType === "connected" || eventType === "pong" || eventType === "position_update") {
            return;
          }

          if (NOTIFICATION_TYPES_WITH_UI.has(eventType)) {
            const notification: Notification = {
              id: eventData.id || crypto.randomUUID(),
              type: eventType as WsEventType,
              title: eventData.title || "",
              message: eventData.message || "",
              workOrderId: eventData.orderId,
              timestamp: new Date(),
              read: false,
              data: eventData.data as Record<string, unknown> | undefined,
            };
            setNotifications((prev) => [notification, ...prev].slice(0, 50));
            onNotification?.(notification);

            if (eventType === "route_optimized") {
              const jobId = (eventData.data as Record<string, unknown>)?.jobId;
              window.dispatchEvent(new CustomEvent("traivo:optimization_complete", {
                detail: { jobId },
              }));
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
