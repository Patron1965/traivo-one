# Traivo Routing & Optimization – Codebase Analysis Report

**Generated:** 2026-03-27  
**Repos analyzed:** `Patron1965/traivo-one` (main platform), `Patron1965/traivo-go` (mobile field app)

---

## 1. Architecture Summary

### Tech Stack
| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Radix UI, Recharts, Leaflet maps |
| **Backend** | Express.js (Node/TypeScript), tsx runtime |
| **Database** | PostgreSQL via Drizzle ORM |
| **AI/LLM** | OpenAI GPT-4o-mini (planning, suggestions, NLP) |
| **Routing API** | Geoapify (routing + VRP route planner) |
| **Maps** | Leaflet (client), Google Maps URLs (navigation links) |
| **Mobile** | Traivo Go – React Native/Expo app (separate repo), connects to Traivo One API |
| **Auth** | Express sessions + passport, PIN-based mobile auth |
| **Realtime** | WebSocket (ws) for live position tracking |
| **Hosting** | Replit (development), Express serves static in production |

### Project Structure
```
traivo-one/
├── client/src/              # React frontend
│   └── components/
│       ├── RouteOptimizationPanel.tsx   # VRP optimization UI
│       ├── OptimizedRouteMap.tsx        # Optimized route display
│       ├── RouteMap.tsx                 # General route map (821 lines)
│       ├── LiveResourceMap.tsx          # Real-time tracking map
│       └── WeekPlanner.tsx             # Weekly planning view
├── server/
│   ├── index.ts                        # Express app entry (port 5000)
│   ├── db.ts                           # Drizzle + pg Pool setup
│   ├── storage.ts                      # Data access layer (5482 lines)
│   ├── route-optimizer.ts              # Core routing logic (778 lines)
│   ├── distance-matrix-service.ts      # Distance calc + caching (172 lines)
│   ├── ai-planner.ts                   # AI planning engine (3349 lines)
│   ├── scheduling-utils.ts             # Schedule generation (445 lines)
│   ├── routes/
│   │   ├── aiRoutes.ts                 # /api/ai/* endpoints (optimization, VRP, auto-schedule)
│   │   ├── plannerRoutes.ts            # /api/planner/* endpoints
│   │   ├── clusterRoutes.ts            # /api/clusters/* CRUD
│   │   ├── workOrderRoutes.ts          # Work order CRUD
│   │   ├── resourceRoutes.ts           # Resource management
│   │   └── mobile/                     # Mobile API endpoints
│   └── ...
├── shared/
│   └── schema.ts                       # Drizzle schema (4771 lines, 120+ tables)
└── migrations/                         # 24 Drizzle migrations
```

### traivo-go (Mobile App)
Separate Expo/React Native app with its own Express server that proxies to traivo-one. Contains:
- Field technician views (orders, route, map, inspections)
- GPS tracking (`useGpsTracking.ts`)
- Offline sync (`useOfflineSync.ts`)
- Route feedback collection (`RouteFeedbackScreen.tsx`)
- Travel time estimation (`client/lib/travel-time.ts`)

---

## 2. Data Models Relevant to Routing

### 2.1 `work_orders` (core schedulable unit)
**File:** `shared/schema.ts:231`
```
Key fields:
  id                    varchar PK (UUID)
  tenantId              varchar FK → tenants
  customerId            varchar FK → customers
  objectId              varchar FK → objects
  clusterId             varchar FK → clusters (nullable)
  resourceId            varchar FK → resources (nullable – unassigned until planned)
  teamId                varchar FK → teams (for rough planning)
  title                 text
  orderType             text (service, etc.)
  priority              text (urgent, high, normal, low)
  status                text (draft, etc.)
  orderStatus           text (skapad, planerad_pre, planerad_resurs, planerad_las, utford, fakturerad)
  scheduledDate         timestamp
  scheduledStartTime    text (e.g. "08:30")
  plannedWindowStart    timestamp
  plannedWindowEnd      timestamp
  estimatedDuration     integer (minutes, default 60)
  actualDuration        integer (minutes)
  setupTime             integer (minutes)
  executionStatus       text (8-step: not_planned → ... → invoiced)
  executionCode         text (kranbil, tvatt, sug, etc.)
  taskLatitude          real (task-specific override)
  taskLongitude         real
  etaSmsSent            boolean
```

### 2.2 `objects` (service locations / stops)
**File:** `shared/schema.ts:78`
```
Key fields:
  id                    varchar PK
  tenantId              varchar FK
  customerId            varchar FK
  clusterId             varchar (nullable)
  parentId              varchar (self-ref hierarchy)
  name                  text
  objectType            text (omrade, etc.)
  hierarchyLevel        text (koncern, brf, fastighet, rum, karl)
  address               text
  city                  text
  postalCode            text
  latitude              real        ← primary geocoded position
  longitude             real
  entranceLatitude      real        ← Google Geocoding v4 entrance coords
  entranceLongitude     real
  addressDescriptor     text        ← contextual description
  accessType            text (open, code, key)
  accessCode            text
  preferredTime1        text
  preferredTime2        text
  containerCount        integer
  avgSetupTime          integer (minutes)
  polylineData          jsonb       ← for route polylines
  resolvedAccessCode    text        ← inherited/computed values
  resolvedPreferredTime1 text
```

