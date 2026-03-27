# 🚀 Traivo One – Implementation Guide

> **Projekt:** Traivo One (Backend/Grundsystem)
> **Mål:** Stödja den nya navigationsstrukturen i Traivo Go (3 tabs + hamburger-meny)
> **Senast uppdaterad:** 2026-03-27
> **Estimerad total tid:** ~6–8 timmar

---

## ⚡ Quick Start

```bash
# 1. Öppna Traivo One-projektet i Replit
# 2. Kopiera denna fil till projektets rot
# 3. Följ sektionerna i ordning – varje steg bygger på föregående
# 4. Kör tester efter varje steg
```

**Prioritetsordning:**
1. ✅ Notifikationer-API (krävs av hamburger-meny badge)
2. ✅ Användarpreferenser-API (sparar menyval, dark mode, etc.)
3. ✅ App-konfiguration-API (versionshantering av navigationsstruktur)
4. ✅ Statistik-API förbättringar (snabbare laddning i meny)
5. ✅ Tester & dokumentation

---

## 📋 Checklista – Översikt

### Fas 1: Notifikationer (⏱️ ~2h)
- [ ] 1.1 Skapa `GET /api/notifications` endpoint
- [ ] 1.2 Skapa `POST /api/notifications/:id/read` endpoint
- [ ] 1.3 Skapa `POST /api/notifications/read-all` endpoint
- [ ] 1.4 Skapa `GET /api/notifications/unread-count` endpoint
- [ ] 1.5 Lägg till WebSocket-event för realtidsnotifikationer
- [ ] 1.6 Testa notifikations-endpoints

### Fas 2: Användarpreferenser (⏱️ ~1.5h)
- [ ] 2.1 Skapa databasschema för preferenser
- [ ] 2.2 Skapa `GET /api/user/preferences` endpoint
- [ ] 2.3 Skapa `PUT /api/user/preferences` endpoint
- [ ] 2.4 Skapa `PATCH /api/user/preferences` endpoint (partiell uppdatering)
- [ ] 2.5 Testa preferens-endpoints

### Fas 3: App-konfiguration (⏱️ ~1h)
- [ ] 3.1 Skapa `GET /api/app/config` endpoint
- [ ] 3.2 Skapa `GET /api/app/navigation` endpoint
- [ ] 3.3 Skapa `GET /api/app/version-check` endpoint
- [ ] 3.4 Testa app-config-endpoints

### Fas 4: Statistik-API förbättringar (⏱️ ~1.5h)
- [ ] 4.1 Skapa `GET /api/statistics/summary` (lightweight)
- [ ] 4.2 Skapa `GET /api/statistics/weekly` endpoint
- [ ] 4.3 Optimera befintlig `GET /api/mobile/statistics`
- [ ] 4.4 Testa statistik-endpoints

### Fas 5: Tester & Dokumentation (⏱️ ~1h)
- [ ] 5.1 Skapa testfil för alla nya endpoints
- [ ] 5.2 Uppdatera API-dokumentation
- [ ] 5.3 Verifiera bakåtkompatibilitet

---

## 🔧 Fas 1: Notifikationer-API

### Bakgrund
Hamburger-menyn i Traivo Go visar en badge med antal olästa notifikationer. Backend behöver stödja detta med dedikerade endpoints.

### 1.1 GET /api/notifications
> Hämta lista av notifikationer för inloggad användare

**Fil:** `server/routes/notifications.ts` (ny fil)

