# Traivo-Go Mobile App — Routing Optimization Analysis

> **Date:** 2026-03-27  
> **Scope:** Full codebase analysis of `traivo-go` (React Native/Expo mobile field app)  
> **Purpose:** Identify what changes traivo-go needs to support async route optimization from traivo-one  
> **Format:** Copy-paste friendly for Replit AI coding sessions

---

## 1. Current Architecture Summary

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.81.5 + Expo SDK 54 |
| Navigation | React Navigation 7 (native-stack + bottom-tabs) |
| State/Data | TanStack React Query 5 + AsyncStorage |
| Real-time | Socket.IO 4.8.3 (WebSocket) |
| Maps | react-native-maps 1.20.1 + Geoapify API |
| Server (BFF) | Express 5 on port 5000 (Backend-for-Frontend proxy) |
| Database (local) | PostgreSQL via `pg` (driver_locations, push_tokens, time_entries, route_feedback) |
| AI | OpenAI GPT-5.2 (chat, transcription, image analysis) |

### File Structure (Key Files)
```
traivo-go/
├── App.tsx                              # Root: providers (Auth, Query, Navigation)
├── server/
│   ├── app.ts                           # Express + Socket.IO server setup
│   ├── db.ts                            # PostgreSQL pool + push notifications
│   ├── routes/
│   │   ├── mobile.ts                    # ⭐ Main API: 80+ endpoints, mock mode + traivo proxy
│   │   ├── planner.ts                   # Planner map view endpoints
│   │   └── ai.ts                        # AI chat, transcription, image analysis
├── client/
│   ├── context/
│   │   └── AuthContext.tsx              # Auth state, login/logout, online status, start position
│   ├── hooks/
│   │   ├── useGpsTracking.ts           # ⭐ GPS position polling (30s interval) + server reporting
│   │   ├── useOfflineSync.ts           # ⭐ Offline outbox queue, route/order caching
│   │   ├── useWebSocket.ts             # ⭐ Real-time events (order updates, position, team)
│   │   ├── useDisruptionMonitor.ts     # Auto-detect delays, early completion
│   │   ├── useWorkSession.ts           # Work session start/stop/pause
│   │   ├── useTeam.ts                  # Team management hook
│   │   └── useResourceProfiles.ts      # Resource profile assignments
│   ├── screens/
│   │   ├── HomeScreen.tsx              # Dashboard: summary, next order, weather, break suggestion
│   │   ├── OrdersScreen.tsx            # Order list with swipe actions, timeline view
│   │   ├── MapScreen.tsx               # ⭐ Route map: polyline, markers, leg times, traffic
│   │   ├── MapScreen.web.tsx           # Web fallback for map
│   │   ├── OrderDetailScreen.tsx       # Order detail + status progression
│   │   ├── RouteFeedbackScreen.tsx     # ⭐ Driver route rating (1-5 stars + reasons)
│   │   ├── AIAssistantScreen.tsx       # AI chat assistant
│   │   ├── StatisticsScreen.tsx        # Driver statistics
│   │   └── ... (12 more screens)
│   ├── lib/
│   │   ├── query-client.ts             # ⭐ API client: getApiUrl(), apiRequest(), React Query config
│   │   ├── travel-time.ts              # Haversine distance + driving distance API
│   │   ├── settings.ts                 # App settings (offline mode, etc.)
│   │   └── navigation-links.ts         # Deep link helpers
│   ├── types/
│   │   └── index.ts                    # ⭐ All TypeScript types (Order, GpsPosition, SyncAction, etc.)
│   └── navigation/
│       ├── RootNavigator.tsx           # Auth-gated navigation stack
│       └── TabNavigator.tsx            # Bottom tabs: Home, Orders, Map, AI, Profile
```

---

## 2. How Routes/Assignments Are Currently Received

### Data Flow
```
traivo-one backend
    ↓ (HTTP proxy or mock data)
server/routes/mobile.ts — GET /api/mobile/my-orders
    ↓ (React Query fetch)
client/screens/OrdersScreen.tsx — displays order list
client/screens/MapScreen.tsx — displays on map with polyline
```

