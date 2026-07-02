# Utvecklingslogg: uppgiftslogik & planeringsmotorer

> **Typ:** Utvecklingslogg / parkeringsplats för framtida bygge. **Ingen kod ändras av detta dokument.**
> **Syfte:** (1) slå fast grunderna så att det *inte finns några frågetecken* kring uppgiftsmodellen, och
> (2) parkera framtida motorer/funktioner (t.ex. vatten-/avfalls-fyllnadsmotorn) så de kan byggas ut i ett senare skede.
> **Källor:** produktägarens genomgång 2026-07-02 (två röst-sessioner + Excel-matrisen "Uppgiftslogik och informationspaket"),
> `docs/uppgiftsmodellen-utredning.md` (Task #1079), ADR v3 (`docs/adr-orderkoncept-v3.md`), minnesfilen `uppgiftslogik-v1-decisions.md`.
> **Relation:** `uppgiftsmodellen-utredning.md` bevisar att informationspaketet redan motsvaras av befintliga system. *Detta* dokument är framåtblickande — bekräftade beslut + deferrat arbete.

---

## 0. Status

- **Uppgiftslogik v1 är byggd, mergad och deployad.** Detta dokument driver **inget** omedelbart bygge.
- Produktägaren avböjde en fullständig kolumn-spec just nu. Det viktiga är att grunderna sitter (§1) och att framtida motorer är parkerade (§4).

---

## 1. Bekräftade grunder (inga frågetecken)

1. **Fyra källor** till en uppgifts informationspaket: **artikel → orderkoncept → objekt-metadata → motor-skapade fält.** *(Bekräftad.)*
2. **Två status-axlar, inte en motsägelse:** *uppgiftsstatus* (faktisk utförandestatus på uppgiften) vs härledd *affärsstatus*. De är oberoende axlar. Utöver detta finns möjligheten att **dölja viss information på affärsdokument** — det är bara ytterligare ett informationsfält i matrisen. *(Bekräftad.)*
3. **Planeringsflödet** och dess koppling till statusar är rätt uppfattat. Grovplaneringsmotorerna + leveranstids-/beroendemotorn skapar mellanstatusar. *(Bekräftad.)*
4. **Allt är uppgifter.** Allt som görs i systemet är uppgifter av olika typer, och **en uppgift byggs upp av en artikel**. Produktion, restid, egentid och över-/underbokning är bara **olika uppgiftstyper med olika utförandekod**. Detta är den bärande principen — systemet ska inte ha parallella spår för "tid" vs "jobb".
5. **En uppgift = en artikel.** Produktionsuppgifter bör så långt möjligt ha *artikelnummer + försäljningspris + vikt/antal + produktionstid* (grunden för offert/faktura). Egentid/restid/personal-uppgifter saknar pris → de blir **rapporter, inte fakturor**.

### Grovplaneringens beräkningsfönster (bekräftad begränsning)
Grovplaneringslistan är **rullande och begränsad** — den får **inte** beräkna flera år framåt (för mycket datakraft). Den ska jobba den närmsta perioden (t.ex. närmaste månaden) med **konfigurerbar** horisont. Omräkning sker antingen periodiskt eller via en **"beräkna"-knapp** (rekalkylera vecka/urval); systemet får själv avgöra lämplig strategi.

---

## 2. Bekräftade beslut i genomgången (mina A–J-punkter)

| # | Punkt | Beslut | När |
|---|---|---|---|
| **A** | **Platskrav** | Uppgifter kan sakna geografiskt krav (administrativa: avisering, kontors-/biljobb). Grundklassning: **har plats / saknar plats** (obligatorisk/valfri/ingen). Egentid är en uppgift som vilken som helst och kan *ibland* ha geo-position (t.ex. helgvila på hemorten). | Grundklassning nära; ytor/linjer = §4 |
| **B** | **Gång-/förflyttningstid fordonsplats → utförandeplats** | Ska **inte** beräknas i uppgiften. Hanteras **operativt** av utförandeappen som **tvåstegs-navigation** (Waze/Google till adressen, appen guidar sista sträckan till fots). | Steg 2 (§4 U4) |
| **C** | **Fordons-/utrustningskrav** | Löses via **utförandekod** på uppgiften (produktionsperspektiv), som del av teamets/utförarens förmåga. Ingen ny modell behövs. | Via befintlig utförandekod |
| **D** | **Glapp → "spilltid"** | "speltid" var felskrivning → **spilltid** (namn ej spikat). Fjärde tidstyp = tid som varken är produktion, restid eller egentid. **Slå ihop överbokning + underbokning till ETT koncept** = ±oplanerade minuter/dag. | Bekräftat krav (§3, §5) |
| **E** | **Leveranstider — INTE en "trio"** | Rätta modellen: en generell leveranstid på uppgiften **+ N tidsfönster** med positiv/negativ tillgänglighet, hårda/mjuka. Negativ = får ej utföras (t.ex. lunch 11–14 alla dagar); positiv = får utföras viss period. Hård = absolut, mjuk = rekommendation. Motorn håller reda på fönstren, kan hoppa framåt stegvis och är en produkt av klumpningsmotorn. | Verifiera mot befintliga `frozenTimeRules` |
| **F** | **Överbokningspolicy / utförandesannolikhet** | Systemet **bokar inte** i v1. Ingen procentuell auto-överbokning, **ingen inlärning från historik**. Planeraren tilldelar jobb (enskilt/i klump); utföraren lägger ut. I grovplanering ser utföraren **endast summan av produktionstid**; ruttoptimering visar om det ryms i 40h-veckan. | Auto-/AI-bokning = §4 U5 |
| **G** | **Ej-utförd / åter till grovplanering** | **Systemskapad metadata på objektet** med orsak + varifrån + tidpunkt. *Status* är ett statusfält på uppgiften (ej metadata); när status blir "kunde ej utföras" skapas metadatafältet och presenteras. Behövs **filter/rapport** över missade/tillbakaknuffade jobb (totalt eller per distrikt/utförarkod, sökbart). | Bekräftat krav (§5) |
| **H** | **Verkliga tider / utförandeappens flöde** | Motorerna håller reda på planerade rest-/produktions-/egentider. Appen: **OK-knapp-flöde** (avsluta föregående → nästa uppgift kommer automatiskt; resa → framme → "påbörja uppgift" → klar → nästa). **Manuell tidsjustering** (glömda av-tryck). **"+"-knapp** för att lägga till egentid/lunch live (skjuter fram efterföljande jobb; motor räknar om löpande) och **extrajobb** live (egentid/gratis *eller* lägg till på befintlig order → aktivera artikel med kvm eller start/stopp-tid → debiteras + produktionstid registreras). Flexibiliteten gäller **alla tre tidstyper**. | Delvis byggt; live-tillägg/justering = verifiera/bygg (§5) |
| **I** | **Fyllnadspåverkan / kapacitetsmotorer** | Separat **motor per produktionsteam/-utrustning** som bevakar fyllnadsgrad via inkommande metadata och auto-skapar uppgifter. **Behövs inte nu — men systemet ska ta höjd för det.** | **Utvecklingslogg (§4 U1)** |
| **J** | **Kontering: team + kostnadsställe + projekt** | *(Missat i tidigare analys — läggs till.)* Varje informationspaket på uppgiften måste visa **vilket team** som tilldelats + **kostnadsställe** + **projekt** → följer med till fakturan. Föds ur team-uppsättningen (medlemmar, fordon, kostnadsställe, projektnummer följer teamet) när teamet tilldelas uppgiften. | Bekräftat krav (§5) |

---

## 3. Svar på mina tre frågor (bekräftade)

1. **Egentid (+restid) = samma uppgiftsidentitet som kunduppgifter.** Allt är uppgifter/artiklar med olika utförandekod. Restid kan t.o.m. faktureras om kunden betalar för framresan (annars pris = 0, men redovisas ändå och hör till uppgiften). Personal-/egentid → **rapporter per utförare/team** (produktion/resa/vila) som är grund för löneunderlag och legala vilo-/arbetstidskrav.
2. **Överbokning = manuell** (planeraren), **ingen inlärning** från historik. Slå ihop med underbokning (±). Ska synas tydligt som en **summering i finplaneringen** för teamet (t.ex. "vi ligger på 110 % / 95 % av planerad arbetstid").
3. **Ej-utförd orsak = systemskapad metadata på objektet — JA.** Spårbar (från uppgift/orderkoncept, med tidpunkt) och sökbar (t.ex. "vilka bilder/avvikelser kommer från detta orderkoncept/datum").

---

## 4. Utvecklingslogg — framtida bygge (parkerat)

> Detta är den uttalade "utvecklingsloggen": funktioner systemet ska **ta höjd för** men som **inte** byggs nu.

### U1. Kapacitets-/fyllnadsmotorer (vatten, lakvatten, avfall) — *huvudposten*
Motor per produktionsutrustning/team som läser inkommande metadata (förbrukning/fyllnad) och **auto-skapar uppgifter**.
- **Exempel (Kinab):** tvätt förbrukar vatten per moment; tank har totalt antal liter → när teoretiskt tom skapas uppgift *"åk och fyll på vatten"*.
- **Exempel:** lakvatten-behållare (~2 m³) → när full skapas uppgift *"åk och töm lakvatten"*. Analogt för avfall/tömning av bil.
- **Beroende:** metadata-flöde från artiklar → objekt/utrustning; team-/utrustnings-kalender.
- **Trigger att bygga:** när kapacitets-/logistik-styrning prioriteras. *Behövs inte just nu.*

### U2. Arbetstids- & lönemodul (steg 2)
Bygger på "allt är uppgifter med utförandekod".
- **Över-/underbokad tid** som manifesteras (produktion som tar av egentid) hamnar antingen i en **flextidsbank** (transparent för arbetsgivare + arbetstagare, återförs som egentid senare) eller omvandlas till **beordrad övertid**.
- Övertid måste **klassas med tidskod** (helg vs vardag nära ordinarie tid = olika taxa) enligt svensk arbetsrätt.
- **Löneunderlag:** verklig arbetad tid + övertid + frånvaro. Rapport/motor som stämmer produktionstid mot ~4 v × 40 h/månad; avvikelse = övertid/undertid.
- **Team-/individmodell:** team = 1+ medarbetare + 1+ fordon/utrustning, var och en med **egen kalender**. Teamet (ej enskild medarbetare) sätter arbetstiderna/egentiden. Delat fordon får inte dubbelbokas mellan skift. Sjukdom/tandläkare/tjänstledigt/semester = egna uppgiftstyper med löne-/frånvarologik.
- **Trigger att bygga:** steg 2 (arbetstidshantering). "Får fördjupas senare."

### U3. Geografisk motor för ytor & linjer (steg 2)
Objekt som **yta** (gräsklippning) eller **linje** (vägunderhåll, rad av gatlyktor) i stället för pinpoint.
- Motorn beslutar var ytan/linjen "börjar" (mitt/öst/väst) och redovisar det så det går att planera. Relevant när objektet breder ut sig mer än ~200 m (mindre ytor spelar ingen roll).
- Konsistens med minnesbeslut: geografi uttrycks via metadatafält; representativ position/tyngdpunkt för yta/linje. Se `uppgiftslogik-v1-decisions.md §3`.

### U4. Tvåstegs-navigation i utförandeappen (steg 2)
Fordonsplats → utförandeplats (sista biten till fots).
- Systemet konstaterar antingen pinpointad adress (väg finns) eller att platsen ligger t.ex. 50 m från närmaste väg (ev. via AI). Appens navigationsstöd guidar sista sträckan (garage/park/köpcentrum i Z + XY-led), ev. med Google-stöd. **Ingen sträckberäkning i själva uppgiften.**

### U5. AI-/auto-bokningsmotor (framtida version)
Systemet **bokar/fyller jobb automatiskt** med AI-stöd (procentuell överbokning, ev. inlärning). I dag: **manuell** planerare. Uttryckligen **ej** nu.

### U6. Metadata på fakturarad
Enda genuint saknade delen av informationspaketet (se `uppgiftsmodellen-utredning.md §5`). Kräver eget ADR-beslut när prioriterat (var lagras den, fryses vid freeze, exporteras till Fortnox?). *Referens — bygg inte utan beslut.*

### U7. Restid som fakturerbar uppgift
Modellen finns redan (uppgift/artikel). **Öppen fråga:** var går gränsen för orderkonceptet (vad ingår i konceptet vs faktureras separat). Reds ut i senare läge.

---

## 5. Bekräftade krav för kommande bygge (nära, ej "framtid")

Följande bekräftades som konkreta krav men **byggs inte av detta dokument** — de samlas här så att nästa bygge-task vet vad som är beslutat:

- **Team + kostnadsställe + projekt** i uppgiftens informationspaket → fakturan. *(J)*
- **Ej-utförd orsak** som systemskapad objekt-metadata (orsak + ursprung + tidpunkt) + **filter/rapport** över missade jobb. *(G, fråga 3)*
- **Över-/underbokning ("spilltid")** som fjärde uppgiftstyp + **%-summering i finplaneringen**. Överlappningsregel: **endast egentid** får överlappas (i prioritetsordning); **produktionstid och restid får aldrig överlappas** — genuina objekt-jobb kan inte ligga ovanpå varandra. Slacket tas upp av egentid och kan omvandlas till flextid/inarbetad tid/beordrad övertid. *(D, fråga 2)*
- **Platskrav-klassning** (har plats / saknar plats; obligatorisk/valfri/ingen). *(A)*
- **Leveranstider som N tidsfönster** (hård/mjuk, positiv/negativ) + **SLA-varning/trendflagga** som beslutsunderlag innan leveranstid bryts. Verifiera mot befintliga `frozenTimeRules`/leveranstidsmotorn. *(E)*
- **Utförandeappens live-tillägg** ("+" för egentid/lunch/extrajobb) + **manuell tidsjustering**. Verifiera mot befintlig fältapp. *(H)*
- **Mellanstatusar** i planeringen: *oplacerad/väntar på beräkning*, *blockerad av beroende* (statusfält som noterar när det går fel; bevakas av leverans-/beroendemotorn), *överbokad*.

---

## 6. Öppna namn-/definitionsfrågor

- **Namn på "spilltid"/glapptid** (över-/underbokningens fjärde tidstyp) är inte spikat.
- **Orderkonceptets gräns** för vad som ingår vs faktureras separat (särskilt restid, U7).
- **"Allt klart"-enheten** när ett orderkoncept skapar flera fakturor (se `uppgiftslogik-v1-decisions.md §1`).
