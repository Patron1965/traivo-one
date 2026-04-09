# Synk-instruktion: Att-göra-lista + Dagsrapport till Traivo Go

> Kopiera denna instruktion till agenten i det separata Traivo Go-projektet (React Native/Expo).
> Instruktionen är anpassad till Traivo Go:s tech-stack: React Native 0.79, Expo SDK 54, React Navigation, AsyncStorage, Feather-ikoner, Card-komponent, ThemedText/ThemedView, @shopify/flash-list.

---

## Funktion 1: Personlig att-göra-lista (TodoScreen)

### Vad den gör
En personlig att-göra-lista där teknikern kan lägga till egna uppgifter som inte är kopplade till arbetsordrar (t.ex. "Tanka bilen", "Hämta nycklar på kontoret", "Ring kund X"). Listan sparas i AsyncStorage och fungerar offline. Inga backendändringar behövs.

### Funktioner
- Lägg till uppgifter med fritext (TextInput + knapp)
- Bocka av uppgifter (markeras som klara med genomstruken text och nedtonad opacity)
- Klara uppgifter sorteras längst ner under en avdelare "Klara (N)"
- Ta bort enskilda uppgifter (papperskorgsikon)
- "Rensa klara"-knapp i headern som tar bort alla avbockade
- Badge med antal kvarvarande uppgifter på navigeringen (Bottom Tab badge)
- Tom-vy med ikon och "Tomt här! Lägg till din första uppgift ovan"

### Implementering

**Ny fil:** `client/screens/TodoScreen.tsx`

**Data-modell (AsyncStorage):**
```typescript
interface TodoItem {
  id: string;       // uuid.v4() eller Date.now() + Math.random()
  text: string;
  completed: boolean;
  createdAt: string; // ISO-datum
}
```

**AsyncStorage-nyckel:** `traivo_go_personal_todos`

**Lagring (async):**
```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'traivo_go_personal_todos';

async function loadTodos(): Promise<TodoItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveTodos(items: TodoItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* offline-safe */ }
}
```

**Exporterad hjälpfunktion** (för badge):
```typescript
export async function getUncompletedTodoCount(): Promise<number> {
  const todos = await loadTodos();
  return todos.filter(t => !t.completed).length;
}
```

**UI-struktur (React Native-komponenter):**
- Header med tillbaka-knapp, "Att göra"-titel, och "Rensa klara"-knapp (Trash2-ikon)
- TextInput + TouchableOpacity (Plus-ikon) i en rad
- FlatList eller FlashList med ej klara uppgifter (varje rad: Circle-ikon → text → Trash2-ikon)
- Avdelare med text "Klara (N)" och en linje
- FlatList/FlashList med klara uppgifter (varje rad: CheckCircle-ikon grön → genomstruken text → Trash2-ikon, opacity 0.6)

**Ikoner (Feather via @expo/vector-icons):**
- `circle` — ej klar uppgift
- `check-circle` — klar uppgift (grön)
- `trash-2` — ta bort
- `plus` — lägg till
- `arrow-left` — tillbaka
- `list` — tom-vy ikon

**Navigering:**
Lägg till TodoScreen som ny skärm. Antingen:
- **Alt A (rekommenderat):** Ny flik i Bottom Tabs med `list`-ikon och texten "Att göra" + badge-räknare
- **Alt B:** Knapp på HomeScreen som navigerar till TodoScreen via stack

Badge-uppdatering: Anropa `getUncompletedTodoCount()` och uppdatera `tabBarBadge` i navigeringskonfigurationen.

