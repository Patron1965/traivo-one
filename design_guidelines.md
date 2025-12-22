# Unicorn - Design Guidelines

## Design Approach

**System Selection:** Modern SaaS productivity design inspired by Linear and Notion, with Material Design principles for data density. Prioritizes clarity, efficiency, and professional aesthetics suitable for field service management.

**Core Principles:**
- **Functional Clarity:** Every element serves a purpose; no decorative elements that don't enhance usability
- **Scandinavian Minimalism:** Clean, uncluttered interfaces with generous whitespace
- **Information Hierarchy:** Clear visual distinction between primary, secondary, and tertiary information
- **Speed-Focused:** Fast-loading, responsive interactions; users are working professionals

---

## Typography

**Font Families:**
- Primary: Inter (headings, UI elements, data)
- Monospace: JetBrains Mono (order numbers, timestamps, technical data)

**Hierarchy:**
- Page titles: text-2xl font-semibold
- Section headers: text-lg font-medium
- Card titles: text-base font-medium
- Body text: text-sm font-normal
- Captions/metadata: text-xs font-normal
- Data/numbers: text-sm font-mono

---

## Layout System

**Spacing Units:** Use Tailwind spacing scale with primary units of **4, 6, 8, 12** for consistent rhythm.
- Component padding: p-6 (cards, modals)
- Section spacing: space-y-8
- Grid gaps: gap-4 to gap-6
- Compact spacing for dense data: gap-2, p-4

**Container Strategy:**
- Dashboard/planner: Full-width with max-w-7xl centered
- Detail views: max-w-4xl centered
- Mobile app: Full-width, edge-to-edge design

**Grid Layouts:**
- Weekly planner: CSS Grid with fixed row headers, scrollable columns
- Object cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-3
- Dashboard stats: grid-cols-2 md:grid-cols-4

---

## Component Library

### Navigation
**Desktop Sidebar:**
- Fixed left sidebar (w-64) with navigation links
- Icon + label format for clarity
- Active state: subtle fill treatment
- Collapsible for more screen space

**Mobile Navigation:**
- Bottom tab bar (fixed) with 4 primary actions
- Icons only, labels on active state
- Thumbs-friendly touch targets (min h-12)

### Weekly Planner
**Layout:** Table-like grid with resource rows and day columns
- Fixed header row (days of week)
- Fixed left column (resource names/photos)
- Scrollable main grid area
- Work order cards: Compact rectangles with title, time, and object name
- Drag handles: Subtle grip icon on hover
- Time slots: 30-minute increments with subtle grid lines
- Visual indicators: Border-left accent for priority (urgent = thick border)

### Route Map View
**Two-Column Layout:**
- Left panel (w-96): Job list with sequence numbers, drive times between stops
- Right panel: Full-height interactive map
- Map markers: Numbered pins corresponding to sequence
- Route line: Solid line connecting all stops
- Selected job: Highlighted on both map and list
- Comparison mode: Side-by-side current vs optimized with savings callout

### Object Management
**Card-Based Grid:**
- Object cards showing thumbnail map, name, last service date, setup time badge
- Hover: Lift effect (shadow-lg transition)
- Detail modal: Slideout from right (w-full md:w-2/3 lg:w-1/2)
- Access info: Collapsible sections with icons (key, parking, gate)
- Setup time breakdown: Horizontal bar chart showing time distribution

### Mobile Field App
**Single-Column, Card-Based:**
- Large touch targets (min h-14 for buttons)
- Today's jobs: Stacked cards with job #, object name, time, address
- Primary CTA: Full-width "Start Job" button (sticky bottom)
- Job details: Full-screen view with prominent access info callout
- Completion form: Simple, one-field-at-a-time progression
- Photo capture: Camera button with preview thumbnails

### Analytics Dashboard
**Dashboard Cards:**
- Stat cards: grid-cols-2 md:grid-cols-4 showing key metrics
- Large number displays (text-3xl font-bold) with label beneath
- Charts: Full-width within cards, using simple bar/line charts
- Insight cards: Subtle border-left accent with AI suggestion icon
- Trend indicators: Small arrow icons with percentage change

### Forms & Inputs
- Consistent height (h-10) for all inputs
- Clear labels above inputs (text-sm font-medium)
- Placeholder text for examples
- Validation: Inline error messages (text-xs) below field
- Dropdown selects: Custom styled with chevron icon
- Date pickers: Calendar overlay with quick presets (Today, Tomorrow, Next Week)
- Time inputs: 24-hour format with quick 30-min increment buttons

### Data Tables
- Zebra striping for row differentiation (subtle)
- Sticky header row
- Sortable columns with arrow indicators
- Row hover: Subtle fill change
- Compact vertical padding (py-3) for density
- Action buttons: Right-aligned icon buttons

### Buttons & Actions
- Primary action: Solid fill, medium weight
- Secondary: Outlined with border
- Tertiary: Ghost (no border, subtle hover)
- Icon buttons: Square (w-10 h-10) for consistent touch targets
- Loading states: Spinner replaces button content

### Maps
- Fullscreen map option for route planning
- Cluster markers for grouped objects
- Info windows: Clean, minimal with object name and key details
- Route polyline: Medium weight, semi-transparent
- Current location: Pulsing blue dot (mobile field app)

---

## Animations

**Minimal, Purposeful Motion:**
- Transitions: transition-all duration-200 for hover states
- Page transitions: None (instant navigation for speed)
- Modal entry: Slide from right (slideInRight) for detail views
- Drag-drop: Smooth following cursor with subtle lift shadow
- Loading: Simple spinner, no elaborate animations
- Map interactions: Native Google Maps animations

---

## Responsive Behavior

**Breakpoints:**
- Mobile: Base styles (320px+)
- Tablet: md: (768px+) - Two-column layouts
- Desktop: lg: (1024px+) - Full feature set
- Wide: xl: (1280px+) - Max container width

**Mobile-First Considerations:**
- Field app: Designed mobile-first, works offline
- Weekly planner: Horizontal scroll on mobile with sticky headers
- Map view: Full-screen on mobile, split-view on desktop
- Navigation: Bottom tabs on mobile, sidebar on desktop
- Forms: Full-width inputs, stacked labels on mobile

---

## Accessibility

- Touch targets minimum 44px (h-11) on mobile
- Keyboard navigation: Focus rings (ring-2 ring-offset-2)
- Screen reader labels on icon-only buttons
- Sufficient contrast ratios maintained
- Form validation with clear error messaging
- Skip links for keyboard users on complex layouts

---

## Images

**No hero images** - This is a productivity application, not a marketing site. All screens are functional interfaces.

**Image Usage:**
- User avatars: Circular (rounded-full) in navigation and resource lists
- Object thumbnails: Small map snapshots showing object location
- Completion photos: Grid of uploaded images in job detail modal
- Company logo: Top-left of sidebar, simple mark version

---

## Platform-Specific Notes

**Desktop (Planners):**
- Dense information layout optimized for mouse/keyboard
- Keyboard shortcuts for common actions (Cmd+K for search, Cmd+N for new job)
- Multi-window support for planner + map simultaneously

**Mobile (Technicians):**
- Large, thumb-friendly touch targets
- Offline-capable with clear sync status
- Quick actions accessible within 1-2 taps
- Camera integration for photo capture
- GPS integration for navigation