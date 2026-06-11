---
name: Orderkoncept metadata-pekarfält & värde-coercion
description: order_concepts *MetadataField-kolumner matchar metadata_katalog.namn; coercion till Date/number måste typsäkras.
---

Orderkonceptet har flera "metadata-pekar"-kolumner (customerMetadataField,
subscriptionMetadataField, departmentMetadataField, deliveryTimeMetadataField).
Värdet i kolumnen är ett `metadata_katalog.namn` (den immutabla universella nyckeln),
INTE ett fieldKey/id. Vid expansion slås objektets värde upp via
`getArticleMetadataForObject(objektId, namn, tenantId)` — ärvningsmedvetet, tenant-scoped.

Mönstret "kolumn satt = läge på" gäller (ingen separat enum/flagga): icke-tom kolumn
⇒ härled värdet från metadata, annars befintligt beteende. Koncept POST/PATCH sprider
`req.body` rakt in i storage ⇒ nya pekar-kolumner round-trippar utan whitelist-ändring.

**Regel:** `getArticleMetadataForObject` returnerar `.value` = första icke-null av
vardeString/Integer/Decimal/Boolean/Datetime/Json/Referens. Coercion av detta värde
till en typ (Date, number, …) MÅSTE typsäkras innan användning.

**Why:** Om en användare pekar fältet mot fel metadatatyp (t.ex. ett numeriskt fält)
ger `new Date(43)` tyst epoch-skräp (1970-01-01). `parseDeliveryDate` (fortnoxRoutes)
löser detta genom att ENBART acceptera Date-instanser (NaN-kollade) och datum/datetime-
strängar, och avvisa nummer/boolean → null ⇒ fallback.

**How to apply:** Vid varje nytt metadata-pekarfält som tolkar värdet till en typ:
typguarda i en ren helper, wrappa uppslaget i try/catch (kasta aldrig mitt i expansion),
fall tillbaka tyst (console.warn + valfri svarsräknare). Stämpla bara faktiska resultat-
kolumner; rör inte single-resolution-vägen för koncept utan fältet (regression-skydd).