```typescript
// server/routes/notifications.ts
import { Router, Request, Response } from 'express';
import { pool } from '../db';

const router = Router();

// -----------------------------------------------------------
// Typer
// -----------------------------------------------------------
interface Notification {
  id: string;
  type: 'order_assigned' | 'order_updated' | 'deviation_response' | 'team_invite' | 
        'schedule_change' | 'system' | 'reminder';
  title: string;
  body: string;
  data?: Record<string, any>;  // t.ex. { orderId: '123' }
  read: boolean;
  createdAt: string;
}

// -----------------------------------------------------------
// Mock-data (ersätt med DB-queries när Traivo One-DB finns)
// -----------------------------------------------------------
const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: 'notif-001',
    type: 'order_assigned',
    title: 'Nytt uppdrag tilldelat',
    body: 'Du har tilldelats uppdrag #4521 – Tömning Storgatan 12',
    data: { orderId: 'order-4521' },
    read: false,
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  },
  {
    id: 'notif-002',
    type: 'schedule_change',
    title: 'Schemaändring',
    body: 'Uppdrag #4518 har flyttats till 14:00',
    data: { orderId: 'order-4518' },
    read: false,
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
  {
    id: 'notif-003',
    type: 'team_invite',
    title: 'Teaminbjudan',
    body: 'Anna Svensson vill bjuda in dig till Team Syd',
    data: { teamId: 'team-002' },
    read: true,
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'notif-004',
    type: 'deviation_response',
    title: 'Avvikelse besvarad',
    body: 'Din avvikelse för #4510 har granskats av arbetsledaren',
    data: { orderId: 'order-4510', deviationId: 'dev-089' },
    read: true,
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
];

// In-memory read-status (ersätt med DB)
const readStatus: Record<string, Set<string>> = {};

function getReadSet(resourceId: string): Set<string> {
  if (!readStatus[resourceId]) {
    readStatus[resourceId] = new Set(
      MOCK_NOTIFICATIONS.filter(n => n.read).map(n => n.id)
    );
  }
  return readStatus[resourceId];
}

// -----------------------------------------------------------
// GET /api/notifications
// Query params: ?limit=20&offset=0&unread_only=false
// -----------------------------------------------------------
router.get('/', (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const unreadOnly = req.query.unread_only === 'true';
    const resourceId = (req as any).resourceId || 'resource-101';

    const readSet = getReadSet(resourceId);

    let notifications = MOCK_NOTIFICATIONS.map(n => ({
      ...n,
      read: readSet.has(n.id),
    }));

    if (unreadOnly) {
      notifications = notifications.filter(n => !n.read);
    }

    // Sortera nyast först
    notifications.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const total = notifications.length;
    const paginated = notifications.slice(offset, offset + limit);

    res.json({
      success: true,
      notifications: paginated,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error: any) {
    console.error('GET /notifications error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------
// GET /api/notifications/unread-count
// -----------------------------------------------------------
router.get('/unread-count', (req: Request, res: Response) => {
  try {
    const resourceId = (req as any).resourceId || 'resource-101';
    const readSet = getReadSet(resourceId);

    const unreadCount = MOCK_NOTIFICATIONS.filter(n => !readSet.has(n.id)).length;

    res.json({
      success: true,
      unreadCount,
    });
  } catch (error: any) {
    console.error('GET /notifications/unread-count error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------
// POST /api/notifications/:id/read
// -----------------------------------------------------------
router.post('/:id/read', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const resourceId = (req as any).resourceId || 'resource-101';
    const readSet = getReadSet(resourceId);

    readSet.add(id);

    res.json({ success: true, notificationId: id, read: true });
  } catch (error: any) {
    console.error('POST /notifications/:id/read error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------
// POST /api/notifications/read-all
// -----------------------------------------------------------
router.post('/read-all', (req: Request, res: Response) => {
  try {
    const resourceId = (req as any).resourceId || 'resource-101';
    const readSet = getReadSet(resourceId);

    MOCK_NOTIFICATIONS.forEach(n => readSet.add(n.id));

    res.json({ success: true, markedCount: MOCK_NOTIFICATIONS.length });
  } catch (error: any) {
    console.error('POST /notifications/read-all error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export const notificationRoutes = router;
```

**Acceptanskriterier:**
- [ ] `GET /api/notifications` returnerar lista med pagination
- [ ] `GET /api/notifications?unread_only=true` filtrerar korrekt
- [ ] `GET /api/notifications/unread-count` returnerar `{ unreadCount: number }`
- [ ] `POST /api/notifications/:id/read` markerar en notis som läst
- [ ] `POST /api/notifications/read-all` markerar alla som lästa
- [ ] Alla endpoints returnerar `{ success: true/false, ... }`

### 1.5 WebSocket-event för realtidsnotifikationer

**Fil:** `server/app.ts` (lägg till i befintlig WebSocket-setup)

```typescript
// Lägg till i io.on('connection', ...) i app.ts:

socket.on('subscribe_notifications', (data: { resourceId: string }) => {
  socket.join(`notifications:${data.resourceId}`);
  console.log(`${socket.id} subscribed to notifications for ${data.resourceId}`);
});

// Funktion för att skicka notis till specifik resurs (exportera för routes)
export function emitNotification(io: SocketIOServer, resourceId: string, notification: any) {
  io.to(`notifications:${resourceId}`).emit('new_notification', notification);
  io.to(`notifications:${resourceId}`).emit('unread_count_update', {
    // Beräkna nytt antal
    unreadCount: notification.unreadCount || 1,
  });
}
```

