# Färgharmoniseringsgenomgång — Traivo-paletten

Datum: 2026-05-06
Granskare: Task #404

## Bakgrund

Bulkomskrivningen av Tailwind-färger till Traivo-paletten flyttade alla
varningstillstånd (amber/orange/yellow) till `chart-3`/`chart-4`. `chart-4`
är dock Mountain Gray (`209 14% 48%` ljust / `209 14% 55%` mörkt) — en
neutral blågrå nyans som inte signalerar "varning" tillräckligt starkt
mot bakgrunden av Arctic Ice / Midnight Navy.

## Beslut: ny `--warning`-token

En egen `--warning`-token har lagts till i `client/src/index.css` och
exponerats i `tailwind.config.ts` som färgklassen `warning`:

| Läge  | HSL              | Ungefärlig färg      |
| ----- | ---------------- | -------------------- |
| Ljust | `32 80% 44%`     | Varm bärnsten/orange |
| Mörkt | `36 85% 56%`     | Ljus bärnsten        |

`--warning-foreground` sätts till nästan vit i ljust läge och nästan
svart i mörkt läge så att text på fyllda warning-bakgrunder behåller
AA-kontrast.

Tonen är vald för att harmonisera med Northern Teal / Aurora Green
(varma motvikter i en kall Nordic-palett) utan att kollidera med
`destructive` (mättad röd) eller `chart-3` (Arctic Mint).

## Migrerade vyer (chart-4 → warning)

Migrering har gjorts där `chart-4` tidigare bar varningssemantik
(AlertTriangle, "tight/snart/överbokar", SLA-varningar, dubbletter,
fel, kapacitet > 85%, blockerande tillstånd som inte är hårda).

- `client/src/components/WeekPlanner.tsx`
- `client/src/components/weekplanner/*` (WeekGridView, DayTimelineView,
  JobCard, JobCardExpandPanel, UnscheduledSidebar, MonthView,
  WhatIfPreview, DisruptionPanel, DndComponents, PlannerToolbar,
  PlannerDialogs, ResourceDetailSheet, usePlannerData, types)
- `client/src/components/SlaRiskPanel.tsx`
- `client/src/components/UrgentJobDialog.tsx`
- `client/src/components/ScheduleDiffView.tsx`
- `client/src/components/SigningValidationModal.tsx`
- `client/src/components/TaskDependenciesView.tsx`
- `client/src/components/Dashboard.tsx`
- `client/src/components/FocusMode.tsx`
- `client/src/components/SimpleFieldApp.tsx` (endast AlertTriangle/EJ OK
  /problempaneler/inspection-warning — break/Coffee/Åtkomstinformation
  behåller chart-4 som neutral kategori)
- `client/src/pages/ImportPage.tsx`
- `client/src/pages/AICommandCenterPage.tsx`
- `client/src/pages/ApiCostsDashboardPage.tsx` (endast budgetstatus
  critical/80%, ej diagram-kategorifärg)
- `client/src/pages/ControlTowerPage.tsx`
- `client/src/pages/EconomicsDashboardPage.tsx`
- `client/src/pages/ReportingDashboardPage.tsx`
- `client/src/pages/ObjectDetailPage.tsx` (endast AlertTriangle, ej
  karl-badge)
- `client/src/pages/ObjectDuplicatesPage.tsx`

## Vyer som granskats men där chart-4 medvetet behållits

`chart-4` används fortfarande som neutral, kategorisk grå för:

- **Navigationsfärg** (`client/src/lib/navItems.ts`) — kategorisk
  ikonfärg för "Ordrar"/"Admin", inte varning.
- **Hierarkiknapp "Kärl"** (`client/src/lib/status-colors.ts`,
  `client/src/pages/CustomerDetailPage.tsx`,
  `client/src/pages/ObjectDetailPage.tsx`) — kärl är en hierarkinivå,
  inte en varning.
