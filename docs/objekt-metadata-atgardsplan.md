# Objekt & Metadata – analys och åtgärdsplan

_Underlag: produktägargenomgång (inspelning 2026-07-02, "Hönshuset"-exemplet), ADR v3 (objekt-neutralitet, metadata-livscykel), informationspaketet (`shared/metadata-areas.ts`, `server/services/object-info-package-tree.ts`) samt nuvarande kod i `client/src/pages/ObjectDetailPage.tsx` + `server/services/object-system-metadata.ts`._

Detta dokument är en **plan, ingen kodändring**. Syftet är att visa att jag förstått rätt innan objektdelen byggs om.

---

## 1. Så här uppfattar jag modellen (grundprincipen)

**Ett objekt har bara ett fåtal äkta grunddatafält. Allt annat är metadata.**

- **Grunddata (kärna) på ett objekt:**
  - Objektnummer (systemets nummer)
  - Objektnamn
  - Status: **aktiv / arkiverad** (arkivering = soft-delete, inte en metadata-status)
  - Släktnamn (hierarkiskt visningsnamn, så man kan skilja hundratals "Återvinningsrum" åt)
  - Relationer: förälder(-rar) uppåt och barn nedåt

- **Objektet är neutralt (ADR v3):** det finns ingen "kund" i objektvärlden. Koppling till kund sker via order/`object_payers`, inte som ett fält på objektet. Det finns heller ingen "objektnivå/hierarkinivå" att visa – den är avvecklad.

- **Metadata = allt övrigt, och visas bara "i det förekommande fall" (om det finns ett värde).** Metadata är:
  - **Aktiverad/associerad** på objektet (t.ex. färg på kärl, skostorlek på kontaktperson, fraktion, antal kärl, adress).
  - **Grupperad i områden** (geografi, kontaktinformation, produktion, tillgång, …).
  - **Sammansatt när det behövs** (t.ex. "Adress" är en grupp: gataadress + postnummer + postort).
  - **Ärvd nedåt** från förälder (t.ex. återvinningsrummet ärver adress från förälder) och ska då märkas "ärvd från X".
  - **Loggad per fält:** senast ändrad, av vem, datum, och vilket år-/orderkoncept värdet härstammar från (klickbart tillbaka till konceptet).

- **Två sorters "system"-fält (viktig distinktion):**
  1. **Systemskapade metadatafält-definitioner** – standarduppsättningen som systemet självt lägger upp och som är **låsta** (kan inte raderas/ändras av användaren, märks "systemskapat"). Värdena fylls i, men själva fältet ägs av systemet. Ex: geografi-klumpen, kontaktinformation (namn/titel/telefon/e-post som systemmandat).
  2. **Systemgenererade/härledda värden** – räknas fram vid läsning, aldrig lagrade eller påhittade: adress/position, inpekade orderkoncept, kopplade uppgifter (historik + kommande), bilder, felanmälningar, betyg.

- **Två sätt att skapa/uppdatera objekt (båda måste fungera):**
  1. Tanka in en lista (interimnummer-import).
  2. Skapa/editera manuellt.
  I båda fallen måste man kunna ange **förälder** och i editläge justera/lägga till **barn** (t.ex. lägga en enskild soptunna i ett återvinningsrum, eller ett fönster som ska putsas).

---

## 2. Vad som är fel i nuvarande objekt-detaljvy (kopplat till dina anmärkningar)

Kärnproblemet: sidan visar två parallella datamodeller samtidigt. En **gammal uppsättning hårdkodade kolumn-sektioner** ("Grundinformation", "Kund & Service", "Adress", "Tillgång", "Utrustning & Behållare") renderas som om de vore sanning – **parallellt** med den nya metadata-modellen. Det är detta som ger "allt är metadata / påhittade fält / skräp".

Konkret:

