# 💻 TRAIVO DEVELOPMENT WORKFLOW
## Utvecklingsguide för Replit

> **Senast uppdaterad:** 2026-03-27  
> **Version:** 1.0  
> ⬅️ [Tillbaka till Master Guide](./TRAIVO_MASTER_GUIDE.md)

---

## 🎯 Översikt

Denna guide beskriver hur du effektivt arbetar med alla tre Traivo-projekt i Replit samtidigt.

```
┌──────────────────────────────────────────────────────────────────┐
│                    🖥️ DIN ARBETSSTATION                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Tab 1       │  │  Tab 2       │  │  Tab 3       │           │
│  │  Traivo      │  │  Traivo One  │  │  Traivo Go   │           │
│  │  (Webb)      │  │  (Backend)   │  │  (Mobil)     │           │
│  │  🌐          │  │  🖥️          │  │  📱          │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │  Tab 4       │  │  Tab 5       │                             │
│  │  GitHub      │  │  Docs        │                             │
│  │  🐙          │  │  📚          │                             │
│  └──────────────┘  └──────────────┘                             │
│                                                                  │
│  📱 Expo Go (Fysisk telefon / Emulator)                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Initial Setup i Replit

### Steg 1: Skapa/Öppna projekten

```
1. Öppna replit.com
2. Skapa tre separata Replit-projekt:
   - Traivo        (Import från GitHub)
   - Traivo One    (Import från GitHub)
   - Traivo Go     (Import från GitHub: Patron1965/traivo-go)
```

### Steg 2: Konfigurera Traivo One (Backend)

```bash
# I Traivo One Replit Shell:

# 1. Installera beroenden
npm install

# 2. Skapa .env-fil
cat > .env << 'EOF'
NODE_ENV=development
PORT=3000
JWT_SECRET=dev-secret-change-in-production
JWT_REFRESH_SECRET=dev-refresh-secret-change-in-production
EOF

# 3. Starta servern
npm run dev

# 4. Verifiera att den körs
# Öppna Replit Webview → bör se health-check
```

**📝 Notera din Replit URL:**
```
Din One URL: https://<ditt-replit-namn>--traivo-one.repl.co
```

### Steg 3: Konfigurera Traivo Go (Mobilapp)

```bash
# I Traivo Go Replit Shell:

# 1. Installera beroenden
npm install

# 2. Skapa .env-fil (peka mot din One-server)
cat > .env << 'EOF'
EXPO_PUBLIC_API_URL=https://<ditt-replit-namn>--traivo-one.repl.co
EXPO_PUBLIC_WS_URL=wss://<ditt-replit-namn>--traivo-one.repl.co
EXPO_PUBLIC_APP_ENV=development
EOF

# 3. Starta Expo
npx expo start

# 4. Skanna QR-koden med Expo Go-appen på din telefon
```

### Steg 4: Konfigurera Traivo (Webb)

```bash
# I Traivo Replit Shell:

# 1. Installera beroenden
npm install

# 2. Konfigurera .env med API-URL
# (anpassa efter behov)

# 3. Starta
npm run dev
```

---

## 🔄 Dagligt utvecklingsworkflow

### Startordning (VIKTIGT! ⚠️)

```
 1️⃣  Starta Traivo One (backend)  ← ALLTID FÖRST
      ↓
 2️⃣  Starta Traivo Go (mobilapp)
      ↓
 3️⃣  Starta Traivo (webb) vid behov
```

### Workflow: Ny feature

```
┌─────────────────────────────────────────────────────────────┐
│                   FEATURE WORKFLOW                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 📋 Planera                                              │
│     └── Vad behövs i One? Go? Traivo?                       │
│     └── Kolla TRAIVO_SYNC_CHECKLIST.md                      │
│                                                             │
│  2. 🖥️ Backend först (Traivo One)                           │
│     └── Skapa/ändra API-endpoint                            │
│     └── Testa med curl                                      │
│     └── Git commit                                          │
│                                                             │
│  3. 📱 Frontend sedan (Traivo Go)                           │
│     └── Integrera med nya API:et                            │
│     └── Testa i Expo Go                                     │
│     └── Git commit                                          │
│                                                             │
│  4. 🌐 Webb om relevant (Traivo)                            │
│     └── Uppdatera webbgränssnitt                            │
│     └── Git commit                                          │
│                                                             │
│  5. ✅ Verifiera                                            │
│     └── End-to-end test                                     │
│     └── Uppdatera TRAIVO_PROJECT_STATUS.md                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Workflow: Bugfix

```
1. 🔍 Identifiera - Var ligger buggen? (Go? One? Båda?)
2. 🔬 Reproducera - Kan du återskapa buggen konsekvent?
3. 🐛 Fixa i rätt projekt
4. 🧪 Testa att fixen fungerar
5. 🔄 Kolla om fixen påverkar andra projekt
6. ✅ Commit + uppdatera STATUS.md
```