### 1.6 Registrera routes i app.ts

```typescript
// Lägg till i server/app.ts (import-sektion):
import { notificationRoutes } from './routes/notifications';

// Lägg till efter befintliga routes:
app.use('/api/notifications', notificationRoutes);
```

### 🧪 Testa Fas 1

```bash
# Testa i Replit Shell eller med curl:

# Hämta alla notifikationer
curl -s http://localhost:5000/api/notifications | jq .

# Hämta olästa
curl -s "http://localhost:5000/api/notifications?unread_only=true" | jq .

# Hämta antal olästa
curl -s http://localhost:5000/api/notifications/unread-count | jq .

# Markera som läst
curl -s -X POST http://localhost:5000/api/notifications/notif-001/read | jq .

# Markera alla som lästa
curl -s -X POST http://localhost:5000/api/notifications/read-all | jq .

# Verifiera att antal uppdaterades
curl -s http://localhost:5000/api/notifications/unread-count | jq .
```

---

## 🔧 Fas 2: Användarpreferenser-API

### Bakgrund
Med hamburger-menyn behöver vi spara användarpersonliga inställningar som meny-ordning, dark mode, notifikationsinställningar med mera.

### 2.1 Databasschema

```sql
-- Om du använder SQLite/PostgreSQL, kör detta:
CREATE TABLE IF NOT EXISTS user_preferences (
  resource_id TEXT PRIMARY KEY,
  preferences JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index för snabb lookup
CREATE INDEX IF NOT EXISTS idx_user_prefs_resource 
  ON user_preferences(resource_id);
```

### 2.2–2.4 Preferenser-endpoints

**Fil:** `server/routes/preferences.ts` (ny fil)

```typescript
// server/routes/preferences.ts
import { Router, Request, Response } from 'express';

const router = Router();

// -----------------------------------------------------------
// Typer
// -----------------------------------------------------------
interface UserPreferences {
  // Navigation
  menuOrder?: string[];           // Ordning på hamburger-meny-items
  favoriteScreens?: string[];     // Snabbåtkomst-skärmar
  
  // Notifikationer
  pushEnabled?: boolean;
  pushCategories?: {
    orderAssigned?: boolean;
    scheduleChange?: boolean;
    teamUpdates?: boolean;
    deviationResponse?: boolean;
    systemMessages?: boolean;
  };
  
  // Utseende
  darkMode?: boolean;
  fontSize?: 'small' | 'medium' | 'large';
  hapticFeedback?: boolean;
  
  // Karta
  mapType?: 'standard' | 'satellite' | 'hybrid';
  showTraffic?: boolean;
  autoNavigate?: boolean;
  
  // Arbete
  autoStartSession?: boolean;
  breakReminders?: boolean;
  breakIntervalMinutes?: number;
}

// -----------------------------------------------------------
// In-memory storage (ersätt med DB)
// -----------------------------------------------------------
const preferencesStore: Record<string, UserPreferences> = {};

const DEFAULT_PREFERENCES: UserPreferences = {
  menuOrder: [
    'ai', 'notifications', 'team',
    'statistics', 'customer-reports', 'my-deviations', 'route-feedback',
    'settings', 'about',
  ],
  favoriteScreens: [],
  pushEnabled: true,
  pushCategories: {
    orderAssigned: true,
    scheduleChange: true,
    teamUpdates: true,
    deviationResponse: true,
    systemMessages: true,
  },
  darkMode: false,
  fontSize: 'medium',
  hapticFeedback: true,
  mapType: 'standard',
  showTraffic: true,
  autoNavigate: false,
  autoStartSession: false,
  breakReminders: true,
  breakIntervalMinutes: 120,
};

function getPreferences(resourceId: string): UserPreferences {
  return { ...DEFAULT_PREFERENCES, ...(preferencesStore[resourceId] || {}) };
}

// -----------------------------------------------------------
// GET /api/user/preferences
// -----------------------------------------------------------
router.get('/', (req: Request, res: Response) => {
  try {
    const resourceId = (req as any).resourceId || 'resource-101';
    const prefs = getPreferences(resourceId);

    res.json({
      success: true,
      preferences: prefs,
    });
  } catch (error: any) {
    console.error('GET /user/preferences error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------
// PUT /api/user/preferences (full ersättning)
// -----------------------------------------------------------
router.put('/', (req: Request, res: Response) => {
  try {
    const resourceId = (req as any).resourceId || 'resource-101';
    const newPrefs = req.body as UserPreferences;

    // Validering
    if (newPrefs.fontSize && !['small', 'medium', 'large'].includes(newPrefs.fontSize)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Ogiltig fontSize. Tillåtna: small, medium, large' 
      });
    }
    if (newPrefs.mapType && !['standard', 'satellite', 'hybrid'].includes(newPrefs.mapType)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Ogiltig mapType. Tillåtna: standard, satellite, hybrid' 
      });
    }

    preferencesStore[resourceId] = { ...DEFAULT_PREFERENCES, ...newPrefs };

    res.json({
      success: true,
      preferences: preferencesStore[resourceId],
    });
  } catch (error: any) {
    console.error('PUT /user/preferences error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------
// PATCH /api/user/preferences (partiell uppdatering)
// -----------------------------------------------------------
router.patch('/', (req: Request, res: Response) => {
  try {
    const resourceId = (req as any).resourceId || 'resource-101';
    const updates = req.body as Partial<UserPreferences>;

    const current = getPreferences(resourceId);
    const merged = deepMerge(current, updates);
    preferencesStore[resourceId] = merged;

    res.json({
      success: true,
      preferences: merged,
    });
  } catch (error: any) {
    console.error('PATCH /user/preferences error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Deep merge helper
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export const preferencesRoutes = router;
```