### 2.3 `resources` (drivers/technicians)
**File:** `shared/schema.ts:172`
```
Key fields:
  id                    varchar PK
  tenantId              varchar FK
  userId                varchar FK → users
  name                  text
  resourceType          text (person)
  homeLocation          text
  homeLatitude          real        ← start/end point for routes
  homeLongitude         real
  currentLatitude       real        ← live GPS position
  currentLongitude      real
  lastPositionUpdate    timestamp
  trackingStatus        text (idle, traveling, on_site, offline)
  weeklyHours           integer (default 40)
  competencies          text[]
  executionCodes        text[]      ← what types of work they can do
  availability          jsonb
  serviceArea           text[]      ← postal codes for geo area
  efficiencyFactor      real (default 1.0)
```

### 2.4 `vehicles`
**File:** `shared/schema.ts:502`
```
Key fields:
  id                    varchar PK
  registrationNumber    text
  vehicleType           text (bil, lastbil, minibuss)
  capacityTons          real
  capacityVolume        real (m³)
  fuelType              text (diesel, bensin, el, hybrid)
  status                text (active)
```

### 2.5 `clusters` (customer-based grouping with optional geo)
**File:** `shared/schema.ts:713`
```
Key fields:
  id                    varchar PK
  rootCustomerId        varchar FK → customers
  name                  text
  primaryTeamId         varchar
  slaLevel              text (standard, premium, enterprise)
  defaultPeriodicity    text
  geoData               jsonb       ← { centerLat, centerLng, radiusKm, postalCodes }
  centerLatitude        real        ← legacy geo fields
  centerLongitude       real
  radiusKm              real (default 5)
  postalCodes           text[]
  cachedObjectCount     integer
  cachedActiveOrders    integer
```

### 2.6 `assignments` (order concept generated tasks)
**File:** `shared/schema.ts:2081`
```
Key fields:
  id                    varchar PK
  orderConceptId        varchar FK
  objectId              varchar FK
  clusterId             varchar FK
  resourceId            varchar FK (nullable)
  teamId                varchar FK (nullable)
  scheduledDate         timestamp
  scheduledStartTime    text
  scheduledEndTime      text
  plannedWindowStart    timestamp
  plannedWindowEnd      timestamp
  estimatedDuration     integer (minutes)
  address               text
  latitude              real
  longitude             real
  quantity              integer
```

### 2.7 Supporting Tables
- **`resource_availability`** (`shared/schema.ts:592`) – work hours, vacation, sick days
- **`resource_vehicles`** (`shared/schema.ts:568`) – resource↔vehicle mapping (isPrimary)
- **`vehicle_schedule`** (`shared/schema.ts:618`) – vehicle availability/service windows
- **`resource_positions`** (`shared/schema.ts:689`) – GPS breadcrumb trail history
- **`planning_parameters`** (`shared/schema.ts:795`) – SLA levels, time windows, allowed weekdays
- **`resource_articles`** (`shared/schema.ts:820`) – which articles a resource can perform + efficiency
- **`teams` / `team_members`** (`shared/schema.ts:761,782`) – team composition + service areas
- **`subscriptions`** (`shared/schema.ts:633`) – recurring service with flexible frequency
- **`delivery_schedules`** (`shared/schema.ts:2690`) – periodicity per order concept
- **`route_feedback`** (`shared/schema.ts:4364`) – driver rating of route quality
- **`scheduling_locks`** (`shared/schema.ts:4618`) – mutex for concurrent planning
- **`task_desired_timewindows`** (`shared/schema.ts:1751`) – customer time window preferences
- **`object_time_restrictions`** (`shared/schema.ts:1853`) – access time restrictions per object
- **`task_dependencies`** (`shared/schema.ts:1782`) – task ordering constraints

---

## 3. Current Routing & Optimization Logic

### 3.1 `server/route-optimizer.ts` (778 lines) — Primary Routing Engine

**Two optimization modes:**

#### Mode A: Nearest-Neighbor Heuristic (`optimizeResourceDayRoute`)
- **Line 89:** `nearestNeighborOptimization()` — greedy nearest-neighbor from start position
- **Line 77:** `haversineDistance()` — straight-line distance (no road network)
- Uses resource's live GPS position (if <30 min old) or home location as start
- Calculates savings vs original order (time, distance, fuel, cost)
- Assumes 40 km/h average speed, 0.08 L/km fuel consumption, 450 SEK/hr labor
- **Line 134:** `getRouteFromGeoapify()` — road-distance routing (used for distance validation, not optimization)