### Order Fetching — `server/routes/mobile.ts:957`
```typescript
// In mock mode: returns MOCK_ORDERS filtered by today's date and resourceId
// In live mode: proxies to traivo-one via traivoFetch()
router.get('/my-orders', async (req, res) => {
  if (IS_MOCK_MODE) {
    const today = new Date().toISOString().split('T')[0];
    const orders = MOCK_ORDERS.filter(o => o.scheduledDate === today);
    return res.json(orders);
  }
  // Proxy to traivo-one: /api/mobile/my-orders
  const { status, data } = await traivoFetch('/api/mobile/my-orders', {
    method: 'GET', headers: getAuthHeader(req),
  });
  // Transform and return
});
```

### Route Calculation — `server/routes/mobile.ts:2202`
The `/api/mobile/route` endpoint calculates the route polyline:
1. Client sends coordinate pairs as `coords=lon1,lat1;lon2,lat2;...`
2. Server calls **Geoapify Routing API** (`/v1/routing?waypoints=...&mode=drive&traffic=approximated`)
3. Returns `RouteData` with geometry (polyline coordinates), distance, duration, legs
4. Falls back to straight-line coordinates if Geoapify is unavailable

### Route Optimization — `server/routes/mobile.ts:2297`
The `/api/mobile/route-optimized` endpoint:
1. Calls **Geoapify Route Planner API** (`/v1/routeplanner`) to optimize visit order
2. Then calls Geoapify Routing API for the actual road polyline in optimized order
3. Returns `optimized: true` flag with reordered waypoints

### Map Display — `client/screens/MapScreen.tsx`
- Fetches orders via React Query `['/api/mobile/my-orders']`
- Builds coord string from driver position + order locations
- Fetches route via React Query `['/api/mobile/route', coordsParam]`
- Renders `<Polyline>` for road geometry (double-line: shadow + main)
- Renders numbered `<Marker>` for each stop
- Shows route summary: total distance, duration, traffic delay
- Supports **offline caching** of route and order data
- Reorders markers when optimization returns `waypoints` with different `waypointIndex`

---

## 3. GPS Tracking Implementation

### Hook: `client/hooks/useGpsTracking.ts`
```
Architecture: Global singleton pattern (not per-component)
Interval: 30 seconds (GPS_INTERVAL = 30000)
Accuracy: expo-location Balanced accuracy
Retries: 2 retries with 3s delay on send failure
```

**Position Reporting Flow:**
```
useGpsTracking.startTracking()
  → requestForegroundPermissionsAsync()
  → getCurrentPositionAsync({ accuracy: Balanced })
  → POST /api/mobile/position { latitude, longitude, speed, heading, accuracy, trackingStatus }
  → setInterval(30s) → repeat
```

**Server Side — `server/routes/mobile.ts:1882`:**
```typescript
// Stores in PostgreSQL driver_locations table (upsert by driver_id)
// Also proxies to traivo-one in live mode
INSERT INTO driver_locations (driver_id, ..., status, updated_at)
VALUES ($1, ..., 'active', NOW())
ON CONFLICT (driver_id) DO UPDATE SET ...
```

**WebSocket Position Sharing — `server/app.ts:40`:**
```typescript
socket.on('position_update', (data) => {
  socket.to(`tenant:${data.tenantId}`).emit('position_update', data);
});
```

### Current GPS Gaps
| Gap | Detail |
|-----|--------|
| No battery optimization | Uses `Balanced` accuracy only, no adaptive interval based on movement |
| No background tracking | Only foreground permissions requested, no `requestBackgroundPermissionsAsync()` |
| No position buffering | If send fails after retries, position is lost (not queued for offline sync) |
| No ETA calculation | GPS data isn't used to calculate real ETA to next stop |
| Fixed 30s interval | Doesn't adjust based on speed (waste of battery when stationary) |

---

## 4. Offline Sync Logic

### Hook: `client/hooks/useOfflineSync.ts`
```
Outbox capacity: 500 actions / 5MB max
Sync interval: 30s (online) / 120s (offline mode)
Cache TTL: 24 hours
Mutex: Promise-based processing mutex to prevent concurrent outbox access
```

**Outbox Pattern:**
```typescript
// Enqueue action when offline:
enqueueAction({ actionType: 'status_update', payload: { orderId, status } })
  → Saves to AsyncStorage '@offline_outbox'

// Process when back online:
processOutbox()
  → POST /api/mobile/sync { actions: [...outbox] }
  → Server processes each action, returns results
  → Remove successful actions from outbox
  → Invalidate React Query caches
```

