# 🔄 TRAIVO SYNC CHECKLIST
## Synkroniseringschecklista mellan projekten

> **Senast uppdaterad:** 2026-03-27  
> **Version:** 1.0  
> ⬅️ [Tillbaka till Master Guide](./TRAIVO_MASTER_GUIDE.md)

---

## 🎯 Syfte

Denna checklista säkerställer att ändringar i ett projekt korrekt synkroniseras med alla berörda projekt. **Använd den varje gång du gör en ändring.**

```
⚠️ GRUNDREGEL: Varje ändring i Traivo One kan påverka Traivo Go (och vice versa).
   Kolla ALLTID denna checklista innan du pushar!
```

---

## 📋 Snabbreferens: Vad påverkar vad?

```
┌────────────────────┐         ┌────────────────────┐
│   TRAIVO ONE       │         │   TRAIVO GO        │
│   (Backend)        │◄───────►│   (Frontend)       │
├────────────────────┤         ├────────────────────┤
│                    │         │                    │
│ API Endpoints ─────┼────────►│ API-anrop (hooks)  │
│ Response-format ───┼────────►│ TypeScript-typer   │
│ WebSocket events ──┼────────►│ Event listeners    │
│ Auth-logik ────────┼────────►│ Login/token-flöde  │
│ Validering ────────┼────────►│ Formulärvalidering │
│ Felkoder ──────────┼────────►│ Felhantering       │
│                    │         │                    │
└────────────────────┘         └────────────────────┘
```

---

## ✅ Checklista: Ändring i TRAIVO ONE (Backend)

### 🔹 Nytt API-endpoint

- [ ] **Route** skapad och registrerad i `app.ts`
- [ ] **Endpoint** dokumenterat (method, URL, request/response)
- [ ] **Auth** - kräver det autentisering?
- [ ] **Testat med curl** att det fungerar
- [ ] **📱 Go:** Skapa/uppdatera hook som anropar endpointet
- [ ] **📱 Go:** Uppdatera TypeScript-typer för request/response
- [ ] **📱 Go:** Skapa/uppdatera UI-komponent som visar datan
- [ ] **📚 Docs:** Uppdatera [TRAIVO_ARCHITECTURE.md](./TRAIVO_ARCHITECTURE.md) API-katalog

### 🔹 Ändrat befintligt API-endpoint

```
⚠️ BREAKING CHANGE RISK!
```

- [ ] **Bakåtkompatibelt?** Fungerar Go-appen fortfarande med gamla anrop?
- [ ] **Response-format ändrat?** → Uppdatera Go TypeScript-typer
- [ ] **Ny required parameter?** → Uppdatera alla Go-hooks som anropar
- [ ] **Ändrad URL?** → Uppdatera alla URL-referenser i Go
- [ ] **Ändrad statuskod?** → Kolla felhantering i Go
- [ ] **Testat** att Go-appen fortfarande fungerar
- [ ] **📚 Docs:** Uppdatera API-dokumentation

### 🔹 Nytt WebSocket-event

- [ ] **Event** definierat i `app.ts` (server → client ELLER client → server)
- [ ] **Payload** dokumenterat (vilken data skickas?)
- [ ] **📱 Go:** Lägg till event listener i relevant hook/komponent
- [ ] **📱 Go:** Hantera payload korrekt
- [ ] **Testat** att eventet skickas och tas emot
- [ ] **📚 Docs:** Uppdatera WebSocket-event-katalog

### 🔹 Databasändring

- [ ] **Migration** skapad
- [ ] **Befintlig data** hanterad (default-värden för nya kolumner)
- [ ] **API-responses** uppdaterade med nya fält
- [ ] **📱 Go:** TypeScript-typer uppdaterade
- [ ] **📱 Go:** UI uppdaterad för att visa nya fält
- [ ] **📚 Docs:** Uppdatera databasschema i ARCHITECTURE.md

### 🔹 Auth-ändring

```
🚨 HÖG RISK - Kan låsa ut alla användare!
```

- [ ] **Token-format** ändrat? → Uppdatera token-hantering i Go
- [ ] **Ny auth-header** krävs? → Uppdatera alla API-anrop i Go
- [ ] **Session-livstid** ändrad? → Uppdatera refresh-logik i Go
- [ ] **Nya roller/permissions?** → Uppdatera rolkontroller i Go
- [ ] **Testat** login/logout/refresh-flödet end-to-end

---

## ✅ Checklista: Ändring i TRAIVO GO (Frontend)

### 🔹 Ny skärm/sida

- [ ] **Screen-komponent** skapad i `client/screens/`
- [ ] **Registrerad** i `RootNavigator.tsx` (som Stack.Screen)
- [ ] **Navigation** till skärmen möjlig (tab, hamburger, eller push)
- [ ] **Behövs nytt API?** → Skapa endpoint i Traivo One
- [ ] **Behövs ny data?** → Skapa hook som hämtar från One
- [ ] **Error boundary** tillagd om skärmen kan krascha
- [ ] **Offline-stöd** om relevant

### 🔹 Ändrad navigation

- [ ] **TabNavigator.tsx** uppdaterad (om tab-ändring)
- [ ] **RootNavigator.tsx** uppdaterad (om ny stack screen)
- [ ] **HamburgerMenu.tsx** uppdaterad (om meny-ändring)
- [ ] **Deep links** fungerar fortfarande
- [ ] **Notifikations-navigation** fungerar fortfarande
- [ ] **Testat** alla navigationsvägar