**Färger (Traivo-paletten):**
- Badge: Orange (#F97316)
- Klar-ikon: Grön (#22C55E)
- Papperskorg hover: Röd (#EF4444)
- Tom-vy ikon: Mountain Gray (#6B7C8C) med opacity

---

## Funktion 2: Dagsrapport (DayReportScreen)

### Vad den gör
En sammanfattning av dagens arbete som teknikern ser i slutet av dagen. Visar slutförandegrad, tider, foton, signaturer och material.

### Funktioner
- Slutförandegrad med progress bar
- Beräknad vs faktisk tid
- Antal foton och signaturer
- Expanderbar sektion "Jobbtyper" — fördelning per orderType
- Expanderbar sektion "Material" — material per jobb
- Expanderbar sektion "Alla jobb" — fullständig lista med statusikoner
- "Dela"-knapp som delar rapporten som text (via `Share` API från React Native)

### Implementering

**Ny fil:** `client/screens/DayReportScreen.tsx`

**Data:** Hämta dagens ordrar via befintlig `/api/mobile/my-orders?date=YYYY-MM-DD` endpoint.

**Order-typ i Traivo Go** (från `client/types/index.ts`):
```typescript
interface Order {
  id: string;
  title: string;
  orderType: string;
  orderStatus: string;     // "utford", "fakturerad", "omojlig", "avbruten", etc.
  estimatedDuration: number | null;
  objectAddress: string | null;
  objectName: string | null;
  scheduledStartTime: string | null;
  metadata?: {
    actualDuration?: number;
    photos?: string[];
    signaturePath?: string;
    materials?: Array<{ name: string; quantity: number; unit: string }>;
  };
  // ... mer fält
}
```

**Status-logik:**
- **Klara:** `utford`, `fakturerad`, `completed`, `avslutad` (alla terminal-klara statusar i Traivo Go)
- **Kvar:** allt som inte är en terminal status
- **Omöjliga:** `omojlig`
- **Exportssymboler:** ✓ (klar), ✗ (omöjlig), — (avbruten), ○ (övrig)

**Tidsberäkning:**
- Beräknad: summa av `estimatedDuration` (minuter)
- Faktisk: summa av `metadata.actualDuration` om det finns, annars `estimatedDuration`

**Export/Dela (React Native Share API):**
```typescript
import { Share } from 'react-native';

const shareReport = async () => {
  const lines = [
    `DAGSRAPPORT — ${formatDate(today)}`,
    `Utförda: ${completed}/${total}`,
    `Slutförandegrad: ${rate}%`,
    // ... mer rader
  ];
  await Share.share({ message: lines.join('\n') });
};
```

**UI-struktur:**
- Header: "Dagsrapport" + datum + Dela-knapp (share-ikon)
- Stort kort: Slutförandegrad i procent + cirkelindikator + progress bar
- 2×2 rutnät: Beräknad tid, Faktisk tid, Foton, Signaturer
- Expanderbara sektioner (TouchableOpacity med chevron):
  - Jobbtyper (namn + antal)
  - Material (grupperat per jobb)
  - Alla jobb (statusikon + titel + adress + badges för foto/signatur/material)

**Ikoner (Feather):**
- `check-circle` — klar
- `clock` — beräknad tid, kvar
- `alert-triangle` — omöjlig
- `camera` — foton
- `edit-3` — signatur (eller `feather`)
- `package` — material
- `trending-up` — jobbtyper
- `file-text` — alla jobb
- `share-2` — dela
- `chevron-down` / `chevron-up` — expandera/kollapsa

**Navigering:**
- Knapp på HomeScreen (t.ex. i headern eller som ett kort) eller ny Bottom Tab
- Kan också nås från OrdersScreen via en "Dagsrapport"-knapp

**Färger:**
- Slutförandecirkel: Northern Teal (#4A9B9B)
- Klar-ikon: Grön (#22C55E)
- Omöjlig: Röd (#EF4444)
- Kvar: Blå (#3B82F6)

---

## Navigeringsförslag

Utöka Bottom Tabs i Traivo Go:

| Flik | Ikon | Skärm | Anteckning |
|------|------|-------|------------|
| Hem | `home` | HomeScreen | Befintlig |
| Uppdrag | `clipboard` | OrdersScreen | Befintlig |
| Att göra | `list` | TodoScreen | **NY** — med orange badge |
| Karta | `map` | MapScreen | Befintlig |
| Rapport | `file-text` | DayReportScreen | **NY** |

Alternativt kan "Att göra" och "Rapport" läggas som knappar på HomeScreen istället för egna flikar, beroende på hur många flikar som redan finns.

---

## Sammanfattning av skillnader mot Traivo One (webb)

| Aspekt | Traivo One (webb) | Traivo Go (React Native) |
|--------|-------------------|--------------------------|
| Storage | localStorage | AsyncStorage (async) |
| Ikoner | lucide-react | @expo/vector-icons (Feather) |
| UI-komponenter | shadcn/ui (Card, Button, Badge, Input) | Card, ThemedText, ThemedView, StatusBadge |
| Listor | div med map | FlatList / @shopify/flash-list |
| Navigation | View-state i SimpleFieldApp | React Navigation (Stack + Tabs) |
| Export | Blob + download | React Native Share API |
| ID-generering | crypto.randomUUID() | uuid.v4() eller Date.now() |
| Ordrar | /api/work-orders (filtrerat i frontend) | /api/mobile/my-orders?date=YYYY-MM-DD |
| Klara statusar | utford, fakturerad | utford, fakturerad, completed, avslutad |
| Priser | öre ÷ 100 via beräkning | formatPrice() (befintlig hjälpfunktion) |