#### Mode B: Geoapify VRP (`optimizeRoutesVRP`)
- **Line 438:** Full VRP via Geoapify Route Planner API (external service)
- Supports multi-vehicle, time windows, break scheduling
- Maps work orders → jobs with priority weights (urgent=100, high=75, normal=50, low=25)
- Handles `scheduledStartTime` as 1-hour time windows
- Default work hours: 08:00-17:00
- Includes break configuration (default: 30 min between 11:00-13:00)
- Falls back to Umeå coordinates (63.826, 20.263) if resource has no home location

#### Mode C: AI-Enhanced Nearest-Neighbor + 2-Opt (`server/ai-planner.ts:2551`)
- `optimizeRoute()` — applies nearest-neighbor then 2-opt local search improvement
- Tries all starting points, picks best total distance
- Optionally sends to GPT-4o-mini for human-readable feedback on the route
- `generateGoogleMapsUrl()` — creates navigation links for drivers

### 3.2 `server/distance-matrix-service.ts` (172 lines)
- `getRoutingDistance()` — single pair road distance via Geoapify with haversine fallback
- `getBatchDistances()` — batch mode with parallel API calls (5 concurrent)
- In-memory LRU cache (max 5000 entries, 2hr TTL)
- Haversine fallback assumes 35 km/h average speed

### 3.3 `server/scheduling-utils.ts` (445 lines)
- `generateScheduleDates()` — generates dates from FlexibleFrequency config
- Supports: specific weekdays, interval days, X per week/month/year, on-demand
- Season filtering: spring, summer, autumn, winter, not_winter, not_summer
- Day distribution algorithms for even spacing

### 3.4 `server/ai-planner.ts` (3349 lines) — AI Planning Engine
Key functions:
- `autoScheduleOrders()` (line 731) — AI-assisted scheduling using GPT
- `aiEnhancedSchedule()` (line 1018) — enhanced scheduling with KPIs + weather
- `analyzeWorkloadImbalances()` (line 855) — detects uneven distribution
- `generateAutoClusterSuggestions()` (line 2081) — auto-clustering via AI
- `generatePredictivePlanning()` (line 1834) — predictive demand forecasting
- `processConversationalPlannerQueryV2()` (line 2708) — NLP planning commands
- `calculatePlanningKPIs()` (line 99) — performance metrics

---

## 4. API Endpoints Related to Routing/Dispatch

| Endpoint | Method | File | Description |
|----------|--------|------|-------------|
| `/api/ai/optimize-routes` | POST | `aiRoutes.ts:1110` | Day route optimization (nearest-neighbor) |
| `/api/ai/optimize-vrp` | POST | `aiRoutes.ts:1130` | VRP optimization via Geoapify |
| `/api/ai/optimize-vrp/apply` | POST | `aiRoutes.ts:1314` | Apply VRP result (update order assignments) |
| `/api/ai/route-recommendations` | GET | `aiRoutes.ts:1175` | Weather + capacity recommendations |
| `/api/ai/auto-schedule` | POST | `aiRoutes.ts` | AI auto-scheduling |
| `/api/ai/auto-schedule/apply` | POST | `aiRoutes.ts` | Apply auto-schedule results |
| `/api/route/optimize` | POST | `fortnoxRoutes.ts:1403` | Alternative route optimize (uses ai-planner) |
| `/api/routes/optimize` | POST | `importRoutes.ts:357` | Another route optimization endpoint |
| `/api/planner/drivers/locations` | GET | `plannerRoutes.ts:118` | Live driver positions |
| `/api/planner/orders` | GET | `plannerRoutes.ts:141` | Planner order view |
| `/api/clusters` | GET/POST | `clusterRoutes.ts` | Cluster CRUD |
| `/api/clusters/:id/objects` | GET | `clusterRoutes.ts:93` | Objects in cluster |
| `/api/mobile/route-optimized` | GET | `mobileRoutes.ts:3197` | Optimized route for mobile |

---

## 5. Gaps & Limitations in Current Implementation

### Critical Gaps
1. **No true constraint-based optimization** — Nearest-neighbor + 2-opt is O(n²) but misses many optimal solutions. Geoapify VRP is external and limited in customization.
2. **No vehicle capacity constraints** — `vehicles.capacityTons/capacityVolume` exist in schema but are NOT used in any routing logic.
3. **No execution code matching** — Resources have `executionCodes` and orders have `executionCode`, but VRP doesn't filter by skill match.
4. **No time window enforcement** — `task_desired_timewindows` and `object_time_restrictions` tables exist but aren't fed into optimization.
5. **No async job processing** — All optimization runs synchronously in Express request handler. Large datasets (100+ orders) will timeout.
6. **In-memory cache only** — Route/distance cache is lost on server restart.
7. **No geographic pre-clustering** — Clusters are customer-hierarchical, not geographical. No spatial indexing.
8. **No multi-day horizon** — Optimization is single-day only. No rolling horizon or weekly optimization.
9. **No task dependency handling** — `task_dependencies` table exists but isn't used in routing.
10. **No real driving distances in optimization** — Nearest-neighbor uses haversine (crow-flies), not road network.