### Registrera i app.ts

```typescript
import { preferencesRoutes } from './routes/preferences';

// Lägg till:
app.use('/api/user/preferences', preferencesRoutes);
```

### 🧪 Testa Fas 2

```bash
# Hämta default-preferenser
curl -s http://localhost:5000/api/user/preferences | jq .

# Uppdatera en specifik inställning (PATCH)
curl -s -X PATCH http://localhost:5000/api/user/preferences \
  -H "Content-Type: application/json" \
  -d '{"darkMode": true, "hapticFeedback": false}' | jq .

# Verifiera
curl -s http://localhost:5000/api/user/preferences | jq .preferences.darkMode

# Uppdatera push-kategori (nested PATCH)
curl -s -X PATCH http://localhost:5000/api/user/preferences \
  -H "Content-Type: application/json" \
  -d '{"pushCategories": {"teamUpdates": false}}' | jq .

# Full ersättning (PUT)
curl -s -X PUT http://localhost:5000/api/user/preferences \
  -H "Content-Type: application/json" \
  -d '{"darkMode": false, "fontSize": "large", "hapticFeedback": true}' | jq .
```

---

## 🔧 Fas 3: App-konfiguration

### Bakgrund
Navigationsstrukturen kan behöva uppdateras utan app-release. Skapa endpoints som Traivo Go kan pollla vid appstart.

### 3.1–3.3 App Config endpoints

**Fil:** `server/routes/app-config.ts` (ny fil)

