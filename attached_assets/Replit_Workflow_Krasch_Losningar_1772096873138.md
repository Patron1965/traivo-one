# Replit Workflow Kraschproblem - Fullständig Analys & Lösningar

> **Skapad:** 2026-02-26  
> **Problem:** App kraschar efter ~20 sekunder i Replit workflow med SIGKILL

---

## 📋 Sammanfattning

| Symptom | Status |
|---------|--------|
| SIGKILL efter ~20 sekunder | ✅ Bekräftat |
| Fungerar i bash | ✅ Bekräftat |
| Minimal server kraschar också | ✅ Bekräftat |
| .replit har `run = npm run dev` | ⚠️ Trolig orsak |

**Slutsats:** Problemet ligger i Replit:s workflow-infrastruktur, inte i din kod.

---

## 🔍 Del 1: Grundorsaksanalys

### Mest Troliga Orsaker (Prioriterade)

#### 1. 🔴 Dubbla Processer (Port Conflict) - HÖGST SANNOLIKHET
```
.replit-filen → "npm run dev" → Process A på port 5000
Workflow      → din server    → Process B på port 5000
                              → KONFLIKT → SIGKILL
```

#### 2. 🟠 Replit Workflow Health Check Timeout
- Replit workflows har inbyggda health checks
- Förväntar sig HTTP-svar inom viss tid
- Om ingen respons → SIGKILL efter ~20 sek

#### 3. 🟡 Minnesöverskridning
- Replit gratis tier: ~512MB-1GB
- Överskridande → SIGKILL

#### 4. 🟢 Workflow vs Deployment Mismatch
- Workflows = development
- Deployments = production (mer stabila)

---

## 🛠️ Del 2: Diagnostikscript

### Script 1: memory-monitor.sh
```bash
#!/bin/bash
# Spara som: memory-monitor.sh

echo "=== MINNESÖVERVAKNING STARTAR ==="
while true; do
  echo ""
  echo "[$(date '+%H:%M:%S')] Minnesanvändning:"
  ps aux --sort=-%mem | grep -E "(node|npm)" | grep -v grep | head -5
  free -h | grep Mem
  sleep 2
done
```

### Script 2: port-monitor.sh
```bash
#!/bin/bash
# Spara som: port-monitor.sh

echo "=== PORTÖVERVAKNING STARTAR ==="
while true; do
  echo ""
  echo "[$(date '+%H:%M:%S')] Processer på port 5000:"
  lsof -i :5000 2>/dev/null || echo "  Ingen process på port 5000"
  sleep 2
done
```

### Script 3: process-monitor.sh
```bash
#!/bin/bash
# Spara som: process-monitor.sh

echo "=== PROCESSÖVERVAKNING STARTAR ==="
while true; do
  echo ""
  echo "[$(date '+%H:%M:%S')] Node/npm processer:"
  pgrep -a "node\|npm" || echo "  Inga node/npm processer"
  echo "  Totalt: $(pgrep -c "node\|npm" 2>/dev/null || echo 0) processer"
  sleep 2
done
```

### Hur du kör diagnostiken
```bash
# Terminal 1:
bash memory-monitor.sh

# Terminal 2:
bash port-monitor.sh

# Terminal 3:
bash process-monitor.sh

# Terminal 4:
# Starta workflow via Replit UI

# OBSERVERA: Vad händer precis innan krasch?
```

---

## ⭐ Del 3: Lösningar (Prioriterade)

### LÖSNING 1: Fixa .replit-filen ⭐⭐⭐
**Prioritet: HÖGST | Tid: 2 min | Kostnad: Gratis**

**Problem:** `.replit` har `run = "npm run dev"` som startar extra process

**Lösning:**
```toml
# .replit

# KOMMENTERA UT ELLER TA BORT:
# run = "npm run dev"

# ELLER ÄNDRA TILL:
run = "echo 'Använd workflow istället'"

[nix]
channel = "stable-23_11"

[deployment]
run = ["sh", "-c", "node dist/index.cjs"]
deploymentTarget = "cloudrun"
```

**Om filen inte kan redigeras:**
- Högerklicka på `.replit` → "Show hidden files"
- Eller skapa `.replit` manuellt i Shell

---

### LÖSNING 2: Replit Deployments ⭐⭐⭐
**Prioritet: HÖG | Tid: 5 min | Kostnad: Gratis tier finns**

**Varför:** Deployments är designade för production - inga 20-sek timeouts!

**Steg:**
1. Klicka **"Deploy"** i toppmeny
2. Välj **"Autoscale deployment"** (eller "Reserved VM")
3. Konfigurera:
   ```
   Build command: npm run build
   Run command:   node dist/index.cjs
   Port:          5000
   ```
4. Klicka **"Deploy"**

