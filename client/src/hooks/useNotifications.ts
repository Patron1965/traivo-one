import { useState, useEffect, useCallback, useRef } from "react";

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
  read?: boolean;
}

interface UseNotificationsOptions {
  resourceId: string;
  onNotification?: (notification: Notification) => void;
  autoConnect?: boolean;
  reconnectInterval?: number;
}

interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  isConnected: boolean;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
  connect: () => void;
  disconnect: () => void;
}

async function fetchNotificationToken(resourceId: string): Promise<string | null> {
  try {
    const response = await fetch("/api/notifications/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId }),
    });
    
    if (!response.ok) {
      console.error("[ws] Failed to get notification token:", response.status);
      return null;
    }
    
    const data = await response.json();
    return data.token;
  } catch (error) {
    console.error("[ws] Error fetching notification token:", error);
    return null;
  }
}

export function useNotifications({
  resourceId,
  onNotification,
  autoConnect = true,
  reconnectInterval = 5000,
}: UseNotificationsOptions): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(autoConnect);
  const onNotificationRef = useRef(onNotification);
  const connectingRef = useRef(false);

  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN || connectingRef.current) {
      return;
    }

    connectingRef.current = true;
    
    // First, get an auth token
    const token = await fetchNotificationToken(resourceId);
    if (!token) {
      console.error("[ws] Could not get notification token");
      connectingRef.current = false;
      
      // Retry after interval
      if (shouldReconnectRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log("[ws] Retrying token fetch...");
          connect();
        }, reconnectInterval);
      }
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/notifications?token=${encodeURIComponent(token)}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[ws] Connected to notification service");
      setIsConnected(true);
      connectingRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    ws.onclose = () => {
      console.log("[ws] Disconnected from notification service");
      setIsConnected(false);
      wsRef.current = null;
      connectingRef.current = false;
      
      if (shouldReconnectRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log("[ws] Attempting to reconnect...");
          connect();
        }, reconnectInterval);
      }
    };

    ws.onerror = (error) => {
      console.error("[ws] WebSocket error:", error);
      connectingRef.current = false;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === "connected" || data.type === "pong") {
          return;
        }

        const notification: Notification = {
          ...data,
          read: false,
        };

        setNotifications((prev) => [notification, ...prev].slice(0, 50));

        if (onNotificationRef.current) {
          onNotificationRef.current(notification);
        }
      } catch (e) {
        console.error("[ws] Failed to parse message:", e);
      }
    };
  }, [resourceId, reconnectInterval]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const markAsRead = useCallback((notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    shouldReconnectRef.current = autoConnect;
    if (autoConnect && resourceId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, resourceId, connect, disconnect]);

  useEffect(() => {
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    return () => clearInterval(pingInterval);
  }, []);

  return {
    notifications,
    unreadCount,
    isConnected,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    connect,
    disconnect,
  };
}
