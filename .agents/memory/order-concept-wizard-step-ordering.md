---
name: Orderkoncept-wizard stegordning är numeriskt kodad på många ställen
description: Reordering the order-concept wizard requires updating every numeric currentStep branch in lockstep AND version-gating persisted drafts.
---

# Orderkoncept-wizard stegordning

Wizard-steget identifieras av ett numeriskt `currentStep` (1..N) i `client/src/pages/OrderConceptWizardPage.tsx`. Att ändra stegordningen kräver att ALLA dessa hålls i synk — det räcker INTE att bara ändra `STEPS`-arrayen:

- `STEPS` array (ordning + labels)
- `stepFieldsToValidate` (vilka form-fält valideras per steg)
- `getStepStatus(stepNum)` switch (warning/complete-ikoner i sidebar)
- `validateCurrentStep()` switch (blockerar Nästa)
- `saveStepMutation` — `if (step === N)`-grenar (t.ex. villkorsfilter sparas i objektvals-/inpekningssteget)
- create-concept-grinden i `handleNext` — konceptet skapas när man lämnar det FÖRSTA steget, och filter sparas i samma steg, så det steg som äger filter MÅSTE vara steg 1 (annars saknas conceptId när filter ska persisteras)
- render-switchen (`currentStep === N && <StepX .../>`)
- header-namnfältets highlight

**Why:** Det finns ingen TS-switch som täcker alla numeriska grenar, så en glömd gren ger tyst fel-scope (samma klass av bugg som WeekPlanner ViewMode-fanout).

## Persisterade utkast måste versions-gate:as

`currentStep` sparas i DB (`order_concepts.current_step`). Gammal och ny numrering delar samma intervall (1..N), så ett utkast sparat innan omordningen kan INTE skiljas från ett nytt utkast utan en versionsmarkör. Lösning som används: en `wizard_step_version`-kolumn (DEFAULT 1 = legacy). Klienten stämplar aktuell version på VARJE `currentStep`-skrivning (create + alla PATCH-vägar) och remappar old→new vid laddning när sparad version < aktuell, samt migrerar raden lazy in-place.

**How to apply:** Vid varje omordning av wizard-steg:
1. Gå igenom alla numeriska grenar ovan punkt för punkt.
2. Bumpa versionskonstanten, lägg till en old→new remap-tabell, stämpla versionen på alla step-skrivningar och remappa vid laddning.
3. Lägg till en idempotent migration för ev. ny kolumn OCH registrera den i post-merge-replaylistan (se schema-drift-replay-noten).
4. Komponentfilnamnen speglar INTE nödvändigtvis stegnumret efter en omordning — gå efter funktion, inte filnamn.
