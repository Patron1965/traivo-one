# Testlista – End-to-end-test Traivo

**Till:** Mats
**Datum:** 2026-06-24

Följ stegen i ordning. Varje steg har en kontrollpunkt (*Förväntat*). Läs "Tre saker att veta" sist innan du börjar.

---

## Förberedelse
- Logga in i webben med en planerar-/admin-roll.
- Ha en separat enhet eller flik redo för förarappen (Traivo Go).
- Kund-import från Fortnox via API finns **inte** – kunder läggs upp manuellt eller via fil i detta test.

---

## 1. Tanka in objekt
- Importera objektfil för **Axfood** (objektmall-import).
- Importera objektfil för **Svenska Bostäder**.
- *Förväntat:* objekt skapas med adress + metadata, kolumnerna mappas automatiskt.

## 2. Komplettera via ut- och intankning
- Tanka **ut** objektlistan i mall-format (update-läge, så systemnumret följer med).
- Redigera filen: ändra antal kärl, lägg till kontaktperson, justera metadata.
- Tanka **in** filen igen.
- *Förväntat:* befintliga objekt uppdateras (inte dubbletter).
- *OBS:* ett helt **nytt** metadatafält måste först skapas i Metadata-inställningar innan det kan tankas in.

## 3. Kontrollera metadatafält
- Verifiera att antal kärl (numeriskt), kontaktperson (namn/telefon) och övriga fält ligger rätt på objekten.

## 4. Kunder + kundunik prislista
- Skapa kund manuellt under **Kunder → Ny kund**.
- Koppla en **kundunik prislista** och justera ett artikelpris för just den kunden.
- *Förväntat:* priset slår igenom för kunden (kundunikt pris > generellt).

## 5. Artiklar
- Skapa/kontrollera artiklar (generell + kundunik) som matchar objekt via metadata (t.ex. fält för antal pantkärl).
- Säkerställ att antals-artikeln är **metadata-driven** (per styck / matchar fält) – det krävs för att kunna rätta antalet i appen senare.

## 6. Orderkoncept
- Skapa ett orderkoncept per kärltyp.
- Peka in på **objekt/grenar** i objektträdet (välj en förälder så hakar underliggande objekt på).
- *Förväntat:* live matchad-räkning + ordervärde visas i wizarden.
- *OBS:* "kluster" finns inte längre – inpekningen sker på objektträdet, samma effekt.

## 7. Verifiera antal-expansion
- Öppna ett objekt med t.ex. 10 kärl.
- *Förväntat:* **1 uppgift med antal 10** (pris/tid skalas ×10) – inte 10 separata uppgifter.

## 8. Återkommande tvättar
- För tvättar som ska återkomma (t.ex. varannan månad): använd **schema-metoden** (genererar återkommande uppgifter).
- *OBS:* "abonnemang"-metoden ger återkommande **fakturor**, inte fältuppgifter. Olika intervall = separata koncept.

## 9. Grovplanering
- Markera uppgifter, kontrollera klumpning (geo + utförandekod + tidsfönster), rankning och produktionstimmar mot mål.
- Skicka markerade till finplanering.

## 10. Finplanering
- Lägg in utförarens egentid/frånvaro.
- Kör auto-fyll/ruttoptimering (depå/hemposition, t.ex. Tullinge som start/slut).
- *Förväntat:* veckan fylls, rutten respekterar ledig kapacitet.

## 11. Förarappen (Traivo Go)
- Öppna veckovyn som förare, slå på rutt-läge.
- *Förväntat:* uppgifter i rätt ordning; uppgifter på samma adress klumpas ("Åk till X, N uppgifter").

## 12. Mobilt utförande
- Öppna en uppgift. På kortet **"Beställda artiklar"**: rätta antalet på den metadata-drivna artikeln (t.ex. ändra 10 → 8) och spara.
- *Förväntat:* antalet uppdateras på både uppgiften och objektets metadata.
- Lägg till foto + fyll i övrig metadata.
- Slutför och klarmarkera uppgiften.
- *OBS:* artiklar med **fast antal** visas som "Fast antal" (ej redigerbart) – det är meningen.

## 13. Fakturakö, sperr och samlingsfaktura
- Kontrollera att slutförd uppgift hamnar i fakturakön enligt policy (omedelbar/dag/vecka/månad).
- För Svenska Bostäder: verifiera att flera uppgifter samlas till **en samlingsfaktura** per mottagare.

## 14. Fortnox-export
- Exportera till Fortnox.
- *Förväntat:* varje uppgift blir en rad, fakturamottagare i toppen, fryst pris används. Kontrollera kostnadsställe/metadata på raderna.

---

## Tre saker att veta innan testet
1. 10 kärl = 1 uppgift med antal 10 (inte 10 uppgifter).
2. Antal-rättning i appen funkar för metadata-drivna artiklar (fast antal är låst).
3. Fortnox kund-import via API saknas – lägg upp kunder manuellt eller via fil.