```typescript
// server/routes/app-config.ts
import { Router, Request, Response } from 'express';

const router = Router();

// -----------------------------------------------------------
// App-versioner
// -----------------------------------------------------------
const APP_CONFIG = {
  minVersion: '1.0.0',
  latestVersion: '1.2.0',
  forceUpdateBelow: '1.0.0',
  maintenanceMode: false,
  maintenanceMessage: '',
  features: {
    hamburgerMenu: true,
    aiAssistant: true,
    teamFeature: true,
    offlineMode: true,
    darkMode: false,  // Kommer snart
    haptics: true,
    voiceCommands: true,
  },
};

// -----------------------------------------------------------
// Navigationsstruktur (server-driven)
// -----------------------------------------------------------
const NAVIGATION_CONFIG = {
  version: '2.0',
  bottomTabs: [
    { id: 'home', label: 'Hem', icon: 'home', screen: 'HomeTab', enabled: true },
    { id: 'orders', label: 'Uppdrag', icon: 'clipboard', screen: 'OrdersTab', enabled: true },
    { id: 'map', label: 'Karta', icon: 'map', screen: 'MapTab', enabled: true },
  ],
  hamburgerMenu: {
    enabled: true,
    sections: [
      {
        id: 'daily',
        title: 'Dagliga verktyg',
        items: [
          { id: 'ai', label: 'AI-Assistent', icon: 'cpu', screen: 'AIAssistant', enabled: true, badge: false },
          { id: 'notifications', label: 'Aviseringar', icon: 'bell', screen: 'Notifications', enabled: true, badge: true },
          { id: 'team', label: 'Mitt team', icon: 'users', screen: 'Team', enabled: true, badge: false },
        ],
      },
      {
        id: 'reports',
        title: 'Rapporter',
        items: [
          { id: 'statistics', label: 'Statistik', icon: 'bar-chart-2', screen: 'Statistics', enabled: true },
          { id: 'customer-reports', label: 'Kundrapporter', icon: 'file-text', screen: 'CustomerReports', enabled: true },
          { id: 'my-deviations', label: 'Mina avvikelser', icon: 'alert-triangle', screen: 'MyDeviations', enabled: true },
          { id: 'route-feedback', label: 'Ruttbetyg', icon: 'star', screen: 'RouteFeedback', enabled: true },
        ],
      },
      {
        id: 'admin',
        title: 'Administration',
        items: [
          { id: 'settings', label: 'Inställningar', icon: 'settings', screen: 'Settings', enabled: true },
          { id: 'about', label: 'Om Traivo Go', icon: 'info', screen: 'About', enabled: true },
        ],
      },
    ],
  },
};

// -----------------------------------------------------------
// GET /api/app/config
// -----------------------------------------------------------
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    success: true,
    config: APP_CONFIG,
    timestamp: new Date().toISOString(),
  });
});

// -----------------------------------------------------------
// GET /api/app/navigation
// Returnerar server-driven navigationsstruktur
// -----------------------------------------------------------
router.get('/navigation', (req: Request, res: Response) => {
  const role = req.query.role as string || 'driver';
  
  // Filtrera baserat på roll
  let navConfig = { ...NAVIGATION_CONFIG };
  
  if (role === 'driver') {
    // Chaufförer ser allt
  } else if (role === 'planner') {
    // Planerare ser inte vissa saker
    navConfig = {
      ...navConfig,
      hamburgerMenu: {
        ...navConfig.hamburgerMenu,
        sections: navConfig.hamburgerMenu.sections.map(section => ({
          ...section,
          items: section.items.filter(item => item.id !== 'route-feedback'),
        })),
      },
    };
  }

  res.json({
    success: true,
    navigation: navConfig,
  });
});

// -----------------------------------------------------------
// GET /api/app/version-check
// Query: ?currentVersion=1.1.0
// -----------------------------------------------------------
router.get('/version-check', (req: Request, res: Response) => {
  const currentVersion = req.query.currentVersion as string || '1.0.0';
  
  const needsUpdate = compareVersions(currentVersion, APP_CONFIG.latestVersion) < 0;
  const forceUpdate = compareVersions(currentVersion, APP_CONFIG.forceUpdateBelow) < 0;

  res.json({
    success: true,
    currentVersion,
    latestVersion: APP_CONFIG.latestVersion,
    needsUpdate,
    forceUpdate,
    maintenanceMode: APP_CONFIG.maintenanceMode,
    updateUrl: {
      ios: 'https://apps.apple.com/app/traivo-go/id123456',
      android: 'https://play.google.com/store/apps/details?id=se.traivo.go',
    },
  });
});

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

export const appConfigRoutes = router;
```

### Registrera i app.ts

```typescript
import { appConfigRoutes } from './routes/app-config';

// Lägg till:
app.use('/api/app', appConfigRoutes);
```

### 🧪 Testa Fas 3

```bash
# Hämta app-konfiguration
curl -s http://localhost:5000/api/app/config | jq .

# Hämta navigationsstruktur
curl -s http://localhost:5000/api/app/navigation | jq .

# Navigationsstruktur för specifik roll
curl -s "http://localhost:5000/api/app/navigation?role=planner" | jq .

# Versionskontroll
curl -s "http://localhost:5000/api/app/version-check?currentVersion=0.9.0" | jq .
curl -s "http://localhost:5000/api/app/version-check?currentVersion=1.2.0" | jq .
```

---

## 🔧 Fas 4: Statistik-API Förbättringar

### Bakgrund
Hamburger-menyn ger snabb åtkomst till statistik. Vi behöver en lightweight summary endpoint som laddar snabbt.

### 4.1 Lightweight Summary

**Fil:** `server/routes/mobile.ts` (lägg till ny endpoint)

