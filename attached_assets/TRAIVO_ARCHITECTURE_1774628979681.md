# 🏗️ TRAIVO ARCHITECTURE
## Teknisk arkitektur för Traivo-ekosystemet

> **Senast uppdaterad:** 2026-03-27  
> **Version:** 1.0  
> ⬅️ [Tillbaka till Master Guide](./TRAIVO_MASTER_GUIDE.md)

---

## 📐 Systemarkitektur - Översikt

```
                        ┌─────────────────────────────────┐
                        │         🌐 INTERNET              │
                        └──────────────┬──────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
              ┌─────▼─────┐    ┌──────▼──────┐   ┌──────▼──────┐
              │  🏢 TRAIVO │    │ 📱 TRAIVO GO │   │ 🔧 Admin    │
              │  (Webb)    │    │ (React      │   │ (Framtida)  │
              │            │    │  Native)    │   │             │
              └─────┬─────┘    └──────┬──────┘   └──────┬──────┘
                    │                 │                  │
                    │      HTTPS/WSS  │                  │
                    └────────┬────────┘──────────────────┘
                             │
                    ┌────────▼────────┐
                    │                 │
                    │  🖥️ TRAIVO ONE   │
                    │  (API Server)   │
                    │                 │
                    │  Express.js     │
                    │  Socket.IO      │
                    │  Node.js        │
                    │                 │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   💾 DATABAS     │
                    │  (PostgreSQL /  │
                    │   SQLite)       │
                    └─────────────────┘
```

---

## 🔌 Teknikstack

### Per projekt

| Lager | Projekt | Teknik | Version |
|-------|---------|--------|---------|
| **Frontend (Mobil)** | Traivo Go | React Native + Expo | SDK ~51 |
| **Frontend (Webb)** | Traivo | Webb-teknologi | - |
| **Backend** | Traivo One | Express.js + Node.js | Node 18+ |
| **Realtid** | Traivo One | Socket.IO | 4.x |
| **Navigation** | Traivo Go | React Navigation | 6.x |
| **State** | Traivo Go | React Hooks + Context | - |
| **Offline** | Traivo Go | AsyncStorage + offlineQueue | - |

### Gemensamma teknologier

```
┌─────────────────────────────────────────────────┐
│  📦 Pakethantering:    npm                      │
│  🔤 Språk:             TypeScript               │
│  📡 Kommunikation:     REST API + WebSocket     │
│  🔑 Autentisering:     JWT (Bearer tokens)      │
│  📋 Dataformat:        JSON                     │
│  🗄️ Versionshantering: Git + GitHub             │
│  ☁️ Utvecklingsmiljö:  Replit                    │
└─────────────────────────────────────────────────┘
```

---

## 📡 API-kontrakt mellan Traivo One och Traivo Go

### Bas-URL

```
Produktion:  https://traivo-one.replit.app
Utveckling:  http://localhost:3000
```

### 🔑 Autentisering

Alla skyddade endpoints kräver JWT Bearer token:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### 📋 API Endpoint-katalog

#### 🔐 Auth

| Method | Endpoint | Beskrivning | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/mobile/auth/login` | Logga in | ❌ |
| `POST` | `/api/mobile/auth/refresh` | Förnya token | ✅ |
| `POST` | `/api/mobile/auth/logout` | Logga ut | ✅ |

#### 📦 Ordrar

| Method | Endpoint | Beskrivning | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/mobile/orders` | Lista ordrar | ✅ |
| `GET` | `/api/mobile/orders/:id` | Hämta order | ✅ |
| `PUT` | `/api/mobile/orders/:id/status` | Uppdatera status | ✅ |
| `POST` | `/api/mobile/orders/:id/complete` | Slutför order | ✅ |

#### 🔔 Notifikationer

| Method | Endpoint | Beskrivning | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/notifications` | Lista notiser | ✅ |
| `POST` | `/api/notifications/:id/read` | Markera som läst | ✅ |
| `POST` | `/api/notifications/read-all` | Markera alla som lästa | ✅ |
| `GET` | `/api/notifications/unread-count` | Antal olästa | ✅ |

**Exempelsvar - Lista notiser:**
```json
{
  "notifications": [
    {
      "id": "notif_1",
      "type": "order_assigned",
      "title": "Ny order tilldelad",
      "message": "Order #1234 har tilldelats dig",
      "read": false,
      "createdAt": "2026-03-27T08:00:00Z",
      "data": { "orderId": "1234" }
    }
  ],
  "total": 15,
  "unreadCount": 3
}
```

#### ⚙️ Användarpreferenser

| Method | Endpoint | Beskrivning | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/user/preferences` | Hämta preferenser | ✅ |
| `PUT` | `/api/user/preferences` | Ersätt preferenser | ✅ |
| `PATCH` | `/api/user/preferences` | Uppdatera delvis | ✅ |

