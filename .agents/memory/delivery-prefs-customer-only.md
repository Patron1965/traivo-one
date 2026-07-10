---
name: Leveranspreferenser enbart kundnivå
description: Objekt-egna leveranspreferenser är borttagna; tidsmotorn läser kundens prefs via objektets primära kund, genom storage-metoder för mockbarhet.
---

Regel: `deliveryPreferences` finns ENDAST på `customers` (objects-kolumnen och `object_time_restrictions` togs bort i objektmodell-rensningen). Tidsmotorn (`resolveDeliveryPrefsByObject` i time-geo-engine) härleder prefs per objekt via objektets primära kund.

**Why:** Etapp 5 rensade hela objekt-specialmodellen utan back-compat; blockerade datum/fönster måste ändå fortsätta styra oschemaläggbarhet, annars förloras kundens leveransfönster tyst.

**How to apply:** Läs kund-prefs via `storage.getObjectsPrimaryCustomerIds()` + `storage.getCustomersDeliveryPreferences()` (rå JSONB, validera med `deliveryPreferencesSchema`). Gå via storage — inte direkta db/helpers — så att motor-unit-tester kan mocka hela kedjan. Iterera aldrig `Map` direkt i for-of (tsc TS2802, target-begränsning) — använd `Array.from(map.entries())`.