### Data Quality Gaps
- Many objects may lack `latitude`/`longitude` (filter drops them silently)
- No validation that geocoded positions are reasonable
- `entranceLatitude`/`entranceLongitude` used in VRP but may be sparse

---

## 6. Concrete Recommendations for Route Optimization

### 6.1 Architecture: Python Microservice with OR-Tools

**Recommendation:** Deploy a Python microservice alongside the Express app that handles heavy computation via Google OR-Tools.

**Why OR-Tools over JS alternatives:**
- OR-Tools has best-in-class CVRPTW (Capacitated VRP with Time Windows) solver
- Handles 1000+ stops efficiently with guided local search
- Native support for: vehicle capacity, time windows, skill matching, break scheduling, multi-depot
- Active Google-maintained project, well-documented

**New files to create:**

```
server/
├── optimization/
│   ├── queue.ts                    # BullMQ job queue manager
│   ├── optimization-client.ts      # HTTP client to Python microservice
│   └── optimization-types.ts       # Shared TypeScript interfaces
│
python-optimizer/
├── requirements.txt                # ortools, flask, redis, gunicorn
├── app.py                          # Flask API entry point
├── solver/
│   ├── vrp_solver.py               # OR-Tools CVRPTW implementation
│   ├── clustering.py               # Geographic pre-clustering (DBSCAN/k-means)
│   ├── distance_matrix.py          # OSRM/Geoapify distance matrix builder
│   └── models.py                   # Pydantic request/response models
├── cache/
│   └── redis_cache.py              # Redis-backed distance matrix cache
├── Dockerfile
└── tests/
    └── test_vrp_solver.py
```

### 6.2 Files to Modify in traivo-one

#### `server/route-optimizer.ts` — Refactor as Facade
Keep existing nearest-neighbor as fast fallback, add routing to Python service:

```typescript
// Add to server/route-optimizer.ts

import { OptimizationClient } from './optimization/optimization-client';
import { OptimizationQueue } from './optimization/queue';

const optimizationClient = new OptimizationClient(
  process.env.OPTIMIZER_SERVICE_URL || 'http://localhost:8080'
);
const optimizationQueue = new OptimizationQueue();

/**
 * Enhanced VRP optimization via OR-Tools microservice
 * Falls back to existing Geoapify/nearest-neighbor on failure
 */
export async function optimizeRoutesORTools(
  workOrders: WorkOrder[],
  resources: Resource[],
  objects: ServiceObject[],
  clusters: Cluster[],
  options: {
    breakConfig?: BreakConfig;
    respectTimeWindows?: boolean;
    respectCapacity?: boolean;
    respectSkills?: boolean;
    maxSolverTimeSeconds?: number;
  } = {}
): Promise<VRPOptimizationResult> {
  try {
    // Build request with all constraints
    const request = buildORToolsRequest(workOrders, resources, objects, clusters, options);
    
    // For small problems (<30 orders), solve synchronously
    if (workOrders.length < 30) {
      return await optimizationClient.solveSync(request);
    }
    
    // For large problems, queue async job
    const jobId = await optimizationQueue.enqueue(request);
    return {
      success: true,
      jobId, // Client polls for result
      routes: [],
      unassignedOrders: [],
      summary: { totalOrders: workOrders.length, assignedOrders: 0, 
                 totalDurationMinutes: 0, totalDistanceKm: 0, avgEfficiency: 0 },
    } as any;
  } catch (error) {
    console.warn('[OR-Tools] Falling back to Geoapify VRP:', error);
    return optimizeRoutesVRP(workOrders, resources, objects, clusters, options.breakConfig);
  }
}

function buildORToolsRequest(
  workOrders: WorkOrder[], resources: Resource[],
  objects: ServiceObject[], clusters: Cluster[], options: any
) {
  const objectMap = new Map(objects.map(o => [o.id, o]));
  
  return {
    jobs: workOrders.map(wo => {
      const obj = objectMap.get(wo.objectId);
      return {
        id: wo.id,
        latitude: obj?.entranceLatitude || obj?.latitude || wo.taskLatitude,
        longitude: obj?.entranceLongitude || obj?.longitude || wo.taskLongitude,
        duration_minutes: wo.estimatedDuration || 60,
        setup_minutes: wo.setupTime || obj?.avgSetupTime || 0,
        priority: wo.priority,
        execution_code: wo.executionCode,
        time_window_start: wo.plannedWindowStart?.toISOString(),
        time_window_end: wo.plannedWindowEnd?.toISOString(),
        cluster_id: wo.clusterId,
      };
    }).filter(j => j.latitude && j.longitude),
    
    vehicles: resources.map(r => ({
      id: r.id,
      name: r.name,
      start_lat: r.currentLatitude || r.homeLatitude,
      start_lng: r.currentLongitude || r.homeLongitude,
      end_lat: r.homeLatitude,
      end_lng: r.homeLongitude,
      execution_codes: r.executionCodes || [],
      capacity_tons: null, // Join from resource_vehicles if needed
      work_start_seconds: 8 * 3600,
      work_end_seconds: 17 * 3600,
      efficiency_factor: r.efficiencyFactor || 1.0,
    })),
    
    options: {
      max_solver_time_seconds: options.maxSolverTimeSeconds || 30,
      respect_time_windows: options.respectTimeWindows ?? true,
      respect_capacity: options.respectCapacity ?? false,
      respect_skills: options.respectSkills ?? true,
      distance_matrix_source: 'osrm', // or 'geoapify'
    }
  };
}
```