**Fördelar:**
- ✅ Ingen 20-sekunders timeout
- ✅ Automatisk omstart vid krasch
- ✅ Bättre resurser
- ✅ Custom domain-stöd

---

### LÖSNING 3: Health Check Endpoint ⭐⭐
**Prioritet: MEDIUM | Tid: 5 min | Kostnad: Gratis**

**Lägg till i server/index.ts (FÖRE andra routes):**
```typescript
// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({ 
    message: 'Server is running',
    version: '1.0.0'
  });
});
```

**Testa:**
```bash
curl http://localhost:5000/health
# Förväntat: {"status":"ok","uptime":...}
```

---

### LÖSNING 4: PM2 Process Manager ⭐⭐
**Prioritet: MEDIUM | Tid: 10 min | Kostnad: Gratis**

**Installation:**
```bash
npm install -g pm2
```

**Skapa ecosystem.config.js:**
```javascript
module.exports = {
  apps: [{
    name: 'app-server',
    script: './dist/index.cjs',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '450M',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    time: true
  }]
};
```

**Skapa logs-mapp:**
```bash
mkdir -p logs
```

**Workflow-kommando:**
```bash
pm2 start ecosystem.config.js && pm2 logs --lines 100
```

---

### LÖSNING 5: Minnesoptimering ⭐⭐
**Prioritet: MEDIUM | Tid: 5 min | Kostnad: Gratis**

**package.json:**
```json
{
  "scripts": {
    "start": "node --max-old-space-size=450 dist/index.cjs",
    "dev": "NODE_OPTIONS='--max-old-space-size=450' tsx watch server/index.ts"
  }
}
```

**Optimera imports:**
```typescript
// ISTÄLLET FÖR:
import * as express from 'express';

// ANVÄND:
import express from 'express';
```

---

### LÖSNING 6: Keep-Alive Script ⭐
**Prioritet: LÅG | Tid: 5 min | Kostnad: Gratis**

**Skapa keep-alive.js:**
```javascript
const http = require('http');

function ping() {
  const req = http.request({
    hostname: 'localhost',
    port: 5000,
    path: '/health',
    method: 'GET',
    timeout: 5000
  }, (res) => {
    console.log(`[${new Date().toISOString()}] Ping: ${res.statusCode}`);
  });

  req.on('error', (e) => console.error(`Ping error: ${e.message}`));
  req.on('timeout', () => { req.destroy(); });
  req.end();
}

setInterval(ping, 5000);
console.log('Keep-alive startat');
```

**Kör:**
```bash
node keep-alive.js & node dist/index.cjs
```

---

### LÖSNING 7: Migrera till Annan Plattform ⭐
**Prioritet: SISTA UTVÄG | Tid: 30 min | Kostnad: Gratis tier**

| Plattform | Gratis Tier | Fördelar |
|-----------|-------------|----------|
| **Railway.app** | 500h/månad | Enklast, bra UI |
| **Render.com** | 750h/månad | Automatisk deploy |
| **Fly.io** | 3 VMs | Mest flexibel |

**Migration:**
1. Pusha kod till GitHub
2. Skapa konto på vald plattform
3. Koppla GitHub-repo
4. Konfigurera: `npm run build` + `node dist/index.cjs`
5. Deploy

---

## 📊 Del 4: Snabbreferens

### Rekommenderad Åtgärdsordning

```
┌─────────────────────────────────────────────────────────────┐
│  STEG 1: Kör diagnostik (5 min)                             │
│          → Identifiera om det är dubbla processer           │
├─────────────────────────────────────────────────────────────┤
│  STEG 2: Fixa .replit-filen (2 min)                         │
│          → Kommentera ut "run = npm run dev"                │
├─────────────────────────────────────────────────────────────┤
│  STEG 3: Lägg till health check (5 min)                     │
│          → app.get('/health', ...)                          │
├─────────────────────────────────────────────────────────────┤
│  STEG 4: Testa igen                                         │
│          → Om det fungerar: KLART!                          │
│          → Om det inte fungerar: Fortsätt ↓                 │
├─────────────────────────────────────────────────────────────┤
│  STEG 5: Använd Replit Deployments (5 min)                  │
│          → Deploy-knappen i toppmeny                        │
├─────────────────────────────────────────────────────────────┤
│  STEG 6: Om inget fungerar → Migrera till Railway/Render    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Slutsats

**Mest sannolika lösning:** Kombinationen av:
1. ✅ Fixa `.replit`-filen (ta bort `run = "npm run dev"`)
2. ✅ Lägg till `/health` endpoint
3. ✅ Använd Replit Deployments istället för workflow

**Om inget fungerar:** Migrera till Railway.app - det tar 10 minuter och fungerar garanterat.

---

*Dokument genererat: 2026-02-26*
