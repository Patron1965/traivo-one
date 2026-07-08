# Arbetsmodell för Replit

**Spelbok för nya bygg och "version 2"**

Den här mallen är ett *arbetssätt* — inte en manual. Följ den varje gång ni startar något nytt i Replit, eller när ni bygger nästa version av ett befintligt system. Målet är enkelt: jämnare resultat, färre överraskningar och mindre av känslan "varför gjorde den inte som jag sa?".

Mallen är skriven för icke-tekniker. Du behöver inte kunna koda för att använda den. Den blandar korta checklistor (att bocka av) med förklaringar och konkreta exempel. Sista sidan är en "bocka av"-lista du kan skriva ut och fylla i för varje nytt bygge.

> **Grundinsikt:** Replit-agenten är en mycket duktig medarbetare som gör exakt det du ber om — men bara det du faktiskt beskriver. Ju tydligare du är om *målet* och om *vad "klart" betyder*, desto bättre blir resultatet. Otydlighet är den vanligaste orsaken till att det "blir fel".

---

## De 6 grundreglerna (sammanfattning)

1. **Ett mål i taget.** Beskriv en sak du vill ha — inte tio i samma andetag.
2. **Säg vad "klart" betyder.** Vad ska du kunna se och göra när det funkar?
3. **Planera först, bygg sen.** Låt agenten föreslå en plan innan den börjar bygga.
4. **Bygg i små steg och testa varje steg.** Stapla inte ihop en massa innan du kollar.
5. **När något strular — beskriv exakt vad du gjorde och vad du såg.** Gärna med skärmbild.
6. **Var försiktig med det farliga.** Radera aldrig data i affekt; använd återställning (checkpoints).

> Om du bara minns en sak: **beskriv målet och "klart", en sak i taget, och testa direkt.**

---

## 1. Förberedelse — innan du skriver en enda instruktion

De bästa byggena börjar med 10 minuters tänk, inte med första prompten. Svara på dessa frågor för dig själv (eller skriv ner dem):

- **Vad är målet, i en mening?** T.ex. "Kunder ska kunna boka en tid själva och få en bekräftelse."
- **Vem är det för?** Vilka användare/roller? Vad ska de kunna göra?
- **Vad betyder "klart"?** Beskriv vad du ska kunna *se och göra* när det fungerar.
- **Vad måste finnas i version 1, och vad kan vänta?** Dela upp i "måste ha" och "kan komma senare".
- **Vilka tillgångar har jag?** Logga, färger, typsnitt, exempelbilder, exempeldata, en text som visar tonen.

> **Tips:** Ha allt material (logga, färger, exempel) redo *innan* du börjar. Då slipper agenten gissa, och du slipper göra om.

**Checklista — förberedelse**

- [ ] Målet nedskrivet i en mening
- [ ] Vem det är för och vad de ska kunna göra
- [ ] "Klart betyder…" beskrivet i vad man ser och gör
- [ ] Uppdelat i "måste ha nu" och "kan vänta"
- [ ] Tillgångar samlade (logga, färger, typsnitt, exempel)

---

## 2. Beskriv tydligt vad du vill ha byggt

Agenten läser din text bokstavligt. Var konkret, ge exempel, och säg gärna vad du *inte* vill ha.

| Gör så här | Undvik |
|---|---|
| "Lägg till en knapp **'Boka tid'** överst till höger som öppnar ett bokningsformulär." | "Fixa bokningen." |
| "Listan ska visa **namn, datum och status** — inget mer." | "Visa lite info om varje order." |
| "Använd våra färger: mörkblå `#1B4B6B` som huvudfärg." | "Gör det snyggt." |
| "Det ska **inte** gå att radera en kund som har öppna ordrar." | (glömmer säga vad som inte får hända) |
| Bifogar en **skärmbild** och pekar: "Rutan här är för stor." | "Något ser konstigt ut." |

**Fem saker som gör en instruktion bra:**

1. **Ett mål per förfrågan** — dela upp stora idéer i flera meddelanden.
2. **Var konkret** — namn, antal, exakt var på sidan, vilka fält.
3. **Ge ett exempel** — "ungefär som X" eller en skärmbild säger mer än en paragraf.
4. **Säg vad du INTE vill** — det förhindrar att agenten bygger något oväntat.
5. **Förklara varför** — kontext hjälper agenten att välja rätt när något är otydligt.

> **Skärmbild slår tusen ord.** Ta en bild, och skriv vad i bilden du menar ("den stora rutan till vänster").

**Checklista — beskriv tydligt**

- [ ] En sak i taget
- [ ] Konkret: var, vilka fält, hur många
- [ ] Ett exempel eller en skärmbild bifogad
- [ ] Sagt vad som INTE ska hända
- [ ] Kort "varför" med

---

## 3. Planera innan du bygger