#### `server/routes/aiRoutes.ts` — Add New Endpoints

Add these endpoints near line 1130:

```typescript
// POST /api/ai/optimize-ortools — sync for small, async for large
app.post("/api/ai/optimize-ortools", asyncHandler(async (req, res) => {
    const { optimizeRoutesORTools } = await import("../route-optimizer");
    const { date, clusterId, options } = req.body;
    const tenantId = getTenantIdWithFallback(req);
    
    const [workOrders, resources, objects, clusters] = await Promise.all([
      storage.getWorkOrders(tenantId),
      storage.getResources(tenantId),
      storage.getObjects(tenantId),
      storage.getClusters(tenantId),
    ]);
    
    // Filter same as existing optimize-vrp
    let filtered = workOrders.filter(o => 
      o.orderStatus !== "utford" && o.orderStatus !== "fakturerad"
    );
    if (date) filtered = filtered.filter(o => /*date match*/);
    if (clusterId) filtered = filtered.filter(o => o.clusterId === clusterId);
    
    const result = await optimizeRoutesORTools(filtered, resources, objects, clusters, options);
    res.json(result);
}));

// GET /api/ai/optimization-job/:jobId — poll async job status
app.get("/api/ai/optimization-job/:jobId", asyncHandler(async (req, res) => {
    const { getJobStatus } = await import("../optimization/queue");
    const status = await getJobStatus(req.params.jobId);
    res.json(status);
}));
```

### 6.3 Python OR-Tools Microservice Implementation

**`python-optimizer/solver/vrp_solver.py`:**