**Cached Data Types:**
| Key Pattern | Data | Used By |
|------------|------|---------|
| `@offline_cache_{key}` | Generic data cache | `cacheData()` / `getCachedData()` |
| `@route_cache_{date}` | Route polyline + metadata | `MapScreen.tsx` |
| `@order_cache` | Full order list | `MapScreen.tsx` |

**SyncAction Types (from `types/index.ts:452`):**
```typescript
actionType: 'status_update' | 'note' | 'deviation' | 'material' | 'gps' | 'inspection' | 'signature'
```

---

## 5. Route Feedback Mechanism

### Screen: `client/screens/RouteFeedbackScreen.tsx`
Already implemented! Driver can rate routes 1-5 stars with predefined reasons:
```typescript
const REASON_OPTIONS = [
  { key: 'too_long', label: 'För lång rutt' },
  { key: 'too_short', label: 'För kort rutt' },
  { key: 'logical', label: 'Logisk ordning' },
  { key: 'illogical', label: 'Ologisk ordning' },
  { key: 'good', label: 'Bra rutt' },
  { key: 'traffic', label: 'Mycket trafik' },
];
```

### Server Endpoint: `server/routes/mobile.ts:2573`
```typescript
// POST /api/mobile/route-feedback
// Stores in PostgreSQL route_feedback table
INSERT INTO route_feedback (driver_id, rating, reasons, comment, feedback_date, created_at) ...
```

### Current Feedback Gaps
| Gap | Detail |
|-----|--------|
| No automatic metrics | Doesn't capture actual vs. planned route metrics (distance, time) |
| No per-stop feedback | Only rates the overall route, not individual stop ordering |
| Not linked to optimization job | No `optimization_job_id` field to correlate with specific optimization run |
| No ML pipeline | Data sits in PostgreSQL, not fed back to optimization service |

---

## 6. Backend Communication (BFF Pattern)

### Architecture
```
[Mobile App] → [traivo-go Express server :5000] → [traivo-one backend]
                     ↕
              [Local PostgreSQL]
              [Socket.IO WebSocket]
```

### Communication Methods
| Method | Used For | File |
|--------|----------|------|
| HTTP REST (proxy) | All CRUD operations | `server/routes/mobile.ts` — `traivoFetch()` |
| Socket.IO WebSocket | Real-time events (order updates, position, team) | `server/app.ts` + `client/hooks/useWebSocket.ts` |
| React Query polling | Data freshness (30s stale time) | `client/lib/query-client.ts` |
| Push Notifications | Expo push for background alerts | `server/db.ts` — `sendPushNotification()` |

### Key API Request Function — `client/lib/query-client.ts:40`
```typescript
export async function apiRequest(method, path, body?, token?) {
  const url = new URL(path, getApiUrl()).toString();
  // Adds Bearer token, JSON content type
  // Auto-resolves API URL from Expo manifest host
}
```

### Traivo Proxy Function — `server/routes/mobile.ts:9`
```typescript
async function traivoFetch(path, options) {
  const url = `${TRAIVO_API_URL}${path}`;
  // 5 second timeout
  // JSON validation
  // Falls back to mock mode on error
}
```

---

## 7. Map/Navigation Logic

### Map Screen — `client/screens/MapScreen.tsx`
- Uses `react-native-maps` (Google Maps) on native, web fallback list view
- Route origin: driver's start-of-day position (from `AuthContext.startPosition`) or current GPS
- Polyline rendering: double-stroke (shadow + main line) for road-following route
- Traffic awareness: shows delay minutes when `totalDuration > totalDurationWithoutTraffic * 1.15`
- Break suggestion integration: inserts break markers in route timeline
- Offline support: falls back to cached route/orders with "Offline - visar cachad data" badge

### External Navigation — `client/lib/navigation-links.ts`
Opens Apple Maps / Google Maps for turn-by-turn navigation to order address.

---

## 8. What Changes traivo-go Needs for Async Optimization

### 8.1 Polling for Optimization Job Status

**Problem:** traivo-one will now run optimization as async BullMQ jobs. The mobile app needs to poll for job completion instead of getting immediate results.

**New API Endpoints to Consume:**
```
GET /api/optimization/jobs/:jobId/status
→ { status: 'pending' | 'processing' | 'completed' | 'failed', progress?: number }

GET /api/optimization/jobs/:jobId/result
→ { optimizedRoute: RouteData, metadata: { solver: string, cost: number } }
```

**Files to Modify:**

