---
name: Kluster & hierarkinivå avvecklade i UI (ADR v3)
description: Cluster + hierarchy-level concepts removed from UI, but DB columns and backend plumbing intentionally retained (expand-contract).
---

Per ADR v3 (objekt-neutralitet) är kluster, hierarkinivå, snöret-flödet, dynamiska
kluster-regler och direkt kund-objekt-koppling **avvecklade som UI-begrepp**, men
**inte** som schema/backend.

**Vad som tagits bort (UI/logik):**
- Snöret-pipeline-komponent (raderad).
- Hierarkinivå som redigerbart fält + som filter (ObjectDetail edit-form, ObjectsPage-filter).
- Dynamiska kluster: regel-tab i UI + automatisk om-tilldelning. `evaluateAllDynamicClusters`/`evaluateDynamicCluster` anropas inte längre; `POST /api/clusters/:id/apply-dynamic-rules` returnerar avvecklat-fel.
- Kluster i huvudnavigation + command palette + Kluster-ID/Kund-ID InfoRows på objektsidan.
- Kund-sidans kluster-kolumn (stat-kort, sorterbar kolumn), objektvyns "Härled hierarkinivåer"-knapp och batch-geokodningens kluster-filter.
- "Snöret" som **term** i snabb-wizarden — omdöpt till neutral "Schemalägg direkt"; själva direkt-schemaläggningen (PATCH WO resourceId/scheduledDate) är legit funktion och **behålls** (bara namnet/metaforen var det avvecklade begreppet).

**Vad som AVSIKTLIGT behållits (back-compat + uttryckligt användarbeslut):**
- `objects.clusterId`, `objects.hierarchyLevel`, `objects.customerId`-kolumner (nullable/default).
- Backend-plumbing som läser clusterId: WeekPlanner-scope, `buildTeamVehicles()` fallback (cluster.centerLat/Lng), optimization-routes, SLA-risk. `dynamic-clusters.ts` finns kvar men har inga anropare.
- `/clusters`-routes i App.tsx (undviker döda länkar från kvarvarande referenser).
- **HierarkiNIVÅ-ytan i ObjectsPage (filter, nivå-kolumn som dessutom är STANDARDSORTERING, nivå-badges per objekt, bulk "Sätt nivå") OCH snabb-wizardens "Kluster"-kopplingsval** — dessa är INTE oavslutad avveckling: användaren bad uttryckligen (juni 2026) att stanna vid de namngivna ytorna och behålla dessa. Ta inte bort dem i en framtida "slutför avvecklingen"-ansats utan nytt godkännande.

**Why:** Expand-contract — inga destruktiva schema-ändringar; mobile/VRP/Fortnox/geocoding
får inte gå sönder. Nytt UI (träd/lista/form/nav) byggs i separata downstream-tasks.

**How to apply:** Skriv aldrig ny UI-logik som exponerar kluster/hierarkinivå som
användarvänt fält. Lägg inte till nya anropare av dynamic-clusters. Behåll DB-kolumnerna.