```python
from ortools.constraint_solver import routing_enums_pb2, pywrapcp
import numpy as np

def solve_cvrptw(data: dict) -> dict:
    """
    Solve Capacitated VRP with Time Windows using OR-Tools.
    
    data = {
        'distance_matrix': [[...], ...],  # meters between all points
        'time_matrix': [[...], ...],       # seconds between all points  
        'demands': [0, d1, d2, ...],       # demand at each node (0 = depot)
        'vehicle_capacities': [cap1, ...],
        'time_windows': [(start, end), ...],  # seconds from midnight
        'service_times': [0, t1, t2, ...],    # seconds at each stop
        'num_vehicles': N,
        'depot_indices': [0, ...],            # multi-depot support
        'skill_matrix': [[...], ...],         # vehicle×job skill compatibility
        'penalties': [0, p1, p2, ...],        # drop penalties (allow unassigned)
        'max_solver_time': 30,                # seconds
    }
    """
    manager = pywrapcp.RoutingIndexManager(
        len(data['distance_matrix']),
        data['num_vehicles'],
        data['depot_indices'],  # starts
        data['depot_indices'],  # ends (return to depot)
    )
    routing = pywrapcp.RoutingModel(manager)
    
    # Distance callback
    def distance_callback(from_idx, to_idx):
        from_node = manager.IndexToNode(from_idx)
        to_node = manager.IndexToNode(to_idx)
        return data['distance_matrix'][from_node][to_node]
    
    transit_callback_idx = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_idx)
    
    # Time dimension (for time windows)
    def time_callback(from_idx, to_idx):
        from_node = manager.IndexToNode(from_idx)
        to_node = manager.IndexToNode(to_idx)
        travel = data['time_matrix'][from_node][to_node]
        service = data['service_times'][from_node]
        return travel + service
    
    time_callback_idx = routing.RegisterTransitCallback(time_callback)
    routing.AddDimensionWithVehicleCapacity(
        time_callback_idx, 
        30 * 60,           # max waiting time (30 min slack)
        [data['time_windows'][d][1] for d in data['depot_indices']],  # vehicle max time
        False,             # don't force start cumul to zero
        'Time'
    )
    time_dimension = routing.GetDimensionOrDie('Time')
    
    # Apply time windows
    for location_idx, tw in enumerate(data['time_windows']):
        if location_idx in data['depot_indices']:
            continue
        index = manager.NodeToIndex(location_idx)
        time_dimension.CumulVar(index).SetRange(tw[0], tw[1])
    
    # Allow dropping nodes with penalty (for infeasible assignments)
    for node in range(1, len(data['distance_matrix'])):
        penalty = data['penalties'][node] if node < len(data['penalties']) else 100000
        routing.AddDisjunction([manager.NodeToIndex(node)], penalty)
    
    # Skill/competency constraints
    if 'skill_matrix' in data:
        for vehicle_id in range(data['num_vehicles']):
            for node in range(1, len(data['distance_matrix'])):
                if not data['skill_matrix'][vehicle_id][node]:
                    routing.VehicleVar(manager.NodeToIndex(node)).RemoveValue(vehicle_id)
    
    # Solve
    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_params.time_limit.FromSeconds(data.get('max_solver_time', 30))
    
    solution = routing.SolveWithParameters(search_params)
    
    if not solution:
        return {'success': False, 'error': 'No solution found'}
    
    return extract_solution(manager, routing, solution, data)


def extract_solution(manager, routing, solution, data):
    routes = []
    total_distance = 0
    total_time = 0
    
    time_dimension = routing.GetDimensionOrDie('Time')
    
    for vehicle_id in range(data['num_vehicles']):
        route_stops = []
        index = routing.Start(vehicle_id)
        route_distance = 0
        
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            time_var = time_dimension.CumulVar(index)
            
            if node not in data['depot_indices']:
                route_stops.append({
                    'node_index': node,
                    'arrival_seconds': solution.Min(time_var),
                    'departure_seconds': solution.Max(time_var) + data['service_times'][node],
                })
            
            prev_index = index
            index = solution.Value(routing.NextVar(index))
            route_distance += routing.GetArcCostForVehicle(prev_index, index, vehicle_id)
        
        if route_stops:
            routes.append({
                'vehicle_id': vehicle_id,
                'stops': route_stops,
                'total_distance_m': route_distance,
            })
            total_distance += route_distance
    
    # Identify unassigned
    unassigned = []
    for node in range(1, len(data['distance_matrix'])):
        index = manager.NodeToIndex(node)
        if solution.Value(routing.NextVar(index)) == index:
            unassigned.append(node)
    
    return {
        'success': True,
        'routes': routes,
        'unassigned_nodes': unassigned,
        'total_distance_m': total_distance,
    }
```

### 6.4 Async Job Queue Implementation

**Install:** Add Redis + BullMQ to the stack.

**`server/optimization/queue.ts`:**

```typescript
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const optimizationQueue = new Queue('route-optimization', { connection: redis });

// Store results in Redis with 1-hour TTL
const RESULT_TTL = 3600;

export class OptimizationQueue {
  async enqueue(request: any): Promise<string> {
    const job = await optimizationQueue.add('optimize', request, {
      removeOnComplete: { age: RESULT_TTL },
      removeOnFail: { age: RESULT_TTL },
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    });
    return job.id!;
  }
}

export async function getJobStatus(jobId: string) {
  const job = await Job.fromId(optimizationQueue, jobId);
  if (!job) return { status: 'not_found' };
  
  const state = await job.getState();
  return {
    status: state, // 'waiting' | 'active' | 'completed' | 'failed'
    progress: job.progress,
    result: state === 'completed' ? job.returnvalue : undefined,
    error: state === 'failed' ? job.failedReason : undefined,
  };
}

// Worker process (can run in separate process for isolation)
export function startOptimizationWorker() {
  const worker = new Worker('route-optimization', async (job) => {
    const { OptimizationClient } = await import('./optimization-client');
    const client = new OptimizationClient(
      process.env.OPTIMIZER_SERVICE_URL || 'http://localhost:8080'
    );
    
    job.updateProgress(10);
    const result = await client.solveSync(job.data);
    job.updateProgress(100);
    
    return result;
  }, { connection: redis, concurrency: 2 });
  
  worker.on('failed', (job, err) => {
    console.error(`[optimization-worker] Job ${job?.id} failed:`, err);
  });
  
  return worker;
}
```

### 6.5 Geographic Pre-Clustering

**`python-optimizer/solver/clustering.py`:**