#### `server/routes/mobile.ts` — Add optimization proxy endpoints
```typescript
// ADD after line 2488 (after /route-optimized endpoint)

router.post('/optimize-route', async (req, res) => {
  // Submit optimization job to traivo-one
  // Returns: { jobId: string, estimatedTime: number }
  if (IS_MOCK_MODE) {
    const jobId = `opt-${Date.now()}`;
    res.json({ success: true, jobId, estimatedTime: 15 });
    return;
  }
  try {
    const { status, data } = await traivoFetch('/api/optimization/submit', {
      method: 'POST',
      headers: getAuthHeader(req),
      body: JSON.stringify(req.body),
    });
    res.status(status).json(data);
  } catch (err: any) {
    res.status(503).json({ error: 'Kunde inte starta optimering' });
  }
});

router.get('/optimize-route/:jobId/status', async (req, res) => {
  if (IS_MOCK_MODE) {
    res.json({ status: 'completed', progress: 100 });
    return;
  }
  try {
    const { status, data } = await traivoFetch(
      `/api/optimization/jobs/${req.params.jobId}/status`,
      { method: 'GET', headers: getAuthHeader(req) }
    );
    res.status(status).json(data);
  } catch (err: any) {
    res.status(503).json({ error: 'Kunde inte hämta optimeringsstatus' });
  }
});

router.get('/optimize-route/:jobId/result', async (req, res) => {
  if (IS_MOCK_MODE) {
    // Return current route data as "optimized" result
    res.json({ success: true, optimizedRoute: null });
    return;
  }
  try {
    const { status, data } = await traivoFetch(
      `/api/optimization/jobs/${req.params.jobId}/result`,
      { method: 'GET', headers: getAuthHeader(req) }
    );
    res.status(status).json(data);
  } catch (err: any) {
    res.status(503).json({ error: 'Kunde inte hämta optimeringsresultat' });
  }
});
```

#### `client/hooks/useRouteOptimization.ts` — NEW FILE
```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';

type OptimizationStatus = 'idle' | 'submitting' | 'pending' | 'processing' | 'completed' | 'failed';

interface OptimizationState {
  status: OptimizationStatus;
  jobId: string | null;
  progress: number;
  error: string | null;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // 3 minutes max

export function useRouteOptimization() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<OptimizationState>({
    status: 'idle', jobId: null, progress: 0, error: null,
  });
  const pollCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const submitOptimization = useCallback(async (params: {
    resourceId: string;
    date: string;
    orderIds: string[];
    startLat?: number;
    startLng?: number;
  }) => {
    setState({ status: 'submitting', jobId: null, progress: 0, error: null });
    try {
      const result = await apiRequest('POST', '/api/mobile/optimize-route', params, token);
      const jobId = result.jobId;
      setState({ status: 'pending', jobId, progress: 0, error: null });
      pollCountRef.current = 0;
      // Start polling
      pollTimerRef.current = setInterval(async () => {
        pollCountRef.current++;
        if (pollCountRef.current > MAX_POLL_ATTEMPTS) {
          stopPolling();
          setState(prev => ({ ...prev, status: 'failed', error: 'Timeout: optimering tog för lång tid' }));
          return;
        }
        try {
          const statusResult = await apiRequest('GET', `/api/mobile/optimize-route/${jobId}/status`, undefined, token);
          setState(prev => ({
            ...prev,
            status: statusResult.status,
            progress: statusResult.progress || prev.progress,
          }));
          if (statusResult.status === 'completed') {
            stopPolling();
            // Invalidate route queries to pick up optimized result
            queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
            queryClient.invalidateQueries({ queryKey: ['/api/mobile/route'] });
          } else if (statusResult.status === 'failed') {
            stopPolling();
            setState(prev => ({ ...prev, error: statusResult.error || 'Optimering misslyckades' }));
          }
        } catch (err: any) {
          console.warn('[optimize] Poll error:', err.message);
        }
      }, POLL_INTERVAL_MS);
    } catch (err: any) {
      setState({ status: 'failed', jobId: null, progress: 0, error: err.message });
    }
  }, [token, queryClient, stopPolling]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return {
    ...state,
    submitOptimization,
    isOptimizing: ['submitting', 'pending', 'processing'].includes(state.status),
  };
}
```

---

### 8.2 Displaying Optimized Routes with Real Road Data

**Problem:** Current map already renders Geoapify polylines, but needs to handle optimized route data from OR-Tools differently (order may change, new geometry).

**Files to Modify:**

#### `client/screens/MapScreen.tsx` — Update route data handling