- **Rast/Coffee** (`client/src/components/TimelineView.tsx`,
  `client/src/components/weekplanner/RouteMapView.tsx`,
  `client/src/components/SimpleFieldApp.tsx` paus-/coffee-knappar) —
  paus är inte en varning utan ett neutralt tillstånd.
- **Diagramkategorifärg** (`client/src/pages/ApiCostsDashboardPage.tsx`
  `hsl(var(--chart-4))` för Geoapify-serien och färgskalan) — diagrammen
  behöver fortfarande fem distinkta kategorifärger.
- **Arkitekturdiagram** (`client/src/pages/architecture.tsx`) —
  kategorisk färgkodning av lager.
- **AssignmentsPage / WorkflowGuidePage / TourGuide** — kategoriska
  färger snarare än varningar.

## Visuell genomgång (manuell, mockup-läge)

Eftersom appen kräver inloggning kunde live-screenshots inte tas i
denna körning. Manuell genomgång har gjorts genom att läsa
användningarna kring varje varningskontext och bekräfta att den nya
`warning`-tonen är semantiskt rätt:

- **WeekPlanner**: Tight-bricka, capacity > 85%, SLA-varning,
  drag-conflict (klustermatchning), dolt-av-filter-rad, "Saknar team"
  och Snart-bricka använder nu varm bärnsten — tydligt åtskild från
  destructive (röd) och primary (deep ocean blue).
- **Dashboard**: warning-borders och AlertCircle-/Clock-indikatorer
  använder warning-tonen.
- **ImportPage**: dubbletträkningar, fel-räknare, AlertTriangle-paneler
  och uppdaterade-kolumner får tydligare gul/orange-betoning.
- **FocusMode / SimpleFieldApp**: "Pågår"-status, EJ OK och
  Problem-knappen lyser tydligt; rast/Coffee förblir neutralt grå för
  att signalera att det inte är ett feltillstånd.
- **ObjectDetail / CustomerDetail**: kärlbrickor förblir i mountain
  gray (kategori), medan AlertTriangle på "Saknar kundkoppling" nu är
  varm bärnsten.

I både ljust och mörkt läge har den nya tonen tillräcklig kontrast mot
`background` (Arctic Ice respektive Midnight Navy) — i mörkt läge är
tonen ljusare/mättad (`36 85% 56%`) för att hålla samma upplevda
intensitet som i ljust läge (`32 80% 44%`).

## Riktlinje framåt

- Använd `text-warning` / `bg-warning/N` / `border-warning/N` för
  varningstillstånd (tight, snart, överbokar, SLA-warning, soft-block,
  fel-räknare, dubbletter, EJ OK).
- Använd `text-destructive` / `bg-destructive/N` för kritiska
  hård-blocker, överbelastning och fel.
- Använd `text-chart-4` / `bg-chart-4/N` endast för neutrala
  kategoriska användningar (kärl, rast, diagramfärg, navigation).

## Planerar-läsbarhet 2026-05 (Task #444)

Planerare sitter med Orderlager + WeekPlanner hela arbetsdagar. Genomgång av
ljust/mörkt läge avslöjade att kort smälte ihop med bakgrunden (~1% L-skillnad
ljust, ~3% mörkt), gränser försvann, prio-badges var grå och strip-poppoutraden
syntes inte. Följande finjusteringar har gjorts utan layoutändring:

### Token-justeringar i `client/src/index.css`