### 🔹 Nytt API-anrop

- [ ] **Endpoint finns** i Traivo One? Om inte → skapa det först!
- [ ] **Hook skapad** i `client/hooks/`
- [ ] **TypeScript-typer** matchar API-response exakt
- [ ] **Felhantering** implementerad (401, 404, 500, nätverksfel)
- [ ] **Loading-state** visas under hämtning
- [ ] **Offline-kö** om det är en mutation (POST/PUT/DELETE)

### 🔹 Ändrad UI-komponent

- [ ] **Responsiv** - fungerar på olika skärmstorlekar
- [ ] **Haptic feedback** tillagd där relevant
- [ ] **Accessibility** - labels, contrast
- [ ] **Temat** (light/dark) stöds
- [ ] **Animationer** fungerar smooth

---

## 🚨 Breaking Changes Guide

### Vad är en breaking change?

| Ändring | Breaking? | Varför |
|---------|-----------|--------|
| Ny endpoint | ❌ Nej | Befintliga fungerar fortfarande |
| Nytt fält i response | ❌ Nej | Extra data ignoreras |
| Ta bort fält från response | ✅ JA | Frontend förväntar sig fältet |
| Ändra fältnamn | ✅ JA | Frontend refererar till gamla namnet |
| Ändra URL-path | ✅ JA | Frontend har gamla URL:en |
| Ändra HTTP-method | ✅ JA | Frontend skickar med annan method |
| Ändra required params | ✅ JA | Frontend skickar inte nya params |
| Ändra auth-krav | ✅ JA | Frontend kanske inte skickar token |

### Hur hantera breaking changes

```
┌──────────────────────────────────────────────────────────┐
│            BREAKING CHANGE WORKFLOW                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Steg 1: 📋 Dokumentera ändringen                       │
│  └── Vad ändras, varför, vad påverkas                    │
│                                                          │
│  Steg 2: 🔀 Skapa versionshantering (om möjligt)        │
│  └── Behåll gamla endpointet tillfälligt                 │
│  └── Ex: /api/v1/orders (gammal) + /api/v2/orders (ny)  │
│                                                          │
│  Steg 3: 🖥️ Uppdatera Traivo One FÖRST                  │
│  └── Deploy ny version med BÅDA endpoints                │
│                                                          │
│  Steg 4: 📱 Uppdatera Traivo Go                         │
│  └── Byt till nya endpointet                             │
│  └── Testa noggrant                                      │
│                                                          │
│  Steg 5: 🗑️ Ta bort gamla endpointet                    │
│  └── Först när alla klienter uppdaterats                  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Quick fix: Bakåtkompatibelt tillägg

```javascript
// ✅ SÅ HÄR - Bakåtkompatibelt (nytt fält, default-värde)
res.json({
  orders: [...],
  totalCount: orders.length,   // Nytt fält - ignoreras av gamla klienter
  hasMore: false               // Nytt fält - ignoreras av gamla klienter
});

// ❌ INTE SÅ HÄR - Breaking change (ändrat struktur)
res.json({
  data: {                      // Flyttat orders inuti data!
    orders: [...],
    pagination: { ... }
  }
});
```

---

## 📋 Pre-Push Checklista (ANVÄND VARJE GÅNG)

```
┌──────────────────────────────────────────────────────────┐
│              ✅ PRE-PUSH CHECKLISTA                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  □ Koden kompilerar utan fel                            │
│  □ Inga console.log kvar (utom medvetna debug-loggar)    │
│  □ API-ändringar är dokumenterade                        │
│  □ TypeScript-typer matchar mellan One och Go            │
│  □ Inga breaking changes (eller hanterade)              │
│  □ Testat manuellt (curl + app)                         │
│  □ Git commit message följer konventionen               │
│  □ TRAIVO_PROJECT_STATUS.md uppdaterad                  │
│  □ Relaterade projekt uppdaterade                       │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 🔄 Snabb-referens: Vanliga synk-scenarier

### Scenario 1: Lägg till nytt fält i order

```
One: Lägg till fält i databas + API-response
 Go: Uppdatera Order-typ + UI för att visa fältet
```

### Scenario 2: Ny push-notifikation

```
One: Skapa notification-typ + emitNotification-anrop
 Go: Hantera ny typ i useNotifications + visa i listan
```

### Scenario 3: Ny inställning

```
One: Lägg till i preferences-schema + API
 Go: Lägg till i usePreferences + SettingsScreen
```

### Scenario 4: Ny skärm som kräver data

```
 Go: Skapa screen + registrera i RootNavigator
One: Skapa API-endpoint (om ny data behövs)
 Go: Skapa hook + integrera med screen
```

---

## 📚 Relaterade dokument

- [🚀 Master Guide →](./TRAIVO_MASTER_GUIDE.md)
- [🏗️ Arkitektur & API-kontrakt →](./TRAIVO_ARCHITECTURE.md)
- [💻 Utvecklingsworkflow →](./TRAIVO_DEVELOPMENT_WORKFLOW.md)
- [📊 Projektstatus →](./TRAIVO_PROJECT_STATUS.md)

---

> 🔄 *Använd denna checklista VARJE gång du gör en ändring. Det tar 2 minuter och sparar timmar av debugging.*
