# Fältapp - React Native/Expo

Mobilapp för chaufförer och servicetekniker att hantera sina arbetsordrar i fält.

## Funktioner

- **Inloggning** - Logga in med e-post och PIN-kod
- **Dagsvyn** - Se alla tilldelade arbetsordrar för dagen
- **Orderdetaljer** - Se fullständig information om varje uppdrag
- **Statusuppdatering** - Markera uppdrag som påbörjad, klar eller ej utförd
- **Navigation** - Öppna adress direkt i Google Maps/Apple Maps
- **Kundkontakt** - Ring kund direkt från appen

## Installation

1. Navigera till mobile-mappen:
   ```bash
   cd mobile
   ```

2. Installera beroenden:
   ```bash
   npm install
   ```

3. Konfigurera API-URL i `src/api/client.ts`:
   ```typescript
   const API_BASE_URL = 'https://your-app-url.replit.app';
   ```

## Starta utvecklingsserver

```bash
npm start
```

Detta startar Expo-utvecklingsservern. Du kan sedan:
- Scanna QR-koden med Expo Go-appen på din telefon
- Trycka `i` för iOS-simulator
- Trycka `a` för Android-emulator

## Testa inloggning

Använd e-postadressen för en resurs i systemet och valfri 4-6 siffrig PIN-kod.

**OBS: Säkerhetsanmärkning för produktion**
Den nuvarande PIN-autentiseringen är förenklad för demo-ändamål. I produktion bör följande implementeras:
- Hashad PIN-lagring i databasen
- Rate limiting för inloggningsförsök
- Sessionshantering med Redis eller liknande
- Tvåfaktorsautentisering

## Bygga för produktion

### iOS
```bash
npx expo build:ios
```
Kräver Apple Developer-konto ($99/år)

### Android
```bash
npx expo build:android
```
Kräver Google Play Developer-konto ($25 engångskostnad)

### Med EAS Build (rekommenderat)
```bash
npm install -g eas-cli
eas login
eas build --platform all
```

## Projektstruktur

```
mobile/
├── App.tsx                    # Huvudkomponent
├── src/
│   ├── api/                   # API-anrop
│   │   ├── client.ts          # Axios-konfiguration
│   │   ├── auth.ts            # Autentisering
│   │   └── workOrders.ts      # Arbetsordrar
│   ├── context/
│   │   └── AuthContext.tsx    # Autentiseringsstate
│   ├── navigation/
│   │   └── index.tsx          # React Navigation
│   ├── screens/
│   │   ├── LoginScreen.tsx    # Inloggningsskärm
│   │   ├── OrderListScreen.tsx # Lista med ordrar
│   │   └── OrderDetailsScreen.tsx # Orderdetaljer
│   └── types/
│       └── index.ts           # TypeScript-typer
├── assets/                    # Ikoner och bilder
└── package.json
```

## Backend API-endpoints

Mobilappen använder följande API-endpoints:

- `POST /api/mobile/login` - Inloggning
- `POST /api/mobile/logout` - Utloggning
- `GET /api/mobile/me` - Hämta inloggad resurs
- `GET /api/mobile/my-orders` - Hämta arbetsordrar (med ?date=YYYY-MM-DD)
- `GET /api/mobile/orders/:id` - Hämta orderdetaljer
- `PATCH /api/mobile/orders/:id/status` - Uppdatera status
- `POST /api/mobile/orders/:id/notes` - Lägg till anteckning
