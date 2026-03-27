# 🚀 TRAIVO MASTER GUIDE
## Command Center för hela Traivo-ekosystemet

> **Senast uppdaterad:** 2026-03-27  
> **Version:** 1.0  
> **Underhålls av:** Traivo Development Team

---

## 📋 Quick Links

| Dokument | Beskrivning | Länk |
|----------|-------------|------|
| 🏗️ Arkitektur | Systemarkitektur & API-kontrakt | [TRAIVO_ARCHITECTURE.md](./TRAIVO_ARCHITECTURE.md) |
| 💻 Utveckling | Replit workflow & setup | [TRAIVO_DEVELOPMENT_WORKFLOW.md](./TRAIVO_DEVELOPMENT_WORKFLOW.md) |
| 🔄 Synk | Synkroniseringschecklista | [TRAIVO_SYNC_CHECKLIST.md](./TRAIVO_SYNC_CHECKLIST.md) |
| 📊 Status | Projektstatus & roadmap | [TRAIVO_PROJECT_STATUS.md](./TRAIVO_PROJECT_STATUS.md) |
| 📱 Go Guide | Traivo Go implementation | [TRAIVO_GO_IMPLEMENTATION.md](./TRAIVO_GO_IMPLEMENTATION.md) |
| 🖥️ One Guide | Traivo One implementation | [TRAIVO_ONE_IMPLEMENTATION.md](./TRAIVO_ONE_IMPLEMENTATION.md) |

---

## 🌍 Ekosystemöversikt

Traivo är ett komplett fältarbetarsystem bestående av tre sammankopplade projekt:

```
╔══════════════════════════════════════════════════════════════════╗
║                    🌐 TRAIVO EKOSYSTEMET                        ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║   ┌─────────────────┐                                           ║
║   │   🏢 TRAIVO      │  Huvudplattform / Webbportal             ║
║   │   (Plattform)    │  Admin, planering, överblick              ║
║   └────────┬────────┘                                           ║
║            │                                                     ║
║            │ API / Delad databas                                 ║
║            │                                                     ║
║   ┌────────▼────────┐                                           ║
║   │  🖥️ TRAIVO ONE   │  Backend / API-server                    ║
║   │   (Backend)      │  Express.js + Socket.IO                   ║
║   │                  │  REST API + WebSocket                     ║
║   └────────┬────────┘                                           ║
║            │                                                     ║
║            │ REST API + WebSocket                                ║
║            │                                                     ║
║   ┌────────▼────────┐                                           ║
║   │  📱 TRAIVO GO    │  Fältarbetarapp                          ║
║   │  (Mobile App)    │  React Native / Expo                     ║
║   │                  │  3 tabs + hamburger-meny                  ║
║   └─────────────────┘                                           ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

### 🎯 Varje projekts roll

| Projekt | Teknik | Roll | Replit-projekt |
|---------|--------|------|----------------|
| **Traivo** | Webb | Huvudplattform, admin, planering | Eget Replit |
| **Traivo One** | Express.js, Node.js | Backend API, WebSocket-server | Eget Replit |
| **Traivo Go** | React Native, Expo | Mobilapp för fältarbetare | Eget Replit |

---

## 🔄 Dataflöde mellan systemen

```
┌──────────────┐         ┌──────────────────┐         ┌──────────────┐
│              │         │                  │         │              │
│   TRAIVO     │◄───────►│   TRAIVO ONE     │◄───────►│  TRAIVO GO   │
│  (Webb)      │  API    │   (Backend)      │  API    │  (Mobil)     │
│              │         │                  │  + WS   │              │
└──────────────┘         └──────────────────┘         └──────────────┘
       │                         │                          │
       │    ┌────────────────────┤                          │
       │    │                    │                          │
       ▼    ▼                    ▼                          ▼
  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
  │  📊 Ordrar    │    │  🔔 Notiser      │    │  📍 GPS/Karta    │
  │  Planering    │    │  WebSocket push  │    │  Offline-kö      │
  │  Statistik    │    │  Realtid         │    │  Synkronisering  │
  └──────────────┘    └──────────────────┘    └──────────────────┘
```

### Huvudsakliga dataflöden

| # | Flöde | Riktning | Protokoll | Beskrivning |
|---|-------|----------|-----------|-------------|
| 1 | Ordrar | Traivo → One → Go | REST | Ordrar skapas i Traivo, exponeras via One, visas i Go |
| 2 | Statusuppdateringar | Go → One → Traivo | REST + WS | Fältarbetare uppdaterar status, synkas i realtid |
| 3 | GPS-positioner | Go → One | REST | Löpande positionsrapportering |
| 4 | Notifikationer | One → Go | WebSocket | Push-notiser i realtid |
| 5 | Inställningar | Go ↔ One | REST | Synkade användarpreferenser |
| 6 | Statistik | One → Go | REST | Sammanfattningar & veckostatistik |
| 7 | Offline-data | Go (lokal) | AsyncStorage | Köade operationer som synkas vid anslutning |

---

## 📱 Traivo Go - Navigationsstruktur (ny design)

```
┌─────────────────────────────────────────────┐
│  ☰ HAMBURGER          TRAIVO LOGO      🔔   │
│─────────────────────────────────────────────│
│                                             │
│              📱 HUVUDINNEHÅLL               │
│                                             │
│          (Hem / Uppdrag / Karta)            │
│                                             │
│─────────────────────────────────────────────│
│   🏠 Hem      │   📋 Uppdrag   │   🗺️ Karta │
└─────────────────────────────────────────────┘