**Exempelsvar - Hämta preferenser:**
```json
{
  "preferences": {
    "darkMode": false,
    "fontSize": "medium",
    "hapticFeedback": true,
    "pushEnabled": true,
    "pushCategories": {
      "orders": true,
      "team": true,
      "system": false
    },
    "mapType": "standard",
    "showTraffic": true,
    "breakReminders": true,
    "menuOrder": ["ai", "notifications", "team", "statistics", "settings"]
  }
}
```

#### 📊 Statistik

| Method | Endpoint | Beskrivning | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/mobile/statistics` | Fullständig statistik | ✅ |
| `GET` | `/api/mobile/statistics/summary` | Snabböversikt (för meny) | ✅ |
| `GET` | `/api/mobile/statistics/weekly` | Veckostatistik (grafer) | ✅ |

**Exempelsvar - Summary (lightweight):**
```json
{
  "today": {
    "completedOrders": 5,
    "hoursWorked": 6.5,
    "kmDriven": 45
  },
  "week": {
    "completedOrders": 22,
    "hoursWorked": 35,
    "kmDriven": 210
  },
  "streak": 5
}
```

#### 🔧 App-konfiguration

| Method | Endpoint | Beskrivning | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/app/config` | Hämta app-konfiguration | ✅ |
| `GET` | `/api/app/navigation` | Server-driven navigation | ✅ |
| `GET` | `/api/app/version-check` | Kontrollera app-version | ✅ |

#### 🗺️ Karta & GPS

| Method | Endpoint | Beskrivning | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/mobile/gps/positions` | Hämta positioner | ✅ |
| `POST` | `/api/mobile/gps/update` | Rapportera position | ✅ |
| `GET` | `/api/mobile/team/positions` | Teampositioner | ✅ |

#### 👥 Team

| Method | Endpoint | Beskrivning | Auth |
|--------|----------|-------------|------|
| `GET` | `/api/mobile/team` | Lista teammedlemmar | ✅ |
| `GET` | `/api/mobile/team/:id` | Teammedlem-detalj | ✅ |

---

## 🔌 WebSocket-events

Traivo One använder Socket.IO för realtidskommunikation.

### Anslutning

```javascript
import { io } from 'socket.io-client';

const socket = io('https://traivo-one.replit.app', {
  auth: { token: 'Bearer <jwt_token>' }
});
```

### Event-katalog

```
┌──────────────────────────────────────────────────────────────┐
│                   WEBSOCKET EVENTS                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  CLIENT → SERVER (emit)                                      │
│  ─────────────────                                           │
│  subscribe_notifications    { resourceId: string }           │
│  order_status_update        { orderId, status }              │
│  gps_position               { lat, lng, timestamp }          │
│                                                              │
│  SERVER → CLIENT (on)                                        │
│  ─────────────────                                           │
│  new_notification           { notification: object }         │
│  unread_count               { count: number }                │
│  order_updated              { order: object }                │
│  team_position_update       { userId, lat, lng }             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Exempel: Prenumerera på notiser

```javascript
// Klient (Traivo Go)
socket.emit('subscribe_notifications', { resourceId: userId });

socket.on('new_notification', (data) => {
  // Visa notis, uppdatera badge
  console.log('Ny notis:', data.notification);
});

socket.on('unread_count', (data) => {
  // Uppdatera hamburger-menyns badge
  setBadgeCount(data.count);
});
```

```javascript
// Server (Traivo One) - emitNotification i app.ts
export function emitNotification(resourceId: string, notification: object) {
  io.to(`notifications_${resourceId}`).emit('new_notification', { notification });
  io.to(`notifications_${resourceId}`).emit('unread_count', { count: getUnreadCount(resourceId) });
}
```

---

## 💾 Databasschema (konceptuellt)

```sql
-- Användare
CREATE TABLE users (
  id            UUID PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(50) NOT NULL,  -- 'field_worker', 'admin', 'manager'
  avatar_url    TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Ordrar
CREATE TABLE orders (
  id            UUID PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  status        VARCHAR(50) DEFAULT 'pending',  -- pending, assigned, in_progress, completed
  assigned_to   UUID REFERENCES users(id),
  location_lat  DECIMAL(10, 8),
  location_lng  DECIMAL(11, 8),
  address       TEXT,
  priority      VARCHAR(20) DEFAULT 'normal',
  due_date      TIMESTAMP,
  completed_at  TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Notifikationer
CREATE TABLE notifications (
  id            UUID PRIMARY KEY,
  user_id       UUID REFERENCES users(id),
  type          VARCHAR(50) NOT NULL,
  title         VARCHAR(255) NOT NULL,
  message       TEXT,
  read          BOOLEAN DEFAULT FALSE,
  data          JSONB,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Användarpreferenser
CREATE TABLE user_preferences (
  id            UUID PRIMARY KEY,
  user_id       UUID UNIQUE REFERENCES users(id),
  dark_mode     BOOLEAN DEFAULT FALSE,
  font_size     VARCHAR(20) DEFAULT 'medium',
  haptic_feedback BOOLEAN DEFAULT TRUE,
  push_enabled  BOOLEAN DEFAULT TRUE,
  push_categories JSONB DEFAULT '{"orders": true, "team": true, "system": true}',
  map_type      VARCHAR(20) DEFAULT 'standard',
  show_traffic  BOOLEAN DEFAULT TRUE,
  break_reminders BOOLEAN DEFAULT TRUE,
  menu_order    JSONB DEFAULT '["ai", "notifications", "team", "statistics", "settings"]',
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- GPS-positioner
CREATE TABLE gps_positions (
  id            UUID PRIMARY KEY,
  user_id       UUID REFERENCES users(id),
  latitude      DECIMAL(10, 8) NOT NULL,
  longitude     DECIMAL(11, 8) NOT NULL,
  accuracy      DECIMAL(6, 2),
  recorded_at   TIMESTAMP DEFAULT NOW()
);

-- Arbetssessioner
CREATE TABLE work_sessions (
  id            UUID PRIMARY KEY,
  user_id       UUID REFERENCES users(id),
  start_time    TIMESTAMP NOT NULL,
  end_time      TIMESTAMP,
  total_km      DECIMAL(8, 2) DEFAULT 0,
  total_orders  INTEGER DEFAULT 0,
  created_at    TIMESTAMP DEFAULT NOW()
);
```

