# Klusterfunktionen i Unicorn

## Instruktion för Mats

---

## Grundkoncept

### Kluster = Kundbaserad hierarki med dataärvning

Klustret i Unicorn representerar en **kundhierarki** där:

- **Kunden sitter högst upp** i trädstrukturen
- **Data ärvs nedåt** genom hierarkin (konfigurerbart)
- **Geokodning sker senare** - i ruttoptimeringsfasen, inte vid klusterhantering

> **Viktigt:** Kluster är inte primärt geografiska grupperingar. Det geografiska (GPS-koordinater) läggs till först när ruttoptimeringen körs.

---

## Hierarkinivåer

Objektträdet följer denna struktur uppifrån och ner:

```
Koncern (kund/företagsgrupp)
  └── BRF (bostadsrättsförening)
        └── Fastighet (enskild fastighet)
              └── Rum (utrymme inom fastighet)
                    └── Kärl (enskild behållare)
```

| Nivå | Svenska | Beskrivning |
|------|---------|-------------|
| 1 | Koncern | Översta kundnivån, företagsgrupp |
| 2 | BRF | Bostadsrättsförening |
| 3 | Fastighet | Enskild fastighet/adress |
| 4 | Rum | Utrymme inom fastigheten |
| 5 | Kärl | Enskild behållare/kärl |

---

## Dataärvning (Arvsregler)

Data kan ärvas från överliggande nivåer enligt tre principer:

### 1. Fast (Fixed)
- Värden som **aldrig ändras eller ärvs**
- Exempel: Objektets unika ID, skapad-datum

### 2. Fallande (Falling)
- Värden som **ärvs från förälder** om inget eget värde anges
- Barnet kan **överskriva** med eget värde
- Exempel: Portkod, kontaktperson, parkeringsinstruktioner

### 3. Dynamisk (Dynamic)
- Värden som **beräknas vid körning** baserat på kontext
- Exempel: Totalt antal kärl (summeras från barn), genomsnittlig ställtid

---

## Arbetsflöde

### 1. Skapa Kluster
1. Gå till **Kluster** i sidomenyn
2. Klicka **"+ Nytt kluster"**
3. Fyll i namn och beskrivning
4. Tilldela ansvarigt team och SLA-nivå
5. Postnummer och geografiska koordinater är **valfria** (läggs till senare vid behov)

### 2. Lägg till Objekt i Klustret
1. Skapa objekt med rätt **hierarkinivå** (koncern, brf, fastighet, rum, kärl)
2. Koppla objektet till klustret via **clusterId**
3. Ange **parentId** för att skapa trädhierarkin

### 3. Granska Kluster
- **Listvy:** Visar alla kluster med nyckeltal
- **Kartvy:** Visar kluster geografiskt (om koordinater finns)
- **Detaljvy:** Visar objektträd, ordrar och prenumerationer

### 4. Uppdatera Statistik
- Klicka **"Uppdatera statistik"** för att räkna om cachade värden

---

## Datafält för Kluster

### Grunduppgifter

| Fält | Beskrivning | Obligatorisk |
|------|-------------|--------------|
| `name` | Klustrets namn | Ja |
| `description` | Beskrivning | Nej |
| `primaryTeamId` | Ansvarigt team | Nej |
| `slaLevel` | SLA-nivå: standard / premium / enterprise | Nej |
| `color` | Färgkod för visualisering | Nej |

### Geografiska fält (valfria, för ruttoptimering)

| Fält | Beskrivning |
|------|-------------|
| `centerLatitude` | Centrumlatitud (GPS) |
| `centerLongitude` | Centrumlongitud (GPS) |
| `radiusKm` | Radie i kilometer |
| `postalCodes` | Lista med postnummer |

### Cachade värden (beräknas automatiskt)

| Fält | Beskrivning |
|------|-------------|
| `cachedObjectCount` | Antal objekt i klustret |
| `cachedActiveOrders` | Antal aktiva arbetsordrar |
| `cachedMonthlyValue` | Beräknat månadsvärde (SEK) |
| `cachedAvgSetupTime` | Genomsnittlig ställtid (minuter) |

---

## Metadata på Objekt

### Objektfält

| Fält | Beskrivning | Ärvning |
|------|-------------|---------|
| `name` | Objektnamn | Fast |
| `objectNumber` | Objektnummer | Fast |
| `hierarchyLevel` | Hierarkinivå | Fast |
| `address` | Gatuadress | Fallande |
| `city` | Stad | Fallande |
| `postalCode` | Postnummer | Fallande |
| `accessType` | Åtkomsttyp (open/key/code) | Fallande |
| `accessCode` | Portkod | Fallande |
| `keyNumber` | Nyckelnummer | Fallande |

### accessInfo (JSON-metadata)

Detaljerad åtkomstinformation som kan ärvas:

| Fält | Beskrivning |
|------|-------------|
| `gateCode` | Portkod |
| `keyLocation` | Var nyckeln finns |
| `parking` | Parkeringsinformation |
| `specialInstructions` | Särskilda instruktioner för fältpersonal |

### Kärlinformation

| Fält | Beskrivning |
|------|-------------|
| `containerCount` | Antal kärl totalt |
| `containerCountK2` | Antal K2-kärl |
| `containerCountK3` | Antal K3-kärl |
| `containerCountK4` | Antal K4-kärl |

### Serviceinformation

| Fält | Beskrivning |
|------|-------------|
| `preferredTime1` | Önskad tid 1 |
| `preferredTime2` | Önskad tid 2 |
| `avgSetupTime` | Genomsnittlig ställtid |
| `servicePeriods` | Serviceperioder (JSON) |
| `lastServiceDate` | Senaste servicedatum |

---

## Exempel på ärvning

```
Koncern: "Fastighets AB Norden"
  ├── accessCode: "1234" (sätts på koncernnivå)
  ├── parking: "Parkering på innergård"
  │
  └── BRF: "BRF Solsidan"
        ├── accessCode: ärvs som "1234"
        ├── parking: ärvs som "Parkering på innergård"
        │
        └── Fastighet: "Storgatan 12"
              ├── accessCode: "5678" (överskriver)
              ├── parking: ärvs som "Parkering på innergård"
              │
              └── Rum: "Soprum A"
                    ├── accessCode: ärvs som "5678" (från fastigheten)
                    │
                    └── Kärl: "Kärl 001"
                          └── accessCode: ärvs som "5678"
```

---

## Koppling till Ruttoptimering

Geokodning och ruttoptimering sker i **separat steg**:

1. **Klusterhantering:** Bygg kundhierarki, lägg till metadata
2. **Adressvalidering:** DataClean-tjänsten validerar och geokodnar adresser
3. **Ruttoptimering:** Optimeringstjänsten använder koordinater för ruttplanering

> GPS-koordinater behöver inte finnas vid klusterskaping - de läggs till automatiskt vid adressvalidering eller manuellt vid behov.

---

## Sammanfattning

| Aspekt | Beskrivning |
|--------|-------------|
| **Fokus** | Kundhierarki med dataärvning |
| **Struktur** | Koncern → BRF → Fastighet → Rum → Kärl |
| **Ärvning** | Fast / Fallande / Dynamisk |
| **Geokodning** | Sker senare, vid ruttoptimering |
| **Metadata** | accessInfo innehåller portkod, nyckel, parkering, instruktioner |
