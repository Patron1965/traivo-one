import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { getApiUrl } from '../lib/query-client';
import type { Notification } from '../types';

type WSEvent =
  | { type: 'order:updated'; data: { orderId: string | number; status: string; updatedAt: string } }
  | { type: 'order:assigned'; data: { orderId: string | number } }
  | { type: 'notification'; data: Notification }
  | { type: 'team:order_updated'; data: { orderId: string | number; status: string; updatedBy: string; updatedAt: string } }
  | { type: 'team:material_logged'; data: { orderId: string | number; entry: any } }
  | { type: 'team:member_left'; data: { resourceId: string | number; name: string } }
  | { type: 'team:invite'; data: { invite: any; teamName: string } }
  | { type: 'job_assigned'; data: { orderId: string | number; title: string; message: string; data?: any } }
  | { type: 'job_updated'; data: { orderId: string | number; title: string; message: string; data?: any } }
  | { type: 'job_cancelled'; data: { orderId: string | number; title: string; message: string } }
  | { type: 'schedule_changed'; data: { orderId: string | number; data?: { oldDate: string; newDate: string; scheduledStartTime: string } } }
  | { type: 'priority_changed'; data: { orderId: string | number; data?: { oldPriority: string; newPriority: string } } }
  | { type: 'anomaly_alert'; data: { id: string | number; title: string; message: string } }
  | { type: 'position_update'; data: { resourceId: string | number; latitude: number; longitude: number; speed: number; status: string } }
  | { type: 'route:optimized'; data: { jobId: string; resourceId: string; timestamp: string } }
  | { type: 'route:reoptimizing'; data: { reason: string; resourceId: string } };

type EventHandler = (event: WSEvent) => void;

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const BACKOFF_MULTIPLIER = 2;