| Din anmärkning | Orsak i koden idag |
|---|---|
| **"Utrustning skick god" – vi har inget metadatafält 'skick'** | `objects.condition` är en hårdkodad kolumn med default `"good"`, renderas som fast rad i sektionen "Utrustning & Behållare". Ingen sätter den – den är alltså fabricerad. |
| **"Det finns ingen objektnivå. Det är metadata. Ska inte stå där."** | "Hierarkinivå/objektnivå" renderas i Grundinformation och i föräldrakedjans badges. Ska bort (avvecklad enligt ADR v3). |
| **"Kund finns inte i objektvärlden."** | Sektionen "Kund & Service" visar kund på objektet. Strider mot objekt-neutralitet – ska bort ur objektvyn. |
| **"Allt är metadata / det ska grupperas + översikt."** | Adress, tillgång, utrustning m.m. visas som fasta kolumn-sektioner, inte som grupperad metadata som visas endast när värde finns. |
| **"Jävla skit som leveranspreferenser / privatjet mjukt."** | `DeliveryPreferencesEditor` renderas i metadata-området. Ska bort – finns inte i konceptet. |
| **"Föräldrakedjan – kan man lägga till förälder? Nej."** | Föräldrakedjan är en read-only breadcrumb. Redigering finns i `ObjectParentsManager` men är inte den ruta man klickar på överst. Behöver en tydlig förälder/barn-ruta högst upp där man både ser och uppdaterar. |
| **"Ingen släktnamn."** | Släktnamn beräknas (`computeObjectDisplayNames`) men visas inte tydligt i vyn/sökningen. |
| **"Vid skapande kom det upp kund istället för objektsök."** | Förälder-väljaren i skapa-läget hänger på `customerId`; utan kund fungerar objektsöket dåligt/fel. Ska vara ett rent **objektsök** (tvåstegs, med släktnamn). |
| **"Systemet har någon egen geografi."** | Härledd adress/position blandas med hårdkodade adресskolumner utan tydlig "ärvd/härledd"-märkning, vilket ser ut som påhittad data. |
| **Sorteringspilar per objekt** | Ad-hoc upp/ner-pilar per metadatarad. Ordningen ska styras centralt i metadatakatalogen – pilarna ska bort. |
| **"Konstigt uppdelat i Admin och Grunddata."** | Metadata nås från två menyer. Mindre UX-städ. |

**Viktig arkitektnot:** de hårdkodade kolumnerna (adress, koordinater, portkod/nyckel, behållarantal, condition …) kan **inte bara raderas** – de används av ruttning/VRP, mobil, Fortnox m.m. Städningen görs därför i första hand som en **visnings-/presentationsomskrivning** (expand-contract): vyn slutar visa dem som fast "sanning" och presenterar dem via metadata-/systemgenererad-modellen. Själva kolumn→metadata-migreringen är ett större, separat spår.

---

## 3. Åtgärdsplan (faser)

### Fas 1 – Rensa objekt-detaljvyn (visning, låg risk)
1. Reducera grunddata överst till: objektnummer, objektnamn, status (aktiv/arkiverad), släktnamn.
2. Ta bort ur vyn: hierarkinivå/objektnivå, "Kund & Service", leveranspreferenser, sorteringspilar per rad, samt fabricerade default-fält (t.ex. Skick=god).
3. Rendera aldrig en hårdkodad kolumn-sektion som fast sanning – visa fält **endast om värde finns**; inga tomma sektioner.

### Fas 2 – Metadata-presentation enligt gängse praxis
1. Gruppera metadata per område; visa bara grupper som har värden.
2. Enkel tabellform: **område → fält → värde**. Sammansatta fält (adress) som indenterad subtabell (gataadress: Storgatan 1 / postnummer: 86500 / postort: Sundsvall).
3. Per-fält kompakt logg: senast ändrad + användare + datum + år-/orderkoncept (klickbart), samt källa/arv-badge ("ärvd från Återvinningsrum 1").
4. Fältordning styrs av metadatakatalogen (ta bort ad-hoc-pilarna).

### Fas 3 – Systemskapade / systemgenererade fält
1. Fastställ och lista de **systemskapade** standard-definitionerna (geografi, kontaktinformation, produktion, tillgång m.fl.) utifrån informationspaketet.
2. Visa dem i egna "systemskapade" grupper, **låsta** (read-only, ej radera/ändra), tydligt märkta.
3. Systemgenererade/härledda värden (adress/position, inpekade koncept, uppgifter, bilder, felanmälan, betyg) visas read-only och **aldrig fabricerade** – bara riktiga kolumner/relationer/live-compute.

### Fas 4 – Föräldrar/barn + skapa-flöde
1. Förälder/barn-ruta högst upp: se **och** lägg till/välj förälder(-rar) (multi-parent), symmetriskt för barn.
2. Skapa/redigera: förälder-väljaren söker **objekt** (inte kund), tvåstegssök, visar släktnamn för att särskilja.
3. Säkerställ att både import (interimlista) och manuellt skapande stödjer förälder + barn-editering.

### Fas 5 – Katalog, historik, bilder/filer (senare, mer risk)
1. Historik av gamla värden per metadatafält (`metadata_historik`) – bläddringsbar.
2. Katalog-fält (välj ur en uppsättning värden) där det är tillåtet (geografi är **inte** katalog).
3. Bilder/filer som bläddringsbart galleri med följande logg (à la annonstjänsters "bild 1 av 5").

---

## 4. Vad jag behöver bekräftat innan bygge (Fas 1–2)

1. **Mockup/referensbilder:** för att träffa exakt tabell-layout vill jag utgå från dina referensbilder – bekräfta vilken uppsättning som är den gällande.
2. **Prioritet:** börjar vi med Fas 1 (rensa vyn) + Fas 2 (grupperad metadata) som ett första leverabelt steg?
3. **Grunddata-omfång:** är listan i avsnitt 1 (nummer, namn, status, släktnamn, förälder/barn) den kompletta äkta grunddatan – eller ska något mer ligga kvar som kärna?
