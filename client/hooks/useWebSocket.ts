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
  | { type: 'team:invite'; data: { invite: any; teamName: string } };

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

  const connectInternal = useCallback(async (connId: number) => {
    if (connectionIdRef.current !== connId) return;

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    try {
      const { io } = await import('socket.io-client');

      if (connectionIdRef.current !== connId) return;

      const apiUrl = getApiUrl();
      const socket = io(apiUrl, {
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
      });

      socket.on('disconnect', (reason: string) => {
        if (connectionIdRef.current !== connId) return;
        setIsConnected(false);
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
        if (connectionIdRef.current !== connId) return;
        const event: WSEvent = { type: 'order:updated', data };
        setLastEvent(event);
        handlersRef.current.forEach(h => h(event));

        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${data.orderId}`] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
      });

      socket.on('order:assigned', (data: any) => {
        if (connectionIdRef.current !== connId) return;
        const event: WSEvent = { type: 'order:assigned', data };
        setLastEvent(event);
        handlersRef.current.forEach(h => h(event));

        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
      });

      socket.on('notification', (data: any) => {
        if (connectionIdRef.current !== connId) return;
        const event: WSEvent = { type: 'notification', data };
        setLastEvent(event);
        handlersRef.current.forEach(h => h(event));

        queryClient.invalidateQueries({ queryKey: ['/api/mobile/notifications'] });
      });

      socket.on('team:order_updated', (data: any) => {
        if (connectionIdRef.current !== connId) return;
        const event: WSEvent = { type: 'team:order_updated', data };
        setLastEvent(event);
        handlersRef.current.forEach(h => h(event));
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${data.orderId}`] });
      });

      socket.on('team:material_logged', (data: any) => {
        if (connectionIdRef.current !== connId) return;
        const event: WSEvent = { type: 'team:material_logged', data };
        setLastEvent(event);
        handlersRef.current.forEach(h => h(event));
        queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${data.orderId}/materials`] });
      });

      socket.on('team:member_left', (data: any) => {
        if (connectionIdRef.current !== connId) return;
        const event: WSEvent = { type: 'team:member_left', data };
        setLastEvent(event);
        handlersRef.current.forEach(h => h(event));
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-team'] });
      });

      socket.on('team:invite', (data: any) => {
        if (connectionIdRef.current !== connId) return;
        const event: WSEvent = { type: 'team:invite', data };
        setLastEvent(event);
        handlersRef.current.forEach(h => h(event));
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/team-invites'] });
      });

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
  }, [resourceId, tenantId, teamId, queryClient, scheduleReconnect]);

  const connect = useCallback(() => {
    const connId = ++connectionIdRef.current;
    clearReconnectTimer();
    backoffRef.current = INITIAL_BACKOFF_MS;
    connectInternal(connId);
  }, [connectInternal, clearReconnectTimer]);

  const disconnect = useCallback(() => {
    connectionIdRef.current++;
    clearReconnectTimer();
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
  }, [clearReconnectTimer]);

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
  };
}
