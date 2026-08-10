---
name: Grovplanering typ-källor (artikeltyp/utförandekod)
description: Uppgiftstyp-registret (task_types) är avvecklat; typ-filter/kolumner drivs av utförandekods- och artikeltypregistren med artikelhärledning.
---

# Beslut: Uppgiftstyp → Artikeltyp + Utförandekod

Legacy-registret `task_types` är avvecklat ur UI/API och får inte återinföras för
nya konsumenter (tabellen kvar tills gamla rader omklassats — expand-contract).

**Why:** BÖK/RBK är utförandekoder, Service/Tvätt artikeltyper — legacy-registret
blandade begreppen och saknade artikelkoppling. Beslutad modell håller Utförandekod
(vem/kompetens), Artikeltyp (vilken tjänst) och Uppgiftsstatus (deriveUppgiftStatus)
strikt isär.

**How to apply:**
- Typ för en uppgift härleds från artikelkopplingen; fritext-heuristiken är ENBART
  markerad legacy-fallback för rader utan artikel — bygg aldrig ny logik på den.
- Gamla `taskTypes`-filter/nycklar: stöd endast som tyst server-back-compat;
  användarvända ytor migrerar eller rapporterar öppet, aldrig tyst tom filtrering.
- Korrelerade artikel-lookups måste tenant-scopeas mot arbetsorderns tenant.
- Tenant-rename-migrationen kräver kollisionsprune för tabeller med unikt (tenant, key).
