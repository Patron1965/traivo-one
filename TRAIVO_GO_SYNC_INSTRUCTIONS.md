# Synk-instruktion: Att-göra-lista + Dagsrapport till Traivo Go

> Kopiera denna instruktion till agenten i det separata Traivo Go-projektet.

---

## Funktion 1: Personlig att-göra-lista (FieldTodoList)

### Vad den gör
En personlig att-göra-lista i mobilappen där teknikern kan lägga till egna uppgifter som inte är kopplade till arbetsordrar (t.ex. "Tanka bilen", "Hämta nycklar"). Listan sparas i localStorage och fungerar offline.

### Funktioner
- Lägg till uppgifter med fritext
- Bocka av uppgifter (markeras som klara med genomstruken text)
- Ta bort enskilda uppgifter
- "Rensa klara"-knapp för att ta bort alla avbockade
- Badge med antal kvarvarande uppgifter på navigeringsknappen
- Persisterar i localStorage med nyckeln `traivo_go_personal_todos`
- Tom-vy med ikon och instruktionstext

### Implementering
Skapa en ny komponent `FieldTodoList` med följande:

**Data-modell (localStorage):**
```typescript
interface TodoItem {
  id: string;       // crypto.randomUUID() eller fallback
  text: string;
  completed: boolean;
  createdAt: string; // ISO-datum
}
```

**localStorage-nyckel:** `traivo_go_personal_todos`

**Exporterad hjälpfunktion:** `getUncompletedTodoCount()` — returnerar antal ej avbockade. Används i den anropande komponenten för att visa badge.

**UI-struktur:**
- Header med "Att göra"-titel, tillbaka-knapp och "Rensa klara"-knapp
- Textfält + Lägg till-knapp (formulär med submit)
- Lista med ej klara uppgifter (Circle-ikon, text, papperskorg)
- Avdelare "Klara (N)"
- Lista med klara uppgifter (CheckCircle-ikon, genomstruken text, nedtonad opacity)

**Navigering:**
- Knapp i bottenraden med ListTodo-ikon (orange) och texten "Att göra"
- Badge-räknare (orange cirkel) som visar antal kvarvarande uppgifter

**data-testid på viktiga element:**
- `todo-list-view` — hela vyn
- `button-back-from-todo` — tillbaka-knapp
- `button-clear-completed` — rensa klara
- `input-new-todo` — textfält
- `button-add-todo` — lägg till-knapp
- `todo-item-{id}` — varje uppgift
- `button-toggle-todo-{id}` — bocka av/på
- `button-remove-todo-{id}` — ta bort
- `button-open-todo-list` — navigeringsknapp
- `badge-todo-count` — badge med antal

---

## Funktion 2: Dagsrapport (DayReport)

### Vad den gör
En sammanfattning av dagens arbete som teknikern kan se i slutet av dagen. Visar slutförandegrad, tider, foton, signaturer och material.

### Funktioner
- Slutförandegrad med progress bar (räknar utford + fakturerad som klara)
- Beräknad vs faktisk tid (hämtas från estimatedDuration och metadata.actualDuration)
- Antal foton och signaturer (från metadata.photos och metadata.signaturePath)
- Expanderbar sektion "Jobbtyper" — fördelning per orderType
- Expanderbar sektion "Material" — material per jobb (från metadata.materials)
- Expanderbar sektion "Alla jobb" — fullständig lista med statusikoner och badges
- Exportera som textfil (.txt)

### Data som behövs
Komponenten tar emot:
- `workOrders` — dagens alla arbetsordrar för resursen
- `resourceId` — resursens ID
- `onBack` — callback för att gå tillbaka

### Status-logik
- **Klara:** `utford` och `fakturerad`
- **Kvar:** allt som inte är `utford`, `fakturerad`, `omojlig` eller `avbruten`
- **Omöjliga:** `omojlig`
- **Exportssymboler:** ✓ (klar), ✗ (omöjlig), — (avbruten), ○ (övrig)

### Navigering
- Knapp i bottenraden med FileText-ikon (teal) och texten "Rapport"

**data-testid på viktiga element:**
- `day-report-view` — hela vyn
- `button-back-from-report` — tillbaka-knapp
- `button-export-report` — exportknapp
- `text-completion-rate` — slutförandeprocent
- `text-completed-count` — antal klara/totalt
- `text-estimated-time` — beräknad tid
- `text-actual-time` — faktisk tid
- `text-photo-count` — antal foton
- `text-signature-count` — antal signaturer
- `report-job-{id}` — varje jobb i listan

---

## Bottenrad-layout

Mobilappens bottenrad ska ha tre knappar:
1. **Fråga AI** (HelpCircle-ikon, lila) — `flex-1` bred
2. **Att göra** (ListTodo-ikon, orange) — med badge
3. **Rapport** (FileText-ikon, teal)