☰ Hamburger-meny innehåller:
├── 🤖 AI-Assistent
├── 🔔 Aviseringar (med badge)
├── 👥 Team
├── 📊 Statistik
├── ⚙️ Inställningar
└── 🚪 Logga ut
```

**Före:** 5 tabs (Hem, Ordrar, Karta, Assist, Profil)  
**Efter:** 3 tabs (Hem, Uppdrag, Karta) + hamburger-meny ✅

---

## 🛠️ Utvecklingsworkflow (Quick Reference)

### Dagligt arbete

```bash
# 1. Starta Traivo One (backend) FÖRST
# I Traivo One Replit:
npm run dev

# 2. Starta Traivo Go (frontend)
# I Traivo Go Replit:
npx expo start

# 3. Öppna Traivo (webb) vid behov
# I Traivo Replit:
npm run dev
```

### ⚡ Quick Checklist vid ändringar

- [ ] Ändring i API? → Uppdatera **både** One OCH Go
- [ ] Nytt API-endpoint? → Lägg till i One, konsumera i Go
- [ ] Ny skärm i Go? → Registrera i `RootNavigator.tsx`
- [ ] WebSocket-event? → Uppdatera **båda** sidor
- [ ] Databasändring? → Migrera + uppdatera alla konsumenter

> 📖 **Fullständig guide:** [TRAIVO_DEVELOPMENT_WORKFLOW.md](./TRAIVO_DEVELOPMENT_WORKFLOW.md)

---

## 🗂️ Nyckelfilerna i varje projekt

### Traivo Go (Mobilapp)

```
client/
├── navigation/
│   ├── TabNavigator.tsx      ← 3-tabs konfiguration
│   └── RootNavigator.tsx     ← Alla stack screens
├── components/
│   └── HamburgerMenu.tsx     ← Sidomeny med animationer
├── screens/
│   ├── HomeScreen.tsx
│   ├── OrdersScreen.tsx
│   ├── MapScreen.tsx
│   ├── AIAssistantScreen.tsx
│   ├── ProfileScreen.tsx
│   └── SettingsScreen.tsx    ← Integrerad med usePreferences
├── hooks/
│   ├── useNotifications.ts
│   ├── usePreferences.ts
│   └── useAppConfig.ts
└── utils/
    ├── haptics.ts            ← Haptisk feedback
    └── offlineQueue.ts       ← Offline-stöd
```

### Traivo One (Backend)

```
server/
├── app.ts                    ← Huvudapp, route-registrering, WebSocket
├── routes/
│   ├── mobile.ts             ← Mobil-API (ordrar, statistik, etc.)
│   ├── notifications.ts      ← Notifikationer API
│   ├── preferences.ts        ← Användarinställningar API
│   └── app-config.ts         ← App-konfiguration API
└── middleware/
    └── auth.ts               ← Autentisering
```

---

## ❓ Troubleshooting & FAQ

### Vanliga problem

| Problem | Orsak | Lösning |
|---------|-------|---------|
| "Network request failed" i Go | Traivo One körs inte | Starta One-servern först |
| WebSocket kopplar inte | Fel URL eller port | Kontrollera `EXPO_PUBLIC_API_URL` |
| Notis-badge uppdateras inte | WebSocket-prenumeration saknas | Kolla `subscribe_notifications` event |
| Ändringar syns inte i appen | Expo cache | `npx expo start --clear` |
| API returnerar 404 | Route inte registrerad | Kolla `app.ts` route-registrering |
| Offline-kö synkar inte | Nätverksstatusfel | Kolla `offlineQueue.ts` |

### 💡 Tips

1. **Starta alltid backend (One) före frontend (Go)**
2. **Testa API:er manuellt** med curl/Postman innan frontend-integration
3. **Använd mock-data** i Go under utveckling om One inte är klar
4. **Kolla konsol-loggar** i både Replit (server) och Expo (klient)
5. **Git commit ofta** - helst per funktion/feature

### 🔍 Debug-kommandon

```bash
# Testa att One-servern körs
curl http://localhost:3000/health

# Testa notifications endpoint
curl http://localhost:3000/api/notifications \
  -H "Authorization: Bearer <token>"

# Testa statistik-summary
curl http://localhost:3000/api/mobile/statistics/summary \
  -H "Authorization: Bearer <token>"

# Rensa Expo cache
npx expo start --clear

# Kontrollera Git-status
git status && git log --oneline -5
```

---

## 📚 Mer dokumentation

- [🏗️ Arkitektur & API-kontrakt →](./TRAIVO_ARCHITECTURE.md)
- [💻 Utvecklingsworkflow →](./TRAIVO_DEVELOPMENT_WORKFLOW.md)
- [🔄 Synkroniseringschecklista →](./TRAIVO_SYNC_CHECKLIST.md)
- [📊 Projektstatus →](./TRAIVO_PROJECT_STATUS.md)
- [📱 Traivo Go Implementation →](./TRAIVO_GO_IMPLEMENTATION.md)
- [🖥️ Traivo One Implementation →](./TRAIVO_ONE_IMPLEMENTATION.md)
- [🧭 Navigation Redesign Guide →](./navigation_redesign_guide.md)
- [📐 Navigation Analysis →](./traivo_navigation_analysis.md)

---

> 💬 *Detta dokument är ditt command center. Håll det uppdaterat och använd det som startpunkt för all utveckling.*