```python
import numpy as np
from sklearn.cluster import DBSCAN, KMeans
from typing import List, Dict

def geographic_cluster(
    stops: List[Dict],
    num_vehicles: int,
    method: str = 'balanced_kmeans',
    max_radius_km: float = 15.0,
) -> List[List[Dict]]:
    """
    Pre-cluster stops geographically before VRP.
    
    Splits large problem into sub-problems that OR-Tools can solve faster.
    Each cluster is assigned to one or more vehicles.
    
    Methods:
    - 'dbscan': density-based (good for natural groupings)
    - 'balanced_kmeans': capacity-balanced k-means (good for even distribution)
    """
    if len(stops) <= num_vehicles * 15:
        return [stops]  # Small enough, no need to cluster
    
    coords = np.array([[s['latitude'], s['longitude']] for s in stops])
    
    if method == 'dbscan':
        # eps in radians ≈ km / 6371
        eps_rad = max_radius_km / 6371.0
        clustering = DBSCAN(eps=eps_rad, min_samples=3, metric='haversine')
        labels = clustering.fit_predict(np.radians(coords))
    else:
        # Balanced k-means: target num_vehicles clusters
        n_clusters = min(num_vehicles, len(stops) // 5)
        n_clusters = max(2, n_clusters)
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        labels = kmeans.fit_predict(coords)
    
    # Group stops by cluster
    clusters = {}
    for stop, label in zip(stops, labels):
        label = int(label) if label >= 0 else -1
        clusters.setdefault(label, []).append(stop)
    
    # Redistribute outliers (DBSCAN label -1) to nearest cluster
    if -1 in clusters:
        outliers = clusters.pop(-1)
        centroids = {}
        for lbl, members in clusters.items():
            centroids[lbl] = np.mean(
                [[m['latitude'], m['longitude']] for m in members], axis=0
            )
        for outlier in outliers:
            pt = np.array([outlier['latitude'], outlier['longitude']])
            nearest = min(centroids, key=lambda l: np.linalg.norm(pt - centroids[l]))
            clusters[nearest].append(outlier)
    
    return list(clusters.values())
```

**Integration in route-optimizer.ts:**

```typescript
// In buildORToolsRequest(), add clustering as pre-processing:
async function buildORToolsRequestWithClustering(
  workOrders: WorkOrder[], resources: Resource[],
  objects: ServiceObject[], clusters: Cluster[], options: any
) {
  const request = buildORToolsRequest(workOrders, resources, objects, clusters, options);
  
  // For large problems, request pre-clustering from Python service
  if (request.jobs.length > 100) {
    request.options.pre_cluster = true;
    request.options.cluster_method = 'balanced_kmeans';
    request.options.max_cluster_radius_km = 15;
  }
  
  return request;
}
```

### 6.6 Persistent Distance Matrix Cache (Redis)

Replace in-memory `Map` in `server/distance-matrix-service.ts`:

```typescript
// Modify server/distance-matrix-service.ts to use Redis

import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const CACHE_PREFIX = 'dist:';
const CACHE_TTL_SECONDS = 7200; // 2 hours

async function getCachedDistance(key: string): Promise<DistanceResult | null> {
  const cached = await redis.get(CACHE_PREFIX + key);
  return cached ? JSON.parse(cached) : null;
}

async function setCachedDistance(key: string, result: DistanceResult): Promise<void> {
  await redis.setex(CACHE_PREFIX + key, CACHE_TTL_SECONDS, JSON.stringify(result));
}

// Pre-compute distance matrix for a set of locations
export async function precomputeDistanceMatrix(
  locations: Array<{ id: string; lat: number; lng: number }>
): Promise<Map<string, Map<string, DistanceResult>>> {
  const matrix = new Map();
  const pairs: BatchPair[] = [];
  
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      pairs.push({
        id: `${locations[i].id}:${locations[j].id}`,
        fromLat: locations[i].lat, fromLng: locations[i].lng,
        toLat: locations[j].lat, toLng: locations[j].lng,
      });
    }
  }
  
  const results = await getBatchDistances(pairs);
  // ... build symmetric matrix from results
  return matrix;
}
```

### 6.7 Constraint Integration — Time Windows & Skills

**Modify `server/route-optimizer.ts` `buildORToolsRequest()`** to include:

```typescript
// Fetch time windows and restrictions
async function enrichWithConstraints(
  request: any, tenantId: string
) {
  // 1. Time windows from task_desired_timewindows
  const timewindows = await db.select()
    .from(taskDesiredTimewindows)
    .where(eq(taskDesiredTimewindows.tenantId, tenantId));
  
  for (const tw of timewindows) {
    const job = request.jobs.find(j => j.id === tw.workOrderId);
    if (job && tw.startTime && tw.endTime) {
      job.time_window_start = tw.startTime;
      job.time_window_end = tw.endTime;
    }
  }
  
  // 2. Object time restrictions
  const restrictions = await db.select()
    .from(objectTimeRestrictions)
    .where(eq(objectTimeRestrictions.tenantId, tenantId));
  
  for (const r of restrictions) {
    const jobs = request.jobs.filter(j => j.object_id === r.objectId);
    for (const job of jobs) {
      job.access_window_start = r.allowedFromTime;
      job.access_window_end = r.allowedToTime;
    }
  }
  
  // 3. Skill matching (execution codes)
  for (const vehicle of request.vehicles) {
    vehicle.skill_compatibility = request.jobs.map(job => {
      if (!job.execution_code) return true; // No skill required
      return vehicle.execution_codes.includes(job.execution_code);
    });
  }
  
  // 4. Resource-article efficiency
  const resourceArticles = await db.select()
    .from(resourceArticlesTable)
    .where(inArray(resourceArticlesTable.resourceId, request.vehicles.map(v => v.id)));
  // ... apply efficiency factors to service times per vehicle
  
  return request;
}
```