**Add optimization status banner (after line ~465):**
```typescript
// Add import at top:
import { useRouteOptimization } from '../hooks/useRouteOptimization';

// Inside MapScreen component:
const { status: optStatus, progress: optProgress, isOptimizing } = useRouteOptimization();

// Add banner JSX after offlineBadge (line ~465):
{isOptimizing ? (
  <View style={[styles.optimizingBadge, { top: headerHeight + Spacing.md }]}>
    <ActivityIndicator size="small" color={Colors.textInverse} />
    <Text style={styles.optimizingBadgeText}>
      Optimerar rutt... {optProgress > 0 ? `${optProgress}%` : ''}
    </Text>
  </View>
) : null}
```

**Update route query to prefer optimized results:**
The existing `useQuery` for route data (line ~183) should be enhanced to also check for optimization results. When an optimization job completes, the server should return the optimized route geometry directly.

#### `client/types/index.ts` — Add optimization types
```typescript
// ADD at end of file:

export interface OptimizationJob {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  submittedAt: string;
  completedAt?: string;
  result?: OptimizationResult;
}

export interface OptimizationResult {
  optimizedOrder: number[]; // reordered indices
  totalDistance: number;
  totalDuration: number;
  savings: {
    distanceSaved: number;  // meters
    timeSaved: number;      // seconds
    percentImproved: number;
  };
  routeGeometry: {
    type: 'LineString';
    coordinates: number[][];
  };
  legs: RouteLeg[];
  solver: string; // 'or-tools' | 'geoapify' | 'nearest-neighbor'
  confidence: number;
}

export interface RouteLeg {
  distance: number;
  duration: number;
  durationWithoutTraffic?: number;
  fromOrderId?: string;
  toOrderId?: string;
}
```

---

### 8.3 Real-time Route Updates When Re-optimization Happens

**Problem:** When traivo-one re-optimizes routes (e.g., new urgent order), the mobile app needs to be notified and refresh.

**Files to Modify:**

#### `server/app.ts` — Add route optimization WebSocket events
```typescript
// ADD to the io.on('connection') handler, after line 43:
socket.on('route:optimized', (data: any) => {
  // Forward to specific resource
  if (data.resourceId) {
    socket.to(`resource:${data.resourceId}`).emit('route:optimized', data);
  }
});
```

#### `client/hooks/useWebSocket.ts` — Handle new event types
```typescript
// ADD to WSEvent union type (after line 21):
| { type: 'route:optimized'; data: { jobId: string; resourceId: string; timestamp: string } }
| { type: 'route:reoptimizing'; data: { reason: string; resourceId: string } }

// ADD socket handlers inside connectInternal() (after line 186):
socket.on('route:optimized', (data: any) => {
  emitEvent(connId, 'route:optimized', data);
  queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
  queryClient.invalidateQueries({ queryKey: ['/api/mobile/route'] });
});

socket.on('route:reoptimizing', (data: any) => {
  emitEvent(connId, 'route:reoptimizing', data);
});
```

#### `client/screens/MapScreen.tsx` — React to route updates
```typescript
// ADD inside MapScreen component, after existing useEffect hooks:
const { addHandler } = useWebSocket(user?.id, user?.tenantId);

useEffect(() => {
  const removeHandler = addHandler((event) => {
    if (event.type === 'route:optimized') {
      // Route was re-optimized — reset fitted state to re-center map
      hasFittedRef.current = false;
    }
    if (event.type === 'route:reoptimizing') {
      // Show "re-optimizing" toast/banner
    }
  });
  return removeHandler;
}, [addHandler]);
```

---

### 8.4 Better GPS Position Reporting for Live Tracking

**Files to Modify:**

#### `client/hooks/useGpsTracking.ts` — Adaptive tracking + offline buffer