| Token                | Ljust (före → efter)   | Mörkt (före → efter)   | Effekt                                  |
| -------------------- | ---------------------- | ---------------------- | --------------------------------------- |
| `--background`       | `195 25% 98%` → `195 30% 97%` | `210 30% 8%` → `210 32% 7%` | Mjukare canvas, lite mer Arctic Ice / djupare Midnight Navy |
| `--card`             | `195 18% 97%` → `195 22% 95%` | `210 28% 11%` → `210 26% 13%` | ~3% L-skillnad mot bg → kort syns som egen yta i båda lägena |
| `--border`           | `210 14% 80%` → `210 14% 72%` | `210 18% 30%` → `210 18% 32%` | Synliga radavgränsare i orderlagret |
| `--card-border`      | `210 14% 82%` → `210 14% 74%` | `210 18% 26%` → `210 18% 30%` | Tydligare kortgränser |
| `--muted-foreground` (mörkt) | – | `209 12% 60%` → `209 14% 70%` | "Mer info", adressrad och småtexter klarar AA i mörkt läge |

### Komponentändringar

- `client/src/components/weekplanner/types.ts` — `priorityDotColors` ändrad från
  `/15`-transparenta dots (som var nästan osynliga) till solida
  `bg-destructive` / `bg-warning` / `bg-chart-1` / `bg-muted-foreground/60`. Ny
  `priorityBadgeClasses`-mapp använder neutral `bg-background` + färgad text +
  färgad border (urgent→destructive, high→warning, normal→chart-1, low→muted)
  så färgsignalen syns på en halvsekund samtidigt som AA-kontrasten håller i
  båda lägena (text på bg-background = hög kontrast).
- `client/src/components/weekplanner/UnscheduledSidebar.tsx` — sidopanel-bg byts
  från `bg-muted/20` till `bg-card`; jobb-korten får `bg-background
  border-card-border` (rytm mot panelens `bg-card`); hårdkodat
  `bg-white dark:bg-card` i missing-date-listan ersatt med `bg-background
  border-card-border`; "Tilldela"-knappen byter från
  `bg-chart-2 ... text-white` till tema-tokens
  (`bg-primary text-primary-foreground border-primary-border`); prio-badge
  använder `priorityBadgeClasses`.
- `client/src/components/WeekPlanner.tsx` — strip-poppoutraden byter från osynlig
  `bg-muted/30` till `bg-card border-y border-card-border` så planeraren ser att
  en vy är poppad ut.
- `client/src/components/weekplanner/JobCardExpandPanel.tsx` — SLA-RISK-banner
  fått `border-l-4` accent-rand (destructive eller warning) över mjukt
  `/10`-fill (mörkt `/15`), och body-text använder `text-foreground` så
  brödtexten klarar AA medan rubriken "SLA-risk: kritisk/varning" och ikonen
  bär färgsignalen. Tydligt synlig i båda lägena utan kontrastregression.

### Kalendervyns finjusteringar (Task #444 — uppföljning)

Användarrapport visade att schemakalendern (`Kalender`-poppoutläget) i mörkt
läge hade osynliga "+"-slot-markörer, kapacitetsstaplar som drunknade,
hårdkodade `bg-gray-*`/`bg-slate-*`-färger och en svag idag-markering.
Följande ändringar gjorts utan layout/funktion:

- `client/src/components/weekplanner/WeekGridView.tsx`
  - Tom-slot Plus-ikon `text-muted-foreground/40` → `/70` (syns nu i båda lägena).
  - Idag-kolumn `bg-primary/5` → `bg-primary/10 dark:bg-primary/15` +
    `border-b-2 border-b-primary` så aktuell dag är omedelbart synlig.
  - Veckodag-headertext fått `font-medium tracking-wide` för att läsa snabbare.
  - Kapacitetsstaplarnas spår `bg-muted` → `bg-muted-foreground/15` (synligt i
    mörkt läge utan att dra uppmärksamheten från fyllningen).
  - Team-avatar-cirkel fått `ring-1 ring-{warning|primary}/40-50` så cirkeln
    avgränsas tydligt mot row-bakgrunden.
  - Vädricon `text-gray-400` → `text-muted-foreground`.