För allt som är större än en enkel ändring: be om en **plan först**, godkänn den, och låt sedan bygget börja. Det är här ni sparar mest tid.

- **Använd planeringsläget** (Plan) för större idéer. Då tänker agenten igenom upplägget och delar upp arbetet i tydliga uppgifter — utan att ändra något ännu.
- **Läs planen och godkänn den** innan bygget startar. Hittar du något som saknas, säg det nu — det är billigare än att göra om efteråt.
- **En funktion i taget.** Låt uppgifter bygga på varandra i rätt ordning i stället för allt på en gång.
- **Var inte rädd att säga "vänta".** Om planen inte känns rätt, be om en annan variant.

> **Tumregel:** Liten och tydlig ändring → be direkt. Stort, oklart eller "känns riskabelt" → be om en plan först.

**Checklista — planering**

- [ ] Bett om en plan för större arbeten
- [ ] Läst planen och lagt till det som saknades
- [ ] Godkänt planen innan bygget
- [ ] Delat upp i en funktion/uppgift i taget

---

## 4. Bygg i små steg och verifiera

Den vanligaste fällan är att be om tio saker, aldrig testa, och sedan inte veta vad som gick sönder.

- **Bygg stegvis.** En bit klar och testad, sedan nästa.
- **Testa varje steg** innan du går vidare. Klicka igenom det själv.
- **Stapla inte ihop** många ändringar innan du kollar — då är det svårt att veta vad som orsakade ett fel.
- **Be agenten visa/testa** resultatet ("kan du testa att bokningen funkar hela vägen?").

> **Varför?** När allt testas i små steg är ett fel lätt att hitta och rätta. När tio ändringar staplats på hög blir felsökning en gissningslek.

**Checklista — bygg i steg**

- [ ] En bit i taget
- [ ] Testat innan nästa steg
- [ ] Klickat igenom själv
- [ ] Bett agenten testa hela flödet

---

## 5. Varför det ibland "inte gör som du säger"

Det här är helt normalt — och sällan ett tecken på att ni gör fel. Här är de vanligaste orsakerna och vad du gör åt dem:

| Vad du upplever | Vanlig orsak | Vad du gör |
|---|---|---|
| "Ändringen syns inte" | Webbläsaren visar en **gammal, sparad version** (cache) | **Hård omladdning:** Cmd+Shift+R (Mac) / Ctrl+Shift+R (Windows), eller öppna i inkognito-fönster |
| "En liten ändring ställde till mycket" | Ändringen rörde en del som **hänger ihop med andra delar** | Be agenten kolla helheten och testa det som hänger ihop |
| "Den byggde fel sak" | Instruktionen var **otydlig** → agenten gissade | Var mer konkret; ge exempel/skärmbild; säg vad du inte ville ha |
| "Funktionen mot [tjänst] funkar inte" | En **nyckel/inställning saknas** (t.ex. till en extern tjänst) | Fråga agenten vad som saknas; lägg nyckeln i "Secrets" (aldrig i chatten) |
| "Det är segt eller kraschar ibland" | En **extern tjänst** är nere eller långsam | Ofta inte ert fel — vänta och försök igen; be agenten lägga in tydliga felmeddelanden |
| "Småsaker strular i vårt stora system" | Nya ändringar **krockar med gammal logik** | Planera först, bygg i steg, testa — och nämn om något är känsligt |

> **Viktigt att veta:** "Ibland funkar allt direkt, ibland strular en liten sak" är den normala verkligheten i mjukvara. Det betyder inte att ni gör fel — det betyder att systemet är stort och saker hänger ihop. Arbetssättet i den här mallen är just till för att minska strulet.

**Checklista — när det strular**

- [ ] Provat hård omladdning (Cmd/Ctrl+Shift+R)
- [ ] Testat i inkognito-fönster
- [ ] Beskrivit exakt vad du gjorde och vad du såg
- [ ] Frågat om något (nyckel/inställning) saknas

---

## 6. Testa och verifiera att det faktiskt funkar

"Klart" betyder att det funkar på riktigt — inte bara att koden är skriven.

- **Be agenten testa** hela flödet, inte bara en del.
- **Testa på riktig data** eller ett realistiskt exempel, inte bara ett tomt fall.
- **Klicka igenom själv** som en riktig användare skulle göra.
- **Kolla kanterna:** vad händer om ett fält är tomt, om man klickar två gånger, om något saknas?

**Checklista — verifiering**

- [ ] Hela flödet testat från start till mål
- [ ] Provat med realistisk data
- [ ] Klickat igenom själv
- [ ] Provat ett "vad händer om"-fall (tomt/fel/dubbelklick)

---

## 7. Säkerhet och backup