**Key changes needed:**
```typescript
// 1. Adaptive interval based on speed
const GPS_INTERVAL_MOVING = 15000;   // 15s when moving
const GPS_INTERVAL_IDLE = 60000;     // 60s when stationary
const SPEED_THRESHOLD = 2;           // m/s (~7 km/h)

// 2. Add offline position buffer
const POSITION_BUFFER_KEY = '@gps_position_buffer';
const MAX_BUFFER_SIZE = 100;

// In sendPositionGlobal(), replace the catch block:
async function sendPositionGlobal(position: GpsPosition, retries = MAX_SEND_RETRIES) {
  try {
    await apiRequest('POST', '/api/mobile/position', {
      latitude: position.latitude,
      longitude: position.longitude,
      speed: position.speed,
      heading: position.heading,
      accuracy: position.accuracy,
      trackingStatus: globalState.trackingStatus || 'active',
      currentOrderId: globalState.currentOrderId, // NEW: track which order
      lastPositionUpdate: new Date().toISOString(),
    });
    // Flush any buffered positions
    await flushPositionBuffer();
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      return sendPositionGlobal(position, retries - 1);
    }
    // Buffer position for later sync
    await bufferPosition(position);
  }
}

// 3. Add buffer functions:
async function bufferPosition(position: GpsPosition) {
  try {
    const raw = await AsyncStorage.getItem(POSITION_BUFFER_KEY);
    const buffer: GpsPosition[] = raw ? JSON.parse(raw) : [];
    buffer.push(position);
    // Keep only latest MAX_BUFFER_SIZE positions
    const trimmed = buffer.slice(-MAX_BUFFER_SIZE);
    await AsyncStorage.setItem(POSITION_BUFFER_KEY, JSON.stringify(trimmed));
  } catch {}
}

async function flushPositionBuffer() {
  try {
    const raw = await AsyncStorage.getItem(POSITION_BUFFER_KEY);
    if (!raw) return;
    const buffer: GpsPosition[] = JSON.parse(raw);
    if (buffer.length === 0) return;
    await apiRequest('POST', '/api/mobile/position/batch', { positions: buffer });
    await AsyncStorage.removeItem(POSITION_BUFFER_KEY);
  } catch {}
}

// 4. Adaptive interval in startTrackingGlobal():
globalIntervalId = setInterval(async () => {
  const p = await getCurrentPositionGlobal();
  if (p) {
    sendPositionGlobal(p);
    // Adjust interval based on speed
    const isMoving = (p.speed || 0) > SPEED_THRESHOLD;
    const desiredInterval = isMoving ? GPS_INTERVAL_MOVING : GPS_INTERVAL_IDLE;
    if (desiredInterval !== currentInterval) {
      clearInterval(globalIntervalId!);
      currentInterval = desiredInterval;
      globalIntervalId = setInterval(/* ... */, currentInterval);
    }
  }
}, GPS_INTERVAL_MOVING);
```

#### `server/routes/mobile.ts` — Add batch position endpoint
```typescript
// ADD after /position endpoint (after line 1928):
router.post('/position/batch', async (req, res) => {
  const { positions } = req.body;
  if (!Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({ error: 'positions array required' });
  }
  // Store batch in driver_location_history table
  const driverId = IS_MOCK_MODE ? MOCK_RESOURCE.id : 'unknown';
  try {
    for (const pos of positions.slice(-50)) { // Limit to 50
      await pool.query(
        `INSERT INTO driver_location_history (driver_id, latitude, longitude, speed, heading, accuracy, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))`,
        [driverId, pos.latitude, pos.longitude, pos.speed || 0, pos.heading || 0, pos.accuracy || 0, pos.timestamp]
      );
    }
    res.json({ received: true, count: positions.length });
  } catch (err) {
    console.error('Batch position save error:', err);
    res.json({ received: true, count: 0 });
  }
});
```

---

### 8.5 Driver Feedback on Route Quality (ML Phase 3 Input)

**Files to Modify:**

#### `client/screens/RouteFeedbackScreen.tsx` — Enhanced feedback with metrics

**Replace REASON_OPTIONS and add auto-metrics:**
```typescript
const REASON_OPTIONS = [
  { key: 'too_long', label: 'För lång rutt', icon: 'clock' },
  { key: 'too_short', label: 'För kort rutt', icon: 'minus-circle' },
  { key: 'logical', label: 'Logisk ordning', icon: 'check-circle' },
  { key: 'illogical', label: 'Ologisk ordning', icon: 'shuffle' },
  { key: 'good', label: 'Bra rutt', icon: 'thumbs-up' },
  { key: 'traffic', label: 'Mycket trafik', icon: 'alert-triangle' },
  // NEW reasons:
  { key: 'wrong_order', label: 'Fel besöksordning', icon: 'repeat' },
  { key: 'missing_time_window', label: 'Tidsfönster ignorerat', icon: 'clock' },
  { key: 'road_closed', label: 'Avstängd väg', icon: 'x-circle' },
  { key: 'better_known_route', label: 'Jag vet en bättre väg', icon: 'navigation' },
] as const;

// ADD: Capture actual vs. planned metrics automatically
const handleSubmit = async () => {
  // Fetch actual route stats from today's tracking
  let actualMetrics = null;
  try {
    actualMetrics = await apiRequest('GET', '/api/mobile/route-metrics/today', undefined, token);
  } catch {}

  await apiRequest('POST', '/api/mobile/route-feedback', {
    rating,
    reasons: selectedReasons,
    comment,
    date: new Date().toISOString().split('T')[0],
    // NEW fields for ML:
    optimizationJobId: currentOptimizationJobId, // Link to specific optimization run
    actualMetrics: actualMetrics ? {
      actualDistanceKm: actualMetrics.totalDistance,
      actualDurationMin: actualMetrics.totalDuration,
      stopsCompleted: actualMetrics.stopsCompleted,
      stopsReordered: actualMetrics.stopsReordered, // Did driver deviate from suggested order?
    } : undefined,
  }, token);
};
```