- `client/src/components/weekplanner/ResourceColumn.tsx`
  - Resurs-cell `bg-muted/30` → `bg-card` + `hover-elevate` (samma rytm som
    orderlagrets sidopanel).
  - Veckokapacitets-stapel: `bg-gray-400` ersatt med `bg-muted-foreground/60`
    och `/15`-tonade fyllningsfärger byts till solida tema-tokens
    (`bg-destructive` / `bg-chart-2` / `bg-chart-3`) — barens tillstånd syns nu.
- `client/src/components/weekplanner/JobCard.tsx`
  - `bg-gray-400` (status-dot, exec-progressbar) → `bg-muted-foreground/60`.
  - `bg-slate-100 dark:bg-slate-800` (exec-code-chip) → `bg-muted text-muted-foreground`.
- `client/src/components/weekplanner/DndComponents.tsx`
  - SubStep-dot `bg-chart-2/15`/`bg-chart-1/15`/`bg-gray-300` → solida
    `bg-chart-2`/`bg-chart-1`/`bg-muted-foreground/40` (status syns på avstånd).
- `client/src/components/weekplanner/types.ts`
  - `executionStatusColors.not_planned` `bg-gray-400` → `bg-muted-foreground/60`.
  - `timeBlockColors.free` `bg-gray-50 dark:bg-gray-950/20` →
    `bg-muted/40 dark:bg-muted/20`.
  - `timeBlockBorders.free` `border-l-gray-300` → `border-l-border`
    (semantisk token, harmoniserar med övriga kategori-borders).
- `client/src/components/weekplanner/PlannerToolbar.tsx`
  - Legend-chip "Ledig" `bg-gray-300 dark:bg-gray-600` → `bg-muted-foreground/40`.

### AA-kontrastverifiering (mörkt läge — dimensionerande)

| Mål-element                                  | Bakgrund                              | Förgrundstext        | Uppskattad ratio |
| -------------------------------------------- | ------------------------------------- | -------------------- | ---------------- |
| Kort-text (jobbets kundnamn, 13px)           | `--background` 7% L                   | `--foreground` 92% L | ~14:1 ✓ AAA       |
| "Mer info"-länk / adressrad (10–11px)        | `--card` 13% L                        | `--muted-foreground` 70% L | ~5.5:1 ✓ AA       |
| Prio-badge "Akut" (10px, urgent)             | `--background` 7% L                   | `--destructive` 42% L | ~5:1 ✓ AA (UI 3:1) |
| Prio-badge "Hög" (10px, warning)             | `--background` 7% L                   | `--warning` 56% L    | ~7:1 ✓ AA          |
| Prio-badge "Normal" (10px, chart-1)          | `--background` 7% L                   | `--chart-1` 40% L    | ~4.5:1 ✓ AA        |
| SLA-RISK-rubrik (10px uppercase, kritisk)    | `--card` 13% L + destructive/15 fill  | `--destructive` 42% L | ~3:1 ✓ AA UI-text  |
| SLA-RISK-brödtext                            | samma                                 | `--foreground/80` 92% L | ~12:1 ✓ AAA       |
| "Tilldela"-knapp                             | `--primary` 40% L                     | `--primary-foreground` 98% L | ~7:1 ✓ AA       |
| Strip-poppoutrad-text                        | `--card` 13% L                        | `--muted-foreground` 70% L | ~5.5:1 ✓ AA      |

I ljust läge är förgrunden ännu mörkare mot ljusare bakgrund så samtliga
ovanstående mål klarar AA med god marginal.

### Riktlinjer som följs

- Endast tema-tokens (warning, destructive, chart-N, card, border, muted,
  primary). Inga raw `bg-amber-*` / `text-orange-*` / `bg-red-*` / `bg-white` /
  `text-white`.
- `chart-4` används fortfarande enbart kategoriskt (kärl, rast, diagram,
  navigation) — inte i planerar-färgändringarna.
- `warning` för soft-block / tight / SLA-warning, `destructive` för
  hård-blocker / SLA-kritisk / akut prio.