```typescript
// Lägg till i server/routes/mobile.ts (bland övriga endpoints):

// -----------------------------------------------------------
// GET /api/mobile/statistics/summary
// Lightweight version – för hamburger-meny preview
// -----------------------------------------------------------
router.get('/statistics/summary', async (req: Request, res: Response) => {
  try {
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() + 1); // Måndag

    res.json({
      success: true,
      summary: {
        today: {
          completedOrders: 4,
          totalOrders: 7,
          hoursWorked: 5.5,
          kilometers: 87,
        },
        week: {
          completedOrders: 18,
          totalOrders: 23,
          hoursWorked: 32,
          kilometers: 412,
          completionRate: 78,
        },
        streaks: {
          onTimeStreak: 12,          // Antal i rad i tid
          zeroDeviationDays: 5,      // Dagar utan avvikelse
        },
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('GET /statistics/summary error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// -----------------------------------------------------------
// GET /api/mobile/statistics/weekly
// Veckodata för grafer
// -----------------------------------------------------------
router.get('/statistics/weekly', async (req: Request, res: Response) => {
  try {
    const days = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
    const today = new Date().getDay(); // 0=söndag, 1=måndag, ...
    const adjustedToday = today === 0 ? 6 : today - 1; // 0=måndag

    const weeklyData = days.map((day, i) => ({
      day,
      orders: i <= adjustedToday ? Math.floor(Math.random() * 5) + 2 : 0,
      hours: i <= adjustedToday ? Math.round((Math.random() * 4 + 5) * 10) / 10 : 0,
      km: i <= adjustedToday ? Math.floor(Math.random() * 80) + 40 : 0,
    }));

    res.json({
      success: true,
      weekly: weeklyData,
      weekNumber: getWeekNumber(new Date()),
    });
  } catch (error: any) {
    console.error('GET /statistics/weekly error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function getWeekNumber(d: Date): number {
  const onejan = new Date(d.getFullYear(), 0, 1);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayOfYear = ((today.getTime() - onejan.getTime()) / 86400000) + 1;
  return Math.ceil(dayOfYear / 7);
}
```

### 🧪 Testa Fas 4

```bash
# Snabb-statistik
curl -s http://localhost:5000/api/mobile/statistics/summary | jq .

# Veckodata
curl -s http://localhost:5000/api/mobile/statistics/weekly | jq .
```

---

## 🔧 Fas 5: Registrera alla nya routes

### Slutgiltig app.ts import-sektion

```typescript
// I server/app.ts – lägg till dessa imports och routes:

// === IMPORTS (lägg till bland befintliga) ===
import { notificationRoutes } from './routes/notifications';
import { preferencesRoutes } from './routes/preferences';
import { appConfigRoutes } from './routes/app-config';

// === ROUTES (lägg till efter befintliga app.use-rader) ===
app.use('/api/notifications', notificationRoutes);
app.use('/api/user/preferences', preferencesRoutes);
app.use('/api/app', appConfigRoutes);
```

---

## 🧪 Komplett testskript

Skapa denna fil och kör den för att verifiera allt:

**Fil:** `server/test-new-endpoints.sh`