export function useWebSocket(resourceId?: string | number, tenantId?: string, teamId?: string | number) {
  const queryClient = useQueryClient();
  const socketRef = useRef<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null);
  const handlersRef = useRef<EventHandler[]>([]);
  const connectionIdRef = useRef(0);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addHandler = useCallback((handler: EventHandler) => {
    handlersRef.current.push(handler);
    return () => {
      handlersRef.current = handlersRef.current.filter(h => h !== handler);
    };
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback((connId: number) => {
    clearReconnectTimer();
    if (connectionIdRef.current !== connId) return;

    const delay = backoffRef.current;
    backoffRef.current = Math.min(backoffRef.current * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);

    console.log(`[WebSocket] Scheduling reconnect in ${delay}ms`);
    reconnectTimerRef.current = setTimeout(() => {
      if (connectionIdRef.current === connId && resourceId) {
        connectInternal(connId);
      }
    }, delay);
  }, [resourceId]);

  const emitEvent = useCallback((connId: number, type: string, data: any) => {
    if (connectionIdRef.current !== connId) return;
    const event = { type, data } as WSEvent;
    setLastEvent(event);
    handlersRef.current.forEach(h => h(event));
  }, []);

  const connectInternal = useCallback(async (connId: number) => {
    if (connectionIdRef.current !== connId) return;

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    try {
      const { io } = await import('socket.io-client');

      if (connectionIdRef.current !== connId) return;

      const wsUrl = process.env.EXPO_PUBLIC_WS_URL || getApiUrl();
      const socket = io(wsUrl, {
        path: '/ws',
        transports: ['websocket', 'polling'],
        reconnection: false,
      });

      socket.on('connect', () => {
        if (connectionIdRef.current !== connId) {
          socket.disconnect();
          return;
        }
        setIsConnected(true);
        backoffRef.current = INITIAL_BACKOFF_MS;
        if (resourceId) {
          socket.emit('join', { resourceId: String(resourceId), tenantId, teamId: teamId ? String(teamId) : undefined });
        }
        pingIntervalRef.current = setInterval(() => {
          if (connectionIdRef.current === connId) {
            socket.emit('ping', { type: 'ping' });
          }
        }, 30000);
      });

      socket.on('disconnect', (reason: string) => {
        if (connectionIdRef.current !== connId) return;
        setIsConnected(false);
        if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
        console.log(`[WebSocket] Disconnected: ${reason}`);
        if (reason !== 'io client disconnect') {
          scheduleReconnect(connId);
        }
      });

      socket.on('connect_error', (err: Error) => {
        console.error('[WebSocket] Connection error:', err.message);
        if (connectionIdRef.current !== connId) return;
        setIsConnected(false);
        scheduleReconnect(connId);
      });

      socket.on('order:updated', (data: any) => {
        emitEvent(connId, 'order:updated', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${data.orderId}`] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
      });

      socket.on('order:assigned', (data: any) => {
        emitEvent(connId, 'order:assigned', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
      });

      socket.on('job_assigned', (data: any) => {
        emitEvent(connId, 'job_assigned', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/notifications'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/notifications/count'] });
      });

      socket.on('job_updated', (data: any) => {
        emitEvent(connId, 'job_updated', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${data.orderId}`] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
      });

      socket.on('job_cancelled', (data: any) => {
        emitEvent(connId, 'job_cancelled', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
      });

      socket.on('schedule_changed', (data: any) => {
        emitEvent(connId, 'schedule_changed', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
      });

      socket.on('priority_changed', (data: any) => {
        emitEvent(connId, 'priority_changed', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${data.orderId}`] });
      });

      socket.on('anomaly_alert', (data: any) => {
        emitEvent(connId, 'anomaly_alert', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/notifications'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/notifications/count'] });
      });

      socket.on('position_update', (data: any) => {
        emitEvent(connId, 'position_update', data);
      });

      socket.on('notification', (data: any) => {
        emitEvent(connId, 'notification', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/notifications'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/notifications/count'] });
      });

      socket.on('team:order_updated', (data: any) => {
        emitEvent(connId, 'team:order_updated', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${data.orderId}`] });
      });

      socket.on('team:material_logged', (data: any) => {
        emitEvent(connId, 'team:material_logged', data);
        queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${data.orderId}/materials`] });
      });

      socket.on('team:member_left', (data: any) => {
        emitEvent(connId, 'team:member_left', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-team'] });
      });

      socket.on('team:invite', (data: any) => {
        emitEvent(connId, 'team:invite', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/team-invites'] });
      });

      socket.on('route:optimized', (data: any) => {
        emitEvent(connId, 'route:optimized', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/route'] });
      });

      socket.on('route_optimized', (data: any) => {
        emitEvent(connId, 'route:optimized', data);
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/route'] });
      });

      socket.on('route:reoptimizing', (data: any) => {
        emitEvent(connId, 'route:reoptimizing', data);
      });

      socket.on('route_reoptimizing', (data: any) => {
        emitEvent(connId, 'route:reoptimizing', data);
      });

      socket.on('pong', () => {});

      if (connectionIdRef.current !== connId) {
        socket.disconnect();
        return;
      }

      socketRef.current = socket;
    } catch (err) {
      console.error('[WebSocket] Connection setup failed:', err);
      if (connectionIdRef.current === connId) {
        scheduleReconnect(connId);
      }
    }
  }, [resourceId, tenantId, teamId, queryClient, scheduleReconnect, emitEvent]);

  const connect = useCallback(() => {
    const connId = ++connectionIdRef.current;
    clearReconnectTimer();
    backoffRef.current = INITIAL_BACKOFF_MS;
    connectInternal(connId);
  }, [connectInternal, clearReconnectTimer]);

  const disconnect = useCallback(() => {
    connectionIdRef.current++;
    clearReconnectTimer();
    if (pingIntervalRef.current) { clearInterval(pingIntervalRef.current); pingIntervalRef.current = null; }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
  }, [clearReconnectTimer]);

  const sendPositionUpdate = useCallback((position: { latitude: number; longitude: number; speed?: number; heading?: number; accuracy?: number; status?: string; workOrderId?: string }) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('position_update', { type: 'position_update', resourceId: resourceId ? String(resourceId) : undefined, ...position });
    }
  }, [resourceId]);

  useEffect(() => {
    if (resourceId) {
      connect();
    }

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && resourceId) {
        if (!socketRef.current?.connected) {
          connect();
        }
      }
    });

    return () => {
      disconnect();
      subscription.remove();
    };
  }, [resourceId, connect, disconnect]);

  return {
    isConnected,
    lastEvent,
    addHandler,
    connect,
    disconnect,
    sendPositionUpdate,
  };
}