### 6.8 Full Integration Hook — Where to Wire Everything

```
Existing flow:
  Client → POST /api/ai/optimize-vrp → aiRoutes.ts → route-optimizer.ts → Geoapify API

New flow (parallel, user-selectable):
  Client → POST /api/ai/optimize-ortools → aiRoutes.ts
    ├─ Small (<30 orders) → optimization-client.ts → Python Flask → OR-Tools → response
    └─ Large (30+ orders) → queue.ts (BullMQ) → Worker → Python Flask → OR-Tools
                              └─ Returns jobId → Client polls GET /api/ai/optimization-job/:id
```

---

## 7. Implementation Priority & Roadmap

### Phase 1: Foundation (1-2 weeks)
1. **Set up Redis** for persistent caching + job queue
2. **Create `server/optimization/queue.ts`** with BullMQ
3. **Create `server/optimization/optimization-client.ts`** — HTTP client to Python service
4. **Deploy Python microservice** (`python-optimizer/`) with Flask + OR-Tools
5. **Implement basic CVRPTW solver** in `vrp_solver.py`
6. **Migrate distance cache** from in-memory Map to Redis

### Phase 2: Core Optimization (2-3 weeks)
7. **Integrate constraints** — time windows, skills, capacity
8. **Implement geographic pre-clustering** in Python
9. **Add async job processing** for large datasets
10. **New API endpoints** (`/api/ai/optimize-ortools`, `/api/ai/optimization-job/:id`)
11. **Update `RouteOptimizationPanel.tsx`** to support OR-Tools mode + async polling

### Phase 3: Intelligence (2-3 weeks)
12. **Multi-day horizon optimization** — optimize weekly, not just daily
13. **Learning from route feedback** — use `route_feedback` table to tune solver parameters
14. **Historical travel time modeling** — time-of-day dependent travel times
15. **Predictive demand integration** — connect `generatePredictivePlanning()` to optimizer
16. **Automatic re-optimization** — trigger on new orders, cancellations, GPS deviations

### Phase 4: Parity with Nordic Routing / Routific (ongoing)
17. **Driver mobile re-routing** — push updated route to Traivo Go in real-time
18. **Customer notification integration** — ETA updates based on real-time route progress
19. **Load balancing** — balance workload across resources considering efficiency factors
20. **What-if simulation** — use `simulation_scenarios` table for scenario comparison

---

## 8. Key Decision Points

| Decision | Options | Recommendation |
|----------|---------|----------------|
| OR-Tools deployment | Sidecar container vs. separate service vs. serverless | **Docker sidecar** — simplest to deploy alongside Express |
| Distance matrix source | Geoapify vs. OSRM self-hosted vs. Google Maps | **OSRM self-hosted** for Sweden — free, fast, accurate road distances |
| Job queue | BullMQ (Redis) vs. pg-boss (Postgres) vs. external (SQS) | **BullMQ** — battle-tested, good monitoring, fits Redis cache strategy |
| Pre-clustering | DBSCAN vs. K-Means vs. postal code grouping | **Balanced K-Means** first, then experiment with DBSCAN for natural clusters |
| Solver time limit | Fixed vs. adaptive | **Adaptive** — 5s for <50 stops, 30s for 50-200, 120s for 200+ |

---

## 9. Summary

Traivo has a solid foundation with well-structured data models that already capture most information needed for advanced routing: GPS coordinates, time windows, resource skills, vehicle capacity, SLA levels, and customer preferences. The current optimization is a basic nearest-neighbor + 2-opt heuristic with Geoapify VRP as an alternative.

**The biggest wins will come from:**
1. **OR-Tools CVRPTW** — 20-40% better routes than nearest-neighbor, with proper constraint handling
2. **Async job queue** — removes timeout risk, enables optimization of 500+ orders
3. **Geographic pre-clustering** — divides large problems into solvable sub-problems
4. **Persistent Redis cache** — eliminates cold-start penalty, enables distance matrix pre-computation
5. **Constraint integration** — using the rich data already in the schema (time windows, skills, capacity) that current routing ignores

The recommended architecture keeps the existing Express server as the API layer and adds a Python microservice solely for heavy optimization computation, connected via BullMQ job queue and Redis cache.