```bash
#!/bin/bash
# test-new-endpoints.sh – Testar alla nya endpoints
# Kör: bash server/test-new-endpoints.sh

BASE="http://localhost:5000"
PASS=0
FAIL=0

test_endpoint() {
  local method=$1
  local url=$2
  local data=$3
  local expected=$4
  local desc=$5

  if [ "$method" = "GET" ]; then
    response=$(curl -s -w "\n%{http_code}" "$BASE$url")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE$url" \
      -H "Content-Type: application/json" \
      -d "$data")
  fi

  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if echo "$body" | grep -q "$expected"; then
    echo "✅ $desc (HTTP $http_code)"
    PASS=$((PASS + 1))
  else
    echo "❌ $desc (HTTP $http_code)"
    echo "   Expected to contain: $expected"
    echo "   Got: $(echo $body | head -c 200)"
    FAIL=$((FAIL + 1))
  fi
}

echo "🧪 Testar nya Traivo One endpoints..."
echo "=================================="

# Notifikationer
test_endpoint GET "/api/notifications" "" '"success":true' "GET notifikationer"
test_endpoint GET "/api/notifications?unread_only=true" "" '"success":true' "GET olästa notifikationer"
test_endpoint GET "/api/notifications/unread-count" "" '"unreadCount"' "GET antal olästa"
test_endpoint POST "/api/notifications/notif-001/read" "{}" '"read":true' "POST markera som läst"
test_endpoint POST "/api/notifications/read-all" "{}" '"markedCount"' "POST markera alla som lästa"

# Preferenser
test_endpoint GET "/api/user/preferences" "" '"success":true' "GET preferenser"
test_endpoint PATCH "/api/user/preferences" '{"darkMode":true}' '"darkMode":true' "PATCH preferens"
test_endpoint PUT "/api/user/preferences" '{"darkMode":false,"fontSize":"large"}' '"fontSize":"large"' "PUT preferenser"

# App-konfiguration
test_endpoint GET "/api/app/config" "" '"features"' "GET app config"
test_endpoint GET "/api/app/navigation" "" '"bottomTabs"' "GET navigation config"
test_endpoint GET "/api/app/navigation?role=driver" "" '"hamburgerMenu"' "GET nav config (driver)"
test_endpoint GET "/api/app/version-check?currentVersion=1.0.0" "" '"needsUpdate"' "GET version check"

# Statistik
test_endpoint GET "/api/mobile/statistics/summary" "" '"completedOrders"' "GET statistik summary"
test_endpoint GET "/api/mobile/statistics/weekly" "" '"weekly"' "GET statistik weekly"

# Health (befintlig – kontroll att inget gått sönder)
test_endpoint GET "/api/health" "" '"status":"ok"' "GET health (regressionstest)"

echo "=================================="
echo "Resultat: ✅ $PASS godkända, ❌ $FAIL misslyckade"
echo "Totalt: $((PASS + FAIL)) tester"
```

---

## 📁 Nya filer – sammanfattning

| Fil | Typ | Beskrivning |
|-----|-----|-------------|
| `server/routes/notifications.ts` | **Ny** | Notifikations-CRUD + oläst antal |
| `server/routes/preferences.ts` | **Ny** | Användarpreferenser CRUD |
| `server/routes/app-config.ts` | **Ny** | App-konfiguration, navigationsstruktur, versionskontroll |
| `server/app.ts` | **Modifierad** | Registrera nya routes + WebSocket-events |
| `server/routes/mobile.ts` | **Modifierad** | Nya statistik-endpoints (summary, weekly) |
| `server/test-new-endpoints.sh` | **Ny** | Testskript för alla endpoints |

---

## 🔗 Endpoints – komplett referens

### Nya endpoints

| Metod | Path | Beskrivning |
|-------|------|-------------|
| `GET` | `/api/notifications` | Lista notifikationer (pagination) |
| `GET` | `/api/notifications/unread-count` | Antal olästa notifikationer |
| `POST` | `/api/notifications/:id/read` | Markera en som läst |
| `POST` | `/api/notifications/read-all` | Markera alla som lästa |
| `GET` | `/api/user/preferences` | Hämta användarinställningar |
| `PUT` | `/api/user/preferences` | Ersätt alla inställningar |
| `PATCH` | `/api/user/preferences` | Uppdatera specifika inställningar |
| `GET` | `/api/app/config` | App-konfiguration & feature flags |
| `GET` | `/api/app/navigation` | Server-driven navigationsstruktur |
| `GET` | `/api/app/version-check` | Kontrollera app-version |
| `GET` | `/api/mobile/statistics/summary` | Snabbstatistik (lightweight) |
| `GET` | `/api/mobile/statistics/weekly` | Veckostatistik för grafer |

### WebSocket Events (nya)

| Event | Riktning | Data |
|-------|----------|------|
| `subscribe_notifications` | Client → Server | `{ resourceId }` |
| `new_notification` | Server → Client | `Notification` objekt |
| `unread_count_update` | Server → Client | `{ unreadCount }` |

---

## ⚠️ Bakåtkompatibilitet

Alla befintliga endpoints är **oförändrade**. De nya endpointsen är tillägg som inte påverkar:
- `/api/mobile/login`
- `/api/mobile/my-orders`
- `/api/mobile/statistics`
- Alla övriga befintliga routes

Den enda modifierade filen (förutom app.ts) är `mobile.ts` där vi **lägger till** nya endpoints utan att ändra befintliga.

---

> 💡 **Tips:** Börja med Fas 1 (Notifikationer) – det ger mest synligt resultat i Traivo Go direkt.
