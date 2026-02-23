import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { getApiUrl } from '../lib/query-client';
import type { Notification } from '../types';

type WSEvent =
  | { type: 'order:updated'; data: { orderId: string | number; status: string; updatedAt: string } }
  | { type: 'order:assigned'; data: { orderId: string | number } }
  | { type: 'notification'; data: Notification };

type EventHandler = (event: WSEvent) => void;

export function useWebSocket(resourceId?: string | number, tenantId?: string) {
  const queryClient = useQueryClient();
  const socketRef = useRef<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null);
  const handlersRef = useRef<EventHandler[]>([]);

  const addHandler = useCallback((handler: EventHandler) => {
    handlersRef.current.push(handler);
    return () => {
      handlersRef.current = handlersRef.current.filter(h => h !== handler);
    };
  }, []);

  const connect = useCallback(async () => {
    if (socketRef.current?.connected) return;

    try {
      const { io } = await import('socket.io-client');
      const apiUrl = getApiUrl();
      const socket = io(apiUrl, {
        path: '/ws',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 3000,
        reconnectionAttempts: 10,
      });

      socket.on('connect', () => {
        setIsConnected(true);
        if (resourceId) {
          socket.emit('join', { resourceId: String(resourceId), tenantId });
        }
      });

      socket.on('disconnect', () => {
        setIsConnected(false);
      });

      socket.on('order:updated', (data: any) => {
        const event: WSEvent = { type: 'order:updated', data };
        setLastEvent(event);
        handlersRef.current.forEach(h => h(event));

        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: [`/api/mobile/orders/${data.orderId}`] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
      });

      socket.on('order:assigned', (data: any) => {
        const event: WSEvent = { type: 'order:assigned', data };
        setLastEvent(event);
        handlersRef.current.forEach(h => h(event));

        queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mobile/summary'] });
      });

      socket.on('notification', (data: any) => {
        const event: WSEvent = { type: 'notification', data };
        setLastEvent(event);
        handlersRef.current.forEach(h => h(event));

        queryClient.invalidateQueries({ queryKey: ['/api/mobile/notifications'] });
      });

      socketRef.current = socket;
    } catch (err) {
      console.error('WebSocket connection failed:', err);
    }
  }, [resourceId, tenantId, queryClient]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    }
  }, []);

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
