---
name: ObjectTimeline reusable component
description: How the zoomable object-task timeline is built for reuse (e.g. customer portal calendar).
---

# Zoombar objekt-tidslinje (ObjectTimeline)

`client/src/components/timeline/ObjectTimeline.tsx` är en återanvändbar år→kvartal→månad→vecka→dag-vy
för objektuppgifter. Den är **datakälls-agnostisk**: föräldern injicerar `fetchTimeline(startDate, endDate)`
och `queryKeyPrefix`, så samma komponent kan återanvändas mot olika endpoints (admin vs. kundportal).

**Why:** Task #854 krävde att portalkalendern (separat downstream-task) kan bädda in exakt samma vy
utan att duplicera vy-logiken.

**How to apply:**
- För portalvarianten: rendera `<ObjectTimeline>` med en `fetchTimeline` som anropar portal-endpointen
  (objekt-scopad, portal-auth) i stället för `/api/objects/:id/timeline`. Allt UI/zoom följer med gratis.
- Vyerna `YearView`/`QuarterView`/`MonthView` i `weekplanner/` är objekt-agnostiska och återanvänds direkt
  (skicka `jobConflicts={}`, `timeRestrictions={[]}`). Day/Week-vyerna i WeekPlanner är resurs-grid-baserade
  och återanvänds INTE — ObjectTimeline har egna list-baserade vecka/dag-vyer.
- Hämtning sker per kalenderår (± 7 dagar för randveckor); queryKey innehåller året så zoom mellan nivåer
  inte triggar refetch förrän året byts. Stödjer uppgifter flera år framåt via prev/next-navigering.

Backend: `storage.getObjectSubtreeTimeline(tenantId, rootObjectId, start, end)` resolvar subträdet via
rekursiv CTE på `parent_id` (self + ättlingar, tenant-scopat, exkl. soft-deleted) och returnerar
schemalagda `work_orders` i intervallet. Route: `GET /api/objects/:id/timeline?startDate&endDate`.