---

## 🌿 Git Workflow & Branching

### Branch-strategi

```
main (stabil)
  │
  ├── develop (aktiv utveckling)
  │     │
  │     ├── feature/notifications    ← Ny feature
  │     ├── feature/offline-support  ← Ny feature
  │     ├── fix/login-crash          ← Bugfix
  │     └── refactor/navigation      ← Refaktorering
  │
  └── release/v1.0                   ← Release-gren
```

### Namnkonventioner

| Typ | Format | Exempel |
|-----|--------|---------|
| Feature | `feature/<namn>` | `feature/notifications` |
| Bugfix | `fix/<namn>` | `fix/login-crash` |
| Refaktor | `refactor/<namn>` | `refactor/navigation` |
| Hotfix | `hotfix/<namn>` | `hotfix/auth-token` |

### Git-kommandon (Replit Shell)

```bash
# === DAGLIGA KOMMANDON ===

# Se status
git status

# Skapa ny feature-gren
git checkout -b feature/min-feature

# Stage och commit
git add .
git commit -m "feat: lägg till notifikations-badge i hamburger-meny"

# Push till GitHub
git push origin feature/min-feature

# === MERGE WORKFLOW ===

# Gå till develop
git checkout develop

# Merge feature
git merge feature/min-feature

# Push develop
git push origin develop

# Ta bort feature-gren
git branch -d feature/min-feature
```

### Commit-meddelanden (Conventional Commits)

```
feat:     Ny funktionalitet
fix:      Bugfix
refactor: Kodförbättring utan ny funktion
style:    Formatering, saknade semikolon etc.
docs:     Dokumentation
test:     Tester
chore:    Underhåll, paketuppdateringar
```

**Exempel:**
```
feat: lägg till statistik-widget i hamburger-meny
fix: fixa WebSocket-reconnection vid nätverksändring
refactor: förenkla TabNavigator till 3 tabs
docs: uppdatera API-dokumentation för notifications
```

### ⚠️ Synkade commits mellan projekt

När en ändring spänner över flera projekt, committa i ordningen:

```
1. Traivo One  → "feat(api): lägg till GET /notifications/unread-count"
2. Traivo Go   → "feat(ui): integrera notifikations-badge med backend"
3. Traivo      → "feat(admin): visa notifikationsstatistik" (om relevant)
```

Referera gärna till relaterade commits:
```
feat(ui): integrera notifikations-badge

Ansluter till Traivo One commit: abc1234
Endpoint: GET /api/notifications/unread-count
```

---

## 🔄 Arbeta med flera Replit-projekt samtidigt

### Tips & tricks

#### 1. Håll alla tre öppna i separata tabs
```
Tab 1: replit.com/@user/traivo
Tab 2: replit.com/@user/traivo-one
Tab 3: replit.com/@user/traivo-go
```

#### 2. Använd Replit Shell effektivt

```bash
# Splitta terminal i Replit:
# Klicka på "+" i Shell-panelen för att öppna fler terminals

# Terminal 1: Kör servern
npm run dev

# Terminal 2: Git-kommandon, testning
git status
curl http://localhost:3000/health
```

#### 3. Snabb-testa API:er direkt i Replit Shell

```bash
# I Traivo One Shell:
curl -s http://localhost:3000/api/notifications | json_pp

curl -s http://localhost:3000/api/mobile/statistics/summary | json_pp

curl -s -X POST http://localhost:3000/api/notifications/1/read | json_pp
```

#### 4. Replit Secrets (miljövariabler)

```
📌 Istället för .env-filer kan du använda Replit Secrets:
1. Klicka på 🔒 i sidopanelen
2. Lägg till key-value par
3. Tillgängliga som process.env.NYCKEL i koden
```

---

## 🧪 Testning mellan projekten

### API-testning (Traivo One)

```bash
#!/bin/bash
# test-endpoints.sh - Kör i Traivo One Shell

BASE="http://localhost:3000"
TOKEN="test-token"  # Ersätt med riktig token

echo "=== Health Check ==="
curl -s $BASE/health | json_pp

echo "\n=== Notifications ==="
curl -s $BASE/api/notifications \
  -H "Authorization: Bearer $TOKEN" | json_pp

echo "\n=== Unread Count ==="
curl -s $BASE/api/notifications/unread-count \
  -H "Authorization: Bearer $TOKEN" | json_pp

echo "\n=== Statistics Summary ==="
curl -s $BASE/api/mobile/statistics/summary \
  -H "Authorization: Bearer $TOKEN" | json_pp

echo "\n=== User Preferences ==="
curl -s $BASE/api/user/preferences \
  -H "Authorization: Bearer $TOKEN" | json_pp

echo "\n=== App Config ==="
curl -s $BASE/api/app/config \
  -H "Authorization: Bearer $TOKEN" | json_pp

echo "\n✅ Alla tester klara!"
```

### Frontend-testning (Traivo Go)