---

## 🔐 Autentisering & Säkerhet

### JWT-flöde

```
┌────────┐                    ┌──────────────┐
│ Go App │                    │  Traivo One  │
└───┬────┘                    └──────┬───────┘
    │                                │
    │  POST /auth/login              │
    │  { email, password }           │
    │───────────────────────────────►│
    │                                │
    │  { accessToken, refreshToken } │
    │◄───────────────────────────────│
    │                                │
    │  GET /api/mobile/orders        │
    │  Authorization: Bearer <token> │
    │───────────────────────────────►│
    │                                │
    │  { orders: [...] }             │
    │◄───────────────────────────────│
    │                                │
    │  Token expired? (401)          │
    │◄───────────────────────────────│
    │                                │
    │  POST /auth/refresh            │
    │  { refreshToken }              │
    │───────────────────────────────►│
    │                                │
    │  { accessToken (ny) }          │
    │◄───────────────────────────────│
```

### Säkerhetsprinciper

| Princip | Implementation |
|---------|----------------|
| **Token-lagring** | SecureStore (Expo) - aldrig AsyncStorage |
| **Token-livstid** | Access: 15 min, Refresh: 7 dagar |
| **HTTPS** | Obligatoriskt i produktion |
| **CORS** | Konfigurerat i `app.ts` |
| **Input-validering** | Server-side validering på alla endpoints |
| **Rate limiting** | Implementera per IP/user |
| **WebSocket-auth** | Token skickas vid anslutning |

---

## 🚀 Deployment-strategi

### Utveckling (Replit)

```
┌─────────────────────────────────────────────────┐
│                 REPLIT MILJÖ                      │
├─────────────────────────────────────────────────┤
│                                                  │
│  Replit #1: Traivo (Webb)                        │
│  └── npm run dev → port 3000                     │
│                                                  │
│  Replit #2: Traivo One (Backend)                 │
│  └── npm run dev → port 3000                     │
│      └── Publikt via replit.app URL              │
│                                                  │
│  Replit #3: Traivo Go (Mobil)                    │
│  └── npx expo start → Expo Dev Client            │
│      └── EXPO_PUBLIC_API_URL pekar mot One       │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Produktion (framtida)

```
┌─────────────────────────────────────────────────┐
│               PRODUKTION                         │
├─────────────────────────────────────────────────┤
│                                                  │
│  Frontend (Webb):                                │
│  └── Vercel / Netlify / Replit Deploy            │
│                                                  │
│  Backend (API):                                  │
│  └── Railway / Render / Replit Deploy            │
│  └── Miljövariabler via dashboard                │
│                                                  │
│  Mobilapp:                                       │
│  └── EAS Build (Expo Application Services)       │
│  └── App Store / Google Play                     │
│                                                  │
│  Databas:                                        │
│  └── Supabase / PlanetScale / Railway Postgres   │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Miljövariabler

```bash
# Traivo One (.env)
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...
JWT_SECRET=super-secret-key
JWT_REFRESH_SECRET=another-secret-key
CORS_ORIGIN=https://traivo.replit.app

# Traivo Go (.env)
EXPO_PUBLIC_API_URL=https://traivo-one.replit.app
EXPO_PUBLIC_WS_URL=wss://traivo-one.replit.app
EXPO_PUBLIC_APP_ENV=production
```

---

## 📚 Relaterade dokument

- [🚀 Master Guide →](./TRAIVO_MASTER_GUIDE.md)
- [💻 Utvecklingsworkflow →](./TRAIVO_DEVELOPMENT_WORKFLOW.md)
- [🔄 Synkroniseringschecklista →](./TRAIVO_SYNC_CHECKLIST.md)
- [📊 Projektstatus →](./TRAIVO_PROJECT_STATUS.md)

---

> 🏗️ *Detta dokument beskriver den tekniska arkitekturen. Uppdatera vid större arkitekturförändringar.*