- **Checkpoints är dina sparpunkter.** Replit sparar automatiskt lägen du kan **återställa** till. Går något rejält snett — återställ till senaste läget som fungerade.
- **Radera aldrig data lättvindigt.** Be om en bekräftelse eller en säkerhetskopia innan något raderas. Data som försvinner är svår att få tillbaka.
- **Håll hemligheter hemliga.** Lösenord och API-nycklar läggs i "Secrets" — **aldrig** klistrade i chatten eller i vanlig text.
- **Testa i utveckling innan du publicerar.** Det du ser medan ni bygger är inte automatiskt det kunderna ser — publicering är ett eget, medvetet steg.

> **Trygghetsregel:** Innan något stort eller oåterkalleligt (radering, byte av databas, stor ombyggnad) — fråga agenten "vad är riskerna och kan vi återställa om det blir fel?".

**Checklista — säkerhet**

- [ ] Vet hur man återställer till en tidigare checkpoint
- [ ] Ingen radering utan bekräftelse/kopia
- [ ] Nycklar/lösenord i "Secrets", inte i chatten
- [ ] Testat i utveckling före publicering

---

## 8. När något går fel — rapportera så att det går snabbt att lösa

Ju bättre du beskriver felet, desto snabbare löser agenten det. Använd den här lilla mallen:

| Del | Vad du skriver |
|---|---|
| **Vad jag gjorde** | "Jag klickade på 'Boka tid' och fyllde i namn och datum." |
| **Vad jag förväntade** | "En bekräftelse skulle visas." |
| **Vad som hände** | "Sidan blev vit och inget hände." |
| **Skärmbild** | (bifoga bild om möjligt) |
| **När / var** | "Nyss, på bokningssidan, i Chrome på Mac." |

**Gör så här:**

- **Ge agenten en sak att lösa i taget** — hopa inte på nya önskemål mitt i en felsökning.
- **Be om en förklaring i klarspråk** om du vill förstå vad som var fel: "kan du förklara enkelt vad som orsakade det?".
- **Bekräfta när det är löst** genom att testa själv.

| Bra felrapport | Svårt att jobba med |
|---|---|
| "På bokningssidan: klickade 'Spara', fick felmeddelandet 'kunde inte spara'. Skärmbild bifogad." | "Det funkar inte." |

**Checklista — felrapport**

- [ ] Vad jag gjorde / förväntade / vad som hände
- [ ] Skärmbild bifogad
- [ ] En sak i taget (inte nya önskemål mitt i)
- [ ] Testat själv att det är löst

---

## 9. "Version 2" och migrering från nuvarande system

Att bygga nästa version är ett eget projekt — planera det som ett sådant.

- **Behålla eller bygga om?** Bestäm medvetet, del för del. Ofta är det bäst att *behålla det som fungerar* och bygga om det som skaver.
- **Dokumentera nuvarande system först.** Vad finns idag? Vad är viktigast? Vad får absolut inte gå sönder? (Skriv en lista.)
- **Migrera data varsamt.** Testa med en **kopia** av datan först. Rör aldrig skarp data förrän flödet är bevisat.
- **Kör parallellt.** Låt gamla och nya leva sida vid sida tills nya versionen är beprövad — byt först när ni litar på den.
- **Lista "det här får INTE gå sönder"** och testa just de sakerna extra noga.

**Checklista — version 2 / migrering**

- [ ] Beslut taget: behålla vs bygga om (del för del)
- [ ] Nuvarande system dokumenterat
- [ ] "Får inte gå sönder"-lista skriven
- [ ] Data testad på en kopia först
- [ ] Plan för att köra gammalt och nytt parallellt

---

## Bocka av — checklista för varje nytt bygge

*Skriv ut den här sidan och fyll i den innan ni startar ett nytt bygge eller en ny version.*

**Projekt / funktion:** ______________________________________________

**Datum:** ________________   **Ansvarig:** ________________________

**Innan vi börjar**

- [ ] Mål i en mening: _________________________________________
- [ ] Vem det är för: __________________________________________
- [ ] "Klart betyder" (vad man ser och gör): ____________________
- [ ] Måste ha nu vs kan vänta är uppdelat
- [ ] Tillgångar klara (logga, färger, typsnitt, exempel)

**Under bygget**

- [ ] Bett om en plan och godkänt den (för större arbeten)
- [ ] En sak i taget, konkret beskriven
- [ ] Byggt i små steg och testat varje steg
- [ ] Klickat igenom själv med realistisk data

**Trygghet**

- [ ] Vet hur vi återställer (checkpoint) om något går fel
- [ ] Ingen radering utan kopia/bekräftelse
- [ ] Nycklar/lösenord i "Secrets"
- [ ] Testat i utveckling före publicering

**När något strular**

- [ ] Provat hård omladdning / inkognito
- [ ] Skrivit: vad jag gjorde / förväntade / vad som hände + skärmbild
- [ ] En sak i taget till agenten

---

*Arbetsmodell för Replit — internt arbetssätt. Uppdatera mallen när ni lär er något nytt som fungerar bra.*