```
┌──────────────────────────────────────────────────────────┐
│              TESTCHECKLISTA FÖR GO                        │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  📱 Navigation                                           │
│  □ Alla 3 tabs fungerar (Hem, Uppdrag, Karta)           │
│  □ Hamburger-meny öppnas/stängs korrekt                 │
│  □ Swipe-to-close fungerar                              │
│  □ Alla meny-items navigerar rätt                       │
│  □ Tillbaka-knapp fungerar från alla skärmar             │
│                                                          │
│  🔔 Notifikationer                                       │
│  □ Badge visar korrekt antal                            │
│  □ Notiser laddas i listan                              │
│  □ Markera som läst fungerar                            │
│  □ Realtidsuppdatering via WebSocket                    │
│                                                          │
│  ⚙️ Inställningar                                        │
│  □ Alla toggles sparar korrekt                          │
│  □ Preferenser laddas vid start                         │
│  □ Dark mode fungerar                                   │
│                                                          │
│  📊 Statistik                                            │
│  □ Quick stats widget visar data                        │
│  □ Veckostatistik renderas                              │
│                                                          │
│  📴 Offline                                              │
│  □ App fungerar utan nätverk                            │
│  □ Köade operationer synkas vid återanslutning          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### End-to-end testscenario

```
Scenario: Fältarbetare får och slutför en order
─────────────────────────────────────────────

1. [One] Skapa en order via API
   → curl -X POST /api/mobile/orders

2. [Go] Verifiera att ordern syns i Uppdrag-tabben
   → Öppna appen, gå till Uppdrag

3. [One] Skicka notis via WebSocket
   → emitNotification(userId, { type: 'order_assigned', ... })

4. [Go] Verifiera notis-badge i hamburger-meny
   → Kolla röd punkt på ☰

5. [Go] Öppna order, ändra status till "pågående"
   → Tryck på order → Starta

6. [One] Verifiera statusändring i API
   → curl GET /api/mobile/orders/:id

7. [Go] Slutför ordern
   → Tryck Slutför → Signera

8. [Go] Kolla statistik-widgeten
   → Öppna hamburger → completedOrders bör ha ökat
```

---

## 🐛 Debugging-tips

### Traivo One (Backend)

```javascript
// Lägg till debug-logging i routes
console.log('[NOTIFICATION]', JSON.stringify(req.body, null, 2));
console.log('[AUTH] User:', req.user?.id);
console.log('[WS] Clients connected:', io.engine.clientsCount);
```

```bash
# Övervaka Replit-loggar i realtid
# (loggar visas automatiskt i Shell när servern körs)

# Testa specifik endpoint med verbose output
curl -v http://localhost:3000/api/notifications
```

### Traivo Go (Frontend)

```javascript
// Lägg till debug-info i hooks
console.log('[useNotifications] Fetching...', { unreadCount });
console.log('[usePreferences] Loaded:', preferences);
console.log('[WebSocket] Status:', socket.connected);
```

```bash
# Se Expo-loggar
# Loggar visas i Replit Shell där expo körs
# Eller i webbläsarens DevTools om du kör web-version

# Rensa cache om saker verkar konstiga
npx expo start --clear
```

### Vanliga problem & lösningar

| Problem | Diagnos | Lösning |
|---------|---------|--------|
| `fetch failed` | Backend kör inte | Starta One först |
| `401 Unauthorized` | Token utgången/fel | Logga in igen, kontrollera JWT_SECRET |
| `CORS error` | Fel origin | Uppdatera CORS i `app.ts` |
| Expo visar gammal kod | Cache | `npx expo start --clear` |
| WebSocket kopplar ej | Fel URL/port | Kolla `EXPO_PUBLIC_WS_URL` |
| Replit "sleeping" | Inaktivitet | Klicka Run igen |
| `Module not found` | Saknat paket | `npm install <paket>` |
| TypeScript-fel | Typfel | Fixa typdefinitioner |

### 🔧 Debug-verktyg

```bash
# Kontrollera att portar lyssnar
lsof -i :3000

# Testa WebSocket-anslutning
npx wscat -c ws://localhost:3000

# Inspektera nätverkstrafik (i Expo)
# Använd React Native Debugger eller Flipper

# JSON pretty-print
curl -s http://localhost:3000/api/... | python3 -m json.tool
```

---

## 📚 Relaterade dokument

- [🚀 Master Guide →](./TRAIVO_MASTER_GUIDE.md)
- [🏗️ Arkitektur & API-kontrakt →](./TRAIVO_ARCHITECTURE.md)
- [🔄 Synkroniseringschecklista →](./TRAIVO_SYNC_CHECKLIST.md)
- [📊 Projektstatus →](./TRAIVO_PROJECT_STATUS.md)

---

> 💻 *Denna guide hjälper dig att hålla ordning på ditt Replit-baserade utvecklingsarbete. Uppdatera vid workflow-ändringar.*