#### `server/routes/mobile.ts` — Enhanced feedback storage
```typescript
// REPLACE the POST /route-feedback handler (line 2573):
router.post('/route-feedback', async (req, res) => {
  const driverId = IS_MOCK_MODE ? MOCK_RESOURCE.id : 'unknown';
  const { rating, reasons, comment, date, optimizationJobId, actualMetrics } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Betyg (1-5) krävs' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO route_feedback (
        driver_id, rating, reasons, comment, feedback_date,
        optimization_job_id, actual_distance_km, actual_duration_min,
        stops_completed, stops_reordered, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *`,
      [
        driverId, rating, JSON.stringify(reasons || []), comment || '',
        date || new Date().toISOString().split('T')[0],
        optimizationJobId || null,
        actualMetrics?.actualDistanceKm || null,
        actualMetrics?.actualDurationMin || null,
        actualMetrics?.stopsCompleted || null,
        actualMetrics?.stopsReordered || null,
      ]
    );
    // Forward to traivo-one for ML pipeline
    if (!IS_MOCK_MODE) {
      traivoFetch('/api/optimization/feedback', {
        method: 'POST',
        headers: getAuthHeader(req),
        body: JSON.stringify({ ...req.body, driverId }),
      }).catch(() => {});
    }
    res.json({ success: true, feedback: result.rows[0] });
  } catch (err: any) {
    console.error('Route feedback save error:', err.message);
    res.status(500).json({ error: 'Kunde inte spara ruttbetyg' });
  }
});
```

---

## 9. Specific Files to Modify — Summary

| File | Changes | Priority |
|------|---------|----------|
| `server/routes/mobile.ts` | Add `/optimize-route`, `/optimize-route/:jobId/status`, `/optimize-route/:jobId/result`, `/position/batch`, `/route-metrics/today`. Enhance `/route-feedback` | 🔴 High |
| `client/hooks/useRouteOptimization.ts` | **NEW FILE** — Async optimization polling hook | 🔴 High |
| `client/hooks/useGpsTracking.ts` | Adaptive interval, offline buffer, batch flush, currentOrderId tracking | 🔴 High |
| `client/hooks/useWebSocket.ts` | Add `route:optimized` and `route:reoptimizing` event handlers | 🟡 Medium |
| `client/screens/MapScreen.tsx` | Optimization status banner, WebSocket route update handler | 🟡 Medium |
| `client/screens/RouteFeedbackScreen.tsx` | Add ML-oriented reasons, auto-capture actual metrics | 🟡 Medium |
| `client/types/index.ts` | Add `OptimizationJob`, `OptimizationResult`, `RouteLeg` types | 🟡 Medium |
| `server/app.ts` | Add `route:optimized` WebSocket event forwarding | 🟢 Low |
| `server/db.ts` | Add `driver_location_history` table init, enhance `route_feedback` schema | 🟢 Low |

---

## 10. Gaps That Would Block Optimization Improvements

### 🔴 Critical Blockers

1. **No async job polling mechanism** — The app assumes synchronous route calculation. No infrastructure for polling a long-running job. → Solved by `useRouteOptimization.ts` hook above.

2. **GPS positions lost when offline** — The `useGpsTracking` hook drops positions after 2 failed retries. For live tracking accuracy, positions must be buffered. → Solved by position buffer above.

3. **No `optimization_job_id` linkage** — Route feedback has no way to correlate with a specific optimization run. ML training needs this. → Solved by enhanced feedback schema.

### 🟡 Important Gaps

4. **No route version tracking** — When a route is re-optimized mid-day, the app has no concept of "route version N". This causes confusion about whether the displayed route is current.

5. **Fixed Geoapify routing** — The BFF server (`mobile.ts`) hardcodes Geoapify for routing. When traivo-one returns optimized routes with geometry from OR-Tools + OSRM, the mobile app should prefer that geometry over recalculating.

6. **No ETA sharing** — The driver's ETA to next stop isn't calculated from GPS + route data. This blocks real-time ETA notifications to customers.

7. **30-second React Query stale time** — Aggressive re-fetching may cause unnecessary load on optimization endpoints. Consider increasing to 60s or using WebSocket-triggered invalidation only.

### 🟢 Nice-to-Have

8. **No route comparison UI** — Driver can't see "original route vs optimized route" to understand optimization value.

9. **No constraint visualization** — Time windows, vehicle capacity limits aren't shown on the map.

10. **No "request re-optimization" button** — Driver can't trigger a re-optimization when conditions change (e.g., road closure).

---

## 11. Integration Architecture (How Mobile Fits the Optimization Picture)

```
                    ┌─────────────────────────────────────────────┐
                    │             traivo-one (backend)             │
                    │                                              │
                    │  ┌──────────┐   ┌──────────┐   ┌─────────┐│
                    │  │  BullMQ  │───│  Redis    │───│ OR-Tools ││
                    │  │  Queue   │   │  Cache    │   │ Python   ││
                    │  └────┬─────┘   └──────────┘   │ µService ││
                    │       │                         └─────────┘│
                    │  ┌────▼─────────────────────────┐          │
                    │  │  /api/optimization/*          │          │
                    │  │  POST /submit                 │          │
                    │  │  GET  /jobs/:id/status         │          │
                    │  │  GET  /jobs/:id/result         │          │
                    │  │  POST /feedback               │          │
                    │  └────┬─────────────────────────┘          │
                    │       │ WebSocket: route:optimized          │
                    └───────┼─────────────────────────────────────┘
                            │
                    ┌───────▼─────────────────────────────────────┐
                    │       traivo-go BFF (Express :5000)          │
                    │                                              │
                    │  /api/mobile/optimize-route      → proxy    │
                    │  /api/mobile/optimize-route/:id  → proxy    │
                    │  /api/mobile/route               → Geoapify │
                    │  /api/mobile/position/batch       → local DB│
                    │  /api/mobile/route-feedback       → DB + fwd│
                    │                                              │
                    │  Socket.IO → forward route:optimized events  │
                    └───────┬─────────────────────────────────────┘
                            │
                    ┌───────▼─────────────────────────────────────┐
                    │       traivo-go Mobile App (React Native)    │
                    │                                              │
                    │  useRouteOptimization() → poll job status   │
                    │  useGpsTracking()       → adaptive + buffer │
                    │  useWebSocket()         → route:optimized   │
                    │  useOfflineSync()       → queue actions     │
                    │  MapScreen             → render optimized   │
                    │  RouteFeedbackScreen   → ML training data   │
                    └─────────────────────────────────────────────┘
```

---

## 12. Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [ ] Add optimization proxy endpoints to `server/routes/mobile.ts`
- [ ] Create `client/hooks/useRouteOptimization.ts`
- [ ] Add new types to `client/types/index.ts`
- [ ] Add WebSocket events for route updates

### Phase 2: GPS & Tracking (Week 2)
- [ ] Implement adaptive GPS interval in `useGpsTracking.ts`
- [ ] Add offline position buffer with batch flush
- [ ] Create `driver_location_history` table in `server/db.ts`
- [ ] Add `/position/batch` endpoint

### Phase 3: UI Integration (Week 2-3)
- [ ] Add optimization status banner to `MapScreen.tsx`
- [ ] Handle `route:optimized` WebSocket events in map
- [ ] Enhance `RouteFeedbackScreen.tsx` with ML-oriented fields
- [ ] Add "optimized savings" display (distance/time saved)

### Phase 4: ML Feedback Loop (Week 3-4)
- [ ] Auto-capture actual route metrics vs. planned
- [ ] Forward feedback to traivo-one optimization service
- [ ] Add route comparison view (optional)
- [ ] Add "request re-optimization" button (optional)

---

*Generated from codebase analysis of `/home/ubuntu/traivo-go` — all file paths and line numbers reference actual source code.*
