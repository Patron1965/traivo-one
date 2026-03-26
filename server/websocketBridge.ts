import { Server as SocketIOServer, Socket as LocalSocket } from 'socket.io';

interface BridgeEventData {
  teamId?: string | number;
  resourceId?: string | number;
  tenantId?: string;
  orderId?: string | number;
  [key: string]: unknown;
}

interface BridgeStatus {
  active: boolean;
  connected: boolean;
  eventCounts: Record<string, number>;
}

const BRIDGE_EVENTS = [
  'order:updated',
  'order:assigned',
  'job_assigned',
  'job_updated',
  'job_cancelled',
  'schedule_changed',
  'priority_changed',
  'anomaly_alert',
  'notification',
  'team:order_updated',
  'team:material_logged',
  'team:member_left',
  'team:invite',
  'position_update',
] as const;

const INITIAL_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;
const BACKOFF_MULTIPLIER = 2;

let upstreamSocket: ReturnType<typeof import('socket.io-client').io> | null = null;
let backoffMs = INITIAL_BACKOFF_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let bridgeActive = false;
let eventCounts: Record<string, number> = {};
let connectionListenerCleanup: (() => void) | null = null;

function logBridge(message: string) {
  console.log(`[WS-BRIDGE] ${message}`);
}

function logBridgeError(message: string) {
  console.error(`[WS-BRIDGE] ${message}`);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(localIo: SocketIOServer, upstreamUrl: string) {
  clearReconnectTimer();
  if (!bridgeActive) return;

  const delay = backoffMs;
  backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);

  logBridge(`Ateransluter om ${Math.round(delay / 1000)}s...`);
  reconnectTimer = setTimeout(() => {
    if (bridgeActive) {
      connectUpstream(localIo, upstreamUrl);
    }
  }, delay);
}

async function connectUpstream(localIo: SocketIOServer, upstreamUrl: string) {
  if (upstreamSocket) {
    try { upstreamSocket.disconnect(); } catch (_e: unknown) { /* ignore */ }
    upstreamSocket = null;
  }

  try {
    const { io: ioClient } = await import('socket.io-client');

    if (!bridgeActive) {
      logBridge('Bridge stoppades under import — avbryter anslutning');
      return;
    }

    const wsUrl = upstreamUrl.replace(/\/+$/, '');
    logBridge(`Ansluter till Traivo One: ${wsUrl}`);

    upstreamSocket = ioClient(wsUrl, {
      path: '/ws',
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 10000,
    });

    upstreamSocket.on('connect', () => {
      logBridge(`Ansluten till Traivo One (socket: ${upstreamSocket?.id})`);
      backoffMs = INITIAL_BACKOFF_MS;
      eventCounts = {};

      upstreamSocket?.emit('join', {
        tenantId: process.env.TRAIVO_TENANT_ID || 'traivo-demo',
        role: 'bridge',
      });
    });

    upstreamSocket.on('disconnect', (reason: string) => {
      logBridge(`Frankopplad fran Traivo One: ${reason}`);
      if (bridgeActive && reason !== 'io client disconnect') {
        scheduleReconnect(localIo, upstreamUrl);
      }
    });

    upstreamSocket.on('connect_error', (err: Error) => {
      logBridgeError(`Anslutningsfel: ${err.message}`);
      if (bridgeActive) {
        scheduleReconnect(localIo, upstreamUrl);
      }
    });

    for (const eventName of BRIDGE_EVENTS) {
      upstreamSocket.on(eventName, (data: BridgeEventData) => {
        eventCounts[eventName] = (eventCounts[eventName] || 0) + 1;
        const total = Object.values(eventCounts).reduce((s, c) => s + c, 0);
        if (total <= 10 || total % 50 === 0) {
          logBridge(`Vidarebefordrar ${eventName} (totalt: ${total} events)`);
        }

        if (eventName.startsWith('team:')) {
          if (data?.teamId) {
            localIo.to(`team:${data.teamId}`).emit(eventName, data);
          } else {
            logBridge(`Droppar ${eventName} — saknar teamId`);
          }
        } else if (data?.resourceId) {
          localIo.to(`resource:${data.resourceId}`).emit(eventName, data);
          localIo.to(`tenant:${data.tenantId || 'traivo-demo'}`).emit(eventName, data);
        } else if (data?.tenantId) {
          localIo.to(`tenant:${data.tenantId}`).emit(eventName, data);
        } else {
          logBridge(`Droppar ${eventName} — saknar resourceId/tenantId`);
        }
      });
    }

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logBridgeError(`Kunde inte skapa anslutning: ${message}`);
    if (bridgeActive) {
      scheduleReconnect(localIo, upstreamUrl);
    }
  }
}

export function startWebSocketBridge(localIo: SocketIOServer, upstreamUrl: string) {
  if (!upstreamUrl) {
    logBridge('Ingen TRAIVO_API_URL — bridge inaktiv (mock-lage)');
    return;
  }

  if (bridgeActive) {
    logBridge('Bridge redan aktiv — stoppar forst');
    stopWebSocketBridge();
  }

  bridgeActive = true;
  backoffMs = INITIAL_BACKOFF_MS;
  eventCounts = {};

  logBridge('Startar WebSocket-bridge mot Traivo One...');
  connectUpstream(localIo, upstreamUrl);

  const positionHandler = (socket: LocalSocket) => {
    socket.on('position_update', (data: BridgeEventData) => {
      if (upstreamSocket?.connected && data.resourceId) {
        upstreamSocket.emit('position_update', data);
      }
    });
  };
  localIo.on('connection', positionHandler);
  connectionListenerCleanup = () => {
    localIo.removeListener('connection', positionHandler);
  };
}

export function stopWebSocketBridge() {
  bridgeActive = false;
  clearReconnectTimer();
  if (connectionListenerCleanup) {
    connectionListenerCleanup();
    connectionListenerCleanup = null;
  }
  if (upstreamSocket) {
    logBridge('Stoppar bridge...');
    try { upstreamSocket.disconnect(); } catch (_e: unknown) { /* ignore */ }
    upstreamSocket = null;
  }
}

export function getBridgeStatus(): BridgeStatus {
  return {
    active: bridgeActive,
    connected: upstreamSocket?.connected || false,
    eventCounts: { ...eventCounts },
  };
}
